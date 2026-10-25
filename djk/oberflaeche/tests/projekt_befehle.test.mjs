// D1 S2-Kern, Befehle: jeder Befehl aus Spec 3.4 als reine Funktion Projekt → {projekt, vor, zurueck, betrifft_wiedergabe, regler_aenderungen}.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus, BefehlFehler, vergleiche, gleicheDekodiertAb } from '../projekt/befehle.ts';
import { neuesProjekt, pruefeProjekt, kanonisch, MAX_SPUREN } from '../projekt/modell.ts';
import { wende } from '../projekt/patch.ts';
import { specProjekt, kopie, ohneAbgeleitetes, SHA_A, SHA_B } from './hilfen/projekt.mjs';

const ok = (p, b) => fuehreAus(p, b);
const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund, `erwartet ${grund} für ${JSON.stringify(b).slice(0, 80)}`);
// jede Änderung muss: ein gültiges Projekt ergeben, mit vor/zurueck genau hin- und zurückgehen, die Eingabe nicht anfassen
function pruefeErgebnis(p, r) {
  assert.ok(pruefeProjekt(r.projekt).projekt, `Ergebnis ungültig: ${JSON.stringify(pruefeProjekt(r.projekt))}`);
  assert.equal(ohneAbgeleitetes(wende(p, r.vor)), ohneAbgeleitetes(r.projekt), 'vor führt zum Ergebnis (dekodiert ist abgeleitet, Spec 6.6)');
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p), 'zurueck führt zum Ausgang (dekodiert ist abgeleitet, Spec 6.6)');
  for (const o of [...r.vor, ...r.zurueck]) assert.ok(!/\/\d+(\/|$)/.test(o.pfad), `Index im Pfad ${o.pfad}`);
}
const leer = () => neuesProjekt('T');
const mitSpur = (art = 'audio', extra = {}) => fuehreAus(leer(), { befehl: 'spur_neu', art, ...extra }).projekt;

