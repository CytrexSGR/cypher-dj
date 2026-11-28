// Strand 6 task 1.6: the pure helpers of the modulator row (no DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  taktStufen, vorgabeTiefe, tiefeBereich, modFuer, befehlNeu, befehlAendern, befehlTiefe, befehlPolaritaet, befehlAn, befehlRate, befehlLoeschen,
  modZielOk, modVoll, klemmeTiefe, stufeVon, MAX_MODULATOREN,
  insertModZiel, pluginModZiel, rackModZiel, modKnopfAktion, modKnopfZustand, pluginModIndizes, insertModWert,
  quellenWahl, befehlArt, befehlQuelle, befehlFolger, klemmeFolger, FOLGER_BEREICH, FOLGER_VORGABE,
} from '../public/production/mod_line.js';
import {
  MOD_TIEFE, MAX_MODULATOREN as MAX_MODELL, pruefeProjekt, MOD_ANGRIFF_MIN, MOD_ANGRIFF_MAX, MOD_ABFALL_MIN, MOD_ABFALL_MAX, MOD_EMPFINDLICH_MAX,
  MOD_ANGRIFF_VORGABE, MOD_ABFALL_VORGABE, MOD_EMPFINDLICH_VORGABE,
} from '../project/model.ts';
import { MOD_STAND as modStand } from '../public/mod_display.js';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { KOMP_PARAMETER, SAETT_PARAMETER, LIM_PARAMETER, EQ_BAND_PARAMETER, eqBandName, parameterVon } from '../public/production/inserts.js';
import { insertModKnopf, insertQuelleEq } from '../public/production/insert_face.js';
import { basisProjekt } from './support/inserts_scenario.mjs';

const m1 = { id: 'm1', nr: 1, art: 'lfo', form: 'sinus', takt: 4, ziele: [{ strang_id: 's1', ziel: 'fader', tiefe: -6 }, { strang_id: 's1', ziel: 'pan', tiefe: 0.5 }] };

test('rate steps: 15 steps, beats from the time signature numerator', () => {
  const s = taktStufen([4, 4]);
  assert.deepEqual(s.map(([t]) => t), ['1/32', '1/16T', '1/16', '1/8T', '1/8', '1/8.', '1/4T', '1/4', '1/4.', '1/2', '1 bar', '2 bars', '4 bars', '8 bars', '16 bars']);
  const b = Object.fromEntries(s);
  assert.equal(b['1/32'], 0.125); assert.equal(b['1/8.'], 0.75); assert.equal(b['1/4'], 1); assert.equal(b['1 bar'], 4); assert.equal(b['16 bars'], 64);
  assert.ok(Math.abs(b['1/8T'] - 1 / 3) < 1e-12);
  assert.equal(Object.fromEntries(taktStufen([3, 4]))['2 bars'], 6);
  assert.equal(Object.fromEntries(taktStufen(undefined))['1 bar'], 4);
  assert.ok(taktStufen([32, 4]).every(([, v]) => v <= 256));
  assert.equal(stufeVon(s, 4), 10); assert.equal(stufeVon(s, 3.3), -1);
});

test('default depth and range per target', () => {
  assert.equal(vorgabeTiefe('fader'), -6); assert.equal(vorgabeTiefe('pan'), 0.5); assert.equal(vorgabeTiefe('geraet.k3'), 0.25);
  assert.deepEqual(tiefeBereich('fader'), [-24, 24]); assert.deepEqual(tiefeBereich('pan'), [-1, 1]); assert.deepEqual(tiefeBereich('geraet.cutoff'), [-1, 1]);
  assert.equal(tiefeBereich('mute'), null);
  assert.equal(klemmeTiefe('pan', 3), 1); assert.equal(klemmeTiefe('fader', -99), -24);
});

