// 1.10 Slice 1: Mixer-Regler der Gruppen und des PM zwischen Projekt und Kern (Abgleich, Rückweg der Hand, Export-Regler, Einzel-Lautheit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { alleRegler, alleSpurRegler, reglerZuBefehl, istMixerRegler, istSpurRegler } from '../areas/proj/mapping.ts';
import { reglerAusProjekt } from '../project/render.ts';
import { reglerEinzeln } from '../areas/proj/output.ts';
import { fuehreAus } from '../project/commands.ts';
import { neuesProjekt, MAX_SPUREN, MAX_GRUPPEN } from '../project/model.ts';

const aufbau = () => {
  let p = neuesProjekt('T');
  for (let i = 0; i < 3; i++) p = fuehreAus(p, { befehl: 'spur_neu', art: 'audio' }).projekt;
  p = fuehreAus(p, { befehl: 'gruppenspur_neu', name: 'Music', mitglieder: ['s2', 's3'] }).projekt;
  p = fuehreAus(p, { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -6, pan: 0.5, mute: false, solo: true }).projekt;
  return fuehreAus(p, { befehl: 'master_aendern', fader_db: -1.5 }).projekt;
};

test('alleRegler: alle 4·32 Spur-Regler, alle 4·16 Gruppen-Regler (freie Slots mit Vorgabe) und pm/fader', () => {
  const p = aufbau(), r = alleRegler(p);
  assert.equal(r.length, 4 * MAX_SPUREN + 4 * MAX_GRUPPEN + 1 + 236 + 1178 + 48, 'slice 3: + 4 · (32 + 16) sends and 4 · 11 return controls; slice 4a/4b: + 1178 insert rows (520 of them bk, arr-bk) (12 · 10 komp, 8 · 59 eq, 4 · 4 saett, 2 · 3 lim, 4 host, 8 · 5 utility); slice 4c: + 48 rack rows');
  const wert = (pfad) => r.find((x) => x.pfad === pfad)?.wert;
  assert.deepEqual([wert('grp/1/fader'), wert('grp/1/pan'), wert('grp/1/mute'), wert('grp/1/solo')], [-6, 0.5, 0, 1]);
  assert.deepEqual([wert('grp/2/fader'), wert('grp/8/solo')], [0, 0], 'freie Slots stehen auf der Vorgabe');
  assert.equal(wert('pm/fader'), -1.5);
  assert.equal(alleSpurRegler(p).length, 4 * MAX_SPUREN, 'alleSpurRegler bleibt, wie es war');
  assert.equal(new Set(r.map((x) => x.pfad)).size, r.length);
  assert.equal(alleRegler(neuesProjekt('N')).find((x) => x.pfad === 'pm/fader').wert, 0);
});

