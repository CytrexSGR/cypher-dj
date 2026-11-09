// 1.8 S2b.2: the server starts a run with external inputs. Release (frei_fuer_cypher, D4), device present, latency profile, the offset
// versatz = profile samples + ausgang_vorhalt (D9), one nachlauf_samples for the run, the clip rule of S2b.1. Mock core context, temp device config.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { projBereich } from '../areas/proj/area.ts';
import { aufnahmeBereich } from '../areas/proj/recording.ts';
import { GeraeteSpeicher, standard } from '../areas/devices/store.ts';
import { pruefKontext, warteBis } from './support/proj_context.mjs';
import { tmpOrdner } from './support/project.mjs';

const ergebnis = async (p) => { try { const r = await p; return { code: r.code, j: r.j }; } catch (x) { return { code: x.code, fehler: x.fehler, grund: x.extra?.grund }; } };
const angenommen = { status: 1, grund: '' };
const RATE = 48000;
const LATENZ = (samples, quantum = 256) => ({ samples, streuung: 0, min: samples, max: samples, laeufe: 20, quantum, rate: RATE, art: 'software', gemessen_am: '2026-11-05' });
// eingaenge: k -> { latenz, frei, audio } ; unlisted pairs keep the default (no device)
function konfig(d, eingaenge) {
  const k = standard();
  for (const [paar, o] of Object.entries(eingaenge)) {
    const e = k.eingaenge[Number(paar) - 1];
    e.profil = 'pc-eingang';
    e.audio = o.audio === null ? null : { knoten: `knoten-${paar}`, ports: [`dev:in_${paar}_L`, `dev:in_${paar}_R`] };
    if (o.audio === null) e.profil = null;
    e.latenz = o.latenz ?? null;
    e.frei_fuer_cypher = !!o.frei;
  }
  const pfad = path.join(d, 'geraete.json');
  new GeraeteSpeicher(pfad).schreibe(k);
  return pfad;
}
// spuren: [{ name, eingang }]; eingang as spur_aendern carries it
async function bereit(t, { spuren, eingaenge, rec = [angenommen, { status: 2, grund: '' }], zustand = { ausgang_vorhalt: 0, quantum: 256 }, ohneKonfigDatei = false, arr = true, ladeMs = 150 }) {
  const k = pruefKontext();
  const roh = k.warteQuittung.bind(k), zaehler = new Map();
  k.warteQuittung = async (id) => {
    const g = k.gesendet.find((x) => x.id === id);
    if (g?.adresse !== '/k/rec/start') return roh(id);
    const n = (zaehler.get(id) ?? 0) + 1;
    zaehler.set(id, n);
    return rec[Math.min(n, rec.length) - 1];
  };
  const d = tmpOrdner(t, 'djk-recext-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  const geraeteKonfig = ohneKonfigDatei ? path.join(d, 'gibt-es-nicht.json') : konfig(d, eingaenge);
  const br = aufnahmeBereich(k, b.zugang, { fristMs: 60, geraeteKonfig, zustandMs: 80, ladeMs });
  t.after(() => br.aufnahme.schliesse());
  const s = b.sitzung, a = br.aufnahme;
  await s.neu('R', 'andreas');
  s.ereignis('/uhr', { beat: 2, bpm: 120 });
  for (const sp of spuren) {
    await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio', name: sp.name }] }, 'andreas');
    const pr = s.aktuell().j.projekt, id = pr.spuren.at(-1).id;
    await s.aendern({ rev: pr.rev, label: 'Arm', befehle: [{ befehl: 'spur_aendern', spur_id: id, eingang: sp.eingang, arm: true }] }, 'andreas');
  }
  // T2: the core plays the project's playback (nr = wiedergabe_rev) before it reports; a report counts only after that
  const arrMeldung = () => ({ status: 0, nr: s.aktuell().j.projekt.wiedergabe_rev, loop_an: 0, projekt_beat: 0, ursprung_sample: -1n, start_beat: 0, metronom_an: 0, limiter_db: 0 });
  if (arr) a.ereignis('/zustand/arr', arrMeldung());
  if (zustand) a.ereignis('/zustand/rec', { status: 0, kennung: 0, scharf: 0, luecken: 0n, projekt_beat: 0, ...zustand });
  k.leere();
  const kern = (adr, f) => { b.ereignis(adr, f); a.ereignis(adr, f); };
  return { k, b, s, a, d, kern, arrMeldung, spuren: s.aktuell().j.projekt.spuren, arbeits: b.zugang.arbeitsordner() };
}
const ext = (paar, modus = 'stereo') => ({ art: 'extern', paar, modus });

test('S2b.2 refusal: an external track whose pair has no device: 409 kein_eingang, nothing goes to the core', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'X', eingang: ext(1) }], eingaenge: { 1: { audio: null } } });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.deepEqual([r.code, r.fehler], [409, 'kein_eingang']);
  assert.deepEqual([e.k.an('/k/rec/spur').length, e.k.an('/k/rec/start').length], [0, 0]);
  assert.equal(e.b.sitzung.ladenGesperrt(), false, 'no lock left behind');
});

