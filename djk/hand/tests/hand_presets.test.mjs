// Package 1.16 rest U5: the six hand tools for presets and collections (presets_suchen, presets_lesen, presets_speichern,
// presets_anwenden, kollektionen, kollektion_aendern). The hand talks to the page server over HTTP only; here it is driven over stdio
// with the SDK client against (a) a recording stand-in server and (b) the REAL /presets and /kollektionen routes (Router, same dispatch as
// server.ts) so the schema, the plan and the refusals are the ones the page server really gives.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Router } from '../../ui/http/router.ts';
import { json, postAbgewiesen } from '../../ui/http/transport.ts';
import { presetsBereich } from '../../ui/presets/area.ts';
import { kollektionenBereich } from '../../ui/collections/area.ts';
import { neuesProjekt } from '../../ui/project/model.ts';
import { fuehreListeAus } from '../../ui/project/commands.ts';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');
const SECHS = ['presets_suchen', 'presets_lesen', 'presets_speichern', 'presets_anwenden', 'kollektionen', 'kollektion_aendern'];

// A recording stand-in: answers(method, url, body) → [code, json] or null (404)
async function aufbau(t, antworten) {
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
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${s.address().port}`] }));
  t.after(async () => { await c.close(); s.close(); });
  return { c, gesehen };
}
const text = (r) => r.content[0].text;
const tool = async (c, name) => (await c.listTools()).tools.find((x) => x.name === name);

// The real routes behind one server; anything else goes to `rest` (a stand-in for /proj, /regler)
async function echterStapel(t, rest, { projekt = null, quelle = 'andreas' } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hand-presets-'));
  const router = new Router();
  const ctx = { log: () => {}, quelle: () => quelle };
  router.melde(presetsBereich(ctx, { nutzer: path.join(d, 'user'), projekt: () => projekt, graphen: () => [] }));
  router.melde(kollektionenBereich(ctx, { ordner: path.join(d, 'koll') }));
  const gesehen = [];
  let port = 0;
  const server = http.createServer(async (q, a) => {
    const url = new URL(q.url ?? '/', 'http://127.0.0.1');
    const r = router.finde(q.method ?? '', url.pathname);
    if (!r) {
      let b = ''; for await (const ch of q) b += ch;
      gesehen.push({ methode: q.method, pfad: q.url, koerper: b ? JSON.parse(b) : null });
      const [code, j] = rest(q.method, q.url, gesehen[gesehen.length - 1].koerper) ?? [404, { fehler: 'keine_route' }];
      return json(a, code, j);
    }
    if (r.schutz === 'fremdePost' && q.method === 'POST' && postAbgewiesen(q, a, port)) return;
    gesehen.push({ methode: q.method, pfad: q.url });
    await r.handler(q, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  const url = `http://127.0.0.1:${port}`;
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', url] }));
  t.after(async () => { await c.close(); server.close(); fs.rmSync(d, { recursive: true, force: true }); });
  return { c, gesehen, url };
}

test('U5: tools/list carries the six new tools, each with an object schema and an English description', async (t) => {
  const { c } = await aufbau(t, () => null);
  const tools = (await c.listTools()).tools;
  for (const n of SECHS) {
    const w = tools.find((x) => x.name === n);
    assert.ok(w, `${n} is listed`);
    assert.equal(w.inputSchema.type, 'object', n);
    assert.ok(w.description.length > 80, `${n} has a description`);
  }
  // negative control: a name that does not exist is not listed
  assert.equal(tools.find((x) => x.name === 'presets_suche'), undefined, 'C1: 1.9\'s name presets_suche does not exist next to presets_suchen');
});

