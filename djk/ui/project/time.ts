// Tracker time and sections (task 8): inserting and removing time on the whole project timeline, and the section commands built on it.
// zeitEinfuegen / zeitEntfernen mutate a draft: clips and take clips, the lanes of every strip and the project loop. The section functions work on the
// section list of the tracker marker (`abschnitte`); a project without the list gets the default list first (the one the page shows, D10).
import { alleStraenge, neueId, MAX_BEAT, type Clip, type Lane, type MidiClip, type Projekt, type Spur } from './model.ts';
import { laneWert } from './lane.ts';
import { ABSCHNITT_BEATS_MAX, ABSCHNITTE_MAX, type TrackerAbschnitt } from './tracker.ts';
import { ab, runde9 } from './commands_helpers.ts';
import { mitglieder } from './verbund.ts';

const EPS = 1e-9;
/** The length of a default section in beats (the page shows a project without `abschnitte` in sections of this length). */
export const ABSCHNITT_VORGABE_BEATS = 16;

type Ort = { clip: Clip; spur: Spur; liste: Clip[] };
/** Every clip of every track, take clips included, each with its track and the array that holds it. */
function alleClips(p: Projekt): Ort[] {
  const aus: Ort[] = [];
  for (const spur of p.spuren) {
    for (const clip of spur.clips) aus.push({ clip, spur, liste: spur.clips });
    for (const t of spur.takes ?? []) for (const clip of t.clips) aus.push({ clip, spur, liste: t.clips });
  }
  return aus;
}
const ende = (c: Clip): number => c.start_beat + c.laenge_beats;
/** Does the clip cross the beat (the beat lies strictly inside it)? */
const kreuzt = (c: Clip, x: number): boolean => c.start_beat < x - EPS && ende(c) > x + EPS;
const kreuzText = (o: Ort, x: number): string => `clip "${o.clip.name}" on track "${o.spur.name}" crosses beat ${x}`;
const drinText = (o: Ort): string => `clip "${o.clip.name}" on track "${o.spur.name}" lies inside the removed range`;

/** The text of the first clip that crosses one of the beats, or null. */
export function grenzText(p: Projekt, beats: number[]): string | null {
  for (const o of alleClips(p)) for (const x of beats) if (kreuzt(o.clip, x)) return kreuzText(o, x);
  return null;
}

// --- time ---------------------------------------------------------------------------------------------------------------------------------

/** Insert `beats` of empty time at `beat`: everything at or after it moves later. A clip that crosses `beat` is refused (zeit_schnitt). */
export function zeitEinfuegen(p: Projekt, beat: number, beats: number): void {
  const t = grenzText(p, [beat]);
  if (t !== null) ab('zeit_schnitt', t);
  for (const o of alleClips(p)) {
    if (o.clip.start_beat < beat - EPS) continue;
    o.clip.start_beat = runde9(o.clip.start_beat + beats);
    if (ende(o.clip) > MAX_BEAT) ab('zu_gross', `clip "${o.clip.name}" on track "${o.spur.name}" would end past beat ${MAX_BEAT}`);
  }
  for (const { strang } of alleStraenge(p)) {
    for (const l of strang.automation ?? []) for (const q of l.punkte) if (q.beat >= beat - EPS) q.beat = runde9(q.beat + beats);
  }
  // the loop and the punch range: a start at or after the beat moves, an end behind it moves (an end exactly at the beat is the end of what lies before)
  for (const [r, was] of bereiche(p)) {
    if (r.von_beat >= beat - EPS) r.von_beat = runde9(r.von_beat + beats);
    if (r.bis_beat > beat + EPS) r.bis_beat = runde9(r.bis_beat + beats);
    if (r.bis_beat > MAX_BEAT) ab('zu_gross', `the ${was} would end past beat ${MAX_BEAT}`);
  }
}

