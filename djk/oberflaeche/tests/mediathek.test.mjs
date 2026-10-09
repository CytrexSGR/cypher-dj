// Mediathek T2 (Plan 2026-10-03-mediathek-anbindung): GET /mediathek, POST+GET /mediathek/vorbereiten
// gegen eine künstliche Mediathek-DB (Schema aus cypher-mediathek/mediathek/db.py) und einen Attrappen-Einleser
// (ein Shell-Skript als `python`, gibt die JSON-Zeile des Vertrags von werkstatt.einzeln aus). Instanz h, Port 55300, kein Kern-Ton.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Mediathek } from '../mediathek.ts';
import { baueBestand } from './hilfen/bestand.mjs';
import { REPO, HOST, sha, mid, baueEinleser, stapel, hole, post, ids, tmpMt, warte } from './hilfen/mediathek.mjs';

test('Mediathek: Datei fehlt → 503 mediathek_fehlt (Suche und Vorbereiten), kein Absturz', async (t) => {
  const s = await stapel(t, { mediathek: '/nicht/da/mediathek.sqlite' });
  assert.deepEqual(await hole(s.url, '/mediathek?text=x'), { code: 503, j: { fehler: 'mediathek_fehlt' } });
  assert.deepEqual(await post(s.url, '/mediathek/vorbereiten', { material_id: mid(2) }), { code: 503, j: { fehler: 'mediathek_fehlt' } });
  assert.equal((await hole(s.url, '/bestand')).code, 200);   // der Rest der Seite lebt
});

test('Mediathek: Suche filtert (Text, Camelot, BPM, Genre), nur Typ track', async (t) => {
  const m = tmpMt(t);
  const s = await stapel(t, { mediathek: m.db });
  const alle = await hole(s.url, '/mediathek');
  assert.equal(alle.code, 200);
  assert.deepEqual(ids(alle).sort(), [1, 2, 4], 'ohne Filter alle Track-Werke, der Loop (Werk 3) nicht');
  assert.equal(alle.j.gesamt, 3);
  assert.equal(alle.j.gesamt_genau, true);
  // Text: "tech" trifft Werk 1 (Titel von Rang 0 "Tech Wolf (Edit)"); der Loop "Tech Loop" bleibt draußen (Negativ-Kontrolle)
  assert.deepEqual(ids(await hole(s.url, '/mediathek?text=tech')), [1]);
  assert.deepEqual(ids(await hole(s.url, '/mediathek?text=ALPHA')), [1], 'Künstler, ohne Groß/Klein');
  assert.deepEqual(ids(await hole(s.url, '/mediathek?text=extended')), [1], 'Mix');
  assert.deepEqual(ids(await hole(s.url, '/mediathek?text=nichts-davon')), []);
  assert.deepEqual(ids(await hole(s.url, '/mediathek?text=%25')), [], 'Prozentzeichen ist kein Platzhalter');
  assert.deepEqual(ids(await hole(s.url, '/mediathek?camelot=5b')), [2]);
  assert.deepEqual(ids(await hole(s.url, '/mediathek?bpm=120-124')), [2]);
  assert.deepEqual(ids(await hole(s.url, '/mediathek?bpm=125-130')), [1]);
  assert.deepEqual(ids(await hole(s.url, '/mediathek?bpm=140')), [4], 'eine Zahl = genau dieser Wert');
  assert.deepEqual(ids(await hole(s.url, '/mediathek?genre=house')), [2, 1], 'Genre-Teilstring: House (Werk 2) und Tech House (Werk 1), nach Titel sortiert');
  assert.deepEqual(ids(await hole(s.url, '/mediathek?genre=house&bpm=120-124')), [2], 'Filter verknüpfen');
  assert.equal((await hole(s.url, '/mediathek?bpm=abc')).code, 400);
  const l1 = await hole(s.url, '/mediathek?limit=1');
  assert.equal(l1.j.treffer.length, 1);
  assert.equal(l1.j.gesamt, 3, 'limit schneidet Werke, gesamt bleibt');
  assert.equal((await hole(s.url, '/mediathek?limit=0')).j.treffer.length, 1, 'limit wird auf mindestens 1 gehoben');
});

