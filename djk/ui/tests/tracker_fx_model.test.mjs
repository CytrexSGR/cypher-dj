// Tracker task 12: effect commands stored in the clip (`MidiClip.fx`) and the command `fx_setzen`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeProjekt, pruefeFehler, FX_CODES } from '../project/model.ts';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { FAECHER_BEFEHLE, verbundPruefung } from '../project/verbund.ts';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { kopie, tmpOrdner } from './support/project.mjs';
import path from 'node:path';

const lauf = (p, ...b) => fuehreListeAus(kopie(p), b).projekt;
const grund = (p, ...b) => { try { fuehreListeAus(kopie(p), b); return null; } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); return e.grund; } };
const GERAET = { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} };
const clipNeu = (spur, start, laenge = 4, noten = [{ beat: 0, laenge: 1, ton: 60, vel: 100 }]) =>
  ({ befehl: 'clip_neu', spur_id: spur, art: 'midi', start_beat: start, laenge_beats: laenge, noten });
const clip = (p, id) => p.spuren.flatMap((s) => s.clips).find((c) => c.id === id);
const e = (beat, spalte, code, wert) => ({ beat, spalte, code, wert });
const weg = (beat, spalte) => ({ beat, spalte, code: null });
const fxSetzen = (clipId, ...eintraege) => ({ befehl: 'fx_setzen', clip_id: clipId, eintraege });

function basis() {
  let p = lauf(neuesProjekt('x'), { befehl: 'spur_neu', art: 'instrument', name: 'I', geraet: GERAET });
  p = lauf(p, { befehl: 'spur_neu', art: 'audio', name: 'A' });
  return lauf(p, clipNeu('s1', 0, 8));
}

test('FX_CODES', () => {
  assert.deepEqual([...FX_CODES], ['ARP', 'SLU', 'SLD', 'GLD', 'VIB', 'TRM', 'VSL', 'LVL', 'RTG', 'PAN', 'OFS', 'REV']);
});

test('fx_setzen stores sorted entries, replaces by (beat, column), removes with code null; never an empty list', () => {
  let p = basis();
  p = lauf(p, fxSetzen('c1', e(1, 1, 'VIB', 0x46), e(0.5, 0, 'ARP', 0x37), e(1, 0, 'SLU', 0x10)));
  assert.deepEqual(clip(p, 'c1').fx, [e(0.5, 0, 'ARP', 0x37), e(1, 0, 'SLU', 0x10), e(1, 1, 'VIB', 0x46)]);
  assert.equal(pruefeFehler(p), null);
  p = lauf(p, fxSetzen('c1', e(1, 0, 'SLD', 255), weg(0.5, 0), weg(3, 3)));   // replace, remove, remove something absent
  assert.deepEqual(clip(p, 'c1').fx, [e(1, 0, 'SLD', 255), e(1, 1, 'VIB', 0x46)]);
  p = lauf(p, fxSetzen('c1', weg(1, 0), e(2, 2, 'REV', 0), weg(1, 1)));
  assert.deepEqual(clip(p, 'c1').fx, [e(2, 2, 'REV', 0)]);
  p = lauf(p, fxSetzen('c1', weg(2, 2)));
  assert.ok(!('fx' in clip(p, 'c1')), 'the last entry removed: the field goes');
  // the page replaces a moved entry with a delete of the old beat first, then the new one
  p = lauf(p, fxSetzen('c1', e(0.5, 0, 'VIB', 1)));
  p = lauf(p, fxSetzen('c1', weg(0.5, 0), e(0.25, 0, 'VIB', 1)));
  assert.deepEqual(clip(p, 'c1').fx, [e(0.25, 0, 'VIB', 1)]);
  // a delete of an absent entry on a clip without fx writes nothing
  const q = lauf(basis(), fxSetzen('c1', weg(1, 1)));
  assert.ok(!('fx' in clip(q, 'c1')));
});

test('a project without fx stays byte for byte the same', () => {
  const p = basis();
  const q = lauf(lauf(p, fxSetzen('c1', e(1, 0, 'ARP', 1))), fxSetzen('c1', weg(1, 0)));
  assert.equal(JSON.stringify(q), JSON.stringify(p));
  assert.ok(!JSON.stringify(p).includes('"fx"'));
});

