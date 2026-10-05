// Studio S7: Spurbänder (reine Funktionen)
import test from 'node:test';
import assert from 'node:assert/strict';
import { baender, spurName, setzePunkt, verschiebePunkt, loeschePunkt, kuerze, entwurfGueltig, punkteZuFahrten, vorgabePunkte } from '../oeffentlich/spurband.js';
import { pruefeSpur } from '../spur.ts';

const FAHRBAR = new Set(['a_filter1_cutoff']);
const fader = (s) => baender(s).find((b) => b.schluessel === 'fader');

test('S7 T2: Fader-Band je Strom, Spurname passt auf SPUR_NAME', () => {
  assert.deepEqual([1, 2, 3].map((s) => fader(s).ziel), ['erz/1/fader', 'erz/2/fader', 'erz/3/fader']);
  assert.deepEqual([fader(2).min, fader(2).max, fader(2).aus], [-60, 0, -200]);
  assert.equal(spurName(2, 'fader'), 'band-2-fader');
});

test('S7 T2: Punkte setzen, verschieben (bleibt zwischen Nachbarn), löschen (mindestens einer bleibt)', () => {
  let p = vorgabePunkte(fader(2), 8);
  assert.deepEqual(p, [{ takt: 1, wert: 0, form: 'gerade' }, { takt: 9, wert: 0, form: 'gerade' }]);
  p = setzePunkt(p, 5, -30);
  assert.deepEqual(p.map((x) => x.takt), [1, 5, 9]);
  assert.deepEqual(setzePunkt(p, 5, -10).map((x) => x.wert), [0, -10, 0], 'gleicher Takt ersetzt den Wert');
  assert.deepEqual(verschiebePunkt(p, 1, 12, -20, 9)[1], { takt: 8, wert: -20, form: 'gerade' }, 'höchstens Nachbar − 1');
  assert.deepEqual(verschiebePunkt(p, 1, 0, -20, 9)[1].takt, 2, 'mindestens Nachbar + 1');
  assert.equal(verschiebePunkt([{ takt: 1, wert: 0, form: 'gerade' }], 0, 40, 0, 9)[0].takt, 9, 'letzter Punkt höchstens Länge + 1');
  assert.deepEqual(kuerze(p, 4).map((x) => x.takt), [1, 5], 'kürzer: Punkte über Länge+1 fallen');
  assert.deepEqual(kuerze([{ takt: 7, wert: -20, form: 'gerade' }], 4), [{ takt: 5, wert: -20, form: 'gerade' }], 'nie leer: der erste Punkt rückt an Länge+1');
  assert.equal(loeschePunkt(p, 1).length, 2);
  assert.equal(loeschePunkt([p[0]], 0).length, 1);
});

test('S7 T2: Punkte → Fahrten (gerade), Kern nimmt sie an (pruefeSpur)', () => {
  const b = fader(2);
  const p = [{ takt: 1, wert: 0, form: 'gerade' }, { takt: 5, wert: -30, form: 'gerade' }, { takt: 9, wert: -30, form: 'gerade' }];
  const f = punkteZuFahrten(b, p);
  assert.deepEqual(f, [
    { ziel: 'erz/2/fader', ab_takt: 1, nach: 0 },
    { ziel: 'erz/2/fader', ab_takt: 1, takte: 4, nach: -30, form: 'linear' },
    { ziel: 'erz/2/fader', ab_takt: 5, takte: 4, nach: -30, form: 'linear' },
  ]);
  assert.ok('spur' in pruefeSpur({ name: spurName(2, 'fader'), fahrten: f }, FAHRBAR));
});

