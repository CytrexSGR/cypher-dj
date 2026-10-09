// Der Vertrag (SCHNITTSTELLEN.md, Version 1) als Tabellen für die Kern-Attrappe.
// Adressen und Typ-Zeichenketten wörtlich aus §4, §5, §19.0 und ROADMAP Z1. Ein Test gleicht sie
// gegen den Vertragstext und gegen djk/vertrag/osc.json ab (tests/vertrag.test.mjs).

export const PROTOKOLL = 1;
export const KERN_VERSION = 'attrappe-13.1';

const f = (typen, felder) => ({ typen, felder: felder.split(' ') });
const DECK_PLAN = 'id quelle plan gruppe hoerschein deck ab_beat';

// Befehle an den Kern (§4, §19.0 /test/hand, ROADMAP Z1 /test/klick)
export const BEFEHLE = {
  '/k/hallo': f('sii', 'name port protokoll'),
  '/k/tschuess': f('s', 'name'),
  '/k/set/neu': f('hsd', 'id quelle start_bpm'),
  '/k/tempo/rampe': f('hsddd', 'id quelle ab_beat ziel_bpm dauer_beats'),
  '/k/storno': f('hsh', 'id quelle ziel_id'),
  '/k/teil': f('hssisddfiiss', 'id quelle plan teil pfad ab_beat dauer_beats nach form politik gruppe hoerschein'),
  '/k/abbruch': f('hsss', 'id quelle plan teile'),
  '/k/deck/laden': f('hsisdii', 'id quelle deck material_id basis_bpm fassung mit_stems'),
  '/k/deck/entladen': f('hsi', 'id quelle deck'),
  '/k/deck/start': f('hssssiddi', `${DECK_PLAN} quell_beat politik`),
  '/k/deck/stopp': f('hssssidi', `${DECK_PLAN} politik`),
  '/k/deck/loop': f('hssssiddid', `${DECK_PLAN} laenge_beats politik raster_beats`),
  '/k/deck/roll': f('hssssiddiid', `${DECK_PLAN} laenge_beats art politik raster_beats`),
  '/k/deck/sprung': f('hssssiddid', `${DECK_PLAN} delta_beats politik raster_beats`),
  '/k/deck/hotcue': f('hssssidiid', `${DECK_PLAN} nr politik raster_beats`),
  '/k/deck/hotcue_setzen': f('hsiid', 'id quelle deck nr quell_beat'),
  '/k/deck/raster': f('hsisdii', 'id quelle deck material_id basis_bpm fassung versatz_frames'),
  '/k/deck/slip': f('hsii', 'id quelle deck an'),
  '/k/deck/basis_tausch': f('hsidid', 'id quelle deck basis_bpm fassung ab_beat'),
  '/k/hoerschein': f('hsssssddddfff', 'id quelle hs_id kanal inhalt urteil bpm_messung gueltig_bis_beat quell_von quell_bis sync_ms pegel_diff_db lufs_kurz'),
  '/k/hoerschein/weg': f('hss', 'id quelle hs_id'),
  '/k/schuss': f('hsdsiiifi', 'id quelle ab_beat material_id fassung schuss_nr pad pegel_db politik'),
  '/k/ki/stopp': f('hs', 'id quelle'),
  '/k/ki/frei': f('hs', 'id quelle'),
  '/k/ki/spur': f('hss', 'id quelle kanaele'),
  '/k/ki/stufe': f('hsi', 'id quelle stufe'),
  '/k/vorschlag_kanal': f('hss', 'id quelle kanal'),
  '/k/led': f('hssi', 'id quelle name zustand'),
  '/k/kiste': f('hs', 'id quelle'),
  '/k/mapping': f('hss', 'id quelle geraet'),
  '/k/latenz': f('hssi', 'id quelle ziel samples'),
  '/erz/strom': f('hsiss', 'id quelle strom ziel kanal'),
  '/erz/fenster': f('iiiiddh', 'strom sendung modus reserve ab_beat bis_beat t_send_us'),
  '/erz/ev': f('iiiiddf', 'strom muster ev_id note beat dauer_beats velocity'),
  '/erz/cc': f('iiidf', 'strom ev_id cc beat wert'),
  '/k/loop/laden': f('hsis', 'id quelle box name'),
  '/k/loop/start': f('hsi', 'id quelle box'),
  '/k/fx': f('hsiidddddi', 'id quelle einheit art beats wet param1 param2 param3 an'),   // AUFTRAG 2026-09-28 (§4.10)
  '/k/fx/zuweisung': f('hsisi', 'id quelle einheit kanal an'),                          // AUFTRAG 2026-09-28 (§4.10)
  '/k/fx/routing': f('hsi', 'id quelle routing'),                                        // Ohr Task 15 (§4.10)
  '/k/loop/stopp': f('hsi', 'id quelle box'),
  '/k/loop/raster': f('hsii', 'id quelle box versatz_frames'),
  '/k/loop/rec': f('hsis', 'id quelle beats name'),
  '/test/hand': f('sfh', 'pfad midi_roh sample'),
  '/test/klick': f('hssi', 'id quelle kanal an'),
};

