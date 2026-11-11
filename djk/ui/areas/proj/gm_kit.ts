// General MIDI drum layout for the MIDI import (docs/superpowers/specs/2026-11-10-midi-import.md).
// The kit track of the production arrangement plays a core kit (core/src/kit.cpp) whose sound numbers are MIDI note numbers 0..127. A standard MIDI file
// addresses drums by the GM percussion map (notes 35 to 81), so the import needs a kit whose note N is the GM sound N. No such kit ships, but the
// existing `techno` kit has every family a GM kit needs (kick, snare, rim, clap, hats, toms, cymbals, percussion). This module builds the kit `gm` from it:
// a new folder next to the others in the kit folder, the sound files copied (never moved, the source kit is not touched), kit.json written last.
// The sounds are electronic stand-ins, not GM-accurate samples; the layout (which note triggers which family) is what follows the GM map.
// Pure file work, no project, no core.
import fs from 'node:fs';
import path from 'node:path';
import { KIT_NAME } from '../../project/model.ts';
import { kitsOrdnerVorgabe } from '../../paths.ts';

export const GM_KIT_NAME = 'gm';
export const GM_QUELLKIT = 'techno';
export const GM_NOTEN_VON = 35;
export const GM_NOTEN_BIS = 81;

// GM percussion note -> `<family>:<index>` of the source kit (names as the source kit.json prints them)
export const GM_BELEGUNG: Readonly<Record<number, string>> = {
  35: 'bd:1', 36: 'bd:0', 37: 'rim:0', 38: 'sd:0', 39: 'cp:0', 40: 'sd:1', 41: 'lt:0', 42: 'hh:0', 43: 'lt:1', 44: 'hh:1', 45: 'mt:0', 46: 'oh:0',
  47: 'mt:1', 48: 'ht:0', 49: 'cr:0', 50: 'ht:1', 51: 'rd:0', 52: 'cr:1', 53: 'rd:1', 54: 'sh:0', 55: 'cr:2', 56: 'perc:0', 57: 'cr:3', 58: 'perc:1',
  59: 'rd:2', 60: 'perc:2', 61: 'perc:3', 62: 'perc:4', 63: 'perc:5', 64: 'lt:2', 65: 'ht:2', 66: 'mt:2', 67: 'perc:0', 68: 'perc:1', 69: 'sh:1',
  70: 'sh:2', 71: 'hh:3', 72: 'hh:4', 73: 'rim:1', 74: 'rim:2', 75: 'rim:3', 76: 'rim:4', 77: 'perc:2', 78: 'perc:3', 79: 'perc:4', 80: 'sh:3', 81: 'perc:5',
};

export interface GmKit { name: string; noten: Set<number>; neu: boolean }

interface KitKlangJson { note: number; name?: string; datei: string; frames: number }
function leseKitJson(ordner: string): KitKlangJson[] | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ordner, 'kit.json'), 'utf8')) as { schema?: unknown; klaenge?: unknown };
    if (j.schema !== 1 || !Array.isArray(j.klaenge)) return null;
    const k = j.klaenge as KitKlangJson[];
    return k.every((x) => Number.isInteger(x?.note) && typeof x.datei === 'string' && Number.isInteger(x.frames) && x.frames > 0) ? k : null;
  } catch { return null; }
}

/** the GM notes a kit folder entry covers (null = no valid kit of that name) */
export function gmNotenVon(wurzel: string, name: string): Set<number> | null {
  if (!KIT_NAME.test(name)) return null;
  const k = leseKitJson(path.join(wurzel, name));
  return k === null ? null : new Set(k.map((x) => x.note));
}

/**
 * The kit to use for channel-10 parts: an existing kit `gm` if the kit folder holds one (the user's own wins), else one built from `techno`.
 * null when neither exists (the import then keeps the drum parts without a sound and says so). Never throws on a missing or broken source kit.
 */
export function sorgeFuerGmKit(wurzel: string = kitsOrdnerVorgabe()): GmKit | null {
  const da = gmNotenVon(wurzel, GM_KIT_NAME);
  if (da !== null) return { name: GM_KIT_NAME, noten: da, neu: false };
  const quelle = path.join(wurzel, GM_QUELLKIT);
  const q = leseKitJson(quelle);
  if (q === null) return null;
  const nachName = new Map(q.map((k) => [k.name ?? '', k]));
  const klaenge: { note: number; name: string; datei: string; frames: number }[] = [];
  for (let note = GM_NOTEN_VON; note <= GM_NOTEN_BIS; note++) {
    const k = nachName.get(GM_BELEGUNG[note]);
    if (!k || !/^[A-Za-z0-9_.-]{5,64}$/.test(k.datei) || !fs.existsSync(path.join(quelle, k.datei))) return null;   // an incomplete source: no half kit
    klaenge.push({ note, name: GM_BELEGUNG[note], datei: k.datei, frames: k.frames });
  }
  const ziel = path.join(wurzel, GM_KIT_NAME);
  const tmp = path.join(wurzel, `.${GM_KIT_NAME}.tmp-${process.pid}`);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp);
    for (const d of new Set(klaenge.map((k) => k.datei))) fs.copyFileSync(path.join(quelle, d), path.join(tmp, d));
    fs.writeFileSync(path.join(tmp, 'kit.json'), `${JSON.stringify({ schema: 1, name: GM_KIT_NAME, klaenge }, null, 1)}\n`);
    fs.renameSync(tmp, ziel);
  } catch {
    fs.rmSync(tmp, { recursive: true, force: true });
    const nun = gmNotenVon(wurzel, GM_KIT_NAME);          // a parallel call may have won the rename
    return nun === null ? null : { name: GM_KIT_NAME, noten: nun, neu: false };
  }
  return { name: GM_KIT_NAME, noten: new Set(klaenge.map((k) => k.note)), neu: true };
}

/**
 * Read-only view for the preview: the kit the import would use, without building anything. `neu` says the kit would be built from `techno` at import.
 * null = no GM kit can be had.
 */
export function gmKitVorschau(wurzel: string = kitsOrdnerVorgabe()): GmKit | null {
  const da = gmNotenVon(wurzel, GM_KIT_NAME);
  if (da !== null) return { name: GM_KIT_NAME, noten: da, neu: false };
  const q = leseKitJson(path.join(wurzel, GM_QUELLKIT));
  if (q === null) return null;
  const namen = new Set(q.map((k) => k.name ?? ''));
  for (let note = GM_NOTEN_VON; note <= GM_NOTEN_BIS; note++) if (!namen.has(GM_BELEGUNG[note])) return null;
  const noten = new Set<number>();
  for (let note = GM_NOTEN_VON; note <= GM_NOTEN_BIS; note++) noten.add(note);
  return { name: GM_KIT_NAME, noten, neu: true };
}

/** Takes back the kit folder this process built a moment ago (`neu: true`) when the import was refused. Call it only for a kit that was built here. */
export function nimmGmKitZurueck(wurzel: string = kitsOrdnerVorgabe()): void {
  fs.rmSync(path.join(wurzel, GM_KIT_NAME), { recursive: true, force: true });
}
