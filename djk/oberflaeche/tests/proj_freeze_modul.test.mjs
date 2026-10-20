// D1 S3, Slice 1: Freeze im Projekt als reine Funktionen (projekt/freeze.ts) und als undo-fähige Änderung (projekt/stand.ts).
// Kein Server, kein Kern, kein Netz: Dateien in tmp. Die Kennung vergibt nicht freeze.ts, sondern der eine Wiedergabe-Zähler der Instanz
// (Spec 6.25, ProjZugang.naechsteNummer; geprüft in proj_freeze_ablauf.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  brauchtFreeze, freezeBereich, freezeDateiName, FreezeFehler, klingendeNoten, pruefeFreezeDatei, setzeFreeze,
} from '../projekt/freeze.ts';
import { aendereStand, StandFehler } from '../projekt/stand.ts';
import { fuehreAus } from '../projekt/befehle.ts';
import { Verlauf, rueckgaengig, wiederholen } from '../projekt/verlauf.ts';
import { wende } from '../projekt/patch.ts';
import { kanonisch } from '../projekt/modell.ts';
import { specProjekt, tmpOrdner } from './hilfen/projekt.mjs';

// Spec-Projekt mit Noten auf der Surge-Spur s3: Clip c3 ab Beat 8, 8 Beats lang, eine Note hinter dem Clip-Ende (klingt nicht)
function mitLead() {
  const p = specProjekt();
  p.spuren[2].clips = [{ id: 'c3', art: 'midi', name: 'lead', start_beat: 8, laenge_beats: 8,
    noten: [{ id: 'n1', beat: 0, laenge: 1, ton: 60, vel: 90 }, { id: 'n2', beat: 9, laenge: 1, ton: 62, vel: 90 }] }];
  return p;
}
const FREEZE = { datei: 'freeze-3-1.f32', frames: 240000, kennung: 1, sha256: 'c'.repeat(64), von_beat: 8 };

test('freezeBereich, klingendeNoten, brauchtFreeze: nur Wirt-Spuren mit klingenden Noten, Bereich über alle klingenden Clips', () => {
  const p = mitLead();
  const [kick, bass, lead] = p.spuren;
  assert.equal(klingendeNoten(lead), 1, 'n2 beginnt hinter dem Clip-Ende');
  assert.deepEqual(freezeBereich(lead), { von_beat: 8, bis_beat: 16 });
  assert.equal(brauchtFreeze(lead), true);
  assert.equal(brauchtFreeze(bass), false, 'interne Spur');
  assert.equal(brauchtFreeze(kick), false, 'Audio-Spur');
  lead.clips.push({ id: 'c9', art: 'midi', name: 'leer', start_beat: 40, laenge_beats: 4, noten: [] });
  assert.deepEqual(freezeBereich(lead), { von_beat: 8, bis_beat: 16 }, 'ein Clip ohne Noten verlängert den Bereich nicht');
  lead.clips.push({ id: 'c10', art: 'midi', name: 'kurz', start_beat: 30, laenge_beats: 0.25, noten: [{ id: 'n1', beat: 0, laenge: 0.25, ton: 60, vel: 90 }] });
  assert.deepEqual(freezeBereich(lead), { von_beat: 8, bis_beat: 30.25 });
  lead.freeze = FREEZE;
  assert.equal(brauchtFreeze(lead), false, 'schon eingefroren');
  const stumm = mitLead().spuren[2]; stumm.clips[0].noten = [];
  assert.equal(brauchtFreeze(stumm), false);
  assert.equal(freezeBereich(stumm), null);
  const einzeln = mitLead().spuren[2]; einzeln.clips[0].laenge_beats = 0.5;
  assert.deepEqual(freezeBereich(einzeln), { von_beat: 8, bis_beat: 9 }, 'mindestens 1 Beat (Kern: bis − von ≥ 1)');
});

