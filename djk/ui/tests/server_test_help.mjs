// Shared setup of the page-server tests (server_*.test.mjs): test instance, temp folder, test stack (stapel), SSE and POST helpers.
// Split out of the former server.test.mjs; every test file imports it and keeps its own cleanup of TMP (see the after() in each file).
import assert from 'node:assert/strict';
import { Oberflaeche } from '../server.ts';
import { baueBestand } from './support/inventory.mjs';
import { schreibeLeerenRing } from './support/ring.mjs';
import { K as OHR_K } from '../ear.ts';
import { K, TEST_INSTANZ, belegeTestInstanz, serverInstanzSetzen } from './support/instance.mjs';
import { pruefeWirtOrdner } from './support/instrument_host_sock.mjs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
belegeTestInstanz();   // Plan d1-s1 Task 1
// Paket S3 (Auftrag 16 b): jeder Ordner, den ein Testkörper dieser Datei anlegt (hc, loops, muster, wirt, raster, kits, welle, Hüllen, …), liegt unter
// einem tmp-Ordner dieser Datei, den after() am Ende wegräumt. Vorher blieben je Lauf 166 Einträge unter TMPDIR (gemessen 2026-10-16,
// ~/messungen/2026-10-15-d1-s3/p16b_vorher_reste.txt). Kurzer Name: Wirt-Sockets darunter bleiben unter 108 Bytes. Unter TMPDIR bleiben nur die
// Stapel-Ordner (djk60m-, eigenes t.after) und der Ordner des H2-Tests, der TMPDIR selbst vermisst.
export const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-st-'));
export const K1 = OHR_K.deck1, K2 = OHR_K.deck2, KMASTER = OHR_K.master;

export const HIER = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HIER, '..', '..', '..');
// Prüfbestand: standardmäßig synthetisch (baueBestand), damit die Suite auf jedem Rechner ohne den lebenden
// Arbeitsbestand läuft (der gehört nicht ins Repo). CYPHERDJ_BESTAND=<ordner> lenkt auf einen echten Bestand um
// (muss die Material-ID NIGHTSHIFT und >= 14 Fassungen mit basis_bpm 128 enthalten).
export const NIGHTSHIFT = '1ac28792d355a38b';
export const LEBEND = process.env.CYPHERDJ_BESTAND || path.join(REPO, 'bestand');
export function baueSynthetisch() {
  const dir = fs.mkdtempSync(path.join(TMP, 'djk-prueftbestand-'));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  // NIGHTSHIFT trägt die Deck-Tests (Sprünge bis ~40 Beats, Loops, Welle): 100 s; die übrigen sind kurz.
  const eintraege = [{ material_id: NIGHTSHIFT, titel: 'nightshift', frames: 48000 * 100 }];
  for (let i = 1; i < 14; i++) eintraege.push({ material_id: `5e${String(i).padStart(14, '0')}`, titel: `synthetisch-${i}`, frames: 48000 * 2 });
  return baueBestand(dir, eintraege);
}
// /strudel und die Muster-Fahrten starten djk/generator/djk-muster, das die Strudel-Pakete aus ~/strudel/packages lädt
// (INSTALL §5, optional; STRUDEL_PAKETE lenkt um). Ohne sie scheitern diese Tests mit ERR_MODULE_NOT_FOUND: übersprungen.
export const STRUDEL_PAKETE = process.env.STRUDEL_PAKETE ?? path.join(os.homedir(), 'strudel', 'packages');
export const OHNE_STRUDEL = fs.existsSync(path.join(STRUDEL_PAKETE, 'core')) ? false : `Strudel-Pakete fehlen (${STRUDEL_PAKETE}/core; INSTALL §5, optional)`;
export const BESTAND = process.env.CYPHERDJ_BESTAND ? LEBEND : baueSynthetisch();
export const warte = (ms) => new Promise((r) => setTimeout(r, ms));

// Arbeitsbestand je Lauf in tmpfs wie im Betrieb (/dev/shm), die Attrappe liest nur dort (wie der echte Kern)
// Strom tracks of the open live project (container core): the erz/<n> alias vocabulary of the old strips resolves onto them
export async function stromSpuren(o, ...stroeme) {
  for (const strom of stroeme) {
    const r = await o.proj.sitzung.aendern({ rev: o.proj.zugang.offen().projekt.rev, label: `track ${strom}`, befehle: [{ befehl: 'strom_spur_neu', strom }] }, 'andreas');
    assert.equal(r.code, 200, JSON.stringify(r.j));
  }
}

