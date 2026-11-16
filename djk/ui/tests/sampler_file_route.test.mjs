// Sample player stage 1: the routes /sampler/dateien, /sampler/datei/hoer and /sampler/datei/spur. Server with the kern stand-in (stack of
// support/media_library.mjs); roots, cut store and graph folder are temp folders, never ~/.config.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { ruf, CYPHER } from './support/proj_stack.mjs';
import { sinusWav } from './support/sinus_wav.mjs';
import { dateiRouten } from '../areas/sampler/file_routes.ts';
import { listeSchnitte } from '../sampler/schnitt.ts';

async function aufbau(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-datr-'));
  const d = { root, loops: path.join(root, 'loops'), module: path.join(root, 'module'), sampler: path.join(root, 'sampler'), bk: path.join(root, 'bk'), lib: path.join(root, 'lib') };
  for (const p of Object.values(d)) if (p !== root) fs.mkdirSync(p);
  fs.writeFileSync(path.join(d.sampler, 'wurzeln.json'), JSON.stringify([{ name: 'Lib', pfad: d.lib }, { name: 'Weg', pfad: path.join(root, 'nix') }]));
  const alt = { bk: process.env.CYPHERDJ_BK_ORDNER, sampler: process.env.CYPHERDJ_SAMPLER };
  process.env.CYPHERDJ_BK_ORDNER = d.bk;
  process.env.CYPHERDJ_SAMPLER = d.sampler;
  t.after(() => {
    for (const [k, v] of [['CYPHERDJ_BK_ORDNER', alt.bk], ['CYPHERDJ_SAMPLER', alt.sampler]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  sinusWav(path.join(d.lib, 'Pad.wav'), { hz: 220, sekunden: 1, rate: 44100, kanaele: 1, stille: 0.2 });
  sinusWav(path.join(d.lib, 'sub', 'Lead C3.wav'), { hz: 220, sekunden: 1, rate: 48000, kanaele: 2 });
  sinusWav(path.join(d.lib, 'stumm.wav'), { sekunden: 1, stumm: true });
  const s = await stapel(t, { loops: d.loops });
  s.optionen.modulOrdner = d.module;
  s.optionen.samplerOrdner = d.sampler;
  const oeffne = async (name = 'Mod', tempo) => {
    const r = await ruf(s.url, 'POST', '/proj/neu', { name, werkbank: true });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    if (tempo !== undefined) assert.equal((await ruf(s.url, 'POST', '/proj/aendern', { rev: r.j.projekt.rev, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm: tempo }] })).code, 200);
  };
  const projekt = async () => (await ruf(s.url, 'GET', '/proj/aktuell')).j.projekt;
  const verlauf = async () => (await ruf(s.url, 'GET', '/proj/verlauf')).j;
  const bkDateien = () => fs.existsSync(d.bk) ? fs.readdirSync(d.bk).filter((n) => n.endsWith('.json')) : [];
  return { ...s, d, oeffne, projekt, verlauf, bkDateien };
}

test('the routes of the file part', () => {
  const r = dateiRouten({ log() {}, quelle: () => 'andreas', kiGestoppt: () => false }, { sitzung: {}, zugang: {}, loops: '', module: '' });
  assert.deepEqual(r.map((x) => `${x.methode} ${x.pfad}`), ['GET /sampler/dateien', 'GET /sampler/datei/hoer', 'POST /sampler/datei/spur']);
  assert.deepEqual(r.map((x) => x.schutz), ['offen', 'offen', 'fremdePost']);
});

test('GET /sampler/dateien: roots, folder, search, refusals', async (t) => {
  const z = await aufbau(t);
  let r = await ruf(z.url, 'GET', '/sampler/dateien');
  assert.deepEqual([r.code, r.j], [200, { wurzeln: [{ name: 'Lib' }, { name: 'Weg', fehlt: true }] }]);
  r = await ruf(z.url, 'GET', '/sampler/dateien?wurzel=Lib');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.wurzel, r.j.ordner, r.j.ordner_liste], ['Lib', '', ['sub']]);
  assert.deepEqual(r.j.dateien.map((x) => x.rel), ['Pad.wav', 'stumm.wav']);
  assert.ok(r.j.dateien[0].bytes > 1000);
  r = await ruf(z.url, 'GET', '/sampler/dateien?wurzel=Lib&ordner=sub');
  assert.deepEqual([r.j.ordner, r.j.dateien.map((x) => x.rel)], ['sub', ['sub/Lead C3.wav']]);
  r = await ruf(z.url, 'GET', `/sampler/dateien?wurzel=Lib&suche=${encodeURIComponent('lead c3')}`);
  assert.deepEqual(r.j.dateien.map((x) => x.rel), ['sub/Lead C3.wav']);
  for (const q of ['wurzel=Weg', 'wurzel=Nix', 'wurzel=Lib&ordner=..', `wurzel=Lib&ordner=${encodeURIComponent(z.d.root)}`, 'wurzel=Lib&ordner=gibtsnicht']) {
    r = await ruf(z.url, 'GET', `/sampler/dateien?${q}`);
    assert.deepEqual([r.code, r.j.fehler], [404, 'quelle_unbekannt'], q);
  }
});

