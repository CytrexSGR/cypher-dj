// 1.8 Task 26: /proj/aufnahme im echten Server mit der Kern-Attrappe (rec.mjs). Ein ganzer Take: Start, Stopp, Rohdatei bleibt, WAV = Kopf + Rohdatei, sha,
// ein Clip, EIN Undo; dazu die Ablehnungen und die Sperren während des Laufs.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, ruf, anKern, CYPHER, warte } from './hilfen/proj_stapel.mjs';
import { GRUND_TEXT } from '../http/gruende.ts';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-rec-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

// Projekt mit einer Audio-Spur "Gitarre", die auf erz/1 scharf ist; liefert Spur-Daten und das Projekttempo
async function projektScharf(url, name) {
  await ruf(url, 'POST', '/proj/neu', { name });
  const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Spur', befehle: [{ befehl: 'tempo_setzen', bpm }, { befehl: 'spur_neu', art: 'audio', name: 'Gitarre' }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const p = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  const b = await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'Arm', befehle: [{ befehl: 'spur_aendern', spur_id: p.spuren[0].id, eingang: { art: 'intern', name: 'erz/1' }, arm: true }] });
  assert.equal(b.code, 200, JSON.stringify(b.j));
  return { id: p.spuren[0].id, nr: p.spuren[0].nr, bpm, rev: b.j.rev ?? (await ruf(url, 'GET', '/proj/aktuell')).j.projekt.rev };
}

test('Aufnahme: ein ganzer Take durch die Attrappe, WAV bitgleich zur Rohdatei, ein Clip, ein Undo-Schritt, Dateien bleiben', async (t) => {
  const d = tmp(t);
  const arr = path.join(d, 'arr');
  const { url, log } = await stapel(t, { proj: { arbeitsordner: arr } });
  const { nr, bpm } = await projektScharf(url, 'Rec');
  const st = await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 });
  assert.equal(st.code, 200, JSON.stringify(st.j));
  const kennung = st.j.kennung;
  assert.equal(anKern(log, '/k/rec/start').length, 1);
  assert.equal((await ruf(url, 'GET', '/proj/aufnahme')).j.lauf.kennung, kennung);
  await warte(400);
  const stop = await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'stopp' });
  assert.equal(stop.code, 200, JSON.stringify(stop.j));
  const take = stop.j.takes[0];
  assert.ok(take.frames > 0 && !take.fehler, JSON.stringify(take));
  assert.equal((await ruf(url, 'GET', '/proj/aufnahme')).j.lauf, null);
  const rohPfad = path.join(arr, `aufnahme-${nr}-${kennung}.f32`);
  const roh = fs.readFileSync(rohPfad), wav = fs.readFileSync(take.datei);
  assert.equal(wav.length, 58 + roh.length);
  assert.deepEqual(wav.subarray(58), roh, 'die Daten der WAV sind die Rohdatei, Byte für Byte');
  const begleit = JSON.parse(fs.readFileSync(rohPfad.replace(/\.f32$/, '.json'), 'utf8'));
  assert.equal(roh.readFloatLE(0), Math.fround((begleit.start_sample % 1000) / 1000), 'das Prüfmuster der Attrappe beginnt am Einsatz-Sample');
  assert.equal(roh.readFloatLE(4), -roh.readFloatLE(0));
  const p = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.equal(p.spuren[0].clips.length, 1);
  const c = p.spuren[0].clips[0];
  assert.equal(c.quelle.sha256, crypto.createHash('sha256').update(wav).digest('hex'));
  assert.deepEqual([c.art, c.start_beat], ['audio', 0]);
  assert.ok(Math.abs(c.laenge_beats - (take.frames / 48000) * (bpm / 60)) < 1e-9);
  // Review-Nachzug Teil B (MINOR 3, AK7): der Take-Clip steht nicht im Katalog; spielen kann er nur, wenn die Dekodierung aus der WAV (pfad_hinweis) gelingt, derselbe Weg
  // wie nach einem Neustart und erneutem Öffnen (sitzung.ts quellPfad). 'fertig' kommt vom echten ffmpeg; ein Fehler hieße: stumm.
  assert.equal(c.quelle.pfad_hinweis, take.datei);
  let fertig = false;
  for (let i = 0; i < 400 && !fertig; i++) {
    const z = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt.spuren[0].clips[0].dekodiert;
    assert.notEqual(z, 'fehler', 'die Dekodierung aus der Take-WAV darf nicht scheitern');
    fertig = z === 'fertig';
    if (!fertig) await warte(25);
  }
  assert.ok(fertig, 'der Take-Clip ist dekodiert (spielbar)');
  assert.equal((await ruf(url, 'GET', '/proj/verlauf')).j.at(-1).label, 'Record Gitarre');
  const u = await ruf(url, 'POST', '/proj/undo', { rev: p.rev });
  assert.equal(u.code, 200, JSON.stringify(u.j));
  assert.equal((await ruf(url, 'GET', '/proj/aktuell')).j.projekt.spuren[0].clips.length, 0, 'ein Undo nimmt den Clip');
  assert.ok(fs.existsSync(take.datei) && fs.existsSync(rohPfad), 'die Dateien bleiben (Takes gehen nie verloren)');
});

