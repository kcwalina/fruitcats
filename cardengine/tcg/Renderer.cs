using System.Text.RegularExpressions;
using SkiaSharp;
using ViaMochi.Alex.Model;

namespace Tcg;

/// <summary>Draws card faces from a CardLayout document: the frame, then the parts, in the order the layout lists them.</summary>
internal sealed class Renderer
{
    private readonly Project _project;
    private readonly Document _layout;
    private readonly AlexObject _root;
    private readonly Dictionary<string, SKTypeface> _fonts = new(StringComparer.Ordinal);
    private readonly Dictionary<string, SKImage?> _images = new(StringComparer.OrdinalIgnoreCase);

    public Renderer(Project project)
    {
        _project = project;
        Project.Located layout = project.Resolve(project.Game.Alex.Root.Value("card-layout"), project.Game);
        if (layout.Value is not AlexObject root || layout.Owner is null)
        {
            throw new TcgException("The Game names no card-layout, so tcg doesn't know how its cards look.");
        }

        _layout = layout.Owner;
        _root = root;
        Text.WholePixels = Project.Scalar(root.Value("text-spacing")) == "whole-pixels";
        Width = Int(root.Value("width"), 750);
        Height = Int(root.Value("height"), 1050);
        Bleed = Int(root.Value("bleed"), 0);
    }

    public int Width { get; }
    public int Height { get; }
    public int Bleed { get; }

    /// <summary>The frame every card is drawn in (<c>tcg cards --frame</c>), instead of its own.</summary>
    public string? FrameOverride { get; init; }

    /// <summary>
    /// Pictures left see-through (<c>tcg cards --no-art</c>): a card's own picture (a Picture showing one of its fields,
    /// like <c>{art}</c>) and a frame's texture are holes, for a tool that shows an artist's picture under the card.
    /// </summary>
    public bool NoArt { get; init; }

    /// <summary>
    /// The frame entry for a face: the one <see cref="FrameOverride"/> or the card's <c>frame</c> field names, or else
    /// its type's, or its nearest base type's.
    /// </summary>
    public AlexObject? Frame(Face face)
    {
        if (_root.Value("frames") is not AlexObject frames) { return null; }
        if ((FrameOverride ?? face.Text("frame")) is { Length: > 0 } named)
        {
            return frames.Value(named) as AlexObject ?? throw new TcgException($"{face.Key}: the card layout has no frame named {named}.");
        }

        return ByType(face, frames) as AlexObject;
    }

    private AlexValue? ByType(Face face, AlexObject map)
    {
        foreach (string type in new[] { face.TypeName }.Concat(_project.TypeChain(face.TypeName).Skip(1).Select(t => t.Name)))
        {
            if (map.Value(type) is { } value) { return value; }
        }

        return null;
    }

    /// <summary>A face's file name: the layout's <c>file-names</c> for its type, or its number.</summary>
    public string FileName(Face face) =>
        _root.Value("file-names") is AlexObject names && ByType(face, names) is { } file ? face.Template(file)
        : face.Text("number") is { Length: > 0 } n ? n : face.Key;

    /// <summary>The face as an image: the trimmed card, or with its bleed.</summary>
    public SKImage Render(Face face, bool withBleed)
    {
        int pad = withBleed ? Bleed : 0;
        SKImageInfo info = new(Width + 2 * pad, Height + 2 * pad, SKColorType.Rgba8888, SKAlphaType.Premul);
        using SKSurface surface = SKSurface.Create(info);
        SKCanvas canvas = surface.Canvas;
        canvas.Clear(SKColors.Transparent);
        canvas.Translate(pad, pad);
        AlexObject? frame = Frame(face);
        AlexObject parts = _root.Value("parts") as AlexObject ?? throw new TcgException("The card layout has no parts.");

        foreach (AlexProperty part in parts)
        {
            if (part.Value is AlexObject p && Bool(p.Value("under-frame"))) { Draw(canvas, face, frame, p); }
        }

        if (frame is not null && face.AssetPath(frame.Value("image"), _layout) is { } framePath)
        {
            SKImage image = Image(framePath) ?? throw new TcgException($"The frame {framePath} doesn't exist.");
            // A frame is drawn with its bleed around the card; the card's corner is at (0, 0).
            canvas.DrawImage(image, -Bleed, -Bleed);
        }

        foreach (AlexProperty part in parts)
        {
            if (part.Value is AlexObject p && !Bool(p.Value("under-frame"))) { Draw(canvas, face, frame, p); }
        }

        return surface.Snapshot();
    }

