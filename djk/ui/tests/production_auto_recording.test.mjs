// 1.12 Automation slice 3 task 9: the page arms tracks and sends gestures. Pure parts, node (the browser run is check/ak14_a3.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODI, armStand, istArmiert, neueGesten, aufnahmeMeldung, armKoerper } from '../public/production/auto_recording.js';
import { nachladenNoetig } from '../public/production/stems.js';
import { reglerVonDb } from '../public/production/fader_curve.js';

const uhr = () => { const l = []; return { l, setze: (f, ms) => { const h = { f, ms }; l.push(h); return h; }, loesche: (h) => { const i = l.indexOf(h); if (i >= 0) l.splice(i, 1); } }; };
const bau = (arm = ['s1']) => {
  const u = uhr(), gesendet = [];
  const g = neueGesten({ senden: async (b) => { gesendet.push(b); }, armiert: (id) => arm.includes(id), ruheMs: 500, uhr: u });
  return { g, gesendet, u };
};
const leere = () => new Promise((r) => setImmediate(r));

test('modes and arm state', () => {
  assert.deepEqual(MODI, ['touch', 'latch', 'write']);
  assert.deepEqual(armStand({ modus: 'latch', spuren: ['s2'] }), { modus: 'latch', spuren: ['s2'] });
  assert.deepEqual(armStand(null), { modus: 'touch', spuren: [] });
  assert.deepEqual(armStand({ modus: 'bogus', spuren: 'x' }), { modus: 'touch', spuren: [] }, 'garbage falls back, never throws');
  assert.equal(istArmiert({ spuren: ['s1'] }, 's1'), true);
  assert.equal(istArmiert({ spuren: ['s1'] }, 's2'), false);
  assert.equal(istArmiert(null, 's1'), false);
  assert.deepEqual(armKoerper('s1', true, 'write'), { spur_id: 's1', an: true, modus: 'write' });
});

test('mouse gesture: values go out, the end event closes it once (D13)', async () => {
  const { g, gesendet } = bau();
  g.wert('s1', 'fader', -6, 'maus'); g.wert('s1', 'fader', -7, 'maus');
  g.ende('s1', 'fader', 'maus'); g.ende('s1', 'fader', 'maus');   // pointerup then lostpointercapture: the second changes nothing
  await leere();
  assert.deepEqual(gesendet.map((b) => b.ende ? 'ende' : b.wert), [-6, -7, 'ende'].slice(0, gesendet.length));
  assert.equal(gesendet.filter((b) => b.ende).length, 1, 'exactly one end');
  assert.ok(gesendet.every((b) => b.quelle === 'maus' && b.spur_id === 's1' && b.ziel === 'fader'));
});

test('while a request is in flight newer values replace the waiting one, the end stays last', async () => {
  const gesendet = []; let frei;
  const g = neueGesten({ senden: (b) => { gesendet.push(b); return new Promise((r) => { frei = r; }); }, armiert: () => true, uhr: uhr() });
  g.wert('s1', 'pan', 0.1, 'maus'); g.wert('s1', 'pan', 0.2, 'maus'); g.wert('s1', 'pan', 0.3, 'maus'); g.ende('s1', 'pan', 'maus');
  assert.equal(gesendet.length, 1);
  frei(); await leere(); frei(); await leere();
  assert.deepEqual(gesendet.map((b) => b.ende ? 'ende' : b.wert), [0.1, 0.3, 'ende']);
});

test('negative control: an unarmed track sends nothing, an end without a gesture sends nothing', async () => {
  const { g, gesendet } = bau(['s1']);
  assert.equal(g.wert('s2', 'fader', -3, 'maus'), false);
  g.ende('s2', 'fader', 'maus'); g.ende('s1', 'pan', 'maus');
  await leere();
  assert.equal(gesendet.length, 0);
});

test('keyboard: 500 ms without a key ends the gesture, another key restarts the rest; the mouse end does not close a keyboard gesture', async () => {
  const { g, gesendet, u } = bau();
  g.wert('s1', 'fader', -1, 'tasten');
  assert.equal(u.l.length, 1); assert.equal(u.l[0].ms, 500);
  const erst = u.l[0];
  g.wert('s1', 'fader', -1.5, 'tasten');
  assert.equal(u.l.length, 1); assert.notEqual(u.l[0], erst, 'the rest timer was restarted');
  g.ende('s1', 'fader', 'maus');                      // a pointer event: not the end of a keyboard gesture
  await leere();
  assert.equal(gesendet.filter((b) => b.ende).length, 0);
  u.l[0].f();                                          // 500 ms pass
  await leere();
  assert.equal(gesendet.filter((b) => b.ende).length, 1);
  assert.equal(gesendet.at(-1).quelle, 'tasten');
});

