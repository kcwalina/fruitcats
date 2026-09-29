using System.Globalization;
using ViaMochi.Alex.Model;

namespace Kardix;

/// <summary>One .alex file of a game project, read on its own.</summary>
internal sealed record Document(string Name, string Path, AlexDocument Alex)
{
    public string Directory => System.IO.Path.GetDirectoryName(Path)!;
    public string? DeclaredType => Alex.Root.TypeName;
}

/// <summary>
/// A game project: every .alex file under a folder. Documents are named by their file name; the folder holds one
/// Game. References (<c>@name</c>, <c>@doc.member</c>) are resolved across documents by name.
/// </summary>
internal sealed class Project
{
    // What every card has (core.alex's Card), so a face's type declares these even when the game doesn't list them.
    private static readonly HashSet<string> CardFields = new(StringComparer.Ordinal)
    {
        "name", "text", "constants", "flavor", "pronoun", "art", "cites", "keywords", "abilities", "type-name",
        "type-cites", "back",
    };

    public string Root { get; }
    public IReadOnlyDictionary<string, Document> Documents { get; }
    public Document Game { get; }
    public IReadOnlyDictionary<string, AlexRecordType> Types { get; }

    private Project(string root, Dictionary<string, Document> documents, Document game)
    {
        Root = root;
        Documents = documents;
        Game = game;
        // The core's types (Card, Set…) and the game's own.
        Types = CoreTypes.Concat(game.Alex.Types).Where(t => t.Value is AlexRecordType)
            .GroupBy(t => t.Key, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => (AlexRecordType)g.Last().Value, StringComparer.Ordinal);
    }

    public static Project Load(string root)
    {
        root = System.IO.Path.GetFullPath(root);
        Dictionary<string, Document> documents = new(StringComparer.Ordinal);
        foreach (string path in System.IO.Directory.EnumerateFiles(root, "*.alex", SearchOption.AllDirectories))
        {
            string relative = System.IO.Path.GetRelativePath(root, path);
            if (relative.Split(System.IO.Path.DirectorySeparatorChar).Any(p => p is "node_modules" or "bin" or "obj" or ".git"))
            {
                continue;
            }

            byte[] bytes = File.ReadAllBytes(path);
            // Rules documents hold programs; printing doesn't read them.
            if (FirstDirective(bytes) == "Rules") { continue; }

            AlexDocument alex = AlexDocument.Parse(bytes, new AlexBindOptions
            {
                SourceName = System.IO.Path.GetFileName(path),
                Accept = AlexAccept.Any,
                Schemas = FirstDirective(bytes) == "Game" ? CoreSchema : null,
            });
            string name = System.IO.Path.GetFileNameWithoutExtension(path);
            if (documents.ContainsKey(name))
            {
                throw new KardixException($"Two files are named {name}.alex; a document's name is its file name, so it must be unique.");
            }

            documents[name] = new Document(name, path, alex);
        }

        Document[] games = documents.Values.Where(d => d.DeclaredType == "Game").ToArray();
        if (games.Length == 0) { throw new KardixException($"No file in {root} is a Game (#type Game)."); }
        if (games.Length > 1)
        {
            throw new KardixException("A project holds exactly one Game; these are all Games: "
                + string.Join(", ", games.Select(g => System.IO.Path.GetRelativePath(root, g.Path))));
        }

        return new Project(root, documents, games[0]);
    }

    private static readonly IReadOnlyList<AlexSource> CoreSchema = LoadCore();

    private static readonly IReadOnlyDictionary<string, AlexType> CoreTypes =
        AlexDocument.Parse(CoreSchema[0].Bytes.ToArray(), new AlexBindOptions { SourceName = "core.alex", Accept = AlexAccept.Any }).Types;

    private static IReadOnlyList<AlexSource> LoadCore()
    {
        using Stream stream = typeof(Project).Assembly.GetManifestResourceStream("core.alex")
            ?? throw new KardixException("kardix is missing its core schema (core.alex).");
        using MemoryStream copy = new();
        stream.CopyTo(copy);
        return new[] { new AlexSource("core.alex", copy.ToArray()) };
    }

    private static string? FirstDirective(byte[] bytes)
    {
        using StringReader reader = new(System.Text.Encoding.UTF8.GetString(bytes));
        for (string? line = reader.ReadLine(); line is not null; line = reader.ReadLine())
        {
            string t = line.Trim();
            if (t.Length == 0 || t.StartsWith("//", StringComparison.Ordinal)) { continue; }
            return t.StartsWith("#type ", StringComparison.Ordinal) ? t[6..].Trim() : null;
        }

        return null;
    }

    /// <summary>The documents whose cards are in the game: the Game's <c>sets</c>, and every Cards document.</summary>
    public IEnumerable<Document> CardDocuments()
    {
        HashSet<string> seen = new(StringComparer.Ordinal);
        if (Game.Alex.Root.Value("sets") is AlexArray sets)
        {
            foreach (AlexValue set in sets)
            {
                if (Resolve(set, Game) is { Owner: var owner, Value: AlexObject } && owner is not null && seen.Add(owner.Name))
                {
                    yield return owner;
                }
            }
        }

        foreach (Document d in Documents.Values.Where(d => d.DeclaredType == "Cards"))
        {
            if (d.Alex.Root.Value("draft") is AlexBoolean { Value: true }) { continue; }
            if (seen.Add(d.Name)) { yield return d; }
        }
    }