    private void Draw(SKCanvas canvas, Face face, AlexObject? frame, AlexObject part)
    {
        if (part.Value("if-keyword") is AlexReference keyword && !face.HasKeyword(keyword.Path[^1])) { return; }
        if (part.Value("only-types") is AlexArray types)
        {
            if (types.Any(t => t is AlexInvalid))
            {
                throw new TcgException("card-layout.alex: only-types names card types as references: [@Hero, @Awakened].");
            }

            if (!types.Any(t => IsType(face, Project.Scalar(t)))) { return; }
        }
        if (Bool(part.Value("only-with-finish")) && face.Finish == "standard") { return; }
        if (Bool(part.Value("only-without-finish")) && face.Finish != "standard") { return; }
        if (Bool(part.Value("only-with-frame-texture")) && !HasFrameTexture(face, frame)) { return; }
        if (part.Value("if") is { } shown && face.Template(shown).Length == 0) { return; }
        if (part.Value("unless") is { } hidden && face.Template(hidden).Length > 0) { return; }
        switch (part.TypeName)
        {
            case "Shape": Shape(canvas, face, frame, part); break;
            case "Picture": Picture(canvas, face, part); break;
            case "Label": Label(canvas, face, frame, part, Box(part)); break;
            case "Title": Title(canvas, face, frame, part); break;
            case "Row": Row(canvas, face, frame, part); break;
            case "TextBox": TextBox(canvas, face, frame, part); break;
            case "Chip": Chip(canvas, face, frame, part); break;
            case "Icon": Icon(canvas, face, part, Box(part)); break;
            default: throw new TcgException($"card-layout.alex: tcg doesn't know how to draw a {part.TypeName}.");
        }
    }

    private void Picture(SKCanvas canvas, Face face, AlexObject part)
    {
        SKRect box = Box(part);
        float corner = Float(part.Value("corner-radius"), 0);
        if (NoArt && part.Value("show") is AlexTextual { Value: var shown } && shown.TrimStart().StartsWith('{'))
        {
            using SKPaint hole = new() { IsAntialias = false, BlendMode = SKBlendMode.Clear };
            canvas.DrawRoundRect(new SKRoundRect(box, corner, corner), hole);
            return;
        }

        if (face.AssetPath(part.Value("show"), _layout) is not { } path) { return; }
        SKImage image = Image(path) ?? throw new TcgException($"{face.Key}: the picture {path} doesn't exist.");
        SKRect source = new(0, 0, image.Width, image.Height);
        if (Word(part.Value("fit")) != "contain")
        {
            float scale = Math.Max(box.Width / image.Width, box.Height / image.Height);
            float w = box.Width / scale, h = box.Height / scale;
            source = SKRect.Create((image.Width - w) / 2, (image.Height - h) / 2, w, h);
        }

        int saved = canvas.Save();
        if (corner > 0)
        {
            canvas.ClipRoundRect(new SKRoundRect(box, corner), antialias: false);
        }

        canvas.DrawImage(image, source, box, new SKSamplingOptions(SKCubicResampler.CatmullRom));
        canvas.RestoreToCount(saved);
    }

    private bool IsType(Face face, string type) =>
        face.TypeName == type || _project.TypeChain(face.TypeName).Any(t => t.Name == type);

