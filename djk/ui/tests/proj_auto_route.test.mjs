// Automation Slice 1, task 9 (AK24 part): proj_lage carries lanes without points, GET /proj/auto reads them back, Cypher creates lanes via proj_aendern;
// the AI stop blocks writing, not reading; two quick changes pass through the session path one after the other. Plan 2026-10-31-automation-slice1.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stapel } from './support/media_library.mjs';
import { innen } from './support/inside.mjs';
import { bis, ruf, anKern, CYPHER } from './support/proj_stack.mjs';
import { laneWert } from '../project/lane.ts';
import { MAX_AUTO_PUNKTE, MAX_LANE_PUNKTE } from '../project/model.ts';

const AUS = path.dirname(fileURLToPath(import.meta.url));
const aendern = (url, rev, befehle, kopf = CYPHER) => ruf(url, 'POST', '/proj/aendern', { rev, label: 'Lane', befehle }, kopf);

async function aufbau(t) {
  const st = await stapel(t);
  const neu = await ruf(st.url, 'POST', '/proj/neu', { name: 'Auto Route' });
  assert.equal(neu.code, 200, JSON.stringify(neu.j));
  const a = await aendern(st.url, neu.j.projekt.rev, [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' },
    { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' },
    { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 4, wert: 0 }, { beat: 20, wert: -30 }], loesche_von: 0, loesche_bis: 100 }]);
  assert.equal(a.code, 200, JSON.stringify(a.j));
  return { ...st, rev: a.j.rev };
}

test('S1 T9.1 proj_lage (noten=zahl): lanes without points; tracks without a lane keep the old shape', async (t) => {
  const { url } = await aufbau(t);
  const lage = (await ruf(url, 'GET', '/proj/aktuell?noten=zahl')).j.projekt;
  assert.deepEqual(lage.spuren[0].lanes, [{ id: 'a1', ziel: 'fader', punkte_zahl: 2 }]);
  assert.equal('automation' in lage.spuren[0], false, 'the points are not in proj_lage');
  assert.equal('lanes' in lage.spuren[1], false, 'negative control: a track without a lane has no field');
  const voll = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.equal(voll.spuren[0].automation[0].punkte.length, 2, 'the page (full) gets the points');
});

test('S1 T9.2 GET /proj/auto: points, bei_beat, range, cap, spur_id, errors', async (t) => {
  const { url } = await aufbau(t);
  const r = await ruf(url, 'GET', '/proj/auto?lane_id=a1&von_beat=0&bis_beat=32&bei_beat=12');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.punkte, [{ beat: 4, wert: 0, form: 'linear' }, { beat: 20, wert: -30, form: 'linear' }]);
  assert.equal(r.j.lane_id, 'a1'); assert.equal(r.j.spur_id, 's1'); assert.equal(r.j.ziel, 'fader'); assert.equal(r.j.punkte_zahl, 2);
  assert.deepEqual(r.j.bei, { beat: 12, wert: -15 });
  assert.equal(r.j.bei.wert, laneWert(r.j.punkte, 12, 'fader'), 'bei.wert comes from laneWert');
  // range: only the point at 20
  assert.deepEqual((await ruf(url, 'GET', '/proj/auto?lane_id=a1&von_beat=10&bis_beat=32')).j.punkte.map((p) => p.beat), [20]);
  assert.equal((await ruf(url, 'GET', '/proj/auto?lane_id=a1&bei_beat=0')).j.bei.wert, 0, 'before the first point its value holds');
  assert.equal((await ruf(url, 'GET', '/proj/auto?lane_id=a1&bei_beat=99')).j.bei.wert, -30, 'after the last point the last one holds');
  assert.equal((await ruf(url, 'GET', '/proj/auto?lane_id=a1')).j.bei, undefined, 'without bei_beat no cross-check');
  // punkte_max
  const m = await ruf(url, 'GET', '/proj/auto?lane_id=a1&punkte_max=1');
  assert.equal(m.j.punkte.length, 1); assert.equal(m.j.punkte_zahl, 2); assert.equal(m.j.punkte_gezeigt, 1);
  // spur_id returns all lanes of the track
  const s = await ruf(url, 'GET', '/proj/auto?spur_id=s1');
  assert.equal(s.j.spur_id, 's1'); assert.equal(s.j.lanes.length, 1); assert.equal(s.j.lanes[0].lane_id, 'a1');
  assert.deepEqual((await ruf(url, 'GET', '/proj/auto?spur_id=s2')).j.lanes, [], 'track without a lane: empty list');
  // errors
  const u = await ruf(url, 'GET', '/proj/auto?lane_id=a9');
  assert.equal(u.code, 404); assert.equal(u.j.fehler, 'lane_unbekannt'); assert.match(u.j.text, /lane/);
  assert.equal((await ruf(url, 'GET', '/proj/auto?spur_id=s9')).code, 404);
  assert.equal((await ruf(url, 'GET', '/proj/auto')).code, 400);
  assert.equal((await ruf(url, 'GET', '/proj/auto?lane_id=a1&bei_beat=abc')).code, 400);
  assert.equal((await ruf(url, 'GET', '/proj/auto?lane_id=a1&punkte_max=0')).code, 400);
});

