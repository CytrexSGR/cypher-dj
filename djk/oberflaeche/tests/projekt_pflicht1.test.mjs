// D1 S2-Integration, Teil 1, Pflichtliste: P3 (b) Spurfeld von (Spec 6.22), P7 clip_neu mit loop_beats, P8 IDs nie wiederverwendet (Spec 6.26),
// P9 gemeinsamer Wertebereich gain_db/Blenden (Spec 6.27), P10 clip_neu übernimmt name. Reine Funktionen und Ablage, kein Server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus } from '../projekt/befehle.ts';
import { Verlauf, aendere, rueckgaengig, wiederholen } from '../projekt/verlauf.ts';
import { Projekte } from '../projekt/ablage.ts';
import { neuesProjekt, pruefeProjekt, FADER_MAX } from '../projekt/modell.ts';
import { uebersetze } from '../projekt/wiedergabe.ts';
import { tmpOrdner, specProjekt, kopie, SHA_A } from './hilfen/projekt.mjs';

const A = { quelle: 'andreas', label: 'Test' }, C = { quelle: 'cypher', label: 'Cypher' };
const grund = (g) => (e) => e.grund === g;
const ungueltig = (p) => { const r = pruefeProjekt(p); return 'fehler' in r ? r.fehler : null; };
const opt = { nr: 1, audioOrdner: '/arbeit/arr/audio', frames: () => 480000 };
const verlauf = (t) => { const v = new Verlauf(`${tmpOrdner(t)}/undo.jsonl`, { zeitgeber: false }); t.after(() => v.schliesse()); return v; };
const spurIds = (p) => p.spuren.map((s) => s.id);

