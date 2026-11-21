// CONTROLLERS tab. Left: the devices (controller places, detected MIDI devices without a place, the known devices plugged in or not, tablets);
// a click picks one. Right, three views of the same assignments:
//  - a device with a control layout (Launch Control 3, LPD8): the device as a grid of tiles in hardware layout, each tile with its target or "free";
//    a click opens a picker (module chips, then the targets of that module, searchable) that assigns with one click, without moving a knob. A knob
//    lists the continuous targets; a button or pad lists the switches and deck actions (Play, Cue, PFL, Kill ...);
//  - a picked MODULE: every assignable target of the module, assigned ones with device and control, free continuous ones with LEARN, free switches and
//    actions without it, and (with a device picked) an ASSIGN menu of the free knobs (continuous rows) or of the free buttons and pads (switches, actions);
//  - otherwise the table of the assignments in effect (all devices, or a desk device without a layout).
// "Free only" hides what is assigned in the first two. Moving a control on a controller marks its tile or row (the kern reports the move), so a control
// is found by touching it. Data: GET /register (assignment files, the device catalogue with layouts), GET /register/ziele (every learnable target),
// GET /geraete (places, detected sources), GET /lernen (learned assignments).
// Follow and presets (a device with a layout and a known model): a FOLLOW switch and a line "follows <graph> on <synth>" with the device in the list, a preset bar
// (SAVE FOR <graph>, SAVE AS, LOAD chips, DELETE on yours) above its tiles. Data: GET /controller/fokus (the synth in front, what each place follows, the preset
// applied), GET /controller/presets, POST /controller/presets/*, POST /geraete/controller {platz, folgen}; the stream event controller_fokus redraws (registerFokus).
// KEYS line under the device list: "KEYS -> <track or channel>" with a switch (POST /controller/fokus/tasten {an}); the field `tasten` of GET /controller/fokus says where
// the MIDI keys go. An older page server without the field shows no line.
// A page server that does not know the routes (404) leaves the switch disabled with a short text and shows no preset buttons; the rest works as before.
import { CONTAINER, STROEME, containerName, stromKanal, stromName } from './kanaele.js';
const FEHLER_TEXT = { json: 'does not parse', form: 'not a mapping file (version 1 with eintraege)' };
const SOFTWARE = (q) => /^bluez_midi\./.test(q.port) || /Midi Through/i.test(`${q.port} ${q.alias ?? ''}`);
const quelleName = (q) => String(q.alias || '').split(':')[0].trim() || q.port;
const WEG_TEXT = { pult: 'desk bridge', lernen: 'learn input', offen: 'not bound yet' };
const TYP_TEXT = { cc: 'CC', note: 'Note' };
const ART_TEXT = { absolut: 'knob', relativ: 'encoder', taste: 'button', beruehrung: 'touch', umschalten: 'toggle' };

/** The module of the studio a target belongs to, by its path: {id, name}. */
export function modulVon(ziel) {
  const t = String(ziel).split('/'), n = t[1];
  const letter = containerName(`${t[0]}/${n}`);   // a container strip (deck/1, deck/2, pad/1, pad/2) is named by its place letter
  if (letter) return { id: `${t[0]}/${n}`, name: `Container ${letter}` };
  if (t[0] === 'erz') return { id: stromKanal(n), name: stromName(Number(n)) === `S${n}` ? `Stream ${n}` : { 1: 'Drums', 2: 'Bass', 3: 'Melody' }[n] };
  if (t[0] === 'fx') return { id: `fx/${n}`, name: n === '3' ? 'FX3 Remix' : `FX${n}` };
  if (t[0] === 'spur') return { id: `spur/${n}`, name: `Track ${n}` };
  if (t[0] === 'grp') return { id: `grp/${n}`, name: `Group ${n}` };
  if (t[0] === 'ret') return { id: `ret/${n}`, name: `Return ${n}` };
  if (t[0] === 'bus') return { id: `bus/${n}`, name: `Bus ${n}` };
  if (t[0] === 'seite' || t[0] === '<kanal>') return { id: 'graph', name: 'Graph knobs (Maschine)' };
  const fest = { color: 'Color FX', duck: 'Ducking', xfader: 'Crossfader', master: 'Master', ansicht: 'S8 screens', cue: 'Cue', keylock: 'Keylock', ins: 'Inserts', pm: 'Project master', spektrum: 'Spectrum' }[t[0]];
  return { id: t[0], name: fest ?? t[0] };
}
// Which modules a view of the page shows (the module ids of modulVon; a trailing "/" is a prefix).
export const SICHTEN = [
  { id: 'dj', name: 'DJ', module: [...CONTAINER.map((c) => c.pfad), 'fx/', 'color', 'duck', 'xfader', 'master', 'ansicht'] },
  { id: 'live', name: 'LIVE', module: [...STROEME.map(stromKanal), ...CONTAINER.filter((c) => c.player > 2).map((c) => c.pfad), 'fx/', 'color', 'duck', 'master', 'graph'] },
  { id: 'production', name: 'PRODUCTION', module: ['spur/', 'master'] },
];
const inSicht = (modulId, sichtId) => { const s = SICHTEN.find((x) => x.id === sichtId); return !s || s.module.some((m) => (m.endsWith('/') ? modulId.startsWith(m) : modulId === m)); };

function zelle(tag, text, klasse) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (klasse) e.classList.add(klasse);
  return e;
}
function knopf(text, titel, beiKlick) {
  const b = zelle('button', text, 'reg-learn');
  b.setAttribute('type', 'button');
  b.setAttribute('title', titel);
  b.addEventListener('click', (e) => { e?.stopPropagation?.(); beiKlick(); });
  return b;
}

// Readable names of the path parts after the module ("deck/1/eq/tief" -> "EQ low"); unknown parts stay as they are.
const TEIL = { fader: 'fader', trim: 'trim', eq: 'EQ', tief: 'low', mitte: 'mid', hoch: 'high', filter: 'filter', send: 'send', xseite: 'crossfader side', ziel: 'target',
  komp: 'comp', schwelle: 'threshold', ratio: 'ratio', attack: 'attack', release: 'release', makeup: 'makeup', mix: 'mix', sc: 'sidechain', stem: 'stem', gate: 'gate',
  hysterese: 'hysteresis', bereich: 'range', hold: 'hold', util: 'utility', balance: 'balance', breite: 'width', bassmono: 'bass mono', mb: 'multiband',
  grenze_tief: 'split low', grenze_hoch: 'split high', knie: 'knee', lim: 'limiter', decke: 'ceiling', abklingen: 'decay', pan: 'pan', pegel: 'level', kleber: 'glue',
  notenwert: 'note length', rueckkopplung: 'feedback', rueckweg: 'return', tiefe: 'depth', art: 'type', param: 'parameter', pre: 'pre-delay', decay: 'decay',
  groesse: 'size', highcut: 'high cut', fahne: 'tail', hall: 'reverb', drums: 'drums', bass: 'bass', vocals: 'vocals', other: 'other',
  // switches and deck actions (a button or pad drives them)
  kill: 'kill', pfl: 'PFL', split: 'split', mute: 'mute', solo: 'solo', an: 'on', umgehen: 'bypass', phase_l: 'phase L', phase_r: 'phase R', tausch: 'swap', dc: 'DC filter', propq: 'proportional Q',
  play: 'play', cue: 'cue', hotcue: 'hotcue', hotcue_setzen: 'set hotcue', loop: 'loop', loop_laenge: 'loop length', sprung_plus: 'jump +', sprung_minus: 'jump -', nudge: 'nudge',
  tap: 'tap', slip: 'slip', laden: 'load', roll: 'roll' };