// Ausgaben des Kerns (§5 ohne /nb, das sendet die Notbahn; dazu /erz/quittung aus §4.8)
export const AUSGABEN = {
  '/q': f('hsihds', 'id quelle status ist_sample ist_beat grund'),
  '/q/stand': f('hsihds', 'id quelle status ist_sample ist_beat grund'),
  '/k/willkommen': f('iihdds', 'protokoll generation sample beat bpm kern_version'),
  '/uhr': f('hhddd', 'sample mono_ns beat bpm bpm_pro_s'),
  '/takt': f('iihdd', 'takt phrase sample beat bpm'),
  '/zustand/kern': f('iihiiiiiiii', 'generation quantum sample frame_luecken ausgelassene_perioden cb_max_us cb_p99_us aufwach_max_us stretcher_aktiv befehle_wartend ki_gestoppt'),
  '/zustand/deck': f('iisdidddfiifii', 'deck status material_id basis_bpm fassung quell_beat beats_bis_ende faktor vorlauf_ms hoerweg stretcher_fuell versatz_intern_ms keylock_unterlauf keylock_aufgegeben'),
  '/zustand/box': f('iiiiii', 'box status keylock_unterlauf keylock_aufgegeben keylock_ring_voll keylock_kein_platz'),  // Keylock 7b.3 (die Attrappe spielt keine Boxen und sendet es nicht)
  '/pegel': f('sfffffff', 'kanal spitze_db echtspitze_dbtp lufs_m lufs_s band_tief_db band_mitte_db band_hoch_db'),
  '/e/regler': f('sfshd', 'pfad wert halter sample beat'),
  '/e/hand': f('sfhd', 'pfad wert sample beat'),
  '/e/taste': f('sihd', 'name wert sample beat'),
  '/e/geladen': f('isdiih', 'deck material_id basis_bpm fassung mit_stems sample'),
  '/e/halter': f('sshd', 'pfad halter sample beat'),
  '/e/invariante': f('ssihd', 'art plan teil sample beat'),
  '/e/rueckfall': f('iidddh', 'deck an quell_beat_start laenge_beats beat sample'),
  '/e/frist': f('iddh', 'deck beats_bis_ende beat sample'),
  '/e/luecke': f('hii', 'sample frames zyklen'),
  '/e/quantum': f('iih', 'alt neu sample'),
  '/e/raster': f('isdfh', 'deck material_id quell_beat versatz_ms sample'),
  '/e/hotcue': f('isidh', 'deck material_id nr quell_beat sample'),
  '/e/rueckweg': f('sih', 'kanal lebt sample'),
  '/e/ki': f('ish', 'gestoppt grund sample'),
  '/e/tempo': f('dddh', 'bpm ab_beat dauer_beats sample'),
  '/e/neustart': f('ih', 'generation sample'),
  '/e/protokollfehler': f('ss', 'adresse grund'),
  '/erz/quittung': f('iiiiiii', 'strom sendung verworfen verworfen_anderes_muster eingefuegt zu_spaet ungehoert'),
  '/e/loop': f('iisiidf', 'box status name beats fx_art fx_beats fx_wet'),
  '/e/fx': f('iidddddi', 'einheit art beats wet param1 param2 param3 an'),   // AUFTRAG 2026-09-28 (§5.12)
  '/e/fx/zuweisung': f('isi', 'einheit kanal an'),                          // AUFTRAG 2026-09-28 (§5.12)
  '/e/fx/routing': f('i', 'routing'),                                       // Ohr Task 15 (§5.12)
  '/e/mitschnitt': f('siid', 'name beats status ab_beat'),
};

export const STATUS = { angenommen: 1, gestartet: 2, fertig: 3, verspaetet_verworfen: 4, verspaetet_ausgefuehrt: 5, abgelehnt: 6, abgebrochen: 7, storniert: 8 };
export const QUELLEN = ['andreas', 'cypher', 'leitstand', 'erzeuger', 'werkstatt', 'pruefstand'];

// §16.2, nur die Codes, die der Kern selbst vergibt
export const GRUENDE = new Set(['zu_spaet', 'regler_beim_menschen', 'regler_verplant', 'ueberlappung', 'nur_hand',
  'unbekannter_regler', 'unbekanntes_deck', 'ausserhalb_bereich', 'kein_hoerschein', 'hoerschein_anderer_kanal',
  'hoerschein_anderer_inhalt', 'hoerschein_anderes_tempo', 'hoerschein_abgelaufen', 'hoerschein_anderer_abschnitt',
  'ziel_ungehoert', 'keine_stems', 'invariante_sub_doppelt', 'invariante_master_leer', 'deck_beruehrt', 'deck_hoerbar',
  'deck_laeuft', 'nicht_geladen', 'material_fehlt', 'pruefung', 'budget_speicher', 'karte_voll', 'ki_gestoppt',
  'kein_stretcher', 'hand', 'abbruch', 'ki_stopp', 'unbekannte_adresse', 'falsche_typen', 'protokoll']);