test('spur_neu: Audio-Spur bekommt kleinste freie nr, ID, Farbe, Name; Regler-Satz für spur/1/*', () => {
  const p = leer(); const r = ok(p, { befehl: 'spur_neu', art: 'audio', name: 'Kick' });
  pruefeErgebnis(p, r);
  const s = r.projekt.spuren[0];
  assert.deepEqual([s.id, s.nr, s.name, s.art, s.fader_db, s.pan, s.mute, s.solo, s.clips], ['s1', 1, 'Kick', 'audio', 0, 0, false, false, []]);
  assert.match(s.farbe, /^#[0-9a-f]{6}$/); assert.equal(s.geraet, undefined);
  assert.equal(r.betrifft_wiedergabe, true);
  assert.deepEqual(r.regler_aenderungen, [
    { pfad: 'spur/1/fader', wert: 0 }, { pfad: 'spur/1/pan', wert: 0 }, { pfad: 'spur/1/mute', wert: 0 }, { pfad: 'spur/1/solo', wert: 0 }]);
  assert.equal(p.spuren.length, 0, 'Eingabe unberührt');
});

test('spur_neu: Instrument vorgabe RB-338 intern; Wirt Surge mit Slot 1 (Spec 6.28: einer in D1); Slot belegt → Grund', () => {
  let p = leer();
  p = ok(p, { befehl: 'spur_neu', art: 'instrument' }).projekt;
  assert.deepEqual(p.spuren[0].geraet, { art: 'intern', name: 'rb338', parameter: {} });
  p = ok(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge' } }).projekt;
  assert.deepEqual(p.spuren[1].geraet, { art: 'wirt', name: 'surge', slot: 1 }); assert.equal(p.spuren[1].freeze, null);
  lehntAb(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge' } }, 'slot_belegt');
  lehntAb(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge', slot: 2 } }, 'slot_belegt');
  lehntAb(p, { befehl: 'spur_neu', art: 'audio', geraet: { art: 'intern', name: 'rb338' } }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'unbekannt' } }, 'argument_ungueltig');
});

test('spur_neu: elfte Spur → spur_bereich (10 belegt); nach Löschen wird die freie nr wiederverwendet', () => {
  let p = leer();
  for (let i = 1; i <= MAX_SPUREN; i++) p = ok(p, { befehl: 'spur_neu', art: 'audio' }).projekt;
  assert.deepEqual(p.spuren.map((s) => s.nr), Array.from({ length: MAX_SPUREN }, (_, i) => i + 1));
  lehntAb(p, { befehl: 'spur_neu', art: 'audio' }, 'spur_bereich');
  assert.throws(() => fuehreAus(p, { befehl: 'spur_neu', art: 'audio' }), (e) => e.detail === `alle ${MAX_SPUREN} Spuren belegt`, 'Fehlertext aus der Konstanten (T06)');
  const q = ok(p, { befehl: 'spur_loeschen', spur_id: 's4' });
  pruefeErgebnis(p, q);
  assert.deepEqual(q.regler_aenderungen, [{ pfad: 'spur/4/fader', wert: 0 }, { pfad: 'spur/4/pan', wert: 0 }, { pfad: 'spur/4/mute', wert: 0 }, { pfad: 'spur/4/solo', wert: 0 }]);
  const n = ok(q.projekt, { befehl: 'spur_neu', art: 'audio' });
  assert.equal(n.projekt.spuren.at(-1).nr, 4, 'nach dem Löschen von Spur 4 bekommt die nächste Spur nr 4');
  assert.equal(n.projekt.spuren.at(-1).id, `s${MAX_SPUREN + 1}`, 'ID wird nicht wiederverwendet, solange ein höheres lebt');
  const z = ok(p, { befehl: 'spur_loeschen', spur_id: `s${MAX_SPUREN}` });
  assert.equal(ok(z.projekt, { befehl: 'spur_neu', art: 'audio' }).projekt.spuren.at(-1).nr, MAX_SPUREN, 'auch die höchste Nummer wird vergeben');
});

test('spur_neu: ungültige Argumente → argument_ungueltig; unbekannter Befehl → befehl_unbekannt; unbekanntes Feld wird nicht still geschluckt', () => {
  const p = leer();
  lehntAb(p, { befehl: 'spur_neu' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'spur_neu', art: 'video' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'spur_neu', art: 'audio', name: '' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'spur_neu', art: 'audio', fader: -3 }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'spur_tanzen' }, 'befehl_unbekannt');
  lehntAb(p, {}, 'befehl_unbekannt');
  lehntAb(p, null, 'befehl_unbekannt');
});

test('spur_aendern: Name/Farbe berühren die Wiedergabe nicht und lösen keinen Regler aus; Mixer nur den geänderten Regler', () => {
  const p = specProjekt();
  const a = ok(p, { befehl: 'spur_aendern', spur_id: 's1', name: 'Kick 2', farbe: '#112233' });
  pruefeErgebnis(p, a);
  assert.equal(a.betrifft_wiedergabe, false); assert.deepEqual(a.regler_aenderungen, []);
  const b = ok(p, { befehl: 'spur_aendern', spur_id: 's2', fader_db: -6.5 });
  pruefeErgebnis(p, b);
  assert.deepEqual(b.vor, [{ op: 'replace', pfad: '/spuren/s2/fader_db', wert: -6.5 }]);
  assert.deepEqual(b.zurueck, [{ op: 'replace', pfad: '/spuren/s2/fader_db', wert: 0 }]);
  assert.deepEqual(b.regler_aenderungen, [{ pfad: 'spur/2/fader', wert: -6.5 }]); assert.equal(b.betrifft_wiedergabe, false);
  const c = ok(p, { befehl: 'spur_aendern', spur_id: 's3', pan: -0.5, mute: true, solo: true });
  assert.deepEqual(c.regler_aenderungen, [{ pfad: 'spur/3/pan', wert: -0.5 }, { pfad: 'spur/3/mute', wert: 1 }, { pfad: 'spur/3/solo', wert: 1 }]);
  const d = ok(p, { befehl: 'spur_aendern', spur_id: 's1', fader_db: 0 });
  assert.deepEqual(d.vor, [], 'gleicher Wert: keine Änderung'); assert.deepEqual(d.regler_aenderungen, []);
});

test('spur_aendern: Bereiche und Typen (fader −200..12, pan −1..1, Booleans), unbekannte Spur', () => {
  const p = specProjekt();
  lehntAb(p, { befehl: 'spur_aendern', spur_id: 's1', fader_db: 13 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'spur_aendern', spur_id: 's1', fader_db: -201 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'spur_aendern', spur_id: 's1', pan: 1.01 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'spur_aendern', spur_id: 's1', mute: 1 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'spur_aendern', spur_id: 's1', farbe: 'blau' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'spur_aendern', spur_id: 's99', pan: 0 }, 'spur_unbekannt');
  lehntAb(p, { befehl: 'spur_aendern', pan: 0 }, 'argument_ungueltig');
  assert.equal(ok(p, { befehl: 'spur_aendern', spur_id: 's1', fader_db: -200 }).projekt.spuren[0].fader_db, -200);
  assert.equal(ok(p, { befehl: 'spur_aendern', spur_id: 's1', fader_db: 6 }).projekt.spuren[0].fader_db, 6);   // Spec 6.16: bis +6
});

test('spur_aendern geraet: Wechsel Wirt→intern entfernt freeze, intern→Wirt setzt freeze null; Audio-Spur hat kein Gerät; Slot belegt', () => {
  const p = specProjekt();
  const a = ok(p, { befehl: 'spur_aendern', spur_id: 's3', geraet: { art: 'intern', name: 'rb338' } });
  pruefeErgebnis(p, a);
  assert.equal('freeze' in a.projekt.spuren[2], false); assert.equal(a.betrifft_wiedergabe, true);
  const p2 = a.projekt;                                       // s3 ist jetzt intern, Slot 1 frei (Spec 6.28: ein Slot in D1)
  const b = ok(p2, { befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'wirt', name: 'surge' } });
  pruefeErgebnis(p2, b); assert.equal(b.projekt.spuren[1].freeze, null); assert.equal(b.projekt.spuren[1].geraet.slot, 1);
  lehntAb(p, { befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'wirt', name: 'surge', slot: 1 } }, 'slot_belegt');
  lehntAb(p, { befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'wirt', name: 'surge', slot: 2 } }, 'slot_belegt');
  lehntAb(p, { befehl: 'spur_aendern', spur_id: 's1', geraet: { art: 'intern', name: 'rb338' } }, 'argument_ungueltig');
  const c = ok(p, { befehl: 'spur_aendern', spur_id: 's3', geraet: { art: 'wirt', name: 'surge', slot: 1 } });
  assert.deepEqual(c.vor, [], 'derselbe Slot: nichts zu tun, kein Selbstkonflikt');
});

