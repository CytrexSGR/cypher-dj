// Paket 1.13 Warp, Slice 3b (AK30, die Bedienung ohne Browser): der Editor (warp_editor_bedienung.js) gegen ein Zeichenfeld aus Attrappen. Ereignisse gehen in die
// Handler, die ctx.aendereAus rufen; der Test wertet die gesendete Rechenvorschrift gegen einen Projektstand aus. Das Zeichnen selbst (Pixel) prüft die Browserprobe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindeWarpEditor } from '../oeffentlich/produktion/warp_editor_bedienung.js';

const SHA = 'a'.repeat(64);
const projektMit = (marker = [[0, 0], [2, 4], [4, 8]]) => ({ rev: 5, spuren: [{ id: 's1', clips: [{ id: 'c1', art: 'audio', start_beat: 0, laenge_beats: 8, quelle: { sha256: SHA },
  warp: { an: true, modus: 'complex', marker, versatz_beats: 0, quelle: 'werkstatt', transpose_st: 0, detune_ct: 0 } }] }] });
function aufbau(projekt = projektMit(), { lage = null } = {}) {
  const handler = new Map(), aufgerufen = [], menues = [], melden = [];
  const rufe = [];
  const g = new Proxy({}, { get: (_, n) => (n === 'measureText' ? () => ({ width: 5 }) : (...a) => { rufe.push([n, ...a]); }), set: (_, n, v) => { rufe.push(['set:' + n, v]); return true; } });
  const canvas = { width: 0, height: 0, style: {}, getContext: () => g, getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 150 }),
    addEventListener: (n, f) => handler.set(n, f), setPointerCapture() {}, releasePointerCapture() {}, focus() {} };
  const ctx = { st: { projekt }, beimBild: [], beimProjekt: [], melde: (t, f) => melden.push([t, f]),
    aendereAus: (rechne) => { aufgerufen.push(rechne); return Promise.resolve(); } };
  const info = { textContent: '' };
  const wellen = { hole: () => ({ welle: null, fehler: null }) };
  const fragen = [], striche = [];
  const holeLage = lage ? (url) => { fragen.push(url); return Promise.resolve(lage()); } : undefined;
  const e = bindeWarpEditor(ctx, canvas, info, { menue: (punkte, x, y) => menues.push({ punkte, x, y }), wellen, holeLage });
  e.zeige(projekt.spuren[0].clips[0]);
  const ereignis = (name, o = {}) => handler.get(name)({ type: name, button: 0, offsetX: 0, shiftKey: false, pointerId: 1, preventDefault() {}, ...o });
  const gesendet = (i = 0, p = ctx.st.projekt) => aufgerufen[i]?.(p);
  const bild = () => { for (const f of ctx.beimBild) f(); };
  return { ctx, e, ereignis, aufgerufen, menues, melden, info, gesendet, canvas, fragen, rufe, bild };
}
// Ansicht: neueAnsicht(clip, 40): s0 = max(0, 0 − 0,5) = 0, 40 px je Sekunde: Marker bei x = 0, 80, 160

test('Ziehen: ein Befehl beim Loslassen, vorher nichts; der Marker wird über seinen Beat gefunden; Umschalt zählt beim Loslassen', () => {
  const t = aufbau();
  t.ereignis('pointerdown', { offsetX: 80 });                            // Marker 1
  t.ereignis('pointermove', { offsetX: 100 });
  assert.equal(t.aufgerufen.length, 0, 'bis zum Loslassen wird nichts gesendet');
  t.ereignis('pointerup', { offsetX: 100 });
  assert.equal(t.aufgerufen.length, 1, 'genau ein Befehl');
  assert.deepEqual(t.gesendet(), { label: 'Move marker', befehle: [{ befehl: 'warp_marker', clip_id: 'c1', verschiebe: [{ beat: 4, neu_quell_s: 2.5 }] }] });
  // das Projekt hat sich dazwischen verändert (ein Marker davor ist weg): der Beat 4 ist jetzt Index 0 und wird trotzdem gefunden
  assert.equal(t.gesendet(0, projektMit([[2, 4], [4, 8]])).befehle[0].verschiebe[0].beat, 4);
  assert.equal(t.gesendet(0, projektMit([[0, 0], [4, 8]])), null, 'Negativkontrolle: gibt es den Marker nicht mehr, geht nichts hinaus');
  const u = aufbau();
  u.ereignis('pointerdown', { offsetX: 80 }); u.ereignis('pointermove', { offsetX: 120, shiftKey: true }); u.ereignis('pointerup', { offsetX: 120, shiftKey: true });
  assert.deepEqual(u.gesendet().befehle[0].verschiebe, [{ beat: 4, neu_beat: 6 }], 'Umschalt: 1 s bei 120 BPM = 2 Beats, die Quellzeit bleibt');
});

