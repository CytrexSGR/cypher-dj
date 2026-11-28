// Page server against the core stand-in: Studio S6 tracks with the host stand-in (/spur, /abbruch, pattern runs, Stop Cypher). Moved from server.test.mjs.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TMP, OHNE_STRUDEL, warte, stromSpuren, stapel, postJson, CYPHER, bis, fakeWirt } from './server_test_help.mjs';
// Own temp folder of this file (created in the helper module, one process per file), removed at the end.
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('Studio S6 T2: /spur schickt Kanalzug-Fahrten als /k/teil ab der Takt-Eins, /spur/stopp bricht ab, D8 für cypher', async (t) => {
  const { o, url, log } = await stapel(t, [], { live: true });
  await stromSpuren(o, 1, 2, 3, 5);   // the alias paths erz/<n> need the strom tracks of the live project
  const teile = () => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil');
  const spur = { name: 'aus-2', fahrten: [
    { ziel: 'erz/2/filter', ab_takt: 1, takte: 2, nach: -0.6 },
    { ziel: 'erz/2/fader', ab_takt: 3, takte: 1, nach: -200 },
  ] };
  const r = await postJson(url, '/spur', { spur, ab: 'takt' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.anker_beat % 4, 0); assert.equal(r.j.teile, 2);
  assert.deepEqual(teile().slice(-2).map((z) => [z.felder.pfad, z.felder.ab_beat - r.j.anker_beat, z.felder.dauer_beats, z.felder.politik, z.felder.form, z.felder.plan, z.felder.quelle]),
    [['spur/2/filter', 0, 8, 0, 1, 'spur:aus-2', 'cypher'], ['spur/2/fader', 8, 4, 1, 1, 'spur:aus-2', 'cypher']]);
  assert.deepEqual((await (await fetch(`${url}/spur`)).json()).map((s) => [s.name, s.quelle, s.anker_beat]), [['aus-2', 'cypher', r.j.anker_beat]]);
  assert.equal((await postJson(url, '/spur', { spur }, CYPHER)).j.fehler, 'laeuft');
  // Stopp: /k/abbruch mit dem Plan der Spur, danach keine laufende Spur
  const s = await postJson(url, '/spur/stopp', { name: 'aus-2' }, CYPHER);
  assert.equal(s.code, 200, JSON.stringify(s.j));
  const ab = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/abbruch').at(-1);
  assert.equal(ab.felder.plan, 'spur:aus-2'); assert.equal(ab.felder.teile, '*'); assert.equal(ab.felder.quelle, 'cypher');
  assert.deepEqual(await (await fetch(`${url}/spur`)).json(), []);
  assert.equal((await postJson(url, '/spur/stopp', { name: 'aus-2' }, CYPHER)).code, 404);
  // D8: Cyphers Spur zieht ein geschlossenes Deck auf → 409, nichts an den Kern; Andreas' Spur geht durch
  const n0 = teile().length;
  const auf = { name: 'auf-1', fahrten: [{ ziel: 'deck/1/fader', ab_takt: 1, takte: 4, nach: 0 }] };
  const x = await postJson(url, '/spur', { spur: auf }, CYPHER);
  assert.equal(x.code, 409); assert.equal(x.j.fehler, 'kein_hoerschein'); assert.equal(x.j.pfad, 'deck/1/fader'); assert.equal(teile().length, n0);
  const y = await postJson(url, '/spur', { spur: auf });
  assert.equal(y.code, 200, JSON.stringify(y.j)); assert.equal(teile().at(-1).felder.quelle, 'andreas');
  // Strudel-Kanal (Andreas 2026-09-29): Cypher darf ihn aufziehen
  const erz = await postJson(url, '/spur', { spur: { name: 'auf-2', fahrten: [{ ziel: 'erz/2/fader', ab_takt: 1, takte: 4, nach: 0 }] } }, CYPHER);
  assert.equal(erz.code, 200, JSON.stringify(erz.j)); assert.equal(teile().at(-1).felder.pfad, 'spur/2/fader');
  assert.notEqual(erz.j.quittung?.status, 6, `Kern lehnt ab: ${JSON.stringify(erz.j.quittung)}`);   // Final-Review F6: auch die Kern-Quittung, nicht nur HTTP 200
  // Form
  assert.equal((await postJson(url, '/spur', { spur: { name: 'X', fahrten: [] } })).code, 400);
  assert.equal((await postJson(url, '/spur', { spur: { ...spur, name: 'b' }, ab: 'jetzt' })).code, 400);
  assert.equal((await postJson(url, '/spur/stopp', { name: '../x' })).code, 400);
});

test('Studio S6 Review: Ablehnung eines Spurteils sichtbar in GET /spur (abgelehnt), Negativ-Kontrolle ohne', async (t) => {
  const { o, url } = await stapel(t, [], { live: true });
  await stromSpuren(o, 1, 2, 3, 5);   // the alias paths erz/<n> need the strom tracks of the live project
  const gut = { name: 'gut', fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 1, nach: -0.6 }] };
  const g = await postJson(url, '/spur', { spur: gut }, CYPHER);
  assert.equal(g.code, 200, JSON.stringify(g.j));
  assert.deepEqual((await (await fetch(`${url}/spur`)).json())[0].abgelehnt, []);
  await postJson(url, '/spur/stopp', { name: 'gut' }, CYPHER);
  const schlecht = { name: 'schlecht', fahrten: [
    { ziel: 'erz/2/filter', ab_takt: 1, takte: 1, nach: -0.6 },
    { ziel: 'cue/pegel', ab_takt: 1, takte: 1, nach: -6 },
  ] };
  const s = await postJson(url, '/spur', { spur: schlecht }, CYPHER);
  assert.equal(s.code, 200, JSON.stringify(s.j));
  const l = (await (await fetch(`${url}/spur`)).json()).find((x) => x.name === 'schlecht');
  assert.deepEqual(l.abgelehnt.map((x) => [x.teil, x.pfad, x.status, x.grund]), [[1, 'cue/pegel', 6, 'nur_hand']], JSON.stringify(l));
});