export async function stapel(t, mutationen = [], { bestand = BESTAND, vorher, kernPruefmodus, zielKurve, loops, kits, welleCache, musterOrdner, hotcueOrdner, rasterOrdner, huellen, wirtOrdner, klangBefehl, echteBegruessung, digitalout, baukastenOrdner, live } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk60m-'));
  // V2 Fix-Runde 2 H2 (Spec 6.33, Muster tests/support/media_library.mjs): Hüllen und alle Vorgabe-Ordner (loops, kits, welle, muster, hc, raster, wirt) im
  // eigenen tmp-Ordner des Stapels, den t.after wegräumt; vorher lagen sie direkt unter TMPDIR und blieben je Stapel liegen. Übergebene Ordner bleiben.
  const tmpd = (n) => fs.mkdtempSync(path.join(tmp, `djk-${n}-`));
  const wirt = wirtOrdner ?? tmpd('wirt');
  const ab = path.join(fs.mkdtempSync('/dev/shm/djk60m-test-'), 'material');
  fs.mkdirSync(ab, { recursive: true });
  vorher?.(ab);
  // Paket S3 (Auftrag 16 a, Muster der Leitstand-Tests aus K3): eigene kern.toml im tmp-Ordner, sonst liest die Attrappe die echte
  // ~/.config/cypherdj-<i>/kern.toml (ein unbekannter Schlüssel dort ließe jeden Stapel mit rc 2 scheitern); arr_ordner bleibt im tmp-Ordner.
  const konfig = path.join(tmp, 'kern.toml');
  fs.writeFileSync(konfig, `arr_ordner = ${JSON.stringify(path.join(tmp, 'arr'))}\n`);
  const att = spawn(process.execPath, [path.join(REPO, 'djk/contract/mock_core.mjs'), '--frisch', '--arbeitsbestand', ab, '--konfig', konfig,
    '--zustand', path.join(tmp, 'zustand.json')], { env: { ...process.env, CYPHERDJ_INSTANZ: TEST_INSTANZ }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, f) => { att.stdout.once('data', ok); att.once('exit', (c) => f(new Error(`attrappe rc ${c}`))); });
  let laufend = null;   // Plan d1-s1 Task 1: erst nach gelungenem starte() gesetzt; Attrappe und Ordner räumen auch, wenn der Start scheitert
  t.after(async () => {
    if (laufend) await laufend.stoppe();
    if (att.exitCode === null && att.signalCode === null) { const zu = new Promise((r) => att.once('exit', r)); att.kill('SIGTERM'); await zu; }
    fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(path.dirname(ab), { recursive: true, force: true });
  });
  const log = [];
  const huellenPfad = huellen ?? (() => { const p = path.join(tmpd('huellen'), 'huellen'); schreibeLeerenRing(p); return p; })();
  serverInstanzSetzen(t);   // I08 Nachzug R2 (m4)
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand, arbeitsbestand: ab, mutationen, kernPruefmodus, zielKurve, loops: loops ?? tmpd('loops'), kits: kits ?? tmpd('kits'), welleCache: welleCache ?? tmpd('welle'), musterOrdner: musterOrdner ?? tmpd('muster'), hotcueOrdner: hotcueOrdner ?? tmpd('hc'), rasterOrdner: rasterOrdner ?? tmpd('raster'), huellen: huellenPfad, wirtOrdner: wirt, klangBefehl, digitalout, baukastenOrdner: baukastenOrdner ?? tmpd('baukasten'),
    // live: an own project folder (the instance's live container stays untouched); the live project is opened at the end of the stapel
    ...(live ? { proj: { wurzel: path.join(tmpd('projekte'), 'projekte'), arbeitsordner: path.join(tmp, 'arr') } } : {}), log: (z) => log.push(z) });
  await o.starte();
  laufend = o;
  for (let i = 0; i < 100 && o.kern.zustand !== 'verbunden'; i++) await warte(20);
  assert.equal(o.kern.zustand, 'verbunden');
  // 1.12 slice 3 (AK34): the first /k/willkommen makes the server send /k/arr/auto spur 0 an 1 (the project area ends any override of a core that kept
  // running), and since task 8 also /k/arr/arm spur 0 an 0 (plan automation-slice3 line 38: a core that kept running is disarmed). Wait for those
  // two commands and count from there, so that the tests' "0 commands" still mean: nothing happened because of the test.
  for (let i = 0; i < 100 && o.gesendet < 2; i++) await warte(20);
  // The first /uhr tick of the stand-in may still be on its way when the connection is up (and under load it is: "keine_uhr" 409 from POST /spur in
  // Studio S6 T2, 77 ms into the test, seen 2026-11-16). Every handler that anchors on the core beat answers keine_uhr without it, so wait for it here.
  for (let i = 0; i < 150 && !o.kern.uhr; i++) await warte(20);
  const start = log.filter((z) => z.typ === 'an_kern' && z.adresse !== '/k/graph/frage').map((z) => z.adresse).sort();
  assert.deepEqual(start, ['/k/arr/arm', '/k/arr/auto'], 'the start sends exactly the release and the disarm command');
  assert.equal(o.gesendet, 2, 'the start sends exactly the release and the disarm command');
  o.gesendet = 0;
  // Die Attrappe steht auf Generation 0 und antwortet auf jedes erneute /k/hallo mit /k/willkommen 0. Tests, die einen
  // Kern-Neustart mit höherer Generation einspeisen (o.vomKern), würden das seit dem Final-Review als gebremsten Kern lesen.
  // Darum fallen echte Begrüßungen nach dem Verbinden weg; Tests speisen /k/willkommen selbst ein.
  const empfange = o.kern.empfange.bind(o.kern);
  if (!echteBegruessung) o.kern.empfange = (buf) => { if (buf.includes('/k/willkommen')) return; return empfange(buf); };
  // container core M6: POST /strudel needs the strudel module of an open live project (a new live project places it in place 3)
  if (live) { const r = await o.proj.sitzung.liveOeffnen('andreas'); assert.equal(r.code, 200, JSON.stringify(r.j)); }
  return { o, log, ab, url: `http://127.0.0.1:${47300 + K}` };
}

