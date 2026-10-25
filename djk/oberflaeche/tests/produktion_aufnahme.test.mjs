// 1.8 Task 27: REC-Knopf, Statustext, Arm-Knopf-Zustand (reine Funktionen; Oberfläche englisch).
import test from 'node:test';
import assert from 'node:assert/strict';
import { recText, recKnopf, armZustand, laufEnde, bindeAufnahme } from '../oeffentlich/produktion/aufnahme.js';

test('recText: Zustand des Kerns in Worten', () => {
  assert.deepEqual([0, 2, 3, 4, 9].map((s) => recText({ status: s, luecken: 0 })), ['', 'Waiting for the start', 'Recording', 'Finishing', '']);
  assert.equal(recText({ status: 3, luecken: 2 }), 'Recording · 2 gaps');
});
test('recKnopf: ohne Projekt gesperrt, ohne scharfe Spur gesperrt mit Hinweis, laufend = STOP REC', () => {
  assert.deepEqual(recKnopf({ projekt: null, lauf: null }), { disabled: true, an: false, titel: 'Open a project first', text: '● REC' });
  const p = { spuren: [{ art: 'audio', aufnahme: null }] };
  assert.deepEqual(recKnopf({ projekt: p, lauf: null }), { disabled: true, an: false, titel: 'Arm a track and choose its input first', text: '● REC' });
  const q = { spuren: [{ art: 'audio', aufnahme: { scharf: true, eingang: { art: 'intern', name: 'erz/1' } } }] };
  assert.deepEqual(recKnopf({ projekt: q, lauf: null }), { disabled: false, an: false, titel: 'Record onto the armed tracks', text: '● REC' });
  assert.deepEqual(recKnopf({ projekt: q, lauf: { kennung: 3 } }), { disabled: false, an: true, titel: 'Stop and keep the take', text: '■ STOP REC' });
});
test('laufEnde (Nachbesserung 1, M2): der Kern meldet das Ende eines Takes (Status 2 bis 4 auf 0), auch wenn der Transport anders gestoppt wurde', () => {
  for (const vorher of [2, 3, 4]) assert.equal(laufEnde(vorher, 0), true, `von ${vorher}`);
  assert.equal(laufEnde(0, 0), false);   // Negativ-Kontrollen: kein Wechsel, Wechsel nach oben, Wechsel zwischen zwei Aufnahme-Zuständen
  assert.equal(laufEnde(0, 2), false);
  assert.equal(laufEnde(3, 4), false);
});
test('armZustand: Audio-Spur zeigt Arm und Eingang; Instrument-Spur nichts; Arm erst mit Eingang', () => {
  assert.deepEqual(armZustand({ art: 'instrument' }), { sichtbar: false, scharf: false, eingang: '', armSperre: true });
  assert.deepEqual(armZustand({ art: 'audio' }), { sichtbar: true, scharf: false, eingang: '', armSperre: true });
  assert.deepEqual(armZustand({ art: 'audio', aufnahme: { scharf: false, eingang: { art: 'intern', name: 'erz/2' } } }), { sichtbar: true, scharf: false, eingang: 'erz/2', armSperre: false });
  assert.deepEqual(armZustand({ art: 'audio', aufnahme: { scharf: true, eingang: { art: 'intern', name: 'erz/2' } } }).scharf, true);
});

// Binder (Review-Nachzug Task 27): Attrappen-Kontext statt Browser; takt 20 ms statt 500 ms
const warten = (ms) => new Promise((ok) => setTimeout(ok, ms));
function baue({ holeGet, holeJson } = {}) {
  const mk = () => ({ textContent: '', disabled: false, title: '', classList: { toggle() {} }, setAttribute() {}, onclick: null, addEventListener(n, f) { if (n === 'click') this.onclick = f; } });
  const els = { rec: mk(), 'rec-status': mk() }, tasten = [];
  globalThis.document = { addEventListener: (n, f) => { if (n === 'keydown') tasten.push(f); } };
  const z = { gets: 0, posts: [], meldungen: [], geladen: 0 };
  const ctx = {
    st: { projekt: { spuren: [{ art: 'audio', aufnahme: { scharf: true, eingang: { art: 'intern', name: 'erz/1' } } }] }, start: 0, sichtbar: true },
    $: (n) => els[n], takt: 20,
    holeGet: async () => { z.gets++; return holeGet(z); },
    holeJson: async (w, k) => { z.posts.push(k.aktion); return holeJson(z, k); },
    melde: (t, fehler) => z.meldungen.push([t, !!fehler]), antwortText: (r) => r.j.fehler, ladeAktuell: async () => { z.geladen++; },
    beimProjekt: [], beimEreignis: [], beimSichtwechsel: [],
  };
  bindeAufnahme(ctx);
  const ereignis = (status) => ctx.beimEreignis.forEach((f) => f('/zustand/rec', { status, luecken: 0 }));
  const taste = (e) => tasten[0]({ key: 'r', repeat: false, target: { tagName: 'BODY' }, ...e });
  return { els, z, ereignis, taste };
}

