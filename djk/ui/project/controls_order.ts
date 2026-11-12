// Live container: the order of regulator rows around a playback load. The core swaps the playback at a block start and answers /k/arr/laden with
// receipt 3 after the swap (INTERFACES 4.11). Until then the OLD playback keeps sounding, so a row that makes something louder or resets a
// freed number (fader up, mute 1 to 0) must wait for that receipt, and so must the mute of a track that stays (the Loop track: the stems have to
// sound before it goes silent). Rows that only make something quieter go first. Flat projects never come here (their order stays as it was).
import type { ReglerAenderung } from './commands.ts';
import type { Projekt } from './model.ts';

export function teileReglerLive(alt: Projekt, zeilen: readonly ReglerAenderung[]): { vorher: ReglerAenderung[]; nachher: ReglerAenderung[] } {
  const vorher: ReglerAenderung[] = [], nachher: ReglerAenderung[] = [];
  for (const z of zeilen) (spaeter(alt, z) ? nachher : vorher).push(z);
  return { vorher, nachher };
}

function altWert(alt: Projekt, art: string, nr: number, k: string): number | null {   // null: nothing of the old state holds this number
  const x = art === 'spur' ? alt.spuren.find((s) => s.nr === nr) : alt.gruppen?.find((g) => g.nr === nr);
  if (!x) return null;
  return k === 'fader' ? x.fader_db : k === 'pan' ? x.pan : k === 'mute' ? (x.mute ? 1 : 0) : k === 'solo' ? (x.solo ? 1 : 0) : null;
}

function spaeter(alt: Projekt, z: ReglerAenderung): boolean {
  const m = /^(spur|grp)\/(\d+)\/(fader|pan|mute|solo)$/.exec(z.pfad);
  if (!m) return false;
  const k = m[3], v = altWert(alt, m[1], Number(m[2]), k);
  const alter = v ?? 0;                                                    // a free number holds the default (all 0)
  // strictly quieter goes first; equal rows (a reset of a freed number that already sits at 0) and louder rows wait
  if (k === 'fader') return z.wert >= alter;
  if (k === 'mute') return z.wert <= alter || v !== null;                   // unmute, or mute of a track that already sounds in the old playback
  if (k === 'solo') return z.wert <= alter;
  return false;
}
