// Live dock: the pure card model of the EFFECTS tab (DJ and LIVE). One function turns a live snapshot into the generic cards of the dock;
// the rest are menu entries and knob value conversions. No DOM, no I/O (tested in Node: tests/live_dock_model.test.mjs).
// The rule this model carries: an instrument is only the subtitle of a card (with CHANGE, the front knobs, OPEN), never a chip;
// an effect is only a chip named like the effect; the word INSERT labels nothing.
//
// Snapshot: { regler: {path: value}, geladen: {channel: graphName}, graphen: [{name, art, kategorie?, prinzip?, regler_namen?}],
//   front: {graphName: [{param, name, vorgabe}]}, hostNamen: {channel: name}, inhalt: {channel: text}, gewaehlt: channel,
//   limiter: {gebaut, grund} }.
import { GRAPH_KANAL_ART, KOMP_SCHLUESSEL, KOMP_PRESETS, graphWahlOptionen } from '../effects.js';
import { KOMP_SECHS } from '../comp_controls_table.js';
import { SPEKTRUM_QUELLEN } from '../spectrum.js';

/** [id, short label, name, colour] of the ten channel cards, in the order of the tabs. */
export const LIVE_KANAELE = [
  ['deck/1', 'A', 'A', 'var(--a)'], ['deck/2', 'B', 'B', 'var(--b)'],
  ['erz/1', 'I1', 'DRUMS', 'var(--c)'], ['erz/2', 'I2', 'BASS', 'var(--c)'], ['erz/3', 'I3', 'MELODY', 'var(--c)'],
  ['erz/5', 'I5', 'I5', 'var(--c)'], ['erz/6', 'I6', 'I6', 'var(--c)'], ['erz/7', 'I7', 'I7', 'var(--c)'],
  ['pad/1', 'L1', 'L1', 'var(--c3)'], ['pad/2', 'L2', 'L2', 'var(--c3)'],
];
/** The effect returns (cards of the EFFECTS row). */
export const LIVE_RUECKGAENGE = [['fx/3', '3', 'FX3', 'var(--c2)'], ['fx/4', '4', 'FX4', 'var(--c2)']];
/** Mixer index of a channel (komp/sc = index + 1); a copy of FX_INDEX of effects_gemeinsam.js (a page module); the test binds it to FX_REITER. */
export const FX_INDEX = { 'deck/1': 0, 'deck/2': 1, 'erz/1': 4, 'erz/2': 5, 'erz/3': 6, 'erz/5': 8, 'erz/6': 9, 'erz/7': 10, 'pad/1': 12, 'pad/2': 13 };

const BUS_KANAELE = ['bus/1', 'bus/2', 'bus/3', 'bus/4'];
const PAD_AUTOMATION = { 'pad/1': 1, 'pad/2': 2 };
const CHIP_ZEICHEN = 10;

const wert = (stand, pfad, vorgabe = 0) => stand?.regler?.[pfad] ?? vorgabe;
const an = (stand, pfad) => wert(stand, pfad) >= 0.5;
const geladenVon = (stand, kanal) => stand?.geladen?.[kanal] ?? '';
const kuerze = (name) => (name.length > CHIP_ZEICHEN ? `${name.slice(0, CHIP_ZEICHEN)}…` : name);

/** The kind of the graph loaded on a channel: null for an empty name, the graph's own `art` from the /graphen list,
 *  and for an unknown name the kind the channel's picker offers. */
export function graphArtVon(kanal, name, graphen) {
  if (!name) return null;
  const g = (graphen ?? []).find((x) => x && x.name === name);
  if (g && (g.art === 'instrument' || g.art === 'effekt')) return g.art;
  return GRAPH_KANAL_ART[kanal] ?? null;
}

