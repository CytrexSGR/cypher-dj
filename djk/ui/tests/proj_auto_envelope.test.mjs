// 1.12 automation slice 5, unit U11 (T11.1, AK24 part): proj_lage lists a clip's envelopes without points (huellkurven [{ziel, punkte_zahl}]), and
// GET /proj/auto?clip_id=..&ziel=.. reads the envelope back: points, range, cap, bei_beat from hkWert (clip beats, linked and unlinked repetition),
// every envelope of a clip without ziel, errors with their reasons. The page (full view) keeps the points.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { ruf, CYPHER } from './support/proj_stack.mjs';
import { baueKatalog, ksha } from './support/catalog.mjs';
import { wav } from './support/proj_context.mjs';
import { tmpOrdner } from './support/project.mjs';
import { hkWert } from '../project/envelope.ts';

const RAMPE = [{ beat: 0, wert: -12 }, { beat: 4, wert: 0 }];
async function aufbau(t) {
  const d = tmpOrdner(t, 'djk-auto-hk-');
  const w = wav(path.join(d, 'data'), 'loop.wav', 3.84);
  const katalog = baueKatalog(path.join(d, 'kat'), [{ n: 1, typ: 'loop', bpm: 125, takte: 2, dauer_s: 3.84, pfad: w }]);
  const { url } = await stapel(t, { katalog });
  const neu = await ruf(url, 'POST', '/proj/neu', { name: 'Auto Huelle' });
  assert.equal(neu.code, 200, JSON.stringify(neu.j));
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: neu.j.projekt.rev, label: 'Setup', befehle: [
    { befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 8, loop_beats: 4, sha256: ksha(1) },
    { befehl: 'clip_neu', spur_id: 's2', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: ksha(1) },
    { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: RAMPE },
    { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'spur_fader', verknuepft: false, loop_beats: 2, punkte: [{ beat: 0, wert: 0 }, { beat: 2, wert: -6 }] },
  ] }, CYPHER);
  assert.equal(a.code, 200, JSON.stringify(a.j));
  return { url, rev: a.j.projekt.rev, slug: neu.j.slug };
}

test('U11 T11.1 proj_lage (noten=zahl): a clip lists huellkurven [{ziel, punkte_zahl}] without points; a clip without one has no field; the page view keeps the points', async (t) => {
  const { url } = await aufbau(t);
  const lage = (await ruf(url, 'GET', '/proj/aktuell?noten=zahl')).j.projekt;
  const c1 = lage.spuren[0].clips[0], c2 = lage.spuren[1].clips[0];
  assert.deepEqual(c1.huellkurven, [{ ziel: 'gain', punkte_zahl: 2 }, { ziel: 'spur_fader', punkte_zahl: 2, verknuepft: false, loop_beats: 2 }]);
  assert.equal('huellkurven' in c2, false, 'negative control: a clip without envelopes has no field');
  const voll = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.equal(voll.spuren[0].clips[0].huellkurven[0].punkte.length, 2, 'the page (full view) gets the points');
});

// review fix (MAJOR): proj_oeffnen (POST /proj/oeffnen?antwort=kurz) lists the envelopes without points too, for audio AND midi clips
test('U11 review fix: POST /proj/oeffnen?antwort=kurz lists huellkurven [{ziel, punkte_zahl}] without points (audio and midi clip); a clip without one has no field; the full answer keeps the points', async (t) => {
  const { url, rev, slug } = await aufbau(t);
  const m = await ruf(url, 'POST', '/proj/aendern', { rev, label: 'midi hk', befehle: [
    { befehl: 'spur_neu', art: 'instrument' },
    { befehl: 'clip_neu', spur_id: 's3', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 100 }] },
    { befehl: 'huellkurve_setzen', clip_id: 'c3', ziel: 'transpose', punkte: [{ beat: 0, wert: 0 }, { beat: 2, wert: 7 }, { beat: 4, wert: 0 }] },
  ] }, CYPHER);
  assert.equal(m.code, 200, JSON.stringify(m.j));
  const o = await ruf(url, 'POST', '/proj/oeffnen?antwort=kurz', { slug }, CYPHER);
  assert.equal(o.code, 200, JSON.stringify(o.j));
  const clip = (id) => o.j.spuren.flatMap((s) => s.clips).find((c) => c.id === id);
  assert.deepEqual(clip('c1').huellkurven, [{ ziel: 'gain', punkte_zahl: 2 }, { ziel: 'spur_fader', punkte_zahl: 2, verknuepft: false, loop_beats: 2 }], 'audio clip: summary, no points');
  assert.deepEqual(clip('c3').huellkurven, [{ ziel: 'transpose', punkte_zahl: 3 }], 'midi clip: summary, no points');
  assert.equal(clip('c3').noten_zahl, 1);
  assert.equal(JSON.stringify(o.j).includes('"punkte"'), false, 'no point list anywhere in the short open answer');
  assert.equal('huellkurven' in clip('c2'), false, 'negative control: a clip without envelopes has no field');
  const voll = await ruf(url, 'POST', '/proj/oeffnen', { slug });
  assert.equal(voll.j.projekt.spuren[0].clips[0].huellkurven[0].punkte.length, 2, 'the page (no antwort=kurz) keeps the points');
});

