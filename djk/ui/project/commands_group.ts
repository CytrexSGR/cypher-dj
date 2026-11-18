// Group, routing, SEQ deck and workbench commands, and the rack and its macros of the project API (handler table of commands.ts, moved unchanged).
// The handlers reach each other through PRO_BEFEHL (commands_helpers.ts) at call time; commands.ts merges the tables.
import {
  blendFader, blendPfad, NEU_TRIM_MIN, NEU_TRIM_MAX, FADER_MAX, FADER_MIN, MAX_BEAT, MAX_GRUPPEN, MAX_SPUREN, insertWertParameter, type InsertPoolArt,
  alleInserts, sucheStrang, alleRacks, gliedMakroParam, makroFaehig, MAKRO_NAME_MAX, MAX_MAKROS, MAX_MAKRO_ZIELE, MAX_RACK, MAX_VARIATIONEN,
  type RackZiel, SPUR_FARBEN, istObjekt, neueId, pruefeModulFehler, sucheSpur, type RackGeraet, MAX_GLIEDER, type Gruppe, type Projekt, type Spur,
} from './model.ts';
import { MAX_WERKBANK_SPUREN } from './werkbank.ts';
import { SEQ_BEATS, seqGruppe, seqRegion } from './seq.ts';
import { nachkommen, pruefeAlleSchluessel, vorfahren } from './routing_rules.ts';
import {
  ab, erlaube, zahlOk, zahl, flagge, text, gruppeArg, idArg, variationArgs, spurVon, freezeFeld, gruppeVon, kettenLanenBereinigen,
  bereinigeGliedZiele, FARBE_OK, GRUPPE_LEICHT, rackGeraetVon, baueGlied, listeArg, PRO_BEFEHL, type Args, type Kontext, type Handler,
} from './commands_helpers.ts';

// --- SEQ deck v2 (spec 2026-11-14-seq-deck-design, sections 4 and 5) ------------------------------------------------------
// A pattern clip: loop_beats is the pattern length, the clip covers the whole live region
const SEQ_LOOP_VORGABE = 4;
const WERKBANK_LOOP_VORGABE = 16;   // default pattern length of a workbench track (beats)

// Shared body of seq_folge_neu (g = its deck group) and werkbank_spur_neu (g = null: the track plays into the master): the instrument track,
// -6 dB, its one MIDI clip of seqRegion(p) beats, envelopes, `stumm`. The name is unique among the tracks of the group, or among all instrument tracks.
function musterSpurNeu(p: Projekt, a: Args, ctx: Kontext, g: Gruppe | null): void {
  const name = text(a, 'name', 80, false)!;
  if (p.spuren.some((s) => (g ? s.ausgang?.id === g.id : s.art === 'instrument') && s.name.toLowerCase() === name.toLowerCase())) {
    ab('argument_ungueltig', g
      ? `name: the deck already has a pattern called ${name} (names are unique, ignoring case)`
      : `name: the module already has a track called ${name} (names are unique, ignoring case)`);
  }
  if (a.geraet === undefined) ab('argument_ungueltig', 'geraet: the instrument of the pattern expected');
  const loop = a.loop_beats === undefined ? (g ? SEQ_LOOP_VORGABE : WERKBANK_LOOP_VORGABE) : zahl(a, 'loop_beats', 0.125, seqRegion(p))!;
  if (Math.abs(loop * 8 - Math.round(loop * 8)) > 1e-9) ab('argument_ungueltig', 'loop_beats: a multiple of 0.125 beat expected');
  const stumm = flagge(a, 'stumm', true) ?? false;
  const huell = a.huellkurven === undefined ? [] : listeArg(a, 'huellkurven');
  PRO_BEFEHL.spur_neu(p, { befehl: 'spur_neu', art: 'instrument', name, geraet: a.geraet }, ctx);
  const spur = p.spuren[p.spuren.length - 1];
  // a start level with headroom: two new patterns at 0 dB would reach 0 dBFS in the sum. A workbench track may name its own (a sliced loop is mixed material)
  spur.fader_db = (g ? undefined : zahl(a, 'fader_db', FADER_MIN, FADER_MAX, { opt: true })) ?? -6;
  if (g) PRO_BEFEHL.ziel_setzen(p, { befehl: 'ziel_setzen', strang_id: spur.id, ausgang: { art: 'gruppe', id: g.id } }, ctx);
  PRO_BEFEHL.clip_neu(p, { befehl: 'clip_neu', spur_id: spur.id, art: 'midi', start_beat: 0, laenge_beats: seqRegion(p), loop_beats: loop, name,
    ...(a.noten !== undefined ? { noten: a.noten } : {}), ...(a.seq !== undefined ? { seq: a.seq } : {}) }, ctx);
  const clip = spur.clips[0];
  for (const h of huell) {
    if (!istObjekt(h)) ab('argument_ungueltig', 'huellkurven: a list of objects expected');
    PRO_BEFEHL.huellkurve_setzen(p, { ...h, befehl: 'huellkurve_setzen', clip_id: clip.id }, ctx);
  }
  if (stumm) spur.mute = true;
}