function knoepfeVon(stand, kanal, name, graph, hoechstens) {
  const liste = graph ? stand?.front?.[graph] : null;
  if (!Array.isArray(liste)) return [];
  return liste.slice(0, hoechstens).map((k) => ({ param: `bk:${k.param}`, name: k.name, titel: `${k.name} of ${name}`, vorgabe: k.vorgabe }));
}
function effektChip(kanal, name, graph) {
  return { teil: 'insert', text: kuerze(graph), titel: `Effect ${graph} on ${name}`, an: true, art: 'effekt', gr: false };
}
function plusVon(kanal, effektGeladen) {
  if (GRAPH_KANAL_ART[kanal] !== 'effekt') return null;
  return { aus: effektGeladen, titel: effektGeladen ? 'This channel holds one effect: change or remove it on its chip' : 'Add an effect to this channel' };
}
const schluesselName = (sc) => KOMP_SCHLUESSEL.find(([w]) => w === sc)?.[1] ?? `#${sc}`;

function kanalKarte(stand, [id, kurz, name, farbe]) {
  const graph = geladenVon(stand, id);
  const art = graphArtVon(id, graph, stand?.graphen);
  const instrument = art === 'instrument' || GRAPH_KANAL_ART[id] === 'instrument';
  const effekt = art === 'effekt' ? graph : '';
  const sc = wert(stand, `${id}/komp/sc`);
  const teile = [];
  if (effekt) teile.push(effektChip(id, name, effekt));
  teile.push(
    { teil: 'gate', text: 'GATE', titel: `Gate of ${name}`, an: an(stand, `${id}/gate/an`), art: 'gate', gr: true, grSkala: 60 },
    { teil: 'komp', text: 'COMP', titel: `Compressor of ${name}${sc !== 0 ? ` · KEY ${schluesselName(sc)}` : ''}`, an: an(stand, `${id}/komp/an`), art: 'komp', gr: true, grSkala: 24 },
    { teil: 'util', text: 'UTIL', titel: `Utility of ${name}`, an: true, art: 'util', gr: false },
  );
  const spielt = stand?.inhalt?.[id] ?? '–';
  const karte = {
    id, art: 'kanal', kurz, name, farbe, teile, plus: plusVon(id, !!effekt),
    meter: id, pegelText: true, menue: true, aktiv: id === stand?.gewaehlt,
  };
  if (instrument) {
    const hostArt = GRAPH_KANAL_ART[id] === 'instrument' && (id === 'erz/2' || id === 'erz/3');
    const untertitel = art === 'instrument' ? graph : !graph && hostArt ? (stand?.hostNamen?.[id] ?? 'Surge XT') : 'No instrument';
    return {
      ...karte, untertitel, untertitelArt: 'instrument', untertitelTitel: `Instrument of ${name}`,
      inhalt: { text: spielt, titel: spielt, laeuft: spielt.startsWith('▶') },
      wechsel: true, auf: true,
      knoepfe: art === 'instrument' ? knoepfeVon(stand, id, name, graph, 6) : [], knopfGruppe: null,
    };
  }
  const komp = ['schwelle', 'ratio', 'mix'].map((f) => KOMP_SECHS.find((r) => r.feld === f));
  return {
    ...karte, untertitel: spielt, untertitelArt: 'inhalt', untertitelTitel: `What plays on ${name}`,
    inhalt: null, wechsel: false, auf: false,
    knoepfe: komp.map((r) => ({ param: `komp/${r.feld}`, name: r.name.slice(0, r.feld === 'schwelle' ? 3 : undefined), titel: `Compressor ${r.feld === 'schwelle' ? 'threshold' : r.feld} of ${name}`, vorgabe: kVonWert(`komp/${r.feld}`, r.vorgabe) })),
    knopfGruppe: 'COMP',
  };
}

function rueckKarte(stand, [id, kurz, name, farbe]) {
  const graph = geladenVon(stand, id);
  return {
    id, art: 'ret', kurz, name, farbe, untertitel: graph || 'No effect', untertitelArt: 'effekt', untertitelTitel: `Effect of ${name}`,
    inhalt: null, teile: [], plus: null, wechsel: true, auf: !!graph,
    knoepfe: knoepfeVon(stand, id, name, graph, 4), knopfGruppe: null, meter: null, pegelText: false, menue: false, aktiv: false,
  };
}

