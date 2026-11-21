// The Strudel module (container core U5): the body of a `strudel` place is generated, one row per stream. A row is the pattern editor of the stream
// (the existing neueInstanz code), its sound column, and the strip of the stream (the alias strip `erz/<n>/<suffix>`; the page server resolves the
// alias onto the `strom` track). Rows 1..3 are the defaults, every `strom` track of the strudel group adds its row, and the "+ STREAM" picker opens
// a row for a stream without a track. The page never creates a track: the first pattern is POST /strudel {strom, text}.
import { $, $$, zustand, melde } from './page_state.js';
import { STROEME, stromKanal, stromName, stromListe, stromSpur, hatErzeuger } from './kanaele.js';
import { instanzen, neueInstanz } from './instanzen.js';
import { baueZug } from './deck_view.js';
import { bindeKnoepfe, zeigeWert } from './controls_view.js';
import { bindeFxZuweisung } from './beat_fx_view.js';
import { baueSoundStimme, auffrischeSound } from './strudel_sound.js';
import { live } from './live_view.js';
import { bindeSpurbandZeile } from './track_tape_view.js';
import { oeffneGeraetFenster, GERAET_FENSTER_TEXT } from './device_open.js';

const geoeffnet = new Set();   // streams opened by the picker (rows without a track)
const KNOPF = '<svg viewBox="0 0 60 60"><circle class="ring" cx="30" cy="30" r="24"/><path class="bogen"/><line class="zeiger" x1="30" y1="30" x2="30" y2="10"/></svg>';
const farbe = (n) => { const k = (n - 1) % 3; return `var(--c${k ? k + 1 : ''})`; };   // three colours, repeated
const PLATZHALTER = { 1: 's("bd*4, hh*8")', 2: 's("bat_synth*4")', 3: 's("bat_stab*2")' };
const wurzel = () => $('#strudel-zeilen');

function zeilenHtml(n) {
  return `<div class="instanzkopf"><span class="instanzname">${stromName(n)}</span><span class="erzeuger-hinweis" hidden>no generator</span>`
    + `<button class="strom-geraete" data-strom-geraete="${n}" title="Effects and device of this stream's track in its own window" hidden>${GERAET_FENSTER_TEXT.knopf}</button></div>`
    + '<div class="instanz-koerper"><div class="instanz-editor">'
    + `<textarea class="muster-feld" spellcheck="false" autocomplete="off" placeholder='${PLATZHALTER[n] ?? 's("bd*4")'}' aria-label="${stromName(n)} pattern (Ctrl+Enter plays from the next bar)"></textarea>`
    + '<div class="musterzeile">'
    + '<button class="muster-auto an" aria-pressed="true" title="AUTO on: Cypher plays on its own. Off: the last pattern keeps playing until you send one.">AUTO</button>'
    + '<span class="muster-stand">–</span><span class="muster-fehler" role="status"></span><button class="muster-uebernehmen" hidden>take over</button>'
    + '<button class="muster-senden" title="Play from the next bar (Ctrl+Enter)">PLAY ⏎</button>'
    + '<button class="muster-stopp" title="Stop from the next bar, your text stays (Ctrl+Backspace)">STOP</button>'
    + '<button class="muster-zurueck" title="Back to what is playing (Ctrl+.)">REVERT</button>'
    + '<button class="muster-sichern" title="Save the pattern that is playing now (not the text in the box) to the library">SAVE</button>'
    + '<input class="muster-name" placeholder="name" size="12" maxlength="48" aria-label="Pattern name" hidden></div>'
    + '<div class="spurbaender" aria-label="Automation lanes"></div></div></div>';
}

/** Builds the row of stream n (editor, sound column, strip), binds it and puts it in stream order. Returns the row. */
export function baueStromZeile(n) {
  const z = document.createElement('div');
  z.className = 'instanz'; z.dataset.strom = String(n); z.setAttribute('style', `--farbe:${farbe(n)}`);
  z.innerHTML = zeilenHtml(n);
  const koerper = $('.instanz-koerper', z);
  koerper.append(baueSoundStimme(n));
  const zug = document.createElement('div');
  zug.className = 'zug'; zug.dataset.kanalzug = stromKanal(n); zug.setAttribute('style', `--farbe:${farbe(n)}`);
  const name = document.createElement('div');
  name.className = 'zugname'; name.textContent = stromName(n); name.title = `Strudel stream ${n}`;
  zug.append(name);
  koerper.append(zug);
  baueZug(zug, stromKanal(n));
  for (const x of $$('.xzuweisung', zug)) x.remove();   // the crossfader side is not a row of the alias
  if (!STROEME.includes(n)) {   // a stream without alias rows: the strip shows, nothing is bound (the server would refuse every path)
    zug.dataset.ohneAlias = '1';
    for (const e of $$('[data-pfad]', zug)) e.removeAttribute('data-pfad');
  }
  const w = wurzel();
  const nach = $$('.instanz', w).find((x) => Number(x.dataset.strom) > n);
  if (nach) w.insertBefore(z, nach); else w.append(z);
  instanzen.set(n, neueInstanz(z));
  $('[data-strom-geraete]', z).addEventListener('click', () => { const spur = stromSpur(live.projekt, n); if (spur) oeffneGeraetFenster(spur.id, melde); });
  bindeKnoepfe(z); bindeFxZuweisung(z);
  for (const o of $$('[data-wert]', z)) zeigeWert(o.dataset.wert);
  for (const k of $$('.schalter[data-pfad]', z)) zeigeWert(k.dataset.pfad);
  instanzen.get(n).hole();
  bindeSpurbandZeile(z);
  return z;
}

