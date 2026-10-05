// djk cues: Trackliste links, 3-Band-Wellenform rechts, Hotcues per Taste. Abspielen nur auf Klick oder Leertaste.
import { cuePosition, naechsterTakt, schlagS, springe, taktS, taktSchlag, ersteEinsS, TAKTE_JE_PHRASE, loopFelder, naechsteLoopLaenge } from './raster.js';
import { erzeugeSpieler } from './spieler.js';

const $ = (id) => document.getElementById(id);
const SLOTS = 8;
const SLOT_FARBEN = ['#2fd6c3', '#58d66b', '#e0a33e', '#ff5a1f', '#d45cf0', '#3b8cff', '#f5e05a', '#e8e8ec'];
const PRESETS = [
  { taste: 'i', name: 'intro', farbe: '#58d66b' }, { taste: 'u', name: 'build', farbe: '#e0a33e' },
  { taste: 'd', name: 'drop', farbe: '#ff5a1f' }, { taste: 'b', name: 'break', farbe: '#3b8cff' },
  { taste: 'v', name: 'vocal', farbe: '#d45cf0' }, { taste: 'o', name: 'outro', farbe: '#2fd6c3' },
  { taste: null, name: 'mix in', farbe: '#f5e05a' }, { taste: null, name: 'mix out', farbe: '#e8e8ec' },
];
const ZOOMS = [2, 4, 8, 16, 32];
const BAND = { tief: '#2f6bff', mitte: '#f0a030', hoch: '#f2f2f2' };
const VERST = [0.95, 1.05, 1.4]; // Anzeige-Verstärkung tief/mitte/hoch (hohe Bänder tragen weniger Energie)

const z = {
  alle: [], listen: [], sicht: [], sort: { feld: 'titel', ab: false }, rel: null, track: null,
  welle: null, dauer: 0, raster: null, cues: new Map(), traktor: null, quant: true, zoomI: 2, pos: 0, letzterSlot: null,
  speichernTimer: null, laedt: 0, ladezeiten: [], popSlot: null, aktivLoop: null, zeichenzeiten: [],
};
window.__cues = z; // für die Prüfung (pruef/bild.mjs)

// Abspielen über die schmale Schnittstelle (spieler.js): nativer Vorhörer, wenn der Server mit --ausgang läuft,
// sonst Browser-Fallback <audio>. Welcher Weg aktiv ist, zeigt spieler.weg und die Kopfzeile (siehe kopfAktualisieren).
const spieler = await erzeugeSpieler();
const audio = spieler.audio ?? null; // nur im Browser-Fallback gesetzt
window.__audio = audio; // für die Prüfung (play()-Zähler, paused) — im Vorhörer-Weg null
window.__spieler = spieler; // für die Prüfung (Loop-Rücksprung-Fehler)
window.__zoomFenster = (w) => zoomFenster(w); // für die Prüfung (px_pro_s beim Grid-Zug)
// Welcher Weg spielt ab: nativer Vorhörer (Ziel, Andreas 2026-09-26: "browser dann nur anzeige") oder Browser-
// Fallback (ohne --ausgang am Server, oder wenn der Vorhörer-Start scheitert).
$('weg').textContent = spieler.weg === 'vorhoerer' ? 'VORHÖRER' : 'BROWSER AUDIO (FALLBACK)';
$('weg').classList.toggle('warnung', spieler.weg !== 'vorhoerer');
// Für die Prüfung: n Live-Neuzeichnungen wie beim Grid-Ziehen (setzeEinsLive), Zeit je Aufruf in ms
window.__benchZeichnen = (n = 120) => {
  const zeiten = [];
  const start = z.raster.eins_s;
  for (let i = 0; i < n; i++) { const t0 = performance.now(); setzeEinsLive(start + (i % 2 ? 0.001 : -0.001)); zeiten.push(performance.now() - t0); }
  setzeEinsLive(start);
  return zeiten;
};

// ---------- Bibliothek ----------
function camelotSchluessel(k) { if (!k) return 999; const m = /^(\d+)([AB])$/.exec(k); return m ? Number(m[1]) * 2 + (m[2] === 'B' ? 1 : 0) : 998; }
function nachbarn(k) {
  const m = /^(\d+)([AB])$/.exec(k); if (!m) return new Set([k]);
  const n = Number(m[1]); const l = m[2]; const um = (x) => ((x + 11) % 12) + 1;
  return new Set([k, `${n}${l === 'A' ? 'B' : 'A'}`, `${um(n - 1)}${l}`, `${um(n + 1)}${l}`]);
}

async function ladeBibliothek() {
  const d = await (await fetch('/api/tracks')).json();
  z.alle = d.tracks;
  z.listen = d.listen;
  const ts = $('tonart');
  for (let n = 1; n <= 12; n++) for (const l of ['A', 'B']) ts.add(new Option(`${n}${l}`, `${n}${l}`));
  for (const l of d.listen) $('liste').add(new Option(`${l.name} (${l.rels.length})`, l.name));
  filtere();
}

