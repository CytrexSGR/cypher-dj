// 1.10 Slice 1: Mixer-Regler der Gruppen und des PM zwischen Projekt und Kern (Abgleich, Rückweg der Hand, Export-Regler, Einzel-Lautheit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { alleRegler, alleSpurRegler, reglerZuBefehl, istMixerRegler, istSpurRegler } from '../bereiche/proj/abbildung.ts';
import { reglerAusProjekt } from '../projekt/render.ts';
import { reglerEinzeln } from '../bereiche/proj/ausgabe.ts';
import { fuehreAus } from '../projekt/befehle.ts';
import { neuesProjekt, MAX_SPUREN, MAX_GRUPPEN } from '../projekt/modell.ts';

const aufbau = () => {
  let p = neuesProjekt('T');
  for (let i = 0; i < 3; i++) p = fuehreAus(p, { befehl: 'spur_neu', art: 'audio' }).projekt;
  p = fuehreAus(p, { befehl: 'gruppenspur_neu', name: 'Music', mitglieder: ['s2', 's3'] }).projekt;
  p = fuehreAus(p, { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -6, pan: 0.5, mute: false, solo: true }).projekt;
  return fuehreAus(p, { befehl: 'master_aendern', fader_db: -1.5 }).projekt;
};

test('alleRegler: alle 4·32 Spur-Regler, alle 4·8 Gruppen-Regler (freie Slots mit Vorgabe) und pm/fader', () => {
  const p = aufbau(), r = alleRegler(p);
  assert.equal(r.length, 4 * MAX_SPUREN + 4 * MAX_GRUPPEN + 1);
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
  assert.equal(reglerZuBefehl(p, 'grp/9/fader', -3), null);
  assert.equal(reglerZuBefehl(p, 'pm/pan', 0), null);
  assert.equal(reglerZuBefehl(p, 'pm/fader', Number.NaN), null);
  assert.ok(reglerZuBefehl(p, 'spur/2/fader', -3), 'Spur-Regler wie bisher');
  for (const x of ['spur/1/fader', 'grp/8/solo', 'pm/fader']) assert.ok(istMixerRegler(x), x);
  for (const x of ['grp/9/fader', 'grp/1/send/1', 'pm/pan', 'erz/4/fader']) assert.ok(!istMixerRegler(x), x);
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
