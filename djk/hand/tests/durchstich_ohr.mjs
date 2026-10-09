// Durchstich Plan Ohr Task 6 (von Hand, nicht Teil der Suite): SDK-Client → djk-hand → Seiten-Server Instanz i →
// echter Kern (mit dem Hüllkurven-Ring-Schreiber aus T1/T2). Aufbau wie durchstich_instanz.mjs (Plan Hand T10).
// Aufruf: node djk/hand/tests/durchstich_ohr.mjs [http://127.0.0.1:56300]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SEITE = process.argv[2] ?? 'http://127.0.0.1:56300';
const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');
const c = new Client({ name: 'durchstich-ohr', version: '0' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', SEITE] }));
const w = (ms) => new Promise((r) => setTimeout(r, ms));

const ruf = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  const t = r.content[0].text;
  console.log(`${r.isError ? 'FEHLER' : 'ok    '} ${name} ${JSON.stringify(args)} → ${t.length > 300 ? t.slice(0, 300) + '…' : t}`);
  return { fehler: !!r.isError, j: JSON.parse(t) };
};
// Fader auf einen Wert setzen wie Andreas' Hand am Regler: POST /regler OHNE x-djk-quelle-Kopf (Vorgabe andreas,
// hand_bedienung.ts) — nicht über das MCP-Werkzeug regler (das setzt immer die Quelle cypher und wäre für ein
// geschlossenes Deck kein_hoerschein).
async function reglerAndreas(pfad, nach) {
  const r = await fetch(SEITE + '/regler', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pfad, nach, ab: 'jetzt' }) });
  const j = await r.json();
  console.log(`${r.ok ? 'ok    ' : 'FEHLER'} regler(andreas) {"pfad":"${pfad}","nach":${nach}} → ${JSON.stringify(j).slice(0, 200)}`);
  return { code: r.status, j };
}

