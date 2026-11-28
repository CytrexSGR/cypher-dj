// Page server against the core stand-in: /loop, /pegel, /klang, FX assignment, restart, Glanz 1.2 runs. Moved from server.test.mjs.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { innen } from './support/inside.mjs';
import { TMP, OHNE_STRUDEL, warte, stapel, sse, post, postJson, geladenesDeck, zustand, CYPHER, bis, fakeWirt, neustart } from './server_test_help.mjs';
// Own temp folder of this file (created in the helper module, one process per file), removed at the end.
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('/loop rec wartet auf die Kern-Quittung: Status 6 kommt in der Antwort an, Status 2 bleibt Erfolg', async (t) => {
  const { o, log, url } = await stapel(t);
  // Fehlerfall: der Kern lehnt REC ab (Attrappe sendet für /k/loop/rec nichts, die Quittung wird eingespeist)
  const p = postJson(url, '/loop', { aktion: 'rec', beats: 4, name: 'q6' }, CYPHER);
  let id;
  for (let i = 0; i < 100 && id === undefined; i++) { id = log.find((z) => z.typ === 'an_kern' && z.adresse === '/k/loop/rec' && z.felder.name === 'q6')?.felder.id; await warte(10); }
  assert.ok(id !== undefined, 'REC ging an den Kern');
  o.vomKern({ adresse: '/q', felder: { id, status: 6, grund: 'ausserhalb_bereich', quelle: 'cypher' } });
  const r = await p;
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.quittung.status, 6, JSON.stringify(r.j));
  assert.equal(r.j.quittung.grund, 'ausserhalb_bereich');
  assert.equal(r.j.felder.name, 'q6');
  // Negativ-Kontrolle: Quittung 2 (läuft) → Status 2 in der Antwort, kein Fehlerstatus
  const p2 = postJson(url, '/loop', { aktion: 'rec', beats: 4, name: 'q2' }, CYPHER);
  let id2;
  for (let i = 0; i < 100 && id2 === undefined; i++) { id2 = log.find((z) => z.typ === 'an_kern' && z.adresse === '/k/loop/rec' && z.felder.name === 'q2')?.felder.id; await warte(10); }
  o.vomKern({ adresse: '/q', felder: { id: id2, status: 2, grund: '', quelle: 'cypher' } });
  const r2 = await p2;
  assert.equal(r2.j.quittung.status, 2, JSON.stringify(r2.j));
});

// Plan djk-hand-mcp-studio T1 (Review): loopKit-Riegel für Quelle cypher: Stop Cypher und AUTO Strom 1 aus (der Zusatz-Kit rec
// hängt am Drums-Erzeuger). Andreas' Hand bleibt frei.
test('/loop kit: cypher bei Stop Cypher → 409 ki_gestoppt, bei AUTO Strom 1 aus → 409 auto_aus; andreas und Normalfall frei', async (t) => {
  const loops = fs.mkdtempSync(path.join(TMP, 'djk-loops-'));
  const kits = fs.mkdtempSync(path.join(TMP, 'djk-kits-'));
  fs.mkdirSync(path.join(kits, 'battery'));
  fs.writeFileSync(path.join(kits, 'battery/kit.json'), JSON.stringify({ schema: 1, name: 'battery',
    klaenge: [{ note: 0, name: 'bd:0', datei: 'bd_0.f32', frames: 1 }] }));
  fs.mkdirSync(path.join(loops, 'c-1'));
  fs.writeFileSync(path.join(loops, 'c-1/loop.f32'), Buffer.alloc(80));
  fs.writeFileSync(path.join(loops, 'c-1/loop.json'), JSON.stringify({ schema: 1, name: 'c-1', takte: 1, frames: 10, datei: 'loop.f32' }));
  const { o, url } = await stapel(t, [], { loops, kits });
  const kit = { aktion: 'kit', name: 'c-1' };
  // Negativ-Kontrolle: alles frei, cypher darf
  assert.equal((await postJson(url, '/loop', kit, CYPHER)).code, 200);
  // Stop Cypher
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 1, grund: 'hand', sample: 0 } });
  let r = await postJson(url, '/loop', kit, CYPHER);
  assert.equal(r.code, 409); assert.equal(r.j.fehler, 'ki_gestoppt');
  assert.equal((await postJson(url, '/loop', kit)).code, 200, 'andreas ist von Stop Cypher nicht betroffen');
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 0, grund: '', sample: 0 } });
  // AUTO Strom 1 aus
  assert.equal((await postJson(url, '/strudel/autonom', { an: false, strom: 1 })).code, 200);
  r = await postJson(url, '/loop', kit, CYPHER);
  assert.equal(r.code, 409); assert.equal(r.j.fehler, 'auto_aus');
  assert.equal((await postJson(url, '/loop', kit)).code, 200, 'andreas hält den Strom selbst');
  // AUTO Strom 2 aus berührt den Drums-Kit nicht
  assert.equal((await postJson(url, '/strudel/autonom', { an: true, strom: 1 })).code, 200);
  assert.equal((await postJson(url, '/strudel/autonom', { an: false, strom: 2 })).code, 200);
  assert.equal((await postJson(url, '/loop', kit, CYPHER)).code, 200);
});

test('GET /pegel: ungedrosselter Puffer liefert Spitze und Median je Kanal, sek außerhalb 1..10 ist 400', async (t) => {
  const { o, url } = await stapel(t);
  // 10 Ereignisse in Folge (weit über der 10-Hz-Drossel der SSE): die Spitze -7,5 darf nicht verloren gehen
  for (const db of [-20, -20, -7.5, -20, -20, -20, -20, -20, -20, -20]) o.vomKern({ adresse: '/pegel', felder: { kanal: 'master', spitze_db: db, lufs_s: -200 } });
  o.vomKern({ adresse: '/pegel', felder: { kanal: 'cue', spitze_db: -200, lufs_s: -200 } });
  const r = await fetch(`${url}/pegel?sek=2`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.sek, 2);
  assert.equal(j.kanaele.master.max_db, -7.5); assert.equal(j.kanaele.master.n, 10);
  assert.equal(j.kanaele.master.median_db, -20);
  assert.equal(j.kanaele.cue.max_db, -200); assert.equal(j.kanaele.cue.median_db, null);
  assert.equal('lufs_s' in j.kanaele.master, false, 'lufs_s wird nicht ausgegeben (Kern liefert immer -200)');
  // Vorgabe 3 s (Negativ-Kontrolle: ohne Parameter kein Fehler)
  assert.equal((await (await fetch(`${url}/pegel`)).json()).sek, 3);
  for (const schlecht of ['0', '11', 'x', '1.5']) {
    const f = await fetch(`${url}/pegel?sek=${schlecht}`);
    assert.equal(f.status, 400, schlecht); assert.equal((await f.json()).fehler, 'sek');
  }
});

// Task 3 (djk-hand-Nachrüstung): POST/GET /klang. JEDER Test hier läuft über ein Stub-Skript (opt.klangBefehl), nie über den
// echten djk-klang: der träfe den laufenden Surge unter /dev/shm/cypherdj/wirt-*.sock.
function klangStub() {
  const d = fs.mkdtempSync(path.join(TMP, 'djk-klangstub-'));
  const f = path.join(d, 'stub');
  fs.writeFileSync(f, `#!${process.execPath}
const a = process.argv.slice(2);
if (a.includes('kaputt')) { process.stderr.write('djk-klang: irgendwas\\nerror: x\\n\\n'); process.exit(1); }
if (a.includes('gross')) { process.stdout.write('x'.repeat(100000)); process.exit(0); }
process.stdout.write(JSON.stringify(a));
`);
  fs.chmodSync(f, 0o755);
  return f;
}
async function klangStapel(t, extra = {}) {
  const d = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const wo = fs.mkdtempSync(path.join(TMP, 'djk-wirt-'));
  const s = await stapel(t, [], { musterOrdner: d, wirtOrdner: wo, klangBefehl: klangStub(), ...extra });
  return { ...s, d, wo };
}

test('T3 /klang: AUTO des Stroms aus sperrt Cypher (409 auto_aus), Andreas nicht; zeige und liste sind frei', async (t) => {
  const { url } = await klangStapel(t);
  assert.equal((await postJson(url, '/strudel/autonom', { an: false, strom: 2 })).code, 200);
  const r = await postJson(url, '/klang', { gruppe: 'bass', aktion: 'lade', name: 'x' }, CYPHER);
  assert.equal(r.code, 409, JSON.stringify(r.j)); assert.equal(r.j.fehler, 'auto_aus');
  assert.match(r.j.text, /AUTO is off/);
  // Negativ-Kontrolle: Andreas (ohne Kopf) ist nicht gesperrt; Melodie (Strom 3, AUTO an) auch nicht
  const a = await postJson(url, '/klang', { gruppe: 'bass', aktion: 'lade', name: 'x' });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal((await postJson(url, '/klang', { gruppe: 'melodie', aktion: 'lade', name: 'x' }, CYPHER)).code, 200);
  // lesend: frei trotz AUTO aus
  assert.equal((await postJson(url, '/klang', { gruppe: 'bass', aktion: 'zeige' }, CYPHER)).code, 200);
  assert.equal((await postJson(url, '/klang', { aktion: 'liste', filter: 'Lead' }, CYPHER)).code, 200);
});