test('S2b.2 refusal: Cypher on an input that is not released: 409 eingang_nicht_frei; Andreas on the same input starts (negative control)', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'X', eingang: ext(1) }], eingaenge: { 1: { latenz: LATENZ(256), frei: false } } });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'cypher'));
  assert.deepEqual([r.code, r.fehler], [409, 'eingang_nicht_frei']);
  assert.equal(e.k.an('/k/rec/start').length, 0);
  assert.equal((await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'))).code, 200, 'Andreas needs no release');
});

test('S2b.2 Cypher with a released input starts (temp config, D4); the answer carries the offset of the track', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'X', eingang: ext(2, 'links') }], eingaenge: { 2: { latenz: LATENZ(256), frei: true } } });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'cypher'));
  assert.equal(r.code, 200, JSON.stringify(r));
  assert.deepEqual(r.j.spuren.map((s) => s.versatz_samples), [256]);
  assert.equal(r.j.nachlauf_samples, 256);
  assert.equal(r.j.hinweise, undefined, 'a measured profile at the current quantum: no hint');
  assert.deepEqual(e.k.an('/k/rec/spur').filter((m) => m.felder.scharf === 1).map((m) => [m.felder.eingang, m.felder.modus]), [[2, 1]], 'pair 2, mode links');
});

test('S2b.2 offset = profile samples + ausgang_vorhalt; /k/rec/start carries nachlauf_samples = the offset', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'X', eingang: ext(1) }], eingaenge: { 1: { latenz: LATENZ(256) } }, zustand: { ausgang_vorhalt: 0, quantum: 256 } });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.deepEqual([r.code, r.j.spuren[0].versatz_samples], [200, 256], 'mock vorhalt 0 plus profile 256');
  assert.equal(e.k.an('/k/rec/start')[0].felder.nachlauf_samples, 256);
  const f = await bereit(t, { spuren: [{ name: 'X', eingang: ext(1) }], eingaenge: { 1: { latenz: LATENZ(256) } }, zustand: { ausgang_vorhalt: 144, quantum: 256 } });
  const r2 = await ergebnis(f.a.start({ von_beat: 0 }, 'andreas'));
  assert.deepEqual([r2.j.spuren[0].versatz_samples, f.k.an('/k/rec/start')[0].felder.nachlauf_samples], [400, 400], 'vorhalt 144 is added');
});

test('S2b.2 hints: no profile gives versatz = ausgang_vorhalt only and latenz_fehlt; a profile of another quantum gives latenz_veraltet', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'X', eingang: ext(1) }], eingaenge: { 1: {} }, zustand: { ausgang_vorhalt: 144, quantum: 256 } });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.equal(r.code, 200);
  assert.deepEqual([r.j.spuren[0].versatz_samples, r.j.hinweise], [144, ['latenz_fehlt']]);
  const f = await bereit(t, { spuren: [{ name: 'X', eingang: ext(1) }], eingaenge: { 1: { latenz: LATENZ(256, 512) } }, zustand: { ausgang_vorhalt: 0, quantum: 256 } });
  const r2 = await ergebnis(f.a.start({ von_beat: 0 }, 'andreas'));
  assert.deepEqual([r2.code, r2.j.spuren[0].versatz_samples, r2.j.hinweise], [200, 256, ['latenz_veraltet']], 'still used, but flagged');
});

