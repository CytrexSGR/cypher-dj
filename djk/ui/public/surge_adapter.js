// Front panels task 11: Surge XT live. The panel works in normalised 0..1 travel; Surge takes DISPLAY values (the range of surge_bereiche.json, first and
// last point of `punkte`); the travel goes through the `punkte` curve like the readouts of panel_display.js. Pure apart from the injected post/timer, no DOM.
import { punkteWert, punkteNorm } from './panel_display.js';

/** Display value of travel `norm` (0..1) of a Parameter entry {min, max, punkte?}: piecewise linear over the `punkte` curve of surge_bereiche.json (the
 *  response of Surge itself), else linear over min..max. */
export const surgeAnzeige = (p, norm) => (p.punkte?.length >= 2 ? punkteWert(p.punkte, norm) : p.min + Math.min(1, Math.max(0, norm)) * (p.max - p.min));
/** Travel (0..1) of a display value (inverse of surgeAnzeige); a degenerate range gives 0. */
export const surgeNorm = (p, wert) => (p.punkte?.length >= 2 && p.punkte[0] !== p.punkte.at(-1) ? punkteNorm(p.punkte, wert)
  : p.max === p.min ? 0 : Math.min(1, Math.max(0, (wert - p.min) / (p.max - p.min))));

const gesendet = new Map();   // `${gruppe}|${param}` -> last travel sent; survives panel rebuilds (the host reports no Surge values)

/** Forget what was sent: of one group (the patch of its host changed), or all (tests). */
export function vergesseGesendet(gruppe) {
  for (const k of [...gesendet.keys()]) if (gruppe === undefined || k.startsWith(`${gruppe}|`)) gesendet.delete(k);
}

/**
 * Adapter of the Surge panel on instrument group `gruppe` ('bass' = erz/2, 'melodie' = erz/3). set() sends POST /klang {gruppe, aktion:'fahre', parameter,
 * ziel: display value, sekunden: 0.03}, the latest value per parameter every `wartMs` (40). get() = last value sent, else the value the host reported
 * (`ist`: {name: display value}, read by the page when the panel is built; it replaces what was remembered, the host knows best), else the `vorgabe`.
 * A refused send forgets the value of that parameter and calls beiAbgelehnt(). With opt.kanal (the channel, 'erz/2') the adapter has lernPfad(param) =
 * `<kanal>/host/<param>`: the key of host learn (POST /lernen/host {kanal, name}); without it LEARN is not offered.
 * opt: { kanal?, parameter: Parameter[], ist?, post(pfad, body) -> {ok, code, j}, melde(text, fehler), lies?(names), beiAbgelehnt?(), wartMs?, timer?: {setTimeout} }.
 */
export function surgeAdapter(gruppe, opt) {
  const tabelle = Object.fromEntries((opt.parameter ?? []).map((p) => [p.name, p]));
  const wartMs = opt.wartMs ?? 40, setze = opt.timer?.setTimeout ?? globalThis.setTimeout;
  const warte = new Map(), neu = new Map();
  const schluessel = (param) => `${gruppe}|${param}`;
  const uebernimm = (ist) => { for (const [name, w] of Object.entries(ist ?? {})) if (tabelle[name] && typeof w === 'number' && Number.isFinite(w)) gesendet.set(schluessel(name), surgeNorm(tabelle[name], w)); };
  uebernimm(opt.ist);
  // after a refused or lost send the value shown is the host's again: forget ours, read the host's (opt.lies(names) -> {name: display value}), redraw
  const zurueck = async (param) => {
    gesendet.delete(schluessel(param));
    try { uebernimm(await opt.lies?.([param])); } catch { /* the default stays */ }
    opt.beiAbgelehnt?.();
  };
  return {
    ...(opt.kanal ? { lernPfad: (param) => (tabelle[param] ? `${opt.kanal}/host/${param}` : undefined) } : {}),
    get: (param) => gesendet.get(schluessel(param)) ?? tabelle[param]?.vorgabe,
    set(param, v) {
      const p = tabelle[param];
      if (!p) return;
      gesendet.set(schluessel(param), v);
      neu.set(param, v);
      if (warte.has(param)) return;
      warte.set(param, setze(async () => {
        warte.delete(param);
        let a;
        try { a = await opt.post('/klang', { gruppe, aktion: 'fahre', parameter: param, ziel: surgeAnzeige(p, neu.get(param)), sekunden: 0.03 }); }
        catch (e) { opt.melde?.(`Knob not sent: ${e.message}`, true); await zurueck(param); return; }
        if (!a.ok) { opt.melde?.(`Knob refused: ${a.j?.text ?? a.j?.fehler ?? a.code}`, true); await zurueck(param); }
      }, wartMs));
    },
  };
}

// Plan 2026-11-11 task 9: the button that asks the Surge host to show or hide Surge's own editor window (host command `fenster`, POST /klang fenster).
/** Markup of the header button; `an`: Surge's window is shown (as far as this page knows). */
export const SURGE_FENSTER = '[data-surge-fenster]';
export const surgeFensterKnopf = (an) => `<button type="button" class="fp-fenster" data-surge-fenster aria-pressed="${an ? 'true' : 'false'}" title="${an ? 'Close' : 'Open'} the real Surge window on the studio screen">${an ? 'Close' : 'Open'} Surge window</button>`;
const FENSTER_GRUND = { anzeige_unerreichbar: 'DISPLAY is set but not reachable from the host (wrong display or authority)', keine_anzeige: 'the host has no display (restart the Surge host unit from the studio script)', kein_fenster: 'this Surge build has no editor window' };
/** Sends the request; answers {an: whether the window is shown now, hinweis: a line for under the header ('' when all is well)}. The host's reason is shown, never swallowed. */
export async function surgeFensterSenden(post, gruppe, an) {
  let a;
  try { a = await post('/klang', { gruppe, aktion: 'fenster', an }); } catch (e) { return { an: false, hinweis: `Surge window: ${e.message}` }; }
  if (!a.ok) return { an: false, hinweis: `Surge window refused: ${a.j?.text ?? a.j?.fehler ?? a.code}` };
  if (an && a.j?.fenster !== true) return { an: false, hinweis: `Surge window not shown: ${a.j?.grund ?? 'unknown'}${FENSTER_GRUND[a.j?.grund] ? ` (${FENSTER_GRUND[a.j.grund]})` : ''}` };
  return { an: a.j?.fenster === true, hinweis: '' };
}