test('Mediathek: Rang gewinnt über die Objekte eines Werks, bei Gleichstand das jüngste; Fassung mit vorhandener Datei', async (t) => {
  const m = tmpMt(t);
  const s = await stapel(t, { mediathek: m.db });
  const [w1] = (await hole(s.url, '/mediathek?text=wolf')).j.treffer;
  assert.equal(w1.werk_id, 1);
  assert.equal(w1.titel, 'Tech Wolf (Edit)', 'andreas (Rang 0) schlägt beatport (Rang 2), obwohl beatport jünger ist');
  assert.equal(w1.kuenstler, 'Alpha', 'Feld nur an Objekt 1 gilt für das Werk');
  assert.equal(w1.mix, 'Extended Mix', 'Feld nur an Objekt 2');
  assert.equal(w1.bpm, 127.5, 'gleicher Rang: das jüngere erhoben_am');
  assert.equal(w1.genre, 'Tech House', 'gleicher Rang: das jüngere erhoben_am');
  assert.equal(w1.camelot, '8A');
  assert.equal(w1.material_id, mid(2), 'Fassung = die mit lokal vorhandener Datei (Objekt 2), nicht die erste (Objekt 1)');
  assert.equal(w1.dauer_s, 305.0);
  assert.equal(w1.pfad_da, true);
  assert.equal(w1.im_bestand, false);
  assert.equal(w1.vorbereitung, null);
});

test('Mediathek: pfad_da false bei fehlender Datei und bei Fundort eines fremden Hosts, Prüfung gegen das Dateisystem', async (t) => {
  const m = tmpMt(t);
  const s = await stapel(t, { mediathek: m.db });
  const w2 = (await hole(s.url, '/mediathek?text=house')).j.treffer.find((x) => x.werk_id === 2);
  assert.equal(w2.pfad_da, false, 'lokaler Pfad fehlt; der Pfad des fremden Hosts existiert, zählt aber nicht');
  assert.equal(w2.material_id, mid(3));
  fs.writeFileSync(path.join(m.daten, 'gibt-es-nicht-w2.mp3'), 'x');
  const danach = (await hole(s.url, '/mediathek?text=house')).j.treffer.find((x) => x.werk_id === 2);
  assert.equal(danach.pfad_da, true, 'jeder Aufruf prüft neu, kein Schnappschuss');
});

test('Mediathek: im_bestand aus index.sqlite; vorhanden → POST 200 ohne Lauf', async (t) => {
  const m = tmpMt(t);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-mtb-')); t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bestand = baueBestand(path.join(tmp, 'bestand'), [{ material_id: mid(2), titel: 'Tech Wolf' }]);
  const e = baueEinleser(tmp);
  const s = await stapel(t, { mediathek: m.db, python: e.skript, bestand });
  const w1 = (await hole(s.url, '/mediathek?text=wolf')).j.treffer[0];
  assert.equal(w1.im_bestand, true);
  const r = await post(s.url, '/mediathek/vorbereiten', { material_id: mid(2) });
  assert.deepEqual(r, { code: 200, j: { material_id: mid(2), status: 'vorhanden' } });
  assert.equal(e.laeufe().length, 0, 'kein Prozess gestartet');
  assert.deepEqual(await hole(s.url, `/mediathek/vorbereiten?material_id=${mid(2)}`), { code: 200, j: { status: 'vorhanden' } });
});

test('Vorbereiten: Riegel (415, 403), Eingaben (400, 404, 409 datei_fehlt) — nichts gestartet, nichts an den Kern', async (t) => {
  const m = tmpMt(t);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-mtb-')); t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const e = baueEinleser(tmp);
  const s = await stapel(t, { mediathek: m.db, python: e.skript });
  const gesendet = s.o.gesendet;
  const roh = await fetch(`${s.url}/mediathek/vorbereiten`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ material_id: mid(2) }) });
  assert.equal(roh.status, 415);
  const fremd = await post(s.url, '/mediathek/vorbereiten', { material_id: mid(2) }, { origin: 'http://evil.example' });
  assert.deepEqual(fremd, { code: 403, j: { fehler: 'fremde_herkunft' } });
  assert.equal((await post(s.url, '/mediathek/vorbereiten', {})).j.fehler, 'material_id_ungueltig');
  assert.equal((await post(s.url, '/mediathek/vorbereiten', { material_id: '../../etc' })).code, 400);
  assert.deepEqual(await post(s.url, '/mediathek/vorbereiten', { material_id: '0123456789abcdef' }), { code: 404, j: { fehler: 'unbekannt' } });
  assert.deepEqual(await post(s.url, '/mediathek/vorbereiten', { material_id: mid(3) }), { code: 409, j: { fehler: 'datei_fehlt' } }, 'Werk 2: lokale Datei fehlt');
  assert.equal(e.laeufe().length, 0);
  assert.equal(s.o.gesendet, gesendet, 'kein Kern-Befehl');
});

