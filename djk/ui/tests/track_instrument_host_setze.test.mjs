// Plan 2026-11-26 strand 11, task 2.2: set moves on discrete wirt: targets and `klang setze` with ab, against a fake wirt socket.
// Server plus core mock like track_loop.test.mjs (reduced); the fake wirt only records the one-line JSON commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './support/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz, serverInstanzSetzen } from './support/instance.mjs';
import { pruefeWirtOrdner } from './support/instrument_host_sock.mjs';
import { pruefeSpur, plane, beatZuMono } from '../track.ts';

belegeTestInstanz();
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-sl-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const CYPHER = { 'x-djk-quelle': 'cypher' };
const postJson = (url, pfad, daten, kopf = {}) => fetch(url + pfad, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf },
  body: JSON.stringify(daten) }).then(async (r) => ({ code: r.status, j: await r.json() }));
const liste = async (url) => (await fetch(`${url}/spur`)).json();

// Server plus core mock, like stapel() in server.test.mjs (reduced). Every log line carries the core beat the server saw when it was written
// (`_beat`), so a test can tell whether a part was sent before its start.
async function stapel(t, { wirtOrdner } = {}) {
  const tmp = fs.mkdtempSync(path.join(TMP, 'st-'));
  const tmpd = (n) => fs.mkdtempSync(path.join(tmp, `${n}-`));
  const ab = path.join(fs.mkdtempSync('/dev/shm/djk-sl-test-'), 'material');
  fs.mkdirSync(ab, { recursive: true });
  const konfig = path.join(tmp, 'kern.toml');
  fs.writeFileSync(konfig, `arr_ordner = ${JSON.stringify(path.join(tmp, 'arr'))}\n`);
  const att = spawn(process.execPath, [path.join(REPO, 'djk/contract/mock_core.mjs'), '--frisch', '--arbeitsbestand', ab, '--konfig', konfig,
    '--zustand', path.join(tmp, 'zustand.json')], { env: { ...process.env, CYPHERDJ_INSTANZ: TEST_INSTANZ }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, f) => { att.stdout.once('data', ok); att.once('exit', (c) => f(new Error(`attrappe rc ${c}`))); });
  let laufend = null;
  t.after(async () => {
    if (laufend) await laufend.stoppe();
    if (att.exitCode === null && att.signalCode === null) { const zu = new Promise((r) => att.once('exit', r)); att.kill('SIGTERM'); await zu; }
    fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(path.dirname(ab), { recursive: true, force: true });
  });
  const log = [];
  const huellen = path.join(tmpd('huellen'), 'huellen'); schreibeLeerenRing(huellen);
  serverInstanzSetzen(t);
  let o = null;
  o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmpd('bestand'), arbeitsbestand: ab,
    mutationen: [], loops: tmpd('loops'), kits: tmpd('kits'), welleCache: tmpd('welle'), musterOrdner: tmpd('muster'), hotcueOrdner: tmpd('hc'),
    rasterOrdner: tmpd('raster'), huellen, wirtOrdner: wirtOrdner ?? tmpd('wirt'), baukastenOrdner: tmpd('baukasten'),
    log: (z) => log.push({ ...z, _beat: o?.kern.uhr?.beat ?? null }) });
  await o.starte();
  laufend = o;
  for (let i = 0; i < 100 && o.kern.zustand !== 'verbunden'; i++) await warte(20);
  assert.equal(o.kern.zustand, 'verbunden');
  for (let i = 0; i < 100 && !o.kern.uhr; i++) await warte(20);
  return { o, log, url: `http://127.0.0.1:${47300 + K}` };
}


