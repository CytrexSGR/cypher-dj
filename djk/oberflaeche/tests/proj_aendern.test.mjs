// D1 S2-Integration, Slice 4: ändern, Regler-Ablehnung, Undo/Redo, Wiedergabe-Nummer, Audio aus dem Katalog (Spec 3.4, 2.8, 6.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pruefKontext, sitzung, wav, warteBis, neustart, arrNr, ist } from './hilfen/proj_kontext.mjs';
import { baueKatalog, ksha } from './hilfen/katalog.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const fehlerVon = async (p) => { try { await p; } catch (e) { return e; } return null; };
const lies = (datei) => JSON.parse(fs.readFileSync(datei, 'utf8'));

test('aendern: rev_veraltet ohne Wirkung; Änderung setzt nur die betroffenen Regler, schreibt Projekt und Verlauf, SSE proj mit Quelle und Label', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('A', 'andreas'); k.leere();
  const alt = await fehlerVon(s.aendern({ rev: 7, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas'));
  assert.deepEqual([alt.code, alt.fehler, alt.extra.rev], [409, 'rev_veraltet', 0]); assert.equal(k.gesendet.length, 0);
  const r = await s.aendern({ rev: 0, label: 'Add track', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'cypher');
  assert.equal(r.code, 200); assert.equal(r.j.rev, 1);
  assert.deepEqual(k.teile().map((x) => x.felder.pfad).sort(), ['spur/1/fader', 'spur/1/mute', 'spur/1/pan', 'spur/1/solo']);
  assert.ok(k.teile().every((x) => x.felder.quelle === 'cypher' && x.felder.plan === 'cypher'));
  assert.deepEqual(k.verteilt.at(-1), { a: 'proj', f: { slug: 'a', rev: 1, label: 'Add track', quelle: 'cypher' } });
  const v = s.verlaufListe().j;
  assert.deepEqual(v.map((e) => [e.rev, e.art, e.quelle, e.label]), [[1, 'aendern', 'cypher', 'Add track']]);
  assert.equal(typeof v[0].zeit, 'number', 'zeit in ms (Festlegung V1)');
  k.leere();
  const nichts = await s.aendern({ rev: 1, label: 'gleich', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: 0 }] }, 'andreas');
  assert.equal(nichts.j.rev, 1, 'keine Wirkung, keine neue rev'); assert.equal(k.gesendet.length, 0);
});

test('aendern: Ablehnung eines /k/teil → 409 regler_abgelehnt, angenommene Regler zurück, nichts gespeichert (Spec 3.4)', async (t) => {
  const k = pruefKontext();
  const { s, wurzel } = sitzung(t, {}, k);
  await s.neu('R', 'andreas');
  await s.aendern({ rev: 0, label: 'zwei', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  const datei = path.join(wurzel, 'r', 'project.json'), log = path.join(wurzel, 'r', 'undo.jsonl');
  const vorher = [fs.readFileSync(datei, 'utf8'), fs.readFileSync(log, 'utf8')];
  k.regel = (adresse, f) => (f.pfad === 'spur/2/fader' && f.nach === -6 ? { status: 6, grund: 'regler_beim_menschen' } : { status: 3, grund: '' });
  k.leere();
  const e = await fehlerVon(s.aendern({ rev: 1, label: 'beide', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 },
    { befehl: 'spur_aendern', spur_id: 's2', fader_db: -6 }] }, 'andreas'));
  assert.deepEqual([e.code, e.fehler], [409, 'regler_abgelehnt']);
  assert.deepEqual(e.extra.regler.map((x) => [x.pfad, x.quittung.grund]), [['spur/2/fader', 'regler_beim_menschen']]);
  assert.deepEqual(k.teile(/^spur\/1\/fader$/).map((x) => x.felder.nach), [-3, 0], 'angenommener Regler wieder auf 0 dB');
  assert.deepEqual([fs.readFileSync(datei, 'utf8'), fs.readFileSync(log, 'utf8')], vorher, 'project.json und Verlauf unverändert');
  assert.equal(s.aktuell().j.projekt.rev, 1);
  assert.equal(k.verteilt.filter((x) => x.a === 'proj').length, 0, 'kein SSE für eine abgelehnte Änderung');
});

test('Undo/Redo: Regler auf den alten Stand, nichts_zu_tun ohne Eintrag, rev zählt weiter', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('U', 'andreas');
  await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  await s.aendern({ rev: 1, label: 'Leiser', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -10 }] }, 'andreas');
  k.leere();
  const u = await s.umkehr('undo', { rev: 2 }, 'andreas');
  assert.equal(u.j.rev, 3); assert.equal(u.j.projekt.spuren[0].fader_db, 0);
  assert.deepEqual(k.teile().map((x) => [x.felder.pfad, x.felder.nach]), [['spur/1/fader', 0]]);
  await s.umkehr('undo', { rev: 3 }, 'andreas');
  const leer = await fehlerVon(s.umkehr('undo', { rev: 4 }, 'andreas'));
  assert.deepEqual([leer.code ?? 409, leer.grund ?? leer.fehler], [409, 'nichts_zu_tun']);
  const r = await s.umkehr('redo', { rev: 4 }, 'andreas');
  assert.equal(r.j.projekt.spuren.length, 1);
  assert.deepEqual(s.verlaufListe().j.map((x) => x.art), ['aendern', 'aendern', 'undo', 'undo', 'redo']);
});