export const GRUPPE = {
  // 1.9 U7 (spec 4.4, E11): the member list of a rack track. A structure change = a playback swap (like a device change).
  // glied.id absent = add with the lowest free id g1..g4; present = replace that member. The model checks zones and counts at the end of the command.
  rack_glied_setzen(p, a, ctx) {
    erlaube(a, 'spur_id', 'glied');
    const g = rackGeraetVon(p, a);
    if (!istObjekt(a.glied)) ab('argument_ungueltig', 'glied: object expected');
    const id = a.glied.id;
    if (id !== undefined && typeof id !== 'string') ab('argument_ungueltig', 'glied.id: string expected');
    const stelle = id === undefined ? -1 : g.glieder.findIndex((m) => m.id === id);
    if (id !== undefined && stelle < 0) ab('glied_unbekannt', String(id));
    let neuId = id as string | undefined;
    if (id === undefined) {
      neuId = ['g1', 'g2', 'g3', 'g4'].find((k) => !g.glieder.some((m) => m.id === k));
      if (neuId === undefined) ab('rack_voll_glieder', `at most ${MAX_GLIEDER} members per rack`);
    }
    const andere = new Set(g.glieder.filter((_, i) => i !== stelle).flatMap((x) => (x.geraet.art === 'wirt' ? [x.geraet.slot] : [])));
    const m = baueGlied(p, { ...a.glied, id: neuId }, 'glied', a.spur_id as string, ctx, andere);
    if (stelle >= 0) g.glieder[stelle] = m; else g.glieder.push(m);
    freezeFeld(spurVon(p, a.spur_id as string));
    bereinigeGliedZiele(spurVon(p, a.spur_id as string));   // 1.9 U8 T8: a replaced member keeps only the targets its new device allows
  },

  rack_glied_entfernen(p, a) {
    erlaube(a, 'spur_id', 'glied_id');
    const g = rackGeraetVon(p, a);
    if (typeof a.glied_id !== 'string') ab('argument_ungueltig', 'glied_id: string expected');
    const stelle = g.glieder.findIndex((m) => m.id === a.glied_id);
    if (stelle < 0) ab('glied_unbekannt', a.glied_id);
    if (g.glieder.length === 1) ab('rack_letztes_glied', 'the last member cannot go; convert the track to a plain device instead');
    g.glieder.splice(stelle, 1);
    freezeFeld(spurVon(p, a.spur_id as string));
    bereinigeGliedZiele(spurVon(p, a.spur_id as string));   // 1.9 U8 T8: never a dangling `glied` id; undo restores both
  },

  rack_kette(p, a) {
    erlaube(a, 'spur_id', 'kette');
    const g = rackGeraetVon(p, a);
    if (!zahlOk(a.kette) || !Number.isInteger(a.kette) || a.kette < 0 || a.kette > 127) ab('argument_ungueltig', 'kette: integer 0..127 expected');
    g.kette = a.kette;
    freezeFeld(spurVon(p, a.spur_id as string));
  },

  // Paket 1.18, E-c: die gewählte Spur laut (mute false), alle anderen Spuren derselben Gruppe stumm (mute true); Spuren außerhalb der Gruppe
  // bleiben unberührt. Ein Befehl, also ein Undo-Schritt. Die Spur muss zur Gruppe gehören (sonst argument_ungueltig).
  variante_waehlen(p, a) {
    erlaube(a, 'gruppe', 'spur_id');
    const gruppe = gruppeArg(a, false) as string;
    const gewaehlt = spurVon(p, idArg(a, 'spur_id'));
    if (gewaehlt.gruppe !== gruppe) ab('argument_ungueltig', `spur_id: ${gewaehlt.id} gehört nicht zur Gruppe ${gruppe}`);
    for (const s of p.spuren) if (s.gruppe === gruppe) s.mute = s !== gewaehlt;
  },

  // 1.10 Slice 1 (P4): Gruppen-Spuren. Die Namen vermeiden das Feld `gruppe` der Varianten (Paket 1.18, E-c).
  gruppenspur_neu(p, a) {
    erlaube(a, 'name', 'farbe', 'mitglieder');
    const gl = (p.gruppen ??= []);
    if (gl.length >= MAX_GRUPPEN) ab('routing_grenze', `all ${MAX_GRUPPEN} groups are used`);
    const nr = Array.from({ length: MAX_GRUPPEN }, (_, i) => i + 1).find((n) => !gl.some((g) => g.nr === n)) ?? ab('routing_grenze', 'no free group number');
    if (a.farbe !== undefined && (typeof a.farbe !== 'string' || !FARBE_OK.test(a.farbe))) ab('argument_ungueltig', 'farbe: #rrggbb erwartet');
    let mitglieder: (Spur | Gruppe)[] = [];
    if (a.mitglieder !== undefined) {
      if (!Array.isArray(a.mitglieder) || a.mitglieder.length < 1 || a.mitglieder.length > MAX_SPUREN) {
        ab('argument_ungueltig', 'mitglieder: nicht leere Liste von Spur-IDs erwartet');
      }
      const ids = new Set<string>();
      mitglieder = a.mitglieder.map((x: unknown) => {
        if (typeof x !== 'string' || ids.has(x)) return ab('argument_ungueltig', 'mitglieder: Spur-IDs ohne Doppelte erwartet');
        ids.add(x);
        return sucheSpur(p, x) ?? (p.gruppen ?? []).find((q) => q.id === x) ?? ab('spur_unbekannt', x);   // a member is a track or a group
      });
    }
    const g: Gruppe = { id: neueId(p, 'gruppe'), nr, name: text(a, 'name', 80) ?? `Group ${nr}`, farbe: a.farbe ?? SPUR_FARBEN[(nr - 1) % SPUR_FARBEN.length],
      fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false };
    gl.push(g);
    // only the top-most selected members move: a selected member that already plays into another selected group stays inside it
    const gewaehlt = new Set(mitglieder.map((m) => m.id));
    for (const s of mitglieder) {
      const oben = s.ausgang ? [s.ausgang.id, ...vorfahren(p, s.ausgang.id)] : [];
      if (!oben.some((id) => gewaehlt.has(id))) s.ausgang = { art: 'gruppe', id: g.id };   // the new group is a leaf now, so no member can be above it
    }
    pruefeAlleSchluessel(p);
  },

  gruppenspur_aendern(p, a) {
    erlaube(a, 'gruppe_id', 'name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'gefaltet');
    const g = gruppeVon(p, idArg(a, 'gruppe_id'));
    if (GRUPPE_LEICHT.every((k) => a[k] === undefined)) ab('argument_ungueltig', 'keine Änderung angegeben');
    const name = text(a, 'name', 80);
    if (a.farbe !== undefined && (typeof a.farbe !== 'string' || !FARBE_OK.test(a.farbe))) ab('argument_ungueltig', 'farbe: #rrggbb erwartet');
    const fader = zahl(a, 'fader_db', FADER_MIN, FADER_MAX, { opt: true }), pan = zahl(a, 'pan', -1, 1, { opt: true });
    const mute = flagge(a, 'mute', true), solo = flagge(a, 'solo', true), gefaltet = flagge(a, 'gefaltet', true);
    if (name !== undefined) g.name = name;
    if (a.farbe !== undefined) g.farbe = a.farbe;
    if (fader !== undefined) g.fader_db = fader;
    if (pan !== undefined) g.pan = pan;
    if (mute !== undefined) g.mute = mute;
    if (solo !== undefined) g.solo = solo;
    if (gefaltet !== undefined) g.gefaltet = gefaltet;
  },

  // Live modules (decision 7): the blend of a stem group. Stores `blend` (0..1) on the group and sets the faders of its two tracks (the original audio
  // track and the new instrument track) by the equal-power law. A group without a new path has no blend (kein_neuer_pfad).
  blend_setzen(p, a) {
    erlaube(a, 'gruppe_id', 'wert');
    const g = gruppeVon(p, idArg(a, 'gruppe_id'));
    const wert = zahl(a, 'wert', 0, 1)!;
    const pf = blendPfad(p, g.id);
    if (pf === null) ab('kein_neuer_pfad', `${g.id} has no new instrument path to blend`);
    const f = blendFader(wert, g.neu_trim_db ?? 0);
    g.blend = wert;
    pf.original.fader_db = f.original;
    pf.neu.fader_db = f.neu;
  },

  // Level offset of the new path against the original (dB, measured by the server after the MIDI render): stored on the stem group; the new fader follows
  // the current blend with it. 0 removes the field.
  blend_trim_setzen(p, a) {
    erlaube(a, 'gruppe_id', 'db');
    const g = gruppeVon(p, idArg(a, 'gruppe_id'));
    const db = zahl(a, 'db', NEU_TRIM_MIN, NEU_TRIM_MAX)!;
    const pf = blendPfad(p, g.id);
    if (pf === null) ab('kein_neuer_pfad', `${g.id} has no new instrument path to trim`);
    if (db === 0) delete g.neu_trim_db; else g.neu_trim_db = db;
    pf.neu.fader_db = blendFader(g.blend ?? 0, db).neu;
  },

  // Live modules (plan live-module decision 15): marks a top-level group as the module of slot A or B. Internal: only baueModul (project/live.ts) calls it
  // as one step of building the module tree; gruppenspur_aendern's allow list stays as it is. One module per slot.
  modul_setzen(p, a) {
    erlaube(a, 'gruppe_id', 'modul');
    const g = gruppeVon(p, idArg(a, 'gruppe_id'));
    if (g.ausgang) ab('argument_ungueltig', 'modul: only a group that plays into the master can be a module');
    const f = pruefeModulFehler(a.modul);
    if (f) ab('argument_ungueltig', f);
    const slot = (a.modul as { slot?: 'A' | 'B' }).slot;
    const belegt = (p.gruppen ?? []).some((x) => x.id !== g.id && x.ausgang === undefined && x.modul?.slot === slot);
    if (slot !== undefined && belegt) ab('slot_belegt', `live slot ${slot} is taken`);
    g.modul = structuredClone(a.modul) as NonNullable<Gruppe['modul']>;
  },

  // SEQ deck: the empty top group `SEQ <platz>` at 0 dB with the marker {schema: 2, platz} in the live container. The patterns come with
  // seq_folge_neu. The group limit is the model's own: it refuses the step.
  seq_anlegen(p, a, ctx) {
    erlaube(a, 'platz');
    if (!p.live) ab('kein_liveprojekt', 'a SEQ deck sits in the live container');
    const platz = a.platz;
    if (platz !== 1 && platz !== 2 && platz !== 3 && platz !== 4) ab('argument_ungueltig', 'platz: integer 1..4 expected');
    if (seqGruppe(p, platz as number)) ab('seq_belegt', `place ${platz} already holds a SEQ deck`);
    PRO_BEFEHL.gruppenspur_neu(p, { befehl: 'gruppenspur_neu', name: `SEQ ${platz}` }, ctx);
    p.gruppen![p.gruppen!.length - 1].seq = { schema: 2, platz: platz as 1 | 2 | 3 | 4 };
  },

  // SEQ deck: one pattern = an instrument track that plays into the deck group, with its one MIDI clip (name = track name, beat 0, seqRegion beats = 64 in 4/4,
  // loop_beats = pattern length, 4 unless given). One command, because a list cannot name the ids of what it creates. `geraet` is what spur_neu
  // takes; `stumm: true` mutes the track (a pattern Cypher creates starts muted). The track limits are the model's own. The name is unique in the
  // deck, ignoring case. A pattern written as text arrives complete in this one command: `noten` (as clip_neu takes them, no ids), `seq` (the view
  // descriptor) and `huellkurven` (a list of {ziel, punkte, verknuepft?, loop_beats?} as huellkurve_setzen takes them); the command is refused as a
  // whole, so a text never leaves half a pattern.
  seq_folge_neu(p, a, ctx) {
    erlaube(a, 'gruppe_id', 'name', 'geraet', 'loop_beats', 'stumm', 'noten', 'seq', 'huellkurven');
    const g = gruppeVon(p, idArg(a, 'gruppe_id'));
    if (!g.seq) ab('seq_fehlt', `${g.id} holds no SEQ deck`);
    musterSpurNeu(p, a, ctx, g);
  },

  // Workbench module: one instrument track to the master with its pattern clip (same body as seq_folge_neu, no group). Refused outside a module
  // (kein_werkbank) and beyond MAX_WERKBANK_SPUREN instrument tracks (werkbank_voll).
  werkbank_spur_neu(p, a, ctx) {
    erlaube(a, 'name', 'geraet', 'loop_beats', 'stumm', 'noten', 'seq', 'huellkurven', 'fader_db');
    if (!p.werkbank) ab('kein_werkbank', 'the open project is not a workbench module');
    if (p.spuren.filter((s) => s.art === 'instrument').length >= MAX_WERKBANK_SPUREN) {
      ab('werkbank_voll', `a module holds at most ${MAX_WERKBANK_SPUREN} instrument tracks`);
    }
    musterSpurNeu(p, a, ctx, null);
  },

  // Loop range of a workbench module: {von_beat, bis_beat} (whole beats, at least 1, inside the module length) remembers the module length in
  // werkbank.laenge_beats if it is not there yet and sets the project loop to the range; {aus: true} sets the loop back to 0..laenge_beats and removes the
  // field (nothing to do while no length is remembered). A range outside the module is modul_bereich.
  werkbank_bereich(p, a) {
    erlaube(a, 'von_beat', 'bis_beat', 'aus');
    if (!p.werkbank) ab('kein_werkbank', 'the open project is not a workbench module');
    if (a.aus !== undefined) {
      if (a.aus !== true || a.von_beat !== undefined || a.bis_beat !== undefined) ab('argument_ungueltig', 'aus: true alone expected (no von_beat, bis_beat)');
      const laenge = p.werkbank.laenge_beats;
      if (laenge === undefined) return;
      p.loop = { an: true, von_beat: 0, bis_beat: laenge };
      delete p.werkbank.laenge_beats;
      return;
    }
    const von = zahl(a, 'von_beat', 0, MAX_BEAT, { ganz: true })!, bis = zahl(a, 'bis_beat', 0, MAX_BEAT, { ganz: true })!;
    if (bis - von < 1) ab('loop_bereich', `bis_beat - von_beat must be at least 1 (${von}..${bis})`);
    const laenge = p.werkbank.laenge_beats ?? p.loop.bis_beat;
    if (bis > laenge) ab('modul_bereich', `${von}..${bis} lies outside the module length ${laenge}`);
    p.werkbank.laenge_beats = laenge;
    p.loop = { an: true, von_beat: von, bis_beat: bis };
  },

  // SEQ deck: removes the group and every track that plays into it, with their clips, in one step. A sub-group that plays into the group
  // is not part of the deck: it moves to the group's own target (the master), as gruppenspur_loeschen does.
  seq_leeren(p, a, ctx) {
    erlaube(a, 'gruppe_id');
    const g = gruppeVon(p, idArg(a, 'gruppe_id'));
    if (!g.seq) ab('seq_fehlt', `${g.id} holds no SEQ deck`);
    for (const s of p.spuren.filter((x) => x.ausgang?.id === g.id)) PRO_BEFEHL.spur_loeschen(p, { befehl: 'spur_loeschen', spur_id: s.id }, ctx);
    PRO_BEFEHL.gruppenspur_loeschen(p, { befehl: 'gruppenspur_loeschen', gruppe_id: g.id }, ctx);
  },

  gruppenspur_loeschen(p, a) {   // tracks and child groups move to the deleted group's own target (its parent or master, same step), never orphaned targets
    erlaube(a, 'gruppe_id');
    const gl = (p.gruppen ??= []);
    const g = gruppeVon(p, idArg(a, 'gruppe_id'));
    for (const s of [...p.spuren, ...gl]) if (s.ausgang?.id === g.id) { if (g.ausgang) s.ausgang = { art: 'gruppe', id: g.ausgang.id }; else delete s.ausgang; }
    gl.splice(gl.indexOf(g), 1);
    // slice 5: a key on this group would dangle
    for (const x of alleInserts(p)) if (x.insert.key?.quelle === 'grp' && x.insert.key.nr === g.nr) delete x.insert.key;
    pruefeAlleSchluessel(p);   // the children moved up: levels changed, a remaining key may now be late
  },

  // strang_id: a track or group ID. A track may feed any group; a group may feed the master or another group, except itself or one of its
  // descendants (routing_zyklus).
  ziel_setzen(p, a) {
    erlaube(a, 'strang_id', 'ausgang');
    const id = idArg(a, 'strang_id');
    const z = a.ausgang;
    let gid: string | null;
    if (z === 'master' || (istObjekt(z) && z.art === 'master')) gid = null;
    else if (istObjekt(z) && z.art === 'gruppe' && typeof z.id === 'string') gid = z.id;
    else return ab('argument_ungueltig', "ausgang: 'master' oder {art: 'gruppe', id} erwartet");
    if (gid !== null && !(p.gruppen ?? []).some((g) => g.id === gid)) ab('ziel_unbekannt', gid);
    const spur = sucheSpur(p, id);
    if (spur) {
      if (gid === null) delete spur.ausgang; else spur.ausgang = { art: 'gruppe', id: gid };
      pruefeAlleSchluessel(p);
      return;
    }
    const grp = (p.gruppen ?? []).find((g) => g.id === id);
    if (!grp) return ab('spur_unbekannt', id);
    if (gid === null) { delete grp.ausgang; pruefeAlleSchluessel(p); return; }
    if (gid === grp.id) return ab('routing_zyklus', `group ${id} cannot feed itself`);
    if (nachkommen(p, grp.id).gruppen.includes(gid)) return ab('routing_zyklus', `group ${gid} plays into group ${id}, so ${id} cannot feed it`);
    grp.ausgang = { art: 'gruppe', id: gid };
    pruefeAlleSchluessel(p);   // levels and ancestors changed: a key that is now a cycle or too late refuses the move
  },

  master_aendern(p, a) {
    erlaube(a, 'fader_db');
    (p.master ??= { fader_db: 0 }).fader_db = zahl(a, 'fader_db', FADER_MIN, FADER_MAX)!;
  },

  // 1.10 slice 4c (spec D13): the rack of a strip. `makros` = up to four entries `{name?, ziel: [{insert, param, von, bis}]}` (macro 1..4 in
  // order); the whole mapping is replaced.
  // `insert` is a stage of the strip's own chain, `param` a continuous parameter of its kind (not `an`, not `sc`), `von`/`bis` in its real range
  // (macro 0 gives von, macro 1 gives bis).
  // A parameter has one macro at most (ziel_doppelt), at most MAX_MAKRO_ZIELE mappings per strip (makro_voll), MAX_RACK racks in the project
  // (rack_voll). No mapping at all removes the rack.
  // The live macro values stay with the rack (new rack: 0). Structure change = new playback.
  rack_setzen(p, a) {
    erlaube(a, 'strang_id', 'makros');
    const id = idArg(a, 'strang_id');
    const strang = sucheStrang(p, id) ?? ab('spur_unbekannt', id);
    const roh = a.makros;
    if (!Array.isArray(roh) || roh.length > MAX_MAKROS) ab('argument_ungueltig', `makros: Liste mit höchstens ${MAX_MAKROS} Einträgen erwartet`);
    const kette = strang.inserts ?? [];
    const namen: string[] = [], makros: { ziel: RackZiel[] }[] = [];
    const gesehen = new Set<string>();
    for (let i = 0; i < MAX_MAKROS; i++) {
      const m: unknown = i < (roh as unknown[]).length ? (roh as unknown[])[i] : {};   // only a missing entry is an empty macro; null is refused
      if (!istObjekt(m)) ab('argument_ungueltig', `makros[${i}]: Objekt erwartet`);
      for (const k of Object.keys(m)) if (k !== 'name' && k !== 'ziel') ab('argument_unbekannt', `makros[${i}].${k}`);
      const name = m.name === undefined ? '' : m.name;
      if (typeof name !== 'string' || name.length > MAKRO_NAME_MAX) {
        ab('argument_ungueltig', `makros[${i}].name: Text mit höchstens ${MAKRO_NAME_MAX} Zeichen erwartet`);
      }
      namen.push(name);
      const roh_z = m.ziel === undefined ? [] : m.ziel;
      if (!Array.isArray(roh_z)) ab('argument_ungueltig', `makros[${i}].ziel: Liste erwartet`);
      const ziel: RackZiel[] = [];
      (roh_z as unknown[]).forEach((zx, k) => {
        const wo = `makros[${i}].ziel[${k}]`;
        if (!istObjekt(zx)) ab('argument_ungueltig', `${wo}: Objekt erwartet`);
        if ('glied' in zx) {   // 1.9 U8 T7 (E12): a target on a member of the rack device of this track
          for (const key of Object.keys(zx)) if (!['glied', 'param', 'von', 'bis'].includes(key)) ab('argument_unbekannt', `${wo}.${key}`);
          const spur = sucheSpur(p, id);
          if (!spur || spur.art !== 'instrument' || spur.geraet?.art !== 'rack') ab('glied_ohne_rack', `${wo}.glied: ${id} is not a rack track`);
          const gid = zx.glied;
          if (typeof gid !== 'string') ab('argument_ungueltig', `${wo}.glied: member id expected`);
          const m = (spur!.geraet as RackGeraet).glieder.find((x) => x.id === gid) ?? ab('glied_unbekannt', `${String(gid)} is no member of ${id}`);
          if (m.geraet.art === 'wirt') ab('makro_ziel_wirt', `${wo}.glied: ${m.id} is a Surge member; a macro cannot drive it`);
          const pn = zx.param;
          const q = typeof pn === 'string' ? gliedMakroParam(m.geraet, pn) : undefined;
          if (!q) ab('argument_unbekannt', `${wo}.param: ${String(pn)} (member ${m.id})`);
          const von = zahl(zx as Args, 'von', q!.min, q!.max)!, bis = zahl(zx as Args, 'bis', q!.min, q!.max)!;
          const gkey = `${m.id}/${pn as string}`;
          if (gesehen.has(gkey)) ab('ziel_doppelt', `${gkey}: one parameter has one macro`);
          gesehen.add(gkey);
          ziel.push({ glied: m.id, param: pn as string, von, bis });
          return;
        }
        for (const key of Object.keys(zx)) if (!['insert', 'param', 'von', 'bis'].includes(key)) ab('argument_unbekannt', `${wo}.${key}`);
        const iid = zx.insert;
        if (typeof iid !== 'string') ab('argument_ungueltig', `${wo}.insert: ID erwartet`);
        const st = kette.find((x) => x.id === iid) ?? ab('insert_unbekannt', `${String(iid)} is no stage of the chain of ${id}`);
        const art = st.art as InsertPoolArt;
        const pn = zx.param;
        if (typeof pn !== 'string' || !insertWertParameter(art).some((x) => x.name === pn)) ab('argument_unbekannt', `${wo}.param: ${String(pn)}`);
        if (!makroFaehig(art, pn as string)) {
          ab('param_nicht_stetig', `${wo}.param: ${String(pn)} is a switch or a step list; a macro drives continuous parameters`);
        }
        const q = insertWertParameter(art).find((x) => x.name === pn)!;
        if ((strang.automation ?? []).some((l) => l.ziel === `insert.${st.id}.${q.name}`)) {   // one writer per parameter (spec D13): a lane already drives it
          ab('param_hat_lane', `${st.id}.${q.name} has a lane; delete the lane first (auto_loeschen) or automate the macro instead`);
        }
        const von = zahl(zx as Args, 'von', q.min, q.max)!, bis = zahl(zx as Args, 'bis', q.min, q.max)!;
        const key = `${st.id}/${pn}`;
        if (gesehen.has(key)) ab('ziel_doppelt', `${st.id}.${pn as string}: one parameter has one macro`);
        gesehen.add(key);
        ziel.push({ insert: st.id, param: pn as string, von, bis });
      });
      makros.push({ ziel });
    }
    const n = makros.reduce((x, m) => x + m.ziel.length, 0);
    if (n > MAX_MAKRO_ZIELE) ab('makro_voll', `${n} mappings; at most ${MAX_MAKRO_ZIELE} per strip`);
    if (n === 0) { delete strang.rack; kettenLanenBereinigen(strang); return; }
    const belegt = new Set(alleRacks(p).filter((x) => x.strang !== strang).map((x) => x.rack.slot));
    const freierSlot = Array.from({ length: MAX_RACK }, (_, i) => i + 1).find((x) => !belegt.has(x));
    const slot = strang.rack?.slot ?? freierSlot ?? ab('rack_voll', `all ${MAX_RACK} racks are used`);
    const variationen = strang.rack?.variationen;   // 1.9 T10: a new mapping keeps the stored variations
    strang.rack = { slot, namen, makros, werte: strang.rack ? [...strang.rack.werte] : [0, 0, 0, 0], ...(variationen ? { variationen } : {}) };
    kettenLanenBereinigen(strang);
  },

  // The live value of macro `nr` (1..4) of the rack of a strip, 0..1. Control change only (light command): no new playback.
  rack_makro(p, a) {
    erlaube(a, 'strang_id', 'nr', 'wert');
    const id = idArg(a, 'strang_id');
    const strang = sucheStrang(p, id) ?? ab('spur_unbekannt', id);
    const nr = zahl(a, 'nr', 1, MAX_MAKROS, { ganz: true })!;
    const wert = zahl(a, 'wert', 0, 1)!;
    if (!strang.rack) ab('rack_unbekannt', `${id} has no rack`);
    strang.rack!.werte[nr - 1] = wert;
  },

  // 1.9 T10 (E13): named snapshots of the 4 live macro values of a strip's rack (pure project data, no playback). Save stores the current values
  // (an existing name is replaced in place; a ninth distinct name is variation_voll), load sets the values (a control change like rack_makro),
  // delete removes one (the last one drops the field).
  makro_variation_speichern(p, a) {
    const { rack, name } = variationArgs(p, a);
    const liste = rack.variationen ?? [];
    const k = liste.findIndex((v) => v.name === name);
    if (k < 0 && liste.length >= MAX_VARIATIONEN) ab('variation_voll', `a rack holds at most ${MAX_VARIATIONEN} variations`);
    const neu = { name, werte: [...rack.werte] };
    rack.variationen = k < 0 ? [...liste, neu] : liste.map((v, i) => (i === k ? neu : v));
  },

  makro_variation_laden(p, a) {
    const { rack, name } = variationArgs(p, a);
    const v = (rack.variationen ?? []).find((x) => x.name === name) ?? ab('variation_unbekannt', `${name}: no such variation`);
    rack.werte = [...v.werte];
  },

  makro_variation_loeschen(p, a) {
    const { rack, name } = variationArgs(p, a);
    const liste = rack.variationen ?? [];
    if (!liste.some((x) => x.name === name)) ab('variation_unbekannt', `${name}: no such variation`);
    const rest = liste.filter((x) => x.name !== name);
    if (rest.length) rack.variationen = rest; else delete rack.variationen;
  },
} satisfies Record<string, Handler>;
