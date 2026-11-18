// Return fader lane, T3: the mixer strip of a return says "a lane drives this" (class `auto`, the CSS puts AUTO in front of the value), the thumb and the value
// follow the lane at the playhead while the transport runs, and a hand move during that time does not look as if it worked (the rest value is sent, the strip
// keeps showing what the core plays). The strip of a return without a fader lane is as before. A stand-in element like production_returns_umbenennen.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

class El {
  constructor(tag = 'div', cls = '') {
    this.tagName = tag.toUpperCase(); this.className = cls; this.children = []; this.parentElement = null;
    this.dataset = {}; this.attrs = {}; this.hoerer = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this.title = '';
    const self = this;
    this.style = { setProperty() {}, removeProperty() {} };
    this.classList = { toggle(k, an) { const s = new Set(self.className.split(' ').filter(Boolean)); if (an ?? !s.has(k)) s.add(k); else s.delete(k); self.className = [...s].join(' '); }, contains: (k) => self.className.split(' ').includes(k) };
  }
  set innerHTML(html) {
    this.children = [];
    for (const m of html.matchAll(/<(\w+) class="([^"]+)"/g)) this.anhaengen(new El(m[1], m[2]));
  }
  anhaengen(k) { k.parentElement = this; this.children.push(k); return k; }
  append(...k) { for (const x of k) this.anhaengen(x); }
  insertBefore(k, vor) { if (k.parentElement) k.parentElement.children = k.parentElement.children.filter((x) => x !== k); k.parentElement = this; const i = vor ? this.children.indexOf(vor) : -1; if (i < 0) this.children.push(k); else this.children.splice(i, 0, k); return k; }
  replaceChildren(...k) { this.children = []; for (const x of k) this.anhaengen(x); }
  remove() { const p = this.parentElement; if (p) p.children = p.children.filter((x) => x !== this); this.parentElement = null; }
  querySelector(sel) { const k = sel.slice(1); for (const c of this.children) { if (c.className.split(' ').includes(k)) return c; const t = c.querySelector(sel); if (t) return t; } return null; }
  querySelectorAll() { return []; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.hoerer[t] ??= []).push(f); }
  feuer(t, e = {}) { for (const f of this.hoerer[t] ?? []) f({ preventDefault() {}, stopPropagation() {}, ...e }); }
  focus() {} select() {}
}

const { faderText } = await import('../public/production/track_heads.js');
const { reglerVonDb } = await import('../public/production/fader_curve.js');
const { returnFaderZeigt } = await import('../public/production/lanes.js');

const LANE = () => ({ id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: -24 }, { beat: 4, wert: 0 }] });
const R = (extra = {}, fader_db = -6) => ({ id: 'r1', nr: 1, name: 'Hall', farbe: '#3b8de0', fader_db, pan: 0, mute: false, solo: false, pre: false,
  hall: { an: true, pre: 0.1, decay: 0.5, groesse: 0.5, tief: 0.5, highcut: 1, fahne: 0.5 }, ...extra });
const P = (ret) => ({ rev: 1, name: 'P', spuren: [], gruppen: [], returns: ret ? [ret] : [] });

async function aufbau(projekt, { mitBild = true } = {}) {
  globalThis.document = { createElement: (t) => new El(t), body: new El() };
  const { bindeReturns } = await import('../public/production/returns.js');
  const els = { 'mixer-returns': new El(), 'mixer-sends': new El(), 'neu-return': new El('button'), returns: new El(), sends: new El() };
  const gesendet = [];
  const ctx = { $: (k) => els[k], st: { projekt, kopfBeat: null }, beimProjekt: [], ...(mitBild ? { beimBild: [] } : {}) };
  ctx.aendere = (l, b) => { gesendet.push(...b); return Promise.resolve(true); };
  ctx.aendereAus = () => Promise.resolve(false);
  bindeReturns(ctx);
  const zeige = (p) => { ctx.st.projekt = p; for (const h of ctx.beimProjekt) h(p); };
  zeige(projekt);
  const kopf = () => els['mixer-returns'].children[0];
  const bild = () => { for (const h of ctx.beimBild ?? []) h(); };
  return { ctx, els, gesendet, zeige, kopf, bild, wert: () => kopf().querySelector('.p-faderwert').textContent, daumen: () => kopf().querySelector('.p-fader').value };
}

