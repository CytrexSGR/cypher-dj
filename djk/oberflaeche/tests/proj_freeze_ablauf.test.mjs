// D1 S3, Slice 1: POST /proj/freeze als Ablauf (bereiche/proj/ausgabe.ts) gegen die ECHTE S2-Integration (projBereich in tmp) mit Kontext-
// und Kern-Doppel (tests/hilfen/ausgabe_aufbau.mjs). Kein Netz, kein Kern, kein Ton.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { aufbau } from './hilfen/ausgabe_aufbau.mjs';
import { warteBis } from './hilfen/proj_kontext.mjs';
import { alsAntwort } from '../bereiche/proj/ausgabe.ts';

// Antwort wie die Route: {code, body}
async function ruf(f) {
  try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); }
}
// Spec 6.26/6.28: Noten-IDs aus dem Zähler des Projekts, also hier gelesen statt angenommen
const nid = (a) => a.lead().clips[0].noten[0].id;
// die Sitzung wirft ProjFehler (die Route macht daraus die Antwort): hier als {code, j}
const sitz = async (p) => { try { return await p; } catch (e) { if (typeof e?.code !== 'number') throw e; return { code: e.code, j: { fehler: e.fehler, ...e.extra } }; } };
const noteAendern = (a, ton = 61) => sitz(a.s.aendern({ rev: a.projekt().rev, label: 'Note', befehle: [{ befehl: 'noten_aendern', clip_id: 'c3', noten: [{ id: nid(a), ton }] }] }, 'andreas'));
const faderAendern = (a, db = -3) => sitz(a.s.aendern({ rev: a.projekt().rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', fader_db: db }] }, 'andreas'));
const sauber = { lauf: null, wartend: 0, abbruch: 0 };
// nach der Freigabe holt die S2-Integration das gemerkte Laden in ihrer Kette nach: warten, bis der Kern die Wiedergabe des Projekts hat
const geladen = (a) => warteBis(() => a.zustand.kernNr === a.projekt().wiedergabe_rev && !a.s.ladenGesperrt());

test('Freeze an: Sperre vor tempoAnMaster, /k/arr/freeze mit Bereich und Kennung aus dem Zähler, Datei geprüft, sha256, ein Eintrag, Spur als Audio', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const rev0 = a.projekt().rev, nr0 = a.projekt().wiedergabe_rev;
  const r = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const f = a.lead().freeze;
  assert.equal(a.freezes().length, 1);
  const kennung = a.freezes()[0].felder.kennung;
  assert.ok(Number.isInteger(kennung) && kennung > nr0, `Kennung ${kennung} aus dem Wiedergabe-Zähler (Spec 6.25), hinter Wiedergabe ${nr0}`);
  const datei = path.join(a.arbeitsordner, `freeze-3-${kennung}.f32`);
  assert.deepEqual(f, { datei: `freeze-3-${kennung}.f32`, frames: 4800, kennung, sha256: crypto.createHash('sha256').update(fs.readFileSync(datei)).digest('hex'), von_beat: 8 });
  assert.equal(r.body.rev, rev0 + 1);
  assert.deepEqual(a.freezes()[0].felder, { quelle: 'andreas', spur: 3, von_beat: 8, bis_beat: 16, kennung });
  assert.deepEqual(a.protokoll.reihenfolge, ['sperre', 'tempo', 'uebernimm', 'frei'], 'Spec 6.33: Sperre vor tempoAnMaster, Freigabe erst nach uebernimm');
  assert.deepEqual(a.protokoll.uebernommen, [{ rev: rev0 + 1, label: 'Freeze Lead', quelle: 'andreas', wiedergabe: true }]);
  const e = a.s.verlaufListe().j.at(-1);
  assert.deepEqual([e.rev, e.quelle, e.label, e.art], [rev0 + 1, 'andreas', 'Freeze Lead', 'aendern']);
  // Spec 6.23, 6.31: uebernimm lädt unter der Sperre nicht, die Freigabe holt es nach; danach spielt die Spur als Audio (Spec 3.2)
  assert.ok(await geladen(a), 'nach der Freigabe nachgeladen');
  const w = a.wiedergabe(a.projekt().wiedergabe_rev);
  const s3 = w.spuren.find((s) => s.nr === 3);
  assert.equal(s3.art, 'audio', 'eingefrorene Wirt-Spur kommt als Audio (Spec 3.2)');
  assert.deepEqual([s3.clips[0].datei, s3.clips[0].frames, s3.clips[0].start_beat], [datei, 4800, 8]);
  assert.deepEqual(a.ausgabe.zustand(), sauber);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
  // Negativ-Kontrolle: noch einmal an ist kein Fehler und schickt nichts
  const nochmal = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.deepEqual([nochmal.code, nochmal.body.rev, a.freezes().length], [200, rev0 + 1, 1]);
});

test('Freeze aus: verwirft ohne Kern-Befehl und ohne Sperre, Label Unfreeze, Undo bringt den Freeze zurück; zweite Kennung verschieden und größer', async (t) => {
  const a = await aufbau(t);
  await a.ausgabe.freeze({ spur_id: 's3', an: true });
  const f = structuredClone(a.lead().freeze);
  await geladen(a);
  a.protokoll.reihenfolge.length = 0;
  const r = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: false }));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(a.lead().freeze, null);
  assert.equal(a.freezes().length, 1, 'Verwerfen braucht keinen Kern-Befehl');
  assert.deepEqual(a.protokoll.reihenfolge, ['uebernimm'], 'Verwerfen ist kein Kern-Lauf: keine Sperre');
  assert.equal(a.protokoll.uebernommen.at(-1).label, 'Unfreeze Lead');
  assert.ok(await geladen(a));
  assert.equal(a.wiedergabe(a.projekt().wiedergabe_rev).spuren.find((s) => s.nr === 3).art, 'wirt', 'die Spur spielt wieder über den Wirt');
  const u = await a.s.umkehr('undo', { rev: a.projekt().rev }, 'andreas');
  assert.equal(u.code, 200, JSON.stringify(u.j));
  assert.deepEqual(a.lead().freeze, f, 'Undo des Verwerfens bringt denselben Freeze zurück');
  await geladen(a);
  await a.ausgabe.freeze({ spur_id: 's3', an: false });
  await geladen(a);
  await a.ausgabe.freeze({ spur_id: 's3', an: true });
  const k2 = a.lead().freeze.kennung;
  assert.ok(k2 > f.kennung, `Spec 6.25/6.32: verschieden und steigend (${f.kennung} → ${k2}), nie „+1“ verlangt (Blöcke)`);
  assert.ok(fs.existsSync(path.join(a.arbeitsordner, `freeze-3-${f.kennung}.f32`)), 'die erste Datei bleibt für den Undo-Schritt liegen');
});

