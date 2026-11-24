// The one search field of the browser (browser plan 2, task 13): text and tag chips over every section. The state machine and the chip order are pure
// (tested without a document); baueSuchleiste is the small DOM part. Vocabulary absent (404) = no chip row: the field still filters by name.
import { loeseTag } from './tags_client.js';

export const ARTEN_REIHE = ['typ', 'charakter', 'genre', 'einsatz', 'energie', 'tonart', 'tempo'];

export function neueSuche(a) {
  const warte = a.verzoegerung ?? 250;
  let text = '', tags = [], uhr = null;
  const stand = () => ({ text, tags: [...tags] });
  const melde = () => { clearTimeout(uhr); uhr = null; a.beiAenderung(stand()); };
  return {
    setzeText(t) { text = String(t ?? ''); clearTimeout(uhr); uhr = setTimeout(melde, warte); },
    schalteTag(tag) { tags = tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag]; melde(); },
    // Esc: the text first, the tags second; nothing to clear = no call
    leere() {
      if (text !== '') { text = ''; melde(); } else if (tags.length > 0) { tags = []; melde(); }
    },
    setzeAlles(s) { text = String(s?.text ?? ''); tags = [...new Set(s?.tags ?? [])]; melde(); },   // a saved search: one change, no debounce
    stand,
  };
}

// the vocabulary of GET /tags/vokabular -> chip groups in a fixed order; a kind without words (tempo, free) has no chips (it is typed)
export function chipGruppen(v) {
  const arten = v && Array.isArray(v.arten) ? v.arten : [];
  const aus = [];
  for (const art of ARTEN_REIHE) {
    const a = arten.find((x) => x.art === art);
    if (!a || !Array.isArray(a.woerter) || a.woerter.length === 0) continue;
    aus.push({ art, tags: a.woerter.map((w) => ({ tag: `${art}:${w.wort}`, titel: w.wort })) });
  }
  return aus;
}

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const ARTEN_TITEL = { typ: 'TYPE', charakter: 'CHARACTER', genre: 'GENRE', einsatz: 'USE', energie: 'ENERGY', tonart: 'KEY', tempo: 'TEMPO' };
export const artTitel = (art) => ARTEN_TITEL[art] ?? art.toUpperCase();

// A chip picker (the filter row and the TAG key of a selection): the groups of chipGruppen, one open at a time; onPick gets a full tag.
// Typing a word and Enter asks loeseTag (a bare 140 is a tempo, 8A a key, anything else a free tag).
export function baueChipWahl({ vokabular, gewaehlt = () => [], beiWahl, frei = true }) {
  const w = el('div', 'b-chips');
  const gruppen = chipGruppen(vokabular);
  const koerper = el('div', 'b-chips-koerper');
  const zeichne = (offen) => {
    koerper.textContent = '';
    const an = new Set(gewaehlt());
    for (const g of gruppen) {
      const kopf = el('button', 'b-chips-art', artTitel(g.art)); kopf.type = 'button'; kopf.setAttribute('aria-expanded', String(g.art === offen));
      kopf.addEventListener('click', (e) => { e.stopPropagation(); zeichne(g.art === offen ? null : g.art); });
      koerper.append(kopf);
      if (g.art !== offen) continue;
      const reihe = el('div', 'b-chips-reihe');
      for (const c of g.tags) {
        const b = el('button', 'b-chip', c.titel); b.type = 'button'; b.title = c.tag; b.setAttribute('aria-pressed', String(an.has(c.tag)));
        b.addEventListener('click', (e) => { e.stopPropagation(); beiWahl(c.tag); zeichne(offen); });
        reihe.append(b);
      }
      koerper.append(reihe);
    }
  };
  w.append(koerper);
  let feld = null;
  if (frei) {
    feld = el('input', 'b-name'); feld.type = 'text'; feld.placeholder = 'Type a tag, a tempo or a key, then Enter'; feld.setAttribute('aria-label', 'Add a tag by typing');
    feld.addEventListener('click', (e) => e.stopPropagation());
    feld.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      const t = loeseTag(feld.value, vokabular);
      if (t === null) { feld.title = 'Not a tag of the vocabulary'; return; }
      feld.value = ''; beiWahl(t); zeichne(null);
    });
    w.append(feld);
  }
  zeichne(null);
  return { wurzel: w, zeichne: () => zeichne(null), feld };
}

