// 1.8 S0 T5, session level: aufnahme_setzen and the new spur_aendern fields reach the project through the real server without reloading the core playback.
// Needs the shared test instance (stapel): run under the d lock (plan section 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AUFNAHME_VORGABE } from '../project/model.ts';
import { stapel } from './support/media_library.mjs';
import { ruf, anKern } from './support/proj_stack.mjs';

test('AK1 session level: aufnahme_setzen and the new spur_aendern fields send no /k/arr/laden, rev rises, wiedergabe_rev stays', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-rec18-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const { url, log } = await stapel(t, { proj: { arbeitsordner: path.join(d, 'arr') } });
  await ruf(url, 'POST', '/proj/neu', { name: 'S0' });
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Track', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'In' }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const vor = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  const laden0 = anKern(log, '/k/arr/laden').length;
  const b = await ruf(url, 'POST', '/proj/aendern', {
    rev: vor.rev, label: 'Recording settings',
    befehle: [{ befehl: 'aufnahme_setzen', vorzaehler_takte: 2, overdub: true }, { befehl: 'spur_aendern', spur_id: vor.spuren[0].id, eingang: { art: 'extern', paar: 1 }, monitor: 'ein' }],
  });
  assert.equal(b.code, 200, JSON.stringify(b.j));
  const nach = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.equal(nach.rev, vor.rev + 1, 'rev rises by one');
  assert.equal(nach.wiedergabe_rev, vor.wiedergabe_rev, 'the playback revision stays');
  assert.deepEqual(nach.aufnahme, { ...AUFNAHME_VORGABE, vorzaehler_takte: 2, overdub: true });
  assert.deepEqual(nach.spuren[0].aufnahme, { scharf: false, eingang: { art: 'extern', paar: 1, modus: 'stereo' }, monitor: 'ein' });
  assert.equal(anKern(log, '/k/arr/laden').length, laden0, 'no reload of the playback');
  // negative control: a command that does change the playback (a new track) does reload
  const c = await ruf(url, 'POST', '/proj/aendern', { rev: nach.rev, label: 'Track', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'Two' }] });
  assert.equal(c.code, 200, JSON.stringify(c.j));
  const t0 = Date.now();
  while (anKern(log, '/k/arr/laden').length === laden0 && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 50));
  assert.ok(anKern(log, '/k/arr/laden').length > laden0, 'a new track reloads the playback');
});