test('U11 T11.1 GET /proj/auto?clip_id&ziel: points, bei_beat from hkWert (linked repeats with the clip loop, unlinked with its own), range, cap', async (t) => {
  const { url } = await aufbau(t);
  const r = await ruf(url, 'GET', '/proj/auto?clip_id=c1&ziel=gain&bei_beat=2');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.punkte, [{ beat: 0, wert: -12, form: 'linear' }, { beat: 4, wert: 0, form: 'linear' }]);
  assert.deepEqual([r.j.clip_id, r.j.spur_id, r.j.ziel, r.j.punkte_zahl, r.j.punkte_gezeigt, r.j.verknuepft], ['c1', 's1', 'gain', 2, 2, true]);
  assert.deepEqual(r.j.bei, { beat: 2, wert: -6 });
  assert.equal(r.j.bei.wert, hkWert({ ziel: 'gain', punkte: RAMPE }, 2, 4), 'bei.wert comes from hkWert');
  // linked: the clip loop (4) repeats the envelope, clip beat 6 reads like beat 2
  assert.equal((await ruf(url, 'GET', '/proj/auto?clip_id=c1&ziel=gain&bei_beat=6')).j.bei.wert, -6);
  assert.equal((await ruf(url, 'GET', '/proj/auto?clip_id=c1&ziel=gain&bei_beat=100')).j.bei.wert, -12, 'clip beat 100 = loop copy 25, beat 0 of the loop: -12, not the last value');
  assert.ok(Math.abs((await ruf(url, 'GET', '/proj/auto?clip_id=c1&ziel=gain&bei_beat=7.9')).j.bei.wert + 0.3) < 1e-9, '7.9 reads like 3.9');
  // unlinked with its own loop 2: clip beat 3 reads like beat 1
  const u = await ruf(url, 'GET', '/proj/auto?clip_id=c1&ziel=spur_fader&bei_beat=3');
  assert.deepEqual([u.j.verknuepft, u.j.loop_beats, u.j.bei.wert], [false, 2, -3]);
  assert.equal((await ruf(url, 'GET', '/proj/auto?clip_id=c1&ziel=gain')).j.bei, undefined, 'without bei_beat no cross-check');
  assert.deepEqual((await ruf(url, 'GET', '/proj/auto?clip_id=c1&ziel=gain&von_beat=1&bis_beat=8')).j.punkte.map((p) => p.beat), [4]);
  const m = (await ruf(url, 'GET', '/proj/auto?clip_id=c1&ziel=gain&punkte_max=1')).j;
  assert.deepEqual([m.punkte.length, m.punkte_zahl, m.punkte_gezeigt, m.weiter_ab_beat], [1, 2, 1, 4]);
});

test('U11 T11.1 GET /proj/auto?clip_id without ziel lists every envelope of the clip; a clip without one gives an empty list', async (t) => {
  const { url } = await aufbau(t);
  const r = (await ruf(url, 'GET', '/proj/auto?clip_id=c1')).j;
  assert.equal(r.clip_id, 'c1'); assert.equal(r.spur_id, 's1');
  assert.deepEqual(r.huellkurven.map((h) => h.ziel), ['gain', 'spur_fader']);
  assert.equal(r.huellkurven[1].punkte.length, 2);
  assert.deepEqual((await ruf(url, 'GET', '/proj/auto?clip_id=c2')).j.huellkurven, []);
});

test('U11 T11.1 GET /proj/auto clip errors: clip_unbekannt 404, huellkurve_unbekannt 404, huellkurve_ziel 400, lane_id with clip_id 400, ziel without clip_id 400', async (t) => {
  const { url } = await aufbau(t);
  const grund = async (q) => { const r = await ruf(url, 'GET', `/proj/auto?${q}`); return [r.code, r.j.fehler]; };
  assert.deepEqual(await grund('clip_id=c9&ziel=gain'), [404, 'clip_unbekannt']);
  assert.deepEqual(await grund('clip_id=c2&ziel=gain'), [404, 'huellkurve_unbekannt']);
  assert.deepEqual(await grund('clip_id=c1&ziel=transpose'), [404, 'huellkurve_unbekannt'], 'a valid target the clip does not carry');
  assert.deepEqual(await grund('clip_id=c1&ziel=cutoff'), [400, 'huellkurve_ziel'], 'not a target at all');
  assert.deepEqual(await grund('clip_id=c1&lane_id=a1'), [400, 'argument_ungueltig']);
  assert.deepEqual(await grund('ziel=gain'), [400, 'argument_ungueltig']);
  assert.deepEqual(await grund('clip_id=c1&ziel=gain&bei_beat=abc'), [400, 'argument_ungueltig']);
});
