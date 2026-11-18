// Return fader lane, T2 (pins, model layer): every lane command works on the fader lane of a return like on the fader lane of a track: one undo step each,
// the same value range, the same refusals. (The page sends exactly these commands, see production_return_fader_zeichnen.test.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt } from '../project/model.ts';
import { wende } from '../project/patch.ts';
import { ohneAbgeleitetes } from './support/project.mjs';

const ok = (p, b) => fuehreAus(p, b);
const grundVon = (p, b) => { try { fuehreAus(p, b); } catch (e) { if (e instanceof BefehlFehler) return { grund: e.grund, detail: e.detail }; throw e; } return null; };
const PUNKTE = [{ beat: 0, wert: -24 }, { beat: 2, wert: -18 }, { beat: 4, wert: -12 }, { beat: 8, wert: -6, form: 's' }, { beat: 16, wert: 0 }];
// track s1 and return r1 each carry a fader lane with exactly PUNKTE; the lane ids are a1 (track) and a2 (return)
function basis() {
  let p = ok(neuesProjekt('T'), { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = ok(p, { befehl: 'return_neu', name: 'Hall' }).projekt;
  p = ok(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader', punkte: PUNKTE }).projekt;
  return ok(p, { befehl: 'auto_neu', strang_id: 'r1', ziel: 'fader', punkte: PUNKTE }).projekt;
}
const BEFEHLE = (id) => [
  { befehl: 'auto_punkte', lane_id: id, setze: [{ beat: 6, wert: -9 }] },
  { befehl: 'auto_dehnen', lane_id: id, von_beat: 0, bis_beat: 8, neu_bis_beat: 16 },
  { befehl: 'auto_neigen', lane_id: id, von_beat: 0, bis_beat: 8, faktor: 0.5 },
  { befehl: 'auto_form', lane_id: id, von_beat: 0, bis_beat: 8, form: 'rampe_auf' },
  { befehl: 'auto_vereinfachen', lane_id: id, von_beat: 0, bis_beat: 16 },
  { befehl: 'auto_aendern', lane_id: id, gesperrt: true },
];

test('return_fader_werkzeuge_ein_undo_schritt: each lane command on a return fader lane is one patch that undoes and redoes, like on a track', () => {
  const p = basis();
  assert.equal(p.returns[0].automation[0].id, 'a2');
  for (const b of BEFEHLE('a2')) {
    const r = ok(p, b);
    assert.equal(pruefeProjekt(JSON.parse(JSON.stringify(r.projekt))).fehler, undefined, `${b.befehl}: the project stays valid`);
    assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p), `${b.befehl}: undo gives the project before`);
    assert.equal(ohneAbgeleitetes(wende(p, r.vor)), ohneAbgeleitetes(r.projekt), `${b.befehl}: redo gives the result`);
    assert.notEqual(ohneAbgeleitetes(r.projekt), ohneAbgeleitetes(p), `${b.befehl}: the command changed something`);
    // the same command on the track lane changes the lane the same way
    const t = ok(p, { ...b, lane_id: 'a1' });
    assert.deepEqual(r.projekt.returns[0].automation[0], { ...t.projekt.spuren[0].automation[0], id: 'a2' }, `${b.befehl}: same result as on the track lane`);
  }
  const d = ok(p, { befehl: 'auto_loeschen', lane_id: 'a2' });
  assert.equal(d.projekt.returns[0].automation?.length ?? 0, 0);
  assert.equal(ohneAbgeleitetes(wende(d.projekt, d.zurueck)), ohneAbgeleitetes(p), 'auto_loeschen: undo brings the lane back');
  assert.equal(ohneAbgeleitetes(wende(p, d.vor)), ohneAbgeleitetes(d.projekt), 'auto_loeschen: redo');
});

test('return_fader_wertebereich: -200..+6 dB as on a track, the same refusal text', () => {
  const p = basis();
  for (const wert of [7, -201]) {
    const r = grundVon(p, { befehl: 'auto_punkte', lane_id: 'a2', setze: [{ beat: 4, wert }] }), t = grundVon(p, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 4, wert }] });
    assert.ok(r && t, `value ${wert} is refused on both`);
    assert.deepEqual(r, t, 'same reason and text');
  }
  const unten = ok(p, { befehl: 'auto_punkte', lane_id: 'a2', setze: [{ beat: 4, wert: -200 }, { beat: 5, wert: 6 }] });
  assert.deepEqual(unten.projekt.returns[0].automation[0].punkte.filter((q) => q.beat === 4 || q.beat === 5).map((q) => q.wert), [-200, 6], 'both ends are valid');
});

test('return_fader_gesperrt_und_unbekannt: a locked lane refuses points (lane_gesperrt, as on a track); the lane of a deleted return is lane_unbekannt', () => {
  const p = basis();
  const g = ok(p, { befehl: 'auto_aendern', lane_id: 'a2', gesperrt: true }).projekt;
  const punkt = { befehl: 'auto_punkte', lane_id: 'a2', setze: [{ beat: 0, wert: -3 }] };
  assert.equal(grundVon(g, punkt)?.grund, 'lane_gesperrt');
  const gt = ok(p, { befehl: 'auto_aendern', lane_id: 'a1', gesperrt: true }).projekt;
  assert.equal(grundVon(gt, { ...punkt, lane_id: 'a1' })?.grund, 'lane_gesperrt', 'same on the track');
  const weg = ok(p, { befehl: 'return_loeschen', return_id: 'r1' }).projekt;
  assert.equal(grundVon(weg, punkt)?.grund, 'lane_unbekannt');
});