test('GET /sampler/datei/hoer answers audio/wav with a RIFF header; refuses a path outside', async (t) => {
  const z = await aufbau(t);
  const a = await fetch(`${z.url}/sampler/datei/hoer?wurzel=Lib&rel=${encodeURIComponent('sub/Lead C3.wav')}`);
  assert.equal(a.status, 200);
  assert.equal(a.headers.get('content-type'), 'audio/wav');
  const b = Buffer.from(await a.arrayBuffer());
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WAVE');
  assert.equal(b.readUInt32LE(24), 48000);
  assert.equal(b.length, 44 + 48000 * 4);
  const x = await ruf(z.url, 'GET', `/sampler/datei/hoer?wurzel=Lib&rel=${encodeURIComponent('../x.wav')}`);
  assert.deepEqual([x.code, x.j.fehler], [404, 'quelle_unbekannt']);
  const y = await ruf(z.url, 'GET', '/sampler/datei/hoer?wurzel=Lib&rel=sub');
  assert.equal(y.code, 404);
});

test('POST /sampler/datei/spur: cut, tone and track in one history step', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Mod', 120);
  const v0 = (await z.verlauf()).length;
  const r = await ruf(z.url, 'POST', '/sampler/datei/spur', { wurzel: 'Lib', rel: 'Pad.wav' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const p = await z.projekt();
  const spur = p.spuren.find((x) => x.id === r.j.spur_id);
  assert.ok(spur, 'the track exists');
  assert.equal(spur.name, 'Pad');
  assert.equal(spur.geraet.graph, r.j.ton.graph);
  assert.equal(r.j.ton.name, 'Pad');
  assert.equal(r.j.ton.grund, 57);
  assert.equal(r.j.grund_herkunft, 'erkannt');
  assert.deepEqual(spur.clips[0].noten.map((n) => [n.beat, n.ton, n.vel]), [[0, 57, 100]]);
  assert.deepEqual([r.j.rev, r.j.projekt.rev], [p.rev, p.rev]);
  assert.equal(typeof r.j.text, 'string');
  const v = await z.verlauf();
  assert.equal(v.length, v0 + 1, 'one history step');
  assert.equal(v[v.length - 1].label, 'Tone Pad');
  const cuts = listeSchnitte({ ordner: z.d.sampler });
  assert.deepEqual(cuts.map((c) => [c.id, c.methode, c.quelle, c.bpm, c.grenzen.length]), [[r.j.schnitt_id, 'ganz', { art: 'datei', ref: 'Lib/Pad.wav' }, 120, 2]]);
  assert.ok(Math.abs(cuts[0].frames - 38400) <= 16, `leading silence trimmed: ${cuts[0].frames}`);
  // the cut is in /sampler/liste and deletable with its tone, once the track is gone
  const l = await ruf(z.url, 'GET', '/sampler/liste');
  assert.deepEqual(l.j.schnitte.map((c) => [c.id, c.quelle.art]), [[r.j.schnitt_id, 'datei']]);
  const blockiert = await ruf(z.url, 'POST', '/sampler/loeschen', { id: r.j.schnitt_id });
  assert.equal(blockiert.code, 409, 'the track still plays the tone');
  const lo = await ruf(z.url, 'POST', '/proj/aendern', { rev: p.rev, label: 'Remove', befehle: [{ befehl: 'spur_loeschen', spur_id: r.j.spur_id }] });
  assert.equal(lo.code, 200, JSON.stringify(lo.j));
  const del = await ruf(z.url, 'POST', '/sampler/loeschen', { id: r.j.schnitt_id });
  assert.deepEqual([del.code, del.j], [200, { ok: true }]);
  assert.deepEqual(listeSchnitte({ ordner: z.d.sampler }), []);
  assert.deepEqual(z.bkDateien().filter((n) => n.startsWith('ton-') || n.startsWith('smp-')), []);
});

test('POST /sampler/datei/spur: root from the file name, by hand, stereo file', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Mod', 120);
  const a = await ruf(z.url, 'POST', '/sampler/datei/spur', { wurzel: 'Lib', rel: 'sub/Lead C3.wav' });
  assert.deepEqual([a.code, a.j.ton.grund, a.j.grund_herkunft], [200, 60, 'dateiname']);   // 220 Hz = A3 (57); the nearest C is 60
  const b = await ruf(z.url, 'POST', '/sampler/datei/spur', { wurzel: 'Lib', rel: 'sub/Lead C3.wav', grund: 40, name: 'Mein Lead' });
  assert.deepEqual([b.code, b.j.ton.grund, b.j.ton.name, b.j.grund_herkunft], [200, 40, 'Mein Lead', 'angabe']);
  assert.equal((await z.projekt()).spuren.find((x) => x.id === b.j.spur_id).name, 'Mein Lead');
});