test('spur_loeschen: Spur samt Clips weg, Regler zurück; unbekannte ID → spur_unbekannt; Rückweg stellt Clips und Noten wieder her', () => {
  const p = specProjekt();
  const r = ok(p, { befehl: 'spur_loeschen', spur_id: 's2' });
  pruefeErgebnis(p, r); assert.deepEqual(r.projekt.spuren.map((s) => s.id), ['s1', 's3']);
  assert.equal(r.betrifft_wiedergabe, true); assert.equal(r.regler_aenderungen.length, 4);
  assert.equal(r.zurueck[0].index, 1, 'Position wird mitgeführt');
  lehntAb(p, { befehl: 'spur_loeschen', spur_id: 'sX' }, 'spur_unbekannt');
});

test('spur_verschieben: Reihenfolge ändert sich, nr bleibt; Wiedergabe unberührt; Index außerhalb → index_bereich', () => {
  const p = specProjekt();
  const r = ok(p, { befehl: 'spur_verschieben', spur_id: 's3', index: 0 });
  pruefeErgebnis(p, r);
  assert.deepEqual(r.projekt.spuren.map((s) => [s.id, s.nr]), [['s3', 3], ['s1', 1], ['s2', 2]]);
  assert.equal(r.betrifft_wiedergabe, false); assert.deepEqual(r.regler_aenderungen, []);
  lehntAb(p, { befehl: 'spur_verschieben', spur_id: 's3', index: 3 }, 'index_bereich');
  lehntAb(p, { befehl: 'spur_verschieben', spur_id: 's3', index: -1 }, 'index_bereich');
  lehntAb(p, { befehl: 'spur_verschieben', spur_id: 's3', index: 1.5 }, 'argument_ungueltig');
  assert.deepEqual(ok(p, { befehl: 'spur_verschieben', spur_id: 's2', index: 1 }).vor, []);
});

test('clip_neu Audio: Zustand nein, Vorgabewerte; nur sha256; falsche Spur-Art, schlechte sha, Länge 0', () => {
  const p = mitSpur('audio');
  const r = ok(p, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 2, sha256: SHA_B, name: 'snare', pfad_hinweis: '/x/snare.wav' });
  pruefeErgebnis(p, r);
  assert.deepEqual(r.projekt.spuren[0].clips[0], { id: 'c1', art: 'audio', name: 'snare', start_beat: 4, laenge_beats: 2,
    quelle: { sha256: SHA_B, pfad_hinweis: '/x/snare.wav' }, dekodiert: 'nein', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 });
  assert.equal(r.betrifft_wiedergabe, true);
  lehntAb(p, { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4 }, 'art_passt_nicht');
  lehntAb(p, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 4 }, 'sha_ungueltig');
  lehntAb(p, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 4, sha256: 'xyz' }, 'sha_ungueltig');
  lehntAb(p, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 0, sha256: SHA_A }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: -1, laenge_beats: 1, sha256: SHA_A }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'clip_neu', spur_id: 'sX', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: SHA_A }, 'spur_unbekannt');
});

test('clip_neu MIDI: mit Noten (IDs vergeben), ohne sha; MIDI auf Audio-Spur und umgekehrt abgelehnt', () => {
  const p = mitSpur('instrument');
  const r = ok(p, { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4,
    noten: [{ beat: 0, laenge: 1, ton: 36, vel: 100 }, { beat: 2, laenge: 0.5, ton: 38, vel: 90 }] });
  pruefeErgebnis(p, r);
  assert.deepEqual(r.projekt.spuren[0].clips[0].noten.map((n) => n.id), ['n1', 'n2']);
  lehntAb(p, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 4, sha256: SHA_A }, 'art_passt_nicht');
  lehntAb(p, { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, sha256: SHA_A }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [{ beat: 0, laenge: 1, ton: 200, vel: 100 }] }, 'argument_ungueltig');
});

