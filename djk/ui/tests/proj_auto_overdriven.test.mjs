// 1.12 Automation slice 3 task 4: the server knows overridden lanes. Mirror per (track id, field) fed from /e/auto, cleared on a new core generation;
// /k/arr/auto spur 0 an 1 on start, open and new (AK34); routes POST /proj/auto/uebersteuern and /proj/auto/re_enable; proj_lage shows uebersteuert per lane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel, warte } from './support/media_library.mjs';
import { innen } from './support/inside.mjs';
import fs from 'node:fs';
import { bis, ruf, anKern, CYPHER } from './support/proj_stack.mjs';
import { KERN_AUTO_ZIELE, autoAblehnung } from '../areas/proj/core_path.ts';

const lage = async (url) => (await ruf(url, 'GET', '/proj/aktuell?noten=zahl')).j.projekt;
const lanen = async (url) => Object.fromEntries((await lage(url)).spuren.map((s) => [s.id, s.lanes ?? null]));
const frei = (log) => anKern(log, '/k/arr/auto').filter((z) => z.felder.spur === 0 && z.felder.an === 1);

async function aufbau(t) {
  const st = await stapel(t);
  const neu = await ruf(st.url, 'POST', '/proj/neu', { name: 'Uebersteuert' });
  assert.equal(neu.code, 200, JSON.stringify(neu.j));
  const a = await ruf(st.url, 'POST', '/proj/aendern', { rev: neu.j.projekt.rev, label: 'Lane', befehle: [
    { befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' }, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' },
    { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 0, wert: 0 }, { beat: 64, wert: -30 }], loesche_von: 0, loesche_bis: 100 }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  return st;
}

test('T4.1 server start, project new and open each send /k/arr/auto spur 0 an 1 (AK34)', async (t) => {
  const { log, url } = await stapel(t);
  assert.ok(await bis(() => frei(log).length >= 1), 'the server start sends it');
  assert.equal(frei(log)[0].felder.ziel, 'fader', 'ziel is still a valid name');
  const n0 = frei(log).length;
  const neu = await ruf(url, 'POST', '/proj/neu', { name: 'Frei A' });
  assert.equal(neu.code, 200, JSON.stringify(neu.j));
  assert.equal(frei(log).length, n0 + 1, 'project new sends it once');
  const o = await ruf(url, 'POST', '/proj/oeffnen', { slug: neu.j.slug });
  assert.equal(o.code, 200, JSON.stringify(o.j));
  assert.equal(frei(log).length, n0 + 2, 'project open sends it once');
  // negative control: a plain change sends nothing of the kind
  await ruf(url, 'POST', '/proj/aendern', { rev: o.j.projekt.rev, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
  assert.equal(frei(log).length, n0 + 2, 'a change does not send it');
});

test('T4.2 mirror: /e/auto sets and clears per track id and field, duplicates are idempotent, unknown track ignored, new generation clears', async (t) => {
  const { o, url } = await aufbau(t);
  const i = innen(o);
  assert.equal((await lanen(url)).s1[0].uebersteuert, undefined, 'default: no field');
  i.vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 1 });
  i.vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 1 });   // duplicate after an event overflow
  assert.equal((await lanen(url)).s1[0].uebersteuert, true);
  i.vomKern('/e/auto', { spur: 1, ziel: 'pan', zustand: 1 });     // a field without a lane in the project: no lane to show it on
  i.vomKern('/e/auto', { spur: 9, ziel: 'fader', zustand: 1 });   // no track 9
  assert.equal((await lanen(url)).s1.length, 1);
  assert.equal((await lanen(url)).s2, null);
  i.vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 0 });
  i.vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 0 });
  assert.equal((await lanen(url)).s1[0].uebersteuert, undefined, 'cleared again');
  // new generation clears
  i.vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 1 });
  assert.equal((await lanen(url)).s1[0].uebersteuert, true);
  i.vomKern('/e/neustart', { generation: (i.generation ?? 0) + 1 });
  assert.equal((await lanen(url)).s1[0].uebersteuert, undefined, 'a new core generation clears the mirror');
  // negative control: the same generation again (a re-hello) keeps it
  i.vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 1 });
  i.vomKern('/e/neustart', { generation: i.generation });
  assert.equal((await lanen(url)).s1[0].uebersteuert, true, 'same generation: unchanged');
});

