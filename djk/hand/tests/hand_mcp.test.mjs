// djk-hand über stdio mit dem SDK-Client, gegen eine Seiten-Attrappe (HTTP): Werkzeugliste, Quellkopf, Fehlerabbildung.
import fs from 'node:fs';
import { ALLE_STROEME, REC_EINGANG } from '../../contract/streams.ts';
import { PFAD } from '../../ui/hand_operation.ts';
import { bandMitteHz, SPEKTRUM_FRIST_MS } from '../../ui/public/spectrum.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');
const NAMEN = ['lage', 'bestand', 'laden', 'deck_start', 'deck_stopp', 'sprung', 'loop', 'pad', 'loop_nach_box', 'box',
  'regler', 'fx', 'fx_zuweisung', 'strudel', 'abbrechen', 'warte', 'hoeren',
  'studio', 'loops', 'rec', 'loop_klang', 'spur', 'spur_stopp', 'spuren', 'stille', 'pegel', 'graphen', 'graph', 'klang', 'instrumente', 'bibliothek', 'anschluss', 'stoebern', 'klaenge', 'bestand_karte', 'vorbereiten',
  'sets', 'set_zeige', 'set_lege', 'set_vorbereiten', 'tempo', 'ansage',
  'proj_liste', 'proj_neu', 'proj_oeffnen', 'proj_lage', 'proj_auto_zustand', 'proj_aendern', 'proj_undo', 'proj_redo', 'proj_verlauf', 'proj_transport', 'proj_freeze', 'proj_export', 'proj_lautheit', 'geraete_lage', 'proj_aufnahme', 'proj_warp', 'proj_auto', 'proj_bk', 'proj_stems', 'proj_stems_abbrechen', 'proj_zusammenfuehren', 'proj_bounce', 'proj_strom_aufnehmen',
  'spektrum', 'take_vorhoeren', 'proj_kits', 'proj_muster', 'proj_routing', 'proj_resample', 'proj_midi_import',
  'presets_suchen', 'presets_lesen', 'presets_speichern', 'presets_anwenden', 'kollektionen', 'kollektion_aendern', 'plugins'];   // 1.16 rest U5; 1.9 T2.5 proj_kits; 1.14 comping S1 T9; D1 S2 (Spec 3.5), Paket 1.18 E-b, Paket 1.13 Warp, Slice 6 Stems

async function aufbau(t, antworten, env) {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      gesehen.push({ methode: q.method, pfad: q.url, quelle: q.headers['x-djk-quelle'], koerper: b ? JSON.parse(b) : null });
      const [code, j] = antworten(q.method, q.url, gesehen[gesehen.length - 1].koerper) ?? [404, { fehler: 'unbekannt' }];
      a.writeHead(code, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
    });
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`], ...(env ? { env: { ...process.env, ...env } } : {}) }));
  t.after(async () => { await c.close(); s.close(); });
  return { c, gesehen };
}

test('djk-hand: alle Werkzeuge, jeder Aufruf mit x-djk-quelle cypher, Quittung 6 und HTTP 409 werden Werkzeugfehler', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/lage') return [200, { uhr: { beat: 8, takt: 3, schlag: 1, bpm: 128 }, decks: [] }];
    if (u === '/regler') return [200, { ok: true, felder: { id: 1 }, quittung: { status: 6, grund: 'nur_hand' } }];
    if (u === '/deck/start') return [409, { fehler: 'ziel_ungehoert', text: 'deck is open' }];
    if (u === '/deck/loop') return [200, { ok: true, felder: { id: 2 }, quittung: { status: 5, grund: '' } }];
    if (u?.startsWith('/hoeren')) return [200, { deck: 2, takte: 4, vergleich: { neu: { lufs: -12.3 } } }];
  });
  const namen = (await c.listTools()).tools.map((x) => x.name);
  assert.deepEqual(namen.sort(), [...NAMEN].sort());
  const l = await c.callTool({ name: 'lage', arguments: {} });
  assert.ok(!l.isError); assert.equal(JSON.parse(l.content[0].text).uhr.takt, 3);
  const r = await c.callTool({ name: 'regler', arguments: { pfad: 'xfader', nach: 0.5 } });
  assert.equal(r.isError, true); assert.match(r.content[0].text, /nur_hand/);
  const s = await c.callTool({ name: 'deck_start', arguments: { deck: 2 } });
  assert.equal(s.isError, true); assert.match(s.content[0].text, /ziel_ungehoert/);
  // Negativ-Kontrolle: Status 5 (verspätet AUSGEFÜHRT) ist Erfolg, kein Fehler
  const lp = await c.callTool({ name: 'loop', arguments: { deck: 1, beats: 4 } });
  assert.ok(!lp.isError, lp.content[0].text);
  assert.deepEqual(gesehen.find((x) => x.pfad === '/deck/loop').koerper, { deck: 1, laenge: 4, raster: 4 });
  // hoeren: GET mit deck/takte in der Query, liefert die Antwort des Seiten-Servers unverändert
  const h = await c.callTool({ name: 'hoeren', arguments: { deck: 2, takte: 4 } });
  assert.ok(!h.isError, h.content[0].text);
  assert.deepEqual(JSON.parse(h.content[0].text), { deck: 2, takte: 4, vergleich: { neu: { lufs: -12.3 } } });
  assert.ok(gesehen.some((x) => x.methode === 'GET' && x.pfad === '/hoeren?deck=2&takte=4'), JSON.stringify(gesehen.map((x) => x.pfad)));
  assert.ok(gesehen.length >= 4 && gesehen.every((x) => x.quelle === 'cypher'), JSON.stringify(gesehen.map((x) => x.quelle)));
});

test('djk-hand: Seite nicht erreichbar → Werkzeugfehler mit Grund, kein Absturz', async (t) => {
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', 'http://127.0.0.1:9'] }));
  t.after(() => c.close());
  const r = await c.callTool({ name: 'lage', arguments: {} });
  assert.equal(r.isError, true); assert.match(r.content[0].text, /seite_nicht_erreichbar/);
});

test('djk-hand: strudel sendet strom (Vorgabe 1), Strom 2 wird durchgereicht, Schema nennt die Ströme der Tabelle (S18: 1 2 3 5 6 7 9 10)', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/strudel' ? [200, { ok: true }] : null));
  const r1 = await c.callTool({ name: 'strudel', arguments: { code: 's("bd")' } });
  assert.ok(!r1.isError, r1.content[0].text);
  const r2 = await c.callTool({ name: 'strudel', arguments: { code: 's("bd")', strom: 2 } });
  assert.ok(!r2.isError, r2.content[0].text);
  const k = gesehen.filter((x) => x.pfad === '/strudel').map((x) => x.koerper);
  assert.deepEqual(k, [{ text: 's("bd")', strom: 1 }, { text: 's("bd")', strom: 2 }]);
  const schema = (await c.listTools()).tools.find((x) => x.name === 'strudel').inputSchema;
  assert.deepEqual(schema.properties.strom.enum, [...ALLE_STROEME]);   // S18: was [1, 2, 3]; now the shared stream table
});

test('djk-hand rec: geht bei jedem Tempo an /loop (Plan Tempo-Folge: kein 128-Vorcheck mehr)', async (t) => {
  let bpm = 130;
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/lage') return [200, { uhr: { beat: 8, bpm } }];
    if (u === '/loop') return [200, { ok: true, felder: { id: 5 }, quittung: { status: 2, grund: '' } }];
  });
  const r = await c.callTool({ name: 'rec', arguments: { beats: 16, name: 'g1' } });
  assert.ok(!r.isError, r.content[0].text);
  const posts = gesehen.filter((x) => x.methode === 'POST' && x.pfad === '/loop');
  assert.equal(posts.length, 1, 'genau ein POST /loop bei 130 BPM');
  assert.deepEqual(posts[0].koerper, { aktion: 'rec', beats: 16, name: 'g1' });
  // Negativ-Kontrolle: bei 128 BPM unverändert
  bpm = 128;
  const ok = await c.callTool({ name: 'rec', arguments: { beats: 16, name: 'g1' } });
  assert.ok(!ok.isError, ok.content[0].text);
  assert.equal(gesehen.filter((x) => x.methode === 'POST' && x.pfad === '/loop').length, 2);
});

test('djk-hand rec: Kern-Quittung 6 (Tempo/Stop/Überlappung) wird Werkzeugfehler', async (t) => {
  const { c } = await aufbau(t, (m, u) => {
    if (u === '/lage') return [200, { uhr: { beat: 8, bpm: 128 } }];
    if (u === '/loop') return [200, { ok: true, felder: { id: 5 }, quittung: { status: 6, grund: 'ueberlappung' } }];
  });
  const r = await c.callTool({ name: 'rec', arguments: { beats: 4, name: 'g2' } });
  assert.equal(r.isError, true); assert.match(r.content[0].text, /ueberlappung/);
});

test('djk-hand studio: drei Ströme, Strom 2 mit autonom false', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => {
    const n = /^\/strudel\?strom=(\d)$/.exec(u ?? '');
    return n ? [200, { autonom: Number(n[1]) !== 2, text: 'silence', von: 'cypher' }] : null;
  });
  const r = await c.callTool({ name: 'studio', arguments: {} });
  assert.ok(!r.isError, r.content[0].text);
  const j = JSON.parse(r.content[0].text);
  assert.equal(j.stroeme.length, 3);
  assert.deepEqual(j.stroeme.map((x) => x.strom), [1, 2, 3]);
  assert.equal(j.stroeme[1].autonom, false);
  assert.equal(j.stroeme[0].autonom, true);
  // S18: studio first asks /lage which streams run (here 404: the three studio streams as before), then one GET per stream
  assert.deepEqual(gesehen.map((x) => x.pfad), ['/lage', '/strudel?strom=1', '/strudel?strom=2', '/strudel?strom=3']);
});

test('djk-hand loops: GET /loops unverändert', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/loops' ? [200, [{ name: 'a', beats: 4 }]] : null));
  const r = await c.callTool({ name: 'loops', arguments: {} });
  assert.ok(!r.isError, r.content[0].text);
  assert.equal(gesehen[0].pfad, '/loops');
});

test('djk-hand loop_klang: POST /loop aktion kit mit name und klang', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/loop' ? [200, { ok: true, klang: 'rec0' }] : null));
  const r = await c.callTool({ name: 'loop_klang', arguments: { name: 'g1', klang: 'x' } });
  assert.ok(!r.isError, r.content[0].text);
  assert.deepEqual(gesehen[0].koerper, { aktion: 'kit', name: 'g1', klang: 'x' });
  const r2 = await c.callTool({ name: 'loop_klang', arguments: { name: 'g1' } });
  assert.deepEqual(gesehen[1].koerper, { aktion: 'kit', name: 'g1' });
  const w = (await c.listTools()).tools.find((x) => x.name === 'loop_klang');
  assert.match(w.description, /may cut sounding voices/);
});

test('djk-hand stille: Negativ-Kontrolle, alle drei Ströme 200 → kein Fehler, drei POSTs', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/strudel' ? [200, { ok: true, code: 'silence', j: 1 }] : null));
  const ok = await c.callTool({ name: 'stille', arguments: {} });
  assert.ok(!ok.isError, ok.content[0].text);
  assert.deepEqual(gesehen.filter((x) => x.pfad === '/strudel').map((x) => x.koerper), [1, 2, 3].map((strom) => ({ text: 'silence', strom })));   // S18: plus one GET /lage for the stream list
});

test('djk-hand stille: Strom 2 auto_aus → Fehler nennt auto_aus und strom 2, 1 und 3 sind trotzdem gesendet', async (t) => {
  let n = 0;
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u !== '/strudel') return null;
    n++;
    return n === 2 ? [409, { fehler: 'auto_aus' }] : [200, { ok: true }];
  });
  const r = await c.callTool({ name: 'stille', arguments: {} });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /auto_aus/); assert.match(r.content[0].text, /strom 2/);
  assert.deepEqual(gesehen.filter((x) => x.pfad === '/strudel').map((x) => x.koerper.strom), [1, 2, 3]);
});

test('djk-hand spur/spur_stopp/spuren: Körper {spur:{name,fahrten}, ab}, Stopp {name}, spuren GET /spur', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/spur' || u === '/spur/stopp') return [200, m === 'GET' ? { laufend: [] } : { ok: true }];
  });
  const fahrten = [{ ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1, takte: 8, nach: -15, von: -45 }];
  const r = await c.callTool({ name: 'spur', arguments: { name: 'bass-auf-8', fahrten, ab: 'phrase' } });
  assert.ok(!r.isError, r.content[0].text);
  assert.deepEqual(gesehen[0].koerper, { spur: { name: 'bass-auf-8', fahrten }, ab: 'phrase' });
  await c.callTool({ name: 'spur', arguments: { name: 'x', fahrten } });
  assert.deepEqual(gesehen[1].koerper, { spur: { name: 'x', fahrten }, ab: 'takt' });
  await c.callTool({ name: 'spur_stopp', arguments: { name: 'bass-auf-8' } });
  assert.deepEqual(gesehen[2].koerper, { name: 'bass-auf-8' });
  const s = await c.callTool({ name: 'spuren', arguments: {} });
  assert.ok(!s.isError, s.content[0].text);
  assert.equal(gesehen[3].pfad, '/spur'); assert.equal(gesehen[3].methode, 'GET');
  const w = (await c.listTools()).tools.find((x) => x.name === 'spur');
  assert.match(w.description, /ab_takt/); assert.match(w.description, /strom:1\.\.3/);
});

test('djk-hand pegel: ohne Argument GET /pegel?sek=3, mit sek=5 GET /pegel?sek=5', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u?.startsWith('/pegel') ? [200, { sek: 3, kanaele: { master: { n: 30, max_db: -6, median_db: -9 } } }] : null));
  const r = await c.callTool({ name: 'pegel', arguments: {} });
  assert.ok(!r.isError, r.content[0].text);
  assert.equal(JSON.parse(r.content[0].text).kanaele.master.max_db, -6);
  assert.ok(gesehen.some((x) => x.methode === 'GET' && x.pfad === '/pegel?sek=3'));
  await c.callTool({ name: 'pegel', arguments: { sek: 5 } });
  assert.ok(gesehen.some((x) => x.pfad === '/pegel?sek=5'));
});

test('djk-hand klang: Körper unverändert an POST /klang, Fehler 409 auto_aus wird Werkzeugfehler', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/klang' ? [200, { ok: true, text: 'x' }] : null));
  const k = { gruppe: 'bass', aktion: 'fahre', parameter: 'volume', ziel: -12, sekunden: 15, von: -40 };
  const r = await c.callTool({ name: 'klang', arguments: k });
  assert.ok(!r.isError, r.content[0].text);
  const g = gesehen.find((x) => x.pfad === '/klang');
  assert.equal(g.methode, 'POST'); assert.equal(g.quelle, 'cypher'); assert.deepEqual(g.koerper, k);
  const w = (await c.listTools()).tools.find((x) => x.name === 'klang');
  assert.match(w.description, /Surge XT/); assert.match(w.description, /BASS \(strom 2\)/);
  const { c: c2 } = await aufbau(t, () => [409, { fehler: 'auto_aus', text: 'AUTO is off for this instance: Andreas holds it' }]);
  const e = await c2.callTool({ name: 'klang', arguments: { gruppe: 'bass', aktion: 'lade', name: 'x' } });
  assert.equal(e.isError, true); assert.match(e.content[0].text, /auto_aus/);
});

test('Baukasten S2 djk-hand klang: param und params gehen unverändert an POST /klang', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/klang' ? [200, { ok: true, params: { 'Knob 1': 0.5 }, namen: { 'Knob 1': 'Cutoff' } }] : null));
  for (const k of [{ gruppe: 'melodie', aktion: 'param', name: 'Knob 1', wert: 0.3 }, { gruppe: 'melodie', aktion: 'params' }]) {
    const r = await c.callTool({ name: 'klang', arguments: k });
    assert.ok(!r.isError, r.content[0].text);
    assert.deepEqual(gesehen.filter((x) => x.pfad === '/klang').at(-1).koerper, k);
  }
  const w = (await c.listTools()).tools.find((x) => x.name === 'klang');
  assert.ok(w.inputSchema.properties.aktion.enum.includes('param') && w.inputSchema.properties.aktion.enum.includes('params'));
  assert.match(w.description, /Cypher Modular/);
});

test('djk-hand instrumente: AUTO aus auf Strom 2 → auto_aus, Skript nicht gerufen; AUTO an → Skript gerufen, Ausgabe zurück', async (t) => {
  const fs = await import('node:fs'); const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-instr-')); const spur = path.join(dir, 'gerufen');
  const skript = path.join(dir, 'djk-instrumente');
  fs.writeFileSync(skript, `#!/bin/sh\necho "$@" >> ${spur}\necho "  wirt bass    started"\n`, { mode: 0o755 });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let autonom2 = false;
  const lage = () => [200, { ki: { gestoppt: false }, studio: { stroeme: [{ strom: 1, autonom: true }, { strom: 2, autonom: autonom2 }, { strom: 3, autonom: true }] } }];
  const { c } = await aufbau(t, (m, u) => (u === '/lage' ? lage() : undefined), { DJK_INSTRUMENTE: skript });
  const e = await c.callTool({ name: 'instrumente', arguments: {} });
  assert.equal(e.isError, true); assert.match(e.content[0].text, /auto_aus/); assert.match(e.content[0].text, /instance 2/);
  assert.equal(fs.existsSync(spur), false);
  autonom2 = true;
  const r = await c.callTool({ name: 'instrumente', arguments: {} });
  assert.ok(!r.isError, r.content[0].text);
  assert.deepEqual(JSON.parse(r.content[0].text).ausgabe, ['wirt bass    started']);
  assert.equal(fs.readFileSync(spur, 'utf8').trim(), '');   // Seite auf Zufallsport → keine Instanz
  const f = await c.callTool({ name: 'instrumente', arguments: { melodie: 'fluegel' } });   // Glanz Welle 4
  assert.ok(!f.isError, f.content[0].text);
  assert.equal(fs.readFileSync(spur, 'utf8').trim().split('\n').at(-1), '--melodie fluegel');
  const x = await c.callTool({ name: 'instrumente', arguments: { melodie: 'orgel' } });
  assert.equal(x.isError, true);
  assert.equal(fs.readFileSync(spur, 'utf8').split('\n').length - 1, 2);   // zwei Aufrufe; die ungültige Wahl ruft das Skript nicht
});

test('djk-hand bibliothek/vorbereiten: Query an GET /mediathek, POST dann Status bis fertig', async (t) => {
  let abfragen = 0;
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u.startsWith('/mediathek?')) return [200, { treffer: [{ material_id: 'aa', titel: 'X' }], gesamt: 1 }];
    if (m === 'POST' && u === '/mediathek/vorbereiten') return [202, { material_id: 'aa', status: 'laeuft' }];
    if (u.startsWith('/mediathek/vorbereiten?')) return [200, { material_id: 'aa', status: ++abfragen < 2 ? 'laeuft' : 'neu' }];
  });
  const s = await c.callTool({ name: 'bibliothek', arguments: { text: 'metal', bpm: '120-125', max: 5 } });
  assert.ok(!s.isError, s.content[0].text);
  assert.ok(gesehen.some((x) => x.pfad === '/mediathek?text=metal&bpm=120-125&limit=5'), JSON.stringify(gesehen.map((x) => x.pfad)));
  const v = await c.callTool({ name: 'vorbereiten', arguments: { material_id: 'aa' } });
  assert.ok(!v.isError, v.content[0].text);
  assert.equal(JSON.parse(v.content[0].text).status, 'neu');
});

test('djk-hand klaenge: Query-String kommt an, Antwort unverändert, Fehler wird Werkzeugfehler', async (t) => {
  const antwort = { treffer: [{ sha: 'x', einsatz: 'nur_live', quelle: 'mediathek' }], gesamt: 1, gesamt_genau: true };
  const { c, gesehen } = await aufbau(t, (m, u) => (u.startsWith('/klaenge?text=piano') ? [200, antwort] : u.startsWith('/klaenge?bpm=') ? [400, { fehler: 'bpm_ungueltig' }] : undefined));
  const r = await c.callTool({ name: 'klaenge', arguments: { text: 'piano', typ: 'oneshot', einsatz: 'nur_live', limit: 5 } });
  assert.ok(!r.isError, r.content[0].text);
  assert.ok(gesehen.some((x) => x.methode === 'GET' && x.pfad === '/klaenge?text=piano&typ=oneshot&einsatz=nur_live&limit=5'), JSON.stringify(gesehen.map((x) => x.pfad)));
  assert.deepEqual(JSON.parse(r.content[0].text), antwort);
  const f = await c.callTool({ name: 'klaenge', arguments: { bpm: 'abc' } });
  assert.equal(f.isError, true); assert.match(f.content[0].text, /bpm_ungueltig/);
});

test('djk-hand bestand_karte: GET /klaenge/karte, Antwort unverändert, Seitenfehler wird Werkzeugfehler', async (t) => {
  const karte = { je_typ: { oneshot: { gesamt: 2, sofort: 0, werkstatt: 1, nur_live: 1 } }, packs: [], loopbib: 3, mediathek_stand: '2026-10-06T00:00:00.000Z', erzeugt_am: '2026-10-06T01:00:00.000Z' };
  let ok = true;
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/klaenge/karte' ? (ok ? [200, karte] : [500, { fehler: 'mediathek_abfrage' }]) : undefined));
  const r = await c.callTool({ name: 'bestand_karte', arguments: {} });
  assert.ok(!r.isError, r.content[0].text);
  assert.ok(gesehen.some((x) => x.methode === 'GET' && x.pfad === '/klaenge/karte'));
  assert.deepEqual(JSON.parse(r.content[0].text), karte);
  ok = false;
  const f = await c.callTool({ name: 'bestand_karte', arguments: {} });
  assert.equal(f.isError, true); assert.match(f.content[0].text, /mediathek_abfrage/);
});

test('djk-hand vorbereiten: Statusabfrage 404 bricht sofort ab und wird Werkzeugfehler (Negativfall zum Erfolgspfad)', async (t) => {
  let abfragen = 0;
  const { c } = await aufbau(t, (m, u) => {
    if (m === 'POST' && u === '/mediathek/vorbereiten') return [202, { material_id: 'bb', status: 'laeuft' }];
    if (u.startsWith('/mediathek/vorbereiten?')) { abfragen++; return [404, { fehler: 'unbekannt' }]; }
  });
  const t0 = Date.now();
  const v = await c.callTool({ name: 'vorbereiten', arguments: { material_id: 'bbbbbbbbbbbbbbbb' } });
  assert.equal(v.isError, true, v.content[0].text);
  assert.match(v.content[0].text, /unbekannt/);
  assert.equal(abfragen, 1);
  assert.ok(Date.now() - t0 < 6000);
});

