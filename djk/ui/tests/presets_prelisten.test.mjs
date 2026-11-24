// Task 3 of the browser-6 plan: the preview render service for instrument presets (throwaway project, single-flight queue, cache).
// The render is a fake that writes a WAV; nothing here needs the real renderer or a running core.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PresetVorhoerer, PresetVorhoerFehler, PRESET_VORHOER_DECKEL, normalisiere } from '../presets/prelisten.ts';
import { vorhoerSchluessel } from '../presets/prelisten_source.ts';
import { PresetSpeicher } from '../presets/store.ts';
import { RenderDateiFehler, rmsDb } from '../project/render_file.ts';
import { vorhoerCacheVorgabe } from '../paths.ts';

const LOOPS = path.join(import.meta.dirname, '..', '..', 'starter', 'loops.json');
const BESCHR = { art: 'bass', unterart: 'acid', charakter: ['warm'], genre: ['techno'], einsatz: ['drop'], energie: 3, text: 'A preview test sound.' };
const WARTE = (ms) => new Promise((r) => setTimeout(r, ms));

function wav(datei, sekunden, amp) {
  const n = Math.round(48000 * sekunden), daten = Buffer.alloc(n * 8);
  if (amp > 0) for (let i = 0; i < n; i++) { const x = amp * Math.sin(2 * Math.PI * 220 * i / 48000); daten.writeFloatLE(x, i * 8); daten.writeFloatLE(x, i * 8 + 4); }
  const k = Buffer.alloc(44);
  k.write('RIFF', 0, 'latin1'); k.writeUInt32LE(36 + daten.length, 4); k.write('WAVEfmt ', 8, 'latin1'); k.writeUInt32LE(16, 16);
  k.writeUInt16LE(3, 20); k.writeUInt16LE(2, 22); k.writeUInt32LE(48000, 24); k.writeUInt32LE(48000 * 8, 28); k.writeUInt16LE(8, 32); k.writeUInt16LE(32, 34);
  k.write('data', 36, 'latin1'); k.writeUInt32LE(daten.length, 40);
  fs.writeFileSync(datei, Buffer.concat([k, daten]));
  return n;
}

