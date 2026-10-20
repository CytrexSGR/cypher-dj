// D1 S2-Kern, Verlauf: undo.jsonl nach Spec 3.3. Zeiger aus dem Durchlauf, Redo-Stapel, Neustart, Zusammenfassen von Mixer-Bewegungen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Verlauf, aendere, rueckgaengig, wiederholen, VerlaufFehler } from '../projekt/verlauf.ts';
import { neuesProjekt, kanonisch } from '../projekt/modell.ts';
import { tmpOrdner, ohneAbgeleitetes, SHA_A } from './hilfen/projekt.mjs';

const ohneRev = (p) => ohneAbgeleitetes({ ...p, rev: 0, wiedergabe_rev: 0 });      // ohne ID-Zähler: sie steigen nur (Spec 6.26)
const zeilen = (d) => (fs.existsSync(d) ? fs.readFileSync(d, 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z)) : []);
function aufbau(t, opt = {}) {
  const dir = tmpOrdner(t); const datei = path.join(dir, 'undo.jsonl'); const uhr = { t: Date.parse('2026-10-15T12:00:00Z') };
  const v = new Verlauf(datei, { jetzt: () => uhr.t, zeitgeber: false, ...opt });
  return { dir, datei, uhr, v };
}
const A = { quelle: 'andreas', label: 'Test' };
const neu = (v, p, befehle, meta = A) => aendere(v, p, befehle, meta);

test('aendern: eine Zeile je Änderung im Format der Spec; rev zählt hoch; Quelle, Label, Zeit, bezug null', (t) => {
  const { datei, uhr, v } = aufbau(t);
  let p = neuesProjekt('V');
  const r = neu(v, p, [{ befehl: 'spur_neu', art: 'audio', name: 'Kick' }], { quelle: 'cypher', label: 'Spur Kick' });
  p = r.projekt; assert.equal(p.rev, 1);
  uhr.t += 5000;
  p = neu(v, p, [{ befehl: 'tempo_setzen', bpm: 130 }]).projekt; assert.equal(p.rev, 2);
  const z = zeilen(datei);
  assert.equal(z.length, 2);
  assert.deepEqual(Object.keys(z[0]), ['rev', 'zeit', 'quelle', 'label', 'art', 'bezug', 'vor', 'zurueck']);
  assert.deepEqual([z[0].rev, z[0].quelle, z[0].label, z[0].art, z[0].bezug], [1, 'cypher', 'Spur Kick', 'aendern', null]);
  assert.equal(z[0].zeit, '2026-10-15T12:00:00.000Z'); assert.equal(z[1].zeit, '2026-10-15T12:00:05.000Z');
  assert.deepEqual(z[1].vor, [{ op: 'replace', pfad: '/tempo_bpm', wert: 130 }]);
  assert.deepEqual(z[1].zurueck, [{ op: 'replace', pfad: '/tempo_bpm', wert: neuesProjekt('x').tempo_bpm }]);
  assert.deepEqual(v.liste().map((e) => [e.rev, e.quelle, e.label, e.art]), [[1, 'cypher', 'Spur Kick', 'aendern'], [2, 'andreas', 'Test', 'aendern']]);
  assert.deepEqual(Object.keys(v.liste()[0]), ['rev', 'zeit', 'quelle', 'label', 'art'], 'Verlaufsliste ohne Patches (Spec 3.4)');
});

