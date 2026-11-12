// Plan live-module task 3 (decision 16): POST /modul/leeren. The fader ramps on the core clock (a clock double, every poll moves it on), then the
// whole tree of the slot goes in ONE undo step; the other slot is not touched; the module is saved before it is removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { liveAufbau } from './support/live_module.mjs';
import { fahreRampe, rampeWert } from '../areas/live/ramp.ts';

const baum = (p, slot) => {
  const top = p.gruppen.find((g) => g.ausgang === undefined && g.modul?.slot === slot);
  if (!top) return { gruppen: [], spuren: [] };
  const gruppen = [top];
  for (let i = 0; i < gruppen.length; i++) for (const g of p.gruppen) if (g.ausgang?.id === gruppen[i].id) gruppen.push(g);
  const ids = new Set(gruppen.map((g) => g.id));
  return { gruppen, spuren: p.spuren.filter((s) => s.ausgang && ids.has(s.ausgang.id)) };
};
// two modules, both fader open (the module comes in closed at -200)
async function zweiModule(t, opt) {
  const z = await liveAufbau(t, opt);
  await z.exportiere('A');
  await z.exportiere('B');
  const p = z.projekt();
  await z.aendern([{ befehl: 'gruppenspur_aendern', gruppe_id: z.gruppeVon(p, 'A').id, fader_db: 0 },
    { befehl: 'gruppenspur_aendern', gruppe_id: z.gruppeVon(p, 'B').id, fader_db: -3 }]);
  return z;
}

test('rampeWert: starts at the start value, falls monotonically, reaches the end value only at t = 1', () => {
  assert.equal(rampeWert(0, -200, 0), 0);
  assert.equal(rampeWert(0, -200, 1), -200);
  let letzter = 0;
  for (let i = 1; i < 16; i++) { const w = rampeWert(0, -200, i / 16); assert.ok(w < letzter && w > -200); letzter = w; }
  assert.ok(letzter < -40, `the last step before silence is far down (${letzter})`);
  assert.equal(rampeWert(-6, -200, 0.5), -6 + 40 * Math.log10(0.5));
});

test('clear over 1 bar: rows step on the clock down to -200, then the whole tree of A goes in one undo step; B is untouched', async (t) => {
  const z = await zweiModule(t);
  const vor = z.projekt();
  const a0 = baum(vor, 'A'), b0 = baum(vor, 'B');
  assert.ok(a0.gruppen.length === 1 && a0.spuren.length === 1);
  const nrA = a0.gruppen[0].nr;
  z.protokoll.gesendet.length = 0;
  const revVorher = vor.rev, verlaufVor = z.offen().verlauf.liste?.length;
  const mitten = [];
  // while the ramp runs: the group still stands, the model fader is unchanged, and the other slot can be edited
  z.uhr.beiPoll = async (n) => {
    if (n === 20) {
      const p = z.projekt();
      mitten.push(baum(p, 'A').gruppen.length, z.gruppeVon(p, 'A').fader_db, z.zeilen().length);
      const x = await z.aendern([{ befehl: 'gruppenspur_aendern', gruppe_id: z.gruppeVon(p, 'B').id, fader_db: -9 }], 'edit B during the ramp');
      assert.equal(x.code, 200);
    }
  };
  const start = z.uhr.beat;
  const a = await z.l.leere({ slot: 'A', takte: 1 }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.zustand, 'rampe');
  assert.equal(a.j.ende_beat, start + 4);
  await z.l.fertig('A');
  assert.deepEqual(mitten.slice(0, 2), [1, 0], 'mid-ramp: tree stands, model fader still 0');
  assert.ok(mitten[2] > 3 && mitten[2] < 16, `rows are written along the way (${mitten[2]})`);
  const rows = z.zeilen().filter((x) => x.felder.pfad === `grp/${nrA}/fader`);
  assert.ok(rows.length >= 14 && rows.length <= 18, `about every 1/16 note: ${rows.length} rows in 4 beats`);
  const werte = rows.map((x) => x.felder.nach);
  assert.ok(werte.every((w, i) => i === 0 || w <= werte[i - 1]), `monotonic: ${werte.join(' ')}`);
  assert.equal(werte.at(-1), -200);
  assert.ok(rows.every((x) => x.felder.dauer_beats === 0 && x.felder.politik === 1 && x.felder.quelle === 'andreas'));
  assert.ok(rows.every((x, i) => i === 0 || x.felder.ab_beat >= rows[i - 1].felder.ab_beat));
  const dauer = rows.at(-1).felder.ab_beat - start;
  assert.ok(dauer >= 3.9 && dauer < 4.3, 'ends after 4 beats of the clock');
  const s = z.l.stand().A;
  assert.equal(s.zustand, 'fertig', JSON.stringify(s));
  assert.equal(s.gespeichert, true);
  const nach = z.projekt();
  assert.deepEqual(baum(nach, 'A'), { gruppen: [], spuren: [] });
  assert.equal(nach.spuren.filter((x) => x.name === 'Loop').length, 1, 'only the Loop of B is left');
  const b1 = baum(nach, 'B');
  assert.deepEqual(b1.spuren, b0.spuren, 'B tracks and clips unchanged');
  assert.equal(b1.gruppen[0].fader_db, -9, 'the edit of B during the ramp is kept');
  // one undo step brings the whole tree back
  const u = await z.s.umkehr('undo', { rev: nach.rev }, 'andreas');
  assert.equal(u.code, 200, JSON.stringify(u.j));
  const zurueck = z.projekt();
  const a2 = baum(zurueck, 'A');
  assert.equal(a2.gruppen.length, 1);
  assert.equal(a2.gruppen[0].fader_db, 0);
  assert.deepEqual(a2.spuren, a0.spuren);
  assert.equal(zurueck.gruppen.length, vor.gruppen.length);
  assert.ok(revVorher < nach.rev && verlaufVor !== null);
});

