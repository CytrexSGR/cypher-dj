// D1 S2-Integration, achte Fix-Runde V1 (Spec 6.37, Re-Review Fix7 RR7-1): U1 (Fix7) plante beim Öffnen JEDE wartende Rückfahrt von A auf B um,
// auch wenn die Spur in B Andreas gehört. Der Fader stand damit in this.rueckfahrt; ein neuer Stopp brach sie ab und setzte −200 nach
// (rueckfahrtAbbrechen(null, true)), die Freigabe fuhr nur cypherSpuren(B) zurück: Andreas' Spur endete bei −200 ohne Stopp
// (rr7 M_frei, M_wartet, M_laeuft). Jetzt stehen in this.rueckfahrt nur Fader von Cyphers Spuren des offenen Projekts. Andreas' Spuren in B, deren
// Fader wegen der laufenden Ausblende nicht sofort gesetzt werden kann, setzt der Server zum Ende der Ausblende auf einem eigenen Weg (Plan
// proj_ziel), den weder Stopp noch Freigabe anfassen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sitzung, pruefKontext, warteBis } from './hilfen/proj_kontext.mjs';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, ruf, CYPHER, warte } from './hilfen/proj_stapel.mjs';

const SR = 48000;
const uhr = (s, beat, bpm = 120) => s.ereignis('/uhr', { beat, bpm, sample: Math.round(beat * 60 / bpm * SR) });
const ki = (z, gestoppt, beat, bpm = 120) => { z.k.ki = gestoppt === 1; z.s.ereignis('/e/ki', { gestoppt, grund: gestoppt ? 'ki_stopp' : 'frei', sample: Math.round(beat * 60 / bpm * SR) }); };

// A: s1 von Cypher −3 (offen). B: s1 von Andreas (Audio) −30.
async function einheit(t, kontext) {
  const z = sitzung(t, { arrFristMs: 30 }, kontext);
  const lege = async (name, quelle, db) => {
    const slug = (await z.s.neu(name, 'andreas')).j.slug;
    let r = await z.s.aendern({ rev: 0, label: 'c', befehle: [{ befehl: 'spur_neu', art: quelle === 'cypher' ? 'instrument' : 'audio' }] }, quelle);
    r = await z.s.aendern({ rev: r.j.rev, label: 'f', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: db }] }, 'andreas');
    assert.equal(r.code, 200);
    return slug;
  };
  const b = await lege('Bravo', 'andreas', -30);
  await lege('Alpha', 'cypher', -3);
  return { z, b };
}
const folge = (z) => z.k.gesendet.filter((x) => x.adresse === '/k/abbruch' || (x.adresse === '/k/teil' && x.felder.pfad === 'spur/1/fader'))
  .map((x) => (x.adresse === '/k/abbruch' ? `abbruch ${x.felder.plan} ${x.felder.teile}` : `teil ${x.felder.plan || '-'} ${x.felder.nach} ${x.felder.dauer_beats} ab ${x.felder.ab_beat}`));
// Stopp bei 100, Freigabe bei 101: die Rückfahrt von A wartet bis 104 (Ende der Ausblende)
async function wartend(z) {
  uhr(z.s, 100); ki(z, 1, 100);
  uhr(z.s, 101); z.k.leere(); ki(z, 0, 101);
  assert.ok(await warteBis(() => z.k.teile(/^spur\/1\/fader$/).length > 0, 1000), 'Rückfahrt gesendet');
  uhr(z.s, 102); z.k.leere();
}

