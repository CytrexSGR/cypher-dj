import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Oberflaeche } from '../server.ts';
import { baueBestand } from './support/inventory.mjs';
import { schreibeLeerenRing, schreibeRing } from './support/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz, serverInstanzSetzen } from './support/instance.mjs';
belegeTestInstanz();   // Plan d1-s1 Task 1
// Paket S3 (Auftrag 16 b): jeder Ordner, den ein Testkörper dieser Datei anlegt (hc, loops, muster, wirt, raster, kits, welle, Hüllen, …), liegt unter
// einem tmp-Ordner dieser Datei, den after() am Ende wegräumt. Vorher blieben je Lauf 166 Einträge unter TMPDIR (gemessen 2026-10-16,
// ~/messungen/2026-10-15-d1-s3/p16b_vorher_reste.txt). Kurzer Name: Wirt-Sockets darunter bleiben unter 108 Bytes. Unter TMPDIR bleiben nur die
// Stapel-Ordner (djk60m-, eigenes t.after) und der Ordner des H2-Tests, der TMPDIR selbst vermisst.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-st-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const HIER = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HIER, '..', '..', '..');
// Prüfbestand: standardmäßig synthetisch (baueBestand), damit die Suite auf jedem Rechner ohne den lebenden
// Arbeitsbestand läuft (der gehört nicht ins Repo). CYPHERDJ_BESTAND=<ordner> lenkt auf einen echten Bestand um
// (muss die Material-ID NIGHTSHIFT und >= 14 Fassungen mit basis_bpm 128 enthalten).
const NIGHTSHIFT = '1ac28792d355a38b';
const LEBEND = process.env.CYPHERDJ_BESTAND || path.join(REPO, 'bestand');
function baueSynthetisch() {
  const dir = fs.mkdtempSync(path.join(TMP, 'djk-prueftbestand-'));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  // NIGHTSHIFT trägt die Deck-Tests (Sprünge bis ~40 Beats, Loops, Welle): 100 s; die übrigen sind kurz.
  const eintraege = [{ material_id: NIGHTSHIFT, titel: 'nightshift', frames: 48000 * 100 }];
  for (let i = 1; i < 14; i++) eintraege.push({ material_id: `5e${String(i).padStart(14, '0')}`, titel: `synthetisch-${i}`, frames: 48000 * 2 });
  return baueBestand(dir, eintraege);
}
// /strudel und die Muster-Fahrten starten djk/generator/djk-muster, das die Strudel-Pakete aus ~/strudel/packages lädt
// (INSTALL §5, optional; STRUDEL_PAKETE lenkt um). Ohne sie scheitern diese Tests mit ERR_MODULE_NOT_FOUND: übersprungen.
const STRUDEL_PAKETE = process.env.STRUDEL_PAKETE ?? path.join(os.homedir(), 'strudel', 'packages');
const OHNE_STRUDEL = fs.existsSync(path.join(STRUDEL_PAKETE, 'core')) ? false : `Strudel-Pakete fehlen (${STRUDEL_PAKETE}/core; INSTALL §5, optional)`;
const BESTAND = process.env.CYPHERDJ_BESTAND ? LEBEND : baueSynthetisch();
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