test('T3 /klang: fremde Herkunft und falscher content-type wie bei /strudel (403, 415)', async (t) => {
  const { url } = await klangStapel(t);
  const f = await fetch(`${url}/klang`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://boese.example' }, body: JSON.stringify({ gruppe: 'bass', aktion: 'zeige' }) });
  assert.equal(f.status, 403);
  const g = await fetch(`${url}/klang`, { method: 'POST', body: JSON.stringify({ gruppe: 'bass', aktion: 'zeige' }) });
  assert.equal(g.status, 415);
});

test('T3 /klang: unbekannte Gruppe oder Aktion, setze mit Nicht-Zahl, Name außerhalb der Regel, Wert mit - vorne → 400', async (t) => {
  const { url } = await klangStapel(t);
  const p = (d) => postJson(url, '/klang', d, CYPHER);
  assert.equal((await p({ gruppe: 'drums', aktion: 'zeige' })).code, 400);
  assert.equal((await p({ gruppe: 'bass', aktion: 'loesche' })).code, 400);
  assert.equal((await p({ gruppe: 'bass', aktion: 'setze', werte: { a_x: 'laut' } })).code, 400);
  assert.equal((await p({ gruppe: 'bass', aktion: 'setze', werte: {} })).code, 400);
  assert.equal((await p({ gruppe: 'bass', aktion: 'speichere', name: 'Gross Name!' })).code, 400);
  for (const d of [{ aktion: 'lade', name: '--instanz' }, { aktion: 'zeige', filter: '-h' }, { aktion: 'setze', werte: { '-x': 1 } }, { aktion: 'fahre', parameter: '-h', ziel: 0, sekunden: 1 }]) {
    const r = await p({ gruppe: 'bass', ...d });
    assert.equal(r.code, 400, JSON.stringify(d)); assert.equal(r.j.fehler, 'argument', JSON.stringify(d));
  }
  const l = await p({ aktion: 'liste', filter: '-h' });
  assert.equal(l.code, 400); assert.equal(l.j.fehler, 'argument');
});

test('T3 /klang: argv geht ohne Shell durch, ein Name mit Leerzeichen bleibt EIN Element; Instanz vorne; liste ohne Gruppe', async (t) => {
  const { url } = await klangStapel(t);
  const p = (d) => postJson(url, '/klang', d, CYPHER);
  const lade = await p({ gruppe: 'bass', aktion: 'lade', name: 'Chords/Minor Chord Retro Stab' });
  assert.equal(lade.code, 200, JSON.stringify(lade.j)); assert.equal(lade.j.ok, true);
  assert.deepEqual(JSON.parse(lade.j.text).slice(-3), ['bass', 'lade', 'Chords/Minor Chord Retro Stab']);
  const setze = JSON.parse((await p({ gruppe: 'melodie', aktion: 'setze', werte: { a_filter1_type: 2, b_x: -3.5 } })).j.text);
  assert.deepEqual(setze.slice(-4), ['melodie', 'setze', 'a_filter1_type=2', 'b_x=-3.5'], JSON.stringify(setze));
  const liste = JSON.parse((await p({ aktion: 'liste', filter: 'Leads/Acid' })).j.text);
  assert.deepEqual(liste.slice(-2), ['liste', 'Leads/Acid']); assert.ok(!liste.includes('bass') && !liste.includes('melodie'), JSON.stringify(liste));
  const hoere = JSON.parse((await p({ gruppe: 'bass', aktion: 'hoere', note: 40, dauer: 2 })).j.text);
  assert.deepEqual(hoere.slice(-4), ['bass', 'hoere', '40', '2']);
  const zeige = JSON.parse((await p({ gruppe: 'bass', aktion: 'zeige', filter: 'cutoff' })).j.text);
  assert.deepEqual(zeige.slice(-3), ['bass', 'zeige', 'cutoff']);
  const sp = JSON.parse((await p({ gruppe: 'bass', aktion: 'speichere', name: 'mein-bass_1' })).j.text);
  assert.deepEqual(sp.slice(-3), ['bass', 'speichere', 'mein-bass_1']);
});

test('T3 /klang: Exit 1 → 400 mit letzter nicht-leerer stderr-Zeile; Ausgabe über 32 KB wird gekappt (abgeschnitten)', async (t) => {
  const { url } = await klangStapel(t);
  const k = await postJson(url, '/klang', { gruppe: 'bass', aktion: 'lade', name: 'kaputt' }, CYPHER);
  assert.equal(k.code, 400, JSON.stringify(k.j)); assert.equal(k.j.fehler, 'error: x');
  const g = await postJson(url, '/klang', { gruppe: 'bass', aktion: 'lade', name: 'gross' }, CYPHER);
  assert.equal(g.code, 200); assert.equal(g.j.abgeschnitten, true); assert.ok(g.j.text.length <= 32768, String(g.j.text.length));
  // Negativ-Kontrolle: kleine Ausgabe trägt kein abgeschnitten
  const n = await postJson(url, '/klang', { gruppe: 'bass', aktion: 'lade', name: 'x' }, CYPHER);
  assert.ok(!n.j.abgeschnitten);
});

test('T3 /klang fahre: geht als Wirt-Befehl an den Socket (spur klang-<gruppe>, linear), Parameter gegen fahrbar, AUTO-Riegel', async (t) => {
  const { url, wo } = await klangStapel(t);
  const bass = await fakeWirt(t, wo, 'bass');
  const p = (d) => postJson(url, '/klang', d, CYPHER);
  const r = await p({ gruppe: 'bass', aktion: 'fahre', parameter: 'volume', ziel: -12, sekunden: 15, von: -40 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(bass.at(-1), { befehl: 'fahre', name: 'volume', bis: -12, dauer: 15, spur: 'klang-bass', form: 'linear', von: -40 });
  await p({ gruppe: 'bass', aktion: 'fahre', parameter: 'volume', ziel: 0, sekunden: 2 });
  assert.deepEqual(bass.at(-1), { befehl: 'fahre', name: 'volume', bis: 0, dauer: 2, spur: 'klang-bass', form: 'linear' });   // ohne von, ohne ab
  const n = bass.length;
  const nf = await p({ gruppe: 'bass', aktion: 'fahre', parameter: 'a_filter1_type', ziel: 1, sekunden: 2 });
  assert.equal(nf.code, 400); assert.equal(nf.j.fehler, 'nicht_fahrbar');
  assert.equal((await p({ gruppe: 'bass', aktion: 'fahre', parameter: 'volume', ziel: 'x', sekunden: 2 })).code, 400);
  assert.equal((await p({ gruppe: 'bass', aktion: 'fahre', parameter: 'volume', ziel: 0, sekunden: 601 })).code, 400);
  assert.equal(bass.length, n, 'abgewiesenes erreicht den Wirt nicht');
  // Wirt fehlt: 409 wirt (melodie hat keinen Socket)
  const m = await p({ gruppe: 'melodie', aktion: 'fahre', parameter: 'volume', ziel: 0, sekunden: 2 });
  assert.equal(m.code, 409); assert.equal(m.j.fehler, 'wirt');
  // AUTO aus → 409, Andreas frei
  await postJson(url, '/strudel/autonom', { an: false, strom: 2 });
  assert.equal((await p({ gruppe: 'bass', aktion: 'fahre', parameter: 'volume', ziel: 0, sekunden: 2 })).j.fehler, 'auto_aus');
  assert.equal((await postJson(url, '/klang', { gruppe: 'bass', aktion: 'fahre', parameter: 'volume', ziel: 0, sekunden: 2 })).code, 200);
});

test('front panels /klang ist: reads the host display values (read-only: no AUTO lock for Cypher), names against fahrbar, host missing is 409', async (t) => {
  const { url, wo } = await klangStapel(t);
  const bass = await fakeWirt(t, wo, 'bass', { ok: true, werte: { a_filter1_cutoff: 5 } });
  const p = (d) => postJson(url, '/klang', d, CYPHER);
  await postJson(url, '/strudel/autonom', { an: false, strom: 2 });   // locks fahre for Cypher; a read stays free
  const r = await p({ gruppe: 'bass', aktion: 'ist', parameter: ['a_filter1_cutoff'] });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.werte, { a_filter1_cutoff: 5 });
  assert.deepEqual(bass.at(-1), { befehl: 'ist', namen: ['a_filter1_cutoff'] });
  const n = bass.length;
  assert.equal((await p({ gruppe: 'bass', aktion: 'ist', parameter: ['a_filter1_type'] })).j.fehler, 'nicht_fahrbar');
  assert.equal((await p({ gruppe: 'bass', aktion: 'ist', parameter: [] })).code, 400);
  assert.equal((await p({ gruppe: 'bass', aktion: 'ist' })).code, 400);
  assert.equal(bass.length, n, 'refused requests do not reach the host');
  const m = await p({ gruppe: 'melodie', aktion: 'ist', parameter: ['a_filter1_cutoff'] });
  assert.equal(m.code, 409); assert.equal(m.j.fehler, 'wirt');
});

test('Surge window /klang fenster: Andreas only (403 for Cypher), an must be boolean, goes to the host as `fenster`, the host reason comes back, no host is 409', async (t) => {
  const { url, wo } = await klangStapel(t);
  const bass = await fakeWirt(t, wo, 'bass', { ok: true, fenster: false, grund: 'keine_anzeige' });
  const n = bass.length;
  const c = await postJson(url, '/klang', { gruppe: 'bass', aktion: 'fenster', an: true }, CYPHER);
  assert.equal(c.code, 403, JSON.stringify(c.j)); assert.equal(c.j.fehler, 'nur_andreas');
  assert.equal((await postJson(url, '/klang', { gruppe: 'bass', aktion: 'fenster', an: 'ja' })).code, 400);
  assert.equal((await postJson(url, '/klang', { gruppe: 'bass', aktion: 'fenster' })).code, 400);
  assert.equal((await postJson(url, '/klang', { aktion: 'fenster', an: true })).code, 400);
  assert.equal(bass.length, n, 'refused requests do not reach the host');
  const r = await postJson(url, '/klang', { gruppe: 'bass', aktion: 'fenster', an: true });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j, { ok: true, fenster: false, grund: 'keine_anzeige' });
  assert.deepEqual(bass.at(-1), { befehl: 'fenster', an: true });
  await postJson(url, '/strudel/autonom', { an: false, strom: 2 });   // AUTO off locks Cypher's writes; Andreas' window button is not one of them
  assert.equal((await postJson(url, '/klang', { gruppe: 'bass', aktion: 'fenster', an: false })).code, 200);
  const m = await postJson(url, '/klang', { gruppe: 'melodie', aktion: 'fenster', an: true });
  assert.equal(m.code, 409); assert.equal(m.j.fehler, 'wirt');
});

test('Cypher Modular S2 /klang param: geht als Wirt-Befehl an den Socket, wert 0..1, AUTO-Riegel nur für Cypher, Wirt-Fehler → 409', async (t) => {
  const { url, wo } = await klangStapel(t);
  const mel = await fakeWirt(t, wo, 'melodie');
  const p = (d) => postJson(url, '/klang', d, CYPHER);
  const r = await p({ gruppe: 'melodie', aktion: 'param', name: 'Knob 1', wert: 0.25 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(mel.at(-1), { befehl: 'param', name: 'Knob 1', wert: 0.25 });
  const n = mel.length;
  for (const falsch of [{ wert: 1.5 }, { wert: -0.1 }, { wert: '0.5' }, { name: '-x' }, { name: '' }, { name: 'Volume' }, { name: 'Knob 65' }, { name: 'Knob 0' }, { name: 'Knob 01' }, { name: 'Knob 100' }]) {
    const f = await p({ gruppe: 'melodie', aktion: 'param', name: 'Knob 1', wert: 0.5, ...falsch });
    assert.equal(f.code, 400, JSON.stringify(falsch));
  }
  assert.equal(mel.length, n, 'abgewiesenes erreicht den Wirt nicht');
  // bass hat keinen Socket: 409 wirt
  const b = await p({ gruppe: 'bass', aktion: 'param', name: 'Knob 1', wert: 0.5 });
  assert.equal(b.code, 409); assert.equal(b.j.fehler, 'wirt');
  // AUTO aus (melodie = Strom 3) → Cypher 409, Andreas frei
  await postJson(url, '/strudel/autonom', { an: false, strom: 3 });
  assert.equal((await p({ gruppe: 'melodie', aktion: 'param', name: 'Knob 1', wert: 0.5 })).j.fehler, 'auto_aus');
  assert.equal((await postJson(url, '/klang', { gruppe: 'melodie', aktion: 'param', name: 'Knob 2', wert: 1 })).code, 200);
  assert.deepEqual(mel.at(-1), { befehl: 'param', name: 'Knob 2', wert: 1 });
  for (const name of ['Knob 9', 'Knob 17', 'Knob 32', 'Knob 33', 'Knob 64']) assert.equal((await postJson(url, '/klang', { gruppe: 'melodie', aktion: 'param', name, wert: 0.5 })).code, 200, `${name} passes`);
  assert.deepEqual(mel.at(-1), { befehl: 'param', name: 'Knob 64', wert: 0.5 });
});

test('live host panels /klang param: the seven RB-338 names only on a vst3:rb338 host, other names and other hosts stay refused', async (t) => {
  const { url, wo } = await klangStapel(t);
  const bass = await fakeWirt(t, wo, 'bass');
  const mel = await fakeWirt(t, wo, 'melodie');
  const p = (d) => postJson(url, '/klang', d, CYPHER);
  const RB = ['Volume', 'Square', 'Cutoff', 'Resonance', 'Env Mod', 'Decay', 'Accent'];
  // no status file: refused
  assert.equal((await p({ gruppe: 'bass', aktion: 'param', name: 'Cutoff', wert: 0.5 })).code, 400);
  fs.writeFileSync(path.join(wo, 'wirt-bass.json'), JSON.stringify({ art: 'vst3:rb338', plugin: 'RB-338' }));
  fs.writeFileSync(path.join(wo, 'wirt-melodie.json'), JSON.stringify({ art: 'vst3:baukasten' }));
  for (const name of RB) assert.equal((await p({ gruppe: 'bass', aktion: 'param', name, wert: 0.5 })).code, 200, name);
  assert.deepEqual(bass.at(-1), { befehl: 'param', name: 'Accent', wert: 0.5 });
  assert.equal((await p({ gruppe: 'bass', aktion: 'param', name: 'Knob 1', wert: 0.5 })).code, 200, 'Knob names stay allowed');
  const n = bass.length;
  for (const name of ['cutoff', 'Cutoff ', 'Master', 'Bypass', 'Env  Mod', 'lautstaerke', '']) assert.equal((await p({ gruppe: 'bass', aktion: 'param', name, wert: 0.5 })).code, 400, JSON.stringify(name));
  assert.equal((await p({ gruppe: 'bass', aktion: 'param', name: 'Cutoff', wert: 1.5 })).code, 400);
  assert.equal(bass.length, n, 'refused requests do not reach the host');
  // a Baukasten host (or any other) does not take the RB names
  const m = mel.length;
  assert.equal((await p({ gruppe: 'melodie', aktion: 'param', name: 'Cutoff', wert: 0.5 })).code, 400);
  assert.equal(mel.length, m);
  fs.writeFileSync(path.join(wo, 'wirt-bass.json'), JSON.stringify({ art: 'lv2' }));
  assert.equal((await p({ gruppe: 'bass', aktion: 'param', name: 'Cutoff', wert: 0.5 })).code, 400);
});

test('Cypher Modular S2 /klang param: lehnt der Wirt ab (Surge kennt param nicht), kommt sein Text als 409 zurück', async (t) => {
  const { url, wo } = await klangStapel(t);
  await fakeWirt(t, wo, 'bass', { ok: false, fehler: "unbekannter Befehl 'param'" });
  const r = await postJson(url, '/klang', { gruppe: 'bass', aktion: 'param', name: 'Knob 1', wert: 0.5 }, CYPHER);
  assert.equal(r.code, 409); assert.equal(r.j.fehler, 'wirt'); assert.match(r.j.text, /param/);
});

test('Cypher Modular S2 /klang params: Ist-Werte vom Wirt, Namen aus baukasten-<gruppe>.json, lesend auch bei AUTO aus', async (t) => {
  const bk = fs.mkdtempSync(path.join(TMP, 'djk-baukasten-'));
  const { url, wo } = await klangStapel(t, { baukastenOrdner: bk });
  const mel = await fakeWirt(t, wo, 'melodie', { ok: true, params: { Volume: 0.75, 'Knob 1': 0.5 } });
  const p = () => postJson(url, '/klang', { gruppe: 'melodie', aktion: 'params' }, CYPHER);
  // ohne Graphdatei: keine Namen
  let r = await p();
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j, { ok: true, params: { Volume: 0.75, 'Knob 1': 0.5 }, namen: {} });
  assert.deepEqual(mel.at(-1), { befehl: 'params' });
  fs.writeFileSync(path.join(bk, 'baukasten-melodie.json'), JSON.stringify({ regler_namen: { 1: 'Cutoff', 8: 'Noise', 9: 'Nine', 32: 'Last', 64: 'Top', 65: 'zu viel', 0: 'zero', 2: 'x'.repeat(41) } }));
  r = await p();
  assert.deepEqual(r.j.namen, { 'Knob 1': 'Cutoff', 'Knob 8': 'Noise', 'Knob 9': 'Nine', 'Knob 32': 'Last', 'Knob 64': 'Top' });
  fs.writeFileSync(path.join(bk, 'baukasten-melodie.json'), '{kaputt');
  assert.deepEqual((await p()).j.namen, {});
  await postJson(url, '/strudel/autonom', { an: false, strom: 3 });
  assert.equal((await p()).code, 200, 'params ist lesend');
  // ohne Wirt: 409
  assert.equal((await postJson(url, '/klang', { gruppe: 'bass', aktion: 'params' }, CYPHER)).code, 409);
});

test('T3 /abbruch als cypher und Stop Cypher schicken halte klang-bass / klang-melodie an die Wirte', async (t) => {
  const { o, url, wo } = await klangStapel(t);
  const bass = await fakeWirt(t, wo, 'bass');
  const mel = await fakeWirt(t, wo, 'melodie');
  assert.equal((await postJson(url, '/abbruch', {}, CYPHER)).code, 200);
  assert.deepEqual(bass.filter((z) => z.befehl === 'halte'), [{ befehl: 'halte', spur: 'klang-bass' }]);
  assert.deepEqual(mel.filter((z) => z.befehl === 'halte'), [{ befehl: 'halte', spur: 'klang-melodie' }]);
  o.kern.sende('/k/ki/stopp', { id: Number(++o.id), quelle: 'andreas' });
  for (let i = 0; i < 200 && bass.filter((z) => z.befehl === 'halte').length < 2; i++) await warte(20);
  assert.equal(bass.filter((z) => z.befehl === 'halte' && z.spur === 'klang-bass').length, 2, JSON.stringify(bass));
  // Negativ-Kontrolle: Andreas' /abbruch ist 403 und hält nichts
  const n = bass.length;
  assert.equal((await postJson(url, '/abbruch', {})).code, 403);
  assert.equal(bass.length, n);
});

test('T3 GET /klang: liest wirt-<gruppe>.json aus dem Wirt-Ordner, fehlende Datei → null', async (t) => {
  const { url, wo } = await klangStapel(t);
  fs.writeFileSync(path.join(wo, 'wirt-bass.json'), JSON.stringify({ klang: 'Leads/X', pid: 1 }));
  const r = await (await fetch(`${url}/klang`)).json();
  assert.deepEqual(r, { bass: { klang: 'Leads/X', pid: 1 }, melodie: null });
});

// Task 4 (djk-hand-Nachrüstung): /lage trägt den Studio-Zustand (AUTO/Muster je Strom, geladener Surge-Klang).
test('T4 /lage.studio: 3 Ströme mit autonom/von/text_kurz (200 Zeichen), klang aus wirt-<g>.json, alte Schlüssel bleiben', { skip: OHNE_STRUDEL }, async (t) => {
  const { url, wo } = await klangStapel(t, { live: true });
  const l0 = await (await fetch(`${url}/lage`)).json();
  for (const k of ['uhr', 'ki', 'decks', 'regler', 'fx', 'fx_routing', 'quittungen']) assert.ok(k in l0, `alter Schlüssel ${k}`);
  assert.equal(l0.studio.stroeme.length, 3);
  assert.deepEqual(l0.studio.stroeme.map((s) => s.strom), [1, 2, 3]);
  assert.ok(l0.studio.stroeme.every((s) => s.autonom === true && s.text_kurz === '' && s.von === null));
  assert.deepEqual(l0.studio.klang, { bass: null, melodie: null }, 'ohne Wirt-Datei null');
  // Fehlerfall/Wirkung: AUTO von Strom 2 aus, langes Muster in Strom 3, Klang im Bass
  assert.equal((await postJson(url, '/strudel/autonom', { an: false, strom: 2 })).code, 200);
  const lang = 's("bd*4")' + ' // ' + 'x'.repeat(300);
  assert.equal((await postJson(url, '/strudel', { text: lang, strom: 3 })).code, 200);
  fs.writeFileSync(path.join(wo, 'wirt-bass.json'), JSON.stringify({ klang: 'Leads/X (edited)', pid: 1 }));
  const l = await (await fetch(`${url}/lage`)).json();
  assert.equal(l.studio.stroeme[1].autonom, false);
  assert.equal(l.studio.stroeme[0].autonom, true, 'Negativ-Kontrolle: Strom 1 unberührt');
  assert.equal(l.studio.stroeme[2].text_kurz, lang.slice(0, 200));
  assert.equal(l.studio.stroeme[2].von, 'andreas');
  assert.deepEqual(l.studio.klang, { bass: 'Leads/X (edited)', melodie: null });
});

test('Riegel 2026-09-30: /griff /taste /laden /loop ohne json 415, fremde Herkunft 403, nichts an den Kern', async (t) => {
  const { url, log } = await geladenesDeck(t);
  const vorher = log.filter((l) => l.typ === 'an_kern').length;
  const faelle = [['/griff', { pfad: 'deck/1/fader', u: 0.5 }], ['/taste', { name: 'play/1' }], ['/laden', { deck: 1, material_id: 'x' }],
    ['/loop', { aktion: 'stopp', box: 1 }]];
  for (const [p, d] of faelle) {
    const r = await post(url, p, d);
    assert.equal(r.code, 415, p); assert.equal(r.j.fehler, 'nur_json', p);
    const f = await postJson(url, p, d, { origin: 'https://boese.example' });
    assert.equal(f.code, 403, p); assert.equal(f.j.fehler, 'fremde_herkunft', p);
  }
  assert.equal(log.filter((l) => l.typ === 'an_kern').length, vorher, 'Abweisungen senden nichts an den Kern');
  // Negativ-Kontrolle: mit json und eigener Herkunft kommt die Anfrage an (Griff auf ein gültiges Ziel)
  const g = await postJson(url, '/griff', { pfad: 'deck/1/fader', u: 0.5 }, { origin: url });
  assert.notEqual(g.code, 415); assert.notEqual(g.code, 403);
});

test('Riegel 2026-09-30: Stop Cypher überlebt einen Server-Neustart über /zustand/kern (ki_gestoppt)', async (t) => {
  const { o, url } = await geladenesDeck(t);
  const fx1 = { einheit: 1, art: 1, beats: 1, wet: 0.5, param1: 0.5, param2: 0.5, param3: 0.5, an: true };
  // Stop Cypher is set in the kern stand-in (a separate process): from then on every one of its 50 ms /zustand/kern ticks reports ki_gestoppt 1,
  // so no tick can take the state back. Then the server forgets it, as a restart does, and has to learn it again from /zustand/kern alone.
  // (An earlier version injected the word into the server and retried up to 20 times; a lost or late state would have passed.)
  const ki = innen(o);
  await ki.kiStopp(true);
  o.setzeKiGestoppt(false);
  assert.equal(o.kiGestoppt, false, 'the restarted server knows nothing');
  for (let i = 0; i < 150 && o.kiGestoppt !== true; i++) await warte(20);   // only the arrival of the next tick is awaited
  assert.equal(o.kiGestoppt, true, 'the server took ki_gestoppt over from /zustand/kern');
  const antwort = await postJson(url, '/fx', fx1, CYPHER);   // the FIRST request after the restart is refused
  assert.equal(antwort.j.fehler, 'ki_gestoppt');
  const lage = await (await fetch(`${url}/lage`)).json();
  assert.equal(lage.ki.gestoppt, true);
  // Freigabe kommt ebenfalls über den Zustand an (the stand-in lets go, the next tick reports 0)
  await ki.kiStopp(false);
  assert.equal((await postJson(url, '/fx', fx1, CYPHER)).code, 200);
});

test('Welle 3 (ADR 028): POST /tempo bei laufendem Deck nimmt der Kern an (bis Welle 2 Quittung 6 kein_stretcher)', async (t) => {
  const { o, url } = await geladenesDeck(t);
  assert.equal((await postJson(url, '/deck/start', { deck: 1 })).code, 200);
  for (let i = 0; i < 100 && !(Number(o.stand.decks['1']?.status) >= 2); i++) await warte(20);
  assert.ok(Number(o.stand.decks['1']?.status) >= 2, `Deck 1 läuft (status=${o.stand.decks['1']?.status})`);
  const r = await postJson(url, '/tempo', { bpm: 132 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.ok([1, 2].includes(r.j.quittung?.status), `angenommen oder laufend, nicht 6: ${JSON.stringify(r.j.quittung)}`);
});

test('Keylock 3 (Fassung 4): EIN Knopf keylock für alle Quellen: POST /regler keylock 0 → 200, /k/teil, /lage zeigt ihn; Render-und-Tausch ist aus (kein /k/deck/basis_tausch bei Tempo 132)', async (t) => {
  const { o, url, log } = await geladenesDeck(t);
  assert.equal((await postJson(url, '/deck/start', { deck: 1 })).code, 200);
  for (let i = 0; i < 100 && !(Number(o.stand.decks['1']?.status) >= 2); i++) await warte(20);
  // 3b: /lage zeigt den Knopf immer (der Kern, hier die Attrappe, meldet ihn dem neuen Abonnenten beim ersten /k/hallo: 1),
  // kein Feld keylock je Deck mehr
  for (let i = 0; i < 100 && o.stand.regler.keylock === undefined; i++) await warte(20);
  let lage = await (await fetch(url + '/lage')).json();
  assert.equal(lage.regler.keylock, 1, JSON.stringify(lage.regler));
  assert.equal('keylock' in lage.decks[0], false, JSON.stringify(lage.decks[0]));
  assert.equal(lage.decks[0].hoerweg, 0, JSON.stringify(lage.decks[0]));   // 3b: Hörweg aus /zustand/deck (Attrappe: 0)
  const r = await postJson(url, '/regler', { pfad: 'keylock', nach: 0, ab: 'jetzt' }, CYPHER);   // Quelle cypher darf
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.felder.pfad, 'keylock'); assert.equal(r.j.felder.quelle, 'cypher'); assert.equal(r.j.felder.dauer_beats, 0);
  assert.equal(r.j.felder.politik, 1);   // 3b: zu spät heißt sofort, nicht verworfen
  assert.ok([1, 2, 3].includes(r.j.quittung?.status), JSON.stringify(r.j.quittung));
  for (let i = 0; i < 200 && o.stand.regler.keylock !== 0; i++) await warte(20);
  assert.equal(o.stand.regler.keylock, 0);
  lage = await (await fetch(url + '/lage')).json();
  assert.equal(lage.regler.keylock, 0, JSON.stringify(lage.regler));
  // kein Deck-Pfad
  assert.equal((await postJson(url, '/regler', { pfad: 'deck/1/keylock', nach: 0 }, CYPHER)).code, 400);
  // Render-und-Tausch (Welle 3 Task 6) ist ausgebaut: Tempo 132 bei laufendem Deck schickt keinen Tausch, rendert nichts
  const tp = await postJson(url, '/tempo', { bpm: 132 });
  assert.ok([1, 2].includes(tp.j.quittung?.status), JSON.stringify(tp.j));
  await warte(1500);
  assert.equal(log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/deck/basis_tausch').length, 0);
  assert.equal(log.filter((z) => String(z.typ).startsWith('keylock')).length, 0, JSON.stringify(log.filter((z) => String(z.typ).startsWith('keylock'))));
  // wieder an
  assert.equal((await postJson(url, '/regler', { pfad: 'keylock', nach: 1, ab: 'jetzt' })).code, 200);
  for (let i = 0; i < 200 && o.stand.regler.keylock !== 1; i++) await warte(20);
  lage = await (await fetch(url + '/lage')).json();
  assert.equal(lage.regler.keylock, 1, JSON.stringify(lage.regler));
  // unbekannt (kein /e/regler keylock gesehen): ausdrücklich null, nicht stillschweigend an
  delete o.stand.regler.keylock;
  lage = await (await fetch(url + '/lage')).json();
  assert.equal(lage.regler.keylock, null, JSON.stringify(lage.regler));
});

test('Plan Tempo-Folge: POST /tempo schickt /k/tempo/rampe über einen Takt ab der nächsten Eins; cypher darf, bei Stop Cypher 409 ki_gestoppt; falsche Werte 400', async (t) => {
  const { o, log, url } = await stapel(t);
  const vorher = o.gesendet;
  for (const body of [{ bpm: 59.99 }, { bpm: 200.01 }, { bpm: 'schnell' }, {}]) {
    assert.equal((await postJson(url, '/tempo', body)).code, 400, JSON.stringify(body));
  }
  o.vomKern({ adresse: '/zustand/kern', felder: { generation: 1, ki_gestoppt: 1 } });
  const c = await postJson(url, '/tempo', { bpm: 130 }, CYPHER);
  assert.equal(c.code, 409);
  assert.equal(c.j.fehler, 'ki_gestoppt');
  assert.equal(o.gesendet, vorher, 'Abgelehntes geht nicht an den Kern');
  o.vomKern({ adresse: '/zustand/kern', felder: { generation: 1, ki_gestoppt: 0 } });
  const cy = await postJson(url, '/tempo', { bpm: 131 }, CYPHER);
  assert.equal(cy.code, 200, JSON.stringify(cy.j));
  const anC = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/tempo/rampe').map((z) => z.felder);
  assert.equal(anC.length, 1);
  assert.equal(anC[0].quelle, 'cypher');
  assert.equal(anC[0].ziel_bpm, 131);
  const r = await postJson(url, '/tempo', { bpm: 130.456 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const an = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/tempo/rampe').map((z) => z.felder);
  assert.equal(an.length, 2);
  an.shift();
  assert.equal(an[0].quelle, 'andreas');
  assert.equal(an[0].ziel_bpm, 130.46, 'auf 0,01 BPM gerundet');
  assert.equal(an[0].dauer_beats, 4);
  assert.equal(an[0].ab_beat % 4, 0, 'ab der nächsten Takt-Eins');
  assert.notEqual(r.j.quittung?.status, 6);
});

// Paket 2 Slice 5 (F07): FX nach einem Kern-Neustart wiederherstellen (the loop boxes are gone with the container core). Der Neustart-Zustand des Kerns
// trägt keine FX-Einheiten; der Server merkt sie vor dem Leeren und schickt sie 500 ms nach /e/neustart erneut.
const fxFelder = (e, extra = {}) => ({ einheit: e, art: 2, beats: 1, wet: 0.6, param1: 0.4, param2: 0.5, param3: 0.5, an: 1, ...extra });
const fxVon = (d, von) => fs.writeFileSync(path.join(d, 'fx_von.json'), JSON.stringify(Object.fromEntries(Object.entries(von).map(([k, v]) => [k, { von: v, zeit: 1 }]))));
const kernBefehle = (log, ab = 0) => log.filter((z) => z.typ === 'an_kern' && /^\/k\/fx/.test(z.adresse)).slice(ab);
async function nachNeustart(o, log, generation, vorher, erwartet) {
  o.vomKern({ adresse: '/e/neustart', felder: { generation, sample: 0 } });
  await warte(erwartet === 0 ? 900 : 600);
  for (let i = 0; i < 100 && kernBefehle(log, vorher).length < erwartet; i++) await warte(20);
  await warte(100);
  return kernBefehle(log, vorher);
}

test('Slice 5 F07 B12: bei Stop Cypher kommen Cyphers FX nicht zurück, Andreas\' schon', async (t) => {
  const d = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const { o, log } = await stapel(t, [], { musterOrdner: d });
  fxVon(d, { 1: 'cypher', 2: 'andreas' });
  o.vomKern({ adresse: '/e/fx', felder: fxFelder(1) });
  o.vomKern({ adresse: '/e/fx', felder: fxFelder(2, { art: 1, beats: 0.5 }) });
  o.kern.sende('/k/ki/stopp', { id: Number(++o.id), quelle: 'andreas' });   // echter Stopp: die Attrappe meldet ki_gestoppt auch in /zustand/kern
  for (let i = 0; i < 100 && !o.kiGestoppt; i++) await warte(20);
  assert.equal(o.kiGestoppt, true);
  const n0 = kernBefehle(log).length;
  const b = await nachNeustart(o, log, 31, n0, 1);
  assert.deepEqual(b.map((z) => [z.adresse, z.felder.einheit, z.felder.quelle]), [['/k/fx', 2, 'andreas']]);
});

test('Slice 5 F07 B13: höchstens eine Wiederherstellung je 30 s, die zweite wird gemeldet', async (t) => {
  const d = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const { o, log } = await stapel(t, [], { musterOrdner: d });
  fxVon(d, { 1: 'andreas' });
  o.vomKern({ adresse: '/e/fx', felder: fxFelder(1) });
  const n0 = kernBefehle(log).length;
  assert.equal((await nachNeustart(o, log, 41, n0, 1)).length, 1, 'erste Wiederherstellung: fx');
  o.vomKern({ adresse: '/e/fx', felder: fxFelder(1) });   // der Kern meldet die Einheit wieder
  const n1 = kernBefehle(log).length;
  assert.deepEqual(await nachNeustart(o, log, 42, n1, 0), [], 'zweiter Neustart innerhalb von 30 s: nichts');
  assert.ok(log.some((z) => z.typ === 'wiederherstellung_uebersprungen' && z.grund === 'zu_schnell'), JSON.stringify(log.slice(-5)));
});

test('Slice 5 F07: FX-Einheiten und Zuweisungen kommen mit Werten und Besitzer zurück, fx_von.json bleibt', async (t) => {
  const d = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const { o, log } = await stapel(t, [], { musterOrdner: d });
  const von = JSON.stringify({ '1': { von: 'cypher', zeit: 1 }, '2': { von: 'andreas', zeit: 2 } });
  fs.writeFileSync(path.join(d, 'fx_von.json'), von);
  o.vomKern({ adresse: '/e/fx', felder: { einheit: 1, art: 2, beats: 1, wet: 0.6, param1: 0.4, param2: 0.5, param3: 0.5, an: 1 } });
  o.vomKern({ adresse: '/e/fx', felder: { einheit: 2, art: 3, beats: 4, wet: 0.3, param1: 0.1, param2: 0.2, param3: 0.9, an: 0 } });   // off, no assignment: its kind comes back, the unit stays off (t_7f487235)
  o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 1, kanal: 'deck/1', an: 1 } });
  o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 1, kanal: 'master', an: 1 } });
  o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 1, kanal: 'deck/2', an: 0 } });
  const n0 = kernBefehle(log).length;
  const b = await nachNeustart(o, log, 51, n0, 4);
  assert.deepEqual(b.map((z) => ({ ...z.felder, id: 0 })), [
    { id: 0, quelle: 'cypher', einheit: 1, art: 2, beats: 1, wet: 0.6, param1: 0.4, param2: 0.5, param3: 0.5, an: 1 },
    { id: 0, quelle: 'cypher', einheit: 1, kanal: 'deck/1', an: 1 },
    { id: 0, quelle: 'cypher', einheit: 1, kanal: 'master', an: 1 },
    { id: 0, quelle: 'andreas', einheit: 2, art: 3, beats: 4, wet: 0.3, param1: 0.1, param2: 0.2, param3: 0.9, an: 0 }]);
  assert.equal(fs.readFileSync(path.join(d, 'fx_von.json'), 'utf8'), von, 'fx_von.json unverändert (Besitzer bleibt)');
});