test('Aufnahme mit Loop-Klammer: der Take endet am ersten Loop-Ende ohne Stopp, ein Clip von höchstens einer Klammerlänge (Review Teil B, MAJOR 1)', async (t) => {
  const d = tmp(t);
  const { url } = await stapel(t, { proj: { arbeitsordner: path.join(d, 'arr') } });
  const { id, bpm } = await projektScharf(url, 'Klammer');
  const p0 = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  const l = await ruf(url, 'POST', '/proj/aendern', { rev: p0.rev, label: 'Loop', befehle: [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 2 }] });
  assert.equal(l.code, 200, JSON.stringify(l.j));
  const st = await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 });
  assert.equal(st.code, 200, JSON.stringify(st.j));
  // zwei Klammerlängen (2 Beats = 60/bpm · 2 s) abwarten; der Lauf muss von selbst enden
  let zu = false;
  for (let i = 0; i < 400 && !zu; i++) { zu = (await ruf(url, 'GET', '/proj/aufnahme')).j.lauf === null; if (!zu) await warte(25); }
  assert.ok(zu, 'der Take endet am ersten Loop-Ende, ohne dass jemand stoppt');
  const c = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt.spuren.find((x) => x.id === id).clips;
  assert.equal(c.length, 1);
  assert.ok(c[0].laenge_beats <= 2 + 1e-9 && c[0].laenge_beats > 1.5, `höchstens eine Klammer (2 Beats), nicht ${c[0].laenge_beats} (bpm ${bpm})`);
});

test('AK1 am Server: arm ändert rev, nicht wiedergabe_rev und löst kein /k/arr/laden aus; Undo und Redo stellen es her', async (t) => {
  const d = tmp(t);
  const { url, log } = await stapel(t, { proj: { arbeitsordner: path.join(d, 'arr') } });
  await ruf(url, 'POST', '/proj/neu', { name: 'Undo' });
  await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'A' }] });
  const vor = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  const geladen0 = anKern(log, '/k/arr/laden').length;
  const arm = await ruf(url, 'POST', '/proj/aendern', { rev: vor.rev, label: 'Arm', befehle: [{ befehl: 'spur_aendern', spur_id: vor.spuren[0].id, eingang: { art: 'intern', name: 'erz/1' }, arm: true }] });
  assert.equal(arm.code, 200, JSON.stringify(arm.j));
  const p = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.deepEqual([p.rev, p.wiedergabe_rev, anKern(log, '/k/arr/laden').length], [vor.rev + 1, vor.wiedergabe_rev, geladen0], 'rev zählt, die Wiedergabe nicht, kein Laden');
  assert.equal((await ruf(url, 'POST', '/proj/undo', { rev: p.rev })).code, 200);
  const q = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.equal(q.spuren[0].aufnahme, undefined);
  assert.equal((await ruf(url, 'POST', '/proj/redo', { rev: q.rev })).code, 200);
  const w = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.deepEqual(w.spuren[0].aufnahme, { scharf: true, eingang: { art: 'intern', name: 'erz/1' } });
  assert.equal(anKern(log, '/k/arr/laden').length, geladen0);
});