    /// <summary>
    /// A rectangle (rounded with <c>radius</c>), a circle or a star: filled, outlined, or both. An outline is drawn
    /// inside the box, <c>outline-width</c> wide. With <c>chrome = true</c>, a card printed in a finish has the shape's
    /// fill (or, when it has one, its outline, <c>chrome-width</c> wide) painted with the finish's texture instead.
    /// With <c>frame-texture = true</c>, a frame with a <c>texture</c> paints the shape's fill and outline (again
    /// <c>chrome-width</c> wide) with it, where no finish does. Edges are hard, as the old composer drew them.
    /// </summary>
    private void Shape(SKCanvas canvas, Face face, AlexObject? frame, AlexObject part)
    {
        SKRect box = Box(part);
        string kind = Word(part.Value("kind")) ?? "rounded-rect";
        float radius = Float(part.Value("radius"), 0);
        SKShader? finish = Bool(part.Value("chrome")) ? FinishTexture(face) : null;
        bool hasOutline = part.Value("outline") is not null;
        SKShader? texture = Bool(part.Value("frame-texture")) ? FrameTexture(face, frame) : null;
        SKShader? chrome = finish ?? texture;
        float outlineWidth = Float(part.Value("outline-width"), 1);

        if (kind == "star")
        {
            using SKPaint paint = new() { IsAntialias = false, Color = Color(face, frame, part.Value("fill"), SKColors.Black) };
            canvas.DrawPath(Star(box), paint);
            return;
        }

        if (part.Value("fill") is { } fillValue)
        {
            using SKPaint fill = new() { IsAntialias = false, Color = Color(face, frame, fillValue, SKColors.Black) };
            if (finish is not null && !hasOutline) { fill.Shader = finish; }
            else if (texture is not null) { Textured(fill, texture); }
            canvas.DrawRoundRect(Rounded(box, kind, radius), fill);
        }

        if (hasOutline)
        {
            float width = chrome is null ? outlineWidth : Float(part.Value("chrome-width"), outlineWidth);
            using SKPaint ring = new() { IsAntialias = false, Color = Color(face, frame, part.Value("outline"), SKColors.Black) };
            if (finish is not null) { ring.Shader = finish; }
            else if (texture is not null) { Textured(ring, texture); }
            SKRect inner = SKRect.Inflate(box, -width, -width);
            using SKPath path = new() { FillType = SKPathFillType.EvenOdd };
            path.AddRoundRect(Rounded(box, kind, radius));
            path.AddRoundRect(Rounded(inner, kind, Math.Max(radius - width, 0)));
            canvas.DrawPath(path, ring);
        }
    }

    private static SKRoundRect Rounded(SKRect box, string kind, float radius) =>
        kind == "circle" ? new SKRoundRect(box, box.Width / 2, box.Height / 2) : new SKRoundRect(box, radius, radius);

    /// <summary>A five-pointed star filling the box's circle, point up, its inner points at 45% of the radius.</summary>
    private static SKPath Star(SKRect box)
    {
        SKPath path = new();
        float r = box.Width / 2;
        for (int i = 0; i < 10; i++)
        {
            float radius = i % 2 == 0 ? r : r * 0.45f;
            double angle = Math.PI / 2 + i * Math.PI / 5;
            SKPoint point = new(box.MidX + radius * (float)Math.Cos(angle), box.MidY - radius * (float)Math.Sin(angle));
            if (i == 0) { path.MoveTo(point); } else { path.LineTo(point); }
        }

        path.Close();
        return path;
    }

    /// <summary>A texture replaces what's under it; a see-through one (<see cref="NoArt"/>) leaves a hole.</summary>
    private static void Textured(SKPaint paint, SKShader texture)
    {
        paint.Shader = texture;
        paint.BlendMode = SKBlendMode.Src;
    }

    private bool HasFrameTexture(Face face, AlexObject? frame) =>
        frame?.Value("texture") is { } texture && (NoArt || face.AssetPath(texture, _layout) is not null);

    /// <summary>
    /// The frame's <c>texture</c>: an image (like an artist's own picture for the frame) covering the card, centred,
    /// its overflow cut off. See-through with <see cref="NoArt"/>.
    /// </summary>
    private SKShader? FrameTexture(Face face, AlexObject? frame)
    {
        if (!HasFrameTexture(face, frame)) { return null; }
        if (NoArt) { return SKShader.CreateColor(SKColors.Transparent); }
        string path = face.AssetPath(frame!.Value("texture"), _layout)!;
        SKImage image = Image(path) ?? throw new TcgException($"{face.Key}: the frame's texture {path} doesn't exist.");
        float scale = Math.Max((float)Width / image.Width, (float)Height / image.Height);
        SKMatrix place = SKMatrix.CreateScale(scale, scale)
            .PostConcat(SKMatrix.CreateTranslation((Width - image.Width * scale) / 2, (Height - image.Height * scale) / 2));
        return SKShader.CreateImage(image, SKShaderTileMode.Clamp, SKShaderTileMode.Clamp, new SKSamplingOptions(SKCubicResampler.CatmullRom), place);
    }

