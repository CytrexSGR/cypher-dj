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
  'studio', 'loops', 'rec', 'loop_klang', 'spur', 'spur_stopp', 'spuren', 'stille', 'pegel', 'klang', 'instrumente', 'bibliothek', 'klaenge', 'bestand_karte', 'vorbereiten',
  'sets', 'set_zeige', 'set_lege', 'set_vorbereiten', 'tempo'];

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
    if (m === 'GET' && u === '/sammlungen') return [200, [{ slug: 'a', name: 'A', posten: 1 }]];
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
