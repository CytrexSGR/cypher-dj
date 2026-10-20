// PRODUCTION V1: Arrangement-Zeichner (arrangement.js) ohne Browser: Größen kommen vom ResizeObserver, nicht aus
// getBoundingClientRect in jedem Bild (Fix 11). Fälschungen: Canvas mit Zählern, 2D-Kontext, der alles schluckt, ResizeObserver von Hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neueAnsicht } from '../oeffentlich/produktion/zeitachse.js';

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
  const { Arrangement } = await import('../oeffentlich/produktion/arrangement.js');
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
  const { Arrangement } = await import('../oeffentlich/produktion/arrangement.js');
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
