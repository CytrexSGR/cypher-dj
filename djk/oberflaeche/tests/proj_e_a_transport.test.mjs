// Paket 1.18, Entscheidung E-a, Transport (Andreas 2026-10-20: „stop cypher sollte nicht alles stoppen weil ich ja übernehme, du solltest dann nur nicht
// mehr eingreifen“; Spec E-a: „Was klingt, klingt weiter, denn Andreas übernimmt es.“). Auch ein LAUFENDER Transport (status 2), den Cypher selbst gestartet
// hat, läuft beim KI-Stopp weiter (vorher D1 Spec 6.37: Stop Cypher stoppte ihn, kiStoppTransport sendete /k/arr/stopp als andreas). Er gehört ab dem
// Stopp Andreas: Cypher bedient ihn danach nicht mehr, im Stopp nicht (409 ki_gestoppt, der Riegel), nach der Freigabe nicht (409 transport_laeuft), bis
// Andreas ihn stoppt. Zweiter Weg, falls /e/ki verloren geht: das periodische /zustand/kern (ki_gestoppt), das schon den Riegel des Servers nachführt.
// Anders ein noch WARTENDER Start von Cypher (status 1, Einsatz am Takt, noch kein Klang; Entscheidung von Cypher 2026-10-20, Andreas kann umstellen):
// ihn verwirft der Kern beim KI-Stopp wie bisher (Quittung 7 ki_stopp, wie wartende Deck-Befehle von Cypher), ein Start nach dem Knopf wäre ein
// Eingriff nach dem Stopp. Der Server sendet auch dafür nichts; nach dem Verwerfen meldet der Kern status 0, und nichts ist mehr gesperrt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sitzung, arrNr, pruefKontext } from './hilfen/proj_kontext.mjs';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { bis, ruf, CYPHER, warte, anKern } from './hilfen/proj_stapel.mjs';

const arr = (nr, status) => ({ ...arrNr(nr), status });
const fehlerVon = async (p) => { try { await p; } catch (e) { return e; } return null; };
async function einheit(t, status) {
  const z = sitzung(t, { arrFristMs: 30 });
  await z.s.neu('E', 'andreas');
  const nr = z.s.aktuell().j.projekt.wiedergabe_rev;
  await z.s.transport({ aktion: 'start' }, 'cypher');
  z.s.ereignis('/zustand/arr', arr(nr, status));
  z.k.leere();
  return { ...z, nr };
}
const stopps = (z) => z.k.an('/k/arr/stopp').map((x) => x.felder.quelle);
const gesperrt = async (z, aktion, quelle = 'cypher') => { const e = await fehlerVon(z.s.transport({ aktion }, quelle)); return [e?.code, e?.fehler]; };

test('E-a Transport Einheit: Cyphers LAUFENDER Transport (status 2), Stop Cypher (/e/ki) stoppt nichts; er gehört Andreas: im Stopp 409 ki_gestoppt, danach 409 transport_laeuft', async (t) => {
  const z = await einheit(t, 2);
  z.k.ki = true; z.s.ereignis('/e/ki', { gestoppt: 1, grund: 'hand', sample: 0n });
  await warte(60);
  assert.deepEqual(stopps(z), [], 'kein /k/arr/stopp: der Transport läuft weiter');
  assert.deepEqual(await gesperrt(z, 'stopp'), [409, 'ki_gestoppt'], 'im Stopp: der Riegel');
  assert.deepEqual(await gesperrt(z, 'start'), [409, 'ki_gestoppt']);
  z.k.ki = false; z.s.ereignis('/e/ki', { gestoppt: 0, grund: 'frei', sample: 0n });
  assert.deepEqual(await gesperrt(z, 'stopp'), [409, 'transport_laeuft'], 'nach der Freigabe: der Lauf gehört Andreas');
  assert.deepEqual(await gesperrt(z, 'start'), [409, 'transport_laeuft']);
  const eo = await fehlerVon(z.s.neu('Anderes', 'cypher'));
  assert.deepEqual([eo?.code, eo?.fehler], [409, 'transport_laeuft'], 'Anlegen (und Öffnen) ebenso: nichts wird gestoppt, nichts angelegt');
  assert.deepEqual(stopps(z), [], 'weiterhin nichts gesendet');
  assert.equal((await z.s.transport({ aktion: 'stopp' }, 'andreas')).j.ok, true, 'Andreas stoppt wie immer');
  assert.deepEqual(stopps(z), ['andreas']);
});

