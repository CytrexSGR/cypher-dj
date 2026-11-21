// Container core M3: the commands platz_setzen, strom_spur_neu and strom_send, the changed seq_anlegen / loopdeck_neu / modul_setzen, the removal of
// loopdeck_plaetze, and the kanal_offen gate by place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeProjekt, platzVonGruppe, strudelGruppe, stromSpur, geparkteGruppen, loopDeckGruppe } from '../project/model.ts';
import { fuehreListeAus, BefehlFehler, BEFEHL_NAMEN, PRO_BEFEHL } from '../project/commands.ts';
import { LOOPDECK_LABEL } from '../project/commands_loopdeck.ts';
import { seqGruppe } from '../project/seq.ts';
import { wende } from '../project/patch.ts';
import { liveAufbau } from './support/live_module.mjs';
import { ist } from './support/proj_context.mjs';
import { alsAntwort } from '../areas/proj/area.ts';

const kopie = (x) => JSON.parse(JSON.stringify(x));
const leer4 = () => [{ typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }];
const live = () => { const p = neuesProjekt('x'); p.live = true; p.plaetze = leer4(); return p; };
const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const ergebnis = (p, ...b) => fuehreListeAus(p, b);
const fehler = (p, ...b) => { try { fuehreListeAus(p, b); } catch (e) { assert.ok(e instanceof BefehlFehler, String(e)); return e; } return assert.fail(`${b.map((x) => x.befehl)} was not refused`); };
const valide = (p) => { const u = pruefeProjekt(kopie(p)); assert.ok('projekt' in u, JSON.stringify(u)); };
const setze = (p, platz, typ, extra = {}) => lauf(p, { befehl: 'platz_setzen', platz, typ, ...extra });
const herkunft = () => ({ quelle_sha256: 'c'.repeat(64), titel: 'Song', fassung: '1', basis_bpm: 120, von_beat: 4, laenge_beats: 16, bpm: 120, datum: '2026-11-12' });
const mitModul = (p) => {
  const q = lauf(p, { befehl: 'gruppenspur_neu', name: 'M' });
  return lauf(q, { befehl: 'modul_setzen', gruppe_id: q.gruppen.at(-1).id, modul: herkunft() });
};

test('platz_setzen strudel creates an empty strudel group at 0 dB and sets the place', () => {
  const p = setze(live(), 3, 'strudel');
  valide(p);
  const g = strudelGruppe(p);
  assert.ok(g);
  assert.deepEqual([g.name, g.fader_db, g.ausgang, g.strudel], ['STRUDEL', 0, undefined, {}]);
  assert.deepEqual(p.plaetze[2], { typ: 'strudel', gruppe: g.id });
  assert.equal(platzVonGruppe(p, g.id), 3);
});

test('strudel in each of A, B, C and D works; a parked strudel group is re-placed with the same id', () => {
  for (const n of [1, 2, 3, 4]) { const p = setze(live(), n, 'strudel'); assert.equal(platzVonGruppe(p, strudelGruppe(p).id), n); }
  const a = setze(live(), 1, 'strudel');
  const id = strudelGruppe(a).id;
  const geparkt = setze(a, 1, 'track');
  assert.deepEqual(geparkt.plaetze[0], { typ: 'track' });
  assert.deepEqual(geparkteGruppen(geparkt).map((g) => g.id), [id]);
  const b = setze(geparkt, 4, 'strudel');
  assert.equal(strudelGruppe(b).id, id, 'same group, not a new one');
  assert.equal(b.gruppen.length, 1);
  assert.deepEqual(b.plaetze[3], { typ: 'strudel', gruppe: id });
});

test('a second strudel place while the strudel group is placed elsewhere is typ_doppelt', () => {
  const p = setze(live(), 1, 'strudel');
  assert.equal(fehler(p, { befehl: 'platz_setzen', platz: 2, typ: 'strudel' }).grund, 'typ_doppelt');
});

