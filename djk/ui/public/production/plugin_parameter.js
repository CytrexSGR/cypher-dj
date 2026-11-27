// PRODUCTION (plan 1.11 task 11): the generic parameter list of a foreign plugin stage (host insert). A plugin may have several hundred parameters, so the
// list is one string of rows (no per-row listeners: one delegated handler), a filter field narrows it, and slider moves are collected and sent every 30 ms (throttle, not a pause wait) as
// ONE POST /proj/insert/<id>/param {werte: {<index>: <0..1>}}. The server owns the values; the project never holds them (a host stage has `werte: {}`).
import { merkePluginParameter, MAX_PLUGIN_LANEN } from './lanes.js';
export const PARAM_ENTPRELLEN_MS = 30;
export const LANE_VOLL_TEXT = '16 lanes per plugin';   // = MAX_PLUGIN_LANEN in lanes.js

const html = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// the value as the plugin shows it: the real range when it has one, else the position in percent
export function paramWertText(q, wert) {
  const w = Math.min(Math.max(Number(wert) || 0, 0), 1);
  const spanne = Number.isFinite(q?.min) && Number.isFinite(q?.max) && q.max !== q.min;
  if (!spanne) return `${Math.round(w * 100)} %`;
  const v = q.min + w * (q.max - q.min);
  const t = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  return q.einheit ? `${t} ${q.einheit}` : t;
}
// the lane button of a row: active when the parameter has a lane, disabled (with the title) while the stage holds the maximum of lanes
export const laneKnopfZustand = (index, lanen, max) => {
  const hat = lanen.has(index);
  const voll = lanen.size >= max;
  return { aktiv: hat, gesperrt: !hat && voll, titel: hat ? 'This parameter has a lane' : voll ? LANE_VOLL_TEXT : 'Create a lane for this parameter' };
};
// the MIDI button of a row (strand 2 task 2.5): zustand is 'wartet' (armed, waits for a controller) or 'frage' (assigned row clicked once: forget?), else null.
// q.knopf / q.gelernt come from the parameter list. Assigned and learned: "K<n>"; assigned without a CC (learn timed out): the plain button again.
export const midiKnopfZustand = (q, zustand) => {
  const m = Number(q?.knopf) || 0;
  if (zustand === 'wartet') return { text: 'Move a controller…', titel: 'Waiting for a controller: move a knob or slider on it', klasse: ' wartet' };
  if (zustand === 'frage' && m) return { text: `Forget K${m}`, titel: 'Click again to forget this controller assignment', klasse: ' frage' };
  if (m && q.gelernt) return { text: `K${m}`, titel: `Controller knob ${m} drives this parameter: click to forget`, klasse: ' an' };
  return { text: 'MIDI', titel: 'Assign a MIDI controller to this parameter', klasse: '' };
};
// the rows whose name contains the text (case-insensitive); an empty text keeps all
export function paramFilter(liste, text) {
  const t = String(text ?? '').trim().toLowerCase();
  return t === '' ? liste : liste.filter((q) => String(q.name).toLowerCase().includes(t));
}
const laneHtml = (q, z) => `<button type="button" class="p-hp-lane${z.aktiv ? ' an' : ''}" data-index="${q.index}" title="${html(z.titel)}"`
  + ` aria-pressed="${z.aktiv}"${z.gesperrt ? ' disabled' : ''} aria-label="Lane for ${html(q.name)}">Lane</button>`;
