// 1.8 T9 (AK29): the Cypher latch around a recording. Stop Cypher refuses Cypher's start; a running take continues; a waiting start or count-in of Cypher ends
// with ki_stopp (the core does that, Arrangement/Aufnahme::ki_stopp; here the server's side of it); Andreas' transport refuses Cypher's start (transport_laeuft).
// The refusal of an external input without release (eingang_nicht_frei) is covered in proj_recording_extern.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projBereich } from '../areas/proj/area.ts';
import { aufnahmeBereich } from '../areas/proj/recording.ts';
import { pruefKontext, arrNr, warteBis } from './support/proj_context.mjs';
import { tmpOrdner } from './support/project.mjs';

const ergebnis = async (p) => { try { const r = await p; return { code: r.code, j: r.j }; } catch (x) { return { code: x.code, fehler: x.fehler, grund: x.extra?.grund }; } };
const angenommen = { status: 1, grund: '' };
const einsatz = { status: 2, grund: '' };

// The stand-in core answers /k/rec/start with `rec`: the 1st receipt is the acceptance; the 2nd is the one the server waits for (the entry). `spaet`: the 2nd receipt
// does not come by itself, the test delivers it with e.liefere(q) (a count-in: the entry is bars away).
async function bereit(t, { vorzaehler = 0, spaet = false } = {}) {
  const k = pruefKontext();
  const roh = k.warteQuittung.bind(k), zaehler = new Map();
  let frei = null;
  const zweite = new Promise((ok) => { frei = ok; });
  k.warteQuittung = async (id, ...rest) => {
    const g = k.gesendet.find((x) => x.id === id);
    if (g?.adresse !== '/k/rec/start') return roh(id, ...rest);
    const n = (zaehler.get(id) ?? 0) + 1;
    zaehler.set(id, n);
    if (n === 1) return angenommen;
    return spaet ? zweite : einsatz;
  };
  const d = tmpOrdner(t, 'djk-recki-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  const br = aufnahmeBereich(k, b.zugang, { fristMs: 60 });
  t.after(() => br.aufnahme.schliesse());
  const s = b.sitzung, a = br.aufnahme;
  await s.neu('K', 'andreas');
  s.ereignis('/uhr', { beat: 2, bpm: 120 });
  await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'G' }] }, 'andreas');
  const pr = s.aktuell().j.projekt;
  const befehle = [{ befehl: 'spur_aendern', spur_id: pr.spuren[0].id, eingang: { art: 'intern', name: 'erz/1' }, arm: true }];
  if (vorzaehler > 0) befehle.push({ befehl: 'aufnahme_setzen', vorzaehler_takte: vorzaehler });
  await s.aendern({ rev: pr.rev, label: 'Arm', befehle }, 'andreas');
  k.leere();
  const kern = (adr, f) => { b.ereignis(adr, f); a.ereignis(adr, f); };   // what the server hands to every area
  const nrArr = s.aktuell().j.projekt.wiedergabe_rev;
  return { k, b, s, a, kern, nrArr, liefere: (q) => frei(q), recId: () => k.an('/k/rec/start')[0]?.id };
}

test('AK29: Stop Cypher set: Cypher\'s start is 409 ki_gestoppt and nothing goes to the core; Andreas starts with the same state (negative control)', async (t) => {
  const e = await bereit(t);
  e.k.ki = true;
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'cypher'));
  assert.deepEqual([r.code, r.fehler], [409, 'ki_gestoppt']);
  assert.deepEqual(e.k.gesendet.map((m) => m.adresse), [], 'no message to the core');
  assert.equal(e.b.sitzung.ladenGesperrt(), false, 'no lock left behind');
  const a = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.equal(a.code, 200, JSON.stringify(a));
  assert.equal(e.k.an('/k/rec/start').length, 1);
});

test('AK29: a running recording of Cypher continues when Stop Cypher is pressed (no /k/rec/stopp, the lock stays); Andreas ends it', async (t) => {
  const e = await bereit(t);
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'cypher'));
  assert.equal(r.code, 200, JSON.stringify(r));
  e.kern('/zustand/arr', { ...arrNr(e.nrArr), status: 2 });
  e.k.ki = true;
  e.kern('/e/ki', { gestoppt: 1, grund: 'hand', sample: 0 });
  await new Promise((ok) => setTimeout(ok, 150));
  assert.notEqual(e.a.lage().j.lauf, null, 'the run continues');
  assert.equal(e.k.an('/k/rec/stopp').length, 0, 'nothing was stopped');
  assert.equal(e.b.sitzung.ladenGesperrt(), true, 'the lock stays');
  const s = await ergebnis(e.a.stopp('andreas'));
  assert.equal(s.code, 200, JSON.stringify(s));
  assert.equal(s.j.takes[0].fehler, 'datei_fehlt', 'the stand-in sends no take report, the end is what counts here');
  assert.equal(e.a.lage().j.lauf, null);
  assert.equal(e.b.sitzung.ladenGesperrt(), false);
});

test('AK29: a count-in of Cypher ends with ki_stopp (receipt 7): 409 aufnahme_abgebrochen with the reason, the transport of this call is stopped, no run, no lock', async (t) => {
  const e = await bereit(t, { vorzaehler: 1, spaet: true });
  const start = ergebnis(e.a.start({ von_beat: 0 }, 'cypher'));
  assert.ok(await warteBis(() => e.recId() !== undefined && e.k.an('/k/arr/start').length === 1, 2000), 'the count-in transport was started');
  assert.equal(e.k.an('/k/rec/start')[0].felder.vorzaehler_takte, 1, 'it is a count-in start');
  e.kern('/q', { id: e.recId(), status: 7, grund: 'ki_stopp' });   // the core: Stop Cypher ends Cypher's waiting start (and the count-in)
  e.liefere({ status: 7, grund: 'ki_stopp' });
  const r = await start;
  assert.deepEqual([r.code, r.fehler, r.grund], [409, 'aufnahme_abgebrochen', 'ki_stopp']);
  assert.equal(e.a.lage().j.lauf, null);
  assert.equal(e.b.sitzung.ladenGesperrt(), false);
  assert.equal(e.k.an('/k/arr/stopp').length, 1, 'the transport this call started is stopped again');
});

test('AK29: Andreas\' transport runs: Cypher\'s start is 409 transport_laeuft (nothing to the core); Andreas records into it (D8, negative control)', async (t) => {
  const e = await bereit(t);
  e.kern('/zustand/arr', { ...arrNr(e.nrArr), status: 2 });
  e.s.transport({ aktion: 'start', beat: 0 }, 'andreas').catch(() => {});   // the owner of the transport is Andreas
  await new Promise((ok) => setTimeout(ok, 50));
  e.k.leere();
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'cypher'));
  assert.deepEqual([r.code, r.fehler], [409, 'transport_laeuft']);
  assert.deepEqual(e.k.gesendet.map((m) => m.adresse), [], 'no message to the core');
  const a = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.equal(a.code, 200, JSON.stringify(a));
  assert.equal(e.k.an('/k/rec/start').length, 1);
});
