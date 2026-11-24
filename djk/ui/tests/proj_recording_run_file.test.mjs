// B11 task 1: the run file at REC (<project>/aufnahmen/.laufend-<kennung>.json) written through the real recording flow, removed after a take hand-over that
// placed everything, kept when the take could not be placed, and a failing hook can never stop, delay or block a recording.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { projBereich } from '../areas/proj/area.ts';
import { aufnahmeBereich } from '../areas/proj/recording.ts';
import { laufDateiBleibt, laufDateiPfad, schreibeLaufDatei, entferneLaufDatei, LAUF_FORMAT } from '../areas/proj/recording_rettung.ts';
import { pruefKontext, warteBis } from './support/proj_context.mjs';
import { tmpOrdner } from './support/project.mjs';

const ergebnis = async (p) => { try { const r = await p; return { code: r.code, j: r.j }; } catch (x) { return { code: x.code, fehler: x.fehler, grund: x.extra?.grund }; } };
const angenommen = { status: 1, grund: '' };
const laeuft = { status: 2, grund: '' };

async function bereit(t, { rec = [angenommen, laeuft], zugang, laufDatei, arm = true } = {}) {
  const k = pruefKontext();
  const roh = k.warteQuittung.bind(k), zaehler = new Map();
  k.warteQuittung = async (id) => {
    const g = k.gesendet.find((x) => x.id === id);
    if (g?.adresse !== '/k/rec/start') return roh(id);
    const n = (zaehler.get(id) ?? 0) + 1;
    zaehler.set(id, n);
    return rec[Math.min(n, rec.length) - 1];
  };
  const d = tmpOrdner(t, 'djk-lauf-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  const br = aufnahmeBereich(k, zugang ? zugang(b.zugang) : b.zugang, { fristMs: 60, laufDatei });
  t.after(() => br.aufnahme.schliesse());
  const s = b.sitzung, a = br.aufnahme;
  await s.neu('R', 'andreas');
  s.ereignis('/uhr', { beat: 2, bpm: 120 });
  await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'G' }] }, 'andreas');
  const pr = s.aktuell().j.projekt;
  if (arm) await s.aendern({ rev: pr.rev, label: 'Arm', befehle: [{ befehl: 'spur_aendern', spur_id: pr.spuren[0].id, eingang: { art: 'intern', name: 'erz/1' }, arm: true }] }, 'andreas');
  k.leere();
  const kern = (adr, f) => { b.ereignis(adr, f); a.ereignis(adr, f); };
  const p = s.aktuell().j.projekt;
  const ordner = b.zugang.offen().ordner;
  const lauefe = () => { try { return fs.readdirSync(path.join(ordner, 'aufnahmen')).filter((n) => n.startsWith('.laufend-')); } catch { return []; } };
  return { k, b, s, a, kern, nr: p.spuren[0].nr, spurId: p.spuren[0].id, slug: b.zugang.offen().slug, ordner, arr: path.join(d, 'arr'), lauefe };
}
// the take as the core would leave it: 100 frames of f32 in the work folder, then the report
function nehmeAuf(e, kennung, frames = 100) {
  fs.mkdirSync(e.arr, { recursive: true });
  const buf = Buffer.alloc(frames * 8);
  for (let i = 0; i < frames * 2; i++) buf.writeFloatLE(0.25 * Math.sin(i / 7), i * 4);
  fs.writeFileSync(path.join(e.arr, `aufnahme-${e.nr}-${kennung}.f32`), buf);
  e.kern('/e/aufnahme', { spur: e.nr, kennung, status: 0, frames, start_sample: 0n, luecken: 0 });
}

test('REC writes the run file with project, start beat, tempo, offset and the f32 path; the answer and the file agree', async (t) => {
  const e = await bereit(t);
  const r = await ergebnis(e.a.start({ von_beat: 4 }, 'andreas'));
  assert.equal(r.code, 200, JSON.stringify(r));
  const pfad = laufDateiPfad(e.ordner, r.j.kennung);
  assert.ok(fs.existsSync(pfad), 'the run file exists while the run is going');
  const d = JSON.parse(fs.readFileSync(pfad, 'utf8'));
  assert.equal(d.format, LAUF_FORMAT);
  assert.equal(d.projekt, e.slug);
  assert.equal(d.kennung, r.j.kennung);
  assert.equal(d.start_beat, r.j.start_beat);
  assert.equal(d.tempo_bpm, e.s.aktuell().j.projekt.tempo_bpm);
  assert.equal(d.nachlauf_samples, r.j.nachlauf_samples);
  assert.equal(d.spuren.length, 1);
  assert.ok(d.spuren[0].f32.endsWith(`aufnahme-${e.nr}-${r.j.kennung}.f32`));
  assert.ok(path.isAbsolute(d.spuren[0].f32));
  assert.equal(d.spuren[0].versatz_samples, r.j.spuren[0].versatz_samples);
  assert.equal(d.spuren[0].id, e.spurId);
  assert.deepEqual(d.midi_spuren, []);
  assert.ok(!Number.isNaN(Date.parse(d.seit)));
  assert.deepEqual(fs.readdirSync(path.join(e.ordner, 'aufnahmen')).filter((n) => n.endsWith('.tmp')), [], 'no temp file is left behind');
});

