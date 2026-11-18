// Live container view: export, loop waveforms, commands.
import { exportiere, exportKnopf, oeffneLive, modulAnsicht, kanalAnsicht, modulHtml, faderBefehl, blendText, setzeBlend, leere, passeTonartAn, trenneNeu } from './live_module.js';   // live modules task 4
import { Kopf, leseWelle } from './wave.js';
import { kopfImLoop } from './production/timeline.js';
import { loopPosition, zeichneKopf, zeichneGrund } from './loop_wave.js';   // loop slots: waveform, grid, playhead
import { DECKS } from './curves.js';
import { faderWert, faderText } from './production/track_heads.js';
import { tasteWert, tasteMerke, reglerVonDb } from './production/fader_curve.js';
import { $, $$, melde, zustand } from './page_state.js';
import { loopAktiv } from './deck_griffe.js';
import { HINWEIS_LOOPS, loopsPlatzDa, zeigePlaetzeSpaeter } from './slots_view.js';
import { uhrKopf } from './loop_rec_view.js';
import { zeichneSeq } from './seq_view.js';
import { szenenEreignis } from './seq_szenen.js';   // SEQ places (seq-deck-s1 task 7)

// ---------- Live modules (plan live-module task 4): EXPORT at the deck loop, the live container panel, LIVE ----------
// The panel shows the open live container (project flag live): two slots, per module the module fader and one original fader per stem, CLEAR, and the
// state of the stem separation. Faders write project commands over POST /proj/aendern (one at a time, the newest value of a fader replaces a waiting one).
export const live = { kanal: '', slug: null, projekt: null, rev: null, stand: {}, stems: null, greift: 0, neuZeichnen: false, pruefen: null, schreiben: new Map(), laeuft: false, seqLaeuft: 0 };   // seqLaeuft: SEQ writes in flight (seq_view.js)
export async function holeJson(weg, daten) {
  try {
    const r = await fetch(weg, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  } catch (e) { return { status: 0, j: { fehler: 'netz', text: `page server unreachable: ${e.message}` } }; }
}
export const liveOffen = () => !!live.projekt?.live;
export function exportTaste(n) {
  const b = document.createElement('button');
  b.textContent = 'EXPORT'; b.dataset.exportloop = String(n); b.className = 'exportknopf';
  b.addEventListener('click', async () => {
    if (b.disabled) return;
    if (!liveOffen()) { melde('Open the live container first (LIVE), then export', true); return; }
    b.disabled = true;
    const r = await exportiere(n, holeJson);
    melde(r.text, !r.ok);
    zeigeExport(n);
    pruefeLiveSpaeter(0);
  });
  return b;
}
export function zeigeExport(n) {
  const z = zustand.decks[n];
  const k = exportKnopf({ loop: loopAktiv(z), geladen: !!(z?.material_id ?? zustand.geladen[n]), live: liveOffen(), loopsPlatz: loopsPlatzDa() });
  for (const b of $$(`[data-exportloop="${n}"]`)) { b.disabled = k.aus; b.title = k.titel; }
  for (const b of $$(`.deck[data-deck="${n}"] [data-nachbox]`)) { b.disabled = !loopsPlatzDa(); b.title = loopsPlatzDa() ? `Export the running loop into the loop slot L${b.dataset.nachbox} (live module, plays on the channel L${b.dataset.nachbox})` : HINWEIS_LOOPS; }   // per deck: the bar and the section hold one button each
}
export async function liveOeffnen() {
  const r = await oeffneLive(holeJson, (t) => window.confirm(t));
  if (!r.abgelehnt) melde(r.text, !r.ok);
  pruefeLiveSpaeter(0);
}
// ---------- Loop slots: waveform, beat grid and playhead (the module's loop clip, the transport of the live container) ----------
const loopWellen = new Map();   // sha -> DJKW wave, or null while it loads or when it failed
let loopFelder = [];            // [{ canvas, loop, grund: offscreen canvas | null, mass: 'w x h', pos }]
const arrKopf = new Kopf();
let arr = null, arrZeit = 0;
export function merkeArr(f) {
  arr = f; arrZeit = performance.now();
  arrKopf.melde(Number(f.projekt_beat), (uhrKopf.rate * 60000) || live.projekt?.tempo_bpm || 128, arrZeit, f.status === 2);
}
export function arrBeat(t) {
  if (!arr || arr.status !== 2 || t - arrZeit > 1000) return null;   // stale: no playhead rather than a guessed one
  return kopfImLoop(arrKopf.beat(t), live.projekt?.loop, Number(arr.projekt_beat));
}
async function holeLoopWelle(sha) {
  if (loopWellen.has(sha)) return;
  loopWellen.set(sha, null);
  try {
    const r = await fetch(`/welle?sha=${encodeURIComponent(sha)}`);
    if (!r.ok) return;
    loopWellen.set(sha, leseWelle(await r.arrayBuffer()));
    for (const f of loopFelder) if (f.loop.sha === sha) f.grund = null;   // redraw with the wave
  } catch { /* no wave: the grid still shows */ }
}
function bindeLoopWellen(ansicht) {
  loopFelder = [];
  for (const s of ansicht.slots ?? []) {
    if (!s.loop) continue;
    const canvas = $(`[data-welle-slot="${s.slot}"] canvas`, $('#live-panel'));
    if (!canvas) continue;
    loopFelder.push({ canvas, loop: s.loop, grund: null, mass: '', pos: undefined });
    holeLoopWelle(s.loop.sha);
  }
}
export function zeichneLoopWellen(jetzt) {
  if (!loopFelder.length) return;
  const beat = arrBeat(jetzt), dpr = window.devicePixelRatio || 1;
  for (const f of loopFelder) {
    const b = Math.round(f.canvas.clientWidth * dpr), h = Math.round(f.canvas.clientHeight * dpr);
    if (!b || !h) continue;   // hidden place
    const mass = `${b}x${h}`;
    if (mass !== f.mass) { f.canvas.width = b; f.canvas.height = h; f.mass = mass; f.grund = null; }
    if (!f.grund) {
      f.grund = document.createElement('canvas'); f.grund.width = b; f.grund.height = h;
      zeichneGrund(f.grund.getContext('2d'), loopWellen.get(f.loop.sha) ?? null, f.loop.beats, b, h, dpr);
      f.pos = undefined;
    }
    const pos = loopPosition(beat, f.loop);
    const px = pos === null ? null : Math.round((pos / f.loop.beats) * b);
    if (px === f.pos) continue;
    f.pos = px;
    const g = f.canvas.getContext('2d');
    g.clearRect(0, 0, b, h); g.drawImage(f.grund, 0, 0);
    zeichneKopf(g, pos, f.loop.beats, b, h, dpr);
  }
}
// Where the keyboard focus sits inside the panel (a stem or blend fader), by track or slot and stem, and the way back to it after the markup was replaced:
// the nodes are new, the focused fader is not the same node, and without the focus the next arrow key would scroll the page instead of moving the fader.
// The focus is given back with preventScroll: a fader that keeps the focus after a mouse drag must not pull the page back to it on every redraw.
function fokusMerken(p) {
  const ak = document.activeElement;
  if (!ak || !p.contains?.(ak) || !ak.matches?.('.live-regler, .live-blendregler')) return null;
  const ds = ak.dataset ?? {};
  if (ds.blend !== undefined) return { blend: true, slot: ak.closest?.('.live-slot')?.dataset?.slot, stem: ds.stem };
  return { spur: ds.spurId, neu: ds.neuFader !== undefined };
}
function fokusZurueck(p, m) {
  if (!m) return;
  const alle = [...p.querySelectorAll(m.blend ? '.live-blendregler' : '.live-regler')];
  const ziel = alle.find((r) => (m.blend ? r.dataset.stem === m.stem && r.closest('.live-slot')?.dataset.slot === m.slot
    : r.dataset.spurId === m.spur && (r.dataset.neuFader !== undefined) === m.neu));
  try { ziel?.focus({ preventScroll: true }); } catch { /* the node cannot take the focus: it stays on the page */ }
}
export function zeichneLive() {
  zeigePlaetzeSpaeter();
  zeichneSeq();   // the SEQ places read their deck from the live project
  const p = $('#live-panel');
  if (!p) return;
  if (live.greift > 0) { live.neuZeichnen = true; return; }   // a fader is under the hand: the markup stays until it is let go
  const a = modulAnsicht(live.projekt, live.stand, live.stems, zustand.regler);
  live.kanal = `${kanalAnsicht('A', zustand.regler).offen}${kanalAnsicht('B', zustand.regler).offen}`;
  p.hidden = !a.offen;
  const fokus = fokusMerken(p);
  p.innerHTML = modulHtml(a);
  bindeLoopWellen(a);
  fokusZurueck(p, fokus);
  for (const b of $$('[data-liveoeffnen]')) b.classList.toggle('an', a.offen);
  const leer = $('[data-loops-leer]'); if (leer) leer.hidden = a.offen;
  for (const n of DECKS) zeigeExport(n);
}
// What the server says now: the slug and rev first (cheap), the whole project only when the live container changed
export function pruefeLiveSpaeter(ms = 250) {
  clearTimeout(live.pruefen);
  live.pruefen = setTimeout(pruefeLive, ms);
}
export async function pruefeLive() {
  if (live.schreiben.size || live.laeuft || live.seqLaeuft) { pruefeLiveSpaeter(300); return; }
  try {
    const k = await (await fetch('/proj/aktuell?nur=rev')).json();
    if (k.slug === null || k.slug === undefined) { live.projekt = null; live.rev = null; zeichneLive(); return; }
    if (k.slug === (live.projekt ? live.slug : null) && k.rev === live.rev) return;
    if (k.slug !== 'live' && !live.projekt?.live) { if (live.rev !== null) { live.rev = null; zeichneLive(); } return; }   // a production project is open
    const j = await (await fetch('/proj/aktuell')).json();
    live.slug = j.slug; live.projekt = j.projekt?.live ? j.projekt : null; live.rev = j.projekt?.rev ?? null;
    if (j.stems) live.stems = j.stems;
    if (live.projekt) live.stand = await (await fetch('/modul/stand')).json();
    zeichneLive();
  } catch { /* the next event or reconnect tries again */ }
}
export function liveEreignis(a, f) {
  if (a === 'modul') {   // the event's stand has no key distance: read /modul/stand again (it adds tonart_abstand per slot)
    live.stand = f.stand ?? live.stand; zeichneLive();
    if (f.stand && live.projekt) fetch('/modul/stand').then((r) => r.json()).then((s) => { live.stand = s; zeichneLive(); }, () => undefined);
    return;
  }
  if (a === 'seq') { szenenEreignis(f); if (f?.rev !== live.rev) pruefeLiveSpaeter(0); return; }   // a step write of Cypher or another page: read the project when its revision differs from ours
  if (a !== 'proj') return;
  if (f?.stems) { live.stems = f.stems; if (liveOffen()) zeichneLive(); }
  if (!f?.stems || f.stems.zustand !== 'laeuft') pruefeLiveSpaeter();
}
// Faders: pump with one request in flight; a newer value of the same fader replaces the waiting one
async function liveSchreibe(schluessel, befehl, label) {
  live.schreiben.set(schluessel, { befehl, label });
  if (live.laeuft) return;
  live.laeuft = true;
  try {
    while (live.schreiben.size) {
      const [k, a] = live.schreiben.entries().next().value;
      live.schreiben.delete(k);
      let r = await holeJson('/proj/aendern', { rev: live.rev, label: a.label, befehle: [a.befehl] });
      if (r.status === 409 && r.j?.fehler === 'rev_veraltet') {   // changed elsewhere: read the new revision, write the value once more (it is absolute)
        try {   // a network error here must not end the pump: values queued meanwhile still go out, and the panel is redrawn
          const j = await (await fetch('/proj/aktuell')).json();
          if (j.projekt?.live) { live.projekt = j.projekt; live.rev = j.projekt.rev; }
          r = await holeJson('/proj/aendern', { rev: live.rev, label: a.label, befehle: [a.befehl] });
        } catch { /* r stays the 409: reported below */ }
      }
      if (r.status === 200 && r.j?.projekt) { live.projekt = r.j.projekt; live.rev = r.j.rev; } else melde(`Fader refused: ${r.j?.text ?? r.j?.fehler ?? r.status}`, true);
    }
  } finally { live.laeuft = false; }
  zeichneLive();
}
export function bindeLive() {
  const p = $('#live-panel');
  if (!p) return;
  const loslassen = () => { if (live.greift > 0) live.greift = 0; if (live.neuZeichnen) { live.neuZeichnen = false; zeichneLive(); } };
  p.addEventListener('pointerdown', (e) => { if (e.target.closest('.live-regler, .live-blendregler')) live.greift = 1; });
  window.addEventListener('pointerup', loslassen);
  window.addEventListener('pointercancel', loslassen);
  const ziel = (r) => ({ art: 'stem', id: r.dataset.spurId, name: r.closest('.live-stem').firstChild.textContent, ausgabe: '[data-stem-wert]',
    label: r.dataset.neuFader !== undefined ? 'New volume' : 'Original volume' });
  const sendeFader = (r) => {
    const z = ziel(r), db = faderWert(tasteWert(r));
    r.parentElement.querySelector(z.ausgabe).textContent = faderText(db);
    liveSchreibe(`${z.art}:${z.id}`, faderBefehl(z.art, z.id, db), `${z.label} ${z.name}`);
  };
  // Blend: absolute values, one request in flight, a newer value replaces the waiting one (POST /modul/blend, no takte)
  const blendWartet = new Map();
  let blendLaeuft = false;
  const sendeBlend = async (r) => {
    r.parentElement.querySelector('[data-blend-wert]').textContent = blendText(Number(r.value));
    blendWartet.set(`${r.closest('.live-slot').dataset.slot}/${r.dataset.stem}`, Number(r.value));
    if (blendLaeuft) return;
    blendLaeuft = true;
    try {
      while (blendWartet.size) {
        const [k, wert] = blendWartet.entries().next().value;
        blendWartet.delete(k);
        const [slot, stem] = k.split('/');
        const x = await setzeBlend(slot, stem, wert, holeJson);
        if (!x.ok) melde(x.text, true);
      }
    } finally { blendLaeuft = false; }
    pruefeLiveSpaeter(0);
  };
  p.addEventListener('keydown', (e) => { if (e.target.matches?.('.live-regler')) tasteMerke(e.target, e.key); });
  p.addEventListener('input', (e) => { if (e.target.matches?.('.live-regler')) sendeFader(e.target); else if (e.target.matches?.('.live-blendregler')) sendeBlend(e.target); });
  p.addEventListener('dblclick', (e) => {   // a stem back to 0 dB
    const r = e.target.closest?.('.live-regler');
    if (!r) return;
    r.value = String(reglerVonDb(0));
    sendeFader(r); live.greift = 0;
  });
  p.addEventListener('dblclick', (e) => {   // the blend back to the original alone
    const r = e.target.closest?.('.live-blendregler');
    if (!r) return;
    r.value = '0';
    sendeBlend(r); live.greift = 0;
  });
  p.addEventListener('click', async (e) => {
    const slot = e.target.closest('.live-slot')?.dataset.slot;
    if (!slot) return;
    if (e.target.closest('[data-leeren]')) {
      const r = await leere(slot, Number(p.querySelector(`[data-slot="${slot}"] [data-leeren-takte]`).value), holeJson);
      melde(r.text, !r.ok);
    } else if (e.target.closest('[data-key]')) {
      const r = await passeTonartAn(slot, holeJson);
      melde(r.text, !r.ok);
      pruefeLiveSpaeter(0);
    } else if (e.target.closest('[data-trennen]')) {
      const r = await trenneNeu(slot, holeJson);
      melde(r.text, !r.ok);
    }
  });
}
