// PRODUCTION chord lane row: pure helpers (harmonie_line.js) and the DOM strip (harmonie_line_operation.js). Every command body is checked
// against harmonieFehler of the project model, the validator the command itself uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, El } from './helpers/pages_mock.mjs';
import { harmonieFehler } from '../project/model.ts';
import { harmonieAnzeige, harmonieText, harmonieHinzu, harmonieBewege, harmonieUmschreiben, harmonieLoesche, harmonieBefehl } from '../public/production/harmonie_line.js';
import { bindeHarmonie } from '../public/production/harmonie_line_operation.js';

const gueltig = (befehl) => {
  assert.equal(befehl.befehl, 'harmonie_setzen');
  if (befehl.eintraege !== null) assert.equal(harmonieFehler({ eintraege: befehl.eintraege }), null);
  return befehl;
};

test('text: a chord symbol gives chord and key, a key text gives a key, junk gives null', () => {
  assert.deepEqual(harmonieText('Am7'), { grundton: 9, skala: 'minor', akkord: 'Am7' });
  assert.deepEqual(harmonieText('A minor'), { grundton: 9, skala: 'minor' });
  assert.deepEqual(harmonieText('Bb dorian'), { grundton: 10, skala: 'dorian' });
  assert.deepEqual(harmonieText('c# harmonic minor'), null, 'lower case root is not a key');
  assert.deepEqual(harmonieText('D harmonic minor'), { grundton: 2, skala: 'harmonic_minor' });
  assert.equal(harmonieText('H7'), null);
  assert.equal(harmonieText('  '), null);
  assert.equal(harmonieText('C/E'), null, 'no slash chords');
  assert.equal(harmonieAnzeige({ beat: 0, grundton: 9, skala: 'minor', akkord: 'Am7' }), 'Am7');
  assert.equal(harmonieAnzeige({ beat: 0, grundton: 9, skala: 'minor' }), 'A minor');
});

test('add: sorted, one per beat, bad text and taken beat refused; the command body is valid', () => {
  let l = harmonieHinzu([], 8, 'F');
  l = harmonieHinzu(l, 0, 'Am7');
  l = harmonieHinzu(l, 4, 'G minor');
  assert.deepEqual(l.map((e) => e.beat), [0, 4, 8]);
  assert.deepEqual(l[0], { beat: 0, grundton: 9, skala: 'minor', akkord: 'Am7' });
  gueltig(harmonieBefehl(l));
  assert.equal(harmonieHinzu(l, 4, 'C'), null, 'beat taken');
  assert.equal(harmonieHinzu(l, 12, 'nonsense'), null);
  assert.equal(harmonieHinzu(l, -1, 'C'), null);
  assert.equal(harmonieHinzu(undefined, 0, 'C').length, 1);
});

test('move: re-sorted, a taken beat refused, the entry keeps its text', () => {
  const l = harmonieHinzu(harmonieHinzu(harmonieHinzu([], 0, 'Am7'), 4, 'Dm'), 8, 'G7');
  const m = harmonieBewege(l, 0, 6);
  assert.deepEqual(m.map((e) => [e.beat, e.akkord]), [[4, 'Dm'], [6, 'Am7'], [8, 'G7']]);
  gueltig(harmonieBefehl(m));
  assert.equal(harmonieBewege(l, 0, 8), null);
  assert.equal(harmonieBewege(l, 9, 1), null, 'no such entry');
});

test('rewrite and delete: the last delete sends null', () => {
  const l = harmonieHinzu([], 0, 'C');
  const u = harmonieUmschreiben(l, 0, 'E phrygian');
  assert.deepEqual(u, [{ beat: 0, grundton: 4, skala: 'phrygian' }]);
  gueltig(harmonieBefehl(u));
  assert.equal(harmonieUmschreiben(l, 0, 'xyz'), null);
  assert.equal(harmonieLoesche(l, 3), null);
  assert.deepEqual(harmonieBefehl(harmonieLoesche(l, 0)), { befehl: 'harmonie_setzen', eintraege: null });
  const zwei = harmonieHinzu(l, 4, 'F');
  assert.equal(gueltig(harmonieBefehl(harmonieLoesche(zwei, 0))).eintraege.length, 1);
});

