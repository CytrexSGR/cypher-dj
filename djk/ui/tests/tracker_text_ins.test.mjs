// Tracker follow-up F3: the text form carries the INS column for the tracks whose device has a slot role (and only for them).
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { liesBereich, schreibeBereich, TrackerTextFehler } from '../project/tracker_text.ts';
import { trackerLesen } from '../areas/proj/tracker_routes.ts';
import { kopie } from './support/project.mjs';

const lauf = (p, b) => fuehreListeAus(kopie(p), b).projekt;
const BK = { art: 'intern', name: 'bk', graph: 'sampler-x', parameter: {} };
const KIT = { art: 'intern', name: 'kit', kit: 'k' };
const SLOT = () => ({ stufig: false, rollen: { slot: 3 } });
const GLATT = () => ({ stufig: false, rollen: {} });
const N = (beat, laenge, ton, extra = {}) => ({ beat, laenge, ton, vel: 100, ...extra });
function bau(noten) {
  let p = neuesProjekt('x');
  p = lauf(p, [{ befehl: 'spur_neu', art: 'instrument', name: 'S', geraet: BK }, { befehl: 'spur_neu', art: 'instrument', name: 'K', geraet: KIT }]);
  p = lauf(p, [{ befehl: 'clip_neu', spur_id: p.spuren[0].id, art: 'midi', start_beat: 0, laenge_beats: 4, noten }]);
  return p;
}
const lies = (p, gf) => liesBereich(p, { abschnitt_id: 'a1', von: 0, bis: 11 }, gf);
const wende = (p, r) => (r.befehle.length === 0 ? p : fuehreListeAus(kopie(p), r.befehle).projekt);
const fehler = (f) => { try { f(); } catch (e) { assert.ok(e instanceof TrackerTextFehler, String(e)); return e; } assert.fail('expected a TrackerTextFehler'); };
const setze = (text, nr, neu) => text.split('\n').map((z, i) => (i === nr ? neu : z)).join('\n');
const platz = (p) => p.spuren[0].clips[0].noten.map((n) => n.platz);

test('INS stands right after NOTE on a track with a slot role, nowhere else', () => {
  const p = bau([N(0, 1, 60, { platz: 5 }), N(1, 1, 62)]);
  const t = lies(p, SLOT);
  const z = t.split('\n');
  assert.match(z[2], /\| C-3 05 64 \.\.\. \.\. \. /);
  assert.match(z[6], /\| D-3 \.\. 64 /);
  assert.equal(lies(p, GLATT).includes('C-3 05'), false, 'no role: no INS column');
  assert.match(lies(p, GLATT).split('\n')[2], /\| C-3 64 \.\.\. \.\. \. /);
  assert.equal(lies(p), lies(p, GLATT), 'no device description: no INS column');
  assert.equal(trackerLesen(p, new URLSearchParams({ abschnitt: 'a1' }), SLOT).text.includes('C-3 05 64'), true);
});

test('reading and writing back unchanged gives no command', () => {
  const p = bau([N(0, 1, 60, { platz: 5 }), N(1, 1, 62), N(2, 1, 64, { platz: 32 })]);
  assert.equal(schreibeBereich(p, lies(p, SLOT), SLOT).befehle.length, 0);
});

test('INS is set, changed and cleared through the text', () => {
  let p = bau([N(0, 1, 60, { platz: 5 }), N(1, 1, 62)]);
  const t = lies(p, SLOT);
  p = wende(p, schreibeBereich(p, setze(setze(t, 2, t.split('\n')[2].replace('C-3 05', 'C-3 ..')), 6, t.split('\n')[6].replace('D-3 ..', 'D-3 12')), SLOT));
  assert.deepEqual(platz(p), [undefined, 12]);
  const r = schreibeBereich(p, lies(p, SLOT).replace('D-3 12', 'D-3 09'), SLOT);
  assert.equal(r.befehle.length, 1);
  assert.deepEqual(platz(wende(p, r)), [undefined, 9]);
});

test('a new note with INS is written with its slot', () => {
  let p = bau([N(0, 1, 60)]);
  const t = lies(p, SLOT).split('\n');
  p = wende(p, schreibeBereich(p, setze(lies(p, SLOT), 10, t[10].replace('... .. .. ... .. .', 'E-3 07 64 ... .. .')), SLOT));
  assert.deepEqual(platz(p).filter((x) => x !== undefined), [7]);
});

test('INS outside 01..32 and INS on a cell without a note are refused with the line', () => {
  const p = bau([N(0, 1, 60, { platz: 5 })]);
  const t = lies(p, SLOT);
  for (const bad of ['00', '33', '99', 'ab']) {
    const e = fehler(() => schreibeBereich(p, setze(t, 2, t.split('\n')[2].replace('C-3 05', `C-3 ${bad}`)), SLOT));
    assert.equal(e.zeile, 3, bad);
    assert.match(e.text, /INS/);
  }
  const leer = t.split('\n')[10];
  const e = fehler(() => schreibeBereich(p, setze(t, 10, leer.replace('... .. .. ... .. .', '... 04 .. ... .. .')), SLOT));
  assert.equal(e.zeile, 11);
  assert.match(e.text, /INS needs a note/);
  const aus = fehler(() => schreibeBereich(p, setze(t, 10, leer.replace('... .. .. ... .. .', '=== 04 .. ... .. .')), SLOT));
  assert.match(aus.text, /INS needs a note/);
});

test('a text with INS on a track without the role is refused (the column is not there)', () => {
  const p = bau([N(0, 1, 60)]);
  const t = lies(p, SLOT);
  fehler(() => schreibeBereich(p, t, GLATT));
});
