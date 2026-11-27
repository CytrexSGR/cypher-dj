// Note editor (slice 1, B4): the render service (areas/proj/notes_render.ts) on the real project session of the S3 set-up, with the stand-in
// notes_mock.mjs as cypherdj-noten. Detection runs through B2's area (the stand-in places three notes), edits through the real commands,
// the live playback is the real translation (wiedergabe files in the temp folder). No server, no core, no sound; everything in a temp folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn as echtSpawn } from 'node:child_process';
import { aufbau } from './support/output_setup.mjs';
import { warteBis } from './support/proj_context.mjs';
import { notenBereich, CURVE_ID } from '../areas/proj/notes.ts';
import { NotenRender } from '../areas/proj/notes_render.ts';
import { alsAntwort } from '../areas/proj/output.ts';
import { kurveDatei, MASCHINE_VERSION, NOTEN_SR, renderSchluessel } from '../project/notes_contract.ts';

const ATTRAPPE = path.join(import.meta.dirname, 'support', 'notes_mock.mjs');
const SHA = 'a'.repeat(64);

async function mitRender(t, { programm = ATTRAPPE, env = {}, opt = {} } = {}) {
  const z = await aufbau(t);
  const prot = path.join(z.tmp, 'noten.jsonl');
  const steuer = { NOTEN_ATTRAPPE_FALL: 'ok', NOTEN_ATTRAPPE_PROTOKOLL: prot, ...env };   // read at every spawn: a test changes it on the way
  const b = notenBereich(z.ctx, z.zugang, { programm: ATTRAPPE, netz: null, cwd: z.tmp, killMs: 400, env: steuer });
  const neu = { n: 0 };
  const nr = new NotenRender(z.ctx, z.zugang, { programm, netz: null, cwd: z.tmp, env: steuer, killMs: 400,
    neuLaden: () => { neu.n++; return z.s.ladeLiveNeuFrei(); }, ...opt });
  z.s.setzeNotenRender(nr);
  z.zugang.beiStand((p) => nr.beiStand(p));
  await nr.start();
  await z.s.ladeLiveNeuFrei();                                                   // opening a project loads the live playback: the service learns what its clips were given
  t.after(() => { nr.schliesse(); b.analyse.schliesse(); });
  const clip = (id = 'c1') => z.projekt().spuren[0].clips.find((c) => c.id === id);
  const notenOrdner = path.join(z.arbeitsordner, 'noten');
  const quelle = path.join(z.arbeitsordner, 'audio', `${SHA}.f32`);
  const erkenne = async (id = 'c1') => {
    const a = b.analyse.starte({ clip_id: id }, 'andreas');
    assert.equal(a.code, 200, JSON.stringify(a.j));
    assert.ok(await warteBis(() => { const s = z.s.aktuell().j.noten; return s && s.auftrag_id === a.j.auftrag_id && s.zustand !== 'laeuft'; }, 20000));
    assert.equal(z.s.aktuell().j.noten.zustand, 'fertig', JSON.stringify(z.s.aktuell().j.noten));
  };
  const aendere = (befehle, label = 'Edit') => z.aendern(befehle, label);
  const ton = (id, ids, um) => aendere([{ befehl: 'audio_noten_aendern', clip_id: id, ids, ton_um: um }]);
  const lies = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((x) => JSON.parse(x)) : []);
  const aufrufe = (befehl) => lies(prot).filter((x) => x.befehl === befehl);
  const schluessel = (id = 'c1') => { const c = clip(id); return renderSchluessel(SHA, c.audio_noten.kurve, MASCHINE_VERSION, c.audio_noten.liste); };
  const renderDatei = (key) => path.join(notenOrdner, `${key}.f32`);
  // true when the last playback the core was given names this file
  const spieltDatei = (datei) => {
    try { return JSON.stringify(z.wiedergabe(z.projekt().wiedergabe_rev)).includes(datei) && z.zustand.kernNr === z.projekt().wiedergabe_rev; } catch { return false; }
  };
  const floats = (f) => { const bu = fs.readFileSync(f); const x = new Float32Array(bu.length / 4); for (let i = 0; i < x.length; i++) x[i] = bu.readFloatLE(i * 4); return x; };
  // the sample ranges of the notes whose sound differs from the source, and a check that they are the halved source and nothing else is touched
  const inhalt = (key, halbe) => {
    const r = floats(renderDatei(key)), q = floats(quelle), liste = clip().audio_noten.liste;
    const frames = q.length / 2;
    const ist = new Set();
    for (const n of liste) {
      const s0 = Math.min(frames, Math.floor(n.qa * NOTEN_SR)), s1 = Math.min(frames, Math.floor(n.qe * NOTEN_SR));
      for (let s = s0 * 2; s < s1 * 2; s++) if (halbe.includes(n.id) ? Math.abs(r[s] - q[s] / 2) > 1e-7 : r[s] !== q[s]) ist.add(n.id);
    }
    let draussen = 0;
    const innen = liste.map((n) => [Math.floor(n.qa * NOTEN_SR) * 2, Math.min(frames, Math.floor(n.qe * NOTEN_SR)) * 2]);
    for (let s = 0; s < r.length; s++) if (!innen.some(([a, e]) => s >= a && s < e) && r[s] !== q[s]) draussen++;
    return { falsch: [...ist], draussen, laenge: r.length === q.length };
  };
  return { ...z, b, nr, neu, clip, notenOrdner, quelle, erkenne, aendere, ton, aufrufe, schluessel, renderDatei, spieltDatei, inhalt, steuer, prot, lies };
}