test('presets_suchen: the input schema equals GET /presets/suche/schema of a real presetsBereich (cannot drift); the call is POST /presets/suche', async (t) => {
  const { c, gesehen, url } = await echterStapel(t, () => null);
  const echt = (await (await fetch(`${url}/presets/suche/schema`)).json());
  const w = await tool(c, 'presets_suchen');
  assert.deepEqual(w.inputSchema, echt.input_schema);
  assert.ok(w.description.includes(echt.description.slice(0, 120)), 'description starts from the server definition');
  // negative control: the comparison does see a drifted enum
  const gedriftet = structuredClone(w.inputSchema); gedriftet.properties.art.items.enum.push('erfunden');
  assert.throws(() => assert.deepEqual(gedriftet, echt.input_schema), assert.AssertionError);
  const r = await c.callTool({ name: 'presets_suchen', arguments: { art: ['bass'] } });
  assert.ok(!r.isError, text(r));
  const j = JSON.parse(text(r));
  // the register holds bass presets of several devices (rb338 and the Cypher Modular baukasten); the unfiltered count follows the register
  assert.ok(j.gesamt > 7, `bass presets of more than one device, got ${j.gesamt}`);
  assert.ok(j.treffer.every((x) => x.art === 'bass'));
  assert.ok(new Set(j.treffer.map((x) => x.geraet)).size > 1, 'bass presets come from more than one device');
  const rb = JSON.parse(text(await c.callTool({ name: 'presets_suchen', arguments: { art: ['bass'], geraet: ['rb338'] } })));
  assert.equal(rb.gesamt, 7);
  assert.ok(rb.treffer.every((x) => x.art === 'bass' && x.geraet === 'rb338'));
  assert.ok(gesehen.some((x) => x.methode === 'POST' && x.pfad === '/presets/suche'));
});

test('presets_suchen: sends the query unchanged with x-djk-quelle cypher; a refused word comes back with erlaubt (negative control: a good query has no error)', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u, k) => (u === '/presets/suche'
    ? (k.charakter?.[0] === 'erfunden'
      ? [400, { fehler: 'anfrage_ungueltig', text: 'the query has words outside the vocabulary', details: [{ feld: 'charakter', code: 'wort_unbekannt', wert: 'erfunden', erlaubt: ['warm', 'dirty'] }] }]
      : [200, { gesamt: 0, treffer: [] }]) : null));
  const gut = await c.callTool({ name: 'presets_suchen', arguments: { familie: 'effekt', text: 'tape' } });
  assert.ok(!gut.isError, text(gut));
  assert.deepEqual(gesehen[0].koerper, { familie: 'effekt', text: 'tape' });
  assert.equal(gesehen[0].quelle, 'cypher');
  const schlecht = await c.callTool({ name: 'presets_suchen', arguments: { charakter: ['erfunden'] } });
  assert.equal(schlecht.isError, true);
  assert.match(text(schlecht), /erlaubt/);
  assert.match(text(schlecht), /wort_unbekannt/);
  assert.match(text(schlecht), /warm/);
});

test('presets_lesen: a register id becomes GET /presets/<herkunft>/<geraet>/<slug>; a malformed id is a tool error and nothing is sent', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/presets/werk/komp/drum-bus' ? [200, { name: 'Drum Bus', werte: { thresh: -18 } }] : null));
  const ok = await c.callTool({ name: 'presets_lesen', arguments: { id: 'werk:komp/drum-bus' } });
  assert.ok(!ok.isError, text(ok));
  assert.equal(JSON.parse(text(ok)).name, 'Drum Bus');
  assert.deepEqual(gesehen.map((x) => [x.methode, x.pfad, x.quelle]), [['GET', '/presets/werk/komp/drum-bus', 'cypher']]);
  const vorher = gesehen.length;
  for (const id of ['werk:komp', 'komp/drum-bus', 'fremd:komp/x', 'werk:komp/../x', 'werk:Komp/x', 'werk:komp/-x', '', 'nutzer:komp/a b']) {
    const r = await c.callTool({ name: 'presets_lesen', arguments: { id } });
    assert.equal(r.isError, true, `id ${JSON.stringify(id)} refused`);
    assert.match(text(r), /preset_id_ungueltig/);
  }
  assert.equal((await c.callTool({ name: 'presets_lesen', arguments: {} })).isError, true, 'no id at all');
  assert.equal(gesehen.length, vorher, 'no request left for the malformed ids');
});

