// Paket 1.13 Slice 6: reine Stems-Rechnung. Ziel (D14), Ausschnitt in Frames (D5, D9), Stem-Warp (D5 bis D7), neuer Stand (F4, D8), Veraltet (D16).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus } from '../projekt/befehle.ts';
import { neuesProjekt, MAX_GRUPPEN } from '../projekt/modell.ts';
import { quellSekunde } from '../projekt/warp.ts';
import { stemsPlan, stemWarp, baueStemsProjekt, pruefeNochGleich, STEMS, StemsFehler } from '../projekt/stems.ts';

const SHA = 'c'.repeat(64);
const lauf = (p, befehle, quelle = 'andreas') => fuehreListeAus(p, befehle, { quelle }).projekt;
// 120 BPM; Spur s1 mit Clip c1 ab Beat 8, 16 Beats; mit Warp: Marker 0 s → Beat 0, 10 s → Beat 16 (96 BPM in der Quelle), versatz 2
const W = { an: true, modus: 'complex', marker: [[0, 0], [10, 16]], versatz_beats: 2, quelle: 'takte', transpose_st: 3, detune_ct: 0 };
function projekt({ warp = true } = {}) {
  let p = neuesProjekt('T');
  p = lauf(p, [{ befehl: 'spur_neu', art: 'audio', name: 'Loop' }, { befehl: 'spur_neu', art: 'audio', name: 'Andere' }]);
  return lauf(p, [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 8, laenge_beats: 16, sha256: SHA, name: 'Groove',
    ...(warp ? { warp: W } : {}) }]);
}
const fehler = (f) => { try { f(); } catch (e) { assert.ok(e instanceof StemsFehler, String(e)); return e.grund; } return null; };

test('S6 Ausschnitt: Warp-Clip, Bereich in Projekt-Beats → Quell-Frames nach W (P7), n = F1 − F0', () => {
  const p = projekt();
  const z = stemsPlan(p, { clip_id: 'c1', von_beat: 10, bis_beat: 18 });
  const m = [[0, 0], [10, 16]];
  assert.equal(z.f0, Math.round(quellSekunde(m, 10 - 8 + 2) * 48000));       // Clip-Beat 4 → 2,5 s
  assert.equal(z.f1, Math.round(quellSekunde(m, 18 - 8 + 2) * 48000));       // Clip-Beat 12 → 7,5 s
  assert.equal(z.n, z.f1 - z.f0);
  assert.deepEqual([z.von, z.bis, z.clipId, z.spurId, z.sha256], [10, 18, 'c1', 's1', SHA]);
});

test('S6 Ausschnitt ohne Warp (D6): offset_s + Beats · 60 / tempo', () => {
  let p = projekt({ warp: false });
  p = lauf(p, [{ befehl: 'clip_aendern', clip_id: 'c1', offset_s: 1.5 }]);
  const z = stemsPlan(p, { clip_id: 'c1' });
  assert.equal(z.f0, Math.round(1.5 * 48000));
  assert.equal(z.f1, Math.round((1.5 + 16 * 60 / p.tempo_bpm) * 48000));
});

test('S6 Ziel: genau ein Audio-Clip (D14), Loop (D14), Bereich im Clip, Grenze 600 s (D9), Spuren (D16)', () => {
  const p = projekt();
  assert.equal(fehler(() => stemsPlan(p, { spur_id: 's1' })), null);
  assert.equal(stemsPlan(p, { spur_id: 's1', von_beat: 0, bis_beat: 100 }).von, 8);            // auf den Clip begrenzt
  const zwei = lauf(p, [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 30, laenge_beats: 4, sha256: SHA }]);
  assert.equal(fehler(() => stemsPlan(zwei, { spur_id: 's1' })), 'mehrere_clips');
  assert.equal(fehler(() => stemsPlan(zwei, { spur_id: 's2' })), 'mehrere_clips');               // keiner ist auch nicht genau einer
  assert.equal(fehler(() => stemsPlan(zwei, { spur_id: 's1', von_beat: 30, bis_beat: 34 })), null);
  const loop = lauf(p, [{ befehl: 'clip_aendern', clip_id: 'c1', loop_beats: 4 }]);
  assert.equal(fehler(() => stemsPlan(loop, { clip_id: 'c1' })), 'stems_loop');
  assert.equal(fehler(() => stemsPlan(p, { clip_id: 'c1', von_beat: 4, bis_beat: 12 })), 'argument_ungueltig');
  assert.equal(fehler(() => stemsPlan(p, { clip_id: 'c1', spur_id: 's1' })), 'argument_ungueltig');
  assert.equal(fehler(() => stemsPlan(p, { clip_id: 'c9' })), 'clip_unbekannt');
  // zu_gross nur ohne Warp erreichbar: gewarpt sind 16 Beats bei SEGMENT_BPM_MIN 15 höchstens 64 s; 1300 Beats bei 120 BPM = 650 s
  const lang = lauf(projekt({ warp: false }), [{ befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 1300 }]);
  assert.equal(fehler(() => stemsPlan(lang, { clip_id: 'c1' })), 'stems_zu_gross');
  let voll = p;
  for (let i = voll.spuren.length; i < 29; i++) voll = lauf(voll, [{ befehl: 'spur_neu', art: 'audio' }]);
  assert.equal(fehler(() => stemsPlan(voll, { clip_id: 'c1' })), 'zu_viele_spuren');            // 29 + 4 > 32
  assert.equal(fehler(() => stemsPlan(lauf(voll, [{ befehl: 'spur_loeschen', spur_id: 's2' }]), { clip_id: 'c1' })), null);
});