// Slice 5 Review-Nacharbeit (F1 bis F7)
const formS5 = (z) => `${z.adresse}|e${z.felder.einheit}|${z.felder.quelle}`;
async function stoppCypherS5(o) {
  o.kern.sende('/k/ki/stopp', { id: Number(++o.id), quelle: 'andreas' });
  for (let i = 0; i < 100 && !o.kiGestoppt; i++) await warte(20);
  assert.equal(o.kiGestoppt, true);
}

test('Slice 5 Review F3: was in den 500 ms neu gesetzt wird, bleibt von der Wiederherstellung unberührt', async (t) => {
  const d = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const { o, log, url } = await stapel(t, [], { musterOrdner: d });
  fxVon(d, { 1: 'andreas', 2: 'andreas' });
  o.vomKern({ adresse: '/e/fx', felder: fxFelder(1) });
  o.vomKern({ adresse: '/e/fx', felder: fxFelder(2) });
  const n0 = kernBefehle(log).length;
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 91, sample: 0 } });
  await warte(100);
  const r = await postJson(url, '/fx', { ...fxFelder(1), an: false });   // Andreas setzt FX 1 im 500-ms-Fenster
  assert.equal(r.code, 200);
  await warte(900);
  const b = kernBefehle(log, n0).map(formS5);
  assert.deepEqual(b.filter((x) => /\|e1\|/.test(x)), ['/k/fx|e1|andreas'], `FX 1: nur Andreas' neuer Stand: ${b}`);
  assert.ok(b.includes('/k/fx|e2|andreas'), 'FX 2 (unberührt) kommt zurück');
});

