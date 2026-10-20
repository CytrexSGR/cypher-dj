// D1 S2-Integration, zweite Fix-Runde F6 (Spec 6.31): Eine Änderung wird einmal ausgeführt, nicht als Probe und im Verlauf noch einmal. Dazu
// der Notenweg (nur die genannten Clips werden kopiert, ungeänderte Noten geteilt) und gleicheSicht (vergleiche ohne Sortieren und Serialisieren).
// Die Zeitgrenzen prüft proj_fix_b4_leistung; hier die Mechanik: Zahl der Ausführungen, gleiches Ergebnis wie der volle Weg, Ausgangsstand unberührt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus, gleicheSicht } from '../projekt/befehle.ts';
import { kanonisch } from '../projekt/modell.ts';
import { aendere, rueckgaengig } from '../projekt/verlauf.ts';
import { wende } from '../projekt/patch.ts';
import { vergleiche } from '../projekt/befehle.ts';
import { sitzung } from './hilfen/proj_kontext.mjs';

// Ein Befehl als Proxy: zählt Object.keys auf dem Befehl. Jede Ausführung prüft die Argumente genau einmal mit erlaube() (Object.keys);
// sonst liest auf dem Weg einer Notenänderung niemand die Schlüssel des Befehls.
function gezaehlt(befehl) {
  const z = { keys: 0 };
  return { z, b: new Proxy(befehl, { ownKeys(t) { z.keys += 1; return Reflect.ownKeys(t); } }) };
}

test('F6 /proj/aendern führt eine Notenänderung genau einmal aus (vorher zweimal: Probe und Verlauf)', async (t) => {
  const { s } = sitzung(t);
  await s.neu('E', 'andreas');
  await s.aendern({ rev: 0, label: 'a', befehle: [{ befehl: 'spur_neu', art: 'instrument' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [{ beat: 0, laenge: 1, ton: 36, vel: 90 }] }] }, 'andreas');
  const { z, b } = gezaehlt({ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'n1', vel: 50 }] });
  const r = await s.aendern({ rev: 1, label: 'b', befehle: [b] }, 'andreas');
  console.log(`F6 Ausführungen ${JSON.stringify({ code: r.code, ausfuehrungen: z.keys, vel: r.j.projekt.spuren[0].clips[0].noten[0].vel })}`);
  assert.equal(r.code, 200);
  assert.equal(r.j.projekt.spuren[0].clips[0].noten[0].vel, 50);
  assert.equal(z.keys, 1, 'eine Ausführung');
});

test('F6 aendere nimmt ein mitgegebenes Ergebnis und rechnet nicht selbst; ohne Ergebnis rechnet es (Negativ-Kontrolle)', async (t) => {
  const { s } = sitzung(t);
  await s.neu('E', 'andreas');
  const o = s.zugangOffen();
  const befehle = [{ befehl: 'spur_neu', art: 'audio' }];
  const ergebnis = fuehreListeAus(o.projekt, befehle, { quelle: 'andreas' });
  const { z, b } = gezaehlt(befehle[0]);
  const w = aendere(o.verlauf, o.projekt, [b], { quelle: 'andreas', label: 'x' }, {}, { ergebnis });
  assert.equal(z.keys, 0, 'mit Ergebnis keine Ausführung');
  assert.equal(w.projekt, ergebnis.projekt);
  const ohne = gezaehlt({ befehl: 'spur_neu', art: 'audio' });
  aendere(o.verlauf, w.projekt, [ohne.b], { quelle: 'andreas', label: 'y' });
  assert.equal(ohne.z.keys, 1, 'ohne Ergebnis eine Ausführung');
});