test('djk-hand Sets: Liste, Ansicht, Track hineinlegen (legt Set bei Bedarf an), alles vorbereiten', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (m === 'GET' && u === '/sammlungen?art=set') return [200, [{ slug: 'a', name: 'A', posten: 1 }]];
    if (m === 'GET' && u === '/sammlungen/a') return [200, { slug: 'a', name: 'A', posten: [], uebersicht: { tracks: 0 } }];
    if (m === 'GET' && u === '/sammlungen/neu') return [404, { fehler: 'unbekannt' }];
    if (m === 'POST' && u === '/sammlungen') return [201, { slug: 'neu' }];
    if (m === 'POST' && u === '/sammlungen/neu/posten') return [201, { id: 'p1' }];
    if (m === 'POST' && u === '/sammlungen/a/vorbereiten') return [202, { eingereiht: 3 }];
  });
  assert.equal(JSON.parse((await c.callTool({ name: 'sets', arguments: {} })).content[0].text)[0].slug, 'a');
  assert.ok(!(await c.callTool({ name: 'set_zeige', arguments: { slug: 'a' } })).isError);
  const l = await c.callTool({ name: 'set_lege', arguments: { slug: 'neu', name: 'Neu', material_id: '0021a3a9c077b9d5' } });
  assert.ok(!l.isError, l.content[0].text);
  assert.deepEqual(gesehen.filter((x) => x.methode === 'POST').map((x) => [x.pfad, x.koerper]),
    [['/sammlungen', { name: 'Neu' }], ['/sammlungen/neu/posten', { art: 'track', material_id: '0021a3a9c077b9d5' }]]);
  assert.equal(JSON.parse((await c.callTool({ name: 'set_vorbereiten', arguments: { slug: 'a' } })).content[0].text).eingereiht, 3);
});

test('djk-hand tempo: POST /tempo {bpm}, Kern-Quittung 6 wird Werkzeugfehler, 400 bereich auch', async (t) => {
  let antwort = [200, { ok: true, felder: { id: 1, ziel_bpm: 140 }, quittung: { status: 5, grund: '' } }];
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/tempo' ? antwort : undefined));
  const ok = await c.callTool({ name: 'tempo', arguments: { bpm: 140 } });
  assert.ok(!ok.isError, ok.content[0].text);
  assert.deepEqual(gesehen.find((x) => x.pfad === '/tempo').koerper, { bpm: 140 });
  antwort = [409, { fehler: 'ki_gestoppt' }];   // die Seite antwortet bei Stop Cypher selbst (server.ts:1768)
  const nein = await c.callTool({ name: 'tempo', arguments: { bpm: 140 } });
  assert.equal(nein.isError, true); assert.match(nein.content[0].text, /ki_gestoppt/);
  antwort = [400, { fehler: 'bereich' }];
  const aus = await c.callTool({ name: 'tempo', arguments: { bpm: 250 } });
  assert.equal(aus.isError, true); assert.match(aus.content[0].text, /bereich/);
  assert.deepEqual(gesehen.filter((x) => x.pfad === '/tempo').at(-1).koerper, { bpm: 250 });
  antwort = [200, { ok: true, felder: { id: 3 }, quittung: { status: 6, grund: 'ueberlappung' } }];
  const kern = await c.callTool({ name: 'tempo', arguments: { bpm: 140 } });
  assert.equal(kern.isError, true); assert.match(kern.content[0].text, /ueberlappung/);
});

// Review 2026-11-05: POST /tempo answers 409 beschaeftigt while a project freeze runs (server.ts tempo()); the text must say so.
test('djk-hand tempo: description names the beschaeftigt refusal during a freeze, and the 409 becomes a tool error', async (t) => {
  const { c } = await aufbau(t, (m, u) => (u === '/tempo' ? [409, { fehler: 'beschaeftigt', text: 'a freeze is running' }] : undefined));
  const tempo = (await c.listTools()).tools.find((x) => x.name === 'tempo').description;
  assert.match(tempo, /beschaeftigt/);
  assert.match(tempo, /proj_freeze|freeze/);
  const r = await c.callTool({ name: 'tempo', arguments: { bpm: 140 } });
  assert.equal(r.isError, true); assert.match(r.content[0].text, /beschaeftigt/);
});

// Keylock 3 (Plan 2026-10-06-keylock-echtzeit.md, Fassung 4): EIN Knopf `keylock` für alle Quellen; tempo sagt das, regler
// kennt den Pfad, vom alten Render-und-Tausch (decks[].keylock, rendert, tauscht) steht nichts mehr da.
test('djk-hand Keylock 3: tempo nennt den globalen Knopf keylock, regler den Pfad, kein Render-und-Tausch', async (t) => {
  const { c } = await aufbau(t, () => undefined);
  const werkzeuge = (await c.listTools()).tools;
  const tempo = werkzeuge.find((x) => x.name === 'tempo').description;
  const regler = werkzeuge.find((x) => x.name === 'regler').description;
  assert.match(tempo, /All sources keep their pitch \(keylock, on by default; `keylock` via regler\)/);
  assert.doesNotMatch(tempo, /decks\[\]\.keylock|renders the track|swaps the deck|rendert|tauscht/);
  assert.match(regler, /\bkeylock\b/);
  assert.match(tempo, /null unknown/); assert.match(tempo, /Exceptions with keylock on/);   // 3b
  assert.doesNotMatch(regler + tempo, /deck\/<n>\/keylock|deck\/[1-4]\/keylock/);
});

// S5r Task 4: the tool description names the graph knob paths and passes them through to POST /regler unchanged
test('djk-hand S5r: regler names <kanal>/bk/1..8 and sends the path through to /regler', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/regler' ? [200, { ok: true, felder: { id: 1 }, quittung: { status: 5, grund: '' } }] : undefined));
  const regler = (await c.listTools()).tools.find((x) => x.name === 'regler').description;
  assert.match(regler, /<kanal>\/bk\/1\.\.8 \(deck\/1\.\.4, erz\/1\|2\|3\|5\|6\|7, pad\/1\|2; 0\.\.1, default 0\.5/);
  await c.callTool({ name: 'regler', arguments: { pfad: 'deck/1/bk/3', nach: 0.8 } });
  assert.deepEqual(gesehen.filter((g) => g.pfad === '/regler').map((g) => [g.koerper.pfad, g.koerper.nach]), [['deck/1/bk/3', 0.8]]);
});

// S14: the send-return knobs fx/3/bk/1..8, fx/4/bk/1..8 are named in the tool descriptions and pass through to /regler
test('djk-hand S14: regler names fx/3/bk/1..8 and passes fx/4/bk/1 through; graph no longer says the knobs are fixed', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/regler' ? [200, { ok: true, felder: { id: 1 }, quittung: { status: 5, grund: '' } }] : undefined));
  const tools = (await c.listTools()).tools;
  const regler = tools.find((x) => x.name === 'regler').description;
  const graph = tools.find((x) => x.name === 'graph').description;
  assert.match(regler, /fx\/3\/bk\/1\.\.8, fx\/4\/bk\/1\.\.8/);
  assert.doesNotMatch(graph, /fixed at 0\.5/);
  assert.match(graph, /fx\/3\/bk\/1\.\.8/);
  await c.callTool({ name: 'regler', arguments: { pfad: 'fx/4/bk/1', nach: 0.3 } });
  assert.deepEqual(gesehen.filter((g) => g.pfad === '/regler').map((g) => [g.koerper.pfad, g.koerper.nach]), [['fx/4/bk/1', 0.3]]);
});

test('djk-hand anschluss: deck oder material_id, energie, max als Query an GET /mediathek/anschluss', async (t) => {
  const antwort = { lauf: { material_id: 'aa', camelot: '8A' }, treffer: [{ titel: 'X', punkte: 0.9 }], bewertet: 1 };
  const { c, gesehen } = await aufbau(t, (m, u) => (u.startsWith('/mediathek/anschluss?deck=1') ? [200, antwort] : u.startsWith('/mediathek/anschluss?deck=2') ? [409, { fehler: 'deck_leer' }] : undefined));
  const r = await c.callTool({ name: 'anschluss', arguments: { deck: 1, energie: 'heben', max: 5 } });
  assert.ok(!r.isError, r.content[0].text);
  assert.ok(gesehen.some((x) => x.pfad === '/mediathek/anschluss?deck=1&energie=heben&limit=5'), JSON.stringify(gesehen.map((x) => x.pfad)));
  assert.deepEqual(JSON.parse(r.content[0].text), antwort);
  const f = await c.callTool({ name: 'anschluss', arguments: { deck: 2 } });
  assert.ok(f.isError, 'deck_leer wird Werkzeugfehler');
});

test('djk-hand stoebern: typ, text, Filter als Query an GET /stoebern; nachbarn als 1', async (t) => {
  const antwort = { typ: 'oneshot', gesamt: 2, treffer: [{ name: 'Kick 01', sha: 'a'.repeat(64) }] };
  const { c, gesehen } = await aufbau(t, (m, u) => (u.startsWith('/stoebern?') ? [200, antwort] : undefined));
  const r = await c.callTool({ name: 'stoebern', arguments: { typ: 'oneshot', text: 'kick', camelot: '8A', nachbarn: true, limit: 5 } });
  assert.ok(!r.isError, r.content[0].text);
  assert.ok(gesehen.some((x) => x.pfad === '/stoebern?typ=oneshot&text=kick&camelot=8A&nachbarn=1&limit=5'), JSON.stringify(gesehen.map((x) => x.pfad)));
  assert.deepEqual(JSON.parse(r.content[0].text), antwort);
});

test('djk-hand stoebern: Feld-Präfixe im Text werden kodiert durchgereicht; strudel ist ein Typ; Seitenfehler (400) wird Werkzeugfehler', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u.includes('typ=musik') ? [400, { fehler: 'typ_ungueltig' }] : u.includes('typ=strudel') ? [400, { fehler: 'suchfeld_nicht_anwendbar' }] : u.startsWith('/stoebern?') ? [200, { gesamt: 0, treffer: [] }] : undefined));
  const ok = await c.callTool({ name: 'stoebern', arguments: { typ: 'track', text: 'label:drumcode artist:"a b"' } });
  assert.ok(!ok.isError, ok.content[0].text);
  assert.ok(gesehen.some((x) => x.pfad === '/stoebern?typ=track&text=label%3Adrumcode+artist%3A%22a+b%22'), JSON.stringify(gesehen.map((x) => x.pfad)));
  const f = await c.callTool({ name: 'stoebern', arguments: { typ: 'strudel', text: 'label:x' } });
  assert.equal(f.isError, true); assert.match(f.content[0].text, /suchfeld_nicht_anwendbar/);
  const u = await c.callTool({ name: 'stoebern', arguments: { typ: 'musik' } });
  assert.equal(u.isError, true, 'Negativ: unbekannter Typ (Antwort der Seite 400) wird Werkzeugfehler'); assert.match(u.content[0].text, /typ_ungueltig/);
});

test('djk-hand fx: art 5 (reverb) steht im Schema und wird durchgereicht', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/fx' ? [200, { ok: true, felder: { id: 3 } }] : undefined));
  const fx = (await c.listTools()).tools.find((x) => x.name === 'fx');
  assert.deepEqual(fx.inputSchema.properties.art.enum, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const r = await c.callTool({ name: 'fx', arguments: { einheit: 1, art: 5, beats: 2, wet: 0.6, param1: 0.4, an: true } });
  assert.ok(!r.isError, JSON.stringify(r.content));
  assert.equal(gesehen.find((g) => g.pfad === '/fx').koerper.art, 5);
});

// B4 (Spec 6.30): proj_lage liest /proj/aktuell?noten=zahl (Noten nur als Zahl je Clip), die rev kommt aus der schmalen Abfrage /proj/aktuell?nur=rev
test('djk-hand proj_* (D1 S2, Spec 3.5): Routen, Quelle cypher, rev aus /proj/aktuell?nur=rev, kein Projekt, ki_gestoppt und Quittung 6 werden Werkzeugfehler', async (t) => {
  let projekt = { rev: 4, name: 'P' };
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/proj/liste') return [200, [{ slug: 'p', name: 'P', geaendert: '2026-10-15T12:00:00.000Z' }]];
    if (u === '/proj/aktuell?noten=zahl') return [200, projekt ? { slug: 'p', projekt, kern: { rev_geladen: 3, status: 0 } } : { slug: null, projekt: null, kern: null }];
    if (u === '/proj/aktuell?nur=rev') return [200, projekt ? { slug: 'p', rev: projekt.rev } : { slug: null, rev: null }];
    if (u === '/proj/aendern?antwort=kurz') return [409, { fehler: 'ki_gestoppt' }];
    if (u === '/proj/undo?antwort=kurz' || u === '/proj/redo?antwort=kurz') return [200, { rev: 5, kern: {}, noten_zahl: {} }];
    if (u === '/proj/transport') return [200, { ok: false, quittung: { status: 6, grund: 'nicht_geladen' } }];
    if (u === '/proj/neu?antwort=kurz' || u === '/proj/oeffnen?antwort=kurz') return [200, { slug: 'p', rev: 4, spuren: [], noten_zahl: {}, kern: {} }];
    if (u === '/proj/verlauf') return [200, [{ rev: 1, zeit: 1, quelle: 'cypher', label: 'x', art: 'aendern' }]];
  });
  assert.ok(!(await c.callTool({ name: 'proj_liste', arguments: {} })).isError);
  await c.callTool({ name: 'proj_neu', arguments: { name: 'P' } });
  await c.callTool({ name: 'proj_oeffnen', arguments: { slug: 'p' } });
  assert.deepEqual(gesehen.find((x) => x.pfad === '/proj/neu?antwort=kurz').koerper, { name: 'P' });
  assert.deepEqual(gesehen.find((x) => x.pfad === '/proj/oeffnen?antwort=kurz').koerper, { slug: 'p' });
  assert.equal(JSON.parse((await c.callTool({ name: 'proj_lage', arguments: {} })).content[0].text).kern.rev_geladen, 3);
  const a = await c.callTool({ name: 'proj_aendern', arguments: { label: 'Bass', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] } });
  assert.equal(a.isError, true); assert.match(a.content[0].text, /ki_gestoppt/);
  assert.deepEqual(gesehen.find((x) => x.pfad === '/proj/aendern?antwort=kurz').koerper, { label: 'Bass', befehle: [{ befehl: 'spur_neu', art: 'instrument' }], rev: 4 },
    'rev aus proj_lage');
  await c.callTool({ name: 'proj_undo', arguments: { rev: 9 } });
  assert.deepEqual(gesehen.find((x) => x.pfad === '/proj/undo?antwort=kurz').koerper, { rev: 9 }, 'angegebene rev gewinnt');
  assert.ok(!(await c.callTool({ name: 'proj_redo', arguments: {} })).isError);
  const tr = await c.callTool({ name: 'proj_transport', arguments: { aktion: 'start', beat: 8 } });
  assert.equal(tr.isError, true); assert.match(tr.content[0].text, /nicht_geladen/);
  assert.deepEqual(gesehen.find((x) => x.pfad === '/proj/transport').koerper, { aktion: 'start', beat: 8 });
  assert.ok(!(await c.callTool({ name: 'proj_verlauf', arguments: {} })).isError);
  projekt = null;
  const ohne = await c.callTool({ name: 'proj_undo', arguments: {} });
  assert.equal(ohne.isError, true); assert.match(ohne.content[0].text, /kein_projekt/);
  assert.ok(gesehen.every((x) => x.quelle === 'cypher'));
  assert.deepEqual([...new Set(gesehen.map((x) => `${x.methode} ${x.pfad}`))].sort(), ['GET /proj/aktuell?noten=zahl', 'GET /proj/aktuell?nur=rev', 'GET /proj/liste', 'GET /proj/verlauf',
    'POST /proj/aendern?antwort=kurz', 'POST /proj/neu?antwort=kurz', 'POST /proj/oeffnen?antwort=kurz', 'POST /proj/redo?antwort=kurz', 'POST /proj/transport', 'POST /proj/undo?antwort=kurz']);
});

// D1 S2-Integration Fix3 G6 (Spec 6.32): proj_neu und proj_oeffnen fragen die schmale Antwort (?antwort=kurz) und geben sie unverändert weiter;
// die Beschreibungen nennen das
test('djk-hand proj_neu/proj_oeffnen (Spec 6.32): ?antwort=kurz, Antwort slug, rev, spuren, noten_zahl, kern ohne Noten; Beschreibung nennt es', async (t) => {
  const kurz = { slug: 'p', rev: 3, spuren: [{ id: 's1', nr: 1, clips: [{ id: 'c1', noten_zahl: 10000 }] }], noten_zahl: { c1: 10000 }, kern: { wiedergabe: { nr: 2 } } };
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (/^\/proj\/(neu|oeffnen)\?antwort=kurz$/.test(u)) return [200, kurz];
    if (/^\/proj\/(neu|oeffnen)$/.test(u)) return [200, { slug: 'p', projekt: { spuren: [{ clips: [{ noten: new Array(50).fill({}) }] }] } }];
  });
  for (const [name, args] of [['proj_neu', { name: 'P' }], ['proj_oeffnen', { slug: 'p' }]]) {
    const r = await c.callTool({ name, arguments: args });
    assert.ok(!r.isError, r.content[0].text);
    assert.deepEqual(JSON.parse(r.content[0].text), kurz, name);
  }
  assert.deepEqual(gesehen.filter((x) => x.methode === 'POST').map((x) => x.pfad), ['/proj/neu?antwort=kurz', '/proj/oeffnen?antwort=kurz']);
  const tools = (await c.listTools()).tools;
  for (const name of ['proj_neu', 'proj_oeffnen']) assert.match(tools.find((x) => x.name === name).description, /noten_zahl/, name);
});

// D1 S2-Integration Fix6 T5 (Spec 6.37, Andreas F13): ich wechsle das Projekt nicht, solange Andreas' Transport läuft; der Server antwortet
// 409 transport_laeuft. Die Beschreibungen von proj_neu und proj_oeffnen nennen den Grund und dass mein eigener Lauf dabei stoppt.
test('djk-hand proj_neu/proj_oeffnen (Spec 6.37): Beschreibung nennt 409 transport_laeuft bei Andreas\' Transport', async (t) => {
  const { c } = await aufbau(t, () => [200, {}]);
  const tools = (await c.listTools()).tools;
  for (const name of ['proj_neu', 'proj_oeffnen']) {
    const d = tools.find((x) => x.name === name).description;
    assert.match(d, /409 transport_laeuft/, name);
    assert.match(d, /Andreas/, name);
    assert.match(d, /a transport I started stops/, name);
  }
});

// D1 S2-Integration Fix7 U3 (Spec 6.37, Andreas 16.10.: „Cypher stoppt nur einen Transport, den sie selbst gestartet hat“): proj_transport stopp
// über Andreas' Lauf antwortet 409 transport_laeuft. Die Beschreibung nennt das und den Grund.
test('djk-hand proj_transport (Spec 6.37): Beschreibung nennt 409 transport_laeuft und den Grund (ich stoppe nur meinen eigenen Transport)', async (t) => {
  const { c } = await aufbau(t, () => [200, {}]);
  const d = (await c.listTools()).tools.find((x) => x.name === 'proj_transport').description;
  assert.match(d, /409 transport_laeuft/);
  assert.match(d, /I stop only a transport I started/);
  assert.match(d, /Andreas/);
});

// D1 S2-Integration Fix8 V2 (Spec 6.37 Nachtrag, rr7 T_start): auch start über Andreas' Lauf antwortet 409 transport_laeuft (ein Start beendete
// seinen Lauf und gäbe mir den Transport). Die Beschreibung nennt start und den Grund.
test('djk-hand proj_transport (Spec 6.37 Nachtrag): Beschreibung nennt 409 transport_laeuft auch für start über Andreas\' Lauf', async (t) => {
  const { c } = await aufbau(t, () => [200, {}]);
  const d = (await c.listTools()).tools.find((x) => x.name === 'proj_transport').description;
  assert.match(d, /I start only while no transport Andreas started is running/);
  assert.match(d, /start and stopp are refused with 409 transport_laeuft/);
  assert.match(d, /a start would end his run/);
});

// D1 S2-Integration Fix2 F5 (Spec 6.31): proj_aendern, proj_undo und proj_redo fragen die schmale Antwort (?antwort=kurz) und geben sie unverändert
// weiter: rev, kern, noten_zahl je Clip, kein Projekt
test('djk-hand proj_aendern/undo/redo (Spec 6.31): ?antwort=kurz, Antwort mit rev, kern und noten_zahl, ohne Projekt', async (t) => {
  const kurz = { rev: 7, kern: { wiedergabe: { nr: 3, quittung: { status: 3, grund: '' } } }, noten_zahl: { c1: 10000 } };
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/proj/aktuell?nur=rev') return [200, { slug: 'p', rev: 6 }];
    if (/^\/proj\/(aendern|undo|redo)\?antwort=kurz$/.test(u)) return [200, kurz];
    if (/^\/proj\/(aendern|undo|redo)$/.test(u)) return [200, { rev: 7, projekt: { spuren: [{ clips: [{ noten: new Array(50).fill({}) }] }] } }];
  });
  for (const [name, args] of [['proj_aendern', { label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }], ['proj_undo', {}], ['proj_redo', {}]]) {
    const r = await c.callTool({ name, arguments: args });
    assert.ok(!r.isError, r.content[0].text);
    assert.deepEqual(JSON.parse(r.content[0].text), kurz, name);
  }
  assert.deepEqual(gesehen.filter((x) => x.methode === 'POST').map((x) => x.pfad), ['/proj/aendern?antwort=kurz', '/proj/undo?antwort=kurz', '/proj/redo?antwort=kurz']);
});

test('djk-hand proj_aendern beschreibt clip_neu mit loop_beats und name, Gain und Blenden mit den Grenzen aus Spec 6.17 und 6.27 (P7, P9)', async (t) => {
  const { c } = await aufbau(t, () => [200, {}]);
  const d = (await c.listTools()).tools.find((x) => x.name === 'proj_aendern').description;
  assert.match(d, /wirt \(surge, slot 1 or 2/, '1.9 U3 (was Fix2 F10, one Surge slot): two Surge slots');
  assert.doesNotMatch(d, /slot 1\|2/);
  assert.match(d, /clip_neu \{[^}]*loop_beats\? \(null or missing = off, else 1\/16\.\.laenge_beats[^}]*name\?/);
  assert.match(d, /gain_db\? \(-96\.\.24\)/);
  assert.match(d, /fade_aus_beats\? \(fades >= 0, together at most laenge_beats\)/);
  assert.match(d, /fader_db\? \(-200\.\.6\)/);
});

test('djk-hand proj_aendern names the sidechain key, duck_durch_kick and the three key reasons; proj_export names dj_schluessel (1.10 slice 5, U3)', async (t) => {
  const { c } = await aufbau(t, () => [200, {}]);
  const werkzeuge = (await c.listTools()).tools;
  const d = werkzeuge.find((x) => x.name === 'proj_aendern').description;
  assert.match(d, /key\? \(compressor only, every other sidechain source: \{quelle: spur \| grp \| ret \| deck \| erz, nr, punkt: pre \| post\}/);
  assert.match(d, /param \(one of werte, or sc on a compressor, or key on a compressor/);
  assert.match(d, /duck_durch_kick \{spur_id, kick_id, pos\?\}/);
  for (const grund of ['sidechain_spaet', 'sidechain_zyklus', 'sidechain_quelle']) assert.match(d, new RegExp(`${grund} \\(`), grund);
  assert.match(werkzeuge.find((x) => x.name === 'proj_export').description, /dj_schluessel: true only when a compressor stage is keyed by a DJ input/);
  // negative control: the text of a tool that has nothing to do with it does not carry the words
  assert.doesNotMatch(werkzeuge.find((x) => x.name === 'proj_lage').description, /sidechain_|duck_durch_kick|dj_schluessel/);
});

test('djk-hand spur (D1 S2-Integration Fix A5, Spec 6.22, 6.30): die Beschreibung nennt die Grenze spur/*, 409 ueber_projekt kommt als Werkzeugfehler mit Grund an', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/spur'
    ? [409, { fehler: 'ueber_projekt', ziel: 'spur/1/fader', index: 0, text: 'track faders are changed through the project (/proj/aendern, spur_aendern), not by an automation track' }] : null));
  const w = (await c.listTools()).tools.find((x) => x.name === 'spur');
  assert.match(w.description, /spur\/1\.\.32.*ueber_projekt.*proj_aendern/s);
  const r = await c.callTool({ name: 'spur', arguments: { name: 'f', fahrten: [{ ziel: 'spur/1/fader', ab_takt: 1, takte: 1, nach: -6 }] } });
  assert.equal(r.isError, true);
  const j = JSON.parse(r.content[0].text);
  assert.deepEqual([j.fehler, j.ziel], ['ueber_projekt', 'spur/1/fader']); assert.match(j.text, /project/);
  assert.deepEqual(gesehen.at(-1).koerper.spur.fahrten[0].ziel, 'spur/1/fader');
});

