import { platzVonGruppe, rackSicht } from './model_ids.ts';
import {
  type Geraet, type GliedGeraet, type Insert, type InsertSchluessel, type InsertSorte, type Lane, type Projekt, type Spur, glieder,
  istHalten,
} from './model_types.ts';

// --- Wiedergabe-Sicht -----------------------------------------------------------------------------------------------
// Alles, was den Klang des Kerns bestimmt, und nichts sonst. Zwei Stände mit gleicher Sicht brauchen keine neue Wiedergabe
// (Mixer, Namen, Farben, Tempo, Loop und Metronom laufen über eigene Wege); `betrifft_wiedergabe` der Befehle und das Verwerfen
// eines Freeze beruhen darauf.
type KettenStufe = { art: InsertSorte; slot: number; key?: InsertSchluessel; plugin?: string; latenz_extra?: number; graph?: string };
export const kettenSicht = (liste: readonly Insert[]): KettenStufe[] =>
  // slice 5: a structural key is playback structure
  liste.map((i) => ({ art: i.art, slot: i.slot, ...(i.key ? { key: { quelle: i.key.quelle, nr: i.key.nr, punkt: i.key.punkt } } : {}),
    ...(i.art === 'bk' ? { graph: i.graph! } : {}),   // arr-bk: another graph is another stage (structure)
    // plan 1.11 task 7 (D4): the extra latency is structure (it is in the playback file); a host stage of another plugin is another stage
    ...(i.art === 'host' ? { plugin: `${i.plugin!.format}:${i.plugin!.pfad}#${i.plugin!.uid}`,
      ...(i.latenz_extra ? { latenz_extra: i.latenz_extra } : {}) } : {}) }));
// 1.16 rest T2.5: the preset origin of a device is not playback (no new playback, no dropped freeze when only it changes)
const ohnePreset = (g: Geraet | undefined): Geraet | undefined => {
  if (g?.art === 'rack') return { ...g, glieder: g.glieder.map((m) => ({ ...m, geraet: ohnePreset(m.geraet) as GliedGeraet })) };   // members too (U7)
  if (!g || !('preset' in g)) return g;
  const { preset: _p, ...rest } = g;
  return rest as Geraet;
};
export function spurSicht(s: Spur, mitFreeze = true): unknown {
  return {
    nr: s.nr, art: s.art, ...(s.strom !== undefined ? { strom: s.strom } : {}), geraet: ohnePreset(s.geraet) ?? null,
    // MIDI stage: changes the notes the device plays (so it also drops a freeze); absent adds no key
    ...(s.midi ? { midi: s.midi } : {}),
      ...(mitFreeze ? { freeze: s.freeze ?? null } : {}),
    // 1.10: das Ziel gehört zur Wiedergabe, nicht zum Freeze (ein Ziel-Wechsel verwirft keinen Freeze)
    ...(mitFreeze && s.ausgang ? { ausgang: s.ausgang.id } : {}),
    // slice 4: the chain is playback structure (art and slot: `an`, the values and the row key `sc` are controls; slice 5: a structural `key` is part of it),
    // not part of a freeze
    // (D12: the freeze tap is before the chain)
    ...(mitFreeze && s.inserts?.length ? { inserts: kettenSicht(s.inserts) } : {}),
    ...(mitFreeze && s.rack ? { rack: rackSicht(s) } : {}),   // slice 4c: the mapping table is playback structure (the macro values are controls)
    // Automation Slice 1: die Lane ändert die Wiedergabe, aber keinen Freeze (Spec 1.12); fehlt sie, bleibt die Sicht bit-gleich
    ...(mitFreeze && s.automation?.length
      ? { automation: s.automation.map((l) => ({ ziel: l.ziel, punkte: l.punkte.map((q) => [q.beat, q.wert, q.form ?? 'linear']) })) } : {}),
    // 1.12 slice 5 (D14): gain and modulation envelopes change the playback, not a freeze; transpose envelopes sit in the MIDI clip entry below (they
    // change the host notes, so they also drop a freeze). Absent envelopes add no key: the view stays byte for byte the same
    ...(mitFreeze && s.clips.some((c) => (c.huellkurven ?? []).some((h) => h.ziel !== 'transpose'))
      ? { huellkurven: s.clips.flatMap((c) => (c.huellkurven ?? []).filter((h) => h.ziel !== 'transpose').map((h) => ({ clip: c.id, ...h }))) } : {}),
    // loop deck cells: only what the snapshot is built from (sha, kind, beats, gain, the slot); a rename or a recolour is no new playback. Absent adds no key.
    // `filter` is a control row (spur/<n>/filter), not playback
    // S1b: the editor fields change the snapshot too (added only when present, so a cell without them keeps its view); bpm only where it stands in for a
    // missing beats
    ...(s.zellen ? { zellen: s.zellen.map((z) => (z && !istHalten(z)
      ? { sha256: z.sha256, art: z.art, beats: z.beats ?? null, gain_db: z.gain_db,
        ...(z.beats === undefined && z.bpm !== undefined && (z.scheiben || z.huellen) ? { bpm: z.bpm } : {}),
        ...(z.transponieren !== undefined ? { transponieren: z.transponieren } : {}), ...(z.rueckwaerts ? { rueckwaerts: true } : {}),
        ...(z.blende ? { blende: true } : {}), ...(z.keylock === false ? { keylock: false } : {}),
        ...(z.scheiben ? { scheiben: z.scheiben.grenzen.map((g, k) => [g, z.scheiben!.folge[k]]) } : {}),
        ...(z.huellen ? { huellen: z.huellen.map((h) => ({ ziel: h.ziel, punkte: h.punkte.map((q) => [q.beat, q.wert, q.form ?? 'linear']) })) } : {}) }
      : null)) } : {}),
    clips: s.clips.map((c) => (c.art === 'audio'
      ? { id: c.id, art: c.art, sha256: c.quelle.sha256, dekodiert: c.dekodiert, start_beat: c.start_beat, laenge_beats: c.laenge_beats,
        loop_beats: c.loop_beats ?? null, offset_s: c.offset_s, gain_db: c.gain_db, fade_ein_beats: c.fade_ein_beats, fade_aus_beats: c.fade_aus_beats,
        warp: c.warp?.an ? c.warp : null, ...(c.stumm ? { stumm: true } : {}) }   // Paket 1.13: ein Warp an ändert den Klang, ein Warp aus nicht
      : { id: c.id, art: c.art, start_beat: c.start_beat, laenge_beats: c.laenge_beats, loop_beats: c.loop_beats ?? null, noten: c.noten,
        ...(c.zeilen ? { zeilen: c.zeilen } : {}),   // row settings change the unrolling; absent: the view stays byte for byte the same
        ...(c.huellkurven?.some((h) => h.ziel === 'transpose') ? { transpose: c.huellkurven.find((h) => h.ziel === 'transpose') } : {}) })),
  };
}
// 1.12 slice 6: the lanes of a group, return or the master change the playback like those of a track (spurSicht); absent lanes add no key
const laneSicht = (st: { automation?: Lane[] }): { automation?: unknown } => st.automation?.length
  ? { automation: st.automation.map((l) => ({ ziel: l.ziel, punkte: l.punkte.map((q) => [q.beat, q.wert, q.form ?? 'linear']) })) } : {};