test('an edit renders once; the second translation finds the exact file; neuLaden called once', async (t) => {
  const z = await mitRender(t);
  await z.erkenne();
  assert.equal(z.nr.datei(z.clip()), null, 'no target: the source');
  assert.equal(z.nr.zustand('c1').zustand, 'quelle');
  await z.ton('c1', ['t2'], 2);
  const key = z.schluessel();
  assert.equal(z.nr.zustand('c1').zustand, 'rechnet', 'queued at the stand');
  assert.equal(z.nr.datei(z.clip()), null, 'while it renders the clip plays the source');
  assert.ok(await z.nr.bereit(10000));
  assert.ok(await warteBis(() => z.neu.n === 1, 5000), 'one reload');
  assert.deepEqual(z.nr.zustand('c1'), { zustand: 'bereit', schluessel: key, sekunden: z.nr.zustand('c1').sekunden });
  assert.ok(fs.existsSync(path.join(z.notenOrdner, `${key}.f32`)));
  const eintrag = JSON.parse(fs.readFileSync(path.join(z.notenOrdner, `${key}.json`), 'utf8'));
  assert.deepEqual([eintrag.schluessel, eintrag.slug === z.offen().slug, eintrag.clip_id, eintrag.quelle, eintrag.kurve, eintrag.maschine],
    [key, true, 'c1', SHA, CURVE_ID, MASCHINE_VERSION]);
  assert.deepEqual(eintrag.liste, z.clip().audio_noten.liste);
  assert.equal(eintrag.bytes, fs.statSync(path.join(z.notenOrdner, `${key}.f32`)).size);
  const d1 = z.nr.datei(z.clip()), d2 = z.nr.datei(z.clip());
  assert.deepEqual(d1, { sha256: key, datei: path.join(z.notenOrdner, `${key}.f32`) });
  assert.deepEqual(d2, d1);
  assert.equal(z.aufrufe('render').length, 1, 'the second translation started no job');
  assert.equal(z.neu.n, 1);
  assert.ok(await warteBis(() => z.spieltDatei(d1.datei), 5000), 'the live playback names the render file');
  assert.deepEqual(z.inhalt(key, ['t2']), { falsch: [], draussen: 0, laenge: true }, 'only the edited note differs from the source');
  const sse = z.protokoll.verteilt.filter((x) => x.a === 'proj' && x.f?.noten_render).map((x) => x.f.noten_render);
  assert.deepEqual(sse.map((x) => x.zustand), ['rechnet', 'bereit']);
  assert.ok(sse.every((x) => x.clip_id === 'c1' && x.slug === z.offen().slug));
});

test('two clips of one source with different lists: one sidecar, two keys, two files, no cross-talk', async (t) => {
  const z = await mitRender(t);
  await z.aendern([{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 1, sha256: SHA }], 'Second clip');
  const zweiter = z.projekt().spuren[0].clips.find((c) => c.id !== 'c1').id;
  assert.ok(await warteBis(() => z.clip(zweiter).dekodiert === 'fertig', 10000));
  await z.erkenne('c1'); await z.erkenne(zweiter);
  assert.equal(z.aufrufe('analyse').length, 1, 'one analysis for the one source');
  await z.ton('c1', ['t1'], 1);
  assert.ok(await z.nr.bereit(10000));
  const k1 = z.schluessel('c1');
  const d1 = fs.readFileSync(z.renderDatei(k1));
  await z.ton(zweiter, ['t3'], -2);
  assert.ok(await z.nr.bereit(10000));
  const k2 = z.schluessel(zweiter);
  assert.notEqual(k1, k2);
  assert.equal(z.schluessel('c1'), k1, 'editing one clip never changes the key of the other');
  assert.deepEqual(fs.readFileSync(z.renderDatei(k1)), d1, 'nor its file');
  assert.equal(fs.readdirSync(z.notenOrdner).filter((f) => f.endsWith('.json') && f.startsWith(`${SHA}.`)).length, 1, 'one sidecar');
  assert.deepEqual(fs.readdirSync(z.notenOrdner).filter((f) => f.endsWith('.f32')).sort(), [`${k1}.f32`, `${k2}.f32`].sort());
  assert.equal(z.aufrufe('render').length, 2);
  assert.deepEqual([z.nr.datei(z.clip('c1')).sha256, z.nr.datei(z.clip(zweiter)).sha256], [k1, k2]);
  assert.equal(z.aufrufe('analyse').length, 1, 'no second analysis for the render either');
});

