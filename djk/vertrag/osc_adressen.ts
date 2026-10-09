// ERZEUGT von djk/vertrag/erzeuge_osc.py aus djk/vertrag/osc.json. Nicht von Hand ändern.
// Vertrag: docs/architektur/SCHNITTSTELLEN.md, Version 1. Prüfung: python3 djk/vertrag/pruefe_osc.py
// Nur löschbare Syntax (Konstanten und Typen), damit Node sie mit Type-Stripping laden kann.

export const VERTRAG = 1 as const;

export type OscTyp = 'i' | 'h' | 'f' | 'd' | 's';
export type Richtung = 'an_kern' | 'vom_kern' | 'von_notbahn';

export const ADRESSEN = {
  '/k/hallo': { typen: ',sii', abschnitt: '4.1', richtung: 'an_kern', nurPruefmodus: false, felder: ['name', 'port', 'protokoll'], bereiche: { protokoll: [1, 1] } },
  '/k/tschuess': { typen: ',s', abschnitt: '4.1', richtung: 'an_kern', nurPruefmodus: false, felder: ['name'], bereiche: {} },
  '/k/willkommen': { typen: ',iihdds', abschnitt: '4.1', richtung: 'vom_kern', nurPruefmodus: false, felder: ['protokoll', 'generation', 'sample', 'beat', 'bpm', 'kern_version'], bereiche: {} },
  '/k/set/neu': { typen: ',hsd', abschnitt: '4.2', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'start_bpm'], bereiche: {} },
  '/k/tempo/rampe': { typen: ',hsddd', abschnitt: '4.2', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'ab_beat', 'ziel_bpm', 'dauer_beats'], bereiche: { ziel_bpm: [60, 200], dauer_beats: [1.0, null] } },
  '/k/storno': { typen: ',hsh', abschnitt: '4.2', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'ziel_id'], bereiche: {} },
  '/k/teil': { typen: ',hssisddfiiss', abschnitt: '4.3', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'plan', 'teil', 'pfad', 'ab_beat', 'dauer_beats', 'nach', 'form', 'politik', 'gruppe', 'hoerschein'], bereiche: { teil: [0, null], dauer_beats: [0, null] } },
  '/k/abbruch': { typen: ',hsss', abschnitt: '4.3', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'plan', 'teile'], bereiche: {} },
  '/k/deck/laden': { typen: ',hsisdii', abschnitt: '4.4', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'deck', 'material_id', 'basis_bpm', 'fassung', 'mit_stems'], bereiche: { deck: [1, 4], fassung: [1, null] } },
  '/k/deck/entladen': { typen: ',hsi', abschnitt: '4.4', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'deck'], bereiche: { deck: [1, 4] } },
  '/k/deck/start': { typen: ',hssssiddi', abschnitt: '4.4', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'plan', 'gruppe', 'hoerschein', 'deck', 'ab_beat', 'quell_beat', 'politik'], bereiche: { deck: [1, 4] } },
  '/k/deck/stopp': { typen: ',hssssidi', abschnitt: '4.4', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'plan', 'gruppe', 'hoerschein', 'deck', 'ab_beat', 'politik'], bereiche: { deck: [1, 4] } },
  '/k/deck/loop': { typen: ',hssssiddid', abschnitt: '4.4', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'plan', 'gruppe', 'hoerschein', 'deck', 'ab_beat', 'laenge_beats', 'politik', 'raster_beats'], bereiche: { deck: [1, 4], laenge_beats: [0, 128] } },
  '/k/deck/roll': { typen: ',hssssiddiid', abschnitt: '4.4', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'plan', 'gruppe', 'hoerschein', 'deck', 'ab_beat', 'laenge_beats', 'art', 'politik', 'raster_beats'], bereiche: { deck: [1, 4], laenge_beats: [0, null] } },
  '/k/deck/sprung': { typen: ',hssssiddid', abschnitt: '4.4', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'plan', 'gruppe', 'hoerschein', 'deck', 'ab_beat', 'delta_beats', 'politik', 'raster_beats'], bereiche: { deck: [1, 4] } },
  '/k/deck/hotcue': { typen: ',hssssidiid', abschnitt: '4.4', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'plan', 'gruppe', 'hoerschein', 'deck', 'ab_beat', 'nr', 'politik', 'raster_beats'], bereiche: { deck: [1, 4], nr: [1, 8] } },
  '/k/deck/hotcue_setzen': { typen: ',hsiid', abschnitt: '4.4', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'deck', 'nr', 'quell_beat'], bereiche: { deck: [1, 4], nr: [1, 8] } },
  '/k/deck/raster': { typen: ',hsisdii', abschnitt: '4.4', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'deck', 'material_id', 'basis_bpm', 'fassung', 'versatz_frames'], bereiche: { deck: [1, 4], versatz_frames: [-192000, 192000] } },
  '/k/deck/slip': { typen: ',hsii', abschnitt: '4.4', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'deck', 'an'], bereiche: { deck: [1, 4] } },
  '/k/deck/basis_tausch': { typen: ',hsidid', abschnitt: '4.4', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'deck', 'basis_bpm', 'fassung', 'ab_beat'], bereiche: { deck: [1, 4], fassung: [1, null] } },
  '/k/hoerschein': { typen: ',hsssssddddfff', abschnitt: '4.5', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'hs_id', 'kanal', 'inhalt', 'urteil', 'bpm_messung', 'gueltig_bis_beat', 'quell_von', 'quell_bis', 'sync_ms', 'pegel_diff_db', 'lufs_kurz'], bereiche: {} },
  '/k/hoerschein/weg': { typen: ',hss', abschnitt: '4.5', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'hs_id'], bereiche: {} },
  '/k/schuss': { typen: ',hsdsiiifi', abschnitt: '4.6', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'ab_beat', 'material_id', 'fassung', 'schuss_nr', 'pad', 'pegel_db', 'politik'], bereiche: { fassung: [1, null], pad: [1, 2] } },
  '/k/ki/stopp': { typen: ',hs', abschnitt: '4.7', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle'], bereiche: {} },
  '/k/ki/frei': { typen: ',hs', abschnitt: '4.7', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle'], bereiche: {} },
  '/k/ki/spur': { typen: ',hss', abschnitt: '4.7', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'kanaele'], bereiche: {} },
  '/k/ki/stufe': { typen: ',hsi', abschnitt: '4.7', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'stufe'], bereiche: { stufe: [0, 3] } },
  '/k/vorschlag_kanal': { typen: ',hss', abschnitt: '4.7', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'kanal'], bereiche: {} },
  '/k/led': { typen: ',hssi', abschnitt: '4.7', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'name', 'zustand'], bereiche: {} },
  '/k/kiste': { typen: ',hs', abschnitt: '4.7', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle'], bereiche: {} },
  '/k/mapping': { typen: ',hss', abschnitt: '4.7', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'geraet'], bereiche: {} },
  '/k/latenz': { typen: ',hssi', abschnitt: '4.7', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'ziel', 'samples'], bereiche: {} },
  '/erz/strom': { typen: ',hsiss', abschnitt: '4.8', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'strom', 'ziel', 'kanal'], bereiche: { strom: [1, 16] } },
  '/erz/fenster': { typen: ',iiiiddh', abschnitt: '4.8', richtung: 'an_kern', nurPruefmodus: false, felder: ['strom', 'sendung', 'modus', 'reserve', 'ab_beat', 'bis_beat', 't_send_us'], bereiche: { strom: [1, 16] } },
  '/erz/ev': { typen: ',iiiiddf', schwanz: 'if', abschnitt: '4.8', richtung: 'an_kern', nurPruefmodus: false, felder: ['strom', 'muster', 'ev_id', 'note', 'beat', 'dauer_beats', 'velocity'], bereiche: { strom: [1, 16], note: [0, 255], velocity: [0, 1] } },
  '/erz/cc': { typen: ',iiidf', abschnitt: '4.8', richtung: 'an_kern', nurPruefmodus: false, felder: ['strom', 'ev_id', 'cc', 'beat', 'wert'], bereiche: { strom: [1, 16], wert: [0, 1] } },
  '/k/loop/laden': { typen: ',hsis', abschnitt: '4.9', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'box', 'name'], bereiche: { box: [1, 2] } },
  '/k/loop/start': { typen: ',hsi', abschnitt: '4.9', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'box'], bereiche: { box: [1, 2] } },
  '/k/loop/stopp': { typen: ',hsi', abschnitt: '4.9', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'box'], bereiche: { box: [1, 2] } },
  '/k/loop/raster': { typen: ',hsii', abschnitt: '4.9', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'box', 'versatz_frames'], bereiche: { box: [1, 2] } },
  '/k/loop/rec': { typen: ',hsis', abschnitt: '4.9', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'beats', 'name'], bereiche: {} },
  '/k/fx': { typen: ',hsiidddddi', abschnitt: '4.10', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'einheit', 'art', 'beats', 'wet', 'param1', 'param2', 'param3', 'an'], bereiche: { einheit: [1, 2], art: [1, 4], wet: [0, 1], param1: [0, 1], param2: [0, 1], param3: [0, 1], an: [0, 1] } },
  '/k/fx/zuweisung': { typen: ',hsisi', abschnitt: '4.10', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'einheit', 'kanal', 'an'], bereiche: { einheit: [1, 2], an: [0, 1] } },
  '/k/fx/routing': { typen: ',hsi', abschnitt: '4.10', richtung: 'an_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'routing'], bereiche: { routing: [0, 1] } },
  '/erz/quittung': { typen: ',iiiiiii', abschnitt: '4.8', richtung: 'vom_kern', nurPruefmodus: false, felder: ['strom', 'sendung', 'verworfen', 'verworfen_anderes_muster', 'eingefuegt', 'zu_spaet', 'ungehoert'], bereiche: { strom: [1, 16] } },
  '/q': { typen: ',hsihds', abschnitt: '5.1', richtung: 'vom_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'status', 'ist_sample', 'ist_beat', 'grund'], bereiche: {} },
  '/q/stand': { typen: ',hsihds', abschnitt: '5.1', richtung: 'vom_kern', nurPruefmodus: false, felder: ['id', 'quelle', 'status', 'ist_sample', 'ist_beat', 'grund'], bereiche: {} },
  '/uhr': { typen: ',hhddd', abschnitt: '5.2', richtung: 'vom_kern', nurPruefmodus: false, felder: ['sample', 'mono_ns', 'beat', 'bpm', 'bpm_pro_s'], bereiche: {} },
  '/takt': { typen: ',iihdd', abschnitt: '5.3', richtung: 'vom_kern', nurPruefmodus: false, felder: ['takt', 'phrase', 'sample', 'beat', 'bpm'], bereiche: { takt: [1, null], phrase: [1, null] } },
  '/zustand/kern': { typen: ',iihiiiiiiii', abschnitt: '5.4', richtung: 'vom_kern', nurPruefmodus: false, felder: ['generation', 'quantum', 'sample', 'frame_luecken', 'ausgelassene_perioden', 'cb_max_us', 'cb_p99_us', 'aufwach_max_us', 'stretcher_aktiv', 'befehle_wartend', 'ki_gestoppt'], bereiche: {} },
  '/zustand/deck': { typen: ',iisdidddfiifii', abschnitt: '5.5', richtung: 'vom_kern', nurPruefmodus: false, felder: ['deck', 'status', 'material_id', 'basis_bpm', 'fassung', 'quell_beat', 'beats_bis_ende', 'faktor', 'vorlauf_ms', 'hoerweg', 'stretcher_fuell', 'versatz_intern_ms', 'keylock_unterlauf', 'keylock_aufgegeben'], bereiche: { deck: [1, 4], stretcher_fuell: [-1, null] } },
  '/zustand/box': { typen: ',iiiiii', abschnitt: '5.5b', richtung: 'vom_kern', nurPruefmodus: false, felder: ['box', 'status', 'keylock_unterlauf', 'keylock_aufgegeben', 'keylock_ring_voll', 'keylock_kein_platz'], bereiche: { box: [1, 2] } },
  '/pegel': { typen: ',sfffffff', abschnitt: '5.6', richtung: 'vom_kern', nurPruefmodus: false, felder: ['kanal', 'spitze_db', 'echtspitze_dbtp', 'lufs_m', 'lufs_s', 'band_tief_db', 'band_mitte_db', 'band_hoch_db'], bereiche: {} },
  '/e/regler': { typen: ',sfshd', abschnitt: '5.7', richtung: 'vom_kern', nurPruefmodus: false, felder: ['pfad', 'wert', 'halter', 'sample', 'beat'], bereiche: {} },
  '/e/hand': { typen: ',sfhd', abschnitt: '5.8', richtung: 'vom_kern', nurPruefmodus: false, felder: ['pfad', 'wert', 'sample', 'beat'], bereiche: {} },
  '/e/taste': { typen: ',sihd', abschnitt: '5.8', richtung: 'vom_kern', nurPruefmodus: false, felder: ['name', 'wert', 'sample', 'beat'], bereiche: {} },
  '/e/geladen': { typen: ',isdiih', abschnitt: '5.9', richtung: 'vom_kern', nurPruefmodus: false, felder: ['deck', 'material_id', 'basis_bpm', 'fassung', 'mit_stems', 'sample'], bereiche: { deck: [1, 4] } },
  '/e/halter': { typen: ',sshd', abschnitt: '5.9', richtung: 'vom_kern', nurPruefmodus: false, felder: ['pfad', 'halter', 'sample', 'beat'], bereiche: {} },
  '/e/invariante': { typen: ',ssihd', abschnitt: '5.9', richtung: 'vom_kern', nurPruefmodus: false, felder: ['art', 'plan', 'teil', 'sample', 'beat'], bereiche: {} },
  '/e/rueckfall': { typen: ',iidddh', abschnitt: '5.9', richtung: 'vom_kern', nurPruefmodus: false, felder: ['deck', 'an', 'quell_beat_start', 'laenge_beats', 'beat', 'sample'], bereiche: { deck: [1, 4] } },
  '/e/frist': { typen: ',iddh', abschnitt: '5.9', richtung: 'vom_kern', nurPruefmodus: false, felder: ['deck', 'beats_bis_ende', 'beat', 'sample'], bereiche: { deck: [1, 4] } },
  '/e/luecke': { typen: ',hii', abschnitt: '5.9', richtung: 'vom_kern', nurPruefmodus: false, felder: ['sample', 'frames', 'zyklen'], bereiche: {} },
  '/e/quantum': { typen: ',iih', abschnitt: '5.9', richtung: 'vom_kern', nurPruefmodus: false, felder: ['alt', 'neu', 'sample'], bereiche: {} },
  '/e/raster': { typen: ',isdfh', abschnitt: '5.9', richtung: 'vom_kern', nurPruefmodus: false, felder: ['deck', 'material_id', 'quell_beat', 'versatz_ms', 'sample'], bereiche: { deck: [1, 4] } },
  '/e/hotcue': { typen: ',isidh', abschnitt: '5.9', richtung: 'vom_kern', nurPruefmodus: false, felder: ['deck', 'material_id', 'nr', 'quell_beat', 'sample'], bereiche: { deck: [1, 4], nr: [1, 8] } },
  '/e/rueckweg': { typen: ',sih', abschnitt: '5.9', richtung: 'vom_kern', nurPruefmodus: false, felder: ['kanal', 'lebt', 'sample'], bereiche: {} },
  '/e/ki': { typen: ',ish', abschnitt: '5.9', richtung: 'vom_kern', nurPruefmodus: false, felder: ['gestoppt', 'grund', 'sample'], bereiche: {} },
  '/e/tempo': { typen: ',dddh', abschnitt: '5.9', richtung: 'vom_kern', nurPruefmodus: false, felder: ['bpm', 'ab_beat', 'dauer_beats', 'sample'], bereiche: {} },
  '/e/neustart': { typen: ',ih', abschnitt: '5.9', richtung: 'vom_kern', nurPruefmodus: false, felder: ['generation', 'sample'], bereiche: {} },
  '/e/protokollfehler': { typen: ',ss', abschnitt: '5.9', richtung: 'vom_kern', nurPruefmodus: false, felder: ['adresse', 'grund'], bereiche: {} },
  '/nb': { typen: ',iiih', abschnitt: '5.10', richtung: 'von_notbahn', nurPruefmodus: false, felder: ['zustand', 'takte_in_schleife', 'generation_gesehen', 'w'], bereiche: {} },
  '/e/loop': { typen: ',iisiidf', abschnitt: '5.11', richtung: 'vom_kern', nurPruefmodus: false, felder: ['box', 'status', 'name', 'beats', 'fx_art', 'fx_beats', 'fx_wet'], bereiche: { box: [1, 2], status: [0, 5], fx_art: [0, 4] } },
  '/e/fx': { typen: ',iidddddi', abschnitt: '5.12', richtung: 'vom_kern', nurPruefmodus: false, felder: ['einheit', 'art', 'beats', 'wet', 'param1', 'param2', 'param3', 'an'], bereiche: { einheit: [1, 2], art: [0, 4], an: [0, 1] } },
  '/e/fx/zuweisung': { typen: ',isi', abschnitt: '5.12', richtung: 'vom_kern', nurPruefmodus: false, felder: ['einheit', 'kanal', 'an'], bereiche: { einheit: [1, 2], an: [0, 1] } },
  '/e/fx/routing': { typen: ',i', abschnitt: '5.12', richtung: 'vom_kern', nurPruefmodus: false, felder: ['routing'], bereiche: { routing: [0, 1] } },
  '/e/mitschnitt': { typen: ',siid', abschnitt: '5.11', richtung: 'vom_kern', nurPruefmodus: false, felder: ['name', 'beats', 'status', 'ab_beat'], bereiche: { status: [0, 1] } },
  '/test/hand': { typen: ',sfh', abschnitt: '19.0', richtung: 'an_kern', nurPruefmodus: true, felder: ['pfad', 'midi_roh', 'sample'], bereiche: { midi_roh: [0, 1] } },
  '/test/klick': { typen: ',hssi', abschnitt: '19.0', richtung: 'an_kern', nurPruefmodus: true, felder: ['id', 'quelle', 'kanal', 'an'], bereiche: {} },
} as const;

export type Adresse = keyof typeof ADRESSEN;

/** Werte je Adresse in Feldreihenfolge: h (int64) als bigint, i, f, d als number, s als string. */
export interface Werte {
  '/k/hallo': [name: string, port: number, protokoll: number];
  '/k/tschuess': [name: string];
  '/k/willkommen': [protokoll: number, generation: number, sample: bigint, beat: number, bpm: number, kern_version: string];
  '/k/set/neu': [id: bigint, quelle: string, start_bpm: number];
  '/k/tempo/rampe': [id: bigint, quelle: string, ab_beat: number, ziel_bpm: number, dauer_beats: number];
  '/k/storno': [id: bigint, quelle: string, ziel_id: bigint];
  '/k/teil': [id: bigint, quelle: string, plan: string, teil: number, pfad: string, ab_beat: number, dauer_beats: number, nach: number, form: number, politik: number, gruppe: string, hoerschein: string];
  '/k/abbruch': [id: bigint, quelle: string, plan: string, teile: string];
  '/k/deck/laden': [id: bigint, quelle: string, deck: number, material_id: string, basis_bpm: number, fassung: number, mit_stems: number];
  '/k/deck/entladen': [id: bigint, quelle: string, deck: number];
  '/k/deck/start': [id: bigint, quelle: string, plan: string, gruppe: string, hoerschein: string, deck: number, ab_beat: number, quell_beat: number, politik: number];
  '/k/deck/stopp': [id: bigint, quelle: string, plan: string, gruppe: string, hoerschein: string, deck: number, ab_beat: number, politik: number];
  '/k/deck/loop': [id: bigint, quelle: string, plan: string, gruppe: string, hoerschein: string, deck: number, ab_beat: number, laenge_beats: number, politik: number, raster_beats: number];
  '/k/deck/roll': [id: bigint, quelle: string, plan: string, gruppe: string, hoerschein: string, deck: number, ab_beat: number, laenge_beats: number, art: number, politik: number, raster_beats: number];
  '/k/deck/sprung': [id: bigint, quelle: string, plan: string, gruppe: string, hoerschein: string, deck: number, ab_beat: number, delta_beats: number, politik: number, raster_beats: number];
  '/k/deck/hotcue': [id: bigint, quelle: string, plan: string, gruppe: string, hoerschein: string, deck: number, ab_beat: number, nr: number, politik: number, raster_beats: number];
  '/k/deck/hotcue_setzen': [id: bigint, quelle: string, deck: number, nr: number, quell_beat: number];
  '/k/deck/raster': [id: bigint, quelle: string, deck: number, material_id: string, basis_bpm: number, fassung: number, versatz_frames: number];
  '/k/deck/slip': [id: bigint, quelle: string, deck: number, an: number];
  '/k/deck/basis_tausch': [id: bigint, quelle: string, deck: number, basis_bpm: number, fassung: number, ab_beat: number];
  '/k/hoerschein': [id: bigint, quelle: string, hs_id: string, kanal: string, inhalt: string, urteil: string, bpm_messung: number, gueltig_bis_beat: number, quell_von: number, quell_bis: number, sync_ms: number, pegel_diff_db: number, lufs_kurz: number];
  '/k/hoerschein/weg': [id: bigint, quelle: string, hs_id: string];
  '/k/schuss': [id: bigint, quelle: string, ab_beat: number, material_id: string, fassung: number, schuss_nr: number, pad: number, pegel_db: number, politik: number];
  '/k/ki/stopp': [id: bigint, quelle: string];
  '/k/ki/frei': [id: bigint, quelle: string];
  '/k/ki/spur': [id: bigint, quelle: string, kanaele: string];
  '/k/ki/stufe': [id: bigint, quelle: string, stufe: number];
  '/k/vorschlag_kanal': [id: bigint, quelle: string, kanal: string];
  '/k/led': [id: bigint, quelle: string, name: string, zustand: number];
  '/k/kiste': [id: bigint, quelle: string];
  '/k/mapping': [id: bigint, quelle: string, geraet: string];
  '/k/latenz': [id: bigint, quelle: string, ziel: string, samples: number];
  '/erz/strom': [id: bigint, quelle: string, strom: number, ziel: string, kanal: string];
  '/erz/fenster': [strom: number, sendung: number, modus: number, reserve: number, ab_beat: number, bis_beat: number, t_send_us: bigint];
  '/erz/ev': [strom: number, muster: number, ev_id: number, note: number, beat: number, dauer_beats: number, velocity: number];
  '/erz/cc': [strom: number, ev_id: number, cc: number, beat: number, wert: number];
  '/k/loop/laden': [id: bigint, quelle: string, box: number, name: string];
  '/k/loop/start': [id: bigint, quelle: string, box: number];
  '/k/loop/stopp': [id: bigint, quelle: string, box: number];
  '/k/loop/raster': [id: bigint, quelle: string, box: number, versatz_frames: number];
  '/k/loop/rec': [id: bigint, quelle: string, beats: number, name: string];
  '/k/fx': [id: bigint, quelle: string, einheit: number, art: number, beats: number, wet: number, param1: number, param2: number, param3: number, an: number];
  '/k/fx/zuweisung': [id: bigint, quelle: string, einheit: number, kanal: string, an: number];
  '/k/fx/routing': [id: bigint, quelle: string, routing: number];
  '/erz/quittung': [strom: number, sendung: number, verworfen: number, verworfen_anderes_muster: number, eingefuegt: number, zu_spaet: number, ungehoert: number];
  '/q': [id: bigint, quelle: string, status: number, ist_sample: bigint, ist_beat: number, grund: string];
  '/q/stand': [id: bigint, quelle: string, status: number, ist_sample: bigint, ist_beat: number, grund: string];
  '/uhr': [sample: bigint, mono_ns: bigint, beat: number, bpm: number, bpm_pro_s: number];
  '/takt': [takt: number, phrase: number, sample: bigint, beat: number, bpm: number];
  '/zustand/kern': [generation: number, quantum: number, sample: bigint, frame_luecken: number, ausgelassene_perioden: number, cb_max_us: number, cb_p99_us: number, aufwach_max_us: number, stretcher_aktiv: number, befehle_wartend: number, ki_gestoppt: number];
  '/zustand/deck': [deck: number, status: number, material_id: string, basis_bpm: number, fassung: number, quell_beat: number, beats_bis_ende: number, faktor: number, vorlauf_ms: number, hoerweg: number, stretcher_fuell: number, versatz_intern_ms: number, keylock_unterlauf: number, keylock_aufgegeben: number];
  '/zustand/box': [box: number, status: number, keylock_unterlauf: number, keylock_aufgegeben: number, keylock_ring_voll: number, keylock_kein_platz: number];
  '/pegel': [kanal: string, spitze_db: number, echtspitze_dbtp: number, lufs_m: number, lufs_s: number, band_tief_db: number, band_mitte_db: number, band_hoch_db: number];
  '/e/regler': [pfad: string, wert: number, halter: string, sample: bigint, beat: number];
  '/e/hand': [pfad: string, wert: number, sample: bigint, beat: number];
  '/e/taste': [name: string, wert: number, sample: bigint, beat: number];
  '/e/geladen': [deck: number, material_id: string, basis_bpm: number, fassung: number, mit_stems: number, sample: bigint];
  '/e/halter': [pfad: string, halter: string, sample: bigint, beat: number];
  '/e/invariante': [art: string, plan: string, teil: number, sample: bigint, beat: number];
  '/e/rueckfall': [deck: number, an: number, quell_beat_start: number, laenge_beats: number, beat: number, sample: bigint];
  '/e/frist': [deck: number, beats_bis_ende: number, beat: number, sample: bigint];
  '/e/luecke': [sample: bigint, frames: number, zyklen: number];
  '/e/quantum': [alt: number, neu: number, sample: bigint];
  '/e/raster': [deck: number, material_id: string, quell_beat: number, versatz_ms: number, sample: bigint];
  '/e/hotcue': [deck: number, material_id: string, nr: number, quell_beat: number, sample: bigint];
  '/e/rueckweg': [kanal: string, lebt: number, sample: bigint];
  '/e/ki': [gestoppt: number, grund: string, sample: bigint];
  '/e/tempo': [bpm: number, ab_beat: number, dauer_beats: number, sample: bigint];
  '/e/neustart': [generation: number, sample: bigint];
  '/e/protokollfehler': [adresse: string, grund: string];
  '/nb': [zustand: number, takte_in_schleife: number, generation_gesehen: number, w: bigint];
  '/e/loop': [box: number, status: number, name: string, beats: number, fx_art: number, fx_beats: number, fx_wet: number];
  '/e/fx': [einheit: number, art: number, beats: number, wet: number, param1: number, param2: number, param3: number, an: number];
  '/e/fx/zuweisung': [einheit: number, kanal: string, an: number];
  '/e/fx/routing': [routing: number];
  '/e/mitschnitt': [name: string, beats: number, status: number, ab_beat: number];
  '/test/hand': [pfad: string, midi_roh: number, sample: bigint];
  '/test/klick': [id: bigint, quelle: string, kanal: string, an: number];
}

export const QUELLE = ['andreas', 'cypher', 'leitstand', 'erzeuger', 'werkstatt', 'pruefstand'] as const;
export const POLITIK = { musik: 0, zustand: 1, raster: 2 } as const;
export const POLITIK_TEIL = { musik: 0, zustand: 1 } as const;
export const FORM = { linear: 0, s_kurve: 1 } as const;
export const RASTER_BEATS = [0.25, 1, 4, 16, 32] as const;
export const FX_BEATS = [0.25, 0.5, 1, 2, 4, 8, 16] as const;
export const FX_KANAL = ['deck/1', 'deck/2', 'erz/1', 'erz/2', 'erz/3', 'pad/1', 'pad/2', 'master'] as const;
export const ROLL_ART = { band_schatten: 0, puffer_keylock: 1 } as const;
export const URTEIL = ['ok'] as const;
export const LED_ZUSTAND = { aus: 0, an: 1, blinkt: 2, blinkt_schnell: 3 } as const;
export const ERZ_PARAMETER = { begin: 0, end: 1 } as const;
export const ERZ_MODUS = { B: 66 } as const;
export const STATUS = { angenommen: 1, gestartet: 2, fertig: 3, verspaetet_verworfen: 4, verspaetet_ausgefuehrt: 5, abgelehnt: 6, abgebrochen: 7, storniert: 8 } as const;
export const STATUS_STAND = { wartet: 1, laeuft: 2 } as const;
export const DECK_STATUS = { leer: 0, geladen: 1, laeuft: 2, loop: 3, roll: 4, rueckfall: 5 } as const;
export const HOERWEG = { direkt: 0, stretcher: 1, puffer: 2 } as const;
export const TASTE = ['annehmen', 'verwerfen', 'cypher_vorschlag', 'cypher_hoeren', 'stopp', 'freigabe', 'urteil_gut', 'urteil_daneben', 'autonomie', 'spielart', 'laenge', 'spielart_start', 'basstausch', 'kiste_laden', 'kiste_wahl', 'tempo_basis', 'zuruf'] as const;
export const INVARIANTE_ART = ['sub_doppelt', 'master_leer', 'hoerschein'] as const;
export const PROTOKOLLFEHLER_GRUND = ['unbekannte_adresse', 'falsche_typen', 'protokoll'] as const;
export const NB_ZUSTAND = { durchreichen: 0, schleife: 1, ausgeblendet: 2, rueckgabe: 3 } as const;
export const GRUENDE = ['zu_spaet', 'regler_beim_menschen', 'regler_verplant', 'ueberlappung', 'nur_hand', 'unbekannter_regler', 'unbekanntes_deck', 'ausserhalb_bereich', 'kein_hoerschein', 'hoerschein_anderer_kanal', 'hoerschein_anderer_inhalt', 'hoerschein_anderes_tempo', 'hoerschein_abgelaufen', 'hoerschein_anderer_abschnitt', 'ziel_ungehoert', 'keine_stems', 'hoerschein_nicht_sync', 'hoerschein_pegel', 'invariante_sub_doppelt', 'invariante_master_leer', 'deck_beruehrt', 'deck_hoerbar', 'deck_laeuft', 'nicht_geladen', 'material_fehlt', 'pruefung', 'budget_speicher', 'budget_stretcher', 'karte_voll', 'ki_gestoppt', 'rechner_fehlt', 'kein_stretcher', 'autonomie', 'form', 'hand', 'abbruch', 'ki_stopp', 'unbekannte_adresse', 'falsche_typen', 'protokoll', 'grenze_sub', 'neustart'] as const;
