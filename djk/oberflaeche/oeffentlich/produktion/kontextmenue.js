// PRODUCTION (Paket 1.13 Warp, Slice 3b): ein kleines Kontextmenü (Rechtsklick). Es gab bisher keins in der Produktion. oeffneMenue(punkte, x, y): x und y sind
// Fensterpixel (clientX, clientY); punkte = [{ text, aus?, aktion }]. Es schließt bei Klick daneben, Esc, Rad und Fokusverlust des Fensters, und nach jedem Punkt.
// Das Menü liegt über allem (position: fixed) und wird in den sichtbaren Bereich geschoben.
let schliesser = null;
export function schliesseMenue() { if (schliesser) { const f = schliesser; schliesser = null; f(); } }
export const menueOffen = () => schliesser !== null;

export function oeffneMenue(punkte, x, y, doc = document, fenster = window) {
  schliesseMenue();
  const ul = doc.createElement('ul');
  ul.className = 'p-menue'; ul.setAttribute('role', 'menu');
  for (const p of punkte) {
    const li = doc.createElement('li'), b = doc.createElement('button');
    li.setAttribute('role', 'none');
    b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = p.text; b.disabled = !!p.aus;
    b.addEventListener('click', () => { schliesseMenue(); p.aktion(); });
    li.append(b); ul.append(li);
  }
  ul.style.left = `${x}px`; ul.style.top = `${y}px`;
  doc.body.append(ul);
  const r = ul.getBoundingClientRect();
  if (r.right > fenster.innerWidth) ul.style.left = `${Math.max(0, fenster.innerWidth - r.width - 4)}px`;
  if (r.bottom > fenster.innerHeight) ul.style.top = `${Math.max(0, fenster.innerHeight - r.height - 4)}px`;
  const zu = (e) => { if (e.type === 'keydown' && e.key !== 'Escape') return; if (e.type === 'blur' && e.target !== fenster) return; if (e.type === 'pointerdown' && ul.contains(e.target)) return; schliesseMenue(); };
  const ereignisse = ['pointerdown', 'keydown', 'wheel', 'blur'];
  for (const n of ereignisse) fenster.addEventListener(n, zu, true);
  schliesser = () => { for (const n of ereignisse) fenster.removeEventListener(n, zu, true); ul.remove(); };
  ul.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}