test('window blur ends every open gesture; a button click is one value with its end', async () => {
  const { g, gesendet } = bau(['s1', 's2']);
  g.wert('s1', 'fader', -2, 'maus'); g.wert('s2', 'pan', 0.5, 'maus');
  g.alleEnden();
  g.einmal('s1', 'mute', 1);
  await leere();
  assert.equal(gesendet.filter((b) => b.ende && b.wert === undefined).length, 3);   // two blur ends and the end of the click
  const m = gesendet.find((b) => b.ziel === 'mute');
  assert.deepEqual(m, { spur_id: 's1', ziel: 'mute', wert: 1, quelle: 'maus' }, 'the value goes out alone');
  assert.deepEqual(gesendet.at(-1), { spur_id: 's1', ziel: 'mute', ende: true, quelle: 'maus' }, 'the end follows as its own request');
});

test('a recording refusal shows its text; success and foreign projects show nothing', () => {
  const f = { spur_id: 's1', ziel: 'fader', slug: 'p1', fehler: 'lane_gesperrt', text: 'The lane is locked' };
  assert.deepEqual(aufnahmeMeldung(f, 'p1'), { text: 'The lane is locked', fehler: true });
  assert.equal(aufnahmeMeldung(f, 'p2'), null, 'another project');
  assert.equal(aufnahmeMeldung({ spur_id: 's1', ziel: 'fader', slug: 'p1', modus: 'touch', punkte: 3 }, 'p1'), null);
  assert.match(aufnahmeMeldung({ slug: 'p1', fehler: 'unbekannt_x' }, 'p1').text, /unbekannt_x/, 'no text: the reason is still shown');
});

test('arm and recording events do not trigger a project reload (the state is in the event)', () => {
  const o = { sichtbar: true, slug: 'p1', rev: 5, eigene: () => false };
  assert.equal(nachladenNoetig('proj', { auto_arm: { modus: 'touch', spuren: [] } }, o), false);
  assert.equal(nachladenNoetig('proj', { auto_aufnahme: { slug: 'p1', spur_id: 's1' } }, o), false);
  assert.equal(nachladenNoetig('proj', { slug: 'p1', rev: 6 }, o), true, 'negative control: a real revision still reloads');
});

// ---- the heads (bindeKoepfe) with a fake DOM: keyboard, pan, M/S, and the end behind the page's own writes (fixup) ----
const { bindeKoepfe } = await import('../public/production/track_heads.js');
const { installiereDom, neuesElement } = await import('./support/mock_dom.mjs');

function kopf({ arm = ['s1'] } = {}) {
  const dom = installiereDom();
  const behaelter = neuesElement();
  const u = uhr(), gesendet = [], schreib = [];
  const warteSchreiben = async () => { while (schreib.some((p) => !p.fertig)) await Promise.all(schreib.map((p) => p.pr)); };
  const gesten = neueGesten({ senden: async (b) => { gesendet.push(b); }, armiert: (id) => arm.includes(id), ruheMs: 500, uhr: u, warteSchreiben });
  const aendereAus = (rechne) => { const x = rechne({ spuren: [stand], tempo_bpm: 120 }); if (x) frei(x.label); };
  const frei = (label) => { const p = { label, fertig: false }; p.pr = new Promise((ok) => { p.los = () => { p.fertig = true; ok(true); }; }); schreib.push(p); return p.pr; };
  const k = bindeKoepfe(behaelter, { aendere: (label) => frei(label), aendereAus, gesten, armStandJetzt: () => ({ spuren: arm }) });
  const stand = { id: 's1', nr: 1, name: 'Kick', farbe: '#fff', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, automation: [] };
  const projekt = { spuren: [stand], gruppen: [], rev: 3 };
  k.zeige(projekt, true);
  return { k, el: k.element('s1'), dom, gesendet, schreib, u };
}
const tick = () => new Promise((r) => setImmediate(r));

