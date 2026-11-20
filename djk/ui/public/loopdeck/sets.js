// Loop deck set menu (plan loop deck P4): SAVE SET (name field in the menu itself, like the rename field of the cell menu), LOAD SET (the saved
// sets of GET /loopsets) and CLEAR DECK (after a confirm). This module knows no network and no deck state: the caller hands in what each entry does.
import { el } from '../page_state.js';

// The server's rule for a set name (loopsets.ts setName): 1..64 letters, digits, space, - and _, no space at either end.
export const SET_NAME = /^[\p{L}\p{N} _-]{1,64}$/u;
export const NAME_HINWEIS = 'Name: 1 to 64 letters, digits, space, - or _ (no space at either end)';
export const nameGueltig = (n) => typeof n === 'string' && SET_NAME.test(n) && n.trim() === n;

// o.speichern(name) / o.laden(name) / o.leeren(): -> Promise<boolean> (true: it worked, the menu closes)
// o.liste(): -> Promise<{name, raster, zellen}[] | null>   o.frage(text): -> boolean   o.schliesse(): closes the menu
export function baueSetMenue(knoten, o) {
  const kopf = el('div', 'ld-setzeile');
  const speichern = el('button', 'ld-seteintrag', 'SAVE SET'); speichern.type = 'button'; speichern.dataset.eintrag = 'set-speichern'; speichern.title = 'Save this deck as a named set';
  const laden = el('button', 'ld-seteintrag', 'LOAD SET'); laden.type = 'button'; laden.dataset.eintrag = 'set-laden'; laden.title = 'Replace this deck with a saved set';
  const leeren = el('button', 'ld-seteintrag ld-setleeren', 'CLEAR DECK'); leeren.type = 'button'; leeren.dataset.eintrag = 'set-leeren'; leeren.title = 'Remove every cell of this deck';
  kopf.append(speichern, laden, leeren);

  const namensZeile = el('div', 'ld-setzeile ld-setname'); namensZeile.hidden = true;
  const feld = el('input', 'ld-mfeld'); feld.type = 'text'; feld.setAttribute('type', 'text'); feld.maxLength = 64; feld.placeholder = 'Set name'; feld.title = 'Set name (Enter to save)';
  const ok = el('button', 'ld-seteintrag', 'SAVE'); ok.type = 'button'; ok.dataset.eintrag = 'set-speichern-ok';
  const hinweis = el('span', 'ld-hinweis', ''); hinweis.hidden = true;
  namensZeile.append(feld, ok, hinweis);

  const listeKnoten = el('div', 'ld-setliste'); listeKnoten.hidden = true;
  knoten.append(kopf, namensZeile, listeKnoten);

  let laeuft = false;
  const nurEinmal = async (f) => { if (laeuft) return; laeuft = true; try { if (await f()) o.schliesse(); } finally { laeuft = false; } };
  const zeigeHinweis = (t) => { hinweis.textContent = t ?? ''; hinweis.hidden = !t; };

  const sichern = () => nurEinmal(async () => {
    const name = feld.value.trim();   // a space at either end is the typing, not the name
    if (!nameGueltig(name)) { zeigeHinweis(NAME_HINWEIS); return false; }
    zeigeHinweis('');
    const vorhanden = (await o.liste())?.some((s) => s.name === name);
    if (vorhanden && !o.frage(`The set "${name}" exists. Overwrite it?`)) return false;
    return o.speichern(name);
  });
  ok.addEventListener('click', sichern);
  feld.addEventListener('keydown', (e) => { if (e.key === 'Enter') sichern(); else if (e.key === 'Escape') o.schliesse(); });

  speichern.addEventListener('click', () => {
    listeKnoten.hidden = true; zeigeHinweis('');
    namensZeile.hidden = !namensZeile.hidden;
    if (!namensZeile.hidden) feld.focus?.();
  });
  laden.addEventListener('click', async () => {
    namensZeile.hidden = true;
    if (!listeKnoten.hidden) { listeKnoten.hidden = true; return; }
    const sets = await o.liste();
    listeKnoten.replaceChildren();
    if (!sets) listeKnoten.append(el('span', 'ld-hinweis', 'The set list could not be read.'));
    else if (!sets.length) listeKnoten.append(el('span', 'ld-hinweis', 'No sets saved yet.'));
    for (const s of sets ?? []) {
      const b = el('button', 'ld-setwahl'); b.type = 'button'; b.dataset.set = s.name;
      b.title = `Load "${s.name}" into this deck`;
      b.append(el('span', 'ld-setwahlname', s.name), el('span', 'ld-setinfo', `${s.zellen ?? 0} cells`));
      b.addEventListener('click', () => nurEinmal(() => o.laden(s.name)));
      listeKnoten.append(b);
    }
    listeKnoten.hidden = false;
  });
  leeren.addEventListener('click', () => nurEinmal(async () => (o.frage('Clear every cell of this deck?') ? o.leeren() : false)));

  // the menu opens fresh: no half-typed name, no old list
  return { zuruecksetzen() { namensZeile.hidden = true; listeKnoten.hidden = true; zeigeHinweis(''); feld.value = ''; } };
}
