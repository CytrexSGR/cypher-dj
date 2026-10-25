// D1 S3: /proj/freeze im echten Server (Spec 3.4, 2.10, 6.23, 6.32, 6.33, 6.34): Bereich proj-ausgabe neben proj, Schutz fremdePost vor dem
// Handler, Quelle aus x-djk-quelle, KI-Stopp, Kern-Ereignisse über den Haken, /e/freeze im Strom, ein ganzer Freeze durch die Kern-Attrappe
// (K3: /k/arr/freeze schreibt die Datei in arr_ordner, den der Stapel ihr per --konfig gibt) und die Freeze-Sperre an den Routen.
// Kern-Attrappe, Test-Instanz aus CYPHERDJ_TEST_INSTANZ (Auftrag S3: Route-Tests auf d, nie g oder h). Kein Ton.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stapel, post, warte, startArr1 } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { ruf, CYPHER } from './hilfen/proj_stapel.mjs';

const kopfJson = { 'content-type': 'application/json' };

test('proj-ausgabe: Routen nach proj gemeldet, Schutz fremdePost, Körper unlesbar 400, ohne Projekt kein_projekt, KI-Stopp nur für cypher', async (t) => {
  const { o, url } = await stapel(t);
  const i = innen(o);
  const routen = o.routen();
  assert.deepEqual(routen.filter((r) => r.pfad === '/proj/freeze').map((r) => [r.bereich, r.methode, r.schutz]), [['proj-ausgabe', 'POST', 'fremdePost']],
    'genau eine Route, im Bereich proj-ausgabe');
  assert.ok(routen.findIndex((r) => r.bereich === 'proj') < routen.findIndex((r) => r.bereich === 'proj-ausgabe'), 'proj vor proj-ausgabe');
  const n0 = i.gesendet;
  const roh = await fetch(`${url}/proj/freeze`, { method: 'POST', body: '{}' });
  assert.deepEqual([roh.status, (await roh.json()).fehler], [415, 'nur_json']);
  const fremd = await fetch(`${url}/proj/freeze`, { method: 'POST', headers: { ...kopfJson, origin: 'https://boese.example' }, body: '{}' });
  assert.deepEqual([fremd.status, (await fremd.json()).fehler], [403, 'fremde_herkunft']);
  const kaputt = await fetch(`${url}/proj/freeze`, { method: 'POST', headers: kopfJson, body: '{"spur_id":' });
  const kj = await kaputt.json();
  assert.deepEqual([kaputt.status, kj.fehler], [400, 'argument_ungueltig']);
  assert.match(kj.text, /^unreadable request body/, 'englischer text (Spec 6.34)');
  const ohne = await post(url, '/proj/freeze', { spur_id: 's1', an: true });
  assert.deepEqual([ohne.code, ohne.j.fehler, ohne.j.text], [409, 'kein_projekt', 'no project is open']);
  i.vomKern('/e/ki', { gestoppt: 1, grund: 'hand', sample: 0 });
  const ki = await post(url, '/proj/freeze', { spur_id: 's1', an: true }, { 'x-djk-quelle': 'cypher' });
  assert.deepEqual([ki.code, ki.j.fehler], [409, 'ki_gestoppt']);
  const hand = await post(url, '/proj/freeze', { spur_id: 's1', an: true });
  assert.deepEqual([hand.code, hand.j.fehler], [409, 'kein_projekt'], 'Negativ-Kontrolle: Andreas sperrt der KI-Stopp nicht');
  i.vomKern('/e/ki', { gestoppt: 0, grund: '', sample: 0 });
  assert.equal(i.gesendet, n0, 'nichts an den Kern');
});