test('platz_setzen track on a strudel place parks the group, its tracks and returns stay; undo restores place and group', () => {
  let p = setze(live(), 2, 'strudel');
  p = lauf(p, { befehl: 'strom_spur_neu', strom: 5 }, { befehl: 'strom_send', spur_id: 's1', ziel: 'hall', db: -6 });
  const vorher = kopie(p);
  const r = ergebnis(p, { befehl: 'platz_setzen', platz: 2, typ: 'track' });
  assert.deepEqual(r.projekt.plaetze[1], { typ: 'track' });
  assert.equal(r.projekt.gruppen.length, 1);
  assert.equal(r.projekt.spuren.length, 1);
  assert.equal(r.projekt.returns.length, 1);
  assert.equal(geparkteGruppen(r.projekt).length, 1);
  valide(r.projekt);
  assert.deepEqual(wende(kopie(r.projekt), r.zurueck), vorher, 'undo restores the place and the group');
});

test('platz_setzen seq without a group creates a deck; with the id of a parked deck it re-places it unchanged', () => {
  let p = setze(live(), 2, 'seq');
  const g = seqGruppe(p, 2);
  assert.ok(g);
  assert.equal(platzVonGruppe(p, g.id), 2);
  assert.equal(g.name, 'SEQ 2');
  const vor = kopie(g);
  p = setze(p, 2, 'track');
  assert.equal(seqGruppe(p, 2), undefined, 'parked: no place holds it');
  p = setze(p, 4, 'seq', { gruppe_id: vor.id });
  assert.deepEqual(p.gruppen.find((x) => x.id === vor.id), vor);
  assert.equal(platzVonGruppe(p, vor.id), 4);
  assert.equal(fehler(p, { befehl: 'platz_setzen', platz: 1, typ: 'seq', gruppe_id: vor.id }).grund, 'gruppe_vergeben');
  assert.equal(fehler(p, { befehl: 'platz_setzen', platz: 1, typ: 'seq', gruppe_id: 'g99' }).grund, 'gruppe_unbekannt');
  assert.equal(fehler(p, { befehl: 'platz_setzen', platz: 4, typ: 'seq' }).grund, 'seq_belegt');
});

test('platz_setzen loops creates deck 1 then deck 2, the third is refused platz_belegt', () => {
  let p = setze(live(), 1, 'loops');
  p = setze(p, 2, 'loops');
  assert.deepEqual([1, 2].map((n) => platzVonGruppe(p, loopDeckGruppe(p, n).id)), [1, 2]);
  valide(p);
  assert.equal(fehler(p, { befehl: 'platz_setzen', platz: 3, typ: 'loops' }).grund, 'platz_belegt');
});

test('platz_setzen stems needs a group; a module group is placed and parked by place', () => {
  const p0 = mitModul(live());
  assert.equal(fehler(p0, { befehl: 'platz_setzen', platz: 1, typ: 'stems' }).grund, 'argument_ungueltig');
  const id = p0.gruppen[0].id;
  const p = setze(p0, 3, 'stems', { gruppe_id: id });
  assert.equal(platzVonGruppe(p, id), 3);
  assert.equal(fehler(p, { befehl: 'platz_setzen', platz: 1, typ: 'stems', gruppe_id: id }).grund, 'gruppe_vergeben');
});

test('platz_setzen refusals: kein_liveprojekt, argument_ungueltig', () => {
  assert.equal(fehler(neuesProjekt('x'), { befehl: 'platz_setzen', platz: 1, typ: 'track' }).grund, 'kein_liveprojekt');
  for (const b of [{ platz: 0, typ: 'track' }, { platz: 5, typ: 'track' }, { platz: 1, typ: 'x' }, { platz: 1, typ: 'track', gruppe_id: 'g1' }, { platz: 1, typ: 'track', mehr: 1 }]) {
    const e = fehler(live(), { befehl: 'platz_setzen', ...b });
    assert.ok(['argument_ungueltig', 'argument_unbekannt'].includes(e.grund), JSON.stringify(b));
  }
});