test('V1 Einheit: B-Spur 1 gehört Andreas → keine Rückfahrt, eigener Weg (proj_ziel) setzt −30 am Ende der Ausblende; Stopp und Freigabe fassen ihn nicht an', async (t) => {
  const { z, b } = await einheit(t);
  await wartend(z);
  const r = await z.s.oeffnen(b, 'andreas');
  const nachOeffnen = folge(z);
  const inRueckfahrt = z.s.rueckfahrt.has('spur/1/fader');
  z.k.leere();
  uhr(z.s, 102.5); ki(z, 1, 102.5);                                     // neuer Stopp, während der eigene Weg noch wartet
  await warte(30);
  const nachStopp = folge(z);
  z.k.leere();
  uhr(z.s, 110); ki(z, 0, 110);                                         // Freigabe
  await warte(50);
  const nachFrei = folge(z);
  console.log(`V1 einheit ${JSON.stringify({ code: r.code, nach_oeffnen: nachOeffnen, in_rueckfahrt: inRueckfahrt, kern: r.j?.kern?.ziel_nach_ausblende,
    rueckfahrt_ziel: r.j?.kern?.rueckfahrt_ziel ?? null, nach_stopp: nachStopp, nach_frei: nachFrei })}`);
  assert.equal(r.code, 200);
  assert.deepEqual(nachOeffnen, ['abbruch ki_rueck 1', 'teil proj_ziel -30 0 ab 104'], 'Andreas\' Wert zum Ende der Ausblende auf eigenem Plan');
  assert.equal(inRueckfahrt, false, 'in this.rueckfahrt nur Cyphers Spuren des offenen Projekts');
  assert.equal(r.j.kern.rueckfahrt_ziel, undefined, 'keine Rückfahrt für Andreas\' Spur');
  assert.deepEqual(r.j.kern.ziel_nach_ausblende, ['spur/1/fader']);
  assert.deepEqual(nachStopp, [], 'der Stopp bricht den eigenen Weg nicht ab und setzt nichts stumm');
  assert.deepEqual(nachFrei, [], 'die Freigabe fährt Andreas\' Spur nicht');
});

test('V1 Einheit, Negativ-Kontrolle: B-Spur 1 gehört Cypher → weiter Rückfahrt auf Bs Wert (U1), der neue Stopp bricht sie ab', async (t) => {
  const z = sitzung(t, { arrFristMs: 30 });
  const lege = async (name, db) => {
    const slug = (await z.s.neu(name, 'andreas')).j.slug;
    let r = await z.s.aendern({ rev: 0, label: 'c', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, 'cypher');
    r = await z.s.aendern({ rev: r.j.rev, label: 'f', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: db }] }, 'andreas');
    return slug;
  };
  const b = await lege('Bravo', -30);
  await lege('Alpha', -3);
  await wartend(z);
  const r = await z.s.oeffnen(b, 'andreas');
  assert.deepEqual(folge(z), ['abbruch ki_rueck 1', 'teil ki_rueck -30 4 ab 104']);
  assert.equal(z.s.rueckfahrt.has('spur/1/fader'), true);
  assert.deepEqual(r.j.kern.rueckfahrt_ziel, ['spur/1/fader']);
  assert.equal(r.j.kern.ziel_nach_ausblende, undefined);
  z.k.leere();
  uhr(z.s, 102.5); ki(z, 1, 102.5);
  await warte(30);
  assert.deepEqual(folge(z), ['abbruch ki_rueck 1', 'teil - -200 0 ab 102.6'], 'Cyphers Rückfahrt bricht ab und wird stumm nachgesetzt');
});

test('V1 Einheit: Andreas greift den Fader seiner B-Spur, während der eigene Weg wartet → sein Wert wird das Ziel (kein 409)', async (t) => {
  const { z, b } = await einheit(t);
  await wartend(z);
  await z.s.oeffnen(b, 'andreas');
  z.k.leere();
  const rev = (await z.s.aktuell()).j.projekt.rev;
  const r = await z.s.aendern({ rev, label: 'g', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -12 }] }, 'andreas');
  console.log(`V1 einheit griff ${JSON.stringify({ code: r.code, folge: folge(z), kern: r.j?.kern })}`);
  assert.equal(r.code, 200);
  assert.deepEqual(folge(z), ['abbruch proj_ziel 1', 'teil proj_ziel -12 0 ab 104']);
});

test('V1 Einheit: anderes Projekt öffnen, während der eigene Weg wartet → er wird abgebrochen, danach gilt das neue Projekt', async (t) => {
  const { z, b } = await einheit(t);
  await wartend(z);
  await z.s.oeffnen(b, 'andreas');
  const a = z.s.liste().j.find((p) => p.slug !== b).slug;
  z.k.leere();
  const r = await z.s.oeffnen(a, 'andreas');
  console.log(`V1 einheit wechsel ${JSON.stringify({ code: r.code, folge: folge(z) })}`);
  assert.equal(r.code, 200);
  assert.deepEqual(folge(z), ['abbruch proj_ziel 1', 'teil ki_rueck -3 4 ab 104'], 'A: Cyphers Spur, Rückfahrt auf −3 ab demselben Start');
});