test('Slice 5 Review F4: /e/neustart mit unveränderter Generation (Neuanmeldung, Kern lief weiter) sendet nichts', async (t) => {
  const d = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const { o, log } = await stapel(t, [], { musterOrdner: d });
  fxVon(d, { 1: 'andreas' });
  o.vomKern({ adresse: '/e/fx', felder: fxFelder(1) });
  assert.notEqual(o.generation, null);
  assert.deepEqual(await nachNeustart(o, log, o.generation, kernBefehle(log).length, 0), []);
  assert.equal(o.letzteBoxFxWieder, 0, 'die 30-s-Sperre wurde nicht verbraucht');
  assert.equal((await nachNeustart(o, log, o.generation + 1, kernBefehle(log).length, 1)).length, 1, 'Gegenprobe: neue Generation stellt wieder her');
});

test('Slice 5 Review F7: Cyphers FX kommen bei AUTO aus nicht zurück, Andreas\' schon', async (t) => {
  const d = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const { o, log, url } = await stapel(t, [], { musterOrdner: d });
  fs.writeFileSync(path.join(d, 'fx_von.json'), JSON.stringify({ '1': { von: 'cypher', zeit: 1 }, '2': { von: 'andreas', zeit: 1 } }));
  const fx = (e) => ({ einheit: e, art: 2, beats: 1, wet: 0.6, param1: 0.4, param2: 0.5, param3: 0.5, an: 1 });
  o.vomKern({ adresse: '/e/fx', felder: fx(1) });
  o.vomKern({ adresse: '/e/fx', felder: fx(2) });
  assert.equal((await postJson(url, '/strudel/autonom', { an: false })).code, 200);
  const n0 = kernBefehle(log).length;
  const b = await nachNeustart(o, log, 121, n0, 1);
  assert.deepEqual(b.map(formS5), ['/k/fx|e2|andreas']);
  assert.ok(log.some((z) => z.typ === 'fx_wieder_ausgelassen' && z.einheit === 1 && z.grund === 'auto_aus'));
});