test('clip_aendern: Lage/Länge/Offset/Gain/Fades in Beats und Sekunden; Fades zu lang; Audio-Felder an MIDI-Clip; Spur wechseln nur gleicher Art', () => {
  const p = specProjekt();
  const r = ok(p, { befehl: 'clip_aendern', clip_id: 'c1', start_beat: 2, laenge_beats: 4, offset_s: 0.25, gain_db: -3, fade_ein_beats: 1, fade_aus_beats: 2 });
  pruefeErgebnis(p, r);
  const c = r.projekt.spuren[0].clips[0];
  assert.deepEqual([c.start_beat, c.laenge_beats, c.offset_s, c.gain_db, c.fade_ein_beats, c.fade_aus_beats], [2, 4, 0.25, -3, 1, 2]);
  assert.equal(r.betrifft_wiedergabe, true);
  lehntAb(p, { befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 4, fade_ein_beats: 3, fade_aus_beats: 2 }, 'fade_zu_lang');
  assert.ok(ok(p, { befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 0.5, fade_ein_beats: 0.25, fade_aus_beats: 0.25 }), 'Summe genau gleich der Länge ist erlaubt');
  lehntAb(p, { befehl: 'clip_aendern', clip_id: 'c2', gain_db: -3 }, 'feld_nur_audio');
  lehntAb(p, { befehl: 'clip_aendern', clip_id: 'c2', offset_s: 1 }, 'feld_nur_audio');
  lehntAb(p, { befehl: 'clip_aendern', clip_id: 'cX', gain_db: 0 }, 'clip_unbekannt');
  lehntAb(p, { befehl: 'clip_aendern', clip_id: 'c1', spur_id: 's2' }, 'art_passt_nicht');
  lehntAb(p, { befehl: 'clip_aendern', clip_id: 'c1', spur_id: 'sX' }, 'spur_unbekannt');
  lehntAb(p, { befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: -1 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'clip_aendern', clip_id: 'c1', offset_s: -0.1 }, 'argument_ungueltig');
});

test('clip_aendern name-only: Wiedergabe unberührt; Spur wechseln: Clip landet in der anderen Spur', () => {
  let p = specProjekt();
  assert.equal(ok(p, { befehl: 'clip_aendern', clip_id: 'c1', name: 'neu' }).betrifft_wiedergabe, false);
  p = ok(p, { befehl: 'spur_neu', art: 'audio' }).projekt;   // s4, nr 4
  const r = ok(p, { befehl: 'clip_aendern', clip_id: 'c1', spur_id: 's4' });
  pruefeErgebnis(p, r);
  assert.equal(r.projekt.spuren[0].clips.length, 0); assert.equal(r.projekt.spuren[3].clips[0].id, 'c1');
});

test('clip_teilen Audio: zweiter Teil beginnt am Beat, Offset um die geteilten SEKUNDEN weiter (Tempo 120: 2 Beats = 1 s), Fades verteilt', () => {
  let p = specProjekt(); p.tempo_bpm = 120;
  p = ok(p, { befehl: 'clip_aendern', clip_id: 'c1', start_beat: 4, laenge_beats: 8, offset_s: 0.5, fade_ein_beats: 1, fade_aus_beats: 2, gain_db: -2 }).projekt;
  const r = ok(p, { befehl: 'clip_teilen', clip_id: 'c1', beat: 10 });
  pruefeErgebnis(p, r);
  const [a, b] = r.projekt.spuren[0].clips;
  assert.deepEqual([a.id, a.start_beat, a.laenge_beats, a.offset_s, a.fade_ein_beats, a.fade_aus_beats, a.gain_db], ['c1', 4, 6, 0.5, 1, 0, -2]);
  assert.deepEqual([b.id, b.start_beat, b.laenge_beats, b.offset_s, b.fade_ein_beats, b.fade_aus_beats, b.gain_db], ['c3', 10, 2, 0.5 + 3.0, 0, 2, -2]);
  assert.equal(b.quelle.sha256, a.quelle.sha256); assert.equal(b.dekodiert, a.dekodiert);
  assert.equal(r.betrifft_wiedergabe, true);
  // anderes Tempo: 124 BPM, 6 Beats = 6·60/124 s
  const q = specProjekt();
  const r2 = ok(q, { befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 8 });
  const r3 = ok(r2.projekt, { befehl: 'clip_teilen', clip_id: 'c1', beat: 6 });
  assert.ok(Math.abs(r3.projekt.spuren[0].clips[1].offset_s - 6 * 60 / 124) < 1e-9);
});

