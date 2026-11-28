import {
  type Clip, type Gruppe, ID, type Insert, type InsertPoolArt, type InsertZiel, type LoopRaster, MAX_MAKROS, type Master, type Projekt,
  type Rack, type Return, SZENEN_ZEILEN, type SessionSzene, type Spur, type Take, type Zelle, gliedMakroParam, glieder, insertParamIndex,
  insertWertNamen, istGliedZiel, istHalten, istInsertZiel,
} from './model_types.ts';

// --- IDs ------------------------------------------------------------------------------------------------------------
const ZIFFERN = /^\d+$/;
// ids of all clips of the project, main clips and take clips
const alleClipIds = (p: Projekt): string[] => p.spuren.flatMap((s) => [...s.clips, ...(s.takes ?? []).flatMap((t) => t.clips)].map((c) => c.id));
export function hoechste(ids: Iterable<string>, praefix: string): number {
  let m = 0;
  for (const id of ids) if (id.length > 1 && id[0] === praefix && ZIFFERN.test(id.slice(1))) m = Math.max(m, Number(id.slice(1)));
  return m;
}
// Spur-IDs s<n>, Clip-IDs c<n> projektweit, Noten-IDs n<n> aus einem Zähler für alle Clips (eindeutig sind sie je Clip). Eine ID wird nie
// wiederverwendet (Spec 6.26): Löschen ist eine Vorwärts-Änderung, und ein spätes Ereignis (Dekodieren, Kern-Quittung) darf nie das falsche Objekt
// treffen. Das Projekt führt dazu den Zähler naechste_id je Art und naechste_noten_id; sie steigen nur und stehen in keinem Patch (patch.ts),
// Undo und Redo lassen sie also stehen. Der Noten-Zähler liegt im Projekt, nicht im Clip (Spec 6.28): ein Clip ist Teil der Undo-Patches, ein
// Redo brachte seinen Zählerstand von damals mit. Fehlt ein Zähler (älteres Projekt), gilt das Maximum der vorhandenen IDs plus 1, beim
// Noten-Zähler auch ein alter Clip-Zähler. Die Funktionen ändern den Zähler an `p` selbst: sie gehören auf den Entwurf eines Befehls.
// Lane-IDs a<n> (Automation Slice 1): der Zähler naechste_id.lane entsteht erst mit der ersten Lane (wie naechste_noten_id), damit Projekte ohne Lane
// Byte für Byte gleich bleiben und ein älterer Stand sie weiter liest; setzeFehlendeZaehler fasst ihn nicht an.
// Return-IDs r<n> (slice 3): like the lane counter, naechste_id.return arises with the first return. Insert IDs i<n> (slice 4): the same, with the first stage.
// Take ids t<n> (1.14): like the lane counter, naechste_id.take arises with the first use. Clip ids are project wide over main AND take clips.
export function neueId(p: Projekt,
  art: 'spur' | 'clip' | 'gruppe' | 'lane' | 'return' | 'insert' | 'take' | 'verbund' | 'zelle' | 'szene' | 'marker' | 'mod'): string {
  if (art === 'szene') return neueSzenenId(p);
  if (art === 'marker') return neueMarkerId(p);
  if (art === 'mod') return neueModId(p);
  const praefix = art === 'spur' ? 's' : art === 'clip' ? 'c' : art === 'lane' ? 'a' : art === 'return' ? 'r'
    : art === 'insert' ? 'i' : art === 'take' ? 't' : art === 'verbund' ? 'v' : art === 'zelle' ? 'z' : 'g';
  const ids = art === 'spur' ? p.spuren.map((s) => s.id)
    : art === 'clip' ? alleClipIds(p)
      : art === 'take' ? p.spuren.flatMap((s) => (s.takes ?? []).map((t) => t.id))
        : art === 'zelle' ? alleZellenIds(p)
        : art === 'verbund' ? p.spuren.flatMap((s) => s.clips.flatMap((c) => (c.art === 'midi' && c.verbund !== undefined ? [c.verbund] : [])))
        : art === 'lane' ? alleStraenge(p).flatMap((x) => (x.strang.automation ?? []).map((l) => l.id))
          : art === 'return' ? (p.returns ?? []).map((r) => r.id)
            : art === 'insert' ? alleInserts(p).map((x) => x.insert.id) : (p.gruppen ?? []).map((g) => g.id);
  const lebend = hoechste(ids, praefix);
  const n = Math.max(p.naechste_id?.[art] ?? 1, lebend + 1);
  p.naechste_id = { ...p.naechste_id, [art]: n + 1 };
  return `${praefix}${n}`;
}
// Scene ids sz<n> (session view): own two-letter prefix, so `hoechste` (one character) does not serve. Like the lane counter, naechste_id.szene
// arises with the first scene command; the defaults of sessionSzenen are sz1..sz8, so the first new id is sz9.
function neueSzenenId(p: Projekt): string {
  let lebend = 0;
  for (const s of sessionSzenen(p)) { const m = /^sz(\d+)$/.exec(s.id); if (m) lebend = Math.max(lebend, Number(m[1])); }
  const n = Math.max(p.naechste_id?.szene ?? 1, lebend + 1);
  p.naechste_id = { ...p.naechste_id, szene: n + 1 };
  return `sz${n}`;
}
// Marker ids m<n>: the counter naechste_id.marker arises with the first marker; it never falls, so the id of a deleted marker does not come back.
function neueMarkerId(p: Projekt): string {
  const lebend = hoechste((p.marker ?? []).map((m) => m.id), 'm');
  const n = Math.max(p.naechste_id?.marker ?? 1, lebend + 1);
  p.naechste_id = { ...p.naechste_id, marker: n + 1 };
  return `m${n}`;
}
// Strand 6: modulator ids m<n>, the same rule with their own counter naechste_id.mod (it arises with the first modulator and never falls)
function neueModId(p: Projekt): string {
  const lebend = hoechste((p.modulatoren ?? []).map((m) => m.id), 'm');
  const n = Math.max(p.naechste_id?.mod ?? 1, lebend + 1);
  p.naechste_id = { ...p.naechste_id, mod: n + 1 };
  return `m${n}`;
}
// Stand des Noten-Zählers: der Projekt-Zähler, sonst das Maximum aller Noten-IDs und alter Clip-Zähler (Spec 6.28) plus 1
export function notenZaehler(p: Projekt): number {
  if (p.naechste_noten_id !== undefined) return p.naechste_noten_id;
  let m = 1;
  for (const s of p.spuren) {
    for (const c of s.clips) if (c.art === 'midi') m = Math.max(m, hoechste(c.noten.map((x) => x.id), 'n') + 1, c.naechste_noten_id ?? 1);
  }
  return m;
}
export function neueNotenId(p: Projekt): string {
  const n = notenZaehler(p);
  p.naechste_noten_id = n + 1;
  return `n${n}`;
}
// Nummer einer Noten-ID der Form n<ziffern>, sonst null (eine eigene ID wie „kick“ zählt nicht)
export const notenNummer = (id: string): number | null => (id.length > 1 && id[0] === 'n' && ZIFFERN.test(id.slice(1)) ? Number(id.slice(1)) : null);
// Spec 6.28: alte Clip-Zähler (erster S2int-Bau) ins Projekt übernehmen (Maximum) und am Clip entfernen. Ändert `p` selbst.
export function uebernimmNotenZaehler(p: Projekt): void {
  let alt = false;
  for (const s of p.spuren) for (const c of s.clips) if (c.art === 'midi' && c.naechste_noten_id !== undefined) alt = true;
  if (!alt) return;
  const projektweit = p.naechste_noten_id;
  delete p.naechste_noten_id;
  p.naechste_noten_id = Math.max(projektweit ?? 1, notenZaehler(p));
  for (const s of p.spuren) for (const c of s.clips) if (c.art === 'midi') delete c.naechste_noten_id;
}