test('constants equal model.ts', () => {
  assert.equal(MAX_MODULATOREN, MAX_MODELL);
  for (const k of ['fader', 'pan', 'geraet', 'send', 'insert', 'rack', 'plugin']) assert.deepEqual(tiefeBereich({ geraet: 'geraet.k1', send: 'send.r1', insert: 'insert.i1.schwelle', rack: 'rack.m1', plugin: 'plugin.i1.3' }[k] ?? k), [...MOD_TIEFE[k]]);
  for (const k of ['fader', 'pan', 'geraet']) assert.deepEqual(tiefeBereich(k === 'geraet' ? 'geraet.k1' : k), [...MOD_TIEFE[k]]);
});

test('modFuer finds the modulator of a target', () => {
  const p = { modulatoren: [m1] };
  assert.equal(modFuer(p, 's1', 'pan'), m1);
  assert.equal(modFuer(p, 's1', 'geraet.k1'), undefined);
  assert.equal(modFuer(p, 's2', 'pan'), undefined);
  assert.equal(modFuer({}, 's1', 'pan'), undefined);
});

test('which targets get "+ Mod"', () => {
  assert.ok(modZielOk('spur', 'fader') && modZielOk('spur', 'pan') && modZielOk('spur', 'geraet.k3') && modZielOk('return', 'fader'));
  assert.ok(!modZielOk('return', 'pan') && !modZielOk('spur', 'mute') && !modZielOk('spur', 'send.1') && !modZielOk('gruppe', 'fader') && !modZielOk('master', 'fader'));
});

test('16 modulators: the limit', () => {
  assert.equal(modVoll({ modulatoren: Array.from({ length: 15 }, () => m1) }), false);
  assert.equal(modVoll({ modulatoren: Array.from({ length: 16 }, () => m1) }), true);
  assert.equal(modVoll({}), false);
});

test('commands', () => {
  assert.deepEqual(befehlNeu('s1', 'fader'), { befehl: 'mod_neu', ziele: [{ strang_id: 's1', ziel: 'fader', tiefe: -6 }] });
  assert.deepEqual(befehlNeu('r1', 'geraet.k3').ziele[0], { strang_id: 'r1', ziel: 'geraet.k3', tiefe: 0.25 });
  assert.deepEqual(befehlAendern(m1, { form: 'saege' }), { befehl: 'mod_aendern', mod_id: 'm1', form: 'saege' });
  assert.deepEqual(befehlRate(m1, { hz: 2 }), { befehl: 'mod_aendern', mod_id: 'm1', hz: 2 });
  assert.deepEqual(befehlRate(m1, { takt: 0.5 }), { befehl: 'mod_aendern', mod_id: 'm1', takt: 0.5 });
  assert.deepEqual(befehlAn(m1, false), { befehl: 'mod_aendern', mod_id: 'm1', an: false });
  assert.deepEqual(befehlAn(m1, true), { befehl: 'mod_aendern', mod_id: 'm1', an: true });
  assert.deepEqual(befehlLoeschen(m1), { befehl: 'mod_loeschen', mod_id: 'm1' });
  // depth and polarity replace the whole list and touch only the shown target; the input stays unchanged
  const t = befehlTiefe(m1, 's1', 'pan', 0.8);
  assert.deepEqual(t.ziele, [{ strang_id: 's1', ziel: 'fader', tiefe: -6 }, { strang_id: 's1', ziel: 'pan', tiefe: 0.8 }]);
  assert.equal(m1.ziele[1].tiefe, 0.5);
  assert.equal(befehlTiefe(m1, 's1', 'pan', 9).ziele[1].tiefe, 1);
  assert.deepEqual(befehlPolaritaet(m1, 's1', 'fader', true).ziele[0], { strang_id: 's1', ziel: 'fader', tiefe: -6, polaritaet: 'uni' });
  const u = { ...m1, ziele: [{ strang_id: 's1', ziel: 'fader', tiefe: -6, polaritaet: 'uni' }] };
  assert.deepEqual(befehlPolaritaet(u, 's1', 'fader', false).ziele[0], { strang_id: 's1', ziel: 'fader', tiefe: -6 });
});