test('strom_spur_neu adds a strom track to the strudel group: number, name, strom_belegt on repeat, kein_strudel_modul without a group', () => {
  assert.equal(fehler(live(), { befehl: 'strom_spur_neu', strom: 3 }).grund, 'kein_strudel_modul');
  const p = lauf(setze(live(), 3, 'strudel'), { befehl: 'strom_spur_neu', strom: 7 }, { befehl: 'strom_spur_neu', strom: 2, name: 'Pad' });
  valide(p);
  const s7 = stromSpur(p, 7), s2 = stromSpur(p, 2);
  assert.deepEqual([s7.art, s7.strom, s7.name, s7.clips, s7.ausgang], ['strom', 7, 'STR 7', [], { art: 'gruppe', id: strudelGruppe(p).id }]);
  assert.equal(s2.name, 'Pad');
  assert.notEqual(s7.nr, s2.nr);
  assert.equal(fehler(p, { befehl: 'strom_spur_neu', strom: 7 }).grund, 'strom_belegt');
  for (const strom of [0, 17, 1.5, 'a']) assert.equal(fehler(p, { befehl: 'strom_spur_neu', strom }).grund, 'argument_ungueltig');
});

test('strom_spur_neu on a parked strudel group still works (the group exists)', () => {
  const p = setze(setze(live(), 3, 'strudel'), 3, 'leer');
  assert.equal(stromSpur(lauf(p, { befehl: 'strom_spur_neu', strom: 1 }), 1).art, 'strom');
});

test('strom_send creates the strudel return lazily, sets the send, returns_voll at 8', () => {
  let p = lauf(setze(live(), 3, 'strudel'), { befehl: 'strom_spur_neu', strom: 1 });
  const sid = stromSpur(p, 1).id;
  assert.equal(fehler(p, { befehl: 'strom_send', spur_id: sid, ziel: 'x', db: 0 }).grund, 'argument_ungueltig');
  p = lauf(p, { befehl: 'strom_send', spur_id: sid, ziel: 'hall', db: -6 });
  valide(p);
  const r = p.returns.find((x) => x.strudel?.art === 'hall');
  assert.ok(r);
  assert.equal(r.gruppe, strudelGruppe(p).id);
  assert.deepEqual(p.spuren[0].sends.map((x) => [x.id, x.db]), [[r.id, -6]]);
  p = lauf(p, { befehl: 'strom_send', spur_id: sid, ziel: 'hall', db: -3 });
  assert.equal(p.returns.length, 1, 'no second return');
  assert.equal(p.spuren[0].sends[0].db, -3);
  p = lauf(p, { befehl: 'strom_send', spur_id: sid, ziel: 'delay', db: -9 });
  assert.equal(p.returns.length, 2);
  // fill the return table to the limit: a new strudel return is refused
  const q = lauf(setze(live(), 3, 'strudel'), { befehl: 'strom_spur_neu', strom: 1 });
  let f = q;
  for (let i = 0; i < 8; i++) f = lauf(f, { befehl: 'return_neu', name: `R${i}`, gruppe_id: strudelGruppe(f).id });
  assert.equal(fehler(f, { befehl: 'strom_send', spur_id: stromSpur(f, 1).id, ziel: 'hall', db: -6 }).grund, 'returns_voll');
  assert.equal(fehler(live(), { befehl: 'strom_send', spur_id: 's1', ziel: 'hall', db: 0 }).grund, 'kein_strudel_modul');
});

test('seq_anlegen refuses a place that holds loops, strudel or stems and replaces a track place', () => {
  const p = setze(live(), 1, 'loops');
  assert.equal(fehler(p, { befehl: 'seq_anlegen', platz: 1 }).grund, 'platz_belegt');
  assert.equal(fehler(setze(live(), 2, 'strudel'), { befehl: 'seq_anlegen', platz: 2 }).grund, 'platz_belegt');
  const q = setze(live(), 2, 'track');
  const r = lauf(q, { befehl: 'seq_anlegen', platz: 2 });
  assert.equal(platzVonGruppe(r, seqGruppe(r, 2).id), 2);
  const d = lauf(live(), { befehl: 'seq_anlegen', platz: 4 });
  assert.equal(platzVonGruppe(d, seqGruppe(d, 4).id), 4);
});

test('loopdeck_neu keeps platz as the deck identity and takes the first free place scanning 3, 4, 1, 2; none free: parked', () => {
  let p = lauf(live(), { befehl: 'loopdeck_neu', platz: 1 });
  assert.equal(platzVonGruppe(p, loopDeckGruppe(p, 1).id), 3);
  p = lauf(p, { befehl: 'loopdeck_neu', platz: 2 });
  assert.equal(platzVonGruppe(p, loopDeckGruppe(p, 2).id), 4);
  let q = setze(setze(live(), 1, 'seq'), 2, 'strudel');
  q = lauf(q, { befehl: 'loopdeck_neu', platz: 1 });
  assert.equal(platzVonGruppe(q, loopDeckGruppe(q, 1).id), 3, 'a track or leer place is taken');
  let z = setze(setze(setze(setze(live(), 1, 'seq'), 2, 'strudel'), 3, 'seq'), 4, 'seq');
  z = lauf(z, { befehl: 'loopdeck_neu', platz: 1 });
  assert.equal(platzVonGruppe(z, loopDeckGruppe(z, 1).id), null, 'created parked');
  valide(z);
});

