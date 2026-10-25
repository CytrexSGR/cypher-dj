// Paket 1.13 Warp, Slice 1: Befehle clip_neu (warp), warp_setzen, warp_auto (ohne Katalog), clip_aendern (versatz_beats, offset_s bei Warp),
// clip_teilen (versatz exakt in Beats), clip_duplizieren; jeder mit Undo-Rundlauf und Ablehnungen samt Positivkontrolle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../projekt/befehle.ts';
import { neuesProjekt, pruefeProjekt, MAX_MARKER } from '../projekt/modell.ts';
import { wende } from '../projekt/patch.ts';
import { SHA_A, ohneAbgeleitetes } from './hilfen/projekt.mjs';

const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund,
  `erwartet ${grund} für ${JSON.stringify(b).slice(0, 100)}`);
const warp = (extra = {}) => ({ an: true, modus: 'repitch', marker: [[0, 0], [3.84, 8]], versatz_beats: 0, quelle: 'takte', transpose_st: 0, detune_ct: 0, ...extra });
// Projekt mit einer Audio-Spur s1 und einem gewarpten Clip c1 (Beat 4, 8 Beats)
function aufbau(w = warp(), tempo = 128) {
  let p = neuesProjekt('W');
  p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'tempo_setzen', bpm: tempo },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 8, sha256: SHA_A, pfad_hinweis: '/x/loop.wav', ...(w ? { warp: w } : {}) }]).projekt;
  return p;
}
const clip = (p, id = 'c1') => p.spuren.flatMap((s) => s.clips).find((c) => c.id === id);
// Ergebnis ist gültig, vor/zurück führen hin und zurück
function pruefe(p, r) {
  assert.ok(pruefeProjekt(r.projekt).projekt, JSON.stringify(pruefeProjekt(r.projekt)));
  assert.equal(ohneAbgeleitetes(wende(p, r.vor)), ohneAbgeleitetes(r.projekt));
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p));
  for (const o of [...r.vor, ...r.zurueck]) assert.ok(!/\/\d+(\/|$)/.test(o.pfad), `Index im Pfad ${o.pfad}`);
}

test('clip_neu mit warp-Objekt: der Clip trägt eine Kopie; ohne, null und "aus" bleibt er ohne; auto ohne Katalog und MIDI lehnen ab', () => {
  const p = aufbau();
  assert.deepEqual(clip(p).warp, warp());
  const w = warp(); const q = aufbau(w); w.marker[1][1] = 99; assert.equal(clip(q).warp.marker[1][1], 8, 'der Clip hält eine Kopie, nicht das Argument');
  for (const x of [undefined, null, 'aus']) assert.equal('warp' in clip(aufbau(x === undefined ? null : x)), false, `warp ${x}`);
  const leer = fuehreAus(aufbau(null), { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: SHA_A, warp: 'aus' });
  assert.equal('warp' in clip(leer.projekt, 'c2'), false); pruefe(aufbau(null), leer);
  const basis = { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: SHA_A };
  lehntAb(p, { ...basis, warp: 'auto' }, 'argument_ungueltig');
  lehntAb(p, { ...basis, warp: 'schnell' }, 'argument_ungueltig');
  lehntAb(p, { ...basis, warp: warp({ marker: [[0, 0]] }) }, 'warp_marker');
  lehntAb(p, { ...basis, warp: warp({ transpose_st: 3 }) }, 'transpose_repitch');
  const m = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument' }).projekt;
  lehntAb(m, { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 4, warp: warp() }, 'feld_nur_audio');
  const b0 = fuehreAus(neuesProjekt('x'), { befehl: 'spur_neu', art: 'audio' }).projekt;
  pruefe(b0, fuehreAus(b0, { ...basis, warp: warp() }));
});

