// Session view S1b, B5 mapping (the first lines of the test, as the plan asks):
//   cell slots -> kit: played slot k sounds as source slot folge[k] and is the k-th kit slice, given to the writer in SOURCE SECONDS
//                      (von_s = g[folge[k]-1] / 48000, bis_s = g[folge[k]] / 48000, g = round(grenze * frames / beats) as the core loader reads it);
//                      the writer (sampler/kit.ts legeKitAusAudio) turns them into notes 36, 37, ... in that order.
//   slot n -> previewer: the previewer takes a file, not a range, so the slot is rendered through zellRendern over its played range
//                      [g[n-1], g[n]) (with the cell's gain) and handed over as one buffer.
// Session view S1b, B4: POST /session/neue_zelle renders one turn of a cell (slot order, reverse, gain, fades) into a new cell. The core side is a double
// as in session_route.test.mjs; the decoded audio comes from a hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { liveAufbau } from './support/live_module.mjs';
import { loopdeckBereich } from '../areas/live/loopdeck.ts';
import { sessionBereich } from '../areas/live/session.ts';
import { zellKarteVon, zellRendern } from '../project/zell_map.ts';

const SHA = 'a'.repeat(64), GROSS = 'c'.repeat(64), FRAMES = 96000;
const audio = Float32Array.from({ length: FRAMES * 2 }, (_, i) => Math.fround(Math.sin(i * 0.011) * 0.4));
const frames = (sha) => (sha === SHA ? FRAMES : sha === GROSS ? 67_000_000 : null);   // GROSS is 536 MB of decoded audio: with SHA just inside the budget, a third distinct sha is over it
const Z = (extra = {}) => ({ name: 'Loop', farbe: 3, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0, ...extra });

async function aufbau(t) {
  const z = await liveAufbau(t);
  const kern = { gesendet: [], id: 1000, ki: false };
  const ctx = { ...z.ctx,
    sende(adresse, felder) { const id = ++kern.id; kern.gesendet.push({ id, adresse, felder: { ...felder } }); return id; },
    async warteQuittung() { return { status: 1, grund: '' }; },
    kiGestoppt: () => kern.ki, quelle: () => 'andreas', verteile: () => {} };
  const ld = loopdeckBereich(ctx, z.zugang, { jetzt: () => 5000, frames });
  const gerufen = { kit: [], vorhoeren: [] };
  const bereich = sessionBereich(ctx, z.zugang, ld, { frames, audio: (sha) => (sha === SHA ? audio : null), ladenGesperrt: () => false,
    kit: (a) => { gerufen.kit.push(a); return { kit: 'drums' }; },
    vorhoeren: async (a) => { gerufen.vorhoeren.push(a); } });
  await z.aendern([{ befehl: 'loopdeck_neu', platz: 1 }]);
  const spuren = z.projekt().spuren.filter((x) => x.zellen);
  await z.aendern([{ befehl: 'zelle_setzen', spur_id: spuren[0].id, index: 1, zelle: Z({ name: 'Drums', gain_db: -6, keylock: false }) }]);
  const zelle = (n, i) => z.projekt().spuren.find((x) => x.id === spuren[n].id).zellen[i - 1];
  return { ...z, bereich, spuren, kern, zelle, gerufen };
}