test('1.10 Slice 1: proj_aendern nennt die Gruppen-Befehle und ihre Gründe, pegel die neuen Kanäle, regler die Mixer-Pfade mit ueber_projekt', async (t) => {
  const { c } = await aufbau(t, () => null);
  const werkzeuge = (await c.listTools()).tools;
  const text = (n) => werkzeuge.find((x) => x.name === n).description;
  for (const b of ['gruppenspur_neu', 'gruppenspur_aendern', 'gruppenspur_loeschen', 'ziel_setzen', 'master_aendern']) assert.ok(text('proj_aendern').includes(b), b);
  for (const g of ['routing_zyklus', 'routing_grenze', 'ziel_unbekannt', 'gruppe_unbekannt']) assert.ok(text('proj_aendern').includes(g), g);
  assert.ok(text('pegel').includes('grp/1..8') && text('pegel').includes('pm'));
  // Prüfung 2, C3: die Grenze steht an beiden Werkzeugen, die den Server erreichen: regler (POST /regler) und spur (POST /spur, Automationsspur)
  for (const w of ['regler', 'spur']) assert.ok(text(w).includes('grp/1..8') && text(w).includes('pm/fader') && text(w).includes('ueber_projekt'), w);
  assert.match(text('spur'), /spur\/1\.\.32.*ueber_projekt.*proj_aendern/s, 'der Wortlaut aus dem Bestandstest (spur, Fix A5) bleibt');
  assert.ok(!text('proj_aendern').includes('gruppen_neu'), 'Negativ-Kontrolle: der Name kollidiert nicht mit dem Feld gruppe der Varianten');
  // die Art der Gruppe heißt im Befehl "gruppe" (nicht "group"), der Text muss den Befehlswortlaut tragen
  assert.ok(text('proj_aendern').includes('{art: "gruppe", id}'), 'Art der Gruppe im Befehlswortlaut');
  assert.ok(text('proj_aendern').includes('Solo on a track keeps its group sounding'), 'Solo-Regel (P7)');
  // N1: die I08-Beschreibung (arm, eingang) bleibt, der Text wird ergänzt, nicht ersetzt
  assert.match(text('proj_aendern'), /arm\? \(true\|false\), eingang\? \(\{art: intern/, 'N1: I08-Text bleibt');
});

// Paket S3 (Spec D1 3.5, 6.31): proj_freeze und proj_export gehen als POST mit Quelle cypher an den Seiten-Server; proj_freeze fragt die schmale
// Antwort (?antwort=kurz: rev, spur_id, freeze). 409 ki_gestoppt und 502 render_fehler sind Werkzeugfehler mit Grund und text, ein Ergebnis geht
// unverändert durch. Die Beschreibungen nennen Dauer (Echtzeit) und Gründe.
test('djk-hand proj_freeze und proj_export (Paket S3): Körper, Quelle cypher, schmale Antwort, Fehlerabbildung, Ergebnis unverändert', async (t) => {
  const ergebnis = { datei: '/p/erster-track/export/erster-track-20261015-181500.wav', frames: 384000, spitze_db: -3.1, regler_quelle: 'kern',
    lufs_i: -9.5, lra: 4.2, true_peak_dbtp: -1.1 };
  const kurz = { rev: 18, spur_id: 's3', freeze: { datei: 'freeze-3-2048.f32', frames: 96000, kennung: 2048, sha256: 'a'.repeat(64), von_beat: 8 } };
  let freezes = 0;
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/proj/freeze?antwort=kurz') return ++freezes === 1 ? [409, { fehler: 'ki_gestoppt', text: 'Stop Cypher is set' }] : [200, kurz];
    if (u === '/proj/export') return gesehen.filter((x) => x.pfad === '/proj/export').length === 1 ? [200, ergebnis]
      : [502, { fehler: 'render_fehler', text: 'the export render failed: the render ran out of memory', detail: 'Rückgabe 7' }];
  });
  const f = await c.callTool({ name: 'proj_freeze', arguments: { spur_id: 's3', an: true } });
  assert.equal(f.isError, true); assert.deepEqual(JSON.parse(f.content[0].text), { fehler: 'ki_gestoppt', text: 'Stop Cypher is set' });
  const f2 = await c.callTool({ name: 'proj_freeze', arguments: { spur_id: 's3', an: true } });
  assert.ok(!f2.isError, f2.content[0].text);
  assert.deepEqual(JSON.parse(f2.content[0].text), kurz, 'schmal: kein Projekt');
  const e1 = await c.callTool({ name: 'proj_export', arguments: {} });
  assert.ok(!e1.isError, e1.content[0].text);
  assert.deepEqual(JSON.parse(e1.content[0].text), ergebnis);
  const e2 = await c.callTool({ name: 'proj_export', arguments: { von_beat: 0, bis_beat: 32 } });
  assert.equal(e2.isError, true); assert.match(e2.content[0].text, /render_fehler/); assert.match(e2.content[0].text, /ran out of memory/);
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.quelle, x.koerper]), [
    ['POST', '/proj/freeze?antwort=kurz', 'cypher', { spur_id: 's3', an: true }],
    ['POST', '/proj/freeze?antwort=kurz', 'cypher', { spur_id: 's3', an: true }],
    ['POST', '/proj/export', 'cypher', {}],
    ['POST', '/proj/export', 'cypher', { von_beat: 0, bis_beat: 32 }],
  ]);
  const werkzeuge = (await c.listTools()).tools;
  const fz = werkzeuge.find((x) => x.name === 'proj_freeze'), ex = werkzeuge.find((x) => x.name === 'proj_export');
  assert.deepEqual(fz.inputSchema.required, ['spur_id', 'an']);
  assert.deepEqual(Object.keys(ex.inputSchema.properties).sort(), ['abgriff', 'bis_beat', 'von_beat']);   // 1.10 Slice 2: abgriff neu
  for (const g of ['real time', 'ki_gestoppt', 'transport_laeuft', 'beschaeftigt', 'spur_leer', 'freeze_fehler']) assert.ok(fz.description.includes(g), `proj_freeze nennt ${g}`);
  for (const g of ['real time', 'ki_gestoppt', 'export_bereich', 'audio_fehlt', 'render_fehler', 'regler_quelle', 'lufs_i']) assert.ok(ex.description.includes(g), `proj_export nennt ${g}`);
});

// 1.10 Slice 2 (E2, Task 21): proj_export nimmt abgriff, die Beschreibungen sagen, wo der Export abgegriffen wird und wo die Lautheit gemessen wird.
test('1.10 Slice 2: proj_export kennt abgriff (produktion | set), nennt ueber_decke und limiter_db_max und sagt nicht mehr, die Lautheit werde hinter dem Limiter gemessen', async (t) => {
  const ergebnis = { datei: '/p/x/export/x.wav', frames: 96000, spitze_db: 1.2, regler_quelle: 'kern', abgriff: 'produktion', ueber_decke: true, limiter_db_max: 2.1,
    lufs_i: -8.5, lra: 3, true_peak_dbtp: 1.4 };
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/proj/export' ? [200, ergebnis] : null));
  const werkzeuge = (await c.listTools()).tools;
  const ex = werkzeuge.find((x) => x.name === 'proj_export'), la = werkzeuge.find((x) => x.name === 'proj_lautheit').description;
  assert.deepEqual(ex.inputSchema.properties.abgriff.enum, ['produktion', 'set']);
  for (const s of ['production master', 'ueber_decke', 'limiter_db_max', 'set limiter']) assert.ok(ex.description.includes(s), s);
  assert.ok(!ex.description.includes('loudness is measured after the master limiter'));
  assert.ok(!la.includes('after the master limiter') && la.includes('production master'));
  assert.ok(!la.includes('as long as the core master is at its defaults'));
  const e1 = await c.callTool({ name: 'proj_export', arguments: { abgriff: 'set' } });
  assert.ok(!e1.isError, e1.content[0].text);
  assert.deepEqual(JSON.parse(e1.content[0].text), ergebnis, 'Ergebnis unverändert');
  await c.callTool({ name: 'proj_export', arguments: {} });
  assert.deepEqual(gesehen.filter((x) => x.pfad === '/proj/export').map((x) => x.koerper), [{ abgriff: 'set' }, {}], 'ohne Angabe wählt der Server produktion');
});

