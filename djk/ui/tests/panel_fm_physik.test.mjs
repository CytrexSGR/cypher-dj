// Panels of group fm_physik (FM, granular, resonator, string, comb, labor, feedback): every wirkt rule names controls of its panel and
// has a text, and every knob the installed graph has is bound by a control.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { steuerungen } from '../public/panel.js';
import { werksgraphPfad } from './werksgraph_path.mjs';

const panel = (name) => steuerungen(JSON.parse(fs.readFileSync(new URL(`../../instruments/modular_dsp/paneele/${name}.json`, import.meta.url), 'utf8')));
const regelnPruefen = (name, mindestens) => test(`${name}: every rule names controls of the panel`, () => {
  const sts = panel(name);
  const ids = new Set(sts.map((c) => c.id));
  const namen = (b) => (!b ? [] : b.alle ? b.alle.flatMap(namen) : b.eine ? b.eine.flatMap(namen) : [Object.values(b)[0][0]]);
  const mit = sts.filter((x) => x.wirkt);
  assert.ok(mit.length >= mindestens, `${mit.length} rules`);
  for (const c of mit) {
    assert.equal(typeof c.wirkt_text, 'string', `${c.id}: text`);
    assert.ok(c.wirkt_text.length > 0, `${c.id}: text`);
    for (const n of namen(c.wirkt)) assert.ok(ids.has(n), `${c.id}: ${n}`);
  }
});
const reglerPruefen = (name) => test(`${name}: every knob of the graph is bound`, (t) => {
  const datei = werksgraphPfad(name);
  if (!fs.existsSync(datei)) return t.skip('graph not installed');
  const graph = JSON.parse(fs.readFileSync(datei, 'utf8'));
  const nrn = new Set(graph.knoten.filter((k) => k.art === 'regler').map((k) => k.nr));
  const gebunden = new Set(panel(name).flatMap((c) => (c.bind?.param ? [c.bind.param] : [])));
  for (const nr of nrn) assert.ok(gebunden.has(`k${nr}`), `k${nr} is not bound`);
});

const GRUPPE = {
  'bass-fm': 0, 'lead-fm': 2, 'fm-glocke-hoch': 5, 'fm-bass': 4, 'fm-epiano': 4, 'fm-glocke': 4, 'fm-lead': 6,
  'granular-drone': 0, 'granular-pad': 0, 'granular-textur': 0, 'kamm-goa-zupf': 0,
  'resonator-glocke': 0, 'resonator-marimba': 0, 'resonator-metall': 0,
  'saite': 0, 'saite-gitarre': 0, 'saite-harfe': 0, 'saite-karplus': 0, 'saite-klavier': 0,
  'labor': 6, 'rueckkopplung': 0,
};
for (const [name, mindestens] of Object.entries(GRUPPE)) { regelnPruefen(name, mindestens); reglerPruefen(name); }