test('heads: the mouse end waits for the page\'s own write of that gesture (rev race of the first gesture)', async () => {
  const { el, gesendet, schreib } = kopf();
  const fader = el.querySelector('.p-fader');
  fader.value = String(reglerVonDb(-12));
  fader.fire('pointerdown'); fader.fire('input');
  await tick();
  assert.equal(schreib.length >= 1, true, 'the page writes Volume');
  assert.equal(gesendet.filter((b) => b.wert !== undefined).length, 1, 'the value goes out at once');
  fader.fire('pointerup');                                   // the write is still in flight
  await tick(); await tick();
  assert.equal(gesendet.filter((b) => b.ende).length, 0, 'no end while the write is in flight');
  for (const p of schreib) p.los();
  await tick(); await tick();
  const enden = gesendet.filter((b) => b.ende);
  assert.equal(enden.length, 1, 'exactly one end after the answer');
  assert.deepEqual([enden[0].spur_id, enden[0].ziel, enden[0].quelle], ['s1', 'fader', 'maus']);
  assert.equal(gesendet.indexOf(enden[0]), gesendet.length - 1, 'the end is the last request');
});

test('heads: pan, mouse -> one value, one end with ziel pan', async () => {
  const { el, gesendet, schreib } = kopf();
  const pan = el.querySelector('.p-pan');
  pan.min = '-1'; pan.max = '1'; pan.step = '0.01'; pan.value = '0.5';
  pan.fire('pointerdown'); pan.fire('input'); pan.fire('pointerup');
  for (const p of schreib) p.los();
  await tick(); await tick(); await tick();
  assert.deepEqual(gesendet.map((b) => [b.ziel, b.ende ? 'ende' : b.wert, b.quelle]), [['pan', 0.5, 'maus'], ['pan', 'ende', 'maus']]);
});

test('heads: keyboard -> one end with quelle tasten after 500 ms; a pointer event of the mouse does not close it', async () => {
  const { el, gesendet, schreib, u } = kopf();
  const fader = el.querySelector('.p-fader');
  fader.value = String(reglerVonDb(-3));
  fader.fire('keydown', { key: 'ArrowLeft' }); fader.fire('input');
  fader.fire('keydown', { key: 'ArrowLeft' }); fader.fire('input');
  fader.fire('pointerup');                                   // a stray pointer event: not the end of a keyboard gesture
  await tick();
  assert.equal(gesendet.filter((b) => b.ende).length, 0);
  assert.equal(u.l.length >= 1 && u.l.at(-1).ms, 500);
  for (const p of schreib) p.los();
  u.l.at(-1).f();                                            // 500 ms pass
  await tick(); await tick(); await tick();
  const enden = gesendet.filter((b) => b.ende);
  assert.equal(enden.length, 1);
  assert.equal(enden[0].quelle, 'tasten');
  assert.ok(gesendet.filter((b) => b.wert !== undefined).every((b) => b.quelle === 'tasten'));
});

test('heads: a click on M is the value at once and the end behind the write; S too; an unarmed track sends nothing', async () => {
  const { el, gesendet, schreib } = kopf();
  el.querySelector('.p-mute').fire('click');
  await tick(); await tick();
  assert.deepEqual(gesendet.map((b) => [b.ziel, b.ende ? 'ende' : b.wert]), [['mute', 1]], 'value first, the end waits for the write');
  for (const p of schreib) p.los();
  await tick(); await tick();
  assert.deepEqual(gesendet.map((b) => [b.ziel, b.ende ? 'ende' : b.wert, b.quelle]), [['mute', 1, 'maus'], ['mute', 'ende', 'maus']]);
  el.querySelector('.p-solo').fire('click');
  for (const p of schreib) p.los();
  await tick(); await tick(); await tick();
  assert.deepEqual(gesendet.slice(2).map((b) => [b.ziel, b.ende ? 'ende' : b.wert]), [['solo', 1], ['solo', 'ende']]);
  const aus = kopf({ arm: [] });
  aus.el.querySelector('.p-mute').fire('click');
  const f2 = aus.el.querySelector('.p-fader'); f2.value = String(reglerVonDb(-9)); f2.fire('pointerdown'); f2.fire('input'); f2.fire('pointerup');
  for (const p of aus.schreib) p.los();
  await tick(); await tick();
  assert.equal(aus.gesendet.length, 0, 'negative control: unarmed sends nothing');
});

