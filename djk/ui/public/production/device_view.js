// PRODUCTION (front panels, task 8): the device view on an instrument track (bk graph, RB-338). A click on the device label of the track head opens the
// front panel of the device in the detail area (detail.js mode `geraet`, like the rack panel). The panel comes from GET /geraete/panel; its values live in
// spur.geraet.parameter (normalised 0..1, an absent one is the `vorgabe` of the parameter table).
// Knobs k1..k64 of a Baukasten track move the sound while they are dragged (production plan task 10): set() sends the light command geraet_param_setzen at most
// once per 30 ms with the latest value (the core row spur/<slot>/bk/<k> carries it to the instance), ende() sends the last value at once; one undo step per drag.
// Every other control (RB-338, Surge) moves the display at once and sends nothing until the end of the gesture (panel.js calls adapter.ende): ONE
// spur_aendern goes out with the whole device and the new values: one write, one undo step, and the graph instance of the track stays (the general path of spur_aendern).
import { baueFrontplatte, steuerungen, parameterVon } from '../panel.js';
import { baueKopf, spurBeschreibung, tagVonGraph } from '../panel_kopf.js';
import { parameterNachName } from '../panel_display.js';
import { wendePresetAn } from './preset_apply.js';
import { surgeAnzeige, surgeNorm } from '../surge_adapter.js';
import { hatMod, lebendWert, modAnzeigeAnschluss } from '../mod_display.js';

export const BK_LIVE_MAX = 64;   // knobs k1..k64 have a core row spur/<slot>/bk/<k> (SPUR_BK_KNOEPFE; 32 until 2026-11-16); a page file cannot import the .ts, tests/production_device_view.test.mjs pins it
export const BK_LIVE_SLOTS = 16; // every bk track has those rows (SPUR_BK_SLOTS = ARR_BK_MAX = 16 since 2026-11-21, 8 before); = BK_LIVE_SLOTS of project/model.ts, pinned by the same test
export const BK_LIVE_MS = 30;    // the throttle of a live drag, like pluginAdapter (plugin_panel.js)
export const SURGE_MAX = 32;   // = SURGE_PARAMETER_MAX of project/model.ts (a page file cannot import the .ts; tests/production_device_view.test.mjs pins them equal)

export const GERAET_TEXT = {
  titel: 'DEVICE',
  laedt: 'Loading the device panel…',
  keins: 'This device has no panel.',
  istFehlt: 'The Surge host does not answer yet. Knobs show default values until it does.',
  zuViele: `A Surge track holds at most ${SURGE_MAX} different parameters; this one is not stored`,
  fehler: 'The device panel could not be loaded',
};

/** 'bk:<graph>' | 'rb338' | 'surge' | null: what a device view needs to be rebuilt for. Plug-in hosts, kit, rack and audio have no view here. */
export function geraetSchluessel(g) {
  if (istSurge(g)) return 'surge';
  if (g?.art !== 'intern') return null;
  if (g.name === 'bk') return `bk:${g.graph}`;
  return g.name === 'rb338' ? 'rb338' : null;
}
const istSurge = (g) => g?.art === 'wirt' && g.name === 'surge' && !g.plugin;
export const kannGeraetAnsicht = (spur) => geraetSchluessel(spur?.geraet) !== null;
const anfrage = (g) => (istSurge(g) ? '/geraete/panel?art=surge' : g.name === 'bk' ? `/geraete/panel?art=bk&graph=${encodeURIComponent(g.graph)}` : '/geraete/panel?art=rb338');

