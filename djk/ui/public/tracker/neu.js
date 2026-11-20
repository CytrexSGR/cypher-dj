// TRACKER view, NEW MODULE (plan 2026-11-18-tracker.md, task 22): a menu with EMPTY, 8-BIT · 4 CHANNELS and CHIP. A click creates a tracker project through
// POST /proj/neu {name, tracker: true, vorlage?}, behind the same confirmation of the live container as every open (mitBestaetigung), and the view takes the
// answer over. The menu sits in the tracker bar (when a project is open) and in the empty pane (when none is), so a tracker can be made from nothing.
// The menu is an overlay under the bar (tracker.css): it closes on Escape and on a click beside it. Every item carries data-t: neu (the button), neu-menue, neu-leer, neu-8bit-4kanal, neu-chip, neu-name (the name field of EMPTY).
import { mitBestaetigung } from '../production/project_choice.js';

export const NEU_TEXT = {
  knopf: 'NEW MODULE', knopfTitel: 'Make a new tracker module: empty, or from a template with a short start pattern',
  leer: 'EMPTY', leerTitel: 'An empty tracker module: you name it',
  namePlatzhalter: 'Module name, Enter', nameLabel: 'New module name',
};
// the menu items: id (data-t suffix), shown text, hint, and the template id of the server (none = an empty module)
export const NEU_EINTRAEGE = [
  { id: 'leer', text: NEU_TEXT.leer, titel: NEU_TEXT.leerTitel, vorlage: null },
  { id: '8bit-4kanal', text: '8-BIT · 4 CHANNELS', titel: 'Four amiga channels: bass, arpeggio, melody and drums in A minor, 125 BPM', vorlage: '8bit-4kanal' },
  { id: 'chip', text: 'CHIP', titel: 'Two pulse voices, a triangle bass and noise drums in A minor, 125 BPM', vorlage: 'chip' },
];

// The request body of a new tracker module. Pure: a template keeps its own name when none is given.
export function neuKoerper(eintrag, name) {
  const n = String(name ?? '').trim() || (eintrag.vorlage ? eintrag.text : '');
  return { name: n, tracker: true, ...(eintrag.vorlage ? { vorlage: eintrag.vorlage } : {}) };
}

export function bindeNeu(ctx) {
  const { $ } = ctx;
  const el = (tag, klasse, t) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (t) e.setAttribute('data-t', t); return e; };
  const knopfEl = (t, text, titel) => { const b = el('button', 't-knopf', t); b.setAttribute('type', 'button'); b.textContent = text; b.setAttribute('title', titel); return b; };
  let laeuft = false;

  // the creation: the confirmation of the live container, then the view takes the new project; a refusal is shown, "no" sends nothing more
  ctx.neuesTrackerModul = async (koerper) => {
    if (laeuft) return false;
    laeuft = true;
    try {
      const r = await mitBestaetigung(ctx.holeJson, '/proj/neu', koerper, (t) => ctx.frage(t));
      if (r.abgelehnt) return false;
      if (r.status === 200 && r.j?.projekt) { ctx.uebernimm(r.j.slug, r.j.projekt); return true; }
      ctx.melde(ctx.antwortText(r), true);
      return false;
    } finally { laeuft = false; }
  };

  // one menu with its button; `wo` is the element it is appended to (the bar or the empty pane)
  function baue(wo, kopfzeile) {
    const huelle = el('span', 't-gruppe t-neu');
    const knopf = knopfEl('neu', NEU_TEXT.knopf, NEU_TEXT.knopfTitel);
    knopf.setAttribute('aria-haspopup', 'true');
    const menue = el('span', 't-neu-menue', 'neu-menue');
    menue.hidden = true;
    const feld = el('input', 't-eingabe', 'neu-name');
    feld.setAttribute('type', 'text'); feld.setAttribute('placeholder', NEU_TEXT.namePlatzhalter); feld.setAttribute('maxlength', '80');
    feld.setAttribute('aria-label', NEU_TEXT.nameLabel); feld.hidden = true;
    const zu = () => { menue.hidden = true; feld.hidden = true; };
    for (const e of NEU_EINTRAEGE) {
      const b = knopfEl(`neu-${e.id}`, e.text, e.titel);
      b.addEventListener('click', () => {
        if (e.vorlage === null) { feld.hidden = false; feld.value = ''; feld.focus?.(); return; }
        zu();
        ctx.neuesTrackerModul(neuKoerper(e));
      });
      menue.append(b);
    }
    feld.addEventListener('keydown', (ev) => {
      ev.stopPropagation();   // the keys of the grid and the page stay out of the field
      if (ev.key === 'Escape') { zu(); return; }
      if (ev.key !== 'Enter' || feld.value.trim() === '') return;
      const name = feld.value;
      zu();
      ctx.neuesTrackerModul(neuKoerper(NEU_EINTRAEGE[0], name));
    });
    knopf.addEventListener('click', () => { menue.hidden = !menue.hidden; if (menue.hidden) feld.hidden = true; });
    menue.append(feld);   // the name field stands in the menu, under the items
    huelle.append(knopf, menue);
    wo.append(huelle);
    ctx.beiAussen?.([huelle], () => !menue.hidden, zu);   // the button is inside the shell: its own click toggles
    return huelle;
  }
  baue($('kopf'));
  baue($('leer'));
}
