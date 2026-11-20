// The loop channel strips L1 / L2, the REC button and the loop list of the LOOPS tab.
import { LOOPBOXEN } from './curves.js';
import { Kopf } from './wave.js';
import { ladeInDeck, ladeLoopInSpur } from './loopdeck/view.js';   // the LOOPS tab loads into a loop deck cell
import { quelleZiehbar } from './loopdeck/drag.js';
import { $, $$, melde, zustand } from './page_state.js';
import { filtere, zeigeReiterInfo } from './seitenrahmen.js';
export let recBeats = 4, recLaeuft = false, recAktiv = '', recZiel = null;   // recZiel: { deck, spur } of a Strudel sum recording that goes into a loop deck  // MVP 2 Scheibe 2: REC-Knopf im Kopf von C; recAktiv = Name des eigenen REC

// ---------- Strom vom Seiten-Server (Kern) ----------
// ---------- Loop channel strips (MVP 2, ADR 025; places plan task 12: the loop fields are gone, the strips L1 and L2 stay) ----------
// L1 and L2 are the channel strips of pad/1 and pad/2; the live modules play on them.
export const BOXEN = LOOPBOXEN.map((_, i) => i + 1);
export const uhrKopf = new Kopf();                               // Master-Beat, hochgerechnet (Spec E4)

export function baueLoopZuege() {
  for (const n of BOXEN) {
    const k = LOOPBOXEN[n - 1];
    const z = $(`.zug[data-boxzug="${n}"]`);
    z.append($('#zug-vorlage').content.cloneNode(true));
    for (const e of $$('[data-teil]', z)) e.dataset.pfad = `${k}/${e.dataset.teil}`;
    for (const e of $$('[data-wert-teil]', z)) e.dataset.wert = `${k}/${e.dataset.wertTeil}`;
    $('[data-kanal]', z).dataset.kanal = k;
    for (const b of $$('[data-fxzuweisung]', z)) b.dataset.kanal = k;
  }
}

// MVP 2 Scheibe 2 (§4.9 /k/loop/rec): REC-Knopf mit Längenwahl 1/2/4/8 im Kopf von C. Name c-<hhmmss>-<n>t.
// MVP 2 Scheibe 3 (E3): Längen in Beats; Anzeige in Takten (¼ ½ 1 2 4 8)
export const taktText = (beats) => (beats === 1 ? '¼ bar' : beats === 2 ? '½ bar' : `${beats / 4} bar${beats > 4 ? 's' : ''}`);

function recName(beats) {
  const d = new Date();
  const z = (x) => String(x).padStart(2, '0');
  return `c-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}-${beats}b`;
}

// Anzeige wie im Kern: Einsatz auf dem nächsten Vielfachen von 4·N Beats (Schätzung aus der Uhr beim Klick).
export let letzterBeat = null, recPlan = null, recFertigZeit = 0;
export function zeigeRec(beat) {
  const k = $('#rec-knopf');
  if (!recLaeuft || !recPlan || beat == null) return;
  const warten = beat < recPlan.start;
  k.classList.toggle('wartet', warten);
  k.classList.toggle('an', !warten);
  const lang = recPlan.ende - recPlan.start;  // unter einem Takt zählt REC Beats herunter, sonst Takte
  k.textContent = warten ? `WAIT ${Math.ceil(recPlan.start - beat)}`
    : `REC ${Math.max(1, Math.ceil((recPlan.ende - beat) / (lang < 4 ? 1 : 4)))}`;
}

export function recEnde(ok) {
  recLaeuft = false; recPlan = null;
  const ziel = recZiel, name = recAktiv; recZiel = null;
  if (ziel && ok === true) ladeLoopInSpur(ziel.deck, ziel.spur, name);   // the file is written before /e/mitschnitt: load the finished loop
  const k = $('#rec-knopf');
  k.classList.remove('an', 'wartet');
  clearTimeout(recFertigZeit);
  if (ok === true || ok === false) {  // Scheibe 3 (E4): auch das Scheitern steht am Knopf (Tempo, Überlappung)
    k.classList.add(ok ? 'fertig' : 'gescheitert'); k.textContent = ok ? 'SAVED' : 'FAILED';
    recFertigZeit = setTimeout(() => { k.classList.remove('fertig', 'gescheitert'); k.textContent = 'REC'; }, 4000);
  } else k.textContent = 'REC';
}

export function baueRec() {
  const kopf = $('#deck-c');
  for (const b of $$('[data-recbeats]', kopf)) {
    b.addEventListener('click', () => {
      recBeats = Number(b.dataset.recbeats);
      for (const x of $$('[data-recbeats]', kopf)) x.classList.toggle('an', x === b);
    });
  }
  $('#rec-knopf').addEventListener('click', () => starteRec(false, null));
  // → L1 1..4 / L2 1..4: record the Strudel sum (erz/1+2+3, before trim) for the length chosen above, then load it into track n of that loop deck
  for (const b of $$('[data-recziel]', kopf)) b.addEventListener('click', () => {
    const [deck, spur] = b.dataset.recziel.split(':').map(Number);
    starteRec(true, { deck, spur });
  });
}

