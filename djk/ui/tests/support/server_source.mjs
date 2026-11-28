// The source of the page server for tests that scan it for a fragment: server.ts, the files split off it (server_*.ts, plan
// 2026-11-15-backlog-tech-release tasks 9 and 10) and the modules that took the methods of Oberflaeche (the files that carry the
// "Moved unchanged out of server.ts" header, under areas/). One string, so a fragment is found wherever it lives; the caller asserts it matched.
import fs from 'node:fs';
import path from 'node:path';

const UI = path.join(import.meta.dirname, '..', '..');
const MARKE = 'Moved unchanged out of server.ts';
const verschoben = (rel) => fs.readdirSync(path.join(UI, rel), { recursive: true })
  .filter((n) => n.endsWith('.ts')).map((n) => path.join(rel, n)).filter((f) => fs.readFileSync(path.join(UI, f), 'utf8').slice(0, 600).includes(MARKE));
export const SERVER_DATEIEN = [
  ...fs.readdirSync(UI).filter((n) => /^server(_[a-z]+)?\.ts$/.test(n)).sort(),
  ...['areas/server', 'areas/spur', 'areas/live', 'areas/bibliothek'].flatMap(verschoben).sort(),
];
export const serverQuelle = () => SERVER_DATEIEN.map((n) => fs.readFileSync(path.join(UI, n), 'utf8')).join('\n');
