// D1 S2-Integration, sechste Fix-Runde T3 (Spec 6.37): Öffnet jemand ein anderes Projekt, während eine Rückfahrt läuft oder wartet, bricht der
// Server sie vor dem Setzen der neuen Regler ab; danach gelten die Werte des neuen Projekts. Vorher lehnte der Kern das Setzen des neuen
// Projekts wegen der Überlappung mit der laufenden Rückfahrt ab, und die Rückfahrt des alten Projekts lief zu Ende (Re-Review Fix5 R3,
// rr5_R3: Kern −3, Projekt B −30).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sitzung, warteBis } from './hilfen/proj_kontext.mjs';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, ruf, CYPHER, warte } from './hilfen/proj_stapel.mjs';

const SR = 48000;
const uhr = (s, beat, bpm = 120) => s.ereignis('/uhr', { beat, bpm, sample: Math.round(beat * 60 / bpm * SR) });
const ki = (z, gestoppt, beat, bpm = 120) => { z.k.ki = gestoppt === 1; z.s.ereignis('/e/ki', { gestoppt, grund: gestoppt ? 'ki_stopp' : 'frei', sample: Math.round(beat * 60 / bpm * SR) }); };

// zwei Projekte, je s1 von cypher (Slot 1): Bravo −30, Alpha −3; Alpha offen
async function einheit(t) {
  const z = sitzung(t, { arrFristMs: 30 });
  const lege = async (name, db) => {
    const slug = (await z.s.neu(name, 'andreas')).j.slug;
    let r = await z.s.aendern({ rev: 0, label: 'c', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, 'cypher');
    r = await z.s.aendern({ rev: r.j.rev, label: 'f', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: db }] }, 'andreas');
    assert.equal(r.code, 200);
    return slug;
  };
  const b = await lege('Bravo', -30);
  await lege('Alpha', -3);
  return { z, b };
}
const folge = (z) => z.k.gesendet.filter((x) => x.adresse === '/k/abbruch' || (x.adresse === '/k/teil' && x.felder.pfad === 'spur/1/fader'))
  .map((x) => (x.adresse === '/k/abbruch' ? `abbruch ${x.felder.plan} ${x.felder.teile}` : `teil ${x.felder.nach} ${x.felder.dauer_beats}`));

// Fix7 U1 (Re-Review Fix6 RR6-1): die WARTENDE Rückfahrt wird nicht mehr gestrichen und direkt gesetzt (das fiel in die Ausblende), sondern
// auf den Wert des neuen Projekts neu geplant; der Fall steht in proj_fix7_u1_oeffnen_wartende.test.mjs. Hier bleibt die laufende.
for (const [fall, griff] of [['läuft', 105]]) {
  test(`T3 Einheit: anderes Projekt öffnen, während die Rückfahrt ${fall} → Abbruch vor dem Setzen der neuen Regler`, async (t) => {
    const { z, b } = await einheit(t);
    uhr(z.s, 100); ki(z, 1, 100);
    uhr(z.s, 101); z.k.leere(); ki(z, 0, 101);                         // Rückfahrt 104 bis 108
    assert.ok(await warteBis(() => z.k.teile(/^spur\/1\/fader$/).length > 0, 1000), 'Rückfahrt gesendet');
    uhr(z.s, griff); z.k.leere();
    const r = await z.s.oeffnen(b, 'andreas');
    console.log(`T3 einheit ${fall} ${JSON.stringify({ code: r.code, folge: folge(z) })}`);
    assert.equal(r.code, 200);
    assert.deepEqual(folge(z), ['abbruch ki_rueck 1', 'teil -30 0'], 'erst der Abbruch, dann der Wert des neuen Projekts');
  });
}

test('T3 Einheit, Negativ-Kontrolle: anderes Projekt öffnen ohne Rückfahrt (und nach ihrem Ende) → kein Abbruch', async (t) => {
  const { z, b } = await einheit(t);
  uhr(z.s, 50); z.k.leere();
  let r = await z.s.oeffnen(b, 'andreas');
  assert.equal(r.code, 200);
  assert.deepEqual(folge(z), ['teil -30 0']);
  uhr(z.s, 100); ki(z, 1, 100);
  uhr(z.s, 101); ki(z, 0, 101);
  assert.ok(await warteBis(() => z.k.teile(/^spur\/1\/fader$/).length > 1, 1000));
  uhr(z.s, 120); z.k.leere();                                          // Rückfahrt 104 bis 108 vorbei
  r = await z.s.oeffnen('alpha', 'andreas');
  assert.equal(r.code, 200);
  assert.deepEqual(folge(z), ['teil -3 0'], 'nach ihrem Ende: kein Abbruch');
});

test('T3 Stapel: anderes Projekt öffnen, während die Rückfahrt läuft → keine Ablehnung, der Kern endet auf dem Wert des neuen Projekts', async (t) => {
  const st = await stapel(t);
  const { o, url } = st;
  const lege = async (name, db) => {
    const slug = (await ruf(url, 'POST', '/proj/neu', { name })).j.slug;
    let r = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Meine', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, CYPHER);
    r = await ruf(url, 'POST', '/proj/aendern', { rev: r.j.rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: db }] });
    assert.equal(r.code, 200);
    return slug;
  };
  const b = await lege('Bravo', -30);
  await lege('Alpha', -3);
  const wert = (pfad) => innen(o).stand.regler[pfad];
  assert.ok(await bis(() => wert('spur/1/fader') === -3));
  const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  const ctx = o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  assert.ok(await bis(() => wert('spur/1/fader') === -200, 4000));
  await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
  const laeuft = await bis(() => wert('spur/1/fader') > -60 && wert('spur/1/fader') < -40, 4000);
  const r = await ruf(url, 'POST', '/proj/oeffnen', { slug: b });
  await warte(Math.round(7 * 60000 / bpm));
  const erg = { rampe_lief: laeuft, code: r.code, regler_fehler: r.j?.kern?.regler_fehler?.map((x) => [x.pfad, x.quittung?.grund]), kern_ende: wert('spur/1/fader'),
    projekt_b: (await ruf(url, 'GET', '/proj/aktuell')).j.projekt?.spuren?.[0]?.fader_db };
  console.log(`T3 stapel ${JSON.stringify(erg)}`);
  assert.ok(laeuft, 'die Rückfahrt lief (sonst wäre der Test leer)');
  assert.equal(r.code, 200);
  assert.deepEqual(erg.regler_fehler, [], 'kein Regler abgelehnt');
  assert.equal(erg.kern_ende, -30, 'der Kern endet auf dem Wert des neuen Projekts');
  assert.equal(erg.projekt_b, -30);
});
