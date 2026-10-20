// D1 S2-Integration, sechste Fix-Runde T2 (Spec 6.37): Ein neuer Stopp beendet auch eine wartende Rückfahrt sicher; die Spur endet stumm, gleich
// in welcher Reihenfolge Abbruch und Start der Rückfahrt den Kern erreichen. Fix5 K1 brach nur ab und nahm an, der Kern blende eine laufende
// Rückfahrt selbst aus. Das gilt nur, wenn sie beim Stopp schon lief: wartet sie beim Stopp noch (Fader −200, ki_fader_ab tut nichts) und
// startet sie, bevor der Abbruch des Servers ankommt, hält der Abbruch den Fader bei etwa −59 dB, mitten im Stopp (Re-Review Fix5 R1,
// probe_rr5_kern R1 4.45/4.60). Deshalb setzt der Server nach der Quittung des Abbruchs −200 nach. Am Kern gemessen
// (fix6/probe_t1_t2_kern.txt T2): ALT 4.45 → −59,306, NEU 4.45 → −200; vor dem Start (4.39) beide −200; mitten in einer laufenden Rückfahrt
// lehnt der Kern das Nachsetzen wegen der eigenen Ausblende ab (ueberlappung), die Ausblende bleibt glatt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sitzung, pruefKontext, warteBis } from './hilfen/proj_kontext.mjs';
import { warte } from './hilfen/proj_stapel.mjs';

const SR = 48000;
const uhr = (s, beat, bpm = 120) => s.ereignis('/uhr', { beat, bpm, sample: Math.round(beat * 60 / bpm * SR) });
const ki = (z, gestoppt, beat, bpm = 120) => { z.k.ki = gestoppt === 1; z.s.ereignis('/e/ki', { gestoppt, grund: gestoppt ? 'ki_stopp' : 'frei', sample: Math.round(beat * 60 / bpm * SR) }); };
const regler = (z, pfad, wert, halter) => z.s.ereignis('/e/regler', { pfad, wert, halter, sample: 0n, beat: 0 });

// Prüf-Kontext, dessen Quittung für /k/abbruch der Test selbst freigibt (Reihenfolge Abbruch gegen Start der Rückfahrt)
function kontextMitAbbruchTor() {
  let frei = null;
  const tor = new Promise((ok) => { frei = ok; });
  const k = pruefKontext({ quittung: (adresse) => (adresse === '/k/abbruch' ? tor.then(() => ({ status: 3, grund: '' })) : { status: 3, grund: '' }) });
  return { k, oeffne: () => frei() };
}
// s1 von andreas, s2 von cypher mit Fader −3
async function einheit(t, kontext) {
  const z = sitzung(t, { arrFristMs: 30 }, kontext);
  await z.s.neu('Frei', 'andreas');
  let r = await z.s.aendern({ rev: 0, label: 'a', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, 'andreas');
  r = await z.s.aendern({ rev: r.j.rev, label: 'c', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'cypher');
  r = await z.s.aendern({ rev: r.j.rev, label: 'f', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -3 }] }, 'andreas');
  return z;
}
const anFader = (z) => z.k.gesendet.filter((x) => x.adresse === '/k/abbruch' || (x.adresse === '/k/teil' && x.felder.pfad === 'spur/2/fader'))
  .map((x) => (x.adresse === '/k/abbruch' ? `abbruch ${x.felder.plan} ${x.felder.teile}` : `teil ${x.felder.nach} ${x.felder.dauer_beats} ${x.felder.quelle}`));

// Stopp bei 100, Freigabe bei 101: die Rückfahrt wartet bis 104. Neuer Stopp bei 103.9, kurz vor ihrem Start.
async function wartendeRueckfahrt(t, kontext) {
  const z = await einheit(t, kontext);
  uhr(z.s, 100); regler(z, 'spur/2/fader', -200, 'frei'); ki(z, 1, 100);
  uhr(z.s, 101); z.k.leere(); ki(z, 0, 101);
  assert.ok(await warteBis(() => z.k.teile(/^spur\/2\/fader$/).length > 0, 1000), 'Rückfahrt gesendet');
  assert.ok(Math.abs(z.k.teile(/^spur\/2\/fader$/)[0].felder.ab_beat - 104) < 1e-6, 'sie wartet bis 104');
  uhr(z.s, 103.9); z.k.leere();
  return z;
}