/**
 * The panel adapter of one track. `parameter` is the table of GET /geraete/panel (vorgabe per name). set() keeps the value locally, ende() sends the
 * collected values as one spur_aendern (all existing parameters plus the new ones) and returns its promise (undefined: nothing sent).
 * The command is built when its turn comes in the writer queue (ctx.aendereAus), from the project as it is THEN: an earlier gesture whose answer
 * is still on its way is already in it, so two quick gestures never roll each other back. A shown value stays until its own write was answered
 * (accepted: the project has it; refused: the display goes back to the project value, `beiFertig(ok)` lets the view redraw).
 * It sends only while the track still carries the device the view was built for: a track switched to Surge meanwhile gets nothing.
 * opt: { label(param) -> control label (undo step "<track>: <label>"), steckfeld? (GET /geraete/panel: labels and default pins of the patch field), beiFertig(ok), melde, zeitgeber? ({setTimeout, clearTimeout}, default globalThis), entprellMs? (default 30) }.
 * A Baukasten knob k1..k64 is live: see the header; its sends are separate commands geraet_param_setzen, a refusal stops the live sends of the running gesture (the
 * writer reported it once) and the display goes back to the stored value.
 */
/** The running number (1-based) of a bk track among the bk tracks by ascending nr (bkSlot in project/model.ts), null when the project does not list it. */
export function bkSlotNr(spuren, spurId) {
  const alle = (spuren ?? []).filter((s) => s.geraet?.art === 'intern' && s.geraet.name === 'bk').sort((a, b) => a.nr - b.nr);
  const i = alle.findIndex((s) => s.id === spurId);
  return i < 0 ? null : i + 1;
}

/** The core row of a bk knob of a track, spur/<slot>/bk/<k>; null when the knob has none (not k1..k64, track not listed, beyond BK_LIVE_SLOTS). */
export function bkZeilenPfad(spuren, spurId, param) {
  const m = /^k([1-9][0-9]?)$/.exec(param ?? '');
  if (!m || Number(m[1]) > BK_LIVE_MAX) return null;
  const slot = bkSlotNr(spuren, spurId);
  return slot === null || slot > BK_LIVE_SLOTS ? null : `spur/${slot}/bk/${m[1]}`;
}

/** strand 6 task 2.2: the modulated position 0..1 of a Baukasten knob `k<n>` (target `geraet.k<n>` of the track, range 0..1): undefined when no modulator targets it (no ring),
 *  null while the modulator is silent, else base + the summed offset clamped once. `basis` = the stored position of the knob, `jetzt` in ms (performance.now). */
export function bkModKnopf(projekt, spurId, param, basis, jetzt) {
  if (!/^k([1-9][0-9]?)$/.test(param ?? '')) return undefined;
  const ziel = `geraet.${param}`;
  if (!hatMod(projekt, spurId, ziel)) return undefined;
  if (!Number.isFinite(basis)) return null;
  return lebendWert(projekt, spurId, ziel, basis, [0, 1], jetzt);
}
const modVerdrahtet = new WeakSet();   // the contexts whose event feed already fills MOD_STAND

/** Echo of a core row spur/<slot>/bk/<k> (stream.js, /e/regler): zeilenEcho(pfad) tells the open device panels, zeilenAbo(h) subscribes (returns the remover). */
const zeilenAbos = new Set();
export const zeilenEcho = (pfad) => { for (const h of [...zeilenAbos]) { try { h(pfad); } catch { /* one view's error stops no other */ } } };
export const zeilenAbo = (h) => { zeilenAbos.add(h); return () => zeilenAbos.delete(h); };

