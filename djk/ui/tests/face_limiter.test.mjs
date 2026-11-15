// Device faces, limiter: the static curve (min(x, ceiling) in dB, the gain computer of channel_limiter.h) and the fixed text line, which is pinned to the source of
// the limiter stage (ins_lim.h). A closed face costs nothing, and the place for T8's meter exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LIM_ACHSEN, LIM_FESTZEILE, LIM_LATENZ_SAMPLES, LIM_VORHALT_MS, limDecke, limAusgangDb, limKurve, limParameterTabelle, baueLimiterFace } from '../public/face/limiter.js';
import { baueAnzeige } from '../public/face/display.js';
import { oeffneFace } from '../public/face/frame.js';
import { LIM_PARAMETER } from '../public/production/inserts.js';
import { neuesDokument } from './support/face_dom.mjs';

test('face/limiter.js limAusgangDb: follows the input up to the ceiling, flat above', () => {
  assert.equal(limAusgangDb(-10, -1), -10);
  assert.equal(limAusgangDb(0, -1), -1);
  assert.equal(limAusgangDb(-1, -1), -1);
  assert.equal(limAusgangDb(3, -1), -1);
  assert.equal(limAusgangDb(-70, -60), -70);
});

test('face/limiter.js limKurve: bends at the ceiling; ceiling 0 sits flat at 0 dB; junk gives defaults and never NaN', () => {
  assert.deepEqual(limKurve(-12), [[-60, -60], [-12, -12], [6, -12]]);
  const null_ = limKurve(0);
  assert.deepEqual(null_, [[-60, -60], [0, 0], [6, 0]]);
  assert.deepEqual(limKurve(-60), [[-60, -60], [6, -60]], 'at the bottom of the display there is no bend to draw');
  assert.deepEqual(limDecke({}), -1);
  assert.equal(limDecke({ decke: NaN }), -1); assert.equal(limDecke({ decke: 5 }), 0); assert.equal(limDecke({ decke: -99 }), -60); assert.equal(limDecke({ decke: 'x' }), -1);
  for (const c of [undefined, NaN, Infinity, 'x', 4]) assert.ok(limKurve(c).every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), `ceiling ${c}`);
});

test('face/display.js: drawn equals the curve: the ceiling line and the flat part of the path sit at the ceiling level', () => {
  const dok = neuesDokument(), host = dok.createElement('div');
  const ds = baueAnzeige(host, { breite: 340, hoehe: 340, rand: 30, x: LIM_ACHSEN.x, y: LIM_ACHSEN.y, gitterX: [-60, 0], gitterY: [-60, 0] });
  for (const c of [-30, -9, -1, 0]) {
    const pfad = ds.pfad('fa-kurve', limKurve(c));
    const punkte = pfad.getAttribute('d').split(/ ?[ML]/).filter(Boolean).map((p) => p.split(',').map(Number));
    assert.equal(Math.abs(ds.wertY(punkte.at(-1)[1]) - c) < 0.05, true, `the flat end of the path is at ${c} dB`);
    assert.equal(Math.abs(ds.wertX(punkte[1][0]) - c) < 0.1, true, `the bend is at ${c} dB input`);
  }
});

test('face/limiter.js: the fixed line is pinned to ins_lim.h (look-ahead 1.5 ms, latency 86 samples)', () => {
  const h = fs.readFileSync(new URL('../../core/include/cypherdj/ins_lim.h', import.meta.url), 'utf8');
  assert.match(h, new RegExp(`vorhalt_ms = ${LIM_VORHALT_MS}f;`), 'look-ahead in the source');
  assert.match(h, new RegExp(`\\(${LIM_LATENZ_SAMPLES} at 48 kHz\\)`), 'latency in the source comment');
  assert.match(h, /echtspitze = true;/, 'true peak in the source');
  assert.equal(LIM_FESTZEILE, 'True peak · look-ahead 1.5 ms (fixed) · latency 86 samples');
});

const zaehlTakt = () => { const t = { an: [], aus: [] }; return { t, takt: { an: (fn) => { t.an.push(fn); return t.an.length; }, aus: (h) => t.aus.push(h) } }; };

