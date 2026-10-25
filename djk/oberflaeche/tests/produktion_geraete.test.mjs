// I08 Task 11: Geräte-Panel. Reine Funktionen: Pegelbalken, Statustext, Zeilen-HTML (escaped, englisch, mit zugänglichen Namen).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pegelBreite, statusText, midiStatusText, zeileHtml, midiZeileHtml, bindeGeraete } from '../oeffentlich/produktion/geraete.js';

test('pegelBreite: -60 dB und leiser = 0, 0 dB = 100, unbekannt = 0', () => {
  assert.deepEqual([-200, -60, -59, -30, 0, 6, null, undefined, 'x'].map(pegelBreite), [0, 0, 2, 50, 100, 100, 0, 0, 0]);
});
test('statusText: kein Gerät, Gerät fehlt, Gerät da aber nicht verbunden, verbunden', () => {
  assert.equal(statusText({ audio: null }), 'no device');
  assert.equal(statusText({ audio: {}, da: false, verbunden: false }), 'device not present');
  assert.equal(statusText({ audio: {}, da: true, verbunden: false }), 'device found, not linked yet');
  assert.equal(statusText({ audio: {}, da: true, verbunden: null }), 'core not reporting');   // Gesamtreview m4: Kern still = unbekannt
  assert.equal(midiStatusText({ port: 'p', da: true, verbunden: null }), 'core not reporting');
  assert.equal(statusText({ audio: {}, da: true, verbunden: true }), 'connected');
});
test('zeileHtml: Name escaped, Profilwahl mit Beschriftung, Freigabe nur mit Gerät, Latenz als Text', () => {
  const profile = [{ id: 'pc-eingang', name: 'PC input (onboard)', audio: true }, { id: 'xdj-xz', name: 'Pioneer XDJ-XZ', audio: true }];
  const h = zeileHtml({ k: 2, name: '<b>x</b>', profil: 'pc-eingang', audio: { knoten: 'n', ports: ['n:a'] }, da: true, verbunden: true, pegel_db: -12,
    frei_fuer_cypher: false, latenz: { samples: 480, streuung: 1.5, quantum: 256, rate: 48000, art: 'kabel' }, audio_hinweis: '' }, profile);
  assert.ok(!h.includes('<b>x</b>') && h.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(h.includes('aria-label="Device profile for input 2"') && h.includes('data-kanal="ein/2"'));
  assert.ok(h.includes('10.0 ms') && h.includes('cable'), 'latency 480 samples at 48 kHz = 10.0 ms');
  assert.ok(h.includes('aria-label="Let Cypher use input 2"') && !/data-frei="2"[^>]*disabled/.test(h));
  const leer = zeileHtml({ k: 1, name: 'Input 1', profil: null, audio: null, da: false, verbunden: false, pegel_db: null, frei_fuer_cypher: false, latenz: null }, profile);
  assert.ok(/data-frei="1"[^>]*disabled/.test(leer), 'ohne Gerät ist die Freigabe gesperrt');
  assert.ok(leer.includes('no device') && !leer.includes('ms'));
});
test('midiZeileHtml: Profilwahl nur mit MIDI-Profilen, Status, Freigabe nur mit Gerät', () => {
  const profile = [{ id: 'pc-eingang', name: 'PC input (onboard)', audio: true, midi: false }, { id: 'xdj-xz', name: 'Pioneer XDJ-XZ', audio: true, midi: true }];
  const h = midiZeileHtml({ profil: 'xdj-xz', port: 'Midi-Bridge:XDJ-XZ (1): x', da: true, verbunden: true, frei_fuer_cypher: false }, profile);
  assert.ok(h.includes('aria-label="Device profile for the MIDI input"') && h.includes('Pioneer XDJ-XZ') && !h.includes('PC input'));
  assert.ok(h.includes('connected') && !/data-midi-frei[^>]*disabled/.test(h));
  const leer = midiZeileHtml({ profil: null, port: null, da: false, verbunden: false, frei_fuer_cypher: false }, profile);
  assert.ok(/data-midi-frei[^>]*disabled/.test(leer) && leer.includes('no device'));
});

test('statusText und midiStatusText: ausgefallene Erkennung heißt "detection unavailable", nicht "device not present"', () => {
  assert.equal(statusText({ audio: {}, da: false, verbunden: false }, 'nicht_verfuegbar'), 'detection unavailable');
  assert.equal(statusText({ audio: null }, 'nicht_verfuegbar'), 'no device', 'ohne Zuordnung bleibt es "no device"');
  assert.equal(midiStatusText({ port: 'p', da: false, verbunden: false }, 'nicht_verfuegbar'), 'detection unavailable');
  assert.deepEqual([{ port: null }, { port: 'p', da: false }, { port: 'p', da: true, verbunden: false }, { port: 'p', da: true, verbunden: true }].map((m) => midiStatusText(m)),
    ['no device', 'device not present', 'device found, not linked yet', 'connected']);
  const e = { k: 1, name: 'Input 1', profil: 'x', audio: {}, da: false, verbunden: false, pegel_db: null, frei_fuer_cypher: false, latenz: null };
  assert.ok(zeileHtml(e, [], 'nicht_verfuegbar').includes('detection unavailable') && zeileHtml(e, []).includes('device not present'));
});
test('zeileHtml: gewähltes Profil ist selected, Streuung in ms; midiZeileHtml: Profil selected, Freigabe hängt am Port, nicht am Gerät', () => {
  const profile = [{ id: 'a', name: 'A', audio: true, midi: true }, { id: 'b', name: 'B', audio: true, midi: true }];
  const h = zeileHtml({ k: 1, name: 'n', profil: 'b', audio: {}, da: true, verbunden: true, pegel_db: 0, frei_fuer_cypher: true, latenz: { samples: 480, streuung: 48, quantum: 256, rate: 48000, art: 'software' }, audio_hinweis: '' }, profile);
  assert.ok(h.includes('<option value="b" selected>') && !h.includes('<option value="a" selected>'));
  assert.ok(h.includes('±1.00') && h.includes('software loop') && h.includes('checked'), 'streuung 48 samples = 1.00 ms');
  const m = midiZeileHtml({ profil: 'b', port: 'p', da: false, verbunden: false, frei_fuer_cypher: false }, profile);
  assert.ok(m.includes('<option value="b" selected>') && !m.includes('<option value="a" selected>'));
  assert.ok(!/data-midi-frei[^>]*disabled/.test(m), 'Port gesetzt, Gerät gerade weg: Freigabe bleibt bedienbar');
});

// Knotentest ohne Browser: ein Minimal-DOM für bindeGeraete (Fokus, Neuzeichnen, Wege, Maskenwechsel).
function umgebung({ stand }) {
  const log = { gets: 0, posts: [], melde: [], innerHTML: [], fokus: [] };
  const handler = {};
  const steuer = (ds) => ({ dataset: ds, focus() { log.fokus.push(ds); } });
  const state = { aktiv: null, drin: false, panel: new Set(), knoten: {} };   // panel: Steuerelemente, die im Panel liegen
  const liste = {
    set innerHTML(v) { log.innerHTML.push(v); }, get innerHTML() { return log.innerHTML.at(-1) ?? ''; },
    contains: (el) => el !== null && el !== undefined && state.panel.has(el),
    addEventListener: (n, f) => { handler[n] = f; },
    querySelector: (sel) => (state.knoten[sel] ??= { ...steuer({ gesucht: sel }), textContent: '', style: {} }),
  };
  globalThis.document = { get activeElement() { return state.aktiv; } };
  const ctx = { $: () => liste, beimEreignis: [], beimSichtwechsel: [], antwortText: (r) => JSON.stringify(r.j), melde: (t, f) => log.melde.push([t, f]),
    holeGet: async () => { log.gets++; return { status: 200, j: structuredClone(stand.aktuell) }; },
    holeJson: async (weg, body) => { log.posts.push([weg, body]); return { status: stand.antwort ?? 200, j: { fehler: 'x' } }; } };
  return { log, handler, ctx, state, steuer, ereignis: (a, f) => ctx.beimEreignis.forEach((h) => h(a, f)) };
}
const basis = (maske) => ({ erkennung: 'ok', eingaenge: [{ k: 1, name: 'Input 1', profil: null, audio: null, da: false, verbunden: false, pegel_db: null, frei_fuer_cypher: false, latenz: null }],
  midi: { profil: null, port: null, frei_fuer_cypher: false, da: false, verbunden: false }, profile: [], kern: { ein: { verbunden: maske } } });
const warte = () => new Promise((r) => setTimeout(r, 5));

test('bindeGeraete: Wahl im fokussierten Auswahlfeld zeichnet sofort neu (Server-Stand) und gibt den Fokus zurück', async () => {
  const stand = { aktuell: basis(0) };
  const u = umgebung({ stand }); bindeGeraete(u.ctx); await warte();
  assert.equal(u.log.innerHTML.length, 1, 'erstes Laden zeichnet');
  const sel = u.steuer({ profil: '1' }); sel.value = 'pc-eingang'; u.state.aktiv = sel; u.state.panel.add(sel);
  stand.aktuell.eingaenge[0].profil = 'pc-eingang'; stand.aktuell.eingaenge[0].audio = { knoten: 'n', ports: ['n:a'] }; stand.aktuell.eingaenge[0].da = true;
  await u.handler.change({ target: sel }); await warte();
  assert.deepEqual(u.log.posts, [['/geraete/eingang', { k: 1, profil: 'pc-eingang' }]]);
  assert.equal(u.log.innerHTML.length, 2, 'trotz Fokus im Panel neu gezeichnet');
  assert.ok(u.log.innerHTML.at(-1).includes('device found, not linked yet'));
  assert.deepEqual(u.log.fokus.at(-1), { gesucht: '[data-profil="1"]' }, 'Fokus auf dasselbe Steuerelement zurück');
});
test('bindeGeraete: Ablehnung wird gemeldet und das Feld zeigt danach wieder den Stand des Servers', async () => {
  const stand = { aktuell: basis(0), antwort: 409 };
  const u = umgebung({ stand }); bindeGeraete(u.ctx); await warte();
  const sel = u.steuer({ profil: '1' }); sel.value = 'xdj-xz'; u.state.aktiv = sel; u.state.panel.add(sel);
  await u.handler.change({ target: sel });
  assert.equal(u.log.melde.length, 1); assert.equal(u.log.melde[0][1], true);
  assert.equal(u.log.innerHTML.length, 2, 'auch nach 409 neu gezeichnet');
});
test('bindeGeraete: Wege und Bodys für Audio-Freigabe, MIDI-Profil, MIDI-Freigabe', async () => {
  const u = umgebung({ stand: { aktuell: basis(0) } }); bindeGeraete(u.ctx); await warte();
  await u.handler.change({ target: { dataset: { frei: '3' }, checked: true } });
  await u.handler.change({ target: { dataset: { midiProfil: '1' }, value: 'xdj-xz' } });
  await u.handler.change({ target: { dataset: { midiFrei: '1' }, checked: true } });
  await u.handler.change({ target: { dataset: { midiProfil: '1' }, value: '' } });
  await u.handler.change({ target: { dataset: {} } });
  assert.deepEqual(u.log.posts, [['/geraete/eingang', { k: 3, frei_fuer_cypher: true }], ['/geraete/midi', { profil: 'xdj-xz' }],
    ['/geraete/midi', { frei_fuer_cypher: true }], ['/geraete/midi', { profil: null }]]);
});
test('bindeGeraete: ein Ereignis-Neuladen unter Fokus wartet bis zum Fokusverlust; Wechsel zwischen Steuerelementen des Panels zeichnet nicht', async () => {
  const stand = { aktuell: basis(0) };
  const u = umgebung({ stand }); bindeGeraete(u.ctx); await warte();
  const sel = u.steuer({ profil: '1' }); u.state.aktiv = sel; u.state.panel.add(sel);
  u.ereignis('/zustand/ein', { verbunden: 1 }); await warte();
  assert.equal(u.log.gets, 2); assert.equal(u.log.innerHTML.length, 1, 'unter Fokus nicht überzeichnet (offenes Auswahlfeld bleibt offen)');
  const anderes = u.steuer({ frei: '1' }); u.state.panel.add(anderes); u.state.aktiv = null;   // im focusout ist activeElement noch nicht das Ziel
  u.handler.focusout({ relatedTarget: anderes }); assert.equal(u.log.innerHTML.length, 1, 'Fokus bleibt im Panel');
  u.handler.focusout({ relatedTarget: null }); assert.equal(u.log.innerHTML.length, 2, 'beim Fokusverlust nachgezeichnet');
  u.handler.focusout({ relatedTarget: null }); assert.equal(u.log.innerHTML.length, 2, 'nur einmal');
});
test('bindeGeraete: Maskenwechsel gegen den GELADENEN Stand löst Neuladen aus, gleiche Maske nicht, auch nicht doppelt', async () => {
  const u = umgebung({ stand: { aktuell: basis(0) } }); bindeGeraete(u.ctx); await warte();
  assert.equal(u.log.gets, 1);
  u.ereignis('/zustand/ein', { verbunden: 0 }); u.ereignis('/pegel', { kanal: 'ein/1', spitze_db: -3 }); await warte();
  assert.equal(u.log.gets, 1, 'gleiche Maske wie der geladene Stand: kein Neuladen');
  u.ereignis('/zustand/ein', { verbunden: 1 }); u.ereignis('/zustand/ein', { verbunden: 1 }); await warte();
  assert.equal(u.log.gets, 2, 'erstes Ereignis nach dem Laden ändert die Maske: genau ein Neuladen');
  u.ereignis('/zustand/ein', { verbunden: 'x' }); u.ereignis('/zustand/ein', {}); await warte();
  assert.equal(u.log.gets, 2, 'ohne Zahl kein Neuladen');
});
test('bindeGeraete: Sichtwechsel lädt nur beim Sichtbarwerden', async () => {
  const u = umgebung({ stand: { aktuell: basis(0) } }); bindeGeraete(u.ctx); await warte();
  u.ctx.beimSichtwechsel.forEach((h) => h(false)); await warte(); assert.equal(u.log.gets, 1);
  u.ctx.beimSichtwechsel.forEach((h) => h(true)); await warte(); assert.equal(u.log.gets, 2);
});

test('Raster: #produktion hat für jedes Kind im Fluss eine feste Zeile (ein verstecktes Mischer-Kind schiebt INPUTS und CLIP-Detail nicht)', () => {
  const dir = new URL('../oeffentlich/produktion/', import.meta.url);
  const css = fs.readFileSync(new URL('produktion.css', dir), 'utf8');
  const regel = /body\.produktion #produktion \{[^}]*?grid-template-rows:\s*([^;]+);/.exec(css);
  assert.ok(regel, 'Raster-Regel von #produktion gefunden');
  const zeilen = []; let tiefe = 0, tok = '';
  for (const c of regel[1].replace(/\/\*.*?\*\//g, '').trim()) { if (c === '(') tiefe++; if (c === ')') tiefe--; if (c === ' ' && tiefe === 0) { if (tok) zeilen.push(tok); tok = ''; } else tok += c; }
  if (tok) zeilen.push(tok);
  const js = fs.readFileSync(new URL('produktion.js', dir), 'utf8');
  const geruest = /const GERUEST = `([\s\S]*?)`;/.exec(js)[1];
  const leer = new Set(['input', 'br', 'img', 'hr']); let d = 0; const kinder = [];
  for (const m of geruest.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, zu, tag, attr, selbst] = m;
    if (zu) { d--; continue; }
    if (d === 0 && !/class="p-verlauf"/.test(attr)) kinder.push(tag + (/class="([^"]*)"/.exec(attr)?.[1] ? '.' + /class="([^"]*)"/.exec(attr)[1].split(' ')[0] : ''));
    if (!leer.has(tag) && !selbst) d++;
  }
  assert.deepEqual(kinder, ['div.p-transport', 'div.p-arr', 'section.p-mixer', 'details.p-geraete', 'section.p-detail'], 'Kinder im Fluss (der Verlauf ist absolut)');
  assert.equal(zeilen.length, kinder.length, `Raster: ${zeilen.join(' | ')}`);
  assert.equal(zeilen[2], 'auto', 'Mischer: nur so hoch wie sein Inhalt (versteckt: 0)');
  assert.equal(zeilen[3], 'auto', 'INPUTS zugeklappt: nur so hoch wie die Summary');
  assert.ok(zeilen[4].includes('var(--detail'), 'das CLIP-Detail behält seine Zeile');
  // N4: jedes Kind steht in einer festen Zeile, sonst rückt ein verstecktes Kind (display: none) die übrigen eine Zeile nach oben
  kinder.forEach((k, i) => {
    const klasse = k.split('.')[1];
    const r = new RegExp(`\\.${klasse}\\s*\\{[^}]*?grid-row:\\s*${i + 1}\\b`).exec(css);
    assert.ok(r, `.${klasse} hat grid-row: ${i + 1}`);
  });
});

test('bindeGeraete: die Maske kommt aus dem geladenen Stand (Maske 1 geladen: gleiche Maske lädt nicht; kein Kern-Stand zählt als 0)', async () => {
  const u = umgebung({ stand: { aktuell: basis(1) } }); bindeGeraete(u.ctx); await warte();
  u.ereignis('/zustand/ein', { verbunden: 1 }); await warte();
  assert.equal(u.log.gets, 1, 'Maske 1 war schon geladen');
  u.ereignis('/zustand/ein', { verbunden: 0 }); await warte();
  assert.equal(u.log.gets, 2);
  const k = basis(0); k.kern = { ein: null };
  const v = umgebung({ stand: { aktuell: k } }); bindeGeraete(v.ctx); await warte();
  v.ereignis('/zustand/ein', { verbunden: 0 }); await warte(); assert.equal(v.log.gets, 1, 'ohne Kern-Stand gilt Maske 0, wie beim Server');
  v.ereignis('/zustand/ein', { verbunden: 1 }); await warte(); assert.equal(v.log.gets, 2);
});
test('bindeGeraete: ausgefallene Erkennung (pw-dump) erscheint im Panel, nicht "device not present"', async () => {
  const k = basis(0); k.erkennung = 'nicht_verfuegbar'; k.eingaenge[0].audio = { knoten: 'n', ports: ['n:a'] }; k.eingaenge[0].profil = 'pc-eingang'; k.midi.port = 'p';
  const u = umgebung({ stand: { aktuell: k } }); bindeGeraete(u.ctx); await warte();
  const h = u.log.innerHTML.at(-1);
  assert.equal((h.match(/detection unavailable/g) ?? []).length, 2, 'Audio-Zeile und MIDI-Zeile');
  assert.ok(!h.includes('device not present'));
});

test('bindeGeraete: unter Fokus führt eine Maskenänderung Status und Sperren nach, ohne die Steuerelemente zu ersetzen', async () => {
  const stand = { aktuell: basis(0) };
  const e0 = stand.aktuell.eingaenge[0]; e0.profil = 'pc-eingang'; e0.audio = { knoten: 'n', ports: ['n:a'] }; e0.da = true;
  const u = umgebung({ stand }); bindeGeraete(u.ctx); await warte();
  const sel = u.steuer({ profil: '1' }); u.state.aktiv = sel; u.state.panel.add(sel);
  e0.verbunden = true; stand.aktuell.kern.ein.verbunden = 1; e0.latenz = { samples: 480, streuung: 0, quantum: 256, rate: 48000, art: 'kabel' }; e0.frei_fuer_cypher = true;
  u.ereignis('/zustand/ein', { verbunden: 1 }); await warte();
  assert.equal(u.log.innerHTML.length, 1, 'nicht überzeichnet');
  assert.equal(u.state.knoten['[data-k="1"] .p-gstatus'].textContent, 'connected');
  assert.ok(u.state.knoten['[data-k="1"] .p-glatenz'].textContent.includes('10.0 ms'));
  assert.deepEqual([u.state.knoten['[data-frei="1"]'].disabled, u.state.knoten['[data-frei="1"]'].checked], [false, true]);
  assert.equal(u.state.knoten['[data-midi="1"] .p-gstatus'].textContent, 'no device');
});