test('Studio S6 Review: kurze Spur verschwindet nach ihrem Ende im Kern-Beat, nicht nach Wanduhr', async (t) => {
  const { o, url } = await stapel(t, [], { live: true });
  await stromSpuren(o, 1, 2, 3, 5);   // the alias paths erz/<n> need the strom tracks of the live project
  const s = { name: 'kurz', fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 1, nach: -0.6 }] };
  assert.equal((await postJson(url, '/spur', { spur: s }, CYPHER)).code, 200);
  assert.equal((await (await fetch(`${url}/spur`)).json()).length, 1);
  let n = 1;
  for (let i = 0; i < 200 && n > 0; i++) { await warte(100); n = (await (await fetch(`${url}/spur`)).json()).length; }
  assert.equal(n, 0, 'Spur nach Ende + 1 Beat aufgeräumt');
});

test('Studio S6 Review: POST /abbruch (cypher) bricht Cyphers Spuren ab, Andreas\' Spur bleibt', async (t) => {
  const { o, url, log } = await stapel(t, [], { live: true });
  await stromSpuren(o, 1, 2, 3, 5);   // the alias paths erz/<n> need the strom tracks of the live project
  const mk = (name) => ({ name, fahrten: [{ ziel: 'erz/2/filter', ab_takt: 1, takte: 8, nach: -0.6 }] });
  const mk3 = (name) => ({ name, fahrten: [{ ziel: 'erz/3/filter', ab_takt: 1, takte: 8, nach: -0.6 }] });
  assert.equal((await postJson(url, '/spur', { spur: mk('von-cypher') }, CYPHER)).code, 200);
  assert.equal((await postJson(url, '/spur', { spur: mk3('von-andreas') })).code, 200);
  const ab = await postJson(url, '/abbruch', {}, CYPHER);
  assert.equal(ab.code, 200, JSON.stringify(ab.j));
  const plaene = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/abbruch').map((z) => z.felder.plan);
  assert.ok(plaene.includes('spur:von-cypher'), JSON.stringify(plaene));
  assert.ok(!plaene.includes('spur:von-andreas'), JSON.stringify(plaene));
  assert.deepEqual((await (await fetch(`${url}/spur`)).json()).map((x) => x.name), ['von-andreas']);
});


