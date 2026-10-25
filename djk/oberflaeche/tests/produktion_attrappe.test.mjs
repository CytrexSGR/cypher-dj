// PRODUCTION V1: Test-Attrappe der Projekt-API (pruef/proj_attrappe.mjs) vor einem Schein-Seiten-Server. Ports frei
// gewählt (0), keine Prüfinstanz nötig, kein Kern.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { starteProjAttrappe } from '../pruef/proj_attrappe.mjs';
import { MAX_SPUREN } from '../projekt/modell.ts';

const SHA = 'b'.repeat(64);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

// Schein-Seiten-Server: /strom mit stand und /uhr (bpm 120), /echo meldet die gesehenen Köpfe, /x antwortet "oben"
async function oben() {
  const stroeme = new Set();
  const srv = http.createServer((q, a) => {
    if (q.url === '/strom') {
      a.writeHead(200, { 'content-type': 'text/event-stream' });
      a.write(`data: ${JSON.stringify({ a: 'stand', f: { regler: {} } })}\n\n`);
      a.write(`data: ${JSON.stringify({ a: '/uhr', f: { beat: 0, bpm: 120 } })}\n\ndata: {"a":"/uh`);   // halbe Nachricht am Ende
      setTimeout(() => a.write(`r","f":{"beat":1,"bpm":120}}\n\n`), 150);   // zweite Hälfte spät: dazwischen mischt die Attrappe ein
      stroeme.add(a); q.on('close', () => stroeme.delete(a));
      return;
    }
    if (q.url === '/echo') { a.writeHead(200, { 'content-type': 'application/json' }); return a.end(JSON.stringify({ origin: q.headers.origin ?? null, quelle: q.headers['x-djk-quelle'] ?? null })); }
    a.writeHead(200, { 'content-type': 'text/plain' }); a.end('oben');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/`, stoppe: () => new Promise((r) => { for (const a of stroeme) a.end(); srv.closeAllConnections(); srv.close(r); }) };
}

// SSE-Leser: sammelt {a, f} aus /strom der Attrappe
function lies(url) {
  const n = [];
  const ac = new AbortController();
  fetch(url + 'strom', { signal: ac.signal }).then(async (r) => {
    const dec = new TextDecoder(); let rest = '';
    for await (const t of r.body) { rest += dec.decode(t); let i; while ((i = rest.indexOf('\n\n')) >= 0) { const m = rest.slice(0, i); rest = rest.slice(i + 2); if (m.startsWith('data: ')) n.push(JSON.parse(m.slice(6))); } }
  }).catch(() => {});
  return { n, zu: () => ac.abort() };
}
const post = async (url, weg, d, kopf = {}) => { const r = await fetch(url + weg.slice(1), { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(d) }); return { status: r.status, j: await r.json() }; };
const get = async (url, weg) => { const r = await fetch(url + weg.slice(1)); return { status: r.status, j: await r.json() }; };

test('V1 Attrappe: reicht durch, nimmt Origin heraus, lässt x-djk-quelle', async () => {
  const o = await oben();
  const at = await starteProjAttrappe({ oben: o.url });
  try {
    assert.equal(await (await fetch(at.url + 'x')).text(), 'oben');
    const e = await post(at.url, '/echo', {}, { origin: 'http://127.0.0.1:1', 'x-djk-quelle': 'cypher' });
    assert.deepEqual(e.j, { origin: null, quelle: 'cypher' });
  } finally { await at.stoppe(); await o.stoppe(); }
});

test('V1 Attrappe: Projekt neu, ändern mit rev-Prüfung, ganze Änderung oder nichts', async () => {
  const o = await oben();
  const at = await starteProjAttrappe({ oben: o.url, dekodierMs: 50 });
  try {
    assert.deepEqual(await get(at.url, '/proj/aktuell'), { status: 200, j: { slug: null, projekt: null, kern: null, ausgabe_lauf: null } }, 'kein Projekt ist kein Fehler (ausgabe_lauf seit Spec 6.34)');
    assert.equal((await get(at.url, '/proj/verlauf')).j.fehler, 'kein_projekt');
    const n = await post(at.url, '/proj/neu', { name: 'First Track' });
    assert.equal(n.status, 200);
    assert.equal(n.j.slug, 'first-track');
    assert.equal(n.j.projekt.rev, 1);
    assert.equal((await post(at.url, '/proj/aendern', { rev: 0, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }] })).j.fehler, 'rev_veraltet');
    const a1 = await post(at.url, '/proj/aendern', { rev: 1, label: 'Add track', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'instrument', name: 'RB-338', geraet: { art: 'intern', name: 'rb338' } }] });
    assert.equal(a1.j.rev, 2);
    assert.deepEqual(a1.j.projekt.spuren.map((s) => [s.nr, s.art, s.name]), [[1, 'audio', 'Audio 1'], [2, 'instrument', 'RB-338']]);
    // ungültiger Befehl im Paket: nichts gebucht
    const kaputt = await post(at.url, '/proj/aendern', { rev: 2, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'gibtsnicht' }] });
    assert.deepEqual([kaputt.status, kaputt.j.fehler], [400, 'befehl_unbekannt'], 'Gründe wie S2 (befehle.ts)');
    const fremd = await post(at.url, '/proj/aendern', { rev: 2, label: 'x', befehle: [{ befehl: 'clip_loeschen', clip_id: 'c1' }] });
    assert.deepEqual([fremd.status, fremd.j.fehler], [404, 'clip_unbekannt'], 'D1 V2: Clip-Befehle rechnet S2 (fuehreAus), Code wie der Server (grundCode); c1 gibt es nicht');
    assert.equal((await get(at.url, '/proj/aktuell')).j.projekt.spuren.length, 2);
    // 415 ohne JSON
    const r = await fetch(at.url + 'proj/aendern', { method: 'POST', body: '{}' });
    assert.equal(r.status, 415);
  } finally { await at.stoppe(); await o.stoppe(); }
});

test('V1 Attrappe: höchstens 10 Spuren (409 spur_bereich)', async () => {
  const o = await oben();
  const at = await starteProjAttrappe({ oben: o.url });
  try {
    await post(at.url, '/proj/neu', { name: 'Voll' });
    const zehn = Array.from({ length: MAX_SPUREN }, () => ({ befehl: 'spur_neu', art: 'audio' }));
    assert.equal((await post(at.url, '/proj/aendern', { rev: 1, label: '10', befehle: zehn })).status, 200);
    assert.deepEqual((await get(at.url, '/proj/aktuell')).j.projekt.spuren.map((s) => s.nr), Array.from({ length: MAX_SPUREN }, (_, i) => i + 1), 'die Attrappe vergibt die Nummern 1 bis MAX_SPUREN');
    assert.deepEqual((await post(at.url, '/proj/aendern', { rev: 2, label: '11', befehle: [{ befehl: 'spur_neu', art: 'audio' }] })).j.fehler, 'spur_bereich');
  } finally { await at.stoppe(); await o.stoppe(); }
});

test('V1 Attrappe: SSE mischt proj-Ereignisse an Nachrichtengrenzen ein, Dekodieren meldet sich', async () => {
  const o = await oben();
  const at = await starteProjAttrappe({ oben: o.url, dekodierMs: 80 });
  const s = lies(at.url);
  try {
    await warte(100);
    await post(at.url, '/proj/neu', { name: 'Sse' });
    const a = await post(at.url, '/proj/aendern', { rev: 1, label: 'Add track', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
    const spur = a.j.projekt.spuren[0].id;
    const c = await post(at.url, '/proj/aendern', { rev: 2, label: 'Add clip', befehle: [{ befehl: 'clip_neu', spur_id: spur, art: 'audio', start_beat: 4, laenge_beats: 1, sha256: SHA }] }, { 'x-djk-quelle': 'cypher' });
    const clip = c.j.projekt.spuren[0].clips[0];
    assert.equal(clip.dekodiert, 'laeuft');
    await warte(250);
    const arten = s.n.map((x) => x.a);
    assert.equal(arten[0], 'stand', 'erstes Paket bleibt das Anfangsbild des Seiten-Servers');
    assert.equal(s.n.filter((x) => x.a === '/uhr').length, 2, 'die über zwei Pakete geteilte /uhr kommt ganz an');
    assert.ok(s.n.some((x) => x.a === 'proj' && x.f.rev === 3 && x.f.label === 'Add clip' && x.f.quelle === 'cypher' && x.f.slug === 'sse'));
    assert.ok(s.n.some((x) => x.a === 'proj' && x.f.clip_id === clip.id && x.f.dekodiert === 'fertig'));
    assert.equal((await get(at.url, '/proj/aktuell')).j.projekt.spuren[0].clips[0].dekodiert, 'fertig');
  } finally { s.zu(); await at.stoppe(); await o.stoppe(); }
});

test('V1 Attrappe: eingemischtes Ereignis zerreißt keine halbe Nachricht des Seiten-Servers', async () => {
  const o = await oben();
  const at = await starteProjAttrappe({ oben: o.url });
  const s = lies(at.url);
  try {
    await warte(60);                                        // die erste Hälfte der zweiten /uhr ist unterwegs
    await post(at.url, '/attrappe/sse', { a: 'probe', f: { n: 1 } });
    await warte(250);
    assert.deepEqual(s.n.map((x) => x.a), ['stand', '/uhr', 'probe', '/uhr']);
  } finally { s.zu(); await at.stoppe(); await o.stoppe(); }
});

test('V1 Attrappe: Undo, Redo, Verlauf mit Art; neue Änderung leert Redo', async () => {
  const o = await oben();
  const at = await starteProjAttrappe({ oben: o.url });
  try {
    await post(at.url, '/proj/neu', { name: 'U' });
    await post(at.url, '/proj/aendern', { rev: 1, label: 'Add track', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
    await post(at.url, '/proj/aendern', { rev: 2, label: 'Loop', befehle: [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 32 }] });
    const u = await post(at.url, '/proj/undo', { rev: 3 });
    assert.equal(u.j.rev, 4);
    assert.equal(u.j.projekt.loop.an, false);
    const u2 = await post(at.url, '/proj/undo', { rev: 4 });
    assert.equal(u2.j.projekt.spuren.length, 0);
    assert.equal((await post(at.url, '/proj/undo', { rev: 5 })).j.fehler, 'nichts_zu_tun');
    const r = await post(at.url, '/proj/redo', { rev: 5 });
    assert.equal(r.j.projekt.spuren.length, 1);
    assert.deepEqual((await get(at.url, '/proj/verlauf')).j.map((e) => [e.rev, e.art, e.label]),
      [[2, 'aendern', 'Add track'], [3, 'aendern', 'Loop'], [4, 'undo', 'Undo: Loop'], [5, 'undo', 'Undo: Add track'], [6, 'redo', 'Redo: Add track']]);   // Präfix im Label wie S2 (verlauf.ts protokolliere)
    await post(at.url, '/proj/aendern', { rev: 6, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm: 124 }] });
    assert.equal((await post(at.url, '/proj/redo', { rev: 7 })).j.fehler, 'nichts_zu_tun');
  } finally { await at.stoppe(); await o.stoppe(); }
});

test('V1 Attrappe: Transport läuft mit dem Master-Tempo aus /uhr, faltet in der Loop-Klammer, Pegel je Spur', async () => {
  const o = await oben();
  const at = await starteProjAttrappe({ oben: o.url });
  const s = lies(at.url);
  try {
    await warte(100);
    await post(at.url, '/proj/neu', { name: 'T' });
    const a = await post(at.url, '/proj/aendern', { rev: 1, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 1 }] });
    await post(at.url, '/proj/aendern', { rev: 2, label: 'clip', befehle: [{ befehl: 'clip_neu', spur_id: a.j.projekt.spuren[0].id, art: 'audio', start_beat: 0, laenge_beats: 1, sha256: SHA }] });
    assert.equal(at.zustand.masterBpm, 120);
    await post(at.url, '/proj/transport', { aktion: 'start', beat: 0 });
    await warte(700);                                       // 120 BPM: 1,4 Beats, gefaltet in [0, 1)
    const arr = s.n.filter((x) => x.a === '/zustand/arr' && x.f.status === 2);
    assert.ok(arr.length >= 8, `50 ms Takt: ${arr.length} Meldungen`);
    assert.ok(arr.every((x) => x.f.projekt_beat >= 0 && x.f.projekt_beat < 1), 'in der Klammer gefaltet');
    assert.ok(s.n.some((x) => x.a === '/pegel' && x.f.kanal === 'spur/1' && x.f.spitze_db === -12));
    await post(at.url, '/proj/transport', { aktion: 'stopp' });
    await warte(120);
    assert.equal(s.n.filter((x) => x.a === '/zustand/arr').at(-1).f.status, 0);
    // Negativ-Kontrolle: nach dem Stopp kein Pegel mehr über −200
    const nach = s.n.length;
    await warte(250);
    assert.ok(s.n.slice(nach).filter((x) => x.a === '/pegel').every((x) => x.f.spitze_db === -200));
  } finally { s.zu(); await at.stoppe(); await o.stoppe(); }
});

test('V1 Attrappe: Gründe und Wertebereiche wie S2 (befehle.ts) und Spec §4', async () => {
  const o = await oben();
  const at = await starteProjAttrappe({ oben: o.url });
  try {
    await post(at.url, '/proj/neu', { name: 'G' });
    const a = await post(at.url, '/proj/aendern', { rev: 1, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
    const id = a.j.projekt.spuren[0].id;
    let rev = a.j.rev;
    const grund = async (befehl) => { const r = await post(at.url, '/proj/aendern', { rev, label: 'x', befehle: [befehl] }); return r.status === 200 ? (rev = r.j.rev, 'ok') : r.j.fehler; };
    assert.equal(await grund({ befehl: 'tempo_setzen', bpm: 300 }), 'tempo_bereich');
    assert.equal(await grund({ befehl: 'tempo_setzen', bpm: 'schnell' }), 'argument_ungueltig');
    assert.equal(await grund({ befehl: 'loop_setzen', an: true, von_beat: 4, bis_beat: 4.5 }), 'loop_bereich');
    assert.equal(await grund({ befehl: 'loop_setzen', an: 'ja', von_beat: 0, bis_beat: 8 }), 'argument_ungueltig');
    assert.equal(await grund({ befehl: 'spur_aendern', spur_id: 'gibtsnicht', mute: true }), 'spur_unbekannt');
    assert.equal(await grund({ befehl: 'spur_aendern', spur_id: id, lautstaerke: 3 }), 'argument_unbekannt');
    assert.equal(await grund({ befehl: 'spur_aendern', spur_id: id }), 'argument_ungueltig', 'keine Änderung angegeben');
    // Fader: Grenzwert +6 gilt, darüber nicht; −200 (aus) gilt; Pan −1..+1
    assert.equal(await grund({ befehl: 'spur_aendern', spur_id: id, fader_db: 6 }), 'ok');
    assert.equal(await grund({ befehl: 'spur_aendern', spur_id: id, fader_db: 6.5 }), 'argument_ungueltig');
    assert.equal(await grund({ befehl: 'spur_aendern', spur_id: id, fader_db: -200 }), 'ok');
    assert.equal(await grund({ befehl: 'spur_aendern', spur_id: id, pan: 1 }), 'ok');
    assert.equal(await grund({ befehl: 'spur_aendern', spur_id: id, pan: 1.2 }), 'argument_ungueltig');
    assert.equal(await grund({ befehl: 'clip_neu', spur_id: id, art: 'audio', start_beat: 0, laenge_beats: 1, sha256: 'xyz' }), 'sha_ungueltig');
    assert.equal(await grund({ befehl: 'clip_neu', spur_id: id, art: 'midi', start_beat: 0, laenge_beats: 1 }), 'art_passt_nicht');
    assert.equal(await grund({ befehl: 'spur_neu', art: 'audio', geraet: { art: 'intern' } }), 'argument_ungueltig', 'Gerät nur für Instrument-Spuren');
    // Surge: D1 hat einen Wirt-Slot (Spec 6.28, D1 V2 Nachzug 7d): Slot 1, danach ist jede weitere Surge-Spur slot_belegt (auch mit slot 2)
    const surge = (slot) => ({ befehl: 'spur_neu', art: 'instrument', name: 'Surge', geraet: { art: 'wirt', name: 'surge', ...(slot ? { slot } : {}) } });
    assert.equal(await grund(surge(2)), 'slot_belegt', 'Slot 2 gibt es in D1 nicht');
    assert.equal(await grund(surge()), 'ok', 'ohne slot: der freie');
    assert.equal(await grund(surge(1)), 'slot_belegt');
    assert.equal(await grund(surge()), 'slot_belegt');
    const p = (await get(at.url, '/proj/aktuell')).j.projekt;
    assert.deepEqual(p.spuren.filter((x) => x.geraet?.art === 'wirt').map((x) => x.geraet.slot), [1]);
    // Negativ-Kontrolle: nach all den Ablehnungen hat keine einen Teilstand hinterlassen (rev zählt nur die angenommenen)
    assert.equal(p.tempo_bpm, 120);
    assert.equal(p.loop.an, false);
  } finally { await at.stoppe(); await o.stoppe(); }
});

test('V1 Attrappe: Spur löschen und verschieben, Undo stellt her, nr bleibt', async () => {
  const o = await oben();
  const at = await starteProjAttrappe({ oben: o.url });
  try {
    await post(at.url, '/proj/neu', { name: 'Spur' });
    const neu = (name) => ({ befehl: 'spur_neu', art: 'audio', name });
    const a = await post(at.url, '/proj/aendern', { rev: 1, label: 'drei', befehle: [neu('A'), neu('B'), neu('C')] });
    const [A, B, C] = a.j.projekt.spuren.map((x) => x.id);
    const v = await post(at.url, '/proj/aendern', { rev: 2, label: 'Move track', befehle: [{ befehl: 'spur_verschieben', spur_id: C, index: 0 }] });
    assert.deepEqual(v.j.projekt.spuren.map((x) => [x.name, x.nr]), [['C', 3], ['A', 1], ['B', 2]], 'Reihenfolge ändert sich, nr bleibt');
    assert.equal((await post(at.url, '/proj/aendern', { rev: 3, label: 'x', befehle: [{ befehl: 'spur_verschieben', spur_id: C, index: 3 }] })).j.fehler, 'index_bereich');
    assert.equal((await post(at.url, '/proj/aendern', { rev: 3, label: 'x', befehle: [{ befehl: 'spur_verschieben', spur_id: C, index: 0.5 }] })).j.fehler, 'argument_ungueltig');
    assert.equal((await post(at.url, '/proj/aendern', { rev: 3, label: 'x', befehle: [{ befehl: 'spur_verschieben', spur_id: 'nix', index: 0 }] })).j.fehler, 'spur_unbekannt');
    const l = await post(at.url, '/proj/aendern', { rev: 3, label: 'Delete track A', befehle: [{ befehl: 'spur_loeschen', spur_id: A }] });
    assert.deepEqual(l.j.projekt.spuren.map((x) => x.name), ['C', 'B']);
    assert.equal((await post(at.url, '/proj/aendern', { rev: 4, label: 'x', befehle: [{ befehl: 'spur_loeschen', spur_id: A }] })).j.fehler, 'spur_unbekannt', 'zweimal löschen geht nicht');
    // die frei gewordene Nummer 1 vergibt die nächste neue Spur (wie S2)
    const n = await post(at.url, '/proj/aendern', { rev: 4, label: 'x', befehle: [neu('D')] });
    assert.deepEqual(n.j.projekt.spuren.map((x) => [x.name, x.nr]), [['C', 3], ['B', 2], ['D', 1]]);
    const u = await post(at.url, '/proj/undo', { rev: 5 });          // nimmt D zurück
    const u2 = await post(at.url, '/proj/undo', { rev: 6 });         // nimmt das Löschen von A zurück
    assert.deepEqual(u2.j.projekt.spuren.map((x) => [x.name, x.nr, x.id]), [['C', 3, C], ['A', 1, A], ['B', 2, B]], 'Undo stellt A mit derselben ID und nr her');
    assert.equal(u.j.projekt.spuren.length, 2);
  } finally { await at.stoppe(); await o.stoppe(); }
});

test('V1 Attrappe: Kopf faltet nur, wenn der Start vor bis lag (Spec 2.2), sonst läuft er ungefaltet weiter', async () => {
  const o = await oben();
  const at = await starteProjAttrappe({ oben: o.url });
  const s = lies(at.url);
  try {
    await warte(100);
    await post(at.url, '/proj/neu', { name: 'F' });
    await post(at.url, '/proj/aendern', { rev: 1, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 1 }] });
    await post(at.url, '/proj/transport', { aktion: 'start', beat: 4 });     // Start HINTER bis
    await warte(600);
    const arr = s.n.filter((x) => x.a === '/zustand/arr' && x.f.status === 2).map((x) => x.f.projekt_beat);
    assert.ok(arr.length >= 6);
    assert.ok(arr.every((b) => b >= 4), `ungefaltet ab dem Start: ${arr.slice(0, 3)}`);
    assert.ok(arr.at(-1) > arr[0], 'läuft weiter');
    await post(at.url, '/proj/transport', { aktion: 'stopp' });
    // Gegenprobe (muss falten): Start vor bis, dieselbe Klammer
    const n0 = s.n.length;
    await post(at.url, '/proj/transport', { aktion: 'start', beat: 0 });
    await warte(900);                                                         // 1,8 Beats bei 120 BPM
    const falt = s.n.slice(n0).filter((x) => x.a === '/zustand/arr' && x.f.status === 2).map((x) => x.f.projekt_beat);
    assert.ok(falt.length >= 8 && falt.every((b) => b >= 0 && b < 1), 'Start vor bis: gefaltet');
    await post(at.url, '/proj/transport', { aktion: 'stopp' });
  } finally { s.zu(); await at.stoppe(); await o.stoppe(); }
});

test('V1 Attrappe: einmalige Transport-Antwort für die Probe (Kern ohne Antwort, abgelehnt), danach wieder normal', async () => {
  const o = await oben();
  const at = await starteProjAttrappe({ oben: o.url });
  try {
    await post(at.url, '/proj/neu', { name: 'T' });
    await post(at.url, '/attrappe/transportantwort', { quittung: null });
    const k = await post(at.url, '/proj/transport', { aktion: 'start', beat: 0 });
    assert.equal(k.status, 200);
    assert.deepEqual(k.j, { ok: true, quittung: null }, 'Kern ohne Antwort: quittung null, nicht im Bestand ein Erfolg');
    assert.equal(at.zustand.transport, null, 'ohne Antwort hat der Kern nichts gestartet');
    await post(at.url, '/attrappe/transportantwort', { quittung: { status: 7, grund: 'deck_laeuft' } });
    assert.deepEqual((await post(at.url, '/proj/transport', { aktion: 'start', beat: 0 })).j, { ok: true, quittung: { status: 7, grund: 'deck_laeuft' } });
    // Negativ-Kontrolle: die Antwort gilt nur einmal
    const n = await post(at.url, '/proj/transport', { aktion: 'start', beat: 0 });
    assert.deepEqual(n.j, { ok: true, quittung: { status: 3, grund: '' } });
    assert.ok(at.zustand.transport);
    await post(at.url, '/proj/transport', { aktion: 'stopp' });
  } finally { await at.stoppe(); await o.stoppe(); }
});

// Vertrag /zustand/arr: die Feldliste der Attrappe ist die aus Spec 3.1 und K1 (d1-kern djk/vertrag/osc_adressen.ts, Adresse
// '/zustand/arr'): nr, status, loop_an, projekt_beat, ursprung_sample, start_beat, metronom_an. Vorher sandte die Attrappe rev statt nr
// und die Seite las rev; beide Fehler passten zueinander und blieben unsichtbar.
const ARR_FELDER = ['nr', 'status', 'loop_an', 'projekt_beat', 'ursprung_sample', 'start_beat', 'metronom_an'];
test('V1 Attrappe: /zustand/arr trägt genau die Felder aus Spec 3.1, nr trägt die wiedergabe_rev', async () => {
  const o = await oben();
  const at = await starteProjAttrappe({ oben: o.url });
  const s = lies(at.url);
  try {
    await warte(100);
    const saat = { format: 'cypherdj-projekt/1', name: 'Arr', rev: 1, wiedergabe_rev: 7, tempo_bpm: 120, taktart: [4, 4],
      loop: { an: false, von_beat: 0, bis_beat: 32 }, metronom: { an: false, pegel_db: -12, ziel: 'master' }, spuren: [] };
    await post(at.url, '/attrappe/saat', { projekt: saat });
    for (let i = 0; i < 30 && !s.n.some((x) => x.a === '/zustand/arr'); i++) await warte(50);
    const m = s.n.find((x) => x.a === '/zustand/arr');
    assert.ok(m, 'die Attrappe meldet /zustand/arr');
    assert.deepEqual(Object.keys(m.f), ARR_FELDER);
    assert.equal(m.f.nr, 7, 'nr ist die wiedergabe_rev des Projekts');
    // Negativ-Kontrolle: das alte Feld rev gibt es nicht mehr
    assert.equal('rev' in m.f, false);
  } finally { s.zu(); await at.stoppe(); await o.stoppe(); }
});

// Ausfall für die Probe: /attrappe/weg {an: true} lässt /proj/* mit 503 antworten und kappt den Ereignisstrom (die Verbindung
// bricht, EventSource verbindet später neu); {an: false} holt den Server zurück. Zustand und Verlauf bleiben im Speicher.
test('V1 Attrappe: Server weg und wieder da (503 auf /proj/*, Strom gekappt, danach alles wie vorher)', async () => {
  const o = await oben();
  const at = await starteProjAttrappe({ oben: o.url });
  try {
    await post(at.url, '/proj/neu', { name: 'Weg' });
    assert.equal((await get(at.url, '/proj/aktuell')).status, 200);
    await post(at.url, '/attrappe/weg', { an: true });
    const w = await fetch(at.url + 'proj/aktuell');
    assert.equal(w.status, 503);
    assert.equal((await fetch(at.url + 'proj/verlauf')).status, 503);
    await assert.rejects(fetch(at.url + 'strom'), 'der Strom bricht ab wie bei einem toten Server');
    assert.equal(await (await fetch(at.url + 'x')).text(), 'oben', 'Dateien liefert der Seiten-Server weiter (die Seite ist geladen)');
    await post(at.url, '/attrappe/weg', { an: false });
    const da = await get(at.url, '/proj/aktuell');
    assert.deepEqual([da.status, da.j.slug, da.j.projekt.name], [200, 'weg', 'Weg'], 'der Stand ist unverändert da');
    const s = lies(at.url);
    await warte(100);
    assert.ok(s.n.some((x) => x.a === 'stand'), 'der Strom verbindet wieder und liefert das Anfangsbild');
    s.zu();
  } finally { await at.stoppe(); await o.stoppe(); }
});

// Fix 5: die Attrappe benennt einen Clip wie S2 (befehle.ts clip_neu): name, sonst der Dateiname aus pfad_hinweis ohne Endung, sonst „Audio“.
// Vorher erfand sie „sample <sha6>“ und verdeckte damit, dass die Seite keinen Namen schickte.
test('V1 Attrappe: clip_neu benennt wie S2 (name, Dateiname, „Audio“), nie nach dem sha', async () => {
  const o = await oben();
  const at = await starteProjAttrappe({ oben: o.url });
  try {
    await post(at.url, '/proj/neu', { name: 'N' });
    const a = await post(at.url, '/proj/aendern', { rev: 1, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
    const id = a.j.projekt.spuren[0].id;
    let rev = a.j.rev;
    const clip = async (extra) => { const r = await post(at.url, '/proj/aendern', { rev, label: 'c', befehle: [{ befehl: 'clip_neu', spur_id: id, art: 'audio', start_beat: 0, laenge_beats: 1, sha256: SHA, ...extra }] }); rev = r.j.rev ?? rev; return r; };
    assert.equal((await clip({ name: 'Kick 1' })).j.projekt.spuren[0].clips.at(-1).name, 'Kick 1');
    assert.equal((await clip({})).j.projekt.spuren[0].clips.at(-1).name, 'Audio', 'ohne name: „Audio“ wie S2');
    assert.equal((await clip({ pfad_hinweis: '/samples/drums/Snare Hit.wav' })).j.projekt.spuren[0].clips.at(-1).name, 'Snare Hit', 'Dateiname ohne Endung');
    assert.equal((await clip({ name: 'N', pfad_hinweis: '/x/y.wav' })).j.projekt.spuren[0].clips.at(-1).name, 'N', 'name geht vor');
    assert.equal((await clip({ name: '' })).j.fehler, 'argument_ungueltig', 'leerer Name ist ungültig wie in S2');
    assert.equal((await clip({ name: 'x'.repeat(81) })).j.fehler, 'argument_ungueltig');
  } finally { await at.stoppe(); await o.stoppe(); }
});

// Fix 14: Gründe von S2 (ablage.ts lege, verlauf.ts pruefeMeta): ungültiger Projektname ist name_ungueltig (nicht name_fehlt), ein Label von 1 bis 200 Zeichen
test('V1 Attrappe: Projektname und Label wie S2 (name_ungueltig, label_ungueltig)', async () => {
  const o = await oben();
  const at = await starteProjAttrappe({ oben: o.url });
  try {
    for (const name of ['', '   ', 5, null, 'x'.repeat(81)]) {
      const r = await post(at.url, '/proj/neu', { name });
      assert.deepEqual([r.status, r.j.fehler], [400, 'name_ungueltig'], JSON.stringify(name));
    }
    assert.equal((await post(at.url, '/proj/neu', { name: 'x'.repeat(80) })).status, 200, 'genau 80 Zeichen gehen (Negativ-Kontrolle)');
    const a = (label) => post(at.url, '/proj/aendern', { rev: 1, label, befehle: [{ befehl: 'tempo_setzen', bpm: 130 }] });
    for (const label of ['', '  ', 'x'.repeat(201), undefined, 7]) {
      const r = await a(label);
      assert.deepEqual([r.status, r.j.fehler], [400, 'label_ungueltig'], JSON.stringify(label));
    }
    assert.equal((await a('x'.repeat(200))).status, 200, 'genau 200 Zeichen gehen (Negativ-Kontrolle)');
  } finally { await at.stoppe(); await o.stoppe(); }
});
