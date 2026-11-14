// Loop slots L1, L2 (live modules): waveform, beat grid and playhead of the module's loop.
// The module's loop is the clip of its muted track "Loop" in the live project; its file is the loop cut to `loop_beats` at the project tempo, so the
// whole waveform spans the loop. The playhead comes from the arrangement transport (the live container is the open project): the position inside the
// loop is (project beat - clip start - warp offset) modulo the loop length. No DOM state here apart from the canvas that is passed in.
import { spalten, zeichneSpalte } from './wave.js';

// The loop of a module group: { sha, beats, start, versatz } or null. `projekt` is the live project, `gruppeId` the group of the slot.
export function loopVonGruppe(projekt, gruppeId) {
  const s = (projekt?.spuren ?? []).find((x) => x.art === 'audio' && x.ausgang?.id === gruppeId);
  const c = s?.clips?.find((k) => k.art === 'audio' && k.quelle?.sha256);
  const beats = Number(c?.loop_beats);
  if (!c || !(beats > 0)) return null;
  return { sha: c.quelle.sha256, beats, start: Number(c.start_beat) || 0, versatz: Number(c.warp?.versatz_beats) || 0 };
}

// Position inside the loop as a beat 0 <= p < beats, or null while the transport does not play.
export function loopPosition(kopfBeat, loop) {
  if (kopfBeat === null || kopfBeat === undefined || !Number.isFinite(kopfBeat) || !loop) return null;
  const b = kopfBeat - loop.start - loop.versatz;
  if (b < 0) return null;
  return ((b % loop.beats) + loop.beats) % loop.beats;
}

// The grid of a loop: one entry per beat, { beat, eins (bar start), takt (bar number from 1) }.
export function raster(beats) {
  const r = [];
  for (let b = 0; b < beats; b++) r.push({ beat: b, eins: b % 4 === 0, takt: Math.floor(b / 4) + 1 });
  return r;
}

// Static layer: waveform over the whole width, beat lines, bar lines with their number. g = 2D context, w = DJKW wave or null, b, h in device pixels.
export function zeichneGrund(g, welle, beats, b, h, dpr = 1) {
  g.clearRect(0, 0, b, h);
  g.fillStyle = 'rgba(255,255,255,0.03)';
  g.fillRect(0, 0, b, h);
  const mitte = h / 2;
  if (welle) {
    const proPixel = welle.spalten / b;
    for (let x = 0; x < b; x++) zeichneSpalte(g, x, mitte, spalten(welle, x * proPixel, (x + 1) * proPixel), welle.gain);
  }
  for (const r of raster(beats)) {
    const x = Math.round((r.beat / beats) * b);
    g.fillStyle = r.eins ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)';
    g.fillRect(x, 0, r.eins ? Math.max(1, Math.round(dpr)) : 1, h);
    if (r.eins) {
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.font = `${Math.round(9 * dpr)}px sans-serif`;
      g.fillText(String(r.takt), x + 3 * dpr, 10 * dpr);
    }
  }
}

// Moving layer: the played part of the loop darkened, the playhead as a white line. pos = loopPosition() or null.
export function zeichneKopf(g, pos, beats, b, h, dpr = 1) {
  if (pos === null) return;
  const x = Math.round((pos / beats) * b);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 0, x, h);
  g.fillStyle = '#fff';
  g.fillRect(x - Math.round(dpr), 0, Math.max(2, Math.round(2 * dpr)), h);
}
