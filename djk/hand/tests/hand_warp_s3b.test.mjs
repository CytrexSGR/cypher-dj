// Paket 1.13 Warp, Slice 3b (AK28-Teil): Cypher setzt Marker, ×2 und Set 1.1.1 über das Werkzeug proj_aendern und liest sie mit proj_warp zurück, durch den ECHTEN Seiten-Server
// (Stapel mit Kern-Attrappe, Katalog und Karte), nicht durch eine Attrappe. Der Verlauf nennt cypher; ein Ablehnungsgrund kommt mit Text zurück.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const HAND = path.resolve(HIER, '..', 'hand.ts');
const OB = path.resolve(HIER, '..', '..', 'oberflaeche', 'tests', 'hilfen');
process.env.CYPHERDJ_TEST_INSTANZ ??= 'c';
const { stapel } = await import(path.join(OB, 'mediathek.mjs'));
const { baueKatalog, ksha } = await import(path.join(OB, 'katalog.mjs'));
const { karteLinear, schreibeKarte } = await import(path.join(OB, 'karte.mjs'));
const { tmpOrdner } = await import(path.join(OB, 'projekt.mjs'));
const { wav } = await import(path.join(OB, 'proj_kontext.mjs'));

test('AK28: über das Werkzeug proj_aendern Marker setzen, ×2 und Set 1.1.1, mit proj_warp zurücklesen; Quelle cypher im Verlauf; Ablehnung mit Grund', async (t) => {
  const d = tmpOrdner(t, 'djk-hand-s3b-');
  const katalog = baueKatalog(path.join(d, 'kat'), [{ n: 6, typ: 'track', werk_id: 2, titel: 'Song', bpm: 120, dauer_s: 25, pfad: wav(path.join(d, 'daten'), 'track.wav', 3.84) }]);
  const analyse = path.join(d, 'analyse');
  schreibeKarte(analyse, ksha(6), { karte: karteLinear(40, { t0: 0.5, bpm: 120 }), eins: 2, unsicher: true });
  const { url } = await stapel(t, { katalog, proj: { analyse } });
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', url] }));
  t.after(() => c.close());
  const ruf = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); return { fehler: !!r.isError, text: r.content[0].text, j: r.isError ? null : JSON.parse(r.content[0].text) }; };
  assert.equal((await ruf('proj_neu', { name: 'Hand S3b' })).fehler, false);
  const aufbau = await ruf('proj_aendern', { label: 'Track ablegen', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0,
    laenge_beats: 1, sha256: ksha(6), warp: 'auto' }] });
  assert.equal(aufbau.fehler, false, aufbau.text);
  const vor = (await ruf('proj_warp', { clip_id: 'c1', marker_max: 4096 })).j.warp;
  assert.deepEqual([vor.quelle, vor.marker_zahl, vor.eins_unsicher], ['werkstatt', 40, true]);
  // Marker setzen (ohne beat: der Klang ändert sich nicht), ×2, Set 1.1.1 an der Stelle 3,0 s: in EINER Liste, ein Undo-Schritt
  const hand = await ruf('proj_aendern', { label: 'Von Hand', befehle: [{ befehl: 'warp_marker', clip_id: 'c1', setze: [{ quell_s: 1.75 }] },
    { befehl: 'warp_tempo', clip_id: 'c1', faktor: 2 }, { befehl: 'eins_hier', clip_id: 'c1', quell_s: 3 }] });
  assert.equal(hand.fehler, false, hand.text);
  assert.deepEqual(hand.j.hinweise, [{ index: 2, hinweis: 'eins_nur_hier' }], 'der Stapel hat keinen Bestand: der Hinweis sagt es');
  const nach = (await ruf('proj_warp', { clip_id: 'c1', marker_max: 4096, bei_beat: 0 })).j;
  assert.deepEqual([nach.warp.quelle, nach.warp.marker_zahl, nach.warp.eins_unsicher], ['hand', 41, false]);
  const m3 = nach.warp.marker.find((m) => m.quell_s === 3);
  assert.equal(m3.beat, 0, 'die Stelle 3,0 s ist jetzt Beat 0');
  // der gesetzte Marker: vor ×2 Beat 0,5 (0,25 s hinter der Eins bei 2 Beats/s), nach ×2 Beat 1, nach Set 1.1.1 bei 3,0 s (Beat 6 nach ×2) Beat 1 − 6
  assert.equal(nach.warp.marker.find((m) => m.quell_s === 1.75).beat, -5);
  assert.deepEqual(nach.warp.marker.slice(0, 3).map((m) => m.segment_bpm), [240, 240, 240], 'alle Segmente 240 BPM statt 120');
  assert.equal(nach.bei.quell_s, 3, 'bei Projekt-Beat 0 klingt die neue Eins');
  const verlauf = (await ruf('proj_verlauf')).j;
  assert.equal(verlauf.at(-1).quelle, 'cypher'); assert.equal(verlauf.at(-1).label, 'Von Hand');
  const zurueck = await ruf('proj_undo');
  assert.equal(zurueck.fehler, false, zurueck.text);
  const alt = (await ruf('proj_warp', { clip_id: 'c1', marker_max: 4096 })).j.warp;
  assert.deepEqual([alt.quelle, alt.marker_zahl, alt.eins_unsicher], ['werkstatt', 40, true], 'ein Undo stellt alle drei Befehle zurück');
  const bad = await ruf('proj_aendern', { label: 'Falsch', befehle: [{ befehl: 'warp_marker', clip_id: 'c1', loesche: [999] }] });
  assert.equal(bad.fehler, true); assert.match(bad.text, /marker_unbekannt/);
});