// ---- fixup 2: gesture state is cleaned on switch, delete and disarm ----
const baueMit = (opt = {}) => {
  const u = uhr(), gesendet = [], arm = new Set(opt.arm ?? ['s1']), da = new Set(opt.da ?? ['s1']);
  const g = neueGesten({ senden: async (b) => { gesendet.push(b); }, armiert: (id) => arm.has(id), vorhanden: (id) => da.has(id), ruheMs: 500, uhr: u });
  return { g, gesendet, u, arm, da };
};

test('cleanup: a track deleted with an open gesture, then blur -> no request', async () => {
  const { g, gesendet, da } = baueMit();
  g.wert('s1', 'fader', -3, 'maus');
  await leere();
  const n = gesendet.length;
  da.delete('s1');                                    // the track is gone
  g.alleEnden();                                      // window blur
  g.ende('s1', 'fader', 'maus');                      // and a late pointerup
  await leere();
  assert.equal(gesendet.length, n, 'nothing after the value');
  // negative control: a track that still exists is ended by the blur
  const k = baueMit();
  k.g.wert('s1', 'fader', -3, 'maus'); k.g.alleEnden(); await leere();
  assert.equal(k.gesendet.filter((b) => b.ende).length, 1);
});

test('cleanup: a project switch drops open gestures, the key timer and queued ends', async () => {
  const { g, gesendet, u } = baueMit();
  g.wert('s1', 'fader', -1, 'tasten');                // key timer running
  g.wert('s1', 'pan', 0.2, 'maus');
  await leere();
  const n = gesendet.length;
  g.verwirf();                                        // another project
  assert.equal(u.l.length, 0, 'the key timer is stopped');
  g.alleEnden(); g.ende('s1', 'pan', 'maus'); await leere();
  assert.equal(gesendet.length, n, 'nothing is sent into the new project');
  // an end that waits for the writer when the switch comes is not sent either
  let frei; const warte = new Promise((ok) => { frei = ok; });
  const gesendet2 = [];
  const g2 = neueGesten({ senden: async (b) => { gesendet2.push(b); }, armiert: () => true, warteSchreiben: () => warte });
  g2.wert('s1', 'fader', -1, 'maus'); g2.ende('s1', 'fader', 'maus');
  await leere();
  g2.verwirf(); frei(); await leere(); await leere();
  assert.deepEqual(gesendet2.map((b) => b.ende ? 'ende' : b.wert), [-1], 'the queued end was dropped');
});

test('cleanup: disarm sends exactly one end; a track that is no longer armed sends none (the server closed it)', async () => {
  const { g, gesendet, arm } = baueMit();
  g.wert('s1', 'fader', -3, 'maus');
  const fertig = g.beendeSpur('s1');                  // the AUTO button is pressed off: the end goes first, then the arm request
  arm.delete('s1');
  await fertig;
  assert.equal(gesendet.filter((b) => b.ende).length, 1, 'exactly one end');
  g.alleEnden(); g.ende('s1', 'fader', 'maus'); await leere();
  assert.equal(gesendet.filter((b) => b.ende).length, 1, 'still one');
  // the server disarmed it (SSE): the gesture is dropped
  const k = baueMit();
  k.g.wert('s1', 'fader', -3, 'maus'); await leere();
  k.arm.delete('s1'); k.g.abgleich();
  k.g.alleEnden(); await leere();
  assert.equal(k.gesendet.filter((b) => b.ende).length, 0);
});

test('cleanup through the heads: a deleted head and a project switch drop gestures', async () => {
  const { k, el, gesendet, schreib, dom } = kopf();
  const fader = el.querySelector('.p-fader');
  fader.value = String(reglerVonDb(-12)); fader.fire('pointerdown'); fader.fire('input');
  await tick();
  const n = gesendet.length;
  k.zeige({ spuren: [], gruppen: [], rev: 4 }, false);   // track deleted
  for (const p of schreib) p.los();
  dom.fenster('blur'); fader.fire('pointerup');
  await tick(); await tick();
  assert.equal(gesendet.length, n, 'no end for a deleted track');
  // another project: the gesture of the old one is gone
  const b = kopf();
  const f2 = b.el.querySelector('.p-fader'); f2.value = String(reglerVonDb(-9)); f2.fire('pointerdown'); f2.fire('input'); await tick();
  const n2 = b.gesendet.length;
  b.k.zeige({ spuren: [{ id: 's1', nr: 1, name: 'Neu', farbe: '#fff', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, automation: [] }], gruppen: [], rev: 1 }, true);
  for (const p of b.schreib) p.los();
  b.dom.fenster('blur'); f2.fire('pointerup'); await tick(); await tick();
  assert.equal(b.gesendet.length, n2, 'nothing is sent into the new project');
});