function baue(harmonie) {
  installiere();
  const zeile = new El('div'), knopf = new El('button');
  const z = { aend: [], melde: [] };
  const ctx = {
    st: { projekt: { tempo_bpm: 120, taktart: [4, 4], ...(harmonie ? { harmonie: { eintraege: harmonie } } : {}) }, ansicht: { beat0: 0, pxProBeat: 10 }, raster: 'beat', sichtbar: true },
    $: (n) => ({ 'harmonie-zeile': zeile, 'harmonie-an': knopf })[n],
    melde: (t, f) => z.melde.push([t, f]),
    aendere: async (label, befehle) => { z.aend.push({ label, befehle }); return true; },
    breite: () => 800, beimBild: [], beimProjekt: [],
  };
  bindeHarmonie(ctx);
  const bild = () => { for (const f of ctx.beimProjekt) f(ctx.st.projekt, false); for (const f of ctx.beimBild) f(0); };
  bild();
  const bloecke = () => zeile.querySelectorAll('[data-p="harmonie-block"]');
  return { ctx, zeile, knopf, z, bild, bloecke };
}
const ev = (extra = {}) => ({ button: 0, pointerId: 1, clientX: 0, ...extra });
const L = [{ beat: 0, grundton: 9, skala: 'minor', akkord: 'Am7' }, { beat: 16, grundton: 2, skala: 'minor', akkord: 'Dm' }];

test('strip: blocks show text and sit at their beat; the row is hidden until the toggle is on', () => {
  const s = baue(L);
  assert.equal(s.zeile.hidden, true);
  s.knopf.click(); s.bild();
  assert.equal(s.zeile.hidden, false);
  assert.deepEqual(s.bloecke().map((b) => b.textContent), ['Am7', 'Dm']);
  assert.equal(s.bloecke()[1].style.left, '160px');
});

test('strip: double click adds one entry at the snapped beat; text field Enter sends ONE command', () => {
  const s = baue(L);
  s.knopf.click(); s.bild();
  s.zeile.dispatch('dblclick', { target: s.zeile, offsetX: 83 });   // 8.3 beats, grid beat -> 8
  const feld = s.zeile.querySelectorAll('input')[0];
  assert.ok(feld, 'a text field opens');
  feld.value = 'Fmaj7';
  feld.dispatch('keydown', { key: 'Enter' });
  assert.equal(s.z.aend.length, 1);
  const b = gueltig(s.z.aend[0].befehle[0]);
  assert.deepEqual(b.eintraege.map((e) => [e.beat, e.akkord]), [[0, 'Am7'], [8, 'Fmaj7'], [16, 'Dm']]);
});

test('strip: bad text keeps the field open and sends nothing; Escape sends nothing', () => {
  const s = baue(L);
  s.knopf.click(); s.bild();
  s.zeile.dispatch('dblclick', { target: s.zeile, offsetX: 83 });
  const feld = s.zeile.querySelectorAll('input')[0];
  feld.value = 'zzz';
  feld.dispatch('keydown', { key: 'Enter' });
  assert.equal(s.z.aend.length, 0);
  assert.equal(s.z.melde.length, 1);
  feld.dispatch('keydown', { key: 'Escape' });
  assert.equal(s.z.aend.length, 0);
  assert.equal(s.zeile.querySelectorAll('input').length, 0);
});

test('strip: drag moves with ONE command at release, Delete removes', () => {
  const s = baue(L);
  s.knopf.click(); s.bild();
  const b = s.bloecke()[1];
  b.dispatch('pointerdown', ev({ clientX: 100 }));
  b.dispatch('pointermove', ev({ clientX: 140 }));
  b.dispatch('pointermove', ev({ clientX: 180 }));
  assert.equal(s.z.aend.length, 0, 'display only while dragging');
  b.dispatch('pointerup', ev({ clientX: 180 }));
  assert.equal(s.z.aend.length, 1);
  assert.deepEqual(gueltig(s.z.aend[0].befehle[0]).eintraege.map((e) => e.beat), [0, 24]);
  b.dispatch('keydown', { key: 'Delete' });
  assert.equal(s.z.aend.length, 2);
  assert.deepEqual(gueltig(s.z.aend[1].befehle[0]).eintraege.map((e) => e.beat), [0]);
});

test('strip: the live container has no lane (double click does nothing)', () => {
  const s = baue(L);
  s.ctx.st.projekt.live = true;
  s.knopf.click(); s.bild();
  s.zeile.dispatch('dblclick', { target: s.zeile, offsetX: 83 });
  assert.equal(s.zeile.querySelectorAll('input').length, 0);
});