function aufbau(t, o = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-vorhoeren-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const graphen = path.join(d, 'graphen'); fs.mkdirSync(graphen);
  fs.writeFileSync(path.join(graphen, 'synth-test.json'), JSON.stringify({ knoten: [{ art: 'osz' }], v: 1 }));
  fs.writeFileSync(path.join(graphen, 'fx-test.json'), JSON.stringify({ knoten: [{ art: 'eingang' }] }));
  const speicher = new PresetSpeicher({ nutzer: path.join(d, 'nutzer'), ...(o.werkEcht ? {} : { werk: path.join(d, 'werk') }) });   // werkEcht: the read-only factory presets
  const sichere = (name, geraet, extra = {}) => speicher.speichere({ name, geraet, werte: geraet === 'hall' ? { mix: 0.3 } : { lautstaerke: 0.8 }, beschreibung: BESCHR, ...extra });
  sichere('Acid One', 'rb338', { werte: { cutoff: 900 } });
  sichere('Acid Two', 'rb338', { werte: { cutoff: 1200 } });
  sichere('Acid Three', 'rb338', { werte: { cutoff: 1500 } });
  sichere('Kraken Test', 'baukasten', { graph: 'synth-test', werte: { knob1: 0.5 } });
  sichere('Kraken Gone', 'baukasten', { graph: 'synth-gone', werte: { knob1: 0.5 } });
  sichere('Kraken Fx', 'baukasten', { graph: 'fx-test', werte: { knob1: 0.5 } });
  sichere('Quiet', 'rb338', { werte: { cutoff: 700 } });
  speicher.speichere({ name: 'Big Room', geraet: 'hall', werte: { mix: 0.3 }, beschreibung: { art: 'reverb', unterart: 'room', charakter: ['warm'], genre: ['techno'], einsatz: ['drop'], energie: 3, text: 'A hall preview test sound.' } });
  const aufrufe = [];
  let laeuft = 0, maxLaeuft = 0;
  const render = o.render ?? (async (a) => {
    const klang = a.projekt.spuren[0]?.clips[0]?.quelle?.sha256;
    a.audioDa = klang ? fs.existsSync(path.join(a.arbeitsOrdner, 'audio', `${klang}.f32`)) : null;   // the file must exist while the render runs
    aufrufe.push(a); laeuft++; maxLaeuft = Math.max(maxLaeuft, laeuft);
    try {
      await WARTE(o.verzoegerung ?? 5);
      if (o.stumm) { const frames = wav(a.ziel, 3.75, 0); return { datei: a.ziel, frames, spitze_db: -200, rms_db: -200 }; }
      const frames = wav(a.ziel, 3.75, 0.5);
      return { datei: a.ziel, frames, spitze_db: -6, rms_db: -9 };
    } finally { laeuft--; }
  });
  const cache = path.join(d, 'cache');
  if (o.starterWav !== false) {
    fs.mkdirSync(path.join(d, 'wav'));
    for (const l of JSON.parse(fs.readFileSync(LOOPS, 'utf8'))) wav(path.join(d, 'wav', `${l.name}_128bpm.wav`), 3.75, 0.4);
  }
  const logs = [];
  const opt = { speicher, cacheOrdner: cache, loopsDatei: LOOPS, starterWavOrdner: path.join(d, 'wav'), graphenOrdner: graphen, kitOrdner: path.join(d, 'kits'),
    render, ...(o.deckel ? { deckel: o.deckel } : {}), ...(o.limitMs ? { limitMs: o.limitMs } : {}), log: (z) => logs.push(z) };
  const v = new PresetVorhoerer(opt);
  return { d, v, opt, speicher, aufrufe, cache, graphen, logs, maxLaeuft: () => maxLaeuft };
}

test('first call renders and caches, the project is a throwaway track with the preset applied', async (t) => {
  const { v, aufrufe, cache, graphen } = aufbau(t);
  const r = await v.vorhoer('nutzer:rb338/acid-one');
  assert.equal(r.aus_cache, false);
  assert.ok(fs.existsSync(path.join(cache, `${r.schluessel}.wav`)) && fs.existsSync(path.join(cache, `${r.schluessel}.json`)));
  assert.equal(r.datei, path.join(cache, `${r.schluessel}.wav`));
  assert.ok(Math.abs(r.dauer_s - 3.75) < 0.05, `dauer ${r.dauer_s}`);
  const side = JSON.parse(fs.readFileSync(path.join(cache, `${r.schluessel}.json`), 'utf8'));
  assert.equal(side.id, 'nutzer:rb338/acid-one'); assert.equal(side.rolle, 'bass');
  const a = aufrufe[0];
  assert.equal(a.projekt.spuren.length, 1);
  assert.equal(a.projekt.spuren[0].geraet.name, 'rb338');
  assert.equal(a.projekt.spuren[0].geraet.preset, 'nutzer:rb338/acid-one');
  assert.ok(a.projekt.spuren[0].clips[0].noten.length > 0);
  assert.equal(a.projekt.tempo_bpm, 128);
  assert.equal(a.vonBeat, 0); assert.equal(a.bisBeat, 8);
  assert.equal(a.env.CYPHERDJ_BK_ORDNER, graphen);
  assert.ok(a.env.CYPHERDJ_KIT_ORDNER);

  const k = await v.vorhoer('nutzer:baukasten/kraken-test');
  const b = aufrufe[1].projekt.spuren[0].geraet;
  assert.equal(b.name, 'bk'); assert.equal(b.graph, 'synth-test'); assert.equal(b.preset, 'nutzer:baukasten/kraken-test');
  assert.equal(b.parameter.k1, 0.5);
  assert.notEqual(k.schluessel, r.schluessel);
});