function masterKarte(stand) {
  const graph = geladenVon(stand, 'master');
  const effekt = graphArtVon('master', graph, stand?.graphen) === 'effekt' ? graph : '';
  const teile = [];
  if (effekt) teile.push(effektChip('master', 'MASTER', effekt));
  teile.push(
    { teil: 'glue', text: 'GLUE', titel: 'Master glue compressor', an: wert(stand, 'master/kleber') >= 0.005, art: 'glue', gr: false },
    { teil: 'limiter', text: 'LIMITER', titel: 'Master limiter', an: true, art: 'limiter', gr: true, grSkala: 24 },
    ...BUS_KANAELE.map((b, i) => ({
      teil: b, text: `BUS ${i + 1}`, titel: `Bus ${i + 1}`, an: an(stand, `${b}/mb/an`) || an(stand, `${b}/lim/an`), art: 'bus', gr: false, abschnitt: 'BUS',
    })),
  );
  return {
    id: 'master', art: 'master', kurz: '', name: 'MASTER', farbe: '', untertitel: '', untertitelArt: null, untertitelTitel: '',
    inhalt: null, teile, plus: plusVon('master', !!effekt), wechsel: false, auf: true,
    knoepfe: [{ param: 'kleber', name: 'GLUE', titel: 'Master glue compressor', vorgabe: 0 }], knopfGruppe: null,
    meter: 'master', pegelText: true, menue: false, aktiv: false,
  };
}

/** The cards of the dock for one snapshot. */
export function liveModell(stand) {
  return {
    zeilen: [
      { key: 'kanaele', titel: 'CHANNELS', w: 'dock-kanaele', karten: LIVE_KANAELE.map((k) => kanalKarte(stand, k)) },
      { key: 'fx', titel: 'EFFECTS', w: 'dock-fx', karten: LIVE_RUECKGAENGE.map((k) => rueckKarte(stand, k)) },
    ],
    master: [masterKarte(stand)],
  };
}

/** The rebuild key of a model: what changes the shape of the cards. The subtitle of an 'inhalt' card is what plays and refreshes in place. Values, `an`, `aktiv`, `inhalt` and `plus.aus` refresh in place and are not in it. */
export function gestaltLive(modell) {
  const karten = [...modell.zeilen.flatMap((z) => z.karten.map((k) => [z.key, k])), ...modell.master.map((k) => ['master', k])];
  return JSON.stringify(karten.map(([zeile, k]) => [
    zeile, k.id, k.name, k.untertitelArt === 'inhalt' ? null : k.untertitel, k.untertitelArt, k.teile.map((t) => [t.teil, t.text, t.art]), !!k.plus, k.wechsel, k.auf,
    k.knoepfe.map((x) => x.param), k.knopfGruppe,
  ]));
}

// ---------- knob conversions ----------
/** Range of a front knob: `komp/<field>` (table of the compressor) and `kleber` (0..1). null for the others (`bk:<param>` is 0..1 as it is). */
export function knopfBereich(param) {
  if (param === 'kleber') return { min: 0, max: 1, text: (w) => (w < 0.005 ? 'OFF' : `${Math.round(w * 100)}%`) };
  if (typeof param === 'string' && param.startsWith('komp/')) {
    const r = KOMP_SECHS.find((x) => x.feld === param.slice(5));
    if (r) return { min: r.min, max: r.max, text: r.text };
  }
  return null;
}
const zwischen = (x) => Math.min(1, Math.max(0, x));
export function wertVonK(param, k) {
  const b = knopfBereich(param);
  return b ? b.min + zwischen(k) * (b.max - b.min) : k;
}
export function kVonWert(param, w) {
  const b = knopfBereich(param);
  return b ? zwischen((w - b.min) / (b.max - b.min)) : w;
}

