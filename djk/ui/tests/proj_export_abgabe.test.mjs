// Export delivery plan, task 2: POST /proj/export with `abgabe` writes delivery files next to the master (offline and real-time path),
// validates before anything renders, keeps the master when a conversion fails and stops a running conversion when the server closes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { aufbau } from './support/output_setup.mjs';
import { warteBis } from './support/proj_context.mjs';
import { alsAntwort } from '../areas/proj/output.ts';
import { messeLautheit } from '../project/loudness.ts';

async function ruf(f) { try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); } }
const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const protokoll = (a) => path.join(a.tmp, 'render.jsonl');
const exportOrdner = (a) => path.join(a.offen().ordner, 'export');
const teile = (a) => (fs.existsSync(exportOrdner(a)) ? fs.readdirSync(exportOrdner(a)).filter((n) => n.includes('.teil')) : []);

test('Export with abgabe: the master as before, one file and one measured entry per delivery', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const r = await ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, abgabe: [{ format: 'wav', bits: 16 }, { format: 'mp3' }] }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.ok(r.body.datei.endsWith('.wav') && fs.existsSync(r.body.datei));
  const stamm = path.basename(r.body.datei, '.wav');
  assert.deepEqual(r.body.abgaben.map((x) => path.basename(x.datei)), [`${stamm}.16bit-44k.wav`, `${stamm}.320kbps-44k.mp3`]);
  assert.deepEqual(r.body.abgaben.map((x) => [x.format, x.rate_hz, x.bits, x.dither, x.kbps]), [['wav', 44100, 16, 'tpdf', undefined], ['mp3', 44100, undefined, undefined, 320]]);
  for (const x of r.body.abgaben) {
    assert.ok(fs.existsSync(x.datei));
    assert.ok('true_peak_dbtp' in x && 'lufs_i' in x);
    const gemessen = await messeLautheit(x.datei);   // measured on the delivery file, never copied from the master
    assert.equal(x.true_peak_dbtp, gemessen.true_peak_dbtp);
    assert.equal(x.lufs_i, gemessen.lufs_i);
  }
  assert.deepEqual(fs.readdirSync(exportOrdner(a)).filter((n) => n.endsWith('.teil')), []);
});

test('Export without abgabe answers without the field abgaben and with today\'s keys', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const r = await ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8 }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), ['abgriff', 'datei', 'frames', 'limiter_db_max', 'lra', 'lufs_i', 'regler_quelle', 'spitze_db', 'true_peak_dbtp', 'ueber_decke']);
  assert.deepEqual(fs.readdirSync(exportOrdner(a)).filter((n) => !n.endsWith('.wav')), [], 'only the master is written');
});

