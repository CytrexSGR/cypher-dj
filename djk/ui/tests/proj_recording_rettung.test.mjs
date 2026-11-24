// B11 task 2: the rescue conversion when a project opens. A run file left by a killed page server names the core's raw f32; rettePendelnde converts it into a
// take WAV plus a record file, gerettetListe lists it. Crash points: still writing, already placed, a second crash during the rescue.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GERETTET_FORMAT, LAUF_FORMAT, gerettetListe, laufDateiPfad, rettePendelnde, starteRettung } from '../areas/proj/recording_rettung.ts';
import { schreibeWavAusF32Stueckweise } from '../project/recording.ts';
import { tmpOrdner } from './support/project.mjs';

const leeresProjekt = { spuren: [] };
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// a project folder with aufnahmen/ and a work folder; one run file with `spuren` (nr 1.. by default), f32 files of the given frame counts, sidecars with `status`
function aufbau(t, { kennung = 7, spuren = [{ nr: 1, frames: 100, status: 'fertig' }], projekt = leeresProjekt, lauf = {} } = {}) {
  const d = tmpOrdner(t, 'djk-rettung-');
  const ordner = path.join(d, 'projekt'), arr = path.join(d, 'arr');
  fs.mkdirSync(path.join(ordner, 'aufnahmen'), { recursive: true });
  fs.mkdirSync(arr, { recursive: true });
  const dateien = spuren.map((s) => {
    const f32 = path.join(arr, `aufnahme-${s.nr}-${kennung}.f32`);
    if (s.frames !== null) {
      const buf = Buffer.alloc(s.frames * 8);
      for (let i = 0; i < s.frames * 2; i++) buf.writeFloatLE(Math.fround(0.5 * Math.sin((i + s.nr) / 11)), i * 4);
      fs.writeFileSync(f32, buf);
      if (s.status) fs.writeFileSync(f32.replace(/\.f32$/, '.json'), JSON.stringify({ status: s.status }));
    }
    return { id: `spur-${s.nr}`, nr: s.nr, name: `Track ${s.nr}`, versatz_samples: 12, f32 };
  });
  const laufDatei = { format: LAUF_FORMAT, projekt: 'p', kennung, seit: new Date().toISOString(), start_beat: 8, tempo_bpm: 120, nachlauf_samples: 5,
    spuren: dateien, midi_spuren: [], ...lauf };
  fs.writeFileSync(laufDateiPfad(ordner, kennung), JSON.stringify(laufDatei));
  const log = [];
  return { d, ordner, arr, dateien, kennung, log, opt: { projekt, arbeitsordner: arr, log: (e) => log.push(e) }, aufn: path.join(ordner, 'aufnahmen'),
    typen: (typ) => log.filter((e) => e.typ === typ) };
}

test('a finished take: WAV (58-byte header + 8 bytes per frame), record file, run file gone; the list carries the fields plan 2 needs; sha256 is independent', async (t) => {
  const a = aufbau(t);
  await rettePendelnde(a.ordner, a.opt);
  const wav = path.join(a.aufn, 'take-7-1-gerettet.wav');
  assert.equal(fs.statSync(wav).size, 58 + 8 * 100);
  assert.equal(fs.existsSync(path.join(a.aufn, '.gerettet-7-1.json')), true);
  assert.equal(fs.existsSync(laufDateiPfad(a.ordner, 7)), false, 'the run file is removed');
  const l = await gerettetListe(a.ordner);
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].datei, l[0].frames, l[0].start_beat, l[0].spur_id, l[0].abgebrochen, l[0].gerettet], ['take-7-1-gerettet.wav', 100, 8, 'spur-1', false, true]);
  assert.deepEqual([l[0].spur_name, l[0].tempo_bpm, l[0].versatz_samples, l[0].nachlauf_samples], ['Track 1', 120, 12, 5]);
  assert.equal(l[0].sha256, sha(wav), 'the sha256 equals an independent hash of the WAV bytes');
  const rec = JSON.parse(fs.readFileSync(path.join(a.aufn, '.gerettet-7-1.json'), 'utf8'));
  assert.equal(rec.format, GERETTET_FORMAT);
  assert.deepEqual(fs.readFileSync(wav).subarray(58), fs.readFileSync(a.dateien[0].f32), 'the WAV data is the raw file');
  assert.equal(fs.existsSync(a.dateien[0].f32), true, 'the raw f32 stays (the core\'s work folder)');
});