test('presets_lesen: a hyphenated device id (kanal-limiter style) and a user preset are read; an unknown preset is the server refusal as a tool error', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/presets/nutzer/kanal-limiter/mein-x' ? [200, { name: 'Mein X' }]
    : u.startsWith('/presets/factory/comp/') ? [404, { fehler: 'preset_unbekannt', text: 'no such preset' }] : null));
  const ok = await c.callTool({ name: 'presets_lesen', arguments: { id: 'nutzer:kanal-limiter/mein-x' } });
  assert.ok(!ok.isError, text(ok));
  const nein = await c.callTool({ name: 'presets_lesen', arguments: { id: 'werk:komp/gibt-es-nicht' } });
  assert.equal(nein.isError, true);
  assert.match(text(nein), /preset_unbekannt/);
  assert.equal(gesehen.length, 2);
});

test('presets_speichern: werte → POST /presets, ziel → POST /presets/von_ziel; exactly one of the two, else a tool error and nothing is sent', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/presets' ? [201, { herkunft: 'nutzer', geraet: 'komp', slug: 'mein-glue' }]
    : u === '/presets/von_ziel' ? [201, { herkunft: 'nutzer', geraet: 'rb338', slug: 'mein-bass' }] : null));
  const beschr = { art: 'compressor', unterart: 'peak', charakter: ['clean'], genre: [], einsatz: ['mixdown'], energie: 2, text: 'Peak control.' };
  const a = await c.callTool({ name: 'presets_speichern', arguments: { name: 'Mein Glue', geraet: 'komp', beschreibung: beschr, werte: { thresh: -18 }, tags: ['glue'], notiz: 'n', ueberschreiben: true } });
  assert.ok(!a.isError, text(a));
  assert.deepEqual(gesehen[0], { methode: 'POST', pfad: '/presets', quelle: 'cypher',
    koerper: { name: 'Mein Glue', geraet: 'komp', beschreibung: beschr, werte: { thresh: -18 }, tags: ['glue'], notiz: 'n', ueberschreiben: true } });
  const b = await c.callTool({ name: 'presets_speichern', arguments: { name: 'Mein Bass', beschreibung: beschr, ziel: { art: 'spur', spur_id: 's1' } } });
  assert.ok(!b.isError, text(b));
  assert.deepEqual(gesehen[1].koerper, { ziel: { art: 'spur', spur_id: 's1' }, name: 'Mein Bass', beschreibung: beschr });
  assert.equal(gesehen[1].pfad, '/presets/von_ziel');
  const n = gesehen.length;
  const beide = await c.callTool({ name: 'presets_speichern', arguments: { name: 'X', geraet: 'komp', beschreibung: beschr, werte: {}, ziel: { art: 'spur', spur_id: 's1' } } });
  const keins = await c.callTool({ name: 'presets_speichern', arguments: { name: 'X', geraet: 'komp', beschreibung: beschr } });
  const ohneGeraet = await c.callTool({ name: 'presets_speichern', arguments: { name: 'X', beschreibung: beschr, werte: {} } });
  const zielMitGeraet = await c.callTool({ name: 'presets_speichern', arguments: { name: 'X', geraet: 'komp', beschreibung: beschr, ziel: { art: 'spur', spur_id: 's1' } } });
  for (const r of [beide, keins, ohneGeraet, zielMitGeraet]) assert.equal(r.isError, true, text(r));
  assert.match(text(beide), /werte_oder_ziel/);
  assert.match(text(keins), /werte_oder_ziel/);
  assert.match(text(ohneGeraet), /geraet_fehlt/);
  assert.match(text(zielMitGeraet), /geraet_aus_ziel/);
  assert.equal(gesehen.length, n, 'refused locally: no request');
});