test('Vorbereiten: Doppel-POST → ein Lauf; Befehlszeile ohne Shell; Stand laeuft → neu', async (t) => {
  const m = tmpMt(t);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-mtb-')); t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const e = baueEinleser(tmp, { schlaf: 1 });
  const s = await stapel(t, { mediathek: m.db, python: e.skript });
  const gesendet = s.o.gesendet;
  const [r1, r2] = await Promise.all([post(s.url, '/mediathek/vorbereiten', { material_id: mid(5) }), post(s.url, '/mediathek/vorbereiten', { material_id: mid(5) })]);
  assert.deepEqual(r1, { code: 202, j: { material_id: mid(5), status: 'laeuft' } });
  assert.deepEqual(r2, { code: 202, j: { material_id: mid(5), status: 'laeuft' } });
  assert.deepEqual(await hole(s.url, `/mediathek/vorbereiten?material_id=${mid(5)}`), { code: 200, j: { status: 'laeuft' } });
  const liste = (await hole(s.url, '/mediathek?text=gamma')).j.treffer[0];
  assert.equal(liste.vorbereitung, 'laeuft', 'die Trefferliste zeigt den Lauf');
  for (let i = 0; i < 100 && (await hole(s.url, `/mediathek/vorbereiten?material_id=${mid(5)}`)).j.status === 'laeuft'; i++) await warte(50);
  assert.deepEqual(await hole(s.url, `/mediathek/vorbereiten?material_id=${mid(5)}`), { code: 200, j: { status: 'neu' } });
  assert.equal(e.laeufe().length, 1, 'genau ein Prozess für zwei POST');
  const argv = e.laeufe()[0].split('\n').filter(Boolean);
  assert.deepEqual(argv, ['-m', 'werkstatt.einzeln', '--quelle', m.dateien.v4, '--titel', 'Gamma – $(touch PWNED); "x" \'y\'', '--bestand', s.bestandDir],
    'Argumente unverändert, Titel mit Shell-Zeichen kommt als EIN Argument an');
  assert.equal(fs.existsSync(path.join(REPO, 'djk', 'werkstatt', 'PWNED')), false, 'keine Shell: $(…) wurde nicht ausgeführt');
  assert.equal((await hole(s.url, '/mediathek?text=gamma')).j.treffer[0].vorbereitung, null, 'fertig: Anzeige wieder leer');
  assert.equal(s.o.gesendet, gesendet, 'kein Kern-Befehl');
});

test('Vorbereiten: Einleser meldet fehler → Stand fehler mit Grund, Anzeige fehler:<grund>; ohne JSON → exit_<rc>', async (t) => {
  const m = tmpMt(t);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-mtb-')); t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const e = baueEinleser(tmp, { ausgabe: '{"status":"fehler","material_id":"x","grund":"format"}', rc: 1 });
  const s = await stapel(t, { mediathek: m.db, python: e.skript });
  assert.equal((await post(s.url, '/mediathek/vorbereiten', { material_id: mid(5) })).code, 202);
  for (let i = 0; i < 100 && (await hole(s.url, `/mediathek/vorbereiten?material_id=${mid(5)}`)).j.status === 'laeuft'; i++) await warte(50);
  assert.deepEqual(await hole(s.url, `/mediathek/vorbereiten?material_id=${mid(5)}`), { code: 200, j: { status: 'fehler', grund: 'format' } });
  assert.equal((await hole(s.url, '/mediathek?text=gamma')).j.treffer[0].vorbereitung, 'fehler:format');
  assert.deepEqual(await hole(s.url, '/mediathek/vorbereiten?material_id=0123456789abcdef'), { code: 404, j: { fehler: 'unbekannt' } });
  // nach einem Fehler darf es erneut versucht werden
  assert.equal((await post(s.url, '/mediathek/vorbereiten', { material_id: mid(5) })).code, 202);
  assert.equal(e.laeufe().length >= 1, true);
});

