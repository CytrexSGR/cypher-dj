// Workbench region SHELF (plan task 3: the empty state, task 10: the shelf strip below the three columns, tab MODULES only, D13). The empty state sits in the `leer` host: the text, one button per
// template, "+ empty module" (a name field, Enter creates) and "Open module…" (a select of the modules). Opening or creating is the person's click and
// goes through ctx.oeffneModul / ctx.neuesModul (live-container confirmation, nothing else). Lists are fetched on show and after a module change.
import { WERKBANK_TEXT } from './werkbank.js';

// liste: GET /proj/liste (an array); vorlagen: GET /proj/werkbank/vorlagen ({vorlagen: [...]}) or the array; slug: the open module.
export function regalEintraege(liste, vorlagen, slug) {
  // a broken entry (fehler) has no marker to read: it is kept so the person sees it, disabled
  const module = (Array.isArray(liste) ? liste : []).filter((x) => x?.werkbank === true || x?.fehler)
    .map((x) => ({
      slug: x.slug, name: x.name, offen: x.slug === slug,
      ...(x.geaendert ? { geaendert: x.geaendert } : {}), ...(x.fehler ? { fehler: x.fehler, text: x.text ?? x.fehler } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const v = Array.isArray(vorlagen) ? vorlagen : Array.isArray(vorlagen?.vorlagen) ? vorlagen.vorlagen : [];
  return { module, vorlagen: v.map(({ id, name, text }) => ({ id, name, text })) };
}

const REGAL_HINT = 'click = open the module · changes are saved as you make them';
const datum = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : '');
const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const karteBau = (klasse, name, zeile, marke) => {
  const k = el('button', `w-karte ${klasse}`);
  k.append(el('b', '', name), el('span', '', zeile));
  if (marke) k.append(el('i', 'w-marke', marke));
  return k;
};

// a function: werkbank.js imports this file and WERKBANK_TEXT is not defined yet while this file is evaluated
const leerGeruest = () => `
<p class="w-leer-text" data-w="leer-text"></p>
<div class="w-vorlagen" data-w="vorlagen"></div>
<div class="w-leer-zeile">
  <button data-w="leer-neu">${WERKBANK_TEXT.leeresModul}</button>
  <input data-w="leer-name" placeholder="${WERKBANK_TEXT.neuerName}" maxlength="60" aria-label="New module name" hidden>
  <select data-w="leer-oeffnen" aria-label="Open module"><option value="">${WERKBANK_TEXT.oeffnen}</option></select>
</div>
`;

export function bindeRegal(ctx) {
  const { st, $ } = ctx;
  const leer = $('leer');
  leer.innerHTML = leerGeruest();
  const zeigeText = () => { $('leer-text').textContent = st.fremd ? WERKBANK_TEXT.keinWerkbank : WERKBANK_TEXT.keinModul; };
  zeigeText();

  // The shelf strip: header (label, the only tab, hint) and the cards. One fetch feeds the strip and the empty state (no second list code).
  const regal = $('regal');
  regal.replaceChildren(el('div', 'w-regal-kopf'), el('div', 'w-karten'));
  regal.firstChild.append(el('span', 'w-lbl', 'SHELF'), el('span', 'w-tab on', 'MODULES'), el('span', 'w-hinweis', REGAL_HINT));
  const kartenHost = regal.children[1];
  let stand = { liste: null, vorlagen: null };

  function zeichneKarten(e) {
    const karten = e.module.map((m) => {
      const k = karteBau(m.fehler ? 'kaputt' : m.offen ? 'offen' : 'modul', m.name, m.fehler ? 'unreadable' : datum(m.geaendert), m.offen ? 'open' : '');
      if (m.offen || m.fehler) k.disabled = true;
      if (m.fehler) k.setAttribute('title', m.text);
      // the click re-checks the live state: a card drawn before a change must not reopen the open module
      k.addEventListener('click', () => { if (!m.fehler && m.slug !== st.slug) aktion(() => ctx.oeffneModul(m.slug)); });
      return k;
    });
    const vorlagen = e.vorlagen.map((v) => {
      const k = karteBau('vorlage', v.name, v.text ?? '', 'template');
      k.addEventListener('click', () => aktion(() => ctx.neuesModul({ name: v.name, vorlage: v.id })));
      return k;
    });
    // a div, not a button: an input inside a button is invalid and does not take clicks in every browser
    const neu = el('div', 'w-karte neu'); neu.setAttribute('role', 'button'); neu.setAttribute('tabindex', '0');
    neu.append(el('b', '', WERKBANK_TEXT.leeresModul));
    const feld = el('input', 'w-karte-name');
    feld.setAttribute('data-w', 'regal-name'); feld.setAttribute('placeholder', WERKBANK_TEXT.neuerName);
    feld.setAttribute('maxlength', '60'); feld.setAttribute('aria-label', 'New module name'); feld.hidden = true;
    const frageName = () => { feld.hidden = false; feld.value = ''; feld.focus?.(); };
    neu.addEventListener('click', frageName);
    neu.addEventListener('keydown', (ev) => { if (ev.target === neu && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); frageName(); } });
    feld.addEventListener('click', (ev) => ev.stopPropagation());
    feld.addEventListener('keydown', (ev) => {
      ev.stopPropagation();   // the library keys of the page stay out of the field
      if (ev.key === 'Escape') { feld.hidden = true; return; }
      if (ev.key !== 'Enter' || feld.value.trim() === '') return;
      const name = feld.value.trim();
      feld.hidden = true;
      aktion(() => ctx.neuesModul({ name }));
    });
    neu.append(feld);
    kartenHost.replaceChildren(...karten, ...vorlagen, neu);
  }
  // open or create, then fetch the shelf again (the open mark and the dates move)
  async function aktion(tue) { await tue(); await lade(); }

  function zeichne(liste, vorlagen) {
    stand = { liste, vorlagen };
    const e = regalEintraege(liste, vorlagen, st.slug);
    zeichneKarten(e);
    const host = $('vorlagen');
    host.replaceChildren(...e.vorlagen.map((v) => {
      const b = document.createElement('button');
      b.className = 'w-vorlage'; b.title = v.text ?? ''; b.textContent = v.name;
      b.addEventListener('click', () => ctx.neuesModul({ name: v.name, vorlage: v.id }));
      return b;
    }));
    const s = $('leer-oeffnen');
    s.replaceChildren(...[['', WERKBANK_TEXT.oeffnen], ...e.module.map((m) => [m.slug, m.fehler ? `${m.name} (unreadable)` : m.name])].map(([wert, text]) => {
      const o = document.createElement('option'); o.value = wert; o.textContent = text; return o;
    }));
    for (const m of e.module) if (m.fehler) { const o = [...s.children].find((x) => x.value === m.slug); if (o) o.disabled = true; }
  }
  let unterwegs = null, nochmal = false;
  function lade() {
    if (unterwegs) { nochmal = true; return unterwegs; }   // a request in flight may predate the change: fetch once more after it
    unterwegs = (async () => {
      do {
        nochmal = false;
        const [l, v] = await Promise.all([ctx.holeGet('/proj/liste'), ctx.holeGet('/proj/werkbank/vorlagen')]);
        zeichne(l.status === 200 ? l.j : null, v.status === 200 ? v.j : null);
      } while (nochmal);
    })().finally(() => { unterwegs = null; });
    return unterwegs;
  }

  $('leer-neu').addEventListener('click', () => { const f = $('leer-name'); f.hidden = false; f.value = ''; f.focus(); });
  $('leer-name').addEventListener('keydown', async (e) => {
    e.stopPropagation();   // the library keys of the page stay out of the field
    const f = $('leer-name');
    if (e.key === 'Escape') { f.hidden = true; return; }
    if (e.key !== 'Enter' || f.value.trim() === '') return;
    const name = f.value.trim();
    f.hidden = true;
    await ctx.neuesModul({ name });
  });
  $('leer-oeffnen').addEventListener('change', async () => {
    const s = $('leer-oeffnen'), slug = s.value;
    s.value = '';
    if (slug) await ctx.oeffneModul(slug);
  });

  ctx.beimSichtwechsel.push((sichtbar) => { if (sichtbar) lade(); });
  ctx.beimProjekt.push((p, wechsel) => {
    zeigeText();
    if (!st.sichtbar) return;
    if (wechsel) lade(); else if (stand.liste || stand.vorlagen) zeichneKarten(regalEintraege(stand.liste, stand.vorlagen, st.slug));
  });
}