test('T4.3 the full view carries auto_uebersteuert only when something is overridden; open and new clear the mirror', async (t) => {
  const { o, url } = await aufbau(t);
  const i = innen(o);
  assert.equal('auto_uebersteuert' in (await ruf(url, 'GET', '/proj/aktuell')).j, false);
  i.vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 1 });
  assert.deepEqual((await ruf(url, 'GET', '/proj/aktuell')).j.auto_uebersteuert, [{ spur_id: 's1', ziel: 'fader' }]);
  const slug = (await ruf(url, 'GET', '/proj/aktuell')).j.slug;
  await ruf(url, 'POST', '/proj/oeffnen', { slug });
  assert.equal('auto_uebersteuert' in (await ruf(url, 'GET', '/proj/aktuell')).j, false, 'reopening clears');
});

test('T4.4 routes: override request passes the real source; Cypher gets nur_andreas from the core; bad arguments', async (t) => {
  const { url, log } = await aufbau(t);
  const n0 = anKern(log, '/k/arr/auto').length;
  const r = await ruf(url, 'POST', '/proj/auto/uebersteuern', { spur_id: 's1', ziel: 'fader' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const z = anKern(log, '/k/arr/auto').slice(n0);
  assert.equal(z.length, 1);
  assert.deepEqual([z[0].felder.spur, z[0].felder.ziel, z[0].felder.an, z[0].felder.quelle], [1, 'fader', 0, 'andreas']);
  const c = await ruf(url, 'POST', '/proj/auto/uebersteuern', { spur_id: 's1', ziel: 'fader' }, CYPHER);
  assert.equal(c.code, 403, JSON.stringify(c.j));
  assert.equal(c.j.fehler, 'nur_andreas');
  assert.equal(anKern(log, '/k/arr/auto').at(-1).felder.quelle, 'cypher', 'the real source went to the core');
  assert.equal((await ruf(url, 'POST', '/proj/auto/uebersteuern', { spur_id: 's9', ziel: 'fader' })).j.fehler, 'spur_unbekannt');
  assert.equal((await ruf(url, 'POST', '/proj/auto/uebersteuern', { spur_id: 's1', ziel: 'tiefe' })).j.fehler, 'auto_ziel_unbekannt');
  assert.equal((await ruf(url, 'POST', '/proj/auto/uebersteuern', { ziel: 'fader' })).code, 400);
  assert.equal((await ruf(url, 'POST', '/proj/auto/re_enable', {})).code, 400);
  assert.equal((await ruf(url, 'POST', '/proj/auto/re_enable', { alle: false })).code, 400);
  // re-enable is allowed for Cypher, one field and all
  const n1 = anKern(log, '/k/arr/auto').length;
  assert.equal((await ruf(url, 'POST', '/proj/auto/re_enable', { spur_id: 's1', ziel: 'fader' }, CYPHER)).code, 200);
  assert.equal((await ruf(url, 'POST', '/proj/auto/re_enable', { alle: true }, CYPHER)).code, 200);
  const f = anKern(log, '/k/arr/auto').slice(n1);
  assert.deepEqual(f.map((x) => [x.felder.spur, x.felder.an, x.felder.quelle]), [[1, 1, 'cypher'], [0, 1, 'cypher']]);
});

test('T4.5 end to end through the stand-in: override while playing, /e/auto, lage, re-enable, lage; a page grip while stopped leaves the mirror unchanged', async (t) => {
  const { url, log } = await aufbau(t);
  // stopped: the request is acknowledged (D5), nothing changes
  const kalt = await ruf(url, 'POST', '/proj/auto/uebersteuern', { spur_id: 's1', ziel: 'fader' });
  assert.equal(kalt.code, 200, JSON.stringify(kalt.j));
  await warte(300);
  assert.equal((await lanen(url)).s1[0].uebersteuert, undefined, 'stopped: the mirror is unchanged');
  // play
  const st = await ruf(url, 'POST', '/proj/transport', { aktion: 'start', beat: 0 });
  assert.equal(st.code, 200, JSON.stringify(st.j));
  let spielt = false;
  for (let n = 0; n < 150 && !spielt; n++) { spielt = (await ruf(url, 'GET', '/proj/aktuell')).j.kern.status === 2; if (!spielt) await warte(40); }
  assert.ok(spielt, 'the stand-in plays');
  const r = await ruf(url, 'POST', '/proj/auto/uebersteuern', { spur_id: 's1', ziel: 'fader' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  let ueber = false;
  for (let n = 0; n < 100 && !ueber; n++) { ueber = (await lanen(url)).s1[0].uebersteuert === true; if (!ueber) await warte(30); }
  assert.ok(ueber, 'after /e/auto 1 the lage shows uebersteuert');
  // negative control: the lane of s2 does not exist, nothing shown there
  assert.equal((await lanen(url)).s2, null);
  const e = await ruf(url, 'POST', '/proj/auto/re_enable', { spur_id: 's1', ziel: 'fader' });
  assert.equal(e.code, 200, JSON.stringify(e.j));
  let weg = false;
  for (let n = 0; n < 100 && !weg; n++) { weg = (await lanen(url)).s1[0].uebersteuert === undefined; if (!weg) await warte(30); }
  assert.ok(weg, 'after re-enable and /e/auto 0 the lage is clear again');
  // all: override again, then alle
  await ruf(url, 'POST', '/proj/auto/uebersteuern', { spur_id: 's1', ziel: 'fader' });
  for (let n = 0; n < 100 && (await lanen(url)).s1[0].uebersteuert !== true; n++) await warte(30);
  assert.equal((await lanen(url)).s1[0].uebersteuert, true);
  assert.equal((await ruf(url, 'POST', '/proj/auto/re_enable', { alle: true })).code, 200);
  for (let n = 0; n < 100 && (await lanen(url)).s1[0].uebersteuert === true; n++) await warte(30);
  assert.equal((await lanen(url)).s1[0].uebersteuert, undefined, 're-enable all clears');
  await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' });
  assert.ok(log.length > 0);
});

test('F1.3 a deleted track: the core reports 0 after the track is gone, the mirror entry still clears; after undo nothing is stale', async (t) => {
  const { o, url } = await aufbau(t);
  const i = innen(o);
  i.vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 1 });
  const p = await lage(url);
  const d = await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'del', befehle: [{ befehl: 'spur_loeschen', spur_id: 's1' }] });
  assert.equal(d.code, 200, JSON.stringify(d.j));
  i.vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 0 });   // D6: the lane is gone at the snapshot swap
  const u = await ruf(url, 'POST', '/proj/undo', { rev: (await lage(url)).rev });
  assert.equal(u.code, 200, JSON.stringify(u.j));
  assert.equal((await lanen(url)).s1[0].uebersteuert, undefined, 'after undo the track is not shown as overridden');
  assert.equal('auto_uebersteuert' in (await ruf(url, 'GET', '/proj/aktuell')).j, false);
  // negative control: without the 0 from the core the entry survives the delete and undo (the core still says overridden)
  i.vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 1 });
  const p2 = await lage(url);
  await ruf(url, 'POST', '/proj/aendern', { rev: p2.rev, label: 'del', befehle: [{ befehl: 'spur_loeschen', spur_id: 's1' }] });
  await ruf(url, 'POST', '/proj/undo', { rev: (await lage(url)).rev });
  assert.equal((await lanen(url)).s1[0].uebersteuert, true, 'no report of 0: still overridden');
});

