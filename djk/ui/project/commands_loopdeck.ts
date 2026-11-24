// Loop deck commands (index 1.1, plan loop-deck M2): create a deck (placed by `plaetze`), set its grid, clear it, and
// set, change and move cells. A deck is a live-container group `LOOP <platz>` (marker `loopdeck`) with 4 audio tracks `L<platz>.1..4`, each with 8 cells.
// The model rules (ids, ranges, who may carry cells) are checked by the model at the end of every command list; the handlers here check what a
// refusal needs a reason for. Playback is not touched here (the translator reads the cells).
import {
  LOOP_RASTER_BEATS, LOOP_ZELLEN, ersterFreierPlatz,
  LOOP_SEND_MAX, FADER_MIN, sessionSzenen, MAX_INSERTS_PRO_STRANG, LOOP_SPUREN, LOOP_FARBEN, istObjekt, loopDeckGruppe,
  loopDeckSpuren, neueId, istHalten, zellFehler, TEMPO_MIN, TEMPO_MAX,
  type Gruppe, type LoopRaster, type Projekt, type SessionEinstellung, type Spur, type Zelle, type ZellSlot,
} from './model.ts';
import { ab, erlaube, flagge, gruppeVon, idArg, PRO_BEFEHL, spurVon, text, zahl, type Args, type Handler, type Kontext } from './commands_helpers.ts';

// The undo labels of the commands (the routes that send them use these texts)
// The deck group `LOOP <platz>` with its four tracks, marker and cells; no place is written here (the caller places it). `platz` is the identity 1|2.
export function legeLoopdeckAn(p: Projekt, platz: 1 | 2, raster: LoopRaster, ctx: Kontext): Gruppe {
  const ids: string[] = [];
  for (let i = 1; i <= LOOP_SPUREN; i++) {
    PRO_BEFEHL.spur_neu(p, { befehl: 'spur_neu', art: 'audio', name: `L${platz}.${i}` }, ctx);
    ids.push(p.spuren[p.spuren.length - 1].id);
  }
  PRO_BEFEHL.gruppenspur_neu(p, { befehl: 'gruppenspur_neu', name: `LOOP ${platz}`, mitglieder: ids }, ctx);
  const g = p.gruppen![p.gruppen!.length - 1];
  g.loopdeck = { platz, raster };
  // `filter: 0` and the eq zeros are written so the first knob drag is a replace (only replaces coalesce in the history)
  for (const id of ids) { const s = spurVon(p, id); s.zellen = keineZellen(); s.filter = 0; s.eq = { tief: 0, mitte: 0, hoch: 0 }; }
  return g;
}

export const LOOPDECK_LABEL = {
  loopdeck_neu: 'New loop deck', loopdeck_leeren: 'Clear loop deck', zelle_setzen: 'Set cell', zelle_aendern: 'Change cell', zelle_bewegen: 'Move cell',
  loopdeck_aendern: 'Loop deck grid', loopdeck_send: 'Loop deck send', loopdeck_effekt: 'Loop deck effect',
} as const;

// The HALL and DELAY return of a deck (index 1.3): a short room and a dotted 1/8 delay with feedback 0.35 (graph knob 1 0..0.9, knob 2 level 0..2)
export const LOOP_HALL = { decay: 0.25, groesse: 0.15, pre: 0, highcut: 0.7 } as const;   // merged over HALL_VORGABE by return_neu
export const LOOP_DELAY = { graph: 'fx-delay-sync', werte: { k1: 0.3889, k2: 0.5 } } as const;
// A shortened cell loses what lies beyond its new length in the same command: envelope points at or after it (an envelope without a point goes with them)
// and slots that start at or after it. Entries of `folge` that pointed at a dropped slot play their own slot instead.
function kuerzeZelle(z: Zelle): void {
  const beats = z.beats!;
  if (z.huellen) {
    z.huellen = z.huellen.map((h) => ({ ...h, punkte: h.punkte.filter((q) => q.beat < beats) })).filter((h) => h.punkte.length > 0);
    if (z.huellen.length === 0) delete z.huellen;
  }
  if (z.scheiben) {
    const n = z.scheiben.grenzen.filter((g) => g < beats).length;
    if (n < z.scheiben.grenzen.length) {
      z.scheiben = { teilung: z.scheiben.teilung, grenzen: z.scheiben.grenzen.slice(0, n), folge: z.scheiben.folge.slice(0, n).map((f,
        k) => (f <= n ? f : k + 1)) };
    }
  }
}
const RASTER = Object.keys(LOOP_RASTER_BEATS) as LoopRaster[];
const ZELLE_FELDER = ['name', 'farbe', 'art', 'sha256', 'beats', 'bpm', 'gain_db', 'pfad_hinweis', 'transponieren', 'rueckwaerts', 'blende', 'scheiben',
  'keylock', 'huellen'];