// Slice 5 Nacharbeit 2: /e/neustart mit GLEICHER Generation (Abonnent hat sich nur neu gemeldet, der Kern lief weiter) lässt den Stand stehen
test('Slice 5 F4: gleiche Generation leert den Stand nicht und sendet nichts; neue Generation leert wie bisher', async (t) => {
  const { o, log, url } = await stapel(t);
  o.vomKern({ adresse: '/e/fx', felder: { einheit: 1, art: 2, beats: 1, wet: 0.6, param1: 0.4, param2: 0.5, param3: 0.5, an: 1 } });
  o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 1, kanal: 'deck/1', an: 1 } });
  assert.equal((await postJson(url, '/fx/routing', { routing: 'insert' })).code, 200);
  o.vomKern({ adresse: '/e/fx/routing', felder: { routing: 1 } });
  const alle = () => log.filter((z) => z.typ === 'an_kern' && z.adresse !== '/k/hallo').length;
  const g = o.generation, a0 = alle();
  o.vomKern({ adresse: '/e/neustart', felder: { generation: g, sample: 0 } });
  await warte(900);
  assert.deepEqual(log.filter((z) => z.typ === 'an_kern' && z.adresse !== '/k/hallo').slice(a0).map((z) => z.adresse), [], 'gleiche Generation: keine Befehle (auch kein Routing-Wunsch)');
  assert.equal(o.stand.fx[0].art, 2);
  assert.equal(o.stand.fxZuweisung[0]['deck/1'], true);
  assert.equal(o.stand.fxRouting, 'insert');
  // neue Generation: wie bisher (Stand leer, Routing zurück auf Post Fader und Wunsch erneut gesendet)
  o.vomKern({ adresse: '/e/neustart', felder: { generation: g + 1, sample: 0 } });
  assert.deepEqual([o.stand.fx, o.stand.fxZuweisung], [[null, null], [{}, {}, {}]]);
  assert.equal(o.stand.fxRouting, 'post_fader');
  assert.ok(log.some((z, i) => z.typ === 'an_kern' && z.adresse === '/k/fx/routing' && z.felder.routing === 1 && i > 0 && log.slice(0, i).filter((y) => y.typ === 'an_kern').length >= a0), 'Routing-Wunsch geht erneut hin');
  await warte(900);   // die Wiederherstellung (500 ms) soll vor dem Ende des Tests laufen, nicht in den abgebauten Server
});

