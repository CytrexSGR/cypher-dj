// PRODUCTION V2: Clips im Arrangement (reine Funktionen clips.js und entwurf.js). Ansicht 10 px je Beat, Spurzeile 64 px.
import test from 'node:test';
import assert from 'node:assert/strict';
import { trefferClip, verschiebe, kuerzeRechts, kuerzeLinks, zieheFade, zugBefehle, zugLabel, teile, dupliziere, loesche, neuerMidiClip, feldBefehl, istZug,
  schalteLoop, loopLabel, loopImWeg, kacheln, CLIP_TEXT } from '../oeffentlich/produktion/clips.js';
import { entwurf, findeClip, neueClipIds, neuerZugLauf } from '../oeffentlich/produktion/entwurf.js';

const A = { beat0: 0, pxProBeat: 10 };
const audio = (id, start, laenge, extra = {}) => ({ id, art: 'audio', name: id, start_beat: start, laenge_beats: laenge, quelle: { sha256: 'a'.repeat(64), pfad_hinweis: '' },
  dekodiert: 'fertig', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0, ...extra });
const midi = (id, start, laenge, noten) => ({ id, art: 'midi', name: id, start_beat: start, laenge_beats: laenge, noten });
const projekt = () => ({ tempo_bpm: 120, spuren: [
  { id: 's1', nr: 1, art: 'audio', clips: [audio('c1', 0, 4), audio('c2', 8, 4, { offset_s: 1, fade_ein_beats: 1, fade_aus_beats: 1 })] },
  { id: 's2', nr: 2, art: 'audio', clips: [] },
  { id: 's3', nr: 3, art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} }, clips: [midi('c3', 4, 4, [{ id: 'n1', beat: 0, laenge: 1, ton: 36, vel: 100 }, { id: 'n2', beat: 1.5, laenge: 1, ton: 38, vel: 90 }, { id: 'n3', beat: 3, laenge: 0.5, ton: 40, vel: 80 }])] },
] });

test('V2 Clips: Treffer und Zonen (Ränder kürzen, obere Ecken fade, Mitte verschieben)', () => {
  const p = projekt();
  assert.equal(trefferClip(p, A, 20, 30).zone, 'mitte');
  assert.equal(trefferClip(p, A, 2, 30).zone, 'links');
  assert.equal(trefferClip(p, A, 38, 30).zone, 'rechts');
  assert.equal(trefferClip(p, A, 3, 5).zone, 'fade_ein', 'Namenszeile am linken Rand: Fade-Griff vor Kürz-Griff');
  assert.equal(trefferClip(p, A, 37, 5).zone, 'fade_aus');
  assert.equal(trefferClip(p, A, 90, 5).zone, 'fade_ein', 'c2: Einblende 1 Beat, Griff bei x 90');
  assert.equal(trefferClip(p, A, 45, 30), null, 'zwischen den Clips');
  assert.equal(trefferClip(p, A, 50, 64 * 2 + 5).zone, 'mitte', 'MIDI-Clip hat keine Fade-Griffe');
  assert.equal(trefferClip(p, A, 20, 64 * 3 + 5), null, 'unter der letzten Spur');
  assert.equal(istZug(2, 2), false); assert.equal(istZug(3, 0), true);
});

test('V2 Clips: verschieben rastet den gegriffenen Clip, alle gewählten folgen, Spurwechsel nur bei passender Art', () => {
  const p = projekt();
  assert.deepEqual(verschiebe(p, ['c1'], 'c1', 2.3, 0, 1), [{ befehl: 'clip_aendern', clip_id: 'c1', start_beat: 2 }]);
  assert.deepEqual(verschiebe(p, ['c1'], 'c1', 2.3, 0, 0), [{ befehl: 'clip_aendern', clip_id: 'c1', start_beat: 2.3 }], 'GRID OFF: frei');
  assert.deepEqual(verschiebe(p, ['c1', 'c2'], 'c2', -10, 0, 1), [], 'c1 steht schon auf 0: keiner rückt vor Beat 0');
  assert.deepEqual(verschiebe(p, ['c1', 'c2'], 'c2', 1, 0, 1), [{ befehl: 'clip_aendern', clip_id: 'c1', start_beat: 1 }, { befehl: 'clip_aendern', clip_id: 'c2', start_beat: 9 }]);
  assert.deepEqual(verschiebe(p, ['c1'], 'c1', 0, 1, 1), [{ befehl: 'clip_aendern', clip_id: 'c1', spur_id: 's2' }], 'Audio auf Audio');
  assert.deepEqual(verschiebe(p, ['c1'], 'c1', 0, 2, 1), [], 'Audio-Clip nicht auf eine Instrument-Spur (Negativ-Kontrolle)');
  assert.deepEqual(verschiebe(p, ['c1'], 'c1', 0.2, 0, 1), [], 'unter einem halben Raster: nichts zu schicken');
});