test('S1 T9.3 GET /proj/auto without an open project: kein_projekt', async (t) => {
  const { url } = await stapel(t);
  const r = await ruf(url, 'GET', '/proj/auto?lane_id=a1');
  assert.equal(r.j.fehler, 'kein_projekt');
});

test('S1 T9.4 end to end: Cypher creates lane and points, reads them back; rev_veraltet; history source cypher; AI stop blocks writing, not reading', async (t) => {
  const { o, url, rev } = await aufbau(t);
  const b = await aendern(url, rev, [{ befehl: 'auto_neu', spur_id: 's2', ziel: 'fader' },
    { befehl: 'auto_punkte', lane_id: 'a2', setze: [{ beat: 8, wert: -6, form: 's' }], loesche_von: 0, loesche_bis: 100 }]);
  assert.equal(b.code, 200, JSON.stringify(b.j));
  const r = await ruf(url, 'GET', '/proj/auto?lane_id=a2');
  assert.deepEqual(r.j.punkte, [{ beat: 8, wert: -6, form: 's' }]);
  const veraltet = await aendern(url, rev, [{ befehl: 'auto_loeschen', lane_id: 'a2' }]);
  assert.equal(veraltet.j.fehler, 'rev_veraltet'); assert.equal((await ruf(url, 'GET', '/proj/auto?lane_id=a2')).code, 200, 'nothing changed');
  const verlauf = (await ruf(url, 'GET', '/proj/verlauf')).j;
  assert.ok(verlauf.some((e) => e.quelle === 'cypher'), JSON.stringify(verlauf.map((e) => e.quelle)));
  // KI-Stopp
  const ctx = o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => innen(o).kiGestoppt));
  const aktuell = (await ruf(url, 'GET', '/proj/aktuell?nur=rev')).j.rev;
  const g = await aendern(url, aktuell, [{ befehl: 'auto_loeschen', lane_id: 'a2' }]);
  assert.equal(g.code, 409); assert.equal(g.j.fehler, 'ki_gestoppt');
  assert.equal((await ruf(url, 'GET', '/proj/auto?lane_id=a2')).code, 200, 'reading stays allowed');
  assert.equal((await aendern(url, aktuell, [{ befehl: 'auto_loeschen', lane_id: 'a2' }], {})).code, 200, 'cross-check: Andreas keeps writing');
});

test('S1 T9.5 the server limits equal the core constants (arr_playback.h)', () => {
  const h = fs.readFileSync(path.join(AUS, '..', '..', 'core', 'include', 'cypherdj', 'arr_playback.h'), 'utf8');
  assert.match(h, new RegExp(`ARR_AUTO_PUNKTE_MAX\\s*=\\s*${MAX_AUTO_PUNKTE};`));
  assert.match(h, new RegExp(`ARR_AUTO_LANE_PUNKTE_MAX\\s*=\\s*${MAX_LANE_PUNKTE};`));
});

