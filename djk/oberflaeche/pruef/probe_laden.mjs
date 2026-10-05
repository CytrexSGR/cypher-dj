// Probe am echten Kern (djk-start --instanz i, 2026-09-27): LOAD auf ein Deck mit offenem Fader. Läuft es: abgelehnt
// (deck_hoerbar, Negativ-Kontrolle); gestoppt: lädt, Fader danach −200 (§4.4 „laufend und offen“).
const URL = process.argv[2] ?? 'http://127.0.0.1:56300/';
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, d) => fetch(URL + p.slice(1), { method: 'POST', body: JSON.stringify(d) }).then((r) => r.json());
const ereignisse = [];
const ac = new AbortController();
(async () => {
  const r = await fetch(URL + 'strom', { signal: ac.signal });
  const dec = new TextDecoder(); let puffer = '';
  for await (const t of r.body) {
    puffer += dec.decode(t, { stream: true }); let i;
    while ((i = puffer.indexOf('\n\n')) >= 0) { ereignisse.push(JSON.parse(puffer.slice(6, i))); puffer = puffer.slice(i + 2); }
  }
})().catch(() => {});
const taste = async (pfad) => { await post('/griff', { pfad, u: 1 }); await post('/griff', { pfad, u: 0 }); };
const antwort = (id) => ereignisse.filter((e) => e.a === '/q' && e.f.id === id).map((e) => `${e.f.status}${e.f.grund ? ' ' + e.f.grund : ''}`);
const fader = () => ereignisse.filter((e) => e.a === '/e/regler' && e.f.pfad === 'deck/1/fader').at(-1)?.f.wert;
const best = await (await fetch(URL + 'bestand')).json();
await post('/laden', { deck: 1, material_id: best[0].material_id });
await warte(2500);
await taste('deck/1/play');
await post('/griff', { pfad: 'deck/1/fader', u: 0.5 }); await post('/griff', { pfad: 'deck/1/fader', u: 1 });
await warte(1000);
const a = await post('/laden', { deck: 1, material_id: best[1].material_id });
await warte(1000);
console.log(`läuft, Fader ${fader()} dB: LOAD → ${antwort(a.felder.id).join(', ')}`);
await taste('deck/1/play');   // stop
await warte(800);
const b = await post('/laden', { deck: 1, material_id: best[1].material_id });
await warte(2500);
const g = ereignisse.filter((e) => e.a === '/e/geladen' && e.f.material_id === best[1].material_id).length;
console.log(`gestoppt: LOAD → ${antwort(b.felder.id).join(', ')}, /e/geladen ${g}, Fader danach ${fader()} dB`);
ac.abort();
