// The page side of geraet.patch: the head label, the SURGE PATCH menu entry (Surge tracks only) and the command of a pick (the whole device, one undo step).
import test from 'node:test';
import assert from 'node:assert/strict';
import { geraetText } from '../public/production/track_heads.js';
import { KOPF_MENUE, kopfMenuePunkte } from '../public/production/context_menu.js';
import { patchBefehl, patchLabel } from '../public/production/surge_patch_choice.js';

const spur = (geraet) => ({ id: 's3', nr: 3, name: 'Pad', art: 'instrument', geraet, clips: [] });
const surge = (extra = {}) => ({ art: 'wirt', name: 'surge', slot: 2, parameter: { a_filter1_cutoff: 3 }, ...extra });

test('head label names the stored patch; a track without patch reads as before', () => {
  assert.equal(geraetText(spur(surge({ patch: 'Pads/Warm Pad' }))), 'SURGE · 2 · Pads/Warm Pad');
  assert.equal(geraetText(spur(surge())), 'SURGE · 2');
});

test('the SURGE PATCH entry shows for Surge tracks only', () => {
  const ctx = { st: { projekt: { spuren: [] } } };
  const texte = (s) => kopfMenuePunkte(ctx, s).map((p) => p.text);
  assert.ok(texte(spur(surge())).includes('SURGE PATCH'));
  assert.ok(!texte(spur({ art: 'intern', name: 'rb338', parameter: {} })).includes('SURGE PATCH'));
  assert.ok(!texte({ id: 'a1', art: 'audio' }).includes('SURGE PATCH'));
  assert.equal(KOPF_MENUE.filter((m) => m.text === 'SURGE PATCH').length, 1);
});

test('a pick is spur_aendern with the whole device incl. the map and the patch; CLEAR drops only the patch', () => {
  const s = spur(surge({ patch: 'Init' }));
  assert.deepEqual(patchBefehl(s, 'Leads/Acid'), { befehl: 'spur_aendern', spur_id: 's3', geraet: surge({ patch: 'Leads/Acid' }) });
  assert.deepEqual(patchBefehl(s, ''), { befehl: 'spur_aendern', spur_id: 's3', geraet: surge() });
  assert.equal(patchLabel(s, 'Leads/Acid'), 'Surge patch Leads/Acid s3');
  assert.match(patchLabel(s, ''), /^Clear Surge patch/);
});