test('S1 T9.6 two quick changes: two playback files with rising nr, the core keeps the second, no parallel load', async (t) => {
  const { url, log, rev } = await aufbau(t);
  const geladen0 = anKern(log, '/k/arr/laden').length;
  const p1 = aendern(url, rev, [{ befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 8, wert: -5 }] }]);
  const p2 = aendern(url, rev + 1, [{ befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 9, wert: -6 }] }]);
  const [x, y] = await Promise.all([p1, p2]);
  assert.equal(x.code, 200, JSON.stringify(x.j)); assert.equal(y.code, 200, JSON.stringify(y.j));
  assert.ok(await bis(() => anKern(log, '/k/arr/laden').length === geladen0 + 2, 5000), 'two load commands');
  const nrn = anKern(log, '/k/arr/laden').slice(geladen0).map((z) => z.felder.nr);
  assert.ok(nrn[1] > nrn[0], `rising nr: ${nrn}`);
  const lage = (await ruf(url, 'GET', '/proj/aktuell')).j;
  assert.equal(lage.projekt.wiedergabe_rev, nrn[1], 'the server holds the second');
  assert.deepEqual((await ruf(url, 'GET', '/proj/auto?lane_id=a1')).j.punkte.map((p) => p.beat), [4, 8, 9, 20]);
  // negative control: a single change yields exactly one file
  const vor = anKern(log, '/k/arr/laden').length;
  const z = await aendern(url, lage.projekt.rev, [{ befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 10, wert: -7 }] }]);
  assert.equal(z.code, 200);
  assert.ok(await bis(() => anKern(log, '/k/arr/laden').length === vor + 1, 5000));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(anKern(log, '/k/arr/laden').length, vor + 1, 'exactly one file');
});

test('S2 T1.7 a locked lane reports gesperrt: true in proj_lage and GET /proj/auto; an unlocked one has no key', async (t) => {
  const { url, rev } = await aufbau(t);
  const b = await aendern(url, rev, [{ befehl: 'auto_neu', spur_id: 's2', ziel: 'pan' }, { befehl: 'auto_neu', spur_id: 's2', ziel: 'mute' },
    { befehl: 'auto_aendern', lane_id: 'a1', gesperrt: true }]);
  assert.equal(b.code, 200, JSON.stringify(b.j));
  const lage = (await ruf(url, 'GET', '/proj/aktuell?noten=zahl')).j.projekt;
  assert.deepEqual(lage.spuren[0].lanes, [{ id: 'a1', ziel: 'fader', punkte_zahl: 2, gesperrt: true }]);
  assert.deepEqual(lage.spuren[1].lanes.map((l) => l.ziel), ['pan', 'mute']);
  assert.equal('gesperrt' in lage.spuren[1].lanes[0], false, 'negative control: an unlocked lane has no gesperrt key');
  const r = await ruf(url, 'GET', '/proj/auto?lane_id=a1');
  assert.equal(r.j.gesperrt, true);
  assert.equal(r.j.ziel, 'fader'); assert.deepEqual(r.j.bei, undefined);
  assert.equal((await ruf(url, 'GET', '/proj/auto?lane_id=a2')).j.gesperrt, undefined, 'unlocked: no key in /proj/auto');
  const alle = (await ruf(url, 'GET', '/proj/auto?spur_id=s1')).j.lanes;
  assert.equal(alle[0].gesperrt, true);
  // the mute lane comes back with sprung points
  assert.deepEqual((await ruf(url, 'GET', '/proj/auto?lane_id=a3')).j.punkte.map((p) => p.form), ['sprung', 'sprung']);
  // writing a locked lane over HTTP: 409 lane_gesperrt
  const aktuell = (await ruf(url, 'GET', '/proj/aktuell?nur=rev')).j.rev;
  const g = await aendern(url, aktuell, [{ befehl: 'auto_loeschen', lane_id: 'a1' }]);
  assert.equal(g.code, 409); assert.equal(g.j.fehler, 'lane_gesperrt'); assert.match(g.j.text, /^[\x20-\x7e]+$/);
});
