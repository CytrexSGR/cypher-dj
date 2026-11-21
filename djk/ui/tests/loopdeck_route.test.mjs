// Loop deck M4: GET /loopdeck/stand, POST /loopdeck/start, /stopp, /szene of LoopdeckBereich. The core side (send, receipts, events) is a double: every
// command is recorded and answered by the test; the live container is the real proj session of support/live_modul.mjs. The clock is a parameter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { liveAufbau } from './support/live_module.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loopdeckBereich } from '../areas/live/loopdeck.ts';

const SHA = 'a'.repeat(64);
const Z = (extra = {}) => ({ name: 'Loop', farbe: 3, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0, ...extra });

// ctx: the one of the live setup, but sende/warteQuittung answer from `kern` (default: accepted, status 1) and quelle/kiGestoppt are switchable
async function aufbau(t, { deck = true, zellen = [[1, 1], [1, 3], [2, 1], [3, 8]] } = {}) {
  const z = await liveAufbau(t);
  const kern = { status: () => ({ status: 1, grund: '' }), gesendet: [], id: 1000, ki: false, quelle: 'andreas' };
  const ctx = { ...z.ctx,
    sende(adresse, felder) { const id = ++kern.id; kern.gesendet.push({ id, adresse, felder: { ...felder } }); return id; },
    async warteQuittung(id) { return kern.status(kern.gesendet.find((g) => g.id === id)); },
    kiGestoppt: () => kern.ki, quelle: () => kern.quelle };
  const verteilt = [];
  ctx.verteile = (e) => verteilt.push(e);
  let wand = 5000;
  const bereich = loopdeckBereich(ctx, z.zugang, { jetzt: () => wand, frames: (sha) => (sha === SHA ? 96000 : null) });
  if (deck) {
    await z.aendern([{ befehl: 'loopdeck_neu', platz: 1, raster: 'takt' }]);
    const spuren = z.projekt().spuren.filter((s) => s.zellen);
    await z.aendern(zellen.map(([sp, zl]) => ({ befehl: 'zelle_setzen', spur_id: spuren[sp - 1].id, index: zl, zelle: Z({ name: `c${sp}.${zl}` }) })));
  }
  const spuren = () => z.projekt().spuren.filter((s) => s.zellen);
  const uhr = (beat, bpm = 120) => bereich.ereignis('/uhr', { beat, bpm });
  const zelleEv = (sp, f) => bereich.ereignis('/zustand/zelle', { spur: spuren()[sp - 1].id, zelle: 0, verwaist: 0, ab_beat: 0, versatz_beats: 0, wartend: -1, wartend_ab: 0, ...f });
  const fehl = async (f) => { try { await f(); } catch (e) { assert.fail(`threw ${e}`); } };
  const gesendet = (adresse) => kern.gesendet.filter((g) => g.adresse === adresse);
  return { ...z, bereich, kern, ctx, verteilt, spuren, uhr, zelleEv, fehl, gesendet, zeit: (ms) => { wand = ms; }, wand: () => wand };
}
const grund = (a) => a.j.grund;

test('start sends /k/arr/zelle_start with the track id and the computed beat; answers ab_beat and status', async (t) => {
  const z = await aufbau(t);
  z.uhr(10.3);   // received at wall 5000, now 5000, 120 bpm, deck grid takt: next bar after 10.3 + 0.16 is 12
  const a = await z.bereich.start({ deck: 1, spur: 2, zelle: 1 }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual(a.j, { ok: true, ab_beat: 12, status: 1 });
  const s = z.gesendet('/k/arr/zelle_start');
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].felder, { quelle: 'andreas', spur: z.spuren()[1].id, zelle: 1, ab_beat: 12, versatz_beats: 0 });
  // raster of the request, versatz, wall clock moves on
  z.zeit(5500);
  const b = await z.bereich.start({ deck: 1, spur: 1, zelle: 3, raster: '1/2', versatz_beats: 1.5 }, 'andreas');
  assert.equal(b.j.ab_beat, 11.5, '10.3 + 1 beat (500 ms) + lead 0.16 -> next half beat');
  assert.deepEqual(z.gesendet('/k/arr/zelle_start')[1].felder, { quelle: 'andreas', spur: z.spuren()[0].id, zelle: 3, ab_beat: 11.5, versatz_beats: 1.5 });
});

