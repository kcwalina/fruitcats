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

/** Every word after `--name` up to the next flag, joined: for text the playtester passes along split on spaces (`--goal beat Orchard Guard`). */
export function textArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const words: string[] = [];
  for (let j = i + 1; j < process.argv.length && !process.argv[j].startsWith('--'); j++) words.push(process.argv[j]);
  return words.join(' ').trim() || undefined;
}
