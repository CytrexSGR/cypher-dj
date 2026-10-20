// D1 S2-Integration, vierte Fix-Runde J2 (Spec 6.35 zu 2.12 und 6.21, Nebenbefund N7 aus REVIEW-3-opus m6): Ein Kern-Neustart während des
// KI-Stopps lässt die gestoppten Spuren stumm. nachNeustart setzte alle 32 Spur-Regler aus dem Projekt mit Quelle andreas, ohne die Ausnahme,
// die der Wiederanlauf (6.21) für den Fader von Cyphers Spuren macht: der Kern stellt Stopp und −200 aus seinem Zustand wieder her, der Server
// hob die Fader danach auf den Projektwert, Cyphers Spuren waren im Stopp laut.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neustart, warteBis } from './hilfen/proj_kontext.mjs';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, ruf, CYPHER, warte } from './hilfen/proj_stapel.mjs';

// Projekt "wa": s1 von andreas (Slot 1), s2 von cypher (Slot 2), beide Fader 0 dB
async function offenUndNeustart(t, gestoppt) {
  const { z } = neustart(t);
  await z.s.oeffnen('wa', 'andreas');
  z.k.ki = gestoppt;
  z.k.leere();
  z.s.ereignis('/e/neustart', { generation: 2 });
  assert.ok(await warteBis(() => z.k.an('/k/arr/loop').length > 0, 1000), 'nachNeustart ist durch');
  await new Promise((r) => setTimeout(r, 20));
  return z;
}

test('J2 Kern-Neustart im KI-Stopp: der Fader von Cyphers Spur wird nicht gesetzt, alles andere schon', async (t) => {
  const z = await offenUndNeustart(t, true);
  const teile = z.k.teile(/^spur\//).map((x) => x.felder.pfad);
  console.log(`J2 stopp ${JSON.stringify({ zahl: teile.length, spur2: teile.filter((p) => p.startsWith('spur/2/')) })}`);
  assert.ok(!teile.includes('spur/2/fader'), 'spur/2 gehört cypher: ihr Fader bleibt bei der Absenkung des Kerns');
  assert.equal(teile.length, 31);
  for (const p of ['spur/1/fader', 'spur/2/pan', 'spur/2/mute', 'spur/2/solo', 'spur/3/fader']) assert.ok(teile.includes(p), p);
});

test('J2 Negativ-Kontrolle ohne Stopp: alle 32 Spur-Regler werden gesetzt', async (t) => {
  const z = await offenUndNeustart(t, false);
  const teile = z.k.teile(/^spur\//).map((x) => x.felder.pfad);
  assert.equal(teile.length, 32);
  assert.ok(teile.includes('spur/2/fader'));
});

// Am Stapel: echter KI-Stopp in der Kern-Attrappe, die Ausblende läuft ab, dann /e/neustart. Gemessen wird der Fader in der Attrappe.
test('J2 Stapel: KI-Stopp, Ausblende, /e/neustart → Cyphers Spur bleibt in der Attrappe stumm, Andreas\' Spur bleibt offen', async (t) => {
  const { o, url } = await stapel(t);
  await ruf(url, 'POST', '/proj/neu', { name: 'Stumm' });
  let r = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Meine', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, CYPHER);
  r = await ruf(url, 'POST', '/proj/aendern', { rev: r.j.rev, label: 'Andreas', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
  assert.equal(r.code, 200);
  const wert = (pfad) => innen(o).stand.regler[pfad];
  assert.ok(await bis(() => wert('spur/1/fader') === 0 && wert('spur/2/fader') === 0), 'beide Fader offen');
  const ctx = o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => wert('spur/1/fader') === -200, 4000), 'die Ausblende des Stopps ist durch');
  const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  innen(o).vomKern('/e/neustart', { generation: 4242, sample: 0 });
  await warte(Math.max(500, 2 * 60000 / bpm));
  const nach = { cypher: wert('spur/1/fader'), andreas: wert('spur/2/fader') };
  console.log(`J2 stapel ${JSON.stringify(nach)}`);
  assert.deepEqual(nach, { cypher: -200, andreas: 0 });
});
