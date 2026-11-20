// Tracker stage 2, fix round F2: the raw time commands adjust a stored section list, and the recording punch range ripples like the loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeFehler } from '../project/model.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { grundText } from '../http/reasons.ts';
import { kopie } from './support/project.mjs';

const lauf = (p, ...b) => fuehreListeAus(kopie(p), b).projekt;
const fehler = (p, ...b) => {
  const vor = JSON.stringify(p);
  try { fuehreListeAus(kopie(p), b); } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); assert.equal(JSON.stringify(p), vor); return e; }
  return assert.fail('expected a refusal');
};
const GERAET = { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} };
const NOTE = { beat: 3, laenge: 0.5, ton: 72, vel: 80 };
const midi = (start, laenge = 16) => ({ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: start, laenge_beats: laenge, noten: [NOTE] });
const liste = (p) => p.tracker.abschnitte.map((a) => a.laenge_beats);
const MITTE = [{ befehl: 'clip_loeschen', clip_id: 'c1' }, { befehl: 'clip_loeschen', clip_id: 'c2' }];
const starts = (p) => p.spuren[0].clips.map((c) => c.start_beat);

// clips c1 at 0..16 and c2 at 32..48; a stored list of three sections of 16 beats (the default list, written by the first section command)
function mitListe(extra = []) {
  let p = lauf(neuesProjekt('x'), { befehl: 'spur_neu', art: 'instrument', name: 'Lead', geraet: GERAET });
  p = lauf(p, midi(0), midi(32));
  return lauf(p, { befehl: 'abschnitt_umbenennen', id: 'a1', name: 'A' }, ...extra);
}

test('without a stored list the raw time commands stay as they were (no marker is created)', () => {
  let p = lauf(neuesProjekt('x'), { befehl: 'spur_neu', art: 'instrument', name: 'Lead', geraet: GERAET });
  p = lauf(p, midi(0), midi(16));
  const q = lauf(p, { befehl: 'zeit_einfuegen', beat: 16, beats: 4 });
  assert.equal(q.tracker, undefined);
  assert.deepEqual(starts(q), [0, 20]);
});

test('zeit_einfuegen with a stored list: the section that holds the beat grows, a beat at a border belongs to the later section', () => {
  const p = mitListe(MITTE);
  assert.deepEqual(liste(p), [16, 16, 16]);
  const q = lauf(p, { befehl: 'zeit_einfuegen', beat: 4, beats: 2 });
  assert.deepEqual(liste(q), [18, ...liste(p).slice(1)]);
  const r = lauf(p, { befehl: 'zeit_einfuegen', beat: 16, beats: 2 });
  assert.deepEqual(liste(r), [16, 18, ...liste(p).slice(2)]);
  assert.equal(pruefeFehler(q), null);
});

test('zeit_einfuegen at or behind the end of the list grows the last section', () => {
  const p = mitListe(MITTE);
  const ende = liste(p).reduce((a, b) => a + b, 0);
  for (const beat of [ende, ende + 8]) {
    const q = lauf(p, { befehl: 'zeit_einfuegen', beat, beats: 4 });
    assert.deepEqual(liste(q), [...liste(p).slice(0, -1), liste(p).at(-1) + 4], `beat ${beat}`);
  }
});

test('zeit_entfernen with a stored list: the section that holds the range shrinks', () => {
  const p = mitListe(MITTE);
  const q = lauf(p, { befehl: 'zeit_entfernen', beat: 4, beats: 4 });
  assert.deepEqual(liste(q), [12, ...liste(p).slice(1)]);
  assert.equal(pruefeFehler(q), null);
});

test('zeit_entfernen: a range over a section border, or one that covers a whole section, is refused with zeit_abschnitt', () => {
  const p = mitListe(MITTE);
  const e = fehler(p, { befehl: 'zeit_entfernen', beat: 12, beats: 8 });
  assert.equal(e.grund, 'zeit_abschnitt');
  assert.match(grundText(e.grund), /the range crosses a section border: use the section commands/);
  const g = fehler(p, { befehl: 'zeit_entfernen', beat: 0, beats: 16 });
  assert.equal(g.grund, 'zeit_abschnitt');
  assert.match(`${g.detail}`, /the range covers a whole section: delete the section instead/);
  assert.match(`${e.detail}`, /the range crosses a section border: use the section commands/);
});

test('the section commands do not adjust twice (abschnitt_neu, _loeschen, _laenge, _duplizieren still give the lengths they gave)', () => {
  const p = mitListe();
  const n = lauf(p, { befehl: 'abschnitt_neu', nach: 'a1', zeilen: 32 });
  assert.deepEqual(liste(n), [16, 8, 16, 16]);
  const l = lauf(p, { befehl: 'abschnitt_laenge', id: 'a1', zeilen: 96 });
  assert.deepEqual(liste(l), [24, 16, 16]);
  const k = lauf(p, { befehl: 'abschnitt_laenge', id: 'a1', zeilen: 32 });
  assert.deepEqual(liste(k), [8, 16, 16]);
  const d = lauf(p, { befehl: 'abschnitt_duplizieren', id: 'a1', als: 'kopie' });
  assert.deepEqual(liste(d), [16, 16, 16, 16]);
  const w = lauf(p, { befehl: 'abschnitt_loeschen', id: 'a2' });
  assert.deepEqual(liste(w), [16, 16]);
});

test('aufnahme.punch moves with the ripple like the loop; without aufnahme nothing is created', () => {
  let p = lauf(neuesProjekt('x'), { befehl: 'spur_neu', art: 'instrument', name: 'Lead', geraet: GERAET });
  p = lauf(p, midi(0), midi(32));
  assert.equal(lauf(p, { befehl: 'zeit_einfuegen', beat: 16, beats: 4 }).aufnahme, undefined);
  p = lauf(p, { befehl: 'aufnahme_setzen', punch: { ein: true, von_beat: 20, bis_beat: 28 } });
  let q = lauf(p, { befehl: 'zeit_einfuegen', beat: 16, beats: 4 });
  assert.deepEqual([q.aufnahme.punch.von_beat, q.aufnahme.punch.bis_beat], [24, 32]);
  q = lauf(p, { befehl: 'zeit_einfuegen', beat: 24, beats: 4 });      // inside: the end moves
  assert.deepEqual([q.aufnahme.punch.von_beat, q.aufnahme.punch.bis_beat], [20, 32]);
  q = lauf(p, { befehl: 'zeit_einfuegen', beat: 28, beats: 4 });      // at the end: stays
  assert.deepEqual([q.aufnahme.punch.von_beat, q.aufnahme.punch.bis_beat], [20, 28]);
  q = lauf(p, { befehl: 'zeit_entfernen', beat: 16, beats: 4 });      // before: both move earlier
  assert.deepEqual([q.aufnahme.punch.von_beat, q.aufnahme.punch.bis_beat], [16, 24]);
  q = lauf(p, { befehl: 'zeit_entfernen', beat: 24, beats: 8 });      // the end lay inside: it goes to the beat
  assert.deepEqual([q.aufnahme.punch.von_beat, q.aufnahme.punch.bis_beat], [20, 24]);
  assert.equal(q.aufnahme.punch.ein, true);
  q = lauf(p, { befehl: 'zeit_entfernen', beat: 18, beats: 14 });     // the whole range lay inside: no place any more, switched off, a valid range
  assert.deepEqual([q.aufnahme.punch.ein, q.aufnahme.punch.aus, q.aufnahme.punch.von_beat, q.aufnahme.punch.bis_beat], [false, false, 18, 19]);
  assert.equal(pruefeFehler(q), null);
});