export function spurAdapter(ctx, spur, parameter = [], opt = {}) {
  const schluessel = geraetSchluessel(spur.geraet);
  const vorgabe = Object.fromEntries(parameter.map((p) => [p.name, p.vorgabe]));
  const tabelle = Object.fromEntries(parameter.map((p) => [p.name, p]));
  const surge = schluessel === 'surge';   // the project holds DISPLAY values of Surge (surge_bereiche.json ranges); the panel works in travel 0..1
  let abgelehnt = false;                  // a 33rd name was refused during the running gesture
  const angezeigt = new Map();   // param -> value shown until the server answered
  const offen = new Set();       // params set by the running gesture, not sent yet (the release path)
  const bk = typeof schluessel === 'string' && schluessel.startsWith('bk:');
  // the slot is the running number among the bk tracks by ascending nr (bkSlot in project/model.ts), read from the project as it is NOW: a bk track
  // beyond BK_LIVE_SLOTS would have no core row, its knobs take the release path (one spur_aendern); a track the project does not list yet keeps the live path
  const slotLive = () => {
    const n = bkSlotNr(ctx.st?.projekt?.spuren ?? [spur], spur.id);
    return n === null || n <= BK_LIVE_SLOTS;
  };
  // P2: the knob follows its core row spur/<slot>/bk/<k> (a controller moves the row, nothing is sent from here). Per param: the project value and the row value last seen
  // and what was shown; whichever changed since wins, so a project value that arrives (the write-back, Cypher, undo) replaces the row value shown before it.
  const zeile = opt.zeile ?? ((pfad) => globalThis.djk?.regler?.[pfad]);
  const gesehen = new Map();
  const zeilenWert = (param) => {
    if (!bk) return undefined;
    const pfad = bkZeilenPfad(ctx.st?.projekt?.spuren, spur.id, param);
    const w = pfad ? zeile(pfad) : undefined;
    return typeof w === 'number' && Number.isFinite(w) ? w : undefined;
  };
  const folge = (param, projekt) => {
    const z = zeilenWert(param);
    if (z === undefined) { gesehen.delete(param); return projekt; }
    const g = gesehen.get(param);
    let zeigt;
    if (!g) zeigt = z;                          // first look: the row is what plays
    else if (g.p !== projekt) zeigt = projekt;  // the project value came: it holds
    else if (g.z !== z) zeigt = z;              // the row moved since: it holds
    else zeigt = g.zeigt;
    gesehen.set(param, { p: projekt, z, zeigt });
    return zeigt;
  };
  const istLive = (p) => bk && /^k[1-9][0-9]?$/.test(p) && Number(p.slice(1)) <= BK_LIVE_MAX && slotLive();
  const zeitgeber = opt.zeitgeber ?? globalThis, entprellMs = opt.entprellMs ?? BK_LIVE_MS;
  const lebend = new Map();      // live param -> latest value, not sent yet
  let timer = null;
  let gesperrt = false;          // a live send was refused during this gesture: no more live sends until its end
  const live = () => (ctx.st?.projekt?.spuren ?? [spur]).find((s) => s.id === spur.id) ?? null;
  const befehlAus = (p, neu) => {
    const s = (p?.spuren ?? []).find((x) => x.id === spur.id);
    if (!s || geraetSchluessel(s.geraet) !== schluessel) return null;   // the device changed or the track is gone: send nothing
    const werte = surge ? Object.fromEntries(Object.entries(neu).map(([n, v]) => [n, surgeAnzeige(tabelle[n], v)])) : neu;
    return { befehl: 'spur_aendern', spur_id: spur.id, geraet: { ...s.geraet, parameter: { ...(s.geraet.parameter ?? {}), ...werte } } };
  };
  const fertigLive = (param, wert, ok) => {
    if (ok === true) {
      const aktuell = angezeigt.get(param) === wert && !lebend.has(param);   // no newer move of this knob: the project has the value now, the display may follow it
      if (aktuell) { angezeigt.delete(param); opt.beiFertig?.(true); }
      return true;
    }
    gesperrt = true;             // refused (the writer reported it): stop sending, show the stored value again
    if (timer !== null) { zeitgeber.clearTimeout(timer); timer = null; }
    lebend.clear();
    angezeigt.delete(param);
    opt.beiFertig?.(false);
    return false;
  };
  const schickeLive = (param, wert) => {
    const rechne = (p) => {
      const s = (p?.spuren ?? []).find((x) => x.id === spur.id);
      if (!s || geraetSchluessel(s.geraet) !== schluessel) return null;   // the device changed or the track is gone: send nothing
      return { label: `${spur.name}: ${opt.label?.(param) ?? param}`, befehle: [{ befehl: 'geraet_param_setzen', spur_id: spur.id, param, wert }] };
    };
    if (!live()) { angezeigt.delete(param); return undefined; }
    const antwort = typeof ctx.aendereAus === 'function'
      ? ctx.aendereAus(rechne)
      : Promise.resolve().then(() => { const x = rechne(ctx.st?.projekt); return x ? ctx.aendere(x.label, x.befehle) : false; });
    return Promise.resolve(antwort).then((ok) => fertigLive(param, wert, ok), () => fertigLive(param, wert, false));
  };
  const leereLebend = () => {
    if (timer !== null) { zeitgeber.clearTimeout(timer); timer = null; }
    const jobs = [...lebend];
    lebend.clear();
    return jobs.map(([param, wert]) => schickeLive(param, wert)).filter((x) => x !== undefined);
  };
  // Patch field pins (control `matrix`, bk tracks only). A pin is [satz, zeile, spalte, wert]; its place is satz * 256 + zeile * 16 + spalte. stifte() = the pins as shown: the
  // track's own list (else the graph defaults of opt.steckfeld), over it the sets written but not answered yet, over that the single pins moved but not answered yet.
  // stiftSetzen() sends the light command geraet_stift_setzen at most once per 30 ms per place with the latest value, stiftEnde() the rest at once (a refusal stops the live
  // sends of the gesture and the display goes back to the project); stifteSetzen() sends one geraet_stifte_setzen for a whole set (copy, clear).
  const feldNamen = opt.steckfeld ?? null;
  const stiftAngezeigt = new Map();   // place -> value shown until its own write was answered (0 = removed)
  const stiftLebend = new Map();      // place -> latest value, not sent yet
  const satzErsatz = new Map();       // satz -> the pins shown for the whole set until its write was answered
  let stiftTimer = null, stiftGesperrt = false;
  const ort = (e) => e[0] * 256 + e[1] * 16 + e[2];
  const stiftLabel = (satz, zeile, spalte) => `Pin ${feldNamen?.zeilen?.[zeile] ?? zeile + 1} > ${feldNamen?.spalten?.[spalte] ?? spalte + 1}${satz ? ' (B)' : ''}`;
  const stiftBefehl = (befehl, label) => {
    const rechne = (p) => {
      const sp = (p?.spuren ?? []).find((x) => x.id === spur.id);
      if (!sp || geraetSchluessel(sp.geraet) !== schluessel) return null;   // the device changed or the track is gone: send nothing
      return { label: `${spur.name}: ${label}`, befehle: [befehl] };
    };
    const antwort = typeof ctx.aendereAus === 'function'
      ? ctx.aendereAus(rechne)
      : Promise.resolve().then(() => { const x = rechne(ctx.st?.projekt); return x ? ctx.aendere(x.label, x.befehle) : false; });
    return Promise.resolve(antwort);
  };
  const stiftFertig = (p, wert, ok) => {
    if (ok === true) {
      if (stiftAngezeigt.get(p) === wert && !stiftLebend.has(p)) { stiftAngezeigt.delete(p); opt.beiFertig?.(true); }   // no newer move of this place: the project has it now
      return true;
    }
    stiftGesperrt = true;   // refused (the writer reported it): stop sending, show the stored pins again
    if (stiftTimer !== null) { zeitgeber.clearTimeout(stiftTimer); stiftTimer = null; }
    stiftLebend.clear();
    stiftAngezeigt.clear();
    opt.beiFertig?.(false);
    return false;
  };
  const schickeStift = (e) => {
    if (!live()) { stiftAngezeigt.delete(e.ort); return undefined; }
    return stiftBefehl({ befehl: 'geraet_stift_setzen', spur_id: spur.id, satz: e.satz, zeile: e.zeile, spalte: e.spalte, wert: e.wert }, stiftLabel(e.satz, e.zeile, e.spalte))
      .then((ok) => stiftFertig(e.ort, e.wert, ok), () => stiftFertig(e.ort, e.wert, false));
  };
  const leereStifte = () => {
    if (stiftTimer !== null) { zeitgeber.clearTimeout(stiftTimer); stiftTimer = null; }
    const jobs = [...stiftLebend.values()];
    stiftLebend.clear();
    return jobs.map(schickeStift).filter((x) => x !== undefined);
  };
  const stiftApi = {
    stifte() {
      const roh = live()?.geraet?.stifte ?? feldNamen?.stifte ?? [];
      const je = new Map();
      for (const e of roh) if (!satzErsatz.has(e[0])) je.set(ort(e), e);
      for (const liste of satzErsatz.values()) for (const e of liste) je.set(ort(e), e);
      for (const [o, w] of stiftAngezeigt) { if (w === 0) je.delete(o); else je.set(o, [o >> 8, (o >> 4) & 15, o & 15, w]); }
      return [...je.values()].sort((a, b) => ort(a) - ort(b));
    },
    stiftSetzen(satz, zeile, spalte, wert) {
      const o = satz * 256 + zeile * 16 + spalte;
      stiftAngezeigt.set(o, wert);
      if (stiftGesperrt) return;   // refused earlier in this gesture: the pin only previews
      stiftLebend.set(o, { ort: o, satz, zeile, spalte, wert });
      if (stiftTimer === null) stiftTimer = zeitgeber.setTimeout(() => { stiftTimer = null; leereStifte(); }, entprellMs);   // a fixed interval, like the knobs
    },
    stiftEnde() {
      const antworten = leereStifte();   // the last value of every place goes out at once (nothing when it was sent already)
      if (stiftGesperrt) { stiftGesperrt = false; stiftAngezeigt.clear(); }
      return antworten.length ? Promise.all(antworten).then((r) => r.every((x) => x === true)) : undefined;
    },
    stifteSetzen(satz, liste) {
      const gut = (liste ?? []).filter((e) => e[0] === satz && e[3] !== 0).map((e) => [e[0], e[1], e[2], e[3]]);
      const davor = leereStifte();   // pins moved a moment ago go out first: the queue keeps the order
      for (const o of [...stiftAngezeigt.keys()]) if (o >> 8 === satz) stiftAngezeigt.delete(o);
      satzErsatz.set(satz, gut);
      const fertig = (ok) => { if (satzErsatz.get(satz) === gut) satzErsatz.delete(satz); opt.beiFertig?.(ok === true); return ok === true; };
      if (!live()) return fertig(false);
      return Promise.all([...davor, stiftBefehl({ befehl: 'geraet_stifte_setzen', spur_id: spur.id, satz, stifte: gut }, `Patch field set ${satz ? 'B' : 'A'}`).then(fertig, () => fertig(false))]).then((r) => r.at(-1));
    },
  };
  return {
    ...(bk ? stiftApi : {}),
    get(param) {
      if (angezeigt.has(param)) return angezeigt.get(param);
      const w = live()?.geraet?.parameter?.[param];
      const p = w === undefined ? vorgabe[param] : surge && tabelle[param] ? surgeNorm(tabelle[param], w) : w;
      return bk ? folge(param, p) : p;
    },
    set(param, v) {
      if (surge) {
        const vorhanden = new Set([...Object.keys(live()?.geraet?.parameter ?? {}), ...offen]);
        if (!vorhanden.has(param) && vorhanden.size >= SURGE_MAX) {
          if (!abgelehnt) opt.melde?.(GERAET_TEXT.zuViele, true);
          abgelehnt = true;
          return;
        }
      }
      if (istLive(param)) {
        angezeigt.set(param, v);
        if (gesperrt) return;   // refused earlier in this gesture: the knob only previews, nothing goes out
        lebend.set(param, v);
        if (timer === null) timer = zeitgeber.setTimeout(() => { timer = null; leereLebend(); }, entprellMs);   // a fixed interval: a further set() does not restart it
        return;
      }
      angezeigt.set(param, v); offen.add(param);
    },
    ende() {
      const liveAntworten = leereLebend();   // the last live value goes out at once (nothing when it was sent already)
      if (gesperrt) { gesperrt = false; for (const n of [...angezeigt.keys()]) if (istLive(n)) angezeigt.delete(n); }
      if (!offen.size) {
        if (abgelehnt) { abgelehnt = false; opt.beiFertig?.(false); }
        return liveAntworten.length ? Promise.all(liveAntworten).then((r) => r.every((x) => x === true)) : undefined;
      }
      abgelehnt = false;
      const namen = [...offen], neu = Object.fromEntries(namen.map((n) => [n, angezeigt.get(n)]));
      offen.clear();
      const label = `${spur.name}: ${namen.map((n) => opt.label?.(n) ?? n).join(', ')}`;
      const rechne = (p) => { const b = befehlAus(p, neu); return b ? { label, befehle: [b] } : null; };
      const fertig = (ok) => {
        for (const n of namen) if (!offen.has(n) && angezeigt.get(n) === neu[n]) angezeigt.delete(n);
        opt.beiFertig?.(ok === true);
      };
      if (!live()) { for (const n of namen) angezeigt.delete(n); return undefined; }
      const antwort = typeof ctx.aendereAus === 'function'
        ? ctx.aendereAus(rechne)
        : Promise.resolve().then(() => { const x = rechne(ctx.st?.projekt); return x ? ctx.aendere(x.label, x.befehle) : false; });
      return Promise.resolve(antwort).then((ok) => { fertig(ok); return ok; }, () => { fertig(false); return false; });
    },
  };
}

