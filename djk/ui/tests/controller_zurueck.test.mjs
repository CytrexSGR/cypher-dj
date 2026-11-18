// Controller write-back on project tracks: only a controller grip (halter mensch) on spur/<slot>/bk/<k> reaches the project, once per knob after the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ReglerZurueck, laneTreibt } from '../areas/controller/zurueck.ts';

const bk = (id, nr, extra = {}) => ({ id, nr, geraet: { art: 'intern', name: 'bk', graph: 'x', parameter: {} }, clips: [], ...extra });
const projekt = (spuren, rev = 7) => ({ rev, spuren });
function bau(p, ruheMs = 25) {
  const gesendet = [], log = [], aendern = [];
  let offen = p === null ? null : { projekt: p };
  const ctx = { sende: (a, f) => { gesendet.push({ a, f }); return gesendet.length; }, warteQuittung: async () => ({ status: 3, grund: '' }), log: (z) => log.push(z) };
  const zugang = { offen: () => offen, aendern: async (d, q) => { aendern.push({ d, q }); if (zugang.wirf) throw new Error('rev_veraltet'); return { code: 200, j: {} }; } };
  const z = new ReglerZurueck(ctx, zugang, ruheMs);
  return { z, gesendet, log, aendern, zugang, setze: (n) => { offen = n === null ? null : { projekt: n }; } };
}
const ev = (pfad, wert, halter = 'mensch') => ({ pfad, wert, halter });
const warte = (ms = 120) => new Promise((r) => setTimeout(r, ms));

test('a controller grip on spur/3/bk/2 becomes ONE geraet_param_setzen for the third bk track after the rest, label Controller, source andreas; the hold is released first', async () => {
  const x = bau(projekt([bk('s1', 1), { id: 'a1', nr: 2, geraet: null, clips: [] }, bk('s5', 5), bk('s9', 9)]));
  x.z.ereignis(ev('spur/3/bk/2', 0.2));
  x.z.ereignis(ev('spur/3/bk/2', 0.3));
  x.z.ereignis(ev('spur/3/bk/2', 0.75));
  assert.equal(x.aendern.length, 0, 'nothing before the rest');
  await warte();
  assert.deepEqual(x.gesendet, [{ a: '/k/hand/frei', f: { quelle: 'andreas', pfade: 'spur/3/bk/2' } }]);
  assert.equal(x.aendern.length, 1);
  assert.deepEqual(x.aendern[0], { d: { rev: 7, label: 'Controller', befehle: [{ befehl: 'geraet_param_setzen', spur_id: 's9', param: 'k2', wert: 0.75 }] }, q: 'andreas' });
});

test('two knobs give two commands; a knob that moves again after the rest gives a second one', async () => {
  const x = bau(projekt([bk('s1', 1)]));
  x.z.ereignis(ev('spur/1/bk/1', 0.1)); x.z.ereignis(ev('spur/1/bk/2', 0.9));
  await warte();
  assert.deepEqual(x.aendern.map((a) => a.d.befehle[0].param).sort(), ['k1', 'k2']);
  x.z.ereignis(ev('spur/1/bk/1', 0.4));
  await warte();
  assert.equal(x.aendern.length, 3);
});

test('what the project caused is never written back: holders andreas, cypher, plan and frei, and a value that equals the project value', async () => {
  const p = projekt([bk('s1', 1)]);
  p.spuren[0].geraet.parameter.k3 = 0.6;
  const x = bau(p);
  x.z.ereignis(ev('spur/1/bk/1', 0.2, 'andreas'));
  x.z.ereignis(ev('spur/1/bk/1', 0.3, 'cypher'));
  x.z.ereignis(ev('spur/1/bk/1', 0.4, 'plan:cypher'));
  x.z.ereignis(ev('spur/1/bk/1', 0.5, 'frei'));
  x.z.ereignis(ev('spur/1/bk/3', 0.6, 'mensch'));        // the controller sits on the value the project already holds
  x.z.ereignis(ev('spur/1/bk/4', 0.5, 'mensch'));        // the default 0.5 of an untouched knob
  await warte();
  assert.equal(x.aendern.length, 0);
  assert.equal(x.gesendet.length, 0, 'and the hold of nobody is released');
});

