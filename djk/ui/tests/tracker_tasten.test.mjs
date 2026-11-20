// Tracker task 4: the key map (public/tracker/tasten.js), pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { taste, NOTEN_TASTEN } from '../public/tracker/tasten.js';

const e = (code, o = {}) => ({ code, key: o.key ?? '', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...o });
const NOTE = { unterspalte: 'note', zahlen: 'hex' };
const VOL = { unterspalte: 'vol', zahlen: 'hex' };

test('every note code maps to its semitone', () => {
  const erwartet = { KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
    KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22,
    KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28 };
  assert.deepEqual({ ...NOTEN_TASTEN }, erwartet);
  assert.equal(Object.keys(erwartet).length, 29);
  for (const [code, halbton] of Object.entries(erwartet)) {
    assert.deepEqual(taste(e(code), NOTE), { art: 'note', halbton, akkord: false }, code);
    assert.deepEqual(taste(e(code, { shiftKey: true }), NOTE), { art: 'note', halbton, akkord: true }, `${code} shift`);
  }
});

test('octave keys, note off, digits that are no notes', () => {
  assert.deepEqual(taste(e('BracketLeft'), NOTE), { art: 'oktave', d: -1 });
  assert.deepEqual(taste(e('BracketRight'), NOTE), { art: 'oktave', d: 1 });
  assert.deepEqual(taste(e('BracketRight'), VOL), { art: 'oktave', d: 1 });
  assert.deepEqual(taste(e('KeyA'), NOTE), { art: 'aus' });
  for (const c of ['Digit1', 'Digit4', 'Digit8', 'KeyF', 'KeyK', 'Numpad5', 'Minus']) assert.equal(taste(e(c), NOTE), null, c);
});

test('digits per column and number base', () => {
  for (let i = 0; i <= 9; i++) {
    for (const u of ['vol', 'dly', 'chn', 'rpt']) assert.deepEqual(taste(e(`Digit${i}`), { unterspalte: u, zahlen: 'hex' }), { art: 'ziffer', wert: i }, `${u} ${i}`);
    assert.deepEqual(taste(e(`Numpad${i}`), VOL), { art: 'ziffer', wert: i });
  }
  'ABCDEF'.split('').forEach((l, i) => assert.deepEqual(taste(e(`Key${l}`), VOL), { art: 'ziffer', wert: 10 + i }, l));
  for (const l of 'ABCDEF') assert.equal(taste(e(`Key${l}`), { unterspalte: 'vol', zahlen: 'dec' }), null);
  for (const u of ['dly', 'chn', 'rpt']) assert.equal(taste(e('KeyB'), { unterspalte: u, zahlen: 'hex' }), null, `${u} is never hex`);
  assert.equal(taste(e('KeyG'), VOL), null);
  assert.deepEqual(taste(e('Minus'), { unterspalte: 'dly', zahlen: 'hex' }), { art: 'vorzeichen' });
  assert.equal(taste(e('Minus'), VOL), null);
});

test('effect cell: letters in the command half, hex digits in the value half', () => {
  assert.deepEqual(taste(e('KeyK', { key: 'k' }), { unterspalte: 'fx', zahlen: 'hex' }), { art: 'buchstabe', zeichen: 'K' });
  assert.deepEqual(taste(e('KeyK', { key: 'K', shiftKey: true }), { unterspalte: 'fx', zahlen: 'hex' }), { art: 'buchstabe', zeichen: 'K' });
  assert.deepEqual(taste(e('Digit7'), { unterspalte: 'fx', zahlen: 'hex' }), { art: 'ziffer', wert: 7 });
  assert.deepEqual(taste(e('KeyC'), { unterspalte: 'fx', zahlen: 'hex', fxteil: 'wert' }), { art: 'ziffer', wert: 12 });
  assert.equal(taste(e('KeyC'), { unterspalte: 'fx', zahlen: 'dec', fxteil: 'wert' }), null);
  assert.equal(taste(e('KeyK'), { unterspalte: 'fx', zahlen: 'hex', fxteil: 'wert' }), null);
});