test('E-a Transport Einheit: Cyphers WARTENDER Start (status 1): der Server sendet nichts; verwirft der Kern ihn (status 0), ist nach der Freigabe nichts gesperrt', async (t) => {
  const z = await einheit(t, 1);
  z.k.ki = true; z.s.ereignis('/e/ki', { gestoppt: 1, grund: 'hand', sample: 0n });
  await warte(60);
  assert.deepEqual(stopps(z), [], 'der Server stoppt nicht: das Verwerfen ist Sache des Kerns (Quittung 7 ki_stopp)');
  assert.deepEqual(await gesperrt(z, 'start'), [409, 'ki_gestoppt'], 'im Stopp: der Riegel');
  z.s.ereignis('/zustand/arr', arr(z.nr, 0));                    // der Kern hat den Start verworfen
  z.k.ki = false; z.s.ereignis('/e/ki', { gestoppt: 0, grund: 'frei', sample: 0n });
  assert.deepEqual(await gesperrt(z, 'stopp'), [undefined, undefined], 'nach der Freigabe: kein Lauf, nichts gesperrt');
  assert.deepEqual(await gesperrt(z, 'start'), [undefined, undefined], 'Cypher darf neu starten');
});

test('E-a Transport Einheit: geht /e/ki verloren, führt das periodische /zustand/kern (ki_gestoppt) die Übergabe nach', async (t) => {
  const z = await einheit(t, 2);
  z.k.ki = true; z.s.ereignis('/zustand/kern', { ki_gestoppt: 1 });
  await warte(60);
  assert.deepEqual(stopps(z), []);
  z.k.ki = false;
  assert.deepEqual(await gesperrt(z, 'stopp'), [409, 'transport_laeuft'], 'auch ohne /e/ki gehört der Lauf Andreas');
});

test('E-a Transport Einheit, Negativ-Kontrolle: ohne Stop Cypher bleibt ein Transport Cyphers eigener (Stopp geht durch); /zustand/kern mit ki_gestoppt 0 ändert nichts', async (t) => {
  const z = await einheit(t, 2);
  z.s.ereignis('/zustand/kern', { ki_gestoppt: 0 });
  assert.equal((await z.s.transport({ aktion: 'stopp' }, 'cypher')).j.ok, true, 'Cyphers Stopp über ihren eigenen Lauf');
  assert.deepEqual(stopps(z), ['cypher']);
});

