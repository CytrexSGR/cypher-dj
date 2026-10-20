// Route-Golden (Plan 2026-10-15-d1-s1, Task 2; Herkunft: Erhebung u4 routen_probe.mjs, erweitert um Antwortform und fremde Herkunft).
// Friert die Oberfläche aller Routen ein: je (Methode, Pfad, Kopf) Status, Content-Type, fehler-Feld und die Form der JSON-Antwort
// (Schlüssel und Typen, keine Werte). Server in-process OHNE Kern und ohne Attrappe, alle Ordner in tmp, leere Bodies.
// Vergleich gegen hilfen/routen_golden.json; neu schreiben nur bewusst: ROUTEN_GOLDEN_SCHREIBEN=1 node --test tests/routen_golden.test.mjs
// Grenze: kein Erfolgspfad der Kern-Routen (dafür server.test.mjs und schutznetz.test.mjs). /proj/* steht NICHT hier (eigener Bereich, Task 10).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './hilfen/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './hilfen/instanz.mjs';

belegeTestInstanz();
const GOLDEN = path.join(import.meta.dirname, 'hilfen', 'routen_golden.json');

export const GET = ['/strom?x=1', '/bestand', '/mediathek/anschluss', '/mediathek', '/mediathek/vorbereiten', '/stoebern', '/stoebern?typ=strudel', '/stoebern/detail',
  '/stoebern/baum', '/stoebern/baum?typ=strudel', '/vorhoeren', '/klaenge/karte', '/klaenge', '/mediathek/listen', '/sammlungen', '/sammlungen/x', '/sammlungen/x/posten',
  '/konfig', '/lage', '/ausgang', '/pegel', '/spur', '/loops', '/loop/automation', '/loop/raster', '/deck/hotcues', '/deck/loop', '/deck/raster', '/hoeren', '/fx',
  '/fx/zuweisung', '/fx/routing', '/strudel', '/klang', '/welle', '/fassung', '/', '/nicht-da', '/app.js'];
export const POST = ['/mediathek/vorbereiten', '/mediathek', '/muster', '/vorhoeren', '/sammlungen', '/sammlungen/import', '/sammlungen/x/posten',
  '/sammlungen/x/posten/entfernen', '/sammlungen/x/posten/verschieben', '/sammlungen/x/umbenennen', '/sammlungen/x/vorbereiten', '/sammlungen/x/loeschen',
  '/sammlungen/x/unsinn', '/griff', '/deck/start', '/deck/stopp', '/abbruch', '/spur', '/spur/stopp', '/regler', '/taste', '/laden', '/tempo',
  '/loops/aus-katalog', '/loop', '/loop/automation', '/fx/routing', '/fx', '/fx/zuweisung', '/deck/sprung', '/deck/scrub', '/deck/hotcue', '/deck/loop',
  '/deck/loop/sichern', '/deck/raster', '/deck/raster/fix', '/strudel', '/strudel/autonom', '/klang', '/nicht-da', '/strom', '/lage'];
export const ANDERE = [['PUT', '/lage'], ['PUT', '/mediathek/vorbereiten'], ['DELETE', '/sammlungen/x'], ['HEAD', '/lage'], ['HEAD', '/']];

// Form einer JSON-Antwort: Schlüssel sortiert, Werte durch ihren Typ ersetzt, Arrays durch die Form ihres ersten Elements, Tiefe 3
export function form(x, t = 0) {
  if (x === null) return 'null';
  if (Array.isArray(x)) return x.length === 0 ? '[]' : t >= 3 ? '[..]' : [form(x[0], t + 1)];
  if (typeof x === 'object') return t >= 3 ? '{..}' : Object.fromEntries(Object.keys(x).sort().map((k) => [k, form(x[k], t + 1)]));
  return typeof x;
}