// Final-Review MAJOR-1/MINOR-2: ein gebremster Kern (Bremse F20) startet mit Generation 0 und sendet nur /k/willkommen
const willkommen = (generation) => ({ adresse: '/k/willkommen', felder: { vertrag: 1, generation, sample: 0, beat: 0, bpm: 128, version: 'x' } });
const ohneRouting = (b) => b.filter((z) => z.adresse !== '/k/fx/routing');
test('Final-Review FR1: /k/willkommen mit KLEINERER Generation (gebremster Kern) leert den Stand, sendet den Routing-Wunsch, stellt nichts wieder her', async (t) => {
  const { o, log, url } = await stapel(t);
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 5, sample: 0 } });
  await warte(700);
  o.letzteBoxFxWieder = 0;
  o.vomKern({ adresse: '/e/fx', felder: { einheit: 1, art: 2, beats: 1, wet: 0.6, param1: 0.4, param2: 0.5, param3: 0.5, an: 1 } });
  assert.equal((await postJson(url, '/fx/routing', { routing: 'insert' })).code, 200);
  o.vomKern({ adresse: '/e/fx/routing', felder: { routing: 1 } });
  // Gegenprobe: gleiche Generation (Neuanmeldung) lässt alles stehen und sendet nichts
  let a0 = kernBefehle(log).length;
  o.vomKern(willkommen(5));
  await warte(700);
  assert.deepEqual(kernBefehle(log, a0), []);
  assert.equal(o.stand.fx[0].art, 2);
  // gebremst: Generation 0 < 5
  a0 = kernBefehle(log).length;
  o.vomKern(willkommen(0));
  await warte(900);
  const b = kernBefehle(log, a0);
  assert.deepEqual(ohneRouting(b), [], 'nichts wiederhergestellt (kein fx)');
  assert.deepEqual(b.map((z) => [z.adresse, z.felder.routing, z.felder.quelle]), [['/k/fx/routing', 1, 'andreas']], 'Routing-Wunsch geht erneut hin');
  assert.deepEqual([o.stand.fx, o.stand.fxZuweisung], [[null, null], [{}, {}, {}]]);
  assert.equal(o.generation, 0, 'gemerkte Generation ist die neue');
  assert.ok(log.some((z) => z.typ === 'wiederherstellung_uebersprungen' && z.grund === 'gebremster_start'));
  // der folgende gewöhnliche Neustart (Generation 0 → 1) stellt nichts Veraltetes her
  o.letzteBoxFxWieder = 0;
  const b2 = await nachNeustart(o, log, 1, kernBefehle(log).length, 0);
  assert.deepEqual(ohneRouting(b2), []);
});

test('Final-Review FR2: ein geplanter Plan feuert nicht in einen inzwischen gebremsten Kern (Generation hat sich geändert)', async (t) => {
  const d = fs.mkdtempSync(path.join(TMP, 'djk-muster-'));
  const { o, log } = await stapel(t, [], { musterOrdner: d });
  fxVon(d, { 1: 'andreas' });
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 5, sample: 0 } });
  await warte(700);
  o.letzteBoxFxWieder = 0;
  o.vomKern({ adresse: '/e/fx', felder: fxFelder(1) });
  const a0 = kernBefehle(log).length;
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 6, sample: 0 } });   // plant
  await warte(150);
  o.vomKern(willkommen(0));   // der Kern ist inzwischen gebremst neu gestartet
  await warte(800);
  assert.deepEqual(ohneRouting(kernBefehle(log, a0)), []);
  assert.ok(log.some((z) => z.typ === 'wiederherstellung_verworfen'), 'Log wiederherstellung_verworfen');
  assert.ok(!log.some((z) => z.typ === 'wiederherstellung'), 'nicht als wiederhergestellt gezählt');
});

// Plan Glanz 1.2: Cyphers neuer Teil auf demselben Pfad wartet auf das Ende der eigenen laufenden Fahrt (der Kern lehnt
// sonst ab, sort_in.cpp). Andreas' Teile werden nie verschoben. Phantom-Ende: eine abgelehnte oder abgebrochene Fahrt
// zählt nicht.
const teilFelder = (log) => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil').map((z) => z.felder);
async function fahrtStarten(url, o, log, pfad, body, kopf, status) {
  const p = postJson(url, '/regler', { pfad, ab: 'jetzt', ...body }, kopf);
  if (status === undefined) return p;
  let id;
  for (let i = 0; i < 100 && id === undefined; i++) { id = teilFelder(log).findLast((f) => f.pfad === pfad)?.id; await warte(10); }
  assert.ok(id !== undefined, 'Teil ging an den Kern');
  o.vomKern({ adresse: '/q', felder: { id, status, grund: status === 6 ? 'ausserhalb_bereich' : '', quelle: 'cypher' } });
  return p;
}

