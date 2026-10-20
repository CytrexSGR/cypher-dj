// D1 S2-Integration, fünfte Fix-Runde K1 (Spec 6.36): Ein neuer KI-Stopp während der Rückfahrt nach der Freigabe gewinnt. Der Server bricht
// seine eigene Rückfahrt ab (benannter Plan, nur deren Teile), danach gilt der Stopp wie immer und die Spur endet stumm. Der Kern allein reicht
// nicht: ki_fader_ab bricht Teile am Fader nur ab, solange der Fader über der Stummgrenze (−120 dB) steht (ki.cpp:40); eine Rückfahrt, die noch
// wartet oder unter −120 läuft, liefe sonst nach dem Stopp auf den Projektwert (Re-Review Fix4, rr_stapel A: Ende −3 bei ki_gestoppt).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sitzung, warteBis } from './hilfen/proj_kontext.mjs';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, ruf, CYPHER, warte } from './hilfen/proj_stapel.mjs';

const SR = 48000;
const uhr = (s, beat, bpm = 120) => s.ereignis('/uhr', { beat, bpm, sample: Math.round(beat * 60 / bpm * SR) });
const ki = (z, gestoppt, beat, bpm = 120) => { z.k.ki = gestoppt === 1; z.s.ereignis('/e/ki', { gestoppt, grund: gestoppt ? 'ki_stopp' : 'frei', sample: Math.round(beat * 60 / bpm * SR) }); };

async function einheit(t) {
  const z = sitzung(t, { arrFristMs: 30 });
  await z.s.neu('Frei', 'andreas');
  let r = await z.s.aendern({ rev: 0, label: 'a', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, 'andreas');
  r = await z.s.aendern({ rev: r.j.rev, label: 'c', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'cypher');
  r = await z.s.aendern({ rev: r.j.rev, label: 'f', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -3 }] }, 'andreas');
  return z;
}

test('K1 Einheit: neuer Stopp während der Rückfahrt → /k/abbruch mit dem Plan der Rückfahrt (nicht leer), nur deren Teil', async (t) => {
  const z = await einheit(t);
  uhr(z.s, 100); ki(z, 1, 100);
  uhr(z.s, 110); z.k.leere(); ki(z, 0, 110);
  assert.ok(await warteBis(() => z.k.teile(/^spur\/2\/fader$/).length > 0, 1000), 'Rückfahrt gesendet');
  const fahrt = z.k.teile(/^spur\/2\/fader$/)[0].felder;
  uhr(z.s, 111); ki(z, 1, 111);
  assert.ok(await warteBis(() => z.k.an('/k/abbruch').length > 0, 1000), 'Abbruch gesendet');
  await warte(30);
  const ab = z.k.an('/k/abbruch').map((x) => x.felder);
  const nach = z.k.teile(/^spur\/2\/fader$/).slice(1).map((x) => x.felder);
  console.log(`K1 einheit ${JSON.stringify({ fahrt: { plan: fahrt.plan, teil: fahrt.teil }, abbruch: ab, nach })}`);
  assert.notEqual(fahrt.plan, '', 'die Rückfahrt trägt einen Plan, sonst trifft ein Abbruch fremde Teile ohne Plan');
  assert.deepEqual(ab.map((a) => ({ plan: a.plan, teile: a.teile, quelle: a.quelle })), [{ plan: fahrt.plan, teile: String(fahrt.teil), quelle: 'andreas' }]);
  // Fix6 T2 (Spec 6.37): nach dem Abbruch setzt der Server −200 nach (die Rückfahrt kann vor dem Abbruch gestartet sein); sonst nichts
  assert.deepEqual(nach.map((f) => ({ nach: f.nach, dauer: f.dauer_beats, quelle: f.quelle })), [{ nach: -200, dauer: 0, quelle: 'andreas' }],
    'danach nur das Nachsetzen auf −200, keine Fahrt auf einen Projektwert: der Stopp gilt wie immer');
});

test('K1 Einheit, Negativ-Kontrolle: Stopp nach dem Ende der Rückfahrt → kein Abbruch, kein Setzen (der Kern blendet aus)', async (t) => {
  const z = await einheit(t);
  uhr(z.s, 100); ki(z, 1, 100);
  uhr(z.s, 110); ki(z, 0, 110);
  assert.ok(await warteBis(() => z.k.teile(/^spur\/2\/fader$/).length > 0, 1000));
  uhr(z.s, 120); z.k.leere(); ki(z, 1, 120);                          // Rückfahrt 110 bis 114 ist vorbei
  await warte(60);
  assert.equal(z.k.an('/k/abbruch').length, 0);
  assert.equal(z.k.teile(/^spur\/\d\/fader$/).length, 0);
});