test('S7 T2: Fader unten = aus: Rampe bis −60, dann Setzen −200; aus unten heraus erst −60', () => {
  const b = fader(2);
  const ab = punkteZuFahrten(b, [{ takt: 1, wert: 0, form: 'gerade' }, { takt: 5, wert: -60, form: 'gerade' }]);
  assert.deepEqual(ab.slice(1), [
    { ziel: 'erz/2/fader', ab_takt: 1, takte: 4, nach: -60, form: 'linear' },
    { ziel: 'erz/2/fader', ab_takt: 5, nach: -200 },
  ]);
  const auf = punkteZuFahrten(b, [{ takt: 1, wert: -60, form: 'gerade' }, { takt: 9, wert: 0, form: 'gerade' }]);
  assert.deepEqual(auf[0], { ziel: 'erz/2/fader', ab_takt: 1, nach: -60 }, 'Rampe folgt: Start −60, nicht −200');
  const nur = punkteZuFahrten(b, [{ takt: 1, wert: -60, form: 'gerade' }]);
  assert.deepEqual(nur, [{ ziel: 'erz/2/fader', ab_takt: 1, nach: -200 }]);
});

test('S7 T2: Entwurf aus dem Speicher nur gültig mit mindestens einem Punkt', () => {
  const L = [4, 8, 16, 32];
  assert.equal(entwurfGueltig({ laenge: 8, punkte: vorgabePunkte(fader(2), 8) }, L, fader(2)), true);
  for (const x of [null, { laenge: 4, punkte: [] }, { laenge: 5, punkte: [{ takt: 1, wert: 0, form: 'gerade' }] },
    { laenge: 4, punkte: [{ takt: 9, wert: 0, form: 'gerade' }] }, { laenge: 4, punkte: [{ takt: 2, wert: 0, form: 'gerade' }, { takt: 2, wert: 0, form: 'gerade' }] }]) {
    assert.equal(entwurfGueltig(x, L, fader(2)), false, JSON.stringify(x));
  }
});

import { raster, punktBei } from '../oeffentlich/spurband.js';

test('S7 T3: Raster: x → Takt (gerundet, 1..Länge+1), y → Wert (oben max, unten min, geklemmt), und zurück', () => {
  const r = raster({ min: -60, max: 0 }, 8, 800, 100);   // 8 Takte auf 800 px: 100 px je Takt
  assert.equal(r.x(1), 0); assert.equal(r.x(9), 800);
  assert.equal(r.takt(149), 2); assert.equal(r.takt(151), 3);
  assert.equal(r.takt(-50), 1); assert.equal(r.takt(5000), 9);
  assert.equal(r.y(0), 0); assert.equal(r.y(-60), 100);
  assert.equal(r.wert(50), -30); assert.equal(r.wert(-10), 0); assert.equal(r.wert(130), -60);
  assert.equal(r.wert(96), -60, 'untere 5 % rasten auf min (Fader: aus ist per Klick erreichbar)');
  assert.equal(r.wert(4), 0, 'obere 5 % rasten auf max');
});

test('S7 T3: punktBei findet den Punkt unter dem Zeiger (Trefferradius), sonst null', () => {
  const q = raster({ min: -60, max: 0 }, 8, 800, 100);
  const p = [{ takt: 1, wert: 0 }, { takt: 5, wert: -30 }];
  assert.equal(punktBei(p, q, 403, 52, 8), 1);
  assert.equal(punktBei(p, q, 420, 50, 8), null);
  assert.equal(punktBei(p, q, 2, 3, 8), 0);
});

import { griffBei } from '../oeffentlich/spurband.js';

test('S7 Review F6: Entwurf mit Wert ausserhalb des Bandes ist ungueltig', () => {
  const L = [4, 8, 16, 32], b = fader(2);
  const mit = (wert) => ({ laenge: 8, punkte: [{ takt: 1, wert, form: 'gerade' }] });
  assert.equal(entwurfGueltig(mit(-60), L, b), true); assert.equal(entwurfGueltig(mit(0), L, b), true);
  for (const w of [-61, 5, -200, 1e9]) assert.equal(entwurfGueltig(mit(w), L, b), false, String(w));
});

