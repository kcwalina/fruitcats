using System.Text.Json;
using System.Text.Json.Nodes;
using ViaMochi.Alex.Model;

// alex-json --schema <file>... -- <file>...: each file as the C# Alex reads it on its own, bound with the schemas (the
// framework's core and libraries, so a type's base can be the core's Card), as one JSON array: one entry per file. What the schema fills
// in (defaults, fixed fields) is left out, and so are the schema's own types: this is what the file itself says.
int split = Array.IndexOf(args, "--");
if (args.Length == 0 || args[0] != "--schema" || split < 0) { Console.Error.WriteLine("alex-json --schema <file>... -- <file>..."); return 1; }
AlexSource[] schema = args[1..split].Select(f => new AlexSource(Path.GetFileName(f), File.ReadAllBytes(f))).ToArray();
// A schema file is read on its own, with no schema.
AlexBindOptions Options(string path) => new()
{
    SourceName = Path.GetFileName(path), Accept = AlexAccept.Any, CheckRootName = false,
    Schemas = args[1..split].Any(s => Path.GetFullPath(s) == Path.GetFullPath(path)) ? null : schema,
};
HashSet<string> schemaTypes = AlexDocument.Parse(Array.Empty<byte>(), Options("empty.alex")).Types.Keys.ToHashSet(StringComparer.Ordinal);

JsonArray all = new();
foreach (string path in args[(split + 1)..])
{
    AlexDocument doc = AlexDocument.Parse(File.ReadAllBytes(path), Options(path));
    bool own = Options(path).Schemas is null;
    JsonObject types = new();
    foreach ((string name, AlexType type) in doc.Types.Where(t => own || !schemaTypes.Contains(t.Key)).OrderBy(t => t.Key, StringComparer.Ordinal))
    {
        types[name] = type switch
        {
            AlexRecordType r => new JsonObject
            {
                ["record"] = r.Base?.Name,
                ["fields"] = new JsonArray(r.OwnFields.Select(f => (JsonNode?)f.Name).ToArray()),
                ["fixed"] = new JsonArray(r.OwnFixedFields.Keys.Select(f => (JsonNode?)f).ToArray()),
            },
            AlexEnumType e => new JsonObject { ["enum"] = new JsonArray(e.Members.Select(m => (JsonNode?)m).ToArray()) },
            _ => new JsonObject { ["alias"] = true },
        };
    }

    all.Add(new JsonObject
    {
        ["file"] = path,
        ["type"] = doc.Root.TypeName,
        ["root"] = Value(doc.Root),
        ["texts"] = new JsonArray(doc.Texts.Select(t => (JsonNode?)new JsonArray(t.Key, Value(t.Value))).ToArray()),
        ["types"] = types,
    });
}

Console.OutputEncoding = System.Text.Encoding.UTF8;
Console.WriteLine(all.ToJsonString(new JsonSerializerOptions { WriteIndented = false }));
return 0;

static JsonNode? Value(AlexValue? value) => value switch
{
    null or AlexNic => null,
    AlexBoolean b => b.Value,
    AlexInteger i => i.Value,
    AlexFloat f => new JsonObject { ["float"] = f.Value },
    AlexText t => new JsonObject { ["table"] = t.Value },
    AlexString s => s.Value,
    AlexEmpty => new JsonObject { ["empty"] = true },
    AlexEnumValue e => new JsonObject { ["enum"] = e.Member },
    AlexReference r => new JsonObject { ["ref"] = r.Name },
    AlexArray a => new JsonArray(a.Select(Value).ToArray()),
    AlexObject o => new JsonObject
    {
        [o.IsMap ? "map" : "record"] = o.IsMap ? null : o.TypeName,
        ["entries"] = new JsonArray(o.Where(p => !p.IsDefault).Select(p => (JsonNode?)new JsonArray(p.Name, Value(p.Value))).ToArray()),
    },
    _ => new JsonObject { ["unreadable"] = value.GetType().Name },
};
