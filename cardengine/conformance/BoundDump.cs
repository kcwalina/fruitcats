using System.Globalization;
using System.Text;
using ViaMochi.Alex.Model;

namespace Conformance;

/// <summary>
/// The canonical dump of documents bound together by the C# Alex: for each document and schema, its types, its value
/// with every reference resolved, its texts, what each statement set, its declarations and its diagnostics. The engine
/// prints exactly the same format (<c>cardengine/engine/src/alex/bound_dump.rs</c>), so the two binders are compared
/// byte for byte.
/// </summary>
/// <remarks>
/// <para>A value is written out where it is declared, and every record, map and list is numbered in the order it is
/// first written (<c>#3</c>); a reference is written as what it names, by that number, so shared and cyclic values are
/// written once. Diagnostics are ordered by start, then
/// length, then message, so the order never depends on how either side sorts.</para>
/// <para>Floats are written as their bits, so neither side's number formatting matters.</para>
/// </remarks>
internal sealed class BoundDump
{
    private readonly StringBuilder _out = new();
    private readonly Dictionary<AlexValue, int> _ids = new(ReferenceEqualityComparer.Instance);
    private int _depth;

    /// <summary>One source to bind: its file name, bytes, and how it is read.</summary>
    internal sealed record Source(string Name, byte[] Bytes, SourceRole Role);

    internal enum SourceRole { Schema = 0, Data = 1, Any = 2 }

    /// <summary>The libraries of the card-engine framework, in dependency order, as mochi's tests list them.</summary>
    internal static readonly string[] Libraries =
    {
        "common", "units", "abilities", "attachments", "combat", "decks", "families", "heroes", "initiative", "life",
        "life-stack", "objects", "permanents", "resources", "responses", "scheduling", "setup", "spells", "turns",
        "board", "dice", "encounter", "objectives", "reveal", "scenarios", "stat-cards",
    };

    /// <summary>Binds <paramref name="sources"/> together and dumps the result. <paramref name="game"/>: null for a host that
    /// registers the card engine's kinds of declaration and nothing else (or no kinds, when <paramref name="kinds"/> is
    /// false); otherwise the card engine's host for that game, which checks bodies and the card game's rules.</summary>
    public static string Dump(IReadOnlyList<Source> sources, bool kinds, string? game = null)
    {
        List<AlexSource> documents = new();
        List<AlexSource> schemas = new();
        foreach (Source source in sources)
        {
            if (source.Role == SourceRole.Schema) { schemas.Add(new AlexSource(source.Name, source.Bytes)); }
            else { documents.Add(new AlexSource(source.Name, source.Bytes) { Accept = source.Role == SourceRole.Any ? AlexAccept.Any : AlexAccept.Data }); }
        }

        AlexHost host = game is not null ? new Alex.Tests.CardEngineHost(game, Libraries) : kinds ? KindsHost.Instance : AlexHost.None;
        AlexCompilation compilation = AlexCompilation.Bind(documents, schemas, host);
        BoundDump dump = new();

        // The first pass numbers every record, map and list; the second writes, with references to those numbers.
        for (int pass = 0; pass < 2; pass++)
        {
            dump._out.Clear();
            foreach (AlexDocument schema in compilation.Schemas) { dump.Document("schema", schema); }
            foreach (AlexDocument document in compilation.Documents) { dump.Document("document", document); }
        }

        return dump._out.ToString();
    }

    /// <summary>The input of the core's <c>alex_bind_dump</c> for the same binding (<c>cardengine/engine/src/abi.rs</c>).</summary>
    public static byte[] CoreInput(IReadOnlyList<Source> sources, bool kinds, string? game)
    {
        using MemoryStream input = new();
        using (BinaryWriter writer = new(input, Encoding.UTF8, leaveOpen: true))
        {
            writer.Write(game is not null ? 2u : kinds ? 1u : 0u);
            if (game is not null)
            {
                byte[] gameName = Encoding.UTF8.GetBytes(game);
                writer.Write((uint)gameName.Length);
                writer.Write(gameName);
            }

            writer.Write((uint)sources.Count);
            foreach (Source source in sources)
            {
                byte[] name = Encoding.UTF8.GetBytes(source.Name);
                writer.Write((uint)source.Role);
                writer.Write((uint)name.Length);
                writer.Write(name);
                writer.Write((uint)source.Bytes.Length);
                writer.Write(source.Bytes);
            }
        }

        return input.ToArray();
    }

