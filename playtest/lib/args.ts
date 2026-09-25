// Tiny command-line flag helpers shared by the playtest commands.

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export const flag = (name: string): boolean => process.argv.includes(`--${name}`);

export function numArg(name: string): number | undefined {
  const v = arg(name);
  return v === undefined ? undefined : Number(v);
}
