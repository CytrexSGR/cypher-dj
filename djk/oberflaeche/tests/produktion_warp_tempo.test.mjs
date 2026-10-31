// Paket 1.13 Warp, Slice 3b (Task 4, 10, 12): die Knöpfe ×2, :2 und SET PROJECT TEMPO im Detailbereich und die Hinweise von Set 1.1.1 Here. Die Vorprüfung der Seite (tempoBefehl) und der Befehl gegen die Projekt-Attrappe:
// ×2 verdoppelt die Clip-Länge und jedes Segment-Tempo, :2 stellt es her, ein Segment außerhalb 15..800 BPM wird schon auf der Seite abgelehnt.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { starteProjAttrappe } from '../pruef/proj_attrappe.mjs';
import { tempoBefehl, projektTempoBefehl } from '../oeffentlich/produktion/warp.js';
import { hinweisMeldung, fehlerText } from '../oeffentlich/produktion/produktion.js';
import { grundText } from '../http/gruende.ts';

const SHA = 'a'.repeat(64);
const warp = (marker = [[0, 0], [2, 4], [4, 8]]) => ({ an: true, modus: 'complex', marker, versatz_beats: 0, quelle: 'werkstatt', transpose_st: 0, detune_ct: 0 });
const clip = (w = warp()) => ({ id: 'c1', art: 'audio', warp: w });

test('Knöpfe: ×2 und :2 mit Vorprüfung des Tempo-Bandes (Positivkontrolle an der Grenze)', () => {
  assert.deepEqual(tempoBefehl(clip(), 2), { befehl: { befehl: 'warp_tempo', clip_id: 'c1', faktor: 2 }, label: 'Warp tempo ×2' });
  assert.equal(tempoBefehl(clip(), 0.5).befehl.faktor, 0.5);
  assert.match(tempoBefehl(clip(warp([[0, 0], [1, 7]])), 2).fehler, /800 BPM/);          // 420 → 840
  assert.ok(tempoBefehl(clip(warp([[0, 0], [1, 6.5]])), 2).befehl, '390 → 780 geht');
  assert.match(tempoBefehl(clip(warp([[0, 0], [1, 0.4]])), 0.5).fehler, /15/);           // 24 → 12
  assert.ok(tempoBefehl(clip(warp([[0, 0], [1, 0.5]])), 0.5).befehl, '30 → 15 geht');
  assert.match(tempoBefehl({ id: 'c1', art: 'audio' }, 2).fehler, /no warp/);
});

