// Page server against the core stand-in: deck operation (jump, hotcue, loop, grid), hand sources, hearing (Ohr) and FX routing. Moved from server.test.mjs.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { leseBestand } from '../server.ts';
import { baueBestand } from './support/inventory.mjs';
import { schreibeRing } from './support/ring.mjs';
import { TMP, NIGHTSHIFT, OHNE_STRUDEL, BESTAND, warte, stapel, sse, post, postJson, geladenesDeck, zustand, eins, CYPHER, bis, neustart, K1, K2, KMASTER } from './server_test_help.mjs';
// Own temp folder of this file (created in the helper module, one process per file), removed at the end.
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('/deck/hotcue aus_loop: leeres Pad bei laufendem Loop speichert DIESEN Loop (Start, Länge); ohne Loop 409', async (t) => {
  const { o, url } = await geladenesDeck(t);
  const e = eins();
  // ohne aktiven Loop: 409, nichts gespeichert
  assert.equal((await postJson(url, '/deck/hotcue', { deck: 1, nr: 3, aktion: 'setzen', aus_loop: true, raster: 1 })).code, 409);
  o.kern.sende('/k/deck/start', { id: 901, quelle: 'andreas', plan: '', gruppe: '', hoerschein: '', deck: 1,
    ab_beat: Math.ceil(o.kern.uhr.beat) + 1, quell_beat: e, politik: 1 });
  await zustand(o, (x) => x.status === 2);
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 1, raster: 1 })).code, 200);
  await zustand(o, (x) => x.status === 3);
  const r = await postJson(url, '/deck/hotcue', { deck: 1, nr: 3, aktion: 'setzen', aus_loop: true, raster: 1 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.hotcue.art, 'loop'); assert.equal(r.j.hotcue.laenge, 1);
  // der Kern kreist im Loop: jeder gemeldete Quell-Beat liegt in [Start, Start + 1] des gespeicherten Pads
  const q = [];
  for (let i = 0; i < 60; i++) { q.push(Number(o.stand.decks['1'].quell_beat)); await warte(20); }
  const s0 = r.j.hotcue.quell_beat;
  assert.ok(q.every((x) => x >= s0 - 0.02 && x <= s0 + 1.02), `Start ${s0}, gesehen ${Math.min(...q)}..${Math.max(...q)}`);
  assert.ok(Math.max(...q) - Math.min(...q) > 0.5, 'Loop kreist');
  // aus: danach wieder 409
  await postJson(url, '/deck/loop', { deck: 1, laenge: 0, raster: 1 });
  await zustand(o, (x) => x.status === 2);   // aus wirkt erst auf dem nächsten Beat
  assert.equal((await postJson(url, '/deck/hotcue', { deck: 1, nr: 4, aktion: 'setzen', aus_loop: true, raster: 1 })).code, 409);
});

test('/deck/hotcue aus_loop bei STEHENDEM Deck: scharfer Loop (beats_bis_ende null) wird Loop-Cue ab dem Kopf', async (t) => {
  const { o, url } = await geladenesDeck(t);
  const e = eins();
  await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 8, raster: 0 });
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 8)) < 1e-6);
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 2, raster: 4 })).code, 200);
  const z = await zustand(o, (x) => !Number.isFinite(x.beats_bis_ende));
  assert.ok(!Number.isFinite(z.beats_bis_ende), `beats_bis_ende ${z.beats_bis_ende}`);
  const r = await postJson(url, '/deck/hotcue', { deck: 1, nr: 5, aktion: 'setzen', aus_loop: true, raster: 4 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.hotcue, { quell_beat: e + 8, art: 'loop', laenge: 2 });
});

test('/deck/loop GET: aktiver Loop (Start, Länge) für die Anzeige; aus_loop ohne gemerkten Loop (Server neu) nimmt Kopf und Länge', async (t) => {
  const { o, url } = await geladenesDeck(t);
  const e = eins();
  assert.deepEqual(await (await fetch(`${url}/deck/loop?deck=1`)).json(), {});
  await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 8, raster: 0 });
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 8)) < 1e-6);
  await postJson(url, '/deck/loop', { deck: 1, laenge: 4, raster: 4 });
  await zustand(o, (x) => !Number.isFinite(x.beats_bis_ende));
  assert.deepEqual(await (await fetch(`${url}/deck/loop?deck=1`)).json(), { start: e + 8, laenge: 4 });
  // Server-Neustart simuliert: gemerkter Loop weg, der Kern hält ihn noch scharf
  o.aktiverLoop = {};
  assert.deepEqual(await (await fetch(`${url}/deck/loop?deck=1`)).json(), {});
  const r = await postJson(url, '/deck/hotcue', { deck: 1, nr: 6, aktion: 'setzen', aus_loop: true, laenge: 4, raster: 4 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.hotcue, { quell_beat: e + 8, art: 'loop', laenge: 4 });
  // aus → wieder leer
  await postJson(url, '/deck/loop', { deck: 1, laenge: 0, raster: 4 });
  assert.deepEqual(await (await fetch(`${url}/deck/loop?deck=1`)).json(), {});
});

test('/deck/sprung bei scharfem Loop: der Kern verschiebt den Loop mit, das Loop-Gedächtnis (GET /deck/loop, /lage) zieht um dasselbe Delta nach', async (t) => {
  const { o, url } = await geladenesDeck(t);
  const e = eins();
  await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 8, raster: 0 });
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 8)) < 1e-6);
  await postJson(url, '/deck/loop', { deck: 1, laenge: 4, raster: 4 });
  await zustand(o, (x) => !Number.isFinite(x.beats_bis_ende));
  assert.deepEqual(await (await fetch(`${url}/deck/loop?deck=1`)).json(), { start: e + 8, laenge: 4 });
  assert.equal((await postJson(url, '/deck/sprung', { deck: 1, delta: -1, raster: 0 })).code, 200);
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 7)) < 1e-6);
  assert.deepEqual(await (await fetch(`${url}/deck/loop?deck=1`)).json(), { start: e + 7, laenge: 4 }, 'Start um -1 nachgezogen');
  const lage = await (await fetch(`${url}/lage`)).json();
  assert.equal(lage.decks.find((d) => d.deck === 1).loop.start, e + 7, 'auch /lage zeigt den neuen Start');
  // Negativ-Kontrolle: ohne Loop kein Gedächtnis, Sprung ändert nichts daran
  await postJson(url, '/deck/loop', { deck: 1, laenge: 0, raster: 4 });
  await zustand(o, (x) => Number.isFinite(x.beats_bis_ende));
  assert.equal((await postJson(url, '/deck/sprung', { deck: 1, delta: 2, raster: 0 })).code, 200);
  assert.deepEqual(await (await fetch(`${url}/deck/loop?deck=1`)).json(), {});
});

test('/deck/loop behalte_start (Längenknöpfe): bei laufendem Loop ändert sich nur die Länge, der Start bleibt; ohne behalte_start wandert der Start an den Kopf', async (t) => {
  const { o, url } = await geladenesDeck(t);
  const e = eins();
  o.kern.sende('/k/deck/start', { id: 911, quelle: 'andreas', plan: '', gruppe: '', hoerschein: '', deck: 1,
    ab_beat: Math.ceil(o.kern.uhr.beat) + 1, quell_beat: e, politik: 1 });
  await zustand(o, (x) => x.status === 2);
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 2, raster: 1 })).code, 200);
  await zustand(o, (x) => x.status === 3);
  const s0 = (await (await fetch(`${url}/deck/loop?deck=1`)).json()).start;
  const bereich = async (ms) => {
    const q = [];
    for (let i = 0; i < ms / 20; i++) { q.push(Number(o.stand.decks['1'].quell_beat)); await warte(20); }
    return [Math.min(...q), Math.max(...q)];
  };
  let [lo, hi] = await bereich(1500);
  assert.ok(hi < s0 + 2.05, `vor der Änderung im Loop [${s0}, ${s0 + 2}), gesehen bis ${hi}`);
  const r = await postJson(url, '/deck/loop', { deck: 1, laenge: 4, raster: 0, behalte_start: true });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.felder.laenge_beats, 4);
  assert.deepEqual(await (await fetch(`${url}/deck/loop?deck=1`)).json(), { start: s0, laenge: 4 }, 'Gedächtnis: Start bleibt, Länge neu');
  await warte(600);   // ab_beat liegt einen Vorlauf voraus
  [lo, hi] = await bereich(3000);
  assert.ok(lo >= s0 - 0.05 && hi > s0 + 2.5 && hi < s0 + 4.05, `Loop [${s0}, ${s0 + 4}), gesehen ${lo}..${hi}`);
  // Negativ-Kontrolle: ohne behalte_start (alter Weg) setzt der Kern den Start an den Kopf
  const kopf = Number(o.stand.decks['1'].quell_beat);
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 8, raster: 0 })).code, 200);
  const l2 = await (await fetch(`${url}/deck/loop?deck=1`)).json();
  assert.ok(Math.abs(l2.start - s0) > 0.3 || Math.abs(kopf - s0) < 0.3, `alter Weg: Start ${l2.start} (Kopf ${kopf}, bisher ${s0})`);
  // behalte_start ohne Loop (Länge 0 / Deck steht ohne Loop): gewöhnlicher Weg, kein Fehler
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 0, raster: 0, behalte_start: true })).code, 200);
});

test('Loop Move (◀ ▶): Sprung um ±Länge bei scharfem Loop verschiebt Loop und Kopf, Gedächtnis folgt; links zurück', async (t) => {
  const { o, url } = await geladenesDeck(t);
  const e = eins();
  await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 8, raster: 0 });
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 8)) < 1e-6);
  await postJson(url, '/deck/loop', { deck: 1, laenge: 4, raster: 4 });
  await zustand(o, (x) => !Number.isFinite(x.beats_bis_ende));
  const lage = async () => (await (await fetch(`${url}/lage`)).json()).decks.find((x) => x.deck === 1);
  assert.deepEqual((await lage()).loop, { start: e + 8, laenge: 4 });
  assert.equal((await postJson(url, '/deck/sprung', { deck: 1, delta: 4, raster: 0 })).code, 200);
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 12)) < 1e-6);
  assert.deepEqual((await lage()).loop, { start: e + 12, laenge: 4 }, 'rechts: Loop +4');
  assert.equal((await postJson(url, '/deck/sprung', { deck: 1, delta: -4, raster: 0 })).code, 200);
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 8)) < 1e-6);
  assert.deepEqual((await lage()).loop, { start: e + 8, laenge: 4 }, 'links: zurück auf 8');
  assert.equal((await postJson(url, '/deck/sprung', { deck: 1, delta: -4, raster: 0 })).code, 200);
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 4)) < 1e-6);
  assert.deepEqual((await lage()).loop, { start: e + 4, laenge: 4 });
});