// ---------------------------------------------------------------------------------------------------------------------
// P3 (b): Spurfeld von (Spec 6.22)
test('6.22 von: spur_neu setzt von aus der Quelle (ohne Angabe andreas, mit Quelle cypher cypher); Verlauf reicht die Quelle durch', (t) => {
  const p = neuesProjekt('V');
  assert.equal(fuehreAus(p, { befehl: 'spur_neu', art: 'audio' }).projekt.spuren[0].von, 'andreas');
  assert.equal(fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio' }], { quelle: 'cypher' }).projekt.spuren[0].von, 'cypher');
  const v = verlauf(t);
  const r1 = aendere(v, p, [{ befehl: 'spur_neu', art: 'instrument' }], C);
  const r2 = aendere(v, r1.projekt, [{ befehl: 'spur_neu', art: 'audio' }], A);
  assert.deepEqual(r2.projekt.spuren.map((s) => s.von), ['cypher', 'andreas']);
});

test('6.22 von: unveränderlich, spur_aendern lehnt es ab (auch neben erlaubten Feldern); Mixer-Felder gehen weiter und lassen von stehen', () => {
  const p = fuehreListeAus(neuesProjekt('V'), [{ befehl: 'spur_neu', art: 'audio' }], { quelle: 'cypher' }).projekt;
  const id = p.spuren[0].id;
  for (const von of ['andreas', 'cypher', 'x']) {
    assert.throws(() => fuehreAus(p, { befehl: 'spur_aendern', spur_id: id, von }), grund('argument_ungueltig'), von);
    assert.throws(() => fuehreAus(p, { befehl: 'spur_aendern', spur_id: id, name: 'Neu', von }), grund('argument_ungueltig'), `${von} neben name`);
  }
  const q = fuehreAus(p, { befehl: 'spur_aendern', spur_id: id, name: 'Neu', fader_db: -3 }).projekt.spuren[0];     // Negativ-Kontrolle
  assert.deepEqual([q.name, q.fader_db, q.von], ['Neu', -3, 'cypher']);
});

test('6.22 von: die Datei prüft den Wert; fehlt das Feld (älteres Projekt), gilt beim Laden andreas', () => {
  const p = specProjekt();
  const geladen = pruefeProjekt(p);
  assert.ok('projekt' in geladen);
  assert.deepEqual(geladen.projekt.spuren.map((s) => s.von), ['andreas', 'andreas', 'andreas'], 'fehlt → andreas');
  const q = kopie(p); q.spuren[1].von = 'cypher';
  assert.deepEqual(pruefeProjekt(q).projekt.spuren.map((s) => s.von), ['andreas', 'cypher', 'andreas'], 'cypher bleibt cypher');
  for (const w of ['fremd', '', 1, null]) { const x = kopie(p); x.spuren[0].von = w; assert.match(ungueltig(x) ?? '', /von/, String(w)); }
});

test('6.22 von: Löschen, Undo und Redo bringen die Spur mit ihrem von zurück; die Patches tragen es', (t) => {
  const v = verlauf(t);
  const r1 = aendere(v, neuesProjekt('V'), [{ befehl: 'spur_neu', art: 'instrument' }], C);
  const r2 = aendere(v, r1.projekt, [{ befehl: 'spur_loeschen', spur_id: 's1' }], A);
  assert.equal(r2.projekt.spuren.length, 0);
  const u = rueckgaengig(v, r2.projekt, A);
  assert.equal(u.projekt.spuren[0].von, 'cypher', 'Undo des Löschens');
  const w = wiederholen(v, u.projekt, A);
  assert.equal(w.projekt.spuren.length, 0);
  assert.equal(rueckgaengig(v, w.projekt, A).projekt.spuren[0].von, 'cypher');
  assert.equal(r1.eintrag.vor[0].wert.von, 'cypher');
});

test('6.22 von: übersteht die Ablage (speichern, schließen, öffnen)', (t) => {
  const w = tmpOrdner(t), pr = new Projekte(w), { slug, projekt } = pr.lege('Von');
  const o = pr.oeffne(slug, { zeitgeber: false });
  const r = aendere(o.verlauf, projekt, [{ befehl: 'spur_neu', art: 'audio' }], C, { speichere: (n) => pr.speichere(slug, n) });
  o.verlauf.schliesse();
  assert.equal(pr.lies(slug).spuren[0].von, 'cypher');
  assert.equal(r.projekt.spuren[0].von, 'cypher');
});

// ---------------------------------------------------------------------------------------------------------------------
// P8: IDs werden nie wiederverwendet (Spec 6.26)
test('6.26 Spur-, Clip- und Noten-IDs: löschen, neu anlegen → ID verschieden', () => {
  let p = fuehreListeAus(neuesProjekt('I'), [{ befehl: 'spur_neu', art: 'instrument' }, { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4,
    noten: [{ beat: 0, laenge: 1, ton: 36, vel: 100 }] }]).projekt;
  assert.deepEqual([spurIds(p), p.spuren[0].clips[0].id, p.spuren[0].clips[0].noten[0].id], [['s1'], 'c1', 'n1']);
  p = fuehreListeAus(p, [{ befehl: 'noten_loeschen', clip_id: 'c1', ids: ['n1'] }]).projekt;
  p = fuehreListeAus(p, [{ befehl: 'noten_neu', clip_id: 'c1', noten: [{ beat: 1, laenge: 1, ton: 38, vel: 90 }] }]).projekt;
  assert.equal(p.spuren[0].clips[0].noten[0].id, 'n2', 'Note');
  p = fuehreListeAus(p, [{ befehl: 'clip_loeschen', clip_id: 'c1' }]).projekt;
  p = fuehreListeAus(p, [{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4 }]).projekt;
  assert.equal(p.spuren[0].clips[0].id, 'c2', 'Clip');
  p = fuehreListeAus(p, [{ befehl: 'spur_loeschen', spur_id: 's1' }]).projekt;
  p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio' }]).projekt;
  assert.equal(p.spuren[0].id, 's2', 'Spur');
});

test('6.26 auch in einem Aufruf (löschen, neu anlegen) und bei Teilen und Duplizieren', () => {
  let p = fuehreListeAus(neuesProjekt('I'), [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_loeschen', spur_id: 's1' }, { befehl: 'spur_neu', art: 'audio' }]).projekt;
  assert.deepEqual(spurIds(p), ['s2']);
  p = fuehreListeAus(p, [{ befehl: 'clip_neu', spur_id: 's2', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: SHA_A }]).projekt;
  p = fuehreListeAus(p, [{ befehl: 'clip_duplizieren', clip_id: 'c1' }]).projekt;
  assert.deepEqual(p.spuren[0].clips.map((c) => c.id), ['c1', 'c2']);
  p = fuehreListeAus(p, [{ befehl: 'clip_loeschen', clip_id: 'c2' }]).projekt;
  p = fuehreListeAus(p, [{ befehl: 'clip_duplizieren', clip_id: 'c1' }]).projekt;
  assert.deepEqual(p.spuren[0].clips.map((c) => c.id), ['c1', 'c3'], 'Duplizieren');
  p = fuehreListeAus(p, [{ befehl: 'clip_loeschen', clip_id: 'c3' }]).projekt;
  p = fuehreListeAus(p, [{ befehl: 'clip_teilen', clip_id: 'c1', beat: 4 }]).projekt;
  assert.deepEqual(p.spuren[0].clips.map((c) => c.id), ['c1', 'c4'], 'Teilen');
});

test('6.26 clip_teilen: die Rest-Note über dem Schnitt bekommt keine früher vergebene Noten-ID', () => {
  let p = fuehreListeAus(neuesProjekt('I'), [{ befehl: 'spur_neu', art: 'instrument' }, { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 8,
    noten: [{ beat: 0, laenge: 4, ton: 36, vel: 100 }, { beat: 3, laenge: 1, ton: 38, vel: 90 }, { beat: 6, laenge: 1, ton: 40, vel: 80 }] }]).projekt;
  p = fuehreListeAus(p, [{ befehl: 'noten_loeschen', clip_id: 'c1', ids: ['n3'] }]).projekt;           // n3 ist vergeben und weg
  p = fuehreListeAus(p, [{ befehl: 'clip_teilen', clip_id: 'c1', beat: 2 }]).projekt;
  const ids = p.spuren[0].clips.map((c) => c.noten.map((n) => n.id));
  assert.deepEqual(ids, [['n1'], ['n2', 'n4']], 'n3 kommt nicht zurück');
});

test('6.26 Undo und Redo setzen die Zähler nicht zurück: Spur anlegen, Undo, neue Spur → s2; Redo-Weg ebenso', (t) => {
  const v = verlauf(t);
  const r1 = aendere(v, neuesProjekt('I'), [{ befehl: 'spur_neu', art: 'audio' }], A);
  const u = rueckgaengig(v, r1.projekt, A);
  assert.equal(u.projekt.spuren.length, 0);
  const r2 = aendere(v, u.projekt, [{ befehl: 'spur_neu', art: 'audio' }], A);
  assert.deepEqual(spurIds(r2.projekt), ['s2']);
  const v2 = verlauf(t);
  const a1 = aendere(v2, neuesProjekt('I'), [{ befehl: 'spur_neu', art: 'audio' }], A);
  const a2 = aendere(v2, a1.projekt, [{ befehl: 'spur_loeschen', spur_id: 's1' }], A);
  const au = rueckgaengig(v2, a2.projekt, A), aw = wiederholen(v2, au.projekt, A);
  assert.equal(aw.projekt.spuren.length, 0);
  assert.deepEqual(spurIds(aendere(v2, aw.projekt, [{ befehl: 'spur_neu', art: 'audio' }], A).projekt), ['s2'], 'nach Undo und Redo des Löschens');
});

test('6.26 Zähler stehen nicht im Patch (sonst setzte Undo sie zurück); fehlen sie, starten sie beim Maximum plus 1', () => {
  const r = fuehreAus(specProjekt(), { befehl: 'spur_neu', art: 'audio' });
  assert.ok(!JSON.stringify([r.vor, r.zurueck]).includes('naechste'), JSON.stringify(r.vor));
  assert.equal(r.projekt.spuren[3].id, 's4', 'Maximum der vorhandenen + 1');
  assert.equal(r.projekt.naechste_id.spur, 5);
  const r2 = fuehreAus(r.projekt, { befehl: 'spur_neu', art: 'audio' });                     // Zähler schon da und steigt: wieder keine Operation
  assert.equal(r2.projekt.naechste_id.spur, 6);
  assert.ok(!JSON.stringify([r2.vor, r2.zurueck]).includes('naechste'), JSON.stringify(r2.vor));
  const c = fuehreAus(specProjekt(), { befehl: 'noten_neu', clip_id: 'c2', noten: [{ beat: 1, laenge: 1, ton: 40, vel: 90 }] });
  assert.deepEqual([c.projekt.spuren[1].clips[0].noten[1].id, c.projekt.naechste_noten_id], ['n2', 3]);   // B1 (Spec 6.28): Zähler im Projekt
  const c2 = fuehreAus(c.projekt, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ beat: 2, laenge: 1, ton: 41, vel: 90 }] });   // Noten-Zähler schon da
  assert.equal(c2.projekt.naechste_noten_id, 4);
  assert.ok(!JSON.stringify([c2.vor, c2.zurueck]).includes('naechste'), JSON.stringify(c2.vor));
});