function filtere() {
  const q = $('suche').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const von = Number($('bpm-von').value) || 0;
  const bis = Number($('bpm-bis').value) || 999;
  const k = $('tonart').value;
  const ks = k ? ($('kompatibel').checked ? nachbarn(k) : new Set([k])) : null;
  const liste = z.listen.find((l) => l.name === $('liste').value);
  const lset = liste ? new Set(liste.rels) : null;
  const cf = $('cuefilter').value;
  let s = z.alle.filter((t) => {
    if (lset && !lset.has(t.rel)) return false;
    if (t.bpm != null && (t.bpm < von || t.bpm > bis)) return false;
    if (t.bpm == null && (von > 0 || bis < 999)) return false;
    if (ks && !ks.has(t.tonart)) return false;
    if (cf === 'ohne' && t.cues > 0) return false;
    if (cf === 'mit' && t.cues === 0) return false;
    if (cf === 'traktor' && !t.traktor) return false;
    if (q.length) { const h = `${t.titel ?? ''} ${t.artist ?? ''}`.toLowerCase(); if (!q.every((w) => h.includes(w))) return false; }
    return true;
  });
  const { feld, ab } = z.sort;
  const wert = (t) => feld === 'tonart' ? camelotSchluessel(t.tonart) : t[feld];
  s.sort((a, b) => {
    const x = wert(a); const y = wert(b);
    let c = typeof x === 'string' || typeof y === 'string' ? String(x ?? '').localeCompare(String(y ?? ''), 'en', { sensitivity: 'base' }) : (x ?? -1) - (y ?? -1);
    if (c === 0) c = String(a.titel).localeCompare(String(b.titel));
    return ab ? -c : c;
  });
  if (liste && feld === 'titel' && !z.sortGeklickt) s = liste.rels.map((r) => s.find((t) => t.rel === r)).filter(Boolean);
  z.sicht = s;
  zeichneListe();
}

function zeichneListe() {
  const tb = $('zeilen');
  const f = document.createDocumentFragment();
  for (const t of z.sicht) {
    const tr = document.createElement('tr');
    tr.dataset.rel = t.rel;
    if (t.rel === z.rel) tr.className = 'aktiv';
    const cz = t.cues === 0 ? 'null' : t.cues >= 4 ? 'voll' : 'teil';
    tr.innerHTML = `<td></td><td></td><td class="zahl">${t.bpm != null ? fmtBpm(t.bpm) : '–'}</td><td>${t.tonart ?? '–'}</td><td class="zahl">${t.energie ?? '–'}</td><td class="zahl"><span class="cz ${cz}">${t.cues}</span>${t.traktor ? '<span class="tk" title="Old Traktor cues available">T</span>' : ''}</td>`;
    tr.children[0].textContent = t.titel ?? t.rel;
    tr.children[0].title = t.rel;
    tr.children[1].textContent = t.artist ?? '';
    f.append(tr);
  }
  tb.replaceChildren(f);
  for (const th of document.querySelectorAll('thead th')) th.className = `${th.classList.contains('zahl') ? 'zahl ' : ''}${th.dataset.sort === z.sort.feld ? (z.sort.ab ? 'ab' : 'auf') : ''}`;
  const mit = z.alle.filter((t) => t.cues > 0).length;
  $('bibfuss').textContent = `${z.sicht.length} of ${z.alle.length} tracks shown · ${mit} with cues`;
}

function fmtBpm(b) { return Number.isInteger(b) ? String(b) : b.toFixed(2); }
function fmtZeit(s) { if (!Number.isFinite(s)) return '–'; const m = Math.floor(s / 60); const r = s - m * 60; return `${m}:${r.toFixed(1).padStart(4, '0')}`; }

// ---------- Track laden (ohne Abspielen) ----------
async function oeffne(rel) {
  const t = z.alle.find((x) => x.rel === rel);
  if (!t) return;
  const nr = ++z.laedt;
  const t0 = performance.now();
  spieler.setzeLoop(null, null); z.aktivLoop = null;
  spieler.pause();
  if (z.speichernTimer) { clearTimeout(z.speichernTimer); await speichern(); }
  z.rel = rel; z.track = t; z.welle = null; z.cues = new Map(); z.traktor = null; z.pos = 0; z.letzterSlot = null; z.raster = null;
  schliessePopover();
  spieler.laden(rel);
  $('titel').textContent = t.titel ?? rel;
  $('meta').textContent = 'loading waveform …';
  markiereZeile();
  const [w, c] = await Promise.all([
    fetch(`/api/welle?rel=${encodeURIComponent(rel)}`).then(async (r) => { if (!r.ok) throw new Error((await r.json()).fehler); return { b: await r.arrayBuffer(), cache: r.headers.get('x-aus-cache') === 'true', ms: Number(r.headers.get('x-ms')) }; }),
    fetch(`/api/cues?rel=${encodeURIComponent(rel)}`).then((r) => r.json()),
  ]).catch((e) => { ansage(`Could not load: ${e.message}`, true); return [null, null]; });
  if (nr !== z.laedt || !w) return;
  z.welle = leseWelle(w.b);
  z.dauer = z.welle.dauer;
  z.traktor = c.traktor;
  const bpm = c.datei?.raster?.bpm ?? t.bpm ?? 120;
  if (c.datei?.raster) z.raster = { bpm, eins_s: c.datei.raster.eins_s, quelle: c.datei.raster.quelle };
  else if (c.traktor?.raster_s != null && (!c.traktor.bpm || Math.abs(c.traktor.bpm - bpm) < 0.5)) z.raster = { bpm, eins_s: c.traktor.raster_s, quelle: 'traktor' };
  else z.raster = { bpm, eins_s: autoEins(), quelle: 'auto' };
  for (const q of c.datei?.cues ?? []) z.cues.set(q.slot, q);
  if (c.datei && !c.schluessel_passt) ansage('Note: the MP3 changed since these cues were saved (size or first MiB differ).', true);
  zeichneMeta(); zeichnePads(); zeichneVorschlaege(); zeichneKopf();
  zeichneUebersicht(); zeichneZoom();
  const ms = performance.now() - t0;
  z.ladezeiten.push({ rel, ms: Math.round(ms), server_ms: w.ms, aus_cache: w.cache });
  if (!(c.datei && !c.schluessel_passt)) ansage(`Loaded in ${Math.round(ms)} ms${w.cache ? ' (cached waveform)' : ' (waveform computed)'}`);
}

