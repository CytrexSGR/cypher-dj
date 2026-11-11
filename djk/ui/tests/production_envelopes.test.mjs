// 1.12 automation slice 5 (plan docs/b1-plaene/PLAN-1.12-slices4-5-7.md, unit U10): the ENVELOPES tab of the detail area, pure parts (node).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HK_ANZEIGE, HK_TEXT, hkZiele, hkGeste, hkBefehl, verknuepftBefehl, loopBefehl, loopText, HkWahl, normiert, hkPfad } from '../public/production/envelopes.js';
import { HK_BEREICH, HK_ZIELE, hkWert } from '../project/envelope.ts';
import { laneWert } from '../public/production/lanes.js';
import { fuehreAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';

const audio = { id: 'c1', art: 'audio', laenge_beats: 8 };
const midi = { id: 'c2', art: 'midi', laenge_beats: 8 };
const rb = { art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} } };
const wirt = { art: 'instrument', geraet: { art: 'wirt', name: 'surge', slot: 1 } };
const audioSpur = { art: 'audio' };
const zeile = { y: 0, h: 100 };
const bx = (b) => b * 10, xb = (x) => x / 10;

test('U10 T10.1 targets: audio -> Gain, Track Volume, Track Pan; MIDI on RB-338 -> 7 targets; other MIDI -> 3', () => {
  const label = (z) => HK_ANZEIGE[z].label;
  assert.deepEqual(hkZiele(audio, audioSpur).map(label), ['Gain', 'Track Volume', 'Track Pan']);
  assert.deepEqual(hkZiele(midi, rb).map(label), ['Transpose', 'Track Volume', 'Track Pan', 'Cutoff', 'Resonance', 'Env Mod', 'Device Volume']);
  assert.deepEqual(hkZiele(midi, wirt).map(label), ['Transpose', 'Track Volume', 'Track Pan']);
  // the page table is a copy of the server ranges (project/envelope.ts HK_BEREICH)
  assert.deepEqual(Object.keys(HK_ANZEIGE).sort(), [...HK_ZIELE].sort());
  for (const z of HK_ZIELE) assert.deepEqual({ min: HK_ANZEIGE[z].min, max: HK_ANZEIGE[z].max }, HK_BEREICH(z), z);
});