// ---- task 3.3: the follower; every command body is run through the model validation (commands + pruefeProjekt) ----
const lauf = (p, b) => fuehreListeAus(p, Array.isArray(b) ? b : [b], { quelle: 'andreas' }).projekt;
const gueltig = (p) => assert.equal(pruefeProjekt(p).fehler, undefined, JSON.stringify(pruefeProjekt(p)));
const szene = () => {
  let p = basisProjekt();
  p = lauf(p, { befehl: 'spur_neu', art: 'instrument', name: 'Acid', geraet: { art: 'intern', name: 'rb338', parameter: {} } });
  return p;
};

test('follower constants equal model.ts', () => {
  assert.deepEqual(FOLGER_BEREICH, { angriff_ms: [MOD_ANGRIFF_MIN, MOD_ANGRIFF_MAX], abfall_ms: [MOD_ABFALL_MIN, MOD_ABFALL_MAX], empfindlich_db: [-MOD_EMPFINDLICH_MAX, MOD_EMPFINDLICH_MAX] });
  assert.deepEqual(FOLGER_VORGABE, { angriff_ms: MOD_ANGRIFF_VORGABE, abfall_ms: MOD_ABFALL_VORGABE, empfindlich_db: MOD_EMPFINDLICH_VORGABE });
  assert.equal(klemmeFolger('angriff_ms', 0), 0.1); assert.equal(klemmeFolger('abfall_ms', 99999), 5000); assert.equal(klemmeFolger('empfindlich_db', -99), -24);
});

test('source choice: every track but the targets of the modulator', () => {
  const p = lauf(szene(), befehlNeu('s1', 'fader'));
  const m = p.modulatoren[0];
  const ids = (p.spuren ?? []).map((t) => t.id);
  assert.ok(ids.length >= 2);
  assert.deepEqual(quellenWahl(p, m).map(([id]) => id), ids.filter((id) => id !== 's1'));
  assert.ok(quellenWahl(p, m).every(([, label]) => typeof label === 'string' && label.length > 0));
  assert.deepEqual(quellenWahl(p, { ziele: [] }).map(([id]) => id), ids);
  assert.deepEqual(quellenWahl({}, m), []);
  // two targets on two tracks: neither is offered
  const m2 = { ...m, ziele: [m.ziele[0], { strang_id: 's2', ziel: 'pan', tiefe: 0.5 }] };
  assert.ok(!quellenWahl(p, m2).some(([id]) => id === 's1' || id === 's2'));
});

test('kind switch: bodies pass the model validation, both ways, fields of the old kind dropped', () => {
  let p = lauf(szene(), befehlNeu('s1', 'fader'));
  const lfo = p.modulatoren[0];
  const b = befehlArt(p, lfo, 'folger');
  assert.equal(b.befehl, 'mod_aendern'); assert.equal(b.art, 'folger'); assert.notEqual(b.quelle, 's1');
  assert.equal(befehlArt(p, lfo, 'lfo'), null);
  p = lauf(p, b); gueltig(p);
  const fo = p.modulatoren[0];
  assert.equal(fo.art, 'folger'); assert.equal(fo.quelle, b.quelle);
  for (const k of ['form', 'takt', 'hz', 'phase']) assert.ok(!(k in fo), k);
  // follower fields, clamped, one command each
  for (const [feld, wert, soll] of [['angriff_ms', 0.5, 0.5], ['abfall_ms', 9999, 5000], ['empfindlich_db', -30, -24], ['angriff_ms', 0, 0.1]]) {
    const c = befehlFolger(fo, feld, wert);
    assert.deepEqual(c, { befehl: 'mod_aendern', mod_id: 'm1', [feld]: soll });
    gueltig(lauf(p, c));
  }
  // another source, then back to the LFO: LFO defaults again, follower fields gone
  const andere = quellenWahl(p, fo).find(([id]) => id !== fo.quelle);
  if (andere) { const c = befehlQuelle(fo, andere[0]); assert.deepEqual(c, { befehl: 'mod_aendern', mod_id: 'm1', quelle: andere[0] }); p = lauf(p, c); gueltig(p); }
  p = lauf(p, befehlAn(p.modulatoren[0], false)); gueltig(p);
  p = lauf(p, befehlAn(p.modulatoren[0], true));
  const zurueck = befehlArt(p, p.modulatoren[0], 'lfo');
  assert.deepEqual(zurueck, { befehl: 'mod_aendern', mod_id: 'm1', art: 'lfo' });
  p = lauf(p, zurueck); gueltig(p);
  assert.deepEqual([p.modulatoren[0].art, p.modulatoren[0].form, p.modulatoren[0].takt, 'quelle' in p.modulatoren[0]], ['lfo', 'sinus', 4, false]);
});