async function oben() {
  const stroeme = new Set();
  const srv = http.createServer((q, a) => {
    if (q.url === '/strom') { a.writeHead(200, { 'content-type': 'text/event-stream' }); a.write(`data: ${JSON.stringify({ a: '/uhr', f: { beat: 0, bpm: 120 } })}\n\n`); stroeme.add(a); q.on('close', () => stroeme.delete(a)); return; }
    a.writeHead(200, { 'content-type': 'text/plain' }); a.end('oben');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/`, stoppe: () => new Promise((r) => { for (const a of stroeme) a.end(); srv.closeAllConnections(); srv.close(r); }) };
}
const post = async (url, weg, d) => { const r = await fetch(url + weg.slice(1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }); return { status: r.status, j: await r.json() }; };
const mitAttrappe = async (fn) => { const o = await oben(), at = await starteProjAttrappe({ oben: o.url }); try { await fn(at); } finally { await at.stoppe(); await o.stoppe(); } };

test('Gegen die Projekt-Attrappe: ×2 verdoppelt Länge und Tempo, :2 stellt den Ausgangszustand her (bis auf die Quelle), je ein Undo-Schritt', () => mitAttrappe(async (at) => {
  await post(at.url, '/proj/neu', { name: 'Tempo' });
  const auf = await post(at.url, '/proj/aendern', { rev: 1, label: 'Aufbau', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'tempo_setzen', bpm: 128 },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 8, sha256: SHA, warp: warp() }] });
  assert.equal(auf.status, 200, JSON.stringify(auf.j));
  const c = auf.j.projekt.spuren[0].clips[0];
  const x2 = await post(at.url, '/proj/aendern', { rev: auf.j.rev, label: 'x', befehle: [tempoBefehl(c, 2).befehl] });
  assert.equal(x2.status, 200, JSON.stringify(x2.j));
  const k = x2.j.projekt.spuren[0].clips[0];
  assert.deepEqual([k.laenge_beats, k.warp.marker, k.warp.quelle], [16, [[0, 0], [2, 8], [4, 16]], 'hand']);
  const x1 = await post(at.url, '/proj/aendern', { rev: x2.j.rev, label: 'x', befehle: [tempoBefehl(k, 0.5).befehl] });
  const h = x1.j.projekt.spuren[0].clips[0];
  assert.deepEqual([h.laenge_beats, h.warp.marker], [8, [[0, 0], [2, 4], [4, 8]]]);
  const u = await post(at.url, '/proj/undo', { rev: x1.j.rev });
  assert.deepEqual(u.j.projekt.spuren[0].clips[0].warp.marker, [[0, 0], [2, 8], [4, 16]], 'ein Undo nimmt genau :2 zurück');
  const zu = await post(at.url, '/proj/aendern', { rev: u.j.rev, label: 'x', befehle: [{ befehl: 'warp_tempo', clip_id: 'c1', faktor: 3 }] });
  assert.deepEqual([zu.status, zu.j.fehler], [400, 'argument_ungueltig'], 'Negativkontrolle: Faktor 3 lehnt der Befehl ab');
}));

test('Set project tempo: Vorprüfung ohne Warp; gegen die Attrappe wird das Projekttempo das Fenstertempo, außerhalb 60..200 lehnt der Server alles ab', () => mitAttrappe(async (at) => {
  assert.deepEqual(projektTempoBefehl(clip()), { befehl: { befehl: 'tempo_vom_clip', clip_id: 'c1' }, label: 'Set project tempo' });
  assert.match(projektTempoBefehl({ id: 'c1', art: 'audio' }).fehler, /no warp/);
  await post(at.url, '/proj/neu', { name: 'Tempo' });
  const auf = await post(at.url, '/proj/aendern', { rev: 1, label: 'Aufbau', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'tempo_setzen', bpm: 128 },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 8, sha256: SHA, warp: warp() }] });
  const tempo = await post(at.url, '/proj/aendern', { rev: auf.j.rev, label: 'x', befehle: [projektTempoBefehl(clip()).befehl] });
  assert.equal(tempo.status, 200, JSON.stringify(tempo.j));
  assert.equal(tempo.j.projekt.tempo_bpm, 120, '8 Beats in 4 s');
  const x2 = await post(at.url, '/proj/aendern', { rev: tempo.j.rev, label: 'x', befehle: [tempoBefehl(clip(), 2).befehl] });
  const zu = await post(at.url, '/proj/aendern', { rev: x2.j.rev, label: 'x', befehle: [projektTempoBefehl(clip()).befehl] });
  assert.deepEqual([zu.status, zu.j.fehler], [409, 'tempo_bereich'], '16 Beats in 4 s sind 240 BPM: außerhalb, nichts geändert');
}));

test('Hinweise von Set 1.1.1 Here: Texte auf Englisch, nur der Schreibfehler ist ein Fehler-Hinweis; der neue Grund marker_unbekannt hat einen Text', () => {
  const g = hinweisMeldung([{ index: 0, hinweis: 'eins_gemeldet' }]);
  assert.equal(g.fehler, false); assert.match(g.text, /decks use it too/);
  const n = hinweisMeldung([{ index: 0, hinweis: 'eins_nur_hier' }]);
  assert.equal(n.fehler, false); assert.match(n.text, /this clip only/);
  const f = hinweisMeldung([{ index: 0, hinweis: 'eins_rueckweg_fehler' }]);
  assert.equal(f.fehler, true); assert.match(f.text, /could not be saved/);
  assert.match(fehlerText({ j: { fehler: 'marker_unbekannt' } }), /no warp marker/i);
  assert.doesNotMatch(grundText('marker_unbekannt'), /^Rejected/);
});