test('V2 Clips: rechts kürzen rastet das Ende, Fades bleiben in der Länge', () => {
  const p = projekt(), c2 = p.spuren[0].clips[1];
  assert.deepEqual(kuerzeRechts(p.spuren[0].clips[0], -1.4, 1), [{ befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 3 }]);
  assert.deepEqual(kuerzeRechts(p.spuren[0].clips[0], -9, 1), [{ befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 1 }], 'mindestens ein Rasterschritt');
  assert.deepEqual(kuerzeRechts(c2, -3, 1), [{ befehl: 'clip_aendern', clip_id: 'c2', laenge_beats: 1, fade_aus_beats: 0 }], 'Ein- plus Ausblende ≤ Länge (S2 fade_zu_lang)');
});

test('V2 Clips: links kürzen verschiebt offset_s (Audio) bzw. die Noten (MIDI), nie vor den Quellanfang', () => {
  const p = projekt(), c2 = p.spuren[0].clips[1], c3 = p.spuren[2].clips[0];
  assert.deepEqual(kuerzeLinks(c2, 1, 1, 120), [{ befehl: 'clip_aendern', clip_id: 'c2', start_beat: 9, laenge_beats: 3, offset_s: 1.5 }], '1 Beat bei 120 BPM = 0,5 s');
  assert.deepEqual(kuerzeLinks(c2, -5, 1, 120), [{ befehl: 'clip_aendern', clip_id: 'c2', start_beat: 6, laenge_beats: 6, offset_s: 0 }], 'offset 1 s = 2 Beats: weiter nach links geht nicht');
  assert.deepEqual(kuerzeLinks(p.spuren[0].clips[0], -2, 1, 120), [], 'offset 0: nach links nichts');
  const m = kuerzeLinks(c3, 2, 1, 120);
  assert.deepEqual(m, [
    { befehl: 'clip_aendern', clip_id: 'c3', start_beat: 6, laenge_beats: 2 },
    { befehl: 'noten_loeschen', clip_id: 'c3', ids: ['n1'] },
    { befehl: 'noten_aendern', clip_id: 'c3', noten: [{ id: 'n2', beat: 0, laenge: 0.5 }, { id: 'n3', beat: 1 }] },
  ], 'n1 endet vor dem neuen Anfang, n2 wird angeschnitten, n3 rückt um 2 Beats');
  const e = entwurf(p, m).spuren[2].clips[0];
  assert.deepEqual(e.noten.map((n) => [n.id, 6 + n.beat]), [['n2', 6], ['n3', 7]], 'die Noten klingen weiter an derselben Projekt-Stelle');
});

test('V2 Clips: Fades frei, zusammen höchstens die Clip-Länge, nur Audio', () => {
  const p = projekt(), c1 = p.spuren[0].clips[0], c2 = p.spuren[0].clips[1];
  assert.deepEqual(zieheFade(c1, 'ein', 1.2345), [{ befehl: 'clip_aendern', clip_id: 'c1', fade_ein_beats: 1.235 }]);
  assert.deepEqual(zieheFade(c2, 'ein', 10), [{ befehl: 'clip_aendern', clip_id: 'c2', fade_ein_beats: 3 }], 'Länge 4 minus Ausblende 1');
  assert.deepEqual(zieheFade(c2, 'aus', 0.5), [{ befehl: 'clip_aendern', clip_id: 'c2', fade_aus_beats: 0.5 }], 'Ausblende nach rechts gezogen: kürzer');
  assert.deepEqual(zieheFade(p.spuren[2].clips[0], 'ein', 1), []);
  assert.deepEqual(zieheFade(c1, 'aus', 5), [], 'schon 0: nichts');
});

