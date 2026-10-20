// D1 S2-Integration, siebte Fix-Runde U2 (Spec 6.37, Re-Review Fix6): der Stapel zeigt Fix6 T2 jetzt ohne künstliche Last. Die Kern-Attrappe
// blendet beim KI-Stopp wie der Kern (ki.cpp ki_fader_ab) einen Fader, der schon stumm steht, nicht mehr aus. Vorher zog ihre Ausblende den
// Fader nach jedem Stopp auf −200, auch wenn der Server das Nachsetzen nach dem Abbruch der Rückfahrt wegließ (rr6 Mutation M1: Stapel grün).
// Fall (rr6_stapel K1b−0.03): Stopp, Ausblende durch (−200), Freigabe; die Rückfahrt wartet bis Stopp + 4. Ein neuer Stopp kurz vor ihrem
// Start: der Kern tut am stummen Fader nichts, die Rückfahrt startet, bevor der Abbruch des Servers ankommt, der Abbruch hält den Fader bei
// etwa −60. Erst das Nachsetzen (−200 nach der Quittung des Abbruchs) macht die Spur wieder stumm.
// Der Wettlauf hängt an Millisekunden; der Test wiederholt den Versuch, bis er eintrat (die Rückfahrt meldete nach dem Stopp einen Wert über −120),
// und prüft dann. Tritt er in keinem Versuch ein, ist der Test rot (leer, nicht grün).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, ruf, CYPHER, warte } from './hilfen/proj_stapel.mjs';

const VERSUCHE = 6;
const VERSATZ = -0.03;                 // Beat vor dem Start der wartenden Rückfahrt
const fein = async (p, ms) => { const t0 = Date.now(); while (!p() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 1)); return p(); };

async function aufbau(t) {
  const st = await stapel(t);
  const { o, url } = st;
  await ruf(url, 'POST', '/proj/neu', { name: 'Frei' });
  let r = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Meine', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, CYPHER);
  r = await ruf(url, 'POST', '/proj/aendern', { rev: r.j.rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }] });
  assert.equal(r.code, 200);
  const wert = (pfad) => innen(o).stand.regler[pfad];
  assert.ok(await bis(() => wert('spur/1/fader') === -3), 'Cyphers Spur auf −3');
  const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  const ctx = o.bereichKontext();
  const verlauf = [];
  const alt = o.vomKern.bind(o);
  o.vomKern = (d) => { if (d.adresse === '/e/regler' && d.felder.pfad === 'spur/1/fader') verlauf.push(Number(d.felder.wert)); alt(d); };
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => wert('spur/1/fader') === -200, 4000), 'Ausblende durch');
  return { url, wert, bpm, ctx, verlauf, s: o.proj.sitzung };
}

test('U2 Stapel (Fix6 T2 ohne künstliche Last): neuer Stopp kurz vor dem Start der wartenden Rückfahrt → die Spur endet stumm', async (t) => {
  const { url, wert, bpm, ctx, verlauf, s } = await aufbau(t);
  const versuche = [];
  let getroffen = null;
  for (let i = 0; i < VERSUCHE && !getroffen; i++) {
    await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
    assert.ok(await bis(() => s.rueckfahrt.size > 0, 2000), 'Rückfahrt gesendet');
    const ab = [...s.rueckfahrt.values()][0].ab;
    assert.ok(await fein(() => (s.lage.uhr?.beat ?? 0) >= ab + VERSATZ, 6000), 'Beat erreicht');
    const n0 = verlauf.length, beiStopp = wert('spur/1/fader');
    await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
    await warte(Math.round(6 * 60000 / bpm));
    const nach = verlauf.slice(n0);
    const v = { versuch: i + 1, bei_stopp: beiStopp, hoechster_nach_stopp: Math.max(-200, ...nach), kern_ende: wert('spur/1/fader'),
      ki_gestoppt: (await ruf(url, 'GET', '/lage')).j.ki?.gestoppt };
    versuche.push(v);
    if (beiStopp === -200 && v.hoechster_nach_stopp > -120) getroffen = v;   // die Rückfahrt startete nach dem Stopp, vor dem Abbruch
  }
  console.log(`U2 stapel ${JSON.stringify(versuche)}`);
  assert.ok(getroffen, `der Wettlauf trat in ${VERSUCHE} Versuchen nicht ein (Test leer)`);
  assert.equal(getroffen.ki_gestoppt, true);
  assert.equal(getroffen.kern_ende, -200, 'die Spur endet stumm, der Stopp gilt');
});

test('U2 Stapel, Negativ-Kontrolle: Freigabe ohne neuen Stopp → die Rückfahrt fährt auf −3, kein Nachsetzen', async (t) => {
  const { url, wert, bpm, ctx } = await aufbau(t);
  await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
  await warte(Math.round(10 * 60000 / bpm));
  const lage = (await ruf(url, 'GET', '/lage')).j;
  console.log(`U2 stapel kontrolle ${JSON.stringify({ ki_gestoppt: lage.ki?.gestoppt, kern_ende: wert('spur/1/fader') })}`);
  assert.equal(lage.ki?.gestoppt, false);
  assert.equal(wert('spur/1/fader'), -3);
});