test('Ziehen: ohne Treffer, ohne Bewegung und beim Abbruch geht nichts hinaus; die rechte Taste zieht nicht', () => {
  const a = aufbau();
  a.ereignis('pointerdown', { offsetX: 40 }); a.ereignis('pointerup', { offsetX: 90 });
  assert.equal(a.aufgerufen.length, 0, 'kein Marker unter dem Zeiger');
  a.ereignis('pointerdown', { offsetX: 80 }); a.ereignis('pointerup', { offsetX: 80 });
  assert.equal(a.aufgerufen.length, 1); assert.equal(a.gesendet(), null, 'ohne Bewegung ist die Rechenvorschrift leer');
  const b = aufbau();
  b.ereignis('pointerdown', { offsetX: 80 }); b.ereignis('pointermove', { offsetX: 120 }); b.ereignis('pointercancel', { offsetX: 120 });
  assert.equal(b.aufgerufen.length, 0, 'Abbruch sendet nichts');
  const c = aufbau();
  c.ereignis('pointerdown', { offsetX: 80, button: 2 }); c.ereignis('pointerup', { offsetX: 120 });
  assert.equal(c.aufgerufen.length, 0);
});

test('Doppelklick: setzt oder löscht; bei zwei Markern meldet er statt zu senden', () => {
  const t = aufbau();
  t.ereignis('dblclick', { offsetX: 40 });
  assert.deepEqual(t.gesendet(), { label: 'Add marker', befehle: [{ befehl: 'warp_marker', clip_id: 'c1', setze: [{ quell_s: 1 }] }] });
  t.ereignis('dblclick', { offsetX: 162 });
  assert.deepEqual(t.gesendet(1).befehle, [{ befehl: 'warp_marker', clip_id: 'c1', loesche: [8] }]);
  const z = aufbau(projektMit([[0, 0], [2, 4]]));
  z.ereignis('dblclick', { offsetX: 80 });
  assert.equal(z.aufgerufen.length, 0); assert.match(z.melden[0][0], /at least two markers/); assert.equal(z.melden[0][1], true);
});

test('Rechtsklick: das Menü hat fünf Punkte; ein Punkt sendet seinen Befehl; Delete Marker ist neben einem Marker gesperrt', () => {
  const t = aufbau();
  t.ereignis('contextmenu', { offsetX: 40, clientX: 300, clientY: 90 });
  assert.equal(t.menues.length, 1); assert.deepEqual([t.menues[0].x, t.menues[0].y], [300, 90]);
  assert.deepEqual(t.menues[0].punkte.map((p) => [p.text, !!p.aus]), [['Warp From Here (Straight)', false], ['Warp From Here (Start)', false], ['Set 1.1.1 Here', false], ['Delete Marker', true], ['Quantize Audio', true]]);   // ohne Ladeweg keine Transienten: gesperrt
  t.menues[0].punkte[2].aktion();
  assert.deepEqual(t.gesendet(), { label: 'Set 1.1.1', befehle: [{ befehl: 'eins_hier', clip_id: 'c1', quell_s: 1 }] });
  t.menues[0].punkte[3].aktion();
  assert.equal(t.gesendet(1), null, 'ein gesperrter Punkt sendet nichts');
  const m = aufbau();
  m.ereignis('contextmenu', { offsetX: 80, clientX: 1, clientY: 2 });
  assert.equal(m.menues[0].punkte[3].aus, false); m.menues[0].punkte[3].aktion();
  assert.deepEqual(m.gesendet().befehle, [{ befehl: 'warp_marker', clip_id: 'c1', loesche: [4] }]);
});