import { ueberlappt, ersterFreierBeat } from '../hand_operation.ts';
test('Glanz 1.2: Regler wartet auf die eigene laufende Fahrt desselben Pfads (verschoben_auf), Andreas und andere Pfade nie', async (t) => {
  const { o, url, log } = await stapel(t, []);
  const r1 = await postJson(url, '/regler', { pfad: 'deck/2/filter', nach: -1, takte: 8, ab: 'jetzt' }, CYPHER);
  assert.equal(r1.code, 200, JSON.stringify(r1.j));
  const b0 = r1.j.felder.ab_beat;
  assert.equal(r1.j.felder.dauer_beats, 32); assert.equal(r1.j.verschoben_auf, undefined);
  // 2. gleicher Pfad, sofort: landet am Ende der Fahrt
  const r2 = await postJson(url, '/regler', { pfad: 'deck/2/filter', nach: 0, takte: 0, ab: 'jetzt' }, CYPHER);
  assert.equal(r2.j.felder.ab_beat, b0 + 32, JSON.stringify(r2.j)); assert.equal(r2.j.verschoben_auf, b0 + 32);
  // 3. Negativ-Kontrolle: gleicher Ablauf auf ANDEREM Pfad (pad/2/send/2) ist für sich unverschoben
  const s1 = await postJson(url, '/regler', { pfad: 'pad/2/send/2', nach: -1, takte: 8, ab: 'jetzt' }, CYPHER);
  assert.equal(s1.j.verschoben_auf, undefined); assert.ok(s1.j.felder.ab_beat < b0 + 31, 'deck/2/filter wirkt nicht auf pad/2/send/2');
  // 4. Negativ-Kontrolle: Andreas auf DEMSELBEN Pfad mit laufender Cypher-Fahrt wird nie verschoben
  const r4 = await postJson(url, '/regler', { pfad: 'deck/2/filter', nach: 0, takte: 0, ab: 'jetzt' });
  assert.equal(r4.j.verschoben_auf, undefined); assert.ok(r4.j.felder.ab_beat < b0 + 31, `ab_beat ${r4.j.felder.ab_beat}`);
  // verschoben: nur das kurze Fenster, nicht bis zum Startbeat (30 Beat = ~14 s); keine Fehlerquittung ohne Konflikt
  assert.ok(r2.j.quittung === null || ![4, 6, 7, 8].includes(r2.j.quittung.status), JSON.stringify(r2.j.quittung));
});

test('Glanz 1.2: Phantom-Ende (Review M1): Quittung 6, 7, 4 oder 8 löscht das Ende; zweiter Aufruf bleibt unverschoben', async (t) => {
  const { o, url, log } = await stapel(t, []);
  for (const [i, status] of [6, 7, 4, 8].entries()) {
    const pfad = ['deck/1', 'deck/2', 'pad/1', 'pad/2'][i] + '/filter';
    const r1 = await fahrtStarten(url, o, log, pfad, { nach: -1, takte: 8 }, CYPHER, status);
    assert.equal(r1.j.quittung.status, status, JSON.stringify(r1.j));
    const r2 = await postJson(url, '/regler', { pfad, nach: 0, takte: 0, ab: 'jetzt' }, CYPHER);
    assert.equal(r2.j.verschoben_auf, undefined, `Status ${status}: ${JSON.stringify(r2.j)}`);
    assert.ok(r2.j.felder.ab_beat < r1.j.felder.ab_beat + 31, `Status ${status}`);
  }
  // Negativ-Kontrolle: Status 2 (läuft) lässt das Ende stehen
  const r1 = await fahrtStarten(url, o, log, 'bus/1/filter', { nach: -1, takte: 8 }, CYPHER, 2);
  const r2 = await postJson(url, '/regler', { pfad: 'bus/1/filter', nach: 0, takte: 0, ab: 'jetzt' }, CYPHER);
  assert.equal(r2.j.verschoben_auf, r1.j.felder.ab_beat + 32);
});

test('Glanz 1.2: Phantom-Ende nach Stop Cypher, /abbruch und neuem Kern', async (t) => {
  const { o, url, log } = await stapel(t, []);
  const nachher = async (pfad) => (await postJson(url, '/regler', { pfad, nach: 0, takte: 0, ab: 'jetzt' }, CYPHER)).j;
  // Stop Cypher
  await postJson(url, '/regler', { pfad: 'deck/1/filter', nach: -1, takte: 8, ab: 'jetzt' }, CYPHER);
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 1 } });
  o.vomKern({ adresse: '/e/ki', felder: { gestoppt: 0 } });
  assert.equal((await nachher('deck/1/filter')).verschoben_auf, undefined, 'nach Stop Cypher');
  // /abbruch
  await postJson(url, '/regler', { pfad: 'deck/2/filter', nach: -1, takte: 8, ab: 'jetzt' }, CYPHER);
  assert.equal((await postJson(url, '/abbruch', {}, CYPHER)).code, 200);
  assert.equal((await nachher('deck/2/filter')).verschoben_auf, undefined, 'nach /abbruch');
  // neuer Kern (andere Generation)
  await postJson(url, '/regler', { pfad: 'pad/1/filter', nach: -1, takte: 8, ab: 'jetzt' }, CYPHER);
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 9, sample: 0 } });
  assert.equal((await nachher('pad/1/filter')).verschoben_auf, undefined, 'nach neuem Kern');
  // Negativ-Kontrolle: gleiche Generation (nur neu gemeldet) lässt das Ende stehen
  const a = await postJson(url, '/regler', { pfad: 'pad/2/filter', nach: -1, takte: 8, ab: 'jetzt' }, CYPHER);
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 9, sample: 0 } });
  assert.equal((await nachher('pad/2/filter')).verschoben_auf, a.j.felder.ab_beat + 32);
});

const grundVon = async (o, id) => { await warte(200); return o.quittungen.get(id)?.find((q) => Number(q.status) !== 1)?.grund ?? null; };
const cy = (url, pfad, nach, takte, ab) => postJson(url, '/regler', { pfad, nach, takte, ab }, CYPHER).then((r) => r.j);

test('Glanz 1.2 ueberlappt(): die Regel des Kerns (sort_in.cpp:17-27) für Cyphers Teile', () => {
  const R = (ab, dauer) => ({ ab, dauer });
  assert.equal(ueberlappt(R(10, 0), R(10, 0)), true, 'zwei Setzen am selben Beat');
  assert.equal(ueberlappt(R(10, 0), R(11, 0)), false);
  assert.equal(ueberlappt(R(10, 8), R(12, 0)), true, 'Setzen in der Rampe');
  assert.equal(ueberlappt(R(10, 8), R(10, 0)), false, 'Setzen am Rampenstart (gleiche Nummer)');
  assert.equal(ueberlappt(R(10, 8), R(18, 0)), false, 'Setzen am Rampenende');
  assert.equal(ueberlappt(R(10, 0), R(8, 8)), true, 'Rampe über ein Setzen');
  assert.equal(ueberlappt(R(10, 0), R(10, 8)), false, 'Rampe startet auf dem Setzen');
  assert.equal(ueberlappt(R(10, 8), R(14, 8)), true); assert.equal(ueberlappt(R(10, 8), R(18, 8)), false);
  assert.equal(ersterFreierBeat([R(10, 0), R(11, 0), R(12, 0)], 10, 0), 13, 'drei feste auf einem Beat');
  assert.equal(ersterFreierBeat([R(10, 8)], 20, 0), 20, 'hinter der Rampe frei');
});