test('second call comes from the cache, no render', async (t) => {
  const { v, aufrufe } = aufbau(t);
  const a = await v.vorhoer('nutzer:rb338/acid-one');
  const b = await v.vorhoer('nutzer:rb338/acid-one');
  assert.equal(b.aus_cache, true); assert.equal(b.datei, a.datei); assert.equal(aufrufe.length, 1);
  assert.equal(b.rms_db, a.rms_db);
});

test('two parallel calls render once and share the file', async (t) => {
  const { v, aufrufe } = aufbau(t, { verzoegerung: 40 });
  const [a, b] = await Promise.all([v.vorhoer('nutzer:rb338/acid-one'), v.vorhoer('nutzer:rb338/acid-one')]);
  assert.equal(aufrufe.length, 1); assert.equal(a.datei, b.datei);
});

test('two presets in a row never render two at a time: one running, one waiting', async (t) => {
  const { v, aufrufe, maxLaeuft } = aufbau(t, { verzoegerung: 30 });
  await Promise.all(['acid-one', 'acid-two'].map((s) => v.vorhoer(`nutzer:rb338/${s}`)));
  assert.equal(aufrufe.length, 2); assert.equal(maxLaeuft(), 1);
});

test('a silent render is refused and not cached', async (t) => {
  const { v, cache } = aufbau(t, { stumm: true });
  await assert.rejects(v.vorhoer('nutzer:rb338/quiet'), (e) => e instanceof PresetVorhoerFehler && e.grund === 'vorhoeren_stumm' && e.code === 422 && e.text.length > 10);
  assert.deepEqual(fs.readdirSync(cache).filter((n) => n.endsWith('.wav')), []);
});

test('presets that cannot be previewed are refused before any render', async (t) => {
  const { v, aufrufe, speicher } = aufbau(t);
  const falle = (id, code, grund) => assert.rejects(v.vorhoer(id), (e) => e instanceof PresetVorhoerFehler && e.code === code && e.grund === grund && e.text.length > 5);
  await falle('nutzer:hall/big-room', 422, 'vorhoeren_nicht_moeglich');
  await falle('nutzer:rb338/does-not-exist', 404, 'preset_unbekannt');
  await falle('nonsense', 404, 'preset_unbekannt');
  await falle('../etc/passwd', 404, 'preset_unbekannt');
  fs.writeFileSync(speicher.pfad('nutzer', 'rb338', 'acid-two'), '{ not json');
  await falle('nutzer:rb338/acid-two', 409, 'preset_unlesbar');
  await assert.rejects(v.vorhoer('nutzer:baukasten/kraken-gone'), (e) => e.grund === 'graph_fehlt' && e.code === 422 && e.text === "the graph 'synth-gone' of this preset is not installed");
  assert.equal(aufrufe.length, 0);
});

test('a missing or failing render program surfaces as 503', async (t) => {
  const fehlt = aufbau(t, { render: async () => { throw new RenderDateiFehler('render_fehlt', 'cypherdj-render not found'); } });
  await assert.rejects(fehlt.v.vorhoer('nutzer:rb338/acid-one'), (e) => e instanceof PresetVorhoerFehler && e.code === 503 && e.grund === 'render_fehlt');
  const kaputt = aufbau(t, { render: async () => { throw new RenderDateiFehler('render_fehlgeschlagen', 'rc 4'); } });
  await assert.rejects(kaputt.v.vorhoer('nutzer:rb338/acid-one'), (e) => e.code === 503 && e.grund === 'render_fehlgeschlagen');
  const bug = aufbau(t, { render: async () => { throw new RenderDateiFehler('projekt_ungueltig', 'oops'); } });
  await assert.rejects(bug.v.vorhoer('nutzer:rb338/acid-one'), (e) => e.code === 503 && e.grund === 'render_fehlgeschlagen');
  assert.ok(bug.logs.some((z) => String(z.fehler ?? '').includes('oops')));
  const roh = aufbau(t, { render: async () => { throw new Error('boom'); } });
  await assert.rejects(roh.v.vorhoer('nutzer:rb338/acid-one'), (e) => e instanceof PresetVorhoerFehler && e.code === 503);
  // nothing cached, and the same click works again once the renderer is back
  assert.deepEqual(fs.existsSync(fehlt.cache) ? fs.readdirSync(fehlt.cache).filter((n) => n !== 'arbeit') : [], []);
});