test('presets_speichern: refused vocabulary words come back with erlaubt; Cypher overwriting an Andreas preset is nur_andreas_preset (403) as a tool error', async (t) => {
  const { c } = await aufbau(t, (m, u, k) => (u === '/presets'
    ? (k.name === 'Fremd' ? [403, { fehler: 'nur_andreas_preset', text: 'Cypher may overwrite only presets she saved' }]
      : k.beschreibung.art === 'erfunden' ? [400, { fehler: 'beschreibung_ungueltig', text: 'the description has words outside the vocabulary', details: [{ feld: 'art', code: 'wort_unbekannt', wert: 'erfunden', erlaubt: ['bass', 'lead'] }] }]
        : [201, { slug: 'x' }]) : null));
  const b = { art: 'bass', unterart: 'acid', charakter: ['dirty'], genre: [], einsatz: ['drop'], energie: 4, text: 't' };
  const falsch = await c.callTool({ name: 'presets_speichern', arguments: { name: 'N', geraet: 'rb338', beschreibung: { ...b, art: 'erfunden' }, werte: {} } });
  assert.equal(falsch.isError, true);
  assert.match(text(falsch), /"erlaubt":\["bass","lead"\]/);
  const fremd = await c.callTool({ name: 'presets_speichern', arguments: { name: 'Fremd', geraet: 'rb338', beschreibung: b, werte: {}, ueberschreiben: true } });
  assert.equal(fremd.isError, true);
  assert.match(text(fremd), /nur_andreas_preset/);
  const gut = await c.callTool({ name: 'presets_speichern', arguments: { name: 'N', geraet: 'rb338', beschreibung: b, werte: {} } });
  assert.ok(!gut.isError, text(gut));
});

const PLAN_PROJ = { weg: 'proj', label: 'Preset Drum Bus', uebersprungen: ['extsc'], hinweise: ['freeze_geht'],
  befehle: [{ befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { schwelle: -18 }, preset: 'werk:komp/drum-bus' }] };
const PLAN_REGLER = { weg: 'regler', uebersprungen: ['knee'], anfragen: [{ pfad: 'deck/1/komp/schwelle', nach: -18 }, { pfad: 'deck/1/komp/ratio', nach: 4 }, { pfad: 'deck/1/komp/attack', nach: 30 }] };

test('presets_anwenden weg proj: POST /presets/anwenden, then ONE /proj/aendern {rev, label, befehle}; the answer carries uebersprungen and hinweise', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/presets/anwenden' ? [200, PLAN_PROJ]
    : u === '/proj/aktuell?nur=rev' ? [200, { rev: 7 }]
      : u === '/proj/aendern?antwort=kurz' ? [200, { rev: 8, kern: { ok: true } }] : null));
  const r = await c.callTool({ name: 'presets_anwenden', arguments: { id: 'werk:komp/drum-bus', ziel: { art: 'insert', insert_id: 'i1' } } });
  assert.ok(!r.isError, text(r));
  assert.deepEqual(gesehen.map((x) => `${x.methode} ${x.pfad}`), ['POST /presets/anwenden', 'GET /proj/aktuell?nur=rev', 'POST /proj/aendern?antwort=kurz']);
  assert.deepEqual(gesehen[0].koerper, { id: 'werk:komp/drum-bus', ziel: { art: 'insert', insert_id: 'i1' } });
  assert.deepEqual(gesehen[2].koerper, { label: 'Preset Drum Bus', befehle: PLAN_PROJ.befehle, rev: 7 });
  assert.ok(gesehen.every((x) => x.quelle === 'cypher'));
  const j = JSON.parse(text(r));
  assert.equal(j.weg, 'proj');
  assert.deepEqual(j.uebersprungen, ['extsc']);
  assert.deepEqual(j.hinweise, ['freeze_geht']);
  assert.equal(j.rev, 8);
  // a given rev is used as is (no /proj/aktuell)
  gesehen.length = 0;
  const r2 = await c.callTool({ name: 'presets_anwenden', arguments: { id: 'werk:komp/drum-bus', ziel: { art: 'insert', insert_id: 'i1' }, rev: 3 } });
  assert.ok(!r2.isError, text(r2));
  assert.deepEqual(gesehen.map((x) => x.pfad), ['/presets/anwenden', '/proj/aendern?antwort=kurz']);
  assert.equal(gesehen[1].koerper.rev, 3);
});

