// Audit U10: warp_tempo :2 and eins_hier shorten the clip; an unlinked envelope loop longer than the new clip length must be clamped (as clip_aendern
// and clip_teilen do), otherwise the whole command is refused as projekt_ungueltig.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt } from '../project/model.ts';
import { SHA_A } from './support/project.mjs';

const warp = { an: true, modus: 'complex', marker: [[0.5, -2], [1, -1], [1.5, 0], [2, 1], [4, 5]], versatz_beats: 0, quelle: 'werkstatt', transpose_st: 0, detune_ct: 0 };
function aufbau() {
  return fuehreListeAus(neuesProjekt('H'), [{ befehl: 'spur_neu', art: 'audio' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 8, sha256: SHA_A, pfad_hinweis: '/x/t.wav', warp },
    { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: [{ beat: 0, wert: -6 }, { beat: 4, wert: 0 }], verknuepft: false, loop_beats: 8 }]).projekt;
}
const clip = (p) => p.spuren[0].clips[0];

test('fixture: the unlinked envelope loop is 8 beats', () => {
  const c = clip(aufbau());
  assert.equal(c.huellkurven[0].loop_beats, 8);
  assert.equal(c.huellkurven[0].verknuepft, false);
});

test('warp_tempo :2 clamps the loop of an unlinked envelope to the new clip length', () => {
  const r = fuehreAus(aufbau(), { befehl: 'warp_tempo', clip_id: 'c1', faktor: 0.5 });
  assert.equal(clip(r.projekt).laenge_beats, 4);
  assert.equal(clip(r.projekt).huellkurven[0].loop_beats, 4);
  assert.ok(pruefeProjekt(r.projekt).projekt);
});

test('eins_hier that shortens the clip clamps the envelope loop too', () => {
  const r = fuehreAus(aufbau(), { befehl: 'eins_hier', clip_id: 'c1', quell_s: 2 });   // 8 - 1 beat = 7
  assert.equal(clip(r.projekt).laenge_beats, 7);
  assert.equal(clip(r.projekt).huellkurven[0].loop_beats, 7);
});

test('negative control: an envelope loop that still fits stays', () => {
  const p = fuehreListeAus(aufbau(), [{ befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: [{ beat: 0, wert: -6 }, { beat: 2, wert: 0 }], verknuepft: false, loop_beats: 2 }]).projekt;
  const r = fuehreAus(p, { befehl: 'warp_tempo', clip_id: 'c1', faktor: 0.5 });
  assert.equal(clip(r.projekt).huellkurven[0].loop_beats, 2);
});
