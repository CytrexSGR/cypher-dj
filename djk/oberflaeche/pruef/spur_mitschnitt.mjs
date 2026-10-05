// Studio S6 Probe: /strom der Seite (SSE: /uhr, /pegel, /e/regler) für N Sekunden als JSONL, je Zeile Empfangszeit.
// Aufruf: node djk/oberflaeche/pruef/spur_mitschnitt.mjs URL SEKUNDEN > datei.jsonl
const [url, sek] = [process.argv[2], Number(process.argv[3] ?? 30)];
const ac = new AbortController();
setTimeout(() => ac.abort(), sek * 1000);
try {
  const r = await fetch(`${url}/strom`, { signal: ac.signal });
  const dec = new TextDecoder();
  let puffer = '';
  for await (const teil of r.body) {
    puffer += dec.decode(teil, { stream: true });
    let i;
    while ((i = puffer.indexOf('\n\n')) >= 0) {
      const z = JSON.parse(puffer.slice(6, i)); puffer = puffer.slice(i + 2);
      if (['/uhr', '/pegel', '/e/regler'].includes(z.a)) process.stdout.write(JSON.stringify({ t: Date.now(), a: z.a, f: z.f }) + '\n');
    }
  }
} catch (e) { if (e.name !== 'AbortError') throw e; }
