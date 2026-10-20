// D1 S2-Integration, Slice 2: Clip-Loop (Spec 6.17): Feld loop_beats, Ausrollen im Übersetzer (Wiedergabe-Format und Kern unverändert),
// Grenzen nach dem Ausrollen, Teilen gesperrt, Duplizieren übernimmt. Reine Funktionen, kein Server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus } from '../projekt/befehle.ts';
import { pruefeProjekt } from '../projekt/modell.ts';
import { uebersetze, zaehleAusgerollt } from '../projekt/wiedergabe.ts';
import { specProjekt, kopie, SHA_A } from './hilfen/projekt.mjs';

const opt = { nr: 1, audioOrdner: '/arbeit/arr/audio', frames: () => 48000 };
const wSpur = (p, nr) => uebersetze(p, opt).spuren.find((s) => s.nr === nr);
const ungueltig = (p) => { const r = pruefeProjekt(p); return 'fehler' in r ? r.fehler : null; };

test('6.17 Modell: loop_beats fehlt, null, 1/16 und = laenge_beats sind gültig; kleiner als 1/16, länger als der Clip, Text nicht', () => {
  const p = specProjekt();
  assert.equal(ungueltig(p), null, 'ohne Feld (alte Projekte)');
  for (const w of [null, 1 / 16, 1, p.spuren[0].clips[0].laenge_beats]) { const q = kopie(p); q.spuren[0].clips[0].loop_beats = w; assert.equal(ungueltig(q), null, String(w)); }
  for (const w of [1 / 32, 1.5, '1', 0]) {
    const q = kopie(p); q.spuren[0].clips[0].loop_beats = w;
    assert.match(ungueltig(q) ?? '', /loop_beats/, String(w));
  }
  const m = kopie(p); m.spuren[1].clips[0].loop_beats = 4; assert.equal(ungueltig(m), null, 'MIDI-Clip ebenso');
});

