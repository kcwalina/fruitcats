using System.Text.Json;
using Kardix;

// kardix: the Kardix platform's command-line tool. Everything it knows about games is the core's (kardix.wasm), which
// it carries inside it and runs through Wasmtime.
//
//   kardix check [--project <folder>]
//
// Loads the project with the core and prints what is wrong with it, one line per problem: file(line,column): error:
// message. Exits 1 when there is an error.
//
//   kardix studio [--project <folder>] [--port <number>] [--no-open]
//
// Opens Studio on the project in the browser: its files, its cards and its rulebook, read again each time a file is
// saved. It serves on localhost only, until Ctrl+C.
//
//   kardix cards [--project <folder>] [--set <name>] [--out <folder>] [--finish <name>] [--only <number>...] [--frame <name>] [--no-art] [--bleed] [--draw-list]
//
// Draws every card face of the project, in each finish it's printed in, as PNGs into --out (default out/cards/{set}):
// a folder relative to where kardix runs, where {set} is the name of the file the cards are written in. Finishes
// other than standard go into a subfolder. --frame draws every card in the layout's frame of that name; --no-art
// leaves the pictures see-through (the art's window and a frame's texture), for a tool that shows an artist's
// picture under the card. --draw-list writes each face's draw list (the core's description of it) instead.
// A font the card layout names that isn't in the project is read from the system's fonts.
try
{
    if (args.Length == 0 || args[0] is "-h" or "--help" or "help")
    {
        Console.WriteLine("kardix check [--project <folder>]");
        Console.WriteLine("kardix studio [--project <folder>] [--port <number>] [--no-open]");
        Console.WriteLine("kardix cards [--project <folder>] [--set <name>] [--out <folder>] [--finish <name>] [--only <number>...] [--frame <name>] [--no-art] [--bleed] [--draw-list]");
        return 0;
    }

    return args[0] switch
    {
        "check" => Check(args[1..]),
        "studio" => Studio.Run(args[1..]),
        "cards" => Cards(args[1..]),
        _ => throw new KardixException($"kardix doesn't know the command '{args[0]}'. Try: kardix check, kardix studio, kardix cards"),
    };
}
catch (KardixException e)
{
    Console.Error.WriteLine("kardix: " + e.Message);
    return 1;
}

static string ProjectFolder(string projectDir)
{
    string root = Path.GetFullPath(projectDir);
    return Directory.Exists(root) ? root : throw new KardixException($"There is no folder {projectDir}.");
}

// The project's Alex files, by their paths within its folder.
static List<(string Path, byte[] Bytes)> AlexFiles(string root)
{
    List<(string Path, byte[] Bytes)> files = new();
    foreach (string path in Directory.EnumerateFiles(root, "*.alex", SearchOption.AllDirectories))
    {
        string relative = Path.GetRelativePath(root, path);
        if (relative.Split(Path.DirectorySeparatorChar).Any(p => p is "node_modules" or "bin" or "obj" or ".git")) { continue; }
        files.Add((relative.Replace(Path.DirectorySeparatorChar, '/'), File.ReadAllBytes(path)));
    }

    files.Sort((a, b) => string.CompareOrdinal(a.Path, b.Path));
    return files;
}

static int Check(string[] args)
{
    string projectDir = Directory.GetCurrentDirectory();
    for (int i = 0; i < args.Length; i++)
    {
        switch (args[i])
        {
            case "--project" when i + 1 < args.Length: projectDir = args[++i]; break;
            default: throw new KardixException($"kardix check doesn't take '{args[i]}'.");
        }
    }

    List<(string Path, byte[] Bytes)> files = AlexFiles(ProjectFolder(projectDir));
    using Core core = Core.Load();
    using CoreProject project = core.LoadProject(files);
    using JsonDocument diagnostics = JsonDocument.Parse(project.Query("diagnostics"));
    int errors = 0;
    foreach (JsonElement d in diagnostics.RootElement.EnumerateArray())
    {
        string file = d.GetProperty("file").GetString() ?? string.Empty;
        string severity = d.GetProperty("severity").GetString() ?? "error";
        string where = file.Length == 0 ? string.Empty : $"{file}({d.GetProperty("line").GetInt32()},{d.GetProperty("column").GetInt32()}): ";
        Console.WriteLine(where + severity + ": " + d.GetProperty("message").GetString());
        if (severity == "error") { errors++; }
    }

    Console.WriteLine(errors == 0 ? $"{files.Count} files, no errors." : $"{files.Count} files, {errors} error{(errors == 1 ? "" : "s")}.");
    return errors == 0 ? 0 : 1;
}

