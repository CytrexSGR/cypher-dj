// Container commands (container core M3): which kind of thing sits in each of the four places of the live container (`plaetze`), the strom tracks of the
// strudel module, and their sends. A place change is one command, so one undo step and one playback swap. Parking never deletes: a group that no
// place holds stays in the project with its tracks and returns (silent), and a later platz_setzen brings the very same group back.
import {
  MAX_RETURNS, MAX_SPUREN, MAX_STROEME, PLATZ_TYPEN, FADER_MIN, SPUR_FARBEN, neueId, LOOP_SEND_MAX, loopDeckGruppe, platzVonGruppe, strudelGruppe, stromSpur,
  type Gruppe, type Platz, type PlatzTyp, type Projekt,
} from './model.ts';
import { ab, erlaube, gruppeVon, idArg, PRO_BEFEHL, spurVon, text, zahl, type Handler } from './commands_helpers.ts';
import { legeLoopdeckAn } from './commands_loopdeck.ts';
import { legeSeqGruppeAn } from './commands_group.ts';

export const CONTAINER_LABEL = { platz_setzen: 'Set place', strom_spur_neu: 'New strom track', strom_send: 'Strom send' } as const;

// The HALL and DELAY return of the strudel module: the same room and dotted delay as a loop deck's (commands_loopdeck.ts), so one sound per kind
const STROM_HALL = { decay: 0.25, groesse: 0.15, pre: 0, highcut: 0.7 } as const;
const STROM_DELAY = { graph: 'fx-delay-sync', werte: { k1: 0.3889, k2: 0.5 } } as const;

// The group a place takes: the named one (it must be a top group of the right kind that no other place holds), or a new one where the type can make it.
function gruppeFuer(p: Projekt, platz: number, typ: 'strudel' | 'seq' | 'loops' | 'stems', gid: string | undefined, ctx: Parameters<Handler>[2]): Gruppe {
  const art = (g: Gruppe): boolean => !g.ausgang && (typ === 'strudel' ? g.strudel !== undefined : typ === 'seq' ? g.seq !== undefined
    : typ === 'loops' ? g.loopdeck !== undefined : g.modul !== undefined);
  const aktuell = p.plaetze![platz - 1];
  if (gid !== undefined) {
    const g = gruppeVon(p, gid);
    if (!art(g)) ab('gruppe_unbekannt', `${gid} is no top group of kind ${typ}`);
    const ort = platzVonGruppe(p, g.id);
    if (ort !== null && ort !== platz) ab(typ === 'strudel' ? 'typ_doppelt' : 'gruppe_vergeben', `${g.id} already sits in place ${ort}`);
    return g;
  }
  if (typ === 'stems') return ab('argument_ungueltig', 'gruppe_id: a module comes from modul_einsetzen; name its group');
  if (typ === 'strudel') {
    const vorhanden = strudelGruppe(p);
    if (vorhanden) {
      const ort = platzVonGruppe(p, vorhanden.id);
      if (ort !== null && ort !== platz) ab('typ_doppelt', `the strudel module already sits in place ${ort}`);
      return vorhanden;
    }
    PRO_BEFEHL.gruppenspur_neu(p, { befehl: 'gruppenspur_neu', name: 'STRUDEL' }, ctx);
    const g = p.gruppen![p.gruppen!.length - 1];
    g.strudel = {};
    return g;
  }
  if (typ === 'seq') {
    if (aktuell.typ === 'seq') ab('seq_belegt', `place ${platz} already holds a SEQ deck`);
    // a parked SEQ deck (no place holds it) comes back first, the earliest one first: parking is not deleting,
    // so the patterns in it stay reachable and orphans do not pile up
    const parkt = (p.gruppen ?? []).find((g) => g.seq !== undefined && !g.ausgang && platzVonGruppe(p, g.id) === null);
    return parkt ?? legeSeqGruppeAn(p, platz, ctx);
  }
  // loops: deck identity 1, then 2; a place that already holds a deck, or both decks existing (placed or parked): refused
  if (aktuell.typ === 'loops') ab('platz_belegt', `place ${platz} already holds a loop deck`);
  // a parked deck (no place holds it) comes back first, lowest identity first: parking is not deleting,
  // so the loops in it stay reachable and the two decks never pile up
  for (const n of [1, 2] as const) { const parkt = loopDeckGruppe(p, n); if (parkt && platzVonGruppe(p, parkt.id) === null) return parkt; }
  const deck = ([1, 2] as const).find((n) => loopDeckGruppe(p, n) === null)
    ?? ab('platz_belegt', 'both loop decks are shown in places; switch one of those places away first (it is parked, not deleted)');
  return legeLoopdeckAn(p, deck, 'takt', ctx);
}

