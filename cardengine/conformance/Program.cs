using System.Diagnostics;
using Conformance;
using ViaMochi.Alex.Parsing;

// alex-conformance: parses every .alex file with the C# Alex and with the engine's WebAssembly module, and compares
// their canonical dumps byte for byte, in program mode and in data mode. Then times both parsers on the same files.
//
//   dotnet run -c Release [-- --wasm <file>] [--out <folder>] [--mutants <per file>] [--export <folder>] [<folder>...]
//
// Folders default to this repository and, when it is checked out beside it, mochi. Build the module first:
// cargo build --release --target wasm32-unknown-unknown (in cardengine/engine). A mismatch writes both dumps to
// --out (default out/conformance) and exits 1.

string? repository = FindRepository(AppContext.BaseDirectory);
string wasm = repository is null ? "tcg_engine.wasm" : Path.Combine(repository, "cardengine", "engine", "target", "wasm32-unknown-unknown", "release", "tcg_engine.wasm");
string outFolder = Path.Combine("out", "conformance");
int mutantsPerFile = 25;
string? exportFolder = null;
List<string> roots = new();
for (int i = 0; i < args.Length; i++)
{
    if (args[i] == "--wasm" && i + 1 < args.Length) { wasm = args[++i]; }
    else if (args[i] == "--out" && i + 1 < args.Length) { outFolder = args[++i]; }
    else if (args[i] == "--export" && i + 1 < args.Length) { exportFolder = args[++i]; }
    else if (args[i] == "--mutants" && i + 1 < args.Length) { mutantsPerFile = int.Parse(args[++i]); }
    else { roots.Add(args[i]); }
}

if (roots.Count == 0 && repository is not null)
{
    roots.Add(repository);
    string mochi = Path.GetFullPath(Path.Combine(repository, "..", "mochi"));
    if (Directory.Exists(mochi)) { roots.Add(mochi); }
}

if (!File.Exists(wasm))
{
    Console.Error.WriteLine("alex-conformance: no module at " + wasm + ". Build it: cargo build --release --target wasm32-unknown-unknown (in cardengine/engine).");
    return 2;
}

List<string> files = new();
for (int i = 0; i < roots.Count; i++) { Collect(roots[i], files); }
files.Sort(StringComparer.Ordinal);
List<byte[]> sources = new(files.Count);
long totalBytes = 0;
for (int i = 0; i < files.Count; i++)
{
    byte[] source = File.ReadAllBytes(files[i]);
    sources.Add(source);
    totalBytes += source.Length;
}

Stopwatch load = Stopwatch.StartNew();
using EngineModule module = EngineModule.Load(wasm);
load.Stop();
Console.WriteLine($"module   {new FileInfo(wasm).Length / 1024.0:F1} KB, compiled and instantiated in {load.Elapsed.TotalMilliseconds:F1} ms");
Console.WriteLine($"corpus   {files.Count} .alex files, {totalBytes / 1024.0:F1} KB, from {string.Join(", ", roots)}");

if (exportFolder is not null && repository is not null)
{
    // The C# dumps alone, named by their path in the repository, for comparing another host (a browser) with.
    Directory.CreateDirectory(exportFolder);
    for (int i = 0; i < files.Count; i++)
    {
        string relative = Path.GetRelativePath(repository, files[i]).Replace(Path.DirectorySeparatorChar.ToString(), "__", StringComparison.Ordinal);
        File.WriteAllText(Path.Combine(exportFolder, relative + ".program.txt"), CSharpDump.Dump(sources[i], AlexParseOptions.Program));
        File.WriteAllText(Path.Combine(exportFolder, relative + ".data.txt"), CSharpDump.Dump(sources[i], AlexParseOptions.Data));
    }
}

// ── conformance ──────────────────────────────────────────────────────────────────────────────────

int compared = 0;
int mismatches = 0;
int withDiagnostics = 0;
string[] modeNames = { "program", "data" };
AlexParseOptions[] modeOptions = { AlexParseOptions.Program, AlexParseOptions.Data };
for (int i = 0; i < files.Count; i++)
{
    for (int mode = 0; mode < 2; mode++)
    {
        string expected = CSharpDump.Dump(sources[i], modeOptions[mode]);
        string actual = module.Dump(sources[i], mode);
        compared++;
        if (mode == 0 && !expected.EndsWith("diagnostics\nround-trip exact\n", StringComparison.Ordinal)) { withDiagnostics++; }
        if (expected == actual) { continue; }

        mismatches++;
        string name = Path.GetFileName(files[i]) + "." + modeNames[mode];
        Directory.CreateDirectory(outFolder);
        File.WriteAllText(Path.Combine(outFolder, name + ".csharp.txt"), expected);
        File.WriteAllText(Path.Combine(outFolder, name + ".wasm.txt"), actual);
        Console.WriteLine($"DIFFERENT {files[i]} ({modeNames[mode]}): {FirstDifference(expected, actual)}");
    }
}

