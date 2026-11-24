// TRACKER view, SAVE MODULE and the tracker module shelf (plan 2026-11-18-tracker.md, task 23). A tracker module is a production project with the marker
// `tracker` (project/tracker.ts); every change is saved at once, so "saving" is two things only: SAVE MODULE on a project without the marker sets it
// (tracker_setzen {an: true}, one undo step: the project then shows on the shelf), and with the marker the same button asks for a name and copies the
// project (POST /proj/kopie, SAVE AS). The MODULES button opens the shelf: the entries of GET /proj/liste with tracker: true, sorted by name; a click opens
// one with /proj/oeffnen through the confirmation of the live container (opening closes the live container's modules) and the view stays the TRACKER view.
// The same file is an ordinary project in PRODUCTION: nothing is written there that PRODUCTION does not know.
import { mitBestaetigung } from '../production/project_choice.js';
import { datumText } from '../format_text.js';

export const REGAL_TEXT = {
  gespeichert: 'Saved as a tracker module: it is on the shelf',
  kopiert: (name) => `Saved as ${name}.`,
  leer: 'No tracker module yet. NEW MODULE makes one; SAVE MODULE puts an open PRODUCTION project on this shelf.',
  // the key of the head carries its true name: SAVE MODULE on a project that is none yet, SAVE AS on a marked module
  hinweis: (taste) => `click = open the module · every change is saved at once · ${taste} (in the head) keeps a copy under a new name`,
  speichern: 'SAVE MODULE', speichernUnter: 'SAVE AS',
  speichernTitel: 'Mark the open project as a tracker module: it appears on the MODULES shelf (one undo step)',
  speichernUnterTitel: 'Save a copy of this module under a new name (the module itself saves every change as you make it)',
  nameTitel: 'Name of the copy (Enter saves, Escape gives up)',
  weder: 'The live container and a workbench module have no tracker view',
};
const el = (tag, klasse, t) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (t) e.setAttribute('data-t', t); return e; };

