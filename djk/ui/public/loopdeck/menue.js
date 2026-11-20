// Loop deck cell menu (plan loop deck P3): rename, colour, loop / one-shot, gain, length in beats, clear. One menu node per deck, opened by a
// right click or the small handle on a filled cell. Every entry hands one body (without deck, track, cell) to `sende`; the caller posts it
// to /loopdeck/zelle and shows a refusal. This module knows no network and no deck state.
import { el } from '../page_state.js';
import { FARBEN } from './model.js';

const zahl = (t) => { const s = String(t).trim().replace(',', '.'); const x = s === '' ? NaN : Number(s); return Number.isFinite(x) ? x : null; };

// sende(body) is called with { name } | { farbe } | { art } | { gain_db } | { beats } | { leeren: true }.
export function baueMenue(sende) {
  const knoten = el('div', 'ld-zellmenue'); knoten.hidden = true; knoten.setAttribute('role', 'menu');
  let offen = false;
  const titel = el('div', 'ld-mtitel', '');
  const zeile = (art, text) => { const z = el('div', 'ld-meintrag'); z.dataset.eintrag = art; z.append(el('span', 'ld-mname', text)); return z; };
  const feld = (typ, klasse, titelText) => { const f = el('input', klasse); f.type = typ; f.setAttribute('type', typ); f.title = titelText; return f; };

  const name = zeile('name', 'Rename'), nameFeld = feld('text', 'ld-mfeld', 'New name (Enter to apply)'); nameFeld.maxLength = 64;
  name.append(nameFeld);
  const farbe = zeile('farbe', 'Colour'), farben = el('span', 'ld-farben');
  const tuerkise = FARBEN.map((f, i) => {
    const b = el('button', 'ld-farbe'); b.type = 'button'; b.dataset.farbe = String(i); b.title = `Colour ${i + 1}`; b.style.background = f;
    b.addEventListener('click', () => { sende({ farbe: i }); schliesse(); });
    farben.append(b); return b;
  });
  farbe.append(farben);
  const art = zeile('art', 'Type'), artKnoepfe = {};
  for (const [wert, text] of [['loop', 'Loop'], ['einmal', 'One-shot']]) {
    const b = el('button', 'ld-art-wahl', text); b.type = 'button'; b.dataset.art = wert;
    b.addEventListener('click', () => { sende({ art: wert }); schliesse(); });
    art.append(b); artKnoepfe[wert] = b;
  }
  const gain = zeile('gain', 'Gain (dB)'), gainFeld = feld('number', 'ld-mfeld', 'Cell gain in dB'); gainFeld.step = '0.5';
  gain.append(gainFeld);
  const beats = zeile('beats', 'Length (beats)'), beatsFeld = feld('number', 'ld-mfeld', 'Length of the loop in beats'); beatsFeld.min = '1'; beatsFeld.step = '1';
  beats.append(beatsFeld);
  const leeren = el('button', 'ld-meintrag ld-leeren', 'Clear'); leeren.type = 'button'; leeren.dataset.eintrag = 'leeren'; leeren.title = 'Remove the audio from this cell';
  leeren.addEventListener('click', () => { sende({ leeren: true }); schliesse(); });

  nameFeld.addEventListener('change', () => { const t = nameFeld.value.trim(); if (t) { sende({ name: t }); schliesse(); } });
  gainFeld.addEventListener('change', () => { const x = zahl(gainFeld.value); if (x !== null) { sende({ gain_db: x }); schliesse(); } });
  beatsFeld.addEventListener('change', () => { const x = zahl(beatsFeld.value); if (x !== null && x > 0) { sende({ beats: x }); schliesse(); } });
  knoten.addEventListener('keydown', (e) => { if (e.key === 'Escape') schliesse(); });
  knoten.append(titel, name, farbe, art, gain, beats, leeren);

  // The menu stays inside the deck container (the place clips what sticks out): below the cell when it fits, else above it; left and top are
  // limited to the visible area; a menu taller than the deck gets max-height and scrolls.
  function platziere(wurzel, anker) {
    knoten.style.maxHeight = '';
    const w = wurzel.getBoundingClientRect(), a = anker.getBoundingClientRect(), m = knoten.getBoundingClientRect();
    const breite = m.width || 190, rand = 2;
    const hoch = Math.min(m.height || 0, Math.max(40, w.height - 2 * rand));
    if (m.height && hoch < m.height) knoten.style.maxHeight = `${Math.round(hoch)}px`;
    const unten = a.bottom - w.top, oben = a.top - w.top - hoch;
    let top = unten + hoch + rand <= w.height ? unten : oben >= rand ? oben : Math.max(rand, w.height - hoch - rand);
    top = Math.max(rand, Math.min(top, w.height - hoch - rand));
    const left = Math.max(0, Math.min(a.left - w.left, w.width - breite - rand));
    knoten.style.left = `${Math.round(left)}px`; knoten.style.top = `${Math.round(top)}px`;
  }
  // z: the ZelleSicht of the cell; anker: the cell node (the menu sits below it, inside the deck container)
  function oeffne(z, anker) {
    titel.textContent = z.name;
    nameFeld.value = z.name;
    tuerkise.forEach((b, i) => { b.classList.toggle('an', i === z.farbe); });
    for (const [w, b] of Object.entries(artKnoepfe)) { b.classList.toggle('an', w === z.art); b.setAttribute('aria-pressed', String(w === z.art)); }
    gainFeld.value = String(z.gain_db ?? 0);
    beats.hidden = z.art === 'einmal';   // the length only exists for a loop
    beatsFeld.value = z.beats ? String(z.beats) : '';
    knoten.hidden = false; offen = true;
    const wurzel = knoten.parentElement;
    if (wurzel && anker) platziere(wurzel, anker);
  }
  function schliesse() { knoten.hidden = true; offen = false; }
  return { knoten, oeffne, schliesse, istOffen: () => offen };
}

