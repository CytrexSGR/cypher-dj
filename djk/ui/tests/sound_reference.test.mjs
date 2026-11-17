// ANALYZE slice 2: references on the page server (areas/proj/sound_reference.ts). The store (round trip, order, bin, bad input), the choice of the range on a
// synthetic WAV written here (the real ffmpeg decodes it; the analysis is a stand-in that records what it was asked), the refusals, and one end-to-end run
// with the real worker. Everything lives in temp folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { KlangReferenz } from '../areas/proj/sound_reference.ts';
import { AusgabeFehler } from '../areas/proj/output.ts';
import { wavKopf } from '../project/recording.ts';
import { ROLLEN } from '../project/sound_contract.ts';

const FIXTURE = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'analyse_antwort.json'), 'utf8'));
const RATE = 48000;
const HAT_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-test-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const reste = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('djk-referenz-')).sort();

// float32 stereo WAV from f(second) per sample
function schreibe(datei, sek, f) {
  const frames = Math.round(RATE * sek), d = Buffer.alloc(frames * 8);
  for (let i = 0; i < frames; i++) { const v = f(i / RATE, i); d.writeFloatLE(v, i * 8); d.writeFloatLE(v, i * 8 + 4); }
  fs.writeFileSync(datei, Buffer.concat([wavKopf(frames), d]));
  return datei;
}
const rauschen = () => { let z = 12345; return () => { z = (z * 1103515245 + 12345) & 0x7fffffff; return z / 0x3fffffff - 1; }; };
const teil = (stumm = false) => {
  const m = FIXTURE.quelle;
  return { stumm, spitze_db: stumm ? -200 : -6, rms_db: stumm ? -200 : -9, crest_db: 3, stereo: m.stereo, spektrum: m.spektrum, zeitbild: m.zeitbild,
    spaltenTerz: new Float32Array(30), spalten: m.zeitbild.spalten };
};
// stand-in of the worker: records the requests
const attrappe = (stumm = false) => {
  const aufrufe = [];
  const f = async (d) => { aufrufe.push(d); return { quelle: teil(stumm) }; };
  f.aufrufe = aufrufe;
  return f;
};
const refMessung = (o = {}) => {
  const m = FIXTURE.quelle;
  return { quelle: { art: 'datei', pfad: '/x/a.wav' }, name: 'a', stumm: false, lautheit: { ...m.lautheit, lufs_i: -14 }, stereo: m.stereo, spektrum: m.spektrum, ...o };
};
const grund = (g, code) => (e) => e instanceof AusgabeFehler && e.grund === g && (code === undefined || true);
const neu = (ordner, o = {}) => new KlangReferenz({ ordner, katalogPfad: () => null, analysiere: attrappe(), ...o });

test('store: a measurement round-trips through merke, liste and lade; the file is the documented JSON', (t) => {
  const ordner = path.join(tmp(t), 'referenzen');
  const r = neu(ordner);
  const z = r.merke({ name: '  Kick Ref 808!  ', rolle: 'kick', messung: refMessung({ bereich: { von_s: 1, bis_s: 6, datei_s: 20, wahl: 'laut' } }), herkunft: 'a.wav 0:01-0:06' });
  assert.match(z.id, /^kick-ref-808-[0-9a-f]{6}$/);
  assert.deepEqual([z.name, z.rolle, z.herkunft, z.lufs_i], ['Kick Ref 808!', 'kick', 'a.wav 0:01-0:06', -14]);
  const roh = JSON.parse(fs.readFileSync(path.join(ordner, `${z.id}.json`), 'utf8'));
  assert.deepEqual(Object.keys(roh).sort(), ['erstellt', 'herkunft', 'id', 'messung', 'name', 'rolle', 'version']);
  assert.equal(roh.version, 1);
  assert.ok(!Number.isNaN(Date.parse(roh.erstellt)));
  assert.deepEqual(Object.keys(roh.messung).sort(), ['bereich', 'lautheit', 'spektrum', 'stereo']);
  assert.deepEqual(fs.readdirSync(ordner), [`${z.id}.json`], 'no temporary file is left');
  const m = r.lade(z.id);
  assert.deepEqual(m.quelle, { art: 'referenz', id: z.id });
  assert.deepEqual([m.name, m.rolle, m.stumm], ['Kick Ref 808!', 'kick', false]);
  assert.deepEqual(m.spektrum, FIXTURE.quelle.spektrum);
  assert.equal(m.bereich.wahl, 'laut');
  assert.deepEqual(r.liste(), [z]);
});