// The shelf entries of a listing (GET /proj/liste, an array): tracker modules only, sorted by name. Pure. A broken entry has no marker to read and is left out.
export function regalEintraege(liste, slug) {
  return (Array.isArray(liste) ? liste : []).filter((x) => x?.tracker === true && !x.fehler)
    .map((x) => ({ slug: x.slug, name: x.name, offen: x.slug === slug, ...(x.geaendert ? { geaendert: x.geaendert } : {}) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'en', { sensitivity: 'base' }));
}

export function bindeRegal(ctx) {
  const { st, $ } = ctx;
  const speichern = $('speichern'), modulKnopf = $('module'), host = $('regal');
  if (!speichern || !modulKnopf || !host) return;

  const feld = el('input', 't-eingabe t-kopie-name', 'speichern-name');
  feld.setAttribute('type', 'text'); feld.setAttribute('maxlength', '80'); feld.setAttribute('title', REGAL_TEXT.nameTitel); feld.setAttribute('aria-label', REGAL_TEXT.nameTitel);
  feld.hidden = true;
  speichern.after(feld);
  const kopf = el('div', 't-regal-kopf'); const hinweis = el('span', 't-regal-hinweis'); hinweis.textContent = REGAL_TEXT.hinweis(REGAL_TEXT.speichern);
  const lbl = el('b', 't-regal-lbl'); lbl.textContent = 'MODULES';
  kopf.append(lbl, hinweis);
  const karten = el('div', 't-regal-karten', 'regal-karten');
  host.append(kopf, karten);
  host.hidden = true;

  const markiert = () => !!st.projekt?.tracker;
  const geeignet = () => !!st.projekt && !st.projekt.live && !st.projekt.werkbank;
  const zeigeKnoepfe = () => {
    speichern.disabled = !geeignet(); modulKnopf.disabled = false;   // the shelf also opens when no project is open
    speichern.textContent = markiert() ? REGAL_TEXT.speichernUnter : REGAL_TEXT.speichern;
    hinweis.textContent = REGAL_TEXT.hinweis(speichern.textContent);
    speichern.setAttribute('title', !st.projekt || geeignet() ? (markiert() ? REGAL_TEXT.speichernUnterTitel : REGAL_TEXT.speichernTitel) : REGAL_TEXT.weder);
    modulKnopf.setAttribute('aria-pressed', String(!host.hidden)); modulKnopf.classList.toggle('an', !host.hidden);
    if (!geeignet() || !markiert()) feld.hidden = true;
  };
  ctx.beimProjekt.push(zeigeKnoepfe);
  ctx.beimZeichnen.push(zeigeKnoepfe);

  // the list is fetched when the shelf opens and after a copy; a late answer of an older fetch does not overwrite a newer one
  let holeNr = 0;
  async function lade() {
    const nr = ++holeNr;
    const r = await ctx.holeGet('/proj/liste');
    if (nr !== holeNr) return;
    if (r.status !== 200) { ctx.melde(ctx.antwortText(r), true); return; }
    const e = regalEintraege(r.j, st.slug);
    if (e.length === 0) { const t = el('p', 't-regal-leer'); t.textContent = REGAL_TEXT.leer; karten.replaceChildren(t); return; }
    karten.replaceChildren(...e.map((m) => {
      const k = el('button', `t-regal-karte${m.offen ? ' offen' : ''}`, 'regal-modul');
      k.setAttribute('type', 'button'); k.setAttribute('data-slug', m.slug);
      const n = document.createElement('b'); n.textContent = m.name;
      const d = document.createElement('span'); d.textContent = m.offen ? 'open' : datumText(m.geaendert);
      k.append(n, d);
      if (m.offen) k.disabled = true;
      // the click re-checks the live state: a card drawn before a change must not reopen the open module
      k.addEventListener('click', () => { if (m.slug !== st.slug) oeffne(m.slug); });
      return k;
    }));
  }
  let oeffnet = false;
  async function oeffne(slug) {
    if (oeffnet) return;
    oeffnet = true;
    try {
      const r = await mitBestaetigung(ctx.holeJson, '/proj/oeffnen', { slug }, (t) => ctx.frage(t));
      if (r.abgelehnt) return;
      if (r.status === 200 && r.j?.projekt) { ctx.uebernimm(r.j.slug, r.j.projekt); host.hidden = true; zeigeKnoepfe(); return; }
      ctx.melde(ctx.antwortText(r), true);
    } finally { oeffnet = false; }
  }
  // the shelf is a row of the page flow under the bar (it pushes the grid down): it closes on Escape and on a click beside it (the MODULES button toggles it itself)
  ctx.beiAussen?.([host, modulKnopf], () => !host.hidden, () => { host.hidden = true; zeigeKnoepfe(); });
  modulKnopf.addEventListener('click', () => {
    host.hidden = !host.hidden;
    zeigeKnoepfe();
    if (!host.hidden) lade();
  });

  async function kopiere() {
    const name = feld.value.trim();
    if (name === '' || !st.slug) return;
    feld.disabled = true;
    const r = await ctx.holeJson('/proj/kopie', { slug: st.slug, name });
    feld.disabled = false;
    if (r.status === 200) { feld.hidden = true; ctx.melde(REGAL_TEXT.kopiert(r.j?.name ?? name)); if (!host.hidden) lade(); }
    else ctx.melde(ctx.antwortText(r), true);
  }
  feld.addEventListener('keydown', (ev) => {
    ev.stopPropagation();   // the keys of the grid stay out of the field
    if (ev.key === 'Escape') { feld.hidden = true; return; }
    if (ev.key === 'Enter') kopiere();
  });
  speichern.addEventListener('click', async () => {
    if (!geeignet()) return;
    if (markiert()) {
      feld.hidden = !feld.hidden;
      if (!feld.hidden) { feld.value = `${st.projekt.name} copy`.slice(0, 80); feld.focus?.(); feld.select?.(); }
      return;
    }
    const ok = await ctx.aendere('Save as tracker module', [{ befehl: 'tracker_setzen', an: true }]);
    if (ok) { ctx.melde(REGAL_TEXT.gespeichert); if (!host.hidden) lade(); }
  });
}