function markiereZeile() {
  for (const tr of $('zeilen').querySelectorAll('tr.aktiv')) tr.classList.remove('aktiv');
  const tr = $('zeilen').querySelector(`tr[data-rel="${CSS.escape(z.rel)}"]`);
  if (tr) { tr.classList.add('aktiv'); tr.scrollIntoView({ block: 'nearest' }); }
}

function leseWelle(buf) {
  const dv = new DataView(buf);
  const rahmen = dv.getUint32(8, true); const rate = dv.getUint32(12, true); const rs = dv.getUint32(16, true);
  const roh = new Uint8Array(buf, 32, rahmen * 6);
  const lin = new Float32Array(rahmen * 6);
  for (let i = 0; i < lin.length; i++) lin[i] = (roh[i] / 255) ** 2; // Datei: sqrt-verdichtet, hier wieder linear
  // Anzeige je Track normiert: RMS auf das 99,5-%-Perzentil der Summen-RMS, Spitzen auf das der Summen-Spitze
  const pz = (f) => { const a = new Float32Array(rahmen); for (let i = 0; i < rahmen; i++) a[i] = f(i); a.sort(); return a[Math.floor(rahmen * 0.995)] || 1; };
  const R = pz((i) => Math.hypot(lin[i * 6 + 1], lin[i * 6 + 3], lin[i * 6 + 5]));
  const P = pz((i) => Math.max(lin[i * 6], lin[i * 6 + 2], lin[i * 6 + 4]));
  const v = new Float32Array(rahmen * 6);
  for (let i = 0; i < rahmen; i++) for (let k = 0; k < 3; k++) {
    v[i * 6 + 2 * k] = Math.min(1.1, VERST[k] * (lin[i * 6 + 2 * k] / P) ** 0.9);
    v[i * 6 + 2 * k + 1] = Math.min(1.1, VERST[k] * 1.25 * (lin[i * 6 + 2 * k + 1] / R) ** 0.9);
  }
  return { rahmen, rahmenS: rs / rate, dauer: dv.getFloat32(20, true), v, lin };
}

// Vorschlag ohne Traktor-Raster: erster Rahmen, in dem das tiefe Band (RMS) 35 % seines 99. Perzentils erreicht
function autoEins() {
  const { v, rahmen, rahmenS } = z.welle;
  const tief = []; for (let i = 0; i < rahmen; i++) tief.push(z.welle.lin[i * 6 + 1]);
  const s = [...tief].sort((a, b) => a - b); const p99 = s[Math.floor(s.length * 0.99)] || 1;
  const i = tief.findIndex((x) => x >= 0.35 * p99);
  return Math.max(0, i) * rahmenS;
}

function zeichneMeta() {
  const t = z.track;
  const e = document.createElement('span');
  e.innerHTML = `<b></b> · <b>${t.bpm != null ? fmtBpm(t.bpm) : '–'}</b> BPM · <b>${t.tonart ?? '–'}</b> · energy <b>${t.energie ?? '–'}</b> · ${fmtZeit(z.dauer)} · ${Math.floor((z.dauer - ersteEinsS(z.raster)) / taktS(z.raster))} bars`;
  e.firstChild.textContent = t.artist ?? '–';
  $('meta').replaceChildren(e);
}

function zeichneKopf() {
  const s = aktPos();
  $('zeit').textContent = z.welle ? fmtZeit(s) : '–';
  $('bpm').textContent = z.raster ? fmtBpm(z.raster.bpm) : '–';
  if (z.raster) {
    const ts = taktSchlag(z.raster, s);
    $('takt').textContent = `${ts.takt}.${ts.schlag}`;
    [...$('schlaege').children].forEach((i, n) => i.classList.toggle('an', n < ts.schlag && ts.takt >= 1));
  }
  $('quant').classList.toggle('an', z.quant);
  $('rasterquelle').textContent = `GRID ${z.raster ? z.raster.quelle.toUpperCase() : '–'}`;
  $('spiel').textContent = spieler.paused ? 'PLAY' : 'PAUSE';
  $('spiel').classList.toggle('laeuft', !spieler.paused);
}

function ansage(text, warnung = false) { const a = $('ansage'); a.textContent = text; a.classList.toggle('warnung', warnung); }

// ---------- Zeichnen ----------
function leinwand(c) {
  const r = c.getBoundingClientRect();
  const d = window.devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * d) || c.height !== Math.round(r.height * d)) { c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); }
  const g = c.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  return { g, w: r.width, h: r.height };
}

// Spalte von Rahmen a bis b: Maximum je Band, groß nach klein gezeichnet, damit alle drei sichtbar bleiben.
// feld 1 = RMS (deckend), feld 0 = Spitze (durchscheinend, nur im Zoom)
function spalte(g, x, bx, a, b, mitte, halb, feld = 1, alpha = 1) {
  const { v, rahmen } = z.welle;
  a = Math.max(0, Math.floor(a)); b = Math.min(rahmen, Math.max(a + 1, Math.ceil(b)));
  let t = 0, m = 0, h = 0;
  for (let i = a; i < b; i++) { const o = i * 6 + feld; if (v[o] > t) t = v[o]; if (v[o + 2] > m) m = v[o + 2]; if (v[o + 4] > h) h = v[o + 4]; }
  const baender = [[t, BAND.tief], [m, BAND.mitte], [h, BAND.hoch]].sort((p, q) => q[0] - p[0]);
  g.globalAlpha = alpha;
  for (const [wert, farbe] of baender) {
    const y = Math.min(1, wert) * halb;
    g.fillStyle = farbe;
    g.fillRect(x, mitte - y, bx, Math.max(1, 2 * y));
  }
  g.globalAlpha = 1;
}