test('navigation, editing and transport keys', () => {
  assert.deepEqual(taste(e('ArrowUp'), NOTE), { art: 'cursor', dz: -1, ds: 0 });
  assert.deepEqual(taste(e('ArrowDown'), NOTE), { art: 'cursor', dz: 1, ds: 0 });
  assert.deepEqual(taste(e('ArrowLeft'), VOL), { art: 'cursor', dz: 0, ds: -1 });
  assert.deepEqual(taste(e('ArrowRight'), VOL), { art: 'cursor', dz: 0, ds: 1 });
  assert.deepEqual(taste(e('ArrowDown', { shiftKey: true }), NOTE), { art: 'auswahl', dz: 1, ds: 0 });
  assert.deepEqual(taste(e('ArrowLeft', { shiftKey: true }), NOTE), { art: 'auswahl', dz: 0, ds: -1 });
  assert.deepEqual(taste(e('Tab'), NOTE), { art: 'spur', d: 1 });
  assert.deepEqual(taste(e('Tab', { shiftKey: true }), NOTE), { art: 'spur', d: -1 });
  assert.deepEqual(taste(e('PageUp'), NOTE), { art: 'seite', d: -1 });
  assert.deepEqual(taste(e('PageDown'), NOTE), { art: 'seite', d: 1 });
  assert.deepEqual(taste(e('Home'), NOTE), { art: 'anfang' });
  assert.deepEqual(taste(e('End'), NOTE), { art: 'ende' });
  assert.deepEqual(taste(e('Delete'), NOTE), { art: 'leeren' });
  assert.deepEqual(taste(e('Backspace'), NOTE), { art: 'rueck' });
  assert.deepEqual(taste(e('Insert'), NOTE), { art: 'einfuegen' });
  assert.deepEqual(taste(e('Space'), NOTE), { art: 'spielen' });
  assert.deepEqual(taste(e('Space', { shiftKey: true }), NOTE), { art: 'schleife' });
  assert.deepEqual(taste(e('Enter'), NOTE), { art: 'ab_zeile' });
  assert.deepEqual(taste(e('Escape'), NOTE), { art: 'escape' });
  assert.deepEqual(taste(e('ArrowUp', { altKey: true }), NOTE), { art: 'schritt', d: 1 });
  assert.deepEqual(taste(e('ArrowDown', { altKey: true }), NOTE), { art: 'schritt', d: -1 });
});

test('Ctrl combinations', () => {
  const c = (code, o = {}) => taste(e(code, { ctrlKey: true, ...o }), NOTE);
  assert.deepEqual(c('KeyA'), { art: 'alles' });
  assert.deepEqual(c('KeyC'), { art: 'kopieren' });
  assert.deepEqual(c('KeyX'), { art: 'ausschneiden' });
  assert.deepEqual(c('KeyV'), { art: 'einsetzen' });
  assert.deepEqual(c('KeyD'), { art: 'duplizieren' });
  assert.deepEqual(c('KeyI'), { art: 'interpolieren' });
  assert.deepEqual(c('KeyZ'), { art: 'undo' });
  assert.deepEqual(c('KeyZ', { shiftKey: true }), { art: 'redo' });
  assert.deepEqual(c('KeyY'), { art: 'redo' });
  assert.deepEqual(c('ArrowUp'), { art: 'transponieren', d: 1 });
  assert.deepEqual(c('ArrowDown'), { art: 'transponieren', d: -1 });
  assert.deepEqual(c('ArrowUp', { shiftKey: true }), { art: 'transponieren', d: 12 });
  assert.deepEqual(c('ArrowDown', { shiftKey: true }), { art: 'transponieren', d: -12 });
  for (const code of ['Digit1', 'Digit5', 'Digit0', 'KeyQ', 'KeyW', 'Space']) assert.equal(c(code), null, code);
  assert.equal(taste(e('KeyC', { ctrlKey: true, altKey: true }), NOTE), null, 'AltGr');
  assert.equal(taste(e('KeyZ', { metaKey: true }), NOTE), null);
});

test('function keys and Alt+note keys give null', () => {
  for (let i = 1; i <= 12; i++) assert.equal(taste(e(`F${i}`), NOTE), null, `F${i}`);
  assert.equal(taste(e('F5', { ctrlKey: true }), NOTE), null);
  assert.equal(taste(e('KeyZ', { altKey: true }), NOTE), null);
  assert.equal(taste(e('Digit3', { altKey: true }), VOL), null);
  assert.equal(taste({}, NOTE), null);
});