test('warp_setzen: Schalter, ganzes Objekt, Entfernen; Ablehnungen mit Grund', () => {
  const p = aufbau();
  let r = fuehreAus(p, { befehl: 'warp_setzen', clip_id: 'c1', an: false });
  pruefe(p, r); assert.equal(clip(r.projekt).warp.an, false); assert.deepEqual(clip(r.projekt).warp.marker, [[0, 0], [3.84, 8]], 'die Marker bleiben');
  assert.equal(r.betrifft_wiedergabe, true, 'aus ändert den Klang');
  const r2 = fuehreAus(r.projekt, { befehl: 'warp_setzen', clip_id: 'c1', an: true });
  pruefe(r.projekt, r2); assert.equal(clip(r2.projekt).warp.an, true);
  const neu = fuehreAus(p, { befehl: 'warp_setzen', clip_id: 'c1', warp: warp({ marker: [[0, 0], [2, 4], [4, 8]], quelle: 'hand' }) });
  pruefe(p, neu); assert.equal(clip(neu.projekt).warp.marker.length, 3);
  for (const x of [null, 'aus']) { const w = fuehreAus(p, { befehl: 'warp_setzen', clip_id: 'c1', warp: x }); pruefe(p, w); assert.equal('warp' in clip(w.projekt), false); }
  // auf einem Clip ohne Warp: ganzes Objekt geht, einzelne Felder nicht
  const ohne = aufbau(null);
  const an = fuehreAus(ohne, { befehl: 'warp_setzen', clip_id: 'c1', warp: warp() }); pruefe(ohne, an); assert.equal(clip(an.projekt).warp.an, true);
  lehntAb(ohne, { befehl: 'warp_setzen', clip_id: 'c1', an: true }, 'kein_warp');
  lehntAb(p, { befehl: 'warp_setzen', clip_id: 'c1' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'warp_setzen', clip_id: 'c1', warp: warp(), an: false }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'warp_setzen', clip_id: 'c1', transpose_st: 2 }, 'transpose_repitch');
  lehntAb(p, { befehl: 'warp_setzen', clip_id: 'c1', modus: 'complex' }, 'warp_modus');
  lehntAb(p, { befehl: 'warp_setzen', clip_id: 'c1', an: 'ja' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'warp_setzen', clip_id: 'c1', warp: warp({ marker: [[0, 0], [6, 1]] }) }, 'warp_faktor');
  lehntAb(p, { befehl: 'warp_setzen', clip_id: 'c9', an: false }, 'clip_unbekannt');
  lehntAb(p, { befehl: 'warp_setzen', clip_id: 'c1', farbe: 'rot' }, 'argument_unbekannt');
  const m = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument' }).projekt;
  const mm = fuehreAus(m, { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 4 }).projekt;
  lehntAb(mm, { befehl: 'warp_setzen', clip_id: 'c2', an: true }, 'feld_nur_audio');
});

test('warp_auto ohne Katalog lehnt ab (der Server löst es auf, sitzung.ts)', () => {
  lehntAb(aufbau(), { befehl: 'warp_auto', clip_id: 'c1' }, 'argument_ungueltig');
  lehntAb(aufbau(), { befehl: 'warp_auto', clip_id: 'c9' }, 'clip_unbekannt');
  const m = fuehreAus(aufbau(), { befehl: 'spur_neu', art: 'instrument' }).projekt;   // Gesamtreview Minor 1: auf MIDI der Grund wie bei warp_setzen
  const mm = fuehreAus(m, { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 4 }).projekt;
  lehntAb(mm, { befehl: 'warp_auto', clip_id: 'c2' }, 'feld_nur_audio');
});

test('betrifft_wiedergabe: ein Warp mit an=false ändert den Klang nicht, ein Marker bei an=true schon', () => {
  const aus = aufbau(warp({ an: false }));
  const r = fuehreAus(aus, { befehl: 'warp_setzen', clip_id: 'c1', warp: warp({ an: false, marker: [[0, 0], [2, 4], [4, 8]] }) });
  assert.equal(r.betrifft_wiedergabe, false, 'ein ausgeschalteter Warp hört niemand');
  const an = fuehreAus(aufbau(), { befehl: 'warp_setzen', clip_id: 'c1', warp: warp({ marker: [[0, 0], [2, 4], [4, 8]] }) });
  assert.equal(an.betrifft_wiedergabe, true);
});