test('invalid lists are refused with fx_ungueltig and write nothing', () => {
  const p = lauf(basis(), fxSetzen('c1', e(1, 0, 'ARP', 1)));
  const schlecht = [
    [], [e(0, 4, 'ARP', 1)], [e(0, -1, 'ARP', 1)], [e(0, 1.5, 'ARP', 1)], [e(0, 0, 'XYZ', 1)], [e(0, 0, 'arp', 1)], [e(0, 0, 'ARP', 256)],
    [e(0, 0, 'ARP', -1)], [e(0, 0, 'ARP', 1.5)], [e(0, 0, 'ARP', '1')], [e(-0.5, 0, 'ARP', 1)], [e(8, 0, 'ARP', 1)], [e(9, 0, 'ARP', 1)],
    [e(NaN, 0, 'ARP', 1)], [e('1', 0, 'ARP', 1)], [{ beat: 0, spalte: 0, code: 'ARP' }], [{ beat: 0, spalte: 0, code: null, wert: 1 }],
    [{ ...e(0, 0, 'ARP', 1), extra: 1 }], [null], ['ARP'], [e(0, 0, 'ARP', 1), e(0, 0, 'PAN', 1)],   // the last one: two writes of one cell in one command
    Array.from({ length: 4097 }, (_, i) => e(i / 1024, 0, 'ARP', 1)),
  ];
  for (const l of schlecht) {
    // the duplicate cell case is allowed to be accepted or refused, but never to store two entries
    if (l.length === 2 && l[0].beat === 0 && l[1].beat === 0) {
      const q = lauf(p, fxSetzen('c1', ...l));
      assert.equal(q.spuren[0].clips[0].fx.filter((x) => x.beat === 0 && x.spalte === 0).length, 1);
      continue;
    }
    assert.equal(grund(p, { befehl: 'fx_setzen', clip_id: 'c1', eintraege: l }), 'fx_ungueltig', JSON.stringify(l).slice(0, 80));
  }
  assert.equal(grund(p, { befehl: 'fx_setzen', clip_id: 'c1' }), 'fx_ungueltig');
  assert.equal(grund(p, { befehl: 'fx_setzen', clip_id: 'c1', eintraege: 'x' }), 'fx_ungueltig');
  // a valid first entry in front of an invalid one: all or nothing
  assert.equal(grund(p, fxSetzen('c1', e(2, 0, 'ARP', 1), e(0, 0, 'NOPE', 1))), 'fx_ungueltig');
  assert.notEqual(grund(p, { befehl: 'fx_setzen', clip_id: 'c1', eintraege: [e(0, 0, 'ARP', 1)], x: 1 }), null, 'unknown argument');
  assert.equal(grund(p, fxSetzen('nope', e(0, 0, 'ARP', 1))), 'clip_unbekannt');
  assert.equal(grund(p, { befehl: 'fx_setzen', eintraege: [e(0, 0, 'ARP', 1)] }) !== null, true);
});

test('fx_setzen on an audio clip is refused; the model refuses fx on an audio clip', () => {
  const au = kopie(basis());
  au.spuren[1].clips.push({ id: 'c9', art: 'audio', name: 'x', start_beat: 0, laenge_beats: 1, quelle: { sha256: 'a'.repeat(64), pfad_hinweis: '' },
    dekodiert: 'nein', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 });
  assert.equal(pruefeFehler(au), null);
  assert.equal(grund(au, fxSetzen('c9', e(0, 0, 'ARP', 1))), 'clip_nicht_midi');
  au.spuren[1].clips[0].fx = [e(0, 0, 'ARP', 1)];
  assert.notEqual(pruefeFehler(au), null);
});