test('Wiedergabe-Nummer (Spec 6.1): jede klangwirksame Änderung schreibt wiedergabe-<nr+1>.json und lädt sie; Mixer nicht', async (t) => {
  const { s, k, arr } = sitzung(t);
  await s.neu('W', 'andreas');
  await s.aendern({ rev: 0, label: 'Bass', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, 'andreas');
  k.leere();
  const r = await s.aendern({ rev: 1, label: 'Clip', befehle: [{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 4, laenge_beats: 4,
    noten: [{ beat: 0, laenge: 0.5, ton: 36, vel: 100 }] }] }, 'andreas');
  const nr = k.an('/k/arr/laden')[0].felder.nr;
  assert.equal(nr, 3); assert.equal(r.j.projekt.wiedergabe_rev, 3);
  assert.deepEqual(lies(path.join(arr, `wiedergabe-${nr}.json`)).spuren[0].noten, [{ id: 'c1/n1', beat: 4, laenge: 0.5, ton: 36, vel: 100 }]);
  k.leere();
  await s.aendern({ rev: 2, label: 'Pan', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', pan: 0.5 }] }, 'andreas');
  assert.equal(k.an('/k/arr/laden').length, 0, 'Mixer geht über Regler, nicht über die Wiedergabe');
});

test('Audio-Clip nur aus dem Katalog (Spec 2.8, 2.11): dekodiert laeuft → fertig per SSE ohne rev, danach neue Wiedergabe mit dem Clip; Ablehnungen', async (t) => {
  const d = tmpOrdner(t, 'djk-projkat-');
  const kick = wav(path.join(d, 'daten'), 'kick.wav');
  const katalog = baueKatalog(path.join(d, 'kat'), [{ n: 1, typ: 'oneshot', pfad: kick, dauer_s: 0.25 },
    { n: 2, typ: 'loop', schutz: 'ableton', pfad: kick }, { n: 3, typ: 'oneshot', pfad: path.join(d, 'daten', 'fehlt.wav') }]);
  const { s, k, arr } = sitzung(t, { katalog });
  await s.neu('Audio', 'andreas');
  await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  const clip = (sha) => s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Clip', befehle: [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: sha }] }, 'andreas');
  for (const [sha, code, grund] of [[ksha(2), 409, 'nur_live'], [ksha(3), 409, 'quelle_fehlt'], ['f'.repeat(64), 404, 'sha_unbekannt']]) {
    const e = await fehlerVon(clip(sha)); assert.deepEqual([e.code, e.fehler, e.extra.index], [code, grund, 0]);
  }
  k.leere();
  const r = await clip(ksha(1));
  const c = structuredClone(r.j.projekt.spuren[0].clips[0]), nrVor = r.j.projekt.wiedergabe_rev, revVor = r.j.rev;   // Antwort ist der lebende Stand
  assert.deepEqual([c.dekodiert, c.quelle.sha256, c.quelle.pfad_hinweis, c.name], ['laeuft', ksha(1), kick, 'kick']);
  assert.ok(await warteBis(() => k.verteilt.some((x) => x.a === 'proj' && x.f.clip_id === c.id && x.f.dekodiert === 'fertig'), 15000));
  assert.ok(await warteBis(() => s.aktuell().j.projekt.wiedergabe_rev > nrVor));
  assert.equal(s.aktuell().j.projekt.rev, revVor, 'Dekodieren erhöht rev nicht');
  const w = lies(path.join(arr, `wiedergabe-${s.aktuell().j.projekt.wiedergabe_rev}.json`));
  assert.equal(w.spuren[0].clips[0].sha256, ksha(1)); assert.ok(fs.existsSync(w.spuren[0].clips[0].datei));
  const ohne = sitzung(t);
  await ohne.s.neu('Ohne', 'andreas');
  await ohne.s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  const e = await fehlerVon(ohne.s.aendern({ rev: 1, label: 'Clip', befehle: [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: ksha(1) }] }, 'andreas'));
  assert.deepEqual([e.code, e.fehler], [503, 'katalog_fehlt']);
});

test('KI-Stopp (Spec 2.12, 3.5): Cypher ändert nicht, macht nichts rückgängig (409 ki_gestoppt); Andreas schon', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('K', 'andreas');
  k.ki = true; k.leere();
  for (const p of [s.aendern({ rev: 0, label: 'x', befehle: [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }] }, 'cypher'),
    s.umkehr('undo', { rev: 0 }, 'cypher'), s.umkehr('redo', { rev: 0 }, 'cypher')]) {
    const e = await fehlerVon(p); assert.deepEqual([e?.code, e?.fehler], [409, 'ki_gestoppt']);
  }
  assert.equal(k.gesendet.length, 0);
  assert.equal((await s.aendern({ rev: 0, label: 'Loop', befehle: [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }] }, 'andreas')).code, 200);
});

