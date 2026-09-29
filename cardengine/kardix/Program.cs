using SkiaSharp;
using Kardix;
using ViaMochi.Alex.Model;

// kardix: the Kardix platform's command-line tool.
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
//   kardix cards [--project <folder>] [--set <name>] [--out <folder>] [--finish <name>] [--only <number>...] [--frame <name>] [--no-art] [--png] [--bleed] [--draw-list]
//
// Renders every card face of the project, in each finish it's printed in, into --out (default out/cards/{set}):
// a folder relative to where kardix runs, where {set} is the name of the file the cards are written in. Finishes
// other than standard go into a subfolder. --frame draws every card in the layout's frame of that name; --no-art
// leaves the pictures see-through (the art's window and a frame's texture), for a tool that shows an artist's
// picture under the card.
try
{
    if (args.Length == 0 || args[0] is "-h" or "--help" or "help")
    {
        Console.WriteLine("kardix check [--project <folder>]");
        Console.WriteLine("kardix studio [--project <folder>] [--port <number>] [--no-open]");
        Console.WriteLine("kardix cards [--project <folder>] [--set <name>] [--out <folder>] [--finish <name>] [--only <number>...] [--frame <name>] [--no-art] [--png] [--bleed] [--draw-list]");
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

    string root = Path.GetFullPath(projectDir);
    if (!Directory.Exists(root)) { throw new KardixException($"There is no folder {projectDir}."); }
    List<(string Path, byte[] Bytes)> files = new();
    foreach (string path in Directory.EnumerateFiles(root, "*.alex", SearchOption.AllDirectories))
    {
        string relative = Path.GetRelativePath(root, path);
        if (relative.Split(Path.DirectorySeparatorChar).Any(p => p is "node_modules" or "bin" or "obj" or ".git")) { continue; }
        files.Add((relative.Replace(Path.DirectorySeparatorChar, '/'), File.ReadAllBytes(path)));
    }

    files.Sort((a, b) => string.CompareOrdinal(a.Path, b.Path));
    using Core core = Core.Load();
    using CoreProject project = core.LoadProject(files);
    using System.Text.Json.JsonDocument diagnostics = System.Text.Json.JsonDocument.Parse(project.Query("diagnostics"));
    int errors = 0;
    foreach (System.Text.Json.JsonElement d in diagnostics.RootElement.EnumerateArray())
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
    string? onlyFinish = null, onlySet = null;
    HashSet<string>? only = null;
    string? frame = null;
    bool png = false, bleed = false, noArt = false, drawList = false;
    for (int i = 0; i < args.Length; i++)
    {
        switch (args[i])
        {
            case "--project": projectDir = args[++i]; break;
            case "--out": outDir = args[++i]; break;
            case "--finish": onlyFinish = args[++i]; break;
            case "--set": onlySet = args[++i]; break;
            case "--png": png = true; break;
            case "--bleed": bleed = true; break;
            case "--frame": frame = args[++i]; break;
            case "--no-art": noArt = true; break;
            case "--draw-list": drawList = true; break;
            case "--only":
                only = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                while (i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal)) { only.Add(args[++i]); }
                break;
            default: throw new KardixException($"kardix cards doesn't take '{args[i]}'.");
        }
    }

    Project project = Project.Load(projectDir);
    Renderer renderer = new(project) { FrameOverride = frame, NoArt = noArt };
    int written = 0;
    List<Document> documents = project.CardDocuments().Where(d => onlySet is null || d.Name == onlySet).ToList();
    // A set the game doesn't list (a prototype) is rendered only when asked for by name.
    if (onlySet is not null && documents.Count == 0 && project.Documents.TryGetValue(onlySet, out Document? unlisted)
        && project.TypeChain(unlisted.DeclaredType).Any(t => t.Name is "Set" or "Cards"))
    {
        documents.Add(unlisted);
    }

    if (onlySet is not null && documents.Count == 0) { throw new KardixException($"No set or cards file in the game is named {onlySet}."); }
    foreach (Document document in documents)
    {
        if (document.Alex.Root.Value("cards") is not AlexObject cards) { continue; }
        foreach (AlexProperty entry in cards)
        {
            if (entry.Value is not AlexObject card) { continue; }
            string number = Project.Scalar(card.Value("number"));
            if (only is not null && !only.Contains(number) && !only.Contains(entry.Name)) { continue; }
            foreach (string finish in Face.Finishes(project, card))
            {
                if (onlyFinish is not null && finish != onlyFinish) { continue; }
                List<Face> faces = new() { new Face(project, document, entry.Name, card, card, isBack: false, finish) };
                if (card.Value("back") is AlexObject back) { faces.Add(new Face(project, document, entry.Name, card, back, isBack: true, finish)); }
                foreach (Face face in faces)
                {
                    string folder = Path.Combine(Path.GetFullPath(outDir.Replace("{set}", document.Name)), finish == "standard" ? "" : finish);
                    Directory.CreateDirectory(folder);
                    if (drawList)
                    {
                        File.WriteAllText(Path.Combine(folder, renderer.FileName(face) + ".txt"), renderer.DrawListOf(face));
                        written++;
                        continue;
                    }

                    using SKImage image = renderer.Render(face, bleed);
                    string path = Path.Combine(folder, renderer.FileName(face) + (png ? ".png" : ".webp"));
                    using SKData data = image.Encode(png ? SKEncodedImageFormat.Png : SKEncodedImageFormat.Webp, png ? 100 : 90);
                    File.WriteAllBytes(path, data.ToArray());
                    written++;
                }
            }
        }
    }

    Console.WriteLine($"Rendered {written} card face(s).");
    return 0;
}
