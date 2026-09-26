using System.Diagnostics;
using System.Net.Http.Headers;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace mochi.playtester;

/// <summary>
/// Keeps the playtest dashboard (fruitcats.viamochi.com/playtests.html) up to date, by calling out to the Fruitcats
/// API: every <see cref="PlaytesterConfig.DashboardSeconds"/> it sends new and running runs, asks for a queued run
/// when it's free and starts it, and once an hour sends the deck and persona names the page shows (docs/playtests.md).
///
/// <para>Nothing calls in: the API never reaches this machine, and when this machine is off the page still works and
/// requests wait. The API knows this playtester by a key it makes itself on first start
/// (<c>~/.mochi/playtester.key</c>); <c>/health</c> shows the line to register it with the API (PLAYTEST_RUNNERS).
/// Provider keys for deck builds come from the API when such a run starts and are only passed to that run.</para>
/// </summary>
sealed partial class PlaytesterServer
{
    static readonly HttpClient Api = new() { Timeout = TimeSpan.FromSeconds(60) };
    static readonly JsonSerializerOptions Compact = new() { WriteIndented = false };

    string _runnerKey = "";
    string _runnerKeyLine = "";
    Dictionary<string, string> _pushed = [];
    DateTime _lastMeta = DateTime.MinValue;
    DateTime _lastSyncOk = DateTime.MinValue;
    string _syncError = "";
    DateTime _lastSyncWarning = DateTime.MinValue;

