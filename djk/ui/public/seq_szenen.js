// SEQ scenes, the page row #seq-szenen (plan seq-szenen, T5): eight scene buttons and a SAVE toggle. A scene is the picture of the M buttons of all SEQ decks;
// A number only launches; saving always goes SAVE, then the number (owner 2026-11-18: one click that saved on an empty slot and launched on a filled one
// was not understandable). The hint line says in words what the row holds and what the next click does.
// the server saves it from the project (the page sends only the slot, never ids) and launches it on the next bar. State comes from GET /seq/szenen, which is
// read when the row appears, when the project revision changes, on the event {a: 'seq', f: {szene: true}} and after an own request.
//
// DOM (index.html, inside #pult): section#seq-szenen: label, 8 x span.szeneplatz > button.szene[data-slot] (.leer | .voll, .aktiv lit, .wartet blinks) + button.szene-x[aria-label="clear scene"],
//   button#szene-sichern (.an while the next click saves, text SAVE TO… then), span.szenen-hinweis; the section has .sichern while SAVE is armed.
//   The nodes are built once and only updated afterwards, so the focus stays where it is.
import { $, el, melde, postJson } from './page_state.js';

const SLOTS = 8;
const leereListe = () => Array.from({ length: SLOTS }, () => null);

// Pure: the class of every slot from the answer of GET /seq/szenen (null = no answer yet).
export function szenenZeile(stand) {
  const liste = stand?.szenen ?? leereListe();
  return liste.map((s, slot) => {
    const k = ['szene', s ? 'voll' : 'leer'];
    if (s && stand?.wartet?.slot === slot) k.push('wartet'); else if (s && stand?.aktiv === slot) k.push('aktiv');
    return { slot, klasse: k.join(' ') };
  });
}
// Pure: the hint line. `sichern` = SAVE is armed.
export function szenenHinweis(stand, sichern) {
  if (!stand) return '';
  if (sichern) return 'pick a number: it stores which patterns are on and which are muted right now';
  const liste = stand.szenen ?? [];
  if (!liste.some(Boolean)) return 'no scene yet: set the M buttons of the patterns, press SAVE, then a number';
  const w = stand.wartet?.slot;
  if (Number.isInteger(w) && liste[w]) return `scene ${w + 1} switches on the next bar`;
  const a = stand.aktiv;
  if (Number.isInteger(a) && liste[a]) return `scene ${a + 1} is what plays now: ${liste[a].an} patterns on, ${liste[a].aus} muted`;
  return 'click a number to switch to that scene on the next bar';
}
// Pure: the row shows while the live project holds at least one SEQ deck (a group with a seq field).
export const szenenSichtbar = (projekt) => !!projekt?.live && (projekt.gruppen ?? []).some((g) => g.seq);

let stand = null, sichern = false, letzteRev, laedt = false, nochmal = false;
const platzKnoten = () => $('#seq-szenen');

function zeichne() {
  const w = platzKnoten();
  if (!w) return;
  for (const { slot, klasse } of szenenZeile(stand)) {
    const b = w.querySelectorAll('button.szene')[slot];
    if (!b) continue;
    b.className = klasse;
    const s = stand?.szenen?.[slot];
    b.title = s ? `Scene ${slot + 1}: ${s.an} patterns on, ${s.aus} muted. Click switches to it on the next bar` : `Scene ${slot + 1} is empty. SAVE, then ${slot + 1} stores the current M buttons here`;
    b.setAttribute('aria-pressed', String(klasse.includes('aktiv')));
    const x = w.querySelectorAll('[aria-label="clear scene"]')[slot];
    if (x) x.hidden = !s;
  }
  const sk = $('#szene-sichern', w);
  if (sk) { sk.classList.toggle('an', sichern); sk.setAttribute('aria-pressed', String(sichern)); sk.textContent = sichern ? 'SAVE TO…' : 'SAVE'; }
  w.classList.toggle('sichern', sichern);
  const h = $('.szenen-hinweis', w);
  if (h) h.textContent = szenenHinweis(stand, sichern);
}

// One read at a time. A call during a running read is not dropped: it sets a flag and the running read is followed by exactly one more, so the state
// of the last event is the state shown (a blinking slot cannot stay blinking after the scene executed).
export async function szenenLesen() {
  if (laedt) { nochmal = true; return; }
  laedt = true;
  try {
    do {
      nochmal = false;
      try {
        const r = await fetch('/seq/szenen');
        if (r.ok) stand = await r.json();
      } catch { /* the next event or redraw reads again */ }
      zeichne();
    } while (nochmal);
  } finally { laedt = false; }
}

async function sende(slot, aktion) {
  try {
    const r = await postJson('/seq/szene', { slot, aktion });
    if (!r.ok) melde(`Scene ${slot + 1}: ${r.j?.text ?? r.j?.fehler ?? `refused (${r.code})`}`, true);
  } catch (e) { melde(`Scene ${slot + 1}: ${e.message}`, true); }
  await szenenLesen();
}

function klick(slot, e) {
  const voll = !!stand?.szenen?.[slot];
  if (sichern) { sichern = false; zeichne(); sende(slot, 'speichern'); return; }   // saving is always SAVE, then the number
  if (!voll) { melde(`Scene ${slot + 1} is empty: set the M buttons, press SAVE, then ${slot + 1}`); return; }
  if (e?.shiftKey) { sende(slot, 'loeschen'); return; }
  sende(slot, 'starten');
}

// Called once with the other nodes (app.js): the markup is in index.html, the buttons are built here.
export function baueSzenen() {
  const w = platzKnoten();
  if (!w || w.querySelectorAll('button.szene').length) return;
  w.append(el('span', 'szenen-titel', 'SCENES'));
  for (let i = 0; i < SLOTS; i++) {
    const platz = el('span', 'szeneplatz');
    const b = el('button', 'szene leer', String(i + 1)); b.type = 'button'; b.dataset.slot = String(i);
    b.addEventListener('click', (e) => klick(i, e));
    const x = el('button', 'szene-x', '×'); x.type = 'button'; x.hidden = true; x.setAttribute('aria-label', 'clear scene');
    x.addEventListener('click', (e) => { e.stopPropagation?.(); sende(i, 'loeschen'); });
    platz.append(b, x); w.append(platz);
  }
  const s = el('button', 'szene-sichern', 'SAVE'); s.setAttribute('id', 'szene-sichern'); s.type = 'button';
  s.title = 'Then click a number: it stores which patterns are on and which are muted (the M buttons of all SEQ decks)';
  s.addEventListener('click', () => { sichern = !sichern; zeichne(); });
  w.append(s, el('span', 'szenen-hinweis', ''));
}

// Called with every redraw of the SEQ places (live_view.js zeichneSeq): shows or hides the row and reads the state when the project changed.
export function zeigeSzenen(projekt) {
  const w = platzKnoten();
  if (!w) return;
  baueSzenen();
  const da = szenenSichtbar(projekt);
  const war = !w.hidden;
  w.hidden = !da;
  if (!da) { letzteRev = undefined; return; }
  if (!war || projekt.rev !== letzteRev) { letzteRev = projekt.rev; szenenLesen(); }
}
// The event {a: 'seq', f: {szene: true}} of the page server (a scene was saved, launched, cleared, executed or dropped).
export function szenenEreignis(f) { if (f?.szene && !platzKnoten()?.hidden) szenenLesen(); }
