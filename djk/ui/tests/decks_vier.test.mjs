import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Oberflaeche } from '../server.ts';
import { K as OHR_K } from '../ear.ts';
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

// Slice 1 task 1: the page server opens deck 4 like deck 3 (decision 1) and the ear covers four decks (decision 3).
const offenMachen = async (o, url, n) => {
  assert.equal((await postJson(url, '/regler', { pfad: `deck/${n}/fader`, nach: 0, ab: 'jetzt' })).code, 200);
  for (let i = 0; i < 50 && o.stand.regler[`deck/${n}/fader`] !== 0; i++) await warte(20);
  assert.equal(o.stand.regler[`deck/${n}/fader`], 0, `fader ${n} open`);
};
const ringMitSchlag = (von, bis, bpm, { offsetMs = 5, amplitude = 0.3 } = {}) => {
  const beatMs = 60000 / bpm, n = Math.round((bis - von) * beatMs);
  return Array.from({ length: n }, (_, i) => {
    const beat = von + i / beatMs, phaseMs = (beat - Math.round(beat)) * beatMs;
    const dt = ((phaseMs - offsetMs) % beatMs + beatMs) % beatMs, v = 1e-4 + amplitude * Math.exp(-dt / 20);
    return { sample: i, beat, quell: NaN, band: [v, v, v, v, v, v], k: 1e-3, spitze: 0.2 };
  });
};

test('deck 4: load, start in sync, loop and stop send the same core commands as deck 2 with the deck number changed', async (t) => {
  const { o, url, log } = await geladen(t, [2, 4]);
  await fahre(o, url, 2);
  await fahre(o, url, 4);
  const z2 = kommandos(log, 2), z4 = kommandos(log, 4);
  assert.ok(z2.length >= 5, JSON.stringify(z2.map((z) => z.adresse)));
  assert.deepEqual(z4, z2);
  assert.ok(z4.some((z) => z.adresse === '/k/deck/laden') && z4.some((z) => z.adresse === '/k/deck/start') && z4.some((z) => z.adresse === '/k/deck/loop_laenge'));
});

test('deck 4: jump, hotcue and PFL send the same core commands as deck 3; the loop cut is named d-...', async (t) => {
  const { o, url, log } = await geladen(t, [3, 4], { loops: fs.mkdtempSync(path.join(TMP, 'djk-loops-')) });
  for (const n of [3, 4]) {
    assert.equal((await postJson(url, '/deck/start', { deck: n, quell_beat: eins() })).code, 200);
    await deckZustand(o, n, (x) => x.status === 2);
    assert.equal((await postJson(url, '/deck/sprung', { deck: n, delta: 4, raster: 1 })).code, 200, `sprung ${n}`);
    assert.equal((await postJson(url, '/deck/hotcue', { deck: n, nr: 1, aktion: 'setzen', quell_beat: eins() + 8, raster: 1 })).code, 200, `hotcue ${n}`);
    assert.equal((await postJson(url, '/regler', { pfad: `deck/${n}/pfl`, nach: 1 })).code, 200);
  }
  assert.deepEqual(kommandos(log, 4), kommandos(log, 3));
  assert.match(log.filter((z) => z.typ === 'an_kern').map((z) => JSON.stringify(z.felder)).join('\n'), /deck\/4\/pfl/);
  assert.equal((await postJson(url, '/deck/loop', { deck: 4, laenge: 4, raster: 1 })).code, 200);
  await deckZustand(o, 4, (x) => x.status === 3);
  const s = await postJson(url, '/deck/loop/sichern', { deck: 4 });
  assert.equal(s.code, 200, JSON.stringify(s.j));
  assert.match(JSON.stringify(s.j), /d-\d{6}-4b/);
});