test('sidecar status: luecken is not aborted; abgebrochen, kein_platz and laeuft-but-stale are', async (t) => {
  for (const [status, erwartet] of [['luecken', false], ['abgebrochen', true], ['kein_platz', true], ['laeuft', true]]) {
    const a = aufbau(t, { spuren: [{ nr: 1, frames: 10, status }] });
    await rettePendelnde(a.ordner, { ...a.opt, jetzt: () => Date.now() + 60000 });   // the f32 is a minute old: stale
    const l = await gerettetListe(a.ordner);
    assert.equal(l.length, 1, status);
    assert.equal(l[0].abgebrochen, erwartet, status);
  }
});

test('two tracks: both converted; one f32 missing: the other still converted, run file removed, the missing one logged and not listed', async (t) => {
  const a = aufbau(t, { spuren: [{ nr: 1, frames: 30, status: 'fertig' }, { nr: 2, frames: 40, status: 'fertig' }] });
  await rettePendelnde(a.ordner, a.opt);
  assert.deepEqual((await gerettetListe(a.ordner)).map((x) => [x.datei, x.frames]), [['take-7-1-gerettet.wav', 30], ['take-7-2-gerettet.wav', 40]]);
  const b = aufbau(t, { spuren: [{ nr: 1, frames: 30, status: 'fertig' }, { nr: 2, frames: null }] });
  await rettePendelnde(b.ordner, b.opt);
  assert.deepEqual((await gerettetListe(b.ordner)).map((x) => x.datei), ['take-7-1-gerettet.wav']);
  assert.equal(b.typen('proj_rettung_datei_fehlt').length, 1);
  assert.equal(fs.existsSync(laufDateiPfad(b.ordner, 7)), false);
});

test('a zero-frame f32 is resolved without an entry and the run file is removed', async (t) => {
  const a = aufbau(t, { spuren: [{ nr: 1, frames: 0, status: 'fertig' }] });
  await rettePendelnde(a.ordner, a.opt);
  assert.deepEqual(await gerettetListe(a.ordner), []);
  assert.equal(fs.existsSync(laufDateiPfad(a.ordner, 7)), false);
});

test('a run file kept after uebernahme_fehler (take-<k>-<nr>.wav exists, no clip): the rescue creates its own -gerettet WAV and offers it', async (t) => {
  const a = aufbau(t);
  fs.mkdirSync(path.join(a.aufn, 'take-7-1.wav'));   // what the failed hand-over left in the way
  await rettePendelnde(a.ordner, a.opt);
  assert.deepEqual((await gerettetListe(a.ordner)).map((x) => x.datei), ['take-7-1-gerettet.wav']);
});

test('the open stays responsive: a 10 ms timer keeps firing while a 40 MB f32 is converted', async (t) => {
  const a = aufbau(t, { spuren: [{ nr: 1, frames: 5_000_000, status: 'fertig' }] });
  let ticks = 0;
  const uhr = setInterval(() => { ticks++; }, 10);
  const t0 = Date.now();
  try { await rettePendelnde(a.ordner, a.opt); } finally { clearInterval(uhr); }
  const ms = Date.now() - t0;
  assert.ok(ticks >= Math.min(5, Math.floor(ms / 40)) && ticks >= 3, `the timer fired ${ticks} times during ${ms} ms`);
  assert.equal(fs.statSync(path.join(a.aufn, 'take-7-1-gerettet.wav')).size, 58 + 8 * 5_000_000);
});

