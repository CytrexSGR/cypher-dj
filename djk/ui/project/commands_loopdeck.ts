// Loop deck commands (index 1.1, plan loop-deck M2): create a deck (turning a module of the same place into cell 1), set its grid, clear it, and
// set, change and move cells. A deck is a live-container group `LOOP <platz>` (marker `loopdeck`) with 4 audio tracks `L<platz>.1..4`, each with 8 cells.
// The model rules (ids, ranges, who may carry cells) are checked by the model at the end of every command list; the handlers here check what a
// refusal needs a reason for. Playback is not touched here (the translator reads the cells).
import path from 'node:path';
import {
  LOOP_RASTER_BEATS, LOOP_ZELLEN, loopDjNr,
  LOOP_SEND_MAX, FADER_MIN, MAX_INSERTS_PRO_STRANG, LOOP_SPUREN, LOOP_FARBEN, TEMPO_MIN, TEMPO_MAX, istObjekt, loopDeckGruppe,
  loopDeckSpuren, neueId,
  type Gruppe, type LoopRaster, type Projekt, type Spur, type Zelle,
} from './model.ts';
import { LOOP_SPUR, liveSlots } from './live.ts';
import { ab, erlaube, flagge, gruppeVon, idArg, PRO_BEFEHL, spurVon, text, zahl, type Args, type Handler } from './commands_helpers.ts';

// The undo labels of the commands (the routes that send them use these texts)
export const LOOPDECK_LABEL = {
  loopdeck_neu: 'New loop deck', loopdeck_leeren: 'Clear loop deck', zelle_setzen: 'Set cell', zelle_aendern: 'Change cell', zelle_bewegen: 'Move cell',
  loopdeck_aendern: 'Loop deck grid', loopdeck_plaetze: 'Loop deck places', loopdeck_send: 'Loop deck send', loopdeck_effekt: 'Loop deck effect',
} as const;

// The HALL and DELAY return of a deck (index 1.3): a short room and a dotted 1/8 delay with feedback 0.35 (graph knob 1 0..0.9, knob 2 level 0..2)
export const LOOP_HALL = { decay: 0.25, groesse: 0.15, pre: 0, highcut: 0.7 } as const;   // merged over HALL_VORGABE by return_neu
export const LOOP_DELAY = { graph: 'fx-delay-sync', werte: { k1: 0.3889, k2: 0.5 } } as const;
const RASTER = Object.keys(LOOP_RASTER_BEATS) as LoopRaster[];
const ZELLE_FELDER = ['name', 'farbe', 'art', 'sha256', 'beats', 'bpm', 'gain_db', 'pfad_hinweis'];
const keineZellen = (): (Zelle | null)[] => Array.from({ length: LOOP_ZELLEN }, () => null);

function rasterArg(a: Args, opt: boolean): LoopRaster | undefined {
  const r = a.raster;
  if (r === undefined && opt) return undefined;
  if (typeof r !== 'string' || !RASTER.includes(r as LoopRaster)) ab('argument_ungueltig', `raster: one of ${RASTER.join(' ')} expected`);
  return r as LoopRaster;
}
function deckGruppe(p: Projekt, id: string): Gruppe {
  const g = gruppeVon(p, id);
  return g.loopdeck ? g : ab('kein_loopdeck', `${id} holds no loop deck`);
}
function deckSpur(p: Projekt, id: string): Spur & { zellen: (Zelle | null)[] } {
  const s = spurVon(p, id);
  return s.zellen !== undefined ? (s as Spur & { zellen: (Zelle | null)[] }) : ab('kein_loopdeck', `${id} is not a track of a loop deck`);
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

// The cell a module's main loop becomes (M5): the Loop track of the module group and its loop clip (not the lead-in: that one has a warp offset).
// beats and bpm come from the clip's warp (the markers map the source seconds to beats); the module's own numbers are the fallback.
function zelleAusModul(p: Projekt, g: Gruppe, ordner?: string): Omit<Zelle, 'id'> {
  const nein = (grund: string): never => ab('modul_nicht_umwandelbar', `the module ${g.id} cannot become a cell: ${grund}; it is left untouched`);
  const spur = p.spuren.find((s) => s.ausgang?.id === g.id && s.name === LOOP_SPUR);
  if (!spur) return nein('it has no Loop track');
  const clips = spur.clips.flatMap((c) => (c.art === 'audio' ? [c] : []));
  const clip = clips.find((c) => !c.warp?.versatz_beats) ?? clips[0];
  if (!clip || !g.modul) return nein('its Loop track holds no audio clip');
  const m = g.modul;
  const ende = clip.warp?.marker?.at(-1);
  const viertel = (b: number): boolean => Number.isFinite(b) && b >= 0.25 && b <= 64 && Number.isInteger(b * 4);
  if (ende && Number.isFinite(ende[1]) && ende[1] > 64) return nein(`its loop is ${ende[1]} beats long (a cell holds at most 64)`);
  if (!ende && Number.isFinite(m.laenge_beats) && m.laenge_beats > 64) return nein(`its loop is ${m.laenge_beats} beats long (a cell holds at most 64)`);
  const beats = ende && viertel(ende[1]) ? ende[1] : viertel(m.laenge_beats) ? m.laenge_beats : null;
  if (beats === null) return nein('its loop length is not a multiple of a quarter beat between 0.25 and 64');
  const roh = ende && ende[0] > 0 ? (ende[1] * 60) / ende[0] : m.basis_bpm;
  const bpm = Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, Number.isFinite(roh) ? roh : m.basis_bpm));
  // the module export writes an absolute path inside the project folder (areas/live/export.ts legeAb): the cell keeps it project-relative
  let hinweis = clip.quelle.pfad_hinweis;
  if (ordner !== undefined && path.isAbsolute(hinweis)) {
    const r = path.relative(ordner, hinweis);
    if (r !== '' && !r.startsWith('..') && !path.isAbsolute(r)) hinweis = r.split(path.sep).join('/');
  }
  const relativ = hinweis !== '' && !hinweis.startsWith('/') && !hinweis.includes('\\') && !hinweis.includes('\0')
    && !hinweis.split('/').some((t) => t === '..' || t === '');
  return { name: (m.titel.trim() || g.name).slice(0, 64), farbe: 0, art: 'loop', sha256: clip.quelle.sha256, beats, bpm,
    gain_db: Math.min(12, Math.max(-60, clip.gain_db)), ...(relativ ? { pfad_hinweis: hinweis } : {}) };
}