    string PushedFile => Path.Combine(Path.GetDirectoryName(_config.ReportsDir)!, "pushed.json");
    /// <summary>The deck library's working copy during its night (playtest/decks/library.ts, adoptPublishedLibrary):
    /// next to the runner, sent to the API once the night is over.</summary>
    string LibraryFile => Path.Combine(WorkDir, "library.json");
    static string KeyFile => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".mochi", "playtester.key");
    static string Version => Assembly.GetEntryAssembly()?.GetName().Version?.ToString() ?? "?";

    void InitializeDashboard()
    {
        try
        {
            if (!File.Exists(KeyFile))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(KeyFile)!);
                File.WriteAllText(KeyFile, Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant());
                Trace($"Made the dashboard key {KeyFile}");
            }
            _runnerKey = File.ReadAllText(KeyFile).Trim();
            string hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(_runnerKey))).ToLowerInvariant();
            _runnerKeyLine = $"{Environment.MachineName}:{hash}";
        }
        catch (Exception ex) { _syncError = $"No dashboard key: {ex.Message}"; TraceError(_syncError); }
        try { _pushed = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(PushedFile)) ?? []; }
        catch (Exception) { _pushed = []; }
    }

    JsonObject DashboardHealth() => new()
    {
        ["api"] = _config.ApiUrl,
        ["lastSync"] = _lastSyncOk == DateTime.MinValue ? null : _lastSyncOk.ToString("o"),
        ["error"] = _syncError.Length == 0 ? null : _syncError,
        // Not a secret: the API is told this line (PLAYTEST_RUNNERS) to accept this playtester's key.
        ["runnerKey"] = _runnerKeyLine,
    };

    async Task<HttpResponseMessage> CallApiAsync(HttpMethod method, string path, JsonNode? body, CancellationToken ct)
    {
        using HttpRequestMessage request = new(method, $"{_config.ApiUrl.TrimEnd('/')}{path}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", $"runner-{_runnerKey}");
        if (body is not null) request.Content = new StringContent(body.ToJsonString(Compact), Encoding.UTF8, "application/json");
        HttpResponseMessage response = await Api.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            string text = await response.Content.ReadAsStringAsync(ct);
            response.Dispose();
            throw new HttpRequestException($"{method} {path}: HTTP {(int)response.StatusCode} {text[..Math.Min(200, text.Length)]}");
        }
        return response;
    }

    /// <summary>One pass: runs out, work in, and now and then the names the page uses. Never throws.</summary>
    async Task SyncDashboardAsync(CancellationToken ct)
    {
        if (_runnerKey.Length == 0 || string.IsNullOrWhiteSpace(_config.ApiUrl)) return;
        try
        {
            await PushRunsAsync(ct);
            await SendLibraryAsync(ct);
            await PollAsync(ct);
            if (DateTime.UtcNow - _lastMeta > TimeSpan.FromHours(1)) await SendMetaAsync(ct);
            _lastSyncOk = DateTime.UtcNow;
            _syncError = "";
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            _syncError = $"{ex.GetType().Name}: {ex.Message}";
            // Once every 10 minutes is enough to see it in the log; /health always has the latest.
            if (DateTime.UtcNow - _lastSyncWarning > TimeSpan.FromMinutes(10))
            {
                _lastSyncWarning = DateTime.UtcNow;
                TraceWarning($"Dashboard sync failed: {_syncError}");
            }
        }
    }

    /// <summary>Finished runs once (again if their files change), running and stopped runs each time they move.</summary>
    async Task PushRunsAsync(CancellationToken ct)
    {
        bool changed = false;
        DirectoryInfo[] dirs = new DirectoryInfo(_config.ReportsDir).GetDirectories().OrderByDescending(d => d.Name).Take(200).ToArray();
        foreach (DirectoryInfo dir in dirs)
        {
            string summaryFile = Path.Combine(dir.FullName, "summary.json"), reportFile = Path.Combine(dir.FullName, "report.md");
            JsonObject? doc;
            string marker;
            if (File.Exists(summaryFile))
            {
                marker = $"s:{File.GetLastWriteTimeUtc(summaryFile).Ticks}:{(File.Exists(reportFile) ? File.GetLastWriteTimeUtc(reportFile).Ticks : 0)}";
                if (_pushed.GetValueOrDefault(dir.Name) == marker) continue;
                try { doc = JsonNode.Parse(File.ReadAllText(summaryFile))?.AsObject(); }
                catch (Exception) { continue; }   // still being written
                if (doc is null) continue;
                doc["report"] = File.Exists(reportFile) ? File.ReadAllText(reportFile) : "";
            }
            else
            {
                if (Progress(dir.FullName) is not JsonObject row || row["progress"] is not JsonObject p) continue;
                string result = row["result"]!.GetValue<string>();
                marker = $"p:{result}:{p["updatedAt"]}:{p["done"]}";
                if (_pushed.GetValueOrDefault(dir.Name) == marker) continue;
                DateTime.TryParse(p["startedAt"]?.ToString(), out DateTime started);
                DateTime.TryParse(p["updatedAt"]?.ToString(), out DateTime updated);
                doc = new JsonObject
                {
                    ["id"] = p["id"]?.DeepClone(), ["kind"] = p["kind"]?.DeepClone(), ["startedAt"] = p["startedAt"]?.DeepClone(),
                    ["host"] = Environment.MachineName, ["cardsHash"] = "", ["rulesVersion"] = 0,
                    ["durationSec"] = Math.Max(0, (long)(updated - started).TotalSeconds), ["games"] = 0, ["result"] = result,
                    ["problems"] = new JsonArray(), ["details"] = new JsonObject(), ["request"] = p["request"]?.DeepClone(),
                    ["progress"] = new JsonObject { ["phase"] = p["phase"]?.DeepClone(), ["done"] = p["done"]?.DeepClone(), ["total"] = p["total"]?.DeepClone(), ["updatedAt"] = p["updatedAt"]?.DeepClone() },
                };
            }
            if (doc["id"]?.ToString() != dir.Name) continue;
            try { using (await CallApiAsync(HttpMethod.Put, $"/v1/playtests/runs/{dir.Name}", doc, ct)) { } }
            catch (HttpRequestException ex) when (ex.Message.Contains("HTTP 400", StringComparison.Ordinal))
            {
                // One run the API won't take mustn't hold up the others, or the work queue: skipped until it changes.
                TraceWarning($"The API refused run {dir.Name}: {ex.Message}");
            }
            _pushed[dir.Name] = marker;
            changed = true;
        }
        if (!changed) return;
        HashSet<string> present = dirs.Select(d => d.Name).ToHashSet();
        foreach (string gone in _pushed.Keys.Where(k => !present.Contains(k)).ToList()) _pushed.Remove(gone);
        try { File.WriteAllText(PushedFile, JsonSerializer.Serialize(_pushed)); }
        catch (Exception ex) { TraceWarning($"Could not save {PushedFile}: {ex.Message}"); }
    }

    /// <summary>Tells the API whether this playtester is free; when it is, starts the run it's given.</summary>
    async Task PollAsync(CancellationToken ct)
    {
        bool busy;
        JsonObject? running;
        lock (_gate)
        {
            busy = _busy;
            running = busy ? new JsonObject { ["command"] = _runCommand, ["startedAt"] = _runStarted.ToString("o") } : null;
        }
        JsonNode? answer;
        using (HttpResponseMessage r = await CallApiAsync(HttpMethod.Post, "/v1/playtests/runner/poll",
                   new JsonObject { ["busy"] = busy, ["running"] = running, ["version"] = Version }, ct))
            answer = JsonNode.Parse(await r.Content.ReadAsStringAsync(ct));
        if (answer?["request"] is not JsonObject request) return;

        string id = request["id"]!.GetValue<string>();
        string command = request["command"]?.GetValue<string>() ?? "";
        string args = $"{request["args"]?.GetValue<string>() ?? ""} --request {id}".Trim();
        string? error = !IsCommand(command) ? $"unknown command {command}"
            : !SafeArgs().IsMatch(args) ? "arguments may only contain letters, digits, spaces, dots, commas and dashes" : null;

        Dictionary<string, string> env = [];
        if (error is null && command is "deck-build" or "deck-hunt")
        {
            // Paid model keys only for the run that needs them, and never saved here.
            using HttpResponseMessage r = await CallApiAsync(HttpMethod.Get, "/v1/playtests/runner/keys", null, ct);
            foreach ((string name, JsonNode? value) in JsonNode.Parse(await r.Content.ReadAsStringAsync(ct))?.AsObject() ?? [])
                if (value is not null) env[name] = value.GetValue<string>();
        }

        Task<string?> start = error is null ? StartRunAsync(command, args, CancellationToken.None, env) : Task.FromResult<string?>(error);
        // A busy runner or a bad setup answers at once; the rest (downloads, loading the model) carries on.
        if (start.IsCompleted)
        {
            error = await start;
            bool waiting = error?.Contains("already going", StringComparison.Ordinal) == true;
            await ReportRequestAsync(id, error is null ? "started" : waiting ? "queued" : "failed",
                error is null ? "Started on PC2024." : waiting ? "Waiting: another run is going on PC2024." : $"PC2024 could not start it: {error}", ct);
            return;
        }
        await ReportRequestAsync(id, "started", "Started on PC2024.", ct);
        _ = start.ContinueWith(async t =>
        {
            string? late = t.IsFaulted ? t.Exception?.GetBaseException().Message : t.Result;
            if (late is not null) await ReportRequestAsync(id, "failed", $"PC2024 could not start it: {late}", CancellationToken.None);
        }, TaskScheduler.Default);
    }

    /// <summary>Every evening from <see cref="PlaytesterConfig.LibraryNightHour"/>, once a day, when the dashboard is on.</summary>
    bool LibraryNightDue(DateTime now) =>
        _config.LibraryNightHour >= 0 && now.Hour >= _config.LibraryNightHour && _lastLibraryDay != now.ToString("yyyy-MM-dd")
        && _runnerKey.Length > 0 && !string.IsNullOrWhiteSpace(_config.ApiUrl);

    async Task StartLibraryNightAsync(CancellationToken ct)
    {
        _lastLibraryDay = DateTime.Now.ToString("yyyy-MM-dd");
        SaveState();
        Dictionary<string, string> env = [];
        try
        {
            using HttpResponseMessage r = await CallApiAsync(HttpMethod.Get, "/v1/playtests/runner/keys", null, ct);
            foreach ((string name, JsonNode? value) in JsonNode.Parse(await r.Content.ReadAsStringAsync(ct))?.AsObject() ?? [])
                if (value is not null) env[name] = value.GetValue<string>();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Without the API there's nowhere to publish tonight's library: try again tomorrow.
            TraceWarning($"No library night tonight: the API didn't answer ({ex.Message})");
            return;
        }
        string? error = await StartRunAsync("decks", "nightly --here", ct, env);
        if (error is not null) TraceWarning($"The library night didn't start: {error}");
    }

    /// <summary>Tonight's library, once its night is over, to the API, which publishes it for every runner.</summary>
    async Task SendLibraryAsync(CancellationToken ct)
    {
        bool busy;
        lock (_gate) busy = _busy;
        if (busy || !File.Exists(LibraryFile)) return;
        JsonNode library = JsonNode.Parse(await File.ReadAllTextAsync(LibraryFile, ct))!;
        using (await CallApiAsync(HttpMethod.Put, "/v1/playtests/library", library, ct)) { }
        // Gone once published, so every run takes the published copy again.
        File.Delete(LibraryFile);
        Trace("Deck library sent to the API and published");
    }

    async Task ReportRequestAsync(string id, string status, string note, CancellationToken ct)
    {
        try { using (await CallApiAsync(HttpMethod.Post, $"/v1/playtests/runner/requests/{id}", new JsonObject { ["status"] = status, ["note"] = note }, ct)) { } }
        catch (Exception ex) when (ex is not OperationCanceledException) { TraceWarning($"Could not tell the API about request {id}: {ex.Message}"); }
    }

    /// <summary>The decks, families, personas, library and Hero Cats the page names things with, from the live runner
    /// (a copy of its own, so a run going at the same time is never touched).</summary>
    async Task SendMetaAsync(CancellationToken ct)
    {
        // Once an hour, whether or not it works: a failing download isn't retried every pass.
        _lastMeta = DateTime.UtcNow;
        _node ??= FindNode();
        if (_node is null) return;
        string dir = Path.Combine(WorkDir, "meta");
        Directory.CreateDirectory(dir);
        string runner = Path.Combine(dir, "runner.mjs");
        byte[] bytes = await Http.GetByteArrayAsync($"{_config.RunnerUrl}?v={DateTime.UtcNow.Ticks}", ct);
        await File.WriteAllBytesAsync(runner, bytes, ct);

        ProcessStartInfo psi = new(_node) { WorkingDirectory = dir, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        psi.ArgumentList.Add(runner);
        psi.ArgumentList.Add("dashboard-meta");
        using Process process = Process.Start(psi) ?? throw new InvalidOperationException("node did not start");
        Task<string> stdout = process.StandardOutput.ReadToEndAsync(ct);
        Task<string> stderr = process.StandardError.ReadToEndAsync(ct);
        using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromMinutes(2));
        try { await process.WaitForExitAsync(timeout.Token); }
        catch (OperationCanceledException) { process.Kill(entireProcessTree: true); throw new TimeoutException("dashboard-meta took over 2 minutes"); }
        if (process.ExitCode != 0) throw new InvalidOperationException($"dashboard-meta exited with {process.ExitCode}: {(await stderr).Trim()[..Math.Min(200, (await stderr).Trim().Length)]}");
        string? line = (await stdout).Split('\n', StringSplitOptions.RemoveEmptyEntries).LastOrDefault(l => l.TrimStart().StartsWith('{'));
        JsonNode meta = JsonNode.Parse(line ?? throw new InvalidOperationException("dashboard-meta printed nothing"))!;
        using (await CallApiAsync(HttpMethod.Put, "/v1/playtests/meta", meta, ct)) { }
    }
}
