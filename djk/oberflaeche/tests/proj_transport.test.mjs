// D1 S2-Integration, Slice 5: Tempo-Regel, Transport mit Quant-Regel, Rückweg der Hand (Spec 2.2, 2.7, 3.4).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pruefKontext, sitzung, wav, warteBis } from './hilfen/proj_kontext.mjs';
import { baueKatalog, ksha } from './hilfen/katalog.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const fehlerVon = async (p) => { try { await p; } catch (e) { return e; } return null; };
const lies = (datei) => JSON.parse(fs.readFileSync(datei, 'utf8'));

test('Tempo (Spec 2.7): tempo_setzen bei laufendem Deck 409 deck_laeuft; sonst Rampe ab dem nächsten Takt über 4 Beats', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('T', 'andreas');
  s.ereignis('/uhr', { beat: 5.2, bpm: 120 });
  s.ereignis('/zustand/deck', { deck: 2, status: 2 });
  const e = await fehlerVon(s.aendern({ rev: 0, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm: 124 }] }, 'andreas'));
  assert.deepEqual([e.code, e.fehler], [409, 'deck_laeuft']);
  s.ereignis('/zustand/deck', { deck: 2, status: 1 }); k.leere();
  const r = await s.aendern({ rev: 0, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm: 124 }] }, 'andreas');
  assert.equal(r.j.projekt.tempo_bpm, 124);
  assert.deepEqual(k.an('/k/tempo/rampe').map((x) => x.felder), [{ quelle: 'andreas', ab_beat: 8, ziel_bpm: 124, dauer_beats: 4 }]);
});

test('Transport (Spec 2.2): quant 0 ohne DJ-Teil, 2 bei laufendem Deck, Box oder offenem Strom; Startbeat; stopp', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('P', 'andreas');
  s.ereignis('/uhr', { beat: 1, bpm: 120 }); k.leere();
  const a = await s.transport({ aktion: 'start', beat: 8 }, 'andreas');
  assert.deepEqual([a.code, a.j.ok, a.j.quant, a.j.start_beat], [200, true, 0, 8]);
  assert.deepEqual(k.an('/k/arr/start')[0].felder, { quelle: 'andreas', start_beat: 8, quant: 0 });
  s.ereignis('/e/loop', { box: 1, status: 3 });
  assert.equal((await s.transport({ aktion: 'start' }, 'andreas')).j.quant, 2);
  s.ereignis('/e/loop', { box: 1, status: 0 }); s.ereignis('/e/regler', { pfad: 'erz/1/fader', wert: -3, halter: 'frei' });
  assert.equal((await s.transport({ aktion: 'start' }, 'andreas')).j.quant, 2);
  s.ereignis('/e/regler', { pfad: 'erz/1/fader', wert: -200, halter: 'frei' });
  assert.equal((await s.transport({ aktion: 'start' }, 'andreas')).j.quant, 0);
  assert.deepEqual((await s.transport({ aktion: 'stopp' }, 'andreas')).j, { ok: true, quittung: { status: 3, grund: '' } });
  assert.equal((await fehlerVon(s.transport({ aktion: 'start', beat: -1 }, 'andreas'))).fehler, 'beat_ungueltig');
  assert.equal((await fehlerVon(s.transport({ aktion: 'pause' }, 'andreas'))).fehler, 'aktion_unbekannt');
});

test('Transport (Spec 2.7): Master-Tempo weicht ab → Rampe, Start erst nach ihrem Ende; bei laufendem Deck ohne Rampe', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('Q', 'andreas');
  s.ereignis('/uhr', { beat: 2, bpm: 128 }); k.leere();
  const start = s.transport({ aktion: 'start' }, 'andreas');
  assert.ok(await warteBis(() => k.an('/k/tempo/rampe').length === 1));
  assert.deepEqual(k.an('/k/tempo/rampe')[0].felder, { quelle: 'andreas', ab_beat: 4, ziel_bpm: 120, dauer_beats: 4 });
  s.ereignis('/uhr', { beat: 7.9, bpm: 121 });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(k.an('/k/arr/start').length, 0, 'vor dem Rampen-Ende kein Start');
  s.ereignis('/uhr', { beat: 8.01, bpm: 120 });
  const r = await start;
  assert.deepEqual([r.j.tempo.gesetzt, r.j.tempo.ziel_bpm], [true, 120]);
  assert.equal(k.an('/k/arr/start').length, 1);
  s.ereignis('/uhr', { beat: 9, bpm: 128 }); s.ereignis('/zustand/deck', { deck: 1, status: 2 }); k.leere();
  const d = await s.transport({ aktion: 'start' }, 'andreas');
  assert.deepEqual([d.j.tempo.grund, d.j.quant, k.an('/k/tempo/rampe').length], ['deck_laeuft', 2, 0]);
});

test('Rückweg (Spec 3.4): /e/regler spur/<n>/* mit Halter mensch landet im Projekt (Quelle andreas, zusammengefasst), sendet nichts an den Kern', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('H', 'cypher');
  await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  k.leere();
  for (const w of [-1, -2, -3, -4]) s.ereignis('/e/regler', { pfad: 'spur/1/fader', wert: w, halter: 'mensch', sample: 0n, beat: 0 });
  s.ereignis('/e/regler', { pfad: 'spur/1/pan', wert: 0.3, halter: 'cypher', sample: 0n, beat: 0 });
  s.ereignis('/e/regler', { pfad: 'spur/1/mute', wert: 1, halter: 'mensch', sample: 0n, beat: 0 });
  assert.ok(await warteBis(() => s.aktuell().j.projekt.spuren[0].mute === true));
  const p = s.aktuell().j.projekt;
  assert.deepEqual([p.spuren[0].fader_db, p.spuren[0].pan, p.spuren[0].mute], [-4, 0, true], 'nur der letzte Wert, nur mensch');
  assert.equal(k.gesendet.length, 0);
  const v = s.verlaufListe().j;
  // B4 (Spec 6.30): eine Geste ist ein Verlaufseintrag, auch über mehrere Regler
  assert.deepEqual(v.slice(1).map((e) => [e.quelle, e.label]), [['andreas', 'Mixer: Audio 1 fader, Audio 1 mute']]);
  assert.ok(k.verteilt.some((x) => x.a === 'proj' && x.f.label === 'Mixer: Audio 1 fader, Audio 1 mute' && x.f.quelle === 'andreas'));
});

test('KI-Stopp (Spec 2.12, 3.5): Cypher startet und stoppt keinen Transport (409 ki_gestoppt); Andreas schon', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('K', 'andreas');
  k.ki = true; k.leere();
  for (const p of [s.transport({ aktion: 'start' }, 'cypher'), s.transport({ aktion: 'stopp' }, 'cypher')]) {
    const e = await fehlerVon(p); assert.deepEqual([e?.code, e?.fehler], [409, 'ki_gestoppt']);
  }
  assert.equal(k.gesendet.length, 0);
  assert.equal((await s.transport({ aktion: 'start' }, 'andreas')).j.ok, true);
});
