// The playtest dashboard's data, from the Fruitcats API (apps/api/src/playtests/, docs/playtests.md). Only the owner's
// Via Mochi account may read it: the page uses the sign-in the game keeps on this site.

import { API } from '../api';
import { token } from '../auth';

export class DashboardError extends Error {
  constructor(readonly code: 'signed_out' | 'not_owner' | 'offline' | 'refused', message: string) { super(message); }
}

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const t = await token();
  if (!t) throw new DashboardError('signed_out', 'Sign in to see the playtests.');
  let r: Response;
  try {
    r = await fetch(`${API}${path}`, {
      method, headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new DashboardError('offline', 'The Fruitcats API didn’t answer.');
  }
  if (r.status === 401) throw new DashboardError('signed_out', 'Sign in to see the playtests.');
  if (r.status === 403) throw new DashboardError('not_owner', 'This page is for the owner’s account only.');
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new DashboardError('refused', json.message ?? `The API answered ${r.status}.`);
  return json;
}

/** Runs (without their reports), requests, the deck and persona names, the Accounts tab and PC2024's last check-in. */
export const loadDashboard = () => call('GET', '/v1/playtests');
export const runWithReport = (id: string) => call('GET', `/v1/playtests/runs/${encodeURIComponent(id)}`);
export const queueRun = (request: { command: string; args: string; label: string; name?: string }) => call('POST', '/v1/playtests/requests', request);
export const cancelRequest = (id: string) => call('DELETE', `/v1/playtests/requests/${encodeURIComponent(id)}`);