/** The ranges that ripple with the time: the project loop and, only when the project has `aufnahme`, its punch range (never created here). */
function bereiche(p: Projekt): [{ von_beat: number; bis_beat: number }, string][] {
  const r: [{ von_beat: number; bis_beat: number }, string][] = [[p.loop, 'loop']];
  if (p.aufnahme) r.push([p.aufnahme.punch, 'punch range']);
  return r;
}

/** D12: the points of a lane inside [b, e) go; the value the lane had at `e` stays at the cut `b` by a point there; the points from `e` on move by `n`. */
function entferneAusLane(l: Lane, b: number, e: number, n: number): void {
  const vorn = l.punkte.filter((q) => q.beat < b - EPS);
  const drin = l.punkte.filter((q) => q.beat >= b - EPS && q.beat < e - EPS);
  const hinten = l.punkte.filter((q) => q.beat >= e - EPS);
  const treffer = hinten.length > 0 && hinten[0].beat - e < EPS;      // a point right at `e` lands on the cut itself
  const schnitt = !treffer && (drin.length > 0 || (vorn.length > 0 && hinten.length > 0));
  const wert = schnitt ? laneWert(l.punkte, e, l.ziel) : 0;
  l.punkte = [...vorn, ...(schnitt ? [{ beat: b, wert }] : []), ...hinten.map((q) => ({ ...q, beat: runde9(q.beat - n) }))];
}

/**
 * Remove the time [beat, beat + beats): everything from the end of the range on moves earlier. A clip that touches the range (crosses a border of it
 * or lies inside it) is refused (zeit_schnitt). Lane points inside the range are dropped (D12); a loop end inside the range goes to `beat`.
 */
export function zeitEntfernen(p: Projekt, beat: number, beats: number): void {
  const e = runde9(beat + beats);
  for (const o of alleClips(p)) {
    if (!(o.clip.start_beat < e - EPS && ende(o.clip) > beat + EPS)) continue;
    ab('zeit_schnitt', kreuzt(o.clip, beat) ? kreuzText(o, beat) : kreuzt(o.clip, e) ? kreuzText(o, e) : drinText(o));
  }
  for (const o of alleClips(p)) if (o.clip.start_beat >= e - EPS) o.clip.start_beat = runde9(o.clip.start_beat - beats);
  for (const { strang } of alleStraenge(p)) for (const l of strang.automation ?? []) entferneAusLane(l, beat, e, beats);
  const hin = (x: number): number => (x <= beat + EPS ? x : x >= e - EPS ? runde9(x - beats) : beat);
  const von = hin(p.loop.von_beat), bis = hin(p.loop.bis_beat);
  if (bis - von < 1) {        // the loop lay inside the removed time: it has no place any more, so it is switched off (a loop is at least 1 beat)
    p.loop.an = false;
    p.loop.von_beat = von; p.loop.bis_beat = von + 1;
  } else { p.loop.von_beat = von; p.loop.bis_beat = bis; }
  if (p.aufnahme) {           // the punch range the same way: no place any more means both punch switches off and a valid range (bis > von)
    const pu = p.aufnahme.punch, pv = hin(pu.von_beat), pb = hin(pu.bis_beat);
    if (pb - pv < EPS) { pu.ein = false; pu.aus = false; pu.von_beat = pv; pu.bis_beat = pv + 1; } else { pu.von_beat = pv; pu.bis_beat = pb; }
  }
}

// --- the raw time commands with a stored section list ---------------------------------------------------------------------------------------