const midiHtml = (q, zustand) => {
  const z = midiKnopfZustand(q, zustand);
  return `<button type="button" class="p-hp-midi${z.klasse}" data-index="${q.index}" title="${html(z.titel)}" aria-label="MIDI controller for ${html(q.name)}">${html(z.text)}</button>`;
};
// lanen: the Set of parameter indices that have a lane (null: this list offers no lane button); max: lanes per stage
const zeileHtml = (q, lanen, max, midi) => `<label class="p-hp-zeile${lanen ? ' p-hp-mit-lane' : ''}" data-index="${q.index}">`
  + `<span class="p-hp-name" title="${html(q.name)}">${html(q.name)}</span>`
  + `<input type="range" class="p-hp-regler" min="0" max="1" step="0.001" value="${Number(q.wert) || 0}" data-index="${q.index}" aria-label="${html(q.name)}">`
  + `<output class="p-hp-wert">${html(paramWertText(q, q.wert))}</output>${lanen ? laneHtml(q, laneKnopfZustand(q.index, lanen, max)) : ''}`
  + `${midi ? midiHtml(q, midi.get(q.index)) : ''}</label>`;
// midi: Map index -> 'wartet' | 'frage' (null: this list offers no MIDI button)
export const paramListeHtml = (liste, lanen = null, max = 16, midi = null) => liste.map((q) => zeileHtml(q, lanen, max, midi)).join('');