test('STOP and a normal hand-over of every track removes the run file', async (t) => {
  const e = await bereit(t);
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  nehmeAuf(e, r.j.kennung);
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 1000), 'the run ended');
  assert.equal(e.a.lage().j.letzte.takes[0].fehler, undefined, 'the take was placed');
  assert.deepEqual(e.lauefe(), []);
});

test('a run the core discards (aufnahme_abgebrochen) removes the run file', async (t) => {
  const e = await bereit(t, { rec: [angenommen, angenommen] });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.equal(r.code, 200);
  assert.equal(e.lauefe().length, 1);
  e.kern('/q', { id: e.k.an('/k/rec/start')[0].id, status: 7, grund: 'abbruch' });
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 1000));
  assert.deepEqual(e.lauefe(), []);
});

test('uebernehmen throwing (uebernimm rejects) leaves the run file', async (t) => {
  const e = await bereit(t, { zugang: (z) => ({ ...z, uebernimm: async () => { throw new Error('disk full'); } }) });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  nehmeAuf(e, r.j.kennung);
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 1000));
  assert.equal(e.a.lage().j.letzte.code, 500, 'the hand-over failed');
  assert.equal(e.lauefe().length, 1, 'the take was not placed: the run file stays for the rescue');
});

test('through the real flow: a take whose WAV cannot be written (uebernahme_fehler) leaves the run file', async (t) => {
  const e = await bereit(t);
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  fs.mkdirSync(path.join(e.ordner, 'aufnahmen', `take-${r.j.kennung}-${e.nr}.wav`), { recursive: true });   // the target name is taken: wx fails
  nehmeAuf(e, r.j.kennung);
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 1000));
  assert.equal(e.a.lage().j.letzte.takes[0].fehler, 'uebernahme_fehler');
  assert.equal(e.lauefe().length, 1);
});

test('through the real flow: a take that reports but whose f32 is missing (datei_fehlt, f32 gone) removes the run file', async (t) => {
  const e = await bereit(t);
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  e.kern('/e/aufnahme', { spur: e.nr, kennung: r.j.kennung, status: 0, frames: 10, start_sample: 0n, luecken: 0 });
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 1000));
  assert.equal(e.a.lage().j.letzte.takes[0].fehler, 'datei_fehlt');
  assert.deepEqual(e.lauefe(), [], 'nothing to rescue');
});

test('laufDateiBleibt: the keep/delete table', () => {
  const da = new Set([1, 3]);
  const f32 = (n) => (da.has(n) ? process.execPath : '/nonexistent/aufnahme.f32');   // an existing and a missing path
  const bleibt = (...e) => laufDateiBleibt(e, f32);
  assert.equal(bleibt({ spur_id: 'a', spur_nr: 1, frames: 5 }), false, 'placed');
  assert.equal(bleibt({ spur_id: 'a', spur_nr: 1, fehler: 'datei_fehlt' }), true, 'datei_fehlt, f32 present');
  assert.equal(bleibt({ spur_id: 'a', spur_nr: 2, fehler: 'datei_fehlt' }), false, 'datei_fehlt, f32 gone');
  assert.equal(bleibt({ spur_id: 'a', spur_nr: 1, fehler: 'veraltet_spur' }), true, 'veraltet_spur, f32 present');
  assert.equal(bleibt({ spur_id: 'a', spur_nr: 2, fehler: 'veraltet_spur' }), false, 'veraltet_spur, f32 gone');
  for (const g of ['uebernahme_fehler', 'takes_voll', 'zu_gross', 'ersetzen_loop', 'irgendwas']) assert.equal(bleibt({ spur_id: 'a', spur_nr: 2, fehler: g }), true, g);
  assert.equal(bleibt({ spur_id: 'a', spur_nr: 1, fehler: 'leer' }), false, 'leer');
  assert.equal(bleibt({ spur_id: 'a', spur_nr: 1, fehler: 'punch_leer' }), false, 'punch_leer');
  assert.equal(bleibt({ spur_id: 'a', spur_nr: 1, frames: 5 }, { spur_id: 'b', spur_nr: 3, fehler: 'uebernahme_fehler' }), true, 'mixed');
  assert.equal(bleibt({ spur_id: 'i', art: 'midi', fehler: 'keine_noten' }), false, 'a MIDI failure is not recoverable and does not keep the file');
  assert.equal(bleibt(), false);
});

