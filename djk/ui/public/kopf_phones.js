// Narrow window (max-width 1500 px, style.css): the PHONES mix of the header collapses into one PHONES key; the key opens the same two knobs as a pop-over.
// The knobs stay where they are in the DOM, so their wiring (cue/mix, cue/pegel) is untouched. Escape and a click outside close it.
export function bindePhonesKnopf(doc = document) {
  const knopf = doc.querySelector('#phones-knopf'), box = knopf?.closest('.kopfmix');
  if (!knopf || !box) return null;
  const setze = (offen) => { box.classList.toggle('offen', offen); knopf.setAttribute('aria-expanded', String(offen)); };
  knopf.addEventListener('click', (e) => { e.stopPropagation(); setze(!box.classList.contains('offen')); });
  doc.addEventListener('click', (e) => { if (box.classList.contains('offen') && !box.contains(e.target)) setze(false); });
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box.classList.contains('offen')) setze(false); });
  return { setze };
}
