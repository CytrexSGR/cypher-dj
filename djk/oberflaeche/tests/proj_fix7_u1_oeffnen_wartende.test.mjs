// D1 S2-Integration, siebte Fix-Runde U1 (Spec 6.37, Re-Review Fix6 RR6-1): Öffnet jemand ein anderes Projekt, während die Rückfahrt des alten
// noch WARTET (die Ausblende des Stopps läuft), strich T3 die wartende Rückfahrt und setzte den Fader des neuen Projekts direkt. Das Setzen fiel in
// die Ausblende und der Kern lehnte es ab (ueberlappung); verfalleneRueckfahrt griff nicht (Fader beim Öffnen bei etwa −19, nicht ≤ −120). Nach
// der Ausblende stand die Spur bei −200, ohne dass ein Stopp galt (rr6_r3w R3w: Kern −200, Projekt B −30). Jetzt wie in T1 (Andreas' Griff): die
// wartende Rückfahrt wird mit dem Wert des neuen Projekts als Ziel ab demselben Start neu geplant (rueckfahrtAufZiel, zweiter Versuch bei
// ueberlappung). Eine laufende Rückfahrt bricht weiter ab und der Wert des neuen Projekts wird gesetzt (T3, Negativ-Kontrolle).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sitzung, pruefKontext, warteBis } from './hilfen/proj_kontext.mjs';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, ruf, CYPHER, warte } from './hilfen/proj_stapel.mjs';

const SR = 48000;
const uhr = (s, beat, bpm = 120) => s.ereignis('/uhr', { beat, bpm, sample: Math.round(beat * 60 / bpm * SR) });
const ki = (z, gestoppt, beat, bpm = 120) => { z.k.ki = gestoppt === 1; z.s.ereignis('/e/ki', { gestoppt, grund: gestoppt ? 'ki_stopp' : 'frei', sample: Math.round(beat * 60 / bpm * SR) }); };

// zwei Projekte, je s1 von cypher (Slot 1): Bravo −30, Alpha −3; Alpha offen
async function einheit(t, kontext) {
  const z = sitzung(t, { arrFristMs: 30 }, kontext);
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
  .map((x) => (x.adresse === '/k/abbruch' ? `abbruch ${x.felder.plan} ${x.felder.teile}` : `teil ${x.felder.nach} ${x.felder.dauer_beats} ab ${x.felder.ab_beat}`));
// Stopp bei 100, Freigabe bei 101: die Rückfahrt wartet bis 104 (Ende der Ausblende), läuft 104 bis 108
async function wartend(z) {
  uhr(z.s, 100); ki(z, 1, 100);
  uhr(z.s, 101); z.k.leere(); ki(z, 0, 101);
  assert.ok(await warteBis(() => z.k.teile(/^spur\/1\/fader$/).length > 0, 1000), 'Rückfahrt gesendet');
  assert.ok(Math.abs(z.k.teile(/^spur\/1\/fader$/)[0].felder.ab_beat - 104) < 1e-6, 'sie wartet bis 104');
  uhr(z.s, 102); z.k.leere();
}

test('U1 Einheit: anderes Projekt öffnen, während die Rückfahrt wartet → Abbruch, dann Rückfahrt auf den Wert des neuen Projekts ab demselben Start', async (t) => {
  const { z, b } = await einheit(t);
  await wartend(z);
  const r = await z.s.oeffnen(b, 'andreas');
  console.log(`U1 einheit wartet ${JSON.stringify({ code: r.code, folge: folge(z), rueckfahrt_ziel: r.j?.kern?.rueckfahrt_ziel })}`);
  assert.equal(r.code, 200);
  assert.deepEqual(folge(z), ['abbruch ki_rueck 1', 'teil -30 4 ab 104'], 'nicht direkt setzen (fiele in die Ausblende), sondern ab 104 auf −30 fahren');
  assert.deepEqual(r.j.kern.rueckfahrt_ziel, ['spur/1/fader']);
  assert.deepEqual(r.j.kern.regler_fehler, []);
});

test('U1 Einheit: Kern lehnt die neu geplante Rückfahrt mit ueberlappung ab (Start nur genähert) → zweiter Versuch nach dem spätesten Ende der Ausblende', async (t) => {
  let erster = true;
  const k = pruefKontext({ quittung: (adresse, f) => {
    if (adresse === '/k/teil' && f.pfad === 'spur/1/fader' && f.dauer_beats === 4 && f.nach === -30 && erster) { erster = false; return { status: 6, grund: 'ueberlappung' }; }
    return { status: 3, grund: '' };
  } });
  const { z, b } = await einheit(t, k);
  await wartend(z);
  const r = await z.s.oeffnen(b, 'andreas');
  console.log(`U1 einheit zweiter ${JSON.stringify({ code: r.code, folge: folge(z), regler_fehler: r.j?.kern?.regler_fehler })}`);
  assert.equal(r.code, 200);
  assert.deepEqual(folge(z), ['abbruch ki_rueck 1', 'teil -30 4 ab 104', 'teil -30 4 ab 106.1']);
  assert.deepEqual(r.j.kern.regler_fehler, [], 'der zweite Versuch ging durch');
});

test('U1 Einheit: kommt zwischen erstem und zweitem Versuch ein neuer Stopp → kein zweiter Versuch (er liefe mitten im Stopp auf)', async (t) => {
  let erster = true, zz = null;
  const k = pruefKontext({ quittung: (adresse, f) => {
    if (adresse === '/k/teil' && f.pfad === 'spur/1/fader' && f.dauer_beats === 4 && f.nach === -30 && erster) {
      erster = false;
      ki(zz, 1, 102.2);                                                // der Stopp kommt, bevor die Ablehnung beim Server ist
      return { status: 6, grund: 'ueberlappung' };
    }
    return { status: 3, grund: '' };
  } });
  const { z, b } = await einheit(t, k);
  zz = z;
  await wartend(z);
  await z.s.oeffnen(b, 'andreas');
  await warte(30);
  const rueck = folge(z).filter((x) => / 4 ab /.test(x));
  console.log(`U1 einheit stopp_dazwischen ${JSON.stringify({ folge: folge(z) })}`);
  assert.deepEqual(rueck, ['teil -30 4 ab 104'], 'nur der erste Versuch');
});

// Fix8 V1 (Spec 6.37): ein freier Slot gehört nicht zu Cyphers Spuren; er bekommt keine Rückfahrt, sondern den eigenen Weg (proj_ziel, Dauer 0)
test('U1 Einheit: neues (leeres) Projekt anlegen, während die Rückfahrt wartet → Vorgabe 0 dB des freien Slots zum Ende der Ausblende (eigener Weg)', async (t) => {
  const { z } = await einheit(t);
  await wartend(z);
  const r = await z.s.neu('Charlie', 'andreas');
  console.log(`U1 einheit neu ${JSON.stringify({ code: r.code, folge: folge(z) })}`);
  assert.equal(r.code, 200);
  assert.deepEqual(folge(z), ['abbruch ki_rueck 1', 'teil 0 0 ab 104']);
  assert.deepEqual(r.j.kern.ziel_nach_ausblende, ['spur/1/fader']);
  assert.equal(z.s.rueckfahrt.has('spur/1/fader'), false);
});

test('U1 Einheit, Negativ-Kontrollen: laufende Rückfahrt bricht ab und der Wert wird gesetzt (T3); im Stopp nichts neu geplant', async (t) => {
  const { z, b } = await einheit(t);
  await wartend(z);
  uhr(z.s, 105); z.k.leere();
  let r = await z.s.oeffnen(b, 'andreas');
  assert.equal(r.code, 200);
  assert.deepEqual(folge(z), ['abbruch ki_rueck 1', 'teil -30 0 ab 105.1'], 'laufend: wie T3');
  assert.equal(r.j.kern.rueckfahrt_ziel, undefined);
  // ein neuer Stopp, während die Rückfahrt wartet: sie ist abgebrochen, das Öffnen setzt Cyphers Fader stumm (imStoppStumm), keine Rückfahrt
  const y = await einheit(t);
  await wartend(y.z);
  ki(y.z, 1, 102);
  await warte(30);
  y.z.k.leere();
  r = await y.z.s.oeffnen(y.b, 'andreas');
  console.log(`U1 einheit stopp ${JSON.stringify({ code: r.code, folge: folge(y.z) })}`);
  assert.equal(r.code, 200);
  assert.deepEqual(folge(y.z), ['teil -200 0 ab 102.1'], 'im Stopp: stumm, keine Rückfahrt');
});

async function zweiProjekte(url) {
  const lege = async (name, db) => {
    const slug = (await ruf(url, 'POST', '/proj/neu', { name })).j.slug;
    let r = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Meine', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, CYPHER);
    r = await ruf(url, 'POST', '/proj/aendern', { rev: r.j.rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: db }] });
    assert.equal(r.code, 200);
    return slug;
  };
  const b = await lege('Bravo', -30);
  await lege('Alpha', -3);
  return b;
}