test('Loop-Raster (Plan 2026-10-21): stehendes Deck neben dem Beat → Start auf der Rasterstelle, der Kern spielt genau dort; Raster 0 = Kopf', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  const e = eins();
  await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 8.3, raster: 0 });
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 8.3)) < 1e-6);
  const r = await postJson(url, '/deck/loop', { deck: 1, laenge: 4, raster: 1 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.felder.start_beat, e + 8, 'Start auf dem Beat, nicht am Kopf');
  assert.equal(log.filter((z) => z.typ === 'an_kern').at(-1).adresse, '/k/deck/loop_laenge');
  await zustand(o, (x) => !Number.isFinite(x.beats_bis_ende));   // GET /deck/loop zeigt erst, wenn der Kern den Loop hält (loopScharf)
  assert.deepEqual(await (await fetch(`${url}/deck/loop?deck=1`)).json(), { start: e + 8, laenge: 4 });
  // Die Ankunft im Kern am stehenden Deck ist hier nicht beobachtbar (ein Start beendet den Loop, decks.mjs:114, deck.cpp:356);
  // sie zeigt der zweite Test am laufenden Deck über dieselbe Adresse.
  // Negativ-Kontrolle: Raster 0 bei stehendem Deck → alter Weg, Start am Kopf
  await postJson(url, '/deck/loop', { deck: 1, laenge: 0, raster: 0 });
  await zustand(o, (x) => Number.isFinite(x.beats_bis_ende));
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 4, raster: 0 })).code, 200);
  assert.equal(log.filter((z) => z.typ === 'an_kern').at(-1).adresse, '/k/deck/loop');
  await zustand(o, (x) => !Number.isFinite(x.beats_bis_ende));
  const l0 = await (await fetch(`${url}/deck/loop?deck=1`)).json();
  assert.ok(Math.abs(l0.start - (e + 8.3)) < 1e-6, `Raster 0: Start am Kopf, war ${l0.start}`);
});

test('Loop-Raster: laufendes Deck mit Phasenversatz → Start auf dem nächsten Beat (auch bei Takt-Raster); Ablehnung nimmt das Gedächtnis zurück', async (t) => {
  const { o, url } = await geladenesDeck(t);
  const e = eins();
  o.kern.sende('/k/deck/start', { id: 960, quelle: 'andreas', plan: '', gruppe: '', hoerschein: '', deck: 1,
    ab_beat: Math.ceil(o.kern.uhr.beat) + 1, quell_beat: e + 0.3, politik: 1 });
  await zustand(o, (x) => x.status === 2);
  const r = await postJson(url, '/deck/loop', { deck: 1, laenge: 4, raster: 4 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const s = r.j.felder.start_beat;
  assert.ok(Math.abs((s - e) - Math.round(s - e)) < 1e-9, `Start ${s} liegt auf einem Beat ab der Eins ${e}`);
  // sofort statt auf die nächste Takt-Eins des Masters (Andreas 21.10.: „der loop knopf reagiert nur verzögert“): der Start liegt
  // schon auf dem Track-Raster, ein Warten aufs Master-Raster kostete bis zu 4 Beats
  assert.equal(r.j.felder.raster_beats, 0, 'kein Warten aufs Master-Raster');
  assert.ok(r.j.felder.ab_beat - o.kern.uhr.beat < 1, `ab_beat ${r.j.felder.ab_beat} liegt höchstens einen Vorlauf voraus (Uhr ${o.kern.uhr.beat})`);
  await zustand(o, (x) => x.status === 3);
  const q = [];
  for (let i = 0; i < 175; i++) { q.push(Number(o.stand.decks['1'].quell_beat)); await warte(20); }
  assert.ok(Math.max(...q) < s + 4.05 && Math.max(...q) > s + 3, `Naht bei ${s + 4}, gesehen bis ${Math.max(...q)}`);
  // Ablehnung (Loop ginge aus dem Material, NIGHTSHIFT 100 s ≈ 213,3 Beats; Start ~203 + 16 > 213,3): Gedächtnis zurück auf „kein Loop“.
  // (Abweichung vom Plan-Test: im Loop gilt L2b, der alte Weg; die Ablehnung am Gerasterten sieht man erst nach Loop-Ende.)
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 0, raster: 0 })).code, 200);
  await zustand(o, (x) => x.status === 2);
  assert.equal((await postJson(url, '/deck/sprung', { deck: 1, delta: 200, raster: 0 })).code, 200);
  await warte(600);
  assert.equal(o.aktiverLoop['1'], undefined, 'vor dem Test: kein Loop gemerkt');
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 16, raster: 1 })).code, 200);
  assert.equal(o.aktiverLoop['1']?.laenge, 16, 'sofort gemerkt');
  await warte(1200);   // Quittung 6 kommt nach ab_beat
  assert.equal(o.aktiverLoop['1'], undefined, 'abgelehnt: das Gedächtnis fällt auf den Stand davor (kein Loop) zurück');
});

test('Loop-Raster L2b: LOOP bei schon laufendem Loop geht den alten Weg ab dem Kopf (der gewickelte Kopf ist nur dem Kern bekannt)', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  const e = eins();
  o.kern.sende('/k/deck/start', { id: 970, quelle: 'andreas', plan: '', gruppe: '', hoerschein: '', deck: 1,
    ab_beat: Math.ceil(o.kern.uhr.beat) + 1, quell_beat: e + 1, politik: 1 });
  await zustand(o, (x) => x.status === 2);
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 2, raster: 1 })).code, 200);
  await zustand(o, (x) => x.status === 3);
  await warte(1500);   // mehrere Nähte: quell − (ab − beat) liegt jetzt nicht mehr am Kopf
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 4, raster: 4 })).code, 200);
  assert.equal(log.filter((z) => z.typ === 'an_kern').at(-1).adresse, '/k/deck/loop', 'im Loop: alter Weg');
});

test('/deck/loop/sichern: aktiver Deck-Loop wird sample-genau (mit Grid-Versatz) ein Loop der Bibliothek', async (t) => {
  const lo = fs.mkdtempSync(path.join(TMP, 'djk-loops-'));
  const { o, url, log } = await geladenesDeck(t, { loops: lo });
  const e = eins();
  const fj = JSON.parse(fs.readFileSync(path.join(BESTAND, NIGHTSHIFT, 'fassungen', '128000_r1', 'fassung.json'), 'utf8'));
  // ohne Loop: 409
  assert.equal((await postJson(url, '/deck/loop/sichern', { deck: 1 })).code, 409);
  await postJson(url, '/deck/raster', { deck: 1, versatz_frames: -480 });
  await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 8, raster: 0 });
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 8)) < 1e-6);
  await postJson(url, '/deck/loop', { deck: 1, laenge: 2, raster: 4 });
  await zustand(o, (x) => x.beats_bis_ende === null || x.beats_bis_ende === Infinity);
  assert.deepEqual((await postJson(url, '/deck/loop/sichern', { deck: 1, box: 1 })).j.fehler, 'unbekannte_box', 'the loop boxes are gone');
  const r = await postJson(url, '/deck/loop/sichern', { deck: 1 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.match(r.j.name, /^a-\d{6}-2b$/);
  const j = JSON.parse(fs.readFileSync(path.join(lo, r.j.name, 'loop.json'), 'utf8'));
  assert.deepEqual([j.schema, j.beats, j.bpm, j.frames, j.datei, j.quelle], [1, 2, 128, 45000, 'loop.f32', 'deck']);
  assert.ok((await (await fetch(`${url}/loops`)).json()).some((l) => l.name === r.j.name && l.beats === 2));
  // Inhalt = Ausschnitt der Fassung ab erster_schlag_frame + Versatz + (e + 8)·22500
  const start = fj.erster_schlag_frame - 480 + (e + 8) * 22500;
  const basis = fs.readFileSync(path.join(BESTAND, NIGHTSHIFT, 'fassungen', '128000_r1', fj.datei));
  const soll = basis.subarray(start * 8, (start + 45000) * 8);
  const ist = fs.readFileSync(path.join(lo, r.j.name, 'loop.f32'));
  assert.equal(ist.length, 45000 * 8);
  assert.ok(ist.equals(soll), 'Loop-Bytes = Ausschnitt der Fassung');
  // Negativ-Kontrolle: um einen Frame daneben ist es NICHT gleich
  assert.ok(!ist.equals(basis.subarray((start + 1) * 8, (start + 45001) * 8)));
  assert.ok(!log.some((z) => z.typ === 'an_kern' && z.adresse === '/k/loop/laden'), 'saving loads nothing into the kern');
});

test('aktiver Deck-Loop überlebt den Neustart des Seiten-Servers (Datei neben den Hotcues)', async (t) => {
  const { o, url, hc } = await geladenesDeck(t);
  const e = eins();
  await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 8, raster: 0 });
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 8)) < 1e-6);
  await postJson(url, '/deck/loop', { deck: 1, laenge: 4, raster: 4 });
  await zustand(o, (x) => x.beats_bis_ende === null || x.beats_bis_ende === Infinity);
  const datei = path.join(hc, 'aktive_loops.json');
  assert.ok(fs.existsSync(datei), 'Datei geschrieben');
  o.aktiverLoop = {};                       // Speicher weg wie nach einem Neustart
  o.ladeAktiveLoops();
  assert.deepEqual(await (await fetch(`${url}/deck/loop?deck=1`)).json(), { start: e + 8, laenge: 4 });
  await postJson(url, '/deck/loop', { deck: 1, laenge: 0, raster: 4 });
  assert.deepEqual(JSON.parse(fs.readFileSync(datei, 'utf8')), {});
});

