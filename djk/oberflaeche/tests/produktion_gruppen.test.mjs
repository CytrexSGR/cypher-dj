// 1.10 Slice 1: Seite, reine Teile der Gruppen und der Ausgang-Wahl (routing.js, gruppen.js); die DOM-Teile prüft pruef/probe_routing.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ausgangOptionen, ausgangWert, ausgangBefehl, gruppenLabels, mitglieder, neueGruppeBefehl } from '../oeffentlich/produktion/routing.js';
import { MAX_GRUPPEN } from '../oeffentlich/produktion/grenzen.js';

const g = (nr, id = `g${nr}`) => ({ id, nr, name: `Group ${nr}`, farbe: '#3b8de0', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false });

test('1.10 Seite: Ausgang-Wahl bietet Master und jede Gruppe nach Nummer; der Wert ist die Gruppen-ID oder master', () => {
  assert.deepEqual(ausgangOptionen({ gruppen: [] }), [{ wert: 'master', text: 'Master' }]);
  assert.deepEqual(ausgangOptionen(null), [{ wert: 'master', text: 'Master' }]);
  assert.deepEqual(ausgangOptionen({ gruppen: [g(3), g(1)] }).map((o) => o.wert), ['master', 'g1', 'g3']);
  assert.equal(ausgangWert({ id: 's1' }), 'master'); assert.equal(ausgangWert({ id: 's1', ausgang: { art: 'gruppe', id: 'g2' } }), 'g2');
  assert.equal(ausgangWert(undefined), 'master');
});

test('1.10 Seite: der Befehl der Ausgang-Wahl ist ziel_setzen mit master oder der Gruppe', () => {
  assert.deepEqual(ausgangBefehl('s2', 'master'), { befehl: 'ziel_setzen', strang_id: 's2', ausgang: 'master' });
  assert.deepEqual(ausgangBefehl('s2', 'g1'), { befehl: 'ziel_setzen', strang_id: 's2', ausgang: { art: 'gruppe', id: 'g1' } });
});

test('1.10 Seite: Mitglieder und der Knopf „+ GROUP“ (höchstens 8)', () => {
  const p = { gruppen: [g(1)], spuren: [{ id: 's1', ausgang: { art: 'gruppe', id: 'g1' } }, { id: 's2' }, { id: 's3', ausgang: { art: 'gruppe', id: 'g1' } }] };
  assert.deepEqual(mitglieder(p, 'g1').map((s) => s.id), ['s1', 's3']); assert.deepEqual(mitglieder(p, 'g2'), []);
  assert.deepEqual(neueGruppeBefehl(p), { befehl: 'gruppenspur_neu' });
  assert.equal(neueGruppeBefehl(null), null);
  assert.equal(neueGruppeBefehl({ gruppen: Array.from({ length: MAX_GRUPPEN }, (_, i) => g(i + 1)), spuren: [] }), null, 'acht Gruppen sind das Ende');
});

test('1.10 Seite: jedes Bedienelement einer Gruppe trägt ihren Namen im zugänglichen Namen (englisch)', () => {
  assert.deepEqual(gruppenLabels('Music'), { mute: 'Mute group Music', solo: 'Solo group Music', fader: 'Volume group Music', pan: 'Balance group Music',
    loeschen: 'Delete group Music', umbenennen: 'Rename group Music' });
});

test('1.10 Seite: jede data-p-Kennung, die gruppen.js abfragt, steht im Gerüst von produktion.js (Negativ-Kontrolle: eine erfundene nicht)', () => {
  const dom = fs.readFileSync(new URL('../oeffentlich/produktion/gruppen.js', import.meta.url), 'utf8');
  const geruest = fs.readFileSync(new URL('../oeffentlich/produktion/produktion.js', import.meta.url), 'utf8');
  const gefragt = [...dom.matchAll(/\$\('([a-z-]+)'\)/g)].map((m) => m[1]);
  assert.ok(gefragt.length >= 5, `gefunden: ${gefragt}`);
  for (const k of gefragt) assert.ok(geruest.includes(`data-p="${k}"`), `data-p="${k}" fehlt im Gerüst`);
  assert.ok(!geruest.includes('data-p="gibt-es-nicht"'));
});
