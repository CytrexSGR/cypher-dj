// Helpers for the golden project folders (release reliability R1): list them, and copy one into a temp project root.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Projekte } from '../../project/storage.ts';

export const GOLDEN_WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'golden', 'projekte');

/** Every subfolder that holds a project.json, sorted by slug. `format` is the format string the stored file declares. */
export function goldenListe() {
  if (!fs.existsSync(GOLDEN_WURZEL)) return [];
  return fs.readdirSync(GOLDEN_WURZEL, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(GOLDEN_WURZEL, d.name, 'project.json')))
    .map((d) => {
      const ordner = path.join(GOLDEN_WURZEL, d.name);
      const j = JSON.parse(fs.readFileSync(path.join(ordner, 'project.json'), 'utf8'));
      return { slug: d.name, ordner, format: j.format };
    })
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

const TEMPS = [];
process.on('exit', () => { for (const t of TEMPS) fs.rmSync(t, { recursive: true, force: true }); });

/** A copy of one golden folder in a fresh temp root (removed on process exit). */
export function inTemp(slug) {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-'));
  TEMPS.push(wurzel);
  fs.cpSync(path.join(GOLDEN_WURZEL, slug), path.join(wurzel, slug), { recursive: true });
  return { wurzel, projekte: new Projekte(wurzel), slug };
}
