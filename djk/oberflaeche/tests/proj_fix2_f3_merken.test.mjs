// D1 S2-Integration, zweite Fix-Runde F3 (Spec 6.31): Loop- und Tempo-Änderungen einer Änderung, die während der Freeze-Sperre durchkommt (sie
// wurde vor der Sperre geprüft und wartete auf Regler-Quittungen), werden wie das Laden gemerkt und nach der Freigabe gesendet. Das Merk-Flag
// gehört zum offenen Projekt und verfällt beim Schließen. Belege: Re-Review rr_freigabe Test 3 (loopWaehrendSperre 1), Quality-Probe p1 R4.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { Projekte } from '../projekt/ablage.ts';
import { pruefKontext, warteBis } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
function aufbau(t) {
  const halte = new Set(); const wartend = [];
  const k = pruefKontext({ quittung: (adr) => (halte.has(adr)
    ? new Promise((ok) => wartend.push(() => ok({ status: 3, grund: '' }))) : { status: 3, grund: '' }) });
  const d = tmpOrdner(t, 'djk-f3-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  const frei = () => { halte.clear(); for (const f of wartend.splice(0)) f(); };
  const haengt = async () => { for (let i = 0; i < 200 && wartend.length === 0; i++) await schlaf(5); assert.ok(wartend.length > 0, 'Änderung hängt'); };
  return { k, b, s: b.sitzung, d, halte, frei, haengt };
}
// Eine Änderung mit Fader (wartet auf /k/teil) und `extra`; die Sperre kommt, während sie wartet
async function imRennen(e, extra) {
  const rev = e.s.aktuell().j.projekt.rev;
  e.halte.add('/k/teil'); e.k.leere();
  const p = e.s.aendern({ rev, label: 'Fader+', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }, extra] }, 'andreas');
  await e.haengt();
  const frei = e.b.zugang.sperreLaden();
  e.frei();
  return { r: await p, frei };
}

test('F3 Loop einer Änderung, die während der Sperre durchkommt: während der Sperre 0x /k/arr/loop, nach der Freigabe 1x mit dem neuen Loop', async (t) => {
  const e = aufbau(t);
  await e.s.neu('L', 'andreas');
  await e.s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  const { r, frei } = await imRennen(e, { befehl: 'loop_setzen', an: true, von_beat: 4, bis_beat: 12 });
  await schlaf(50);
  const waehrend = e.k.an('/k/arr/loop').length;
  frei();
  assert.ok(await warteBis(() => e.k.an('/k/arr/loop').length > 0, 500), 'Loop nach der Freigabe gesendet');
  await schlaf(50);
  const danach = e.k.an('/k/arr/loop');
  console.log(`F3 loop ${JSON.stringify({ code: r.code, kern_loop: r.j.kern.loop, loopWaehrendSperre: waehrend, danach: danach.length, felder: danach[0]?.felder })}`);
  assert.equal(r.code, 200);
  assert.equal(waehrend, 0, 'kein /k/arr/loop während der Sperre');
  assert.deepEqual(r.j.kern.loop, { aufgeschoben: true });
  assert.equal(danach.length, 1);
  assert.deepEqual([danach[0].felder.an, danach[0].felder.von_beat, danach[0].felder.bis_beat], [1, 4, 12]);
});

test('F3 Tempo einer Änderung, die während der Sperre durchkommt: während der Sperre keine Rampe, nach der Freigabe 1x zum neuen Tempo', async (t) => {
  const e = aufbau(t);
  await e.s.neu('T', 'andreas');
  await e.s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  const { r, frei } = await imRennen(e, { befehl: 'tempo_setzen', bpm: 100 });
  await schlaf(50);
  const waehrend = e.k.an('/k/tempo/rampe').length;
  frei();
  assert.ok(await warteBis(() => e.k.an('/k/tempo/rampe').length > 0, 500), 'Rampe nach der Freigabe gesendet');
  await schlaf(50);
  const danach = e.k.an('/k/tempo/rampe');
  console.log(`F3 tempo ${JSON.stringify({ code: r.code, kern_tempo: r.j.kern.tempo, rampeWaehrendSperre: waehrend, danach: danach.length, ziel: danach[0]?.felder.ziel_bpm })}`);
  assert.equal(r.code, 200);
  assert.equal(waehrend, 0, 'keine /k/tempo/rampe während der Sperre');
  assert.deepEqual(r.j.kern.tempo, { aufgeschoben: true });
  assert.equal(danach.length, 1);
  assert.equal(danach[0].felder.ziel_bpm, 100);
});

test('F3 Merk-Flag verfällt beim Schliessen (Quality R4): gemerktes Laden von Eins lädt nach dem Wechsel zu Zwei nicht noch einmal', async (t) => {
  const e = aufbau(t);
  await e.s.neu('Eins', 'andreas');
  new Projekte(path.join(e.d, 'projekte')).lege('Zwei');
  await e.s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  // gemerktes Laden in Eins: Spur-Anlage wartet, die Sperre kommt dazwischen
  e.halte.add('/k/teil');
  const p1 = e.s.aendern({ rev: 1, label: 'Spur 2', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_aendern', spur_id: 's1', fader_db: -1 }] }, 'andreas');
  await e.haengt();
  const frei1 = e.b.zugang.sperreLaden();
  e.frei();
  assert.deepEqual((await p1).j.kern.wiedergabe, { nr: null, aufgeschoben: true });
  // Kette belegt (Fader wartet), dahinter das Öffnen von Zwei; dann die Freigabe: das Nachholen stellt sich hinter das Öffnen
  e.halte.add('/k/teil');
  const p2 = e.s.aendern({ rev: 2, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -6 }] }, 'andreas');
  await e.haengt();
  const auf = e.s.oeffnen('zwei', 'andreas');
  e.k.leere();
  frei1();
  e.frei();
  assert.equal((await p2).code, 200);
  assert.equal((await auf).code, 200);
  await schlaf(150);
  const geladen = e.k.an('/k/arr/laden').map((x) => x.felder.nr);
  console.log(`F3 R4 ${JSON.stringify({ geladen, offen: e.s.aktuell().j.slug, wiedergabe_rev: e.s.aktuell().j.projekt.wiedergabe_rev })}`);
  assert.equal(e.s.aktuell().j.slug, 'zwei');
  assert.deepEqual(geladen, [e.s.aktuell().j.projekt.wiedergabe_rev], 'genau das eine Laden des Öffnens');
});

test('F3 Negativ-Kontrolle: ohne Sperre gehen Loop und Tempo derselben Änderung sofort an den Kern (je 1x), nach der Antwort nichts mehr', async (t) => {
  const e = aufbau(t);
  await e.s.neu('N', 'andreas');
  await e.s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  e.k.leere();
  const r = await e.s.aendern({ rev: 1, label: 'x', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 },
    { befehl: 'loop_setzen', an: true, von_beat: 4, bis_beat: 12 }, { befehl: 'tempo_setzen', bpm: 100 }] }, 'andreas');
  const sofort = [e.k.an('/k/arr/loop').length, e.k.an('/k/tempo/rampe').length];
  e.b.zugang.sperreLaden()();
  await schlaf(100);
  assert.equal(r.code, 200);
  assert.deepEqual(sofort, [1, 1]);
  assert.deepEqual([e.k.an('/k/arr/loop').length, e.k.an('/k/tempo/rampe').length], [1, 1], 'eine leere Sperre holt nichts nach');
});