function zeichneUebersicht() {
  const { g, w, h } = leinwand($('uebersicht'));
  g.clearRect(0, 0, w, h);
  if (!z.welle) return;
  const n = z.welle.rahmen;
  for (let x = 0; x < w; x++) spalte(g, x, 1, (x / w) * n, ((x + 1) / w) * n, h / 2, h / 2 - 4);
  const sx = (s) => (s / z.dauer) * w;
  // Phrasen (16 Takte) als feine Striche oben
  g.fillStyle = '#8a8d98';
  for (let s = ersteEinsS(z.raster); s < z.dauer; s += taktS(z.raster) * TAKTE_JE_PHRASE) g.fillRect(Math.round(sx(s)), 0, 1, 5);
  for (const c of vorschlagsListe()) { g.fillStyle = '#9a9ca4'; g.fillRect(Math.round(sx(c.s)), h - 7, 1, 7); }
  // Loop-Bänder unter den Cue-Marken
  for (const c of z.cues.values()) if (c.laenge_takte) { g.globalAlpha = 0.22; g.fillStyle = c.farbe; g.fillRect(sx(c.s), 0, Math.max(1, sx(c.ende_s) - sx(c.s)), h); g.globalAlpha = 1; }
  for (const c of z.cues.values()) { g.fillStyle = c.farbe; g.fillRect(Math.round(sx(c.s)) - 1, 0, 2, h); g.beginPath(); g.moveTo(sx(c.s) - 5, 0); g.lineTo(sx(c.s) + 5, 0); g.lineTo(sx(c.s), 7); g.fill(); }
  g.fillStyle = '#ffffff'; g.fillRect(Math.round(sx(aktPos())) - 1, 0, 2, h);
}

function zoomFenster(w) {
  const sichtS = ZOOMS[z.zoomI] * taktS(z.raster);
  const s = aktPos();
  return { von: s - sichtS / 2, sichtS, pxS: w / sichtS };
}

function zeichneZoom() {
  const { g, w, h } = leinwand($('zoom'));
  g.clearRect(0, 0, w, h);
  if (!z.welle) return;
  const { von, sichtS, pxS } = zoomFenster(w);
  const rs = z.welle.rahmenS;
  const oben = 22;
  const mitte = oben + (h - oben) / 2;
  const halb = (h - oben) / 2 - 6;
  // Wellenform
  for (let x = 0; x < w; x += 1) {
    const s0 = von + x / pxS; const s1 = von + (x + 1) / pxS;
    if (s1 < 0 || s0 > z.dauer) continue;
    spalte(g, x, 1, s0 / rs, s1 / rs, mitte, halb, 0, 0.35);
    spalte(g, x, 1, s0 / rs, s1 / rs, mitte, halb, 1, 1);
  }
  // Raster: Schläge, Takte, Phrasen
  const b = schlagS(z.raster);
  const e = ersteEinsS(z.raster);
  const k0 = Math.ceil((von - e) / b); const k1 = Math.floor((von + sichtS - e) / b);
  g.font = '600 11px system-ui, sans-serif';
  for (let k = k0; k <= k1; k++) {
    const s = e + k * b; if (s < 0 || s > z.dauer) continue;
    const x = Math.round((s - von) * pxS) + 0.5;
    const istTakt = ((k % 4) + 4) % 4 === 0;
    const takt = Math.floor(k / 4) + 1;
    const istPhrase = istTakt && ((takt - 1) % TAKTE_JE_PHRASE + TAKTE_JE_PHRASE) % TAKTE_JE_PHRASE === 0;
    g.fillStyle = istPhrase ? 'rgba(224,163,62,.9)' : istTakt ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.14)';
    g.fillRect(x - (istPhrase ? 1 : 0.5), oben, istPhrase ? 2 : 1, h - oben);
    if (istTakt && (ZOOMS[z.zoomI] <= 16 || (takt - 1) % 4 === 0)) { g.fillStyle = istPhrase ? '#e0a33e' : '#8a8d98'; g.fillText(String(takt), x + 4, 15); }
  }
  // Traktor-Vorschläge grau gestrichelt
  g.setLineDash([4, 4]);
  for (const c of vorschlagsListe()) {
    const x = Math.round((c.s - von) * pxS) + 0.5; if (x < 0 || x > w) continue;
    g.strokeStyle = '#9a9ca4'; g.beginPath(); g.moveTo(x, oben); g.lineTo(x, h); g.stroke();
    g.fillStyle = '#9a9ca4'; g.fillText(`T${c.slot ?? ''} ${c.label}`, x + 4, h - 8);
  }
  g.setLineDash([]);
  // Loop-Bänder
  for (const c of z.cues.values()) if (c.laenge_takte) {
    const x0 = Math.round((c.s - von) * pxS); const x1 = Math.round((c.ende_s - von) * pxS);
    if (x1 < 0 || x0 > w) continue;
    g.globalAlpha = z.aktivLoop?.slot === c.slot ? 0.38 : 0.22;
    g.fillStyle = c.farbe; g.fillRect(Math.max(0, x0), oben, Math.min(w, x1) - Math.max(0, x0), h - oben);
    g.globalAlpha = 1;
  }
  // Hotcues
  for (const c of z.cues.values()) {
    const x = Math.round((c.s - von) * pxS); if (x < -60 || x > w) continue;
    g.fillStyle = c.farbe; g.fillRect(x - 1, oben, 2, h - oben);
    const text = `${c.slot}${c.name ? ` ${c.name}` : ''}`;
    const tw = g.measureText(text).width + 12;
    g.fillRect(x, oben, tw, 18);
    g.fillStyle = '#0e0f12'; g.font = '700 12px system-ui, sans-serif'; g.fillText(text, x + 6, oben + 13); g.font = '600 11px system-ui, sans-serif';
  }
  // Abspielkopf in der Mitte
  g.fillStyle = '#ff3b3b'; g.fillRect(Math.round(w / 2) - 1, 0, 2, h);
  g.beginPath(); g.moveTo(w / 2 - 6, 0); g.lineTo(w / 2 + 6, 0); g.lineTo(w / 2, 8); g.fill();
}

