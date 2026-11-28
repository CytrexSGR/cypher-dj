// Note editor (slice 1, B2): the note detection job (areas/proj/notes.ts) with the stand-ins notes_mock.mjs (cypherdj-noten) and net_mock.mjs
// (the network module), on the real project session of the S3 set-up (no server, no kernel, no sound). Everything in a temp folder, in-process.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { aufbau } from './support/output_setup.mjs';
import { warteBis } from './support/proj_context.mjs';
import { notenBereich, raeumeNotenReste, CURVE_ID } from '../areas/proj/notes.ts';
import { kurveDatei } from '../project/notes_contract.ts';
import { notenMass } from '../project/notes_audio.ts';

const HIER = import.meta.dirname;
const ATTRAPPE = path.join(HIER, 'support', 'notes_mock.mjs');
const NETZ = [process.execPath, path.join(HIER, 'support', 'net_mock.mjs')];
const SHA = 'a'.repeat(64);

async function mitNoten(t, { fall = 'ok', env = {}, netz = NETZ, zeitlimitMs, killMs = 400, stems = { laeuft: false }, aufbauOpt = {}, programm = ATTRAPPE, vorher } = {}) {
  const r = await aufbau(t, aufbauOpt);
  const prot = path.join(r.tmp, 'noten.jsonl'), netzProt = path.join(r.tmp, 'netz.jsonl');
  if (vorher) await vorher(r);
  const b = notenBereich(r.ctx, r.zugang, { programm, netz, cwd: r.tmp, killMs, ...(zeitlimitMs ? { zeitlimitMs } : {}), stemsLaeuft: () => stems.laeuft,
    env: { NOTEN_ATTRAPPE_FALL: fall, NOTEN_ATTRAPPE_PROTOKOLL: prot, NETZ_ATTRAPPE_PROTOKOLL: netzProt, ...env } });
  t.after(() => b.analyse.schliesse());
  const stand = () => r.s.aktuell().j.noten;
  const ende = async (ms = 20000) => { assert.ok(await warteBis(() => stand() && stand().zustand !== 'laeuft', ms), JSON.stringify(stand())); return stand(); };
  const lies = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((z) => JSON.parse(z)) : []);
  const aufrufe = () => lies(prot).map((z) => z.befehl);
  const clip = () => r.projekt().spuren[0].clips[0];
  const notenOrdner = path.join(r.arbeitsordner, 'noten');
  const temps = () => fs.readdirSync(r.arbeitsordner).filter((f) => /^noten-\d+$/.test(f));
  // a route like the router calls it: request with a JSON body, a response that records code and body
  const ruf = async (methode, pfad, koerper = null, query = '') => {
    const route = b.routen().find((x) => x.methode === methode && x.pfad === pfad);
    assert.ok(route, `${methode} ${pfad}`);
    const q = Readable.from(koerper === null ? [] : [Buffer.from(JSON.stringify(koerper))]);
    const a = { code: 0, body: '', writeHead(c) { this.code = c; }, end(s) { this.body = s; } };
    await route.handler(q, a, new URL(`http://x${pfad}${query}`));
    return { code: a.code, j: JSON.parse(a.body) };
  };
  return { ...r, b, an: b.analyse, stand, ende, lies, aufrufe, clip, notenOrdner, temps, ruf, prot, netzProt };
}

