// D1 S2-Integration, Fix-Runde A7 (Spec 6.30): Warten auf die Tempo-Rampe bricht ab, wenn /uhr 1 s lang nicht weiterläuft (503 kein_kern),
// statt die Kette bis zu 20 s zu halten. Ein neuer Kern (/e/neustart mit neuer Generation) leert die gemerkte Kern-Lage (Decks, Boxen,
// Regler, Arrangement).
import test from 'node:test';
import assert from 'node:assert/strict';
import { KernLage } from '../bereiche/proj/lage.ts';
import { sitzung, warteBis } from './hilfen/proj_kontext.mjs';

const fehlerVon = async (p) => { try { return { r: await p }; } catch (e) { return { e }; } };

test('A7 Rampe: /uhr steht still → Start bricht nach etwa 1 s mit 503 kein_kern ab (nicht nach 20 s), kein /k/arr/start; die Kette ist frei', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('Q', 'andreas');                                     // Projekttempo 120
  s.ereignis('/uhr', { beat: 2, bpm: 128 }); k.leere();
  const t0 = Date.now();
  const { r, e } = await fehlerVon(s.transport({ aktion: 'start' }, 'andreas'));
  const dauer = Date.now() - t0;
  assert.equal(r, undefined, `erwartet 503, bekommen ${r?.code}`);
  assert.deepEqual([e.code, e.fehler], [503, 'kein_kern']);
  assert.ok(dauer >= 950 && dauer < 3000, `Abbruch nach ${dauer} ms`);
  assert.equal(k.an('/k/tempo/rampe').length, 1); assert.equal(k.an('/k/arr/start').length, 0);
  const t1 = Date.now();
  assert.equal((await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas')).code, 200);
  assert.ok(Date.now() - t1 < 500, 'die Kette ist sofort frei');
});

test('A7 Rampe Negativ-Kontrolle: /uhr läuft (langsam, aber stetig) → Start nach dem Rampen-Ende, auch wenn das länger als 1 s dauert', async (t) => {
  const { s, k } = sitzung(t);
  await s.neu('Q', 'andreas');
  s.ereignis('/uhr', { beat: 2, bpm: 128 }); k.leere();
  let beat = 2;
  const takt = setInterval(() => { beat += 0.35; s.ereignis('/uhr', { beat, bpm: 124 }); }, 100);   // Rampen-Ende Beat 8 nach etwa 1,7 s
  t.after(() => clearInterval(takt));
  const t0 = Date.now();
  const r = await s.transport({ aktion: 'start' }, 'andreas');
  clearInterval(takt);
  assert.equal(r.code, 200); assert.equal(r.j.tempo.gesetzt, true);
  assert.ok(Date.now() - t0 > 1200, 'länger als 1 s gewartet, weil /uhr weiterlief');
  assert.equal(k.an('/k/arr/start').length, 1);
});

test('A7 tempoAnMaster (S3): /uhr steht still → 503 kein_kern', async (t) => {
  const { s } = sitzung(t);
  await s.neu('Q', 'andreas');
  s.ereignis('/uhr', { beat: 2, bpm: 128 });
  const { e } = await fehlerVon(s.tempoAnMaster());
  assert.deepEqual([e?.code, e?.fehler], [503, 'kein_kern']);
});

test('A7 /e/neustart mit neuer Generation leert Decks, Boxen, Regler und Arrangement; gleiche Generation lässt alles stehen', () => {
  const fuelle = (l) => {
    l.nimm('/zustand/deck', { deck: 1, status: 2 });
    l.nimm('/e/loop', { box: 2, status: 3 });
    l.nimm('/e/regler', { pfad: 'spur/1/fader', wert: -12, halter: 'mensch' });
    l.nimm('/e/regler', { pfad: 'erz/2/fader', wert: -6, halter: 'frei' });
    l.nimm('/zustand/arr', { nr: 7, status: 2, loop_an: 0, projekt_beat: 0, ursprung_sample: 0, start_beat: 0, metronom_an: 0 });
  };
  const l = new KernLage();
  l.nimm('/k/willkommen', { generation: 3 });
  fuelle(l);
  l.nimm('/e/neustart', { generation: 3 });
  assert.deepEqual([l.deckLaeuft(), l.djLaeuft(), l.reglerWert('spur/1/fader'), l.arr?.nr], [true, true, -12, 7], 'gleiche Generation: bleibt');
  assert.deepEqual(l.nimm('/e/neustart', { generation: 4 }), { neustart: true });
  assert.deepEqual([l.deckLaeuft(), l.djLaeuft(), l.reglerWert('spur/1/fader'), l.reglerWert('erz/2/fader'), l.arr], [false, false, null, null, null]);
});

test('A7 nach /e/neustart: ein Wiederöffnen wartet auf das neue /zustand/arr statt die alte Nummer für einen Wiederanlauf zu halten', async (t) => {
  const { s, k } = sitzung(t, { arrFristMs: 50 });
  const r = await s.neu('Q', 'andreas');
  s.ereignis('/k/willkommen', { generation: 1 });
  s.ereignis('/zustand/arr', { nr: r.j.projekt.wiedergabe_rev, status: 0, loop_an: 0, projekt_beat: 0, ursprung_sample: 0, start_beat: 0, metronom_an: 0 });
  s.ereignis('/e/neustart', { generation: 2 });
  assert.ok(await warteBis(() => k.an('/k/arr/laden').length >= 2), 'nachNeustart lädt neu');
  k.leere();
  const o = await s.oeffnen('q', 'andreas');
  assert.equal(o.j.kern.wiederanlauf, undefined, 'die alte Kern-Lage zählt nicht mehr');
});