test('V2 Clips: Zug-Befehle je Zone, Labels, Teilen, Duplizieren, Löschen, MIDI-Clip anlegen', () => {
  const p = projekt();
  const t = trefferClip(p, A, 20, 30);
  assert.deepEqual(zugBefehle(p, t, ['c1'], 2.3, 0, 1, 120), [{ befehl: 'clip_aendern', clip_id: 'c1', start_beat: 2 }]);
  assert.equal(zugLabel('mitte', verschiebe(p, ['c1', 'c2'], 'c1', 1, 0, 1)), 'Move 2 clips');
  assert.equal(zugLabel('links', []), 'Trim clip');
  assert.deepEqual(teile(p, ['c1', 'c3'], 5), [{ befehl: 'clip_teilen', clip_id: 'c3', beat: 5 }], 'c1 endet bei 4');
  assert.deepEqual(teile(p, ['c1'], 4), [], 'genau am Rand ist kein Teilen');
  assert.deepEqual(dupliziere(p, ['c1', 'c2']), [{ befehl: 'clip_duplizieren', clip_id: 'c1', ziel_beat: 12 }, { befehl: 'clip_duplizieren', clip_id: 'c2', ziel_beat: 20 }], 'Block 0..12 hinter sich');
  assert.deepEqual(dupliziere(p, ['c3']), [{ befehl: 'clip_duplizieren', clip_id: 'c3', ziel_beat: 8 }]);
  assert.deepEqual(loesche(['c1']), [{ befehl: 'clip_loeschen', clip_id: 'c1' }]);
  assert.deepEqual(neuerMidiClip(p, 2, 6.7, 1), { befehl: { befehl: 'clip_neu', spur_id: 's3', art: 'midi', start_beat: 6, laenge_beats: 4 } });
  assert.deepEqual(neuerMidiClip(p, 0, 1, 1), { fehler: 'keine_instrumentspur' });
  assert.deepEqual(neuerMidiClip(p, 5, 1, 1), { fehler: 'keine_spur' });
});

test('V2 Clips: Entwurf zeigt genau die Befehle (Spurwechsel, Noten), Eingabe bleibt unberührt; neue IDs', () => {
  const p = projekt(), vorher = JSON.stringify(p);
  const e = entwurf(p, [{ befehl: 'clip_aendern', clip_id: 'c1', start_beat: 2, spur_id: 's2' }, { befehl: 'noten_loeschen', clip_id: 'c3', ids: ['n1'] }]);
  assert.equal(JSON.stringify(p), vorher, 'Eingabe nicht verändert');
  assert.deepEqual(findeClip(e, 'c1').spur.id, 's2');
  assert.equal(findeClip(e, 'c1').clip.start_beat, 2);
  assert.deepEqual(findeClip(e, 'c3').clip.noten.map((n) => n.id), ['n2', 'n3']);
  assert.equal(entwurf(p, []), p, 'ohne Befehle derselbe Stand');
  const neu = structuredClone(p); neu.spuren[1].clips.push(audio('c9', 0, 1));
  assert.deepEqual(neueClipIds(p, neu), ['c9']);
});

test('V2 Clips: Detailfelder mit Wertebereichen wie S2, Komma erlaubt, unveränderter Wert schickt nichts', () => {
  const c2 = projekt().spuren[0].clips[1];
  assert.deepEqual(feldBefehl(c2, 'gain_db', '-3,5'), { befehl: { befehl: 'clip_aendern', clip_id: 'c2', gain_db: -3.5 } });
  assert.deepEqual(feldBefehl(c2, 'gain_db', '30'), { fehler: 'Gain: −96 to +24 dB' }, 'Spec 6.27: S2 und Kern nehmen bis +24 dB');
  assert.deepEqual(feldBefehl(c2, 'gain_db', '24'), { befehl: { befehl: 'clip_aendern', clip_id: 'c2', gain_db: 24 } });
  assert.deepEqual(feldBefehl(c2, 'fade_ein_beats', '3.5'), { fehler: 'The fades are longer than the clip' });
  assert.deepEqual(feldBefehl(c2, 'laenge_beats', '0'), { fehler: 'Length: more than 0 beats' });
  assert.deepEqual(feldBefehl(c2, 'offset_s', 'abc'), { fehler: 'Offset: 0 s or later' });
  assert.deepEqual(feldBefehl(c2, 'offset_s', '1'), { befehl: null }, 'gleicher Wert: nichts');
});

