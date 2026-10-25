// D1 S2-Kern, Modell: project.json cypherdj-projekt/1 (Spec 3.3), Prüfung, Erzeugung, IDs. Reine Funktionen, keine Datei.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeProjekt, neueId, neueNotenId, wiedergabeSicht, kanonisch, FORMAT, MAX_SPUREN } from '../projekt/modell.ts';
import { specProjekt, kopie, SHA_A } from './hilfen/projekt.mjs';

test('neuesProjekt: gültig, leer, Vorgaben nach Spec (Tempo, 4/4, Loop, Metronom aus/master)', () => {
  const p = neuesProjekt('First Track');
  assert.equal(p.format, FORMAT); assert.equal(p.format, 'cypherdj-projekt/2');   // 1.10 Task 9: /2 (gruppen, master); /1 wird beim Laden gehoben
  assert.equal(p.name, 'First Track'); assert.equal(p.rev, 0); assert.equal(p.wiedergabe_rev, 0);
  assert.deepEqual(p.taktart, [4, 4]); assert.deepEqual(p.spuren, []);
  assert.equal(p.metronom.an, false); assert.equal(p.metronom.ziel, 'master');
  assert.ok(p.tempo_bpm >= 60 && p.tempo_bpm <= 200);
  assert.ok(p.loop.bis_beat - p.loop.von_beat >= 1);
  const r = pruefeProjekt(p);
  assert.ok(r.projekt, JSON.stringify(r)); assert.deepEqual(r.projekt, p);
});

test('das Beispiel aus Spec 3.3 ist ein gültiges Projekt (Negativ-Kontrolle: die Ablehnungen unten treffen dieselbe Funktion)', () => {
  const r = pruefeProjekt(specProjekt());
  assert.ok(r.projekt, JSON.stringify(r));
});

