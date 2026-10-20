// D1 S2-Integration, Slice 3: Projekt anlegen, öffnen, lesen samt Kern-Abgleich (Spec 3.4, 2.3, 6.1), gegen einen Prüf-Kontext.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pruefKontext, sitzung, wav, warteBis, neustart, arrNr, ist } from './hilfen/proj_kontext.mjs';
import { baueKatalog, ksha } from './hilfen/katalog.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const fehlerVon = async (p) => { try { await p; } catch (e) { return e; } return null; };
const lies = (datei) => JSON.parse(fs.readFileSync(datei, 'utf8'));

test('neu: Projekt angelegt, Wiedergabe 1 geschrieben und geladen, erz/4 neutral (14 Regler), alle 32 Spur-Regler, Loop, Metronom; SSE proj', async (t) => {
  const { s, k, arr } = sitzung(t);
  const r = await s.neu('First Track', 'andreas');
  assert.equal(r.code, 200);
  assert.equal(r.j.slug, 'first-track'); assert.equal(r.j.projekt.rev, 0); assert.equal(r.j.projekt.wiedergabe_rev, 1);
  assert.deepEqual(k.an('/k/arr/laden').map((x) => x.felder), [{ quelle: 'andreas', nr: 1 }]);
  assert.deepEqual(lies(path.join(arr, 'wiedergabe-1.json')), { format: 'cypherdj-arr/1', nr: 1, spuren: [] });
  assert.equal(k.teile(/^erz\/4\//).length, 16); assert.equal(k.teile(/^spur\//).length, 32);
  assert.deepEqual(k.teile(/^erz\/4\/(ziel|xseite)$/).map((x) => [x.felder.pfad, x.felder.nach]), [['erz/4/ziel', 0], ['erz/4/xseite', 1]], 'P6: bei Quelle andreas gesendet');
  assert.deepEqual(k.teile(/^erz\/4\/send\/1$/)[0].felder, { quelle: 'andreas', plan: '', teil: 0, pfad: 'erz/4/send/1', ab_beat: k.teile(/^erz\/4\/send\/1$/)[0].felder.ab_beat,
    dauer_beats: 0, nach: -200, form: 0, politik: 1, gruppe: '', hoerschein: '' });
  assert.deepEqual(k.an('/k/arr/loop')[0].felder, { quelle: 'andreas', an: 0, von_beat: 0, bis_beat: 32 });
  assert.deepEqual(k.an('/k/arr/metronom')[0].felder, { quelle: 'andreas', an: 0, pegel_db: -12, ziel: 0 });
  assert.deepEqual(r.j.kern.regler_fehler, []);
  assert.deepEqual(k.verteilt.at(-1), { a: 'proj', f: { slug: 'first-track', rev: 0, label: 'Open', quelle: 'andreas' } });
  assert.equal(s.aktuell().j.slug, 'first-track');
});

test('Öffnen: ein zweites Projekt schliesst das erste (Sperre frei, Transport gestoppt); Wiederöffnen behält wiedergabe_rev, lädt eine neue', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('Eins', 'andreas');
  s.ereignis('/zustand/arr', { nr: 1, status: 2, loop_an: 0, projekt_beat: 0, ursprung_sample: 0n, start_beat: 0, metronom_an: 0 });
  k.leere();
  await s.neu('Zwei', 'andreas');
  s.ereignis('/zustand/arr', { nr: 2, status: 0, loop_an: 0, projekt_beat: 0, ursprung_sample: 0n, start_beat: 0, metronom_an: 0 });   // der Kern spielt jetzt Wiedergabe 2
  assert.equal(k.an('/k/arr/stopp').length, 1, 'Transport des ersten Projekts gestoppt');
  const r = await s.oeffnen('eins', 'andreas');
  assert.equal(r.j.projekt.wiedergabe_rev, 3, 'nr läuft über Projekte hinweg (Spec 6.1)');
  const e = await fehlerVon(s.oeffnen('gibt-es-nicht', 'andreas'));
  assert.deepEqual([e.code, e.fehler], [404, 'unbekannt']);
});

test('KI-Stopp (Spec 2.12, 3.5): Cypher legt kein Projekt an und öffnet keins (409 ki_gestoppt), Andreas schon', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('K', 'andreas');
  k.ki = true; k.leere();
  for (const p of [s.neu('X', 'cypher'), s.oeffnen('k', 'cypher')]) {
    const e = await fehlerVon(p); assert.deepEqual([e?.code, e?.fehler], [409, 'ki_gestoppt']);
  }
  assert.equal(k.gesendet.length, 0);
  assert.equal((await s.oeffnen('k', 'andreas')).code, 200);
});