test('6.26 Zähler: die Datei prüft sie (ganze Zahl ab 1, nur spur und clip, Noten-Zähler nur am MIDI-Clip)', () => {
  const p = specProjekt();
  const ok = kopie(p); ok.naechste_id = { spur: 9, clip: 9 }; ok.spuren[1].clips[0].naechste_noten_id = 4;
  assert.equal(ungueltig(ok), null);
  for (const w of [{ spur: 0 }, { clip: 'x' }, { spur: 1.5 }, { andere: 1 }, 5, null]) { const x = kopie(p); x.naechste_id = w; assert.match(ungueltig(x) ?? '', /naechste_id/, JSON.stringify(w)); }
  for (const w of [0, 'x', 2.5]) { const x = kopie(p); x.spuren[1].clips[0].naechste_noten_id = w; assert.match(ungueltig(x) ?? '', /naechste_noten_id/, String(w)); }
  const a = kopie(p); a.spuren[0].clips[0].naechste_noten_id = 3; assert.match(ungueltig(a) ?? '', /naechste_noten_id/, 'am Audio-Clip nicht');
});

test('6.26 Zähler überstehen die Ablage: nach Speichern und Öffnen vergibt das Projekt keine frühere ID mehr', (t) => {
  const w = tmpOrdner(t), pr = new Projekte(w), { slug, projekt } = pr.lege('Zaehler');
  const haken = { speichere: (n) => pr.speichere(slug, n) };
  let o = pr.oeffne(slug, { zeitgeber: false });
  const r1 = aendere(o.verlauf, projekt, [{ befehl: 'spur_neu', art: 'audio' }], A, haken);
  const r2 = aendere(o.verlauf, r1.projekt, [{ befehl: 'spur_loeschen', spur_id: 's1' }], A, haken);
  o.verlauf.schliesse();
  assert.equal(pr.lies(slug).naechste_id.spur, 2);
  o = pr.oeffne(slug, { zeitgeber: false });
  t.after(() => o.verlauf.schliesse());
  const r3 = aendere(o.verlauf, o.projekt, [{ befehl: 'spur_neu', art: 'audio' }], A, haken);
  assert.deepEqual(spurIds(r3.projekt), ['s2']);
  assert.equal(r2.projekt.spuren.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------
// P9: gemeinsamer Wertebereich Kern/Server (Spec 6.27)
test('6.27 gain_db −96..+24: die Grenzen gehen, +24,5 und −96,5 nicht (Befehl und Datei); die alte Obergrenze +48 ist weg', () => {
  const p = specProjekt();
  for (const g of [-96, 0, 24]) assert.equal(fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c1', gain_db: g }).projekt.spuren[0].clips[0].gain_db, g, String(g));
  for (const g of [24.5, 48, -96.5]) assert.throws(() => fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c1', gain_db: g }), grund('argument_ungueltig'), String(g));
  for (const g of [-96, 24]) { const q = kopie(p); q.spuren[0].clips[0].gain_db = g; assert.equal(ungueltig(q), null, `Datei ${g}`); }
  for (const g of [24.5, 48, -96.5]) { const q = kopie(p); q.spuren[0].clips[0].gain_db = g; assert.match(ungueltig(q) ?? '', /gain_db/, `Datei ${g}`); }
});

test('6.27 Blenden: beide ≥ 0 und zusammen höchstens laenge_beats (Befehl und Datei)', () => {
  const p = specProjekt();                                                                   // c1: laenge_beats 1
  const mit = (f) => fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c1', ...f }).projekt.spuren[0].clips[0];
  assert.deepEqual([mit({ fade_ein_beats: 0.5, fade_aus_beats: 0.5 }).fade_ein_beats, mit({ fade_ein_beats: 1 }).fade_ein_beats], [0.5, 1], 'genau die Länge geht');
  assert.throws(() => mit({ fade_ein_beats: -0.1 }), grund('argument_ungueltig'));
  assert.throws(() => mit({ fade_aus_beats: -0.1 }), grund('argument_ungueltig'));
  assert.throws(() => mit({ fade_ein_beats: 0.6, fade_aus_beats: 0.5 }), grund('fade_zu_lang'));
  for (const [ein, aus] of [[-1, 0], [0, -1], [0.6, 0.5]]) { const q = kopie(p); Object.assign(q.spuren[0].clips[0], { fade_ein_beats: ein, fade_aus_beats: aus }); assert.match(ungueltig(q) ?? '', /fade/, `Datei ${ein}/${aus}`); }
});

test('6.27 Loop-Kopien: der Übersetzer kürzt die Blenden je Kopie, Ein- plus Ausblende jeder Kopie bleibt ≤ ihrer Länge', () => {
  const p = specProjekt();
  Object.assign(p.spuren[0].clips[0], { laenge_beats: 6, loop_beats: 2.5, fade_ein_beats: 3, fade_aus_beats: 3 });
  const cs = uebersetze(p, opt).spuren.find((s) => s.nr === 1).clips;
  assert.deepEqual(cs.map((c) => [c.laenge_beats, c.ein_beats, c.aus_beats]), [[2.5, 2.5, 0], [2.5, 0, 0], [1, 0, 1]]);
  assert.ok(cs.every((c) => c.ein_beats >= 0 && c.aus_beats >= 0 && c.ein_beats + c.aus_beats <= c.laenge_beats + 1e-9));
  Object.assign(p.spuren[0].clips[0], { laenge_beats: 2, loop_beats: 2, fade_ein_beats: 1, fade_aus_beats: 1 });      // Negativ-Kontrolle: eine Kopie
  assert.deepEqual(uebersetze(p, opt).spuren[0].clips.map((c) => [c.ein_beats, c.aus_beats]), [[1, 1]]);
});

// ---------------------------------------------------------------------------------------------------------------------
// P7 und P10: clip_neu
test('P7 clip_neu nimmt loop_beats (1/16 ≤ x ≤ laenge_beats, null = aus) für Audio und MIDI', () => {
  const p = specProjekt();
  const audio = (loop_beats) => fuehreAus(p, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 8, sha256: SHA_A, loop_beats });
  assert.equal(audio(2).projekt.spuren[0].clips[1].loop_beats, 2);
  assert.equal(audio(1 / 16).projekt.spuren[0].clips[1].loop_beats, 1 / 16);
  assert.equal(audio(8).projekt.spuren[0].clips[1].loop_beats, 8, 'genau die Länge');
  for (const aus of [null, undefined]) assert.ok(!(audio(aus).projekt.spuren[0].clips[1].loop_beats > 0), `${aus}: kein Loop`);
  for (const w of [1 / 32, 0, -1, 8.5, '2']) assert.throws(() => audio(w), grund('argument_ungueltig'), String(w));
  const midi = fuehreAus(p, { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 16, laenge_beats: 4, loop_beats: 2, noten: [{ beat: 0, laenge: 1, ton: 36, vel: 100 }] });
  assert.equal(midi.projekt.spuren[1].clips[1].loop_beats, 2);
  assert.equal(midi.betrifft_wiedergabe, true);
  assert.throws(() => fuehreAus(p, { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 4, loop_beats: 5 }), grund('argument_ungueltig'));
});

test('P7 clip_neu mit Loop rollt aus: 4 Beats Loop 1 ergeben vier Kopien; Grenze zu_gross gilt auch hier', () => {
  const p = specProjekt();
  const r = fuehreAus(p, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 4, sha256: SHA_A, loop_beats: 1 });
  r.projekt.spuren[0].clips[1].dekodiert = 'fertig';                                          // der Übersetzer spielt nur fertig dekodierte Clips
  assert.deepEqual(uebersetze(r.projekt, opt).spuren[0].clips.filter((c) => c.id.startsWith('c3')).map((c) => c.start_beat), [4, 5, 6, 7]);
  assert.throws(() => fuehreAus(p, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 4097 / 16, sha256: SHA_A, loop_beats: 1 / 16 }), grund('zu_gross'));
});

test('P10 clip_neu übernimmt name aus der Nutzlast (Audio und MIDI), sonst Name aus dem Pfad; FADER_MAX ist 6', () => {
  const p = specProjekt();
  const a = fuehreAus(p, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 2, sha256: SHA_A, pfad_hinweis: '/x/lib/datei.wav', name: 'Bibliothekstitel' });
  assert.equal(a.projekt.spuren[0].clips[1].name, 'Bibliothekstitel');
  const o = fuehreAus(p, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 2, sha256: SHA_A, pfad_hinweis: '/x/lib/datei.wav' });
  assert.equal(o.projekt.spuren[0].clips[1].name, 'datei', 'Negativ-Kontrolle: ohne name der Dateiname');
  assert.equal(fuehreAus(p, { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 16, laenge_beats: 2, name: 'Akkorde' }).projekt.spuren[1].clips[1].name, 'Akkorde');
  assert.equal(FADER_MAX, 6);
});