test('S6 Stem-Warp: W_stem(b) + F0/48000 = W_orig(b) im ganzen Bereich, Felder geerbt (D5, D7)', () => {
  const p = projekt();
  const orig = p.spuren[0].clips[0].warp;
  const reich = { ...orig, marker: [[0, 0], [2, 3.5], [5, 8], [7.6, 12.25], [10, 16]] };
  const z = { f0: Math.round(2.5 * 48000) + 7, f1: Math.round(7.5 * 48000) - 3, bClip0: 4 };
  const w = stemWarp(reich, z.bClip0, z.f0, z.f1);
  assert.deepEqual([w.modus, w.transpose_st, w.detune_ct, w.versatz_beats], ['complex', 3, 0, 4]);
  assert.equal(w.marker[0][0], 0);
  assert.equal(w.marker.at(-1)[0], (z.f1 - z.f0) / 48000);
  for (let b = 4; b <= 12; b += 0.125) {
    const d = quellSekunde(w.marker, b) + z.f0 / 48000 - quellSekunde(reich.marker, b);
    assert.ok(Math.abs(d) * 48000 < 0.5, `Beat ${b}: ${d * 48000} Samples`);
  }
  const mitBeats = stemWarp({ ...reich, modus: 'beats', transpose_st: 0, beats: { raster: '1/8', loop: 'aus', huelle: 50 } }, 4, z.f0, z.f1);
  assert.deepEqual(mitBeats.beats, { raster: '1/8', loop: 'aus', huelle: 50 });
});

test('S6 neuer Stand: Original im Bereich stumm, vier Spuren darunter in einer Gruppe, Clips mit Warp (F4, D8)', () => {
  const p = projekt();
  const z = stemsPlan(p, { clip_id: 'c1', von_beat: 10, bis_beat: 18 });
  const dateien = Object.fromEntries(STEMS.map((s, i) => [s, { sha256: String(i + 1).repeat(64), pfad: `/p/stems/7-groove-${s}.wav` }]));
  const r = baueStemsProjekt(p, z, dateien, 'andreas');
  const q = r.projekt;
  assert.deepEqual(q.spuren.map((s) => s.name), ['Loop', 'Groove Drums', 'Groove Bass', 'Groove Other', 'Groove Vocals', 'Andere']);
  const orig = q.spuren[0].clips;
  assert.deepEqual(orig.map((c) => [c.start_beat, c.laenge_beats, c.stumm === true]), [[8, 2, false], [10, 8, true], [18, 6, false]]);
  const g = q.gruppen.at(-1);
  assert.equal(g.name, 'Stems: Groove');
  for (const [i, s] of STEMS.entries()) {
    const sp = q.spuren[1 + i];
    assert.deepEqual(sp.ausgang, { art: 'gruppe', id: g.id });
    const c = sp.clips[0];
    assert.deepEqual([c.start_beat, c.laenge_beats, c.quelle.sha256, c.quelle.pfad_hinweis], [10, 8, dateien[s].sha256, dateien[s].pfad]);
    assert.equal(c.warp.versatz_beats, 10 - 8 + 2);
    assert.equal(c.warp.transpose_st, 3);
  }
  assert.deepEqual(r.spuren, q.spuren.slice(1, 5).map((s) => s.id));
  assert.equal(r.hinweis, undefined);
  assert.ok(q.spuren.slice(1, 5).every((s) => s.fader_db === 0 && s.pan === 0));
});

