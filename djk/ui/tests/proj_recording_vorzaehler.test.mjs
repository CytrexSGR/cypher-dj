// 1.8 S4b.1 / S4b.1a (D7, D8): count-in and a take inside a running transport through the real page server with the stand-in core, in real time.
// The stand-in learned both in this unit (contract/mock_core/rec.mjs, arr.mjs): the count-in moves the entry of the waiting transport, a running transport starts the
// take at the next project bar. Test hooks of the stand-in: ATTRAPPE_EINSATZ_VERZUG_MS (entry of the waiting transport), ATTRAPPE_REC_LAUFEND_VERZUG_MS (running start).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { ruf, anKern, CYPHER, warte } from './support/proj_stack.mjs';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-vz-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

// A stack whose stand-in runs at `bpm`, a project at that tempo with one track armed on erz/1 and the count-in set in the project.
async function aufbau(t, { bpm = 200, vorzaehler = 0, env = {}, name = 'VZ' } = {}) {
  const d = tmp(t);
  const { url, log } = await stapel(t, { proj: { arbeitsordner: path.join(d, 'arr') }, attrappe: { toml: `start_bpm = ${bpm}\n`, env } });
  await ruf(url, 'POST', '/proj/neu', { name });
  assert.equal((await ruf(url, 'GET', '/lage')).j.uhr.bpm, bpm, 'the stand-in runs at the test tempo (no tempo ramp before the start)');
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Spur', befehle: [{ befehl: 'tempo_setzen', bpm }, { befehl: 'spur_neu', art: 'audio', name: 'Gitarre' }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const p = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  const befehle = [{ befehl: 'spur_aendern', spur_id: p.spuren[0].id, eingang: { art: 'intern', name: 'erz/1' }, arm: true }];
  if (vorzaehler > 0) befehle.push({ befehl: 'aufnahme_setzen', vorzaehler_takte: vorzaehler });
  const b = await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'Arm', befehle });
  assert.equal(b.code, 200, JSON.stringify(b.j));
  return { url, log, id: p.spuren[0].id, nr: p.spuren[0].nr, bpm };
}