/** The parameter table of a Surge track with `vorgabe` = the travel of the value the host plays now, for the names the track's map does not hold yet
 *  (GET /proj/spur/<id>/geraet/ist). A host that does not answer leaves the table as it is, with a message. */
export async function surgeIstEinlesen(ctx, spur, parameter, namen) {
  const gespeichert = spur.geraet?.parameter ?? {};
  const offen = namen.filter((n) => !(n in gespeichert) && parameter.some((p) => p.name === n)).slice(0, 64);
  if (!offen.length) return parameter;
  let r = null;
  try { r = await ctx.holeGet(`/proj/spur/${encodeURIComponent(spur.id)}/geraet/ist?namen=${offen.join(',')}`); } catch { /* reported below */ }
  const werte = r?.status === 200 ? r.j?.werte : null;
  if (!werte) { ctx.melde?.(GERAET_TEXT.istFehlt, false); return parameter; }
  return parameter.map((p) => (typeof werte[p.name] === 'number' && Number.isFinite(werte[p.name]) ? { ...p, vorgabe: surgeNorm(p, werte[p.name]) } : p));
}

/** {"<knob nr>": {min, max, log, mitte?, vorgabe?}} of the bk parameters k<n> of the table, for the readouts of panel.js (rb338 has no such lookup: percent of travel). */
export function reglerBereiche(parameter) {
  const r = {};
  for (const p of parameter ?? []) { const m = /^k(\d+)$/.exec(p.name); if (m) r[m[1]] = { min: p.min, max: p.max, log: !!p.log, ...(p.mitte !== undefined ? { mitte: p.mitte } : {}), ...(typeof p.vorgabe === 'number' ? { vorgabe: p.vorgabe } : {}) }; }
  return r;
}

