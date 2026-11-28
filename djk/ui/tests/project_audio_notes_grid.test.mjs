// Note editor slice 2, task T6: the command audio_noten_raster (quantise = move, snap to scale), one undo step, vibrato and drift untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { neuesProjekt } from '../project/model.ts';
import { naechsteStufe, naechsteLinie } from '../project/notes_grid.ts';
import { SHA_A, kopie, tmpOrdner } from './support/project.mjs';

const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund,
  `expected ${grund} for ${JSON.stringify(b).slice(0, 120)}`);
const clip = (p) => p.spuren.flatMap((s) => s.clips).find((c) => c.id === 'c1');
const note = (p, id) => clip(p).audio_noten.liste.find((n) => n.id === id);
const nahe = (x, y, tol = 1e-6) => assert.ok(Math.abs(x - y) <= tol, `${x} vs ${y}`);

// audio clip c1 at 120 bpm (beats 0..8, so 0.125 s = 1/16), notes `liste`
function aufbau(liste, extra = {}) {
  let p = neuesProjekt('N');
  p = fuehreListeAus(p, [
    { befehl: 'spur_neu', art: 'audio' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: SHA_A, pfad_hinweis: '/x/voice.wav' },
  ]).projekt;
  clip(p).audio_noten = kopie({ kurve: 'pyin-1.noten_hmm-1', liste });
  Object.assign(p, extra);
  return p;
}
const N = (id, qa, qe, qton, x = {}) => ({ id, qa, qe, qton, p: 0.9, ...x });

test('quantise 1/16 at 100 percent moves the start to the nearest line and keeps the length', () => {
  const p = aufbau([N('t1', 0.51, 0.9, 60), N('t2', 1.2, 1.7, 62)]);
  const r = fuehreAus(p, { befehl: 'audio_noten_raster', clip_id: 'c1', zeit: '1/16' }).projekt;
  nahe(note(r, 't1').a, 0.5); nahe(note(r, 't1').e, 0.89);
  nahe(note(r, 't2').a, 1.25); nahe(note(r, 't2').e, 1.75);
});

test('quantise at 50 percent goes half way', () => {
  const p = aufbau([N('t1', 0.6, 0.9, 60)]);
  const r = fuehreAus(p, { befehl: 'audio_noten_raster', clip_id: 'c1', zeit: '1/16', staerke: 0.5 }).projekt;
  nahe(note(r, 't1').a, 0.6125);   // line 0.625 s, half way from 0.6 s
});

test('a touching neighbour follows the moved start, a note with ids only moves those', () => {
  const p = aufbau([N('t1', 0.5, 0.91, 60), N('t2', 0.92, 1.5, 62)]);
  const r = fuehreAus(p, { befehl: 'audio_noten_raster', clip_id: 'c1', ids: ['t2'], zeit: '1/16' }).projekt;
  assert.equal(note(r, 't2').a, 0.875);   // 0.92 s -> line 0.875 s
  nahe(note(r, 't1').e, 0.875);   // the previous note touched (gap 10 ms) and follows
});

test('a note that would break a limit stays unchanged and the others are still done', () => {
  // 1/4 grid = 0.5 s: t1 (0.3..0.6) would move to 0.5 (end 0.8) and overlap t2 (0.75..1.3, gap 150 ms is no touch): t1 stays, t2 (0.75 s = beat 1.5, half up) moves to 1.0
  const p = aufbau([N('t1', 0.3, 0.6, 60), N('t2', 0.75, 1.3, 62)]);
  const r = fuehreAus(p, { befehl: 'audio_noten_raster', clip_id: 'c1', zeit: '1/4' }).projekt;
  assert.equal(note(r, 't1').a, undefined);
  assert.equal(note(r, 't1').e, undefined);
  nahe(note(r, 't2').a, 1.0);
  // the first note cannot leave the clip start: a note at 0.01 s moves to line 0 and stays valid; a = 0 is stored (qa 0.01)
  const q = aufbau([N('t1', 0.01, 0.3, 60)]);
  nahe(note(fuehreAus(q, { befehl: 'audio_noten_raster', clip_id: 'c1', zeit: '1/16' }).projekt, 't1').a, 0);
});

