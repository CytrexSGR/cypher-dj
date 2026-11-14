// Live modules (plan live-module task 4): the page side of the export button and the live container panel of the DJ view. Only pure parts here
// (model, markup, commands, calls with an injected holeJson), so they run in node tests; app.js binds them to the DOM.
// The panel reads the open project (GET /proj/aktuell: the module tree), GET /modul/stand (separation state per slot) and the proj_stems state (percent).
// Faders in the slot go through the project commands (spur_aendern for an original fader), never through /regler; the module itself is played with the
// strip of its channel (pad/1, pad/2).
import { REGLER_MAX, REGLER_SCHRITT, reglerVonDb } from './production/fader_curve.js';
import { faderText } from './production/track_heads.js';
import { loopVonGruppe } from './loop_wave.js';

export const SLOTS = ['A', 'B'];
export const LEER_TAKTE = [0, 1, 2, 4, 8, 16];   // the bars modul_leeren accepts
export const LEER_TAKTE_VORGABE = 4;
// The page says Loop 1 / Loop 2 for the slots A / B (A and B are the crossfader sides); the server answers with the stored letter
export const loopName = (slot) => (slot === 'B' || slot === 2 ? 'Loop 2' : 'Loop 1');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const prozentVon = (stand) => (stand.prozent == null && stand.stufe === 'schreiben' ? 100 : stand.prozent);

function zustandVon(hatStems, st, stems) {
  if (hatStems || st?.stems === 'fertig') return { art: 'bereit', text: 'READY', prozent: null };
  if (st?.stems === 'wartet') return { art: 'trennt', text: 'SEPARATING', prozent: null };
  if (st?.stems === 'laeuft') {
    const unser = stems && stems.zustand === 'laeuft' && stems.auftrag_id === st.auftrag_id;
    const p = unser && prozentVon(stems) != null ? Math.round(Math.max(0, Math.min(100, prozentVon(stems)))) : null;
    return { art: 'trennt', text: p == null ? 'SEPARATING' : `SEPARATING ${p} %`, prozent: p };
  }
  if (st?.stems === 'fehler') return { art: 'fehler', text: st.text ?? st.grund ?? 'the separation failed', prozent: null };
  return { art: 'fehler', text: 'the stems are not separated', prozent: null };
}

// Key distance of a slot (task 11, GET /modul/stand tonart_abstand): semitones adapting would still move, null when a key is unknown or no deck plays.
export function tonartAnsicht(st) {
  const a = st?.tonart_abstand;
  if (typeof a !== 'number') return { abstand: null, aus: true, text: 'KEY', titel: `Key unknown or no deck on the master (${st?.tonart_grund ?? 'no deck'})` };
  if (a === 0) return { abstand: 0, aus: true, text: 'KEY 0', titel: `In key with the deck on the master${st?.deck_tonart ? ` (${st.deck_tonart})` : ''}` };
  return { abstand: a, aus: false, text: `KEY ${a > 0 ? '+' : '−'}${Math.abs(a)}`, titel: `Transpose this module by ${a > 0 ? '+' : ''}${a} semitones to the deck on the master` };
}
// The channel a slot plays on (DJ view places, ADR 037): slot A is Loop 1 on pad/1, slot B is Loop 2 on pad/2. The page says Loop 1 / Loop 2; A and B
// are the crossfader sides. `regler` is the row table of the page (zustand.regler). Open = trim plus fader above -26 dB, the rule of kanalOffen in
// hand_operation.ts (unknown fader -200, unknown trim 0); the page copy with its parity test comes with slots.js (plan task 13).
export const KANAL_OFFEN_DB = -26;
export function kanalAnsicht(slot, regler) {
  const nr = slot === 'A' ? 1 : 2, pfad = `pad/${nr}`;
  const offen = (regler?.[`${pfad}/trim`] ?? 0) + (regler?.[`${pfad}/fader`] ?? -200) > KANAL_OFFEN_DB;
  return { nr, pfad, name: `Loop ${nr}`, offen, text: `Loop ${nr} · ${offen ? 'open' : 'closed'}`,
    titel: `Loop ${nr} plays on the channel ${pfad} (strip L${nr}): ${offen ? 'open, the module is on the master' : 'closed, listen on PFL; open the channel fader to bring it in'}` };
}

