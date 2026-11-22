// Session view commands (index 1.1, plan session-view M2/M3): the global launch grid, the hold slot and the scenes.
// The model rules (ranges, 8 scenes, ids) are checked by the model at the end of every command list; the handlers here check what a refusal
// needs a reason for. Playback is not touched here; launches are runtime only.
import { istHalten, neueId, istObjekt, zellFehler, ZELL_ZIELE, type ZellHuelle, type Zelle, sessionSzenen, LOOP_ZELLEN, LOOP_FARBEN, SZENEN_ZEILEN, SZENE_NAME_MAX, SZENE_TAKTE_MAX, TEMPO_MIN, TEMPO_MAX,
  type Projekt, type ZellSlot, type Spur, type SessionSzene } from './model.ts';
import { ab, erlaube, flagge, idArg, spurVon, zahl, type Args, type Handler } from './commands_helpers.ts';
import { rasterArg, setzeRaster, sessionAnlegen } from './commands_loopdeck.ts';

// The undo labels of the commands (the routes that send them use these texts). `szene_benennen` is the label of a rename (szene_aendern with a name only).
export const SESSION_LABEL = {
  session_aendern: 'Set launch grid', zelle_halten: 'Hold slot', szene_benennen: 'Name scene',
  szene_neu: 'Insert scene', szene_fangen: 'Capture scene', szene_doppeln: 'Duplicate scene', szene_loeschen: 'Delete scene', szene_aendern: 'Edit scene', zelle_huelle: 'Edit envelope',
} as const;

const imLive = (p: Projekt): void => { if (!p.live) ab('kein_liveprojekt', 'the session settings belong to the live container'); };
function deckSpur(p: Projekt, id: string): Spur & { zellen: ZellSlot[] } {
  const s = spurVon(p, id);
  return s.zellen !== undefined ? (s as Spur & { zellen: ZellSlot[] }) : ab('kein_loopdeck', `${id} is not a track of a loop deck`);
}


// --- Scene rows (D17): a scene command moves one row across every column and the scene list together -----------------------------
const deckSpuren = (p: Projekt): (Spur & { zellen: ZellSlot[] })[] => p.spuren.filter((s) => s.zellen !== undefined) as (Spur & { zellen: ZellSlot[] })[];
const standardLeer = (s: SessionSzene): boolean => s.name === '' && s.farbe === 0 && s.bpm === undefined && s.takte === undefined && s.folge === undefined;
const zeileArg = (a: Args, k: string): number => zahl(a, k, 1, SZENEN_ZEILEN, { ganz: true })!;
const nachArg = (a: Args): number => zahl(a, 'nach', 0, SZENEN_ZEILEN - 1, { ganz: true })!;
// Row 8 is in use when any column holds a cell or a hold slot there, or the scene has a name, colour, tempo, length or follow action.
function zeileAchtFrei(p: Projekt): boolean {
  return deckSpuren(p).every((s) => !s.zellen[SZENEN_ZEILEN - 1]) && standardLeer(sessionSzenen(p)[SZENEN_ZEILEN - 1]);
}
function pruefeFrei(p: Projekt): void {
  if (!zeileAchtFrei(p)) ab('zeilen_voll', 'All 8 rows are in use; 16 rows come with the next slice.');
}
// Inserts an empty row (a fresh default scene) after row `nach` (0 = at the top); the rows below move down, row 8 falls off (it was free).
export function zeilenVerschieben(p: Projekt, nach: number): void {
  const se = sessionAnlegen(p);
  for (const s of deckSpuren(p)) { s.zellen.splice(nach, 0, null); s.zellen.length = LOOP_ZELLEN; }
  se.szenen.splice(nach, 0, { id: neueId(p, 'szene'), name: '', farbe: 0 });
  se.szenen.length = SZENEN_ZEILEN;
}
// Removes row `zeile` (1-based); the rows below move up, row 8 becomes empty with a fresh default scene.
export function loescheSzene(p: Projekt, a: Args): void {
  erlaube(a, 'zeile');
  imLive(p);
  const z = zeileArg(a, 'zeile');
  const se = sessionAnlegen(p);
  for (const s of deckSpuren(p)) { s.zellen.splice(z - 1, 1); s.zellen.push(null); }
  se.szenen.splice(z - 1, 1);
  se.szenen.push({ id: neueId(p, 'szene'), name: '', farbe: 0 });
}
// A copy of a slot for another row: a cell gets a new id, a hold slot stays one.
function kopiere(p: Projekt, z: ZellSlot): ZellSlot {
  if (!z) return null;
  if (istHalten(z)) return { halten: true };
  return { ...(structuredClone(z) as Omit<NonNullable<typeof z>, 'id'>), id: neueId(p, 'zelle') } as ZellSlot;
}
function folgeArg(x: unknown): SessionSzene['folge'] {
  if (x === 'loop' || x === 'weiter' || x === 'stopp') return x;
  const s = typeof x === 'object' && x !== null ? (x as { sprung?: unknown }) : {};
  if (Object.keys(x as object ?? {}).length === 1 && typeof s.sprung === 'number' && Number.isInteger(s.sprung) && s.sprung >= 1 && s.sprung <= SZENEN_ZEILEN) return { sprung: s.sprung };
  return ab('argument_ungueltig', "folge: 'loop', 'weiter', 'stopp', { sprung: 1..8 } or null expected");
}