const abschnittAb = (text: string): never => ab('zeit_abschnitt', text);
/** zeit_einfuegen: the time moves and, with a stored section list, the section that holds `beat` grows (the last one for a beat at or behind the end). */
export function zeitEinfuegenMitListe(p: Projekt, beat: number, beats: number): void {
  const l = p.tracker?.abschnitte;
  zeitEinfuegen(p, beat, beats);
  if (!l || l.length === 0) return;
  let i = l.findIndex((_, k) => vonBeat(l, k) <= beat + EPS && beat < vonBeat(l, k + 1) - EPS);
  if (i < 0) i = l.length - 1;
  const neu = runde9(l[i].laenge_beats + beats);
  if (neu > ABSCHNITT_BEATS_MAX) ab('argument_ungueltig', `a section is at most ${ABSCHNITT_BEATS_MAX} beats long`);
  l[i].laenge_beats = neu;
}
/** zeit_entfernen: the time goes and, with a stored list, the section that holds the range shrinks; else (zeit_abschnitt) refused. */
export function zeitEntfernenMitListe(p: Projekt, beat: number, beats: number): void {
  const l = p.tracker?.abschnitte;
  const e = runde9(beat + beats);
  const i = !l || l.length === 0 ? -1 : l.findIndex((_, k) => vonBeat(l, k) <= beat + EPS && e <= vonBeat(l, k + 1) + EPS);
  if (l && l.length > 0) {
    if (i < 0) abschnittAb('the range crosses a section border: use the section commands');
    if (l[i].laenge_beats - beats < EPS) abschnittAb('the range covers a whole section: delete the section instead');
  }
  zeitEntfernen(p, beat, beats);
  if (l && i >= 0) l[i].laenge_beats = runde9(l[i].laenge_beats - beats);
}

// --- sections -----------------------------------------------------------------------------------------------------------------------------

/** The default list of a project without `abschnitte`: sections of 16 beats up to the end of the last clip (the same as the page shows), ids a1, a2, ... */
export function standardListe(p: Projekt): TrackerAbschnitt[] {
  let schluss = 0;
  for (const s of p.spuren) for (const c of s.clips) schluss = Math.max(schluss, ende(c));
  const n = Math.max(1, Math.ceil(schluss / ABSCHNITT_VORGABE_BEATS - EPS));
  return Array.from({ length: n }, (_, i) => ({ id: `a${i + 1}`, laenge_beats: ABSCHNITT_VORGABE_BEATS }));
}
/** The section list of the project; a project without one gets the default list written (and the marker, when it has none). */
export function holeListe(p: Projekt): TrackerAbschnitt[] {
  p.tracker ??= { schema: 1 };
  return (p.tracker.abschnitte ??= standardListe(p));
}
const vonBeat = (l: TrackerAbschnitt[], i: number): number => runde9(l.slice(0, i).reduce((s, a) => s + a.laenge_beats, 0));
function suche(l: TrackerAbschnitt[], id: string): number {
  const i = l.findIndex((a) => a.id === id);
  if (i < 0) ab('abschnitt_unbekannt', `${id} is no section of this project`);
  return i;
}
function neueAbschnittId(l: TrackerAbschnitt[]): string {
  const n = l.reduce((m, a) => Math.max(m, Number(a.id.slice(1))), 0) + 1;
  return `a${n}`;
}
function pruefeZahl(l: TrackerAbschnitt[], laenge: number): void {
  if (l.length >= ABSCHNITTE_MAX) ab('zu_gross', `at most ${ABSCHNITTE_MAX} sections`);
  if (laenge > ABSCHNITT_BEATS_MAX) ab('argument_ungueltig', `a section is at most ${ABSCHNITT_BEATS_MAX} beats long`);
}
/** Refuse (abschnitt_grenze) when a clip crosses one of the borders the command would cut. */
function pruefeGrenzen(p: Projekt, beats: number[]): void {
  const t = grenzText(p, beats);
  if (t !== null) ab('abschnitt_grenze', t);
}
/** The rows per beat of the project (the marker's lpb, default 4) */
export const projektLpb = (p: Projekt): number => p.tracker?.lpb ?? 4;

