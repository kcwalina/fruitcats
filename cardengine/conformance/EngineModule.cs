using System.Text;
using Wasmtime;

namespace Conformance;

/// <summary>
/// The engine's WebAssembly module, run in this process through Wasmtime: how a C# host (kardix.exe, a server) calls
/// the core. The module's interface is plain functions over bytes in its own memory (<c>cardengine/engine/src/abi.rs</c>).
/// </summary>
internal sealed class EngineModule : IDisposable
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

    private EngineModule(Engine engine, Module module, Store store, Instance instance)
    {
        _engine = engine;
        _module = module;
        _store = store;
        _memory = instance.GetMemory("memory") ?? throw new InvalidOperationException("The module exports no memory.");
        _alloc = instance.GetFunction<int, int>("kardix_alloc") ?? throw Missing("kardix_alloc");
        _free = instance.GetAction<int, int>("kardix_free") ?? throw Missing("kardix_free");
        _dump = instance.GetFunction<int, int, int, long>("alex_dump") ?? throw Missing("alex_dump");
        _check = instance.GetFunction<int, int, int>("alex_check") ?? throw Missing("alex_check");
        _bindDump = instance.GetFunction<int, int, long>("alex_bind_dump") ?? throw Missing("alex_bind_dump");
    }

    /// <summary>Compiles and instantiates the module at <paramref name="path"/>.</summary>
    public static EngineModule Load(string path)
    {
        Engine engine = new();
        Module module = Module.FromFile(engine, path);
        Store store = new(engine);
        Linker linker = new(engine);
        Instance instance = linker.Instantiate(store, module);
        return new EngineModule(engine, module, store, instance);
    }

    /// <summary>The canonical dump of <paramref name="source"/>: mode 0 for a program document, 1 for a data one.</summary>
    public string Dump(byte[] source, int mode)
    {
        int input = CopyIn(source);
        long result = _dump(input, source.Length, mode);
        _free(input, source.Length);
        return Encoding.UTF8.GetString(TakeResult(result));
    }

    /// <summary>Parses <paramref name="source"/> and returns how many diagnostics it has.</summary>
    public int Check(byte[] source)
    {
        int input = CopyIn(source);
        int count = _check(input, source.Length);
        _free(input, source.Length);
        return count;
    }

    /// <summary>The canonical dump of <paramref name="sources"/> bound together (<c>alex_bind_dump</c>).</summary>
    public string BindDump(IReadOnlyList<BoundDump.Source> sources, bool kinds, string? game = null)
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
            foreach (BoundDump.Source source in sources)
            {
                byte[] name = Encoding.UTF8.GetBytes(source.Name);
                writer.Write((uint)source.Role);
                writer.Write((uint)name.Length);
                writer.Write(name);
                writer.Write((uint)source.Bytes.Length);
                writer.Write(source.Bytes);
            }
        }

        byte[] bytes = input.ToArray();
        int address = CopyIn(bytes);
        long result = _bindDump(address, bytes.Length);
        _free(address, bytes.Length);
        return Encoding.UTF8.GetString(TakeResult(result));
    }

    private int CopyIn(byte[] source)
    {
        int address = _alloc(source.Length);
        source.CopyTo(_memory.GetSpan(address, source.Length));
        return address;
    }

    /// <summary>Copies a result out of the module's memory and frees it there.</summary>
    private byte[] TakeResult(long packed)
    {
        int address = (int)((ulong)packed >> 32);
        int length = (int)(packed & 0xFFFFFFFF);
        byte[] bytes = _memory.GetSpan(address, length).ToArray();
        _free(address, length);
        return bytes;
    }

    private static InvalidOperationException Missing(string name) => new("The module exports no function '" + name + "'.");

    public void Dispose()
    {
        _store.Dispose();
        _module.Dispose();
        _engine.Dispose();
    }
}
