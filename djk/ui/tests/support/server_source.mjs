// The source of the page server for tests that scan it for a fragment: server.ts and the files split off it (server_*.ts, plan
// 2026-11-15-backlog-tech-release tasks 9 and 10). One string, so a fragment is found wherever it lives; the caller asserts it matched.
import fs from 'node:fs';
import path from 'node:path';

export const SERVER_DATEIEN = fs.readdirSync(path.join(import.meta.dirname, '..', '..')).filter((n) => /^server(_[a-z]+)?\.ts$/.test(n)).sort();
export const serverQuelle = () => SERVER_DATEIEN.map((n) => fs.readFileSync(path.join(import.meta.dirname, '..', '..', n), 'utf8')).join('\n');