test('Review focus (still writing): sidecar laeuft and a fresh f32: nothing created, run file stays, list empty, no error; after the limit it converts', async (t) => {
  const a = aufbau(t, { spuren: [{ nr: 1, frames: 50, status: 'laeuft' }] });
  await rettePendelnde(a.ordner, a.opt);   // real clock: the f32 was just written
  assert.deepEqual(await gerettetListe(a.ordner), []);
  assert.equal(fs.existsSync(laufDateiPfad(a.ordner, 7)), true, 'the run file stays');
  assert.deepEqual(fs.readdirSync(a.aufn).filter((n) => n.includes('gerettet')), []);
  assert.equal(a.typen('proj_rettung_fehler').length, 0);
  await rettePendelnde(a.ordner, { ...a.opt, jetzt: () => Date.now() + 10001 });   // the injected clock is past staleMs
  assert.equal((await gerettetListe(a.ordner)).length, 1);
  assert.equal((await gerettetListe(a.ordner))[0].frames, 50, 'converted with what exists');
  assert.equal(fs.existsSync(laufDateiPfad(a.ordner, 7)), false);
});

test('Review focus (still writing, two tracks): one stale and one fresh: the stale one is converted, the run file stays until both are resolved', async (t) => {
  const a = aufbau(t, { spuren: [{ nr: 1, frames: 20, status: 'fertig' }, { nr: 2, frames: 20, status: 'laeuft' }] });
  await rettePendelnde(a.ordner, a.opt);
  assert.deepEqual((await gerettetListe(a.ordner)).map((x) => x.datei), ['take-7-1-gerettet.wav']);
  assert.equal(fs.existsSync(laufDateiPfad(a.ordner, 7)), true);
  await rettePendelnde(a.ordner, { ...a.opt, jetzt: () => Date.now() + 20000 });
  assert.equal((await gerettetListe(a.ordner)).length, 2);
  assert.equal(fs.existsSync(laufDateiPfad(a.ordner, 7)), false);
});

test('Review focus (already placed): a project clip already references the converted sha256: no record, the temporary WAV is dropped, the run file removed', async (t) => {
  const probe = aufbau(t);
  await rettePendelnde(probe.ordner, probe.opt);
  const hash = (await gerettetListe(probe.ordner))[0].sha256;
  const projekt = { spuren: [{ id: 'spur-1', clips: [{ quelle: { sha256: hash, pfad_hinweis: 'x' } }] }] };
  const a = aufbau(t, { projekt });
  await rettePendelnde(a.ordner, a.opt);
  assert.deepEqual(await gerettetListe(a.ordner), []);
  assert.deepEqual(fs.readdirSync(a.aufn).filter((n) => n.includes('gerettet')), [], 'no record, no WAV, no tmp');
  assert.equal(fs.existsSync(laufDateiPfad(a.ordner, 7)), false);
  // also when the match is a clip in a take lane
  const b = aufbau(t, { projekt: { spuren: [{ id: 'spur-1', clips: [], takes: [{ id: 't', clips: [{ quelle: { sha256: hash } }] }] }] } });
  await rettePendelnde(b.ordner, b.opt);
  assert.deepEqual(await gerettetListe(b.ordner), []);
});

test('Review focus (second crash): a stale .wav.tmp and a final WAV without its record: the next call finishes correctly, exactly one entry; a second call changes nothing', async (t) => {
  const a = aufbau(t);
  fs.writeFileSync(path.join(a.aufn, 'take-7-1-gerettet.wav.tmp'), 'half a wav');
  fs.writeFileSync(path.join(a.aufn, 'take-7-1-gerettet.wav'), 'corrupt, no record');
  await rettePendelnde(a.ordner, a.opt);
  const l = await gerettetListe(a.ordner);
  assert.equal(l.length, 1);
  const wav = path.join(a.aufn, 'take-7-1-gerettet.wav');
  assert.equal(fs.statSync(wav).size, 58 + 800, 'the WAV was rebuilt from the f32');
  assert.equal(l[0].sha256, sha(wav));
  assert.equal(fs.existsSync(`${wav}.tmp`), false);
  const vorher = fs.readdirSync(a.aufn).sort().map((n) => [n, fs.statSync(path.join(a.aufn, n)).mtimeMs]);
  await rettePendelnde(a.ordner, a.opt);
  assert.deepEqual(fs.readdirSync(a.aufn).sort().map((n) => [n, fs.statSync(path.join(a.aufn, n)).mtimeMs]), vorher, 'nothing changes the second time');
  assert.equal((await gerettetListe(a.ordner)).length, 1);
});