test('snap to C major: 61.4 -> 62, 60.6 -> 60, a pitch of the key stays, ties toward qton', () => {
  const p = aufbau([N('t1', 0.5, 1, 61.4), N('t2', 1, 1.5, 60.6), N('t3', 2, 2.5, 64), N('t4', 3, 3.5, 61, { ton: 61 })]);
  const r = fuehreAus(p, { befehl: 'audio_noten_raster', clip_id: 'c1', ton: 'tonart', tonart: { grundton: 0, skala: 'major' } }).projekt;
  assert.equal(note(r, 't1').ton, 62);
  assert.equal(note(r, 't2').ton, 60);
  assert.equal(note(r, 't3').ton, undefined);
  // 61 lies between 60 and 62 in C major: a tie, qton 61 is equally near both; the lower wins
  assert.equal(naechsteStufe(61, { grundton: 0, skala: 'major' }, 61), 60);
  // tie toward qton: float 61.0 with qton 62.4 -> 62
  assert.equal(naechsteStufe(61, { grundton: 0, skala: 'major' }, 62.4), 62);
});

test('snap uses the key argument, the project key, or the nearest semitone; no key at all is refused for tonart', () => {
  const p = aufbau([N('t1', 0.5, 1, 61.3)]);
  lehntAb(p, { befehl: 'audio_noten_raster', clip_id: 'c1', ton: 'tonart' }, 'argument_ungueltig');
  const a = fuehreAus(p, { befehl: 'audio_noten_raster', clip_id: 'c1', ton: 'tonart', tonart: { grundton: 9, skala: 'minor' } }).projekt;
  assert.equal(note(a, 't1').ton, 62);   // A minor: 60, 62 ... 61.3 is nearer 62
  const h = fuehreAus(p, { befehl: 'audio_noten_raster', clip_id: 'c1', ton: 'halbton' }).projekt;
  assert.equal(note(h, 't1').ton, 61);
  const mitKey = { ...p, tonart: { grundton: 0, skala: 'major' } };
  assert.equal(note(fuehreAus(mitKey, { befehl: 'audio_noten_raster', clip_id: 'c1', ton: 'tonart' }).projekt, 't1').ton, 62);
});

test('strength 0.5 gives half way, strength 0 changes nothing', () => {
  const p = aufbau([N('t1', 0.5, 1, 61.4)]);
  const h = fuehreAus(p, { befehl: 'audio_noten_raster', clip_id: 'c1', ton: 'tonart', staerke: 0.5, tonart: { grundton: 0, skala: 'major' } }).projekt;
  nahe(note(h, 't1').ton, 61.7);
  const z = fuehreAus(p, { befehl: 'audio_noten_raster', clip_id: 'c1', zeit: '1/16', ton: 'halbton', staerke: 0 }).projekt;
  assert.deepEqual(clip(z).audio_noten, clip(p).audio_noten);
});

test('only ton is written: vibrato and drift stay, a target that lands on qton is removed', () => {
  const p = aufbau([N('t1', 0.5, 1, 62.2, { vib: 1.5, drift: 0.5, ton: 62.4 }), N('t2', 1, 1.5, 60, { ton: 60.3 })]);
  const r = fuehreAus(p, { befehl: 'audio_noten_raster', clip_id: 'c1', ton: 'halbton' }).projekt;
  assert.deepEqual(note(r, 't1'), N('t1', 0.5, 1, 62.2, { vib: 1.5, drift: 0.5, ton: 62 }));
  assert.equal('ton' in note(r, 't2'), false);
});