/**
 * The view in `wurzel`. zeige(spur) shows the panel of a track (spur null or without a view: removes it) and returns whether a panel is shown/loading.
 * The same track with the same device is not rebuilt, only refreshed from the project. opt: { dokument?, kopfBauer? (default baueKopf), bestaetige?, breit? (the wide plate, `fp-breit`: the workbench) }.
 */
export function bindeGeraetAnsicht(ctx, wurzel, opt = {}) {
  const d = opt.dokument ?? globalThis.document;
  const kopfBauer = opt.kopfBauer ?? baueKopf;
  if (Array.isArray(ctx.beimEreignis) && !modVerdrahtet.has(ctx)) { modVerdrahtet.add(ctx); modAnzeigeAnschluss(ctx); }   // /zustand/mod -> MOD_STAND (also in a window without track heads)
  const zuletzt = new Map();   // spur id -> id of the last applied preset
  let register = null;         // GET /presets/register, fetched by the view itself and again after a save
  let jetzt = null;            // { spurId, schluessel, fp, adapter, nr }
  let zaehler = 0;
  // P2: a core row of this panel's bk knobs moved (a controller): the knobs read again, nothing is sent. Subscribed while a panel is built, let go in weg().
  let abmelden = null;
  const zeileBewegt = (pfad) => {
    if (!jetzt?.fp || !jetzt.adapter || !/^spur\/\d+\/bk\/\d+$/.test(pfad)) return;
    if (/^spur\/(\d+)\//.exec(pfad)?.[1] === String(bkSlotNr(ctx.st?.projekt?.spuren, jetzt.spurId))) jetzt.fp.aktualisiere();
  };
  const weg = () => { zaehler++; abmelden?.(); abmelden = null; jetzt?.fp?.zerstoere(); jetzt = null; wurzel.replaceChildren(); };
  const holeRegister = async () => {
    try { const r = await ctx.holeGet('/presets/register'); if (r?.status === 200) register = r.j?.register ?? register; } catch { /* the header keeps the old list */ }
  };
  const text = (t) => { const p = d.createElement('p'); p.textContent = t; wurzel.replaceChildren(p); };

  async function baue(spur) {
    const nr = ++zaehler, g = spur.geraet;
    jetzt = { spurId: spur.id, schluessel: geraetSchluessel(g), fp: null, adapter: null, nr };
    abmelden?.(); abmelden = zeilenAbo(zeileBewegt);
    text(GERAET_TEXT.laedt);
    const r = await ctx.holeGet(anfrage(g));
    if (nr !== zaehler) return;   // another track or none was opened meanwhile
    const j = r?.j;
    if (r?.status !== 200 || !j) { jetzt.fehler = true; text(`${GERAET_TEXT.fehler}: ${j?.text ?? j?.fehler ?? `HTTP ${r?.status ?? 'none'}`}`); return; }
    if (!j.panel) { text(GERAET_TEXT.keins); return; }
    const namen = {};   // param -> label of its control, for the undo step
    for (const c of steuerungen(j.panel)) for (const pn of parameterVon(c)) namen[pn] ??= c.label ?? c.id;
    let tabelle = j.parameter;
    if (istSurge(g)) tabelle = await surgeIstEinlesen(ctx, spur, j.parameter, Object.keys(namen));   // untouched parameters show what the host plays, not 0.5
    if (nr !== zaehler) return;
    const adapter = spurAdapter(ctx, spur, tabelle, { label: (pn) => namen[pn] ?? pn, steckfeld: j.steckfeld, melde: (t, f) => { if (t) ctx.melde(t, f); }, beiFertig: (ok) => { if (!ok && jetzt?.nr === nr) jetzt.fp?.aktualisiere(true); } });
    // MIDI learn (opt.lernen, device_learn.js; the device window gives it): a Baukasten knob is learned on its core row spur/<slot>/bk/<k>, read from the project as it is now
    const lernen = g.name === 'bk' && opt.lernen ? opt.lernen : null;
    if (lernen) adapter.lernPfad = (pn) => bkZeilenPfad(ctx.st.projekt?.spuren ?? [], spur.id, pn);
    const geraet = istSurge(g) ? { art: 'surge' } : g.name === 'bk' ? { art: 'bk', graph: g.graph } : { art: 'rb338' };
    const melde = (t, f) => { if (t) ctx.melde(t, f); };
    const ziel = { art: 'spur', spur_id: spur.id };
    let kopfHandle = null;
    const sichern = async (name) => {
      let inhalt = null;
      try { const v = await ctx.holeGet('/presets/vokabular'); if (v?.status === 200) inhalt = v.j?.inhalt ?? null; } catch { /* fixed words */ }
      const tag = g.name === 'bk' ? tagVonGraph(g.graph) : '';
      const body = { ziel, name, beschreibung: spurBeschreibung(geraet, inhalt), tags: tag ? [tag] : [] };
      let r = await ctx.holeJson('/presets/von_ziel', body);
      if (r.status === 409 && r.j?.fehler === 'name_vergeben') {
        const frage = opt.bestaetige ?? ((t) => globalThis.confirm?.(t));
        if (!frage(`A preset named "${name}" already exists. Overwrite it?`)) return { ok: false, text: 'Not saved' };
        r = await ctx.holeJson('/presets/von_ziel', { ...body, ueberschreiben: true });
      }
      if (r.status !== 200 && r.status !== 201) return { ok: false, text: `Not saved: ${r.j?.text ?? r.j?.fehler ?? `HTTP ${r.status}`}` };
      await holeRegister();
      kopfHandle?.neu();
      return { ok: true, text: `Preset "${name}" saved` };
    };
    const kopf = (kz) => {
      kopfHandle = kopfBauer(kz, {
        titel: j.panel.title ?? spur.name, akzent: j.panel.akzent, geraet,
        register: () => register,
        aktiv: () => zuletzt.get(spur.id) ?? '',
        melde,
        anwenden: async (id) => {
          const e = (register?.eintraege ?? []).find((x) => (x.id ?? `${x.herkunft}:${x.geraet}/${x.slug}`) === id);
          const ok = await wendePresetAn(ctx, { id, name: e?.name ?? id }, ziel);
          if (ok) zuletzt.set(spur.id, id);
          return { ok, text: ok ? `Preset "${e?.name ?? id}" applied` : '' };   // a refusal was shown by wendePresetAn
        },
        sichern,
        ...(lernen && opt.lernKopf !== false ? { lernen: { an: () => lernen.an(), umschalten: () => lernen.umschalten() } } : {}),   // lernKopf false: the caller shows LEARN itself (device window: next to SAVE MAPPING)
      });
      if (!register) holeRegister().then(() => kopfHandle?.neu());
    };
    jetzt.adapter = adapter;
    const jetztMs = () => globalThis.performance?.now?.() ?? Date.now();
    jetzt.fp = baueFrontplatte(wurzel, { panel: j.panel, steckfeld: j.steckfeld,
      ...(g.name === 'bk' ? { modKnopf: (pn) => bkModKnopf(ctx.st?.projekt, spur.id, pn, adapter.get(pn) ?? 0.5, jetztMs()) } : {}), regler: reglerBereiche(j.parameter), parameter: g.name === 'bk' ? undefined : parameterNachName(j.parameter), adapter, dokument: d, kopf: istSurge(g) ? undefined : kopf, breit: opt.breit === true,
      ...(lernen ? { lernen: lernen.stand(), beiLernen: (pfad) => lernen.lerne(pfad), beiVergessen: (pfad) => lernen.vergiss(pfad) } : {}),
      ...(typeof opt.beiSeite === 'function' ? { beiSeite: (id) => opt.beiSeite(spur.id, id) } : {}) });
    jetzt.kopfNeu = () => kopfHandle?.neu();   // Surge has no preset header
  }

  return {
    /** The learn state changed (opt.lernen): the marks of the panel and the LEARN toggle of the header follow. */
    /** Show a page (tab) of the panel that is built, by its id (a controller program moved to it). */
    zeigeSeite(id) { jetzt?.fp?.zeigeSeite?.(id); },
    lernenNeu() { if (opt.lernen && jetzt?.fp) { jetzt.fp.setzeLernen?.(opt.lernen.stand()); jetzt.kopfNeu?.(); } },
    zeige(spur) {
      if (!spur || !kannGeraetAnsicht(spur)) { if (jetzt) weg(); return false; }
      const schluessel = geraetSchluessel(spur.geraet);
      if (jetzt && jetzt.spurId === spur.id && jetzt.schluessel === schluessel) { jetzt.fp?.aktualisiere(); return true; }
      if (jetzt) weg();
      baue(spur).catch((e) => { if (jetzt) jetzt.fehler = true; text(`${GERAET_TEXT.fehler}: ${e.message}`); });
      return true;
    },
    /** A click on the device label: a view that ended in a load error is dropped, so the next zeige() loads it again. */
    wiederhole() { if (jetzt?.fehler) weg(); },
    /** For tests and callers: the live panel handle (null while loading). */
    handle: () => jetzt?.fp ?? null,
  };
}