test('/deck/raster (Plan Grid): Schritt und absolut gehen als /k/deck/raster an den Kern, /e/raster kommt durch, Quell-Beat bleibt', async (t) => {
  const { o, url, s, log } = await geladenesDeck(t);
  const q0 = Number(o.stand.decks['1'].quell_beat);
  const r = await postJson(url, '/deck/raster', { deck: 1, schritt_ms: 5 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.versatz_frames, r.j.gespeichert_frames], [240, 0]);
  const r2 = await postJson(url, '/deck/raster', { deck: 1, schritt_ms: -1 });
  assert.equal(r2.j.versatz_frames, 192);
  const an = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/deck/raster').map((z) => z.felder);
  assert.deepEqual(an.map((f) => [f.quelle, f.deck, f.material_id, f.basis_bpm, f.fassung, f.versatz_frames]),
    [['andreas', 1, NIGHTSHIFT, 128, 1, 240], ['andreas', 1, NIGHTSHIFT, 128, 1, 192]]);
  for (let i = 0; i < 50 && s.ereignisse.filter((x) => x.a === '/e/raster').length < 2; i++) await warte(20);
  const ev = s.ereignisse.filter((x) => x.a === '/e/raster').map((x) => x.f.versatz_ms);
  assert.deepEqual(ev, [5, -1]);
  const z = await zustand(o, () => true);
  assert.ok(Math.abs(Number(z.quell_beat) - q0) < 1e-6, `quell_beat ${z.quell_beat} statt ${q0}`);
  assert.deepEqual(await (await fetch(`${url}/deck/raster?deck=1`)).json(), { versatz_frames: 192, gespeichert_frames: 0 });
  assert.equal((await postJson(url, '/deck/raster', { deck: 1, versatz_frames: 0 })).j.versatz_frames, 0);
  // Ablehnungen, nichts an den Kern
  const vorher = o.gesendet;
  assert.equal((await postJson(url, '/deck/raster', { deck: 5, schritt_ms: 5 })).code, 400);
  assert.equal((await postJson(url, '/deck/raster', { deck: 1, schritt_ms: 500 })).code, 400);
  assert.equal((await postJson(url, '/deck/raster', { deck: 1, versatz_frames: 1.5 })).code, 400);
  assert.equal((await postJson(url, '/deck/raster', { deck: 1 })).code, 400);
  assert.equal((await post(url, '/deck/raster', { deck: 1, schritt_ms: 5 })).code, 415);
  assert.equal(o.gesendet, vorher);
});

test('/deck/raster SET: stehendes Deck, Eins auf den Beat unter dem Kopf und auf die erste Eins im Track, Kopf bleibt; laufend 409', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  const e = eins();
  const erster = JSON.parse(fs.readFileSync(path.join(BESTAND, NIGHTSHIFT, 'fassungen', '128000_r1', 'fassung.json'), 'utf8')).erster_schlag_frame;
  // Kopf auf e + 5 (eine Eins + 1 Beat): dieser Schlag wird Eins. Erste Eins im Track dann e + 1 (Quell-Beat alt);
  // der Versatz legt den Quell-Beat e dorthin: k = +1, sofern e + 1 noch im Track ist (Lage < 3,5 Beats), sonst k = −3.
  const k = (erster / 22500 + e + 1) < 3.5 ? 1 : -3;
  await postJson(url, '/deck/sprung', { deck: 1, ziel: e + 5, raster: 0 });
  await zustand(o, (x) => Math.abs(x.quell_beat - (e + 5)) < 1e-6);
  const r = await postJson(url, '/deck/raster', { deck: 1, set: true });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.k, k); assert.equal(r.j.versatz_frames, 22500 * k);
  const an = log.filter((z) => z.typ === 'an_kern').map((z) => [z.adresse, z.felder]);
  assert.equal(an.filter(([a]) => a === '/k/deck/raster').at(-1)[1].versatz_frames, 22500 * k);
  assert.equal(an.filter(([a]) => a === '/k/deck/sprung').at(-1)[1].delta_beats, -k);
  // Label unter dem Kopf ist e + 5 − k: eine Takt-Eins, physisch derselbe Schlag
  const z = await zustand(o, (x) => Math.abs(x.quell_beat - (e + 5 - k)) < 1e-6);
  assert.ok(Math.abs(z.quell_beat - (e + 5 - k)) < 1e-6, `quell_beat ${z.quell_beat}, erwartet ${e + 5 - k}`);
  // Negativ: schon auf der Eins → k 0, weder Raster noch Sprung an den Kern
  const vorher = o.gesendet;
  const r2 = await postJson(url, '/deck/raster', { deck: 1, set: true });
  assert.equal(r2.code, 200); assert.equal(r2.j.k, 0); assert.equal(o.gesendet, vorher);
  // laufend: 409, nichts an den Kern. Das Deck läuft wirklich (Attrappe): ein nur lokal gesetzter Status wurde vom
  // nächsten /zustand/deck der Attrappe wieder auf 'steht' überschrieben (Wackler ~1/8, 06.10., wie Hand T7).
  o.kern.sende('/k/deck/start', { id: 901, quelle: 'andreas', plan: '', gruppe: '', hoerschein: '', deck: 1,
    ab_beat: Math.ceil(o.kern.uhr.beat) + 1, quell_beat: e, politik: 1 });
  await zustand(o, (x) => x.status === 2);
  const vorher2 = o.gesendet;
  assert.equal((await postJson(url, '/deck/raster', { deck: 1, set: true })).code, 409);
  assert.equal(o.gesendet, vorher2);
});

test('/deck/raster/fix (Plan Grid): speichert je Fassung, nach Laden und nach /e/neustart schickt der Server den Versatz', async (t) => {
  const ro = fs.mkdtempSync(path.join(TMP, 'djk-raster-'));
  const { o, url, log } = await geladenesDeck(t, { rasterOrdner: ro });
  await postJson(url, '/deck/raster', { deck: 1, schritt_ms: 5 });
  await postJson(url, '/deck/raster', { deck: 1, schritt_ms: 5 });
  const r = await postJson(url, '/deck/raster/fix', { deck: 1 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.versatz_frames, r.j.gespeichert_frames], [480, 480]);
  const datei = path.join(ro, `${NIGHTSHIFT}_128000_r1.json`);
  assert.deepEqual(JSON.parse(fs.readFileSync(datei, 'utf8')), { versatz_frames: 480 });
  // ohne FIX verschoben, dann neu laden: gespeicherter Wert kommt, nicht der ungespeicherte
  await postJson(url, '/deck/raster', { deck: 1, schritt_ms: 1 });
  const n0 = log.filter((z) => z.typ === 'raster_wieder').length;
  assert.equal((await postJson(url, '/laden', { deck: 1, material_id: NIGHTSHIFT })).code, 200);
  for (let i = 0; i < 100 && log.filter((z) => z.typ === 'raster_wieder').length === n0; i++) await warte(20);
  assert.deepEqual(log.filter((z) => z.typ === 'raster_wieder').at(-1), { typ: 'raster_wieder', deck: 1, versatz_frames: 480 });
  const an = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/deck/raster').at(-1).felder;
  assert.equal(an.versatz_frames, 480);
  assert.deepEqual(await (await fetch(`${url}/deck/raster?deck=1`)).json(), { versatz_frames: 480, gespeichert_frames: 480 });
  // Kern-Neustart: 500 ms später noch einmal
  const n1 = log.filter((z) => z.typ === 'raster_wieder').length;
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 8, sample: 0 } });
  for (let i = 0; i < 60 && log.filter((z) => z.typ === 'raster_wieder').length === n1; i++) await warte(20);
  assert.equal(log.filter((z) => z.typ === 'raster_wieder').length, n1 + 1);
  // Negativ-Kontrolle: Versatz 0 gespeichert → nach Laden wird NICHTS geschickt
  await postJson(url, '/deck/raster', { deck: 1, versatz_frames: 0 });
  await postJson(url, '/deck/raster/fix', { deck: 1 });
  const k0 = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/deck/raster').length;
  assert.equal((await postJson(url, '/laden', { deck: 1, material_id: NIGHTSHIFT })).code, 200);
  await warte(600);
  assert.equal(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/deck/raster').length, k0);
  assert.equal((await postJson(url, '/deck/raster/fix', { deck: 5 })).code, 400);
});

// --- Grid-Eins (2026-10-11, Bericht grid-phase): FIX/SET schreibt die Eins ins Material, neue Fassungen erben den Versatz ---
function eigenerBestand(eins1 = 0, eins2 = null) {
  const dir = fs.mkdtempSync(path.join(TMP, 'djk-grideins-'));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  baueBestand(dir, [{ material_id: NIGHTSHIFT, titel: 'nightshift', frames: 48000 * 100 }]);
  const r1 = path.join(dir, NIGHTSHIFT, 'fassungen', '128000_r1');
  const fj = JSON.parse(fs.readFileSync(path.join(r1, 'fassung.json'), 'utf8'));
  fs.writeFileSync(path.join(r1, 'fassung.json'), JSON.stringify({ ...fj, erste_eins_quell_beat: eins1 }));
  if (eins2 !== null) {
    const r2 = path.join(dir, NIGHTSHIFT, 'fassungen', '128000_r2');
    fs.cpSync(r1, r2, { recursive: true });
    fs.writeFileSync(path.join(r2, 'fassung.json'), JSON.stringify({ ...fj, fassung: 2, erste_eins_quell_beat: eins2 }));
    const db = new DatabaseSync(path.join(dir, 'index.sqlite'));
    db.prepare('INSERT INTO fassung VALUES (?,?,?,?,?,?,?,?)').run(NIGHTSHIFT, 128, 2, fj.frames, 0, 0, -14, 0);
    db.close();
  }
  return dir;
}
const korrZeilen = (dir) => {
  try { return fs.readFileSync(path.join(dir, NIGHTSHIFT, 'korrekturen.jsonl'), 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z)); } catch { return []; }
};

