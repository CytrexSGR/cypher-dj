// Live host panels: adapters of the front panel over POST /klang {gruppe, aktion:'param', name, wert 0..1} (the host takes normalised values).
// RB-338 hosts name their parameters like the plug-in (Volume, Square, ...), Cypher Modular hosts `Knob n`; the panels use `lautstaerke`.. and `k<n>`.
// Pure apart from the injected post/timer, no DOM.
const KNOB_ANZAHL_MAX = 64;

/** Panel parameter of the RB-338 hand panel -> parameter name of the plug-in in the host (lib.rs). */
export const RB338_HOST_NAME = { lautstaerke: 'Volume', wellenform: 'Square', cutoff: 'Cutoff', resonanz: 'Resonance', env_mod: 'Env Mod', decay: 'Decay', accent: 'Accent' };

/** Panel name k<n> <-> host name `Knob n`. */
export const knobHostName = (param) => { const m = /^k([1-9]|[1-5][0-9]|6[0-4])$/.exec(param); return m ? `Knob ${m[1]}` : null; };
export const hostKnobName = (name) => { const m = /^Knob ([1-9]|[1-5][0-9]|6[0-4])$/.exec(name); return m ? `k${m[1]}` : null; };

/**
 * Adapter over a host: set() sends the latest value per parameter every `wartMs` (40) as {gruppe, aktion:'param', name: hostName(param), wert}. get() = the last value
 * sent, else the value the host reported (`ist`: {panel param: 0..1}, read when the panel was built), else undefined (the panel default). A refused send forgets the
 * value (get() falls back to the host's reading) and calls beiAbgelehnt().
 * With opt.kanal (the channel, 'erz/2') the adapter has lernPfad(param) = `<kanal>/host/<host name>`, the key of host learn (POST /lernen/host {kanal, name}).
 * opt: { gruppe, kanal?, hostName(param) -> string | null, ist?, post(pfad, body) -> {ok, code, j}, melde?(text, fehler), beiAbgelehnt?(), wartMs?, timer?: {setTimeout} }.
 */
export function hostAdapter(opt) {
  const wartMs = opt.wartMs ?? 40, setze = opt.timer?.setTimeout ?? globalThis.setTimeout;
  const ist = { ...(opt.ist ?? {}) }, gesendet = new Map(), warte = new Map(), neu = new Map();
  const zurueck = (param) => { gesendet.delete(param); opt.beiAbgelehnt?.(); };
  return {
    ...(opt.kanal ? { lernPfad: (param) => { const n = opt.hostName(param); return n ? `${opt.kanal}/host/${n}` : undefined; } } : {}),
    get: (param) => gesendet.get(param) ?? (typeof ist[param] === 'number' ? ist[param] : undefined),
    set(param, v) {
      const name = opt.hostName(param);
      if (name === null || name === undefined) return;
      gesendet.set(param, v);
      neu.set(param, v);
      if (warte.has(param)) return;
      warte.set(param, setze(async () => {
        warte.delete(param);
        let a;
        try { a = await opt.post('/klang', { gruppe: opt.gruppe, aktion: 'param', name, wert: neu.get(param) }); }
        catch (e) { opt.melde?.(`Knob not sent: ${e.message}`, true); zurueck(param); return; }
        if (!a.ok) { opt.melde?.(`Knob refused: ${a.j?.text ?? a.j?.fehler ?? a.code}`, true); zurueck(param); }
      }, wartMs));
    },
  };
}

/** Host reading (aktion 'params': {host name: 0..1}) -> {panel param: 0..1} through the inverse name table; unknown or non-numeric entries drop out. */
export function istVonHost(params, hostZuPanel) {
  const aus = {};
  for (const [name, w] of Object.entries(params ?? {})) { const p = hostZuPanel(name); if (p && typeof w === 'number' && Number.isFinite(w)) aus[p] = Math.min(1, Math.max(0, w)); }
  return aus;
}
export const rb338HostZuPanel = (name) => Object.entries(RB338_HOST_NAME).find(([, h]) => h === name)?.[0] ?? null;

