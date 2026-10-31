// Paket 1.13 Slice 6, Ende Slice A: POST /proj/stems im echten Server (Stapel mit Kern-Attrappe, Prüftrenner identitaet). HTTP zerlegt einen Clip in vier
// Stem-Spuren, GET /proj/aktuell trägt den Stand, /proj/undo nimmt es in einem Schritt zurück.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './hilfen/mediathek.mjs';
import { baueKatalog } from './hilfen/katalog.mjs';
import { wav } from './hilfen/proj_kontext.mjs';
import { ruf, warte } from './hilfen/proj_stapel.mjs';

const SHA = 'e'.repeat(64);

test('S6 HTTP: POST /proj/stems → 200 {auftrag_id}, Ende fertig, vier Stem-Spuren, ein Undo', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-stems-')); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const katalog = baueKatalog(path.join(d, 'kat'), [{ n: 1, typ: 'oneshot', pfad: wav(path.join(d, 'daten'), 'ton.wav', 2.0), dauer_s: 2.0, sha: SHA }]);
  const { url } = await stapel(t, { katalog, stems: { zusatzArgs: ['--trenner', 'identitaet'] } });
  await ruf(url, 'POST', '/proj/neu', { name: 'Stems' });
  const r = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Aufbau', befehle: [{ befehl: 'tempo_setzen', bpm: 120 },
    { befehl: 'spur_neu', art: 'audio', name: 'Ton' }, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 4, sha256: SHA }] });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const akt = async () => (await ruf(url, 'GET', '/proj/aktuell')).j;
  let ok = false;
  for (let i = 0; i < 500 && !ok; i++) {
    ok = (await akt()).projekt.spuren[0].clips[0].dekodiert === 'fertig';
    if (!ok) await new Promise((x) => setTimeout(x, 20));
  }
  assert.ok(ok, 'dekodiert');
  const s = await ruf(url, 'POST', '/proj/stems', { clip_id: 'c1' });
  assert.equal(s.code, 200, JSON.stringify(s.j));
  assert.equal(typeof s.j.auftrag_id, 'number');
  let a = null;
  for (let i = 0; i < 600; i++) { a = await akt(); if (a.stems && a.stems.zustand !== 'laeuft') break; await new Promise((x) => setTimeout(x, 100)); }
  assert.equal(a.stems.zustand, 'fertig', JSON.stringify(a.stems));
  assert.equal(a.stems.auftrag_id, s.j.auftrag_id);
  assert.equal(a.projekt.spuren.length, 5);
  assert.equal(a.projekt.spuren[0].clips[0].stumm, true);
  // S6 Task 14 (2026-10-31): die Stem-WAVs liegen im Projektordner, nicht im Katalog; /welle kannte sie nicht (404, „no waveform“ an jedem Stem-Clip)
  const stemSha = a.projekt.spuren[1].clips[0].quelle.sha256;
  const w = await fetch(`${url}/welle?sha=${stemSha}`);
  assert.equal(w.status, 200, `Welle eines Stem-Clips: ${w.status} ${await w.clone().text().catch(() => '')}`);
  assert.ok((await w.arrayBuffer()).byteLength > 0);
  assert.equal((await fetch(`${url}/welle?sha=${'d'.repeat(64)}`)).status, 404, 'eine sha, die weder Katalog noch Projekt kennt: 404 (Negativ-Kontrolle)');
  const u = await ruf(url, 'POST', '/proj/undo', { rev: a.projekt.rev });
  assert.equal(u.code, 200, JSON.stringify(u.j));
  const b = await akt();
  assert.equal(b.projekt.spuren.length, 1);
  assert.equal(b.projekt.spuren[0].clips[0].stumm, undefined);
});

test('S6 HTTP: Gründe über die Route: geraet gpu, unbekanntes Feld, Clip unbekannt', async (t) => {
  const { url } = await stapel(t, { stems: { zusatzArgs: ['--trenner', 'identitaet'] } });
  await ruf(url, 'POST', '/proj/neu', { name: 'Leer' });
  const g = await ruf(url, 'POST', '/proj/stems', { clip_id: 'c1', geraet: 'gpu' });
  assert.deepEqual([g.code, g.j.fehler], [409, 'stems_gpu_aus']);                       // D11
  assert.ok(g.j.text.length > 3);
  assert.deepEqual([(await ruf(url, 'POST', '/proj/stems', { clip_id: 'c1', x: 1 })).j.fehler], ['argument_unbekannt']);
  // Review MINOR 11c: ab Task 8 antwortet die Route vor dem ersten /zustand/kern (alle 50 ms) mit kein_kernstand; darauf warten, nicht flackern
  let r404 = null;
  for (let i = 0; i < 100; i++) {
    r404 = await ruf(url, 'POST', '/proj/stems', { clip_id: 'c1' });
    if (r404.j.fehler !== 'kein_kernstand') break;
    await warte(20);
  }
  assert.deepEqual([r404.code, r404.j.fehler], [404, 'clip_unbekannt']);
});

test('S6 HTTP (Nachzug F1): ein Bereich über 600 s → 409 stems_zu_gross mit eigenem Text, nie der Kern-Text von zu_gross', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-stems-')); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const katalog = baueKatalog(path.join(d, 'kat'), [{ n: 1, typ: 'oneshot', pfad: wav(path.join(d, 'daten'), 'ton.wav', 2.0), dauer_s: 2.0, sha: SHA }]);
  const { url } = await stapel(t, { katalog, stems: { zusatzArgs: ['--trenner', 'identitaet'] } });
  await ruf(url, 'POST', '/proj/neu', { name: 'Lang' });
  const r = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Aufbau', befehle: [{ befehl: 'tempo_setzen', bpm: 120 },
    { befehl: 'spur_neu', art: 'audio', name: 'Ton' }, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1500, sha256: SHA }] });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  for (let i = 0; i < 500; i++) { if ((await ruf(url, 'GET', '/proj/aktuell')).j.projekt.spuren[0].clips[0].dekodiert === 'fertig') break; await warte(20); }
  let s = null;
  for (let i = 0; i < 100; i++) { s = await ruf(url, 'POST', '/proj/stems', { clip_id: 'c1' }); if (s.j.fehler !== 'kein_kernstand') break; await warte(20); }
  assert.deepEqual([s.code, s.j.fehler], [409, 'stems_zu_gross'], JSON.stringify(s.j));
  assert.match(s.j.text, /longer than 600 s/);
  assert.doesNotMatch(s.j.text, /clips or notes/, 'nicht der Text des Kerns');
  assert.match(s.j.detail, /750 s of source/);
});