test('FIX schreibt die Eins ins Material (art=eins), nur ganze Beats zählen; Feinversatz allein schreibt nichts', async (t) => {
  const dir = eigenerBestand(0);
  const ro = fs.mkdtempSync(path.join(TMP, 'djk-raster-'));
  const { url, log } = await geladenesDeck(t, { rasterOrdner: ro, bestand: dir });
  // NEGATIV-KONTROLLE zuerst: 10 ms Feinversatz → keine Zeile
  await postJson(url, '/deck/raster', { deck: 1, versatz_frames: 480 });
  assert.equal((await postJson(url, '/deck/raster/fix', { deck: 1 })).code, 200);
  assert.deepEqual(korrZeilen(dir), []);
  // FEHLERFALL: −2 Beats −10 ms (Andreas' Halbtakt-Korrektur) → Eins (0 − 2) mod 4 = 2 im Material
  await postJson(url, '/deck/raster', { deck: 1, versatz_frames: -45480 });
  assert.equal((await postJson(url, '/deck/raster/fix', { deck: 1 })).code, 200);
  let z = korrZeilen(dir);
  assert.equal(z.length, 1);
  assert.deepEqual({ ...z[0], zeit: undefined }, { zeit: undefined, von: 'andreas', art: 'eins', fassung: '128000_r1', ab_quell_beat: 2,
    bis_quell_beat: null, versatz_ms: null, nr: null, text: 'FIX: Eins um −2 Beats gesetzt, Lage 2' });
  assert.match(z[0].zeit, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.ok(log.some((l) => l.typ === 'eins_korrektur' && l.eins === 2));
  // zweites FIX mit demselben Versatz: keine doppelte Zeile
  await postJson(url, '/deck/raster/fix', { deck: 1 });
  assert.equal(korrZeilen(dir).length, 1);
  // Korrektur zurückgenommen (0): die offene Zeile wird überschrieben, Lage 0
  await postJson(url, '/deck/raster', { deck: 1, versatz_frames: 0 });
  await postJson(url, '/deck/raster/fix', { deck: 1 });
  z = korrZeilen(dir);
  assert.equal(z.length, 2); assert.equal(z[1].ab_quell_beat, 0);
});

test('SET schreibt NICHTS ins Material (flüchtig), erst FIX speichert die Eins (Review B4)', async (t) => {
  const dir = eigenerBestand(0);
  const { o, url } = await geladenesDeck(t, { bestand: dir });
  const erster = JSON.parse(fs.readFileSync(path.join(dir, NIGHTSHIFT, 'fassungen', '128000_r1', 'fassung.json'), 'utf8')).erster_schlag_frame;
  const k = (erster / 22500 + 1) < 3.5 ? 1 : -3;
  await postJson(url, '/deck/sprung', { deck: 1, ziel: 5, raster: 0 });
  await zustand(o, (x) => Math.abs(x.quell_beat - 5) < 1e-6);
  const r = await postJson(url, '/deck/raster', { deck: 1, set: true });
  assert.equal(r.code, 200, JSON.stringify(r.j)); assert.equal(r.j.k, k);
  assert.deepEqual(korrZeilen(dir), []);                     // Probe-SET: keine Zeile in korrekturen.jsonl
  assert.equal((await postJson(url, '/deck/raster/fix', { deck: 1 })).code, 200);
  const z = korrZeilen(dir);
  assert.equal(z.length, 1); assert.equal(z[0].art, 'eins'); assert.equal(z[0].ab_quell_beat, ((k % 4) + 4) % 4);
  assert.match(z[0].text, /^FIX: /);
});

test('Neue Fassung ohne Raster-Datei erbt Versatz der nächstälteren (Fehlerfall 929d/9b44: r2 verlor die Korrektur von r1)', async (t) => {
  const dir = eigenerBestand(2, 2);
  const ro = fs.mkdtempSync(path.join(TMP, 'djk-raster-'));
  fs.writeFileSync(path.join(ro, `${NIGHTSHIFT}_128000_r1.json`), JSON.stringify({ versatz_frames: -45480 }));
  const { o, url, log } = await geladenesDeck(t, { rasterOrdner: ro, bestand: dir });   // lädt die neueste: r2
  assert.equal(o.stand.decks['1'].fassung, 2);
  for (let i = 0; i < 100 && !log.some((l) => l.typ === 'raster_wieder'); i++) await warte(20);
  assert.deepEqual(log.filter((l) => l.typ === 'raster_wieder').at(-1), { typ: 'raster_wieder', deck: 1, versatz_frames: -45480, geerbt_von: 1 });
  assert.equal(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/deck/raster').at(-1).felder.versatz_frames, -45480);
  assert.deepEqual(await (await fetch(`${url}/deck/raster?deck=1`)).json(), { versatz_frames: -45480, gespeichert_frames: -45480 });
  assert.ok(!fs.existsSync(path.join(ro, `${NIGHTSHIFT}_128000_r2.json`)), 'geerbt wird gelesen, nicht geschrieben');
});

test('Neue Fassung hat die Eins schon eingebaut (2 → 0): nur der Feinversatz wird geerbt, nicht doppelt', async (t) => {
  const dir = eigenerBestand(2, 0);
  const ro = fs.mkdtempSync(path.join(TMP, 'djk-raster-'));
  fs.writeFileSync(path.join(ro, `${NIGHTSHIFT}_128000_r1.json`), JSON.stringify({ versatz_frames: -45480 }));   // Eins 2, −2 Beats → 0
  const { url, log } = await geladenesDeck(t, { rasterOrdner: ro, bestand: dir });
  for (let i = 0; i < 100 && !log.some((l) => l.typ === 'raster_wieder'); i++) await warte(20);
  assert.equal(log.filter((l) => l.typ === 'raster_wieder').at(-1).versatz_frames, -480);
  assert.equal((await (await fetch(`${url}/deck/raster?deck=1`)).json()).versatz_frames, -480);
});

test('Eigene Raster-Datei der geladenen Fassung schlägt das Erbe (Negativ-Kontrolle)', async (t) => {
  const dir = eigenerBestand(2, 2);
  const ro = fs.mkdtempSync(path.join(TMP, 'djk-raster-'));
  fs.writeFileSync(path.join(ro, `${NIGHTSHIFT}_128000_r1.json`), JSON.stringify({ versatz_frames: -45480 }));
  fs.writeFileSync(path.join(ro, `${NIGHTSHIFT}_128000_r2.json`), JSON.stringify({ versatz_frames: 96 }));
  const { url } = await geladenesDeck(t, { rasterOrdner: ro, bestand: dir });
  assert.equal((await (await fetch(`${url}/deck/raster?deck=1`)).json()).versatz_frames, 96);
});

test('leseBestand B2: Seitendatei eins_bewertung.json zeigt „unsicher“ ohne Neurendern; Fassungs-Felder haben Vorrang; Hand-Eins löscht den Hinweis', () => {
  const dir = eigenerBestand(0);
  const seite = path.join(dir, NIGHTSHIFT, 'eins_bewertung.json');
  assert.equal(leseBestand(dir)[0].eins_unsicher, false);                                   // keine Datei
  fs.writeFileSync(seite, JSON.stringify({ unsicher: true, anteil: 0.41, quelle: 'mehrheit', kick_lage: null, eins_vorschlag: 2 }));
  assert.equal(leseBestand(dir)[0].eins_unsicher, true);
  fs.writeFileSync(seite, JSON.stringify({ unsicher: false }));
  assert.equal(leseBestand(dir)[0].eins_unsicher, false);                                   // Negativ: sicher bewertet
  fs.writeFileSync(seite, '{kaputt');
  assert.equal(leseBestand(dir)[0].eins_unsicher, false);                                   // unlesbar: nichts zeigen
  fs.writeFileSync(seite, JSON.stringify({ unsicher: true }));
  const datei = path.join(dir, NIGHTSHIFT, 'fassungen', '128000_r1', 'fassung.json');
  const fj = JSON.parse(fs.readFileSync(datei, 'utf8'));
  fs.writeFileSync(datei, JSON.stringify({ ...fj, tore: { eins: { ok: true, beat_this: 2, zweitverfahren: 2, bewertet: true, unsicher: false } } }));
  assert.equal(leseBestand(dir)[0].eins_unsicher, false);                                   // Fassungs-Feld gewinnt
  fs.writeFileSync(datei, JSON.stringify(fj));
  assert.equal(leseBestand(dir)[0].eins_unsicher, true);
  fs.writeFileSync(path.join(dir, NIGHTSHIFT, 'korrekturen.jsonl'), JSON.stringify({ zeit: '2026-10-11T03:00:00', von: 'werkstatt', art: 'eins', fassung: '128000_r1', ab_quell_beat: 0, bis_quell_beat: null, versatz_ms: null, nr: null, text: '' }) + '\n');
  assert.equal(leseBestand(dir)[0].eins_unsicher, true);                                    // Werkstatt-Zeile ist keine Handkorrektur
  fs.appendFileSync(path.join(dir, NIGHTSHIFT, 'korrekturen.jsonl'), JSON.stringify({ zeit: '2026-10-11T03:01:00', von: 'andreas', art: 'eins', fassung: '128000_r1', ab_quell_beat: 1, bis_quell_beat: null, versatz_ms: null, nr: null, text: '' }) + '\n');
  assert.equal(leseBestand(dir)[0].eins_unsicher, false);                                   // Andreas hat die Eins gesetzt
});

test('leseBestand: eins_unsicher aus tore.eins der Fassung; fehlt das Feld, false', () => {
  const dir = eigenerBestand(0);
  assert.equal(leseBestand(dir)[0].eins_unsicher, false);
  const datei = path.join(dir, NIGHTSHIFT, 'fassungen', '128000_r1', 'fassung.json');
  const fj = JSON.parse(fs.readFileSync(datei, 'utf8'));
  fs.writeFileSync(datei, JSON.stringify({ ...fj, tore: { eins: { ok: false, beat_this: 2, zweitverfahren: 2, bewertet: true, unsicher: true } } }));
  assert.equal(leseBestand(dir)[0].eins_unsicher, true);
  fs.writeFileSync(datei, JSON.stringify({ ...fj, tore: { eins: { ok: true, beat_this: 2, zweitverfahren: 2, bewertet: true, unsicher: false } } }));
  assert.equal(leseBestand(dir)[0].eins_unsicher, false);
});

test('Hotcues erbt die neue Fassung (esf verschoben); Setzen auf r2 schreibt den vollen Satz in ihre Datei, r1 bleibt, Eigene werden nie überschrieben', async (t) => {
  const dir = eigenerBestand(2, 2);
  const r2 = path.join(dir, NIGHTSHIFT, 'fassungen', '128000_r2', 'fassung.json');
  const fj2 = JSON.parse(fs.readFileSync(r2, 'utf8'));
  fs.writeFileSync(r2, JSON.stringify({ ...fj2, erster_schlag_frame: (fj2.erster_schlag_frame ?? 0) - 2250 }));   // −0,1 Beat (Auto-Phase)
  const hc = fs.mkdtempSync(path.join(TMP, 'djk-hc-'));
  const datei1 = path.join(hc, `${NIGHTSHIFT}_128000_r1.json`), datei2 = path.join(hc, `${NIGHTSHIFT}_128000_r2.json`);
  fs.writeFileSync(datei1, JSON.stringify({ 1: { quell_beat: 40, art: 'shot' }, 2: { quell_beat: 48, art: 'loop', laenge: 4 } }));
  const { url, log } = await geladenesDeck(t, { hotcueOrdner: hc, bestand: dir });                 // lädt r2
  for (let i = 0; i < 100 && !log.some((l) => l.typ === 'hotcues_wieder'); i++) await warte(20);
  assert.deepEqual(log.find((l) => l.typ === 'hotcues_wieder'), { typ: 'hotcues_wieder', deck: 1, anzahl: 2, geerbt_von: 1 });
  assert.deepEqual(await (await fetch(`${url}/deck/hotcues?deck=1`)).json(),
    { 1: { quell_beat: 40.1, art: 'shot' }, 2: { quell_beat: 48.1, art: 'loop', laenge: 4 } });    // dieselbe Audio-Stelle: +0,1 Beat
  assert.ok(!fs.existsSync(datei2), 'geerbt wird nur gelesen');
  // Setzen auf r2: der volle Satz (geerbt + neu) wird ihre eigene Datei, r1 unverändert
  const r1Text = fs.readFileSync(datei1, 'utf8');
  assert.equal((await postJson(url, '/deck/hotcue', { deck: 1, nr: 3, aktion: 'setzen', quell_beat: 20, raster: 1 })).code, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(datei2, 'utf8')), { 1: { quell_beat: 40.1, art: 'shot' }, 2: { quell_beat: 48.1, art: 'loop', laenge: 4 }, 3: { quell_beat: 20, art: 'shot' } });
  assert.equal(fs.readFileSync(datei1, 'utf8'), r1Text);
  // Eigene Datei: nie überschrieben, ein späteres r1-Update ändert nichts mehr
  fs.writeFileSync(datei1, JSON.stringify({ 1: { quell_beat: 99, art: 'shot' } }));
  assert.equal((await (await fetch(`${url}/deck/hotcues?deck=1`)).json())[1].quell_beat, 40.1);
});

for (const reihenfolge of ['erst Cue, dann FIX', 'erst FIX, dann Cue']) {
  test(`Hotcues Review F1: geerbter Satz und FIX mit ganzen Beats, ${reihenfolge}: derselbe Cue (Raster-Position wie auf r1)`, async (t) => {
    const dir = eigenerBestand(2, 2);
    const hc = fs.mkdtempSync(path.join(TMP, 'djk-hc-'));
    const ro = fs.mkdtempSync(path.join(TMP, 'djk-raster-'));
    fs.writeFileSync(path.join(hc, `${NIGHTSHIFT}_128000_r1.json`), JSON.stringify({ 1: { quell_beat: 40, art: 'shot' } }));
    const { url } = await geladenesDeck(t, { hotcueOrdner: hc, rasterOrdner: ro, bestand: dir });   // lädt r2, Cue nur geerbt
    const cue = () => postJson(url, '/deck/hotcue', { deck: 1, nr: 3, aktion: 'setzen', quell_beat: 20, raster: 1 });
    const fix = async () => { await postJson(url, '/deck/raster', { deck: 1, versatz_frames: 22500 }); assert.equal((await postJson(url, '/deck/raster/fix', { deck: 1 })).code, 200); };
    if (reihenfolge === 'erst Cue, dann FIX') { assert.equal((await cue()).code, 200); await fix(); } else { await fix(); assert.equal((await cue()).code, 200); }
    const eigene = JSON.parse(fs.readFileSync(path.join(hc, `${NIGHTSHIFT}_128000_r2.json`), 'utf8'));
    assert.equal(eigene[1].quell_beat, 40, `Cue 1 steht bei ${eigene[1].quell_beat}, auf r1 bei 40`);
    assert.equal((await (await fetch(`${url}/deck/hotcues?deck=1`)).json())[1].quell_beat, 40);
  });
}

test('Hotcues Review F1 NEGATIV: FIX ohne irgendeinen Cue legt keine Hotcue-Datei an', async (t) => {
  const dir = eigenerBestand(2, 2);
  const hc = fs.mkdtempSync(path.join(TMP, 'djk-hc-'));
  const { url } = await geladenesDeck(t, { hotcueOrdner: hc, rasterOrdner: fs.mkdtempSync(path.join(TMP, 'djk-raster-')), bestand: dir });
  await postJson(url, '/deck/raster', { deck: 1, versatz_frames: 22500 });
  assert.equal((await postJson(url, '/deck/raster/fix', { deck: 1 })).code, 200);
  assert.deepEqual(fs.readdirSync(hc).filter((n) => n.startsWith(NIGHTSHIFT)), []);
});

test('Hotcues: neue Fassung ohne Hotcues irgendwo → leer, nichts geschrieben', async (t) => {
  const dir = eigenerBestand(2, 2);
  const hc = fs.mkdtempSync(path.join(TMP, 'djk-hc-'));
  const { url } = await geladenesDeck(t, { hotcueOrdner: hc, bestand: dir });
  assert.deepEqual(await (await fetch(`${url}/deck/hotcues?deck=1`)).json(), {});
  assert.deepEqual(fs.readdirSync(hc).filter((n) => n.startsWith(NIGHTSHIFT)), []);
});

test('Hand T1: Kopf x-djk-quelle cypher → Kern-Befehle mit Quelle cypher; ohne Kopf andreas; /griff und /taste 403', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  const letzte = (adr) => log.filter((z) => z.typ === 'an_kern' && z.adresse === adr).at(-1)?.felder;
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 4, raster: 4 }, CYPHER)).code, 200);
  assert.equal(letzte('/k/deck/loop_laenge').quelle, 'cypher');
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 0, raster: 4 })).code, 200);
  assert.equal(letzte('/k/deck/loop').quelle, 'andreas');
  // async Weg (await in laden): Quelle trägt über await
  assert.equal((await postJson(url, '/laden', { deck: 2, material_id: NIGHTSHIFT }, CYPHER)).code, 200);
  assert.equal(letzte('/k/deck/laden').quelle, 'cypher');
  const vorher = o.gesendet;
  assert.equal((await postJson(url, '/griff', { pfad: 'deck/1/fader', u: 100 }, CYPHER)).code, 403);
  assert.equal((await postJson(url, '/taste', { name: 'freigabe' }, CYPHER)).code, 403);
  assert.equal(o.gesendet, vorher, 'nichts an den Kern');
  // Negativ-Kontrolle: Wiederherstellen nach /e/geladen (ausgelöst durch das cypher-Laden oben) bleibt andreas
  for (let i = 0; i < 50 && !o.stand.geladen['2']; i++) await warte(20);
  const hs = log.filter((z) => z.typ === 'an_kern' && (z.adresse === '/k/deck/hotcue_setzen' || z.adresse === '/k/deck/raster'));
  assert.ok(hs.every((z) => z.felder.quelle === 'andreas'), JSON.stringify(hs.map((z) => [z.adresse, z.felder.quelle])));
});