test('U10 T10.2 LINKED toggle and LOOP field: commands, 1/16 .. clip length, invalid input sends nothing', () => {
  const hk = { ziel: 'gain', punkte: [{ beat: 0, wert: -12 }, { beat: 8, wert: 0 }] };
  assert.deepEqual(verknuepftBefehl(audio, hk, false), { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: hk.punkte, verknuepft: false, loop_beats: 4 });
  const frei = { ...hk, verknuepft: false, loop_beats: 2 };
  assert.deepEqual(verknuepftBefehl(audio, frei, true), { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: hk.punkte });
  assert.deepEqual(loopBefehl(audio, frei, '1/2'), { befehl: { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: hk.punkte, verknuepft: false, loop_beats: 0.5 } });
  assert.deepEqual(loopBefehl(audio, frei, '1.5').befehl.loop_beats, 1.5);
  for (const schlecht of ['0', '1/32', '9', 'x', '', '1/0']) assert.deepEqual(loopBefehl(audio, frei, schlecht), { fehler: HK_TEXT.loop_ungueltig }, schlecht);
  assert.deepEqual(loopBefehl(audio, frei, '2'), {}, 'the same value sends nothing');
  assert.deepEqual(loopBefehl(audio, hk, '2'), { fehler: HK_TEXT.nur_frei }, 'a linked envelope has no own loop');
  assert.equal(loopText(0.0625), '1/16'); assert.equal(loopText(2), '2'); assert.equal(loopText(0.75), '0.75');
  // the server takes what the page sends
  let p = fuehreAus(neuesProjekt('T'), { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = structuredClone(p);
  p.spuren[0].clips.push({ id: 'c1', art: 'audio', name: 'a', start_beat: 0, laenge_beats: 8, quelle: { sha256: 'a'.repeat(64), pfad_hinweis: '/a' }, dekodiert: 'fertig',
    offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 });
  p.naechste_id.clip = 2;
  for (const b of [verknuepftBefehl(audio, hk, false), loopBefehl(audio, frei, '1/2').befehl, verknuepftBefehl(audio, frei, true)]) p = fuehreAus(p, b).projekt;
  assert.deepEqual(p.spuren[0].clips[0].huellkurven, [hk]);
});

test('U10 T10.3 point gestures: set, drag, delete and form each send exactly one huellkurve_setzen with the whole list', () => {
  const hk = { ziel: 'gain', verknuepft: false, loop_beats: 4, punkte: [{ beat: 0, wert: -12 }, { beat: 4, wert: 0 }] };
  const ctx = { clip: audio, hk, ziel: 'gain', zeile, beatZuX: bx, xZuBeat: xb, raster: 1 };
  // set: a click on a free place
  const g = hkGeste(ctx);
  const yVon = (w) => zeile.y + 3 + (1 - (w + 60) / 60) * (zeile.h - 6);      // the gain row shows -60..0 dB (3 px air, lanes.js)
  g.down(20, yVon(-30));
  const r = g.up(20, yVon(-30));
  assert.equal(r.befehle.length, 1);
  const b = r.befehle[0];
  assert.deepEqual([b.befehl, b.clip_id, b.ziel, b.verknuepft, b.loop_beats], ['huellkurve_setzen', 'c1', 'gain', false, 4]);
  assert.deepEqual(b.punkte.map((q) => q.beat), [0, 2, 4]);
  assert.ok(Math.abs(b.punkte[1].wert + 30) < 0.5, `about -30 dB: ${b.punkte[1].wert}`);
  // drag: the point at beat 4 moves to beat 6
  const z = hkGeste(ctx);
  assert.equal(z.down(40, yVon(0)), 'punkt');
  z.move(60, yVon(0));
  const zb = z.up(60, yVon(0)).befehle;
  assert.equal(zb.length, 1); assert.deepEqual(zb[0].punkte.map((q) => [q.beat, q.wert]), [[0, -12], [6, 0]]);
  // delete and form change (pure command builders of the binder)
  assert.deepEqual(hkBefehl(audio, hk, { befehl: 'auto_punkte', lane_id: 'hk', loesche_von: 4, loesche_bis: 4 }).punkte, [{ beat: 0, wert: -12 }]);
  assert.equal(hkBefehl(audio, { ...hk, punkte: [{ beat: 0, wert: -12 }] }, null), null, 'the last point is deleted with the envelope, not by a gesture');
  const s = hkBefehl(audio, hk, { befehl: 'auto_punkte', lane_id: 'hk', loesche_von: 4, loesche_bis: 4, setze: [{ beat: 4, wert: 1, form: 's' }] });
  assert.deepEqual(s.punkte, [{ beat: 0, wert: -12 }, { beat: 4, wert: 0, form: 's' }]);
  // a twitch sends nothing (negative control)
  const n = hkGeste(ctx);
  n.down(40, yVon(0)); n.move(41, yVon(0));
  assert.deepEqual(n.up(41, yVon(0)).befehle, []);
  // the first click on a clip without that envelope creates it with one point
  const leer = hkGeste({ ...ctx, hk: null, ziel: 'spur_pan' });
  leer.down(30, 50);
  assert.deepEqual(leer.up(30, 50).befehle, [{ befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'spur_pan', punkte: [{ beat: 3, wert: 0 }] }]);
  // drawing: the path follows the envelope (normalised to the row)
  const pfad = hkPfad(hk, zeile, bx, xb, 80);
  assert.ok(pfad.length > 10);
  assert.ok(Math.abs(laneWert(normiert(hk.punkte, 'gain'), 2, 'geraet.cutoff') - (hkWert(hk, 2) + 60) / 60) < 1e-9);
});

test('U10 T10.4 the chosen target per clip lives in page state; switching clips keeps the tab; texts are English', () => {
  const w = new HkWahl();
  assert.equal(w.reiter, 'clip');
  w.setzeReiter('huellkurven');
  assert.equal(w.ziel(audio, audioSpur), 'gain', 'default: the first target');
  w.waehle('c1', 'spur_pan');
  assert.equal(w.ziel(audio, audioSpur), 'spur_pan');
  assert.equal(w.ziel(midi, rb), 'transpose', 'another clip has its own choice');
  assert.equal(w.reiter, 'huellkurven', 'switching clips keeps the tab');
  const m = { ...midi, huellkurven: [{ ziel: 'geraet.cutoff', punkte: [{ beat: 0, wert: 0 }] }] };
  assert.equal(new HkWahl().ziel(m, rb), 'geraet.cutoff', 'a clip that has an envelope shows it first');
  assert.equal(w.ziel(midi, wirt), 'transpose');
  w.waehle('c2', 'geraet.cutoff');
  assert.equal(w.ziel(midi, wirt), 'transpose', 'a choice the track cannot take falls back');
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'production');
  for (const f of ['envelopes.js', 'envelopes_operation.js']) {
    const quelle = fs.readFileSync(path.join(dir, f), 'utf8');
    const strings = [...quelle.matchAll(/'([^'\n]{12,})'/g)].map((x) => x[1]).filter((s) => !/^[./\w-]+$/.test(s) && !s.startsWith('#'));
    for (const s of strings) assert.equal(/\b(und|oder|nicht|Lautst[aä]rke|Spur|Hüllkurve)\b/.test(s), false, `${f}: ${s}`);
  }
  for (const t of Object.values(HK_TEXT)) assert.match(t, /^[\x20-\x7e·]+$/, t);
});

// U10 page probe finding (2026-11-05, instance d): detail.js hides the tab row and the ENVELOPES panel with the hidden attribute, but their CSS
// sets display:flex, which beats the user agent's [hidden] rule: with no clip selected the tab row and the envelope toolbar were on screen.
test('U10 probe finding: every detail element that detail.js hides with the hidden attribute has a [hidden] rule next to its display rule', () => {
  const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'production', 'production.css'), 'utf8');
  for (const klasse of ['p-detail-reiter', 'p-clip-hk']) {
    assert.match(css, new RegExp(`\\.${klasse}\\s*\\{[^}]*display:\\s*flex`), `${klasse} sets display (the case this guards)`);
    assert.match(css, new RegExp(`\\.${klasse}\\[hidden\\][^{]*\\{[^}]*display:\\s*none`), `${klasse}[hidden] must hide it`);
  }
});
