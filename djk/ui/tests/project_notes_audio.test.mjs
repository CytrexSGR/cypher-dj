// Note editor (slice 1, B2): the pure helpers of the detection job (project/notes_audio.ts) and the command line of its child processes
// (areas/proj/notes_run.ts). No server, no real program: the project is a plain object, the child is a one-line node script.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn as echtSpawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { baueNotenFeld, baueNotenProjekt, fertigHinweis, netzPasst, notenNochGleich, notenZeitlimitMs, NotenAudioFehler, NOTEN_WENIG_STIMMHAFT } from '../project/notes_audio.ts';
import { audioNotenPruefung, kurvePruefung, frameZahl } from '../project/notes_contract.ts';
import { NotenLauf, notenBefehl } from '../areas/proj/notes_run.ts';

const SHA = 'a'.repeat(64);
// a valid sidecar of a source of `frames` frames; the notes and the voiced pitch are given
function kurve({ frames = 48000, noten = [], ct = 6000, kurve: id = 'pyin-1.noten_hmm-1', detektor = 'pyin' } = {}) {
  const n = frameZahl(frames);
  const f0 = Array.isArray(ct) ? ct : Array.from({ length: n }, () => ct);
  assert.equal(f0.length, n);
  return { format: 'cdj-noten-kurve/1', quelle: SHA, frames, sr: 48000, hop: 256, detektor, kurve: id, f0_ct: f0, konf: f0.map((v) => (v > 0 ? 0.9 : 0.1)),
    noten, stimmhaft_anteil: Math.round(f0.filter((v) => v > 0).length / n * 1e4) / 1e4 };
}
const note = (qa, qe, qton = 60, p = 0.9) => ({ qa, qe, qton, p });

test('baueNotenFeld numbers t1..tn by start and copies only detected values', () => {
  const sd = kurve({ noten: [note(0.5, 0.7, 62), note(0.1, 0.3, 60), note(0.8, 0.95, 64.5, 0.75)] });
  assert.equal(kurvePruefung({ ...sd, noten: [...sd.noten].sort((a, b) => a.qa - b.qa) }), null, 'the sidecar itself is valid');
  const f = baueNotenFeld(sd, 48000);
  assert.equal(f.kurve, 'pyin-1.noten_hmm-1');
  assert.deepEqual(f.liste.map((n) => n.id), ['t1', 't2', 't3']);
  assert.deepEqual(f.liste.map((n) => n.qa), [0.1, 0.5, 0.8], 'numbered by the start');
  assert.deepEqual(f.liste[2], { id: 't3', qa: 0.8, qe: 0.95, qton: 64.5, p: 0.75 });
  for (const n of f.liste) assert.deepEqual(Object.keys(n).sort(), ['id', 'p', 'qa', 'qe', 'qton'], 'no target field');
  assert.equal(audioNotenPruefung(f), null);
  assert.deepEqual(baueNotenFeld(kurve({ noten: [] }), 48000), { kurve: 'pyin-1.noten_hmm-1', liste: [] }, 'an empty list is a valid field');
});

test('baueNotenFeld refuses a note that ends beyond the source (noten_fehler), accepts the last sample and the rounding of six decimals', () => {
  const ende = 48000 / 48000;
  assert.equal(baueNotenFeld(kurve({ noten: [note(0.5, ende)] }), 48000).liste[0].qe, ende);
  assert.equal(baueNotenFeld(kurve({ noten: [note(0.5, ende + 4e-7)] }), 48000).liste[0].qe, ende, 'within the rounding: cut to the end');
  // the sidecar check allows a note to end one hop after the last sample (1.00533 s here); the server's half of the rule does not
  const sd = kurve({ noten: [note(0.5, ende + 0.004)] });
  assert.equal(kurvePruefung(sd), null, 'valid as a sidecar');
  assert.throws(() => baueNotenFeld(sd, 48000), (e) => e instanceof NotenAudioFehler && e.grund === 'noten_fehler' && /ends at 1.004 s/.test(e.message), 'refused by the job');
});

test('netzPasst: P5 of voiced cents 3450 -> false, 3451 -> true; no voiced frames -> false', () => {
  assert.equal(netzPasst(kurve({ ct: 3450 })), false);
  assert.equal(netzPasst(kurve({ ct: 3450.6 })), true, 'the limit itself is inside (60 Hz)');
  assert.equal(netzPasst(kurve({ ct: 3451 })), true);
  assert.equal(netzPasst(kurve({ ct: 0 })), false, 'no voiced frame');
  const n = frameZahl(48000);
  // unvoiced frames (0) do not count; of the voiced ones 4 percent are low: P5 is still a voice pitch, 6 percent: bass
  const mix = (tief) => { const v = Array.from({ length: n }, () => 0); for (let i = 0; i < 100; i++) v[i] = i < tief ? 3000 : 5000; return v; };
  assert.equal(netzPasst(kurve({ ct: mix(4) })), true);
  assert.equal(netzPasst(kurve({ ct: mix(6) })), false);
});