// D1 V2 (Spec 6.17, Plan-Review Befund 1): Clip-Loop. Der Schalter setzt loop_beats auf die aktuelle Länge bzw. null; danach zieht die rechte
// Kante laenge_beats (Kacheln je Wiederholung). kuerzeRechts nimmt loop_beats mit, wenn die neue Länge kürzer ist; teile() lässt Loop-Clips aus
// (S2 lehnt clip_teilen auf einem Loop-Clip mit argument_ungueltig ab); links kürzen ist bei einem Loop-Clip gesperrt (der Loop beginnt immer am
// Clip-Anfang, ein neuer Anfang änderte den Inhalt jeder Wiederholung).
test('V2 Clips: Loop-Schalter, rechte Kante, teilen und links kürzen bei Loop-Clips, Kacheln', () => {
  const kick = audio('k1', 0, 1);
  assert.deepEqual(schalteLoop(kick), { befehl: 'clip_aendern', clip_id: 'k1', loop_beats: 1 }, 'an: loop_beats = Länge');
  assert.deepEqual(schalteLoop({ ...kick, loop_beats: 1 }), { befehl: 'clip_aendern', clip_id: 'k1', loop_beats: null }, 'aus');
  assert.equal(loopLabel(kick), 'Loop on'); assert.equal(loopLabel({ ...kick, loop_beats: 1 }), 'Loop off');
  // V2 Fix-Runde F10: mit Länge 1 fiel „loop_beats immer 1“ nicht auf; der Schalter setzt die aktuelle Länge, auch ≠ 1
  assert.deepEqual(schalteLoop(audio('k5', 2, 4)), { befehl: 'clip_aendern', clip_id: 'k5', loop_beats: 4 }, 'an: loop_beats = Länge 4');
  assert.deepEqual(schalteLoop(audio('k6', 0, 2.75)), { befehl: 'clip_aendern', clip_id: 'k6', loop_beats: 2.75 }, 'an: loop_beats = Länge 2,75');
  assert.deepEqual(schalteLoop(midi('k7', 8, 6, [])), { befehl: 'clip_aendern', clip_id: 'k7', loop_beats: 6 }, 'MIDI-Clip ebenso');
  assert.deepEqual(schalteLoop({ ...audio('k8', 0, 4), loop_beats: 4 }), { befehl: 'clip_aendern', clip_id: 'k8', loop_beats: null }, 'Negativ-Kontrolle: aus bleibt null');
  const loop = { ...kick, loop_beats: 1 };
  assert.deepEqual(kuerzeRechts(loop, 31, 1), [{ befehl: 'clip_aendern', clip_id: 'k1', laenge_beats: 32 }], 'A1-Kick: 1 Beat Loop auf 32 Beats gezogen');
  const lang = { ...audio('k2', 0, 32), loop_beats: 4 };
  assert.deepEqual(kuerzeRechts(lang, -30, 1), [{ befehl: 'clip_aendern', clip_id: 'k2', laenge_beats: 2, loop_beats: 2 }], 'kürzer als der Loop: loop_beats = min(loop, Länge)');
  assert.deepEqual(kuerzeRechts(lang, -20, 1), [{ befehl: 'clip_aendern', clip_id: 'k2', laenge_beats: 12 }], 'Negativ-Kontrolle: länger als der Loop, loop_beats bleibt');
  const p = projekt();
  p.spuren[0].clips[0].loop_beats = 1;
  assert.deepEqual(teile(p, ['c1', 'c3'], 2), [], 'c1 ist ein Loop-Clip, c3 enthält Beat 2 nicht');
  assert.equal(loopImWeg(p, ['c1', 'c3'], 2), true);
  assert.deepEqual(teile(p, ['c1', 'c3'], 5), [{ befehl: 'clip_teilen', clip_id: 'c3', beat: 5 }], 'der Nicht-Loop-Clip wird geteilt');
  assert.equal(loopImWeg(p, ['c3'], 5), false, 'Negativ-Kontrolle');
  assert.equal(CLIP_TEXT.loop_teilen, 'Loop clip: turn the loop off before splitting');
  assert.deepEqual(kuerzeLinks({ ...lang, offset_s: 1 }, 1, 1, 120), [], 'links kürzen: gesperrt bei Loop-Clips');
  assert.deepEqual(kacheln({ ...kick, laenge_beats: 32, loop_beats: 1 }).length, 32, '32 Kacheln');
  assert.deepEqual(kacheln({ ...audio('k3', 8, 10), loop_beats: 4 }), [{ start: 8, laenge: 4 }, { start: 12, laenge: 4 }, { start: 16, laenge: 2 }], 'die letzte Kachel ist der Rest');
  assert.deepEqual(kacheln(audio('k4', 8, 10)), [{ start: 8, laenge: 10 }], 'ohne Loop eine Kachel');
});