test('store: liste sorts by role in the order of ROLLEN, then by name; unreadable files are skipped', (t) => {
  const ordner = path.join(tmp(t), 'referenzen');
  const r = neu(ordner);
  const lege = (name, rolle) => r.merke({ name, rolle, messung: refMessung(), herkunft: 'x' });
  lege('Zeta', 'master'); lege('beta', 'bass'); lege('Alpha', 'bass'); lege('Kick Z', 'kick'); lege('Other', 'other');
  fs.writeFileSync(path.join(ordner, 'kaputt-abcdef.json'), '{nicht json');
  fs.writeFileSync(path.join(ordner, 'leer-123456.json'), '{}');
  fs.writeFileSync(path.join(ordner, 'notiz.txt'), 'x');
  assert.deepEqual(r.liste().map((z) => z.name), ['Kick Z', 'Alpha', 'beta', 'Zeta', 'Other']);
  assert.deepEqual(neu(path.join(ordner, 'gibt-es-nicht')).liste(), []);
  assert.ok(ROLLEN.includes('kick'));
});

test('store: loesche moves the file into .papierkorb and never unlinks; unknown or odd ids are referenz_unbekannt', (t) => {
  const ordner = path.join(tmp(t), 'referenzen');
  const r = neu(ordner);
  const z = r.merke({ name: 'Pad', rolle: 'pad', messung: refMessung(), herkunft: 'x' });
  r.loesche(z.id);
  assert.deepEqual(r.liste(), []);
  const korb = fs.readdirSync(path.join(ordner, '.papierkorb'));
  assert.equal(korb.length, 1);
  assert.match(korb[0], new RegExp(`^${z.id}\\.\\d+\\.json$`));
  assert.equal(JSON.parse(fs.readFileSync(path.join(ordner, '.papierkorb', korb[0]), 'utf8')).id, z.id);
  assert.throws(() => r.loesche(z.id), grund('referenz_unbekannt'));
  assert.throws(() => r.loesche('../../etc/passwd'), grund('referenz_unbekannt'));
  assert.throws(() => r.lade('nope-123456'), grund('referenz_unbekannt'));
});

test('store: a bad name, a bad role and a silent measurement are refused and nothing is written', (t) => {
  const ordner = path.join(tmp(t), 'referenzen');
  const r = neu(ordner);
  const m = refMessung();
  for (const name of ['', '   ', 'x'.repeat(61), 5, undefined]) assert.throws(() => r.merke({ name, rolle: 'kick', messung: m, herkunft: '' }), grund('argument_ungueltig'));
  for (const rolle of ['', 'Kick', 'tuba', undefined]) assert.throws(() => r.merke({ name: 'n', rolle, messung: m, herkunft: '' }), grund('argument_ungueltig'));
  assert.throws(() => r.merke({ name: 'n', rolle: 'kick', messung: refMessung({ stumm: true }), herkunft: '' }), grund('argument_ungueltig'));
  assert.equal(fs.existsSync(ordner), false);
  assert.equal(r.merke({ name: 'x'.repeat(60), rolle: 'fx', messung: m, herkunft: '' }).name.length, 60);
  assert.match(r.merke({ name: 'Ärger', rolle: 'fx', messung: m, herkunft: '' }).id, /^arger-[0-9a-f]{6}$/);
  assert.match(r.merke({ name: '!!!', rolle: 'fx', messung: m, herkunft: '' }).id, /^ref-[0-9a-f]{6}$/);
});

test('range: wahl laut finds the loud 5 s part of 20 s of quiet noise; the analysis gets that range as frames and offset', { skip: !HAT_FFMPEG }, async (t) => {
  const d = tmp(t), vorher = reste();
  const n = rauschen();
  const wav = schreibe(path.join(d, 'laut.wav'), 20, (s) => n() * (s >= 8 && s < 13 ? 0.5 : 0.01));
  const an = attrappe();
  const r = neu(path.join(d, 'r'), { analysiere: an });
  const m = await r.messe({ art: 'datei', pfad: wav }, 5);
  assert.equal(m.bereich.wahl, 'laut');
  assert.ok(Math.abs(m.bereich.von_s - 8) <= 0.2, `von_s ${m.bereich.von_s}`);
  assert.ok(Math.abs(m.bereich.bis_s - 13) <= 0.2, `bis_s ${m.bereich.bis_s}`);
  assert.equal(m.bereich.datei_s, 20);
  assert.equal(an.aufrufe.length, 1);
  assert.deepEqual(an.aufrufe[0].frames, [5 * RATE]);
  assert.ok(Math.abs(an.aufrufe[0].versatz[0] / RATE - 8) <= 0.2);
  assert.equal(m.name, 'laut');
  assert.deepEqual(m.quelle, { art: 'datei', pfad: wav });
  assert.equal('zeitbild' in m, false);
  assert.equal(typeof m.lautheit.lufs_i, 'number', 'the loudness was measured over the range');
  assert.deepEqual(reste(), vorher, 'the temporary folder is gone');
});

