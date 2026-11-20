// PRODUCTION side of linked clips and sections: unlink on right trim, chain sign, section borders on the ruler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kuerzeRechts, kuerzeLinks, verschiebe } from '../public/production/clips.js';
import { lineal_abschnitte, istVerknuepft, Arrangement } from '../public/production/arrangement.js';
import { neueAnsicht } from '../public/production/timeline.js';

const midi = (id, extra = {}) => ({ id, art: 'midi', name: id, start_beat: 0, laenge_beats: 4, noten: [], ...extra });

test('kuerzeRechts on a linked clip starts with clip_entknuepfen', () => {
  const b = kuerzeRechts(midi('c1', { verbund: 'v1' }), -1, 1);
  assert.deepEqual(b, [{ befehl: 'clip_entknuepfen', clip_id: 'c1' }, { befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 3 }]);
});
test('kuerzeRechts on an unlinked clip is unchanged, and a linked clip without change stays empty', () => {
  assert.deepEqual(kuerzeRechts(midi('c1'), -1, 1), [{ befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 3 }]);
  assert.deepEqual(kuerzeRechts(midi('c1', { verbund: 'v1' }), 0, 1), []);
});

test('lineal_abschnitte: borders of a marker with three sections, nothing without abschnitte', () => {
  const p = { tracker: { schema: 1, abschnitte: [{ id: 'a1', name: 'Intro', laenge_beats: 16 }, { id: 'a2', laenge_beats: 8 }, { id: 'a3', name: 'Drop', laenge_beats: 32 }] } };
  assert.deepEqual(lineal_abschnitte(p), [
    { id: 'a1', nr: 0, name: 'Intro', von_beat: 0, bis_beat: 16 },
    { id: 'a2', nr: 1, name: '', von_beat: 16, bis_beat: 24 },
    { id: 'a3', nr: 2, name: 'Drop', von_beat: 24, bis_beat: 56 },
  ]);
  assert.deepEqual(lineal_abschnitte({ tracker: { schema: 1 } }), []);
  assert.deepEqual(lineal_abschnitte({ spuren: [] }), []);
  assert.deepEqual(lineal_abschnitte(null), []);
});

test('istVerknuepft', () => {
  assert.ok(istVerknuepft(midi('c', { verbund: 'v2' })) === true);
  assert.ok(istVerknuepft(midi('c')) === false);
});

// drawing: a recording context shows the chain sign for a linked clip only, and the section names on the ruler
function aufnahme() {
  const log = [];
  const ctx = new Proxy({}, { get: (z, k) => (k in z ? z[k] : (...a) => { log.push([k, ...a]); }), set: (z, k, v) => { z[k] = v; return true; } });
  return { log, ctx };
}
function zeichne(projekt) {
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const mk = (w, h) => { const r = aufnahme(); return { r, c: { width: 0, height: 0, w, h, getContext: () => r.ctx, getBoundingClientRect: () => ({ width: w, height: h }) } }; };
  const [l, s, u] = [mk(800, 28), mk(800, 300), mk(800, 300)];
  const arr = new Arrangement({ lineal: l.c, spuren: s.c, ueber: u.c, wellen: { hole: () => ({}) } });
  arr.bild({ ansicht: neueAnsicht(), projekt, loop: null, kopfBeat: null, startBeat: 0, geist: null });
  return { lineal: l.r.log, spuren: s.r.log };
}
const basis = (clip, tracker) => ({ tempo_bpm: 120, taktart: [4, 4], spuren: [{ id: 's1', nr: 1, art: 'midi', farbe: '#2fd6c3', clips: [clip] }], ...(tracker ? { tracker } : {}) });

test('chain sign is drawn on a linked clip only', () => {
  const mit = zeichne(basis(midi('c1', { verbund: 'v1' })));
  const ohne = zeichne(basis(midi('c1')));
  const zeichen = (log) => log.filter((e) => e[0] === 'fillText' && e[1] === '⛓').length;
  assert.equal(zeichen(mit.spuren), 1);
  assert.equal(zeichen(ohne.spuren), 0);
});

test('ruler shows section names only with a marker that has abschnitte', () => {
  const t = { schema: 1, abschnitte: [{ id: 'a1', name: 'Intro', laenge_beats: 16 }, { id: 'a2', laenge_beats: 16 }] };
  const mit = zeichne(basis(midi('c1'), t)).lineal.filter((e) => e[0] === 'fillText').map((e) => e[1]);
  assert.ok(mit.includes('Intro'), 'named section');
  assert.ok(mit.includes('02'), 'unnamed section shows its number');
  const ohne = zeichne(basis(midi('c1'))).lineal.filter((e) => e[0] === 'fillText').map((e) => e[1]);
  assert.ok(!ohne.includes('Intro') && !ohne.includes('02'));
});

test('verschiebe of linked clips sends only start_beat (the server keeps the link); the left trim sends start_beat with the length', () => {
  const projekt = { spuren: [{ id: 's1', art: 'instrument', clips: [midi('c1', { verbund: 'v1' }), midi('c2', { verbund: 'v1', start_beat: 8 })] }] };
  assert.deepEqual(verschiebe(projekt, ['c1', 'c2'], 'c1', 1, 0, 1), [
    { befehl: 'clip_aendern', clip_id: 'c1', start_beat: 1 }, { befehl: 'clip_aendern', clip_id: 'c2', start_beat: 9 }]);
  const links = kuerzeLinks(midi('c2', { verbund: 'v1', start_beat: 8 }), 1, 1, 120);
  assert.deepEqual(links[0], { befehl: 'clip_aendern', clip_id: 'c2', start_beat: 9, laenge_beats: 3 });
});
