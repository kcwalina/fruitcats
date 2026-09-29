using System.Text;
using Wasmtime;

namespace Kardix;

/// <summary>
/// The core (<c>cardengine/engine</c>), the one WebAssembly module every host runs, run in this process through Wasmtime.
/// kardix carries it inside itself (built by <c>Kardix.csproj</c> from the Rust source). The module's interface is plain
/// functions over bytes in its own memory (<c>cardengine/engine/src/abi.rs</c>); this copies bytes in and out.
/// </summary>
public sealed class Core : IDisposable
{
    private readonly Engine _engine;
    private readonly Module _module;
    private readonly Store _store;
    private readonly Memory _memory;
    private readonly Func<int, int> _alloc;
    private readonly Action<int, int> _free;
    private readonly Func<int, int, int, long> _dump;
    private readonly Func<int, int, int> _check;
    private readonly Func<int, int, long> _bindDump;
    private readonly Func<int, int, int> _projectLoad;
    private readonly Func<int, int, int, long> _projectQuery;
    private readonly Action<int> _projectFree;

    private Core(Engine engine, Module module)
    {
        _engine = engine;
        _module = module;
        _store = new Store(engine);
        Instance instance = new Linker(engine).Instantiate(_store, module);
        _memory = instance.GetMemory("memory") ?? throw new InvalidOperationException("The core exports no memory.");
        _alloc = instance.GetFunction<int, int>("kardix_alloc") ?? throw Missing("kardix_alloc");
        _free = instance.GetAction<int, int>("kardix_free") ?? throw Missing("kardix_free");
        _dump = instance.GetFunction<int, int, int, long>("alex_dump") ?? throw Missing("alex_dump");
        _check = instance.GetFunction<int, int, int>("alex_check") ?? throw Missing("alex_check");
        _bindDump = instance.GetFunction<int, int, long>("alex_bind_dump") ?? throw Missing("alex_bind_dump");
        _projectLoad = instance.GetFunction<int, int, int>("project_load") ?? throw Missing("project_load");
        _projectQuery = instance.GetFunction<int, int, int, long>("project_query") ?? throw Missing("project_query");
        _projectFree = instance.GetAction<int>("project_free") ?? throw Missing("project_free");
    }

    /// <summary>The core kardix carries.</summary>
    public static Core Load()
    {
        using Stream stream = System.Reflection.Assembly.GetExecutingAssembly().GetManifestResourceStream("kardix.wasm")
            ?? throw new InvalidOperationException("kardix is missing its core (kardix.wasm).");
        using MemoryStream bytes = new();
        stream.CopyTo(bytes);
        Engine engine = new();
        return new Core(engine, Module.FromBytes(engine, "kardix", bytes.ToArray()));
    }

    /// <summary>A core from a file: another build of the module.</summary>
    public static Core Load(string path)
    {
        Engine engine = new();
        return new Core(engine, Module.FromFile(engine, path));
    }

    /// <summary>The canonical dump of a parse: mode 0 for a program document, 1 for a data one.</summary>
    public string Dump(byte[] source, int mode)
    {
        int input = CopyIn(source);
        long result = _dump(input, source.Length, mode);
        _free(input, source.Length);
        return Encoding.UTF8.GetString(TakeResult(result));
    }

    /// <summary>Parses a file and returns how many diagnostics it has.</summary>
    public int Check(byte[] source)
    {
        int input = CopyIn(source);
        int count = _check(input, source.Length);
        _free(input, source.Length);
        return count;
    }

    /// <summary>The canonical dump of sources bound together; <paramref name="input"/> is <c>alex_bind_dump</c>'s.</summary>
    public string BindDump(byte[] input)
    {
        int address = CopyIn(input);
        long result = _bindDump(address, input.Length);
        _free(address, input.Length);
        return Encoding.UTF8.GetString(TakeResult(result));
    }

    /// <summary>Loads a project from its files: each one's path within the project's folder, and its bytes.</summary>
    public CoreProject LoadProject(IReadOnlyList<(string Path, byte[] Bytes)> files)
    {
        using MemoryStream input = new();
        using (BinaryWriter writer = new(input, Encoding.UTF8, leaveOpen: true))
        {
            writer.Write((uint)files.Count);
            foreach ((string path, byte[] bytes) in files)
            {
                byte[] name = Encoding.UTF8.GetBytes(path);
                writer.Write((uint)name.Length);
                writer.Write(name);
                writer.Write((uint)bytes.Length);
                writer.Write(bytes);
            }
        }

        byte[] all = input.ToArray();
        int address = CopyIn(all);
        int handle = _projectLoad(address, all.Length);
        _free(address, all.Length);
        return new CoreProject(this, handle);
    }

    internal string Query(int handle, string question)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(question);
        int address = CopyIn(bytes);
        long result = _projectQuery(handle, address, bytes.Length);
        _free(address, bytes.Length);
        return Encoding.UTF8.GetString(TakeResult(result));
    }

    internal void Free(int handle) => _projectFree(handle);

    private int CopyIn(byte[] source)
    {
        int address = _alloc(source.Length);
        source.CopyTo(_memory.GetSpan(address, source.Length));
        return address;
    }

    /// <summary>A result is one u64: the buffer's address in the high 32 bits, its length in the low 32.</summary>
    private byte[] TakeResult(long packed)
    {
        int address = (int)((ulong)packed >> 32);
        int length = (int)(packed & 0xFFFFFFFF);
        byte[] bytes = _memory.GetSpan(address, length).ToArray();
        _free(address, length);
        return bytes;
    }

    private static InvalidOperationException Missing(string name) => new("The core exports no function '" + name + "'.");

    public void Dispose()
    {
        _store.Dispose();
        _module.Dispose();
        _engine.Dispose();
    }
}

/// <summary>A project the core loaded: ask it questions (<c>cardengine/engine/src/loader/queries.rs</c>), then dispose it.</summary>
public sealed class CoreProject : IDisposable
{
    private readonly Core _core;
    private readonly int _handle;

    internal CoreProject(Core core, int handle)
    {
        _core = core;
        _handle = handle;
    }

    /// <summary>The answer to <paramref name="question"/>, as JSON: <c>diagnostics</c>, <c>documents</c>, <c>cards</c>, or
    /// <c>value &lt;document&gt;</c>.</summary>
    public string Query(string question) => _core.Query(_handle, question);

    public void Dispose() => _core.Free(_handle);
}
