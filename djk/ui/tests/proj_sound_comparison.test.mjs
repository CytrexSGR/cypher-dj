// FIND SOUND rework, task 5: COMPARE on the server (areas/proj/sound_runde.ts). Doubles for the output area, the measuring step, the core write
// (hoereBk) and the bar scheduler (takt: every scheduled part waits for a manual receipt). No render program, no core, no clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KlangRunde } from '../areas/proj/sound_runde.ts';
import { wirkung } from '../project/sound_runde.ts';
import { SKALA, ZIELE, UEBERSCHUSS, VERGLEICH_TOTMANN_MS } from '../project/sound_runde_contract.ts';
import { zielBeat, TaktUhr, takteBeats } from '../areas/proj/sound_bar.ts';

const NULL = { hell: 0, sub: 0, hoehen: 0, bewegung: 0, fuelle: 0, breite: 0, punch: 0, pegel: 0 };
const tabelle = () => Array.from({ length: 4 }, (_, i) => ({ name: `k${i + 1}`, label: `Knob ${i + 1}`, min: 100, max: 1000, log: false, vorgabe: 0.5 }));
const W = { k1: { hell: 10 }, k2: { sub: 10 }, k3: { breite: 10 }, k4: { bewegung: 10 } };

// `alles` is one ordered log of every core-facing call: ['kern', values, fader], ['teile', ab, values, fader], ['abbruch']
async function aufbau({ mitTakt = true, ziel = 4 } = {}) {
  const projekt = { rev: 1, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 8 }, spuren: [{ id: 's1', nr: 1, name: 'Bass', clips: [], automation: [],
    geraet: { art: 'intern', name: 'bk', graph: 'g', parameter: { k1: 0.4 } } }] };
  const alles = [], offen = [], timer = [], takt = { ziel, bar: 4 };
  let schliess = null;
  const zugang = { offen: () => ({ slug: 'p', projekt }), hoereBk: async (id, w, q, f) => { alles.push(['kern', { ...w }, f]); }, beiSchliessen: (f) => { schliess = f; } };
  const ausgabe = { rendereKlangVarianten: async (_s, varianten, _v, _b, nimm) => nimm({ rev: 1, slug: 'p', tempo_bpm: 120,
    teile: varianten.map((v) => ({ datei: JSON.stringify(v), spitze_db: -3, frames: 96000 })) }) };
  const merkmaleVon = async (datei) => {
    const m = { ...NULL };
    for (const [k, x] of Object.entries(JSON.parse(datei))) for (const [f, w] of Object.entries(W[k] ?? {})) m[f] += (x - (k === 'k1' ? 0.4 : 0.5)) * w * SKALA[f];
    return { m, bild: [] };
  };
  const taktD = { zielBeat: () => takt.ziel, takt: () => takt.bar,
    teile: (plan, q, ab, spur, werte, fader) => new Promise((ok) => { alles.push(['teile', ab, { ...werte }, fader]); offen.push({ ab, ok }); }),
    abbruch: async () => { alles.push(['abbruch']); for (const p of offen.splice(0)) p.ok({ ausgefuehrt: false }); } };
  const r = new KlangRunde({ ausgabe, zugang, tabelle, merkmaleVon, unterschied: (a, v) => Math.min(wirkung(a.m, v.m).staerke * ZIELE.normal, UEBERSCHUSS * ZIELE.normal),   // saturates: the first try is a place quelle: () => 'andreas',
    ...(mitTakt ? { takt: taktD } : {}), warte: async () => {}, setzeTimer: (f, ms) => { const h = { f, ms }; timer.push(h); return h; }, loescheTimer: (h) => { h.weg = true; } });
  r.starte({ spur_id: 's1' });
  await r.warteFertig();
  alles.length = 0;
  // resolves the oldest open part as executed and lets the round react
  const quittiere = async (ausgefuehrt = true) => { const p = offen.shift(); p.ok({ ausgefuehrt }); await new Promise((ok) => setImmediate(ok)); return p; };
  const tick = () => new Promise((ok) => setImmediate(ok));
  return { r, alles, offen, takt, timer, projekt, quittiere, tick, schliess: () => schliess() };
}
const B = { platz: 'B', vergleich: true };