test('S2b.2 only internal tracks: no device config is read, nachlauf 0, versatz 0, no hints (slice 1 behaviour, negative control)', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'I', eingang: { art: 'intern', name: 'erz/1' } }], eingaenge: {}, ohneKonfigDatei: true, zustand: null });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.equal(r.code, 200, JSON.stringify(r));
  assert.deepEqual([r.j.nachlauf_samples, r.j.spuren[0].versatz_samples, r.j.hinweise], [0, 0, undefined]);
  assert.equal(e.k.an('/k/rec/start')[0].felder.nachlauf_samples, 0);
});

test('S2b.2 an external run without any /zustand/rec yet: 409 kein_kern after the short wait, nothing sent; the report arriving later lets it start', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'X', eingang: ext(1) }], eingaenge: { 1: { latenz: LATENZ(256) } }, zustand: null });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.deepEqual([r.code, r.fehler], [409, 'kein_kern']);
  assert.equal(e.k.an('/k/rec/start').length, 0);
  e.kern('/zustand/rec', { status: 0, kennung: 0, scharf: 0, luecken: 0n, projekt_beat: 0, ausgang_vorhalt: 0, quantum: 256 });
  assert.equal((await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'))).code, 200);
});

test('S2b.2 mixed run: two external tracks with different profiles and one internal track: own offsets, ONE nachlauf on /k/rec/start, all clips cover the pass', async (t) => {
  const e = await bereit(t, {
    spuren: [{ name: 'A', eingang: ext(1) }, { name: 'B', eingang: ext(2, 'summe') }, { name: 'C', eingang: { art: 'intern', name: 'erz/1' } }],
    eingaenge: { 1: { latenz: LATENZ(256) }, 2: { latenz: LATENZ(600) } }, zustand: { ausgang_vorhalt: 0, quantum: 256 } });
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.equal(r.code, 200, JSON.stringify(r));
  assert.deepEqual(r.j.spuren.map((s) => s.versatz_samples), [256, 600, 0]);
  assert.equal(e.k.an('/k/rec/start').length, 1);
  assert.equal(e.k.an('/k/rec/start')[0].felder.nachlauf_samples, 600, 'the largest offset');
  // the core delivers a pass of 48000 frames plus the tail of 600 in every raw file
  for (const sp of e.spuren) {
    const buf = Buffer.alloc((48000 + 600) * 8);
    for (let i = 0; i < 48600; i++) { buf.writeFloatLE((i % 1000) / 1000, i * 8); buf.writeFloatLE(-(i % 1000) / 1000, i * 8 + 4); }
    fs.writeFileSync(path.join(e.arbeits, `aufnahme-${sp.nr}-${r.j.kennung}.f32`), buf);
  }
  for (const sp of e.spuren) e.kern('/e/aufnahme', { spur: sp.nr, kennung: r.j.kennung, status: 0, frames: 48600, start_sample: 0n, luecken: 0 });
  assert.ok(await warteBis(() => e.a.lage().j.lauf === null, 3000), 'the run ends by itself');
  const z = e.a.lage().j.letzte;
  assert.equal(z.code, 200);
  assert.deepEqual(z.takes.map((x) => [x.frames, x.versatz_samples, x.nachlauf_samples, x.fehler]), [[48600, 256, 600, undefined], [48600, 600, 600, undefined], [48600, 0, 600, undefined]]);
  const p = e.s.aktuell().j.projekt, T = (48000 / RATE) * (120 / 60);
  const clips = p.spuren.map((s) => s.clips[0]);
  for (const c of clips) assert.ok(Math.abs(c.laenge_beats - T) < 1e-9, `length ${c.laenge_beats} vs ${T}`);
  assert.equal(clips[0].laenge_beats, clips[1].laenge_beats);
  assert.equal(clips[1].laenge_beats, clips[2].laenge_beats);
  assert.deepEqual(clips.map((c) => c.offset_s), [256 / RATE, 600 / RATE, 0]);
});

// 1.8 T2: ausgang_vorhalt carries the delay compensation (PDC) of the playback in the core, so the take offset follows it.
const REC = (ausgangVorhalt) => ({ status: 0, kennung: 0, scharf: 0, luecken: 0n, projekt_beat: 0, ausgang_vorhalt: ausgangVorhalt, quantum: 256 });
const spaeter = (ms) => new Promise((ok) => setTimeout(ok, ms));