test('kind switch: no free source track gives no command, and the model would refuse a source among the targets', () => {
  let p = szene();
  const alle = (p.spuren ?? []).map((t) => t.id);
  const ziele = alle.map((id) => ({ strang_id: id, ziel: 'fader', tiefe: -6 }));
  p = lauf(p, { befehl: 'mod_neu', ziele: ziele.slice(0, 8) });
  if (alle.length <= 8) assert.equal(befehlArt(p, p.modulatoren[0], 'folger'), null);
  assert.throws(() => lauf(p, { befehl: 'mod_aendern', mod_id: 'm1', art: 'folger', quelle: alle[0] }), (e) => e instanceof BefehlFehler);
});

// ---- task 4.4: targets of insert rows, plugin rows and face rings; every command body is run through the model validation ----
const PLUGIN = { format: 'vst3', pfad: '/opt/plugins/Fake EQ.vst3', uid: 'ABCDEF0123456789ABCDEF0123456789' };
const szeneInserts = () => {
  let p = lauf(szene(), [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }, { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'eq' },
    { befehl: 'insert_setzen', strang_id: 's1', pos: 2, art: 'saett' }, { befehl: 'insert_setzen', strang_id: 's1', pos: 3, art: 'lim' },
    { befehl: 'insert_setzen', strang_id: 's1', pos: 4, art: 'host', plugin: PLUGIN }, { befehl: 'return_neu', name: 'Hall' }]);
  return p;
};

test('target forms: send on a track only, insert, rack and plugin on any strip', () => {
  assert.ok(modZielOk('spur', 'send.r1') && !modZielOk('return', 'send.r1') && !modZielOk('gruppe', 'send.r1') && !modZielOk('spur', 'send.1'));
  for (const a of ['spur', 'return', 'gruppe', 'master']) assert.ok(modZielOk(a, 'insert.i1.schwelle') && modZielOk(a, 'rack.m2') && modZielOk(a, 'plugin.i1.3'), a);
  assert.ok(!modZielOk('spur', 'rack.m5') && !modZielOk('spur', 'insert.i1') && !modZielOk('spur', 'plugin.i1.x'));
  assert.deepEqual([vorgabeTiefe('send.r1'), vorgabeTiefe('insert.i1.schwelle'), vorgabeTiefe('rack.m1'), vorgabeTiefe('plugin.i1.3')], [-6, 0.25, 0.25, 0.25]);
  assert.deepEqual([tiefeBereich('send.r1'), tiefeBereich('insert.i1.x'), tiefeBereich('rack.m1'), tiefeBereich('plugin.i1.3')], [[-24, 24], [-1, 1], [-1, 1], [-1, 1]]);
});

