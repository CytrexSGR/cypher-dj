// Note editor commands (slice 1, task B1): the pitch targets of the notes of an audio clip (`AudioClip.audio_noten`, contract djk/contract/notes.md).
// audio_noten_aendern sets or moves the target pitch `ton` of notes, audio_noten_zuruecksetzen removes the target fields of notes, audio_noten_entfernen
// deletes the whole field (the clip plays its source again). The list itself is placed by the analysis (task B2), never by these commands. The MIDI
// commands noten_* are a different thing and stay untouched. Playback is not touched here: the render service reads the field (tasks B2 and B4).
// Rules of the target (A1 contract): `ton` is a float MIDI pitch rounded to 1e-4 (rundeTon); it stays within 24 semitones of the detected pitch `qton`
// and inside MIDI 0..127 (tonImSpann); a target equal to `qton` within 1e-4 is not stored. Slice 1 knows no other target field: any other argument
// is argument_unbekannt (slice 2 adds the time fields a, e, zeit_um, mit_nachbarn, slice 3 the factors vib, drift; formant and gain_db follow later).
import { MAX_AUDIO_NOTEN, ZIEL_FELDER, TON_TOLERANZ, rundeTon, tonImSpann, type AudioNote, type AudioNotenFeld } from './notes_contract.ts';
import { ab, clipVon, erlaube, idArg, zahlOk, type Args, type Handler } from './commands_helpers.ts';
import type { AudioClip, Projekt } from './model.ts';
import { zeitAnwenden } from '../public/noten/time.js';
import { ROLL_RASTER, rasterBeatsRolle } from '../public/production/notes_tools.js';
import { tonartFehler } from '../public/harmonie.js';
import { clipRaster, naechsteLinie, naechsteStufe } from './notes_grid.ts';

// The field of an audio clip: clip_unbekannt, feld_nur_audio (MIDI clip) and keine_audio_noten (409) are the refusals of all three commands, in this order
function feldVon(p: Projekt, a: Args): { clip: AudioClip; feld: AudioNotenFeld } {
  const g = clipVon(p, idArg(a, 'clip_id')).clip;
  const clip = g.art === 'audio' ? g : ab('feld_nur_audio', 'audio_noten');
  const feld = clip.audio_noten ?? ab('keine_audio_noten', clip.id);
  return { clip, feld };
}

// `ids`: 1..4096 different note ids as strings; each must exist in the list (noten_unbekannt). Returns the set.
function idsArg(a: Args, liste: readonly AudioNote[]): Set<string> {
  const x = a.ids;
  if (!Array.isArray(x) || x.length < 1 || x.length > MAX_AUDIO_NOTEN) ab('argument_ungueltig', `ids: list of 1..${MAX_AUDIO_NOTEN} note ids expected`);
  const ids = new Set<string>();
  for (const id of x as unknown[]) {
    if (typeof id !== 'string' || id === '') ab('argument_ungueltig', 'ids: note ids (non-empty texts) expected');
    if (ids.has(id as string)) ab('argument_ungueltig', `ids: ${id} twice`);
    ids.add(id as string);
  }
  const da = new Set(liste.map((n) => n.id));
  for (const id of ids) if (!da.has(id)) ab('noten_unbekannt', id);
  return ids;
}

const ZIELE: readonly string[] = ZIEL_FELDER;
const ohneZiele = (n: AudioNote): AudioNote => Object.fromEntries(Object.entries(n).filter(([k]) => !ZIELE.includes(k))) as AudioNote;