const ABLEHNUNGEN = [
  ['format falsch', (p) => { p.format = 'cypherdj-projekt/3'; }, /format/],   // 1.10 Task 9: /2 ist jetzt gültig und scheiterte an „gruppen: fehlt“
  ['name leer', (p) => { p.name = ''; }, /name/],
  ['name zu lang', (p) => { p.name = 'x'.repeat(81); }, /name/],
  ['rev negativ', (p) => { p.rev = -1; }, /rev/],
  ['rev gebrochen', (p) => { p.rev = 1.5; }, /rev/],
  ['tempo 59', (p) => { p.tempo_bpm = 59; }, /tempo_bpm/],
  ['tempo 201', (p) => { p.tempo_bpm = 201; }, /tempo_bpm/],
  ['tempo NaN', (p) => { p.tempo_bpm = NaN; }, /tempo_bpm/],
  ['tempo als Text', (p) => { p.tempo_bpm = '120'; }, /tempo_bpm/],
  ['taktart 3/4', (p) => { p.taktart = [3, 4]; }, /taktart/],
  ['taktart 4/8', (p) => { p.taktart = [4, 8]; }, /taktart/],
  ['loop kürzer als 1 Beat', (p) => { p.loop.bis_beat = 0.5; }, /loop/],
  ['loop von negativ', (p) => { p.loop.von_beat = -1; }, /loop/],
  ['metronom ziel unbekannt', (p) => { p.metronom.ziel = 'ausgang'; }, /metronom/],
  ['metronom pegel über 0', (p) => { p.metronom.pegel_db = 3; }, /metronom/],
  ['unbekanntes Feld', (p) => { p.zusatz = 1; }, /zusatz/],
  ['elf Spuren', (p) => { for (let i = 0; i < MAX_SPUREN - 2; i++) p.spuren.push({ ...kopie(p.spuren[0]), id: `x${i}`, nr: 4 + i, clips: [] }); }, /spuren/],
  ['nr 0', (p) => { p.spuren[0].nr = 0; }, /nr/],
  ['nr MAX_SPUREN + 1', (p) => { p.spuren[0].nr = MAX_SPUREN + 1; }, /nr/],
  ['nr doppelt', (p) => { p.spuren[1].nr = 1; }, /nr/],
  ['spur-id doppelt', (p) => { p.spuren[1].id = 's1'; }, /id/],
  ['farbe kein Hex', (p) => { p.spuren[0].farbe = 'rot'; }, /farbe/],
  ['pan über 1', (p) => { p.spuren[0].pan = 1.5; }, /pan/],
  ['fader unter -200', (p) => { p.spuren[0].fader_db = -201; }, /fader_db/],
  ['mute als Zahl', (p) => { p.spuren[0].mute = 1; }, /mute/],
  ['spur-art unbekannt', (p) => { p.spuren[0].art = 'midi'; }, /art/],
  ['audio-spur mit geraet', (p) => { p.spuren[0].geraet = { art: 'intern', name: 'rb338', parameter: {} }; }, /geraet/],
  ['audio-spur mit freeze', (p) => { p.spuren[0].freeze = null; }, /freeze/],
  ['instrument ohne geraet', (p) => { delete p.spuren[1].geraet; }, /geraet/],
  ['intern mit falschem Namen', (p) => { p.spuren[1].geraet.name = 'surge'; }, /geraet/],
  ['intern-parameter über 1', (p) => { p.spuren[1].geraet.parameter = { cutoff: 1.5 }; }, /parameter/],
  ['wirt slot 3', (p) => { p.spuren[2].geraet.slot = 3; }, /slot/],
  ['wirt slot doppelt', (p) => { const s = kopie(p.spuren[2]); s.id = 's4'; s.nr = 4; p.spuren.push(s); }, /slot/],
  ['intern mit freeze', (p) => { p.spuren[1].freeze = null; }, /freeze/],
  ['wirt: freeze fehlt', (p) => { delete p.spuren[2].freeze; }, /freeze/],
  ['freeze ohne frames', (p) => { p.spuren[2].freeze = { datei: 'freeze/s3-k1.f32', kennung: 'k1' }; }, /freeze/],
  ['clip-id doppelt (spurübergreifend)', (p) => { p.spuren[1].clips[0].id = 'c1'; }, /id/],
  ['audio-clip auf Instrument-Spur', (p) => { p.spuren[1].clips.push({ ...kopie(p.spuren[0].clips[0]), id: 'c9' }); }, /art/],
  ['midi-clip auf Audio-Spur', (p) => { p.spuren[0].clips.push({ ...kopie(p.spuren[1].clips[0]), id: 'c9' }); }, /art/],
  ['clip start negativ', (p) => { p.spuren[0].clips[0].start_beat = -1; }, /start_beat/],
  ['clip länge 0', (p) => { p.spuren[0].clips[0].laenge_beats = 0; }, /laenge_beats/],
  ['sha zu kurz', (p) => { p.spuren[0].clips[0].quelle.sha256 = 'abc'; }, /sha256/],
  ['sha in Großbuchstaben', (p) => { p.spuren[0].clips[0].quelle.sha256 = 'A'.repeat(64); }, /sha256/],
  ['dekodiert unbekannt', (p) => { p.spuren[0].clips[0].dekodiert = 'bald'; }, /dekodiert/],
  ['offset negativ', (p) => { p.spuren[0].clips[0].offset_s = -0.1; }, /offset_s/],
  ['fades länger als der Clip', (p) => { p.spuren[0].clips[0].fade_ein_beats = 0.7; p.spuren[0].clips[0].fade_aus_beats = 0.7; }, /fade/],
  ['note ton 128', (p) => { p.spuren[1].clips[0].noten[0].ton = 128; }, /ton/],
  ['note vel 0', (p) => { p.spuren[1].clips[0].noten[0].vel = 0; }, /vel/],
  ['note länge 0', (p) => { p.spuren[1].clips[0].noten[0].laenge = 0; }, /laenge/],
  ['note beat negativ', (p) => { p.spuren[1].clips[0].noten[0].beat = -0.25; }, /beat/],
  ['noten-id doppelt im Clip', (p) => { p.spuren[1].clips[0].noten.push({ id: 'n1', beat: 1, laenge: 1, ton: 40, vel: 90 }); }, /id/],
  ['clips kein Array', (p) => { p.spuren[0].clips = {}; }, /clips/],
];
for (const [name, mut, muster] of ABLEHNUNGEN) {
  test(`pruefeProjekt lehnt ab: ${name}`, () => {
    const p = specProjekt(); mut(p);
    const r = pruefeProjekt(p);
    assert.ok(r.fehler, `hätte abgelehnt werden müssen: ${JSON.stringify(r).slice(0, 200)}`);
    assert.match(r.fehler, muster);
  });
}