/** What a target is called inside its module: the knob name of a graph where one is known, "Knob n" for a graph knob without one, else the path parts in words. */
export function zielLabel(pfad, knopfName) {
  if (knopfName) return knopfName;
  const t = String(pfad).split('/');
  const rest = /^(deck|pad|erz|fx|spur|grp|ret|bus)$/.test(t[0]) ? t.slice(2) : t.slice(1);
  if (rest.length === 0) return modulVon(pfad).name;
  if (rest[0] === 'bk' && rest.length === 2) return `Knob ${rest[1]}`;
  const text = rest.map((x) => TEIL[x] ?? x).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Every target a picker or the module view can show: all learnable targets (`ziele` = GET /register/ziele: {pfad, name?}) plus every assigned
 * target that is not among them (a switch, a graph knob of the Maschine). Each row says whether it is free (no assignment in effect, on any device)
 * and, when it is not, who has it. `opt`: `modul`, `sicht` (ids), `nurFrei`, `filter` (text over label, path, module, device, control), `namen` (owner
 * key -> device name, namenVon), `zielNamen` (not used for labels: the graph knob names come with `ziele`). Order: the order of `ziele`, then the rest.
 * `namenlose: false` leaves out the free graph knobs without a knob name (64 per channel, they do nothing while no graph names them) unless a text is searched.
 * `arten` (a list of 'regler' | 'schalter' | 'aktion') keeps only the targets of those kinds: the picker of a knob lists 'regler', the picker of a button or pad
 * 'schalter' and 'aktion'. A row has `art`: the kind the server reports for it; a target outside `ziele` (an old server, a desk assignment the list does
 * not know) is 'schalter' when a button drives it and 'regler' otherwise.
 */
export function zielZeilen(ziele, daten, opt = {}) {
  const belegt = new Map();
  for (const z of registerZeilen(daten, '', { namen: opt.namen })) if (!belegt.has(z.ziel)) belegt.set(z.ziel, z);   // a learned assignment comes first
  const f = String(opt.filter ?? '').trim().toLowerCase();
  const aus = [], gesehen = new Set(), lernbar = new Set((ziele ?? []).map((z) => z.pfad)), artVon = new Map((ziele ?? []).map((z) => [z.pfad, z.art ?? 'regler']));
  const nimm = (pfad, name) => {
    gesehen.add(pfad);
    const m = modulVon(pfad), b = belegt.get(pfad), art = artVon.get(pfad) ?? (b?.art === ART_TEXT.taste ? 'schalter' : 'regler');
    if ((opt.arten && !opt.arten.includes(art)) || (opt.modul && m.id !== opt.modul) || (opt.sicht && !inSicht(m.id, opt.sicht)) || (opt.nurFrei && b)) return;
    const namenlos = !name && /\/bk\/\d+$/.test(pfad);
    if (namenlos && !b && opt.namenlose === false && f === '') return;   // a free graph knob no loaded graph names: hidden until asked for or searched
    const z = { pfad, art, name: name ?? null, namenlos, label: zielLabel(pfad, name), modulId: m.id, modul: m.name, lernbar: lernbar.has(pfad), frei: !b, besitzer: b?.besitzer ?? null, geraet: b?.geraet ?? '', quelle: b?.quelle ?? '', loeschbar: !!b?.loeschbar };
    if (f === '' || [z.label, z.pfad, z.modul, z.geraet, z.quelle].some((x) => String(x).toLowerCase().includes(f))) aus.push(z);
  };
  for (const z of ziele ?? []) nimm(z.pfad, z.name);
  for (const pfad of belegt.keys()) if (!gesehen.has(pfad)) nimm(pfad, undefined);
  return aus;
}

/** The module chips: one per module with learnable or assigned targets, with "<free> of <learnable> free" (a module with only assigned switches: "<n> assigned"). `opt`: `sicht`, `nurFrei` (leaves out modules without a free target), `namen`, `arten` (see zielZeilen: the chip then counts only the targets of those kinds, so it
 * says what the list below it shows). Without `arten` every kind counts: the module view lists knobs, switches and actions. */
export function modulZaehler(ziele, daten, opt = {}) {
  const m = new Map();
  for (const z of zielZeilen(ziele, daten, { namen: opt.namen, sicht: opt.sicht, namenlose: opt.namenlose, arten: opt.arten })) {
    const e = m.get(z.modulId) ?? { id: z.modulId, name: z.modul, gesamt: 0, frei: 0, belegt: 0 };
    if (z.lernbar) e.gesamt++; else e.belegt++;
    if (z.lernbar && z.frei) e.frei++;
    m.set(z.modulId, e);
  }
  const rang = (id) => { const i = MODUL_REIHE.indexOf(id.split('/')[0]); return i < 0 ? 99 : i; };
  return [...m.values()].filter((e) => !opt.nurFrei || e.frei > 0).sort((a, b) => rang(a.id) - rang(b.id) || a.id.localeCompare(b.id, 'en', { numeric: true }))
    .map((e) => ({ id: e.id, name: e.name, frei: e.frei, gesamt: e.gesamt, anzahl: e.gesamt ? `${e.frei} of ${e.gesamt} free` : `${e.belegt} assigned` }));
}
const FAMILIE = { spur: 'Tracks', grp: 'Groups', ret: 'Returns', bus: 'Buses' };
/**
 * Folds the big module families of the chip row (tracks, groups, returns, buses: more than four chips of one kind) into one chip each, "Tracks 1–32 ·
 * 190 of 192 free" with the id "familie:<kind>". A family in `offen` (a Set of kinds) or holding the picked module `gewaehlt` stays unfolded, its
 * family chip then reads "Tracks ▾" and folds it again.
 */
export function falteModule(chips, offen = new Set(), gewaehlt = null) {
  const art = (c) => c.id.split('/')[0];
  const zahl = new Map();
  for (const c of chips) if (FAMILIE[art(c)]) zahl.set(art(c), (zahl.get(art(c)) ?? 0) + 1);
  const aus = [], fertig = new Set();
  for (const c of chips) {
    const a = art(c);
    if ((zahl.get(a) ?? 0) <= 4) { aus.push(c); continue; }
    const auf = offen.has(a) || (gewaehlt !== null && art({ id: gewaehlt }) === a);
    if (!fertig.has(a)) {
      fertig.add(a);
      const alle = chips.filter((x) => art(x) === a), nr = alle.map((x) => Number(x.id.split('/')[1])).filter(Number.isFinite);
      const frei = alle.reduce((s, x) => s + x.frei, 0), gesamt = alle.reduce((s, x) => s + x.gesamt, 0);
      aus.push(auf ? { id: `familie:${a}`, name: `${FAMILIE[a]} ▾`, familie: a, frei, gesamt }
        : { id: `familie:${a}`, name: `${FAMILIE[a]} ${Math.min(...nr)}–${Math.max(...nr)}`, familie: a, frei, gesamt, anzahl: `${frei} of ${gesamt} free` });
    }
    if (auf) aus.push(c);
  }
  return aus;
}
const MODUL_REIHE = ['deck', 'pad', 'erz', 'fx', 'color', 'duck', 'xfader', 'master', 'cue', 'keylock', 'spur', 'grp', 'ret', 'bus', 'ins', 'pm', 'spektrum', 'ansicht', 'graph'];

/**
 * The tiles of a device from its control layout (`regler`, catalog.ts) and the learn table (`zuordnungen`: GET /lernen). `opt.platz` is the
 * controller place, `opt.daw` is true while the place sits on the device's DAW port (some controls then send on another channel), `opt.namen` maps a
 * target path to its graph knob name. A tile has `ziel` (null = free), `label`, `modul`, `zuweisbar` (every control of a layout: a CC and a note can
 * both be assigned) and `kanal`: what an assignment of this tile sends. An entry of the learn table belongs to a tile by message type, channel and
 * number (`typ` 'note' for a pad; an entry without `typ` is a CC). An entry that is not in the layout becomes an extra tile "CC n · ch k" or "Note n · ch k"
 * after the layout.
 * A device with banks (`opt.baenke`, catalog.ts: the layout once per MIDI channel) shows one of them, `opt.bank` (an index, default 0): every
 * control sends on that bank's channel, a note control carries the bank's note, and an entry learned in another bank is not an extra tile here.
 */
export function kacheln(regler, zuordnungen, opt = {}) {
  const meine = (zuordnungen ?? []).filter((z) => (z.platz ?? 1) === (opt.platz ?? 1));
  const typVon = (z) => z.typ ?? 'cc';
  const benutzt = new Set();
  const mit = (z, t) => {
    if (!z) return { ...t, ziel: null, label: '', modul: '', modulId: '' };
    const m = modulVon(z.pfad);
    return { ...t, ziel: z.pfad, label: zielLabel(z.pfad, opt.namen?.get(z.pfad)), modul: m.name, modulId: m.id };
  };
  const bank = opt.baenke?.[opt.bank ?? 0] ?? null;
  let note = 0;
  const aus = (regler ?? []).map((r) => {
    const kanal = bank ? bank.kanal : r.kanal;
    const nr = r.typ === 'note' && bank?.noten ? bank.noten[note++] ?? r.nr : r.nr;
    const z = meine.find((x) => typVon(x) === r.typ && x.nr === nr && (x.kanal === kanal || x.kanal === 0 || (!bank && x.kanal === r.kanal_daw)));   // channel 0: an entry for any channel (a preset)
    if (z) benutzt.add(z);
    return mit(z, { schluessel: `${r.typ}:${r.nr}`, name: r.name, typ: r.typ, kanal: z ? z.kanal : opt.daw && r.kanal_daw && !bank ? r.kanal_daw : kanal, nr, art: r.art, zeile: r.zeile, spalte: r.spalte, zuweisbar: true, extra: false });
  });
  if (bank) for (const z of meine) {   // a control of another bank
    const b = opt.baenke.find((x) => x.kanal === z.kanal);
    if (b && (typVon(z) === 'cc' ? (regler ?? []).some((r) => r.typ === 'cc' && r.nr === z.nr) : (b.noten ?? []).includes(z.nr))) benutzt.add(z);
  }
  const unten = aus.reduce((m, k) => Math.max(m, k.zeile), 0);
  meine.filter((z) => !benutzt.has(z)).forEach((z, i) => {
    const pad = typVon(z) === 'note';
    aus.push(mit(z, { schluessel: `${pad ? 'xn' : 'x'}:${z.kanal}:${z.nr}`, name: `${pad ? 'Note' : 'CC'} ${z.nr} · ch ${z.kanal}`, typ: typVon(z), kanal: z.kanal, nr: z.nr, art: pad ? 'pad' : z.art === 'taste' ? 'button' : 'knob', zeile: unten + 1 + Math.floor(i / 8), spalte: (i % 8) + 1, zuweisbar: true, extra: true }));
  });
  return aus;
}
/**
 * The kinds of target a tile takes (zielZeilen `arten`): a knob the continuous targets, a button or pad the switches and deck actions. A button
 * sends a CC, a pad a note: either one is a press.
 */
export const kachelArten = (k) => (k?.art === 'knob' ? ['regler'] : ['schalter', 'aktion']);
/**
 * The control the picker moves on to after `k` was assigned: the next free one after it in layout order (wrapping round) that is of the same
 * class: a knob goes on to the next free knob, a button or pad to the next free button or pad. null when there is none, or `k` is not among `ks`.
 */
export function naechsteFreie(ks, k) {
  const i = ks.findIndex((x) => x.schluessel === k.schluessel);
  if (i < 0) return null;
  const knopf = (x) => x.art === 'knob';
  return [...ks.slice(i + 1), ...ks.slice(0, i)].find((x) => x.zuweisbar && !x.ziel && knopf(x) === knopf(k)) ?? null;
}
/** { frei, gesamt } of the assignable controls among the tiles. */
export const kachelZaehler = (ks) => { const a = ks.filter((k) => k.zuweisbar); return { frei: a.filter((k) => !k.ziel).length, gesamt: a.length }; };
/**
 * The tiles to show: `opt.nurFrei` keeps the free assignable ones; `opt.sicht` hides assigned tiles whose module is not in that view (free ones stay,
 * they could take any module); `opt.filter` matches control, module, target and device text (a free tile only by its control name).
 */
export function kachelSicht(ks, opt = {}) {
  const f = String(opt.filter ?? '').trim().toLowerCase();
  return ks.filter((k) => {
    if (opt.nurFrei && (k.ziel || !k.zuweisbar)) return false;
    if (opt.sicht && k.ziel && !inSicht(k.modulId, opt.sicht)) return false;
    return f === '' || [k.name, k.ziel ?? '', k.label, k.modul, `${TYP_TEXT[k.typ]} ${k.nr}`].some((x) => String(x).toLowerCase().includes(f));
  });
}

/**
 * Rows of the DEVICES list, one per device: `register` = GET /register (its `katalog` and `kanten`), `geraete` = GET /geraete (its `controller`
 * places and the detected `quellen.midi`), `lern` = GET /lernen (how many controls each place has learned), `tablets` = paired tablets or null
 * when unknown. `schluessel` is what the assignments of the device carry as `besitzer` ("platz:<k>" or the catalogue id); null: nothing to show.
 * Order: controller places, detected MIDI devices without a place (they get ADD), then the known devices that are not on a place.
 */
export function geraeteZeilen(register, geraete, lern, tablets = null) {
  const katalog = register?.katalog ?? [], plaetze = geraete?.controller ?? [], quellen = geraete?.quellen?.midi ?? [];
  const katVon = (text) => katalog.find((k) => k.midi && text.includes(k.midi));
  const gelernt = (platz) => (lern?.zuordnungen ?? []).filter((z) => (z.platz ?? 1) === platz).length;
  const belegt = (id) => (register?.kanten ?? []).filter((k) => k.besitzer === id).length;
  const zeilen = [], gesehen = new Set();
  for (const c of plaetze) {
    const k = katVon(c.port);
    if (k) gesehen.add(k.id);
    const zustand = !c.da ? 'not connected' : c.verbunden === false ? 'found, not linked yet' : c.verbunden === null ? 'connected (core not reporting)' : 'connected';
    // a device whose feedback runs over a second port (Launch Control 3: its DAW port): the place can change between the plain port and that one
    let wechsel = null;
    if (k?.rueckweg_port && c.platz >= 2) {
      const aufRueckweg = c.port.includes(k.rueckweg_port);
      const anderer = quellen.find((q) => q.port !== c.port && katVon(`${q.port} ${q.alias ?? ''}`) === k && q.port.includes(k.rueckweg_port) !== aufRueckweg && !/DIN/.test(q.port));
      if (anderer) wechsel = { text: aufRueckweg ? 'PLAIN MIDI' : 'LEDS + DISPLAY', port: anderer.port,
        titel: aufRueckweg ? 'Back to the plain MIDI port: the device keeps its own modes, no LEDs or display from the studio' : 'Put the place on the feedback port: the studio lights the learned encoders and shows their names on the display' };
    }
    // a device with a control layout counts its free controls, any other its learned ones
    const daw = !!(k?.rueckweg_port && c.port.includes(k.rueckweg_port));
    const z = !k?.regler ? null : (k.baenke ?? [null]).map((_, i) => kachelZaehler(kacheln(k.regler, lern?.zuordnungen, { platz: c.platz, daw, baenke: k.baenke, bank: i })))
      .reduce((s, x) => ({ frei: s.frei + x.frei, gesamt: s.gesamt + x.gesamt }), { frei: 0, gesamt: 0 });
    zeilen.push({ art: 'platz', schluessel: `platz:${c.platz}`, platz: c.platz, name: k?.name ?? c.name, da: !!c.da, zustand, weg: `learn input ${c.platz}`, anzahl: z ? `${z.frei} of ${z.gesamt} free` : `${gelernt(c.platz)} learned`,
      rueckweg: k?.rueckweg ?? '', hinweis: c.port, entfernen: c.platz >= 2, wechsel, modell: k?.id ?? null, regler: k?.regler ?? null, baenke: k?.baenke ?? null, bedienung: k?.bedienung ?? '', daw });
  }
  for (const q of quellen) {
    if (SOFTWARE(q) || /\bDAW\b/.test(q.port) || plaetze.some((c) => c.port === q.port)) continue;   // a DAW port is the device's feedback side, not a second controller
    const k = katVon(`${q.port} ${q.alias ?? ''}`);
    if (k && (k.weg === 'pult' || gesehen.has(k.id))) continue;   // the desk bridge owns it, or another port of it already sits on a place
    if (k) gesehen.add(k.id);
    zeilen.push({ art: 'frei', schluessel: null, platz: null, name: k?.name ?? quelleName(q), da: true, zustand: 'connected, no place yet', weg: 'learn input', anzahl: '', rueckweg: k?.rueckweg ?? '', hinweis: q.port, port: q.port });
  }
  for (const k of katalog) {
    if (gesehen.has(k.id)) continue;
    const n = register?.kanten ? belegt(k.id) : (k.eintraege ?? 0);
    zeilen.push({ art: 'katalog', schluessel: k.id, platz: null, name: k.name, da: !!k.da, zustand: k.da ? 'connected' : 'not connected', weg: WEG_TEXT[k.weg] ?? k.weg,
      anzahl: n ? `${n} assigned` : '', rueckweg: k.rueckweg, hinweis: k.hinweis });
  }
  if (tablets !== null) zeilen.push({ art: 'tablet', schluessel: null, platz: null, name: 'Tablet', da: tablets > 0, zustand: tablets > 0 ? `${tablets} paired` : 'none paired', weg: 'page on the home network', anzahl: '', rueckweg: 'the page itself', hinweis: 'instruments and effects as touch panels' });
  return zeilen;
}

// ---- follow and presets (the server side: docs/controller/README.md, routes /controller/fokus and /controller/presets*) ----
const GRUND_FOLGEN = {
  kein_graph: (ort) => `${ort} has no graph loaded`,
  kein_bk: (ort) => `${ort} is not a Baukasten synth`,
  slot_ohne_zeile: (ort) => `${ort} has no controller row (its Baukasten slot is beyond the controller rows)`,
};
const presetName = (id, liste) => (liste ?? []).find((p) => p.id === id)?.name ?? String(id).split('/').pop();
/**
 * What the device row says about following. `stand` = GET /controller/fokus ({fokus, plaetze}) or null (a page server without the route), `platz` = the controller
 * place, `opt` = { kanalName(kanal), spurName(spur_id), presets (the list, for the name of an applied preset) }.
 * { verfuegbar (the switch works), folgt, text (the line under the device name), titel (what the switch says) }
 */
export function folgenAnsicht(stand, platz, opt = {}) {
  if (!stand) return { verfuegbar: false, folgt: false, text: 'Follow is not available on this page server yet', titel: 'The page server does not know following yet: restart it with the newer version' };
  const p = (stand.plaetze ?? []).find((x) => x.platz === platz);
  if (!p || !p.modell) return { verfuegbar: false, folgt: false, text: 'Follow is not available for this device', titel: 'The studio does not know the layout of this device, so it cannot load assignments for it' };
  const titel = 'The assignments of this device follow the synth in front: a preset of this device for that synth, else its knobs in order';
  if (!p.folgen) return { verfuegbar: true, folgt: false, text: '', titel };
  const f = stand.fokus;
  if (!f) return { verfuegbar: true, folgt: true, text: 'follows: no synth in front', titel };
  const ort = f.kanal ? (opt.kanalName?.(f.kanal) ?? f.kanal) : (opt.spurName?.(f.spur_id) ?? `track ${f.spur_id}`);
  if (!f.basis) return { verfuegbar: true, folgt: true, text: `follows: ${(GRUND_FOLGEN[f.grund] ?? ((o) => `${o} cannot be followed`))(ort)}`, titel };
  const dazu = p.preset ? ` · ${p.preset === 'bank' ? 'default bank' : `preset ${presetName(p.preset, opt.presets)}`}` : '';
  return { verfuegbar: true, folgt: true, text: `follows ${f.graph} on ${ort}${dazu}`, titel };
}
const GRUND_TASTEN = {
  kein_fokus: 'no synth in front',
  kein_instrument: 'the track in front is not an instrument',
  keine_senke: 'the instrument in front has no sound path for keys',
  kein_ziel: 'this channel takes no keys',
  kern_alt: 'the studio core cannot play keys on live channels yet',
};
/**
 * The KEYS line: where the MIDI keys go (plan N1). `stand` = GET /controller/fokus; a page server without the `tasten` field (older) gives null: no line.
 * `opt` = { kanalName(kanal), spurName(spur_id) }. { an (the switch), text, titel }
 */
export function tastenAnsicht(stand, opt = {}) {
  const t = stand?.tasten;
  if (!t || typeof t !== 'object' || typeof t.an !== 'boolean') return null;
  const titel = 'The keys of your MIDI keyboard play the instrument in front (a project track or a live channel) as long as this is on';
  if (!t.an) return { an: false, text: 'KEYS off', titel };
  const z = t.ziel;
  if (z?.spur_id) return { an: true, text: `KEYS \u2192 ${opt.spurName?.(z.spur_id) ?? `track ${z.spur_id}`}`, titel };
  if (z?.kanal) return { an: true, text: `KEYS \u2192 ${opt.kanalName?.(z.kanal) ?? z.kanal}`, titel };
  return { an: true, text: `KEYS \u2192 none: ${(GRUND_TASTEN[t.grund] ?? 'no target')}`, titel };
}
/** Fills `el` with the one KEYS line in the look of a device row with its FOLLOW switch; `opt.schalte(an)` is called with the opposite of the current switch. */
export function baueTasten(el, ansicht, opt = {}) {
  if (!ansicht) { el.replaceChildren(); return; }
  const zeile = document.createElement('div');
  zeile.classList.add('reg-geraet', 'reg-tasten');
  zeile.setAttribute('title', ansicht.titel);
  const text = document.createElement('div');
  text.classList.add('reg-geraet-text');
  text.append(zelle('div', ansicht.text, 'reg-geraet-info'));
  const tat = document.createElement('div');
  tat.classList.add('reg-geraet-tat');
  const k = knopf('KEYS', ansicht.titel, () => opt.schalte?.(!ansicht.an));
  k.classList.toggle('an', ansicht.an);
  k.setAttribute('aria-pressed', String(ansicht.an));
  tat.append(k);
  zeile.append(text, tat);
  el.replaceChildren(zeile);
}
/** The SAVE FOR button: only with a synth in front that has a base to save the assignments of. */
export function speicherAngebot(stand) {
  const f = stand?.fokus;
  if (f?.basis && f.graph) return { an: true, graph: f.graph, text: `SAVE FOR ${f.graph}`, titel: `Save the assignments that point at ${f.graph} as its preset for this device` };
  return { an: false, graph: null, text: 'SAVE FOR SYNTH', titel: 'Needs a synth in front that has Baukasten knobs: pick one in INSTRUMENTS, the workbench, PRODUCTION or a SEQ deck' };
}
/** The LOAD list of one device model: { id, name, text, art, herkunft, aktiv, aus, grund, loeschbar }. An instrument preset waits (aus) while no synth with
 *  a base is in front or while that synth runs another graph; usable presets come first. */
export function praesetAnsicht(liste, modell, stand, platz) {
  if (!modell) return [];
  const f = stand?.fokus, angewandt = (stand?.plaetze ?? []).find((x) => x.platz === platz)?.preset ?? null;
  const zeilen = (liste ?? []).filter((p) => p.modell === modell).map((p) => {
    let grund = '';
    if (p.art === 'instrument') {
      if (!f?.basis) grund = 'Needs a synth in front';
      else if (f.graph !== p.graph) grund = `For ${p.graph}; the synth in front is ${f.graph}`;
    }
    return { id: p.id, name: p.name, text: `${p.name} · ${p.herkunft === 'werk' ? 'factory' : 'yours'}`, art: p.art, herkunft: p.herkunft, aktiv: p.id === angewandt, aus: grund !== '', grund, loeschbar: p.herkunft === 'nutzer' };
  });
  return zeilen.sort((a, b) => (a.aus - b.aus) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.herkunft < b.herkunft ? -1 : 1));
}
/** GET /controller/fokus through `hole(url)` (fetch): { stand, fehlt }. 404 = a page server without the route: stand null, fehlt true. Any other failure keeps `alt`. */
export async function holeFolgenStand(hole, alt) {
  try {
    const r = await hole('/controller/fokus');
    if (r.status === 404) return { stand: null, fehlt: true };
    if (!r.ok) return { stand: alt, fehlt: false };
    return { stand: await r.json(), fehlt: false };
  } catch { return { stand: alt, fehlt: false }; }
}