test('aendern ohne Wirkung: kein Eintrag, rev bleibt, keine Zeile; Ablehnung: nichts geschrieben', (t) => {
  const { datei, v } = aufbau(t);
  const p = neu(v, neuesProjekt('V'), [{ befehl: 'tempo_setzen', bpm: 120 }]).projekt;   // Vorgabe ist 120 oder anders: unten gemessen
  const n0 = zeilen(datei).length;
  const gleich = neu(v, p, [{ befehl: 'tempo_setzen', bpm: p.tempo_bpm }]);
  assert.equal(gleich.eintrag, null); assert.equal(gleich.projekt.rev, p.rev); assert.equal(zeilen(datei).length, n0);
  assert.throws(() => neu(v, p, [{ befehl: 'tempo_setzen', bpm: 5 }]), (e) => e.grund === 'tempo_bereich');
  assert.equal(zeilen(datei).length, n0);
  assert.throws(() => neu(v, p, [{ befehl: 'spur_neu', art: 'audio' }], { quelle: 'fremd', label: 'x' }), VerlaufFehler);
  assert.throws(() => neu(v, p, [{ befehl: 'spur_neu', art: 'audio' }], { quelle: 'andreas', label: '' }), VerlaufFehler);
  assert.equal(zeilen(datei).length, n0);
});

// ein Verlauf mit drei Änderungen: Spur, Clip, Tempo
function drei(t) {
  const x = aufbau(t); const stand = [neuesProjekt('V')];
  let p = stand[0];
  for (const b of [[{ befehl: 'spur_neu', art: 'audio', name: 'Kick' }], [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: SHA_A }], [{ befehl: 'tempo_setzen', bpm: 140 }]]) {
    x.uhr.t += 10_000; p = neu(x.v, p, b).projekt; stand.push(p);
  }
  return { ...x, p, stand };
}

test('Undo/Redo: Zustände gehen Schritt für Schritt zurück und vor; Einträge art undo/redo mit bezug und vertauschten Patches', (t) => {
  const { datei, v, stand, uhr } = drei(t);
  let p = stand[3];
  assert.deepEqual(v.zeiger(), { undo: [1, 2, 3], redo: [] });
  assert.equal(v.kannUndo(), true); assert.equal(v.kannRedo(), false);
  for (let i = 2; i >= 0; i--) { uhr.t += 1000; const r = rueckgaengig(v, p, { quelle: 'andreas' }); p = r.projekt; assert.equal(ohneRev(p), ohneRev(stand[i]), `Undo auf Stand ${i}`); }
  assert.equal(v.kannUndo(), false);
  assert.throws(() => rueckgaengig(v, p, { quelle: 'andreas' }), (e) => e instanceof VerlaufFehler && e.grund === 'nichts_zu_tun');
  assert.deepEqual(v.zeiger(), { undo: [], redo: [3, 2, 1] });
  for (let i = 1; i <= 3; i++) { p = wiederholen(v, p, { quelle: 'cypher' }).projekt; assert.equal(ohneRev(p), ohneRev(stand[i]), `Redo auf Stand ${i}`); }
  assert.throws(() => wiederholen(v, p, { quelle: 'andreas' }), (e) => e.grund === 'nichts_zu_tun');
  assert.deepEqual(v.zeiger(), { undo: [1, 2, 3], redo: [] });
  const z = zeilen(datei);
  assert.deepEqual(z.map((e) => [e.rev, e.art, e.bezug]), [[1, 'aendern', null], [2, 'aendern', null], [3, 'aendern', null],
    [4, 'undo', 3], [5, 'undo', 2], [6, 'undo', 1], [7, 'redo', 1], [8, 'redo', 2], [9, 'redo', 3]]);
  assert.deepEqual(z[3].vor, z[2].zurueck); assert.deepEqual(z[3].zurueck, z[2].vor, 'Undo-Zeile: vor/zurueck gegenüber dem Original vertauscht');
  assert.deepEqual(z[6].vor, z[0].vor); assert.equal(z[8].quelle, 'cypher');
  assert.match(z[3].label, /Undo/);
  assert.equal(p.rev, 9, 'jede Änderung, auch Undo und Redo, zählt rev');
});

