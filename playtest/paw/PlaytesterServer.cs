using System.ComponentModel;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Mochi.Paws;

namespace mochi.playtester;

/// <summary>
/// Runs Fruitcats playtests on PC2024 while nobody is using it: once a week (Sunday night by default) it
/// downloads the current playtest runner from the live site and starts <c>node runner.mjs weekly</c>, which
/// plays the bot gauntlet on the CPU and LLM games through the local model node on the GPU. Reports stay on
/// this machine and are served by <c>/runs</c>; the laptop's sync task copies them to the dashboard.
///
/// <para>Like mochi-jarvis, a failure here never ends the paw: a paw that exits early is read by catsitter as
/// a bad build and quarantined. A failed download or a crashed run is recorded, reported through
/// <see cref="HealthAsync"/>, and the paw waits for the next run.</para>
/// </summary>
sealed partial class PlaytesterServer : UdsPaw
{
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(2) };

    PlaytesterConfig _config = new();
    readonly object _gate = new();
    Process? _run;
    ChildProcessJob? _job;
    string _runCommand = "";
    DateTime _runStarted;
    JsonObject? _lastRun;
    string _lastError = "";
    string? _node;

    const string NodeMissing = @"Node was not found (not configured, not on PATH, not in Program Files\nodejs); playtests cannot run";

    public PlaytesterServer() : base("mochi-playtester")
    {
    }

    string StateFile => Path.Combine(Path.GetDirectoryName(_config.ReportsDir)!, "state.json");
    string WorkDir => Path.Combine(Path.GetDirectoryName(_config.ReportsDir)!, "work");
    string LogDir => Path.Combine(Path.GetDirectoryName(_config.ReportsDir)!, "logs");

    protected override Task InitializeAsync(CancellationToken ct)
    {
        _config = GetConfig<PlaytesterConfig>();
        Directory.CreateDirectory(_config.ReportsDir);
        Directory.CreateDirectory(WorkDir);
        Directory.CreateDirectory(LogDir);
        if (File.Exists(StateFile))
        {
            try { _lastRun = JsonNode.Parse(File.ReadAllText(StateFile))?["lastRun"]?.AsObject(); }
            catch (Exception ex) { TraceWarning($"Unreadable {StateFile}: {ex.Message}"); }
        }
        _node = FindNode();
        if (_node is null)
        {
            // Not fatal: the paw stays up and says why in /health, since a paw that exits early is read by
            // catsitter as a bad build.
            _lastError = NodeMissing;
            TraceError(_lastError);
        }
        else
        {
            Trace($"Using Node at {_node}");
        }
        Trace($"Playtester ready: weekly on {_config.Day} from {_config.StartHour}:00 for {_config.Hours} h; reports in {_config.ReportsDir}");
        return Task.CompletedTask;
    }

    /// <summary>The week's run is due: it is the day, past the start hour, inside the window, and this week's
    /// run hasn't happened yet.</summary>
    bool WeeklyDue(DateTime now)
    {
        if (now.DayOfWeek != _config.Day || now.Hour < _config.StartHour) return false;
        DateTime windowStart = now.Date.AddHours(_config.StartHour);
        if (now > windowStart.AddHours(Math.Max(1, _config.Hours - 0.5))) return false;
        string? last = _lastRun?["command"]?.GetValue<string>() == "weekly" ? _lastRun?["startedAt"]?.GetValue<string>() : null;
        return last is null || DateTime.Parse(last).ToLocalTime() < windowStart;
    }

    protected override async Task RunBackgroundAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromMinutes(1), ct);
                bool idle;
                lock (_gate) idle = _run is null;
                if (idle && WeeklyDue(DateTime.Now))
                    await StartRunAsync("weekly", _config.WeeklyArgs, ct);
            }
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown.
        }
        finally
        {
            StopRun();
        }
    }

    /// <summary>Downloads the runner, then starts it; returns why not if it couldn't.</summary>
    async Task<string?> StartRunAsync(string command, string args, CancellationToken ct)
    {
        lock (_gate)
        {
            if (_run is not null) return $"a {_runCommand} run is already going (since {_runStarted:HH:mm})";
            _runCommand = command;
            _runStarted = DateTime.UtcNow;
        }
        string? error = null;
        try
        {
            _node ??= FindNode();
            if (_node is null) throw new FileNotFoundException(NodeMissing);
            string runner = await DownloadRunnerAsync(ct);
            string id = $"{command}-{_runStarted:yyyyMMdd-HHmmss}";
            string logFile = Path.Combine(LogDir, $"{id}.log");

            ProcessStartInfo psi = new(_node)
            {
                WorkingDirectory = WorkDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add(runner);
            psi.ArgumentList.Add(command);
            foreach (string a in args.Split(' ', StringSplitOptions.RemoveEmptyEntries)) psi.ArgumentList.Add(a);
            psi.Environment["PLAYTEST_REPORTS"] = _config.ReportsDir;

            Process process = Process.Start(psi) ?? throw new InvalidOperationException("node did not start");
            ChildProcessJob job = new();
            job.Adopt(process);
            StreamWriter log = new(logFile, append: true) { AutoFlush = true };
            void Line(string? text)
            {
                if (string.IsNullOrEmpty(text)) return;
                lock (log) log.WriteLine(text);
                Trace($"runner: {text}");
            }
            process.OutputDataReceived += (_, e) => Line(e.Data);
            process.ErrorDataReceived += (_, e) => Line(e.Data);
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            lock (_gate) { _run = process; _job = job; }
            Trace($"Started {command} ({string.Join(' ', psi.ArgumentList)}); log {logFile}");
            _ = WatchAsync(process, job, log, command, logFile);
        }
        catch (Exception ex)
        {
            error = $"{command} could not start: {ex.GetType().Name}: {ex.Message}";
            _lastError = error;
            TraceError(error);
            Record(command, _runStarted, exitCode: null, error);
            lock (_gate) { _run = null; }
        }
        return error;
    }

    async Task WatchAsync(Process process, ChildProcessJob job, StreamWriter log, string command, string logFile)
    {
        DateTime started = _runStarted;
        // A hard stop past the window, so a hung run can't eat into the next day.
        TimeSpan limit = TimeSpan.FromHours(_config.Hours + 1);
        using CancellationTokenSource cts = new(limit);
        try { await process.WaitForExitAsync(cts.Token); }
        catch (OperationCanceledException) { TraceWarning($"{command} ran past {limit.TotalHours:F1} h; stopping it"); }
        int? code = null;
        try
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            process.WaitForExit(10_000);
            code = process.ExitCode;
        }
        catch (Exception ex) { TraceWarning($"Stopping the runner: {ex.Message}"); }
        job.Dispose();
        lock (log) log.Dispose();
        string? error = code == 0 ? null : $"{command} exited with code {code?.ToString() ?? "?"}; see {logFile}";
        if (error is not null) { _lastError = error; TraceWarning(error); } else _lastError = "";
        Record(command, started, code, error);
        Prune();
        lock (_gate) { _run = null; _job = null; }
    }

    void Record(string command, DateTime startedUtc, int? exitCode, string? error)
    {
        _lastRun = new JsonObject
        {
            ["command"] = command,
            ["startedAt"] = startedUtc.ToString("o"),
            ["finishedAt"] = DateTime.UtcNow.ToString("o"),
            ["exitCode"] = exitCode,
            ["error"] = error,
        };
        try
        {
            string tmp = StateFile + ".tmp";
            File.WriteAllText(tmp, new JsonObject { ["lastRun"] = _lastRun.DeepClone() }.ToJsonString());
            File.Move(tmp, StateFile, overwrite: true);
        }
        catch (Exception ex) { TraceWarning($"Could not save {StateFile}: {ex.Message}"); }
    }

    /// <summary>Node, from the config, else PATH, else the standard install folder, else a copy in this package.</summary>
    string? FindNode()
    {
        if (!string.IsNullOrWhiteSpace(_config.NodeExe))
            return File.Exists(_config.NodeExe) ? _config.NodeExe : null;
        IEnumerable<string> onPath = (Environment.GetEnvironmentVariable("PATH") ?? "")
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .Select(dir => Path.Combine(dir.Trim('"'), "node.exe"));
        string[] fallbacks =
        [
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(AppContext.BaseDirectory, "node", "node.exe"),
        ];
        return onPath.Concat(fallbacks).FirstOrDefault(File.Exists);
    }

    /// <summary>The runner as it is on the live site, written atomically; the last good copy is kept if the
    /// download fails, so a site hiccup doesn't cost the week's run.</summary>
    async Task<string> DownloadRunnerAsync(CancellationToken ct)
    {
        string target = Path.Combine(WorkDir, "runner.mjs");
        try
        {
            byte[] bytes = await Http.GetByteArrayAsync($"{_config.RunnerUrl}?v={DateTime.UtcNow.Ticks}", ct);
            string tmp = target + ".tmp";
            await File.WriteAllBytesAsync(tmp, bytes, ct);
            File.Move(tmp, target, overwrite: true);
            Trace($"Runner downloaded: {bytes.Length / 1024} KB, sha256 {Convert.ToHexString(SHA256.HashData(bytes))[..12].ToLowerInvariant()}");
        }
        catch (Exception ex) when (File.Exists(target) && ex is not OperationCanceledException)
        {
            TraceWarning($"Runner download failed ({ex.Message}); using the copy from the last run");
        }
        return target;
    }

    /// <summary>Keeps the newest <see cref="PlaytesterConfig.KeepRuns"/> run folders.</summary>
    void Prune()
    {
        try
        {
            foreach (DirectoryInfo old in new DirectoryInfo(_config.ReportsDir).GetDirectories()
                         .OrderByDescending(d => d.Name).Skip(_config.KeepRuns))
                old.Delete(recursive: true);
        }
        catch (Exception ex) { TraceWarning($"Pruning old runs: {ex.Message}"); }
    }

    void StopRun()
    {
        Process? run;
        ChildProcessJob? job;
        lock (_gate) { run = _run; job = _job; }
        try
        {
            if (run is not null && !run.HasExited)
            {
                Trace("Stopping the running playtest");
                run.Kill(entireProcessTree: true);
                run.WaitForExit(10_000);
            }
        }
        catch (Exception ex) { TraceWarning($"The runner did not stop cleanly ({ex.Message}); relying on the job object"); }
        finally { job?.Dispose(); }
    }

    [PawRoute("GET", "/health")]
    [Description("Whether a playtest is running, the last run, and when the next weekly run is due")]
    public Task<JsonObject> HealthAsync()
    {
        DateTime now = DateTime.Now;
        DateTime next = now.Date.AddHours(_config.StartHour);
        while (next.DayOfWeek != _config.Day || next < now) next = next.AddDays(1);
        JsonObject result;
        lock (_gate)
        {
            result = new JsonObject
            {
                ["running"] = _run is not null ? new JsonObject { ["command"] = _runCommand, ["startedAt"] = _runStarted.ToString("o") } : null,
                ["lastRun"] = _lastRun?.DeepClone(),
                ["nextWeekly"] = next.ToString("o"),
                ["node"] = _node,
                ["runnerUrl"] = _config.RunnerUrl,
                ["error"] = _lastError.Length == 0 ? null : _lastError,
            };
        }
        return Task.FromResult(result);
    }

    [PawRoute("POST", "/run")]
    [Description("Start a playtest now: command 'weekly' (default), 'balance' or 'llm-playtest', with optional runner arguments")]
    public async Task<JsonObject> RunAsync(string? command = null, string? args = null)
    {
        command ??= "weekly";
        if (command is not ("weekly" or "balance" or "llm-playtest" or "deck-hunt"))
            return new JsonObject { ["started"] = false, ["error"] = $"unknown command {command}" };
        if (args is not null && !SafeArgs().IsMatch(args))
            return new JsonObject { ["started"] = false, ["error"] = "arguments may only contain letters, digits, spaces, dots, commas and dashes" };
        string? error = await StartRunAsync(command, args ?? (command == "weekly" ? _config.WeeklyArgs : ""), CancellationToken.None);
        return new JsonObject { ["started"] = error is null, ["error"] = error };
    }

    [PawRoute("GET", "/runs")]
    [Description("The most recent playtest runs, newest first: id, kind, when, result and problem count")]
    public Task<JsonObject> RunsAsync()
    {
        JsonArray runs = [];
        foreach (DirectoryInfo dir in new DirectoryInfo(_config.ReportsDir).GetDirectories().OrderByDescending(d => d.Name).Take(200))
        {
            string file = Path.Combine(dir.FullName, "summary.json");
            if (!File.Exists(file)) continue;
            try
            {
                JsonNode? s = JsonNode.Parse(File.ReadAllText(file));
                runs.Add(new JsonObject
                {
                    ["id"] = s?["id"]?.DeepClone(), ["kind"] = s?["kind"]?.DeepClone(), ["startedAt"] = s?["startedAt"]?.DeepClone(),
                    ["result"] = s?["result"]?.DeepClone(), ["games"] = s?["games"]?.DeepClone(),
                    ["problems"] = s?["problems"]?.AsArray().Count ?? 0,
                });
            }
            catch (JsonException) { /* a run still being written */ }
        }
        return Task.FromResult(new JsonObject { ["runs"] = runs });
    }

    [PawRoute("POST", "/runs/get")]
    [Description("One run's summary (JSON) and report (Markdown)")]
    public Task<JsonObject> GetRunAsync(string id)
    {
        if (!RunId().IsMatch(id)) return Task.FromResult(new JsonObject { ["error"] = "not a run id" });
        string dir = Path.Combine(_config.ReportsDir, id);
        if (!Directory.Exists(dir)) return Task.FromResult(new JsonObject { ["error"] = "no such run" });
        string summary = Path.Combine(dir, "summary.json"), report = Path.Combine(dir, "report.md");
        return Task.FromResult(new JsonObject
        {
            ["summary"] = File.Exists(summary) ? JsonNode.Parse(File.ReadAllText(summary)) : null,
            ["report"] = File.Exists(report) ? File.ReadAllText(report) : null,
        });
    }

    [GeneratedRegex(@"^[a-z-]+-\d{8}-\d{6}$")]
    private static partial Regex RunId();

    [GeneratedRegex(@"^[A-Za-z0-9 .,\-]*$")]
    private static partial Regex SafeArgs();
}
