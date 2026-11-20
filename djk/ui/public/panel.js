// Front panels: renderer for the panel description "cypherdj-panel/2" (see graphs.ts, ladePanel; v1 files arrive normalised).
// The panel binds controls to parameter names (a bk device: k<n> = the graph's knob n); range and scaling come from the graph's `regler`
// nodes (panel_skala.js). The place the device sits on is reached through an adapter:
// { get(param) -> 0..1 | undefined, set(param, k), lernPfad?(param) -> control path }.
// Pure helpers first (tested without a browser in tests/panel.test.mjs), then the DOM renderer baueFrontplatte.
import { AKZENTE } from './panel_kopf.js';
import { spektrumFlaeche } from './spectrum.js';
import { anzeigeText, anzeigeWert, zeitInSekunden } from './panel_display.js';
import { huellPunkte, lfoPunkte, filterPunkte, cutoffX, nullDbY, wtRahmen, wtGewarpt, wtLage, wtLinie, wtNull, wtTiefe } from './panel_curves.js';
import { GLYPHEN_PFAD } from './panel_glyphen.js';
import { skaliere, diskretWert, diskretIndex, formatiereWert, klemme01 } from './panel_skala.js';
import { ruhendeSteuerungen } from './panel_wirkung.js';

const WIE_BEI_REGLERN = 0.5;   // the control table starts every knob at 0.5 (core/signalbox/src/controls.cpp)

/** Every control of the panel in reading order, with the section it sits in: [{...control, sektion}]. */
export function steuerungen(panel) {
  return (panel?.sections ?? []).flatMap((s) => (s.controls ?? []).map((c) => ({ ...c, sektion: s.id })));
}

/** The parameter names a control writes: knob/fader/switch/selector one, xy two (x, y), the rest none (a `matrix` writes pins through the adapter, no parameter). */
export function parameterVon(c) {
  const ok = (p) => typeof p === 'string' && p !== '';
  if (c.type === 'xy') return [c.bind?.x?.param, c.bind?.y?.param].filter(ok);
  if (c.type === 'touchpad') return [c.bind?.x?.param, c.bind?.touch?.param].filter(ok);
  return ['knob', 'fader', 'switch', 'selector', 'lever'].includes(c.type) && ok(c.bind?.param) ? [c.bind.param] : [];
}

/** Whether a switch reads on at knob position k. A switch is on from 0.5 up; one with `mitte_aus` is on only above 0.5, for engines that read the 0.5 fill
 *  of a fresh insert stage as off. */
export function schalterAn(c, k) { return c.mitte_aus ? k > 0.5 : k >= 0.5; }

/** Range {min, max, log} of a parameter from the graph's `regler` answer ({"<knob nr>": range}): bk parameter k<n> looks up "<n>". */
export function bereichVon(regler, param) {
  const m = /^k(\d+)$/.exec(param ?? '');
  return m ? regler?.[m[1]] : undefined;
}

/** Normalised start value of a control (its own `default`, else the table's 0.5). Selector defaults are option indices. */
export function vorgabeK(c) {
  if (c.type === 'selector') return diskretWert(typeof c.default === 'number' ? c.default : 0, (c.options ?? []).length);
  if (c.type === 'lever') return WIE_BEI_REGLERN;   // the spring returns it to the middle
  if (c.type === 'switch') return c.default === 1 ? 1 : typeof c.default === 'number' ? 0 : WIE_BEI_REGLERN;
  return typeof c.default === 'number' ? klemme01(c.default) : WIE_BEI_REGLERN;
}
function vorgabeXY(c) {
  const d = typeof c.default === 'object' && c.default ? c.default : {};
  return { x: typeof d.x === 'number' ? klemme01(d.x) : WIE_BEI_REGLERN, y: typeof d.y === 'number' ? klemme01(d.y) : WIE_BEI_REGLERN };
}

function vorgabeX(c) { return typeof c.default?.x === 'number' ? klemme01(c.default.x) : WIE_BEI_REGLERN; }   // touchpad: x start; touch always starts at 0

// Lever geometry: the travel from rest (k 0.5) to fully pulled (k 1) has three sections; the sound core reads them with these limits
// (below 5 % of the travel: rest, then section 1, 2, 3).
export const HEBEL_GRENZEN = [0.05, 0.37, 0.68];
/** Travel 0..1 of a lever at k. */
export const hebelWeg = (k) => klemme01((k - WIE_BEI_REGLERN) / (1 - WIE_BEI_REGLERN));
/** Section of a travel: -1 at rest, else 0, 1 or 2. */
export function hebelBereich(w) { return w < HEBEL_GRENZEN[0] ? -1 : w < HEBEL_GRENZEN[1] ? 0 : w < HEBEL_GRENZEN[2] ? 1 : 2; }
/** Zone index (0..n-1) of a touchpad position x; n zones of equal width. */
export const feldZone = (x, n) => Math.min(n - 1, Math.max(0, Math.floor(klemme01(x) * n)));

// Patch field (control `matrix`, Kraken): a pin is [satz, zeile, spalte, wert] (satz 0 = A, 1 = B, wert -1..1, 0 = no pin; steckfeld.ts holds the rules).
export const STIFT_N = 16;
export const STIFT_KLICK = 0.5;     // a click on an empty cell sets this amount
export const STIFT_ZIEH_PX = 90;    // vertical drag: pixels for an amount of 1 (five times as many with shift or a resting finger)
export const STIFT_RAD = 0.05;      // one wheel notch (0.01 with shift)
/** Amount of the pin at (satz, zeile, spalte) in a list of pins; 0 when there is none. */
export function stiftWert(liste, satz, zeile, spalte) {
  for (const e of liste ?? []) if (e[0] === satz && e[1] === zeile && e[2] === spalte) return e[3];
  return 0;
}
/** An amount as a pin takes it: clamped to -1..1 and rounded to 0.01 (so a drag back to the middle lands on exactly 0 = no pin). */
export function stiftRunde(v) {
  if (!Number.isFinite(v)) return 0;
  const r = Math.round(Math.max(-1, Math.min(1, v)) * 100) / 100;
  return r === 0 ? 0 : r;   // no -0
}
/** Size of a pin dot as a share of the cell: 0.3 for a hair of amount up to 1 at full amount. */
export const stiftGroesse = (w) => (w === 0 ? 0 : 0.3 + 0.7 * Math.min(1, Math.abs(w)));
/** The plain sentence of a pin: `Func 1 moves Cutoff: +0.50 (up to +20 st)`. `bereich` = {wert, einheit}: the value of the destination at pin amount 1 (of.bereiche).
 *  The unit `gain` marks an audio destination (`feeds`), every other unit a control (`moves`). Without a range the short form of stiftText. */
export function stiftSatz(quelle, ziel, w, bereich) {
  if (!bereich || !Number.isFinite(bereich.wert)) return stiftText(quelle, ziel, w);
  const audio = bereich.einheit === 'gain';
  if (w === 0) return `${quelle} ${audio ? 'does not feed' : 'does not move'} ${ziel}`;
  const grenze = w * bereich.wert;
  return `${quelle} ${audio ? 'feeds' : 'moves'} ${ziel}: ${w > 0 ? '+' : '-'}${Math.abs(w).toFixed(2)} (${w > 0 ? 'up' : 'down'} to ${grenze < 0 ? '-' : '+'}${Math.abs(grenze).toFixed(1)} ${bereich.einheit})`;
}
/** One colour per source row of the patch field (16, distinguishable on the dark plate): jack and cable. */
export const KABEL_FARBEN = ['#ff5d5d', '#ff8f3d', '#ffc933', '#d4e157', '#7ddc5a', '#3ddc97', '#2fd6c3', '#4fc3f7', '#5b9bff', '#8c7bff', '#b48cff', '#e08cff', '#ff6fb5', '#c9a27a', '#e8e8e8', '#9aa4b5'];
/** Readout of one cell: "<row> > <column> <amount>", the amount signed with two decimals, "off" without a pin. */
export function stiftText(zeile, spalte, w) { return `${zeile} > ${spalte} ${w === 0 ? 'off' : `${w > 0 ? '+' : '-'}${Math.abs(w).toFixed(2)}`}`; }

/** {param: k} of the controls that state a default: what the page pushes after it loads the graph (knobs first, then the graph). */
export function vorgaben(panel) {
  const aus = {};
  for (const c of steuerungen(panel)) {
    if (c.type === 'xy') {
      if (c.default === undefined) continue;
      const v = vorgabeXY(c);
      const [px, py] = [c.bind?.x?.param, c.bind?.y?.param];
      if (px) aus[px] = v.x;
      if (py) aus[py] = v.y;
    } else if (c.type === 'touchpad') {
      const [px, pt] = parameterVon(c);
      if (px !== undefined) aus[px] = vorgabeX(c);
      if (pt !== undefined) aus[pt] = 0;
    } else if (c.default !== undefined && parameterVon(c).length) aus[parameterVon(c)[0]] = vorgabeK(c);
  }
  return aus;
}

/** Readout of one parameter value k (0..1) for a control; `regler` = {"<knob nr>": {min, max, log}} from the graph. Without a range: percent of travel. */
export function wertText(c, param, k, regler, parameter) {
  if (c.type === 'selector') return c.options?.[diskretIndex(k, c.options.length)] ?? '-';
  if (c.type === 'switch') return schalterAn(c, k) ? 'ON' : 'OFF';
  const p = parameter?.[param];   // a device parameter (RB-338, Surge): the units come from its table entry
  if (p) return anzeigeText(p, k);
  const b = bereichVon(regler, param);
  if (!b) return formatiereWert(k, 'percent');
  return formatiereWert(skaliere(k, b), c.format, c.unit);
}

/** Keyboard step of a focused control: arrows 0.01, shift 0.001, page keys ten times as much; Home/End jump. null: not a step key. */
export function tastenSchritt(taste, shift) {
  const fein = shift ? 0.001 : 0.01;
  switch (taste) {
    case 'ArrowUp': case 'ArrowRight': return { schritt: fein };
    case 'ArrowDown': case 'ArrowLeft': return { schritt: -fein };
    case 'PageUp': return { schritt: fein * 10 };
    case 'PageDown': return { schritt: -fein * 10 };
    case 'Home': return { auf: 0 };
    case 'End': return { auf: 1 };
    default: return null;
  }
}

