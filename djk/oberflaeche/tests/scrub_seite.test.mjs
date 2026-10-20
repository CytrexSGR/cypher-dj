// Hörbares Ziehen, Seite (2026-10-17): Drosselung auf ~60 Hz, Schwelle, Lebenszeichen, Los, Rückfall auf den Sprung.
// Uhr und Zeitgeber sind künstlich: der Test läuft ohne Warten.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ScrubZieher, SCRUB_TAKT_MS, SCRUB_LEBENSZEICHEN_MS } from '../oeffentlich/scrub.js';

function bau(antwort = () => true) {
  const gesendet = [];
  const zeit = { t: 0, einmal: [], takt: [] };
  const z = new ScrubZieher({
    senden: async (phase, delta) => { gesendet.push([phase, delta]); return antwort(phase); },
    jetzt: () => zeit.t,
    setzeZeit: (fn, ms) => { const h = { fn, an: zeit.t + ms, aus: false }; zeit.einmal.push(h); return h; },
    loescheZeit: (h) => { h.aus = true; },
    setzeTakt: (fn, ms) => { const h = { fn, ms, naechst: zeit.t + ms, aus: false }; zeit.takt.push(h); return h; },
    loescheTakt: (h) => { h.aus = true; },
  });
  // Uhr vorstellen: löst fällige Zeitgeber aus
  const gehe = async (ms) => {
    const bis = zeit.t + ms;
    for (;;) {
      const kandidaten = [...zeit.einmal.filter((h) => !h.aus).map((h) => ({ h, t: h.an })), ...zeit.takt.filter((h) => !h.aus).map((h) => ({ h, t: h.naechst }))]
        .filter((x) => x.t <= bis).sort((a, b) => a.t - b.t);
      if (!kandidaten.length) break;
      const { h, t } = kandidaten[0];
      zeit.t = t;
      if ('ms' in h) h.naechst += h.ms; else h.aus = true;
      h.fn();
    }
    zeit.t = bis;
    await new Promise((r) => setImmediate(r));
  };
  return { z, gesendet, zeit, gehe };
}

test('kürzer als die Schwelle ist ein Klick: nichts geht an den Kern', async () => {
  const { z, gesendet } = bau();
  z.beginne(true);
  z.bewege(2, 0.1);
  const r = await z.ende(0.1);
  assert.deepEqual(r, { gescrubbt: false, griffOk: false });
  assert.deepEqual(gesendet, []);
});

test('Zug: erst Griff (Strecke 0), dann der Zug, am Ende das Los mit der Endstrecke', async () => {
  const { z, gesendet, zeit, gehe } = bau();
  z.beginne(true);
  zeit.t = 1000;
  assert.equal(z.bewege(10, 0.25), true);
  await gehe(0);
  assert.deepEqual(gesendet, [[1, 0], [2, 0.25]]);
  const r = await z.ende(0.5);
  assert.deepEqual(r, { gescrubbt: true, griffOk: true });
  assert.deepEqual(gesendet.at(-1), [0, 0.5]);
});

test('Drosselung: 200 Bewegungen in 1 s ergeben höchstens ~63 Meldungen, die letzte Strecke geht nicht verloren', async () => {
  const { z, gesendet, zeit, gehe } = bau();
  z.beginne(true);
  zeit.t = 0;
  for (let i = 0; i <= 200; i++) {
    z.bewege(10 + i, 0.01 * i);   // 5 ms Abstand
    await gehe(5);
  }
  await gehe(SCRUB_TAKT_MS + 1);
  const zuege = gesendet.filter(([p]) => p === 2);
  assert.ok(zuege.length <= 66, `zu viele Meldungen: ${zuege.length}`);
  assert.ok(zuege.length >= 55, `zu wenige Meldungen: ${zuege.length}`);   // Gegenprobe: gedrosselt, nicht tot
  assert.equal(zuege.at(-1)[1], 2.0);                                       // der Endstand kam an
  for (let i = 1; i < zuege.length; i++) assert.ok(zuege[i][1] >= zuege[i - 1][1]);   // Reihenfolge
});

test('Hand hält still: Lebenszeichen alle 250 ms mit unveränderter Strecke', async () => {
  const { z, gesendet, gehe } = bau();
  z.beginne(true);
  z.bewege(10, 0.3);
  await gehe(0);
  const n0 = gesendet.length;
  await gehe(SCRUB_LEBENSZEICHEN_MS * 4 + 10);
  const neu = gesendet.slice(n0);
  assert.equal(neu.length, 4);
  assert.ok(neu.every(([p, d]) => p === 2 && d === 0.3));
  await z.ende(0.3);
  const n1 = gesendet.length;
  await gehe(2000);
  assert.equal(gesendet.length, n1, 'nach dem Los keine Lebenszeichen mehr');
});

test('nicht erlaubt (aktiver Loop): kein Ziehen, ende meldet gescrubbt:false, die Seite schickt den Sprung wie bisher', async () => {
  const { z, gesendet } = bau();
  z.beginne(false);
  z.bewege(50, 1);
  const r = await z.ende(1);
  assert.equal(r.gescrubbt, false);
  assert.deepEqual(gesendet, []);
});

test('Griff abgelehnt: kein Los an den Kern, griffOk false → die Seite fällt auf den Sprung zurück', async () => {
  const { z, gesendet, gehe } = bau((phase) => phase !== 1);
  z.beginne(true);
  z.bewege(20, 0.5);
  await gehe(0);
  const r = await z.ende(0.5);
  assert.deepEqual(r, { gescrubbt: true, griffOk: false });
  assert.equal(gesendet.filter(([p]) => p === 0).length, 0);
});

test('Abbruch (pointercancel) löst den Kern, schiebt aber keinen Sprung nach', async () => {
  const { z, gesendet, gehe } = bau();
  z.beginne(true);
  z.bewege(20, 0.5);
  await gehe(0);
  await z.abbruch();
  assert.deepEqual(gesendet.at(-1), [0, 0.5]);
  const n = gesendet.length;
  await gehe(1000);
  assert.equal(gesendet.length, n);
});

test('NaN-Strecke wird nie gesendet', async () => {
  const { z, gesendet } = bau();
  z.beginne(true);
  z.bewege(20, NaN);
  assert.deepEqual(gesendet, []);
});

test('Zeitgeber werden ohne Bindung an den Zieher gerufen (im Browser wirft setInterval mit fremdem this „Illegal invocation“)', async () => {
  const gesehen = [];
  const roh = function (name) { return function (...a) { gesehen.push([name, this === undefined]); return { a }; }; };
  const z = new ScrubZieher({ senden: async () => true, jetzt: () => 0, setzeZeit: roh('setzeZeit'), loescheZeit: roh('loescheZeit'),
    setzeTakt: roh('setzeTakt'), loescheTakt: roh('loescheTakt') });
  z.beginne(true);
  z.bewege(10, 0.1);
  z.bewege(12, 0.2);      // zu früh: Nachlauf-Zeitgeber
  await z.ende(0.2);      // löscht beide
  const namen = gesehen.map(([n]) => n);
  assert.ok(['setzeTakt', 'setzeZeit', 'loescheZeit', 'loescheTakt'].every((n) => namen.includes(n)), namen.join());
  assert.ok(gesehen.every(([, ohne]) => ohne), 'ein Zeitgeber wurde mit this = Zieher gerufen');
});