test('Rechtsklick: Quantize Audio ist gesperrt ohne Transienten und sendet audio_quantisieren mit den Transienten aus dem Ladeweg (beide Aufrufe von menuPunkte)', async () => {
  const t = aufbau(projektMit(), { lage: lageMit([0.5, 1.0]) });
  await new Promise((r) => setTimeout(r, 0));
  t.ereignis('contextmenu', { offsetX: 40, clientX: 1, clientY: 2 });
  const p = t.menues[0].punkte[4];
  assert.deepEqual([p.text, !!p.aus], ['Quantize Audio', false]);
  p.aktion();
  assert.deepEqual(t.gesendet(), { label: 'Quantize audio', befehle: [{ befehl: 'audio_quantisieren', clip_id: 'c1', raster: '1/16' }] });
  // Negativkontrolle: eine Quelle ohne Transienten sperrt den Punkt, und die Aktion sendet nichts
  const leer = aufbau(projektMit(), { lage: lageMit([]) });
  await new Promise((r) => setTimeout(r, 0));
  leer.ereignis('contextmenu', { offsetX: 40, clientX: 1, clientY: 2 });
  assert.equal(leer.menues[0].punkte[4].aus, true); leer.menues[0].punkte[4].aktion();
  assert.equal(leer.gesendet(), null);
});

test('Rad: Scrollen und Zoomen verändern die Ansicht, senden nichts; ohne Clip tut der Editor nichts', () => {
  const t = aufbau();
  const vorher = t.e && t.ctx.st.editor.ansicht();
  t.ereignis('wheel', { deltaY: 200, deltaX: 0, ctrlKey: false });
  assert.ok(t.ctx.st.editor.ansicht().s0 > vorher.s0, 'Scrollen nach rechts');
  t.ereignis('wheel', { deltaY: -100, ctrlKey: true, offsetX: 80 });
  assert.ok(t.ctx.st.editor.ansicht().pxProS > vorher.pxProS, 'Strg+Rad zoomt hinein');
  assert.equal(t.aufgerufen.length, 0);
  const leer = aufbau(); leer.e.zeige(null);
  leer.ereignis('dblclick', { offsetX: 40 }); leer.ereignis('contextmenu', { offsetX: 40, clientX: 1, clientY: 1 });
  assert.deepEqual([leer.aufgerufen.length, leer.menues.length], [0, 0]);
});

test('Hook für die Browserprobe: markerFenster liefert die Fensterpixel eines Markers über seinen Beat', () => {
  const t = aufbau();
  assert.deepEqual(t.ctx.st.editor.markerFenster(4), { x: 100 + 80, y: 50 + 11 });
  assert.equal(t.ctx.st.editor.markerFenster(99), null);
});

// Slice 4, T10: die Transienten kommen einmal je Clip von GET /proj/warp und werden grau gezeichnet
const lageMit = (transienten) => () => ({ transienten_zahl: transienten.length, transienten });
const warteAuf = (f) => new Promise((ok) => setTimeout(ok, 0)).then(() => new Promise((ok) => setTimeout(ok, 0))).then(f);
test('Transienten: einmal je Clip geholt (marker_max=1, transienten_max=32768), ein zweites zeige() fragt nicht, ein Fehler zeichnet ohne', async () => {
  const t = aufbau(projektMit(), { lage: lageMit([0.5, 1.0]) });
  await warteAuf(() => {});
  assert.deepEqual(t.fragen, ['/proj/warp?clip_id=c1&marker_max=1&transienten_max=32768&transienten_quelle=1']);
  t.e.zeige(t.ctx.st.projekt.spuren[0].clips[0]); t.e.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  await warteAuf(() => {});
  assert.equal(t.fragen.length, 1, 'derselbe Clip, dieselbe Quelle: keine zweite Anfrage');
  const f = aufbau(projektMit(), { lage: () => { throw new Error('netz'); } });
  await warteAuf(() => {});
  assert.doesNotThrow(() => f.bild(), 'ein Fehler der Anfrage zeichnet ohne Transienten, ohne Meldung');
  assert.deepEqual(f.melden, []);
});
test('Transienten: noch nicht dekodiert (null) wird nicht gemerkt und beim nächsten Zeigen neu gefragt; eine andere Quelle fragt neu', async () => {
  let antwort = { transienten_zahl: null, transienten: [] };
  const t = aufbau(projektMit(), { lage: () => antwort });
  await warteAuf(() => {});
  antwort = { transienten_zahl: 1, transienten: [0.5] };
  t.e.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  await warteAuf(() => {});
  assert.equal(t.fragen.length, 2, 'null wurde nicht gemerkt');
  t.e.zeige(t.ctx.st.projekt.spuren[0].clips[0]);
  await warteAuf(() => {});
  assert.equal(t.fragen.length, 2, 'danach gemerkt');
  const c = JSON.parse(JSON.stringify(t.ctx.st.projekt.spuren[0].clips[0])); c.quelle.sha256 = 'b'.repeat(64);
  t.ctx.st.projekt.spuren[0].clips[0] = c; t.e.zeige(c);
  await warteAuf(() => {});
  assert.equal(t.fragen.length, 3, 'neue Quelle: neue Anfrage');
});
test('Transienten: gezeichnet wird je Transient im Fenster eine 1-px-Linie in der Transientenfarbe, vor den gelben Markern', async () => {
  const t = aufbau(projektMit(), { lage: lageMit([0.5, 1.0, 9]) });
  await warteAuf(() => {});
  t.rufe.length = 0; t.ctx.beimProjekt.forEach((f) => f()); t.bild();
  const linien = t.rufe.filter((r) => r[0] === 'moveTo' && r[2] === 22 && Math.abs(r[1] % 1 - 0.5) < 1e-9 && (r[1] === 20.5 || r[1] === 40.5));
  assert.equal(linien.length, 2, 'Transienten bei 20,5 und 40,5 px (die bei 9 s liegt außerhalb)');
  const farben = t.rufe.filter((r) => r[0] === 'set:strokeStyle').map((r) => r[1]);
  assert.ok(farben.indexOf('rgba(160, 165, 175, 0.45)') >= 0 && farben.indexOf('rgba(160, 165, 175, 0.45)') < farben.indexOf('#e0a83b'), 'grau vor gelb');
  const ohne = aufbau(projektMit(), { lage: lageMit([]) });
  await warteAuf(() => {}); ohne.rufe.length = 0; ohne.ctx.beimProjekt.forEach((f) => f()); ohne.bild();
  assert.equal(ohne.rufe.filter((r) => r[0] === 'set:strokeStyle' && r[1] === 'rgba(160, 165, 175, 0.45)').length, 0, 'Negativkontrolle: keine Transienten, keine graue Linie');
});