test('F1.3b a lane deleted on an existing track: the core reports 0, the lage shows no lane and no mark', async (t) => {
  const { o, url } = await aufbau(t);
  const i = innen(o);
  i.vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 1 });
  const p = await lage(url);
  await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'del lane', befehle: [{ befehl: 'auto_loeschen', lane_id: 'a1' }] });
  i.vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 0 });
  assert.equal((await lanen(url)).s1, null, 'no lane any more');
  await ruf(url, 'POST', '/proj/undo', { rev: (await lage(url)).rev });
  assert.equal((await lanen(url)).s1[0].uebersteuert, undefined, 'undo of the lane delete: not marked');
});

test('F1.5 /k/willkommen with a different generation clears the mirror, the same generation keeps it', async (t) => {
  const { o, url } = await aufbau(t);
  const i = innen(o);
  const g = i.generation ?? 0;
  i.vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 1 });
  i.vomKern('/k/willkommen', { generation: g });
  assert.equal((await lanen(url)).s1[0].uebersteuert, true, 'same generation: kept');
  i.vomKern('/k/willkommen', { generation: g + 1 });
  assert.equal((await lanen(url)).s1[0].uebersteuert, undefined, 'a different generation clears');
});

const osc = JSON.parse(fs.readFileSync(new URL('../../contract/osc.json', import.meta.url), 'utf8'));
test('F2.1 targets: the server list is the contract list (osc.json), the routes refuse geraet.* with 400 auto_ziel_unbekannt', async (t) => {
  assert.deepEqual([...KERN_AUTO_ZIELE], osc.werte.auto_ziel.liste, 'one list, pinned against osc.json');
  const { url, log } = await aufbau(t);
  const n0 = anKern(log, '/k/arr/auto').length;
  for (const ziel of ['geraet.cutoff', 'lautstaerke', '']) {
    for (const pfad of ['uebersteuern', 're_enable']) {
      const r = await ruf(url, 'POST', `/proj/auto/${pfad}`, { spur_id: 's1', ziel });
      assert.deepEqual([r.code, r.j.fehler], [400, 'auto_ziel_unbekannt'], `${pfad} ${ziel}`);
    }
  }
  assert.equal(anKern(log, '/k/arr/auto').length, n0, 'nothing went to the core');
  assert.equal((await ruf(url, 'POST', '/proj/auto/uebersteuern', { spur_id: 's1', ziel: 'solo' })).code, 200, 'negative control: a contract target passes');
});