// ---- the constants cannot drift apart ----
test('the 500 ms rest of the page is the one of the server (GESTE_RUHE_MS)', async () => {
  const { GESTE_RUHE_MS: seite } = await import('../public/production/auto_recording.js');
  const { GESTE_RUHE_MS: server } = await import('../areas/proj/times.ts');
  assert.equal(seite, server);
  const { GESTE_RUHE_MS: ausKoepfen } = await import('../public/production/track_heads.js');
  assert.equal(ausKoepfen, server, 'track_heads.js uses the same constant');
});

// ---- mutants of fixup 1 pinned ----
test('heads: a hand write is marked wiederhole (a retry is allowed), the dblclick is a closed gesture', async () => {
  const dom = installiereDom(); const behaelter = neuesElement();
  const aufrufe = [], gesendet = [];
  const gesten = neueGesten({ senden: async (b) => { gesendet.push(b); }, armiert: () => true, vorhanden: () => true });
  const stand = { id: 's1', nr: 1, name: 'Kick', farbe: '#fff', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, automation: [] };
  const k = bindeKoepfe(behaelter, { aendere: (...a) => { aufrufe.push(a); return Promise.resolve(true); }, aendereAus: () => {}, gesten, armStandJetzt: () => ({ spuren: ['s1'] }) });
  k.zeige({ spuren: [stand], gruppen: [], rev: 3 }, true);
  const el = k.element('s1'), fader = el.querySelector('.p-fader');
  fader.value = String(reglerVonDb(-12)); fader.fire('pointerdown'); fader.fire('input');
  await tick();
  assert.deepEqual(aufrufe.at(-1)[3], { wiederhole: true }, 'the fader write may be repeated after rev_veraltet');
  const pan = el.querySelector('.p-pan'); pan.min = '-1'; pan.max = '1'; pan.step = '0.01'; pan.value = '0.4'; pan.fire('pointerdown'); pan.fire('input');
  await tick();
  assert.deepEqual(aufrufe.at(-1)[3], { wiederhole: true }, 'and the pan write');
  // dblclick: back to the default as ONE closed gesture
  gesendet.length = 0;
  el.querySelector('.p-fader').fire('dblclick');
  await tick(); await tick();
  assert.deepEqual(gesendet.map((b) => [b.ende ? 'ende' : b.wert, b.quelle]), [[0, 'maus'], ['ende', 'maus']]);
});

// ---- fader taper: the slider position is not dB; the gesture still sends dB ----
test('heads: a fader gesture at a mid position sends a dB value from the taper, not a linear one', async () => {
  const { el, gesendet, schreib } = kopf();
  const fader = el.querySelector('.p-fader');
  fader.value = '500'; fader.fire('pointerdown'); fader.fire('input'); fader.fire('pointerup');
  for (const p of schreib) p.los();
  await tick(); await tick(); await tick();
  const w = gesendet.find((b) => b.wert !== undefined);
  assert.equal(w.ziel, 'fader');
  assert.equal(w.wert, -18, 'half travel = -18 dB on the taper (the linear -60..+6 slider gave -27)');
  assert.notEqual(w.wert, -27);
  // negative control: the top of the slider is +6, the bottom is off (-200), a thumb at 850 is 0 dB
  for (const [pos, db] of [['1000', 6], ['850', 0], ['0', -200]]) {
    gesendet.length = 0; fader.value = pos; fader.fire('pointerdown'); fader.fire('input'); fader.fire('pointerup');
    for (const p of schreib) p.los();
    await tick(); await tick(); await tick();
    assert.equal(gesendet.find((b) => b.wert !== undefined).wert, db, `position ${pos}`);
  }
});
