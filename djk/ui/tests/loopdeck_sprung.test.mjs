// Loop deck X1: POST /loopdeck/sprung of LoopdeckBereich (restart the playing or last cell at a slice). The core side (send, receipts, events) is a double: every
// command is recorded and answered by the test; the live container is the real proj session of support/live_modul.mjs. The clock is a parameter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { liveAufbau } from './support/live_module.mjs';
import { loopdeckBereich } from '../areas/live/loopdeck.ts';

const SHA = 'a'.repeat(64);
const Z = (extra = {}) => ({ name: 'Loop', farbe: 3, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0, ...extra });

// ctx: the one of the live setup, but sende/warteQuittung answer from `kern` (default: accepted, status 1) and quelle/kiGestoppt are switchable
async function aufbau(t, { deck = true, zellen = [[1, 1], [1, 3], [2, 1], [3, 8], [4, 2]] } = {}) {
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
test('a playing loop restarts at the slice offset on the next grid point, through the start path', async (t) => {
  const z = await aufbau(t);
  z.uhr(10.3);
  z.zelleEv(1, { zelle: 3, ab_beat: 8 });
  const a = await z.bereich.sprung({ deck: 1, spur: 1, slice: 5 }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual(a.j, { ok: true, ab_beat: 12, zelle: 3, versatz_beats: 2 });   // (5 - 1) * 4 / 8
  assert.deepEqual(z.gesendet('/k/arr/zelle_start')[0].felder, { quelle: 'andreas', spur: z.spuren()[0].id, zelle: 3, ab_beat: 12, versatz_beats: 2 });
  const b = await z.bereich.sprung({ deck: 1, spur: 1, slice: 1 }, 'andreas');
  assert.equal(b.j.versatz_beats, 0);
  const c = await z.bereich.sprung({ deck: 1, spur: 1, slice: 8 }, 'andreas');
  assert.equal(c.j.versatz_beats, 3.5);
});

test('a stopped track jumps in its last played cell', async (t) => {
  const z = await aufbau(t);
  z.uhr(10.3);
  z.zelleEv(2, { zelle: 1, ab_beat: 8 });
  z.zelleEv(2, { zelle: 0 });   // stopped: zuletzt stays
  const a = await z.bereich.sprung({ deck: 1, spur: 2, slice: 3 }, 'andreas');
  assert.deepEqual(a.j, { ok: true, ab_beat: 12, zelle: 1, versatz_beats: 1 });
});

test('no cell ever played is 409 nichts_gespielt and nothing is sent', async (t) => {
  const z = await aufbau(t);
  z.uhr(10.3);
  const a = await z.bereich.sprung({ deck: 1, spur: 1, slice: 2 }, 'andreas');
  assert.deepEqual([a.code, a.j.ok, grund(a)], [409, false, 'nichts_gespielt']);
  assert.ok(a.j.text);
  assert.equal(z.kern.gesendet.length, 0);
});

test('a one-shot cell is 409 nur_loop and nothing is sent', async (t) => {
  const z = await aufbau(t);
  await z.aendern([{ befehl: 'zelle_setzen', spur_id: z.spuren()[3].id, index: 2, zelle: Z({ name: 'hit', art: 'einmal' }) }]);
  z.uhr(10.3);
  z.zelleEv(4, { zelle: 2, ab_beat: 8 });
  const a = await z.bereich.sprung({ deck: 1, spur: 4, slice: 2 }, 'andreas');
  assert.deepEqual([a.code, a.j.ok, grund(a)], [409, false, 'nur_loop']);
  assert.ok(a.j.text);
  assert.equal(z.kern.gesendet.length, 0);
});

test('missing deck, bad slice, unknown field, no clock and Stop Cypher are refused', async (t) => {
  const z = await aufbau(t);
  z.zelleEv(1, { zelle: 1 });
  assert.equal(grund(await z.bereich.sprung({ deck: 2, spur: 1, slice: 1 }, 'andreas')), 'kein_loopdeck');
  for (const slice of [0, 9, 1.5, '2']) assert.equal((await z.bereich.sprung({ deck: 1, spur: 1, slice }, 'andreas')).code, 400, `slice ${slice}`);
  assert.equal((await z.bereich.sprung({ deck: 1, spur: 1, slice: 1, x: 1 }, 'andreas')).code, 400);
  assert.equal(grund(await z.bereich.sprung({ deck: 1, spur: 1, slice: 1 }, 'andreas')), 'keine_uhr');
  z.uhr(10); z.kern.ki = true;
  assert.equal(grund(await z.bereich.sprung({ deck: 1, spur: 1, slice: 1 }, 'cypher')), 'ki_gestoppt');
  assert.equal(z.kern.gesendet.length, 0);
});

test('the route is registered as POST /loopdeck/sprung', async (t) => {
  const z = await aufbau(t);
  assert.ok(z.bereich.routen().some((r) => r.methode === 'POST' && r.pfad === '/loopdeck/sprung'));
});
