using System.Globalization;
using System.Text;
using SkiaSharp;

namespace Kardix;

/// <summary>
/// What the renderer drew, in the core's draw list format (<c>cardengine/engine/src/render/draw.rs</c>), so the core's
/// layout can be compared with SkiaSharp's (<c>kardix cards --draw-list</c>). Lengths are in 1/64 pixel; one that isn't a
/// whole number of them is written with a <c>~</c>, which no core draw list has.
/// </summary>
internal sealed class DrawList
{
    private readonly StringBuilder _out = new();
    private readonly string _root;

    public DrawList(string root, int width, int height, int bleed)
    {
        _root = root;
        _out.Append("kardix draw list 1\n").Append(CultureInfo.InvariantCulture, $"card {width} {height} bleed {bleed}\n");
    }

    public static string Q(float px)
    {
        double q = (double)px * 64;
        return q == Math.Floor(q) ? ((long)q).ToString(CultureInfo.InvariantCulture) : "~" + q.ToString("0.###", CultureInfo.InvariantCulture);
    }

    private static string Rect(SKRect r) => $"{Q(r.Left)} {Q(r.Top)} {Q(r.Width)} {Q(r.Height)}";

    public static string Color(SKColor c) => $"#{c.Alpha:X2}{c.Red:X2}{c.Green:X2}{c.Blue:X2}";

    public string Path(string full) => System.IO.Path.GetRelativePath(_root, full).Replace('\\', '/');

    public void Rect(SKRect r, float rx, float ry, string paint, bool smooth) =>
        _out.Append($"rect {Rect(r)} radius {Q(rx)} {Q(ry)} {paint}{(smooth ? " smooth" : "")}\n");

    public void Ring(SKRect outer, float orx, float ory, SKRect inner, float irx, float iry, string paint) =>
        _out.Append($"ring {Rect(outer)} radius {Q(orx)} {Q(ory)} inner {Rect(inner)} radius {Q(irx)} {Q(iry)} {paint}\n");

    public void Stroke(SKRect r, float rx, float ry, float width, string paint) =>
        _out.Append($"stroke {Rect(r)} radius {Q(rx)} {Q(ry)} width {Q(width)} {paint}\n");

    public void Star(SKRect r, string paint) => _out.Append($"star {Rect(r)} {paint}\n");

    public void Line(float x1, float y1, float x2, float y2, float width, string paint) =>
        _out.Append($"line {Q(x1)} {Q(y1)} {Q(x2)} {Q(y2)} width {Q(width)} {paint}\n");

    public void Image(string full, string fit, SKRect r, float radius) =>
        _out.Append($"image {Path(full)} {fit} {Rect(r)}{(radius > 0 ? " radius " + Q(radius) : "")}\n");

    public void ImageAt(string full, float x, float y) => _out.Append($"image {Path(full)} natural {Q(x)} {Q(y)}\n");

    public void Tinted(string full, SKRect r, string paint) => _out.Append($"tinted {Path(full)} {Rect(r)} {paint}\n");

    public void Text(string font, float size, SKColor fill, SKColor outline, float outlineWidth, ushort[] glyphs, SKPoint[] points)
    {
        if (glyphs.Length == 0) { return; }
        _out.Append($"text {font} {size.ToString(CultureInfo.InvariantCulture)} {Color(fill)}");
        if (outline != SKColors.Empty && outlineWidth > 0) { _out.Append($" outline {Color(outline)} {Q(outlineWidth * 2)}"); }
        for (int i = 0; i < glyphs.Length; i++) { _out.Append($" {glyphs[i]}@{Q(points[i].X)},{Q(points[i].Y)}"); }
        _out.Append('\n');
    }

    public override string ToString() => _out.ToString();
}
