// Note editor commands (slice 1, task B1): the pitch targets of the notes of an audio clip (`AudioClip.audio_noten`, contract djk/contract/notes.md).
// audio_noten_aendern sets or moves the target pitch `ton` of notes, audio_noten_zuruecksetzen removes the target fields of notes, audio_noten_entfernen
// deletes the whole field (the clip plays its source again). The list itself is placed by the analysis (task B2), never by these commands. The MIDI
// commands noten_* are a different thing and stay untouched. Playback is not touched here: the render service reads the field (tasks B2 and B4).
// Rules of the target (A1 contract): `ton` is a float MIDI pitch rounded to 1e-4 (rundeTon); it stays within 24 semitones of the detected pitch `qton`
// and inside MIDI 0..127 (tonImSpann); a target equal to `qton` within 1e-4 is not stored. Slice 1 knows no other target field: any other argument
// is argument_unbekannt (the contract already carries a, e, vib, drift, formant and gain_db for later slices, the commands do not yet).
import { MAX_AUDIO_NOTEN, ZIEL_FELDER, TON_TOLERANZ, rundeTon, tonImSpann, type AudioNote, type AudioNotenFeld } from './notes_contract.ts';
import { ab, clipVon, erlaube, idArg, zahlOk, type Args, type Handler } from './commands_helpers.ts';
import type { AudioClip, Projekt } from './model.ts';

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
  // Exactly one of `ton` (absolute float MIDI, for every id) and `ton_um` (semitones added to the current target of each note, or to its qton when it has
  // none). Nothing is written when one id is refused: the whole command is one undo step or none.
  audio_noten_aendern(p, a) {
    erlaube(a, 'clip_id', 'ids', 'ton', 'ton_um');
    const { feld } = feldVon(p, a);
    const ids = idsArg(a, feld.liste);
    if ((a.ton === undefined) === (a.ton_um === undefined)) ab('argument_ungueltig', 'exactly one of ton and ton_um expected');
    const wert = a.ton !== undefined ? a.ton : a.ton_um;
    if (!zahlOk(wert)) ab('argument_ungueltig', `${a.ton !== undefined ? 'ton' : 'ton_um'}: finite number expected`);
    feld.liste = feld.liste.map((n) => {
      if (!ids.has(n.id)) return n;
      const ziel = rundeTon(a.ton !== undefined ? (wert as number) : (n.ton ?? n.qton) + (wert as number));
      if (!tonImSpann(ziel, n.qton)) ab('noten_ton_grenze', `${n.id}: ${ziel} is more than 24 semitones from the detected ${n.qton} or outside 0..127`);
      // a changed note is a new object, the old one stays untouched (the stand before shares unchanged notes)
      const { ton: _alt, ...rest } = n;
      return Math.abs(ziel - n.qton) <= TON_TOLERANZ + 1e-9 ? rest : { ...rest, ton: ziel };
    });
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