function zeichneAlles() { zeichneKopf(); zeichneUebersicht(); zeichneZoom(); }

function zeichnePads() {
  const f = document.createDocumentFragment();
  for (let n = 1; n <= SLOTS; n++) {
    const c = z.cues.get(n);
    const d = document.createElement('div');
    d.className = `pad${c ? ' gesetzt' : ''}`;
    d.dataset.slot = n;
    if (c) {
      d.style.setProperty('--farbe', c.farbe);
      d.className += c.laenge_takte ? ' loop' : '';
      if (z.aktivLoop?.slot === n) d.className += ' aktiv';
      const ts = taktSchlag(z.raster, c.s);
      const zeit = c.laenge_takte ? `bar ${ts.takt}.${ts.schlag}–${taktSchlag(z.raster, c.ende_s).takt}.${taktSchlag(z.raster, c.ende_s).schlag}` : `bar ${ts.takt}.${ts.schlag} · ${fmtZeit(c.s)}`;
      d.innerHTML = `<div class="nr">${n}</div><div class="name"></div><div class="zeit">${zeit}</div>`;
      d.querySelector('.name').textContent = c.name || '—';
    } else d.innerHTML = `<div class="nr">${n}</div><div class="leer">press ${n} to set</div>`;
    f.append(d);
  }
  $('pads').replaceChildren(f);
}

// Traktor-Cues für die Chips/Übernahme; typ 5 = Loop (LEN in Sekunden) -> Takte auf die nächste Zweierpotenz gerundet
function vorschlagsListe() {
  if (!z.traktor) return [];
  return z.traktor.cues.map((c) => {
    const slot = c.hotcue >= 0 && c.hotcue < SLOTS ? c.hotcue + 1 : null;
    let label = c.name && c.name !== 'n.n.' ? c.name : c.typ_name;
    let laenge_takte, abweichung;
    if (c.typ === 5 && c.laenge_s > 0 && z.raster) {
      const takteExakt = c.laenge_s / taktS(z.raster);
      laenge_takte = naechsteLoopLaenge(takteExakt);
      abweichung = Math.abs(laenge_takte - takteExakt) / takteExakt;
      label = `${label} ${laenge_takte}`;
    }
    return { ...c, slot, label, laenge_takte, abweichung };
  });
}

function zeichneVorschlaege() {
  const v = vorschlagsListe();
  const box = $('vorschlaege');
  if (!v.length) { box.textContent = z.traktor ? 'Traktor: no cues for this track' : 'Traktor: track not in collection.nml'; return; }
  const f = document.createDocumentFragment();
  const lab = document.createElement('span'); lab.textContent = 'Traktor (T takes all):'; f.append(lab);
  for (const c of v) {
    const chip = document.createElement('span');
    const schon = [...z.cues.values()].some((q) => Math.abs(q.s - c.s) < 0.05);
    const warnung = c.abweichung > 0.02;
    chip.className = `chip${schon ? ' uebernommen' : ''}`;
    chip.textContent = `${c.slot ? `${c.slot} · ` : ''}${c.label} ${fmtZeit(c.s)}${warnung ? ' ⚠' : ''}`;
    chip.title = warnung ? `Click: jump here · loop length rounded, off by ${(c.abweichung * 100).toFixed(1)}%` : 'Click: jump here';
    chip.onclick = () => setzePos(c.s);
    f.append(chip);
  }
  box.replaceChildren(f);
}

// ---------- Position, Abspielen ----------
function aktPos() { return spieler.paused ? z.pos : spieler.position(); }
function setzePos(s) {
  if (!z.welle) return;
  if (z.aktivLoop) { verlasseLoop(); }
  z.pos = Math.min(Math.max(0, s), z.dauer - 0.01);
  spieler.springe(z.pos);
  zeichneAlles();
}
function spielPause() {
  if (!z.welle) return;
  if (spieler.paused) { spieler.springe(z.pos); spieler.play().catch((e) => ansage(`Playback failed: ${e.message}`, true)); }
  else { spieler.pause(); z.pos = spieler.position(); }
  zeichneKopf();
}
spieler.on('pause', (s) => { z.pos = s; zeichneAlles(); });
spieler.on('ended', () => { z.pos = z.dauer; z.aktivLoop = null; spieler.setzeLoop(null, null); zeichneAlles(); });