test('6.17 clip_aendern: Loop setzen und wieder ausschalten (null); länger als der Clip ist argument_ungueltig; Kürzen zieht den Loop mit', () => {
  const p = specProjekt();
  const r = fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c1', loop_beats: 1, laenge_beats: 32 });
  assert.deepEqual([r.projekt.spuren[0].clips[0].loop_beats, r.projekt.spuren[0].clips[0].laenge_beats], [1, 32]);
  assert.equal(fuehreAus(r.projekt, { befehl: 'clip_aendern', clip_id: 'c1', loop_beats: 2 }).betrifft_wiedergabe, true, 'nur der Loop ändert den Klang');
  assert.deepEqual(r.vor, [{ op: 'replace', pfad: '/spuren/s1/clips/c1/laenge_beats', wert: 32 }, { op: 'add', pfad: '/spuren/s1/clips/c1/loop_beats', wert: 1 }]);
  const aus = fuehreAus(r.projekt, { befehl: 'clip_aendern', clip_id: 'c1', loop_beats: null });
  assert.equal(aus.projekt.spuren[0].clips[0].loop_beats, null);
  assert.throws(() => fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c1', loop_beats: 2 }), (e) => e.grund === 'argument_ungueltig' && /laenge_beats/.test(e.message));
  assert.throws(() => fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c1', loop_beats: 1 / 32 }), (e) => e.grund === 'argument_ungueltig');
  const m = fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c2', loop_beats: 4 }).projekt;
  const k = fuehreAus(m, { befehl: 'clip_aendern', clip_id: 'c2', laenge_beats: 3 }).projekt;
  assert.deepEqual([k.spuren[1].clips[0].laenge_beats, k.spuren[1].clips[0].loop_beats], [3, 3]);
});

test('6.17 clip_teilen auf einem Loop-Clip ist argument_ungueltig (Loop erst ausschalten); clip_duplizieren übernimmt loop_beats', () => {
  const p = fuehreAus(specProjekt(), { befehl: 'clip_aendern', clip_id: 'c2', loop_beats: 4 }).projekt;
  assert.throws(() => fuehreAus(p, { befehl: 'clip_teilen', clip_id: 'c2', beat: 8 }), (e) => e.grund === 'argument_ungueltig' && /Loop-Clip/.test(e.message));
  const d = fuehreAus(p, { befehl: 'clip_duplizieren', clip_id: 'c2' }).projekt;
  assert.equal(d.spuren[1].clips[1].loop_beats, 4);
  assert.doesNotThrow(() => fuehreAus(specProjekt(), { befehl: 'clip_teilen', clip_id: 'c2', beat: 8 }), 'Negativ-Kontrolle: ohne Loop teilen');
});

test('6.17 Ausrollen Audio: ein Kick (1 Beat) über 8 Takte ist 32 Wiedergabe-Clips c1~0..c1~31 auf jedem Beat; Blenden nur vorn und hinten', () => {
  const p = specProjekt(); Object.assign(p.spuren[0].clips[0], { laenge_beats: 32, loop_beats: 1, fade_ein_beats: 0.25, fade_aus_beats: 0.5, offset_s: 0.01 });
  const cs = wSpur(p, 1).clips;
  assert.equal(cs.length, 32);
  assert.deepEqual(cs.map((c) => c.id), Array.from({ length: 32 }, (_, k) => `c1~${k}`));
  assert.deepEqual(cs.map((c) => c.start_beat), Array.from({ length: 32 }, (_, k) => k), 'Einsatz exakt auf jedem Beat (A5-Grundlage)');
  assert.ok(cs.every((c) => c.laenge_beats === 1 && c.offset_frames === 480 && c.sha256 === SHA_A));
  assert.deepEqual([cs[0].ein_beats, cs[0].aus_beats, cs[1].ein_beats, cs[31].ein_beats, cs[31].aus_beats], [0.25, 0, 0, 0, 0.5]);
  Object.assign(p.spuren[0].clips[0], { laenge_beats: 2.5, fade_ein_beats: 0, fade_aus_beats: 0 });
  assert.deepEqual(wSpur(p, 1).clips.map((c) => [c.id, c.start_beat, c.laenge_beats]), [['c1~0', 0, 1], ['c1~1', 1, 1], ['c1~2', 2, 0.5]], 'Rest');
  delete p.spuren[0].clips[0].loop_beats;
  assert.deepEqual(wSpur(p, 1).clips.map((c) => c.id), ['c1'], 'ohne Loop: der Clip selbst mit seiner ID');
});

test('6.17 Ausrollen MIDI: Noten vor loop_beats je Kopie verschoben (ID <clip>~<k>/<note>), an Loop-Ende und Clip-Ende geschnitten; Noten ab loop still', () => {
  const p = specProjekt(); const c = p.spuren[1].clips[0];
  Object.assign(c, { start_beat: 8, laenge_beats: 5, loop_beats: 2, noten: [{ id: 'n1', beat: 0, laenge: 0.5, ton: 36, vel: 100 },
    { id: 'n2', beat: 1.5, laenge: 1, ton: 38, vel: 90 }, { id: 'n3', beat: 3, laenge: 0.5, ton: 40, vel: 80 }] });
  assert.deepEqual(wSpur(p, 2).noten, [
    { id: 'c2~0/n1', beat: 8, laenge: 0.5, ton: 36, vel: 100 }, { id: 'c2~0/n2', beat: 9.5, laenge: 0.5, ton: 38, vel: 90 },
    { id: 'c2~1/n1', beat: 10, laenge: 0.5, ton: 36, vel: 100 }, { id: 'c2~1/n2', beat: 11.5, laenge: 0.5, ton: 38, vel: 90 },
    { id: 'c2~2/n1', beat: 12, laenge: 0.5, ton: 36, vel: 100 }]);
});

test('6.17 Grenzen nach dem Ausrollen: 4097 Kopien eines Clips lehnt der Befehl mit zu_gross ab (vor dem Speichern), 4096 gehen; Noten ebenso', () => {
  const p = specProjekt(); p.spuren[0].clips[0].laenge_beats = 4096 / 16; p.spuren[2].clips = [];
  p.spuren[1].clips[0].noten = [{ id: 'n1', beat: 0, laenge: 0.0625, ton: 36, vel: 100 }];
  const ok = fuehreAus(p, { befehl: 'clip_aendern', clip_id: 'c1', loop_beats: 1 / 16 });
  assert.equal(zaehleAusgerollt(ok.projekt).clips, 4096);
  assert.throws(() => fuehreAus(ok.projekt, { befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 4097 / 16 }), (e) => e.grund === 'zu_gross');
  const n = kopie(p); n.spuren[1].clips[0].laenge_beats = 65537 / 16;
  assert.throws(() => fuehreListeAus(n, [{ befehl: 'clip_aendern', clip_id: 'c2', loop_beats: 1 / 16 }]), (e) => e.grund === 'zu_gross' && /65537 notes/.test(e.message));
  assert.equal(uebersetze(fuehreAus(n, { befehl: 'clip_aendern', clip_id: 'c2', laenge_beats: 4 }).projekt, opt).spuren[1].noten.length, 1, 'Negativ-Kontrolle: ohne Loop geht es');
});