test('loopdeck_plaetze is gone from the command table and the labels; modul_setzen refuses a slot field', () => {
  assert.ok(!BEFEHL_NAMEN.includes('loopdeck_plaetze'));
  assert.ok(!Object.hasOwn(PRO_BEFEHL, 'loopdeck_plaetze'));
  assert.ok(!Object.hasOwn(LOOPDECK_LABEL, 'loopdeck_plaetze'));
  for (const n of ['platz_setzen', 'strom_spur_neu', 'strom_send']) assert.ok(BEFEHL_NAMEN.includes(n), n);
  const q = lauf(live(), { befehl: 'gruppenspur_neu', name: 'M' });
  const e = fehler(q, { befehl: 'modul_setzen', gruppe_id: q.gruppen[0].id, modul: { ...herkunft(), slot: 'A' } });
  assert.equal(e.grund, 'argument_ungueltig');
});

// --- the kanal_offen gate by place (route level) ---------------------------------------------------------------------
async function aufbau(t) {
  const z = await liveAufbau(t);
  const fehl = async (f) => {
    try { await f(); } catch (e) { const a = alsAntwort(e, z.ctx); return { code: a.code, fehler: a.j.fehler, platz: a.j.platz, kanal: a.j.kanal }; }
    return assert.fail('no refusal');
  };
  return { ...z, fehl };
}

test('gate: creating a deck on a place while its container channel is open is kanal_offen for every source; another place is not affected', async (t) => {
  const z = await aufbau(t);
  ist(z.s, 'deck/2/trim', 0); ist(z.s, 'deck/2/fader', -6);
  const rev = z.projekt().rev;
  for (const q of ['andreas', 'cypher']) {
    const e = await z.fehl(() => z.s.aendern({ rev, label: 'raw', befehle: [{ befehl: 'platz_setzen', platz: 2, typ: 'seq' }] }, q));
    assert.deepEqual([e.code, e.fehler, e.platz, e.kanal], [409, 'kanal_offen', 2, 'deck/2'], q);
  }
  const ok = await z.s.aendern({ rev, label: 'other place', befehle: [{ befehl: 'platz_setzen', platz: 1, typ: 'seq' }] }, 'andreas');
  assert.equal(ok.code, 200, JSON.stringify(ok.j));
});

