// The DOM building blocks of the dock: element helpers, the front knobs of a panel, the colour field, the meter, the OPEN button, the stage chip and the row frame.
// A leaf module (imports only ../panel.js): the project cards (karten.js, parts.js, ...) and the generic cards of a live host build from the same blocks.
import { steuerungen } from '../panel.js';

export const mk = (tag, klasse, w, text) => {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (w) e.setAttribute('data-w', w);
  if (text !== undefined) e.textContent = text;
  return e;
};
export const knopfEl = (klasse, w, text, titel) => { const b = mk('button', klasse, w, text); b.type = 'button'; if (titel) b.title = titel; return b; };

export const MAX_FRONT = 6;

/** The knob controls shown on a card: the `front` list of the panel (params in that order), else the first knob controls in section order. */
export function frontKnoepfe(panel, max = MAX_FRONT) {
  const knoepfe = steuerungen(panel).filter((c) => c.type === 'knob' && typeof c.bind?.param === 'string' && c.bind.param !== '');
  const front = Array.isArray(panel?.front) ? panel.front : null;
  const wahl = front ? front.map((p) => knoepfe.find((c) => c.bind.param === p)).filter(Boolean) : knoepfe;
  return wahl.slice(0, max);
}

export const farbFeld = (kurz, farbe) => { const b = mk('span', 'w-buchstabe', null, kurz); b.style.background = farbe; return b; };

export const meterEl = (kanal) => { const m = mk('div', 'meter senkrecht'); m.setAttribute('data-kanal', kanal); m.append(document.createElement('i')); return m; };

// OPEN: the click handler gets the button itself (the window layer anchors a popover on it). `T` carries the texts `auf` and `aufTitel`.
export const aufKnopf = (T, klick, aus = false) => {
  const b = knopfEl('w-karte-auf', 'karte-auf', T.auf, T.aufTitel);
  b.disabled = aus; b.addEventListener('click', () => klick(b));
  return b;
};

/** Does the card menu stand back for this right click? Yes for a click that comes from a stage chip: the chip has its own menu (parts.js teilMenue). The target is
 *  tested instead of `defaultPrevented`, because the chip handler only prevents the default once it has found its stage (a hall chip or a stale chip does not),
 *  and the decision then no longer depends on the order of the listeners. */
export function kartenMenueWeicht(ziel) {
  return !!ziel?.closest?.('[data-w="karte-teil"]');
}

/** The DOM of a stage chip without any project lookup: `{ teil, text, an, titel }`, `{ klick(button, event), menue(event) }`. The caller appends dots, marks or bars. */
export function chipEl({ teil, text, an, titel }, { klick, menue }) {
  const b = knopfEl(`w-chip-teil${an ? '' : ' aus'}`, 'karte-teil', text, titel);
  b.setAttribute('data-teil', teil);
  b.addEventListener('click', (e) => { e.stopPropagation?.(); klick?.(b, e); });
  b.addEventListener('contextmenu', (e) => menue?.(e));
  return b;
}

/** The row frame of a dock: `zeilen = [{ key, titel, w }]` become `div.w-dock-zeile` rows; with `masterSpalte` the rows sit in `div.w-dock-reihen` beside the column
 *  `div.w-dock-master[data-w="dock-master"]` and `dockEl` gets `w-dock-geteilt`. Returns the row containers by key and the master column (or null). */
export function baueReihen(dockEl, zeilen, masterSpalte) {
  const reihen = {};
  const rahmen = zeilen.map((z) => {
    const zeile = mk('div', 'w-dock-zeile');
    zeile.append(mk('span', 'w-dock-etikett', null, z.titel));
    const karten = mk('div', 'w-dock-karten', z.w);
    zeile.append(karten);
    reihen[z.key] = karten;
    return zeile;
  });
  let master = null;
  if (masterSpalte) {
    const inhalt = mk('div', 'w-dock-reihen');
    inhalt.append(...rahmen);
    master = mk('div', 'w-dock-master', 'dock-master');
    dockEl.replaceChildren(inhalt, master);
  } else dockEl.replaceChildren(...rahmen);
  dockEl.classList.toggle('w-dock-geteilt', !!masterSpalte);
  return { reihen, master };
}