test('Vorbereiten: Einleser nicht startbar (Programm fehlt) → fehler start, Server lebt', async (t) => {
  const m = tmpMt(t);
  const s = await stapel(t, { mediathek: m.db, python: '/nicht/da/python' });
  assert.equal((await post(s.url, '/mediathek/vorbereiten', { material_id: mid(5) })).code, 202);
  for (let i = 0; i < 100 && (await hole(s.url, `/mediathek/vorbereiten?material_id=${mid(5)}`)).j.status === 'laeuft'; i++) await warte(50);
  const st = (await hole(s.url, `/mediathek/vorbereiten?material_id=${mid(5)}`)).j;
  assert.equal(st.status, 'fehler');
  assert.match(st.grund, /^(start|exit_\d+)$/, 'nice kann das Programm nicht ausführen → exit 127 oder Startfehler');
});

test('Vorbereiten: höchstens 2 gleichzeitig → dritte mid 429 ausgelastet', async (t) => {
  const m = tmpMt(t);
  // Werk 1 (Objekt 2) und Werk 4 (Objekt 5) laufen; ein drittes Objekt mit Datei kommt dazu
  const extra = path.join(m.daten, 'drei.mp3'); fs.writeFileSync(extra, 'x');
  const db = new DatabaseSync(m.db);
  db.prepare('INSERT INTO objekt(inhalt_sha256, werk_id, dauer_s, erstmals_gesehen) VALUES (?,?,?,?)').run(sha(9), 2, 100, '2026-03-01');
  db.prepare('INSERT INTO fundort(host, pfad, inhalt_sha256, erreichbar) VALUES (?,?,?,1)').run(HOST, extra, sha(9));
  db.close();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-mtb-')); t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const e = baueEinleser(tmp, { schlaf: 2 });
  const s = await stapel(t, { mediathek: m.db, python: e.skript });
  assert.equal((await post(s.url, '/mediathek/vorbereiten', { material_id: mid(2) })).code, 202);
  assert.equal((await post(s.url, '/mediathek/vorbereiten', { material_id: mid(5) })).code, 202);
  assert.deepEqual(await post(s.url, '/mediathek/vorbereiten', { material_id: mid(9) }), { code: 429, j: { fehler: 'ausgelastet' } });
  assert.equal((await post(s.url, '/mediathek/vorbereiten', { material_id: mid(2) })).code, 202, 'ein laufender Auftrag bleibt ansprechbar');
  assert.equal(e.laeufe().length, 2, 'der dritte wurde nicht gestartet');
});

test('Mediathek: GET /mediathek schreibt nichts in die Mediathek (readOnly)', async (t) => {
  const m = tmpMt(t);
  const s = await stapel(t, { mediathek: m.db });
  const vorher = fs.statSync(m.db);
  await hole(s.url, '/mediathek?text=tech');
  await hole(s.url, '/mediathek');
  const nachher = fs.statSync(m.db);
  assert.equal(nachher.mtimeMs, vorher.mtimeMs);
  assert.equal(nachher.size, vorher.size);
  assert.deepEqual(fs.readdirSync(path.dirname(m.db)).sort(), ['mediathek.sqlite', 'musik'], 'keine -wal/-shm/-journal angelegt');
});