test('insert rows: continuous parameters of built-in stages get a target the model accepts, switches and choices none', () => {
  const p = szeneInserts();
  const ins = Object.fromEntries(p.spuren.find((s) => s.id === 's1').inserts.map((i) => [i.art, i]));
  const proben = [['komp', KOMP_PARAMETER], ['saett', SAETT_PARAMETER], ['lim', LIM_PARAMETER],
    ['eq', EQ_BAND_PARAMETER.map((q) => ({ ...q, name: eqBandName(1, q.name) }))]];
  let stetig = 0;
  for (const [art, liste] of proben) {
    for (const q of liste) {
      const ziel = insertModZiel(ins[art], q.name, parameterVon(art, q.name));
      if (ziel === null) {
        // not offered: the model refuses it (switch, choice) or it is no parameter of the model
        const z = `insert.${ins[art].id}.${q.name}`;
        assert.throws(() => lauf(p, { ...befehlNeu('s1', z), ziele: [{ strang_id: 's1', ziel: z, tiefe: 0.25 }] }), (e) => e instanceof BefehlFehler, `${art} ${q.name}`);
        continue;
      }
      stetig++;
      assert.equal(ziel, `insert.${ins[art].id}.${q.name}`);
      const r = lauf(p, befehlNeu('s1', ziel));   // the exact body of the button
      gueltig(r);
      assert.deepEqual(r.modulatoren[0].ziele, [{ strang_id: 's1', ziel, tiefe: 0.25 }]);
    }
  }
  assert.ok(stetig >= 10, `only ${stetig} continuous rows`);
  assert.equal(insertModZiel(ins.komp, 'an', { typ: 'schalter' }), null);
  assert.equal(insertModZiel(ins.komp, 'sc', {}), null);
  assert.equal(insertModZiel(ins.host, 'schwelle', { min: 0, max: 1 }), null);   // a host stage has plugin.* targets
  assert.equal(insertModZiel(ins.komp, 'x', null), null);
});

test('plugin rows: the target, the body and the modulated indices', () => {
  let p = szeneInserts();
  const h = p.spuren.find((s) => s.id === 's1').inserts.find((i) => i.art === 'host').id;
  assert.equal(pluginModZiel(h, 3), `plugin.${h}.3`);
  const a = modKnopfAktion(p, 's1', pluginModZiel(h, 3), 'spur');
  assert.equal(a.art, 'neu'); assert.deepEqual(a.befehl, { befehl: 'mod_neu', ziele: [{ strang_id: 's1', ziel: `plugin.${h}.3`, tiefe: 0.25 }] });
  p = lauf(p, a.befehl); gueltig(p);
  assert.deepEqual(modKnopfAktion(p, 's1', pluginModZiel(h, 3), 'spur'), { art: 'zeige' });
  assert.deepEqual(pluginModIndizes(p, 's1', h), [3]); assert.deepEqual(pluginModIndizes(p, 's2', h), []); assert.deepEqual(pluginModIndizes({}, 's1', h), []);
  assert.deepEqual(modKnopfZustand(p, 's1', pluginModZiel(h, 3)), { aktiv: true, gesperrt: false, titel: 'This parameter is modulated: show the modulator' });
  // a send body on a track passes too
  const sb = modKnopfAktion(p, 's1', 'send.r1', 'spur').befehl;
  assert.deepEqual(sb.ziele[0], { strang_id: 's1', ziel: 'send.r1', tiefe: -6 });
  assert.throws(() => lauf(p, sb), (e) => e instanceof BefehlFehler);   // s1 has no send into r1 yet: the model refuses, the page keeps the row
  gueltig(lauf(lauf(p, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }), sb));
});

test('16 modulators: the Mod button is disabled with the title, a target with one shows it', () => {
  const m = (i, ziel) => ({ id: `m${i}`, nr: i, art: 'lfo', ziele: [{ strang_id: 's1', ziel, tiefe: 1 }] });
  const p = { modulatoren: Array.from({ length: 16 }, (_, i) => m(i + 1, `plugin.h.${i}`)) };
  assert.deepEqual(modKnopfAktion(p, 's1', 'plugin.h.20', 'spur'), { art: 'voll', titel: '16 modulators per project' });
  assert.deepEqual(modKnopfAktion(p, 's1', 'plugin.h.2', 'spur'), { art: 'zeige' });
  assert.equal(modKnopfZustand(p, 's1', 'plugin.h.20').gesperrt, true);
  assert.equal(modKnopfAktion(p, 's1', 'mute', 'spur'), null);
});

