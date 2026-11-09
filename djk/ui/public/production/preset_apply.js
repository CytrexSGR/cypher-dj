// PRODUCTION (package 1.16 rest U7, T7.2): applying a dropped preset. The server computes the plan (POST /presets/anwenden {id, ziel}, it never writes);
// the page sends the commands of a 'proj' plan as ONE change through ctx.aendere (one write, one undo step) or shows the refusal. Same rule as the
// plan consumer check/b116_send.mjs and the hand: a refused plan sends nothing. A channel plan ('regler') belongs to the DJ view and is not taken here.
export const PLAN_TEXT = {
  freeze_geht: 'The sound of this frozen track changes: its freeze is dropped, freeze it again afterwards',
};

/** A server answer {status, j} -> {label, befehle, hinweise: [text]} to write, or {fehler: true, text} to show. */
export function planAktion(r) {
  const j = r?.j;
  if (r?.status !== 200 || !j) return { fehler: true, text: j?.text ?? `Not applied: ${j?.fehler ?? `HTTP ${r?.status ?? 'none'}`}` };
  if (j.weg !== 'proj') return { fehler: true, text: 'This plan is for a DJ channel: apply the preset in the DJ view' };
  if (!Array.isArray(j.befehle) || j.befehle.length === 0) return { fehler: true, text: 'The preset gives nothing to change here' };
  const hinweise = (j.hinweise ?? []).map((h) => PLAN_TEXT[h] ?? `Note: ${h}`);
  if (Array.isArray(j.uebersprungen) && j.uebersprungen.length) hinweise.push(`not in the table: ${j.uebersprungen.join(', ')}`);
  return { label: j.label, befehle: j.befehle, hinweise };
}

/** Plan request, then the write. ctx: holeJson, melde, aendere. Returns true when the write was accepted. */
export async function wendePresetAn(ctx, n, ziel) {
  const a = planAktion(await ctx.holeJson('/presets/anwenden', { id: n.id, ziel }));
  if (a.fehler) { ctx.melde(a.text, true); return false; }
  if (a.hinweise.length) ctx.melde(`${n.name}: ${a.hinweise.join(' · ')}`, false);
  return (await ctx.aendere(a.label, a.befehle)) === true;
}