test('a fast second edit of the same clip replaces the queued job; while rendering the clip plays the last finished render (state alt)', async (t) => {
  const z = await mitRender(t);
  await z.erkenne();
  await z.ton('c1', ['t2'], 2);                        // A
  assert.ok(await z.nr.bereit(10000));
  const a = z.schluessel();
  z.steuer.NOTEN_ATTRAPPE_SCHLAF_MS = '700';
  await z.ton('c1', ['t2'], 1);                        // B: running at once
  const b = z.schluessel();
  await z.ton('c1', ['t2'], 3);                        // C: queued
  const c = z.schluessel();
  await z.ton('c1', ['t2'], 4);                        // D: replaces C
  const d = z.schluessel();
  assert.equal(new Set([a, b, c, d]).size, 4);
  assert.equal(z.nr.zustand('c1').zustand, 'alt');
  assert.deepEqual(z.nr.datei(z.clip()), { sha256: a, datei: z.renderDatei(a) }, 'the last finished render');
  z.steuer.NOTEN_ATTRAPPE_SCHLAF_MS = '0';
  assert.ok(await z.nr.bereit(15000));
  assert.ok(fs.existsSync(z.renderDatei(b)) && fs.existsSync(z.renderDatei(d)));
  assert.equal(fs.existsSync(z.renderDatei(c)), false, 'the replaced job never ran');
  assert.equal(z.aufrufe('render').length, 3, 'A, B, D');
  assert.deepEqual(z.nr.datei(z.clip()), { sha256: d, datei: z.renderDatei(d) });
  assert.ok(await warteBis(() => z.spieltDatei(z.renderDatei(d)), 5000));
});

test('the second render of a clip passes --vorher and --nur with the changed ids (protocol of the stand-in)', async (t) => {
  const z = await mitRender(t);
  await z.erkenne();
  await z.ton('c1', ['t2'], 2);
  assert.ok(await z.nr.bereit(10000));
  const a = z.schluessel();
  let r = z.aufrufe('render');
  assert.equal(r.length, 1);
  assert.equal(r[0].argv.includes('--vorher'), false, 'the first render is a full one');
  await z.ton('c1', ['t3'], -1);
  assert.ok(await z.nr.bereit(10000));
  const b = z.schluessel();
  r = z.aufrufe('render');
  assert.equal(r.length, 2);
  const arg = (x, n) => x.argv[x.argv.indexOf(n) + 1];
  assert.equal(arg(r[1], '--vorher'), z.renderDatei(a));
  assert.equal(arg(r[1], '--nur'), 't3');
  assert.deepEqual(z.inhalt(b, ['t2', 't3']), { falsch: [], draussen: 0, laenge: true });
  // a reset of t2: the engine recomputes t2 from the source
  await aendereReset(z, ['t2']);
  assert.ok(await z.nr.bereit(10000));
  const c = z.schluessel();
  r = z.aufrufe('render');
  assert.equal(r.length, 3);
  assert.equal(arg(r[2], '--vorher'), z.renderDatei(b));
  assert.equal(arg(r[2], '--nur'), 't2');
  assert.deepEqual(z.inhalt(c, ['t3']), { falsch: [], draussen: 0, laenge: true }, 't2 is the source again');
  assert.ok(r.every((x) => x.omp === '1' && x.nice === 19), 'OMP_NUM_THREADS=1 and nice 19');
});
const aendereReset = (z, ids) => z.aendere([{ befehl: 'audio_noten_zuruecksetzen', clip_id: 'c1', ids }], 'Reset');