test('the work folder is empty after success and after failure', async (t) => {
  const ok = aufbau(t);
  await ok.v.vorhoer('nutzer:rb338/acid-one');
  assert.deepEqual(fs.readdirSync(path.join(ok.cache, 'arbeit')), []);
  const bad = aufbau(t, { render: async (a) => { fs.writeFileSync(path.join(path.dirname(a.ziel), 'rest.tmp'), 'x'); throw new RenderDateiFehler('render_fehlgeschlagen', 'x'); } });
  await assert.rejects(bad.v.vorhoer('nutzer:rb338/acid-one'));
  assert.deepEqual(fs.readdirSync(path.join(bad.cache, 'arbeit')), []);
});

test('the cache is capped, the oldest goes and the newest stays, the sidecar goes with its WAV', async (t) => {
  const { v, cache } = aufbau(t, { deckel: 2 * 1024 ** 2 });
  const a = await v.vorhoer('nutzer:rb338/acid-one');
  const alt = new Date(Date.now() - 60_000);
  fs.utimesSync(a.datei, alt, alt);
  const b = await v.vorhoer('nutzer:rb338/acid-two');
  assert.ok(!fs.existsSync(a.datei) && !fs.existsSync(path.join(cache, `${a.schluessel}.json`)));
  assert.ok(fs.existsSync(b.datei));
  assert.ok(PRESET_VORHOER_DECKEL === 200 * 1024 ** 2);
});

test('changing the graph file under the same name gives a new key', async (t) => {
  const { v, graphen } = aufbau(t);
  const a = await v.vorhoer('nutzer:baukasten/kraken-test');
  fs.writeFileSync(path.join(graphen, 'synth-test.json'), JSON.stringify({ knoten: [{ art: 'osz' }], v: 2 }));
  const b = await v.vorhoer('nutzer:baukasten/kraken-test');
  assert.notEqual(a.schluessel, b.schluessel); assert.equal(b.aus_cache, false);
});

// ---- Task 5: effect preview through a starter loop --------------------------------------------------------------------------------------
const WAV_LOOP = (d, name) => path.join(d, 'wav', `${name}_128bpm.wav`);

test('an eq, komp and saett preset renders through the starter loop, then comes from the cache', async (t) => {
  const { v, aufrufe } = aufbau(t, { werkEcht: true });
  for (const id of ['werk:eq/dark-room', 'werk:komp/drum-bus', 'werk:saett/acid-bite']) {
    const a = await v.vorhoer(id);
    assert.equal(a.aus_cache, false, id);
    const b = await v.vorhoer(id);
    assert.equal(b.aus_cache, true, id); assert.equal(b.schluessel, a.schluessel);
  }
  assert.equal(aufrufe.length, 3);
});

