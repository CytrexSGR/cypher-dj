// PRODUCTION (D1 V1): Spurköpfe links neben dem Arrangement (DOM, Spec 2.11), je Spur Farbe, Name, Gerät, M, S,
// Lautstärke, Pan und Pegel (A6-Bedienung). Jede Bedienung geht über aendere() an POST /proj/aendern (Spec 3.4
// spur_aendern), damit sie im Projekt und im Undo-Verlauf landet. Der Pegel kommt ohne eigenen Code: app.js zeigePegel
// füllt jedes .meter[data-kanal="spur/<nr>"] aus /pegel (Spec 3.4: /pegel geht schon heute für jeden Kanal durch).
import { FARBEN, zeilenFuer } from './layout.js';
import { MAX_SPUREN, MAX_GRUPPEN, MAX_KIT_GERAETE, WIRT_SLOTS } from './limits.js';
import { MAX_RACK_GERAETE, RB_GLIED_GERAET, wirtBelegt, kitBelegt, rackBelegt } from './rack_device.js';
import { armZustand, eingangVonWert, eingangsOptionen, MODUS_OPTIONEN, MONITOR_OPTIONEN } from './recording.js';
import { ausgangOptionen, ausgangWert, ausgangBefehl, gruppenKopfZustand, gruppeAusWahl, gruppenEltern, gruppenKette, spurGruppe } from './routing.js';
import { baueGruppenKopf, zeigeGruppenKopf, foldLabel, balkenVerlauf } from './groups_kopf.js';
import { faderLane, laneWert, laneFuer, gezeigteLane, freieZiele, zielLabel, offeneIndizes } from './lanes.js';
import { REGLER_MAX, REGLER_SCHRITT, reglerVonDb, dbVonRegler, tasteMerke, tasteWert } from './fader_curve.js';
import { LANEN_TEXT, sperrBefehl, zeichenModus } from './lanes_operation.js';
import { TAKE_TEXT, hatTakes, takeZeilenVon } from './takes.js';
import { neueTakeKoepfe, vorhoerenSenden } from './takes_operation.js';
import { oeffneMenue, kopfMenueAuf } from './context_menu.js';
import { neueGesten, bindeAutoAufnahme, istArmiert, GESTE_RUHE_MS } from './auto_recording.js';
import { geraetSchluessel } from './device_view.js';

// S18: the inputs a track can record, a literal list on purpose (the page cannot import the .ts table); tests/proj_inputs_s18.test.mjs
// binds it to INTERNE_EINGAENGE of vertrag/stroeme.ts. erz/4 and erz/8 are missing on purpose: the kern has no tap for them.
export const EINGANG_OPTIONEN = [
  { wert: 'erz/1', text: 'erz/1' }, { wert: 'erz/2', text: 'erz/2' }, { wert: 'erz/3', text: 'erz/3' },
  { wert: 'erz/5', text: 'erz/5 (bk)' }, { wert: 'erz/6', text: 'erz/6 (bk)' }, { wert: 'erz/7', text: 'erz/7 (bk)' },
  { wert: 'pad/1', text: 'pad/1 (L1)' }, { wert: 'pad/2', text: 'pad/2 (L2)' },
];