// V2 Fix-Runde F5: kacheln() hatte eine stille Grenze (4096 Kacheln): ein Loop von 1/16 Beat auf 1024 Beats endete nach 256 Beats ohne
// Trennstriche. Jetzt rechnet sie nur die Kacheln im sichtbaren Bereich [von, bis), ohne Deckel.
test('V2 Clips F5: Kacheln ohne stille Grenze, nur der sichtbare Bereich', () => {
  const c = { ...audio('k9', 0, 1024), loop_beats: 1 / 16 };
  const hinten = kacheln(c, 1000, 1024);
  assert.equal(hinten.length, 384, '1000 bis 1024 bei 1/16: 384 Kacheln');
  assert.deepEqual(hinten[0], { start: 1000, laenge: 0.0625 });
  assert.equal(hinten.at(-1).start + hinten.at(-1).laenge, 1024, 'die letzte Kachel endet am Clip-Ende, nicht bei Beat 256');
  const mitte = kacheln(c, 300.03, 300.2);
  assert.deepEqual(mitte.map((k) => k.start), [300, 300.0625, 300.125, 300.1875], 'angeschnittene Kacheln am Rand gehören dazu');
  assert.deepEqual(kacheln({ ...audio('k10', 8, 10), loop_beats: 4 }, 0, 100), [{ start: 8, laenge: 4 }, { start: 12, laenge: 4 }, { start: 16, laenge: 2 }], 'Negativ-Kontrolle: alles sichtbar wie ohne Bereich');
  assert.deepEqual(kacheln({ ...audio('k11', 8, 10), loop_beats: 4 }, 30, 40), [], 'Bereich hinter dem Clip: keine Kachel');
  assert.equal(kacheln(c).length, 16384, 'ohne Bereich alle Kacheln, kein Deckel');
});

// V2 Fix-Runde F1 (Spec 6.34): der Entwurf ist nur Anzeige. Verworfen bei jedem neuen Zug, bei Klick ohne Ziehen, bei pointercancel/Esc
// (ohne zu senden) und bei einem neuen Serverstand, während kein Zug läuft. Ein Labor mit offen gehaltener Antwort.
function labor(p0) {
  const l = { stand: p0, anzeige: null, gesendet: [], offen: [] };
  l.zug = neuerZugLauf({ stand: () => l.stand, zeige: (p) => { l.anzeige = p; }, sende: (rechne) => { l.gesendet.push(rechne()); return new Promise((ok) => l.offen.push(ok)); } });
  l.start = (p) => findeClip(l.anzeige, 'c1')?.clip.start_beat ?? null;
  return l;
}
const schiebe = (d) => (p) => { const befehle = verschiebe(p, ['c1'], 'c1', d, 0, 1); return { label: 'Move clip', befehle }; };

test('V2 Zug-Lauf F1: ein neuer Zug verwirft den hängenden Entwurf, auch vor der Antwort des vorigen', async () => {
  const l = labor(projekt());
  const z1 = l.zug.beginne(); z1.bewege(schiebe(2));
  assert.equal(l.start(), 2, 'Entwurf während des Zugs');
  const fertig = z1.lass();
  assert.equal(l.start(), 2, 'nach dem Loslassen steht der Entwurf bis zur Antwort');
  const z2 = l.zug.beginne();
  assert.equal(l.anzeige, null, 'pointerdown des nächsten Zugs verwirft ihn');
  z2.verwirf();                                         // Klick ohne Ziehen
  l.offen.shift()(true); await fertig;
  assert.equal(l.anzeige, null, 'die späte Antwort bringt ihn nicht zurück');
  assert.equal(l.gesendet.length, 1, 'nur der erste Zug wurde gesendet');
});