test('model check: valid and invalid stored lists', () => {
  const mit = (fx) => { const p = kopie(basis()); p.spuren[0].clips[0].fx = fx; return p; };
  assert.equal(pruefeFehler(mit([e(0, 0, 'ARP', 0), e(0, 3, 'REV', 255), e(7.5, 1, 'PAN', 128)])), null);
  for (const l of [[], [e(0, 0, 'ARP', 0), e(0, 0, 'PAN', 1)], [e(1, 0, 'ARP', 0), e(0, 0, 'PAN', 1)], [e(0, 1, 'ARP', 0), e(0, 0, 'PAN', 1)],
    [e(0, 4, 'ARP', 0)], [e(0, 0, 'XYZ', 0)], [e(0, 0, 'ARP', 256)], [e(-1, 0, 'ARP', 0)], [{ ...e(0, 0, 'ARP', 0), x: 1 }], 'x', null]) {
    assert.notEqual(pruefeFehler(mit(l)), null, JSON.stringify(l));
  }
  const alt = kopie(basis()); alt.format = 'cypherdj-projekt/1'; alt.spuren[0].clips[0].fx = [e(0, 0, 'ARP', 0)];
  assert.notEqual(pruefeFehler(alt), null, 'fx exists only from the /2 format on');
});

test('fan-out: fx_setzen on a member reaches every member in one undo step', (t) => {
  assert.ok(FAECHER_BEFEHLE.includes('fx_setzen'));
  let p = lauf(basis(), clipNeu('s1', 8, 8), clipNeu('s1', 16, 8));
  p = lauf(p, { befehl: 'clip_verknuepfen', clip_id: 'c2', mit: 'c1' }, { befehl: 'clip_verknuepfen', clip_id: 'c3', mit: 'c1' });
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => 1_000_000, zeitgeber: false });
  const r = fuehreListeAus(kopie(p), [fxSetzen('c3', e(1, 0, 'VIB', 0x40), e(2, 1, 'SLU', 5))]);
  const q = r.projekt;
  for (const id of ['c1', 'c2', 'c3']) assert.deepEqual(clip(q, id).fx, [e(1, 0, 'VIB', 0x40), e(2, 1, 'SLU', 5)], id);
  assert.equal(verbundPruefung(q), null);
  assert.equal(pruefeFehler(q), null);
  const w = aendere(v, kopie(p), [fxSetzen('c2', e(0, 2, 'PAN', 0))], { quelle: 'andreas', label: 'fx' });
  for (const id of ['c1', 'c2', 'c3']) assert.deepEqual(clip(w.projekt, id).fx, [e(0, 2, 'PAN', 0)], id);
  const u = rueckgaengig(v, w.projekt, { quelle: 'andreas' });
  for (const id of ['c1', 'c2', 'c3']) assert.ok(!('fx' in clip(u.projekt, id)), id);
  // an unlinked clip is untouched
  const lose = lauf(lauf(basis(), clipNeu('s1', 8, 8)), fxSetzen('c1', e(0, 0, 'ARP', 1)));
  assert.ok(!('fx' in clip(lose, 'c2')));
});

test('clip_verknuepfen copies the fx of the other clip', () => {
  let p = lauf(basis(), clipNeu('s1', 8, 8));
  p = lauf(p, fxSetzen('c1', e(1, 0, 'ARP', 1)));
  p = lauf(p, { befehl: 'clip_verknuepfen', clip_id: 'c2', mit: 'c1' });
  assert.deepEqual(clip(p, 'c2').fx, [e(1, 0, 'ARP', 1)]);
  assert.equal(verbundPruefung(p), null);
});

test('clip_teilen splits the entries like notes, relative to each part', () => {
  let p = lauf(basis(), fxSetzen('c1', e(0, 0, 'ARP', 1), e(2, 1, 'VIB', 2), e(2.5, 0, 'PAN', 3), e(5, 2, 'LVL', 4)));
  p = lauf(p, { befehl: 'clip_teilen', clip_id: 'c1', beat: 2.5 });
  const [a, b] = p.spuren[0].clips;
  assert.deepEqual(a.fx, [e(0, 0, 'ARP', 1), e(2, 1, 'VIB', 2)]);
  assert.deepEqual(b.fx, [e(0, 0, 'PAN', 3), e(2.5, 2, 'LVL', 4)]);
  assert.equal(pruefeFehler(p), null);
  // a part without entries carries no field
  let q = lauf(basis(), fxSetzen('c1', e(1, 0, 'ARP', 1)));
  q = lauf(q, { befehl: 'clip_teilen', clip_id: 'c1', beat: 4 });
  assert.deepEqual(q.spuren[0].clips[0].fx, [e(1, 0, 'ARP', 1)]);
  assert.ok(!('fx' in q.spuren[0].clips[1]));
});

