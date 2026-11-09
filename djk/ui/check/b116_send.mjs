// Package 1.16 rest U3b (T3b.2): the plan consumer. A plan comes from POST /presets/anwenden (presets/apply.ts); nothing is sent by the
// server itself. The rules, shared with U5's hand tool and U7's page (both are tested against this file):
//   weg 'proj'   → ONE POST /proj/aendern {rev, label, befehle} (one undo step)
//   weg 'regler' → one POST /regler {pfad, nach, ab: 'jetzt'} per request, in order; stop at the first refusal (HTTP not 200 or kern
//                  quittung status 6); nothing after it is sent
//   a refusal answer ({fehler} or {code >= 400, j: {fehler}}) sends NOTHING
// Returns {ok, gesendet, antworten, grund?}: `gesendet` counts the requests that actually left, `grund` names the first refusal.
const post = async (url, pfad, koerper, kopf) => {
  const r = await fetch(url + pfad, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(koerper) });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { text: t }; }
  return { code: r.status, j };
};
const grundVon = (r) => `${r.code ?? ''} ${r.j?.fehler ?? r.j?.grund ?? r.j?.quittung?.grund ?? ''}${r.j?.text ? `: ${r.j.text}` : ''}`.trim();

export async function sendePlan(url, plan, rev, opt = {}) {
  const kopf = opt.kopf ?? {};
  const antwort = plan && typeof plan === 'object' && 'code' in plan && 'j' in plan ? plan : null;   // the route's answer as the page/hand gets it
  const abgelehnt = antwort ? (antwort.code !== 200 ? antwort : null) : (plan?.fehler ? { code: 409, j: plan } : null);
  if (abgelehnt) return { ok: false, gesendet: 0, antworten: [], grund: grundVon(abgelehnt) };
  const p = antwort ? antwort.j : plan;
  const antworten = [];
  if (p?.weg === 'proj') {
    const r = await post(url, '/proj/aendern', { rev, label: p.label, befehle: p.befehle }, kopf);
    antworten.push(r);
    return r.code === 200 ? { ok: true, gesendet: 1, antworten } : { ok: false, gesendet: 1, antworten, grund: grundVon(r) };
  }
  if (p?.weg === 'regler') {
    for (const a of p.anfragen) {
      const r = await post(url, '/regler', { pfad: a.pfad, nach: a.nach, ab: 'jetzt' }, kopf);
      antworten.push(r);
      if (r.code !== 200 || r.j?.quittung?.status === 6) return { ok: false, gesendet: antworten.length, antworten, grund: grundVon(r) };
    }
    return { ok: true, gesendet: antworten.length, antworten };
  }
  return { ok: false, gesendet: 0, antworten, grund: 'plan without a known weg' };
}
