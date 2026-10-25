// 1.8 Task 26, Step 7a (Nachbesserung 1): der Ablauf von Aufnahme.start/stopp gegen einen Prüf-Kontext. M1: Quittung 7 der Rec-ID wird gelesen (der erste Entwurf
// meldete 200 laeuft); M2: ein Lauf endet auch ohne POST stopp (Meldungen des Kerns, Quittung 7); N3: ein abgelehnter Stopp lässt den Lauf stehen; zwei gleichzeitige Starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { aufnahmeBereich } from '../bereiche/proj/aufnahme.ts';
import { pruefKontext, arrNr, warteBis } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const ergebnis = async (p) => { try { const r = await p; return { code: r.code, j: r.j }; } catch (x) { return { code: x.code, fehler: x.fehler, grund: x.extra?.grund }; } };
// rec: die Antworten des Kerns auf die 1., 2., … Abfrage der Quittungen von /k/rec/start (die letzte gilt weiter)
async function bereit(t, rec, opt = {}) {
  const k = pruefKontext();
  const roh = k.warteQuittung.bind(k), zaehler = new Map();
  k.warteQuittung = async (id) => {
    const g = k.gesendet.find((x) => x.id === id);
    if (g?.adresse !== '/k/rec/start') return roh(id);
    const n = (zaehler.get(id) ?? 0) + 1;
    zaehler.set(id, n);
    return rec[Math.min(n, rec.length) - 1];
  };
  const d = tmpOrdner(t, 'djk-recst-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  const br = aufnahmeBereich(k, opt.zugang ? opt.zugang(b.zugang) : b.zugang, { fristMs: 60 });
  t.after(() => br.aufnahme.schliesse());
  const s = b.sitzung, a = br.aufnahme;
  await s.neu('R', 'andreas');
  s.ereignis('/uhr', { beat: 2, bpm: 120 });
  await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'G' }] }, 'andreas');
  const pr = s.aktuell().j.projekt;
  await s.aendern({ rev: pr.rev, label: 'Arm', befehle: [{ befehl: 'spur_aendern', spur_id: pr.spuren[0].id, eingang: { art: 'intern', name: 'erz/1' }, arm: true }] }, 'andreas');
  if (opt.zweiSpuren) {
    await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Spur2', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'H' }] }, 'andreas');
    const p2 = s.aktuell().j.projekt;
    await s.aendern({ rev: p2.rev, label: 'Arm2', befehle: [{ befehl: 'spur_aendern', spur_id: p2.spuren[1].id, eingang: { art: 'intern', name: 'erz/2' }, arm: true }] }, 'andreas');
  }
  k.leere();
  const kern = (adr, f) => { b.ereignis(adr, f); a.ereignis(adr, f); };   // was der Server jedem Bereich liefert
  const nr = s.aktuell().j.projekt.spuren[0].nr, nrArr = s.aktuell().j.projekt.wiedergabe_rev;
  return { k, b, s, a, kern, nr, nrArr, recId: () => k.an('/k/rec/start')[0]?.id };
}
const angenommen = { status: 1, grund: '' };

