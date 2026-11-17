// Plan live-module task 3: the minimal module store (project/module_storage.ts). Export saves a module file with the metadata and copies of the audio;
// the stems that arrive later are saved into the same module; saving again copies only what is missing. Never writes outside the test folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { liveAufbau } from './support/live_module.mjs';
import { modulId, modulBasis, modulOrdner, modulOrdnerName, speichereModul, liesModul, listeModule } from '../project/module_storage.ts';

import { OHNE_GPU } from './support/stems_voraussetzung.mjs';   // no GPU, or a Python without the werkstatt: skipped, not hung

test('export saves modul.json with the origin, the tree and a copy of the loop WAV under audio/<sha>.wav', async (t) => {
  const z = await liveAufbau(t);
  assert.equal((await z.m.exportiere({ deck: 1 }, 'andreas')).code, 200);
  assert.equal(z.nach.length, 1);
  const p = z.projekt();
  const g = z.gruppeVon(p, 'A');
  const id = g.modul.id;
  const datei = path.join(modulOrdner(id, z.modulOrdner), 'modul.json');
  assert.ok(fs.existsSync(datei), 'modul.json written by the export hook');
  const j = JSON.parse(fs.readFileSync(datei, 'utf8'));
  assert.equal(j.id, id);
  assert.equal(j.format, 1);
  assert.equal(j.slot, 'A');
  const h = j.herkunft;
  assert.deepEqual([h.titel, h.kuenstler, h.quelle_sha256, h.von_beat, h.laenge_beats, h.tonart],
    ['Song', 'Art', 'a'.repeat(64), 5, 4, '8A']);
  assert.deepEqual(j.gruppen.map((x) => x.name), ['A · Song']);
  assert.equal(j.spuren.length, 1);
  assert.equal(j.spuren[0].name, 'Loop');
  const clip = j.spuren[0].clips[0];
  assert.equal(clip.art, 'audio');
  const orig = p.spuren.find((s) => s.name === 'Loop').clips[0];
  assert.equal(clip.quelle.pfad_hinweis, `audio/${orig.quelle.sha256}.wav`, 'relative path to the copy');
  const kopie = path.join(modulOrdner(id, z.modulOrdner), clip.quelle.pfad_hinweis);
  assert.ok(fs.readFileSync(kopie).equals(fs.readFileSync(orig.quelle.pfad_hinweis)), 'the copy equals the loop WAV');
  assert.deepEqual(j.audio, [{ sha256: orig.quelle.sha256, datei: clip.quelle.pfad_hinweis }]);
  assert.equal(j.audio_fehlt, undefined);
  await z.abbruch('A');
});

test('saving again: same id, existing audio copies stay (not copied again), a missing source is noted, not thrown', async (t) => {
  const z = await liveAufbau(t, { speichern: false });
  await z.m.exportiere({ deck: 1 }, 'andreas');
  const p = z.projekt();
  const g = z.gruppeVon(p, 'A');
  const a = speichereModul(p, g.id, { basis: z.modulOrdner });
  assert.equal(a.id, g.modul.id);
  assert.equal(a.pfad, path.join(modulOrdner(a.id, z.modulOrdner), 'modul.json'));
  const orig = p.spuren.find((s) => s.name === 'Loop').clips[0];
  const kopie = path.join(modulOrdner(a.id, z.modulOrdner), 'audio', `${orig.quelle.sha256}.wav`);
  const ino = fs.statSync(kopie).ino;
  fs.writeFileSync(kopie, 'marker');                                             // an existing copy is never overwritten
  speichereModul(p, g.id, { basis: z.modulOrdner });
  assert.equal(fs.readFileSync(kopie, 'utf8'), 'marker');
  assert.equal(fs.statSync(kopie).ino, ino);
  fs.rmSync(kopie);
  fs.rmSync(orig.quelle.pfad_hinweis);                                           // copy and source gone: noted in the file
  speichereModul(p, g.id, { basis: z.modulOrdner });
  assert.deepEqual(JSON.parse(fs.readFileSync(a.pfad, 'utf8')).audio_fehlt, [orig.quelle.sha256]);
  await z.abbruch('A');
});