test('Studio S6 T6: Surge-Fahrten gehen mit Startzeit aus der Kern-Uhr an den Wirt, Stopp hält sie an', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'djk-wirt-'));
  const { o, url } = await stapel(t, [], { wirtOrdner: wo });
  const bass = await fakeWirt(t, wo, 'bass');
  const spur = { name: 'bass-auf', fahrten: [{ ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 2, takte: 4, nach: -15, von: -45 }] };
  const r = await postJson(url, '/spur', { spur }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j)); assert.equal(r.j.wirt, 1);
  const u = o.kern.uhr, f = bass[0];
  assert.deepEqual([f.befehl, f.name, f.bis, f.von, f.spur], ['fahre', 'a_filter1_cutoff', -15, -45, 'bass-auf']);
  assert.ok(Math.abs(f.dauer - 16 * 60 / u.bpm) < 1e-9, `dauer ${f.dauer}`);
  const soll = Number(u.mono_ns) / 1e9 + (r.j.anker_beat + 4 - u.beat) * 60 / u.bpm;   // dieselbe Gerade, spätere Uhr
  assert.ok(Math.abs(f.ab - soll) < 0.005, `ab ${f.ab}, soll ${soll}`);
  assert.ok(f.ab > Number(process.hrtime.bigint()) / 1e9, 'Start liegt in der Zukunft');
  assert.equal((await postJson(url, '/spur/stopp', { name: 'bass-auf' }, CYPHER)).code, 200);
  assert.deepEqual(bass.at(-1), { befehl: 'halte', spur: 'bass-auf' });
  // Wirt fehlt: 409 mit Grund, keine Spur bleibt laufend stehen
  const x = await postJson(url, '/spur', { spur: { name: 'mel', fahrten: [{ ziel: 'wirt:melodie/a_filter1_cutoff', ab_takt: 1, takte: 1, nach: 0 }] } }, CYPHER);
  assert.equal(x.code, 409); assert.equal(x.j.fehler, 'wirt'); assert.equal(x.j.gruppe, 'melodie');
  assert.deepEqual(await (await fetch(`${url}/spur`)).json(), []);
  // Negativ-Kontrolle: a RAMP on a discrete parameter is refused when checking (a set without takte is a discrete set since strand 11), the host sees nothing
  const n = bass.length;
  assert.equal((await postJson(url, '/spur', { spur: { name: 'b2', fahrten: [{ ziel: 'wirt:bass/a_filter1_type', ab_takt: 1, takte: 2, nach: 2 }] } }, CYPHER)).code, 400);
  assert.equal(bass.length, n);
});

test('Studio S6 T7: Muster-Fahrt schreibt den Strom zwei Beats vor ihrer Takt-Eins, als cypher', { skip: OHNE_STRUDEL }, async (t) => {
  const d = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const { url, log } = await stapel(t, [], { musterOrdner: d, live: true });
  const r = await postJson(url, '/spur', { spur: { name: 'still-2', fahrten: [{ ziel: 'strom:2', ab_takt: 2, muster: 'silence' }] } }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j)); assert.equal(r.j.muster, 1);
  let z;
  for (let i = 0; i < 400 && !(z = log.find((x) => x.typ === 'spur_muster')); i++) await warte(20);
  assert.ok(z, 'spur_muster kam nicht');
  assert.equal(z.code, 200, JSON.stringify(z));
  assert.equal(z.ziel_beat, r.j.anker_beat + 4);
  assert.ok(z.beat_vorher >= z.ziel_beat - 2 - 0.1, `zu früh: ${z.beat_vorher}`);
  assert.ok(z.beat_nachher < z.ziel_beat, `geschrieben erst bei ${z.beat_nachher}, Ziel ${z.ziel_beat}`);
  const st = await (await fetch(`${url}/strudel?strom=2`)).json();
  assert.equal(st.text, 'silence'); assert.equal(st.von, 'cypher');
  // Stopp vor dem Zeitpunkt: kein Schreiben
  await postJson(url, '/spur', { spur: { name: 'still-3', fahrten: [{ ziel: 'strom:3', ab_takt: 3, muster: 'silence' }] } }, CYPHER);
  assert.equal((await postJson(url, '/spur/stopp', { name: 'still-3' }, CYPHER)).code, 200);
  await warte(3000);
  assert.equal(log.filter((x) => x.typ === 'spur_muster' && x.name === 'still-3').length, 0);
});

test('Studio S6 Final-Review F1: Stop Cypher bricht Cyphers Spuren ab (Kern, Wirt halte, Muster), Andreas\' Spur bleibt', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'djk-wirt-'));
  const { o, url, log } = await stapel(t, [], { wirtOrdner: wo, live: true });
  await stromSpuren(o, 1, 2, 3, 5);   // the alias paths erz/<n> need the strom tracks of the live project
  const bass = await fakeWirt(t, wo, 'bass');
  const spur = { name: 'sp', fahrten: [
    { ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1, takte: 8, nach: -15, von: -45 },
    { ziel: 'erz/2/filter', ab_takt: 1, takte: 8, nach: -0.6 },
    { ziel: 'strom:2', ab_takt: 3, muster: 'silence' }] };
  const r = await postJson(url, '/spur', { spur }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal((await postJson(url, '/spur', { spur: { name: 'von-andreas', fahrten: [{ ziel: 'erz/3/filter', ab_takt: 1, takte: 8, nach: -0.6 }] } })).code, 200);
  o.kern.sende('/k/ki/stopp', { id: Number(++o.id), quelle: 'andreas' });
  await warte(600);
  assert.deepEqual(bass.filter((z) => z.befehl === 'halte'), [{ befehl: 'halte', spur: 'sp' }, { befehl: 'halte', spur: 'klang-bass' }], JSON.stringify(bass));
  assert.deepEqual((await (await fetch(`${url}/spur`)).json()).map((x) => x.name), ['von-andreas']);
  const plaene = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/abbruch').map((z) => z.felder.plan);
  assert.ok(plaene.includes('spur:sp') && !plaene.includes('spur:von-andreas'), JSON.stringify(plaene));
  o.kern.sende('/k/ki/frei', { id: Number(++o.id), quelle: 'andreas' });
  await warte(300);
  const ziel = r.j.anker_beat + 8;
  for (let i = 0; i < 1000 && (o.kern.uhr?.beat ?? 0) < ziel + 1; i++) await warte(25);
  assert.equal(log.filter((z) => z.typ === 'spur_muster').length, 0, 'kein Muster nach Freigabe');
});

