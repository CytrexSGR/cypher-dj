// SEQ scenes T3: POST /seq/szene and GET /seq/szenen of SeqBereich. The core side (bar target, parts, receipts) is a double (SzenenWeg) so every receipt is
// fed by hand; the live container is the real proj session of support/live_modul.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { liveAufbau } from './support/live_module.mjs';
import { alsAntwort } from '../areas/proj/area.ts';
import { SeqBereich } from '../areas/live/seq.ts';
import { seqGruppe } from '../project/seq.ts';

const INFO = { art: 'rb338', regler: [], klaenge: [] };

function ordner(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-seq-szene-'));
  const bkO = path.join(tmp, 'bk'), kitO = path.join(tmp, 'kits');
  fs.mkdirSync(bkO); fs.mkdirSync(path.join(kitO, '909'), { recursive: true });
  fs.writeFileSync(path.join(bkO, 'bassmusik.json'), JSON.stringify({ knoten: [{ id: 1, art: 'regler', nr: 3, min: 0, max: 1 }] }));
  fs.writeFileSync(path.join(kitO, '909', 'kit.json'), JSON.stringify({ schema: 1, klaenge: [{ note: 36, name: 'kick', datei: 'k.wav' }] }));
  const vorher = { bk: process.env.CYPHERDJ_BK_ORDNER, kit: process.env.CYPHERDJ_KIT_ORDNER };
  process.env.CYPHERDJ_BK_ORDNER = bkO; process.env.CYPHERDJ_KIT_ORDNER = kitO;
  t.after(() => {
    for (const [k, v] of [['CYPHERDJ_BK_ORDNER', vorher.bk], ['CYPHERDJ_KIT_ORDNER', vorher.kit]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
}

// the core double: records parts and aborts, every launch waits until the test answers it (fertig) or the abort ends it with 7
function wegDouble() {
  const w = { lage: { kBeat: 100, offset: 0.37, bpm: 120, loopVon: 0, loopBis: 64, loopAn: true, laeuft: true }, teile: [], abbrueche: [], id: 0, reihenfolge: [] };
  w.zielLage = (loop) => (w.lage ? { ...w.lage, loopVon: loop.von_beat, loopBis: loop.bis_beat } : null);
  w.szenenTeile = (plan, quelle, ab, zeilen) => {
    const e = { plan, quelle, ab, zeilen, ids: zeilen.map(() => ++w.id), zu: false };
    w.teile.push(e); w.reihenfolge.push('teil');
    return new Promise((res) => { e.fertig = (status) => { e.zu = true; res(e.ids.map((id, i) => ({ id, status: typeof status === 'function' ? status(i) : status }))); }; });
  };
  w.abbruchPlan = async (plan, quelle) => {
    w.abbrueche.push({ plan, quelle }); w.reihenfolge.push('abbruch');
    for (const e of w.teile) if (!e.zu) e.fertig(7);
    return { status: 3, grund: '' };
  };
  return w;
}

async function aufbau(t, { mitWeg = true } = {}) {
  ordner(t);
  const z = await liveAufbau(t);
  const weg = wegDouble();
  const seq = new SeqBereich(z.ctx, z.zugang, { geraetInfo: () => INFO, ...(mitWeg ? { szenen: weg } : {}) });
  await seq.anlege({ platz: 2 }, 'andreas');
  for (const name of ['Drums', 'Bass', 'Lead']) {
    const a = await seq.folge({ platz: 2, name, geraet: 'rb338', loop_beats: 4 }, 'andreas');
    assert.equal(a.code, 200, JSON.stringify(a.j));
  }
  const spur = (name) => z.projekt().spuren.find((s) => s.name === name);
  const mutes = () => ['Drums', 'Bass', 'Lead'].map((n) => spur(n).mute);
  const setze = async (...m) => {
    const ids = ['Drums', 'Bass', 'Lead'];
    const x = await seq.befehle({ platz: 2, label: 'M', befehle: ids.map((n, i) => ({ befehl: 'spur_aendern', spur_id: spur(n).id, mute: m[i] })) }, 'andreas');
    assert.equal(x.code, 200, JSON.stringify(x.j));
  };
  const fehl = async (f) => { try { await f(); } catch (e) { const a = alsAntwort(e, z.ctx); return { code: a.code, fehler: a.j.fehler }; } assert.fail('no refusal'); };
  const schritte = () => z.offen().verlauf.liste().length;
  const warte = () => new Promise((r) => setTimeout(r, 15));
  const szene = (slot, aktion, q = 'andreas') => seq.szene({ slot, aktion }, q);
  const nr = (name) => spur(name).nr;
  return { ...z, seq, weg, spur, mutes, setze, fehl, schritte, warte, szene, nr };
}

test('save then list: counts, aktiv, and GET /seq/stand keeps exactly the keys 1..4', async (t) => {
  const z = await aufbau(t);
  await z.setze(false, true, false);
  const n0 = z.schritte();
  const a = await z.szene(2, 'speichern');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(z.schritte(), n0 + 1);
  assert.deepEqual(z.projekt().szenen[2], { an: [z.spur('Drums').id, z.spur('Lead').id], aus: [z.spur('Bass').id] });
  const l = z.seq.szenenStand().j;
  assert.equal(l.szenen.length, 8);
  assert.deepEqual(l.szenen[2], { an: 2, aus: 1 });
  assert.equal(l.szenen.filter((x) => x === null).length, 7);
  assert.equal(l.aktiv, 2);
  assert.equal(l.wartet, null);
  await z.setze(true, true, false);
  assert.equal(z.seq.szenenStand().j.aktiv, null, 'the buttons no longer show the picture');
  assert.deepEqual(Object.keys(z.seq.stand().j), ['1', '2', '3', '4']);
  assert.ok(z.ctx && z.protokoll.verteilt.some((e) => e.a === 'seq' && e.f.szene === true));
});

test('save refuses without a SEQ deck, bad slot and bad action are argument_ungueltig, clear empties the slot', async (t) => {
  const z = await aufbau(t);
  assert.equal((await z.fehl(() => z.szene(8, 'speichern'))).fehler, 'argument_ungueltig');
  assert.equal((await z.fehl(() => z.szene(-1, 'speichern'))).fehler, 'argument_ungueltig');
  assert.equal((await z.fehl(() => z.szene(1.5, 'speichern'))).fehler, 'argument_ungueltig');
  assert.equal((await z.fehl(() => z.szene(0, 'abspielen'))).fehler, 'argument_ungueltig');
  assert.equal((await z.fehl(() => z.seq.szene({ slot: 0, aktion: 'starten', x: 1 }, 'andreas'))).fehler, 'argument_unbekannt');
  assert.equal((await z.fehl(() => z.szene(5, 'starten'))).fehler, 'szene_leer_slot');
  await z.szene(1, 'speichern');
  assert.ok(z.projekt().szenen[1]);
  await z.szene(1, 'loeschen');
  assert.equal(z.projekt().szenen[1], null);
  await z.seq.leere({ platz: 2 }, 'andreas');
  assert.equal((await z.fehl(() => z.szene(3, 'speichern'))).fehler, 'szene_leer');
});

test('launch sends parts with one shared ab_beat and plan szene; the bar target is on the project grid', async (t) => {
  const z = await aufbau(t);
  await z.setze(false, true, true);
  await z.szene(0, 'speichern');
  await z.setze(true, false, true);
  const a = await z.szene(0, 'starten');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(z.weg.teile.length, 1);
  const e = z.weg.teile[0];
  assert.equal(e.plan, 'szene');
  // kBeat 100, offset 0.37, bpm 120: project beat >= 100 - 0.37 + lead, next multiple of 4, plus the offset
  assert.ok(e.ab > 100 && e.ab <= 100 + 4 + 1.5, `ab_beat ${e.ab}`);
  assert.ok(Math.abs((e.ab - 0.37) % 4) < 1e-9 || Math.abs((e.ab - 0.37) % 4 - 4) < 1e-9, `on the project bar grid: ${e.ab}`);
  assert.deepEqual(e.zeilen.map((r) => [r.pfad, r.wert]).sort(), [
    [`spur/${z.nr('Bass')}/mute`, 1], [`spur/${z.nr('Drums')}/mute`, 0], [`spur/${z.nr('Lead')}/mute`, 1]].sort());
  assert.deepEqual(a.j.wartet, { slot: 0, ziel_beat: e.ab });
  assert.deepEqual(z.seq.szenenStand().j.wartet, { slot: 0, ziel_beat: e.ab });
});

test('model changes at execution, not at press: ONE history entry after the receipts', async (t) => {
  const z = await aufbau(t);
  await z.setze(false, true, true);
  await z.szene(0, 'speichern');
  await z.setze(true, false, true);
  const vorher = z.mutes(), n0 = z.schritte();
  await z.szene(0, 'starten');
  assert.deepEqual(z.mutes(), vorher, 'unchanged at the press');
  assert.equal(z.schritte(), n0);
  z.weg.teile[0].fertig(3);
  await z.warte(); await z.warte();
  assert.deepEqual(z.mutes(), [false, true, true]);
  assert.equal(z.schritte(), n0 + 1);
  assert.equal(z.seq.szenenStand().j.wartet, null);
  assert.equal(z.seq.szenenStand().j.aktiv, 0);
});

test('last press wins: the second launch aborts plan szene before its parts; only the second scene lands', async (t) => {
  const z = await aufbau(t);
  await z.setze(false, true, true); await z.szene(0, 'speichern');
  await z.setze(true, false, true); await z.szene(1, 'speichern');
  await z.setze(true, true, true);
  await z.szene(0, 'starten');
  await z.szene(1, 'starten');
  assert.deepEqual(z.weg.reihenfolge, ['teil', 'abbruch', 'teil']);
  assert.deepEqual(z.weg.abbrueche, [{ plan: 'szene', quelle: 'andreas' }]);
  assert.equal(z.weg.teile.length, 2);
  await z.warte();
  assert.deepEqual(z.mutes(), [true, true, true], 'the aborted scene wrote nothing');
  z.weg.teile[1].fertig(3);
  await z.warte(); await z.warte();
  assert.deepEqual(z.mutes(), [true, false, true]);
  assert.equal(z.seq.szenenStand().j.wartet, null);
});

test('receipts are idempotent per launch: duplicates, 3 then 5, and 3 with 6 run szene_anwenden once', async (t) => {
  for (const status of [(i) => (i === 0 ? 3 : 5), (i) => (i === 0 ? 3 : 6), 5, 3]) {
    const z = await aufbau(t);
    await z.setze(false, true, true); await z.szene(0, 'speichern');
    await z.setze(true, true, true);
    const n0 = z.schritte();
    await z.szene(0, 'starten');
    z.weg.teile[0].fertig(status);
    z.weg.teile[0].fertig(3);                       // a duplicate resolution of the same promise is ignored by the promise itself
    await z.warte(); await z.warte();
    assert.deepEqual(z.mutes(), [false, true, true]);
    assert.equal(z.schritte(), n0 + 1, 'exactly one undo step');
  }
});

test('m click inside the window does not cancel: the scene overwrites, both are history entries; undo inside the window does not resurrect', async (t) => {
  const z = await aufbau(t);
  await z.setze(false, true, true); await z.szene(0, 'speichern');
  await z.setze(true, false, true);
  await z.szene(0, 'starten');
  const n0 = z.schritte();
  await z.setze(true, true, false);                  // M clicks after the press (three commands, one step)
  assert.equal(z.schritte(), n0 + 1);
  assert.equal((await z.s.umkehr('undo', { rev: z.projekt().rev }, 'andreas')).code, 200);   // undo inside the window
  assert.deepEqual(z.mutes(), [true, false, true]);
  z.weg.teile[0].fertig(3);
  await z.warte(); await z.warte();
  assert.deepEqual(z.mutes(), [false, true, true], 'the scene wins over the click');
  assert.ok(z.schritte() >= n0 + 2, 'the scene is its own step on top');
});

// the model write applies the picture of the PRESS: the lines the core got are the lines the model ends in
const mutesAusZeilen = (z, e) => ['Drums', 'Bass', 'Lead'].map((n) => e.zeilen.find((r) => r.pfad === `spur/${z.nr(n)}/mute`).wert === 1);

test('picture at press: SAVE onto the blinking slot inside the window changes nothing, model mutes equal the core lines', async (t) => {
  const z = await aufbau(t);
  await z.setze(false, true, true); await z.szene(0, 'speichern');         // slot 0 = [on, off, off]
  await z.setze(true, false, true);
  await z.szene(0, 'starten');
  const e = z.weg.teile[0];
  await z.setze(true, true, false); await z.szene(0, 'speichern');         // slot 0 overwritten inside the window = [off, off, on]
  z.weg.teile[0].fertig(3);
  await z.warte(); await z.warte();
  assert.deepEqual(mutesAusZeilen(z, e), [false, true, true]);
  assert.deepEqual(z.mutes(), mutesAusZeilen(z, e), 'model = core');
});

test('picture at press: clearing the slot inside the window still applies the pressed picture to the model', async (t) => {
  const z = await aufbau(t);
  await z.setze(false, true, true); await z.szene(0, 'speichern');
  await z.setze(true, false, true);
  await z.szene(0, 'starten');
  const e = z.weg.teile[0];
  await z.szene(0, 'loeschen');
  const n0 = z.schritte();
  z.weg.teile[0].fertig(3);
  await z.warte(); await z.warte();
  assert.deepEqual(z.mutes(), mutesAusZeilen(z, e), 'model = core, no szene_leer_slot');
  assert.equal(z.schritte(), n0 + 1);
  assert.equal(z.seq.szenenStand().j.wartet, null);
});

test('rev_veraltet retry: a project write between press and execution, the scene still applies on the newer rev as ONE undo step', async (t) => {
  const z = await aufbau(t);
  await z.setze(false, true, true); await z.szene(0, 'speichern');
  await z.setze(true, false, true);
  await z.szene(0, 'starten');
  // a concurrent writer: wraps the zugang so that the first szene_anwenden call finds its rev stale (another write lands just before it)
  const zugang = z.seq.zugang; const echt = zugang.aendern.bind(zugang);
  let gestoert = 0;
  zugang.aendern = async (d, q) => {
    if (!gestoert && d.befehle.some((b) => b.befehl === 'szene_anwenden')) {
      gestoert++;
      const x = await echt({ rev: z.projekt().rev, label: 'concurrent', befehle: [{ befehl: 'spur_aendern', spur_id: z.spur('Lead').id, mute: false }] }, 'andreas');
      assert.equal(x.code, 200);
    }
    return echt(d, q);
  };
  const n0 = z.schritte(), rev0 = z.projekt().rev;
  z.weg.teile[0].fertig(3);
  await z.warte(); await z.warte();
  assert.equal(gestoert, 1, 'the stale call happened');
  assert.deepEqual(z.mutes(), [false, true, true], 'scene applied on top of the concurrent write');
  assert.equal(z.schritte(), n0 + 2, 'concurrent step + exactly one scene step');
  assert.ok(z.projekt().rev > rev0 + 1);
  assert.equal(z.seq.szenenStand().j.aktiv, 0);
});

test('a pattern whose instrument is still loading is in the launch rows like the others', async (t) => {
  const z = await aufbau(t);
  await z.setze(false, true, true); await z.szene(0, 'speichern');
  await z.szene(0, 'starten');
  assert.equal(z.weg.teile[0].zeilen.length, 3, 'no extra gate, no wait');
});

test('stopped transport applies at once without parts', async (t) => {
  const z = await aufbau(t);
  await z.setze(false, true, true); await z.szene(0, 'speichern');
  await z.setze(true, true, true);
  z.weg.lage.laeuft = false;
  const a = await z.szene(0, 'starten');
  assert.equal(a.code, 200);
  assert.equal(z.weg.teile.length, 0);
  assert.deepEqual(z.mutes(), [false, true, true]);
  z.weg.lage = null;                                   // no pair known yet: also at once
  await z.setze(true, true, true);
  await z.szene(0, 'starten');
  assert.deepEqual(z.mutes(), [false, true, true]);
  assert.equal(z.weg.teile.length, 0);
});

test('without a core side (no szenen option) a launch applies at once', async (t) => {
  const z = await aufbau(t, { mitWeg: false });
  await z.setze(false, true, true); await z.szene(0, 'speichern');
  await z.setze(true, true, true);
  await z.szene(0, 'starten');
  assert.deepEqual(z.mutes(), [false, true, true]);
});

test('ki_gestoppt refuses cypher, allows andreas', async (t) => {
  const z = await aufbau(t);
  await z.setze(false, true, true); await z.szene(0, 'speichern');
  z.zustand.ki = true;
  assert.equal((await z.fehl(() => z.szene(0, 'starten', 'cypher'))).fehler, 'ki_gestoppt');
  assert.equal((await z.fehl(() => z.szene(0, 'speichern', 'cypher'))).fehler, 'ki_gestoppt');
  const a = await z.szene(0, 'starten', 'andreas');
  assert.equal(a.code, 200);
  assert.equal(z.weg.teile.length, 1);
  assert.equal(z.weg.teile[0].plan, 'szene');
  z.zustand.ki = false;
  await z.szene(0, 'starten', 'cypher');               // plan szene for both sources, so one abort reaches both
  assert.equal(z.weg.teile.at(-1).plan, 'szene');
  assert.equal(z.weg.teile.at(-1).quelle, 'cypher');
});

test('stop or core restart clears pending: no model write, no stuck blink', async (t) => {
  for (const [adresse, f] of [['/zustand/arr', { status: 0 }], ['/zustand/kern', { generation: 2 }], ['/e/neustart', { generation: 3 }]]) {
    const z = await aufbau(t);
    z.seq.ereignis('/zustand/kern', { generation: 1 });
    await z.setze(false, true, true); await z.szene(0, 'speichern');
    await z.setze(true, true, true);
    const n0 = z.schritte();
    await z.szene(0, 'starten');
    assert.ok(z.seq.szenenStand().j.wartet);
    z.protokoll.verteilt.length = 0;
    z.seq.ereignis(adresse, f);
    assert.equal(z.seq.szenenStand().j.wartet, null, adresse);
    assert.ok(z.protokoll.verteilt.some((e) => e.a === 'seq' && e.f.szene === true), 'the page learns that the blink ends');
    z.weg.teile[0].fertig(3);                          // a late receipt of the cleared launch
    await z.warte(); await z.warte();
    assert.deepEqual(z.mutes(), [true, true, true]);
    assert.equal(z.schritte(), n0);
  }
});

test('transport stop in the window aborts the core parts (plan szene)', async (t) => {
  const z = await aufbau(t);
  z.seq.ereignis('/zustand/kern', { generation: 1 });
  await z.setze(false, true, true); await z.szene(0, 'speichern');
  await z.setze(true, true, true);
  await z.szene(0, 'starten');
  z.seq.ereignis('/zustand/arr', { status: 0 });
  await z.warte();
  assert.equal(z.weg.abbrueche.length, 1, 'the open parts are aborted in the core');
  assert.equal(z.weg.abbrueche[0].plan, 'szene');
  assert.ok(z.weg.teile[0].zu, 'part A is closed');
});

test('core restart in the window sends no abort (the new core holds no parts)', async (t) => {
  const z = await aufbau(t);
  z.seq.ereignis('/zustand/kern', { generation: 1 });
  await z.setze(false, true, true); await z.szene(0, 'speichern');
  await z.setze(true, true, true);
  await z.szene(0, 'starten');
  z.seq.ereignis('/zustand/kern', { generation: 2 });
  await z.warte();
  assert.equal(z.weg.abbrueche.length, 0);
});

test('immediate launch while an earlier scene waits aborts the earlier parts', async (t) => {
  const z = await aufbau(t);
  z.seq.ereignis('/zustand/kern', { generation: 1 });
  await z.setze(false, true, true); await z.szene(0, 'speichern');
  await z.setze(true, true, true);
  await z.szene(0, 'starten');
  z.weg.lage = null;                                   // transport stopped without the arr event having arrived: the second press applies at once
  await z.szene(0, 'starten');
  assert.equal(z.weg.abbrueche.length, 1, 'the first scene must not fire after the second');
  assert.ok(z.weg.teile[0].zu);
  assert.deepEqual(z.mutes(), [false, true, true]);
});

test('late receipt 4 clears pending without model change', async (t) => {
  const z = await aufbau(t);
  await z.setze(false, true, true); await z.szene(0, 'speichern');
  await z.setze(true, true, true);
  const n0 = z.schritte();
  await z.szene(0, 'starten');
  z.weg.teile[0].fertig(4);
  await z.warte(); await z.warte();
  assert.equal(z.seq.szenenStand().j.wartet, null);
  assert.deepEqual(z.mutes(), [true, true, true]);
  assert.equal(z.schritte(), n0);
});

test('deleted pattern is skipped (no row for it); a pattern created after saving gets no row', async (t) => {
  const z = await aufbau(t);
  await z.setze(false, true, true); await z.szene(0, 'speichern');
  await z.seq.befehle({ platz: 2, label: 'x', befehle: [{ befehl: 'spur_loeschen', spur_id: z.spur('Lead').id }] }, 'andreas');
  await z.seq.folge({ platz: 2, name: 'Late', geraet: 'rb338', loop_beats: 4 }, 'andreas');
  await z.szene(0, 'starten');
  const pfade = z.weg.teile[0].zeilen.map((r) => r.pfad).sort();
  assert.deepEqual(pfade, [`spur/${z.nr('Bass')}/mute`, `spur/${z.nr('Drums')}/mute`].sort());
  assert.ok(seqGruppe(z.projekt(), 2));
});

test('no scene command changes group, solo or non-SEQ track rows', async (t) => {
  const z = await aufbau(t);
  await z.aendern([{ befehl: 'spur_neu', art: 'audio', name: 'Plain' }]);
  const plain = z.projekt().spuren.find((s) => s.name === 'Plain');
  await z.aendern([{ befehl: 'spur_aendern', spur_id: plain.id, mute: true }]);
  await z.setze(false, true, true); await z.szene(0, 'speichern');
  await z.setze(true, true, true);
  await z.szene(0, 'starten');
  for (const r of z.weg.teile[0].zeilen) assert.ok(/^spur\/\d+\/mute$/.test(r.pfad));
  assert.ok(!z.weg.teile[0].zeilen.some((r) => r.pfad === `spur/${plain.nr}/mute`));
  z.weg.teile[0].fertig(3);
  await z.warte(); await z.warte();
  assert.equal(z.projekt().spuren.find((s) => s.name === 'Plain').mute, true);
  assert.deepEqual(z.projekt().spuren.map((s) => s.solo), z.projekt().spuren.map(() => false));
});