test('Hand T2: /regler → /k/teil (Rampe über Takte, Start auf Takt), Quittung zurück; nur_hand; Öffnen-Sperre D8', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  const teile = () => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil');
  // Rampe auf einem EQ (öffnet nichts)
  const r = await postJson(url, '/regler', { pfad: 'deck/1/eq/tief', nach: -12, takte: 1, ab: 'takt' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.felder.quelle, 'cypher'); assert.equal(r.j.felder.dauer_beats, 4); assert.equal(r.j.felder.ab_beat % 4, 0);
  assert.ok([1, 2].includes(r.j.quittung.status), JSON.stringify(r.j.quittung));
  for (let i = 0; i < 200 && o.stand.regler['deck/1/eq/tief'] !== -12; i++) await warte(20);
  assert.equal(o.stand.regler['deck/1/eq/tief'], -12);
  // nur Hand: Kern lehnt ab, Server meldet es
  const x = await postJson(url, '/regler', { pfad: 'cue/pegel', nach: -6 }, CYPHER);
  assert.equal(x.code, 200); assert.equal(x.j.quittung.status, 6); assert.equal(x.j.quittung.grund, 'nur_hand');
  // D8: geschlossenen Kanal öffnen → 409 vom Server, nichts an den Kern
  const n0 = teile().length;
  const f = await postJson(url, '/regler', { pfad: 'deck/1/fader', nach: 0 }, CYPHER);
  assert.equal(f.code, 409); assert.equal(f.j.fehler, 'kein_hoerschein'); assert.equal(teile().length, n0);
  // Negativ-Kontrolle: offen (Hand −6) → leiser geht durch; andreas wird nie gesperrt
  o.stand.regler['deck/1/fader'] = -6;
  assert.equal((await postJson(url, '/regler', { pfad: 'deck/1/fader', nach: -10 }, CYPHER)).code, 200);
  o.stand.regler['deck/1/fader'] = -200;
  assert.equal((await postJson(url, '/regler', { pfad: 'deck/1/fader', nach: -3 })).code, 200);
  // Form
  assert.equal((await postJson(url, '/regler', { pfad: 'deck/9/x', nach: 0 }, CYPHER)).code, 400);
  assert.equal((await postJson(url, '/regler', { pfad: 'deck/1/eq/tief', nach: 0, ab: 'bald' }, CYPHER)).code, 400);
});