test('Mediathek: liegt das ZWEITE Objekt eines Werks im Bestand, liefert der Treffer dessen material_id (im_bestand true); POST auf das erste → vorhanden mit der Bestands-mid', async (t) => {
  const m = tmpMt(t);
  // Werk 1: Objekt 1 (Datei fehlt) und Objekt 2 (Datei da). Zusätzlich Objekt 1 ERSTES mit existierender Datei machen,
  // damit "erste existierende" (Objekt 1) NICHT das im Bestand liegende (Objekt 2) ist.
  fs.writeFileSync(path.join(m.daten, 'gibt-es-nicht-a1.mp3'), 'x');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-mtb-')); t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bestand = baueBestand(path.join(tmp, 'bestand'), [{ material_id: mid(2), titel: 'Tech Wolf' }]);
  const e = baueEinleser(tmp);
  const s = await stapel(t, { mediathek: m.db, python: e.skript, bestand });
  const w1 = (await hole(s.url, '/mediathek?text=wolf')).j.treffer[0];
  assert.equal(w1.material_id, mid(2), 'die Fassung im Bestand, nicht die erste existierende (Objekt 1)');
  assert.equal(w1.im_bestand, true);
  assert.equal(w1.pfad_da, true);
  const r = await post(s.url, '/mediathek/vorbereiten', { material_id: mid(1) });
  assert.deepEqual(r, { code: 200, j: { material_id: mid(2), status: 'vorhanden' } });
  assert.equal(e.laeufe().length, 0, 'kein zweiter Render');
});

test('Mediathek.felder: Werk-Felder je material_id, bestand_mid über Geschwister, pfad_da am Dateisystem', (t) => {
  const m = tmpMt(t);
  const mt = new Mediathek(m.db, HOST);
  const f = mt.felder([mid(1), mid(3), mid(5), '0000000000000000'], new Set([mid(2)]));
  assert.equal(f.get(mid(1)).titel, 'Tech Wolf (Edit)');        // Rang andreas gewinnt über das Werk
  assert.equal(f.get(mid(1)).bestand_mid, mid(2));              // Geschwister im Bestand → ladbar über mid(2)
  assert.equal(f.get(mid(1)).pfad_da, true);
  assert.equal(f.get(mid(3)).pfad_da, false);                   // Werk 2: lokale Datei fehlt
  assert.equal(f.get(mid(3)).bestand_mid, null);
  assert.equal(f.get(mid(5)).bpm, 140);
  assert.equal(f.has('0000000000000000'), false);               // unbekannt → fehlt in der Map
});

// ---- Klänge (Plan 2026-10-06-klaenge, T1): GET /klaenge ----
const pf = (r) => r.j.treffer.map((x) => path.basename(x.pfad ?? x.name));
const loopAnlegen = (dir, name) => { fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, 'loop.json'), JSON.stringify({ schema: 1, name, datei: 'loop.f32', beats: 4, bpm: 128, frames: 90000, quelle: 'test' }));
  fs.writeFileSync(path.join(dir, name, 'loop.f32'), Buffer.alloc(90000 * 8)); };

test('Klänge: Text trifft Pfad/pack/kategorie/instrument/titel, keine Tracks, kein Platzhalter', async (t) => {
  const m = tmpMt(t);
  const s = await stapel(t, { mediathek: m.db });
  const r = await hole(s.url, '/klaenge?text=piano');
  assert.equal(r.code, 200);
  assert.deepEqual(pf(r).sort(), ['GrandPiano C3 mf.aif', 'Piano C3.aif']);
  assert.equal(r.j.gesamt, 2); assert.equal(r.j.gesamt_genau, true);
  assert.deepEqual(pf(await hole(s.url, '/klaenge?text=PLATE')), ['Plate.aif'], 'Pfad, ohne Groß/Klein');
  assert.deepEqual(pf(await hole(s.url, '/klaenge?text=convolution')), ['Plate.aif'], 'pack');
  assert.deepEqual(pf(await hole(s.url, '/klaenge?text=grand')), ['GrandPiano C3 mf.aif'], 'kategorie');
  assert.equal((await hole(s.url, '/klaenge?text=dark%20pad')).j.treffer.length, 1, 'titel trifft, Pfad hat nur Bindestriche');
  assert.deepEqual((await hole(s.url, '/klaenge?text=nichts-davon')).j.treffer, []);
  assert.deepEqual((await hole(s.url, '/klaenge?text=%25')).j.treffer, [], 'Prozentzeichen ist kein Platzhalter');
  assert.deepEqual((await hole(s.url, '/klaenge?text=wolf')).j.treffer, [], 'Tracks sind keine Klänge');
  assert.equal((await hole(s.url, '/klaenge')).j.gesamt, 4, 'ohne Filter alle vier Klänge, ein Treffer je sha trotz zweitem Fundort');
});

