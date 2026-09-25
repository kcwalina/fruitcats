using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace mochi.playtester;

/// <summary>
/// The playtests' own inference server: llama.cpp's <c>llama-server</c> with gpt-oss-20b and several parallel
/// slots, started for the length of a run that plays LLM games and stopped after it.
///
/// <para>Why not Ollama, which already has the model: Ollama runs few requests at once, so most of each game
/// was spent waiting its turn. llama-server with continuous batching reads the model's weights once per step for
/// every game in progress, and memory bandwidth is what limits a GPU here, so eight games at once cost little more
/// than one. Ollama's copy of the model is labelled <c>gptoss</c> where llama.cpp expects <c>gpt-oss</c>, so this
/// uses llama.cpp's own build of it, downloaded once into <see cref="PlaytesterConfig.ModelPath"/>.</para>
///
/// <para>Nothing here is fatal: if the server can't start, the run falls back to Ollama and /health says why.</para>
/// </summary>
sealed class LlamaServer(PlaytesterConfig config, Action<string> trace, Action<string> warn)
{
    static readonly HttpClient Http = new() { Timeout = Timeout.InfiniteTimeSpan };

    Process? _process;
    ChildProcessJob? _job;
    public string Status { get; private set; } = "not started";

    public string Endpoint => $"http://127.0.0.1:{config.ServerPort}/v1";

    /// <summary>Starts the server and waits until it answers; returns the endpoint, or null if it couldn't.</summary>
    public async Task<string?> StartAsync(CancellationToken ct)
    {
        try
        {
            if (!File.Exists(config.LlamaServerExe)) { Status = $"llama-server not found at {config.LlamaServerExe}"; warn(Status); return null; }
            await EnsureModelAsync(ct);
            await UnloadFromOllamaAsync();

            ProcessStartInfo psi = new(config.LlamaServerExe)
            {
                WorkingDirectory = Path.GetDirectoryName(config.LlamaServerExe) ?? Environment.CurrentDirectory,
                RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true,
            };
            foreach (string a in new[]
            {
                "--model", config.ModelPath, "--host", "127.0.0.1", "--port", config.ServerPort.ToString(),
                "--n-gpu-layers", "99", "--parallel", config.Slots.ToString(),
                "--ctx-size", (config.Slots * config.ContextPerSlot).ToString(),
                // The chat template carries gpt-oss's reasoning format and the reasoning_effort kwarg.
                "--jinja",
            }) psi.ArgumentList.Add(a);

            trace($"Starting llama-server: {config.Slots} slots x {config.ContextPerSlot} tokens, {Path.GetFileName(config.ModelPath)}");
            _process = Process.Start(psi) ?? throw new InvalidOperationException("llama-server did not start");
            _job = new ChildProcessJob();
            _job.Adopt(_process);
            _process.OutputDataReceived += (_, e) => { if (!string.IsNullOrEmpty(e.Data)) trace($"llama-server: {e.Data}"); };
            _process.ErrorDataReceived += (_, e) => { if (!string.IsNullOrEmpty(e.Data)) trace($"llama-server: {e.Data}"); };
            _process.BeginOutputReadLine();
            _process.BeginErrorReadLine();

            DateTime deadline = DateTime.UtcNow.AddMinutes(5);
            using HttpClient probe = new() { Timeout = TimeSpan.FromSeconds(5) };
            while (DateTime.UtcNow < deadline && !ct.IsCancellationRequested)
            {
                if (_process.HasExited) { Status = $"llama-server exited during startup (code {_process.ExitCode}); see the paw's trace"; warn(Status); Stop(); return null; }
                try
                {
                    if ((await probe.GetAsync($"http://127.0.0.1:{config.ServerPort}/health", ct)).IsSuccessStatusCode)
                    {
                        Status = $"serving on {Endpoint} with {config.Slots} slots";
                        trace(Status);
                        return Endpoint;
                    }
                }
                catch (HttpRequestException) { /* still loading */ }
                await Task.Delay(TimeSpan.FromSeconds(2), ct);
            }
            Status = "llama-server did not become healthy within 5 minutes";
            warn(Status);
            Stop();
            return null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Status = $"could not start: {ex.GetType().Name}: {ex.Message}";
            warn(Status);
            Stop();
            return null;
        }
    }

    public void Stop()
    {
        try
        {
            if (_process is not null && !_process.HasExited)
            {
                _process.Kill(entireProcessTree: true);
                _process.WaitForExit(10_000);
            }
        }
        catch (Exception ex) { warn($"llama-server did not stop cleanly ({ex.Message}); relying on the job object"); }
        finally
        {
            _job?.Dispose();
            _job = null;
            _process = null;
            if (Status.StartsWith("serving")) Status = "stopped after the run";
        }
    }

    /// <summary>Downloads the model once, to a temporary name first so a broken download is never mistaken for
    /// the model.</summary>
    async Task EnsureModelAsync(CancellationToken ct)
    {
        if (File.Exists(config.ModelPath)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(config.ModelPath)!);
        string partial = config.ModelPath + ".download";
        Status = $"downloading {config.ModelUrl}";
        trace(Status);
        using (HttpResponseMessage r = await Http.GetAsync(config.ModelUrl, HttpCompletionOption.ResponseHeadersRead, ct))
        {
            r.EnsureSuccessStatusCode();
            await using Stream body = await r.Content.ReadAsStreamAsync(ct);
            await using FileStream file = File.Create(partial);
            await body.CopyToAsync(file, 1 << 20, ct);
        }
        long size = new FileInfo(partial).Length;
        if (size < 1_000_000_000) { File.Delete(partial); throw new InvalidDataException($"the model download is only {size} bytes"); }
        File.Move(partial, config.ModelPath, overwrite: true);
        trace($"Model downloaded: {size / 1_000_000} MB");
    }

    /// <summary>Asks Ollama to drop gpt-oss from the GPU, so the card doesn't hold the same model twice.</summary>
    async Task UnloadFromOllamaAsync()
    {
        try
        {
            using HttpClient c = new() { Timeout = TimeSpan.FromSeconds(30) };
            await c.PostAsJsonAsync("http://127.0.0.1:11434/api/generate", new JsonObject { ["model"] = config.OllamaModel, ["keep_alive"] = 0 });
        }
        catch (Exception ex) { trace($"Ollama unload skipped: {ex.Message}"); }
    }
}