test('Strom: /e/freeze geht an /strom (Spec 3.4 DURCHREICHEN), /zustand/box weiter nicht', async (t) => {
  const { o, url } = await stapel(t);
  const ereignisse = [];
  const ac = new AbortController();
  t.after(() => ac.abort());
  (async () => { const s = await fetch(`${url}/strom`, { signal: ac.signal }); for await (const teil of s.body) ereignisse.push(new TextDecoder().decode(teil)); })().catch(() => {});
  for (let n = 0; n < 50 && ereignisse.length === 0; n++) await warte(20);
  innen(o).vomKern('/zustand/box', { box: 1, belegt: 0 });
  innen(o).vomKern('/e/freeze', { spur: 3, kennung: 7, status: 0, frames: 4800 });
  for (let n = 0; n < 50 && !ereignisse.join('').includes('/e/freeze'); n++) await warte(20);
  assert.ok(ereignisse.join('').includes('data: {"a":"/e/freeze","f":{"spur":3,"kennung":7,"status":0,"frames":4800}}'), ereignisse.join('').slice(-400));
  assert.ok(!ereignisse.join('').includes('/zustand/box'));
});

// Projekt mit einer Surge-Spur (s1) und einem Takt Noten, Projekttempo = Master-Tempo der Attrappe (128): keine Rampe vor dem Freeze
async function mitSurge(url, o) {
  assert.equal((await ruf(url, 'POST', '/proj/neu', { name: 'S3 Route' })).code, 200);
  const rev = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt.rev;
  const r = await ruf(url, 'POST', '/proj/aendern', { rev, label: 'Aufbau', befehle: [
    { befehl: 'tempo_setzen', bpm: 128 },
    { befehl: 'spur_neu', art: 'instrument', name: 'Lead', geraet: { art: 'wirt' } },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 1, noten: [{ beat: 0, laenge: 0.5, ton: 60, vel: 90 }] },
    { befehl: 'spur_neu', art: 'instrument', name: 'Bass', geraet: { art: 'intern' } }] });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  // tempo_setzen schickt eine Rampe (120 → 128, ab dem nächsten Takt, 4 Beats); solange sie offen ist, lehnt der Kern jeden Freeze ab (6.33)
  const t = r.j.kern.tempo;
  assert.ok(t && Number.isFinite(t.ab_beat), JSON.stringify(r.j.kern));
  for (let n = 0; n < 400 && !((o.kern.uhr?.beat ?? 0) > t.ab_beat + t.dauer_beats + 0.25); n++) await warte(20);
  const geladen = () => ruf(url, 'GET', '/proj/aktuell').then((a) => a.j.kern.rev_geladen === a.j.projekt.wiedergabe_rev && a.j.kern.status === 0);
  for (let n = 0; n < 150 && !(await geladen()); n++) await warte(20);
  assert.ok(await geladen(), 'die Attrappe hat die Wiedergabe geladen');
  assert.equal(Math.round((o.kern.uhr?.bpm ?? 0) * 100) / 100, 128, 'Master-Tempo der Attrappe');
}
const aktuell = async (url) => (await ruf(url, 'GET', '/proj/aktuell')).j;