    private sealed class KindsHost : AlexHost
    {
        public static readonly KindsHost Instance = new();

        private static readonly Dictionary<string, AlexBodyShape> Kinds = new(StringComparer.Ordinal)
        {
            ["effect"] = AlexBodyShape.Statements,
            ["static"] = AlexBodyShape.Statements,
            ["condition"] = AlexBodyShape.Expression,
            ["scenario"] = AlexBodyShape.Scenario,
        };

        private static readonly Dictionary<string, string> Routines = new(StringComparer.Ordinal)
        {
            [""] = "effect",
            ["bool"] = "condition",
        };

        public override IReadOnlyDictionary<string, AlexBodyShape> DeclarationKinds => Kinds;

        public override IReadOnlyDictionary<string, string> RoutineKinds => Routines;
    }

    private void Document(string role, AlexDocument document)
    {
        Line(role + " " + document.SourceName);
        _depth++;
        Line("name " + (document.Name ?? "-"));
        Line("mode " + (document.Mode == ViaMochi.Alex.Parsing.AlexParseMode.Program ? "program" : "data"));

        Line("types");
        _depth++;
        List<string> names = new(document.Types.Keys);
        names.Sort(StringComparer.Ordinal);
        foreach (string name in names) { Type(name, document.Types[name]); }
        _depth--;

        Line("root");
        _depth++;
        Value(document.Root);
        _depth--;

        Line("texts");
        _depth++;
        List<string> texts = new(document.Texts.Keys);
        texts.Sort(StringComparer.Ordinal);
        foreach (string name in texts)
        {
            Line(name);
            _depth++;
            Value(document.Texts[name]);
            _depth--;
        }

        _depth--;

        Line("assignments");
        _depth++;
        foreach (AlexAssignment assignment in document.Assignments) { Line(string.Join('.', assignment.Path)); }
        _depth--;

        Line("declarations");
        _depth++;
        foreach (AlexDeclaration declaration in document.Declarations)
        {
            Line(declaration.Kind + " " + declaration + " " + declaration.Span.Start + "+" + declaration.Span.Length);
            _depth++;
            foreach (AlexRoutineParameter parameter in declaration.Parameters) { Line("parameter " + parameter.Name + ": " + parameter.Type); }
            foreach (AlexAttachment attachment in declaration.Attachments) { Line("attached " + attachment + " on " + Shown(attachment.Target)); }
            _depth--;
        }

        _depth--;

        Line("diagnostics");
        _depth++;
        List<AlexDiagnostic> diagnostics = new(document.Diagnostics);
        diagnostics.Sort(static (left, right) =>
        {
            int order = left.Span.Start.CompareTo(right.Span.Start);
            if (order == 0) { order = left.Span.Length.CompareTo(right.Span.Length); }
            if (order == 0) { order = CompareBytes(left.Message, right.Message); }
            return order;
        });
        foreach (AlexDiagnostic diagnostic in diagnostics)
        {
            Line((diagnostic.Severity == AlexSeverity.Error ? "error " : "warning ") + diagnostic.Span.Start + "+" + diagnostic.Span.Length + " " + diagnostic.Message);
        }

        _depth--;
        _depth--;
    }

    private void Type(string name, AlexType type)
    {
        switch (type)
        {
            case AlexRecordType record:
                Line("record " + name + (record.Base is { } baseType ? " : " + baseType.Name : string.Empty) + (record.AssertsData ? " asserts-data" : string.Empty));
                _depth++;
                foreach (AlexRecordField field in record.OwnFields) { Field("field", field); }
                foreach (AlexRecordField member in record.OwnExtensionMembers) { Field("member", member); }
                List<string> fixedNames = new(record.OwnFixedFields.Keys);
                fixedNames.Sort(StringComparer.Ordinal);
                foreach (string fixedName in fixedNames)
                {
                    Line("fixed " + fixedName);
                    _depth++;
                    Value(record.OwnFixedFields[fixedName]);
                    _depth--;
                }

                if (record.MappedOnto.Count > 0)
                {
                    List<string> views = new();
                    foreach (AlexRecordType view in record.MappedOnto) { views.Add(view.Name); }
                    Line("mapped-onto " + string.Join(", ", views));
                }

                _depth--;
                break;

            case AlexEnumType enumType:
                Line("enum " + name + " { " + string.Join(", ", enumType.Members) + " }");
                break;

            case AlexAliasType alias:
                Line("alias " + name + " = " + (alias.Target?.ToString() ?? "-"));
                break;

            default:
                Line("other " + name + " " + type);
                break;
        }
    }