test('the id is stable per module and differs between loops; the base can be set by the environment', async (t) => {
  const z = await liveAufbau(t, { speichern: false });
  await z.m.exportiere({ deck: 1 }, 'andreas');
  const g = z.gruppeVon(z.projekt(), 'A');
  assert.match(modulId(g.modul), /^[0-9a-f]{16}$/);
  assert.equal(modulId(g.modul), modulId({ ...g.modul, slot: 'B', titel: 'other title', datum: '2030-01-01' }));
  assert.notEqual(modulId(g.modul), modulId({ ...g.modul, von_beat: 9 }));
  const alt = process.env.CYPHERDJ_MODULE;
  process.env.CYPHERDJ_MODULE = path.join(z.tmp, 'env-basis');
  try { assert.equal(modulBasis(), path.join(z.tmp, 'env-basis')); } finally {
    if (alt === undefined) delete process.env.CYPHERDJ_MODULE; else process.env.CYPHERDJ_MODULE = alt;
  }
  await z.abbruch('A');
});

test('stems arrive: the hook saves again into the same module, now with four stem tracks and their audio', { skip: OHNE_GPU }, async (t) => {
  const z = await liveAufbau(t, { trenner: 'identitaet_vier' });
  await z.m.exportiere({ deck: 1 }, 'andreas');
  const { warteBis } = await import('./support/proj_context.mjs');
  assert.ok(await warteBis(() => z.stand('A').stems.stems === 'fertig', 60000), JSON.stringify(z.stand('A')));
  assert.ok(await warteBis(() => z.nachStems.length === 1, 5000), 'nachStems ran');
  const g = z.gruppeVon(z.projekt(), 'A');
  const j = JSON.parse(fs.readFileSync(path.join(modulOrdner(g.modul.id, z.modulOrdner), 'modul.json'), 'utf8'));
  assert.equal(j.gruppen.length, 5, 'top group and four stem groups');
  assert.equal(j.spuren.length, 5, 'Loop and four originals');
  assert.equal(j.audio.length, 5);
  for (const a of j.audio) assert.ok(fs.existsSync(path.join(modulOrdner(j.id, z.modulOrdner), a.datei)), a.datei);
  assert.equal(fs.readdirSync(z.modulOrdner).length, 1, 'one module folder: same id as the loop-only save');
});

test('review fix 4: the id is given once at export: same loop again or in A and B, own folder; modul.id kept on save', async (t) => {
  const z = await liveAufbau(t);
  await z.exportiere('A');
  await z.exportiere('B');
  const p = z.projekt();
  const a = z.gruppeVon(p, 'A'), b = z.gruppeVon(p, 'B');
  assert.match(a.modul.id, /^[0-9a-f]{16}$/);
  assert.notEqual(a.modul.id, b.modul.id, 'same loop in A and B: two folders');
  assert.equal(modulId(a.modul), modulId({ ...b.modul, slot: 'A' }), 'the content hash alone would have been the same');
  assert.ok(fs.existsSync(path.join(modulOrdner(a.modul.id, z.modulOrdner), 'modul.json')));
  assert.ok(fs.existsSync(path.join(modulOrdner(b.modul.id, z.modulOrdner), 'modul.json')));
  // the id stays through a save; a group without id (no origin from the export) falls back to the content hash
  assert.equal(speichereModul(p, a.id, { basis: z.modulOrdner }).id, a.modul.id);
  const { id: _i, ...ohne } = a.modul;
  const q = structuredClone(p); q.gruppen.find((g) => g.id === a.id).modul = ohne;
  assert.equal(speichereModul(q, a.id, { basis: z.modulOrdner }).id, modulId(ohne));
});

// --- readable module folders (storage layout task 6) ----------------------------------------------------------------------------------------
const REPO_WURZEL = path.resolve(import.meta.dirname, '..', '..', '..');
const mitId = (p, gid, id, slot) => {
  const k = structuredClone(p);
  const m = k.gruppen.find((g) => g.id === gid).modul;
  m.id = id;
  if (slot === undefined) delete m.slot; else m.slot = slot;
  return k;
};

test('module folder: a new module gets <name>-<4hex>', async (t) => {
  const z = await liveAufbau(t, { speichern: false });
  await z.m.exportiere({ deck: 1 }, 'andreas');
  const p = z.projekt(), g = z.gruppeVon(p, 'A');
  const r = speichereModul(p, g.id, { basis: z.modulOrdner });
  assert.deepEqual(fs.readdirSync(z.modulOrdner), [`song-a-${g.modul.id.slice(0, 4)}`]);
  assert.equal(r.pfad, path.join(z.modulOrdner, `song-a-${g.modul.id.slice(0, 4)}`, 'modul.json'));
  assert.equal(modulOrdner(g.modul.id, z.modulOrdner), path.join(z.modulOrdner, `song-a-${g.modul.id.slice(0, 4)}`));
  assert.equal(modulOrdnerName('Pure and Simple', 'A', '276617b78ebc7a9f'), 'pure-and-simple-a-2766');
  await z.abbruch('A');
});

