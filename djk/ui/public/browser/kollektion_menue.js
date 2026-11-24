// "Add to <collection>" for one item of the browser (right click): the same menu as the old lists in PRODUCTION (collections.js), built from the browser's host.
// An item the collection already holds is shown disabled; "New collection…" asks for a name first. Every refusal shows the server's sentence.
import { menuePunkte } from '../collections.js';
import { oeffneMenue } from '../production/context_menu.js';

const gleich = (a, b) => a.art === b.art && (a.art === 'sample' ? a.sha === b.sha : a.art === 'preset' ? a.id === b.id : a.geraet === b.geraet);

export async function zeigeKollektionsMenue(host, posten, x, y, opt = {}) {
  const menue = opt.menue ?? oeffneMenue;
  const frage = opt.frage ?? ((t, v) => globalThis.prompt?.(t, v) ?? null);
  const r = await host.holeGet('/kollektionen');
  if (r.status !== 200 || !Array.isArray(r.j)) { host.melde(r.j?.text ?? 'Collections are not available', true); return false; }
  const mit = await Promise.all(r.j.map(async (k) => {
    if (k.fehler) return k;
    const d = await host.holeGet(`/kollektionen/${encodeURIComponent(k.slug)}`);
    return { ...k, enthaelt: d.status === 200 && (d.j?.posten ?? []).some((p) => gleich(p, posten)) };
  }));
  const hinzu = async (slug) => {
    const x2 = await host.holeJson(`/kollektionen/${encodeURIComponent(slug)}/posten`, { hinzu: [posten] });
    host.melde(x2.status === 200 ? 'Added to the collection' : (x2.j?.text ?? 'Not added'), x2.status !== 200);
    return x2.status === 200;
  };
  menue(menuePunkte(mit, {
    hinzu,
    neu: async () => {
      const name = frage('Name of the new collection', '');
      if (!name?.trim()) return;
      const c = await host.holeJson('/kollektionen', { name });
      if (c.status !== 201) { host.melde(c.j?.text ?? 'Not created', true); return; }
      if (await hinzu(c.j.slug)) host.melde('Added to the new collection', false);
    },
  }), x, y);
  return true;
}