test('Spec 6.17: im Loop-Clip klingen nur Noten vor loop_beats; Noten nur dahinter heißen spur_leer, der Bereich bleibt die ganze Clip-Länge', () => {
  const p = mitLead();
  const lead = p.spuren[2];
  lead.clips[0].loop_beats = 2;                       // n1 (Beat 0) klingt je Kopie, n2 (Beat 9) nie
  assert.equal(klingendeNoten(lead), 1);
  assert.deepEqual(freezeBereich(lead), { von_beat: 8, bis_beat: 16 }, 'der Loop wiederholt sich bis laenge_beats');
  lead.clips[0].noten = [{ id: 'n3', beat: 4, laenge: 1, ton: 64, vel: 90 }];   // klingt ohne Loop (4 < 8), mit Loop nicht (4 ≥ 2)
  assert.equal(klingendeNoten(lead), 0);
  assert.equal(freezeBereich(lead), null);
  assert.equal(brauchtFreeze(lead), false);
  // Negativ-Kontrolle: derselbe Clip ohne Loop (null wie fehlend) klingt
  lead.clips[0].loop_beats = null;
  assert.equal(klingendeNoten(lead), 1);
  assert.deepEqual(freezeBereich(lead), { von_beat: 8, bis_beat: 16 });
  assert.equal(freezeDateiName(3, 8), 'freeze-3-8.f32');
});

test('pruefeFreezeDatei: sha256 der Datei, Größe muss frames · 8 sein, fehlende Datei ist freeze_fehler (englischer Text)', async (t) => {
  const d = tmpOrdner(t);
  const inhalt = Buffer.alloc(1000 * 8); inhalt.writeFloatLE(0.5, 0);
  fs.writeFileSync(path.join(d, 'freeze-2-5.f32'), inhalt);
  assert.equal(await pruefeFreezeDatei(d, 2, 5, 1000), crypto.createHash('sha256').update(inhalt).digest('hex'));
  await assert.rejects(pruefeFreezeDatei(d, 2, 5, 999), (e) => e instanceof FreezeFehler && e.grund === 'freeze_fehler' && /8000 bytes/.test(e.text));
  await assert.rejects(pruefeFreezeDatei(d, 2, 6, 1000), (e) => e instanceof FreezeFehler && /is missing/.test(e.text));
});

test('setzeFreeze: neuer Stand, Eingabe unberührt; unbekannte Spur und Nicht-Wirt-Spur abgelehnt', () => {
  const p = mitLead();
  const vorher = kanonisch(p);
  const neu = setzeFreeze(p, 's3', FREEZE);
  assert.deepEqual(neu.spuren[2].freeze, FREEZE);
  assert.equal(kanonisch(p), vorher);
  assert.equal(setzeFreeze(neu, 's3', null).spuren[2].freeze, null);
  assert.throws(() => setzeFreeze(p, 's9', null), (e) => e.grund === 'spur_unbekannt');
  assert.throws(() => setzeFreeze(p, 's2', FREEZE), (e) => e.grund === 'keine_wirtspur');
});

test('aendereStand: ein Eintrag mit Label und Quelle, rev + 1, Speichern vor dem Log, Undo und Redo kehren den Freeze um', (t) => {
  const d = tmpOrdner(t);
  const v = new Verlauf(path.join(d, 'undo.jsonl'), { zeitgeber: false });
  const gespeichert = [];
  const haken = { speichere: (x) => gespeichert.push({ rev: x.rev, freeze: x.spuren[2].freeze, zeilen: v.liste().length }) };
  const p = mitLead();
  const w = aendereStand(v, p, setzeFreeze(p, 's3', FREEZE), { quelle: 'cypher', label: 'Freeze Lead' }, haken);
  assert.equal(w.projekt.rev, 18);
  assert.equal(w.projekt.wiedergabe_rev, 15, 'wiedergabe_rev zählt nicht der Verlauf');
  assert.deepEqual(w.projekt.spuren[2].freeze, FREEZE);
  assert.equal(w.betrifft_wiedergabe, true, 'ein Freeze ändert die Wiedergabe (Spur als Audio, Spec 3.2)');
  assert.deepEqual(w.regler_aenderungen, []);
  assert.deepEqual(gespeichert, [{ rev: 18, freeze: FREEZE, zeilen: 0 }], 'project.json vor dem Log (Spec 6.7)');
  assert.deepEqual(v.liste().map((e) => [e.rev, e.quelle, e.label, e.art]), [[18, 'cypher', 'Freeze Lead', 'aendern']]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'undo.jsonl'), 'utf8')).vor, [{ op: 'replace', pfad: '/spuren/s3/freeze', wert: FREEZE }]);
  const u = rueckgaengig(v, w.projekt, { quelle: 'andreas' });
  assert.equal(u.projekt.spuren[2].freeze, null);
  assert.equal(u.betrifft_wiedergabe, true);
  assert.deepEqual(wiederholen(v, u.projekt, { quelle: 'andreas' }).projekt.spuren[2].freeze, FREEZE);
  // Negativ-Kontrolle: derselbe Stand ist keine Änderung, kein Eintrag, nichts gespeichert
  const n = gespeichert.length;
  const gleich = aendereStand(v, w.projekt, structuredClone(w.projekt), { quelle: 'andreas', label: 'nichts' }, haken);
  assert.equal(gleich.eintrag, null); assert.equal(gleich.projekt, w.projekt); assert.equal(gespeichert.length, n);
});

