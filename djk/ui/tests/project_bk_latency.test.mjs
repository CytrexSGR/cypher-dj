// A project track with an instrument graph that has latency (synth-neuro: 69 samples) is accepted by the page server, travels into the playback file, and the page reports the
// strip latency where it reports insert latency (the delay compensation of the core counts it at the head of the strip's chain, core test test_arr_bk_latenz).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fuehreListeAus } from '../project/commands.ts';
import { pruefeProjekt } from '../project/model.ts';
import { uebersetze } from '../project/playback.ts';
import { listeGraphen } from '../graphs.ts';
import { pdcRechnen, latenzZeile, streifenText } from '../public/production/pdc.js';
import { specProjekt, SHA_A, SHA_B } from './support/project.mjs';

const DEMOS = path.join(import.meta.dirname, '..', '..', 'instruments', 'modular_dsp', 'demos');
const opt = () => ({ nr: 1, audioOrdner: '/arbeit/arr/audio', frames: (sha) => (sha === SHA_A || sha === SHA_B ? 24000 : null) });
const lat = () => Object.fromEntries(listeGraphen(DEMOS).graphen.map((g) => [g.name, g.latenz]));

test('synth-neuro on a project track: the server accepts it, the playback carries the graph, the page reports 69 samples on the strip', () => {
  const graphen = listeGraphen(DEMOS).graphen;
  const neuro = graphen.find((g) => g.name === 'synth-neuro');
  assert.equal(neuro?.art, 'instrument');
  assert.equal(neuro.latenz, 69, 'positive control: the graph reports latency');
  const graphArt = (n) => graphen.find((g) => g.name === n)?.art ?? null;
  const bk = (graph) => [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph, parameter: {} } }];
  const r = fuehreListeAus(specProjekt(), bk('synth-neuro'), { graphArt });
  assert.ok('projekt' in pruefeProjekt(r.projekt), 'the project is valid');
  const neu = r.projekt.spuren.at(-1);
  assert.equal(neu.geraet.graph, 'synth-neuro');
  const w = uebersetze(r.projekt, opt());
  assert.ok(w.spuren.some((s) => s.geraet === 'bk' && s.graph === 'synth-neuro'), 'the playback file carries the track');
  const rechnen = pdcRechnen(r.projekt, null, lat());
  assert.equal(rechnen.streifen[neu.id].kette, 69);
  assert.equal(rechnen.gesamt, 69);
  assert.equal(rechnen.streifen[r.projekt.spuren[0].id].versatz, 69, 'the other strips are delayed to stay in time');
  assert.equal(streifenText(rechnen.streifen[neu.id]), 'chain 1.4 ms');
  assert.match(latenzZeile(r.projekt, null, lat()), /^Latency 1\.4 ms \(69 samples\): the strips are delayed to stay in time/);
  // negative control: a latency-free graph adds nothing, and without the graph list the page says nothing it does not know
  const frei = fuehreListeAus(specProjekt(), bk('mseg-neuro-bass'), { graphArt });
  assert.equal(pdcRechnen(frei.projekt, null, lat()).gesamt, 0);
  assert.equal(pdcRechnen(r.projekt).gesamt, 0);
});