test('marke_ruhe_mit_lane: a return with a fader lane carries the class auto, thumb and value show the rest value', async () => {
  const t = await aufbau(P(R({ automation: [LANE()] })));
  assert.ok(t.kopf().classList.contains('auto'), 'class auto');
  assert.equal(t.wert(), faderText(-6));
  assert.equal(t.wert(), '−6.0');
  assert.equal(t.daumen(), String(reglerVonDb(-6)));
});

test('marke_spielt_folgt_lane: while the transport runs the value and the thumb follow the lane at the playhead; on stop the rest value is back', async () => {
  const t = await aufbau(P(R({ automation: [LANE()] })));
  t.ctx.st.kopfBeat = 2; t.bild();
  assert.equal(t.wert(), '−12.0'); assert.equal(t.daumen(), String(reglerVonDb(-12)));
  t.ctx.st.kopfBeat = 4; t.bild();
  assert.equal(t.wert(), '0.0'); assert.equal(t.daumen(), String(reglerVonDb(0)));
  t.ctx.st.kopfBeat = 9; t.bild();
  assert.equal(t.wert(), '0.0', 'past the last point the last value holds');
  t.ctx.st.kopfBeat = 0; t.bild();
  assert.equal(t.wert(), '−24.0');
  t.ctx.st.kopfBeat = null; t.bild();
  assert.equal(t.wert(), '−6.0', 'stopped: the rest value');
  assert.equal(t.daumen(), String(reglerVonDb(-6)));
});

test('marke_handbewegung_taeuscht_nicht: during the lane the hand move sends the rest value but the strip keeps showing the lane value', async () => {
  const t = await aufbau(P(R({ automation: [LANE()] })));
  t.ctx.st.kopfBeat = 2; t.bild();
  const fader = t.kopf().querySelector('.p-fader');
  fader.feuer('pointerdown');
  fader.value = String(reglerVonDb(-3));
  fader.feuer('input');
  assert.deepEqual(t.gesendet, [{ befehl: 'return_aendern', return_id: 'r1', fader_db: -3 }], 'the rest value is kept (no lock)');
  assert.equal(t.wert(), '−12.0', 'the value text is not echoed');
  t.bild();
  assert.equal(t.daumen(), String(reglerVonDb(-12)), 'the thumb is pulled back although the hand still holds it');
  // the answer of the write: the project carries -3, the strip still follows the lane while it plays, and shows -3 after the stop
  t.zeige(P(R({ automation: [LANE()] }, -3)));
  assert.equal(t.wert(), '−12.0'); assert.equal(t.daumen(), String(reglerVonDb(-12)));
  t.ctx.st.kopfBeat = null; t.bild();
  assert.equal(t.wert(), '−3.0'); assert.equal(t.daumen(), String(reglerVonDb(-3)));
  fader.feuer('pointerup');
});

test('marke_ohne_lane_wie_vorher: a return without a fader lane has no marking, echoes the hand value and is not touched by the frame hook', async () => {
  const t = await aufbau(P(R()));
  assert.equal(t.kopf().classList.contains('auto'), false);
  t.ctx.st.kopfBeat = 2; t.bild();
  assert.equal(t.wert(), '−6.0'); assert.equal(t.daumen(), String(reglerVonDb(-6)));
  const fader = t.kopf().querySelector('.p-fader');
  fader.feuer('pointerdown'); fader.value = String(reglerVonDb(-3)); fader.feuer('input');
  assert.equal(t.wert(), '−3.0', 'the hand value is echoed at once');
  assert.deepEqual(t.gesendet, [{ befehl: 'return_aendern', return_id: 'r1', fader_db: -3 }]);
  t.bild();
  assert.equal(t.daumen(), String(reglerVonDb(-3)), 'the frame hook leaves the thumb where the hand put it');
  // another lane (a chain lane) on the return is no fader lane
  const u = await aufbau(P(R({ automation: [{ id: 'a9', ziel: 'insert.i1.out', punkte: [{ beat: 0, wert: 1 }] }] })));
  assert.equal(u.kopf().classList.contains('auto'), false);
});

