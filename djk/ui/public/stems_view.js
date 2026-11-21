// The generic group view of a `stems` place (container core, lane U, U4): one row per track of the place's group with a fader and a mute, nothing else.
// There is no LOAD here: the tracks come with the group. The four nodes section.stemsplatz[data-stems="N"] are built once; slots_view.js shows the
// node of the place that holds a stems group and hides the others. Writes go through POST /proj/aendern (spur_aendern), the rows follow the live project.
import { $, $$, el, melde, zustand } from './page_state.js';
import { live, holeJson, pruefeLiveSpaeter } from './live_view.js';
import { gruppeVon } from './slots.js';

const PLAETZE = [1, 2, 3, 4];
const FARBE = { 1: 'var(--a)', 2: 'var(--b)', 3: 'var(--d3)', 4: 'var(--d3)' };
const FADER_MIN = -60, FADER_MAX = 6;
const knoten = new Map();
const dbText = (db) => (db <= FADER_MIN ? '−∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`.replace('-', '−'));

/** The tracks of the group `id` in track order: the tracks that play into it. */
export const stemsSpuren = (projekt, id) => (id ? (projekt?.spuren ?? []).filter((s) => s?.ausgang?.id === id) : []);

async function schreibe(spur, feld, wert) {
  const p = live.projekt;
  if (!p) return;
  const label = `Stems ${spur.name}: ${feld === 'mute' ? (wert ? 'mute' : 'unmute') : 'volume'}`;
  const r = await holeJson('/proj/aendern', { rev: p.rev ?? live.rev, label, befehle: [{ befehl: 'spur_aendern', spur_id: spur.id, [feld]: wert }] });
  if (r.status !== 200) melde(`${label} refused: ${r.j?.text ?? r.j?.fehler ?? r.status}`, true);
  pruefeLiveSpaeter(0);   // the rows follow the project, not the answer
}

function baueZeile(spur) {
  const z = el('div', 'st-zeile');
  z.dataset.spur = spur.id;
  const name = el('span', 'st-name', spur.name);
  const fader = el('input', 'st-fader');
  fader.type = 'range'; fader.min = String(FADER_MIN); fader.max = String(FADER_MAX); fader.step = '0.5';
  fader.setAttribute('aria-label', `Volume ${spur.name}`);
  const wert = el('output', 'st-wert');
  const mute = el('button', 'st-mute', 'M');
  mute.setAttribute('aria-label', `Mute ${spur.name}`);
  fader.addEventListener('input', () => { wert.textContent = dbText(Number(fader.value)); });
  fader.addEventListener('change', () => schreibe(z._spur, 'fader_db', Number(fader.value)));
  mute.addEventListener('click', () => schreibe(z._spur, 'mute', !z._spur.mute));
  z.append(name, fader, wert, mute);
  return z;
}
function zeigeZeile(z, spur) {
  z._spur = spur;
  $('.st-name', z).textContent = spur.name;
  const fader = $('.st-fader', z);
  if (document.activeElement !== fader) fader.value = String(Math.max(FADER_MIN, Math.min(FADER_MAX, spur.fader_db ?? 0)));
  $('.st-wert', z).textContent = dbText(spur.fader_db ?? 0);
  const m = $('.st-mute', z);
  m.classList.toggle('an', spur.mute === true);
  m.setAttribute('aria-pressed', String(spur.mute === true));
}

function zeichnePlatz(n) {
  const k = knoten.get(n);
  if (!k) return;
  const liste = $('.st-liste', k), spuren = stemsSpuren(live.projekt, gruppeVon(zustand.plaetze, n));
  const vorhanden = $$('.st-zeile', liste);
  if (vorhanden.length !== spuren.length || vorhanden.some((z, i) => z.dataset.spur !== spuren[i].id)) {   // another set of tracks: rebuild the rows
    liste.textContent = '';
    for (const s of spuren) liste.append(baueZeile(s));
  }
  $$('.st-zeile', liste).forEach((z, i) => zeigeZeile(z, spuren[i]));
  $('.st-leer', k).hidden = spuren.length > 0;
}

/** Draws the rows of every stems place from the live project. */
export function zeichneStems() { for (const n of PLAETZE) zeichnePlatz(n); }

function bauePlatz(n) {
  const k = el('section', 'stemsplatz deckflaeche');
  k.dataset.stems = String(n);
  k.dataset.platzBody = 'stems';
  k.hidden = true;
  k.style.setProperty('--farbe', FARBE[n]);
  k.setAttribute('aria-label', `Stems ${n}`);
  const kopf = el('div', 'deckkopf');
  kopf.append(el('span', 'decktitel', 'STEMS'));
  const leer = el('div', 'st-leer', 'This group has no tracks');
  leer.hidden = true;
  k.append(kopf, el('div', 'st-liste'), leer);
  $('#pult').append(k);
  knoten.set(n, k);
}

/** Builds the four nodes once; called from app.js before the places are applied. */
export function baueStemsPlaetze() { for (const n of PLAETZE) bauePlatz(n); }
