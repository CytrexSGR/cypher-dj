// PRODUCTION (1.10 slice 6, T3): the header row of a group in the arrangement (left column, 28 px like layout.js GRUPPEN_HOEHE). Class `.p-arr-gruppe` on
// purpose, NOT `.p-gruppenkopf`: that one is the group strip of the mixer, which the probes count. The row holds the fold arrow, the colour bar, the name
// (Ctrl/Shift+click selects the members), the member count and one dot per state of the members (armed, solo, muted, open lane): a folded group must not
// hide an armed track (review focus 1). The state comes from routing.js gruppenKopfZustand.
// Nested groups (plan 2026-11-12): the row is indented by its depth (`--tiefe`) with one colour bar per group above it (`--balken`), carries the output
// selector `.p-ausgang` (Master or a group that is not below it) and a click on the name selects the HEAD (Shift/Ctrl adds), which Ctrl+G groups.
import { ausgangWert } from './routing.js';

const PUNKTE = [['armiert', 'arm', 'armed'], ['solo', 'solo', 'solo'], ['stumm', 'stumm', 'muted'], ['lane', 'lane', 'automation lane open']];

// One 3 px bar per group above, 12 px apart (the indent of a level): a CSS background layer for the indent area of a row
export function balkenVerlauf(farben) {
  if (!farben.length) return 'none';
  return `linear-gradient(to right, ${farben.flatMap((c, k) => [`${c} ${12 * k}px ${12 * k + 3}px`, `transparent ${12 * k + 3}px ${12 * k + 12}px`]).join(', ')})`;
}
export function foldLabel(name, gefaltet) { return `${gefaltet ? 'Unfold' : 'Fold'} group ${name}`; }

// handler: { falten(gruppeId), waehle(gruppeId, ereignis), ziel(gruppeId, wert) } (both read the group by id when they run)
export function baueGruppenKopf(id, handler, doc = document) {
  const el = doc.createElement('div');
  el.className = 'p-arr-gruppe'; el.dataset.gruppe = id; el.setAttribute('role', 'group');
  el.innerHTML = '<button class="p-arr-falte" type="button" aria-expanded="true">▾</button><span class="p-arr-farbe"></span>'
    + '<span class="p-arr-name" role="button" tabindex="0" title="Click selects the group (Ctrl or Shift+click adds it to the selection)"></span><span class="p-arr-zahl"></span>'
    + `<span class="p-arr-punkte">${PUNKTE.map(([, k, t]) => `<i class="p-punkt p-punkt--${k}" title="${t}" hidden></i>`).join('')}</span>`
    + '<select class="p-ausgang" title="Output: Master or another group"></select>';
  el.querySelector('.p-arr-falte').addEventListener('click', () => handler.falten(id));
  const name = el.querySelector('.p-arr-name');
  // Changed with nested groups: a (Ctrl/Shift+)click selects the group HEAD (Ctrl+G nests it), no longer all the tracks of the group (see the ADR)
  name.addEventListener('click', (e) => { e.preventDefault(); handler.waehle(id, e); });
  el.querySelector('.p-ausgang').addEventListener('change', (e) => handler.ziel(id, e.target.value));
  return el;
}

// extra: { tiefe, verborgen, balken: colours of the groups above (outermost first), optionen: ausgangOptionen(projekt, id) }
export function zeigeGruppenKopf(el, gruppe, z, gewaehlt = false, extra = {}) {
  const farbe = /^#[0-9a-f]{6}$/i.test(gruppe.farbe ?? '') ? gruppe.farbe : '#8a8d98';
  el.style.setProperty('--farbe', farbe);
  el.classList.toggle('gefaltet', z.gefaltet); el.classList.toggle('gewaehlt', gewaehlt);
  const tiefe = extra.tiefe ?? 0;
  el.classList.toggle('p-arr-gruppe--tief', tiefe > 0); el.classList.toggle('p-kopf--verborgen', !!extra.verborgen);
  if (tiefe > 0) { el.style.setProperty('--tiefe', String(tiefe)); el.style.setProperty('--balken', balkenVerlauf(extra.balken ?? [])); }
  else { el.style.removeProperty('--tiefe'); el.style.removeProperty('--balken'); }
  const sel = el.querySelector('.p-ausgang'), opts = extra.optionen ?? [{ wert: 'master', text: 'Master' }], schluessel = JSON.stringify(opts);
  if (sel.dataset.optionen !== schluessel) {   // rebuilt only when the choices change
    sel.dataset.optionen = schluessel;
    sel.replaceChildren(...opts.map((o) => { const e = el.ownerDocument.createElement('option'); e.value = o.wert; e.textContent = o.text; return e; }));
  }
  sel.value = ausgangWert(gruppe); sel.setAttribute('aria-label', `Output of group ${gruppe.name}`);
  const falte = el.querySelector('.p-arr-falte'), l = foldLabel(gruppe.name, z.gefaltet);
  falte.textContent = z.gefaltet ? '▸' : '▾'; falte.setAttribute('aria-expanded', String(!z.gefaltet)); falte.setAttribute('aria-label', l); falte.title = l;
  const name = el.querySelector('.p-arr-name');
  if (name.textContent !== gruppe.name) name.textContent = gruppe.name;
  name.setAttribute('aria-label', `Select group ${gruppe.name}`);
  el.querySelector('.p-arr-zahl').textContent = `${z.mitglieder} ${z.mitglieder === 1 ? 'track' : 'tracks'}`;
  for (const [feld, k] of PUNKTE) el.querySelector(`.p-punkt--${k}`).hidden = !z[feld];
}