test('schreibeLaufDatei / entferneLaufDatei: atomic write, false and no throw on failure, missing file is fine', (t) => {
  const d = tmpOrdner(t, 'djk-lauf-fn-');
  const x = { format: LAUF_FORMAT, projekt: 'p', kennung: 5, seit: new Date().toISOString(), start_beat: 0, tempo_bpm: 120, nachlauf_samples: 0, spuren: [], midi_spuren: [] };
  assert.equal(schreibeLaufDatei(d, x), true, 'creates aufnahmen/ when missing');
  assert.deepEqual(JSON.parse(fs.readFileSync(laufDateiPfad(d, 5), 'utf8')), x);
  entferneLaufDatei(d, 5); entferneLaufDatei(d, 5);
  assert.equal(fs.existsSync(laufDateiPfad(d, 5)), false);
  fs.writeFileSync(path.join(d, 'blockiert'), 'x');
  assert.equal(schreibeLaufDatei(path.join(d, 'blockiert'), x), false, 'a folder that is a file: false, no throw');
});

test('Review focus: aufnahmen/ is a regular file: REC still starts (laeuft), the failure is logged as proj_lauf_datei_fehler', async (t) => {
  const e = await bereit(t);
  fs.rmSync(path.join(e.ordner, 'aufnahmen'), { recursive: true, force: true });
  fs.writeFileSync(path.join(e.ordner, 'aufnahmen'), 'not a folder');
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.equal(r.code, 200, JSON.stringify(r));
  assert.equal(r.j.aufnahme, 'laeuft');
  assert.ok(e.k.protokoll.some((z) => z.typ === 'proj_lauf_datei_fehler'), 'logged');
  assert.equal(e.b.sitzung.ladenGesperrt(), true, 'the lock is held');
});

test('Review focus: the hook THROWS: REC still starts, aufnahmeLauf was called, the lock is held until the end and released after STOP', async (t) => {
  let lauefe = 0;
  const e = await bereit(t, {
    zugang: (z) => ({ ...z, aufnahmeLauf: (l) => { if (l) lauefe++; z.aufnahmeLauf(l); } }),
    laufDatei: { schreibe: () => { throw new Error('boom'); }, entferne: () => { throw new Error('boom too'); } },
  });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.equal(r.code, 200, JSON.stringify(r));
  assert.equal(r.j.aufnahme, 'laeuft');
  assert.equal(lauefe, 1, 'zugang.aufnahmeLauf was called with the run');
  assert.ok(e.k.protokoll.some((z) => z.typ === 'proj_lauf_datei_fehler' && z.fehler === 'boom'), 'logged');
  assert.equal(e.b.sitzung.ladenGesperrt(), true);
  const zweiter = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.deepEqual([zweiter.code, zweiter.fehler], [409, 'aufnahme_laeuft'], 'a second start is refused as without the hook');
  const s = await ergebnis(e.a.stopp('andreas'));
  assert.equal(s.code, 200, 'the removal hook that throws cannot hurt the end of the run either');
  assert.equal(e.b.sitzung.ladenGesperrt(), false, 'released after STOP');
  assert.equal(e.a.lage().j.lauf, null);
});

test('rejected starts leave no run file behind (the core discards; nothing armed)', async (t) => {
  const e = await bereit(t, { rec: [angenommen, { status: 7, grund: 'zu_spaet' }] });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.deepEqual([r.code, r.fehler], [409, 'aufnahme_abgebrochen']);
  assert.deepEqual(e.lauefe(), []);
  const n = await bereit(t, { arm: false });
  const q = await ergebnis(n.a.start({ von_beat: 0 }, 'andreas'));
  assert.deepEqual([q.code, q.fehler], [409, 'nichts_scharf']);
  assert.deepEqual(n.lauefe(), []);
});
