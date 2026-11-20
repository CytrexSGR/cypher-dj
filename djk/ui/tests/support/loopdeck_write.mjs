// Loop deck M5 tests: the live setup of live_module.mjs with a LoopdeckBereich on it, a loop library and a module library in the temp folder, and the
// sources that live in server.ts (catalogue import, deck loop) as doubles. No core, no studio.
import fs from 'node:fs';
import path from 'node:path';
import { liveAufbau } from './live_module.mjs';
import { loopdeckBereich } from '../../areas/live/loopdeck.ts';
import { schreibeWavAusF32Stueckweise } from '../../project/recording.ts';

export const BEAT = 22500;
export const rampe = (frames, a = 1000, b = 3) => {
  const x = Buffer.alloc(frames * 8);
  for (let i = 0; i < frames; i++) { x.writeFloatLE(((i % a) - a / 2) / (a * 2), i * 8); x.writeFloatLE(((i * b) % a - a / 2) / (a * 2), i * 8 + 4); }
  return x;
};

// a loop folder the way the core writes it (see live_loop_library.test.mjs)
export function schreibeLoop(dir, name, beats, extra = {}) {
  const frames = beats * BEAT;
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, 'loop.f32'), rampe(frames));
  fs.writeFileSync(path.join(dir, name, 'loop.json'), JSON.stringify({ schema: 1, name, beats, bpm: 128, frames, datei: 'loop.f32', quelle: 'deck', erstellt: '2026-11-13 10:00', ...extra }));
}

// a module folder of the module library with a Loop track and a Drums stem group (what POST /modul/export and the stems leave behind)
export async function schreibeModul(basis, id, { titel = 'Song', beats = 4 } = {}) {
  const ordner = path.join(basis, `song-${id.slice(0, 4)}`);
  fs.mkdirSync(path.join(ordner, 'audio'), { recursive: true });
  const f32 = path.join(basis, `${id}.f32`);
  const audio = {};
  for (const [nm, b] of [['loop', 3], ['drums', 7]]) {
    fs.writeFileSync(f32, rampe(beats * 24000, 1000, b));
    const tmp = path.join(ordner, 'audio', `${nm}.wav`);
    const w = await schreibeWavAusF32Stueckweise(f32, tmp);
    fs.renameSync(tmp, path.join(ordner, 'audio', `${w.sha256}.wav`));
    audio[nm] = { sha256: w.sha256, frames: w.frames, datei: `audio/${w.sha256}.wav` };
  }
  fs.rmSync(f32);
  const clip = (a, id2) => ({ id: id2, art: 'audio', start_beat: 0, laenge_beats: beats, quelle: { sha256: a.sha256, pfad_hinweis: a.datei },
    warp: { an: true, modus: 'complex', marker: [[a.frames / 48000, beats]], versatz_beats: 0, quelle: 'hand' } });
  const modul = { format: 1, id, gespeichert: '2026-11-20T10:00:00.000Z', slot: 'A', herkunft: { titel, laenge_beats: beats, basis_bpm: 120 },
    gruppen: [{ id: 'g1', name: `A · ${titel}`, modul: { titel, laenge_beats: beats, basis_bpm: 120, slot: 'A' } }, { id: 'g2', name: 'Drums', ausgang: { art: 'gruppe', id: 'g1' } }],
    spuren: [{ id: 's1', name: 'Loop', art: 'audio', ausgang: { art: 'gruppe', id: 'g1' }, clips: [clip(audio.loop, 'c1')] },
      { id: 's2', name: 'Drums original', art: 'audio', ausgang: { art: 'gruppe', id: 'g2' }, clips: [clip(audio.drums, 'c2')] }],
    audio: [audio.loop, audio.drums].map((a) => ({ sha256: a.sha256, datei: a.datei })) };
  fs.writeFileSync(path.join(ordner, 'modul.json'), JSON.stringify(modul));
  return { ordner, loop: audio.loop, drums: audio.drums };
}

export async function ldAufbau(t, { deck = false, frames = {}, katalogLoop, container = true, echt = false } = {}) {
  const z = await liveAufbau(t);
  const loops = path.join(z.tmp, 'loopbib'), module = path.join(z.tmp, 'modulbib');
  fs.mkdirSync(loops); fs.mkdirSync(module);
  const o = { frames: { ...frames }, offen: container, fremd: false, geoeffnet: 0, katalogLoop, deck: { ...z.deck }, deckFrames: null };
  // o.fremd: a project that is not the live container is open (the real one stays untouched underneath)
  const zugang = { ...z.zugang, offen: () => {
    if (!o.offen) return null;
    const r = z.zugang.offen();
    return o.fremd && r ? { ...r, projekt: { ...r.projekt, live: undefined } } : r;
  } };
  const bereich = loopdeckBereich(z.ctx, zugang, {
    frames: (sha) => o.frames[sha] ?? null, loopOrdner: () => loops, modulBasis: () => module,
    katalogLoop: (sha) => o.katalogLoop(sha, loops), deckLoop: () => (o.deck.fehler ? o.deck : { ...o.deck, ...(o.deckFrames ? { frames: o.deckFrames } : {}) }),
    // echt: the session's own open (as the server wires it: only when no project is open), else a stand-in that just marks the container as open
    liveOeffnen: echt ? (q) => { o.geoeffnet++; return z.s.liveOeffnen(q, false, true); } : async () => { o.geoeffnet++; o.offen = true; return { code: 200, j: {} }; } });
  if (deck) await z.aendern([{ befehl: 'loopdeck_neu', platz: 1, raster: 'takt' }]);
  const ordner = () => z.zugang.offen().ordner;
  const wavs = () => { try { return fs.readdirSync(path.join(ordner(), 'loops')); } catch { return []; } };
  const spuren = () => z.projekt().spuren.filter((s) => s.zellen);
  const zelle = (sp, zl) => spuren()[sp - 1]?.zellen[zl - 1] ?? null;
  const undo = () => z.s.umkehr('undo', { rev: z.projekt().rev }, 'andreas');
  return { ...z, o, bereich, loops, module, ordner, wavs, spuren, zelle, undo };
}
