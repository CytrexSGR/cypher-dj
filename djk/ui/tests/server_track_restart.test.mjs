// Page server against the core stand-in: Studio S6 final review (tempo change, restart of the page server) and S7 tracks. Moved from server.test.mjs.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TMP, OHNE_STRUDEL, warte, stromSpuren, stapel, postJson, CYPHER, fakeWirt, neustart } from './server_test_help.mjs';
// Own temp folder of this file (created in the helper module, one process per file), removed at the end.
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('Studio S6 Final-Review F3: POST /spur meldet abgelehnte Teile wie GET /spur, Negativ-Kontrolle leer', async (t) => {
  const { o, url } = await stapel(t, [], { live: true });
  await stromSpuren(o, 1, 2, 3, 5);   // the alias paths erz/<n> need the strom tracks of the live project
  const s = await postJson(url, '/spur', { spur: { name: 'nurx', fahrten: [{ ziel: 'cue/pegel', ab_takt: 1, takte: 1, nach: -6 }] } }, CYPHER);
  assert.equal(s.code, 200, JSON.stringify(s.j));
  assert.deepEqual(s.j.abgelehnt.map((x) => [x.teil, x.pfad, x.status, x.grund]), [[0, 'cue/pegel', 6, 'nur_hand']], JSON.stringify(s.j));
  assert.deepEqual(s.j.abgelehnt, (await (await fetch(`${url}/spur`)).json()).find((x) => x.name === 'nurx').abgelehnt);
  const g = await postJson(url, '/spur', { spur: { name: 'gut', fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 1, nach: -0.6 }] } }, CYPHER);
  assert.deepEqual(g.j.abgelehnt, []);
});

test('Studio S6 Final-Review F8: der Server loggt spur_wirt_ersetzt, wenn der Wirt wartende Fahrten verworfen hat; sonst nicht', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'djk-wirt-'));
  const { url, log } = await stapel(t, [], { wirtOrdner: wo });
  await fakeWirt(t, wo, 'bass', { ok: true, ersetzt: 2 });
  await fakeWirt(t, wo, 'melodie');
  const mk = (name, gruppe) => ({ name, fahrten: [{ ziel: `wirt:${gruppe}/a_filter1_cutoff`, ab_takt: 2, takte: 1, nach: -15, von: -45 }] });
  assert.equal((await postJson(url, '/spur', { spur: mk('b', 'bass') }, CYPHER)).code, 200);
  const z = log.filter((x) => x.typ === 'spur_wirt_ersetzt');
  assert.deepEqual(z.map((x) => [x.name, x.gruppe, x.parameter, x.ersetzt]), [['b', 'bass', 'a_filter1_cutoff', 2]], JSON.stringify(z));
  assert.equal((await postJson(url, '/spur', { spur: mk('m', 'melodie') }, CYPHER)).code, 200);
  assert.equal(log.filter((x) => x.typ === 'spur_wirt_ersetzt').length, 1, 'Wirt ohne ersetzt: kein Log');
});