test('Export with a malformed abgabe is refused before the render starts', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const w = { format: 'wav', bits: 16 };
  const faelle = [
    ['not an array', 'abgabe', 'x'], ['an object', 'abgabe', { format: 'wav' }], ['empty', 'abgabe', []],
    ['5 entries', 'abgabe', [w, { format: 'wav', bits: 24 }, { format: 'wav', bits: 32 }, { format: 'flac', bits: 16 }, { format: 'mp3' }]],
    ['unknown format', 'abgabe[0].format', [{ format: 'ogg' }]], ['unknown field', 'abgabe[0].lufs', [{ format: 'wav', lufs: -14 }]],
    ['kbps on wav', 'abgabe[0].kbps', [{ format: 'wav', kbps: 320 }]], ['bits 24 on mp3', 'abgabe[0].bits', [{ format: 'mp3', bits: 24 }]],
    ['dither at 24 bit', 'abgabe[0].dither', [{ format: 'wav', bits: 24, dither: 'tpdf' }]],
    ['mp3 at 96000 Hz', 'abgabe[0].rate_hz', [{ format: 'mp3', rate_hz: 96000 }]],
    ['same file name twice', 'abgabe[1]', [w, { ...w }]],
  ];
  await mitUmgebung({ RENDER_ATTRAPPE_PROTOKOLL: protokoll(a) }, async () => {
    for (const [was, feld, abgabe] of faelle) {
      const r = await ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, abgabe }));
      assert.equal(r.code, 400, `${was}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.fehler, 'argument_ungueltig', was);
      assert.equal(r.body.text, 'abgabe: not a valid list of delivery formats', was);
      assert.ok(String(r.body.detail).includes(feld), `${was}: detail names ${feld}: ${r.body.detail}`);
    }
  });
  assert.equal(fs.existsSync(protokoll(a)), false, 'the render stand-in was never started');
  assert.equal(fs.existsSync(exportOrdner(a)), false, 'nothing was exported');
});

test('Export keeps the master when ffmpeg is missing', async (t) => {
  const a = await aufbau(t, { tempo: 120, opt: { ffmpeg: ['/does/not/exist'] } });
  const r = await ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, abgabe: [{ format: 'flac', bits: 24, rate_hz: 96000 }] }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.ok(fs.existsSync(r.body.datei));
  assert.equal(r.body.abgaben.length, 1);
  assert.equal(r.body.abgaben[0].datei, null);
  assert.equal(typeof r.body.abgaben[0].fehler, 'string');
  assert.deepEqual([r.body.abgaben[0].lufs_i, r.body.abgaben[0].lra, r.body.abgaben[0].true_peak_dbtp], [null, null, null]);
  assert.equal(r.body.abgaben[0].format, 'flac');
  assert.deepEqual(fs.readdirSync(exportOrdner(a)), [path.basename(r.body.datei)], 'no .teil, no delivery file');
});

// ---- real-time path (as tests/output_realtime.test.mjs sets it up) --------------------------------------------------------------
const PLUGIN = { format: 'vst3', pfad: '/x/Fake.vst3', uid: 'ABCDEF0123456789ABCDEF0123456789' };
const KEIN_HOST = { abhaengig: { insert: async () => ({ code: 1, aus: '', fehler: 'test: no host' }), sock: async () => { throw new Error('test: no socket'); } } };
async function mitHost(t) {
  const a = await aufbau(t, { tempo: 120, host: KEIN_HOST });
  await a.vorbei([{ befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'host', plugin: PLUGIN }]);
  const id = a.projekt().spuren.find((s) => s.id === 's2').inserts[0].id;
  const t0 = Date.now() - 5000;
  a.zugang.hostLage = () => [{ insert_id: id, h: 1, status: 'bereit' }];
  a.zugang.hostGesundAlterMs = () => Date.now() - t0;
  const sende = a.ctx.sende;
  a.ctx.sende = (adresse, felder) => {
    if (adresse !== '/k/arr/export_lauf') return sende(adresse, felder);
    const nr = ++a.zustand.id;
    a.protokoll.gesendet.push({ id: nr, adresse, felder: { ...felder } });
    a.zustand.quittungen.set(nr, { status: 1, grund: '' });
    setTimeout(() => {
      const n = Math.round((felder.bis_beat - felder.von_beat) * 60 / 120 * 48000);
      const inhalt = Buffer.alloc(n * 8);
      inhalt.writeFloatLE(0.25, 0);
      fs.writeFileSync(felder.pfad, inhalt, { flag: 'wx' });
      a.vomKern('/e/export_lauf', { frames: BigInt(n), spitze: 0.25, luecken: 0, ungesund: 0, grund: '' });
      a.arrMeldung();
    }, 20);
    return nr;
  };
  return a;
}

test('Real-time export writes the deliveries from the captured master', async (t) => {
  const a = await mitHost(t);
  const r = await ruf(() => a.ausgabe.exportiere({ abgabe: [{ format: 'wav', bits: 24, rate_hz: 48000 }] }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.echtzeit, true);
  assert.equal(r.body.abgaben.length, 1);
  assert.equal(path.basename(r.body.abgaben[0].datei), `${path.basename(r.body.datei, '.wav')}.24bit-48k.wav`);
  assert.ok(fs.existsSync(r.body.abgaben[0].datei));
  assert.equal(typeof r.body.abgaben[0].true_peak_dbtp, 'number');
  assert.deepEqual(a.ausgabe.zustand(), { lauf: null, wartend: 0, abbruch: 0 });
  assert.deepEqual(teile(a), []);
});

test('Real-time export with ordner calls the hook without the tidy part, without ordner with it', async (t) => {
  const a = await mitHost(t);
  const ziel = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'djk-export-ziel-')));
  t.after(() => fs.rmSync(ziel, { recursive: true, force: true }));
  const meldungen = [];
  a.ausgabe.opt.nachExport = (x) => meldungen.push(x);
  a.ausgabe.opt.erlaubt = () => [{ name: 'Test', pfad: ziel }];
  assert.equal((await ruf(() => a.ausgabe.exportiere({ ordner: ziel }))).code, 200);
  assert.equal(meldungen.length, 1);
  assert.equal(meldungen[0].ohneAufraeumen, true);
  assert.equal((await ruf(() => a.ausgabe.exportiere({}))).code, 200);
  assert.equal(meldungen[1].ohneAufraeumen, undefined);
});

test('Real-time export with ordner: master and deliveries are written into the chosen folder, nothing in the project', async (t) => {
  const a = await mitHost(t);
  const ziel = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'djk-export-ziel-')));
  t.after(() => fs.rmSync(ziel, { recursive: true, force: true }));
  a.ausgabe.opt.erlaubt = () => [{ name: 'Test', pfad: ziel }];
  const r = await ruf(() => a.ausgabe.exportiere({ ordner: ziel, abgabe: [{ format: 'wav', bits: 16 }] }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.echtzeit, true);
  assert.equal(path.dirname(r.body.datei), ziel);
  assert.equal(path.dirname(r.body.abgaben[0].datei), ziel);
  assert.deepEqual(fs.readdirSync(ziel).sort(), [path.basename(r.body.datei), path.basename(r.body.abgaben[0].datei)].sort());
  assert.equal(fs.existsSync(exportOrdner(a)), false, 'the project export folder was not even created');
  const aus = await ruf(() => a.ausgabe.exportiere({ ordner: path.join(ziel, 'fehlt') }));
  assert.deepEqual([aus.code, aus.body.fehler], [404, 'pfad_fehlt']);
  assert.deepEqual(a.ausgabe.zustand(), { lauf: null, wartend: 0, abbruch: 0 });
});

// ---- the server closes while a conversion runs ------------------------------------------------------------------------------------
// ffmpeg stand-in: the measurement of the master (ebur128) fails at once, so it cannot hang; a conversion writes a marker file and sleeps 30 s
function schlaf(t) {
  const ordner = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'djk-ffmpeg-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const marke = path.join(ordner, 'wandlung.txt'), skript = path.join(ordner, 'ffmpeg-schlaf.mjs');
  fs.writeFileSync(skript, `import fs from 'node:fs';\nif (process.argv.some((x) => x.includes('ebur128'))) process.exit(1);\n`
    + `fs.appendFileSync(${JSON.stringify(marke)}, 'start\\n');\nsetTimeout(() => {}, 30000);\n`);
  return { ffmpeg: [process.execPath, skript], marke };
}
const meister = (a) => fs.existsSync(exportOrdner(a)) && fs.readdirSync(exportOrdner(a)).some((n) => n.endsWith('.wav') && !n.includes('.teil'));
const ABGABEN = [{ format: 'wav', bits: 16 }, { format: 'mp3' }];
const STOPP = [[null, 'the server is shutting down'], [null, 'the server is shutting down']];

test('closing the server while ffmpeg converts kills it: master stays, no .teil, no delivery file', async (t) => {
  const s = schlaf(t);
  const a = await aufbau(t, { tempo: 120, opt: { ffmpeg: s.ffmpeg } });
  const t0 = Date.now();
  const lauf = ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, abgabe: ABGABEN }));
  assert.ok(await warteBis(() => fs.existsSync(s.marke), 10000), 'the conversion has started');
  assert.ok(meister(a));
  a.ausgabe.schliesse();
  const r = await lauf;
  assert.ok(Date.now() - t0 < 5000 + 5000, 'the request settled long before the 30 s sleep');
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.ok(fs.existsSync(r.body.datei), 'the master stays');
  assert.deepEqual(r.body.abgaben.map((x) => [x.datei, x.fehler]), STOPP);
  assert.equal(fs.readFileSync(s.marke, 'utf8'), 'start\n', 'only the first conversion was started');
  assert.deepEqual(fs.readdirSync(exportOrdner(a)), [path.basename(r.body.datei)], 'no .teil and no delivery file');
});

test('closing the server after the master but before the first conversion starts none', async (t) => {
  const s = schlaf(t);
  const a = await aufbau(t, { tempo: 120, opt: { ffmpeg: s.ffmpeg } });
  const lauf = ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, abgabe: ABGABEN }));
  assert.ok(await warteBis(() => meister(a), 10000), 'the master exists');
  a.ausgabe.schliesse();
  const r = await lauf;
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.ok(fs.existsSync(r.body.datei), 'the master stays');
  assert.deepEqual(r.body.abgaben.map((x) => [x.datei, x.fehler]), STOPP);
  assert.deepEqual(fs.readdirSync(exportOrdner(a)), [path.basename(r.body.datei)], 'no .teil and no delivery file');
});

// ---- task 3: loudness target check -------------------------------------------------------------------------------------------------
const ABG = [{ format: 'wav', bits: 16 }, { format: 'flac', bits: 16 }];

test('Export with ziel: master and every delivery carry ziel_pruefung, ziel_ok follows the true peak', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const lauf = (ziel) => mitUmgebung({ RENDER_ATTRAPPE_MISCHUNG: '1' }, () => ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, abgabe: ABG, ziel })));
  const streng = await lauf({ true_peak_dbtp: -20 });
  assert.equal(streng.code, 200, JSON.stringify(streng.body));
  assert.deepEqual(streng.body.ziel, { true_peak_dbtp: -20 });
  assert.equal(streng.body.ziel_ok, false);
  assert.equal(streng.body.ziel_pruefung.tp_ueber, true);
  assert.equal(streng.body.ziel_pruefung.lufs_abstand, null);
  assert.equal(streng.body.ziel_pruefung.tp_abstand, Math.round((streng.body.true_peak_dbtp + 20) * 10) / 10);
  assert.equal(streng.body.abgaben.length, 2);
  for (const x of streng.body.abgaben) {
    assert.ok(x.datei);
    assert.equal(x.ziel_pruefung.tp_ueber, x.true_peak_dbtp > -20);   // measured on the delivery file
  }
  const locker = await lauf({ lufs_i: -14, true_peak_dbtp: 0 });
  assert.equal(locker.code, 200, JSON.stringify(locker.body));
  assert.equal(locker.body.ziel_ok, true);
  assert.equal(typeof locker.body.ziel_pruefung.lufs_abstand, 'number');
  assert.ok(locker.body.abgaben.every((x) => x.ziel_pruefung.tp_ueber === false && typeof x.ziel_pruefung.lufs_abstand === 'number'));
});

test('Export of silence with ziel {lufs_i: -14, true_peak_dbtp: -1}: numbers, tp_ueber false, ziel_ok true', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await a.vorbei(a.projekt().spuren.map((s) => ({ befehl: 'spur_aendern', spur_id: s.id, mute: true })));
  const r = await mitUmgebung({ RENDER_ATTRAPPE_MISCHUNG: '1' }, () => ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, abgabe: [{ format: 'wav', bits: 16 }], ziel: { lufs_i: -14, true_peak_dbtp: -1 } })));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.spitze_db, -200, 'the master is digital silence');
  assert.equal(r.body.true_peak_dbtp, -200, 'nothing is nulled');
  assert.ok(r.body.lufs_i <= -69 && r.body.lufs_i >= -71, `about -70 LUFS: ${r.body.lufs_i}`);
  assert.equal(r.body.ziel_ok, true);
  for (const p of [r.body.ziel_pruefung, r.body.abgaben[0].ziel_pruefung]) {
    assert.equal(typeof p.lufs_abstand, 'number');
    assert.ok(p.lufs_abstand < -40 && p.lufs_abstand > -60, `${p.lufs_abstand}`);
    assert.equal(typeof p.tp_abstand, 'number');
    assert.equal(p.tp_ueber, false);
  }
});

test('Export with ziel when the loudness cannot be measured: tp_ueber null, ziel_ok null', async (t) => {
  const a = await aufbau(t, { tempo: 120, opt: { ffmpeg: ['/does/not/exist'] } });
  const r = await ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, abgabe: [{ format: 'wav', bits: 16 }], ziel: { lufs_i: -14, true_peak_dbtp: -1 } }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.ziel_pruefung, { lufs_abstand: null, tp_abstand: null, tp_ueber: null });
  assert.equal(r.body.ziel_ok, null);
  assert.equal(r.body.abgaben[0].datei, null);
  assert.deepEqual(r.body.abgaben[0].ziel_pruefung, { lufs_abstand: null, tp_abstand: null, tp_ueber: null });
});

test('Export with only a lufs target when ffmpeg is missing: ziel_ok null', async (t) => {
  const a = await aufbau(t, { tempo: 120, opt: { ffmpeg: ['/does/not/exist'] } });
  const r = await ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, ziel: { lufs_i: -14 } }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.lufs_i, null);
  assert.equal(r.body.ziel_ok, null);
});

test('Export of a one-beat range at 200 BPM with wav, flac and mp3 and a target writes every file', async (t) => {
  const a = await aufbau(t, { tempo: 200 });
  const r = await mitUmgebung({ RENDER_ATTRAPPE_MISCHUNG: '1' }, () => ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 1,
    abgabe: [{ format: 'wav', bits: 16 }, { format: 'flac', bits: 24 }, { format: 'mp3' }], ziel: { lufs_i: -14, true_peak_dbtp: -1 } })));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.ok(fs.existsSync(r.body.datei), 'the master');
  assert.equal(r.body.abgaben.length, 3);
  for (const x of r.body.abgaben) assert.ok(x.datei && fs.existsSync(x.datei) && x.fehler === undefined, `${x.format}: ${JSON.stringify(x)}`);
  assert.equal(fs.readdirSync(exportOrdner(a)).length, 4, 'master and three deliveries, no .teil');
});

test('Export with ziel and no delivery: the master alone decides', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const r = await mitUmgebung({ RENDER_ATTRAPPE_MISCHUNG: '1' }, () => ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, ziel: { true_peak_dbtp: -20 } })));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.ziel_ok, false);
  assert.equal('abgaben' in r.body, false);
});

test('Export without ziel has none of the ziel fields, also with abgabe', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const r = await ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, abgabe: [{ format: 'wav', bits: 16 }] }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  for (const k of ['ziel', 'ziel_pruefung', 'ziel_ok']) assert.equal(k in r.body, false, k);
  assert.equal('ziel_pruefung' in r.body.abgaben[0], false);
});

test('Export with a malformed ziel is refused before the render starts', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await mitUmgebung({ RENDER_ATTRAPPE_PROTOKOLL: protokoll(a) }, async () => {
    for (const [ziel, feld] of [[{}, 'ziel'], [{ lufs_i: 1 }, 'ziel.lufs_i'], [{ true_peak_dbtp: -21 }, 'ziel.true_peak_dbtp'], [{ farbe: 1 }, 'ziel.farbe'], [null, 'ziel']]) {
      const r = await ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, ziel }));
      assert.equal(r.code, 400, JSON.stringify(ziel));
      assert.equal(r.body.fehler, 'argument_ungueltig');
      assert.equal(r.body.text, 'ziel: not a valid loudness target');
      assert.ok(String(r.body.detail).includes(feld), `${r.body.detail}`);
    }
  });
  assert.equal(fs.existsSync(protokoll(a)), false, 'the render stand-in was never started');
  assert.equal(fs.existsSync(exportOrdner(a)), false);
});

test('Real-time export with ziel: same answer shape, echtzeit true', async (t) => {
  const a = await mitHost(t);
  const r = await ruf(() => a.ausgabe.exportiere({ abgabe: [{ format: 'wav', bits: 24, rate_hz: 48000 }], ziel: { true_peak_dbtp: 0 } }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.echtzeit, true);
  assert.equal(r.body.ziel_ok, true);
  assert.equal(r.body.ziel_pruefung.tp_ueber, false);
  assert.equal(r.body.abgaben[0].ziel_pruefung.tp_ueber, false);
});

// ---- task 4: release metadata -------------------------------------------------------------------------------------------------------
const META = { titel: 'Nacht "Fahrt" = 1 \u{1F319} Müller', kuenstler: 'Cytrex', jahr: 2026, isrc: 'DEXXX2600001' };
const tagsVon = (datei) => Object.fromEntries(Object.entries(JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', datei])
  .toString()).format?.tags ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
const FORMATE = [{ format: 'wav', bits: 16 }, { format: 'flac', bits: 24 }, { format: 'mp3' }];
async function mitMeta(t, opt = {}) {
  const a = await aufbau(t, { tempo: 128, ...opt });
  await a.vorbei([{ befehl: 'tonart_setzen', grundton: 9, skala: 'minor' }, { befehl: 'abgabe_meta_setzen', ...META }]);
  return a;
}

test('the tags read back from real files', async (t) => {
  const a = await mitMeta(t);
  const r = await ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, abgabe: FORMATE }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const [w, f, m] = r.body.abgaben.map((x) => tagsVon(x.datei));
  assert.equal(tagsVon(r.body.datei).title, undefined, 'the master carries no tags');
  const gemein = { title: META.titel, artist: 'Cytrex', date: '2026' };
  assert.deepEqual({ title: w.title, artist: w.artist, date: w.date, isrc: w.isrc }, { ...gemein, isrc: 'DEXXX2600001' });
  assert.equal(w.tbpm ?? w.bpm, undefined, 'a wav carries no tempo');
  assert.deepEqual({ title: f.title, artist: f.artist, date: f.date, isrc: f.isrc, bpm: f.bpm, initialkey: f.initialkey },
    { ...gemein, isrc: 'DEXXX2600001', bpm: '128', initialkey: 'Am' });
  assert.deepEqual({ title: m.title, artist: m.artist, date: m.date, tsrc: m.tsrc, tbpm: m.tbpm, tkey: m.tkey },
    { ...gemein, tsrc: 'DEXXX2600001', tbpm: '128', tkey: 'Am' });
});

test('without meta set the delivery files carry the project name as title', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const r = await ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, abgabe: [{ format: 'flac', bits: 16 }] }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(tagsVon(r.body.abgaben[0].datei).title, a.projekt().name);
});

test('ohne_meta: true writes no release tags (ffmpeg still writes its own encoder tag)', async (t) => {
  const a = await mitMeta(t);
  const r = await ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, abgabe: FORMATE, ohne_meta: true }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  for (const x of r.body.abgaben) {
    const k = Object.keys(tagsVon(x.datei));
    for (const n of ['title', 'artist', 'date', 'isrc', 'tsrc', 'bpm', 'tbpm', 'initialkey', 'tkey', 'originator']) assert.equal(k.includes(n), false, `${x.format}: no ${n}`);
  }
});

test('ohne_meta other than true is refused before the render starts', async (t) => {
  const a = await mitMeta(t);
  await mitUmgebung({ RENDER_ATTRAPPE_PROTOKOLL: protokoll(a) }, async () => {
    for (const v of [false, 'true', 1, null]) {
      const r = await ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8, abgabe: FORMATE, ohne_meta: v }));
      assert.equal(r.code, 400, JSON.stringify(v));
      assert.equal(r.body.fehler, 'argument_ungueltig');
      assert.ok(String(r.body.text).includes('ohne_meta'), r.body.text);
    }
  });
  assert.equal(fs.existsSync(protokoll(a)), false, 'the render stand-in was never started');
});

test('Real-time export writes the tags too', async (t) => {
  const a = await mitHost(t);
  await a.vorbei([{ befehl: 'abgabe_meta_setzen', ...META }]);
  const r = await ruf(() => a.ausgabe.exportiere({ abgabe: [{ format: 'flac', bits: 24 }] }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.echtzeit, true);
  assert.equal(tagsVon(r.body.abgaben[0].datei).title, META.titel);
});
