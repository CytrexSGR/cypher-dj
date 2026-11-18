// Return fader lane, T4: a write to the fader of a return that has a fader lane is kept (it is the rest value) but answered with the hint `lane_treibt`, like
// a chain parameter with a lane; a track fader lane has the hand override instead and gives no hint. The page shows the hint through meldeNachSchreiben.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { meldeNachSchreiben } from '../public/production/production.js';

const ok = (p, b) => fuehreAus(p, b);
// track s1 (with its own fader lane a1 after `spurLane`), return r1 at -6 dB; the return fader lane is a1, or a2 when the track has a lane too
function basis({ returnLane = true, spurLane = false } = {}) {
  let p = ok(neuesProjekt('T'), { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = ok(p, { befehl: 'return_neu', name: 'Hall' }).projekt;
  p = ok(p, { befehl: 'return_aendern', return_id: 'r1', fader_db: -6 }).projekt;
  if (spurLane) p = ok(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' }).projekt;
  if (returnLane) p = ok(p, { befehl: 'auto_neu', strang_id: 'r1', ziel: 'fader' }).projekt;
  return p;
}
const faderBefehl = (db) => ({ befehl: 'return_aendern', return_id: 'r1', fader_db: db });

test('hinweis_return_fader_lane: the write is kept and answered with lane_treibt for the lane of the return', () => {
  const p = basis();
  const r = ok(p, faderBefehl(-3));
  assert.equal(r.projekt.returns[0].fader_db, -3, 'the value is stored as the rest value');
  assert.equal(r.hinweise?.length, 1);
  assert.deepEqual({ ...r.hinweise[0], text: undefined }, { index: 0, hinweis: 'lane_treibt', lane_id: 'a1', ziel: 'fader', strang_id: 'r1', text: undefined });
  assert.match(r.hinweise[0].text, /driven by lane a1 \(fader\)/);
  assert.equal(typeof r.hinweise[0].text, 'string');
});

test('kein_hinweis: same value, other fields, no lane, track fader, and the command that creates the lane', () => {
  const p = basis();
  assert.equal(ok(p, faderBefehl(-6)).hinweise, undefined, 'same value: nothing changed');
  assert.equal(ok(p, { befehl: 'return_aendern', return_id: 'r1', pan: 0.5 }).hinweise, undefined, 'another field');
  assert.equal(ok(basis({ returnLane: false }), faderBefehl(-3)).hinweise, undefined, 'a return without the lane');
  const t = basis({ returnLane: false, spurLane: true });
  assert.equal(ok(t, { befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }).hinweise, undefined, 'the track fader has the override, no hint');
  const mit = basis({ returnLane: true, spurLane: true });
  assert.equal(mit.returns[0].automation[0].id, 'a2');
  assert.equal(ok(mit, { befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }).hinweise, undefined, 'a return lane does not make the track write a hint');
  assert.equal(ok(basis({ returnLane: false }), { befehl: 'auto_neu', strang_id: 'r1', ziel: 'fader' }).hinweise, undefined, 'creating the lane');
});

test('hinweis_liste: two writes in one list give a hint each, with the index of the command', () => {
  const r = fuehreListeAus(basis(), [faderBefehl(-3), faderBefehl(-4)], { quelle: 'andreas' });
  assert.deepEqual(r.hinweise.map((h) => [h.index, h.lane_id, h.strang_id]), [[0, 'a1', 'r1'], [1, 'a1', 'r1']]);
  assert.equal(r.projekt.returns[0].fader_db, -4);
});

test('hinweis_im_toast: the page says it (meldeNachSchreiben) and it is no error', () => {
  const r = ok(basis(), faderBefehl(-3));
  const gemeldet = [];
  meldeNachSchreiben({ hinweise: r.hinweise }, (text, fehler) => gemeldet.push([text, fehler]));
  assert.equal(gemeldet.length, 1);
  assert.ok(gemeldet[0][0].startsWith('Parameter is driven by lane a1 (fader)'), gemeldet[0][0]);
  assert.equal(gemeldet[0][1], false);
});