// Knob geometry: a 270 degree sweep, 0 at the lower left (135 degrees on a clockwise screen circle), 1 at the lower right.
export const KNOB_START = 135, KNOB_BOGEN = 270;
export const knobWinkel = (k) => KNOB_START + KNOB_BOGEN * klemme01(k);
const punkt = (cx, cy, r, grad) => [cx + r * Math.cos((grad * Math.PI) / 180), cy + r * Math.sin((grad * Math.PI) / 180)];
/** SVG path of the arc between two angles (clockwise); '' for an empty arc. */
export function bogenPfad(cx, cy, r, a0, a1) {
  if (!(a1 - a0 > 0.01)) return '';
  const [x0, y0] = punkt(cx, cy, r, a0), [x1, y1] = punkt(cx, cy, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const SVG = 'http://www.w3.org/2000/svg';
const SKALA_STRICHE = 11;   // default ticks of a knob on the device page
const REGLER_FEIN = 5;   // shift or a resting finger: five times finer
const TIPP_MS = 300, TIPP_PX = 10, TIPP_ZWEI_MS = 350;   // a tap, and the gap of a double tap (touch)
const RUHEND_MS = 30000;   // a resting finger nobody has heard from for this long is gone (its pointerup may have been lost)
const STEHEN_MS = 3000;   // a gesture that has not moved or ended for this long is stuck (a lost pointerup)
const RAD_MS = 300;      // the wheel has no end event: after this idle time the gesture counts as over (adapter.ende)
const SPERRE_MS = 400;   // after the last own movement incoming values wait this long (the echo of our own value arrives late)

/** Build the panel into `host`. opt: { panel, regler, adapter, dokument?, umschalter?: {text, beiKlick}, kopf?: (element, {lernen}) => void,
 *  breit?: boolean: the device page. Modules sit side by side in their rows and every knob without `scale` gets 11 ticks; without it the
 *  modules of a layout stack in one column and a scale is drawn only where the file asks for one.
 *  lernen?: {an, wartet, gelernt: Set<path>}, beiLernen?(pfad), beiVergessen?(pfad), beiSeite?(id): the page (tab) that is shown, told at build and at every switch }.
 *  MIDI learn: with `lernen.an` (and an adapter that has lernPfad) a click on a control calls beiLernen(adapter.lernPfad(param)) instead of moving it,
 *  a right click calls beiVergessen(pfad). A control addresses ONE path: for xy that is the x parameter. Cells carry `fp-gelernt` (path assigned) and
 *  `fp-wartet` (path armed). `kopf` hears {lernen: bool}: whether the header should offer a LEARN toggle.
 *  adapter.gesperrt?.(param) === true greys the control (class fp-gesperrt, aria-disabled) and blocks input; the shown value is adapter.get(param), refreshed by aktualisiere().
 *  adapter.ende?.() is called at the end of a gesture (pointer up, key up, wheel idle after `radMs` = 300, click, double click): one place to send what the gesture set.
 *  steckfeld?: {zeilen, spalten, stifte} (GET /geraete/panel): the labels and default pins for a `matrix` control. The pins themselves come from the adapter:
 *  stifte() -> [[satz, zeile, spalte, wert]], stiftSetzen(satz, zeile, spalte, wert) (live, per move), stiftEnde() (end of the gesture), stifteSetzen(satz, liste) (a whole set).
 *  An adapter without them shows the defaults greyed.
 *  A page with `all: true` (pages of the panel file) shows every section at once, but only in a `breit` host (a narrow host keeps the other pages). With it the
 *  `matrix` control (`of.quellen`: the section of each of the 16 rows, `of.ziele`: the control or section of each of the 16 columns, `of.bereiche`: {wert, einheit}
 *  of each column at pin amount 1) gets jacks on the sections and an SVG overlay of cables next to the faceplate (class fp-kabelsvg, a sibling in `host`, host-relative
 *  geometry); the CABLES button in the tool row hides it. The readout of the field is a sentence where `bereiche` knows the column (stiftSatz).
 *  Returns { aktualisiere(), werte(), setzeLernen(stand), zeigeSeite(id), zerstoere() }: aktualisiere() pulls the adapter's values (skipping controls that are dragged or were
 *  just moved); werte() returns {param: k} as shown. */
export function baueFrontplatte(host, opt) {
  const d = opt.dokument ?? globalThis.document;
  const { panel, regler, adapter } = opt;
  const parameter = opt.parameter;   // { param: Parameter entry } of GET /geraete/panel (panel_display.js): readouts in real units for non-bk devices
  const k = {};                 // param -> 0..1 as shown
  const gesperrt = {};          // param -> timestamp until which incoming values are ignored (Infinity while dragged)
  const zeiger = [];            // redraw callbacks
  const el = (tag, klasse, text, ns) => {
    const e = ns ? d.createElementNS(SVG, tag) : d.createElement(tag);
    if (klasse) e.setAttribute('class', klasse);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const jetzt = () => Date.now();
  const kannLernen = typeof adapter.lernPfad === 'function' && typeof opt.beiLernen === 'function';
  let lern = { an: !!opt.lernen?.an, wartet: opt.lernen?.wartet ?? null, gelernt: opt.lernen?.gelernt ?? new Set() };
  const lernAn = () => kannLernen && lern.an;
  const markiert = [];          // [{ zelle, nr }]: the cells that carry learn markers
  const alle = steuerungen(panel);
  for (const c of alle) for (const n of parameterVon(c)) k[n] = adapter.get(n) ?? (c.type === 'xy' ? vorgabeXY(c)[n === c.bind.x.param ? 'x' : 'y'] : c.type === 'touchpad' ? (n === c.bind.x.param ? vorgabeX(c) : 0) : vorgabeK(c));
  for (const n of Object.keys(k)) k[n] = klemme01(k[n]);

  const mitWirkung = alle.some((c) => c.wirkt);
  const wirkZellen = new Map();   // control id -> cell, for the controls with `wirkt` (panel_wirkung.js)
  const zeigeWirkung = () => {
    if (!mitWirkung) return;
    const ruht = ruhendeSteuerungen(alle, k);
    for (const [id, zelle] of wirkZellen) {
      const text = ruht[id] ?? null;
      zelle.classList.toggle('fp-ruht', text !== null);
      if (text !== null) zelle.setAttribute('title', text); else zelle.removeAttribute('title');
    }
  };
  const zeige = () => {
    for (const f of zeiger) f();
    zeigeWirkung();
    for (const z of sperrZellen) { const an = z.nrs.some(gesperrtP); z.zelle.classList.toggle('fp-gesperrt', an); z.zelle.setAttribute('aria-disabled', String(an)); }
  };
  // a parameter the adapter blocks (a macro drives it): its control is greyed, shows adapter.get() (the macro value) and sends nothing
  const gesperrtP = (nr) => adapter.gesperrt?.(nr) === true;
  const sperrZellen = [];       // [{ zelle, nrs }]: the cells that show the blocked state
  const setze = (nr, v) => {
    if (lernAn() || gesperrtP(nr)) return;   // learn mode and blocked parameters: controls do not move
    const w = klemme01(v);
    gesperrt[nr] = Math.max(gesperrt[nr] ?? 0, jetzt() + SPERRE_MS);
    if (w === k[nr]) return;
    k[nr] = w;
    adapter.set(nr, w);
    zeige();
  };
  // End of a gesture (pointer up, key up, wheel idle, click, double click): an adapter with `ende` gets one call and may send what the gesture collected.
  const fertig = () => { try { adapter.ende?.(); } catch (e) { globalThis.console?.error?.('panel adapter ende:', e); } };
  let radTimer = null;
  const radFertig = () => { if (radTimer !== null) clearTimeout(radTimer); radTimer = setTimeout(() => { radTimer = null; fertig(); }, opt.radMs ?? RAD_MS); };
  const halte = (nr, an) => { gesperrt[nr] = an ? Infinity : jetzt() + SPERRE_MS; };

  // Touch: one gesture per pointer id. A control owns the pointer that went down on it (`besetzt`); a touch that lands anywhere else on the plate and stays down is a
  // resting finger (`ruhend`), and while one rests every moving finger is five times finer (the touch form of Shift). Double tap = the default (TIPP_*).
  const besetzt = new Set(), ruhend = new Map();   // ruhend: pointer id -> last time anything was heard from it
  const fein = () => { const t = jetzt(); for (const [id, z] of ruhend) if (t - z > RUHEND_MS) ruhend.delete(id); return ruhend.size > 0; };
  const hostRunter = (e) => { if (e.pointerType === 'touch' && !besetzt.has(e.pointerId)) ruhend.set(e.pointerId, jetzt()); };
  const hostBewegt = (e) => { if (ruhend.has(e.pointerId)) ruhend.set(e.pointerId, jetzt()); };   // a finger that still moves is alive
  const hostHoch = (e) => { ruhend.delete(e.pointerId); };   // up, cancel, lost capture
  const alleVergessen = () => { ruhend.clear(); };            // tab hidden, window blurred: the ends of these touches may never arrive
  const fensterAus = () => { if (d.hidden) ruhend.clear(); };
  const fenster = d.defaultView ?? d;
  host.addEventListener?.('pointerdown', hostRunter);
  host.addEventListener?.('pointermove', hostBewegt);
  host.addEventListener?.('pointerup', hostHoch);
  host.addEventListener?.('pointercancel', hostHoch);
  host.addEventListener?.('lostpointercapture', hostHoch);
  d.addEventListener?.('visibilitychange', fensterAus);
  fenster.addEventListener?.('blur', alleVergessen);
  const fremder = (st, e) => st !== null && e?.pointerId !== undefined && st.id !== undefined && e.pointerId !== st.id;
  // a tap: short, hardly moved; two within TIPP_ZWEI_MS are a double tap
  const tippErkennung = () => {
    let letzter = 0;
    return (st, e) => {
      if (e?.pointerType !== 'touch' || jetzt() - st.t0 > TIPP_MS || Math.hypot((e.clientX ?? st.sx) - st.sx, (e.clientY ?? st.sy) - st.sy) > TIPP_PX) { letzter = 0; return false; }
      const doppelt = letzter > 0 && jetzt() - letzter <= TIPP_ZWEI_MS;
      letzter = doppelt ? 0 : jetzt();
      return doppelt;
    };
  };

  // One drag gesture for knob and fader: relative, so a grab does not jump; shift or a resting finger turns finer. `px` = pixels for the full range.
  function ziehbar(e0, o) {
    e0.style.touchAction = 'none';
    let st = null, roh = 0;
    const doppelterTipp = tippErkennung();
    e0.addEventListener('pointerdown', (e) => {
      if (lernAn() || gesperrtP(o.nr)) return;
      if (e.button !== undefined && e.button !== 0) return;
      if (st && jetzt() - st.t < STEHEN_MS) { e.preventDefault(); return; }   // a second finger on a control that is in use: no second gesture (a stuck one is dropped after STEHEN_MS)
      e.preventDefault();
      e0.focus?.();
      try { e0.setPointerCapture(e.pointerId); } catch { /* synthetic or lost pointer: the drag still works inside the element */ }
      besetzt.add(e.pointerId);
      st = { x: e.clientX, y: e.clientY, id: e.pointerId, t0: jetzt(), t: jetzt(), sx: e.clientX, sy: e.clientY };
      o.beiStart?.(e);
      roh = k[o.nr];
      halte(o.nr, true);
    });
    e0.addEventListener('pointermove', (e) => {
      if (!st || fremder(st, e)) return;
      const dz = o.achse === 'y' ? st.y - e.clientY : e.clientX - st.x;
      st = { ...st, x: e.clientX, y: e.clientY, t: jetzt() };
      roh += dz / (o.px() * (e.shiftKey || fein() ? REGLER_FEIN : 1));
      setze(o.nr, roh);
    });
    const ende = (e, hoch) => {
      if (!st || fremder(st, e)) return;
      const hin = st;
      st = null; besetzt.delete(hin.id); halte(o.nr, false);
      if (hoch && doppelterTipp(hin, e)) setze(o.nr, o.vorgabe());
      fertig();
    };
    e0.addEventListener('pointerup', (e) => ende(e, true));
    e0.addEventListener('pointercancel', (e) => ende(e, false));
    e0.addEventListener('lostpointercapture', (e) => ende(e, false));
    e0.addEventListener('dblclick', () => { setze(o.nr, o.vorgabe()); fertig(); });
    e0.addEventListener('keyup', (e) => { if (tastenSchritt(e.key, false)) fertig(); });   // only a key the panel handles ends a key gesture
    e0.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = -Math.sign(e.deltaY || e.deltaX);
      if (r) { setze(o.nr, k[o.nr] + r * (e.shiftKey ? 0.001 : 0.01)); radFertig(); }
    }, { passive: false });
    e0.addEventListener('keydown', (e) => {
      const t = tastenSchritt(e.key, e.shiftKey);
      if (!t) return;
      e.preventDefault();
      setze(o.nr, t.auf ?? k[o.nr] + t.schritt);
    });
  }
  const beschrifte = (zelle, c) => { if (c.label) { const n = el('span', 'fp-name', c.label); namenVon.set(zelle, n); zelle.append(n); } };
  const glyphe = (id, text) => {   // a waveform or filter glyph: stroke-only path in the 24 x 12 box of panel_glyphen.js
    const g = el('svg', 'fp-glyphe', undefined, true), p = el('path', null, undefined, true);
    g.setAttribute('viewBox', '0 0 24 12');
    g.setAttribute('role', 'img');
    g.setAttribute('aria-label', text);
    p.setAttribute('d', GLYPHEN_PFAD[id]);
    g.append(p);
    return g;
  };
  const aria = (e0, c, nr) => {
    e0.setAttribute('aria-label', c.label ?? c.id);
    e0.setAttribute('aria-valuemin', '0');
    e0.setAttribute('aria-valuemax', '1');
    zeiger.push(() => {
      e0.setAttribute('aria-valuenow', k[nr].toFixed(3));
      e0.setAttribute('aria-valuetext', wertText(c, nr, k[nr], regler, parameter));
    });
  };

  // Learn mode on one control: a click (no movement) arms learning for the control's path, a right click forgets the assignment.
  const lernHaken = (e0, c) => {   // e0 is the whole cell (.fp-zelle): its label and gaps are targets too; events of the control bubble up to it
    const nr = parameterVon(c)[0];
    if (nr === undefined) return;
    const pfad = () => adapter.lernPfad?.(nr);
    let st = null;
    e0.addEventListener('pointerdown', (e) => { st = lernAn() && (e.button === undefined || e.button === 0) ? { x: e.clientX, y: e.clientY } : null; });
    e0.addEventListener('pointermove', (e) => { if (st && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 3) st = null; });
    e0.addEventListener('pointercancel', () => { st = null; });
    e0.addEventListener('pointerup', () => {
      if (!st) return;
      st = null;
      const p = lernAn() ? pfad() : null;
      if (p) opt.beiLernen(p);
    });
    e0.addEventListener('contextmenu', (e) => {
      if (!lernAn()) return;
      e.preventDefault();
      const p = pfad();
      if (p) opt.beiVergessen?.(p);
    });
  };

  // Scale of a knob, drawn outside the arc: `ticks` evenly spaced marks with the formatted range ends below the two end marks,
  // or `labels` (discrete knob): one mark and one text per step.
  const skala = (c, nr, sc) => {
    const g = el('g', 'fp-skala', undefined, true);
    const n = sc.labels ? sc.labels.length : sc.ticks;
    const marke = (i) => {
      const w = knobWinkel(n <= 1 ? 0 : i / (n - 1));
      const t = el('line', i === 0 || i === n - 1 ? 'fp-tick fp-tick-ende' : 'fp-tick', undefined, true);
      const [x0, y0] = punkt(32, 32, 29.5, w), [x1, y1] = punkt(32, 32, i === 0 || i === n - 1 ? 34.5 : 33, w);
      t.setAttribute('x1', x0.toFixed(2)); t.setAttribute('y1', y0.toFixed(2)); t.setAttribute('x2', x1.toFixed(2)); t.setAttribute('y2', y1.toFixed(2));
      g.append(t);
      return w;
    };
    const text = (w, s, r, anker) => {
      const t = el('text', 'fp-skalatext', s, true), [x, y] = punkt(32, 32, r, w);
      t.setAttribute('x', x.toFixed(2)); t.setAttribute('y', (y + 2.5).toFixed(2)); t.setAttribute('text-anchor', anker ?? (Math.abs(x - 32) < 4 ? 'middle' : x < 32 ? 'end' : 'start'));
      g.append(t);
    };
    for (let i = 0; i < n; i++) {
      const w = marke(i);
      if (sc.labels) text(w, sc.labels[i], 38);
    }
    if (!sc.labels) {   // range ends under the lower end marks of the sweep
      text(knobWinkel(0), wertText(c, nr, 0, regler, parameter), 40, 'middle');
      text(knobWinkel(1), wertText(c, nr, 1, regler, parameter), 40, 'middle');
    }
    return g;
  };

  // ---- drawn displays (huelle, lfoform, filterkurve): geometry in panel_curves.js, values read like the knob readouts ----
  const K_B = 160, K_H = 56, K_RAND = 3;   // viewBox of a drawing and the padding around its curve
  const pfadVon = (p) => p.map(([x, y], i) => `${i ? 'L' : 'M'}${(x + K_RAND).toFixed(1)} ${(y + K_RAND).toFixed(1)}`).join('');
  /** Real value of a display input: a number is a fixed stage; a control id is read like its knob readout (device parameter table, else the graph's range). */
  const echterWert = (ref, rolle) => {
    if (typeof ref === 'number') return ref;
    const q = alle.find((x) => x.id === ref), nr = q ? parameterVon(q)[0] : undefined, kk = nr === undefined ? 0.5 : k[nr];
    const b = bereichVon(regler, nr);
    let w;
    if (parameter?.[nr]) w = anzeigeWert(parameter[nr], kk);
    else if (b) w = skaliere(kk, b);
    else w = rolle === 'zeit' ? 0.01 * 1000 ** kk : rolle === 'hz' ? 20 * 1000 ** kk : kk;   // no range known: a plausible span over the travel
    if (rolle === 'zeit' && (q?.unit === 'ms' || q?.format === 'ms')) w /= 1000;
    if (rolle === 'zeit') w = zeitInSekunden(w, q?.unit ?? parameter?.[nr]?.einheit);   // Surge's EG times are log2 seconds
    return w;
  };
  const kurve = (zelle, titel, label, hoehe = K_H) => {
    zelle.append(el('span', 'fp-name fp-kurventitel', label ?? titel));
    const svg = el('svg', hoehe === K_H ? 'fp-kurve' : 'fp-kurve fp-kurve-hoch', undefined, true);
    svg.setAttribute('viewBox', `0 0 ${K_B} ${hoehe}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', titel);
    const flaeche = el('path', 'fp-kurve-flaeche', undefined, true), linie = el('path', 'fp-kurve-linie', undefined, true);
    svg.append(flaeche, linie);
    zelle.append(svg);
    return { svg, linie, flaeche };
  };
  const aufraeumen = [];       // what zerstoere() lets go of (a running wheel gesture of the patch field)
  const alleSeiteId = (panel.pages ?? []).find((p) => p.all === true && opt.breit)?.id ?? null;   // the page that shows every section (only in a wide host)
  let seite;                   // the page in front (id)
  const zellenVonId = new Map(), titelVon = new Map(), namenVon = new Map();   // control id -> cell, section id -> title element, cell -> its label element (jacks go there)
  let matrixKabel = null;      // set by the matrix control: (aufbau) => void, called once the plate stands; kabelSeite() follows the page
  let kabelSeite = () => {};
  const bauer = {
    knob(c, zelle) {
      const nr = parameterVon(c)[0];
      beschrifte(zelle, c);
      const dreh = el('div', 'fp-knopf');
      dreh.tabIndex = 0;
      dreh.setAttribute('role', 'slider');
      const svg = el('svg', null, undefined, true);
      const sc = c.scale ?? (opt.breit ? { ticks: SKALA_STRICHE } : null);   // the device page scales every knob; the small area only where asked
      svg.setAttribute('viewBox', sc ? '-14 -14 92 92' : '0 0 64 64');   // a scale needs room outside the arc
      svg.setAttribute('aria-hidden', 'true');
      if (sc) dreh.classList.add('fp-skaliert');
      const spur = el('path', 'fp-spur', undefined, true), wert = el('path', 'fp-bogen', undefined, true), kappe = el('circle', 'fp-kappe', undefined, true), strich = el('line', 'fp-strich', undefined, true);
      spur.setAttribute('d', bogenPfad(32, 32, 26, KNOB_START, KNOB_START + KNOB_BOGEN));
      kappe.setAttribute('cx', '32'); kappe.setAttribute('cy', '32'); kappe.setAttribute('r', '19');
      if (sc) svg.append(skala(c, nr, sc));
      svg.append(spur, wert, kappe, strich);
      dreh.append(svg);
      const anzeige = el('output', 'fp-wert');
      zelle.append(dreh, anzeige);
      zeiger.push(() => {
        const w = knobWinkel(k[nr]);
        wert.setAttribute('d', bogenPfad(32, 32, 26, KNOB_START, w));
        const [x0, y0] = punkt(32, 32, 9, w), [x1, y1] = punkt(32, 32, 17, w);
        strich.setAttribute('x1', x0.toFixed(2)); strich.setAttribute('y1', y0.toFixed(2)); strich.setAttribute('x2', x1.toFixed(2)); strich.setAttribute('y2', y1.toFixed(2));
        anzeige.textContent = wertText(c, nr, k[nr], regler, parameter);
      });
      aria(dreh, c, nr);
      lernHaken(zelle, c);
      ziehbar(dreh, { nr, achse: 'y', px: () => 160, vorgabe: () => vorgabeK(c) });
    },
    fader(c, zelle) {
      const nr = parameterVon(c)[0], waagrecht = c.orientation === 'horizontal';
      zelle.classList.add(waagrecht ? 'waagrecht' : 'senkrecht');
      beschrifte(zelle, c);
      const bahn = el('div', 'fp-bahn');
      bahn.tabIndex = 0;
      bahn.setAttribute('role', 'slider');
      bahn.setAttribute('aria-orientation', waagrecht ? 'horizontal' : 'vertical');
      const griff = el('i', 'fp-griff');
      bahn.append(el('i', 'fp-rille'), griff);
      const anzeige = el('output', 'fp-wert');
      zelle.append(bahn, anzeige);
      const laenge = () => (waagrecht ? bahn.getBoundingClientRect().width : bahn.getBoundingClientRect().height) || 100;
      zeiger.push(() => {
        bahn.style.setProperty('--k', String(k[nr]));
        anzeige.textContent = wertText(c, nr, k[nr], regler, parameter);
      });
      aria(bahn, c, nr);
      lernHaken(zelle, c);
      ziehbar(bahn, {
        nr, achse: waagrecht ? 'x' : 'y', px: laenge, vorgabe: () => vorgabeK(c),
        beiStart: (e) => {   // a press on the groove jumps there; a press with shift grabs where it is
          if (e.shiftKey || e.target === griff) return;
          const r = bahn.getBoundingClientRect();
          setze(nr, waagrecht ? (e.clientX - r.left) / (r.width || 1) : 1 - (e.clientY - r.top) / (r.height || 1));
        },
      });
    },
    switch(c, zelle) {
      const nr = parameterVon(c)[0];
      const b = el('button', 'fp-schalter');
      b.type = 'button';
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-label', c.label ?? c.id);
      b.append(el('i', 'fp-led'), el('span', 'fp-name', c.label ?? c.id));
      let gl = null;   // glyphs: [off, on]; the glyph of the current state sits in the button
      if (c.glyphs) { gl = el('span', 'fp-glyphenplatz'); b.append(gl); }
      zelle.append(b);
      zeiger.push(() => {
        const an = schalterAn(c, k[nr]);
        b.setAttribute('aria-checked', String(an)); b.classList.toggle('an', an);
        const id = c.glyphs?.[an ? 1 : 0];
        if (gl) gl.replaceChildren(...(id ? [glyphe(id, an ? 'ON' : 'OFF')] : []));
      });
      lernHaken(zelle, c);
      b.addEventListener('click', () => { setze(nr, schalterAn(c, k[nr]) ? 0 : 1); fertig(); });
    },
    selector(c, zelle) {
      const nr = parameterVon(c)[0], n = c.options.length;
      beschrifte(zelle, c);
      const gruppe = el('div', 'fp-wahl');
      gruppe.setAttribute('role', 'radiogroup');
      gruppe.setAttribute('aria-label', c.label ?? c.id);
      const tasten = c.options.map((text, i) => {
        const gid = c.glyphs?.[i];
        const b = el('button', gid ? 'fp-option fp-option-glyphe' : 'fp-option', gid ? undefined : text);
        if (gid) { b.append(glyphe(gid, text)); b.setAttribute('aria-label', text); b.setAttribute('title', text); }   // the option text stays the name
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.addEventListener('click', () => { setze(nr, diskretWert(i, n)); fertig(); });
        gruppe.append(b);
        return b;
      });
      zelle.append(gruppe);
      const lesung = c.glyphs ? el('output', 'fp-wert') : null;   // a glyph has no text: the readout names the chosen option
      if (lesung) zelle.append(lesung);
      lernHaken(zelle, c);
      zeiger.push(() => { const a = diskretIndex(k[nr], n); if (lesung) lesung.textContent = wertText(c, nr, k[nr], regler, parameter); tasten.forEach((b, i) => { b.setAttribute('aria-checked', String(i === a)); b.classList.toggle('an', i === a); }); });
    },
    xy(c, zelle) {
      const [nx, ny] = parameterVon(c);
      beschrifte(zelle, c);
      const feld = el('div', 'fp-xy');
      feld.tabIndex = 0;
      feld.setAttribute('role', 'group');
      feld.setAttribute('aria-label', c.label ?? c.id);
      feld.style.touchAction = 'none';
      const punktEl = el('i', 'fp-puck');
      feld.append(punktEl);
      const anzeige = el('output', 'fp-wert');
      zelle.append(feld, anzeige);
      zeiger.push(() => {
        feld.style.setProperty('--x', String(k[nx]));
        feld.style.setProperty('--y', String(k[ny]));
        anzeige.textContent = `${wertText({ ...c, format: c.xformat }, nx, k[nx], regler, parameter)} / ${wertText({ ...c, format: c.yformat }, ny, k[ny], regler, parameter)}`;
        feld.setAttribute('aria-valuetext', anzeige.textContent);
      });
      lernHaken(zelle, c);   // learns the x parameter (parameterVon(c)[0])
      let st = null;
      const doppelterTipp = tippErkennung();
      const absolut = (e) => {
        const r = feld.getBoundingClientRect();
        setze(nx, (e.clientX - r.left) / (r.width || 1));
        setze(ny, 1 - (e.clientY - r.top) / (r.height || 1));
      };
      feld.addEventListener('pointerdown', (e) => {
        if (lernAn() || gesperrtP(nx) || gesperrtP(ny)) return;
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        feld.focus();
        if (st && jetzt() - st.t < STEHEN_MS) return;   // a second finger on the field in use
        try { feld.setPointerCapture(e.pointerId); } catch { /* see ziehbar */ }
        besetzt.add(e.pointerId);
        st = { x: e.clientX, y: e.clientY, id: e.pointerId, t0: jetzt(), t: jetzt(), sx: e.clientX, sy: e.clientY };
        halte(nx, true); halte(ny, true);
        if (!e.shiftKey && !fein()) absolut(e);
      });
      feld.addEventListener('pointermove', (e) => {
        if (!st || fremder(st, e)) return;
        if (e.shiftKey || fein()) {   // fine: relative, five times slower
          const r = feld.getBoundingClientRect();
          setze(nx, k[nx] + (e.clientX - st.x) / ((r.width || 1) * REGLER_FEIN));
          setze(ny, k[ny] - (e.clientY - st.y) / ((r.height || 1) * REGLER_FEIN));
        } else absolut(e);
        st = { ...st, x: e.clientX, y: e.clientY, t: jetzt() };
      });
      const ende = (e, hoch) => {
        if (!st || fremder(st, e)) return;
        const hin = st;
        st = null; besetzt.delete(hin.id); halte(nx, false); halte(ny, false);
        if (hoch && doppelterTipp(hin, e)) { const v = vorgabeXY(c); setze(nx, v.x); setze(ny, v.y); }
        fertig();
      };
      feld.addEventListener('pointerup', (e) => ende(e, true));
      feld.addEventListener('pointercancel', (e) => ende(e, false));
      feld.addEventListener('lostpointercapture', (e) => ende(e, false));
      feld.addEventListener('dblclick', () => { const v = vorgabeXY(c); setze(nx, v.x); setze(ny, v.y); fertig(); });
      feld.addEventListener('keyup', (e) => { if (tastenSchritt(e.key, false)) fertig(); });
      feld.addEventListener('keydown', (e) => {
        const t = tastenSchritt(e.key, e.shiftKey);
        if (!t) return;
        e.preventDefault();
        const waagrecht = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
        const nr = waagrecht ? nx : ny;
        setze(nr, t.auf ?? k[nr] + t.schritt);
      });
    },
    lever(c, zelle) {
      const nr = parameterVon(c)[0], zonen = c.zones ?? [];
      zelle.classList.add('fp-hebelzelle');
      beschrifte(zelle, c);
      const bahn = el('div', 'fp-hebel');
      bahn.tabIndex = 0;
      bahn.setAttribute('role', 'slider');
      bahn.setAttribute('aria-orientation', 'vertical');
      bahn.setAttribute('aria-keyshortcuts', 'Space');
      bahn.style.touchAction = 'none';
      const weg = el('div', 'fp-hebelweg');
      const marken = HEBEL_GRENZEN.slice(1).map((g) => { const m = el('i', 'fp-hebelmarke'); m.style.top = `${g * 100}%`; return m; });
      const griff = el('i', 'fp-hebelgriff');
      const texte = zonen.map((t, i) => {
        const x = el('span', 'fp-hebelzone', t);
        const b = Math.min(i, 2);
        x.style.top = `${(b === 0 ? HEBEL_GRENZEN[0] : HEBEL_GRENZEN[b]) * 100 + (i > 2 ? (i - 2) * 11 : 0)}%`;
        return { x, b };
      });
      weg.append(el('i', 'fp-hebelrille'), ...marken, ...texte.map((t) => t.x), griff);
      bahn.append(weg);
      const anzeige = el('output', 'fp-wert');
      zelle.append(bahn, anzeige);
      zeiger.push(() => {
        const w = hebelWeg(k[nr]), b = hebelBereich(w);
        bahn.style.setProperty('--w', String(w));
        bahn.classList.toggle('gezogen', b >= 0);
        for (const t of texte) t.x.classList.toggle('an', t.b === b);
        marken.forEach((m, i) => m.classList.toggle('an', b > i));
        anzeige.textContent = b < 0 ? 'rest' : zonen.length ? (zonen[Math.min(b, zonen.length - 1)] ?? '') : `${Math.round(w * 100)}%`;
        bahn.setAttribute('aria-valuenow', k[nr].toFixed(3));
        bahn.setAttribute('aria-valuetext', anzeige.textContent);
      });
      bahn.setAttribute('aria-label', c.label ?? c.id);
      bahn.setAttribute('aria-valuemin', '0.5');
      bahn.setAttribute('aria-valuemax', '1');
      lernHaken(zelle, c);
      let st = null;
      const laenge = () => weg.getBoundingClientRect().height || 100;
      bahn.addEventListener('pointerdown', (e) => {
        if (lernAn() || gesperrtP(nr)) return;
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        bahn.focus?.();
        if (st && jetzt() - st.t < STEHEN_MS) return;   // a second finger on a lever in use
        try { bahn.setPointerCapture(e.pointerId); } catch { /* see ziehbar */ }
        besetzt.add(e.pointerId);
        st = { id: e.pointerId, y: e.clientY, t: jetzt() };
        halte(nr, true);
      });
      bahn.addEventListener('pointermove', (e) => {
        if (!st || fremder(st, e)) return;
        st.t = jetzt();
        setze(nr, WIE_BEI_REGLERN + WIE_BEI_REGLERN * Math.max(0, (e.clientY - st.y) / laenge()));   // pulling down: proportional to the travel
      });
      const los = (e) => {   // pointerup, pointercancel, lostpointercapture: the spring
        if (!st || fremder(st, e)) return;
        const hin = st;
        st = null; besetzt.delete(hin.id); halte(nr, false);
        setze(nr, WIE_BEI_REGLERN);
        fertig();
      };
      bahn.addEventListener('pointerup', los);
      bahn.addEventListener('pointercancel', los);
      bahn.addEventListener('lostpointercapture', los);
      let taste = false;
      bahn.addEventListener('keydown', (e) => {
        if (e.key !== ' ') return;
        e.preventDefault();
        if (taste || st) return;
        taste = true;
        setze(nr, 1);
      });
      const losTaste = () => { if (!taste) return; taste = false; setze(nr, WIE_BEI_REGLERN); fertig(); };
      bahn.addEventListener('keyup', (e) => { if (e.key === ' ') losTaste(); });
      bahn.addEventListener('blur', losTaste);
    },
    touchpad(c, zelle) {
      const [nx, nt] = parameterVon(c), zonen = c.zones ?? [], n = zonen.length;
      zelle.classList.add('fp-feldzelle');
      beschrifte(zelle, c);
      const feld = el('div', 'fp-feld');
      feld.tabIndex = 0;
      feld.setAttribute('role', 'group');
      feld.setAttribute('aria-label', c.label ?? c.id);
      feld.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Space');
      feld.style.touchAction = 'none';
      const teile = zonen.map((t) => { const z = el('span', 'fp-feldzone'); z.append(el('b', null, t)); return z; });
      feld.append(...teile);
      const marke = el('i', 'fp-feldmarke');
      feld.append(marke);
      const anzeige = el('output', 'fp-wert');
      zelle.append(feld, anzeige);
      zeiger.push(() => {
        const an = k[nt] > 0.5, z = n ? feldZone(k[nx], n) : -1;   // the 0.5 fill of a fresh stage is not a touch
        feld.style.setProperty('--x', String(k[nx]));
        feld.classList.toggle('beruehrt', an);
        teile.forEach((t, i) => t.classList.toggle('an', an && i === z));
        anzeige.textContent = n ? zonen[z] : wertText(c, nx, k[nx], regler, parameter);
        feld.setAttribute('aria-valuetext', `${anzeige.textContent}${an ? ' (touched)' : ''}`);
      });
      lernHaken(zelle, c);   // learns the x parameter
      let st = null, taste = false;
      const lage = (e) => { const r = feld.getBoundingClientRect(); return (e.clientX - r.left) / (r.width || 1); };
      feld.addEventListener('pointerdown', (e) => {
        if (lernAn() || gesperrtP(nx) || gesperrtP(nt)) return;
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        feld.focus?.();
        if (st && jetzt() - st.t < STEHEN_MS) return;   // a second finger on the field in use
        try { feld.setPointerCapture(e.pointerId); } catch { /* see ziehbar */ }
        besetzt.add(e.pointerId);
        st = { id: e.pointerId, t: jetzt() };
        halte(nx, true); halte(nt, true);
        setze(nx, lage(e));   // position first, then the touch
        setze(nt, 1);
      });
      feld.addEventListener('pointermove', (e) => {
        if (!st || fremder(st, e)) return;
        st.t = jetzt();
        setze(nx, lage(e));
      });
      const los = (e) => {
        if (!st || fremder(st, e)) return;
        const hin = st;
        st = null; besetzt.delete(hin.id); halte(nx, false); halte(nt, false);
        setze(nt, 0);   // x stays where it was
        fertig();
      };
      feld.addEventListener('pointerup', los);
      feld.addEventListener('pointercancel', los);
      feld.addEventListener('lostpointercapture', los);
      const losTaste = () => { if (!taste) return; taste = false; setze(nt, 0); fertig(); };
      feld.addEventListener('keydown', (e) => {
        if (e.key === ' ') { e.preventDefault(); if (!taste && !st) { taste = true; setze(nt, 1); } return; }
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const r = e.key === 'ArrowRight' ? 1 : -1;
        if (n) setze(nx, (Math.min(n - 1, Math.max(0, feldZone(k[nx], n) + r)) + 0.5) / n);   // zone by zone, to the middle of the zone
        else setze(nx, k[nx] + r * 0.1);
      });
      feld.addEventListener('keyup', (e) => { if (e.key === ' ') losTaste(); else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') fertig(); });
      feld.addEventListener('blur', losTaste);
    },
    value(c, zelle) {
      const [basis, achse] = c.of.split('.');
      const quelle = alle.find((x) => x.id === basis);
      beschrifte(zelle, c);
      const anzeige = el('output', 'fp-wert');
      zelle.append(anzeige);
      const ns = quelle ? parameterVon(quelle) : [];
      const nr = quelle?.type === 'xy' ? (achse === 'y' ? ns[1] : ns[0]) : ns[0];
      zeiger.push(() => { anzeige.textContent = nr === undefined ? '-' : wertText({ ...quelle, format: c.format ?? quelle.format, unit: c.unit ?? quelle.unit }, nr, k[nr], regler, parameter); });
    },
    huelle(c, zelle) {
      const { svg, linie, flaeche } = kurve(zelle, 'Envelope', c.label);
      zeiger.push(() => {
        const t = (ref, rolle) => echterWert(ref, rolle);
        const p = huellPunkte({ a: t(c.of.a, 'zeit'), d: t(c.of.d, 'zeit'), s: t(c.of.s, 'anteil'), r: t(c.of.r, 'zeit') }, K_B - 2 * K_RAND, K_H - 2 * K_RAND);
        linie.setAttribute('d', pfadVon(p));
        flaeche.setAttribute('d', `${pfadVon(p)}Z`);
      });
    },
    lfoform(c, zelle) {
      const { linie } = kurve(zelle, 'LFO shape', c.label);
      const wahl = alle.find((x) => x.id === c.of?.form);
      zeiger.push(() => {
        const i = wahl ? diskretIndex(k[parameterVon(wahl)[0]], wahl.options.length) : 0;
        linie.setAttribute('d', pfadVon(lfoPunkte(c.formen[i] ?? c.formen[0], K_B - 2 * K_RAND, K_H - 2 * K_RAND)));
      });
    },
    filterkurve(c, zelle) {
      const { svg, linie, flaeche } = kurve(zelle, 'Filter response (model)');
      const nullLinie = el('line', 'fp-kurve-null', undefined, true), marke = el('line', 'fp-kurve-marke', undefined, true);
      svg.append(nullLinie);
      svg.append(marke);
      const wahl = alle.find((x) => x.id === c.of.typ);
      zeiger.push(() => {
        const i = wahl ? diskretIndex(k[parameterVon(wahl)[0]], wahl.options.length) : 0;
        const art = c.typen[i] ?? c.typen[0], cutoff = echterWert(c.of.cutoff, 'hz'), reso = klemme01(echterWert(c.of.reso, 'anteil'));
        const b = K_B - 2 * K_RAND, h = K_H - 2 * K_RAND;
        const p = filterPunkte({ cutoff, reso, art: art.art, pole: art.pole }, b, h);
        linie.setAttribute('d', pfadVon(p));
        flaeche.setAttribute('d', `${pfadVon(p)}L${(K_RAND + b).toFixed(1)} ${(K_RAND + h).toFixed(1)}L${K_RAND} ${(K_RAND + h).toFixed(1)}Z`);
        const y0 = (K_RAND + nullDbY(h)).toFixed(1), x = (K_RAND + cutoffX(cutoff, b)).toFixed(1);
        nullLinie.setAttribute('x1', K_RAND); nullLinie.setAttribute('x2', K_RAND + b); nullLinie.setAttribute('y1', y0); nullLinie.setAttribute('y2', y0);
        marke.setAttribute('x1', x); marke.setAttribute('x2', x); marke.setAttribute('y1', K_RAND); marke.setAttribute('y2', K_RAND + h);
      });
    },
    wavetable(c, zelle) {   // stacked frames, the frame at pos highlighted and read through the warp map
      const WT_H = 90, b = K_B - 2 * K_RAND, h = WT_H - 2 * K_RAND;
      const frames = (c.frames ?? []).filter((f) => Array.isArray(f) && f.length >= 2);
      const { svg, linie, flaeche } = kurve(zelle, 'Wavetable', c.label, WT_H);
      const lage = wtLage(frames.length, b, h);
      const pfad = (p) => p.map(([x, y], i) => `${i ? 'L' : 'M'}${(x + K_RAND).toFixed(1)} ${(y + K_RAND).toFixed(1)}`).join('');
      const alt = el('g', 'fp-wt-stapel', undefined, true);
      for (let i = frames.length - 1; i >= 0; i--) {   // back to front: the last frame is the top right one
        const p = el('path', 'fp-wt-rahmen', undefined, true);
        p.setAttribute('d', pfad(wtLinie(frames[i], i, lage, h)));
        alt.append(p);
      }
      const nullLinie = el('line', 'fp-kurve-null', undefined, true);
      svg.replaceChildren(); svg.append(alt, flaeche, nullLinie, linie);   // dim stack at the back, the bold line on top of the zero line
      const posKnob = c.of?.pos, wahl = alle.find((x) => x.id === c.of?.warp);
      zeiger.push(() => {
        const pos = posKnob === undefined ? 0 : klemme01(echterWert(posKnob, 'anteil'));
        const modus = wahl ? Math.min(3, diskretIndex(k[parameterVon(wahl)[0]], wahl.options.length)) : 0;
        const tiefe = modus && c.of?.tiefe !== undefined ? wtTiefe(modus, echterWert(c.of.tiefe, 'anteil')) : 0;
        const tiefeIdx = frames.length > 1 ? pos * (frames.length - 1) : 0;
        const p = wtLinie(wtGewarpt(wtRahmen(frames, pos), modus, tiefe), tiefeIdx, lage, h);
        const nl = wtNull(tiefeIdx, lage, h);
        linie.setAttribute('d', pfad(p));
        flaeche.setAttribute('d', `${pfad(p)}L${(p[p.length - 1][0] + K_RAND).toFixed(1)} ${(nl.y + K_RAND).toFixed(1)}L${(p[0][0] + K_RAND).toFixed(1)} ${(nl.y + K_RAND).toFixed(1)}Z`);
        nullLinie.setAttribute('x1', nl.x1 + K_RAND); nullLinie.setAttribute('x2', nl.x2 + K_RAND);
        nullLinie.setAttribute('y1', nl.y + K_RAND); nullLinie.setAttribute('y2', nl.y + K_RAND);
      });
    },
    spektrum(c, zelle) {   // the channel spectrum while the device page is open (opt.beiSpektrum registers the view); in the small area only a note
      const rahmen = el('div', 'fp-anzeige');
      if (typeof opt.beiSpektrum === 'function') { const { wurzel, ansicht } = spektrumFlaeche(d); rahmen.append(wurzel); opt.beiSpektrum(ansicht); }
      else rahmen.append(el('span', 'fp-text', 'Spectrum: device page'));
      zelle.append(rahmen);
    },
    matrix(c, zelle) {   // the patch field of a Kraken-like graph: 16 x 16 pins in two sets A/B (opt.steckfeld = labels and graph defaults; styles .fp-m-* in panel.css)
      const sf = opt.steckfeld;
      if (!(Array.isArray(sf?.zeilen) && sf.zeilen.length === STIFT_N && Array.isArray(sf?.spalten) && sf.spalten.length === STIFT_N)) { zelle.append(el('span', 'fp-text', 'This device has no patch field')); return; }
      // the adapter of a track device holds the pins and sends them (stifte, stiftSetzen, stiftEnde, stifteSetzen); any other host shows the graph defaults, greyed
      const kannSetzen = typeof adapter.stiftSetzen === 'function', kannSaetze = typeof adapter.stifteSetzen === 'function';
      const morphZelle = alle.find((x) => x.id === c.of?.morph), morphNr = morphZelle ? parameterVon(morphZelle)[0] : undefined;
      zelle.classList.add('fp-m');
      if (!kannSetzen) { zelle.classList.add('fp-m-ruht'); zelle.setAttribute('title', 'The default pins of the graph. Pins are set on an instrument track.'); }
      let kabelInfo = null, bewaffnet = null, kabelAn = true;   // kabelInfo: text of a hovered cable or jack; bewaffnet: the armed source row; kabelAn: the CABLES toggle
      const bereichAn = (s) => c.of?.bereiche?.[s] ?? null;
      let ansicht = 0, ueber = null, st = null, rad = null, radT = null;   // ansicht: the set shown and edited (0 = A); ueber: the cell {z, s} under the pointer or the key cursor; st: a press; rad: the cell of a running wheel gesture
      const feldStifte = () => (typeof adapter.stifte === 'function' ? adapter.stifte() : sf.stifte) ?? [];
      const wertAn = (z, s) => stiftWert(feldStifte(), ansicht, z, s);
      const knopf = (text, titel, bei) => { const b = el('button', 'fp-knopf-klein', text); b.type = 'button'; b.setAttribute('title', titel); b.addEventListener('click', bei); return b; };
      const leiste = el('div', 'fp-m-leiste'), wahl = el('div', 'fp-wahl');
      const satzKnoepfe = ['A', 'B'].map((t, i) => {
        const b = el('button', 'fp-option', t);
        b.type = 'button';
        b.setAttribute('title', `Show and edit set ${t}`);
        b.addEventListener('click', () => { ansicht = i; zeige(); });
        wahl.append(b);
        return b;
      });
      const stiftFertig = () => { try { adapter.stiftEnde?.(); } catch (e) { globalThis.console?.error?.('panel adapter stiftEnde:', e); } };
      const satzSchreiben = (satz, liste) => { try { Promise.resolve(adapter.stifteSetzen(satz, liste)).catch(() => {}); } catch (e) { globalThis.console?.error?.('panel adapter stifteSetzen:', e); } zeige(); };
      const kopieren = knopf('', 'Copy this set over the other one', () => {
        if (!kannSaetze || lernAn()) return;
        const an = 1 - ansicht;
        satzSchreiben(an, feldStifte().filter((e) => e[0] === ansicht).map((e) => [an, e[1], e[2], e[3]]));
      });
      const leeren = knopf('', 'Remove every pin of this set', () => { if (kannSaetze && !lernAn()) satzSchreiben(ansicht, []); });
      leiste.append(wahl, kopieren, leeren);
      const mitKabeln = alleSeiteId !== null && Array.isArray(c.of?.quellen) && Array.isArray(c.of?.ziele);   // the cabinet page exists and the field knows its jacks
      let kabelKnopf = null;
      if (mitKabeln) {
        kabelKnopf = knopf('CABLES', 'Show or hide the cables of the Cabinet view', () => { kabelAn = !kabelAn; kabelSeite(); });
        kabelKnopf.setAttribute('aria-pressed', 'true');
        leiste.append(kabelKnopf);
      }
      let morphMarke = null, morphWert = null;
      if (morphNr !== undefined) {   // where the sound sits between A and B: the Morph knob, shown here beside the sets
        const m = el('div', 'fp-m-morph');
        m.setAttribute('title', 'Morph: the blend between set A and set B (the Morph knob)');
        const bahn = el('div', 'fp-m-morphbahn');
        morphMarke = el('i', 'fp-m-morphmarke');
        bahn.append(morphMarke);
        morphWert = el('output', 'fp-m-morphwert');
        m.append(el('span', 'fp-m-morphname', 'A'), bahn, el('span', 'fp-m-morphname', 'B'), morphWert);
        leiste.append(m);
      }
      const info = el('output', 'fp-m-info');
      const rolle = el('div', 'fp-m-rolle'), gitter = el('div', 'fp-m-gitter');   // rolle: scrolls sideways in a narrow host
      gitter.tabIndex = 0;
      gitter.setAttribute('role', 'grid');
      gitter.append(el('div', 'fp-m-ecke'));
      const spaltenL = sf.spalten.map((t) => { const l = el('div', 'fp-m-spalte'); l.append(el('span', null, t)); l.setAttribute('title', t); return l; });
      gitter.append(...spaltenL);
      const zeilenL = [], zellen = [];
      for (let z = 0; z < STIFT_N; z++) {
        const l = el('div', 'fp-m-zeile', sf.zeilen[z]);
        l.setAttribute('title', sf.zeilen[z]);
        zeilenL.push(l);
        gitter.append(l);
        for (let s = 0; s < STIFT_N; s++) {
          const x = el('div', 'fp-m-z');
          x.dataset.z = String(z); x.dataset.s = String(s);
          zellen.push(x);
          gitter.append(x);
        }
      }
      rolle.append(gitter);
      zelle.append(leiste, rolle, info);
      let hell = [];
      const zeigeInfo = (n) => {
        info.textContent = kabelInfo ?? (ueber ? stiftSatz(sf.zeilen[ueber.z], sf.spalten[ueber.s], wertAn(ueber.z, ueber.s), bereichAn(ueber.s))
          : bewaffnet !== null ? `${sf.zeilen[bewaffnet]}: now click a destination` : `Set ${ansicht ? 'B' : 'A'}: ${n ?? feldStifte().filter((e) => e[0] === ansicht).length} pins`);
      };
      const markiere = () => {   // the row and the column of the cell under the pointer light up, with their labels
        for (const e of hell) e.classList.toggle('fp-hell', false);
        hell = [];
        if (ueber) {
          hell = [zeilenL[ueber.z], spaltenL[ueber.s], ...zellen.slice(ueber.z * STIFT_N, (ueber.z + 1) * STIFT_N), ...zellen.filter((_, i) => i % STIFT_N === ueber.s)];
          for (const e of hell) e.classList.toggle('fp-hell', true);
        }
        zeigeInfo();
      };
      const zeigt = new Array(STIFT_N * STIFT_N).fill(null);   // per cell what is drawn: only a changed cell is touched
      zeiger.push(() => {
        const hier = new Float64Array(256), dort = new Float64Array(256);
        let n = 0;
        for (const e of feldStifte()) { if (e[0] === ansicht) { hier[e[1] * STIFT_N + e[2]] = e[3]; n++; } else dort[e[1] * STIFT_N + e[2]] = e[3]; }
        for (let i = 0; i < hier.length; i++) {
          const w = hier[i], g = dort[i], key = `${w}|${g}`;
          if (zeigt[i] === key) continue;
          zeigt[i] = key;
          const x = zellen[i];
          x.classList.toggle('fp-plus', w > 0);
          x.classList.toggle('fp-minus', w < 0);
          x.classList.toggle('fp-geist', g !== 0);   // the pin of the other set at this place: a thin ring
          x.style.setProperty('--g', stiftGroesse(w).toFixed(3));
          x.style.setProperty('--h', stiftGroesse(g).toFixed(3));
        }
        const m = morphNr === undefined ? 0 : k[morphNr];
        satzKnoepfe.forEach((b, i) => {
          b.classList.toggle('an', ansicht === i);
          b.setAttribute('aria-pressed', String(ansicht === i));
          if (morphNr !== undefined) b.style.setProperty('--anteil', (i ? m : 1 - m).toFixed(3));   // the share of the set in the sound, a bar under the letter
        });
        if (morphMarke) { morphMarke.style.setProperty('--k', m.toFixed(3)); morphWert.textContent = `${Math.round(m * 100)}%`; }
        kopieren.textContent = ansicht ? 'COPY B>A' : 'COPY A>B';
        leeren.textContent = ansicht ? 'CLEAR B' : 'CLEAR A';
        kopieren.disabled = !kannSaetze;
        leeren.disabled = !kannSaetze || n === 0;
        gitter.setAttribute('aria-label', `Patch field, set ${ansicht ? 'B' : 'A'}`);
        zeigeInfo(n);
      });
      const zelleVon = (e) => {
        for (let t = e.target; t; t = t.parentElement ?? t.eltern ?? null) if (t.dataset?.z !== undefined) return { z: Number(t.dataset.z), s: Number(t.dataset.s) };
        return null;
      };
      const pin = (z, s, w) => { adapter.stiftSetzen(ansicht, z, s, w); zeige(); };
      const bedienbar = () => kannSetzen && !lernAn();
      gitter.addEventListener('pointerover', (e) => { const x = zelleVon(e); if (x && !st) { ueber = x; markiere(); } });
      gitter.addEventListener('pointerleave', () => { if (!st) { ueber = null; markiere(); } });
      // a press that hardly moves is a click (empty cell: +0.5, pin: removed), a vertical drag changes the amount (up = more, below the middle = negative)
      gitter.addEventListener('pointerdown', (e) => {
        if (!bedienbar()) return;
        if (e.button !== undefined && e.button !== 0) return;
        const x = zelleVon(e);
        if (!x) return;
        if (st && jetzt() - st.t < STEHEN_MS) { e.preventDefault(); return; }
        e.preventDefault();
        gitter.focus?.();
        try { gitter.setPointerCapture(e.pointerId); } catch { /* synthetic or lost pointer: the drag still works inside the element */ }
        besetzt.add(e.pointerId);
        const w0 = wertAn(x.z, x.s);
        st = { ...x, id: e.pointerId, y0: e.clientY, y: e.clientY, w0, roh: w0, zuletzt: w0, bewegt: false, t: jetzt() };
        ueber = x;
        markiere();
      });
      gitter.addEventListener('pointermove', (e) => {
        if (!st || fremder(st, e)) return;
        if (!st.bewegt) {
          if (Math.abs(e.clientY - st.y0) < TIPP_PX / 2) return;
          st.bewegt = true;
        }
        st.roh = Math.max(-1, Math.min(1, st.roh + (st.y - e.clientY) / (STIFT_ZIEH_PX * (e.shiftKey || fein() ? REGLER_FEIN : 1))));
        st.y = e.clientY;
        st.t = jetzt();
        const w = stiftRunde(st.roh);
        if (w !== st.zuletzt) { st.zuletzt = w; pin(st.z, st.s, w); }
      });
      const losgelassen = (e, hoch) => {
        if (!st || fremder(st, e)) return;
        const hin = st;
        st = null; besetzt.delete(hin.id);
        if (hoch && !hin.bewegt) pin(hin.z, hin.s, hin.w0 !== 0 ? 0 : e.shiftKey ? -STIFT_KLICK : STIFT_KLICK);
        stiftFertig();
      };
      gitter.addEventListener('pointerup', (e) => losgelassen(e, true));
      gitter.addEventListener('pointercancel', (e) => losgelassen(e, false));
      gitter.addEventListener('lostpointercapture', (e) => losgelassen(e, false));
      gitter.addEventListener('contextmenu', (e) => {   // right click: a negative pin (or removes the pin there)
        if (!bedienbar()) return;
        const x = zelleVon(e);
        if (!x) return;
        e.preventDefault();
        pin(x.z, x.s, wertAn(x.z, x.s) !== 0 ? 0 : -STIFT_KLICK);
        stiftFertig();
      });
      // the wheel changes a pin it is over (an empty cell lets the page scroll); it ends after the idle time like the knob wheel
      gitter.addEventListener('wheel', (e) => {
        if (!bedienbar()) return;
        const x = zelleVon(e);
        if (!x) return;
        const w0 = wertAn(x.z, x.s);
        if (w0 === 0 && !(rad && rad.z === x.z && rad.s === x.s)) return;
        e.preventDefault();
        const r = -Math.sign(e.deltaY || e.deltaX);
        if (!r) return;
        rad = x;
        const w = stiftRunde(w0 + r * (e.shiftKey ? 0.01 : STIFT_RAD));
        if (w !== w0) pin(x.z, x.s, w);
        if (radT !== null) clearTimeout(radT);
        radT = setTimeout(() => { radT = null; rad = null; stiftFertig(); }, opt.radMs ?? RAD_MS);
      }, { passive: false });
      // keyboard: arrows move the cursor, Enter or Space sets or removes, + and - change the amount, Delete removes
      gitter.addEventListener('keydown', (e) => {
        const dz = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0, ds = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (dz || ds) {
          e.preventDefault();
          const a = ueber ?? { z: 0, s: 0 };
          ueber = { z: Math.min(STIFT_N - 1, Math.max(0, a.z + dz)), s: Math.min(STIFT_N - 1, Math.max(0, a.s + ds)) };
          markiere();
          return;
        }
        if (!ueber || !bedienbar()) return;
        const w0 = wertAn(ueber.z, ueber.s);
        let w = null;
        if (e.key === 'Enter' || e.key === ' ') w = w0 !== 0 ? 0 : STIFT_KLICK;
        else if (e.key === 'Delete' || e.key === 'Backspace') w = 0;
        else if (e.key === '+' || e.key === '=') w = stiftRunde(w0 + (e.shiftKey ? 0.01 : STIFT_RAD));
        else if (e.key === '-') w = stiftRunde(w0 - (e.shiftKey ? 0.01 : STIFT_RAD));
        if (w === null) return;
        e.preventDefault();
        if (w !== w0) pin(ueber.z, ueber.s, w);
      });
      gitter.addEventListener('keyup', (e) => { if (['Enter', ' ', 'Delete', 'Backspace', '+', '=', '-'].includes(e.key)) stiftFertig(); });
      gitter.addEventListener('blur', () => { if (!st) { ueber = null; markiere(); } });
      aufraeumen.push(() => { if (radT !== null) { clearTimeout(radT); radT = null; rad = null; stiftFertig(); } });
      // ---- Cabinet view: jacks on the sections and a cable per pin (only with a page `all`, see the header comment) ----
      if (mitKabeln) matrixKabel = ({ platte, sektionen }) => {
        const fenster2 = d.defaultView ?? null;
        const hostStil = host.style ? host.style.position : undefined;
        if (host.style) host.style.position = 'relative';   // the overlay is positioned against the host; the plate (zoomed by the device window) stays untouched
        const svg = el('svg', 'fp-kabelsvg', undefined, true);
        svg.setAttribute('pointer-events', 'none');
        host.append(svg);
        const quelle = (z) => c.of.quellen[z] ?? null, ziel = (s) => c.of.ziele[s] ?? null;
        const buchsen = { q: [], z: [] };   // per row / column: [{ el }] (one jack each)
        const stelle = (art, nr, ort, titel, sektionId) => {
          const b = el('span', art === 'q' ? 'fp-buchse fp-buchse-aus' : 'fp-buchse fp-buchse-ein');
          b.dataset.buchse = `${art}${nr}`;
          b.setAttribute('role', 'button');
          b.setAttribute('title', titel);
          if (art === 'q') b.style.setProperty('--bc', KABEL_FARBEN[nr % KABEL_FARBEN.length]);
          const zielZelle = sektionId ? null : zellenVonId.get(ort);
          const sek = sektionen.get(ort);
          const platz = sek ? (titelVon.get(ort) ?? sek) : zielZelle ? (namenVon.get(zielZelle) ?? zielZelle) : null;
          if (!platz) return null;
          if (!sek && !namenVon.get(zielZelle)) b.classList.add('fp-buchse-lose');
          platz.append(b);
          return b;
        };
        for (let z = 0; z < STIFT_N; z++) if (typeof quelle(z) === 'string') { const b = stelle('q', z, quelle(z), `Source: ${sf.zeilen[z]}`, true); if (b) buchsen.q[z] = b; }
        for (let sp = 0; sp < STIFT_N; sp++) if (typeof ziel(sp) === 'string') { const b = stelle('z', sp, ziel(sp), `Destination: ${sf.spalten[sp]}`, sektionen.has(ziel(sp))); if (b) buchsen.z[sp] = b; }
        let kabel = [];   // [{ z, s, pfad, griff, w }]: what is drawn
        let hoverArt = null;   // { art: 'q'|'z'|'k', z?, s? }: the cable or jack under the pointer
        const sichtbar = () => alleSeiteId !== null && seite === alleSeiteId && kabelAn;
        const mitte = (e, h0) => {
          const r = e?.getBoundingClientRect?.();
          if (!r || !(r.width > 0 || r.height > 0)) return null;
          return { x: r.left + r.width / 2 - h0.left, y: r.top + r.height / 2 - h0.top };
        };
        const kabelBeteiligt = (k) => hoverArt && (hoverArt.art === 'k' ? hoverArt.z === k.z && hoverArt.s === k.s : hoverArt.art === 'q' ? hoverArt.z === k.z : hoverArt.s === k.s);
        const faerbe = () => {   // the hovered cable (or every cable of the hovered jack) lights up, the others dim
          svg.classList.toggle('fp-kabel-dimm', hoverArt !== null);
          for (const k of kabel) { k.pfad.classList.toggle('fp-kabel-hell', !!kabelBeteiligt(k)); }
        };
        const aktive = () => feldStifte().filter((e) => e[0] === ansicht && e[3] !== 0 && buchsen.q[e[1]] && buchsen.z[e[2]]);
        const satzVon = (z, sp) => stiftSatz(sf.zeilen[z], sf.spalten[sp], wertAn(z, sp), bereichAn(sp));
        const hoverText = (h) => {
          if (h.art === 'k') return satzVon(h.z, h.s);
          const liste = aktive().filter((e) => (h.art === 'q' ? e[1] === h.z : e[2] === h.s));
          const teil = (e) => `${h.art === 'q' ? sf.spalten[e[2]] : sf.zeilen[e[1]]} (${e[3] > 0 ? '+' : '-'}${Math.abs(e[3]).toFixed(2)})`;
          if (h.art === 'q') return liste.length ? `${sf.zeilen[h.z]} is patched to ${liste.map(teil).join(', ')}` : `${sf.zeilen[h.z]}: no cable yet, click to patch it`;
          return liste.length ? `${sf.spalten[h.s]} receives ${liste.map(teil).join(', ')}` : `${sf.spalten[h.s]}: nothing patched, click a source jack first`;
        };
        const weise = (h) => { hoverArt = h; kabelInfo = h ? hoverText(h) : null; faerbe(); zeigeInfo(); };
        let zuletztKey = null;
        const zeichne = (erzwingen = false) => {
          const an = sichtbar();
          svg.classList.toggle('fp-kabel-aus', !an);
          platte.classList.toggle('fp-kabelan', an);
          if (kabelKnopf) { kabelKnopf.classList.toggle('an', kabelAn); kabelKnopf.setAttribute('aria-pressed', String(kabelAn)); }
          for (const art of ['q', 'z']) buchsen[art].forEach((b, i) => { if (b) b.classList.toggle('fp-an', art === 'q' && bewaffnet === i); });
          if (!an) { zuletztKey = null; svg.replaceChildren(); kabel = []; return; }
          const key = JSON.stringify([ansicht, feldStifte(), bewaffnet]);
          if (!erzwingen && key === zuletztKey) return;
          const h0 = host.getBoundingClientRect?.();
          if (!h0 || !(h0.width > 0)) { svg.replaceChildren(); kabel = []; return; }   // no layout (a test DOM, a hidden host): nothing to draw
          zuletztKey = key;
          svg.replaceChildren();
          kabel = [];
          const benutzt = new Set();
          const zeichneEins = (e, geist) => {
            const a = mitte(buchsen.q[e[1]], h0), b = mitte(buchsen.z[e[2]], h0);
            if (!a || !b) return;
            const hang = Math.min(140, 30 + Math.hypot(b.x - a.x, b.y - a.y) * 0.25);
            const dpfad = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}C${a.x.toFixed(1)} ${(a.y + hang).toFixed(1)} ${b.x.toFixed(1)} ${(b.y + hang).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
            const farbe = KABEL_FARBEN[e[1] % KABEL_FARBEN.length];
            const pfad = el('path', geist ? 'fp-kabel fp-kabel-geist' : 'fp-kabel', undefined, true);
            pfad.setAttribute('d', dpfad); pfad.setAttribute('stroke', farbe); pfad.setAttribute('fill', 'none'); pfad.setAttribute('stroke-linecap', 'round');
            pfad.setAttribute('stroke-width', geist ? '1' : (2 + 4 * Math.min(1, Math.abs(e[3]))).toFixed(2));
            if (geist) pfad.setAttribute('stroke-opacity', '0.3');
            if (!geist && e[3] < 0) pfad.setAttribute('stroke-dasharray', '7 5');
            pfad.setAttribute('pointer-events', 'none');
            svg.append(pfad);
            if (geist) return;
            benutzt.add(`q${e[1]}`); benutzt.add(`z${e[2]}`);
            const griff = el('path', 'fp-kabel-griff', undefined, true);   // a wide invisible stroke: the thin cable is hard to hit
            griff.setAttribute('d', dpfad); griff.setAttribute('fill', 'none'); griff.setAttribute('stroke', 'transparent'); griff.setAttribute('stroke-width', '14');
            griff.setAttribute('pointer-events', 'stroke');
            griff.dataset.z = String(e[1]); griff.dataset.s = String(e[2]);
            griff.addEventListener('pointerover', () => weise({ art: 'k', z: e[1], s: e[2] }));
            griff.addEventListener('pointerleave', () => weise(null));
            griff.addEventListener('click', (ev) => {   // a click on a cable pulls it out
              ev.stopPropagation?.();
              if (!bedienbar()) return;
              pin(e[1], e[2], 0); stiftFertig();
              weise(null);
            });
            griff.addEventListener('wheel', (ev) => {   // the wheel changes the amount, the gesture ends after the idle time of the grid
              if (!bedienbar()) return;
              const r = -Math.sign(ev.deltaY || ev.deltaX);
              ev.preventDefault?.();
              if (!r) return;
              const w0 = wertAn(e[1], e[2]);
              rad = { z: e[1], s: e[2] };
              const w = stiftRunde(w0 + r * (ev.shiftKey ? 0.01 : STIFT_RAD));
              if (w !== w0) pin(e[1], e[2], w);
              if (radT !== null) clearTimeout(radT);
              radT = setTimeout(() => { radT = null; rad = null; stiftFertig(); }, opt.radMs ?? RAD_MS);
            }, { passive: false });
            svg.append(griff);
            kabel.push({ z: e[1], s: e[2], pfad, griff, w: e[3] });
          };
          for (const e of feldStifte()) if (e[0] !== ansicht && e[3] !== 0 && buchsen.q[e[1]] && buchsen.z[e[2]]) zeichneEins(e, true);   // the other set: thin ghosts at the back
          for (const e of aktive()) zeichneEins(e, false);
          for (const art of ['q', 'z']) buchsen[art].forEach((b, i) => { if (b) b.classList.toggle('fp-benutzt', benutzt.has(`${art}${i}`)); });
          faerbe();
        };
        zeiger.push(() => zeichne(false));
        const entwaffne = () => { if (bewaffnet === null) return; bewaffnet = null; kabelInfo = null; zeige(); };
        buchsen.q.forEach((b, z) => {
          if (!b) return;
          b.addEventListener('click', (ev) => {
            ev.stopPropagation?.();
            if (!bedienbar()) return;
            if (bewaffnet === z) { entwaffne(); return; }
            bewaffnet = z; kabelInfo = null;
            zeige();
          });
          b.addEventListener('pointerdown', (ev) => ev.stopPropagation?.());
          b.addEventListener('pointerover', () => weise({ art: 'q', z }));
          b.addEventListener('pointerleave', () => weise(null));
        });
        buchsen.z.forEach((b, sp) => {
          if (!b) return;
          b.addEventListener('click', (ev) => {
            ev.stopPropagation?.();
            if (!bedienbar() || bewaffnet === null) return;
            const z = bewaffnet;
            bewaffnet = null;
            const w0 = wertAn(z, sp);
            pin(z, sp, w0 !== 0 ? 0 : ev.shiftKey ? -STIFT_KLICK : STIFT_KLICK);   // like a click in the grid
            stiftFertig();
            kabelInfo = satzVon(z, sp);
            zeige();
          });
          b.addEventListener('pointerdown', (ev) => ev.stopPropagation?.());
          b.addEventListener('pointerover', () => weise({ art: 'z', s: sp }));
          b.addEventListener('pointerleave', () => weise(null));
        });
        const taste = (ev) => { if (ev.key === 'Escape') entwaffne(); };
        d.addEventListener?.('keydown', taste);
        let geplant = false;
        const plane = () => {
          if (geplant) return;
          if (typeof fenster2?.requestAnimationFrame !== 'function') { zeichne(true); return; }
          geplant = true;
          fenster2.requestAnimationFrame(() => { geplant = false; zeichne(true); });
        };
        fenster2?.addEventListener?.('resize', plane);
        fenster2?.addEventListener?.('scroll', plane, { passive: true, capture: true });
        let beobachter = null;
        try { if (typeof fenster2?.ResizeObserver === 'function') { beobachter = new fenster2.ResizeObserver(plane); beobachter.observe(platte); } } catch { beobachter = null; }
        kabelSeite = () => { zeichne(true); };
        aufraeumen.push(() => {
          d.removeEventListener?.('keydown', taste);
          fenster2?.removeEventListener?.('resize', plane);
          fenster2?.removeEventListener?.('scroll', plane, { capture: true });
          beobachter?.disconnect?.();
          if (host.style) host.style.position = hostStil ?? '';
          kabelSeite = () => {};
        });
      };
    },
    label(c, zelle) { zelle.append(el('span', 'fp-text', c.text)); },
    spacer() { /* an empty cell */ },
  };

  host.replaceChildren();
  const platte = el('div', 'frontplatte');
  if (AKZENTE.includes(panel.akzent)) platte.dataset.akzent = panel.akzent;   // whitelist: the colour comes from panel.css tokens, never from the file
  const kopf = el('div', 'fp-kopf');
  kopf.append(el('b', 'fp-titel', panel.title ?? panel.geraet?.graph ?? ''));
  if (opt.umschalter) {
    const u = el('button', 'fp-umschalter', opt.umschalter.text);
    u.type = 'button';
    u.addEventListener('click', opt.umschalter.beiKlick);
    kopf.append(u);
  }
  platte.append(kopf);
  if (opt.kopf) { const kz = el('div', 'fp-kopfpresets'); platte.append(kz); opt.kopf(kz, { lernen: kannLernen }); }   // the preset header (public/panel_kopf.js) above the sections
  const koerper = el('div', 'fp-koerper');
  const modulMode = !!panel.layout?.rows;
  const baueSektion = (s) => {
    const sek = el('section', modulMode ? 'fp-sektion fp-modul' : 'fp-sektion');
    sek.dataset.sektion = s.id;
    if (s.title) { const t = el('h4', modulMode ? 'fp-sektionstitel fp-modultitel' : 'fp-sektionstitel', s.title); titelVon.set(s.id, t); sek.append(t); }
    const gitter = el('div', 'fp-gitter');
    gitter.style.setProperty('--spalten', String(s.cols ?? Math.min(4, s.controls.length)));
    if (modulMode) sek.style.setProperty('--spalten', String(s.cols ?? Math.min(4, s.controls.length)));   // the row sizes its modules by this
    for (const c of s.controls) {
      const zelle = el('div', 'fp-zelle');
      zelle.dataset.typ = c.type;
      zelle.dataset.id = c.id;
      zellenVonId.set(c.id, zelle);
      if (parameterVon(c)[0] !== undefined) zelle.dataset.param = parameterVon(c)[0];   // the device window marks the cell of a knob a controller drives (device_window.js)
      if (c.span) zelle.style.gridColumn = `span ${c.span}`;
      if (c.type === 'matrix') sek.classList.add('fp-matrixsektion');   // the section takes the room of the field (panel.css)
      bauer[c.type]?.(c, zelle);
      const lernNr = parameterVon(c)[0];
      if (kannLernen && lernNr !== undefined) markiert.push({ zelle, nr: lernNr });
      if (parameterVon(c).length) sperrZellen.push({ zelle, nrs: parameterVon(c) });
      if (c.wirkt) wirkZellen.set(c.id, zelle);
      gitter.append(zelle);
    }
    sek.append(gitter);
    return sek;
  };
  const sektionen = new Map(panel.sections.map((s) => [s.id, baueSektion(s)]));   // built once; rows only place them
  const seiten = (panel.pages ?? []).filter((p) => !p.all || opt.breit);   // the page that shows everything only where there is room for it
  const seiteVon = new Map(panel.sections.map((s) => [s.id, s.page ?? seiten[0]?.id]));
  const reihen = [];   // [{ el, ids }]
  if (modulMode) {
    const benannt = new Set(panel.layout.rows.flat());
    const zeilen = panel.layout.rows.map((r) => [...r]);
    const rest = panel.sections.map((s) => s.id).filter((id) => !benannt.has(id));
    if (rest.length) zeilen.push(rest);   // sections the layout does not name follow in a last row
    for (const ids of zeilen) {
      const r = el('div', 'fp-reihe');
      ids.forEach((id, i) => { const m = sektionen.get(id); if (i > 0) m.classList.add('fp-teiler'); r.append(m); });
      reihen.push({ el: r, ids });
      koerper.append(r);
    }
  } else for (const sek of sektionen.values()) koerper.append(sek);
  seite = seiten[0]?.id;
  const tabs = [];
  const zeigeSeite = (id) => {
    if (!seiten.some((p) => p.id === id)) return;
    seite = id;
    const alle = id === alleSeiteId;   // the page with `all` shows every section and every row
    for (const [sid, sek] of sektionen) sek.classList.toggle('fp-aus', !alle && seiteVon.get(sid) !== id);
    for (const r of reihen) r.el.classList.toggle('fp-aus', !alle && r.ids.every((sid) => seiteVon.get(sid) !== id));
    platte.classList.toggle('fp-schrank', alle);
    tabs.forEach((t, i) => { const an = seiten[i].id === id; t.setAttribute('aria-selected', String(an)); t.classList.toggle('an', an); });
    kabelSeite();
    try { opt.beiSeite?.(id); } catch { /* the listener's business */ }   // the page in front, also the first one (a controller that follows takes the mapping of the page)
  };
  if (seiten.length) {
    const leiste = el('div', 'fp-seiten');
    leiste.setAttribute('role', 'tablist');
    for (const p of seiten) {
      const t = el('button', 'fp-seite', p.title);
      t.type = 'button';
      t.setAttribute('role', 'tab');
      t.addEventListener('click', () => zeigeSeite(p.id));
      tabs.push(t);
      leiste.append(t);
    }
    platte.append(leiste);
    zeigeSeite(seite);
  }
  if (opt.breit) platte.classList.add('fp-breit');
  if (modulMode) platte.classList.add('fp-mit-reihen');
  platte.append(koerper);
  host.append(platte);
  matrixKabel?.({ platte, sektionen });   // jacks and the cable overlay of the patch field, now that every section and control stands
  kabelSeite();
  const markiere = () => {
    platte.classList.toggle('fp-lernmodus', lernAn());
    for (const m of markiert) {
      const p = adapter.lernPfad(m.nr);
      m.zelle.classList.toggle('fp-gelernt', lern.gelernt.has(p));
      m.zelle.classList.toggle('fp-wartet', lern.wartet !== null && lern.wartet === p);
    }
  };
  markiere();
  zeige();

  return {
    /** erzwingen: also takes the value of a control that was moved a moment ago (a refused write must not leave a stale display); a control under the hand keeps its place. */
    aktualisiere(erzwingen = false) {
      const t = jetzt();
      for (const n of Object.keys(k)) {
        const lock = gesperrt[n] ?? 0;
        if (lock === Infinity || (!erzwingen && !gesperrtP(n) && lock > t)) continue;   // a blocked parameter shows the adapter's value at once (the macro moves it)
        const v = adapter.get(n);
        if (typeof v === 'number' && Number.isFinite(v)) k[n] = klemme01(v);
      }
      zeige();
    },
    werte() { return { ...k }; },
    /** Shows the modules of page `id` (pages of the panel file); an unknown id changes nothing. */
    zeigeSeite,
    /** Whether the page in front is the one with `all` (the Cabinet): it shows every module, so a controller program of another page has nothing to turn to. */
    zeigtAlles: () => alleSeiteId !== null && seite === alleSeiteId,
    /** stand = {an?, wartet, gelernt}: re-marks the controls without rebuilding; an absent `an` keeps the mode. */
    setzeLernen(stand) {
      lern = { an: stand?.an ?? lern.an, wartet: stand?.wartet ?? null, gelernt: stand?.gelernt ?? new Set() };
      markiere();
    },
    zerstoere() {
      for (const f of aufraeumen.splice(0)) f();
      if (radTimer !== null) { clearTimeout(radTimer); radTimer = null; fertig(); }
      for (const [t, f] of [['pointerdown', hostRunter], ['pointermove', hostBewegt], ['pointerup', hostHoch], ['pointercancel', hostHoch], ['lostpointercapture', hostHoch]]) host.removeEventListener?.(t, f);
      d.removeEventListener?.('visibilitychange', fensterAus); fenster.removeEventListener?.('blur', alleVergessen); ruhend.clear();
      host.replaceChildren();
    },
  };
}
