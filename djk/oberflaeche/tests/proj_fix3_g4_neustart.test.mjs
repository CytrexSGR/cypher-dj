// D1 S2-Integration, dritte Fix-Runde G4 (Spec 6.32, Ausnahme Kern-Neustart): Ein Neustart beendet jeden Freeze im Kern, nachNeustart lädt
// deshalb immer, auch während der Sperre. Nach dem gelungenen Laden sind die Merk-Flags für Laden und Loop des Offen erledigt (nachNeustart hat
// beides mit dem Stand von jetzt gesendet); die Freigabe lädt nicht noch einmal. War das Laden gemerkt, ist die alte Wiedergabe-Datei veraltet:
// nachNeustart schreibt dann eine neue, statt die alte nachzuladen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { wiedergabeDatei } from '../projekt/wiedergabe.ts';
import { pruefKontext, warteBis } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
function aufbau(t) {
  let halte = false; const wartend = [];
  const k = pruefKontext({ quittung: (adr) => (adr === '/k/teil' && halte
    ? new Promise((ok) => wartend.push(() => ok({ status: 3, grund: '' }))) : { status: 3, grund: '' }) });
  const d = tmpOrdner(t, 'djk-g4-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  return { k, b, s: b.sitzung, arr: path.join(d, 'arr'), halten: (x) => { halte = x; }, wartend };
}
const n = (e, a) => e.k.an(a).length;
// Änderung (Spur + Loop) kommt vor der Sperre durch die Prüfung, die Sperre kommt während der Regler-Quittungen: Laden und Loop sind gemerkt
async function gemerkt(e, sperren) {
  await e.s.neu('N', 'andreas');
  e.s.ereignis('/k/willkommen', { generation: 1 });
  e.halten(true);
  const p = e.s.aendern({ rev: 0, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'instrument' }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }] }, 'andreas');
  for (let i = 0; i < 200 && e.wartend.length === 0; i++) await schlaf(5);
  assert.ok(e.wartend.length > 0, 'die Änderung wartet auf Regler-Quittungen');
  const frei = sperren ? e.b.zugang.sperreLaden() : () => {};
  e.halten(false); for (const f of e.wartend.splice(0)) f();
  const r = await p;
  assert.equal(r.code, 200);
  return { frei, r };
}

for (const mitSperre of [true, false]) {
  test(`G4 Sperre, Merk-Flags gesetzt, /e/neustart (mitSperre=${mitSperre}): 1x Laden der neuen Wiedergabe; die Freigabe lädt nicht noch einmal`, async (t) => {
    const e = aufbau(t);
    const { frei, r } = await gemerkt(e, mitSperre);
    const alteNr = e.s.aktuell().j.projekt.wiedergabe_rev;
    const merkVor = { ...e.s.offen.merk };
    e.k.leere();
    e.s.ereignis('/e/neustart', { generation: 2 });
    assert.ok(await warteBis(() => n(e, '/k/arr/loop') > 0, 1000), 'nachNeustart ist durch');
    await schlaf(30);
    const neustart = { laden: n(e, '/k/arr/laden'), loop: n(e, '/k/arr/loop'), nr: e.k.an('/k/arr/laden')[0]?.felder.nr, merk: { ...e.s.offen.merk } };
    frei();
    await schlaf(80);
    const nachFreigabe = { laden: n(e, '/k/arr/laden'), loop: n(e, '/k/arr/loop') };
    const p = e.s.aktuell().j.projekt;
    const datei = JSON.parse(fs.readFileSync(wiedergabeDatei(e.arr, neustart.nr), 'utf8'));
    console.log(`G4 ${JSON.stringify({ mitSperre, kern: r.j.kern.wiedergabe, merkVor, alteNr, neustart, nachFreigabe, wiedergabe_rev: p.wiedergabe_rev })}`);
    if (mitSperre) assert.deepEqual([merkVor.laden, merkVor.loop], [true, true], 'Laden und Loop waren gemerkt');
    assert.equal(neustart.laden, 1, 'nachNeustart lädt genau einmal, auch während der Sperre');
    assert.equal(neustart.loop, 1);
    assert.deepEqual([neustart.merk.laden, neustart.merk.loop], [false, false], 'Merk-Flags nach dem gelungenen Laden gelöscht');
    assert.deepEqual(nachFreigabe, { laden: 1, loop: 1 }, 'die Freigabe lädt und sendet nichts zweites');
    assert.equal(neustart.nr, p.wiedergabe_rev, 'geladen ist die Wiedergabe, die das Projekt führt');
    assert.equal(datei.spuren.length, 1, 'die geladene Wiedergabe enthält die Spur der gemerkten Änderung');
    if (mitSperre) assert.ok(neustart.nr > alteNr, `neue Wiedergabe statt der veralteten ${alteNr}`);
    else assert.equal(neustart.nr, alteNr, 'Negativ-Kontrolle: ohne Sperre war schon geladen, der Neustart lädt dieselbe Datei');
  });
}

