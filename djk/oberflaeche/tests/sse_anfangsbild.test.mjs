// SSE-Vertrag der Seite (Plan 2026-10-15-d1-s1, Task 5): GET /strom liefert zuerst das Anfangsbild {a:'stand', f:{...stand, kern, pruefmodus}}
// mit genau diesen Schlüsseln (die Seite liest sie in app.js:1878-1960), danach die synthetischen Meldungen des Servers und die
// durchgereichten Kern-Adressen. Instanz aus CYPHERDJ_TEST_INSTANZ, Kern-Attrappe, kein Ton.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { HAND_PRUEFMODUS_TEXT } from '../oeffentlich/meldungen.js';

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
function sse(url) {
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
async function bis(s, pruef, ms = 1000) { for (let t = 0; t < ms && !pruef(); t += 20) await warte(20); return pruef(); }

test('SSE Anfangsbild: erstes Ereignis stand mit genau den Schlüsseln decks, fx, fxRouting, fxZuweisung, geladen, kern, loops, pruefmodus, regler', async (t) => {
  const { url } = await stapel(t);
  const s = sse(url); t.after(s.zu);
  assert.ok(await bis(s, () => s.ereignisse.length > 0), 'kein Ereignis auf /strom');
  const [e] = s.ereignisse;
  assert.equal(e.a, 'stand');
  assert.deepEqual(Object.keys(e.f).sort(), ['decks', 'fx', 'fxRouting', 'fxZuweisung', 'geladen', 'kern', 'loops', 'pruefmodus', 'regler']);
  assert.equal(e.f.kern, 'verbunden');
  assert.equal(e.f.pruefmodus, 'an', 'stapel startet mit kernPruefmodus true');
  assert.deepEqual([e.f.fx, e.f.fxZuweisung, e.f.fxRouting], [[null, null], [{}, {}], 'post_fader']);
  for (const k of ['decks', 'geladen', 'loops', 'regler']) assert.equal(Object.prototype.toString.call(e.f[k]), '[object Object]', `${k} ist ein einfaches Objekt`);
});

test('SSE synthetisch und durchgereicht: pruefmodus, wiederherstellung, /e/regler und /e/ki kommen an; /zustand/box nicht (Negativ-Kontrolle)', async (t) => {
  const { o, url } = await stapel(t);
  const i = innen(o);
  const s = sse(url); t.after(s.zu);
  assert.ok(await bis(s, () => s.ereignisse.length > 0));
  i.vomKern('/e/protokollfehler', { adresse: '/test/hand', grund: 'unbekannte_adresse' });
  assert.ok(await bis(s, () => s.ereignisse.some((e) => e.a === 'pruefmodus')), 'pruefmodus fehlt');
  assert.deepEqual(s.ereignisse.find((e) => e.a === 'pruefmodus').f, { stand: 'aus', text: HAND_PRUEFMODUS_TEXT });
  i.vomKern('/e/neustart', { generation: 9, sample: 0 });
  i.vomKern('/k/willkommen', { generation: 2 });
  assert.ok(await bis(s, () => s.ereignisse.some((e) => e.a === 'wiederherstellung')), 'wiederherstellung fehlt');
  assert.deepEqual(s.ereignisse.find((e) => e.a === 'wiederherstellung').f, { uebersprungen: true, grund: 'gebremster_start' });
  i.vomKern('/e/regler', { pfad: 'deck/1/fader', wert: 0.5 });
  i.vomKern('/e/ki', { gestoppt: 0, grund: '', sample: 0 });
  i.vomKern('/zustand/box', { box: 1, status: 0 });
  assert.ok(await bis(s, () => s.ereignisse.some((e) => e.a === '/e/regler') && s.ereignisse.some((e) => e.a === '/e/ki')), 'durchgereichte Adressen fehlen');
  assert.deepEqual(s.ereignisse.find((e) => e.a === '/e/regler').f, { pfad: 'deck/1/fader', wert: 0.5 });
  await warte(200);
  assert.equal(s.ereignisse.filter((e) => e.a === '/zustand/box').length, 0, '/zustand/box steht nicht in DURCHREICHEN');
});

test('SSE kern: Verliert der Server den Kern (Attrappe angehalten), kommt {a:"kern", f:{zustand:"suche"}}, nach dem Weiterlaufen wieder "verbunden"', async (t) => {
  const { url, att } = await stapel(t);
  const s = sse(url); t.after(s.zu);
  assert.ok(await bis(s, () => s.ereignisse.length > 0));
  assert.equal(s.ereignisse.filter((e) => e.a === 'kern').length, 0, 'Negativ-Kontrolle: solange der Kern lebt, keine kern-Meldung');
  att.kill('SIGSTOP');
  try {
    assert.ok(await bis(s, () => s.ereignisse.some((e) => e.a === 'kern'), 4000), 'kern-Meldung fehlt, obwohl der Kern schweigt');
    assert.deepEqual(s.ereignisse.find((e) => e.a === 'kern').f, { zustand: 'suche' });
  } finally { att.kill('SIGCONT'); }
  assert.ok(await bis(s, () => s.ereignisse.some((e) => e.a === 'kern' && e.f.zustand === 'verbunden'), 4000), 'nach dem Weiterlaufen wieder verbunden');
});
