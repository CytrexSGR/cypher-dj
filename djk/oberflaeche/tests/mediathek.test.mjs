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