test('Klänge: Felder je Treffer und Einsatzstufe', async (t) => {
  const m = tmpMt(t);
  const s = await stapel(t, { mediathek: m.db });
  const [a, b] = (await hole(s.url, '/klaenge?text=piano')).j.treffer;
  for (const x of [a, b]) for (const k of ['sha', 'pfad', 'pfad_da', 'typ', 'pack', 'kategorie', 'dauer_s', 'bpm', 'camelot', 'einsatz']) assert.ok(k in x, k);
  const ableton = [a, b].find((x) => x.pfad.endsWith('Piano C3.aif') && !x.pfad.includes('Grand'));
  const offen = [a, b].find((x) => x.pfad.includes('Grand'));
  assert.equal(ableton.einsatz, 'nur_live'); assert.equal(ableton.sha, sha(11)); assert.equal(ableton.pack, 'Upright'); assert.equal(ableton.pfad_da, false);
  assert.equal(offen.einsatz, 'werkstatt'); assert.equal(offen.pack, 'Multisamples'); assert.equal(offen.kategorie, 'Grand Piano'); assert.equal(offen.instrument, 'piano');
  assert.equal(offen.dauer_s, 2.0); assert.equal(offen.pfad_da, true); assert.equal(offen.quelle, 'mediathek');
});

test('Klänge: Filter typ, einsatz, pack, bpm, camelot', async (t) => {
  const m = tmpMt(t);
  const s = await stapel(t, { mediathek: m.db });
  assert.deepEqual(pf(await hole(s.url, '/klaenge?typ=impuls')), ['Plate.aif']);
  assert.deepEqual(pf(await hole(s.url, '/klaenge?einsatz=werkstatt')).sort(), ['GrandPiano C3 mf.aif', 'Plate.aif', 'dark-pad-01.wav']);
  assert.deepEqual(pf(await hole(s.url, '/klaenge?einsatz=nur_live')), ['Piano C3.aif']);
  assert.deepEqual(pf(await hole(s.url, '/klaenge?pack=multisamples')), ['GrandPiano C3 mf.aif']);
  assert.deepEqual(pf(await hole(s.url, '/klaenge?bpm=126-130')), ['dark-pad-01.wav']);
  assert.deepEqual(pf(await hole(s.url, '/klaenge?bpm=100-110')), []);
  assert.deepEqual(pf(await hole(s.url, '/klaenge?camelot=8a')), ['dark-pad-01.wav']);
  assert.equal((await hole(s.url, '/klaenge?bpm=abc')).code, 400);
  assert.equal((await hole(s.url, '/klaenge?typ=track')).code, 400, 'Tracks sind kein Klang-Typ');
});

test('Klänge: eigene Loops kommen als sofort vor den Mediathek-Treffern', async (t) => {
  const m = tmpMt(t);
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-kl-loops-')); t.after(() => fs.rmSync(loops, { recursive: true, force: true }));
  loopAnlegen(loops, 'abnahme-x'); loopAnlegen(loops, 'piano-schleife');
  const s = await stapel(t, { mediathek: m.db, loops });
  const r = await hole(s.url, '/klaenge?text=abnahme');
  assert.equal(r.j.treffer.length, 1);
  assert.deepEqual([r.j.treffer[0].einsatz, r.j.treffer[0].typ, r.j.treffer[0].quelle, r.j.treffer[0].name], ['sofort', 'loop', 'loopbib', 'abnahme-x']);
  const p = (await hole(s.url, '/klaenge?text=piano')).j.treffer;
  assert.equal(p.length, 3);
  assert.equal(p[0].quelle, 'loopbib', 'Loop-Bibliothek zuerst');
  assert.deepEqual(p.slice(1).map((x) => x.quelle), ['mediathek', 'mediathek']);
  assert.equal((await hole(s.url, '/klaenge?text=abnahme&einsatz=werkstatt')).j.treffer.length, 0, 'Einsatzfilter gilt auch für Loops');
});