async function fakeWirt(t, ordner, gruppe, antwort = () => ({ ok: true })) {
  pruefeWirtOrdner(ordner);
  const zeilen = [];
  const srv = net.createServer((c) => {
    let d = '';
    c.on('data', (b) => {
      d += b;
      if (!d.endsWith('\n')) return;
      const z = JSON.parse(d); zeilen.push(z);
      if (!c.destroyed) c.end(JSON.stringify(antwort(z)) + '\n');
    });
    c.on('error', () => {});
  });
  await new Promise((ok) => srv.listen(path.join(ordner, `wirt-${gruppe}.sock`), ok));
  t.after(() => srv.close());
  return zeilen;
}
const kurz = () => fs.mkdtempSync(path.join('/tmp', 'sz-'));
const FAHRBAR = new Set(['a_filter1_cutoff']);
const setzSpur = (name, extra = {}) => ({ name, fahrten: [{ ziel: 'wirt:bass/a_ws_type', ab_takt: 2, nach: 3, ...extra }] });

test('pruefeSpur: a discrete wirt target takes a set; ramp, von, form and loop are refused with the old text', () => {
  assert.ok('spur' in pruefeSpur(setzSpur('s'), FAHRBAR));
  assert.ok('spur' in pruefeSpur(setzSpur('s', { takte: 0 }), FAHRBAR));
  for (const extra of [{ takte: 2 }, { von: 1 }, { form: 's' }]) {
    const r = pruefeSpur(setzSpur('s', extra), FAHRBAR);
    assert.match(r.fehler, /a_ws_type is not a continuous Surge parameter/, JSON.stringify(extra));
  }
  const schl = pruefeSpur({ ...setzSpur('s', { ab_takt: 1 }), schleife_takte: 2 }, FAHRBAR);
  assert.match(schl.fehler, /not a continuous/);
  assert.match(pruefeSpur({ name: 's', fahrten: [{ ziel: 'wirt:bass/a_ws_type', ab_takt: 1 }] }, FAHRBAR).fehler, /nach: number expected/);
});

test('plane: discrete sets land in setzen, sets of one host at one beat travel together; without fahrbar nothing changes', () => {
  const spur = { name: 's', fahrten: [
    { ziel: 'wirt:bass/a_ws_type', ab_takt: 2, nach: 3 }, { ziel: 'wirt:bass/a_filter1_type', ab_takt: 2, nach: 1 },
    { ziel: 'wirt:melodie/a_ws_type', ab_takt: 2, nach: 2 }, { ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1, nach: 0.5, takte: 1 }] };
  const g = plane(spur, 8, 4, FAHRBAR);
  assert.deepEqual(g.setzen, [{ gruppe: 'bass', ab_beat: 12, werte: { a_ws_type: 3, a_filter1_type: 1 } }, { gruppe: 'melodie', ab_beat: 12, werte: { a_ws_type: 2 } }]);
  assert.equal(g.wirt.length, 1);
  assert.equal(plane(spur, 8, 4).setzen, undefined);
});

test('spur: a set on wirt:bass/a_ws_type at bar 2 reaches the wirt as setze with the mono time of that beat; a ramp on it is 400; spur_stopp sends halte', async (t) => {
  const wo = kurz(); t.after(() => fs.rmSync(wo, { recursive: true, force: true }));
  const { o, url } = await stapel(t, { wirtOrdner: wo });
  const zeilen = await fakeWirt(t, wo, 'bass');
  const rampe = await postJson(url, '/spur', { spur: setzSpur('rampe', { takte: 1 }) });
  assert.equal(rampe.code, 400, JSON.stringify(rampe.j));
  assert.match(rampe.j.text, /is not a continuous Surge parameter/);
  assert.equal(zeilen.length, 0, 'a refused ramp sends nothing');
  const r = await postJson(url, '/spur', { spur: setzSpur('einsatz') });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const setze = zeilen.filter((z) => z.befehl === 'setze');
  assert.equal(setze.length, 1, JSON.stringify(zeilen));
  assert.deepEqual(setze[0].werte, { a_ws_type: 3 });
  assert.equal(setze[0].spur, 'einsatz');
  const u = o.kern.uhr;
  const soll = beatZuMono(u, r.j.anker_beat + 4);   // bar 2 = anchor + one bar
  assert.ok(Math.abs(setze[0].ab - soll) < 0.2, `ab ${setze[0].ab} vs ${soll}`);
  assert.equal((await postJson(url, '/spur/stopp', { name: 'einsatz' })).code, 200);
  assert.ok(zeilen.some((z) => z.befehl === 'halte' && z.spur === 'einsatz'), JSON.stringify(zeilen));
});

