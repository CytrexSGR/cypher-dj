// 1.9 U7 T5: the page side of the instrument rack: pure member rows, zones, command builders (rack_device.js) and the head of a rack track
// (label, buttons, context menu). DOM attrappe, no browser, no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { element } from './support/dom_mock.mjs';
import { bouncePunkte } from '../public/production/bounce.js';
import { mergePunkte } from '../public/production/merge.js';
import * as R from '../public/production/rack_device.js';
import { geraetText, bindeSpuren } from '../public/production/track_heads.js';
import { KOPF_MENUE, kopfMenuePunkte } from '../public/production/context_menu.js';

const RB = { art: 'intern', name: 'rb338', parameter: {} };
const SURGE = (slot) => ({ art: 'wirt', name: 'surge', slot });
const KIT = { art: 'intern', name: 'kit', kit: 'kit_zwei' };
const glied = (id, geraet = RB, extra = {}) => ({ id, geraet, ...extra });
const spur = (i, geraet, extra = {}) => ({ id: `s${i}`, nr: i, name: 'x', farbe: '#000000', art: 'instrument', geraet, fader_db: 0, pan: 0, mute: false, solo: false, clips: [], ...extra });
const rack = (...glieder) => ({ art: 'rack', kette: 0, glieder });

test('limits equal the model constants', () => {
  const src = readFileSync(new URL('../project/model.ts', import.meta.url), 'utf8');
  const k = (n) => Number(new RegExp(`export const ${n} = (-?\\d+)`).exec(src)[1]);
  assert.equal(R.MAX_GLIEDER, k('MAX_GLIEDER'));
  assert.equal(R.MAX_RACK_GERAETE, k('MAX_RACK_GERAETE'));
  assert.equal(R.GLIED_GAIN_MIN, k('GLIED_GAIN_MIN'));
  assert.equal(R.GLIED_GAIN_MAX, k('GLIED_GAIN_MAX'));
});

test('zonenLeiste: an absent zone is the whole range', () => {
  assert.deepEqual(R.zonenLeiste(glied('g1')), { ton: [0, 127], vel: [1, 127] });
  assert.deepEqual(R.zonenLeiste(glied('g1', RB, { ton: [48, 72], vel: [10, 100] })), { ton: [48, 72], vel: [10, 100] });
});

test('zoneBefehl: one rack_glied_setzen body with the whole member and the new zone; clamps so that lo never passes hi', () => {
  const g = glied('g2', KIT, { ton: [59, 72], gain_db: -3 });
  assert.deepEqual(R.zoneBefehl('s1', g, 'ton_lo', 64), { befehl: 'rack_glied_setzen', spur_id: 's1', glied: { id: 'g2', geraet: KIT, ton: [64, 72], gain_db: -3 } });
  assert.deepEqual(R.zoneBefehl('s1', g, 'ton_lo', 100).glied.ton, [72, 72], 'lo clamps to hi');
  assert.deepEqual(R.zoneBefehl('s1', g, 'ton_hi', 10).glied.ton, [59, 59], 'hi clamps to lo');
  assert.deepEqual(R.zoneBefehl('s1', g, 'ton_hi', 500).glied.ton, [59, 127], 'hi clamps to 127');
  assert.deepEqual(R.zoneBefehl('s1', glied('g1'), 'vel_lo', -5).glied.vel, [1, 127], 'velocity starts at 1');
  assert.equal(R.zoneBefehl('s1', glied('g1'), 'vel_lo', 20).glied.ton, undefined, 'an absent zone stays absent');
  assert.equal(R.zoneBefehl('s1', g, 'ton_lo', Number.NaN), null, 'not a number: no command');
  assert.equal(R.zoneBefehl('s1', g, 'unsinn', 5), null);
});