    /// <summary>The texture of the card's finish (the layout's <c>finishes</c>), card-sized; none for a standard card.</summary>
    private SKShader? FinishTexture(Face face)
    {
        if (face.Finish == "standard" || _root.Value("finishes") is not AlexObject finishes || finishes.Value(face.Finish) is not AlexObject finish)
        {
            return null;
        }

        string file = Project.Scalar(finish.Value("texture"));
        SKImage image = Image(Path.GetFullPath(file, _layout.Directory)) ?? throw new TcgException($"The texture {file} doesn't exist.");
        return SKShader.CreateImage(image, SKShaderTileMode.Clamp, SKShaderTileMode.Clamp);
    }

    private void Icon(SKCanvas canvas, Face face, AlexObject part, SKRect box)
    {
        string key = face.Template(part.Value("show"));
        if (key.Length == 0 || part.Value("images") is not AlexObject images || images.Value(key) is not AlexTextual file) { return; }
        SKImage image = Image(Path.GetFullPath(file.Value, _layout.Directory)) ?? throw new TcgException($"The icon {file.Value} doesn't exist.");
        canvas.DrawImage(image, box, new SKSamplingOptions(SKCubicResampler.CatmullRom));
    }

    private void Label(SKCanvas canvas, Face face, AlexObject? frame, AlexObject part, SKRect box)
    {
        string text = face.Template(part.Value("show"));
        if (text.Length == 0) { return; }
        if (Bool(part.Value("capitals"))) { text = text.ToUpperInvariant(); }
        SKFont font = Font(part, "font", Need(part, "size"));
        string align = Word(part.Value("align")) ?? "left";
        float x = align switch { "center" => box.MidX, "right" => box.Right, _ => box.Left };
        Text.Draw(canvas, text, font, x, box.MidY, align, Middle: true, Color(face, frame, part.Value("color"), SKColors.Black),
            Color(face, frame, part.Value("outline"), SKColors.Empty), Float(part.Value("outline-width"), 1));
    }

    private void Title(SKCanvas canvas, Face face, AlexObject? frame, AlexObject part)
    {
        string title = face.Template(part.Value("show"));
        if (title.Length == 0) { return; }
        string subtitle = face.Template(part.Value("subtitle"));
        SKRect box = Box(part);
        float size = Need(part, "size"), smallest = Float(part.Value("smallest"), size);
        SKFont font = Font(part, "font", size);
        while (Text.Width(title, font) > box.Width && font.Size > smallest) { font = Font(part, "font", font.Size - 2); }
        SKColor color = Color(face, frame, part.Value("color"), SKColors.White);
        SKColor outline = Color(face, frame, part.Value("outline"), SKColors.Empty);
        float outlineWidth = Float(part.Value("outline-width"), 1);
        if (subtitle.Length == 0)
        {
            Text.Draw(canvas, title, font, box.Left, box.MidY, "left", Middle: true, color, outline, outlineWidth);
            return;
        }

        Text.Draw(canvas, title, font, box.Left, box.Top + Need(part, "baseline"), "left", Middle: false, color, outline, outlineWidth);
        SKFont sub = Font(part, "subtitle-font", Need(part, "subtitle-size"));
        Text.Draw(canvas, subtitle, sub, box.Left + Float(part.Value("subtitle-indent"), 0), box.Top + Need(part, "subtitle-baseline"),
            "left", Middle: false, color, SKColors.Empty, 0);
    }

    private void Row(SKCanvas canvas, Face face, AlexObject? frame, AlexObject part)
    {
        SKRect box = Box(part);
        float right = box.Right;
        if (part.Value("items") is not AlexArray items) { return; }
        foreach (AlexValue value in items)
        {
            if (value is not AlexObject item) { continue; }
            float width;
            if (item.TypeName == "Icon")
            {
                string key = face.Template(item.Value("show"));
                if (key.Length == 0 || item.Value("images") is not AlexObject images || images.Value(key) is null) { continue; }
                float w = Need(item, "width"), h = Need(item, "height");
                float left = MathF.Round(right - w), top = MathF.Round(box.MidY - h / 2);
                Icon(canvas, face, item, SKRect.Create(left, top, w, h));
                width = right - left;
            }
            else
            {
                string text = face.Template(item.Value("show"));
                if (text.Length == 0) { continue; }
                SKFont font = Font(item, "font", Need(item, "size"));
                Text.Draw(canvas, text, font, right, box.MidY, "right", Middle: true, Color(face, frame, item.Value("color"), SKColors.Black),
                    SKColors.Empty, 0);
                width = Text.Width(text, font);
            }

            right -= width + Float(item.Value("gap"), 0);
        }
    }