test('spur: a wirt that refuses the set (unknown parameter) fails the start with 409 and leaves no running track', async (t) => {
  const wo = kurz(); t.after(() => fs.rmSync(wo, { recursive: true, force: true }));
  const { url } = await stapel(t, { wirtOrdner: wo });
  await fakeWirt(t, wo, 'bass', (z) => (z.befehl === 'setze' ? { ok: false, fehler: 'unbekannter Parameter' } : { ok: true }));
  const r = await postJson(url, '/spur', { spur: setzSpur('nein') });
  assert.equal(r.code, 409, JSON.stringify(r.j));
  assert.equal(r.j.fehler, 'wirt');
  assert.deepEqual(await (await fetch(`${url}/spur`)).json(), []);
});

test('klang setze with ab: takt sends one host setze, no djk-klang spawn; ab_beat is taken as is; a bad ab or ab_beat is 400', async (t) => {
  const wo = kurz(); t.after(() => fs.rmSync(wo, { recursive: true, force: true }));
  const { o, url } = await stapel(t, { wirtOrdner: wo });
  const zeilen = await fakeWirt(t, wo, 'bass');
  const r = await postJson(url, '/klang', { aktion: 'setze', gruppe: 'bass', werte: { a_ws_type: 3 }, ab: 'takt' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(zeilen.length, 1);
  assert.equal(zeilen[0].befehl, 'setze'); assert.deepEqual(zeilen[0].werte, { a_ws_type: 3 }); assert.equal(zeilen[0].spur, 'klang-bass');
  assert.equal(r.j.ab_beat % 4, 0, 'on a bar line');
  assert.equal(r.j.ab_takt, r.j.ab_beat / 4 + 1);
  assert.ok(Math.abs(zeilen[0].ab - beatZuMono(o.kern.uhr, r.j.ab_beat)) < 0.2);
  const b = await postJson(url, '/klang', { aktion: 'setze', gruppe: 'bass', werte: { a_ws_type: 1 }, ab_beat: 400 });
  assert.equal(b.code, 200, JSON.stringify(b.j)); assert.equal(b.j.ab_beat, 400); assert.equal(b.j.ab_takt, 101);
  assert.equal((await postJson(url, '/klang', { aktion: 'setze', gruppe: 'bass', werte: { a_ws_type: 1 }, ab: 'bald' })).code, 400);
  assert.equal((await postJson(url, '/klang', { aktion: 'setze', gruppe: 'bass', werte: { a_ws_type: 1 }, ab_beat: 'x' })).code, 400);
  assert.equal(zeilen.length, 2, 'refused requests send nothing');
});

test('klang setze with ab: Stop Cypher holds it for Cypher', async (t) => {
  const wo = kurz(); t.after(() => fs.rmSync(wo, { recursive: true, force: true }));
  const { o, url } = await stapel(t, { wirtOrdner: wo });
  const zeilen = await fakeWirt(t, wo, 'bass');
  o.handBremse = true;   // strand 9: kiGestoppt is a getter (core flag or hand brake)
  const r = await postJson(url, '/klang', { aktion: 'setze', gruppe: 'bass', werte: { a_ws_type: 3 }, ab: 'takt' }, CYPHER);
  assert.equal(r.code, 409, JSON.stringify(r.j)); assert.equal(r.j.fehler, 'ki_gestoppt');
  assert.equal(zeilen.length, 0);
});