test('presets_anwenden: a refused plan (kein_ziel) sends NO /proj/aendern and NO /regler; negative control: the same call with a good plan sends them', async (t) => {
  let plan = [409, { fehler: 'kein_ziel', text: 'this device has no running instance in PRODUCTION' }];
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/presets/anwenden' ? plan : u === '/proj/aktuell?nur=rev' ? [200, { rev: 1 }]
    : u.startsWith('/proj/aendern') ? [200, { rev: 2 }] : u === '/regler' ? [200, { ok: true, quittung: { status: 2, grund: '' } }] : null));
  const nein = await c.callTool({ name: 'presets_anwenden', arguments: { id: 'werk:hall/dark-dub', ziel: { art: 'spur', spur_id: 's1' } } });
  assert.equal(nein.isError, true);
  assert.match(text(nein), /kein_ziel/);
  assert.deepEqual(gesehen.map((x) => x.pfad), ['/presets/anwenden'], 'only the plan request left');
  plan = [200, PLAN_PROJ];
  const ja = await c.callTool({ name: 'presets_anwenden', arguments: { id: 'werk:komp/drum-bus', ziel: { art: 'insert', insert_id: 'i1' } } });
  assert.ok(!ja.isError, text(ja));
  assert.ok(gesehen.some((x) => x.pfad.startsWith('/proj/aendern')), 'negative control: a good plan does send');
});

test('presets_anwenden weg regler: one POST /regler {pfad, nach, ab: jetzt} per request in order; stops at the first refusal and reports which were sent', async (t) => {
  let n = 0, refus = null;
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/presets/anwenden' ? [200, PLAN_REGLER]
    : u === '/regler' ? (++n === refus ? [200, { ok: true, quittung: { status: 6, grund: 'nur_hand' } }] : [200, { ok: true, quittung: { status: 2, grund: '' } }]) : null));
  const ok = await c.callTool({ name: 'presets_anwenden', arguments: { id: 'werk:komp/drum-bus', ziel: { art: 'kanal', kanal: 'deck/1' } } });
  assert.ok(!ok.isError, text(ok));
  assert.deepEqual(gesehen.filter((x) => x.pfad === '/regler').map((x) => x.koerper),
    PLAN_REGLER.anfragen.map((a) => ({ pfad: a.pfad, nach: a.nach, ab: 'jetzt' })));
  const j = JSON.parse(text(ok));
  assert.equal(j.weg, 'regler');
  assert.equal(j.gesendet, 3);
  assert.deepEqual(j.uebersprungen, ['knee']);
  assert.ok(!gesehen.some((x) => x.pfad.startsWith('/proj/aendern')), 'the regler way never touches the project');
  // 2nd request refused by the kern (quittung 6): the 3rd is never sent
  gesehen.length = 0; n = 0; refus = 2;
  const stopp = await c.callTool({ name: 'presets_anwenden', arguments: { id: 'werk:komp/drum-bus', ziel: { art: 'kanal', kanal: 'deck/1' } } });
  assert.equal(stopp.isError, true);
  assert.match(text(stopp), /nur_hand/);
  assert.equal(gesehen.filter((x) => x.pfad === '/regler').length, 2, 'the third request never left');
  const d = JSON.parse(text(stopp)).detail;
  assert.deepEqual(d.angenommen, ['deck/1/komp/schwelle']);
  assert.equal(d.abgelehnt, 'deck/1/komp/ratio');
  assert.deepEqual(d.offen, ['deck/1/komp/attack']);
});

test('presets_anwenden weg regler: an HTTP refusal of /regler also stops; a bad id or a missing ziel is refused locally with nothing sent', async (t) => {
  let n = 0;
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/presets/anwenden' ? [200, PLAN_REGLER] : u === '/regler' ? (++n === 1 ? [409, { fehler: 'ueber_projekt', text: 'no' }] : [200, { ok: true }]) : null));
  const r = await c.callTool({ name: 'presets_anwenden', arguments: { id: 'werk:komp/drum-bus', ziel: { art: 'kanal', kanal: 'deck/1' } } });
  assert.equal(r.isError, true);
  assert.match(text(r), /ueber_projekt/);
  assert.equal(gesehen.filter((x) => x.pfad === '/regler').length, 1);
  const vorher = gesehen.length;
  assert.equal((await c.callTool({ name: 'presets_anwenden', arguments: { id: 'komp/drum-bus', ziel: { art: 'kanal', kanal: 'deck/1' } } })).isError, true);
  assert.equal((await c.callTool({ name: 'presets_anwenden', arguments: { id: 'werk:komp/drum-bus' } })).isError, true);
  assert.equal(gesehen.length, vorher);
});

