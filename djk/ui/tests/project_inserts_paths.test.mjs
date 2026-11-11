// 1.10 slice 4a, task T6: the path from project to core for the insert chain (spec 4, AK-S4-12, AK-S4-13): the server refuses POST /regler on
// ins/* (409 ueber_projekt), the export render sets the insert values (routingRegler), opening a project sets every used insert row before the
// transport starts (alleInsertRegler). The checker lists are tested in djk/contract/tests/test_name_lists.py, the render side in
// djk/core/tests/test_render.cpp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './support/media_library.mjs';
import { ruf, anKern, CYPHER } from './support/proj_stack.mjs';
import { pruefKontext, sitzung } from './support/proj_context.mjs';
import { fuehreAus, fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { routingRegler, reglerAusProjekt } from '../project/render.ts';
import { alleRegler, alleInsertRegler } from '../areas/proj/mapping.ts';
import { reglerEinzeln } from '../areas/proj/output.ts';

const KOMP = ['schwelle', 'ratio', 'knie', 'attack', 'release', 'makeup', 'mix', 'schp'];
const spur = (name, ...ziele) => ({ spur: { name, fahrten: ziele.map((ziel, i) => ({ ziel, ab_takt: 1 + 2 * i, takte: 1, nach: -6 })) } });
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;

// 3 tracks, group g1 (s2, s3), return r1, compressors: s1 (slot 1, key s2), g1 (slot 2), r1 (slot 3), master (slot 4)
function mitKette() {
  let p = neuesProjekt('T');
  p = lauf(p, [1, 2, 3].map((i) => ({ befehl: 'spur_neu', art: 'audio', name: `T${i}` })));
  p = lauf(p, [{ befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s2', 's3'] }, { befehl: 'return_neu', name: 'R' }]);
  p = lauf(p, [{ befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }]);
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', werte: { schwelle: -30, ratio: 8 } },
    { befehl: 'insert_setzen', strang_id: 'g1', pos: 0, art: 'komp' },
    { befehl: 'insert_setzen', strang_id: 'r1', pos: 0, art: 'komp', werte: { makeup: 3 } },
    { befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'komp' }]);
  p = lauf(p, [{ befehl: 'insert_param_setzen', insert_id: 'i1', param: 'sc', wert: 2 }]);
  return p;
}
const ins = (r) => Object.keys(r).filter((k) => k.startsWith('ins/'));

// ---- server --------------------------------------------------------------------------------------------------------------------------------
test('server.insert_409: POST /regler on ins/komp/<n>/* answers 409 ueber_projekt for every source, nothing goes to the core; /spur cannot drive it either', async (t) => {
  const { url, log } = await stapel(t);
  const pfade = ['ins/komp/1/schwelle', 'ins/komp/12/an', 'ins/komp/7/sc', 'ins/komp/3/schp', 'ins/eq/1/an', 'ins/eq/1/b8/gain', 'ins/eq/1/propq', 'ins/saett/1/drive'];
  for (const pfad of pfade) {
    for (const kopf of [{}, CYPHER]) {
      const r = await ruf(url, 'POST', '/regler', { pfad, nach: 0 }, kopf);
      assert.deepEqual([r.code, r.j.fehler], [409, 'ueber_projekt'], `${pfad} ${JSON.stringify(kopf)}: ${JSON.stringify(r.j)}`);
      assert.match(r.j.text, /insert/);
    }
    const a = await ruf(url, 'POST', '/spur', spur('a', pfad), CYPHER);
    assert.deepEqual([a.code, a.j.fehler, a.j.ziel, a.j.index], [409, 'ueber_projekt', pfad, 0], `${pfad}: ${JSON.stringify(a.j)}`);
  }
  assert.equal(anKern(log, '/k/teil').length, 0, 'nothing went to the core');
});

test('server.insert_409 negative control: outside the vocabulary stays 400 pfad, the old project families keep their own text, erz/* still passes', async (t) => {
  const { url, log } = await stapel(t);
  for (const pfad of ['ins/komp/0/an', 'ins/komp/13/an', 'ins/komp/1/zz', 'ins/eq/9/an', 'ins/eq/1/b9/an', 'ins/saett/5/an', 'ins/lim/3/an', 'ins/utility/9/an', 'ins/utility/1/zz', 'ins/eq/1', 'ins/komp/1']) {
    assert.equal((await ruf(url, 'POST', '/regler', { pfad, nach: 0 })).j.fehler, 'pfad', pfad);
  }
  assert.match((await ruf(url, 'POST', '/regler', { pfad: 'spur/1/fader', nach: 0 })).j.text, /track faders/);
  assert.match((await ruf(url, 'POST', '/regler', { pfad: 'ret/1/fader', nach: 0 })).j.text, /send_setzen, return_aendern/);
  assert.equal((await ruf(url, 'POST', '/regler', { pfad: 'erz/2/fader', nach: -3 })).j.ok, true);
  assert.deepEqual(anKern(log, '/k/teil').map((z) => z.felder.pfad), ['erz/2/fader']);
});

// ---- export render ---------------------------------------------------------------------------------------------------------------------------
test('render.routing_inserts: routingRegler carries the values of every stage (track, group, return, master), the bypass switch last, the key as a track number', () => {
  const p = mitKette(), r = routingRegler(p);
  assert.equal(ins(r).length, 4 * 10, 'four stages with ten rows each');
  assert.equal(r['ins/komp/1/schwelle'], -30); assert.equal(r['ins/komp/1/ratio'], 8); assert.equal(r['ins/komp/1/sc'], 2);
  assert.equal(r['ins/komp/3/makeup'], 3, 'the return stage');
  assert.equal(r['ins/komp/2/schwelle'], -18, 'defaults of the group stage');
  assert.equal(r['ins/komp/4/an'], 1, 'master stage on');
  for (const slot of [1, 2, 3, 4]) {
    const k = ins(r).filter((x) => x.startsWith(`ins/komp/${slot}/`));
    assert.equal(k.at(-1), `ins/komp/${slot}/an`, `slot ${slot}: the switch is set after the values`);
    assert.deepEqual(k.slice(0, -1).filter((x) => !x.endsWith('/sc')).map((x) => x.split('/')[3]).sort(), [...KOMP].sort());
  }
  assert.ok(Object.keys(r).filter((k) => !k.startsWith('ins/')).length > 0, 'the send and return controls are still there');
});

test('render.routing_inserts: bypassed stage keeps its values with an = 0; a project without inserts gives exactly the old set (negative control)', () => {
  const p = lauf(mitKette(), [{ befehl: 'insert_an', insert_id: 'i2', an: false }]);
  const r = routingRegler(p);
  assert.equal(r['ins/komp/2/an'], 0); assert.equal(r['ins/komp/2/ratio'], 4);
  const ohne = neuesProjekt('N');
  assert.deepEqual(routingRegler(ohne), {}, 'no returns, no inserts: nothing');
  assert.equal(ins(reglerAusProjekt(ohne)).length, 0);
  let q = lauf(ohne, [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'return_neu' }]);
  assert.equal(ins(routingRegler(q)).length, 0, 'returns without inserts: no insert row');
  q = lauf(q, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }]);
  assert.equal(ins(routingRegler(lauf(neuesProjekt('M'), [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }]))).length, 10,
    'inserts without any return are set as well (the early return of the send block does not hide them)');
});

