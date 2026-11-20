// SEQ place v2 (spec docs/superpowers/specs/2026-11-14-seq-deck-design.md, sections 5 and 6): the pure part of the page. No DOM here, so it runs in node tests.
// A SEQ deck is a top group of the live container; a pattern is an instrument track that plays into the group, with one MIDI clip; the lanes are a view
// on that clip (seq_logic.js). The page reads the deck from the live project it already holds. A gesture is turned into project commands by seq_logic.js
// and sent to POST /seq/befehle; a cell changes only after the server said yes, and the project drawn next is the one of the answer.
// `holeJson(weg, daten)` is the page's POST helper ({ status, j }), `holeGet(weg)` the same for GET.
import { folgeEditierbar, folgeSicht, zielName, reglerSchluessel, reglerZiel, zielErlaubt, anzeigeBereich, SeqFehler, wertBefehle, kurveBefehle, formPunkte, zeileAendernBefehle } from './seq_logic.js';
import { tonName } from './production/pianoroll.js';

export const AKZENT_VEL = 110;    // a note above this velocity is drawn as an accent
export const ANLEGEN_HINWEIS = 'open the live container';
export const LAENGEN_TAKTE = [1, 2, 4, 8, 16];     // the length picker of a pattern, in bars
export const SICHT_BREITEN = [1, 2, 4, 'all'];     // the width selector of the deck head, in bars
export const ZIEHEN_AB = 4;                        // pixels: a press that moves less is a click
export const PX_STANDARD = 96, PX_MIN_ALLE = 48, PX_MIN = 24, PX_MAX = 256;   // pixels per beat
const KLIPP_BEATS = 64;                            // the live region a pattern clip covers
const INFO_WARTEN = 10000;                         // ms: a failed instrument info is asked again after this
const PIXEL_JE_VEL = 0.8;                          // a drag of one pixel is 0.8 velocity steps: 100 pixels cover the whole range
const EPS = 1e-9;
const klemme = (x, min, max) => Math.max(min, Math.min(max, x));
const runde = (x) => Math.round(x * 1e6) / 1e6;

// ---------- the deck as the page draws it ----------
// D8 (spec 3): which tracks are edited in the grid is decided in seq_logic.js (shared with the server).
export { folgeEditierbar };

// The head text of the instrument of a pattern.
export function geraetText(spur) {
  const g = spur?.geraet;
  if (g?.art === 'intern') return g.name === 'bk' ? `Baukasten · ${g.graph}` : g.name === 'kit' ? `Kit · ${g.kit}` : 'RB-338';
  if (g?.art === 'wirt') return g.plugin?.name ?? 'Surge';
  if (g?.art === 'rack') return 'Rack';
  return '–';
}
const istBk = (spur) => spur?.geraet?.art === 'intern' && spur.geraet.name === 'bk';

// The deck of place `platz` without lanes (cheap: the place head and the place switch ask it): the patterns are the tracks of the group, in track order
// (project/seq.ts seqGruppe and seqFolgen, rebuilt here from the live project).
export function seqAnsicht(projekt, platz) {
  const g = (projekt?.gruppen ?? []).find((x) => x?.seq?.platz === platz);
  if (!g) return { vorhanden: false, gruppe_id: null, folgen: [] };
  const folgen = (projekt.spuren ?? []).filter((s) => s?.ausgang?.id === g.id).map((spur) => {
    const clip = (spur.clips ?? []).length === 1 && spur.clips[0].art === 'midi' ? spur.clips[0] : null;
    return { spur_id: spur.id, clip_id: clip?.id ?? null, name: spur.name, geraet_text: geraetText(spur), stumm: spur.mute === true, editierbar: folgeEditierbar(spur), spur, clip };
  });
  return { vorhanden: true, gruppe_id: g.id, folgen };
}

// The deck with the lanes of every editable pattern. `infos` is { [spur_id]: info } (infosAusCache): the knob names and kit sounds of the instrument.
// laenge_beats is the longest pattern, at least one bar: the width the place shows. baukasten counts the Baukasten patterns (spec 5, capacity).
export function deckAnsicht(projekt, platz, infos = {}) {
  const a = seqAnsicht(projekt, platz);
  const folgen = a.folgen.map((f) => ({ ...f, sicht: f.editierbar ? folgeSicht(f.spur, f.clip, infos?.[f.spur_id]) : null }));
  return { ...a, folgen, baukasten: folgen.filter((f) => istBk(f.spur)).length, laenge_beats: Math.max(4, ...folgen.map((f) => f.sicht?.laenge_beats ?? 0)) };
}

// What the empty state offers: CREATE needs the open live container (the page never opens it by itself).
export function anlegenZustand(projekt) {
  const aus = projekt?.live !== true;
  return { aus, hinweis: aus ? ANLEGEN_HINWEIS : '' };
}

// ---------- the playhead ----------
// The position in beats inside a lane of `zeile.laenge_beats`; -1 when the beat is unknown (no playhead is drawn then).
export function kopfPos(beat, zeile) {
  const L = zeile?.laenge_beats;
  if (!Number.isFinite(beat) || !(L > 0)) return -1;
  const m = beat % L;
  return m < 0 ? m + L : m + 0;   // % keeps the sign; + 0 turns -0 into 0
}
// The cell under the playhead of a lane with cells (a value lane of its own length wraps at that length); -1 for a curve and without a beat.
export function kopfZelle(beat, zeile) {
  if (!zeile?.zellen) return -1;
  const p = kopfPos(beat, zeile);
  return p < 0 ? -1 : Math.min(zeile.zellen.length - 1, Math.floor(p / zeile.teiler + 1e-9));
}