test('Freeze durch die Kern-Attrappe: Datei im Arbeitsordner, sha256, ausgabe_lauf während des Laufs, Sperre an den Routen (Noten, Tempo 409, Fader 200)', async (t) => {
  const st = await stapel(t); await startArr1(st, t);
  const { o, url, optionen } = st;
  await mitSurge(url, o);
  const vorher = await aktuell(url);
  assert.equal(vorher.ausgabe_lauf, null);
  const nid = vorher.projekt.spuren[0].clips[0].noten[0].id;
  const lauf = ruf(url, 'POST', '/proj/freeze', { spur_id: 's1', an: true });
  let waehrend = null;
  for (let n = 0; n < 100 && !waehrend?.ausgabe_lauf; n++) { waehrend = await aktuell(url); if (!waehrend.ausgabe_lauf) await warte(10); }
  assert.deepEqual(waehrend.ausgabe_lauf, { art: 'freeze', spur_id: 's1' }, 'Spec 6.34: GET /proj/aktuell zeigt den Lauf');
  // Spec 6.23, 6.32: unter der Sperre Noten 409, POST /tempo 409, Fader 200
  const note = await ruf(url, 'POST', '/proj/aendern', { rev: waehrend.projekt.rev, label: 'Note', befehle: [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: nid, ton: 61 }] }] });
  assert.deepEqual([note.code, note.j.fehler], [409, 'beschaeftigt'], JSON.stringify(note.j));
  assert.match(note.j.text, /freeze is running/);
  const tempo = await ruf(url, 'POST', '/tempo', { bpm: 130 });
  assert.deepEqual([tempo.code, tempo.j.fehler], [409, 'beschaeftigt']);
  const fader = await ruf(url, 'POST', '/proj/aendern', { rev: waehrend.projekt.rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -3 }] });
  assert.equal(fader.code, 200, JSON.stringify(fader.j));
  const r = await lauf;
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const f = r.j.projekt.spuren.find((s) => s.id === 's1').freeze;
  const datei = path.join(optionen.proj.arbeitsordner, f.datei);
  assert.equal(f.datei, `freeze-1-${f.kennung}.f32`);
  assert.ok(f.kennung > vorher.projekt.wiedergabe_rev, 'Kennung aus dem Wiedergabe-Zähler (Spec 6.25)');
  assert.equal(fs.statSync(datei).size, f.frames * 8, 'die Attrappe schrieb frames · 8 Bytes');
  assert.equal(f.sha256, crypto.createHash('sha256').update(fs.readFileSync(datei)).digest('hex'));
  assert.equal(f.von_beat, 0);
  const nachher = await aktuell(url);
  assert.equal(nachher.ausgabe_lauf, null, 'ausgabe_lauf wieder null');
  assert.deepEqual(nachher.projekt.spuren.find((s) => s.id === 's2').fader_db, -3, 'der Fader während des Freeze bleibt');
  // nach der Freigabe geht die Notenänderung durch und verwirft den Freeze (Spec 3.3); die Wiedergabe wird nachgeladen
  for (let n = 0; n < 100 && (await aktuell(url)).kern.rev_geladen !== (await aktuell(url)).projekt.wiedergabe_rev; n++) await warte(20);
  const danach = await ruf(url, 'POST', '/proj/aendern', { rev: nachher.projekt.rev, label: 'Note', befehle: [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: nid, ton: 61 }] }] });
  assert.equal(danach.code, 200, JSON.stringify(danach.j));
  assert.equal(danach.j.projekt.spuren[0].freeze, null);
  assert.ok(fs.existsSync(datei), 'die Freeze-Datei bleibt für Undo liegen');
});

test('Spec 6.33: offene Tempo-Rampe in der Attrappe → /proj/freeze 409 beschaeftigt mit Ursache, Projekt unverändert, Sperre frei', async (t) => {
  const st = await stapel(t); await startArr1(st, t);
  const { o, url } = st;
  await mitSurge(url, o);
  const vorher = await aktuell(url);
  // eine Rampe 128 → 128: der Master bleibt beim Projekttempo (tempoAnMaster tut nichts), die Rampe ist im Kern offen (wartet oder läuft)
  const tempo = await ruf(url, 'POST', '/tempo', { bpm: 128 }, CYPHER);
  assert.equal(tempo.code, 200, JSON.stringify(tempo.j));
  const r = await ruf(url, 'POST', '/proj/freeze', { spur_id: 's1', an: true });
  assert.deepEqual([r.code, r.j.fehler], [409, 'beschaeftigt'], JSON.stringify(r.j));
  assert.equal(r.j.text, 'the core is still ramping the tempo; a freeze waits until the ramp is done');
  const jetzt = await aktuell(url);
  assert.equal(jetzt.projekt.rev, vorher.projekt.rev, 'Projekt unverändert');
  assert.equal(jetzt.ausgabe_lauf, null);
  const nid = jetzt.projekt.spuren[0].clips[0].noten[0].id;
  const note = await ruf(url, 'POST', '/proj/aendern', { rev: jetzt.projekt.rev, label: 'Note', befehle: [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: nid, ton: 62 }] }] });
  assert.equal(note.code, 200, `Sperre frei: ${JSON.stringify(note.j)}`);
});