test('Klänge: limit (Vorgabe 30, höchstens 200), gesamt bleibt', async (t) => {
  const m = tmpMt(t);
  const s = await stapel(t, { mediathek: m.db });
  const r = await hole(s.url, '/klaenge?limit=1');
  assert.equal(r.j.treffer.length, 1); assert.equal(r.j.gesamt, 4); assert.equal(r.j.gesamt_genau, true);
  assert.equal((await hole(s.url, '/klaenge?limit=0')).j.treffer.length, 1);
  assert.equal((await hole(s.url, '/klaenge?limit=999')).j.treffer.length, 4);
  const db = new DatabaseSync(m.db);
  for (let i = 100; i < 140; i++) {
    db.prepare('INSERT INTO objekt(inhalt_sha256, dauer_s) VALUES (?,1)').run(sha(i));
    db.prepare('INSERT INTO angabe(inhalt_sha256, feld, wert, quelle, erhoben_am) VALUES (?,?,?,?,?)').run(sha(i), 'typ', 'oneshot', 'tag', '2026-01-01');
    db.prepare('INSERT INTO fundort(host, pfad, inhalt_sha256, erreichbar) VALUES (?,?,?,1)').run(HOST, `/nix/da/viele-${i}.wav`, sha(i));
  }
  db.close();
  const v = await hole(s.url, '/klaenge');
  assert.equal(v.j.treffer.length, 30, 'Vorgabe 30'); assert.equal(v.j.gesamt, 44);
});

test('Klänge: Mediathek fehlt → 200 mediathek:"fehlt", eigene Loops kommen trotzdem', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-kl-loops-')); t.after(() => fs.rmSync(loops, { recursive: true, force: true }));
  loopAnlegen(loops, 'abnahme-x');
  const s = await stapel(t, { mediathek: '/nicht/da/mediathek.sqlite', loops });
  const r = await hole(s.url, '/klaenge?text=abnahme');
  assert.equal(r.code, 200); assert.equal(r.j.mediathek, 'fehlt'); assert.equal(r.j.treffer.length, 1);
  assert.deepEqual((await hole(s.url, '/klaenge?text=nichts-davon')).j, { treffer: [], gesamt: 0, gesamt_genau: true, mediathek: 'fehlt' });
});

// ---- Klänge-Karte (Plan 2026-10-06-klaenge, T2): GET /klaenge/karte ----
test('Karte: Zahlen je Typ, Packs, Loop-Bibliothek, Stand, exakt gegen die Fixture', async (t) => {
  const m = tmpMt(t);
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-kl-loops-')); t.after(() => fs.rmSync(loops, { recursive: true, force: true }));
  loopAnlegen(loops, 'abnahme-x'); loopAnlegen(loops, 'zweite');
  const s = await stapel(t, { mediathek: m.db, loops });
  const r = await hole(s.url, '/klaenge/karte');
  assert.equal(r.code, 200);
  const z = (gesamt, sofort, werkstatt, nur_live) => ({ gesamt, sofort, werkstatt, nur_live });
  assert.deepEqual(r.j.je_typ, { oneshot: z(2, 0, 1, 1), loop: z(3, 2, 1, 0), impuls: z(1, 0, 1, 0), mitschnitt: z(0, 0, 0, 0), erzeugt: z(0, 0, 0, 0), stimme: z(0, 0, 0, 0) },
    'Tracks zählen nicht, die zwei Loops der Bibliothek zählen als sofort und im Gesamt von loop');
  assert.deepEqual(r.j.packs, [{ pack: 'Convolution Reverb', gesamt: 1, nur_live: 0 }, { pack: 'Multisamples', gesamt: 1, nur_live: 0 }, { pack: 'Upright', gesamt: 1, nur_live: 1 }]);
  assert.equal(r.j.loopbib, 2);
  assert.equal(r.j.mediathek_stand, new Date(fs.statSync(m.db).mtimeMs).toISOString());
  assert.ok(Math.abs(Date.parse(r.j.erzeugt_am) - Date.now()) < 60000);
  // Negativ-Kontrolle: nach einem Scan (DB-mtime neu) kommt die neue Zahl, nicht die zwischengespeicherte
  const db = new DatabaseSync(m.db);
  db.prepare('INSERT INTO objekt(inhalt_sha256, dauer_s) VALUES (?,1)').run(sha(200));
  db.prepare('INSERT INTO angabe(inhalt_sha256, feld, wert, quelle, erhoben_am) VALUES (?,?,?,?,?)').run(sha(200), 'typ', 'stimme', 'tag', '2026-01-01');
  db.prepare('INSERT INTO fundort(host, pfad, inhalt_sha256, erreichbar) VALUES (?,?,?,1)').run(HOST, '/nix/da/stimme.wav', sha(200));
  db.close();
  const spaeter = new Date(Date.now() + 5000); fs.utimesSync(m.db, spaeter, spaeter);
  assert.equal((await hole(s.url, '/klaenge/karte')).j.je_typ.stimme.gesamt, 1);
});

