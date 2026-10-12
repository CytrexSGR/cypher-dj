// Fortschritt beim Vorbereiten: der Vorbereiter liest die Fortschrittszeilen (`@@fortschritt {json}`) von stderr des
// Einlesers und reicht Stufe, Prozent, vergangene Zeit und „hängt“ über den Stand durch. Attrappen-Einleser sind
// Shell-Skripte, die genau diese Zeilen schreiben (das Format steht in djk/werkstatt/werkstatt/fortschritt.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { Vorbereiter, cpuTicksBaum, liesFortschrittsZeichen } from '../mediathek.ts';
import { stapel, hole, post, mid, tmpMt, warte } from './hilfen/mediathek.mjs';

const Z = (stufe, name, prozent = null, teil = null) => `@@fortschritt ${JSON.stringify({ stufe, von: 5, name, prozent, teil })}`;
const tmpDir = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-vf-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
function skript(dir, koerper) {
  const p = path.join(dir, 'einleser.sh');
  fs.writeFileSync(p, `#!/bin/sh\n${koerper}\n`, { mode: 0o755 });
  return p;
}
const bis = async (f, ms = 5000) => { const t0 = Date.now(); for (;;) { const r = f(); if (r) return r; if (Date.now() - t0 > ms) assert.fail('Bedingung nicht eingetreten'); await warte(20); } };
function vorbereiter(t, dir, sh, extra = {}) {
  const v = new Vorbereiter({ python: sh, cwd: dir, bestand: dir, ...extra });
  t.after(() => v.stoppe());
  return v;
}

test('Stand während des Laufs: Stufe, Anzahl, Name, Prozent aus den Zeilen von stderr', async (t) => {
  const d = tmpDir(t);
  const sh = skript(d, `echo '${Z(1, 'decode')}' >&2\necho '${Z(2, 'beats', null, 'tracking')}' >&2\necho '${Z(4, 'render', 40)}' >&2\nexec sleep 30`);
  const v = vorbereiter(t, d, sh);
  assert.equal(v.starte('m1', '/q', 'T'), 'gestartet');
  const st = await bis(() => { const s = v.stand('m1'); return s?.prozent === 40 ? s : null; });
  assert.equal(st.status, 'laeuft');
  assert.deepEqual([st.stufe, st.von, st.name, st.prozent], [4, 5, 'render', 40]);
  assert.equal(st.haengt, false);
});

test('Zwischenschritt ohne Prozent: teil kommt durch, Prozent ist null (nicht geschätzt)', async (t) => {
  const d = tmpDir(t);
  const v = vorbereiter(t, d, skript(d, `echo '${Z(2, 'beats', null, 'tracking')}' >&2\nexec sleep 30`));
  v.starte('m1', '/q', 'T');
  const st = await bis(() => v.stand('m1')?.name === 'beats' && v.stand('m1'));
  assert.deepEqual([st.teil, st.prozent], ['tracking', null]);
});

test('vergangene Zeit und „hängt“ aus der Uhr: keine Meldung seit 60 s → haengt; neue Meldung → wieder nicht', async (t) => {
  const d = tmpDir(t);
  const go = path.join(d, 'go');
  execFileSync('mkfifo', [go]);   // blockierendes read: keine CPU (eine Schlafschleife würde CPU-Zeit sammeln und als Lebenszeichen zählen)
  const sh = skript(d, `echo '${Z(2, 'beats', null, 'tracking')}' >&2\nread x < '${go}'\necho '${Z(3, 'key')}' >&2\nexec sleep 30`);
  let jetzt = 1_000_000;
  const v = vorbereiter(t, d, sh, { jetzt: () => jetzt });
  v.starte('m1', '/q', 'T');
  await bis(() => v.stand('m1')?.name === 'beats');
  jetzt += 59_000;
  let st = v.stand('m1');
  assert.equal(st.vergangen_s, 59);
  assert.equal(st.ohne_fortschritt_s, 59);
  assert.equal(st.haengt, false, '59 s ist noch nicht 60');
  jetzt += 2_000;
  st = v.stand('m1');
  assert.deepEqual([st.vergangen_s, st.ohne_fortschritt_s, st.haengt], [61, 61, true]);
  fs.writeFileSync(go, '');
  st = await bis(() => v.stand('m1')?.name === 'key' && v.stand('m1'));
  assert.equal(st.haengt, false, 'eine neue Meldung setzt die Uhr zurück');
  assert.equal(st.ohne_fortschritt_s, 0);
  assert.equal(st.vergangen_s, 61, 'die Gesamtzeit läuft weiter');
});

