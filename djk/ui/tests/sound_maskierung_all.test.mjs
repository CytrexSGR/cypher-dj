// Strand 5 slice 6: POST /proj/analyse {alle_paare: true} as a flow (areas/proj/sound_analysis.ts KlangAnalyse.maskierung + Ausgabe.rendereStreifen)
// against the S2 integration and the render double of proj_analysis_flow.test.mjs. The measuring and the masking function are stand-ins: this file checks
// what is rendered, what is handed to the masking and what the answer carries, not the numbers (those are in sound_measurement.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aufbau } from './support/output_setup.mjs';
import { alsAntwort } from '../areas/proj/output.ts';
import { KlangAnalyse } from '../areas/proj/sound_analysis.ts';

async function ruf(f) { try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); } }
const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const protokollDatei = (a) => path.join(a.tmp, 'render.jsonl');
const renderAufrufe = (a) => (fs.existsSync(protokollDatei(a)) ? fs.readFileSync(protokollDatei(a), 'utf8').trim().split('\n').map((z) => JSON.parse(z)) : []);
const MISCHUNG = (a) => ({ RENDER_ATTRAPPE_MISCHUNG: '1', RENDER_ATTRAPPE_PROTOKOLL: protokollDatei(a) });

function klang(a, mitschrift) {
  return new KlangAnalyse(a.ausgabe, {
    analysiereViele: async (dateien, frames) => { mitschrift.dateien = dateien; mitschrift.frames = frames;
      return dateien.map((d, i) => ({ stumm: d === null, spitze_db: -6, rms_db: -20 + i, crest_db: 14, spalten: 1, spaltenTerz: new Float32Array(30) })); },
    maskierung: (teile, max) => { mitschrift.teile = teile; mitschrift.max = max;
      return [{ a: teile[0].id, b: teile[1].id, hz_von: 80, hz_bis: 120, anteil: 0.8, breite_okt: 0.5, score: 0.4, leiser: teile[1].id, vorschlag: null }]; },
  });
}

test('alle_paare renders every sounding track once and answers the masking list', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const m = {};
  const r = await mitUmgebung(MISCHUNG(a), () => ruf(() => klang(a, m).analysiere({ alle_paare: true, von_beat: 0, bis_beat: 8 })));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const spuren = a.ausgabe.klingendeSpuren(0, 8).length;   // the tracks with something in the range
  assert.ok(spuren >= 2 && spuren < a.projekt().spuren.length, 'the fixture has a track that does not play');
  assert.equal(r.body.maskierung.length, 1);
  assert.equal(r.body.begrenzt, false);
  assert.equal(r.body.anzahl, m.dateien.length);
  assert.equal(m.max, 5);
  assert.ok(m.teile.every((x) => typeof x.id === 'string' && x.pos === 0 && x.pegel_db < 0));
  assert.equal(renderAufrufe(a).length, spuren, 'one render per track, no more');
  assert.equal(a.projekt().rev, r.body.rev, 'nothing is written into the project');
});

test('alle_paare refuses unknown fields, alle_paare false and a bad range', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const k = klang(a, {});
  const fehler = async (d) => { const r = await ruf(() => k.analysiere(d)); return [r.code, r.body.fehler]; };
  assert.deepEqual(await fehler({ alle_paare: true, quelle: { art: 'master' } }), [400, 'argument_ungueltig']);
  assert.deepEqual(await fehler({ alle_paare: false }), [400, 'argument_ungueltig']);
  assert.equal((await fehler({ alle_paare: true, von_beat: 8, bis_beat: 4 }))[0], 400);
});