// Fix-Runde S3, R6: proj_freeze und proj_export haben ein eigenes Zeitlimit (Undici bricht fetch nach 300 s ab, ein Export kann länger dauern).
// Kurze Grenze über die Umgebung: die Seite antwortet erst nach 2,5 s, das Werkzeug meldet nach 0,3 s hand_frist mit klarer Meldung.
// Negativ-Kontrolle: mit langer Grenze kommt dieselbe späte Antwort an. Die Vorgaben liegen über der längsten Dauer, die der Server erlaubt.
test('R6: proj_freeze und proj_export mit eigenem Zeitlimit (Umgebung), klare Meldung hand_frist; lange Grenze wartet die Antwort ab', async (t) => {
  const mitSeite = async (env, ms) => {
    const s = http.createServer((q, a) => { q.resume(); q.on('end', () => setTimeout(() => {
      a.writeHead(200, { 'content-type': 'application/json' }); a.end(JSON.stringify({ datei: '/x.wav', frames: 1, rev: 3, spur_id: 's1', freeze: null }));
    }, ms)); });
    await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
    const c = new Client({ name: 'test', version: '0' });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`], env: { ...process.env, ...env } }));
    t.after(async () => { await c.close(); s.closeAllConnections?.(); s.close(); });
    return c;
  };
  const kurz = await mitSeite({ DJK_HAND_FRIST_PROJ_EXPORT_MS: '300', DJK_HAND_FRIST_PROJ_FREEZE_MS: '300', DJK_HAND_FRIST_PROJ_LAUTHEIT_MS: '300' }, 2500);
  for (const [name, args] of [['proj_export', {}], ['proj_freeze', { spur_id: 's1', an: true }], ['proj_lautheit', {}]]) {   // S3-Fix G5: auch proj_lautheit
    const t0 = Date.now();
    const r = await kurz.callTool({ name, arguments: args });
    const dauer = Date.now() - t0;
    assert.equal(r.isError, true, `${name}: ${r.content[0].text}`);
    const j = JSON.parse(r.content[0].text);
    assert.equal(j.fehler, 'hand_frist', r.content[0].text);
    assert.match(j.text, /no answer from the page server within 0\.3 s/);
    assert.match(j.text, /may still finish|still be running/);
    assert.ok(dauer < 2000, `${name}: nach der Grenze, nicht nach der Antwort (${dauer} ms)`);
  }
  const lang = await mitSeite({ DJK_HAND_FRIST_PROJ_EXPORT_MS: '10000' }, 600);
  const r = await lang.callTool({ name: 'proj_export', arguments: {} });
  assert.ok(!r.isError, r.content[0].text);
  assert.equal(JSON.parse(r.content[0].text).datei, '/x.wav');
});

test('R6: Vorgabe-Zeitlimits liegen über der längsten erlaubten Dauer (und über 300 s), die Werkzeugbeschreibung nennt sie', async (t) => {
  const { FREEZE_MAX_BEATS, FREEZE_NACHLAUF_BEATS } = await import('../../ui/project/freeze.ts');
  // längste erlaubte Dauer nach den Grenzen des Servers (areas/proj/output.ts, session.ts, loudness.ts, commands.ts TEMPO_MIN 60):
  // Rampe bis 20 s, Quittung bis 4 s, Freeze-Frist (Beats + Nachlauf + 4) bei 60 BPM + 5 s; Export: Freeze + Render 4 · 1024 s + 60 s + ffmpeg 120 s
  const freezeMs = 20_000 + 4_000 + (FREEZE_MAX_BEATS + FREEZE_NACHLAUF_BEATS + 4) * 1000 + 5_000;
  const exportMs = freezeMs + 4 * 1024 * 1000 + 60_000 + 120_000;
  const { c } = await aufbau(t, () => null);
  const werkzeuge = (await c.listTools()).tools;
  for (const [name, laengste] of [['proj_freeze', freezeMs], ['proj_export', exportMs]]) {
    const b = werkzeuge.find((x) => x.name === name).description;
    const m = /waits at most (\d+) min/.exec(b);
    assert.ok(m, `${name}: Beschreibung nennt die Grenze: ${b.slice(-300)}`);
    const ms = Number(m[1]) * 60_000;
    assert.ok(ms > laengste, `${name}: ${ms} ms über der längsten erlaubten Dauer ${laengste} ms`);
    assert.ok(ms > 300_000, `${name}: über der Undici-Grenze 300 s`);
    assert.match(b, new RegExp(`DJK_HAND_FRIST_${name.toUpperCase()}_MS`));
  }
});

// Paket 1.18, E-a: der Knopf senkt keinen Fader; die Werkzeugbeschreibung sagt es und nennt die KI-Maske nicht mehr.
test('djk-hand proj_aendern (Paket 1.18 E-a): Stop Cypher senkt keinen Fader, die alte Aussage über die Maske ist weg', async (t) => {
  const { c } = await aufbau(t, () => undefined);
  const aendern = (await c.listTools()).tools.find((x) => x.name === 'proj_aendern');
  assert.ok(aendern.description.includes('lowers no fader'));
  assert.ok(!aendern.description.includes('Stop-Cypher mask'), 'die alte Aussage über die Maske ist weg');
});

// Paket 1.18, E-a (Transport, Andreas 2026-10-20): Stop Cypher stoppt auch einen laufenden Transport nicht, den Cypher gestartet hat; ein noch wartender Start fällt (Auslegung KS-w). Die Beschreibung sagt beides.
test('djk-hand proj_transport (Paket 1.18 E-a): Stop Cypher stoppt keinen laufenden Transport, auch keinen eigenen; ein wartender Start fällt; die alte Aussage ist weg', async (t) => {
  const { c } = await aufbau(t, () => undefined);
  const transport = (await c.listTools()).tools.find((x) => x.name === 'proj_transport');
  assert.ok(transport.description.includes('Stop Cypher stops no running transport'));
  assert.ok(transport.description.includes('still waiting for its downbeat'), 'ein wartender Start fällt (KS-w)');
  assert.ok(!transport.description.includes('Stop Cypher also stops a transport I started'), 'die alte Aussage ist weg');
});

// Paket 1.18, E-c: die Beschreibung von proj_aendern nennt gruppe und variante_waehlen.
test('djk-hand proj_aendern (Paket 1.18 E-c): gruppe in spur_neu und spur_aendern, variante_waehlen mit seinem Verhalten', async (t) => {
  const { c } = await aufbau(t, () => undefined);
  const d = (await c.listTools()).tools.find((x) => x.name === 'proj_aendern').description;
  for (const g of ['gruppe?', 'variante_waehlen {gruppe, spur_id}', '(one undo step: the chosen variant plays', 'tracks outside the gruppe are untouched', 'null = leave the group']) assert.ok(d.includes(g), `nennt ${g}`);
});

// Paket 1.18, E-a, Review 9a: proj_neu und proj_oeffnen nennen die Übergabe durch Stop Cypher (danach 409 transport_laeuft, wie beim Lauf von Andreas).
test('djk-hand proj_neu/proj_oeffnen (Paket 1.18 E-a): die Beschreibung nennt den nach Stop Cypher übernommenen Transport', async (t) => {
  const { c } = await aufbau(t, () => undefined);
  const tools = (await c.listTools()).tools;
  for (const name of ['proj_neu', 'proj_oeffnen']) assert.ok(tools.find((x) => x.name === name).description.includes('took over with Stop Cypher'), name);
});

// Paket 1.18, E-b: proj_lautheit geht als POST mit Quelle cypher an /proj/lautheit, Körper nur mit den angegebenen Beats, Ergebnis unverändert,
// Fehler mit Grund und text als Werkzeugfehler. pegel nennt die Produktionsspuren.
test('djk-hand proj_lautheit (Paket 1.18 E-b): Körper, Quelle cypher, Ergebnis unverändert, Fehlerabbildung; Beschreibung von pegel', async (t) => {
  const ergebnis = { von_beat: 0, bis_beat: 32, spuren: [{ spur_id: 's1', nr: 1, name: 'Kick', lufs_i: -17.1, lra: 0.4, true_peak_dbtp: -3.2, spitze_db: -3.3, stumm: false },
    { spur_id: 's2', nr: 2, name: 'Bass', lufs_i: null, lra: null, true_peak_dbtp: null, spitze_db: -200, stumm: true }],
    summe: { lufs_i: -12.4, lra: 1.2, true_peak_dbtp: -1.0, spitze_db: -1.1, regler_quelle: 'projekt' } };
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/proj/lautheit') return gesehen.filter((x) => x.pfad === '/proj/lautheit').length === 1 ? [200, ergebnis]
      : [409, { fehler: 'wirt_fehlt', text: 'the Surge host for the production slot (arr1) is not running; start it with djk-instrumente --arr1' }];
  });
  const e1 = await c.callTool({ name: 'proj_lautheit', arguments: {} });
  assert.ok(!e1.isError, e1.content[0].text);
  assert.deepEqual(JSON.parse(e1.content[0].text), ergebnis);
  const e2 = await c.callTool({ name: 'proj_lautheit', arguments: { von_beat: 4, bis_beat: 12 } });
  assert.equal(e2.isError, true); assert.match(e2.content[0].text, /wirt_fehlt/); assert.match(e2.content[0].text, /djk-instrumente --arr1/);
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.quelle, x.koerper]), [
    ['POST', '/proj/lautheit', 'cypher', {}], ['POST', '/proj/lautheit', 'cypher', { von_beat: 4, bis_beat: 12 }]]);
  const werkzeuge = (await c.listTools()).tools;
  const la = werkzeuge.find((x) => x.name === 'proj_lautheit');
  assert.deepEqual(Object.keys(la.inputSchema.properties).sort(), ['bis_beat', 'von_beat']);
  for (const g of ['lufs_i', 'stumm', 'wirt_fehlt', 'ki_gestoppt', 'export_bereich', 'summe', 'proj_export', 'null (not -70)']) assert.ok(la.description.includes(g), `proj_lautheit nennt ${g}`);
  const pegel = werkzeuge.find((x) => x.name === 'pegel');
  for (const g of ['spur/1..32', 'proj_lautheit', 'sample peak']) assert.ok(pegel.description.includes(g), `pegel nennt ${g}`);
});

// Paket 1.18, S3-Fix G4/G5: die Beschreibungen nennen wirt_fehlt an Freeze, Export und Lautheit, das neue Feld unter_messgrenze und die Solo-Regel;
// die Frist von proj_lautheit behauptet nicht, über der längsten Laufzeit des Servers zu liegen (33 Renders zu je 4 · 1024 s + 60 s, rund 2357 min),
// sondern nennt ihre Grenze, den Override und hand_frist.
test('djk-hand (Paket 1.18 S3-Fix): wirt_fehlt bei Freeze und Export, unter_messgrenze und Solo bei proj_lautheit, ehrliche Frist von proj_lautheit', async (t) => {
  const { c } = await aufbau(t, () => null);
  const werkzeuge = (await c.listTools()).tools;
  const text = (n) => werkzeuge.find((x) => x.name === n).description;
  for (const n of ['proj_freeze', 'proj_export', 'proj_lautheit']) assert.match(text(n), /Refused:[^]*wirt_fehlt/, `${n}: wirt_fehlt steht in der Liste der Ablehnungen`);
  const la = text('proj_lautheit');
  assert.match(la, /unter_messgrenze/); assert.match(la, /[Ss]olo/);
  // Negativ-Kontrolle: die zwei Werkzeuge mit der berechneten Frist behalten ihren Satz
  for (const n of ['proj_freeze', 'proj_export']) assert.match(text(n), /above the longest run the server allows/);
  assert.doesNotMatch(la, /above the longest run the server allows/, 'für proj_lautheit stimmt der Satz nicht');
  assert.match(la, /waits at most 80 min \(tool limit, DJK_HAND_FRIST_PROJ_LAUTHEIT_MS;/);
  assert.match(la, /hand_frist/); assert.match(la, /about 39\.3 h/);
  // die Rechnung hinter der Zahl: Freeze (≈ 291 s) + 33 Renders zu 4 · 1024 s + 60 s + 33 ffmpeg-Messungen zu 120 s
  const grenzfallMin = (291 + 33 * (4 * 1024 + 60) + 33 * 120) / 60;
  assert.ok(grenzfallMin > 2350 && grenzfallMin < 2365, `Grenzfall ${grenzfallMin} min`);
});

// 1.9 T3.5 (L10): two Surge production hosts. The descriptions of freeze, export and loudness name both hosts and the new refusal wirt_fehler; proj_aendern
// names the two Surge slots; proj_lage describes wirte. Negative control: the old single-slot wording is gone.
test('djk-hand (1.9 U3): arr1 and arr2 and wirt_fehler in proj_freeze, proj_export, proj_lautheit; two slots in proj_aendern; wirte in proj_lage', async (t) => {
  const { c } = await aufbau(t, () => null);
  const werkzeuge = (await c.listTools()).tools;
  const text = (n) => werkzeuge.find((x) => x.name === n).description;
  for (const n of ['proj_freeze', 'proj_export', 'proj_lautheit']) {
    assert.match(text(n), /djk-instrumente --arr1/, `${n}: arr1`);
    assert.match(text(n), /--arr2/, `${n}: arr2`);
    assert.match(text(n), /wirt_fehler/, `${n}: wirt_fehler`);
    assert.doesNotMatch(text(n), /the production host arr1 is not running/, `${n}: the single-host wording is gone`);
  }
  assert.match(text('proj_aendern'), /wirt \(surge, slot 1 or 2/);
  assert.doesNotMatch(text('proj_aendern'), /wirt \(surge, slot 1\)/);
  assert.match(text('proj_lage'), /wirte \{1: \{laeuft/);
  // negative control: a tool this unit did not touch does not mention the hosts
  assert.doesNotMatch(text('proj_transport'), /arr2|wirt_fehler/);
});

// I08 Task 10: geraete_lage ist rein lesend (Zuordnen und Freigeben sind nach F3 Andreas' Sache).
test('geraete_lage liest GET /geraete und gibt die Antwort wörtlich zurück', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (m === 'GET' && u === '/geraete' ? [200, { erkennung: 'ok', eingaenge: [{ k: 1, frei_fuer_cypher: false }] }] : null));
  const r = JSON.parse((await c.callTool({ name: 'geraete_lage', arguments: {} })).content[0].text);
  assert.deepEqual(r.eingaenge, [{ k: 1, frei_fuer_cypher: false }]);
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad]), [['GET', '/geraete']]);
});

// 1.8 Task 28: proj_aufnahme (Start und Stopp der Aufnahme auf armierte Audio-Spuren) geht als POST /proj/aufnahme mit der Quelle cypher.
test('proj_aufnahme: start und stopp gehen als POST /proj/aufnahme mit der Quelle cypher; ohne Aktion 400 im Werkzeug', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (m === 'POST' && u === '/proj/aufnahme' ? [200, { aufnahme: 'laeuft', kennung: 5 }] : null));
  const r1 = JSON.parse((await c.callTool({ name: 'proj_aufnahme', arguments: { aktion: 'start', von_beat: 4 } })).content[0].text);
  assert.equal(r1.kennung, 5);
  await c.callTool({ name: 'proj_aufnahme', arguments: { aktion: 'stopp' } });
  assert.deepEqual(gesehen.map((g) => [g.methode, g.pfad, g.quelle, g.koerper]), [
    ['POST', '/proj/aufnahme', 'cypher', { aktion: 'start', von_beat: 4 }],
    ['POST', '/proj/aufnahme', 'cypher', { aktion: 'stopp' }]]);
  const falsch = await c.callTool({ name: 'proj_aufnahme', arguments: { aktion: 'spulen' } });
  assert.ok(falsch.isError, 'das Schema lehnt eine unbekannte Aktion ab');
  assert.equal(gesehen.length, 2, 'und schickt nichts');
});

// Paket 1.13 Warp: proj_warp geht als GET an /proj/warp, die Query trägt nur die angegebenen Felder, Quelle cypher, Ergebnis unverändert, Fehler mit Grund
// als Werkzeugfehler; die Beschreibungen nennen die Warp-Felder und die neuen Befehle von proj_aendern.
test('djk-hand proj_warp (Paket 1.13): GET mit Query, Quelle cypher, Ergebnis unverändert, Fehlerabbildung; proj_aendern nennt die Warp-Befehle', async (t) => {
  const lage = { clip_id: 'c1', start_beat: 4, laenge_beats: 8, warp: { an: true, modus: 'repitch', quelle: 'takte', eins_unsicher: false, transpose_st: 0, detune_ct: 0,
    versatz_beats: 0, marker_zahl: 2, marker: [{ quell_s: 0, beat: 0, projekt_beat: 4, segment_bpm: 125 }, { quell_s: 3.84, beat: 8, projekt_beat: 12, segment_bpm: null }] },
    bei: { projekt_beat: 6, quell_s: 0.96 } };
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u?.startsWith('/proj/warp?clip_id=c1')) return [200, lage];
    if (u?.startsWith('/proj/warp')) return [404, { fehler: 'clip_unbekannt', text: 'that clip does not exist' }];
  });
  const a = await c.callTool({ name: 'proj_warp', arguments: { clip_id: 'c1', bei_beat: 6 } });
  assert.ok(!a.isError, a.content[0].text);
  assert.deepEqual(JSON.parse(a.content[0].text), lage);
  const b = await c.callTool({ name: 'proj_warp', arguments: { clip_id: 'c9' } });
  assert.equal(b.isError, true); assert.match(b.content[0].text, /clip_unbekannt/);
  const e = await c.callTool({ name: 'proj_warp', arguments: { clip_id: 'c1', von_beat: 4, bis_beat: 12 } });
  assert.ok(!e.isError, e.content[0].text);
  const f = await c.callTool({ name: 'proj_warp', arguments: { clip_id: 'c1', von_beat: 4, marker_max: 7 } });
  assert.ok(!f.isError, f.content[0].text);
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.quelle]), [
    ['GET', '/proj/warp?clip_id=c1&bei_beat=6', 'cypher'], ['GET', '/proj/warp?clip_id=c9', 'cypher'], ['GET', '/proj/warp?clip_id=c1&von_beat=4&bis_beat=12', 'cypher'],
    ['GET', '/proj/warp?clip_id=c1&von_beat=4&marker_max=7', 'cypher']]);
  const werkzeuge = (await c.listTools()).tools;
  const pw = werkzeuge.find((x) => x.name === 'proj_warp');
  assert.deepEqual(pw.inputSchema.required, ['clip_id']);
  assert.deepEqual(Object.keys(pw.inputSchema.properties).sort(), ['bei_beat', 'bis_beat', 'clip_id', 'marker_max', 'transienten_max', 'von_beat']);
  for (const g of ['segment_bpm', 'quell_s', 'eins_unsicher', 'projekt_beat', 'warp_setzen', 'clip_unbekannt',
    'marker_max', 'marker_gezeigt', 'weiter_ab_projekt_beat', 'erster_marker', 'mittel_bpm', 'transienten_zahl', 'transienten_gezeigt', 'transienten_max', 'audio not decoded yet']) assert.ok(pw.description.includes(g), `proj_warp nennt ${g}`);
  const pa = werkzeuge.find((x) => x.name === 'proj_aendern').description;
  for (const g of ['warp_setzen', 'warp_auto', 'versatz_beats', 'kein_tempo', 'transpose_repitch', 'offset_bei_warp', 'warp_marker', 'hinweise',
    'analyse_angefordert', 'analyse_laeuft', 'karte_unbrauchbar', 'best source']) assert.ok(pa.includes(g), `proj_aendern nennt ${g}`);
  for (const g of ['audio_quantisieren', 'transienten_fehlen', 'keine_transienten', 'quantisieren_konflikt', 'warp_tempo', 'warp_marker', 'warp_ab_hier', 'eins_hier', 'tempo_vom_clip', 'marker_unbekannt', 'eins_gemeldet', 'eins_nur_hier', 'eins_rueckweg_fehler',
    'neu_quell_s', 'neu_beat', 'CLIP beats']) assert.ok(pa.includes(g), `proj_aendern nennt ${g} (Slice 3b)`);
  for (const g of ['transpose_st', 'detune_ct', 'whole semitones', 'cents', 'transpose_repitch', 'repitch']) assert.ok(pa.includes(g), `proj_aendern nennt ${g}`);
  for (const g of ['repitch | beats | complex | tones', 'beats {raster: transienten | 1/4 | 1/8 | 1/16 | 1/32, loop: aus | vor | vor_zurueck, huelle: 0..100}', 'default transienten/vor/100']) assert.ok(pa.includes(g), `proj_aendern nennt ${g} (Slice 4)`);
  assert.ok(pw.description.includes('beats {raster, loop, huelle} in the answer when it is set (absent = default transienten/vor/100)'), 'proj_warp: beats nur wenn gesetzt, sonst Vorgabe');
  assert.ok(pw.description.includes('beats: drum slices on their beat'), 'proj_warp erklärt den Modus beats');
  const pl = werkzeuge.find((x) => x.name === 'proj_lage').description;
  assert.ok(pl.includes('modus (repitch | beats | complex | tones)') && pl.includes('beats? (only when set: {raster, loop, huelle}; absent = default transienten/vor/100)'), 'proj_lage meldet modus beats und das optionale beats');
  assert.equal(pa.includes('transpose_spaeter'), false, 'transpose_spaeter gibt es nicht mehr');
  assert.equal(pa.includes('must stay 0'), false);
  assert.ok(pa.includes('-12 to 24'), 'der Bereich steht im Werkzeugtext');
  assert.ok(pw.description.includes('2^(transpose_st/12 + detune_ct/1200)'), 'proj_warp nennt den Faktor');
  assert.ok(werkzeuge.find((x) => x.name === 'proj_lage').description.includes('marker_zahl'), 'proj_lage nennt marker_zahl');
  assert.ok(werkzeuge.find((x) => x.name === 'proj_lage').description.includes('analyse'), 'proj_lage nennt analyse');
});

test('djk-hand: ein Fehler trägt detail durch (der Feldhinweis von audio_quantisieren, Review T6 m2); ohne detail fehlt das Feld', async (t) => {
  const { c } = await aufbau(t, (m, u) => {
    if (u === '/deck/start') return [400, { fehler: 'argument_ungueltig', text: 'a value in the request is not allowed', detail: 'raster: 1/4 | 1/8 | 1/16 | 1/32' }];
    if (u === '/deck/loop') return [409, { fehler: 'ziel_ungehoert', text: 'deck is open' }];
  });
  const a = await c.callTool({ name: 'deck_start', arguments: { deck: 2 } });
  assert.equal(a.isError, true);
  assert.equal(JSON.parse(a.content[0].text).detail, 'raster: 1/4 | 1/8 | 1/16 | 1/32');
  const b = await c.callTool({ name: 'loop', arguments: { deck: 1, beats: 4 } });
  assert.equal(b.isError, true);
  assert.equal('detail' in JSON.parse(b.content[0].text), false, 'Negativ-Kontrolle: ohne detail kein Feld');
});

test('S6: proj_stems startet, fragt /proj/aktuell?noten=zahl ab bis zum Ende; Frist → laeuft mit auftrag_id, ohne Abbruch', async (t) => {
  let abfragen = 0, ende = 3;
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (m === 'POST' && u === '/proj/stems') return [200, { auftrag_id: 7, frames: 48000 }];
    if (m === 'POST' && u === '/proj/stems/abbrechen') return [200, { auftrag_id: 7, zustand: 'abbrechen' }];
    if (m === 'GET' && u === '/proj/aktuell?noten=zahl') {
      abfragen++;
      const zustand = abfragen >= ende ? 'fertig' : 'laeuft';
      return [200, { slug: 'x', projekt: { rev: 3 }, stems: { auftrag_id: 7, zustand, stufe: 'trennen', prozent: 50, spuren: ['s5', 's6', 's7', 's8'] } }];
    }
  }, { DJK_HAND_FRIST_PROJ_STEMS_MS: '400' });
  const r = await c.callTool({ name: 'proj_stems', arguments: { clip_id: 'c1', von_beat: 0, bis_beat: 8 } });
  assert.ok(!r.isError, r.content[0].text);
  const j = JSON.parse(r.content[0].text);
  assert.deepEqual([j.auftrag_id, j.zustand], [7, 'fertig']);
  assert.deepEqual(gesehen.find((g) => g.pfad === '/proj/stems').koerper, { clip_id: 'c1', von_beat: 0, bis_beat: 8 });
  ende = 1e9;                                                                 // läuft nie zu Ende: nach der Frist laeuft
  const l = JSON.parse((await c.callTool({ name: 'proj_stems', arguments: { clip_id: 'c1' } })).content[0].text);
  assert.deepEqual([l.zustand, l.auftrag_id], ['laeuft', 7]);
  assert.match(l.text, /still running/);
  assert.equal(gesehen.filter((g) => g.pfad === '/proj/stems/abbrechen').length, 0, 'kein Abbruch bei Frist');
  const a = await c.callTool({ name: 'proj_stems_abbrechen', arguments: { auftrag_id: 7 } });
  assert.equal(JSON.parse(a.content[0].text).zustand, 'abbrechen');
  assert.deepEqual(gesehen.find((g) => g.pfad === '/proj/stems/abbrechen').koerper, { auftrag_id: 7 });
});

test('S6: proj_stems reicht Ablehnungen als Werkzeugfehler durch (stems_loop)', async (t) => {
  const ablehnung = [409, { fehler: 'stems_loop', text: 'looped clip' }];
  const { c } = await aufbau(t, (m, u) => (u === '/proj/stems' ? ablehnung : undefined));
  const r = await c.callTool({ name: 'proj_stems', arguments: { clip_id: 'c1' } });
  assert.equal(r.isError, true);
  assert.equal(JSON.parse(r.content[0].text).fehler, 'stems_loop');
});

test('S6: Beschreibungen nennen die Gründe und das Feld stumm (Pin)', async (t) => {
  const { c } = await aufbau(t, () => undefined);
  const T = Object.fromEntries((await c.listTools()).tools.map((x) => [x.name, x.description]));
  for (const g of ['keine_gpu', 'nur_andreas_spur', 'ki_gestoppt', 'stems_loop']) assert.match(T.proj_stems, new RegExp(g), g);
  assert.match(T.proj_aendern, /clip_aendern \{[^}]*stumm\?/, 'clip_aendern nennt stumm');
  assert.match(T.proj_lage, /stems/, 'proj_lage nennt das Feld stems');
});

// Nachbesserung T9: Enden, fremde Läufe, fehlendes stems, Abfragefehler; Attrappe mit frei wählbarem Stand.
const stemsAufbau = (t, stand, env = {}) => aufbau(t, (m, u) => {
  if (m === 'POST' && u === '/proj/stems') return [200, { auftrag_id: 7, frames: 48000 }];
  if (m === 'GET' && u === '/proj/aktuell?noten=zahl') return stand();
}, { DJK_HAND_FRIST_PROJ_STEMS_MS: '5000', DJK_HAND_STEMS_FEHLT_MS: '150', ...env });
const stemsRuf = async (c, args = { clip_id: 'c1' }) => { const t0 = Date.now(); const r = await c.callTool({ name: 'proj_stems', arguments: args }); return { ms: Date.now() - t0, r, j: JSON.parse(r.content[0].text) }; };

for (const [zustand, grund, text] of [['abgebrochen', 'abbruch', 'the stem separation was cancelled'], ['fehler', 'stems_fehler', 'the stem separation failed'],
  ['veraltet', 'veraltet', 'the clip changed while separating']]) {
  test(`S6 T9: Ende ${zustand} beendet sofort, mit grund und text`, async (t) => {
    const { c } = await stemsAufbau(t, () => [200, { slug: 'x', stems: { auftrag_id: 7, zustand, grund, text, detail: 'd' } }]);
    const x = await stemsRuf(c);
    assert.ok(!x.r.isError); assert.deepEqual([x.j.zustand, x.j.grund, x.j.text], [zustand, grund, text]);
    assert.ok(x.ms < 3000, `wartete ${x.ms} ms`);
  });
}

test('S6 T9: Stand eines fremden Laufs (andere auftrag_id) ist nicht das Ende des eigenen; nach der Frist ohne fremde Felder', async (t) => {
  const { c } = await stemsAufbau(t, () => [200, { slug: 'x', stems: { auftrag_id: 8, zustand: 'fertig', clip_id: 'cFremd', spuren: ['s9'], prozent: 100 } }],
    { DJK_HAND_FRIST_PROJ_STEMS_MS: '400', DJK_HAND_STEMS_FEHLT_MS: '100000' });
  const x = await stemsRuf(c);
  assert.deepEqual([x.j.zustand, x.j.auftrag_id], ['laeuft', 7]);
  assert.equal(x.j.clip_id, undefined); assert.equal(x.j.spuren, undefined); assert.equal(x.j.prozent, undefined);
});

test('S6 T9: Eigener Stand laeuft: Frist-Antwort behält die eigenen Felder', async (t) => {
  const { c } = await stemsAufbau(t, () => [200, { stems: { auftrag_id: 7, zustand: 'laeuft', stufe: 'trennen', prozent: 40 } }], { DJK_HAND_FRIST_PROJ_STEMS_MS: '300' });
  const x = await stemsRuf(c);
  assert.deepEqual([x.j.zustand, x.j.prozent, x.j.stufe], ['laeuft', 40, 'trennen']);
});

test('S6 T9: fehlt stems (Projektwechsel), endet das Werkzeug vor der Frist mit unbekannt', async (t) => {
  let n = 0;
  const { c } = await stemsAufbau(t, () => (++n === 1 ? [200, { stems: { auftrag_id: 7, zustand: 'laeuft' } }] : [200, { slug: null }]),
    { DJK_HAND_FRIST_PROJ_STEMS_MS: '20000' });
  const x = await stemsRuf(c);
  assert.deepEqual([x.j.zustand, x.j.auftrag_id], ['unbekannt', 7]);
  assert.match(x.j.text, /project changed or closed, the run was cancelled or its result is not visible here; check proj_lage/);
  assert.ok(x.ms < 8000, `wartete ${x.ms} ms`); assert.ok(n >= 3, `Abfragen ${n}`);
});

test('S6 T9: flüchtiges Fehlen (eine Abfrage) wird toleriert', async (t) => {
  let n = 0;
  const { c } = await stemsAufbau(t, () => { n++; return [200, n === 2 ? { slug: 'x' } : { stems: { auftrag_id: 7, zustand: n < 4 ? 'laeuft' : 'fertig', spuren: ['s2'] } }]; },
    { DJK_HAND_STEMS_FEHLT_MS: '2000' });
  const x = await stemsRuf(c);
  assert.equal(x.j.zustand, 'fertig');
});

test('S6 T9: Abfrage 409 beendet sofort mit unbekannt und detail', async (t) => {
  const { c } = await stemsAufbau(t, () => [409, { fehler: 'kein_projekt', text: 'open or create a project first' }], { DJK_HAND_FRIST_PROJ_STEMS_MS: '20000' });
  const x = await stemsRuf(c);
  assert.ok(!x.r.isError); assert.deepEqual([x.j.zustand, x.j.auftrag_id], ['unbekannt', 7]);
  assert.match(x.j.detail, /409.*kein_projekt.*open or create a project first/);
  assert.ok(x.ms < 3000, `wartete ${x.ms} ms`);
});

test('S6 T9: Start: spur_id und geraet gehen an den Server; detail der Ablehnung kommt mit; Frist 20 min und geraet stehen in der Beschreibung', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/proj/stems' ? [400, { fehler: 'argument_ungueltig', text: 'bad', detail: "geraet: 'cpu' or 'gpu'" }] : undefined));
  const r = await c.callTool({ name: 'proj_stems', arguments: { spur_id: 's2', geraet: 'gpu', von_beat: 1 } });
  assert.equal(r.isError, true);
  assert.equal(JSON.parse(r.content[0].text).detail, "geraet: 'cpu' or 'gpu'");
  assert.deepEqual(gesehen.find((g) => g.pfad === '/proj/stems').koerper, { spur_id: 's2', von_beat: 1, geraet: 'gpu' });
  const T = (await c.listTools()).tools.find((x) => x.name === 'proj_stems');
  assert.match(T.description, /up to 20 min \(DJK_HAND_FRIST_PROJ_STEMS_MS\)/);
  assert.match(T.description, /unbekannt/);
  assert.deepEqual(T.inputSchema.properties.geraet.enum, ['cpu', 'gpu']);
});

// Slice 7: proj_zusammenfuehren posts the three fields with source cypher to /proj/zusammenfuehren?antwort=kurz,
// passes the answer on unchanged and maps a refusal to a tool error.
test('djk-hand proj_zusammenfuehren (slice 7): body, source, answer, refusal, required fields', async (t) => {
  const ergebnis = { rev: 12, spur_id: 's7', datei: '/p/x/merge/merge-ab12.wav', frames: 96000, hinweis: null, quellen: ['s2', 's3'] };
  const refusal = { fehler: 'merge_teil_solo', text: 'only some of the chosen tracks are on solo; nothing was changed' };
  const { c, gesehen } = await aufbau(t, (m, u) => (u.startsWith('/proj/zusammenfuehren') ? (gesehen.length === 1 ? [200, ergebnis] : [409, refusal]) : null));
  const e1 = await c.callTool({ name: 'proj_zusammenfuehren', arguments: { spur_ids: ['s2', 's3'], von_beat: 0, bis_beat: 8 } });
  assert.ok(!e1.isError, e1.content[0].text);
  assert.deepEqual(JSON.parse(e1.content[0].text), ergebnis);
  const e2 = await c.callTool({ name: 'proj_zusammenfuehren', arguments: { spur_ids: ['s2', 's3'], von_beat: 0, bis_beat: 8 } });
  assert.equal(e2.isError, true); assert.match(e2.content[0].text, /merge_teil_solo/);
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.quelle, x.koerper]), [
    ['POST', '/proj/zusammenfuehren?antwort=kurz', 'cypher', { spur_ids: ['s2', 's3'], von_beat: 0, bis_beat: 8 }],
    ['POST', '/proj/zusammenfuehren?antwort=kurz', 'cypher', { spur_ids: ['s2', 's3'], von_beat: 0, bis_beat: 8 }]]);
  const w = (await c.listTools()).tools.find((x) => x.name === 'proj_zusammenfuehren');
  assert.deepEqual([...w.inputSchema.required].sort(), ['bis_beat', 'spur_ids', 'von_beat']);
  const names = ['merge_leer', 'merge_gruppen', 'merge_teil_solo', 'merge_freeze_noetig', 'merge_andreas_spur', 'merge_keine_spur_frei'];
  for (const g of [...names, 'ONE project change', 'One undo', '+3.01 dB', 'hand_frist']) {
    assert.ok(w.description.includes(g), `proj_zusammenfuehren names ${g}`);
  }
});

// Automation Slice 1: proj_auto goes out as GET /proj/auto, the query carries only the given fields, source cypher, result unchanged, errors with reason
// as tool errors; the descriptions name units, ranges and the proj_aendern commands; the tool count rises by exactly one against the base.
test('djk-hand proj_auto (Automation Slice 1): GET with query, source cypher, result unchanged, error mapping; proj_aendern names auto_*', async (t) => {
  const lage = { lane_id: 'a1', spur_id: 's1', ziel: 'fader', punkte_zahl: 2, punkte_gezeigt: 2,
    punkte: [{ beat: 4, wert: 0, form: 'linear' }, { beat: 20, wert: -30, form: 'linear' }], bei: { beat: 12, wert: -15 } };
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u?.startsWith('/proj/auto?lane_id=a1')) return [200, lage];
    if (u?.startsWith('/proj/auto')) return [404, { fehler: 'lane_unbekannt', text: 'that automation lane does not exist' }];
  });
  const a = await c.callTool({ name: 'proj_auto', arguments: { lane_id: 'a1', bei_beat: 12 } });
  assert.ok(!a.isError, a.content[0].text);
  assert.deepEqual(JSON.parse(a.content[0].text), lage);
  const b = await c.callTool({ name: 'proj_auto', arguments: { lane_id: 'a9' } });
  assert.equal(b.isError, true); assert.match(b.content[0].text, /lane_unbekannt/);
  const e = await c.callTool({ name: 'proj_auto', arguments: { lane_id: 'a1', von_beat: 4, bis_beat: 12, punkte_max: 7 } });
  assert.ok(!e.isError, e.content[0].text);
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.quelle]), [
    ['GET', '/proj/auto?lane_id=a1&bei_beat=12', 'cypher'], ['GET', '/proj/auto?lane_id=a9', 'cypher'],
    ['GET', '/proj/auto?lane_id=a1&von_beat=4&bis_beat=12&punkte_max=7', 'cypher']]);
  const werkzeuge = (await c.listTools()).tools;
  const pa = werkzeuge.find((x) => x.name === 'proj_auto');
  assert.deepEqual(pa.inputSchema.required ?? [], []);
  for (const wort of ['dB', 'project beat', '-200 = off', 'punkte_max', 'lane_unbekannt', 'auto_punkte']) {
    assert.ok(pa.description.includes(wort), `proj_auto nennt ${wort}`);
  }
  const pae = werkzeuge.find((x) => x.name === 'proj_aendern');
  for (const wort of ['auto_neu {spur_id', 'auto_punkte {lane_id', 'auto_loeschen {lane_id', 'loesche_von', 'lane_doppelt', 'punkte_ungueltig']) {
    assert.ok(pae.description.includes(wort), `proj_aendern nennt ${wort}`);
  }
  assert.ok(werkzeuge.find((x) => x.name === 'proj_lage').description.includes('lanes [{id, ziel, punkte_zahl, gesperrt?'));
  assert.ok(werkzeuge.find((x) => x.name === 'spur').description.includes('is a lane, not a spur'));
  // count: base (57 tools, 17 of them proj_*) plus one
  assert.equal(werkzeuge.length, 57 + 1 + 2 /* S12: graphen, graph */ + 1 /* S17: proj_bk */ + 1 /* S15: proj_strom_aufnehmen */ + 1 /* Automation Slice 3: proj_auto_zustand */ + 1 /* 1.14 T9: take_vorhoeren */ + 1 /* 1.15 A9: spektrum */ + 1 /* 1.14 slice 4: proj_bounce */ + 6 /* 1.16 rest U5: presets and collections */ + 1 /* demo overlay: ansage */ + 1 /* 1.9 T2.5: proj_kits */ + 1 /* 1.10 T1: proj_routing */ + 1 /* 1.10 T6: proj_resample */ + 1 /* 1.11 T8: plugins */ + 1 /* MIDI import: proj_midi_import */ + 1 /* strudel-clip: proj_muster */);
  assert.equal(werkzeuge.filter((x) => x.name.startsWith('proj_')).length, 17 + 1 + 1 + 1 + 1 + 1 /* 1.14 slice 4: proj_bounce */ + 1 /* 1.9 T2.5: proj_kits */ + 1 /* 1.10 T1: proj_routing */ + 1 /* 1.10 T6: proj_resample */ + 1 /* MIDI import: proj_midi_import */ + 1 /* strudel-clip: proj_muster */);
});

// Automation Slice 2 (task 7): the hand MCP forwards the new targets and the lock unchanged, shows ziel/gesperrt/bei of a pan lane, and a locked lane is a tool error with its reason.
test('djk-hand proj_aendern/proj_auto (Automation Slice 2): auto_neu pan and auto_aendern gesperrt go out as sent; proj_auto shows ziel, gesperrt, bei; lane_gesperrt is a tool error; descriptions name targets and ranges; 60 tools', async (t) => {
  const panLage = { lane_id: 'a2', spur_id: 's1', ziel: 'pan', gesperrt: true, punkte_zahl: 2, punkte_gezeigt: 2,
    punkte: [{ beat: 0, wert: -1, form: 'linear' }, { beat: 8, wert: 1, form: 'linear' }], bei: { beat: 4, wert: 0 } };
  const faderLage = { lane_id: 'a1', spur_id: 's1', ziel: 'fader', punkte_zahl: 1, punkte_gezeigt: 1, punkte: [{ beat: 0, wert: -6, form: 'linear' }] };
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/proj/aktuell?nur=rev') return [200, { slug: 'p', rev: 7 }];
    if (u?.startsWith('/proj/auto?lane_id=a2')) return [200, panLage];
    if (u?.startsWith('/proj/auto?lane_id=a1')) return [200, faderLage];
    if (u === '/proj/aendern?antwort=kurz') return [200, { rev: 8, kern: {}, noten_zahl: {} }];
    return null;
  });
  // auto_neu pan and auto_aendern gesperrt: the body is exactly what was sent (plus the rev from the project)
  const n = await c.callTool({ name: 'proj_aendern', arguments: { label: 'pan lane', befehle: [{ befehl: 'auto_neu', spur_id: 's1', ziel: 'pan' }] } });
  assert.ok(!n.isError, n.content[0].text);
  const g = await c.callTool({ name: 'proj_aendern', arguments: { label: 'lock', rev: 8, befehle: [{ befehl: 'auto_aendern', lane_id: 'a2', gesperrt: true }] } });
  assert.ok(!g.isError, g.content[0].text);
  assert.deepEqual(gesehen.filter((x) => x.pfad === '/proj/aendern?antwort=kurz').map((x) => x.koerper), [
    { label: 'pan lane', befehle: [{ befehl: 'auto_neu', spur_id: 's1', ziel: 'pan' }], rev: 7 },
    { label: 'lock', befehle: [{ befehl: 'auto_aendern', lane_id: 'a2', gesperrt: true }], rev: 8 }]);
  // proj_auto shows ziel, gesperrt and bei of a pan lane unchanged
  const p = JSON.parse((await c.callTool({ name: 'proj_auto', arguments: { lane_id: 'a2', bei_beat: 4 } })).content[0].text);
  assert.deepEqual([p.ziel, p.gesperrt, p.bei], ['pan', true, { beat: 4, wert: 0 }]);
  assert.equal('bei_beat' in p, false, 'the answer key is bei, not bei_beat');
  // negative control: the fader lane behaves as before (no gesperrt key appears)
  const f = JSON.parse((await c.callTool({ name: 'proj_auto', arguments: { lane_id: 'a1' } })).content[0].text);
  assert.deepEqual(f, faderLage); assert.equal('gesperrt' in f, false);
  assert.deepEqual(gesehen.filter((x) => x.pfad.startsWith('/proj/auto')).map((x) => x.pfad), ['/proj/auto?lane_id=a2&bei_beat=4', '/proj/auto?lane_id=a1']);
  // descriptions: targets and ranges instead of "dB" for every lane
  const werkzeuge = (await c.listTools()).tools;
  const pa = werkzeuge.find((x) => x.name === 'proj_auto').description;
  const pae = werkzeuge.find((x) => x.name === 'proj_aendern').description;
  for (const wort of ['fader', 'pan', 'mute', 'solo', 'geraet.lautstaerke', 'geraet.cutoff', 'geraet.resonanz', 'geraet.env_mod', 'gesperrt', 'ziel']) {
    assert.ok(pa.includes(wort), `proj_auto names ${wort}`);
  }
  for (const wort of ['auto_aendern {lane_id', 'gesperrt', 'lane_gesperrt', 'geraet_lanes', 'ziel_unbekannt', 'geraet.cutoff', '-1..1', 'mute and solo', 'sprung']) {
    assert.ok(pae.includes(wort), `proj_aendern names ${wort}`);
  }
  assert.ok(!pa.includes('wert (dB, -200 = off, max 6)'), 'proj_auto no longer calls every value dB');
  assert.ok(!pa.includes('ziel (fader)') && !pa.includes('(dB)'), 'proj_auto: no fader-only wording');
  assert.ok(!pae.includes('auto_neu {spur_id, ziel: "fader"}'), 'proj_aendern: auto_neu is no longer fader-only');
  assert.ok(werkzeuge.find((x) => x.name === 'proj_auto').inputSchema.properties.bei_beat.description.includes('lane value'));
  assert.ok(!werkzeuge.find((x) => x.name === 'proj_auto').inputSchema.properties.bei_beat.description.includes('(dB)'));
  assert.ok(werkzeuge.find((x) => x.name === 'proj_zusammenfuehren').description.includes('lanes_verworfen'));
  assert.equal(werkzeuge.length, 66 + 6 + 1 + 1 + 1 + 1 + 1 + 1 /* MIDI import: proj_midi_import */ + 1 /* strudel-clip: proj_muster */);   // + proj_resample (1.10 T6); + proj_routing (1.10 T1); + proj_kits (1.9 T2.5); + ansage (demo overlay); 62 + proj_auto_zustand (Automation Slice 3) + spektrum (1.15 A9) + take_vorhoeren (1.14 T9) + proj_bounce (1.14 slice 4) + 6 presets and collections tools (1.16 rest U5)
});

test('djk-hand proj_aendern (Automation Slice 2): a locked lane answers lane_gesperrt as a tool error with the reason; negative control: an unlocked change succeeds', async (t) => {
  const { c } = await aufbau(t, (m, u) => {
    if (u === '/proj/aktuell?nur=rev') return [200, { slug: 'p', rev: 3 }];
    if (u === '/proj/aendern?antwort=kurz') return [409, { fehler: 'lane_gesperrt', text: 'that automation lane is locked: unlock it with auto_aendern first', detail: 'a2', index: 0 }];
    return null;
  });
  const r = await c.callTool({ name: 'proj_aendern', arguments: { label: 'edit', befehle: [{ befehl: 'auto_punkte', lane_id: 'a2', setze: [{ beat: 0, wert: 0 }] }] } });
  assert.equal(r.isError, true);
  const j = JSON.parse(r.content[0].text);
  assert.equal(j.fehler, 'lane_gesperrt'); assert.match(j.text, /auto_aendern/);
  const ok = await aufbau(t, (m, u) => (u === '/proj/aktuell?nur=rev' ? [200, { slug: 'p', rev: 3 }] : u === '/proj/aendern?antwort=kurz' ? [200, { rev: 4, kern: {}, noten_zahl: {} }] : null));
  const r2 = await ok.c.callTool({ name: 'proj_aendern', arguments: { label: 'edit', befehle: [{ befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 0, wert: 0 }] }] } });
  assert.ok(!r2.isError, r2.content[0].text);
});

test('djk-hand proj_zusammenfuehren (Automation Slice 2): lanes_verworfen from the server reaches the caller unchanged', async (t) => {
  const { c } = await aufbau(t, (m, u) => (u === '/proj/zusammenfuehren?antwort=kurz'
    ? [200, { rev: 9, spur_id: 's9', datei: 'merge/merge-1.wav', frames: 1, hinweis: 'x', quellen: ['s2', 's3'], lanes_verworfen: 2 }] : null));
  const r = await c.callTool({ name: 'proj_zusammenfuehren', arguments: { spur_ids: ['s2', 's3'], von_beat: 0, bis_beat: 8 } });
  assert.ok(!r.isError, r.content[0].text);
  assert.equal(JSON.parse(r.content[0].text).lanes_verworfen, 2);
});

test('djk-hand S12: graphen reads GET /graphen, graph posts {kanal, name}; a kern refusal and ki_gestoppt become tool errors', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/graphen') return [200, { graphen: [{ name: 'inst', art: 'instrument', regler_namen: {} }], uebersprungen: [], geladen: {} }];
    if (u === '/graph') return [200, { ok: true, kanal: 'erz/3', name: 'inst', quittung: { status: 3, grund: '' } }];
    return null;
  });
  const g = await c.callTool({ name: 'graphen', arguments: {} });
  assert.ok(!g.isError, g.content[0].text);
  assert.equal(JSON.parse(g.content[0].text).graphen[0].name, 'inst');
  const l = await c.callTool({ name: 'graph', arguments: { kanal: 'erz/3', name: 'inst' } });
  assert.ok(!l.isError, l.content[0].text);
  const e = await c.callTool({ name: 'graph', arguments: { kanal: 'erz/3', name: '' } });
  assert.ok(!e.isError, e.content[0].text);
  const posts = gesehen.filter((x) => x.methode === 'POST' && x.pfad === '/graph');
  assert.deepEqual(posts.map((x) => x.koerper), [{ kanal: 'erz/3', name: 'inst' }, { kanal: 'erz/3', name: '' }]);
  assert.ok(gesehen.every((x) => x.quelle === 'cypher'));
});

test('djk-hand S12: graph turns a kern refusal (status 6) and HTTP 409 into tool errors (negative control: status 3 is success above)', async (t) => {
  let weiter = 0;
  const { c } = await aufbau(t, (m, u) => (u === '/graph' ? (weiter++ === 0 ? [200, { ok: true, quittung: { status: 6, grund: 'pruefung' } }] : [409, { fehler: 'ki_gestoppt' }]) : null));
  const a = await c.callTool({ name: 'graph', arguments: { kanal: 'erz/3', name: 'inst' } });
  assert.equal(a.isError, true); assert.match(a.content[0].text, /pruefung/);
  const b = await c.callTool({ name: 'graph', arguments: { kanal: 'erz/3', name: 'inst' } });
  assert.equal(b.isError, true); assert.match(b.content[0].text, /ki_gestoppt/);
});

// 1.10 slice 3: Cypher builds returns and sends through proj_aendern; the tool text names the commands, ranges, reasons and the post fader rule
test('1.10 slice 3: proj_aendern names return_neu, return_aendern, return_loeschen, send_setzen with ranges and reasons; pegel names ret/1..4; regler names the ret and send paths', async (t) => {
  const { c } = await aufbau(t, () => null);
  const werkzeuge = (await c.listTools()).tools;
  const text = (n) => werkzeuge.find((x) => x.name === n).description;
  for (const b of ['return_neu', 'return_aendern', 'return_loeschen', 'send_setzen']) assert.ok(text('proj_aendern').includes(b), b);
  for (const g of ['routing_grenze', 'return_unbekannt']) assert.ok(text('proj_aendern').includes(g), g);
  assert.ok(text('proj_aendern').includes('sends are post fader and post mute'), 'the post fader rule');
  for (const u of ['0..250 ms', '0.1..30 s', '5..200 ms', '1000..22000 Hz', '-24..+12 dB']) assert.ok(text('proj_aendern').includes(u), `Hall unit ${u}`);
  assert.ok(text('pegel').includes('ret/1..4'));
  assert.ok(text('regler').includes('ret/1..4/*') && text('regler').includes('send/1..4'), 'regler: the new paths are ueber_projekt');
  assert.ok(!/[—]/.test(text('proj_aendern').slice(text('proj_aendern').indexOf('return_neu'), text('proj_aendern').indexOf('spur_loeschen {spur_id}'))), 'no em dash in the new text');
});

test('1.10 slice 3: a return routing through the hand (return_neu, two send_setzen) goes as one list from source cypher; ki_gestoppt is refused with its reason', async (t) => {
  let aufrufe = 0;
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/proj/aktuell?nur=rev') return [200, { slug: 'p', rev: 4 }];
    if (/^\/proj\/aendern/.test(u)) return ++aufrufe === 1 ? [200, { rev: 5, kern: { regler: 48 } }] : [409, { fehler: 'ki_gestoppt', text: 'Cypher is stopped' }];
  });
  const befehle = [{ befehl: 'return_neu', name: 'Hall' }, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 },
    { befehl: 'send_setzen', strang_id: 's2', return_id: 'r1', db: -6 }];
  const r = await c.callTool({ name: 'proj_aendern', arguments: { label: 'Hall bus', befehle } });
  assert.ok(!r.isError, r.content[0].text);
  const post = gesehen.filter((x) => x.methode === 'POST').at(-1);
  assert.equal(post.pfad, '/proj/aendern?antwort=kurz');
  assert.deepEqual(post.koerper.befehle, befehle, 'the commands go through unchanged, in one list');
  const nein = await c.callTool({ name: 'proj_aendern', arguments: { label: 'Hall bus again', befehle } });
  assert.equal(nein.isError, true);
  assert.match(nein.content[0].text, /ki_gestoppt/);
});

// S17: proj_bk goes out as GET /proj/bk (lage), POST /proj/bk/merken?antwort=kurz and POST /proj/bk/laden, source cypher; a 409 is a tool error.
test('djk-hand proj_bk (S17): lage = GET, merken = POST merken with kanaele, laden = POST laden, source cypher; 409 is a tool error; a wrong aktion never reaches the page', async (t) => {
  const lage = { slug: 'p', gespeichert: [], kanaele: [{ kanal: 'erz/2', gespeichert: null, live: null, gleich: false }] };
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (m === 'GET' && u === '/proj/bk') return [200, lage];
    if (u === '/proj/bk/merken?antwort=kurz') return [200, { rev: 3, bk: { gemerkt: ['erz/2'], unbekannt: [] } }];
    if (u === '/proj/bk/laden') return [409, { fehler: 'ki_gestoppt', text: 'Stop Cypher is set' }];
  });
  const a = await c.callTool({ name: 'proj_bk', arguments: { aktion: 'lage' } });
  assert.deepEqual(JSON.parse(a.content[0].text), lage);
  const m = await c.callTool({ name: 'proj_bk', arguments: { aktion: 'merken', kanaele: ['erz/2'] } });
  assert.ok(!m.isError, m.content[0].text); assert.deepEqual(JSON.parse(m.content[0].text).bk.gemerkt, ['erz/2']);
  const l = await c.callTool({ name: 'proj_bk', arguments: { aktion: 'laden' } });
  assert.equal(l.isError, true); assert.match(l.content[0].text, /ki_gestoppt/);
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.quelle, x.koerper]), [
    ['GET', '/proj/bk', 'cypher', null], ['POST', '/proj/bk/merken?antwort=kurz', 'cypher', { kanaele: ['erz/2'] }],
    ['POST', '/proj/bk/laden', 'cypher', {}]]);
  const n = gesehen.length;
  const q = await c.callTool({ name: 'proj_bk', arguments: { aktion: 'quatsch' } });
  assert.equal(q.isError, true); assert.equal(gesehen.length, n, 'nothing reaches the page');
  const w = (await c.listTools()).tools;
  const d = w.find((x) => x.name === 'proj_bk').description;
  for (const wort of ['Baukasten: save sound', 'bk_setzen', 'auto_aus', 'does not change the running sound']) assert.ok(d.includes(wort), `proj_bk names ${wort}`);
  assert.ok(w.find((x) => x.name === 'proj_lage').description.includes('baukasten [{kanal, graph}]'));
  assert.ok(w.find((x) => x.name === 'proj_aendern').description.includes('bk_setzen {kanal'));
});

// S18: the instrument slots erz/5..7 and pad/1..2 (streams 5, 6, 7, 9, 10) are reachable through the existing tools
test('S18 djk-hand: strudel enum is the stream table, graph names erz/5..7 and pad/1, pad/2, tool count unchanged', async (t) => {
  const { c } = await aufbau(t, () => null);
  const tools = (await c.listTools()).tools;
  const strudel = tools.find((x) => x.name === 'strudel');
  assert.deepEqual(strudel.inputSchema.properties.strom.enum, [1, 2, 3, 5, 6, 7, 9, 10]);
  assert.deepEqual(strudel.inputSchema.properties.strom.enum, [...ALLE_STROEME]);
  assert.match(strudel.description, /5, 6, 7 \(erz\/5\.\.7\)/);
  const graph = tools.find((x) => x.name === 'graph');
  assert.deepEqual(graph.inputSchema.properties.kanal.enum.slice(0, 7), ['erz/2', 'erz/3', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2']);
  for (const s of ['erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2', 'djk-stroeme']) assert.match(graph.description, new RegExp(s.replace('/', '\\/')), s);
  assert.match(graph.description, /summed with the loop/);
  assert.match(tools.find((x) => x.name === 'pegel').description, /erz\/5\.\.7/, 'pegel lists the new channels');
  assert.equal(tools.length, NAMEN.length)   // merge S17+S18: S18 adds no tool, the count follows the name list;
});

test('S18 djk-hand: proj_aendern and proj_aufnahme name every recordable input of the table (REC_EINGANG), not erz/4 or erz/8', async (t) => {
  const { c } = await aufbau(t, () => null);
  const tools = (await c.listTools()).tools;
  const sp = Object.keys(REC_EINGANG).join('|');
  assert.equal(sp, 'erz/1|erz/2|erz/3|erz/5|erz/6|erz/7|pad/1|pad/2');
  for (const n of ['proj_aendern', 'proj_aufnahme']) {
    assert.ok(tools.find((x) => x.name === n).description.includes(`name: ${sp}}`), `${n} lists the eight inputs`);
  }
  assert.doesNotMatch(tools.find((x) => x.name === 'proj_aufnahme').description, /name: erz\/1\|erz\/2\|erz\/3\}/, 'the old three-input text is gone');
});

test('S18 djk-hand studio and stille follow the streams that /lage lists (fresh Baukasten streams included)', async (t) => {
  const lage = [200, { studio: { stroeme: [{ strom: 1 }, { strom: 2 }, { strom: 3 }, { strom: 6 }, { strom: 9 }] } }];
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/lage') return lage;
    if (u === '/strudel') return [200, { ok: true }];
    const n = /^\/strudel\?strom=(\d+)$/.exec(u ?? '');
    return n ? [200, { autonom: true, text: 'silence', von: 'cypher' }] : null;
  });
  const s = JSON.parse((await c.callTool({ name: 'studio', arguments: {} })).content[0].text);
  assert.deepEqual(s.stroeme.map((x) => x.strom), [1, 2, 3, 6, 9]);
  const n0 = gesehen.length;
  const st = await c.callTool({ name: 'stille', arguments: {} });
  assert.ok(!st.isError, st.content[0].text);
  assert.deepEqual(gesehen.slice(n0).filter((x) => x.pfad === '/strudel').map((x) => x.koerper.strom), [1, 2, 3, 6, 9]);
});

// Automation Slice 3 (task 6): proj_auto_zustand only re-enables lanes (POST /proj/auto/re_enable) and never sends an override; Stop Cypher is a tool error;
// proj_lage describes `uebersteuert`; the tool count is 65.
test('djk-hand proj_auto_zustand (Automation Slice 3): re_enable all and one, ki_gestoppt refusal, never an override, bad arguments refused without a request, proj_lage names uebersteuert', async (t) => {
  let gestoppt = false;
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/proj/auto/re_enable') return gestoppt ? [409, { fehler: 'ki_gestoppt', text: 'Stop Cypher is set' }] : [200, { ok: true, quittung: { status: 0, grund: '' } }];
    return null;
  });
  const alle = await c.callTool({ name: 'proj_auto_zustand', arguments: { re_enable: true } });
  assert.ok(!alle.isError, alle.content[0].text);
  assert.equal(JSON.parse(alle.content[0].text).ok, true);
  const eine = await c.callTool({ name: 'proj_auto_zustand', arguments: { spur_id: 's2', ziel: 'pan' } });
  assert.ok(!eine.isError, eine.content[0].text);
  // refused locally: nothing goes out (negative control for "no request")
  const n1 = gesehen.length;
  for (const bad of [{}, { re_enable: false }, { spur_id: 's2' }, { ziel: 'pan' }, { re_enable: true, spur_id: 's2', ziel: 'pan' }]) {
    const r = await c.callTool({ name: 'proj_auto_zustand', arguments: bad });
    assert.equal(r.isError, true, JSON.stringify(bad)); assert.match(r.content[0].text, /argument_ungueltig/);
  }
  assert.equal(gesehen.length, n1);
  gestoppt = true;
  const g = await c.callTool({ name: 'proj_auto_zustand', arguments: { re_enable: true } });
  assert.equal(g.isError, true); assert.match(g.content[0].text, /ki_gestoppt/);
  // only the re_enable route, source cypher, bodies as sent; no override anywhere
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.quelle, x.koerper]), [
    ['POST', '/proj/auto/re_enable', 'cypher', { alle: true }],
    ['POST', '/proj/auto/re_enable', 'cypher', { spur_id: 's2', ziel: 'pan' }],
    ['POST', '/proj/auto/re_enable', 'cypher', { alle: true }]]);
  assert.ok(!gesehen.some((x) => x.pfad.includes('uebersteuern')));
  const werkzeuge = (await c.listTools()).tools;
  const pz = werkzeuge.find((x) => x.name === 'proj_auto_zustand');
  for (const wort of ['re-enable', 'ki_gestoppt', 'cannot override', 'fader', 'solo']) assert.ok(pz.description.includes(wort), `proj_auto_zustand names ${wort}`);
  const pl = werkzeuge.find((x) => x.name === 'proj_lage').description;
  assert.ok(pl.includes('uebersteuert: true'), 'proj_lage names uebersteuert');
  assert.ok(!pl.includes('auto_uebersteuert'), 'proj_lage promises no list that its view does not carry');
  assert.equal(werkzeuge.length, 66 + 6 + 1 + 1 + 1 + 1 + 1 + 1 /* MIDI import: proj_midi_import */ + 1 /* strudel-clip: proj_muster */);   // + proj_resample (1.10 T6); + proj_routing (1.10 T1); + proj_kits (1.9 T2.5); + ansage (demo overlay); + take_vorhoeren (1.14 T9); + spektrum (1.15 A9); + proj_bounce (1.14 slice 4); + 6 (1.16 rest U5)
});

// Automation Slice 3 (task 6, fixup 2): exactly one of two shapes; every half call, a numeric spur_id and an unknown ziel are refused locally with the real problem; nothing is sent.
test('djk-hand proj_auto_zustand: half calls, numeric spur_id and unknown ziel are refused locally and name the problem; negative control: both valid shapes still go out', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/proj/auto/re_enable' ? [200, { ok: true, quittung: { status: 0, grund: '' } }] : null));
  const faelle = [
    [{ re_enable: true, spur_id: 's2' }, /re_enable true.*spur_id|spur_id.*re_enable/],
    [{ re_enable: true, ziel: 'pan' }, /re_enable true.*ziel|ziel.*re_enable/],
    [{ re_enable: true, spur_id: 5, ziel: 'pan' }, /re_enable/],
    [{ re_enable: false, spur_id: 's2', ziel: 'pan' }, /re_enable/],
    [{ spur_id: 5, ziel: 'pan' }, /spur_id must be a string/],
    [{ spur_id: 's2', ziel: 'foo' }, /ziel must be fader, pan, mute or solo/],
    [{ spur_id: 's2' }, /ziel/], [{ ziel: 'pan' }, /spur_id/], [{ re_enable: 'true' }, /re_enable must be true/], [{}, /re_enable true, or spur_id and ziel/]];
  for (const [a, muster] of faelle) {
    const n = gesehen.length;
    const r = await c.callTool({ name: 'proj_auto_zustand', arguments: a });
    assert.equal(r.isError, true, JSON.stringify(a)); assert.match(r.content[0].text, /argument_ungueltig|ziel_unbekannt/, JSON.stringify(a)); assert.match(r.content[0].text, muster, JSON.stringify(a));
    assert.equal(gesehen.length, n, `nothing sent for ${JSON.stringify(a)}`);
  }
  for (const a of [{ re_enable: true }, { spur_id: 's2', ziel: 'solo' }]) assert.ok(!(await c.callTool({ name: 'proj_auto_zustand', arguments: a })).isError);
  assert.deepEqual(gesehen.map((x) => x.koerper), [{ alle: true }, { spur_id: 's2', ziel: 'solo' }]);
});

// Automation Slice 3 (task 10, AK15): Cypher has no MCP path to arm automation recording or to override a field. No tool names one, no argument smuggles one through
// proj_auto_zustand (the body that goes out is exactly the re-enable shape), and no request of any tool reaches the arm, gesture or override routes; the descriptions say who
// holds them (nur_andreas) and separate the audio record arm of spur_aendern from the automation record arm. Control: the re-enable shapes still go out.
test('djk-hand AK15: no tool arms or overrides, proj_auto_zustand drops smuggled arm arguments, descriptions name nur_andreas and the audio arm, auto_neu names punkte', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/proj/auto/re_enable') return [200, { ok: true, quittung: { status: 0, grund: '' } }];
    if (u.startsWith('/proj/auto/arm') || u.startsWith('/proj/auto/geste') || u.startsWith('/proj/auto/uebersteuern')) return [403, { fehler: 'nur_andreas' }];
    return null;
  });
  const werkzeuge = (await c.listTools()).tools;
  assert.deepEqual(werkzeuge.map((x) => x.name).filter((n) => /arm|geste|uebersteuer/.test(n)), [], 'no tool name carries arm, gesture or override');
  for (const a of [{ re_enable: true, an: false, arm: true, modus: 'write' }, { spur_id: 's1', ziel: 'fader', arm: true, modus: 'latch', uebersteuern: true }]) {
    const r = await c.callTool({ name: 'proj_auto_zustand', arguments: a });
    assert.ok(!r.isError, r.content[0].text);
  }
  assert.deepEqual(gesehen.map((x) => [x.pfad, x.koerper]), [['/proj/auto/re_enable', { alle: true }], ['/proj/auto/re_enable', { spur_id: 's1', ziel: 'fader' }]]);
  assert.ok(!gesehen.some((x) => /\/proj\/auto\/(arm|geste|uebersteuern)/.test(x.pfad)), 'no request to the arm, gesture or override routes');
  const d = (n) => werkzeuge.find((x) => x.name === n).description;
  for (const wort of ['cannot arm', 'nur_andreas', 'records']) assert.ok(d('proj_auto_zustand').includes(wort), `proj_auto_zustand names ${wort}`);
  assert.ok(d('proj_aendern').includes('audio record arm') && d('proj_aendern').includes('nur_andreas'), 'proj_aendern separates the audio arm from the automation record arm');
  assert.match(d('proj_aendern'), /auto_neu \{spur_id[^}]*ziel[^}]*punkte\?/, 'auto_neu names the optional punkte');
  assert.match(d('proj_aendern'), /auto_neu \{[^}]*strang_id[^}]*insert\.<stage id>\.<param>[^}]*rack\.m1/, 'auto_neu names strang_id and the insert and rack targets');
  assert.ok(d('proj_auto').includes('recorded'), 'proj_auto says a recorded take is an ordinary lane');
});

// 1.15 A2 (mix tools): the hand regex PFAD and the contract pattern regler_pfad take exactly the 345 tool paths of section 3 (an exact set,
// not a prefix) and reject the wrong-kind / not-exposed paths. The set is written out here, independent of every other list.
const WZ_GATE = ['an', 'schwelle', 'hysterese', 'ratio', 'bereich', 'attack', 'hold', 'release', 'sc'].map((f) => `gate/${f}`);
const WZ_UTIL = ['balance', 'breite', 'bassmono', 'phase_l', 'phase_r', 'tausch', 'dc'].map((f) => `util/${f}`);
const WZ_MB = ['mb/an', 'mb/grenze_tief', 'mb/grenze_hoch', ...['tief', 'mitte', 'hoch'].flatMap((b) =>
  ['schwelle', 'ratio', 'attack', 'release', 'knie', 'makeup', 'umgehen'].map((f) => `mb/${b}/${f}`))];
const WZ_LIM = ['lim/an', 'lim/decke', 'lim/abklingen'];
const WZ_Q13 = [...[1, 2, 3, 4].map((n) => `deck/${n}`), ...[1, 2, 3, 4, 5, 6, 7].map((n) => `erz/${n}`), 'pad/1', 'pad/2'];
const WZ_B4 = [1, 2, 3, 4].map((n) => `bus/${n}`);
const WZ_345 = [...WZ_Q13.flatMap((k) => WZ_GATE.map((f) => `${k}/${f}`)), ...[...WZ_Q13, ...WZ_B4].flatMap((k) => WZ_UTIL.map((f) => `${k}/${f}`)),
  ...WZ_B4.flatMap((k) => [...WZ_MB, ...WZ_LIM].map((f) => `${k}/${f}`)), 'spektrum/kanal'];
const WZ_NEGATIV = ['erz/8/gate/an', 'erz/8/util/dc', 'bus/1/gate/an', 'deck/1/mb/an', 'deck/1/lim/an', 'bus/5/util/dc', 'spektrum/kanal/1',
  'bus/1/mb/tief/solo', 'bus/1/util/gain_db'];   // negative list of A1b (d)
// the universe: every tool suffix on every channel (18 channels incl. erz/8) plus the negative list and near misses
function wzUniversum() {
  const kanaele = [...WZ_Q13, 'erz/8', ...WZ_B4];
  return [...new Set([...kanaele.flatMap((k) => [...WZ_GATE, ...WZ_UTIL, ...WZ_MB, ...WZ_LIM].map((f) => `${k}/${f}`)), ...WZ_345, ...WZ_NEGATIV,
    ...WZ_B4.map((k) => `${k}/lim/zz`), 'spektrum/kanal', 'spektrum', 'bus/0/lim/an', 'bus/5/lim/an', 'erz/9/gate/an', 'deck/5/gate/an', 'bus/1/lim/vorhalt_ms', 'bus/1/mb/zz/ratio'])];
}
// Which of the universe paths does `re` accept, and how does that differ from the 345? [] = exactly the set.
const wzAbweichung = (re) => wzUniversum().filter((p) => re.test(p) !== WZ_345.includes(p));
const SCHEMA_REGLER_PFAD = new RegExp(JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'vertrag', 'schemas',
  'defs.schema.json'), 'utf8')).$defs.regler_pfad.pattern);

test('1.15 A2: PFAD (hand) and regler_pfad (schema) take exactly the 345 tool paths and none of the negative list', () => {
  assert.equal(WZ_345.length, 345);
  assert.equal(new Set(WZ_345).size, 345);
  assert.ok(wzUniversum().length > 345 + WZ_NEGATIV.length, 'the universe holds the wrong-kind paths too');
  assert.deepEqual(wzAbweichung(PFAD), [], 'PFAD');
  assert.deepEqual(wzAbweichung(SCHEMA_REGLER_PFAD), [], 'schema regler_pfad');
  for (const n of WZ_NEGATIV) assert.equal(PFAD.test(n) || SCHEMA_REGLER_PFAD.test(n), false, n);
  for (const p of ['deck/1/gate/an', 'bus/4/mb/hoch/umgehen', 'bus/2/lim/abklingen', 'erz/7/util/dc', 'spektrum/kanal']) assert.equal(PFAD.test(p), true, p);   // positive control
});

test('1.15 A2: negative control, one extra path or channel in the regex turns the exact-set check red', () => {
  const lim = 'lim\\/(an|decke|abklingen)';
  assert.ok(PFAD.source.includes(lim), 'the limiter alternative is where the mutation expects it');
  const zuviel = new RegExp(PFAD.source.replace(lim, 'lim\\/(an|decke|abklingen|zz)'));
  assert.deepEqual(wzAbweichung(zuviel), ['bus/1/lim/zz', 'bus/2/lim/zz', 'bus/3/lim/zz', 'bus/4/lim/zz'], 'a 13th limiter path is found by name');
  const kanal = new RegExp(PFAD.source.replace('erz\\/[1-7]|pad\\/[12])\\/gate', 'erz\\/[1-8]|pad\\/[12])\\/gate'));
  assert.notEqual(kanal.source, PFAD.source, 'the channel mutation changed the regex');
  assert.deepEqual(wzAbweichung(kanal).sort(), ['erz/8/gate/an', 'erz/8/gate/attack', 'erz/8/gate/bereich', 'erz/8/gate/hold', 'erz/8/gate/hysterese',
    'erz/8/gate/ratio', 'erz/8/gate/release', 'erz/8/gate/sc', 'erz/8/gate/schwelle'], 'erz/8 gate is found by name');
});

// 1.15 A2: the tool description names the mix-tool paths and passes them through to POST /regler unchanged
test('djk-hand 1.15 A2: regler names the gate, util, mb, lim and spektrum paths and passes a tool path through to /regler', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/regler' ? [200, { ok: true, felder: { id: 1 }, quittung: { status: 5, grund: '' } }] : undefined));
  const regler = (await c.listTools()).tools.find((x) => x.name === 'regler').description;
  for (const wort of ['<source>/gate/(an 0/1, schwelle dBFS -90..0', '/util/(balance -1..1', 'mb/(tief|mitte|hoch)/(schwelle dB -60..0', 'lim/(an 0/1, decke dBFS -60..0',
    'spektrum/kanal (0 off, 1..18', 'not erz/8', 'kanal_limiter_vorhalt_ms is 0']) assert.ok(regler.includes(wort), `regler names ${wort}`);
  await c.callTool({ name: 'regler', arguments: { pfad: 'deck/1/gate/schwelle', nach: -30 } });
  await c.callTool({ name: 'regler', arguments: { pfad: 'bus/1/mb/tief/schwelle', nach: -12 } });
  assert.deepEqual(gesehen.filter((g) => g.pfad === '/regler').map((g) => [g.koerper.pfad, g.koerper.nach]),
    [['deck/1/gate/schwelle', -30], ['bus/1/mb/tief/schwelle', -12]]);
});

// 1.15 A9: the spektrum tool. The page server answers GET /spektrum with {leer:false, kanal, rahmen, pegel: "29 integers in 0.1 dB", alter_ms} or {leer:true}.
// The tool gives numbers per band with the band centre in Hz (1000 Hz x 2^(i/3), i = -16..12) and dB as numbers, never the raw 0.1 dB integers.
const SPEK_PEGEL = Array.from({ length: 29 }, (_, i) => -300 - 10 * i + (i === 16 ? 465 : 0));   // band 16 (1000 Hz) = +0.5 dB (5), band 0 = -30 dB, each next band 1 dB lower
test('djk-hand spektrum (1.15 A9): 29 bands with centres in Hz and dB as numbers, source/frame/age passed on, {leer:true} passed through, malformed frame is a tool error', async (t) => {
  let antwort = { leer: false, kanal: 'bus/1', rahmen: 7, pegel: SPEK_PEGEL.join(','), alter_ms: 12 };
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/spektrum' ? [200, antwort] : null));
  const r = await c.callTool({ name: 'spektrum', arguments: {} });
  assert.ok(!r.isError, r.content[0].text);
  const j = JSON.parse(r.content[0].text);
  assert.equal(j.leer, false); assert.equal(j.kanal, 'bus/1'); assert.equal(j.rahmen, 7); assert.equal(j.alter_ms, 12);
  assert.equal(j.baender.length, 29);
  assert.equal(j.baender[16].hz, 1000);                     // i = 0
  assert.equal(j.baender[16].db, 0.5);                      // 5 in 0.1 dB -> 0.5 dB (a raw integer would read 5)
  assert.equal(j.baender[0].db, -30);                       // -300 -> -30 dB
  assert.equal(j.baender[1].db, -31);
  assert.ok(Math.abs(j.baender[0].hz - 24.8) < 0.05, `first centre ${j.baender[0].hz}`);   // 1000 x 2^(-16/3), literal
  assert.ok(Math.abs(j.baender[28].hz - 16000) < 1, `last centre ${j.baender[28].hz}`);    // 1000 x 2^(12/3), literal
  // all 29 centres against the page's arithmetic (within the 0.1 Hz rounding), and the literal one-third-octave ratio between neighbours
  for (let i = 0; i < 29; i++) assert.ok(Math.abs(j.baender[i].hz - bandMitteHz(i)) <= 0.05 + 1e-9, `band ${i}: ${j.baender[i].hz} vs ${bandMitteHz(i)}`);
  for (let i = 1; i < 29; i++) assert.ok(Math.abs(j.baender[i].hz / j.baender[i - 1].hz - 2 ** (1 / 3)) < 0.01, `ratio at band ${i}`);
  assert.equal(j.veraltet, false);
  for (const b of j.baender) { assert.equal(typeof b.hz, 'number'); assert.equal(typeof b.db, 'number'); assert.ok(b.db > -100 && b.db < 10, `db ${b.db}`); }
  assert.ok(!('pegel' in j), 'the raw string does not go out next to the numbers');
  // {leer:true}: passed through unchanged, not an error (selector 0 or no frame yet)
  antwort = { leer: true };
  const l = await c.callTool({ name: 'spektrum', arguments: {} });
  assert.ok(!l.isError, l.content[0].text); assert.deepEqual(JSON.parse(l.content[0].text), { leer: true });
  // a frame that is not 29 integers is a tool error naming the problem, not an invented reading
  antwort = { leer: false, kanal: 'master', rahmen: 1, pegel: '1,2,3', alter_ms: 3 };
  const bad = await c.callTool({ name: 'spektrum', arguments: {} });
  assert.equal(bad.isError, true); assert.match(bad.content[0].text, /pegel_ungueltig/);
  // read-only: only GET /spektrum, source cypher, never a write
  assert.ok(gesehen.length === 3 && gesehen.every((x) => x.methode === 'GET' && x.pfad === '/spektrum' && x.quelle === 'cypher'), JSON.stringify(gesehen.map((x) => [x.methode, x.pfad])));
  // the description points to the selector and names the units
  const d = (await c.listTools()).tools.find((x) => x.name === 'spektrum').description;
  for (const wort of ['regler', 'spektrum/kanal', '0 off', '1..18', '19', 'Hz', 'dB', 'leer']) assert.ok(d.includes(wort), `spektrum names ${wort}`);
  // negative control: a harmless full-scale-quiet frame (all -900 = -90 dB) is a reading, not an error
  antwort = { leer: false, kanal: 'deck/2', rahmen: 2, pegel: Array(29).fill(-900).join(','), alter_ms: 1 };
  const stille = await c.callTool({ name: 'spektrum', arguments: {} });
  assert.ok(!stille.isError, stille.content[0].text); assert.equal(JSON.parse(stille.content[0].text).baender[5].db, -90);
});

// 1.15 A9: regler with a mix-tool path. The page server's PFAD set (the real one, imported) is the gate; a wrong channel kind is a 400 `pfad`
// refusal that the tool turns into an error, never a silent success. Negative control: the right kinds go out as sent.
test('djk-hand regler (1.15 A9): tool paths are sent as given; a wrong channel kind (bus/1/gate/an, erz/8/gate/an, deck/1/mb/an) is refused by the server and is a tool error', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u, k) => {
    if (u !== '/regler') return null;
    return PFAD.test(k?.pfad ?? '') ? [200, { ok: true, felder: { id: 1 }, quittung: { status: 0, grund: '' } }] : [400, { fehler: 'pfad' }];
  });
  for (const falsch of ['bus/1/gate/an', 'erz/8/gate/an', 'deck/1/mb/an', 'deck/1/lim/an', 'bus/5/lim/an']) {
    const r = await c.callTool({ name: 'regler', arguments: { pfad: falsch, nach: 1 } });
    assert.equal(r.isError, true, `${falsch} must be refused`); assert.match(r.content[0].text, /pfad/, falsch);
  }
  for (const richtig of ['deck/1/gate/an', 'erz/7/gate/schwelle', 'bus/1/util/breite', 'bus/2/mb/mitte/ratio', 'bus/4/lim/decke', 'spektrum/kanal']) {
    const r = await c.callTool({ name: 'regler', arguments: { pfad: richtig, nach: 1 } });
    assert.ok(!r.isError, `${richtig}: ${r.content[0].text}`);
  }
  assert.deepEqual(gesehen.filter((x) => x.pfad === '/regler').slice(5).map((x) => x.koerper.pfad),
    ['deck/1/gate/an', 'erz/7/gate/schwelle', 'bus/1/util/breite', 'bus/2/mb/mitte/ratio', 'bus/4/lim/decke', 'spektrum/kanal']);
  assert.ok(gesehen.every((x) => x.quelle === 'cypher'));
});

test('djk-hand regler (1.15 A9): the description names the mix-tool families with their units and says lim/* does nothing while kanal_limiter_vorhalt_ms is 0', async (t) => {
  const { c } = await aufbau(t, () => null);
  const d = (await c.listTools()).tools.find((x) => x.name === 'regler').description;
  for (const wort of ['/gate/(an', 'schwelle dBFS -90..0', 'hysterese dB 0..24', 'ratio 1..100', 'bereich dB -120..0', 'hold ms 0..2000', 'deck/1..4, erz/1..7, pad/1..2 (not erz/8)',
    '/util/(balance -1..1', 'breite % 0..200', 'bassmono Hz 0..500', 'phase_l|phase_r|tausch|dc', 'bus/1..4',
    'mb/an', 'mb/grenze_tief|grenze_hoch Hz 20..20000', 'mb/(tief|mitte|hoch)/(schwelle dB -60..0', 'makeup dB -24..24', 'umgehen 0/1',
    'lim/(an 0/1, decke dBFS -60..0, abklingen ms 1..2000)', 'kanal_limiter_vorhalt_ms', 'spektrum/kanal (0 off, 1..18 = channel index + 1, 19 = master sum)']) {
    assert.ok(d.includes(wort), `regler names ${wort}`);
  }
  assert.match(d, /lim\/\(an 0\/1[^)]*\) = channel limiter \(does nothing while kern\.toml kanal_limiter_vorhalt_ms is 0, the default\)/);
  assert.ok(d.includes('none of them counts as making things quieter'));
});

// 1.15 A9 fix round 1: staleness and an unusable 200 reply. The server clears the frame only on a source change or a new kern, so an old frame is
// served as it is: the tool marks it `veraltet` above the page's limit (SPEKTRUM_FRIST_MS, 500 ms). A 200 answer without a boolean `leer` is not a reading.
test('djk-hand spektrum (1.15 A9 round 1): alter_ms above the page limit is veraltet, at the limit it is not; a 200 reply without a boolean leer is a tool error', async (t) => {
  assert.equal(SPEKTRUM_FRIST_MS, 500);
  let antwort;
  const rahmen = (alter) => ({ leer: false, kanal: 'bus/1', rahmen: 3, pegel: Array(29).fill(-300).join(','), alter_ms: alter });
  const { c } = await aufbau(t, (m, u) => (u === '/spektrum' ? (typeof antwort === 'string' ? [200, antwort] : [200, antwort]) : null));
  for (const [alter, erwartet] of [[0, false], [12, false], [500, false], [501, true], [3600000, true]]) {
    antwort = rahmen(alter);
    const r = await c.callTool({ name: 'spektrum', arguments: {} });
    assert.ok(!r.isError, r.content[0].text);
    const j = JSON.parse(r.content[0].text);
    assert.equal(j.veraltet, erwartet, `alter_ms ${alter}`); assert.equal(j.alter_ms, alter); assert.equal(j.baender.length, 29);
  }
  antwort = rahmen(undefined); delete antwort.alter_ms;     // no age given: cannot be called fresh
  assert.equal(JSON.parse((await c.callTool({ name: 'spektrum', arguments: {} })).content[0].text).veraltet, true);
  for (const kaputt of [{}, { fehler: 'x' }, { leer: 'ja' }, { leer: 1 }, { kanal: 'bus/1', pegel: Array(29).fill(0).join(',') }, [], null, 'x']) {
    antwort = kaputt;
    const r = await c.callTool({ name: 'spektrum', arguments: {} });
    assert.equal(r.isError, true, JSON.stringify(kaputt)); assert.match(r.content[0].text, /antwort_ungueltig/, JSON.stringify(kaputt));
  }
  // negative control: {leer:true} is still a plain success
  antwort = { leer: true };
  const l = await c.callTool({ name: 'spektrum', arguments: {} });
  assert.ok(!l.isError); assert.deepEqual(JSON.parse(l.content[0].text), { leer: true });
  // the description states the staleness rule, the normal empty answer after a source change, and no longer says "Free to read."
  const d = (await c.listTools()).tools.find((x) => x.name === 'spektrum').description;
  for (const wort of ['veraltet', '500 ms', 'stale', 'ask again after about 100 ms', 'changes nothing']) assert.ok(d.includes(wort), `spektrum names ${wort}`);
  assert.ok(!d.includes('Free to read'));
});

// 1.14 comping Slice 1 (task 9): take_vorhoeren posts /proj/take_vorhoeren as cypher; proj_aendern names the four take commands; Stop Cypher is a tool error.
test('djk-hand take_vorhoeren (1.14 T9): audition on and off, source cypher, bad arguments refused locally, ki_gestoppt as tool error, proj_aendern names the take commands', async (t) => {
  let gestoppt = false;
  const { c, gesehen } = await aufbau(t, (m, u, k) => {
    if (u === '/proj/take_vorhoeren') return gestoppt ? [409, { fehler: 'ki_gestoppt', text: 'Stop Cypher is set' }] : [200, { vorhoeren: k.take_id === null ? {} : { [k.spur_id]: k.take_id } }];
    return null;
  });
  const an = await c.callTool({ name: 'take_vorhoeren', arguments: { spur_id: 's2', take_id: 't3' } });
  assert.ok(!an.isError, an.content[0].text);
  assert.deepEqual(JSON.parse(an.content[0].text), { vorhoeren: { s2: 't3' } });
  const aus = await c.callTool({ name: 'take_vorhoeren', arguments: { spur_id: 's2', take_id: null } });
  assert.ok(!aus.isError, aus.content[0].text);
  assert.deepEqual(JSON.parse(aus.content[0].text), { vorhoeren: {} });
  // negative control: bad arguments are refused without a request
  const n1 = gesehen.length;
  for (const bad of [{}, { take_id: 't3' }, { spur_id: 5, take_id: 't3' }, { spur_id: 's2' }, { spur_id: 's2', take_id: 7 }, { spur_id: 's2', take_id: '' }, { spur_id: '', take_id: 't3' }]) {
    const r = await c.callTool({ name: 'take_vorhoeren', arguments: bad });
    assert.equal(r.isError, true, JSON.stringify(bad)); assert.match(r.content[0].text, /argument_ungueltig/);
  }
  assert.equal(gesehen.length, n1);
  gestoppt = true;
  const g = await c.callTool({ name: 'take_vorhoeren', arguments: { spur_id: 's2', take_id: 't3' } });
  assert.equal(g.isError, true); assert.match(g.content[0].text, /ki_gestoppt/);
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.quelle, x.koerper]), [
    ['POST', '/proj/take_vorhoeren', 'cypher', { spur_id: 's2', take_id: 't3' }],
    ['POST', '/proj/take_vorhoeren', 'cypher', { spur_id: 's2', take_id: null }],
    ['POST', '/proj/take_vorhoeren', 'cypher', { spur_id: 's2', take_id: 't3' }]]);
  const werkzeuge = (await c.listTools()).tools;
  const pae = werkzeuge.find((x) => x.name === 'proj_aendern').description;
  for (const wort of ['take_neu {spur_id', 'take_umbenennen {spur_id', 'take_loeschen {spur_id', 'comp_waehlen {spur_id', 'von_beat', 'take_vorhoeren']) assert.ok(pae.includes(wort), `proj_aendern names ${wort}`);
  for (const wort of ['take_unbekannt', 'takes_voll', 'take_nur_audio', 'take_name_ungueltig', 'comp_leer', 'Take <n>', '"Original"', 'replaces', 'four ms', 'leaves the main track']) assert.ok(pae.includes(wort), `proj_aendern names ${wort}`);
  assert.ok(!pae.includes('fills the newest take'), 'old wrong recording sentence is gone');
  for (const n of ['proj_lage', 'proj_oeffnen']) {
    const d = werkzeuge.find((x) => x.name === n).description;
    assert.ok(d.includes('audio tracks with takes carry `takes_zahl` (count of take lanes); `vorhoeren` maps spur_id to the auditioned take_id'), `${n} names takes and vorhoeren`);
    assert.ok(!d.includes('as the server lists them'), `${n}: no empty phrase`);
  }
  assert.ok(!werkzeuge.find((x) => x.name === 'proj_lage').description.includes('automation line show takes'), 'takes are not inside the automation sentence');
  const tv = werkzeuge.find((x) => x.name === 'take_vorhoeren').description;
  for (const wort of ['take_unbekannt', 'aufnahme_laeuft', 'kein_projekt', 'ki_gestoppt']) assert.ok(tv.includes(wort), `take_vorhoeren names ${wort}`);
  assert.match(werkzeuge.find((x) => x.name === 'take_vorhoeren').description, /ki_gestoppt/);
});

// 1.8 S2b.4: the descriptions of proj_aendern and proj_aufnahme name the external inputs, the release refusal and what the answer carries
test('djk-hand 1.8 S2b: proj_aendern and proj_aufnahme describe external inputs, eingang_nicht_frei, versatz_samples and hinweise; the tool count stays', async (t) => {
  const { c } = await aufbau(t, () => [200, {}]);
  const werkzeuge = (await c.listTools()).tools;
  const beschreibung = (n) => werkzeuge.find((x) => x.name === n).description;
  for (const n of ['proj_aendern', 'proj_aufnahme']) assert.ok(beschreibung(n).includes('eingang_nicht_frei'), `${n} names eingang_nicht_frei`);
  const pae = beschreibung('proj_aendern'), pau = beschreibung('proj_aufnahme');
  for (const wort of ['art: extern', 'paar', 'stereo|links|rechts|summe']) assert.ok(pae.includes(wort), `proj_aendern names ${wort}`);
  for (const wort of ['frei_fuer_cypher', 'geraete_lage', 'versatz_samples', 'nachlauf_samples', 'hinweise', 'latenz_fehlt', 'latenz_veraltet', 'kein_eingang']) {
    assert.ok(pau.includes(wort), `proj_aufnahme names ${wort}`);
  }
  assert.ok(!pau.includes('External inputs (microphone, XDJ-XZ) are not part of this'), 'the slice 1 sentence is gone');
  assert.equal(werkzeuge.length, 79, 'no new tool (D5); 79 with proj_midi_import and proj_muster, as main asserts in the schleife_takte case (+ proj_muster)');
});

// 1.12 S7 (M13) U13 T13.4: spur with schleife_takte loops until spur_stopp; aendern: true changes a running loop of mine from its next pass
test('djk-hand spur: schleife_takte goes into the body, aendern posts /spur/aendern, the description names the loop rules; still 79 tools', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/spur') return [200, { ok: true, anker_beat: 16 }];
    if (u === '/spur/aendern') return [409, { fehler: 'nur_andreas', text: 'this loop is Andreas\'s' }];
  });
  const fahrten = [{ ziel: 'erz/2/fader', ab_takt: 1, nach: 0 }, { ziel: 'erz/2/fader', ab_takt: 1, takte: 4, nach: -30, form: 'linear' }];
  let r = await c.callTool({ name: 'spur', arguments: { name: 'loop-2', fahrten, schleife_takte: 4 } });
  assert.ok(!r.isError, r.content[0].text);
  assert.deepEqual(gesehen[0].koerper, { spur: { name: 'loop-2', fahrten, schleife_takte: 4 }, ab: 'takt' });
  r = await c.callTool({ name: 'spur', arguments: { name: 'loop-2', fahrten, schleife_takte: 4, aendern: true } });
  assert.equal(gesehen[1].pfad, '/spur/aendern'); assert.equal(gesehen[1].methode, 'POST');
  assert.deepEqual(gesehen[1].koerper, { name: 'loop-2', spur: { name: 'loop-2', fahrten, schleife_takte: 4 } });
  assert.equal(r.isError, true); assert.match(r.content[0].text, /nur_andreas/, 'the refusal reaches Cypher');
  // negative control: without schleife_takte the body is exactly the one-shot body of before
  await c.callTool({ name: 'spur', arguments: { name: 'x', fahrten } });
  assert.deepEqual(gesehen[2].koerper, { spur: { name: 'x', fahrten }, ab: 'takt' });
  const werkzeuge = (await c.listTools()).tools;
  assert.equal(werkzeuge.length, 66 + 6 + 1 + 1 + 1 + 1 + 1 + 1 /* MIDI import: proj_midi_import */ + 1 /* strudel-clip: proj_muster */);   // 77 = 66 + the 6 presets and collections tools (1.16 rest U5) + ansage (demo overlay) + proj_kits (1.9 T2.5) + proj_routing (1.10 T1) + proj_resample (1.10 T6) + plugins (1.11 T8)
  const w = werkzeuge.find((x) => x.name === 'spur');
  for (const wort of ['schleife_takte', 'aendern', 'keine_schleife', 'nur_andreas', 'next pass']) assert.ok(w.description.includes(wort), `spur names ${wort}`);
  assert.equal(w.inputSchema.properties.schleife_takte.maximum, 64);
  assert.match(w.description, /spur\/1\.\.32.*ueber_projekt.*proj_aendern/s, 'the existing wording stays');
});

// 1.14 slice 4 (bounce, spec R13, B-AK16): proj_bounce posts exactly the given fields per art with source cypher to /proj/bounce?antwort=kurz,
// passes the answer on, turns a 409 into a tool error with the text, and waits with its own limit (DJK_HAND_FRIST_PROJ_BOUNCE_MS).
test('djk-hand proj_bounce (1.14 slice 4): exact body per art, source cypher, answer unchanged, 409 as tool error, description', async (t) => {
  const ergebnis = { art: 'an_ort', rev: 9, spur_id: 's1', clip_id: 'c5', datei: '/p/x/bounce/bounce-3.wav', frames: 96000, quellen: ['s1'], take_id: 't2' };
  const refusal = { fehler: 'bounce_nur_audio', text: 'Acid is an instrument track; use Bounce to New Track, or Freeze for a Surge track' };
  const { c, gesehen } = await aufbau(t, (m, u, k) => (u.startsWith('/proj/bounce') ? (k?.spur_id === 's4' ? [409, refusal] : [200, ergebnis]) : null));
  const faelle = [
    { art: 'an_ort', spur_id: 's1' },
    { art: 'neue_spur', spur_ids: ['s1'] },
    { art: 'neue_spur', gruppe_id: 'g1', von_beat: 0, bis_beat: 16 },
    { art: 'einfuegen', spur_ids: ['s1', 's2'], von_beat: 4, bis_beat: 12, ziel_spur_id: 's3', ziel_beat: 32 },
  ];
  for (const a of faelle) {
    const r = await c.callTool({ name: 'proj_bounce', arguments: a });
    assert.ok(!r.isError, r.content[0].text);
    assert.deepEqual(JSON.parse(r.content[0].text), ergebnis);
  }
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.quelle, x.koerper]), faelle.map((a) => ['POST', '/proj/bounce?antwort=kurz', 'cypher', a]),
    'exactly the given fields, nothing added');
  const e = await c.callTool({ name: 'proj_bounce', arguments: { art: 'an_ort', spur_id: 's4' } });
  assert.equal(e.isError, true);
  assert.match(e.content[0].text, /bounce_nur_audio/); assert.match(e.content[0].text, /instrument track/);
  const w = (await c.listTools()).tools.find((x) => x.name === 'proj_bounce');
  assert.deepEqual(w.inputSchema.required, ['art']);
  assert.deepEqual(w.inputSchema.properties.art.enum, ['an_ort', 'neue_spur', 'einfuegen']);
  for (const g of ['Before bounce', 'comp_waehlen', 'pre-mixer', 'One undo', '+3.01 dB', 'hand_frist', 'DJK_HAND_FRIST_PROJ_BOUNCE_MS', 'up to 80 min',
    'bounce_nur_audio', 'bounce_ziel_art', 'takes_voll', 'ersetzen_loop', 'gruppe_unbekannt', 'merge_andreas_spur', 'merge_leer', 'veraltet']) {
    assert.ok(w.description.includes(g), `proj_bounce names ${g}`);
  }
});

test('djk-hand proj_bounce: its own time limit from DJK_HAND_FRIST_PROJ_BOUNCE_MS gives hand_frist; a long limit waits for the answer', async (t) => {
  const mitSeite = async (env, verzoegerung) => {
    const s = http.createServer((q, a) => { q.resume(); q.on('end', () => setTimeout(() => {
      a.writeHead(200, { 'content-type': 'application/json' }); a.end(JSON.stringify({ art: 'an_ort', rev: 2 }));
    }, verzoegerung)); });
    await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
    const c = new Client({ name: 'test', version: '0' });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`],
      env: { ...process.env, ...env } }));
    t.after(async () => { await c.close(); s.closeAllConnections?.(); s.close(); });
    return c;
  };
  const kurz = await mitSeite({ DJK_HAND_FRIST_PROJ_BOUNCE_MS: '300' }, 2500);
  const r = await kurz.callTool({ name: 'proj_bounce', arguments: { art: 'an_ort', spur_id: 's1' } });
  assert.equal(r.isError, true);
  assert.equal(JSON.parse(r.content[0].text).fehler, 'hand_frist', r.content[0].text);
  const lang = await mitSeite({ DJK_HAND_FRIST_PROJ_BOUNCE_MS: '10000' }, 600);
  const ok = await lang.callTool({ name: 'proj_bounce', arguments: { art: 'an_ort', spur_id: 's1' } });
  assert.ok(!ok.isError, ok.content[0].text);
});