    private void Field(string what, AlexRecordField field)
    {
        Line(what + " " + field.Name + ": " + field.Type + (field.IsRequired ? " required" : string.Empty));
        if (field.Default is null) { return; }
        _depth++;
        Line("default");
        _depth++;
        Value(field.Default);
        _depth -= 2;
    }

    private void Value(AlexValue value)
    {
        switch (value)
        {
            case AlexObject obj:
                Line((obj.IsMap ? "map" : "record " + (obj.TypeName ?? "-") + " as " + (obj.RecordType?.Name ?? "-")) + " " + Id(obj) + " " + Span(obj));
                _depth++;
                foreach (AlexProperty property in obj)
                {
                    Line((property.IsDefault ? "default " : string.Empty) + property.Name);
                    _depth++;
                    Value(property.Value);
                    _depth--;
                }

                List<string> members = new(obj.Extensions.Keys);
                members.Sort(StringComparer.Ordinal);
                foreach (string member in members) { Line("extension " + member + " = " + Shown(obj.Extensions[member])); }
                _depth--;
                break;

            case AlexArray array:
                Line("list " + Id(array) + " " + Span(array));
                _depth++;
                foreach (AlexValue item in array) { Value(item); }
                _depth--;
                break;

            default:
                Line(Shown(value) + " " + Span(value));
                break;
        }
    }

    private string Id(AlexValue value)
    {
        if (!_ids.TryGetValue(value, out int id))
        {
            id = _ids.Count + 1;
            _ids[value] = id;
        }

        return "#" + id;
    }

    /// <summary>A value on one line: a scalar as itself, a record, map or list by its number, a reference as what it names.</summary>
    private string Shown(AlexValue? value) => value switch
    {
        null => "unresolved",
        AlexNic => "nic",
        AlexInvalid => "invalid",
        AlexBoolean boolean => boolean.Value ? "true" : "false",
        AlexInteger integer => "int " + integer.Value.ToString(CultureInfo.InvariantCulture),
        AlexFloat real => "float " + BitConverter.DoubleToInt64Bits(real.Value).ToString("x16", CultureInfo.InvariantCulture),
        AlexEmpty => "empty",
        AlexEnumValue member => "enum " + member.Member + " of " + (member.Type?.Name ?? "-"),
        AlexText text => "table " + Quoted(text.Value),
        AlexString text => "string " + Quoted(text.Value),
        AlexReference reference => "ref @" + reference.Name + " -> " + Shown(reference.Target),
        AlexTypeValue named => "type @" + named.Name,
        AlexDeclaration declaration => "declaration " + declaration.Kind + " " + declaration,
        AlexObject or AlexArray => _ids.TryGetValue(value, out int id) ? "#" + id : "unwritten " + Span(value),
        _ => "other",
    };

    private static string Span(AlexValue value) => value.Span.Start + "+" + value.Span.Length;

    private static string Quoted(string text)
    {
        StringBuilder quoted = new("'");
        foreach (char c in text)
        {
            quoted.Append(c switch
            {
                '\\' => "\\\\",
                '\'' => "\\'",
                '\n' => "\\n",
                '\r' => "\\r",
                '\t' => "\\t",
                _ => c.ToString(),
            });
        }

        return quoted.Append('\'').ToString();
    }

    private static int CompareBytes(string left, string right)
    {
        byte[] a = Encoding.UTF8.GetBytes(left);
        byte[] b = Encoding.UTF8.GetBytes(right);
        return a.AsSpan().SequenceCompareTo(b);
    }

    private void Line(string text)
    {
        _out.Append(' ', _depth * 2).Append(text).Append('\n');
    }
}
