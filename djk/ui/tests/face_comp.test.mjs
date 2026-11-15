// Device faces, compressor: the curve maths is pinned to comp_dsp by the golden table (the same CSV the Rust test comp_dsp/tests/komp.rs::kennlinie_golden_tabelle
// recomputes from the real DSP functions), the drawing equals the DSP curve, and a closed face costs nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KOMP_ACHSEN, kompEinstellung, kompAusgangDb, kompKurve, kompGrDb } from '../public/face/comp.js';
import { baueAnzeige } from '../public/face/display.js';
import { KOMP_PARAMETER } from '../public/production/inserts.js';
import { neuesDokument } from './support/face_dom.mjs';

const CSV = new URL('../../instruments/comp_dsp/tests/data/kennlinie.csv', import.meta.url);
const zeilen = () => {
  const [kopf, ...rest] = fs.readFileSync(CSV, 'utf8').trim().split('\n');
  assert.equal(kopf, 'x_db,schwelle_db,ratio,knie_db,makeup_db,mix,y_db');
  return rest.map((z) => z.split(',').map(Number));
};
const einst = (v) => ({ schwelle: v[1], ratio: v[2], knie: v[3], makeup: v[4], mix: v[5] });

test('face/comp.js: every row of the golden table (Rust side) equals kompAusgangDb within 1e-9', () => {
  const rows = zeilen();
  assert.ok(rows.length >= 24, `only ${rows.length} rows`);
  for (const v of rows) assert.ok(Math.abs(kompAusgangDb(v[0], kompEinstellung(einst(v))) - v[6]) < 1e-9, `row ${v.join(',')}`);
});

test('face/comp.js: named values of the curve', () => {
  const e = { schwelle: -20, ratio: 4, knie: 10, makeup: 0, mix: 1 };
  assert.equal(kompAusgangDb(-40, e), -40);
  assert.ok(Math.abs(kompAusgangDb(-20, e) - -20.9375) < 1e-9);
  assert.ok(Math.abs(kompAusgangDb(-15, e) - -18.75) < 1e-9);
  assert.ok(Math.abs(kompAusgangDb(0, e) - -15) < 1e-9);
  const m = kompAusgangDb(-10, { schwelle: -30, ratio: 10, knie: 0, makeup: 12, mix: 0.4 });
  assert.equal(m.toFixed(4), '-11.9330');
  for (const x of [-60, -33, -10, 0]) assert.equal(kompAusgangDb(x, { ...e, mix: 0 }), x, 'mix 0 gives the input level');
  assert.ok(Math.abs(kompGrDb(0, e) - 15) < 1e-9);
  assert.equal(kompGrDb(-50, e), 0);
});

