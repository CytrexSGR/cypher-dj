// PRODUCTION (package 1.16 rest U7, T7.2): applying a dropped preset. The server computes the plan (POST /presets/anwenden {id, ziel}, it never writes);
// the page sends the commands of a 'proj' plan as ONE change through ctx.aendere (one write, one undo step) or shows the refusal. Same rule as the
// plan consumer check/b116_send.mjs and the hand: a refused plan sends nothing. A channel plan ('regler') belongs to the DJ view and is not taken here.
import { planMitFrage } from '../preset_graph_frage.js';

export const PLAN_TEXT = {
  freeze_geht: 'The sound of this frozen track changes: its freeze is dropped, freeze it again afterwards',
};
// D28: the track played another instrument; the old knob values mean other things in the new one and were not carried over
export const graphGewechseltText = (graph) => `${graph ? `Loaded ${graph} on this track` : 'The instrument of this track was exchanged'}; its old knob values were not carried over`;

/** A server answer {status, j} -> {label, befehle, hinweise: [text]} to write, or {fehler: true, text} to show. */
export function planAktion(r) {
  const j = r?.j;
  if (r?.status !== 200 || !j) return { fehler: true, text: j?.text ?? `Not applied: ${j?.fehler ?? `HTTP ${r?.status ?? 'none'}`}` };
  if (j.weg !== 'proj') return { fehler: true, text: 'This plan is for a DJ channel: apply the preset in the DJ view' };
  if (!Array.isArray(j.befehle) || j.befehle.length === 0) return { fehler: true, text: 'The preset gives nothing to change here' };
  const hinweise = (j.hinweise ?? []).map((h) => (h === 'graph_gewechselt' ? graphGewechseltText(j.befehle[0]?.geraet?.graph) : PLAN_TEXT[h] ?? `Note: ${h}`));
  if (Array.isArray(j.uebersprungen) && j.uebersprungen.length) hinweise.push(`not in the table: ${j.uebersprungen.join(', ')}`);
  return { label: j.label, befehle: j.befehle, hinweise };
}

/**
 * Plan request, then the write. ctx: holeJson, melde, aendere. Returns true when the write was accepted.
 * D28: a sound of another instrument asks once whether to load its instrument on the track (opt.bestaetige, default window.confirm) and on yes asks for the
 * plan again with graph_laden: true; the exchange is one spur_aendern, so one undo step brings the old instrument back.
 */
export async function wendePresetAn(ctx, n, ziel, opt = {}) {
  const zielName = ziel?.spur_id ? (ctx.st?.projekt?.spuren ?? []).find((s) => s.id === ziel.spur_id)?.name ?? 'this track' : 'this target';
  const { r, graph, abgelehnt } = await planMitFrage((body) => ctx.holeJson('/presets/anwenden', body), { id: n.id, ziel }, { presetName: n.name, zielName, bestaetige: opt.bestaetige });
  if (abgelehnt) { ctx.melde(`Not applied: ${graph} was not loaded`, true); return false; }
  const a = planAktion(r);
  if (a.fehler) { ctx.melde(a.text, true); return false; }
  if (a.hinweise.length) ctx.melde(`${n.name}: ${a.hinweise.join(' · ')}`, false);
  return (await ctx.aendere(a.label, a.befehle)) === true;
}