// Paket S3, Slice 2: Export über die Route mit dem Render-Doppel (CYPHERDJ_RENDER, pfade.ts renderProgramm) und dem echten ffmpeg; die Surge-Spur
// friert vorher durch die Kern-Attrappe ein (K3), die Antwort ist schmal (kein Projekt).
test('Export über die Route: Surge-Spur vorher eingefroren, WAV im Projektordner export/, regler_quelle, Lautheit, ausgabe_lauf; laufender Transport 409', async (t) => {
  const alt = process.env.CYPHERDJ_RENDER;
  process.env.CYPHERDJ_RENDER = path.join(import.meta.dirname, 'hilfen', 'render_attrappe.mjs');
  t.after(() => { if (alt === undefined) delete process.env.CYPHERDJ_RENDER; else process.env.CYPHERDJ_RENDER = alt; });
  const st = await stapel(t); await startArr1(st, t);
  const { o, url, optionen } = st;
  assert.deepEqual(o.routen().filter((r) => r.pfad === '/proj/export').map((r) => [r.bereich, r.methode, r.schutz]), [['proj-ausgabe', 'POST', 'fremdePost']]);
  const roh = await fetch(`${url}/proj/export`, { method: 'POST', body: '{}' });
  assert.deepEqual([roh.status, (await roh.json()).fehler], [415, 'nur_json'], 'Schutz fremdePost vor dem Handler');
  await mitSurge(url, o);
  const vorher = await aktuell(url);
  // laufender Transport: 409 transport_laeuft, nichts geschrieben
  const start = await ruf(url, 'POST', '/proj/transport', { aktion: 'start' });
  assert.equal(start.code, 200, JSON.stringify(start.j));
  for (let n = 0; n < 150 && (await aktuell(url)).kern.status !== 2; n++) await warte(20);
  const laeuft = await ruf(url, 'POST', '/proj/export', { von_beat: 0, bis_beat: 8 });
  assert.deepEqual([laeuft.code, laeuft.j.fehler, laeuft.j.text], [409, 'transport_laeuft', 'stop the transport first']);
  assert.equal((await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' })).code, 200);
  for (let n = 0; n < 150 && (await aktuell(url)).kern.status !== 0; n++) await warte(20);
  const lauf = ruf(url, 'POST', '/proj/export', { von_beat: 0, bis_beat: 8 }, CYPHER);
  let waehrend = null;
  for (let n = 0; n < 100 && !waehrend?.ausgabe_lauf; n++) { waehrend = await aktuell(url); if (!waehrend.ausgabe_lauf) await warte(10); }
  assert.deepEqual(waehrend.ausgabe_lauf, { art: 'export' }, 'Spec 6.34: auch während des Freeze im Export heißt der Lauf export');
  const r = await lauf;
  assert.equal(r.code, 200, JSON.stringify(r.j));
  // 1.10 Slice 2: drei Felder neu (abgriff, limiter_db_max, ueber_decke), sonst schmal
  assert.deepEqual(Object.keys(r.j).sort(), ['abgriff', 'datei', 'frames', 'limiter_db_max', 'lra', 'lufs_i', 'regler_quelle', 'spitze_db', 'true_peak_dbtp', 'ueber_decke'], 'schmale Antwort');
  assert.equal(r.j.frames, Math.round(8 * 60 / 128 * 48000));
  assert.match(r.j.datei, new RegExp(`/${vorher.slug}/export/${vorher.slug}-\\d{8}-\\d{6}\\.wav$`));
  assert.ok(r.j.datei.startsWith(path.resolve(optionen.proj.wurzel)), `Export im Projektordner des Stapels (tmp): ${r.j.datei}`);
  assert.ok(fs.statSync(r.j.datei).size > 44);
  assert.equal(r.j.regler_quelle, 'kern');
  assert.equal(r.j.spitze_db, -6.021);
  assert.ok(Number.isFinite(r.j.lufs_i) && Number.isFinite(r.j.true_peak_dbtp) && r.j.lra === 0, JSON.stringify(r.j));
  const nachher = await aktuell(url);
  assert.equal(nachher.ausgabe_lauf, null);
  const f = nachher.projekt.spuren.find((s) => s.id === 's1').freeze;
  assert.ok(f && fs.existsSync(path.join(optionen.proj.arbeitsordner, f.datei)), 'die Surge-Spur wurde vorher eingefroren (Spec 2.5)');
  const v = (await ruf(url, 'GET', '/proj/verlauf')).j;
  assert.deepEqual([v.at(-1).label, v.at(-1).quelle], ['Freeze Lead', 'cypher']);
  // zweiter Export: nichts mehr einzufrieren, eigener Name
  const r2 = await ruf(url, 'POST', '/proj/export', {});
  assert.equal(r2.code, 200, JSON.stringify(r2.j));
  assert.notEqual(r2.j.datei, r.j.datei);
  assert.deepEqual(fs.readdirSync(path.dirname(r.j.datei)).sort(), [path.basename(r.j.datei), path.basename(r2.j.datei)].sort(), 'nur die WAVs bleiben');
  // Spec 6.31 (Werkzeug proj_freeze): ?antwort=kurz liefert rev, spur_id und das Freeze-Feld, nicht das Projekt; ohne Abfrage das ganze Projekt
  const kurzSchon = await ruf(url, 'POST', '/proj/freeze?antwort=kurz', { spur_id: 's1', an: true }, CYPHER);
  assert.deepEqual(kurzSchon.j, { rev: nachher.projekt.rev, spur_id: 's1', freeze: f }, 'schon eingefroren: nichts geändert, kurz');
  const kurzAus = await ruf(url, 'POST', '/proj/freeze?antwort=kurz', { spur_id: 's1', an: false }, CYPHER);
  assert.deepEqual(kurzAus.j, { rev: nachher.projekt.rev + 1, spur_id: 's1', freeze: null });
  const voll = await ruf(url, 'POST', '/proj/freeze', { spur_id: 's1', an: false });
  assert.deepEqual(Object.keys(voll.j).sort(), ['projekt', 'rev'], 'Negativ-Kontrolle: die Seite bekommt das ganze Projekt');
});

// Fix-Runde S3, R7: Server-Stopp mitten im Freeze. stoppe() schließt die Ausgabe: der wartende Freeze endet sofort mit freeze_fehler (Ursache:
// Server endet), Timer und Sperre frei, http.close wartet nicht auf die Stille-Grenze (2 s) oder die Frist. Vorher hielt der Freeze den Stopp.
test('R7: stoppe() mitten im Freeze antwortet sofort freeze_fehler (server is shutting down), Sperre frei, stoppe() hängt nicht', async (t) => {
  const st = await stapel(t); await startArr1(st, t);
  const { o, url } = st;
  await mitSurge(url, o);
  const vorher = await aktuell(url);
  // langer Clip: der Freeze läuft rund 31 s (66 Beats bei 128 BPM)
  const lang = await ruf(url, 'POST', '/proj/aendern', { rev: vorher.projekt.rev, label: 'lang', befehle: [{ befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 64 }] });
  assert.equal(lang.code, 200, JSON.stringify(lang.j));
  for (let n = 0; n < 150 && (await aktuell(url)).kern.rev_geladen !== (await aktuell(url)).projekt.wiedergabe_rev; n++) await warte(20);
  const lauf = ruf(url, 'POST', '/proj/freeze', { spur_id: 's1', an: true });
  let waehrend = null;
  for (let n = 0; n < 100 && !waehrend?.ausgabe_lauf; n++) { waehrend = await aktuell(url); if (!waehrend.ausgabe_lauf) await warte(10); }
  assert.deepEqual(waehrend.ausgabe_lauf, { art: 'freeze', spur_id: 's1' });
  await warte(300);                                                     // der Kern läuft (Quittung 1, /e/freeze steht aus)
  const ausgabe = o.ausgabe?.ausgabe;                                   // der Bereich proj-ausgabe (server.ts hält ihn für stoppe())
  const t0 = Date.now();
  await o.stoppe();
  const dauer = Date.now() - t0;
  const r = await lauf;
  t.diagnostic(`stoppe ${dauer} ms, Antwort ${JSON.stringify(r.j)}`);
  assert.deepEqual([r.code, r.j.fehler], [502, 'freeze_fehler'], JSON.stringify(r.j));
  assert.match(r.j.text, /server is shutting down/, r.j.text);
  assert.ok(dauer < 1000, `stoppe() wartet nicht auf Stille oder Frist (${dauer} ms)`);
  if (ausgabe) assert.deepEqual(ausgabe.zustand(), { lauf: null, wartend: 0, abbruch: 0 }, 'keine Uhr, kein Wartender');
  assert.equal(o.proj.sitzung.ladenGesperrt(), false, 'Sperre frei');
});