// ---------- Loops ----------
function loopCueBei(s) {
  for (const c of z.cues.values()) if (c.laenge_takte && s >= c.s - 1e-6 && s < c.ende_s - 1e-6) return c;
  return null;
}
function aktiviereLoop(cue, einstieg = aktPos()) {
  if (!cue || !cue.laenge_takte) return;
  z.aktivLoop = { slot: cue.slot, start: cue.s, ende: cue.ende_s };
  spieler.setzeLoop(cue.s, cue.ende_s);
  z.pos = Math.min(Math.max(einstieg, cue.s), cue.ende_s - 0.001);
  spieler.springe(z.pos);
  z.letzterSlot = cue.slot;
  zeichneKopf();
}
function verlasseLoop() {
  if (!z.aktivLoop) return;
  spieler.setzeLoop(null, null);
  z.aktivLoop = null;
  z.pos = aktPos();
  zeichneAlles();
}
function naechsterFreierSlot() { for (let i = 1; i <= SLOTS; i++) if (!z.cues.has(i)) return i; return null; }
function setzeLoop(takte) {
  if (!z.welle) return;
  const slot = naechsterFreierSlot();
  if (!slot) { ansage('All 8 slots full', true); return; }
  const s = cuePosition(z.raster, aktPos(), z.quant, z.dauer);
  const felder = { laenge_takte: takte, name: `loop ${takte}`, ...loopFelder(z.raster, s, takte) };
  z.cues.set(slot, { slot, s, farbe: SLOT_FARBEN[slot - 1], quantisiert: z.quant, ...felder });
  nachAenderung(slot);
  aktiviereLoop(z.cues.get(slot), s);
}

function schleife() {
  const t0 = performance.now();
  if (!spieler.paused) {
    zeichneAlles();
    if (!z.aktivLoop) { const c = loopCueBei(spieler.position()); if (c) aktiviereLoop(c, spieler.position()); }
  }
  z.zeichenzeiten.push(performance.now() - t0);
  if (z.zeichenzeiten.length > 600) z.zeichenzeiten.shift();
  requestAnimationFrame(schleife);
}

// ---------- Cues ----------
function setzeCue(slot, s = aktPos(), extra = {}) {
  const alt = z.cues.get(slot);
  const pos = extra.exakt ? s : cuePosition(z.raster, s, z.quant, z.dauer);
  const felder = { ...extra.felder };
  if (felder.laenge_takte) Object.assign(felder, loopFelder(z.raster, pos, felder.laenge_takte));
  z.cues.set(slot, { slot, s: pos, name: alt?.name ?? '', farbe: alt?.farbe ?? SLOT_FARBEN[slot - 1], quantisiert: extra.exakt ? false : z.quant, ...felder });
  z.letzterSlot = slot;
  nachAenderung(slot);
}
function loescheCue(slot) {
  if (z.aktivLoop?.slot === slot) verlasseLoop();
  if (!z.cues.delete(slot)) return;
  if (z.letzterSlot === slot) z.letzterSlot = null;
  nachAenderung();
}
function benenne(slot, name, farbe) { const c = z.cues.get(slot); if (!c) return; c.name = name; if (farbe) c.farbe = farbe; nachAenderung(slot); }
function nachAenderung(frischSlot) {
  zeichnePads(); zeichneVorschlaege(); zeichneAlles();
  if (frischSlot) { const p = $('pads').querySelector(`[data-slot="${frischSlot}"]`); p?.classList.add('frisch'); }
  planeSpeichern();
}

function uebernimmTraktor() {
  let n = 0;
  for (const c of vorschlagsListe()) {
    if ([...z.cues.values()].some((q) => Math.abs(q.s - c.s) < 0.05)) continue;
    let slot = c.slot && !z.cues.has(c.slot) ? c.slot : null;
    for (let i = 1; !slot && i <= SLOTS; i++) if (!z.cues.has(i)) slot = i;
    if (!slot) break;
    const felder = { slot, s: c.s, name: c.label, farbe: SLOT_FARBEN[slot - 1], quantisiert: false };
    if (c.laenge_takte) Object.assign(felder, { laenge_takte: c.laenge_takte, ...loopFelder(z.raster, c.s, c.laenge_takte) });
    z.cues.set(slot, felder);
    n++;
  }
  ansage(n ? `Took ${n} Traktor cue${n > 1 ? 's' : ''}` : 'No Traktor cues to take (none, already taken, or all 8 slots full)');
  if (n) nachAenderung();
}