test('undo of the detection while a render runs: no neuLaden, state quelle, file kept', async (t) => {
  const z = await mitRender(t);
  await z.erkenne();
  z.steuer.NOTEN_ATTRAPPE_SCHLAF_MS = '600';
  await z.ton('c1', ['t2'], 2);
  const key = z.schluessel();
  assert.equal(z.nr.zustand('c1').zustand, 'rechnet');
  await z.s.umkehr('undo', { rev: z.projekt().rev }, 'andreas');          // the edit
  await z.s.umkehr('undo', { rev: z.projekt().rev }, 'andreas');          // the detection
  assert.equal(z.clip().audio_noten, undefined);
  assert.equal(z.nr.zustand('c1').zustand, 'quelle');
  assert.equal(z.nr.datei(z.clip()), null);
  assert.ok(await z.nr.bereit(10000), 'the running job ends');
  assert.ok(fs.existsSync(z.renderDatei(key)), 'the render finished into the cache');
  assert.equal(z.neu.n, 0, 'nothing to reload');
  assert.equal(z.nr.zustand('c1').zustand, 'quelle');
});

test('cache folder deleted: datei() -> null, sidecar and render recomputed, then the exact file', async (t) => {
  const z = await mitRender(t);
  await z.erkenne();
  await z.ton('c1', ['t2'], 2);
  assert.ok(await z.nr.bereit(10000));
  const key = z.schluessel();
  assert.ok(await warteBis(() => z.neu.n === 1 && z.spieltDatei(z.renderDatei(key)), 5000));
  fs.rmSync(z.notenOrdner, { recursive: true, force: true });
  assert.equal(z.nr.datei(z.clip()), null, 'the clip plays the source at the next translation');
  assert.ok(await z.nr.bereit(10000));
  assert.equal(z.aufrufe('analyse').length, 2, 'the sidecar was computed again');
  assert.ok(fs.existsSync(path.join(z.notenOrdner, kurveDatei(SHA, CURVE_ID))));
  assert.deepEqual(z.nr.datei(z.clip()), { sha256: key, datei: z.renderDatei(key) });
  assert.ok(await warteBis(() => z.neu.n === 2, 5000), 'reloaded when the render was back');
  assert.ok(await warteBis(() => z.spieltDatei(z.renderDatei(key)), 5000));
  assert.deepEqual(z.protokoll.log.filter((x) => /noten_render/.test(x.typ ?? '') && /fehler/.test(x.typ)), [], 'no error');
});

test('restored version (beiStand with an older stand): its key is rendered when missing', async (t) => {
  const z = await mitRender(t);
  await z.erkenne();
  await z.ton('c1', ['t2'], 2);
  assert.ok(await z.nr.bereit(10000));
  const key = z.schluessel();
  const v = await z.s.versionSichern('with edit', 'andreas');
  await aendereReset(z, undefined);
  assert.equal(z.nr.zustand('c1').zustand, 'quelle');
  for (const f of fs.readdirSync(z.notenOrdner).filter((x) => x.startsWith(key))) fs.rmSync(path.join(z.notenOrdner, f));   // the render is gone
  const vorher = z.aufrufe('render').length;
  await z.s.versionZurueck(v.id, 'andreas');
  assert.equal(z.schluessel(), key, 'the keys are recomputed on the restored stand');
  assert.ok(await z.nr.bereit(10000));
  assert.equal(z.aufrufe('render').length, vorher + 1);
  assert.ok(fs.existsSync(z.renderDatei(key)));
  assert.ok(await warteBis(() => z.spieltDatei(z.renderDatei(key)), 8000), 'the clip plays the edit when the render is done');
});

test('reset all after a render: reload without a job; undo of the reset: reload with the cached file, no job', async (t) => {
  const z = await mitRender(t);
  await z.erkenne();
  await z.ton('c1', ['t2'], 2);
  assert.ok(await z.nr.bereit(10000));
  const key = z.schluessel();
  assert.ok(await warteBis(() => z.neu.n === 1 && z.spieltDatei(z.renderDatei(key)), 5000));
  await aendereReset(z, undefined);                                            // all notes: no target is left, betrifft_wiedergabe is false
  assert.equal(z.clip().audio_noten.liste.some((n) => n.ton !== undefined), false);
  assert.equal(z.neu.n, 2, 'the clip plays the source again: one reload at this stand');
  assert.equal(z.aufrufe('render').length, 1, 'no job');
  assert.equal(z.nr.zustand('c1').zustand, 'quelle');
  assert.ok(await warteBis(() => z.spieltDatei(path.join(z.arbeitsordner, 'audio', `${SHA}.f32`)), 5000), 'the live playback names the source');
  await z.s.umkehr('undo', { rev: z.projekt().rev }, 'andreas');
  assert.equal(z.schluessel(), key);
  assert.equal(z.neu.n, 3, 'the cached render plays again: one reload');
  assert.equal(z.aufrufe('render').length, 1, 'no job: the file was in the cache');
  assert.ok(await warteBis(() => z.spieltDatei(z.renderDatei(key)), 5000));
  assert.equal(z.nr.zustand('c1').zustand, 'bereit');
});

