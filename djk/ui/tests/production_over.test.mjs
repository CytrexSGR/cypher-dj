// 1.12 Slice 3, task 5 (D4, D5, D8): the page shows and ends lane overrides. Pure parts, node.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { daumenWert, reglerTaste, ueberAnfrage, istUebersteuert, ueberSchluessel, FADER_MIN, neuerFrost, knopfZustand, FROST_WARTE_MS,
  UEBER_ZIELE, KOPF_WERTE, KNOPF_ZIELE, neuerGriff, setzeRegler, ueberErgebnis, GESTE_RUHE_MS } from '../public/production/track_heads.js';
import { KERN_AUTO_ZIELE } from '../areas/proj/core_path.ts';
import { reEnableAn, RE_ENABLE_TEXT } from '../public/production/transport.js';
import { laneWert } from '../public/production/lanes.js';
import { reglerVonDb, dbVonRegler } from '../public/production/fader_curve.js';

const lane = (ziel, punkte) => ({ id: 'a1', ziel, punkte });
const spur = { id: 's1', nr: 1, fader_db: -3, pan: 0.5, automation: [lane('fader', [{ beat: 0, wert: 0 }, { beat: 8, wert: -12 }]), lane('pan', [{ beat: 0, wert: -1 }, { beat: 8, wert: 1 }])] };

test('thumb follows the lane with the SAME function as the text (no second interpolation)', () => {
  assert.equal(dbVonRegler(daumenWert(spur, 'fader', 4)), laneWert(spur.automation[0].punkte, 4, 'fader'), 'thumb -> dB is the lane value');
  assert.equal(daumenWert(spur, 'fader', 4), reglerVonDb(-6), 'the thumb is a slider position (taper), the text stays dB');
  assert.equal(reglerVonDb(-6), 720);
  assert.equal(daumenWert(spur, 'pan', 4), 0);
  assert.equal(daumenWert(spur, 'pan', 8), 1);
  // the slider cannot show less than its bottom: a lane at -200 dB sits at the bottom edge
  assert.equal(daumenWert({ automation: [lane('fader', [{ beat: 0, wert: -200 }])] }, 'fader', 1), 0);
  // negative control: no lane for the field, no thumb value
  assert.equal(daumenWert({ automation: [lane('pan', [{ beat: 0, wert: 0 }])] }, 'fader', 1), null);
  assert.equal(daumenWert({}, 'pan', 1), null);
});

test('only arrows, Page Up/Down, Home and End count as keydown on a range (D4)', () => {
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) assert.equal(reglerTaste({ key }), true, key);
  for (const key of ['Tab', 'a', 'Enter', 'Escape', 'Shift', ' ', 'F2']) assert.equal(reglerTaste({ key }), false, key);
  assert.equal(reglerTaste({ key: 'ArrowLeft', ctrlKey: true }), false, 'a shortcut is no grip');
  assert.equal(reglerTaste({ key: 'Home', metaKey: true }), false);
});

test('override request: only for a regulator WITH a lane, only when not yet overridden', () => {
  assert.deepEqual(ueberAnfrage(spur, 'fader_db', []), { spur_id: 's1', ziel: 'fader' });
  assert.deepEqual(ueberAnfrage(spur, 'pan', []), { spur_id: 's1', ziel: 'pan' });
  assert.equal(ueberAnfrage({ id: 's2', automation: [] }, 'fader_db', []), null, 'no lane: no request');
  assert.equal(ueberAnfrage({ id: 's2' }, 'pan', []), null);
  assert.equal(ueberAnfrage(spur, 'fader_db', [{ spur_id: 's1', ziel: 'fader' }]), null, 'already overridden: nothing sent again');
  assert.deepEqual(ueberAnfrage(spur, 'pan', [{ spur_id: 's1', ziel: 'fader' }]), { spur_id: 's1', ziel: 'pan' }, 'another field is not overridden');
  assert.equal(ueberAnfrage(spur, 'name', []), null);
});

test('overridden state comes from the server list only (D5, D8)', () => {
  const liste = [{ spur_id: 's1', ziel: 'fader' }];
  assert.equal(istUebersteuert(liste, 's1', 'fader'), true);
  assert.equal(istUebersteuert(liste, 's1', 'pan'), false);
  assert.equal(istUebersteuert(liste, 's2', 'fader'), false);
  assert.equal(istUebersteuert(undefined, 's1', 'fader'), false);
  assert.equal(ueberSchluessel('s1', 'fader'), 's1|fader');
});

test('RE-ENABLE AUTOMATION is active only while something is overridden', () => {
  assert.equal(RE_ENABLE_TEXT, 'RE-ENABLE AUTOMATION');
  assert.equal(reEnableAn([{ spur_id: 's1', ziel: 'fader' }]), true);
  assert.equal(reEnableAn([]), false);
  assert.equal(reEnableAn(undefined), false);
  assert.equal(reEnableAn(null), false);
});