/** New section of `zeilen` rows at the project LPB, after the section `nach` or at the end. Returns its id. */
export function abschnittNeu(p: Projekt, nach: string | undefined, zeilen: number, name: string | undefined): string {
  const l = holeListe(p);
  const laenge = runde9(zeilen / projektLpb(p));
  pruefeZahl(l, laenge);
  const i = nach === undefined ? l.length - 1 : suche(l, nach);
  const pos = vonBeat(l, i + 1);
  pruefeGrenzen(p, [pos]);
  zeitEinfuegen(p, pos, laenge);
  const id = neueAbschnittId(l);
  l.splice(i + 1, 0, { id, ...(name === undefined ? {} : { name }), laenge_beats: laenge });
  return id;
}

const innen = (c: Clip, von: number, bis: number): boolean => c.start_beat >= von - EPS && ende(c) <= bis + EPS;

/** A new section behind `id` of the same length; the clips inside are copied to the same offset, as members of their pattern (`verknuepft`) or unique. */
export function abschnittDuplizieren(p: Projekt, id: string, als: 'verknuepft' | 'kopie'): string {
  const l = holeListe(p);
  const i = suche(l, id), von = vonBeat(l, i), laenge = l[i].laenge_beats, bis = runde9(von + laenge);
  pruefeZahl(l, laenge);
  pruefeGrenzen(p, [von, bis]);
  const quellen = p.spuren.flatMap((s) => s.clips.filter((c) => innen(c, von, bis)).map((c) => ({ s, c })));
  zeitEinfuegen(p, bis, laenge);
  for (const { s, c } of quellen) {
    const kopie = { ...structuredClone(c), id: neueId(p, 'clip'), start_beat: runde9(c.start_beat + laenge) };
    if (c.art === 'midi') {
      if (als === 'verknuepft') { const m = c as MidiClip; m.verbund ??= neueId(p, 'verbund'); (kopie as MidiClip).verbund = m.verbund; }
      else delete (kopie as { verbund?: string }).verbund;
    }
    s.clips.splice(s.clips.indexOf(c) + 1, 0, kopie);
  }
  const neu = neueAbschnittId(l);
  l.splice(i + 1, 0, { id: neu, ...(l[i].name === undefined ? {} : { name: l[i].name }), laenge_beats: laenge });
  return neu;
}

/** Delete the section: the clips fully inside go, the time is removed. The last section cannot be deleted (abschnitt_letzter). */
export function abschnittLoeschen(p: Projekt, id: string): void {
  const l = holeListe(p);
  const i = suche(l, id);
  if (l.length < 2) ab('abschnitt_letzter', 'the last section cannot be deleted');
  const von = vonBeat(l, i), laenge = l[i].laenge_beats, bis = runde9(von + laenge);
  pruefeGrenzen(p, [von, bis]);
  for (const o of alleClips(p)) if (innen(o.clip, von, bis)) o.liste.splice(o.liste.indexOf(o.clip), 1);
  zeitEntfernen(p, von, laenge);
  l.splice(i, 1);
}

/** Swap the section with its neighbour (richtung -1 = earlier, 1 = later): clips and lane points of both move, the loop stays. */
export function abschnittVerschieben(p: Projekt, id: string, richtung: number): void {
  const l = holeListe(p);
  const i = suche(l, id), j = i + richtung;
  if (j < 0 || j >= l.length) ab('abschnitt_rand', `the section is already the ${richtung < 0 ? 'first' : 'last'} one`);
  const k = Math.min(i, j);                       // the earlier of the two sections swaps with the one behind it
  const von = vonBeat(l, k), la = l[k].laenge_beats, lb = l[k + 1].laenge_beats;
  const mitte = runde9(von + la), bis = runde9(mitte + lb);
  pruefeGrenzen(p, [von, mitte, bis]);
  const lage = (x: number, c?: Clip): number | null => {        // the shift of an item at x (c: a clip with its end)
    if (c ? innen(c, von, mitte) : x >= von - EPS && x < mitte - EPS) return lb;
    if (c ? innen(c, mitte, bis) : x >= mitte - EPS && x < bis - EPS) return -la;
    return null;
  };
  for (const o of alleClips(p)) { const d = lage(o.clip.start_beat, o.clip); if (d !== null) o.clip.start_beat = runde9(o.clip.start_beat + d); }
  for (const { strang } of alleStraenge(p)) {
    for (const lane of strang.automation ?? []) {
      for (const q of lane.punkte) { const d = lage(q.beat); if (d !== null) q.beat = runde9(q.beat + d); }
      lane.punkte.sort((x, y) => x.beat - y.beat);
    }
  }
  [l[k], l[k + 1]] = [l[k + 1], l[k]];
}

