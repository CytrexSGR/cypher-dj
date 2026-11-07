// 1.15 A7b: the pure parts of oeffentlich/spektrum.js, fed with frames the core produced (tests/fixtures/spektrum_rahmen.json: 1 kHz, 5 kHz and 100 Hz
// full-scale sines through erz/1, the strings test_mixer_spektrum makes the SpektrumSender encode; regenerate with SPEKTRUM_FIXTURE=<file> test_mixer_spektrum).
// The acceptance probe: the peak of the 100 Hz tone and of the 5 kHz tone sit at the right bands, and the bars of the drawing rise there.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SPEKTRUM_BAENDER, SPEKTRUM_QUELLEN, bandMitteHz, bandText, pegelParsen, spitzenBand, balken, rahmenGilt, quellenText } from '../oeffentlich/spektrum.js';

const RAHMEN = JSON.parse(fs.readFileSync(new URL('./fixtures/spektrum_rahmen.json', import.meta.url), 'utf8'));
const von = (hz) => RAHMEN.find((r) => r.hz === hz);

test('bands: 29 centres 1000 x 2^(i/3), 24.8 Hz .. 16 kHz, labels', () => {
  assert.equal(SPEKTRUM_BAENDER, 29);
  assert.ok(Math.abs(bandMitteHz(0) - 24.803) < 0.01);
  assert.ok(Math.abs(bandMitteHz(16) - 1000) < 1e-9);
  assert.ok(Math.abs(bandMitteHz(28) - 16000) < 1e-6);
  assert.equal(bandText(6), '99 Hz');
  assert.equal(bandText(16), '1.0 kHz');
  assert.equal(bandText(23), '5.0 kHz');
  assert.equal(bandText(28), '16 kHz');
});

test('selector values: 20 entries, 1..18 the mixer channels, 19 master, names as the kern tags the frames', () => {
  assert.equal(SPEKTRUM_QUELLEN.length, 20);
  assert.deepEqual([SPEKTRUM_QUELLEN[0], SPEKTRUM_QUELLEN[1], SPEKTRUM_QUELLEN[5], SPEKTRUM_QUELLEN[12], SPEKTRUM_QUELLEN[18], SPEKTRUM_QUELLEN[19]],
    ['off', 'deck/1', 'erz/1', 'erz/8', 'bus/4', 'master']);
  assert.equal(quellenText(5), 'ERZ 1');
  assert.equal(quellenText(19), 'MASTER');
  assert.equal(quellenText(99), '');
});

test('parse: exactly 29 integers, else null', () => {
  assert.equal(pegelParsen(von(1000).pegel).length, 29);
  assert.equal(pegelParsen('1,2,3'), null);
  assert.equal(pegelParsen(`${von(1000).pegel},5`), null);
  assert.equal(pegelParsen(von(1000).pegel.replace(',', ';')), null);
  assert.equal(pegelParsen(''), null);
  assert.equal(pegelParsen(undefined), null);
  assert.deepEqual(pegelParsen(Array(29).fill('-2000').join(',')).slice(0, 2), [-200, -200]);
});

test('acceptance probe: the 100 Hz tone peaks at band 6 (99 Hz), 1 kHz at band 16, 5 kHz at band 23 (5.0 kHz)', () => {
  const erwartet = { 100: 6, 1000: 16, 5000: 23 };
  for (const hz of [100, 1000, 5000]) {
    const db = pegelParsen(von(hz).pegel);
    assert.equal(spitzenBand(db), erwartet[hz], `${hz} Hz`);
    const b = balken(db, 580, 160);
    assert.equal(b.length, 29);
    const hoch = b.reduce((m, x) => (x.h > m.h ? x : m), b[0]);
    assert.equal(hoch.i, erwartet[hz], `the tallest bar of ${hz} Hz`);
    assert.ok(hoch.h > 140, 'a full-scale tone reaches the top of the plot');
    // negative control: the bars of the other tones' bands are low
    const andere = b.filter((x) => x.i !== erwartet[hz] && Math.abs(x.i - erwartet[hz]) > 3);
    assert.ok(andere.every((x) => x.h < 0.65 * hoch.h), "far bands are clearly lower (the lowest bands of the 100 Hz frame carry window leakage near -40 dB)");
  }
  assert.notEqual(spitzenBand(pegelParsen(von(100).pegel)), spitzenBand(pegelParsen(von(5000).pegel)), 'the two tones are told apart');
});

test('bars: geometry inside the canvas, clamped, NaN is the floor', () => {
  const b = balken([0, -90, -300, 50, NaN, 6], 600, 100);
  assert.ok(b.every((x) => x.x >= 0 && x.x + x.b <= 600 && x.y >= 0 && x.y + x.h <= 100 + 1e-9));
  assert.ok(Math.abs(b[1].h) < 1e-9 && b[2].h === 0 && b[4].h === 0, 'floor and below: no bar');
  assert.equal(b[3].h, b[5].h, 'clamped at +6 dB');
  assert.ok(Math.abs(b[0].h - (90 / 96) * 100) < 1e-9, '0 dB sits at 90/96 of the height');
});

