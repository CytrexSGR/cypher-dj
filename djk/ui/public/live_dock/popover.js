// One popover at a chip of the live dock (DJ and LIVE, EFFECTS tab): a small floating panel under its anchor with a title row and ✕.
// One at a time: opening another replaces it, opening the same id again closes it. It closes on ✕, Escape, a pointerdown outside popover and anchor
// (decided at pointerdown, removed in a microtask, so a document handler that runs later still sees the target in the page) and on schliesse().
// Markup: div.w-live-popover[role="dialog"][data-popover-id] > div.w-live-popover-kopf (b title, button ✕) + div.w-live-popover-koerper.

/** `wurzel`: the element the popover is appended to (the live window layer, so the dock styles apply inside it); default the body.
 *  opt of oeffne: { id, titel, klasse?, bauen(koerper) -> { aktualisiere?, zerstoere? } | void }. */
export function neuesPopover(doc = document, wurzel = null) {
  let offen = null;   // { id, e, anker, handle }
  const fenster = doc.defaultView ?? globalThis;

  function lege(e, anker) {
    const r = anker?.getBoundingClientRect?.() ?? { left: 0, bottom: 0 };
    e.style.left = `${Math.round(r.left)}px`; e.style.top = `${Math.round(r.bottom + 4)}px`;
    const b = e.getBoundingClientRect?.();
    const breite = fenster.innerWidth ?? 0, hoehe = fenster.innerHeight ?? 0;
    if (b && breite && b.right > breite) e.style.left = `${Math.max(0, breite - b.width - 4)}px`;
    if (b && hoehe && b.bottom > hoehe) e.style.top = `${Math.max(0, r.top - b.height - 4)}px`;
  }
  const beiZeiger = (ev) => {
    if (!offen) return;
    const t = ev.target;
    if (offen.e.contains(t) || offen.anker?.contains?.(t)) return;
    const id = offen.id;
    queueMicrotask(() => { if (offen?.id === id) schliesse(); });
  };
  const beiTaste = (ev) => { if (offen && ev.key === 'Escape') schliesse(); };

  function schliesse() {
    if (!offen) return;
    const o = offen; offen = null;
    doc.removeEventListener('pointerdown', beiZeiger, true);
    doc.removeEventListener('keydown', beiTaste, true);
    try { o.handle?.zerstoere?.(); } finally { o.e.remove(); }
  }
  function oeffne(anker, { id, titel, klasse, bauen }) {
    if (offen?.id === id) { schliesse(); return null; }
    schliesse();
    const e = doc.createElement('div');
    e.className = `w-live-popover${klasse ? ` ${klasse}` : ''}`;
    e.setAttribute('role', 'dialog'); e.setAttribute('aria-label', titel); e.setAttribute('data-popover-id', id);
    const kopf = doc.createElement('div'); kopf.className = 'w-live-popover-kopf';
    const t = doc.createElement('b'); t.textContent = titel;
    const zu = doc.createElement('button'); zu.type = 'button'; zu.className = 'w-live-popover-zu'; zu.textContent = '✕'; zu.title = 'Close';
    zu.addEventListener('click', () => schliesse());
    kopf.append(t, zu);
    const koerper = doc.createElement('div'); koerper.className = 'w-live-popover-koerper';
    e.append(kopf, koerper);
    (wurzel ?? doc.body).append(e);
    offen = { id, e, anker, handle: null };
    offen.handle = bauen?.(koerper) ?? null;
    lege(e, anker);
    doc.addEventListener('pointerdown', beiZeiger, true);
    doc.addEventListener('keydown', beiTaste, true);
    return e;
  }
  return {
    oeffne,
    aktualisiere: () => { offen?.handle?.aktualisiere?.(); },
    schliesse,
    offenId: () => offen?.id ?? null,
  };
}