function strudelOderAb(p: Projekt): Gruppe {
  return strudelGruppe(p) ?? ab('kein_strudel_modul', 'the project has no strudel module; place one with platz_setzen');
}

export const CONTAINER = {
  platz_setzen(p, a, ctx) {
    erlaube(a, 'platz', 'typ', 'gruppe_id');
    if (!p.live) ab('kein_liveprojekt', 'places belong to the live container');
    const platz = a.platz;
    if (platz !== 1 && platz !== 2 && platz !== 3 && platz !== 4) return ab('argument_ungueltig', 'platz: integer 1..4 expected');
    const typ = a.typ as PlatzTyp;
    if (typeof a.typ !== 'string' || !PLATZ_TYPEN.includes(typ)) return ab('argument_ungueltig', `typ: one of ${PLATZ_TYPEN.join(' ')} expected`);
    const gid = a.gruppe_id === undefined ? undefined : idArg(a, 'gruppe_id');
    if (typ === 'leer' || typ === 'track') {
      if (gid !== undefined) ab('argument_ungueltig', `gruppe_id: a ${typ} place holds no group`);
      p.plaetze![platz - 1] = { typ };   // whatever sat here is parked, not deleted
      return;
    }
    const g = gruppeFuer(p, platz, typ, gid, ctx);
    p.plaetze![platz - 1] = { typ, gruppe: g.id } as Platz;
  },

  // A strom track for stream `strom` in the strudel module: `STR <n>` unless named, no clips, plays into the strudel group.
  strom_spur_neu(p, a, ctx) {
    erlaube(a, 'strom', 'name');
    if (!p.live) ab('kein_liveprojekt', 'the strudel module sits in the live container');
    const g = strudelOderAb(p);
    const strom = zahl(a, 'strom', 1, MAX_STROEME, { ganz: true });
    if (strom === undefined) return ab('argument_ungueltig', `strom: integer 1..${MAX_STROEME} expected`);
    if (stromSpur(p, strom)) ab('strom_belegt', `stream ${strom} already has a track`);
    const name = text(a, 'name', 80) ?? `STR ${strom}`;
    if (p.spuren.length >= MAX_SPUREN) ab('spur_bereich', `all ${MAX_SPUREN} tracks are used`);
    const nr = Array.from({ length: MAX_SPUREN }, (_, i) => i + 1).find((n) => !p.spuren.some((x) => x.nr === n)) ?? ab('spur_bereich', 'no free track number');
    p.spuren.push({ id: neueId(p, 'spur'), von: ctx.quelle, nr, name, farbe: SPUR_FARBEN[(nr - 1) % SPUR_FARBEN.length], art: 'strom', strom,
      fader_db: 0, pan: 0, mute: false, solo: false, clips: [], ausgang: { art: 'gruppe', id: g.id } });
  },

  // The send of a strom track into the HALL or DELAY return of the strudel module; the return is created on first use (db above -200), in this one command.
  strom_send(p, a, ctx) {
    erlaube(a, 'spur_id', 'ziel', 'db');
    const g = strudelOderAb(p);
    const s = spurVon(p, idArg(a, 'spur_id'));
    if (s.art !== 'strom') ab('argument_ungueltig', `${s.id} is not a strom track`);
    const ziel = a.ziel;
    if (ziel !== 'hall' && ziel !== 'delay') return ab('argument_ungueltig', "ziel: 'hall' or 'delay' expected");
    const db = zahl(a, 'db', FADER_MIN, LOOP_SEND_MAX)!;
    let r = (p.returns ?? []).find((x) => x.strudel?.art === ziel);
    if (!r) {
      if (db <= FADER_MIN) return;                                   // no send and no return: nothing to do
      if ((p.returns ?? []).length >= MAX_RETURNS) ab('returns_voll', `all ${MAX_RETURNS} returns are used`);
      const vorher = new Set((p.returns ?? []).map((x) => x.id));
      PRO_BEFEHL.return_neu(p, ziel === 'hall'
        ? { befehl: 'return_neu', name: 'STR HALL', gruppe_id: g.id, hall: { ...STROM_HALL } }
        : { befehl: 'return_neu', name: 'STR DLY', gruppe_id: g.id, effekt: { graph: STROM_DELAY.graph, werte: { ...STROM_DELAY.werte } } }, ctx);
      r = p.returns!.find((x) => !vorher.has(x.id))!;
      r.strudel = { art: ziel };
    }
    PRO_BEFEHL.send_setzen(p, { befehl: 'send_setzen', strang_id: s.id, return_id: r.id, db }, ctx);
  },
} satisfies Record<string, Handler>;
