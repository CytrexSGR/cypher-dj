// "Last opened" stamps of the projects (browser plan 2, task 4): one file `<wurzel>/.zuletzt.json`, slug to ISO time.
// A dot file in the project root is never a project folder. A broken or missing file reads as empty; a write is atomic (temp file, rename).
import fs from 'node:fs';
import path from 'node:path';

const DATEI = '.zuletzt.json';

export function liesZuletzt(wurzel: string): Record<string, string> {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(wurzel, DATEI), 'utf8')) as unknown;
    if (j === null || typeof j !== 'object' || Array.isArray(j)) return {};
    const aus: Record<string, string> = {};
    for (const [k, v] of Object.entries(j)) if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) aus[k] = v;
    return aus;
  } catch { return {}; }
}

export function merkeZuletzt(wurzel: string, slug: string, jetzt: Date): void {
  const stand = liesZuletzt(wurzel);
  stand[slug] = jetzt.toISOString();
  const ziel = path.join(wurzel, DATEI), tmp = `${ziel}.${process.pid}.teil`;
  fs.mkdirSync(wurzel, { recursive: true });
  try {
    fs.writeFileSync(tmp, JSON.stringify(stand, null, 1) + '\n');
    fs.renameSync(tmp, ziel);
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
}