// the S1b editor fields of zelle_aendern (each null removes it; the rest is checked by zellFehler)
const ZELLE_EDITOR = ['transponieren', 'rueckwaerts', 'blende', 'scheiben', 'keylock'] as const;
const keineZellen = (): ZellSlot[] => Array.from({ length: LOOP_ZELLEN }, () => null);

export function rasterArg(a: Args, opt: boolean): LoopRaster | undefined {
  const r = a.raster;
  if (r === undefined && opt) return undefined;
  if (typeof r !== 'string' || !RASTER.includes(r as LoopRaster)) ab('argument_ungueltig', `raster: one of ${RASTER.join(' ')} expected`);
  return r as LoopRaster;
}
// The session settings of a live project, written with the first session command: the global grid and the 8 default scenes.
export function sessionAnlegen(p: Projekt): SessionEinstellung {
  p.session ??= { raster: 'takt', szenen: structuredClone(sessionSzenen(p)) };
  return p.session;
}
// One grid for the project (session view M1): the global grid and the `raster` of every loop deck are written together. The session block is
// written only when it already exists or the grid differs from the default (or `schreibe`: the session command itself), so a deck write that
// changes nothing adds nothing.
export function setzeRaster(p: Projekt, raster: LoopRaster, schreibe = false): void {
  if (schreibe || p.session || raster !== 'takt') sessionAnlegen(p).raster = raster;
  for (const platz of [1, 2] as const) { const g = loopDeckGruppe(p, platz); if (g?.loopdeck) g.loopdeck.raster = raster; }
}
function deckGruppe(p: Projekt, id: string): Gruppe {
  const g = gruppeVon(p, id);
  return g.loopdeck ? g : ab('kein_loopdeck', `${id} holds no loop deck`);
}
function deckSpur(p: Projekt, id: string): Spur & { zellen: ZellSlot[] } {
  const s = spurVon(p, id);
  return s.zellen !== undefined ? (s as Spur & { zellen: ZellSlot[] }) : ab('kein_loopdeck', `${id} is not a track of a loop deck`);
}
const indexArg = (x: unknown, k: string): number => {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < 1 || x > LOOP_ZELLEN) ab('argument_ungueltig', `${k}: integer 1..${LOOP_ZELLEN} expected`);
  return x as number;
};
function stelleArg(x: unknown, k: string): { spur_id: string; index: number } {
  if (!istObjekt(x)) return ab('argument_ungueltig', `${k}: {spur_id, index} expected`);
  erlaube(x as Args, 'spur_id', 'index');
  return { spur_id: idArg(x as Args, 'spur_id'), index: indexArg(x.index, `${k}.index`) };
}

// the place of the deck a track belongs to
const deckPlatz = (p: Projekt, s: Spur): 1 | 2 => (p.gruppen ?? []).find((g) => g.id === s.ausgang?.id)?.loopdeck?.platz
  ?? ab('kein_loopdeck', `${s.id} is not a track of a loop deck`);

