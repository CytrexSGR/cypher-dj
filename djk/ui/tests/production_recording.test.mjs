// 1.8 Task 27: REC-Knopf, Statustext, Arm-Knopf-Zustand (reine Funktionen; Oberfläche englisch).
import test from 'node:test';
import assert from 'node:assert/strict';
import { recText, recKnopf, armZustand, laufEnde, bindeAufnahme, eingangWert, eingangVonWert, eingangsOptionen, MODUS_OPTIONEN, MONITOR_OPTIONEN,
  VORZAEHLER_OPTIONEN, aufnahmeStand, vorzaehlerBefehl, punchBefehl, schalterBefehl, punchBand } from '../public/production/recording.js';

test('recText: Zustand des Kerns in Worten', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map((s) => recText({ status: s, luecken: 0 })), ['', 'Counting in', 'Waiting for the start', 'Recording', 'Finishing', '']);
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
test('armZustand: Audio-Spur zeigt Arm und Eingang; Instrument-Spur seit 1.8 T8 auch (MIDI in); Arm erst mit Eingang', () => {
  assert.deepEqual(armZustand({ art: 'instrument' }), { sichtbar: true, scharf: false, eingang: '', modus: 'stereo', modusSichtbar: false, armSperre: true, monitor: 'auto', monitorSichtbar: false, eingangKanal: '' });
  assert.deepEqual(armZustand({ art: 'audio' }), { sichtbar: true, scharf: false, eingang: '', modus: 'stereo', modusSichtbar: false, armSperre: true, monitor: 'auto', monitorSichtbar: false, eingangKanal: '' });
  assert.deepEqual(armZustand({ art: 'audio', aufnahme: { scharf: false, eingang: { art: 'intern', name: 'erz/2' } } }),
    { sichtbar: true, scharf: false, eingang: 'erz/2', modus: 'stereo', modusSichtbar: false, armSperre: false, monitor: 'auto', monitorSichtbar: false, eingangKanal: '' });
  assert.deepEqual(armZustand({ art: 'audio', aufnahme: { scharf: true, eingang: { art: 'intern', name: 'erz/2' } } }).scharf, true);
});

// 1.8 T8: instrument tracks arm on midi_ein_1 ("MIDI in"); the select offers exactly that, the REC button counts an armed instrument track
test('T8 page: an instrument track shows arm and the MIDI in input; arming needs the input; no mode, monitor or level bar (those belong to external audio inputs)', () => {
  const keys = (aufnahme) => ({ art: 'instrument', ...(aufnahme ? { aufnahme } : {}) });
  assert.deepEqual(armZustand(keys()), { sichtbar: true, scharf: false, eingang: '', modus: 'stereo', modusSichtbar: false, armSperre: true, monitor: 'auto', monitorSichtbar: false, eingangKanal: '' });
  assert.deepEqual(armZustand(keys({ scharf: false, eingang: { art: 'midi' } })),
    { sichtbar: true, scharf: false, eingang: 'midi/1', modus: 'stereo', modusSichtbar: false, armSperre: false, monitor: 'auto', monitorSichtbar: false, eingangKanal: '' });
  assert.equal(armZustand(keys({ scharf: true, eingang: { art: 'midi' } })).scharf, true);
  assert.equal(armZustand({ art: 'audio', aufnahme: { scharf: true, eingang: { art: 'intern', name: 'erz/1' } } }).eingang, 'erz/1', 'audio is unchanged (negative control)');
});
test('T8 page: eingangWert / eingangVonWert round-trip midi_ein_1 as midi/1; the select of an instrument track lists MIDI in and nothing else, also with devices', () => {
  assert.equal(eingangWert({ art: 'midi' }), 'midi/1');
  assert.deepEqual(eingangVonWert('midi/1'), { art: 'midi' });
  assert.deepEqual(eingangVonWert('midi/1', 'links'), { art: 'midi' }, 'a mode never rides along');
  assert.deepEqual(eingangVonWert('erz/1'), { art: 'intern', name: 'erz/1' }, 'audio values are as before');
  const geraete = { eingaenge: [{ k: 1, name: 'Mic', audio: { knoten: 'n', ports: ['p'] } }] };
  assert.deepEqual(eingangsOptionen(geraete, [{ wert: 'erz/1', text: 'Strudel' }], '', 'instrument'), [{ wert: 'midi/1', text: 'MIDI in' }]);
  assert.deepEqual(eingangsOptionen(geraete, [{ wert: 'erz/1', text: 'Strudel' }], '', 'audio').map((o) => o.wert), ['ein/1', 'erz/1'], 'audio list unchanged');
  assert.deepEqual(eingangsOptionen(geraete, [{ wert: 'erz/1', text: 'Strudel' }]).map((o) => o.wert), ['ein/1', 'erz/1'], 'the art defaults to audio');
});
test('T8 page: REC is enabled by an armed instrument track alone; an instrument track that is not armed or has no input does not enable it', () => {
  const p = (...spuren) => ({ spuren });
  const keys = (scharf, eingang) => ({ art: 'instrument', aufnahme: { scharf, eingang } });
  assert.equal(recKnopf({ projekt: p(keys(true, { art: 'midi' })), lauf: false }).disabled, false);
  assert.equal(recKnopf({ projekt: p(keys(false, { art: 'midi' })), lauf: false }).disabled, true);
  assert.equal(recKnopf({ projekt: p({ art: 'instrument' }), lauf: false }).disabled, true);
  assert.equal(recKnopf({ projekt: p({ art: 'audio' }), lauf: false }).disabled, true, 'audio without arm: as before');
});