test('neue_zelle renders the cell into the next empty cell of the column: same length, tempo and colour, name "<name> edit", baked gain, trocken', async (t) => {
  const z = await aufbau(t);
  await z.aendern([{ befehl: 'zelle_aendern', spur_id: z.spuren[0].id, index: 1, rueckwaerts: true, scheiben: { teilung: 'takt', grenzen: [0, 2], folge: [2, 1] }, transponieren: undefined }].map(({ transponieren, ...r }) => r));
  const a = await z.bereich.neueZelle({ spur_id: z.spuren[0].id, zelle: 1 }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual(a.j, { ok: true, spur_id: z.spuren[0].id, zelle: 2, trocken: true });
  const n = z.zelle(0, 2);
  assert.equal(n.name, 'Drums edit');
  assert.deepEqual([n.farbe, n.art, n.beats, n.bpm, n.gain_db, n.keylock], [3, 'loop', 4, 120, 0, false]);
  for (const k of ['scheiben', 'rueckwaerts', 'blende', 'transponieren', 'huellen']) assert.equal(n[k], undefined, `${k} is not on the new cell`);
  // the file is the render of one turn: WAV header + the buffer of zellRendern with the gain baked in
  const q = z.zelle(0, 1);
  const erwartet = zellRendern(audio, zellKarteVon(q, FRAMES, 4), 10 ** (-6 / 20));
  const wav = fs.readFileSync(path.join(z.zugang.offen().ordner, n.pfad_hinweis));
  assert.equal(wav.length, 58 + FRAMES * 8);
  assert.deepEqual(wav.subarray(58), Buffer.from(erwartet.buffer));
  assert.equal(crypto.createHash('sha256').update(wav).digest('hex'), n.sha256);
  assert.notEqual(n.sha256, q.sha256);
});

test('neue_zelle on a full column takes the next empty cell of the deck; on a full deck it is deck_voll and writes nothing', async (t) => {
  const z = await aufbau(t);
  await z.aendern(Array.from({ length: 7 }, (_, i) => ({ befehl: 'zelle_setzen', spur_id: z.spuren[0].id, index: i + 2, zelle: Z({ name: `c${i + 2}` }) })));
  const a = await z.bereich.neueZelle({ spur_id: z.spuren[0].id, zelle: 1 }, 'andreas');
  assert.deepEqual([a.code, a.j.spur_id, a.j.zelle], [200, z.spuren[1].id, 1]);
  // fill the rest of the deck
  const rest = [];
  for (const sp of [1, 2, 3]) for (let i = 1; i <= 8; i++) if (!z.zelle(sp, i)) rest.push({ befehl: 'zelle_setzen', spur_id: z.spuren[sp].id, index: i, zelle: Z({ name: `d${sp}${i}` }) });
  await z.aendern(rest);
  const dateien = () => fs.existsSync(path.join(z.zugang.offen().ordner, 'loops')) ? fs.readdirSync(path.join(z.zugang.offen().ordner, 'loops')).length : 0;
  const vorher = dateien();
  const b = await z.bereich.neueZelle({ spur_id: z.spuren[0].id, zelle: 1 }, 'andreas');
  assert.deepEqual([b.code, b.j.grund], [409, 'deck_voll']);
  assert.equal(dateien(), vorher);
});

test('neue_zelle over the audio budget is audio_budget and writes nothing', async (t) => {
  const z = await aufbau(t);
  await z.aendern([{ befehl: 'zelle_setzen', spur_id: z.spuren[1].id, index: 1, zelle: Z({ name: 'huge', sha256: GROSS, beats: 64 }) }]);
  const ordner = path.join(z.zugang.offen().ordner, 'loops');
  const vorher = fs.existsSync(ordner) ? fs.readdirSync(ordner).length : 0;
  const a = await z.bereich.neueZelle({ spur_id: z.spuren[0].id, zelle: 1 }, 'andreas');
  assert.deepEqual([a.code, a.j.grund], [409, 'audio_budget']);
  assert.equal(fs.existsSync(ordner) ? fs.readdirSync(ordner).length : 0, vorher);
});

test('neue_zelle: an empty cell is zelle_leer, an undecoded one zelle_laedt, bad fields are 400, Stop Cypher refuses cypher', async (t) => {
  const z = await aufbau(t);
  assert.equal((await z.bereich.neueZelle({ spur_id: z.spuren[0].id, zelle: 5 }, 'andreas')).j.grund, 'zelle_leer');
  await z.aendern([{ befehl: 'zelle_setzen', spur_id: z.spuren[2].id, index: 1, zelle: Z({ sha256: 'b'.repeat(64) }) }]);
  assert.equal((await z.bereich.neueZelle({ spur_id: z.spuren[2].id, zelle: 1 }, 'andreas')).j.grund, 'zelle_laedt');
  assert.equal((await z.bereich.neueZelle({ spur_id: z.spuren[0].id, zelle: 1, x: 1 }, 'andreas')).j.grund, 'argument_unbekannt');
  assert.equal((await z.bereich.neueZelle({ spur_id: z.spuren[0].id, zelle: 9 }, 'andreas')).j.grund, 'argument_ungueltig');
  z.kern.ki = true;
  assert.equal((await z.bereich.neueZelle({ spur_id: z.spuren[0].id, zelle: 1 }, 'cypher')).j.grund, 'ki_gestoppt');
});

const TAKT16 = { teilung: '1/16', grenzen: Array.from({ length: 16 }, (_, i) => i * 0.25), folge: Array.from({ length: 16 }, (_, i) => i + 1) };

test('zum_sampler on a 16-slot cell asks the kit writer for 16 slices with the source seconds of the slots (played order)', async (t) => {
  const z = await aufbau(t);
  await z.aendern([{ befehl: 'zelle_aendern', spur_id: z.spuren[0].id, index: 1, scheiben: { ...TAKT16, folge: [2, 1, ...TAKT16.folge.slice(2)] } }]);
  const a = await z.bereich.zumSampler({ spur_id: z.spuren[0].id, zelle: 1 }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual(a.j, { ok: true, kit: 'drums' });
  const [k] = z.gerufen.kit;
  assert.equal(z.gerufen.kit.length, 1);
  assert.equal(k.scheiben.length, 16);
  assert.equal(k.name, 'Drums');
  assert.equal(k.daten, audio);
  // 4 beats at 120 bpm are 2 s: a 1/16 slot is 0.125 s; played slot 1 is source slot 2
  assert.deepEqual(k.scheiben[0], { von_s: 0.125, bis_s: 0.25 });
  assert.deepEqual(k.scheiben[1], { von_s: 0, bis_s: 0.125 });
  assert.deepEqual(k.scheiben[15], { von_s: 1.875, bis_s: 2 });
});

test('zum_sampler and vorhoeren without scheiben are scheiben_ungueltig; an empty cell is zelle_leer; Stop Cypher refuses cypher', async (t) => {
  const z = await aufbau(t);
  for (const f of [(x) => z.bereich.zumSampler(x, 'andreas'), (x) => z.bereich.vorhoeren({ ...x, slot: 1 }, 'andreas')]) {
    assert.deepEqual([(await f({ spur_id: z.spuren[0].id, zelle: 1 })).j.grund], ['scheiben_ungueltig']);
    assert.equal((await f({ spur_id: z.spuren[0].id, zelle: 6 })).j.grund, 'zelle_leer');
  }
  assert.equal(z.gerufen.kit.length + z.gerufen.vorhoeren.length, 0);
  await z.aendern([{ befehl: 'zelle_aendern', spur_id: z.spuren[0].id, index: 1, scheiben: TAKT16 }]);
  z.kern.ki = true;
  assert.equal((await z.bereich.zumSampler({ spur_id: z.spuren[0].id, zelle: 1 }, 'cypher')).j.grund, 'ki_gestoppt');
  assert.equal((await z.bereich.vorhoeren({ spur_id: z.spuren[0].id, zelle: 1, slot: 3 }, 'cypher')).j.grund, 'ki_gestoppt');
  assert.equal(z.gerufen.kit.length + z.gerufen.vorhoeren.length, 0);
});

test('vorhoeren { slot: 3 } hands the previewer exactly slot 3 as the cell plays it (reverse and gain included)', async (t) => {
  const z = await aufbau(t);
  await z.aendern([{ befehl: 'zelle_aendern', spur_id: z.spuren[0].id, index: 1, scheiben: { ...TAKT16, folge: [...TAKT16.folge.slice(1), 1] }, rueckwaerts: true }]);
  const a = await z.bereich.vorhoeren({ spur_id: z.spuren[0].id, zelle: 1, slot: 3 }, 'andreas');
  assert.deepEqual([a.code, a.j], [200, { ok: true }]);
  assert.equal(z.gerufen.vorhoeren.length, 1);
  const v = z.gerufen.vorhoeren[0];
  assert.equal(v.slot, 3);
  assert.equal(v.sha, SHA);
  const q = z.zelle(0, 1);
  const k = zellKarteVon(q, FRAMES, 4);
  assert.equal(v.daten.length, 2 * 6000, 'a 1/16 slot of 2 s is 6000 frames');
  assert.deepEqual(Buffer.from(v.daten.buffer, v.daten.byteOffset, v.daten.byteLength), Buffer.from(zellRendern(audio, k, 10 ** (-6 / 20), 12000, 18000).buffer));
});

test('vorhoeren: a slot outside 1..64 or beyond the cell slots is argument_ungueltig; unknown fields are argument_unbekannt', async (t) => {
  const z = await aufbau(t);
  await z.aendern([{ befehl: 'zelle_aendern', spur_id: z.spuren[0].id, index: 1, scheiben: TAKT16 }]);
  for (const slot of [0, 65, 17, 1.5, '3']) {
    assert.deepEqual([(await z.bereich.vorhoeren({ spur_id: z.spuren[0].id, zelle: 1, slot }, 'andreas')).j.grund], ['argument_ungueltig'], String(slot));
  }
  assert.equal((await z.bereich.vorhoeren({ spur_id: z.spuren[0].id, zelle: 1, slot: 1, x: 1 }, 'andreas')).j.grund, 'argument_unbekannt');
  assert.equal(z.gerufen.vorhoeren.length, 0);
});