test('Lauf ohne jede Meldung hängt ab Start: Zeit seit dem Start zählt als Zeit ohne Fortschritt', async (t) => {
  const d = tmpDir(t);
  let jetzt = 5_000;
  const v = vorbereiter(t, d, skript(d, "exec sleep 30"), { jetzt: () => jetzt, haengtNachMs: 10_000 });
  v.starte('m1', '/q', 'T');
  jetzt += 10_000;
  const st = v.stand('m1');
  assert.deepEqual([st.status, st.stufe, st.haengt, st.ohne_fortschritt_s], ['laeuft', undefined, true, 10]);
});

test('Zeile in zwei Stücken (kein Zeilenende im ersten Chunk) wird erst ganz gelesen; Müll und Fremdzeilen werden ignoriert', async (t) => {
  const d = tmpDir(t);
  const z = Z(4, 'render', 12.5);
  const sh = skript(d, `echo 'einzeln: irgendein Log' >&2\necho '@@fortschritt {kaputt' >&2\necho '@@fortschritt {"stufe":"x"}' >&2\nprintf '%s' '${z.slice(0, 20)}' >&2\nsleep 0.3\necho '${z.slice(20)}' >&2\nexec sleep 30`);
  const v = vorbereiter(t, d, sh);
  v.starte('m1', '/q', 'T');
  const st = await bis(() => v.stand('m1')?.prozent === 12.5 && v.stand('m1'));
  assert.deepEqual([st.stufe, st.name], [4, 'render']);
});

test('Ende neu: Stand bleibt genau { status: neu }; Ende fehler: Grund und die Stufe, bei der es riss', async (t) => {
  const d = tmpDir(t);
  const gut = vorbereiter(t, d, skript(d, `echo '${Z(1, 'decode')}' >&2\necho '{"status":"neu","material_id":"abc"}'`));
  gut.starte('m1', '/q', 'T');
  await bis(() => gut.stand('m1')?.status === 'neu');
  assert.deepEqual(gut.stand('m1'), { status: 'neu' });
  const schlecht = vorbereiter(t, d, skript(d, `echo '${Z(1, 'decode')}' >&2\necho '${Z(2, 'beats', null, 'tracking')}' >&2\necho '{"status":"fehler","material_id":"","grund":"ValueError: kaputt"}'\nexit 1`));
  schlecht.starte('m2', '/q', 'T');
  await bis(() => schlecht.stand('m2')?.status === 'fehler');
  assert.deepEqual(schlecht.stand('m2'), { status: 'fehler', grund: 'ValueError: kaputt', stufe: 2, von: 5, name: 'beats' });
  assert.equal(schlecht.anzeige('m2'), 'fehler:ValueError: kaputt', 'die Trefferliste behält ihren Text');
});

test('Zeitlimit mitten in einer Stufe: fehler zeitlimit mit der Stufe', async (t) => {
  const d = tmpDir(t);
  const v = vorbereiter(t, d, skript(d, `echo '${Z(4, 'render', 10)}' >&2\nexec sleep 30`), { zeitlimitMs: 300 });
  v.starte('m1', '/q', 'T');
  await bis(() => v.stand('m1')?.status === 'fehler');
  assert.deepEqual(v.stand('m1'), { status: 'fehler', grund: 'zeitlimit', stufe: 4, von: 5, name: 'render' });
});

