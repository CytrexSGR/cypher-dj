import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { HalloWaechter, KernAnbindung } from '../src/kern.ts';
import { jetztNs } from '../src/zeit.ts';
import { beende, freierUdpPort, starte, warte, type Kind } from './hilfen/prozess.ts';

const ms = 1e6;

// Wächter mit erfundener Zeit: gibt die Zeitpunkte (ms) der hallo zurück.
function lauf(w: HalloWaechter, von: number, bis: number, uhrBis: number, willkommenBei: number[] = []): number[] {
  const hallo: number[] = [];
  for (let t = von; t <= bis; t += 1) {
    if (t < uhrBis && (t % 5) === 0) w.uhr(t * ms);
    if (willkommenBei.includes(t)) w.willkommen(t * ms);
    if (w.schritt(t * ms).hallo) hallo.push(t);
  }
  return hallo;
}

test('Start ohne Kern: hallo sofort, dann alle 50 ms', () => {
  const w = new HalloWaechter();
  assert.deepEqual(lauf(w, 0, 200, 0), [0, 50, 100, 150, 200]);
});

test('Negativ-Kontrolle: laufende Uhr → nur Herzschlag alle 1 500 ms, 60 s lang', () => {
  const w = new HalloWaechter();
  lauf(w, 0, 0, 0);
  w.willkommen(1 * ms);
  const h = lauf(w, 1, 60000, 60001);
  const abstaende = h.slice(1).map((t, i) => t - h[i]);
  assert.equal(h.length, 40); // 1 500, 3 000, …, 60 000 ms
  assert.ok(abstaende.every((a) => a === 1500), JSON.stringify(abstaende));
});

test('Negativ-Kontrolle: eine Uhr-Lücke von 99 ms löst nichts aus', () => {
  const w = new HalloWaechter();
  lauf(w, 0, 0, 0);
  w.willkommen(0);
  const h = lauf(w, 1, 1000, 1001).length;
  for (let t = 1001; t < 1100; t++) w.schritt(t * ms); // 99 ms ohne uhr (letzte bei 1000)
  assert.equal(w.zustand, 'verbunden');
  assert.equal(h, 0);
});

test('Fehlerfall Kern weg: erstes hallo 100 ms nach der letzten /uhr, dann alle 50 ms bis willkommen', () => {
  const w = new HalloWaechter();
  lauf(w, 0, 0, 0);
  w.willkommen(0);
  const h = lauf(w, 1, 10500, 10001, [10330]); // letzte /uhr bei 10 000 ms, willkommen bei 10 330
  assert.deepEqual(h.filter((t) => t > 10000 && t < 10330), [10100, 10150, 10200, 10250, 10300]);
  // willkommen ohne folgende /uhr (Kern antwortet, Callback steht): 100 ms später wieder Suche
  assert.deepEqual(h.filter((t) => t >= 10330), [10430, 10480]);
});

let tg: Kind;
let port: number;
before(async () => {
  port = await freierUdpPort();
  tg = await starte('tests/hilfen/taktgeber.ts', ['--port', String(port)], 'taktgeber:');
});
after(() => beende(tg));

test('gegen den Taktgeber: willkommen, SIGSTOP → hallo nach 100 ms und alle 50 ms, SIGCONT → wieder da', async () => {
  const hallo: number[] = [];
  const zustaende: [string, number][] = [];
  let letzteUhr = 0;
  let uhren = 0;
  const k = new KernAnbindung({ kernPort: port, aboPort: await freierUdpPort(), name: 'test' }, {
    nachricht: (d, t) => { if (d.adresse === '/uhr') { letzteUhr = t; uhren++; } },
    gesendet: (a, _f, t) => { if (a === '/k/hallo') hallo.push(t); },
    zustand: (neu, t) => zustaende.push([neu, t]),
    unlesbar: (g) => assert.fail(g),
  });
  await k.starte();
  await warte(300);
  assert.equal(k.zustand, 'verbunden');
  const vorStopp = hallo.length;
  tg.p.kill('SIGSTOP');
  const stopp = jetztNs();
  await warte(500);
  const uhrVorStopp = letzteUhr;
  tg.p.kill('SIGCONT');
  const weiter = jetztNs();
  const uhrenBeiWeiter = uhren;
  await warte(300);
  await k.stoppe();
  // die Uhr läuft nach SIGCONT wieder (300 ms sind rund 56 Blöcke), der Taktgeber lebt
  assert.ok(uhren - uhrenBeiWeiter >= 40, `${uhren - uhrenBeiWeiter} /uhr nach SIGCONT`);
  assert.equal(tg.p.exitCode, null, tg.err());
  const schnell = hallo.slice(vorStopp).filter((t) => t > stopp && t < weiter);
  const erst = (schnell[0] - uhrVorStopp) / 1e6;
  const abst = schnell.slice(1).map((t, i) => (t - schnell[i]) / 1e6);
  assert.ok(erst >= 100 && erst <= 120, `erstes hallo ${erst} ms nach der letzten /uhr`);
  // im 50-ms-Raster ab dem ersten hallo (±15 ms): ein verspäteter Tick verschiebt nur sein eigenes hallo (F2)
  const raster = schnell.map((t, k) => (t - schnell[0]) / 1e6 - 50 * k);
  assert.ok(raster.every((r) => Math.abs(r) <= 15), `Abstände ${JSON.stringify(abst)}, Rasterfehler ${JSON.stringify(raster)}`);
  assert.ok(schnell.length >= 7 && schnell.length <= 9, `${schnell.length} hallo in 500 ms`);
  assert.deepEqual(zustaende.map(([z]) => z), ['verbunden', 'suche', 'verbunden']);
  assert.ok((zustaende[2][1] - weiter) / 1e6 < 60, 'willkommen kam nach SIGCONT');
});