test('detect: one change, one undo, label "Detect notes <name>", the sidecar in <arbeitsordner>/noten/, no temp folder left, SSE and /proj/aktuell carry the state', async (t) => {
  const z = await mitNoten(t, { netz: null });
  const vorher = structuredClone(z.projekt());
  const rev0 = z.projekt().rev;
  const a = await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(typeof a.j.auftrag_id, 'number');
  const e = await z.ende();
  assert.equal(e.zustand, 'fertig', JSON.stringify(e));
  assert.equal(e.noten, 3);
  assert.equal(e.detektor, 'pyin');
  assert.equal(e.auftrag_id, a.j.auftrag_id);
  const c = z.clip();
  assert.equal(c.audio_noten.kurve, CURVE_ID);
  assert.deepEqual(c.audio_noten.liste.map((n) => n.id), ['t1', 't2', 't3']);
  assert.ok(c.audio_noten.liste.every((n) => n.ton === undefined), 'detected values only, no target');
  assert.equal(z.projekt().rev, rev0 + 1, 'one change');
  const uebernommen = z.protokoll.uebernommen.filter((u) => u.label.startsWith('Detect notes'));
  assert.deepEqual(uebernommen.map((u) => u.label), [`Detect notes ${vorher.spuren[0].clips[0].name}`]);
  assert.ok(fs.existsSync(path.join(z.notenOrdner, kurveDatei(SHA, CURVE_ID))), 'sidecar');
  assert.deepEqual(z.temps(), [], 'temp folder gone');
  assert.deepEqual(z.aufrufe(), ['analyse', 'pruefe']);
  const sse = z.protokoll.verteilt.filter((x) => x.a === 'proj' && x.f?.noten).map((x) => x.f.noten);
  assert.equal(sse[0].zustand, 'laeuft');
  assert.equal(sse.at(-1).zustand, 'fertig');
  assert.ok(sse.every((x, i) => i === 0 || x.prozent >= sse[i - 1].prozent), 'the progress never goes back');
  await z.s.umkehr('undo', { rev: z.projekt().rev }, 'andreas');
  assert.equal(z.clip().audio_noten, undefined, 'one undo takes it all back');
  assert.deepEqual(z.projekt().spuren.map((s) => s.id), vorher.spuren.map((s) => s.id));
});

