// D1 S2-Kern, Abnahme A8 ohne Server: anlegen → 30 gemischte Befehle → speichern → öffnen → normalisiert gleich; Undo bis zum Anfang
// ergibt das Ausgangsprojekt, Redo bis zum Ende das Endprojekt, Neustart mitten im Verlauf denselben Zeiger.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Projekte, normalisiere } from '../projekt/ablage.ts';
import { Verlauf, aendere, rueckgaengig, wiederholen } from '../projekt/verlauf.ts';
import { kanonisch, pruefeProjekt } from '../projekt/modell.ts';
import { uebersetze } from '../projekt/wiedergabe.ts';
import { tmpOrdner, ohneAbgeleitetes, SHA_A, SHA_B } from './hilfen/projekt.mjs';

const ohneRev = (p) => ohneAbgeleitetes({ ...p, rev: 0, wiedergabe_rev: 0 });      // ohne ID-Zähler: sie steigen nur (Spec 6.26)
const N = (id, beat, laenge, ton, vel = 100) => ({ id, beat, laenge, ton, vel });
const fader = (id, w) => ({ befehl: 'spur_aendern', spur_id: id, fader_db: w });
// [Befehle, Pause danach in ms]. Fünf Fader-Bewegungen im Abstand von 200 ms fassen sich zu einem Eintrag zusammen.
const DREI_SIG = 30;
const SKRIPT = [
  [[{ befehl: 'spur_neu', art: 'audio', name: 'Kick' }], 5000],                                                                     // 1  s1
  [[{ befehl: 'spur_neu', art: 'instrument', name: 'Bass' }], 5000],                                                               // 2  s2 rb338
  [[{ befehl: 'spur_neu', art: 'instrument', name: 'Lead', geraet: { art: 'wirt', name: 'surge' } }], 5000],                       // 3  s3 Wirt 1
  [[{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 4, sha256: SHA_A, pfad_hinweis: '/x/kick.wav' }], 5000],   // 4 c1
  [[{ befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 16, noten: [{ beat: 0, laenge: 0.5, ton: 36, vel: 100 }, { beat: 1, laenge: 0.5, ton: 38, vel: 90 }, { beat: 15.5, laenge: 1, ton: 40, vel: 80 }] }], 5000],  // 5 c2
  [[{ befehl: 'clip_neu', spur_id: 's3', art: 'midi', start_beat: 0, laenge_beats: 8 }], 5000],                                     // 6  c3
  [[{ befehl: 'noten_neu', clip_id: 'c3', noten: [{ beat: 0, laenge: 1, ton: 60, vel: 90 }, { beat: 2, laenge: 2, ton: 64, vel: 90 }] }], 5000],   // 7
  [[{ befehl: 'noten_aendern', clip_id: 'c2', noten: [{ id: 'n1', ton: 37, vel: 110 }] }], 5000],                                  // 8
  [[{ befehl: 'noten_loeschen', clip_id: 'c2', ids: ['n2'] }], 5000],                                                              // 9
  [[{ befehl: 'clip_aendern', clip_id: 'c1', gain_db: -3, fade_ein_beats: 0.5, fade_aus_beats: 1, offset_s: 0.1 }], 5000],         // 10
  [[{ befehl: 'clip_teilen', clip_id: 'c1', beat: 2 }], 5000],                                                                     // 11 c4
  [[{ befehl: 'clip_duplizieren', clip_id: 'c2' }], 5000],                                                                         // 12 c5
  [[{ befehl: 'clip_aendern', clip_id: 'c3', start_beat: 4 }], 5000],                                                              // 13
  [[{ befehl: 'tempo_setzen', bpm: 128 }], 5000],                                                                                  // 14
  [[{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 32 }], 5000],                                                        // 15
  [[{ befehl: 'metronom_setzen', an: true, pegel_db: -18, ziel: 'cue' }], 5000],                                                   // 16
  [[fader('s1', -1)], 200], [[fader('s1', -2)], 200], [[fader('s1', -3)], 200], [[fader('s1', -4)], 200], [[fader('s1', -5)], 5000],   // 17-21 → ein Eintrag
  [[{ befehl: 'spur_aendern', spur_id: 's2', pan: -0.5 }], 5000],                                                                  // 22
  [[{ befehl: 'spur_aendern', spur_id: 's3', mute: true }], 5000],                                                                 // 23
  [[{ befehl: 'spur_aendern', spur_id: 's1', solo: true }], 5000],                                                                 // 24
  [[{ befehl: 'spur_verschieben', spur_id: 's3', index: 0 }], 5000],                                                               // 25
  [[{ befehl: 'clip_loeschen', clip_id: 'c4' }], 5000],                                                                            // 26
  [[{ befehl: 'spur_aendern', spur_id: 's1', name: 'Kick 2', farbe: '#112233' }], 5000],                                           // 27
  [[{ befehl: 'spur_aendern', spur_id: 's3', geraet: { art: 'intern', name: 'rb338', parameter: { cutoff: 0.4 } } }], 5000],       // 28
  [[{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 8, laenge_beats: 2, sha256: SHA_B }], 5000],                     // 29 c6
  [[{ befehl: 'spur_loeschen', spur_id: 's2' }], 5000],                                                                            // 30
];