// ---- Fix-Runde Slice 4, Punkt 3: Schlüssel = Clip und Quelle; Marker ändern ihn nicht; Fehler wird gemerkt; höchstens 8 Einträge ----
const klon = (c) => JSON.parse(JSON.stringify(c));
test('Transienten-Schlüssel: Marker setzen, verschieben und löschen fragt nicht neu (kein Flackern, keine Anfrage mit bis zu 32768 Zahlen)', async () => {
  const t = aufbau(projektMit(), { lage: lageMit([0.5, 1.0]) });
  await warteAuf(() => {});
  assert.equal(t.fragen.length, 1);
  const spur = t.ctx.st.projekt.spuren[0];
  for (const marker of [[[0, 0], [1, 2], [2, 4], [4, 8]], [[0, 0], [2.5, 4], [4, 8]], [[0, 0], [4, 8]]]) {
    const c = klon(spur.clips[0]); c.warp.marker = marker;
    spur.clips[0] = c; t.e.zeige(c); t.ctx.beimProjekt.forEach((f) => f());
    await warteAuf(() => {});
  }
  assert.equal(t.fragen.length, 1, 'Marker ändern den Schlüssel nicht');
  t.rufe.length = 0; t.bild();
  assert.ok(t.rufe.some((r) => r[0] === 'set:strokeStyle' && r[1] === 'rgba(160, 165, 175, 0.45)'), 'und die Transienten bleiben sichtbar (kein Leerbild dazwischen)');
});
test('Transienten-Schlüssel (Schlussrunde: nur Clip und Quelle): Marker, Länge, Versatz und Loop fragen nicht neu, der Editor rechnet den Bereich selbst', async () => {
  const t = aufbau(projektMit(), { lage: lageMit([0.5, 1.0]) });
  await warteAuf(() => {});
  const spur = t.ctx.st.projekt.spuren[0];
  const zeige = async (f) => { const c = klon(spur.clips[0]); f(c); spur.clips[0] = c; t.e.zeige(c); t.ctx.beimProjekt.forEach((g) => g()); await warteAuf(() => {}); };
  await zeige((c) => { c.warp.marker = [[0, 0], [1, 2], [2, 4], [4, 8]]; });
  assert.equal(t.fragen.length, 1, 'Marker setzen fragt nicht');
  await zeige((c) => { c.laenge_beats = 12; });
  assert.equal(t.fragen.length, 1, 'Länge ändern fragt nicht');
  await zeige((c) => { c.warp.versatz_beats = 1; });
  assert.equal(t.fragen.length, 1, 'Versatz ändern fragt nicht');
  await zeige((c) => { c.loop_beats = 4; });
  assert.equal(t.fragen.length, 1, 'Loop ändern fragt nicht');
});
test('Transienten-Schlüssel: ein neuer Clip fragt; mehr als 8 Einträge verdrängen den ältesten', async () => {
  const t = aufbau(projektMit(), { lage: lageMit([0.5]) });
  await warteAuf(() => {});
  const spur = t.ctx.st.projekt.spuren[0];
  for (let k = 2; k <= 9; k++) { const c = klon(spur.clips[0]); c.id = `c${k}`; spur.clips.push(c); t.e.zeige(c); await warteAuf(() => {}); }
  assert.equal(t.fragen.length, 9, 'neun verschiedene Clips, neun Anfragen');
  t.e.zeige(spur.clips[8]); await warteAuf(() => {});
  assert.equal(t.fragen.length, 9, 'der jüngste ist noch gemerkt');
  t.e.zeige(spur.clips[0]); await warteAuf(() => {});
  assert.equal(t.fragen.length, 10, 'der älteste (c1) wurde verdrängt: Obergrenze 8');
  assert.equal(t.fragen[9], '/proj/warp?clip_id=c1&marker_max=1&transienten_max=32768&transienten_quelle=1');
});
test('Transienten-Schlüssel: ein Ladefehler wird für den Schlüssel gemerkt (kein Versuch bei jedem zeige()), erst nach einem Wechsel des Clips wieder', async () => {
  let kaputt = true;
  const t = aufbau(projektMit(), { lage: () => { if (kaputt) throw new Error('netz'); return { transienten_zahl: 1, transienten: [0.5] }; } });
  await warteAuf(() => {});
  const clip = t.ctx.st.projekt.spuren[0].clips[0];
  for (let i = 0; i < 5; i++) { t.e.zeige(clip); t.ctx.beimProjekt.forEach((f) => f()); await warteAuf(() => {}); }
  assert.equal(t.fragen.length, 1, 'fünfmal gezeigt, nach dem Fehler keine weitere Anfrage');
  const c2 = klon(clip); c2.id = 'c2'; t.ctx.st.projekt.spuren[0].clips.push(c2);
  kaputt = false;
  t.e.zeige(c2); await warteAuf(() => {});
  assert.equal(t.fragen.length, 2, 'Clip-Wechsel fragt');
  t.e.zeige(clip); await warteAuf(() => {});
  assert.equal(t.fragen.length, 3, 'zurück auf den Clip mit dem früheren Fehler: ein neuer Versuch, er gelingt');
  t.e.zeige(clip); await warteAuf(() => {});
  assert.equal(t.fragen.length, 3, 'danach gemerkt');
  // Antwort ohne Liste (Server meldet einen Fehler als null) zählt auch als Fehler
  const n = aufbau(projektMit(), { lage: () => null });
  await warteAuf(() => {}); n.e.zeige(n.ctx.st.projekt.spuren[0].clips[0]); await warteAuf(() => {});
  assert.equal(n.fragen.length, 1, 'null-Antwort: nicht bei jedem zeige() neu');
});