export const LOOPDECK = {
  // `platz` is the deck identity (1 or 2), not a place. The deck takes the first `leer` or `track` place scanning 3, 4, 1, 2; with none free it is
  // created parked (silent, nothing is displaced). platz_setzen loops places or moves it later.
  loopdeck_neu(p, a, ctx) {
    erlaube(a, 'platz', 'raster');
    if (!p.live) ab('kein_liveprojekt', 'a loop deck sits in the live container');
    const platz = a.platz;
    if (platz !== 1 && platz !== 2) ab('argument_ungueltig', 'platz: 1 or 2 expected');
    const gegeben = rasterArg(a, true);
    if (loopDeckGruppe(p, platz)) ab('platz_belegt', `place ${platz} already holds a loop deck`);
    // one grid: a new deck takes the session grid, else the other deck's; an explicit raster is the grid of the whole project
    const andere = loopDeckGruppe(p, platz === 1 ? 2 : 1)?.loopdeck?.raster;
    const g = legeLoopdeckAn(p, platz, gegeben ?? p.session?.raster ?? andere ?? 'takt', ctx);
    if (gegeben) setzeRaster(p, gegeben);
    const ort = ersterFreierPlatz(p);
    if (ort !== null) p.plaetze![ort - 1] = { typ: 'loops', gruppe: g.id };
  },

  loopdeck_aendern(p, a) {
    erlaube(a, 'gruppe_id', 'raster');
    const g = deckGruppe(p, idArg(a, 'gruppe_id'));
    setzeRaster(p, rasterArg(a, false)!);   // the one grid: both decks and the session grid
  },

  loopdeck_leeren(p, a) {
    erlaube(a, 'gruppe_id');
    const g = deckGruppe(p, idArg(a, 'gruppe_id'));
    for (const s of loopDeckSpuren(p, g)) s.zellen = keineZellen();
  },

  zelle_setzen(p, a) {
    erlaube(a, 'spur_id', 'index', 'zelle');
    const s = deckSpur(p, idArg(a, 'spur_id'));
    const i = indexArg(a.index, 'index') - 1;
    const z = a.zelle;
    if (z === null) { s.zellen[i] = null; return; }
    if (!istObjekt(z)) ab('argument_ungueltig', 'zelle: object or null expected');
    for (const k of Object.keys(z)) if (!ZELLE_FELDER.includes(k)) ab('argument_unbekannt', `zelle.${k}`);
    // the model's own checks refuse a malformed cell at the end of the command list
    s.zellen[i] = null;   // a replaced cell gives its id back before the new one is numbered
    s.zellen[i] = { id: neueId(p, 'zelle'), ...(structuredClone(z) as Omit<Zelle, 'id'>) };
    const f = zellFehler(s.zellen[i] as Zelle);   // the S1b fields: refuse here what the core loader would refuse (the model check stays the net)
    if (f) ab(f.grund, f.text);
  },

  zelle_aendern(p, a) {
    erlaube(a, 'spur_id', 'index', 'name', 'farbe', 'art', 'gain_db', 'beats', 'raster', 'bpm', 'transponieren', 'rueckwaerts', 'blende', 'scheiben',
      'keylock');
    const s = deckSpur(p, idArg(a, 'spur_id'));
    const i = indexArg(a.index, 'index') - 1;
    if (['name', 'farbe', 'art', 'gain_db', 'beats', 'raster', 'bpm', ...ZELLE_EDITOR].every((k) => a[k] === undefined)) ab('argument_ungueltig',
      'no change given');
    const z = s.zellen[i];
    if (!z || istHalten(z)) ab('zelle_leer', `${s.id} cell ${i + 1} is empty`);
    const name = text(a, 'name', 64);
    const farbe = zahl(a, 'farbe', 0, LOOP_FARBEN - 1, { opt: true, ganz: true });
    const gain = zahl(a, 'gain_db', -60, 12, { opt: true });
    const beats = zahl(a, 'beats', 0.25, 64, { opt: true });
    const bpm = a.bpm === null ? null : zahl(a, 'bpm', TEMPO_MIN, TEMPO_MAX, { opt: true });   // null removes the source tempo (a one-shot only)
    const zellRaster = a.raster === null ? null : rasterArg(a, true);   // null removes the cell's own grid
    if (a.art !== undefined && a.art !== 'loop' && a.art !== 'einmal') ab('argument_ungueltig', "art: 'loop' or 'einmal' expected");
    if (beats !== undefined && !Number.isInteger(beats * 4)) ab('argument_ungueltig', 'beats: a multiple of 0.25 expected');
    const n = z!;
    if (name !== undefined) n.name = name;
    if (farbe !== undefined) n.farbe = farbe;
    if (a.art !== undefined) n.art = a.art;
    if (gain !== undefined) n.gain_db = gain;
    if (beats !== undefined) { n.beats = beats; kuerzeZelle(n); }
    if (bpm === null) delete (n as Zelle).bpm;
    else if (bpm !== undefined) n.bpm = bpm;
    if (zellRaster === null) delete (n as Zelle).raster;
    else if (zellRaster !== undefined) (n as Zelle).raster = zellRaster;
    // the editor fields: null removes; the value that means "default" (0 semitones, true keylock, false flag) removes too; anything else is stored as given
    // and checked by zellFehler below, which refuses a malformed value with its reason
    const w = n as unknown as Record<string, unknown>;
    for (const k of ZELLE_EDITOR) {
      const v = a[k];
      if (v === undefined) continue;
      if (v === null || (k === 'transponieren' && v === 0) || (k === 'keylock' && v === true) || ((k === 'rueckwaerts' || k === 'blende') &&
        v === false)) delete w[k];
      else w[k] = structuredClone(v);
    }
    const f = zellFehler(n as Zelle);
    if (f) ab(f.grund, f.text);
  },

  zelle_bewegen(p, a) {
    erlaube(a, 'von', 'nach');
    const von = stelleArg(a.von, 'von'), nach = stelleArg(a.nach, 'nach');
    const sv = deckSpur(p, von.spur_id), sn = deckSpur(p, nach.spur_id);
    const iv = von.index - 1, in_ = nach.index - 1;
    const z = sv.zellen[iv];
    if (!z || istHalten(z)) ab('zelle_leer', `${sv.id} cell ${von.index} is empty`);
    if (sv === sn && iv === in_) return;
    sv.zellen[iv] = sn.zellen[in_];   // swap (a null target just leaves the source empty)
    sn.zellen[in_] = z!;
  },

  // Sets the send of a deck track into the HALL or DELAY return of its deck; the return is created on first use (db above -200), all in this one command.
  loopdeck_send(p, a, ctx) {
    erlaube(a, 'spur_id', 'ziel', 'db');
    const s = deckSpur(p, idArg(a, 'spur_id'));
    const ziel = a.ziel;
    if (ziel !== 'hall' && ziel !== 'delay') return ab('argument_ungueltig', "ziel: 'hall' or 'delay' expected");
    const db = zahl(a, 'db', FADER_MIN, LOOP_SEND_MAX)!;
    const platz = deckPlatz(p, s);
    const deck = loopDeckGruppe(p, platz)!;
    let r = (p.returns ?? []).find((x) => x.loopdeck?.platz === platz && x.loopdeck.art === ziel);
    if (!r) {
      if (db <= FADER_MIN) return;                                   // no send and no return: nothing to do
      const vorher = new Set((p.returns ?? []).map((x) => x.id));
      PRO_BEFEHL.return_neu(p, ziel === 'hall'
        ? { befehl: 'return_neu', name: `L${platz} HALL`, gruppe_id: deck.id, hall: { ...LOOP_HALL } }
        : { befehl: 'return_neu', name: `L${platz} DLY`, gruppe_id: deck.id, effekt: { graph: LOOP_DELAY.graph, werte: { ...LOOP_DELAY.werte } } }, ctx);
      r = p.returns!.find((x) => !vorher.has(x.id))!;
      r.loopdeck = { platz, art: ziel };
    }
    PRO_BEFEHL.send_setzen(p, { befehl: 'send_setzen', strang_id: s.id, return_id: r.id, db }, ctx);
  },
  // The effect slot of a deck track = its first bk stage (index 1.4). `graph` sets (appended at the chain end) or replaces it in place, '' removes it;
  // `an` switches it. One command, so one undo step; the pool and chain limits are those of insert_setzen (ins_voll, kette_voll).
  loopdeck_effekt(p, a, ctx) {
    erlaube(a, 'spur_id', 'graph', 'an');
    const s = deckSpur(p, idArg(a, 'spur_id'));
    if ((a.graph === undefined) === (a.an === undefined)) return ab('argument_ungueltig', 'exactly one of graph and an expected');
    const pos = (s.inserts ?? []).findIndex((i) => i.art === 'bk');
    if (a.an !== undefined) {
      if (pos < 0) return ab('argument_ungueltig', 'no effect on this track');
      return PRO_BEFEHL.insert_an(p, { befehl: 'insert_an', insert_id: s.inserts![pos].id, an: flagge(a, 'an')! }, ctx);
    }
    if (typeof a.graph !== 'string') return ab('argument_ungueltig', 'graph: an effect graph name or an empty string expected');
    if (a.graph === '') {
      if (pos >= 0) PRO_BEFEHL.insert_entfernen(p, { befehl: 'insert_entfernen', insert_id: s.inserts![pos].id }, ctx);
      return;
    }
    // pos would be out of range first
    if (pos < 0 && (s.inserts?.length ?? 0) >= MAX_INSERTS_PRO_STRANG) ab('kette_voll', `all ${MAX_INSERTS_PRO_STRANG} stages of ${s.id} are used`);
    PRO_BEFEHL.insert_setzen(p, pos >= 0
      ? { befehl: 'insert_setzen', strang_id: s.id, pos, art: 'bk', graph: a.graph, ersetzen: true }
      : { befehl: 'insert_setzen', strang_id: s.id, pos: (s.inserts ?? []).length, art: 'bk', graph: a.graph }, ctx);
  },
} satisfies Record<string, Handler>;