test('F2.1b the core refusals keep their identity', () => {
  const m = (grund) => autoAblehnung(grund);
  assert.deepEqual(m('auto_ziel_unbekannt'), [400, 'auto_ziel_unbekannt']);
  assert.deepEqual(m('ki_gestoppt'), [409, 'ki_gestoppt']);
  assert.deepEqual(m('nur_andreas'), [403, 'nur_andreas']);
  assert.deepEqual(m('format'), [500, 'auto_abgelehnt'], 'format is a server bug');
  assert.deepEqual(m('irgendwas'), [409, 'auto_abgelehnt'], 'negative control: other refusals stay generic');
});

test('F2.2 Stop Cypher: both routes refuse Cypher, Andreas still works, nothing goes to the core', async (t) => {
  const { o, url, log } = await aufbau(t);
  innen(o).vomKern('/e/ki', { gestoppt: 1, grund: 'hand', sample: 0 });
  assert.ok(await bis(() => innen(o).kiGestoppt === true));
  const n0 = anKern(log, '/k/arr/auto').length;
  const a = await ruf(url, 'POST', '/proj/auto/uebersteuern', { spur_id: 's1', ziel: 'fader' }, CYPHER);
  const b = await ruf(url, 'POST', '/proj/auto/re_enable', { spur_id: 's1', ziel: 'fader' }, CYPHER);
  const c = await ruf(url, 'POST', '/proj/auto/re_enable', { alle: true }, CYPHER);
  assert.deepEqual([a, b, c].map((r) => [r.code, r.j.fehler]), [[409, 'ki_gestoppt'], [409, 'ki_gestoppt'], [409, 'ki_gestoppt']]);
  assert.equal(anKern(log, '/k/arr/auto').length, n0, 'nothing sent');
  assert.equal((await ruf(url, 'POST', '/proj/auto/uebersteuern', { spur_id: 's1', ziel: 'fader' })).code, 200, 'Andreas works');
  assert.equal((await ruf(url, 'POST', '/proj/auto/re_enable', { alle: true })).code, 200, 'Andreas works');
});