test('clip_aendern: versatz_beats nur mit Warp; offset_s ist bei Warp an gesperrt, bei Warp aus erlaubt', () => {
  const p = aufbau();
  const r = fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c1', versatz_beats: 2.5 });
  pruefe(p, r); assert.equal(clip(r.projekt).warp.versatz_beats, 2.5); assert.equal(r.betrifft_wiedergabe, true);
  lehntAb(p, { befehl: 'clip_aendern', clip_id: 'c1', offset_s: 1 }, 'offset_bei_warp');
  lehntAb(aufbau(null), { befehl: 'clip_aendern', clip_id: 'c1', versatz_beats: 1 }, 'kein_warp');
  lehntAb(p, { befehl: 'clip_aendern', clip_id: 'c1', versatz_beats: 1e9 }, 'argument_ungueltig');
  // derselbe Grund wie bei warp_setzen (Prüfung 2, MINOR 5): ein Versatz, nach dessen Abzug zwei Marker-Beats zusammenfallen, ist warp_marker, nicht projekt_ungueltig
  const eng = aufbau(warp({ marker: [[0, 0], [1e-11, 5e-12]] }));   // 30 BPM, ohne Versatz gültig; 5e-12 ist bei Versatz 1e5 (Abstand der Doubles dort 1,5e-11) kleiner als ein halber Schritt
  assert.equal(clip(eng).warp.marker[1][1], 5e-12, 'Positivkontrolle: der Warp ist ohne Versatz gültig und steht im Clip');
  lehntAb(eng, { befehl: 'clip_aendern', clip_id: 'c1', versatz_beats: 1e5 }, 'warp_marker');
  const aus = aufbau(warp({ an: false }));
  const o = fuehreAus(aus, { befehl: 'clip_aendern', clip_id: 'c1', offset_s: 1 }); assert.equal(clip(o.projekt).offset_s, 1);
  const ohne = fuehreAus(aufbau(null), { befehl: 'clip_aendern', clip_id: 'c1', offset_s: 1 }); assert.equal(clip(ohne.projekt).offset_s, 1, 'ohne Warp wie bisher');
  const m = fuehreAus(fuehreAus(p, { befehl: 'spur_neu', art: 'instrument' }).projekt, { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 4 }).projekt;
  lehntAb(m, { befehl: 'clip_aendern', clip_id: 'c2', versatz_beats: 1 }, 'feld_nur_audio');
});

test('clip_teilen: der zweite Teil beginnt rel Beats weiter im Inhalt, exakt in Beats und unabhängig vom Tempo', () => {
  for (const tempo of [100, 128, 175]) {
    const p = aufbau(warp({ versatz_beats: 1.5 }), tempo);
    const r = fuehreAus(p, { befehl: 'clip_teilen', clip_id: 'c1', beat: 7 });
    pruefe(p, r);
    const [a, b] = r.projekt.spuren[0].clips;
    assert.equal(a.warp.versatz_beats, 1.5, 'der erste Teil bleibt'); assert.equal(b.warp.versatz_beats, 4.5, `1,5 + 3 Beats bei ${tempo} BPM`);
    assert.deepEqual(b.warp.marker, a.warp.marker, 'die Marker bleiben gleich, nur der Versatz wandert');
    assert.deepEqual([a.start_beat, a.laenge_beats, b.start_beat, b.laenge_beats], [4, 3, 7, 5]);
  }
  const ohne = fuehreAus(aufbau(null), { befehl: 'clip_teilen', clip_id: 'c1', beat: 7 });
  assert.equal('warp' in ohne.projekt.spuren[0].clips[1], false, 'ohne Warp wie bisher');
});

test('clip_duplizieren und Loop behalten den Warp; Marker-Gesamtgrenze nach dem Ausrollen (zu_gross)', () => {
  const p = aufbau();
  const d = fuehreAus(p, { befehl: 'clip_duplizieren', clip_id: 'c1' });
  pruefe(p, d); assert.deepEqual(clip(d.projekt, 'c2').warp, clip(p).warp);
  const viele = [...Array(MAX_MARKER)].map((_, i) => [i * 0.5, i]);
  const mit = (n) => aufbau(null) && fuehreListeAus(aufbau(null), [...Array(n)].map((_, i) => ({ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: i * 2,
    laenge_beats: 1, sha256: SHA_A, warp: warp({ marker: viele }) })));
  assert.ok(mit(64).projekt, '64 Clips mit 4096 Markern = 262 144: genau die Grenze');
  assert.throws(() => mit(65), (e) => e instanceof BefehlFehler && e.grund === 'zu_gross');
  // Loop: jede Kopie trägt die Liste
  const l = fuehreListeAus(aufbau(warp({ marker: viele })), [{ befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 8, loop_beats: 1 }]);
  assert.ok(l.projekt);
  assert.throws(() => fuehreAus(l.projekt, { befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 70, loop_beats: 1 }),
    (e) => e instanceof BefehlFehler && e.grund === 'zu_gross', '70 Kopien · 4096 Marker > 262 144');
});