test('the module is saved when it is cleared, with its audio, before the tree goes', async (t) => {
  const z = await zweiModule(t, { speichern: false });
  assert.equal(fs.existsSync(z.modulOrdner), false);
  const a = await z.l.leere({ slot: 'B', takte: 0 }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.zustand, 'fertig');
  const datei = path.join(z.modulOrdner, a.j.modul_id, 'modul.json');
  const j = JSON.parse(fs.readFileSync(datei, 'utf8'));
  assert.equal(j.slot, 'B');
  assert.equal(j.herkunft.titel, 'Song');
  assert.equal(j.spuren.length, 1);
  assert.ok(fs.existsSync(path.join(path.dirname(datei), j.audio[0].datei)));
});

test('takte 0: the row goes to -200 at once and the tree is gone when the answer arrives', async (t) => {
  const z = await zweiModule(t);
  const nr = baum(z.projekt(), 'A').gruppen[0].nr;
  z.protokoll.gesendet.length = 0;
  const a = await z.l.leere({ slot: 'A', takte: 0 }, 'andreas');
  assert.equal(a.code, 200);
  assert.deepEqual(z.zeilen().map((x) => [x.felder.pfad, x.felder.nach]), [[`grp/${nr}/fader`, -200]]);
  assert.deepEqual(z.alleZeilen().map((x) => x.felder.nach), [-200, 0], 'then the freed slot goes back to its default with the removal');
  assert.equal(baum(z.projekt(), 'A').gruppen.length, 0);
  assert.equal(baum(z.projekt(), 'B').gruppen.length, 1);
});