test('F2.4 a track number taken by a new track: the entry of the deleted track that remembered it is dropped', async (t) => {
  const { o, url } = await aufbau(t);
  const i = innen(o);
  i.vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 1 });
  let p = await lage(url);
  await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'del', befehle: [{ befehl: 'spur_loeschen', spur_id: 's1' }] });
  p = await lage(url);
  const n = await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'neu', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
  assert.equal(n.code, 200, JSON.stringify(n.j));
  assert.equal((await lage(url)).spuren.find((s) => s.id === 's3').nr, 1, 'the new track took nr 1');
  i.vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 0 });   // late report of the delete swap
  await ruf(url, 'POST', '/proj/undo', { rev: (await lage(url)).rev });
  await ruf(url, 'POST', '/proj/undo', { rev: (await lage(url)).rev });
  assert.equal((await lanen(url)).s1[0].uebersteuert, undefined, 'no stale mark on s1');
  assert.equal('auto_uebersteuert' in (await ruf(url, 'GET', '/proj/aktuell')).j, false);
});

test('F2.4b without a late report the entry is dropped once the number is held by another track and the state is read', async (t) => {
  const { o, url } = await aufbau(t);
  innen(o).vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 1 });
  let p = await lage(url);
  await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'del', befehle: [{ befehl: 'spur_loeschen', spur_id: 's1' }] });
  p = await lage(url);
  await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'neu', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
  await lage(url);   // a read
  await ruf(url, 'POST', '/proj/undo', { rev: (await lage(url)).rev });
  await ruf(url, 'POST', '/proj/undo', { rev: (await lage(url)).rev });
  assert.equal((await lanen(url)).s1[0].uebersteuert, undefined);
});

test('F2.M2a the open reset goes out with source andreas, also when Cypher opens', async (t) => {
  const { url, log } = await aufbau(t);
  const slug = (await ruf(url, 'GET', '/proj/aktuell')).j.slug;
  const n0 = frei(log).length;
  const r = await ruf(url, 'POST', '/proj/oeffnen', { slug }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const neu = frei(log).slice(n0);
  assert.equal(neu.length, 1);
  assert.equal(neu[0].felder.quelle, 'andreas');
});

test('F2.M2b /e/auto zustand 1 for a deleted track sets nothing (the entry it remembered keeps only what it had)', async (t) => {
  const { o, url } = await aufbau(t);
  const i = innen(o);
  i.vomKern('/e/auto', { spur: 1, ziel: 'fader', zustand: 1 });
  const p = await lage(url);
  await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'del', befehle: [{ befehl: 'spur_loeschen', spur_id: 's1' }] });
  i.vomKern('/e/auto', { spur: 1, ziel: 'pan', zustand: 1 });   // the track is gone: no mark
  await ruf(url, 'POST', '/proj/undo', { rev: (await lage(url)).rev });
  assert.deepEqual((await ruf(url, 'GET', '/proj/aktuell')).j.auto_uebersteuert, [{ spur_id: 's1', ziel: 'fader' }]);
});