async function starteRec(summe, ziel) {
  if (recLaeuft) return;
  recLaeuft = true;
  clearTimeout(recFertigZeit);
  $('#rec-knopf').classList.remove('fertig');
  if (letzterBeat != null) {
    const raster = recBeats, start = Math.ceil(letzterBeat / raster) * raster;
    recPlan = { start, ende: start + raster };
    zeigeRec(letzterBeat);
  } else $('#rec-knopf').classList.add('wartet');
  const name = recName(recBeats);
  recAktiv = name; recZiel = ziel;
  const koerper = summe ? { aktion: 'rec', beats: recBeats, name, summe: 1 } : { aktion: 'rec', beats: recBeats, name };
  try {
    const r = await fetch('/loop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(koerper) });
    const j = await r.json();
    window.djkGesendet.push({ loop: koerper, code: r.status, antwort: j });
    if (!r.ok) { melde(`Recording refused: ${j.fehler}`, true); recEnde(false); }
    else if (j.quittung?.status === 6) { melde(`Recording refused: ${j.quittung.grund === 'ausserhalb_bereich' ? 'the tempo is changing, wait for the ramp to finish' : (LOOP_GRUND[j.quittung.grund] ?? j.quittung.grund)}`, true); recEnde(false); }
  } catch (e) { melde(`Page server unreachable: ${e.message}`, true); recEnde(false); }
}


// MVP 2 Scheibe 3 (E2): → STRUDEL macht den Loop zum Klang im Zusatz-Kit. Die Antwort steht AM Knopf (Hörtest
// e17c208: Meldungen fern vom Griff werden übersehen): s("rec0") zum Abtippen, oder der Grund der Ablehnung.
function strudelKnopf(name) {
  const b = document.createElement('button');
  b.className = 'zustrudel';
  b.textContent = '→ STRUDEL';
  b.title = 'Make this loop a Strudel sound (no restart)';
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const r = await fetch('/loop', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ aktion: 'kit', name }) });
      const j = await r.json();
      window.djkGesendet.push({ loop: { aktion: 'kit', name }, code: r.status, antwort: j });
      if (r.ok) { b.textContent = `s("${j.klang}")`; b.classList.add('fertig'); b.title = `Strudel sound ${j.klang}, ready from the next bar`; }
      else { b.textContent = 'FAILED'; b.classList.add('fehler'); b.title = j.text ?? j.fehler; b.disabled = false; }
    } catch (e) { b.textContent = 'FAILED'; b.classList.add('fehler'); b.title = e.message; b.disabled = false; }
  });
  return b;
}

export async function ladeLoops() {
  zustand.loopliste = await (await fetch('/loops')).json();
  const tb = $('#loopliste');
  tb.textContent = '';
  for (const l of zustand.loopliste) {
    const tr = document.createElement('tr');
    if (l.ladbar === false) { tr.classList.add('defekt'); tr.title = `Cannot be loaded: ${l.grund}`; }
    else quelleZiehbar(tr, { loop: l.name });   // drop on a loop deck cell loads it there (the source form of the loop library)
    for (const [t, k] of [[l.name, 'titelzelle'], [taktText(l.beats), 'zahl'], [l.quelle || '–', ''], [l.erstellt || '–', 'zahl']]) {
      const td = document.createElement('td'); td.textContent = t; td.className = k; tr.append(td);
    }
    if (l.ladbar === false) {   // Name durchgestrichen, der Grund lesbar daneben
      const z = tr.cells[0]; z.textContent = '';
      const n = document.createElement('span'); n.className = 'name'; n.textContent = l.name;
      const g = document.createElement('span'); g.className = 'grund'; g.textContent = l.grund;
      z.append(n, g);
    }
    const td = document.createElement('td');
    td.className = 'aktion';
    for (const n of BOXEN) {
      const b = document.createElement('button');
      b.className = `laden l${n}`;
      b.textContent = `LOAD LOOP ${n}`;
      if (l.ladbar === false) { b.disabled = true; b.title = `Cannot be loaded: ${l.grund}`; }
      b.dataset.titel0 = b.title;
      b.addEventListener('click', () => ladeInDeck(n, { loop: l.name }));   // the selected cell of loop deck n, else its first empty one
      td.append(b);
    }
    td.append(strudelKnopf(l.name));
    tr.append(td);
    tb.append(tr);
  }
  zeigeReiterInfo();
  filtere();                                                // Review F5: Suche gilt auch nach Neuaufbau
}
// Setters: an importing module cannot assign to an imported binding, so the writes from other modules go through these.
export function setzeLetzterBeat(b) { letzterBeat = b; }