test('S7 Review F2: Raster mit Innenrand (x und y samt Umkehr, Einrasten auf der Innenfläche); rand 0 wie T3', () => {
  const r = raster({ min: -60, max: 0 }, 8, 816, 116, 8);   // Innenfläche 800 x 100
  assert.equal(r.x(1), 8); assert.equal(r.x(9), 808);
  assert.equal(r.takt(8 + 149), 2); assert.equal(r.takt(8 + 151), 3);
  assert.equal(r.takt(0), 1); assert.equal(r.takt(5000), 9);
  assert.equal(r.y(0), 8); assert.equal(r.y(-60), 108);
  assert.equal(r.wert(8 + 50), -30); assert.equal(r.wert(2), 0); assert.equal(r.wert(115), -60);
  assert.equal(r.wert(8 + 96), -60, 'untere 5 % der Innenfläche rasten auf min');
  assert.equal(r.wert(8 + 4), 0, 'obere 5 % der Innenfläche rasten auf max');
  assert.equal(r.wert(8 + 93) > -60, true, 'darüber kein Einrasten');
  for (const w of [-45, -30, -12]) assert.ok(Math.abs(r.wert(r.y(w)) - w) < 1e-9, 'y und wert sind Umkehrungen ' + w);
  for (const t of [1, 4, 9]) assert.equal(r.takt(r.x(t)), t, 'x und takt sind Umkehrungen ' + t);
});

test('S7 Review F1: griffBei greift nach Radius, dann nach Spalte; freie Spalte setzt UND greift; nie ein stiller Wert', () => {
  const q = raster({ min: -60, max: 0 }, 8, 800, 100);   // 100 px je Takt
  const p = [{ takt: 1, wert: 0, form: 'gerade' }, { takt: 5, wert: -30, form: 'gerade' }, { takt: 9, wert: 0, form: 'gerade' }];
  assert.deepEqual(griffBei(p, q, 403, 52, 10), { i: 1, neu: false }, 'im Radius');
  assert.deepEqual(griffBei(p, q, 406, 5, 10), { i: 1, neu: false }, '6 px daneben, weit oben: Spalte 5 ist belegt, Punkt greifen');
  assert.deepEqual(griffBei(p, q, 793, 90, 10), { i: 2, neu: false }, 'Spalte des letzten Punkts');
  assert.deepEqual(griffBei(p, q, 250, 40, 10), { i: 1, neu: true, takt: 4 }, 'freie Spalte 4: neuer Punkt auf Index 1 (zwischen Takt 1 und 5)');
  assert.deepEqual(griffBei(p, q, 100, 40, 10), { i: 1, neu: true, takt: 2 }, 'freie Spalte 2');
  assert.deepEqual(griffBei([p[0]], q, 900, 40, 10), { i: 1, neu: true, takt: 9 }, 'Ende');
});

import { zugStart, zugBewegung } from '../oeffentlich/spurband.js';