// projekt = the open project (or null), stand = GET /modul/stand, stems = the proj_stems state ({auftrag_id, zustand, prozent}) or null,
// regler = the row table of the page (channel state of pad/1, pad/2)
export function modulAnsicht(projekt, stand, stems, regler = {}) {
  if (!projekt?.live) return { offen: false, slots: [] };
  const slots = SLOTS.map((slot) => {
    const g = (projekt.gruppen ?? []).find((x) => x.ausgang === undefined && x.modul?.slot === slot);
    const kanal = kanalAnsicht(slot, regler);
    if (!g) return { slot, kanal, leer: true, zustand: { art: 'leer', text: 'EMPTY', prozent: null }, stems: [] };
    const kinder = (projekt.gruppen ?? []).filter((x) => x.ausgang?.id === g.id);
    const stemsListe = kinder.map((k) => {
      const o = (projekt.spuren ?? []).find((s) => s.ausgang?.id === k.id && s.art === 'audio');
      const n = (projekt.spuren ?? []).find((s) => s.ausgang?.id === k.id && s.art === 'instrument');   // task 8: the new path of Drums and Bass
      return o ? { name: k.name, stem: k.name.toLowerCase(), gruppeId: k.id, spurId: o.id, faderDb: o.fader_db,
        ...(n ? { neu: { spurId: n.id, faderDb: n.fader_db }, blend: k.blend ?? 0 } : {}) } : null;
    }).filter(Boolean);
    const m = g.modul;
    return { slot, kanal, leer: false, gruppeId: g.id, loop: loopVonGruppe(projekt, g.id), titel: m.titel, kuenstler: m.kuenstler, bpm: m.bpm, tonart: m.tonart, beats: m.laenge_beats,
      faderDb: g.fader_db, zustand: zustandVon(stemsListe.length > 0, stand?.[slot]?.stems, stems), stems: stemsListe,
      tonartStand: tonartAnsicht(stand?.[slot]) };
  });
  return { offen: true, slots };
}

