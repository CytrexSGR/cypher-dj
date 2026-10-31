// Paket 1.13 Warp, Slice 3b (AK30, Task 16): der Sample-Editor der Seite. Die Gesten (Doppelklick, Ziehen mit und ohne Umschalt, Rechtsklick-Menü) ergeben die richtigen Befehle
// (reine Funktionen aus warp_editor.js), und diese Befehle, an die Projekt-Attrappe geschickt, ergeben den Stand, den die Geste meint.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { starteProjAttrappe } from '../pruef/proj_attrappe.mjs';
import { neueAnsicht, zoomAnsicht, scrolleAnsicht, markerBei, doppelklick, ziehen, menuPunkte, segmentText, markerText, sZuX, xZuS, TREFFER_PX, transientenPixel } from '../oeffentlich/produktion/warp_editor.js';
import { tempoBefehl, projektTempoBefehl } from '../oeffentlich/produktion/warp.js';

const SHA = 'a'.repeat(64);
const warp = (marker = [[0, 0], [2, 4], [4, 8]], extra = {}) => ({ an: true, modus: 'complex', marker, versatz_beats: 0, quelle: 'werkstatt', transpose_st: 0, detune_ct: 0, ...extra });
const clip = (w = warp()) => ({ id: 'c1', art: 'audio', warp: w });
const A = { s0: 0, pxProS: 100 };                               // 100 px je Sekunde: Marker bei x = 0, 200, 400

test('Ansicht: sZuX und xZuS sind Umkehrungen; Zoom hält die Stelle unter der Maus; Grenzen; Scrollen bleibt ≥ 0', () => {
  assert.equal(sZuX(A, 2), 200); assert.equal(xZuS(A, 200), 2);
  const z = zoomAnsicht({ s0: 1, pxProS: 100 }, 2, 300);        // Stelle unter x = 300 ist 4,0 s
  assert.equal(xZuS(z, 300), 4); assert.equal(z.pxProS, 200);
  assert.equal(zoomAnsicht(A, 1e9, 10).pxProS, 4000); assert.equal(zoomAnsicht(A, 1e-9, 10).pxProS, 2);
  assert.equal(scrolleAnsicht(A, -500).s0, 0, 'nicht vor den Anfang'); assert.equal(scrolleAnsicht(A, 250).s0, 2.5);
  assert.deepEqual(neueAnsicht(clip(warp([[3, 0], [5, 4]], { versatz_beats: 0 })), 40), { s0: 3 - 20 / 40, pxProS: 40 }, 'der Anfang des gespielten Stücks mit 20 px Rand');
  assert.equal(neueAnsicht(clip(warp([[0.1, 0], [2, 4]])), 40).s0, 0, 'nie negativ');
});

test('markerBei: der nächste Marker innerhalb von 6 px, sonst −1; Positivkontrolle an der Grenze', () => {
  const m = warp().marker;
  assert.equal(markerBei(m, A, 203), 1); assert.equal(markerBei(m, A, 200 + TREFFER_PX), 1, 'genau 6 px daneben trifft noch');
  assert.equal(markerBei(m, A, 200 + TREFFER_PX + 1), -1); assert.equal(markerBei(m, A, 100), -1);
  assert.equal(markerBei([[1, 0], [1.01, 1]], A, 100.5), 0, 'bei zwei nahen Markern der nähere');
});

test('Doppelklick: leer setzt einen Marker ohne beat (nur quell_s), auf einem Marker löscht er ihn; bei zwei Markern eine Ablehnung', () => {
  assert.deepEqual(doppelklick(clip(), A, 100), { label: 'Add marker', befehle: [{ befehl: 'warp_marker', clip_id: 'c1', setze: [{ quell_s: 1 }] }] });
  assert.deepEqual(doppelklick(clip(), A, 201), { label: 'Delete marker', befehle: [{ befehl: 'warp_marker', clip_id: 'c1', loesche: [4] }] });
  assert.match(doppelklick(clip(warp([[0, 0], [2, 4]])), A, 200).fehler, /at least two markers/);
  assert.equal(doppelklick(clip(), A, -50), null, 'links vor dem Anfang der Quelle: nichts');
  assert.equal(doppelklick({ id: 'c1', art: 'audio' }, A, 100), null, 'ohne Warp: nichts');
});