test('the effect project is one audio track with the loop as its clip and one insert of the preset device', async (t) => {
  const { v, aufrufe, d } = aufbau(t, { werkEcht: true });
  await v.vorhoer('werk:komp/drum-bus');
  const a = aufrufe[0], spur = a.projekt.spuren[0];
  assert.equal(a.projekt.spuren.length, 1); assert.equal(spur.art, 'audio');
  assert.equal(spur.clips.length, 1); assert.equal(spur.clips[0].art, 'audio');
  assert.equal(spur.inserts.length, 1); assert.equal(spur.inserts[0].art, 'komp'); assert.equal(spur.inserts[0].preset, 'werk:komp/drum-bus');
  assert.equal(a.audioDa, true); assert.equal(spur.clips[0].dekodiert, 'fertig');
  assert.equal(spur.clips[0].laenge_beats, 8); assert.equal(a.projekt.tempo_bpm, 128);
  assert.equal(a.vonBeat, 0); assert.equal(a.bisBeat, 8);
  // the clip's sha is the hash of the raw data chunk of the loop file (the work folder is gone after the render, so recompute from the WAV)
  const tabelle = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'presets', 'vorhoeren_phrasen.json'), 'utf8'));
  const roh = fs.readFileSync(WAV_LOOP(d, tabelle.effekte.compressor));
  assert.equal(crypto.createHash('sha256').update(roh.subarray(44)).digest('hex'), spur.clips[0].quelle.sha256);
  assert.ok(!fs.existsSync(a.arbeitsOrdner), 'the work folder is removed after the render');
});

test('missing, truncated or 16-bit starter loops give starter_fehlt 409 and nothing is cached', async (t) => {
  const text = 'the starter loops are not installed yet; run djk-starter once';
  const fehl = (v) => assert.rejects(v.vorhoer('werk:komp/drum-bus'), (e) => e instanceof PresetVorhoerFehler && e.code === 409 && e.grund === 'starter_fehlt' && e.text === text);
  const ohne = aufbau(t, { werkEcht: true, starterWav: false });
  await fehl(ohne.v);
  const mit = aufbau(t, { werkEcht: true });
  const loops = fs.readdirSync(path.join(mit.d, 'wav')).map((n) => path.join(mit.d, 'wav', n));
  const original = loops.map((f) => fs.readFileSync(f));
  loops.forEach((f, i) => fs.writeFileSync(f, original[i].subarray(0, 1000)));   // truncated: the data chunk claims more than the file holds
  await fehl(mit.v);
  loops.forEach((f, i) => { const b = Buffer.from(original[i]); b.writeUInt16LE(1, 20); b.writeUInt16LE(16, 34); fs.writeFileSync(f, b); });   // 16-bit PCM header
  await fehl(mit.v);
  assert.equal(mit.aufrufe.length + ohne.aufrufe.length, 0);
  for (const x of [ohne, mit]) assert.deepEqual(fs.existsSync(x.cache) ? fs.readdirSync(x.cache).filter((n) => n.endsWith('.wav')) : [], []);
});

test('a hall preset and a Baukasten effect graph that is not installed are refused', async (t) => {
  const { v, aufrufe } = aufbau(t, { werkEcht: true });
  await assert.rejects(v.vorhoer('werk:hall/ambient-bed'), (e) => e.code === 422 && e.grund === 'vorhoeren_nicht_moeglich');
  const { v: v2, speicher, aufrufe: a2 } = aufbau(t);
  speicher.speichere({ name: 'Fx Gone', geraet: 'baukasten', graph: 'fx-gone', werte: { knob1: 0.5 }, beschreibung: BESCHR });
  await assert.rejects(v2.vorhoer('nutzer:baukasten/fx-gone'), (e) => e.code === 422 && e.grund === 'graph_fehlt');
  assert.equal(aufrufe.length + a2.length, 0);
});

test('a Baukasten effect graph previews as an insert of that graph', async (t) => {
  const { v, aufrufe } = aufbau(t);
  const r = await v.vorhoer('nutzer:baukasten/kraken-fx');
  assert.equal(r.aus_cache, false);
  const ins = aufrufe[0].projekt.spuren[0].inserts;
  assert.equal(ins.length, 1); assert.equal(ins[0].art, 'bk'); assert.equal(ins[0].graph, 'fx-test');
});

test('the key of an effect preview differs from that of an instrument preview', async (t) => {
  const { v } = aufbau(t, { werkEcht: true });
  const fx = await v.vorhoer('werk:komp/drum-bus');
  const inst = await v.vorhoer('werk:rb338/' + fs.readdirSync(path.join(import.meta.dirname, '..', 'presets', 'factory', 'rb338'))[0].replace('.preset.json', ''));
  assert.notEqual(fx.schluessel, inst.schluessel);
});