test('neue Änderung nach Undo macht den Redo-Stapel ungültig (nicht nur leer: auch nach Neustart)', (t) => {
  const { datei, v, stand, uhr } = drei(t);
  let p = rueckgaengig(v, stand[3], { quelle: 'andreas' }).projekt;
  p = rueckgaengig(v, p, { quelle: 'andreas' }).projekt;
  assert.deepEqual(v.zeiger().redo, [3, 2]);
  uhr.t += 1000; p = neu(v, p, [{ befehl: 'tempo_setzen', bpm: 90 }]).projekt;
  assert.equal(v.kannRedo(), false); assert.deepEqual(v.zeiger(), { undo: [1, 6], redo: [] });
  assert.throws(() => wiederholen(v, p, { quelle: 'andreas' }), (e) => e.grund === 'nichts_zu_tun');
  const v2 = new Verlauf(datei, { zeitgeber: false });
  assert.deepEqual(v2.zeiger(), { undo: [1, 6], redo: [] }, 'nach dem Neustart weiterhin ungültig');
});

test('Neustart mitten im Verlauf: gleicher Zeiger, gleiche Liste; Weitermachen aus dem neuen Verlauf liefert dieselben Stände', (t) => {
  const { datei, v, stand, uhr } = drei(t);
  let p = rueckgaengig(v, stand[3], { quelle: 'andreas' }).projekt;
  const vorher = { z: v.zeiger(), l: v.liste() };
  const v2 = new Verlauf(datei, { jetzt: () => uhr.t, zeitgeber: false });
  assert.deepEqual(v2.zeiger(), vorher.z); assert.deepEqual(v2.liste(), vorher.l);
  assert.equal(v2.kannRedo(), true); assert.equal(v2.kannUndo(), true);
  const r = wiederholen(v2, p, { quelle: 'andreas' });
  assert.equal(ohneRev(r.projekt), ohneRev(stand[3]));
  const r2 = rueckgaengig(v2, r.projekt, { quelle: 'andreas' });
  assert.equal(ohneRev(rueckgaengig(v2, r2.projekt, { quelle: 'andreas' }).projekt), ohneRev(stand[1]));
  assert.ok(r.eintrag.rev > 4, 'Revs laufen über den Neustart hinweg weiter');
});

test('Datei: abgeschnittene letzte Zeile (Absturz mitten im Schreiben) wird abgeräumt, der Rest bleibt, weitere Zeilen hängen sauber an', (t) => {
  const { datei, v, stand, uhr } = drei(t);
  const ganz = fs.readFileSync(datei, 'utf8');
  fs.writeFileSync(datei, ganz + '{"rev":4,"zeit":"2026-10-15T12:');
  const v2 = new Verlauf(datei, { jetzt: () => uhr.t, zeitgeber: false });
  assert.deepEqual(v2.zeiger(), { undo: [1, 2, 3], redo: [] });
  assert.equal(fs.readFileSync(datei, 'utf8'), ganz, 'Rest der halben Zeile entfernt');
  const p = neu(v2, stand[3], [{ befehl: 'tempo_setzen', bpm: 77 }]).projekt;
  assert.equal(zeilen(datei).length, 4); assert.equal(p.rev, 4);
  // Gegenprobe: eine kaputte Zeile in der MITTE ist kein Absturzrest, sondern Beschädigung → laut
  const zl = fs.readFileSync(datei, 'utf8').split('\n'); zl[1] = '{kaputt'; fs.writeFileSync(datei, zl.join('\n'));
  assert.throws(() => new Verlauf(datei, { zeitgeber: false }), (e) => e instanceof VerlaufFehler && e.grund === 'verlauf_kaputt' && /2/.test(e.message));
});