function lauf(t) {
  const wurzel = tmpOrdner(t); const pr = new Projekte(wurzel); const { slug, projekt: ausgang } = pr.lege('Rundlauf');
  const uhr = { t: Date.parse('2026-10-15T12:00:00Z') };
  const v = pr.verlauf(slug, { jetzt: () => uhr.t, zeitgeber: false });
  const stand = new Map([[0, ausgang]]);
  let p = ausgang;
  assert.equal(SKRIPT.flatMap(([b]) => b).length, DREI_SIG, 'das Skript hat 30 Befehle');
  for (const [befehle, pause] of SKRIPT) {
    const r = aendere(v, p, befehle, { quelle: 'andreas', label: befehle[0].befehl });
    assert.ok(r.eintrag, `Befehl ${befehle[0].befehl} muss wirken`);
    p = r.projekt; pr.speichere(slug, p); stand.set(p.rev, p);
    uhr.t += pause;
  }
  v.flush();
  return { wurzel, pr, slug, v, uhr, ausgang, ende: p, stand };
}

test('A8 Rundlauf: 30 Befehle → speichern → öffnen: normalisiert gleich; die Datei ist normalisiert und beim Wiederspeichern byteidentisch', (t) => {
  const { wurzel, pr, slug, ende } = lauf(t);
  assert.equal(ende.rev, 30, 'jede Änderung zählt rev');
  const geladen = new Projekte(wurzel).lies(slug);
  assert.equal(kanonisch(geladen), kanonisch(ende));
  assert.deepEqual(geladen, normalisiere(ende));
  const roh = fs.readFileSync(path.join(wurzel, slug, 'project.json'), 'utf8');
  assert.equal(roh, JSON.stringify(normalisiere(ende), null, 1) + '\n');
  pr.speichere(slug, geladen);
  assert.equal(fs.readFileSync(path.join(wurzel, slug, 'project.json'), 'utf8'), roh, 'speichern(lies(x)) ändert kein Byte');
  assert.ok(pruefeProjekt(geladen).projekt);
  // Negativ-Kontrolle: ein einziger veränderter Wert macht den Vergleich rot (der Vergleich ist nicht leer)
  const fremd = structuredClone(geladen); fremd.spuren[0].clips[0].start_beat += 0.25;
  assert.notEqual(kanonisch(fremd), kanonisch(ende));
  // der Endstand ist inhaltlich der erwartete (nicht bloß „gleich zu sich selbst")
  assert.deepEqual(ende.spuren.map((s) => [s.id, s.nr]), [['s3', 3], ['s1', 1]], 's2 gelöscht, s3 nach vorn');
  assert.equal(ende.tempo_bpm, 128); assert.equal(ende.spuren[1].fader_db, -5); assert.equal(ende.spuren[0].geraet.parameter.cutoff, 0.4);
  assert.equal(ende.spuren[1].clips.length, 2); assert.equal(ende.spuren[1].name, 'Kick 2');
});

test('A8 Zusammenfassen im Rundlauf: die fünf Fader-Bewegungen sind EIN Eintrag; 26 Einträge für 30 Befehle', (t) => {
  const { v, wurzel, slug } = lauf(t);
  assert.equal(v.zeiger().undo.length, 26);
  const zeilen = fs.readFileSync(path.join(wurzel, slug, 'undo.jsonl'), 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z));
  assert.equal(zeilen.length, 26);
  const f = zeilen.filter((z) => z.vor[0]?.pfad === '/spuren/s1/fader_db');
  assert.equal(f.length, 1); assert.deepEqual([f[0].vor[0].wert, f[0].zurueck[0].wert, f[0].rev], [-5, 0, 21]);
});