test('range: a fixed range, the whole of a short file, and the whole file without dauer_s', { skip: !HAT_FFMPEG }, async (t) => {
  const d = tmp(t);
  const lang = schreibe(path.join(d, 'lang.wav'), 20, () => 0.1);
  const kurz = schreibe(path.join(d, 'kurz.wav'), 6, () => 0.1);
  const an = attrappe();
  const r = neu(path.join(d, 'r'), { analysiere: an });
  const f = await r.messe({ art: 'datei', pfad: lang, von_s: 2.5, bis_s: 7.5 }, 5);
  assert.deepEqual(f.bereich, { von_s: 2.5, bis_s: 7.5, datei_s: 20, wahl: 'fest' });
  assert.deepEqual(an.aufrufe[0].frames, [5 * RATE]);
  assert.equal(an.aufrufe[0].versatz[0], 2.5 * RATE);
  const k = await r.messe({ art: 'datei', pfad: kurz }, 5);
  assert.deepEqual([k.bereich.wahl, k.bereich.von_s, k.bereich.datei_s], ['ganz', 0, 6]);
  assert.ok(Math.abs(k.bereich.bis_s - 6) < 0.01);
  const g = await r.messe({ art: 'datei', pfad: lang });
  assert.deepEqual([g.bereich.wahl, g.bereich.von_s, g.bereich.bis_s], ['ganz', 0, 20]);
});

test('range: bad ranges and bad dauer_s are argument_ungueltig', { skip: !HAT_FFMPEG }, async (t) => {
  const d = tmp(t);
  const wav = schreibe(path.join(d, 'a.wav'), 10, () => 0.1);
  const r = neu(path.join(d, 'r'));
  const faelle = [{ von_s: 5, bis_s: 5 }, { von_s: 5, bis_s: 4 }, { von_s: 1, bis_s: 1.5 }, { von_s: -1, bis_s: 4 }, { von_s: 0, bis_s: 11 }, { von_s: 1 }, { bis_s: 4 }];
  for (const x of faelle) await assert.rejects(r.messe({ art: 'datei', pfad: wav, ...x }), grund('argument_ungueltig'), JSON.stringify(x));
  for (const x of [3, 901, 'a', NaN]) await assert.rejects(r.messe({ art: 'datei', pfad: wav }, x), grund('argument_ungueltig'), String(x));
  await assert.rejects(r.messe({ art: 'datei', pfad: wav, sha: 'a'.repeat(64) }), grund('argument_ungueltig'));
  await assert.rejects(r.messe({ art: 'datei' }), grund('argument_ungueltig'));
  await assert.rejects(r.messe({ art: 'datei', sha: 'XYZ' }), grund('argument_ungueltig'));
  await assert.rejects(r.messe({ art: 'datei', pfad: wav, extra: 1 }), grund('argument_ungueltig'));
});

test('errors: unknown sha, relative path, missing file, not audio, unknown stored reference', { skip: !HAT_FFMPEG }, async (t) => {
  const d = tmp(t), vorher = reste();
  const text = path.join(d, 'notiz.wav');
  fs.writeFileSync(text, 'this is not audio');
  const r = neu(path.join(d, 'r'));
  const e = async (q) => r.messe(q).then(() => null, (x) => x.grund);
  assert.equal(await e({ art: 'datei', sha: 'a'.repeat(64) }), 'quelle_unbekannt');
  assert.equal(await e({ art: 'datei', pfad: 'relativ/a.wav' }), 'argument_ungueltig');
  assert.equal(await e({ art: 'datei', pfad: path.join(d, 'weg.wav') }), 'quelle_unbekannt');
  assert.equal(await e({ art: 'datei', pfad: d }), 'quelle_unbekannt', 'a folder is no file');
  assert.equal(await e({ art: 'datei', pfad: text }), 'format_falsch');
  assert.equal(await e({ art: 'referenz', id: 'gibt-es-nicht-000000' }), 'referenz_unbekannt');
  assert.equal(await e({ art: 'referenz' }), 'argument_ungueltig');
  assert.equal(await e({ art: 'sonst' }), 'argument_ungueltig');
  assert.deepEqual(reste(), vorher);
});

