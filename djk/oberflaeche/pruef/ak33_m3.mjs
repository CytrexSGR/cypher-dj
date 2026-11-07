// AK33 M3: why did the jam not beatmatch? Layer exports of a COPY of the project cypher-jam-1 on a TEST INSTANCE (b, d or e, never f).
//   flock /dev/shm/b1-instanz-e.lock ... djk-start --instanz e (see the wrapper in the evidence folder)
//   node pruef/ak33_m3.mjs --url http://127.0.0.1:52300 --aufbau <json with {"jam": "<project.json of the jam>"}> --ausgabe <folder> [--von 64 --bis 96]
// The jam project is READ (never written); a filtered copy per layer is written into the test instance's own project store and opened there.
// Per layer one export (beats von..bis, all clips of the layer sound over the whole span), written to <ausgabe>/m3_<layer>.wav.
// Layers: each track alone, and the Sky And Sand track together with one extra loop. The evaluation is ak33_lage.py (it needs the exports only).
// G3 (grid shift, review F3): --versatz-ms <ms> moves the audio clips of the tracks in --versatz-spuren (default: every layer except the track s3) by that many ms LATER
//   (negative = earlier) through the clip's own OFFSET field warp.versatz_beats (project tempo 128: ms * 128 / 60000 beats; the sound at project beat P is then the source at
//   clip beat P - start_beat + versatz, so a negative versatz_beats is later). --suffix <text> is appended to the file name. --track-bpm <bpm> replaces the markers of the clip
//   --track-markers <n> keeps only the first n markers of the clip on s3 (marker count test).
//   on s3 by a straight line of that tempo through the first marker (or through --track-t0 <source second>, the engine anchoring test); the other markers are dropped.
// All faders are set to 0 dB, mute/solo off, so the exports differ only in the audio of the layer; warp, markers, modes, clip starts stay as in the jam.
import fs from 'node:fs';
import path from 'node:path';
import { starte, Fehl } from './w3a_ziel.mjs';

const z = starte('ak33_m3', 'b1m3', { jam: { type: 'string' }, von: { type: 'string' }, bis: { type: 'string' }, nur: { type: 'string' }, modus: { type: 'string' }, 'versatz-ms': { type: 'string' }, 'versatz-spuren': { type: 'string' }, suffix: { type: 'string' }, 'track-bpm': { type: 'string' }, 'track-t0': { type: 'string' }, 'track-markers': { type: 'string' }, 'zeige-warp': { type: 'boolean' } });
const { AUFBAU: A, CYPHER, info, instanz } = z;
const JAM = z.opt.jam ?? A.jam;
if (!JAM) { process.stderr.write('ak33_m3: --jam <project.json of the jam> (or "jam" in the aufbau file)\n'); process.exit(2); }
if (!/^[bde]$/.test(instanz)) { process.stderr.write(`ak33_m3: instance ${instanz} is not allowed: b, d or e only\n`); process.exit(2); }
const VON = Number(z.opt.von ?? 64), BIS = Number(z.opt.bis ?? 96);
const jam = JSON.parse(fs.readFileSync(JAM, 'utf8'));          // read only
const wurzel = path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte');

// layer name -> spur ids of the jam project
const LAGEN = {
  track: ['s3'], drums: ['s1'], ride: ['s5'], stab: ['s6'], strings: ['s7'], vox: ['s4'], riser: ['s9'],
  track_drums: ['s3', 's1'], track_ride: ['s3', 's5'], track_stab: ['s3', 's6'], track_strings: ['s3', 's7'],
  alle_audio: ['s1', 's3', 's4', 's5', 's6', 's7'],
};

const VMS_GESETZT = z.opt['versatz-ms'] !== undefined;   // --versatz-ms=0 writes versatz_beats too (a zero shift through the same OFFSET path, review of G3)
const VMS = Number(z.opt['versatz-ms'] ?? 0), VSPUREN = new Set((z.opt['versatz-spuren'] ?? 's1,s5,s6,s7,s4,s9').split(',')), SUFFIX = z.opt.suffix ?? '';
const TRACK_BPM = z.opt['track-bpm'] ? Number(z.opt['track-bpm']) : null;
const MODUS = z.opt.modus ?? null;   // override warp.modus (repitch | complex | beats | tones) of every audio clip: the same loop in each mode against the grid
async function lage(name, spuren) {
  await z.neuesProjekt(name);
  const slug = z.eigeneSlugs.at(-1), datei = path.join(wurzel, slug, 'project.json');
  const nun = JSON.parse(fs.readFileSync(datei, 'utf8'));
  const p = JSON.parse(JSON.stringify(jam));
  p.spuren = p.spuren.filter((s) => spuren.includes(s.id)).map((s) => ({ ...s, fader_db: 0, mute: false, solo: false, pan: 0, clips: s.clips.map((c) => {
    const w = c.warp ? { ...c.warp } : null;
    if (w && MODUS) w.modus = MODUS;
    if (w && VMS_GESETZT && VSPUREN.has(s.id)) w.versatz_beats = (w.versatz_beats ?? 0) - VMS * 128 / 60000;
    if (w && TRACK_BPM && s.id === 's3') { const m = JSON.parse(typeof w.marker === 'string' ? w.marker : JSON.stringify(w.marker)); const t0 = z.opt['track-t0'] !== undefined ? Number(z.opt['track-t0']) : m[0][0]; w.marker = [[t0, 0], [t0 + 60 / TRACK_BPM * 480, 480]]; }
    if (w && z.opt['track-markers'] && s.id === 's3') { const m = typeof w.marker === 'string' ? JSON.parse(w.marker) : w.marker; w.marker = m.slice(0, Number(z.opt['track-markers'])); }
    return { ...c, gain_db: 0, ...(w ? { warp: w } : {}) };
  }) }));
  p.name = nun.name; p.loop = { an: false, von_beat: 0, bis_beat: 96 };
  p.rev = nun.rev ?? 1; p.tempo_bpm = 128;
  fs.writeFileSync(datei, JSON.stringify(p));
  const o = await z.ruf('POST', '/proj/oeffnen', { slug }, CYPHER);
  if (o.code !== 200) throw new Fehl(`/proj/oeffnen ${slug} -> ${z.grundVon(o)} ${JSON.stringify(o.j).slice(0, 600)}`);
  await z.geladen();
  if (z.opt['zeige-warp']) {   // what the server serves for each audio clip of the layer (G3: does the engine see the markers that were written?)
    const akt = await z.aktuell();
    for (const c of akt.projekt.spuren.flatMap((t) => t.clips).filter((c) => c.art === 'audio')) {
      const w = await z.ruf('GET', `/proj/warp?clip_id=${c.id}&marker_max=4096`);
      fs.writeFileSync(path.join(z.ORDNER, `warp_${name}_${c.id}.json`), JSON.stringify({ clip_im_projekt: c.warp, vom_server: w.j }, null, 1));
    }
  }
  const e = await z.exportiere(VON, BIS, `m3_${name}${MODUS ? `_${MODUS}` : ''}${SUFFIX}`);
  info(`${name}: spuren ${spuren.join('+')}, export ${(e.frames / e.rate).toFixed(3)} s -> ${e.datei}`);
  return e;
}

try {
  const nur = z.opt.nur ? new Set(z.opt.nur.split(',')) : null;
  for (const [name, spuren] of Object.entries(LAGEN)) {
    if (nur && !nur.has(name)) continue;
    z.punkt = name;
    await lage(name, spuren);
  }
} catch (e) { z.notiere('Aufbau/Export', false, e.message); }
await z.ende('AK33 M3 layer exports', /^b1m3-/);
