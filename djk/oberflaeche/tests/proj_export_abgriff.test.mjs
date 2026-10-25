// 1.10 Slice 2 (E2): POST /proj/export {abgriff}, Antwortfelder abgriff/ueber_decke/limiter_db_max, Lautheit am PM, Prüfung der Render-Antwort.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aufbau } from './hilfen/ausgabe_aufbau.mjs';
import { alsAntwort } from '../bereiche/proj/ausgabe.ts';
import { leseRenderAntwort, renderArgumente, RenderFehler } from '../projekt/render.ts';

async function ruf(f) { try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); } }
const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const protokoll = (a) => path.join(a.tmp, 'render.jsonl');
const aufrufe = (a) => (fs.existsSync(protokoll(a)) ? fs.readFileSync(protokoll(a), 'utf8').trim().split('\n').map((z) => JSON.parse(z)) : []);
const abgriffVon = (aufruf) => aufruf.argv[aufruf.argv.indexOf('--abgriff') + 1];

test('Export: ohne Angabe gilt abgriff produktion (--abgriff geht mit), die Antwort nennt abgriff, ueber_decke und limiter_db_max', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const r = await mitUmgebung({ RENDER_ATTRAPPE_PROTOKOLL: protokoll(a) }, () => ruf(() => a.ausgabe.exportiere({})));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.abgriff, 'produktion'); assert.equal(r.body.ueber_decke, false); assert.equal(r.body.limiter_db_max, 0);
  assert.deepEqual(aufrufe(a).map(abgriffVon), ['produktion']);
});

test('Export: abgriff set wird durchgereicht; heißes Material meldet ueber_decke nur am Produktions-Abgriff (Doppel mit RENDER_ATTRAPPE_HEISS)', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const p = await mitUmgebung({ RENDER_ATTRAPPE_HEISS: '1' }, () => ruf(() => a.ausgabe.exportiere({ abgriff: 'produktion' })));
  assert.equal(p.code, 200, JSON.stringify(p.body));
  assert.equal(p.body.abgriff, 'produktion'); assert.equal(p.body.ueber_decke, true); assert.ok(p.body.spitze_db > 0); assert.ok(p.body.limiter_db_max > 0);
  const s = await mitUmgebung({ RENDER_ATTRAPPE_HEISS: '1' }, () => ruf(() => a.ausgabe.exportiere({ abgriff: 'set' })));
  assert.equal(s.code, 200, JSON.stringify(s.body));
  assert.equal(s.body.abgriff, 'set'); assert.equal(s.body.ueber_decke, false); assert.ok(s.body.spitze_db < 0);
});

test('Export: ungültiger abgriff und unbekannte Felder werden abgelehnt (Negativ-Kontrolle: die gültigen gehen durch)', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  for (const d of [{ abgriff: 'mitte' }, { abgriff: 1 }, { abgriff: null }]) {
    const r = await ruf(() => a.ausgabe.exportiere(d));
    assert.deepEqual([r.code, r.body.fehler], [400, 'argument_ungueltig'], JSON.stringify(d));
  }
  const r2 = await ruf(() => a.ausgabe.exportiere({ abgriff: 'set', erfunden: 1 }));
  assert.deepEqual([r2.code, r2.body.fehler], [400, 'argument_ungueltig']);
  assert.equal((await ruf(() => a.ausgabe.exportiere({ abgriff: 'set' }))).code, 200);
});

test('Render-Antwort: sagt der Render einen anderen Abgriff als verlangt (älteres Programm), ist es ein render_fehler, nie ein stiller Ring-Export', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const r = await mitUmgebung({ RENDER_ATTRAPPE_ABGRIFF_FALSCH: '1' }, () => ruf(() => a.ausgabe.exportiere({ abgriff: 'produktion' })));
  assert.equal(r.code, 502);   // ausgabe.ts STATUS: render_fehler 502
  assert.equal(r.body.fehler, 'render_fehler');
  assert.match(r.body.text, /tap|abgriff/i);
  const z = `{"datei":"/x.wav","frames":10,"spitze_db":-3,"regler_quelle":"kern","abgriff":"set","ueber_decke":false,"limiter_db_max":0}`;
  assert.throws(() => leseRenderAntwort(z, 'produktion'), (e) => e instanceof RenderFehler);
  assert.equal(leseRenderAntwort(z, 'set').abgriff, 'set');
  assert.equal(leseRenderAntwort(z.replace('"abgriff":"set",', ''), undefined).abgriff, undefined, 'ohne Erwartung keine Prüfung (Altaufrufer in Tests)');
  assert.throws(() => leseRenderAntwort(z.replace('"abgriff":"set",', ''), 'set'), (e) => e instanceof RenderFehler);
  const basis = { nr: 1, von_beat: 0, bis_beat: 4, bpm: 120, aus: '/x', arbeitsordner: '/a', spurRegler: '/r', instanz: 'c', zeitlimitMs: 1 };
  assert.ok(renderArgumente({ ...basis, abgriff: 'set' }).join(' ').endsWith('--abgriff set'));
  const ohne = renderArgumente(basis);   // Negativ-Kontrolle (B5): ohne abgriff weder --abgriff noch ein undefined-Argument (spawn würde ERR_INVALID_ARG_TYPE werfen)
  assert.ok(!ohne.includes('--abgriff') && ohne.every((x) => typeof x === 'string'), JSON.stringify(ohne));
});

test('Lautheit: alle Renders (je Spur und Summe) laufen am Produktions-Abgriff, damit die Summe dem Standard-Export gleicht (AK24)', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const r = await mitUmgebung({ RENDER_ATTRAPPE_PROTOKOLL: protokoll(a), RENDER_ATTRAPPE_MISCHUNG: '1' }, () => ruf(() => a.ausgabe.lautheit({})));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const ab = aufrufe(a).map(abgriffVon);
  assert.ok(ab.length >= 2 && ab.every((x) => x === 'produktion'), JSON.stringify(ab));
});
