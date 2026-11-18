// SEQ scenes: the three commands that save, clear and launch a scene (project field `szenen`). A scene remembers which patterns are ON across all SEQ
// decks. Launching sets the mute of exactly those patterns in one command (one undo step); mute rows are regler-only, so playback is not reloaded.
// The page server sends szene_anwenden when the core has executed the mute rows at the bar; nothing here knows about time.
import { SZENEN_SLOTS, type Projekt, type Szene } from './model.ts';
import { seqFolgen } from './seq.ts';
import { ab, erlaube, zahl, type Args } from './commands_helpers.ts';

// Every pattern track of every SEQ deck of the project, in deck and track order.
function alleFolgen(p: Projekt): { id: string; mute: boolean }[] {
  return (p.gruppen ?? []).filter((g) => g.seq).flatMap((g) => seqFolgen(p, g).map((f) => ({ id: f.spur.id, mute: f.spur.mute })));
}

// The picture of the current M buttons: unmuted patterns are `an`, muted ones `aus`. The one place that saves "from the current picture".
export function szeneAusMutes(p: Projekt): Szene {
  const f = alleFolgen(p);
  return { an: f.filter((x) => !x.mute).map((x) => x.id), aus: f.filter((x) => x.mute).map((x) => x.id) };
}

const slotArg = (a: Args): number => zahl(a, 'slot', 0, SZENEN_SLOTS - 1, { ganz: true })!;
const idListe = (a: Args, k: string): string[] => {
  const l = a[k];
  if (!Array.isArray(l) || l.some((x) => typeof x !== 'string' || x === '')) ab('argument_ungueltig', `${k}: list of track ids expected`);
  return l as string[];
};
const leereSlots = (): (Szene | null)[] => Array.from({ length: SZENEN_SLOTS }, () => null);

export const SZENEN = {
  szene_speichern(p, a) {
    erlaube(a, 'slot', 'an', 'aus');
    const slot = slotArg(a), an = idListe(a, 'an'), aus = idListe(a, 'aus');
    const bekannt = new Set(alleFolgen(p).map((x) => x.id));
    const alle = [...an, ...aus];
    if (new Set(alle).size !== alle.length) ab('argument_ungueltig', 'an/aus: a track id appears twice');
    for (const id of alle) if (!bekannt.has(id)) ab('argument_ungueltig', `${id}: not a pattern of a SEQ deck`);
    p.szenen ??= leereSlots();
    p.szenen[slot] = { an: [...an], aus: [...aus] };
  },

  szene_loeschen(p, a) {
    erlaube(a, 'slot');
    const slot = slotArg(a);
    if (p.szenen) p.szenen[slot] = null;
  },

  // Sets the mute of the saved patterns; a pattern that no longer is one (deleted, moved out of a deck) is skipped, others are not touched.
  // `an` and `aus` (both or none) are the picture captured when the scene was pressed: the page server sends them so the model gets exactly the picture
  // the core got, whatever the slot holds by now. Without them the slot is read (hand and tests).
  szene_anwenden(p, a) {
    erlaube(a, 'slot', 'an', 'aus');
    const slot = slotArg(a);
    if ((a.an === undefined) !== (a.aus === undefined)) ab('argument_ungueltig', 'an and aus come together');
    const s: Szene = a.an !== undefined ? { an: idListe(a, 'an'), aus: idListe(a, 'aus') }
      : p.szenen?.[slot] ?? ab('szene_leer_slot', `slot ${slot} holds no scene`);
    const lebend = new Set(alleFolgen(p).map((x) => x.id));
    for (const sp of p.spuren) {
      if (!lebend.has(sp.id)) continue;
      if (s.an.includes(sp.id)) sp.mute = false;
      else if (s.aus.includes(sp.id)) sp.mute = true;
    }
  },
} satisfies Record<string, (p: Projekt, a: Args) => void>;