test('G4 Neustart während der Sperre ohne gemerktes Laden: 1x Laden der vorhandenen Wiedergabe, Freigabe danach ohne Laden', async (t) => {
  const e = aufbau(t);
  await e.s.neu('S', 'andreas');
  e.s.ereignis('/k/willkommen', { generation: 1 });
  const nr = e.s.aktuell().j.projekt.wiedergabe_rev;
  const frei = e.b.zugang.sperreLaden();
  e.k.leere();
  e.s.ereignis('/e/neustart', { generation: 2 });
  assert.ok(await warteBis(() => n(e, '/k/arr/loop') > 0, 1000));
  const unter = { laden: n(e, '/k/arr/laden'), nr: e.k.an('/k/arr/laden')[0]?.felder.nr };
  frei();
  await schlaf(50);
  assert.deepEqual(unter, { laden: 1, nr }, 'Spec 6.32: der Neustart lädt immer');
  assert.equal(n(e, '/k/arr/laden'), 1);
});

test('G4 Laden nach dem Neustart abgelehnt: die Merk-Flags bleiben, die Freigabe versucht es noch einmal', async (t) => {
  const e = aufbau(t);
  const { frei } = await gemerkt(e, true);
  let ablehnen = true;
  const regel = e.k.regel;
  e.k.regel = (adr, f) => (adr === '/k/arr/laden' && ablehnen ? { status: 6, grund: 'pruefung' } : regel(adr, f));
  e.k.leere();
  e.s.ereignis('/e/neustart', { generation: 2 });
  assert.ok(await warteBis(() => n(e, '/k/arr/loop') > 0, 1000));
  await schlaf(30);
  const merk = { ...e.s.offen.merk };
  ablehnen = false;
  frei();
  assert.ok(await warteBis(() => n(e, '/k/arr/laden') > 1, 1000), 'die Freigabe lädt erneut');
  console.log(`G4 abgelehnt ${JSON.stringify({ merk, laden: n(e, '/k/arr/laden') })}`);
  assert.deepEqual([merk.laden, merk.loop], [true, true]);
  assert.equal(n(e, '/k/arr/laden'), 2);
});

test('G4 gemerktes Tempo übersteht den Neustart: nachNeustart sendet kein Tempo, die Freigabe sendet es genau einmal', async (t) => {
  const e = aufbau(t);
  await e.s.neu('T', 'andreas');
  e.s.ereignis('/k/willkommen', { generation: 1 });
  await e.s.aendern({ rev: 0, label: 's', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  e.halten(true);
  const p = e.s.aendern({ rev: 1, label: 't', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -2 }, { befehl: 'tempo_setzen', bpm: 100 }] }, 'andreas');
  for (let i = 0; i < 200 && e.wartend.length === 0; i++) await schlaf(5);
  const frei = e.b.zugang.sperreLaden();
  e.halten(false); for (const f of e.wartend.splice(0)) f();
  assert.equal((await p).code, 200);
  e.k.leere();
  e.s.ereignis('/e/neustart', { generation: 2 });
  assert.ok(await warteBis(() => n(e, '/k/arr/loop') > 0, 1000));
  await schlaf(30);
  const unter = { tempo: n(e, '/k/tempo/rampe'), merk: e.s.offen.merk.tempo };
  frei();
  assert.ok(await warteBis(() => n(e, '/k/tempo/rampe') > 0, 1000));
  await schlaf(30);
  console.log(`G4 Tempo ${JSON.stringify({ unter, nach: n(e, '/k/tempo/rampe') })}`);
  assert.deepEqual(unter, { tempo: 0, merk: true });
  assert.equal(n(e, '/k/tempo/rampe'), 1);
  assert.equal(e.k.an('/k/tempo/rampe')[0].felder.ziel_bpm, 100);
});