/** The graph (name of an entry of GET /graphen) a Cypher Modular host plays, found by its knob names: `namen` = {'Knob n': label} of POST /klang params, `graphen` the
 *  list of GET /graphen ({name, art, regler_namen: {n: label}}). The host does not report the graph name; only an instrument graph with EXACTLY these names counts.
 *  Null when there are no names, none or several graphs fit (then the caller shows the automatic panel). */
export function graphDesHosts(namen, graphen) {
  const a = Object.entries(namen ?? {}).map(([k, v]) => [hostKnobName(k)?.slice(1), v]).filter(([n]) => n);
  if (!a.length) return null;
  const gleich = (g) => { const b = Object.entries(g.regler_namen ?? {}); return b.length === a.length && a.every(([n, v]) => g.regler_namen[n] === v); };
  const treffer = (graphen ?? []).filter((g) => g.art === 'instrument' && gleich(g));
  return treffer.length === 1 ? treffer[0].name : null;
}

/** Automatic cypherdj-panel/2 for the knobs a host reports ({'Knob n': value}, names {'Knob n': label}): sections of 8 knobs, params k<n>. Null without knobs. */
export function baukastenAutoPanel(params, namen = {}) {
  const nrs = [];
  for (let n = 1; n <= KNOB_ANZAHL_MAX; n++) if (typeof params?.[`Knob ${n}`] === 'number') nrs.push(n);
  if (!nrs.length) return null;
  const sections = [];
  for (let s = 0; s * 8 < nrs.length; s++) {
    const teil = nrs.slice(s * 8, s * 8 + 8);
    sections.push({ id: `s${s + 1}`, title: `KNOBS ${teil[0]}-${teil.at(-1)}`, cols: Math.min(4, teil.length),
      controls: teil.map((n) => ({ id: `k${n}`, type: 'knob', label: String(namen?.[`Knob ${n}`] || `Knob ${n}`).slice(0, 24), bind: { param: `k${n}` } })) });
  }
  return { format: 'cypherdj-panel/2', geraet: { art: 'bk', graph: 'host' }, title: 'Cypher Modular', akzent: 'orange', sections };
}

// ---- host learn (MIDI learn onto host parameters through the slot rows erz/2|3/bk/n; the server keeps the table, GET /lernen/host) ----
/** The key of a host control (adapter.lernPfad): `<kanal>/host/<name>`; z = an entry of GET /lernen/host `ziele` ({kanal, name}). */
export const hostSchluessel = (z) => `${z.kanal}/host/${z.name}`;
/** key -> {kanal, name}, the body of POST /lernen/host and /lernen/host/loeschen. */
export const hostZiel = (schluessel) => { const [kanal, name] = String(schluessel).split('/host/'); return { kanal, name }; };
/** What a host panel needs to mark its controls: `ziele` of GET /lernen/host, `wartetPfad` the armed slot row (or null/undefined), `an` the LEARN mode of the channel. */
export function hostLernStand(ziele, wartetPfad, kanal, an) {
  const w = (ziele ?? []).find((z) => z.kanal === kanal && z.pfad === wartetPfad);
  return { an: !!an, wartet: w ? hostSchluessel(w) : null, gelernt: new Set((ziele ?? []).filter((z) => z.kanal === kanal && z.gelernt).map(hostSchluessel)) };
}
/** The request a click on a host control makes: the armed control again cancels (POST /lernen {pfad: null}), anything else arms (POST /lernen/host). */
export function hostLernAnfrage(schluessel, ziele, wartetPfad) {
  const z = (ziele ?? []).find((x) => hostSchluessel(x) === schluessel);
  return z && wartetPfad && wartetPfad === z.pfad ? { pfad: '/lernen', daten: { pfad: null } } : { pfad: '/lernen/host', daten: hostZiel(schluessel) };
}