test('kantenZug: a drag from 59 to 64 sends exactly one body at the end; a drag back to the start sends none', () => {
  const g = glied('g1', RB, { ton: [59, 72] }), gesendet = [];
  const z = R.kantenZug('s1', g, 'ton_lo', (b) => gesendet.push(b));
  for (const w of [60, 61, 62, 63, 64]) z.bewegung(w);
  assert.equal(gesendet.length, 0, 'moving only previews');
  z.ende();
  assert.equal(gesendet.length, 1);
  assert.deepEqual(gesendet[0].glied.ton, [64, 72]);
  z.ende();
  assert.equal(gesendet.length, 1, 'a second end sends nothing');
  const g2 = [], z2 = R.kantenZug('s1', g, 'ton_lo', (b) => g2.push(b));
  z2.bewegung(70); z2.bewegung(59); z2.ende();
  assert.deepEqual(g2, []);
  const g3 = [], z3 = R.kantenZug('s1', g, 'ton_lo', (b) => g3.push(b));   // crossing the other edge clamps
  assert.equal(z3.bewegung(90), 72);
  z3.ende();
  assert.deepEqual(g3[0].glied.ton, [72, 72]);
});

test('tasteVonX: pixel to key, clamped', () => {
  assert.equal(R.tasteVonX(0, 200, 0, 127), 0);
  assert.equal(R.tasteVonX(200, 200, 0, 127), 127);
  assert.equal(R.tasteVonX(-30, 200, 0, 127), 0);
  assert.equal(R.tasteVonX(999, 200, 1, 127), 127);
  assert.equal(R.tasteVonX(0, 200, 1, 127), 1);
  assert.equal(R.tasteVonX(100, 0, 0, 127), 0, 'zero width');
});

test('ketteBefehl and gainBefehl', () => {
  assert.deepEqual(R.ketteBefehl('s1', 5), { befehl: 'rack_kette', spur_id: 's1', kette: 5 });
  assert.equal(R.ketteBefehl('s1', 200).kette, 127);
  assert.equal(R.ketteBefehl('s1', -3).kette, 0);
  assert.equal(R.ketteBefehl('s1', 2.6).kette, 3);
  assert.equal(R.ketteBefehl('s1', 'abc'), null);
  const g = glied('g1', RB, { ton: [1, 2] });
  assert.deepEqual(R.gainBefehl('s1', g, -6), { befehl: 'rack_glied_setzen', spur_id: 's1', glied: { id: 'g1', geraet: RB, ton: [1, 2], gain_db: -6 } });
  assert.equal('gain_db' in R.gainBefehl('s1', glied('g1', RB, { gain_db: -6 }), 0).glied, false, '0 dB is the absent value');
  assert.equal(R.gainBefehl('s1', g, 99).glied.gain_db, 12);
  assert.equal(R.gainBefehl('s1', g, -99).glied.gain_db, -60);
  assert.equal(R.gainBefehl('s1', g, 'x'), null);
});

test('add and remove member builders; the default member is an RB-338 without an id', () => {
  assert.deepEqual(R.gliedHinzuBefehl('s1'), { befehl: 'rack_glied_setzen', spur_id: 's1', glied: { geraet: RB } });
  assert.deepEqual(R.gliedEntfernenBefehl('s1', 'g2'), { befehl: 'rack_glied_entfernen', spur_id: 's1', glied_id: 'g2' });
});

test('gliedZeilen: rows with device text, zones and what may be done', () => {
  const s = spur(1, rack(glied('g1'), glied('g2', SURGE(2), { ton: [60, 72], gain_db: 3 })));
  const z = R.gliedZeilen(s);
  assert.deepEqual(z.map((x) => [x.id, x.text, x.kannEntfernen]), [['g1', 'RB-338', true], ['g2', 'SURGE · 2', true]]);
  assert.deepEqual(z[1].zonen, { ton: [60, 72], vel: [1, 127] });
  assert.equal(z[1].gain, 3);
  assert.equal(R.gliedZeilen(spur(1, rack(glied('g1'))))[0].kannEntfernen, false, 'the last member cannot go');
  assert.equal(R.kannGliedHinzu(spur(1, rack(glied('g1'), glied('g2'), glied('g3'), glied('g4')))), false, 'four members: full');
  assert.equal(R.kannGliedHinzu(s), true);
  assert.deepEqual(R.gliedZeilen(spur(1, RB)), [], 'a plain device has no rows');
});