test('gate: removing a deck on an open channel is refused for cypher only; undo is not gated', async (t) => {
  const z = await aufbau(t);
  const a = await z.s.aendern({ rev: z.projekt().rev, label: 'deck', befehle: [{ befehl: 'platz_setzen', platz: 2, typ: 'seq' }] }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  ist(z.s, 'deck/2/trim', 0); ist(z.s, 'deck/2/fader', -6);
  const rev = z.projekt().rev;
  const e = await z.fehl(() => z.s.aendern({ rev, label: 'away', befehle: [{ befehl: 'platz_setzen', platz: 2, typ: 'track' }] }, 'cypher'));
  assert.deepEqual([e.code, e.fehler], [409, 'kanal_offen']);
  const h = await z.s.aendern({ rev, label: 'away', befehle: [{ befehl: 'platz_setzen', platz: 2, typ: 'track' }] }, 'andreas');
  assert.equal(h.code, 200, 'Andreas is not restricted');
  const u = await z.s.umkehr('undo', { rev: z.projekt().rev }, 'cypher');
  assert.equal(u.code, 200, 'undo is not gated');
  assert.ok(seqGruppe(z.projekt(), 2), 'the deck is back');
});

// --- the gate covers every place change on an open strip (container core D3, review item 5) ----------------------------
const platzTypen = (p) => p.plaetze.map((x) => x.typ).join(',');
async function stemsGruppe(z) {
  await z.aendern([{ befehl: 'gruppenspur_neu', name: 'M' }]);
  const id = z.projekt().gruppen.at(-1).id;
  await z.aendern([{ befehl: 'modul_setzen', gruppe_id: id, modul: herkunft() }]);
  return id;
}
const PLATZ_BEFEHLE = {
  strudel: () => ({ befehl: 'platz_setzen', platz: 2, typ: 'strudel' }),
  loops: () => ({ befehl: 'platz_setzen', platz: 2, typ: 'loops' }),
  leer: () => ({ befehl: 'platz_setzen', platz: 2, typ: 'leer' }),
  seq: () => ({ befehl: 'platz_setzen', platz: 2, typ: 'seq' }),
};
const OFFEN = {
  fader: (z) => { ist(z.s, 'deck/2/trim', 0); ist(z.s, 'deck/2/fader', -6); },
  pfl: (z) => { ist(z.s, 'deck/2/trim', 0); ist(z.s, 'deck/2/fader', -200); ist(z.s, 'deck/2/pfl', 1); },
};

for (const [wie, oeffne] of Object.entries(OFFEN)) {
  for (const typ of [...Object.keys(PLATZ_BEFEHLE), 'stems']) {
    test(`gate: a track place changing to ${typ} is kanal_offen when the strip is open by ${wie}; closed it works`, async (t) => {
      const z = await aufbau(t);
      const befehl = typ === 'stems' ? { befehl: 'platz_setzen', platz: 2, typ: 'stems', gruppe_id: await stemsGruppe(z) } : PLATZ_BEFEHLE[typ]();
      oeffne(z);
      const vor = kopie(z.projekt());
      for (const q of ['andreas', 'cypher']) {
        const e = await z.fehl(() => z.s.aendern({ rev: z.projekt().rev, label: 'raw', befehle: [befehl] }, q));
        assert.deepEqual([e.code, e.fehler, e.platz, e.kanal], [409, 'kanal_offen', 2, 'deck/2'], `${typ} ${q}`);
      }
      assert.deepEqual(z.projekt().plaetze, vor.plaetze, 'no state change');
      assert.equal(z.projekt().rev, vor.rev);
      ist(z.s, 'deck/2/pfl', 0); ist(z.s, 'deck/2/fader', -200);
      const ok = await z.s.aendern({ rev: z.projekt().rev, label: 'closed', befehle: [befehl] }, 'andreas');
      assert.equal(ok.code, 200, JSON.stringify(ok.j));
      assert.equal(z.projekt().plaetze[1].typ, typ);
    });
  }
}

test('gate: leaving a strudel, a leer and a stems place on an open strip is kanal_offen as well; parking a loop deck is exempt', async (t) => {
  const z = await aufbau(t);
  const gid = await stemsGruppe(z);
  await z.aendern([{ befehl: 'platz_setzen', platz: 1, typ: 'strudel' }, { befehl: 'platz_setzen', platz: 2, typ: 'leer' }, { befehl: 'platz_setzen', platz: 3, typ: 'stems', gruppe_id: gid }, { befehl: 'platz_setzen', platz: 4, typ: 'loops' }]);
  assert.equal(platzTypen(z.projekt()), 'strudel,leer,stems,loops');
  for (const n of [1, 2, 3, 4]) { ist(z.s, `${['deck/1', 'deck/2', 'pad/1', 'pad/2'][n - 1]}/trim`, 0); ist(z.s, `${['deck/1', 'deck/2', 'pad/1', 'pad/2'][n - 1]}/fader`, -6); }
  for (const n of [1, 2, 3]) {
    const e = await z.fehl(() => z.s.aendern({ rev: z.projekt().rev, label: 'away', befehle: [{ befehl: 'platz_setzen', platz: n, typ: 'track' }] }, 'andreas'));
    assert.deepEqual([e.code, e.fehler], [409, 'kanal_offen'], `place ${n}`);
  }
  assert.equal(platzTypen(z.projekt()), 'strudel,leer,stems,loops', 'unchanged');
  const park = await z.s.aendern({ rev: z.projekt().rev, label: 'park', befehle: [{ befehl: 'platz_setzen', platz: 4, typ: 'track' }] }, 'andreas');
  assert.equal(park.code, 200, JSON.stringify(park.j));
});
