using System.Net;
using System.Text;
using System.Text.Json;

namespace Kardix;

/// <summary>
/// <c>kardix studio</c>: the local host for Studio. An HTTP server on localhost, and nothing else, that serves the page
/// from inside kardix, the project's files (list, read, write: the workspace protocol), and a push channel (server-sent
/// events) that says when a file changed on disk, fed by a <see cref="FileSystemWatcher"/>. The page loads the core
/// itself and reads the project in the browser, so the server knows nothing about games.
/// </summary>
internal sealed class Studio
{
    private static readonly HashSet<string> Skipped = new(StringComparer.OrdinalIgnoreCase) { "bin", "obj", "node_modules", ".git", "out" };

    private readonly string _root;
    private readonly List<HttpListenerResponse> _listeners = new();
    private readonly object _gate = new();
    private System.Threading.Timer? _pending;

    private Studio(string root) => _root = root;

    public static int Run(string[] args)
    {
        string projectDir = Directory.GetCurrentDirectory();
        int port = 4180;
        bool open = true;
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--project" when i + 1 < args.Length: projectDir = args[++i]; break;
                case "--port" when i + 1 < args.Length: port = int.Parse(args[++i], System.Globalization.CultureInfo.InvariantCulture); break;
                case "--no-open": open = false; break;
                default: throw new KardixException($"kardix studio doesn't take '{args[i]}'.");
            }
        }

        string root = Path.GetFullPath(projectDir);
        if (!Directory.Exists(root)) { throw new KardixException($"There is no folder {projectDir}."); }
        return new Studio(root).Serve(port, open);
    }

    private int Serve(int port, bool open)
    {
        using HttpListener listener = new();
        string address = $"http://localhost:{port}/";
        listener.Prefixes.Add(address);
        try
        {
            listener.Start();
        }
        catch (HttpListenerException e)
        {
            throw new KardixException($"Studio couldn't listen on {address} ({e.Message}). Try another port: kardix studio --port 4181");
        }

        using FileSystemWatcher watcher = new(_root) { IncludeSubdirectories = true, NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size };
        watcher.Changed += (_, e) => Changed(e.FullPath);
        watcher.Created += (_, e) => Changed(e.FullPath);
        watcher.Deleted += (_, e) => Changed(e.FullPath);
        watcher.Renamed += (_, e) => Changed(e.FullPath);
        watcher.EnableRaisingEvents = true;

        Console.WriteLine($"Studio for {_root} is at {address} (Ctrl+C stops it).");
        if (open) { OpenBrowser(address); }

        while (listener.IsListening)
        {
            HttpListenerContext context;
            try { context = listener.GetContext(); }
            catch (HttpListenerException) { break; }
            _ = Task.Run(() => Handle(context));
        }

        return 0;
    }

    private void Handle(HttpListenerContext context)
    {
        HttpListenerRequest request = context.Request;
        HttpListenerResponse response = context.Response;
        try
        {
            string path = request.Url?.AbsolutePath ?? "/";
            switch (path)
            {
                case "/":
                case "/index.html":
                    Send(response, "text/html; charset=utf-8", Resource("studio.html"));
                    return;
                case "/studio.js":
                    Send(response, "text/javascript; charset=utf-8", Resource("studio.js"));
                    return;
                case "/kardix.wasm":
                    Send(response, "application/wasm", Resource("kardix.wasm"));
                    return;
                case "/api/files":
                    Send(response, "application/json", Encoding.UTF8.GetBytes(FileList()));
                    return;
                case "/api/file":
                    File(request, response);
                    return;
                case "/api/events":
                    Events(response);
                    return;
                default:
                    Fail(response, 404, "There is nothing at " + path + ".");
                    return;
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or HttpListenerException or ObjectDisposedException)
        {
            try { Fail(response, 500, e.Message); } catch (Exception) { /* the page went away */ }
        }
    }

    /// <summary>Every file of the project, with its size and when it last changed: the workspace's list.</summary>
    private string FileList()
    {
        List<object> files = new();
        foreach (string file in Directory.EnumerateFiles(_root, "*", SearchOption.AllDirectories))
        {
            string relative = Path.GetRelativePath(_root, file);
            if (relative.Split(Path.DirectorySeparatorChar).Any(Skipped.Contains)) { continue; }
            FileInfo info = new(file);
            files.Add(new { path = relative.Replace(Path.DirectorySeparatorChar, '/'), size = info.Length, modified = info.LastWriteTimeUtc.ToString("O") });
        }

        return JsonSerializer.Serialize(new { root = Path.GetFileName(_root), files });
    }

    /// <summary>GET reads a file of the project; PUT writes one. Nothing outside the project's folder.</summary>
    private void File(HttpListenerRequest request, HttpListenerResponse response)
    {
        string? relative = request.QueryString["path"];
        string? full = relative is null ? null : Inside(relative);
        if (full is null)
        {
            Fail(response, 400, "Name a file of the project: /api/file?path=cards.alex");
            return;
        }

        if (request.HttpMethod == "PUT")
        {
            using MemoryStream body = new();
            request.InputStream.CopyTo(body);
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            System.IO.File.WriteAllBytes(full, body.ToArray());
            Send(response, "application/json", Encoding.UTF8.GetBytes("{\"written\":true}"));
            return;
        }

        if (!System.IO.File.Exists(full))
        {
            Fail(response, 404, "The project has no file " + relative + ".");
            return;
        }

        Send(response, ContentType(full), System.IO.File.ReadAllBytes(full));
    }

    /// <summary>The full path of <paramref name="relative"/> when it is inside the project, or null.</summary>
    private string? Inside(string relative)
    {
        string full = Path.GetFullPath(Path.Combine(_root, relative.Replace('/', Path.DirectorySeparatorChar)));
        string root = _root.EndsWith(Path.DirectorySeparatorChar) ? _root : _root + Path.DirectorySeparatorChar;
        return full.StartsWith(root, StringComparison.OrdinalIgnoreCase) ? full : null;
    }

    /// <summary>The push channel: an event each time files change, a moment after the last change, so a save is one event.</summary>
    private void Events(HttpListenerResponse response)
    {
        response.ContentType = "text/event-stream";
        response.Headers["Cache-Control"] = "no-cache";
        response.SendChunked = true;
        byte[] hello = Encoding.UTF8.GetBytes("retry: 1000\n\n");
        response.OutputStream.Write(hello);
        response.OutputStream.Flush();
        lock (_gate) { _listeners.Add(response); }
    }

    private void Changed(string fullPath)
    {
        string relative = Path.GetRelativePath(_root, fullPath);
        if (relative.Split(Path.DirectorySeparatorChar).Any(Skipped.Contains)) { return; }
        lock (_gate)
        {
            _pending?.Dispose();
            _pending = new System.Threading.Timer(_ => Push(), null, 60, Timeout.Infinite);
        }
    }

    private void Push()
    {
        byte[] message = Encoding.UTF8.GetBytes("data: changed\n\n");
        lock (_gate)
        {
            for (int i = _listeners.Count - 1; i >= 0; i--)
            {
                try
                {
                    _listeners[i].OutputStream.Write(message);
                    _listeners[i].OutputStream.Flush();
                }
                catch (Exception e) when (e is IOException or HttpListenerException or ObjectDisposedException)
                {
                    _listeners.RemoveAt(i);
                }
            }
        }
    }

    private static void Send(HttpListenerResponse response, string contentType, byte[] body)
    {
        response.ContentType = contentType;
        response.Headers["Cache-Control"] = "no-store";
        response.ContentLength64 = body.Length;
        response.OutputStream.Write(body);
        response.Close();
    }

    private static void Fail(HttpListenerResponse response, int status, string message)
    {
        response.StatusCode = status;
        Send(response, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(message));
    }

    private static byte[] Resource(string name)
    {
        using Stream stream = typeof(Studio).Assembly.GetManifestResourceStream(name)
            ?? throw new KardixException("kardix is missing its Studio page (" + name + ").");
        using MemoryStream bytes = new();
        stream.CopyTo(bytes);
        return bytes.ToArray();
    }

    private static string ContentType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".alex" or ".md" or ".txt" => "text/plain; charset=utf-8",
        ".webp" => "image/webp",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".svg" => "image/svg+xml",
        ".json" => "application/json",
        ".ttf" => "font/ttf",
        ".otf" => "font/otf",
        _ => "application/octet-stream",
    };

    private static void OpenBrowser(string address)
    {
        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(address) { UseShellExecute = true }); }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException) { Console.WriteLine("Open " + address + " in your browser."); }
    }
}