test('1.10 slice 4c review: spur names the rack macro paths and the rack commands as ueber_projekt, like regler (POST /spur refuses rack/*)', async (t) => {
  const { c } = await aufbau(t, () => null);
  const werkzeuge = (await c.listTools()).tools;
  const text = (n) => werkzeuge.find((x) => x.name === n).description;
  for (const w of ['regler', 'spur']) {
    assert.ok(text(w).includes('rack/1..12/m1..m4'), `${w}: rack/1..12/m1..m4`);
    for (const b of ['rack_setzen', 'rack_makro']) assert.ok(text(w).includes(b), `${w}: ${b}`);
  }
});

// 1.12 automation slice 4 (plan PLAN-1.12-slices4-5-7.md, U5 T5.4): proj_aendern names the four lane editor commands; the tool count stays; a
// stopped Cypher (409 ki_gestoppt) is a tool error that carries the reason.
test('S4 T5.4 djk-hand proj_aendern: auto_vereinfachen, auto_dehnen, auto_neigen, auto_form with fields and reasons; ki_gestoppt is a tool error', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/proj/aktuell?nur=rev') return [200, { slug: 'p', rev: 7 }];
    if (u === '/proj/aendern?antwort=kurz') return [409, { fehler: 'ki_gestoppt', text: 'Stop Cypher is set' }];
  });
  const werkzeuge = (await c.listTools()).tools;
  assert.equal(werkzeuge.length, NAMEN.length, 'tool count unchanged');
  const pae = werkzeuge.find((x) => x.name === 'proj_aendern').description;
  for (const wort of ['auto_vereinfachen {lane_id, von_beat, bis_beat, toleranz?', 'auto_dehnen {lane_id, von_beat, bis_beat, neu_bis_beat',
    'auto_neigen {lane_id, von_beat, bis_beat, faktor', 'auto_form {lane_id, von_beat, bis_beat, form', 'rampe_auf', 'rampe_ab', 'sinus', 'dreieck', 'rechteck',
    'perioden', 'unten', 'oben', 'bereich_leer', 'form_ungueltig', '0.004']) assert.ok(pae.includes(wort), `proj_aendern names ${wort}`);
  const befehl = { befehl: 'auto_form', lane_id: 'a1', von_beat: 0, bis_beat: 8, form: 'sinus' };
  const r = await c.callTool({ name: 'proj_aendern', arguments: { label: 'Sweep', befehle: [befehl] } });
  assert.equal(r.isError, true); assert.match(r.content[0].text, /ki_gestoppt/);
  assert.deepEqual(gesehen.find((x) => x.pfad === '/proj/aendern?antwort=kurz').koerper, { label: 'Sweep', befehle: [befehl], rev: 7 });
});