test('marke_leere_lane_treibt_nicht: a lane without points never shows 0 dB', async () => {
  const leer = R({ automation: [{ id: 'a1', ziel: 'fader', punkte: [] }] });
  assert.equal(returnFaderZeigt(leer, 2).treibt, false);
  assert.equal(returnFaderZeigt(leer, 2).db, -6);
  const t = await aufbau(P(leer));
  t.ctx.st.kopfBeat = 2; t.bild();
  assert.equal(t.wert(), '−6.0');
});

test('returnFaderZeigt: driving needs a lane with points and a finite playhead', () => {
  const r = R({ automation: [LANE()] });
  assert.deepEqual([returnFaderZeigt(r, 2).treibt, returnFaderZeigt(r, 2).db], [true, -12]);
  for (const k of [null, undefined, NaN]) { const z = returnFaderZeigt(r, k); assert.equal(z.treibt, false); assert.equal(z.db, -6); assert.equal(z.lane.id, 'a1'); }
  assert.deepEqual(returnFaderZeigt(R(), 2), { treibt: false, lane: null, db: -6 });
  assert.deepEqual(returnFaderZeigt(null, 2), { treibt: false, lane: null, db: undefined });
});

test('marke_fehlerfaelle: a deleted return does not break the hook, a replaced project does not leave the old lane driving; without beimBild nothing is registered', async () => {
  const t = await aufbau(P(R({ automation: [LANE()] })));
  t.ctx.st.kopfBeat = 2; t.bild();
  t.zeige(P(null));
  assert.equal(t.kopf(), undefined, 'the strip is gone');
  assert.doesNotThrow(() => t.bild());
  // another project object whose return r1 has no lane: nothing of the old lane drives it
  t.zeige(P(R({}, -9)));
  t.bild();
  assert.equal(t.wert(), '−9.0'); assert.equal(t.kopf().classList.contains('auto'), false);
  // the old pin: a ctx without beimBild (and no kopfBeat)
  const u = await aufbau(P(R({ automation: [LANE()] })), { mitBild: false });
  delete u.ctx.st.kopfBeat;
  assert.equal(u.wert(), '−6.0');
  assert.ok(u.kopf().classList.contains('auto'));
});

// Review fixes (ret-seite): the cases the first round of tests could not fail on.
test('marke_taste_zaehlt_vom_ruhewert: an arrow key during the lane steps the rest value, not the lane value at the playhead', async () => {
  const t = await aufbau(P(R({ automation: [LANE()] })));          // rest -6, lane -12 at beat 2
  t.ctx.st.kopfBeat = 2; t.bild();
  const fader = t.kopf().querySelector('.p-fader');
  assert.equal(fader.value, String(reglerVonDb(-12)), 'the thumb sits on the lane value');
  fader.feuer('keydown', { key: 'ArrowUp' });
  fader.value = String(Number(fader.value) + 5);                   // the browser moves the thumb one step after the keydown handlers
  fader.feuer('input');
  assert.equal(t.gesendet.length, 1);
  assert.ok(t.gesendet[0].fader_db > -6 && t.gesendet[0].fader_db <= -5, `ArrowUp from -6 must go up, sent ${t.gesendet[0].fader_db}`);
  t.ctx.st.kopfBeat = null;
  const ohne = await aufbau(P(R()));                               // without a lane the key counts from the thumb as before
  const f2 = ohne.kopf().querySelector('.p-fader');
  f2.feuer('keydown', { key: 'ArrowDown' }); f2.value = String(Number(f2.value) - 5); f2.feuer('input');
  assert.ok(ohne.gesendet[0].fader_db < -6 && ohne.gesendet[0].fader_db >= -7);
});