export const wiedergabeSicht = (p: Projekt): unknown => ({
  spuren: [...p.spuren].sort((a, b) => a.nr - b.nr).map((s) => spurSicht(s)),
  // a scale stage that follows the project key reads it: a key change is a new playback (only then; absent adds no key)
  ...(p.tonart && p.spuren.some((s) => s.midi?.skala && 'quelle' in s.midi.skala) ? { midi_tonart: p.tonart } : {}),
  // the production lane reaches the playback only through tracks whose scale follows the project (plan strand 7, 5.1): a lane edit is then a new playback
  ...(p.harmonie && p.spuren.some((s) => s.midi?.skala && 'quelle' in s.midi.skala) ?
    { midi_harmonie: p.harmonie.eintraege.map((e) => [e.beat, e.grundton, e.skala]) } : {}),
  // 1.10: die Topologie nur, wenn es welche gibt (neutral: wie vorher)
  ...((p.gruppen ?? []).length ? { gruppen: [...p.gruppen].sort((a, b) => a.nr - b.nr)
    .map((g) => ({ id: g.id, nr: g.nr, ...(g.ausgang ? { ausgang: g.ausgang.id } : {}),
      // live: the place of a top group decides the container it plays into (absent = parked); the grid (`raster`) is server business and stays out
      ...(platzVonGruppe(p, g.id) !== null ? { dj: platzVonGruppe(p, g.id) } : {}),
      ...(g.inserts?.length ? { inserts: kettenSicht(g.inserts) } : {}), ...(g.rack ? { rack: rackSicht(g) } : {}),
      ...laneSicht(g) })) } : {}),
  // 1.10 slice 3: the return topology (id, nr) only when there are returns; sends and hall values are controls, not part of the view
  ...((p.returns ?? []).length ? { returns: [...(p.returns ?? [])].sort((a, b) => a.nr - b.nr).map((r) => ({ id: r.id, nr: r.nr,
    // the owner's place decides the DJ output
    ...(r.pre ? { pre: true } : {}), ...(r.gruppe !== undefined && platzVonGruppe(p, r.gruppe) !== null ? { dj: platzVonGruppe(p, r.gruppe) } : {}),
    ...(r.inserts?.length ? { inserts: kettenSicht(r.inserts) } : {}), ...(r.rack ? { rack: rackSicht(r) } : {}),
    ...laneSicht(r) })) } : {}),
  // slice 4: only with a chain on the master
  ...(p.master?.inserts?.length
    ? { master: { inserts: kettenSicht(p.master.inserts), ...(p.master.rack ? { rack: rackSicht(p.master) } : {}), ...laneSicht(p.master) } }
    : {}),
  // strand 6: the switched-on modulators change the playback (the name does not); none: no key, the view stays byte for byte the same
  ...((p.modulatoren ?? []).some((m) => m.an !== false)
    ? { modulatoren: p.modulatoren!.filter((m) => m.an !== false).map(({ name: _n, ...m }) => m) } : {}),
});