test('Studio S6 Final-Review F9: /spur/stopp als cypher auf Andreas\' Spur 403 nur_andreas, Negativ-Kontrolle eigene Spur', async (t) => {
  const { o, url, log } = await stapel(t, [], { live: true });
  await stromSpuren(o, 1, 2, 3, 5);   // the alias paths erz/<n> need the strom tracks of the live project
  const mk = (name, z) => ({ name, fahrten: [{ ziel: z, ab_takt: 1, takte: 8, nach: -0.6 }] });
  assert.equal((await postJson(url, '/spur', { spur: mk('a-spur', 'erz/3/filter') })).code, 200);
  assert.equal((await postJson(url, '/spur', { spur: mk('c-spur', 'erz/2/filter') }, CYPHER)).code, 200);
  const n = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/abbruch').length;
  const x = await postJson(url, '/spur/stopp', { name: 'a-spur' }, CYPHER);
  assert.equal(x.code, 403, JSON.stringify(x.j)); assert.equal(x.j.fehler, 'nur_andreas');
  assert.equal(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/abbruch').length, n, 'nichts an den Kern');
  assert.deepEqual((await (await fetch(`${url}/spur`)).json()).map((s) => s.name).sort(), ['a-spur', 'c-spur']);
  assert.equal((await postJson(url, '/spur/stopp', { name: 'c-spur' }, CYPHER)).code, 200);
  assert.equal((await postJson(url, '/spur/stopp', { name: 'a-spur' })).code, 200, 'Andreas stoppt seine eigene');
});

test('Studio S6 Final-Review F4: AUTO aus hält Cyphers Spuren und /regler auf dem Strom, Andreas nie, andere Ströme frei', async (t) => {
  const wo = fs.mkdtempSync(path.join(TMP, 'djk-wirt-'));
  const { o, url, log } = await stapel(t, [], { wirtOrdner: wo, live: true });
  await stromSpuren(o, 1, 2, 3, 5);   // the alias paths erz/<n> need the strom tracks of the live project
  const bass = await fakeWirt(t, wo, 'bass');
  const teile = () => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil').length;
  const mk = (name, ziel, extra = {}) => ({ name, fahrten: [{ ziel, ab_takt: 1, takte: 1, nach: -0.6, ...extra }] });
  assert.equal((await postJson(url, '/strudel/autonom', { an: false, strom: 2 })).code, 200);
  const n0 = teile();
  for (const [name, f] of [['e2', mk('e2', 'erz/2/filter')], ['w2', mk('w2', 'wirt:bass/a_filter1_cutoff', { von: -45 })],
    ['s2', { name: 's2', fahrten: [{ ziel: 'strom:2', ab_takt: 2, muster: 'silence' }] }]]) {
    const x = await postJson(url, '/spur', { spur: f }, CYPHER);
    assert.equal(x.code, 409, `${name} ${JSON.stringify(x.j)}`); assert.equal(x.j.fehler, 'auto_aus', name);
  }
  assert.equal(teile(), n0, 'nichts an den Kern'); assert.equal(bass.length, 0, 'nichts an den Wirt');
  assert.deepEqual(await (await fetch(`${url}/spur`)).json(), [], 'keine Spur liegt herum');
  const reg = await postJson(url, '/regler', { pfad: 'erz/2/filter', nach: -0.6 }, CYPHER);
  assert.equal(reg.code, 409); assert.equal(reg.j.fehler, 'auto_aus');
  // Negativ-Kontrollen: Andreas darf, Cypher auf Strom 3 darf, Cypher auf Strom 2 nach AUTO an darf
  assert.equal((await postJson(url, '/spur', { spur: mk('a2', 'erz/2/filter') })).code, 200);
  assert.equal((await postJson(url, '/regler', { pfad: 'erz/2/filter', nach: -0.5 })).code, 200);
  const c3 = await postJson(url, '/spur', { spur: mk('c3', 'erz/3/filter') }, CYPHER);
  assert.equal(c3.code, 200, JSON.stringify(c3.j));
  assert.equal((await postJson(url, '/strudel/autonom', { an: true, strom: 2 })).code, 200);
  assert.equal((await postJson(url, '/spur', { spur: mk('e2', 'erz/2/filter') }, CYPHER)).code, 200, 'AUTO wieder an');
});