test('marke_stop_waehrend_die_hand_haelt: the stop (or the removed lane) puts the rest value on the thumb although the hand still holds it', async () => {
  const t = await aufbau(P(R({ automation: [LANE()] })));
  t.ctx.st.kopfBeat = 2; t.bild();
  const fader = t.kopf().querySelector('.p-fader');
  fader.feuer('pointerdown');                                      // the hand holds the fader while the lane plays
  t.ctx.st.kopfBeat = null;
  t.zeige(P(R({ automation: [LANE()] })));                         // stopped: the project object arrives before any frame
  assert.equal(fader.value, String(reglerVonDb(-6)), 'stopped: the rest value, not the lane value');
  const u = await aufbau(P(R({ automation: [LANE()] })));
  u.ctx.st.kopfBeat = 2; u.bild();
  const f2 = u.kopf().querySelector('.p-fader');
  f2.feuer('pointerdown');
  u.zeige(P(R()));                                                 // the lane is deleted while the transport still runs
  assert.equal(f2.value, String(reglerVonDb(-6)), 'lane gone: the rest value');
  assert.equal(u.kopf().classList.contains('auto'), false);
});

test('marke_ziehen_nach_dem_stop: after the stop the frame hook leaves the thumb to the hand', async () => {
  const t = await aufbau(P(R({ automation: [LANE()] })));
  t.ctx.st.kopfBeat = 2; t.bild();
  t.ctx.st.kopfBeat = null; t.bild();
  const fader = t.kopf().querySelector('.p-fader');
  assert.equal(fader.value, String(reglerVonDb(-6)));
  fader.feuer('pointerdown'); fader.value = String(reglerVonDb(-3)); fader.feuer('input');
  t.bild(); t.bild();
  assert.equal(fader.value, String(reglerVonDb(-3)), 'the hand moves the fader of a return with a lane after the stop');
  assert.equal(t.wert(), '−3.0');
  fader.feuer('pointerup');
  // the hook alone (no input handler, whose zeigeWerte would also drop the follow state): once stopped it writes nothing any more
  const u = await aufbau(P(R({ automation: [LANE()] })));
  u.ctx.st.kopfBeat = 2; u.bild(); u.ctx.st.kopfBeat = null; u.bild();
  const f2 = u.kopf().querySelector('.p-fader');
  f2.value = String(reglerVonDb(-3)); u.bild();
  assert.equal(f2.value, String(reglerVonDb(-3)), 'a stopped return is not written by the frame hook');
});

test('marke_daumen_schreibt_nur_bei_aenderung: an off-step lane value is not rewritten every frame (the input snaps to its step)', async () => {
  const flach = R({ automation: [{ id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: -18.7 }, { beat: 4, wert: -18.7 }] }] });
  assert.notEqual(reglerVonDb(-18.7) % 5, 0, 'the test needs an off-step value');
  const t = await aufbau(P(flach));
  const fader = t.kopf().querySelector('.p-fader');
  let stand = '0', schreibt = 0;
  Object.defineProperty(fader, 'value', { configurable: true, get: () => stand, set: (x) => { schreibt++; stand = String(Math.round(Number(x) / 5) * 5); } });
  t.ctx.st.kopfBeat = 1; t.bild();
  const nachErstem = schreibt;
  t.ctx.st.kopfBeat = 2; t.bild(); t.ctx.st.kopfBeat = 3; t.bild(); t.bild();
  assert.equal(schreibt, nachErstem, 'no write while the snapped thumb already sits on the lane value');
  assert.equal(stand, String(Math.round(reglerVonDb(-18.7) / 5) * 5));
});