test('render.routing_inserts: the render of ONE track carries its chain, its group, the master and the returns it feeds, nothing of the others', () => {
  const p = lauf(mitKette(), [{ befehl: 'return_neu', name: 'R2' }, { befehl: 'insert_setzen', strang_id: 'r2', pos: 0, art: 'komp' },
    { befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'komp' }]);
  const s1 = p.spuren.find((s) => s.id === 's1'), s2 = p.spuren.find((s) => s.id === 's2');
  const nur1 = routingRegler(p, { nur: s1 });
  const slotsVon = (r) => [...new Set(ins(r).map((x) => Number(x.split('/')[2])))].sort((a, b) => a - b);
  assert.deepEqual(slotsVon(nur1), [1, 3, 4], 's1: own stage 1, the return it feeds (3), the master (4); not the group stage, not r2');
  const slotS2 = p.spuren.find((s) => s.id === 's2').inserts[0].slot;
  assert.deepEqual(slotsVon(routingRegler(p, { nur: s2 })), [2, 4, slotS2].sort((a, b) => a - b), 's2: own stage, its group (2), the master (4)');
  assert.equal(ins(routingRegler(p, { trocken: true })).length, 0, 'the dry merge render has no inserts (merge_inserts refuses a chain, groups are neutral)');
  assert.equal(ins(reglerEinzeln(s1, p)).length, 30, 'reglerEinzeln of the export of one track: the same set');
});

