// djk-hand über stdio mit dem SDK-Client, gegen eine Seiten-Attrappe (HTTP): Werkzeugliste, Quellkopf, Fehlerabbildung.
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
  'studio', 'loops', 'rec', 'loop_klang', 'spur', 'spur_stopp', 'spuren', 'stille', 'pegel', 'klang', 'instrumente', 'bibliothek', 'anschluss', 'stoebern', 'klaenge', 'bestand_karte', 'vorbereiten',
  'sets', 'set_zeige', 'set_lege', 'set_vorbereiten', 'tempo',
  'proj_liste', 'proj_neu', 'proj_oeffnen', 'proj_lage', 'proj_aendern', 'proj_undo', 'proj_redo', 'proj_verlauf', 'proj_transport', 'proj_freeze', 'proj_export', 'proj_lautheit', 'geraete_lage', 'proj_aufnahme', 'proj_warp', 'proj_stems', 'proj_stems_abbrechen'];   // D1 S2 (Spec 3.5), Paket 1.18 E-b, Paket 1.13 Warp, Slice 6 Stems

async function aufbau(t, antworten, env) {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      gesehen.push({ methode: q.method, pfad: q.url, quelle: q.headers['x-djk-quelle'], koerper: b ? JSON.parse(b) : null });
      const [code, j] = antworten(q.method, q.url) ?? [404, { fehler: 'unbekannt' }];
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

test('djk-hand: strudel sendet strom (Vorgabe 1), Strom 2 wird durchgereicht, Schema nennt nur 1 bis 3', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/strudel' ? [200, { ok: true }] : null));
  const r1 = await c.callTool({ name: 'strudel', arguments: { code: 's("bd")' } });
  assert.ok(!r1.isError, r1.content[0].text);
  const r2 = await c.callTool({ name: 'strudel', arguments: { code: 's("bd")', strom: 2 } });
  assert.ok(!r2.isError, r2.content[0].text);
  const k = gesehen.filter((x) => x.pfad === '/strudel').map((x) => x.koerper);
  assert.deepEqual(k, [{ text: 's("bd")', strom: 1 }, { text: 's("bd")', strom: 2 }]);
  const schema = (await c.listTools()).tools.find((x) => x.name === 'strudel').inputSchema;
  assert.deepEqual(schema.properties.strom.enum, [1, 2, 3]);
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
  assert.deepEqual(gesehen.map((x) => x.pfad), ['/strudel?strom=1', '/strudel?strom=2', '/strudel?strom=3']);
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
  assert.deepEqual(gesehen.map((x) => x.koerper), [1, 2, 3].map((strom) => ({ text: 'silence', strom })));
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
  assert.match(d, /wirt \(surge, slot 1\)/, 'Fix2 F10: in D1 ein Surge-Slot');
  assert.doesNotMatch(d, /slot 1\|2/);
  assert.match(d, /clip_neu \{[^}]*loop_beats\? \(null or missing = off, else 1\/16\.\.laenge_beats[^}]*name\?/);
  assert.match(d, /gain_db\? \(-96\.\.24\)/);
  assert.match(d, /fade_aus_beats\? \(fades >= 0, together at most laenge_beats\)/);
  assert.match(d, /fader_db\? \(-200\.\.6\)/);
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
  const { FREEZE_MAX_BEATS, FREEZE_NACHLAUF_BEATS } = await import('../../oberflaeche/projekt/freeze.ts');
  // längste erlaubte Dauer nach den Grenzen des Servers (bereiche/proj/ausgabe.ts, sitzung.ts, lautheit.ts, befehle.ts TEMPO_MIN 60):
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

test('S6: proj_stems reicht Ablehnungen als Werkzeugfehler durch (stems_quantum)', async (t) => {
  const ablehnung = [409, { fehler: 'stems_quantum', text: 'stems run only at the core quantum 256' }];
  const { c } = await aufbau(t, (m, u) => (u === '/proj/stems' ? ablehnung : undefined));
  const r = await c.callTool({ name: 'proj_stems', arguments: { clip_id: 'c1' } });
  assert.equal(r.isError, true);
  assert.equal(JSON.parse(r.content[0].text).fehler, 'stems_quantum');
});

test('S6: Beschreibungen nennen die Gründe und das Feld stumm (Pin)', async (t) => {
  const { c } = await aufbau(t, () => undefined);
  const T = Object.fromEntries((await c.listTools()).tools.map((x) => [x.name, x.description]));
  for (const g of ['stems_quantum', 'nur_andreas_spur', 'stems_gpu_aus', 'ki_gestoppt', 'stems_loop']) assert.match(T.proj_stems, new RegExp(g), g);
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