test('E-a Transport Stapel: Cypher startet (läuft), Stop Cypher, Freigabe: der Transport läuft durch; Cypher ist gesperrt, Andreas stoppt; ein zweiter Lauf Cyphers ebenso', async (t) => {
  const { o, url } = await stapel(t);
  await ruf(url, 'POST', '/proj/neu', { name: 'E' });
  await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'c', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, CYPHER);
  let status = null;
  const alt = o.vomKern.bind(o);
  o.vomKern = (d) => { if (d.adresse === '/zustand/arr') status = Number(d.felder.status); alt(d); };
  const ctx = o.bereichKontext();
  const lauf = async (runde) => {
    assert.equal((await ruf(url, 'POST', '/proj/transport', { aktion: 'start' }, CYPHER)).code, 200, `Runde ${runde}: Cypher startet`);
    assert.ok(await bis(() => status === 2, 3000), `Runde ${runde}: Cyphers Transport läuft`);
    await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
    await warte(1500);                                           // länger als jede Rückmeldung des Kerns
    assert.equal(status, 2, `Runde ${runde}: Stop Cypher stoppt den Transport nicht`);
    let r = await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
    assert.deepEqual([r.code, r.j.fehler], [409, 'ki_gestoppt']);
    await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
    await warte(300);
    r = await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
    assert.deepEqual([r.code, r.j.fehler], [409, 'transport_laeuft'], `Runde ${runde}: nach der Freigabe gehört er Andreas`);
    assert.equal(status, 2);
    assert.equal((await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' })).code, 200, 'Andreas stoppt');
    assert.ok(await bis(() => status === 0, 2000), `Runde ${runde}: Andreas\' Stopp wirkt`);
  };
  await lauf(1);
  await lauf(2);                                                 // danach darf Cypher wieder starten, und der neue Lauf ist wieder übergabefähig
});

test('E-a Transport Stapel, wartender Start: Stop Cypher im Wartefenster verwirft Cyphers Start (Kern 7 ki_stopp, status 0, nie 2); nach der Freigabe startet sie neu', async (t) => {
  const { o, url } = await stapel(t);
  const ctx = o.bereichKontext();
  await ruf(url, 'POST', '/proj/neu', { name: 'W' });
  await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'c', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, CYPHER);
  const gesehen = [];
  const alt = o.vomKern.bind(o);
  o.vomKern = (d) => { if (d.adresse === '/zustand/arr') gesehen.push(Number(d.felder.status)); alt(d); };
  const status = () => gesehen.at(-1);
  // ein Deck spielt (Kern-Meldung): der Server startet mit quant 2, der Kern wartet bis zur nächsten Takt-Eins
  innen(o).vomKern('/zustand/deck', { deck: 1, status: 2, material_id: 'x', basis_bpm: 128, fassung: 1, quell_beat: 0, beats_bis_ende: 64, faktor: 1, vorlauf_ms: 0 });
  const lauf = ruf(url, 'POST', '/proj/transport', { aktion: 'start' }, CYPHER);
  assert.ok(await bis(() => status() === 1, 3000), 'Positiv-Kontrolle: Cyphers Start wartet auf den Takt (status 1)');
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  const r = await lauf;
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.ok, r.j.quant, r.j.quittung?.status, r.j.quittung?.grund], [false, 2, 7, 'ki_stopp'], 'der Kern verwirft den wartenden Start: 7 ki_stopp');
  assert.ok(await bis(() => status() === 0, 2000), 'der Kern meldet status 0');
  await warte(2500);                                             // länger als das Wartefenster (rund 1,9 s bis zum Takt): der Start setzt nie ein
  assert.ok(!gesehen.includes(2), `nie status 2 gesehen (${[...new Set(gesehen)]})`);
  await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
  await warte(300);
  const neu = await ruf(url, 'POST', '/proj/transport', { aktion: 'start' }, CYPHER);
  assert.deepEqual([neu.code, neu.j.ok], [200, true], 'nach der Freigabe nichts gesperrt: Cypher startet neu');
  assert.ok(await bis(() => status() === 2, 4000), 'und der neue Lauf klingt');
  assert.equal((await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' }, CYPHER)).code, 200, 'es ist wieder ihr Lauf: ihr Stopp geht durch');
});

