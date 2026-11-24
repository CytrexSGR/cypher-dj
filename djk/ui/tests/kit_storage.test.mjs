// Browser plan 5, task 2: the kit store. Temp folders only; never the real kit folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  KitFehler, benenneKitUm, braucheFreienPlatz, installiereKitOrdner, installiereKitZip, kitBenutzer, kitInhaltHash, kopiereKit, listeKitsAlle, loescheKit, pruefeKitOrdner, renderKitVorschau,
} from '../project/kit_storage.ts';
import { schreibeKit, schreibeZip, tmpOrdner, zipVonKit } from './support/kit_build.mjs';

const aufbau = (t) => {
  const d = tmpOrdner(t);
  return { d, kits: path.join(d, 'kits'), q: path.join(d, 'q') };
};
const lies = (o) => JSON.parse(fs.readFileSync(path.join(o, 'kit.json'), 'utf8'));

test('pruefeKitOrdner accepts a valid kit and counts pads', async (t) => {
  const { q } = aufbau(t);
  schreibeKit(q, { noten: [36, 37, 38], frames: 10 });
  assert.deepEqual(await pruefeKitOrdner(q), { ok: true, pads: 3, bytes: 3 * 10 * 8 });
});

for (const [name, aendere, grund] of [
  ['duplicate note', (j) => { j.klaenge[1].note = 36; }, 'kit_ungueltig'],
  ['note 128', (j) => { j.klaenge[0].note = 128; }, 'kit_ungueltig'],
  ['file name with ..', (j) => { j.klaenge[0].datei = 'a..f32.f32'; }, 'kit_ungueltig'],
  ['file name with a slash', (j) => { j.klaenge[0].datei = 'x/36.f32'; }, 'kit_ungueltig'],
  ['size not frames*8', (j, o) => { fs.appendFileSync(path.join(o, '36.f32'), Buffer.alloc(4)); }, 'kit_ungueltig'],
  ['NaN sample', (j, o) => { const b = fs.readFileSync(path.join(o, '36.f32')); b.writeFloatLE(NaN, 8); fs.writeFileSync(path.join(o, '36.f32'), b); }, 'kit_ungueltig'],
  ['frames 0', (j) => { j.klaenge[0].frames = 0; }, 'kit_ungueltig'],
  ['frames over 480000', (j) => { j.klaenge[0].frames = 480001; }, 'kit_ungueltig'],
  ['schema 2', (j) => { j.schema = 2; }, 'kit_ungueltig'],
]) {
  test(`pruefeKitOrdner refuses: ${name}`, async (t) => {
    const { q } = aufbau(t);
    schreibeKit(q, { aendere });
    const r = await pruefeKitOrdner(q);
    assert.equal(r.ok, false);
    assert.equal(r.grund, grund);
    assert.ok(r.text.length > 5);
  });
}

test('pruefeKitOrdner: no kit.json is kit_json_fehlt', async (t) => {
  const { q } = aufbau(t);
  fs.mkdirSync(q, { recursive: true });
  assert.equal((await pruefeKitOrdner(q)).grund, 'kit_json_fehlt');
});

test('a .wav sound is refused with the .f32 sentence and the offending name', async (t) => {
  const { q } = aufbau(t);
  schreibeKit(q, { aendere: (j) => { j.klaenge[0].datei = 'kick.wav'; } });
  const r = await pruefeKitOrdner(q);
  assert.equal(r.ok, false);
  assert.match(r.text, /raw stereo float32 \.f32/);
  assert.match(r.text, /kick\.wav/);
});

test('file names of 4 and 65 characters are refused, 5 and 64 pass', async (t) => {
  const { q } = aufbau(t);
  const mit = (lang) => schreibeKit(q, { noten: [36], frames: 4, aendere: (j, o) => {
    const n = lang === 4 ? '.f32' : `${'a'.repeat(lang - 4)}.f32`;
    fs.renameSync(path.join(o, '36.f32'), path.join(o, n)); j.klaenge[0].datei = n;
  } });
  const r4 = (mit(4), await pruefeKitOrdner(q)); fs.rmSync(q, { recursive: true });
  const r5 = (mit(5), await pruefeKitOrdner(q)); fs.rmSync(q, { recursive: true });
  const r64 = (mit(64), await pruefeKitOrdner(q)); fs.rmSync(q, { recursive: true });
  const r65 = (mit(65), await pruefeKitOrdner(q));
  assert.deepEqual([r4.ok, r5.ok, r64.ok, r65.ok], [false, true, true, false]);
});