test('deck 5 is refused: unbekanntes_deck on load, start, stop, loop, jump, hotcue, scrub; nothing reaches the core', async (t) => {
  const { url, log } = await geladen(t, []);
  const n0 = log.filter((z) => z.typ === 'an_kern').length;
  const r = [
    await postJson(url, '/laden', { deck: 5, material_id: NIGHTSHIFT }),
    await postJson(url, '/deck/start', { deck: 5 }),
    await postJson(url, '/deck/stopp', { deck: 5 }),
    await postJson(url, '/deck/loop', { deck: 5, laenge: 4, raster: 1 }),
    await postJson(url, '/deck/sprung', { deck: 5, delta: 4, raster: 1 }),
    await postJson(url, '/deck/hotcue', { deck: 5, nr: 1, aktion: 'setzen', quell_beat: 1, raster: 1 }),
    await postJson(url, '/deck/scrub', { deck: 5, phase: 1, delta: 0 }),
  ];
  for (const x of r) { assert.equal(x.code, 400, JSON.stringify(x.j)); assert.equal(x.j.fehler, 'unbekanntes_deck'); }
  assert.equal(log.filter((z) => z.typ === 'an_kern').length, n0, 'nothing reached the core');
});

test('/lage carries four decks, a loaded deck 4 with its state', async (t) => {
  const { url } = await geladen(t, [4]);
  const j = await (await fetch(url + '/lage')).json();
  assert.deepEqual(j.decks.map((d) => d.deck), [1, 2, 3, 4]);
  assert.equal(j.decks[3].material_id, NIGHTSHIFT);
  assert.equal(j.decks[2].status, 0);
});

test('/hoeren: deck 3 and deck 4 read ring index 2 and 3 (the ear reader holds all four channels)', async (t) => {
  const ringPfad = path.join(fs.mkdtempSync(path.join(TMP, 'djk-huellen-vier-')), 'huellen');
  const { o, url } = await geladen(t, [3, 4], { huellen: ringPfad });
  const u = o.kern.uhr;
  const laut = ringMitSchlag(u.beat - 8, u.beat + 8, u.bpm, { amplitude: 0.3 }), leise = ringMitSchlag(u.beat - 8, u.beat + 8, u.bpm, { amplitude: 0.003 });
  // index 2 is loud, index 3 is quiet: each deck reports the level of its own channel
  schreibeRing(ringPfad, { [OHR_K.deck3]: laut, [OHR_K.deck4]: leise, [OHR_K.master]: laut });
  await warte(250);
  const hoere = async (n) => { const r = await fetch(url + `/hoeren?deck=${n}&takte=1`); assert.equal(r.status, 200, JSON.stringify(await r.clone().json())); return (await r.json()).vergleich.neu; };
  const n3 = await hoere(3), n4 = await hoere(4);
  assert.ok(n3.baender_db[3] > -100 && n4.baender_db[3] > -100, JSON.stringify([n3, n4]));
  assert.ok(n3.baender_db[3] > n4.baender_db[3] + 20, `deck 3 reads index 2, deck 4 index 3: ${n3.baender_db[3]} vs ${n4.baender_db[3]}`);
  assert.equal((await fetch(url + '/hoeren?deck=5&takte=1')).status, 400);
});

test('/hoeren?deck=1: the partner is deck 3 while deck 2 is stopped and deck 3 runs open; a closed deck 3 is no partner', async (t) => {
  const ringPfad = path.join(fs.mkdtempSync(path.join(TMP, 'djk-huellen-partner-')), 'huellen');
  const { o, url } = await geladen(t, [1, 3], { huellen: ringPfad });
  for (const n of [1, 3]) {
    assert.equal((await postJson(url, '/deck/start', { deck: n })).code, 200);
    await deckZustand(o, n, (x) => Number(x.status) >= 2);
  }
  const u = o.kern.uhr;
  schreibeRing(ringPfad, { [OHR_K.deck1]: ringMitSchlag(u.beat - 8, u.beat + 8, u.bpm, { offsetMs: 5 }),
    [OHR_K.deck3]: ringMitSchlag(u.beat - 8, u.beat + 8, u.bpm, { offsetMs: 11 }), [OHR_K.master]: ringMitSchlag(u.beat - 8, u.beat + 8, u.bpm) });
  await warte(250);
  const zu = await (await fetch(url + '/hoeren?deck=1&takte=1')).json();
  assert.equal(zu.sync.deck_gegen_deck_ms, null, JSON.stringify(zu.sync));
  await offenMachen(o, url, 3);
  const auf = await (await fetch(url + '/hoeren?deck=1&takte=1')).json();
  assert.ok(Number.isFinite(auf.sync.deck_gegen_deck_ms), JSON.stringify(auf.sync));
  assert.ok(Math.abs(auf.sync.deck_gegen_deck_ms) > 3, `measured against deck 3: ${auf.sync.deck_gegen_deck_ms}`);
});

