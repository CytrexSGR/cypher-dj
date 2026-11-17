import { merkeBenutzt } from '../usage.js';
import { ZIEH_TYP } from '../production/drag.js';
// Shelf, catalog files: the request that puts a catalog sample (by sha) on a new instrument track. Shared by the shelf rows and the drop targets.

const KEIN_MODUL = 'Open a module first.';
export const QUELLE_WEG = 'This sample is not reachable any more: its file or disk is gone';

// the text of a refused answer: the sampler routes carry their own English text (same pattern as refusalText in schnitt_kit.js);
// a sample that vanished between listing and click without a text has no entry in the shared texts
const grossAnfang = (t) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
export const ablageText = (ctx, r) => (typeof r?.j?.text === 'string' && r.j.text !== '' ? grossAnfang(r.j.text)
  : r?.j?.fehler === 'quelle_unbekannt' ? QUELLE_WEG : ctx.antwortText(r));

// POST /sampler/datei/spur {sha}. true when the track was added and taken over; a refusal is shown in the message line.
export async function spurAusSha(ctx, sha) {
  const { st } = ctx;
  if (!st.projekt) { ctx.melde(KEIN_MODUL, true); return false; }
  const slug = st.slug;
  const r = await ctx.holeJson('/sampler/datei/spur', { sha });
  if (r.status !== 200 || !r.j?.projekt) { ctx.melde(ablageText(ctx, r), true); return false; }
  merkeBenutzt(ctx.holeJson, sha);   // the sample is on a track now: recently used (not awaited)
  if (st.slug !== slug) { ctx.melde('The track was added to the module you just left.'); return false; }
  ctx.uebernimm(slug, r.j.projekt);
  if (typeof r.j.spur_id === 'string') ctx.waehle(r.j.spur_id);
  if (typeof r.j.text === 'string' && r.j.text !== '') ctx.melde(r.j.text);
  return true;
}

// POST /sampler/datei/pad {spur_id, ton, sha}: the sample becomes the sound of one pad of a drum kit track. true when the answer was taken over.
export async function padAusSha(ctx, spurId, ton, sha) {
  const { st } = ctx;
  if (!st.projekt) { ctx.melde(KEIN_MODUL, true); return false; }
  const slug = st.slug;
  const r = await ctx.holeJson('/sampler/datei/pad', { spur_id: spurId, ton, sha });
  if (r.status !== 200 || !r.j?.projekt) { ctx.melde(ablageText(ctx, r), true); return false; }
  merkeBenutzt(ctx.holeJson, sha);
  if (st.slug !== slug) { ctx.melde('The pad was changed in the module you just left.'); return false; }
  ctx.uebernimm(slug, r.j.projekt);
  if (typeof r.j.text === 'string' && r.j.text !== '') ctx.melde(r.j.text);
  return true;
}

// ---- drop targets ----
// Does this drag carry a shelf sample? (during dragover only the types are readable)
export const istRegalZug = (ev) => Array.from(ev?.dataTransfer?.types ?? []).includes(ZIEH_TYP);
// The payload {sha, ...} of a drop, or null when it is not a shelf sample.
export function regalNutzlast(ev) {
  try {
    const n = JSON.parse(ev.dataTransfer.getData(ZIEH_TYP));
    return n && typeof n.sha === 'string' && /^[0-9a-f]{64}$/.test(n.sha) ? n : null;
  } catch { return null; }
}
// Marks `ziel` with w-drop while a shelf sample is over it; the answer says whether the drag was accepted.
export function markiereZiel(ev, ziel, an) {
  if (!an) { ziel.classList.remove('w-drop'); return false; }
  ev.preventDefault?.();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
  ziel.classList.add('w-drop');
  return true;
}