test('POST /sampler/datei/spur refusals create nothing', async (t) => {
  const z = await aufbau(t);
  const post = (d, kopf) => ruf(z.url, 'POST', '/sampler/datei/spur', d, kopf);
  let r = await post({ wurzel: 'Lib', rel: 'Pad.wav' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_projekt']);
  await z.oeffne('Mod', 120);
  const vor = (await z.verlauf()).length;
  for (const [d, code, fehler] of [
    [{ wurzel: 'Lib', rel: 'nix.wav' }, 404, 'quelle_unbekannt'], [{ wurzel: 'Lib', rel: '../x.wav' }, 404, 'quelle_unbekannt'], [{ wurzel: 'Nix', rel: 'Pad.wav' }, 404, 'quelle_unbekannt'],
    [{ wurzel: 'Lib', rel: 'stumm.wav' }, 422, 'format_falsch'], [{ wurzel: 'Lib' }, 400, 'argument_ungueltig'], [{ wurzel: 'Lib', rel: 'Pad.wav', grund: 3 }, 400, 'argument_ungueltig'],
    [{ wurzel: 'Lib', rel: 'Pad.wav', zusatz: 1 }, 400, 'argument_unbekannt']]) {
    r = await post(d);
    assert.deepEqual([r.code, r.j.fehler], [code, fehler], JSON.stringify(d));
  }
  r = await post({ wurzel: 'Lib', rel: 'Pad.wav' }, CYPHER);
  assert.equal(r.code, 200);
  assert.equal((await z.verlauf()).length, vor + 1);
  assert.equal(listeSchnitte({ ordner: z.d.sampler }).length, 1, 'only the one cut of the successful request');
  // the failed requests left no cut, tone or graph behind: one cut means one tone graph, one cut graph
  assert.deepEqual(z.bkDateien().sort().map((n) => n.slice(0, 3)), ['smp', 'ton']);
});

test('POST /sampler/datei/spur: a file over 60 s is zu_lang and leaves nothing', async (t) => {
  const z = await aufbau(t);
  await z.oeffne('Mod', 120);
  const l = await ruf(z.url, 'POST', '/sampler/datei/spur', { wurzel: 'Lib', rel: 'Pad.wav' });
  assert.equal(l.code, 200);
  // a 90 s file: decoded only as far as the limit allows, then refused
  sinusWav(path.join(z.d.lib, 'lang.wav'), { sekunden: 90, rate: 8000, kanaele: 1 });
  const r = await ruf(z.url, 'POST', '/sampler/datei/spur', { wurzel: 'Lib', rel: 'lang.wav' });
  assert.deepEqual([r.code, r.j.fehler], [422, 'zu_lang']);
  assert.equal(listeSchnitte({ ordner: z.d.sampler }).length, 1);
});

test('the cut and the tone are removed when the project refuses the track', async (t) => {
  const z = await aufbau(t);
  const o = { sitzung: { aendern: async () => ({ code: 409, j: { fehler: 'rev_veraltet' } }) },
    zugang: { offen: () => ({ projekt: { werkbank: true, spuren: [], tempo_bpm: 120, rev: 1, name: 'M' }, slug: 'm' }) }, ordner: z.d.sampler, loops: z.d.loops, module: z.d.module };
  const routen = dateiRouten({ log() {}, quelle: () => 'andreas', kiGestoppt: () => false }, o);
  const post = routen.find((x) => x.methode === 'POST');
  const server = http.createServer((q, r) => { Promise.resolve(post.handler(q, r, new URL(q.url, 'http://x'))).catch(() => r.end()); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.address().port}/sampler/datei/spur`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wurzel: 'Lib', rel: 'Pad.wav' }) });
  assert.deepEqual([res.status, (await res.json()).fehler], [409, 'rev_veraltet']);
  assert.deepEqual(listeSchnitte({ ordner: z.d.sampler }), [], 'the cut is gone');
  assert.deepEqual(z.bkDateien().filter((n) => n.startsWith('ton-')), [], 'the tone graph is gone');
  assert.deepEqual(fs.readdirSync(z.d.sampler).filter((n) => n !== 'wurzeln.json'), [], 'no cut folder is left');
});