test('lane line is orange exactly while its field is overridden', async () => {
  const { laneLinienFarbe, UEBER_FARBE } = await import('../public/production/lanes.js');
  const liste = [{ spur_id: 's1', ziel: 'fader' }];
  assert.equal(laneLinienFarbe('#3b8de0', liste, 's1', 'fader'), UEBER_FARBE);
  assert.equal(laneLinienFarbe('#3b8de0', liste, 's1', 'pan'), '#3b8de0', 'another field keeps the track colour');
  assert.equal(laneLinienFarbe('#3b8de0', [], 's1', 'fader'), '#3b8de0');
  assert.equal(laneLinienFarbe('#3b8de0', undefined, 's1', 'fader'), '#3b8de0');
});

// ---- fix round 1 ----
test('a reload follows /e/auto, /e/neustart and /k/willkommen, only while the page is visible', async () => {
  const { ladeNachEreignis } = await import('../public/production/production.js');
  for (const a of ['/e/auto', '/e/neustart', '/k/willkommen']) { assert.equal(ladeNachEreignis(a, true), true, a); assert.equal(ladeNachEreignis(a, false), false, `${a} hidden: no reload`); }
  for (const a of ['/zustand/arr', '/pegel', '/e/regler', 'proj']) assert.equal(ladeNachEreignis(a, true), false, `${a} must not reload`);
});

test('mute and solo lanes are overridable like fader and pan', () => {
  const m = { id: 's1', automation: [lane('mute', [{ beat: 0, wert: 1, form: 'sprung' }]), lane('solo', [{ beat: 0, wert: 0, form: 'sprung' }])] };
  assert.deepEqual(ueberAnfrage(m, 'mute', []), { spur_id: 's1', ziel: 'mute' });
  assert.deepEqual(ueberAnfrage(m, 'solo', []), { spur_id: 's1', ziel: 'solo' });
  assert.equal(ueberAnfrage({ id: 's1', automation: [lane('fader', [{ beat: 0, wert: 0 }])] }, 'mute', []), null, 'no mute lane, no request');
  assert.equal(ueberAnfrage(m, 'mute', [{ spur_id: 's1', ziel: 'mute' }]), null);
  // the lane value is reachable through laneWert (0 or 1)
  assert.equal(daumenWert(m, 'mute', 5), 1);
  assert.equal(daumenWert(m, 'solo', 5), 0);
});

test('button state: the frozen lane value wins over the base value', () => {
  assert.equal(knopfZustand({ mute: false }, 'mute', 1), true);
  assert.equal(knopfZustand({ mute: true }, 'mute', 0), false);
  assert.equal(knopfZustand({ mute: true }, 'mute', undefined), true);
  assert.equal(knopfZustand({ solo: false }, 'solo', undefined), false);
});

test('frozen grip value: kept while overridden, dropped after the override ends or when the server never confirmed', () => {
  const f = neuerFrost();
  f.setze('s1|fader', -2.6, 1000);
  assert.equal(f.hole('s1|fader', false, 1100), -2.6, 'asked, not yet confirmed: kept');
  assert.equal(f.hole('s1|fader', true, 1200), -2.6, 'confirmed overridden: kept');
  assert.equal(f.hole('s1|fader', true, 90000), -2.6, 'kept for as long as it is overridden');
  assert.equal(f.hole('s1|fader', false, 90100), undefined, 're-enabled: dropped');
  assert.equal(f.hole('s1|fader', true, 90200), undefined, 'and gone for good');
  f.setze('s1|pan', 0.3, 5000);
  assert.equal(f.hole('s1|pan', false, 5000 + FROST_WARTE_MS + 1), undefined, 'never confirmed (stopped, refused): dropped after the wait');
  f.setze('s1|fader', -1, 0); f.loesche('s1|fader');
  assert.equal(f.hole('s1|fader', true, 1), undefined, 'an input event moves the value: freeze dropped');
});

// ---- fix round 2 ----
test('one page table of the override targets, bound to the server list KERN_AUTO_ZIELE (like EINGANG_OPTIONEN, S18)', () => {
  assert.deepEqual(Object.keys(UEBER_ZIELE), [...KERN_AUTO_ZIELE]);
  // everything else is derived from the table: no second hand-kept copy
  assert.deepEqual(Object.keys(KOPF_WERTE), Object.keys(UEBER_ZIELE).filter((z) => UEBER_ZIELE[z].art === 'regler'));
  assert.deepEqual(Object.keys(KNOPF_ZIELE), Object.keys(UEBER_ZIELE).filter((z) => UEBER_ZIELE[z].art === 'knopf'));
  for (const [z, d] of Object.entries(UEBER_ZIELE)) {
    assert.equal(typeof d.feld, 'string', z);
    assert.ok(d.art === 'regler' ? d.regler && d.anzeige && d.text : d.knopf, z);
    assert.equal(ueberAnfrage({ id: 's', automation: [lane(z, [{ beat: 0, wert: 0 }])] }, d.feld, [])?.ziel, z, `${z}: the field name of the table maps back to the target`);
  }
});