// ---- Fix-Runde Slice 4, Punkt 4: ein Pfad, ein stroke, höchstens eine Linie je Pixelspalte, die Farbe einmal je Bild ----
test('Transienten zeichnen: 32768 sichtbare Transienten werden ein Pfad mit einem stroke, höchstens eine Linie je Spalte; die Farbe wird einmal je Bild geholt', async () => {
  const viele = Array.from({ length: 32768 }, (_, i) => 0.0003 + i * (9 / 32768));      // 9 s über 400 px bei 40 px/s: sichtbar sind die ersten 10 s
  const t = aufbau(projektMit(), { lage: lageMit(viele) });
  await warteAuf(() => {});
  let farbAufrufe = 0;
  const alt = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => { farbAufrufe++; return { getPropertyValue: () => '' }; };
  try {
    t.rufe.length = 0; t.ctx.beimProjekt.forEach((f) => f());
    const t0 = performance.now(); t.bild(); const ms = performance.now() - t0;
    const i0 = t.rufe.findIndex((r) => r[0] === 'set:strokeStyle' && r[1] === 'rgba(160, 165, 175, 0.45)');
    assert.ok(i0 >= 0, 'graue Linien gezeichnet');
    let i1 = t.rufe.findIndex((r, i) => i > i0 && r[0] === 'set:strokeStyle'); if (i1 < 0) i1 = t.rufe.length;
    const grau = t.rufe.slice(i0, i1), zahl = (n) => grau.filter((r) => r[0] === n).length;
    assert.equal(zahl('beginPath'), 1, 'ein Pfad'); assert.equal(zahl('stroke'), 1, 'ein stroke');
    assert.ok(zahl('moveTo') <= 400 && zahl('moveTo') > 150, `Linien ${zahl('moveTo')}: der Clip-Bereich (8 Beats = 4 s = 160 Spalten), höchstens eine je Spalte, nicht 32768`);
    const xs = grau.filter((r) => r[0] === 'moveTo').map((r) => r[1]); assert.equal(new Set(xs).size, xs.length, 'keine Spalte doppelt');
    assert.equal(farbAufrufe, 1, 'getComputedStyle einmal je Bild');
    console.log(`# Zeichnen mit 32768 Transienten (Attrappe als Zeichenfeld, Node): ${ms.toFixed(1)} ms, ${zahl('moveTo')} Linien, ${zahl('stroke')} stroke`);
  } finally { globalThis.getComputedStyle = alt; }
});