// Spec 6.35 (zu 6.26): fehlen einem älteren Projekt die Zähler, setzt sie schon das Öffnen auf das Maximum der vorhandenen IDs plus 1, nicht
// erst das erste Anlegen (neueId rechnet sonst mit den lebenden IDs, und eine vorher gelöschte höchste ID käme wieder). Ein vorhandener Zähler
// bleibt, wie er ist (er steigt nur). Ändert `p` selbst.
export function setzeFehlendeZaehler(p: Projekt): void {
  const z = p.naechste_id;
  p.naechste_id = {
    spur: z?.spur ?? hoechste(p.spuren.map((s) => s.id), 's') + 1,
    clip: z?.clip ?? hoechste(alleClipIds(p), 'c') + 1,
    gruppe: z?.gruppe ?? hoechste((p.gruppen ?? []).map((g) => g.id), 'g') + 1,
    ...(z?.lane !== undefined ? { lane: z.lane } : {}),     // nur ein vorhandener Lane-Zähler bleibt, angelegt wird er hier nie
    ...(z?.return !== undefined ? { return: z.return } : {}),   // slice 3: same for the return counter
    ...(z?.insert !== undefined ? { insert: z.insert } : {}),   // slice 4: and for the insert counter
    ...(z?.take !== undefined ? { take: z.take } : {}),         // 1.14: same for the take counter
    ...(z?.verbund !== undefined ? { verbund: z.verbund } : {}),   // tracker patterns: same, it arises with the first link
    ...(z?.zelle !== undefined ? { zelle: z.zelle } : {}),         // loop deck: same, it arises with the first cell
    ...(z?.szene !== undefined ? { szene: z.szene } : {}),         // session view: same, it arises with the first scene command
    ...(z?.marker !== undefined ? { marker: z.marker } : {}),      // arrangement markers: same, it arises with the first marker
    ...(z?.mod !== undefined ? { mod: z.mod } : {}),               // strand 6 modulators: same, it arises with the first modulator
  };
  if (p.naechste_noten_id === undefined) p.naechste_noten_id = notenZaehler(p);
}

