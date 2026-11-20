// Linked clips (tracker patterns, ADR 039): MIDI clips of one track with the same `verbund` are copies of one pattern. A content command on one
// member is repeated on every member inside the same command list (one undo step); nothing about playback changes, every reader sees plain clips.
// This file uses the values of model.ts only inside functions (model.ts imports it at runtime for the model check).
import { istObjekt, kanonisch, notenZaehler, type MidiClip, type Projekt, type Spur } from './model.ts';

// The content commands that reach every member (D13). `clip_aendern` joins them when it names only the fields of FAECHER_CLIP_AENDERN.
export const FAECHER_BEFEHLE: readonly string[] = ['noten_neu', 'noten_aendern', 'noten_loeschen', 'zeile_setzen', 'huellkurve_setzen', 'huellkurve_loeschen',
  'clip_aus_muster', 'fx_setzen'];
export const FAECHER_CLIP_AENDERN: readonly string[] = ['name', 'laenge_beats', 'loop_beats', 'seq'];

/** Does this command reach every member of a pattern? (content commands, and `clip_aendern` naming only name, laenge_beats, loop_beats, seq) */
export function faechertAus(b: unknown): boolean {
  if (!istObjekt(b) || typeof b.befehl !== 'string') return false;
  if (FAECHER_BEFEHLE.includes(b.befehl)) return true;
  if (b.befehl !== 'clip_aendern') return false;
  const felder = Object.keys(b).filter((k) => k !== 'befehl' && k !== 'clip_id');
  return felder.length > 0 && felder.every((k) => FAECHER_CLIP_AENDERN.includes(k));
}

const istMidi = (c: unknown): c is MidiClip => istObjekt(c) && c.art === 'midi';

/** The members of the pattern of a clip: same track, same `verbund`, the clip itself first. An unlinked clip gives only itself, an unknown id gives none. */
export function mitglieder(p: Projekt, clipId: string): MidiClip[] {
  for (const s of p.spuren) {
    const c = s.clips.find((x) => x.id === clipId);
    if (!c) continue;
    if (!istMidi(c)) return [];
    if (c.verbund === undefined) return [c];
    return [c, ...s.clips.filter((x): x is MidiClip => x !== c && istMidi(x) && x.verbund === c.verbund)];
  }
  return [];
}

/**
 * The command for every member (the clip of the command first), `clip_id` replaced. For `noten_neu` the ids of the notes without an id are drawn
 * once from the project counter (this changes `p`), so every member gets the same ids; the caller runs the commands with `ctx.noteIdsAb` set to the
 * counter before this call. An unlinked clip gives the command itself.
 */
export function weite(p: Projekt, b: Record<string, unknown>): unknown[] {
  const id = b.clip_id;
  if (typeof id !== 'string') return [b];
  const ms = mitglieder(p, id);
  if (ms.length < 2) return [b];
  let cmd: Record<string, unknown> = b;
  if (b.befehl === 'noten_neu' && Array.isArray(b.noten)) {
    const belegt = new Set<unknown>(b.noten.flatMap((r) => (istObjekt(r) && r.id !== undefined ? [r.id] : [])));
    let n = notenZaehler(p);
    const noten = b.noten.map((r) => {
      if (!istObjekt(r) || r.id !== undefined) return r;
      while (belegt.has(`n${n}`)) n += 1;
      return { ...r, id: `n${n++}` };
    });
    p.naechste_noten_id = n;
    cmd = { ...b, noten };
  }
  return ms.map((m) => ({ ...cmd, clip_id: m.id }));
}

const INHALT = ['name', 'laenge_beats', 'loop_beats', 'noten', 'huellkurven', 'zeilen', 'fx', 'seq', 'muster'] as const;
/** The content of a pattern (what members share) copied from `von` to `nach`; an absent optional field is removed from `nach`. */
export function kopiereInhalt(von: MidiClip, nach: MidiClip): void {
  const v = von as unknown as Record<string, unknown>, n = nach as unknown as Record<string, unknown>;
  for (const k of INHALT) { if (v[k] === undefined) delete n[k]; else n[k] = structuredClone(v[k]); }
}

// What members must share. `muster` is the origin of the generator and not compared (a member may be regenerated alone before it is linked).
const VERGLEICH = ['name', 'laenge_beats', 'loop_beats', 'huellkurven', 'zeilen', 'fx', 'seq'] as const;
const nachId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** The first difference between two members as text, or null when they are equal. */
function ersterUnterschied(a: MidiClip, b: MidiClip): string | null {
  const x = a as unknown as Record<string, unknown>, y = b as unknown as Record<string, unknown>;
  for (const k of VERGLEICH) if (kanonisch(x[k] ?? null) !== kanonisch(y[k] ?? null)) return k;
  if (kanonisch([...a.noten].sort(nachId)) !== kanonisch([...b.noten].sort(nachId))) {
    const ids = new Set([...a.noten, ...b.noten].map((n) => n.id));
    for (const id of [...ids].sort()) {
      const na = a.noten.find((n) => n.id === id), nb = b.noten.find((n) => n.id === id);
      if (kanonisch(na ?? null) !== kanonisch(nb ?? null)) return `noten (note ${id})`;
    }
    return 'noten';
  }
  return null;
}

/** The check of one track: members with the same `verbund` must be equal. */
export function verbundPruefungSpur(s: Spur): { grund: 'verbund_ungleich'; text: string } | null {
  const erste = new Map<string, MidiClip>();
  for (const c of s.clips) {
    if (!istMidi(c) || c.verbund === undefined) continue;
    const e = erste.get(c.verbund);
    if (!e) { erste.set(c.verbund, c); continue; }
    const u = ersterUnterschied(e, c);
    if (u !== null) return { grund: 'verbund_ungleich', text: `linked clips ${e.id} and ${c.id} (verbund ${c.verbund}) differ in ${u}` };
  }
  return null;
}
/** The check of the project: members of a pattern with equal name, laenge_beats, loop_beats, noten (same ids and fields), huellkurven, zeilen, fx, seq. */
export function verbundPruefung(p: Projekt): { grund: 'verbund_ungleich'; text: string } | null {
  for (const s of p.spuren) { const f = verbundPruefungSpur(s); if (f) return f; }
  return null;
}

/** Take a clip out of its pattern; a pattern left with one member on the track loses its `verbund` too. */
export function entknuepfe(s: Spur, clip: MidiClip): void {
  const v = clip.verbund;
  if (v === undefined) return;
  delete clip.verbund;
  const rest = s.clips.filter((x): x is MidiClip => istMidi(x) && x.verbund === v);
  if (rest.length === 1) delete rest[0].verbund;
}

/**
 * After a command that may have removed or moved clips: a `verbund` that only one clip of its track carries is removed. Writes only when something
 * is to be removed (a project without `verbund` is not touched). Not for the note fast path, which shares clips with the source project.
 */
export function raeumeVerbuende(p: Projekt): void {
  for (const s of p.spuren) {
    let da = false;
    for (const c of s.clips) if (istMidi(c) && c.verbund !== undefined) { da = true; break; }
    if (!da) continue;
    const zahl = new Map<string, number>();
    for (const c of s.clips) if (istMidi(c) && c.verbund !== undefined) zahl.set(c.verbund, (zahl.get(c.verbund) ?? 0) + 1);
    for (const c of s.clips) if (istMidi(c) && c.verbund !== undefined && zahl.get(c.verbund) === 1) delete c.verbund;
  }
}