test('refusals: takte not in 0,1,2,4,8,16, no slot, unknown field, empty slot, no live project, running ramp', async (t) => {
  const z = await zweiModule(t);
  for (const d of [{ slot: 'A', takte: 3 }, { slot: 'A', takte: -1 }, { slot: 'A', takte: '4' }, { slot: 'A' }, { slot: 'C', takte: 1 }, { takte: 1 }]) {
    assert.deepEqual(await z.fehl(() => z.l.leere(d, 'andreas')), { code: 400, fehler: 'argument_ungueltig' }, JSON.stringify(d));
  }
  assert.deepEqual(await z.fehl(() => z.l.leere({ slot: 'A', takte: 1, x: 1 }, 'andreas')), { code: 400, fehler: 'argument_unbekannt' });
  // a ramp is running: the same slot refuses, the other one may start its own
  const eigene = [];
  z.uhr.beiPoll = async (n) => {
    if (n === 5) {
      eigene.push(await z.fehl(() => z.l.leere({ slot: 'A', takte: 1 }, 'andreas')));
      const b = await z.l.leere({ slot: 'B', takte: 0 }, 'andreas');
      eigene.push(b.code, z.l.stand().B.zustand);
    }
  };
  await z.l.leere({ slot: 'A', takte: 1 }, 'andreas');
  await z.l.fertig('A');
  assert.deepEqual(eigene, [{ code: 409, fehler: 'rampe_laeuft' }, 200, 'fertig']);
  assert.equal(z.projekt().gruppen.filter((g) => g.modul).length, 0, 'both slots are empty now');
  assert.deepEqual(await z.fehl(() => z.l.leere({ slot: 'A', takte: 0 }, 'andreas')), { code: 409, fehler: 'slot_leer' });
});

test('no live project open: kein_liveprojekt', async (t) => {
  const z = await liveAufbau(t);
  await z.s.neu('Anderes', 'andreas');
  assert.deepEqual(await z.fehl(() => z.l.leere({ slot: 'A', takte: 0 }, 'andreas')), { code: 409, fehler: 'kein_liveprojekt' });
});

test('the ramp counts beats, not seconds: a tempo change in the middle does not move the end (4 beats of the clock)', async (t) => {
  const z = await zweiModule(t);
  const nr = baum(z.projekt(), 'A').gruppen[0].nr;
  z.protokoll.gesendet.length = 0;
  z.uhr.beiPoll = async (n) => { if (n === 10) { z.uhr.schritt = 0.2; z.uhr.bpm = 180; } };   // the clock now runs twice as fast per poll
  const start = z.uhr.beat;
  await z.l.leere({ slot: 'A', takte: 1 }, 'andreas');
  await z.l.fertig('A');
  const rows = z.zeilen().filter((x) => x.felder.pfad === `grp/${nr}/fader`);
  assert.equal(rows.at(-1).felder.nach, -200);
  assert.ok(rows.at(-1).felder.ab_beat - start >= 3.9 && rows.at(-1).felder.ab_beat - start < 4.25, `${rows.at(-1).felder.ab_beat - start} beats`);
  assert.ok(z.uhr.polls < 30, `fewer polls than the 40 of a constant tempo (${z.uhr.polls}): the end is in beats`);
});

test('no beat progress: stopped transport, no clock, or a stalled clock end at once (nothing to wait for), the tree is removed', async (t) => {
  for (const wie of ['transport', 'keine_uhr', 'still']) {
    const z = await zweiModule(t, { kernDa: wie !== 'keine_uhr' });
    z.protokoll.gesendet.length = 0;
    if (wie === 'transport') z.uhr.laeuft = false;
    if (wie === 'still') z.uhr.steht = true;
    const a = await z.l.leere({ slot: 'A', takte: 4 }, 'andreas');
    assert.equal(a.code, 200);
    await z.l.fertig('A');
    const s = z.l.stand().A;
    assert.equal(s.zustand, 'fertig', `${wie}: ${JSON.stringify(s)}`);
    assert.equal(s.ende, wie === 'still' ? 'still' : 'sofort');
    assert.equal(baum(z.projekt(), 'A').gruppen.length, 0, wie);
    assert.equal(z.zeilen().at(-1).felder.nach, -200, wie);
    if (wie === 'still') assert.ok(z.uhr.wanduhr >= 1000 && z.uhr.wanduhr < 1100, `stall limit: ${z.uhr.wanduhr} ms`);
  }
});