test('the cache folder default follows the instance letter', () => {
  assert.equal(vorhoerCacheVorgabe('c'), '/dev/shm/cypherdj-c/vorhoeren');
  assert.equal(vorhoerCacheVorgabe(''), path.join(os.homedir(), '.cache', 'cypherdj', 'vorhoeren'));
  assert.throws(() => vorhoerCacheVorgabe('z'));
});

// ---- review fixes (browser plan 6, review G1) ------------------------------------------------------------------------------------------------
test('bass, lead and pluck presets with equal values get three keys; the same art gives the same key', async (t) => {
  const { v, speicher } = aufbau(t);
  const mach = (name, art) => speicher.speichere({ name, geraet: 'rb338', werte: { cutoff: 640 }, beschreibung: { ...BESCHR, art, unterart: art === 'pluck' ? 'synth' : 'acid' } });
  mach('Same Bass', 'bass'); mach('Same Lead', 'lead'); mach('Same Pluck', 'pluck'); mach('Same Bass Two', 'bass');
  const k = {};
  for (const n of ['same-bass', 'same-lead', 'same-pluck', 'same-bass-two']) k[n] = (await v.vorhoer(`nutzer:rb338/${n}`)).schluessel;
  assert.equal(new Set([k['same-bass'], k['same-lead'], k['same-pluck']]).size, 3);
  assert.equal(k['same-bass'], k['same-bass-two']);
});

test('the key also follows the transposition, the loops.json hash and the renderer build', () => {
  const p = { geraet: 'rb338', werte: { cutoff: 1 }, beschreibung: { art: 'bass' } };
  const k = (q) => vorhoerSchluessel(p, { loop: 'l', ...q }, null);
  const k0 = k({});
  assert.notEqual(k({ transponiere: 12 }), k0);
  assert.notEqual(k({ loopsHash: 'a' }), k0);
  assert.notEqual(k({ loopsHash: 'a' }), k({ loopsHash: 'b' }));
  assert.notEqual(k({ renderer: '1-100' }), k0);
  assert.equal(k({ renderer: '1-100' }), k({ renderer: '1-100' }));
});

test('a render that is overtaken: six quick clicks render the first and the last only, the middle ones are refused ueberholt', async (t) => {
  const { v, aufrufe, maxLaeuft } = aufbau(t, { verzoegerung: 60 });
  const ids = ['nutzer:rb338/acid-one', 'nutzer:rb338/acid-two', 'nutzer:rb338/acid-three', 'nutzer:baukasten/kraken-test', 'nutzer:rb338/quiet', 'nutzer:baukasten/kraken-fx'];
  const r = await Promise.allSettled(ids.map((id) => v.vorhoer(id)));
  assert.equal(r[0].status, 'fulfilled'); assert.equal(r[5].status, 'fulfilled');
  for (const i of [1, 2, 3, 4]) { assert.equal(r[i].status, 'rejected', String(i)); assert.ok(r[i].reason instanceof PresetVorhoerFehler && r[i].reason.grund === 'ueberholt' && r[i].reason.code === 409 && r[i].reason.text.length > 10); }
  assert.equal(aufrufe.length, 2); assert.equal(maxLaeuft(), 1);
});

test('a joiner of the waiting key is not a new click: it shares the waiting render', async (t) => {
  const { v, aufrufe } = aufbau(t, { verzoegerung: 40 });
  const r = await Promise.all([v.vorhoer('nutzer:rb338/acid-one'), v.vorhoer('nutzer:rb338/acid-two'), v.vorhoer('nutzer:rb338/acid-two')]);
  assert.equal(aufrufe.length, 2); assert.equal(r[1].datei, r[2].datei);
});

