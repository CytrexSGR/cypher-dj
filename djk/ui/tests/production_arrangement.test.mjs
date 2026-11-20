// PRODUCTION V1: Arrangement-Zeichner (arrangement.js) ohne Browser: Größen kommen vom ResizeObserver, nicht aus
// getBoundingClientRect in jedem Bild (Fix 11). Fälschungen: Canvas mit Zählern, 2D-Kontext, der alles schluckt, ResizeObserver von Hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neueAnsicht } from '../public/production/timeline.js';

const kontext = () => new Proxy({}, { get: (z, k) => (k in z ? z[k] : () => {}), set: (z, k, v) => { z[k] = v; return true; } });
function leinwand(w, h) {
  const c = { width: 0, height: 0, messungen: 0, w, h, getContext: () => kontext(),
    getBoundingClientRect() { c.messungen++; return { width: c.w, height: c.h, left: 0, top: 0, right: c.w, bottom: c.h }; } };
  return c;
}
function umgebung() {
  const beobachter = [];
  globalThis.ResizeObserver = class { constructor(f) { this.f = f; beobachter.push(this); this.ziele = []; } observe(c) { this.ziele.push(c); } disconnect() {} };
  return { beobachter, melde: (c, w, h) => { c.w = w; c.h = h; for (const b of beobachter) if (b.ziele.includes(c)) b.f([{ target: c, contentRect: { width: w, height: h } }]); } };
}

test('V1 Arrangement: Größen per ResizeObserver, keine Messung im Bildtakt', async () => {
  const umg = umgebung();
  const { Arrangement } = await import('../public/production/arrangement.js');
  const [l, s, u] = [leinwand(800, 28), leinwand(800, 300), leinwand(800, 300)];
  const arr = new Arrangement({ lineal: l, spuren: s, ueber: u, wellen: { hole: () => ({}) } });
  const projekt = { tempo_bpm: 120, loop: { an: false, von_beat: 0, bis_beat: 8 }, spuren: [] };
  const bild = () => arr.bild({ ansicht: neueAnsicht(), projekt, loop: projekt.loop, kopfBeat: null, startBeat: 0, geist: null });
  bild();
  assert.deepEqual([l.width, l.height, s.width, s.height, u.width, u.height], [800, 28, 800, 300, 800, 300], 'Größe schon im ersten Bild');
  const nach1 = l.messungen + s.messungen + u.messungen;
  for (let i = 0; i < 200; i++) bild();
  assert.equal(l.messungen + s.messungen + u.messungen, nach1, '200 Bilder, keine weitere Messung');
  // Größenänderung kommt vom Beobachter und wird im nächsten Bild übernommen
  umg.melde(s, 1000, 340); umg.melde(u, 1000, 340); umg.melde(l, 1000, 28);
  bild();
  assert.deepEqual([l.width, s.width, s.height, u.width, u.height], [1000, 1000, 340, 1000, 340]);
  assert.equal(l.messungen + s.messungen + u.messungen, nach1, 'auch die Änderung kostet keine Messung');
  // Negativ-Kontrolle: ohne Meldung bleibt die Größe
  bild();
  assert.deepEqual([s.width, s.height], [1000, 340]);
});

test('V1 Arrangement: Spuren werden nur bei Änderung neu gezeichnet (Größe, Ansicht, Projekt)', async () => {
  const umg = umgebung();
  const { Arrangement } = await import('../public/production/arrangement.js');
  const [l, s, u] = [leinwand(800, 28), leinwand(800, 300), leinwand(800, 300)];
  const arr = new Arrangement({ lineal: l, spuren: s, ueber: u, wellen: { hole: () => ({}) } });
  let gezeichnet = 0; const orig = arr.zeichneSpuren.bind(arr); arr.zeichneSpuren = (...a) => { gezeichnet++; return orig(...a); };
  const ansicht = neueAnsicht(), projekt = { tempo_bpm: 120, loop: { an: false, von_beat: 0, bis_beat: 8 }, spuren: [] };
  const bild = () => arr.bild({ ansicht, projekt, loop: projekt.loop, kopfBeat: null, startBeat: 0, geist: null });
  bild(); bild(); bild();
  assert.equal(gezeichnet, 1);
  umg.melde(s, 900, 300); bild(); bild();
  assert.equal(gezeichnet, 2, 'neue Größe zeichnet einmal neu');
});

test('Arrangement: without a track the empty area says how to add one', async () => {
  umgebung();
  const { Arrangement } = await import('../public/production/arrangement.js');
  const texte = [];
  const ctx = new Proxy({}, { get: (z, k) => (k === 'fillText' ? (t) => texte.push(String(t)) : k in z ? z[k] : () => {}), set: (z, k, v) => { z[k] = v; return true; } });
  const mk = (w, h) => ({ width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h }) });
  const arr = new Arrangement({ lineal: mk(800, 28), spuren: mk(800, 300), ueber: mk(800, 300), wellen: { hole: () => ({}) } });
  const projekt = (spuren) => ({ tempo_bpm: 120, loop: { an: false, von_beat: 0, bis_beat: 8 }, spuren });
  const bild = (p) => arr.bild({ ansicht: neueAnsicht(), projekt: p, loop: p.loop, kopfBeat: null, startBeat: 0, geist: null });
  bild(projekt([]));
  assert.ok(texte.some((t) => /double-click an instrument in DEVICES/i.test(t)), texte.join(' | '));
  texte.length = 0;
  bild(projekt([{ id: 's1', nr: 1, name: 'A', art: 'audio', clips: [] }]));
  assert.ok(!texte.some((t) => /DEVICES/.test(t)), 'with a track the hint is gone');
});

test('Arrangement: an instrument track without any clip says how to make one; not on audio tracks, not with a clip', async () => {
  umgebung();
  const { Arrangement } = await import('../public/production/arrangement.js');
  const texte = [];
  const ctx = new Proxy({}, { get: (z, k) => (k === 'fillText' ? (t) => texte.push(String(t)) : k in z ? z[k] : () => {}), set: (z, k, v) => { z[k] = v; return true; } });
  const mk = (w, h) => ({ width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h }) });
  const arr = new Arrangement({ lineal: mk(800, 28), spuren: mk(800, 300), ueber: mk(800, 300), wellen: { hole: () => ({}) } });
  const bild = (spuren) => { const p = { tempo_bpm: 120, loop: { an: false, von_beat: 0, bis_beat: 8 }, spuren }; arr.bild({ ansicht: neueAnsicht(), projekt: p, loop: p.loop, kopfBeat: null, startBeat: 0, geist: null }); };
  const hinweise = () => texte.filter((t) => /double click: new MIDI clip/i.test(t)).length;
  bild([{ id: 's1', nr: 1, name: 'A', art: 'instrument', clips: [] }]);
  assert.equal(hinweise(), 1, texte.join(' | '));
  texte.length = 0; bild([{ id: 's1', nr: 1, name: 'A', art: 'audio', clips: [] }]);
  assert.equal(hinweise(), 0, 'audio track: no hint');
  texte.length = 0; bild([{ id: 's1', nr: 1, name: 'A', art: 'instrument', clips: [{ id: 'c1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [] }] }]);
  assert.equal(hinweise(), 0, 'with a clip: no hint');
});