// Dritte Wartephase (Entscheidung von Cypher 2026-10-20, Andreas kann umstellen): weicht das Master-Tempo vom Projekttempo ab, wartet Cyphers Start in tempoVorStart auf die
// Tempo-Rampe (ab dem nächsten Takt, über 4 Beats). Fällt Stop Cypher in dieses Fenster, beendet der Kern Cyphers Rampe mit 7 ki_stopp. Dann bekommt Cypher dieselbe Antwort
// wie beim verworfenen wartenden Start (200, ok false, Quittung 7 ki_stopp), nicht 409 tempo_abgelehnt (die Werkzeugbeschreibung von proj_transport verspricht ok false, 7 ki_stopp).
// Jede andere Ablehnung der Rampe bleibt 409 tempo_abgelehnt.
test('E-a Transport Einheit, Tempo-Rampe: Quittung 7 ki_stopp der Rampe gibt 200 {ok false, 7 ki_stopp} und sendet keinen Start; jede andere Ablehnung bleibt 409 tempo_abgelehnt', async (t) => {
  const mit = (quittung) => { const k = pruefKontext({ quittung: (adresse) => (adresse === '/k/tempo/rampe' ? quittung : { status: 3, grund: '' }) }); return sitzung(t, { arrFristMs: 30 }, k); };
  const z = mit({ status: 7, grund: 'ki_stopp' });
  await z.s.neu('T', 'andreas');
  z.s.ereignis('/uhr', { beat: 0, bpm: 130 });                   // Master 130, Projekt 120: Rampe vor dem Start
  z.k.leere();
  const r = await z.s.transport({ aktion: 'start' }, 'cypher');
  assert.equal(z.k.an('/k/tempo/rampe').length, 1, 'Positiv-Kontrolle: die Rampe wurde gesendet');
  assert.equal(r.code, 200);
  assert.deepEqual([r.j.ok, r.j.quittung], [false, { status: 7, grund: 'ki_stopp' }]);
  assert.deepEqual([r.j.tempo.gesetzt, r.j.tempo.fehler], [false, 'tempo_abgelehnt'], 'das tempo-Objekt bleibt in der Antwort');
  assert.deepEqual(z.k.an('/k/arr/start'), [], 'kein Start an den Kern');
  assert.deepEqual(await gesperrt(z, 'stopp'), [undefined, undefined], 'nichts übergeben, nichts gesperrt: Cyphers Stopp geht durch');
  // Negativ-Kontrolle: eine andere Ablehnung der Rampe (6 ueberlappung) bleibt 409 tempo_abgelehnt, es geht kein Start hinaus
  const y = mit({ status: 6, grund: 'ueberlappung' });
  await y.s.neu('T', 'andreas');
  y.s.ereignis('/uhr', { beat: 0, bpm: 130 });
  y.k.leere();
  const e = await fehlerVon(y.s.transport({ aktion: 'start' }, 'cypher'));
  assert.deepEqual([e?.code, e?.fehler], [409, 'tempo_abgelehnt']);
  assert.equal(y.k.an('/k/tempo/rampe').length, 1);
  assert.deepEqual(y.k.an('/k/arr/start'), []);
});

test('E-a Transport Stapel, Tempo-Rampe: Stop Cypher im Rampenfenster gibt 200 {ok false, 7 ki_stopp}, der Kern bekommt keinen Start; nach der Freigabe startet Cypher neu (mit Rampe) und der Lauf ist ihr eigener', async (t) => {
  const { o, log, url } = await stapel(t);
  const ctx = o.bereichKontext();
  await ruf(url, 'POST', '/proj/neu', { name: 'R' });             // Projekttempo 120 (Vorgabe), die Uhr der Attrappe steht auf 128: der Start wartet auf die Rampe
  const master = (await ruf(url, 'GET', '/lage')).j.uhr.bpm;
  assert.notEqual(master, 120, 'Positiv-Kontrolle: das Master-Tempo weicht vom Projekttempo ab');
  const gesehen = [];
  const alt = o.vomKern.bind(o);
  o.vomKern = (d) => { if (d.adresse === '/zustand/arr') gesehen.push(Number(d.felder.status)); alt(d); };
  // Die Rampe beginnt am nächsten Takt: mitten im ersten Drittel eines Takts anfangen (Beat 1 bis 1,8 im Takt), dann ist das Fenster auch bei einer
  // veralteten Uhr des Servers noch rund zwei Beats offen
  assert.ok(await bis(() => { const b = (o.kern.uhr?.beat ?? 0) % 4; return b > 1 && b < 1.8; }, 6000), 'Positiv-Kontrolle: Beat 1 bis 1,8 im Takt');
  const lauf = ruf(url, 'POST', '/proj/transport', { aktion: 'start' }, CYPHER);
  assert.ok(await bis(() => anKern(log, '/k/tempo/rampe').length === 1, 3000), 'Positiv-Kontrolle: die Rampe ist beim Kern, der Start wartet darauf');
  assert.equal(anKern(log, '/k/tempo/rampe')[0].felder.quelle, 'cypher', 'es ist Cyphers Rampe');
  await ctx.warteQuittung(ctx.sende('/k/ki/stopp', { quelle: 'andreas' }));
  const r = await lauf;
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.ok, r.j.quittung?.status, r.j.quittung?.grund], [false, 7, 'ki_stopp'], JSON.stringify(r.j));
  assert.equal(r.j.tempo?.fehler, 'tempo_abgelehnt');
  assert.equal(anKern(log, '/k/arr/start').length, 0, 'kein Start beim Kern');
  await warte(2500);                                             // länger als das Fenster bis zum Takt: es setzt nichts mehr ein
  assert.ok(!gesehen.some((s) => s !== 0), `der Transport war nie wartend oder laufend (${[...new Set(gesehen)]})`);
  await ctx.warteQuittung(ctx.sende('/k/ki/frei', { quelle: 'andreas' }));
  await warte(300);
  const neu = await ruf(url, 'POST', '/proj/transport', { aktion: 'start' }, CYPHER);
  assert.deepEqual([neu.code, neu.j.ok, neu.j.tempo?.gesetzt], [200, true, true], `nach der Freigabe nichts gesperrt: Cypher startet neu, mit Rampe (${JSON.stringify(neu.j)})`);
  assert.ok(await bis(() => gesehen.at(-1) === 2, 4000), 'und der neue Lauf klingt');
  assert.equal((await ruf(url, 'POST', '/proj/transport', { aktion: 'stopp' }, CYPHER)).code, 200, 'es ist ihr Lauf: ihr Stopp geht durch');
});