export async function probe() {
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const huellen = path.join(tmp('rg-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const log = [];
  const alt = process.env.CYPHERDJ_INSTANZ;
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;   // nicht gelenkte Vorgaben (Vorhören, Klang) zeigen auf die Prüfinstanz, nie auf den Betrieb
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmp('rg-bestand-'), arbeitsbestand: tmp('rg-ab-'),
    mutationen: [], loops: tmp('rg-loops-'), kits: tmp('rg-kits-'), welleCache: tmp('rg-welle-'), musterOrdner: tmp('rg-muster-'), hotcueOrdner: tmp('rg-hc-'),
    rasterOrdner: tmp('rg-raster-'), huellen, wirtOrdner: tmp('rg-wirt-'), sammlungen: tmp('rg-sets-'), musterBibliothek: tmp('rg-mb-'), musterSets: tmp('rg-ms-'),
    mediathek: path.join(tmp('rg-med-'), 'gibt-es-nicht.sqlite'), katalog: path.join(tmp('rg-kat-'), 'gibt-es-nicht.sqlite'),
    digitalout: path.join(tmp('rg-do-'), 'nix'), kernPruefmodus: true, log: (z) => log.push(z) });
  await o.starte();
  const url = `http://127.0.0.1:${47300 + K}`;
  async function ruf(methode, pfad, kopf = {}, body) {
    const ac = new AbortController();
    const uhr = setTimeout(() => ac.abort(), 4000);
    try {
      const r = await fetch(url + pfad, { method: methode, headers: kopf, body, signal: ac.signal });
      const art = r.headers.get('content-type') ?? '';
      if (art.startsWith('text/event-stream')) {
        const { value } = await r.body.getReader().read(); ac.abort();
        return { code: r.status, art, form: form(JSON.parse(new TextDecoder().decode(value).replace(/^data: /, ''))) };
      }
      const text = await r.text();
      if (text === '') return { code: r.status, art, leer: true };
      if (!art.startsWith('application/json')) return { code: r.status, art };
      const j = JSON.parse(text);
      return { code: r.status, art, ...(j && typeof j === 'object' && 'fehler' in j ? { fehler: j.fehler } : {}), form: form(j) };
    } catch (e) { return { code: -1, fehler: String(e.name) }; } finally { clearTimeout(uhr); }
  }
  const ergebnis = [];
  try {
    for (const p of GET) ergebnis.push({ m: 'GET', p, ...(await ruf('GET', p)) });
    for (const p of POST) {
      ergebnis.push({ m: 'POST', p, kopf: 'json', ...(await ruf('POST', p, { 'content-type': 'application/json' }, '{}')) });
      ergebnis.push({ m: 'POST', p, kopf: 'text', ...(await ruf('POST', p, {}, '{}')) });
      ergebnis.push({ m: 'POST', p, kopf: 'fremd', ...(await ruf('POST', p, { 'content-type': 'application/json', origin: 'https://boese.example' }, '{}')) });
    }
    for (const [m, p] of ANDERE) ergebnis.push({ m, p, ...(await ruf(m, p)) });
  } finally {
    await o.stoppe();
    if (alt === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt;
  }
  const anKern = log.filter((z) => z.typ === 'an_kern').map((z) => z.adresse);
  return { text: JSON.stringify({ n: ergebnis.length, ergebnis }, null, 1) + '\n', anKern };
}

test('Route-Golden: jede Route antwortet wie eingefroren (Status, Content-Type, fehler, Form); kein Befehl an den Kern', async () => {
  const { text, anKern } = await probe();
  assert.deepEqual(anKern, ['/k/tschuess'], 'die Probe sendet dem Kern nichts außer der Abmeldung beim Stoppen');
  if (process.env.ROUTEN_GOLDEN_SCHREIBEN === '1') { fs.writeFileSync(GOLDEN, text); return; }
  assert.equal(text, fs.readFileSync(GOLDEN, 'utf8'), 'Route-Oberfläche verändert: diff gegen hilfen/routen_golden.json');
});