test('Endpunkt GET /mediathek/vorbereiten reicht Stufe und Prozent des echten Laufs durch', async (t) => {
  const m = tmpMt(t);
  const d = tmpDir(t);
  const sh = skript(d, `echo '${Z(1, 'decode')}' >&2\necho '${Z(4, 'render', 40)}' >&2\nsleep 1\necho '{"status":"neu","material_id":"x"}'`);
  const s = await stapel(t, { mediathek: m.db, python: sh });
  assert.equal((await post(s.url, '/mediathek/vorbereiten', { material_id: mid(5) })).code, 202);
  let j;
  for (let i = 0; i < 100; i++) { j = (await hole(s.url, `/mediathek/vorbereiten?material_id=${mid(5)}`)).j; if (j.prozent === 40) break; await warte(30); }
  assert.equal(j.status, 'laeuft');
  assert.deepEqual([j.stufe, j.von, j.name, j.prozent, j.haengt], [4, 5, 'render', 40, false]);
  assert.equal(typeof j.vergangen_s, 'number');
  for (let i = 0; i < 100 && (await hole(s.url, `/mediathek/vorbereiten?material_id=${mid(5)}`)).j.status === 'laeuft'; i++) await warte(50);
  assert.deepEqual((await hole(s.url, `/mediathek/vorbereiten?material_id=${mid(5)}`)).j, { status: 'neu' });
});

// ---- Review M1/R1/R2: Lebenszeichen von aussen (CPU-Zeit des Prozessbaums aus /proc); m1: Teilzeilen und nacktes \r ----
const Z1 = (stufe, name, teil) => Z(stufe, name, null, teil);
// Feste CPU-ARBEIT statt fester Wanduhr-Dauer: auf einem belasteten Host (der Vorbereiter startet nice 19) dauert sie länger, sie endet erst,
// wenn sie wirklich gerechnet wurde. Eine einzige C-Schleife in Kindern (head | sha256sum), nie eine Meldung.
const rechne = (gb) => `head -c ${gb}000000000 /dev/zero | sha256sum >/dev/null 2>&1`;

// Bekommt der Rechenprozess in 150 s keine CPU (Host voll, der Vorbereiter startet nice 19), gibt es auch keinen Fortschritt: „haengt“ wäre dort
// ehrlich. Der Test kann dann nichts belegen und meldet das als SKIP mit Grund, nicht als grün und nicht als Fehler.
const VOLL = 'Host zu voll: der Rechenprozess (nice 19) bekam in 150 s nicht genug CPU, um fertig zu werden';

// Beobachtet im 40-ms-Takt, bis `fertig` da ist (höchstens 150 s); liefert { n, haengt, dauer_ms } aller Abfragen.
async function bisFertig(v, mid, fertig) {
  const t0 = Date.now(); let n = 0, haengt = 0;
  while (!fs.existsSync(fertig) && Date.now() - t0 < 150_000) { const st = v.stand(mid); n++; if (st?.haengt) haengt++; await warte(40); }
  return { n, haengt, dauer_ms: Date.now() - t0, fertig: fs.existsSync(fertig) };
}

test('R1: Kind rechnet in C-Schleifen (kein Python, keine Meldung) viel länger als die Schwelle → nie haengt; Stufe und Prozent bleiben', async (t) => {
  const d = tmpDir(t); const fertig = path.join(d, 'fertig');
  const v = vorbereiter(t, d, skript(d, `echo '${Z1(2, 'beats', 'tracking')}' >&2\n${rechne(15)}\ntouch '${fertig}'\nexec sleep 30`), { haengtNachMs: 1500 });
  v.starte('m1', '/q', 'T');
  await bis(() => v.stand('m1')?.name === 'beats');
  const r = await bisFertig(v, 'm1', fertig);
  if (!r.fertig) return t.skip(VOLL);
  assert.ok(r.dauer_ms > 3500, `Arbeit muss deutlich länger als die Schwelle (1,5 s) laufen: ${r.dauer_ms} ms`);
  assert.equal(r.haengt, 0, `haengt trotz rechnendem Kind: ${r.haengt} von ${r.n} Abfragen`);
  const st = v.stand('m1');
  assert.deepEqual([st.name, st.stufe, st.prozent, st.teil], ['beats', 2, null, 'tracking'], 'das Lebenszeichen ändert Stufe und Prozent nicht');
});