test('brauchtSlot: the page twin of istWirt', () => {
  assert.equal(R.brauchtSlot(spur(1, rack(glied('g1'), glied('g2', SURGE(1))))), true, 'rack with a Surge member');
  assert.equal(R.brauchtSlot(spur(1, rack(glied('g1'), glied('g2', KIT)))), false, 'rack without Surge');
  assert.equal(R.brauchtSlot(spur(1, SURGE(1))), true);
  assert.equal(R.brauchtSlot(spur(1, RB)), false);
  assert.equal(R.brauchtSlot({ geraet: { art: 'wirt' }, clips: [] }), true, 'no art field, no slot: still a Surge track');
  assert.equal(R.brauchtSlot(spur(1, SURGE(1), { art: 'audio' })), false, 'an audio track has no device');
  assert.equal(R.brauchtSlot(null), false);
});

test('geraetText: a rack says RACK · <members>', () => {
  assert.equal(geraetText(spur(1, rack(glied('g1'), glied('g2')))), 'RACK · 2');
  assert.equal(geraetText(spur(1, rack(glied('g1')))), 'RACK · 1');
  assert.equal(geraetText(spur(1, SURGE(1))), 'SURGE · 1');
});

test('every visible string of the rack panel is English (printable ASCII, no German umlauts)', () => {
  const texte = [...Object.values(R.RACK_TEXT), ...KOPF_MENUE.map((e) => e.text)];
  assert.ok(texte.length > 8);
  for (const t of texte) assert.match(t, /^[ -~]+$/, t);
});

function binde() {
  globalThis.document = { createElement: (t) => Object.assign(element(t), { style: { setProperty() {} }, value: '', querySelector: () => Object.assign(element(), { style: { setProperty() {} }, value: '' }), querySelectorAll: () => [] }) };
  const els = { koepfe: Object.assign(element(), { children: [], insertBefore(el) { this.children.push(el); } }) }; const $ = (k) => (els[k] ??= element());
  const beim = [], log = [];
  bindeSpuren({ st: {}, $, aendere: (l, b) => log.push([l, b]), aendereAus() {}, beimProjekt: beim, beimBild: [], beimEreignis: [] });
  return { els, log, zeige: (p) => { for (const f of beim) f(p); return els; } };
}

test('+ RACK: creates spur_neu with a rack of one RB-338 member and the name Rack; disabled without a project, at 8 racks and at the track limit', () => {
  try {
    const { els, log, zeige } = binde();
    assert.equal(zeige(null)['neu-rack'].disabled, true);
    assert.equal(zeige({ spuren: [] })['neu-rack'].disabled, false);
    els['neu-rack'].ereignisse.click[0]();
    assert.deepEqual(log, [['Add rack track', [{ befehl: 'spur_neu', art: 'instrument', name: 'Rack', geraet: { art: 'rack', kette: 0, glieder: [{ id: 'g1', geraet: RB }] } }]]]);
    const acht = Array.from({ length: 8 }, (_, i) => spur(i + 1, rack(glied('g1'))));
    assert.equal(zeige({ spuren: acht.slice(0, 7) })['neu-rack'].disabled, false, '7 racks');
    assert.equal(zeige({ spuren: acht })['neu-rack'].disabled, true, '8 racks');
  } finally { delete globalThis.document; }
});

test('+ SURGE (Review Focus 1): one Surge track plus one Surge member use both slots', () => {
  try {
    const { zeige } = binde();
    const aus = (spuren) => zeige({ spuren })['neu-surge'].disabled;
    assert.equal(aus([spur(1, SURGE(1))]), false, 'one Surge track: one slot left');
    assert.equal(aus([spur(1, SURGE(1)), spur(2, rack(glied('g1'), glied('g2', SURGE(2))))]), true, 'track + member');
    assert.equal(aus([spur(1, rack(glied('g1', SURGE(1)), glied('g2', SURGE(2))))]), true, 'two members');
    assert.equal(aus([spur(1, rack(glied('g1', SURGE(1))))]), false, 'one member');
    assert.equal(aus([spur(1, rack(glied('g1'), glied('g2', KIT)))]), false, 'a rack without Surge uses no slot (negative control)');
  } finally { delete globalThis.document; }
});