    private void Chip(SKCanvas canvas, Face face, AlexObject? frame, AlexObject part)
    {
        string text = face.Template(part.Value("show"));
        if (text.Length == 0) { return; }
        SKRect box = Box(part);
        SKFont font = Font(part, "font", Need(part, "size"));
        float pad = Float(part.Value("padding"), 0), iconSize = Float(part.Value("icon-size"), box.Height), gap = Float(part.Value("gap"), 0);
        float width = MathF.Round(pad + iconSize + gap + Text.Width(text, font) + pad + 2);
        float x0 = Word(part.Value("align")) == "right" ? box.Right - width : box.Left;
        float h = box.Height;
        using (SKPaint fill = new() { IsAntialias = true, Color = Color(face, frame, part.Value("fill"), SKColors.White) })
        {
            canvas.DrawRoundRect(SKRect.Create(x0, box.Top, width, h), h / 2, h / 2, fill);
        }

        float stroke = Float(part.Value("outline-width"), 1);
        using (SKPaint outline = new() { IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeWidth = stroke, Color = Color(face, frame, part.Value("outline"), SKColors.Black) })
        {
            SKRect r = SKRect.Create(x0 + stroke / 2, box.Top + stroke / 2, width - stroke, h - stroke);
            canvas.DrawRoundRect(r, r.Height / 2, r.Height / 2, outline);
        }

        if (part.Value("icon") is AlexTextual iconFile && Image(Path.GetFullPath(iconFile.Value, _layout.Directory)) is { } icon)
        {
            using SKPaint tint = new() { ColorFilter = SKColorFilter.CreateBlendMode(Color(face, frame, part.Value("icon-color"), SKColors.Black), SKBlendMode.SrcIn) };
            SKRect iconBox = SKRect.Create(x0 + pad, box.Top + MathF.Floor((h - iconSize) / 2), iconSize, iconSize);
            canvas.DrawImage(icon, iconBox, new SKSamplingOptions(SKCubicResampler.CatmullRom), tint);
        }

        Text.Draw(canvas, text, font, x0 + pad + iconSize + gap, box.Top + h / 2 + Float(part.Value("text-offset"), 0), "left", Middle: true,
            Color(face, frame, part.Value("color"), SKColors.Black), SKColors.Empty, 0);
    }

    private void TextBox(SKCanvas canvas, Face face, AlexObject? frame, AlexObject part)
    {
        SKRect box = Box(part);
        float padding = Float(part.Value("padding"), 0), paddingTop = Float(part.Value("padding-top"), padding);
        float lineHeight = Float(part.Value("line-height"), 1.2f);
        int largest = (int)Need(part, "size"), smallest = (int)Float(part.Value("smallest"), largest);
        float inner = box.Width - 2 * padding;
        List<(AlexObject Paragraph, string Text)> paragraphs = new();
        if (part.Value("paragraphs") is AlexArray list)
        {
            foreach (AlexValue v in list)
            {
                if (v is AlexObject p && face.Template(p.Value("show")) is { Length: > 0 } text) { paragraphs.Add((p, text)); }
            }
        }

        if (paragraphs.Count == 0) { return; }
        List<Laid> laid = new();
        float total = 0;
        for (int size = largest; size >= smallest; size--)
        {
            laid.Clear();
            total = 0;
            foreach ((AlexObject p, string text) in paragraphs)
            {
                int psize = Math.Max(size + (int)Float(p.Value("size-change"), 0), (int)Float(p.Value("smallest"), 0));
                Styles styles = new(Font(p, "font", psize), p.Value("bold-font") is null ? null : Font(p, "bold-font", psize),
                    p.Value("italic-font") is null ? null : Font(p, "italic-font", psize));
                List<List<(string Piece, SKFont Font)>> lines = Wrap(Runs(text, p, face, styles), inner);
                float rule = laid.Count > 0 && lines.Count > 0 && p.Value("rule-above") is not null ? Float(p.Value("rule-gap"), 0) : 0;
                int lh = (int)(psize * lineHeight);
                laid.Add(new Laid(p, lines, psize, lh, rule));
                total += rule + lines.Count * lh;
            }

            if (total <= box.Height - 2 * paddingTop) { break; }
        }

        float y = box.Top + (box.Height - total) / 2;
        foreach (Laid l in laid)
        {
            if (l.Rule > 0)
            {
                float inset = Float(l.Paragraph.Value("rule-inset"), 0);
                float ruleY = y + Float(l.Paragraph.Value("rule-offset"), 0);
                using SKPaint rule = new()
                {
                    IsAntialias = false,
                    StrokeWidth = Float(l.Paragraph.Value("rule-width"), 1),
                    Color = Color(face, frame, l.Paragraph.Value("rule-above"), SKColors.Gray),
                };
                canvas.DrawLine(box.Left + inset, ruleY, box.Right - inset, ruleY, rule);
                y += l.Rule;
            }

            SKColor color = Color(face, frame, l.Paragraph.Value("color"), SKColors.Black);
            bool centre = Word(l.Paragraph.Value("align")) == "center";
            foreach (List<(string Piece, SKFont Font)> line in l.Lines)
            {
                if (centre)
                {
                    string words = string.Concat(line.Select(p => p.Piece));
                    Text.Draw(canvas, words, line.Count > 0 ? line[0].Font : Font(l.Paragraph, "font", l.Size), box.MidX, y + l.Size, "center",
                        Middle: false, color, SKColors.Empty, 0);
                }
                else
                {
                    float x = box.Left + padding;
                    foreach ((string piece, SKFont font) in line)
                    {
                        Text.Draw(canvas, piece, font, x, y + l.Size, "left", Middle: false, color, SKColors.Empty, 0);
                        x += Text.Width(piece, font);
                    }
                }

                y += l.LineHeight;
            }
        }
    }