test('Review focus (second crash, run file left after a complete rescue): record and WAV exist: resolved without a new conversion, run file removed, one entry', async (t) => {
  const a = aufbau(t);
  await rettePendelnde(a.ordner, a.opt);
  fs.writeFileSync(laufDateiPfad(a.ordner, 7), JSON.stringify({ format: LAUF_FORMAT, kennung: 7, seit: '', start_beat: 8, tempo_bpm: 120, nachlauf_samples: 5, midi_spuren: [], projekt: 'p', spuren: a.dateien }));
  let n = 0;
  await rettePendelnde(a.ordner, { ...a.opt, schreibe: (...x) => { n++; return schreibeWavAusF32Stueckweise(...x); } });
  assert.equal(n, 0);
  assert.equal(fs.existsSync(laufDateiPfad(a.ordner, 7)), false);
  assert.equal((await gerettetListe(a.ordner)).length, 1);
});

test('a run file with an unknown format or not JSON is left untouched and logged, never deleted', async (t) => {
  const a = aufbau(t, { lauf: { format: 'cypherdj-lauf/99' } });
  const vorher = fs.readFileSync(laufDateiPfad(a.ordner, 7), 'utf8');
  fs.writeFileSync(laufDateiPfad(a.ordner, 8), '{ not json');
  await rettePendelnde(a.ordner, a.opt);
  assert.equal(fs.readFileSync(laufDateiPfad(a.ordner, 7), 'utf8'), vorher);
  assert.equal(fs.readFileSync(laufDateiPfad(a.ordner, 8), 'utf8'), '{ not json');
  assert.equal(a.typen('proj_rettung_lauf_unbekannt').length, 1);
  assert.equal(a.typen('proj_rettung_lauf_unlesbar').length, 1);
  assert.deepEqual(await gerettetListe(a.ordner), []);
});

test('a MIDI-only run file is resolved with a log line and removed', async (t) => {
  const a = aufbau(t, { spuren: [], lauf: { midi_spuren: ['spur-9'] } });
  await rettePendelnde(a.ordner, a.opt);
  assert.equal(a.typen('proj_rettung_nur_midi').length, 1);
  assert.equal(fs.existsSync(laufDateiPfad(a.ordner, 7)), false);
});

test('a corrupt record is skipped and logged by gerettetListe; entries sort by kennung then nr', async (t) => {
  const a = aufbau(t, { spuren: [{ nr: 2, frames: 10, status: 'fertig' }, { nr: 1, frames: 10, status: 'fertig' }] });
  await rettePendelnde(a.ordner, a.opt);
  fs.writeFileSync(path.join(a.aufn, '.gerettet-3-1.json'), 'garbage');
  const log = [];
  const l = await gerettetListe(a.ordner, (e) => log.push(e));
  assert.deepEqual(l.map((x) => x.datei), ['take-7-1-gerettet.wav', 'take-7-2-gerettet.wav']);
  assert.equal(log.length, 1);
});

test('two concurrent rettePendelnde and gerettetListe calls on one folder produce one conversion', async (t) => {
  const a = aufbau(t, { spuren: [{ nr: 1, frames: 200000, status: 'fertig' }] });
  let n = 0;
  const opt = { ...a.opt, schreibe: (...x) => { n++; return schreibeWavAusF32Stueckweise(...x); } };
  const p1 = rettePendelnde(a.ordner, opt), p2 = rettePendelnde(a.ordner, opt);
  const liste = gerettetListe(a.ordner);   // awaits the running rescue
  await Promise.all([p1, p2]);
  assert.equal((await liste).length, 1, 'the list waited for the rescue');
  assert.equal(n, 1);
});