test('presets_anwenden: description names the freeze rule; the schema asks for id and ziel', async (t) => {
  const { c } = await aufbau(t, () => null);
  const w = await tool(c, 'presets_anwenden');
  assert.match(w.description, /frozen track drops its freeze/);
  assert.match(w.description, /hinweise: freeze_geht/);
  assert.deepEqual(w.inputSchema.required, ['id', 'ziel']);
});

test('kollektionen: no slug lists, a slug reads one (GET /kollektionen[/<slug>])', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (u === '/kollektionen' ? [200, [{ slug: 'dark', name: 'Dark', anzahl: 1 }]]
    : u === '/kollektionen/dark' ? [200, { slug: 'dark', name: 'Dark', posten: [] }] : u === '/kollektionen/gibts-nicht' ? [404, { fehler: 'unbekannt', text: 'no such collection' }] : null));
  const l = await c.callTool({ name: 'kollektionen', arguments: {} });
  assert.deepEqual(JSON.parse(text(l)), [{ slug: 'dark', name: 'Dark', anzahl: 1 }]);
  const e = await c.callTool({ name: 'kollektionen', arguments: { slug: 'dark' } });
  assert.equal(JSON.parse(text(e)).slug, 'dark');
  const x = await c.callTool({ name: 'kollektionen', arguments: { slug: 'gibts-nicht' } });
  assert.equal(x.isError, true);
  assert.deepEqual(gesehen.map((g) => `${g.methode} ${g.pfad} ${g.quelle}`), ['GET /kollektionen cypher', 'GET /kollektionen/dark cypher', 'GET /kollektionen/gibts-nicht cypher']);
});

test('kollektion_aendern: neu, posten, umbenennen, loeschen each hit their route with the body; missing arguments are refused locally', async (t) => {
  const { c, gesehen } = await aufbau(t, (m, u) => (m === 'POST' && u.startsWith('/kollektionen') ? [u === '/kollektionen' ? 201 : 200, { ok: true }] : null));
  const P = { art: 'preset', id: 'werk:komp/drum-bus' };
  const alle = [
    [{ aktion: 'neu', name: 'Dark Stuff' }, '/kollektionen', { name: 'Dark Stuff' }],
    [{ aktion: 'posten', slug: 'dark-stuff', hinzu: [P], weg: [], erwartet: '2026-11-05T00:00:00Z' }, '/kollektionen/dark-stuff/posten', { hinzu: [P], weg: [], erwartet: '2026-11-05T00:00:00Z' }],
    [{ aktion: 'posten', slug: 'dark-stuff', weg: [P] }, '/kollektionen/dark-stuff/posten', { weg: [P] }],
    [{ aktion: 'umbenennen', slug: 'dark-stuff', name: 'Darker' }, '/kollektionen/dark-stuff/umbenennen', { name: 'Darker' }],
    [{ aktion: 'loeschen', slug: 'darker' }, '/kollektionen/darker/loeschen', {}],
  ];
  for (const [arg, pfad, koerper] of alle) {
    const r = await c.callTool({ name: 'kollektion_aendern', arguments: arg });
    assert.ok(!r.isError, text(r));
    const g = gesehen[gesehen.length - 1];
    assert.deepEqual([g.methode, g.pfad, g.quelle, g.koerper], ['POST', pfad, 'cypher', koerper], arg.aktion);
  }
  const n = gesehen.length;
  for (const arg of [{ aktion: 'neu' }, { aktion: 'posten' }, { aktion: 'posten', slug: 'x' }, { aktion: 'umbenennen', slug: 'x' }, { aktion: 'umbenennen', name: 'y' }, { aktion: 'loeschen' }, { aktion: 'sprengen', slug: 'x' }, {}]) {
    const r = await c.callTool({ name: 'kollektion_aendern', arguments: arg });
    assert.equal(r.isError, true, JSON.stringify(arg));
    assert.match(text(r), /argument_fehlt|aktion_unbekannt/);
  }
  assert.equal(gesehen.length, n, 'nothing sent for the refused calls');
});