// Ohr T11 Negativ-Kontrolle: Andreas' Fader-Griff (/griff, immer Quelle andreas, kein Hörschein-Riegel)
const griff = (pfad, u) => fetch(SEITE + '/griff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pfad, u }) });

const assert = (bed, text) => {
  console.log(`${bed ? 'BELEG ' : 'FEHLGESCHLAGEN'} ${text}`);
  if (!bed) throw new Error(`Beleg gescheitert: ${text}`);
};

console.log('=== Ohr Durchstich, Instanz i, Kern aus djk/kern/build-ohr ===');
const b = (await ruf('bestand', { max: 3 })).j.eintraege;
await ruf('laden', { deck: 1, material_id: b[0].material_id });
// Befund (Instanz i frisch, ohne warmen Arbeitsbestand-Cache): /laden meldet 200 bevor /zustand/deck beim
// Seiten-Server ankommt; deck_start direkt danach traf kein_kernstand. Kurz warten, bis das Deck als geladen zählt.
await w(500);
await ruf('deck_start', { deck: 1 });
await w(500);
await reglerAndreas('deck/1/fader', 0);   // Fader 1 auf 0 dB, Quelle andreas
await ruf('laden', { deck: 2, material_id: b[1].material_id });
// Sauberer Ausgang: eq/tief kann von einem früheren Lauf am selben Kern-Prozess noch stehen (Regler sind
// Kanal-Zustand, kein Deck-Zustand, und überleben ein Neuladen). Vor der Messung auf 0 zurücksetzen (Deck geschlossen: erlaubt).
await ruf('regler', { pfad: 'deck/2/eq/tief', nach: 0, takte: 0 });
await ruf('deck_start', { deck: 2 });     // Fader 2 bleibt zu (Vorgabe −200)
await ruf('warte', { takte: 4 });

console.log('--- hoeren deck 2 (hinter geschlossenem Fader, Deck 1 läuft offen als Master)');
const h1 = await ruf('hoeren', { deck: 2 });
assert(!h1.fehler, 'hoeren deck 2 liefert 200');
const v1 = h1.j.vergleich;
console.log(`neu.lufs=${v1.neu.lufs} laufend.lufs=${v1.laufend.lufs} ueberdeckung.sub=${v1.ueberdeckung.sub}`);
assert(v1.neu.lufs > -60, `neu.lufs > -60 (ist ${v1.neu.lufs})`);
assert(v1.laufend.lufs > -60, `laufend.lufs > -60 (ist ${v1.laufend.lufs})`);
assert(v1.ueberdeckung.sub >= 0 && v1.ueberdeckung.sub <= 1, `ueberdeckung.sub in [0,1] (ist ${v1.ueberdeckung.sub})`);

console.log('--- Negativ-Kontrolle: Deck 2 stoppen, 5 Takte warten, erneut hoeren');
await ruf('deck_stopp', { deck: 2 });
await ruf('warte', { takte: 5 });
const h2 = await ruf('hoeren', { deck: 2 });
if (h2.fehler) {
  console.log(`hoeren deck 2 nach Stopp: ${JSON.stringify(h2.j)} (409 zu_wenig_gehoert ist hier ebenfalls ein gültiger Beleg für "nichts mehr gehört")`);
} else {
  const v2 = h2.j.vergleich;
  console.log(`neu.lufs (gestoppt) = ${v2.neu.lufs}`);
  assert(v2.neu.lufs < -100, `neu.lufs < -100 nach Stopp (ist ${v2.neu.lufs})`);
}

console.log('--- Zweiter Fehlerfall: Deck 2 erneut starten (geschlossen), EQ tief -12, Messung sitzt nach dem EQ');
await ruf('deck_start', { deck: 2 });
await ruf('warte', { takte: 4 });
const hVorher = await ruf('hoeren', { deck: 2 });
assert(!hVorher.fehler, 'hoeren deck 2 vor der EQ-Probe liefert 200');
const baenderVorher = hVorher.j.vergleich.neu.baender_db[0];
console.log(`baender_db[0] vorher = ${baenderVorher}`);
await ruf('regler', { pfad: 'deck/2/eq/tief', nach: -12, takte: 1 });  // geschlossen: erlaubt (kein I3a-Griff)
await ruf('warte', { takte: 1 });  // Rampe (1 Takt) fertig laufen lassen, bevor das 4-Takt-Messfenster beginnt
await ruf('warte', { takte: 4 });
const hNachher = await ruf('hoeren', { deck: 2 });
assert(!hNachher.fehler, 'hoeren deck 2 nach der EQ-Probe liefert 200');
const baenderNachher = hNachher.j.vergleich.neu.baender_db[0];
console.log(`baender_db[0] nachher = ${baenderNachher}, Differenz = ${baenderVorher - baenderNachher} dB`);
assert(baenderVorher - baenderNachher >= 10, `baender_db[0] mindestens 10 dB tiefer nach eq/tief -12 (Differenz ${baenderVorher - baenderNachher})`);

console.log('--- Ohr T8 (Plan Rev. 4): sync in /hoeren, unvalidiert. eq/tief wieder auf 0 (sonst verzerrt es die Bänder für den Sync-Beleg) ---');
await ruf('regler', { pfad: 'deck/2/eq/tief', nach: 0, takte: 0 });
await ruf('warte', { takte: 2 });
const hSyncNormal = await ruf('hoeren', { deck: 2 });
assert(!hSyncNormal.fehler, 'hoeren deck 2 (sync, normal) liefert 200');
const syncNormal = hSyncNormal.j.sync;
console.log(`sync (normal): sync_ms=${syncNormal?.sync_ms} deck_gegen_deck_ms=${syncNormal?.deck_gegen_deck_ms} n=${syncNormal?.n} validiert=${syncNormal?.validiert}`);
assert(syncNormal && syncNormal.validiert === false, `sync.validiert === false (ist ${JSON.stringify(syncNormal)})`);
assert(Number.isFinite(syncNormal.sync_ms), `sync_ms endliche Zahl (ist ${syncNormal.sync_ms})`);
assert(Number.isFinite(syncNormal.deck_gegen_deck_ms), `deck_gegen_deck_ms endliche Zahl (ist ${syncNormal.deck_gegen_deck_ms})`);
assert(Number.isFinite(syncNormal.n), `n endliche Zahl (ist ${syncNormal.n})`);

// Grid-Weg des Seiten-Servers (Plan djk-grid, ◀▶ = 5 ms; hier in einem Schritt 20 ms, für cypher gesperrt, ohne
// x-djk-quelle-Kopf also als Andreas): Rev. 4 prüft nur die DIFFERENZ der sync_ms-Werte, kein absolutes |sync_ms|<8.
async function gridSchritt(deck, schritt_ms) {
  const r = await fetch(SEITE + '/deck/raster', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deck, schritt_ms }) });
  const j = await r.json();
  console.log(`${r.ok ? 'ok    ' : 'FEHLER'} grid(andreas) {"deck":${deck},"schritt_ms":${schritt_ms}} → ${JSON.stringify(j).slice(0, 200)}`);
  return { code: r.status, j };
}

