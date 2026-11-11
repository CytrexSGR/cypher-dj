// Mutation probe of the plugin page (plan 1.11 task 11): the status dot is always green; check/probe_plugins_page.mjs must turn red (exit 1, FEHL 4.2).
// The source is patched in place and restored in a finally block: do not run in parallel with other runs in this folder.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATEI = path.join(WURZEL, 'public/production/inserts.js');
const ALT = "punkt.className = `p-host-punkt ${status}`;";
const NEU = "punkt.className = 'p-host-punkt bereit';";
const probe = () => spawnSync(process.execPath, ['check/probe_plugins_page.mjs', '--ausgabe', '/dev/shm/plugins-mutation'], { cwd: WURZEL, encoding: 'utf8', timeout: 300_000 });
const orig = fs.readFileSync(DATEI, 'utf8');
if (orig.split(ALT).length !== 2) { console.log('PROBE-FEHLER: old text not found exactly once'); process.exit(2); }
let rot;
try {
  fs.writeFileSync(DATEI, orig.replace(ALT, () => NEU));
  const r = probe();
  rot = r.status === 1 && /FEHL 4\.2/.test(r.stdout);
  console.log(`${rot ? 'ROT   ' : 'FEHLER'} dot_immer_gruen: exit ${r.status}; ${r.stdout.split('\n').filter((l) => l.startsWith('FEHL')).map((l) => l.slice(0, 60)).join(' | ')}`);
} finally { fs.writeFileSync(DATEI, orig); }
const ende = probe();
console.log(`unmutated: exit ${ende.status} (${ende.stdout.trim().split('\n').at(-1)})`);
process.exit(rot && ende.status === 0 ? 0 : 1);