// Arbeitsbestand je Lauf in tmpfs wie im Betrieb (/dev/shm), die Attrappe liest nur dort (wie der echte Kern)
async function stapel(t, mutationen = [], { bestand = BESTAND, vorher, kernPruefmodus, zielKurve, loops, kits, welleCache, musterOrdner, hotcueOrdner, rasterOrdner, huellen, wirtOrdner, klangBefehl, echteBegruessung, digitalout, baukastenOrdner } = {}) {
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
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand, arbeitsbestand: ab, mutationen, kernPruefmodus, zielKurve, loops: loops ?? tmpd('loops'), kits: kits ?? tmpd('kits'), welleCache: welleCache ?? tmpd('welle'), musterOrdner: musterOrdner ?? tmpd('muster'), hotcueOrdner: hotcueOrdner ?? tmpd('hc'), rasterOrdner: rasterOrdner ?? tmpd('raster'), huellen: huellenPfad, wirtOrdner: wirt, klangBefehl, digitalout, baukastenOrdner: baukastenOrdner ?? tmpd('baukasten'), log: (z) => log.push(z) });
  await o.starte();
  laufend = o;
  for (let i = 0; i < 100 && o.kern.zustand !== 'verbunden'; i++) await warte(20);
  assert.equal(o.kern.zustand, 'verbunden');
  // 1.12 slice 3 (AK34): the first /k/willkommen makes the server send /k/arr/auto spur 0 an 1 (the project area ends any override of a core that kept
  // running), and since task 8 also /k/arr/arm spur 0 an 0 (plan automation-slice3 line 38: a core that kept running is disarmed). Wait for those
  // two commands and count from there, so that the tests' "0 commands" still mean: nothing happened because of the test.
  for (let i = 0; i < 100 && o.gesendet < 2; i++) await warte(20);
  const start = log.filter((z) => z.typ === 'an_kern' && z.adresse !== '/k/graph/frage').map((z) => z.adresse).sort();
  assert.deepEqual(start, ['/k/arr/arm', '/k/arr/auto'], 'the start sends exactly the release and the disarm command');
  assert.equal(o.gesendet, 2, 'the start sends exactly the release and the disarm command');
  o.gesendet = 0;
  // Die Attrappe steht auf Generation 0 und antwortet auf jedes erneute /k/hallo mit /k/willkommen 0. Tests, die einen
  // Kern-Neustart mit höherer Generation einspeisen (o.vomKern), würden das seit dem Final-Review als gebremsten Kern lesen.
  // Darum fallen echte Begrüßungen nach dem Verbinden weg; Tests speisen /k/willkommen selbst ein.
  const empfange = o.kern.empfange.bind(o.kern);
  if (!echteBegruessung) o.kern.empfange = (buf) => { if (buf.includes('/k/willkommen')) return; return empfange(buf); };
  return { o, log, ab, url: `http://127.0.0.1:${47300 + K}` };
}

function sse(url) {
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


const postJson = (url, pfad, daten) => fetch(url + pfad, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(daten) }).then(async (r) => ({ code: r.status, j: await r.json() }));
const eins = () => JSON.parse(fs.readFileSync(path.join(BESTAND, NIGHTSHIFT, 'fassungen', '128000_r1', 'fassung.json'), 'utf8')).erste_eins_quell_beat;
const deckZustand = async (o, n, pruef, ms = 3000) => {
  for (let i = 0; i < ms / 20; i++) { const z = o.stand.decks[String(n)]; if (z && pruef(z)) return z; await warte(20); }
  return o.stand.decks[String(n)];
};
const geladen = async (t, decks, extra = {}) => {
  const st = await stapel(t, [], extra);
  const s = sse(st.url);
  t.after(() => s.zu());
  for (const n of decks) {
    assert.equal((await postJson(st.url, '/laden', { deck: n, material_id: NIGHTSHIFT })).code, 200);
    for (let i = 0; i < 50 && !st.o.stand.decks[String(n)]; i++) await warte(20);
  }
  return { ...st, s };
};
// Commands sent to the core for one deck, normalised: deck number masked, clock-dependent fields dropped
const kommandos = (log, n) => log.filter((z) => z.typ === 'an_kern' && z.felder?.deck === n).map((z) => {
  const f = { ...z.felder, deck: 'N' };
  for (const k of ['id', 'ab_beat', 'start_beat', 'quell_beat', 'plan']) delete f[k];
  return { adresse: z.adresse, f };
});
async function fahre(o, url, n) {
  const e = eins();
  assert.equal((await postJson(url, '/deck/start', { deck: n, quell_beat: e })).code, 200);
  await deckZustand(o, n, (x) => x.status === 2);
  assert.equal((await postJson(url, '/deck/loop', { deck: n, laenge: 4, raster: 1 })).code, 200);
  await deckZustand(o, n, (x) => x.status === 3);
  assert.equal((await postJson(url, '/deck/loop', { deck: n, laenge: 0, raster: 1 })).code, 200);
  await deckZustand(o, n, (x) => x.status === 2);
  assert.equal((await postJson(url, '/deck/stopp', { deck: n })).code, 200);
}

test('deck 3: load, start in sync, loop and stop send the same core commands as deck 2 with the deck number changed', async (t) => {
  const { o, url, log } = await geladen(t, [2, 3]);
  await fahre(o, url, 2);
  await fahre(o, url, 3);
  const z2 = kommandos(log, 2), z3 = kommandos(log, 3);
  assert.ok(z2.length >= 5, JSON.stringify(z2.map((z) => z.adresse)));
  assert.deepEqual(z3, z2);
  assert.ok(z3.some((z) => z.adresse === '/k/deck/laden') && z3.some((z) => z.adresse === '/k/deck/start') && z3.some((z) => z.adresse === '/k/deck/loop_laenge'));
});