/** D11: the section gets `zeilen` rows at the project LPB. The clips that cover it exactly change their length with it. */
export function abschnittLaenge(p: Projekt, id: string, zeilen: number): void {
  const l = holeListe(p);
  const i = suche(l, id);
  const alt = l[i].laenge_beats, neu = runde9(zeilen / projektLpb(p));
  if (neu > ABSCHNITT_BEATS_MAX) ab('argument_ungueltig', `a section is at most ${ABSCHNITT_BEATS_MAX} beats long`);
  if (Math.abs(neu - alt) < EPS) return;
  const von = vonBeat(l, i), bis = runde9(von + alt);
  const deckt = (c: Clip): boolean => Math.abs(c.start_beat - von) < EPS && Math.abs(ende(c) - bis) < EPS;
  const orte = alleClips(p);
  for (const o of orte) {
    if (!deckt(o.clip)) continue;
    if (o.clip.art === 'midi' && mitglieder(p, o.clip.id).length > 1) {
      ab('abschnitt_verknuepft', `clip "${o.clip.name}" on track "${o.spur.name}" is linked to another section: make it UNIQUE first`);
    }
  }
  const andere = orte.filter((o) => !deckt(o.clip));
  const hinten = neu > alt ? [bis] : [runde9(von + neu), bis];          // the borders the change would cut
  for (const o of andere) {
    if (neu < alt && o.clip.start_beat < bis - EPS && ende(o.clip) > von + neu + EPS) {
      ab('abschnitt_grenze', kreuzt(o.clip, hinten[0]) ? kreuzText(o, hinten[0]) : kreuzt(o.clip, bis) ? kreuzText(o, bis) : drinText(o));
    }
  }
  if (neu > alt) pruefeGrenzen(p, [bis]);
  for (const o of orte) {                                                // check before anything is written
    if (!deckt(o.clip) || o.clip.art !== 'audio') continue;
    if (o.clip.fade_ein_beats + o.clip.fade_aus_beats > neu + EPS) ab('fade_zu_lang', `${o.clip.fade_ein_beats} + ${o.clip.fade_aus_beats} > ${neu}`);
  }
  const decker = orte.filter((o) => deckt(o.clip)).map((o) => o.clip);
  const passe = (): void => {
    for (const c of decker) {
      c.laenge_beats = neu;
      if (c.loop_beats != null && c.loop_beats > neu) c.loop_beats = neu;             // a shorter length pulls the loop along, as clip_aendern does
      for (const h of c.huellkurven ?? []) if (h.loop_beats !== undefined && h.loop_beats > neu) h.loop_beats = neu;
    }
  };
  // growing: make room first (the covering clips end at the border and do not cross it); shrinking: the covering clips shrink first, so they leave the range
  if (neu > alt) { zeitEinfuegen(p, bis, neu - alt); passe(); } else { passe(); zeitEntfernen(p, runde9(von + neu), alt - neu); }
  l[i].laenge_beats = neu;
}

/** Rename a section; null removes the name. */
export function abschnittUmbenennen(p: Projekt, id: string, name: string | null): void {
  const l = holeListe(p);
  const a = l[suche(l, id)];
  if (name === null) delete a.name; else a.name = name;
}