test('install under a free name', async (t) => {
  const { kits, q } = aufbau(t);
  schreibeKit(q);
  const r = await installiereKitOrdner(q, 'mein-kit', { kitsOrdner: kits });
  assert.deepEqual(r, { name: 'mein-kit', neu: true, umbenannt: null });
  assert.equal(await kitInhaltHash(path.join(kits, 'mein-kit')), await kitInhaltHash(q));
  assert.deepEqual(fs.readdirSync(kits), ['mein-kit'], 'no staging folder is left');
});

test('same content again reuses the kit (neu false)', async (t) => {
  const { kits, q } = aufbau(t);
  schreibeKit(q);
  await installiereKitOrdner(q, 'k', { kitsOrdner: kits });
  const r = await installiereKitOrdner(q, 'k', { kitsOrdner: kits });
  assert.deepEqual(r, { name: 'k', neu: false, umbenannt: null });
  assert.deepEqual(fs.readdirSync(kits), ['k']);
});

test('other content installs as name-sha8 with the name cut to 23 characters, and the same content again reuses that', async (t) => {
  const { kits, q, d } = aufbau(t);
  const lang = 'a'.repeat(32);
  schreibeKit(q, { fuell: 0.1 });
  await installiereKitOrdner(q, lang, { kitsOrdner: kits });
  const q2 = path.join(d, 'q2');
  schreibeKit(q2, { fuell: 0.5 });
  const r = await installiereKitOrdner(q2, lang, { kitsOrdner: kits });
  const sha8 = (await kitInhaltHash(path.join(kits, r.name))).slice(0, 8);
  assert.equal(r.name, `${'a'.repeat(23)}-${sha8}`);
  assert.equal(r.name.length, 32);
  assert.deepEqual(r.umbenannt, { alt: lang, neu: r.name });
  assert.equal(r.neu, true);
  const again = await installiereKitOrdner(q2, lang, { kitsOrdner: kits });
  assert.deepEqual([again.name, again.neu], [r.name, false]);
  assert.equal(fs.readdirSync(kits).length, 2);
});

test('an invalid name is refused before anything is written', async (t) => {
  const { kits, q } = aufbau(t);
  schreibeKit(q);
  await assert.rejects(installiereKitOrdner(q, '../x', { kitsOrdner: kits }), (e) => e instanceof KitFehler && e.grund === 'kit_name_ungueltig');
  assert.equal(fs.existsSync(kits), false);
});

test('a broken kit installs nothing and leaves no staging folder', async (t) => {
  const { kits, q } = aufbau(t);
  schreibeKit(q, { aendere: (j) => { j.klaenge[1].note = 36; } });
  await assert.rejects(installiereKitOrdner(q, 'k', { kitsOrdner: kits }), (e) => e instanceof KitFehler && e.grund === 'kit_ungueltig' && e.code === 400);
  assert.deepEqual(fs.existsSync(kits) ? fs.readdirSync(kits) : [], []);
});

test('zip without kit.json is refused (kit_json_fehlt)', async (t) => {
  const { kits, d } = aufbau(t);
  const z = schreibeZip(path.join(d, 'a.zip'), { 'readme.txt': 'x' });
  await assert.rejects(installiereKitZip(z, 'k', { kitsOrdner: kits }), (e) => e instanceof KitFehler && e.grund === 'kit_json_fehlt');
  assert.deepEqual(fs.readdirSync(kits), []);
});

test('zip with kit.json in the only top-level folder installs', async (t) => {
  const { kits, q, d } = aufbau(t);
  schreibeKit(q);
  const z = zipVonKit(path.join(d, 'a.zip'), q, 'inner');
  const r = await installiereKitZip(z, 'k', { kitsOrdner: kits });
  assert.equal(r.name, 'k');
  assert.equal(await kitInhaltHash(path.join(kits, 'k')), await kitInhaltHash(q));
  assert.deepEqual(fs.readdirSync(kits), ['k']);
});

test('zip: the wanted name defaults to the name in kit.json, then to the zip file name', async (t) => {
  const { kits, q, d } = aufbau(t);
  schreibeKit(q, { name: 'My Kit!' });
  const r = await installiereKitZip(zipVonKit(path.join(d, 'x.zip'), q), null, { kitsOrdner: kits });
  assert.equal(r.name, 'my-kit');
  const q2 = path.join(d, 'q2');
  schreibeKit(q2, { fuell: 0.9, aendere: (j) => { delete j.name; } });
  const r2 = await installiereKitZip(zipVonKit(path.join(d, 'Cool Drums.kit.zip'), q2), null, { kitsOrdner: kits });
  assert.equal(r2.name, 'cool-drums');
});

