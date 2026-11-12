// PRODUCTION (front panels task 12): an automatic front panel for a plugin (host insert or instrument), built on the page from the parameter list
// the host answers (plugin_parameter.js). Pure: autoPanelAusListe / parameterAusListe make data, pluginAdapter sends through the list's own send path.
// A list row: {index, name, wert (0..1), min?, max?, einheit?, stufen?: [names] | schritte?: n}. Parameters are addressed by their index (a string).
export const PANEL_MAX_REGLER = 64;   // controls on the panel; the rest stays reachable through the list
const SEITE = 8;                      // controls per section (as devices_parameter.ts autoPanel)
const kuerze = (s, n) => { const t = String(s ?? ''); return t.length <= n ? t : t.slice(0, n).trimEnd(); };
const endlich = (x) => typeof x === 'number' && Number.isFinite(x);

// the option names of a stepped row (2..8), or null: `stufen` as texts, or `schritte` as a count (options "1".."n")
export function stufenVon(q) {
  if (Array.isArray(q?.stufen) && q.stufen.length >= 2 && q.stufen.length <= 8) return q.stufen.map((o, i) => kuerze(String(o).trim() || String(i + 1), 12));
  if (Number.isInteger(q?.schritte) && q.schritte >= 2 && q.schritte <= 8) return Array.from({ length: q.schritte }, (_, i) => String(i + 1));
  return null;
}
const label = (q) => kuerze(String(q.name ?? '').trim() || `Param ${q.index}`, 24);

/** The list -> a cypherdj-panel/2 for geraet {art:'plugin', name}: knob per parameter (selector when the list says it is stepped), sections of 8, at most 64 controls. */
export function autoPanelAusListe(liste, titel) {
  const rows = (Array.isArray(liste) ? liste : []).filter((q) => q && q.index !== undefined && q.index !== null).slice(0, PANEL_MAX_REGLER);
  const sections = [];
  for (let s = 0; s * SEITE < rows.length; s++) {
    const teil = rows.slice(s * SEITE, (s + 1) * SEITE), von = s * SEITE + 1;
    const controls = teil.map((q) => {
      const c = { id: `p${String(q.index).replace(/[^a-z0-9_-]/gi, '_').toLowerCase().slice(0, 22)}`, label: label(q), bind: { param: String(q.index) } };
      const st = stufenVon(q);
      if (st) {
        c.type = 'selector'; c.options = st;
        c.default = Math.min(st.length - 1, Math.max(0, Math.round((endlich(q.wert) ? Math.min(1, Math.max(0, q.wert)) : 0) * (st.length - 1))));
      } else {
        c.type = 'knob';
        if (endlich(q.wert) && q.wert >= 0 && q.wert <= 1 && q.wert !== 0.5) c.default = q.wert;
        if (q.einheit) c.unit = kuerze(q.einheit, 8);
      }
      return c;
    });
    sections.push({ id: `s${s + 1}`, title: `PARAMETERS ${von}-${von + teil.length - 1}`, cols: Math.min(4, teil.length), controls });
  }
  const name = kuerze(titel || 'Plugin', 40);
  return { format: 'cypherdj-panel/2', geraet: { art: 'plugin', name }, title: name, sections };
}

/** {param: Parameter entry} for the readouts of baueFrontplatte (panel_display.js): the list's real range and unit when it states one (the same text as the
 *  list's own value text, plugin_parameter.js paramWertText), else 0..1 shown as percent. Stepped rows carry their options. */
export function parameterAusListe(liste) {
  const aus = {};
  for (const q of Array.isArray(liste) ? liste : []) {
    if (q?.index === undefined || q.index === null) continue;
    const spanne = endlich(q.min) && endlich(q.max) && q.max !== q.min;
    const st = stufenVon(q);
    aus[String(q.index)] = { name: String(q.index), label: label(q), min: spanne ? q.min : 0, max: spanne ? q.max : 1, log: false, ...(spanne && q.einheit ? { einheit: q.einheit } : {}),
      vorgabe: endlich(q.wert) ? q.wert : 0.5, ...(st ? { stufen: st } : {}) };
  }
  return aus;
}

/** The adapter of baueFrontplatte over the list's send path: set() collects and sends ONE sende(werte) with the latest values every `entprellMs` (30 ms, a
 *  fixed-interval throttle: the timer is not restarted by a further set(), so a long turn sends while it goes on), ende() sends at once. sende(werte): Promise<{status, j}> of POST .../param {werte: {<index>: 0..1}}; the server's answer {werte} corrects the shown values. */
export function pluginAdapter(liste, { sende, fehler, entprellMs = 30, zeitgeber = globalThis } = {}) {
  const wert = {}, offen = {};
  for (const q of Array.isArray(liste) ? liste : []) if (q?.index !== undefined && endlich(q.wert)) wert[String(q.index)] = q.wert;
  let timer = null;
  const schicke = async () => {
    if (timer !== null) { zeitgeber.clearTimeout(timer); timer = null; }
    const werte = { ...offen };
    for (const p of Object.keys(werte)) delete offen[p];
    if (!Object.keys(werte).length) return;
    const r = await sende(werte);
    if (r && r.status === 200 && r.j?.werte) { for (const [p, v] of Object.entries(r.j.werte)) if (!(p in offen) && endlich(v)) wert[p] = v; }
    else if (r && r.status !== 200) fehler?.(r);
  };
  return {
    get: (p) => wert[String(p)],
    set: (p, v) => { wert[String(p)] = v; offen[String(p)] = v; if (timer === null) timer = zeitgeber.setTimeout(schicke, entprellMs); },
    ende: schicke,
  };
}