// pan, mute and the two sends to the module returns bind to the native rows of the track; without the track (no slot) they are not rendered
function zeigeSlotRegler(z, n) {
  const zug = $('.zug', z), spur = stromSpur(live.projekt, n);
  const rets = spur ? (live.projekt?.returns ?? []).filter((r) => r.strudel) : [];
  const sig = spur ? `${spur.nr}|${rets.map((r) => r.nr).join(',')}` : '';
  if ((zug.dataset.slot ?? '') === sig) return;
  for (const e of $$('.slotzeile', zug)) e.remove();
  if (!sig) { delete zug.dataset.slot; return; }
  zug.dataset.slot = sig;
  const knopf = (pfad, text) => `<div class="knopfzeile"><div class="knopf regler" data-griff="${pfad.split('/').pop()}" data-pfad="${pfad}" role="slider" tabindex="0">${KNOPF}</div><div class="beschrift"><label>${text}</label><output data-wert="${pfad}">–</output></div></div>`;
  const s = document.createElement('div');
  s.className = 'slotzeile';
  s.innerHTML = knopf(`spur/${spur.nr}/pan`, 'PAN')
    + rets.map((r) => knopf(`spur/${spur.nr}/send/${r.nr}`, r.strudel.art === 'hall' ? 'HALL' : 'DELAY')).join('')
    + `<button class="schalter" data-pfad="spur/${spur.nr}/mute" title="Mute this stream">M</button>`;
  zug.append(s);
  bindeKnoepfe(s);
  for (const o of $$('[data-wert]', s)) zeigeWert(o.dataset.wert);
  for (const k of $$('.schalter[data-pfad]', s)) zeigeWert(k.dataset.pfad);
}

function zeigePicker() {
  const w = wurzel();
  let sel = $('select[data-strom-plus]', w.parent ?? w);
  const gezeigt = new Set($$('.instanz', w).map((x) => Number(x.dataset.strom)));
  const frei = STROEME.filter((n) => !gezeigt.has(n));
  if (!sel) {
    sel = document.createElement('select');
    sel.className = 'strom-plus'; sel.dataset.stromPlus = '1'; sel.setAttribute('aria-label', 'Open a stream row');
    sel.addEventListener('change', () => {
      const n = Number(sel.value);
      sel.value = '';
      if (!STROEME.includes(n)) return;
      geoeffnet.add(n);
      zeigeStromZeilen();
    });
    (w.parent ?? w).append(sel);
  }
  sel.innerHTML = `<option value="">+ STREAM</option>${frei.map((n) => `<option value="${n}">${stromName(n)}${n > 3 ? '' : ` (${n})`}</option>`).join('')}`;
  sel.hidden = frei.length === 0;
}

/** Reconciles the rows with the live project: adds a missing row, drops one that has neither default, track nor pick. Safe to call often. */
export function zeigeStromZeilen() {
  const w = wurzel();
  if (!w) return;
  const soll = stromListe(live.projekt, [...geoeffnet]);
  for (const n of soll) if (!instanzen.has(n) || !$(`.instanz[data-strom="${n}"]`, w)) baueStromZeile(n);
  for (const z of $$('.instanz', w)) {
    const n = Number(z.dataset.strom);
    if (!soll.includes(n)) { z.remove(); instanzen.delete(n); continue; }
    const hinweis = $('.erzeuger-hinweis', z);
    hinweis.hidden = hatErzeuger(zustand.regler, n);
    $('[data-strom-geraete]', z).hidden = !stromSpur(live.projekt, n);   // per-stream effects live in the device window of the track; no track, nothing to open
    zeigeSlotRegler(z, n);
  }
  zeigePicker();
}

/** Closes the rows that were opened by hand and have no track. */
export function schliesseGeoeffnete() { geoeffnet.clear(); zeigeStromZeilen(); }

/** Page start: the default rows, then the follow-up of generator hint and sound column (4 times a second, cheap). */
export function bindeStromZeilen() {
  zeigeStromZeilen();
  const auffrischen = () => { auffrischeSound(); for (const z of $$('.instanz', wurzel())) $('.erzeuger-hinweis', z).hidden = hatErzeuger(zustand.regler, Number(z.dataset.strom)); };
  setInterval(auffrischen, 250);
}

/** Brings the row of stream n to the front (a pattern was loaded into it from the library). */
export function zeigeStrom(n) { $(`.instanz[data-strom="${n}"]`)?.scrollIntoView?.({ block: 'nearest' }); }
