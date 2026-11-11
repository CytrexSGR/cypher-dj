// Plan 1.11 task 13: the export path choice. A project with an active host stage exports in real time through the core (/k/arr/export_lauf), a project
// without one renders offline as before. Real S2 integration (tests/support/output_setup.mjs), a stand-in for /k/arr/export_lauf, no host process.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aufbau } from './support/output_setup.mjs';
import { warteBis } from './support/proj_context.mjs';
import { alsAntwort, brauchtEchtzeit } from '../areas/proj/output.ts';

const ruf = async (f) => { try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); } };
const sauber = { lauf: null, wartend: 0, abbruch: 0 };
const PLUGIN = { format: 'vst3', pfad: '/x/Fake.vst3', uid: 'ABCDEF0123456789ABCDEF0123456789' };
const KEIN_HOST = { abhaengig: { insert: async () => ({ code: 1, aus: '', fehler: 'test: no host' }), sock: async () => { throw new Error('test: no socket'); } } };
const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const renderAufrufe = (a) => {
  const d = path.join(a.tmp, 'render.jsonl');
  return fs.existsSync(d) ? fs.readFileSync(d, 'utf8').trim().split('\n').map((z) => JSON.parse(z)) : [];
};

// a project with a host stage on `strang` (an: true unless `bypass`), the manager says `status`, healthy since `seit` ms
async function mitHost(t, { strang = 's2', bypass = false, status = 'bereit', seitMs = 5000, kern = {} } = {}) {
  const a = await aufbau(t, { tempo: 120, host: KEIN_HOST });
  await a.vorbei([{ befehl: 'insert_setzen', strang_id: strang, pos: 0, art: 'host', plugin: PLUGIN }]);
  const id = a.projekt().spuren.find((s) => s.id === strang).inserts[0].id;
  if (bypass) await a.vorbei([{ befehl: 'insert_an', insert_id: id, an: false }]);
  const t0 = Date.now() - seitMs;
  a.zugang.hostLage = () => [{ insert_id: id, h: 1, status }];
  a.zugang.hostGesundAlterMs = () => Date.now() - t0;
  a.exportAnfragen = [];
  a.geladen = [];
  const sende = a.ctx.sende;
  a.ctx.sende = (adresse, felder) => {
    if (adresse === '/k/arr/laden') a.geladen.push({ nr: felder.nr, wiedergabe: JSON.parse(fs.readFileSync(path.join(a.arbeitsordner, `wiedergabe-${felder.nr}.json`), 'utf8')) });
    if (adresse !== '/k/arr/export_lauf') return sende(adresse, felder);
    const nr = ++a.zustand.id;
    a.protokoll.gesendet.push({ id: nr, adresse, felder: { ...felder } });
    a.exportAnfragen.push({ ...felder, ms: Date.now() });
    a.zustand.quittungen.set(nr, { status: 1, grund: '' });
    setTimeout(() => {
      const n = kern.frames ?? Math.round((felder.bis_beat - felder.von_beat) * 60 / 120 * 48000);
      const inhalt = Buffer.alloc(n * 8);
      inhalt.writeFloatLE(0.25, 0);
      fs.writeFileSync(felder.pfad, inhalt, { flag: 'wx' });
      a.vomKern('/e/export_lauf', { frames: BigInt(n), spitze: 0.25, luecken: kern.luecken ?? 0, ungesund: kern.ungesund ?? 0, grund: kern.grund ?? '' });
      a.arrMeldung();
    }, 20);
    return nr;
  };
  return { a, id };
}
const exportDatei = (a) => { const d = path.join(a.offen().ordner, 'export'); return fs.existsSync(d) ? fs.readdirSync(d) : []; };
const f32Reste = (a) => (fs.existsSync(a.arbeitsordner) ? fs.readdirSync(a.arbeitsordner).filter((x) => x.endsWith('.f32')) : []);
const ladeNrn = (a) => a.protokoll.gesendet.filter((g) => g.adresse === '/k/arr/laden').map((g) => g.felder.nr);
const liveWiederhergestellt = (a) => {
  const l = ladeNrn(a);
  return l.length >= 2 && l.at(-1) !== l.at(-2) && a.projekt().wiedergabe_rev === l.at(-1);
};

test('brauchtEchtzeit: true only for an active host stage', async (t) => {
  const { a } = await mitHost(t);
  assert.equal(brauchtEchtzeit(a.projekt()), true);
  const b = await mitHost(t, { bypass: true });
  assert.equal(brauchtEchtzeit(b.a.projekt()), false, 'bypassed (an false)');
  const c = await aufbau(t, { tempo: 120 });
  assert.equal(brauchtEchtzeit(c.projekt()), false, 'no host stage');
});