test('the orange has ONE source: the literal stands in lanes.js only, the CSS and the other scripts use the variable', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'oeffentlich', 'produktion');
  const treffer = fs.readdirSync(dir).filter((f) => /\.(js|css)$/.test(f)).filter((f) => /#ff8a1f/i.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(treffer, ['lanes.js']);
  assert.match(fs.readFileSync(path.join(dir, 'production.css'), 'utf8'), /var\(--ueber\)/, 'the CSS uses the variable');
});

test('a range input is written only on a real change (the step snaps the value): a ramp does not write every frame', () => {
  let schreib = 0, wert = '0';
  const r = { min: '-60', max: '6', step: '0.5', get value() { return wert; }, set value(v) { schreib++; wert = String(Math.round(Number(v) / 0.5) * 0.5); } };
  let frames = 0;
  for (let b = 0; b <= 12; b += 0.05) { setzeRegler(r, -b * 0.8); frames++; }   // a ramp of 0 to -9.6 dB in about 240 frames
  assert.ok(frames > 200);
  assert.equal(Number(wert), -9.5);
  assert.ok(schreib <= 20 && schreib >= 19, `20 steps of 0.5 dB, not one write per frame: ${schreib}`);
  const n = schreib;
  setzeRegler(r, -9.6); setzeRegler(r, -9.55); setzeRegler(r, -9.5);
  assert.equal(schreib, n, 'a value inside the same step writes nothing');
  assert.equal(setzeRegler(r, -10), true); assert.equal(schreib, n + 1, 'the next step writes once');
  // pan: step 0.01 (floating point: -1 + 37 * 0.01 is not -0.63 exactly)
  let sp = 0, pw = '0';
  const pr = { min: '-1', max: '1', step: '0.01', get value() { return pw; }, set value(v) { sp++; pw = String(Math.round(Number(v) * 100) / 100); } };
  setzeRegler(pr, -0.63); const m = sp; setzeRegler(pr, -0.63); setzeRegler(pr, -0.6300000000000001);
  assert.equal(sp, m, 'pan: the same step writes nothing');
  // clamped: the fader cannot show less than its bottom
  setzeRegler(r, -200); assert.equal(Number(wert), -60);
});

test('override request answers: 200 and a missing core write, a refusal writes nothing (I2)', () => {
  for (const st of [200, 503, 0]) assert.equal(ueberErgebnis(st), true, `status ${st}`);
  for (const st of [400, 403, 404, 409, 500]) assert.equal(ueberErgebnis(st), false, `status ${st}`);
});

test('a grip is held by the mouse, or by a key until GESTE_RUHE_MS without a key; a key timer never ends a held mouse grip (M7)', () => {
  const g = neuerGriff();
  g.tasteAn('k', 1000);
  assert.equal(g.haelt('k', 1000 + GESTE_RUHE_MS - 1), true, 'a key just pressed holds');
  assert.equal(g.haelt('k', 1000 + GESTE_RUHE_MS + 1), false, 'a quiet keyboard lets go');
  g.tasteAn('k', 5000); g.mausAn('k');
  assert.equal(g.haelt('k', 5000 + 10 * GESTE_RUHE_MS), true, 'the held mouse is not ended by the elapsed key time');
  g.mausAus('k');   // pointerup, pointercancel and lostpointercapture all end it
  assert.equal(g.haelt('k', 5000 + 10 * GESTE_RUHE_MS), false);
  g.mausAn('a:fader_db'); g.tasteAn('a:pan', 1); g.mausAn('b:fader_db');
  g.loescheSpur('a');
  assert.equal(g.haelt('a:fader_db', 2), false); assert.equal(g.haelt('a:pan', 2), false); assert.equal(g.haelt('b:fader_db', 2), true, 'another track keeps its grip');
  g.leere(); assert.equal(g.haelt('b:fader_db', 2), false);
});

test('frost: dropped with its track and on a project switch (no 3 s ghost value for a repeated id)', () => {
  const f = neuerFrost();
  f.setze('s1|fader', -3, 0); f.setze('s2|pan', 0.2, 0);
  f.loescheSpur('s1');
  assert.equal(f.hole('s1|fader', false, 1), undefined);
  assert.equal(f.hole('s2|pan', false, 1), 0.2, 'another track keeps its value');
  f.leere();
  assert.equal(f.hole('s2|pan', false, 2), undefined);
});