test('deck 3: PFL goes through the mixer path like deck 2', async (t) => {
  const { url, log } = await geladen(t, []);
  assert.equal((await postJson(url, '/regler', { pfad: 'deck/3/pfl', nach: 1 })).code, 200);
  const r = log.filter((z) => z.typ === 'an_kern').map((z) => JSON.stringify(z.felder)).join('\n');
  assert.match(r, /deck\/3\/pfl/);
});

test('deck 4 stays closed: unbekanntes_deck on load, start, stop, loop, jump, hotcue', async (t) => {
  const { url, log } = await geladen(t, []);
  const n0 = log.filter((z) => z.typ === 'an_kern').length;
  const r = [
    await postJson(url, '/laden', { deck: 4, material_id: NIGHTSHIFT }),
    await postJson(url, '/deck/start', { deck: 4 }),
    await postJson(url, '/deck/stopp', { deck: 4 }),
    await postJson(url, '/deck/loop', { deck: 4, laenge: 4, raster: 1 }),
    await postJson(url, '/deck/sprung', { deck: 4, delta: 4, raster: 1 }),
    await postJson(url, '/deck/hotcue', { deck: 4, nr: 1, aktion: 'setzen', quell_beat: 1, raster: 1 }),
  ];
  for (const x of r) { assert.equal(x.code, 400, JSON.stringify(x.j)); assert.equal(x.j.fehler, 'unbekanntes_deck'); }
  assert.equal(log.filter((z) => z.typ === 'an_kern').length, n0, 'nothing reached the core');
});

test('deck loops of 32 and 64 beats are accepted on deck 1, other lengths are still refused; deck/loop/sichern cuts 64 beats', async (t) => {
  const loops = fs.mkdtempSync(path.join(TMP, 'djk-loops-'));
  const { o, url } = await geladen(t, [1], { loops });
  const e = eins();
  assert.equal((await postJson(url, '/deck/start', { deck: 1, quell_beat: e })).code, 200);
  await deckZustand(o, 1, (x) => x.status === 2);
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 32, raster: 4 })).code, 200);
  await deckZustand(o, 1, (x) => x.status === 3);
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 3, raster: 4 })).code, 400);
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 128, raster: 4 })).code, 400);
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 64, raster: 4, behalte_start: true })).code, 200);
  await warte(100);
  const r = await postJson(url, '/deck/loop/sichern', { deck: 1 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const namen = fs.readdirSync(loops).filter((n) => !n.startsWith('.'));
  assert.equal(namen.length, 1, namen.join());
  const j = JSON.parse(fs.readFileSync(path.join(loops, namen[0], 'loop.json'), 'utf8'));
  assert.equal(j.beats, 64);
  assert.equal(j.frames, 64 * 22500);
  assert.match(namen[0], /-64b$/);
});

test('deck 3 loop is cut with the deck letter c; hotcue loop of 64 beats is accepted', async (t) => {
  const loops = fs.mkdtempSync(path.join(TMP, 'djk-loops-'));
  const { o, url } = await geladen(t, [3], { loops });
  const e = eins();
  assert.equal((await postJson(url, '/deck/sprung', { deck: 3, ziel: e + 8, raster: 0 })).code, 200);
  assert.equal((await postJson(url, '/deck/loop', { deck: 3, laenge: 8, raster: 4 })).code, 200);
  await deckZustand(o, 3, (x) => !Number.isFinite(x.beats_bis_ende));
  assert.equal((await postJson(url, '/deck/loop/sichern', { deck: 3 })).code, 200);
  assert.match(fs.readdirSync(loops).find((n) => !n.startsWith('.')), /^c-\d{6}-8b$/);
  assert.equal((await postJson(url, '/deck/hotcue', { deck: 3, nr: 2, aktion: 'setzen', quell_beat: e + 8, art: 'loop', laenge: 64, raster: 1 })).code, 200);
});

test('the state carries deck 3: /lage lists three decks and the stream relays the deck 3 state', async (t) => {
  const { o, url, s } = await geladen(t, [3]);
  await deckZustand(o, 3, (x) => x.status >= 1);
  const lage = await (await fetch(`${url}/lage`)).json();
  assert.deepEqual(lage.decks.map((d) => d.deck), [1, 2, 3]);
  const d3 = lage.decks.find((d) => d.deck === 3);
  assert.equal(d3.material_id, NIGHTSHIFT);
  assert.equal(typeof d3.offen, 'boolean');
  for (let i = 0; i < 100 && !s.ereignisse.some((x) => x.a === '/zustand/deck' && x.f.deck === 3); i++) await warte(20);
  assert.ok(s.ereignisse.some((x) => x.a === '/zustand/deck' && x.f.deck === 3), 'deck 3 state event on the stream');
});