test('S7 Rereview R2: Ziehen relativ zum Griff, erst ab 3 px; neuer Punkt folgt dem Zeiger direkt', () => {
  const q = raster({ min: -60, max: 0 }, 8, 800, 100);   // y(-30) = 50, x(5) = 400
  const p = [{ takt: 1, wert: 0, form: 'gerade' }, { takt: 5, wert: -30, form: 'gerade' }, { takt: 9, wert: 0, form: 'gerade' }];
  // Griff 40 px UEBER dem Punkt (Spalte 5): y = 10; 1 px Zucken darf nichts aendern
  const g = griffBei(p, q, 402, 10, 10); assert.deepEqual(g, { i: 1, neu: false });
  const z0 = zugStart(p, q, 402, 10, g);
  const a = zugBewegung(z0, p, q, 403, 11, 9);
  assert.equal(a.punkte, p, 'unter 3 px: dieselbe Liste'); assert.equal(a.zug.aktiv, false);
  // ab 3 px: relativ, der Versatz bleibt (Zeiger 20 px tiefer -> Punkt 20 px tiefer, nicht auf den Zeiger)
  const b = zugBewegung(z0, p, q, 402, 30, 9);
  assert.equal(b.zug.aktiv, true);
  assert.deepEqual(b.punkte[1], { takt: 5, wert: -42, form: 'gerade' }, 'y 50 + 20 = 70 -> -42 dB');
  // einmal aktiv, bleibt aktiv: Zeiger zurueck am Griffpunkt (unter 3 px Abstand) folgt trotzdem
  const c = zugBewegung(b.zug, b.punkte, q, 402, 10, 9);
  assert.deepEqual(c.punkte[1], { takt: 5, wert: -30, form: 'gerade' }, 'Zeiger wieder am Griffpunkt: Wert wie am Anfang');
  // waagerecht relativ: 2 Spalten nach rechts
  const d = zugBewegung(z0, p, q, 602, 10, 9);
  assert.equal(d.punkte[1].takt, 7); assert.equal(d.punkte[1].wert, -30);
  // neuer Punkt (freie Spalte): folgt dem Zeiger direkt, auch unter 3 px
  const pn = [p[0], { takt: 4, wert: -20, form: 'gerade' }, p[1], p[2]];
  const zn = zugStart(pn, q, 300, 33, { i: 1, neu: true, takt: 4 });
  assert.equal(zn.aktiv, true);
  assert.equal(zugBewegung(zn, pn, q, 301, 60, 9).punkte[1].wert, -36, 'absolut auf den Zeiger: y 60 -> -36 dB');
});

test('S7 T6: Formen am Kern: rund → form s, Sprung → Setzen am Zieltakt, Kern nimmt es an', () => {
  const b = baender(2).find((x) => x.schluessel === 'fader');
  const p = [{ takt: 1, wert: 0, form: 'gerade' }, { takt: 3, wert: -20, form: 'rund' }, { takt: 5, wert: -40, form: 'sprung' },
    { takt: 9, wert: 0, form: 'gerade' }];
  const f = punkteZuFahrten(b, p);
  assert.deepEqual(f, [
    { ziel: 'erz/2/fader', ab_takt: 1, nach: 0 },
    { ziel: 'erz/2/fader', ab_takt: 1, takte: 2, nach: -20, form: 's' },
    { ziel: 'erz/2/fader', ab_takt: 5, nach: -40 },
    { ziel: 'erz/2/fader', ab_takt: 5, takte: 4, nach: 0, form: 'linear' },
  ]);
  assert.ok('spur' in pruefeSpur({ name: 'band-2-fader', fahrten: f }, FAHRBAR));
});

import { naechsteForm, segmentBei, pfad, segmentFuerKlick, setzeForm } from '../oeffentlich/spurband.js';

test('S7 T7: Form-Zyklus, Segment unter x, Pfad je Form', () => {
  assert.deepEqual(['gerade', 'rund', 'sprung'].map(naechsteForm), ['rund', 'sprung', 'gerade']);
  const p = [{ takt: 1, wert: 0, form: 'gerade' }, { takt: 5, wert: -60, form: 'sprung' }];
  const q = raster({ min: -60, max: 0 }, 8, 800, 100);
  assert.equal(segmentBei(p, q, 250), 1, 'x zwischen Punkt 0 und 1 → Segment 1 (Form liegt an Punkt 1)');
  assert.equal(segmentBei(p, q, 700), null, 'hinter dem letzten Punkt kein Segment');
  assert.equal(pfad(p, q, 800), 'M 0 0 L 400 0 L 400 100 L 800 100', 'Sprung: waagerecht, dann senkrecht');
  const rund = pfad([{ takt: 1, wert: 0 }, { takt: 5, wert: -60, form: 'rund' }], q, 800);
  assert.match(rund, /^M 0 0 C 200 0 200 100 400 100/, 'rund: Bezier mit waagerechten Tangenten (S-Form)');
});