Console.WriteLine($"compared {compared} dumps ({files.Count} files x 2 modes; {withDiagnostics} files have diagnostics in program mode): {compared - mismatches} identical, {mismatches} different");

int mutantsCompared = 0;
int mutantMismatches = 0;
int mutantDiagnostics = 0;
for (int i = 0; i < files.Count; i++)
{
    List<byte[]> mutants = Mutants.Make(sources[i], mutantsPerFile, 7919 * i + 17);
    for (int m = 0; m < mutants.Count; m++)
    {
        for (int mode = 0; mode < 2; mode++)
        {
            string expected = CSharpDump.Dump(mutants[m], modeOptions[mode]);
            string actual = module.Dump(mutants[m], mode);
            mutantsCompared++;
            if (!expected.Contains("diagnostics\nround-trip", StringComparison.Ordinal)) { mutantDiagnostics++; }
            if (expected == actual) { continue; }

            mutantMismatches++;
            string name = Path.GetFileName(files[i]) + ".mutant" + m + "." + modeNames[mode];
            Directory.CreateDirectory(outFolder);
            File.WriteAllBytes(Path.Combine(outFolder, name + ".alex"), mutants[m]);
            File.WriteAllText(Path.Combine(outFolder, name + ".csharp.txt"), expected);
            File.WriteAllText(Path.Combine(outFolder, name + ".wasm.txt"), actual);
            if (mutantMismatches <= 20) { Console.WriteLine($"DIFFERENT {name}: {FirstDifference(expected, actual)}"); }
        }
    }
}

mismatches += mutantMismatches;
Console.WriteLine($"compared {mutantsCompared} dumps of broken copies ({mutantsPerFile} per file x 2 modes; {mutantDiagnostics} with diagnostics): {mutantsCompared - mutantMismatches} identical, {mutantMismatches} different");

// ── timing ───────────────────────────────────────────────────────────────────────────────────────

const int Rounds = 20;
for (int warm = 0; warm < 3; warm++)
{
    for (int i = 0; i < sources.Count; i++)
    {
        AlexParser.Parse(sources[i]);
        module.Check(sources[i]);
    }
}

Stopwatch csharp = Stopwatch.StartNew();
int csharpDiagnostics = 0;
for (int round = 0; round < Rounds; round++)
{
    for (int i = 0; i < sources.Count; i++) { csharpDiagnostics += AlexParser.Parse(sources[i]).Diagnostics.Count; }
}
csharp.Stop();

Stopwatch engine = Stopwatch.StartNew();
int engineDiagnostics = 0;
for (int round = 0; round < Rounds; round++)
{
    for (int i = 0; i < sources.Count; i++) { engineDiagnostics += module.Check(sources[i]); }
}
engine.Stop();

double megabytes = totalBytes * (double)Rounds / (1024 * 1024);
Console.WriteLine($"parse    C# Alex:               {csharp.Elapsed.TotalMilliseconds / Rounds:F2} ms per corpus ({megabytes / csharp.Elapsed.TotalSeconds:F1} MB/s)");
Console.WriteLine($"parse    engine via Wasmtime:   {engine.Elapsed.TotalMilliseconds / Rounds:F2} ms per corpus ({megabytes / engine.Elapsed.TotalSeconds:F1} MB/s, input copied in each time)");
if (csharpDiagnostics != engineDiagnostics)
{
    Console.WriteLine($"DIFFERENT diagnostic counts while timing: C# {csharpDiagnostics}, engine {engineDiagnostics}");
    mismatches++;
}

return mismatches == 0 ? 0 : 1;

static void Collect(string directory, List<string> files)
{
    foreach (string path in Directory.EnumerateFiles(directory, "*.alex")) { files.Add(Path.GetFullPath(path)); }
    foreach (string child in Directory.EnumerateDirectories(directory))
    {
        string name = Path.GetFileName(child);
        if (name is "node_modules" or "target" or "bin" or "obj" || name.StartsWith('.')) { continue; }
        Collect(child, files);
    }
}

static string? FindRepository(string start)
{
    DirectoryInfo? directory = new(start);
    while (directory is not null)
    {
        if (File.Exists(Path.Combine(directory.FullName, "cardengine", "engine", "Cargo.toml"))) { return directory.FullName; }
        directory = directory.Parent;
    }

    return null;
}

static string FirstDifference(string expected, string actual)
{
    string[] left = expected.Split('\n');
    string[] right = actual.Split('\n');
    int count = Math.Min(left.Length, right.Length);
    for (int i = 0; i < count; i++)
    {
        if (left[i] != right[i]) { return $"line {i + 1}: C# '{left[i].Trim()}' vs engine '{right[i].Trim()}'"; }
    }

    return $"C# has {left.Length} lines, the engine {right.Length}";
}
