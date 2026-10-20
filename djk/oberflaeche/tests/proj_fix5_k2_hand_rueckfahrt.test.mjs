// D1 S2-Integration, fünfte Fix-Runde K2 (Spec 6.36): Andreas' Hand gewinnt auch während der Rückfahrt. Setzt er über die Seite den Fader einer
// Cypher-Spur, während deren Rückfahrt wartet oder läuft, bricht der Server die Rückfahrt dieses Faders ab (/k/abbruch ki_rueck <nr>) und setzt
// seinen Wert: 200, kein 409, kein Zurückdrehen. Vorher lehnte der Kern das Setzen mit ueberlappung ab, der Server drehte zurück, 409
// regler_abgelehnt (Re-Review Fix4, rr_stapel B: code 409, Kern und Projekt −3).
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

test('K2 Einheit: Andreas setzt den Fader der Cypher-Spur während der Rückfahrt → erst Abbruch dieser Rückfahrt, dann sein Wert; 200', async (t) => {
  const { z, rev } = await einheit(t);
  uhr(z.s, 100); ki(z, 1, 100);
  uhr(z.s, 110); ki(z, 0, 110);
  assert.ok(await warteBis(() => z.k.teile(/^spur\/2\/fader$/).length > 0, 1000), 'Rückfahrt gesendet');
  uhr(z.s, 111); z.k.leere();
  const r = await z.s.aendern({ rev, label: 'Hand', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -20 }] }, 'andreas');
  console.log(`K2 einheit ${JSON.stringify({ code: r.code, folge: folge(z) })}`);
  assert.equal(r.code, 200);
  assert.deepEqual(folge(z), ['abbruch ki_rueck 2', 'teil spur/2/fader -20 0']);
  assert.equal(r.j.projekt.spuren[1].fader_db, -20);
});

test('K2 Einheit, Negativ-Kontrollen: anderer Fader während der Rückfahrt, Cypher-Fader ohne Rückfahrt, nach ihrem Ende → kein Abbruch', async (t) => {
  const { z, rev } = await einheit(t);
  uhr(z.s, 100); ki(z, 1, 100);
  uhr(z.s, 110); ki(z, 0, 110);
  assert.ok(await warteBis(() => z.k.teile(/^spur\/2\/fader$/).length > 0, 1000));
  uhr(z.s, 111); z.k.leere();
  let r = await z.s.aendern({ rev, label: 'Hand', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -20 }] }, 'andreas');
  assert.equal(r.code, 200);
  assert.deepEqual(folge(z), ['teil spur/1/fader -20 0'], 'Andreas\' eigene Spur: kein Abbruch');
  uhr(z.s, 120); z.k.leere();                                         // Rückfahrt 110 bis 114 ist vorbei
  r = await z.s.aendern({ rev: r.j.rev, label: 'Hand', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -20 }] }, 'andreas');
  assert.equal(r.code, 200);
  assert.deepEqual(folge(z), ['teil spur/2/fader -20 0'], 'nach dem Ende der Rückfahrt: kein Abbruch');
  const { z: y, rev: rv } = await einheit(t);
  uhr(y.s, 50); y.k.leere();
  r = await y.s.aendern({ rev: rv, label: 'Hand', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -20 }] }, 'andreas');
  assert.equal(r.code, 200);
  assert.deepEqual(folge(y), ['teil spur/2/fader -20 0'], 'ohne Rückfahrt: kein Abbruch');
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
  return { ...st, wert, bpm, ctx: o.bereichKontext(), rev: r.j.rev };
}

test('K2 Stapel: Andreas über die Seite während der Rückfahrt → 200, Kern und Projekt auf seinem Wert', async (t) => {
  const { url, wert, bpm, ctx, rev } = await aufbau(t);
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => wert('spur/1/fader') === -200, 4000), 'Ausblende durch');
  await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
  const laeuft = await bis(() => wert('spur/1/fader') > -60 && wert('spur/1/fader') < -10, 4000);
  const r = await ruf(url, 'POST', '/proj/aendern', { rev, label: 'Hand', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -20 }] });
  await warte(Math.round(6 * 60000 / bpm));
  const p = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  console.log(`K2 stapel ${JSON.stringify({ rampe_lief: laeuft, code: r.code, fehler: r.j?.fehler, kern_ende: wert('spur/1/fader'), projekt: p?.spuren?.[0]?.fader_db })}`);
  assert.ok(laeuft, 'die Rückfahrt lief (sonst wäre der Test leer)');
  assert.equal(r.code, 200);
  assert.equal(wert('spur/1/fader'), -20, 'Kern auf Andreas\' Wert, die Rückfahrt fährt nicht weiter');
  assert.equal(p.spuren[0].fader_db, -20);
});

test('K2 Stapel, Negativ-Kontrolle: Andreas über die Seite ohne Rückfahrt → 200, sein Wert', async (t) => {
  const { url, wert, rev } = await aufbau(t);
  const r = await ruf(url, 'POST', '/proj/aendern', { rev, label: 'Hand', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -20 }] });
  assert.ok(await bis(() => wert('spur/1/fader') === -20, 2000));
  console.log(`K2 stapel ohne ${JSON.stringify({ code: r.code, kern: wert('spur/1/fader') })}`);
  assert.equal(r.code, 200);
});