// Probe M_stopp: B öffnen, während der Stopp gilt und seine Ausblende auf Spur 1 (A, Cyphers) noch läuft; keine Rückfahrt beteiligt. Der Kern
// lehnt das Setzen von Andreas' Fader ab (ueberlappung) → sein Wert kommt auf dem eigenen Weg zum Ende der Ausblende (Stopp-Beat 100 + 4).
test('V1 Einheit M_stopp: Öffnen in die Ausblende eines geltenden Stopps → abgelehnter Fader von Andreas\' Spur kommt zum Ende der Ausblende', async (t) => {
  const k = pruefKontext({ quittung: (adresse, f) => (adresse === '/k/teil' && f.pfad === 'spur/1/fader' && f.plan === '' && f.ab_beat < 104
    ? { status: 6, grund: 'ueberlappung' } : { status: 3, grund: '' }) });
  const { z, b } = await einheit(t, k);
  uhr(z.s, 100); ki(z, 1, 100);
  uhr(z.s, 101); await warte(20); z.k.leere();
  const r = await z.s.oeffnen(b, 'andreas');
  const nachOeffnen = folge(z);
  z.k.leere();
  uhr(z.s, 110); ki(z, 0, 110);
  await warte(50);
  console.log(`V1 einheit m_stopp ${JSON.stringify({ code: r.code, folge: nachOeffnen, regler_fehler: r.j?.kern?.regler_fehler, ziel: r.j?.kern?.ziel_nach_ausblende, nach_frei: folge(z) })}`);
  assert.equal(r.code, 200);
  assert.deepEqual(nachOeffnen, ['teil - -30 0 ab 101.1', 'teil proj_ziel -30 0 ab 104']);
  assert.deepEqual(r.j.kern.regler_fehler, [], 'die Ablehnung ist durch den eigenen Weg erledigt');
  assert.deepEqual(r.j.kern.ziel_nach_ausblende, ['spur/1/fader']);
  assert.equal(z.s.rueckfahrt.has('spur/1/fader'), false);
  assert.deepEqual(folge(z), [], 'die Freigabe fährt Andreas\' Spur nicht');
});

test('V1 Einheit M_stopp, Negativ-Kontrolle: Ablehnung aus anderem Grund (nicht ueberlappung) bleibt ein Regler-Fehler, kein eigener Weg', async (t) => {
  let scharf = false;                                                   // erst beim Öffnen ablehnen, nicht beim Aufbau
  const k = pruefKontext({ quittung: (adresse, f) => (scharf && adresse === '/k/teil' && f.pfad === 'spur/1/fader' && f.plan === ''
    ? { status: 6, grund: 'regler_beim_menschen' } : { status: 3, grund: '' }) });
  const { z, b } = await einheit(t, k);
  scharf = true;
  uhr(z.s, 100); ki(z, 1, 100);
  uhr(z.s, 101); await warte(20); z.k.leere();
  const r = await z.s.oeffnen(b, 'andreas');
  assert.equal(r.code, 200);
  assert.deepEqual(folge(z), ['teil - -30 0 ab 101.1']);
  assert.deepEqual(r.j.kern.regler_fehler.map((x) => [x.pfad, x.quittung.grund]), [['spur/1/fader', 'regler_beim_menschen']]);
  assert.equal(r.j.kern.ziel_nach_ausblende, undefined);
});

// --- Stapel (Server + Kern-Attrappe), Proben rr7 M_kein, M_wartet, M_laeuft, M_frei, MK_frei ------------------------------------------
async function zwei(url) {
  const lege = async (name, quelle, db) => {
    const slug = (await ruf(url, 'POST', '/proj/neu', { name })).j.slug;
    let r = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'S', befehle: [{ befehl: 'spur_neu', art: quelle === 'cypher' ? 'instrument' : 'audio' }] }, quelle === 'cypher' ? CYPHER : {});
    assert.equal(r.code, 200);
    r = await ruf(url, 'POST', '/proj/aendern', { rev: r.j.rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: db }] });
    assert.equal(r.code, 200);
    return slug;
  };
  const b = await lege('Bravo', 'andreas', -30);
  await lege('Alpha', 'cypher', -3);
  return b;
}
const fein = async (p, ms) => { const t0 = Date.now(); while (!p() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 1)); return p(); };