test('R1 NEGATIV-KONTROLLE: Kind macht nur sleep → haengt nach der Schwelle', async (t) => {
  const d = tmpDir(t);
  const v = vorbereiter(t, d, skript(d, `echo '${Z1(2, 'beats', 'tracking')}' >&2\nsleep 30 &\nwait`), { haengtNachMs: 300 });
  v.starte('m1', '/q', 'T');
  await bis(() => v.stand('m1')?.name === 'beats');
  await warte(1800);   // deutlich über der Schwelle; ein schlafender Baum wächst nicht
  assert.equal(v.stand('m1').haengt, true);
});

test('R1: ein ENKEL rechnet, der direkte Prozess und das Kind warten → nie haengt (Nachfahren-Summe)', async (t) => {
  const d = tmpDir(t); const fertig = path.join(d, 'fertig');
  const v = vorbereiter(t, d, skript(d, `echo '${Z1(2, 'beats', 'tempo')}' >&2\nsh -c "${rechne(15)}; touch '${fertig}'; sleep 30" &\nwait`), { haengtNachMs: 1500 });
  v.starte('m1', '/q', 'T');
  await bis(() => v.stand('m1')?.name === 'beats');
  const r = await bisFertig(v, 'm1', fertig);
  if (!r.fertig) return t.skip(VOLL);
  assert.ok(r.dauer_ms > 3500, `Arbeit muss deutlich länger als die Schwelle laufen: ${r.dauer_ms} ms`);
  assert.equal(r.haengt, 0, `haengt trotz rechnendem Enkel: ${r.haengt} von ${r.n} Abfragen`);
});

test('R1: nach dem Ende der Rechnung (CPU wächst nicht mehr) → haengt nach der Schwelle', async (t) => {
  const d = tmpDir(t); const fertig = path.join(d, 'fertig');
  const v = vorbereiter(t, d, skript(d, `${rechne(1)}\ntouch '${fertig}'\nexec sleep 30`), { haengtNachMs: 400 });
  v.starte('m1', '/q', 'T');
  if (!(await bis(() => fs.existsSync(fertig), 150_000).catch(() => false))) return t.skip(VOLL);
  await bis(() => v.stand('m1')?.haengt === true, 6000);
});

test('R2: cpuTicksBaum zählt beendete Kinder (cutime/cstime); nicht lesbar → null', async (t) => {
  const d = tmpDir(t);
  const fertig = path.join(d, 'fertig');
  const p = spawn(skript(d, `${rechne(3)}\ntouch '${fertig}'\nexec sleep 30`), { stdio: 'ignore' });
  t.after(() => p.kill('SIGKILL'));
  if (!(await bis(() => fs.existsSync(fertig), 150_000).catch(() => false))) return t.skip(VOLL);
  const ticks = cpuTicksBaum(p.pid);
  assert.ok(ticks !== null && ticks >= 100, `beendete Kinder (3 GB sha256, über 1 s CPU) müssen zählen, gemessen ${ticks} Ticks`);
  assert.equal(cpuTicksBaum(2 ** 22 + 12345), null, 'Prozess nicht da → null');
  assert.equal(cpuTicksBaum(p.pid, () => { throw new Error('EACCES'); }), null, '/proc unlesbar → null');
});

test('R1: Prozess weg oder /proc unlesbar → sauber „kein Fortschritt“, kein Wurf', async (t) => {
  const d = tmpDir(t);
  let jetzt = 1_000;
  const v = vorbereiter(t, d, skript(d, 'exec sleep 30'), { jetzt: () => jetzt, haengtNachMs: 10_000 });
  v.starte('m1', '/q', 'T');
  jetzt += 11_000;
  assert.equal(v.stand('m1').haengt, true);
});