test('F6 Undo nimmt den schon gerechneten Stand des Servers für genau diesen Eintrag; für einen anderen rechnet es selbst', async (t) => {
  const { s } = sitzung(t);
  await s.neu('U', 'andreas');
  await s.aendern({ rev: 0, label: 'a', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  await s.aendern({ rev: 1, label: 'b', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  const o = s.zugangOffen();
  const ziel = o.verlauf.naechstesUndo();
  const stand = wende(o.projekt, ziel.zurueck), vergleich = vergleiche(o.projekt, stand);
  const fremd = { ...ziel };                                                        // anderer Eintrag (gleicher Inhalt, andere Identität)
  const w1 = rueckgaengig(o.verlauf, o.projekt, { quelle: 'andreas' }, {}, { ziel: fremd, stand, vergleich });
  assert.notEqual(w1.projekt, stand, 'fremder Eintrag: selbst gerechnet');
  assert.deepEqual(w1.projekt.spuren.map((x) => x.id), ['s1']);
  const ziel2 = o.verlauf.naechstesUndo();
  const stand2 = wende(w1.projekt, ziel2.zurueck);
  const w2 = rueckgaengig(o.verlauf, w1.projekt, { quelle: 'andreas' }, {}, { ziel: ziel2, stand: stand2, vergleich: vergleiche(w1.projekt, stand2) });
  assert.equal(w2.projekt, stand2, 'derselbe Eintrag: der mitgegebene Stand');
  assert.deepEqual(w2.projekt.spuren, []);
  assert.equal(w2.projekt.rev, w1.projekt.rev + 1);
});

// --- Notenweg: gleiches Ergebnis wie der volle Weg, der Ausgangsstand bleibt unberührt --------------------------------------------------------
// Drei Instrument-Spuren über die Befehle selbst (gültig wie im Betrieb); s2 ist ein Surge-Wirt mit Freeze. Noten-IDs n1..n8.
const FREEZE = { datei: 'freeze-7.f32', frames: 48000, kennung: 7, sha256: 'a'.repeat(64) };
function projekt() {
  const note = (beat, ton) => ({ beat, laenge: 0.5, ton, vel: 90 });
  const leer = { format: 'cypherdj-projekt/1', name: 'N', rev: 3, wiedergabe_rev: 2, tempo_bpm: 120, taktart: [4, 4],
    loop: { an: false, von_beat: 0, bis_beat: 16 }, metronom: { an: false, pegel_db: -12, ziel: 'master' }, spuren: [] };
  const p = fuehreListeAus(leer, [{ befehl: 'spur_neu', art: 'instrument' }, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt' } },
    { befehl: 'spur_neu', art: 'instrument' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [note(0, 36), note(1, 38), note(2, 40)] },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 4, laenge_beats: 4, noten: [note(0, 43)] },
    { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 8, noten: [note(0, 60), note(4, 62)] },
    { befehl: 'clip_neu', spur_id: 's3', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [note(0, 48), note(1, 50)] }], { quelle: 'andreas' }).projekt;
  p.spuren[1].freeze = structuredClone(FREEZE);
  return p;
}
const LISTEN = {
  aendern: [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'n2', vel: 60, ton: 39 }, { id: 'n2', laenge: 1 }] }],
  neu_mit_und_ohne_id: [{ befehl: 'noten_neu', clip_id: 'c1', noten: [{ beat: 3, laenge: 0.5, ton: 41, vel: 80 }, { id: 'n20', beat: 3.5, laenge: 0.25, ton: 43, vel: 70 }] }],
  loeschen: [{ befehl: 'noten_loeschen', clip_id: 'c1', ids: ['n1', 'n3'] }],
  zwei_clips: [{ befehl: 'noten_aendern', clip_id: 'c2', noten: [{ id: 'n4', beat: 1 }] }, { befehl: 'noten_loeschen', clip_id: 'c4', ids: ['n7'] }],
  eingefroren: [{ befehl: 'noten_aendern', clip_id: 'c3', noten: [{ id: 'n5', vel: 100 }] }],          // Freeze von s2 verfällt
  gleicher_wert: [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'n1', vel: 90 }] }],         // keine Änderung: leerer Patch
  neu_dann_aendern: [{ befehl: 'noten_neu', clip_id: 'c2', noten: [{ beat: 2, laenge: 1, ton: 45, vel: 90 }] },
    { befehl: 'noten_aendern', clip_id: 'c2', noten: [{ id: 'n9', vel: 20 }] }],
};
for (const [name, befehle] of Object.entries(LISTEN)) {
  test(`F6 Notenweg ${name}: gleiches Ergebnis wie der volle Weg, Ausgangsprojekt unverändert`, () => {
    const p = projekt(), vorher = structuredClone(p);
    const schnell = fuehreListeAus(p, structuredClone(befehle), { quelle: 'andreas' });
    assert.deepEqual(p, vorher, 'Ausgangsprojekt unverändert');
    const voll = fuehreListeAus(projekt(), structuredClone(befehle), { voll: true, quelle: 'andreas' });
    assert.deepEqual(schnell.projekt, voll.projekt);
    assert.deepEqual(schnell.vor, voll.vor); assert.deepEqual(schnell.zurueck, voll.zurueck);
    assert.equal(schnell.betrifft_wiedergabe, voll.betrifft_wiedergabe); assert.deepEqual(schnell.regler_aenderungen, voll.regler_aenderungen);
    // geteilt wird nur, was kein Befehl berührt: s3 bleibt dasselbe Objekt, wenn c4 nicht genannt ist
    if (!befehle.some((b) => b.clip_id === 'c4')) assert.equal(schnell.projekt.spuren[2], p.spuren[2]);
  });
}
test('F6 Notenweg eingefroren: der Freeze der berührten Spur verfällt, im Ausgangsprojekt bleibt er', () => {
  const p = projekt();
  const r = fuehreListeAus(p, LISTEN.eingefroren, { quelle: 'andreas' });
  assert.equal(r.projekt.spuren[1].freeze, null);
  assert.deepEqual(p.spuren[1].freeze, FREEZE);
});

// --- gleicheSicht: wie kanonisch(a) === kanonisch(b) -------------------------------------------------------------------------------------
test('F6 gleicheSicht entscheidet wie der kanonische Vergleich (Schlüsselfolge, -0, undefined, Arrays, Typen)', () => {
  const paare = [
    [{ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }], [{ a: 1 }, { a: 2 }], [{ a: [1, 2] }, { a: [2, 1] }], [{ a: 0 }, { a: -0 }],
    [{ a: 1, x: undefined }, { a: 1 }], [{ a: null }, { a: undefined }], [[1, [2, { c: 3 }]], [1, [2, { c: 3 }]]], [[1, 2], [1, 2, 3]],
    [{ a: '1' }, { a: 1 }], [{ a: {} }, { a: [] }], [{ a: { b: { c: 1 } } }, { a: { b: { c: 1, d: 2 } } }], [null, null], [{ n: [] }, { n: [] }],
  ];
  for (const [a, b] of paare) assert.equal(gleicheSicht(a, b), kanonisch(a) === kanonisch(b), `${JSON.stringify(a)} / ${JSON.stringify(b)}`);
});
