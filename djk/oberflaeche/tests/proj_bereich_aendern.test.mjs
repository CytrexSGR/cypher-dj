// Bereich proj am Stapel, D1 S2-Integration Slice 4: ändern (1 MiB, rev, Quelle cypher), SSE proj, Verlauf, Undo, Audio aus dem Katalog.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { stapel } from './hilfen/mediathek.mjs';
import { bis, sse, ruf, warte, CYPHER } from './hilfen/proj_stapel.mjs';
import { baueKatalog, ksha } from './hilfen/katalog.mjs';
import { wav } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';
import { GRUND_TEXT } from '../http/gruende.ts';   // Spec 6.34: jede Antwort mit Grund trägt einen englischen text

test('Körperlimit 1 MiB auf /proj/aendern (Spec 3.4): darüber 413 koerper_zu_gross, knapp darunter wird gelesen', async (t) => {
  const { url } = await stapel(t);
  const gross = await ruf(url, 'POST', '/proj/aendern', `{"rev":0,"label":"x","befehle":[],"f":"${'a'.repeat(1024 * 1024)}"}`);
  assert.deepEqual([gross.code, gross.j.fehler], [413, 'koerper_zu_gross']);
  const knapp = await ruf(url, 'POST', '/proj/aendern', `{"rev":0,"label":"x","befehle":[],"f":"${'a'.repeat(1024 * 1024 - 60)}"}`);
  assert.deepEqual([knapp.code, knapp.j.fehler], [409, 'kein_projekt'], 'knapp unter 1 MiB wird gelesen (Negativ-Kontrolle)');
});

test('ändern als Cypher mit der Kern-Attrappe: neue Wiedergabe geladen, SSE proj mit Quelle und Label, Verlauf, Undo, nichts_zu_tun, rev_veraltet', async (t) => {
  const { url } = await stapel(t);
  const s = sse(url); t.after(s.zu);
  await ruf(url, 'POST', '/proj/neu', { name: 'First Track' });
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Setup', befehle: [{ befehl: 'spur_neu', art: 'instrument', name: 'Bass' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [{ beat: 0, laenge: 1, ton: 36, vel: 100 }] }] }, CYPHER);
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.kern.wiedergabe.quittung.status, 3);
  assert.ok(await bis(() => s.ereignisse.some((e) => e.a === 'proj' && e.f.rev === 1 && e.f.quelle === 'cypher' && e.f.label === 'Setup')));
  const v = (await ruf(url, 'GET', '/proj/verlauf')).j;
  assert.deepEqual(v.map((e) => [e.rev, e.art, e.quelle, e.label]), [[1, 'aendern', 'cypher', 'Setup']]);
  assert.equal(typeof v[0].zeit, 'number');
  const u = await ruf(url, 'POST', '/proj/undo', { rev: 1 });
  assert.deepEqual([u.code, u.j.rev, u.j.projekt.spuren.length], [200, 2, 0]);
  assert.deepEqual(await ruf(url, 'POST', '/proj/undo', { rev: 2 }), { code: 409, j: { fehler: 'nichts_zu_tun', text: GRUND_TEXT.nichts_zu_tun, detail: 'nichts_zu_tun: nichts zum Rückgängigmachen' } });
  assert.deepEqual((await ruf(url, 'POST', '/proj/aendern', { rev: 1, label: 'alt', befehle: [{ befehl: 'spur_neu', art: 'audio' }] })).j, { fehler: 'rev_veraltet', text: GRUND_TEXT.rev_veraltet, rev: 2 });
  const f = await ruf(url, 'POST', '/proj/aendern', { rev: 2, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'gibtsnicht' }] });
  assert.deepEqual([f.code, f.j.fehler, f.j.index], [400, 'befehl_unbekannt', 1]);
  assert.equal((await ruf(url, 'POST', '/proj/redo', { rev: 2 })).j.rev, 3);
});

test('Audio aus dem Katalog: clip_neu mit sha256, Dekodieren meldet SSE proj {clip_id, dekodiert} ohne neue rev, dann neue Wiedergabe', async (t) => {
  const d = tmpOrdner(t, 'djk-projkat-');
  const kick = wav(path.join(d, 'daten'), 'kick.wav');
  const katalog = baueKatalog(path.join(d, 'kat'), [{ n: 1, typ: 'oneshot', pfad: kick, dauer_s: 0.25 }]);
  const { url } = await stapel(t, { katalog });
  const s = sse(url); t.after(s.zu);
  await ruf(url, 'POST', '/proj/neu', { name: 'Kick' });
  await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
  const c = await ruf(url, 'POST', '/proj/aendern', { rev: 1, label: 'Kick', befehle: [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: ksha(1) }] });
  assert.equal(c.code, 200, JSON.stringify(c.j));
  const clip = c.j.projekt.spuren[0].clips[0];
  assert.ok(await bis(() => s.ereignisse.some((e) => e.a === 'proj' && e.f.clip_id === clip.id && e.f.dekodiert === 'fertig'), 15000));
  let akt;   // die neue Wiedergabe lädt der Server nach dem Dekodieren (seriell hinter dem SSE-Ereignis)
  for (let i = 0; i < 100; i++) { akt = await ruf(url, 'GET', '/proj/aktuell'); if (akt.j.projekt.wiedergabe_rev > c.j.projekt.wiedergabe_rev) break; await warte(50); }
  assert.equal(akt.j.projekt.rev, 2); assert.equal(akt.j.projekt.spuren[0].clips[0].dekodiert, 'fertig');
  assert.ok(akt.j.projekt.wiedergabe_rev > c.j.projekt.wiedergabe_rev, 'nach dem Dekodieren eine neue Wiedergabe');
  assert.deepEqual((await ruf(url, 'POST', '/proj/aendern', { rev: 2, label: 'x', befehle: [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 2, laenge_beats: 1, sha256: 'e'.repeat(64) }] })).j,
    { fehler: 'sha_unbekannt', text: GRUND_TEXT.sha_unbekannt, index: 0 });
});