test('catalogue: a sha resolves through katalogPfad, the catalogue name wins over the file name; a stored reference is read by id', { skip: !HAT_FFMPEG }, async (t) => {
  const d = tmp(t);
  const wav = schreibe(path.join(d, 'datei-name.wav'), 6, () => 0.1);
  const sha = 'ab'.repeat(32);
  const r = neu(path.join(d, 'r'), { katalogPfad: (s) => (s === sha ? { pfad: wav, name: 'Catalogue Title' } : null) });
  const m = await r.messe({ art: 'datei', sha });
  assert.equal(m.name, 'Catalogue Title');
  assert.deepEqual(m.quelle, { art: 'datei', sha });
  const ohne = neu(path.join(d, 'r2'), { katalogPfad: () => ({ pfad: wav }) });
  assert.equal((await ohne.messe({ art: 'datei', sha })).name, 'datei-name');
  const z = r.merke({ name: 'Mein Ref', rolle: 'drums', messung: m, herkunft: 'x' });
  const w = await r.messe({ art: 'referenz', id: z.id });
  assert.deepEqual([w.quelle, w.name, w.rolle], [{ art: 'referenz', id: z.id }, 'Mein Ref', 'drums']);
});

test('a silent range answers stumm with all loudness values null', { skip: !HAT_FFMPEG }, async (t) => {
  const d = tmp(t);
  const wav = schreibe(path.join(d, 'still.wav'), 6, () => 0);
  const m = await neu(path.join(d, 'r'), { analysiere: attrappe(true) }).messe({ art: 'datei', pfad: wav });
  assert.equal(m.stumm, true);
  assert.ok(Object.values(m.lautheit).every((x) => x === null));
});

test('cache and join: an identical request joins the one in flight and later ones come from the cache; another range measures again', { skip: !HAT_FFMPEG }, async (t) => {
  const d = tmp(t);
  const wav = schreibe(path.join(d, 'a.wav'), 8, () => 0.1);
  const an = attrappe();
  const r = neu(path.join(d, 'r'), { analysiere: an });
  const [x, y] = await Promise.all([r.messe({ art: 'datei', pfad: wav }), r.messe({ art: 'datei', pfad: wav })]);
  assert.deepEqual(x, y);
  await r.messe({ art: 'datei', pfad: wav });
  assert.equal(an.aufrufe.length, 1);
  await r.messe({ art: 'datei', pfad: wav, von_s: 1, bis_s: 3 });
  assert.equal(an.aufrufe.length, 2);
  fs.utimesSync(wav, new Date(), new Date(Date.now() + 5000));
  await r.messe({ art: 'datei', pfad: wav });
  assert.equal(an.aufrufe.length, 3, 'a changed file is measured again');
});

test('cache: the LRU keeps lruGroesse entries', { skip: !HAT_FFMPEG }, async (t) => {
  const d = tmp(t);
  const wav = schreibe(path.join(d, 'a.wav'), 8, () => 0.1);
  const an = attrappe();
  const r = neu(path.join(d, 'r'), { analysiere: an, lruGroesse: 1 });
  await r.messe({ art: 'datei', pfad: wav, von_s: 0, bis_s: 2 });
  await r.messe({ art: 'datei', pfad: wav, von_s: 1, bis_s: 3 });
  await r.messe({ art: 'datei', pfad: wav, von_s: 0, bis_s: 2 });
  assert.equal(an.aufrufe.length, 3);
});