test('a render beyond the limit is aborted through its signal and refused 503', async (t) => {
  const render = async (a) => new Promise((_, nein) => a.abbruch.addEventListener('abort', () => nein(new RenderDateiFehler('render_fehlgeschlagen', 'aborted'))));
  const { v, cache, logs } = aufbau(t, { render, limitMs: 80 });
  const t0 = Date.now();
  await assert.rejects(v.vorhoer('nutzer:rb338/acid-one'), (e) => e instanceof PresetVorhoerFehler && e.grund === 'render_fehlgeschlagen' && e.code === 503);
  assert.ok(Date.now() - t0 < 2000);
  assert.deepEqual(fs.readdirSync(cache).filter((n) => n.endsWith('.wav')), []);
  assert.ok(logs.length > 0);
  // the next preview is not blocked by the aborted one
  const ok = aufbau(t);
  assert.equal((await ok.v.vorhoer('nutzer:rb338/acid-one')).aus_cache, false);
});

test('a damaged cache file never plays: a 7-byte WAV, a cut WAV, no sidecar and a foreign sidecar all render again', async (t) => {
  const { v, aufrufe, cache } = aufbau(t);
  const a = await v.vorhoer('nutzer:rb338/acid-one');
  const gut = fs.readFileSync(a.datei);
  const seite = path.join(cache, `${a.schluessel}.json`);
  const faelle = [
    ['7 bytes', () => fs.writeFileSync(a.datei, Buffer.from('RIFFxyz'))],
    ['cut', () => fs.writeFileSync(a.datei, gut.subarray(0, gut.length - 1000))],
    ['no sidecar', () => fs.rmSync(seite)],
    ['foreign sidecar', () => fs.writeFileSync(seite, JSON.stringify({ schluessel: 'x'.repeat(64), dauer_s: 3.75 }))],
    ['broken sidecar', () => fs.writeFileSync(seite, '{ nope')],
  ];
  let n = 1;
  for (const [name, kaputt] of faelle) {
    kaputt();
    const b = await v.vorhoer('nutzer:rb338/acid-one');
    assert.equal(b.aus_cache, false, name); assert.equal(aufrufe.length, ++n, name);
    assert.deepEqual(fs.readFileSync(a.datei), gut, `${name}: the cache holds the new, whole file`);
    assert.equal((await v.vorhoer('nutzer:rb338/acid-one')).aus_cache, true, name);
  }
});

test('previews end at a common loudness: two presets 20 dB apart land within 2 dB, the gain is in the sidecar', async (t) => {
  const render = async (a) => {
    const laut = a.projekt.spuren[0].geraet.preset.endsWith('acid-one');
    const frames = wav(a.ziel, 3.75, laut ? 0.5 : 0.05);
    return { datei: a.ziel, frames, spitze_db: laut ? -6 : -26, rms_db: laut ? -9 : -29 };
  };
  const { v, cache } = aufbau(t, { render });
  const a = await v.vorhoer('nutzer:rb338/acid-one'), b = await v.vorhoer('nutzer:rb338/acid-two');
  assert.ok(Math.abs(a.rms_db - b.rms_db) < 2, `${a.rms_db} vs ${b.rms_db}`);
  assert.ok(Math.abs(rmsDb(a.datei) - rmsDb(b.datei)) < 2, `${rmsDb(a.datei)} vs ${rmsDb(b.datei)} in the files`);
  assert.ok(Math.abs(rmsDb(a.datei) + 18) < 1 && Math.abs(rmsDb(b.datei) + 18) < 1);
  const sa = JSON.parse(fs.readFileSync(path.join(cache, `${a.schluessel}.json`), 'utf8')), sb = JSON.parse(fs.readFileSync(path.join(cache, `${b.schluessel}.json`), 'utf8'));
  assert.ok(sa.gain_db < -5 && sb.gain_db > 5 && Math.abs(sb.gain_db - sa.gain_db - 20) < 0.5, `${sa.gain_db} ${sb.gain_db}`);
  assert.equal(sa.rms_db, a.rms_db);
});