// every filled cell of the project (all tracks)
export function* alleZellen(p: Projekt): Generator<Zelle> {
  for (const s of p.spuren) for (const z of s.zellen ?? []) if (z && !istHalten(z)) yield z;
}
// every cell id of the project (all tracks)
function alleZellenIds(p: Projekt): string[] {
  return p.spuren.flatMap((s) => (s.zellen ?? []).flatMap((z) => (z && !istHalten(z) ? [z.id] : [])));
}
// The loop deck group of a place (1 = deck A, 2 = deck B): the top group whose `loopdeck.platz` is `platz`
export function loopDeckGruppe(p: Projekt, platz: 1 | 2): Gruppe | null {
  return (p.gruppen ?? []).find((g) => g.loopdeck?.platz === platz && !g.ausgang) ?? null;
}
// The place (container 1..4 = A..D) a top group sits in; null = parked (a live top group no place holds) or no live project
export function platzVonGruppe(p: Projekt, gruppeId: string): 1 | 2 | 3 | 4 | null {
  const i = (p.plaetze ?? []).findIndex((x) => 'gruppe' in x && x.gruppe === gruppeId);
  return i < 0 ? null : (i + 1) as 1 | 2 | 3 | 4;
}
// The first place a new group may take without displacing anything: a `leer` or `track` place, scanning 3, 4, 1, 2 (the old defaults first); null = none free
export function ersterFreierPlatz(p: Projekt): 1 | 2 | 3 | 4 | null {
  for (const n of [3, 4, 1, 2] as const) { const t = p.plaetze?.[n - 1]?.typ; if (t === 'leer' || t === 'track') return n; }
  return null;
}
// The strudel group of the project (placed or parked), if any
export const strudelGruppe = (p: Projekt): Gruppe | null => (p.gruppen ?? []).find((g) => g.strudel !== undefined && !g.ausgang) ?? null;
// The strom track that reads stream `strom`, if any
export const stromSpur = (p: Projekt, strom: number): Spur | null => p.spuren.find((s) => s.art === 'strom' && s.strom === strom) ?? null;
// Live top groups that hold a deck, a module or the strudel marker but sit in no place (parked: silent, nothing deleted)
export function geparkteGruppen(p: Projekt): Gruppe[] {
  if (p.live !== true) return [];
  return (p.gruppen ?? []).filter((g) => !g.ausgang && (g.seq || g.loopdeck || g.modul || g.strudel) && platzVonGruppe(p, g.id) === null);
}
// The 4 tracks of a loop deck group in member order (the order of the track list)
export function loopDeckSpuren(p: Projekt, g: Gruppe): Spur[] {
  return p.spuren.filter((s) => s.ausgang?.id === g.id);
}