test('+ KIT: members count toward the 8 kit devices', () => {
  try {
    const { zeige } = binde();
    const aus = (spuren) => zeige({ spuren })['neu-kit'].disabled;
    const kits = (n) => Array.from({ length: n }, (_, i) => spur(i + 1, KIT));
    assert.equal(aus([...kits(7), spur(20, rack(glied('g1', KIT)))]), true, '7 tracks + 1 member');
    assert.equal(aus([...kits(6), spur(20, rack(glied('g1', KIT)))]), false, '6 tracks + 1 member');
    assert.equal(aus([...kits(4), spur(20, rack(glied('g1', KIT), glied('g2', KIT), glied('g3', KIT), glied('g4', KIT)))]), true, '4 + 4');
    assert.equal(aus([spur(20, rack(glied('g1'), glied('g2')))]), false, 'RB members do not count');
  } finally { delete globalThis.document; }
});

test('KOPF_MENUE: MAKE RACK on an instrument track sends spur_aendern geraet {art: rack}; not offered on a rack, an audio track', () => {
  const log = [];
  const ctxFuer = (spuren) => ({ aendere: (l, b) => log.push([l, b]), st: { projekt: { spuren } } });
  const punkte = (s) => kopfMenuePunkte(ctxFuer([s]), s);
  const mk = (s) => punkte(s).find((p) => p.text === 'MAKE RACK');
  mk(spur(1, RB)).aktion();
  assert.deepEqual(log, [['Make rack s1', [{ befehl: 'spur_aendern', spur_id: 's1', geraet: { art: 'rack' } }]]]);
  assert.equal(mk(spur(1, rack(glied('g1')))), undefined, 'already a rack');
  assert.equal(mk(spur(1, undefined, { art: 'audio' })), undefined, 'audio track');
  const acht = Array.from({ length: 8 }, (_, i) => spur(i + 1, rack(glied('g1'))));
  assert.equal(kopfMenuePunkte(ctxFuer([...acht, spur(9, RB)]), spur(9, RB)).find((p) => p.text === 'MAKE RACK').aus, true, 'at 8 racks: disabled');
  assert.equal(mk(spur(1, RB)).aus, false, 'below the limit: enabled');
});

