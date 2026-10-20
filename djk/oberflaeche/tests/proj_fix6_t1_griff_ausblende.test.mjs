// D1 S2-Integration, sechste Fix-Runde T1 (Spec 6.37): Andreas' Griff gewinnt auch, solange die Rückfahrt noch auf das Ende einer Ausblende
// wartet. Sein Wert wird das Ziel der Rückfahrt (Abbruch der wartenden, neu geplant auf seinen Wert ab demselben Start, dem Ende der
// Ausblende), statt abgelehnt zu werden; die Spur steht danach nie stumm, ohne dass ein Stopp gilt. Vorher (Fix5 K2) brach der Server die
// wartende Rückfahrt ab und setzte direkt; der Kern lehnte das Setzen wegen der Überlappung mit der Ausblende ab: 409, Spur ohne Stopp stumm,
// Projekt −3 (Re-Review Fix5 R2, rr5_stapel R2; Kern-Probe fix6/probe_t1_t2_kern.txt T1 ALT/NEU).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sitzung, warteBis } from './hilfen/proj_kontext.mjs';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, ruf, CYPHER, warte } from './hilfen/proj_stapel.mjs';

const SR = 48000;
const uhr = (s, beat, bpm = 120) => s.ereignis('/uhr', { beat, bpm, sample: Math.round(beat * 60 / bpm * SR) });
const ki = (z, gestoppt, beat, bpm = 120) => { z.k.ki = gestoppt === 1; z.s.ereignis('/e/ki', { gestoppt, grund: gestoppt ? 'ki_stopp' : 'frei', sample: Math.round(beat * 60 / bpm * SR) }); };

// s1 von andreas (Slot 1), s2 von cypher (Slot 2) mit Fader −3
async function einheit(t) {
  const z = sitzung(t, { arrFristMs: 30 });
  await z.s.neu('Frei', 'andreas');
  let r = await z.s.aendern({ rev: 0, label: 'a', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, 'andreas');
  r = await z.s.aendern({ rev: r.j.rev, label: 'c', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'cypher');
  r = await z.s.aendern({ rev: r.j.rev, label: 'f', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -3 }] }, 'andreas');
  return { z, rev: r.j.rev };
}
const folge = (z) => z.k.gesendet.filter((x) => x.adresse === '/k/abbruch' || (x.adresse === '/k/teil' && /^spur\/\d\/fader$/.test(x.felder.pfad)))
  .map((x) => (x.adresse === '/k/abbruch' ? `abbruch ${x.felder.plan} ${x.felder.teile}` : `teil ${x.felder.pfad} ${x.felder.nach} ${x.felder.dauer_beats}`));

test('T1 Einheit: Griff, während die Rückfahrt auf das Ende der Ausblende wartet → Abbruch, Rückfahrt neu auf seinen Wert ab demselben Start; 200', async (t) => {
  const { z, rev } = await einheit(t);
  uhr(z.s, 100); ki(z, 1, 100);                                        // Ausblende 100 bis 104
  uhr(z.s, 101); z.k.leere(); ki(z, 0, 101);                           // Freigabe mitten in der Ausblende: Rückfahrt wartet bis 104
  assert.ok(await warteBis(() => z.k.teile(/^spur\/2\/fader$/).length > 0, 1000), 'Rückfahrt gesendet');
  const fahrt = z.k.teile(/^spur\/2\/fader$/)[0].felder;
  assert.ok(Math.abs(fahrt.ab_beat - 104) < 1e-6, `Rückfahrt wartet bis zum Ende der Ausblende (ab ${fahrt.ab_beat})`);
  uhr(z.s, 102); z.k.leere();
  const r = await z.s.aendern({ rev, label: 'Hand', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -20 }] }, 'andreas');
  const neu = z.k.teile(/^spur\/2\/fader$/).map((x) => x.felder);
  console.log(`T1 einheit ${JSON.stringify({ code: r.code, folge: folge(z), neu: neu.map((f) => ({ plan: f.plan, teil: f.teil, ab: f.ab_beat, nach: f.nach })) })}`);
  assert.equal(r.code, 200);
  assert.deepEqual(folge(z), ['abbruch ki_rueck 2', 'teil spur/2/fader -20 4'], 'kein direktes Setzen in die Ausblende, sondern die Rückfahrt auf seinen Wert');
  assert.equal(neu[0].plan, 'ki_rueck');
  assert.equal(neu[0].teil, 2);
  assert.ok(Math.abs(neu[0].ab_beat - fahrt.ab_beat) < 1e-6, `gleicher Start wie die alte Rückfahrt (ab ${neu[0].ab_beat})`);
  assert.equal(r.j.projekt.spuren[1].fader_db, -20);
});