test('M1: der Kern verwirft den Start (Quittung 7 zu_spaet): 409 aufnahme_abgebrochen, der Transport wird angehalten, keine Sperre, kein Lauf', async (t) => {
  const e = await bereit(t, [angenommen, { status: 7, grund: 'zu_spaet' }]);
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.deepEqual([r.code, r.fehler, r.grund], [409, 'aufnahme_abgebrochen', 'zu_spaet']);
  assert.equal(e.k.an('/k/arr/stopp').length, 1, 'der Transport, den dieser Aufruf gestartet hat, ist wieder aus');
  assert.equal(e.b.sitzung.ladenGesperrt(), false);
  assert.equal(e.a.lage().j.lauf, null);
});
test('M1 Negativ-Kontrolle: Quittung 2 (Einsatz) statt 7: 200 laeuft, Transport läuft weiter, Sperre gehalten; POST stopp ohne Datei meldet datei_fehlt und gibt frei', async (t) => {
  const e = await bereit(t, [angenommen, { status: 2, grund: '' }]);
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.equal(r.code, 200);
  assert.equal(r.j.aufnahme, 'laeuft');
  assert.equal(e.k.an('/k/rec/start')[0].felder.frist_samples, 480000, 'die Frist geht mit');
  assert.equal(e.k.an('/k/arr/stopp').length, 0);
  assert.equal(e.b.sitzung.ladenGesperrt(), true);
  const s = await ergebnis(e.a.stopp('andreas'));
  assert.equal(s.code, 200);
  assert.equal(s.j.takes[0].fehler, 'datei_fehlt', 'die Attrappe fehlt, die Meldung des Kerns kam nicht');
  assert.equal(e.b.sitzung.ladenGesperrt(), false);
});
test('M1/M2: die Quittung 7 kommt erst nach der Antwort (Einsatz unbestätigt): der Lauf endet von selbst, Sperre frei, letzte meldet aufnahme_abgebrochen, POST stopp liefert es einmal', async (t) => {
  const e = await bereit(t, [angenommen, angenommen]);
  assert.equal((await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'))).code, 200);
  assert.equal(e.b.sitzung.ladenGesperrt(), true);
  e.kern('/q', { id: e.recId(), status: 7, grund: 'abbruch' });
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 1000), 'der Lauf ist zu Ende');
  assert.equal(e.b.sitzung.ladenGesperrt(), false);
  const z = e.a.lage().j.letzte;
  assert.deepEqual([z.code, z.fehler, z.grund], [409, 'aufnahme_abgebrochen', 'abbruch']);
  const s1 = await ergebnis(e.a.stopp('andreas'));
  assert.deepEqual([s1.code, s1.j.fehler], [409, 'aufnahme_abgebrochen']);
  assert.deepEqual([(await ergebnis(e.a.stopp('andreas'))).fehler], ['keine_aufnahme']);
});
test('M2: der Transport endete auf anderem Weg, der Kern meldet alle Takes (/e/aufnahme): der Lauf endet von selbst und gibt die Sperre frei', async (t) => {
  const e = await bereit(t, [angenommen, { status: 2, grund: '' }]);
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.equal(r.code, 200);
  const kennung = r.j.kennung;
  e.kern('/e/aufnahme', { spur: e.nr, kennung: kennung + 1, status: 0, frames: 10, start_sample: 0n, luecken: 0 });   // fremde Kennung: ändert nichts
  assert.equal(e.a.lage().j.lauf !== null, true, 'Negativ-Kontrolle: eine Meldung einer anderen Kennung beendet den Lauf nicht');
  e.kern('/e/aufnahme', { spur: e.nr, kennung, status: 2, frames: 0, start_sample: 0n, luecken: 0 });
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 1000), 'der Lauf ist zu Ende');
  assert.equal(e.b.sitzung.ladenGesperrt(), false);
  assert.equal(e.a.lage().j.letzte.takes[0].fehler, 'datei_fehlt');
});
test('N3: Cypher will Andreas\' Aufnahme stoppen: 409 transport_laeuft, der Lauf und die Sperre bleiben; Andreas stoppt danach', async (t) => {
  const e = await bereit(t, [angenommen, { status: 2, grund: '' }]);
  assert.equal((await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'))).code, 200);
  e.kern('/zustand/arr', { ...arrNr(e.nrArr), status: 2 });
  const r = await ergebnis(e.a.stopp('cypher'));
  assert.deepEqual([r.code, r.fehler], [409, 'transport_laeuft']);
  assert.notEqual(e.a.lage().j.lauf, null, 'der Lauf steht noch');
  assert.equal(e.b.sitzung.ladenGesperrt(), true);
  assert.equal(e.k.an('/k/arr/stopp').length, 0);
  assert.equal((await ergebnis(e.a.stopp('andreas'))).code, 200);
  assert.equal(e.b.sitzung.ladenGesperrt(), false);
});
test('zwei gleichzeitige Starts: genau einer läuft, der andere bekommt beschaeftigt', async (t) => {
  const e = await bereit(t, [angenommen, { status: 2, grund: '' }]);
  const [x, y] = await Promise.all([ergebnis(e.a.start({ von_beat: 0 }, 'andreas')), ergebnis(e.a.start({ von_beat: 0 }, 'andreas'))]);
  assert.deepEqual([x.code, y.code].sort(), [200, 409]);
  assert.equal([x, y].find((r) => r.code === 409).fehler, 'beschaeftigt');
  assert.equal(e.k.an('/k/rec/start').length, 1);
});

// --- Review-Nachzug Task 26 (R1) ---------------------------------------------------------------------------------------------------------------------------
test('R1 beat: von_beat über MAX_BEAT: 400 beat_ungueltig, der Kern bekommt gar kein /k/rec/start (Negativ-Kontrolle: von_beat 4 startet)', async (t) => {
  const e = await bereit(t, [angenommen, { status: 2, grund: '' }]);
  const r = await ergebnis(e.a.start({ von_beat: 200000 }, 'andreas'));
  assert.deepEqual([r.code, r.fehler], [400, 'beat_ungueltig']);
  assert.deepEqual([e.k.an('/k/rec/start').length, e.k.an('/k/rec/stopp').length], [0, 0]);
  assert.equal(e.b.sitzung.ladenGesperrt(), false);
  assert.equal((await ergebnis(e.a.start({ von_beat: 4 }, 'andreas'))).code, 200);
  assert.equal(e.k.an('/k/rec/start').length, 1);
});
test('R1 Transport wirft nach /k/rec/start: der Kern bekommt /k/rec/stopp, Sperre frei, kein Lauf (Negativ-Kontrolle: ohne Wurf kein /k/rec/stopp)', async (t) => {
  const e = await bereit(t, [angenommen, { status: 2, grund: '' }], { zugang: (z) => ({ ...z, transport: async () => { throw Object.assign(new Error('x'), { code: 409, fehler: 'transport_laeuft' }); } }) });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.deepEqual([r.code, r.fehler], [409, 'transport_laeuft']);
  assert.equal(e.k.an('/k/rec/start').length, 1);
  assert.equal(e.k.an('/k/rec/stopp').length, 1, 'der scharfe Kern wird zurückgenommen');
  assert.equal(e.b.sitzung.ladenGesperrt(), false);
  assert.equal(e.a.lage().j.lauf, null);
  const g = await bereit(t, [angenommen, { status: 2, grund: '' }]);
  assert.equal((await ergebnis(g.a.start({ von_beat: 0 }, 'andreas'))).code, 200);
  assert.equal(g.k.an('/k/rec/stopp').length, 0, 'Negativ-Kontrolle: ein gelungener Start sendet kein /k/rec/stopp');
});
test('R1 transport_abgelehnt: Quittung 6 des Transports: 409, genau ein /k/rec/stopp, Sperre frei', async (t) => {
  const e = await bereit(t, [angenommen, { status: 2, grund: '' }], { zugang: (z) => ({ ...z, transport: async () => ({ code: 200, j: { quittung: { status: 6 } } }) }) });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.deepEqual([r.code, r.j.fehler], [409, 'transport_abgelehnt']);
  assert.equal(e.k.an('/k/rec/stopp').length, 1);
  assert.equal(e.b.sitzung.ladenGesperrt(), false);
});
const rohdatei = (e, kennung, nr, frames) => {
  const f = path.join(e.b.zugang.arbeitsordner(), `aufnahme-${nr}-${kennung}.f32`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.alloc(frames * 8, 1));
  return f;
};
test('R1 Status 2 (abgebrochen) mit vorhandener Rohdatei: der Take wird übernommen, Name "(aborted)", kein datei_fehlt', async (t) => {
  const e = await bereit(t, [angenommen, { status: 2, grund: '' }]);
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  const kennung = r.j.kennung;
  rohdatei(e, kennung, e.nr, 48000);
  e.kern('/e/aufnahme', { spur: e.nr, kennung, status: 2, frames: 48000, start_sample: 0n, luecken: 0 });
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 1000));
  const x = e.a.lage().j.letzte.takes[0];
  assert.equal(x.fehler, undefined, JSON.stringify(x));
  assert.equal(x.frames, 48000);
  assert.deepEqual(e.s.aktuell().j.projekt.spuren[0].clips.map((c) => c.name), [`Take ${kennung} (aborted)`]);
});
test('R1 ein Fehler einer Spur (WAV existiert schon, EEXIST) verwirft die andere Spur nicht: uebernahme_fehler neben einem gesetzten Clip', async (t) => {
  const e = await bereit(t, [angenommen, { status: 2, grund: '' }], { zweiSpuren: true });
  const p = e.s.aktuell().j.projekt;
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.equal(r.code, 200, JSON.stringify(r));
  const kennung = r.j.kennung, [s1, s2] = p.spuren;
  const wav = path.join(e.b.zugang.offen().ordner, 'aufnahmen', `take-${kennung}-${s1.nr}.wav`);
  fs.mkdirSync(path.dirname(wav), { recursive: true });
  fs.writeFileSync(wav, 'vorhanden');
  for (const s of [s1, s2]) { rohdatei(e, kennung, s.nr, 4800); e.kern('/e/aufnahme', { spur: s.nr, kennung, status: 0, frames: 4800, start_sample: 0n, luecken: 0 }); }
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 1000));
  const l = e.a.lage().j;
  assert.equal(l.letzte.code, 200, JSON.stringify(l.letzte));
  assert.deepEqual(l.letzte.takes.map((x) => x.fehler), ['uebernahme_fehler', undefined]);
  assert.equal(fs.readFileSync(wav, 'utf8'), 'vorhanden', 'die fremde Datei bleibt unberührt');
  const q = e.s.aktuell().j.projekt.spuren;
  assert.deepEqual([q[0].clips.length, q[1].clips.length], [0, 1]);
});