test('A8 Undo bis zum Anfang ergibt das Ausgangsprojekt, Schritt für Schritt die Stände der Einträge; Redo bis zum Ende das Endprojekt', (t) => {
  const { v, uhr, ausgang, ende, stand, pr, slug } = lauf(t);
  let p = ende, schritte = 0;
  while (v.kannUndo()) {
    uhr.t += 1000;
    p = rueckgaengig(v, p, { quelle: 'andreas' }).projekt; schritte++;
    const top = v.zeiger().undo.at(-1);
    assert.equal(ohneRev(p), ohneRev(top === undefined ? ausgang : stand.get(top)), `Undo-Schritt ${schritte}`);
    pr.speichere(slug, p);                                                          // jeder Zwischenstand bleibt ein gültiges, speicherbares Projekt
  }
  assert.equal(schritte, 26); assert.equal(ohneRev(p), ohneRev(ausgang));
  assert.deepEqual(p.spuren, []);
  let r = 0;
  while (v.kannRedo()) {
    uhr.t += 1000; p = wiederholen(v, p, { quelle: 'cypher' }).projekt; r++;
    assert.equal(ohneRev(p), ohneRev(stand.get(v.zeiger().undo.at(-1))), `Redo-Schritt ${r}`);
  }
  assert.equal(r, 26); assert.equal(ohneRev(p), ohneRev(ende));
  assert.equal(p.rev, 30 + 26 + 26, 'Undo und Redo zählen rev mit');
});

test('A8 Neustart mitten im Verlauf: gleicher Zeiger, gleiche Liste, weiteres Undo/Redo führt auf dieselben Stände (auch mit neu geladenem Projekt)', (t) => {
  const { wurzel, v, uhr, ende, stand, pr, slug } = lauf(t);
  let p = ende;
  for (let i = 0; i < 11; i++) { uhr.t += 1000; p = rueckgaengig(v, p, { quelle: 'andreas' }).projekt; }
  pr.speichere(slug, p); v.schliesse();
  const zeigerVorher = v.zeiger(), listeVorher = v.liste();
  // „Server-Neustart": alles neu aus den Dateien
  const pr2 = new Projekte(wurzel); const p2 = pr2.lies(slug); const v2 = pr2.verlauf(slug, { jetzt: () => uhr.t, zeitgeber: false });
  assert.deepEqual(v2.zeiger(), zeigerVorher); assert.deepEqual(v2.liste(), listeVorher);
  assert.equal(kanonisch(p2), kanonisch(p));
  assert.equal(v2.zeiger().redo.length, 11); assert.equal(v2.zeiger().undo.length, 15);
  let q = p2;
  for (let i = 0; i < 4; i++) { uhr.t += 1000; q = rueckgaengig(v2, q, { quelle: 'andreas' }).projekt; assert.equal(ohneRev(q), ohneRev(stand.get(v2.zeiger().undo.at(-1))), `nach Neustart Undo ${i}`); }
  while (v2.kannRedo()) { uhr.t += 1000; q = wiederholen(v2, q, { quelle: 'andreas' }).projekt; }
  assert.equal(ohneRev(q), ohneRev(ende));
  // eine neue Änderung nach dem Neustart macht den Rest ungültig, auch für den nächsten Neustart
  v2.schliesse(); const v3 = pr2.oeffne(slug, { zeitgeber: false }).verlauf;   // S2-Integration Slice 1: v2 hat nicht gespeichert, das Log läuft vor
  let r = rueckgaengig(v3, q, { quelle: 'andreas' }).projekt; r = rueckgaengig(v3, r, { quelle: 'andreas' }).projekt;
  assert.equal(v3.zeiger().redo.length, 2, 'Vorbedingung: zwei Schritte wären wiederholbar');
  r = aendere(v3, r, [{ befehl: 'tempo_setzen', bpm: 99 }], { quelle: 'cypher', label: 'Tempo' }).projekt;
  assert.equal(r.rev, q.rev + 3);
  assert.equal(v3.zeiger().redo.length, 0);
  v3.schliesse();                                                                          // die Sperre gilt bis zum Schliessen (Spec 6.7)
  const v4 = pr2.oeffne(slug, { zeitgeber: false }).verlauf;
  assert.equal(v4.zeiger().redo.length, 0, 'auch nach dem nächsten Neustart'); v4.schliesse();
});

test('Wiedergabe aus dem Endprojekt: gültig, deterministisch, nach Neustart identisch (nur fertig dekodierte Clips)', (t) => {
  const { wurzel, slug, ende } = lauf(t);
  const mit = structuredClone(ende);
  for (const s of mit.spuren) for (const c of s.clips) if (c.art === 'audio') c.dekodiert = 'fertig';
  const opt = { nr: 1, audioOrdner: '/a/audio', frames: () => 48000 };
  const w1 = uebersetze(mit, opt), w2 = uebersetze(new Projekte(wurzel).lies(slug), opt);
  assert.equal(w2.spuren.flatMap((s) => (s.clips ?? [])).length, 0, 'ohne fertig keine Audio-Clips (Zustand nein im geladenen Projekt)');
  assert.deepEqual(w1.spuren.map((s) => [s.nr, s.art]), [[1, 'audio'], [3, 'intern']]);
  assert.equal(w1.spuren[0].clips.length, 2);
  assert.deepEqual(w1.spuren[1].noten.map((n) => n.id), ['c3/n4', 'c3/n5'].sort());   // B1 (Spec 6.28): ein Noten-Zähler für alle Clips, c2 hat n1..n3
});
