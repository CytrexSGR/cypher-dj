// Paket 1.13 Slice 6 (D12): stumm am Audio-Clip. Modell, clip_aendern, Übersetzer (Live und Export lesen dieselbe Wiedergabe).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fehlendesAudio } from '../bereiche/proj/ausgabe.ts';
import { uebersetze } from '../projekt/wiedergabe.ts';
import { fuehreAus } from '../projekt/befehle.ts';
import { pruefeProjekt } from '../projekt/modell.ts';
import { specProjekt, SHA_A } from './hilfen/projekt.mjs';

const AUDIO = '/arbeit/arr/audio';
const opt = { nr: 1, audioOrdner: AUDIO, frames: (sha) => (sha === SHA_A ? 24000 : null) };
const audioClip = (p) => p.spuren.flatMap((s) => s.clips).find((c) => c.art === 'audio');
const wClips = (w) => w.spuren.flatMap((s) => s.clips ?? []);
const vonClip = (w, id) => wClips(w).filter((x) => x.id === id || String(x.id).startsWith(`${id}~`));   // Loops: <clip>~<k>

test('Slice 6: clip_aendern stumm; der Übersetzer lässt den stummen Clip weg, ohne stumm bleibt die Wiedergabe gleich', () => {
  const p = specProjekt();
  const c = audioClip(p);
  const vorher = uebersetze(p, opt);
  const r = fuehreAus(p, { befehl: 'clip_aendern', clip_id: c.id, stumm: true });
  assert.equal(audioClip(r.projekt).stumm, true);
  assert.ok(!wClips(uebersetze(r.projekt, opt)).some((x) => x.id === c.id), 'stummer Clip fehlt in der Wiedergabe');
  const z = fuehreAus(r.projekt, { befehl: 'clip_aendern', clip_id: c.id, stumm: false });
  assert.deepEqual(uebersetze(z.projekt, opt), vorher, 'stumm false: wie vorher');
  assert.throws(() => fuehreAus(p, { befehl: 'clip_aendern', clip_id: c.id, stumm: 1 }), /argument_ungueltig/);
});

test('Slice 6 (Review M1): clip_aendern stumm über den Befehlsweg betrifft die Wiedergabe, ein Nicht-Ändern nicht', () => {
  const p = specProjekt();
  const c = audioClip(p);
  assert.equal(fuehreAus(p, { befehl: 'clip_aendern', clip_id: c.id, stumm: true }).betrifft_wiedergabe, true);
  const stumm = fuehreAus(p, { befehl: 'clip_aendern', clip_id: c.id, stumm: true }).projekt;
  assert.equal(fuehreAus(stumm, { befehl: 'clip_aendern', clip_id: c.id, stumm: false }).betrifft_wiedergabe, true);
  assert.equal(fuehreAus(p, { befehl: 'clip_aendern', clip_id: c.id, name: 'Nur Name' }).betrifft_wiedergabe, false);   // Negativ-Kontrolle
});

test('Slice 6: stumm nur am Audio-Clip, und das Modell prüft den Typ', () => {
  const p = specProjekt();
  const midi = p.spuren.flatMap((s) => s.clips).find((c) => c.art === 'midi');
  assert.throws(() => fuehreAus(p, { befehl: 'clip_aendern', clip_id: midi.id, stumm: true }), /feld_nur_audio/);
  const kaputt = structuredClone(p); audioClip(kaputt).stumm = 'ja';
  assert.match(pruefeProjekt(kaputt).fehler ?? '', /stumm/);   // pruefeProjekt gibt { fehler } zurück, wirft nicht
  assert.ok(pruefeProjekt(p).projekt, 'Negativ-Kontrolle: ohne stumm gültig');
  const ok = structuredClone(p); audioClip(ok).stumm = true;
  assert.ok(pruefeProjekt(ok).projekt, 'stumm: true ist gültig');
});

test('Slice 6 (Nachzug T4-m1): stumm false löscht das Feld ganz; null lehnt ab (F2: false löscht, null ist nicht erlaubt)', () => {
  const p = specProjekt();
  const c = audioClip(p);
  const stumm = fuehreAus(p, { befehl: 'clip_aendern', clip_id: c.id, stumm: true }).projekt;
  const z = fuehreAus(stumm, { befehl: 'clip_aendern', clip_id: c.id, stumm: false }).projekt;
  assert.equal('stumm' in audioClip(z), false, 'stumm: false setzt kein false-Feld, es löscht');
  assert.throws(() => fuehreAus(p, { befehl: 'clip_aendern', clip_id: c.id, stumm: null }), /argument_ungueltig/);
});

test('Slice 6 (Nachzug T4-m2): ein stummer Loop-Clip fehlt ebenfalls in der Wiedergabe', () => {
  const p = specProjekt();
  const c = audioClip(p);
  const lauf = fuehreAus(p, { befehl: 'clip_aendern', clip_id: c.id, laenge_beats: 1, loop_beats: 0.5 }).projekt;
  assert.ok(vonClip(uebersetze(lauf, opt), c.id).length >= 2, 'Positiv-Kontrolle: der Loop-Clip klingt (Kopien)');
  const stumm = fuehreAus(lauf, { befehl: 'clip_aendern', clip_id: c.id, stumm: true }).projekt;
  assert.equal(audioClip(stumm).loop_beats, 0.5);
  assert.equal(vonClip(uebersetze(stumm, opt), c.id).length, 0, 'stummer Loop-Clip fehlt');
});

test('Slice 6 (Nachzug T4-m3): fehlendesAudio überspringt stumme Clips (ein stummer, nicht dekodierter Clip verkürzt den Export nicht)', () => {
  const p = specProjekt();
  const c = audioClip(p);
  const roh = structuredClone(p); audioClip(roh).dekodiert = 'nein';
  const von = c.start_beat, bis = c.start_beat + c.laenge_beats;
  assert.deepEqual(fehlendesAudio(roh, von, bis), [c.id], 'Positiv-Kontrolle: ein hörbarer, undekodierter Clip fehlt');
  const stumm = fuehreAus(roh, { befehl: 'clip_aendern', clip_id: c.id, stumm: true }).projekt;
  assert.deepEqual(fehlendesAudio(stumm, von, bis), []);
});