test('V2 Zug-Lauf F1: neuer Serverstand verwirft den Entwurf, wenn kein Zug läuft; scheitert die Änderung, geht er auch', async () => {
  const l = labor(projekt());
  const z = l.zug.beginne(); z.bewege(schiebe(2));
  const fertig = z.lass();
  l.stand = projekt(); l.zug.neuerStand();
  assert.equal(l.anzeige, null, 'Serverstand nach dem Loslassen: Anzeige folgt dem Server');
  l.offen.shift()(false); await fertig;
  assert.equal(l.anzeige, null);
  const z2 = l.zug.beginne(); z2.bewege(schiebe(3));
  const f2 = z2.lass(); l.offen.shift()(false); await f2;
  assert.equal(l.anzeige, null, 'abgelehnte Änderung (ohne neuen Stand): Entwurf weg');
  const z3 = l.zug.beginne(); z3.bewege(schiebe(1));
  l.zug.neuerStand();
  assert.equal(l.start(), 1, 'Negativ-Kontrolle: während eines laufenden Zugs bleibt der Entwurf');
});

test('V2 Zug-Lauf F1/F7: Klick ohne Ziehen und Abbruch senden nichts', async () => {
  const l = labor(projekt());
  const k = l.zug.beginne();
  assert.equal(await k.lass(), false, 'losgelassen ohne Bewegung');
  const z = l.zug.beginne(); z.bewege(schiebe(2));
  z.verwirf();
  assert.equal(l.anzeige, null, 'pointercancel/Esc: Entwurf weg');
  assert.equal(await z.lass(), false, 'ein Loslassen danach sendet nichts');
  assert.equal(l.gesendet.length, 0);
  const n = l.zug.beginne(); n.bewege(schiebe(2)); const f = n.lass(); l.offen.shift()(true);
  assert.equal(await f, true, 'Negativ-Kontrolle: ein echter Zug sendet');
  assert.deepEqual(l.gesendet[0].befehle, [{ befehl: 'clip_aendern', clip_id: 'c1', start_beat: 2 }]);
});

// V2 Fix-Runde F2 (Spec 6.34): ein Zug wird beim Senden aus dem dann gültigen Stand gerechnet und trägt dessen rev. Fall des Reviews (alte Basis):
// linker Rand eines MIDI-Clips um 2 Beats, währenddessen setzt Cypher n9; aus dem alten Stand bliebe n9 auf Clip-Beat 3 und wanderte mit dem Anfang.
test('V2 Zug-Lauf F2: Rechenregel, gerechnet aus dem Stand beim Senden, mit dessen rev', async () => {
  const p0 = { ...projekt(), rev: 1 };
  const c0 = p0.spuren[2].clips[0];                                      // c3, Start 4, n1 0, n2 1,5, n3 3
  const p1 = structuredClone(p0); p1.rev = 2; p1.spuren[2].clips[0].noten.push({ id: 'n9', beat: 2.5, laenge: 0.5, ton: 50, vel: 100 });
  const l = labor(p0);
  const z = l.zug.beginne();
  z.bewege((p) => { const f = findeClip(p, c0.id); return { label: 'Trim clip', befehle: kuerzeLinks(f.clip, 2, 1, p.tempo_bpm) }; });
  l.stand = p1; l.zug.neuerStand();
  assert.ok(findeClip(l.anzeige, c0.id).clip.noten.some((n) => n.id === 'n9' && n.beat === 0.5), 'der Entwurf zeigt den neuen Stand mit');
  const fertig = z.lass(); l.offen.shift()(true); await fertig;
  const g = l.gesendet[0];
  assert.equal(g.rev, 2, 'rev des Stands, aus dem gerechnet wurde');
  const nachher = entwurf(p1, g.befehle), c = findeClip(nachher, c0.id).clip;
  assert.equal(c.start_beat + c.noten.find((n) => n.id === 'n9').beat, 6.5, 'n9 bleibt an Projekt-Beat 6,5');
  assert.equal(c.start_beat + c.noten.find((n) => n.id === 'n3').beat, 7, 'Negativ-Kontrolle: n3 bleibt an Projekt-Beat 7');
  const alt = entwurf(p1, kuerzeLinks(c0, 2, 1, 120)), ca = findeClip(alt, c0.id).clip;
  assert.equal(ca.start_beat + ca.noten.find((n) => n.id === 'n9').beat, 8.5, 'Gegenprobe: aus p0 gerechnet wanderte n9 auf 8,5');
});
