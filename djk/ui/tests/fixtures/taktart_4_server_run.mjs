// The scripted run of the page server behind the 4/4 golden of plan studio-taktart T2 (shared by the recorder and the test).
// A fake core (the stand-in), a fixed clock, the bar-bound routes, once with no project open and once with a 4/4 project open.
import { stapel } from '../support/media_library.mjs';
import { post, hole } from '../support/media_library.mjs';

const CYPHER = { 'x-djk-quelle': 'cypher' };
const UHR = { beat: 10.3, bpm: 120, mono_ns: 0 };

// ids and receipts depend on the clock and the stand-in: only the fields that carry beats are compared
function ohneFluechtiges(w) {
  if (Array.isArray(w)) return w.map(ohneFluechtiges);
  if (w !== null && typeof w === 'object') {
    return Object.fromEntries(Object.entries(w).filter(([k]) => !['id', 'quittung', 'quittungen', 'alter_ms', 'zeit', 'mono_ns', 'ist_sample', 'ist_beat'].includes(k)).map(([k, v]) => [k, ohneFluechtiges(v)]));
  }
  return w;
}

export async function lauf(t, mitProjekt) {
  const { o, log, url } = await stapel(t);
  Object.defineProperty(o.kern, 'uhr', { get: () => UHR, set: () => {}, configurable: true });
  if (mitProjekt) await post(url, '/proj/neu', { name: 'Golden' });
  log.length = 0;
  const a = {};
  const r = async (name, p) => { const x = await p; a[name] = { code: x.code, j: ohneFluechtiges(x.j) }; };
  await r('regler_takt', post(url, '/regler', { pfad: 'master/pegel', nach: -3 }));
  await r('regler_phrase', post(url, '/regler', { pfad: 'master/pegel', nach: -4, ab: 'phrase' }));
  await r('regler_schlag_takte2', post(url, '/regler', { pfad: 'master/pegel', nach: -5, ab: 'schlag', takte: 2 }));
  await r('regler_cypher_takte2', post(url, '/regler', { pfad: 'master/pegel', nach: -6, takte: 2 }, CYPHER));
  await r('regler_cypher_nochmal', post(url, '/regler', { pfad: 'master/pegel', nach: -7, takte: 2 }, CYPHER));
  await r('spur', post(url, '/spur', { spur: { name: 'gold', fahrten: [{ ziel: 'master/pegel', ab_takt: 2, takte: 1, nach: -2 }] } }));
  await r('spur_stopp', post(url, '/spur/stopp', { name: 'gold' }));
  await r('tempo', post(url, '/tempo', { bpm: 130 }));
  const lage = await hole(url, '/lage');
  a.lage_uhr = lage.j.uhr; a.lage_schluessel = Object.keys(lage.j).sort();
  a.lage = ohneFluechtiges(lage.j);
  a.an_kern = log.filter((z) => z.typ === 'an_kern' && ['/k/teil', '/k/tempo/rampe'].includes(z.adresse)).map((z) => ({ adresse: z.adresse, felder: ohneFluechtiges(z.felder) }));
  return JSON.parse(JSON.stringify(a, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
}