test('empty cell is 409 zelle_leer and nothing is sent; no deck and no clock are refused too', async (t) => {
  const z = await aufbau(t);
  z.uhr(10);
  const a = await z.bereich.start({ deck: 1, spur: 4, zelle: 5 }, 'andreas');
  assert.deepEqual([a.code, a.j.ok, grund(a)], [409, false, 'zelle_leer']);
  assert.equal(z.kern.gesendet.length, 0);
  const b = await z.bereich.start({ deck: 2, spur: 1, zelle: 1 }, 'andreas');
  assert.deepEqual([b.code, grund(b)], [409, 'kein_loopdeck']);
  for (const f of [() => z.bereich.stopp({ deck: 2 }, 'andreas'), () => z.bereich.szene({ deck: 2, zeile: 1 }, 'andreas')]) assert.equal(grund(await f()), 'kein_loopdeck');
  const z2 = await aufbau(t);   // no /uhr yet
  const c = await z2.bereich.start({ deck: 1, spur: 1, zelle: 1 }, 'andreas');
  assert.deepEqual([c.code, grund(c)], [409, 'keine_uhr']);
  z2.uhr(10, 0);   // bpm 0 is no clock either
  assert.equal(grund(await z2.bereich.stopp({ deck: 1 }, 'andreas')), 'keine_uhr');
  assert.equal(z2.kern.gesendet.length, 0);
});

test('a refusal of the core (status 6) is 409 with the core reason', async (t) => {
  const z = await aufbau(t);
  z.uhr(10);
  z.kern.status = () => ({ status: 6, grund: 'nicht_geladen' });
  const a = await z.bereich.start({ deck: 1, spur: 1, zelle: 1 }, 'andreas');
  assert.deepEqual([a.code, a.j.ok, grund(a)], [409, false, 'nicht_geladen']);
  assert.equal(z.gesendet('/k/arr/zelle_start').length, 1, 'it was sent, the core refused');
  z.kern.status = () => null;   // no receipt at all
  assert.equal(grund(await z.bereich.start({ deck: 1, spur: 1, zelle: 1 }, 'andreas')), 'kein_kern');
});

test('stopp without spur sends one stop per track that has a cell, with one beat; with spur one', async (t) => {
  const z = await aufbau(t);
  z.uhr(10.3);
  const a = await z.bereich.stopp({ deck: 1 }, 'andreas');
  assert.deepEqual(a.j, { ok: true, ab_beat: 12 });
  const s = z.gesendet('/k/arr/zelle_stopp');
  assert.equal(s.length, 3, 'track 4 has no cell: unknown to the launcher, nothing is sent');
  assert.deepEqual(s.map((x) => x.felder.spur), z.spuren().slice(0, 3).map((x) => x.id));
  assert.deepEqual([...new Set(s.map((x) => x.felder.ab_beat))], [12]);
  const b = await z.bereich.stopp({ deck: 1, spur: 3 }, 'andreas');
  assert.equal(b.code, 200);
  assert.deepEqual(z.gesendet('/k/arr/zelle_stopp').slice(3).map((x) => x.felder.spur), [z.spuren()[2].id]);
});

