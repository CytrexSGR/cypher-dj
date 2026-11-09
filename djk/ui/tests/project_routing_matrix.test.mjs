// 1.10 slice 6, task 1: the routing matrix as server data (routingMatrix, GET /proj/routing is tested in proj_bereich_transport) and the narrow
// D13 change of the commands (a track's own number as `pre` key is refused sidechain_zyklus). The equality test is the guard of plan decision D2:
// every cell and every key option equals what the commands do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt, alleInserts } from '../project/model.ts';
import { routingMatrix } from '../project/routing_matrix.ts';
import { stapel } from './support/media_library.mjs';
import { ruf } from './support/proj_stack.mjs';

const ok = (p, b) => fuehreAus(p, b).projekt;
const mit = (n) => {
  let p = neuesProjekt('T');
  for (let i = 0; i < n; i++) p = ok(p, { befehl: 'spur_neu', art: 'audio', name: `T${i + 1}` });
  return p;
};
const stufeAuf = (p, strang, rest = {}) => {
  const st = (strang === 'master' ? p.master : p.spuren.find((s) => s.id === strang) ?? p.gruppen.find((g) => g.id === strang) ?? p.returns.find((r) => r.id === strang));
  return ok(p, { befehl: 'insert_setzen', strang_id: strang, pos: (st.inserts ?? []).length, art: 'komp', ...rest });
};
const strangVon = (m, id) => m.straenge.find((s) => s.id === id);

function ersterAufbau() {   // 3 tracks, group g1 (s2, s3), returns r1 (pre) and r2, sends, 2 komp stages (sc 1 / group post), one eq
  let p = mit(3);
  p = ok(p, { befehl: 'gruppenspur_neu', mitglieder: ['s2', 's3'] });
  p = ok(p, { befehl: 'return_neu' });
  p = ok(p, { befehl: 'return_neu' });
  p = ok(p, { befehl: 'return_aendern', return_id: 'r1', pre: true });
  p = ok(p, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 });
  p = ok(p, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r2', db: -12 });
  p = ok(p, { befehl: 'send_setzen', strang_id: 'g1', return_id: 'r2', db: -3 });
  p = stufeAuf(p, 's1', { sc: 2 });                                         // keyed by track 2 (pre)
  p = stufeAuf(p, 'r1', { key: { quelle: 'grp', nr: 1, punkt: 'post' } });
  p = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'eq' });
  return p;
}

test('(a) every connection appears: targets, sends per return with the pre flag, stage kinds and the key triples', () => {
  const p = ersterAufbau();
  const m = routingMatrix(p);
  assert.equal(m.rev, p.rev);
  assert.deepEqual(m.ziele, [{ wert: 'master', name: 'Master' }, { wert: 'g1', name: p.gruppen[0].name }]);
  assert.deepEqual(m.returns.map((r) => [r.id, r.nr, r.pre]), [['r1', 1, true], ['r2', 2, false]]);
  assert.deepEqual(m.straenge.map((s) => [s.art, s.id]), [['spur', 's1'], ['spur', 's2'], ['spur', 's3'], ['gruppe', 'g1'], ['return', 'r1'], ['return', 'r2'], ['pm', 'master']]);
  const s1 = strangVon(m, 's1');
  assert.deepEqual(s1.sends, [{ return_id: 'r1', db: -6 }, { return_id: 'r2', db: -12 }]);
  assert.equal(s1.ausgang, 'master');
  assert.equal(strangVon(m, 's2').ausgang, 'g1');
  assert.equal(strangVon(m, 'g1').ausgang, 'master');
  assert.deepEqual(strangVon(m, 'g1').sends, [{ return_id: 'r2', db: -3 }]);
  assert.deepEqual(s1.stufen.map((x) => [x.art, x.slot, x.an, x.schluessel]),
    [['komp', 1, true, { quelle: 'spur', nr: 2, punkt: 'pre' }], ['eq', 1, true, null]]);
  assert.deepEqual(strangVon(m, 'r1').stufen.map((x) => x.schluessel), [{ quelle: 'grp', nr: 1, punkt: 'post' }]);
  assert.equal(strangVon(m, 'r1').ausgang, 'master');
  assert.equal(strangVon(m, 'master').nr, 0);
  assert.deepEqual(strangVon(m, 'master').ziel_zellen, []);
  assert.deepEqual(strangVon(m, 'r1').ziel_zellen, []);
  assert.ok(s1.stufen.every((x) => typeof x.insert_id === 'string' && x.optionen === undefined), 'no options unless asked');
});