test('face/limiter.js: two knobs (ceiling, release log), the text line, the gain-reduction meter and the level bars, no frame loop without a live callback, nothing left after close', () => {
  const dok = neuesDokument(), { t, takt } = zaehlTakt();
  const werte = Object.fromEntries(LIM_PARAMETER.map((q) => [q.name, q.vorgabe])), gesetzt = [], stand = { an: true };
  const q = { parameter: limParameterTabelle(LIM_PARAMETER), get: (n) => werte[n], set: (n, v) => { gesetzt.push([n, v]); return true; }, an: { get: () => stand.an, set() {} } };
  const tab = limParameterTabelle(LIM_PARAMETER);
  assert.deepEqual(Object.keys(tab).filter((n) => tab[n].log), ['abklingen']);
  let bau;
  const f = oeffneFace({ id: 'l', titel: 'LIMITER', wurzel: dok, takt, an: q.an, bauen: (inhalt) => (bau = baueLimiterFace(inhalt, q)) });
  assert.deepEqual(f.el.alles().filter((e) => e.klassen.has('fp-name')).map((e) => e.textContent), ['Ceiling', 'Release']);
  assert.equal(f.el.alles().find((e) => e.klassen.has('fa-lim-fest')).textContent, LIM_FESTZEILE);
  assert.equal(gesetzt.length, 0, 'building writes nothing');
  assert.equal(t.an.length, 0, 'no frame loop: this test passes no live callback to the frame');
  assert.ok(bau.meterPlatz && bau.meterPlatz.hidden === false && bau.meterPlatz.finde('fa-meter').length === 1, 'the gain-reduction meter (T8) sits in its place');
  assert.equal(f.el.alles().filter((e) => e.klassen.has('fa-pegel-spalte')).length, 2, 'the input and output level bars (T9)');
  assert.equal(f.el.alles().find((e) => e.klassen.has('fa-decke')) !== undefined, true, 'the ceiling line');
  assert.match(f.el.alles().filter((e) => e.klassen.has('fa-marke'))[0].textContent, /^CEILING −1\.0 dB$/);
  werte.decke = -9; f.aktualisiere();
  assert.match(f.el.alles().filter((e) => e.klassen.has('fa-marke'))[0].textContent, /^CEILING −9\.0 dB$/);
  stand.an = false; f.aktualisiere();
  assert.equal(f.el.alles().find((e) => e.klassen.has('fa-lim')).klassen.has('fa-aus'), true);
  f.schliesse();
  assert.equal(t.an.length, 0); assert.equal(t.aus.length, 0);
  assert.equal(dok.zaehler.add.keydown, dok.zaehler.remove.keydown); assert.equal(dok.hoerer.length, 0);
});

test('face/limiter.js: live() puts the readings into the meter (3 dB of 12) and the level bars; a bypassed stage and a missing reading show dashes; live() reports a change', () => {
  const dok = neuesDokument(), { takt } = zaehlTakt();
  const werte = Object.fromEntries(LIM_PARAMETER.map((q) => [q.name, q.vorgabe])), stand = { an: true, gr: 3, pegel: { ein: -3, aus: -6 } };
  const q = { parameter: limParameterTabelle(LIM_PARAMETER), get: (n) => werte[n], set: () => true, an: { get: () => stand.an, set() {} }, gr: () => stand.gr, pegel: () => stand.pegel };
  let bau;
  const f = oeffneFace({ id: 'l', titel: 'LIMITER', wurzel: dok, takt, an: q.an, bauen: (inhalt) => (bau = baueLimiterFace(inhalt, q)), live: (z) => bau.live(z) });
  const texte = () => f.el.alles().filter((e) => e.klassen.has('fa-meter-text')).map((e) => e.textContent);
  assert.deepEqual(texte(), ['-3.0 dB', '-6.0 dB', '3.0 dB'], 'in, out, gain reduction');
  assert.equal(bau.live(100), false, 'nothing changed since the build');
  stand.gr = 6; assert.equal(bau.live(116), true); assert.equal(texte()[2], '6.0 dB');
  stand.pegel = { ein: -200, aus: -200 }; assert.equal(bau.live(132), true);
  assert.deepEqual(texte(), ['–', '–', '6.0 dB'], 'silence: dashes');
  stand.pegel = null; stand.gr = null; bau.live(148);
  assert.deepEqual(texte(), ['–', '–', '–']);
  stand.gr = 6; stand.pegel = { ein: -3, aus: -6 }; stand.an = false; bau.live(164);
  assert.deepEqual(texte(), ['–', '–', '–'], 'bypassed: dashes although readings arrive');
  f.schliesse();
});
