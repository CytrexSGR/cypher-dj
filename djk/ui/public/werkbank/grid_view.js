// Workbench region NOTES (plan task 7): the grid of the selected instrument track: header (track, kind, PATTERN, FOLD, window arrows, VIEW), bar strip,
// BAR and STEP rows, the rows (drum: one per sound, note: one per pitch as a keyboard with the octave bar beside the keys), the step value lane
// (VELOCITY, LENGTH) and the playhead. The model is grid.js (pure); this file draws it and turns gestures into project commands through ctx.aendere.
//
// The whole region is redrawn (one innerHTML) after every project change, selection change, window change and instrument info answer; the playhead
// moves per frame by toggling a class. All gestures are delegated from the region host. Every element carries data-w; actions carry data-a.
// How the info arrives: ctx.info(spur) is null until the first answer, and every answer redraws the track list, which runs the ctx.spurZeile hooks
// (tracks.js); the hook below redraws this region when the info of the selected track is a different object than the one drawn last.
// A track whose state is not 'muster' is drawn without gestures: no handler ever sends a command for it (review focus 5).
import { SeqFehler, geraetArt } from '../seq_logic.js';
import { LAENGEN_TAKTE } from '../seq_field.js';
import { rasterArt } from './tracks.js';
import { modulTakte } from './kopf.js';
import {
  fenster, blaettere, taktWahl, leiste, zaehlung, drumZeilen, tonZeilen, startOben, radOben, oktavLeiste, zustand, zellen, wertZellen, musterTakte, zuLang,
  klickBefehle, wertBefehle, musterLaengeBefehle, SICHTEN, SCHRITT, SCHRITTE_TAKT,
} from './grid.js';

export const RASTER_TEXT = {
  titel: 'NOTES',
  drum: 'DRUM GRID · one row per sound',
  note: 'NOTE GRID · one row per pitch',
  gesperrt: "This track's clips are arranged in PRODUCTION; the grid edits a pattern clip from beat 0 over 64 beats.",
  keinClip: 'This track has no pattern clip.',
  laedt: 'Loading the instrument…',
  keineSpur: 'No instrument track is selected.',
  werte: 'STEP VALUES',
  hinweisNoten: 'of the notes',
  hinweisReihe: 'of the selected row',
};
const SICHT_SCHLUESSEL = 'djk-wb-sicht';
const FELDER = { vel: 'VELOCITY', laenge: 'LENGTH' };
const EPS = 1e-9;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const klemme = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const betontNr = (nr) => nr % 4 === 1;
const klassen = (...k) => k.filter(Boolean).join(' ');