test('a muted clip is never compared: unrelated stands after its render cause no reload, unmuting loads the render once', async (t) => {
  const z = await mitRender(t);
  await z.erkenne();
  await z.ton('c1', ['t2'], 2);
  assert.ok(await z.nr.bereit(10000));
  assert.ok(await warteBis(() => z.neu.n === 1, 5000));
  await z.aendere([{ befehl: 'clip_aendern', clip_id: 'c1', stumm: true }], 'mute');       // the translation of this stand does not ask the clip
  await z.ton('c1', ['t2'], 1);                                                           // a new edit of the muted clip: a render for a clip nobody plays
  const key = z.schluessel();
  assert.ok(await z.nr.bereit(10000));
  assert.ok(fs.existsSync(z.renderDatei(key)), 'the render is in the cache');
  await new Promise((r) => setTimeout(r, 200));
  const n0 = z.neu.n, rev0 = z.projekt().wiedergabe_rev;
  for (let i = 0; i < 5; i++) await z.aendere([{ befehl: 'clip_aendern', clip_id: 'c1', name: `n${i}` }], 'rename');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(z.neu.n, n0, 'five unrelated stands: no reload');
  assert.equal(z.projekt().wiedergabe_rev, rev0, 'and no new playback');
  await z.aendere([{ befehl: 'clip_aendern', clip_id: 'c1', stumm: false }], 'unmute');
  assert.ok(await warteBis(() => z.spieltDatei(z.renderDatei(key)), 5000), 'the unmuted clip plays its render');
  const rev1 = z.projekt().wiedergabe_rev;
  assert.ok(rev1 > rev0, 'the unmute loaded a playback');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(z.projekt().wiedergabe_rev, rev1, 'nothing follows the unmute');
  assert.equal(z.neu.n, n0, 'the translation of the unmute took the render: the service had nothing to reload');
  // and the stands after it are quiet again
  await z.aendere([{ befehl: 'clip_aendern', clip_id: 'c1', name: 'zuletzt' }], 'rename');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(z.neu.n, n0);
});

test('bereit(): false while queued, true after; export of the project waits and then plays the render file', async (t) => {
  const z = await mitRender(t);
  await z.erkenne();
  z.steuer.NOTEN_ATTRAPPE_SCHLAF_MS = '500';
  await z.ton('c1', ['t2'], 2);
  assert.equal(await z.nr.bereit(40), false, 'the deadline passes while the job runs');
  assert.equal(await z.nr.bereit(10000), true);
  // an export started while a render of its project runs waits for it and contains the edit
  await z.ton('c1', ['t2'], 3);
  const key = z.schluessel();
  const gesehen = [];
  const schreibe = z.s.schreibeWiedergabeFuer.bind(z.s);
  z.s.schreibeWiedergabeFuer = (p) => { const w = schreibe(p); gesehen.push(fs.readFileSync(w.datei, 'utf8')); return w; };
  const t0 = Date.now();
  let r;
  try { r = { code: 200, body: await z.ausgabe.exportiere({}) }; } catch (e) { r = alsAntwort(e); }
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.ok(Date.now() - t0 >= 300, `it waited for the render (${Date.now() - t0} ms)`);
  assert.equal(gesehen.length, 1);
  assert.ok(gesehen[0].includes(z.renderDatei(key)), 'the export plays the render file');
  assert.ok(gesehen[0].includes(`"${key}"`), 'with the render key as the source id');
});

test('export: a render that does not come refuses with noten_render_fehlt, nothing is left locked', async (t) => {
  const z = await mitRender(t);
  z.zugang.notenBereit = async (frist) => { assert.equal(frist, 60000); return false; };
  let r;
  try { r = { code: 200, body: await z.ausgabe.exportiere({}) }; } catch (e) { r = alsAntwort(e); }
  assert.equal(r.code, 409, JSON.stringify(r.body));
  assert.equal(r.body.fehler, 'noten_render_fehlt');
  assert.equal(r.body.text, 'a note edit is still being rendered; try the export again in a moment');
  let noch;
  try { noch = { code: 200, body: await z.ausgabe.exportiere({}) }; } catch (e) { noch = alsAntwort(e); }
  assert.equal(noch.body.fehler, 'noten_render_fehlt', 'asked again: the same answer, so nothing stayed busy');
});

