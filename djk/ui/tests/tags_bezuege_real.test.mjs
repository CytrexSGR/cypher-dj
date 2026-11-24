// The real readers (tags/bezuege.ts echteQuellen) on files shaped like the real ones. Measured on the real data: deck cuts write
// herkunft.material_id (a 16 hex prefix) and no sha, kit pads are raw files that name a cut as `schnitt:<id>/<n>`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TagSpeicher } from '../tags/store.ts';
import { bezuegeBereit, echteQuellen } from '../tags/bezuege.ts';

const sha = (n) => n.toString(16).padStart(64, '0');
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bezug-echt-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const schreibe = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };

test('a deck-cut loop resolves material_id through the catalogue, a kit resolves its pads through the cuts', async (t) => {
  const wurzel = tmp(t);
  const loops = path.join(wurzel, 'loops'), kits = path.join(wurzel, 'kits'), sampler = path.join(wurzel, 'sampler');
  const mid = sha(7).slice(0, 16);
  schreibe(path.join(loops, 'a-101010-4b', 'loop.json'), { herkunft: { material_id: mid, fassung: 'x', quell_beat: 0 } });
  schreibe(path.join(loops, 'b-sha', 'loop.json'), { herkunft: { sha: sha(8) } });
  schreibe(path.join(loops, 'c-ohne', 'loop.json'), { herkunft: null });
  schreibe(path.join(loops, 'd-unbekannt', 'loop.json'), { herkunft: { material_id: 'ffffffffffffffff' } });
  const wav = path.join(wurzel, 'quelle.wav');   // the sha256 of a wav file is the catalogue sha
  fs.writeFileSync(wav, 'RIFF-fake-audio');
  const wavSha = createHash('sha256').update(fs.readFileSync(wav)).digest('hex');
  const schnitt = (id, quelle) => schreibe(path.join(sampler, id, 'schnitt.json'), { schema: 1, id, quelle });
  schnitt('s-katalog', { art: 'katalog', ref: sha(1) });
  schnitt('s-loop', { art: 'loop', ref: 'a-101010-4b' });
  schnitt('s-datei', { art: 'datei', ref: 'rel/pfad.wav' });
  schnitt('s-modul', { art: 'modul', ref: 'm' });
  schreibe(path.join(kits, 'k1', 'kit.json'), { klaenge: [{ quelle: 'schnitt:s-katalog/1' }, { quelle: 'schnitt:s-loop/2' }, { quelle: 'schnitt:s-datei/1' },
    { quelle: 'schnitt:s-modul/1' }, { quelle: 'schnitt:s-fehlt/1' }, { quelle: `datei:${sha(3)}/2` }, { quelle: 5 },
    { quelle: 'loop:b-sha' }, { quelle: 'loop:gibt-es-nicht' }, { quelle: `wav:${wav}` }, { quelle: 'wav:/gibt/es/nicht.wav' }, { quelle: 'sox reverb auf techno hh' }] });
  const q = echteQuellen({ presets: { liste: () => [] }, projekte: { wurzelPfad: wurzel, liste: () => [], lies: () => null },
    kitsOrdner: () => kits, loopOrdner: () => loops, listeLoops: (d) => fs.readdirSync(d).map((name) => ({ name })),
    katalogSha: (m) => (m === mid ? sha(7) : null),
    schnitt: (id) => { try { return JSON.parse(fs.readFileSync(path.join(sampler, id, 'schnitt.json'), 'utf8')); } catch { return null; } } });
  const pfad = path.join(wurzel, 'tags.sqlite');
  const speicher = new TagSpeicher({ pfad });
  t.after(() => speicher.schliesse());
  const b = bezuegeBereit(speicher, q, {});
  b.frisch(); await b.fertig();
  const d = new DatabaseSync(pfad);
  const rel = d.prepare('SELECT von, art, nach, herkunft FROM relation ORDER BY von, nach').all().map((r) => `${r.von} ${r.art} ${r.nach} [${r.herkunft}]`);
  d.close();
  assert.deepEqual(rel, [
    ...[`kit:k1 made_from datei:${sha(1)} [scan]`, `kit:k1 made_from datei:${sha(3)} [scan]`, `kit:k1 made_from datei:${sha(7)} [scan]`, `kit:k1 made_from datei:${sha(8)} [scan]`,
      `kit:k1 made_from datei:${wavSha} [scan]`].sort(),
    `loop:a-101010-4b made_from datei:${sha(7)} [scan]`, `loop:b-sha made_from datei:${sha(8)} [scan]`]);
});
