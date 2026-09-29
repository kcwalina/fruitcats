namespace Conformance;

/// <summary>
/// Broken copies of a real file, made the same way every run (a fixed seed per file): cut short, a stretch deleted,
/// or a stray token dropped in. They drive both parsers down their error-recovery paths, which well-formed files
/// never reach, so recovery is compared as closely as the grammar is.
/// </summary>
internal static class Mutants
{
    private static readonly byte[][] Strays =
    {
        "{"u8.ToArray(), "}"u8.ToArray(), "["u8.ToArray(), "]"u8.ToArray(), "("u8.ToArray(), ")"u8.ToArray(),
        "="u8.ToArray(), ","u8.ToArray(), "@"u8.ToArray(), "\n@@@\n"u8.ToArray(), "\n@@@ .x\n"u8.ToArray(),
        "'"u8.ToArray(), "\n"u8.ToArray(), "\r"u8.ToArray(), "#"u8.ToArray(), "#type"u8.ToArray(), "+"u8.ToArray(),
        "-"u8.ToArray(), "+="u8.ToArray(), "type "u8.ToArray(), "enum "u8.ToArray(), "if "u8.ToArray(),
        "else "u8.ToArray(), "given "u8.ToArray(), ":"u8.ToArray(), "|"u8.ToArray(), "?"u8.ToArray(), "."u8.ToArray(),
        "=="u8.ToArray(), "<"u8.ToArray(), "not "u8.ToArray(), "\""u8.ToArray(), "Ä"u8.ToArray(), new byte[] { 0xFF },
        " X "u8.ToArray(), "nameof("u8.ToArray(), "1.5e"u8.ToArray(), "effect e "u8.ToArray(),
    };

    public static List<byte[]> Make(byte[] source, int count, int seed)
    {
        List<byte[]> mutants = new(count);
        if (source.Length == 0) { return mutants; }
        Random random = new(seed);
        for (int i = 0; i < count; i++)
        {
            int position = random.Next(source.Length + 1);
            switch (random.Next(3))
            {
                case 0:
                    mutants.Add(source.AsSpan(0, position).ToArray());
                    break;

                case 1:
                {
                    int length = Math.Min(1 + random.Next(24), source.Length - position);
                    byte[] shorter = new byte[source.Length - length];
                    source.AsSpan(0, position).CopyTo(shorter);
                    source.AsSpan(position + length).CopyTo(shorter.AsSpan(position));
                    mutants.Add(shorter);
                    break;
                }

                default:
                {
                    byte[] stray = Strays[random.Next(Strays.Length)];
                    byte[] longer = new byte[source.Length + stray.Length];
                    source.AsSpan(0, position).CopyTo(longer);
                    stray.CopyTo(longer.AsSpan(position));
                    source.AsSpan(position).CopyTo(longer.AsSpan(position + stray.Length));
                    mutants.Add(longer);
                    break;
                }
            }
        }

        return mutants;
    }
}
