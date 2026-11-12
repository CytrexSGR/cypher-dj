// PRODUCTION (front panels, task 8): the device view on an instrument track (bk graph, RB-338). A click on the device label of the track head opens the
// front panel of the device in the detail area (detail.js mode `geraet`, like the rack panel). The panel comes from GET /geraete/panel; its values live in
// spur.geraet.parameter (normalised 0..1, an absent one is the `vorgabe` of the parameter table).
// A drag moves a control at once (the panel keeps the value) but sends nothing; at the end of the gesture (panel.js calls adapter.ende) ONE spur_aendern goes out
// with the whole device and the new values: one write, one undo step, and the graph instance of the track stays (the general path of spur_aendern).
import { baueFrontplatte, steuerungen, parameterVon } from '../panel.js';
import { baueKopf, spurBeschreibung, tagVonGraph } from '../panel_kopf.js';
import { parameterNachName } from '../panel_display.js';
import { wendePresetAn } from './preset_apply.js';
import { surgeAnzeige, surgeNorm } from '../surge_adapter.js';

export const SURGE_MAX = 32;   // = SURGE_PARAMETER_MAX of project/model.ts (a page file cannot import the .ts; tests/production_device_view.test.mjs pins them equal)

export const GERAET_TEXT = {
  titel: 'DEVICE',
  laedt: 'Loading the device panel…',
  keins: 'This device has no panel.',
  istFehlt: 'The Surge values of the host could not be read; untouched knobs show defaults',
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
 * opt: { label(param) -> control label (undo step "<track>: <label>"), beiFertig(ok) }.
 */
export function spurAdapter(ctx, spur, parameter = [], opt = {}) {
  const schluessel = geraetSchluessel(spur.geraet);
  const vorgabe = Object.fromEntries(parameter.map((p) => [p.name, p.vorgabe]));
  const tabelle = Object.fromEntries(parameter.map((p) => [p.name, p]));
  const surge = schluessel === 'surge';   // the project holds DISPLAY values of Surge (surge_bereiche.json ranges); the panel works in travel 0..1
  let abgelehnt = false;                  // a 33rd name was refused during the running gesture
  const angezeigt = new Map();   // param -> value shown until the server answered
  const offen = new Set();       // params set by the running gesture, not sent yet
  const live = () => (ctx.st?.projekt?.spuren ?? [spur]).find((s) => s.id === spur.id) ?? null;
  const befehlAus = (p, neu) => {
    const s = (p?.spuren ?? []).find((x) => x.id === spur.id);
    if (!s || geraetSchluessel(s.geraet) !== schluessel) return null;   // the device changed or the track is gone: send nothing
    const werte = surge ? Object.fromEntries(Object.entries(neu).map(([n, v]) => [n, surgeAnzeige(tabelle[n], v)])) : neu;
    return { befehl: 'spur_aendern', spur_id: spur.id, geraet: { ...s.geraet, parameter: { ...(s.geraet.parameter ?? {}), ...werte } } };
  };
  return {
    get(param) {
      if (angezeigt.has(param)) return angezeigt.get(param);
      const w = live()?.geraet?.parameter?.[param];
      return w === undefined ? vorgabe[param] : surge && tabelle[param] ? surgeNorm(tabelle[param], w) : w;
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
      angezeigt.set(param, v); offen.add(param);
    },
    ende() {
      if (!offen.size) { if (abgelehnt) { abgelehnt = false; opt.beiFertig?.(false); } return undefined; }
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
  if (!werte) { ctx.melde?.(GERAET_TEXT.istFehlt, true); return parameter; }
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
 * The same track with the same device is not rebuilt, only refreshed from the project. opt: { dokument?, kopfBauer? (default baueKopf) }.
 */
export function bindeGeraetAnsicht(ctx, wurzel, opt = {}) {
  const d = opt.dokument ?? globalThis.document;
  const kopfBauer = opt.kopfBauer ?? baueKopf;
  const zuletzt = new Map();   // spur id -> id of the last applied preset
  let register = null;         // GET /presets/register, fetched by the view itself and again after a save
  let jetzt = null;            // { spurId, schluessel, fp, adapter, nr }
  let zaehler = 0;
  const weg = () => { zaehler++; jetzt?.fp?.zerstoere(); jetzt = null; wurzel.replaceChildren(); };
  const holeRegister = async () => {
    try { const r = await ctx.holeGet('/presets/register'); if (r?.status === 200) register = r.j?.register ?? register; } catch { /* the header keeps the old list */ }
  };
  const text = (t) => { const p = d.createElement('p'); p.textContent = t; wurzel.replaceChildren(p); };

  async function baue(spur) {
    const nr = ++zaehler, g = spur.geraet;
    jetzt = { spurId: spur.id, schluessel: geraetSchluessel(g), fp: null, adapter: null, nr };
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
    const adapter = spurAdapter(ctx, spur, tabelle, { label: (pn) => namen[pn] ?? pn, melde: (t, f) => { if (t) ctx.melde(t, f); }, beiFertig: (ok) => { if (!ok && jetzt?.nr === nr) jetzt.fp?.aktualisiere(true); } });   // no lernPfad: LEARN is not offered
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
      });
      if (!register) holeRegister().then(() => kopfHandle?.neu());
    };
    jetzt.adapter = adapter;
    jetzt.fp = baueFrontplatte(wurzel, { panel: j.panel, regler: reglerBereiche(j.parameter), parameter: g.name === 'bk' ? undefined : parameterNachName(j.parameter), adapter, dokument: d, kopf: istSurge(g) ? undefined : kopf });   // Surge has no preset header
  }

  return {
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