// Review 9a (2026-10-20): fällt Stop Cypher in die schon LAUFENDE Tempo-Rampe (Quittung 2 ist da, der Start wartet auf ihr Ende), darf danach kein Start
// mehr hinausgehen. Antwort wie beim verworfenen wartenden Start (200, ok false, 7 ki_stopp); vorher lief tempoVorStart bis zum Rampenende weiter, der Server
// sendete Cyphers Start nach dem Stopp, und der Kern lehnte mit 6 ki_gestoppt ab.
test('E-a Transport Einheit, laufende Tempo-Rampe: Stop Cypher während der Rampe gibt 200 {ok false, 7 ki_stopp} und sendet keinen Start; ohne Stopp geht der Start hinaus', async (t) => {
  const mit = () => { const k = pruefKontext({ quittung: (adresse) => (adresse === '/k/tempo/rampe' ? { status: 2, grund: '' } : { status: 3, grund: '' }) }); return sitzung(t, { arrFristMs: 30 }, k); };
  const z = mit();
  await z.s.neu('T', 'andreas');
  z.s.ereignis('/uhr', { beat: 0, bpm: 130 });
  z.k.leere();
  const lauf = z.s.transport({ aktion: 'start' }, 'cypher');
  await warte(60);
  assert.equal(z.k.an('/k/tempo/rampe').length, 1, 'Positiv-Kontrolle: die Rampe ist angenommen, der Start wartet auf ihr Ende');
  z.k.ki = true;                                                 // Stop Cypher mitten in der Rampe
  z.s.ereignis('/uhr', { beat: 20, bpm: 120 });                  // die Rampe ist vorbei
  const r = await lauf;
  assert.equal(r.code, 200);
  assert.deepEqual([r.j.ok, r.j.quittung?.status, r.j.quittung?.grund], [false, 7, 'ki_stopp'], JSON.stringify(r.j));
  assert.deepEqual(z.k.an('/k/arr/start'), [], 'kein Start an den Kern');
  // Negativ-Kontrolle: dieselbe Rampe ohne Stop Cypher, der Start geht hinaus
  const y = mit();
  await y.s.neu('T', 'andreas');
  y.s.ereignis('/uhr', { beat: 0, bpm: 130 });
  y.k.leere();
  const lauf2 = y.s.transport({ aktion: 'start' }, 'cypher');
  await warte(60);
  y.s.ereignis('/uhr', { beat: 20, bpm: 120 });
  const r2 = await lauf2;
  assert.deepEqual([r2.code, r2.j.ok], [200, true], JSON.stringify(r2.j));
  assert.equal(y.k.an('/k/arr/start').length, 1);
});