export function sse(url) {
  const ereignisse = [];
  const ac = new AbortController();
  (async () => {
    const r = await fetch(`${url}/strom`, { signal: ac.signal });
    const dec = new TextDecoder();
    let puffer = '';
    for await (const teil of r.body) {
      puffer += dec.decode(teil, { stream: true });
      let i;
      while ((i = puffer.indexOf('\n\n')) >= 0) { ereignisse.push(JSON.parse(puffer.slice(6, i))); puffer = puffer.slice(i + 2); }
    }
  })().catch(() => {});
  return { ereignisse, zu: () => ac.abort() };
}

export const post = (url, pfad, daten) => fetch(url + pfad, { method: 'POST', body: JSON.stringify(daten) }).then(async (r) => ({ code: r.status, j: await r.json() }));

// Plan 2: JSON-Post wie die Seite (content-type json, gleiche Herkunft oder ohne Origin)
export const postJson = (url, pfad, daten, kopf = {}) => fetch(url + pfad, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf },
  body: JSON.stringify(daten) }).then(async (r) => ({ code: r.status, j: await r.json() }));
// ---------- Plan E9: Deck-Bedienung gegen die Attrappe (sie setzt sprung, hotcue, loop nach Vertrag um) ----------
export async function geladenesDeck(t, extra = {}) {
  const hc = fs.mkdtempSync(path.join(TMP, 'djk-hc-'));
  const st = await stapel(t, [], { hotcueOrdner: hc, ...extra });
  const s = sse(st.url);
  t.after(() => s.zu());
  assert.equal((await postJson(st.url, '/laden', { deck: 1, material_id: NIGHTSHIFT })).code, 200);
  for (let i = 0; i < 50 && !st.o.stand.decks['1']; i++) await warte(20);
  return { ...st, s, hc };
}
export const zustand = async (o, pruef, ms = 3000) => {
  for (let i = 0; i < ms / 20; i++) { const z = o.stand.decks['1']; if (z && pruef(z)) return z; await warte(20); }
  return o.stand.decks['1'];
};
export const eins = () => JSON.parse(fs.readFileSync(path.join(BESTAND, NIGHTSHIFT, 'fassungen', '128000_r1', 'fassung.json'), 'utf8')).erste_eins_quell_beat;
// Plan Hand (2026-09-28): Quelle je Anfrage. Kopf x-djk-quelle: cypher → jeder Kern-Befehl dieser Anfrage trägt cypher;
// ohne Kopf andreas; die Hand (/griff, /taste) bleibt Andreas.
export const CYPHER = { 'x-djk-quelle': 'cypher' };
export const bis = async (f, ms = 2000) => { for (let i = 0; i < ms / 20 && !(await f()); i++) await warte(20); };
// V2 Fix-Runde 2 H4: hier entstehen die Wirt-Sockets der Tests. Ist der längste Socket-Pfad des Ordners länger als sun_path (107 Bytes, zu langer
// TMPDIR), bricht der Test mit einer Meldung ab, die TMPDIR und die Länge nennt, statt mit EADDRINUSE oder einem Socket, der zum Nachbarn wird.
// Geprüft wird nur, wo Sockets gebunden werden: der Vorgabe-Wirt-Ordner des Stapels (seit H2 eine Ebene tiefer) hat keine und bleibt ungeprüft.
export async function fakeWirt(t, ordner, gruppe, antwort = { ok: true }) {
  pruefeWirtOrdner(ordner);
  const zeilen = [];
  const srv = net.createServer((c) => {
    let d = '';
    c.on('data', (b) => { d += b; if (d.endsWith('\n')) { zeilen.push(JSON.parse(d)); c.end(JSON.stringify(antwort) + '\n'); } });
  });
  await new Promise((ok) => srv.listen(path.join(ordner, `wirt-${gruppe}.sock`), ok));
  t.after(() => srv.close());
  return zeilen;
}
// Final-Review F2: zweiter Seiten-Server mit denselben Optionen (Ordner) nach dem Stopp des ersten
export async function neustart(t, o) {
  await o.stoppe();
  const log = [];
  const o2 = new Oberflaeche({ ...o.opt, log: (z) => log.push(z) });
  await o2.starte();
  for (let i = 0; i < 100 && o2.kern.zustand !== 'verbunden'; i++) await warte(20);
  assert.equal(o2.kern.zustand, 'verbunden');
  for (let i = 0; i < 100 && !o2.kern.uhr; i++) await warte(20);
  t.after(() => o2.stoppe());
  if (o2.opt.proj) { const r = await o2.proj.sitzung.liveOeffnen('andreas'); assert.equal(r.code, 200, JSON.stringify(r.j)); }   // the live project (and its strom tracks) is back
  return { o2, log };
}