/** Device names by `besitzer` key, from the rows of geraeteZeilen. */
export const namenVon = (zeilen) => new Map(zeilen.filter((z) => z.schluessel).map((z) => [z.schluessel, z.name]));

/**
 * Rows of the assignment table: one per assignment IN EFFECT (files that are not loaded are left out). `opt.besitzer` keeps one device,
 * `opt.namen` (namenVon) turns the owner key into the device name, `opt.zielNamen` (path -> readable name, e.g. the knob name of a graph) adds
 * `name`, `filter` matches case-insensitively over device, control, target and kind.
 * `loeschbar`: a learned assignment (it can be deleted here).
 */
export function registerZeilen(daten, filter, opt = {}) {
  const rolle = new Map((daten?.geraete ?? []).map((g) => [g.id, g.rolle]));
  const f = String(filter ?? '').trim().toLowerCase();
  const quelleText = (q) => (q && q.name !== undefined ? String(q.name) : `${TYP_TEXT[q?.typ] ?? q?.typ} ${q?.nr} · ch ${q?.kanal}`);
  const zeilen = [];
  for (const k of daten?.kanten ?? []) {
    const r = rolle.get(k.geraet) ?? '';
    if (r === 'inaktiv') continue;
    if (opt.besitzer && k.besitzer !== opt.besitzer) continue;
    const modul = modulVon(k.ziel);
    if ((opt.modul && modul.id !== opt.modul) || (opt.sicht && !inSicht(modul.id, opt.sicht))) continue;
    const name = opt.zielNamen?.get(k.ziel);
    zeilen.push({ besitzer: k.besitzer ?? null, geraet: opt.namen?.get(k.besitzer) ?? k.besitzer ?? k.geraet, quelle: quelleText(k.quelle), ziel: k.ziel, modul: modul.name, modulId: modul.id, art: ART_TEXT[k.art] ?? k.art, loeschbar: r === 'lernen',
      ...(name && name !== k.ziel ? { name } : {}) });
  }
  zeilen.sort((x, y) => Number(y.loeschbar) - Number(x.loeschbar));   // what was learned by hand comes first (stable: the file order stays within both groups)
  return f === '' ? zeilen : zeilen.filter((z) => [z.geraet, z.quelle, z.ziel, z.modul, z.art, z.name ?? ''].some((s) => String(s).toLowerCase().includes(f)));
}

