// Note editor (slice 1, B4): the playback switch in the translator (project/playback.ts audioClips): a clip whose edit is rendered plays the render
// file instead of the source; everything else of the clip stays as it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { uebersetze } from '../project/playback.ts';
import { specProjekt, kopie, SHA_A, SHA_B } from './support/project.mjs';

const AUDIO = '/arbeit/arr/audio';
const opt = (extra = {}) => ({ nr: 1, audioOrdner: AUDIO, frames: (sha) => (sha === SHA_A || sha === SHA_B ? 2_000_000 : null), ...extra });
// two audio clips on one track: c1 with a loop and a fade, c3 warped, looped and offset
function projekt() {
  const p = kopie(specProjekt()); p.format = 'cypherdj-projekt/2';
  const c1 = p.spuren[0].clips[0]; c1.laenge_beats = 8; c1.loop_beats = 2; c1.gain_db = -3; c1.fade_ein_beats = 0.25;
  p.spuren[0].clips.push({ id: 'c3', art: 'audio', name: 'warped', start_beat: 8, laenge_beats: 6, quelle: { sha256: SHA_B, pfad_hinweis: '/abs/b.wav' }, dekodiert: 'fertig',
    offset_s: 0.25, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0, loop_beats: 2,
    warp: { an: true, modus: 'repitch', marker: [[0, 0], [3.84, 8]], versatz_beats: 0, quelle: 'takte', transpose_st: 0, detune_ct: 0 } });
  return p;
}
const RENDER = 'c'.repeat(64);
const renderDatei = `/arbeit/arr/noten/${RENDER}.f32`;

test('without notenDatei the translation is byte-identical to before (fixture project with audio clips, warp, loop)', () => {
  const s = JSON.stringify(uebersetze(projekt(), opt()));
  // digest of the translation of this project made BEFORE the option existed (git fdba6624a)
  assert.equal(crypto.createHash('sha256').update(s).digest('hex'), '42c9d6d8feb0193118c346db2de5e092bb09710a76fa54240c52d243ecc8cc3a');
  assert.equal(JSON.stringify(uebersetze(projekt(), opt({ notenDatei: () => null }))), s, 'an option that answers null changes nothing');
  assert.equal(s.includes('audio_noten') || s.includes('/noten/'), false);
});

test('notenDatei returning a render: sha256 and datei of every loop copy are the render key and file; frames and offset unchanged', () => {
  const p = projekt();
  const vorher = uebersetze(p, opt());
  const gefragt = [];
  const nach = uebersetze(p, opt({ notenDatei: (c) => { gefragt.push(c.id); return c.id === 'c1' ? { sha256: RENDER, datei: renderDatei } : null; } }));
  assert.deepEqual([...new Set(gefragt)], ['c1', 'c3'], 'asked once per audio clip');
  const a = vorher.spuren[0].clips, b = nach.spuren[0].clips;
  assert.equal(a.length, b.length);
  assert.equal(b.filter((c) => c.sha256 === RENDER).length, 4, 'the four loop copies of c1');
  for (let i = 0; i < a.length; i++) {
    const eigen = b[i].id.startsWith('c1');
    const { sha256, datei, ...rest } = b[i], { sha256: s0, datei: d0, ...rest0 } = a[i];
    assert.deepEqual(rest, rest0, 'everything but the file is the same: frames, offset, gain, fades, warp');
    assert.equal(sha256, eigen ? RENDER : s0);
    assert.equal(datei, eigen ? renderDatei : d0);
  }
  assert.equal(b[0].frames, 2_000_000, 'frames stay the source`s');
  assert.equal(b.at(-1).datei, `${AUDIO}/${SHA_B}.f32`, 'the clip without a render plays its source');
  assert.equal(nach.format, vorher.format);
});

test('a muted or undecoded clip is never asked: it plays nothing, whatever the render says', () => {
  const p = projekt();
  p.spuren[0].clips[0].stumm = true; p.spuren[0].clips[1].dekodiert = 'laeuft';
  const gefragt = [];
  const w = uebersetze(p, opt({ notenDatei: (c) => { gefragt.push(c.id); return { sha256: RENDER, datei: renderDatei }; } }));
  assert.deepEqual(w.spuren[0].clips, []);
  assert.deepEqual(gefragt, []);
});