test('Binder, fremde Aufnahme (Cypher über MCP): der Server setzt den Lauf erst nach dem Kern-Status 2; der Knopf zieht nach, bis der Lauf da ist', async () => {
  let lauf = null;
  const b = baue({ holeGet: () => ({ status: 200, j: { lauf, letzte: null } }), holeJson: () => ({ status: 200, j: {} }) });
  await warten(5);
  assert.equal(b.els.rec.textContent, '● REC');
  b.ereignis(2);                       // der Kern meldet, der Server hat noch keinen Lauf (lauf null)
  await warten(30);
  assert.equal(b.els.rec.textContent, '● REC', 'noch kein Lauf: Knopf bleibt');
  lauf = { kennung: 5 };               // der Server hat nachgezogen
  await warten(60);
  assert.equal(b.els.rec.textContent, '■ STOP REC');
});
test('Binder, eigener Start: Status 2 während des eigenen POST löst keine zweite Abfrage aus', async () => {
  let lauf = null;
  const b = baue({ holeGet: () => ({ status: 200, j: { lauf, letzte: null } }),
    holeJson: async () => { await warten(80); lauf = { kennung: 1 }; return { status: 200, j: {} }; } });
  await warten(5);
  const vor = b.z.gets;
  const klick = b.els.rec.onclick();
  await warten(10); b.ereignis(2); await warten(30);   // mitten im POST
  assert.equal(b.z.gets, vor, 'keine Abfrage während des eigenen Wechsels');
  await klick;
  assert.equal(b.els.rec.textContent, '■ STOP REC');
});
test('Binder, Ende ohne STOP REC (M2): nachLaufEnde wartet auf das Ergebnis, meldet den Take, lädt neu, Knopf zurück auf REC', async () => {
  let lauf = { kennung: 2 }, polls = 0;
  const b = baue({ holeGet: () => { if (lauf && ++polls > 3 && b.z.beendet) lauf = null; return { status: 200, j: { lauf, letzte: lauf ? null : { takes: [{ frames: 100 }] } } }; }, holeJson: () => ({ status: 200, j: {} }) });
  await warten(5);
  assert.equal(b.els.rec.textContent, '■ STOP REC');
  b.ereignis(3);
  b.z.beendet = true; b.ereignis(0);   // der Transport endete anders: kein Klick, kein POST
  await warten(200);
  assert.deepEqual(b.z.meldungen, [['Take saved', false]]);
  assert.equal(b.z.geladen, 1);
  assert.equal(b.els.rec.textContent, '● REC');
  assert.deepEqual(b.z.posts, []);
});
test('Binder, eigenes STOP REC: das Status-0 danach startet nachLaufEnde nicht noch einmal (keine zweite Meldung, kein zweites Laden)', async () => {
  let lauf = { kennung: 3 };
  const b = baue({ holeGet: () => ({ status: 200, j: { lauf, letzte: null } }),
    holeJson: async (z, k) => { if (k.aktion === 'stopp') { await warten(40); lauf = null; return { status: 200, j: { takes: [] } }; } return { status: 200, j: {} }; } });
  await warten(5);
  b.ereignis(3);
  const klick = b.els.rec.onclick();
  await warten(10); b.ereignis(0);     // der Kern meldet das Ende, während der eigene Stopp noch läuft
  await klick; await warten(60);
  assert.deepEqual(b.z.meldungen, [['Take saved', false]]);
  assert.equal(b.z.geladen, 1);
});
test('Binder, Doppelklick und gehaltene Taste: genau ein Wechsel, kein zweiter POST', async () => {
  let lauf = null;
  const b = baue({ holeGet: () => ({ status: 200, j: { lauf, letzte: null } }),
    holeJson: async (z, k) => { await warten(40); if (k.aktion === 'start') { if (lauf) return { status: 409, j: { fehler: 'aufnahme_laeuft' } }; lauf = { kennung: 1 }; } else lauf = null; return { status: 200, j: { takes: [] } }; } });
  await warten(5);
  await Promise.all([b.els.rec.onclick(), b.els.rec.onclick()]);
  assert.deepEqual(b.z.posts, ['start']);
  assert.deepEqual(b.z.meldungen, []);
  b.z.posts.length = 0;
  b.taste({}); b.taste({ repeat: true });   // Taste r, dann Autorepeat, während der Wechsel läuft
  await warten(100);
  assert.deepEqual(b.z.posts, ['stopp']);
  await warten(100);                   // der Stopp ist fertig, der Knopf steht wieder auf REC
  assert.equal(b.els.rec.textContent, '● REC');
  await b.taste({ repeat: true });     // Autorepeat nach Ende des Wechsels: auch das ist kein Tastendruck
  assert.deepEqual(b.z.posts, ['stopp']);
});