/**
 * Fills `el` with the DEVICES list. A click on a device picks it (`opt.waehle(schluessel)`, null = all); `opt.auswahl` is the picked key.
 * `opt.schicken(daten)` posts to /geraete/controller (ADD: {port}, REMOVE: {platz, port: null}, port change: {platz, port}). Only text is set from data.
 */
export function baueGeraete(el, zeilen, opt) {
  const liste = document.createElement('div');
  liste.classList.add('reg-geraete');
  const alle = zelle('div', 'All devices', 'reg-geraet');
  alle.classList.add('reg-alle');
  if (!opt?.auswahl) alle.classList.add('an');
  alle.addEventListener('click', () => opt?.waehle?.(null));
  liste.append(alle);
  for (const z of zeilen) {
    const zeile = document.createElement('div');
    zeile.classList.add('reg-geraet');
    if (!z.da) zeile.classList.add('reg-inaktiv');
    if (z.schluessel && z.schluessel === opt?.auswahl) zeile.classList.add('an');
    zeile.setAttribute('title', z.hinweis ?? '');
    const punkt = zelle('span', '', 'reg-punkt');
    if (z.da) punkt.classList.add('an');
    const text = document.createElement('div');
    text.classList.add('reg-geraet-text');
    text.append(zelle('div', z.name, 'reg-geraet-name'), zelle('div', [z.zustand, z.weg, z.anzahl].filter(Boolean).join(' · '), 'reg-geraet-info'));
    if (z.folgen?.text) text.append(zelle('div', z.folgen.text, 'reg-geraet-info'));   // what the device follows, or why it cannot
    const tat = document.createElement('div');
    tat.classList.add('reg-geraet-tat');
    if (z.folgen) {
      const f = knopf('FOLLOW', z.folgen.titel, () => { if (z.folgen.verfuegbar) opt?.folge?.(z.platz, !z.folgen.folgt); });
      f.classList.toggle('an', z.folgen.folgt);
      f.setAttribute('aria-pressed', String(z.folgen.folgt));
      if (!z.folgen.verfuegbar) f.setAttribute('disabled', '');
      tat.append(f);
    }
    if (z.wechsel) tat.append(knopf(z.wechsel.text, z.wechsel.titel, () => opt?.schicken({ platz: z.platz, port: z.wechsel.port })));
    if (z.art === 'frei') tat.append(knopf('ADD', 'Give this controller a place: it can then be learned, and its CC numbers stay its own', () => opt?.schicken({ port: z.port })));
    if (z.entfernen) tat.append(knopf('REMOVE', 'Free this place (what it has learned is kept for the next device on it)', () => opt?.schicken({ platz: z.platz, port: null })));
    zeile.append(punkt, text, tat);
    if (z.schluessel) zeile.addEventListener('click', () => opt?.waehle?.(z.schluessel));
    liste.append(zeile);
  }
  el.replaceChildren(liste);
}

/** A row of pick chips: a title and one button per entry ({id, name, anzahl?}); `beiWahl(id)` is called with the id, or null on the second click of the picked one. */
function wahlReihe(titel, eintraege, gewaehlt, beiWahl) {
  const r = document.createElement('div');
  r.classList.add('reg-wahl');
  r.append(zelle('span', titel, 'reg-wahl-titel'));
  for (const e of eintraege) {
    const b = zelle('button', e.anzahl === undefined ? e.name : `${e.name} · ${e.anzahl}`, 'reg-learn');
    b.setAttribute('type', 'button');
    if (e.id === gewaehlt) b.classList.add('an');
    if (e.anzahl !== undefined && e.frei === 0) b.classList.add('reg-voll');
    b.addEventListener('click', () => beiWahl(e.id === gewaehlt ? null : e.id));
    r.append(b);
  }
  return r;
}

/**
 * Fills `el` with the two pick rows VIEW and MODULE: `module` = [{id, name, anzahl}] (modulZaehler: "5 of 16 free"), `opt.sicht` and
 * `opt.modul` are the picked ids (null = all), `opt.waehle({sicht} | {modul})` picks. A second click on the picked one releases it.
 */
export function baueWahl(el, module, opt) {
  el.replaceChildren(wahlReihe('View', SICHTEN, opt?.sicht ?? null, (id) => opt?.waehle?.({ sicht: id })), wahlReihe('Module', module, opt?.modul ?? null, (id) => opt?.waehle?.({ modul: id })));
}

/**
 * The preset bar of a device: SAVE FOR <graph> (instrument preset), SAVE AS (a snapshot of the whole device under a name), then one chip per preset of the
 * device model (`ansicht.zeilen`, praesetAnsicht); a user preset has a DELETE. `ansicht.verfuegbar` false (a page server without the routes) is one line of text.
 * `opt`: speichereFuer(), speichereAls(), lade(id), loesche(id).
 */