test('Hand Rev2 B2: Taste freigabe schickt /k/ki/frei (sonst bleibt Stop Cypher eine Einbahnstraße)', async (t) => {
  const { url, log } = await geladenesDeck(t);
  assert.equal((await postJson(url, '/taste', { name: 'freigabe' })).code, 200);
  const frei = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/ki/frei');
  assert.equal(frei.length, 1); assert.equal(frei[0].felder.quelle, 'andreas');
  // Negativ-Kontrolle: stopp schickt kein /k/ki/frei
  assert.equal((await postJson(url, '/taste', { name: 'stopp' })).code, 200);
  assert.equal(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/ki/frei').length, 1);
});

test('Hand Rev2 B1: Öffnen nach §1.6 (Trim + Fader > −26) und I3d (Sprung/Hotcue/Start auf offenem Deck) gesperrt für cypher', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  const n = () => log.filter((z) => z.typ === 'an_kern').length;
  o.stand.regler['deck/1/trim'] = 0; o.stand.regler['deck/1/fader'] = -40;
  let n0 = n();
  let r = await postJson(url, '/regler', { pfad: 'deck/1/fader', nach: 0 }, CYPHER);        // −40 → 0: öffnet
  assert.equal(r.code, 409); assert.equal(r.j.fehler, 'kein_hoerschein');
  r = await postJson(url, '/regler', { pfad: 'deck/1/trim', nach: 24 }, CYPHER);           // Trim hebt −40 auf −16: öffnet
  assert.equal(r.code, 409);
  r = await postJson(url, '/regler', { pfad: 'deck/1/fader', nach: -30 }, CYPHER);         // bleibt zu: erlaubt
  assert.equal(r.code, 200);
  assert.equal(n(), n0 + 1);
  // offenes Deck: Sprung, Hotcue spielen, Start mit cypher → 409 ziel_ungehoert; andreas geht
  o.stand.regler['deck/1/fader'] = -6;
  n0 = n();
  r = await postJson(url, '/deck/sprung', { deck: 1, delta: 4, raster: 0 }, CYPHER);
  assert.equal(r.code, 409); assert.equal(r.j.fehler, 'ziel_ungehoert');
  assert.equal((await postJson(url, '/deck/hotcue', { deck: 1, nr: 1, aktion: 'setzen', quell_beat: 8, art: 'shot', raster: 1 }, CYPHER)).code, 200);
  n0 = n();
  r = await postJson(url, '/deck/hotcue', { deck: 1, nr: 1, aktion: 'spielen', raster: 1 }, CYPHER);
  assert.equal(r.code, 409); assert.equal(n(), n0);
  assert.equal((await postJson(url, '/deck/sprung', { deck: 1, delta: 4, raster: 0 })).code, 200);
  // Hörbares Ziehen auf offenem Deck: Griff und Zug wie der Sprung gesperrt, das Los (phase 0) nie
  n0 = n();
  for (const phase of [1, 2]) {
    r = await postJson(url, '/deck/scrub', { deck: 1, phase, delta: 1 }, CYPHER);
    assert.equal(r.code, 409); assert.equal(r.j.fehler, 'ziel_ungehoert');
  }
  assert.equal(n(), n0);
  assert.equal((await postJson(url, '/deck/scrub', { deck: 1, phase: 0, delta: 1 }, CYPHER)).code, 200);
  assert.equal((await postJson(url, '/deck/scrub', { deck: 1, phase: 1, delta: 0 })).code, 200);
  // Loop auf offenem Deck ist frei (wiederholt Gehörtes)
  assert.equal((await postJson(url, '/deck/loop', { deck: 1, laenge: 4, raster: 4 }, CYPHER)).code, 200);
});

