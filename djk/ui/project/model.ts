// Projektmodell D1 (Spec docs/masterplan/D1-SPEC.md 3.3): project.json im Format cypherdj-projekt/2 (/1 wird beim Laden gehoben, 1.10 P3).
// Typen, Prüfung, Erzeugung, IDs.
// Reine Funktionen, keine Datei, kein Server. Die Prüfung ist geschlossen: ein unbekanntes Feld ist ein Fehler (Tippfehler sollen
// auffallen, die Version des Formats ist festgelegt; Erweiterungen bekommen die nächste Nummer).
// Paket 1.13: Audio-Clips dürfen in /2 einen Warp tragen (ein weiteres optionales Feld, keine neue Nummer); in /1 ist warp ein unbekanntes Feld.
// The model was cut into sibling modules (modell_typen: types and constants, modell_ids: ids and lookups, modell_pruefe_teile and
// modell_pruefe_projekt: the closed check, modell_sicht: playback view, modell_modulator: modulators). This file only re-exports them,
// so every importer keeps its path.
export { INTERNE_EINGAENGE } from './model_types.ts';
export type { Punkt, LaneForm } from './lane.ts';
export {
  ARP_MUSTER, ARP_RATEN, AUFNAHME_VORGABE, AUTO_FORMEN, AUTO_ZIELE, BEATS_LOOP, BEATS_RASTER, BEATS_VORGABE, BK_GRAPH_NAME,
  BK_KNOPF_VORGABE, BK_LIVE_SLOTS, BK_PARAMETER, BK_ZIELE, DEKODIERT, DETUNE_MAX, ENTSTEHUNG_CODE_MAX, ENTSTEHUNG_GRAPH, EQ_BAENDER,
  EQ_MAX, EQ_MIN, EXTERN_MODI, FADER_MAX, FADER_MIN, FORMAT, FORMAT_ALT, FORMAT_ALT2, FX_CODES, FX_MAX_EINTRAEGE, FX_NUMMERN, GAIN_MAX,
  GAIN_MIN, GERAET_PRAEFIX, GESAMT_CT_MAX, GESAMT_CT_MIN, GLIED_GAIN_MAX, GLIED_GAIN_MIN, GLIED_ID, GLIED_PARAM_BK0, GLIED_PARAM_BK33,
  GLIED_PARAM_BK9, GLIED_PARAM_GAIN_DB, GLIED_RB_MAKRO_PARAMETER, GRUPPE_MAX, HALL_FELDER, HALL_VORGABE, HARMONIE_MAX, INSERT_ARTEN_AKTIV,
  INSERT_WERT_NAMEN, KENNUNG_MAX, KIT_NAME, LOOP_FARBEN, LOOP_MAX_FRAMES, LOOP_MIN, LOOP_RASTER_BEATS, LOOP_SEND_MAX, LOOP_SPUREN,
  LOOP_ZELLEN, MAKRO_NAME_MAX, MAX_ARM_AUDIO, MAX_AUTO_PUNKTE, MAX_BEAT, MAX_BK_SPUREN, MAX_CLIPS, MAX_FX_PUNKTE, MAX_GLIEDER,
  MAX_GLIED_PLAETZE, MAX_GRUPPEN, MAX_HOST, MAX_INS, MAX_INSERTS_PRO_STRANG, MAX_INS_BILD, MAX_INS_BK, MAX_INS_EQ, MAX_INS_GATE,
  MAX_INS_KOMP, MAX_INS_LIM, MAX_INS_MB, MAX_INS_SAETT, MAX_INS_TRANS, MAX_INS_UTIL, MAX_KETTEN_LANEN, MAX_KIT_GERAETE, MAX_LANES_PRO_SPUR,
  MAX_LANE_PUNKTE, MAX_LATENZ_EXTRA, MAX_MAKROS, MAX_MAKRO_ZIELE, MAX_MARKER, MAX_MODULATOREN, MAX_MOD_FELDER, MAX_MOD_ZIELE, MAX_NOTEN,
  MAX_RACK, MAX_RACK_GERAETE, MAX_RETURNS, MAX_SPUREN, MAX_STROEME, MAX_TAKES_PRO_SPUR, MAX_VARIATIONEN, MAX_ZEILEN, MOD_ABFALL_MAX,
  MOD_ABFALL_MIN, MOD_ABFALL_VORGABE, MOD_ANGRIFF_MAX, MOD_ANGRIFF_MIN, MOD_ANGRIFF_VORGABE, MOD_EMPFINDLICH_MAX, MOD_EMPFINDLICH_VORGABE,
  MOD_FELDER_NUR, MOD_FORMEN, MOD_GLATT_MAX, MOD_HZ_MAX, MOD_HZ_MIN, MOD_NAME_MAX, MOD_TAKT_MAX, MOD_TAKT_MIN, MOD_TAKT_VORGABE, MOD_TIEFE,
  MUSTER_CODE_MAX, PLAETZE, PLATZ_TYPEN, RB_PARAMETER, RB_VORGABE_NORM, RB_ZIELE, SAMPLERATE, SCHLUESSEL_QUELLEN, SPUR_FARBEN, SURGE_NAME,
  SURGE_PARAMETER_MAX, SZENEN_SLOTS, SZENEN_ZEILEN, SZENE_NAME_MAX, SZENE_TAKTE_MAX, TAKE_NAME_MAX, TAKTART_ZAEHLER_MAX,
  TAKTART_ZAEHLER_MIN, TEMPO_MAX, TEMPO_MIN, TRANSPOSE_MAX, TRANSPOSE_MIN, VARIATION_NAME_MAX, VERBUND_ID, VORZAEHLER_WERTE, WARP_MODI,
  WARP_QUELLEN, WIRT_SLOTS, ZELL_HUELLEN_MAX, ZELL_PUNKTE_MAX, ZELL_SCHEIBEN_MAX, ZELL_SLOT_MIN, ZELL_TEILUNGEN, ZELL_TRANSPONIEREN_MAX,
  ZELL_ZIELE, ZELL_ZIEL_BEREICH, ZIEL_BEREICH, aufnahmeVon, bkLive, bkSlot, eqZeilenWert, fxPruefung, fxZeilenWert, gliedMakroParam,
  glieder, herkunft, insertParamIndex, insertVorgabe, insertWertNamen, insertWertParameter, istBkGeraet, istGeraetZiel, istGliedZiel,
  istHalten, istInsertZiel, istObjekt, istPatchName, istRack, istRbGeraet, kanonisch, makroFaehig, modTiefeBereich, musterPruefung,
  neuesProjekt, passtGeraetZiel, pitchFaktor, sortiert, taktartOk, wirtSlots, zellFehler,
} from './model_types.ts';
export {
  type AbgabeMeta, type ArpMuster, type ArpRate, type AudioClip, type AusgangGruppe, type BeatsParameter, type BkGeraet, type BlendZiel,
  type Clip, type DekodiertZustand, type EingangExtern, type EingangIntern, type EingangMidi, type Entstehung, type EqBand, type Freeze,
  type FxEintrag, type FxNr, type Geraet, type Glied, type GliedGeraet, type GliedZiel, type Gruppe, type Halten, type Harmonie,
  type HarmonieEintrag, type Herkunft, type HostPlugin, type Insert, type InsertPoolArt, type InsertSchluessel, type InsertSorte,
  type InsertZiel, type InternGeraet, type KettenZiel, type KitGeraet, type Lane, type LoopDeck, type LoopRaster, type Marker, type Master,
  type MidiClip, type MidiStufe, type ModForm, type ModZiel, type ModulHerkunft, type Modulator, type MusterHerkunft, type Note,
  type Platz, type PlatzTyp, type PluginZiel, type Projekt, type ProjektAufnahme, type Rack, type RackGeraet, type RackZiel, type Return,
  type ReturnHall, type ReturnLoopdeck, type ReturnStrudel, type SchluesselQuelle, type Send, type SendZiel, type SessionEinstellung,
  type SessionSzene, type Spur, type SpurAufnahme, type Szene, type Take, type Tonart, type Warp, type WarpModus, type WarpQuelle,
  type WirtGeraet, type Zeile, type ZellHuelle, type ZellScheiben, type ZellSlot, type ZellZiel, type Zelle, type Ziel, type ZielBereich,
} from './model_types.ts';
export {
  alleInserts, alleRacks, alleStraenge, alleZellen, entferneLeereTakes, ersterFreierPlatz, geparkteGruppen, hoechste, insertZeilen,
  loopDeckGruppe, loopDeckSpuren, makroVon, neueId, neueNotenId, notenNummer, notenZaehler, platzVonGruppe, rackSicht, rackZeilen,
  sessionRaster, sessionSzenen, setzeFehlendeZaehler, stromSpur, strudelGruppe, sucheClip, sucheGruppe, sucheSpur, sucheStrang,
  sucheTakeClip, uebernimmNotenZaehler,
} from './model_ids.ts';
export { type InsertTraeger, type RackSicht, type RackSichtZiel } from './model_ids.ts';
export {
  BLEND_BEREICH, HOST_PFAD_ZEICHEN, HOST_UID_ZEICHEN, MAX_PLUGIN_INDEX, MAX_PLUGIN_LANEN, MAX_PLUGIN_REGLER, NEU_TRIM_MAX, NEU_TRIM_MIN,
  PLUGIN_BEREICH, SEND_BEREICH, beatsPruefung, blendFader, blendPfad, entstehungPruefung, istBlendZiel, istKettenZiel, istPluginZiel,
  istSendZiel, kettenLanen, kettenZielBereich, lanePruefung, normalisiereLane, pluginLanen, pluginZielBereich, pluginZielVon,
  punktePruefung, sendZielBereich, sendZielName, sendZielVon, sendZiele, warpPruefung, wertImBereich, zerlegeKettenZiel, zielBereichVon,
} from './model_check_parts.ts';
export { type StrangArt } from './model_check_parts.ts';
export {
  harmonieFehler, hebeAufDrei, midiStufeFehler, pruefeFehler, pruefeMidiStufe, pruefeModulFehler, pruefeProjekt,
} from './model_check_project.ts';
export { kettenSicht, spurSicht, wiedergabeSicht } from './model_view.ts';
export { modulatorPruefung, modulatorenBereinigen, modulatorenPruefung, neuerModulator } from './model_modulator.ts';
