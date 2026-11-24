// Task 1 of the browser-6 plan: rendereProjektDatei renders a project object to a WAV file as a library function (throws, never exits), with a
// per-call env for the render process. The render program is a fake selected through CYPHERDJ_RENDER.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { rendereProjektDatei, RenderDateiFehler } from '../project/render_file.ts';
import { neuesProjekt } from '../project/model.ts';
import { tmpOrdner } from './support/project.mjs';

// A fake cypherdj-render: arg parsing as the real one needs (--aus), writes a WAV (mode from FAKE_MODE), prints the renderer's JSON line.
const FAKE = `#!/usr/bin/env node
import fs from 'node:fs';
const a = process.argv.slice(2);
const wert = (k) => a[a.indexOf(k) + 1];
const modus = process.env.FAKE_MODE || 'sinus';
if (modus === 'rc8') { process.stderr.write('target exists\\n'); process.exit(8); }
if (process.env.FAKE_SEITE) fs.writeFileSync(process.env.FAKE_SEITE, process.env.CYPHERDJ_BK_ORDNER ?? '');
const n = 48000;
if (modus === 'muell') { fs.writeFileSync(wert('--aus'), 'this is not a wav'); }
else {
  const daten = Buffer.alloc(n * 2 * 4);
  if (modus === 'sinus') for (let i = 0; i < n; i++) { const x = 0.5 * Math.sin(2 * Math.PI * 440 * i / 48000); daten.writeFloatLE(x, i * 8); daten.writeFloatLE(x, i * 8 + 4); }
  const k = Buffer.alloc(44);
  k.write('RIFF', 0, 'latin1'); k.writeUInt32LE(36 + daten.length, 4); k.write('WAVEfmt ', 8, 'latin1'); k.writeUInt32LE(16, 16);
  k.writeUInt16LE(3, 20); k.writeUInt16LE(2, 22); k.writeUInt32LE(48000, 24); k.writeUInt32LE(48000 * 8, 28); k.writeUInt16LE(8, 32); k.writeUInt16LE(32, 34);
  k.write('data', 36, 'latin1'); k.writeUInt32LE(daten.length, 40);
  fs.writeFileSync(wert('--aus'), Buffer.concat([k, daten]));
}
process.stdout.write(JSON.stringify({ datei: wert('--aus'), frames: n, spitze_db: modus === 'sinus' ? -6.02 : -200, regler_quelle: 'projekt', abgriff: 'produktion', ueber_decke: false, limiter_db_max: 0 }) + '\\n');
`;

async function mit(t, werte, f) {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
function aufbau(t) {
  const d = tmpOrdner(t, 'djk-render-datei-');
  const prog = path.join(d, 'fake-render.mjs');
  fs.writeFileSync(prog, FAKE, { mode: 0o755 });
  const auftrag = (extra = {}) => ({ projekt: neuesProjekt('t'), ziel: path.join(d, `out-${Math.random().toString(36).slice(2)}.wav`), vonBeat: 0, bisBeat: 2,
    arbeitsOrdner: path.join(d, 'arbeit'), ...extra });
  return { d, prog, auftrag };
}

test('renders to a WAV file and measures it', async (t) => {
  const { prog, auftrag } = aufbau(t);
  const r = await mit(t, { CYPHERDJ_RENDER: prog, FAKE_MODE: 'sinus' }, () => rendereProjektDatei(auftrag()));
  assert.equal(r.frames, 48000);
  assert.ok(r.rms_db < 0 && r.rms_db > -20, `rms ${r.rms_db}`);
  assert.ok(r.spitze_db < 0);
  assert.ok(fs.existsSync(r.datei));
});

test('env travels to the render process only, process.env stays untouched', async (t) => {
  const { d, prog, auftrag } = aufbau(t);
  const seite = path.join(d, 'seite.txt');
  delete process.env.CYPHERDJ_BK_ORDNER;
  await mit(t, { CYPHERDJ_RENDER: prog, FAKE_MODE: 'sinus', FAKE_SEITE: seite }, () => rendereProjektDatei(auftrag({ env: { CYPHERDJ_BK_ORDNER: '/x/graphen' } })));
  assert.equal(fs.readFileSync(seite, 'utf8'), '/x/graphen');
  assert.equal(process.env.CYPHERDJ_BK_ORDNER, undefined);
});

test('failures are thrown as RenderDateiFehler with a reason', async (t) => {
  const { prog, auftrag } = aufbau(t);
  await mit(t, { CYPHERDJ_RENDER: prog, FAKE_MODE: 'rc8' }, async () => {
    await assert.rejects(rendereProjektDatei(auftrag()), (e) => e instanceof RenderDateiFehler && e.grund === 'render_fehlgeschlagen');
  });
  await mit(t, { CYPHERDJ_RENDER: '/nonexistent/cypherdj-render', FAKE_MODE: 'sinus' }, async () => {
    await assert.rejects(rendereProjektDatei(auftrag()), (e) => e instanceof RenderDateiFehler && e.grund === 'render_fehlt');
  });
  await mit(t, { CYPHERDJ_RENDER: prog, FAKE_MODE: 'sinus' }, async () => {
    await assert.rejects(rendereProjektDatei(auftrag({ projekt: {} })), (e) => e instanceof RenderDateiFehler && e.grund === 'projekt_ungueltig');
  });
});

test('a silent WAV measures -200, a garbage file throws and does not exit the process', async (t) => {
  const { prog, auftrag } = aufbau(t);
  await mit(t, { CYPHERDJ_RENDER: prog, FAKE_MODE: 'still' }, async () => {
    const r = await rendereProjektDatei(auftrag());
    assert.equal(r.rms_db, -200);
  });
  await mit(t, { CYPHERDJ_RENDER: prog, FAKE_MODE: 'muell' }, async () => {
    await assert.rejects(rendereProjektDatei(auftrag()), (e) => e instanceof RenderDateiFehler && e.grund === 'render_fehlgeschlagen');
  });
});
