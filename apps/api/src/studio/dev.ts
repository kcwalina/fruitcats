// The Artist Studio's API on this computer, for development: the same routes as the real one, with its data in a
// folder (.studio-dev/ at the repo root) and pretend accounts instead of Via Mochi sign-in.
//
//   npm run studio:dev          then open http://localhost:5173/studio.html?dev
//
// A pretend account signs in with "Authorization: Dev <id>:<name>". The account "owner" owns the Studio. The agent
// key "dev-agent" is an AI agent called Claude. None of this is in the deployed API: server.ts never imports it.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { studio } from './studio';
import { folderStore, sha256 } from './store';

const PORT = Number(process.env.STUDIO_PORT) || 8787;
const root = fileURLToPath(new URL('../../../../.studio-dev/', import.meta.url));

const serve = studio({
  store: folderStore(root),
  async account(req) {
    const auth = req.headers.authorization ?? '';
    const m = /^Dev ([a-z0-9-]{1,32}):(.{1,40})$/.exec(auth);
    return m ? { id: m[1], name: m[2] } : null;
  },
  // Pretend accounts have the email <id>@example.com.
  findByEmail: async (_req, email) => {
    const m = /^([a-z0-9-]{1,32})@example\.com$/.exec(email.toLowerCase());
    return m ? { id: m[1], name: m[1][0].toUpperCase() + m[1].slice(1), email: email.toLowerCase() } : null;
  },
  owners: ['owner'],
  agents: [{ name: 'Claude', hash: sha256(Buffer.from('dev-agent')) }],
  log: (event, fields) => console.log(event, JSON.stringify(fields)),
  studioUrl: 'http://localhost:5173/studio.html',
});

createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin && /^http:\/\/localhost:\d+$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.url?.startsWith('/v1/studio/')) { void serve(req, res); return; }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log(`Studio API (development) on http://localhost:${PORT}, data in ${root}`));