export function bindeRaster(ctx) {
  const { st, $ } = ctx;
  const host = $('noten');
  const spurTexte = new Map();   // track id -> { start, oben, fold, reihe, feld } (D7, kept in memory per track)
  let sicht = Number(ctx.lies(SICHT_SCHLUESSEL, '4'));
  if (!SICHTEN.includes(sicht)) sicht = 4;
  let akt = null;                // what the last draw showed: { spur, clip, art, zust, f, takte, ts, ton } (gestures read it)
  let veraltet = true;           // a change came while the view was hidden: draw when it is shown
  let gezeigteInfo;              // the info object of the selected track at the last draw
  let kopfSchritt = null, kopfEls = [];
  let zieht = false;

  const wahlSpur = () => (st.projekt?.spuren ?? []).find((s) => s.id === st.wahl && s.art === 'instrument') ?? null;
  const spurZustand = (spur) => {
    let t = spurTexte.get(spur.id);
    if (!t) { t = { start: 0, oben: null, fold: false, reihe: null, feld: 'vel' }; spurTexte.set(spur.id, t); }
    return t;
  };

  function kopfHtml(a) {
    const note = a.art === 'note';
    const muster = a.clip ? musterTakte(a.clip) : null;
    const lang = a.clip ? zuLang(a.clip, a.takte) : false;
    const frei = a.zust === 'muster';
    const knopf = (an, n, inhalt, extra = '', titel = '') => `<button data-w="r-${an}" data-a="${an}" data-n="${n}" class="w-rknopf${extra}" title="${esc(titel)}"${an === 'muster' && !frei ? ' disabled' : ''}>${inhalt}</button>`;
    return `<div class="w-rkopf" data-w="r-kopf">
<h3 class="w-titel" data-w="r-titel">${RASTER_TEXT.titel}</h3>
<span class="w-rspur" data-w="r-spur">${esc(a.spur.name)}</span>
${a.art ? `<span class="w-chip" data-w="r-art">${a.art === 'drum' ? RASTER_TEXT.drum : RASTER_TEXT.note}</span>` : ''}
<span class="w-etikett">PATTERN</span>${LAENGEN_TAKTE.map((n) => knopf('muster', n, n, klassen(muster === n && ' an', muster === n && lang && ' zulang'), `Pattern length: ${n} bar${n === 1 ? '' : 's'}`)).join('')}<span class="w-etikett">bars</span>
${note && a.zeilenDa ? `<button data-w="r-fold" data-a="fold" class="w-rknopf${a.ts.fold ? ' an' : ''}" aria-pressed="${a.ts.fold}" title="Show only the pitches the pattern uses">FOLD</button>` : ''}
<span class="w-rabstand"></span>
${a.f ? `<button data-w="r-zurueck" data-a="zurueck" class="w-rknopf" title="Previous bars">◀</button><b class="w-rfenster" data-w="r-fenster">${a.f.breite === 1 ? `BAR ${a.f.start + 1}` : `BAR ${a.f.start + 1} – ${a.f.start + a.f.breite}`}</b><button data-w="r-vor" data-a="vor" class="w-rknopf" title="Next bars">▶</button>
<span class="w-etikett">VIEW</span>${SICHTEN.map((n) => `<button data-w="r-sicht" data-a="sicht" data-n="${n}" class="w-rknopf${a.f.sicht === n ? ' an' : ''}" title="Show ${n} bar${n === 1 ? '' : 's'} at once">${n}</button>`).join('')}<span class="w-etikett">bars</span>` : ''}
</div>`;
  }

  // the bar strip: which module bars hold notes (the pattern repeats through the module)
  function barBelegt(clip, takte) {
    const P = (clip.loop_beats ?? clip.laenge_beats) || 4, aus = new Set();
    for (const n of clip.noten ?? []) for (let b = n.beat; b < takte * 4 - EPS; b += P) aus.add(Math.floor(b / 4 + EPS));
    return aus;
  }
  function leisteHtml(a) {
    const belegt = barBelegt(a.clip, a.takte);
    const L = leiste(a.takte, a.f);
    const erste = L.findIndex((b) => b.sichtbar), letzte = L.length - 1 - [...L].reverse().findIndex((b) => b.sichtbar);
    return `<div class="w-rleiste" data-w="r-leiste">${L.map((b, i) => `<div data-w="r-takt" data-a="takt" data-n="${b.takt}" class="${klassen('w-rtakt', b.betont && 'betont', b.sichtbar && 'sichtbar', i === erste && 'von', i === letzte && 'bis')}" title="Show bar ${b.nr}">${b.nr}${belegt.has(b.takt) ? '<i></i>' : ''}</div>`).join('')}</div>`;
  }

  const spalten = (a) => `grid-template-columns:repeat(${a.f.breite * SCHRITTE_TAKT},1fr)`;
  const lane = (a, name, inhalt, extra = '') => `<div class="w-lane" data-w="lane"><div class="${klassen('w-ln', extra)}"${name.attrs ?? ''}>${name.html}</div><div class="w-steps" style="${spalten(a)}">${inhalt}</div></div>`;

  function zaehlungHtml(a) {
    const z = zaehlung(a.f);
    const bar = lane(a, { html: 'BAR' }, z.takte.map((t) => `<div class="w-ru bar" data-w="r-bar" style="grid-column:span ${SCHRITTE_TAKT}">BAR ${t.nr}</div>`).join(''), 'w-ln-zaehlung');
    const first = a.f.start * SCHRITTE_TAKT;
    const schritt = lane(a, { html: 'STEP' }, z.schritte.map((s, i) => `<div class="${klassen('w-ru', s.betont && 'betont')}" data-w="r-schritt" data-schritt="${first + i}">${s.nr}</div>`).join(''), 'w-ln-zaehlung');
    return bar + schritt;
  }

  function zellenHtml(a, zs, art) {
    // a note of more than one step is tied into the next steps (note grid only: the 909 ignores note off)
    const fort = new Set();
    if (art === 'note') zs.forEach((z, i) => { if (z.an && z.laenge > 1) for (let j = 1; j < z.laenge && i + j < zs.length; j++) fort.add(i + j); });
    return zs.map((z, i) => `<div data-w="zelle" data-a="zelle" data-ton="${z.ton}" data-schritt="${z.schritt}" data-quelle="${z.quelle}" class="${klassen('w-st', betontNr(z.schritt % SCHRITTE_TAKT + 1) && 'betont', z.wiederholung && 'wiederholung', z.an && 'an', !z.an && fort.has(i) && 'fort')}"></div>`).join('');
  }

  function zeilenHtml(a) {
    const zeile = (z, ton) => `${zellenHtml(a, zellen(a.clip, ton, a.f).map((x) => ({ ...x, ton })), a.art)}`;
    if (a.art === 'drum') {
      return a.zeilen.map((z) => lane(a, { html: esc(z.name), attrs: ` data-w="zeilenname" data-a="reihe" data-ton="${z.ton}"` }, zeile(z, z.ton), klassen('w-ln-drum', z.ton === a.ton && 'gewaehlt'))).join('');
    }
    const tasten = a.zeilen.map((z) => lane(a, { html: esc(z.name), attrs: ` data-w="zeilenname" data-ton="${z.ton}"` }, zeile(z, z.ton), klassen('w-ln-taste', z.schwarz ? 'schwarz' : 'weiss', z.c && 'c'))).join('');
    let oktaven = '';
    if (!a.ts.fold) {
      const O = oktavLeiste(a.ts.oben, a.clip);
      const erste = O.findIndex((o) => o.sichtbar), letzte = O.length - 1 - [...O].reverse().findIndex((o) => o.sichtbar);
      oktaven = `<div class="w-okt" data-w="r-okt" title="Octaves: click to jump, wheel over the rows to roll">${O.map((o, i) => `<div data-w="oktave" data-a="oktave" data-oben="${o.oben}" class="${klassen('w-o', o.sichtbar && 'sichtbar', o.noten && 'hat', i === erste && 'von', i === letzte && 'bis')}">${o.oktave}</div>`).join('')}</div>`;
    }
    return `<div class="w-tonblock" data-w="r-tonblock">${oktaven}<div class="w-tonzeilen" data-w="r-ton">${tasten}</div></div>`;
  }

  function wertHtml(a) {
    const feld = a.feld;
    const tabs = Object.keys(FELDER).filter((k) => k === 'vel' || a.art === 'note')
      .map((k) => `<button data-w="r-feld" data-a="feld" data-feld="${k}" class="w-rknopf${k === feld ? ' an' : ''}">${FELDER[k]}</button>`).join('');
    const kopf = `<div class="w-werte" data-w="r-werte"><span class="w-etikett">${RASTER_TEXT.werte}</span>${tabs}<span class="w-hinweis" data-w="r-hinweis">${a.art === 'drum' ? RASTER_TEXT.hinweisReihe : RASTER_TEXT.hinweisNoten}</span></div>`;
    if (a.ton === null && a.art === 'drum') return kopf;
    const zs = wertZellen(a.clip, a.art === 'drum' ? a.ton : null, a.f, feld);
    const hoch = feld === 'vel' ? 127 : 16;
    const zellenHtml2 = zs.map((z) => `<div data-w="wert" data-schritt="${z.schritt}" data-quelle="${z.quelle}" data-da="${z.da ? 1 : 0}" class="${klassen('w-val', betontNr(z.schritt % SCHRITTE_TAKT + 1) && 'betont', z.anders && 'anders', z.wiederholung && 'wiederholung')}">${z.da ? `<i style="height:${klemme(z.wert / hoch * 100, 4, 100).toFixed(1)}%"></i>` : ''}</div>`).join('');
    return kopf + lane(a, { html: FELDER[feld] }, zellenHtml2, 'w-ln-zaehlung');
  }

  function zeichne() {
    if (!st.sichtbar) { veraltet = true; return; }
    veraltet = false;
    kopfSchritt = null; kopfEls = [];
    const spur = wahlSpur();
    if (!st.projekt || !spur) { akt = null; host.innerHTML = `<h3 class="w-titel" data-w="r-titel">${RASTER_TEXT.titel}</h3><p class="w-rtext" data-w="r-text">${RASTER_TEXT.keineSpur}</p>`; return; }
    const info = ctx.info(spur);
    gezeigteInfo = info;
    const zust = zustand(spur);
    const clip = (spur.clips ?? []).find((c) => c.art === 'midi') ?? null;
    host.style.setProperty?.('--spurfarbe', spur.farbe ?? '');
    const art = info === null && geraetArt(spur, null) !== 'kit' ? null : rasterArt(spur, info);
    const ts = spurZustand(spur);
    const kopfA = { spur, clip, art, zust, ts, f: null, takte: 1, zeilenDa: false };
    if (!clip || art === null) {
      akt = null;
      const text = zust === 'gesperrt' && !clip ? RASTER_TEXT.gesperrt : !clip ? RASTER_TEXT.keinClip : RASTER_TEXT.laedt;
      host.innerHTML = `${kopfHtml(kopfA)}<p class="w-rtext" data-w="r-text">${text}</p>`;
      return;
    }
    const takte = modulTakte(st.projekt) ?? klemme(Math.ceil(musterTakte(clip) - EPS), 1, 16);   // D6: a module length that is no length of the top bar falls back to the pattern
    const f = fenster({ sicht, start: ts.start }, takte);
    ts.start = f.start;
    if (ts.oben === null) ts.oben = startOben(clip);
    let zeilen, ton = null;
    if (art === 'drum') {
      zeilen = drumZeilen(clip, info);
      const belegt = (z) => (clip.noten ?? []).some((n) => n.ton === z.ton);
      ton = (zeilen.find((z) => z.ton === ts.reihe) ?? zeilen.find(belegt) ?? zeilen[0])?.ton ?? null;
    } else {
      zeilen = tonZeilen(ts.oben, ts.fold, clip);
    }
    if (art !== 'note' || !FELDER[ts.feld]) ts.feld = 'vel';   // LENGTH exists in the note grid only
    const a = { spur, clip, art, zust, ts, f, takte, zeilen, ton, feld: ts.feld, zeilenDa: zeilen.length > 0 };
    akt = a;
    const text = zust === 'gesperrt' ? `<p class="w-rtext" data-w="r-text">${RASTER_TEXT.gesperrt}</p>` : '';
    host.innerHTML = `${kopfHtml(a)}${text}<div class="${klassen('w-raster', `sicht-${f.sicht}`, zust !== 'muster' && 'gesperrt')}" data-w="r-raster">${leisteHtml(a)}${zaehlungHtml(a)}${zeilenHtml(a)}${wertHtml(a)}</div>`;
    setzeKopf(kopfSchrittJetzt(performance.now()));
  }

  // ----- playhead -----
  function kopfSchrittJetzt(t) {
    if (!akt) return null;
    const b = ctx.kopfBeat(t);
    if (b === null || b === undefined || !Number.isFinite(b)) return null;
    const L = akt.takte * 4;
    return Math.floor((((b % L) + L) % L) / SCHRITT + EPS);
  }
  function setzeKopf(schritt) {
    if (schritt === kopfSchritt) return;
    for (const e of kopfEls) e.classList.remove('kopf');
    kopfSchritt = schritt;
    kopfEls = schritt === null ? [] : host.querySelectorAll(`[data-schritt="${schritt}"]`);
    for (const e of kopfEls) e.classList.add('kopf');
  }

  // ----- gestures -----
  const mitFehler = (fn) => {
    try { return fn(); } catch (e) { if (e instanceof SeqFehler) { ctx.melde(e.message, true); return undefined; } throw e; }
  };
  const sende = (label, befehle, schluessel) => { if (befehle.length) ctx.aendere(label, befehle, schluessel); };
  const frei = () => akt && akt.zust === 'muster';

  async function musterLaenge(takte) {
    if (!frei()) return;
    const { spur, clip } = akt;
    const r = mitFehler(() => musterLaengeBefehle(spur, clip, takte));
    if (!r || !r.befehle.length) return;
    if (r.geloescht > 0 && !(await ctx.frage(`Shortening the pattern deletes ${r.geloescht} note${r.geloescht === 1 ? '' : 's'} behind bar ${takte}. Continue?`))) return;
    sende(`${spur.name}: pattern length`, r.befehle);
  }
  function wertSetzen(el, e) {
    if (!frei()) return;
    const { spur, clip, art, ton, ts } = akt;
    const quelle = Number(el.dataset.quelle);
    const r = el.getBoundingClientRect();
    const anteil = Number.isFinite(e.clientY) ? klemme((r.bottom - e.clientY) / (r.height || 1), 0, 1) : 1;
    const feld = ts.feld;
    const wert = feld === 'vel' ? Math.round(1 + anteil * 126) : Math.max(1, Math.ceil(anteil * 16));
    const zeilenTon = art === 'drum' ? ton : null;
    sende(`${spur.name}: ${feld === 'vel' ? 'velocity' : 'length'}`, wertBefehle(clip, zeilenTon, quelle, feld, wert), `${spur.id}:${feld}:${zeilenTon}:${quelle}`);
  }
  const wertAus = (e) => e.target?.closest?.('[data-w="wert"]') ?? null;

  host.addEventListener('click', (e) => {
    const a = e.target?.closest?.('[data-a]');
    if (!a || !akt && !['sicht'].includes(a.dataset.a)) return;
    const n = Number(a.dataset.n);
    switch (a.dataset.a) {
      case 'sicht': sicht = n; ctx.merke(SICHT_SCHLUESSEL, String(n)); zeichne(); break;
      case 'zurueck': akt.ts.start = blaettere(akt.f, -1, akt.takte).start; zeichne(); break;
      case 'vor': akt.ts.start = blaettere(akt.f, 1, akt.takte).start; zeichne(); break;
      case 'takt': akt.ts.start = taktWahl(akt.f, n, akt.takte).start; zeichne(); break;
      case 'fold': akt.ts.fold = !akt.ts.fold; zeichne(); break;
      case 'oktave': akt.ts.oben = Number(a.dataset.oben); zeichne(); break;
      case 'reihe': akt.ts.reihe = Number(a.dataset.ton); zeichne(); break;
      case 'feld': akt.ts.feld = a.dataset.feld; zeichne(); break;
      case 'muster': musterLaenge(n); break;
      case 'zelle': {
        if (!frei()) return;
        const { spur, clip, art } = akt;
        mitFehler(() => sende(`${spur.name}: notes`, klickBefehle(spur, clip, Number(a.dataset.ton), Number(a.dataset.quelle), art)));
        break;
      }
      default:
    }
  });
  host.addEventListener('wheel', (e) => {
    if (!akt || akt.art !== 'note' || akt.ts.fold || !e.target?.closest?.('[data-w="r-ton"]')) return;
    e.preventDefault?.();
    akt.ts.oben = radOben(akt.ts.oben, e.deltaY);
    zeichne();
  }, { passive: false });
  host.addEventListener('pointerdown', (e) => {
    const el = wertAus(e);
    if (!el || !frei()) return;
    zieht = true;
    mitFehler(() => wertSetzen(el, e));
  });
  host.addEventListener('pointermove', (e) => {
    if (!zieht) return;
    if (e.buttons === 0) { zieht = false; return; }
    const el = wertAus(e);
    if (el && el.dataset.da === '1') mitFehler(() => wertSetzen(el, e));   // a drag passes empty steps without a word
  });
  const ende = () => { zieht = false; };
  host.addEventListener('pointerup', ende);
  host.addEventListener('pointercancel', ende);
  document.addEventListener('pointerup', ende);

  // ----- hooks -----
  ctx.beimProjekt.push((p, wechsel) => { if (wechsel) spurTexte.clear(); zeichne(); });
  ctx.beiWahl.push(() => zeichne());
  ctx.beimSichtwechsel.push((sichtbar) => { if (sichtbar && veraltet) zeichne(); });
  ctx.vorBild.push((t) => setzeKopf(kopfSchrittJetzt(t)));
  (ctx.spurZeile ??= []).push((_zeile, spur) => { if (spur.id === st.wahl && ctx.info(spur) !== gezeigteInfo) zeichne(); });
}