    /// <summary>A value with the document it was written in, so a path in it resolves against that file.</summary>
    public readonly record struct Located(AlexValue? Value, Document? Owner, string? Key = null);

    /// <summary>Follows references to the value they name.</summary>
    public Located Resolve(AlexValue? value, Document from)
    {
        for (int guard = 0; guard < 16 && value is AlexReference reference; guard++)
        {
            Located found = Lookup(reference.Path, from);
            if (found.Value is null)
            {
                throw new KardixException($"{from.Name}.alex: nothing is named @{reference.Name}.");
            }

            (value, from) = (found.Value, found.Owner!);
            if (value is not AlexReference) { return found; }
        }

        return new Located(value, from);
    }

    private Located Lookup(IReadOnlyList<string> path, Document from)
    {
        // @doc, @doc.member, or an unqualified @member: this document first, then the Game, then any document.
        if (Documents.TryGetValue(path[0], out Document? doc))
        {
            Located root = new(doc.Alex.Root, doc, doc.Name);
            return path.Count == 1 ? root : Member(root, path.Skip(1).ToArray());
        }

        foreach (Document d in new[] { from, Game }.Concat(Documents.Values))
        {
            Located found = Named(d, path[0]);
            if (found.Value is not null)
            {
                return path.Count == 1 ? found : Member(found, path.Skip(1).ToArray());
            }
        }

        return default;
    }

    /// <summary>A named member of a document: a text table, a root field, or an entry of a root map.</summary>
    private static Located Named(Document d, string name)
    {
        if (d.Alex.Texts.TryGetValue(name, out AlexText? text)) { return new Located(text, d, name); }
        foreach (AlexProperty field in d.Alex.Root)
        {
            if (field.Value is AlexObject { IsMap: true } map && map.Value(name) is { } entry)
            {
                return new Located(entry, d, name);
            }
        }

        return default;
    }

    private static Located Member(Located start, IReadOnlyList<string> path)
    {
        Located current = start;
        foreach (string part in path)
        {
            if (current.Value is AlexObject obj && obj.Value(part) is { } next)
            {
                current = new Located(next, current.Owner, part);
                continue;
            }

            if (current.Value is AlexObject root && current.Owner is { } owner && ReferenceEquals(root, owner.Alex.Root))
            {
                Located named = Named(owner, part);
                if (named.Value is not null) { current = named; continue; }
            }

            return default;
        }

        return current;
    }

    /// <summary>
    /// A field a set (or cards file) gives for all its cards: one of its own that its document type doesn't declare,
    /// like a Folkborn set's <c>family</c>. Its cards have it unless they give their own.
    /// </summary>
    public AlexValue? SetWide(Document document, string field)
    {
        if (document.DeclaredType is not { } type || !Types.ContainsKey(type)) { return null; }
        return TypeChain(type).Any(t => t.OwnFields.Any(f => f.Name == field)) ? null : document.Alex.Root.Value(field);
    }

    /// <summary>A declared record type and its bases, nearest first.</summary>
    public IEnumerable<AlexRecordType> TypeChain(string? name)
    {
        for (AlexRecordType? t = name is null ? null : Types.GetValueOrDefault(name); t is not null; t = t.Base)
        {
            yield return t;
        }
    }

    /// <summary>Whether a card of this type has a field, by its type's declarations or because every card has it.</summary>
    public bool Declares(string? typeName, string field) =>
        CardFields.Contains(field) || TypeChain(typeName).Any(t => t.OwnFields.Any(f => f.Name == field));

    /// <summary>A field's value fixed by the type, or its declared default.</summary>
    public AlexValue? TypeValue(string? typeName, string field)
    {
        foreach (AlexRecordType t in TypeChain(typeName))
        {
            if (t.OwnFixedFields.TryGetValue(field, out AlexValue? fixedValue)) { return fixedValue; }
            if (t.OwnFields.FirstOrDefault(f => f.Name == field)?.Default is { } defaultValue) { return defaultValue; }
        }

        return null;
    }

    /// <summary>The display name of a type: its fixed <c>type-name</c>, or its identifier.</summary>
    public string DisplayName(string typeName) =>
        TypeValue(typeName, "type-name") is AlexTextual text ? text.Value : typeName;

    public static string Scalar(AlexValue? value) => value switch
    {
        null or AlexNic or AlexEmpty => "",
        AlexTextual t => t.Value,
        AlexInteger i => i.Value.ToString(CultureInfo.InvariantCulture),
        AlexFloat f => f.Value.ToString(CultureInfo.InvariantCulture),
        AlexBoolean b => b.Value ? "true" : "false",
        AlexEnumValue e => e.Member,
        AlexIdentifier id => id.Name,
        AlexReference r => r.Name,
        AlexTypeValue t => t.Name,
        _ => value.ToString() ?? "",
    };
}

internal sealed class KardixException(string message) : Exception(message);
