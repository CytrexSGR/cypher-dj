// Paket 1.13 Slice 6, T9-Nachbesserung: die ECHTE Hand (stdio) gegen den ECHTEN Seiten-Server (Stapel, Instanz c, Prüftrenner statt demucs, CPU).
// 1. Start → fertig (vier Spuren). 2. Start → Projektwechsel mitten im Lauf → unbekannt (der Server meldet abgebrochen, sieht es aber nicht mehr im Feld).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const HAND = path.resolve(HIER, '..', 'hand.ts');
const OB = path.resolve(HIER, '..', '..', 'oberflaeche', 'tests', 'hilfen');
process.env.CYPHERDJ_TEST_INSTANZ ??= 'c';
const { stapel } = await import(path.join(OB, 'mediathek.mjs'));
const { baueKatalog } = await import(path.join(OB, 'katalog.mjs'));
const { wav } = await import(path.join(OB, 'proj_kontext.mjs'));
const { ruf, warte, CYPHER } = await import(path.join(OB, 'proj_stapel.mjs'));
const SHA = 'e'.repeat(64);

// vonAndreas: die Spur entsteht ohne x-djk-quelle (= andreas, transport.ts:36-38); sonst legt Cypher sie an (Riegel nur_andreas_spur, D15)
async function aufbau(t, trenner, { vonAndreas = false } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-hand-stems-')); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const katalog = baueKatalog(path.join(d, 'kat'), [{ n: 1, typ: 'oneshot', pfad: wav(path.join(d, 'daten'), 'ton.wav', 2.0), dauer_s: 2.0, sha: SHA }]);
  const { url } = await stapel(t, { katalog, stems: { zusatzArgs: ['--trenner', trenner] } });
  await ruf(url, 'POST', '/proj/neu', { name: 'Stems' });
  const r = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Aufbau', befehle: [{ befehl: 'tempo_setzen', bpm: 120 },
    { befehl: 'spur_neu', art: 'audio', name: 'Ton' }, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 4, sha256: SHA }] },
    vonAndreas ? {} : CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  for (let i = 0; i < 500; i++) { if ((await ruf(url, 'GET', '/proj/aktuell')).j.projekt.spuren[0].clips[0].dekodiert === 'fertig') break; await warte(20); }
  for (let i = 0; i < 100; i++) { const x = await ruf(url, 'POST', '/proj/stems', { clip_id: 'nix' }); if (x.j.fehler !== 'kein_kernstand') break; await warte(20); }
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', url],
    env: { ...process.env, DJK_HAND_FRIST_PROJ_STEMS_MS: '60000', DJK_HAND_STEMS_FEHLT_MS: '300', CUDA_VISIBLE_DEVICES: '' } }));
  t.after(() => c.close());
  return { url, c };
}
const stems = async (c, args) => { const t0 = Date.now(); const r = await c.callTool({ name: 'proj_stems', arguments: args }); return { ms: Date.now() - t0, r, j: JSON.parse(r.content[0].text) }; };

test('T9 echt: proj_stems → fertig mit vier Spuren', async (t) => {
  const { c } = await aufbau(t, 'identitaet');
  const x = await stems(c, { clip_id: 'c1' });
  assert.ok(!x.r.isError, JSON.stringify(x.j));
  assert.deepEqual([x.j.zustand, typeof x.j.auftrag_id, x.j.spuren?.length], ['fertig', 'number', 4]);
});

test('T9 echt: Projektwechsel mitten im Lauf → unbekannt vor der Frist; geraet gpu → stems_gpu_aus', async (t) => {
  const { c, url } = await aufbau(t, 'langsam');
  const gpu = await c.callTool({ name: 'proj_stems', arguments: { clip_id: 'c1', geraet: 'gpu' } });
  assert.equal(gpu.isError, true); assert.equal(JSON.parse(gpu.content[0].text).fehler, 'stems_gpu_aus');
  const p = stems(c, { clip_id: 'c1' });
  await warte(1200);
  assert.equal((await ruf(url, 'POST', '/proj/neu', { name: 'Anderes' })).code, 200);
  const x = await p;
  assert.deepEqual([x.j.zustand, typeof x.j.auftrag_id], ['unbekannt', 'number']);
  assert.match(x.j.text, /check proj_lage/);
  assert.ok(x.ms < 30000, `wartete ${x.ms} ms (Frist 60 s)`);
});

test('T9 echt: Gegenfall, eine Spur von Andreas über die echte Hand → nur_andreas_spur (Riegel D15), nichts wird zerlegt', async (t) => {
  const { c, url } = await aufbau(t, 'identitaet', { vonAndreas: true });
  const x = await c.callTool({ name: 'proj_stems', arguments: { clip_id: 'c1' } });
  assert.equal(x.isError, true, x.content[0].text);
  assert.equal(JSON.parse(x.content[0].text).fehler, 'nur_andreas_spur');
  assert.equal((await ruf(url, 'GET', '/proj/aktuell')).j.projekt.spuren.length, 1, 'nichts zerlegt');
});