test('an old 16-hex folder still resolves and lists', async (t) => {
  const basis = fs.mkdtempSync(path.join(os.tmpdir(), 'modul-alt-'));
  t.after(() => fs.rmSync(basis, { recursive: true, force: true }));
  const id = '0123456789abcdef';
  fs.mkdirSync(path.join(basis, id));
  fs.writeFileSync(path.join(basis, id, 'modul.json'), JSON.stringify({ format: 1, id, gespeichert: '2026-11-16T10:00:00Z', herkunft: { titel: 'Old' },
    gruppen: [{ id: 'g1', name: 'Old' }], spuren: [], audio: [] }));
  assert.equal(modulOrdner(id, basis), path.join(basis, id));
  assert.equal(liesModul(id, basis)?.id, id);
  assert.deepEqual(listeModule({ basis }).map((e) => e.id), [id]);
  assert.equal(modulOrdner('ffffffffffffffff', basis), null);
  assert.equal(modulOrdner('../etc', basis), null, 'only a 16-hex id is a module id');
});

test('saving again writes into the existing folder', async (t) => {
  const z = await liveAufbau(t, { speichern: false });
  await z.m.exportiere({ deck: 1 }, 'andreas');
  const p = z.projekt(), g = z.gruppeVon(p, 'A');
  const a = speichereModul(p, g.id, { basis: z.modulOrdner });
  const q = structuredClone(p); q.gruppen.find((x) => x.id === g.id).modul.titel = 'Renamed Title';   // a new title does not move the module
  const b = speichereModul(q, g.id, { basis: z.modulOrdner });
  assert.equal(b.pfad, a.pfad);
  assert.equal(fs.readdirSync(z.modulOrdner).length, 1);
  await z.abbruch('A');
});

test('a renamed folder resolves by the id in modul.json', async (t) => {
  const z = await liveAufbau(t, { speichern: false });
  await z.m.exportiere({ deck: 1 }, 'andreas');
  const p = z.projekt(), g = z.gruppeVon(p, 'A');
  const a = speichereModul(p, g.id, { basis: z.modulOrdner });
  assert.ok(modulOrdner(g.modul.id, z.modulOrdner));                       // the map knows the old name now
  const neu = path.join(z.modulOrdner, 'my-own-name');
  fs.renameSync(path.dirname(a.pfad), neu);
  assert.equal(modulOrdner(g.modul.id, z.modulOrdner), neu);
  assert.equal(liesModul(g.modul.id, z.modulOrdner)?.id, g.modul.id);
  assert.deepEqual(listeModule({ basis: z.modulOrdner }).map((e) => e.id), [g.modul.id]);
  assert.equal(speichereModul(p, g.id, { basis: z.modulOrdner }).pfad, path.join(neu, 'modul.json'), 'saving goes into the renamed folder');
  assert.deepEqual(fs.readdirSync(z.modulOrdner), ['my-own-name']);
  await z.abbruch('A');
});

test('two modules with the same title get distinct folders', async (t) => {
  const z = await liveAufbau(t, { speichern: false });
  await z.m.exportiere({ deck: 1 }, 'andreas');
  const p = z.projekt(), g = z.gruppeVon(p, 'A');
  const a = speichereModul(mitId(p, g.id, 'abcd000000000001', undefined), g.id, { basis: z.modulOrdner });
  const b = speichereModul(mitId(p, g.id, 'abcd000000000002', undefined), g.id, { basis: z.modulOrdner });   // same title, same 4 hex
  assert.equal(path.basename(path.dirname(a.pfad)), 'song-abcd');
  assert.equal(path.basename(path.dirname(b.pfad)), 'song-abcd0000');
  assert.notEqual(a.pfad, b.pfad);
  assert.deepEqual(listeModule({ basis: z.modulOrdner }).map((e) => e.id).sort(), ['abcd000000000001', 'abcd000000000002']);
  assert.equal(liesModul('abcd000000000002', z.modulOrdner)?.id, 'abcd000000000002');
  await z.abbruch('A');
});

test('name rule matches the shared vectors', () => {
  const v = JSON.parse(fs.readFileSync(path.join(REPO_WURZEL, 'docs', 'interfaces', 'modul_ordner_namen.json'), 'utf8')).vektoren;
  assert.ok(v.length >= 5);
  for (const x of v) assert.equal(modulOrdnerName(x.titel, x.slot ?? undefined, x.id), x.erwartet, JSON.stringify(x));
});