export const SESSION = {
  // Writes the global grid and the raster of every loop deck in one command (one undo step).
  session_aendern(p, a) {
    erlaube(a, 'raster');
    imLive(p);
    setzeRaster(p, rasterArg(a, false)!, true);
  },

  // An empty slot is `null` or `{ halten: true }`; a filled cell is refused either way.
  zelle_halten(p, a) {
    erlaube(a, 'spur_id', 'index', 'an');
    const s = deckSpur(p, idArg(a, 'spur_id'));
    const i = a.index;
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 1 || i > LOOP_ZELLEN) ab('argument_ungueltig', `index: integer 1..${LOOP_ZELLEN} expected`);
    const an = flagge(a, 'an')!;
    const z = s.zellen[(i as number) - 1];
    if (z && !istHalten(z)) ab('zelle_voll', `${s.id} cell ${i} holds a cell`);
    s.zellen[(i as number) - 1] = an ? { halten: true } : null;
  },

  // The envelope of one target of a cell (index 2.1): punkte replaces or adds it, null removes it. The cell stays valid: zellFehler refuses a bad one.
  zelle_huelle(p, a) {
    erlaube(a, 'spur_id', 'index', 'ziel', 'punkte');
    const s = deckSpur(p, idArg(a, 'spur_id'));
    const i = a.index;
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 1 || i > LOOP_ZELLEN) ab('argument_ungueltig', `index: integer 1..${LOOP_ZELLEN} expected`);
    const z = s.zellen[(i as number) - 1];
    if (!z || istHalten(z)) ab('zelle_leer', `${s.id} cell ${i} is empty`);
    const c = z as Zelle;
    const ziel = a.ziel;
    if (typeof ziel !== 'string' || !(ZELL_ZIELE as readonly string[]).includes(ziel)) ab('huelle_ungueltig', `ziel: ${ZELL_ZIELE.join(' | ')} expected`);
    if (a.punkte === undefined) ab('argument_ungueltig', 'punkte: list of points or null expected');
    const liste = (c.huellen ?? []).slice();
    const k = liste.findIndex((h) => h.ziel === ziel);
    if (a.punkte === null) {
      if (k < 0) ab('huelle_ungueltig', `the cell has no ${ziel} envelope`);
      liste.splice(k, 1);
    } else {
      if (!Array.isArray(a.punkte) || a.punkte.some((q) => !istObjekt(q))) ab('huelle_ungueltig', 'punkte: list of {beat, wert, form?} expected');
      const neu = { ziel, punkte: structuredClone(a.punkte) } as ZellHuelle;
      if (k < 0) liste.push(neu); else liste[k] = neu;
    }
    if (liste.length > 0) c.huellen = liste; else delete c.huellen;
    const f = zellFehler(c);
    if (f) ab(f.grund, f.text);
  },

  // Name, colour, tempo, length and follow action of one scene; null removes bpm, takte and folge.
  szene_aendern(p, a) {
    erlaube(a, 'zeile', 'name', 'farbe', 'bpm', 'takte', 'folge');
    imLive(p);
    const z = zeileArg(a, 'zeile');
    if (['name', 'farbe', 'bpm', 'takte', 'folge'].every((k) => a[k] === undefined)) ab('argument_ungueltig', 'nothing to change: name, farbe, bpm, takte or folge expected');
    const neu: Partial<SessionSzene> = {};
    if (a.name !== undefined) {
      if (typeof a.name !== 'string' || a.name.length > SZENE_NAME_MAX) ab('argument_ungueltig', `name: text with 0 to ${SZENE_NAME_MAX} characters expected`);
      neu.name = a.name;
    }
    if (a.farbe !== undefined) neu.farbe = zahl(a, 'farbe', 0, LOOP_FARBEN - 1, { ganz: true })!;
    const szene = sessionAnlegen(p).szenen[z - 1];
    Object.assign(szene, neu);
    if (a.bpm !== undefined) { if (a.bpm === null) delete szene.bpm; else szene.bpm = zahl(a, 'bpm', TEMPO_MIN, TEMPO_MAX)!; }
    if (a.takte !== undefined) { if (a.takte === null) delete szene.takte; else szene.takte = zahl(a, 'takte', 1, SZENE_TAKTE_MAX, { ganz: true })!; }
    if (a.folge !== undefined) { if (a.folge === null) delete szene.folge; else szene.folge = folgeArg(a.folge); }
  },

  // An empty row after row `nach` (0..7); every column and the scene list move together.
  szene_neu(p, a) {
    erlaube(a, 'nach');
    imLive(p);
    const nach = nachArg(a);
    pruefeFrei(p);
    zeilenVerschieben(p, nach);
  },

  // A new row after `nach` holding copies of the chosen cells: `zellen` maps a track id to the row (1..8) to copy from, or null for an empty slot.
  szene_fangen(p, a) {
    erlaube(a, 'nach', 'zellen');
    imLive(p);
    const nach = nachArg(a);
    const m = a.zellen;
    if (typeof m !== 'object' || m === null || Array.isArray(m)) ab('argument_ungueltig', 'zellen: object {track id: row 1..8 or null} expected');
    const quellen: [Spur & { zellen: ZellSlot[] }, number | null][] = Object.entries(m as Record<string, unknown>).map(([id, r]) => {
      const s = deckSpur(p, id);
      if (r === null) return [s, null];
      return [s, zahl({ r }, 'r', 1, LOOP_ZELLEN, { ganz: true })!];
    });
    pruefeFrei(p);
    const kopien = quellen.map(([s, r]) => [s, r === null ? null : kopiere(p, s.zellen[r - 1])] as const);
    zeilenVerschieben(p, nach);
    for (const [s, k] of kopien) s.zellen[nach] = k;
  },

  // A copy of row `zeile` right below it, with new cell ids and a new scene id.
  szene_doppeln(p, a) {
    erlaube(a, 'zeile');
    imLive(p);
    const z = zeileArg(a, 'zeile');
    pruefeFrei(p);
    const kopien = deckSpuren(p).map((s) => [s, kopiere(p, s.zellen[z - 1])] as const);
    const alt = sessionSzenen(p)[z - 1];
    zeilenVerschieben(p, z);
    for (const [s, k] of kopien) s.zellen[z] = k;
    if (z < SZENEN_ZEILEN) p.session!.szenen[z] = { ...structuredClone(alt), id: p.session!.szenen[z].id };
  },
} satisfies Record<string, Handler>;