test('clip_teilen Audio: Fades werden an die Teillängen gekürzt; Beat auf/außerhalb der Grenze → beat_ausserhalb', () => {
  let p = specProjekt();
  p = ok(p, { befehl: 'clip_aendern', clip_id: 'c1', start_beat: 0, laenge_beats: 4, fade_ein_beats: 3, fade_aus_beats: 1 }).projekt;
  const r = ok(p, { befehl: 'clip_teilen', clip_id: 'c1', beat: 1 });
  pruefeErgebnis(p, r);
  const [a, b] = r.projekt.spuren[0].clips;
  assert.deepEqual([a.laenge_beats, a.fade_ein_beats, a.fade_aus_beats], [1, 1, 0], 'Einblende auf die Teillänge gekürzt');
  assert.deepEqual([b.laenge_beats, b.fade_ein_beats, b.fade_aus_beats], [3, 0, 1]);
  for (const beat of [0, 4, -1, 5]) lehntAb(p, { befehl: 'clip_teilen', clip_id: 'c1', beat }, 'beat_ausserhalb');
  lehntAb(p, { befehl: 'clip_teilen', clip_id: 'cX', beat: 1 }, 'clip_unbekannt');
});

test('clip_teilen MIDI: Noten wandern nach Beat; eine Note über den Schnitt wird geteilt (Rest als neue Note im zweiten Clip); Beats relativ', () => {
  let p = specProjekt();
  p = ok(p, { befehl: 'clip_aendern', clip_id: 'c2', start_beat: 8 }).projekt;
  p = ok(p, { befehl: 'noten_neu', clip_id: 'c2', noten: [
    { beat: 3.5, laenge: 1, ton: 40, vel: 90 },     // n2: abs 11.5..12.5, Schnitt bei 12 → geteilt
    { beat: 4, laenge: 1, ton: 41, vel: 90 },       // n3: abs 12, genau am Schnitt → zweiter Clip
    { beat: 6, laenge: 0.5, ton: 42, vel: 80 },     // n4
  ] }).projekt;
  const r = ok(p, { befehl: 'clip_teilen', clip_id: 'c2', beat: 12 });
  pruefeErgebnis(p, r);
  const [a, b] = r.projekt.spuren[1].clips;
  assert.deepEqual([a.id, a.start_beat, a.laenge_beats], ['c2', 8, 4]); assert.deepEqual([b.id, b.start_beat, b.laenge_beats], ['c3', 12, 12]);
  assert.deepEqual(a.noten.map((n) => [n.id, n.beat, n.laenge, n.ton]), [['n1', 0, 0.5, 36], ['n2', 3.5, 0.5, 40]]);
  assert.deepEqual(b.noten.map((n) => [n.beat, n.laenge, n.ton]).sort((x, y) => x[0] - y[0] || x[2] - y[2]), [[0, 0.5, 40], [0, 1, 41], [2, 0.5, 42]]);
  assert.equal(new Set(b.noten.map((n) => n.id)).size, b.noten.length, 'IDs im neuen Clip eindeutig');
  // gleiche Gesamtdauer an Noten vor und nach dem Schnitt
  const dauer = (cs) => cs.flatMap((c) => c.noten).reduce((s, n) => s + n.laenge, 0);
  assert.equal(dauer(r.projekt.spuren[1].clips), dauer(p.spuren[1].clips));
});

test('clip_duplizieren: Kopie hinter dem Original (Vorgabe) oder am Ziel-Beat; neue ID; Noten-IDs bleiben; Audio behält Quelle', () => {
  const p = specProjekt();
  const r = ok(p, { befehl: 'clip_duplizieren', clip_id: 'c2' });
  pruefeErgebnis(p, r);
  const k = r.projekt.spuren[1].clips[1];
  assert.deepEqual([k.id, k.start_beat, k.laenge_beats, k.noten.map((n) => n.id)], ['c3', 16, 16, ['n1']]);
  const r2 = ok(p, { befehl: 'clip_duplizieren', clip_id: 'c1', ziel_beat: 7.5 });
  assert.deepEqual([r2.projekt.spuren[0].clips[1].start_beat, r2.projekt.spuren[0].clips[1].quelle.sha256], [7.5, SHA_A]);
  r2.projekt.spuren[0].clips[1].name = 'x'; assert.equal(p.spuren[0].clips[0].name, 'kick');
  lehntAb(p, { befehl: 'clip_duplizieren', clip_id: 'c1', ziel_beat: -1 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'clip_duplizieren', clip_id: 'cX' }, 'clip_unbekannt');
});

test('clip_loeschen: Clip weg, Rückweg bringt ihn samt Noten an die alte Stelle', () => {
  const p = specProjekt();
  const r = ok(p, { befehl: 'clip_loeschen', clip_id: 'c2' });
  pruefeErgebnis(p, r); assert.equal(r.projekt.spuren[1].clips.length, 0); assert.equal(r.betrifft_wiedergabe, true);
  lehntAb(p, { befehl: 'clip_loeschen', clip_id: 'cX' }, 'clip_unbekannt');
});

