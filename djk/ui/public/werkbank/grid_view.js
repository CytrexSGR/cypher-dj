// Workbench region NOTES (plan task 7): the grid of the selected instrument track: header (track, kind, PATTERN, FOLD, window arrows, VIEW), bar strip,
// BAR and STEP rows, the rows (drum: one per sound, note: one per pitch as a keyboard with the octave bar beside the keys), the step value lane
// (VELOCITY, LENGTH, and a lane per knob of a Baukasten instrument added with "+ lane") and the playhead. The model is grid.js (pure); this file draws it and turns gestures into project commands through ctx.aendere.
//
// The whole region is redrawn (one innerHTML) after every project change, selection change, window change and instrument info answer; the playhead
// moves per frame by toggling a class. All gestures are delegated from the region host. Every element carries data-w; actions carry data-a.
// How the info arrives: ctx.info(spur) is null until the first answer, and every answer redraws the track list, which runs the ctx.spurZeile hooks
// (tracks.js); the hook below redraws this region when the info of the selected track is a different object than the one drawn last.
// A track whose state is not 'muster' is drawn without gestures: no handler ever sends a command for it (review focus 5).
import { SeqFehler, geraetArt } from '../seq_logic.js';
import { rasterArt } from './tracks.js';
import { modulTakte } from './kopf.js';
import {
  STEPS_WAHL, WERKZEUGE, FUELL_SCHRITTE, WERT_FELDER, zeileBefehle, schiebeBefehle, zeileDaten, zeilenSchritte, quelleVon, zeilenLaengeAusZellen, zeilenLaengeInZellen, linieZiele, fuellZiele, rechteckZiele, auswahlUmschalten,
  notenAn, setzeBefehle, dupliziereBefehle, ziehWerte, ziehBefehle, rampeWerte, rampeBefehle, cursorBewegung, bereichDaten, bereichBefehl, bereichAusBefehl,
} from './grid_seq.js';
import {
  fenster, blaettere, taktWahl, leiste, zaehlung, drumZeilen, tonZeilen, startOben, radOben, oktavLeiste, zustand, zellen, wertZellen, musterTakte, zuLang,
  sliceZeilen, klickBefehle, wertBefehle, rueckBefehle, pitchZellen, pitchBefehle, knopfSpuren, knopfZellen, knopfBefehle, knopfZiel,
  PITCH_MIN, PITCH_MAX, SCHRITT, SCHRITTE_TAKT, MAX_TAKTE, musterZellen, fensterSpanne, weite,
} from './grid.js';

export const RASTER_TEXT = {
  titel: 'NOTES',
  drum: 'DRUM GRID · one row per sound',
  note: 'NOTE GRID · one row per pitch',
  slice: 'SLICE GRID · one row per slice',
  gesperrt: "This track's clips are arranged in PRODUCTION; the grid edits a pattern clip from beat 0 over 64 beats.",
  keinClip: 'This track has no pattern clip.',
  laedt: 'Loading the instrument…',
  keineSpur: 'No instrument track is selected.',
  werte: 'STEP VALUES',
  hinweisNoten: 'of the notes',
  hinweisReihe: 'of the selected row',
  hinweisSchritte: 'of the hits in each step, on all rows',
  hinweisAlle: 'on all rows · a value holds for its step only, other steps play the knob · shift-click removes it',
  laneNeu: '+ lane ▾',
  laneNeuTitel: 'Add a step lane for a knob of this instrument',
  laneWeg: 'Remove this lane with all its step values',
  hinweisLane: 'knob lanes are edited at 16 steps per bar',
  hinweisZelle: 'shown in the step · drag up or down on a set step · shift-drag a ramp',
};
const SICHTEN_SEITE = [1, 2, 4];   // VIEW: a page shows 1, 2 or 4 bars
const AUFL_SCHLUESSEL = 'djk-wb-aufl-';   // + track id: STEPS (cells per bar) of a track, a view state
const SICHT_SCHLUESSEL = 'djk-wb-sicht';
const FELDER = { vel: 'VELOCITY', chance: 'CHANCE', versatz: 'OFFSET', wdh: 'ROLL', laenge: 'LENGTH', rueck: 'REVERSE', pitch: 'PITCH' };
const ZELLEN_FELDER = ['vel', 'laenge', 'chance', 'versatz', 'wdh'];   // the tabs whose value shows in the step and is dragged there
const TABS = { drum: ['vel', 'chance', 'versatz', 'wdh'], note: ['vel', 'chance', 'versatz', 'wdh', 'laenge'], slice: ['vel', 'chance', 'versatz', 'wdh', 'laenge', 'rueck', 'pitch'] };   // the value lanes each grid kind offers
const knopfNr = (feld) => { const m = /^k(\d+)$/.exec(feld ?? ''); return m ? Number(m[1]) : null; };   // the field of a knob lane is `k<nr>`
const REIHEN_ART = (art) => art === 'drum' || art === 'slice';   // one row per sound or slice
// The value lane follows the selected row in the drum grid only. In the slice grid a step mostly holds one slice on its own row, so VELOCITY, LENGTH
// and REVERSE act on the hits of the step on all rows, as PITCH does (A, 2026-11-16: REVERSE on step 5 did nothing while row 1 was selected).
const LANE_REIHE = (art) => art === 'drum';
const EPS = 1e-9;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const klemme = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const betontNr = (nr) => nr % 4 === 1;
const klassen = (...k) => k.filter(Boolean).join(' ');