test('end to end: the real worker and the real ffmpeg measure a 1 kHz sine; a mono file is doubled without level loss', { skip: !HAT_FFMPEG }, async (t) => {
  const d = tmp(t), vorher = reste();
  const wav = schreibe(path.join(d, 'sinus.wav'), 4, (s) => 0.5 * Math.sin(2 * Math.PI * 1000 * s));
  const r = new KlangReferenz({ ordner: path.join(d, 'r'), katalogPfad: () => null });   // default worker, default analysis module
  const m = await r.messe({ art: 'datei', pfad: wav, von_s: 1, bis_s: 3 });
  assert.equal(m.stumm, false);
  assert.ok(Math.abs(m.lautheit.spitze_db - -6.02) < 0.1, `peak ${m.lautheit.spitze_db}`);
  assert.equal(typeof m.lautheit.lufs_i, 'number');
  assert.equal(m.spektrum.hz.length, 120);
  assert.equal('zeitbild' in m, false);
  assert.deepEqual(m.bereich, { von_s: 1, bis_s: 3, datei_s: 4, wahl: 'fest' });
  // the same tone as a mono file
  const mono = path.join(d, 'mono.wav');
  const b = Buffer.alloc(RATE * 4 * 4);
  for (let i = 0; i < RATE * 4; i++) b.writeFloatLE(0.5 * Math.sin(2 * Math.PI * 1000 * i / RATE), i * 4);
  const kopf = Buffer.alloc(44);
  kopf.write('RIFF', 0); kopf.writeUInt32LE(36 + b.length, 4); kopf.write('WAVEfmt ', 8); kopf.writeUInt32LE(16, 16); kopf.writeUInt16LE(3, 20);
  kopf.writeUInt16LE(1, 22); kopf.writeUInt32LE(RATE, 24); kopf.writeUInt32LE(RATE * 4, 28); kopf.writeUInt16LE(4, 32); kopf.writeUInt16LE(32, 34);
  kopf.write('data', 36); kopf.writeUInt32LE(b.length, 40);
  fs.writeFileSync(mono, Buffer.concat([kopf, b]));
  const mm = await r.messe({ art: 'datei', pfad: mono, von_s: 1, bis_s: 3 });
  assert.ok(Math.abs(mm.lautheit.spitze_db - m.lautheit.spitze_db) < 0.1, `mono ${mm.lautheit.spitze_db} vs stereo ${m.lautheit.spitze_db}`);
  assert.ok(Math.abs(mm.lautheit.lufs_i - m.lautheit.lufs_i) < 0.1);
  assert.deepEqual(reste(), vorher);
});

// ---- review of slice 2 ----

test('stempel: follows the file as it is now, and refuses for a removed reference and a missing file', (t) => {
  const d = tmp(t), r = neu(path.join(d, 'r'));
  const wav = schreibe(path.join(d, 'a.wav'), 1, () => 0.1);
  const a = r.stempel({ art: 'datei', pfad: wav });
  assert.equal(r.stempel({ art: 'datei', pfad: wav }), a);
  schreibe(wav, 2, () => 0.2);                                            // the file is replaced at the same path
  assert.notEqual(r.stempel({ art: 'datei', pfad: wav }), a);
  const z = r.merke({ name: 'Pad', rolle: 'pad', messung: refMessung(), herkunft: 'x' });
  assert.equal(typeof r.stempel({ art: 'referenz', id: z.id }), 'string');
  r.loesche(z.id);
  assert.throws(() => r.stempel({ art: 'referenz', id: z.id }), (e) => e instanceof AusgabeFehler && e.grund === 'referenz_unbekannt');
  assert.throws(() => r.stempel({ art: 'datei', pfad: path.join(d, 'weg.wav') }), (e) => e instanceof AusgabeFehler && e.grund === 'quelle_unbekannt');
});

test('store: a stored file with incomplete curves is skipped, and two references of one name get different ids', (t) => {
  const d = tmp(t), ordner = path.join(d, 'r'), r = neu(ordner);
  const a = r.merke({ name: 'Bass', rolle: 'bass', messung: refMessung(), herkunft: 'x' });
  const b = r.merke({ name: 'Bass', rolle: 'bass', messung: refMessung(), herkunft: 'x' });
  assert.notEqual(a.id, b.id);
  const datei = path.join(ordner, `${a.id}.json`), j = JSON.parse(fs.readFileSync(datei, 'utf8'));
  j.messung.spektrum = {}; fs.writeFileSync(datei, JSON.stringify(j));
  assert.deepEqual(r.liste().map((x) => x.id), [b.id]);
  assert.throws(() => r.lade(a.id), (e) => e instanceof AusgabeFehler && e.grund === 'referenz_unbekannt');
});

test('range: a fixed range behind the end of the audio is refused', { skip: !HAT_FFMPEG }, async (t) => {
  const d = tmp(t), r = neu(path.join(d, 'r'));
  const wav = schreibe(path.join(d, 'a.wav'), 4, () => 0.1);
  await assert.rejects(r.messe({ art: 'datei', pfad: wav, von_s: 6, bis_s: 9 }), (e) => e instanceof AusgabeFehler && e.grund === 'argument_ungueltig');
});
