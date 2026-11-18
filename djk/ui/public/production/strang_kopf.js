// PRODUCTION (automation slice 1): the head row of a return or of the master in the arrangement (left column, 28 px like layout.js GRUPPEN_HOEHE).
// Class `.p-arr-strang` on purpose, NOT `.p-arr-gruppe` (pinned by the group golden test) and NOT `.p-gruppenkopf` (the mixer strip). The row holds the
// colour bar, the name (class .p-strangname: no pointer, a plain label; NOT .p-arr-name, which selects a group head and is exempt from clearing the
// track selection) and the A button that opens the lane row of the strip. Nothing else: no fold, no output, no selection.

// handler: { lane(id) }, called when the A button is pressed
export function baueStrangKopf(id, handler, doc = document) {
  const el = doc.createElement('div');
  el.className = 'p-arr-strang'; el.dataset.strang = id; el.setAttribute('role', 'group');
  el.innerHTML = '<span class="p-arr-farbe"></span><span class="p-strangname"></span>'
    + '<button class="p-lane" type="button" aria-pressed="false" title="Automation lanes of this strip">A</button>';
  el.querySelector('.p-lane').addEventListener('click', () => handler.lane?.(id));
  return el;
}

// strang: a return ({name, farbe}) or the master; extra: { laneOffen, art }
export function zeigeStrangKopf(el, strang, extra = {}) {
  const farbe = /^#[0-9a-f]{6}$/i.test(strang.farbe ?? '') ? strang.farbe : '#8a8d98';
  const name = extra.art === 'master' ? 'Master' : (strang.name ?? strang.id);
  el.style.setProperty('--farbe', farbe);
  const n = el.querySelector('.p-strangname');
  if (n.textContent !== name) n.textContent = name;
  const la = el.querySelector('.p-lane'), an = !!extra.laneOffen;
  la.classList.toggle('an', an); la.setAttribute('aria-pressed', String(an)); la.setAttribute('aria-label', `Automation lanes of ${name}`);
  la.classList.toggle('hat', (strang.automation ?? []).length > 0);
}