// 1.12 automation slice 5 (plan PLAN-1.12-slices4-5-7.md, U11 T11.1): proj_auto with clip_id and ziel goes out as GET /proj/auto?clip_id=..&ziel=.. with
// source cypher, the answer arrives unchanged; proj_aendern and proj_lage name the clip envelopes; the tool count stays; a stopped Cypher (409
// ki_gestoppt) on huellkurve_setzen is a tool error that carries the reason (AK24 part).
test('S5 T11.1 djk-hand: proj_auto clip_id + ziel posts the right query, the descriptions name the envelopes, the tool count stays, ki_gestoppt is a tool error', async (t) => {
  const huelle = { clip_id: 'c1', spur_id: 's1', ziel: 'gain', verknuepft: true, punkte_zahl: 2, punkte_gezeigt: 2,
    punkte: [{ beat: 0, wert: -12, form: 'linear' }, { beat: 4, wert: 0, form: 'linear' }], bei: { beat: 2, wert: -6 } };
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/proj/aktuell?nur=rev') return [200, { slug: 'p', rev: 9 }];
    if (u === '/proj/aendern?antwort=kurz') return [409, { fehler: 'ki_gestoppt', text: 'Stop Cypher is set' }];
    if (u?.startsWith('/proj/auto?clip_id=c1&ziel=gain')) return [200, huelle];
    if (u?.startsWith('/proj/auto?clip_id=')) return [404, { fehler: 'huellkurve_unbekannt', text: 'that clip has no envelope for this target' }];
  });
  const werkzeuge = (await c.listTools()).tools;
  assert.equal(werkzeuge.length, NAMEN.length, 'tool count unchanged (no tool added)');
  const a = await c.callTool({ name: 'proj_auto', arguments: { clip_id: 'c1', ziel: 'gain', bei_beat: 2 } });
  assert.ok(!a.isError, a.content[0].text);
  assert.deepEqual(JSON.parse(a.content[0].text), huelle);
  const b = await c.callTool({ name: 'proj_auto', arguments: { clip_id: 'c2', ziel: 'transpose' } });
  assert.equal(b.isError, true); assert.match(b.content[0].text, /huellkurve_unbekannt/);
  assert.deepEqual(gesehen.filter((x) => x.pfad.startsWith('/proj/auto')).map((x) => [x.methode, x.pfad, x.quelle]), [
    ['GET', '/proj/auto?clip_id=c1&ziel=gain&bei_beat=2', 'cypher'], ['GET', '/proj/auto?clip_id=c2&ziel=transpose', 'cypher']]);
  const pa = werkzeuge.find((x) => x.name === 'proj_auto');
  assert.ok(pa.inputSchema.properties.clip_id && pa.inputSchema.properties.ziel, 'clip_id and ziel are in the input schema');
  assert.deepEqual(pa.inputSchema.required ?? [], []);
  for (const wort of ['CLIP ENVELOPES', 'CLIP beats', 'huellkurve_unbekannt', 'huellkurve_ziel', 'clip_unbekannt', 'huellkurven: [...]', 'geraet.env_mod']) {
    assert.ok(pa.description.includes(wort), `proj_auto names ${wort}`);
  }
  assert.match(pa.inputSchema.properties.bei_beat.description, /clip beat for a clip envelope/);
  const pae = werkzeuge.find((x) => x.name === 'proj_aendern').description;
  for (const wort of ['huellkurve_setzen {clip_id, ziel', 'huellkurve_loeschen {clip_id, ziel}', 'gain | transpose | spur_fader | spur_pan', 'verknuepft', 'loop_beats',
    'RELATIVE', 'CLIP beat', 'huellkurve_ziel', 'huellkurve_unbekannt', 'geraet_huellkurven', 'there is no lock for envelopes']) assert.ok(pae.includes(wort), `proj_aendern names ${wort}`);
  for (const n of ['proj_lage', 'proj_oeffnen']) {
    assert.ok(werkzeuge.find((x) => x.name === n).description.includes('huellkurven: [{ziel, punkte_zahl'), `${n} shows the envelopes of a clip`);
  }
  const befehl = { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'gain', punkte: [{ beat: 0, wert: -12 }, { beat: 4, wert: 0 }] };
  const r = await c.callTool({ name: 'proj_aendern', arguments: { label: 'Fade in', befehle: [befehl] } });
  assert.equal(r.isError, true); assert.match(r.content[0].text, /ki_gestoppt/);
  assert.deepEqual(gesehen.find((x) => x.pfad === '/proj/aendern?antwort=kurz').koerper, { label: 'Fade in', befehle: [befehl], rev: 9 });
});