test('(b) target cells: a track has master plus one cell per group; a group has routing_grenze for another group and routing_zyklus for itself', () => {
  let p = ok(ok(mit(3), { befehl: 'gruppenspur_neu', mitglieder: ['s2'] }), { befehl: 'gruppenspur_neu' });
  const m = routingMatrix(p);
  const t = strangVon(m, 's1').ziel_zellen;
  assert.deepEqual(t.map((z) => [z.ziel, z.aktiv, z.erlaubt]), [['master', true, true], ['g1', false, true], ['g2', false, true]]);
  assert.deepEqual(strangVon(m, 's2').ziel_zellen.map((z) => [z.ziel, z.aktiv]), [['master', false], ['g1', true], ['g2', false]]);
  const g = strangVon(m, 'g1').ziel_zellen;
  assert.deepEqual(g.map((z) => [z.ziel, z.aktiv, z.erlaubt, z.grund]),
    [['master', true, true, undefined], ['g1', false, false, 'routing_zyklus'], ['g2', false, false, 'routing_grenze']]);
  assert.match(g[1].text, /feed itself/);
  assert.match(g[2].text, /do not nest/);
});

// ---- (c) equality with the commands ---------------------------------------------------------------------------------------------------------------

function erzeugt() {   // 4 tracks (s3, s4 in g1), 3 groups, 2 returns, 4 komp stages on different strips
  let p = mit(4);
  p = ok(p, { befehl: 'gruppenspur_neu', mitglieder: ['s3', 's4'] });
  p = ok(p, { befehl: 'gruppenspur_neu' });
  p = ok(p, { befehl: 'gruppenspur_neu' });
  p = ok(p, { befehl: 'return_neu' });
  p = ok(p, { befehl: 'return_neu' });
  p = stufeAuf(p, 's1', { key: { quelle: 'spur', nr: 2, punkt: 'post' } });
  p = stufeAuf(p, 's3', {});
  p = stufeAuf(p, 'g1', {});
  p = stufeAuf(p, 'master', {});
  return p;
}
const verdikt = (fn) => {
  try { fn(); return null; } catch (e) { if (e instanceof BefehlFehler) return { grund: e.grund, text: e.detail }; throw e; }
};

test('(c) equality: every target cell and every key option equals what the commands do on a clone (refused cells refuse with the same reason)', () => {
  const p = erzeugt();
  const m = routingMatrix(p);
  let geprueft = 0;
  for (const s of m.straenge) for (const z of s.ziel_zellen) {
    const v = verdikt(() => fuehreListeAus(structuredClone(p), [{ befehl: 'ziel_setzen', strang_id: s.id, ausgang: z.ziel === 'master' ? 'master' : { art: 'gruppe', id: z.ziel } }]));
    assert.deepEqual(v === null ? { erlaubt: true } : { erlaubt: false, grund: v.grund, text: v.text }, z.erlaubt ? { erlaubt: true } : { erlaubt: false, grund: z.grund, text: z.text },
      `${s.id} -> ${z.ziel}`);
    geprueft++;
  }
  assert.ok(geprueft >= 4 * 4 + 3 * 4, `${geprueft} target cells`);
  let optionen = 0, abgelehnt = 0;
  for (const s of m.straenge) for (const st of s.stufen.filter((x) => x.art === 'komp')) {
    const opts = routingMatrix(p, st.insert_id).straenge.find((x) => x.id === s.id).stufen.find((x) => x.insert_id === st.insert_id).optionen;
    assert.ok(opts.length > 0);
    const kette = alleInserts(p).filter((x) => x.strangId === s.id).length;
    for (const o of opts) {
      const key = { quelle: o.quelle, nr: o.nr, punkt: o.punkt };
      const wie = `${s.id}/${st.insert_id} ${JSON.stringify(key)}`;
      const antworten = [
        verdikt(() => fuehreAus(structuredClone(p), { befehl: 'insert_param_setzen', insert_id: st.insert_id, param: 'key', wert: key })),
        // a new stage at a free position: the stage that holds the key is not part of the chain yet (`ausser` none), the rules answer the same
        verdikt(() => fuehreAus(structuredClone(p), { befehl: 'insert_setzen', strang_id: s.id, pos: kette, art: 'komp', key })),
      ];
      if (o.quelle === 'spur' && o.punkt === 'pre') {
        antworten.push(verdikt(() => fuehreAus(structuredClone(p), { befehl: 'insert_param_setzen', insert_id: st.insert_id, param: 'sc', wert: o.nr })));
      }
      for (const v of antworten) {
        assert.equal(v === null, o.erlaubt, `${wie}: cell ${o.erlaubt} command ${JSON.stringify(v)}`);
        if (v) assert.equal(v.grund, o.grund, wie);
      }
      if (!o.erlaubt) abgelehnt++;
      optionen++;
    }
  }
  assert.ok(optionen >= 4 * 20 && abgelehnt > 0, `${optionen} options, ${abgelehnt} refused (positive control: both answers occur)`);
});

