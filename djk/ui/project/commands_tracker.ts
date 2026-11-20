// Tracker commands: the marker and its two view settings. tracker_setzen creates the marker `{schema: 1}` when absent, sets lpb and ticks and
// removes a field that is set to its default or to null (never written with the default value). One command, one undo step.
import { LPB_WERTE, TICKS_MAX, TICKS_MIN, type TrackerMarke } from './tracker.ts';
import { ab, clipVon, erlaube, idArg, midiVon, runde9, text, zahl, zahlOk, type Handler } from './commands_helpers.ts';
import { FX_CODES, FX_MAX_EINTRAEGE, MAX_BEAT, type FxEintrag, type Projekt } from './model.ts';
import {
  abschnittDuplizieren, abschnittLaenge, abschnittLoeschen, abschnittNeu, abschnittUmbenennen, abschnittVerschieben,
  zeitEinfuegenMitListe, zeitEntfernenMitListe,
} from './time.ts';

export const LPB_VORGABE = 4;
export const TICKS_VORGABE = 6;

// the section commands sit on the marker, which the live container and a workbench module never carry; the time commands only refuse the live container
const nichtLive = (p: Projekt, was: string): void => { if (p.live) ab('tracker_live', `the live container has no ${was}`); };
const mitMarke = (p: Projekt): void => { nichtLive(p, 'sections'); if (p.werkbank) ab('tracker_werkbank', 'a workbench module has no sections'); };

const fxAb = (text: string): never => ab('fx_ungueltig', text);
const zelle = (beat: number, spalte: number): string => `${runde9(beat)}/${spalte}`;
/** One entry of the list of fx_setzen, checked against the clip length: a write {beat, spalte, code, wert} or a delete {beat, spalte, code: null}. */
function fxEintrag(x: unknown, i: number, laenge: number): { beat: number; spalte: 0 | 1 | 2 | 3; code: string | null; wert: number } {
  const wo = `eintraege[${i}]`;
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return fxAb(`${wo}: {beat, spalte, code, wert} or code null expected`);
  const r = x as Record<string, unknown>;
  const loeschen = r.code === null;
  const erlaubt = loeschen ? ['beat', 'spalte', 'code'] : ['beat', 'spalte', 'code', 'wert'];
  const extra = Object.keys(r).find((k) => !erlaubt.includes(k));
  if (extra !== undefined) return fxAb(`${wo}.${extra}: not allowed here`);
  if (!zahlOk(r.beat) || r.beat < 0 || r.beat >= laenge) return fxAb(`${wo}.beat: a number from 0 up to the clip length (${laenge}) expected`);
  if (!Number.isInteger(r.spalte) || (r.spalte as number) < 0 || (r.spalte as number) > 3) return fxAb(`${wo}.spalte: 0..3 expected`);
  if (loeschen) return { beat: r.beat, spalte: r.spalte as 0 | 1 | 2 | 3, code: null, wert: 0 };
  if (typeof r.code !== 'string' || !(FX_CODES as readonly string[]).includes(r.code)) return fxAb(`${wo}.code: one of ${FX_CODES.join(' ')} or null expected`);
  if (!Number.isInteger(r.wert) || (r.wert as number) < 0 || (r.wert as number) > 255) return fxAb(`${wo}.wert: whole number 0..255 expected`);
  return { beat: r.beat, spalte: r.spalte as 0 | 1 | 2 | 3, code: r.code, wert: r.wert as number };
}