console.log('--- Grid Deck 2 um +20 ms verschieben (ein Schritt, entspricht 4× ◀▶ à 5 ms), 4 Takte warten ---');
const g1 = await gridSchritt(2, 20);
assert(g1.code === 200, `grid-Schritt +20 ms liefert 200 (ist ${g1.code})`);
await ruf('warte', { takte: 4 });
const hSyncNachVerschiebung = await ruf('hoeren', { deck: 2 });
assert(!hSyncNachVerschiebung.fehler, 'hoeren deck 2 (sync, nach Verschiebung) liefert 200');
const syncNachVerschiebung = hSyncNachVerschiebung.j.sync;
console.log(`sync (nach +20ms Grid): sync_ms=${syncNachVerschiebung?.sync_ms} deck_gegen_deck_ms=${syncNachVerschiebung?.deck_gegen_deck_ms} n=${syncNachVerschiebung?.n}`);
const differenzVerschiebung = syncNachVerschiebung.sync_ms - syncNormal.sync_ms;
console.log(`Differenz sync_ms (nach − vorher) = ${differenzVerschiebung} ms, erwartet Betrag ≈ 20 ± 3 (Vorzeichen wie gemessen notieren, Auftrag Rev. 4)`);
assert(Math.abs(Math.abs(differenzVerschiebung) - 20) <= 3, `|Differenz sync_ms| ≈ 20 ± 3 (ist ${differenzVerschiebung}, Betrag ${Math.abs(differenzVerschiebung)})`);

console.log('--- Grid Deck 2 um -20 ms zurücksetzen, 4 Takte warten, Differenz gegen Vorher ~0 (Plausibilität) ---');
const g2 = await gridSchritt(2, -20);
assert(g2.code === 200, `grid-Schritt -20 ms liefert 200 (ist ${g2.code})`);
await ruf('warte', { takte: 4 });
const hSyncNachRuecksetzen = await ruf('hoeren', { deck: 2 });
assert(!hSyncNachRuecksetzen.fehler, 'hoeren deck 2 (sync, nach Rücksetzen) liefert 200');
const syncNachRuecksetzen = hSyncNachRuecksetzen.j.sync;
console.log(`sync (nach Rücksetzen): sync_ms=${syncNachRuecksetzen?.sync_ms} deck_gegen_deck_ms=${syncNachRuecksetzen?.deck_gegen_deck_ms} n=${syncNachRuecksetzen?.n}`);
const differenzRuecksetzen = syncNachRuecksetzen.sync_ms - syncNormal.sync_ms;
console.log(`Differenz sync_ms (nach Rücksetzen − vorher) = ${differenzRuecksetzen} ms (Plausibilität, kein hartes Kriterium)`);

console.log('=== Ohr T11: Öffnen mit Hörschein über die Hand ===');
// Sauberer Ausgang (wie eq/tief oben): trim kann von einem früheren, abgebrochenen Lauf noch stehen (Regler sind
// Kanal-Zustand, überleben Neuladen UND einen Server-Neustart, weil der Kern sie hält). Befund: ein voriger Lauf
// dieses Durchstichs brach vor seinem eigenen Aufräumen ab, der neu gestartete Seiten-Server übernahm beim Verbinden
// den stehengebliebenen Trim (5,3 dB) vom Kern — Deck 2 maß deshalb durchgehend ~10,7 dB lauter als der Master.
await ruf('regler', { pfad: 'deck/2/trim', nach: 0, takte: 0 });
await ruf('warte', { takte: 4 });
console.log('--- Deck 2 vorhören, bis hoerschein.urteil === "ok" (höchstens 8 Takte warten) ---');
// Befund: der Master (Deck 1) wandert im Track weiter und wird streckenweise lauter/leiser als Deck 2 — genau der
// Alltagsfall, für den AUFRUF.md den Ablauf hoeren -> regler (EQ/Trim) -> hoeren erneut vorsieht. Nach 3 Takten ohne
// 'ok' wegen Pegel (kein Sync-/Kurz-Grund) einmal per Trim nachjustieren, dann weiter vorhören.
let hoerschein = null;
let korrigiert = false;
for (let i = 0; i < 8 && (!hoerschein || hoerschein.urteil !== 'ok'); i++) {
  const h = await ruf('hoeren', { deck: 2 });
  hoerschein = h.j.hoerschein ?? null;
  console.log(`  Takt ${i + 1}: hoerschein=${JSON.stringify(hoerschein)}`);
  if (hoerschein && hoerschein.urteil !== 'ok' && !korrigiert && i >= 2
      && (hoerschein.urteil === 'zu_laut' || hoerschein.urteil === 'zu_leise') && Number.isFinite(hoerschein.pegel_diff_db)) {
    // relativ zum aktuellen Trim (Mess-Abgriff liegt nach dem Trim): die Seite liefert den Vorschlag fertig
    const vorschlag = h.j.vergleich?.trim_vorschlag_db;
    if (!Number.isFinite(vorschlag)) throw new Error(`hoeren trägt kein vergleich.trim_vorschlag_db (${JSON.stringify(h.j.vergleich)})`);
    const korrektur = Math.max(-24, Math.min(24, vorschlag));
    console.log(`  Pegel-Korrektur (wie AUFRUF.md „hoeren → regler eq/trim → hoeren erneut"): trim ${korrektur} dB (pegel_diff_db war ${hoerschein.pegel_diff_db.toFixed(2)})`);
    await ruf('regler', { pfad: 'deck/2/trim', nach: korrektur, takte: 0 });
    korrigiert = true;
  }
  if (!hoerschein || hoerschein.urteil !== 'ok') await ruf('warte', { takte: 1 });
}
assert(hoerschein && hoerschein.urteil === 'ok', `hoerschein.urteil === 'ok' binnen 8 Takten (ist ${JSON.stringify(hoerschein)})`);