test('S7 T7 (Scheibe-1-Ansicht): Pfad auf der Innenfläche mit Rand, setzeForm, Zyklus unbekannter Form', () => {
  const q = raster({ min: -60, max: 0 }, 8, 816, 116, 8);   // Innenfläche 800 x 100, Rand 8
  const p = [{ takt: 1, wert: 0, form: 'gerade' }, { takt: 3, wert: -30, form: 'rund' }, { takt: 5, wert: -10, form: 'sprung' }];
  const d = pfad(p, q, 816 - 8);   // der Auslauf endet an der Innenfläche, nicht am Rand des SVG
  assert.equal(d, 'M 8 8 C 108 8 108 58 208 58 L 408 58 L 408 24.67 L 808 24.67', d);
  assert.ok(!/ 816 /.test(d), 'nichts wird über den Innenrand hinaus gezeichnet');
  assert.deepEqual(setzeForm(p, 1, 'sprung').map((x) => x.form), ['gerade', 'sprung', 'sprung']);
  assert.equal(p[1].form, 'rund', 'Eingabe bleibt unverändert');
  assert.equal(naechsteForm(undefined), 'gerade'); assert.equal(naechsteForm('quatsch'), 'gerade');
});

test('S7 T7: Rechtsklick trifft das Segment in den Punkt (Radius) oder das Segment unter x, sonst nichts', () => {
  const q = raster({ min: -60, max: 0 }, 8, 800, 100);   // x(1)=0, x(3)=200, x(5)=400
  const p = [{ takt: 1, wert: 0, form: 'gerade' }, { takt: 3, wert: -30, form: 'rund' }, { takt: 5, wert: -10, form: 'sprung' }];
  assert.equal(segmentFuerKlick(p, q, 203, 52, 10), 1, 'auf Punkt 1: das Segment, das IN ihn führt');
  assert.equal(segmentFuerKlick(p, q, 401, 17, 10), 2, 'auf dem letzten Punkt: das Segment in ihn');
  assert.equal(segmentFuerKlick(p, q, 300, 90, 10), 2, 'zwischen Punkt 1 und 2, weit vom Punkt: Segment unter x');
  assert.equal(segmentFuerKlick(p, q, 100, 90, 10), 1, 'zwischen Punkt 0 und 1');
  assert.equal(segmentFuerKlick(p, q, 2, 3, 10), 1, 'auf Punkt 0 (kein Segment führt hinein): das Segment unter x, hier das erste');
  assert.equal(segmentFuerKlick(p, q, 600, 50, 10), null, 'hinter dem letzten Punkt: nichts');
  assert.equal(segmentFuerKlick([p[0]], q, 100, 50, 10), null, 'ein einzelner Punkt hat kein Segment');
});

test('S7 T9: Bänder je Strom: DRUMS Fader+Filter, BASS/MELODY zusätzlich Cutoff am eigenen Wirt', () => {
  assert.deepEqual(baender(1).map((b) => b.schluessel), ['fader', 'filter']);
  assert.deepEqual(baender(2).map((b) => b.ziel), ['erz/2/fader', 'erz/2/filter', 'wirt:bass/a_filter1_cutoff']);
  assert.equal(baender(3).at(-1).ziel, 'wirt:melodie/a_filter1_cutoff');
  const f = baender(2)[1];
  assert.deepEqual([f.min, f.max, f.vorgabe, f.aus], [-1, 1, 0, undefined]);
});