test('Freeze: Gründe vor dem Kern-Befehl (Argumente, Projekt, Spur, Wirt, Noten, Loop, KI-Stopp, Transport, Laden, Größe); nichts gesendet, Sperre frei', async (t) => {
  const a = await aufbau(t);
  const grund = async (d) => { const r = await ruf(() => a.ausgabe.freeze(d)); assert.match(r.body.text ?? '', /^[\x20-\x7e×–]+$/, `${r.body.fehler}: englischer text`); return [r.code, r.body.fehler]; };
  assert.deepEqual(await grund({ spur_id: 's3' }), [400, 'argument_ungueltig']);
  assert.deepEqual(await grund({ spur_id: 's3', an: 1 }), [400, 'argument_ungueltig']);
  assert.deepEqual(await grund({ spur_id: 's3', an: true, mehr: 1 }), [400, 'argument_ungueltig']);
  assert.deepEqual(await grund({ spur_id: 's9', an: true }), [400, 'spur_unbekannt']);
  assert.deepEqual(await grund({ spur_id: 's2', an: true }), [400, 'keine_wirtspur']);
  assert.deepEqual(await grund({ spur_id: 's1', an: true }), [400, 'keine_wirtspur']);
  a.zustand.quelle = 'cypher'; a.zustand.ki = true;
  assert.deepEqual(await grund({ spur_id: 's3', an: true }), [409, 'ki_gestoppt']);
  a.zustand.quelle = 'andreas';
  a.zustand.kernStatus = 2; a.arrMeldung();
  assert.deepEqual(await grund({ spur_id: 's3', an: true }), [409, 'transport_laeuft']);
  a.zustand.kernStatus = 0; a.zustand.kernNr -= 1; a.arrMeldung();
  assert.deepEqual(await grund({ spur_id: 's3', an: true }), [409, 'nicht_geladen']);
  a.zustand.kernNr += 1; a.arrMeldung();
  await a.aendern([{ befehl: 'clip_aendern', clip_id: 'c3', laenge_beats: 300 }]);
  await geladen(a);
  assert.deepEqual(await grund({ spur_id: 's3', an: true }), [400, 'zu_gross']);
  await a.aendern([{ befehl: 'clip_aendern', clip_id: 'c3', laenge_beats: 8 }, { befehl: 'clip_aendern', clip_id: 'c3', loop_beats: 0.5 },
    { befehl: 'noten_aendern', clip_id: 'c3', noten: [{ id: nid(a), beat: 1 }] }]);
  await geladen(a);
  assert.deepEqual(await grund({ spur_id: 's3', an: true }), [400, 'spur_leer'], 'Spec 6.17: Noten nur hinter loop_beats klingen nicht');
  await a.aendern([{ befehl: 'noten_loeschen', clip_id: 'c3', ids: [nid(a)] }]);
  await geladen(a);
  assert.deepEqual(await grund({ spur_id: 's3', an: true }), [400, 'spur_leer']);
  a.zustand.zu = true;
  assert.deepEqual(await grund({ spur_id: 's3', an: true }), [409, 'kein_projekt']);
  assert.equal(a.freezes().length, 0);
  assert.deepEqual(a.protokoll.reihenfolge, ['sperre', 'tempo', 'frei'], 'nur nicht_geladen (unter der Sperre geprüft, nach dem Tempo) nahm die Sperre, und gab sie frei');
  assert.equal(a.s.ladenGesperrt(), false);
  assert.deepEqual(a.ausgabe.zustand(), sauber);
  // Negativ-Kontrolle: Cypher ohne KI-Stopp darf
  a.zustand.zu = false; a.zustand.ki = false;
  await a.aendern([{ befehl: 'clip_aendern', clip_id: 'c3', loop_beats: null }, { befehl: 'noten_neu', clip_id: 'c3', noten: [{ beat: 0, laenge: 1, ton: 60, vel: 90 }] }]);
  await geladen(a);
  a.zustand.quelle = 'cypher';
  const ok = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal(a.freezes()[0].felder.quelle, 'cypher');
  assert.equal(a.s.verlaufListe().j.at(-1).quelle, 'cypher');
});