test('Hand T4/T5: GET /lage verdichtet; /deck/start synchron auf den Takt ab der Eins, /deck/stopp; Start auf offenem Deck gesperrt', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  const e = eins();
  const r = await postJson(url, '/deck/start', { deck: 1, ab: 'takt' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const f = r.j.felder;
  assert.deepEqual([f.quelle, f.plan, f.deck, f.quell_beat, f.politik, f.ab_beat % 4], ['cypher', 'cypher', 1, e, 3, 0]);   // ab takt: politik 3, the core aligns the bar phase to a playing deck
  assert.ok([2, 5].includes(r.j.quittung.status), JSON.stringify(r.j.quittung));
  const z = await zustand(o, (x) => x.status === 2);
  assert.equal(z.status, 2);
  // Lage
  const l = await (await fetch(`${url}/lage`)).json();
  assert.ok(Number.isFinite(l.uhr.beat) && l.uhr.takt >= 1 && l.uhr.schlag >= 1 && l.uhr.schlag <= 4);
  assert.equal(l.ki.gestoppt, false);
  const d1 = l.decks.find((d) => d.deck === 1);
  assert.equal(d1.status, 2); assert.equal(d1.material_id, NIGHTSHIFT); assert.equal(d1.offen, false); assert.equal(typeof d1.titel, 'string');
  assert.ok(l.quittungen.some((q) => q.id === f.id), 'eigene Quittung in der Lage');
  assert.ok(l.quittungen.every((q) => q.quelle === 'cypher'));
  // Stopp
  assert.equal((await postJson(url, '/deck/stopp', { deck: 1, ab: 'jetzt' }, CYPHER)).code, 200);
  assert.equal((await zustand(o, (x) => x.status === 1)).status, 1);
  // offenes Deck: Start mit cypher gesperrt, nichts an den Kern
  o.stand.regler['deck/1/fader'] = -6;
  const n0 = log.filter((x) => x.typ === 'an_kern').length;
  const s = await postJson(url, '/deck/start', { deck: 1, ab: 'takt' }, CYPHER);
  assert.equal(s.code, 409); assert.equal(s.j.fehler, 'ziel_ungehoert');
  assert.equal(log.filter((x) => x.typ === 'an_kern').length, n0);
});

test('Hand T7: cypher darf FX/Strudel nur bei AUTO an und ohne Stop Cypher; Andreas-Schalter 403', { skip: OHNE_STRUDEL }, async (t) => {
  const mo = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const { o, url, log } = await geladenesDeck(t, { musterOrdner: mo, live: true });
  const fx1 = { einheit: 1, art: 1, beats: 1, wet: 0.5, param1: 0.5, param2: 0.5, param3: 0.5, an: true };
  // AUTO an (Vorgabe ohne Datei): FX mit cypher geht, Quelle cypher
  let r = await postJson(url, '/fx', fx1, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j)); assert.equal(r.j.felder.quelle, 'cypher');
  r = await postJson(url, '/strudel', { text: 's("bd*4")' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(JSON.parse(fs.readFileSync(path.join(mo, 'strom1.von.json'), 'utf8')).von, 'cypher');
  // AUTO aus (Andreas): cypher → 409 auto_aus, Andreas geht weiter
  assert.equal((await postJson(url, '/strudel/autonom', { an: false })).code, 200);
  assert.equal((await postJson(url, '/fx', fx1, CYPHER)).j.fehler, 'auto_aus');
  r = await postJson(url, '/strudel', { text: 's("hh*8")' }, CYPHER);
  assert.equal(r.code, 409); assert.equal(r.j.fehler, 'auto_aus');
  assert.equal((await postJson(url, '/strudel', { text: 's("cp")' })).code, 200);
  assert.equal((await postJson(url, '/strudel/autonom', { an: true })).code, 200);
  // Stop Cypher: FX mit cypher → 409 ki_gestoppt
  // Über die echte Taste, nicht per vomKern: die Attrappe meldet alle 50 ms /zustand/kern mit IHREM ki_gestoppt und
  // überschrieb einen nur eingespielten Stopp vor dem nächsten POST (Wackler im Gesamtlauf 06.10., intern).
  assert.equal((await postJson(url, '/taste', { name: 'stopp' })).code, 200);
  for (let i = 0; i < 100 && !o.kiGestoppt; i++) await warte(10);
  assert.equal((await postJson(url, '/fx', fx1, CYPHER)).j.fehler, 'ki_gestoppt');
  // Slice 4: the grid is a control Cypher may set, but not while Stop Cypher holds
  for (const [p, d] of [['/deck/raster', { deck: 1, schritt_ms: 5 }], ['/deck/raster/fix', { deck: 1 }]]) {
    assert.equal((await postJson(url, p, d, CYPHER)).j.fehler, 'ki_gestoppt', p);
  }
  assert.equal((await postJson(url, '/taste', { name: 'freigabe' })).code, 200);
  for (let i = 0; i < 100 && o.kiGestoppt; i++) await warte(10);
  // Andreas' Schalter
  assert.equal((await postJson(url, '/strudel/autonom', { an: true }, CYPHER)).code, 403, '/strudel/autonom');
});

test('Hand T8: /abbruch bricht Cyphers eigene Teile ab (Quittung 7 abbruch), nur mit Kopf cypher', async (t) => {
  const { o, url } = await geladenesDeck(t);
  const r = await postJson(url, '/regler', { pfad: 'deck/1/eq/hoch', nach: -26, takte: 8, ab: 'takt' }, CYPHER);
  assert.equal(r.code, 200);
  assert.equal(r.j.felder.plan, 'cypher');
  assert.equal((await postJson(url, '/abbruch', {})).code, 403);   // Andreas hat Stop Cypher
  const a = await postJson(url, '/abbruch', {}, CYPHER);
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual([a.j.felder.quelle, a.j.felder.plan, a.j.felder.teile], ['cypher', 'cypher', '*']);
  let q = null;
  for (let i = 0; i < 100 && !q; i++) { q = (o.quittungen.get(r.j.felder.id) ?? []).find((x) => Number(x.status) === 7); await warte(20); }
  assert.ok(q, 'Quittung 7 für die Rampe'); assert.equal(q.grund, 'abbruch');
});

test('Ohr T5: GET /hoeren -> 400 unbekanntes Deck, 409 ohne geladenes Deck', async (t) => {
  const { url } = await stapel(t);
  const rDeck = await fetch(url + '/hoeren?deck=5');
  assert.equal(rDeck.status, 400);
  assert.equal((await rDeck.json()).fehler, 'deck');

  const rLeer = await fetch(url + '/hoeren?deck=2');
  assert.equal(rLeer.status, 409);
  assert.equal((await rLeer.json()).fehler, 'kein_kernstand');
});

// Ohr T8 (Plan Rev. 4): /hoeren trägt zusätzlich sync (sync_ms, deck_gegen_deck_ms, n), fest validiert:false
// (Befund Slice 2: anschlagPhase instabil an Mischungen, geht nicht ins Urteil). Eigene Ring-Datei je Fall, mit
// dem live gemeldeten Beat/BPM der Attrappe zentriert (schreibeRing importiert aus support/ring.mjs). Periodischer
// Bandsprung je Schlag (wie ear.test.mjs genSaetze), sonst findet anschlagPhase keinen Anschlag (NaN).
function saetzeMitSchlag(von, bis, bpm, { offsetMs = 5, decayMs = 20, amplitude = 0.3, baseline = 1e-4 } = {}) {
  const beatMs = 60000 / bpm;
  const n = Math.round((bis - von) * beatMs);
  return Array.from({ length: n }, (_, i) => {
    const beat = von + i / beatMs;
    const phaseMs = (beat - Math.round(beat)) * beatMs;
    const dt = ((phaseMs - offsetMs) % beatMs + beatMs) % beatMs;
    const v = baseline + amplitude * Math.exp(-dt / decayMs);
    return { sample: i, beat, quell: NaN, band: [v, v, v, v, v, v], k: 1e-3, spitze: 0.2 };
  });
}

test('Ohr T8: GET /hoeren?deck=1 trägt sync mit validiert:false, ohne Partner deck_gegen_deck_ms null', async (t) => {
  const ringPfad = path.join(fs.mkdtempSync(path.join(TMP, 'djk-huellen-t8-')), 'huellen');
  const { o, url } = await geladenesDeck(t, { huellen: ringPfad });
  const u = o.kern.uhr;
  assert.ok(u, 'kern.uhr gesetzt');
  const mitte = u.beat;
  const daten = saetzeMitSchlag(mitte - 8, mitte + 8, u.bpm);
  schreibeRing(ringPfad, { [K1]: daten, [KMASTER]: daten });
  await warte(200);   // ohrTakt liest alle 100 ms neu

  const r = await fetch(url + '/hoeren?deck=1&takte=1');
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const j = await r.json();
  assert.equal(j.sync.validiert, false);
  assert.equal(typeof j.sync.sync_ms, 'number', `sync_ms=${JSON.stringify(j.sync.sync_ms)}`);
  assert.ok(!Number.isNaN(j.sync.sync_ms) && j.sync.sync_ms !== null, `sync_ms=${j.sync.sync_ms}`);
  assert.equal(typeof j.sync.n, 'number');
  assert.equal(j.sync.deck_gegen_deck_ms, null, 'kein Partner (Deck 2 nicht offen) -> NaN -> null im JSON');
  assert.equal(j.sync.partner, null);
});

test('Ohr T8: mit laufendem, offenem Partner (Deck 2) ist deck_gegen_deck_ms eine endliche Zahl', async (t) => {
  const ringPfad = path.join(fs.mkdtempSync(path.join(TMP, 'djk-huellen-t8b-')), 'huellen');
  // I3a (Kern-Riegel, Ohr T14) nimmt Quelle andreas aus (§17 „die Hand wird nie blockiert"); dieser Test öffnet ohne
  // x-djk-quelle = andreas über /regler, braucht also keine Mutation mehr (Befund Slice 2, listening_slip.mjs).
  const { o, url, log } = await geladenesDeck(t, { huellen: ringPfad });
  assert.equal((await postJson(url, '/laden', { deck: 2, material_id: NIGHTSHIFT })).code, 200);
  for (let i = 0; i < 50 && !o.stand.decks['2']; i++) await warte(20);
  assert.equal((await postJson(url, '/deck/start', { deck: 2 })).code, 200);
  const rRegler = await postJson(url, '/regler', { pfad: 'deck/2/fader', nach: 0, ab: 'jetzt' });   // ohne x-djk-quelle = andreas, öffnet
  assert.equal(rRegler.code, 200, JSON.stringify(rRegler.j));
  for (let i = 0; i < 50 && !(o.stand.decks['2'] && Number(o.stand.decks['2'].status) >= 2 && o.stand.regler['deck/2/fader'] === 0); i++) await warte(20);
  assert.equal(o.stand.regler['deck/2/fader'], 0, `Fader 2 offen (Regler-Zustand angekommen); regler=${JSON.stringify(o.stand.regler)}; log(an_kern)=${JSON.stringify(log.filter((x) => x.typ === 'an_kern' && x.adresse === '/k/teil'))}`);
  assert.ok(Number(o.stand.decks['2']?.status) >= 2, `Deck 2 läuft (status=${o.stand.decks['2']?.status})`);

  const u = o.kern.uhr;
  const mitte = u.beat;
  const daten = saetzeMitSchlag(mitte - 8, mitte + 8, u.bpm);
  schreibeRing(ringPfad, { [K1]: daten, [KMASTER]: daten, [K2]: daten });
  await warte(200);

  const r = await fetch(url + '/hoeren?deck=1&takte=1');
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const j = await r.json();
  assert.equal(j.sync.validiert, false);
  assert.ok(Number.isFinite(j.sync.deck_gegen_deck_ms), `deck_gegen_deck_ms=${j.sync.deck_gegen_deck_ms}, sync=${JSON.stringify(j.sync)}`);
  assert.equal(j.sync.partner, 2);
});

// Task 1.5: Trim-Vorschlag relativ zum aktuellen Trim (der Mess-Abgriff liegt NACH dem Trim, live.md Posten 5)
test('Ohr 1.5: /hoeren trägt vergleich.trim_vorschlag_db = round1(trim_alt − pegel_diff_db), relativ zum gemessenen Wert', async (t) => {
  const ringPfad = path.join(fs.mkdtempSync(path.join(TMP, 'djk-huellen-t15-')), 'huellen');
  const { o, url } = await geladenesDeck(t, { huellen: ringPfad });
  o.stand.regler['deck/1/trim'] = -3;
  const u = o.kern.uhr;
  const mitte = u.beat;
  // LUFS kommt aus Satz.k (ear.ts miss): Deck ~6 dB lauter als der Master
  const deck = saetzeMitSchlag(mitte - 8, mitte + 8, u.bpm).map((x) => ({ ...x, k: 4e-3 }));
  const master = saetzeMitSchlag(mitte - 8, mitte + 8, u.bpm);
  schreibeRing(ringPfad, { [K1]: deck, [KMASTER]: master });
  await warte(200);
  const r = await fetch(url + '/hoeren?deck=1&takte=1');
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const j = await r.json();
  const diff = j.vergleich.pegel_diff_db;
  assert.ok(Number.isFinite(diff) && Math.abs(diff) > 1, `Deck lauter als Master gemessen (pegel_diff_db=${diff})`);
  assert.equal(j.vergleich.trim_vorschlag_db, Math.round((-3 - diff) * 10) / 10, JSON.stringify(j.vergleich));
  // Trim unbekannt (Seiten-Neustart, stand.regler leer): KEIN Vorschlag, dafür trim_unbekannt
  delete o.stand.regler['deck/1/trim'];
  const j0 = await (await fetch(url + '/hoeren?deck=1&takte=1')).json();
  assert.ok(!('trim_vorschlag_db' in j0.vergleich), JSON.stringify(j0.vergleich));
  assert.equal(j0.vergleich.trim_unbekannt, true);
});

async function hoerenMitK(t, kDeck, kMaster, trim = -3) {
  const ringPfad = path.join(fs.mkdtempSync(path.join(TMP, 'djk-huellen-t15k-')), 'huellen');
  const { o, url } = await geladenesDeck(t, { huellen: ringPfad });
  o.stand.regler['deck/1/trim'] = trim;
  const u = o.kern.uhr;
  const mitte = u.beat;
  const mk = (k) => saetzeMitSchlag(mitte - 8, mitte + 8, u.bpm).map((x) => ({ ...x, k }));
  schreibeRing(ringPfad, { [K1]: mk(kDeck), [KMASTER]: mk(kMaster) });
  await warte(200);
  const r = await fetch(url + '/hoeren?deck=1&takte=1');
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return (await r.json()).vergleich;
}

test('Ohr 1.5: Vorschlag wird auf [-24, +24] geklemmt (Deck ~40 dB lauter, Trim -3)', async (t) => {
  const v = await hoerenMitK(t, 10, 1e-3);
  assert.ok(v.pegel_diff_db > 30, `pegel_diff_db=${v.pegel_diff_db}`);
  assert.equal(v.trim_vorschlag_db, -24);
});

test('Ohr 1.5: stummes Deck (db10 -200, pegel_diff ~ -186) -> kein Vorschlag', async (t) => {
  const v = await hoerenMitK(t, 0, 1e-3);
  assert.ok(v.neu.lufs <= -200 && v.pegel_diff_db < -100, JSON.stringify(v));
  assert.ok(!('trim_vorschlag_db' in v) && !('trim_unbekannt' in v), JSON.stringify(v));
});

test('Ohr 1.5: pegel_diff_db keine Zahl (JSON null) -> kein Vorschlag', async (t) => {
  const v = await hoerenMitK(t, Infinity, 1e-3);
  assert.ok(typeof v.pegel_diff_db !== 'number' || !Number.isFinite(v.pegel_diff_db), JSON.stringify(v));
  assert.ok(!('trim_vorschlag_db' in v), JSON.stringify(v));
});

test('Ohr 1.5: ohne vergleich (nichts gehört) kein trim_vorschlag_db', async (t) => {
  const ringPfad = path.join(fs.mkdtempSync(path.join(TMP, 'djk-huellen-t15n-')), 'huellen');
  const { o, url } = await geladenesDeck(t, { huellen: ringPfad });
  o.stand.regler['deck/1/trim'] = -3;
  const r = await fetch(url + '/hoeren?deck=1&takte=1');
  const j = await r.json();
  assert.equal(r.status, 409, JSON.stringify(j));
  assert.ok(!('vergleich' in j) && !('trim_vorschlag_db' in j), JSON.stringify(j));
});

// ---------- Ohr T10: Hörschein je Takt an den Kern, Öffnen mit Hörschein ----------
test('Ohr T10: /regler öffnet ohne Hörschein weiter 409 kein_hoerschein, jetzt MIT urteil im Körper', async (t) => {
  const { url } = await geladenesDeck(t);
  const f = await postJson(url, '/regler', { pfad: 'deck/1/fader', nach: 0 }, CYPHER);
  assert.equal(f.code, 409);
  assert.equal(f.j.fehler, 'kein_hoerschein');
  assert.ok('urteil' in f.j, JSON.stringify(f.j));
});

test('Ohr T10: /regler öffnet MIT gültigem Hörschein (in o.hoerscheine gesetzt) -> /k/teil trägt hoerschein: hs_id', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  // Deck 1 ist über NIGHTSHIFT geladen (geladenesDeck); Inhalt-Schlüssel wie §4.5 bauen
  const inhalt = `${NIGHTSHIFT}/128000_r1`;
  // Test setzt den Schein über die Hoerscheinstelle-API (o.hoerscheine ist dieselbe Referenz wie hoerscheinstelle.scheine)
  o.hoerscheine['deck/1'] = {
    hs_id: 'ohr-1-testschein', kanal: 'deck/1', inhalt, deck: 1, bpm: 128,
    gemessen_von_beat: 0, gemessen_bis_beat: 16, gueltig_bis_beat: 1e9, quell_von: 0, quell_bis: 16, erneuerung: 0,
    sync_ms: 0, deck_gegen_deck_ms: 0, lufs_kurz: -20, pegel_diff_db: 0, baender_db: [-20, -20, -20, -20, -20, -20],
    urteil: 'ok', gruende: [], laufend_baender_db: [-20, -20, -20, -20, -20, -20],
    ueberdeckung: { sub: 0, tief: 0, tiefmitte: 0, mitte: 0, praesenz: 0, hoch: 0 },
    summe_spitze_db: -6, clip_anteil: 0, eq_vorschlag: { tief: 0, mitte: 0, hoch: 0 },
  };
  const f = await postJson(url, '/regler', { pfad: 'deck/1/fader', nach: 0 }, CYPHER);
  assert.equal(f.code, 200, JSON.stringify(f.j));
  const teil = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil').at(-1);
  assert.equal(teil.felder.hoerschein, 'ohr-1-testschein', JSON.stringify(teil.felder));
});

// ---------- Ohr T18: FX-Routing (Post Fader / Insert), Andreas' Taste ----------
const routingSendungen = (log) => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/fx/routing');

test('Ohr T18 /fx/routing: Andreas schaltet, Antwort mit Quittung, GET und /lage folgen /e/fx/routing', async (t) => {
  const { url, log } = await stapel(t);
  assert.deepEqual(await (await fetch(`${url}/fx/routing`)).json(), { routing: 'post_fader' });   // Vorgabe
  assert.equal((await (await fetch(`${url}/lage`)).json()).fx_routing, 'post_fader');
  const r = await postJson(url, '/fx/routing', { routing: 'insert' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.quittung.status, 2, JSON.stringify(r.j));   // die Attrappe nimmt an (1), startet (2), fertig (3)
  const f = routingSendungen(log);
  assert.equal(f.length, 1);
  assert.deepEqual({ ...f[0].felder, id: 0 }, { id: 0, quelle: 'andreas', routing: 1 });
  await bis(async () => (await (await fetch(`${url}/fx/routing`)).json()).routing === 'insert');
  assert.deepEqual(await (await fetch(`${url}/fx/routing`)).json(), { routing: 'insert' });   // aus /e/fx/routing des Kerns
  assert.equal((await (await fetch(`${url}/lage`)).json()).fx_routing, 'insert');
  assert.equal((await postJson(url, '/fx/routing', { routing: 'post_fader' })).code, 200);
  await bis(async () => (await (await fetch(`${url}/fx/routing`)).json()).routing === 'post_fader');
  assert.equal((await (await fetch(`${url}/lage`)).json()).fx_routing, 'post_fader');
});

test('Ohr T18 /fx/routing: Quelle cypher darf schalten (Strang 11), der Kern bekommt quelle cypher; falsche Werte 400', async (t) => {
  const { url, log } = await stapel(t);
  const r = await postJson(url, '/fx/routing', { routing: 'insert' }, { 'x-djk-quelle': 'cypher' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(routingSendungen(log).length, 1, 'Cyphers Anfrage geht an den Kern');
  assert.equal(routingSendungen(log)[0].felder.quelle, 'cypher');
  assert.equal((await postJson(url, '/fx/routing', { routing: 'post_fader' })).code, 200);
  const vorher = routingSendungen(log).length;
  for (const falsch of [{ routing: 'pre' }, { routing: 1 }, {}, { routing: null }]) {
    const x = await postJson(url, '/fx/routing', falsch);
    assert.equal(x.code, 400, JSON.stringify(falsch));
  }
  assert.equal(routingSendungen(log).length, vorher, 'Abweisungen senden nichts');
  assert.equal((await postJson(url, '/fx/routing', { routing: 'insert' })).code, 200);
  assert.equal(routingSendungen(log).length, vorher + 1);
});

test('Ohr T18 /fx/routing: der Wunsch überlebt den Kern-Neustart (insert wird nach /e/neustart erneut gesendet, post_fader nicht)', async (t) => {
  const { o, url, log } = await stapel(t, [], { live: true });
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 2, sample: 0 } });   // Vorgabe im Wunsch: nichts zu senden
  await warte(300);
  assert.equal(routingSendungen(log).length, 0, 'Negativ-Kontrolle: bei der Vorgabe wird nichts erneut gesendet');
  assert.equal((await postJson(url, '/fx/routing', { routing: 'insert' })).code, 200);
  assert.equal(routingSendungen(log).length, 1);
  await bis(async () => (await (await fetch(`${url}/fx/routing`)).json()).routing === 'insert');
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 3, sample: 0 } });   // der Kern ist neu: Vorgabe 0, alles aus
  assert.deepEqual(await (await fetch(`${url}/fx/routing`)).json(), { routing: 'post_fader' }, 'nach dem Neustart steht der Kern auf der Vorgabe');
  await bis(() => routingSendungen(log).length === 2);
  assert.equal(routingSendungen(log).length, 2, 'insert geht erneut raus');
  assert.deepEqual({ ...routingSendungen(log)[1].felder, id: 0 }, { id: 0, quelle: 'andreas', routing: 1 });
  await bis(async () => (await (await fetch(`${url}/fx/routing`)).json()).routing === 'insert');
  assert.equal((await postJson(url, '/fx/routing', { routing: 'post_fader' })).code, 200);   // Wunsch zurück auf die Vorgabe
  const n = routingSendungen(log).length;
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 4, sample: 0 } });
  await warte(300);
  assert.equal(routingSendungen(log).length, n, 'post_fader ist die Vorgabe des Kerns, nichts erneut');
});