test('face ring: modulated value = base + offset fraction of the row range, clamped; undefined without a modulator, null while silent', () => {
  const q = { min: -60, max: 0 };
  assert.equal(insertModWert(undefined, -18, q), undefined);
  assert.equal(insertModWert(null, -18, q), null);
  assert.equal(insertModWert(0.25, -18, q), -3);
  assert.equal(insertModWert(-0.5, -18, q), -48);
  assert.equal(insertModWert(1, -18, q), 0); assert.equal(insertModWert(-1, -18, q), -60);
  // the face source: only a stage parameter that a switched-on modulator targets has a ring
  const p = lauf(szeneInserts(), befehlNeu('s1', `insert.${szeneInserts().spuren[0].inserts[0].id}.schwelle`));
  const k = p.spuren.find((s) => s.id === 's1').inserts[0];
  const ctx = { st: { projekt: p } };
  const mk = insertModKnopf(ctx, { id: 's1' }, k, KOMP_PARAMETER, () => 1000);
  assert.equal(mk('ratio'), undefined);
  assert.equal(mk('schwelle'), null);   // no event yet
  const MOD_STAND = modStand;
  MOD_STAND.set(p.modulatoren[0].nr, { out: 1, t: 900 });
  const w = mk('schwelle');
  assert.ok(Math.abs(w - Math.min(0, k.werte.schwelle + 0.25 * 60)) < 1e-9, String(w));
  MOD_STAND.clear();
});

test('face ring of the EQ: insertQuelleEq carries modKnopf; band parameters (b2/freq) are looked up through parameterVon', () => {
  const p = lauf(szeneInserts(), befehlNeu('s1', `insert.${szeneInserts().spuren[0].inserts[1].id}.b2/freq`));
  const e = p.spuren.find((s) => s.id === 's1').inserts.find((i) => i.art === 'eq');
  const ctx = { st: { projekt: p }, aendere: () => Promise.resolve(true) };
  const quelle = insertQuelleEq(ctx, { id: 's1', name: 'T' }, e);
  assert.equal(typeof quelle.modKnopf, 'function');
  assert.equal(quelle.modKnopf('b2/gain'), undefined, 'not targeted: no ring');
  assert.equal(quelle.modKnopf('b2/freq'), null, 'targeted, no event yet');
  modStand.set(p.modulatoren[0].nr, { out: 1, t: 900 });
  const w = insertModKnopf(ctx, { id: 's1' }, e, (n) => parameterVon('eq', n), () => 1000)('b2/freq');
  assert.equal(typeof w, 'number'); assert.ok(w <= 22000 && w >= 10);
  modStand.clear();
});

test('rack macros: the target is rack.m<nr> for 1 to 4, the model accepts it on a strip with a rack, the Mod button state follows the project', () => {
  assert.deepEqual([1, 2, 3, 4].map(rackModZiel), ['rack.m1', 'rack.m2', 'rack.m3', 'rack.m4']);
  assert.deepEqual([0, 5, 1.5, NaN, '1', undefined].map(rackModZiel), [null, null, null, null, null, null]);
  let p = szeneInserts();
  const e = p.spuren.find((s) => s.id === 's1').inserts.find((i) => i.art === 'eq').id;
  p = lauf(p, { befehl: 'rack_setzen', strang_id: 's1', makros: [{ ziel: [{ insert: e, param: 'b1/gain', von: -6, bis: 6 }] }] });
  const a = modKnopfAktion(p, 's1', rackModZiel(2), 'spur');
  assert.equal(a.art, 'neu'); assert.deepEqual(a.befehl, { befehl: 'mod_neu', ziele: [{ strang_id: 's1', ziel: 'rack.m2', tiefe: 0.25 }] });
  p = lauf(p, a.befehl); gueltig(p);
  assert.deepEqual(modKnopfAktion(p, 's1', rackModZiel(2), 'spur'), { art: 'zeige' });
  assert.equal(modKnopfZustand(p, 's1', rackModZiel(2)).aktiv, true);
  assert.equal(modKnopfZustand(p, 's1', rackModZiel(1)).aktiv, false);
});
