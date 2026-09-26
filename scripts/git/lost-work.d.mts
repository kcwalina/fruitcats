export interface Finding { merge: string; side: string; path: string; kind: 'lost' | 'resurrected' | 'binary' | 'file deleted'; lines: string[] }
export function lostInMerge(merge: string, cwd?: string): Finding[];
export function lostInRange(range: string, cwd?: string): { merges: number; findings: Finding[]; excused: { merge: string; reason: string; count: number }[] };
export function describe(findings: Finding[], cwd?: string): string;
export const HOW_TO_FIX: string;
