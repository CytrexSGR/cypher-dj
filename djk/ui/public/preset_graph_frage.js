// A sound of another instrument (DECISIONS.md D28). POST /presets/anwenden refuses graph_anders / kein_graph and names the preset's graph; the page
// asks once ("Load <graph> on <target> and apply it?") and, on yes, repeats the plan request with graph_laden: true. Shared by the DJ view
// (presets.js kanalPlanHolen) and PRODUCTION (production/preset_apply.js); no DOM, the question is injectable.

export const graphFrageText = (presetName, graph, zielName) => `"${presetName}" is a sound of ${graph}. Load ${graph} on ${zielName} and apply it?`;

/** The graph name a refusal offers to load, or null (any other answer, and every refusal of an insert stage, which carries no graph). Takes {code} or {status}. */
export function graphAngebot(r) {
  const j = r?.j;
  return (r?.code ?? r?.status) === 409 && (j?.fehler === 'graph_anders' || j?.fehler === 'kein_graph') && typeof j.graph === 'string' && j.graph !== '' ? j.graph : null;
}

/**
 * Sends the plan request through `senden(body)` ({code|status, j}). A graph refusal asks once (`bestaetige`, default window.confirm) and on yes sends the same
 * body again with graph_laden: true. Returns {r} (the answer to use), plus {graph} when the question was asked and {abgelehnt: true} when it was answered no.
 */
export async function planMitFrage(senden, body, { presetName, zielName, bestaetige } = {}) {
  const r = await senden(body);
  const graph = graphAngebot(r);
  if (!graph) return { r };
  const frage = bestaetige ?? ((t) => globalThis.confirm?.(t) ?? false);
  if (!frage(graphFrageText(presetName ?? 'This sound', graph, zielName ?? 'this target'))) return { r, graph, abgelehnt: true };
  return { r: await senden({ ...body, graph_laden: true }), graph };
}