export function sucheSpur(p: Projekt, id: string): Spur | undefined { return p.spuren.find((s) => s.id === id); }
export function sucheGruppe(p: Projekt, id: string): Gruppe | undefined { return (p.gruppen ?? []).find((g) => g.id === id); }
// slice 4: every stage of the project with the strip that carries it. `strang` is the owner object, `id` its ID ('master' for the master).
export type InsertTraeger = Spur | Gruppe | Return | Master;
export function alleInserts(p: Projekt): { strang: InsertTraeger; strangId: string; insert: Insert }[] {
  const aus: { strang: InsertTraeger; strangId: string; insert: Insert }[] = [];
  const von = (st: InsertTraeger, id: string): void => { for (const insert of st.inserts ?? []) aus.push({ strang: st, strangId: id, insert }); };
  for (const s of p.spuren) von(s, s.id);
  for (const g of p.gruppen ?? []) von(g, g.id);
  for (const r of p.returns ?? []) von(r, r.id);
  if (p.master) von(p.master, 'master');
  return aus;
}
/** the pooled rows ins/<art>/<slot>/* of a stage with its values (komp 12, eq 86, saett 7, lim 3, utility 5): values first, the key (komp, eq),
 * the switch `an` LAST
 *  (a stage never sounds half set) */
export function insertZeilen(i: Insert): Record<string, number> {
  const r: Record<string, number> = {};
  const art = i.art as InsertPoolArt;
  for (const k of insertWertNamen(art)) r[`ins/${i.art}/${i.slot}/${k}`] = i.werte[k];
  if (art === 'komp' || art === 'eq' || art === 'mb') r[`ins/${i.art}/${i.slot}/sc`] = i.sc ?? 0;
  r[`ins/${i.art}/${i.slot}/an`] = i.an ? 1 : 0;
  return r;
}
/** every rack of the project with the strip that carries it */
export function alleRacks(p: Projekt): { strang: InsertTraeger; strangId: string; rack: Rack }[] {
  return alleStraenge(p).filter((x) => x.strang.rack).map((x) => ({ strang: x.strang, strangId: x.strangId, rack: x.strang.rack! }));
}
export function alleStraenge(p: Projekt): { strang: InsertTraeger; strangId: string }[] {
  return [
    ...p.spuren.map((s) => ({ strang: s as InsertTraeger, strangId: s.id })),
    ...(p.gruppen ?? []).map((g) => ({ strang: g as InsertTraeger, strangId: g.id })),
    ...(p.returns ?? []).map((r) => ({ strang: r as InsertTraeger, strangId: r.id })),
    ...(p.master ? [{ strang: p.master as InsertTraeger, strangId: 'master' }] : []),
  ];
}
/** the pooled rows rack/<slot>/m1..m4 of a rack with its live macro values */
export function rackZeilen(r: Rack): Record<string, number> {
  const z: Record<string, number> = {};
  for (let i = 0; i < MAX_MAKROS; i++) z[`rack/${r.slot}/m${i + 1}`] = r.werte[i];
  return z;
}
/** the macro (1-based) and rack that drive a parameter of a stage, or undefined */
export function makroVon(strang: InsertTraeger, insertId: string, param: string): { nr: number; ziel: InsertZiel } | undefined {
  const rack = strang.rack;
  if (!rack) return undefined;
  for (let i = 0; i < rack.makros.length; i++) {
    const ziel = rack.makros[i].ziel.find((z) => istInsertZiel(z) && z.insert === insertId && z.param === param);
    if (ziel) return { nr: i + 1, ziel: ziel as InsertZiel };
  }
  return undefined;
}
/** the mapping table of a rack as the playback sees it: the stage by its position in the chain, the parameter by its index */
export type RackSichtZiel = { makro: number; stufe: number; param: number; von: number; bis: number }
  | { makro: number; glied: number; param: number; von: number; bis: number };   // 1.9 U8 T7: `glied` = position of the member in the rack device