test('S6 neuer Stand: Stem-Spuren erben Fader und Pan der Quellspur (Review MINOR 6), der Ausgang ist die neue Gruppe', () => {
  const p = lauf(projekt(), [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -6, pan: 0.25 }]);
  const dateien = Object.fromEntries(STEMS.map((s) => [s, { sha256: 'f'.repeat(64), pfad: `/p/${s}.wav` }]));
  const q = baueStemsProjekt(p, stemsPlan(p, { clip_id: 'c1' }), dateien, 'andreas').projekt;
  for (const s of q.spuren.slice(1, 5)) {
    assert.deepEqual([s.fader_db, s.pan, s.ausgang?.id], [-6, 0.25, q.gruppen.at(-1).id]);
  }
});

test('S6 neuer Stand: ohne Warp offset 0; bei MAX_GRUPPEN ohne Gruppe mit Hinweis (D6, D8); Spur von cypher (Herkunft)', () => {
  let p = projekt({ warp: false });
  p = lauf(p, Array.from({ length: MAX_GRUPPEN }, (_, i) => ({ befehl: 'gruppenspur_neu', name: `G${i}` })));
  const z = stemsPlan(p, { clip_id: 'c1' });
  const dateien = Object.fromEntries(STEMS.map((s) => [s, { sha256: 'd'.repeat(64), pfad: `/p/${s}.wav` }]));
  const r = baueStemsProjekt(p, z, dateien, 'cypher');
  assert.equal(r.hinweis, 'stems_ohne_gruppe');
  const c = r.projekt.spuren[1].clips[0];
  assert.equal(c.offset_s, 0); assert.equal(c.warp, undefined); assert.equal(c.laenge_beats, 16);
  assert.equal(r.projekt.spuren[1].von, 'cypher');
  assert.equal(r.projekt.spuren[0].clips[0].stumm, true);                                          // ganzer Clip: nichts geteilt
});

test('S6 Veraltet (D16): Start, Länge, sha, Marker, Loop, weg; Gain ist egal (Negativ-Kontrolle)', () => {
  const p = projekt();
  const z = stemsPlan(p, { clip_id: 'c1', von_beat: 10, bis_beat: 18 });
  assert.equal(pruefeNochGleich(p, z), null);
  assert.equal(pruefeNochGleich(lauf(p, [{ befehl: 'clip_aendern', clip_id: 'c1', gain_db: -6 }]), z), null);
  for (const b of [{ befehl: 'clip_aendern', clip_id: 'c1', start_beat: 9 }, { befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 9 },
    { befehl: 'warp_setzen', clip_id: 'c1', warp: { ...W, marker: [[0, 0], [11, 16]] } }, { befehl: 'clip_aendern', clip_id: 'c1', loop_beats: 4 },
    { befehl: 'clip_loeschen', clip_id: 'c1' }]) {
    assert.equal(pruefeNochGleich(lauf(p, [b]), z), 'veraltet', JSON.stringify(b));
  }
});

test('S6 Lage gegen das feste Raster (W4): Stem-Clip trifft an festen Projekt-Beats die absolute Quellsekunde des Originals', () => {
  // W: 10 s = 16 Beats linear, versatz 2, Clip ab Beat 8: Projekt-Beat 10 → Clip-Beat 4 → 2,5 s; 14 → 8 → 5 s; 18 → 12 → 7,5 s
  const p = projekt();
  const z = stemsPlan(p, { clip_id: 'c1', von_beat: 10, bis_beat: 18 });
  const r = baueStemsProjekt(p, z, Object.fromEntries(STEMS.map((s) => [s, { sha256: 'e'.repeat(64), pfad: `/p/${s}.wav` }])), 'andreas');
  const c = r.projekt.spuren[1].clips[0];
  for (const [P, abs] of [[10, 2.5], [12, 3.75], [14, 5], [16, 6.25], [18, 7.5]]) {
    const s = quellSekunde(c.warp.marker, P - c.start_beat + c.warp.versatz_beats) + z.f0 / 48000;
    assert.ok(Math.abs(s - abs) * 48000 < 1, `Projekt-Beat ${P}: ${s} statt ${abs}`);
  }
});

const dat = (c = 'a') => Object.fromEntries(STEMS.map((s) => [s, { sha256: c.repeat(64), pfad: `/p/${s}.wav` }]));

test('S6 NB MAJOR 1: zwei Clips am selben Start, der gewählte (der später liegende) wird zerlegt und stumm, der andere bleibt hörbar', () => {
  let p = projekt();
  p = lauf(p, [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 8, laenge_beats: 4, sha256: 'b'.repeat(64), name: 'Kurz' }]);
  const kurz = p.spuren[0].clips.find((c) => c.name === 'Kurz').id;
  for (const [von, bis] of [[8, 12], [9, 11], [10, 12]]) {
    const z = stemsPlan(p, { clip_id: kurz, von_beat: von, bis_beat: bis });
    const q = baueStemsProjekt(p, z, dat(), 'andreas').projekt;
    assert.equal(q.spuren[0].clips.find((c) => c.id === 'c1').stumm, undefined, `Groove bleibt hörbar (${von}..${bis})`);
    const st = q.spuren[0].clips.filter((c) => c.stumm === true);
    assert.deepEqual(st.map((c) => [c.start_beat, c.laenge_beats, c.quelle.sha256]), [[von, bis - von, 'b'.repeat(64)]]);
  }
});

