// Panels of the analog stock group: every wirkt rule names controls of its panel and has a hint text,
// and every knob of the installed graph is bound by a control; plus the greying of the group's rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { ruhendeSteuerungen } from '../public/panel_wirkung.js';
import { steuerungen } from '../public/panel.js';

const panel = (name) => steuerungen(JSON.parse(fs.readFileSync(new URL(`../../instruments/modular_dsp/paneele/${name}.json`, import.meta.url), 'utf8')));
const regelnPruefen = (titel, name, mindestens) => test(`${titel}: every rule names controls of the panel`, () => {
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

const GRUPPE = {
  'bassmusik': 1, 'diode-acid-bass': 1, 'diode-goa-linie': 1, 'falter-demo': 0, 'formant-neuro-bass': 0, 'goa-blubber-lead': 1,
  'hartsync-bass': 1, 'hartsync-lead': 1, 'hartsync-pad': 0, 'juno-pad': 0, 'ms20-bass': 0, 'ms20-goa-lead': 0, 'mseg-neuro-bass': 0,
  'roehre-lead': 0, 'saege-ladder': 2, 'sem-house-akkord': 0, 'sem-pad': 1,
};
for (const [name, n] of Object.entries(GRUPPE)) regelnPruefen(name, name, n);

const graphPfad = (name) => `${os.homedir()}/cypherdj/werke/geraete/${name}.json`;
for (const name of Object.keys(GRUPPE)) {
  test(`${name}: every knob of the graph is bound by a control`, { skip: !fs.existsSync(graphPfad(name)) && 'graph not installed' }, () => {
    const g = JSON.parse(fs.readFileSync(graphPfad(name), 'utf8'));
    const gebunden = new Set(panel(name).map((c) => c.bind?.param).filter(Boolean));
    for (const n of g.knoten.filter((x) => x.art === 'regler')) assert.ok(gebunden.has(`k${n.nr}`), `k${n.nr} (${n.id}) has no control`);
  });
}

test('modulation amount at its off value greys the rate or decay behind it', () => {
  const fall = [
    ['bassmusik', 'rate', 'k2'], ['goa-blubber-lead', 'rate', 'k2'], ['sem-pad', 'rate', 'k4'],
    ['diode-acid-bass', 'decay', 'k3'], ['diode-goa-linie', 'decay', 'k3'], ['hartsync-bass', 'zdecay', 'k4'], ['hartsync-lead', 'sdecay', 'k4'],
  ];
  for (const [name, id, betrag] of fall) {
    const p = panel(name);
    assert.ok(ruhendeSteuerungen(p, { [betrag]: 0 })[id], `${name}: ${id} greyed at 0`);
    assert.equal(ruhendeSteuerungen(p, { [betrag]: 0.5 })[id], null, `${name}: ${id} heard at 0.5`);
  }
});

test('Saw Ladder: the filter envelope controls are greyed while Env amount sits in the middle', () => {
  const p = panel('saege-ladder');
  const r = ruhendeSteuerungen(p, { k3: 0.5 });
  assert.ok(r.fdecay && r.fsus);
  const an = ruhendeSteuerungen(p, { k3: 0.8 });
  assert.equal(an.fdecay, null);
  assert.equal(an.fsus, null);
});