test('V1 Stapel M_stopp: B (Spur 1 von Andreas, −30) öffnen, während der Stopp gilt und die Ausblende von A noch läuft → −30, nicht stumm', async (t) => {
  const { o, url } = await stapel(t);
  const b = await zwei(url);
  const wert = (pfad) => innen(o).stand.regler[pfad];
  assert.ok(await bis(() => wert('spur/1/fader') === -3));
  const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  const ctx = o.bereichKontext();
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  await warte(Math.round(60000 / bpm));
  const beiOeffnen = wert('spur/1/fader');
  const r = await ruf(url, 'POST', '/proj/oeffnen', { slug: b });
  await warte(Math.round(9 * 60000 / bpm));
  const imStopp = wert('spur/1/fader');
  await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
  await warte(Math.round(6 * 60000 / bpm));
  const erg = { bei_oeffnen: beiOeffnen, code: r.code, regler_fehler: r.j?.kern?.regler_fehler?.map((x) => [x.pfad, x.quittung?.grund]),
    ziel_nach_ausblende: r.j?.kern?.ziel_nach_ausblende ?? null, im_stopp: imStopp, kern_ende: wert('spur/1/fader') };
  console.log(`V1 stapel M_stopp ${JSON.stringify(erg)}`);
  assert.ok(beiOeffnen > -120 && beiOeffnen < -3, 'beim Öffnen lief die Ausblende noch');
  assert.equal(r.code, 200);
  assert.deepEqual(erg.regler_fehler, []);
  assert.equal(imStopp, -30, 'im Stopp: Andreas\' Spur auf ihrem Wert');
  assert.equal(erg.kern_ende, -30);
});

for (const zweit of ['kein', 'wartet', 'laeuft', 'frei', 'K_frei']) {
  const name = zweit === 'K_frei' ? 'MK_frei' : `M_${zweit}`;
  test(`V1 Stapel ${name}: B-Spur 1 gehört Andreas (−30)${zweit === 'K_frei' ? ', ohne Rückfahrt (Negativ-Kontrolle)' : ''} → sie endet auf −30, nie stumm ohne Stopp`, async (t) => {
    const { o, url } = await stapel(t);
    const b = await zwei(url);
    const wert = (pfad) => innen(o).stand.regler[pfad];
    assert.ok(await bis(() => wert('spur/1/fader') === -3));
    const bpm = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
    const ctx = o.bereichKontext();
    const s = o.proj.sitzung;
    let ab = null, beiOeffnen = null;
    if (zweit !== 'K_frei') {
      await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
      await warte(Math.round(60000 / bpm));
      await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
      assert.ok(await bis(() => s.rueckfahrt.size > 0, 2000), 'Rückfahrt gesendet (wartet)');
      ab = [...s.rueckfahrt.values()][0].ab;
      await warte(50);
      beiOeffnen = wert('spur/1/fader');
    }
    const r = await ruf(url, 'POST', '/proj/oeffnen', { slug: b });
    if (zweit === 'K_frei') assert.ok(await bis(() => wert('spur/1/fader') === -30, 3000));
    if (zweit === 'wartet' || zweit === 'frei' || zweit === 'K_frei') await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
    if (zweit === 'laeuft') {
      assert.ok(await fein(() => (s.lage.uhr?.beat ?? 0) >= ab + 1, 8000));
      await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
    }
    await warte(Math.round(9 * 60000 / bpm));
    const imStopp = wert('spur/1/fader');
    if (zweit === 'frei' || zweit === 'K_frei') {
      await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
      await warte(Math.round(10 * 60000 / bpm));
    }
    const lage = (await ruf(url, 'GET', '/lage')).j;
    const p = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
    const erg = { bei_oeffnen: beiOeffnen, code: r.code, rueckfahrt_ziel: r.j?.kern?.rueckfahrt_ziel ?? null, ziel_nach_ausblende: r.j?.kern?.ziel_nach_ausblende ?? null,
      regler_fehler: r.j?.kern?.regler_fehler?.map((x) => [x.pfad, x.quittung?.grund]), im_stopp: imStopp, ki_gestoppt_ende: lage.ki?.gestoppt,
      b_spur1: { von: p.spuren[0].von ?? null, fader_db: p.spuren[0].fader_db }, kern_ende: wert('spur/1/fader') };
    console.log(`V1 stapel ${name} ${JSON.stringify(erg)}`);
    assert.equal(r.code, 200);
    if (zweit !== 'K_frei') assert.ok(beiOeffnen > -120 && beiOeffnen < -3, 'beim Öffnen lief die Ausblende noch (sonst wäre der Fall ein anderer)');
    assert.deepEqual(erg.regler_fehler, [], 'kein Regler abgelehnt');
    assert.equal(erg.b_spur1.von, 'andreas');
    assert.equal(erg.b_spur1.fader_db, -30);
    assert.equal(imStopp, -30, 'Stop Cypher senkt Andreas\' Spur nicht');
    assert.equal(erg.kern_ende, -30, 'Andreas\' Spur endet auf ihrem Projektwert');
  });
}