// ---------- cells ----------
export function zeileTitel(z) {
  if (z.art === 'noten') return z.ton === undefined ? 'pitch' : z.name;
  return `${z.art === 'werte' ? 'values' : 'curve'} · ${z.name}`;
}
// Classes of one cell: a note lane marks on, accent, tie, offset and count; a value lane cell is `wert`, `an` when it holds a value, `gesperrt` and `nurlesen`
// when it is not free (a velocity or length cell without a note: it takes no pointer) and `geklemmt` where the knob position plus the offset leaves 0..1.
export function zellKlassen(zelle, zeile) {
  const k = ['sq-zelle'];
  if (zeile.art === 'noten') {
    if (zeile.ton === undefined) k.push('ton');
    if (zelle.an) {
      k.push('an');
      if (zelle.vel > AKZENT_VEL) k.push('akzent');
      if (zelle.versatz) k.push('versatz');
      if (zelle.zahl > 1) k.push('mehrere');
    } else if (zelle.gebunden) k.push('gebunden');
    return k;
  }
  k.push('wert');
  if (zelle.da) k.push('an');
  if (zelle.frei === false) k.push('gesperrt', 'nurlesen');
  if (zelle.geklemmt) k.push('geklemmt');
  return k;
}
// `wartet` is the note a wheel gesture has collected but not sent yet: it is shown instead of the stored one, and only in a cell that is on.
export function zellText(zelle, zeile, wartet) {
  if (zeile.art !== 'noten' || !zelle.an) return '';
  if (zeile.ton === undefined) return `${tonName(wartet ?? zelle.ton)}${zelle.zahl > 1 ? `+${zelle.zahl - 1}` : ''}`;
  return zelle.zahl > 1 ? `×${zelle.zahl}` : '';
}
export function zellTitel(zeile, i, zelle) {
  const ort = `${zeile.name ?? zeile.ziel ?? 'lane'}, cell ${i + 1}`;
  if (zeile.art === 'noten') return zelle.an ? `${ort}, velocity ${zelle.vel}${zeile.ton === undefined ? `, ${tonName(zelle.ton)}` : ''}${zelle.versatz ? `, offset ${zelle.versatz} beat` : ''}` : ort;
  if (zelle.wert === null) return zelle.frei === false ? `${ort}, no note here` : ort;
  return `${ort}, ${wertText(zeile, zelle.wert)}${zelle.geklemmt ? ' (clamped: knob position plus offset leaves 0..1)' : ''}${zelle.da ? '' : ' (held)'}`;
}