export const AUDIO_NOTEN = {
  // Pitch: exactly one of `ton` (absolute float MIDI, for every id) and `ton_um` (semitones added to the current target of each note, or to its qton when
  // it has none). Time (slice 2, rules in public/noten/time.js): `zeit_um` (seconds, every id) or `a` / `e` (absolute source seconds, exactly one id), with
  // `mit_nachbarn` (default true). At least one of the pitch pair and the time fields; both in one command are one undo step. Nothing is written when
  // anything is refused.
  audio_noten_aendern(p, a) {
    erlaube(a, 'clip_id', 'ids', 'ton', 'ton_um', 'a', 'e', 'zeit_um', 'mit_nachbarn', 'vib', 'vib_um', 'drift', 'drift_um');
    const { feld } = feldVon(p, a);
    const ids = idsArg(a, feld.liste);
    const zeit = a.a !== undefined || a.e !== undefined || a.zeit_um !== undefined;
    const tonArg = a.ton !== undefined || a.ton_um !== undefined;
    if (a.mit_nachbarn !== undefined && typeof a.mit_nachbarn !== 'boolean') ab('argument_ungueltig', 'mit_nachbarn: boolean expected');
    const faktorArg = ['vib', 'vib_um', 'drift', 'drift_um'].some((k) => a[k] !== undefined);
    if ((!zeit && !faktorArg) || tonArg) {
      if ((a.ton === undefined) === (a.ton_um === undefined)) ab('argument_ungueltig', 'exactly one of ton and ton_um expected');
    }
    let liste = feld.liste;
    if (tonArg) {
      const wert = a.ton !== undefined ? a.ton : a.ton_um;
      if (!zahlOk(wert)) ab('argument_ungueltig', `${a.ton !== undefined ? 'ton' : 'ton_um'}: finite number expected`);
      liste = liste.map((n) => {
        if (!ids.has(n.id)) return n;
        const ziel = rundeTon(a.ton !== undefined ? (wert as number) : (n.ton ?? n.qton) + (wert as number));
        if (!tonImSpann(ziel, n.qton)) ab('noten_ton_grenze', `${n.id}: ${ziel} is more than 24 semitones from the detected ${n.qton} or outside 0..127`);
        // a changed note is a new object, the old one stays untouched (the stand before shares unchanged notes)
        const { ton: _alt, ...rest } = n;
        return Math.abs(ziel - n.qton) <= TON_TOLERANZ + 1e-9 ? rest : { ...rest, ton: ziel };
      });
    }
    if (zeit) {
      const r = zeitAnwenden(liste, { ids: [...ids], a: a.a as number | undefined, e: a.e as number | undefined, zeitUm: a.zeit_um as number | undefined },
        { mitNachbarn: a.mit_nachbarn !== false }) as { liste: AudioNote[] } | { grund: string; text: string };
      if ('grund' in r) ab(r.grund, r.text);
      else liste = r.liste;
    }
    // Vibrato and drift factors (slice 3, contract notes.md D12): `vib` / `drift` absolute 0..4, or `vib_um` / `drift_um` added to the current factor
    // (1 when none); rounded to 1e-3, the default 1 is not stored. Only the factor is written, the detected curve stays.
    for (const k of ['vib', 'drift'] as const) {
      const abs = a[k], um = a[`${k}_um`];
      if (abs === undefined && um === undefined) continue;
      if (abs !== undefined && um !== undefined) ab('argument_ungueltig', `one of ${k} and ${k}_um expected`);
      const wert = abs !== undefined ? abs : um;
      if (!zahlOk(wert)) ab('argument_ungueltig', `${abs !== undefined ? k : `${k}_um`}: finite number expected`);
      liste = liste.map((n) => {
        if (!ids.has(n.id)) return n;
        const f = Math.round((abs !== undefined ? (wert as number) : (n[k] ?? 1) + (wert as number)) * 1e3) / 1e3;
        if (f < 0 || f > 4) ab('argument_ungueltig', `${n.id}: ${k} ${f} is outside 0..4`);
        const { [k]: _alt, ...rest } = n;
        return f === 1 ? (rest as AudioNote) : { ...rest, [k]: f };
      });
    }
    feld.liste = liste;
  },

  // Quantise and snap to scale in one command (slice 2, D10 and D11), one undo step. `zeit` = a grid id of the piano roll (quantise = MOVE of the notes,
  // length kept, a touching neighbour follows); `ton` = 'halbton' | 'tonart' (only `ton` changes, vibrato and drift stay); `staerke` 0..1 (default 1);
  // `tonart` only with ton 'tonart', else the project key. Without `ids` every note whose effective start lies in the audible range of the clip.
  // A note that would break a limit stays unchanged; only bad arguments fail the command.
  audio_noten_raster(p, a) {
    erlaube(a, 'clip_id', 'ids', 'zeit', 'ton', 'staerke', 'tonart');
    const { clip, feld } = feldVon(p, a);
    if (a.zeit === undefined && a.ton === undefined) ab('argument_ungueltig', 'at least one of zeit and ton expected');
    const schritt = a.zeit === undefined ? null
      : rasterBeatsRolle(a.zeit) ?? ab('argument_ungueltig',
        `zeit: one of ${ROLL_RASTER.filter((r) => r.beats !== null).map((r) => r.id).join(', ')} expected`);
    if (a.ton !== undefined && a.ton !== 'halbton' && a.ton !== 'tonart') ab('argument_ungueltig', "ton: 'halbton' or 'tonart' expected");
    if (a.staerke !== undefined && (!zahlOk(a.staerke) || a.staerke < 0 || a.staerke > 1)) ab('argument_ungueltig', 'staerke: number 0..1 expected');
    const staerke = (a.staerke as number | undefined) ?? 1;
    if (a.tonart !== undefined) {
      if (a.ton !== 'tonart') ab('argument_ungueltig', "tonart: only with ton 'tonart'");
      const f = tonartFehler(a.tonart);
      if (f) ab('argument_ungueltig', f);
    }
    const tonart = a.ton === 'tonart' ? ((a.tonart ?? p.tonart) as { grundton: number; skala: string } | undefined) : undefined;
    if (a.ton === 'tonart' && tonart === undefined) ab('argument_ungueltig', 'tonart: the project has no key and none was given');
    const raster = clipRaster(clip, p.tempo_bpm);
    const wahl: Set<string> | null = a.ids === undefined ? null : idsArg(a, feld.liste);
    const eff = (n: AudioNote) => n.a ?? n.qa;
    const ziele = (feld.liste.filter((n) => (wahl !== null ? wahl.has(n.id) :
      eff(n) >= raster.hoerbarS[0] - 1e-9 && eff(n) < raster.hoerbarS[1] - 1e-9))).map((n) => n.id);
    let liste = feld.liste;
    if (schritt !== null) {
      for (const id of ziele) {
        const n = liste.find((x) => x.id === id) as AudioNote;
        const b = raster.beatBeiS(eff(n));
        const nach = b + (naechsteLinie(b, schritt) - b) * staerke;
        const um = raster.sBeiBeat(nach) - eff(n);
        if (Math.abs(um) < 1e-9) continue;
        const r = zeitAnwenden(liste, { ids: [id], zeitUm: um }, { mitNachbarn: true }) as { liste: AudioNote[] } | { grund: string };
        if (!('grund' in r)) liste = r.liste;   // refused: the note stays unchanged, the loop goes on
      }
    }
    if (a.ton !== undefined) {
      const set = new Set(ziele);
      liste = liste.map((n) => {
        if (!set.has(n.id)) return n;
        const t = n.ton ?? n.qton;
        const ziel = rundeTon(t + (naechsteStufe(t, tonart, n.qton) - t) * staerke);
        if (!tonImSpann(ziel, n.qton)) return n;
        const { ton: _alt, ...rest } = n;
        return Math.abs(ziel - n.qton) <= TON_TOLERANZ + 1e-9 ? rest : { ...rest, ton: ziel };
      });
    }
    feld.liste = liste;
  },

  // Without `ids` every note of the clip. A note without target fields stays as it is.
  audio_noten_zuruecksetzen(p, a) {
    erlaube(a, 'clip_id', 'ids');
    const { feld } = feldVon(p, a);
    const ids = a.ids === undefined ? null : idsArg(a, feld.liste);
    feld.liste = feld.liste.map((n) => (ids !== null && !ids.has(n.id) ? n : ohneZiele(n)));
  },

  audio_noten_entfernen(p, a) {
    erlaube(a, 'clip_id');
    const { clip } = feldVon(p, a);
    delete clip.audio_noten;
  },
} satisfies Record<string, Handler>;