// Removes a group with everything that plays into it (tracks, sub-groups), deepest first.
function entferneBaum(p: Projekt, gruppeId: string, ctx: Parameters<Handler>[2]): void {
  const kinder = (p.gruppen ?? []).filter((x) => x.ausgang?.id === gruppeId).map((x) => x.id);
  for (const k of kinder) entferneBaum(p, k, ctx);
  for (const s of p.spuren.filter((x) => x.ausgang?.id === gruppeId)) PRO_BEFEHL.spur_loeschen(p, { befehl: 'spur_loeschen', spur_id: s.id }, ctx);
  PRO_BEFEHL.gruppenspur_loeschen(p, { befehl: 'gruppenspur_loeschen', gruppe_id: gruppeId }, ctx);
}

// the place of the deck a track belongs to
const deckPlatz = (p: Projekt, s: Spur): 1 | 2 => (p.gruppen ?? []).find((g) => g.id === s.ausgang?.id)?.loopdeck?.platz
  ?? ab('kein_loopdeck', `${s.id} is not a track of a loop deck`);

export const LOOPDECK = {
  loopdeck_neu(p, a, ctx) {
    erlaube(a, 'platz', 'raster');
    if (!p.live) ab('kein_liveprojekt', 'a loop deck sits in the live container');
    const platz = a.platz;
    if (platz !== 1 && platz !== 2) ab('argument_ungueltig', 'platz: 1 or 2 expected');
    const raster = rasterArg(a, true) ?? 'takt';
    if (loopDeckGruppe(p, platz)) ab('platz_belegt', `place ${platz} already holds a loop deck`);
    // M5: a module in slot A/B of this place becomes cell 1 of track 1 and goes away (all its tracks and stems with it)
    const modulId = liveSlots(p)[platz === 1 ? 'A' : 'B'];
    let zelle: Omit<Zelle, 'id'> | null = null;
    if (modulId !== undefined) {
      zelle = zelleAusModul(p, gruppeVon(p, modulId), ctx.ordner);   // refuses before anything is removed
      entferneBaum(p, modulId, ctx);
    }
    const ids: string[] = [];
    for (let i = 1; i <= LOOP_SPUREN; i++) {
      PRO_BEFEHL.spur_neu(p, { befehl: 'spur_neu', art: 'audio', name: `L${platz}.${i}` }, ctx);
      ids.push(p.spuren[p.spuren.length - 1].id);
    }
    PRO_BEFEHL.gruppenspur_neu(p, { befehl: 'gruppenspur_neu', name: `LOOP ${platz}`, mitglieder: ids }, ctx);
    // the output defaults to the deck number's pad; when the other deck was moved onto that pad, this deck takes the other pad
    const andere = loopDeckGruppe(p, platz === 1 ? 2 : 1)?.loopdeck;
    const frei = andere && loopDjNr(andere) === platz ? (platz === 1 ? 4 : 3) : undefined;
    p.gruppen![p.gruppen!.length - 1].loopdeck = { platz, raster, ...(frei ? { ausgang_platz: frei as 3 | 4 } : {}) };
    // `filter: 0` and the eq zeros are written so the first knob drag is a replace (only replaces coalesce in the history)
    for (const id of ids) { const s = spurVon(p, id); s.zellen = keineZellen(); s.filter = 0; s.eq = { tief: 0, mitte: 0, hoch: 0 }; }
    if (zelle) spurVon(p, ids[0]).zellen![0] = { id: neueId(p, 'zelle'), ...zelle };
  },

  loopdeck_aendern(p, a) {
    erlaube(a, 'gruppe_id', 'raster');
    const g = deckGruppe(p, idArg(a, 'gruppe_id'));
    g.loopdeck!.raster = rasterArg(a, false)!;
  },

  // The place whose channel each existing deck sounds on (platz_1, platz_2: 1..4, or null/absent = unchanged: the deck is not shown in any place).
  // The faders belong to the places: 3 = pad/1, 4 = pad/2, 1 = deck/1, 2 = deck/2. The value of the default pad is stored as absent. The model
  // refuses two groups on one channel (two loop decks, a module slot, an unmuted SEQ deck).
  loopdeck_plaetze(p, a) {
    erlaube(a, 'platz_1', 'platz_2');
    const w = [a.platz_1 ?? null, a.platz_2 ?? null];
    const schlecht = w.some((x) => x !== null && ![1, 2, 3, 4].includes(x as number)) || (w[0] !== null && w[0] === w[1]);
    if (schlecht) ab('argument_ungueltig', 'platz_1 and platz_2: 1..4 or null, different');
    for (const platz of [1, 2] as const) {
      const l = loopDeckGruppe(p, platz)?.loopdeck, ziel = w[platz - 1];
      if (!l || ziel === null) continue;
      if (ziel === (platz === 1 ? 3 : 4)) delete l.ausgang_platz; else l.ausgang_platz = ziel as 1 | 2 | 3 | 4;
    }
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
  },

  zelle_aendern(p, a) {
    erlaube(a, 'spur_id', 'index', 'name', 'farbe', 'art', 'gain_db', 'beats');
    const s = deckSpur(p, idArg(a, 'spur_id'));
    const i = indexArg(a.index, 'index') - 1;
    if (['name', 'farbe', 'art', 'gain_db', 'beats'].every((k) => a[k] === undefined)) ab('argument_ungueltig', 'no change given');
    const z = s.zellen[i];
    if (!z) ab('zelle_leer', `${s.id} cell ${i + 1} is empty`);
    const name = text(a, 'name', 64);
    const farbe = zahl(a, 'farbe', 0, LOOP_FARBEN - 1, { opt: true, ganz: true });
    const gain = zahl(a, 'gain_db', -60, 12, { opt: true });
    const beats = zahl(a, 'beats', 0.25, 64, { opt: true });
    if (a.art !== undefined && a.art !== 'loop' && a.art !== 'einmal') ab('argument_ungueltig', "art: 'loop' or 'einmal' expected");
    if (beats !== undefined && !Number.isInteger(beats * 4)) ab('argument_ungueltig', 'beats: a multiple of 0.25 expected');
    const n = z!;
    if (name !== undefined) n.name = name;
    if (farbe !== undefined) n.farbe = farbe;
    if (a.art !== undefined) n.art = a.art;
    if (gain !== undefined) n.gain_db = gain;
    if (beats !== undefined) n.beats = beats;
  },

  zelle_bewegen(p, a) {
    erlaube(a, 'von', 'nach');
    const von = stelleArg(a.von, 'von'), nach = stelleArg(a.nach, 'nach');
    const sv = deckSpur(p, von.spur_id), sn = deckSpur(p, nach.spur_id);
    const iv = von.index - 1, in_ = nach.index - 1;
    const z = sv.zellen[iv];
    if (!z) ab('zelle_leer', `${sv.id} cell ${von.index} is empty`);
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
    let r = (p.returns ?? []).find((x) => x.loopdeck?.platz === platz && x.loopdeck.art === ziel);
    if (!r) {
      if (db <= FADER_MIN) return;                                   // no send and no return: nothing to do
      const vorher = new Set((p.returns ?? []).map((x) => x.id));
      PRO_BEFEHL.return_neu(p, ziel === 'hall'
        ? { befehl: 'return_neu', name: `L${platz} HALL`, hall: { ...LOOP_HALL } }
        : { befehl: 'return_neu', name: `L${platz} DLY`, effekt: { graph: LOOP_DELAY.graph, werte: { ...LOOP_DELAY.werte } } }, ctx);
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