test('T2 an EQ insert in the playback: the core reports limiter 84 + pdc 69; the offset is larger by exactly the 69 (profile 256)', async (t) => {
  const opt = { spuren: [{ name: 'X', eingang: ext(1) }], eingaenge: { 1: { latenz: LATENZ(256) } } };
  const ohne = await bereit(t, { ...opt, zustand: { ausgang_vorhalt: 84, quantum: 256 } });
  const mit = await bereit(t, { ...opt, zustand: { ausgang_vorhalt: 84 + 69, quantum: 256 } });
  const r0 = await ergebnis(ohne.a.start({ von_beat: 0 }, 'andreas')), r1 = await ergebnis(mit.a.start({ von_beat: 0 }, 'andreas'));
  assert.deepEqual([r0.code, r0.j.spuren[0].versatz_samples], [200, 340]);
  assert.deepEqual([r1.code, r1.j.spuren[0].versatz_samples], [200, 409], 'larger by exactly 69');
  assert.equal(mit.k.an('/k/rec/start')[0].felder.nachlauf_samples, 409);
});

test('T2 a report from before the load of the current playback is not used: the start waits for the report that follows the load', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'X', eingang: ext(1) }], eingaenge: { 1: { latenz: LATENZ(256) } }, arr: false, zustand: null, ladeMs: 1500 });
  const jetzt = e.arrMeldung();
  const alt = { ...jetzt, nr: jetzt.nr - 1 };
  e.a.ereignis('/zustand/arr', alt);               // the core still plays the previous playback ...
  e.a.ereignis('/zustand/rec', REC(84));           // ... and reports its plain delay (no insert yet)
  const start = ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  await spaeter(40);
  assert.equal(e.k.an('/k/rec/start').length, 0, 'it waits for the load');
  e.a.ereignis('/zustand/arr', jetzt);             // the load arrived: the core now has the insert chain
  await spaeter(10);
  assert.equal(e.k.an('/k/rec/start').length, 0, 'the old report no longer counts, it waits for a new one');
  e.a.ereignis('/zustand/rec', REC(84 + 69));
  const r = await start;
  assert.deepEqual([r.code, r.j.spuren[0].versatz_samples], [200, 256 + 84 + 69], 'the report after the load, not the cached 84');
});

test('T2 a core that never loads the current playback: 409 kein_kernstand with the numbers, nothing sent; once it loads, the retry starts', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'X', eingang: ext(1) }], eingaenge: { 1: { latenz: LATENZ(256) } }, arr: false, zustand: null, ladeMs: 100 });
  const jetzt = e.arrMeldung();
  e.a.ereignis('/zustand/arr', { ...jetzt, nr: jetzt.nr - 1 });
  e.a.ereignis('/zustand/rec', REC(84));
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.deepEqual([r.code, r.fehler], [409, 'kein_kernstand']);
  assert.equal(e.k.an('/k/rec/start').length, 0);
  assert.equal(e.a.lage().j.lauf, null, 'no run, the lock is free');
  e.a.ereignis('/zustand/arr', jetzt);
  e.a.ereignis('/zustand/rec', REC(84 + 69));
  const r2 = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.deepEqual([r2.code, r2.j.spuren[0].versatz_samples], [200, 256 + 84 + 69]);
});

test('T2 a hello of a new core generation drops the cached report and the playback number (negative control: the same generation keeps them)', async (t) => {
  const e = await bereit(t, { spuren: [{ name: 'X', eingang: ext(1) }], eingaenge: { 1: { latenz: LATENZ(256) } }, zustand: { ausgang_vorhalt: 84, quantum: 256 } });
  e.a.ereignis('/k/willkommen', { generation: 1 });   // first generation seen: nothing cached yet is kept
  const r = await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'));
  assert.deepEqual([r.code, r.fehler], [409, 'kein_kern'], 'a new core has said nothing yet');
  e.a.ereignis('/zustand/arr', e.arrMeldung());
  e.a.ereignis('/zustand/rec', REC(84));
  assert.equal((await ergebnis(e.a.start({ von_beat: 0 }, 'andreas'))).code, 200);
});
