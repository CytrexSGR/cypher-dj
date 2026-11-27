// NOTEN (note editor, N16): drawing of the host-neutral surface (public/noten/zeichnen.js) into a 2d context stand-in that records its calls.
// What the pixels look like is for the browser check; here: which shapes are drawn, in which order, and that no input combination throws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { zeichne } from '../public/noten/zeichnen.js';
import { notenKasten, neueAnsicht, TASTEN_BREITE } from '../public/noten/view.js';

const note = (id, qa, qe, qton, extra = {}) => ({ id, qa, qe, qton, p: 0.9, ...extra });
const aufnahme = () => {
  const rufe = [];
  const g = new Proxy({}, { get: (_, n) => (n === 'measureText' ? () => ({ width: 5 }) : (...a) => { rufe.push([n, ...a]); }), set: (_, n, v) => { rufe.push(['set:' + n, v]); return true; } });
  return { g, rufe };
};
const sichtMit = (extra = {}) => ({
  quelleS: 4, hoerbarS: [0, 4], noten: [note('t1', 0.5, 1, 60), note('t2', 1, 1.5, 62, { ton: 64 }), note('t3', 2, 3, 65)], kurve: null, welle: null, raster: null, rasteTonart: null,
  render: { zustand: 'quelle' }, analyse: null, ...extra,
});
const ui = (extra = {}) => ({ auswahl: [], zug: null, breite: 440, hoehe: 180, ...extra });
const gleich = (r, k) => r[0] === 'fillRect' && r[1] === k.x && r[2] === k.y && r[3] === k.w && r[4] === k.h;

test('one bar per note at notenKasten; a faint outline only for edited notes', () => {
  const sicht = sichtMit(), a = neueAnsicht(sicht, 440, 180), { g, rufe } = aufnahme();
  zeichne(g, a, sicht, ui());
  for (const n of sicht.noten) assert.equal(rufe.filter((r) => gleich(r, notenKasten(a, n))).length, 1, `bar of ${n.id}`);
  const umrisse = rufe.filter((r) => r[0] === 'strokeRect');
  assert.equal(umrisse.length, 1, 'only t2 is edited');
  const k = notenKasten(a, { ...sicht.noten[1], ton: undefined });
  assert.deepEqual(umrisse[0].slice(1), [k.x + 0.5, k.y + 0.5, k.w - 1, k.h - 1], 'the outline sits at the detected pitch');
  // selection adds a frame per selected note, nothing else changes
  const s = aufnahme();
  zeichne(s.g, a, sicht, ui({ auswahl: ['t1', 't3'] }));
  assert.equal(s.rufe.filter((r) => r[0] === 'strokeRect').length, 3);
});

test('the drag preview draws the moved bar of every dragged note', () => {
  const sicht = sichtMit(), a = neueAnsicht(sicht, 440, 180), { g, rufe } = aufnahme();
  zeichne(g, a, sicht, ui({ zug: { ids: ['t1', 't3'], um: 2 } }));
  for (const id of ['t1', 't3']) {
    const n = sicht.noten.find((x) => x.id === id), k = notenKasten(a, { ...n, ton: n.qton + 2 });
    assert.equal(rufe.filter((r) => gleich(r, k)).length, 1, `preview of ${id}`);
  }
  const ohne = aufnahme();
  zeichne(ohne.g, a, sicht, ui({ zug: { ids: ['t1'], um: 0 } }));
  assert.equal(ohne.rufe.filter((r) => gleich(r, notenKasten(a, { ...sicht.noten[0], ton: 60 }))).length, 1, 'no preview for um 0: only the bar itself');
});

test('the key column is drawn last and names every C', () => {
  const sicht = sichtMit(), a = neueAnsicht(sicht, 440, 180), { g, rufe } = aufnahme();
  zeichne(g, a, sicht, ui());
  const texte = rufe.filter((r) => r[0] === 'fillText').map((r) => r[1]);
  assert.ok(texte.length >= 1 && texte.every((t) => /^C-?\d+$/.test(t) || /^[A-G]#?-?\d+ \d+\.\d\d$/.test(t)), JSON.stringify(texte));
  assert.ok(texte.includes('C3'));
  const letzteNote = rufe.map((r, i) => (gleich(r, notenKasten(a, sicht.noten[2])) ? i : -1)).filter((i) => i >= 0).pop();
  const ersteTaste = rufe.findIndex((r) => r[0] === 'fillRect' && r[1] === 0 && r[3] === TASTEN_BREITE - 1);
  assert.ok(ersteTaste > letzteNote, 'the key column covers whatever reaches into it');
  assert.ok(rufe.some((r) => r[0] === 'clip'), 'the note area is clipped');
});

test('the audible range is shaded outside, the waveform and the pitch line are drawn when given', () => {
  const hole = [];
  const sicht = sichtMit({
    hoerbarS: [1, 3], welle: { hole: (s0, s1, n) => { hole.push([s0, s1, n]); return Array.from({ length: n }, () => [-0.5, 0.5]); } },
    kurve: { hopS: 0.01, ct: new Float64Array(400).fill(6000) },
  });
  const a = neueAnsicht(sicht, 440, 180), { g, rufe } = aufnahme();
  zeichne(g, a, sicht, ui());
  assert.equal(hole.length, 1);
  assert.deepEqual([hole[0][0], hole[0][1], hole[0][2]], [0, 4, 400], 'one column per pixel over the source');
  const schatten = rufe.filter((r) => r[0] === 'fillRect' && r[2] === 0 && r[4] === 180 && r[1] >= TASTEN_BREITE);
  assert.ok(schatten.length >= 2, 'a shade left and right of the audible range');
  assert.ok(rufe.filter((r) => r[0] === 'lineTo').length > 10, 'the pitch line has points');
});

test('no throw with kurve, welle, raster and rasteTonart null and with an empty note list', () => {
  const { g } = aufnahme();
  for (const noten of [[], sichtMit().noten]) {
    const sicht = sichtMit({ noten });
    assert.doesNotThrow(() => zeichne(g, neueAnsicht(sicht, 440, 180), sicht, ui()));
  }
  const klein = sichtMit({ quelleS: 0, hoerbarS: [0, 0], noten: [] });
  assert.doesNotThrow(() => zeichne(g, neueAnsicht(klein, 100, 20), klein, ui({ breite: 100, hoehe: 20 })));
  assert.doesNotThrow(() => zeichne(g, { s0: 0, pxProS: 100, tonOben: 127 }, sichtMit(), ui({ breite: 30, hoehe: 10 })), 'narrower than the key column');
  assert.doesNotThrow(() => zeichne(g, { s0: 1e6, pxProS: 4000, tonOben: 5 }, sichtMit({ raster: { beatBeiS: (s) => s * 2, sBeiBeat: (b) => b / 2, beatsProTakt: 4 } }), ui()), 'far outside the source and at the lowest rows');
});