test('S7 T9: Wirt-Band: Rampe trägt von, kein Setzen vor einer Rampe, Sprung vor Rampe gefaltet', () => {
  const c = baender(2).at(-1);
  const p = [{ takt: 1, wert: -40, form: 'gerade' }, { takt: 5, wert: 0, form: 'rund' }, { takt: 7, wert: 20, form: 'sprung' },
    { takt: 9, wert: -40, form: 'gerade' }];
  const f = punkteZuFahrten(c, p);
  assert.deepEqual(f, [
    { ziel: c.ziel, ab_takt: 1, takte: 4, nach: 0, form: 's', von: -40 },
    { ziel: c.ziel, ab_takt: 7, takte: 2, nach: -40, form: 'linear', von: 20 },
  ]);
  assert.ok('spur' in pruefeSpur({ name: 'band-2-cutoff', fahrten: f }, FAHRBAR));
  const nurSprung = punkteZuFahrten(c, [{ takt: 1, wert: -40, form: 'gerade' }, { takt: 3, wert: 10, form: 'sprung' }]);
  assert.deepEqual(nurSprung, [{ ziel: c.ziel, ab_takt: 1, nach: -40 }, { ziel: c.ziel, ab_takt: 3, nach: 10 }]);
});

test('S7 Slice-2-Review B1: die senkrechte Stufe eines Sprungs gehört zum Segment in den Sprung-Punkt (±4 px um die Spalte)', () => {
  const q = raster({ min: -60, max: 0 }, 8, 800, 100);   // x(1)=0 x(5)=400 x(9)=800; y(0)=0 y(-40)=66.67
  const p = [{ takt: 1, wert: 0, form: 'gerade' }, { takt: 5, wert: -40, form: 'sprung' }, { takt: 9, wert: 0, form: 'gerade' }];
  const y = 30;   // mittig auf der Stufe, weit von jedem Punkt (Radius 10)
  assert.equal(segmentFuerKlick(p, q, 400, y, 10), 1, 'genau auf der Spalte');
  assert.equal(segmentFuerKlick(p, q, 398.5, y, 10), 1, 'knapp links');
  assert.equal(segmentFuerKlick(p, q, 401.5, y, 10), 1, 'knapp rechts (bisher: das NÄCHSTE Segment)');
  assert.equal(segmentFuerKlick(p, q, 402.5, y, 10), 1, '2,5 px rechts');
  assert.equal(segmentFuerKlick(p, q, 404, y, 10), 1, 'genau am Rand der Toleranz (4 px)');
  assert.equal(segmentFuerKlick(p, q, 405, y, 10), 2, 'ausserhalb der Toleranz: das Segment rechts davon');
  assert.equal(segmentFuerKlick(p, q, 400, 68, 10), 1, 'y knapp unter dem unteren Ende der Stufe (Toleranz)');
  assert.equal(segmentFuerKlick(p, q, 400, 90, 10), null, 'auf der Spalte, aber weit unterhalb der Stufe: kein Segment');
  // ohne Sprung gibt es keine Stufe: auf der Spalte eines geraden Punkts bleibt es bei "kein Segment"
  const g = p.map((x) => ({ ...x, form: 'gerade' }));
  assert.equal(segmentFuerKlick(g, q, 400, y, 10), null, 'gerade: genau auf der Spalte, weit vom Punkt: nichts');
  // Stufe nach oben (Sprung auf einen höheren Wert)
  const auf = [{ takt: 1, wert: -40, form: 'gerade' }, { takt: 5, wert: 0, form: 'sprung' }];
  assert.equal(segmentFuerKlick(auf, q, 401.5, 40, 10), 1, 'Stufe nach oben');
});

test('S7 Slice-2-Review B4: ein Treffer im Radius am ersten Punkt schaltet Segment 1, links wie rechts', () => {
  const q = raster({ min: -60, max: 0 }, 8, 800, 100);
  const p = [{ takt: 1, wert: 0, form: 'gerade' }, { takt: 5, wert: -30, form: 'gerade' }];
  for (const x of [-3, 0, 3]) assert.equal(segmentFuerKlick(p, q, x, 3, 10), 1, `x ${x}`);
  assert.equal(segmentFuerKlick([p[0]], q, 3, 3, 10), null, 'ein einzelner Punkt: kein Segment');
});