test('Freeze: Antworten des Kerns (Ablehnung, Tempo-Rampe, Abbruch, keine Datei, falsche Größe, Frist, keine Quittung) ändern das Projekt nicht, Sperre frei', async (t) => {
  const faelle = [
    [{ art: 'ablehnen', grund: 'ueberlappung' }, 409, 'transport_laeuft', /stop the transport first/],
    [{ art: 'ablehnen', grund: 'ki_gestoppt' }, 409, 'ki_gestoppt', /^Stop Cypher is set$/],
    [{ art: 'ablehnen', grund: 'nicht_geladen' }, 409, 'nicht_geladen', /has not loaded the current arrangement/],
    [{ art: 'ablehnen', grund: 'tempo_rampe' }, 409, 'beschaeftigt', /ramping the tempo/],
    [{ art: 'ablehnen', grund: 'ausserhalb_bereich' }, 502, 'freeze_fehler', /refused the freeze \(ausserhalb_bereich\)/],
    [{ art: 'abbruch', grund: 'ki_stopp' }, 409, 'ki_gestoppt', /^Stop Cypher is set$/],
    [{ art: 'abbruch', grund: 'abbruch' }, 502, 'freeze_fehler', /aborted the freeze \(transport start or stop/],
    [{ art: 'ohne_datei' }, 502, 'freeze_fehler', /did not write the freeze file/],
    [{ art: 'falsche_groesse' }, 502, 'freeze_fehler', /has 38392 bytes, expected 4800 frames/],
    [{ art: 'stumm' }, 502, 'freeze_fehler', /no \/e\/freeze within \d+ ms/],
    [{ art: 'ohne_quittung' }, 409, 'kein_kernstand', /no answer from the core/],
  ];
  // Fix-Runde S3 R5 (Lücke des Quality-Reviews hier: text nur als typeof string geprüft, keine Waisen, kein Verlauf): je Fall die Ursache im
  // englischen text, keine Freeze-Datei bleibt liegen (R4), kein Verlaufseintrag
  const englisch = (x) => typeof x === 'string' && x.length > 3 && /^[\x20-\x7e×–−]+$/.test(x);
  for (const [kern, code, fehler, ursache] of faelle) {
    const a = await aufbau(t, { kern, tempo: 200 });
    const rev = a.projekt().rev;
    const r = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
    assert.deepEqual([r.code, r.body.fehler], [code, fehler], `${JSON.stringify(kern)}: ${JSON.stringify(r.body)}`);
    assert.ok(englisch(r.body.text), `${kern.art}: englischer text ${r.body.text}`);
    assert.match(r.body.text, ursache, `${kern.art}: der Text nennt die Ursache`);
    assert.equal(a.projekt().rev, rev, `${kern.art}: Projekt unverändert`);
    assert.equal(a.s.verlaufListe().j.at(-1).label, 'Aufbau', `${kern.art}: kein Verlaufseintrag`);
    assert.deepEqual(fs.existsSync(a.arbeitsordner) ? fs.readdirSync(a.arbeitsordner).filter((f) => f.startsWith('freeze-')) : [], [],
      `${kern.art}: keine Freeze-Datei bleibt liegen`);
    assert.equal(a.lead().freeze, null);
    assert.deepEqual(a.ausgabe.zustand(), sauber, `${kern.art}: nichts hängt`);
    assert.equal(a.s.ladenGesperrt(), false, `${kern.art}: Sperre frei`);
    assert.equal(a.s.aktuell().j.ausgabe_lauf, null, `${kern.art}: ausgabe_lauf wieder null`);
    assert.equal((await noteAendern(a)).code, 200, `${kern.art}: die nächste Notenänderung geht durch`);
  }
});

test('Spec 6.23: während des Durchlaufs Noten 409 beschaeftigt, Fader 200; danach Noten 200; ein zweiter Lauf 409; eine Änderung, die an der Sperre vorbeikam, ergibt veraltet', async (t) => {
  const a = await aufbau(t, { kern: { art: 'ok', ms: 300 } });
  const erster = ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.ok(await warteBis(() => a.freezes().length === 1));
  assert.deepEqual(a.s.aktuell().j.ausgabe_lauf, { art: 'freeze', spur_id: 's3' }, 'Spec 6.34: GET /proj/aktuell zeigt den Lauf');
  const zweiter = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.deepEqual([zweiter.code, zweiter.body.fehler, zweiter.body.text], [409, 'beschaeftigt', 'a freeze is running']);
  const note = await noteAendern(a);
  assert.deepEqual([note.code, note.j.fehler], [409, 'beschaeftigt'], 'Notenänderung während des Freeze');
  assert.equal((await faderAendern(a)).code, 200, 'Fader während des Freeze (nur Regler)');
  assert.equal((await erster).code, 200);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
  assert.equal((await noteAendern(a)).code, 200, 'nach dem Freeze geht die Notenänderung durch (und verwirft ihn, Spec 3.3)');
  assert.equal(a.lead().freeze, null);
  await geladen(a);
  // veraltet: eine Hand-Änderung der Spur, die vor der Sperre geprüft wurde und währenddessen gespeichert wird (Spec 6.30)
  const lauf = ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.ok(await warteBis(() => a.freezes().length === 2));
  await a.vorbei([{ befehl: 'noten_aendern', clip_id: 'c3', noten: [{ id: nid(a), ton: 63 }] }]);
  const r = await lauf;
  assert.deepEqual([r.code, r.body.fehler], [409, 'veraltet']);
  assert.equal(a.lead().freeze, null);
  assert.equal(a.lead().clips[0].noten[0].ton, 63, 'die Hand-Änderung bleibt');
  assert.deepEqual(a.ausgabe.zustand(), sauber);
  assert.equal(a.s.ladenGesperrt(), false);
});

test('Spec 6.32: Kern-Neustart während des Freeze → freeze_fehler, Sperre frei, kein neuer Freeze von selbst; Kern verloren (Stille) ebenso', async (t) => {
  const a = await aufbau(t, { kern: { art: 'haengt' } });
  const lauf = ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.ok(await warteBis(() => a.freezes().length === 1));
  assert.equal(a.s.ladenGesperrt(), true, 'während des Laufs gesperrt');
  a.vomKern('/e/neustart', { generation: 2 });
  const r = await lauf;
  assert.deepEqual([r.code, r.body.fehler], [502, 'freeze_fehler'], JSON.stringify(r.body));
  assert.match(r.body.text, /restarted/);
  assert.equal(a.s.ladenGesperrt(), false, 'Sperre frei');
  assert.equal(a.lead().freeze, null);
  assert.equal((await noteAendern(a)).code, 200, 'die nächste Notenänderung geht durch');
  await new Promise((ok) => setTimeout(ok, 300));
  assert.equal(a.freezes().length, 1, 'S3 startet keinen neuen Freeze von selbst');
  // Negativ-Kontrolle: ein /e/neustart derselben Generation (Wiederholung) beendet nichts
  a.vomKern('/e/neustart', { generation: 2 });
  // Kern verloren: nach /k/arr/freeze keine Meldung mehr
  const b = await aufbau(t, { kern: { art: 'weg' }, opt: { stilleMs: 300 } });
  const t0 = Date.now();
  const v = await ruf(() => b.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.deepEqual([v.code, v.body.fehler], [502, 'freeze_fehler'], JSON.stringify(v.body));
  assert.match(v.body.text, /core lost/);
  assert.ok(Date.now() - t0 < 2000, `Stille erkannt vor der Frist (${Date.now() - t0} ms)`);
  assert.equal(b.s.ladenGesperrt(), false);
  assert.equal((await noteAendern(b)).code, 200);
  // Negativ-Kontrolle: ein Kern, der im Takt meldet, ist nicht verloren, auch wenn der Lauf länger dauert als die Stille-Grenze
  const c = await aufbau(t, { kern: { art: 'ok', ms: 700 }, opt: { stilleMs: 300 } });
  assert.equal((await ruf(() => c.ausgabe.freeze({ spur_id: 's3', an: true }))).code, 200);
});

test('Spec 6.32: solange ein Öffnen läuft, lehnt sperreLaden ab: /proj/freeze 409 beschaeftigt mit Ursache, nichts gesendet', async (t) => {
  const a = await aufbau(t);
  a.zustand.verzoegerLaden = 400;                                       // das Öffnen wartet auf die Lade-Quittung
  a.zustand.kernNr -= 1; a.arrMeldung();                                // kein Wiederanlauf (Spec 6.21): das Öffnen lädt
  a.protokoll.gesendet.length = 0;
  const oeffnen = a.s.oeffnen(a.echt.offen().slug, 'andreas');
  assert.ok(await warteBis(() => a.protokoll.gesendet.some((g) => g.adresse === '/k/arr/laden')));
  const r = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.deepEqual([r.code, r.body.fehler, r.body.text], [409, 'beschaeftigt', 'a project is being opened; a freeze waits until it is open']);
  assert.equal(a.freezes().length, 0);
  assert.equal((await oeffnen).code, 200);
  assert.deepEqual(a.ausgabe.zustand(), sauber);
  a.zustand.verzoegerLaden = 0;
  await geladen(a);
  assert.equal((await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }))).code, 200, 'Negativ-Kontrolle: nach dem Öffnen geht es');
});