test('S6 NB MAJOR 2: Tempo ungewarpt verändert → veraltet; gewarpt egal; offset_s ungewarpt → veraltet; Gain/Fades egal', () => {
  const u = projekt({ warp: false });
  const zu = stemsPlan(u, { clip_id: 'c1', von_beat: 10, bis_beat: 18 });
  assert.equal(pruefeNochGleich(u, zu), null);
  assert.equal(pruefeNochGleich(lauf(u, [{ befehl: 'tempo_setzen', bpm: 100 }]), zu), 'veraltet');
  assert.equal(pruefeNochGleich(lauf(u, [{ befehl: 'clip_aendern', clip_id: 'c1', offset_s: 0.5 }]), zu), 'veraltet');
  assert.equal(pruefeNochGleich(lauf(u, [{ befehl: 'clip_aendern', clip_id: 'c1', gain_db: -3, fade_ein_beats: 1, fade_aus_beats: 1 }]), zu), null);
  const g = projekt();
  const zg = stemsPlan(g, { clip_id: 'c1', von_beat: 10, bis_beat: 18 });
  assert.equal(pruefeNochGleich(lauf(g, [{ befehl: 'tempo_setzen', bpm: 100 }]), zg), null);
});

test('S6 NB MINOR 1: krummes Tempo und offset, nicht ganzzahlige Frames (round, nicht floor); Gain/Fades werden geerbt', () => {
  let p = projekt({ warp: false });
  p = lauf(p, [{ befehl: 'tempo_setzen', bpm: 97.3 }, { befehl: 'clip_aendern', clip_id: 'c1', offset_s: 1.234, gain_db: -4.5,
    fade_ein_beats: 0.5, fade_aus_beats: 1 }]);
  const z = stemsPlan(p, { clip_id: 'c1', von_beat: 9, bis_beat: 17 });
  const s0 = 1.234 + 1 * 60 / 97.3, s1 = 1.234 + 9 * 60 / 97.3;
  assert.ok(Math.abs(s0 * 48000 - Math.round(s0 * 48000)) > 0.1 && Math.abs(s1 * 48000 - Math.round(s1 * 48000)) > 0.1, 'Fall trennt round/floor');
  assert.deepEqual([z.f0, z.f1], [Math.round(s0 * 48000), Math.round(s1 * 48000)]);
  assert.ok(Math.abs(s0 * 48000 - Math.floor(s0 * 48000)) > 0.5 || Math.abs(s1 * 48000 - Math.floor(s1 * 48000)) > 0.5, 'floor wäre anders');
  const q = baueStemsProjekt(p, z, dat(), 'andreas').projekt;
  const mitte = q.spuren[0].clips.find((c) => c.stumm === true);                                  // Fades gehören den Clip-Enden, das Mittelstück hat 0 / 0
  for (const sp of q.spuren.slice(1, 5)) assert.deepEqual([sp.clips[0].gain_db, sp.clips[0].fade_ein_beats, sp.clips[0].fade_aus_beats],
    [-4.5, mitte.fade_ein_beats, mitte.fade_aus_beats]);
  const ganz = baueStemsProjekt(p, stemsPlan(p, { clip_id: 'c1' }), dat(), 'andreas').projekt;     // ganzer Clip: Fades 0,5 / 1 kommen mit
  for (const sp of ganz.spuren.slice(1, 5)) assert.deepEqual([sp.clips[0].gain_db, sp.clips[0].fade_ein_beats, sp.clips[0].fade_aus_beats], [-4.5, 0.5, 1]);
});

test('S6 NB MINOR 2: mute der Quellspur wird geerbt, solo nicht; Ausgang bleibt die Stems-Gruppe', () => {
  const p = lauf(projekt(), [{ befehl: 'spur_aendern', spur_id: 's1', mute: true, solo: true }]);
  const q = baueStemsProjekt(p, stemsPlan(p, { clip_id: 'c1' }), dat(), 'andreas').projekt;
  for (const s of q.spuren.slice(1, 5)) assert.deepEqual([s.mute, s.solo, s.ausgang.id], [true, false, q.gruppen.at(-1).id]);
  const n = baueStemsProjekt(projekt(), stemsPlan(projekt(), { clip_id: 'c1' }), dat(), 'andreas').projekt;
  assert.ok(n.spuren.slice(1, 5).every((s) => s.mute === false));
});