// ---------- menus ----------
/** The entries of the menu of one chip. `karte` is the card (the channel id is `karte.id`), `teil` the chip, `stand` the snapshot. */
export function chipPunkte(karte, teil, stand) {
  const k = karte.id;
  const schalter = (text, aktion, extra = {}) => ({ text, aktion, ...extra });
  if (teil === 'gate') return [schalter(an(stand, `${k}/gate/an`) ? 'Bypass' : 'Enable', 'gate-an')];
  if (teil === 'komp') {
    const sc = wert(stand, `${k}/komp/sc`);
    return [
      schalter(an(stand, `${k}/komp/an`) ? 'Bypass' : 'Enable', 'komp-an'),
      { gruppe: true, text: 'Key source' },
      ...KOMP_SCHLUESSEL.filter(([w]) => w === 0 || w !== FX_INDEX[k] + 1)
        .map(([w, n]) => schalter(`${w === sc ? '✓ ' : ''}${n}`, 'komp-sc', { wert: w })),
      { gruppe: true, text: 'Presets' },
      ...Object.keys(KOMP_PRESETS).map((n) => schalter(n, 'komp-preset', { wert: n })),
      schalter('Gain reduction history', 'komp-verlauf'),
    ];
  }
  if (teil === 'util') {
    return [['Ø L', 'util/phase_l'], ['Ø R', 'util/phase_r'], ['SWAP', 'util/tausch'], ['DC', 'util/dc']]
      .map(([text, feld]) => schalter(`${an(stand, `${k}/${feld}`) ? '✓ ' : ''}${text}`, 'util-schalter', { wert: feld }));
  }
  if (teil === 'insert') return [schalter('Change effect…', 'effekt-wechsel'), schalter('Remove', 'effekt-weg')];
  if (typeof teil === 'string' && teil.startsWith('bus/')) {
    const gebaut = stand?.limiter?.gebaut === true;
    return [
      schalter(an(stand, `${teil}/mb/an`) ? 'MULTIBAND off' : 'MULTIBAND on', 'bus-mb'),
      schalter(an(stand, `${teil}/lim/an`) ? 'LIMITER off' : 'LIMITER on', 'bus-lim', gebaut ? {} : { aus: true, titel: stand?.limiter?.grund }),
    ];
  }
  return [];
}

/** The entries of the card menu (right click on a channel card). */
export function kartenPunkte(karte) {
  if (karte.art !== 'kanal') return [];
  const punkte = [{ text: 'Spectrum', aktion: 'spektrum' }];
  if (PAD_AUTOMATION[karte.id]) punkte.push({ text: 'Loop automation…', aktion: 'automation', wert: PAD_AUTOMATION[karte.id] });
  return punkte;
}

/** The entries `menuePunkte` (instrument_groups.js) takes for CHANGE of an instrument slot: the Baukasten instruments, then the empty choice (host or Off). */
export function wechselWahl(kanal, stand) {
  const o = graphWahlOptionen(kanal, stand?.graphen, stand?.geladen?.[kanal] ?? '', stand?.hostNamen?.[kanal]);
  if (!o.length) return [];
  const leer = o.find((x) => x.wert === '');
  return [
    ...o.filter((x) => x.wert !== '').map((x) => ({ gruppe: 'Baukasten', text: x.text, name: x.wert })),
    { gruppe: 'No graph', text: leer?.text ?? 'Off', name: '' },
  ];
}

/** The effects offered on an effect slot; the loaded one is marked, Remove comes last while one is loaded. */
export function effektWahl(kanal, stand) {
  const geladen = stand?.geladen?.[kanal] ?? '';
  const liste = graphWahlOptionen(kanal, stand?.graphen, geladen).filter((x) => x.wert !== '')
    .map((x) => ({ text: x.text, wert: x.wert, aus: x.wert === geladen }));
  if (liste.length && geladen !== '') liste.push({ text: 'Remove', wert: '', aus: false });
  return liste;
}

/** The value of the selector spektrum/kanal for a channel (0 = off when unknown). */
export function spektrumWert(kanal) {
  const i = SPEKTRUM_QUELLEN.indexOf(kanal);
  return i > 0 ? i : 0;
}
