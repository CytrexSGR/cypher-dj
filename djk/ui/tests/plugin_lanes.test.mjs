// Strand 2 slice 1 task 1.1: automation lanes on plugin parameters of a host stage (`plugin.<stage id>.<index>`, value 0..1).
// Pure calculation: no server, no core, no host. The lanes are project data only; the translator never sends them to the core (a server-side player does).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import {
  pruefeProjekt, kanonisch, alleInserts, istPluginZiel, pluginZielVon, zielBereichVon, MAX_PLUGIN_LANEN, PLUGIN_BEREICH, istKettenZiel,
} from '../project/model.ts';
import { uebersetze } from '../project/playback.ts';
import { wende } from '../project/patch.ts';
import { GRUND_TEXT } from '../http/reasons.ts';
import { grundCode } from '../areas/proj/mapping.ts';
import { basisProjekt } from './support/inserts_scenario.mjs';
import { ohneAbgeleitetes } from './support/project.mjs';

const PLUGIN = { format: 'vst3', pfad: '/opt/plugins/Fake EQ.vst3', uid: 'ABCDEF0123456789ABCDEF0123456789' };
const ok = (p, b) => fuehreAus(p, b);
const lehntAb = (p, b, grund) => assert.throws(() => fuehreListeAus(p, Array.isArray(b) ? b : [b]),
  (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund} for ${JSON.stringify(b).slice(0, 120)}`);
const pruefe = (p, r) => {
  assert.equal(pruefeProjekt(r.projekt).fehler, undefined, JSON.stringify(pruefeProjekt(r.projekt)));
  assert.equal(ohneAbgeleitetes(wende(p, r.vor)), ohneAbgeleitetes(r.projekt));
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p));
};
const host = (p, strang, extra = {}) => ok(p, { befehl: 'insert_setzen', strang_id: strang, pos: 0, art: 'host', plugin: PLUGIN, ...extra }).projekt;
const hostId = (p, strang) => alleInserts(p).find((x) => x.insert.art === 'host' && x.strangId === strang)?.insert.id
  ?? alleInserts(p).filter((x) => x.insert.art === 'host').at(-1).insert.id;
const strangVon = (p, id) => (id === 'master' ? p.master
  : p.spuren.find((s) => s.id === id) ?? (p.gruppen ?? []).find((g) => g.id === id) ?? (p.returns ?? []).find((r) => r.id === id));
const W = (p) => uebersetze(p, { nr: 1, audioOrdner: '/x', frames: () => 96000 });
const mitHost = () => { const p = host(basisProjekt(), 's1'); return { p, id: alleInserts(p).find((x) => x.insert.art === 'host').insert.id }; };

test('target syntax: plugin.<id>.<index>, index without leading zeros, at most five digits; no chain target', () => {
  for (const z of ['plugin.i1.0', 'plugin.i1.3', 'plugin.a-b_c.99999']) assert.ok(istPluginZiel(z), z);
  for (const z of ['plugin.i1.03', 'plugin.i1.-1', 'plugin.i1.100000', 'plugin.1i.3', 'plugin.i1', 'plugin.i1.3.4', 'insert.i1.3', 3, null]) {
    assert.equal(istPluginZiel(z), false, String(z));
  }
  assert.deepEqual(pluginZielVon('plugin.i7.12'), { insert: 'i7', index: 12 });
  assert.equal(pluginZielVon('insert.i7.schwelle'), null);
  assert.equal(istKettenZiel('plugin.i1.3'), false, 'the translator and the 64 chain lane count never see a plugin lane');
  assert.equal(MAX_PLUGIN_LANEN, 16);
  assert.deepEqual(PLUGIN_BEREICH, { min: 0, max: 1, nurSprung: false });
});

test('auto_neu plugin.<host>.3 on the strip of the host stage: starts at 0.5, valid, patches round-trip; the range lookup', () => {
  const { p, id } = mitHost();
  const r = ok(p, { befehl: 'auto_neu', strang_id: 's1', ziel: `plugin.${id}.3` });
  pruefe(p, r);
  const l = r.projekt.spuren[0].automation[0];
  assert.equal(l.ziel, `plugin.${id}.3`);
  assert.deepEqual(l.punkte.map((q) => q.wert), [0.5, 0.5]);
  assert.deepEqual(zielBereichVon(`plugin.${id}.3`, r.projekt.spuren[0]), PLUGIN_BEREICH);
  assert.equal(zielBereichVon(`plugin.${id}.3`, r.projekt.spuren[1]), null, 'not on another strip');
  assert.equal(zielBereichVon(`plugin.${id}.3`), null, 'not without a strip');
  // spur_id works the same way for a track
  const r2 = ok(p, { befehl: 'auto_neu', spur_id: 's1', ziel: `plugin.${id}.0`, punkte: [{ beat: 0, wert: 0 }, { beat: 4, wert: 1 }] });
  pruefe(p, r2);
  assert.deepEqual(r2.projekt.spuren[0].automation[0].punkte.map((q) => q.wert), [0, 1]);
});

test('value range 0..1 is enforced in auto_neu, auto_punkte and the model', () => {
  const { p, id } = mitHost();
  const z = `plugin.${id}.3`;
  lehntAb(p, { befehl: 'auto_neu', strang_id: 's1', ziel: z, punkte: [{ beat: 0, wert: 1.2 }] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'auto_neu', strang_id: 's1', ziel: z, punkte: [{ beat: 0, wert: -0.1 }] }, 'argument_ungueltig');
  const r = ok(p, { befehl: 'auto_neu', strang_id: 's1', ziel: z });
  const lid = r.projekt.spuren[0].automation[0].id;
  lehntAb(r.projekt, { befehl: 'auto_punkte', lane_id: lid, setze: [{ beat: 2, wert: 1.2 }] }, 'argument_ungueltig');
  const r2 = ok(r.projekt, { befehl: 'auto_punkte', lane_id: lid, setze: [{ beat: 2, wert: 1 }] });
  pruefe(r.projekt, r2);
  const kaputt = structuredClone(r2.projekt);
  kaputt.spuren[0].automation[0].punkte[0].wert = 1.5;
  assert.ok(pruefeProjekt(kaputt).fehler, 'the model refuses 1.5');
});

test('refusals: missing stage, native stage, other strip are ziel_unbekannt; a second lane is lane_doppelt; the 17th is plugin_lanen_voll', () => {
  const { p, id } = mitHost();
  lehntAb(p, { befehl: 'auto_neu', strang_id: 's1', ziel: 'plugin.i99.3' }, 'ziel_unbekannt');
  lehntAb(p, { befehl: 'auto_neu', strang_id: 's2', ziel: `plugin.${id}.3` }, 'ziel_unbekannt');
  const komp = ok(p, { befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'komp' }).projekt;
  const kid = alleInserts(komp).find((x) => x.insert.art === 'komp').insert.id;
  lehntAb(komp, { befehl: 'auto_neu', strang_id: 's2', ziel: `plugin.${kid}.0` }, 'ziel_unbekannt');
  let q = p;
  for (let i = 0; i < MAX_PLUGIN_LANEN; i++) q = ok(q, { befehl: 'auto_neu', strang_id: 's1', ziel: `plugin.${id}.${i}` }).projekt;
  assert.equal(pruefeProjekt(q).fehler, undefined);
  // plugin lanes do not count against the strip's 12 core lanes: a fader lane still fits
  pruefe(q, ok(q, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' }));
  lehntAb(q, { befehl: 'auto_neu', strang_id: 's1', ziel: `plugin.${id}.5` }, 'lane_doppelt');
  lehntAb(q, { befehl: 'auto_neu', strang_id: 's1', ziel: `plugin.${id}.16` }, 'plugin_lanen_voll');
  assert.equal(grundCode('plugin_lanen_voll'), 409);
  assert.match(GRUND_TEXT.plugin_lanen_voll, /16/);
  // the model refuses a 17th lane as well
  const zuViel = structuredClone(q);
  zuViel.spuren[0].automation.push({ id: 'lane99', ziel: `plugin.${id}.16`, punkte: [{ beat: 0, wert: 0.5 }] });
  assert.match(pruefeProjekt(zuViel).fehler ?? '', /16/);
  // a second host stage on the same strip has its own 16
  const zwei = ok(q, { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'host', plugin: PLUGIN }).projekt;
  const id2 = alleInserts(zwei).filter((x) => x.insert.art === 'host').map((x) => x.insert.id).find((x) => x !== id);
  pruefe(zwei, ok(zwei, { befehl: 'auto_neu', strang_id: 's1', ziel: `plugin.${id2}.0` }));
});

test('the model refuses a plugin lane whose stage is missing or not a host stage, and accepts one of a host stage on the same strip', () => {
  const { p, id } = mitHost();
  const r = ok(p, { befehl: 'auto_neu', strang_id: 's1', ziel: `plugin.${id}.3` }).projekt;
  assert.equal(pruefeProjekt(JSON.parse(kanonisch(r))).fehler, undefined);
  const fehlt = structuredClone(r);
  fehlt.spuren[0].automation[0].ziel = 'plugin.i99.3';
  assert.match(pruefeProjekt(fehlt).fehler ?? '', /automation/);
  const fremd = structuredClone(r);
  fremd.spuren[1].automation = fremd.spuren[0].automation; delete fremd.spuren[0].automation;
  assert.match(pruefeProjekt(fremd).fehler ?? '', /automation/);
});

test('plugin lanes on a group, a return and the master; the editors keep 0..1 and simplify with the chain tolerance', () => {
  let p = basisProjekt();
  p = ok(p, { befehl: 'gruppenspur_neu', mitglieder: ['s2', 's3'] }).projekt;
  p = ok(p, { befehl: 'return_neu' }).projekt;
  for (const st of ['g1', 'r1', 'master']) {
    p = host(p, st);
    const sid = alleInserts(p).find((x) => x.insert.art === 'host' && strangVon(p, st).inserts?.includes(x.insert)).insert.id;
    const r = ok(p, { befehl: 'auto_neu', strang_id: st, ziel: `plugin.${sid}.1` });
    pruefe(p, r);
    p = r.projekt;
  }
  const l = p.master.automation[0];
  const f = ok(p, { befehl: 'auto_form', lane_id: l.id, von_beat: 0, bis_beat: 8, form: 'sinus' });
  pruefe(p, f);
  const werte = f.projekt.master.automation[0].punkte.map((q) => q.wert);
  assert.ok(Math.min(...werte) >= 0 && Math.max(...werte) <= 1 && Math.max(...werte) - Math.min(...werte) > 0.9, 'a shape spans 0..1');
  // simplify: a point 0.003 off the line goes (chain tolerance 0.004 of the range), one 0.01 off stays
  const lid = l.id;
  const set = (wert) => ok(p, { befehl: 'auto_punkte', lane_id: lid, loesche_von: 0,
    setze: [{ beat: 0, wert: 0.2 }, { beat: 2, wert }, { beat: 4, wert: 0.6 }] }).projekt;
  const nach = (q) => ok(q, { befehl: 'auto_vereinfachen', lane_id: lid, von_beat: 0, bis_beat: 4 }).projekt.master.automation[0].punkte.length;
  assert.equal(nach(set(0.403)), 2);
  assert.equal(nach(set(0.41)), 3);
});

test('insert_entfernen and replacing the host stage drop the plugin lanes of that stage; other lanes stay', () => {
  const { p, id } = mitHost();
  let q = ok(p, { befehl: 'auto_neu', strang_id: 's1', ziel: `plugin.${id}.3` }).projekt;
  q = ok(q, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' }).projekt;
  const weg = ok(q, { befehl: 'insert_entfernen', insert_id: id });
  pruefe(q, weg);
  assert.deepEqual(weg.projekt.spuren[0].automation.map((l) => l.ziel), ['fader']);
  // replaced by another plugin (insert_setzen ersetzen on the same position): other plugin, other indices
  const ersetzt = ok(q, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'host', ersetzen: true,
    plugin: { ...PLUGIN, pfad: '/opt/plugins/Other.vst3' } });
  pruefe(q, ersetzt);
  assert.deepEqual(ersetzt.projekt.spuren[0].automation.map((l) => l.ziel), ['fader']);
  // replaced by a native stage
  const nativ = ok(q, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', ersetzen: true });
  pruefe(q, nativ);
  assert.deepEqual(nativ.projekt.spuren[0].automation.map((l) => l.ziel), ['fader']);
  // only lane: the list goes
  const allein = ok(p, { befehl: 'auto_neu', strang_id: 's1', ziel: `plugin.${id}.3` }).projekt;
  assert.equal(ok(allein, { befehl: 'insert_entfernen', insert_id: id }).projekt.spuren[0].automation, undefined);
  // inserting another stage in front keeps the lane (the id stays)
  const davor = ok(allein, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' });
  pruefe(allein, davor);
  assert.deepEqual(davor.projekt.spuren[0].automation.map((l) => l.ziel), [`plugin.${id}.3`]);
});

test('the playback carries no plugin lane: no chain_auto, no auto entry, on a track, group, return and master', () => {
  let p = basisProjekt();
  p = ok(p, { befehl: 'gruppenspur_neu', mitglieder: ['s2', 's3'] }).projekt;
  p = ok(p, { befehl: 'return_neu' }).projekt;
  const ohne = [];
  for (const st of ['s1', 'g1', 'r1', 'master']) p = host(p, st);
  ohne.push(JSON.stringify(W(p)));
  for (const st of ['s1', 'g1', 'r1', 'master']) {
    const sid = alleInserts(p).find((x) => x.insert.art === 'host' && strangVon(p, st).inserts?.includes(x.insert)).insert.id;
    p = ok(p, { befehl: 'auto_neu', strang_id: st, ziel: `plugin.${sid}.2`, punkte: [{ beat: 0, wert: 0 }, { beat: 4, wert: 1 }] }).projekt;
  }
  const w = JSON.stringify(W(p));
  assert.ok(!w.includes('plugin.'), 'no plugin target in the playback');
  assert.ok(!w.includes('chain_auto'), 'no chain_auto entry');
  const o = JSON.parse(ohne[0]), m = JSON.parse(w);
  delete o.nr; delete m.nr;
  assert.deepEqual(m, o, 'the playback is the one without the lanes');
  // negative control: a fader lane on s1 does show up
  const f = ok(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' }).projekt;
  assert.ok(JSON.stringify(W(f)).includes('"auto"'));
});

test('save/load round trip keeps the lane byte for byte', () => {
  const { p, id } = mitHost();
  const punkte = [{ beat: 0, wert: 0.25 }, { beat: 8, wert: 0.75, form: 's' }];
  const q = ok(p, { befehl: 'auto_neu', strang_id: 's1', ziel: `plugin.${id}.7`, punkte }).projekt;
  const text = kanonisch(q);
  const geladen = pruefeProjekt(JSON.parse(text));
  assert.equal(geladen.fehler, undefined);
  assert.equal(kanonisch(geladen.projekt), text);
  assert.deepEqual(geladen.projekt.spuren[0].automation[0].ziel, `plugin.${id}.7`);
});