test('kollektion_aendern: the server refusals (Andreas collection, stale erwartet, bad item) arrive as tool errors with their reason', async (t) => {
  const { c } = await aufbau(t, (m, u) => (u.endsWith('/loeschen') ? [403, { fehler: 'nur_andreas_kollektion', text: 'Cypher may delete only collections she created' }]
    : u.endsWith('/posten') ? [400, { fehler: 'posten_ungueltig', text: 'an item must be ...', posten: { art: 'x' } }] : null));
  const a = await c.callTool({ name: 'kollektion_aendern', arguments: { aktion: 'loeschen', slug: 'andreas-sammlung' } });
  assert.equal(a.isError, true); assert.match(text(a), /nur_andreas_kollektion/);
  const b = await c.callTool({ name: 'kollektion_aendern', arguments: { aktion: 'posten', slug: 's', hinzu: [{ art: 'x' }] } });
  assert.equal(b.isError, true); assert.match(text(b), /posten_ungueltig/);
});

test('real routes end to end: save by werte, read back, apply to a project insert, collect it (the stdio hand against presetsBereich and kollektionenBereich)', async (t) => {
  let p = neuesProjekt('T');
  p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', werte: { schwelle: -40, ratio: 2 } }], { quelle: 'andreas' }).projekt;
  const iid = p.spuren[0].inserts[0].id;
  const { c, gesehen } = await echterStapel(t, (m, u) => (u === '/proj/aktuell?nur=rev' ? [200, { rev: 5 }] : u === '/proj/aendern?antwort=kurz' ? [200, { rev: 6 }] : null), { projekt: p, quelle: 'cypher' });
  const beschr = { art: 'compressor', unterart: 'peak', charakter: ['clean'], genre: [], einsatz: ['mixdown'], energie: 2, text: 'Peak control from the hand test.' };
  const s = await c.callTool({ name: 'presets_speichern', arguments: { name: 'Hand Test', geraet: 'komp', beschreibung: beschr, werte: { thresh: -20, ratio: 3 } } });
  assert.ok(!s.isError, text(s));
  const sj = JSON.parse(text(s));
  assert.deepEqual([sj.herkunft, sj.geraet, sj.slug], ['nutzer', 'komp', 'hand-test']);
  const l = await c.callTool({ name: 'presets_lesen', arguments: { id: 'nutzer:komp/hand-test' } });
  assert.ok(!l.isError, text(l));
  assert.equal(JSON.parse(text(l)).autor, 'cypher', 'saved by the hand: the author mark is cypher');
  const an = await c.callTool({ name: 'presets_anwenden', arguments: { id: 'nutzer:komp/hand-test', ziel: { art: 'insert', insert_id: iid } } });
  assert.ok(!an.isError, text(an));
  const aend = gesehen.find((x) => x.pfad === '/proj/aendern?antwort=kurz');
  assert.equal(aend.koerper.befehle[0].befehl, 'insert_werte_setzen');
  assert.equal(aend.koerper.befehle[0].preset, 'nutzer:komp/hand-test');
  assert.equal(aend.koerper.rev, 5);
  const k = await c.callTool({ name: 'kollektion_aendern', arguments: { aktion: 'neu', name: 'Hand Sammlung' } });
  assert.ok(!k.isError, text(k));
  const h = await c.callTool({ name: 'kollektion_aendern', arguments: { aktion: 'posten', slug: 'hand-sammlung', hinzu: [{ art: 'preset', id: 'nutzer:komp/hand-test' }] } });
  assert.ok(!h.isError, text(h));
  const lies = JSON.parse(text(await c.callTool({ name: 'kollektionen', arguments: { slug: 'hand-sammlung' } })));
  assert.deepEqual(lies.posten, [{ art: 'preset', id: 'nutzer:komp/hand-test' }]);
  assert.equal(lies.autor, 'cypher');
  const liste = JSON.parse(text(await c.callTool({ name: 'kollektionen', arguments: {} })));
  assert.deepEqual(liste.map((x) => x.slug), ['hand-sammlung']);
  // the real refusal: a hall preset has no running instance
  const hall = await c.callTool({ name: 'presets_anwenden', arguments: { id: 'werk:hall/dark-dub', ziel: { art: 'spur', spur_id: 's1' } } });
  assert.equal(hall.isError, true);
  assert.match(text(hall), /kein_ziel/);
  assert.equal(gesehen.filter((x) => x.pfad.startsWith('/proj/aendern')).length, 1, 'the refused plan sent nothing');
});