test('program missing: every clip plays the source, state fehler noten_programm_fehlt, bereit is false at once', async (t) => {
  const z = await mitRender(t, { programm: path.join('/nonexistent', 'cypherdj-noten') });
  await z.erkenne();
  await z.ton('c1', ['t2'], 2);
  assert.equal(z.nr.datei(z.clip()), null);
  const s = z.nr.zustand('c1');
  assert.deepEqual([s.zustand, s.grund], ['fehler', 'noten_programm_fehlt']);
  assert.equal(s.text, 'cypherdj-noten is not built or not installed');
  const t0 = Date.now();
  assert.equal(await z.nr.bereit(5000), false);
  assert.ok(Date.now() - t0 < 1000, 'no waiting for a render that cannot come');
  assert.equal(z.aufrufe('render').length, 0);
  assert.equal(z.neu.n, 0);
});

test('a failed render: state fehler noten_render_fehler, the clip plays the source, no retry loop, bereit false at once', async (t) => {
  const z = await mitRender(t);
  await z.erkenne();
  z.steuer.NOTEN_ATTRAPPE_FALL = 'fehler';
  await z.ton('c1', ['t2'], 2);
  assert.equal(await z.nr.bereit(10000), false);
  const s = z.nr.zustand('c1');
  assert.deepEqual([s.zustand, s.grund], ['fehler', 'noten_render_fehler']);
  assert.equal(s.text, 'the note edit could not be rendered; the clip plays without it');
  assert.equal(z.nr.datei(z.clip()), null);
  assert.equal(z.nr.datei(z.clip()), null);
  assert.equal(z.aufrufe('render').length, 1, 'asked twice, started once');
  assert.equal(z.neu.n, 0);
  assert.deepEqual(fs.readdirSync(z.arbeitsordner).filter((f) => /^noten-\d+$/.test(f)), [], 'no temp folder left');
  assert.deepEqual(fs.readdirSync(z.notenOrdner).filter((f) => f.endsWith('.f32')), []);
  // a new edit is a new key: it renders
  z.steuer.NOTEN_ATTRAPPE_FALL = 'ok';
  await z.ton('c1', ['t2'], 1);
  assert.equal(await z.nr.bereit(10000), true);
  assert.equal(z.nr.zustand('c1').zustand, 'bereit');
});

test('the pitch curve is gone and the network is absent: noten_kurve_fehlt for a network curve, the clip plays the source', async (t) => {
  const z = await mitRender(t);
  await z.erkenne();
  await z.ton('c1', ['t1'], 1);
  assert.ok(await z.nr.bereit(10000));
  // notes cut from a network curve that is not on disk (this service has no network runtime): the sidecar cannot be recomputed
  const live = z.offen().projekt;                                                // the stand itself: bereit() and the job read the open project
  live.spuren[0].clips[0].audio_noten.kurve = 'netz-1.noten_hmm-1';
  z.nr.beiStand(live);
  assert.ok(await warteBis(() => z.nr.zustand('c1').zustand === 'fehler', 5000), 'the job fails with the state fehler');
  assert.equal(await z.nr.bereit(5000), false, 'a render that cannot come: false at once');
  const s = z.nr.zustand('c1');
  assert.deepEqual([s.zustand, s.grund], ['fehler', 'noten_kurve_fehlt']);
  assert.equal(s.text, 'the pitch curve of this clip is gone and cannot be recomputed here; detect the notes again');
  assert.equal(z.nr.datei(z.clip()), null);
});

test('the index is rebuilt from the cache folder at start: a second service finds the exact file and the last render', async (t) => {
  const z = await mitRender(t);
  await z.erkenne();
  await z.ton('c1', ['t2'], 2);
  assert.ok(await z.nr.bereit(10000));
  const key = z.schluessel();
  const zweite = new NotenRender(z.ctx, z.zugang, { programm: ATTRAPPE, netz: null, cwd: z.tmp, env: z.steuer, neuLaden: async () => {} });
  await zweite.start();
  t.after(() => zweite.schliesse());
  assert.deepEqual(zweite.datei(z.clip()), { sha256: key, datei: z.renderDatei(key) });
  // a stray json that is not a cache entry and an entry whose file is gone are not taken in
  fs.writeFileSync(path.join(z.notenOrdner, `${'b'.repeat(64)}.json`), '{"nonsense":1}');
  const dritte = new NotenRender(z.ctx, z.zugang, { programm: ATTRAPPE, netz: null, cwd: z.tmp, env: z.steuer, neuLaden: async () => {} });
  await dritte.start();
  t.after(() => dritte.schliesse());
  assert.deepEqual(dritte.datei(z.clip()), { sha256: key, datei: z.renderDatei(key) });
});

