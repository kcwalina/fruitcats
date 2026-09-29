using SkiaSharp;
using Tcg;
using ViaMochi.Alex.Model;

// tcg: the TCG developer platform's command-line tool.
//
//   tcg cards [--project <folder>] [--set <name>] [--out <folder>] [--finish <name>] [--only <number>...] [--png] [--bleed]
//
// Renders every card face of the project, in each finish it's printed in. A card's images go into --out
// (default out/cards) beside the file the card is written in; finishes other than standard into a subfolder.
try
{
    if (args.Length == 0 || args[0] is "-h" or "--help" or "help")
    {
        Console.WriteLine("tcg cards [--project <folder>] [--set <name>] [--out <folder>] [--finish <name>] [--only <number>...] [--png] [--bleed]");
        return 0;
    }

    return args[0] switch
    {
        "cards" => Cards(args[1..]),
        _ => throw new TcgException($"tcg doesn't know the command '{args[0]}'. Try: tcg cards"),
    };
}
catch (TcgException e)
{
    Console.Error.WriteLine("tcg: " + e.Message);
    return 1;
}

static int Cards(string[] args)
{
    string projectDir = Directory.GetCurrentDirectory(), outDir = Path.Combine("out", "cards");
    string? onlyFinish = null, onlySet = null;
    HashSet<string>? only = null;
    bool png = false, bleed = false;
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
            case "--only":
                only = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                while (i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal)) { only.Add(args[++i]); }
                break;
            default: throw new TcgException($"tcg cards doesn't take '{args[i]}'.");
        }
    }

    Project project = Project.Load(projectDir);
    Renderer renderer = new(project);
    int written = 0;
    List<Document> documents = project.CardDocuments().Where(d => onlySet is null || d.Name == onlySet).ToList();
    if (onlySet is not null && documents.Count == 0) { throw new TcgException($"No set or cards file in the game is named {onlySet}."); }
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
                    using SKImage image = renderer.Render(face, bleed);
                    string folder = Path.Combine(document.Directory, outDir, finish == "standard" ? "" : finish);
                    Directory.CreateDirectory(folder);
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