test('N1: Meldung mit Fremdtext samt } dahinter, Stufe außerhalb 1..von und von < 1 werden nicht angenommen', () => {
  assert.deepEqual(liesFortschrittsZeichen(Z(2, 'beats') + ' fremd } text }').map((z) => z.name), ['beats'], 'Fremdtext mit } schluckt die Meldung nicht');
  assert.deepEqual(liesFortschrittsZeichen('@@fortschritt {"stufe": 99, "von": 5, "name": "erfunden"}'), []);
  assert.deepEqual(liesFortschrittsZeichen('@@fortschritt {"stufe": 0, "von": 5, "name": "null"}'), []);
  assert.deepEqual(liesFortschrittsZeichen('@@fortschritt {"stufe": 1, "von": 0, "name": "leer"}'), []);
  assert.deepEqual(liesFortschrittsZeichen('@@fortschritt {"stufe": 1, "von": 5, "name": "a}b", "teil": "x}"}').map((z) => [z.name, z.teil]), [['a}b', 'x}']], '} in Zeichenketten');
});

test('m1: nacktes \\r beendet die Zeile: eine Meldung davor wird gelesen, auch wenn nach dem \\r Fremdtext mit } ohne Zeilenende folgt', async (t) => {
  const d = tmpDir(t);
  const v = vorbereiter(t, d, skript(d, `printf '%s\\r Rest }' '${Z(3, 'key')}' >&2\nexec sleep 30`));
  v.starte('m1', '/q', 'T');
  await bis(() => v.stand('m1')?.name === 'key');
});

test('m1: Meldung nach Teilzeile ohne Zeilenende, nach nacktem \\r und zwei Meldungen in einer Zeile kommen an', async (t) => {
  const d = tmpDir(t);
  const sh = skript(d, `printf 'halbe zeile ohne ende' >&2\necho '${Z(1, 'decode')}' >&2\nprintf ' 50%%|###\\r' >&2\nprintf '%s\\n' '${Z(2, 'beats')}' >&2\nprintf '%s%s\\n' '${Z(3, 'key')}' '${Z(4, 'render', 33)}' >&2\nexec sleep 30`);
  const v = vorbereiter(t, d, sh);
  v.starte('m1', '/q', 'T');
  const st = await bis(() => v.stand('m1')?.prozent === 33 && v.stand('m1'));
  assert.deepEqual([st.stufe, st.name], [4, 'render'], 'die letzte der Meldungen gilt, keine ging verloren');
});

test('m1: Kontrolle mit Fremdzeilen davor und danach, kaputtes JSON in der Mitte schluckt die nächste Meldung nicht', async (t) => {
  const d = tmpDir(t);
  const sh = skript(d, `echo 'Warnung: irgendwas' >&2\nprintf '%s%s\\n' '@@fortschritt {kaputt' '${Z(2, 'beats', null, 'tempo')}' >&2\nexec sleep 30`);
  const v = vorbereiter(t, d, sh);
  v.starte('m1', '/q', 'T');
  const st = await bis(() => v.stand('m1')?.name === 'beats' && v.stand('m1'));
  assert.equal(st.teil, 'tempo');
});

import { standardKatalog } from './hilfen/katalog.mjs';
test('m2: /stoebern liefert nach FAILED Grund und Stufe (die Seite zeigt sie nach F5); ein Track ohne Lauf bekommt keinen Grund', async (t) => {
  const d = tmpDir(t);
  const sh = skript(d, `echo '${Z(1, 'decode')}' >&2\necho '${Z(4, 'render', 40)}' >&2\necho '{"status":"fehler","material_id":"","grund":"ValueError: kaputt"}'\nexit 1`);
  const s = await stapel(t, { katalog: standardKatalog(t).datei, python: sh });
  const liste = async () => (await hole(s.url, '/stoebern?typ=track')).j.treffer;
  const wolf = (await liste()).find((x) => x.titel === 'Tech Wolf');
  assert.equal(wolf.status, 'prepare');
  assert.equal('grund' in wolf, false);
  assert.equal(s.o.vorbereiter.starte(wolf.material_id, '/q', 'T'), 'gestartet');
  await bis(() => s.o.vorbereiter.stand(wolf.material_id)?.status === 'fehler');
  const nach = (await liste()).find((x) => x.titel === 'Tech Wolf');
  assert.deepEqual([nach.status, nach.grund, nach.grund_stufe], ['fehler', 'ValueError: kaputt', 'render']);
  assert.equal('grund' in (await liste()).find((x) => x.titel === 'Acid Rain'), false, 'Negativ: andere Tracks ohne Grund');
});