// ---------- gestures ----------
// Which gesture a drag is, `ton` says whether the lane is the pitched one: below the threshold none (a click), horizontal in the pitched lane the length, else the velocity.
export function griffArt(dx, dy, ton) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < ZIEHEN_AB) return null;
  return ton && Math.abs(dx) > Math.abs(dy) ? 'laenge' : 'vel';
}
// Velocity after a vertical drag: `dy` pixels since the press, up (negative) is louder.
export const velNeu = (vel, dy) => klemme(Math.round(vel - dy * PIXEL_JE_VEL), 1, 127);
// Length in cells after a horizontal drag of `dx` pixels over cells of `zellBreite` pixels: at least one cell, at most `max` (the cells left in the pattern).
export const laengeNeu = (zellen, dx, zellBreite, max) => klemme(Math.round(zellen + dx / zellBreite), 1, Math.max(1, max));
// Note after one tick of the wheel: `richtung` is the sign of deltaY (up is negative and raises), shift moves by octaves.
export const tonNeu = (ton, richtung, oktave) => klemme(ton - Math.sign(richtung) * (oktave ? 12 : 1), 0, 127);
// A pointer that is let go: the fields of the cell request, or null for none. `g` is the grip { art, vel, laenge } from the press, `innerhalb` says whether the
// pointer is over the cell it pressed. A drag goes out as it is; a click toggles ({}) only when it ends on its own cell.
export function loslassFelder(g, innerhalb) {
  if (!g) return null;
  if (g.art === 'vel') return { vel: g.vel };
  if (g.art === 'laenge') return { laenge: g.laenge };
  return innerhalb ? {} : null;
}
export const imRechteck = (x, y, r) => !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
// The wheel: the fields for a collected note `ton` on `zelle` (as the project holds it now), or null when there is nothing to write: a cell that is off
// (it was switched off meanwhile) or a note that is the stored one. A write without a defined change would still cost an undo step.
export function radFelder(zelle, ton) {
  if (!zelle || zelle.an !== true || !Number.isInteger(ton) || ton === zelle.ton) return null;
  return { ton };
}
// A note as a number 0..127 or a name of the piano roll (60 = C3, `C#1`, `Bb1`); null when it is neither.
const NOTEN_BASIS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export function tonVonText(text) {
  const t = String(text ?? '').trim();
  if (/^\d{1,3}$/.test(t)) return Number(t) <= 127 ? Number(t) : null;
  const m = /^([a-gA-G])([#b]?)(-?\d)$/.exec(t);
  if (!m) return null;
  const ton = (Number(m[3]) + 2) * 12 + NOTEN_BASIS[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return ton >= 0 && ton <= 127 ? ton : null;
}

// ---------- lengths, widths ----------
// Text of a pattern length: whole bars, else steps of 1/16, else beats.
export function laengeText(beats, proTakt = 4) {
  if (beats % proTakt === 0) return `${beats / proTakt} bar${beats === proTakt ? '' : 's'}`;
  const s = beats * 4;
  return Number.isInteger(s) ? `${s} step${s === 1 ? '' : 's'}` : `${beats} beats`;
}
// A free step count (steps of 1/16, 1..256) as beats; null when it is not a whole number in range.
// `maxBeats` is the length of the stored clip (a pattern is at most as long as its clip); by default the live region of the meter.
export function laengeAusSchritten(text, proTakt = 4, maxBeats = Math.max(KLIPP_BEATS, 16 * proTakt)) {
  const t = String(text ?? '').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= maxBeats * 4 ? n / 4 : null;
}
// The bar counts of the length menu that fit into the stored clip: a clip of 64 beats refuses 16 bars of 12 (192 beats).
export function laengenWahl(clipBeats, proTakt = 4) {
  return LAENGEN_TAKTE.filter((t) => t * proTakt <= clipBeats + 1e-9);
}
// Pixels per beat of the shared time axis. `wahl` is the selector of the deck head: 'all' fits the longest pattern into the room (between 48 and 256 px per
// beat, so that the longest bar run fills the width; wider patterns scroll), 1, 2 or 4 bars fill the room. `verfuegbar` is the width of the cell area in
// pixels (not measured: the default).
export function pxProBeat(wahl, laengster, verfuegbar, proTakt = 4) {
  if (!(verfuegbar > 0)) return PX_STANDARD;
  if (wahl === 'all') return Math.floor(klemme(verfuegbar / Math.max(proTakt, laengster), PX_MIN_ALLE, PX_MAX));
  return klemme(Math.floor(verfuegbar / (wahl * proTakt)), PX_MIN, PX_MAX);
}
// The width of the time axis in beats: the longest pattern of the deck, and with the choice of 1, 2 or 4 bars at least that many bars. Lanes that end before it
// are drawn again pale (note lanes, value lanes, curve lanes, the ruler).
export const sichtbarBeats = (wahl, laengster, proTakt = 4) => (wahl === 'all' ? laengster : Math.max(laengster, wahl * proTakt));
// The beats of the ruler over `sichtbar` beats: { beat, breite (a beat is 1; the one the pattern end cuts is narrower), takt (a bar number), wiederholung (after the
// pattern end `laenge`) }.
export function linealZellen(laenge, sichtbar, proTakt = 4) {
  const gesamt = Math.max(laenge, sichtbar), aus = [];
  for (let beat = 0; beat < gesamt - EPS; beat++) aus.push({ beat, breite: Math.min(1, gesamt - beat), takt: beat % proTakt === 0, wiederholung: beat >= laenge - EPS });
  return aus;
}

// ---------- the large view ----------
// One place at a time can take the whole page under the header. The choice is kept per place in the browser (like the place layout, slots.js: in try/catch):
// { "<place>": true }. A choice only counts while its place is typed SEQ and shows.
export const GROSS_SCHLUESSEL = 'djk-seq-gross';
export function grossLesen(storage) {
  try {
    const x = JSON.parse(storage?.getItem(GROSS_SCHLUESSEL) ?? 'null');
    if (!x || typeof x !== 'object' || Array.isArray(x)) return {};
    return Object.fromEntries(Object.entries(x).filter(([, an]) => an === true));
  } catch { return {}; }
}
export function grossSchreiben(storage, wahl) {
  try { storage.setItem(GROSS_SCHLUESSEL, JSON.stringify(wahl)); return true; } catch { return false; }
}
// The button of place `platz`: it turns the large view on, a second press off; another place that was large gives it up.
export const grossUmschalten = (wahl, platz) => (wahl?.[platz] === true ? {} : { [platz]: true });
// Which place is large for the layout and the places that show: { platz (or null), wahl (the choice without what no longer counts) }. A place that is not typed SEQ
// or is hidden is never large and loses its entry; of several valid entries the lowest place stays.
export function grossGilt(wahl, layout, sichtbar) {
  const gilt = [1, 2, 3, 4].filter((n) => wahl?.[n] === true && layout?.[n - 1] === 'seq' && sichtbar(n));
  const platz = gilt[0] ?? null;
  return { platz, wahl: platz === null ? {} : { [platz]: true } };
}
// Escape closes the large view: not when a menu is open (it takes the key) and not while an input field has the focus (it blurs).
export const grossEscape = ({ gross, menue, eingabe }) => gross === true && !menue && !eingabe;

// ---------- curve geometry ----------
// A value as a y coordinate in a curve lane of `hoehe` pixels (3 pixels of margin above and below), and back.
export const kurveY = (wert, hoehe, bereich) => runde(hoehe - 3 - klemme((wert - bereich.min) / (bereich.max - bereich.min), 0, 1) * (hoehe - 6));

// The path of a curve lane for the SVG: `punkte` are the shown points ({ beat, wert, form }), `laenge` the lane length, `gesamt` the pattern length the lane
// is drawn over. The curve repeats at its length: `erste` is the first pass, `spaeter` the repeats (drawn pale). A `sprung` point holds the old value until its
// beat, `s` is the smoothstep the model reads, the last value holds to the end of the pass.
export function kurvePfad(punkte, laenge, gesamt, px, hoehe, bereich) {
  if (!punkte?.length || !(laenge > 0)) return { erste: '', spaeter: '' };
  const y = (w) => kurveY(w, hoehe, bereich);
  const x = (b) => runde(b * px);
  const pfade = [];
  for (let v = 0; v < gesamt - EPS; v += laenge) {
    const ende = Math.min(gesamt, v + laenge);
    let s = `M${x(v)} ${y(punkte[0].wert)}`, vor = punkte[0];
    punkte.forEach((p, i) => {
      if (v + p.beat > ende + EPS) return;
      if (i === 0) s += ` L${x(v + p.beat)} ${y(p.wert)}`;
      else if (p.form === 'sprung') s += ` L${x(v + p.beat)} ${y(vor.wert)} L${x(v + p.beat)} ${y(p.wert)}`;
      else if (p.form === 's') for (let k = 1; k <= 8; k++) { const u = k / 8; s += ` L${x(v + vor.beat + (p.beat - vor.beat) * u)} ${y(vor.wert + (p.wert - vor.wert) * u * u * (3 - 2 * u))}`; }
      else s += ` L${x(v + p.beat)} ${y(p.wert)}`;
      vor = p;
    });
    pfade.push(`${s} L${x(ende)} ${y(vor.wert)}`);
  }
  return { erste: pfade[0] ?? '', spaeter: pfade.slice(1).join(' ') };
}

// ---------- instrument info ----------
// info = { art, regler: [{ nr, name, vorgabe }], klaenge: [{ ton, name }] } of one instrument (GET /seq/geraet?spur_id=). Kept per device (graph or kit), not
// per track; a failed answer is kept as a bare info for INFO_WARTEN ms so that the page does not ask on every redraw.
const infoCache = new Map();    // device key -> { info, bis }
const infoLaeuft = new Map();   // device key -> pending Promise
export const leereInfoCache = () => { infoCache.clear(); infoLaeuft.clear(); };
const geraetSchluessel = (spur) => {
  const g = spur?.geraet;
  if (g?.art === 'intern') return g.name === 'bk' ? `bk:${g.graph}` : g.name === 'kit' ? `kit:${g.kit}` : 'rb338';
  return `anderes:${spur?.id}`;
};
const artVon = (spur) => { const g = spur?.geraet; return g?.art === 'intern' && ['bk', 'kit', 'rb338'].includes(g.name) ? g.name : 'anderes'; };
const instrumentSpuren = (projekt, platz) => seqAnsicht(projekt, platz).folgen.filter((f) => f.spur.art === 'instrument').map((f) => f.spur);
// The empty entries (a failed request keeps one for INFO_WARTEN) of the devices of the place are forgotten: the next draw asks again.
export function vergissLeereInfos(projekt, platz) {
  for (const s of instrumentSpuren(projekt, platz)) {
    const k = geraetSchluessel(s), e = infoCache.get(k);
    if (e && e.bis !== Infinity && !e.info.regler.length) infoCache.delete(k);
  }
}
// The infos that are known now, by track id (no request).
export function infosAusCache(projekt, platz, jetzt = Date.now()) {
  const aus = {};
  for (const s of instrumentSpuren(projekt, platz)) { const e = infoCache.get(geraetSchluessel(s)); if (e && e.bis > jetzt) aus[s.id] = e.info; }
  return aus;
}
// The tracks whose instrument info is not known (and not loading).
export const fehlendeInfos = (projekt, platz, jetzt = Date.now()) => instrumentSpuren(projekt, platz).filter((s) => {
  const k = geraetSchluessel(s), e = infoCache.get(k);
  return !(e && e.bis > jetzt) && !infoLaeuft.has(k);
});
// Asks the server for every missing instrument info (one request per device) and answers the infos by track id.
export async function ladeInfos(projekt, platz, holeGet, jetzt = Date.now()) {
  const holen = new Map();
  for (const s of instrumentSpuren(projekt, platz)) { const k = geraetSchluessel(s), e = infoCache.get(k); if (!(e && e.bis > jetzt) && !holen.has(k)) holen.set(k, s); }
  await Promise.all([...holen].map(([k, s]) => {
    if (infoLaeuft.has(k)) return infoLaeuft.get(k);
    const p = (async () => {
      const r = await holeGet(`/seq/geraet?spur_id=${encodeURIComponent(s.id)}`);
      const ok = r.status === 200 && Array.isArray(r.j?.regler);
      infoCache.set(k, { info: ok ? { art: r.j.art, regler: r.j.regler, klaenge: Array.isArray(r.j.klaenge) ? r.j.klaenge : [] } : { art: artVon(s), regler: [], klaenge: [] }, bis: ok ? Infinity : jetzt + INFO_WARTEN });
    })().finally(() => infoLaeuft.delete(k));
    infoLaeuft.set(k, p);
    return p;
  }));
  return infosAusCache(projekt, platz, jetzt);
}

// The entries of the instrument picker: the Baukasten instruments (`graphen` of GET /graphen), the kits (`kits` of GET /proj/kits) and the RB-338. `geraet` is
// what seq_folge_neu and spur_aendern take. A graph that reports latency (`latenz` samples, GET /graphen) does not fit a live-played pattern and is left out,
// except the graph the pattern already plays (`behalte`, its name): that one stays in its own exchange menu. A missing `latenz` counts as 0.
export function geraetWahl(graphen, kits, behalte) {
  const nach = (a, b) => a.text.localeCompare(b.text);
  const bk = (graphen ?? []).filter((g) => g && g.art === 'instrument' && typeof g.name === 'string' && (!(g.latenz > 0) || g.name === behalte))
    .map((g) => ({ gruppe: 'Baukasten', text: g.name, name: g.name, geraet: { art: 'intern', name: 'bk', graph: g.name } })).sort(nach);
  const kit = (kits ?? []).filter((k) => k && typeof k.name === 'string')
    .map((k) => ({ gruppe: 'Kit', text: `${k.name} (${k.klaenge})`, name: k.name, geraet: { art: 'intern', name: 'kit', kit: k.name } })).sort(nach);
  return [...bk, ...kit, { gruppe: 'RB-338', text: 'RB-338', name: 'RB-338', geraet: { art: 'intern', name: 'rb338', parameter: {} } }];
}

// A new pattern is named after its instrument; the deck refuses a name it holds already (ignoring case), so a second pattern of the same instrument is
// "name 2", then "name 3". `namen` are the names of the patterns of the deck.
export function freierName(basis, namen) {
  const belegt = new Set((namen ?? []).map((n) => String(n).toLowerCase()));
  if (!belegt.has(basis.toLowerCase())) return basis;
  for (let i = 2; ; i++) if (!belegt.has(`${basis} ${i}`.toLowerCase())) return `${basis} ${i}`;
}

// ---------- instrument exchange (spec 5, review focus 4) ----------
export const AUTOMATION_MELDUNG = 'This track has an automation lane on a device knob. Remove it in PRODUCTION first.';
const geraetArtNeu = (g) => (g?.name === 'bk' ? 'bk' : g?.name === 'kit' ? 'kit' : 'rb338');
const geraetNeuName = (g) => (g.name === 'bk' ? g.graph : g.name === 'kit' ? g.kit : 'RB-338');
const gleich = (alt, neu) => !!alt && alt.art === 'intern' && alt.name === neu.name && (neu.name === 'bk' ? alt.graph === neu.graph : neu.name === 'kit' ? alt.kit === neu.kit : true);
// The commands that switch the pattern's track to `geraetNeu`: { befehle, frage, meldung }. The model refuses an exchange while the clip holds geraet.* envelopes
// the new device does not have (geraet_huellkurven): then the list is their deletions and spur_aendern (one undo step) and `frage` says what goes. The same
// holds for automation lanes of the track, which no allowed command removes: `meldung`, nothing to send. A Baukasten graph to another keeps its knob lanes.
export function wechselBefehle(spur, clip, geraetNeu, info) {
  if (gleich(spur.geraet, geraetNeu)) return { befehle: [], frage: null, meldung: null };
  const art = geraetArtNeu(geraetNeu);
  const passt = (ziel) => { const nr = reglerSchluessel(ziel); return nr === null || (typeof nr === 'number' ? art === 'bk' : art === 'rb338'); };
  if ((spur.automation ?? []).some((l) => !passt(l.ziel))) return { befehle: [], frage: null, meldung: AUTOMATION_MELDUNG };
  const weg = (clip?.huellkurven ?? []).filter((h) => !passt(h.ziel));
  const befehle = [...weg.map((h) => ({ befehl: 'huellkurve_loeschen', clip_id: clip.id, ziel: h.ziel })), { befehl: 'spur_aendern', spur_id: spur.id, geraet: geraetNeu }];
  const frage = weg.length ? `Switching to ${geraetNeuName(geraetNeu)} removes the knob lanes of this pattern: ${weg.map((h) => zielName(h.ziel, info)).join(', ')}. Continue?` : null;
  return { befehle, frage, meldung: null };
}

// ---------- requests ----------
export const FRIST_MS = 8000;   // a SEQ request that is not answered by then is given up: the write chain and live.seqLaeuft must not wait for ever
// fetch with a time limit, answering { status, j } like holeJson and holeGet of the page: a refusal to answer is status 0, fehler `netz` (the page then reads the
// project again, the server may have written). `holen` is fetch (a test passes its own), `opt` its options.
export async function holeMitFrist(holen, weg, opt = {}, ms = FRIST_MS) {
  const ac = new AbortController(), uhr = setTimeout(() => ac.abort(), ms);
  try {
    const r = await holen(weg, { ...opt, signal: ac.signal });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  } catch (e) {
    return { status: 0, j: { fehler: 'netz', text: ac.signal.aborted ? `page server did not answer in ${ms / 1000} s` : `page server unreachable: ${e.message}` } };
  } finally { clearTimeout(uhr); }
}
const grundVon = (j) => (j?.detail && j?.text && !String(j.text).includes(j.detail) ? `${j.text} (${j.detail})` : j?.text ?? j?.fehler ?? 'unknown');   // detail: the limit a refused command names
// The server lost the deck or the container closed, or the revision moved on: the page must not trust its project any more.
const NEU_LESEN = new Set(['seq_fehlt', 'kein_liveprojekt', 'rev_veraltet', 'netz']);   // `netz`: no answer, so the server may or may not have written
// mirror of WIEDERGABE_TEXT of production/production.js (kernHinweis): a write the model accepted but the core did not load
const WIEDERGABE_TEXT = { datei_fehlt: 'a frozen track file is missing', zu_gross: 'too many clips or notes for the core',
  arbeitsordner_fehlt: 'the work folder of this instance is missing', nr_ungueltig: 'the arrangement number is invalid' };
function kernHinweis(kern) {
  const f = kern?.wiedergabe?.fehler;
  return f ? `Saved, but the core did not load the arrangement: ${WIEDERGABE_TEXT[f] ?? f}` : null;
}

// One write to the server. Result: { ok, projekt, neuLesen, text, warnung? }. `projekt` is what the page draws next: the project of the answer (every
// POST /seq/* answers like /proj/aendern, with the project), the old object on a refusal. `neuLesen` asks the page to read the project from the server again
// (the answer carries none, or the server's state is unknown). `text` of an ok answer is the PRODUCTION message for a write the core did not load (warnung).
async function schreibe(weg, daten, projekt, holeJson, text) {
  if (projekt?.live !== true) return { ok: false, projekt, neuLesen: false, text: 'Open the live container first (LIVE)' };
  const r = await holeJson(weg, daten);
  if (r.status !== 200) return { ok: false, projekt, neuLesen: NEU_LESEN.has(r.j?.fehler), text: `${text} refused: ${grundVon(r.j)}` };
  const neu = r.j?.projekt && typeof r.j.projekt === 'object' && r.j.projekt.live === true ? r.j.projekt : null;
  const warn = kernHinweis(r.j?.kern);
  return { ok: true, projekt: neu ?? projekt, neuLesen: neu === null, text: warn ?? '', ...(warn ? { warnung: true } : {}), ...(r.j?.bericht ? { bericht: r.j.bericht } : {}) };
}
// A gesture: one command list, one undo step. An empty list (the cell already says that) sends nothing.
export function sende(platz, label, befehle, projekt, holeJson) {
  if (!befehle.length) return Promise.resolve({ ok: true, projekt, neuLesen: false, text: '', leer: true });
  return schreibe('/seq/befehle', { platz, label, befehle }, projekt, holeJson, label);
}
export const legeAn = (platz, projekt, holeJson) => schreibe('/seq/anlegen', { platz }, projekt, holeJson, 'Create');
// A Workbench module into the place: one undo step; `bericht` of the answer says what was loaded and left out (module_after_seq.js berichtText)
export const ladeModul = (platz, slug, projekt, holeJson) => schreibe('/seq/modul', { platz, slug }, projekt, holeJson, 'Load module');
export const leereDeck = (platz, projekt, holeJson) => schreibe('/seq/leeren', { platz }, projekt, holeJson, 'Clear');
export const neueFolge = (platz, name, geraet, loopBeats, projekt, holeJson) =>
  schreibe('/seq/folge', { platz, name, geraet, ...(loopBeats !== undefined ? { loop_beats: loopBeats } : {}) }, projekt, holeJson, 'Pattern');

// ====================================================================================================================================================
// Task 5: value lanes, curve lanes, lane head (target, own length), the jump to PRODUCTION. Pure, no DOM.
// ====================================================================================================================================================

// ---------- the range a value lane draws ----------
const LAENGE_ANZEIGE = 4;   // cells: a `laenge` bar is full at four cells of its grid (seq_logic.js gives the lane the range -1..1 of an unknown target)
export const zeilenBereich = (z) => (z.ziel === 'laenge' ? { min: 0, max: LAENGE_ANZEIGE } : z.bereich ?? anzeigeBereich(z.ziel));
// The step a dragged value snaps to, by target: whole velocity and semitones, a quarter cell of length, a tenth dB, hundredths for knobs and pan.
const SCHRITTE = { vel: 1, laenge: 0.25, transpose: 1, spur_fader: 0.1, spur_pan: 0.01 };
const schrittFuer = (ziel) => SCHRITTE[ziel] ?? 0.01;
function wertAus(z, bruch, b = zeilenBereich(z)) {
  const schritt = schrittFuer(z.ziel);
  const roh = b.min + klemme(bruch, 0, 1) * (b.max - b.min);
  const unten = z.ziel === 'laenge' ? schritt : b.min;   // a length is above 0
  return klemme(runde(Math.round(roh / schritt) * schritt), unten, b.max);
}
// The value of a value cell for a pointer at `y` over a cell that spans `oben` and `hoehe` pixels: the bar grows from the bottom.
export const wertAusPos = (z, y, oben, hoehe) => wertAus(z, 1 - (y - oben) / (hoehe || 1));
// The bar fraction 0..1 of a shown value.
export function wertBruch(z, wert) {
  const b = zeilenBereich(z);
  return klemme((wert - b.min) / (b.max - b.min), 0, 1);
}
export const wertText = (z, wert) => (z.ziel === 'laenge' ? `${runde(wert)} cell${runde(wert) === 1 ? '' : 's'}` : String(runde(wert)));

// ---------- the pending length of a lane that has no envelope yet ----------
// An envelope carries its length (huellkurve_setzen verknuepft / loop_beats). A lane that has no envelope yet has nowhere to keep one, so the page holds it
// until the first point is written: `wartend` is a Map "spur_id/lane id" -> beats. The lanes shown carry it as their length (cells and curve over that
// length); the commands of the first write carry it to the model (mitLaenge). An entry whose lane has an envelope now, or is gone, is dropped.
export function ueberlagere(a, wartend) {
  if (!wartend?.size) return a;
  const benutzt = new Set();
  const folgen = a.folgen.map((f) => {
    if (!f.sicht) return f;
    let geaendert = false;
    const zeilen = f.sicht.zeilen.map((z) => {
      const schl = `${f.spur_id}/${z.id}`, L = wartend.get(schl);
      if (L === undefined || z.hat_huellkurve !== false) return z;
      benutzt.add(schl); geaendert = true;
      const o = { ...z, laenge_beats: L, eigen_laenge: true };
      if (z.art === 'werte') o.zellen = Array.from({ length: Math.max(1, Math.ceil(L / z.teiler - EPS)) }, () => ({ da: false, wert: null, frei: true, geklemmt: false }));
      return o;
    });
    return geaendert ? { ...f, sicht: { ...f.sicht, zeilen } } : f;
  });
  for (const k of [...wartend.keys()]) if (!benutzt.has(k)) wartend.delete(k);
  return { ...a, folgen };
}
// The command list of a first write on a lane with a pending length: the huellkurve_setzen of the lane's target also sets the length.
export function mitLaenge(z, befehle) {
  if (z.hat_huellkurve !== false || !z.eigen_laenge) return befehle;
  return befehle.map((b) => (b.befehl === 'huellkurve_setzen' && b.ziel === z.ziel ? { ...b, verknuepft: false, loop_beats: z.laenge_beats } : b));
}

// ---------- knob lanes need the instrument info ----------
// A knob lane stores the shown value minus the knob position (the base): without the knob list of the instrument the page would work on a guessed base and
// write wrong offsets. So a write on a knob lane waits for the info (a missing entry, or the empty one of a failed request, counts as not there).
export const REGLER_INFO_TEXT = 'The knobs of this instrument are still loading; try again.';
export const reglerInfoMeldung = (ziel, info) => (reglerSchluessel(ziel) !== null && !(info?.regler?.length > 0) ? REGLER_INFO_TEXT : null);
export function pruefeReglerInfo(ziel, info) {
  const m = reglerInfoMeldung(ziel, info);
  if (m) throw new SeqFehler('info_laedt', m);
}

// ---------- value lane: gestures to commands ----------
// A value for a cell (null removes it).
export const wertSchreibe = (spur, clip, z, i, wert, info) => { pruefeReglerInfo(z.ziel, info); return mitLaenge(z, wertBefehle(spur, clip, z, i, wert, info)); };
// Cells of the pale repeats of a value lane that is shorter than its pattern: the lane drawn again from its length on, as many whole copies as fit and a cut
// last one. [{ von, quelle }] with the beat a copy starts at and the cell index it shows.
export function wiederholZellen(z, gesamt) {
  const L = z.laenge_beats, aus = [];
  if (!z.zellen || !(L > 0)) return aus;
  for (let v = L; v < gesamt - EPS; v += L) {
    z.zellen.forEach((_, c) => { if (v + c * z.teiler < gesamt - EPS) aus.push({ von: v + c * z.teiler, quelle: c, breite: Math.min(z.teiler, L - c * z.teiler, gesamt - v - c * z.teiler) }); });
  }
  return aus;
}

// ---------- curve lane: geometry and gestures ----------
export const SNAP_BEAT = 1 / 16;   // a point lands on a sixteenth of a beat
export const kurveBeatAusX = (x, px, laenge) => klemme(runde(Math.round(x / px / SNAP_BEAT) * SNAP_BEAT), 0, laenge);
export function kurveWertAusY(z, y, hoehe) {
  const f = (hoehe - 3 - y) / (hoehe - 6);
  return wertAus(z, f, z.bereich);
}
// The points of the first pass as drawn: x, y in pixels with their form.
export const kurvePunkte = (z, px, hoehe) => (z.punkte ?? []).map((p, i) => ({ i, x: runde(p.beat * px), y: kurveY(p.wert, hoehe, z.bereich), form: p.form, geklemmt: p.geklemmt === true }));
// The beats where the lane starts again inside the pattern (the dashed marks).
export function kurveMarken(laenge, gesamt) {
  const aus = [];
  if (!(laenge > 0)) return aus;
  for (let v = laenge; v < gesamt - EPS; v += laenge) aus.push(runde(v));
  return aus;
}
// The point list of a curve lane in shown values. A point the knob position plus its offset puts outside 0..1 is shown clamped; it carries the value that is
// stored (`gespeichert`), and kurveBefehle writes exactly that back, so that an edit of another point never rewrites it with the clamped value. A point the
// edit touches (kurveNeu on its beat, kurveVerschiebe) loses the mark and takes the shown value.
function kurveListe(z) {
  return (z.punkte ?? []).map((p) => ({ beat: p.beat, wert: p.wert, form: p.form, ...(p.geklemmt && p.gespeichert !== undefined ? { gespeichert: p.gespeichert } : {}) }));
}
export function kurveNeu(z, beat, wert) {
  const l = kurveListe(z), da = l.findIndex((p) => Math.abs(p.beat - beat) < 1e-6);
  if (da >= 0) l[da] = { beat: l[da].beat, wert, form: l[da].form };
  else l.push({ beat, wert, form: 'linear' });
  return l;
}
// The index of the point a hand grabbed: the pressed index `i` while the point of that beat is still there, else the point on `beat` (a write that was still out
// re-sorted the list), else -1 (the point is gone)
export function kurvePunktBei(z, beat, i) {
  const l = z.punkte ?? [];
  if (l[i] && Math.abs(l[i].beat - beat) < 1e-6) return i;
  return l.findIndex((p) => Math.abs(p.beat - beat) < 1e-6);
}
export function kurveVerschiebe(z, i, beat, wert) {
  const l = kurveListe(z);
  if (!l[i]) throw new SeqFehler('argument_ungueltig', `lane ${z.id}, point ${i}: no such point`);
  l[i] = { beat, wert, form: l[i].form };
  return l;
}
export function kurveWeg(z, i) {
  const l = kurveListe(z);
  if (!l[i]) throw new SeqFehler('argument_ungueltig', `lane ${z.id}, point ${i}: no such point`);
  l.splice(i, 1);
  return l;
}
export const kurveSchreibe = (spur, clip, z, punkte, info, form) => { pruefeReglerInfo(z.ziel, info); return mitLaenge(z, kurveBefehle(spur, clip, z, punkte, info, form)); };

// ---------- shapes ----------
export const FORM_ARTEN = [['sinus', 'Sine'], ['dreieck', 'Triangle'], ['saege', 'Saw up'], ['saege_ab', 'Saw down'], ['rechteck', 'Square'], ['rampe', 'Ramp'], ['zufall', 'Random steps']];
const rund2 = (x) => Math.round(x * 100) / 100;
// The shape a menu entry writes: `art`, with from and to of the lane's shape so far (else 10 % and 90 % of the range) and `aend` on top ({ von }, { bis },
// { saat }). `zufall` keeps its seed and steps, a new seed is `aend.saat`.
export function formAus(z, art, aend = {}) {
  const b = z.bereich ?? anzeigeBereich(z.ziel), alt = z.form;
  const von = alt?.von ?? rund2(b.min + 0.1 * (b.max - b.min)), bis = alt?.bis ?? rund2(b.min + 0.9 * (b.max - b.min));
  const f = { art, von, bis, ...aend };
  if (art === 'zufall') { f.saat = aend.saat ?? alt?.saat ?? 1; f.stufen = alt?.stufen ?? 8; }
  return f;
}
// The commands that write a shape over the lane length: the points of formPunkte and the descriptor with the shape (kurveBefehle).
export function formSchreibe(spur, clip, z, info, form) {
  return kurveSchreibe(spur, clip, z, formPunkte(form, z.laenge_beats), info, form);
}

// ---------- the length of a lane ----------
// The text of a lane length: quarter bars below a bar, whole bars, else steps.
export function eigenLaengeText(beats, proTakt = 4) {
  if (proTakt === 4 && beats < 4 && Number.isInteger(beats)) return `${beats}/4 bar`.replace('2/4', '1/2');
  return laengeText(beats, proTakt);
}
// The entries of the length picker of an envelope lane in a pattern of `muster` beats: "with pattern" (null) and every shorter length from a quarter bar.
export function eigenLaengen(muster, proTakt = 4) {
  return [{ text: 'with pattern', beats: null }, ...[1, 2, 3, 4, 8, 16, 32].filter((b) => b < muster - EPS).map((b) => ({ text: eigenLaengeText(b, proTakt), beats: b }))];
}
// A free step count (steps of 1/16) for a lane in a pattern of `muster` beats: beats, or null when it is not a whole number up to the pattern length.
export function eigenAusSchritten(text, muster) {
  const t = String(text ?? '').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n / 4 <= muster + EPS ? n / 4 : null;
}
// The commands that give an envelope lane a length of its own (beats) or link it to the pattern (null). With an envelope the model holds the length; a shape
// the lane came from is written again over the new length (one huellkurve_setzen with points and length); without an envelope `wartend` takes it (null here:
// the caller keeps the page state).
export function laengeZeileBefehle(spur, clip, z, beats, info) {
  if (z.hat_huellkurve !== true) return null;
  if (z.art === 'kurve' && z.form) {
    const neu = beats === null ? (clip.loop_beats ?? clip.laenge_beats) : beats;
    const clip2 = { ...clip, huellkurven: (clip.huellkurven ?? []).map((h) => {
      if (h.ziel !== z.ziel) return h;
      const o = { ...h };
      if (beats === null) { delete o.verknuepft; delete o.loop_beats; } else { o.verknuepft = false; o.loop_beats = beats; }
      return o;
    }) };
    const { abdruck, ...form } = z.form;   // eslint-disable-line no-unused-vars
    const l = kurveBefehle(spur, clip2, { ...z, laenge_beats: neu }, formPunkte(form, neu), info, form);
    if (l.some((x) => x.befehl === 'huellkurve_setzen' && x.ziel === z.ziel)) return l;
  }
  return zeileAendernBefehle(spur, clip, z.id, { eigen_laenge: beats }, info);
}

// ---------- targets: new lanes and re-assigning ----------
const TRACK_ZIELE = [['transpose', 'transpose'], ['spur_fader', 'track level'], ['spur_pan', 'track pan']];
// The entries of the target picker for a new lane of kind `art` ('werte' | 'kurve'): [{ gruppe, text, zeile, aus, titel }]. `zeile` is the lane to add without
// id (zeileNeuBefehle gives it one). A target that has a lane already, or that the instrument does not take (zielErlaubt), is `aus`. velocity and length
// read a note lane: with several the entry names the lane (`von`), without one they are off.
export function zielWahl(sicht, spur, info, art) {
  const zeilen = sicht?.zeilen ?? [], belegt = new Set(zeilen.filter((z) => z.art !== 'noten').map((z) => z.ziel)), noten = zeilen.filter((z) => z.art === 'noten');
  const aus = [];
  const eintrag = (gruppe, text, ziel, extra = {}, sperre = null) => {
    const grund = belegt.has(ziel) ? 'has a lane already' : sperre;
    const zeile = art === 'werte' ? { art: 'werte', teiler: 0.25, ziel, ...extra } : { art: 'kurve', ziel };
    aus.push({ gruppe, text, zeile, aus: !!grund, ...(grund ? { titel: grund } : {}) });
  };
  if (art === 'werte') {
    for (const [ziel, text] of [['vel', 'velocity'], ['laenge', 'length']]) {
      if (!noten.length) eintrag('Notes', text, ziel, {}, 'needs a note lane');
      else if (noten.length === 1) eintrag('Notes', text, ziel, { teiler: noten[0].teiler });
      else for (const n of noten) eintrag('Notes', `${text} · ${n.name ?? n.id}`, ziel, { teiler: n.teiler, von: n.id });
    }
  }
  for (const r of info?.regler ?? []) {
    const ziel = reglerZiel(r.nr);
    eintrag('Knobs', r.name ?? String(r.nr), ziel, {}, zielErlaubt(ziel, spur, info) ? null : 'this instrument has no such knob');
  }
  for (const [ziel, text] of TRACK_ZIELE) eintrag('Track', text, ziel);
  return aus;
}
// The entries of the target picker of an existing lane (re-assign): [{ text, ziel, aktuell, aus, titel }]. An envelope lane moves between envelope targets, a
// velocity or length lane between those two.
export function zielUmhaengen(z, sicht, spur, info) {
  const zeilen = sicht?.zeilen ?? [], belegt = new Set(zeilen.filter((x) => x.id !== z.id && x.art !== 'noten').map((x) => x.ziel));
  const feld = z.art === 'werte' && (z.ziel === 'vel' || z.ziel === 'laenge');
  const liste = feld ? [['vel', 'velocity'], ['laenge', 'length']]
    : [...(info?.regler ?? []).map((r) => [reglerZiel(r.nr), r.name ?? String(r.nr)]), ...TRACK_ZIELE];
  return liste.map(([ziel, text]) => {
    const grund = ziel === z.ziel ? null : belegt.has(ziel) ? 'has a lane already' : !feld && !zielErlaubt(ziel, spur, info) ? 'this instrument has no such knob' : null;
    return { text, ziel, aktuell: ziel === z.ziel, aus: !!grund, ...(grund ? { titel: grund } : {}) };
  });
}

// ---------- the jump to PRODUCTION ----------
// Where the jump goes: the clip of the pattern whose block was touched last (`spurId`), else the first pattern. { clip_id, name } or { meldung } when there
// is nothing to select (no pattern, or a pattern that has no clip yet).
export function sprungZiel(a, spurId) {
  const f = a?.folgen?.find((x) => x.spur_id === spurId) ?? a?.folgen?.[0];
  if (!f) return { meldung: 'No pattern yet: add one first' };
  const clip = f.clip ?? f.spur?.clips?.[0];
  if (!clip) return { meldung: `The pattern ${f.name} has no clip yet: add a note first` };
  return { clip_id: clip.id, name: f.name };
}

// ---------- hide empty lanes: the lanes of the editable patterns that hold nothing (no note, no value, no curve point) ----------
export function zeileBenutzt(z) {
  if (z.art === 'kurve') return (z.punkte ?? []).length > 0;
  if (z.art === 'noten') return (z.zellen ?? []).some((c) => c.an || c.gebunden);
  return (z.zellen ?? []).some((c) => c.da);
}
// The keys "spur_id/lane id" of the empty lanes at this moment. The page hides exactly these until the button is pressed again, so a lane added later
// or emptied under the hand stays in view.
export function leereZeilen(a) {
  const aus = new Set();
  for (const f of a?.folgen ?? []) for (const z of f.sicht?.zeilen ?? []) if (!zeileBenutzt(z)) aus.add(`${f.spur_id}/${z.id}`);
  return aus;
}

// ---------- PLAY/STOP per deck (Andreas 2026-11-20: "seq 1 und seq 2 starten beide egal welchen der beiden play knöpfe ich drücke") ----------
// All decks are groups of the one live container and share its transport, so a deck plays when the transport runs AND its group is not muted. PLAY on a
// stopped container unmutes this deck, mutes the other decks and starts the transport; PLAY on a running one unmutes this deck. STOP mutes this deck while
// another deck still plays, else stops the transport. Answers {befehle, transport: 'start' | 'stopp' | null}; the group commands go to POST /proj/aendern.
export const deckGruppe = (p, n) => (p?.gruppen ?? []).find((g) => g.seq?.platz === n) ?? null;
export const deckSpielt = (p, n, laeuft) => { const g = deckGruppe(p, n); return !!laeuft && !!g && !g.mute; };
export function deckSpielSchritt(p, n, an, laeuft) {
  const g = deckGruppe(p, n);
  if (!g) return { befehle: [], transport: null };
  const stumm = (x, mute) => ({ befehl: 'gruppenspur_aendern', gruppe_id: x.id, mute });
  const andere = (p.gruppen ?? []).filter((x) => x.seq && x.id !== g.id);
  if (an) {
    const befehle = g.mute ? [stumm(g, false)] : [];
    if (laeuft) return { befehle, transport: null };
    return { befehle: [...befehle, ...andere.filter((x) => !x.mute).map((x) => stumm(x, true))], transport: 'start' };
  }
  if (laeuft && andere.some((x) => !x.mute)) return { befehle: g.mute ? [] : [stumm(g, true)], transport: null };
  return { befehle: [], transport: 'stopp' };
}
// Milliseconds until `vorlauf` ms before the next bar of the running transport (a change sent then lands on the one); null without a beat.
export function msBisTakt(beat, proTakt, bpm, vorlauf = 50) {
  if (beat === null || beat === undefined || !(bpm > 0) || !(proTakt > 0)) return null;
  const msProBeat = 60000 / bpm;
  let ms = (proTakt - (((beat % proTakt) + proTakt) % proTakt)) * msProBeat - vorlauf;
  if (ms < 0) ms += proTakt * msProBeat;
  return ms;
}