// Fader −60..+6 dB; ganz unten heißt aus (−200), wie die Spurbänder es halten (track_tape.js baender: min −60, aus −200)
export const FADER_MIN = -60, FADER_MAX = 6, FADER_AUS = -200;
export const faderWert = (v) => (v <= FADER_MIN ? FADER_AUS : Math.min(FADER_MAX, v));
export const faderText = (db) => (db <= FADER_MIN ? '−∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`.replace('-', '−'));
export const panText = (p) => (Math.abs(p) < 0.005 ? 'C' : `${p < 0 ? 'L' : 'R'}${Math.round(Math.abs(p) * 100)}`);
export function geraetText(s) {
  if (s.art === 'audio') return 'AUDIO';
  if (s.geraet?.art === 'intern' && s.geraet.name === 'rb338') return 'RB-338';
  if (s.geraet?.art === 'intern' && s.geraet.name === 'bk') return `BK · ${s.geraet.graph}`;   // S20: a Baukasten graph plays the notes of the track
  if (s.geraet?.art === 'intern' && s.geraet.name === 'kit') return `KIT · ${s.geraet.kit}`;   // 1.9 (L25): a core kit plays the notes of the track
  if (s.geraet?.art === 'wirt' && s.geraet.plugin) return `PLUGIN · ${s.geraet.plugin.name} · ${s.geraet.slot}`;   // plan 1.11 task 17: a foreign instrument
  if (s.geraet?.art === 'wirt') return `${String(s.geraet.name).toUpperCase()} · ${s.geraet.slot}${s.geraet.patch ? ` · ${s.geraet.patch}` : ''}`;   // the stored patch name follows
  if (s.geraet?.art === 'rack') return `RACK · ${s.geraet.glieder.length}`;   // 1.9 U7: the number of members
  return String(s.geraet?.name ?? '?').toUpperCase();
}
export const naechsteFarbe = (f) => FARBEN[(FARBEN.indexOf(f) + 1) % FARBEN.length];
// ↑/↓: Zielindex in der Spurliste für spur_verschieben {spur_id, index}; am Rand (oder unbekannte Spur/Richtung) null
export function zielIndex(anzahl, index, richtung) {
  if (!(index >= 0 && index < anzahl)) return null;
  if (richtung === 'hoch') return index > 0 ? index - 1 : null;
  if (richtung === 'runter') return index < anzahl - 1 ? index + 1 : null;
  return null;
}

// 1.10 T3: the heads in display order, written by the SAME table the arrangement draws (layout.js zeilenFuer): a group header, a track head (a folded
// member keeps its head element, hidden), the take heads of a track (one entry for all its take rows), the lane head. One function writes the order.
export function kopfFolge(projekt, offen = new Set(), takeOffen = new Set()) {
  const tab = zeilenFuer(projekt, offeneIndizes(projekt, offen), takeZeilenVon({ takeOffen }, projekt)), aus = [], takes = new Set();
  for (const z of tab) {
    if (z.art === 'gruppe') aus.push({ art: 'gruppe', id: projekt.gruppen[z.gruppe].id, tiefe: z.tiefe ?? 0, verborgen: !!z.verborgen });
    else if (z.art === 'spur') aus.push({ art: 'spur', id: projekt.spuren[z.spur].id, tiefe: z.tiefe ?? 0, verborgen: !!z.verborgen });
    else if (z.art === 'take') { const id = projekt.spuren[z.spur].id; if (!takes.has(id)) { takes.add(id); aus.push({ art: 'take', id }); } }
    else if (z.art === 'lane') aus.push({ art: 'lane', id: projekt.spuren[z.spur].id });
  }
  return aus;
}

// Zugänglicher Name je Bedienelement mit Spurbezug: ohne ihn lesen sich acht Spuren als acht gleiche „M“, „S“, „↑“ (Oberfläche englisch)
export const spurLabels = (name) => ({
  mute: `Mute ${name}`, solo: `Solo ${name}`, hoch: `Move ${name} up`, runter: `Move ${name} down`, farbe: `Colour ${name}`,
  loeschen: `Delete track ${name}`, umbenennen: `Rename track ${name}`, fader: `Volume ${name}`, pan: `Pan ${name}`, lane: `Automation lanes ${name}`,
  modus: `Recording mode of ${name}`, monitor: `Monitor ${name}`,
});
// Umbenennen per Tastatur: Enter oder F2 auf dem fokussierten Namen (wie Doppelklick)
export const istUmbenennenTaste = (e) => (e.key === 'Enter' || e.key === 'F2') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;

const KOPF = `<button class="p-farbe" title="Track colour: click for the next one"></button>
<span class="p-spurname" role="button" tabindex="0" title="Double click, Enter or F2 to rename"></span><span class="p-geraet"></span>
<button class="p-hoch" title="Move track up">↑</button><button class="p-runter" title="Move track down">↓</button>
<button class="p-mute" aria-pressed="false" title="Mute">M</button><button class="p-solo" aria-pressed="false" title="Solo">S</button>
<button class="p-arm" aria-pressed="false" title="Arm for recording (needs an input)" disabled>●</button><select class="p-eingang" title="Recording input" disabled><option value="">input</option>${EINGANG_OPTIONEN.map((o) => `<option value="${o.wert}">${o.text}</option>`).join('')}</select>
<select class="p-modus" title="Recording mode of an external input: stereo, left, right or sum" hidden>${MODUS_OPTIONEN.map((o) => `<option value="${o.wert}">${o.text}</option>`).join('')}</select>
<span class="p-monitor" role="group" title="Monitoring of the external input: IN always, AUTO unless a clip plays back, OFF never" hidden>${MONITOR_OPTIONEN.map((o) => `<button class="p-mon" data-mon="${o.wert}" aria-pressed="false">${o.text}</button>`).join('')}</span>
<div class="meter waagrecht p-eingpegel" data-kanal="" hidden><i></i></div>
<button class="p-loeschen" title="Delete track (Undo brings it back)">✕</button>
<input class="p-fader" type="range" min="0" max="${REGLER_MAX}" step="${REGLER_SCHRITT}" title="Volume (double click: 0 dB)"><select class="p-ausgang" title="Output: Master or a group track"></select>
<output class="p-faderwert"></output>
<input class="p-pan" type="range" min="-1" max="1" step="0.01" title="Pan (double click: centre)">
<output class="p-panwert"></output>
<div class="meter waagrecht p-pegel"><i></i></div>
<button class="p-lane" aria-pressed="false" title="${LANEN_TEXT.knopf_titel}">A</button>
<button class="p-take" aria-pressed="false" title="${TAKE_TEXT.knopf_titel}" hidden>T</button>
<button class="p-autoarm" aria-pressed="false" aria-label="Arm automation recording" title="Arm this track for automation recording (mode in the transport bar)">AUTO ●</button>`;

// The head of an open lane row (Automation S1 + S2): the title or, when the track has lanes, the selector of its lanes; "+ Lane" with the free targets; the
// lock; the button that deletes the shown lane. 48 px like the lane row.
const LANENKOPF = `<span class="p-lanentitel">${LANEN_TEXT.titel}</span><select class="p-lanenwahl" title="${LANEN_TEXT.wahl_titel}" aria-label="${LANEN_TEXT.wahl_titel}" hidden></select>
<select class="p-lane-neu" title="${LANEN_TEXT.neu_titel}" aria-label="${LANEN_TEXT.neu_titel}"></select>
<button class="p-lane-sperre" aria-pressed="false" title="${LANEN_TEXT.sperre}">🔓</button>
<button class="p-lane-zeichnen" aria-pressed="false" title="${LANEN_TEXT.zeichnen_titel}" aria-label="${LANEN_TEXT.zeichnen_label}">${LANEN_TEXT.zeichnen}</button>
<button class="p-lane-weg" title="${LANEN_TEXT.weg_titel}">✕</button>`;

// The ONE page table of the lane override targets (1.12 S3, fix round 2 I3). Its keys are the server's KERN_AUTO_ZIELE (tests/production_over.test.mjs binds
// them). feld: the field of spur_aendern. art 'regler': a range input with its value text (D11: the lane value shows in the head while the transport runs);
// art 'knopf': the M or S button. basis: the base value of the track; daumen: lane value -> value of the control. Everything below is derived from here.
export const UEBER_ZIELE = {
  fader: { feld: 'fader_db', art: 'regler', regler: '.p-fader', anzeige: '.p-faderwert', text: faderText, basis: (s) => s.fader_db, daumen: (v) => reglerVonDb(v) },
  pan: { feld: 'pan', art: 'regler', regler: '.p-pan', anzeige: '.p-panwert', text: panText, basis: (s) => s.pan, daumen: (v) => v },
  mute: { feld: 'mute', art: 'knopf', knopf: '.p-mute', basis: (s) => s.mute, daumen: (v) => v, an: 'Mute', aus: 'Unmute' },
  solo: { feld: 'solo', art: 'knopf', knopf: '.p-solo', basis: (s) => s.solo, daumen: (v) => v, an: 'Solo', aus: 'Unsolo' },
};
const ziele = (art) => Object.entries(UEBER_ZIELE).filter(([, d]) => d.art === art);
// the regulators: [selector of the value text, text of a value, base value of the track]; the buttons: [selector, base value]
export const KOPF_WERTE = Object.fromEntries(ziele('regler').map(([z, d]) => [z, [d.anzeige, d.text, d.basis]]));
export const KNOPF_ZIELE = Object.fromEntries(ziele('knopf').map(([z, d]) => [z, [d.knopf, d.basis]]));
const FELD_ZIEL = Object.fromEntries(Object.entries(UEBER_ZIELE).map(([z, d]) => [d.feld, z]));
// The control value while a lane plays: the lane at the playhead, computed by laneWert (the one function the text uses, bound to the core by lane_ref.json).
// The fader slider shows -60 at the bottom, so -200 dB (mute) sits on the bottom edge. null: no lane for the field.
export function daumenWert(s, ziel, kopfBeat) {
  const l = laneFuer(s, ziel);
  if (!l) return null;
  const v = laneWert(l.punkte, kopfBeat, ziel);
  return UEBER_ZIELE[ziel].daumen(v);
}
// The value a grip freezes (fix round 1, item 2): thumb and text of the field stay at the lane value computed for the grip beat (the value the core
// picks up) until an input event moves them. Kept per `${spur_id}|${ziel}` while the server lists the field as overridden. Not confirmed within
// FROST_WARTE_MS (stopped, refused): dropped. LIMIT, documented: a page reload after a grip WITHOUT movement shows the base value, because the pickup
// value lives only in the core; it is not written into the project and not fixed through the server.
export const FROST_WARTE_MS = 3000;
const ANFRAGEN_RUNDEN = 20;   // bound of the rounds that wait for override requests before a gesture end
export { GESTE_RUHE_MS };   // one constant for the page (auto_recording.js), pinned against the server's by a test
export function neuerFrost() {
  const m = new Map();
  return {
    setze: (k, wert, t) => { m.set(k, { wert, t, bestaetigt: false }); },
    loesche: (k) => { m.delete(k); },
    leere: () => { m.clear(); },
    loescheSpur: (id) => { for (const k of [...m.keys()]) if (k.startsWith(`${id}|`)) m.delete(k); },
    // ueberAn: does the server list the field as overridden right now
    hole(k, ueberAn, t) {
      const e = m.get(k);
      if (!e) return undefined;
      if (ueberAn) { e.bestaetigt = true; return e.wert; }
      if (e.bestaetigt || t - e.t > FROST_WARTE_MS) { m.delete(k); return undefined; }
      return e.wert;
    },
  };
}
// Who holds a field: the mouse (pointerdown until pointerup, pointercancel or lostpointercapture) or the keyboard (until GESTE_RUHE_MS without a key). A key
// never ends a held mouse grip, a quiet keyboard never ends a mouse. Keys `${spur_id}:${feld}`; t is a time in ms.
export function neuerGriff(ruheMs = GESTE_RUHE_MS) {
  const maus = new Set(), taste = new Map();
  return {
    mausAn: (k) => { maus.add(k); }, mausAus: (k) => { maus.delete(k); }, mausHaelt: (k) => maus.has(k),
    tasteAn: (k, t) => { taste.set(k, t); },
    ende: (k) => { maus.delete(k); taste.delete(k); },
    haelt: (k, t) => maus.has(k) || (taste.has(k) && t - taste.get(k) < ruheMs),
    loescheSpur: (id) => { for (const k of [...maus, ...taste.keys()]) if (k.startsWith(`${id}:`)) { maus.delete(k); taste.delete(k); } },
    leere: () => { maus.clear(); taste.clear(); },
  };
}
// Write a range input only on a real change (fix round 2 I1): the input snaps its value to its step, so comparing with String(v) is always unequal on a ramp
// (measured: 65 setter calls per frame at 32 tracks). Computes the snapped, clamped value and writes it when it differs. Returns true when it wrote.
export function setzeRegler(r, v) {
  const min = Number(r.min), max = Number(r.max), schritt = Number(r.step);
  const z = Number(Math.min(max, Math.max(min, min + Math.round((v - min) / schritt) * schritt)).toFixed(6));
  if (Number(r.value) === z) return false;
  r.value = String(z);
  return true;
}
// The answer of the override request decides about the write (fix round 2 I2): 200 (also the acknowledgement while stopped) and a missing core (503, and
// 0 = timeout or no answer) write spur_aendern, because the base value may be edited without a core; a refusal (400, 403, 404, 409, 500) writes nothing.
export const UEBER_ZEIT_MS = 2000;
export const ueberErgebnis = (status) => status === 200 || status === 503 || status === 0;
// the shown state of the M or S button: the frozen lane value wins over the base value of the track
export const knopfZustand = (s, ziel, frost) => (frost !== undefined ? frost >= 0.5 : !!s[ziel]);
// D4: only these keys move a range input, so only they count as a grip (Tab and shortcuts do not override)
const REGLER_TASTEN = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);
export const reglerTaste = (e) => REGLER_TASTEN.has(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey;
export const ueberSchluessel = (spurId, ziel) => `${spurId}|${ziel}`;
// D5/D8: overridden only as the server says it (the list auto_uebersteuert of GET /proj/aktuell), never from a click of this page
export const istUebersteuert = (liste, spurId, ziel) => Array.isArray(liste) && liste.some((x) => x.spur_id === spurId && x.ziel === ziel);
// D4: the request body for a grip on the regulator `feld` of track s, or null when there is nothing to override (no lane, or already overridden)
export function ueberAnfrage(s, feld, liste) {
  const ziel = FELD_ZIEL[feld];
  return ziel && laneFuer(s, ziel) && !istUebersteuert(liste, s.id, ziel) ? { spur_id: s.id, ziel } : null;
}

// "+ Lane" (pure, tested): the lane is created by the server, so the page switches to its target only when the request was accepted; a refusal keeps
// the old choice. aendere returns a promise of true (accepted) or false.
export async function laneAnlegen(aendere, waehle, spurId, ziel) {
  const ok = await aendere(LANEN_TEXT.neu_label, [{ befehl: 'auto_neu', spur_id: spurId, ziel }]);
  if (ok) waehle(spurId, ziel);
  return ok;
}
// The lock button (pure, tested): like M and S it computes from the state at SEND time (aendereAus), not from the state at the click. Two quick clicks
// therefore lock and then unlock instead of sending `gesperrt: true` twice. The lane is the one the row shows at that moment.
export function sperreUmschalten(aendereAus, spurId, wahl) {
  return aendereAus((p) => {
    const s = p.spuren.find((x) => x.id === spurId), l = s ? gezeigteLane(s, wahl(spurId)) : null;
    return l ? { label: l.gesperrt ? LANEN_TEXT.entsperre_label : LANEN_TEXT.sperre_label, befehle: [sperrBefehl(l)] } : null;
  });
}

// aendereAus(rechne) (V2 Fix-Runde 2 H1, Spec 6.34): M, S, Farbe und ↑/↓ folgen aus dem Stand der Spur und rechnen darum erst, wenn die Anfrage an der
// Reihe ist, aus genau dem Stand, dessen rev mitgeht (zwei schnelle Klicks auf M: an, dann aus; vorher zweimal an). Fader, Pan, Name, Löschen sind fest.
// offen(): the Set of track ids whose lane row is open (page state); umschalten(id): the A button of that track was pressed
// 1.12 S3 task 9: without a recorder (tests, a page without recording) the gestures go nowhere
const KEINE_GESTEN = { wert: () => false, ende: () => false, einmal: () => false, alleEnden: () => {}, abgleich: () => {}, verwerfeSpur: () => {}, verwirf: () => {}, beendeSpur: async () => {} };
function zeigeArmKnopf(el, an) {
  const b = el.querySelector('.p-autoarm');
  if (b.classList.contains('an') !== an) { b.classList.toggle('an', an); b.setAttribute('aria-pressed', String(an)); }
}
export function bindeKoepfe(behaelter, { aendere, aendereAus, offen = () => new Set(), umschalten = () => {}, takeOffen = () => new Set(), takeKoepfe = null, takesUmschalten = () => {}, wahl = () => undefined, waehle = () => {},
  spurWahl = () => new Set(), wahlUmschalten = () => {}, gruppeFalten = () => {},
  ueber = () => [], uebersteuere = async () => true, kopfBeat = () => null, gesten = KEINE_GESTEN, armiere = async () => {}, armStandJetzt = () => null, marke = () => null, geraete = () => null, rackOeffnen = () => {}, geraetOeffnen = () => {}, instrumente = () => [] }) {
  const frost = neuerFrost();
  const jetzt = () => performance.now();
  const stand = new Map();     // spur_id → Spur laut letztem Projekt
  const griff = neuerGriff();  // `${id}:${feld}`, solange die Hand am Regler ist (Maus oder Taste): der Server überschreibt dann nicht
  if (typeof window !== 'undefined') window.addEventListener('blur', () => gesten.alleEnden());   // D13: the window lost the focus, no end event of the pointer will come
  const offeneKopfAnfragen = new Map();   // spur_id -> the `anfragen` map of that head: the override requests in flight (a recorder end waits for them)
  const els = new Map();       // spur_id → Element
  const laneEls = new Map();   // spur_id → head of the open lane row
  const gruppenEls = new Map();   // gruppe_id → the header row of a group in the arrangement (T3)
  const gruppeFarbe = (id) => { const f = gruppenStand.find((g) => g.id === id)?.farbe; return /^#[0-9a-f]{6}$/i.test(f ?? '') ? f : '#8a8d98'; };
  const gruppeGewaehlt = (id) => spurWahl().has(id);   // nested groups: the selection holds the head id itself
  const gruppenHandler = { falten: (id) => { const g = gruppenStand.find((x) => x.id === id); if (g) gruppeFalten(g); },
    waehle: (id, e) => wahlUmschalten([id], e, !(e.ctrlKey || e.shiftKey || e.metaKey)),
    ziel: (id, wert) => aendere(`Output group ${gruppenStand.find((x) => x.id === id)?.name ?? id}`, [ausgangBefehl(id, wert)]) };
  zeichenModus.hoerer.add((an) => {                 // 1.12 slice 4 (D1): every open lane head shows the draw mode
    for (const le of laneEls.values()) { const b = le.querySelector('.p-lane-zeichnen'); b.classList.toggle('an', an); b.setAttribute('aria-pressed', String(an)); }
  });
  let reihenfolge = [];        // spur_ids in Anzeigereihenfolge (Array-Reihenfolge des Projekts)
  let gruppenStand = [];       // Gruppen laut letztem Projekt (Auswahl der Ausgang-Wahl)

  function baue(id) {
    const el = document.createElement('div');
    el.className = 'p-kopf';
    el.dataset.spur = id;
    el.innerHTML = KOPF;
    const q = (s) => el.querySelector(s);
    const spur = () => stand.get(id);
    // D4 + fix round 1 (item 2): a grip on a field with a lane asks the server for the override and, while the transport runs, freezes thumb/text/button of
    // the field at the lane value of the grip beat (the value the core picks up). Returns the request in flight (the change waits for it) or null; it
    // resolves to true when the change may be written (ueberErgebnis). A refusal (fix round 2 I2) drops the freeze and the grip, and the field stays
    // refused (abgelehnt) until the next grip.
    const anfragen = new Map();   // ziel → request in flight
    offeneKopfAnfragen.set(id, anfragen);
    const abgelehnt = new Set();  // ziele whose last request was refused
    const gk = (ziel) => `${id}:${UEBER_ZIELE[ziel].feld}`;
    // the request with the client timeout: no answer in UEBER_ZEIT_MS counts like a missing core, so the field cannot go dead
    const frage = (a) => {
      let uhr = 0;
      const zeit = new Promise((ok) => { uhr = setTimeout(() => { console.warn(`override request for ${a.spur_id} ${a.ziel}: no answer in ${UEBER_ZEIT_MS} ms, writing like without a core`); ok(0); }, UEBER_ZEIT_MS); });
      const antwort = Promise.resolve().then(() => uebersteuere(a)).catch((e) => { console.warn('override request failed:', e?.message ?? e); return 0; });
      return Promise.race([antwort, zeit]).then((status) => { clearTimeout(uhr); return ueberErgebnis(status); });
    };
    const greife = (ziel) => {
      const a = ueberAnfrage(spur(), UEBER_ZIELE[ziel].feld, ueber());
      if (!a) return anfragen.get(ziel) ?? null;
      const beat = kopfBeat();
      if (beat !== null && beat !== undefined) { frost.setze(ueberSchluessel(id, ziel), laneWert(laneFuer(spur(), ziel).punkte, beat, ziel), jetzt()); zeigeWerte(el, spur()); }
      if (anfragen.has(ziel)) return anfragen.get(ziel);
      const pr = frage(a).then((ok) => {
        anfragen.delete(ziel);
        if (!ok) { abgelehnt.add(ziel); frost.loesche(ueberSchluessel(id, ziel)); griff.ende(gk(ziel)); zeigeWerte(el, spur()); }
        return ok;
      });
      anfragen.set(ziel, pr);
      return pr;
    };
    q('.p-lane').addEventListener('click', () => umschalten(id));
    q('.p-take').addEventListener('click', () => takesUmschalten(id));
    q('.p-autoarm').addEventListener('click', () => armiere(id, !istArmiert(armStandJetzt(), id)));
    const aendernSpur = (label, felder, schluessel = null, optionen) => aendere(label, [{ befehl: 'spur_aendern', spur_id: id, ...felder }], schluessel, optionen);
    // rechne(spur, projekt) → {label, felder} | null aus der Spur im Stand beim Senden; ist sie dort weg, geht nichts
    const spurAus = (rechne) => aendereAus((p) => {
      const s = p.spuren.find((x) => x.id === id), r = s ? rechne(s, p) : null;
      return r ? { label: r.label, befehle: r.befehle ?? [{ befehl: 'spur_aendern', spur_id: id, ...r.felder }] } : null;
    });
    // 1.12 S3 fix round 1 (item 3): M and S of a track with a mute or solo lane ask for the override BEFORE spur_aendern (like fader and pan). The click
    // toggles from the SHOWN state (the frozen lane value), so a click on a lane-muted track unmutes it. A refused request writes nothing.
    for (const [ziel, d] of ziele('knopf')) {
      q(d.knopf).addEventListener('click', async () => {
        abgelehnt.delete(ziel);
        const a = greife(ziel);
        if (a && !(await a)) return;
        spurAus((s) => { const jetztAn = knopfZustand(s, ziel, frost.hole(ueberSchluessel(id, ziel), istUebersteuert(ueber(), id, ziel), jetzt()));
          frost.loesche(ueberSchluessel(id, ziel));
          gesten.einmal(id, ziel, jetztAn ? 0 : 1);   // task 9: a click on an armed track is one recorded value
          return { label: `${jetztAn ? d.aus : d.an} ${s.name}`, felder: { [d.feld]: !jetztAn } }; });
      });
    }
    q('.p-arm').addEventListener('click', () => spurAus((s) => ({ label: `${s.aufnahme?.scharf ? 'Disarm' : 'Arm'} ${s.name}`, felder: { arm: !s.aufnahme?.scharf } })));
    q('.p-eingang').addEventListener('change', () => {
      const w = q('.p-eingang').value, alt = spur().aufnahme?.eingang;
      aendernSpur(`Input ${spur().name}`, { eingang: eingangVonWert(w, alt?.art === 'extern' ? alt.modus : 'stereo'), ...(w ? {} : { arm: false }) });
    });
    q('.p-modus').addEventListener('change', () => {   // 1.8 S2b: the mode of an external input (D14); the pair stays
      const alt = spur().aufnahme?.eingang;
      if (alt?.art === 'extern') aendernSpur(`Recording mode ${spur().name}`, { eingang: { art: 'extern', paar: alt.paar, modus: q('.p-modus').value } });
    });
    for (const b of el.querySelectorAll('.p-mon')) {   // 1.8 S3: monitoring In / Auto / Off, a project field (not undoable apart from the history entry, no reload of the playback)
      b.addEventListener('click', () => aendernSpur(`Monitor ${spur().name}`, { monitor: b.dataset.mon }));
    }
    q('.p-farbe').addEventListener('click', () => spurAus((s) => ({ label: `Colour ${s.name}`, felder: { farbe: naechsteFarbe(s.farbe) } })));
    // ↑/↓ und ✕ sind eigene Befehle (spur_verschieben, spur_loeschen), nicht spur_aendern; Löschen nimmt Undo zurück
    for (const [klasse, richtung] of [['.p-hoch', 'hoch'], ['.p-runter', 'runter']]) {
      q(klasse).addEventListener('click', () => spurAus((s, p) => {
        const z = zielIndex(p.spuren.length, p.spuren.indexOf(s), richtung);
        return z === null ? null : { label: `Move track ${richtung === 'hoch' ? 'up' : 'down'} ${s.name}`, befehle: [{ befehl: 'spur_verschieben', spur_id: id, index: z }] };
      }));
    }
    // 1.9 U7: a click on the device label of a rack track opens the rack panel in the detail area (the right click menu is the shared KOPF_MENUE, bound once in production.js)
    // front panels task 8: the same click on a bk or RB-338 track opens its front panel (detail mode `geraet`)
    q('.p-geraet').addEventListener('click', () => { const g = spur()?.geraet; if (g?.art === 'rack') rackOeffnen(id); else if (geraetSchluessel(g)) geraetOeffnen(id); });
    q('.p-loeschen').addEventListener('click', () => aendere(`Delete track ${spur().name}`, [{ befehl: 'spur_loeschen', spur_id: id }]));
    q('.p-ausgang').addEventListener('change', (e) => aendere(`Output ${spur().name}`, [ausgangBefehl(id, e.target.value)]));
    for (const [ziel, d] of ziele('regler')) {
      const r = q(d.regler), feld = d.feld, k = gk(ziel), vorgabe = 0;
      // D4: the grip asks for the override BEFORE spur_aendern goes out: the change waits for the answer of the request (a keydown is followed by
      // `input` at once, two HTTP requests would race). While stopped the server acknowledges and nothing changes (D5): the page stays as it is.
      const sende = (erzwinge) => {
        if (abgelehnt.has(ziel)) { zeigeWerte(el, spur()); return; }   // refused: the lane keeps the field, the thumb goes back to what is shown
        const v = feld === 'fader_db' ? faderWert(tasteWert(r)) : Number(r.value);
        frost.loesche(ueberSchluessel(id, ziel));   // the hand moved it: the shown value is the hand value from here
        zeigeWerte(el, { ...spur(), [feld]: v });
        // task 9: an armed track records the gesture; the mouse holds the field (pointerdown until an end event), else it is the keyboard
        gesten.wert(id, ziel, v, erzwinge ?? (griff.mausHaelt(k) ? 'maus' : 'tasten'));
        const los = () => aendernSpur(`${feld === 'fader_db' ? 'Volume' : 'Pan'} ${spur().name}`, { [feld]: v }, k, { wiederhole: true });   // a hand value: written again once if a server take took the revision
        const warten = anfragen.get(ziel);
        if (warten) warten.then((ok) => { if (ok) los(); }); else los();
      };
      r.addEventListener('pointerdown', () => { abgelehnt.delete(ziel); griff.mausAn(k); greife(ziel); });
      // the keyboard is a grip until GESTE_RUHE_MS without a key: the base-value writeback must not snap the thumb back between key and project reload
      r.addEventListener('keydown', (e) => { if (reglerTaste(e)) { if (feld === 'fader_db') tasteMerke(r, e.key); abgelehnt.delete(ziel); griff.tasteAn(k, jetzt()); greife(ziel); } });
      r.addEventListener('input', () => sende());
      for (const ende of ['change', 'pointerup', 'pointercancel', 'lostpointercapture']) {
        r.addEventListener(ende, () => { griff.mausAus(k); if (ende !== 'change') gesten.ende(id, ziel, 'maus'); });   // D13: a change event is also a key; it ends no mouse gesture
      }
      r.addEventListener('dblclick', () => { r.value = String(feld === 'fader_db' ? reglerVonDb(vorgabe) : vorgabe); sende('maus'); gesten.ende(id, ziel, 'maus'); griff.ende(k); });
    }
    const name = q('.p-spurname');
    const umbenennen = () => {
      const ein = document.createElement('input');
      ein.className = 'p-namefeld'; ein.value = spur().name; ein.maxLength = 40; ein.setAttribute('aria-label', 'Track name');
      name.replaceWith(ein); ein.focus(); ein.select();
      let fertig = false;
      const ende = (uebernehmen, zurueckAnName) => {
        if (fertig) return; fertig = true;
        ein.replaceWith(name);
        if (zurueckAnName) name.focus();      // per Tastatur begonnen: der Fokus kehrt an den Namen zurück
        const neu = ein.value.trim();
        if (uebernehmen && neu && neu !== spur().name) aendernSpur('Rename track', { name: neu });
      };
      ein.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ende(true, true); if (e.key === 'Escape') ende(false, true); });
      ein.addEventListener('blur', () => ende(false, false));
    };
    name.addEventListener('click', (e) => { if (e.ctrlKey || e.shiftKey || e.metaKey) { e.preventDefault(); wahlUmschalten([id], e); } });   // D5: Ctrl/Shift+click selects the track
    name.addEventListener('dblclick', umbenennen);
    name.addEventListener('keydown', (e) => { if (istUmbenennenTaste(e)) { e.preventDefault(); e.stopPropagation(); umbenennen(); } });
    return el;
  }

  function baueLane(id) {
    const el = document.createElement('div');
    el.className = 'p-lanenkopf';
    el.dataset.lanenSpur = id;
    el.innerHTML = LANENKOPF;
    // "+ Lane": choosing a free target creates its lane (never by opening the row) and shows it
    el.querySelector('.p-lane-neu').addEventListener('change', (e) => {
      const ziel = e.target.value;
      e.target.value = '';
      if (!ziel) return;
      laneAnlegen(aendere, waehle, id, ziel);
    });
    el.querySelector('.p-lanenwahl').addEventListener('change', (e) => waehle(id, e.target.value));
    el.querySelector('.p-lane-sperre').addEventListener('click', () => sperreUmschalten(aendereAus, id, wahl));
    el.querySelector('.p-lane-zeichnen').addEventListener('click', () => zeichenModus.umschalten());   // 1.12 slice 4 (D1)
    el.querySelector('.p-lane-weg').addEventListener('click', () => {
      const l = gezeigteLane(stand.get(id), wahl(id));
      if (l && !l.gesperrt) aendere(LANEN_TEXT.weg_label, [{ befehl: 'auto_loeschen', lane_id: l.id }]);
    });
    return el;
  }
  const setzeOptionen = (sel, opts) => {   // rebuilt only when the list changes (the open menu of the user stays)
    const schluessel = JSON.stringify(opts);
    if (sel.dataset.optionen === schluessel) return;
    sel.dataset.optionen = schluessel;
    sel.replaceChildren(...opts.map(([wert, text]) => { const o = document.createElement('option'); o.value = wert; o.textContent = text; return o; }));
  };
  function zeigeLane(el, s) {
    const q = (x) => el.querySelector(x), gezeigt = gezeigteLane(s, wahl(s.id)), lanen = s.automation ?? [];
    q('.p-lanentitel').hidden = lanen.length > 0;
    const sel = q('.p-lanenwahl');
    sel.hidden = lanen.length === 0;
    setzeOptionen(sel, lanen.map((l) => [l.ziel, `${zielLabel(l.ziel)}${l.gesperrt ? ' 🔒' : ''}`]));
    if (gezeigt) sel.value = gezeigt.ziel;
    const frei = freieZiele(s), neu = q('.p-lane-neu');
    setzeOptionen(neu, [['', LANEN_TEXT.neu], ...frei.map((z) => [z, zielLabel(z)])]);
    neu.value = '';
    neu.hidden = frei.length === 0;
    const sp = q('.p-lane-sperre'), zu = !!gezeigt?.gesperrt;
    sp.hidden = !gezeigt; sp.classList.toggle('an', zu); sp.setAttribute('aria-pressed', String(zu));
    sp.textContent = zu ? '🔒' : '🔓'; sp.title = zu ? LANEN_TEXT.entsperre : LANEN_TEXT.sperre;
    sp.setAttribute('aria-label', zu ? LANEN_TEXT.entsperre_label : LANEN_TEXT.sperre_label);
    const zn = q('.p-lane-zeichnen');                // 1.12 slice 4 (D1): the draw mode is one page state, shown in every lane head
    zn.hidden = !gezeigt; zn.classList.toggle('an', zeichenModus.an); zn.setAttribute('aria-pressed', String(zeichenModus.an));
    q('.p-lane-weg').hidden = !gezeigt;
    q('.p-lane-weg').disabled = zu;
    el.style.setProperty('--farbe', s.farbe);
  }

  function zeigeWerte(el, s) {
    const q = (x) => el.querySelector(x);
    el.style.setProperty('--farbe', s.farbe);
    q('.p-spurname').textContent = s.name;
    // 1.16 rest U7 (F8): the preset that set the device, and "modified" when the sound moved on; nothing is added for a device without `preset` (golden)
    const pm = s.geraet?.preset ? marke(s.id) : null;
    // plan 1.11 task 17: a plugin track whose host says `fehlt` (plugin file gone, not an instrument) is marked MISSING with the reason as the tooltip
    const ih = s.geraet?.plugin ? instrumente().find((x) => x.spur_id === s.id) : null;
    const fehlt = ih && ih.status === 'fehlt';
    q('.p-geraet').textContent = geraetText(s) + (pm ? ` · ${pm.text}` : '') + (s.freeze ? ' · FROZEN' : '') + (fehlt ? ' · MISSING' : '');
    const ge = q('.p-geraet');
    el.classList.toggle('fehlt', !!fehlt);
    if (fehlt) ge.title = `The plugin cannot be used: ${ih.grund ?? 'not loadable'}`;
    else if (pm) ge.title = pm.titel; else if (ge.title) ge.removeAttribute('title');   // only touch the attribute when a mark put it there (golden: no title attribute appears)
    el.classList.toggle('auto', faderLane(s) !== null);          // AUTO in front of the fader value (CSS): a volume line controls this fader
    el.classList.toggle('auto-pan', laneFuer(s, 'pan') !== null);   // and in front of the pan value
    // 1.12 S3: the hand has the field, the lane waits (orange): the head (regulators) or the button (M, S)
    for (const [z, d] of Object.entries(UEBER_ZIELE)) {
      const an = istUebersteuert(ueber(), s.id, z);
      if (d.art === 'regler') el.classList.toggle(`ueber-${z}`, an); else q(d.knopf).classList.toggle('ueber', an);
    }
    const eing = (z) => frost.hole(ueberSchluessel(s.id, z), istUebersteuert(ueber(), s.id, z), jetzt());   // the frozen grip value, if any
    const la = q('.p-lane'), an = offen().has(s.id);
    la.classList.toggle('an', an); la.setAttribute('aria-pressed', String(an)); la.setAttribute('aria-label', spurLabels(s.name).lane);
    la.classList.toggle('hat', (s.automation ?? []).length > 0);
    // 1.14: T shows the take rows of an audio track that has takes; the class makes room for it beside the level meter (CSS)
    const tk = q('.p-take'), hat = hatTakes(s), tan = hat && takeOffen().has(s.id);
    tk.hidden = !hat; el.classList.toggle('hat-takes', hat);
    tk.classList.toggle('an', tan); tk.setAttribute('aria-pressed', String(tan)); tk.setAttribute('aria-label', `Take lanes ${s.name}`);
    for (const [z, d] of ziele('knopf')) { const an = knopfZustand(s, z, eing(z)); q(d.knopf).classList.toggle('an', an); q(d.knopf).setAttribute('aria-pressed', String(an)); }
    for (const [z, d] of ziele('regler')) {   // thumb and text: the frozen grip value, else the base value; the hand's own thumb is left alone
      const v = eing(z) ?? d.basis(s);
      if (!griff.haelt(`${s.id}:${d.feld}`, jetzt())) setzeRegler(q(d.regler), d.daumen(v));
      q(d.anzeige).textContent = d.text(v);
    }
    const sel = q('.p-ausgang'), opts = ausgangOptionen({ gruppen: gruppenStand }), schluessel = JSON.stringify(opts);
    if (sel.dataset.optionen !== schluessel) {   // die Auswahl wird nur neu gebaut, wenn sich die Gruppen ändern
      sel.dataset.optionen = schluessel;
      sel.replaceChildren(...opts.map((o) => { const e = document.createElement('option'); e.value = o.wert; e.textContent = o.text; return e; }));
    }
    sel.value = ausgangWert(s);
    sel.setAttribute('aria-label', `Output ${s.name}`);
    const L = spurLabels(s.name);
    for (const [k, v] of [['.p-mute', L.mute], ['.p-solo', L.solo], ['.p-hoch', L.hoch], ['.p-runter', L.runter], ['.p-farbe', L.farbe],
      ['.p-loeschen', L.loeschen], ['.p-spurname', L.umbenennen], ['.p-fader', L.fader], ['.p-pan', L.pan]]) q(k).setAttribute('aria-label', v);
    const z = armZustand(s);
    for (const k of ['.p-arm', '.p-eingang']) q(k).hidden = !z.sichtbar;
    q('.p-arm').classList.toggle('an', z.scharf); q('.p-arm').setAttribute('aria-pressed', String(z.scharf)); q('.p-arm').disabled = z.armSperre && !z.scharf;
    q('.p-arm').setAttribute('aria-label', `Arm ${s.name} for recording`);
    const eingSel = q('.p-eingang'), eingOpts = eingangsOptionen(geraete(), EINGANG_OPTIONEN, z.eingang, s.art), eingSchluessel = JSON.stringify(eingOpts);
    if (eingSel.dataset.optionen !== eingSchluessel) {   // rebuilt only when the devices or the held input change
      eingSel.dataset.optionen = eingSchluessel;
      eingSel.replaceChildren(...[{ wert: '', text: 'input' }, ...eingOpts].map((o) => { const e = document.createElement('option'); e.value = o.wert; e.textContent = o.text; return e; }));
    }
    eingSel.value = z.eingang; eingSel.disabled = !z.sichtbar; eingSel.setAttribute('aria-label', `Recording input of ${s.name}`);
    q('.p-modus').hidden = !z.modusSichtbar; q('.p-modus').value = z.modus; q('.p-modus').disabled = !z.modusSichtbar; q('.p-modus').setAttribute('aria-label', L.modus);
    el.classList.toggle('extern', z.monitorSichtbar);   // the head makes room for the monitor buttons and the input level bar (production.css)
    q('.p-monitor').hidden = !z.monitorSichtbar; q('.p-monitor').setAttribute('aria-label', L.monitor);
    for (const b of el.querySelectorAll('.p-mon')) {
      b.setAttribute('aria-pressed', String(b.dataset.mon === z.monitor)); b.classList.toggle('an', b.dataset.mon === z.monitor);
      b.setAttribute('aria-label', `${L.monitor}: ${b.dataset.mon === 'ein' ? 'in' : b.dataset.mon === 'aus' ? 'off' : 'auto'}`);
    }
    q('.p-eingpegel').hidden = !z.monitorSichtbar; q('.p-eingpegel').dataset.kanal = z.eingangKanal;
    q('.p-eingpegel').setAttribute('aria-label', z.monitorSichtbar ? `Level of the input of ${s.name}` : '');
    q('.p-pegel').dataset.kanal = `spur/${s.nr}`;
    const i = reihenfolge.indexOf(s.id);
    q('.p-hoch').disabled = zielIndex(reihenfolge.length, i, 'hoch') === null;
    q('.p-runter').disabled = zielIndex(reihenfolge.length, i, 'runter') === null;
  }

  return {
    element: (id) => els.get(id),
    // the selection changed (st.spurWahl): classes only, no rebuild of the heads
    zeigeWahl() {
      const w = spurWahl();
      for (const [id, el] of els) el.classList.toggle('gewaehlt', w.has(id));
      for (const [id, ge] of gruppenEls) ge.classList.toggle('gewaehlt', gruppeGewaehlt(id));
    },
    eingefroren: (id, ziel) => frost.hole(ueberSchluessel(id, ziel), istUebersteuert(ueber(), id, ziel), jetzt()),
    haelt: (schluessel, t) => griff.haelt(schluessel, t),   // `${spur_id}:${feld}`
    // resolves when no override request of any head is in flight (the write behind it is queued by then)
    anfragenFertig: async () => { for (let i = 0; i < ANFRAGEN_RUNDEN; i++) { const l = [...offeneKopfAnfragen.values()].flatMap((m) => [...m.values()]); if (!l.length) return; await Promise.allSettled(l); } },   // each round awaits the requests of that moment; a grip that starts meanwhile may add a round
    // paints AUTO ● of every head from the arm state of the server ({spuren: [ids]})
    zeigeArm(arm) { for (const [id, el] of els) zeigeArmKnopf(el, istArmiert(arm, id)); },
    zeige(projekt, wechsel = false) {
      if (wechsel) { frost.leere(); griff.leere(); gesten.verwirf(); }   // another project: no stale grip or frozen value (ids like s1 repeat)
      const spuren = projekt?.spuren ?? [];
      gruppenStand = projekt?.gruppen ?? [];
      stand.clear();
      reihenfolge = spuren.map((s) => s.id);
      for (const s of spuren) stand.set(s.id, s);
      for (const [id, el] of els) if (!stand.has(id)) { el.remove(); els.delete(id); frost.loescheSpur(id); griff.loescheSpur(id); offeneKopfAnfragen.delete(id); gesten.verwerfeSpur(id); }
      takeKoepfe?.begin();
      const folge = kopfFolge(projekt ?? { spuren: [], gruppen: [] }, offen(), takeOffen());   // display order, one function (T3)
      const eltern = gruppenEltern(projekt);
      const soll = [], mitLane = new Set(folge.filter((f) => f.art === 'lane').map((f) => f.id)), gebraucht = new Set();
      for (const s of spuren) {
        let el = els.get(s.id);
        if (!el) { el = baue(s.id); els.set(s.id, el); }
        zeigeWerte(el, s);
        zeigeArmKnopf(el, istArmiert(armStandJetzt(), s.id));
        const auf = mitLane.has(s.id);
        let le = laneEls.get(s.id);
        if (auf && !le) { le = baueLane(s.id); laneEls.set(s.id, le); }
        if (!auf && le) { le.remove(); laneEls.delete(s.id); le = null; }
        if (le) zeigeLane(le, s);
      }
      for (const f of folge) {
        if (f.art === 'gruppe') {
          const g = gruppenStand.find((x) => x.id === f.id);
          let ge = gruppenEls.get(f.id);
          if (!ge) { ge = baueGruppenKopf(f.id, gruppenHandler); gruppenEls.set(f.id, ge); }
          zeigeGruppenKopf(ge, g, gruppenKopfZustand(projekt, f.id, offen()), gruppeGewaehlt(f.id),
            { tiefe: f.tiefe, verborgen: f.verborgen, balken: gruppenKette(projekt, f.id, eltern).slice(0, -1).map(gruppeFarbe), optionen: ausgangOptionen(projekt, f.id) });
          gebraucht.add(f.id); soll.push(ge);
        } else if (f.art === 'spur') {
          const el = els.get(f.id);
          el.classList.toggle('p-kopf--mitglied', f.tiefe > 0); el.classList.toggle('p-kopf--verborgen', f.verborgen); el.classList.toggle('p-kopf--tief', f.tiefe > 1);
          if (f.tiefe > 0) {   // only read by .p-kopf--mitglied: indent by depth, one bar per group above
            const kette = gruppenKette(projekt, spurGruppe(projekt, stand.get(f.id)), eltern);
            el.style.setProperty('--gruppenfarbe', gruppeFarbe(kette.at(-1)));
            if (f.tiefe > 1) { el.style.setProperty('--tiefe', String(f.tiefe)); el.style.setProperty('--balken', balkenVerlauf(kette.map(gruppeFarbe))); }   // depth 1: the CSS defaults, the head stays byte-equal
            else { el.style.removeProperty('--tiefe'); el.style.removeProperty('--balken'); }
          }
          el.classList.toggle('gewaehlt', spurWahl().has(f.id));
          soll.push(el);
        } else if (f.art === 'take') soll.push(...takeKoepfe.fuer(stand.get(f.id)));
        else soll.push(laneEls.get(f.id));
      }
      for (const [id, ge] of gruppenEls) if (!gebraucht.has(id)) { ge.remove(); gruppenEls.delete(id); }
      for (const [id, le] of laneEls) if (!stand.has(id)) { le.remove(); laneEls.delete(id); }
      takeKoepfe?.ende();
      soll.forEach((el, i) => { if (behaelter.children[i] !== el) behaelter.insertBefore(el, behaelter.children[i] ?? null); });
    },
  };
}