test('szene mixes starts and stops with one beat (filled cell starts, empty stops, a track without cells gets nothing)', async (t) => {
  const z = await aufbau(t);   // row 1: tracks 1, 2 have a cell; row 3: track 1; row 8: track 3
  z.uhr(10.3);
  const a = await z.bereich.szene({ deck: 1, zeile: 1 }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual(a.j, { ok: true, ab_beat: 12, gestartet: [1, 2], gestoppt: [3] });
  assert.equal(z.gesendet('/k/arr/zelle_start').length, 2);
  assert.equal(z.gesendet('/k/arr/zelle_stopp').length, 1);
  const beats = z.kern.gesendet.map((g) => g.felder.ab_beat);
  assert.deepEqual([...new Set(beats)], [12]);
  assert.deepEqual(z.gesendet('/k/arr/zelle_start').map((g) => [g.felder.spur, g.felder.zelle]), [[z.spuren()[0].id, 1], [z.spuren()[1].id, 1]]);
  // every refusal answers 409; the three tracks with cells were sent
  z.kern.status = () => ({ status: 6, grund: 'nicht_geladen' });
  const b = await z.bereich.szene({ deck: 1, zeile: 8 }, 'andreas');
  assert.deepEqual([b.code, grund(b)], [409, 'nicht_geladen']);
  assert.equal(z.kern.gesendet.length, 6);
});

test('/zustand/zelle events update stand and emit one SSE each; an unchanged repeat emits none', async (t) => {
  const z = await aufbau(t);
  z.uhr(10);
  z.zelleEv(2, { zelle: 1, ab_beat: 8, versatz_beats: 0.5, wartend: 3, wartend_ab: 12 });
  assert.equal(z.verteilt.length, 1);
  assert.deepEqual(z.verteilt[0], { a: 'loopdeck', f: { deck: 1, spur: 2, lauf: { zelle: 1, verwaist: false, ab_beat: 8, versatz_beats: 0.5,
    wartend: { zelle: 3, ab_beat: 12 }, zuletzt: 1 } } });
  z.zelleEv(2, { zelle: 1, ab_beat: 8, versatz_beats: 0.5, wartend: 3, wartend_ab: 12 });
  assert.equal(z.verteilt.length, 1, 'the 2 Hz repeat is no event');
  z.zelleEv(2, { zelle: 3, ab_beat: 12, verwaist: 1 });
  z.zelleEv(2, { zelle: 0, wartend: 0, wartend_ab: 16 });   // silent, a stop is pending
  assert.equal(z.verteilt.length, 3);
  const st = (await z.bereich.stand()).j;
  const sp = st.decks[1].spuren[1];
  assert.deepEqual(sp.lauf, { zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: { zelle: null, ab_beat: 16 }, zuletzt: 3 });
  assert.deepEqual(st.decks[1].spuren[0].lauf, { zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });
  // an event for an id that is no deck track updates the mirror but sends nothing
  z.bereich.ereignis('/zustand/zelle', { spur: 'nope', zelle: 1, verwaist: 0, ab_beat: 0, versatz_beats: 0, wartend: -1, wartend_ab: 0 });
  assert.equal(z.verteilt.length, 3);
});

test('stand: deck shape, cells with frames, null for a free place, beat and bpm from the clock', async (t) => {
  const z = await aufbau(t);
  z.uhr(10);
  z.zeit(5500);   // half a second after the /uhr: one beat further
  const st = (await z.bereich.stand()).j;
  assert.equal(st.beat, 11); assert.equal(st.bpm, 120);
  assert.equal(st.decks[2], null);
  const d = st.decks[1];
  assert.deepEqual([d.platz, d.raster, d.spuren.length, d.gruppe_id], [1, 'takt', 4, z.projekt().gruppen.find((g) => g.loopdeck).id]);
  assert.deepEqual(Object.keys(d.spuren[0]), ['spur_id', 'nr', 'name', 'fader_db', 'mute', 'filter', 'eq', 'kill', 'send', 'zellen', 'lauf', 'effekt']);
  assert.equal(d.spuren[0].zellen.length, 8);
  assert.equal(d.spuren[0].zellen[0].frames, 96000);
  assert.equal(d.spuren[0].zellen[0].name, 'c1.1');
  assert.equal(d.spuren[0].zellen[1], null);
  const z3 = await aufbau(t, { deck: false });
  const k = (await z3.bereich.stand()).j;
  assert.deepEqual([k.decks[1], k.decks[2], k.beat, k.bpm], [null, null, null, null]);
});

test('core restart (new generation) clears the mirror and zuletzt; the same generation does not', async (t) => {
  const z = await aufbau(t);
  z.bereich.ereignis('/k/willkommen', { generation: 1 });
  z.zelleEv(1, { zelle: 2 });
  z.bereich.ereignis('/e/neustart', { generation: 1 });
  assert.equal((await z.bereich.stand()).j.decks[1].spuren[0].lauf.zelle, 2, 'same generation keeps it');
  z.bereich.ereignis('/e/neustart', { generation: 2 });
  assert.deepEqual((await z.bereich.stand()).j.decks[1].spuren[0].lauf, { zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });
});

test('cypher under Stop Cypher is refused 409 ki_gestoppt before anything is sent; andreas is not', async (t) => {
  const z = await aufbau(t);
  z.uhr(10);
  z.kern.ki = true;
  for (const f of [(q) => z.bereich.start({ deck: 1, spur: 1, zelle: 1 }, q), (q) => z.bereich.stopp({ deck: 1 }, q), (q) => z.bereich.szene({ deck: 1, zeile: 1 }, q)]) {
    const a = await f('cypher');
    assert.deepEqual([a.code, a.j.ok, grund(a)], [409, false, 'ki_gestoppt']);
  }
  assert.equal(z.kern.gesendet.length, 0);
  assert.equal((await z.bereich.start({ deck: 1, spur: 1, zelle: 1 }, 'andreas')).code, 200);
});

test('no live container: nothing is created by any route; bad arguments are 400', async (t) => {
  const z = await aufbau(t, { deck: false });
  z.uhr(10);
  const vorher = JSON.stringify(z.projekt());
  for (const f of [() => z.bereich.start({ deck: 1, spur: 1, zelle: 1 }, 'andreas'), () => z.bereich.stopp({ deck: 1 }, 'andreas'),
    () => z.bereich.szene({ deck: 1, zeile: 1 }, 'andreas'), () => z.bereich.stand()]) await f();
  assert.equal(JSON.stringify(z.projekt()), vorher, 'the project is untouched');
  assert.equal(z.zugang.offen().projekt.gruppen.some((g) => g.loopdeck), false);
  assert.equal(z.kern.gesendet.length, 0);
  const y = await aufbau(t);
  y.uhr(10);
  const bad = [[{ deck: 3, spur: 1, zelle: 1 }], [{ deck: 1, spur: 5, zelle: 1 }], [{ deck: 1, spur: 1, zelle: 9 }], [{ deck: 1, spur: 1, zelle: 1, versatz_beats: -1 }],
    [{ deck: 1, spur: 1, zelle: 1, raster: 'x' }], [{ deck: 1, spur: 1.5, zelle: 1 }]];
  for (const [d] of bad) { const a = await y.bereich.start(d, 'andreas'); assert.deepEqual([a.code, grund(a)], [400, 'argument_ungueltig'], JSON.stringify(d)); }
  assert.equal((await y.bereich.start({ deck: 1, spur: 1, zelle: 1, x: 1 }, 'andreas')).code, 400);
  assert.equal(grund(await y.bereich.szene({ deck: 1, zeile: 0 }, 'andreas')), 'argument_ungueltig');
  assert.equal(y.kern.gesendet.length, 0);
});

test('HTTP: the routes answer JSON with the same bodies', async (t) => {
  const z = await aufbau(t);
  z.uhr(10.3);
  const routen = z.bereich.routen();
  assert.deepEqual(routen.map((r) => `${r.methode} ${r.pfad}`), ['GET /loopdeck/stand', 'POST /loopdeck/start', 'POST /loopdeck/sprung', 'POST /loopdeck/stopp', 'POST /loopdeck/szene',
    'POST /loopdeck/laden', 'POST /loopdeck/zelle', 'POST /loopdeck/bewegen', 'POST /loopdeck/raster', 'POST /loopdeck/spur', 'POST /loopdeck/effekt', 'GET /loopdeck/effekte', 'POST /loopdeck/leeren', 'POST /loopdeck/neu']);
  assert.ok(routen.filter((r) => r.methode === 'POST').every((r) => r.schutz === 'fremdePost'));
  const ruf = async (r, body) => {
    const q = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    const aus = { code: 0, text: '', writeHead(c) { this.code = c; }, end(s) { this.text = s; } };
    await r.handler(q, aus, new URL('http://x/'));
    return { code: aus.code, j: JSON.parse(aus.text) };
  };
  const a = await ruf(routen[1], { deck: 1, spur: 1, zelle: 1 });
  assert.deepEqual([a.code, a.j], [200, { ok: true, ab_beat: 12, status: 1 }]);
  const b = await ruf(routen[1], { deck: 1, spur: 4, zelle: 1 });
  assert.deepEqual([b.code, b.j.ok, b.j.grund, typeof b.j.text], [409, false, 'zelle_leer', 'string']);
  assert.equal((await ruf(routen[0])).j.decks[1].platz, 1);
});

// ---- review fixes (loop deck M4/M5 fixes) ----------------------------------------------------------------------------------------------------

test('a cell that is not decoded yet is zelle_laedt: not sent by start; a scene stops its track instead of starting it', async (t) => {
  const z = await aufbau(t);   // row 1: tracks 1, 2 have a cell with a known length
  const fremd = 'b'.repeat(64);   // the decode bookkeeping does not know this one
  await z.aendern([{ befehl: 'zelle_setzen', spur_id: z.spuren()[1].id, index: 1, zelle: Z({ name: 'loading', sha256: fremd }) }]);
  z.uhr(10.3);
  const a = await z.bereich.start({ deck: 1, spur: 2, zelle: 1 }, 'andreas');
  assert.deepEqual([a.code, a.j.ok, grund(a), a.j.text], [409, false, 'zelle_laedt', 'That cell is still loading.']);
  assert.equal(z.kern.gesendet.length, 0, 'nothing went to the core');
  const b = await z.bereich.szene({ deck: 1, zeile: 1 }, 'andreas');
  assert.deepEqual(b.j, { ok: true, ab_beat: 12, gestartet: [1], gestoppt: [2, 3], laedt: [2] });
  assert.equal(z.gesendet('/k/arr/zelle_start').length, 1);
});

test('szene and stopp: one refused track is listed in abgelehnt (200); only when no track went out it is 409', async (t) => {
  const z = await aufbau(t);
  z.uhr(10.3);
  const nein = z.spuren()[1].id;
  z.kern.status = (g) => (g.felder.spur === nein ? { status: 6, grund: 'nicht_geladen' } : { status: 1, grund: '' });
  const a = await z.bereich.szene({ deck: 1, zeile: 1 }, 'andreas');
  assert.deepEqual(a.j, { ok: true, ab_beat: 12, gestartet: [1], gestoppt: [3], abgelehnt: [{ spur: 2, grund: 'nicht_geladen' }] });
  const b = await z.bereich.stopp({ deck: 1 }, 'andreas');
  assert.deepEqual([b.code, b.j.ok, b.j.abgelehnt], [200, true, [{ spur: 2, grund: 'nicht_geladen' }]]);
  const c = await z.bereich.stopp({ deck: 1, spur: 2 }, 'andreas');
  assert.deepEqual([c.code, grund(c)], [409, 'nicht_geladen']);
});

test('a new core generation forgets the clock and tells the page that every track has nothing playing (lauf null)', async (t) => {
  const z = await aufbau(t);
  z.bereich.ereignis('/k/willkommen', { generation: 1 });
  z.uhr(10);
  z.zelleEv(1, { zelle: 2 });
  z.zelleEv(3, { zelle: 1 });
  z.verteilt.length = 0;
  z.bereich.ereignis('/e/neustart', { generation: 2 });
  assert.deepEqual(z.verteilt.map((e) => [e.a, e.f.deck, e.f.spur, e.f.lauf]), [['loopdeck', 1, 1, null], ['loopdeck', 1, 3, null]]);
  assert.equal((await z.bereich.stand()).j.beat, null, 'the old clock is gone');
  const a = await z.bereich.start({ deck: 1, spur: 1, zelle: 1 }, 'andreas');
  assert.deepEqual([a.code, grund(a)], [409, 'keine_uhr']);
});

// channel strip MZ1: eq and kill through POST /loopdeck/spur and the stand
test('spur eq and kill: 200, the core got the EQ rows (kill as -200), stand keeps the knob value; bad types are 400', async (t) => {
  const z = await aufbau(t);
  const reihe = (pfad) => z.protokoll.gesendet.filter((g) => g.adresse === '/k/teil' && g.felder.pfad === pfad).map((g) => g.felder.nach);
  const nr = z.spuren()[0].nr;
  const a = await z.bereich.spurAendern({ deck: 1, spur: 1, eq: { mitte: -6 } }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual(a.j, { ok: true });
  assert.deepEqual(reihe(`spur/${nr}/eq/mitte`).at(-1), -6);
  const b = await z.bereich.spurAendern({ deck: 1, spur: 1, eq: { hoch: 3 }, kill: { hoch: true } }, 'andreas');
  assert.equal(b.code, 200, JSON.stringify(b.j));
  assert.deepEqual(reihe(`spur/${nr}/eq/hoch`).at(-1), -200);
  const d = (await z.bereich.stand()).j.decks[1].spuren[0];
  assert.deepEqual([d.eq, d.kill], [{ tief: 0, mitte: -6, hoch: 3 }, { tief: false, mitte: false, hoch: true }]);
  const c = await z.bereich.spurAendern({ deck: 1, spur: 1, kill: { hoch: false } }, 'andreas');
  assert.equal(c.code, 200);
  assert.equal(reihe(`spur/${nr}/eq/hoch`).at(-1), 3, 'kill off returns the knob value');
  for (const bad of [{ eq: { mitte: 'x' } }, { eq: 5 }, { kill: { tief: 1 } }, { kill: { tief: 'true' } }, { eq: { mitte: 99 } }, { eq: { bass: 0 } }, { kill: [] }]) {
    const r = await z.bereich.spurAendern({ deck: 1, spur: 1, ...bad }, 'andreas');
    assert.equal(r.code, 400, JSON.stringify(bad) + JSON.stringify(r.j));
    assert.equal(r.j.grund, 'argument_ungueltig');
  }
});

// channel strip MZ2: send through POST /loopdeck/spur
test('spur send: 200, the core got spur/<n>/send/<r> for the new return, stand shows it; eight production returns give 409 kein_platz', async (t) => {
  const z = await aufbau(t);
  const teile = (re) => z.protokoll.gesendet.filter((g) => g.adresse === '/k/teil' && re.test(g.felder.pfad));
  const nr = z.spuren()[0].nr;
  const rev = z.projekt().rev;
  const a = await z.bereich.spurAendern({ deck: 1, spur: 1, send: { hall: -6 } }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(z.projekt().rev, rev + 1, 'one undo step');
  const r = z.projekt().returns.find((x) => x.loopdeck?.art === 'hall');
  assert.deepEqual(teile(new RegExp(`^spur/${nr}/send/${r.nr}$`)).at(-1).felder.nach, -6);
  const d = (await z.bereich.stand()).j.decks[1].spuren;
  assert.deepEqual([d[0].send, d[1].send], [{ hall: -6, delay: -200 }, { hall: -200, delay: -200 }]);
  for (const bad of [{ send: { hall: 1 } }, { send: { hall: -201 } }, { send: { hall: 'x' } }, { send: { chorus: -6 } }, { send: {} }, { send: 5 }]) {
    const x = await z.bereich.spurAendern({ deck: 1, spur: 1, ...bad }, 'andreas');
    assert.equal(x.code, 400, JSON.stringify(bad) + JSON.stringify(x.j));
  }
  // send together with eq and a fader: one request, one undo step
  const rev2 = z.projekt().rev;
  assert.equal((await z.bereich.spurAendern({ deck: 1, spur: 2, fader_db: -3, eq: { tief: -2 }, send: { hall: -9 } }, 'andreas')).code, 200);
  assert.equal(z.projekt().rev, rev2 + 1);
  // fill the returns with production returns: a new delay return is refused
  await z.aendern(Array.from({ length: 7 }, () => ({ befehl: 'return_neu' })));   // MAX_RETURNS is 8 since the container core
  assert.equal(z.projekt().returns.length, 8);
  const full = await z.bereich.spurAendern({ deck: 1, spur: 1, send: { delay: -6 } }, 'andreas');
  assert.deepEqual([full.code, full.j.ok, full.j.grund], [409, false, 'kein_platz']);
  assert.match(full.j.text, /returns/);
  assert.equal(z.projekt().returns.length, 8, 'nothing changed');
});

// channel strip MZ3: the effect slot through POST /loopdeck/effekt and GET /loopdeck/effekte, with a temp graph folder (fx-remix, fx-crunch of the demos, fx-delay-sync)
const DEMOS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'instruments', 'modular_dsp', 'demos');
function graphOrdner(t, namen = ['fx-remix', 'fx-crunch', 'fx-delay-sync']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ldfx-'));
  for (const n of namen) fs.copyFileSync(path.join(DEMOS, `${n}.json`), path.join(dir, `${n}.json`));
  const alt = process.env.CYPHERDJ_BK_ORDNER;
  process.env.CYPHERDJ_BK_ORDNER = dir;
  t.after(() => { if (alt === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt; fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
const effektRoute = (z, pfad) => z.bereich.routen().find((r) => r.pfad === pfad);
const rufRoute = async (r, body) => {
  const q = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  const aus = { code: 0, text: '', writeHead(c) { this.code = c; }, end(s) { this.text = s; } };
  await r.handler(q, aus, new URL('http://x/'));
  return { code: aus.code, j: JSON.parse(aus.text) };
};

test('GET /loopdeck/effekte lists the qualifying graphs (remix, crunch first, not the wet-only delay); fx-crunch latency from the real file is within the limit', async (t) => {
  graphOrdner(t);
  const z = await aufbau(t);
  const a = await rufRoute(effektRoute(z, '/loopdeck/effekte'));
  assert.equal(a.code, 200);
  assert.deepEqual(a.j.graphen.map((g) => [g.name, g.kurz]), [['fx-remix', 'REMIX'], ['fx-crunch', 'CRUNCH']]);
  const crunch = a.j.graphen.find((g) => g.name === 'fx-crunch');
  console.log(`fx-crunch latency reported by the listing: ${crunch.latenz} samples`);
  assert.ok(crunch.latenz <= 64);
  assert.equal(effektRoute(z, '/loopdeck/effekte').methode, 'GET');
});

test('POST /loopdeck/effekt: set, replace, switch off, remove; stand carries effekt; bad graph 400 graph_unbekannt; bad bodies 400', async (t) => {
  graphOrdner(t);
  const z = await aufbau(t);
  const r = effektRoute(z, '/loopdeck/effekt');
  assert.equal(r.methode, 'POST');
  assert.equal(r.schutz, 'fremdePost');
  const stand = async () => (await z.bereich.stand()).j.decks[1].spuren;
  assert.equal((await stand())[0].effekt, null);
  const rev = z.projekt().rev;
  const a = await rufRoute(r, { deck: 1, spur: 1, graph: 'fx-crunch' });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(z.projekt().rev, rev + 1, 'one undo step');
  assert.deepEqual([a.j.ok, a.j.effekt.graph, a.j.effekt.an, typeof a.j.effekt.id], [true, 'fx-crunch', true, 'string']);
  assert.deepEqual((await stand())[0].effekt, a.j.effekt);
  assert.equal((await stand())[1].effekt, null);
  const b = await rufRoute(r, { deck: 1, spur: 1, graph: 'fx-remix' });
  assert.deepEqual([b.code, b.j.effekt.graph, b.j.effekt.id === a.j.effekt.id], [200, 'fx-remix', false], 'replaced: a new stage in the same place');
  assert.equal(z.projekt().spuren.find((s) => s.nr === z.spuren()[0].nr).inserts.length, 1);
  const rev2 = z.projekt().rev;
  const c = await rufRoute(r, { deck: 1, spur: 1, an: false });
  assert.deepEqual([c.code, c.j.effekt.an, c.j.effekt.graph], [200, false, 'fx-remix']);
  assert.equal(z.projekt().rev, rev2 + 1);
  assert.equal((await stand())[0].effekt.an, false);
  const d = await rufRoute(r, { deck: 1, spur: 1, graph: '' });
  assert.deepEqual([d.code, d.j], [200, { ok: true, effekt: null }]);
  assert.equal((await stand())[0].effekt, null);
  // refusals
  const e = await rufRoute(r, { deck: 1, spur: 1, graph: 'fx-delay-sync' });
  assert.deepEqual([e.code, e.j.ok, e.j.grund], [400, false, 'graph_unbekannt']);
  assert.equal((await rufRoute(r, { deck: 1, spur: 1, graph: 'nope' })).j.grund, 'graph_unbekannt');
  assert.equal((await rufRoute(r, { deck: 1, spur: 1, an: true })).j.grund, 'argument_ungueltig', 'no effect on this track');
  for (const bad of [{ deck: 1, spur: 1 }, { deck: 1, spur: 1, graph: 'fx-crunch', an: true }, { deck: 1, spur: 1, graph: 5 }, { deck: 1, spur: 1, an: 1 }, { deck: 1, spur: 5, graph: '' }, { deck: 3, spur: 1, graph: '' }, { deck: 1, spur: 1, graph: '', x: 1 }]) {
    const x = await rufRoute(r, bad);
    assert.equal(x.code, 400, JSON.stringify(bad) + JSON.stringify(x.j));
    assert.ok(['argument_ungueltig', 'argument_unbekannt'].includes(x.j.grund), JSON.stringify(x.j));
  }
});

test('POST /loopdeck/effekt: a full Baukasten pool is 409 kein_platz; a track at a full chain too', async (t) => {
  graphOrdner(t);
  const z = await aufbau(t);
  const r = effektRoute(z, '/loopdeck/effekt');
  const prod = [];
  for (let i = 0; i < 8; i++) prod.push({ befehl: 'spur_neu', art: 'audio', name: `P${i}` });
  await z.aendern(prod);
  await z.aendern(z.projekt().spuren.filter((s) => s.name.startsWith('P') && !s.zellen).map((s) => ({ befehl: 'insert_setzen', strang_id: s.id, pos: 0, art: 'bk', graph: 'fx-crunch' })));
  const a = await rufRoute(r, { deck: 1, spur: 1, graph: 'fx-crunch' });
  assert.deepEqual([a.code, a.j.ok, a.j.grund, a.j.text], [409, false, 'kein_platz', 'All 8 Baukasten effect stages are in use.']);
  const id = z.spuren()[1].id;
  await z.aendern([0, 1, 2, 3, 4].map((i) => ({ befehl: 'insert_setzen', strang_id: id, pos: i, art: i < 3 ? 'komp' : 'eq' })));
  const b = await rufRoute(r, { deck: 1, spur: 2, graph: 'fx-crunch' });
  assert.deepEqual([b.code, b.j.grund], [409, 'kein_platz']);
});
