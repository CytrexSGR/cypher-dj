// Bausteine der Stapel-Tests des Bereichs proj (D1 S2-Integration): SSE mitlesen, warten, Anfragen mit Kopf.
export const warte = (ms) => new Promise((r) => setTimeout(r, ms));
export async function bis(pruef, ms = 3000) { for (let t = 0; t < ms && !pruef(); t += 20) await warte(20); return pruef(); }

export function sse(url) {
  const ereignisse = [];
  const ac = new AbortController();
  (async () => {
    const r = await fetch(`${url}/strom`, { signal: ac.signal });
    const dec = new TextDecoder();
    let puffer = '';
    for await (const teil of r.body) {
      puffer += dec.decode(teil, { stream: true });
      let i;
      while ((i = puffer.indexOf('\n\n')) >= 0) { ereignisse.push(JSON.parse(puffer.slice(6, i))); puffer = puffer.slice(i + 2); }
    }
  })().catch(() => {});
  return { ereignisse, zu: () => ac.abort() };
}

export async function ruf(url, methode, pfad, koerper, kopf = {}) {
  const r = await fetch(url + pfad, methode === 'GET' ? { headers: kopf }
    : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: typeof koerper === 'string' ? koerper : JSON.stringify(koerper ?? {}) });
  const text = await r.text();
  return { code: r.status, j: text ? JSON.parse(text) : null };
}
export const CYPHER = { 'x-djk-quelle': 'cypher' };
export const anKern = (log, adresse) => log.filter((z) => z.typ === 'an_kern' && z.adresse === adresse);