test('Stop Cypher during a ramp of Cypher: the ramp stops, the row goes back to the model value, the module stays', async (t) => {
  const z = await zweiModule(t);
  const nr = baum(z.projekt(), 'A').gruppen[0].nr;
  z.protokoll.gesendet.length = 0;
  z.uhr.beiPoll = async (n) => { if (n === 10) z.zustand.ki = true; };
  assert.equal((await z.l.leere({ slot: 'A', takte: 2 }, 'cypher')).code, 200);
  await z.l.fertig('A');
  assert.equal(z.l.stand().A.zustand, 'abgebrochen');
  assert.equal(z.l.stand().A.grund, 'ki_gestoppt');
  assert.equal(baum(z.projekt(), 'A').gruppen.length, 1);
  assert.equal(z.zeilen().at(-1).felder.nach, 0, `last row = model fader (${z.zeilen().at(-1).felder.nach})`);
  assert.equal(z.zeilen().at(-1).felder.pfad, `grp/${nr}/fader`);
  assert.deepEqual(await z.fehl(() => z.l.leere({ slot: 'A', takte: 1 }, 'cypher')), { code: 409, fehler: 'ki_gestoppt' });
});

test('fahreRampe on its own: no end value when aborted; target other than -200 is linear', async () => {
  const uhr = { beat: 0, t: 0 };
  const schreibe = [];
  const ende = await fahreRampe({ kern: { uhr: () => ({ beat: uhr.beat, bpm: 120 }), laeuft: () => true }, von: -10, nach: -20, beats: 1,
    schreibe: (db) => schreibe.push(db), warte: async (ms) => { uhr.t += ms; uhr.beat += 0.05; }, jetzt: () => uhr.t });
  assert.equal(ende, 'erreicht');
  assert.equal(schreibe.at(-1), -20);
  assert.ok(Math.abs(schreibe[0] - (-10 + (-10) * 0.25)) < 0.6);
  const n = [];
  const e2 = await fahreRampe({ kern: { uhr: () => ({ beat: uhr.beat, bpm: 120 }), laeuft: () => true }, von: 0, nach: -200, beats: 4,
    schreibe: (d) => n.push(d),
    abbruch: () => n.length >= 2, warte: async (ms) => { uhr.t += ms; uhr.beat += 0.1; }, jetzt: () => uhr.t });
  assert.equal(e2, 'abgebrochen');
  assert.ok(!n.includes(-200));
});

for (const takte of [0, 1]) {
  test(`clear over ${takte} bars: the tracks of the module are muted first, 20 ms pass, only then the playback load (release must not bypass the module fader)`, async (t) => {
    const z = await zweiModule(t);
    const a = baum(z.projekt(), 'A');
    const stempel = [], orig = z.ctx.sende;
    z.ctx.sende = (adresse, f) => { stempel.push({ adresse, pfad: f.pfad, nach: f.nach, ms: z.uhr.wanduhr }); return orig(adresse, f); };
    t.after(() => { z.ctx.sende = orig; });
    const r = await z.l.leere({ slot: 'A', takte }, 'andreas');
    assert.equal(r.code, 200, JSON.stringify(r.j));
    await z.l.fertig('A');
    assert.equal(z.stand?.() ?? z.l.stand().A.zustand, 'fertig');
    const laden = stempel.findIndex((x) => x.adresse === '/k/arr/laden');
    assert.ok(laden > 0, JSON.stringify(stempel.map((x) => x.pfad ?? x.adresse)));
    for (const s of a.spuren) {
      const i = stempel.findIndex((x) => x.pfad === `spur/${s.nr}/mute` && x.nach === 1);
      assert.ok(i >= 0 && i < laden, `mute row of track ${s.nr} before the load`);
      assert.ok(stempel[laden].ms - stempel[i].ms >= 20, `at least 20 ms between mute and load (${stempel[laden].ms - stempel[i].ms})`);
    }
    const rampeEnde = stempel.findIndex((x) => x.nach === -200);
    assert.ok(rampeEnde >= 0 && stempel.findIndex((x) => x.pfad?.endsWith('/mute')) > rampeEnde, 'the mutes come after the ramp');
  });
}