test('S7 Slice-2-Review B6: segmentBei ist streng: genau auf einer Punktspalte liegt kein Segment', () => {
  const q = raster({ min: -60, max: 0 }, 8, 800, 100);
  const p = [{ takt: 1, wert: 0 }, { takt: 5, wert: -30 }, { takt: 9, wert: 0 }];
  assert.equal(segmentBei(p, q, q.x(1)), null, 'auf der ersten Spalte');
  assert.equal(segmentBei(p, q, q.x(5)), null, 'auf der mittleren Spalte (weder 1 noch 2)');
  assert.equal(segmentBei(p, q, q.x(9)), null, 'auf der letzten Spalte');
  assert.equal(segmentBei(p, q, q.x(5) - 0.001), 1); assert.equal(segmentBei(p, q, q.x(5) + 0.001), 2);
});

import { fahrtenZuPunkte } from '../oeffentlich/spurband.js';

test('S7 T12: Fahrten → Punkte ist die Umkehrung für Kern- und Wirt-Bänder (Rundreise)', () => {
  for (const [strom, i, p] of [
    [2, 0, [{ takt: 1, wert: 0, form: 'gerade' }, { takt: 3, wert: -20, form: 'rund' }, { takt: 5, wert: -40, form: 'sprung' }, { takt: 9, wert: 0, form: 'gerade' }]],
    [2, 0, [{ takt: 1, wert: 0, form: 'gerade' }, { takt: 5, wert: -60, form: 'gerade' }]],
    [2, 2, [{ takt: 1, wert: -40, form: 'gerade' }, { takt: 5, wert: 0, form: 'rund' }, { takt: 7, wert: 20, form: 'sprung' }, { takt: 9, wert: -40, form: 'gerade' }]],
  ]) {
    const b = baender(strom)[i];
    assert.deepEqual(fahrtenZuPunkte(b, punkteZuFahrten(b, p)), p, JSON.stringify(p));
  }
  assert.deepEqual(fahrtenZuPunkte(baender(2)[0], [{ ziel: 'erz/1/fader', ab_takt: 1, nach: 0 }]), [], 'fremdes Ziel ignoriert');
  assert.deepEqual(fahrtenZuPunkte(baender(2)[0], [{ ziel: 'erz/2/fader', ab_takt: 1, takte: 4, nach: -60, form: 'linear' }, { ziel: 'erz/2/fader', ab_takt: 5, nach: -200 }]).map((x) => [x.takt, x.wert]),
    [[1, 0], [5, -60]], 'aus-bass-4: Rampe ohne Start zeigt von oben nach unten');
});

test('S7 T12: Startwert einer Rampe ohne Setzen und ohne von; Vorgabe-Form Kern rund, Wirt gerade', () => {
  const fader = baender(2)[0], filter = baender(2)[1], cutoff = baender(2)[2];
  // Rampe ohne Setzen: Fader zeigt band.max (0 dB), Filter und Cutoff die Vorgabe des Bandes
  assert.deepEqual(fahrtenZuPunkte(fader, [{ ziel: fader.ziel, ab_takt: 1, takte: 2, nach: -30 }]).map((x) => [x.takt, x.wert]), [[1, 0], [3, -30]]);
  assert.deepEqual(fahrtenZuPunkte(filter, [{ ziel: filter.ziel, ab_takt: 1, takte: 2, nach: 0.6 }]).map((x) => [x.takt, x.wert]), [[1, 0], [3, 0.6]]);
  assert.deepEqual(fahrtenZuPunkte(cutoff, [{ ziel: cutoff.ziel, ab_takt: 1, takte: 2, nach: -15 }]).map((x) => [x.takt, x.wert]), [[1, 5], [3, -15]]);
  // mit von: der Startwert kommt aus der Fahrt, nicht aus der Vorgabe
  assert.deepEqual(fahrtenZuPunkte(cutoff, [{ ziel: cutoff.ziel, ab_takt: 1, takte: 2, nach: -15, von: -45 }]).map((x) => [x.takt, x.wert]), [[1, -45], [3, -15]]);
  // Vorgabe-Form ohne form-Feld: Kern s (rund), Wirt linear (gerade)
  assert.deepEqual(fahrtenZuPunkte(filter, [{ ziel: filter.ziel, ab_takt: 1, takte: 2, nach: 0.6 }]).map((x) => x.form), ['gerade', 'rund']);
  assert.deepEqual(fahrtenZuPunkte(cutoff, [{ ziel: cutoff.ziel, ab_takt: 1, takte: 2, nach: -15 }]).map((x) => x.form), ['gerade', 'gerade']);
  assert.deepEqual(fahrtenZuPunkte(cutoff, [{ ziel: cutoff.ziel, ab_takt: 1, takte: 2, nach: -15, form: 's' }]).map((x) => x.form), ['gerade', 'rund']);
});