test('Rückweg der Hand: grp/<n>/* und pm/fader werden zu Befehlen, Werte schon da und fremde Pfade zu null', () => {
  const p = aufbau();
  assert.deepEqual(reglerZuBefehl(p, 'grp/1/fader', -3), { befehl: { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -3 }, label: 'Mixer: Music fader' });
  assert.deepEqual(reglerZuBefehl(p, 'grp/1/mute', 1).befehl, { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', mute: true });
  assert.deepEqual(reglerZuBefehl(p, 'grp/1/pan', 7).befehl, { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', pan: 1 }, 'geklemmt');
  assert.deepEqual(reglerZuBefehl(p, 'pm/fader', 0), { befehl: { befehl: 'master_aendern', fader_db: 0 }, label: 'Mixer: Master fader' });
  assert.equal(reglerZuBefehl(p, 'grp/1/fader', -6), null, 'Wert schon da');
  assert.equal(reglerZuBefehl(p, 'pm/fader', -1.5), null);
  assert.equal(reglerZuBefehl(p, 'grp/5/fader', -3), null, 'keine Gruppe auf Platz 5');
  assert.equal(reglerZuBefehl(p, 'grp/17/fader', -3), null);
  assert.equal(reglerZuBefehl(p, 'pm/pan', 0), null);
  assert.equal(reglerZuBefehl(p, 'pm/fader', Number.NaN), null);
  assert.ok(reglerZuBefehl(p, 'spur/2/fader', -3), 'Spur-Regler wie bisher');
  for (const x of ['spur/1/fader', 'grp/8/solo', 'pm/fader']) assert.ok(istMixerRegler(x), x);
  for (const x of ['grp/17/fader', 'grp/1/send/5', 'pm/pan', 'erz/4/fader']) assert.ok(!istMixerRegler(x), x);   // grp/1/send/1 is a mixer control since slice 3
  assert.ok(istSpurRegler('spur/3/pan') && !istSpurRegler('grp/1/pan'));
});

test('Export-Regler: neutrale Projekte liefern dieselbe Datei wie vorher; Gruppen und PM erscheinen, sobald es sie gibt', () => {
  const neutral = neuesProjekt('N');
  const mit = fuehreAus(neutral, { befehl: 'spur_neu', art: 'audio' }).projekt;
  assert.deepEqual(Object.keys(reglerAusProjekt(mit)).sort(), ['spur/1/fader', 'spur/1/mute', 'spur/1/pan', 'spur/1/solo']);
  const p = aufbau(), r = reglerAusProjekt(p);
  assert.deepEqual([r['grp/1/fader'], r['grp/1/pan'], r['grp/1/mute'], r['grp/1/solo'], r['pm/fader']], [-6, 0.5, 0, 1, -1.5]);
  assert.ok(!('grp/2/fader' in r));
});

test('Einzel-Lautheit: die Ziel-Kette der Spur (Gruppe, PM) kommt mit; ohne Gruppe bleibt die Datei wie vorher', () => {
  const p = aufbau();
  const s1 = reglerEinzeln(p.spuren[0], p), s2 = reglerEinzeln(p.spuren[1], p);
  assert.ok(!Object.keys(s1).some((k) => k.startsWith('grp/')), 'Spur 1 ist nicht in der Gruppe');
  assert.equal(s1['pm/fader'], -1.5);
  assert.deepEqual([s2['grp/1/fader'], s2['grp/1/pan'], s2['grp/1/mute']], [-6, 0.5, 0]);
  assert.deepEqual(reglerEinzeln(p.spuren[0]), reglerEinzeln(p.spuren[0], neuesProjekt('N')), 'ohne Gruppen und mit PM 0 dB unverändert');
  assert.equal(s2['spur/3/mute'], 1, 'alle anderen Spuren stumm wie bisher');
});

// ---- 1.10 slice 3: sends, returns and Hall values between project and core ------------------------------------------------------------------
import { alleSendRegler, alleRetRegler } from '../areas/proj/mapping.ts';
import { routingRegler } from '../project/render.ts';

const mitReturns = () => {
  let p = aufbau();
  p = fuehreAus(p, { befehl: 'return_neu', name: 'Hall' }).projekt;
  p = fuehreAus(p, { befehl: 'return_neu', name: 'Plate', hall: { decay: 0.8 } }).projekt;
  p = fuehreAus(p, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }).projekt;
  p = fuehreAus(p, { befehl: 'send_setzen', strang_id: 's2', return_id: 'r2', db: -12 }).projekt;
  p = fuehreAus(p, { befehl: 'send_setzen', strang_id: 'g1', return_id: 'r2', db: -3 }).projekt;
  return fuehreAus(p, { befehl: 'return_aendern', return_id: 'r2', fader_db: -4, mute: true }).projekt;
};

test('slice 3 alleRegler: 161 old + 204 new + 1178 insert rows + 48 rack rows = 1655 paths (1591 before nested groups task 1: + 64 for groups 9..16) (160 sends, 4 · 11 return controls), free slots with the defaults, no duplicates', () => {
  const p = mitReturns(), r = alleRegler(p);
  assert.equal(r.length, 161 + 204 + 64 + 1178 + 48);
  assert.equal(alleSendRegler(p).length, 4 * (MAX_SPUREN + MAX_GRUPPEN));
  assert.equal(alleRetRegler(p).length, 4 * 11);
  assert.equal(new Set(r.map((x) => x.pfad)).size, r.length);
  const wert = (pfad) => r.find((x) => x.pfad === pfad)?.wert;
  assert.deepEqual([wert('spur/1/send/1'), wert('spur/2/send/2'), wert('grp/1/send/2'), wert('spur/1/send/2'), wert('spur/32/send/4')], [-6, -12, -3, -200, -200]);
  assert.deepEqual([wert('ret/1/fader'), wert('ret/2/fader'), wert('ret/2/mute'), wert('ret/2/hall/decay'), wert('ret/1/hall/decay')], [0, -4, 1, 0.8, 0.5252]);
  assert.deepEqual([wert('ret/3/fader'), wert('ret/3/hall/an'), wert('ret/3/hall/fahne'), wert('ret/4/hall/highcut')], [0, 1, 0.66667, 0.8039], 'free slots: the stellwerk defaults');
  assert.equal(alleRegler(neuesProjekt('N')).length, 429 + 1178 + 48, 'a project without returns still sets all of them (the defaults)');
});

test('slice 3 hand path: send and return controls become commands, the label names track and return; same value and foreign paths give null', () => {
  const p = mitReturns();
  assert.deepEqual(reglerZuBefehl(p, 'spur/1/send/1', -9), { befehl: { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -9 }, label: 'Mixer: Audio 1 send Hall' });
  assert.deepEqual(reglerZuBefehl(p, 'grp/1/send/2', 0).befehl, { befehl: 'send_setzen', strang_id: 'g1', return_id: 'r2', db: 0 });
  assert.equal(reglerZuBefehl(p, 'spur/3/send/1', -205), null, 'clamped to -200 = absent');
  assert.equal(reglerZuBefehl(p, 'spur/1/send/1', -6), null, 'value already there');
  assert.equal(reglerZuBefehl(p, 'spur/3/send/1', -200), null, 'absent equals -200');
  assert.equal(reglerZuBefehl(p, 'spur/1/send/3', -6), null, 'no return 3');
  assert.equal(reglerZuBefehl(p, 'spur/9/send/1', -6), null, 'no track 9');
  assert.equal(reglerZuBefehl(p, 'ret/5/fader', -6), null);
  assert.deepEqual(reglerZuBefehl(p, 'ret/1/fader', -3), { befehl: { befehl: 'return_aendern', return_id: 'r1', fader_db: -3 }, label: 'Mixer: Hall fader' });
  assert.deepEqual(reglerZuBefehl(p, 'ret/1/mute', 1).befehl, { befehl: 'return_aendern', return_id: 'r1', mute: true });
  assert.deepEqual(reglerZuBefehl(p, 'ret/1/hall/decay', 0.9), { befehl: { befehl: 'return_aendern', return_id: 'r1', hall: { decay: 0.9 } }, label: 'Mixer: Hall hall decay' });
  assert.deepEqual(reglerZuBefehl(p, 'ret/1/hall/an', 0).befehl, { befehl: 'return_aendern', return_id: 'r1', hall: { an: false } });
  assert.deepEqual(reglerZuBefehl(p, 'ret/1/hall/decay', 7).befehl.hall, { decay: 1 }, 'clamped');
  assert.equal(reglerZuBefehl(p, 'ret/2/hall/decay', 0.8), null, 'value already there');
  assert.equal(reglerZuBefehl(p, 'ret/1/hall/mix', 0.5), null);
  assert.equal(reglerZuBefehl(p, 'ret/3/fader', -3), null, 'no return 3');
  for (const x of ['spur/1/send/1', 'grp/8/send/4', 'ret/1/fader', 'ret/4/hall/fahne', 'ret/2/hall/an']) assert.ok(istMixerRegler(x), x);
  for (const x of ['spur/1/send/5', 'grp/17/send/1', 'ret/5/fader', 'ret/1/hall/mix', 'ret/1/hall', 'ret/1/send/1']) assert.ok(!istMixerRegler(x), x);
});

test('slice 3 export controls: sends only for existing returns, every existing return complete; no returns means the file is as before', () => {
  const neutral = fuehreAus(neuesProjekt('N'), { befehl: 'spur_neu', art: 'audio' }).projekt;
  assert.deepEqual(routingRegler(neutral), {});
  assert.deepEqual(Object.keys(reglerAusProjekt(neutral)).sort(), ['spur/1/fader', 'spur/1/mute', 'spur/1/pan', 'spur/1/solo']);
  const p = mitReturns(), r = routingRegler(p);
  assert.deepEqual([r['spur/1/send/1'], r['spur/2/send/2'], r['grp/1/send/2']], [-6, -12, -3]);
  assert.ok(!('spur/3/send/1' in r), 'a track without a send writes none');
  assert.equal(Object.keys(r).filter((k) => k.startsWith('ret/1/')).length, 11, 'return 1 complete: fader, pan, mute, solo, hall/an and six Hall values');
  assert.equal(Object.keys(r).filter((k) => k.startsWith('ret/2/')).length, 11);
  assert.ok(!Object.keys(r).some((k) => k.startsWith('ret/3/')), 'no return 3');
  assert.deepEqual([r['ret/2/fader'], r['ret/2/mute'], r['ret/2/hall/decay']], [-4, 1, 0.8]);
  const ganz = reglerAusProjekt(p);
  assert.equal(ganz['ret/2/hall/decay'], 0.8); assert.equal(ganz['spur/1/send/1'], -6);
});

test('slice 3 single-track render: the track, its group, their sends and only the returns they feed (spec 5.10); returns unfed stay out', () => {
  const p = mitReturns();
  const e1 = reglerEinzeln(p.spuren[0], p);                  // s1: sends to r1, not in a group
  assert.equal(e1['spur/1/send/1'], -6);
  assert.ok(!Object.keys(e1).some((k) => k.startsWith('ret/2/')), 'return 2 is not fed by s1');
  assert.equal(e1['ret/1/fader'], 0); assert.equal(e1['ret/1/solo'], 0);
  const e2 = reglerEinzeln(p.spuren[1], p);                  // s2: send to r2, in group g1 which sends to r2
  assert.deepEqual([e2['spur/2/send/2'], e2['grp/1/send/2'], e2['ret/2/fader'], e2['ret/2/mute']], [-12, -3, -4, 1]);
  assert.ok(!Object.keys(e2).some((k) => k.startsWith('ret/1/')));
  const p4 = fuehreAus(p, { befehl: 'spur_neu', art: 'audio' }).projekt;
  const e3 = reglerEinzeln(p4.spuren[3], p4);                // s4: no group, no sends
  assert.ok(!Object.keys(e3).some((k) => k.includes('/send/') || k.startsWith('ret/')), 'negative control: nothing from the routing');
  assert.equal(e1['spur/2/mute'], 1, 'the other tracks stay muted');
  const soloRet = fuehreAus(p, { befehl: 'return_aendern', return_id: 'r1', solo: true }).projekt;
  assert.equal(reglerEinzeln(soloRet.spuren[0], soloRet)['ret/1/solo'], 0, 'a return solo of the project does not silence the isolated track');
  assert.equal(routingRegler(soloRet)['ret/1/solo'], 1, 'but the summary render keeps it');
});