function planeSpeichern() { clearTimeout(z.speichernTimer); z.speichernTimer = setTimeout(speichern, 150); }
async function speichern() {
  z.speichernTimer = null;
  if (!z.rel || !z.raster) return;
  const rel = z.rel;
  const koerper = { raster: z.raster, cues: [...z.cues.values()].map(({ slot, s, name, farbe, quantisiert, gesetzt }) => ({ slot, s, name, farbe, quantisiert, gesetzt })) };
  try {
    const r = await fetch(`/api/cues?rel=${encodeURIComponent(rel)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(koerper) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.fehler);
    const t = z.alle.find((x) => x.rel === rel);
    if (t) { t.cues = d.datei?.cues.length ?? 0; const zelle = $('zeilen').querySelector(`tr[data-rel="${CSS.escape(rel)}"] .cz`); if (zelle) { zelle.textContent = t.cues; zelle.className = `cz ${t.cues === 0 ? 'null' : t.cues >= 4 ? 'voll' : 'teil'}`; } }
    if (rel === z.rel && d.datei) for (const c of d.datei.cues) { const q = z.cues.get(c.slot); if (q && Math.abs(q.s - c.s) < 1e-3) Object.assign(q, c); }
    ansage(`Saved ${new Date().toLocaleTimeString('en-GB')} · ${d.datei?.cues.length ?? 0} cues`);
    const mit = z.alle.filter((x) => x.cues > 0).length;
    $('bibfuss').textContent = `${z.sicht.length} of ${z.alle.length} tracks shown · ${mit} with cues`;
  } catch (e) { ansage(`Save failed: ${e.message}`, true); }
}

// ---------- Raster ----------
// Takt-Eins setzen ohne zu speichern (für flüssiges Ziehen mit der Maus, siehe binde() #zoom mousemove); G, [/],
// Shift+[/] und ein losgelassener Grid-Zug rufen setzeEins auf, das zusätzlich speichert.
function setzeEinsLive(s) { z.raster = { ...z.raster, eins_s: Math.max(0, s), quelle: 'andreas' }; zeichneMeta(); zeichnePads(); zeichneAlles(); }
function setzeEins(s) { setzeEinsLive(s); planeSpeichern(); }
function schiebeRaster(ds) { setzeEins(z.raster.eins_s + ds < 0 ? z.raster.eins_s + ds + taktS(z.raster) : z.raster.eins_s + ds); }

// ---------- Popover ----------
function oeffnePopover(slot, el) {
  const c = z.cues.get(slot); if (!c) return;
  z.popSlot = slot;
  const p = $('popover');
  const pr = $('presets'); pr.replaceChildren();
  for (const x of PRESETS) { const b = document.createElement('button'); b.textContent = x.taste ? `${x.name} (${x.taste.toUpperCase()})` : x.name; b.style.setProperty('--farbe', x.farbe); b.onclick = () => { benenne(slot, x.name, x.farbe); schliessePopover(); }; pr.append(b); }
  const fa = $('farben'); fa.replaceChildren();
  for (const f of [...new Set([...SLOT_FARBEN, '#ff3b5c'])]) { const b = document.createElement('button'); b.style.setProperty('--farbe', f); b.className = f === c.farbe ? 'an' : ''; b.onclick = () => { benenne(slot, c.name, f); oeffnePopover(slot, el); }; fa.append(b); }
  $('cuename').value = c.name;
  const r = el.getBoundingClientRect();
  p.hidden = false;
  p.style.left = `${Math.min(window.innerWidth - 312, r.left)}px`;
  p.style.top = `${r.top - p.offsetHeight - 8}px`;
  $('cuename').focus();
}
function schliessePopover() { $('popover').hidden = true; z.popSlot = null; if (document.activeElement === $('cuename')) $('cuename').blur(); }

// ---------- Eingabe ----------
function naechster(d) {
  if (!z.sicht.length) return;
  const i = z.sicht.findIndex((t) => t.rel === z.rel);
  const j = i < 0 ? 0 : Math.min(z.sicht.length - 1, Math.max(0, i + d));
  if (z.sicht[j].rel !== z.rel) oeffne(z.sicht[j].rel);
}

document.addEventListener('keydown', (e) => {
  const imFeld = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (imFeld) {
    if (e.key === 'Escape') { document.activeElement.blur(); if (!$('popover').hidden) schliessePopover(); e.preventDefault(); }
    else if (e.key === 'Enter' && document.activeElement === $('cuename')) { benenne(z.popSlot, $('cuename').value.trim()); schliessePopover(); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === 'ArrowDown') { if (document.activeElement === $('suche')) { document.activeElement.blur(); naechster(z.rel ? 1 : 0); e.preventDefault(); } }
    return;
  }
  if (e.ctrlKey || e.metaKey) return;
  const ziffer = /^(Digit|Numpad)([1-8])$/.exec(e.code);
  if (ziffer && z.welle) {
    const slot = Number(ziffer[2]);
    if (e.shiftKey) loescheCue(slot);
    else if (e.altKey || !z.cues.has(slot)) setzeCue(slot);
    else { const c = z.cues.get(slot); setzePos(c.s); if (c.laenge_takte) aktiviereLoop(c, c.s); z.letzterSlot = slot; }
    e.preventDefault(); return;
  }
  const preset = PRESETS.find((p) => p.taste && p.taste === e.key.toLowerCase());
  if (preset && !e.shiftKey && !e.altKey && z.letzterSlot && z.cues.has(z.letzterSlot)) { benenne(z.letzterSlot, preset.name, preset.farbe); e.preventDefault(); return; }
  const r = z.raster;
  switch (e.key) {
    case ' ': spielPause(); break;
    case 'ArrowRight': if (z.welle) setzePos(springe(r, aktPos(), e.shiftKey ? TAKTE_JE_PHRASE : 1, z.dauer)); break;
    case 'ArrowLeft': if (z.welle) setzePos(springe(r, aktPos(), e.shiftKey ? -TAKTE_JE_PHRASE : -1, z.dauer)); break;
    case 'PageDown': if (z.welle) setzePos(springe(r, aktPos(), TAKTE_JE_PHRASE, z.dauer)); break;
    case 'PageUp': if (z.welle) setzePos(springe(r, aktPos(), -TAKTE_JE_PHRASE, z.dauer)); break;
    case 'Home': if (z.welle) setzePos(e.shiftKey ? 0 : ersteEinsS(r)); break;
    case 'Enter': case 'ArrowDown': naechster(1); break;
    case 'ArrowUp': naechster(-1); break;
    case 'q': case 'Q': z.quant = !z.quant; zeichneKopf(); ansage(`Quantize ${z.quant ? 'on: cues snap to the nearest bar' : 'off: cues land exactly at the playhead'}`); break;
    case 'g': case 'G': if (z.welle) setzeEins(aktPos()); break;
    case '[': if (z.welle) schiebeRaster(e.shiftKey ? -schlagS(r) : -0.005); break;
    case ']': if (z.welle) schiebeRaster(e.shiftKey ? schlagS(r) : 0.005); break;
    case '{': if (z.welle) schiebeRaster(-schlagS(r)); break;
    case '}': if (z.welle) schiebeRaster(schlagS(r)); break;
    case '+': case '=': z.zoomI = Math.max(0, z.zoomI - 1); zeichneZoom(); break;
    case '-': case '_': z.zoomI = Math.min(ZOOMS.length - 1, z.zoomI + 1); zeichneZoom(); break;
    case 't': case 'T': if (z.welle) uebernimmTraktor(); break;
    case '/': case 'f': case 'F': $('suche').focus(); $('suche').select(); break;
    case 'l': case 'L':
      if (z.aktivLoop) verlasseLoop();
      else setzeLoop(e.altKey ? 16 : e.shiftKey ? 8 : 4);
      break;
    case 'Escape': schliessePopover(); verlasseLoop(); break;
    default: return;
  }
  e.preventDefault();
});

function binde() {
  for (const id of ['suche', 'bpm-von', 'bpm-bis']) $(id).addEventListener('input', filtere);
  for (const id of ['tonart', 'kompatibel', 'liste', 'cuefilter']) $(id).addEventListener('change', () => { z.sortGeklickt = false; filtere(); $(id).blur(); });
  document.querySelector('thead').addEventListener('click', (e) => {
    const f = e.target.closest('th')?.dataset.sort; if (!f) return;
    z.sort = { feld: f, ab: z.sort.feld === f ? !z.sort.ab : ['energie', 'cues'].includes(f) };
    z.sortGeklickt = true; filtere();
  });
  $('zeilen').addEventListener('click', (e) => { const tr = e.target.closest('tr'); if (tr) oeffne(tr.dataset.rel); });
  $('spiel').addEventListener('click', (e) => { spielPause(); e.currentTarget.blur(); });
  $('quant').addEventListener('click', (e) => { z.quant = !z.quant; zeichneKopf(); e.currentTarget.blur(); });
  $('vorrechnen').addEventListener('click', async (e) => {
    e.currentTarget.blur();
    const an = !e.currentTarget.classList.contains('laeuft');
    await fetch(`/api/vorrechnen?an=${an ? 1 : 0}`, { method: 'POST' });
    pruefeVorrechnen();
  });
  $('uebersicht').addEventListener('mousedown', (e) => { if (!z.welle) return; const r = e.currentTarget.getBoundingClientRect(); setzePos(((e.clientX - r.left) / r.width) * z.dauer); });
  // Zoom: Ziehen mit gedrückter Maus, 60 fps ohne Neuladen (Andreas, 2026-09-26: "flüssiger das grid links rechts
  // schieben"). Shift+Ziehen oder Ziehen an der Taktzahl-Leiste (y < 22, siehe zeichneZoom "oben") verschiebt die
  // Takt-Eins live und speichert erst beim Loslassen; Ziehen ohne Taste scrollt (scrubt) durch den Track; Mausrad
  // zoomt (+/− wie die Tasten).
  $('zoom').addEventListener('mousedown', (e) => {
    if (!z.welle) return;
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    z.ziehen = { modus: e.shiftKey || y < 22 ? 'grid' : 'scroll', startX: e.clientX, startEins: z.raster.eins_s, startPos: aktPos(), breite: r.width };
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!z.ziehen || !z.welle) return;
    const { pxS } = zoomFenster(z.ziehen.breite);
    const dx = e.clientX - z.ziehen.startX;
    if (z.ziehen.modus === 'grid') setzeEinsLive(Math.max(0, z.ziehen.startEins + dx / pxS));
    else setzePos(z.ziehen.startPos - dx / pxS);
  });
  window.addEventListener('mouseup', () => {
    if (!z.ziehen) return;
    if (z.ziehen.modus === 'grid') planeSpeichern();
    z.ziehen = null;
  });
  $('zoom').addEventListener('wheel', (e) => { if (!z.welle) return; e.preventDefault(); z.zoomI = Math.min(ZOOMS.length - 1, Math.max(0, z.zoomI + Math.sign(e.deltaY))); zeichneZoom(); }, { passive: false });
  $('pads').addEventListener('click', (e) => {
    const p = e.target.closest('.pad'); if (!p) return;
    const slot = Number(p.dataset.slot);
    if (!z.cues.has(slot)) { if (z.welle) setzeCue(slot); return; }
    if (e.target.closest('.name')) oeffnePopover(slot, p);
    else { const c = z.cues.get(slot); setzePos(c.s); if (c.laenge_takte) aktiviereLoop(c, c.s); z.letzterSlot = slot; }
  });
  $('pads').addEventListener('contextmenu', (e) => { const p = e.target.closest('.pad'); if (p && z.cues.has(Number(p.dataset.slot))) { e.preventDefault(); oeffnePopover(Number(p.dataset.slot), p); } });
  $('popzu').addEventListener('click', () => { if (z.popSlot) benenne(z.popSlot, $('cuename').value.trim()); schliessePopover(); });
  $('cueweg').addEventListener('click', () => { if (z.popSlot) loescheCue(z.popSlot); schliessePopover(); });
  window.addEventListener('resize', zeichneAlles);
}

async function pruefeVorrechnen() {
  try {
    const d = await (await fetch('/api/status')).json();
    const v = d.vorrechnen;
    const b = $('vorrechnen');
    b.classList.toggle('laeuft', v.laeuft);
    b.textContent = v.laeuft ? `PRECOMPUTE ${v.fertig}/${v.gesamt}${v.pausiert_last ? ' · WAIT LOAD' : ''}` : v.gesamt ? `PRECOMPUTED ${v.fertig}/${v.gesamt}` : 'PRECOMPUTE';
    if (v.laeuft) setTimeout(pruefeVorrechnen, 2000);
  } catch { /* Server weg */ }
}

binde();
ladeBibliothek().then(() => { pruefeVorrechnen(); zeichneKopf(); });
requestAnimationFrame(schleife);
