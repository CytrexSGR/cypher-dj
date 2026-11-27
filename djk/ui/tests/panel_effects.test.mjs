// Front panels of the effect graphs (group "effekte"): every rule names controls of its panel and carries a hint text, every knob number
// of the installed graph is bound by some control, and the server's own check (pruefePanel) accepts the panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { steuerungen } from '../public/panel.js';
import { pruefePanel, reglerBereiche } from '../graphs.ts';
import { werksgraphPfad } from './werksgraph_path.mjs';

const PANEELE = new URL('../../instruments/modular_dsp/paneele/', import.meta.url);

const NAMEN = ['fx-bandecho', 'fx-chorus', 'fx-crunch', 'fx-delay-sync', 'fx-diode-acid', 'fx-drive', 'fx-echo', 'fx-echo-achtel', 'fx-federhall',
  'fx-filter-fahrt', 'fx-filter-regler', 'fx-filter-wobble', 'fx-filterbox', 'fx-flanger', 'fx-flanger-sync', 'fx-folger-filter',
  'fx-formant-sprech', 'fx-kamm-metall', 'fx-labor', 'fx-lofi-sp1200', 'fx-ms20-schrei', 'fx-phaser', 'fx-phaser-sync', 'fx-polaritaet', 'fx-remix',
  'fx-resonator', 'fx-roehre', 'fx-sem-fahrt', 'fx-sh-filter', 'fx-space', 'fx-takt-pump', 'fx-tremolo', 'fx-vocoder-robot', 'fx-wahl-filter',
  'space-kammer', 'space-platte', 'space-raum'];

const lies = (name) => JSON.parse(fs.readFileSync(new URL(`${name}.json`, PANEELE), 'utf8'));
const graph = (name) => JSON.parse(fs.readFileSync(werksgraphPfad(name), 'utf8'));

const regelnPruefen = (name) => {
  const sts = steuerungen(lies(name));
  const ids = new Set(sts.map((c) => c.id));
  const namen = (b) => (!b ? [] : b.alle ? b.alle.flatMap(namen) : b.eine ? b.eine.flatMap(namen) : [Object.values(b)[0][0]]);
  for (const c of sts.filter((x) => x.wirkt)) {
    assert.equal(typeof c.wirkt_text, 'string', `${name} ${c.id}: text`);
    assert.ok(c.wirkt_text.length > 0, `${name} ${c.id}: text`);
    for (const n of namen(c.wirkt)) assert.ok(ids.has(n), `${name} ${c.id}: names unknown control ${n}`);
  }
};

const gebundene = (name) => {
  const nr = new Set();
  for (const c of steuerungen(lies(name))) {
    const b = c.bind ?? {};
    for (const x of [b, b.x, b.y, b.touch]) {
      const m = /^k(\d+)$/.exec(x?.param ?? '');
      if (m) nr.add(Number(m[1]));
    }
  }
  return nr;
};

for (const name of NAMEN) {
  test(`${name}: rules name existing controls and have a text`, () => regelnPruefen(name));

  test(`${name}: every knob number of the graph is bound`, () => {
    const g = graph(name);
    const gebunden = gebundene(name);
    const nummern = new Set(g.knoten.filter((k) => k.art === 'regler').map((k) => k.nr));
    for (const n of nummern) assert.ok(gebunden.has(n), `${name}: knob k${n} has no control`);
    for (const n of gebunden) assert.ok(nummern.has(n), `${name}: control binds k${n}, the graph has no such knob`);
  });

  test(`${name}: the server check accepts the panel`, () => {
    assert.deepEqual(pruefePanel(lies(name), name, reglerBereiche(graph(name))), []);
  });
}