test('children run as nice -n 19 with OMP_NUM_THREADS=1 (own detector) and 2 (network)', async (t) => {
  const z = await mitNoten(t);
  assert.equal((await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' })).code, 200);
  assert.equal((await z.ende()).zustand, 'fertig');
  const eigene = z.lies(z.prot);
  assert.ok(eigene.length >= 2);
  for (const x of eigene) { assert.equal(x.omp, '1'); assert.equal(x.nice, 19); }
  const netz = z.lies(z.netzProt);
  assert.ok(netz.length >= 2, '--pruefen and the curve');
  for (const x of netz) assert.equal(x.omp, '2');
});

test('a second detection reuses the sidecar: no analysis call in the protocol', async (t) => {
  const z = await mitNoten(t, { netz: null });
  await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  assert.equal((await z.ende()).zustand, 'fertig');
  assert.deepEqual(z.aufrufe(), ['analyse', 'pruefe']);
  const erste = fs.readFileSync(path.join(z.notenOrdner, kurveDatei(SHA, CURVE_ID)), 'utf8');
  const a = await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1', neu: true });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const e = await warteBis(() => z.stand().auftrag_id === a.j.auftrag_id && z.stand().zustand !== 'laeuft', 20000);
  assert.ok(e, JSON.stringify(z.stand()));
  assert.equal(z.stand().zustand, 'fertig');
  assert.deepEqual(z.aufrufe(), ['analyse', 'pruefe'], 'no new call: the sidecar was used');
  assert.equal(fs.readFileSync(path.join(z.notenOrdner, kurveDatei(SHA, CURVE_ID)), 'utf8'), erste);
});

test('no notes found: fertig with an empty list placed and the hint keine_noten', async (t) => {
  const z = await mitNoten(t, { fall: 'leer', netz: null });
  await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  const e = await z.ende();
  assert.equal(e.zustand, 'fertig', JSON.stringify(e));
  assert.equal(e.noten, 0);
  assert.equal(e.hinweis, 'keine_noten');
  assert.deepEqual(z.clip().audio_noten, { kurve: CURVE_ID, liste: [] });
  // an empty list is no notes: a new detection needs no neu
  const noch = await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  assert.equal(noch.code, 200, JSON.stringify(noch.j));
  await warteBis(() => z.stand().auftrag_id === noch.j.auftrag_id && z.stand().zustand !== 'laeuft', 20000);
});

test('polyphonic: fehler noten_mehrstimmig with the spec text, nothing placed', async (t) => {
  const z = await mitNoten(t, { fall: 'mehrstimmig', netz: null });
  const rev0 = z.projekt().rev;
  await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  const e = await z.ende();
  assert.deepEqual([e.zustand, e.grund], ['fehler', 'noten_mehrstimmig']);
  assert.equal(e.text, 'More than one note at a time. Separate stems first, then detect notes on a stem.');
  assert.equal(z.clip().audio_noten, undefined);
  assert.equal(z.projekt().rev, rev0);
  assert.deepEqual(z.temps(), []);
});

test('network path: runtime ok and a voice pitch -> the network sidecar, detektor netz', async (t) => {
  const z = await mitNoten(t);
  await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  const e = await z.ende();
  assert.equal(e.zustand, 'fertig', JSON.stringify(e));
  assert.equal(e.detektor, 'netz');
  assert.equal(e.hinweis, undefined);
  assert.match(z.clip().audio_noten.kurve, /^netz-\d+\.noten_hmm-1$/);
  assert.deepEqual(z.aufrufe(), ['analyse', 'pruefe', 'segment', 'pruefe']);
  assert.ok(fs.existsSync(path.join(z.notenOrdner, kurveDatei(SHA, z.clip().audio_noten.kurve))));
  assert.ok(fs.existsSync(path.join(z.notenOrdner, kurveDatei(SHA, CURVE_ID))), 'the own curve stays as the cache');
  assert.deepEqual(z.temps(), []);
});

test('network path: the network crashes -> the own result with the hint netz_fehler, the project changed once', async (t) => {
  const z = await mitNoten(t, { env: { NETZ_ATTRAPPE_FALL: 'absturz' } });
  await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  const e = await z.ende();
  assert.equal(e.zustand, 'fertig', JSON.stringify(e));
  assert.equal(e.detektor, 'pyin');
  assert.equal(e.hinweis, 'netz_fehler');
  assert.equal(z.clip().audio_noten.kurve, CURVE_ID);
  assert.equal(z.protokoll.uebernommen.filter((u) => u.label.startsWith('Detect notes')).length, 1);
});

test('network path: no runtime (--pruefen fails) -> the own detector, no hint; asked once per server life', async (t) => {
  const z = await mitNoten(t, { env: { NETZ_ATTRAPPE_FALL: 'fehlt' } });
  await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  const e = await z.ende();
  assert.deepEqual([e.zustand, e.detektor, e.hinweis], ['fertig', 'pyin', undefined]);
  await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1', neu: true });
  await warteBis(() => z.stand().zustand === 'laeuft', 2000);
  await z.ende();
  assert.equal(z.lies(z.netzProt).length, 1, 'one --pruefen, then remembered');
});

test('network path: bass below 60 Hz (P5) -> the network is never called', async (t) => {
  const z = await mitNoten(t, { env: { NOTEN_ATTRAPPE_TIEF: '1' } });
  await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  const e = await z.ende();
  assert.deepEqual([e.zustand, e.detektor], ['fertig', 'pyin'], JSON.stringify(e));
  assert.deepEqual(z.lies(z.netzProt), [], 'the network program was not started at all');
});

test('network path: CYPHERDJ_NOTEN_NETZ=aus switches it off', async (t) => {
  const z = await mitNoten(t, { env: { CYPHERDJ_NOTEN_NETZ: 'aus' } });
  await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  assert.equal((await z.ende()).detektor, 'pyin');
  assert.deepEqual(z.lies(z.netzProt), []);
});

test('a note that ends beyond the source: fehler noten_fehler, nothing placed, temp folder gone', async (t) => {
  const z = await mitNoten(t, { fall: 'ueber_ende', netz: null });
  await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  const e = await z.ende();
  assert.deepEqual([e.zustand, e.grund], ['fehler', 'noten_fehler']);
  assert.equal(z.clip().audio_noten, undefined);
  assert.deepEqual(z.temps(), []);
});

test('the program fails or answers nothing: fehler noten_fehler with the detail', async (t) => {
  for (const fall of ['fehler', 'kaputt']) {
    const z = await mitNoten(t, { fall, netz: null });
    await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
    const e = await z.ende();
    assert.deepEqual([e.zustand, e.grund], ['fehler', 'noten_fehler'], fall);
    assert.match(e.detail, /the analysis failed/, fall);
    assert.equal(z.clip().audio_noten, undefined, fall);
  }
});

test('refusals: noten_laeuft, stems_laeuft, noten_vorhanden (neu replaces), feld_nur_audio, audio_fehlt, noten_programm_fehlt 503, clip_unbekannt, arguments', async (t) => {
  const stems = { laeuft: false };
  const z = await mitNoten(t, { fall: 'langsam', netz: null, stems });
  const grund = async (koerper) => { const x = await z.ruf('POST', '/proj/noten/erkennen', koerper); return [x.code, x.j.fehler]; };
  stems.laeuft = true;
  assert.deepEqual(await grund({ clip_id: 'c1' }), [409, 'stems_laeuft']);
  stems.laeuft = false;
  assert.deepEqual(await grund({ clip_id: 'c2' }), [409, 'feld_nur_audio']);
  assert.deepEqual(await grund({ clip_id: 'c9' }), [404, 'clip_unbekannt']);
  assert.deepEqual(await grund({}), [400, 'argument_ungueltig']);
  assert.deepEqual(await grund({ clip_id: 'c1', neu: 'ja' }), [400, 'argument_ungueltig']);
  assert.deepEqual(await grund({ clip_id: 'c1', x: 1 }), [400, 'argument_unbekannt']);
  const a = await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  assert.equal(a.code, 200);
  const zwei = await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  assert.deepEqual([zwei.code, zwei.j.fehler, zwei.j.auftrag_id], [409, 'noten_laeuft', a.j.auftrag_id]);
  assert.equal(zwei.j.text, 'a note detection is already running');
  await z.ruf('POST', '/proj/noten/abbrechen', { auftrag_id: a.j.auftrag_id });
  assert.equal((await z.ende()).zustand, 'abgebrochen');
  // notes there already
  const y = await mitNoten(t, { netz: null });
  await y.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  assert.equal((await y.ende()).zustand, 'fertig');
  const vorh = await y.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  assert.deepEqual([vorh.code, vorh.j.fehler], [409, 'noten_vorhanden']);
  const neu = await y.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1', neu: true });
  assert.equal(neu.code, 200, JSON.stringify(neu.j));
  await warteBis(() => y.stand().auftrag_id === neu.j.auftrag_id && y.stand().zustand !== 'laeuft', 20000);
  assert.equal(y.stand().zustand, 'fertig');
  // the decoded source is gone
  const x = await mitNoten(t, { netz: null });
  fs.rmSync(path.join(x.arbeitsordner, 'audio', `${SHA}.f32`));
  const x1 = await x.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  assert.deepEqual([x1.code, x1.j.fehler], [409, 'audio_fehlt']);
  // the program is missing (a path that does not exist)
  const w = await mitNoten(t, { netz: null, programm: path.join(x.tmp, 'gibt-es-nicht') });
  const w1 = await w.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  assert.deepEqual([w1.code, w1.j.fehler], [503, 'noten_programm_fehlt']);
  assert.match(w1.j.text, /^[A-Za-z]/);
});

test('Stop Cypher: a run of Cypher is refused at the start and discarded at the end (veraltet ki_gestoppt); Andreas is not stopped; Andreas\' track is his', async (t) => {
  const z = await mitNoten(t, { env: { NOTEN_ATTRAPPE_SCHLAF_MS: '600' }, netz: null });
  z.zustand.quelle = 'cypher';
  const fremd = await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  assert.deepEqual([fremd.code, fremd.j.fehler], [409, 'nur_andreas_spur']);
  assert.equal(fremd.j.text, 'this track belongs to Andreas; Cypher may not detect notes on it');
  await z.aendern([{ befehl: 'spur_neu', art: 'audio', name: 'Cy' }], 'Cy', 'cypher');
  const cy = z.projekt().spuren.at(-1).id;
  await z.aendern([{ befehl: 'clip_neu', spur_id: cy, art: 'audio', start_beat: 0, laenge_beats: 1, sha256: SHA }], 'Cy-Clip', 'cypher');
  assert.ok(await warteBis(() => z.projekt().spuren.at(-1).clips[0].dekodiert === 'fertig', 10000));
  const cid = z.projekt().spuren.at(-1).clips[0].id;
  z.zustand.ki = true;
  const nein = await z.ruf('POST', '/proj/noten/erkennen', { clip_id: cid });
  assert.deepEqual([nein.code, nein.j.fehler], [409, 'ki_gestoppt']);
  z.zustand.ki = false;
  const a = await z.ruf('POST', '/proj/noten/erkennen', { clip_id: cid });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  z.zustand.ki = true;                                                            // set during the run
  const e = await z.ende();
  assert.deepEqual([e.zustand, e.grund], ['veraltet', 'ki_gestoppt'], JSON.stringify(e));
  assert.equal(z.projekt().spuren.at(-1).clips[0].audio_noten, undefined);
  assert.deepEqual(z.temps(), []);
  z.zustand.quelle = 'andreas';
  const hand = await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  assert.equal(hand.code, 200, 'negative control: Stop Cypher does not stop Andreas');
  assert.equal((await z.ende()).zustand, 'fertig');
});

test('abort during a slow run: abgebrochen, temp folder gone, no project change; an unknown id: kein_auftrag', async (t) => {
  const z = await mitNoten(t, { fall: 'langsam', netz: null });
  const rev0 = z.projekt().rev;
  const a = await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  assert.ok(await warteBis(() => z.temps().length === 1, 2000), 'the folder of the run exists');
  const falsch = await z.ruf('POST', '/proj/noten/abbrechen', { auftrag_id: a.j.auftrag_id + 99 });
  assert.deepEqual([falsch.code, falsch.j.fehler], [404, 'kein_auftrag']);
  assert.equal(falsch.j.text, 'no note detection with this id is running');
  const ab = await z.ruf('POST', '/proj/noten/abbrechen', { auftrag_id: a.j.auftrag_id });
  assert.equal(ab.code, 200, JSON.stringify(ab.j));
  const e = await z.ende();
  assert.deepEqual([e.zustand, e.grund], ['abgebrochen', 'abbruch']);
  assert.deepEqual(z.temps(), []);
  assert.equal(z.projekt().rev, rev0);
  assert.equal(z.clip().audio_noten, undefined);
  assert.equal(z.an.laeuft(), false);
  const nochmal = await z.ruf('POST', '/proj/noten/abbrechen', { auftrag_id: a.j.auftrag_id });
  assert.deepEqual([nochmal.code, nochmal.j.fehler], [404, 'kein_auftrag'], 'no run any more');
});

test('a child that ignores SIGTERM is killed after killMs', async (t) => {
  const z = await mitNoten(t, { fall: 'taub', netz: null, killMs: 300 });
  const a = await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  await warteBis(() => z.lies(z.prot).length > 0, 3000);
  const t0 = Date.now();
  await z.ruf('POST', '/proj/noten/abbrechen', { auftrag_id: a.j.auftrag_id });
  const e = await z.ende(10000);
  assert.equal(e.zustand, 'abgebrochen');
  assert.ok(Date.now() - t0 < 5000);
  assert.deepEqual(z.temps(), []);
});

test('the time limit cancels the run: abgebrochen noten_zeitlimit', async (t) => {
  const z = await mitNoten(t, { fall: 'langsam', netz: null, zeitlimitMs: 300 });
  await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  const e = await z.ende(10000);
  assert.deepEqual([e.zustand, e.grund], ['abgebrochen', 'noten_zeitlimit'], JSON.stringify(e));
  assert.match(e.text, /too long/);
  assert.equal(z.clip().audio_noten, undefined);
});

test('the clip changed during the run: veraltet, nothing placed', async (t) => {
  const z = await mitNoten(t, { env: { NOTEN_ATTRAPPE_SCHLAF_MS: '800' }, netz: null });
  await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  await warteBis(() => z.lies(z.prot).length > 0, 3000);
  await z.vorbei([{ befehl: 'clip_loeschen', clip_id: 'c1' }], 'Hand');
  const e = await z.ende();
  assert.deepEqual([e.zustand, e.grund], ['veraltet', 'veraltet'], JSON.stringify(e));
  assert.equal(z.projekt().spuren[0].clips.length, 0, 'the clip is gone');
  assert.deepEqual(z.temps(), []);
});

test('the project was closed during the run: the run is aborted, nothing is placed', async (t) => {
  const z = await mitNoten(t, { fall: 'langsam', netz: null });
  await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  await warteBis(() => z.lies(z.prot).length > 0, 3000);
  await z.s.neu('Zweiter Track', 'andreas');                                      // switching the project closes the first one
  assert.ok(await warteBis(() => !z.an.laeuft(), 10000), 'the run is over');
  const letzte = z.protokoll.verteilt.filter((x) => x.a === 'proj' && x.f?.noten).at(-1).f.noten;
  assert.equal(letzte.zustand, 'abgebrochen', JSON.stringify(letzte));
  assert.deepEqual(z.temps(), []);
  assert.equal(z.s.aktuell().j.noten, undefined, 'the state of the first project is not shown in the second');
});

test('the server stop (schliesse) kills the child at once and removes the temp folder', async (t) => {
  const z = await mitNoten(t, { fall: 'langsam', netz: null });
  await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  await warteBis(() => z.lies(z.prot).length > 0, 3000);
  z.an.schliesse();
  assert.ok(await warteBis(() => !z.an.laeuft(), 5000), 'the run is over');
  assert.deepEqual(z.temps(), []);
});

test('startup cleanup: folders noten-<n> are removed, a process with a path inside one gets SIGKILL, the sidecars stay', async (t) => {
  const z = await mitNoten(t, { netz: null });
  const ord = z.arbeitsordner;
  fs.mkdirSync(path.join(ord, 'noten-7'), { recursive: true });
  fs.writeFileSync(path.join(ord, 'noten-7', 'eigen.json'), '{}');
  fs.mkdirSync(path.join(ord, 'noten-9'), { recursive: true });
  fs.mkdirSync(z.notenOrdner, { recursive: true });
  fs.writeFileSync(path.join(z.notenOrdner, 'cache.json'), '{}');
  fs.mkdirSync(path.join(ord, 'notenbuch'), { recursive: true });
  const kind = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', path.join(ord, 'noten-9', 'x.f32')], { stdio: 'ignore' });
  t.after(() => { try { kind.kill('SIGKILL'); } catch { /* gone */ } });
  const beendet = new Promise((ok) => kind.on('close', (rc, sig) => ok(sig)));
  await warteBis(() => { try { return fs.readFileSync(`/proc/${kind.pid}/cmdline`, 'utf8').includes('noten-9'); } catch { return false; } }, 3000);
  const log = [];
  const r = raeumeNotenReste(ord, (x) => log.push(x));
  assert.deepEqual(r.ordner.sort(), ['noten-7', 'noten-9']);
  assert.deepEqual(r.prozesse, [kind.pid]);
  assert.equal(await beendet, 'SIGKILL');
  assert.deepEqual(fs.readdirSync(ord).filter((f) => f.startsWith('noten')).sort(), ['noten', 'notenbuch'], 'only noten-<n> goes');
  assert.ok(fs.existsSync(path.join(z.notenOrdner, 'cache.json')));
  assert.equal(log[0].typ, 'noten_reste');
  // the area does it at its start, too
  fs.mkdirSync(path.join(ord, 'noten-3'));
  notenBereich(z.ctx, z.zugang, { programm: ATTRAPPE, netz: null, cwd: z.tmp });
  assert.deepEqual(z.temps(), []);
});

test('routes: the four routes in this order, protection, GET /proj/noten and /proj/noten/kurve', async (t) => {
  const z = await mitNoten(t, { netz: null });
  assert.equal(z.b.name, 'proj-noten');
  assert.deepEqual(z.b.routen().map((r) => `${r.methode} ${r.pfad} ${r.schutz}`), [
    'POST /proj/noten/erkennen fremdePost', 'POST /proj/noten/abbrechen fremdePost', 'GET /proj/noten offen', 'GET /proj/noten/kurve offen']);
  const ohne = await z.ruf('GET', '/proj/noten', null, '?clip_id=c1');
  assert.equal(ohne.code, 200, JSON.stringify(ohne.j));
  assert.deepEqual(ohne.j, { clip_id: 'c1', quelle_sha: SHA, kurve: null, noten: null, analyse: null, render: null });
  const keine = await z.ruf('GET', '/proj/noten/kurve', null, '?clip_id=c1');
  assert.equal(keine.code, 404);
  assert.deepEqual([(await z.ruf('GET', '/proj/noten', null, '')).j.fehler], ['argument_ungueltig']);
  assert.deepEqual([(await z.ruf('GET', '/proj/noten', null, '?clip_id=c9')).code], [404]);
  assert.deepEqual([(await z.ruf('GET', '/proj/noten', null, '?clip_id=c2')).j.fehler], ['feld_nur_audio']);
  await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  const e = await z.ende();
  assert.equal(e.zustand, 'fertig');
  const g = await z.ruf('GET', '/proj/noten', null, '?clip_id=c1');
  assert.equal(g.code, 200, JSON.stringify(g.j));
  assert.deepEqual(Object.keys(g.j).sort(), ['analyse', 'clip_id', 'kurve', 'noten', 'quelle_sha', 'render']);
  assert.deepEqual(Object.keys(g.j.kurve).sort(), ['detektor', 'id', 'mono', 'stimmhaft_anteil']);
  assert.equal(g.j.kurve.id, CURVE_ID);
  assert.equal(g.j.kurve.mono.mehrstimmig, false);
  assert.equal(g.j.noten.length, 3);
  assert.equal(g.j.analyse.zustand, 'fertig');
  assert.equal(g.j.render, null);
  const k = await z.ruf('GET', '/proj/noten/kurve', null, '?clip_id=c1');
  assert.equal(k.code, 200, JSON.stringify(k.j).slice(0, 200));
  assert.deepEqual(Object.keys(k.j).sort(), ['ct', 'hop_s', 'kurve']);
  assert.equal(k.j.hop_s, 256 / 48000);
  assert.equal(k.j.ct.length, Math.floor(24000 / 256) + 1);
  assert.ok(k.j.ct.every((v) => v === 0 || (v >= 1500 && v <= 11000)));
  assert.equal(JSON.stringify(k.j).includes('NaN'), false);
});

test('little pitched sound: fertig with the hint wenig_stimmhaft, the notes are placed as usual', async (t) => {
  const z = await mitNoten(t, { fall: 'wenig', netz: null });
  await z.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  const e = await z.ende();
  assert.equal(e.zustand, 'fertig', JSON.stringify(e));
  assert.equal(e.noten, 3);
  assert.equal(e.hinweis, 'wenig_stimmhaft');
  assert.equal(e.text, 'Little pitched sound found. If this is a full mix, separate stems first and detect notes on the vocal stem.');
  assert.equal(z.clip().audio_noten.liste.length, 3, 'a hint, not a refusal');
  // the normal case carries no hint
  const y = await mitNoten(t, { netz: null });
  await y.ruf('POST', '/proj/noten/erkennen', { clip_id: 'c1' });
  assert.equal((await y.ende()).hinweis, undefined);
});

test('notenMass: mass only for notes with a target; ms to 0.1, stretch to 1e-3, cents to 0.1; the input stays', () => {
  const liste = [
    { id: 't1', qa: 1, qe: 2, qton: 60, p: 0.5 },
    { id: 't2', qa: 2, qe: 3, qton: 62, p: 0.5, a: 2.05, e: 3.5, ton: 62.333 },
    { id: 't3', qa: 4, qe: 5, qton: 64.1, p: 0.5, ton: 65.1 },
  ];
  const kopie = structuredClone(liste);
  const m = notenMass(liste);
  assert.deepEqual(liste, kopie);
  assert.equal(m[0].mass, undefined);
  assert.deepEqual(m[1].mass, { a_ms: 50, e_ms: 500, laenge_ms: 1450, dehnung: 1.45, ton_ct: 33.3 });
  assert.deepEqual(m[2].mass, { a_ms: 0, e_ms: 0, laenge_ms: 1000, dehnung: 1, ton_ct: 100 });
});
