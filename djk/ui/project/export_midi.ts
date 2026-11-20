// MIDI file export of the workbench: the parts of a project in a range, per instrument track. Pure: project and range in, plain parts out.
//
// Playback rule (mirrored from project/playback.ts `noten()`, which is not exported): a MIDI clip is unrolled by `fuerAusgerollteNoten` (exported there and
// used here directly): copies of [0, loop_beats) up to laenge_beats, a note at or after loop_beats is silent; a transpose envelope moves the pitch, read at the
// note start in the clip, rounded and clamped to 0..127.
// Rows and note fields (chance, wdh, versatz, MidiClip.zeilen) are applied by the same unrolling, so the file holds what plays (chance: the same
// deterministic draws). A clip with effect commands (`fx`) is unrolled by `rolleFxAus` (GLD and RTG change its notes) and its pitch and level events
// become pitch bend and controller 11 (D21).
// Then the range: a note is kept when it sounds anywhere in [von, bis); it starts at its beat relative to `von` (never before 0) and ends at `bis`
// at the latest.
import { fuerAusgerollteNoten, fxEreignisse, fxRahmen, type GeraetFxFn } from './playback.ts';
import { rolleFxAus } from './fx_ausrollen.ts';
import { hkWert } from './envelope.ts';
import type { Note, Projekt } from './model.ts';
import type { SmfSchreibNote } from './smf.ts';

// bend / pegel (tracker effect commands, D21): only a Baukasten track with effects has them; beats relative to `von`, glides already cut into steps
export interface MidiTeil {
  spur_id: string; nr: number; name: string; noten: SmfSchreibNote[]; bend?: { beat: number; st: number }[]; pegel?: { beat: number; faktor: number }[];
  kanal: number   // MIDI channel 0..15: bend and controller 11 act on a whole channel, so every part gets its own; a drum kit takes channel 10 (9)
}
const TROMMEL_KANAL = 9;
/** The channel of the n-th melodic part: 0..15 without the drum channel, then the channels start again (such parts share a channel, see `kanalGeteilt`). */
export const melodiKanal = (n: number): number => { const k = n % 15; return k < TROMMEL_KANAL ? k : k + 1; };
/** True when a part with bend or level events shares its channel with another part (more than 15 melodic parts, or several kits): the other would bend too. */
export function kanalGeteilt(teile: readonly MidiTeil[]): boolean {
  return teile.some((t) => (t.bend?.length || t.pegel?.length) && teile.some((u) => u !== t && u.kanal === t.kanal));
}

// A list of [beat, value, glide beats] as the playback writes it becomes steps: a glide runs in steps of one effect tick (the last step exactly at the
// end of the glide) and stops where the next event starts. Of the result only the part inside [von, bis) stays; the value in force at `von` comes as a
// point at 0 when it is not the neutral one.
function schritte(l: readonly [number, number, number][], tick: number, von: number, bis: number, neutral: number): { beat: number; wert: number }[] {
  const punkte: { beat: number; wert: number }[] = [];
  let aktuell = neutral;
  l.forEach(([b, v, g], i) => {
    const naechste = i + 1 < l.length ? l[i + 1][0] : Infinity;
    if (!(g > 1e-9)) { punkte.push({ beat: b, wert: v }); aktuell = v; return; }
    const n = Math.max(1, Math.round(g / tick)), a = aktuell;
    for (let k = 1; k <= n; k++) {
      const t = b + g * k / n;
      if (t >= naechste - 1e-9) break;
      aktuell = a + (v - a) * k / n;
      punkte.push({ beat: t, wert: aktuell });
    }
  });
  const aus: { beat: number; wert: number }[] = [];
  let davor = neutral;
  for (const q of punkte) {
    if (q.beat < von) { davor = q.wert; continue; }
    if (q.beat < bis) aus.push({ beat: q.beat - von, wert: q.wert });
  }
  if (Math.abs(davor - neutral) > 1e-9 && !(aus.length && aus[0].beat <= 1e-9)) aus.unshift({ beat: 0, wert: davor });
  return aus;
}

export function midiTeile(p: Projekt, von: number, bis: number, gf?: GeraetFxFn): MidiTeil[] {
  const aus: MidiTeil[] = [];
  let melodisch = 0;
  for (const s of p.spuren) {
    if (s.mute) continue;
    const noten: SmfSchreibNote[] = [];
    for (const c of s.clips) {
      if (c.art !== 'midi') continue;
      const hk = c.huellkurven?.find((h) => h.ziel === 'transpose');
      const ruf = (_id: string, beat: number, laenge: number, n: Note): void => {
        const a = Math.max(beat, von), z = Math.min(beat + laenge, bis);
        if (!(z > a)) return;
        const ton = hk ? Math.min(127, Math.max(0, n.ton + Math.round(hkWert(hk, beat - c.start_beat, c.loop_beats)))) : n.ton;
        noten.push({ beat: a - von, laenge: z - a, ton, vel: n.vel });
      };
      if (c.fx?.length) rolleFxAus(c, fxRahmen(p, s, gf), ruf); else fuerAusgerollteNoten(c, ruf);   // GLD and RTG change the notes
    }
    if (!noten.length) continue;
    noten.sort((x, y) => x.beat - y.beat || x.ton - y.ton);
    const fx = fxEreignisse(p, s, gf);
    const r = fxRahmen(p, s), tick = 1 / (r.lpb * r.ticks);
    const bend = fx ? schritte(fx.bend, tick, von, bis, 0).map((q) => ({ beat: q.beat, st: q.wert })) : [];
    const pegel = fx ? schritte(fx.pegel, tick, von, bis, 1).map((q) => ({ beat: q.beat, faktor: q.wert })) : [];
    const trommel = s.geraet?.art === 'intern' && s.geraet.name === 'kit';
    aus.push({ spur_id: s.id, nr: s.nr, name: s.name, noten, kanal: trommel ? TROMMEL_KANAL : melodiKanal(melodisch++),
      ...(bend.length ? { bend } : {}), ...(pegel.length ? { pegel } : {}) });
  }
  return aus;
}

// file-name part of a track or return name: lower case, [a-z0-9-], every other run of characters becomes one `-`, no `-` at either end; empty becomes `track`
export function sicherName(name: string): string {
  const x = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return x === '' ? 'track' : x;
}
export const zweistellig = (n: number): string => String(n).padStart(2, '0');
