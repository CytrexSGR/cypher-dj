// Deck controls: raster, hotcues, loops, pads, handles.
import { ScrubZieher } from './scrub.js';
import { exportiereInSlot } from './live_module.js';   // live modules task 4
import { laengeFrames } from './wave.js';
import { $, $$, deckAnsicht, melde, zustand } from './page_state.js';
import { exportTaste, holeJson, liveOffen, pruefeLiveSpaeter } from './live_view.js';
import { uhrKopf } from './loop_rec_view.js';
const LOOP_LAENGEN = [1, 2, 4, 8, 16, 32, 64];                      // Plan E9: Loop-Reihe (Beats)
const FARBE_SHOT = '#58d66b', FARBE_LOOP = '#2fd6c3';       // Plan E9: Hotcue-Marken

// ---------- Deck-Bedienung (Plan E9): Raster, Sprung per Übersicht, Ziehen, Hotcues SHOT/LOOP, Loop ----------
export async function deckPost(pfad, daten, was) {
  try {
    const r = await fetch(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) });
    const j = await r.json();
    if (!r.ok) { melde(`${was}: ${j.fehler}`, true); return null; }
    return j;
  } catch { melde(`${was}: page server unreachable`, true); return null; }
}
// Plan Grid: Versatz des Rasters (Frames). Die Laufansicht hält a.raster als Objekt, die neue Linie gilt ab dem nächsten Bild.
const msText = (v) => { const ms = v / 48; return `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${Math.abs(ms).toFixed(1)} ms`; };
export async function holeRaster(n) {
  try {
    const r = await fetch(`/deck/raster?deck=${n}`);
    if (r.ok) zeigeRaster(n, await r.json());
  } catch { /* nächster Anlass: /e/raster oder nächstes Laden */ }
}
function zeigeRaster(n, j) {
  const a = deckAnsicht[n], d = $(`.deck[data-deck="${n}"]`);
  if (a.raster) a.raster.ersterSchlagFrame = a.raster.basisSchlag + j.versatz_frames;
  // ganze Beats (aus SET) getrennt vom Feinversatz: „−1b +2.0“ statt „−466.7 ms“ (kurz, sonst ragt FIX aus dem Deck)
  const fpb = a.raster?.framesProBeat, k = fpb ? Math.round(j.versatz_frames / fpb) : 0;
  $('[data-gridwert]', d).textContent = k ? `${k > 0 ? '+' : '−'}${Math.abs(k)}b ${msText(j.versatz_frames - Math.round(k * fpb)).replace(' ms', '')}` : msText(j.versatz_frames);
  $('[data-gridwert]', d).title = k ? `grid ${k} beats and ${msText(j.versatz_frames - Math.round(k * fpb))} from the analysis` : '';
  $('[data-gridfix]', d).classList.toggle('offen', j.versatz_frames !== j.gespeichert_frames);
  window.djkRaster = window.djkRaster ?? {}; window.djkRaster[n] = a.raster ? a.raster.ersterSchlagFrame - a.raster.basisSchlag : null;
}
export async function holeHotcues(n) {
  try { deckAnsicht[n].hotcues = await (await fetch(`/deck/hotcues?deck=${n}`)).json(); } catch { return; }
  zeigePads(n);
}
function zeigePads(n) {
  const h = deckAnsicht[n].hotcues ?? {};
  for (const p of $$(`.deck[data-deck="${n}"] .pad`)) {
    const e = h[p.dataset.nr];
    p.className = `pad ${e ? e.art : 'leer'}`;
    p.title = e ? `Cue ${p.dataset.nr}: ${e.art.toUpperCase()}${e.art === 'loop' ? ` ${e.laenge}` : ''} · click = play · shift+click = SHOT/LOOP · right click = delete`
      : `Cue ${p.dataset.nr}: empty · click = set here (while a loop runs: store that loop)`;
  }
}
// Marken der Wellen: Hotcues (Loop-Cues mit Bereich) und der aktive Deck-Loop (heller Bereich, ohne Nummer)
export function hotcueMarken(a) {
  if (!a.raster) return [];
  const f = (q) => a.raster.ersterSchlagFrame + q * a.raster.framesProBeat;
  const m = Object.entries(a.hotcues ?? {}).map(([nr, h]) => (h.art === 'loop'
    ? { frame: f(h.quell_beat), bis: f(h.quell_beat + (h.laenge ?? 4)), farbe: FARBE_LOOP, bereich: 'rgba(47,214,195,0.16)', text: nr }
    : { frame: f(h.quell_beat), farbe: FARBE_SHOT, text: nr }));
  if (a.loop?.laenge) m.unshift({ frame: f(a.loop.start), bis: f(a.loop.start + a.loop.laenge), farbe: '#ffd23f', bereich: 'rgba(255,210,63,0.22)' });
  return m;
}
// Aktiver Deck-Loop vom Seiten-Server (Start, Länge); geholt, wenn der Loop-Zustand des Decks kippt und nach Loop-Griffen
export async function holeLoop(n) {
  try { deckAnsicht[n].loop = await (await fetch(`/deck/loop?deck=${n}`)).json(); } catch { return; /* nächster Anlass */ }
  const l = deckAnsicht[n].loop?.laenge;   // Längenwahl folgt dem scharfen Loop (nach Neuladen stand sie sonst auf 4)
  if (l && LOOP_LAENGEN.includes(l) && l !== deckAnsicht[n].loopLaenge) {
    deckAnsicht[n].loopLaenge = l;
    for (const x of $$(`.deck[data-deck="${n}"] [data-loopl]`)) x.classList.toggle('an', Number(x.dataset.loopl) === l);
  }
}
// Loop aktiv: läuft darin (Status 3) oder scharf bei stehendem Deck (Kern meldet dann beats_bis_ende null, gemessen Instanz i)
export function loopAktiv(z) { return !!z && (z.status === 3 || (z.status >= 1 && z.beats_bis_ende === null)); }   // INFINITY kommt als null
function setzeMuell(n, an) {
  deckAnsicht[n].muell = an;
  $(`.deck[data-deck="${n}"] [data-muell]`).classList.toggle('an', an);
}
// Traktor-Weg: CUE-Art wählen (SHOT/LOOP), leeres Pad = Cue hier; gesetztes Pad = reinspringen; 🗑 dann Pad = löschen
async function padKlick(n, nr, e) {
  const a = deckAnsicht[n], h = (a.hotcues ?? {})[nr];
  let daten;
  if (e.type === 'contextmenu') { e.preventDefault(); if (!h) return; daten = { aktion: 'loeschen' }; }
  else if (a.muell) { setzeMuell(n, false); if (!h) return; daten = { aktion: 'loeschen' }; }
  else if (!h && a.cueArt === 'loop' && loopAktiv(zustand.decks[n])) daten = { aktion: 'setzen', aus_loop: true, laenge: a.loopLaenge, raster: a.rasterWahl };
  else if (!h && a.cueArt === 'loop') daten = { aktion: 'setzen', quell_beat: a.kopf.beat(performance.now()), art: 'loop', laenge: a.loopLaenge, raster: a.rasterWahl };
  else if (!h) daten = { aktion: 'setzen', quell_beat: a.kopf.beat(performance.now()), art: 'shot', raster: a.rasterWahl };
  else if (e.shiftKey) daten = { aktion: 'setzen', quell_beat: h.quell_beat, art: h.art === 'loop' ? 'shot' : 'loop', laenge: a.loopLaenge, raster: 0.25 };
  else daten = { aktion: 'spielen', raster: a.rasterWahl };
  if (await deckPost('/deck/hotcue', { deck: n, nr: Number(nr), ...daten }, `Cue ${nr}`)) { holeHotcues(n); setTimeout(() => holeLoop(n), 400); }
}
export function bindeDeckBedienung(n, d) {
  const a = deckAnsicht[n];
  a.rasterWahl = 4; a.loopLaenge = 4; a.hotcues = {}; a.zieh = 0; a.ziehBasis = null; a.cueArt = 'shot'; a.muell = false;
  for (const b of $$('[data-cueart]', d)) b.addEventListener('click', () => {
    a.cueArt = b.dataset.cueart;
    for (const x of $$('[data-cueart]', d)) x.classList.toggle('an', x === b);
  });
  $('[data-muell]', d).addEventListener('click', () => setzeMuell(n, !a.muell));
  $('[data-sync]', d).addEventListener('click', () => deckPost('/deck/start', { deck: n, ab: 'takt' }, `Sync deck ${n}`));
  // the running deck loop becomes a module of the loop slot L1 or L2 (POST /modul/export {deck, slot})
  for (const b of $$('[data-nachbox]', d)) b.addEventListener('click', async () => {
    if (!loopAktiv(zustand.decks[n])) { melde('Loop → L: no loop running on this deck', true); return; }
    if (!liveOffen()) { melde('Open the live container first (LIVE), then export', true); return; }
    const r = await exportiereInSlot(n, Number(b.dataset.nachbox), holeJson);
    melde(r.text, !r.ok);
    pruefeLiveSpaeter(0);
  });
  for (const b of $$('[data-raster]', d)) b.addEventListener('click', () => {
    a.rasterWahl = Number(b.dataset.raster);
    for (const x of $$('[data-raster]', d)) x.classList.toggle('an', x === b);
  });
  const pads = $('[data-pads]', d);
  for (let nr = 1; nr <= 8; nr++) {
    const p = document.createElement('button');
    p.className = 'pad leer'; p.dataset.nr = String(nr); p.textContent = String(nr);
    p.addEventListener('click', (e) => padKlick(n, String(nr), e));
    p.addEventListener('contextmenu', (e) => padKlick(n, String(nr), e));
    pads.append(p);
  }
  const loops = $('[data-loops]', d);
  for (const l of LOOP_LAENGEN) {
    const b = document.createElement('button');
    b.textContent = String(l); b.dataset.loopl = String(l); b.title = `Loop length ${l} beat${l > 1 ? 's' : ''}`;
    b.classList.toggle('an', l === a.loopLaenge);
    b.addEventListener('click', async () => {
      a.loopLaenge = l; for (const x of $$('[data-loopl]', d)) x.classList.toggle('an', x === b);
      // Traktor: bei laufendem Loop gilt die Länge sofort, der Start bleibt; ohne Loop nur Vorauswahl für den nächsten
      // Anzeige sofort (der Server merkt sich die Länge synchron, gemessen 3 bis 22 ms), holeLoop korrigiert
      if (!loopAktiv(zustand.decks[n])) return;
      if (a.loop?.laenge) a.loop = { ...a.loop, laenge: l };
      if (await deckPost('/deck/loop', { deck: n, laenge: l, raster: 0, behalte_start: true }, 'Loop length')) holeLoop(n);
    });
    loops.append(b);
  }
  const an = document.createElement('button');
  an.textContent = 'LOOP'; an.dataset.loopan = ''; an.title = 'Loop on/off at the snap grid';
  an.addEventListener('click', async () => {
    await deckPost('/deck/loop', { deck: n, laenge: an.classList.contains('an') ? 0 : a.loopLaenge, raster: a.rasterWahl }, 'Loop');
    holeLoop(n);
  });
  loops.append(an);
  // Loop Move (Traktor): ◀ ▶ springen um die Loop-Länge; bei scharfem Loop wandern Loop und Kopf zusammen (der Kern verschiebt den
  // Loop beim Sprung mit), ohne Loop ist es ein Beat-Jump um die gewählte Länge
  for (const [richtung, zeichen, text] of [[-1, '◀', 'left'], [1, '▶', 'right']]) {
    const m = document.createElement('button');
    m.textContent = zeichen; m.dataset.loopmove = String(richtung);
    m.title = `Loop move ${text}: jump the loop and playhead ${richtung < 0 ? 'back' : 'ahead'} by the loop length (no loop: jump by the selected length)`;
    m.addEventListener('click', async () => {
      if (loopAktiv(zustand.decks[n]) && !a.loop?.laenge) await holeLoop(n);
      const laenge = loopAktiv(zustand.decks[n]) && a.loop?.laenge ? a.loop.laenge : a.loopLaenge;
      if (await deckPost('/deck/sprung', { deck: n, delta: richtung * laenge, raster: 0 }, 'Loop move')) holeLoop(n);
    });
    loops.append(m);
  }
  loops.append(exportTaste(n));   // live modules task 4
  // Springen in der Übersicht: Klick → Quell-Beat, der Server rastet ein (stehend) bzw. hält die Phase (laufend)
  $('[data-ueber]', d).addEventListener('click', (e) => {
    if (!a.ueber.w || !a.raster) return;
    const r = e.currentTarget.getBoundingClientRect();
    const frame = (e.clientX - r.left) / r.width * laengeFrames(a.ueber.w);
    deckPost('/deck/sprung', { deck: n, ziel: (frame - a.raster.ersterSchlagFrame) / a.raster.framesProBeat, raster: a.rasterWahl }, 'Jump')
      .then(() => holeLoop(n));   // der Kern verschiebt einen scharfen Loop beim Sprung mit, der Server zieht den Start nach
  });
  // Ziehen im Zoomfenster: die Welle folgt der Hand und der Kern spielt dazu (Hörbares Ziehen, 2026-10-17: /deck/scrub, ~60 Hz,
  // roh ohne Keylock). Beim Loslassen bleibt der Kopf (stehendes Deck) bzw. läuft das Deck um die Strecke versetzt weiter (laufend,
  // derselbe Ort wie der Sprung D7 ohne Raster). Mit Loop oder wenn der Griff den Kern nicht erreicht: wie bisher stumm ziehen und
  // beim Loslassen EIN Sprung um die Strecke.
  const lauf = $('[data-lauf]', d);
  let x0 = null;
  const zieher = new ScrubZieher({ senden: async (phase, delta) => {
    try {
      const r = await fetch('/deck/scrub', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deck: n, phase, delta }) });
      return r.ok;
    } catch { return false; }
  } });
  // Nach dem Los hält die Anzeige die Zugstrecke, bis die Meldungen des Kerns den neuen Kopf tragen (stehend: der Kern schwingt aus,
  // 300 ms; laufend: bis der Kopf um die halbe Strecke vom alten Lauf abweicht), höchstens 800 ms. Ein neuer Griff gewinnt.
  const ziehNull = (delta = 0) => {
    const marke = a.ziehMarke = (a.ziehMarke ?? 0) + 1, t0 = performance.now();
    const lief = a.ziehBasis === null, q0 = a.kopf.beat(t0), u0 = uhrKopf.beat(t0);
    const iv = setInterval(() => {
      if (x0 !== null || marke !== a.ziehMarke) { clearInterval(iv); return; }
      const jetzt = performance.now();
      const gelandet = lief ? Math.abs(a.kopf.beat(jetzt) - (q0 + uhrKopf.beat(jetzt) - u0)) > 0.5 * Math.abs(delta) : jetzt - t0 > 300;
      if (gelandet || jetzt - t0 > 800) { a.zieh = 0; a.ziehBasis = null; clearInterval(iv); }
    }, 20);
  };
  lauf.addEventListener('pointerdown', (e) => {
    if (a.raster && a.lauf.w) {
      x0 = e.clientX; lauf.setPointerCapture(e.pointerId);
      zieher.beginne(!loopAktiv(zustand.decks[n]));
      // stehendes Deck: die Meldungen des Kerns folgen der Hand, die Anzeige hält darum den Griffpunkt fest (laufend: Kopf + Strecke)
      a.ziehBasis = (zustand.decks[n]?.status ?? 0) < 2 ? a.raster.ersterSchlagFrame + a.kopf.beat(performance.now()) * a.raster.framesProBeat : null;
    }
  });
  lauf.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    const fpp = a.lauf.takte * 4 * a.raster.framesProBeat / lauf.getBoundingClientRect().width;
    a.zieh = -(e.clientX - x0) * fpp;
    zieher.bewege(e.clientX - x0, a.zieh / a.raster.framesProBeat);
  });
  const los = async (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0, delta = a.zieh / a.raster.framesProBeat;
    x0 = null;
    const r = await zieher.ende(delta);
    if (Math.abs(dx) < 3) { a.zieh = 0; a.ziehBasis = null; return; }
    if (r.gescrubbt && r.griffOk) { ziehNull(delta); return; }
    await deckPost('/deck/sprung', { deck: n, delta, raster: 0 }, 'Drag');
    holeLoop(n);   // ein scharfer Loop wandert mit
    a.zieh = 0; a.ziehBasis = null;
  };
  lauf.addEventListener('pointerup', los);
  lauf.addEventListener('pointercancel', () => { const delta = a.zieh / a.raster.framesProBeat; x0 = null; zieher.abbruch(); ziehNull(delta); });
  // Plan Grid (D4): ◀ ▶ 5 ms, Shift 1 ms; Rechtsklick auf den Wert: zurück auf die Analyse (0); FIX speichert
  for (const b of $$('[data-gridschritt]', d)) b.addEventListener('click', async (e) => {
    const j = await deckPost('/deck/raster', { deck: n, schritt_ms: Number(b.dataset.gridschritt) * (e.shiftKey ? 1 : 5) }, 'Grid');
    if (j) zeigeRaster(n, j);
  });
  $('[data-gridwert]', d).addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const j = await deckPost('/deck/raster', { deck: n, versatz_frames: 0 }, 'Grid');
    if (j) zeigeRaster(n, j);
  });
  // SET (Traktor „Set Grid Marker“): nur bei stehendem Deck; der Schlag unter dem Kopf wird Takt-Eins
  $('[data-gridset]', d).addEventListener('click', async () => {
    if ((zustand.decks[n]?.status ?? 0) >= 2) { melde('Grid SET: stop the deck on the downbeat first', true); return; }
    const j = await deckPost('/deck/raster', { deck: n, set: true }, 'Grid SET');
    if (j) zeigeRaster(n, j);
  });
  $('[data-gridfix]', d).addEventListener('click', async () => {
    const j = await deckPost('/deck/raster/fix', { deck: n }, 'Grid FIX');
    if (j) zeigeRaster(n, j);
  });
}