test('Datei: widersprüchlicher Verlauf (Undo ohne Vorgänger, falscher bezug) → verlauf_kaputt statt stillem Zeiger', (t) => {
  const { datei } = aufbau(t);
  const z = (o) => JSON.stringify({ zeit: '2026-10-15T12:00:00.000Z', quelle: 'andreas', label: 'x', vor: [], zurueck: [], ...o }) + '\n';
  fs.writeFileSync(datei, z({ rev: 1, art: 'undo', bezug: 5 }));
  assert.throws(() => new Verlauf(datei, { zeitgeber: false }), (e) => e.grund === 'verlauf_kaputt');
  fs.writeFileSync(datei, z({ rev: 1, art: 'aendern', bezug: null }) + z({ rev: 2, art: 'undo', bezug: 9 }));
  assert.throws(() => new Verlauf(datei, { zeitgeber: false }), (e) => e.grund === 'verlauf_kaputt');
  fs.writeFileSync(datei, z({ rev: 2, art: 'aendern', bezug: null }) + z({ rev: 1, art: 'aendern', bezug: null }));
  assert.throws(() => new Verlauf(datei, { zeitgeber: false }), (e) => e.grund === 'verlauf_kaputt', 'rev muss steigen');
  fs.writeFileSync(datei, '');
  assert.deepEqual(new Verlauf(datei, { zeitgeber: false }).zeiger(), { undo: [], redo: [] });
  assert.deepEqual(new Verlauf(path.join(path.dirname(datei), 'gibtsnicht.jsonl'), { zeitgeber: false }).zeiger(), { undo: [], redo: [] }, 'fehlende Datei = leerer Verlauf');
});

test('Undo gegen ein verändertes Projekt (Pfad fehlt): verlauf_inkonsistent, nichts geschrieben, Zeiger unverändert', (t) => {
  const { datei, v, stand } = drei(t);
  const fremd = JSON.parse(JSON.stringify(stand[3])); fremd.spuren = [];   // Spur und Clip sind weg, Undo von Eintrag 3 (Tempo) geht noch, danach nicht
  let p = rueckgaengig(v, fremd, { quelle: 'andreas' }).projekt;
  const n = zeilen(datei).length;
  assert.throws(() => rueckgaengig(v, p, { quelle: 'andreas' }), (e) => e.grund === 'verlauf_inkonsistent');
  assert.equal(zeilen(datei).length, n); assert.deepEqual(v.zeiger(), { undo: [1, 2], redo: [3] });
});