test('noten_neu / noten_aendern / noten_loeschen: IDs, Teiländerung, unbekannte ID, MIDI-Pflicht', () => {
  const p = specProjekt();
  const a = ok(p, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ beat: 1, laenge: 0.25, ton: 48, vel: 64 }, { id: 'xy', beat: 2, laenge: 1, ton: 50, vel: 70 }] });
  pruefeErgebnis(p, a);
  assert.deepEqual(a.projekt.spuren[1].clips[0].noten.map((n) => n.id), ['n1', 'n2', 'xy']);
  lehntAb(p, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ id: 'n1', beat: 1, laenge: 1, ton: 48, vel: 64 }] }, 'id_belegt');
  lehntAb(p, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ id: 'q', beat: 1, laenge: 1, ton: 48, vel: 64 }, { id: 'q', beat: 2, laenge: 1, ton: 48, vel: 64 }] }, 'id_belegt');
  lehntAb(p, { befehl: 'noten_neu', clip_id: 'c2', noten: [] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'noten_neu', clip_id: 'c1', noten: [{ beat: 0, laenge: 1, ton: 40, vel: 90 }] }, 'clip_nicht_midi');
  lehntAb(p, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ beat: 0, laenge: 1, ton: 40, vel: 128 }] }, 'argument_ungueltig');
  const b = ok(p, { befehl: 'noten_aendern', clip_id: 'c2', noten: [{ id: 'n1', ton: 43, vel: 50 }] });
  pruefeErgebnis(p, b);
  assert.deepEqual(b.vor, [{ op: 'replace', pfad: '/spuren/s2/clips/c2/noten/n1/ton', wert: 43 }, { op: 'replace', pfad: '/spuren/s2/clips/c2/noten/n1/vel', wert: 50 }]);
  assert.equal(b.betrifft_wiedergabe, true);
  lehntAb(p, { befehl: 'noten_aendern', clip_id: 'c2', noten: [{ id: 'nX', ton: 43 }] }, 'noten_unbekannt');
  lehntAb(p, { befehl: 'noten_aendern', clip_id: 'c2', noten: [{ id: 'n1', ton: 999 }] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'noten_aendern', clip_id: 'c2', noten: [{ ton: 43 }] }, 'argument_ungueltig');
  const c = ok(p, { befehl: 'noten_loeschen', clip_id: 'c2', ids: ['n1'] });
  pruefeErgebnis(p, c); assert.equal(c.projekt.spuren[1].clips[0].noten.length, 0);
  lehntAb(p, { befehl: 'noten_loeschen', clip_id: 'c2', ids: ['n1', 'nX'] }, 'noten_unbekannt');
  lehntAb(p, { befehl: 'noten_loeschen', clip_id: 'c2', ids: [] }, 'argument_ungueltig');
});

test('tempo_setzen: 60..200, Ganz- und Dezimalzahlen; außerhalb → tempo_bereich; Wiedergabe unberührt', () => {
  const p = specProjekt();
  const r = ok(p, { befehl: 'tempo_setzen', bpm: 128.5 });
  pruefeErgebnis(p, r); assert.equal(r.projekt.tempo_bpm, 128.5); assert.equal(r.betrifft_wiedergabe, false);
  for (const bpm of [59.9, 200.1, 0, -1]) lehntAb(p, { befehl: 'tempo_setzen', bpm }, 'tempo_bereich');
  for (const bpm of ['120', NaN, Infinity, null, undefined]) lehntAb(p, { befehl: 'tempo_setzen', bpm }, 'argument_ungueltig');
  assert.equal(ok(p, { befehl: 'tempo_setzen', bpm: 60 }).projekt.tempo_bpm, 60);
  assert.equal(ok(p, { befehl: 'tempo_setzen', bpm: 200 }).projekt.tempo_bpm, 200);
});