    private sealed record Laid(AlexObject Paragraph, List<List<(string Piece, SKFont Font)>> Lines, int Size, int LineHeight, float Rule);

    private sealed record Styles(SKFont Regular, SKFont? Bold, SKFont? Italic);

    /// <summary>The words a <c>Bold { words = keywords }</c> means: the game's keywords and the card's set's.</summary>
    private List<string> Keywords(Face face)
    {
        List<string> words = new();
        foreach (Document d in new[] { _project.Game, face.Document })
        {
            if (d.Alex.Root.Value("keywords") is AlexObject keywords)
            {
                foreach (AlexProperty k in keywords)
                {
                    words.Add(k.Value is AlexObject o && o.Value("name") is AlexTextual n ? n.Value : k.Name);
                }
            }
        }

        return words;
    }

    /// <summary>
    /// A paragraph's text as runs of regular, bold and italic text, by its <c>emphasis</c>:
    /// <c>Bold { words = keywords }</c> or a list of words (with <c>with-number</c>, a number after the word too);
    /// <c>Bold { up-to = ':' }</c>, a sentence's opening up to and including that character, when it's a capital
    /// letter followed by letters, digits, spaces and commas ("Hello:"); <c>Italic { between = '()' }</c>, from the
    /// first character to the second, both included. A sentence starts the text, a line, or follows ". ".
    /// </summary>
    private List<(string Text, SKFont Font)> Runs(string text, AlexObject paragraph, Face face, Styles styles)
    {
        int[] marks = new int[text.Length];                 // 0 regular, 1 bold, 2 italic
        void Mark(int from, int length, int style) { for (int i = from; i < from + length; i++) { marks[i] = style; } }
        if (paragraph.Value("emphasis") is AlexArray rules)
        {
            foreach (AlexValue value in rules)
            {
                if (value is not AlexObject rule) { continue; }
                int style = rule.TypeName == "Italic" ? 2 : 1;
                if ((style == 1 ? styles.Bold : styles.Italic) is null)
                {
                    throw new TcgException($"card-layout.alex: a paragraph with {rule.TypeName} emphasis needs a {(style == 1 ? "bold-font" : "italic-font")}.");
                }

                if (rule.Value("words") is { } words)
                {
                    IEnumerable<string> list = words is AlexArray explicitWords ? explicitWords.Select(Project.Scalar) : Keywords(face);
                    string alternatives = string.Join("|", list.OrderByDescending(w => w.Length).Select(Regex.Escape));
                    if (alternatives.Length == 0) { continue; }
                    string number = Bool(rule.Value("with-number")) ? @"(?: \d+)?" : "";
                    foreach (Match m in Regex.Matches(text, @"\b(?:" + alternatives + ")" + number + @"\b")) { Mark(m.Index, m.Length, style); }
                }
                else if (Project.Scalar(rule.Value("up-to")) is { Length: 1 } end)
                {
                    Regex opening = new(@"(?:(?<=^)|(?<=\n)|(?<=\. ))([A-Z][A-Za-z ,0-9]*?" + Regex.Escape(end) + ")");
                    foreach (Match m in opening.Matches(text)) { Mark(m.Groups[1].Index, m.Groups[1].Length, style); }
                }
                else if (Project.Scalar(rule.Value("between")) is { Length: 2 } pair)
                {
                    Regex between = new(Regex.Escape(pair[..1]) + "[^" + Regex.Escape(pair[1..]) + "]*" + Regex.Escape(pair[1..]));
                    foreach (Match m in between.Matches(text)) { Mark(m.Index, m.Length, style); }
                }
            }
        }

        List<(string, SKFont)> runs = new();
        int start = 0;
        for (int i = 1; i <= text.Length; i++)
        {
            if (i == text.Length || marks[i] != marks[start])
            {
                SKFont font = marks[start] switch { 1 => styles.Bold!, 2 => styles.Italic!, _ => styles.Regular };
                runs.Add((text[start..i], font));
                start = i;
            }
        }

        return runs;
    }