export const TRACKER = {
  // {an?: true, lpb?: 2|3|4|6|8|12|16|null, ticks?: 1..24|null}: refused on the live container (tracker_live) and on a workbench module (tracker_werkbank)
  tracker_setzen(p, a) {
    erlaube(a, 'an', 'lpb', 'ticks');
    if (p.live) ab('tracker_live', 'the live container has no tracker view');
    if (p.werkbank) ab('tracker_werkbank', 'a workbench module has no tracker view');
    if (a.an === undefined && a.lpb === undefined && a.ticks === undefined) ab('argument_ungueltig', 'tracker_setzen: no field given (an, lpb, ticks)');
    if (a.an !== undefined && a.an !== true) ab('argument_ungueltig', 'an: true expected');
    if (a.lpb !== undefined && a.lpb !== null && !(typeof a.lpb === 'number' && LPB_WERTE.includes(a.lpb))) {
      ab('argument_ungueltig', `lpb: one of ${LPB_WERTE.join(', ')} expected (null removes it)`);
    }
    if (a.ticks !== undefined && a.ticks !== null && !(Number.isInteger(a.ticks) && (a.ticks as number) >= TICKS_MIN && (a.ticks as number) <= TICKS_MAX)) {
      ab('argument_ungueltig', `ticks: whole number ${TICKS_MIN}..${TICKS_MAX} expected (null removes it)`);
    }
    const m: TrackerMarke = { ...(p.tracker ?? { schema: 1 }) };
    for (const [k, vorgabe] of [['lpb', LPB_VORGABE], ['ticks', TICKS_VORGABE]] as const) {
      if (a[k] === undefined) continue;
      if (a[k] === null || a[k] === vorgabe) delete m[k]; else m[k] = a[k] as number;
    }
    p.tracker = m;
  },

  // {beat >= 0, beats > 0}: inserts empty time: clips, take clips and lane points at or after `beat` move later, the project loop moves with its ends.
  // The recording punch range moves like the loop (only when the project has `aufnahme`). A stored section list follows: the section that holds `beat` grows.
  // zeit_schnitt: a clip crosses `beat`. tracker_live: refused on the live container
  zeit_einfuegen(p, a) {
    erlaube(a, 'beat', 'beats');
    nichtLive(p, 'time commands');
    zeitEinfuegenMitListe(p, zahl(a, 'beat', 0, MAX_BEAT)!, zahl(a, 'beats', 0, MAX_BEAT, { offenUnten: true })!);
  },

  // {beat >= 0, beats > 0}: removes the time [beat, beat + beats): later items move earlier, lane points inside the range go (the value at its end stays
  // by a point at `beat`), a loop end inside it goes to `beat` (the punch range likewise). With a stored section list the section that holds the range
  // shrinks; zeit_abschnitt: the range crosses a section border or covers a whole section. zeit_schnitt: a clip crosses or lies in the range
  zeit_entfernen(p, a) {
    erlaube(a, 'beat', 'beats');
    nichtLive(p, 'time commands');
    zeitEntfernenMitListe(p, zahl(a, 'beat', 0, MAX_BEAT)!, zahl(a, 'beats', 0, MAX_BEAT, { offenUnten: true })!);
  },

  // {nach?: section id, zeilen?: 1..(1024 * LPB) whole rows (default 64), name?: 1..40 characters}: a new empty section after `nach` (default: at the end)
  abschnitt_neu(p, a) {
    erlaube(a, 'nach', 'zeilen', 'name');
    mitMarke(p);
    abschnittNeu(p, a.nach === undefined ? undefined : idArg(a, 'nach'), zahl(a, 'zeilen', 1, 1024 * 16, { opt: true, ganz: true }) ?? 64,
      text(a, 'name', 40));
  },

  // {id, als: 'verknuepft' | 'kopie'}: a new section after `id` of the same length; the clips fully inside are copied to the same offset (verknuepft: as
  // members of their pattern, kopie: as unique clips)
  abschnitt_duplizieren(p, a) {
    erlaube(a, 'id', 'als');
    mitMarke(p);
    if (a.als !== 'verknuepft' && a.als !== 'kopie') ab('argument_ungueltig', "als: 'verknuepft' or 'kopie' expected");
    abschnittDuplizieren(p, idArg(a, 'id'), a.als);
  },

  // {id}: deletes the section with the clips fully inside and removes its time; the last section is refused (abschnitt_letzter)
  abschnitt_loeschen(p, a) {
    erlaube(a, 'id');
    mitMarke(p);
    abschnittLoeschen(p, idArg(a, 'id'));
  },

  // {id, richtung: -1 | 1}: swaps the section with its neighbour (clips and lane points of both move, the loop stays); abschnitt_rand at the ends
  abschnitt_verschieben(p, a) {
    erlaube(a, 'id', 'richtung');
    mitMarke(p);
    if (a.richtung !== -1 && a.richtung !== 1) ab('argument_ungueltig', 'richtung: -1 or 1 expected');
    abschnittVerschieben(p, idArg(a, 'id'), a.richtung);
  },

  // {id, zeilen: whole rows >= 1}: sets the length of the section at the project LPB; the clips that cover it exactly change with it
  abschnitt_laenge(p, a) {
    erlaube(a, 'id', 'zeilen');
    mitMarke(p);
    abschnittLaenge(p, idArg(a, 'id'), zahl(a, 'zeilen', 1, 1024 * 16, { ganz: true })!);
  },

  // {id, name: 1..40 characters | null}: names the section, null removes the name
  abschnitt_umbenennen(p, a) {
    erlaube(a, 'id', 'name');
    mitMarke(p);
    if (a.name === undefined) ab('argument_ungueltig', 'name: fehlt (text or null)');
    abschnittUmbenennen(p, idArg(a, 'id'), a.name === null ? null : (text(a, 'name', 40) ?? null));
  },

  // {clip_id, eintraege: [{beat, spalte, code, wert} | {beat, spalte, code: null}]}: effect commands of a MIDI clip (field `fx`). beat: the start of the row in
  // clip beats (0 <= beat < laenge_beats), spalte 0..3, code one of FX_CODES, wert whole 0..255. An entry replaces the one in the same (beat, spalte);
  // code null removes it (absent: nothing happens). The entries run in order, a later one wins. The list is kept sorted, and the field goes with its
  // last entry. On a member of a pattern the command reaches every member (verbund.ts). Reason fx_ungueltig: refused as a whole
  fx_setzen(p, a) {
    erlaube(a, 'clip_id', 'eintraege');
    const id = idArg(a, 'clip_id');
    const clip = midiVon(clipVon(p, id).clip, id);
    if (!Array.isArray(a.eintraege)) fxAb('eintraege: a list expected');
    const liste: unknown[] = a.eintraege;
    if (liste.length < 1 || liste.length > FX_MAX_EINTRAEGE) fxAb(`eintraege: 1..${FX_MAX_EINTRAEGE} entries expected`);
    const neu = liste.map((x, i) => fxEintrag(x, i, clip.laenge_beats));
    const karte = new Map<string, FxEintrag>((clip.fx ?? []).map((e) => [zelle(e.beat, e.spalte), e]));
    for (const e of neu) {
      const k = zelle(e.beat, e.spalte);
      if (e.code === null) karte.delete(k); else karte.set(k, { beat: e.beat, spalte: e.spalte, code: e.code, wert: e.wert });
    }
    const fx = [...karte.values()].sort((x, y) => x.beat - y.beat || x.spalte - y.spalte);
    if (fx.length === 0) delete clip.fx; else clip.fx = fx;
  },
} satisfies Record<string, Handler>;