import { fremdPfad, fremdeLaenge } from '../oeffentlich/spurband.js';

test('S7 Final-Review F2: fremde Spur im Raster IHRER Länge, dasselbe x-Feld, nie über den Innenrand', () => {
  const cutoff = baender(2)[2], fader = baender(2)[0];
  const bassAuf8 = [{ ziel: cutoff.ziel, ab_takt: 1, takte: 8, nach: -15, von: -45 }];
  assert.equal(fremdeLaenge(bassAuf8, cutoff.ziel), 8);
  assert.equal(fremdeLaenge([{ ziel: fader.ziel, ab_takt: 1, takte: 4, nach: -60 }, { ziel: fader.ziel, ab_takt: 5, nach: -200 }], fader.ziel), 4, 'Setzen am Ende zählt bis dahin');
  assert.equal(fremdeLaenge([{ ziel: 'erz/1/fader', ab_takt: 1, takte: 4, nach: 0 }], fader.ziel), 0, 'fremdes Ziel: keine Länge');
  // Band 366 x 72 px, Innenrand 8: bass-auf-8 im 4- und im 8-Takt-Band gibt DENSELBEN Pfad (die Länge des eigenen Entwurfs zählt nicht)
  const d = fremdPfad(cutoff, bassAuf8, 366, 72, 8);
  assert.equal(d, 'M 8 ' + (8 + (70 + 45) / 130 * 56).toFixed(2).replace(/\.?0+$/, '') + ' L 358 ' + (8 + (70 + 15) / 130 * 56).toFixed(2) + ' L 358 ' + (8 + (70 + 15) / 130 * 56).toFixed(2), d);
  const zahlen = d.match(/-?\d+(\.\d+)?/g).map(Number);
  const xs = zahlen.filter((_, i) => i % 2 === 0 && i > 0);   // x der L-Paare
  assert.ok(xs.every((x) => x >= 8 && x <= 366 - 8), 'kein x ausserhalb der Innenfläche: ' + xs);
  // Endwert −15 liegt auf der Höhe von −15 (nicht −30 wie im Zeitmaßstab des 4-Takt-Entwurfs)
  const yEnde = 8 + (70 + 15) / 130 * 56;
  assert.ok(Math.abs(zahlen.at(-1) - Math.round(yEnde * 100) / 100) < 0.01, 'Endwert −15');
  // aus-bass-4 auf dem Fader: 4 Takte belegen die ganze Breite (nicht die linke Hälfte des 8-Takt-Bandes)
  const aus = [{ ziel: fader.ziel, ab_takt: 1, takte: 4, nach: -60, form: 'linear' }, { ziel: fader.ziel, ab_takt: 5, nach: -200 }];
  assert.match(fremdPfad(fader, aus, 366, 72, 8), /^M 8 8 L 358 64 L 358 64$/);
  assert.equal(fremdPfad(fader, [], 366, 72, 8), '', 'nichts zu zeichnen');
  assert.equal(fremdPfad(fader, [{ ziel: 'erz/1/fader', ab_takt: 1, takte: 4, nach: 0 }], 366, 72, 8), '');
});