export const blendText = (w) => `${Math.round(w * 100)} %`;
const regler = (db, attr) => `<input type="range" class="live-regler" min="0" max="${REGLER_MAX}" step="${REGLER_SCHRITT}" value="${reglerVonDb(db)}" ${attr}>`;
function slotHtml(s) {
  const z = s.zustand;
  if (s.leer) {
    return `<section data-slot="${s.slot}" class="live-slot leer"><div class="live-kopf"><b class="live-buchstabe" title="${esc(s.kanal.titel)}">${s.kanal.nr}</b>`
      + `<span class="live-leer">EMPTY</span><span class="live-hinweis" data-kanal-zustand>${esc(s.kanal.text)}</span>`
      + `<span class="live-hinweis">Set a loop on a deck and press EXPORT</span></div></section>`;
  }
  const meta = [s.kuenstler, `${Number(s.bpm).toFixed(0)} BPM`, s.tonart, `${s.beats} beats`].filter((x) => x !== '' && x != null).map(esc).join(' · ');
  const zeichen = z.art === 'fehler' ? 'LOOP ONLY' : z.text;
  const fortschritt = z.prozent != null ? ` style="--fortschritt:${z.prozent}%"` : '';
  const grund = z.art === 'fehler' ? `<span class="live-grund" title="${esc(z.text)}">${esc(z.text)}</span>` : '';
  const stems = s.stems.map((x) => `<label class="live-stem"><span class="live-stemname">${esc(x.name)}</span>`
    + `${regler(x.faderDb, `data-stem-fader data-spur-id="${esc(x.spurId)}" title="Original ${esc(x.name)} (${esc(s.slot)}): double click for 0 dB"`)}`
    + `<output data-stem-wert>${faderText(x.faderDb)}</output></label>`
    + (x.neu ? `<label class="live-stem live-neu"><span class="live-stemname">NEW</span>`
      + `${regler(x.neu.faderDb, `data-neu-fader data-spur-id="${esc(x.neu.spurId)}" title="New ${esc(x.name)} instrument (${esc(s.slot)}): double click for 0 dB"`)}`
      + `<output data-stem-wert>${faderText(x.neu.faderDb)}</output></label>`
      + `<label class="live-stem live-blend"><span class="live-stemname">BLEND</span>`
      + `<input type="range" class="live-blendregler" min="0" max="1" step="0.01" value="${x.blend}" data-blend data-stem="${esc(x.stem)}" `
      + `title="Blend ${esc(x.name)} (${esc(s.slot)}): original (left) to new instrument (right), double click for the original">`
      + `<output data-blend-wert>${blendText(x.blend)}</output></label>` : '')).join('');
  const takte = LEER_TAKTE.map((t) => `<option value="${t}"${t === LEER_TAKTE_VORGABE ? ' selected' : ''}>${t === 0 ? 'now' : `${t} bar${t > 1 ? 's' : ''}`}</option>`).join('');
  return `<section data-slot="${s.slot}" class="live-slot ${z.art}" data-gruppe-id="${esc(s.gruppeId)}">`
    + `<div class="live-kopf"><b class="live-buchstabe" title="${esc(s.kanal.titel)}">${s.kanal.nr}</b>`
    + `<div class="live-titel"><b title="${esc(s.titel)}">${esc(s.titel)}</b><span>${meta}</span><span data-kanal-zustand title="${esc(s.kanal.titel)}">${esc(s.kanal.text)}</span></div>`
    + `<div class="live-zustand ${z.art}"${fortschritt}><span>${esc(zeichen)}</span>${grund}</div>`
    + (z.art === 'fehler' ? `<button class="live-knopf" data-trennen title="Separate the stems of this module again">SEPARATE</button>` : '')
    + `<button class="live-knopf live-key" data-key${s.tonartStand.aus ? ' disabled' : ''} title="${esc(s.tonartStand.titel)}">${esc(s.tonartStand.text)}</button>`
    + `<div class="live-leeren"><select data-leeren-takte title="Fade out over this many bars, then empty the slot">${takte}</select>`
    + `<button class="live-knopf live-loeschen" data-leeren title="Fade the module out and empty ${loopName(s.slot)}">CLEAR</button></div></div>`
    + (s.loop ? `<div class="live-welle" data-welle-slot="${esc(s.slot)}" title="${esc(loopName(s.slot))}: waveform, beat grid and playhead of the loop"><canvas></canvas></div>` : '')
    + (s.stems.length ? `<div class="live-stems">${stems}</div>` : '') + `</section>`;
}
export function modulHtml(ansicht) { return ansicht.offen ? ansicht.slots.map(slotHtml).join('') : ''; }

// The project command for a fader: an original fader is the fader of the original track. The module has no fader of its own on the page: the strip of
// its channel (L1, L2) is the gain, and the group fader stays at 0 dB (DJ view places, decision 9); 'modul' is kept for callers that write it.
export function faderBefehl(art, id, db) {
  return art === 'modul' ? { befehl: 'gruppenspur_aendern', gruppe_id: id, fader_db: db } : { befehl: 'spur_aendern', spur_id: id, fader_db: db };
}

// EXPORT at a deck: on while a loop runs on a loaded track. The slot is not chosen: the server takes the first free slot with a closed channel (kanal_offen when every free one is open, slot_belegt when both are taken).
export function exportKnopf({ loop, geladen, live, loopsPlatz = true }) {
  if (!loopsPlatz) return { aus: true, titel: 'EXPORT is off: switch a place to LOOPS' };   // DJ view places: the slots are shown in the Loops place
  if (!geladen) return { aus: true, titel: 'Load a library track on this deck first' };
  if (!loop) return { aus: true, titel: 'EXPORT needs a running loop: set a loop on this deck first' };
  if (!live) return { aus: false, titel: 'Export this loop as a live module (open the live container first with LIVE)' };
  return { aus: false, titel: 'Export this loop as a live module: the first free loop slot with a closed channel (Loop 1, else Loop 2)' };
}