export function bindeRaster(ctx) {
  const { st, $ } = ctx;
  const host = $('noten');
  const spurTexte = new Map();   // track id -> { start, oben, fold, reihe, feld } (D7, kept in memory per track)
  let sicht = Number(ctx.lies(SICHT_SCHLUESSEL, '2'));
  if (!SICHTEN_SEITE.includes(sicht)) sicht = 2;
  let werkzeug = 'draw', fuell = 2;   // the mouse tool and the step of FILL
  host.setAttribute?.('tabindex', '0');   // the grid takes the keys while it has the focus
  let akt = null;                // what the last draw showed: { spur, clip, art, zust, f, takte, ts, ton } (gestures read it)
  let veraltet = true;           // a change came while the view was hidden: draw when it is shown
  let gezeigteInfo;              // the info object of the selected track at the last draw
  let kopfSchritt = null, kopfEls = [];
  let zieht = false;
  let skipKlick = false;         // set by the pointerup of a gesture: the click that follows it is ignored

  const wahlSpur = () => (st.projekt?.spuren ?? []).find((s) => s.id === st.wahl && s.art === 'instrument') ?? null;
  const aufllesen = (spur) => { const n = Number(ctx.lies(`${AUFL_SCHLUESSEL}${spur.id}`, String(SCHRITTE_TAKT))); return STEPS_WAHL.includes(n) ? n : SCHRITTE_TAKT; };
  const spurZustand = (spur) => {
    let t = spurTexte.get(spur.id);
    if (!t) { t = { start: 0, aufl: aufllesen(spur), oben: null, fold: false, reihe: null, feld: 'vel', knoepfe: [], auswahl: [], cursor: null, anker: null }; spurTexte.set(spur.id, t); }   // knoepfe: knob lanes added here that hold no value yet
    return t;
  };

  function kopfHtml(a) {
    const note = a.art === 'note';
    const frei = a.zust === 'muster';
    const knopf = (w, an, n, inhalt, extra = '', titel = '', aus = false) => `<button data-w="${w}" data-a="${an}" data-n="${n}" class="w-rknopf${extra}" title="${esc(titel)}"${aus ? ' disabled' : ''}>${inhalt}</button>`;
    return `<div class="w-rkopf" data-w="r-kopf">
<h3 class="w-titel" data-w="r-titel">${RASTER_TEXT.titel}</h3>
<span class="w-rspur" data-w="r-spur">${esc(a.spur.name)}</span>
${a.art ? `<span class="w-chip" data-w="r-art">${RASTER_TEXT[a.art]}</span>` : ''}
<span class="w-etikett">STEPS</span>${STEPS_WAHL.map((n) => knopf('seq-schritte', 'aufl', n, n, klassen(a.ts.aufl === n && ' an'), `${n} steps per bar`, !a.f)).join('')}<span class="w-etikett">per bar</span>
${a.f && frei ? `<span class="w-etikett">TOOL</span>${WERKZEUGE.map((k) => knopf('seq-werkzeug', 'werkzeug', k, k.toUpperCase(), klassen(werkzeug === k && ' an'), { draw: 'Click toggles a step, dragging paints (Shift: line, Ctrl: select)', erase: 'Dragging clears steps', fill: 'Dragging over a range sets every 1st, 2nd or 4th step' }[k])).join('')}${werkzeug === 'fill' ? FUELL_SCHRITTE.map((n) => knopf('seq-fuell', 'fuell', n, `1/${n}`, klassen(fuell === n && ' an'), `Fill every ${n === 1 ? '' : `${n === 2 ? '2nd' : '4th'} `}step`)).join('') : ''}` : ''}
${note && a.zeilenDa ? `<button data-w="r-fold" data-a="fold" class="w-rknopf${a.ts.fold ? ' an' : ''}" aria-pressed="${a.ts.fold}" title="Show only the pitches the pattern uses">FOLD</button>` : ''}
<span class="w-rabstand"></span>
${a.f ? `<span class="w-etikett">PAGE</span><button data-w="seq-seite" data-a="zurueck" data-richtung="-1" class="w-rknopf" title="Previous page">◀</button><b class="w-rfenster" data-w="r-fenster">${a.f.breite === 1 ? `BAR ${a.f.start + 1}` : `BAR ${a.f.start + 1} – ${a.f.start + a.f.breite}`}</b><button data-w="seq-seite" data-a="vor" data-richtung="1" class="w-rknopf" title="Next page">▶</button>
<span class="w-etikett">VIEW</span>${SICHTEN_SEITE.map((n) => `<button data-w="r-sicht" data-a="sicht" data-n="${n}" class="w-rknopf${a.f.sicht === n ? ' an' : ''}" title="Show ${n} bar${n === 1 ? '' : 's'} at once">${n}</button>`).join('')}<span class="w-etikett">bars</span>` : ''}
</div>`;
  }

  // the bar strip: which module bars hold notes (the pattern repeats through the module)
  // in a slice grid a hit counts at its nearest step (grid.js imSchritt), so a hit just in front of a bar line marks the bar it starts, and a hit in the
  // last half cell of the pattern marks the start of the next pass
  function barBelegt(clip, takte, art) {
    const P = (clip.loop_beats ?? clip.laenge_beats) || 4, aus = new Set();
    for (const n of clip.noten ?? []) {
      let beat = n.beat;
      if (art === 'slice') { beat = Math.floor(n.beat / SCHRITT + 0.5 + EPS) * SCHRITT; if (beat >= P - EPS) beat = 0; }
      for (let b = beat; b < takte * 4 - EPS; b += P) aus.add(Math.floor(b / 4 + EPS));
    }
    return aus;
  }
  function leisteHtml(a) {
    const belegt = barBelegt(a.clip, a.takte, a.art);
    const L = leiste(a.takte, a.f);
    const erste = L.findIndex((b) => b.sichtbar), letzte = L.length - 1 - [...L].reverse().findIndex((b) => b.sichtbar);
    return `<div class="w-rleiste" data-w="r-leiste">${L.map((b, i) => `<div data-w="r-takt" data-a="takt" data-n="${b.takt}" class="${klassen('w-rtakt', b.betont && 'betont', b.sichtbar && 'sichtbar', i === erste && 'von', i === letzte && 'bis')}" title="Show bar ${b.nr}">${b.nr}${belegt.has(b.takt) ? '<i></i>' : ''}</div>`).join('')}</div>`;
  }

  const spaltenZahl = (a) => { const [von, bis] = fensterSpanne(a.f); return bis - von; };
  const spalten = (a) => `grid-template-columns:repeat(${spaltenZahl(a)},1fr)`;
  const lane = (a, name, inhalt, extra = '') => `<div class="w-lane" data-w="lane"><div class="${klassen('w-ln', extra)}"${name.attrs ?? ''}>${name.html}</div><div class="w-steps" style="${spalten(a)}">${inhalt}</div></div>`;

  function zaehlungHtml(a) {
    const z = zaehlung(a.f);
    const bar = lane(a, { html: 'BAR' }, z.takte.map((t) => `<div class="w-ru bar" data-w="r-bar" style="grid-column:span ${t.spanne}">BAR ${t.nr}</div>`).join(''), 'w-ln-zaehlung');
    const first = a.f.start * a.aufl;
    // above the row heads of a drum grid: what the three fields and the two buttons of every row are
    const kap = a.art === 'drum' ? '<span class="w-zkap-frei"></span><span class="w-zkap lang" title="Own length of the row in steps: rows of different length drift against each other (polymeter)">LEN</span><span class="w-zkap lang" title="Swing of the row in percent">SWING</span><span class="w-zkap dir" title="Direction of the row: forward, or forward and back">DIR</span><span class="w-zkap schieb" title="Shift the hits of the row by one step">SHIFT</span>' : '';
    const schritt = lane(a, { html: `STEP${kap}` }, z.schritte.map((s, i) => `<div class="${klassen('w-ru', s.betont && 'betont')}" data-w="r-schritt" data-schritt="${first + i}">${s.nr}</div>`).join(''), a.art === 'drum' ? 'w-ln-zaehlung w-ln-kap' : 'w-ln-zaehlung');
    return bar + schritt;
  }

  // What a set step shows for the tab: a fill height (VELOCITY, LENGTH, CHANCE) and/or the number (CHANCE, OFFSET and REPEAT when the note has one).
  const FUELL_HOCH = { vel: 127, laenge: 16, chance: 100 };
  function zellInhalt(z, feld) {
    if (!z.an || !ZELLEN_FELDER.includes(feld)) return '';
    const fuellung = feld in FUELL_HOCH ? `<i class="w-zf" style="height:${klemme(((feld === 'vel' ? z.vel : feld === 'laenge' ? z.laenge : z.chance ?? 100) / FUELL_HOCH[feld]) * 100, 8, 100).toFixed(0)}%"></i>` : '';
    const zahl = z[feld] != null && ['chance', 'versatz', 'wdh'].includes(feld) ? `<b class="w-zn">${feld === 'versatz' && z.versatz > 0 ? '+' : ''}${z[feld]}</b>` : '';
    return fuellung + zahl;
  }
  function zellenHtml(a, zs, art) {
    // a note of more than one step is tied into the next steps (note grid only: the 909 ignores note off)
    const fort = new Set();
    if (art === 'note') zs.forEach((z, i) => { if (z.an && z.laenge > 1) for (let j = 1; j < z.laenge && i + j < zs.length; j++) fort.add(i + j); });
    const ausw = new Set(a.ts.auswahl.map((k) => `${k.ton}:${k.quelle}`)), cur = a.ts.cursor;
    const fuellt = ZELLEN_FELDER.includes(a.feld) && ['vel', 'laenge', 'chance'].includes(a.feld);
    return zs.map((z, i) => `<div data-w="zelle" data-a="zelle" data-ton="${z.ton}" data-schritt="${z.schritt}" data-quelle="${z.quelle}" class="${klassen('w-st', betontNr(z.schritt % a.aufl + 1) && 'betont', z.wiederholung && 'wiederholung', z.an && 'an', z.an && fuellt && 'mitfuell', z.rueck && 'w-rueck', !z.an && fort.has(i) && 'fort', z.ende && 'ende', ausw.has(`${z.ton}:${z.quelle}`) && 'gewaehlt', cur && cur.ton === z.ton && cur.schritt === z.schritt && 'cursor')}">${zellInhalt(z, a.feld)}</div>`).join('');
  }

  // The row head of a drum grid: the name (click plays it), LENGTH in steps (empty = pattern length), SWING in percent, direction (pendulum).
  function zeilenKopf(a, z) {
    const name = `<span data-w="zeilenname" data-a="reihe" data-ton="${z.ton}">${esc(z.name)}</span>`;
    if (a.art !== 'drum') return name;
    const d = zeileDaten(a.clip, z.ton), aus = a.zust === 'muster' ? '' : ' disabled';
    return `${name}<input data-w="zeile-laenge" data-ton="${z.ton}" class="w-zin" inputmode="numeric" autocomplete="off" value="${d.schritte == null ? '' : zeilenLaengeInZellen(d.schritte, a.aufl)}" placeholder="${musterZellen(a.clip, a.aufl)}" title="Row length in steps of the view (empty: the pattern length)" aria-label="${esc(z.name)} length"${aus}>`
      + `<input data-w="zeile-swing" data-ton="${z.ton}" class="w-zin" inputmode="numeric" autocomplete="off" value="${d.swing ?? ''}" placeholder="0" title="Swing in percent: every second sixteenth is delayed" aria-label="${esc(z.name)} swing"${aus}>`
      + `<button data-w="zeile-richtung" data-a="richtung" data-ton="${z.ton}" class="w-rknopf w-zrichtung${d.richtung === 'pendel' ? ' an' : ''}" aria-pressed="${d.richtung === 'pendel'}" title="Direction: every second pass runs backwards"${aus}>⇄</button>`
      + `<button data-w="zeile-schieb" data-a="schieb" data-r="-1" data-ton="${z.ton}" class="w-rknopf w-zschieb" title="Shift this row one step earlier" aria-label="${esc(z.name)} one step earlier"${aus}>◀</button>`
      + `<button data-w="zeile-schieb" data-a="schieb" data-r="1" data-ton="${z.ton}" class="w-rknopf w-zschieb" title="Shift this row one step later" aria-label="${esc(z.name)} one step later"${aus}>▶</button>`;
  }
  function bereichHtml(a) {
    const b = bereichDaten(st.projekt), von = (b.gesetzt ? b.von : 0) * a.aufl / 4, bis = (b.gesetzt ? b.bis : b.modul ?? a.takte * 4) * a.aufl / 4;
    const first = a.f.start * a.aufl;
    const zs = Array.from({ length: spaltenZahl(a) }, (_, i) => first + i);
    return `<div class="w-lane w-bereich${b.gesetzt ? ' gesetzt' : ''}" data-w="bereich" title="Loop range: drag over the steps to set it (whole beats), double-click removes it"><div class="w-ln w-ln-zaehlung">LOOP</div><div class="w-steps" style="${spalten(a)}">${zs.map((s) => `<div data-w="bereich-schritt" data-schritt="${s}" class="${klassen('w-br', s >= von && s < bis && 'im', s === von && 'links', s === bis - 1 && 'rechts')}"></div>`).join('')}</div></div>`;
  }

  function zeilenHtml(a) {
    const zeile = (z, ton) => `${zellenHtml(a, zellen(a.clip, ton, a.f, a.art).map((x) => ({ ...x, ton })), a.art)}`;
    if (REIHEN_ART(a.art)) {
      return a.zeilen.map((z) => lane(a, { html: zeilenKopf(a, z) }, zeile(z, z.ton), klassen('w-ln-drum', z.ton === a.ton && 'gewaehlt'))).join('');
    }
    const tasten = a.zeilen.map((z) => lane(a, { html: esc(z.name), attrs: ` data-w="zeilenname" data-a="taste" data-ton="${z.ton}" title="Click to hear this note"` }, zeile(z, z.ton), klassen('w-ln-taste', z.schwarz ? 'schwarz' : 'weiss', z.c && 'c'))).join('');
    let oktaven = '';
    if (!a.ts.fold) {
      const O = oktavLeiste(a.ts.oben, a.clip);
      const erste = O.findIndex((o) => o.sichtbar), letzte = O.length - 1 - [...O].reverse().findIndex((o) => o.sichtbar);
      oktaven = `<div class="w-okt" data-w="r-okt" title="Octaves: click to jump, wheel over the rows to roll">${O.map((o, i) => `<div data-w="oktave" data-a="oktave" data-oben="${o.oben}" class="${klassen('w-o', o.sichtbar && 'sichtbar', o.noten && 'hat', i === erste && 'von', i === letzte && 'bis')}">${o.oktave}</div>`).join('')}</div>`;
    }
    return `<div class="w-tonblock" data-w="r-tonblock">${oktaven}<div class="w-tonzeilen" data-w="r-ton">${tasten}</div></div>`;
  }

  // Knob lanes: the knobs of a Baukasten device that have an envelope in the clip or were added here. The slice grid shows k3 as PITCH.
  const reglerVon = (a) => (a.info?.art === 'bk' ? a.info.regler ?? [] : []).filter((r) => typeof r.nr === 'number' && !(a.art === 'slice' && r.nr === 3));
  const knopfLanes = (a) => {
    const da = reglerVon(a).map((r) => r.nr);
    return [...new Set([...knopfSpuren(a.clip), ...a.ts.knoepfe])].filter((nr) => da.includes(nr)).sort((x, y) => x - y);
  };
  const reglerName = (a, nr) => reglerVon(a).find((r) => r.nr === nr)?.name ?? `Knob ${nr}`;
  function feldTabs(a) {
    const fest = TABS[a.art].map((k) => `<button data-w="seq-wert-tab" data-a="feld" data-feld="${k}" class="w-rknopf${k === a.feld ? ' an' : ''}">${FELDER[k]}</button>`).join('');
    const lanes = knopfLanes(a);
    const knoepfe = lanes.map((nr) => `<button data-w="seq-wert-tab" data-a="feld" data-feld="k${nr}" class="w-rknopf${a.feld === `k${nr}` ? ' an' : ''}">${esc(reglerName(a, nr).toUpperCase())}</button>`).join('');
    const frei = reglerVon(a).filter((r) => !lanes.includes(r.nr));
    const wahl = frei.length && a.zust === 'muster' ? `<select data-w="r-lane-neu" class="w-rknopf w-lane-neu" title="${RASTER_TEXT.laneNeuTitel}" aria-label="${RASTER_TEXT.laneNeuTitel}"><option value="">${RASTER_TEXT.laneNeu}</option>${frei.map((r) => `<option value="${r.nr}">${esc(r.name)}</option>`).join('')}</select>` : '';
    return fest + knoepfe + wahl;
  }
  // A knob lane: over all rows, a bar from the bottom for the knob position of the step; amber where the step holds its own value, dim where it plays the knob.
  function knopfHtml(a, nr) {
    const weg = a.zust === 'muster' ? `<button data-w="r-lane-weg" data-a="lane-weg" data-n="${nr}" class="w-rknopf" title="${RASTER_TEXT.laneWeg}">×</button>` : '';
    const kopf = `<div class="w-werte" data-w="r-werte"><span class="w-etikett">${RASTER_TEXT.werte}</span>${feldTabs(a)}${weg}<span class="w-hinweis" data-w="r-hinweis">${RASTER_TEXT.hinweisAlle}</span></div>`;
    const zs = knopfZellen(a.spur, a.clip, a.f, a.info, nr);
    const zellenHtml2 = zs.map((z) => `<div data-w="wert" data-schritt="${z.schritt}" data-quelle="${z.quelle}" data-da="1" data-wert="${z.wert}" title="${Math.round(z.wert * 100)} %${z.eigen ? '' : ' (knob)'}" class="${klassen('w-val', 'w-kn-lane', betontNr(z.schritt % a.aufl + 1) && 'betont', z.eigen && 'eigen', z.wiederholung && 'wiederholung')}"><i style="height:${klemme(z.wert * 100, 3, 100).toFixed(1)}%"></i></div>`).join('');
    return kopf + lane(a, { html: esc(reglerName(a, nr)) }, zellenHtml2, 'w-ln-zaehlung');
  }
  // PITCH (slice grid): a lane over all rows. A bar from the middle line up (raised) or down (lowered); the amber ones are a step's own value, the others
  // play the track knob. Semitones are in data-halb and in the tooltip.
  function pitchHtml(a) {
    const kopf = `<div class="w-werte" data-w="r-werte"><span class="w-etikett">${RASTER_TEXT.werte}</span>${feldTabs(a)}<span class="w-hinweis" data-w="r-hinweis">${RASTER_TEXT.hinweisAlle}</span></div>`;
    const zs = pitchZellen(a.spur, a.clip, a.f, a.info);
    const zellenHtml2 = zs.map((z) => {
      const hoehe = Math.abs(z.halb) / PITCH_MAX * 50;
      const balken = z.halb === 0 ? '<i class="null"></i>' : `<i style="${z.halb > 0 ? 'bottom' : 'top'}:50%;height:${hoehe.toFixed(1)}%"></i>`;
      return `<div data-w="wert" data-schritt="${z.schritt}" data-quelle="${z.quelle}" data-da="1" data-halb="${z.halb}" title="${z.halb > 0 ? '+' : ''}${z.halb} st${z.eigen ? '' : ' (knob)'}" class="${klassen('w-val', 'w-pitch', betontNr(z.schritt % a.aufl + 1) && 'betont', z.eigen && 'eigen', z.wiederholung && 'wiederholung')}">${balken}</div>`;
    }).join('');
    return kopf + lane(a, { html: FELDER.pitch }, zellenHtml2, 'w-ln-zaehlung');
  }

  function wertHtml(a) {
    const feld = a.feld;
    if ((feld === 'pitch' || knopfNr(feld) !== null) && a.aufl !== SCHRITTE_TAKT) {   // these lanes hold one value per sixteenth: only edited at 16 steps per bar
      return `<div class="w-werte" data-w="r-werte"><span class="w-etikett">${RASTER_TEXT.werte}</span>${feldTabs(a)}<span class="w-hinweis" data-w="r-hinweis">${RASTER_TEXT.hinweisLane}</span></div>`;
    }
    if (feld === 'pitch') return pitchHtml(a);
    if (knopfNr(feld) !== null) return knopfHtml(a, knopfNr(feld));
    const tabs = feldTabs(a);
    const kopf = `<div class="w-werte" data-w="r-werte"><span class="w-etikett">${RASTER_TEXT.werte}</span>${tabs}<span class="w-hinweis" data-w="r-hinweis">${LANE_REIHE(a.art) ? RASTER_TEXT.hinweisReihe : a.art === 'slice' ? RASTER_TEXT.hinweisSchritte : RASTER_TEXT.hinweisNoten}</span></div>`;
    if (!['vel', 'laenge', 'rueck'].includes(feld)) return kopf.replace(/<span class="w-hinweis"[^>]*>.*?<\/span>/, `<span class="w-hinweis" data-w="r-hinweis">${RASTER_TEXT.hinweisZelle}</span>`);
    if (a.ton === null && LANE_REIHE(a.art)) return kopf;
    const zs = wertZellen(a.clip, LANE_REIHE(a.art) ? a.ton : null, a.f, feld, a.art);
    const hoch = feld === 'vel' ? 127 : feld === 'laenge' ? 16 : 1;
    const zellenHtml2 = zs.map((z) => `<div data-w="wert" data-schritt="${z.schritt}" data-quelle="${z.quelle}" data-da="${z.da ? 1 : 0}" class="${klassen('w-val', betontNr(z.schritt % a.aufl + 1) && 'betont', z.anders && 'anders', z.wiederholung && 'wiederholung')}">${z.da ? `<i style="height:${klemme(z.wert / hoch * 100, 4, 100).toFixed(1)}%"></i>` : ''}</div>`).join('');
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
    const takte = modulTakte(st.projekt) ?? klemme(Math.ceil(musterTakte(clip) - EPS), 1, MAX_TAKTE);   // D6: a module length that is no length of the top bar falls back to the pattern
    // the grid is the module: every bar of it, in pages; a pattern shorter than the module (older projects) shows its repeats pale
    const f = fenster({ sicht, start: ts.start, aufl: ts.aufl }, takte);
    ts.start = f.start;
    if (ts.oben === null) ts.oben = startOben(clip);
    let zeilen, ton = null;
    if (REIHEN_ART(art)) {
      zeilen = art === 'slice' ? sliceZeilen(clip, info) : drumZeilen(clip, info);
      const belegt = (z) => (clip.noten ?? []).some((n) => n.ton === z.ton || (art === 'slice' && n.ton === z.ton + 64));
      ton = (zeilen.find((z) => z.ton === ts.reihe) ?? zeilen.find(belegt) ?? zeilen[0])?.ton ?? null;
    } else {
      zeilen = tonZeilen(ts.oben, ts.fold, clip);
    }
    const a = { spur, clip, art, zust, ts, f, takte, aufl: f.aufl, zeilen, ton, feld: ts.feld, zeilenDa: zeilen.length > 0, info };
    // LENGTH exists in the note and slice grids, REVERSE and PITCH in the slice grid only, a knob lane while its knob has one
    if (!TABS[art].includes(ts.feld) && !knopfLanes(a).includes(knopfNr(ts.feld))) a.feld = ts.feld = 'vel';
    akt = a;
    const text = zust === 'gesperrt' ? `<p class="w-rtext" data-w="r-text">${RASTER_TEXT.gesperrt}</p>` : '';
    host.innerHTML = `${kopfHtml(a)}${text}<div class="${klassen('w-raster', `sicht-${f.sicht}`, REIHEN_ART(art) && 'reihen', zust !== 'muster' && 'gesperrt')}" data-w="r-raster">${leisteHtml(a)}${bereichHtml(a)}${zaehlungHtml(a)}${zeilenHtml(a)}${wertHtml(a)}</div>`;
    setzeKopf(kopfSchrittJetzt(performance.now()));
  }

  // ----- playhead -----
  function kopfSchrittJetzt(t) {
    if (!akt) return null;
    const b = ctx.kopfBeat(t);
    if (b === null || b === undefined || !Number.isFinite(b)) return null;
    const L = akt.takte * 4;
    return Math.floor((((b % L) + L) % L) / weite(akt.aufl) + EPS);
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

  // `erst`: the press that starts a gesture. REVERSE toggles, so only the press acts; a drag over the lane does nothing for it.
  function wertSetzen(el, e, erst = true) {
    if (!frei()) return;
    const { spur, clip, art, ton, ts } = akt;
    const quelle = Number(el.dataset.quelle);
    if (ts.feld === 'pitch') {   // a lane over all rows: the height of the press is the value (-12..12 semitones), shift removes the value of the step
      const r = el.getBoundingClientRect();
      const anteil = Number.isFinite(e.clientY) ? klemme((r.bottom - e.clientY) / (r.height || 1), 0, 1) : 0.5;
      const halb = e.shiftKey ? null : Math.round(PITCH_MIN + anteil * (PITCH_MAX - PITCH_MIN));
      if (halb === null && !erst) return;
      sende(`${spur.name}: pitch`, pitchBefehle(spur, clip, quelle, halb, ctx.info(spur)), `${spur.id}:pitch:${quelle}`);
      return;
    }
    const nr = knopfNr(ts.feld);
    if (nr !== null) {   // a knob lane over all rows: the height of the press is the knob position, shift removes the value of the step
      const r = el.getBoundingClientRect();
      const anteil = Number.isFinite(e.clientY) ? klemme((r.bottom - e.clientY) / (r.height || 1), 0, 1) : 0.5;
      const wert = e.shiftKey ? null : Math.round(anteil * 100) / 100;
      if (wert === null && !erst) return;
      sende(`${spur.name}: ${reglerName(akt, nr)}`, knopfBefehle(spur, clip, quelle, wert, ctx.info(spur), nr), `${spur.id}:k${nr}:${quelle}`);
      return;
    }
    if (ts.feld === 'rueck') {
      if (erst) sende(`${spur.name}: reverse`, rueckBefehle(clip, LANE_REIHE(art) ? ton : null, quelle, akt.aufl));
      return;
    }
    const r = el.getBoundingClientRect();
    const anteil = Number.isFinite(e.clientY) ? klemme((r.bottom - e.clientY) / (r.height || 1), 0, 1) : 1;
    const feld = ts.feld;
    const wert = feld === 'vel' ? Math.round(1 + anteil * 126) : Math.max(1, Math.ceil(anteil * 16));
    const zeilenTon = LANE_REIHE(art) ? ton : null;
    sende(`${spur.name}: ${feld === 'vel' ? 'velocity' : 'length'}`, wertBefehle(clip, zeilenTon, quelle, feld, wert, art, akt.aufl), `${spur.id}:${feld}:${zeilenTon}:${quelle}`);
  }
  const wertAus = (e) => e.target?.closest?.('[data-w="wert"]') ?? null;

  // A click on a row name (a key of the piano, a drum sound, a slice) plays it once through the track. A refusal is told, nothing else changes.
  async function hoere(a, ton) {
    if (!Number.isInteger(ton)) return;
    const r = await ctx.holeJson('/sampler/hoeren', a.art === 'slice' ? { spur_id: a.spur.id, scheibe: ton } : { spur_id: a.spur.id, ton });
    if (r.status !== 200) ctx.melde(typeof r.j?.text === 'string' && r.j.text !== '' ? `${r.j.text.charAt(0).toUpperCase()}${r.j.text.slice(1)}` : ctx.antwortText(r), true);
  }
  host.addEventListener('click', (e) => {
    const a = e.target?.closest?.('[data-a]');
    if (!a || !akt && !['sicht'].includes(a.dataset.a)) return;
    if (a.dataset.a !== 'zelle') skipKlick = false;
    const n = Number(a.dataset.n);
    switch (a.dataset.a) {
      case 'werkzeug': werkzeug = a.dataset.n; zeichne(); break;
      case 'fuell': fuell = n; zeichne(); break;
      case 'richtung': {
        if (!frei()) return;
        const { spur, clip } = akt, ton = Number(a.dataset.ton);
        mitFehler(() => sende(`${spur.name}: row direction`, zeileBefehle(clip, ton, 'richtung', clip.zeilen?.[ton]?.richtung === 'pendel' ? null : 'pendel')));
        break;
      }
      case 'schieb': {
        if (!frei()) return;
        const { spur, clip } = akt, ton = Number(a.dataset.ton);
        mitFehler(() => sende(`${spur.name}: shift row`, schiebeBefehle(clip, ton, Number(a.dataset.r), akt.aufl)));
        break;
      }
      case 'sicht': sicht = n; ctx.merke(SICHT_SCHLUESSEL, String(n)); zeichne(); break;
      case 'zurueck': akt.ts.start = blaettere(akt.f, -1, akt.takte).start; zeichne(); break;
      case 'vor': akt.ts.start = blaettere(akt.f, 1, akt.takte).start; zeichne(); break;
      case 'takt': akt.ts.start = taktWahl(akt.f, n, akt.takte).start; zeichne(); break;
      case 'fold': akt.ts.fold = !akt.ts.fold; zeichne(); break;
      case 'oktave': akt.ts.oben = Number(a.dataset.oben); zeichne(); break;
      case 'reihe': hoere(akt, Number(a.dataset.ton)); akt.ts.reihe = Number(a.dataset.ton); zeichne(); break;
      case 'taste': hoere(akt, Number(a.dataset.ton)); break;
      case 'feld': akt.ts.feld = a.dataset.feld; zeichne(); break;
      case 'lane-weg': {   // the lane leaves the tabs; an envelope it holds is deleted in one step
        if (!frei()) return;
        const { spur, clip, ts } = akt;
        ts.knoepfe = ts.knoepfe.filter((x) => x !== n);
        ts.feld = 'vel';
        if (knopfSpuren(clip).includes(n)) sende(`${spur.name}: remove lane ${reglerName(akt, n)}`, [{ befehl: 'huellkurve_loeschen', clip_id: clip.id, ziel: knopfZiel(n) }]);
        zeichne();
        break;
      }
      case 'aufl': {   // STEPS: the resolution of this track's view; selection and cursor name cells of the old resolution
        if (!akt || !STEPS_WAHL.includes(n)) return;
        akt.ts.aufl = n; akt.ts.auswahl = []; akt.ts.anker = null; akt.ts.cursor = null;
        ctx.merke(`${AUFL_SCHLUESSEL}${akt.spur.id}`, String(n));
        zeichne();
        break;
      }
      case 'zelle': {
        if (skipKlick || !frei()) return;   // a gesture that ended on its pointerup has done its work already
        if (e.ctrlKey || e.metaKey) { gesetzteAuswahl(auswahlUmschalten(akt.ts.auswahl, { ton: Number(a.dataset.ton), quelle: Number(a.dataset.quelle) })); break; }
        const { spur, clip, art } = akt;
        mitFehler(() => sende(`${spur.name}: notes`, klickBefehle(spur, clip, Number(a.dataset.ton), Number(a.dataset.quelle), art, ctx.info(spur), akt.aufl)));
        break;
      }
      default:
    }
  });
  host.addEventListener('change', (e) => {
    const feldEl = e.target?.closest?.('[data-w="zeile-laenge"], [data-w="zeile-swing"]');
    if (feldEl) {
      if (!akt || !frei()) return;
      const { spur, clip } = akt, ton = Number(feldEl.dataset.ton), laenge = feldEl.dataset.w === 'zeile-laenge';
      const roh = String(feldEl.value ?? '').trim();
      // a row length is typed in steps of the view and stored in sixteenths
      mitFehler(() => sende(`${spur.name}: row ${laenge ? 'length' : 'swing'}`, zeileBefehle(clip, ton, laenge ? 'schritte' : 'swing', roh === '' ? null : laenge ? zeilenLaengeAusZellen(roh, akt.aufl) : roh)));
      zeichne();   // a refused or unchanged value goes back to what the project holds
      return;
    }
    const wahl = e.target?.closest?.('[data-w="r-lane-neu"]');
    const nr = Number(wahl?.value);
    if (!wahl || !akt || !frei() || !Number.isInteger(nr) || nr < 1) return;
    if (!akt.ts.knoepfe.includes(nr)) akt.ts.knoepfe.push(nr);
    akt.ts.feld = `k${nr}`;
    zeichne();
  });
  host.addEventListener('wheel', (e) => {
    if (!akt || akt.art !== 'note' || akt.ts.fold || !e.target?.closest?.('[data-w="r-ton"]')) return;
    e.preventDefault?.();
    akt.ts.oben = radOben(akt.ts.oben, e.deltaY);
    zeichne();
  }, { passive: false });
  // ----- mouse gestures: grid cells, value drags on a set step, the loop brace -----
  // During a gesture the DOM only shows a preview (class `vorschau`, live numbers); the project is written once, when the pointer goes up.
  let g = null;                  // the running gesture
  const unter = (e) => document.elementFromPoint?.(e.clientX, e.clientY) ?? e.target;
  const zelleDaten = (el) => (el ? { ton: Number(el.dataset.ton), schritt: Number(el.dataset.schritt), quelle: Number(el.dataset.quelle) } : null);
  const zeilenToene = () => akt.zeilen.map((z) => z.ton);
  const gleichZelle = (x, y) => x.ton === y.ton && x.schritt === y.schritt;
  function gesetzteAuswahl(liste, cursor) { akt.ts.auswahl = liste; if (cursor) akt.ts.cursor = cursor; zeichne(); }
  function gestenZiele(gg) {
    const { clip, art, ts } = akt;
    switch (gg.modus) {
      case 'malen': case 'loeschen': return gg.cells.map((c) => ({ ton: c.ton, quelle: c.quelle }));
      case 'linie': case 'rampe': return linieZiele(clip, gg.start.ton, gg.start.schritt, gg.ende.schritt, art, akt.aufl);
      case 'fuellen': return fuellZiele(clip, gg.start.ton, gg.start.schritt, gg.ende.schritt, fuell, art, akt.aufl);
      case 'auswahl': return rechteckZiele(clip, zeilenToene(), gg.start.ton, gg.start.schritt, gg.ende.ton, gg.ende.schritt, art, akt.aufl);
      case 'wert': {
        const q = { ton: gg.start.ton, quelle: gg.start.quelle };
        return ts.auswahl.some((k) => k.ton === q.ton && k.quelle === q.quelle) ? ts.auswahl : [q];
      }
      default: return [];
    }
  }
  function vorschau() {
    for (const el of g.vor) el.classList.remove('vorschau');
    g.vor = [];
    if (g.modus === 'bereich') {
      const [a, b] = [Math.min(g.s0, g.s1), Math.max(g.s0, g.s1)];
      for (const el of host.querySelectorAll('[data-w="bereich-schritt"]')) { const s = Number(el.dataset.schritt); if (s >= a && s <= b) { el.classList.add('vorschau'); g.vor.push(el); } }
      return;
    }
    const ziele = gestenZiele(g), keys = new Set(ziele.map((z) => `${z.ton}:${z.quelle}`));
    const feld = akt.ts.feld;
    let werte = null;
    if (g.modus === 'wert' && g.bewegt) werte = ziehWerte(akt.clip, akt.art, feld, ziele, g.dy, akt.aufl);
    if (g.modus === 'rampe') werte = rampeWerte(akt.clip, akt.art, g.start.ton, feld, g.start.schritt, g.ende.schritt, g.dy, akt.aufl);
    const neu = werte ? new Map(werte.map((w) => [`${w.ton}:${w.quelle}`, w.wert])) : null;
    for (const el of host.querySelectorAll('[data-w="zelle"]')) {
      const k = `${el.dataset.ton}:${el.dataset.quelle}`;
      if (!keys.has(k)) continue;
      el.classList.add('vorschau'); g.vor.push(el);
      if (neu?.has(k)) {
        const w = neu.get(k), f = el.querySelector('i.w-zf'), n = el.querySelector('b.w-zn');
        if (f) f.style.height = `${klemme((w / (feld === 'vel' ? 127 : feld === 'laenge' ? 16 : 100)) * 100, 8, 100).toFixed(0)}%`;
        if (n) n.textContent = `${feld === 'versatz' && w > 0 ? '+' : ''}${w}`;
      }
    }
  }
  const schreibe = (label, befehle) => { if (befehle.length) ctx.aendere(label, befehle); else zeichne(); };
  function einzeln(c) {   // a press without movement: the step toggles
    const { spur, clip, art } = akt;
    mitFehler(() => schreibe(`${spur.name}: notes`, klickBefehle(spur, clip, c.ton, c.quelle, art, ctx.info(spur), akt.aufl)));
  }
  function fertig(gg) {
    const { spur, clip, art, ts } = akt, info = ctx.info(spur);
    if (gg.modus === 'bereich') {
      const b = bereichDaten(st.projekt);
      const bef = gg.s0 === gg.s1 ? null : bereichBefehl(gg.s0, gg.s1, b.modul, b.gesetzt, akt.aufl);
      schreibe('Loop range', bef ? [bef] : []);
      return;
    }
    ts.cursor = { ton: gg.ende.ton, schritt: gg.ende.schritt };
    const ziele = gestenZiele(gg);
    switch (gg.modus) {
      case 'auswahl':
        if (gg.bewegt) gesetzteAuswahl(ziele); else gesetzteAuswahl(auswahlUmschalten(ts.auswahl, ziele[0]));
        return;
      case 'malen': case 'linie': case 'wert':
        if (!gg.bewegt && (gg.modus !== 'linie' || ziele.length <= 1)) { einzeln(gg.start); return; }
        if (gg.modus === 'wert') { schreibe(`${spur.name}: ${WERT_FELDER[ts.feld].name}`, ziehBefehle(clip, art, ts.feld, ziele, gg.dy, akt.aufl)); return; }
        schreibe(`${spur.name}: notes`, setzeBefehle(clip, art, info, ziele, gg.modus === 'linie' ? true : gg.an, akt.aufl));
        return;
      case 'loeschen': schreibe(`${spur.name}: notes`, setzeBefehle(clip, art, info, ziele, false, akt.aufl)); return;
      case 'fuellen': schreibe(`${spur.name}: notes`, setzeBefehle(clip, art, info, ziele, true, akt.aufl)); return;
      case 'rampe': schreibe(`${spur.name}: ${WERT_FELDER[ts.feld].name} ramp`, rampeBefehle(clip, art, gg.start.ton, ts.feld, gg.start.schritt, gg.ende.schritt, gg.dy, akt.aufl)); return;
      default:
    }
  }
  function beende() {
    const gg = g; g = null;
    skipKlick = true; setTimeout(() => { skipKlick = false; }, 0);   // the click that follows this pointerup has been handled here
    if (akt) mitFehler(() => fertig(gg));
  }
  host.addEventListener('pointerdown', (e) => {
    if (e.button) return;   // the primary button or a touch only
    skipKlick = false;
    const el = wertAus(e);
    if (el) { if (!frei()) return; zieht = true; mitFehler(() => wertSetzen(el, e)); return; }
    if (!akt) return;
    const br = e.target?.closest?.('[data-w="bereich-schritt"]');
    if (br) { const s = Number(br.dataset.schritt); g = { modus: 'bereich', s0: s, s1: s, vor: [], bewegt: false }; return; }
    const ze = e.target?.closest?.('[data-w="zelle"]');
    if (!ze || !frei()) return;
    const c = zelleDaten(ze), hat = notenAn(akt.clip, c, akt.art, akt.aufl).length > 0;
    const strg = e.ctrlKey || e.metaKey, tab = ZELLEN_FELDER.includes(akt.ts.feld);
    // a plain press beside a selection only clears it; on a selected step it starts the value drag for all of them
    if (!strg && !e.shiftKey && akt.ts.auswahl.length && !akt.ts.auswahl.some((k) => k.ton === c.ton && k.quelle === c.quelle)) {
      akt.ts.auswahl = []; akt.ts.anker = null; skipKlick = true; setTimeout(() => { skipKlick = false; }, 0); zeichne(); return;
    }
    const modus = strg ? 'auswahl' : e.shiftKey ? (tab && hat ? 'rampe' : 'linie')
      : tab && hat && werkzeug === 'draw' ? 'wert' : werkzeug === 'erase' ? 'loeschen' : werkzeug === 'fill' ? 'fuellen' : 'malen';
    g = { modus, start: c, ende: c, cells: [c], y0: Number.isFinite(e.clientY) ? e.clientY : 0, dy: 0, an: !hat, bewegt: false, vor: [] };
    host.focus?.();
    if (modus === 'loeschen' || modus === 'fuellen' || modus === 'malen') vorschau();
  });
  host.addEventListener('pointermove', (e) => {
    if (g) {
      if (e.buttons === 0) { g.vor.forEach((x) => x.classList.remove('vorschau')); g = null; zeichne(); return; }
      if (g.modus === 'bereich') {
        const b = unter(e)?.closest?.('[data-w="bereich-schritt"]');
        if (b) { g.s1 = Number(b.dataset.schritt); g.bewegt = g.s1 !== g.s0; vorschau(); }
        return;
      }
      const dy = Number.isFinite(e.clientY) ? e.clientY - g.y0 : 0, c = zelleDaten(unter(e)?.closest?.('[data-w="zelle"]'));
      if (g.modus === 'wert') { g.dy = dy; if (Math.abs(dy) >= 3) g.bewegt = true; } else if (g.modus === 'rampe') { g.dy = dy; if (Math.abs(dy) >= 3) g.bewegt = true; }
      if (c) {
        if (g.modus === 'malen' || g.modus === 'loeschen') {
          const vor = g.cells.at(-1);
          if (!gleichZelle(vor, c)) {
            if (vor.ton === c.ton) {   // a fast pointer skips cells: fill the gap in the row
              const r = c.schritt > vor.schritt ? 1 : -1;
              for (let s = vor.schritt + r; s !== c.schritt; s += r) g.cells.push({ ton: c.ton, schritt: s, quelle: quelleVonZeile(c.ton, s) });
            }
            g.cells.push(c); g.bewegt = true;
          }
        } else if (g.modus !== 'wert') {
          if (!gleichZelle(g.ende, c)) g.bewegt = true;
          g.ende = g.modus === 'auswahl' ? c : { ...c, ton: g.start.ton };
        }
      }
      vorschau();
      return;
    }
    if (!zieht) return;
    if (e.buttons === 0) { zieht = false; return; }
    const el = wertAus(e);
    if (el && el.dataset.da === '1') mitFehler(() => wertSetzen(el, e, false));   // a drag passes empty steps without a word
  });
  const quelleVonZeile = (ton, schritt) => quelleVon(akt.clip, ton, schritt, akt.art, akt.aufl);
  const ende = () => { zieht = false; if (g) beende(); };
  host.addEventListener('pointerup', ende);
  host.addEventListener('pointercancel', () => { zieht = false; if (g) { g.vor.forEach((x) => x.classList.remove('vorschau')); g = null; zeichne(); } });
  document.addEventListener('pointerup', ende);
  // a press anywhere outside the grid clears the selection
  document.addEventListener('pointerdown', (e) => {
    if (!akt || !akt.ts.auswahl.length || host.contains?.(e.target)) return;
    akt.ts.auswahl = []; akt.ts.anker = null; zeichne();
  });
  host.addEventListener('dblclick', (e) => {   // a double click on the brace removes the loop range
    if (!e.target?.closest?.('[data-w="bereich"]') || !st.projekt || !bereichDaten(st.projekt).gesetzt) return;
    ctx.aendere('Loop range off', [bereichAusBefehl()]);
  });

  // ----- keyboard: only while the grid has the focus, never in an input -----
  host.addEventListener('keydown', (e) => {
    if (!akt || !frei() || e.target?.closest?.('input, select, textarea, button')) return;
    const { spur, clip, art, ts } = akt, toene = zeilenToene();
    if (!toene.length) return;
    const cur = ts.cursor ?? { ton: akt.ton ?? toene[0], schritt: akt.f.start * akt.aufl };
    const taste = String(e.key ?? ''), strg = e.ctrlKey || e.metaKey;
    const ziel = (c) => ({ ton: c.ton, quelle: quelleVonZeile(c.ton, c.schritt) });
    const behandelt = () => e.preventDefault?.();
    if (taste.startsWith('Arrow')) {
      const neu = cursorBewegung(cur, taste, toene, akt.takte * akt.aufl);
      if (e.shiftKey) { ts.anker ??= cur; ts.auswahl = rechteckZiele(clip, toene, ts.anker.ton, ts.anker.schritt, neu.ton, neu.schritt, art, akt.aufl); } else ts.anker = null;
      ts.cursor = neu;
      ts.start = taktWahl(akt.f, Math.floor(neu.schritt / akt.aufl), akt.takte).start;
      behandelt(); zeichne();
    } else if (taste === 'Enter') {
      ts.cursor = cur; behandelt();
      mitFehler(() => sende(`${spur.name}: notes`, klickBefehle(spur, clip, cur.ton, ziel(cur).quelle, art, ctx.info(spur), akt.aufl)));
    } else if (taste === 'Backspace' || taste === 'Delete') {
      behandelt();
      mitFehler(() => sende(`${spur.name}: delete notes`, setzeBefehle(clip, art, ctx.info(spur), ts.auswahl.length ? ts.auswahl : [ziel(cur)], false, akt.aufl)));
    } else if (strg && taste.toLowerCase() === 'd') {
      behandelt();
      const r = mitFehler(() => dupliziereBefehle(clip, art, ts.auswahl, akt.aufl));
      if (r) { ts.auswahl = r.auswahl; sende(`${spur.name}: duplicate`, r.befehle); }
    } else if (taste === 'Escape') { ts.auswahl = []; ts.anker = null; zeichne(); }
  });

  // ----- hooks -----
  ctx.beimProjekt.push((p, wechsel) => { if (wechsel) spurTexte.clear(); zeichne(); });
  ctx.beiWahl.push(() => zeichne());
  ctx.beimSichtwechsel.push((sichtbar) => { if (sichtbar && veraltet) zeichne(); });
  ctx.vorBild.push((t) => setzeKopf(kopfSchrittJetzt(t)));
  (ctx.spurZeile ??= []).push((_zeile, spur) => { if (spur.id === st.wahl && ctx.info(spur) !== gezeigteInfo) zeichne(); });
}
