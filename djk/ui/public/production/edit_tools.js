// PRODUCTION: the edit tools of the arrangement made findable. Pure part: the EDIT toolbar group (state of its buttons) and the entries of the
// context menu on the arrangement. The actions themselves live in clip_operation.js (ctx.clipAktion); this file only decides what is offered,
// what is disabled and what the title says. Binding at the end: buttons in the head row follow selection, project and clipboard.
import { loopLabel } from './clips.js';

// id = the action name of ctx.clipAktion; hilfe names the shortcut (the title of an enabled button)
export const EDIT_KNOEPFE = [
  { id: 'teilen', text: 'SPLIT', hilfe: 'Split the selected clips at the start marker (Ctrl+E)' },
  { id: 'verbinden', text: 'GLUE', hilfe: 'Glue the selected clips of one track into one clip (Ctrl+J)' },
  { id: 'duplizieren', text: 'DUPLICATE', hilfe: 'Duplicate the selection right behind itself (Ctrl+D)' },
  { id: 'kopieren', text: 'COPY', hilfe: 'Copy the selected clips (Ctrl+C)' },
  { id: 'ausschneiden', text: 'CUT', hilfe: 'Cut the selected clips: copy, then delete (Ctrl+X)' },
  { id: 'einfuegen', text: 'PASTE', hilfe: 'Paste the copied clips at the start marker (Ctrl+V)' },
  { id: 'loeschen', text: 'DELETE', hilfe: 'Delete the selected clips (Del)' },
];
const NOCH_NICHT = 'comes with the next step';
// the buttons whose action is wired in clip_operation.js; each step of the edit tools adds its ids
export const EDIT_KANN = new Set(['teilen', 'verbinden', 'duplizieren', 'kopieren', 'ausschneiden', 'einfuegen', 'loeschen']);

// Why a button is off, or null when it is on. kann: the ids that are wired (a set of EDIT_KNOEPFE ids)
function grundAus(id, { projekt, auswahl, ablage }, kann) {
  if (!kann.has(id)) return NOCH_NICHT;
  if (!projekt) return 'open a project first';
  if (id === 'einfuegen') return ablage?.clips?.length ? null : 'nothing copied yet';
  if (auswahl.length === 0) return 'select a clip first';
  if (id === 'verbinden' && auswahl.length < 2) return 'select two or more clips';
  return null;
}

// { [id]: { aus, titel } } for the seven buttons. A disabled title says why and still names the shortcut
export function editZustand(zustand, kann) {
  const aus = {};
  for (const k of EDIT_KNOEPFE) {
    const g = grundAus(k.id, zustand, kann);
    aus[k.id] = { aus: g !== null, titel: g === null ? k.hilfe : g === NOCH_NICHT ? g : `${k.hilfe}: ${g}` };
  }
  return aus;
}

// The edit entries of the context menu. clip = the clip under the pointer (null: an empty lane). Each entry {id, text, aus, titel}; id is the menu action.
const MENUE = [
  { id: 'teilen_bei', text: 'Split here', knopf: 'teilen' },
  { id: 'verbinden', text: 'Glue', knopf: 'verbinden' },
  { id: 'duplizieren', text: 'Duplicate', knopf: 'duplizieren' },
  { id: 'kopieren', text: 'Copy', knopf: 'kopieren' },
  { id: 'ausschneiden', text: 'Cut', knopf: 'ausschneiden' },
  { id: 'einfuegen_bei', text: 'Paste here', knopf: 'einfuegen' },
  { id: 'loop', text: null, knopf: null },
  { id: 'loeschen', text: 'Delete', knopf: 'loeschen' },
];
export function editMenuePunkte({ projekt, auswahl, clip, ablage, kann }) {
  const z = editZustand({ projekt, auswahl, ablage }, kann);
  const punkt = (m) => {
    if (m.id === 'loop') return { id: 'loop', text: loopLabel(clip), aus: false, titel: 'Loop on or off for the selected clips (Ctrl+L)' };
    const s = z[m.knopf];
    return { id: m.id, text: m.text, aus: s.aus, titel: s.titel };
  };
  if (!clip) return [punkt(MENUE[5])];
  return MENUE.map(punkt);
}

// The toolbar: buttons data-p="edit-<id>" in the head row. aktualisiere() reads selection, project and clipboard; call it from the hooks.
export function bindeEditWerkzeuge(ctx, kann = EDIT_KANN) {
  const { st, $ } = ctx;
  const knoepfe = EDIT_KNOEPFE.map((k) => ({ k, b: $(`edit-${k.id}`) })).filter((x) => x.b);
  const aktualisiere = () => {
    const z = editZustand({ projekt: st.projekt, auswahl: st.auswahl ?? [], ablage: st.clipAblage ?? null }, kann);
    for (const { k, b } of knoepfe) { b.disabled = z[k.id].aus; b.setAttribute('aria-disabled', String(z[k.id].aus)); b.title = z[k.id].titel; }
  };
  for (const { k, b } of knoepfe) b.addEventListener('click', () => { if (!b.disabled) ctx.clipAktion(k.id); });
  ctx.editAktualisiere = aktualisiere;
  ctx.beimAuswahl.push(aktualisiere);
  ctx.beimProjekt.push(aktualisiere);
  aktualisiere();
}