export type RackSicht = { slot: number; ziele: RackSichtZiel[] };
export function rackSicht(strang: InsertTraeger): RackSicht | undefined {
  const rack = strang.rack, kette = strang.inserts ?? [];
  if (!rack) return undefined;
  const ziele: RackSichtZiel[] = [];
  const mitglieder = glieder(strang as Spur);
  rack.makros.forEach((m, i) => {
    for (const z of m.ziel) {
      if (istGliedZiel(z)) {
        const gi = mitglieder.findIndex((x) => x.id === z.glied), q = gi >= 0 ? gliedMakroParam(mitglieder[gi].geraet, z.param) : undefined;
        if (q) ziele.push({ makro: i, glied: gi, param: q.index, von: z.von, bis: z.bis });
        continue;
      }
      const stufe = kette.findIndex((x) => x.id === z.insert);
      if (stufe >= 0) ziele.push({ makro: i, stufe, param: insertParamIndex(kette[stufe].art as InsertPoolArt, z.param), von: z.von, bis: z.bis });
    }
  });
  return { slot: rack.slot, ziele };
}
/** the strip with this ID: a track, a group, a return or 'master' */
export function sucheStrang(p: Projekt, id: string): InsertTraeger | undefined {
  return id === 'master' ? p.master : sucheSpur(p, id) ?? sucheGruppe(p, id) ?? (p.returns ?? []).find((r) => r.id === id);
}
export function sucheClip(p: Projekt, id: string): { spur: Spur; clip: Clip } | undefined {
  for (const spur of p.spuren) { const clip = spur.clips.find((c) => c.id === id); if (clip) return { spur, clip }; }
  return undefined;
}

export function sucheTakeClip(p: Projekt, clipId: string): { spur: Spur; take: Take; clip: Clip } | null {
  for (const spur of p.spuren) {
    for (const take of spur.takes ?? []) { const clip = (take.clips as Clip[]).find((c) => c.id === clipId); if (clip) return { spur, take, clip }; }
  }
  return null;
}
// 1.14: an empty takes list is never written (old files stay byte for byte). The load drops it;
// every command that can leave an empty list must call this on its draft. Changes `p` itself.
export function entferneLeereTakes(p: Projekt): void {
  for (const s of p.spuren) if (s.takes !== undefined && s.takes.length === 0) delete s.takes;
}

const standardSzene = (n: number): SessionSzene => ({ id: `sz${n}`, name: '', farbe: 0 });
// the eight scenes of a project: the stored ones, else eight defaults (name '', colour 0; ids sz1..sz8). Reading writes nothing.
export function sessionSzenen(p: Projekt | undefined): SessionSzene[] {
  return p?.session?.szenen ?? Array.from({ length: SZENEN_ZEILEN }, (_, i) => standardSzene(i + 1));
}
// the global launch grid: the stored one, else 'takt'
// Without a session block the grid is the one the loop decks already launch on (a project from before the session view), else takt.
export const sessionRaster = (p: Projekt): LoopRaster =>
  p.session?.raster ?? loopDeckGruppe(p, 1)?.loopdeck?.raster ?? loopDeckGruppe(p, 2)?.loopdeck?.raster ?? 'takt';