for (const [fall, weg] of [['oeffnen', (url, b) => ruf(url, 'POST', '/proj/oeffnen', { slug: b })], ['neu', (url) => ruf(url, 'POST', '/proj/neu', { name: 'Charlie' })]]) {
  test(`U1 Stapel (${fall}): während die Rückfahrt wartet → keine Ablehnung, der Kern endet auf dem Wert des neuen Projekts, nicht stumm`, async (t) => {
    const st = await stapel(t);
    const { o, url } = st;
    const b = await zweiProjekte(url);
    const wert = (pfad) => innen(o).stand.regler[pfad];
    assert.ok(await bis(() => wert('spur/1/fader') === -3));
    const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
    const ctx = o.bereichKontext();
    const s = o.proj.sitzung;
    await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
    await warte(Math.round(60000 / bpm));                                 // ein Beat in die Ausblende
    await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
    assert.ok(await bis(() => s.rueckfahrt.size > 0, 2000), 'Rückfahrt gesendet (wartet bis Stopp + 4)');
    await warte(50);
    const beiOeffnen = wert('spur/1/fader');
    const r = await weg(url, b);
    await warte(Math.round(9 * 60000 / bpm));
    const lage = (await ruf(url, 'GET', '/lage')).j;
    const soll = fall === 'oeffnen' ? -30 : 0;
    const erg = { bei_oeffnen: beiOeffnen, code: r.code, regler_fehler: r.j?.kern?.regler_fehler?.map((x) => [x.pfad, x.quittung?.grund]),
      rueckfahrt_ziel: r.j?.kern?.rueckfahrt_ziel, ki_gestoppt: lage.ki?.gestoppt, kern_ende: wert('spur/1/fader'),
      projekt: (await ruf(url, 'GET', '/proj/aktuell')).j.projekt?.spuren?.[0]?.fader_db ?? null };
    console.log(`U1 stapel ${fall} ${JSON.stringify(erg)}`);
    assert.ok(beiOeffnen > -120 && beiOeffnen < -3, 'beim Öffnen lief die Ausblende noch (sonst wäre der Fall ein anderer)');
    assert.equal(r.code, 200);
    assert.deepEqual(erg.regler_fehler, [], 'kein Regler abgelehnt');
    assert.notEqual(erg.ki_gestoppt, true);
    assert.equal(erg.kern_ende, soll, 'der Kern endet auf dem Wert des neuen Projekts');
  });
}
