// Session view S1b, B6: POST /session/zelle and POST /session/huelle, thin wrappers over zelle_aendern and zelle_huelle (no project rev), and the reason texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveAufbau } from './support/live_module.mjs';
import { loopdeckBereich } from '../areas/live/loopdeck.ts';
import { sessionBereich } from '../areas/live/session.ts';
import { grundText } from '../http/reasons.ts';

const SHA = 'a'.repeat(64);
const frames = (sha) => (sha === SHA ? 96000 : null);
const Z = (extra = {}) => ({ name: 'Loop', farbe: 3, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0, ...extra });

async function aufbau(t) {
  const z = await liveAufbau(t);
  const kern = { gesendet: [], id: 1000, ki: false };
  const ctx = { ...z.ctx,
    sende(adresse, felder) { const id = ++kern.id; kern.gesendet.push({ id, adresse, felder: { ...felder } }); return id; },
    async warteQuittung() { return { status: 1, grund: '' }; }, kiGestoppt: () => kern.ki, quelle: () => 'andreas', verteile: () => {} };
  const ld = loopdeckBereich(ctx, z.zugang, { jetzt: () => 5000, frames });
  const bereich = sessionBereich(ctx, z.zugang, ld, { frames, ladenGesperrt: () => false });
  await z.aendern([{ befehl: 'loopdeck_neu', platz: 1 }]);
  const spuren = z.projekt().spuren.filter((x) => x.zellen);
  await z.aendern([{ befehl: 'zelle_setzen', spur_id: spuren[0].id, index: 1, zelle: Z() }, { befehl: 'zelle_setzen', spur_id: spuren[1].id, index: 1, zelle: Z({ art: 'einmal' }) }]);
  const zelle = (n, i = 1) => z.projekt().spuren.find((x) => x.id === spuren[n].id).zellen[i - 1];
  return { ...z, bereich, spuren, kern, zelle };
}

test('/session/zelle sets and removes the editor fields in one command each', async (t) => {
  const z = await aufbau(t);
  const sp = z.spuren[0].id;
  const a = await z.bereich.zelleAendern({ spur_id: sp, zelle: 1, transponieren: 3, rueckwaerts: true, blende: true, name: 'Edit', gain_db: -3 }, 'andreas');
  assert.deepEqual([a.code, a.j], [200, { ok: true }]);
  assert.deepEqual([z.zelle(0).transponieren, z.zelle(0).rueckwaerts, z.zelle(0).blende, z.zelle(0).name, z.zelle(0).gain_db], [3, true, true, 'Edit', -3]);
  // keylock off while the cell is transposed is nur_keylock, nothing changes
  const k0 = await z.bereich.zelleAendern({ spur_id: sp, zelle: 1, keylock: false }, 'andreas');
  assert.deepEqual([k0.code, k0.j.grund], [409, 'nur_keylock']);
  assert.deepEqual([z.zelle(0).transponieren, z.zelle(0).keylock], [3, undefined]);
  const k1 = await z.bereich.zelleAendern({ spur_id: sp, zelle: 1, transponieren: null, keylock: false }, 'andreas');
  assert.equal(k1.code, 200, JSON.stringify(k1.j));
  assert.deepEqual([z.zelle(0).transponieren, z.zelle(0).keylock], [undefined, false]);
  const b = await z.bereich.zelleAendern({ spur_id: sp, zelle: 1, transponieren: 5 }, 'andreas');
  assert.deepEqual([b.code, b.j.grund], [409, 'nur_keylock']);
  const c = await z.bereich.zelleAendern({ spur_id: sp, zelle: 1, rueckwaerts: null, blende: null, keylock: null }, 'andreas');
  assert.equal(c.code, 200, JSON.stringify(c.j));
  for (const k of ['transponieren', 'rueckwaerts', 'blende', 'keylock']) assert.equal(z.zelle(0)[k], undefined, k);
});

test('/session/zelle: transponieren on an einmal cell is 409 nur_keylock; a slice table the model refuses is scheiben_ungueltig', async (t) => {
  const z = await aufbau(t);
  const a = await z.bereich.zelleAendern({ spur_id: z.spuren[1].id, zelle: 1, transponieren: 2 }, 'andreas');
  assert.deepEqual([a.code, a.j.ok, a.j.grund], [409, false, 'nur_keylock']);
  const b = await z.bereich.zelleAendern({ spur_id: z.spuren[0].id, zelle: 1, scheiben: { teilung: 'takt', grenzen: [1, 2], folge: [1, 2] } }, 'andreas');
  assert.deepEqual([b.code, b.j.grund], [409, 'scheiben_ungueltig']);
  assert.equal(z.zelle(0).scheiben, undefined);
});

test('/session/zelle: empty cell zelle_leer, unknown field argument_unbekannt, bad cell argument_ungueltig, Stop Cypher refuses cypher', async (t) => {
  const z = await aufbau(t);
  assert.equal((await z.bereich.zelleAendern({ spur_id: z.spuren[0].id, zelle: 5, blende: true }, 'andreas')).j.grund, 'zelle_leer');
  assert.equal((await z.bereich.zelleAendern({ spur_id: z.spuren[0].id, zelle: 1, art: 'einmal' }, 'andreas')).j.grund, 'argument_unbekannt');
  assert.equal((await z.bereich.zelleAendern({ spur_id: z.spuren[0].id, zelle: 9, blende: true }, 'andreas')).j.grund, 'argument_ungueltig');
  z.kern.ki = true;
  assert.equal((await z.bereich.zelleAendern({ spur_id: z.spuren[0].id, zelle: 1, blende: true }, 'cypher')).j.grund, 'ki_gestoppt');
});

test('/session/huelle sets and removes an envelope; a bad one is huelle_ungueltig', async (t) => {
  const z = await aufbau(t);
  const sp = z.spuren[0].id;
  const a = await z.bereich.huelle({ spur_id: sp, zelle: 1, ziel: 'filter', punkte: [{ beat: 0, wert: -1 }, { beat: 2, wert: 1 }] }, 'andreas');
  assert.deepEqual([a.code, a.j], [200, { ok: true }]);
  assert.deepEqual(z.zelle(0).huellen.map((h) => h.ziel), ['filter']);
  const b = await z.bereich.huelle({ spur_id: sp, zelle: 1, ziel: 'filter', punkte: [{ beat: 0, wert: -3 }] }, 'andreas');
  assert.deepEqual([b.code, b.j.grund], [409, 'huelle_ungueltig']);
  const c = await z.bereich.huelle({ spur_id: sp, zelle: 1, ziel: 'filter', punkte: null }, 'andreas');
  assert.equal(c.code, 200, JSON.stringify(c.j));
  assert.equal(z.zelle(0).huellen, undefined);
  assert.equal((await z.bereich.huelle({ spur_id: sp, zelle: 1, ziel: 'filter' }, 'andreas')).j.grund, 'argument_ungueltig');
  assert.equal((await z.bereich.huelle({ spur_id: sp, zelle: 1, ziel: 'filter', punkte: null, x: 1 }, 'andreas')).j.grund, 'argument_unbekannt');
});

test('the four S1b refusals have a reason text of their own', () => {
  for (const g of ['nur_keylock', 'scheiben_ungueltig', 'huelle_ungueltig', 'zellen_ungueltig']) {
    assert.ok(!grundText(g).startsWith('request refused'), g);
  }
});