test('loop_setzen und metronom_setzen: Bereiche, Teilangaben, Wiedergabe unberührt', () => {
  const p = specProjekt();
  const l = ok(p, { befehl: 'loop_setzen', an: false, von_beat: 4, bis_beat: 12 });
  pruefeErgebnis(p, l); assert.deepEqual(l.projekt.loop, { an: false, von_beat: 4, bis_beat: 12 }); assert.equal(l.betrifft_wiedergabe, false);
  lehntAb(p, { befehl: 'loop_setzen', an: true, von_beat: 4, bis_beat: 4.5 }, 'loop_bereich');
  lehntAb(p, { befehl: 'loop_setzen', an: true, von_beat: -1, bis_beat: 4 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'loop_setzen', an: 1, von_beat: 0, bis_beat: 4 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'loop_setzen', an: true, von_beat: 0 }, 'argument_ungueltig');
  assert.ok(ok(p, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 1 }).projekt.loop);
  const m = ok(p, { befehl: 'metronom_setzen', an: true, pegel_db: -20, ziel: 'cue' });
  pruefeErgebnis(p, m); assert.deepEqual(m.projekt.metronom, { an: true, pegel_db: -20, ziel: 'cue' });
  assert.deepEqual(ok(p, { befehl: 'metronom_setzen', an: true }).projekt.metronom, { an: true, pegel_db: -12, ziel: 'master' }, 'Teilangabe lässt den Rest');
  lehntAb(p, { befehl: 'metronom_setzen' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'metronom_setzen', pegel_db: 1 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'metronom_setzen', pegel_db: -61 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'metronom_setzen', ziel: 'laut' }, 'argument_ungueltig');
});

test('Freeze: Noten- oder Geräteänderung einer eingefrorenen Spur verwirft ihn; Mixer, Name, andere Spuren nicht; Tempo verwirft alle', () => {
  const eingefroren = () => {
    let p = specProjekt();
    p = ok(p, { befehl: 'clip_neu', spur_id: 's3', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 90 }] }).projekt;
    p.spuren[2].freeze = { datei: 'freeze/s3-1.f32', frames: 96000, kennung: 1, sha256: SHA_B };
    return p;
  };
  const frz = (p) => p.spuren.find((s) => s.id === 's3')?.freeze;
  const p = eingefroren(); assert.ok(pruefeProjekt(p).projekt);
  const klar = [
    { befehl: 'noten_neu', clip_id: 'c3', noten: [{ beat: 1, laenge: 1, ton: 62, vel: 90 }] },
    { befehl: 'noten_aendern', clip_id: 'c3', noten: [{ id: 'n2', ton: 61 }] },   // B1 (Spec 6.28): ein Zähler für alle Clips, c2 trägt n1
    { befehl: 'noten_loeschen', clip_id: 'c3', ids: ['n2'] },
    { befehl: 'clip_aendern', clip_id: 'c3', start_beat: 1 },
    { befehl: 'clip_teilen', clip_id: 'c3', beat: 2 },
    { befehl: 'clip_loeschen', clip_id: 'c3' },
    { befehl: 'clip_neu', spur_id: 's3', art: 'midi', start_beat: 8, laenge_beats: 2 },
    { befehl: 'tempo_setzen', bpm: 100 },
  ];
  for (const b of klar) {
    const r = ok(p, b); pruefeErgebnis(p, r);
    assert.equal(frz(r.projekt), null, `${b.befehl} verwirft den Freeze`);
    assert.ok(r.vor.some((o) => o.pfad === '/spuren/s3/freeze'), 'der Patch trägt das Verwerfen (Undo bringt ihn zurück)');
    assert.deepEqual(frz(wende(r.projekt, r.zurueck)), p.spuren[2].freeze, `${b.befehl}: Undo stellt den Freeze wieder her`);
  }
  // Geräteänderung: in D1 gibt es nur einen Wirt-Slot (Spec 6.28), der Wechsel Wirt → intern entfernt den Freeze ganz; Undo bringt ihn zurück
  const gi = ok(p, { befehl: 'spur_aendern', spur_id: 's3', geraet: { art: 'intern', name: 'rb338' } }); pruefeErgebnis(p, gi);
  assert.equal(frz(gi.projekt), undefined, 'Gerät verwirft den Freeze');
  assert.deepEqual(frz(wende(gi.projekt, gi.zurueck)), p.spuren[2].freeze, 'Gerät: Undo stellt den Freeze wieder her');
  const bleibt = [
    { befehl: 'spur_aendern', spur_id: 's3', fader_db: -3, pan: 0.2, mute: true, name: 'L', farbe: '#010203' },
    { befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 },
    { befehl: 'clip_loeschen', clip_id: 'c1' }, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ beat: 5, laenge: 1, ton: 40, vel: 90 }] },
    { befehl: 'clip_aendern', clip_id: 'c3', name: 'nur umbenannt' },
    { befehl: 'spur_verschieben', spur_id: 's3', index: 0 }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 },
    { befehl: 'metronom_setzen', an: true },
  ];
  for (const b of bleibt) assert.deepEqual(frz(ok(p, b).projekt), p.spuren[2].freeze, `${b.befehl} lässt den Freeze`);
});