test('clip_duplizieren and moving keep the entries (beats relative to the clip start)', () => {
  let p = lauf(basis(), fxSetzen('c1', e(1, 0, 'ARP', 1)));
  p = lauf(p, { befehl: 'clip_duplizieren', clip_id: 'c1', ziel_beat: 16 });
  assert.deepEqual(p.spuren[0].clips[1].fx, [e(1, 0, 'ARP', 1)]);
  p = lauf(p, { befehl: 'clip_aendern', clip_id: 'c1', start_beat: 32 });
  assert.deepEqual(clip(p, 'c1').fx, [e(1, 0, 'ARP', 1)]);
  assert.equal(pruefeFehler(p), null);
});

test('clips_verbinden keeps the entries of all clips at their absolute beats; a later clip wins on a clash', () => {
  let p = lauf(basis(), clipNeu('s1', 8, 8));
  p = lauf(p, fxSetzen('c1', e(0, 0, 'ARP', 1), e(7, 1, 'VIB', 2), e(7.5, 2, 'PAN', 5)), fxSetzen('c2', e(0, 0, 'SLU', 9), e(2, 0, 'GLD', 3)));
  p = lauf(p, { befehl: 'clips_verbinden', clip_ids: ['c2', 'c1'] });
  const c = p.spuren[0].clips[0];
  assert.equal(c.id, 'c1'); assert.equal(c.laenge_beats, 16);
  assert.deepEqual(c.fx, [e(0, 0, 'ARP', 1), e(7, 1, 'VIB', 2), e(7.5, 2, 'PAN', 5), e(8, 0, 'SLU', 9), e(10, 0, 'GLD', 3)]);
  assert.equal(pruefeFehler(p), null);
  // clash: the later clip wins
  let q = lauf(basis(), clipNeu('s1', 4, 8));
  q = lauf(q, fxSetzen('c1', e(5, 0, 'ARP', 1)), fxSetzen('c2', e(1, 0, 'SLU', 9)));
  q = lauf(q, { befehl: 'clips_verbinden', clip_ids: ['c1', 'c2'] });
  assert.deepEqual(q.spuren[0].clips[0].fx, [e(5, 0, 'SLU', 9)]);
  // an entry behind its own clip end is dropped; no entries at all: no field
  let r = lauf(basis(), clipNeu('s1', 8, 8));
  r = lauf(r, { befehl: 'clips_verbinden', clip_ids: ['c1', 'c2'] });
  assert.ok(!('fx' in r.spuren[0].clips[0]));
});

test('save and load round trip keeps fx; the field exists only in /2 projects', () => {
  const p = lauf(basis(), fxSetzen('c1', e(1, 0, 'ARP', 1)));
  const q = pruefeProjekt(JSON.parse(JSON.stringify(p))).projekt;
  assert.deepEqual(clip(q, 'c1').fx, [e(1, 0, 'ARP', 1)]);
});

test('arrangement: fxMarken lists one mark per row that carries commands, none without fx', async () => {
  const { fxMarken } = await import('../public/production/arrangement.js');
  const k = { x: 100, y: 0, w: 200, h: 40 };
  const c = { art: 'midi', laenge_beats: 4, fx: [e(0, 0, 'ARP', 1), e(0, 1, 'VIB', 1), e(1.5, 2, 'PAN', 1), e(9, 0, 'REV', 1)] };
  assert.deepEqual(fxMarken(c, k, 50), [100, 175]);
  assert.deepEqual(fxMarken({ art: 'midi', laenge_beats: 4, noten: [] }, k, 50), []);
  assert.deepEqual(fxMarken({ art: 'audio', laenge_beats: 4 }, k, 50), []);
});