test('Aufnahme: Ablehnungen und Sperren', async (t) => {
  const d = tmp(t);
  const { o, url } = await stapel(t, { proj: { arbeitsordner: path.join(d, 'arr') } });
  const g = async (m, pfad, b, k) => { const r = await ruf(url, m, pfad, b, k); return [r.code, r.j?.fehler]; };
  assert.deepEqual(await g('POST', '/proj/aufnahme', { aktion: 'start' }), [409, 'kein_projekt']);
  const { id, rev } = await projektScharf(url, 'Sperren');
  const leer = await ruf(url, 'POST', '/proj/aendern', { rev, label: 'Entschärfen', befehle: [{ befehl: 'spur_aendern', spur_id: id, arm: false, eingang: null }] });
  assert.equal(leer.code, 200, JSON.stringify(leer.j));
  assert.deepEqual(await g('POST', '/proj/aufnahme', { aktion: 'start' }), [409, 'nichts_scharf']);
  assert.deepEqual(await g('POST', '/proj/aufnahme', { aktion: 'stopp' }), [409, 'keine_aufnahme']);
  assert.deepEqual(await g('POST', '/proj/aufnahme', { aktion: 'spulen' }), [400, 'aktion_unbekannt']);
  const p0 = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  await ruf(url, 'POST', '/proj/aendern', { rev: p0.rev, label: 'Arm', befehle: [{ befehl: 'spur_aendern', spur_id: id, eingang: { art: 'intern', name: 'erz/2' }, arm: true }] });
  // Stop Cypher: Cyphers Start wird vor allem anderen abgelehnt, Andreas darf
  const ctx = o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => innen(o).kiGestoppt));
  assert.deepEqual(await g('POST', '/proj/aufnahme', { aktion: 'start' }, CYPHER), [409, 'ki_gestoppt']);
  assert.equal((await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'start' })).code, 200);
  // während des Laufs: zweiter Start, Tempo-Änderung und Öffnen sind gesperrt, Mixer bleibt bedienbar
  assert.deepEqual(await g('POST', '/proj/aufnahme', { aktion: 'start' }), [409, 'aufnahme_laeuft']);
  const p1 = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.deepEqual(await g('POST', '/proj/aendern', { rev: p1.rev, label: 'T', befehle: [{ befehl: 'tempo_setzen', bpm: p1.tempo_bpm }] }), [409, 'beschaeftigt']);
  assert.deepEqual(await g('POST', '/proj/oeffnen', { slug: (await ruf(url, 'GET', '/proj/liste')).j[0].slug }), [409, 'beschaeftigt']);
  assert.equal((await ruf(url, 'POST', '/proj/aendern', { rev: p1.rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: id, fader_db: -3 }] })).code, 200, 'der Mixer bleibt bedienbar');
  assert.equal((await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'stopp' })).code, 200);
  const p2 = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.equal((await ruf(url, 'POST', '/proj/aendern', { rev: p2.rev, label: 'T', befehle: [{ befehl: 'tempo_setzen', bpm: p2.tempo_bpm }] })).code, 200, 'nach dem Stopp geht es wieder');
  assert.equal(GRUND_TEXT.nichts_scharf !== undefined && GRUND_TEXT.aufnahme_laeuft !== undefined, true);
});