test('zip with ../ entry refused (zip_abgelehnt) and the kit folder unchanged', async (t) => {
  const { kits, d } = aufbau(t);
  fs.mkdirSync(kits);
  const z = schreibeZip(path.join(d, 'a.zip'), { '../evil.txt': 'x', 'kit.json': '{}' });
  await assert.rejects(installiereKitZip(z, 'k', { kitsOrdner: kits }), (e) => e instanceof KitFehler && e.grund === 'zip_abgelehnt' && e.detail === 'pfad_verlaesst_ordner');
  assert.deepEqual(fs.readdirSync(kits), []);
  assert.equal(fs.existsSync(path.join(d, 'evil.txt')), false);
});

test('kit zip with a .wav sound is refused with the .f32 sentence', async (t) => {
  const { kits, q, d } = aufbau(t);
  schreibeKit(q, { aendere: (j, o) => { j.klaenge[0].datei = 'kick.wav'; fs.writeFileSync(path.join(o, 'kick.wav'), 'RIFF'); } });
  await assert.rejects(installiereKitZip(zipVonKit(path.join(d, 'a.zip'), q), 'k', { kitsOrdner: kits }), (e) => e.grund === 'kit_ungueltig' && /\.f32/.test(e.text));
  assert.deepEqual(fs.readdirSync(kits), []);
});

test('braucheFreienPlatz throws platte_voll with an injected small free value', () => {
  assert.throws(() => braucheFreienPlatz(process.cwd(), 10 * 2 ** 20, () => 100 * 2 ** 20), (e) => e instanceof KitFehler && e.code === 507 && e.grund === 'platte_voll' && /MiB/.test(e.text));
  assert.doesNotThrow(() => braucheFreienPlatz(process.cwd(), 10, () => 2 ** 40));
});

test('listeKitsAlle shows global and projekt', async (t) => {
  const { kits, d } = aufbau(t);
  const proj = path.join(d, 'proj');
  schreibeKit(path.join(kits, 'b-kit'));
  schreibeKit(path.join(kits, 'a-kit'), { noten: [36] });
  schreibeKit(path.join(proj, 'kits', 'b-kit'), { noten: [36, 37, 38] });
  fs.mkdirSync(path.join(kits, 'kaputt'));
  assert.deepEqual(listeKitsAlle(proj, { kitsOrdner: kits }), [
    { name: 'a-kit', pads: 1, quelle: 'global' }, { name: 'b-kit', pads: 2, quelle: 'global' }, { name: 'b-kit', pads: 3, quelle: 'projekt' },
  ]);
  assert.deepEqual(listeKitsAlle(null, { kitsOrdner: kits }).map((k) => k.name), ['a-kit', 'b-kit']);
  assert.equal(lies(path.join(kits, 'a-kit')).schema, 1);
});

// ---- task 3: rename, copy, delete, preview ----

const mitProjekt = (d, slug, kit) => {
  const o = path.join(d, 'projekte', slug);
  fs.mkdirSync(o, { recursive: true });
  fs.writeFileSync(path.join(o, 'project.json'), JSON.stringify({ spuren: [{ id: 's1', geraet: { art: 'intern', name: 'kit', kit } }] }));
  return path.join(d, 'projekte');
};

test('rename moves the folder and kit.json follows', async (t) => {
  const { kits } = aufbau(t);
  schreibeKit(path.join(kits, 'alt'));
  benenneKitUm('alt', 'neu', { kitsOrdner: kits });
  assert.deepEqual(fs.readdirSync(kits), ['neu']);
  assert.equal(lies(path.join(kits, 'neu')).name, 'neu');
  assert.equal((await pruefeKitOrdner(path.join(kits, 'neu'))).ok, true);
});

test('rename onto an existing name is 409 kit_vorhanden', async (t) => {
  const { kits } = aufbau(t);
  schreibeKit(path.join(kits, 'a')); schreibeKit(path.join(kits, 'b'));
  assert.throws(() => benenneKitUm('a', 'b', { kitsOrdner: kits }), (e) => e.code === 409 && e.grund === 'kit_vorhanden');
});

test('rename of a kit that a project names is 409 kit_in_benutzung and the folder stays', async (t) => {
  const { kits, d } = aufbau(t);
  schreibeKit(path.join(kits, 'a'));
  const projekteWurzel = mitProjekt(d, 'song', 'a');
  assert.throws(() => benenneKitUm('a', 'b', { kitsOrdner: kits, projekteWurzel }), (e) => e.code === 409 && e.grund === 'kit_in_benutzung' && e.detail === 'song');
  assert.deepEqual(fs.readdirSync(kits), ['a']);
  assert.deepEqual(kitBenutzer('a', projekteWurzel), ['song']);
  assert.deepEqual(kitBenutzer('zzz', projekteWurzel), []);
});