// ---- Zusammenfassen -------------------------------------------------------------------------------------------------
function mixer(t) {
  const x = aufbau(t);
  let p = neu(x.v, neuesProjekt('M'), [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' }]).projekt;   // s1, s2, rev 1
  x.uhr.t += 60_000;
  return { ...x, p };
}
const fader = (v, p, id, wert, quelle = 'andreas') => aendere(v, p, [{ befehl: 'spur_aendern', spur_id: id, fader_db: wert }], { quelle, label: `Fader ${id}` });

test('Mixer-Bewegungen derselben Spur und desselben Parameters innerhalb 1 s: EINE Zeile mit erstem zurueck und letztem vor', (t) => {
  const { datei, v, uhr, p: p0 } = mixer(t);
  let p = p0;
  for (const w of [-1, -2, -3, -4, -5]) { p = fader(v, p, 's1', w).projekt; uhr.t += 200; }
  assert.equal(p.rev, 6, 'jede Bewegung zählt rev');
  assert.equal(zeilen(datei).length, 1, 'noch nicht geschrieben: die Bewegung hängt im Speicher');
  assert.equal(v.liste().length, 2, 'die Liste sieht sie schon');
  v.flush();
  const z = zeilen(datei); assert.equal(z.length, 2);
  assert.deepEqual(z[1].vor, [{ op: 'replace', pfad: '/spuren/s1/fader_db', wert: -5 }], 'letztes vor');
  assert.deepEqual(z[1].zurueck, [{ op: 'replace', pfad: '/spuren/s1/fader_db', wert: 0 }], 'erstes zurueck');
  assert.equal(z[1].rev, 6, 'die Zeile trägt die letzte rev');
  assert.deepEqual(v.zeiger().undo, [1, 6]);
  const u = rueckgaengig(v, p, { quelle: 'andreas' });
  assert.equal(u.projekt.spuren[0].fader_db, 0, 'ein Undo für die ganze Bewegung');
  assert.deepEqual(u.regler_aenderungen, [{ pfad: 'spur/1/fader', wert: 0 }]);
  const re = wiederholen(v, u.projekt, { quelle: 'andreas' });
  assert.equal(re.projekt.spuren[0].fader_db, -5);
});

test('Zusammenfassen nur bei gleicher Spur, gleichem Parameter, gleicher Quelle UND ≤ 1 s Abstand (gleitend ab der letzten Bewegung)', (t) => {
  const { datei, v, uhr, p: p0 } = mixer(t);
  let p = fader(v, p0, 's1', -1).projekt;
  uhr.t += 500; p = fader(v, p, 's2', -1).projekt;                                                  // andere Spur
  uhr.t += 500; p = aendere(v, p, [{ befehl: 'spur_aendern', spur_id: 's2', pan: 0.5 }], A).projekt; // anderer Parameter
  uhr.t += 500; p = aendere(v, p, [{ befehl: 'spur_aendern', spur_id: 's2', pan: 0.6 }], A).projekt; // fasst mit dem Pan davor zusammen
  uhr.t += 500; p = fader(v, p, 's2', -2, 'cypher').projekt;                                         // andere Quelle
  uhr.t += 1001; p = fader(v, p, 's2', -3, 'cypher').projekt;                                        // 1,001 s Abstand
  uhr.t += 1000; p = fader(v, p, 's2', -4, 'cypher').projekt;                                        // genau 1 s: fasst zusammen
  v.flush();
  const z = zeilen(datei).slice(1);
  assert.deepEqual(z.map((e) => [e.quelle, e.vor[0].pfad, e.vor[0].wert]), [
    ['andreas', '/spuren/s1/fader_db', -1], ['andreas', '/spuren/s2/fader_db', -1], ['andreas', '/spuren/s2/pan', 0.6],
    ['cypher', '/spuren/s2/fader_db', -2], ['cypher', '/spuren/s2/fader_db', -4]]);
  assert.deepEqual(z[2].zurueck, [{ op: 'replace', pfad: '/spuren/s2/pan', wert: 0 }]);
  assert.deepEqual(z[4].zurueck, [{ op: 'replace', pfad: '/spuren/s2/fader_db', wert: -2 }], 'der letzte Block (−3, −4) geht auf den Stand davor (−2) zurück');
  // gleitend: Bewegungen im Abstand 600 ms über 3 s bleiben eine Zeile
  const y = mixer(t); let q = y.p;
  for (let i = 0; i < 6; i++) { q = fader(y.v, q, 's1', -i - 1).projekt; y.uhr.t += 600; }
  y.v.flush(); assert.equal(zeilen(y.datei).length, 2);
});

test('andere Änderung, Undo, Redo oder Schließen schreiben die hängende Bewegung zuerst; Reihenfolge der Zeilen = Reihenfolge der Revs', (t) => {
  const { datei, v, uhr, p: p0 } = mixer(t);
  let p = fader(v, p0, 's1', -9).projekt; uhr.t += 100;
  p = aendere(v, p, [{ befehl: 'tempo_setzen', bpm: 99 }], A).projekt;
  let z = zeilen(datei); assert.deepEqual(z.map((e) => e.rev), [1, 2, 3]);
  uhr.t += 100; p = fader(v, p, 's1', -10).projekt;
  const u = rueckgaengig(v, p, { quelle: 'andreas' });
  z = zeilen(datei); assert.deepEqual(z.map((e) => [e.rev, e.art]), [[1, 'aendern'], [2, 'aendern'], [3, 'aendern'], [4, 'aendern'], [5, 'undo']]);
  assert.equal(u.projekt.spuren[0].fader_db, -9, 'Undo nimmt die hängende Bewegung zurück');
  p = u.projekt; uhr.t += 100; p = fader(v, p, 's1', -20).projekt;
  assert.equal(zeilen(datei).length, 5); v.schliesse(); assert.equal(zeilen(datei).length, 6);
  assert.deepEqual(new Verlauf(datei, { zeitgeber: false }).zeiger(), v.zeiger());
  // nach einem Undo beginnt eine Bewegung neu (fasst nicht mit dem Zustand davor zusammen)
  const w = mixer(t); let q = fader(w.v, w.p, 's1', -1).projekt; q = rueckgaengig(w.v, q, { quelle: 'andreas' }).projekt;
  w.uhr.t += 10; q = fader(w.v, q, 's1', -2).projekt; w.v.flush();
  assert.deepEqual(zeilen(w.datei).slice(1).map((e) => e.art), ['aendern', 'undo', 'aendern']);
});

test('Zeitgeber: eine hängende Bewegung wird nach dem Fenster von selbst geschrieben (echte Zeit, kleines Fenster)', async (t) => {
  const { datei, v } = aufbau(t, { zeitgeber: true, zusammenfassenMs: 60, jetzt: undefined });
  let p = neu(v, neuesProjekt('Z'), [{ befehl: 'spur_neu', art: 'audio' }]).projekt;
  p = fader(v, p, 's1', -3).projekt;
  assert.equal(zeilen(datei).length, 1);
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(zeilen(datei).length, 2, 'nach dem Fenster geschrieben');
  v.schliesse();
});

test('Mehrere Befehle in einem Aufruf oder mehr als ein Parameter werden nie zusammengefasst', (t) => {
  const { datei, v, uhr, p: p0 } = mixer(t);
  let p = aendere(v, p0, [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -1, pan: 0.1 }], A).projekt; uhr.t += 10;
  p = aendere(v, p, [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -2, pan: 0.2 }], A).projekt; uhr.t += 10;
  p = aendere(v, p, [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }, { befehl: 'spur_aendern', spur_id: 's2', fader_db: -3 }], A).projekt;
  v.flush(); assert.equal(zeilen(datei).length, 4);
});