// Binder für production.js: Köpfe zeigen und Spuren anlegen (Audio, RB-338 intern, Surge in the first free host slot; Spec 2.4, 3.4)
const NEU = {
  'neu-audio': ['Add audio track', { befehl: 'spur_neu', art: 'audio', name: 'Audio' }],
  'neu-rb': ['Add RB-338 track', { befehl: 'spur_neu', art: 'instrument', name: 'RB-338', geraet: { art: 'intern', name: 'rb338', parameter: {} } }],
  'neu-rack': ['Add rack track', { befehl: 'spur_neu', art: 'instrument', name: 'Rack', geraet: { art: 'rack', kette: 0, glieder: [{ id: 'g1', geraet: RB_GLIED_GERAET }] } }],   // 1.9 U7; spur_neu needs the member id
  'neu-surge': ['Add Surge track', { befehl: 'spur_neu', art: 'instrument', name: 'Surge', geraet: { art: 'wirt', name: 'surge' } }],   // no slot: the server takes the first free one (1.9, L10)
};
// 1.9 (L25): "+ KIT" asks the server which kits the kit folder offers (GET /proj/kits) and lets the person pick one; the pick adds the track.
// menue(punkte, x, y) is context_menu.js oeffneMenue (injected in tests). An empty folder and an unreadable answer are said, never silent.
export async function kitMenue(ctx, x, y, menue = oeffneMenue) {
  const r = await ctx.holeGet('/proj/kits');
  if (r.status !== 200 || !Array.isArray(r.j?.kits)) { ctx.melde(ctx.antwortText(r), true); return; }
  if (r.j.kits.length === 0) { ctx.melde('No kit in the kit folder', true); return; }
  menue(r.j.kits.map((k) => ({ text: `${k.name} (${k.klaenge})`,
    aktion: () => ctx.aendere(`Add kit track ${k.name}`, [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit: k.name } }]) })), x, y);
}
export function bindeSpuren(ctx) {
  const { $ } = ctx;
  const { st } = ctx;
  // A button: open or close the lane row of a track. The state lives in the page (st.laneOffen), the row table and the heads follow at once.
  let koepfeRef = null;
  // the end of a gesture waits until the override requests are answered and the writer has drained (the take must not overtake the page's own write)
  // Only what is queued up to now counts: the writes of the NEXT gesture must not hold this end back (else a quick second gesture swallows the first end).
  const warteSchreiben = async () => { await koepfeRef?.anfragenFertig(); await ctx.schreiber?.bisHier?.(); };
  const gesten = neueGesten({ warteSchreiben, vorhanden: (id) => !!st?.projekt?.spuren?.some((x) => x.id === id), armiert: (id) => istArmiert(st?.autoArm, id), senden: async (b) => {
    const r = await ctx.holeJson('/proj/auto/geste', b);
    if (r.status !== 200) ctx.melde(ctx.antwortText(r), true);   // e.g. argument_ungueltig: never silent
  } });
  let aufnahme = null;
  // 1.14 Comping: the audition speaker. One POST per click; the answer is the reason (never silent), then the state is fetched, which carries `vorhoeren`.
  const takeKoepfe = neueTakeKoepfe({ vorhoeren: () => st?.vorhoeren ?? {}, aendere: ctx.aendere, menue: oeffneMenue,
    sende: vorhoerenSenden(ctx) });
  // SSE take_vorhoeren {vorhoeren}: every audition change (also Cypher's hand) lights the speakers without a reload
  ctx.beimEreignis.push((a, f) => {
    if (a !== 'take_vorhoeren' || !f?.vorhoeren || typeof f.vorhoeren !== 'object') return;
    st.vorhoeren = f.vorhoeren; koepfeRef?.zeige(st.projekt);
  });
  // 1.10 T3 (plan D5): track selection for Ctrl+G, page state like laneOffen. Ctrl/Shift+click on a name toggles; a plain click elsewhere or Escape clears.
  st.spurWahl = new Set();
  const wahlGeaendert = () => koepfeRef?.zeigeWahl();
  const wahlLeeren = () => { if (st.spurWahl.size) { st.spurWahl.clear(); wahlGeaendert(); } };
  // ersetzen: a plain click on a group head makes it the whole selection (a second plain click lets go of it); Ctrl/Shift+click toggles
  const wahlUmschalten = (ids, e, ersetzen = false) => {
    const nurDas = st.spurWahl.size === ids.length && ids.every((i) => st.spurWahl.has(i));
    if (ersetzen) st.spurWahl.clear();
    for (const i of ids) { if (ersetzen ? !nurDas : !st.spurWahl.has(i)) st.spurWahl.add(i); else st.spurWahl.delete(i); }
    wahlGeaendert();
  };
  const gruppeFalten = (g) => ctx.aendere(foldLabel(g.name, g.gefaltet), [{ befehl: 'gruppenspur_aendern', gruppe_id: g.id, gefaltet: !g.gefaltet }]);
  // Ctrl+G: ONE gruppenspur_neu with the selection (one undo step). Nothing selected: the hint, no request. A ninth group: the server's reason text, no request.
  ctx.gruppiere = () => {
    const p = st.projekt;
    if (!p) return false;
    const b = gruppeAusWahl(p, [...st.spurWahl]);
    if (!b) {
      const voll = (p.gruppen?.length ?? 0) >= MAX_GRUPPEN && [...st.spurWahl].some((i) => p.spuren.some((x) => x.id === i) || p.gruppen.some((x) => x.id === i));
      ctx.melde(voll ? ctx.fehlerText({ j: { fehler: 'routing_grenze' } }) : 'Select tracks first (Ctrl+click on the names)', voll);
      return false;
    }
    st.spurWahl.clear(); wahlGeaendert();
    ctx.aendere('Group tracks', [b]);
    return true;
  };
  const koepfe = bindeKoepfe($('koepfe'), { instrumente: () => st?.instrumente ?? [], aendere: ctx.aendere, spurWahl: () => st.spurWahl, wahlUmschalten, gruppeFalten, aendereAus: ctx.aendereAus, offen: () => st?.laneOffen ?? new Set(),
    takeOffen: () => st?.takeOffen ?? new Set(), takeKoepfe, rackOeffnen: (id) => ctx.rackOeffnen?.(id), geraetOeffnen: (id) => ctx.geraetOeffnen?.(id),
    takesUmschalten: (id) => { if (st.takeOffen.has(id)) st.takeOffen.delete(id); else st.takeOffen.add(id); ctx.layoutNeu(); koepfe.zeige(st.projekt); },
    gesten, armiere: (id, an) => aufnahme.armiere(id, an), armStandJetzt: () => st?.autoArm,
    ueber: () => st?.autoUeber ?? [], kopfBeat: () => st?.kopfBeat, marke: (id) => ctx.presetMarke?.('spur', id) ?? null, geraete: () => st?.geraete ?? null,
    // D4: the server sends /k/arr/auto an 0; the state comes back through /e/auto, orange follows the server list only (D5, D8)
    uebersteuere: async (a) => {
      const r = await ctx.holeJson('/proj/auto/uebersteuern', a);
      if (r.status !== 200) ctx.melde(ctx.antwortText(r), true);   // the reason (FEHLER_TEXT) of a refusal; the caller decides about the write (ueberErgebnis)
      return r.status;
    },
    wahl: (id) => st?.laneZiel?.get(id), waehle: (id, ziel) => { st.laneZiel.set(id, ziel); ctx.layoutNeu(); koepfe.zeige(st.projekt); },
    umschalten: (id) => {
      if (st.laneOffen.has(id)) st.laneOffen.delete(id); else st.laneOffen.add(id);
      ctx.layoutNeu();
      koepfe.zeige(st.projekt);
    } });
  koepfeRef = koepfe;
  ctx.beiGeraete?.push(() => koepfe.zeige(st.projekt));   // 1.8 S2b: the device list changed (GET /geraete): the input selects follow
  ctx.beimMarken?.push(() => koepfe.zeige(st.projekt));   // 1.16 rest U7: a preset mark arrived or changed
  aufnahme = bindeAutoAufnahme(ctx, koepfe, gesten);
  // D11: while the transport runs, a track with a fader or pan lane shows the lane value at the playhead in the fader or pan value (AUTO stands in front of it,
  // CSS) and 1.12 S3 task 5: the thumb of the regulator follows the same value (laneWert, the function of the text), M and S follow it as buttons. A field the
  // hand overrides, or a regulator the hand holds, keeps its value. When the transport stops, the lane is gone or the field is overridden, the base value
  // (or the frozen grip value) is written back. Fix round 2 (I1, M5): the entries (track, target, lane points, element refs) are built once per project
  // object, a frame allocates nothing per field, and a control is written only when its value changed (setzeRegler compares the snapped value).
  const setzeKnopf = (k, an) => { if (k.classList.contains('an') !== an) { k.classList.toggle('an', an); k.setAttribute('aria-pressed', String(an)); } };
  let projektStand = null, eintraege = [], lebende = 0;
  const baueEintraege = (p) => {
    const e = [];
    for (const sp of p?.spuren ?? []) {
      const el = koepfe.element(sp.id);
      if (!el) continue;
      for (const [ziel, d] of Object.entries(UEBER_ZIELE)) {
        const lane = laneFuer(sp, ziel);
        if (lane) e.push({ s: sp, id: sp.id, ziel, d, punkte: lane.punkte, gk: `${sp.id}:${d.feld}`, lebt: false, zuletzt: undefined,
          ausgabe: d.anzeige ? el.querySelector(d.anzeige) : null, regler: d.regler ? el.querySelector(d.regler) : null, knopf: d.knopf ? el.querySelector(d.knopf) : null });
      }
    }
    return e;
  };
  // the field no longer follows its lane: write what it shows now (the frozen grip value of a grip beat, else the base value)
  const beende = (e, t) => {
    e.lebt = false; e.zuletzt = undefined; lebende--;
    const fr = koepfe.eingefroren(e.id, e.ziel);
    if (e.knopf) { setzeKnopf(e.knopf, knopfZustand({ [e.ziel]: e.d.basis(e.s) }, e.ziel, fr)); return; }
    const v = fr ?? e.d.basis(e.s);
    e.ausgabe.textContent = e.d.text(v);
    if (!koepfe.haelt(e.gk, t)) setzeRegler(e.regler, e.d.daumen(v));
  };
  const ring = [];
  if (typeof window !== 'undefined') window.djkProdSpurBild = ring;   // ms per frame of this hook, like window.djkProdBild (read by check/probe_frame.mjs)
  ctx.beimBild.push(() => {
    const p = st.projekt, spielt = !!p && st.kopfBeat !== null && st.kopfBeat !== undefined;
    if (p !== projektStand) {   // another project object: the old entries are void (koepfe.zeige has just written the base values of the new one)
      projektStand = p; lebende = 0; eintraege = p ? baueEintraege(p) : [];
    }
    if (!spielt && lebende === 0) return;
    const t0 = performance.now(), beat = st.kopfBeat, liste = st.autoUeber;
    for (let i = 0; i < eintraege.length; i++) {
      const e = eintraege[i];
      if (!spielt || istUebersteuert(liste, e.id, e.ziel)) { if (e.lebt) beende(e, t0); continue; }
      if (!e.lebt) { e.lebt = true; lebende++; }
      const roh = laneWert(e.punkte, beat, e.ziel);
      if (e.knopf) { setzeKnopf(e.knopf, roh >= 0.5); continue; }
      if (koepfe.haelt(e.gk, t0)) { e.zuletzt = undefined; continue; }   // the hand holds it: the next frame after the release writes again
      if (roh === e.zuletzt) continue;
      e.zuletzt = roh;
      const t = e.d.text(roh);
      if (e.ausgabe.textContent !== t) e.ausgabe.textContent = t;
      setzeRegler(e.regler, e.d.daumen(roh));
    }
    ring.push(performance.now() - t0); if (ring.length > 600) ring.shift();
  });
  for (const [knopf, [label, befehl]] of Object.entries(NEU)) $(knopf).addEventListener('click', () => ctx.aendere(label, [befehl]));
  $('neu-kit').addEventListener('click', (e) => {
    const r = typeof e?.currentTarget?.getBoundingClientRect === 'function' ? e.currentTarget.getBoundingClientRect() : null;
    kitMenue(ctx, r ? r.left : (e?.clientX ?? 0), r ? r.bottom : (e?.clientY ?? 0));
  });
  // right click on a track head: the shared head menu (context_menu.js KOPF_MENUE); no entry applies: the browser menu stays
  $('koepfe').addEventListener('contextmenu', (e) => {
    const kopf = e.target?.closest?.('.p-kopf[data-spur]');
    const strang = kopf ? st.projekt?.spuren.find((x) => x.id === kopf.dataset.spur) : null;
    if (strang) kopfMenueAuf(ctx, e, strang);
  });
  ctx.wahlLeeren = wahlLeeren;   // production.js: a plain click elsewhere and Escape clear the selection
  ctx.beimProjekt.push((p, wechsel) => {
    const n = p?.spuren.length ?? 0;
    if (st.spurWahl.size) { const da = new Set([...(p?.spuren ?? []), ...(p?.gruppen ?? [])].map((x) => x.id)); /* track ids and group-head ids */ for (const i of [...st.spurWahl]) if (wechsel || !da.has(i)) st.spurWahl.delete(i); }
    $('neu-audio').disabled = $('neu-rb').disabled = !p || n >= MAX_SPUREN;
    $('neu-surge').disabled = !p || n >= MAX_SPUREN || wirtBelegt(p.spuren) >= WIRT_SLOTS;   // tracks plus rack members (Review Focus 1)
    $('neu-kit').disabled = !p || n >= MAX_SPUREN || kitBelegt(p.spuren) >= MAX_KIT_GERAETE;   // tracks plus rack members
    $('neu-rack').disabled = !p || n >= MAX_SPUREN || rackBelegt(p.spuren) >= MAX_RACK_GERAETE;
    koepfe.zeige(p, wechsel);
  });
}
