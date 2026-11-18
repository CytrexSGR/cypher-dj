// POST /proj/lautheit with an active host stage must be refused up front (host_insert_echtzeit, 409) like export_spuren and analyse,
// before any freeze or render. The offline render (cypherdj-render) refuses such a playback, so lautheit can never succeed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aufbau } from './support/output_setup.mjs';
import { alsAntwort } from '../areas/proj/output.ts';

const ruf = async (f) => { try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); } };
const PLUGIN = { format: 'vst3', pfad: '/x/Fake.vst3', uid: 'ABCDEF0123456789ABCDEF0123456789' };
const KEIN_HOST = { abhaengig: { insert: async () => ({ code: 1, aus: '', fehler: 'test: no host' }), sock: async () => { throw new Error('test: no socket'); } } };
const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const protokollDatei = (a) => path.join(a.tmp, 'render.jsonl');
const renderAufrufe = (a) => (fs.existsSync(protokollDatei(a)) ? fs.readFileSync(protokollDatei(a), 'utf8').trim().split('\n') : []);

test('loudness with an active plugin stage is refused before any freeze or render', async (t) => {
  const a = await aufbau(t, { tempo: 120, host: KEIN_HOST });
  await a.vorbei([{ befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'host', plugin: PLUGIN }]);
  const r = await mitUmgebung({ RENDER_ATTRAPPE_MISCHUNG: '1', RENDER_ATTRAPPE_PROTOKOLL: protokollDatei(a) }, () => ruf(() => a.ausgabe.lautheit({})));
  const freezes = a.freezes().length, renders = renderAufrufe(a).length;
  assert.deepEqual([r.code, r.body?.fehler, freezes, renders], [409, 'host_insert_echtzeit', 0, 0], JSON.stringify(r.body));
});
