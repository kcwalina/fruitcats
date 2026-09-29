using ViaMochi.Alex.Model;

namespace Kardix;

/// <summary>
/// One printed face of a card, in one finish. A card has one face, or two when it has a <c>back</c>. A back face
/// shows its own fields, and the front's for any field its type doesn't declare (number, rarity, family). A field
/// the card doesn't give comes from its set, when the set gives it as a field of its own (see <see cref="Project.SetWide"/>).
/// </summary>
internal sealed class Face
{
    public Face(Project project, Document document, string key, AlexObject card, AlexObject values, bool isBack, string finish)
    {
        Project = project;
        Document = document;
        Key = key;
        Card = card;
        Values = values;
        IsBack = isBack;
        Finish = finish;
    }

    public Project Project { get; }
    public Document Document { get; }
    public string Key { get; }
    public AlexObject Card { get; }
    public AlexObject Values { get; }
    public bool IsBack { get; }
    public string Finish { get; }
    public string TypeName => Values.TypeName ?? "Card";

    /// <summary>The finishes a card is printed in: its own list, or its type's.</summary>
    public static IReadOnlyList<string> Finishes(Project project, AlexObject card)
    {
        AlexValue? value = card.Value("finishes") ?? project.TypeValue(card.TypeName, "finishes");
        return value is AlexArray list && list.Count > 0 ? list.Select(Project.Scalar).ToArray() : new[] { "standard" };
    }

    /// <summary>A field of this face, with the document it came from.</summary>
    public Project.Located Field(string name)
    {
        if (Values.Value(name) is { } own) { return new Project.Located(own, Document, name); }
        if (Project.TypeValue(TypeName, name) is { } typed) { return new Project.Located(typed, Project.Game, name); }
        if (IsBack && !Project.Declares(TypeName, name))
        {
            if (Card.Value(name) is { } front) { return new Project.Located(front, Document, name); }
            if (Project.TypeValue(Card.TypeName, name) is { } frontTyped) { return new Project.Located(frontTyped, Project.Game, name); }
        }

        if (Project.SetWide(Document, name) is { } setWide) { return new Project.Located(setWide, Document, name); }
        return default;
    }

    public bool Has(string name) => Field(name).Value is not (null or AlexNic or AlexEmpty);

    /// <summary>A dotted path from this face: <c>cost</c>, <c>family.dark</c>, <c>set.name</c>, <c>type</c>, <c>finish</c>.</summary>
    public Project.Located Path(string path)
    {
        string[] parts = path.Split('.');
        Project.Located current = parts[0] switch
        {
            "type" => new Project.Located(Str(Project.DisplayName(TypeName)), Project.Game),
            "finish" => new Project.Located(Str(Finish), Project.Game),
            "set" => new Project.Located(Document.Alex.Root, Document, Document.Name),
            _ => Field(parts[0]),
        };

        foreach (string part in parts.Skip(1))
        {
            Project.Located resolved = current.Owner is null ? current : Project.Resolve(current.Value, current.Owner);
            if (resolved.Value is AlexObject obj)
            {
                if (obj.Value(part) is { } next)
                {
                    current = Project.Resolve(next, resolved.Owner!);
                    continue;
                }

                // A record under a key takes its name from the key.
                if (part == "name" && (resolved.Key ?? current.Key) is { } key)
                {
                    current = new Project.Located(Str(key), resolved.Owner);
                    continue;
                }
            }

            return default;
        }

        return current.Owner is null ? current : Project.Resolve(current.Value, current.Owner) is var r && r.Value is null ? current : r with { Key = r.Key ?? current.Key };
    }

    /// <summary>A path as text. A record shows as its key (<c>{family}</c> is <c>domowiki</c>).</summary>
    public string Text(string path)
    {
        Project.Located found = Path(path);
        if (found.Value is AlexObject) { return found.Key ?? ""; }
        string text = Project.Scalar(found.Value);
        return path == "text" || path == "flavor" ? FillConstants(text) : text;
    }

    /// <summary>A template: <c>'{type} · {family.name}'</c>. Empty when every placeholder in it is empty.</summary>
    public string Template(AlexValue? template)
    {
        if (template is not AlexTextual textual) { return Project.Scalar(template); }
        bool any = false, placeholders = false;
        string result = textual.Render(path =>
        {
            placeholders = true;
            string value = Text(path);
            any |= value.Length > 0;
            return value;
        });
        return placeholders && !any ? "" : result;
    }

    /// <summary>A card's own <c>{name}</c> constants filled into its text.</summary>
    private string FillConstants(string text)
    {
        if (!text.Contains('{') || Field("constants").Value is not AlexObject constants) { return text; }
        return Templates.Render(text, name => constants.Value(name) is { } v ? Project.Scalar(v) : null);
    }

    /// <summary>The asset a template names, as a full path: relative to the file the path was written in.</summary>
    public string? AssetPath(AlexValue? template, Document layout)
    {
        if (template is not AlexTextual textual) { return null; }
        string raw = textual.Value.Trim();
        if (raw.StartsWith('{') && raw.EndsWith('}') && raw.IndexOf('}') == raw.Length - 1)
        {
            Project.Located found = Path(raw[1..^1]);
            string value = Project.Scalar(found.Value);
            return value.Length == 0 ? null : System.IO.Path.GetFullPath(value, (found.Owner ?? Document).Directory);
        }

        string text = Template(template);
        return text.Length == 0 ? null : System.IO.Path.GetFullPath(text, layout.Directory);
    }

    private static AlexString Str(string text) => new(System.Text.Encoding.UTF8.GetBytes(text), text, default, default);

    public bool HasKeyword(string keyword)
    {
        if (Field("keywords").Value is not AlexArray list) { return false; }
        foreach (AlexValue item in list)
        {
            AlexValue value = item is AlexObject applied && applied.Value("keyword") is { } inner ? inner : item;
            if (value is AlexReference reference && reference.Path[^1] == keyword) { return true; }
        }

        return false;
    }
}

/// <summary>Placeholder filling for card text and paths.</summary>
internal static class Templates
{
    public static string Render(string template, Func<string, string?> resolve)
    {
        System.Text.StringBuilder result = new();
        for (int i = 0; i < template.Length; i++)
        {
            int close;
            if (template[i] == '{' && (close = template.IndexOf('}', i + 1)) > i + 1)
            {
                string name = template[(i + 1)..close];
                if (name.All(c => char.IsLetterOrDigit(c) || c is '-' or '.' or '_') && resolve(name) is { } value)
                {
                    result.Append(value);
                    i = close;
                    continue;
                }
            }

            result.Append(template[i]);
        }

        return result.ToString();
    }
}