test('real routes: a bad beschreibung word is answered with erlaubt through the hand (details survive the tool error)', async (t) => {
  const { c } = await echterStapel(t, () => null, { quelle: 'cypher' });
  const beschr = { art: 'erfundene-art', unterart: 'peak', charakter: ['clean'], genre: [], einsatz: ['mixdown'], energie: 2, text: 'x' };
  const r = await c.callTool({ name: 'presets_speichern', arguments: { name: 'Falsch', geraet: 'komp', beschreibung: beschr, werte: { thresh: -18 } } });
  assert.equal(r.isError, true);
  const j = JSON.parse(text(r));
  assert.equal(j.fehler, 'beschreibung_ungueltig');
  assert.ok(j.details.some((d) => Array.isArray(d.erlaubt) && d.erlaubt.includes('compressor')), text(r).slice(0, 300));
});

test('AK-B16-8: tools/list length = N + 6 (N = 66 on the base) = the count of tool entries in hand.ts = the number in both AUFRUF.md files', async (t) => {
  const { c } = await aufbau(t, () => null);
  const laenge = (await c.listTools()).tools.length;
  const quelle = fs.readFileSync(HAND, 'utf8');
  const imCode = quelle.split('\n').filter((z) => z.startsWith("  { name: '")).length;
  assert.equal(laenge, 66 + 6 + 1 + 1 + 1 + 1 + 1 + 1 + 1 /* MIDI import */ + 5 /* live-module task 4 */ + 1 /* live-module task 11: modul_tonart */ + 1 /* live-module task 8: modul_blend */ + 3 /* live-module task 10 */ + 1 /* oszilloskop */);   // + plugins (1.11 T8) + ansage (demo overlay) + proj_kits (1.9 T2.5) + proj_routing (1.10 T1) + proj_resample (1.10 T6) + proj_muster (strudel-clip)
  assert.equal(imCode, laenge, 'grep -c "^  { name: \'" djk/hand/hand.ts');
  const wurzel = path.resolve(path.dirname(HAND), '..', '..');
  // the English edition lives under docs/veroeffentlichung in the working repo; the public repo carries only djk/hand/AUFRUF.md
  for (const datei of ['djk/hand/AUFRUF.md', 'docs/veroeffentlichung/englisch/djk/hand/AUFRUF.md'].filter((d) => fs.existsSync(path.join(wurzel, d)))) {
    const md = fs.readFileSync(path.join(wurzel, datei), 'utf8');
    assert.match(md, new RegExp(`^## (Werkzeuge|Tools) \\(${laenge}\\)$`, 'm'), `${datei} heading`);
    assert.ok(md.includes(`= ${laenge};`), `${datei} counting sentence`);
    assert.ok(!/\b(65|71)\b/.test(md), `${datei} has no stale 65 or 71`);
  }
  // negative control: the check does see a stale number
  assert.throws(() => assert.match('## Tools (65)', new RegExp(`^## (Werkzeuge|Tools) \\(${laenge}\\)$`, 'm')), assert.AssertionError);
});
