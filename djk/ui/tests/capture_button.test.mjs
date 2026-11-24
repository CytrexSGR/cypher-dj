// Journey tours, task 2: the REC MIX header key against a DOM stand-in, a fake server and fake timers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { element } from './support/dom_mock.mjs';
import { bindeMitschnitt, uhrText, RUHE_TEXT } from '../public/capture_button.js';

function aufbau(antworten) {
  const knopf = element('button');
  const aufrufe = [];
  const timer = { intervalle: new Map(), timeouts: new Map(), n: 0 };
  const zeit = {
    setInterval: (f) => { timer.intervalle.set(++timer.n, f); return timer.n; }, clearInterval: (id) => timer.intervalle.delete(id),
    setTimeout: (f, ms) => { timer.timeouts.set(++timer.n, { f, ms }); return timer.n; }, clearTimeout: (id) => timer.timeouts.delete(id),
  };
  let sichtbar = true;
  const ruf = async (methode, pfad, body) => { aufrufe.push(`${methode} ${pfad}`); const a = antworten[`${methode} ${pfad}`]; return typeof a === 'function' ? a(body) : a; };
  const k = bindeMitschnitt({ knopf, ruf, zeit, sichtbar: () => sichtbar });
  const fertig = () => new Promise((ok) => setImmediate(ok));
  return { knopf, aufrufe, timer, k, fertig, setzeSichtbar: (v) => { sichtbar = v; }, taktTick: () => { for (const f of [...timer.intervalle.values()]) f(); }, meldungAblaufen: () => { for (const [id, t] of [...timer.timeouts]) { timer.timeouts.delete(id); t.f(); } } };
}
const STAND_AUS = { code: 200, j: { laeuft: false } };

test('uhrText: minutes and seconds, hours only when needed', () => {
  assert.equal(uhrText(0), '00:00');
  assert.equal(uhrText(754.9), '12:34');
  assert.equal(uhrText(3725), '1:02:05');
  assert.equal(uhrText(undefined), '00:00');
});

test('idle: the key says REC MIX and the first stand poll leaves it so', async () => {
  const a = aufbau({ 'GET /mitschnitt/stand': STAND_AUS });
  await a.fertig();
  assert.equal(a.knopf.textContent, RUHE_TEXT);
  assert.equal(a.knopf.classList.contains('laeuft'), false);
  assert.equal(a.timer.intervalle.size, 0, 'no polling while idle');
});

test('start: the key shows a red dot and the elapsed time from stand, polled once a second while running', async () => {
  let sek = 0;
  const a = aufbau({
    'GET /mitschnitt/stand': () => ({ code: 200, j: sek === 0 ? { laeuft: false } : { laeuft: true, sekunden: sek, datei: '/x/set.wav' } }),
    'POST /mitschnitt/start': { code: 200, j: { ok: true, datei: '/x/set.wav', seit: 'x' } },
  });
  await a.fertig();
  await a.k.klick();
  assert.equal(a.knopf.textContent, '● REC 00:00');
  assert.equal(a.knopf.classList.contains('laeuft'), true);
  assert.equal(a.timer.intervalle.size, 1);
  sek = 754.4;
  a.taktTick(); await a.fertig();
  assert.equal(a.knopf.textContent, '● REC 12:34');
  assert.match(a.knopf.title, /\/x\/set\.wav/);
});

test('a hidden tab does not poll', async () => {
  let abgefragt = 0;
  const a = aufbau({
    'GET /mitschnitt/stand': () => { abgefragt++; return { code: 200, j: { laeuft: true, sekunden: 5, datei: '/x/a.wav' } }; },
  });
  await a.fertig();
  assert.equal(a.knopf.textContent, '● REC 00:05', 'a page that loads during a recording shows it');
  const vorher = abgefragt;
  a.setzeSichtbar(false);
  a.taktTick(); await a.fertig();
  assert.equal(abgefragt, vorher, 'hidden: no request');
  a.setzeSichtbar(true);
  a.taktTick(); await a.fertig();
  assert.equal(abgefragt, vorher + 1);
});

test('stop: one line "Saved: <file name>" with the full path in the title for 10 s, then REC MIX again', async () => {
  let gestoppt = false;
  const a = aufbau({
    'GET /mitschnitt/stand': () => ({ code: 200, j: gestoppt ? { laeuft: false } : { laeuft: true, sekunden: 3, datei: '/home/x/werke/mitschnitte/set-1.wav' } }),
    'POST /mitschnitt/stopp': () => { gestoppt = true; return { code: 200, j: { ok: true, datei: '/home/x/werke/mitschnitte/set-1.wav', sekunden: 12, luecken: 0, spruenge: 0 } }; },
  });
  await a.fertig();
  await a.k.klick();
  assert.equal(a.knopf.textContent, 'Saved: set-1.wav');
  assert.equal(a.knopf.title, '/home/x/werke/mitschnitte/set-1.wav');
  assert.equal(a.knopf.classList.contains('laeuft'), false);
  assert.equal(a.timer.intervalle.size, 0, 'polling stopped');
  const t = [...a.timer.timeouts.values()];
  assert.equal(t.length, 1);
  assert.equal(t[0].ms, 10000);
  // the stand after the stop says idle
  a.meldungAblaufen(); await a.fertig();
  assert.equal(a.knopf.textContent, RUHE_TEXT);
});

test('a refusal shows its reason text in the same place', async () => {
  const a = aufbau({
    'GET /mitschnitt/stand': STAND_AUS,
    'POST /mitschnitt/start': { code: 503, j: { ok: false, grund: 'kern_fehlt', text: 'the audio core is not running, so there is nothing to record; start the studio first', detail: 'ring missing' } },
  });
  await a.fertig();
  await a.k.klick();
  assert.equal(a.knopf.textContent, 'the audio core is not running, so there is nothing to record; start the studio first');
  assert.equal(a.knopf.title, 'ring missing');
  assert.equal(a.knopf.classList.contains('fehler'), true);
  assert.equal(a.knopf.classList.contains('laeuft'), false);
  a.meldungAblaufen(); await a.fertig();
  assert.equal(a.knopf.textContent, RUHE_TEXT);
  assert.equal(a.knopf.classList.contains('fehler'), false);
});

test('a page server that does not answer shows a line, not a thrown error', async () => {
  const a = aufbau({ 'GET /mitschnitt/stand': STAND_AUS, 'POST /mitschnitt/start': () => { throw new Error('x'); } });
  await a.fertig();
  await a.k.klick();
  assert.match(a.knopf.textContent, /did not answer/);
});