// Hides the rows of a section whose text does not contain the typed words (client side, immediately). Rows without a .b-text are not list rows.
export function filtereZeilen(wurzel, text) {
  const woerter = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  for (const zeile of wurzel.querySelectorAll('.b-zeile')) {
    const t = zeile.querySelector(':scope > .b-text');
    if (!t) continue;
    const an = woerter.length === 0 || woerter.every((x) => zeile.textContent.toLowerCase().includes(x));
    zeile.classList.toggle('b-gefiltert', !an);
  }
}

// The bar at the top of the browser: the field, SAVE SEARCH, the active chips and the chip groups (a TAGS key opens them)
export function baueSuchleiste({ vokabular, beiAenderung, speichere }) {
  const such = neueSuche({ beiAenderung: (s) => { zeichneAktiv(); beiAenderung(s); } });
  const w = el('div', 'b-suchleiste');
  const feld = el('input', 'b-name b-suchfeld'); feld.type = 'search'; feld.placeholder = 'Search everything'; feld.setAttribute('aria-label', 'Search everything');
  const aktiv = el('div', 'b-chips-aktiv');
  let wahl = null, tagsKnopf = null, merkeKnopf = null;
  const tagsAn = () => such.stand().tags;
  function zeichneAktiv() {
    aktiv.textContent = '';
    for (const t of tagsAn()) {
      const b = el('button', 'b-chip an', t); b.type = 'button'; b.title = 'Remove this tag from the search';
      b.addEventListener('click', () => { such.schalteTag(t); wahl?.zeichne(); });
      aktiv.append(b);
    }
    if (merkeKnopf) merkeKnopf.hidden = !(such.stand().text.trim() || tagsAn().length > 0);
  }
  feld.addEventListener('input', () => such.setzeText(feld.value));
  feld.addEventListener('click', (e) => e.stopPropagation());
  feld.addEventListener('keydown', (e) => {
    e.stopPropagation();   // key B and the other page keys must not fire while typing
    if (e.key === 'Escape') { such.leere(); feld.value = such.stand().text; return; }
    if (e.key === 'Enter' && vokabular) {
      const t = loeseTag(feld.value, vokabular);
      if (t !== null && !t.startsWith('frei:') && feld.value.trim() !== '') { feld.value = ''; such.setzeText(''); such.schalteTag(t); wahl?.zeichne(); }
    }
  });
  const reihe = el('div', 'b-suchreihe');
  reihe.append(feld);
  if (vokabular) {
    tagsKnopf = el('button', 'b-taste', 'TAGS'); tagsKnopf.type = 'button'; tagsKnopf.title = 'Filter by tag'; tagsKnopf.setAttribute('aria-pressed', 'false');
    wahl = baueChipWahl({ vokabular, gewaehlt: tagsAn, beiWahl: (t) => { such.schalteTag(t); wahl.zeichne(); }, frei: true });
    wahl.wurzel.hidden = true;
    tagsKnopf.addEventListener('click', (e) => { e.stopPropagation(); wahl.wurzel.hidden = !wahl.wurzel.hidden; tagsKnopf.setAttribute('aria-pressed', String(!wahl.wurzel.hidden)); });
    reihe.append(tagsKnopf);
  }
  if (speichere) {
    merkeKnopf = el('button', 'b-taste', 'SAVE SEARCH'); merkeKnopf.type = 'button'; merkeKnopf.title = 'Keep this search as a smart collection'; merkeKnopf.hidden = true;
    merkeKnopf.addEventListener('click', (e) => { e.stopPropagation(); speichere(such.stand()); });
    reihe.append(merkeKnopf);
  }
  w.append(reihe, aktiv);
  if (wahl) w.append(wahl.wurzel);
  return {
    wurzel: w, stand: such.stand,
    setze(s) { feld.value = s.text ?? ''; such.setzeAlles(s); wahl?.zeichne(); },
  };
}