test('Haken speichere: läuft mit dem neuen Stand VOR dem Eintrag (Datei noch ohne die Zeile); wirft er, bleibt Verlauf und Datei unverändert', (t) => {
  const { datei, v, uhr } = aufbau(t);
  let p = neu(v, neuesProjekt('H'), [{ befehl: 'spur_neu', art: 'audio' }]).projekt;
  const gesehen = [];
  const hakenA = { speichere: (n) => gesehen.push([n.rev, zeilen(datei).length]) };
  uhr.t += 5000; p = aendere(v, p, [{ befehl: 'tempo_setzen', bpm: 90 }], A, hakenA).projekt;
  p = rueckgaengig(v, p, { quelle: 'andreas' }, hakenA).projekt;
  p = wiederholen(v, p, { quelle: 'andreas' }, hakenA).projekt;
  assert.deepEqual(gesehen, [[2, 1], [3, 2], [4, 3]], 'jeweils schon die neue rev, aber die Zeile fehlt noch');
  assert.equal(zeilen(datei).length, 4);
  const boese = { speichere: () => { throw new Error('Platte voll'); } };
  const zeigerVorher = v.zeiger();
  assert.throws(() => aendere(v, p, [{ befehl: 'tempo_setzen', bpm: 70 }], A, boese), /Platte voll/);
  assert.throws(() => rueckgaengig(v, p, { quelle: 'andreas' }, boese), /Platte voll/);
  assert.equal(zeilen(datei).length, 4); assert.deepEqual(v.zeiger(), zeigerVorher);
  assert.equal(rueckgaengig(v, p, { quelle: 'andreas' }).projekt.tempo_bpm, neuesProjekt('x').tempo_bpm, 'der Verlauf ist danach noch benutzbar');
});
