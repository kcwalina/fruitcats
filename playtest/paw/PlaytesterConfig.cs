namespace mochi.playtester;

/// <summary>
/// Non-secret settings for the playtester, read from <c>~/.mochi/playtester.json</c>. Paths, a URL and a
/// schedule only: API keys for paid LLM providers, if any are used, come in as environment variables.
/// </summary>
sealed class PlaytesterConfig
{
    public string UserId { get; set; } = "";
    public string HubUrl { get; set; } = "https://www.viamochi.com";
    public string ServiceBus { get; set; } = "";

    /// <summary>The playtest runner, published next to the game by fruitcats' <c>npm run deploy</c>, so every
    /// run tests the cards that are live.</summary>
    public string RunnerUrl { get; set; } = "https://fruitcats.viamochi.com/playtest/runner.mjs";

    /// <summary>Node to run the playtest runner with. Empty means: the one on PATH, then the standard install
    /// folder, then a copy shipped inside this package (node\node.exe) if a package ever carries one.</summary>
    public string NodeExe { get; set; } = "";

    /// <summary>Where runs are written; each run is a folder with summary.json and report.md.</summary>
    public string ReportsDir { get; set; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "mochi.playtester", "runs");

    /// <summary>The nightly run: the local hour it may start and how long it may take.</summary>
    public int StartHour { get; set; } = 0;
    public double Hours { get; set; } = 6.5;

    /// <summary>Arguments for the nightly command (the runner reads provider and model defaults from its own config).</summary>
    public string NightlyArgs { get; set; } = "--provider pc2024 --hours 6";

    /// <summary>Run LLM games on the paw's own llama-server (several games at once) instead of Ollama.</summary>
    public bool InferenceServer { get; set; } = true;
    public string LlamaServerExe { get; set; } = @"C:\ai\llamacpp\llama-server.exe";
    /// <summary>llama.cpp's build of gpt-oss-20b (Ollama's copy is labelled for Ollama only); downloaded once.</summary>
    public string ModelPath { get; set; } = @"C:\ai\playtest\gpt-oss-20b-mxfp4.gguf";
    public string ModelUrl { get; set; } = "https://huggingface.co/ggml-org/gpt-oss-20b-GGUF/resolve/main/gpt-oss-20b-mxfp4.gguf";
    /// <summary>The Ollama model to unload before starting, so the GPU doesn't hold it twice.</summary>
    public string OllamaModel { get; set; } = "gpt-oss:20b";
    public int ServerPort { get; set; } = 8091;
    /// <summary>Games the server plays at once, and the context each one gets (a move's prompt is ~1.5k tokens).</summary>
    public int Slots { get; set; } = 8;
    public int ContextPerSlot { get; set; } = 6144;

    /// <summary>How many run folders to keep; older ones are deleted after each run.</summary>
    public int KeepRuns { get; set; } = 200;
}