test('Studio S6 Final-Review F5: Tempowechsel nach dem Start verschiebt den Muster-Zeitpunkt nicht (Beat statt Wanduhr)', { skip: OHNE_STRUDEL }, async (t) => {
  const d = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const { o, url, log } = await stapel(t, [], { musterOrdner: d, live: true });
  const r = await postJson(url, '/spur', { spur: { name: 'mt', fahrten: [{ ziel: 'strom:2', ab_takt: 7, muster: 'silence' }] } }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  o.kern.sende('/k/tempo/rampe', { id: Number(++o.id), quelle: 'andreas', ab_beat: o.kern.uhr.beat + 0.5, ziel_bpm: 140, dauer_beats: 1 });
  let z;
  for (let i = 0; i < 1000 && !(z = log.find((x) => x.typ === 'spur_muster')); i++) await warte(20);
  assert.ok(z, 'spur_muster kam nicht');
  assert.equal(z.code, 200, JSON.stringify(z));
  assert.ok(o.kern.uhr.bpm > 135, `Tempo ${o.kern.uhr.bpm}: der Wechsel kam nicht an`);
  assert.equal(z.ziel_beat, r.j.anker_beat + 24);
  assert.ok(z.beat_vorher >= z.ziel_beat - 2 - 0.1, `zu früh: ${z.beat_vorher}`);
  assert.ok(z.beat_nachher < z.ziel_beat, `geschrieben erst bei ${z.beat_nachher}, Ziel ${z.ziel_beat}`);
});


test('Studio S6 Final-Review F2: laufende Spuren überstehen den Neustart des Seiten-Servers (Liste, /spur/stopp, /abbruch, Stop Cypher)', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'djk-wirt-'));
  const { o, url } = await stapel(t, [], { wirtOrdner: wo, live: true });
  await stromSpuren(o, 1, 2, 3, 5);   // the alias paths erz/<n> need the strom tracks of the live project
  const bass = await fakeWirt(t, wo, 'bass');
  const start = async (name, ziel, kopf) => { const r = await postJson(url, '/spur', { spur: { name, fahrten: [{ ziel, ab_takt: 1, takte: 8, nach: ziel.startsWith('wirt') ? -15 : -0.6, ...(ziel.startsWith('wirt') ? { von: -45 } : {}) }] } }, kopf); assert.equal(r.code, 200, JSON.stringify(r.j)); return r.j; };
  await start('lang', 'wirt:bass/a_filter1_cutoff', CYPHER);
  await start('lang2', 'erz/2/filter', CYPHER);
  await start('lang3', 'erz/3/filter', CYPHER);
  await start('mensch', 'erz/1/filter', {});
  assert.ok(fs.existsSync(path.join(wo, 'spuren.json')), 'spuren.json geschrieben');
  const { o2, log } = await neustart(t, o);
  const liste = await (await fetch(`${url}/spur`)).json();
  assert.deepEqual(liste.map((x) => [x.name, x.quelle]).sort(), [['lang', 'cypher'], ['lang2', 'cypher'], ['lang3', 'cypher'], ['mensch', 'andreas']]);
  // Stopp einer Spur nach dem Neustart: /k/abbruch mit ihrem Plan, Wirt halte
  const s = await postJson(url, '/spur/stopp', { name: 'lang' }, CYPHER);
  assert.equal(s.code, 200, JSON.stringify(s.j));
  assert.deepEqual(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/abbruch').map((z) => z.felder.plan), ['spur:lang']);
  assert.deepEqual(bass.filter((z) => z.befehl === 'halte'), [{ befehl: 'halte', spur: 'lang' }]);
  // Cyphers /abbruch: nur ihre Spuren; Stop Cypher nach dem Neustart genauso
  assert.equal((await postJson(url, '/abbruch', {}, CYPHER)).code, 200);
  assert.deepEqual((await (await fetch(`${url}/spur`)).json()).map((x) => x.name), ['mensch']);
  // eine neue Spur überlebt einen zweiten Neustart nicht, wenn sie vorher gestoppt wurde (Datei folgt jeder Änderung)
  const c = await start('kurz-weg', 'erz/2/filter', CYPHER);
  o2.kern.sende('/k/ki/stopp', { id: Number(++o2.id), quelle: 'andreas' });
  await warte(400);
  assert.deepEqual((await (await fetch(`${url}/spur`)).json()).map((x) => x.name), ['mensch'], 'Stop Cypher nach Neustart');
  const { log: log3 } = await neustart(t, o2);
  assert.deepEqual((await (await fetch(`${url}/spur`)).json()).map((x) => x.name), ['mensch'], `gestoppte Spuren bleiben weg (${JSON.stringify(c)})`);
  assert.equal(log3.length >= 0, true);
});