test('hoerscheinTakt: decks 3 and 4 get certificates like 1 and 2', async (t) => {
  const ringPfad = path.join(fs.mkdtempSync(path.join(TMP, 'djk-huellen-schein-')), 'huellen');
  const { o, url } = await geladen(t, [3, 4], { huellen: ringPfad });
  for (const n of [3, 4]) {
    assert.equal((await postJson(url, '/deck/start', { deck: n })).code, 200);
    await deckZustand(o, n, (x) => Number(x.status) >= 2);
  }
  const u = o.kern.uhr;
  const d = ringMitSchlag(u.beat - 40, u.beat + 40, u.bpm);
  schreibeRing(ringPfad, { [OHR_K.deck3]: d, [OHR_K.deck4]: d, [OHR_K.master]: d });
  await warte(250);
  o.hoerscheinLetzterTakt = -1;
  o.hoerscheinTakt();
  assert.ok(o.hoerscheinstelle.letzter(3), 'certificate for deck 3');
  assert.ok(o.hoerscheinstelle.letzter(4), 'certificate for deck 4');
});

// Slice 1 review: the gate of /regler took hearing certificates for deck 1 and 2 only (server.ts /^(deck\/[12])\//), so Cypher never opened deck 3 or 4
test('/regler gate: a valid hearing certificate opens deck 3 and 4 for Cypher like deck 1 (no certificate stays kein_hoerschein)', async (t) => {
  const { o, url, log } = await geladen(t, [1, 3, 4]);
  const cypher = (pfad, nach) => fetch(url + '/regler', { method: 'POST', headers: { 'content-type': 'application/json', 'x-djk-quelle': 'cypher' },
    body: JSON.stringify({ pfad, nach, takte: 0 }) }).then(async (r) => ({ code: r.status, j: await r.json() }));
  for (const n of [1, 3, 4]) {                                                    // without a certificate: refused, for every deck
    const r = await cypher(`deck/${n}/fader`, 0);
    assert.deepEqual([r.code, r.j.fehler], [409, 'kein_hoerschein'], `deck ${n} without a certificate`);
  }
  const schein = (n) => ({ hs_id: `ohr-${n}-testschein`, kanal: `deck/${n}`, inhalt: `${NIGHTSHIFT}/128000_r1`, deck: n, bpm: 128,
    gemessen_von_beat: 0, gemessen_bis_beat: 16, gueltig_bis_beat: 1e9, quell_von: 0, quell_bis: 16, erneuerung: 0,
    sync_ms: 0, deck_gegen_deck_ms: 0, lufs_kurz: -20, pegel_diff_db: 0, baender_db: [-20, -20, -20, -20, -20, -20], urteil: 'ok', gruende: [],
    laufend_baender_db: [-20, -20, -20, -20, -20, -20], ueberdeckung: { sub: 0, tief: 0, tiefmitte: 0, mitte: 0, praesenz: 0, hoch: 0 },
    summe_spitze_db: -6, clip_anteil: 0, eq_vorschlag: { tief: 0, mitte: 0, hoch: 0 } });
  for (const n of [1, 3, 4]) {
    o.hoerscheine[`deck/${n}`] = schein(n);
    const r = await cypher(`deck/${n}/fader`, 0);
    assert.equal(r.code, 200, `deck ${n} with a valid certificate: ${JSON.stringify(r.j)}`);
    const teil = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil' && z.felder.pfad === `deck/${n}/fader`).at(-1);
    assert.equal(teil.felder.hoerschein, `ohr-${n}-testschein`, `the command of deck ${n} carries its certificate`);
  }
});

test('master key (masterTonart) iterates deck 4 too', async (t) => {
  const { o, url } = await geladen(t, [4]);
  assert.equal((await postJson(url, '/deck/start', { deck: 4 })).code, 200);
  await deckZustand(o, 4, (x) => Number(x.status) >= 2);
  assert.deepEqual(o.masterTonart(), { code: 409, fehler: 'kein_deck' }, 'closed channel: no key');
  await offenMachen(o, url, 4);
  assert.equal(o.masterTonart().deck, 4);
});
