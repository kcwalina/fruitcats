export function fetchMain(cwd?: string): void;
export function requireClean(cwd?: string): void;
export function head(cwd?: string): string;
export function isAncestor(older: string, newer: string, cwd?: string): boolean;
export function requireOnMain(cwd?: string): string;
export function requireLiveInHead(commit: string | null, what: string, cwd?: string): void;
export function takeLock(name: string, opts?: { pid?: number; waitMinutes?: number }): Promise<() => void>;
export function releaseLock(name: string): void;