test('the bar target is the next project bar line, a bar is numerator x 4 / denominator beats', () => {
  const e = { kBeat: 0.5, offset: 0, bpm: 120, loopVon: 0, loopBis: 8, loopAn: false, laeuft: true };
  assert.equal(zielBeat(e, 4), 4);
  assert.equal(zielBeat({ ...e, kBeat: 4.2 }, 4), 8);
  assert.equal(zielBeat({ ...e, kBeat: 104.2, offset: 100 }, 4), 108, 'the offset core beat - project beat moves the grid');
  assert.equal(zielBeat({ ...e, laeuft: false }, 4), null);
  assert.equal(takteBeats([3, 4]), 3);
  assert.equal(takteBeats([6, 8]), 3);
  const u = new TaktUhr();
  assert.equal(u.lage({ von_beat: 0, bis_beat: 8 }), null, 'no clock, no target');
  u.nimm('/uhr', { beat: 100.5, bpm: 120 }); u.nimm('/zustand/arr', { status: 2, loop_an: 0, projekt_beat: 0.5 });
  assert.deepEqual([u.lage({ von_beat: 0, bis_beat: 8 }).offset, u.lage({ von_beat: 0, bis_beat: 8 }).laeuft], [100, true]);
  u.nimm('/e/neustart', {});
  assert.equal(u.lage({ von_beat: 0, bis_beat: 8 }), null, 'a new core forgets the pair');
});

test('COMPARE alternates A and the place on the bar line and shows what sounds', async () => {
  const { r, alles, takt, quittiere } = await aufbau();
  const l = await r.hoere(B);
  assert.deepEqual([l.vergleich.an, l.vergleich.platz, l.vergleich.klingt, l.aktiv], [true, 'B', 'A', 'A']);
  await new Promise((ok) => setImmediate(ok));
  assert.deepEqual(alles, [['teile', 4, { k1: 0.75 }, undefined]], 'nothing is written at once: the first switch waits for the bar line');
  assert.equal(r.lage().vergleich.ab_beat, 4);
  takt.ziel = 8; await quittiere();
  assert.deepEqual([r.lage().aktiv, r.lage().vergleich.klingt], ['B', 'B']);
  assert.deepEqual(alles.at(-1), ['teile', 8, { k1: 0.4 }, undefined], 'then A, with the project value');
  takt.ziel = 12; await quittiere();
  assert.equal(r.lage().aktiv, 'A');
  assert.deepEqual(alles.at(-1), ['teile', 12, { k1: 0.75 }, undefined]);
  assert.equal(r.lage().vergleich.ab_beat, 12);
});

test('the first switch goes to the side that is not sounding', async () => {
  const { r, alles } = await aufbau();
  await r.hoere({ platz: 'B' });
  alles.length = 0;
  await r.hoere(B); await new Promise((ok) => setImmediate(ok));
  assert.deepEqual(alles, [['teile', 4, { k1: 0.4 }, undefined]], 'B sounds, so A is next');
});

test('a lagging clock never schedules the same bar twice', async () => {
  const { r, alles, quittiere } = await aufbau();
  await r.hoere(B); await new Promise((ok) => setImmediate(ok));
  await quittiere();   // the target is still 4: the clock lags
  assert.deepEqual(alles.map((x) => x[1]), [4, 8]);
});

test('COMPARE is refused without a playing transport or a scheduler', async () => {
  const a = await aufbau({ ziel: null });
  await assert.rejects(a.r.hoere(B), (e) => e.grund === 'vergleich_steht');
  const b = await aufbau({ mitTakt: false });
  await assert.rejects(b.r.hoere(B), (e) => e.grund === 'vergleich_steht');
  assert.equal(b.r.lage().vergleich.an, false);
  await assert.rejects(a.r.hoere({ platz: 'B', vergleich: 'ja' }), (e) => e.grund === 'argument_ungueltig');
});

test('selecting another place re-plans with the new place, selecting A turns COMPARE off', async () => {
  const { r, alles, takt, quittiere } = await aufbau();
  await r.hoere(B); await new Promise((ok) => setImmediate(ok));
  takt.ziel = 8; await quittiere();   // B sounds, A is scheduled for bar 8
  alles.length = 0; takt.ziel = 8;
  const l = await r.hoere({ platz: 'C', vergleich: true }); await new Promise((ok) => setImmediate(ok));
  assert.deepEqual([l.vergleich.an, l.vergleich.platz], [true, 'C']);
  assert.equal(alles[0][0], 'abbruch', 'the pending part is ended first');
  assert.deepEqual(alles[1].slice(0, 3), ['teile', 8, { k1: 0.4, k2: 0.15 }], 'B sounds, so the new place is next, with the old knob back at the project value');
  alles.length = 0;
  const a = await r.hoere({ platz: 'A', vergleich: true });
  assert.equal(a.vergleich.an, false);
  assert.equal(alles[0][0], 'abbruch');
  assert.equal(a.aktiv, 'A');
});