// Builds the popover content into `el`. holeListe(): Promise<{status, j}> of GET .../parameter; sende(werte): Promise of the POST. Returns {zeige, neu}.
/** The parameter routes answer {..., parameter: [...]}; a bare array is accepted too. Returns the answer with `j` as the array when it is one. */
export const alsListe = (r) => (r && r.status === 200 && !Array.isArray(r.j) && Array.isArray(r.j?.parameter) ? { ...r, j: r.j.parameter } : r);
// lane (optional, effect stages only): {insertId, anlegen(index, wert): Promise<boolean>}; the rows then carry a "Lane" button.
// midi (optional, effect stages only): {lernen(index): Promise<{status}>, loeschen(index): Promise<{status}>}; a click on a row's "MIDI" button arms the learn
// flow (the row waits until the parameter list reports `gelernt`), a click on an assigned row asks "Forget Kn" and a second click forgets it.
// The returned setzeLanen(indices) tells the list which parameters have a lane (the page takes it from the project).
export const MIDI_WARTEN_MS = 1000, MIDI_FRIST_MS = 60000;   // poll interval while a row waits, and when it gives up (the learn flow times out)
export function baueParameterListe(el, { holeListe, sende, fehler, lane = null, midi = null }) {
  el.innerHTML = '<input type="search" class="p-hp-filter" placeholder="Filter parameters" aria-label="Filter parameters">'
    + '<span class="p-hp-zahl"></span><div class="p-hp-liste" role="group" aria-label="Plugin parameters"></div>';
  const feld = el.querySelector('.p-hp-filter'), liste = el.querySelector('.p-hp-liste'), zahl = el.querySelector('.p-hp-zahl');
  let alle = [], offen = {}, timer = null, lanen = new Set();
  const midiZustand = new Map();   // index -> 'wartet' | 'frage'
  let midiTimer = null, midiBis = 0;
  const zeige = () => {
    const t = paramFilter(alle, feld.value);
    liste.innerHTML = paramListeHtml(t.map((q) => ({ ...q, wert: offen[q.index] ?? q.wert })), lane ? lanen : null, MAX_PLUGIN_LANEN, midi ? midiZustand : null);
    zahl.textContent = t.length === alle.length ? `${alle.length} parameters` : `${t.length} of ${alle.length}`;
  };
  const schicke = async () => {
    timer = null;
    const werte = offen; offen = {};
    const r = await sende(werte);
    if (r && r.status === 200 && r.j?.werte) {
      for (const q of alle) if (String(q.index) in r.j.werte) q.wert = r.j.werte[q.index];
    } else { for (const q of alle) if (String(q.index) in werte) q.wert = werte[q.index]; if (r && r.status !== 200) fehler?.(r); }
  };
  liste.addEventListener('click', (e) => {
    const b = e.target.closest?.('.p-hp-lane');
    if (!b || !lane || b.disabled) return;
    const idx = Number(b.dataset.index), q = alle.find((x) => x.index === idx);
    if (!q || lanen.has(idx) || lanen.size >= MAX_PLUGIN_LANEN) return;   // an existing lane: the button is active and does nothing
    lanen.add(idx); zeige();                                              // at once, so a second click cannot create the lane twice
    Promise.resolve(lane.anlegen(idx, offen[idx] ?? q.wert)).then((ok) => { if (ok === false) { lanen.delete(idx); zeige(); } });
  });
  // while a row waits for its controller the list is asked again (knopf/gelernt only: a slider under the hand keeps its value)
  const midiFrage = async () => {
    midiTimer = null;
    if (!el.isConnected || ![...midiZustand.values()].includes('wartet')) return;
    const l = alsListe(await holeListe());
    if (l.status === 200 && Array.isArray(l.j)) {
      for (const n of l.j) {
        const q = alle.find((x) => x.index === n.index);
        if (!q) continue;
        q.knopf = n.knopf; q.gelernt = n.gelernt;
        if (n.gelernt && midiZustand.get(n.index) === 'wartet') midiZustand.delete(n.index);
      }
    }
    if (Date.now() > midiBis) { for (const [k, v] of midiZustand) if (v === 'wartet') midiZustand.delete(k); }
    zeige();
    if ([...midiZustand.values()].includes('wartet')) midiTimer = setTimeout(midiFrage, MIDI_WARTEN_MS);
  };
  liste.addEventListener('click', async (e) => {
    const b = e.target.closest?.('.p-hp-midi');
    if (!b || !midi) return;
    const idx = Number(b.dataset.index), q = alle.find((x) => x.index === idx);
    if (!q || midiZustand.get(idx) === 'wartet') return;
    for (const [k, v] of midiZustand) if (v === 'frage' && k !== idx) midiZustand.delete(k);
    if (q.knopf && midiZustand.get(idx) !== 'frage' && q.gelernt) { midiZustand.set(idx, 'frage'); zeige(); return; }
    if (midiZustand.get(idx) === 'frage') {
      midiZustand.delete(idx); zeige();
      const r = await midi.loeschen(idx);
      if (r && r.status === 200) { q.knopf = undefined; q.gelernt = undefined; } else if (r) fehler?.(r);
      zeige();
      return;
    }
    midiZustand.set(idx, 'wartet'); zeige();
    const r = await midi.lernen(idx);
    if (r && r.status === 200) {
      q.knopf = r.j?.knopf ?? q.knopf;
      midiBis = Date.now() + MIDI_FRIST_MS;
      if (midiTimer === null) midiTimer = setTimeout(midiFrage, MIDI_WARTEN_MS);
    } else { midiZustand.delete(idx); if (r) fehler?.(r); }
    zeige();
  });
  liste.addEventListener('input', (e) => {
    const r = e.target.closest?.('.p-hp-regler');
    if (!r) return;
    const idx = Number(r.dataset.index), v = Number(r.value), q = alle.find((x) => x.index === idx);
    r.closest('.p-hp-zeile').querySelector('.p-hp-wert').textContent = paramWertText(q, v);
    offen[idx] = v;
    if (timer === null) timer = setTimeout(schicke, PARAM_ENTPRELLEN_MS);   // a fixed-interval throttle: a further move does not restart the timer, so a long drag sends while it goes on
  });
  feld.addEventListener('input', zeige);
  const neu = async () => {
    zahl.textContent = 'Loading…';
    const r = await holeListe();
    const l = alsListe(r);
    if (l.status === 200 && Array.isArray(l.j)) {
      alle = l.j;
      if (lane) merkePluginParameter(lane.insertId, alle);
      zeige();
    } else { alle = []; liste.textContent = ''; zahl.textContent = ''; fehler?.(r); }
  };
  neu();
  return { zeige, neu, setze: (l) => { alle = l; zeige(); }, setzeLanen: (indizes) => {
    const neu = new Set(indizes);
    if (neu.size === lanen.size && [...neu].every((x) => lanen.has(x))) return;   // unchanged: no redraw under the hand
    lanen = neu; zeige();
  } };
}