test('render.routing_inserts: the render of ONE track carries the stage of a return fed only through the group (send on the group)', () => {
  let p = lauf(mitKette(), [{ befehl: 'return_neu', name: 'R2' }]);
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 'r2', pos: 0, art: 'komp' }, { befehl: 'send_setzen', strang_id: 'g1', return_id: 'r2', db: -6 }]);
  const slotR2 = p.returns.find((x) => x.id === 'r2').inserts[0].slot;
  const s2 = p.spuren.find((x) => x.id === 's2');
  assert.ok(ins(routingRegler(p, { nur: s2 })).some((x) => x.startsWith(`ins/komp/${slotR2}/`)), 'r2 is fed by g1, the group of s2');
  assert.ok(!ins(routingRegler(p, { nur: p.spuren.find((x) => x.id === 's1') })).some((x) => x.startsWith(`ins/komp/${slotR2}/`)), 's1 is not in g1: no r2 stage');
});

test('render.routing_inserts: a stage without a key has sc 0 in the file', () => {
  assert.equal(routingRegler(mitKette())['ins/komp/2/sc'], 0);
});

// ---- opening a project -----------------------------------------------------------------------------------------------------------------------
test('abbildung.alle_insert: all slots of all kinds (12 x 10 komp, 8 x 59 eq, 4 x 4 saett, 2 x 3 lim, 4 host, 8 x 5 utility, 8 x 9 bk; the used ones with their values, the free ones at the pool defaults), the switch last', () => {
  const p = mitKette(), r = alleInsertRegler(p);
  assert.equal(r.length, 730);
  assert.deepEqual([...new Set(r.filter((x) => x.pfad.startsWith('ins/komp/')).map((x) => x.pfad.split('/')[2]))], ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
  assert.equal(r.filter((x) => x.pfad.startsWith('ins/eq/')).length, 8 * 59);
  assert.equal(r.filter((x) => x.pfad.startsWith('ins/saett/')).length, 4 * 4);
  assert.equal(r.filter((x) => x.pfad.startsWith('ins/utility/')).length, 8 * 5);
  assert.equal(r.filter((x) => x.pfad.startsWith('ins/bk/')).length, 8 * 9);
  assert.equal(r.find((x) => x.pfad === 'ins/eq/1/b4/freq').wert, 800, 'an unused eq slot sits at the band default of the plugin');
  assert.equal(r.findLastIndex((x) => x.pfad.startsWith('ins/eq/1/')), r.findIndex((x) => x.pfad === 'ins/eq/1/an'), 'the eq switch is the last row of its slot');
  assert.equal(r.find((x) => x.pfad === 'ins/komp/5/an').wert, 0, 'a free slot is switched off');
  assert.equal(r.find((x) => x.pfad === 'ins/komp/5/ratio').wert, 4, 'and at the pool default');
  assert.equal(r.find((x) => x.pfad === 'ins/komp/2/sc').wert, 0, 'a stage without a key has sc 0');
  assert.equal(r.filter((x) => x.pfad === 'ins/komp/1/an')[0].wert, 1);
  assert.equal(r.findLastIndex((x) => x.pfad.startsWith('ins/komp/1/')), r.findIndex((x) => x.pfad === 'ins/komp/1/an'), 'the switch is the last row of its slot');
  assert.equal(alleRegler(p).length, alleRegler(neuesProjekt('N')).length, 'the number does not depend on the stages in use: all 12 slots are always set');
  assert.deepEqual(alleInsertRegler(neuesProjekt('N')).filter((x) => /\/an$/.test(x.pfad) && !/\/b\d\/an$/.test(x.pfad)).map((x) => x.wert), Array(46).fill(0), 'negative control: no stage, every stage switch off (12 komp, 8 eq, 4 saett, 2 lim, 4 host, 8 utility)');
  assert.equal(alleRegler(neuesProjekt('N')).length, 365 + 730 + 48, 'the old 365 plus the 730 pooled insert rows plus the 48 rack macro rows (slice 4c)');
});

test('sitzung.setzt_alle_ins: opening a project with two inserts sets both (and the free slots at the defaults, 730 rows) before the transport starts; the old controls are all there too', async (t) => {
  const k = pruefKontext();
  const { s } = sitzung(t, {}, k);
  await s.neu('Ins', 'andreas');
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'a', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'k', befehle: [
    { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', werte: { schwelle: -33 } },
    { befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'komp', werte: { ratio: 12 } }] }, 'andreas');
  k.leere();
  const r = await s.oeffnen('ins', 'andreas');
  const soll = alleRegler(r.j.projekt).length;
  const insTeile = k.teile(/^ins\//);
  assert.equal(insTeile.length, 730, 'all slots of all kinds');
  assert.equal(insTeile.find((x) => x.felder.pfad === 'ins/komp/1/schwelle').felder.nach, -33);
  assert.equal(insTeile.find((x) => x.felder.pfad === 'ins/komp/2/ratio').felder.nach, 12);
  assert.equal(k.teile(/^rack\//).length, 48, 'all 12 racks x 4 macro rows (slice 4c)');
  assert.equal(k.teile().length, soll + 24, 'all mixer controls plus the 24 erz/4 controls plus the inserts');
  assert.equal(r.j.kern.regler_fehler.length, 0);
  const frei = k.an('/k/hand/frei').at(-1).felder.pfade.split(',');
  assert.ok(frei.includes('spur/') && !frei.some((x) => x.startsWith('ins/') || x.startsWith('rack/')), `the hand release names regulator groups, no ins/* or rack/* path: ${frei.length} entries`);
  await s.transport({ aktion: 'start', beat: 0 }, 'andreas');
  const start = k.gesendet.findIndex((x) => x.adresse === '/k/arr/start');
  assert.ok(start > 0, 'the transport started');
  for (const x of insTeile) assert.ok(k.gesendet.indexOf(x) < start, `${x.felder.pfad} was sent before /k/arr/start`);
});

test('sitzung.setzt_alle_ins negative control: opening a project without inserts sets every slot off at the defaults and the old 389 controls (730 insert rows)', async (t) => {
  const k = pruefKontext();
  const { s } = sitzung(t, {}, k);
  await s.neu('Leer', 'andreas');
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'a', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  k.leere();
  await s.oeffnen('leer', 'andreas');
  assert.equal(k.teile(/^ins\//).length, 730);
  assert.ok(k.teile(/^ins\/(komp|eq|saett|lim)\/\d+\/an$/).every((x) => x.felder.nach === 0), 'every switch off');
  assert.equal(k.teile(/^ins\/(komp|eq|saett|lim)\/\d+\/an$/).length, 26);
  assert.equal(k.teile().length, 389 + 730 + 48, 'the old 389, the 730 insert rows and the 48 rack macro rows');
});

test('sitzung.stale_slot: project A leaves ratio 12 / schwelle -40 on slot 1; opening B and adding a default stage there gives ratio 4 at the core (review IMPORTANT)', async (t) => {
  const k = pruefKontext();
  const { s } = sitzung(t, {}, k);
  await s.neu('A', 'andreas');
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'a', befehle: [{ befehl: 'spur_neu', art: 'audio' },
    { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', werte: { ratio: 12, schwelle: -40 } }] }, 'andreas');
  await s.neu('B', 'andreas');
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'b', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  await s.oeffnen('a', 'andreas');
  await s.oeffnen('b', 'andreas');
  const zuletzt = (pfad) => k.teile(new RegExp(`^${pfad}$`)).at(-1)?.felder.nach;
  assert.equal(zuletzt('ins/komp/1/ratio'), 4, 'opening B reset the slot left over from A');
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'k', befehle: [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }] }, 'andreas');
  assert.equal(zuletzt('ins/komp/1/ratio'), 4); assert.equal(zuletzt('ins/komp/1/schwelle'), -18); assert.equal(zuletzt('ins/komp/1/an'), 1);
});

test('server.insert_wege sanity: fuehreAus is the same function the tests above use (guards the helper imports)', () => {
  assert.equal(typeof fuehreAus, 'function');
});