test('aendereStand: ungültiger Stand und veraltete rev schreiben nichts; scheitert das Log, steht project.json wieder auf alt', (t) => {
  const d = tmpOrdner(t);
  const v = new Verlauf(path.join(d, 'undo.jsonl'), { zeitgeber: false });
  const gespeichert = [];
  const haken = { speichere: (x) => gespeichert.push(x.rev) };
  const p = mitLead();
  const kaputt = setzeFreeze(p, 's3', { ...FREEZE, datei: '/abs/pfad.f32' });
  assert.throws(() => aendereStand(v, p, kaputt, { quelle: 'andreas', label: 'x' }, haken), (e) => e instanceof StandFehler && e.grund === 'projekt_ungueltig');
  aendereStand(v, p, setzeFreeze(p, 's3', FREEZE), { quelle: 'andreas', label: 'Freeze Lead' }, haken);
  assert.throws(() => aendereStand(v, p, setzeFreeze(p, 's3', { ...FREEZE, kennung: 2 }), { quelle: 'andreas', label: 'alt' }, haken), (e) => e.grund === 'rev_nicht_steigend');
  assert.deepEqual(gespeichert, [18], 'nur die gültige Änderung wurde gespeichert');
  const v2 = new Verlauf(path.join(d, 'nicht-da', 'undo.jsonl'), { zeitgeber: false });   // Log nicht schreibbar (Ordner fehlt)
  const zurueck = [];
  assert.throws(() => aendereStand(v2, p, setzeFreeze(p, 's3', FREEZE), { quelle: 'andreas', label: 'Freeze Lead' }, { speichere: (x) => zurueck.push(x.spuren[2].freeze) }), /ENOENT/);
  assert.deepEqual(zurueck, [FREEZE, null], 'erst der neue Stand, nach dem Log-Fehler wieder der alte');
});

test('Befehle verwerfen den Freeze (S2-Kern befehle.ts, Spec 3.3): Noten, Gerät, Tempo, Loop des Clips; Mixer und andere Spuren nicht', () => {
  const p = setzeFreeze(mitLead(), 's3', FREEZE);
  const nach = (b) => fuehreAus(p, b).projekt.spuren.find((s) => s.id === 's3').freeze;
  assert.equal(nach({ befehl: 'noten_aendern', clip_id: 'c3', noten: [{ id: 'n1', ton: 61 }] }), null);
  assert.equal(nach({ befehl: 'clip_aendern', clip_id: 'c3', start_beat: 9 }), null);
  assert.equal(nach({ befehl: 'clip_aendern', clip_id: 'c3', loop_beats: 4 }), null, 'Spec 6.17: der Loop ändert, was klingt');
  assert.equal(nach({ befehl: 'spur_aendern', spur_id: 's3', geraet: { art: 'intern' } }) ?? null, null, 'Gerät gewechselt (Spec 6.28: nur Slot 1, also intern; das Feld fällt weg)');
  assert.equal(nach({ befehl: 'tempo_setzen', bpm: 125 }), null);
  assert.deepEqual(nach({ befehl: 'spur_aendern', spur_id: 's3', fader_db: -6 }), FREEZE, 'Mixer berührt den Klang vor dem Fader nicht');
  assert.deepEqual(nach({ befehl: 'noten_aendern', clip_id: 'c2', noten: [{ id: 'n1', ton: 38 }] }), FREEZE, 'andere Spur');
  // Undo der verwerfenden Änderung bringt den Freeze zurück (er steht im Patch derselben Änderung)
  const r = fuehreAus(p, { befehl: 'noten_aendern', clip_id: 'c3', noten: [{ id: 'n1', ton: 61 }] });
  assert.deepEqual(wende(r.projekt, r.zurueck).spuren[2].freeze, FREEZE);
});