test("D13: a track's own number as `pre` key says sidechain_zyklus in the cell and in every command; another track's number is accepted", () => {
  const p = stufeAuf(mit(3), 's1', {});
  const id = alleInserts(p)[0].insert.id;
  const opt = routingMatrix(p, id).straenge[0].stufen[0].optionen;
  const eigen = opt.find((o) => o.quelle === 'spur' && o.nr === 1 && o.punkt === 'pre');
  assert.deepEqual([eigen.erlaubt, eigen.grund], [false, 'sidechain_zyklus']);
  assert.ok(opt.find((o) => o.quelle === 'spur' && o.nr === 2 && o.punkt === 'pre').erlaubt);
  const lehntAb = (b) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === 'sidechain_zyklus', JSON.stringify(b));
  lehntAb({ befehl: 'insert_param_setzen', insert_id: id, param: 'sc', wert: 1 });
  lehntAb({ befehl: 'insert_param_setzen', insert_id: id, param: 'key', wert: { quelle: 'spur', nr: 1, punkt: 'pre' } });
  lehntAb({ befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'komp', sc: 1 });
  lehntAb({ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', ersetzen: true, key: { quelle: 'spur', nr: 1, punkt: 'pre' } });
  // the same number on a strip that is not that track stays fine (group 1 keyed by track 1 pre)
  const q = ok(p, { befehl: 'gruppenspur_neu', mitglieder: ['s2'] });
  fuehreAus(q, { befehl: 'insert_setzen', strang_id: 'g1', pos: 0, art: 'komp', sc: 1 });
  fuehreAus(p, { befehl: 'insert_param_setzen', insert_id: id, param: 'sc', wert: 2 });
});

test('(d) options only for the named stage, none for an eq stage', () => {
  const p = ersterAufbau();
  const alle = routingMatrix(p).straenge.flatMap((s) => s.stufen);
  assert.ok(alle.every((x) => x.optionen === undefined));
  const komp = alle.find((x) => x.art === 'komp');
  const m = routingMatrix(p, komp.insert_id);
  const mitOpt = m.straenge.flatMap((s) => s.stufen).filter((x) => x.optionen);
  assert.deepEqual(mitOpt.map((x) => x.insert_id), [komp.insert_id]);
  const eq = alle.find((x) => x.art === 'eq');
  assert.throws(() => routingMatrix(p, eq.insert_id), (e) => e instanceof BefehlFehler && e.grund === 'argument_ungueltig');
  assert.throws(() => routingMatrix(p, 'i999'), (e) => e instanceof BefehlFehler && e.grund === 'argument_ungueltig');
});

test('(e) a project without groups, returns or stages gives rows for the tracks and the master only and empty lists', () => {
  const m = routingMatrix(mit(2));
  assert.deepEqual(m.ziele, [{ wert: 'master', name: 'Master' }]);
  assert.deepEqual(m.returns, []);
  assert.deepEqual(m.straenge.map((s) => [s.art, s.id, s.stufen.length, s.sends.length]), [['spur', 's1', 0, 0], ['spur', 's2', 0, 0], ['pm', 'master', 0, 0]]);
  assert.deepEqual(m.straenge[0].ziel_zellen.map((z) => z.ziel), ['master']);
});

test('GET /proj/routing: the page server answers the matrix, 400 argument_ungueltig for an unknown stage or an eq stage, {slug: null} without a project', async (t) => {
  const { url } = await stapel(t);
  const hole = (pfad) => ruf(url, 'GET', pfad);
  assert.deepEqual((await hole('/proj/routing')).j, { slug: null });
  assert.equal((await ruf(url, 'POST', '/proj/neu', { name: 'Matrix' })).code, 200);
  const r = await hole('/proj/routing');
  assert.equal(r.code, 200);
  assert.deepEqual(r.j.straenge.map((s) => s.id), ['master']);
  const bad = await hole('/proj/routing?optionen=i999');
  assert.deepEqual([bad.code, bad.j.fehler], [400, 'argument_ungueltig']);
  assert.equal((await hole('/proj/routing?optionen=')).code, 400);
});