test('Ziehen: ohne Umschalt wandert die Quellzeit (Beat bleibt), mit Umschalt der Beat (Quellzeit bleibt, Sechzehntel); zu kurz oder wirkungslos: null', () => {
  const c = clip();                                              // Marker 1 bei 2 s, Beat 4; Segment rechts: 4 Beats in 2 s = 120 BPM
  assert.deepEqual(ziehen(c, A, 1, 25, false), { label: 'Move marker', befehle: [{ befehl: 'warp_marker', clip_id: 'c1', verschiebe: [{ beat: 4, neu_quell_s: 2.25 }] }] });
  assert.deepEqual(ziehen(c, A, 1, 100, true), { label: 'Move marker (beat)', befehle: [{ befehl: 'warp_marker', clip_id: 'c1', verschiebe: [{ beat: 4, neu_beat: 6 }] }] },
    '1 s nach rechts bei 120 BPM = 2 Beats');
  assert.equal(ziehen(c, A, 1, 12.5, true).befehle[0].verschiebe[0].neu_beat, 4.25, '0,125 s = 0,25 Beats');
  assert.equal(ziehen(c, A, 1, 10, true).befehle[0].verschiebe[0].neu_beat, 4.1875, '0,1 s = 0,2 Beats, gerastet auf Sechzehntel');
  assert.equal(ziehen(c, A, 1, 0.4, false), null, 'weniger als ein Pixel'); assert.equal(ziehen(c, A, 1, 0.5, true), null);
  assert.equal(ziehen(c, A, 2, 50, true).befehle[0].verschiebe[0].neu_beat, 9, 'der letzte Marker nimmt das Tempo des Segments links davon (0,5 s = 1 Beat)');
  assert.equal(ziehen(c, A, 0, -50, false), null, 'vor Sekunde 0 geht nichts'); assert.equal(ziehen(c, A, 7, 50, false), null);
  assert.equal(ziehen(c, A, 1, 0.3, true), null);
});

test('Rechtsklick-Menü: fünf Punkte mit fertigen Befehlen; auf einem Marker mit dessen genauen Werten, daneben mit dem Raster dort; Delete nur auf einem Marker', () => {
  const auf = menuPunkte(clip(), A, 201, 4);
  assert.deepEqual(auf.map((p) => p.text), ['Warp From Here (Straight)', 'Warp From Here (Start)', 'Set 1.1.1 Here', 'Delete Marker', 'Quantize Audio']);
  assert.deepEqual(auf.map((p) => p.befehl), [
    { befehl: 'warp_ab_hier', clip_id: 'c1', beat: 4, art: 'gerade' }, { befehl: 'warp_ab_hier', clip_id: 'c1', beat: 4, art: 'start' },
    { befehl: 'eins_hier', clip_id: 'c1', quell_s: 2 }, { befehl: 'warp_marker', clip_id: 'c1', loesche: [4] },
    { befehl: 'audio_quantisieren', clip_id: 'c1', raster: '1/16' }]);
  assert.equal(auf[4].label, 'Quantize audio');
  assert.deepEqual(auf.map((p) => !!p.aus), [false, false, false, false, false]);
  for (const z of [0, null, undefined]) assert.equal(menuPunkte(clip(), A, 201, z)[4].aus, true, `ohne Transienten (${z}) gesperrt`);
  const neben = menuPunkte(clip(), A, 100);                      // 1,0 s liegt auf Beat 2
  assert.deepEqual([neben[0].befehl.beat, neben[2].befehl.quell_s], [2, 1]);
  assert.equal(neben[3].aus, true, 'Negativkontrolle: Delete Marker neben einem Marker ist gesperrt');
  assert.equal(menuPunkte(clip(warp([[0, 0], [2, 4]])), A, 200)[3].aus, true, 'und bei nur zwei Markern');
  assert.deepEqual(menuPunkte({ id: 'c1', art: 'audio' }, A, 10), []);
});

test('Beschriftung: Segment-Tempo unter dem Zeiger, Marker-Text (Taktnummern, 1.1.1)', () => {
  const c = clip(warp([[0, 0], [2, 4], [3, 5]]));                // 120 BPM, dann 60 BPM
  assert.equal(segmentText(c, A, 100), '120.0 BPM'); assert.equal(segmentText(c, A, 250), '60.0 BPM'); assert.equal(segmentText(c, A, 900), '60.0 BPM', 'Randsegment');
  assert.deepEqual([0, 4, 8, 2, -4, 0.5].map(markerText), ['1.1.1', '2', '3', '', '-1', ''], 'vor der Eins negative Takte ohne Takt 0');
});