// ---- Schlussrunde Punkt 1: die Transienten hängen an der Quelle, der Editor bildet sie selbst über die aktuellen Marker ab ----
test('Marker-Zug bringt einen Treffer ins Fenster: Quantize Audio wird freigeschaltet, ohne die Liste neu zu laden', async () => {
  // Quelle mit einem einzigen Transienten bei 5,0 s; Marker [[0,0],[2,4],[4,8]]: 5,0 s liegt bei Beat 10, hinter dem Clip (8 Beats)
  const t = aufbau(projektMit(), { lage: lageMit([5.0]) });
  await warteAuf(() => {});
  const menuPunkt = () => { t.menues.length = 0; t.ereignis('contextmenu', { offsetX: 40, clientX: 1, clientY: 2 }); return t.menues[0].punkte[4]; };
  assert.deepEqual([menuPunkt().text, menuPunkt().aus], ['Quantize Audio', true], 'vorher: kein Treffer im Clip, gesperrt');
  // der Marker bei Beat 8 wandert auf 5,2 s: 5,0 s liegt jetzt bei Beat 7,75
  const spur = t.ctx.st.projekt.spuren[0], c = JSON.parse(JSON.stringify(spur.clips[0]));
  c.warp.marker = [[0, 0], [2, 4], [5.2, 8]]; spur.clips[0] = c; t.e.zeige(c); t.ctx.beimProjekt.forEach((f) => f());
  await warteAuf(() => {});
  assert.equal(menuPunkt().aus, false, 'nach dem Zug: freigeschaltet');
  assert.equal(t.fragen.length, 1, 'und die Liste wurde nicht neu geholt');
  // Gegenprobe: der Marker zurück, wieder gesperrt
  const c2 = JSON.parse(JSON.stringify(c)); c2.warp.marker = [[0, 0], [2, 4], [4, 8]]; spur.clips[0] = c2; t.e.zeige(c2);
  assert.equal(menuPunkt().aus, true, 'Negativkontrolle: zurück gezogen, wieder gesperrt');
  assert.equal(t.fragen.length, 1);
});
test('Zeichnen folgt den Markern: ein Treffer außerhalb des Clip-Bereichs wird nicht gezeichnet, nach dem Zug schon', async () => {
  const t = aufbau(projektMit(), { lage: lageMit([5.0, 0.5]) });
  await warteAuf(() => {});
  const grau = () => { t.rufe.length = 0; t.ctx.beimProjekt.forEach((f) => f()); t.bild(); return t.rufe.filter((r) => r[0] === 'moveTo' && r[2] === 22).map((r) => r[1]); };
  assert.deepEqual(grau(), [20.5], 'nur 0,5 s (x = 20,5); 5,0 s (x = 200,5) liegt hinter dem Clip');
  const spur = t.ctx.st.projekt.spuren[0], c = JSON.parse(JSON.stringify(spur.clips[0]));
  c.warp.marker = [[0, 0], [2, 4], [5.2, 8]]; spur.clips[0] = c; t.e.zeige(c);
  assert.deepEqual(grau().sort((x, y) => x - y), [20.5, 200.5]);
});
