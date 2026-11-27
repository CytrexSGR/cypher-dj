// Audit U20: the piano roll takes the meter of the project: SNAP BAR and the bar lines follow st.projekt.taktart (3/4: 3 beats), not a fixed 4.
import test from 'node:test';
import assert from 'node:assert/strict';

const { installiere, El } = await import('./helpers/pages_mock.mjs');
const { bindeRolle } = await import('../public/production/pianoroll_operation.js');
const { TASTEN_BREITE } = await import('../public/production/pianoroll.js');

function aufbau(taktart) {
  installiere();
  globalThis.Option = function Option(text, wert) { const o = new El('option'); o.textContent = text; o.value = wert ?? text; return o; };
  const behaelter = new El('div');
  const clip = { id: 'c1', art: 'midi', start_beat: 0, laenge_beats: 12, noten: [] };
  const st = { projekt: { rev: 1, taktart, spuren: [{ id: 's1', farbe: '#ff0000', clips: [clip] }] } };
  const gesendet = [], aufrufe = [];
  const ctx = { st, lies: (k, v) => v, merke() {}, beimBild: [], melde() {}, zug: { beginne: () => ({ bewege() {}, lass() {}, verwirf() {} }) },
    aendere: () => Promise.resolve(true),
    aendereAus: async (f) => { const r = f(st.projekt); if (r) gesendet.push(...r.befehle); return true; } };
  El.prototype.getContext = () => new Proxy({}, { get: (_, n) => (...a) => aufrufe.push([n, ...a]), set: (_, n, v) => { aufrufe.push(['set', n, v]); return true; } });   // bindeRolle takes the context once
  const rolle = bindeRolle(ctx, behaelter);
  const cv = behaelter.querySelector('[data-r="roll"]');
  cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 840, height: 240 });
  rolle.zeige('c1');
  st.rolle.ansicht = { beat0: 0, pxProBeat: 20, tonOben: 60 };
  st.rolle.raster = 'takt';
  return { cv, st, ctx, gesendet, aufrufe };
}

test('audit U20: BAR snap in 3/4 puts a note at the start of the 3-beat bar', async () => {
  const { cv, gesendet } = aufbau([3, 4]);
  // beat 3.5 in the roll: x = TASTEN_BREITE + 3.5 * 20
  await cv.listeners.dblclick[0]({ offsetX: TASTEN_BREITE + 3.5 * 20, offsetY: 10, altKey: false });
  assert.equal(gesendet.length, 1);
  assert.equal(gesendet[0].noten[0].beat, 3, 'bar 2 of a 3/4 project starts at beat 3');
});

test('audit U20: BAR snap in 4/4 is unchanged', async () => {
  const { cv, gesendet } = aufbau([4, 4]);
  await cv.listeners.dblclick[0]({ offsetX: TASTEN_BREITE + 3.5 * 20, offsetY: 10, altKey: false });
  assert.equal(gesendet[0].noten[0].beat, 0);
});

test('audit U20: the strong bar lines in 3/4 sit at 0, 3, 6 ...', () => {
  const { st, ctx, aufrufe } = aufbau([3, 4]);
  for (const f of ctx.beimBild) f();
  const takt = [];
  for (let i = 0; i < aufrufe.length - 2; i++) {
    if (aufrufe[i][0] === 'set' && aufrufe[i][1] === 'strokeStyle' && aufrufe[i][2] === 'rgba(255,255,255,0.18)' && aufrufe[i + 2][0] === 'moveTo') takt.push(aufrufe[i + 2][1]);
  }
  assert.deepEqual(takt.slice(0, 3), [0, 3, 6].map((b) => TASTEN_BREITE + b * 20 + 0.5), String(takt));
});