test('merge and bounce treat a rack with a Surge member like a Surge track: Freeze first; a rack without Surge needs none', () => {
  const noten = [{ id: 'c1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [{ beat: 0 }] }];
  const au = { id: 'c2', art: 'audio', start_beat: 0, laenge_beats: 4, dekodiert: 'fertig' };
  const proj = (geraet, extra = {}) => ({ loop: { an: false, von_beat: 0, bis_beat: 32 }, spuren: [spur(1, geraet, { clips: noten, ...extra }), spur(2, undefined, { art: 'audio', clips: [au] })] });
  const mp = (p) => mergePunkte(p, ['c1', 'c2'], noten[0], null)[0];
  const sg = mp(proj(rack(glied('g1'), glied('g2', SURGE(1)))));
  assert.equal(sg.aus, true); assert.match(sg.grund, /Freeze/);
  assert.equal(mp(proj(rack(glied('g1'), glied('g2', SURGE(1))), { freeze: { datei: 'x' } })).aus, false, 'frozen');
  assert.equal(mp(proj(rack(glied('g1'), glied('g2', KIT)))).aus, false, 'no Surge member: nothing to freeze');
  const bp = (p) => Object.fromEntries(bouncePunkte(p, ['c1'], noten[0], null).map((x) => [x.id, x]));
  assert.match(bp(proj(rack(glied('g1', SURGE(2)))))['neue_spur'].grund, /Freeze/);
  assert.equal(bp(proj(rack(glied('g1'))))['neue_spur'].aus, false);
});

// ---- the panel (rack_device_operation.js) on a small DOM stand-in: a refused or clamped input shows the server state again
import { bindeRackPanel } from '../public/production/rack_device_operation.js';

function knoten(tag) {
  const k = { tag, className: '', textContent: '', title: '', value: '', disabled: false, type: '', dataset: {}, attr: {}, children: [], style: {}, ereignisse: {},
    setAttribute(n, v) { k.attr[n] = v; }, addEventListener(n, f) { (k.ereignisse[n] ??= []).push(f); },
    removeEventListener(n, f) { k.ereignisse[n] = (k.ereignisse[n] ?? []).filter((x) => x !== f); },
    append(...c) { k.children.push(...c); }, replaceChildren(...c) { k.children = c; },
    feuer(n, e = {}) { for (const f of [...(k.ereignisse[n] ?? [])]) f({ preventDefault() {}, stopPropagation() {}, pointerId: 1, ...e }); },
    focus() { globalThis.document.activeElement = k; k.feuer('focus'); }, blur() { if (globalThis.document.activeElement === k) globalThis.document.activeElement = null; k.feuer('blur'); },
    getBoundingClientRect: () => ({ left: 0, width: 127, x: 0, y: 0 }) };
  return k;
}
const finde = (k, klasse, alle = false) => {
  const r = [];
  const lauf = (x) => { if (x.className.split(' ').includes(klasse)) r.push(x); x.children.forEach(lauf); };
  lauf(k);
  return alle ? r : r[0];
};
function panel(spurGeraet, antwort) {
  globalThis.document = { createElement: knoten, activeElement: null };
  const sp = spur(1, spurGeraet), gesendet = [], wurzel = knoten('div');
  const ctx = { st: { projekt: { spuren: [sp] } }, aendere: (l, b) => { gesendet.push(b[0]); return antwort(sp, b[0]); }, melde() {} };
  const p = bindeRackPanel(ctx, wurzel);
  p.zeige(sp);
  return { wurzel, gesendet, p, sp, redraw: () => p.zeige(sp) };
}
const fertig = () => new Promise((r) => setTimeout(r, 5));

test('panel: Esc in a number field shows the server value, not an empty field', async () => {
  try {
    const { wurzel } = panel(rack(glied('g1')), () => Promise.resolve());
    const f = finde(wurzel, 'p-irack-ketten-zahl');
    f.focus(); f.value = '55';
    f.feuer('keydown', { key: 'Escape' });
    assert.equal(finde(wurzel, 'p-irack-ketten-zahl').value, '0');
  } finally { delete globalThis.document; }
});

test('panel: a refused chain value (project unchanged) shows the server value after the answer', async () => {
  try {
    const { wurzel, gesendet } = panel(rack(glied('g1')), () => Promise.resolve());   // refused: the project stays as it is
    const f = finde(wurzel, 'p-irack-ketten-zahl');
    f.value = '50'; f.feuer('change');
    assert.deepEqual(gesendet.map((b) => b.kette), [50]);
    await fertig();
    assert.equal(finde(wurzel, 'p-irack-ketten-zahl').value, '0');
    assert.equal(finde(wurzel, 'p-irack-ketteregler').value, '0');
  } finally { delete globalThis.document; }
});

test('panel: a clamped input without any change (200 on a chain of 127) shows 127; a bad entry shows the server value too', async () => {
  try {
    const g = { art: 'rack', kette: 127, glieder: [glied('g1')] };
    const { wurzel, gesendet } = panel(g, () => Promise.resolve());
    const f = finde(wurzel, 'p-irack-ketten-zahl');
    f.value = '200'; f.feuer('change');
    assert.equal(gesendet[0].kette, 127, 'clamped by the builder');
    await fertig();
    assert.equal(finde(wurzel, 'p-irack-ketten-zahl').value, '127');
    const f2 = finde(wurzel, 'p-irack-ketten-zahl');
    f2.value = 'abc'; f2.feuer('change');
    assert.equal(gesendet.length, 1, 'nothing sent for a bad entry');
    assert.equal(finde(wurzel, 'p-irack-ketten-zahl').value, '127');
  } finally { delete globalThis.document; }
});

test('panel: a refused gain on the slider and in the field shows the server gain again', async () => {
  try {
    const { wurzel, gesendet } = panel(rack(glied('g1', RB, { gain_db: -3 })), () => Promise.resolve());
    const r = finde(wurzel, 'p-irack-gainregler');
    r.value = '9'; r.feuer('change');
    assert.equal(gesendet[0].glied.gain_db, 9);
    await fertig();
    assert.equal(finde(wurzel, 'p-irack-gainregler').value, '-3');
    assert.equal(finde(wurzel, 'p-irack-gainzahl').value, '-3');
  } finally { delete globalThis.document; }
});

test('panel: a zone drag keeps the preview until the answer, then shows the server state', async () => {
  try {
    let antworte;
    const { wurzel, gesendet } = panel(rack(glied('g1', RB, { ton: [36, 59] })), () => new Promise((r) => { antworte = r; }));
    const ton = finde(wurzel, 'p-irack-ton'), griff = finde(ton, 'p-irack-griff-hi');
    griff.feuer('pointerdown', { clientX: 59 });
    griff.feuer('pointermove', { clientX: 80 });
    griff.feuer('pointerup', { clientX: 80 });
    assert.equal(gesendet.length, 1);
    assert.deepEqual(gesendet[0].glied.ton, [36, 80]);
    assert.equal(finde(wurzel, 'p-irack-zonentext').textContent, 'KEYS 36–80', 'the preview stays while the write is in flight');
    antworte();                                   // refused: the project did not change
    await fertig();
    assert.equal(finde(wurzel, 'p-irack-zonentext').textContent, 'KEYS 36–59');
  } finally { delete globalThis.document; }
});

test('texts: the + MEMBER hint and the freeze reason say what is true', async () => {
  assert.doesNotMatch(R.RACK_TEXT.hinzu_titel, /drop/i);
  const { AUSGABE_FEHLER } = await import('../public/production/output.js');
  const t = AUSGABE_FEHLER.keine_wirtspur;
  assert.match(t, /rack with a Surge member/);
});

// ---- 1.9 U8 T11 (spec E12): the four macro knobs of the strand rack in the rack panel -----------------------------------------------------------
function panelMitRack(rackFeld) {
  globalThis.document = { createElement: knoten, activeElement: null };
  const sp = spur(1, rack(glied('g1')), rackFeld ? { rack: rackFeld } : {}), gesendet = [], wurzel = knoten('div');
  const ctx = { st: { projekt: { spuren: [sp] } }, aendere: (l, b, k) => { gesendet.push([l, b[0], k]); return Promise.resolve(); }, melde() {} };
  const p = bindeRackPanel(ctx, wurzel);
  p.zeige(sp);
  return { wurzel, gesendet, p, sp };
}
const MAKROS_RACK = { slot: 1, namen: ['Cut', '', '', ''], makros: [{ ziel: [{ glied: 'g1', param: 'cutoff', von: 0, bis: 1 }] }, { ziel: [] }, { ziel: [] }, { ziel: [] }], werte: [0.25, 0, 0, 0] };

test('panel macros: four knobs show the rack values; a move is one rack_makro control change under a coalescing key', () => {
  try {
    const { wurzel, gesendet } = panelMitRack(MAKROS_RACK);
    const regler = finde(wurzel, 'p-irack-makro-regler', true);
    assert.equal(regler.length, 4);
    assert.equal(regler[0].value, '0.25'); assert.equal(regler[0].attr['aria-label'], 'Cut of the rack macros');
    assert.equal(regler[1].attr['aria-label'], 'Macro 2 of the rack macros');
    assert.ok(regler.every((r) => r.disabled === false));
    regler[1].value = '0.7'; regler[1].feuer('input');
    assert.deepEqual(gesendet.map((g) => g[1]), [{ befehl: 'rack_makro', strang_id: 's1', nr: 2, wert: 0.7 }]);
    assert.equal(gesendet[0][2], 'rack:s1:2', 'same key as the page knob: a drag is one undo step');
  } finally { delete globalThis.document; }
});

test('panel macros: without a mapping the knobs wait (disabled, say why) and send nothing; a live value is shown without a rebuild', () => {
  try {
    const { wurzel, gesendet, p, sp } = panelMitRack(null);
    const regler = finde(wurzel, 'p-irack-makro-regler', true);
    assert.ok(regler.every((r) => r.disabled === true));
    assert.match(finde(wurzel, 'p-irack-makro-hinweis').textContent, /Map a member parameter/);
    regler[0].feuer('input');
    assert.deepEqual(gesendet, [], 'a disabled knob sends nothing');
    // a rack arrives (a mapping was added elsewhere), then a macro value changes: the same panel shows both
    sp.rack = { ...MAKROS_RACK, werte: [0, 0, 0, 0] }; p.zeige(sp);
    const r2 = finde(wurzel, 'p-irack-makro-regler', true);
    assert.ok(r2.every((r) => r.disabled === false));
    sp.rack = { ...MAKROS_RACK, werte: [0.5, 0, 0, 0] }; p.zeige(sp);
    assert.equal(finde(wurzel, 'p-irack-makro-regler', true)[0].value, '0.5');
  } finally { delete globalThis.document; }
});