    /// <summary>Word-wraps styled runs, as the old composer did: a word never splits, spaces take their run's style.</summary>
    private static List<List<(string Piece, SKFont Font)>> Wrap(List<(string Text, SKFont Font)> runs, float width)
    {
        List<List<(string, SKFont)>> lines = new();
        List<(string Piece, SKFont Font)> line = new();
        float used = 0;
        foreach ((string chunk, SKFont font) in runs)
        {
            foreach (string piece in Regex.Split(chunk, @"(\s+)"))
            {
                if (piece.Length == 0) { continue; }
                if (piece.Contains('\n'))
                {
                    lines.Add(line);
                    line = new();
                    used = 0;
                    continue;
                }

                if (string.IsNullOrWhiteSpace(piece))
                {
                    if (line.Count > 0)
                    {
                        line.Add((" ", font));
                        used += Text.Width(" ", font);
                    }

                    continue;
                }

                float size = Text.Width(piece, font);
                if (used + size > width && line.Count > 0)
                {
                    while (line.Count > 0 && line[^1].Piece == " ") { line.RemoveAt(line.Count - 1); }
                    lines.Add(line);
                    line = new();
                    used = 0;
                }

                line.Add((piece, font));
                used += size;
            }
        }

        if (line.Count > 0) { lines.Add(line); }
        return lines;
    }

    private SKColor Color(Face face, AlexObject? frame, AlexValue? value, SKColor fallback)
    {
        if (value is null) { return fallback; }
        string text = value is AlexTextual ? face.Template(value) : Project.Scalar(value);
        if (text is "ink" or "accent" or "tint")
        {
            return frame?.Value(text) is { } frameColor ? Color(face, null, frameColor, fallback) : fallback;
        }

        if (text == "finish-ink")
        {
            return _root.Value("finishes") is AlexObject finishes && finishes.Value(face.Finish) is AlexObject finish
                ? Color(face, null, finish.Value("ink"), fallback) : fallback;
        }

        return SKColor.TryParse(text, out SKColor color) ? color : fallback;
    }