test('export with an active host stage: export_lauf, never the render, host track live, live view restored, WAV in export/', async (t) => {
  const { a } = await mitHost(t);
  const r = await mitUmgebung({ RENDER_ATTRAPPE_PROTOKOLL: path.join(a.tmp, 'render.jsonl') }, () => ruf(() => a.ausgabe.exportiere({})));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(a.exportAnfragen.length, 1);
  const q = a.exportAnfragen[0];
  assert.deepEqual([q.von_beat, q.bis_beat], [0, 16]);
  assert.ok(q.pfad.endsWith('.f32') && Buffer.byteLength(q.pfad) <= 47, `an OSC string holds 47 bytes at most: ${q.pfad} (${Buffer.byteLength(q.pfad)})`);
  assert.ok(!fs.existsSync(path.dirname(q.pfad)), 'the short capture folder is gone again');
  assert.deepEqual(renderAufrufe(a), [], 'the offline render never runs');
  assert.equal(r.body.echtzeit, true);
  assert.equal(r.body.dauer_s, 8, '16 beats at 120 BPM');
  assert.equal(r.body.frames, 16 * 0.5 * 48000);
  assert.equal(r.body.abgriff, 'produktion');
  assert.ok(fs.statSync(r.body.datei).size > 58);
  assert.deepEqual(exportDatei(a), [path.basename(r.body.datei)]);
  assert.deepEqual(f32Reste(a), [], 'the raw capture is removed');
  assert.deepEqual(a.freezes(), [], 'host tracks (Surge) are not frozen on this path');
  assert.equal(a.geladen[0].wiedergabe.spuren.length, 3, 'the export view keeps the unfrozen Surge track (offline view would drop it)');
  assert.ok(liveWiederhergestellt(a), JSON.stringify(ladeNrn(a)));
  assert.ok(!fs.existsSync(path.join(a.arbeitsordner, `wiedergabe-${a.geladen[0].nr}.json`)), 'the export playback is removed');
  assert.deepEqual(a.ausgabe.zustand(), sauber);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
});

test('real-time export waits until every host has been healthy for 1.1 s', async (t) => {
  const { a } = await mitHost(t, { seitMs: 100 });
  const t0 = Date.now() - 100;
  const r = await ruf(() => a.ausgabe.exportiere({}));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.ok(a.exportAnfragen[0].ms - t0 >= 1100, `started ${a.exportAnfragen[0].ms - t0} ms after the health rise`);
});

test('a dead host before the run: host_fehlt with the strip, no file, nothing loaded, no export_lauf', async (t) => {
  const { a } = await mitHost(t, { status: 'ausfall' });
  const vorher = ladeNrn(a).length;
  const r = await ruf(() => a.ausgabe.exportiere({}));
  assert.equal(r.code, 409);
  assert.equal(r.body.fehler, 'host_fehlt');
  assert.match(r.body.text, /s2/, 'names the strip');
  assert.deepEqual(exportDatei(a), []);
  assert.deepEqual(a.exportAnfragen, []);
  assert.equal(ladeNrn(a).length, vorher, 'the live view was never replaced');
  assert.deepEqual(f32Reste(a), []);
  assert.deepEqual(a.ausgabe.zustand(), sauber);
});

test('the host dies during the run (ungesund 12): export_host_ausfall, no file, live view restored', async (t) => {
  const { a } = await mitHost(t, { kern: { ungesund: 12 } });
  const r = await ruf(() => a.ausgabe.exportiere({}));
  assert.equal(r.body.fehler, 'export_host_ausfall', JSON.stringify(r));
  assert.deepEqual(exportDatei(a), []);
  assert.deepEqual(f32Reste(a), []);
  assert.ok(liveWiederhergestellt(a), JSON.stringify(ladeNrn(a)));
  assert.deepEqual(a.ausgabe.zustand(), sauber);
});

test('a gap in the capture (luecken 1): export_luecke, no file, live view restored', async (t) => {
  const { a } = await mitHost(t, { kern: { luecken: 1 } });
  const r = await ruf(() => a.ausgabe.exportiere({}));
  assert.equal(r.body.fehler, 'export_luecke', JSON.stringify(r));
  assert.deepEqual(exportDatei(a), []);
  assert.deepEqual(f32Reste(a), []);
  assert.ok(liveWiederhergestellt(a), JSON.stringify(ladeNrn(a)));
  assert.deepEqual(a.ausgabe.zustand(), sauber);
});

test('the core refuses (belegt): refusal, live view restored, no file', async (t) => {
  const { a } = await mitHost(t);
  const sende = a.ctx.sende;
  a.ctx.sende = (adresse, felder) => {
    if (adresse !== '/k/arr/export_lauf') return sende(adresse, felder);
    const id = ++a.zustand.id;
    a.zustand.quittungen.set(id, { status: 6, grund: 'belegt' });
    return id;
  };
  const r = await ruf(() => a.ausgabe.exportiere({}));
  assert.equal(r.body.fehler, 'beschaeftigt', JSON.stringify(r));
  assert.deepEqual(exportDatei(a), []);
  assert.ok(liveWiederhergestellt(a), JSON.stringify(ladeNrn(a)));
  assert.deepEqual(a.ausgabe.zustand(), sauber);
});