const ENDEN = {
  'transport stop': (r) => { r.ereignis('/zustand/arr', { status: 0 }); },
  'ende': (r) => r.ende(),
  'a new round': (r) => { r.starte({ spur_id: 's1' }); },
  'hoeren with vergleich false': (r) => r.hoere({ platz: 'B', vergleich: false }),
  'listening plainly': (r) => r.hoere({ platz: 'C' }),
  'a new core': (r) => { r.ereignis('/e/neustart', { generation: 9 }); },
};
for (const [name, tu] of Object.entries(ENDEN)) {
  test(`COMPARE ends on ${name}: the plan is aborted first, no knob stays`, async () => {
    const { r, alles, takt, quittiere, tick } = await aufbau();
    await r.hoere(B); await new Promise((ok) => setImmediate(ok));
    takt.ziel = 8; await quittiere();   // B sounds, A is pending
    alles.length = 0;
    await tu(r); await tick(); await tick();
    assert.equal(alles[0][0], 'abbruch', 'abort before any write');
    const gelesen = r.lage ? (() => { try { return r.lage(); } catch { return null; } })() : null;
    if (gelesen && name !== 'a new round' && name !== 'listening plainly' && name !== 'hoeren with vergleich false') assert.equal(gelesen.vergleich.an, false);
    if (name !== 'listening plainly' && name !== 'hoeren with vergleich false') {
      assert.deepEqual(alles.filter((x) => x[0] === 'kern').at(-1)?.slice(0, 2), ['kern', { k1: 0.4 }], 'the knob goes back to the project value');
    }
    assert.equal(alles.some((x) => x[0] === 'teile'), false, 'nothing is scheduled after the end');
  });
}

test('PICK and BACK end COMPARE with the abort only: no reset write before the project write', async () => {
  const { r, alles, takt, quittiere } = await aufbau();
  await r.hoere(B); await new Promise((ok) => setImmediate(ok));
  takt.ziel = 8; await quittiere();
  alles.length = 0;
  const plan = await r.waehle({ platz: 'B' });
  assert.equal(plan.weg, 'proj');
  assert.deepEqual(alles, [['abbruch']]);
  assert.equal(r.lage().vergleich.an, false);
  const b = await aufbau();
  await b.r.hoere(B); await new Promise((ok) => setImmediate(ok));
  b.alles.length = 0;
  await assert.rejects(b.r.zurueck({}), (e) => e.grund === 'kein_stammbaum');
  assert.deepEqual(b.alles, [['abbruch']], 'BACK refused or not, COMPARE is over');
});

test('a part that was not executed ends COMPARE and takes the knob off', async () => {
  const { r, alles, takt, quittiere, tick } = await aufbau();
  await r.hoere(B); await new Promise((ok) => setImmediate(ok));
  takt.ziel = 8; await quittiere();
  alles.length = 0;
  await quittiere(false); await tick(); await tick();
  assert.equal(r.lage().vergleich.an, false);
  assert.equal(alles[0][0], 'abbruch');
  assert.deepEqual(alles.filter((x) => x[0] === 'kern').at(-1).slice(0, 2), ['kern', { k1: 0.4 }]);
});

test('the receipt of our own abort neither ends COMPARE twice nor resets', async () => {
  const { r, alles } = await aufbau();
  await r.hoere(B); await new Promise((ok) => setImmediate(ok));
  alles.length = 0;
  await r.hoere({ platz: 'A', vergleich: true }); await new Promise((ok) => setImmediate(ok));
  // the stale receipt writes nothing: the only write is the one of the listen on A itself, and no second abort comes
  assert.deepEqual(alles, [['abbruch'], ['kern', { k1: 0.4 }, undefined]]);
});

test('dead-man: no request for 30 s ends COMPARE like ende, a request renews it', async () => {
  const { r, alles, timer, takt, quittiere, tick } = await aufbau();
  await r.hoere(B); await new Promise((ok) => setImmediate(ok));
  takt.ziel = 8; await quittiere();
  const tot = () => timer.filter((h) => h.ms === VERGLEICH_TOTMANN_MS && !h.weg);
  assert.equal(tot().length, 1);
  r.lage();
  assert.equal(tot().length, 1, 'a lage renews: the old timer is gone, one is left');
  alles.length = 0;
  tot()[0].f(); await tick(); await tick();
  assert.equal(r.lage().vergleich.an, false);
  assert.equal(alles[0][0], 'abbruch');
  assert.deepEqual(alles.filter((x) => x[0] === 'kern').at(-1).slice(0, 2), ['kern', { k1: 0.4 }]);
});

test('a closed project ends COMPARE with the abort and no write', async () => {
  const { r, alles, schliess, tick } = await aufbau();
  await r.hoere(B); await new Promise((ok) => setImmediate(ok));
  alles.length = 0;
  schliess(); await tick();
  assert.deepEqual(alles, [['abbruch']]);
  assert.throws(() => r.lage(), (e) => e.grund === 'keine_runde');
});
