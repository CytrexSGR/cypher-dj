// MIDI file export of the workbench: the parts of a project in a range, per instrument track. Pure: project and range in, plain parts out.
//
// Playback rule (mirrored from project/playback.ts `noten()`, which is not exported): a MIDI clip is unrolled by `fuerAusgerollteNoten` (exported there and
// used here directly): copies of [0, loop_beats) up to laenge_beats, a note at or after loop_beats is silent; a transpose envelope moves the pitch, read at the
// note start in the clip, rounded and clamped to 0..127.
// Rows and note fields (chance, wdh, versatz, MidiClip.zeilen) are applied by the same unrolling, so the file holds what plays (chance: the same deterministic draws).
// Then the range: a note is kept when it sounds anywhere in [von, bis); it starts at its beat relative to `von` (never before 0) and ends at `bis` at the latest.
import { fuerAusgerollteNoten } from './playback.ts';
import { hkWert } from './envelope.ts';
import type { Projekt } from './model.ts';
import type { SmfSchreibNote } from './smf.ts';

export interface MidiTeil { spur_id: string; nr: number; name: string; noten: SmfSchreibNote[] }

export function midiTeile(p: Projekt, von: number, bis: number): MidiTeil[] {
  const aus: MidiTeil[] = [];
  for (const s of p.spuren) {
    if (s.mute) continue;
    const noten: SmfSchreibNote[] = [];
    for (const c of s.clips) {
      if (c.art !== 'midi') continue;
      const hk = c.huellkurven?.find((h) => h.ziel === 'transpose');
      fuerAusgerollteNoten(c, (_id, beat, laenge, n) => {
        const a = Math.max(beat, von), z = Math.min(beat + laenge, bis);
        if (!(z > a)) return;
        const ton = hk ? Math.min(127, Math.max(0, n.ton + Math.round(hkWert(hk, beat - c.start_beat, c.loop_beats)))) : n.ton;
        noten.push({ beat: a - von, laenge: z - a, ton, vel: n.vel });
      });
    }
    if (!noten.length) continue;
    noten.sort((x, y) => x.beat - y.beat || x.ton - y.ton);
    aus.push({ spur_id: s.id, nr: s.nr, name: s.name, noten });
  }
  return aus;
}

// file-name part of a track or return name: lower case, [a-z0-9-], every other run of characters becomes one `-`, no `-` at either end; empty becomes `track`
export function sicherName(name: string): string {
  const x = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return x === '' ? 'track' : x;
}
export const zweistellig = (n: number): string => String(n).padStart(2, '0');