// Am Stapel mit der Kern-Attrappe (wie rr_stapel des Re-Reviews)
async function aufbau(t) {
  const st = await stapel(t);
  const { o, url } = st;
  await ruf(url, 'POST', '/proj/neu', { name: 'Frei' });
  let r = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Meine', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, CYPHER);
  r = await ruf(url, 'POST', '/proj/aendern', { rev: r.j.rev, label: 'Andreas', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
  r = await ruf(url, 'POST', '/proj/aendern', { rev: r.j.rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }] });
  assert.equal(r.code, 200);
  const wert = (pfad) => innen(o).stand.regler[pfad];
  assert.ok(await bis(() => wert('spur/1/fader') === -3), 'Cyphers Spur auf −3');
  const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  const ctx = o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => wert('spur/1/fader') === -200, 4000), 'Ausblende durch');
  const verlauf = [];
  const alt = o.vomKern.bind(o);
  o.vomKern = (d) => { if (d.adresse === '/e/regler' && d.felder.pfad === 'spur/1/fader') verlauf.push(Number(d.felder.wert)); alt(d); };
  return { ...st, wert, bpm, ctx, verlauf, rev: r.j.rev };
}

test('K1 Stapel: Freigabe, sofort neuer Stopp (Rückfahrt wartet noch) → Spur endet bei −200 und bleibt dort', async (t) => {
  const { o, url, wert, bpm, ctx, verlauf } = await aufbau(t);
  let gesendet = false;
  const alt = o.vomKern;
  o.vomKern = (d) => {
    alt(d);
    if (d.adresse === '/e/ki' && Number(d.felder.gestoppt) === 0 && !gesendet) { gesendet = true; ctx.sende('/k/ki/stopp', { quelle: 'andreas' }); }
  };
  ctx.sende('/k/ki/frei', { quelle: 'andreas' });
  await warte(Math.round(10 * 60000 / bpm));                           // länger als Ausblende plus Rückfahrt
  const lage = (await ruf(url, 'GET', '/lage')).j;
  const hoechster = Math.max(-200, ...verlauf);
  console.log(`K1 stapel A ${JSON.stringify({ bpm, ki_gestoppt: lage.ki?.gestoppt, ende: wert('spur/1/fader'), hoechster })}`);
  assert.equal(lage.ki?.gestoppt, true);
  assert.equal(wert('spur/1/fader'), -200, 'die Spur endet stumm');
  assert.ok(hoechster <= -120, `nie hörbar (höchster Wert ${hoechster})`);
});

// Eine laufende Rückfahrt steht nie unter der Stummgrenze: Rampen aus stumm beginnen bei −60 dB (SCHNITTSTELLEN §1.2, typen.h STUMM_RAMPE,
// Attrappe regler.mjs). Ein Stopp mitten in ihr trifft also immer ki_fader_ab des Kerns; diese Probe hält fest, dass der Abbruch des Servers
// dabei nicht stört (Re-Review Fix4, rr_stapel A2).
test('K1 Stapel: neuer Stopp mitten in der laufenden Rückfahrt (über −60) → Spur endet bei −200', async (t) => {
  const { wert, bpm, ctx, verlauf } = await aufbau(t);
  ctx.sende('/k/ki/frei', { quelle: 'andreas' });
  const laeuft = await bis(() => wert('spur/1/fader') > -60 && wert('spur/1/fader') < -20, 4000);
  const beiStopp = wert('spur/1/fader');
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  await warte(Math.round(8 * 60000 / bpm));
  const unterStumm = verlauf.filter((w) => w > -200 && w <= -120).length;
  console.log(`K1 stapel laufend ${JSON.stringify({ rampe_lief: laeuft, bei_stopp: beiStopp, ende: wert('spur/1/fader'), werte_unter_stummgrenze: unterStumm })}`);
  assert.ok(laeuft);
  assert.equal(wert('spur/1/fader'), -200);
  assert.equal(unterStumm, 0, 'die Rückfahrt lief nie zwischen −200 und −120 (Stumm-Regel)');
});

test('K1 Stapel, Negativ-Kontrolle: Stopp nach dem Ende der Rückfahrt → der Kern blendet wie immer über 4 Beats aus', async (t) => {
  const { wert, bpm, ctx, verlauf } = await aufbau(t);
  ctx.sende('/k/ki/frei', { quelle: 'andreas' });
  assert.ok(await bis(() => wert('spur/1/fader') === -3, 4000), 'Rückfahrt durch');
  await warte(200);
  const n = verlauf.length;
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => wert('spur/1/fader') === -200, 4000));
  const zwischen = verlauf.slice(n).filter((w) => w > -190 && w < -10).length;
  console.log(`K1 stapel nach ende ${JSON.stringify({ bpm, ende: wert('spur/1/fader'), zwischenwerte: zwischen })}`);
  assert.ok(zwischen >= 3, 'eine Ausblende, kein Sprung');
});