test('T2 Reihenfolge B: die Rückfahrt startet, bevor der Abbruch ankommt → nach der Quittung des Abbruchs −200 nachgesetzt, nicht vorher', async (t) => {
  const { k, oeffne } = kontextMitAbbruchTor();
  const z = await wartendeRueckfahrt(t, k);
  ki(z, 1, 103.9);
  assert.ok(await warteBis(() => z.k.an('/k/abbruch').length > 0, 1000), 'Abbruch gesendet');
  uhr(z.s, 104.1); regler(z, 'spur/2/fader', -59.3, 'plan:ki_rueck');   // der Kern hat die Rückfahrt gestartet, der Abbruch ist noch unterwegs
  await warte(40);
  const vorQuittung = anFader(z);
  oeffne();
  regler(z, 'spur/2/fader', -59.3, 'andreas');                        // Abbruch: der Fader hält am Ist-Wert
  await warteBis(() => anFader(z).length > 1, 500);
  await warte(30);
  console.log(`T2 B ${JSON.stringify({ vor_quittung: vorQuittung, danach: anFader(z) })}`);
  assert.deepEqual(vorQuittung, ['abbruch ki_rueck 2'], 'vor der Quittung des Abbruchs nichts weiter am Fader');
  assert.deepEqual(anFader(z), ['abbruch ki_rueck 2', 'teil -200 0 andreas'], 'nach dem Abbruch −200 nachgesetzt: die Spur endet stumm');
});

test('T2 Reihenfolge A: der Abbruch kommt vor dem Start an (Fader steht −200) → ebenso −200 nachgesetzt (ohne Wirkung im Kern, kein Ton)', async (t) => {
  const z = await wartendeRueckfahrt(t, pruefKontext());
  ki(z, 1, 103.9);
  assert.ok(await warteBis(() => anFader(z).length > 1, 1000));
  await warte(30);
  console.log(`T2 A ${JSON.stringify({ folge: anFader(z) })}`);
  assert.deepEqual(anFader(z), ['abbruch ki_rueck 2', 'teil -200 0 andreas']);
});

test('T2 Negativ-Kontrollen: Stopp ohne Rückfahrt und Stopp nach ihrem Ende → weder Abbruch noch Nachsetzen; Freigabe vor der Quittung → kein Nachsetzen', async (t) => {
  const z = await einheit(t, pruefKontext());
  uhr(z.s, 50); z.k.leere(); ki(z, 1, 50);
  await warte(60);
  assert.deepEqual(anFader(z), [], 'ohne Rückfahrt: nichts (der Kern blendet aus)');
  ki(z, 0, 51);
  assert.ok(await warteBis(() => z.k.teile(/^spur\/2\/fader$/).length > 0, 1000));
  uhr(z.s, 70); z.k.leere(); ki(z, 1, 70);                            // Rückfahrt 54 bis 58 vorbei
  await warte(60);
  assert.deepEqual(anFader(z), [], 'nach dem Ende der Rückfahrt: nichts');
  const { k, oeffne } = kontextMitAbbruchTor();
  const y = await wartendeRueckfahrt(t, k);
  ki(y, 1, 103.9);
  assert.ok(await warteBis(() => y.k.an('/k/abbruch').length > 0, 1000));
  ki(y, 0, 103.95);                                                    // Freigabe, bevor der Abbruch quittiert ist
  y.k.leere();
  oeffne();
  await warte(60);
  const nachsetzen = y.k.teile(/^spur\/2\/fader$/).filter((x) => x.felder.nach === -200 && x.felder.dauer_beats === 0);
  assert.equal(nachsetzen.length, 0, 'kein Stopp mehr: nicht stumm setzen');
});