test('with CYPHERDJ_STEMS_CPUS=2-3 the analysis runs as taskset -c 2-3 nice -n 19 ionice -c3 ... with OMP_NUM_THREADS=1', async () => {
  // the mask is read from the environment when the module loads: a child that loads it with the variable set prints the command line
  const lauf = path.join(import.meta.dirname, '..', 'areas', 'proj', 'notes_run.ts');
  const aus = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { notenBefehl } from ${JSON.stringify(lauf)}; console.log(JSON.stringify(notenBefehl(['cypherdj-noten', 'analyse', 'q.f32', 'a.json'])));`],
    { env: { ...process.env, CYPHERDJ_STEMS_CPUS: '2-3' }, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(aus.trim().split('\n').pop()),
    { cmd: 'taskset', args: ['-c', '2-3', 'nice', '-n', '19', 'ionice', '-c3', 'cypherdj-noten', 'analyse', 'q.f32', 'a.json'] });
  assert.deepEqual(notenBefehl(['x'], ''), { cmd: 'nice', args: ['-n', '19', 'ionice', '-c3', 'x'] }, 'no mask: no taskset');
  // the real class: command line, environment and own process group of a spawned child, one for each thread count
  for (const omp of [1, 2]) {
    const gesehen = [];
    const spawn = (cmd, args, opt) => { gesehen.push({ cmd, args, opt }); return echtSpawn(process.execPath, ['-e', 'console.log(JSON.stringify({status:"ok"}))'], opt); };
    const l = new NotenLauf(['programm', 'analyse', 'q.f32'], { cwd: '/', omp, cpus: '2-3', spawn, env: { EXTRA: 'x' } }, () => {});
    const e = await l.fertig;
    assert.deepEqual(e.zeile, { status: 'ok' });
    assert.equal(gesehen[0].cmd, 'taskset');
    assert.deepEqual(gesehen[0].args, ['-c', '2-3', 'nice', '-n', '19', 'ionice', '-c3', 'programm', 'analyse', 'q.f32']);
    assert.equal(gesehen[0].opt.env.OMP_NUM_THREADS, String(omp));
    assert.equal(gesehen[0].opt.env.EXTRA, 'x');
    assert.equal(gesehen[0].opt.detached, true, 'own process group');
  }
});

// a project of plain objects: sucheClip only reads spuren and clips
const projekt = (clip) => ({ spuren: [{ id: 's1', clips: [clip] }] });
const audio = (extra = {}) => ({ id: 'c1', art: 'audio', name: 'Kick', quelle: { sha256: SHA }, ...extra });
const feld = { kurve: 'pyin-1.noten_hmm-1', liste: [{ id: 't1', qa: 0.1, qe: 0.3, qton: 60, p: 0.9 }] };
const plan = (vorher = null) => ({ clipId: 'c1', sha256: SHA, frames: 24000, vorher, name: 'Kick' });

test('notenNochGleich: other sha, deleted clip, changed audio_noten -> veraltet; unchanged -> null', () => {
  assert.equal(notenNochGleich(projekt(audio()), plan()), null);
  assert.equal(notenNochGleich(projekt(audio({ audio_noten: feld })), plan(structuredClone(feld))), null);
  assert.equal(notenNochGleich(projekt(audio({ quelle: { sha256: 'b'.repeat(64) } })), plan()), 'veraltet', 'other source');
  assert.equal(notenNochGleich({ spuren: [{ id: 's1', clips: [] }] }, plan()), 'veraltet', 'deleted clip');
  assert.equal(notenNochGleich(projekt({ id: 'c1', art: 'midi', name: 'M', noten: [] }), plan()), 'veraltet', 'no longer an audio clip');
  assert.equal(notenNochGleich(projekt(audio({ audio_noten: feld })), plan()), 'veraltet', 'notes appeared');
  assert.equal(notenNochGleich(projekt(audio()), plan(feld)), 'veraltet', 'notes removed');
  const anders = structuredClone(feld); anders.liste[0].ton = 62;
  assert.equal(notenNochGleich(projekt(audio({ audio_noten: anders })), plan(structuredClone(feld))), 'veraltet', 'a target was set');
  assert.equal(notenNochGleich(projekt(audio({ start_beat: 4, laenge_beats: 2, offset_s: 1, audio_noten: feld })), plan(structuredClone(feld))), null, 'cutting and moving do not matter');
});

test('baueNotenProjekt places the field on a copy; a clip that is no audio clip is refused; the time limit is the length of the source, at least two minutes', () => {
  const p = projekt(audio());
  const neu = baueNotenProjekt(p, 'c1', feld);
  assert.deepEqual(neu.spuren[0].clips[0].audio_noten, feld);
  assert.equal('audio_noten' in p.spuren[0].clips[0], false, 'the argument stays as it is');
  assert.notEqual(neu.spuren[0].clips[0].audio_noten, feld, 'a copy of the field');
  assert.throws(() => baueNotenProjekt(projekt({ id: 'c1', art: 'midi', name: 'M', noten: [] }), 'c1', feld), /not an audio clip/);
  assert.throws(() => baueNotenProjekt(p, 'c9', feld), /not an audio clip/);
  assert.equal(notenZeitlimitMs(0), 120000);
  assert.equal(notenZeitlimitMs(48000 * 60), 120000);
  assert.equal(notenZeitlimitMs(48000 * 240), 240000);
});

test('fertigHinweis: stimmhaft_anteil 0.14 -> wenig_stimmhaft, 0.15 -> none; keine_noten wins; netz_fehler comes last', () => {
  assert.equal(NOTEN_WENIG_STIMMHAFT, 0.15);
  assert.equal(fertigHinweis(0.14, 3, false).hinweis, 'wenig_stimmhaft');
  assert.equal(fertigHinweis(0.15, 3, false), null, 'the limit itself is no hint');
  assert.equal(fertigHinweis(0.9, 3, false), null);
  assert.equal(fertigHinweis(0, 0, false).hinweis, 'keine_noten', 'no notes: keine_noten wins over wenig_stimmhaft');
  assert.equal(fertigHinweis(0.9, 0, true).hinweis, 'keine_noten');
  assert.equal(fertigHinweis(0.9, 3, true).hinweis, 'netz_fehler');
  assert.equal(fertigHinweis(0.05, 3, true).hinweis, 'wenig_stimmhaft', 'one hint: the more useful one');
  assert.equal(fertigHinweis(0.14, 3, false).text, 'Little pitched sound found. If this is a full mix, separate stems first and detect notes on the vocal stem.');
});