test('Spec 2.7: deck_laeuft nur, wenn das Master-Tempo abweicht UND ein Deck läuft; Deck läuft bei gleichem Tempo → 200', async (t) => {
  const a = await aufbau(t, { tempo: 124 });
  a.vomKern('/zustand/deck', { deck: 1, status: 2 });
  const gleich = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.equal(gleich.code, 200, JSON.stringify(gleich.body));
  await geladen(a);
  await a.ausgabe.freeze({ spur_id: 's3', an: false });
  await geladen(a);
  a.vomKern('/uhr', { beat: 1, bpm: 128, sample: 0n });
  const anders = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.deepEqual([anders.code, anders.body.fehler], [409, 'deck_laeuft']);
  assert.equal(typeof anders.body.text, 'string');
  assert.equal(a.s.ladenGesperrt(), false, 'Sperre frei');
  assert.equal(a.freezes().length, 1, 'kein zweiter /k/arr/freeze');
});

test('ausgabeBereich: ohne vollständigen ProjZugang scheitert schon der Aufbau laut (statt 500 bei der ersten Anfrage)', async (t) => {
  const { ausgabeBereich } = await import('../bereiche/proj/ausgabe.ts');
  const a = await aufbau(t);
  assert.throws(() => ausgabeBereich(a.ctx, undefined), /ProjZugang der S2-Integration hat kein offen\(\)/);
  assert.throws(() => ausgabeBereich(a.ctx, { ...a.echt, sperreLaden: undefined }), /kein sperreLaden\(\)/);
  assert.throws(() => ausgabeBereich(a.ctx, { ...a.echt, ausgabeLauf: undefined }), /kein ausgabeLauf\(\)/);
  const b = ausgabeBereich(a.ctx, a.echt);
  assert.deepEqual([b.name, b.routen().map((r) => [r.methode, r.pfad, r.schutz])[0]], ['proj-ausgabe', ['POST', '/proj/freeze', 'fremdePost']]);
  assert.equal(typeof b.ereignis, 'function');
});