// --- Nachbesserung 1 -----------------------------------------------------------------------------------------------------------------------
test('M2: der Transport endet auf anderem Weg (POST /proj/transport stopp): der Take wird von selbst übernommen, die Sperre fällt, der Clip steht', async (t) => {
  const d = tmp(t);
  const { url } = await stapel(t, { proj: { arbeitsordner: path.join(d, 'arr') } });
  await projektScharf(url, 'Anders');
  const st = await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 });
  assert.equal(st.code, 200, JSON.stringify(st.j));
  await warte(400);
  const tp = await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' });
  assert.equal(tp.code, 200, JSON.stringify(tp.j));
  let lage;
  for (let i = 0; i < 200; i++) { lage = (await ruf(url, 'GET', '/proj/aufnahme')).j; if (lage.lauf === null && lage.letzte) break; await warte(20); }
  assert.equal(lage.lauf, null, 'der Lauf endete ohne POST /proj/aufnahme stopp');
  assert.equal(lage.letzte.kennung, st.j.kennung);
  assert.ok(lage.letzte.takes[0].frames > 0 && !lage.letzte.takes[0].fehler, JSON.stringify(lage.letzte));
  const p = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.equal(p.spuren[0].clips.length, 1, 'der Clip steht');
  // die Sperre ist frei: Tempo-Änderung geht, Öffnen ist nicht mehr beschaeftigt
  assert.equal((await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'T', befehle: [{ befehl: 'tempo_setzen', bpm: p.tempo_bpm }] })).code, 200, 'Tempo geht wieder');
  assert.equal((await ruf(url, 'POST', '/proj/oeffnen', { slug: (await ruf(url, 'GET', '/proj/liste')).j[0].slug })).code, 200, 'Öffnen geht wieder');
  // der Stopp-Knopf danach liefert das Ergebnis einmal, dann keine_aufnahme
  const s1 = await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'stopp' });
  assert.equal(s1.code, 200, JSON.stringify(s1.j));
  assert.equal(s1.j.takes[0].frames, lage.letzte.takes[0].frames);
  const s2 = await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'stopp' });
  assert.deepEqual([s2.code, s2.j.fehler], [409, 'keine_aufnahme']);
});

test('AK8: zwei scharfe Spuren, EIN Undo-Schritt nimmt beide Clips (Mutation Step 9)', async (t) => {
  const d = tmp(t);
  const { url } = await stapel(t, { proj: { arbeitsordner: path.join(d, 'arr') } });
  await ruf(url, 'POST', '/proj/neu', { name: 'Zwei' });
  const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Spuren', befehle: [{ befehl: 'tempo_setzen', bpm }, { befehl: 'spur_neu', art: 'audio', name: 'Gitarre' }, { befehl: 'spur_neu', art: 'audio', name: 'Bass' }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const p = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  const b = await ruf(url, 'POST', '/proj/aendern', { rev: p.rev, label: 'Arm', befehle: [
    { befehl: 'spur_aendern', spur_id: p.spuren[0].id, eingang: { art: 'intern', name: 'erz/1' }, arm: true },
    { befehl: 'spur_aendern', spur_id: p.spuren[1].id, eingang: { art: 'intern', name: 'erz/2' }, arm: true }] });
  assert.equal(b.code, 200, JSON.stringify(b.j));
  const vor = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.equal((await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'start', von_beat: 0 })).code, 200);
  await warte(400);
  const stop = await ruf(url, 'POST', '/proj/aufnahme', { aktion: 'stopp' });
  assert.equal(stop.code, 200, JSON.stringify(stop.j));
  assert.equal(stop.j.takes.length, 2);
  assert.ok(stop.j.takes.every((x) => x.frames > 0 && !x.fehler), JSON.stringify(stop.j));
  const nach = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.deepEqual(nach.spuren.map((s) => s.clips.length), [1, 1]);
  assert.equal((await ruf(url, 'GET', '/proj/verlauf')).j.filter((e) => e.label.startsWith('Record')).length, 1, 'ein Verlaufseintrag für beide Spuren');
  const u = await ruf(url, 'POST', '/proj/undo', { rev: nach.rev });
  assert.equal(u.code, 200, JSON.stringify(u.j));
  const zurueck = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.deepEqual(zurueck.spuren.map((s) => s.clips.length), [0, 0], 'ein Undo nimmt beide Clips');
  assert.deepEqual(zurueck.spuren.map((s) => s.aufnahme), vor.spuren.map((s) => s.aufnahme), 'der Arm-Stand ist wie vor dem Take');
});