test('the peak ceiling wins over the loudness target: a quiet phrase with one loud spike stays at -1 dBFS peak', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-norm-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const f = path.join(d, 'x.wav');
  wav(f, 1, 0.01);
  const b = fs.readFileSync(f); b.writeFloatLE(0.9, 44 + 4 * 1000);
  fs.writeFileSync(f, b);
  const n = normalisiere(f);
  assert.ok(n.spitze_db <= -0.99 && n.spitze_db >= -1.01, String(n.spitze_db));
  assert.ok(n.rms_db < -18, String(n.rms_db));
  assert.equal(normalisiere(path.join(d, 'nope.wav')), null);
  fs.writeFileSync(f, 'junk'); assert.equal(normalisiere(f), null);
});

test('work folders of an earlier run are removed when the service starts', (t) => {
  const { opt, cache } = aufbau(t);
  fs.mkdirSync(path.join(cache, 'arbeit', 'abc', 'audio'), { recursive: true });
  fs.writeFileSync(path.join(cache, 'arbeit', 'abc', 'audio', 'x.f32'), 'x');
  new PresetVorhoerer(opt);
  assert.ok(!fs.existsSync(path.join(cache, 'arbeit')));
});

test('review fixes: an effect key follows the starter WAV content and the kit folder', async (t) => {
  const { v, opt, d, aufrufe } = aufbau(t, { werkEcht: true });
  const a = await v.vorhoer('werk:eq/dark-room');
  const loop = fs.readdirSync(path.join(d, 'wav'))[0];
  const alle = fs.readdirSync(path.join(d, 'wav'));
  for (const n of alle) wav(path.join(d, 'wav', n), 3.75, 0.2);   // the starter loops are re-recorded
  const b = await v.vorhoer('werk:eq/dark-room');
  assert.notEqual(b.schluessel, a.schluessel); assert.equal(b.aus_cache, false); assert.equal(aufrufe.length, 2); assert.ok(loop);
  const v2 = new PresetVorhoerer({ ...opt, kitOrdner: path.join(d, 'other-kits') });
  const c = await v2.vorhoer('werk:eq/dark-room');
  assert.notEqual(c.schluessel, b.schluessel);
});

test('review fixes: a cached WAV with a NaN sample, all zeros for an audible sidecar, or a length that disagrees with the sidecar renders again', async (t) => {
  const { v, aufrufe } = aufbau(t);
  const a = await v.vorhoer('nutzer:rb338/acid-one');
  const gut = fs.readFileSync(a.datei);
  const faelle = [
    ['NaN', () => { const b = Buffer.from(gut); b.writeFloatLE(NaN, 44 + 400); fs.writeFileSync(a.datei, b); }],
    ['all zero', () => { const b = Buffer.from(gut); b.fill(0, 44); fs.writeFileSync(a.datei, b); }],
    ['shorter than the sidecar says', () => { const b = Buffer.from(gut.subarray(0, 44 + 8 * 48000)); b.writeUInt32LE(8 * 48000, 40); fs.writeFileSync(a.datei, b); }],
  ];
  let n = 1;
  for (const [name, kaputt] of faelle) {
    kaputt();
    const b = await v.vorhoer('nutzer:rb338/acid-one');
    assert.equal(b.aus_cache, false, name); assert.equal(aufrufe.length, ++n, name);
    assert.deepEqual(fs.readFileSync(a.datei), gut, name);
  }
});

test('review fixes: pruefe refuses what cannot be previewed and changes nothing', async (t) => {
  const { v, aufrufe } = aufbau(t);
  assert.throws(() => v.pruefe('nutzer:hall/big-room'), (e) => e.grund === 'vorhoeren_nicht_moeglich');
  assert.throws(() => v.pruefe('nutzer:rb338/gibtsnicht'), (e) => e.grund === 'preset_unbekannt');
  v.pruefe('nutzer:rb338/acid-one');
  assert.equal(aufrufe.length, 0);
});