test('Glanz 1.2: feste Werte und Rampen (Review): Fälle A, B, D und Anfang statt nur Ende; der Kern lehnt nichts ab', async (t) => {
  const { o, url } = await stapel(t, []);
  const beat = () => o.kern.uhr.beat;
  // Positiv-Gegenprobe des Instruments: zwei Setzen auf demselben Beat direkt an den Kern → die Attrappe quittiert ueberlappung
  const roh = (n) => ({ id: Number(++o.id), quelle: 'cypher', plan: 'cypher', teil: 0, pfad: 'pad/2/filter', ab_beat: 250, dauer_beats: 0, nach: n, form: 1, politik: 0, gruppe: '', hoerschein: '' });
  const r1 = roh(-1), r2 = roh(0);
  o.kern.sende('/k/teil', r1); o.kern.sende('/k/teil', r2);
  assert.equal(await grundVon(o, r2.id), 'ueberlappung'); assert.notEqual(await grundVon(o, r1.id), 'ueberlappung');
  // D: drei feste auf einem Beat (Uhr eingefroren) → b, b+1, b+2
  o.abVon = () => 200;
  const d = [await cy(url, 'deck/1/filter', -1, 0, 'jetzt'), await cy(url, 'deck/1/filter', -0.5, 0, 'jetzt'), await cy(url, 'deck/1/filter', 0, 0, 'jetzt')];
  assert.deepEqual(d.map((x) => x.felder.ab_beat), [200, 201, 202]);
  assert.deepEqual(d.map((x) => x.verschoben_auf), [undefined, 201, 202]);
  for (const x of d) assert.notEqual(await grundVon(o, x.felder.id), 'ueberlappung');
  // A: Rampe 300..308, fest 'jetzt' 302 → 308, fest 'jetzt' 302 → 309 (nicht auf den zweiten)
  const ab = [300, 302, 302]; let i = 0; o.abVon = () => ab[i++];
  const ra = [await cy(url, 'deck/2/filter', -1, 2, 'jetzt'), await cy(url, 'deck/2/filter', 0, 0, 'jetzt'), await cy(url, 'deck/2/filter', 0.5, 0, 'jetzt')];
  assert.deepEqual(ra.map((x) => x.felder.ab_beat), [300, 308, 309]);
  for (const x of ra) assert.notEqual(await grundVon(o, x.felder.id), 'ueberlappung');
  // B: fest auf 400 (takt), dann fest 'jetzt' 397 → bleibt auf 397 (kein Konflikt, vorher fälschlich auf 400)
  const bb = [400, 397]; i = 0; o.abVon = () => bb[i++];
  const fb = [await cy(url, 'pad/1/filter', -1, 0, 'takt'), await cy(url, 'pad/1/filter', 0, 0, 'jetzt')];
  assert.deepEqual(fb.map((x) => x.felder.ab_beat), [400, 397]); assert.equal(fb[1].verschoben_auf, undefined);
  for (const x of fb) assert.notEqual(await grundVon(o, x.felder.id), 'ueberlappung');
  // Anfang statt nur Ende: Rampe 128..160 (phrase), fest 'jetzt' 101 liegt davor → unverschoben
  const ph = [128, 101]; i = 0; o.abVon = () => ph[i++];
  const fp = [await cy(url, 'pad/2/filter', -1, 8, 'phrase'), await cy(url, 'pad/2/filter', 0, 0, 'jetzt')];
  assert.deepEqual(fp.map((x) => x.felder.ab_beat), [128, 101]); assert.equal(fp[1].verschoben_auf, undefined);
  for (const x of fp) assert.notEqual(await grundVon(o, x.felder.id), 'ueberlappung');
  void beat;
});

test('Glanz 1.2: verschobener Teil, den der Kern sofort ablehnt (Andreas-Teil am Zielbeat), trägt die Ablehnung in der Antwort', async (t) => {
  const { o, url } = await stapel(t, []);
  const t0 = Date.now();
  const x = await cy(url, 'deck/2/filter', -1, 8, 'jetzt');
  const ziel = x.felder.ab_beat + 32;
  // Andreas' fester Wert genau auf dem Beat, auf den Cyphers zweiter Teil geschoben wird
  o.kern.sende('/k/teil', { id: Number(++o.id), quelle: 'andreas', plan: '', teil: 0, pfad: 'deck/2/filter', ab_beat: ziel, dauer_beats: 0, nach: 0.1, form: 1, politik: 0, gruppe: '', hoerschein: '' });
  await warte(100);
  const y = await cy(url, 'deck/2/filter', 0, 0, 'jetzt');
  assert.equal(y.verschoben_auf, ziel);
  assert.equal(y.quittung?.status, 6, JSON.stringify(y)); assert.equal(y.quittung.grund, 'ueberlappung');
  assert.ok(Date.now() - t0 < 3000, 'wartet nicht bis zum Startbeat');
  // Negativ-Kontrolle: verschoben ohne Konflikt (anderer Pfad, nur Cypher) → kein Fehlerstatus
  await cy(url, 'pad/1/filter', -1, 8, 'jetzt');
  const z = await cy(url, 'pad/1/filter', 0, 0, 'jetzt');
  assert.ok(z.verschoben_auf !== undefined && (z.quittung === null || ![4, 6, 7, 8].includes(z.quittung.status)), JSON.stringify(z));
});

test('Glanz 2.1 F22: /ausgang und /lage.ausgang zeigen den Stand der Wache, ohne Datei unbewacht', async (t) => {
  const p = path.join(fs.mkdtempSync(path.join(TMP, 'djk-do-')), 'digitalout.json');
  fs.writeFileSync(p, JSON.stringify({ version: 1, karte: 2, zustand: 'aus', faelle: 0, letzter: null, lebenszeichen: new Date().toISOString() }));
  const { url } = await stapel(t, [], { digitalout: p });
  assert.equal((await (await fetch(`${url}/ausgang`)).json()).zustand, 'aus');
  assert.equal((await (await fetch(`${url}/lage`)).json()).ausgang.zustand, 'aus');
  fs.rmSync(p);
  assert.equal((await (await fetch(`${url}/ausgang`)).json()).zustand, 'unbewacht');   // Negativ: Datei weg
});

// Naht Klickfrei (F13) × Welle 1 (pad/*): der Kern lässt einen in eine klingende Box geladenen Loop bis zu 4 s warten
// (/e/loop meldet erst den alten Namen) und verwirft bei Stop Cypher wartende cypher-Loops ohne Echo. Eigen ist eine
// Box für Cyphers Fader nur, wenn der laufende UND der wartende Inhalt Cyphers Mitschnitt sind.
// V2 Fix-Runde 2 H2 (Spec 6.33, wie tests/support/media_library.mjs F16): die Stapel-Hilfe dieser Datei legt Hüllen und alle Vorgabe-Ordner (loops, kits,
// welle, muster, hc, raster, wirt) im eigenen tmp-Ordner an, den t.after wegräumt; ein ausdrücklich übergebener Ordner gehört dem Aufrufer und bleibt.
// Vorher blieben je Stapel acht djk-*-Ordner unter TMPDIR liegen (ganzer Suite-Lauf: rund 1300 Einträge). Geprüft wird nur, was neu unter TMPDIR liegt.
test('V2 Fix-Runde 2 H2: stapel() lässt unter TMPDIR nichts liegen, ein übergebener Ordner bleibt', async (t) => {
  // TMPDIR is private to this test: another process writing to /tmp meanwhile (parallel suites, other sessions) cannot show up in the listing
  const echtesTmp = process.env.TMPDIR, basis = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-h2basis-'));
  process.env.TMPDIR = basis;
  t.after(() => { if (echtesTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = echtesTmp; fs.rmSync(basis, { recursive: true, force: true }); });
  const eintraege = () => new Set(fs.readdirSync(os.tmpdir()));
  const eigen = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-h2eigen-'));
  fs.writeFileSync(path.join(eigen, 'bleibt.txt'), 'x');
  const vorher = eintraege(), afters = [];
  let waehrend = null;
  try {
    await stapel({ after: (f) => afters.push(f) }, [], { loops: eigen });
    waehrend = [...eintraege()].filter((x) => !vorher.has(x));
  } finally { for (const f of afters.reverse()) await f(); }
  const neu = [...eintraege()].filter((x) => !vorher.has(x)).sort();
  const bleibt = fs.existsSync(path.join(eigen, 'bleibt.txt'));
  fs.rmSync(eigen, { recursive: true, force: true });                   // was dieser Test selbst angelegt hat
  console.log(`H2 ${JSON.stringify({ tmpdir: os.tmpdir(), waehrend, nach_after: neu })}`);
  assert.ok(waehrend.length >= 1, 'Positiv-Kontrolle: während des Laufs liegt der tmp-Ordner des Stapels unter TMPDIR');
  assert.deepEqual(neu, [], 'nach t.after liegt unter TMPDIR nichts Neues');
  assert.ok(bleibt, 'Negativ-Kontrolle: der übergebene loops-Ordner bleibt stehen');
});

// Demo overlay (2026-11-07): POST /ansage sets one line, the stream carries it to every page (also to a page that connects
// later), an empty text clears it, bad bodies are refused
test('demo overlay: POST /ansage reaches the stream, a late page gets the current line, empty clears, bad bodies 400', async (t) => {
  const { url } = await stapel(t);
  const s = sse(url);
  await warte(100);
  assert.deepEqual((await (await fetch(`${url}/ansage`)).json()), { ansage: null });
  const r = await postJson(url, '/ansage', { text: '  Ich  bringe gleich die Bassline rein  ' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.ansage.text, 'Ich bringe gleich die Bassline rein');
  assert.equal(r.j.ansage.von, 'cypher');
  assert.equal(r.j.ansage.art, 'tat');
  await warte(100);
  const e = s.ereignisse.filter((x) => x.a === 'ansage');
  assert.equal(e.length, 1, JSON.stringify(s.ereignisse.map((x) => x.a)));
  assert.equal(e[0].f.text, 'Ich bringe gleich die Bassline rein');
  const spaet = sse(url);   // a page that connects later gets the current line right after the state
  await warte(150);
  assert.equal(spaet.ereignisse.find((x) => x.a === 'ansage')?.f.text, 'Ich bringe gleich die Bassline rein');
  const st = await postJson(url, '/ansage', { text: 'Gesprochen', quelle: 'stimme' }, CYPHER);
  assert.equal(st.j.ansage.art, 'stimme');
  const leer = await postJson(url, '/ansage', { text: '' }, CYPHER);
  assert.equal(leer.code, 200);
  assert.equal(leer.j.ansage, null);
  await warte(100);
  assert.equal(s.ereignisse.filter((x) => x.a === 'ansage').at(-1).f, null);
  assert.equal((await postJson(url, '/ansage', { text: 5 }, CYPHER)).code, 400);
  assert.equal((await postJson(url, '/ansage', { text: 'x'.repeat(301) }, CYPHER)).j.fehler, 'text_zu_lang');
  s.zu();
  spaet.zu();
});