// --- P6: erz/4 ziel und xseite nur bei Quelle andreas gesetzt, bei cypher als Meldung -----------------------------------------------------

test('P6 erz/4: Quelle cypher sendet ziel und xseite nicht (der Kern lehnte nur_hand ab) und meldet sie, wenn bekannt anders; Quelle andreas setzt sie', async (t) => {
  const c = sitzung(t);
  c.s.ereignis('/e/regler', { pfad: 'erz/4/ziel', wert: 1, halter: 'frei', sample: 0n, beat: 0 });
  c.s.ereignis('/e/regler', { pfad: 'erz/4/xseite', wert: 1, halter: 'frei', sample: 0n, beat: 0 });
  const r = await c.s.neu('Cy', 'cypher');
  assert.equal(c.k.teile(/^erz\/4\//).length, 14); assert.equal(c.k.teile(/^erz\/4\/(ziel|xseite)$/).length, 0);
  assert.deepEqual(r.j.kern.erz4_nur_hand, [{ pfad: 'erz/4/ziel', soll: 0, ist: 1 }], 'xseite steht schon auf 1: keine Meldung');
  const a = sitzung(t);
  a.s.ereignis('/e/regler', { pfad: 'erz/4/ziel', wert: 1, halter: 'frei', sample: 0n, beat: 0 });
  const r2 = await a.s.neu('An', 'andreas');
  assert.equal(a.k.teile(/^erz\/4\/(ziel|xseite)$/).length, 2); assert.deepEqual(r2.j.kern.erz4_nur_hand, [], 'gesetzt, also keine Meldung');
  const stumm = sitzung(t);
  const r3 = await stumm.s.neu('Stumm', 'cypher');
  assert.deepEqual(r3.j.kern.erz4_nur_hand, [], 'Negativ-Kontrolle: nichts bekannt, nichts gemeldet');
});

// --- P2 (Spec 6.21): Wiedergabe-Nummer entscheidet, wer beim Mixer gewinnt -----------------------------------------------------------------

test('P2 Wiederanlauf (gleiche Nummer): keine neue Wiedergabe, bekannte Spur-Regler nicht gesetzt; Ist-Werte als EINE Änderung "Mixer nach Wiederanlauf" (Quelle andreas), undo-fähig', async (t) => {
  const { z, nr } = neustart(t);
  z.s.ereignis('/zustand/arr', arrNr(nr));
  ist(z.s, 'spur/1/fader', -12); ist(z.s, 'spur/1/mute', 1); ist(z.s, 'spur/2/pan', 0.25);   // Handgriffe während des Server-Ausfalls
  const r = await z.s.oeffnen('wa', 'andreas');
  assert.equal(z.k.an('/k/arr/laden').length, 0, 'keine neue Wiedergabe');
  // Spec 6.30: für Regler mit unbekanntem Ist-Wert gewinnt das Projekt (29 von 32), die drei bekannten setzt der Server nicht
  assert.equal(z.k.teile(/^spur\//).length, 29); assert.equal(z.k.teile(/^spur\/(1\/fader|1\/mute|2\/pan)$/).length, 0, 'bekannte Spur-Regler nicht gesetzt');
  assert.equal(r.j.projekt.wiedergabe_rev, nr);
  const sp = r.j.projekt.spuren;
  assert.deepEqual([sp[0].fader_db, sp[0].mute, sp[0].solo, sp[1].pan, sp[1].fader_db], [-12, true, false, 0.25, 0], 'unbekannte Ist-Werte (solo) bleiben, wie sie sind');
  const v = z.s.verlaufListe().j;
  assert.deepEqual(v.map((x) => [x.art, x.quelle, x.label]), [['aendern', 'andreas', 'Mixer nach Wiederanlauf']], 'genau ein Eintrag');
  assert.ok(z.k.verteilt.some((x) => x.a === 'proj' && x.f.label === 'Mixer nach Wiederanlauf' && x.f.quelle === 'andreas'));
  // Negativ-Kontrolle: stimmen die Ist-Werte mit dem Projekt überein, entsteht kein Eintrag
  const { z: z2, nr: nr2 } = neustart(t);
  z2.s.ereignis('/zustand/arr', arrNr(nr2)); ist(z2.s, 'spur/1/fader', 0);
  const r2 = await z2.s.oeffnen('wa', 'andreas');
  assert.deepEqual(z2.s.verlaufListe().j, []); assert.equal(r2.j.projekt.rev, 0);
});

test('P2 verschieden (anderes Projekt, Kern ohne Wiedergabe, Nummer unbekannt): das Projekt gewinnt, 32 Spur-Regler, neue Wiedergabe; Fader des alten Projekts werden nicht geerbt', async (t) => {
  for (const kern of [(s, nr) => s.ereignis('/zustand/arr', arrNr(nr + 5)), (s) => s.ereignis('/zustand/arr', arrNr(0)), () => {}]) {
    const { z, nr } = neustart(t);
    kern(z.s, nr); ist(z.s, 'spur/1/fader', -12);                 // der Kern hält Fader eines anderen Projekts
    const r = await z.s.oeffnen('wa', 'andreas');
    assert.equal(z.k.an('/k/arr/laden').length, 1); assert.equal(z.k.teile(/^spur\//).length, 32);
    assert.equal(r.j.projekt.spuren[0].fader_db, 0, 'Projekt gewinnt'); assert.equal(r.j.projekt.rev, 0);
    assert.deepEqual(z.k.teile(/^spur\/1\/fader$/).map((x) => x.felder.nach), [0]);
    assert.ok(r.j.projekt.wiedergabe_rev > nr);
  }
});

test('P2 KI-Stopp (Nachsatz): bei gleicher Nummer bleibt der Fader von Cyphers Spuren, solange der Kern ki_gestoppt meldet; die übrigen Felder und Andreas\' Fader werden übernommen', async (t) => {
  const { z, nr } = neustart(t);
  z.k.ki = true;
  z.s.ereignis('/zustand/arr', arrNr(nr));
  ist(z.s, 'spur/1/fader', -12); ist(z.s, 'spur/2/fader', -40); ist(z.s, 'spur/2/pan', 0.5);   // spur/2 gehört cypher: -40 ist die Absenkung des KI-Stopps
  const r = await z.s.oeffnen('wa', 'andreas');
  const sp = r.j.projekt.spuren;
  assert.deepEqual([sp[0].fader_db, sp[1].fader_db, sp[1].pan], [-12, 0, 0.5]);
  // Negativ-Kontrolle: ohne KI-Stopp ist -40 eine Handbewegung und wird übernommen
  const { z: z2, nr: nr2 } = neustart(t);
  z2.s.ereignis('/zustand/arr', arrNr(nr2)); ist(z2.s, 'spur/2/fader', -40);
  assert.equal((await z2.s.oeffnen('wa', 'andreas')).j.projekt.spuren[1].fader_db, -40);
});

test('P2 Frist: kennt der Server den Kern-Stand beim Öffnen noch nicht, wartet er auf /zustand/arr (Wiederanlauf); kommt nichts, gewinnt nach der Frist das Projekt', async (t) => {
  const { z, nr } = neustart(t, { arrFristMs: 2000 });
  ist(z.s, 'spur/1/fader', -12);
  const offen = z.s.oeffnen('wa', 'andreas');
  await new Promise((r) => setTimeout(r, 60));
  z.s.ereignis('/zustand/arr', arrNr(nr));                    // das erste /zustand/arr nach dem Start trifft ein
  const r = await offen;
  assert.equal(z.k.an('/k/arr/laden').length, 0); assert.equal(r.j.projekt.spuren[0].fader_db, -12);
  const { z: z2 } = neustart(t, { arrFristMs: 50 });
  ist(z2.s, 'spur/1/fader', -12);
  const t0 = Date.now(), r2 = await z2.s.oeffnen('wa', 'andreas');
  assert.ok(Date.now() - t0 >= 50, 'wartete die Frist ab'); assert.equal(z2.k.an('/k/arr/laden').length, 1); assert.equal(r2.j.projekt.spuren[0].fader_db, 0);
});
