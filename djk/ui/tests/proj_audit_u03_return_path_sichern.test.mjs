// Audit U03: a hand fader move that arrives while the plugin states are saved (hostZustandSichern, up to 3 s) during a project switch
// must land in the closing project, like the one that arrives during the stop (proj_fix2_f8_return_path.test.mjs, R5).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Projekte } from '../project/storage.ts';
import { sitzung } from './support/proj_context.mjs';

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
const hand = (s, pfad, wert) => s.ereignis('/e/regler', { pfad, wert, halter: 'mensch', sample: 0n, beat: 0 });

test('U03 hand value during hostZustandSichern of the project switch lands in the old project', async (t) => {
  const { s, d, wurzel } = sitzung(t, { arrFristMs: 30 });
  await s.neu('Eins', 'andreas');
  await s.aendern({ rev: 0, label: 'A', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  new Projekte(wurzel).lege('Zwei');
  let laeuft = null;
  s.hostZustandSichern = async () => {                              // the plugin states are written: the hand keeps moving meanwhile
    hand(s, 'spur/1/fader', -12);
    await new Promise((ok) => { laeuft = ok; });
  };
  const p = s.oeffnen('zwei', 'andreas');
  for (let i = 0; i < 200 && !laeuft; i++) await schlaf(5);
  assert.ok(laeuft, 'the save is under way');
  await schlaf(300);                                                // longer than RUECKWEG_MS: the timer job is queued behind the open job
  laeuft();
  assert.equal((await p).code, 200);
  await schlaf(400);
  const eins = JSON.parse(fs.readFileSync(path.join(wurzel, 'eins', 'project.json'), 'utf8'));
  assert.equal(eins.spuren[0].fader_db, -12, 'hand value is in the old project');
  assert.equal(s.aktuell().j.slug, 'zwei');
  assert.equal(s.aktuell().j.projekt.spuren.length, 0, 'nothing in the new project');
});