// ---- piano roll tools: grid values, QUANTIZE/HUMANIZE through the project commands, scale lock ----
const AM = { grundton: 9, skala: 'minor' };
function werkzeug({ gespeichert = {}, noten = [], tonart, laenge = 8, auswahl = [] } = {}) {
  installiere();
  globalThis.Option = function Option(text, wert) { const o = new El('option'); o.textContent = text; o.value = wert ?? text; return o; };
  const behaelter = new El('div');
  const clip = { id: 'c1', art: 'midi', start_beat: 0, laenge_beats: laenge, noten };
  const st = { projekt: { rev: 1, taktart: [4, 4], ...(tonart ? { tonart } : {}), spuren: [{ id: 's1', farbe: '#ff0000', clips: [clip] }] } };
  const gesendet = [], meldungen = [], gemerkt = {}, aufrufe = [];
  const ctx = { st, lies: (k, v) => gespeichert[k] ?? v, merke: (k, v) => { gemerkt[k] = v; }, beimBild: [], melde: (t) => meldungen.push(t),
    zug: { beginne: () => ({ bewege() {}, lass() {}, verwirf() {} }) }, aendere: () => Promise.resolve(true),
    aendereAus: async (f) => { const r = f(st.projekt); if (r) gesendet.push(...r.befehle); return true; } };
  El.prototype.getContext = () => new Proxy({}, { get: (_, n) => (...a) => aufrufe.push([n, ...a]), set: (_, n, v) => { aufrufe.push(['set', n, v]); return true; } });
  const rolle = bindeRolle(ctx, behaelter);
  const cv = behaelter.querySelector('[data-r="roll"]');
  cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 840, height: 240 });
  rolle.zeige('c1');
  st.rolle.ansicht = { beat0: 0, pxProBeat: 80, tonOben: 80 };
  st.rolle.auswahl = auswahl;
  const r = (n) => behaelter.querySelector(`[data-r="${n}"]`);
  const setze = (n, v, art = 'input') => { r(n).value = v; r(n).dispatch(art); };
  return { cv, st, ctx, gesendet, meldungen, gemerkt, aufrufe, r, setze, clip };
}
const aus = (n) => ({ id: `n${n}`, beat: 0.1 * n, laenge: 0.25, ton: 60, vel: 100 });

test('roll tools: SNAP offers the nine values; a stored value of the old table maps to the new id, unknown falls back to 1/16', () => {
  const { r } = werkzeug();
  const opt = r('raster').children.filter((c) => typeof c !== 'string');
  assert.deepEqual(opt.map((o) => o.value), ['1/32', '1/16T', '1/16', '1/8T', '1/8', '1/4T', '1/4', 'bar', 'off']);
  assert.deepEqual(opt.map((o) => o.textContent), ['1/32', '1/16T', '1/16', '1/8T', '1/8', '1/4T', '1/4', 'BAR', 'OFF']);
  assert.equal(r('raster').value, '1/16', 'default');
  for (const [alt, neu] of [['sechzehntel', '1/16'], ['achtel', '1/8'], ['beat', '1/4'], ['takt', 'bar'], ['aus', 'off'], ['1/8T', '1/8T'], ['quatsch', '1/16']]) {
    assert.equal(werkzeug({ gespeichert: { 'djk-prod-rollraster': alt } }).r('raster').value, neu, alt);
  }
});

test('roll tools: changing SNAP is remembered and relabels QUANTIZE; BAR and OFF quantise on 1/16', () => {
  const { r, setze, gemerkt, st } = werkzeug();
  assert.equal(r('quant').textContent, 'QUANTIZE 1/16');
  setze('raster', '1/8T', 'change');
  assert.equal(st.rolle.raster, '1/8T'); assert.equal(gemerkt['djk-prod-rollraster'], '1/8T'); assert.equal(r('quant').textContent, 'QUANTIZE 1/8T');
  setze('raster', 'bar', 'change'); assert.equal(r('quant').textContent, 'QUANTIZE 1/16');
  setze('raster', 'off', 'change'); assert.equal(r('quant').textContent, 'QUANTIZE 1/16');
});

test('roll tools: QUANTIZE sends noten_quantisieren with the grid of SNAP and the selected ids; OFF sends 1/16', () => {
  const { r, setze, gesendet } = werkzeug({ noten: [aus(1), aus(2), aus(3)], auswahl: ['n2', 'n3'] });
  setze('raster', '1/8T', 'change'); r('quant').dispatch('click');
  assert.deepEqual(gesendet, [{ befehl: 'noten_quantisieren', clip_id: 'c1', raster: '1/8T', noten_ids: ['n2', 'n3'] }]);
  gesendet.length = 0; setze('raster', 'off', 'change'); r('quant').dispatch('click');
  assert.deepEqual(gesendet, [{ befehl: 'noten_quantisieren', clip_id: 'c1', raster: '1/16', noten_ids: ['n2', 'n3'] }]);
});