// §1.5 Kanäle
export const DECKS = [1, 2, 3, 4].map((n) => `deck/${n}`);
export const ERZ = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `erz/${n}`);
export const PADS = ['pad/1', 'pad/2'];
export const BUSSE = [1, 2, 3, 4].map((n) => `bus/${n}`);
export const SPIELKANAELE = [...DECKS, ...ERZ, ...PADS];     // Kanäle, die "hörbar" werden können
export const KANALZUG_KANAELE = [...SPIELKANAELE, ...BUSSE];

const DB = 'db', LIN = 'lin', SCHALTER = 'schalter', STUFE = 'stufe';
const R = (einheit, min, max, vorgabe, nurHand = false) => ({ einheit, min, max, vorgabe, nurHand });

function kanalzug(k) {
  const bus = k.startsWith('bus/');
  const m = {
    fader: R(DB, -200, 0, -200, bus), trim: R(DB, -24, 24, 0),
    'eq/tief': R(DB, -200, 6, 0), 'eq/mitte': R(DB, -200, 6, 0), 'eq/hoch': R(DB, -200, 6, 0),
    'kill/tief': R(SCHALTER, 0, 1, 0), 'kill/mitte': R(SCHALTER, 0, 1, 0), 'kill/hoch': R(SCHALTER, 0, 1, 0),
    filter: R(LIN, -1, 1, 0),
    'send/1': R(DB, -200, 0, -200), 'send/2': R(DB, -200, 0, -200), 'send/3': R(DB, -200, 0, -200), 'send/4': R(DB, -200, 0, -200),
    xseite: R(STUFE, 0, 2, 1, true), pfl: R(SCHALTER, 0, 1, 0, true),
  };
  if (!bus) m.ziel = R(STUFE, 0, 4, 0, true);
  if (k.startsWith('deck/')) for (const s of ['drums', 'bass', 'vocals', 'other']) m[`stem/${s}`] = R(DB, -200, 6, 0);
  return m;
}

export const REGLER = new Map();
for (const k of KANALZUG_KANAELE) for (const [p, info] of Object.entries(kanalzug(k))) REGLER.set(`${k}/${p}`, { ...info, kanal: k });
for (const [p, info] of Object.entries({
  xfader: R(LIN, -1, 1, 0, true), 'master/pegel': R(DB, -200, 0, 0, true), 'master/kleber': R(LIN, 0, 1, 0, true), 'cue/mix': R(LIN, -1, 1, -1, true),
  'cue/pegel': R(DB, -200, 0, -12, true), 'cue/split': R(SCHALTER, 0, 1, 0, true),
  'fx/1/notenwert': R(LIN, 1 / 32, 4, 0.75), 'fx/2/notenwert': R(LIN, 1 / 32, 4, 0.75),
  'fx/1/rueckkopplung': R(LIN, 0, 0.95, 0.5), 'fx/2/rueckkopplung': R(LIN, 0, 0.95, 0.5),
  'fx/1/rueckweg': R(DB, -200, 0, 0), 'fx/2/rueckweg': R(DB, -200, 0, 0), 'fx/3/rueckweg': R(DB, -200, 0, 0), 'fx/4/rueckweg': R(DB, -200, 0, 0),
  'duck/tiefe': R(DB, -24, 0, 0), 'duck/release': R(LIN, 50, 600, 200),
  keylock: R(SCHALTER, 0, 1, 1),   // Keylock Task 3 (Fassung 4): EIN Knopf für alle Quellen, alle dürfen
})) REGLER.set(p, { ...info, kanal: null });

export const kanalVon = (pfad) => REGLER.get(pfad)?.kanal ?? null;
export const istDeck = (k) => typeof k === 'string' && /^deck\/[1-4]$/.test(k);
export const deckNr = (k) => Number(k.split('/')[1]);

// §7.4 LED-Namen
export const LEDS = new Set(['vorschlag', 'plan_laeuft', 'rueckfall', 'notbahn', 'ki_gestoppt',
  'autonomie_0', 'autonomie_1', 'autonomie_2', 'autonomie_3',
  ...[1, 2, 3, 4].flatMap((n) => ['halter_andreas', 'halter_cypher', 'hoerschein_ok', 'hoerschein_rot', 'frist', 'loop', 'roll'].map((x) => `deck${n}_${x}`))]);

export const ID_MUSTER = /^[a-z0-9_-]{1,24}$/;