// Effect slot choice (channel strip PZ2): one small menu node per deck, opened by the chip of a track. Entries: one button per qualifying graph
// (the short name, the graph name as title), then On / Off and Remove when a stage is set. `sende(body)` gets { graph } | { graph: '' } | { an }.
// The caller owns the request, the refusal text and the placement context; this module knows no network.
export function baueFxMenue(sende) {
  const knoten = el('div', 'ld-fxmenue'); knoten.hidden = true; knoten.setAttribute('role', 'menu');
  let offen = false, spur = null;
  function oeffne(graphen, effekt, anker, spurNr) {
    knoten.replaceChildren();
    for (const g of graphen) {
      const b = el('button', 'ld-fxwahl', g.kurz); b.type = 'button'; b.dataset.graph = g.name; b.title = g.name;
      b.classList.toggle('an', effekt?.graph === g.name);
      b.addEventListener('click', () => { sende({ graph: g.name }); schliesse(); });
      knoten.append(b);
    }
    if (!graphen.length) knoten.append(el('span', 'ld-fxleer', 'No effects available'));
    if (effekt) {
      const an = el('button', 'ld-fxeintrag', effekt.an ? 'Off' : 'On'); an.type = 'button'; an.dataset.eintrag = 'an';
      an.addEventListener('click', () => { sende({ an: !effekt.an }); schliesse(); });
      const weg = el('button', 'ld-fxeintrag', 'Remove'); weg.type = 'button'; weg.dataset.eintrag = 'weg'; weg.title = 'Remove the effect from this track';
      weg.addEventListener('click', () => { sende({ graph: '' }); schliesse(); });
      knoten.append(an, weg);
    }
    knoten.hidden = false; offen = true; spur = spurNr;
    const wurzel = knoten.parentElement;
    if (wurzel && anker) {   // below the chip, inside the deck container; above it when it does not fit
      const w = wurzel.getBoundingClientRect(), a = anker.getBoundingClientRect(), m = knoten.getBoundingClientRect();
      const breite = m.width || 120, hoch = m.height || 0, rand = 2;
      const unten = a.bottom - w.top;
      const top = unten + hoch + rand <= w.height ? unten : Math.max(rand, a.top - w.top - hoch);
      knoten.style.left = `${Math.round(Math.max(0, Math.min(a.right - w.left - breite, w.width - breite - rand)))}px`; knoten.style.top = `${Math.round(top)}px`;
    }
  }
  function schliesse() { knoten.hidden = true; offen = false; spur = null; }
  knoten.addEventListener('keydown', (e) => { if (e.key === 'Escape') schliesse(); });
  return { knoten, oeffne, schliesse, istOffen: () => offen, spurNr: () => spur };
}