test('Karte: Mediathek fehlt → 200 mediathek:"fehlt", Nullzahlen, Loop-Bibliothek zählt', async (t) => {
  const loops = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-kl-loops-')); t.after(() => fs.rmSync(loops, { recursive: true, force: true }));
  loopAnlegen(loops, 'abnahme-x');
  const s = await stapel(t, { mediathek: '/nicht/da/mediathek.sqlite', loops });
  const r = await hole(s.url, '/klaenge/karte');
  assert.equal(r.code, 200); assert.equal(r.j.mediathek, 'fehlt'); assert.equal(r.j.loopbib, 1);
  assert.deepEqual(r.j.je_typ.loop, { gesamt: 1, sofort: 1, werkstatt: 0, nur_live: 0 }); assert.deepEqual(r.j.packs, []);
});

test('Klänge: Klang nur auf fremdem Host fehlt in Suche und Karte (Host-Filter)', async (t) => {
  const m = tmpMt(t);
  const s = await stapel(t, { mediathek: m.db });
  assert.deepEqual((await hole(s.url, '/klaenge?text=fremd')).j.treffer, [], 'weder Pfad noch pack des Fremd-Objekts');
  assert.equal((await hole(s.url, '/klaenge')).j.gesamt, 4);
  assert.equal((await hole(s.url, '/klaenge?typ=oneshot')).j.gesamt, 2);
  const k = (await hole(s.url, '/klaenge/karte')).j;
  assert.equal(k.je_typ.oneshot.gesamt, 2); assert.ok(!k.packs.some((x) => x.pack === 'Fremdpack'));
  // Positiv-Kontrolle: das Objekt ist in der DB und nur der Host trennt es
  const db = new DatabaseSync(m.db, { readOnly: true });
  assert.equal(db.prepare("SELECT count(*) n FROM fundort WHERE pfad LIKE '%Fremdklang%'").get().n, 1); db.close();
});

test('Klänge: Text vergleicht den Pfad erst ab der Wurzel, nicht das Präfix', async (t) => {
  const m = tmpMt(t);
  const s = await stapel(t, { mediathek: m.db });
  assert.deepEqual((await hole(s.url, '/klaenge?text=live')).j.treffer, [], 'Wort nur im Wurzel-Präfix (Zwerg_live)');
  assert.deepEqual((await hole(s.url, '/klaenge?text=_')).j.treffer, [], 'Unterstrich nur im Präfix');
  assert.deepEqual((await hole(s.url, '/klaenge?text=zwerg')).j.treffer, []);
  assert.deepEqual(pf(await hole(s.url, '/klaenge?text=upright')), ['Piano C3.aif'], 'Positiv-Kontrolle: Name unterhalb der Wurzel trifft');
  assert.deepEqual(pf(await hole(s.url, '/klaenge?text=packs/upright')), ['Piano C3.aif'], 'relativer Teil mit Ordner trifft');
});

test('Klänge: limit=abc fällt auf 30, nicht auf 50', async (t) => {
  const m = tmpMt(t);
  const db = new DatabaseSync(m.db);
  for (let i = 300; i < 360; i++) {
    db.prepare('INSERT INTO objekt(inhalt_sha256, dauer_s) VALUES (?,1)').run(sha(i));
    db.prepare('INSERT INTO angabe(inhalt_sha256, feld, wert, quelle, erhoben_am) VALUES (?,?,?,?,?)').run(sha(i), 'typ', 'oneshot', 'tag', '2026-01-01');
    db.prepare('INSERT INTO fundort(host, pfad, inhalt_sha256, erreichbar) VALUES (?,?,?,1)').run(HOST, `/nix/da/viele-${i}.wav`, sha(i));
  }
  db.close();
  const s = await stapel(t, { mediathek: m.db });
  assert.equal((await hole(s.url, '/klaenge?limit=abc')).j.treffer.length, 30);
  assert.equal((await hole(s.url, '/klaenge?limit=')).j.treffer.length, 30);
});