// Package 1.16 rest U2 T2.7: proj_aendern names insert_werte_setzen, the preset origin and the freeze rule (no tool count change)
test('1.16 rest: proj_aendern names insert_werte_setzen {insert_id, werte, preset?}, geraet.preset and the freeze sentence', async (t) => {
  const { c } = await aufbau(t, () => [200, {}]);
  const d = (await c.listTools()).tools.find((x) => x.name === 'proj_aendern').description;
  for (const wort of ['insert_werte_setzen {insert_id, werte', 'preset?', 'geraet.preset', "changing a device's values on a frozen track drops the freeze; a change of only `preset` keeps it"]) {
    assert.ok(d.includes(wort), `proj_aendern names ${wort}`);
  }
});


test('djk-hand proj_kits (1.9 T2.5): GET /proj/kits as a read, the answer reaches the caller; proj_aendern names the kit device and kit_unbekannt', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/proj/kits') return [200, { kits: [{ name: 'kit_a', klaenge: 3 }] }];
  });
  const r = await c.callTool({ name: 'proj_kits', arguments: {} });
  assert.ok(!r.isError, JSON.stringify(r));
  assert.deepEqual(JSON.parse(r.content[0].text), { kits: [{ name: 'kit_a', klaenge: 3 }] });
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.koerper]), [['GET', '/proj/kits', null]]);
  const { tools } = await c.listTools();
  const pae = tools.find((x) => x.name === 'proj_aendern').description;
  for (const wort of ['name kit', 'kit_unbekannt', 'proj_kits', 'at most 8 kit']) assert.ok(pae.includes(wort), `proj_aendern nennt ${wort}`);
  assert.ok(tools.find((x) => x.name === 'proj_kits').description.includes('kit folder'));
  // negative control: the other read tools are not renamed and proj_liste still asks /proj/liste
  await c.callTool({ name: 'proj_liste', arguments: {} });
  assert.equal(gesehen.at(-1).pfad, '/proj/liste');
});

test('djk-hand presets_suchen with 1.9 T4.4: POST /presets/suche with the query as given, its schema is the one of the server; proj_aendern names geraet_richtung and preset_anwenden', async (t) => {
  const treffer = { gesamt: 1, treffer: [{ id: 'werk:rb338/dark-dub', name: 'Dark Dub' }] };
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/presets/suche' && m === 'POST' ? [200, treffer] : undefined));
  const r = await c.callTool({ name: 'presets_suchen', arguments: { art: ['bass'], charakter: ['dark'] } });
  assert.ok(!r.isError, JSON.stringify(r));
  assert.deepEqual(JSON.parse(r.content[0].text), treffer);
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.quelle, x.koerper]), [['POST', '/presets/suche', 'cypher', { art: ['bass'], charakter: ['dark'] }]]);
  const { tools } = await c.listTools();
  const t1 = tools.find((x) => x.name === 'presets_suchen');
  // the tool schema is the schema the server hands out (same function, same vocabulary): the character words are the vocabulary's
  const { frageSchema } = await import('../../ui/presets/register.ts');
  const { ladeVokabular } = await import('../../ui/presets/vocabulary.ts');
  assert.deepEqual(t1.inputSchema, frageSchema(ladeVokabular()).input_schema);
  assert.ok(t1.inputSchema.properties.charakter.items.enum.includes('dark'));
  assert.match(t1.description, /<herkunft>:<geraet>\/<slug>/, 'the description says what an id looks like (merge: the 1.16 search tool text)');
  const pae = tools.find((x) => x.name === 'proj_aendern').description;
  for (const wort of ['geraet_richtung', 'bright', 'aggressive', 'tight', 'deep', 'staerke', 'richtung_unbekannt', 'richtung_grenze', 'preset_anwenden', 'preset_unbekannt', 'presets_suchen']) {
    assert.ok(pae.includes(wort), `proj_aendern nennt ${wort}`);
  }
  // review U4 MAJOR: the size of the deep move in the text is the one of the code (DEEP_FAKTOR), not the first spec version
  const { DEEP_FAKTOR } = await import('../../ui/project/direction.ts');
  assert.ok(pae.includes(`deep (cutoff down by ${DEEP_FAKTOR} steps, volume untouched)`), 'proj_aendern says deep moves the cutoff by DEEP_FAKTOR steps');
  assert.ok(!pae.includes('half a step'), 'the withdrawn half-step text is gone');
  // review U4 MINOR: tight only shortens the filter-envelope decay on the RB-338; the label recommendation is pinned
  assert.match(pae, /tight \(decay down[^)]*filter envelope[^)]*not the amplitude/, 'tight says what it does on the RB-338');
  assert.ok(pae.includes('name it with the label "<word> <track name>"'), 'the label recommendation is pinned');
  const aufruf = fs.readFileSync(new URL('../AUFRUF.md', import.meta.url), 'utf8');
  assert.ok(aufruf.includes(`\`deep\` (cutoff - by ${DEEP_FAKTOR} steps)`), 'AUFRUF.md names the real deep size');
  assert.ok(!aufruf.includes('half a step'), 'AUFRUF.md: no half a step');
  assert.match(aufruf, /`tight` \(decay -; filter envelope only/, 'AUFRUF.md: tight caveat');
  // 1.9 U5: the Surge side of the word call and the parameter map of the wirt device are named, in the tool text and in AUFRUF.md
  for (const wort of ['a_filter1_cutoff', 'a_filter1_resonance', 'a_env1_release', 'wirt_wert_unbekannt', 'richtung_wirkungslos', 'parameter? = a sparse map', 'surge_bereiche']) {
    assert.ok(pae.includes(wort), `proj_aendern names ${wort} for Surge`);
    assert.ok(aufruf.includes(wort.replace('parameter? = a sparse map', 'sparse parameter map')), `AUFRUF.md names ${wort} for Surge`);
  }
  assert.ok(!pae.includes('(audio, bk, kit, Surge) knows none'), 'the old text that Surge knows no word is gone');
  // negative control: a query the server refuses reaches the caller as an error, not as an empty answer
  const { c: c2 } = await aufbau(t, (m, u) => (u === '/presets/suche' ? [400, { fehler: 'anfrage_ungueltig', text: 'bad query' }] : undefined));
  const bad = await c2.callTool({ name: 'presets_suchen', arguments: { charakter: ['grumpy'] } });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /anfrage_ungueltig/);
});