// Fix-Runde S3, R4 (Quality-Review P2): eine Freeze-Datei, die der Kern für DIESEN Lauf geschrieben hat, die aber nie ins Projekt kam (veraltet,
// falsche Größe), bleibt nicht als Waise im Arbeitsordner. Eine Datei, auf die das Projekt oder eine Undo-Stufe zeigt, wird nie gelöscht.
const freezeDateien = (a) => (fs.existsSync(a.arbeitsordner) ? fs.readdirSync(a.arbeitsordner).filter((f) => /^freeze-/.test(f)).sort() : []);
test('R4: verworfene Freeze-Dateien des eigenen Laufs werden entfernt (veraltet, falsche Größe); Dateien mit Undo-Bezug bleiben', async (t) => {
  // veraltet: der Kern hat die Datei geschrieben, die Spur hat sich währenddessen geändert
  const a = await aufbau(t, { kern: { art: 'ok', ms: 200 } });
  const lauf = ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.ok(await warteBis(() => a.freezes().length === 1));
  await a.vorbei([{ befehl: 'noten_aendern', clip_id: 'c3', noten: [{ id: nid(a), ton: 63 }] }]);
  const r = await lauf;
  assert.deepEqual([r.code, r.body.fehler], [409, 'veraltet']);
  assert.deepEqual(freezeDateien(a), [], `veraltet: keine Waise (${freezeDateien(a)})`);
  // falsche Größe: die Datei liegt da, wird aber verworfen
  const g = await aufbau(t, { kern: { art: 'falsche_groesse' } });
  const rg = await ruf(() => g.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.deepEqual([rg.code, rg.body.fehler], [502, 'freeze_fehler']);
  assert.deepEqual(freezeDateien(g), [], `falsche Größe: keine Waise (${freezeDateien(g)})`);
  // Negativ-Kontrolle: gespeichert, dann verworfen (Unfreeze): die Datei bleibt für den Undo-Schritt; ein späterer gescheiterter Lauf lässt sie stehen
  const b = await aufbau(t);
  assert.equal((await ruf(() => b.ausgabe.freeze({ spur_id: 's3', an: true }))).code, 200);
  const erste = freezeDateien(b);
  assert.equal(erste.length, 1);
  await geladen(b);
  assert.equal((await ruf(() => b.ausgabe.freeze({ spur_id: 's3', an: false }))).code, 200);
  await geladen(b);
  b.zustand.kern = { art: 'falsche_groesse' };
  assert.equal((await ruf(() => b.ausgabe.freeze({ spur_id: 's3', an: true }))).body.fehler, 'freeze_fehler');
  assert.deepEqual(freezeDateien(b), erste, 'die Datei der Undo-Stufe bleibt, nur die neue ist weg');
  // Gespeichert, danach scheitert uebernimm (wie R1): das Projekt zeigt auf die Datei, sie bleibt
  const c = await aufbau(t);
  const echt = c.zugang.uebernimm;
  c.zugang.uebernimm = async (w, m) => { await echt(w, m); throw new Error('Probe: nach dem Speichern'); };
  assert.equal((await ruf(() => c.ausgabe.freeze({ spur_id: 's3', an: true }))).code, 500);
  c.zugang.uebernimm = echt;
  assert.ok(c.lead().freeze, 'der Freeze steht im Projekt');
  assert.deepEqual(freezeDateien(c), [c.lead().freeze.datei], 'die Datei, auf die das Projekt zeigt, bleibt');
});

// Fix-Runde 2 S3, F1 (Re-Review K1): verworfen wird nur eine Datei, die dieser Durchlauf nachweislich selbst geschrieben hat (nach /e/freeze 0).
// Meldet der Kern /e/freeze 2 (die Datei gibt es schon, K3 ersetzt nie: EEXIST), gehört sie einem anderen (etwa einem Projekt im gemeinsamen
// Arbeitsordner) und bleibt; ebenso bei Abbruch, Frist, Stille, Kern-Neustart und Server-Stopp, wo nie eine eigene Datei bestätigt wurde.
test('F1: eine schon bestehende Freeze-Datei bleibt bei /e/freeze 2, Abbruch, Frist, Stille, Neustart und Server-Stopp', async (t) => {
  const faelle = [
    ['/e/freeze 2', 'ohne_datei', {}],
    ['Abbruch', 'abbruch', { grund: 'abbruch' }],
    ['Frist', 'stumm', {}],
    ['Stille', 'weg', {}],
    ['Neustart', 'haengt', { danach: (a) => a.vomKern('/e/neustart', { generation: 2 }) }],
    ['Server-Stopp', 'haengt', { danach: (a) => a.ausgabe.schliesse() }],
  ];
  for (const [wer, art, extra] of faelle) {
    const a = await aufbau(t, { kern: { art, grund: extra.grund } });
    const echt = a.zugang.naechsteNummer;
    let fremd = null;
    a.zugang.naechsteNummer = () => {                                  // die Datei, die der Kern gleich schreiben sollte, liegt schon da
      const k = echt();
      fs.mkdirSync(a.arbeitsordner, { recursive: true });
      fremd = path.join(a.arbeitsordner, `freeze-3-${k}.f32`);
      fs.writeFileSync(fremd, Buffer.alloc(4800 * 8, 1));
      return k;
    };
    const lauf = ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
    if (extra.danach) { assert.ok(await warteBis(() => a.ausgabe.zustand().wartend === 1)); extra.danach(a); }
    const r = await lauf;
    assert.deepEqual([r.code, r.body.fehler], [502, 'freeze_fehler'], `${wer}: ${JSON.stringify(r.body)}`);
    assert.ok(fremd && fs.existsSync(fremd), `${wer}: die schon bestehende Datei ${fremd && path.basename(fremd)} wurde gelöscht`);
    assert.deepEqual(fs.readFileSync(fremd), Buffer.alloc(4800 * 8, 1), `${wer}: Inhalt unverändert`);
  }
});

test('R7: schliesse() beendet einen wartenden Freeze sofort mit freeze_fehler, Uhr und Sperre frei, kein neuer Lauf danach', async (t) => {
  const a = await aufbau(t, { kern: { art: 'haengt' }, opt: { stilleMs: 60_000, zugabeMs: 60_000 } });
  const lauf = ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.ok(await warteBis(() => a.freezes().length === 1 && a.ausgabe.zustand().wartend === 1));
  const t0 = Date.now();
  a.ausgabe.schliesse();
  const r = await lauf;
  assert.ok(Date.now() - t0 < 500, `sofort (${Date.now() - t0} ms), nicht nach Stille oder Frist`);
  assert.deepEqual([r.code, r.body.fehler, r.body.text], [502, 'freeze_fehler', 'the server is shutting down; the freeze was abandoned and nothing was saved']);
  assert.deepEqual(a.ausgabe.zustand(), sauber);
  assert.equal(a.s.ladenGesperrt(), false);
  assert.equal(a.lead().freeze, null);
  const neu = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.deepEqual([neu.code, neu.body.fehler, neu.body.text], [409, 'beschaeftigt', 'the server is shutting down']);
  assert.equal(a.freezes().length, 1, 'nichts mehr an den Kern');
});