const grundVon = (j) => j?.text ?? j?.fehler ?? 'unknown';
export async function exportiere(deck, holeJson) {
  const r = await holeJson('/modul/export', { deck });
  return r.status === 200 ? { ok: true, slot: r.j?.slot, text: `Exported to ${loopName(r.j?.slot)}` } : { ok: false, text: `Export refused: ${grundVon(r.j)}` };
}
// The loop buttons of the deck (LOOP -> L1/L2) and of the library (LOAD L1/L2) address a slot by its number; the server stores the letters A and B.
export const slotBuchstabe = (nr) => (nr === 2 || nr === 'B' ? 'B' : 'A');
export async function exportiereInSlot(deck, nr, holeJson) {
  const slot = slotBuchstabe(nr);
  const r = await holeJson('/modul/export', { deck, slot });
  return r.status === 200 ? { ok: true, slot, text: `Exported to ${loopName(slot)}` } : { ok: false, text: `Export refused: ${grundVon(r.j)}` };
}
// A library loop becomes a module of the slot (POST /modul/loop {name, slot}, plan task 10)
export async function ladeLoopInSlot(name, nr, holeJson) {
  const slot = slotBuchstabe(nr);
  const r = await holeJson('/modul/loop', { name, slot });
  return r.status === 200 ? { ok: true, slot, text: `“${name}” loaded into ${loopName(slot)}` } : { ok: false, text: `Loop load refused: ${grundVon(r.j)}` };
}
export async function leere(slot, takte, holeJson) {
  const r = await holeJson('/modul/leeren', { slot, takte });
  return r.status === 200 ? { ok: true, text: `${loopName(slot)} is clearing` } : { ok: false, text: `Clear refused: ${grundVon(r.j)}` };
}
export async function trenneNeu(slot, holeJson) {
  const r = await holeJson('/modul/stems', { slot });
  return r.status === 200 ? { ok: true, text: `Separating ${loopName(slot)}` } : { ok: false, text: `Separation refused: ${grundVon(r.j)}` };
}
// LIVE: opens the live container; when the server refuses with live_laeuft (a running live container would be stopped) Andreas confirms first
export async function oeffneLive(holeJson, frage) {
  let r = await holeJson('/live/oeffnen', {});
  if (r.status === 409 && r.j?.fehler === 'live_laeuft') {
    if (!frage('The live container is running while a deck plays. Opening it again stops the modules. Open anyway?')) {
      return { ok: false, text: 'Live container not opened', abgelehnt: true };
    }
    r = await holeJson('/live/oeffnen', { bestaetigt: true });
  }
  return r.status === 200 ? { ok: true, text: 'Live container open' } : { ok: false, text: `Live container refused: ${grundVon(r.j)}` };
}

// A blend change: POST /modul/blend without takte (at once). The answer carries no project; the page reads it from the next project event.
export async function setzeBlend(slot, stem, wert, holeJson) {
  const r = await holeJson('/modul/blend', { slot, stem, wert });
  return r.status === 200 ? { ok: true, text: `Blend ${stem} ${blendText(wert)}` } : { ok: false, text: `Blend refused: ${grundVon(r.j)}` };
}
// KEY: adapts the module to the key of the deck on the master (POST /modul/tonart)
export async function passeTonartAn(slot, holeJson) {
  const r = await holeJson('/modul/tonart', { slot });
  return r.status === 200 ? { ok: true, text: `${loopName(slot)} adapted to the key` } : { ok: false, text: `Key refused: ${grundVon(r.j)}` };
}