// Binder (Review-Nachzug Task 27): Attrappen-Kontext statt Browser; takt 20 ms statt 500 ms
const warten = (ms) => new Promise((ok) => setTimeout(ok, ms));
function baue({ holeGet, holeJson } = {}) {
  const mk = () => ({ textContent: '', disabled: false, title: '', classList: { toggle() {} }, setAttribute() {}, onclick: null, addEventListener(n, f) { if (n === 'click') this.onclick = f; } });
  const els = { rec: mk(), 'rec-status': mk(), vorzaehler: mk(), 'punch-ein': mk(), 'punch-aus': mk(), overdub: mk(), 'punch-von': mk(), 'punch-bis': mk() }, tasten = [];
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
  const b = baue({ holeGet: () => { if (lauf && ++polls > 3 && b.z.beendet) lauf = null; return { status: 200, j: { lauf, letzte: lauf ? null : { kennung: 2, takes: [{ frames: 100 }] } } }; }, holeJson: () => ({ status: 200, j: {} }) });
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

// 1.8 S2b.3: external inputs in the track head
test('S2b.3 eingangsOptionen: the pairs with a device (their names) stand above the internal channels; a pair without a device is not offered', () => {
  const intern = [{ wert: 'erz/1', text: 'erz/1' }, { wert: 'pad/1', text: 'pad/1 (L1)' }];
  const g = { eingaenge: [{ k: 1, name: 'Input 1', audio: { knoten: 'n', ports: ['a'] } }, { k: 2, name: 'Input 2', audio: null }, { k: 3, name: 'Desk', audio: { knoten: 'm', ports: ['b'] } }, { k: 4, name: 'Input 4', audio: null }] };
  assert.deepEqual(eingangsOptionen(g, intern).map((o) => o.wert), ['ein/1', 'ein/3', 'erz/1', 'pad/1']);
  assert.equal(eingangsOptionen(g, intern)[1].text, 'Desk');
  assert.deepEqual(eingangsOptionen(null, intern), intern, 'negative control: no device state yet: the internal list as before');
  assert.deepEqual(eingangsOptionen({ eingaenge: [] }, intern), intern);
});
test('S2b.3 eingangsOptionen: the input a track holds is always listed, also when its device is gone', () => {
  const o = eingangsOptionen({ eingaenge: [{ k: 1, name: 'Input 1', audio: { knoten: 'n', ports: ['a'] } }] }, [{ wert: 'erz/1', text: 'erz/1' }], 'ein/2');
  assert.deepEqual(o.map((x) => [x.wert, x.text]), [['ein/1', 'Input 1'], ['ein/2', 'Input 2 (no device)'], ['erz/1', 'erz/1']]);
  assert.equal(eingangsOptionen({ eingaenge: [] }, [], 'erz/1').length, 0, 'an internal value is not added');
});
test('S2b.3 eingangWert / eingangVonWert: external pairs are ein/<paar>, the mode survives a pair change, an unknown mode falls back to stereo', () => {
  assert.equal(eingangWert({ art: 'extern', paar: 3, modus: 'links' }), 'ein/3');
  assert.equal(eingangWert({ art: 'intern', name: 'erz/5' }), 'erz/5');
  assert.equal(eingangWert(null), '');
  assert.deepEqual(eingangVonWert('ein/2', 'summe'), { art: 'extern', paar: 2, modus: 'summe' });
  assert.deepEqual(eingangVonWert('ein/2', 'quatsch'), { art: 'extern', paar: 2, modus: 'stereo' });
  assert.deepEqual(eingangVonWert('erz/1', 'summe'), { art: 'intern', name: 'erz/1' }, 'negative control: internal carries no mode');
  assert.equal(eingangVonWert(''), null);
  assert.deepEqual(eingangVonWert('ein/5'), { art: 'intern', name: 'ein/5' }, 'the server refuses it (eingang_fehlt); the page does not invent a pair');
});
test('S2b.3 armZustand: the mode select shows for an external input only, with the mode of the track', () => {
  const ext = (modus) => ({ art: 'audio', aufnahme: { scharf: true, eingang: { art: 'extern', paar: 1, modus } } });
  assert.deepEqual(MODUS_OPTIONEN.map((o) => o.text), ['Stereo', 'L', 'R', 'Sum']);
  for (const o of MODUS_OPTIONEN) { const z = armZustand(ext(o.wert)); assert.deepEqual([z.modusSichtbar, z.modus, z.eingang, z.armSperre], [true, o.wert, 'ein/1', false], o.wert); }
  assert.equal(armZustand({ art: 'audio', aufnahme: { scharf: true, eingang: { art: 'intern', name: 'erz/1' } } }).modusSichtbar, false);
  assert.equal(armZustand({ art: 'instrument', aufnahme: { scharf: true, eingang: { art: 'extern', paar: 1, modus: 'links' } } }).modusSichtbar, false, 'no mode on an instrument track');
});
test('S2b.3 recKnopf: a track armed on an external input enables the REC button', () => {
  const p = { spuren: [{ art: 'audio', aufnahme: { scharf: true, eingang: { art: 'extern', paar: 1, modus: 'stereo' } } }] };
  assert.equal(recKnopf({ projekt: p, lauf: null }).disabled, false);
});

test('S3.5 armZustand: monitor buttons and the input level show for an external input only; no key means auto; the project value is shown', () => {
  assert.deepEqual(MONITOR_OPTIONEN.map((o) => [o.wert, o.text]), [['ein', 'IN'], ['auto', 'AUTO'], ['aus', 'OFF']]);
  const ext = (monitor, paar = 2) => ({ art: 'audio', aufnahme: { scharf: true, eingang: { art: 'extern', paar, modus: 'stereo' }, ...(monitor ? { monitor } : {}) } });
  assert.deepEqual([armZustand(ext()).monitor, armZustand(ext()).monitorSichtbar, armZustand(ext()).eingangKanal], ['auto', true, 'ein/2'], 'no key = auto');
  for (const m of ['ein', 'auto', 'aus']) assert.equal(armZustand(ext(m)).monitor, m);
  assert.equal(armZustand(ext('ein', 4)).eingangKanal, 'ein/4');
  // negative control: an internal input, no input and an instrument track show neither the buttons nor a level bar
  for (const s of [{ art: 'audio', aufnahme: { scharf: true, eingang: { art: 'intern', name: 'erz/1' } } }, { art: 'audio' }, { art: 'instrument', aufnahme: { eingang: { art: 'extern', paar: 1, modus: 'stereo' } } }]) {
    const z = armZustand(s);
    assert.deepEqual([z.monitorSichtbar, z.eingangKanal], [false, ''], JSON.stringify(s));
  }
});

// 1.8 T5: count-in (status 1), count-in select, punch toggles and range, overdub
test('T5 laufEnde: a count-in (status 1) is a run too: aborted 1 to 0 ends it, 1 to 3 does not', () => {
  assert.equal(laufEnde(1, 0), true, 'an aborted count-in must reset the REC button');
  assert.equal(laufEnde(1, 3), false);
  assert.equal(laufEnde(1, 2), false);
  assert.equal(laufEnde(0, 1), false, 'negative control: the count-in starting is no end');
});
test('T5 Binder, status 1 without a local run (count-in started by Cypher or another client): the button pulls the run, no wait for status 3', async () => {
  let lauf = null;
  const b = baue({ holeGet: () => ({ status: 200, j: { lauf, letzte: null } }), holeJson: () => ({ status: 200, j: {} }) });
  await warten(5);
  b.ereignis(1);
  await warten(30);
  assert.equal(b.els.rec.textContent, '● REC', 'no run on the server yet');
  assert.equal(b.els['rec-status'].textContent, 'Counting in');
  lauf = { kennung: 7 };
  await warten(60);
  assert.equal(b.els.rec.textContent, '■ STOP REC');
});
test('T5 Binder, aborted count-in (1 to 0): the run never existed on the server, an OLD take in `letzte` is not reported as saved, the end is reported once as "nothing recorded"', async () => {
  // the real server writes nothing into `letzte` for a start that failed (aufnahme_abgebrochen, einsatz_ausgeblieben): it still holds the take of the run before (kennung 5)
  const alt = { kennung: 5, code: 200, takes: [{ frames: 100 }] };
  const b = baue({ holeGet: () => ({ status: 200, j: { lauf: null, letzte: alt } }), holeJson: () => ({ status: 200, j: {} }) });
  await warten(5);
  b.ereignis(1);
  b.ereignis(0);
  await warten(100);
  assert.equal(b.els.rec.textContent, '\u25cf REC');
  assert.equal(b.z.geladen, 1);
  assert.deepEqual(b.z.meldungen, [['Recording ended, nothing was recorded', false]]);
});
test('T5 Binder, aborted count-in without any earlier take: also one "nothing recorded" message, not silence', async () => {
  const b = baue({ holeGet: () => ({ status: 200, j: { lauf: null, letzte: null } }), holeJson: () => ({ status: 200, j: {} }) });
  await warten(5);
  b.ereignis(1); b.ereignis(0);
  await warten(100);
  assert.deepEqual(b.z.meldungen, [['Recording ended, nothing was recorded', false]]);
});
test('T5 Binder, a run ended elsewhere whose take is new (kennung differs from the one known before): reported even if this page never saw the run', async () => {
  let neu = false;
  const b = baue({ holeGet: () => ({ status: 200, j: { lauf: null, letzte: neu ? { kennung: 9, code: 200, takes: [{ frames: 100 }] } : { kennung: 5, code: 200, takes: [{ frames: 7 }] } } }), holeJson: () => ({ status: 200, j: {} }) });
  await warten(5);
  b.ereignis(3);
  neu = true; b.ereignis(0);
  await warten(100);
  assert.deepEqual(b.z.meldungen, [['Take saved', false]]);
});
test('T5 Binder, a run this page saw (kennung 8) whose result is already known to the page: still reported (the seen run decides, not the order of reads)', async () => {
  let lauf = { kennung: 8 }, beendet = false;
  const b = baue({ holeGet: () => { if (beendet) lauf = null; return { status: 200, j: { lauf, letzte: lauf ? null : { kennung: 8, code: 200, takes: [{ frames: 100 }] } } }; }, holeJson: () => ({ status: 200, j: {} }) });
  await warten(5);
  b.ereignis(3);
  beendet = true; b.ereignis(0);
  await warten(100);
  assert.deepEqual(b.z.meldungen, [['Take saved', false]]);
});

test('T5 count-in select: Off, 1, 2, 4 bars; the value goes to aufnahme_setzen; anything else sends nothing', () => {
  assert.deepEqual(VORZAEHLER_OPTIONEN.map((o) => [o.wert, o.text]), [[0, 'Off'], [1, '1 bar'], [2, '2 bars'], [4, '4 bars']]);
  for (const w of [0, 1, 2, 4]) assert.deepEqual(vorzaehlerBefehl(String(w)), { befehl: 'aufnahme_setzen', vorzaehler_takte: w });
  for (const w of ['3', '', 'x', '-1', '8', undefined]) assert.equal(vorzaehlerBefehl(w), null, String(w));
});
test('T5 aufnahmeStand: defaults without the key, bars one-based and inclusive, a range off the bar grid is shown rounded outward', () => {
  assert.deepEqual(aufnahmeStand({}), { vorzaehler: 0, punchEin: false, punchAus: false, overdub: false, vonTakt: 1, bisTakt: 1 });
  assert.deepEqual(aufnahmeStand(null), aufnahmeStand({}));
  const p = { aufnahme: { vorzaehler_takte: 2, punch: { ein: true, aus: false, von_beat: 16, bis_beat: 32 }, overdub: true } };
  assert.deepEqual(aufnahmeStand(p), { vorzaehler: 2, punchEin: true, punchAus: false, overdub: true, vonTakt: 5, bisTakt: 8 });
  const q = { aufnahme: { vorzaehler_takte: 0, punch: { ein: false, aus: true, von_beat: 6, bis_beat: 10 }, overdub: false } };
  assert.deepEqual([aufnahmeStand(q).vonTakt, aufnahmeStand(q).bisTakt], [2, 3]);
});
test('T5 punchBefehl: both bar fields go into ONE command (bar 5 to 8 = beats 16 to 32), also when only one field changed', () => {
  assert.deepEqual(punchBefehl('5', '8'), { befehl: 'aufnahme_setzen', punch: { von_beat: 16, bis_beat: 32 } });
  assert.deepEqual(punchBefehl('1', '1'), { befehl: 'aufnahme_setzen', punch: { von_beat: 0, bis_beat: 4 } });
  assert.deepEqual(Object.keys(punchBefehl('5', '8').punch).sort(), ['bis_beat', 'von_beat'], 'never a single field');
  assert.deepEqual(punchBefehl(' 2 ', '3'), { befehl: 'aufnahme_setzen', punch: { von_beat: 4, bis_beat: 12 } });
  for (const [a, b] of [['', '4'], ['4', ''], ['x', '4'], ['0', '4'], ['1.5', '4'], ['-1', '4'], ['1', '0']]) assert.equal(punchBefehl(a, b), null, `${a}/${b}`);
  assert.notEqual(punchBefehl('8', '5'), null, 'the order is the server rule (argument_ungueltig), the page does not guess');
});
test('T5 schalterBefehl: PUNCH IN, PUNCH OUT and OVERDUB flip the stored value, nothing else', () => {
  assert.deepEqual(schalterBefehl({}, 'punch_ein'), { befehl: 'aufnahme_setzen', punch: { ein: true } });
  assert.deepEqual(schalterBefehl({}, 'punch_aus'), { befehl: 'aufnahme_setzen', punch: { aus: true } });
  assert.deepEqual(schalterBefehl({}, 'overdub'), { befehl: 'aufnahme_setzen', overdub: true });
  const an = { aufnahme: { vorzaehler_takte: 0, punch: { ein: true, aus: true, von_beat: 0, bis_beat: 4 }, overdub: true } };
  assert.deepEqual(schalterBefehl(an, 'punch_ein'), { befehl: 'aufnahme_setzen', punch: { ein: false } });
  assert.deepEqual(schalterBefehl(an, 'punch_aus'), { befehl: 'aufnahme_setzen', punch: { aus: false } });
  assert.deepEqual(schalterBefehl(an, 'overdub'), { befehl: 'aufnahme_setzen', overdub: false });
  assert.equal(schalterBefehl({}, 'quatsch'), null);
});
test('T5 punchBand: read-only band in the ruler while PUNCH IN or OUT is on; none when both are off', () => {
  const a = { beat0: 4, pxProBeat: 10 };
  const mit = (ein, aus) => ({ aufnahme: { vorzaehler_takte: 0, punch: { ein, aus, von_beat: 16, bis_beat: 32 }, overdub: false } });
  assert.deepEqual(punchBand(a, mit(true, false)), { x0: 120, x1: 280, ein: true, aus: false });
  assert.deepEqual(punchBand(a, mit(false, true)), { x0: 120, x1: 280, ein: false, aus: true });
  assert.equal(punchBand(a, mit(false, false)), null);
  assert.equal(punchBand(a, {}), null, 'no key: defaults are off');
  assert.equal(punchBand(a, null), null);
});

// Binder: the controls of the transport bar
const aufnahmeVon = (p) => p?.aufnahme ?? { vorzaehler_takte: 0, punch: { ein: false, aus: false, von_beat: 0, bis_beat: 4 }, overdub: false };
function baueRegler(projekt, { refuse = false } = {}) {
  const mk = () => ({ textContent: '', disabled: false, title: '', value: '', classList: { toggle(n, an) { this.zustand = { ...this.zustand, [n]: an }; } }, setAttribute() {}, on: {},
    addEventListener(n, f) { this.on[n] = f; } });
  const els = { rec: mk(), 'rec-status': mk(), vorzaehler: mk(), 'punch-ein': mk(), 'punch-aus': mk(), overdub: mk(), 'punch-von': mk(), 'punch-bis': mk() };
  globalThis.document = { addEventListener() {}, activeElement: null };
  const z = { befehle: [], meldungen: [] };
  const ctx = {
    st: { projekt, start: 0, sichtbar: true }, $: (n) => els[n], takt: 20,
    holeGet: async () => ({ status: 200, j: { lauf: null, letzte: null } }), holeJson: async () => ({ status: 200, j: {} }),
    melde: (t, f) => z.meldungen.push([t, !!f]), antwortText: () => '', ladeAktuell: async () => {},
    fehlerText: (r) => `text:${r.j.fehler}`,
    aendereAus: async (rechne) => {   // the write path of the page, reduced to what the binder needs: the command is applied to the stored state unless refused
      const x = rechne(ctx.st.projekt);
      if (!x) return;
      z.befehle.push(x);
      if (refuse) return;
      const a = structuredClone(aufnahmeVon(ctx.st.projekt)), c = x.befehle[0];
      if (c.vorzaehler_takte !== undefined) a.vorzaehler_takte = c.vorzaehler_takte;
      if (c.overdub !== undefined) a.overdub = c.overdub;
      if (c.punch) Object.assign(a.punch, c.punch);
      ctx.st.projekt = { ...ctx.st.projekt, aufnahme: a };
    },
    beimProjekt: [], beimEreignis: [], beimSichtwechsel: [],
  };
  bindeAufnahme(ctx);
  const zeige = () => ctx.beimProjekt.forEach((f) => f(ctx.st.projekt, false));
  zeige();
  return { els, z, ctx, zeige };
}
const standA = (vorzaehler_takte, punch, overdub = false) => ({ spuren: [], aufnahme: { vorzaehler_takte, punch, overdub } });

test('T5 Binder: the controls show the stored values (select, toggles, bar fields) and follow a project change', () => {
  const b = baueRegler(standA(2, { ein: true, aus: false, von_beat: 16, bis_beat: 32 }, true));
  assert.deepEqual([b.els.vorzaehler.value, b.els['punch-von'].value, b.els['punch-bis'].value], ['2', '5', '8']);
  assert.deepEqual([b.els['punch-ein'].classList.zustand.an, b.els['punch-aus'].classList.zustand.an, b.els.overdub.classList.zustand.an], [true, false, true]);
  b.ctx.st.projekt = standA(0, { ein: false, aus: true, von_beat: 0, bis_beat: 4 });
  b.zeige();
  assert.deepEqual([b.els.vorzaehler.value, b.els['punch-von'].value, b.els['punch-bis'].value], ['0', '1', '1']);
  assert.deepEqual([b.els['punch-ein'].classList.zustand.an, b.els['punch-aus'].classList.zustand.an, b.els.overdub.classList.zustand.an], [false, true, false]);
});
test('T5 Binder: the select sends aufnahme_setzen with the chosen value (value ignored goes red)', async () => {
  const b = baueRegler({ spuren: [] });
  b.els.vorzaehler.value = '4';
  await b.els.vorzaehler.on.change();
  assert.deepEqual(b.z.befehle.map((x) => x.befehle), [[{ befehl: 'aufnahme_setzen', vorzaehler_takte: 4 }]]);
  assert.equal(b.z.befehle[0].label, 'Count-in 4 bars');
  b.els.vorzaehler.value = '1';
  await b.els.vorzaehler.on.change();
  assert.deepEqual(b.z.befehle[1].befehle, [{ befehl: 'aufnahme_setzen', vorzaehler_takte: 1 }]);
  assert.equal(b.z.befehle[1].label, 'Count-in 1 bar');
});
test('T5 Binder: the toggles send the flipped value of the stored state at send time', async () => {
  const b = baueRegler(standA(0, { ein: true, aus: false, von_beat: 0, bis_beat: 4 }));
  await b.els['punch-ein'].on.click();
  await b.els['punch-aus'].on.click();
  await b.els.overdub.on.click();
  assert.deepEqual(b.z.befehle.map((x) => x.befehle[0]), [
    { befehl: 'aufnahme_setzen', punch: { ein: false } }, { befehl: 'aufnahme_setzen', punch: { aus: true } }, { befehl: 'aufnahme_setzen', overdub: true }]);
});
test('T5 Binder: a change of ONE bar field sends BOTH fields in one command (from bar 5 to 8, set the end to bar 6)', async () => {
  const b = baueRegler(standA(0, { ein: true, aus: true, von_beat: 16, bis_beat: 32 }));
  b.els['punch-bis'].value = '6';
  await b.els['punch-bis'].on.change();
  assert.equal(b.z.befehle.length, 1, 'one command');
  assert.deepEqual(b.z.befehle[0].befehle, [{ befehl: 'aufnahme_setzen', punch: { von_beat: 16, bis_beat: 24 } }]);
  b.els['punch-von'].value = '3';
  await b.els['punch-von'].on.change();
  assert.deepEqual(b.z.befehle[1].befehle, [{ befehl: 'aufnahme_setzen', punch: { von_beat: 8, bis_beat: 24 } }]);
});
test('T5 Binder: a refused range (server says no) puts the stored values back into the fields; the refusal text comes from the command path', async () => {
  const b = baueRegler(standA(0, { ein: true, aus: true, von_beat: 16, bis_beat: 32 }), { refuse: true });
  b.els['punch-bis'].value = '2';   // end before the start: the server refuses with argument_ungueltig
  await b.els['punch-bis'].on.change();
  assert.equal(b.z.befehle.length, 1);
  assert.deepEqual([b.els['punch-von'].value, b.els['punch-bis'].value], ['5', '8'], 'fields show the stored range again');
});
test('T5 Binder: a field that is not a bar number sends nothing, shows the argument_ungueltig text and shows the stored value again', async () => {
  const b = baueRegler(standA(0, { ein: true, aus: true, von_beat: 16, bis_beat: 32 }));
  b.els['punch-von'].value = 'abc';
  await b.els['punch-von'].on.change();
  assert.equal(b.z.befehle.length, 0);
  assert.deepEqual(b.z.meldungen, [['text:argument_ungueltig', true]]);
  assert.equal(b.els['punch-von'].value, '5');
});
test('T5 Binder: without a project the controls are disabled', () => {
  const b = baueRegler(null);
  for (const n of ['vorzaehler', 'punch-ein', 'punch-aus', 'overdub', 'punch-von', 'punch-bis']) assert.equal(b.els[n].disabled, true, n);
  const c = baueRegler({ spuren: [] });
  for (const n of ['vorzaehler', 'punch-ein', 'punch-aus', 'overdub', 'punch-von', 'punch-bis']) assert.equal(c.els[n].disabled, false, n);
});
test('T5 page skeleton: the transport bar holds the controls the binder looks up, with the select options of VORZAEHLER_OPTIONEN', async () => {
  const { readFileSync } = await import('node:fs');
  const q = readFileSync(new URL('../public/production/production.js', import.meta.url), 'utf8');
  for (const n of ['vorzaehler', 'punch-ein', 'punch-aus', 'overdub', 'punch-von', 'punch-bis']) assert.match(q, new RegExp(`data-p="${n}"`), n);
  const sel = /<select[^>]*data-p="vorzaehler"[^>]*>(.*?)<\/select>/s.exec(q);
  assert.ok(sel, 'count-in select');
  const opts = [...sel[1].matchAll(/<option value="(\d)">([^<]*)<\/option>/g)].map((m) => [Number(m[1]), m[2]]);
  assert.deepEqual(opts, VORZAEHLER_OPTIONEN.map((o) => [o.wert, o.text]));
});
