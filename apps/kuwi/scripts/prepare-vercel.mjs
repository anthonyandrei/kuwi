import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Requires a completed Expo export. Replaces only generated static output; filesystem failures propagate.
// Resolve from this script so packaging works from either workspace directory.
const exported = fileURLToPath(new URL('../dist/', import.meta.url));
const output = fileURLToPath(new URL('../../../.vercel/output/', import.meta.url));
await mkdir(output, { recursive: true });
await rm(`${output}/static`, { recursive: true, force: true });
await cp(exported, `${output}/static`, { recursive: true });
await writeFile(`${output}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: '/sw.js', headers: { 'Cache-Control': 'no-cache' }, continue: true },
    { handle: 'filesystem' },
  ],
}, null, 2));