test('pruefeProjekt: Nicht-Objekte und Grenzen (10 Spuren erlaubt, 4096 Clips / 65536 Noten Deckel)', () => {
  for (const x of [null, 5, 'x', [], undefined]) assert.ok(pruefeProjekt(x).fehler);
  const p = specProjekt();
  for (let i = 4; i <= MAX_SPUREN; i++) p.spuren.push({ id: `s${i}`, nr: i, name: `A${i}`, farbe: '#000000', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
  assert.equal(p.spuren.length, MAX_SPUREN); assert.ok(pruefeProjekt(p).projekt, 'nr MAX_SPUREN ist gültig (T05)');
  p.spuren.push({ ...kopie(p.spuren[0]), id: `s${MAX_SPUREN + 1}`, nr: MAX_SPUREN + 1, clips: [] }); assert.match(pruefeProjekt(p).fehler, /spuren|nr/);
  const q = specProjekt();   // 65537 Noten in einem Clip
  q.spuren[1].clips[0].noten = Array.from({ length: 65537 }, (_, i) => ({ id: `n${i}`, beat: 0, laenge: 1, ton: 36, vel: 100 }));
  assert.match(pruefeProjekt(q).fehler, /noten/);
  q.spuren[1].clips[0].noten.length = 65536; assert.ok(pruefeProjekt(q).projekt);
});

test('pruefeProjekt liefert eine Kopie: Änderung am Ergebnis berührt die Eingabe nicht', () => {
  const p = specProjekt(); const r = pruefeProjekt(p);
  r.projekt.spuren[0].name = 'anders'; assert.equal(p.spuren[0].name, 'Kick');
});

test('neueId: kleinste unbenutzte Nummer über dem Maximum, Clip-IDs projektweit, Noten-IDs aus einem Zähler im Projekt (Spec 6.28)', () => {
  const p = specProjekt();
  assert.equal(neueId(p, 'spur'), 's4'); assert.equal(neueId(p, 'clip'), 'c3');
  assert.equal(neueNotenId(p), 'n2'); assert.equal(p.naechste_noten_id, 3);
  const q = specProjekt(); q.spuren.splice(0, 2);                                   // frisch: neueId zählt den Zähler des Projekts hoch (Spec 6.26)
  assert.equal(neueId(q, 'spur'), 's4', 'Maximum der lebenden IDs, keine Lücke wird gefüllt');
  assert.equal(neueId(q, 'clip'), 'c1', 'ohne Clips wieder bei 1');
  assert.equal(neueId(q, 'spur'), 's5', 'der Zähler steigt: dieselbe ID kommt nie zweimal');
  assert.equal(neueNotenId({ spuren: [] }), 'n1');
});

test('wiedergabeSicht: nur Klangwirksames; Name, Farbe, Mixer, Tempo, Rev ändern sie nicht, Noten und Gerät schon', () => {
  const a = kanonisch(wiedergabeSicht(specProjekt()));
  const b = specProjekt();
  b.name = 'x'; b.rev = 99; b.tempo_bpm = 90; b.spuren[0].name = 'y'; b.spuren[0].farbe = '#111111'; b.spuren[0].fader_db = -6; b.spuren[0].pan = 0.5;
  b.spuren[0].mute = true; b.spuren[1].clips[0].name = 'z'; b.loop.an = false; b.metronom.an = true;
  assert.equal(kanonisch(wiedergabeSicht(b)), a);
  const c = specProjekt(); c.spuren[1].clips[0].noten[0].ton = 37;
  assert.notEqual(kanonisch(wiedergabeSicht(c)), a);
  const d = specProjekt(); d.spuren[2].geraet.slot = 2;
  assert.notEqual(kanonisch(wiedergabeSicht(d)), a);
  const e = specProjekt(); e.spuren[0].clips[0].offset_s = 0.1;
  assert.notEqual(kanonisch(wiedergabeSicht(e)), a);
});

test('kanonisch: Schlüssel sortiert (tief), gleiche Daten in anderer Schlüsselfolge ergeben denselben Text', () => {
  assert.equal(kanonisch({ b: 1, a: { d: 2, c: [{ y: 1, x: 2 }] } }), '{"a":{"c":[{"x":2,"y":1}],"d":2},"b":1}');
  const rueckwaerts = (x) => (Array.isArray(x) ? x.map(rueckwaerts) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).reverse().map((k) => [k, rueckwaerts(x[k])])) : x);
  assert.notEqual(JSON.stringify(rueckwaerts(specProjekt())), JSON.stringify(specProjekt()), 'Gegenprobe: die Schlüsselfolge ist wirklich anders');
  assert.equal(kanonisch(specProjekt()), kanonisch(rueckwaerts(specProjekt())));
  assert.equal(kanonisch(-0), '0');
  assert.ok(SHA_A);
});