test('Clip-Loop über die Sitzung (Spec 6.17): loop_beats ausgerollt in wiedergabe-<nr>.json; ausgerollt zu groß → 409 zu_gross, nichts gespeichert', async (t) => {
  const { s, k, arr, wurzel } = sitzung(t);
  await s.neu('Loop', 'andreas');
  await s.aendern({ rev: 0, label: 'Bass', befehle: [{ befehl: 'spur_neu', art: 'instrument' }, { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0,
    laenge_beats: 4, noten: [{ beat: 0, laenge: 0.5, ton: 36, vel: 100 }] }] }, 'andreas');
  k.leere();
  const r = await s.aendern({ rev: 1, label: 'Loop', befehle: [{ befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 32, loop_beats: 4 }] }, 'andreas');
  const w = lies(path.join(arr, `wiedergabe-${k.an('/k/arr/laden')[0].felder.nr}.json`));
  assert.deepEqual(w.spuren[0].noten.map((n) => [n.id, n.beat]), Array.from({ length: 8 }, (_, i) => [`c1~${i}/n1`, 4 * i]));
  const datei = path.join(wurzel, 'loop', 'project.json'), vorher = fs.readFileSync(datei, 'utf8');
  const e = await fehlerVon(s.aendern({ rev: r.j.rev, label: 'zu viel', befehle: [{ befehl: 'clip_aendern', clip_id: 'c1', laenge_beats: 65537, loop_beats: 1 }] }, 'andreas'));
  assert.deepEqual([e.code ?? 409, e.grund ?? e.fehler], [409, 'zu_gross']);
  assert.equal(fs.readFileSync(datei, 'utf8'), vorher);
});

test('P2 Wiederanlauf: die übernommenen Ist-Werte sind ein Undo-Schritt (Fader, Mute, Pan in einem Zug zurück, Regler gehen an den Kern)', async (t) => {
  const { z, nr } = neustart(t);
  z.s.ereignis('/zustand/arr', arrNr(nr));
  ist(z.s, 'spur/1/fader', -12); ist(z.s, 'spur/1/mute', 1); ist(z.s, 'spur/2/pan', 0.25);
  const r = await z.s.oeffnen('wa', 'andreas');
  assert.equal(r.j.projekt.rev, 1);
  z.k.leere();
  const u = await z.s.umkehr('undo', { rev: 1 }, 'andreas');
  assert.deepEqual([u.j.projekt.spuren[0].fader_db, u.j.projekt.spuren[0].mute, u.j.projekt.spuren[1].pan], [0, false, 0], 'in einem Zug rückgängig');
  assert.deepEqual(z.k.teile().map((x) => [x.felder.pfad, x.felder.nach]).sort(), [['spur/1/fader', 0], ['spur/1/mute', 0], ['spur/2/pan', 0]]);
  assert.deepEqual(z.s.verlaufListe().j.map((x) => [x.art, x.label]), [['aendern', 'Mixer nach Wiederanlauf'], ['undo', 'Undo: Mixer nach Wiederanlauf']]);
});