export function bauePresets(el, ansicht, opt = {}) {
  const wurzel = document.createElement('div');
  wurzel.classList.add('reg-presets');
  if (!ansicht.verfuegbar) { wurzel.append(zelle('div', ansicht.text, 'reg-leer')); el.replaceChildren(wurzel); return; }
  const reihe = (titel) => { const r = document.createElement('div'); r.classList.add('reg-wahl'); r.append(zelle('span', titel, 'reg-wahl-titel')); return r; };
  const sp = ansicht.speichern, speichern = reihe('Presets');
  const fuer = knopf(sp.text, sp.titel, () => { if (sp.an) opt.speichereFuer?.(); });
  if (!sp.an) fuer.setAttribute('disabled', '');
  speichern.append(fuer, knopf('SAVE AS', 'Save every assignment of this device under a name; LOAD brings them back as they are', () => opt.speichereAls?.()));
  const laden = reihe('Load');
  for (const z of ansicht.zeilen) {
    const chip = knopf(z.text, z.aus ? z.grund : `Load ${z.name}: replaces the assignments of this device${z.art === 'instrument' ? ' that point at the synth in front' : ''}`, () => { if (!z.aus) opt.lade?.(z.id); });
    chip.classList.toggle('an', z.aktiv);
    if (z.aus) chip.setAttribute('disabled', '');
    if (!z.loeschbar) { laden.append(chip); continue; }
    const paar = document.createElement('span');
    paar.classList.add('reg-preset');
    const weg = knopf('DELETE', `Delete the preset ${z.name} (yours); the factory one stays`, () => opt.loesche?.(z.id));
    weg.setAttribute('data-preset', z.id);
    paar.append(chip, weg);
    laden.append(paar);
  }
  if (!ansicht.zeilen.length) laden.append(zelle('span', 'No presets for this device yet', 'reg-leer'));
  wurzel.append(speichern, laden);
  el.replaceChildren(wurzel);
}

/**
 * Fills `el` with the tiles of a device (kacheln, kachelSicht) in hardware layout: a CSS grid, a tile at its zeile/spalte. A tile shows the control,
 * its target (module, readable name) or "free"; a click on an assignable tile (a knob, a button or a pad) calls `opt.oeffne(kachel)`; an assigned tile has CHANGE (the same) and
 * REMOVE (`opt.entferne(kachel)`). The picker of the open tile (`opt.offen`, a tile) sits in a panel right under that tile's row: `opt.fuelle(panel,
 * kachel)` fills it. `opt.kompakt` lets the tiles flow without gaps (free only). `opt.geraet` is the device name (for the "moved" line).
 * A device with banks gets a row of bank chips above the tiles (`opt.baenke` = [{id, name, anzahl, frei}], `opt.bank` the picked id, `opt.waehleBank(id)`);
 * `opt.bedienung` is a line under the tiles about the controls that are not tiles.
 */
export function baueKacheln(el, ks, opt = {}) {
  const raster = document.createElement('div');
  raster.classList.add('reg-raster');
  raster.style?.setProperty('--spalten', String(Math.max(1, ...ks.map((k) => k.spalte), opt.offen?.spalte ?? 1)));
  const platz = (e, zeile, spalte) => { if (!opt.kompakt && e.style) { e.style.gridRow = String(zeile); e.style.gridColumn = spalte; } };
  const tafel = () => {
    const p = document.createElement('div');
    p.classList.add('reg-waehler');
    platz(p, 2 * opt.offen.zeile, '1 / -1');   // the row between this tile's row and the next (compact: it flows right after the tile)
    opt.fuelle?.(p, opt.offen);
    return p;
  };
  for (const k of ks) {
    const t = document.createElement('div');
    t.classList.add('reg-kachel');
    t.classList.add(k.ziel ? 'belegt' : 'frei');
    if (!k.zuweisbar) t.classList.add('aus');
    if (opt.offen && opt.offen.schluessel === k.schluessel) t.classList.add('offen');
    platz(t, 2 * k.zeile - 1, k.spalte);
    t.setAttribute('data-kachel', k.schluessel);
    t.setAttribute('title', k.ziel ? `${k.name}: ${k.ziel}` : k.zuweisbar ? `${k.name}: free, click to assign ${kachelArten(k)[0] === 'regler' ? 'a target' : 'a switch or deck action'}` : `${k.name}: cannot be assigned`);
    if (k.ziel) {
      t.setAttribute('data-ziel', k.ziel);
      t.setAttribute('data-info', `${opt.geraet ?? ''} · ${k.name} → ${k.modul} · ${k.ziel}`);
    }
    const kopf = document.createElement('div');
    kopf.classList.add('reg-kachel-kopf');
    kopf.append(zelle('span', k.name, 'reg-kachel-name'));
    if (!k.extra) kopf.append(zelle('span', `${TYP_TEXT[k.typ] ?? k.typ} ${k.nr}`, 'reg-kachel-cc'));
    t.append(kopf, zelle('div', k.ziel ? `${k.modul} · ${k.label}` : k.zuweisbar ? 'free' : 'not assignable', 'reg-kachel-ziel'));
    if (k.ziel) {
      const tat = document.createElement('div');
      tat.classList.add('reg-kachel-tat');
      tat.append(knopf('CHANGE', `Pick another target for ${k.name}`, () => opt.oeffne?.(k)), knopf('REMOVE', `Remove the assignment of ${k.ziel}`, () => opt.entferne?.(k)));
      t.append(tat);
    }
    if (k.zuweisbar) t.addEventListener('click', () => opt.oeffne?.(k));
    raster.append(t);
    if (opt.kompakt && opt.offen && opt.offen.schluessel === k.schluessel) raster.append(tafel());
  }
  if (opt.offen && (!opt.kompakt || !ks.some((k) => k.schluessel === opt.offen.schluessel))) raster.append(tafel());   // not flowed in above
  const oben = opt.baenke?.length ? [wahlReihe('Bank', opt.baenke, opt.bank ?? null, (id) => { if (id !== null) opt.waehleBank?.(id); })] : [];
  el.replaceChildren(...(opt.praesets ? [opt.praesets] : []), ...oben, raster, ...(opt.bedienung ? [zelle('div', opt.bedienung, 'reg-bedienung')] : []));
}

/**
 * The picker of one tile: module chips (`opt.module`, `opt.modul`, `opt.waehleModul(id)`), a search field and the targets (`opt.suche` is the text kept between redraws, `opt.beiSuche(text)` stores it; `opt.ziele(suche)` answers
 * zielZeilen rows: of the picked module, or of all modules while none is picked and a text is typed); one click on a target calls `opt.setze(zeile)`. A target
 * that another control has is listed after the free ones and marked: picking it moves it. The search refills the list only, the field keeps its focus.
 * `opt.mehrKnoepfe` free unnamed graph knobs are left out: a chip "+ n unnamed knobs" calls `opt.zeigeKnoepfe()`.
 * `opt.arten` (the kinds the tile takes, kachelArten) only words the header and the search field: a button or pad picks "switches and deck actions".
 */
export function baueWaehler(el, kachel, opt) {
  const kopf = document.createElement('div');
  kopf.classList.add('reg-waehler-kopf');
  const tasten = !!opt.arten && !opt.arten.includes('regler');
  kopf.append(zelle('span', `Assign ${kachel.name}${kachel.extra ? '' : ` (${TYP_TEXT[kachel.typ] ?? kachel.typ} ${kachel.nr} · ch ${kachel.kanal})`}${tasten ? ': switches and deck actions' : ''}`, 'reg-waehler-titel'), knopf('CLOSE', 'Close the picker', () => opt.schliesse?.()));
  const suche = document.createElement('input');
  suche.setAttribute('type', 'search');
  suche.setAttribute('placeholder', tasten ? 'Search the switches and actions of the module, or of all modules' : 'Search the targets of the module, or of all modules');
  suche.classList.add('reg-waehler-suche');
  suche.value = opt.suche ?? '';
  const liste = document.createElement('div');
  liste.classList.add('reg-waehler-liste');
  const fuelle = () => {
    const text = suche.value.trim();
    const zeilen = (opt.ziele?.(text) ?? []).filter((z) => z.lernbar !== false);   // a target only the desk bridge can drive (hot cue, loop) cannot be assigned: not offered
    if (!opt.modul && text === '') { liste.replaceChildren(zelle('div', 'Pick a module above, or type to search every module', 'reg-leer')); return; }
    if (zeilen.length === 0 && !(text === '' && opt.mehrKnoepfe)) { liste.replaceChildren(zelle('div', `No ${opt.nurFrei ? 'free ' : ''}${tasten ? 'switch or action' : 'target'} matches`, 'reg-leer')); return; }
    const sortiert = [...zeilen.filter((z) => z.frei), ...zeilen.filter((z) => !z.frei)];
    const zeige = sortiert.slice(0, 120);
    const knoepfe = zeige.map((z) => {
      const b = document.createElement('button');
      b.setAttribute('type', 'button');
      b.classList.add('reg-wahlziel');
      if (!z.frei) b.classList.add('belegt');
      b.setAttribute('title', z.frei ? `Assign ${z.pfad}` : z.loeschbar ? `${z.pfad} is on ${z.geraet} · ${z.quelle}: picking it moves it here` : `${z.pfad} is also on ${z.geraet} · ${z.quelle} (fixed): picking it adds this control, both work`);
      b.append(zelle('span', opt.modul ? z.label : `${z.modul} · ${z.label}`, 'reg-wahlziel-name'));
      if (!z.frei) b.append(zelle('span', `${z.geraet} · ${z.quelle}`, 'reg-wahlziel-von'));
      b.addEventListener('click', () => opt.setze?.(z));
      return b;
    });
    const mehr = text === '' && opt.mehrKnoepfe ? [knopf(`+ ${opt.mehrKnoepfe} unnamed knobs`, 'Show the graph knobs no loaded graph names', () => opt.zeigeKnoepfe?.())] : [];
    liste.replaceChildren(...knoepfe, ...mehr, ...(sortiert.length > zeige.length ? [zelle('div', `${sortiert.length - zeige.length} more: narrow it with the search`, 'reg-leer')] : []));
  };
  suche.addEventListener('input', () => { opt.beiSuche?.(suche.value); fuelle(); });
  fuelle();
  el.replaceChildren(kopf, wahlReihe('Module', opt.module ?? [], opt.modul ?? null, (id) => opt.waehleModul?.(id)), suche, liste);
}