test('a touch without a move (halter mensch, the value seen before) writes nothing; the first move afterwards does', async () => {
  const x = bau(projekt([bk('s1', 1)]));
  x.z.ereignis(ev('spur/1/bk/1', 0.8, 'frei'));          // the row stands at 0.8 (a stale value of an earlier project)
  x.z.ereignis(ev('spur/1/bk/1', 0.8, 'mensch'));        // a touch: the holder changes, the value does not
  await warte();
  assert.equal(x.aendern.length, 0);
  x.z.ereignis(ev('spur/1/bk/1', 0.85, 'mensch'));
  await warte();
  assert.equal(x.aendern.length, 1);
});

test('a knob driven by a lane or a clip envelope of its track is never written back; other knobs of that track are', async () => {
  const lane = bk('s1', 1, { automation: [{ id: 'l1', ziel: 'geraet.k2', punkte: [] }] });
  const huell = bk('s2', 2, { clips: [{ id: 'c1', huellkurven: [{ ziel: 'geraet.k5', punkte: [] }] }] });
  const x = bau(projekt([lane, huell]));
  x.z.ereignis(ev('spur/1/bk/2', 0.9)); x.z.ereignis(ev('spur/2/bk/5', 0.9));
  x.z.ereignis(ev('spur/1/bk/3', 0.9)); x.z.ereignis(ev('spur/2/bk/6', 0.9));
  await warte();
  assert.deepEqual(x.aendern.map((a) => [a.d.befehle[0].spur_id, a.d.befehle[0].param]).sort(), [['s1', 'k3'], ['s2', 'k6']]);
  assert.equal(laneTreibt(lane, 'k2'), true);
  assert.equal(laneTreibt(lane, 'k3'), false);
});

test('rows without a bk track (slot beyond the tracks), channel rows, other rows and no open project write nothing', async () => {
  const x = bau(projekt([bk('s1', 1)]));
  for (const pfad of ['spur/2/bk/1', 'erz/5/bk/1', 'spur/1/fader', 'spur/1/bk/65', 'spur/10/bk/1']) x.z.ereignis(ev(pfad, 0.9));
  await warte();
  assert.equal(x.aendern.length, 0);
  const y = bau(null);
  y.z.ereignis(ev('spur/1/bk/1', 0.9));
  await warte();
  assert.equal(y.aendern.length, 0);
});

test('the ninth bk track has no core row: its slot gives nothing even if a row name is sent', async () => {
  const spuren = Array.from({ length: 9 }, (_, i) => bk(`s${i + 1}`, i + 1));
  const x = bau(projekt(spuren));
  x.z.ereignis(ev('spur/9/bk/1', 0.9));
  await warte();
  assert.equal(x.aendern.length, 0);
});

test('the project closes while the value waits: nothing is written; a refused change is logged and does not throw', async () => {
  const x = bau(projekt([bk('s1', 1)]));
  x.z.ereignis(ev('spur/1/bk/1', 0.9));
  x.setze(null);
  await warte();
  assert.equal(x.aendern.length, 0);
  x.setze(projekt([bk('s1', 1)]));
  x.zugang.wirf = true;
  x.z.ereignis(ev('spur/1/bk/1', 0.95));
  await warte();
  assert.equal(x.aendern.length, 1);
  assert.deepEqual(x.log.map((l) => l.typ), ['controller_zurueck_fehler']);
});

test('verwirf drops the waiting values', async () => {
  const x = bau(projekt([bk('s1', 1)]));
  x.z.ereignis(ev('spur/1/bk/1', 0.9));
  x.z.verwirf();
  await warte();
  assert.equal(x.aendern.length, 0);
});