test('cleanup: more than proKlip renders of a clip leave the newest proKlip and never the one in use', async (t) => {
  const z = await mitRender(t, { opt: { proKlip: 2 } });
  await z.erkenne();
  const keys = [];
  for (let i = 0; i < 4; i++) {
    await z.ton('c1', ['t2'], 1);                         // each call adds one semitone to the target: four different lists
    assert.ok(await z.nr.bereit(10000));
    keys.push(z.schluessel());
    assert.ok(await warteBis(() => z.spieltDatei(z.renderDatei(keys[i])), 5000), 'the live translation asked for this file');
    await new Promise((r) => setTimeout(r, 5));          // the entries are ordered by time
  }
  assert.equal(new Set(keys).size, 4);
  const da = fs.readdirSync(z.notenOrdner).filter((f) => f.endsWith('.f32')).sort();
  assert.deepEqual(da, keys.slice(2).map((k) => `${k}.f32`).sort(), 'the two newest stay');
  assert.deepEqual(fs.readdirSync(z.notenOrdner).filter((f) => /^[0-9a-f]{64}\.json$/.test(f)).sort(), keys.slice(2).map((k) => `${k}.json`).sort());
});

test('the child command line: taskset mask, nice -n 19, ionice -c3, OMP_NUM_THREADS=1, own process group (CYPHERDJ_STEMS_CPUS=2-3)', async (t) => {
  const gesehen = [];
  // the line is recorded; the program runs without the mask (a test machine may not have the cores)
  const spawn = (cmd, args, o) => { gesehen.push({ cmd, args, o }); const a = cmd === 'taskset' ? args.slice(2) : [cmd, ...args]; return echtSpawn(a[0], a.slice(1), o); };
  const z = await mitRender(t, { opt: { cpus: '2-3', spawn } });
  await z.erkenne();
  await z.ton('c1', ['t2'], 2);
  assert.ok(await z.nr.bereit(10000));
  const r = gesehen.find((g) => g.args.includes('render'));
  assert.ok(r, JSON.stringify(gesehen.map((g) => g.args.slice(0, 8))));
  assert.equal(r.cmd, 'taskset');
  assert.deepEqual(r.args.slice(0, 8), ['-c', '2-3', 'nice', '-n', '19', 'ionice', '-c3', ATTRAPPE]);
  assert.equal(r.args[8], 'render');
  assert.equal(r.o.env.OMP_NUM_THREADS, '1');
  assert.equal(r.o.detached, true);
});

test('a failed key is tried once more on the next stand that needs it, then it stays failed', async (t) => {
  const z = await mitRender(t);
  await z.erkenne();
  z.steuer.NOTEN_ATTRAPPE_FALL = 'fehler';
  await z.ton('c1', ['t2'], 2);
  assert.equal(await z.nr.bereit(10000), false);
  assert.equal(z.aufrufe('render').length, 1);
  await z.aendere([{ befehl: 'clip_aendern', clip_id: 'c1', name: 'a' }], 'rename');       // the next stand: the second try
  assert.equal(z.nr.zustand('c1').zustand, 'rechnet', 'queued again');
  assert.equal(await z.nr.bereit(10000), false);
  assert.equal(z.aufrufe('render').length, 2, 'one more try');
  assert.equal(z.nr.zustand('c1').zustand, 'fehler');
  for (let i = 0; i < 3; i++) await z.aendere([{ befehl: 'clip_aendern', clip_id: 'c1', name: `b${i}` }], 'rename');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(z.aufrufe('render').length, 2, 'after the second failure the stands start nothing');
  assert.equal(z.nr.zustand('c1').zustand, 'fehler');
  assert.equal(z.neu.n, 0);
});

test('the retry of a failed key can succeed: the clip then plays the render', async (t) => {
  const z = await mitRender(t);
  await z.erkenne();
  z.steuer.NOTEN_ATTRAPPE_FALL = 'fehler';
  await z.ton('c1', ['t2'], 2);
  assert.equal(await z.nr.bereit(10000), false);
  const key = z.schluessel();
  z.steuer.NOTEN_ATTRAPPE_FALL = 'ok';
  await z.aendere([{ befehl: 'clip_aendern', clip_id: 'c1', name: 'a' }], 'rename');
  assert.equal(await z.nr.bereit(10000), true);
  assert.equal(z.nr.zustand('c1').zustand, 'bereit');
  assert.ok(await warteBis(() => z.spieltDatei(z.renderDatei(key)), 5000));
});