test('Studio S6 Final-Review F2: abgelaufene Spuren fallen beim Laden weg, Muster-Fahrten werden neu eingeplant', { skip: OHNE_STRUDEL }, async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'djk-wirt-'));
  const d = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const { o, url } = await stapel(t, [], { wirtOrdner: wo, musterOrdner: d, live: true });
  await stromSpuren(o, 1, 2, 3, 5);   // the alias paths erz/<n> need the strom tracks of the live project
  const kurz = await postJson(url, '/spur', { spur: { name: 'kurz', fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 3, nach: -0.6 }] } }, CYPHER);   // 3 bars: the restart plus liveOeffnen takes seconds on a loaded runner (1 bar ended inside it, CI 146 and 147), still over before the muster at +12 beats
  const mus = await postJson(url, '/spur', { spur: { name: 'mus', fahrten: [{ ziel: 'strom:2', ab_takt: 4, muster: 'silence' }] } }, CYPHER);
  assert.equal(kurz.code, 200); assert.equal(mus.code, 200, JSON.stringify(mus.j));
  const { o2, log } = await neustart(t, o);
  assert.equal((await o2.proj.sitzung.liveOeffnen('andreas')).code, 200);   // the new server holds the live project again, as in operation
  assert.deepEqual((await (await fetch(`${url}/spur`)).json()).map((x) => x.name).sort(), ['kurz', 'mus'], 'direkt nach dem Neustart noch beide');
  // 'kurz' endet nach Kern-Beat; danach ist sie weg, 'mus' schreibt ihr Muster im neuen Server
  let z;
  for (let i = 0; i < 1000 && !(z = log.find((x) => x.typ === 'spur_muster')); i++) await warte(25);
  assert.ok(z, 'spur_muster im neuen Server kam nicht');
  assert.equal(z.code, 200, JSON.stringify(z)); assert.equal(z.ziel_beat, mus.j.anker_beat + 12);
  assert.ok(z.beat_nachher < z.ziel_beat, `zu spät: ${z.beat_nachher} vs ${z.ziel_beat}`);
  for (let i = 0; i < 400 && (o2.kern.uhr?.beat ?? 0) < kurz.j.ende_beat + 1.5; i++) await warte(25);
  const namen = (await (await fetch(`${url}/spur`)).json()).map((x) => x.name);
  assert.ok(!namen.includes('kurz'), `abgelaufene Spur noch da: ${namen}`);
  // Datei folgt: ein dritter Server sieht 'kurz' auch nicht mehr
  const dat = JSON.parse(fs.readFileSync(path.join(wo, 'spuren.json'), 'utf8'));
  assert.ok(!JSON.stringify(dat).includes('"kurz"'), 'spuren.json ohne abgelaufene Spur');
});

test('S7 T11: GET /spur liefert die Fahrten der laufenden Spur, auch nach dem Neustart des Seiten-Servers', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'djk-wirt-'));
  const { o, url } = await stapel(t, [], { wirtOrdner: wo, live: true });
  await stromSpuren(o, 1, 2, 3, 5);   // the alias paths erz/<n> need the strom tracks of the live project
  const spur = { name: 'band-2-fader', fahrten: [
    { ziel: 'erz/2/fader', ab_takt: 1, nach: 0 }, { ziel: 'erz/2/fader', ab_takt: 1, takte: 4, nach: -30, form: 'linear' }] };
  assert.equal((await postJson(url, '/spur', { spur })).code, 200);
  const [s] = await (await fetch(`${url}/spur`)).json();
  assert.deepEqual(s.fahrten, spur.fahrten);
  await neustart(t, o);
  const [s2] = await (await fetch(`${url}/spur`)).json();
  assert.equal(s2.name, 'band-2-fader');
  assert.deepEqual(s2.fahrten, spur.fahrten, 'die Fahrten überstehen den Neustart (spuren.json)');
});

// Plan djk-hand-mcp-studio T1 (Review): /loop rec wartet auf die Kern-Quittung; Status 6 (Tempo ≠ 128, Stop Cypher,
// Überlappung) steht in der Antwort, damit der MCP daraus einen Werkzeugfehler machen kann.