test('rename with a name like ../x is refused, and an unknown kit is 404', async (t) => {
  const { kits } = aufbau(t);
  schreibeKit(path.join(kits, 'a'));
  assert.throws(() => benenneKitUm('a', '../x', { kitsOrdner: kits }), (e) => e.grund === 'kit_name_ungueltig');
  assert.throws(() => benenneKitUm('../a', 'x', { kitsOrdner: kits }), (e) => e.grund === 'kit_name_ungueltig');
  assert.throws(() => benenneKitUm('nix', 'x', { kitsOrdner: kits }), (e) => e.code === 404 && e.grund === 'kit_unbekannt');
  assert.deepEqual(fs.readdirSync(kits), ['a']);
});

test('duplicate without a name picks name-2, with a name uses it', async (t) => {
  const { kits } = aufbau(t);
  schreibeKit(path.join(kits, 'drums'));
  assert.deepEqual(await kopiereKit('drums', null, { kitsOrdner: kits }), { name: 'drums-2' });
  assert.deepEqual(await kopiereKit('drums', 'eigen', { kitsOrdner: kits }), { name: 'eigen' });
  await assert.rejects(kopiereKit('drums', 'eigen', { kitsOrdner: kits }), (e) => e.grund === 'kit_vorhanden');
  assert.equal((await pruefeKitOrdner(path.join(kits, 'drums-2'))).ok, true);
  assert.equal(lies(path.join(kits, 'drums-2')).name, 'drums-2');
  assert.deepEqual(fs.readdirSync(kits).sort(), ['drums', 'drums-2', 'eigen']);
});

test('delete moves to .papierkorb and the kit disappears from the list', async (t) => {
  const { kits } = aufbau(t);
  schreibeKit(path.join(kits, 'weg'));
  const r = loescheKit('weg', { kitsOrdner: kits });
  assert.equal(path.dirname(r.papierkorb), path.join(kits, '.papierkorb'));
  assert.equal((await pruefeKitOrdner(r.papierkorb)).ok, true, 'the kit is intact in the bin');
  assert.deepEqual(listeKitsAlle(null, { kitsOrdner: kits }), []);
  assert.throws(() => loescheKit('weg', { kitsOrdner: kits }), (e) => e.code === 404);
});

test('delete of a used kit needs trotzdem', async (t) => {
  const { kits, d } = aufbau(t);
  schreibeKit(path.join(kits, 'k'));
  const projekteWurzel = mitProjekt(d, 'song', 'k');
  assert.throws(() => loescheKit('k', { kitsOrdner: kits, projekteWurzel }), (e) => e.code === 409 && e.grund === 'kit_in_benutzung');
  assert.equal(fs.existsSync(path.join(kits, 'k')), true);
  loescheKit('k', { kitsOrdner: kits, projekteWurzel, trotzdem: true });
  assert.equal(fs.existsSync(path.join(kits, 'k')), false);
});

test('preview render has one block per pad and a valid WAV header', async (t) => {
  const { kits } = aufbau(t);
  schreibeKit(path.join(kits, 'k'), { noten: [38, 36, 40], frames: 200000 });   // longer than 3 s: cut
  const r = await renderKitVorschau('k', null, { kitsOrdner: kits });
  assert.equal(r.frames, 3 * 144000 + 2 * 12000);
  assert.equal(r.wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(r.wav.subarray(8, 12).toString(), 'WAVE');
  assert.equal(r.wav.readUInt32LE(54), r.frames * 8);
  assert.equal(r.wav.length, 58 + r.frames * 8);
  const f = (i) => r.wav.readFloatLE(58 + i * 8);
  assert.ok(Math.abs(f(0) - (0.25 + 36 / 1000)) < 1e-6, 'pads run in note order: 36 first');
  assert.equal(f(144000 + 5), 0, 'silence between pads');
  assert.ok(Math.abs(f(144000 + 12000) - (0.25 + 38 / 1000)) < 1e-6);
  const eins = await renderKitVorschau('k', 40, { kitsOrdner: kits });
  assert.equal(eins.frames, 144000);
  await assert.rejects(renderKitVorschau('k', 99, { kitsOrdner: kits }), (e) => e.code === 404 && e.grund === 'pad_unbekannt');
});