test('a render that hangs is killed at its limit, ends fehler and does not hold the queue', async (t) => {
  const z = await mitRender(t, { opt: { renderFristMs: 1500 } });
  await z.erkenne();
  z.steuer.NOTEN_ATTRAPPE_FALL = 'langsam';                                              // the stand-in sleeps 30 s and exits on SIGTERM
  await z.ton('c1', ['t2'], 2);
  const t0 = Date.now();
  assert.equal(await z.nr.bereit(10000), false);
  assert.ok(Date.now() - t0 < 5000, 'killed at the limit, not after the sleep');
  const s = z.nr.zustand('c1');
  assert.deepEqual([s.zustand, s.grund], ['fehler', 'noten_render_fehler']);
  assert.ok(z.ctx && z.protokoll.log.some((x) => x.typ === 'noten_render_fehler' && /timed out/.test(x.fehler ?? '')), 'the log names the timeout');
  // the queue goes on: a new edit renders
  z.steuer.NOTEN_ATTRAPPE_FALL = 'ok';
  await z.ton('c1', ['t2'], 1);
  assert.equal(await z.nr.bereit(10000), true);
  assert.equal(z.nr.zustand('c1').zustand, 'bereit');
  assert.deepEqual(fs.readdirSync(z.arbeitsordner).filter((f) => /^noten-\d+$/.test(f)), [], 'no temp folder left');
});

test('a `version` that hangs ends at its limit: the service starts without an engine version', async (t) => {
  const z = await aufbau(t);
  const haengt = path.join(z.tmp, 'haengt.sh');
  fs.writeFileSync(haengt, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
  const nr = new NotenRender(z.ctx, z.zugang, { programm: haengt, netz: null, cwd: z.tmp, killMs: 200, versionFristMs: 300, neuLaden: async () => {} });
  t.after(() => nr.schliesse());
  const t0 = Date.now();
  await nr.start();
  assert.ok(Date.now() - t0 < 5000, 'start returned at the limit');
  assert.ok(z.protokoll.log.some((x) => x.typ === 'noten_render_programm'), 'the log names it');
});

test('export: waits for the renders before it reads the range, and refuses when a clip did not get its exact file', async (t) => {
  const z = await mitRender(t);
  await z.erkenne();
  const reihe = [];
  const bereit0 = z.zugang.notenBereit;
  z.zugang.notenBereit = async (f) => { reihe.push('warte'); return bereit0(f); };
  const rb = z.ausgabe.pruefeBereich.bind(z.ausgabe);
  z.ausgabe.pruefeBereich = (...a) => { reihe.push('bereich'); return rb(...a); };
  z.steuer.NOTEN_ATTRAPPE_SCHLAF_MS = '300';
  await z.ton('c1', ['t2'], 2);
  const r = await z.ausgabe.exportiere({});
  assert.ok(r.datei || r.dateien || r.ordner || r, 'the export went through');
  assert.deepEqual(reihe.slice(0, 2), ['warte', 'bereich'], 'the wait comes first');
  // an edit slips in after the wait: the translation gives the clip no exact file, the export refuses
  z.zugang.notenBereit = async () => true;
  z.steuer.NOTEN_ATTRAPPE_SCHLAF_MS = '2000';
  await z.ton('c1', ['t2'], 1);
  let e;
  try { e = { code: 200, body: await z.ausgabe.exportiere({}) }; } catch (x) { e = alsAntwort(x); }
  assert.equal(e.code, 409, JSON.stringify(e.body));
  assert.equal(e.body.fehler, 'noten_render_fehlt');
  assert.equal(e.body.text, 'a note edit is still being rendered; try the export again in a moment');
  assert.ok(await z.nr.bereit(15000));
});

test('export: a render that cannot come refuses with the text of the cause, not "try again in a moment"', async (t) => {
  const z = await mitRender(t);
  await z.erkenne();
  z.steuer.NOTEN_ATTRAPPE_FALL = 'fehler';
  await z.ton('c1', ['t2'], 2);
  let e;
  try { e = { code: 200, body: await z.ausgabe.exportiere({}) }; } catch (x) { e = alsAntwort(x); }
  assert.equal(e.code, 409, JSON.stringify(e.body));
  assert.equal(e.body.fehler, 'noten_render_fehlt');
  assert.equal(e.body.text, 'the note edit could not be rendered; the clip plays without it');
  const p = await mitRender(t, { programm: path.join('/nonexistent', 'cypherdj-noten') });
  await p.erkenne();
  await p.ton('c1', ['t2'], 2);
  let f;
  try { f = { code: 200, body: await p.ausgabe.exportiere({}) }; } catch (x) { f = alsAntwort(x); }
  assert.equal(f.body.fehler, 'noten_render_fehlt');
  assert.equal(f.body.text, 'cypherdj-noten is not built or not installed');
});