/**
 * Fills `el` with the targets of ONE module (zielZeilen rows). An assigned row names device and control (DELETE when learned); a free continuous row has
 * LEARN (`opt.lerne(pfad)`; while it is the armed one `opt.wartet` it reads "move a knob…" and a click cancels) and, when a device with free knobs is picked,
 * ASSIGN: a menu of those knobs (`opt.freie` = tiles, `opt.menue` = the path whose menu is open, `opt.oeffneMenue(pfad)`, `opt.zuweisen(pfad, kachel)`).
 * A free switch or action row has no LEARN (the capture hears CCs only): its ASSIGN menu lists the free buttons and pads (`opt.freieTasten`, tiles).
 * `opt.mehr` = {text, titel, klick} adds one button under the table (the unnamed graph knobs).
 */
export function baueZiele(el, zeilen, opt = {}) {
  if (zeilen.length === 0) { el.replaceChildren(zelle('div', opt.leer ?? 'No targets', 'reg-leer'), ...(opt.mehr ? [knopf(opt.mehr.text, opt.mehr.titel ?? '', opt.mehr.klick)] : [])); return; }
  const tabelle = document.createElement('table');
  tabelle.classList.add('reg-tabelle', 'reg-ziele-tabelle');
  const kopf = document.createElement('tr');
  for (const t of ['Target', 'Assigned to', '']) kopf.append(zelle('th', t));
  tabelle.append(kopf);
  for (const z of zeilen) {
    const tr = document.createElement('tr');
    tr.classList.add('reg-zeile');
    tr.classList.add(z.frei ? 'reg-frei' : 'reg-belegt');
    tr.setAttribute('data-ziel', z.pfad);
    if (!z.frei) tr.setAttribute('data-info', `${z.geraet} · ${z.quelle} → ${z.modul} · ${z.pfad}`);
    const name = document.createElement('td');
    name.classList.add('reg-zielzelle');
    name.setAttribute('title', z.pfad);
    name.append(zelle('span', z.label), zelle('span', z.pfad, 'reg-pfad'));
    const tat = document.createElement('td');
    tat.classList.add('reg-tat');
    if (!z.frei && z.loeschbar) tat.append(knopf('DELETE', `Remove the assignment of ${z.pfad}`, () => opt.loesche?.(z.pfad)));
    const taste = !!z.art && z.art !== 'regler';
    const menueListe = taste ? opt.freieTasten : opt.freie;
    if (z.frei) {
      if (!taste) {
        const scharf = opt.wartet === z.pfad;
        const b = knopf(scharf ? 'move a knob…' : 'LEARN', scharf ? 'Click to cancel' : `Arm ${z.pfad}, then move a knob on your controller`, () => opt.lerne?.(z.pfad));
        if (scharf) b.classList.add('an');
        tat.append(b);
      }
      if (menueListe?.length) tat.append(knopf('ASSIGN', `Pick one of the free ${taste ? 'buttons and pads' : 'knobs'} of ${opt.geraet ?? 'the device'}`, () => opt.oeffneMenue?.(z.pfad)));
      else if (taste) tat.append(zelle('span', opt.geraet ? 'no free button or pad' : 'pick a device', 'reg-dim'));
    }
    tr.append(name, zelle('td', z.frei ? 'free' : `${z.geraet} · ${z.quelle}`, z.frei ? 'reg-dim' : undefined), tat);
    tabelle.append(tr);
    if (z.frei && opt.menue === z.pfad && menueListe?.length) {
      const m = document.createElement('tr'), td = document.createElement('td'), box = document.createElement('div');
      td.setAttribute('colspan', '3');
      box.classList.add('reg-menue');
      box.append(zelle('span', `Free ${taste ? 'buttons and pads' : 'knobs'} of ${opt.geraet ?? 'the device'}:`, 'reg-dim'));
      for (const k of menueListe) box.append(knopf(k.name, `${TYP_TEXT[k.typ] ?? k.typ} ${k.nr} · ch ${k.kanal}`, () => opt.zuweisen?.(z.pfad, k)));
      td.append(box);
      m.append(td);
      tabelle.append(m);
    }
  }
  el.replaceChildren(tabelle, ...(opt.mehr ? [knopf(opt.mehr.text, opt.mehr.titel ?? '', opt.mehr.klick)] : []));
}

/** Fills `el` with the assignment table. `opt.loesche(pfad)` removes a learned assignment; `opt.leer` is the text shown without rows. Text only. */
export function baueRegister(el, zeilen, opt) {
  const kinder = [];
  for (const g of opt?.fehler ?? []) kinder.push(zelle('div', `${g.datei}: ${FEHLER_TEXT[g.fehler] ?? g.fehler}`, 'reg-fehler'));
  if (zeilen.length === 0) { el.replaceChildren(...kinder, zelle('div', opt?.leer ?? 'No assignments', 'reg-leer')); return; }
  const tabelle = document.createElement('table');
  tabelle.classList.add('reg-tabelle');
  const kopf = document.createElement('tr');
  for (const t of ['Device', 'Control', 'Module', 'Target', 'Kind', '']) kopf.append(zelle('th', t));
  tabelle.append(kopf);
  for (const z of zeilen) {
    const tr = document.createElement('tr');
    tr.classList.add('reg-zeile');
    tr.setAttribute('data-ziel', z.ziel);
    tr.setAttribute('data-info', `${z.geraet} · ${z.quelle} → ${z.modul} · ${z.ziel}`);
    const tat = document.createElement('td');
    if (z.loeschbar) tat.append(knopf('DELETE', `Remove the assignment of ${z.ziel}`, () => opt?.loesche?.(z.ziel)));
    tr.append(zelle('td', z.geraet), zelle('td', z.quelle), zelle('td', z.modul), zelle('td', z.name ? `${z.ziel}  (${z.name})` : z.ziel, 'reg-zielzelle'), zelle('td', z.art), tat);
    tabelle.append(tr);
  }
  el.replaceChildren(...kinder, tabelle);
}

/**
 * The LEARN row: a target input with a datalist of continuous targets and LEARN / CANCEL. `lern` is the learn table as GET /lernen reports it
 * ({zuordnungen, wartet, controller}); `opt.schicken(pfad, daten)` posts to the learn routes, `opt.ziele(q)` answers the paths for the datalist.
 */
export function baueLernen(el, lern, opt) {
  const zeile = document.createElement('div');
  zeile.classList.add('reg-lernen');
  const eingabe = document.createElement('input');
  eingabe.setAttribute('type', 'text');
  eingabe.setAttribute('list', 'reg-ziele');
  eingabe.setAttribute('placeholder', 'New: target to learn, e.g. deck/1/filter');
  eingabe.classList.add('reg-ziel');
  eingabe.value = opt?.wert ?? '';
  const liste = document.createElement('datalist');
  liste.setAttribute('id', 'reg-ziele');
  eingabe.addEventListener('input', async () => {
    if (opt) opt.wert = eingabe.value;
    const z = (await opt?.ziele?.(eingabe.value)) ?? [];
    liste.replaceChildren(...z.map((p) => { const o = document.createElement('option'); o.setAttribute('value', p); return o; }));
  });
  const wartet = lern?.wartet?.pfad ?? null;
  const b = zelle('button', wartet ? 'CANCEL' : 'LEARN', 'reg-learn');
  b.setAttribute('type', 'button');
  b.addEventListener('click', () => opt?.schicken('/lernen', { pfad: wartet ? null : eingabe.value.trim() }));
  const namen = (lern?.controller ?? []).map((c) => c.name);
  const status = zelle('span', wartet ? `Now move a knob on your controller for ${wartet}` : namen.length ? `then move a knob on ${namen.join(' or ')}` : 'No controller on a place: ADD one on the left', 'reg-status');
  zeile.append(eingabe, liste, b, status);
  el.replaceChildren(zeile);
}

let stand = null, filter = '', auswahl = null, modul = null, sicht = null, nurFrei = false, wahlEl = null, wurzelEl = null, inhalt = null, lernEl = null, lernOpt = null, lernHolen = null, geraeteEl = null, geraeteStand = null, tablets = null, spurEl = null, frei = null;
let tastenEl = null;   // the KEYS line under the device list
let folgenStand = null, folgenFehlt = false, presetListe = null, presetFehlt = false, spurNamen = new Map(), extra = {};   // follow and presets: GET /controller/fokus, GET /controller/presets (null and the flags while the page server does not know the routes), track names for the follow line
let version = 0, letzteSig = '';   // version: counts the rereads of the register and the targets; letzteSig: what was drawn last
let zieleAlle = [], knopfNamen = new Map(), offen = null, waehlerModul = null, waehlerSuche = '', menue = null, knoepfe = false;
const bankVon = new Map();   // device key -> the picked bank (index)
const familien = new Set();   // the unfolded module families (falteModule); knoepfe: the unnamed graph knobs are shown   // targets, the open picker (tile key), its module and search, the open ASSIGN menu (path)
const ziele = async (q) => { try { return ((await (await fetch(`/register/ziele?q=${encodeURIComponent(q)}&limit=50`)).json())?.ziele ?? []).map((z) => z.pfad); } catch { return []; } };
const holeJson = async (pfad) => { try { const r = await fetch(pfad); return r.ok ? await r.json() : null; } catch { return null; } };
/** The focus and the follow flags of the places (GET /controller/fokus), and the name of the track in front when it is a project track. */
async function holeFolgen() {
  const r = await holeFolgenStand((u) => fetch(u), folgenStand);
  folgenStand = r.stand; folgenFehlt = r.fehlt;
  const id = folgenStand?.fokus?.spur_id;
  if (id && !spurNamen.has(id)) {
    const p = await holeJson('/proj/aktuell');
    for (const x of p?.projekt?.spuren ?? []) if (x?.id && x.name) spurNamen.set(x.id, x.name);
  }
}
/** The presets of every device model (GET /controller/presets); a page server without the route: fehlt. */
async function holePresets() {
  try {
    const r = await fetch('/controller/presets');
    if (r.status === 404) { presetListe = null; presetFehlt = true; return; }
    if (r.ok) { presetListe = (await r.json())?.presets ?? []; presetFehlt = false; }
  } catch { /* the page server is gone: keep what is shown */ }
}
/** The focus changed (stream event controller_fokus, body of GET /controller/fokus): redraw the follow lines. */
export function registerFokus(f) {
  if (!f || typeof f !== 'object' || !('plaetze' in f)) return;
  folgenStand = f; folgenFehlt = false;
  const id = f.fokus?.spur_id;
  if (id && !spurNamen.has(id)) holeFolgen().then(() => zeichne(true)); else zeichne(true);
}
async function holeGeraete() {
  await holeFolgen();
  geraeteStand = (await holeJson('/geraete')) ?? geraeteStand;
  const k = await holeJson('/kopplung');   // loopback only: a tablet gets no answer and shows no tablet row
  tablets = Array.isArray(k?.geraete) ? k.geraete.length : null;
}
async function holeRegister() {
  version++;
  stand = (await holeJson('/register')) ?? stand;
  const z = await holeJson('/register/ziele?prefix=');   // every learnable target, with the graph knob names
  if (Array.isArray(z?.ziele)) { zieleAlle = z.ziele; knopfNamen = new Map(z.ziele.filter((x) => x.name).map((x) => [x.pfad, x.name])); }
}
const folgenOpt = () => ({ kanalName: extra.kanalName, spurName: (id) => spurNamen.get(id) ?? null, presets: presetListe ?? [] });
const geraeteListe = () => geraeteZeilen(stand, geraeteStand, lernHolen?.stand?.(), tablets).map((z) => (z.art === 'platz' && z.regler ? { ...z, folgen: folgenAnsicht(folgenStand, z.platz, folgenOpt()) } : z));
/** The tiles of the picked device (null: it has no layout or no place). */
const kachelnVon = (g, bank = bankVon.get(g?.schluessel) ?? 0) => (g?.regler && g.platz ? kacheln(g.regler, lernHolen?.stand?.()?.zuordnungen, { platz: g.platz, daw: g.daw, namen: knopfNamen, baenke: g.baenke, bank }) : null);
const waehlerWaehle = () => document.activeElement?.classList?.contains?.('reg-waehler-suche');   // typing in the picker: a redraw would take the focus away