test('roll tools: without a selection QUANTIZE takes all notes (no noten_ids); swing and strength go along only when they differ from the defaults', () => {
  const { r, setze, gesendet } = werkzeug({ noten: [aus(1), aus(2)] });
  r('quant').dispatch('click');
  assert.deepEqual(gesendet.splice(0), [{ befehl: 'noten_quantisieren', clip_id: 'c1', raster: '1/16' }], 'defaults: SWING 50, STR 100 are not sent');
  assert.equal(r('swing').value, '50'); assert.equal(r('staerke').value, '100');
  setze('swing', '60'); setze('staerke', '50'); r('quant').dispatch('click');
  assert.deepEqual(gesendet.splice(0), [{ befehl: 'noten_quantisieren', clip_id: 'c1', raster: '1/16', staerke: 0.5, swing: 60 }]);
  setze('staerke', '100'); r('quant').dispatch('click');
  assert.deepEqual(gesendet.splice(0), [{ befehl: 'noten_quantisieren', clip_id: 'c1', raster: '1/16', swing: 60 }]);
  setze('swing', '90'); r('quant').dispatch('click');
  assert.equal(gesendet[0].swing, 75, 'clamped to 75'); assert.equal(r('swing').value, '75');
});

test('roll tools: SWING is disabled on a triplet grid and not sent there', () => {
  const { r, setze, gesendet } = werkzeug({ noten: [aus(1)] });
  setze('swing', '60'); assert.equal(r('swing').disabled, false);
  setze('raster', '1/16T', 'change'); assert.equal(r('swing').disabled, true);
  r('quant').dispatch('click');
  assert.equal(gesendet[0].swing, undefined, 'a swing other than 50 would be refused on a triplet grid');
  setze('raster', '1/8', 'change'); assert.equal(r('swing').disabled, false);
});

test('roll tools: QUANTIZE on notes that already lie on the grid says so and sends nothing (also for triplets drawn on the page)', async () => {
  const { r, setze, gesendet, meldungen, cv, st } = werkzeug({ noten: [{ id: 'n1', beat: 0.25, laenge: 0.25, ton: 60, vel: 100 }] });
  r('quant').dispatch('click');
  assert.deepEqual(gesendet, []); assert.deepEqual(meldungen, ['Already on the 1/16 grid']);
  setze('raster', '1/8T', 'change');
  await cv.listeners.dblclick[0]({ offsetX: 40 + 0.4 * 80, offsetY: 10, altKey: false });   // a triplet note drawn on the page
  gesendet.length = 0; meldungen.length = 0;
  st.projekt.spuren[0].clips[0].noten = [{ id: 'n9', beat: 0.333333333, laenge: 0.333333333, ton: 60, vel: 100 }];
  st.rolle.auswahl = [];   // drawing a note selected it
  r('quant').dispatch('click');
  assert.deepEqual(gesendet, []); assert.deepEqual(meldungen, ['Already on the 1/8T grid']);
});

test('roll tools: a note drawn on SNAP 1/8T lies at 1/3 (rounded to 1e-9)', async () => {
  const { r, setze, gesendet, cv } = werkzeug();
  setze('raster', '1/8T', 'change');
  await cv.listeners.dblclick[0]({ offsetX: 40 + 0.4 * 80, offsetY: 10, altKey: false });
  assert.equal(gesendet[0].noten[0].beat, 0.333333333);
  assert.ok(r('quant'));
});

test('roll tools: HUMANIZE sends noten_humanisieren with a seed and both amounts, a new seed on every click; disabled while both are 0', () => {
  const { r, setze, gesendet } = werkzeug({ noten: [aus(1), aus(2)], auswahl: ['n1'] });
  assert.equal(r('human-zeit').value, '20'); assert.equal(r('human-vel').value, '10'); assert.equal(r('human').disabled, false);
  r('human').dispatch('click'); r('human').dispatch('click');
  assert.equal(gesendet.length, 2);
  for (const g of gesendet) {
    assert.equal(g.befehl, 'noten_humanisieren'); assert.equal(g.clip_id, 'c1'); assert.equal(g.zeit, 20); assert.equal(g.vel, 10); assert.deepEqual(g.noten_ids, ['n1']);
    assert.ok(Number.isInteger(g.saat) && g.saat >= 0 && g.saat <= 4294967295, String(g.saat));
  }
  assert.notEqual(gesendet[0].saat, gesendet[1].saat, 'a new draw each time');
  setze('human-zeit', '0'); assert.equal(r('human').disabled, false, 'VEL alone is enough');
  setze('human-vel', '0'); assert.equal(r('human').disabled, true);
  setze('human-zeit', '99', 'change'); assert.equal(r('human-zeit').value, '50', 'clamped to 50'); assert.equal(r('human').disabled, false);
  setze('human-vel', '55', 'change'); assert.equal(r('human-vel').value, '40', 'clamped to 40');
});