static int Cards(string[] args)
{
    string projectDir = Directory.GetCurrentDirectory(), outDir = Path.Combine("out", "cards", "{set}");
    string? onlyFinish = null, onlySet = null, frame = null;
    HashSet<string>? only = null;
    bool bleed = false, noArt = false, drawList = false;
    for (int i = 0; i < args.Length; i++)
    {
        switch (args[i])
        {
            case "--project" when i + 1 < args.Length: projectDir = args[++i]; break;
            case "--out" when i + 1 < args.Length: outDir = args[++i]; break;
            case "--finish" when i + 1 < args.Length: onlyFinish = args[++i]; break;
            case "--set" when i + 1 < args.Length: onlySet = args[++i]; break;
            case "--frame" when i + 1 < args.Length: frame = args[++i]; break;
            case "--bleed": bleed = true; break;
            case "--no-art": noArt = true; break;
            case "--draw-list": drawList = true; break;
            case "--only":
                only = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                while (i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal)) { only.Add(args[++i]); }
                break;
            default: throw new KardixException($"kardix cards doesn't take '{args[i]}'.");
        }
    }

    string root = ProjectFolder(projectDir);
    using Core core = Core.Load();
    using CoreProject project = core.LoadProject(AlexFiles(root));
    project.Add(Fonts(root, Answer(project, "fonts").EnumerateArray().Select(f => f.GetString()!)));

    string options = (frame is null ? "" : " frame=" + frame) + (noArt ? " no-art" : "");
    List<JsonElement> faces = Answer(project, "faces " + (onlySet ?? "")).EnumerateArray()
        .Where(f => onlyFinish is null || f.GetProperty("finish").GetString() == onlyFinish)
        .Where(f => only is null || only.Contains(f.GetProperty("number").GetString()!) || only.Contains(f.GetProperty("card").GetString()!))
        .ToList();
    if (onlySet is not null && faces.Count == 0) { throw new KardixException($"No set or cards file in the game named {onlySet} has cards to draw."); }

    HashSet<string> given = new(StringComparer.Ordinal);
    foreach (JsonElement face in faces)
    {
        string set = face.GetProperty("set").GetString()!, finish = face.GetProperty("finish").GetString()!;
        string words = $"{set} {face.GetProperty("card").GetString()} {face.GetProperty("face").GetString()} {finish}{options}";
        string list = project.Query("draw " + words);
        if (list.StartsWith('{')) { throw new KardixException(JsonDocument.Parse(list).RootElement.GetProperty("error").GetString()!); }

        string folder = Path.Combine(Path.GetFullPath(outDir.Replace("{set}", set)), finish == "standard" ? "" : finish);
        Directory.CreateDirectory(folder);
        string file = Path.Combine(folder, face.GetProperty("file").GetString()!);
        if (drawList)
        {
            File.WriteAllText(file + ".txt", list);
            continue;
        }

        List<(string Path, byte[] Bytes)> pictures = new();
        foreach (string path in DrawnFiles(list).Where(given.Add))
        {
            string full = Path.Combine(root, path);
            if (File.Exists(full)) { pictures.Add((path, File.ReadAllBytes(full))); }
        }

        project.Add(pictures);
        File.WriteAllBytes(file + ".png", project.Png(words + (bleed ? " bleed" : "")));
    }

    Console.WriteLine($"Drew {faces.Count} card face(s).");
    return 0;
}

static JsonElement Answer(CoreProject project, string question)
{
    JsonElement answer = JsonDocument.Parse(project.Query(question)).RootElement;
    if (answer.ValueKind == JsonValueKind.Object && answer.TryGetProperty("error", out JsonElement error))
    {
        throw new KardixException(error.GetString()!);
    }

    return answer;
}

// The fonts the card layout names: from the project's folder, or else the system's fonts.
static List<(string Path, byte[] Bytes)> Fonts(string root, IEnumerable<string> paths)
{
    List<(string Path, byte[] Bytes)> fonts = new();
    foreach (string path in paths)
    {
        string local = Path.Combine(root, path);
        string system = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Fonts), Path.GetFileName(path));
        string found = File.Exists(local) ? local : File.Exists(system) ? system
            : throw new KardixException($"The font {path} is neither in the project nor installed.");
        fonts.Add((path, File.ReadAllBytes(found)));
    }

    return fonts;
}

// The pictures a draw list names (cardengine/engine/src/render/draw-list.md).
static IEnumerable<string> DrawnFiles(string list)
{
    foreach (string line in list.Split('\n'))
    {
        string[] words = line.Split(' ');
        if (words[0] is "image" or "tinted" && words.Length > 1) { yield return words[1]; }
        foreach (string word in words)
        {
            if (word.StartsWith("finish:", StringComparison.Ordinal)) { yield return word["finish:".Length..]; }
            if (word.StartsWith("texture:", StringComparison.Ordinal)) { yield return word["texture:".Length..]; }
        }
    }
}

namespace Kardix
{
    internal sealed class KardixException(string message) : Exception(message);
}