/**
 * Redraws both sides. The timers call it without `erzwingen`: it then does nothing while the picker's search field has the focus or while nothing it
 * shows has changed (a redraw would throw away a scroll position). The page's own actions force it.
 */
function zeichne(erzwingen = false) {
  if (!stand || !geraeteEl || (!erzwingen && waehlerWaehle())) return;
  const zeilen = geraeteListe();
  const sig = JSON.stringify([version, auswahl, modul, sicht, nurFrei, filter, offen, waehlerModul, menue, knoepfe, [...familien], [...bankVon], zeilen, lernHolen?.stand?.(), presetListe, presetFehlt, folgenStand?.fokus ?? null, folgenStand?.plaetze ?? null, folgenStand?.tasten ?? null]);
  if (!erzwingen && sig === letzteSig) return;
  letzteSig = sig;
  if (auswahl && !zeilen.some((z) => z.schluessel === auswahl)) auswahl = null;   // the picked device left its place
  baueGeraete(geraeteEl, zeilen, { auswahl, waehle: (s) => { auswahl = s; offen = null; menue = null; zeichne(true); }, schicken: geraeteSchicken, folge: (platz, an) => geraeteSchicken({ platz, folgen: an }) });
  if (tastenEl) { tastenEl.remove?.(); tastenEl = null; }
  const tasten = tastenAnsicht(folgenStand, folgenOpt());   // the KEYS line sits under the device list; an older page server gives none
  if (tasten) { tastenEl = document.createElement('div'); baueTasten(tastenEl, tasten, { schalte: tastenSchalte }); geraeteEl.append(tastenEl); }
  const gewaehlt = zeilen.find((z) => z.schluessel === auswahl);
  const namen = namenVon(zeilen);
  // the module chips: every module with a learnable or assigned target in the view, with how many of them are free; a picked module that is gone is released
  const chips = modulZaehler(zieleAlle, stand, { sicht, nurFrei, namen, namenlose: knoepfe });
  if (modul && !chips.some((c) => c.id === modul)) modul = null;
  const familie = (id) => { if (!String(id).startsWith('familie:')) return false; const a = id.slice(8); if (familien.has(a)) familien.delete(a); else familien.add(a); return true; };
  // how many free unnamed graph knobs a target list leaves out (0 while they are shown)
  const versteckt = (m, arten) => (knoepfe || !m ? 0 : zielZeilen(zieleAlle, stand, { modul: m, namen, arten }).filter((z) => z.namenlos && z.frei).length);
  if (wahlEl) baueWahl(wahlEl, falteModule(chips, familien, modul), { sicht, modul, waehle: (w) => {
    if ('sicht' in w) sicht = w.sicht;
    if ('modul' in w) { if (w.modul !== null && familie(w.modul)) { if (modul && modul.split('/')[0] === w.modul.slice(8)) modul = null; } else modul = w.modul; }
    menue = null; zeichne(true); } });
  wahlEl?.querySelector?.('.reg-learn.an')?.scrollIntoView?.({ block: 'nearest' });   // a picked chip stays in view in the scrolling rows
  const ks = kachelnVon(gewaehlt);
  const modus = modul ? 'modul' : ks ? 'kacheln' : 'tabelle';
  if (frei) frei.hidden = modus === 'tabelle';
  if (frei) frei.classList.toggle('an', nurFrei);
  if (frei) frei.setAttribute('aria-pressed', String(nurFrei));
  const leer = (was) => filter || sicht ? 'Nothing matches what is picked' : was;
  if (modus === 'kacheln') {
    const offenK = offen ? ks.find((k) => k.schluessel === offen) ?? null : null;
    if (offen && !offenK) offen = null;
    const baenke = gewaehlt.baenke?.map((b, i) => { const z = kachelZaehler(kachelnVon(gewaehlt, i)); return { id: i, name: `${b.name} (ch ${b.kanal})`, frei: z.frei, gesamt: z.gesamt, anzahl: `${z.frei} of ${z.gesamt} free` }; });
    const praesets = gewaehlt.modell ? document.createElement('div') : null;
    if (praesets) bauePresets(praesets, presetFehlt ? { verfuegbar: false, text: 'Presets are not available on this page server yet' }
      : { verfuegbar: true, speichern: speicherAngebot(folgenStand), zeilen: praesetAnsicht(presetListe, gewaehlt.modell, folgenStand, gewaehlt.platz) }, praesetAktionen(gewaehlt.platz));
    baueKacheln(inhalt, kachelSicht(ks, { nurFrei, sicht, filter }), { geraet: gewaehlt.name, kompakt: nurFrei, offen: offenK, praesets,
      baenke, bank: bankVon.get(gewaehlt.schluessel) ?? 0, waehleBank: (i) => { bankVon.set(gewaehlt.schluessel, i); offen = null; zeichne(true); }, bedienung: gewaehlt.bedienung,
      oeffne: (k) => { offen = offen === k.schluessel ? null : k.schluessel; zeichne(true); },
      entferne: async (k) => { offen = null; await lernHolen?.schicken('/lernen/loeschen', { pfad: k.ziel }); await holeRegister(); zeichne(true); },
      fuelle: (panel, k) => {
        // the picker lists what this tile takes (a knob the continuous targets, a button or pad the switches and actions), and its chips count exactly that
        const arten = kachelArten(k);
        const chipsP = modulZaehler(zieleAlle, stand, { sicht, nurFrei, namen, namenlose: knoepfe, arten });
        if (waehlerModul && !chipsP.some((c) => c.id === waehlerModul)) waehlerModul = null;   // the module the last tile used has nothing of this kind
        baueWaehler(panel, k, {
          arten, module: falteModule(chipsP, familien, waehlerModul), modul: waehlerModul, suche: waehlerSuche, beiSuche: (t) => { waehlerSuche = t; }, nurFrei,
          ziele: (text) => zielZeilen(zieleAlle, stand, { modul: waehlerModul, sicht: waehlerModul ? undefined : sicht, nurFrei, filter: text, namen, namenlose: knoepfe, arten }),
          mehrKnoepfe: versteckt(waehlerModul, arten), zeigeKnoepfe: () => { knoepfe = true; zeichne(true); },
          waehleModul: (id) => { if (id !== null && familie(id)) { if (waehlerModul && waehlerModul.split('/')[0] === id.slice(8)) waehlerModul = null; } else waehlerModul = id; zeichne(true); },
          schliesse: () => { offen = null; zeichne(true); },
          setze: (z) => zuweisen(z.pfad, gewaehlt.platz, k, ks),
        });
      } });
    return;
  }
  if (modus === 'modul') {
    const freie = ks ? ks.filter((k) => k.zuweisbar && !k.ziel && k.art === 'knob') : [];                // the menu of a continuous row
    const freieTasten = ks ? ks.filter((k) => k.zuweisbar && !k.ziel && k.art !== 'knob') : [];         // the menu of a switch or action row
    const mehr = filter === '' ? versteckt(modul) : 0;
    baueZiele(inhalt, zielZeilen(zieleAlle, stand, { modul, sicht, nurFrei, filter, namen, namenlose: knoepfe }), { leer: leer(nurFrei ? 'Every target of this module is assigned' : 'No targets'),
      mehr: mehr ? { text: `+ ${mehr} unnamed knobs`, titel: 'Show the graph knobs no loaded graph names', klick: () => { knoepfe = true; zeichne(true); } } : null,
      wartet: lernHolen?.stand?.()?.wartet?.pfad ?? null, freie, freieTasten, geraet: gewaehlt?.name, menue,
      lerne: async (pfad) => { menue = null; const w = lernHolen?.stand?.()?.wartet?.pfad; await lernHolen?.schicken('/lernen', { pfad: w === pfad ? null : pfad }); zeichneLernen(); zeichne(true); },
      oeffneMenue: (pfad) => { menue = menue === pfad ? null : pfad; zeichne(true); },
      zuweisen: (pfad, k) => zuweisen(pfad, gewaehlt.platz, k),
      loesche: async (pfad) => { await lernHolen?.schicken('/lernen/loeschen', { pfad }); await holeRegister(); zeichne(true); } });
    return;
  }
  const zielNamen = new Map((lernHolen?.stand?.()?.zuordnungen ?? []).filter((z) => z.name).map((z) => [z.pfad, z.name]));
  baueRegister(inhalt, registerZeilen(stand, filter, { besitzer: auswahl, sicht, namen, zielNamen }), {
    fehler: (stand.geraete ?? []).filter((g) => g.fehler),
    leer: filter || sicht ? 'Nothing matches what is picked' : gewaehlt ? `${gewaehlt.name} has no assignments yet${gewaehlt.art === 'platz' ? ': type a target above, press LEARN and move a knob' : ''}` : 'No assignments',
    loesche: async (pfad) => { await lernHolen?.schicken('/lernen/loeschen', { pfad }); await holeRegister(); zeichne(true); },
  });
}
/** Assign `pfad` to the control `k` (a tile: a knob, button or pad) of controller place `platz` without a move: POST /lernen/setzen, then reread the register. */
async function zuweisen(pfad, platz, k, ks = null) {
  // from a tile's picker (`ks` = the tiles): the picker moves on to the next free control of the same class (a knob to the next knob, a button or pad
  // to the next button or pad), so a whole row is assigned click by click (CLOSE ends it)
  const weiter = ks ? naechsteFreie(ks, k) : null;
  offen = weiter ? weiter.schluessel : null; menue = null;
  await lernHolen?.schicken('/lernen/setzen', { pfad, platz, kanal: k.kanal, nr: k.nr, ...(k.typ === 'note' ? { typ: 'note' } : {}) });
  await holeRegister();
  zeichne(true);
}
/** POST a preset route; a refusal shows the server's text in the line above the list. `fertig(answer)` words a success. Afterwards everything the call can have changed is read again. */
async function praesetSchicken(pfad, daten, fertig) {
  let r = null, j = null;
  try { r = await fetch(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) }); j = await r.json().catch(() => null); } catch { /* shown below */ }
  if (spurEl) spurEl.textContent = !r ? 'The page server did not answer' : r.status === 404 && !j?.text ? 'This page server does not know presets yet' : r.ok ? (fertig?.(j) ?? '') : String(j?.text ?? j?.fehler ?? r.status);
  await Promise.all([lernHolen?.hole?.(), holePresets(), holeFolgen(), holeRegister()]);
  zeichne(true); zeichneLernen();
}
const uebersprungenText = (l) => (Array.isArray(l) && l.length ? `, ${l.length} skipped (${l.slice(0, 4).map((x) => (typeof x === 'string' ? x : x?.regler ?? x?.pfad ?? '?')).join(', ')}${l.length > 4 ? ', ...' : ''})` : '');
const praesetAktionen = (platz) => ({
  speichereFuer: () => praesetSchicken('/controller/presets/speichern', { platz, art: 'instrument' }, (j) => `Saved ${j?.preset?.name ?? 'the preset'} for ${folgenStand?.fokus?.graph ?? 'the synth in front'}`),
  speichereAls: () => {
    const name = (globalThis.prompt?.('Name for these assignments') ?? '').trim();
    if (name) praesetSchicken('/controller/presets/speichern', { platz, art: 'fest', name }, (j) => `Saved ${j?.preset?.name ?? name}`);
  },
  lade: (id) => praesetSchicken('/controller/presets/laden', { platz, id }, (j) => `Loaded ${presetName(id, presetListe)}: ${j?.gesetzt ?? 0} assigned${uebersprungenText(j?.uebersprungen)}`),
  loesche: (id) => praesetSchicken('/controller/presets/loeschen', { id }, () => `Deleted ${presetName(id, presetListe)}`),
});
const geraeteSchicken = async (daten) => {
  try {
    const r = await fetch('/geraete/controller', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) });
    const j = await r.json();
    if (r.ok) geraeteStand = j;
    if (spurEl) spurEl.textContent = r.ok ? '' : String(j?.text ?? j?.fehler ?? r.status);
  } catch { /* the page server is gone: keep what is shown */ }
  await Promise.all([lernHolen?.hole?.(), holeFolgen()]);
  zeichne(true); zeichneLernen();
};
const tastenSchalte = async (an) => {
  try {
    const r = await fetch('/controller/fokus/tasten', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ an }) });
    const j = await r.json().catch(() => null);
    if (spurEl) spurEl.textContent = r.ok ? '' : String(j?.text ?? j?.fehler ?? r.status);
  } catch { /* the page server is gone: keep what is shown */ }
  await holeFolgen();
  zeichne(true);
};
const zeichneLernen = () => { if (lernEl && lernOpt && lernHolen) baueLernen(lernEl, lernHolen.stand(), lernOpt); };