test('Ohr T18 /fx/routing: /e/fx/routing geht an jeden Strom (zweites Fenster) und in den Stand des Stroms', async (t) => {
  const { o, url } = await stapel(t);
  const s1 = sse(url);
  await bis(() => s1.ereignisse.length > 0);
  assert.equal(s1.ereignisse[0].f.fxRouting, 'post_fader', 'Anfangsstand trägt das Routing');
  o.vomKern({ adresse: '/e/fx/routing', felder: { routing: 1 } });   // etwa aus einem anderen Fenster geschaltet
  await bis(() => s1.ereignisse.some((e) => e.a === '/e/fx/routing'));
  const e = s1.ereignisse.find((x) => x.a === '/e/fx/routing');
  assert.ok(e, 'Ereignis im Strom');
  assert.equal(e.f.routing, 1);
  const s2 = sse(url);   // ein zweites, später geöffnetes Fenster sieht den Stand sofort
  await bis(() => s2.ereignisse.length > 0);
  assert.equal(s2.ereignisse[0].f.fxRouting, 'insert');
  s1.zu(); s2.zu();
});

test('Studio S1: /strudel mit strom 2 schreibt in <ordner>2, strom 1 unberührt; AUTO je Strom; strom 4 → 400', { skip: OHNE_STRUDEL }, async (t) => {
  const d = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const { url } = await stapel(t, [], { musterOrdner: d, live: true });
  assert.equal((await postJson(url, '/strudel', { text: 's("bat_synth*4")', strom: 2 })).code, 200);
  assert.equal(fs.readFileSync(`${d}2/strom1.js`, 'utf8'), 's("bat_synth*4")\n');
  assert.equal((await (await fetch(`${url}/strudel?strom=2`)).json()).text, 's("bat_synth*4")');
  assert.equal((await (await fetch(`${url}/strudel`)).json()).text, '', 'Strom 1 leer');
  assert.equal((await postJson(url, '/strudel/autonom', { an: false, strom: 3 })).code, 200);
  assert.equal((await (await fetch(`${url}/strudel?strom=3`)).json()).autonom, false);
  assert.equal((await (await fetch(`${url}/strudel`)).json()).autonom, true, 'AUTO von Strom 1 unberührt');
  assert.equal((await postJson(url, '/strudel', { text: 's("bd")', strom: 4 })).code, 400);
  assert.equal((await fetch(`${url}/strudel?strom=0`)).status, 400);
});

test('Studio S1: /fx/zuweisung nimmt erz/2 und erz/3, nicht erz/4', async (t) => {
  const { url } = await stapel(t);
  for (const kanal of ['erz/2', 'erz/3']) assert.equal((await postJson(url, '/fx/zuweisung', { einheit: 1, kanal, an: true })).code, 200, kanal);
  assert.equal((await postJson(url, '/fx/zuweisung', { einheit: 1, kanal: 'erz/4', an: true })).code, 400);
});
