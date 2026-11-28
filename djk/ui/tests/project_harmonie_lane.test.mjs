// Strand 7 task 5.1: production harmony lane. Project field `harmonie`, command harmonie_setzen, playback head key `harmonie`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt, harmonieFehler, wiedergabeSicht } from '../project/model.ts';
import { normalisiere } from '../project/storage.ts';
import { uebersetze } from '../project/playback.ts';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { skalaMaske } from '../public/harmonie.js';
import path from 'node:path';
import { tmpOrdner } from './support/project.mjs';

const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund}`);
const opt = { nr: 1, audioOrdner: '/arbeit/arr/audio', frames: () => 24000 };
const LANE = [{ beat: 0, grundton: 9, skala: 'minor', akkord: 'Am' }, { beat: 8, grundton: 2, skala: 'minor' }];
const setze = (p, e) => fuehreAus(p, { befehl: 'harmonie_setzen', eintraege: e }).projekt;
function projekt() {
  let p = neuesProjekt('T');
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument', name: 'I' }).projekt;
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument', name: 'J' }).projekt;
  return p;
}
const mitStufe = (p, id, skala) => fuehreAus(p, { befehl: 'midi_stufe_setzen', spur_id: id, midi: { skala } }).projekt;

test('command sets the lane sorted by beat, null removes it, one undo step', (t) => {
  const p = projekt();
  const q = setze(p, [LANE[1], LANE[0]]);
  assert.deepEqual(q.harmonie, { eintraege: LANE });
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { zeitgeber: false });
  const a = aendere(v, p, [{ befehl: 'harmonie_setzen', eintraege: LANE }], { quelle: 'andreas', label: 'lane' });
  assert.deepEqual(a.projekt.harmonie.eintraege, LANE);
  assert.equal(rueckgaengig(v, a.projekt, { quelle: 'andreas' }).projekt.harmonie, undefined);
  assert.equal('harmonie' in setze(q, null), false);
});

test('command refusals name the field', () => {
  const p = projekt();
  const faelle = [
    [[], /not empty/], [[{ beat: 0, grundton: 0, skala: 'minor' }, { beat: 0, grundton: 2, skala: 'minor' }], /one entry per beat/],
    [[{ beat: -1, grundton: 0, skala: 'minor' }], /beat/], [[{ beat: 0, grundton: 12, skala: 'minor' }], /grundton/],
    [[{ beat: 0, grundton: 0, skala: 'nope' }], /skala/], [[{ beat: 0, grundton: 0, skala: 'minor', akkord: 'H' }], /akkord/],
    [[{ beat: 0, grundton: 0, skala: 'minor', x: 1 }], /\.x/], 'x',
    [Array.from({ length: 513 }, (_, i) => ({ beat: i, grundton: 0, skala: 'minor' })), /at most 512/],
  ];
  for (const f of faelle) {
    if (f === 'x') { lehntAb(p, { befehl: 'harmonie_setzen', eintraege: 'x' }, 'argument_ungueltig'); continue; }
    assert.throws(() => fuehreAus(p, { befehl: 'harmonie_setzen', eintraege: f[0] }), (e) => e instanceof BefehlFehler && e.grund === 'argument_ungueltig' && f[1].test(e.message), JSON.stringify(f[0]).slice(0, 60));
  }
  lehntAb(p, { befehl: 'harmonie_setzen', eintraege: LANE, y: 1 }, 'argument_unbekannt');
});

test('model: round trip through load and save; /1 refuses the field', () => {
  const q = setze(projekt(), LANE);
  const r = pruefeProjekt(JSON.parse(JSON.stringify(normalisiere(q))));
  assert.ok('projekt' in r, JSON.stringify(r));
  assert.deepEqual(r.projekt.harmonie, { eintraege: LANE });
  assert.equal(harmonieFehler({ eintraege: LANE }), null);
  assert.match(harmonieFehler({ eintraege: [] }), /not empty/);
  const alt = JSON.parse(JSON.stringify(normalisiere(q))); alt.format = 'cypherdj-projekt/1';
  assert.ok(!('projekt' in pruefeProjekt(alt)));
});

test('playback: no head key without a track that follows the project scale; no key at all without a lane', () => {
  const p = setze(projekt(), LANE);
  assert.equal(uebersetze(p, opt).harmonie, undefined, 'no stage');
  assert.equal(uebersetze(mitStufe(p, 's1', { grundton: 0, skala: 'minor' }), opt).harmonie, undefined, 'a fixed scale ignores the lane');
  const q = fuehreAus(mitStufe(projekt(), 's1', { quelle: 'projekt' }), { befehl: 'tonart_setzen', grundton: 7, skala: 'major' }).projekt;
  assert.equal(uebersetze(q, opt).harmonie, undefined, 'no lane');
  assert.deepEqual(uebersetze(q, opt).spuren[0].midi.skala, { maske: skalaMaske(7, 'major') }, 'without a lane the stage is as before');
});

test('playback: head [beat, mask] and lane flag on the tracks that follow the project; key before the first entry, C minor without one', () => {
  let p = setze(projekt(), LANE);
  p = mitStufe(p, 's1', { quelle: 'projekt' });
  const w = uebersetze(p, opt);
  assert.equal(w.format, 'cypherdj-arr/2');
  assert.deepEqual(w.harmonie, [[0, skalaMaske(9, 'minor')], [8, skalaMaske(2, 'minor')]]);
  assert.deepEqual(w.spuren[0].midi.skala, { maske: skalaMaske(0, 'minor'), lane: true }, 'C minor without a project key');
  assert.equal(w.spuren[1].midi, undefined);
  const k = fuehreAus(p, { befehl: 'tonart_setzen', grundton: 7, skala: 'major' }).projekt;
  assert.deepEqual(uebersetze(k, opt).spuren[0].midi.skala, { maske: skalaMaske(7, 'major'), lane: true });
});

test('playback view: a lane edit is a new playback only with a following track', () => {
  const alt = mitStufe(setze(projekt(), LANE), 's1', { quelle: 'projekt' });
  const neu = setze(alt, [LANE[0]]);
  assert.notDeepEqual(wiedergabeSicht(alt), wiedergabeSicht(neu));
  const ohne = setze(projekt(), LANE);
  assert.deepEqual(wiedergabeSicht(ohne), wiedergabeSicht(setze(ohne, [LANE[0]])));
  assert.equal(fuehreAus(alt, { befehl: 'harmonie_setzen', eintraege: [LANE[0]] }).betrifft_wiedergabe, true);
});