test('T1 Einheit, Negativ-Kontrolle: Griff nach dem Ende der Ausblende (Rückfahrt läuft) → Abbruch, direkt sein Wert (wie Fix5 K2)', async (t) => {
  const { z, rev } = await einheit(t);
  uhr(z.s, 100); ki(z, 1, 100);
  uhr(z.s, 101); z.k.leere(); ki(z, 0, 101);
  assert.ok(await warteBis(() => z.k.teile(/^spur\/2\/fader$/).length > 0, 1000));
  uhr(z.s, 105); z.k.leere();                                          // Rückfahrt 104 bis 108 läuft
  const r = await z.s.aendern({ rev, label: 'Hand', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -20 }] }, 'andreas');
  assert.equal(r.code, 200);
  assert.deepEqual(folge(z), ['abbruch ki_rueck 2', 'teil spur/2/fader -20 0']);
});

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
  const verlauf = [];
  const alt = o.vomKern.bind(o);
  o.vomKern = (d) => { if (d.adresse === '/e/regler' && d.felder.pfad === 'spur/1/fader') verlauf.push(Number(d.felder.wert)); alt(d); };
  return { ...st, wert, bpm, ctx: o.bereichKontext(), rev: r.j.rev, verlauf };
}
const projektFader = async (url) => (await ruf(url, 'GET', '/proj/aktuell')).j.projekt?.spuren?.[0]?.fader_db;

test('T1 Stapel: Stopp, Freigabe während der Ausblende, Andreas über die Seite → 200, Kern und Projekt auf seinem Wert, die Spur steht nicht stumm', async (t) => {
  const { url, wert, bpm, ctx, rev } = await aufbau(t);
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  await warte(Math.round(1 * 60000 / bpm));
  await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
  await warte(100);
  const beiGriff = wert('spur/1/fader');
  const r = await ruf(url, 'POST', '/proj/aendern', { rev, label: 'Hand', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -20 }] });
  await warte(Math.round(10 * 60000 / bpm));
  const lage = (await ruf(url, 'GET', '/lage')).j;
  const erg = { bei_griff: beiGriff, code: r.code, fehler: r.j?.fehler, grund: r.j?.regler?.[0]?.quittung?.grund, ki_gestoppt: lage.ki?.gestoppt,
    kern_ende: wert('spur/1/fader'), projekt: await projektFader(url) };
  console.log(`T1 stapel ${JSON.stringify(erg)}`);
  assert.ok(beiGriff > -120 && beiGriff < -3, `der Griff kam während der Ausblende (Wert ${beiGriff})`);
  assert.equal(lage.ki?.gestoppt, false);
  assert.equal(r.code, 200, `kein 409 (${r.j?.fehler} ${erg.grund})`);
  assert.equal(wert('spur/1/fader'), -20, 'der Kern endet auf Andreas\' Wert, nicht stumm');
  assert.equal(erg.projekt, -20);
});

test('T1 Stapel, Negativ-Kontrolle: Griff nach dem Ende der Ausblende (Rückfahrt läuft) → 200, sein Wert sofort', async (t) => {
  const { url, wert, ctx, rev } = await aufbau(t);
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => wert('spur/1/fader') === -200, 4000), 'Ausblende durch');
  await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
  const laeuft = await bis(() => wert('spur/1/fader') > -60 && wert('spur/1/fader') < -10, 4000);
  const r = await ruf(url, 'POST', '/proj/aendern', { rev, label: 'Hand', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -20 }] });
  const sofort = await bis(() => wert('spur/1/fader') === -20, 500);
  console.log(`T1 stapel nach ende ${JSON.stringify({ rampe_lief: laeuft, code: r.code, sofort, kern: wert('spur/1/fader'), projekt: await projektFader(url) })}`);
  assert.ok(laeuft, 'die Rückfahrt lief (sonst wäre die Kontrolle leer)');
  assert.equal(r.code, 200);
  assert.ok(sofort, 'direkt gesetzt, keine neue Fahrt');
});