test('tag rule: a frame counts only for the selected source', () => {
  assert.equal(rahmenGilt({ kanal: 'erz/2' }, 6), true);
  assert.equal(rahmenGilt({ kanal: 'erz/1' }, 6), false, 'a late frame of the previous source');
  assert.equal(rahmenGilt({ kanal: 'erz/1' }, 0), false, 'nothing selected');
  assert.equal(rahmenGilt({ kanal: 'master' }, 19), true);
  assert.equal(rahmenGilt(null, 5), false);
});

// ---- fix round 2: the Chrome probe found "10 kHz16 kHz" overlapping, a bar over "5.0 kHz", "peak 25 Hz at -200.0 dB" on a silent source ----
import { markenLage, SpektrumAnsicht, SPEKTRUM_LABELBAND, SPEKTRUM_MARKEN } from '../oeffentlich/spektrum.js';

const messe = (t) => 5.5 * t.length;   // measureText stand-in: "10 kHz" = 33 px, as in the Chrome probe (ends 569.4, next starts 566.5 at 600 px)

test('axis labels never overlap and stay inside the canvas, at 600 px and at narrow widths (red on the clamp of the first version)', () => {
  const breiten = [600, 480, 360, 300, 240, 180];
  for (const B of breiten) {
    const m = markenLage(B, messe);
    for (let k = 0; k < m.length; k++) {
      assert.ok(m[k].x >= 0 && m[k].x + m[k].w <= B, `${B}: label ${m[k].text} inside the canvas`);
      if (k > 0) assert.ok(m[k].x >= m[k - 1].x + m[k - 1].w, `${B}: "${m[k - 1].text}" (ends ${m[k - 1].x + m[k - 1].w}) and "${m[k].text}" (starts ${m[k].x}) overlap`);
    }
  }
  // positive controls: the check does see labels, and the first version's clamp is exactly what collided
  assert.ok(markenLage(600, messe).length >= 8, 'at 600 px most labels are drawn');
  assert.ok(markenLage(600, messe).some((l) => l.text === '10 kHz'));
  assert.ok(markenLage(180, messe).length >= 2 && markenLage(180, messe).length < SPEKTRUM_MARKEN.length, 'narrow: some labels dropped, not all');
  const alt = SPEKTRUM_MARKEN.map((i) => ({ x: Math.min(i * (600 / 29), 600 - messe(bandText(i)) - 2), w: messe(bandText(i)) }));
  assert.ok(alt[alt.length - 1].x < alt[alt.length - 2].x + alt[alt.length - 2].w, 'the old clamp overlaps at 600 px (control)');
});

function leinwand(B, H) {
  const rufe = [];
  const ctx = new Proxy({}, { get: (_, n) => (n === 'measureText' ? (t) => ({ width: messe(t) }) : (...a) => { rufe.push([n, ...a]); }), set: () => true });
  return { width: B, height: H, getContext: () => ctx, rufe };
}

test('the labels are drawn after the bars and the bars stay above the label band', () => {
  const l = leinwand(600, 160);
  const a = new SpektrumAnsicht({ leinwand: l, info: { textContent: '' }, sende: null, jetzt: () => 1000 });
  a.setzeQuelle(5);
  l.rufe.length = 0;
  assert.ok(a.aufnehmen({ kanal: 'erz/1', rahmen: 1, pegel: von(5000).pegel }));
  const bar = l.rufe.map((r, k) => [r, k]).filter(([r]) => r[0] === 'fillRect' && r[3] < 50);
  const text = l.rufe.map((r, k) => [r, k]).filter(([r]) => r[0] === 'fillText' && /Hz$/.test(r[1]));
  assert.ok(bar.length === 29 && text.length >= 8, `bars ${bar.length}, labels ${text.length}`);
  assert.ok(Math.min(...text.map(([, k]) => k)) > Math.max(...bar.map(([, k]) => k)), 'every label call comes after the last bar');
  for (const [r] of bar) assert.ok(r[2] + r[4] <= 160 - SPEKTRUM_LABELBAND + 1e-9, 'a bar ends above the label band');
  for (const [r] of text) assert.ok(r[3] > 160 - SPEKTRUM_LABELBAND, 'a label sits inside the label band');
});

test('silent source: "no signal" instead of a peak at -200 dB; the floor is the plot bottom (-90 dB)', () => {
  const zeige = (db) => {
    const info = { textContent: '' };
    const a = new SpektrumAnsicht({ leinwand: null, info, sende: null, jetzt: () => 1000 });
    a.setzeQuelle(5);
    a.aufnehmen({ kanal: 'erz/1', rahmen: 3, pegel: Array(29).fill(Math.round(db * 10)).join(',') });
    return info.textContent;
  };
  assert.equal(zeige(-200), 'ERZ 1: no signal · frame 3');
  assert.equal(zeige(-90), 'ERZ 1: no signal · frame 3', 'at the plot bottom nothing is visible');
  assert.match(zeige(-89.9), /^ERZ 1: peak 25 Hz at -89\.9 dB/, 'just above the floor: still a peak (control)');
  assert.match(zeige(-6), /peak/, 'a real level: peak (control)');
});