// --- gegen die Projekt-Attrappe -----------------------------------------------------------------------------------------------------------------------------------
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
async function aufbau(at, w = warp([[0, 0], [2, 4], [4, 8]])) {
  await post(at.url, '/proj/neu', { name: 'Editor' });
  const r = await post(at.url, '/proj/aendern', { rev: 1, label: 'Aufbau', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'tempo_setzen', bpm: 128 },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 8, sha256: SHA, warp: w }] });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  return { rev: r.j.rev, clip: r.j.projekt.spuren[0].clips[0] };
}
const sende = async (at, rev, g) => { const r = await post(at.url, '/proj/aendern', { rev, label: g.label, befehle: g.befehle }); return r; };

test('AK30 gegen die Attrappe: Doppelklick setzt, Ziehen verschiebt (beide Modi), Rechtsklick-Befehle wirken; je ein Schritt; Oberfläche englisch', () => mitAttrappe(async (at) => {
  let { rev, clip: c } = await aufbau(at);
  const gesten = [
    ['Doppelklick leer', (cl) => doppelklick(cl, A, 100), (cl) => cl.warp.marker.length === 4 && cl.warp.marker[1][0] === 1 && cl.warp.marker[1][1] === 2],
    ['Ziehen (Beat bleibt)', (cl) => ziehen(cl, A, 2, 25, false), (cl) => cl.warp.marker[2][0] === 2.25 && cl.warp.marker[2][1] === 4],
    ['Ziehen mit Umschalt (Quellzeit bleibt)', (cl) => ziehen(cl, A, 2, 25, true), (cl) => cl.warp.marker[2][0] === 2.25 && cl.warp.marker[2][1] > 4],
    ['Doppelklick auf Marker löscht', (cl) => doppelklick(cl, A, 1), (cl) => cl.warp.marker.length === 3],
    ['Set 1.1.1 Here', (cl) => ({ label: 'x', befehle: [menuPunkte(cl, A, sZuX(A, cl.warp.marker[1][0])).find((p) => p.id === 'eins').befehl] }), (cl) => cl.warp.marker[1][1] === 0 && cl.warp.eins_unsicher === false],
    ['Warp From Here (Straight)', (cl) => ({ label: 'x', befehle: [menuPunkte(cl, A, sZuX(A, cl.warp.marker[0][0])).find((p) => p.id === 'gerade').befehl] }), (cl) => cl.warp.marker.length === 2],
  ];
  for (const [name, geste, ok] of gesten) {
    const g = geste(c);
    assert.ok(g?.befehle, `${name}: Geste ergibt Befehle (${JSON.stringify(g)})`);
    const r = await sende(at, rev, g);
    assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.j)}`);
    c = r.j.projekt.spuren[0].clips[0]; rev = r.j.rev;
    assert.ok(ok(c), `${name}: Stand ${JSON.stringify(c.warp.marker)}`);
    assert.equal(c.warp.quelle, 'hand', `${name}: Quelle hand`);
  }
  // ein Rückgängig je Geste: sechs Schritte zurück sind wieder der Aufbau
  for (let i = 0; i < gesten.length; i++) { const u = await post(at.url, '/proj/undo', { rev }); assert.equal(u.status, 200); rev = u.j.rev; }
  const zurueck = (await (await fetch(at.url + 'proj/aktuell')).json()).projekt.spuren[0].clips[0];
  assert.deepEqual(zurueck.warp, warp([[0, 0], [2, 4], [4, 8]]), 'sechs Gesten, sechs Undo: der Aufbau');
}));

test('AK30 gegen die Attrappe: ×2, :2, Set project tempo und Warp From Here (Start); Ablehnungen mit Grund', () => mitAttrappe(async (at) => {
  assert.equal((await post(at.url, '/attrappe/katalog', { eintraege: [{ sha: SHA, typ: 'track', bpm: 100, takte: null, dauer_s: 4 }] })).status, 200);
  const { rev, clip: c } = await aufbau(at);
  const x2 = await sende(at, rev, { label: 'x', befehle: [tempoBefehl(c, 2).befehl] });
  assert.equal(x2.status, 200); const k = x2.j.projekt.spuren[0].clips[0];
  assert.deepEqual([k.laenge_beats, k.warp.marker[2][1]], [16, 16]);
  const zu = await sende(at, x2.j.rev, { label: 'x', befehle: [projektTempoBefehl(k).befehl] });
  assert.deepEqual([zu.status, zu.j.fehler], [409, 'tempo_bereich'], '16 Beats in 4 s sind 240 BPM: außerhalb 60..200, nichts geändert');
  const x1 = await sende(at, x2.j.rev, { label: 'x', befehle: [tempoBefehl(k, 0.5).befehl] });
  assert.deepEqual([x1.j.projekt.spuren[0].clips[0].laenge_beats, x1.j.projekt.spuren[0].clips[0].warp.marker], [8, [[0, 0], [2, 4], [4, 8]]]);
  const tempo = await sende(at, x1.j.rev, { label: 'x', befehle: [projektTempoBefehl(x1.j.projekt.spuren[0].clips[0]).befehl] });
  assert.equal(tempo.status, 200); assert.equal(tempo.j.projekt.tempo_bpm, 120, '8 Beats in 4 s');
  const start = await sende(at, tempo.j.rev, { label: 'x', befehle: [menuPunkte(tempo.j.projekt.spuren[0].clips[0], A, 200).find((p) => p.id === 'start').befehl] });
  assert.equal(start.status, 200, JSON.stringify(start.j));
  const w = start.j.projekt.spuren[0].clips[0].warp;
  assert.deepEqual([w.quelle, w.marker.length, w.marker[1], w.marker[2][0]], ['hand', 3, [2, 4], 4], 'links bleibt, rechts kommt der Auto-Warp (100 BPM Library) an Beat 4 an');
  assert.ok(Math.abs(w.marker[2][1] - (4 + 2 * 100 / 60)) < 1e-6, `Ende bei ${w.marker[2][1]}`);
  const kein = await post(at.url, '/proj/aendern', { rev: start.j.rev, label: 'x', befehle: [{ befehl: 'eins_hier', clip_id: 'c1', quell_s: 2 }] });
  assert.deepEqual(kein.j.hinweise, [{ index: 0, hinweis: 'eins_nur_hier' }]);
}));

// Nachbesserung aus Review T16-18: ein Zug weit über den Nachbarn ergibt einen GÜLTIGEN Befehl (zwischen den Nachbarn, Segment-Tempo 15..800 BPM)
const bpmZwischen = (p, q) => 60 * (q[1] - p[1]) / (q[0] - p[0]);
const gueltig = (marker) => marker.every((m, i) => i === 0 || (m[0] > marker[i - 1][0] && m[1] > marker[i - 1][1] && bpmZwischen(marker[i - 1], m) >= 15 && bpmZwischen(marker[i - 1], m) <= 800));
function anwenden(c, g) {
  const v = g.befehle[0].verschiebe[0], marker = c.warp.marker.map((m) => [...m]), i = marker.findIndex((m) => m[1] === v.beat);
  if (v.neu_quell_s !== undefined) marker[i][0] = v.neu_quell_s; if (v.neu_beat !== undefined) marker[i][1] = v.neu_beat;
  return marker;
}
test('Ziehen weit über den Nachbarn: geklemmt, gültig, beide Modi, beide Richtungen, auch am Rand', () => {
  const c = clip();                                              // Marker bei 0 s/0, 2 s/4, 4 s/8; A: 100 px je Sekunde
  for (const [i, dx, umschalt] of [[1, 5000, false], [1, -5000, false], [1, 5000, true], [1, -5000, true], [0, 5000, false], [2, -5000, false], [2, 5000, true], [0, -5000, true]]) {
    const g = ziehen(c, A, i, dx, umschalt);
    if (g === null) continue;                                    // ein Randmarker, der schon am Anschlag steht, darf null ergeben, nie einen ungültigen Befehl
    assert.ok(gueltig(anwenden(c, g)), `Marker ${i}, dx ${dx}, Umschalt ${umschalt}: ${JSON.stringify(g.befehle[0].verschiebe)}`);
  }
  const rechts = anwenden(c, ziehen(c, A, 1, 5000, false));
  assert.ok(rechts[1][0] < 3.7 + 1e-5 && rechts[1][0] > 3.69, `4 Beats bis zum Nachbarn bei 4 s brauchen mindestens 0,3 s (800 BPM): ${rechts[1][0]}`);
  assert.ok(anwenden(c, ziehen(c, A, 1, 5000, true))[1][1] < 8, 'Umschalt: der Beat bleibt vor dem Nachbar-Beat 8');
  assert.ok(ziehen(c, A, 1, 5000, true) !== null && ziehen(c, A, 1, -5000, false) !== null, 'ein Zug über den Nachbarn ergibt weiter einen Befehl, nicht nichts');
});

test('Ziehen weit über den Nachbarn: der Server nimmt den Befehl an (Attrappe), kein warp_marker-Fehler', () => mitAttrappe(async (at) => {
  let { rev, clip: c } = await aufbau(at);
  for (const u of [false, true]) {
    const r = await sende(at, rev, ziehen(c, A, 1, 5000, u));
    assert.equal(r.status, 200, `Umschalt ${u}: ${JSON.stringify(r.j)}`);
    const z = await post(at.url, '/proj/undo', { rev: r.j.rev });
    rev = z.j.rev;
  }
}));

test('Transienten (Slice 4, T10): nur die im sichtbaren Fenster, gerundet auf halbe Pixel wie die Marker; leer ohne Liste', () => {
  const a = { s0: 0, pxProS: 40 };                                  // Fenster 0 bis 2,5 s bei 100 px
  assert.deepEqual(transientenPixel(a, [0.5, 1.0, 9], 100), [20.5, 40.5], 'die dritte (9 s) liegt außerhalb');
  assert.deepEqual(transientenPixel({ s0: 0.9, pxProS: 40 }, [0.5, 1.0, 9], 100), [4.5], 'links hinausgescrollt: der erste fällt weg');
  assert.deepEqual(transientenPixel(a, [0.5013], 100), [20.5], 'auf halbe Pixel gerundet');
  assert.deepEqual(transientenPixel(a, [], 100), []); assert.deepEqual(transientenPixel(a, null, 100), []);
});

test('Transienten (Fix-Runde Slice 4, Punkt 4): je Pixelspalte höchstens ein Wert, auch bei unsortierter Liste', () => {
  const a = { s0: 0, pxProS: 40 };
  assert.deepEqual(transientenPixel(a, [0.5, 0.5001, 0.5002, 0.51, 1.0], 100), [20.5, 40.5], '0,5 bis 0,51 s liegen alle in Spalte 20 (Rundung auf halbe Pixel)');
  assert.deepEqual(transientenPixel(a, [1.0, 0.5, 1.0001, 0.5001], 100), [40.5, 20.5], 'unsortiert: je Spalte einmal, Reihenfolge des ersten Auftretens');
});

test('transientenImClip (Schlussrunde Punkt 1): dieselbe Rechnung wie der Server: Beat über die Marker im Bereich [versatz, versatz + Länge)', async () => {
  const { transientenImClip } = await import('../oeffentlich/produktion/warp_editor.js');
  const clip = (marker, extra = {}) => ({ laenge_beats: 8, warp: { marker, versatz_beats: 0 }, ...extra });
  const q = [0.5, 1.0, 5.0, 9.0];
  assert.deepEqual(transientenImClip(clip([[0, 0], [2, 4], [4, 8]]), q), [0.5, 1.0], '5 s liegt bei Beat 10, außerhalb');
  assert.deepEqual(transientenImClip(clip([[0, 0], [2, 4], [5.2, 8]]), q), [0.5, 1.0, 5.0], 'Marker gezogen: 5 s liegt jetzt bei Beat 7,75');
  assert.deepEqual(transientenImClip({ laenge_beats: 8, warp: { marker: [[0, 0], [2, 4], [4, 8]], versatz_beats: 2 } }, q), [1.0], 'Versatz 2: ab Beat 2 (Quellsekunde 1), bis Beat 10');
  assert.deepEqual(transientenImClip(clip([[0, 0], [2, 4], [4, 8]], { loop_beats: 4 }), q), [0.5, 1.0], 'Loop: der Bereich ist loop_beats (4 Beats = 2 s)');
  assert.deepEqual(transientenImClip(clip([[0, 0], [2, 4], [4, 8]], { loop_beats: 1 }), q), [], 'Loop 1 Beat: [0, 1); der Treffer bei 0,5 s liegt auf Beat 1 und gehört nicht mehr dazu (halboffen wie beim Server)');
});