test('face/comp.js: kompKurve covers -60..0 dB, all finite; kompEinstellung defaults and clamps', () => {
  const k = kompKurve(kompEinstellung({}));
  assert.equal(k.length, 121);
  assert.equal(k[0][0], -60); assert.equal(k.at(-1)[0], 0);
  assert.ok(k.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  const vorgabe = Object.fromEntries(['schwelle', 'ratio', 'knie', 'makeup', 'mix'].map((n) => [n, KOMP_PARAMETER.find((q) => q.name === n).vorgabe]));
  assert.deepEqual(kompEinstellung({}), vorgabe);
  assert.deepEqual(kompEinstellung({ ratio: 0.2, schwelle: NaN, knie: -4 }), { ...vorgabe, ratio: 1, schwelle: -18, knie: 0 });
  assert.equal(kompEinstellung({ ratio: 99, mix: 7, makeup: -3 }).ratio, 20);
  assert.equal(kompEinstellung({ ratio: 99, mix: 7, makeup: -3 }).mix, 1);
  assert.equal(kompEinstellung({ ratio: 99, mix: 7, makeup: -3 }).makeup, 0);
  assert.ok(kompKurve(kompEinstellung({ ratio: 'x', knie: Infinity })).every(([, y]) => Number.isFinite(y)), 'junk in an old project never gives NaN');
});

test('face/display.js: drawn equals DSP: the path of kompKurve converts back to the CSV level within 0.01 dB', () => {
  const dok = neuesDokument(), host = dok.createElement('div');
  const ds = baueAnzeige(host, { breite: 400, hoehe: 270, rand: 30, x: KOMP_ACHSEN.x, y: KOMP_ACHSEN.y, gitterX: [-60, -30, 0], gitterY: [-60, 0, 24] });
  for (const v of zeilen().filter((r) => r[0] <= 0 && r[6] <= 24)) {
    const e = kompEinstellung(einst(v));
    const pfad = ds.pfad('fa-kurve', kompKurve(e));
    const punkte = pfad.getAttribute('d').split(/ ?[ML]/).filter(Boolean).map((p) => p.split(',').map(Number));
    assert.equal(punkte.length, 121);
    const i = Math.round((v[0] + 60) / 0.5), [pxX, pxY] = punkte[i];
    assert.ok(Math.abs(ds.wertX(pxX) - v[0]) < 0.2, `x of ${v}`);   // one decimal of a pixel = 0.15 dB of input level here
    // the axis pair is exact; the path text carries one decimal of a pixel (0.05 px = 0.02 dB here), so the text is checked to 0.05 dB
    assert.ok(Math.abs(ds.wertY(ds.py(v[6])) - v[6]) < 0.01, `axis round trip of ${v[6]}`);
    assert.ok(Math.abs(ds.wertY(pxY) - v[6]) < 0.05, `y of ${v}: ${ds.wertY(pxY)} vs ${v[6]}`);
    pfad.remove();
  }
});

test('face/comp.js: the knob plate has the eight knobs in two rows of four, log scales for ratio, attack, release', async () => {
  const { baueKompFace, kompParameterTabelle } = await import('../public/face/comp.js');
  const dok = neuesDokument(), host = dok.createElement('div');
  const t = kompParameterTabelle(KOMP_PARAMETER);
  assert.deepEqual(Object.keys(t).filter((n) => t[n].log), ['ratio', 'attack', 'release']);
  const werte = Object.fromEntries(KOMP_PARAMETER.map((q) => [q.name, q.vorgabe]));
  const gesetzt = [];
  const f = baueKompFace(host, { parameter: t, get: (n) => werte[n], set: (n, v) => gesetzt.push([n, v]), knie: 'regler', an: { get: () => true, set() {} }, schluessel: { text: () => '' } });
  const sektionen = host.alles().filter((e) => e.tag === 'section');
  assert.deepEqual(sektionen.map((s) => s.finde('fp-zelle').length), [4, 4]);
  assert.deepEqual(host.alles().filter((e) => e.klassen.has('fp-name')).map((e) => e.textContent), ['Threshold', 'Ratio', 'Knee', 'Attack', 'Release', 'Makeup', 'Mix', 'Key high-pass']);
  assert.equal(typeof f.aktualisiere, 'function'); assert.equal(typeof f.live, 'function');
  assert.equal(gesetzt.length, 0, 'building the face writes nothing');
});

// ---- T2: dimming, the meter and the cost of a closed face (D5)
import { kompDimmung, baueKompFace, kompParameterTabelle } from '../public/face/comp.js';
import { oeffneFace } from '../public/face/frame.js';

test('face/comp.js kompDimmung: a bypassed stage and mix 0 dim the display', () => {
  assert.equal(kompDimmung(true, 1), false);
  assert.equal(kompDimmung(false, 1), true);
  assert.equal(kompDimmung(true, 0), true);
  assert.equal(kompDimmung(true, 0.01), false);
  assert.equal(kompDimmung(true, NaN), true, 'junk is not a working stage');
});

function quelleDouble(stand) {
  const werte = Object.fromEntries(KOMP_PARAMETER.map((q) => [q.name, q.vorgabe]));
  const q = { parameter: kompParameterTabelle(KOMP_PARAMETER), get: (n) => werte[n], set: () => {}, knie: 'regler', werte, grCalls: 0, schluessel: { text: () => 'KEY: Own signal' },
    an: { get: () => stand.an, set: (b) => { stand.an = b; } }, gr: () => { q.grCalls++; return stand.gr; } };
  return q;
}
const zaehlTakt = () => { const t = { an: [], aus: [] }; return { t, takt: { an: (fn) => { t.an.push(fn); return t.an.length; }, aus: (h) => t.aus.push(h) } }; };

test('face/comp.js: the real builder through the frame: the reading goes into the meter, bypass and mix 0 show a dash, and a closed face makes no further call', () => {
  const dok = neuesDokument(), { t, takt } = zaehlTakt(), stand = { an: true, gr: 6 };
  const q = quelleDouble(stand);
  let bau;
  const f = oeffneFace({ id: 'k', titel: 'COMPRESSOR', wurzel: dok, takt, bauen: (inhalt) => (bau = baueKompFace(inhalt, q)), live: (z) => bau.live(z) });
  const text = () => f.el.alles().filter((e) => e.klassen.has('fa-meter-text')).at(-1).textContent, komp = f.el.alles().find((e) => e.klassen.has('fa-komp'));
  assert.equal(t.an.length, 1, 'one scheduled frame while open');
  t.an[0](100);
  assert.equal(text(), '6.0 dB'); assert.equal(komp.klassen.has('fa-aus'), false);
  assert.equal(f.el.alles().filter((e) => e.klassen.has('fa-meter-balken')).at(-1).style.height, '25.00%');
  stand.an = false; t.an[1](116);
  assert.equal(text(), '–', 'bypassed: a dash even though a reading arrives'); assert.equal(komp.klassen.has('fa-aus'), true);
  stand.an = true; q.werte.mix = 0; f.aktualisiere();
  assert.equal(text(), '–', 'mix 0: a dash'); assert.equal(komp.klassen.has('fa-aus'), true);
  q.werte.mix = 1; stand.gr = null; t.an[2](132);
  assert.equal(text(), '–', 'no reading: a dash'); assert.equal(komp.klassen.has('fa-aus'), false);
  assert.equal(f.el.alles().find((e) => e.klassen.has('fa-komp-schluessel-chip')).textContent, 'KEY: Own signal');
  // closing: takt.an and takt.aus balance, no live call and no source read afterwards
  const an = t.an.length, calls = q.grCalls, stale = t.an.at(-1);
  f.schliesse();
  assert.equal(t.aus.length, 1); assert.equal(t.aus[0], t.an.length, 'cancelled the last scheduled frame');
  stale(200);
  assert.equal(t.an.length, an, 'no frame scheduled after close'); assert.equal(q.grCalls, calls, 'no read of the source after close');
  assert.equal(dok.zaehler.add.keydown, dok.zaehler.remove.keydown); assert.equal(dok.hoerer.length, 0);
});

// ---- T9: input and output level bars and the operating point NOW
import { kompPegelAufnehmen } from '../public/face/comp.js';

test('face/comp.js kompPegelAufnehmen: only komp/<channel> with finite levels is taken, everything else is refused', () => {
  const s = {};
  assert.equal(kompPegelAufnehmen(s, { kanal: 'komp/erz/1', ein_db: -12, aus_db: -15.2 }, 1000), true);
  assert.deepEqual(s['erz/1'], { ein: -12, aus: -15.2, t: 1000 });
  assert.equal(kompPegelAufnehmen(s, { kanal: 'komp/deck/4', ein_db: -200, aus_db: -200 }, 1000), true, 'silence is a valid report');
  for (const f of [{ kanal: 'ins/komp/1', ein_db: -12, aus_db: -15 }, { kanal: 'komp/bus/1', ein_db: -12, aus_db: -15 }, { kanal: 'komp/erz/1', ein_db: NaN, aus_db: -15 },
    { kanal: 'komp/erz/2', ein_db: '1', aus_db: -15 }, { kanal: 'komp/erz/2', ein_db: -12 }, null]) assert.equal(kompPegelAufnehmen(s, f, 1000), false, JSON.stringify(f));
  assert.equal(s['erz/2'], undefined);
});

test('face/comp.js: the level bars and the NOW dot follow the readings; -200 and a bypassed stage show dashes and hide the dot; the dot sits at (input, output)', () => {
  const dok = neuesDokument(), { takt } = zaehlTakt(), stand = { an: true, gr: 3, pegel: { ein: -12, aus: -15.2 } };
  const q = quelleDouble(stand);
  q.pegel = () => stand.pegel;
  let bau;
  const f = oeffneFace({ id: 'k', titel: 'COMPRESSOR', wurzel: dok, takt, bauen: (inhalt) => (bau = baueKompFace(inhalt, q)), live: (z) => bau.live(z) });
  const alle = () => f.el.alles();
  const texte = () => alle().filter((e) => e.klassen.has('fa-meter-text')).map((e) => e.textContent);
  const punkt = () => alle().find((e) => e.klassen.has('fa-jetzt'));
  assert.equal(alle().filter((e) => e.klassen.has('fa-pegel-spalte')).length, 2, 'two bars');
  assert.deepEqual(texte(), ['-12.0 dB', '-15.2 dB', '3.0 dB'], 'input, output, gain reduction');
  const p = punkt();
  assert.equal(p.attr.visibility, 'visible');
  // the plot area: x -60..0 and y -60..24; the dot at (-12, -15.2) lies where the curve plane says
  const ds = baueAnzeige(dok.createElement('div'), { breite: 400, hoehe: 252, rand: 30, x: KOMP_ACHSEN.x, y: KOMP_ACHSEN.y, gitterX: [], gitterY: [] });
  assert.equal(p.attr.cx, ds.px(-12).toFixed(1)); assert.equal(p.attr.cy, ds.py(-15.2).toFixed(1));
  assert.equal(alle().find((e) => e.klassen.has('fa-jetzt-text')).textContent, 'NOW');
  stand.pegel = { ein: -200, aus: -200 }; bau.live(100);
  assert.deepEqual(texte(), ['–', '–', '3.0 dB'], 'silence: dashes');
  assert.equal(punkt().attr.visibility, 'hidden', 'no dot for silence (-200 would sit on the corner)');
  stand.pegel = { ein: -12, aus: -200 }; bau.live(116);
  assert.deepEqual(texte(), ['-12.0 dB', '–', '3.0 dB'], 'one bar can be empty on its own');
  assert.equal(punkt().attr.visibility, 'hidden', 'the dot needs both');
  stand.pegel = { ein: 3, aus: 3 }; bau.live(132);   // above the plot: the dot stays inside the plot
  assert.equal(punkt().attr.cx, ds.px(0).toFixed(1)); assert.equal(punkt().attr.visibility, 'visible');
  stand.pegel = null; bau.live(148);
  assert.deepEqual(texte(), ['–', '–', '3.0 dB']); assert.equal(punkt().attr.visibility, 'hidden', 'no report: no dot');
  stand.pegel = { ein: -12, aus: -15 }; stand.an = false; bau.live(164);
  assert.deepEqual(texte(), ['–', '–', '–'], 'bypassed: nothing although reports arrive'); assert.equal(punkt().attr.visibility, 'hidden');
  f.schliesse();
});