test('fuehreListeAus: Befehle nacheinander (spätere sehen frühere), ein Gesamt-Patch, Ablehnung nennt den Index und lässt nichts zurück', () => {
  const p = leer();
  const r = fuehreListeAus(p, [
    { befehl: 'spur_neu', art: 'audio', name: 'Kick' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: SHA_A },
    { befehl: 'clip_teilen', clip_id: 'c1', beat: 0.5 },
    { befehl: 'spur_aendern', spur_id: 's1', fader_db: -4 },
  ]);
  pruefeErgebnis(p, r);
  assert.equal(r.projekt.spuren[0].clips.length, 2);
  assert.deepEqual(r.regler_aenderungen.filter((x) => x.pfad === 'spur/1/fader'), [{ pfad: 'spur/1/fader', wert: -4 }], 'ein Eintrag je Regler, letzter Wert');
  assert.throws(() => fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_loeschen', spur_id: 'sX' }]),
    (e) => e instanceof BefehlFehler && e.grund === 'spur_unbekannt' && e.index === 1);
  assert.throws(() => fuehreListeAus(p, []), (e) => e.grund === 'argument_ungueltig');
  assert.equal(p.spuren.length, 0);
  // Anlegen und Löschen im selben Aufruf: Gesamt-Patch leer
  assert.deepEqual(fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_loeschen', spur_id: 's1' }]).vor, []);
});

test('vergleiche: leitet Wiedergabe-Betroffenheit und Reglerwerte aus zwei Ständen ab (Undo/Redo nutzen das)', () => {
  const p = specProjekt(); const q = kopie(p); q.spuren[1].pan = -1; q.spuren.pop();
  const v = vergleiche(p, q);
  assert.equal(v.betrifft_wiedergabe, true);
  assert.deepEqual(v.regler_aenderungen, [{ pfad: 'spur/2/pan', wert: -1 }, { pfad: 'spur/3/fader', wert: 0 }, { pfad: 'spur/3/pan', wert: 0 }, { pfad: 'spur/3/mute', wert: 0 }, { pfad: 'spur/3/solo', wert: 0 }]);
  assert.deepEqual(vergleiche(p, kopie(p)), { betrifft_wiedergabe: false, regler_aenderungen: [] });
});

test('gleicheDekodiertAb: gleicht Audio-Clips mit dem Zustand des Caches ab; erhöht rev genau dann, wenn etwas anders ist', () => {
  const p = specProjekt(); p.spuren[0].clips[0].dekodiert = 'laeuft';
  const q = gleicheDekodiertAb(p, (sha) => (sha === SHA_A ? 'fertig' : 'nein'));
  assert.equal(q.spuren[0].clips[0].dekodiert, 'fertig'); assert.equal(q.rev, p.rev + 1);
  const r = gleicheDekodiertAb(q, (sha) => 'fertig'); assert.equal(r, q, 'nichts zu tun: dasselbe Objekt, rev gleich');
  assert.equal(p.spuren[0].clips[0].dekodiert, 'laeuft');
});

// Plan E3 Task 10, feindliche Parameter (Vorbild SoundCraft hostile_params.rs): jede Zeile wirft BefehlFehler mit Grund,
// nie etwas anderes, und das Projekt bleibt tief gleich. Negativ-Kontrolle: eine gültige Zeile ändert es.
test('feindliche Parameter: spur_neu/spur_aendern/spur_loeschen werfen nur BefehlFehler und lassen das Projekt unberührt', () => {
  let p = leer();
  for (let i = 1; i <= MAX_SPUREN; i++) p = ok(p, { befehl: 'spur_neu', art: 'audio' }).projekt;
  const voll = p;
  let eine = leer(); eine = ok(eine, { befehl: 'spur_neu', art: 'audio' }).projekt;
  const boese = [0, 11, 33, -1, 1.5, NaN, '10', `s${MAX_SPUREN + 1}`, null, {}, [], 's0'];
  const zeilen = [
    ...boese.map((v) => [eine, { befehl: 'spur_aendern', spur_id: v, fader_db: -6 }]),
    ...boese.map((v) => [eine, { befehl: 'spur_loeschen', spur_id: v }]),
    ...boese.map((v) => [eine, { befehl: 'spur_neu', art: 'audio', nr: v }]),
    ...[NaN, Infinity, -Infinity, 1e9, -1e9, '−6', null].map((v) => [eine, { befehl: 'spur_aendern', spur_id: 's1', fader_db: v }]),
    [voll, { befehl: 'spur_neu', art: 'audio' }],
  ];
  for (const [q, b] of zeilen) {
    const vorher = structuredClone(q);
    let e;
    try { fuehreAus(q, b); } catch (x) { e = x; }
    assert.ok(e instanceof BefehlFehler && typeof e.grund === 'string' && e.grund.length > 0, `BefehlFehler mit Grund erwartet für ${JSON.stringify(b)}, war ${e}`);
    assert.deepEqual(q, vorher, `Projekt verändert durch ${JSON.stringify(b)}`);
  }
  const g = fuehreAus(eine, { befehl: 'spur_aendern', spur_id: 's1', fader_db: -6 });
  assert.equal(g.projekt.spuren[0].fader_db, -6, 'Negativ-Kontrolle: gültige Zeile ändert das Projekt');
});