test('S4b.1a: 200 BPM, count-in 4 bars (16 beats = 4.8 s, longer than the old 4 s cap): 200 laeuft only at the entry, the core got vorzaehler_takte 4, no /k/rec/stopp', async (t) => {
  const e = await aufbau(t, { bpm: 200, vorzaehler: 4 });
  const t0 = Date.now();
  const st = await ruf(e.url, 'POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 });
  const dauer = Date.now() - t0;
  assert.equal(st.code, 200, JSON.stringify(st.j));
  assert.equal(st.j.aufnahme, 'laeuft');
  assert.equal(anKern(e.log, '/k/rec/start')[0].felder.vorzaehler_takte, 4, 'the project count-in reaches the core');
  assert.ok(dauer >= 4500, `the answer comes at the entry (after the count-in), not after the old 4 s cap: ${dauer} ms`);
  assert.equal(anKern(e.log, '/k/rec/stopp').length, 0, 'nothing was aborted');
  assert.equal(anKern(e.log, '/k/arr/stopp').length, 0);
  const lauf = (await ruf(e.url, 'GET', '/proj/aufnahme')).j.lauf;
  assert.equal(lauf.start_beat, 0, 'the take starts at the transport start beat (the count-in lies before it)');
  await warte(300);
  const stop = await ruf(e.url, 'POST', '/proj/aufnahme', { aktion: 'stopp' });
  assert.equal(stop.code, 200, JSON.stringify(stop.j));
  assert.ok(stop.j.takes[0].frames > 0 && !stop.j.takes[0].fehler, JSON.stringify(stop.j.takes[0]));
  const clip = (await ruf(e.url, 'GET', '/proj/aktuell')).j.projekt.spuren[0].clips[0];
  assert.equal(clip.start_beat, 0);
});

test('S4b.1a Negativ-Kontrolle: count-in 0, stopped transport, the entry delayed by 7 s: the wait is not widened (4 s transport cap plus 0.4 s, the answer of the unchanged path)', async (t) => {
  const e = await aufbau(t, { bpm: 128, env: { ATTRAPPE_EINSATZ_VERZUG_MS: '7000' } });
  const t0 = Date.now();
  const st = await ruf(e.url, 'POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 });
  const dauer = Date.now() - t0;
  assert.equal(anKern(e.log, '/k/rec/start')[0].felder.vorzaehler_takte, 0);
  // measured on the code before this change: receipt 1 of the transport is the last one seen at the cap, so the run is declared running; the entry is still 2.5 s away
  assert.equal(st.code, 200, JSON.stringify(st.j));
  assert.ok(dauer >= 4300 && dauer < 5600, `no wider horizon without a count-in: ${dauer} ms`);
  assert.equal(anKern(e.log, '/k/rec/stopp').length, 0);
  await ruf(e.url, 'POST', '/proj/aufnahme', { aktion: 'stopp' });
});

const kernStatus = async (url) => (await ruf(url, 'GET', '/proj/aktuell')).j.kern?.status;
async function transportLaeuft(e, quelle = {}) {
  const tr = await ruf(e.url, 'POST', '/proj/transport', { aktion: 'start', beat: 0 }, quelle);
  assert.equal(tr.code, 200, JSON.stringify(tr.j));
  for (let i = 0; i < 200 && (await kernStatus(e.url)) !== 2; i++) await warte(25);
  assert.equal(await kernStatus(e.url), 2, 'the transport plays');
}

test('S4b.1: Andreas records inside his running transport: no transport call, the take begins at a bar, the receipt arrives 4.5 s late and is waited for; stopping ends the recording only', async (t) => {
  const e = await aufbau(t, { bpm: 128, env: { ATTRAPPE_REC_LAUFEND_VERZUG_MS: '4500' } });
  await transportLaeuft(e);
  const anzahlArrStart = anKern(e.log, '/k/arr/start').length;
  await warte(700);
  const t0 = Date.now();
  const st = await ruf(e.url, 'POST', '/proj/aufnahme', { aktion: 'start' });
  const dauer = Date.now() - t0;
  assert.equal(st.code, 200, JSON.stringify(st.j));
  assert.equal(st.j.laufend, true);
  assert.ok(dauer >= 4300, `waited for receipt 2 (the old 400 ms would have returned before the take began): ${dauer} ms`);
  assert.equal(anKern(e.log, '/k/arr/start').length, anzahlArrStart, 'no transport start for a recording into a running transport');
  assert.equal(anKern(e.log, '/k/rec/stopp').length, 0, 'nothing was aborted');
  assert.equal(st.j.start_beat % 4, 0, `the take begins on a bar: ${st.j.start_beat}`);
  assert.ok(st.j.start_beat > 0, `...behind the transport start: ${st.j.start_beat}`);
  const lauf = (await ruf(e.url, 'GET', '/proj/aufnahme')).j.lauf;
  assert.equal(lauf.laufend, true);
  assert.equal(lauf.start_beat, st.j.start_beat);
  await warte(400);
  const stop = await ruf(e.url, 'POST', '/proj/aufnahme', { aktion: 'stopp' });
  assert.equal(stop.code, 200, JSON.stringify(stop.j));
  assert.equal(anKern(e.log, '/k/arr/stopp').length, 0, 'stopping a running-start recording sends no transport stop');
  assert.equal(anKern(e.log, '/k/rec/stopp').length, 1);
  assert.equal(await kernStatus(e.url), 2, 'the transport keeps playing');
  assert.ok(stop.j.takes[0].frames > 0 && !stop.j.takes[0].fehler, JSON.stringify(stop.j.takes[0]));
  const clip = (await ruf(e.url, 'GET', '/proj/aktuell')).j.projekt.spuren[0].clips[0];
  assert.equal(clip.start_beat, st.j.start_beat, 'the clip sits where the receipt said the take began');
  await ruf(e.url, 'POST', '/proj/transport', { aktion: 'stopp' });
});

test('S4b.1: Cypher never records into a running transport (transport_laeuft, nothing sent); a stopped transport is the slice 1 path', async (t) => {
  const e = await aufbau(t, { bpm: 128 });
  await transportLaeuft(e);
  const r = await ruf(e.url, 'POST', '/proj/aufnahme', { aktion: 'start' }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [409, 'transport_laeuft']);
  assert.equal(anKern(e.log, '/k/rec/start').length, 0);
  await ruf(e.url, 'POST', '/proj/transport', { aktion: 'stopp' });
  for (let i = 0; i < 200 && (await kernStatus(e.url)) !== 0; i++) await warte(25);
  const ok = await ruf(e.url, 'POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 }, CYPHER);
  assert.equal(ok.code, 200, JSON.stringify(ok.j));
  assert.equal(ok.j.laufend, undefined, 'negative control: a start from a stopped transport is not marked running');
  await warte(300);
  assert.equal((await ruf(e.url, 'POST', '/proj/aufnahme', { aktion: 'stopp' }, CYPHER)).code, 200);
  assert.equal(anKern(e.log, '/k/arr/stopp').length >= 1, true, 'the slice 1 stop ends the transport');
});

test('S4b.1: the key vorzaehl_beats of the internal transport call is refused on POST /proj/transport (argument_ungueltig), nothing reaches the core', async (t) => {
  const e = await aufbau(t, { bpm: 128 });
  const r = await ruf(e.url, 'POST', '/proj/transport', { aktion: 'start', beat: 0, vorzaehl_beats: 4 });
  assert.deepEqual([r.code, r.j.fehler], [400, 'argument_ungueltig']);
  assert.equal(anKern(e.log, '/k/arr/start').length, 0);
  const ok = await ruf(e.url, 'POST', '/proj/transport', { aktion: 'start', beat: 0 });   // negative control: the same call without the key starts
  assert.equal(ok.code, 200, JSON.stringify(ok.j));
  assert.equal(anKern(e.log, '/k/arr/start').length, 1);
  await ruf(e.url, 'POST', '/proj/transport', { aktion: 'stopp' });
});