/**
 * A control was moved on a controller (stream event `hand` with the target path): mark its tile or row and scroll it into view. A pick that hides
 * it (device, module, view, text filter, free only, an open picker) is widened. Does nothing while the tab is closed.
 */
export function registerHand(pfad) {
  if (!wurzelEl || wurzelEl.hidden || !stand || typeof pfad !== 'string') return;
  const finde = () => [...inhalt.querySelectorAll('[data-ziel]')].filter((e) => e.getAttribute('data-ziel') === pfad && !e.classList.contains('reg-frei'));
  // a device with banks: the window follows the hardware to the bank the moved control is in
  const zu = (lernHolen?.stand?.()?.zuordnungen ?? []).find((z) => z.pfad === pfad);
  const g = zu ? geraeteListe().find((z) => z.platz === (zu.platz ?? 1)) : null;
  const b = g?.baenke ? g.baenke.findIndex((x) => x.kanal === zu.kanal) : -1;
  if (b >= 0 && (bankVon.get(g.schluessel) ?? 0) !== b) { bankVon.set(g.schluessel, b); offen = null; zeichne(true); }
  let treffer = finde();
  const eigner = registerZeilen(stand, '').find((z) => z.ziel === pfad);
  if (treffer.length === 0 && (auswahl || filter || modul || sicht || nurFrei) && eigner) {   // hidden by a pick: show where it was moved
    auswahl = auswahl ? eigner.besitzer : null; filter = ''; modul = modul ? eigner.modulId : null; sicht = null; nurFrei = false; offen = null; menue = null;
    const feld = wurzelEl.querySelector('.reg-filter');
    if (feld) feld.value = '';
    zeichne(true);
    treffer = finde();
  }
  if (treffer.length === 0) return;
  if (spurEl) spurEl.textContent = `Moved: ${treffer[0].getAttribute('data-info') ?? pfad}`;
  for (const t of treffer) {
    t.classList.add('reg-treffer');
    clearTimeout(t._weg);
    t._weg = setTimeout(() => t.classList.remove('reg-treffer'), 1500);
  }
  treffer[0].scrollIntoView({ block: 'nearest' });
}

/**
 * Opens the tab: builds the two columns once, reads the register, the devices and the learn table and draws them.
 * `lern` = { stand: () => learn table, schicken: (pfad, daten) => Promise, hole: () => Promise } from learn_view.js (injected, so this module
 * stays free of the page's other modules and runs in the page test).
 */
export async function zeigeRegister(wurzel, lern, mehr = {}) {
  extra = mehr ?? {};   // { kanalName(kanal): the short name of an instrument channel, for the follow line }
  if (!inhalt) {
    wurzelEl = wurzel;
    lernHolen = lern ?? null;
    const links = document.createElement('div');
    links.classList.add('reg-links');
    geraeteEl = document.createElement('div');
    links.append(geraeteEl);
    const rechts = document.createElement('div');
    rechts.classList.add('reg-rechts');
    const leiste = document.createElement('div');
    leiste.classList.add('reg-leiste');
    const eingabe = document.createElement('input');
    eingabe.setAttribute('type', 'search');
    eingabe.setAttribute('placeholder', 'Find: control, target or device');
    eingabe.classList.add('reg-filter');
    eingabe.addEventListener('input', () => { filter = eingabe.value; zeichne(true); });
    frei = zelle('button', 'FREE ONLY', 'reg-learn');
    frei.setAttribute('type', 'button');
    frei.setAttribute('title', 'Hide what is assigned: the free controls of the device, or the free targets of the module');
    frei.addEventListener('click', () => { nurFrei = !nurFrei; zeichne(true); });
    lernEl = document.createElement('div');
    lernEl.classList.add('reg-lernzeile');
    lernOpt = { wert: '', ziele, schicken: async (p, d) => { await lern?.schicken(p, d); zeichneLernen(); } };
    leiste.append(eingabe, frei, lernEl);
    spurEl = zelle('div', 'Move a control on a controller to find it in the list', 'reg-spur');
    inhalt = document.createElement('div');
    inhalt.classList.add('reg-inhalt');
    wahlEl = document.createElement('div');
    wahlEl.classList.add('reg-wahlen');
    rechts.append(leiste, wahlEl, spurEl, inhalt);
    wurzel.append(links, rechts);
    let gelernt = '', wartet = null;
    setInterval(() => {   // follows the learn events while the tab is open; a new, changed or removed assignment rereads the register
      if (wurzel.hidden) return;
      Promise.resolve(lern?.hole?.()).then(async () => {
        zeichneLernen();
        const l = lern?.stand?.();
        const sig = JSON.stringify((l?.zuordnungen ?? []).map((z) => [z.pfad, z.platz, z.typ ?? 'cc', z.kanal, z.nr]));
        const w = l?.wartet?.pfad ?? null;
        if (sig !== gelernt) { gelernt = sig; wartet = w; await holeRegister(); zeichne(); }
        else if (w !== wartet) { wartet = w; zeichne(); }   // a LEARN button changes between "LEARN" and "move a knob…"
      });
    }, 1500);
    setInterval(() => { if (!wurzel.hidden) holeGeraete().then(() => zeichne()); }, 3000);   // plugging a device in or out shows up without a reload
  }
  await lern?.hole?.();
  zeichneLernen();
  await Promise.all([holeRegister(), holeGeraete(), holePresets()]);
  zeichne(true);
}