// 1.8 T5: count-in, punch and overdub in the descriptions (aufnahme_setzen in proj_aendern; start, punch result and refusals in proj_aufnahme)
test('djk-hand (1.8 T5): proj_aendern names aufnahme_setzen with its fields; proj_aufnahme names count-in, running start, punch result and the new reasons', async (t) => {
  const { c } = await aufbau(t, () => undefined);
  const werkzeuge = (await c.listTools()).tools;
  const text = (n) => werkzeuge.find((x) => x.name === n).description;
  for (const g of ['aufnahme_setzen {vorzaehler_takte?', 'punch? {ein?, aus?, von_beat?, bis_beat?}', 'overdub?']) assert.ok(text('proj_aendern').includes(g), `proj_aendern nennt ${g}`);
  for (const g of ['count-in', 'vorzaehler_takte', 'laufend', 'transport_laeuft', 'punch_leer', 'einsatz_ausgeblieben', 'punch {von_beat, bis_beat}', 'punch.ein']) {
    assert.ok(text('proj_aufnahme').includes(g), `proj_aufnahme nennt ${g}`);
  }
  assert.equal(werkzeuge.length, 79 + 0, 'tool count unchanged');
});

// 1.8 T8: MIDI recording in the descriptions (the instrument track input in proj_aendern; the MIDI run, release, offset, overdub and reasons in proj_aufnahme)
test('djk-hand (1.8 T8): proj_aendern offers {art: midi} for an instrument track; proj_aufnahme describes the MIDI run, the release, the offset, replace and overdub', async (t) => {
  const { c } = await aufbau(t, () => undefined);
  const werkzeuge = (await c.listTools()).tools;
  const text = (n) => werkzeuge.find((x) => x.name === n).description;
  for (const g of ['{art: midi}', 'instrument track', 'midi_ein_1']) assert.ok(text('proj_aendern').includes(g), `proj_aendern nennt ${g}`);
  for (const g of ['instrument tracks', 'midi_ein_1', 'midi-<kennung>.bin', 'frei_fuer_cypher of midi', 'midi.versatz_samples', 'overdub', 'ersetzen_loop', 'keine_noten', 'ONE undo step']) {
    assert.ok(text('proj_aufnahme').includes(g), `proj_aufnahme nennt ${g}`);
  }
  assert.ok(!text('proj_aufnahme').startsWith('Record onto the armed audio tracks'), 'the first sentence is no longer audio only');
  assert.equal(werkzeuge.length, 79 + 0, 'tool count unchanged');
});

// 1.8 T10: ONE scripted session of the real hand (stdio) against the real page server and the stand-in core (the stand-in writes the take files). Cypher sets up a
// track, reads the release of the inputs, sets input, arm, monitor and the count-in, records through proj_aufnahme and finds the take in proj_lage; the history entry
// carries the source cypher. The stack letter is the suite default h unless CYPHERDJ_TEST_INSTANZ says otherwise (tests/support/instance.mjs); the imports are lazy so the
// other tests of this file do not take the instance lock.
test('djk-hand (1.8 T10): a recording session through the tools: devices, arm, input, monitor, count-in, proj_aufnahme start and stopp, proj_lage shows the take, history source cypher', async (t) => {
  const OB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'oberflaeche');
  const { stapel } = await import(path.join(OB, 'tests', 'support', 'media_library.mjs'));
  const { ruf, warte, anKern } = await import(path.join(OB, 'tests', 'support', 'proj_stack.mjs'));
  const { GeraeteSpeicher, standard } = await import(path.join(OB, 'areas', 'devices', 'store.ts'));
  const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-hand-rec-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const konfigPfad = path.join(tmp, 'geraete.json');
  {   // input 1 has a device and is released for Cypher, input 2 has a device and is not
    const k = standard();
    const latenz = { samples: 256, streuung: 0, min: 256, max: 256, laeufe: 20, quantum: 256, rate: 48000, art: 'software', gemessen_am: '2026-11-08' };
    for (const n of [1, 2]) { const e = k.eingaenge[n - 1]; e.profil = 'pc-eingang'; e.name = `Dev ${n}`; e.audio = { knoten: `knoten-${n}`, ports: [`dev:in_${n}_L`, `dev:in_${n}_R`] }; e.latenz = latenz; e.frei_fuer_cypher = n === 1; }
    new GeraeteSpeicher(konfigPfad).schreibe(k);
  }
  const { url, log } = await stapel(t, { geraete: { konfigPfad } });
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', url] }));
  t.after(() => c.close());
  const ruft = async (name, args) => {
    const r = await c.callTool({ name, arguments: args });
    assert.ok(!r.isError, `${name} ${JSON.stringify(args)}: ${r.content[0].text}`);
    return JSON.parse(r.content[0].text);
  };
  const rev = async () => (await ruft('proj_lage', {})).projekt.rev;
  const aendern = async (label, befehle) => ruft('proj_aendern', { rev: await rev(), label, befehle });

  // devices: the release per input is visible to Cypher (and only Andreas sets it, geraete_lage is a read)
  const g = await ruft('geraete_lage', {});
  const eingang = (k) => g.eingaenge.find((e) => e.k === k);
  assert.equal(eingang(1).frei_fuer_cypher, true);
  assert.equal(eingang(2).frei_fuer_cypher, false);

  await ruft('proj_neu', { name: 'Hand rec' });
  await aendern('setup', [{ befehl: 'tempo_setzen', bpm: 120 }, { befehl: 'spur_neu', art: 'audio', name: 'Vox' }]);
  const spur = (await ruft('proj_lage', {})).projekt.spuren.find((s) => s.name === 'Vox');
  assert.ok(spur, 'the track exists');
  // an input without release is refused at the start, not at the arm: first the released external input with mode and monitor
  await aendern('input', [{ befehl: 'spur_aendern', spur_id: spur.id, eingang: { art: 'extern', paar: 1, modus: 'links' }, arm: true, monitor: 'ein' }]);
  const aktuell = async () => (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  const e1 = (await aktuell()).spuren[0].aufnahme;
  assert.deepEqual([e1.scharf, e1.eingang, e1.monitor], [true, { art: 'extern', paar: 1, modus: 'links' }, 'ein']);
  let kern = null;
  for (let i = 0; i < 100 && !(kern = anKern(log, '/k/rec/spur').at(-1)); i++) await warte(20);
  assert.deepEqual([kern.felder.scharf, kern.felder.eingang, kern.felder.modus, kern.felder.monitor], [1, 1, 1, 2], 'the core got arm, ein_1, mode L, monitor IN');
  // then the internal tap for the take (the stand-in has no device behind ein_1), count-in off
  await aendern('tap', [{ befehl: 'spur_aendern', spur_id: spur.id, eingang: { art: 'intern', name: 'erz/1' }, arm: true }, { befehl: 'aufnahme_setzen', vorzaehler_takte: 0 }]);
  const a = (await aktuell()).aufnahme;
  assert.equal(a.vorzaehler_takte, 0);
  // the run
  const start = await ruft('proj_aufnahme', { aktion: 'start' });
  assert.equal(start.aufnahme, 'laeuft');
  assert.equal(start.spuren[0].id, spur.id);
  await warte(1200);
  const stopp = await ruft('proj_aufnahme', { aktion: 'stopp' });
  assert.equal(stopp.takes.length, 1);
  assert.equal(stopp.takes[0].spur_id, spur.id);
  assert.ok(!stopp.takes[0].fehler && stopp.takes[0].frames > 0, JSON.stringify(stopp.takes[0]));
  // the take sits in the project and in the history, from Cypher
  const lage = await ruft('proj_lage', {});
  const clips = lage.projekt.spuren.find((s) => s.id === spur.id).clips;
  assert.equal(clips.length, 1);
  assert.equal(clips[0].art, 'audio');
  const verlauf = await ruft('proj_verlauf', {});
  const eintraege = Array.isArray(verlauf) ? verlauf : verlauf.eintraege;
  const letzter = eintraege.at(-1);
  assert.deepEqual([letzter.quelle, /^Record /.test(letzter.label)], ['cypher', true], JSON.stringify(letzter));
  // control: a second start while nothing is armed any more is refused with nichts_scharf (a tool error with the reason)
  await aendern('disarm', [{ befehl: 'spur_aendern', spur_id: spur.id, arm: false }]);
  const nein = await c.callTool({ name: 'proj_aufnahme', arguments: { aktion: 'start' } });
  assert.equal(nein.isError, true);
  assert.match(nein.content[0].text, /nichts_scharf/);
});

// 1.10 slice 6, T1: proj_routing is a read (GET /proj/routing, source cypher, no guard); stufe becomes ?optionen=; the description names stufe and the five
// reasons; an unknown stage (400 argument_ungueltig) is a tool error that carries the reason.
test('1.10 T1 djk-hand proj_routing: GET /proj/routing, stufe -> ?optionen=, the description names stufe and the reasons, a 400 is a tool error', async (t) => {
  const matrix = { slug: 'p', rev: 3, ziele: [{ wert: 'master', name: 'Master' }], returns: [], straenge: [] };
  const { c, gesehen } = await aufbau(t, (m, u) => {
    if (u === '/proj/routing') return [200, matrix];
    if (u === '/proj/routing?optionen=i1') return [200, { ...matrix, straenge: [{ id: 's1' }] }];
    if (u === '/proj/routing?optionen=i9') return [400, { fehler: 'argument_ungueltig', text: 'optionen: no stage i9' }];
  });
  const namen = (await c.listTools()).tools.map((x) => x.name);
  assert.deepEqual(namen.sort(), [...NAMEN].sort());
  assert.ok(namen.includes('proj_routing'));
  const t1 = (await c.listTools()).tools.find((x) => x.name === 'proj_routing');
  for (const wort of ['stufe', 'routing_zyklus', 'routing_grenze', 'sidechain_spaet', 'sidechain_zyklus', 'sidechain_quelle']) {
    assert.ok(t1.description.includes(wort), `proj_routing names ${wort}`);
  }
  const a = await c.callTool({ name: 'proj_routing', arguments: {} });
  assert.ok(!a.isError, a.content[0].text);
  assert.deepEqual(JSON.parse(a.content[0].text), matrix);
  const b = await c.callTool({ name: 'proj_routing', arguments: { stufe: 'i1' } });
  assert.deepEqual(JSON.parse(b.content[0].text).straenge, [{ id: 's1' }]);
  const e = await c.callTool({ name: 'proj_routing', arguments: { stufe: 'i9' } });
  assert.equal(e.isError, true); assert.match(e.content[0].text, /argument_ungueltig/);
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.quelle]),
    [['GET', '/proj/routing', 'cypher'], ['GET', '/proj/routing?optionen=i1', 'cypher'], ['GET', '/proj/routing?optionen=i9', 'cypher']]);
});

// 1.10 slice 7, T6: proj_resample posts /proj/resample with only the given fields (source cypher), waits like proj_freeze (frist_ms is its own entry), answers the
// narrow result; the description names the reasons and says that the monitor of an armed track is part of post and not of pre; a refusal is a tool error.
test('1.10 T6 djk-hand proj_resample: POST /proj/resample, only the given fields, the description names reasons and the monitor rule, a refusal is a tool error', async (t) => {
  const antwort = { rev: 9, spur_id: 's5', clip_id: 'c7', datei: '/p/resample/resample-4.wav', frames: 192000, quelle: 's2', punkt: 'post', von_beat: 0, bis_beat: 8 };
  const { c, gesehen } = await aufbau(t, (m, u, k) => {
    if (u === '/proj/resample' && k?.strang_id === 'g9') return [404, { fehler: 'spur_unbekannt', text: 'there is no strip g9' }];
    if (u === '/proj/resample' && k?.strang_id === 's9') return [409, { fehler: 'resample_leer', text: 'Bass is silent in beat 0 to 8' }];
    if (u === '/proj/resample') return [200, antwort];
  });
  const namen = (await c.listTools()).tools.map((x) => x.name);
  assert.deepEqual(namen.sort(), [...NAMEN].sort());
  assert.ok(namen.includes('proj_resample'));
  const w = (await c.listTools()).tools.find((x) => x.name === 'proj_resample');
  for (const wort of ['resample_leer', 'resample_fehler', 'ki_gestoppt', 'transport_laeuft', 'beschaeftigt', 'nicht_geladen', 'kein_kernstand', 'zu_gross', 'export_bereich',
    'veraltet', 'spur_unbekannt', 'merge_keine_spur_frei', 'wirt_fehlt', 'wirt_fehler', 'hand_frist', 'master', 'resampled', 'ONE undo step']) {
    assert.ok(w.description.includes(wort), `proj_resample names ${wort}`);
  }
  assert.match(w.description, /monitor of an armed track is part of a `post` resample and not of a `pre` one/);
  assert.deepEqual(w.inputSchema.required, ['strang_id']);
  assert.deepEqual(Object.keys(w.inputSchema.properties).sort(), ['bis_beat', 'punkt', 'strang_id', 'von_beat']);
  const a = await c.callTool({ name: 'proj_resample', arguments: { strang_id: 's2' } });
  assert.ok(!a.isError, a.content[0].text);
  assert.deepEqual(JSON.parse(a.content[0].text), antwort);
  const b = await c.callTool({ name: 'proj_resample', arguments: { strang_id: 'master', punkt: 'pre', von_beat: 4, bis_beat: 12 } });
  assert.ok(!b.isError);
  const e1 = await c.callTool({ name: 'proj_resample', arguments: { strang_id: 'g9' } });
  assert.equal(e1.isError, true); assert.match(e1.content[0].text, /spur_unbekannt/);
  const e2 = await c.callTool({ name: 'proj_resample', arguments: { strang_id: 's9' } });
  assert.equal(e2.isError, true); assert.match(e2.content[0].text, /resample_leer/);
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.quelle, x.koerper]), [
    ['POST', '/proj/resample', 'cypher', { strang_id: 's2' }],
    ['POST', '/proj/resample', 'cypher', { strang_id: 'master', punkt: 'pre', von_beat: 4, bis_beat: 12 }],
    ['POST', '/proj/resample', 'cypher', { strang_id: 'g9' }],
    ['POST', '/proj/resample', 'cypher', { strang_id: 's9' }]]);
});

// 1.10 slice 7 (T7, D12): proj_lage passes /proj/aktuell through, so kern.limiter_db arrives as the server says it; the text names it and the tap status
test('djk-hand (1.10 T7): proj_lage names kern.limiter_db and passes it through; a tool it does not concern does not', async (t) => {
  const { c } = await aufbau(t, (m, u) => {
    if (u === '/proj/aktuell?noten=zahl') return [200, { slug: 'p', projekt: { rev: 4, name: 'P' }, kern: { rev_geladen: 3, status: 0, limiter_db: -2.5 } }];
  });
  const text = (await c.listTools()).tools.find((x) => x.name === 'proj_lage').description;
  assert.match(text, /kern\.limiter_db = gain reduction of the set limiter in dB/);
  assert.match(text, /3 a freeze or resample tap runs/);
  assert.equal(JSON.parse((await c.callTool({ name: 'proj_lage', arguments: {} })).content[0].text).kern.limiter_db, -2.5);
  const andere = (await c.listTools()).tools.find((x) => x.name === 'proj_transport').description;
  assert.doesNotMatch(andere, /limiter_db/);
});

test('djk-hand proj_aendern names the instrument rack: three commands, art rack, the limits and the five reasons; AUFRUF.md in both languages says the same (1.9 T6)', async (t) => {
  const { c } = await aufbau(t, () => [200, {}]);
  const werkzeuge = (await c.listTools()).tools;
  const d = werkzeuge.find((x) => x.name === 'proj_aendern').description;
  for (const b of ['rack_glied_setzen', 'rack_glied_entfernen', 'rack_kette']) assert.ok(d.includes(b), b);
  assert.ok(d.includes("art: 'rack'"), "art: 'rack'");
  for (const g of ['keine_rackspur', 'rack_voll_glieder', 'glied_unbekannt', 'rack_letztes_glied', 'slot_belegt']) assert.match(d, new RegExp(`${g} \\(`), g);
  assert.match(d, /at most 4 members/);
  assert.match(d, /RB-338, a bk graph, a kit or a Surge slot/);
  assert.match(d, /zones \[lo, hi\]/);
  assert.ok(!d.includes('insert chain', d.indexOf('Instrument rack')), 'a member kette is a zone, not an insert chain');
  const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  for (const datei of ['djk/hand/AUFRUF.md', 'docs/veroeffentlichung/englisch/djk/hand/AUFRUF.md'].filter((x) => fs.existsSync(path.join(wurzel, x)))) {
    const md = fs.readFileSync(path.join(wurzel, datei), 'utf8');
    for (const b of ['rack_glied_setzen', 'rack_glied_entfernen', 'rack_kette', 'keine_rackspur', 'slot_belegt']) assert.ok(md.includes(b), `${datei} ${b}`);
    const absatz = md.slice(md.indexOf('**Instrument rack**'), md.indexOf('**Instrument rack**') + 2500);
    assert.ok(md.includes('**Instrument rack**') && /a bk graph, a kit or a Surge slot/.test(absatz) && /\[lo, hi\]/.test(absatz), `${datei} members and zones`);
    assert.ok(!/insert chain/.test(absatz.split('\n\n')[0]), `${datei}: kette is no insert chain`);
  }
  // negative control: a tool that has nothing to do with it does not carry the words
  assert.doesNotMatch(werkzeuge.find((x) => x.name === 'proj_lage').description, /rack_glied|rack_kette|keine_rackspur/);
});

test('djk-hand proj_aendern names member macro targets and the three variation commands; AUFRUF.md in both languages says the same (1.9 T11)', async (t) => {
  const { c } = await aufbau(t, () => [200, {}]);
  const werkzeuge = (await c.listTools()).tools;
  const d = werkzeuge.find((x) => x.name === 'proj_aendern').description;
  for (const b of ['makro_variation_speichern', 'makro_variation_laden', 'makro_variation_loeschen']) assert.ok(d.includes(b), b);
  for (const g of ['variation_voll', 'variation_unbekannt', 'glied_ohne_rack', 'makro_ziel_wirt']) assert.ok(d.includes(g), g);
  assert.match(d, /\{glied \(a member id g1\.\.g4/);
  assert.match(d, /gain_db of any internal member/);
  assert.match(d, /no mapping at all removes the rack and with it its variations/);
  const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  for (const datei of ['djk/hand/AUFRUF.md', 'docs/veroeffentlichung/englisch/djk/hand/AUFRUF.md'].filter((x) => fs.existsSync(path.join(wurzel, x)))) {
    const md = fs.readFileSync(path.join(wurzel, datei), 'utf8');
    for (const b of ['makro_variation_speichern', 'makro_variation_laden', 'makro_variation_loeschen', 'variation_voll', 'variation_unbekannt', 'glied_ohne_rack', 'makro_ziel_wirt', '{glied, param, von, bis}']) {
      assert.ok(md.includes(b), `${datei} ${b}`);
    }
  }
  assert.equal(werkzeuge.length, 66 + 6 + 1 + 1 + 1 + 1 + 1 + 1 /* MIDI import: proj_midi_import */ + 1 /* strudel-clip: proj_muster */, 'no tool was added');
  // negative control: a tool that has nothing to do with it does not carry the words
  assert.doesNotMatch(werkzeuge.find((x) => x.name === 'proj_lage').description, /makro_variation/);
});

test('djk-hand proj_midi_import (MIDI import): the preview posts vorschau without rev, the import posts the current rev and the options as given; refusals are tool errors with the reason', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u, k) => {
    if (u === '/proj/aktuell?nur=rev') return [200, { rev: 7 }];
    if (u.startsWith('/proj/midi_import')) {
      if (k.pfad === '/x/viele.mid') return [409, { fehler: 'midi_zu_viele_spuren', text: 'too few free tracks', detail: '33 tracks needed but only 32 of 32 are free' }];
      return [200, k.vorschau ? { vorschau: true, bericht: { summe: { spuren: 2 } } } : { rev: 8, angelegt: [{ schluessel: '1.1', spur_id: 's1', clip_id: 'c1' }], bericht: {} }];
    }
  });
  const v = await c.callTool({ name: 'proj_midi_import', arguments: { pfad: '/x/a.mid', vorschau: true } });
  assert.ok(!v.isError, JSON.stringify(v));
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.koerper]), [['POST', '/proj/midi_import', { pfad: '/x/a.mid', vorschau: true }]]);
  const r = await c.callTool({ name: 'proj_midi_import', arguments: { pfad: '/x/a.mid', auswahl: ['1.1'], zuordnung: { '1.1': 'kit:gm' }, tempo: 'uebernehmen', profil: 'poly', label: 'Test' } });
  assert.ok(!r.isError, JSON.stringify(r));
  assert.equal(JSON.parse(r.content[0].text).angelegt[0].spur_id, 's1');
  const post = gesehen.at(-1);
  assert.equal(post.pfad, '/proj/midi_import?antwort=kurz');
  assert.deepEqual(post.koerper, { pfad: '/x/a.mid', auswahl: ['1.1'], zuordnung: { '1.1': 'kit:gm' }, tempo: 'uebernehmen', profil: 'poly', label: 'Test', rev: 7 });
  assert.ok(gesehen.every((x) => x.quelle === 'cypher'));
  const e = await c.callTool({ name: 'proj_midi_import', arguments: { pfad: '/x/viele.mid', rev: 3 } });
  assert.equal(e.isError, true); assert.match(e.content[0].text, /midi_zu_viele_spuren/); assert.match(e.content[0].text, /33 tracks needed/);
  assert.equal(gesehen.at(-1).koerper.rev, 3);
  const w = (await c.listTools()).tools.find((x) => x.name === 'proj_midi_import');
  for (const wort of ['ONE undo step', 'midi_zu_viele_spuren', 'RB-338', 'ONE note at a time', 'taktart', 'zuordnung', 'vorschau', '4/4']) assert.ok(w.description.includes(wort), `description names ${wort}`);
  assert.deepEqual(w.inputSchema.required, ['pfad']);
});