console.log('--- regler deck/2/fader 0 takte 8 (mit gültigem Schein) -> Quittung 2 (angenommen) ---');
const rOeffnen = await ruf('regler', { pfad: 'deck/2/fader', nach: 0, takte: 8 });
assert(!rOeffnen.fehler, `regler-Öffnen mit Schein liefert keinen Werkzeugfehler (${JSON.stringify(rOeffnen.j)})`);
assert(rOeffnen.j.quittung && Number(rOeffnen.j.quittung.status) === 2, `Quittung 2 angenommen (ist ${JSON.stringify(rOeffnen.j.quittung)})`);
// Befund: die 8-Takt-Rampe belegt den Pfad beim Kern bis ab_beat+32; ein sofortiges Schließen direkt danach
// kollidiert (Quittung 6 `ueberlappung`, Kern-eigene Regel, unabhängig vom Hörschein). Also erst die Rampe fertig
// laufen lassen, bevor der Pfad wieder angefasst wird.
await ruf('warte', { takte: 8 });

console.log('--- Fehlerfall: Deck 2 wieder schließen, trim +8 (bei geschlossenem Fader öffnet Trim nicht, §1.6), 4 Takte warten, dann Öffnen -> 409 zu_laut ---');
const rZu = await ruf('regler', { pfad: 'deck/2/fader', nach: -200, takte: 0 });
assert(!rZu.fehler, `Schließen (kein Öffnen, kein Hörschein-Riegel) liefert keinen Werkzeugfehler (${JSON.stringify(rZu.j)})`);
const rTrim = await ruf('regler', { pfad: 'deck/2/trim', nach: 8, takte: 0 });
assert(!rTrim.fehler, `Trim-Änderung bei geschlossenem Fader ist erlaubt (${JSON.stringify(rTrim.j)})`);
// Befund: das Fenster ist selbst 4 Takte lang (Mindestfenster); direkt nach genau 4 Takten Warten deckt es die
// Trim-Änderung gerade erst zur Hälfte ab (Fensteranfang == Zeitpunkt der Änderung), der letzte ausgestellte Schein
// kann dann noch der VORHERIGE (ok) sein. 8 Takte warten, damit das ganze 4-Takt-Fenster hinter der Änderung liegt.
await ruf('warte', { takte: 8 });
const rZuLaut = await ruf('regler', { pfad: 'deck/2/fader', nach: 0, takte: 0 });
assert(rZuLaut.fehler, `regler-Öffnen nach trim +8 liefert einen Werkzeugfehler (409) (ist ${JSON.stringify(rZuLaut.j)})`);
assert(rZuLaut.j.urteil === 'zu_laut', `409-Körper trägt urteil: 'zu_laut' (ist ${JSON.stringify(rZuLaut.j)})`);
await ruf('regler', { pfad: 'deck/2/trim', nach: 0, takte: 0 });   // aufräumen für die Negativ-Kontrolle

console.log('--- Negativ-Kontrolle: Andreas\' Fader-Griff über /griff öffnet OHNE Schein ---');
const gAndreas = await griff('deck/2/fader', 1);
const jAndreas = await gAndreas.json();
console.log(`${gAndreas.ok ? 'ok    ' : 'FEHLER'} griff(andreas) deck/2/fader -> u=1 → ${JSON.stringify(jAndreas).slice(0, 200)}`);
assert(gAndreas.status === 200, `Andreas' Griff öffnet ohne Schein, HTTP 200 (ist ${gAndreas.status}, ${JSON.stringify(jAndreas)})`);

console.log('=== Aufräumen: beide Decks stoppen ===');
await ruf('deck_stopp', { deck: 1 });
await ruf('deck_stopp', { deck: 2 });

console.log('=== ALLE BELEGE GRÜN ===');
await c.close();
process.exit(0);