    private SKFont Font(AlexObject part, string field, float size)
    {
        Project.Located found = _project.Resolve(part.Value(field), _layout);
        string file = Project.Scalar(found.Value);
        if (file.Length == 0) { throw new TcgException($"card-layout.alex: a {part.TypeName} has no {field}."); }
        if (!_fonts.TryGetValue(file, out SKTypeface? typeface))
        {
            string local = Path.GetFullPath(file, (found.Owner ?? _layout).Directory);
            string system = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Fonts), file);
            string path = File.Exists(local) ? local : File.Exists(system) ? system
                : throw new TcgException($"The font {file} is neither in the project nor installed.");
            typeface = SKTypeface.FromFile(path) ?? throw new TcgException($"The font {path} can't be read.");
            _fonts[file] = typeface;
        }

        return new SKFont(typeface, size) { Subpixel = false, LinearMetrics = false, Edging = SKFontEdging.Antialias, Hinting = SKFontHinting.Normal };
    }

    private SKImage? Image(string path)
    {
        if (!_images.TryGetValue(path, out SKImage? image))
        {
            image = File.Exists(path) ? SKImage.FromEncodedData(path) : null;
            _images[path] = image;
        }

        return image;
    }

    private static SKRect Box(AlexObject part) => part.Value("box") is AlexObject box
        ? SKRect.Create(Float(box.Value("x"), 0), Float(box.Value("y"), 0), Float(box.Value("width"), 0), Float(box.Value("height"), 0))
        : SKRect.Empty;

    private static float Float(AlexValue? value, float fallback) => value switch
    {
        AlexInteger i => i.Value,
        AlexFloat f => (float)f.Value,
        _ => fallback,
    };

    /// <summary>A number the part must give: there's no neutral default for it.</summary>
    private static float Need(AlexObject part, string field) => part.Value(field) switch
    {
        AlexInteger i => i.Value,
        AlexFloat f => (float)f.Value,
        _ => throw new TcgException($"card-layout.alex: a {part.TypeName} needs {field}."),
    };

    private static int Int(AlexValue? value, int fallback) => value is AlexInteger i ? (int)i.Value : fallback;

    private static bool Bool(AlexValue? value) => value is AlexBoolean { Value: true };

    private static string? Word(AlexValue? value) => value is null ? null : Project.Scalar(value);

    private static HashSet<string> WordSet(AlexValue? value) =>
        value is AlexArray list ? list.Select(Project.Scalar).ToHashSet(StringComparer.Ordinal) : new HashSet<string>();
}

/// <summary>Text placed the way PIL anchors it, so layouts measured against the old composer land in the same place.</summary>
internal static class Text
{
    /// <summary>
    /// Whether glyphs step by whole pixels (the layout's <c>text-spacing = whole-pixels</c>), as FreeType's hinted
    /// layout sets text; otherwise they're placed at their exact advances.
    /// </summary>
    public static bool WholePixels { get; set; }

    public static float Width(string text, SKFont font)
    {
        if (!WholePixels) { return font.MeasureText(text); }
        float width = 0;
        foreach (float w in font.GetGlyphWidths(font.GetGlyphs(text))) { width += MathF.Round(w); }
        return width;
    }

    private static SKTextBlob? Blob(string text, SKFont font, float left, float baseline)
    {
        ushort[] glyphs = font.GetGlyphs(text);
        if (glyphs.Length == 0) { return null; }
        float[] widths = font.GetGlyphWidths(glyphs);
        SKPoint[] points = new SKPoint[glyphs.Length];
        float x = left;
        for (int i = 0; i < glyphs.Length; i++)
        {
            points[i] = new SKPoint(x, baseline);
            x += WholePixels ? MathF.Round(widths[i]) : widths[i];
        }

        using SKTextBlobBuilder builder = new();
        SKPositionedRunBuffer run = builder.AllocatePositionedRun(font, glyphs.Length);
        run.SetGlyphs(glyphs);
        run.SetPositions(points);
        return builder.Build();
    }

    /// <summary>
    /// Draws <paramref name="text"/> at (<paramref name="x"/>, <paramref name="y"/>). Horizontally left, center or right;
    /// vertically, with <paramref name="Middle"/>, y is halfway between the font's ascender and descender lines,
    /// otherwise y is the baseline.
    /// </summary>
    public static void Draw(SKCanvas canvas, string text, SKFont font, float x, float y, string align, bool Middle, SKColor color,
        SKColor outline, float outlineWidth)
    {
        float width = Width(text, font);
        float left = align switch { "center" => x - width / 2, "right" => x - width, _ => x };
        float baseline = y;
        if (Middle)
        {
            SKFontMetrics m = font.Metrics;
            baseline = y + (-m.Ascent - m.Descent) / 2;
        }

        using SKTextBlob? blob = Blob(text, font, left, baseline);
        if (blob is null) { return; }
        if (outline != SKColors.Empty && outlineWidth > 0)
        {
            using SKPaint stroke = new() { IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeWidth = outlineWidth * 2, StrokeJoin = SKStrokeJoin.Round, Color = outline };
            canvas.DrawText(blob, 0, 0, stroke);
        }

        using SKPaint fill = new() { IsAntialias = true, Color = color };
        canvas.DrawText(blob, 0, 0, fill);
    }
}
