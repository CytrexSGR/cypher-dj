// D1 S2-Integration, vierte Fix-Runde J2 (Spec 6.35), umgeschrieben nach Entscheidung E-a (2026-10-20): ein Kern-Neustart während des KI-Stopps
// setzt alle Spur-Regler aus dem Projekt, auch den Fader von Cyphers Spuren. Vorher blieb dieser Fader bei der Absenkung des Kerns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SPUREN } from '../projekt/modell.ts';
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

test('J2 Kern-Neustart im KI-Stopp (E-a): alle Spur-Regler (4 · MAX_SPUREN) werden gesetzt, auch der Fader von Cyphers Spur', async (t) => {
  const z = await offenUndNeustart(t, true);
  const teile = z.k.teile(/^spur\//).map((x) => x.felder.pfad);
  assert.equal(teile.length, 4 * MAX_SPUREN);
  for (const p of ['spur/1/fader', 'spur/2/fader', 'spur/2/pan', 'spur/2/mute', 'spur/2/solo', 'spur/3/fader']) assert.ok(teile.includes(p), p);
});

test('J2 Negativ-Kontrolle ohne Stopp: alle Spur-Regler (4 · MAX_SPUREN) werden gesetzt', async (t) => {
  const z = await offenUndNeustart(t, false);
  const teile = z.k.teile(/^spur\//).map((x) => x.felder.pfad);
  assert.equal(teile.length, 4 * MAX_SPUREN);
  assert.ok(teile.includes('spur/2/fader'));
});

// Am Stapel: echter KI-Stopp in der Kern-Attrappe, dann /e/neustart. Gemessen wird der Fader in der Attrappe: beide Spuren bleiben offen.
test('J2 Stapel (E-a): KI-Stopp, /e/neustart → Cyphers Spur und Andreas\' Spur bleiben in der Attrappe offen', async (t) => {
  const { o, url } = await stapel(t);
  await ruf(url, 'POST', '/proj/neu', { name: 'Offen' });
  let r = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Meine', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, CYPHER);
  r = await ruf(url, 'POST', '/proj/aendern', { rev: r.j.rev, label: 'Andreas', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
  assert.equal(r.code, 200);
  const wert = (pfad) => innen(o).stand.regler[pfad];
  assert.ok(await bis(() => wert('spur/1/fader') === 0 && wert('spur/2/fader') === 0), 'beide Fader offen');
  const ctx = o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => innen(o).kiGestoppt), 'der Stopp gilt');
  // beide Fader im Kern verstellen: nur ein Setzen durch nachNeustart bringt sie auf 0 zurück (auch Cyphers Spur, kein Ausnahmefall)
  for (const pfad of ['spur/1/fader', 'spur/2/fader']) {
    await ctx.warteQuittung(ctx.sende('/k/teil', { quelle: 'andreas', plan: '', teil: 0, pfad, ab_beat: 0, dauer_beats: 0, nach: -30, form: 0, politik: 1, gruppe: '', hoerschein: '' }));
  }
  assert.ok(await bis(() => wert('spur/1/fader') === -30 && wert('spur/2/fader') === -30), 'Vorbedingung: beide verstellt');
  const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  innen(o).vomKern('/e/neustart', { generation: 4242, sample: 0 });
  await warte(Math.max(800, 5 * 60000 / bpm));
  assert.deepEqual({ cypher: wert('spur/1/fader'), andreas: wert('spur/2/fader') }, { cypher: 0, andreas: 0 });
});