test('hook: starteRettung with a ProjZugang stub: skipped while a recording runs (next open does it), otherwise it starts and does not block the open', async (t) => {
  const a = aufbau(t, { spuren: [{ nr: 1, frames: 3_000_000, status: 'fertig' }] });
  let f = null, aktiv = true, ende = false;
  const zugang = { beiOffen: (cb) => { f = cb; }, offen: () => ({ slug: 'p', ordner: a.ordner, projekt: leeresProjekt }), aufnahmeAktiv: () => aktiv, arbeitsordner: () => a.arr };
  const ctx = { log: (e) => a.log.push(e) };
  let n = 0;
  starteRettung(zugang, ctx, { schreibe: (...x) => { n++; return schreibeWavAusF32Stueckweise(...x).finally(() => { ende = true; }); } });
  assert.equal(typeof f, 'function', 'the hook registered its callback');
  f(null);   // a close: nothing
  f('p');    // an open while a recording runs
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(n, 0, 'no rescue while recording');
  assert.equal(fs.existsSync(laufDateiPfad(a.ordner, 7)), true);
  aktiv = false;
  f('p');
  assert.equal(ende, false, 'the callback returned before the conversion ended');
  await gerettetListe(a.ordner);
  assert.equal(n, 1);
  assert.equal(ende, true);
  assert.equal((await gerettetListe(a.ordner)).length, 1);
  // a ProjZugang without beiOffen is fine
  starteRettung({ offen: () => null }, ctx);
});

test('hook against the real session: an open with a left run file starts the rescue after the open completed (offen() is usable)', async (t) => {
  const { projBereich } = await import('../areas/proj/area.ts');
  const { pruefKontext } = await import('./support/proj_context.mjs');
  const k = pruefKontext();
  const d = tmpOrdner(t, 'djk-rettung-sitz-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  starteRettung(b.zugang, k);
  const neu = await b.sitzung.neu('Rescue', 'andreas');
  const slug = neu.j.slug;
  const ordner = b.zugang.offen().ordner;
  await b.sitzung.schliessen('andreas');
  // the crash left a run file and the core's raw take
  fs.mkdirSync(path.join(ordner, 'aufnahmen'), { recursive: true });
  const f32 = path.join(d, 'arr', 'aufnahme-1-9.f32');
  fs.mkdirSync(path.dirname(f32), { recursive: true });
  fs.writeFileSync(f32, Buffer.alloc(8 * 64, 1));
  fs.writeFileSync(f32.replace(/\.f32$/, '.json'), JSON.stringify({ status: 'fertig' }));
  fs.writeFileSync(laufDateiPfad(ordner, 9), JSON.stringify({ format: LAUF_FORMAT, projekt: slug, kennung: 9, seit: '', start_beat: 2, tempo_bpm: 120,
    nachlauf_samples: 0, midi_spuren: [], spuren: [{ id: 's1', nr: 1, name: 'G', versatz_samples: 0, f32 }] }));
  const r = await b.sitzung.oeffnen(slug, 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j).slice(0, 200));
  const l = await gerettetListe(ordner);
  assert.deepEqual(l.map((x) => [x.datei, x.frames, x.start_beat]), [['take-9-1-gerettet.wav', 64, 2]]);
  assert.equal(fs.existsSync(laufDateiPfad(ordner, 9)), false);
});

// ---- security: the f32 path of a run file is data, not a command ----
test('a crafted run file naming a file outside the work folder (PoC /etc/os-release) is dropped with a log line and creates nothing', async (t) => {
  const a = aufbau(t, { spuren: [] });
  const lauf = JSON.parse(fs.readFileSync(laufDateiPfad(a.ordner, 7), 'utf8'));
  lauf.spuren = [{ id: 's1', nr: 1, name: 'x', versatz_samples: 0, f32: '/etc/os-release' }];
  fs.writeFileSync(laufDateiPfad(a.ordner, 7), JSON.stringify(lauf));
  await rettePendelnde(a.ordner, { ...a.opt, jetzt: () => Date.now() + 1e6 });
  assert.deepEqual(fs.readdirSync(a.aufn), [], 'no WAV, no record, run file dropped');
  assert.equal(a.typen('proj_rettung_lauf_pfad_abgelehnt').length, 1);
  assert.deepEqual(await gerettetListe(a.ordner), []);
});