test('roll tools: SCALE on, key A minor: a double click on C#4 creates C4; arrow up moves a note one scale degree; SCALE off leaves pitches alone', async () => {
  const { r, cv, gesendet, st, gemerkt } = werkzeug({ tonart: AM, noten: [{ id: 'n1', beat: 0, laenge: 1, ton: 69, vel: 100 }], auswahl: ['n1'] });
  const taste = async (key) => { cv.listeners.keydown[0]({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, stopPropagation() {} }); await new Promise((f) => setTimeout(f, 0)); };   // the collector sends on the next turn
  const dbl = () => cv.listeners.dblclick[0]({ offsetX: 40 + 80, offsetY: 7 * 9 + 1, altKey: false });   // row 7 below the top (80): pitch 73 = C#4
  await dbl();
  assert.equal(gesendet.at(-1).noten[0].ton, 73, 'SCALE off: the pitch stays');
  r('skala').dispatch('click');
  assert.equal(gemerkt['djk-prod-rollskala'], '1'); assert.equal(st.rolle.skala, true);
  await dbl();
  assert.equal(gesendet.at(-1).noten[0].ton, 72, 'C#4 -> C4 (tie goes down)');
  st.rolle.auswahl = ['n1'];   // drawing a note selected the new one
  await taste('ArrowUp');
  assert.deepEqual(gesendet.at(-1), { befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'n1', ton: 71 }] }, 'A -> B, one degree, not one semitone');
  await taste('ArrowDown');
  assert.deepEqual(gesendet.at(-1).noten, [{ id: 'n1', ton: 67 }], 'A -> G');
  r('skala').dispatch('click');
  assert.equal(gemerkt['djk-prod-rollskala'], '0');
  await taste('ArrowUp');
  assert.deepEqual(gesendet.at(-1).noten, [{ id: 'n1', ton: 70 }], 'off: a semitone');
});

test('roll tools: SCALE remembered as on starts on; without a project key it changes nothing and says "Set a key first"', async () => {
  const { r, cv, gesendet } = werkzeug({ gespeichert: { 'djk-prod-rollskala': '1' } });
  assert.equal(r('skala').getAttribute('aria-pressed'), 'true');
  assert.match(r('skala').getAttribute('title'), /Set a key first/);
  await cv.listeners.dblclick[0]({ offsetX: 40 + 80, offsetY: 7 * 9 + 1, altKey: false });
  assert.equal(gesendet[0].noten[0].ton, 73, 'no key: the pitch stays');
  const mit = werkzeug({ gespeichert: { 'djk-prod-rollskala': '1' }, tonart: AM });
  assert.doesNotMatch(mit.r('skala').getAttribute('title'), /Set a key first/);
});

test('roll tools: grid lines of the roll follow SNAP (1/32, triplets) when at least 6 px apart', () => {
  const linienX = (raster, px) => {
    const { st, ctx, aufrufe, setze } = werkzeug();
    setze('raster', raster, 'change'); st.rolle.ansicht = { beat0: 0, pxProBeat: px, tonOben: 80 };
    for (const f of ctx.beimBild) f();
    const xs = [];
    for (let i = 0; i < aufrufe.length; i++) if (aufrufe[i][0] === 'moveTo') xs.push(aufrufe[i][1]);
    return xs;
  };
  const bei = (b, px) => TASTEN_BREITE + b * px + 0.5;
  assert.ok(linienX('1/32', 80).includes(bei(0.125, 80)), '1/32 at 10 px');
  assert.ok(!linienX('1/32', 20).includes(bei(0.125, 20)), '1/32 at 2.5 px');
  assert.ok(linienX('1/8T', 60).includes(bei(1 / 3, 60)) || linienX('1/8T', 60).some((x) => Math.abs(x - bei(1 / 3, 60)) < 1e-6), '1/8T at 20 px');
  assert.ok(!linienX('1/8T', 15).some((x) => Math.abs(x - bei(1 / 3, 15)) < 1e-6), '1/8T at 5 px');
});

test('roll tools: a decimal comma is accepted in the number fields ("66,7" is 66.7, not 50)', () => {
  const { r, setze, gesendet } = werkzeug({ noten: [aus(1), aus(2)] });
  setze('swing', '66,7'); r('quant').dispatch('click');
  assert.equal(gesendet[0].swing, 66.7); assert.equal(r('swing').value, '66.7');
});
