// Export option ausklang_beats: the render range is extended at its end only (reverb tail); without it the range is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aufbau } from './support/output_setup.mjs';
import { alsAntwort } from '../areas/proj/output.ts';

async function ruf(f) { try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); } }
const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const protokoll = (a) => path.join(a.tmp, 'render.jsonl');
const aufrufe = (a) => (fs.existsSync(protokoll(a)) ? fs.readFileSync(protokoll(a), 'utf8').trim().split('\n').map((z) => JSON.parse(z)) : []);
const bisVon = (aufruf) => Number(aufruf.argv[aufruf.argv.indexOf('--bis-beat') + 1]);

test('Export: ausklang_beats extends only the end of the render; without it the range stays as before', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await mitUmgebung({ RENDER_ATTRAPPE_PROTOKOLL: protokoll(a) }, async () => {
    assert.equal((await ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8 }))).code, 200);
    const r = await ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, ausklang_beats: 4 }));
    assert.equal(r.code, 200, JSON.stringify(r.body));
  });
  assert.deepEqual(aufrufe(a).map(bisVon), [8, 12]);
});

test('Export: ausklang_beats invalid (negative, not a number, over 64) or a total length over the maximum is refused', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  for (const d of [{ ausklang_beats: -1 }, { ausklang_beats: 'vier' }, { ausklang_beats: 65 }, { ausklang_beats: null }, { bis_beat: 1000, ausklang_beats: 64 }]) {
    const r = await ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, ...d }));
    assert.equal(r.code, 400, JSON.stringify(d) + JSON.stringify(r.body));
  }
});
