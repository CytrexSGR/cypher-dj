// PRODUCTION (1.10 slice 6, T3): the header row of a group in the arrangement (left column, 28 px like layout.js GRUPPEN_HOEHE). Class `.p-arr-gruppe` on
// purpose, NOT `.p-gruppenkopf`: that one is the group strip of the mixer, which the probes count. The row holds the fold arrow, the colour bar, the name
// (Ctrl/Shift+click selects the members), the member count and one dot per state of the members (armed, solo, muted, open lane): a folded group must not
// hide an armed track (review focus 1). The state comes from routing.js gruppenKopfZustand.
const PUNKTE = [['armiert', 'arm', 'armed'], ['solo', 'solo', 'solo'], ['stumm', 'stumm', 'muted'], ['lane', 'lane', 'automation lane open']];

export function foldLabel(name, gefaltet) { return `${gefaltet ? 'Unfold' : 'Fold'} group ${name}`; }

// handler: { falten(gruppeId, gefaltet), waehle(gruppeId, ereignis) } (both read the group by id when they run)
export function baueGruppenKopf(id, handler, doc = document) {
  const el = doc.createElement('div');
  el.className = 'p-arr-gruppe'; el.dataset.gruppe = id; el.setAttribute('role', 'group');
  el.innerHTML = '<button class="p-arr-falte" type="button" aria-expanded="true">▾</button><span class="p-arr-farbe"></span>'
    + '<span class="p-arr-name" role="button" tabindex="0" title="Ctrl or Shift+click selects the tracks of the group"></span><span class="p-arr-zahl"></span>'
    + `<span class="p-arr-punkte">${PUNKTE.map(([, k, t]) => `<i class="p-punkt p-punkt--${k}" title="${t}" hidden></i>`).join('')}</span>`;
  el.querySelector('.p-arr-falte').addEventListener('click', () => handler.falten(id));
  const name = el.querySelector('.p-arr-name');
  name.addEventListener('click', (e) => { if (e.ctrlKey || e.shiftKey || e.metaKey) { e.preventDefault(); handler.waehle(id, e); } });
  return el;
}

export function zeigeGruppenKopf(el, gruppe, z, gewaehlt = false) {
  const farbe = /^#[0-9a-f]{6}$/i.test(gruppe.farbe ?? '') ? gruppe.farbe : '#8a8d98';
  el.style.setProperty('--farbe', farbe);
  el.classList.toggle('gefaltet', z.gefaltet); el.classList.toggle('gewaehlt', gewaehlt);
  const falte = el.querySelector('.p-arr-falte'), l = foldLabel(gruppe.name, z.gefaltet);
  falte.textContent = z.gefaltet ? '▸' : '▾'; falte.setAttribute('aria-expanded', String(!z.gefaltet)); falte.setAttribute('aria-label', l); falte.title = l;
  const name = el.querySelector('.p-arr-name');
  if (name.textContent !== gruppe.name) name.textContent = gruppe.name;
  name.setAttribute('aria-label', `Select the tracks of group ${gruppe.name}`);
  el.querySelector('.p-arr-zahl').textContent = `${z.mitglieder} ${z.mitglieder === 1 ? 'track' : 'tracks'}`;
  for (const [feld, k] of PUNKTE) el.querySelector(`.p-punkt--${k}`).hidden = !z[feld];
}
