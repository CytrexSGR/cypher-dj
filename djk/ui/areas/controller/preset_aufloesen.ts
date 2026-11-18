// Controller presets, the pure part: a preset (or the default bank) of a device model plus a base becomes learn entries. A control is found by its
// catalogue name (catalog.ts), its number comes from the catalogue and its channel is 0 (any channel), so the same preset works whichever port,
// program or custom mode sends it. Nothing here touches
// a file or the kern. Entries that cannot be resolved are skipped and listed with a reason:
//   regler_unbekannt  the device has no control of that name
//   ziel_ungueltig    the target is not assignable (a knob outside 1..64, a track slot above 8, an unknown path) or has no value for this kind of control
//   doppelt           the control appeared before in the same preset
//   ziel_vergeben     the target is already taken (by another entry of the preset or by a place resolved before this one)
import type { Regler } from './catalog.ts';
import { KATALOG } from './catalog.ts';
import { eintragsArt, zielArt } from '../learn/targets.ts';
import type { Neu } from '../learn/store.ts';
import type { Preset } from './preset_store.ts';

export interface Uebersprungen { regler: string; grund: 'regler_unbekannt' | 'ziel_ungueltig' | 'doppelt' | 'ziel_vergeben' }
export interface Aufgeloest { eintraege: Neu[]; uebersprungen: Uebersprungen[] }

const reglerVon = (modell: string): readonly Regler[] => KATALOG.find((k) => k.id === modell)?.regler ?? [];

/** The learn entry of a control on a target, or null when the control cannot drive the target. */
function eintrag(r: Regler, pfad: string, daw: boolean, stufen?: number): Neu | null {
  const art = zielArt(pfad);
  // Channel 0: any channel (core mapping, `kanal: 0`). Which channel a device sends on depends on its state (LPD8 program 1..4 = channel 1..4, the
  // custom mode of a Launch Control, its DAW port), and a place is one device on its own port, so a preset does not pin it. `daw` is kept for callers.
  void daw;
  const kanal = 0;
  // a button or pad with `stufen` on a continuous target steps it (a selector of the panel); without `stufen` it has no way to drive one
  if (art === 'regler' && r.art !== 'knob') return stufen === undefined ? null : { pfad, kanal, nr: r.nr, ...(r.typ === 'note' ? { typ: 'note' as const } : {}), art: 'taste', stufen };
  const e = art === null ? null : eintragsArt(art, r.typ);
  if (e === null) return null;
  return { pfad, kanal, nr: r.nr, ...(r.typ === 'note' ? { typ: 'note' as const } : {}), ...(e === 'taste' ? { art: 'taste' as const } : {}) };
}

/**
 * Resolve a preset. An `instrument` preset needs the base of the focus ("erz/5/bk/", "spur/3/bk/"); with a null base every entry is skipped as
 * ziel_ungueltig. A `fest` preset ignores the base. `ausser`: targets that are not available (given to another place before). `daw`: the place
 * reads the DAW port of the device. `seite`: the page of the synth's panel that is in front (instrument presets with `seiten`).
 */
export function loese(preset: Preset, basis: string | null, ausser: ReadonlySet<string> = new Set(), daw = false, seite: string | null = null, programm: number | null = null): Aufgeloest {
  const regler = reglerVon(preset.modell);
  const eintraege: Neu[] = [], uebersprungen: Uebersprungen[] = [];
  const gesehen = new Set<string>(), vergeben = new Set<string>(ausser);
  // the page of the panel that is in front picks its own entries of an instrument preset, when the preset has some for it
  // and a preset with programs gives the entries of the program in front (`programm`, 0-based), whatever the page
  const prog = preset.art === 'instrument' && programm !== null ? preset.programme?.[programm] : undefined;
  const liste = prog ? prog.eintraege : preset.art === 'instrument' && seite !== null && preset.seiten?.[seite] ? preset.seiten[seite] : preset.eintraege;
  for (const z of liste) {
    const r = regler.find((x) => x.name === z.regler);
    if (!r) { uebersprungen.push({ regler: z.regler, grund: 'regler_unbekannt' }); continue; }
    if (gesehen.has(z.regler)) { uebersprungen.push({ regler: z.regler, grund: 'doppelt' }); continue; }
    gesehen.add(z.regler);
    const pfad = 'knopf' in z ? (basis === null ? null : `${basis}${z.knopf}`) : z.pfad;
    const e = pfad === null ? null : eintrag(r, pfad, daw, 'knopf' in z ? z.stufen : undefined);
    if (!e) { uebersprungen.push({ regler: z.regler, grund: 'ziel_ungueltig' }); continue; }
    if (vergeben.has(e.pfad)) { uebersprungen.push({ regler: z.regler, grund: 'ziel_vergeben' }); continue; }
    vergeben.add(e.pfad);
    eintraege.push(e);
  }
  return { eintraege, uebersprungen };
}

/** The default bank: the knobs of the device in layout order (row by row) on knob 1, 2, 3 ... of the base. Buttons and pads are not part of it. */
export function bank(modell: string, basis: string, ausser: ReadonlySet<string> = new Set(), daw = false): Aufgeloest {
  const knoepfe = reglerVon(modell).filter((r) => r.art === 'knob').sort((a, b) => a.zeile - b.zeile || a.spalte - b.spalte);
  return loese({ schema: 1, name: 'bank', modell, art: 'instrument', graph: 'bank', eintraege: knoepfe.map((r, i) => ({ regler: r.name, knopf: i + 1 })) }, basis, ausser, daw);
}