test('path variants are refused: a file under another name, a relative path, a missing sidecar, another track number', async (t) => {
  for (const fall of ['name', 'relativ', 'ohne_json', 'andere_nr']) {
    const a = aufbau(t, { spuren: [{ nr: 1, frames: 10, status: 'fertig' }] });
    const lauf = JSON.parse(fs.readFileSync(laufDateiPfad(a.ordner, 7), 'utf8'));
    const f32 = lauf.spuren[0].f32;
    if (fall === 'name') { const neu = path.join(a.arr, 'geheim.f32'); fs.copyFileSync(f32, neu); lauf.spuren[0].f32 = neu; }
    if (fall === 'relativ') lauf.spuren[0].f32 = path.relative(process.cwd(), f32);
    if (fall === 'ohne_json') fs.rmSync(f32.replace(/\.f32$/, '.json'));
    if (fall === 'andere_nr') lauf.spuren[0].nr = 2;
    fs.writeFileSync(laufDateiPfad(a.ordner, 7), JSON.stringify(lauf));
    await rettePendelnde(a.ordner, { ...a.opt, jetzt: () => Date.now() + 1e6 });
    assert.deepEqual(fs.readdirSync(a.aufn), [], fall);
    assert.equal(a.typen('proj_rettung_lauf_pfad_abgelehnt').length, 1, fall);
  }
});

test('a symlink in the work folder that points outside is refused (f32 and sidecar)', async (t) => {
  for (const was of ['f32', 'json']) {
    const a = aufbau(t, { spuren: [{ nr: 1, frames: 10, status: 'fertig' }] });
    const f32 = JSON.parse(fs.readFileSync(laufDateiPfad(a.ordner, 7), 'utf8')).spuren[0].f32;
    const aussen = path.join(a.d, 'aussen.bin');
    fs.writeFileSync(aussen, was === 'f32' ? Buffer.alloc(800, 3) : JSON.stringify({ status: 'fertig' }));
    const ziel = was === 'f32' ? f32 : f32.replace(/\.f32$/, '.json');
    fs.rmSync(ziel);
    fs.symlinkSync(aussen, ziel);
    await rettePendelnde(a.ordner, { ...a.opt, jetzt: () => Date.now() + 1e6 });
    assert.deepEqual(fs.readdirSync(a.aufn), [], was);
    assert.equal(a.typen('proj_rettung_lauf_pfad_abgelehnt').length, 1, was);
  }
});

test('a work folder given as a symlink is resolved by realpath and still accepted', async (t) => {
  const a = aufbau(t, { spuren: [{ nr: 1, frames: 10, status: 'fertig' }] });
  const link = path.join(a.d, 'arr-link');
  fs.symlinkSync(a.arr, link);
  await rettePendelnde(a.ordner, { ...a.opt, arbeitsordner: link, jetzt: () => Date.now() + 1e6 });
  assert.equal((await gerettetListe(a.ordner)).length, 1);
});

// ---- the "already placed" check is per track ----
test('two tracks of one run with identical audio are both rescued; a track that already holds the audio is skipped, the other is not', async (t) => {
  const gleich = (a) => { for (const f of a.dateien) fs.writeFileSync(f.f32, Buffer.alloc(8 * 50, 0)); };   // digital silence on both tracks
  const a = aufbau(t, { spuren: [{ nr: 1, frames: 50, status: 'fertig' }, { nr: 2, frames: 50, status: 'fertig' }] });
  gleich(a);
  await rettePendelnde(a.ordner, a.opt);
  const l = await gerettetListe(a.ordner);
  assert.equal(l.length, 2, 'both tracks are offered');
  assert.equal(l[0].sha256, l[1].sha256, 'the audio really is identical');
  const b = aufbau(t, { spuren: [{ nr: 1, frames: 50, status: 'fertig' }, { nr: 2, frames: 50, status: 'fertig' }],
    projekt: { spuren: [{ id: 'spur-1', clips: [{ id: 'c1', sha256: l[0].sha256 }], takes: [] }, { id: 'spur-2', clips: [], takes: [] }] } });
  gleich(b);
  await rettePendelnde(b.ordner, b.opt);
  assert.deepEqual((await gerettetListe(b.ordner)).map((x) => x.spur_id), ['spur-2']);
});
