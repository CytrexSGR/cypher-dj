// DJ view places, task 15: the mixer follows the places. The strips keep their nodes and core lines; slots.js decides which strip sits where.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZIELE } from '../public/curves.js';
import { mixerPlan, wendeMixerAn, ZUEGE, LAYOUT_STANDARD } from '../public/slots.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (n) => fs.readFileSync(path.join(PUBLIC, n), 'utf8');
const app = lies('app.js'), html = lies('index.html'), css = lies('style.css'), plaetze = lies('slots.js');

const LAYOUTE = {
  standard: [...LAYOUT_STANDARD],
  'track track track loops': ['track', 'track', 'track', 'loops'],
  'loops track strudel track': ['loops', 'track', 'strudel', 'track'],
};
const vorlage = html.slice(html.indexOf('<template id="zug-vorlage">'), html.indexOf('</template>', html.indexOf('<template id="zug-vorlage">')));
const TEILE = [...vorlage.matchAll(/data-teil="([^"]+)"/g)].map((m) => m[1]);
const praefixe = (s) => (s.art === 'erz' ? s.kanaele : [s.kanal]);

test('the strip template carries fader, trim, EQ, filter, PFL and the crossfader side', () => {
  for (const t of ['fader', 'trim', 'eq/hoch', 'eq/mitte', 'eq/tief', 'filter', 'pfl', 'xseite']) assert.ok(TEILE.includes(t), t);
});

for (const [name, layout] of Object.entries(LAYOUTE)) {
  test(`layout "${name}": the strips appear in place order with the right target prefix and every control maps to a core line`, () => {
    const plan = mixerPlan(layout);
    const gesehen = plan.reihen.flat().filter(Boolean);
    // place order: row 1 holds the strips of places 1 and 2, row 2 of places 3 and 4, left place left
    const plaetze_ = gesehen.map((s) => s.platz);
    assert.deepEqual(plaetze_, [...plaetze_].sort((a, b) => a - b), 'strips in place order');
    for (const s of gesehen) {
      const erwartet = layout[s.platz - 1];
      assert.equal(s.art === 'deck' ? 'track' : s.art === 'erz' ? 'strudel' : 'loops', erwartet);
      if (s.art === 'deck') assert.equal(s.kanal, `deck/${s.platz}`, 'a Track place N shows the strip of deck N');
      for (const k of praefixe(s)) for (const t of TEILE) assert.ok(ZIELE.has(`${k}/${t}`), `${k}/${t} is a control target`);
    }
    assert.ok(gesehen.every((s) => s.art !== 'pad' || /^pad\/[12]$/.test(s.kanal)));
    assert.ok(plan.reihen.every((r) => r.length === 3 && r.filter(Boolean).length <= 3));
  });
}

test('every strip of the page is reachable by the plan and a hidden strip is only hidden: no state is written', () => {
  assert.deepEqual(ZUEGE, ['zug/deck/1', 'zug/deck/2', 'zug/deck/3', 'zug/deck/4', 'zug/erz', 'zug/pad/1', 'zug/pad/2']);
  const f = plaetze.slice(plaetze.indexOf('export function wendeMixerAn'));
  assert.doesNotMatch(f, /regler|fetch|zustand|xseite|localStorage/);
  const z = Object.fromEntries(ZUEGE.map((k) => [k, { dataset: {}, hidden: false, classList: { add() {}, remove() {} } }]));
  const vorher = { ...z };
  wendeMixerAn(LAYOUTE['loops track strudel track'], (k) => z[k]);
  for (const k of ZUEGE) assert.equal(z[k], vorher[k]);
});

test('the page applies the plan to the existing strips, deck strips by data-deck, loop strips by data-boxzug, Strudel by its strip place', () => {
  assert.match(app, /wendeMixerAn\(plaetzeLayout, zugKnoten\)/);
  const k = app.slice(app.indexOf('function zugKnoten('), app.indexOf('function wendePlaetzeAn('));
  assert.match(k, /\$\('\.zugplatz'\)/); assert.match(k, /\.zug\[data-deck=/); assert.match(k, /\.zug\[data-boxzug=/);
  assert.doesNotMatch(k, /innerHTML|cloneNode|createElement/);
});

test('the DJ view lets the strips take cells of the page grid, the master and crossfader sit in a row of their own, the Studio view is untouched', () => {
  assert.match(css, /body:not\(\.studio\) #mischer, body:not\(\.studio\) #mischer-unten \{ display: contents; \}/);
  assert.match(css, /"p3 ms ms ms p4" "p3 xf xf xf p4"/);
  assert.match(css, /\[data-mix-zeile="1"\] \{ grid-row: 1 \/ 3; \}/);
  assert.match(css, /\.mitte \{ grid-area: ms;/);
  assert.match(css, /\.xfader \{ grid-area: xf;/);
  assert.match(css, /body\.studio #pult \{[^}]*"c c mo" "mu d mo"/);
  assert.match(css, /body\.studio #mischer-unten \{ grid-template-columns: repeat\(5, var\(--zug\)\)/);
});