test('export while the transport plays is refused as the freeze refuses it', async (t) => {
  const { a } = await mitHost(t);
  a.zustand.kernStatus = 2; a.arrMeldung();
  const e = await ruf(() => a.ausgabe.exportiere({}));
  const f = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.deepEqual([e.code, e.body.fehler], [f.code, f.body.fehler]);
  assert.equal(e.body.fehler, 'transport_laeuft');
  assert.deepEqual(a.exportAnfragen, []);
  assert.ok(await warteBis(() => true));
});

test('bounce of a track with an active host stage: host_insert_echtzeit (use resample)', async (t) => {
  const { a } = await mitHost(t, { strang: 's1' });
  const r = await ruf(() => a.ausgabe.bounce({ art: 'an_ort', spur_id: 's1' }));
  assert.equal(r.body.fehler, 'host_insert_echtzeit', JSON.stringify(r));
  assert.match(r.body.text, /resample/);
  const n = await ruf(() => a.ausgabe.bounce({ art: 'neue_spur', spur_ids: ['s1'] }));
  assert.equal(n.body.fehler, 'host_insert_echtzeit');
  assert.deepEqual(a.ausgabe.zustand(), sauber);
});

test('without a host stage: the offline render, request as before, no export_lauf', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const r = await mitUmgebung({ RENDER_ATTRAPPE_PROTOKOLL: path.join(a.tmp, 'render.jsonl') }, () => ruf(() => a.ausgabe.exportiere({})));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.echtzeit, undefined);
  assert.ok(!a.protokoll.gesendet.some((g) => g.adresse === '/k/arr/export_lauf'));
  const [aufruf] = renderAufrufe(a);
  assert.deepEqual(aufruf.argv.slice(aufruf.argv.indexOf('--von-beat'), aufruf.argv.indexOf('--bpm') + 2), ['--von-beat', '0', '--bis-beat', '16', '--bpm', '120']);
  assert.ok(aufruf.argv.includes('--abgriff') && aufruf.argv.includes('--spur-regler'));
  assert.deepEqual(Object.keys(r.body).sort(), ['abgriff', 'datei', 'frames', 'limiter_db_max', 'lra', 'lufs_i', 'regler_quelle', 'spitze_db', 'true_peak_dbtp', 'ueber_decke']);
});

test('negative control: a bypassed host stage (an false) exports offline', async (t) => {
  const { a } = await mitHost(t, { bypass: true });
  const r = await mitUmgebung({ RENDER_ATTRAPPE_PROTOKOLL: path.join(a.tmp, 'render.jsonl') }, () => ruf(() => a.ausgabe.exportiere({})));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.echtzeit, undefined);
  assert.equal(renderAufrufe(a).length, 1, 'the render ran');
  assert.deepEqual(a.exportAnfragen, []);
});

test('page: the export hint, the run text and the progress of a real-time export', async () => {
  const { echtzeitHinweis, echtzeitFortschritt, laufText } = await import('../public/production/output.js');
  const p = { tempo_bpm: 120, loop: { an: true, von_beat: 0, bis_beat: 16 }, spuren: [{ clips: [], inserts: [{ art: 'host', an: true }] }] };
  assert.equal(echtzeitHinweis(p), 'Real-time export (foreign plugins): about 00:08');
  assert.equal(echtzeitHinweis({ ...p, spuren: [{ clips: [], inserts: [{ art: 'host', an: false }, { art: 'komp', an: true }] }] }), '', 'bypassed or native: no hint');
  const lauf = { art: 'export', echtzeit: true, start_ms: Date.now() - 4000, dauer_s: 8 };
  assert.ok(Math.abs(echtzeitFortschritt(lauf) - 0.5) < 0.05);
  assert.equal(echtzeitFortschritt({ art: 'export' }), null);
  assert.match(laufText(lauf, null, 0), /^Real-time export \(foreign plugins\): 00:0[345] of 00:08$/);
});

test('the new reasons have an English text in every reason table', async () => {
  const { GRUND_TEXT } = await import('../http/reasons.ts');
  const { BEREICH_GRUENDE } = await import('../areas/proj/mapping.ts');
  const { FEHLER_TEXT } = await import('../public/production/production.js');
  for (const g of ['export_host_ausfall', 'export_luecke']) {
    assert.ok(typeof GRUND_TEXT[g] === 'string' && typeof FEHLER_TEXT[g] === 'string' && BEREICH_GRUENDE.includes(g), g);
    assert.equal(alsAntwort({ grund: g }).code, 502, g);
  }
});