test('bad arguments are refused, one undo step restores the list', (t) => {
  const p = aufbau([N('t1', 0.51, 1, 61.4)]);
  const b = (x) => ({ befehl: 'audio_noten_raster', clip_id: 'c1', ...x });
  lehntAb(p, b({}), 'argument_ungueltig');
  lehntAb(p, b({ zeit: 'bar' }), 'argument_ungueltig');
  lehntAb(p, b({ zeit: 'nope' }), 'argument_ungueltig');
  lehntAb(p, b({ ton: 'x' }), 'argument_ungueltig');
  lehntAb(p, b({ zeit: '1/16', staerke: 1.5 }), 'argument_ungueltig');
  lehntAb(p, b({ ton: 'halbton', tonart: { grundton: 0, skala: 'major' } }), 'argument_ungueltig');
  lehntAb(p, b({ ton: 'tonart', tonart: { grundton: 99, skala: 'major' } }), 'argument_ungueltig');
  lehntAb(p, b({ zeit: '1/16', ids: ['nix'] }), 'noten_unbekannt');
  lehntAb(p, b({ zeit: '1/16', foo: 1 }), 'argument_unbekannt');
  const v = new Verlauf(`${tmpOrdner(t)}/undo.jsonl`, { zeitgeber: false });
  const nach = aendere(v, p, [{ befehl: 'audio_noten_raster', clip_id: 'c1', zeit: '1/16', ton: 'halbton' }], { quelle: 'andreas', label: 'Raster' }).projekt;
  assert.notDeepEqual(clip(nach).audio_noten, clip(p).audio_noten);
  const z = rueckgaengig(v, nach, { quelle: 'andreas' }).projekt;
  assert.deepEqual(clip(z).audio_noten, clip(p).audio_noten);
});

test('strength 0 and notes already on the grid and the scale make no undo step', (t) => {
  const v = new Verlauf(`${tmpOrdner(t)}/undo.jsonl`, { zeitgeber: false });
  const meta = { quelle: 'andreas', label: 'Raster' };
  const p = aufbau([N('t1', 0.51, 1, 61.4), N('t2', 1.2, 1.7, 62.3, { ton: 62.7 })]);
  const w0 = aendere(v, p, [{ befehl: 'audio_noten_raster', clip_id: 'c1', zeit: '1/16', ton: 'halbton', staerke: 0 }], meta);
  assert.equal(w0.eintrag, null);
  assert.equal(w0.projekt, p);
  const fertig = aufbau([N('t1', 0.5, 1, 62), N('t2', 1.25, 1.7, 61.8, { ton: 64 })]);
  const w1 = aendere(v, fertig, [{ befehl: 'audio_noten_raster', clip_id: 'c1', zeit: '1/16', ton: 'tonart', tonart: { grundton: 0, skala: 'major' } }], meta);
  assert.equal(w1.eintrag, null);
  // a second quantise at a tempo whose grid lines are no round seconds (123 bpm), notes on the 256 / 48000 frame grid
  const fr = 256 / 48000;
  const q = aufbau([N('t1', 25 * fr, 90 * fr, 60), N('t2', 97 * fr, 160 * fr, 62), N('t3', 170 * fr, 230 * fr, 64)], { tempo_bpm: 123 });
  const b = [{ befehl: 'audio_noten_raster', clip_id: 'c1', zeit: '1/16' }];
  const erst = aendere(v, q, b, meta);
  assert.notEqual(erst.eintrag, null);
  const zweit = aendere(v, erst.projekt, b, meta);
  assert.equal(zweit.eintrag, null, JSON.stringify(zweit.eintrag?.vor));
});

test('without ids only notes in the audible range of an offset clip are taken; the grid follows the clip offset and start', () => {
  // offset 1 s: audible 1..5 s; t1 at 0.3 s is outside and stays, t2 at 1.26 s lies at beat 0.52 -> line 0.5 -> 1.25 s
  let p = aufbau([N('t1', 0.3, 0.6, 60), N('t2', 1.26, 1.7, 60)]);
  clip(p).offset_s = 1;
  const r = fuehreAus(p, { befehl: 'audio_noten_raster', clip_id: 'c1', zeit: '1/8' }).projekt;
  assert.equal(note(r, 't1').a, undefined);
  nahe(note(r, 't2').a, 1.25);
});

test('helpers: grid line rounds half up; the unwarped tie goes to the later line', () => {
  assert.equal(naechsteLinie(0.125, 0.25), 0.25);
  assert.equal(naechsteLinie(0.124, 0.25), 0);
  assert.equal(naechsteStufe(61.4, null, 61.4), 61);
});
