// Effekt-Sektion (Plan 2026-10-11-effekt-sektion.md): reine Rechenteile, ohne DOM (getestet in tests/effects.test.mjs).

// Startpunkte wie die Presets des VST3 (djk/instruments/comp/presets/presets.json). Der Sidechain heißt im Kern komp/sc
// (Schlüssel = Quellkanal + 1); „Kick Sidechain“ hört auf DRUMS (erz/1 = 5), alle anderen setzen ihn ausdrücklich zurück.
// Der Test hält beide gleich.
export const KOMP_PRESETS = {
  'Drum Bus': { schwelle: -18, ratio: 4, attack: 30, release: 100, makeup: 3, mix: 1, sc: 0 },
  'Bus Glue': { schwelle: -12, ratio: 2, attack: 30, release: 300, makeup: 1.5, mix: 1, sc: 0 },
  Bass: { schwelle: -20, ratio: 4, attack: 5, release: 120, makeup: 3, mix: 1, sc: 0 },
  Parallel: { schwelle: -30, ratio: 10, attack: 3, release: 80, makeup: 10, mix: 0.4, sc: 0 },
  Lead: { schwelle: -20, ratio: 3, attack: 5, release: 80, makeup: 4, mix: 1, sc: 0 },
  'Kick Sidechain': { schwelle: -30, ratio: 8, attack: 1, release: 150, makeup: 0, mix: 1, sc: 5 },
};
// Schlüssel des Kompressors (komp/sc): Wert = Quellkanal + 1
export const KOMP_SCHLUESSEL = [[0, 'own signal'], [5, 'DRUMS'], [6, 'BASS'], [7, 'MELODY'], [1, 'A'], [2, 'B'], [13, 'L1'], [14, 'L2']];
// Was eine Loop-Automation fahren darf, mit Bereich (wie AUTO_BEREICH in loop_automation.ts, der Test hält beide gleich)
export const AUTO_BEREICH = {
  'komp/schwelle': [-60, 0], 'komp/ratio': [1, 20], 'komp/attack': [0.1, 100], 'komp/release': [10, 1000],
  'komp/makeup': [0, 24], 'komp/mix': [0, 1], filter: [-1, 1], 'eq/tief': [-26, 6], 'eq/mitte': [-26, 6], 'eq/hoch': [-26, 6],
  'send/2': [-60, 0],
  'gate/schwelle': [-90, 0], 'gate/hysterese': [0, 24], 'gate/ratio': [1, 100], 'gate/bereich': [-120, 0], 'gate/attack': [0.1, 500],
  'gate/hold': [0, 2000], 'gate/release': [1, 5000], 'util/balance': [-1, 1], 'util/breite': [0, 200], 'util/bassmono': [0, 500],
};
export const DURCHGAENGE = [1, 2, 4, 8, 16, 32];
// Punkt der Automationsspur aus einer Stelle im Feld (breite × hoehe): Beat auf 1/4 gerastet, Wert im Bereich
export function punktAusStelle(x, y, breite, hoehe, beats, [lo, hi]) {
  const beat = Math.min(beats - 0.25, Math.max(0, Math.round((x / breite) * beats * 4) / 4));
  const wert = lo + (1 - Math.min(1, Math.max(0, y / hoehe))) * (hi - lo);
  return [beat, Math.round(wert * 100) / 100];
}
export const KOMP_KNIE_DB = 6;   // im Kern fest (mixer.cpp komp_block)

// Statische Kennlinie (Giannoulis Gl. 4), wie komp_dsp::gain_computer
export function kennlinie(x, t, r, w = KOMP_KNIE_DB) {
  const d = x - t;
  if (2 * d < -w) return x;
  if (w > 0 && 2 * Math.abs(d) <= w) { const u = d + w / 2; return x + (1 / r - 1) * u * u / (2 * w); }
  return t + d / r;
}

// SVG-Pfad der Kennlinie mit Makeup im Feld −60..0 dB Eingang, −60..+24 dB Ausgang auf breite × hoehe
export function kennlinienPfad(t, r, makeup, breite, hoehe) {
  const px = (x) => ((x + 60) / 60) * breite;
  const py = (y) => hoehe - ((Math.max(-60, Math.min(24, y)) + 60) / 84) * hoehe;
  const punkte = [];
  for (let x = -60; x <= 0; x += 0.5) punkte.push(`${px(x).toFixed(1)},${py(kennlinie(x, t, r) + makeup).toFixed(1)}`);
  return `M${punkte.join(' L')}`;
}

// Was auf einem Kanal der Effekt-Sektion läuft, aus /lage: Deck-Titel, Strudel-Muster mit Klang, Loop der Box
const STROM_VON = { 'erz/1': 1, 'erz/2': 2, 'erz/3': 3 };
export function fxInhaltText(k, lage) {
  const d = /^deck\/(\d)$/.exec(k);
  if (d) {
    const x = (lage.decks ?? []).find((y) => y.deck === Number(d[1]));
    if (!x || !x.status) return 'empty';
    return `${x.status >= 2 ? '▶ ' : ''}${x.titel ?? x.material_id ?? 'loaded'}${x.camelot ? ` · ${x.camelot}` : ''}`;
  }
  const p = /^pad\/(\d)$/.exec(k);
  if (p) {
    const b = lage.boxen?.[p[1]];
    return b?.name ? `${b.status === 3 ? '▶ ' : ''}${b.name} · ${b.beats} beats` : 'empty';
  }
  const st = (lage.studio?.stroeme ?? []).find((y) => y.strom === STROM_VON[k]);
  const klang = k === 'erz/2' ? lage.studio?.klang?.bass : k === 'erz/3' ? lage.studio?.klang?.melodie : null;
  const muster = !st || st.text_kurz === 'silence' ? 'silence' : `▶ ${st.text_kurz}`;
  return `${klang ? `${String(klang).replace(/^vst3:/, '')} · ` : ''}${muster}${st && !st.autonom ? ' · AUTO off' : ''}`;
}

// Baukasten S2: die Knobs (1..64) eines Cypher-Modular-Wirts aus POST /klang params ({params: {"Knob 1": 0.5, …}, namen:
// {"Knob 1": "Cutoff"}}). Nur die Knobs, die der Wirt meldet (ein Surge-Wirt meldet keine → leere Liste); ohne Namen steht „Knob n“.
export const KNOB_GRUPPE = { 'erz/2': 'bass', 'erz/3': 'melodie' };
/** Text für innerHTML und Attribute: Knob-Namen stammen aus einer Graphdatei, nicht aus der Seite (Review F2). */
export function htmlText(s) {
  return String(s).replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[z]);
}

/** S5r: the graph knobs <channel>/bk/1..64 (8 to 64 rows, see bkKnobZahl) of a channel that takes a graph (POST /regler). Channels with an instrument host
 *  block (KNOB_GRUPPE) get none here, they use their own knobs; channels without a graph neither. Value from the control state, default 0.5. */
export const BK_KNOB_KANAELE = ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'erz/1', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2', 'fx/3', 'fx/4'];
/** S12: erz/2 and erz/3 show the graph knobs only while a graph sits on them (opt.graph = {name, regler_namen}); otherwise
 *  they keep the Surge/host knobs. S14: fx/3, fx/4 (send returns) have the knobs fx/<n>/bk/1..64 too. Knob names come from the graph's
 *  regler_namen, else "Knob n". */
export const BK_KNOB_MIT_GRAPH = ['erz/2', 'erz/3'];
export const BK_KNOB_MIN = 8, BK_KNOB_MAX = 64;
/** How many knob rows the legacy slider field shows: as many as the graph defines (the highest number in its regler_namen or regler
 *  ranges), at least the first eight, at most 64. No graph info: 8, as before the knob limit moved. */
export function bkKnobZahl(graph) {
  let n = BK_KNOB_MIN;
  for (const t of [graph?.regler_namen, graph?.regler]) {
    if (typeof t !== 'object' || t === null) continue;
    for (const k of Object.keys(t)) { const nr = Number(k); if (Number.isInteger(nr) && nr > n && nr <= BK_KNOB_MAX) n = nr; }
  }
  return n;
}
export function bkKnobListe(kanal, reglerStand, opt) {
  const graph = opt?.graph ?? null;
  if (!(BK_KNOB_KANAELE.includes(kanal) || (graph && BK_KNOB_MIT_GRAPH.includes(kanal)))) return [];
  return Array.from({ length: bkKnobZahl(graph) }, (_, i) => {
    const pfad = `${kanal}/bk/${i + 1}`, w = reglerStand?.[pfad], n = graph?.regler_namen?.[i + 1];
    return { nr: i + 1, pfad, name: typeof n === 'string' && n !== '' ? n : `Knob ${i + 1}`, wert: typeof w === 'number' && Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : 0.5 };
  });
}
/** S12: one knob as a <label> string; the name comes from a graph file, so it goes through htmlText in text and aria-label. */
export function bkKnobHtml(knob, kanal) {
  const n = htmlText(knob.name);
  return `<label>${n}<input type="range" min="0" max="1" step="0.001" value="${knob.wert}" data-bk="${htmlText(knob.pfad)}" aria-label="${htmlText(kanal)} ${n}"><output>${knob.wert.toFixed(2)}</output></label>`;
}
/** S19 (MIDI learn): the assignment of a knob path out of GET /lernen "zuordnungen" ({pfad, kanal, nr}), or null. */
export function lernStand(zuordnungen, pfad) {
  return (Array.isArray(zuordnungen) ? zuordnungen : []).find((z) => z?.pfad === pfad) ?? null;
}
/** S19: the learn control of one graph knob, as a string next to the knob's <label>. lage = {midi: a MIDI input is assigned, wartet: path that waits}.
 *  Free knob: button "M". Waiting knob: blinking "move a knob…". Learned knob: badge "CC74 ch1" and a remove button. Every dynamic part goes
 *  through htmlText (the path is data, not trusted). */
export function lernKnopfHtml(pfad, zuordnung, lage) {
  const p = htmlText(pfad), wartet = lage?.wartet === pfad, midi = lage?.midi === true;
  let h;
  if (wartet) h = `<button type="button" class="lern wartet" data-lern="${p}" aria-pressed="true" title="Waiting for your controller: move a knob, or click again to cancel">move a knob…</button>`;
  else if (!midi) h = `<button type="button" class="lern" data-lern="${p}" disabled title="Assign a MIDI input under Devices first">M</button>`;
  else h = `<button type="button" class="lern" data-lern="${p}" aria-pressed="false" title="Learn: click, then move a knob on your MIDI controller">M</button>`;
  if (zuordnung) {
    const cc = htmlText(`CC${zuordnung.nr} ch${zuordnung.kanal}`);
    h += `<span class="lern-badge" title="${p} is driven by ${cc}">${cc}</span>`
      + `<button type="button" class="lern-weg" data-lern-weg="${p}" title="Remove the assignment of ${p} (${cc})" aria-label="Remove the MIDI assignment of ${p}">×</button>`;
  }
  return `<span class="lern-zeile">${h}</span>`;
}
/** S14: markup of the SEND RETURNS block (the effect graph pickers and the graph knobs of fx/3, fx/4); app.js only inserts it.
 *  Each row carries data-kanal for the knob binding, a picker place for graphWahlHtml and an empty .bkliste that bindeBkKnobs fills. */
export function sendRueckHtml(kanaele = ['fx/3', 'fx/4']) {
  return '<span class="bildtitel">SEND RETURNS <b>graph picker and knobs per return</b></span>'
    + kanaele.map((k) => `<div class="sendzeile" data-kanal="${htmlText(k)}"><span>${k === 'fx/3' ? 'RETURN 3' : 'RETURN 4'}</span>`
      + `<div class="graphplatz" data-graphplatz="${htmlText(k)}"></div><div class="bkliste"></div></div>`).join('');
}
/** S12/S18: graph picker. Instruments go on erz/2, erz/3, erz/5..7 and the pads (stream 1 is a drum kit, erz/4 the production, erz/8 unused),
 *  effects on decks and the send returns. The instrument keys are bound to contract/streams.ts by tests/effekte.test.mjs. */
export const GRAPH_KANAL_ART = { 'erz/2': 'instrument', 'erz/3': 'instrument', 'erz/5': 'instrument', 'erz/6': 'instrument', 'erz/7': 'instrument', 'pad/1': 'instrument', 'pad/2': 'instrument', 'deck/1': 'effekt', 'deck/2': 'effekt', 'deck/3': 'effekt', 'deck/4': 'effekt', 'fx/3': 'effekt', 'fx/4': 'effekt', 'master': 'effekt' };
/** Instrument categories of the picker (ids as in kategorien.json). `host` is the Surge/plugin entry of erz/2 and erz/3, `sonst` collects graphs without a category. */
export const GRAPH_KATEGORIEN = [
  { id: 'drums', name: 'Drums' }, { id: 'bass', name: 'Bass' }, { id: 'lead', name: 'Lead' }, { id: 'pad', name: 'Pad & Poly' },
  { id: 'keys', name: 'Keys & Plucks' }, { id: 'textur', name: 'Texture & FX' }, { id: 'host', name: 'Host (Surge/plugins)' }, { id: 'sonst', name: 'Other' },
];
const kategorieName = (id) => GRAPH_KATEGORIEN.find((k) => k.id === id)?.name ?? 'Other';
/** Channels on which a host (Surge XT or a plugin) plays while no graph is loaded; the empty picker value means "the host plays" there. */
export const GRAPH_HOST_KANAELE = ['erz/2', 'erz/3'];
/** Display name of the host of a GET /klang group ({art, plugin?}): the plugin name, else the part after vst3:/sfz:, else Surge XT (art lv2 or unknown); the grand piano (sfz:grand) is 'Grand piano'. */
export function hostName(wirt) {
  if (wirt?.art === 'sfz:grand') return 'Grand piano';
  if (typeof wirt?.plugin === 'string' && wirt.plugin.trim()) return wirt.plugin.trim().slice(0, 40);
  const m = typeof wirt?.art === 'string' ? /^(?:vst3|sfz):(.+)$/.exec(wirt.art) : null;
  return m ? m[1].slice(0, 40) : 'Surge XT';
}
export function graphWahlOptionen(kanal, graphen, geladenName, host) {
  const art = GRAPH_KANAL_ART[kanal];
  if (!art) return [];
  const gewaehlt = geladenName ?? '';
  const eintraege = (graphen ?? []).filter((g) => g.art === art);
  const namen = eintraege.map((g) => g.name);
  const inst = art === 'instrument';
  const leer = GRAPH_HOST_KANAELE.includes(kanal) ? { wert: '', text: host || 'Surge XT', gewaehlt: gewaehlt === '', kategorie: 'host' } : { wert: '', text: inst ? 'Off' : '—', gewaehlt: gewaehlt === '' };
  const aus = [leer, ...eintraege.map((g) => ({ wert: g.name, text: g.name, gewaehlt: g.name === gewaehlt, ...(inst ? { kategorie: g.kategorie || 'sonst', ...(g.text ? { beschreibung: g.text } : {}) } : {}) }))];
  if (gewaehlt !== '' && !namen.includes(gewaehlt)) aus.push({ wert: gewaehlt, text: gewaehlt, gewaehlt: true, ...(inst ? { kategorie: 'sonst' } : {}) });   // loaded but not in the list: do not lie
  return aus;
}
const optionHtml = (x) => `<option value="${htmlText(x.wert)}"${x.gewaehlt ? ' selected' : ''}>${htmlText(x.text)}</option>`;
/** The single picker (effects, strips, send returns, detail): effects flat, instruments grouped by category with <optgroup>; the empty entry stays first and ungrouped. */
export function graphWahlHtml(kanal, graphen, geladenName, host) {
  const o = graphWahlOptionen(kanal, graphen, geladenName, host);
  if (!o.length) return '';
  let inhalt;
  if (GRAPH_KANAL_ART[kanal] === 'instrument') {
    inhalt = optionHtml(o[0]);
    for (const k of GRAPH_KATEGORIEN) {
      const rest = o.slice(1).filter((x) => x.kategorie === k.id);
      if (rest.length) inhalt += `<optgroup label="${htmlText(k.name)}">${rest.map(optionHtml).join('')}</optgroup>`;
    }
  } else inhalt = o.map(optionHtml).join('');
  return `<select class="graphwahl" data-graphwahl="${htmlText(kanal)}" aria-label="Graph on ${htmlText(kanal)}" title="Baukasten graph on this channel">${inhalt}</select>`;
}
/** The categories offered on a channel (those with a graph, plus host on erz/2 and erz/3) and the one shown: `kat` when valid, else the loaded graph's, else host
 *  (erz/2, erz/3 with the host playing), else the first. */
export function instrumentKategorien(kanal, graphen, geladenName, kat) {
  const o = graphWahlOptionen(kanal, graphen, geladenName);
  const ids = GRAPH_KATEGORIEN.map((k) => k.id).filter((id) => o.some((x) => x.kategorie === id));
  const geladen = o.find((x) => x.gewaehlt && x.wert !== '');
  const gew = ids.includes(kat) ? kat : geladen ? geladen.kategorie : ids.includes('host') && (geladenName ?? '') === '' ? 'host' : ids[0];
  return { ids, gewaehlt: gew };
}
/** INSTRUMENTS area picker: CATEGORY select, INSTRUMENT select (filtered to the category) and one description line. `kat` is the category the person browsed to
 *  (null = follow the loaded graph). A category that does not hold the loaded graph shows a disabled "Choose..." entry. */
export function instrumentWahlHtml(kanal, graphen, geladenName, host, kat) {
  const o = graphWahlOptionen(kanal, graphen, geladenName, host);
  if (!o.length) return '';
  const { ids, gewaehlt: gk } = instrumentKategorien(kanal, graphen, geladenName, kat);
  const hostKanal = GRAPH_HOST_KANAELE.includes(kanal);
  const inKat = o.filter((x) => (x.wert === '' ? (hostKanal ? gk === 'host' : true) : x.kategorie === gk));
  const aktiv = inKat.find((x) => x.gewaehlt);
  const katSel = `<select class="graphkat" data-graphkat="${htmlText(kanal)}" aria-label="Instrument category on ${htmlText(kanal)}" title="Category">`
    + ids.map((id) => `<option value="${htmlText(id)}"${id === gk ? ' selected' : ''}>${htmlText(kategorieName(id))}</option>`).join('') + '</select>';
  const instSel = `<select class="graphwahl" data-graphwahl="${htmlText(kanal)}" aria-label="Instrument on ${htmlText(kanal)}" title="Instrument">`
    + (aktiv ? '' : '<option value="" disabled selected hidden>Choose…</option>')
    + inKat.map(optionHtml).join('') + '</select>';
  let text = '';
  if (aktiv?.wert === '') text = hostKanal ? `${aktiv.text} plays this channel; no Baukasten graph is loaded.` : 'No instrument loaded on this channel.';
  else if (aktiv) text = aktiv.beschreibung ?? '';
  return `${katSel}${instSel}<span class="graphtext" data-graphtext="${htmlText(kanal)}">${htmlText(text)}</span>`;
}

/** S17: saved/differs marker of the sound snapshot for one channel. gespeichert = GET /proj/bk gespeichert ([{id, graph, regler}] or null without a
 *  project), geladenName = what is loaded now, regler = live values by path. '' = nothing saved for this channel. A live knob value the page does not
 *  know is no difference here (the hand tool proj_bk lage reports it as null). Pure, no polling. */
/** `bereiche`: the knob ranges of the loaded graph ({nr: {vorgabe}}, from GET /graphen/panel), for a knob the stored array does not carry (a stored array is
 *  trimmed against the graph's `vorgabe`); without them 0.5. */
export function bkMarke(kanal, gespeichert, geladenName, regler, bereiche) {
  const e = Array.isArray(gespeichert) ? gespeichert.find((x) => x.id === kanal.replace('/', '')) : undefined;
  if (!e) return '';
  if (!geladenName || geladenName !== e.graph) return 'abweichend';
  for (let i = 0; i < 64; i++) {   // a stored array of 8..64 numbers: the missing ones are the graph's vorgabe (0.5 where it has none)
    const w = regler?.[`${kanal}/bk/${i + 1}`];
    if (typeof w === 'number' && Math.abs(w - (e.regler[i] ?? bereiche?.[i + 1]?.vorgabe ?? 0.5)) > 0.0005) return 'abweichend';
  }
  return 'gespeichert';
}
/** S17: SAVE SOUND button and marker beside the graph picker. Only with an open project and a graph loaded on the channel. */
export function bkSpeichernHtml(kanal, marke, projektOffen, geladenName) {
  if (!projektOffen || !geladenName) return '';
  const k = htmlText(kanal);
  const text = marke === 'gespeichert' ? 'saved' : marke === 'abweichend' ? 'differs from project' : '';
  return `<button class="bkmerken" data-bkmerken="${k}" title="Save the graph on this channel and its knob values in the project">SAVE SOUND</button>`
    + (text ? `<span class="bkmarke ${marke}">${text}</span>` : '');
}

export function knobListe(params, namen = {}) {
  const aus = [];
  for (let nr = 1; nr <= 64; nr++) {
    const p = `Knob ${nr}`, w = params?.[p];
    if (typeof w === 'number' && Number.isFinite(w)) aus.push({ nr, param: p, name: namen?.[p] ?? p, wert: Math.min(1, Math.max(0, w)) });
  }
  return aus;
}

// Vorlagen für Automationsspuren je Ziel (Andreas 2026-10-11: „komp schwelle, komp ratio, komp mix usw“). Punkte relativ zur
// Spurlänge (0 ≤ t < 1) mit Werten in der Einheit des Reglers; vorlagePunkte streckt sie auf die eingestellte Länge.
export const AUTO_VORLAGEN = {
  'komp/schwelle': [
    { name: 'Build: tighter', punkte: [[0, -10], [0.97, -36]] },
    { name: 'Pump last quarter', punkte: [[0, -12], [0.75, -12], [0.8, -34], [0.97, -34]] },
  ],
  'komp/ratio': [
    { name: 'Build: 2 → 10', punkte: [[0, 2], [0.97, 10]] },
    { name: 'Squash on the last bar', punkte: [[0, 3], [0.75, 3], [0.8, 16], [0.97, 16]] },
  ],
  'komp/mix': [
    { name: 'Parallel in', punkte: [[0, 0], [0.97, 0.6]] },
    { name: 'Breathe (half/full)', punkte: [[0, 1], [0.5, 0.4], [0.97, 1]] },
  ],
  'komp/attack': [{ name: 'Punch opens (1 → 30 ms)', punkte: [[0, 1], [0.97, 30]] }],
  'komp/release': [{ name: 'Pump grows (300 → 60 ms)', punkte: [[0, 300], [0.97, 60]] }],
  'komp/makeup': [{ name: 'Lift (+0 → +6 dB)', punkte: [[0, 0], [0.97, 6]] }],
  filter: [
    { name: 'High-pass build', punkte: [[0, 0], [0.95, 0.7]] },
    { name: 'Low-pass dip', punkte: [[0, 0], [0.5, -0.75], [0.875, 0]] },
    { name: 'Low-pass fade out', punkte: [[0, 0], [0.97, -0.9]] },
  ],
  'send/2': [
    { name: 'Throw on the last beat', punkte: [[0, -60], [0.86, -60], [0.875, -6], [0.97, -60]] },
    { name: 'Wash in', punkte: [[0, -60], [0.97, -8]] },
  ],
  'eq/tief': [
    { name: 'Bass kill last bar', punkte: [[0, 0], [0.74, 0], [0.75, -26], [0.98, -26]] },
    { name: 'Bass in', punkte: [[0, -26], [0.97, 0]] },
  ],
  'eq/mitte': [{ name: 'Mid dip', punkte: [[0, 0], [0.5, -12], [0.97, 0]] }],
  'eq/hoch': [
    { name: 'Highs open', punkte: [[0, -18], [0.97, 0]] },
    { name: 'Highs close', punkte: [[0, 0], [0.97, -18]] },
  ],
};
// Vorlage auf eine Spurlänge in Beats: Beats auf 1/4 gerastet, unter der Länge, aufsteigend ohne Doppel
export function vorlagePunkte(vorlage, laenge) {
  const aus = [];
  for (const [t, w] of vorlage.punkte) {
    const beat = Math.min(laenge - 0.25, Math.round(t * laenge * 4) / 4);
    if (!aus.length || beat > aus[aus.length - 1][0]) aus.push([beat, w]);
  }
  return aus;
}

// ---- A8: Gate and Utility strips (kern controller rows <kanal>/gate/*, <kanal>/util/*, INTERFACES 1.5) ----------------------------
// Ranges, defaults, curve and integer flag are those of the header djk/core/signalbox/include/cypherdj/signalbox/tool_controls.h; tests/effects.test.mjs
// parses the header and holds both equal. The strips are built for the FX_KANAELE of app.js (10 channels); the other live channels
// (deck/3, deck/4, erz/4) are reachable by hand and by preset only.
export const WERK_FELDER = {
  'gate/an': { min: 0, max: 1, vorgabe: 0, kurve: 'schalter', ganz: true },
  'gate/schwelle': { min: -90, max: 0, vorgabe: -40, schritt: 0.5, einheit: 'dB', kurve: 'linear', ganz: false },
  'gate/hysterese': { min: 0, max: 24, vorgabe: 4, schritt: 0.5, einheit: 'dB', kurve: 'linear', ganz: false },
  'gate/ratio': { min: 1, max: 100, vorgabe: 100, schritt: 1, einheit: ':1', kurve: 'linear', ganz: false },
  'gate/bereich': { min: -120, max: 0, vorgabe: -80, schritt: 1, einheit: 'dB', kurve: 'linear', ganz: false },
  'gate/attack': { min: 0.1, max: 500, vorgabe: 1, schritt: 0.1, einheit: 'ms', kurve: 'linear', ganz: false },
  'gate/hold': { min: 0, max: 2000, vorgabe: 20, schritt: 1, einheit: 'ms', kurve: 'linear', ganz: false },
  'gate/release': { min: 1, max: 5000, vorgabe: 100, schritt: 1, einheit: 'ms', kurve: 'linear', ganz: false },
  'gate/sc': { min: 0, max: 14, vorgabe: 0, schritt: 1, einheit: '', kurve: 'stufen', ganz: true },
  'util/balance': { min: -1, max: 1, vorgabe: 0, schritt: 0.01, einheit: 'bal', kurve: 'linear', ganz: false },
  'util/breite': { min: 0, max: 200, vorgabe: 100, schritt: 1, einheit: '%', kurve: 'linear', ganz: false },
  'util/bassmono': { min: 0, max: 500, vorgabe: 0, schritt: 1, einheit: 'Hz', kurve: 'linear', ganz: false },
  'util/phase_l': { min: 0, max: 1, vorgabe: 0, kurve: 'schalter', ganz: true },
  'util/phase_r': { min: 0, max: 1, vorgabe: 0, kurve: 'schalter', ganz: true },
  'util/tausch': { min: 0, max: 1, vorgabe: 0, kurve: 'schalter', ganz: true },
  'util/dc': { min: 0, max: 1, vorgabe: 0, kurve: 'schalter', ganz: true },
};
/** One strip per tool: `an` = the on switch (or null), `regler` = sliders, `schalter` = further switches. The strip shows the main controls;
 *  the rest of the rows (hysteresis, ratio, attack, hold, sidechain) are reachable by hand and by preset. */
export const WERK_STREIFEN = [
  { css: 'gate', titel: 'GATE', an: 'gate/an', schalter: [],
    regler: [{ feld: 'gate/schwelle', name: 'THR' }, { feld: 'gate/bereich', name: 'RANGE' }, { feld: 'gate/release', name: 'REL' }] },
  { css: 'util', titel: 'UTIL', an: null,
    regler: [{ feld: 'util/balance', name: 'BAL' }, { feld: 'util/breite', name: 'WIDTH' }, { feld: 'util/bassmono', name: 'BASS' }],
    schalter: [{ feld: 'util/phase_l', name: 'Ø L' }, { feld: 'util/phase_r', name: 'Ø R' }, { feld: 'util/tausch', name: 'SWAP' }, { feld: 'util/dc', name: 'DC' }] },
];
/** The text next to a slider: what the knob means in its unit. Bass mono 0 is "off", 1..19 act as 20 Hz (library clamp). */
export function werkText(feld, w) {
  const f = werkFeld(feld);
  if (feld === 'util/bassmono') return w <= 0 ? 'off' : `${Math.max(20, Math.round(w))} Hz`;
  if (feld === 'util/balance') return w === 0 ? 'C' : `${w < 0 ? 'L' : 'R'}${Math.round(Math.abs(w) * 100)}`;
  if (feld === 'gate/ratio') return w >= 100 ? 'hard' : `${w.toFixed(0)}:1`;
  if (feld.startsWith('mb/') || feld.startsWith('lim/')) {   // A8b: bus multiband and limiter
    if (feld.endsWith('/ratio')) return `${w.toFixed(1)}:1`;
    if (feld.endsWith('/makeup')) return `${w > 0 ? '+' : ''}${w.toFixed(1)} dB`;
    if (f.einheit === 'Hz') return `${Math.round(w)} Hz`;
    if (f.einheit === 'dB') return `${w.toFixed(Number.isInteger(w) ? 0 : 1)} dB`;
  }
  if (f.einheit === 'ms') return `${w < 10 ? w.toFixed(1) : Math.round(w)} ms`;
  if (f.einheit === 'dB') return `${w.toFixed(0)} dB`;
  return `${Math.round(w)}${f.einheit}`;
}
/** Markup of the Gate and the Utility strip of one channel (inside the channel's .fxstreifen). Nothing is sent while building;
 *  the values are filled from the live control state by app.js (zeigeWerkzeug). */
export function werkzeugStreifenHtml(k, name, nur = null) {   // `nur`: the css keys to build (the bus panel builds only 'util': no gate on buses, D2)
  const kk = htmlText(k), nn = htmlText(name);
  return WERK_STREIFEN.filter((s) => !nur || nur.includes(s.css)).map((s) => {
    const pfad = (feld) => htmlText(`${k}/${feld}`);
    const an = s.an ? `<button class="werk-an" data-werk-pfad="${pfad(s.an)}" title="${s.titel} on/off (${kk})" aria-pressed="false">${s.titel}</button>` : `<span class="werk-titel">${s.titel}</span>`;
    const regler = s.regler.map((r) => {
      const f = WERK_FELDER[r.feld];
      return `<label>${r.name}<input type="range" data-werk-pfad="${pfad(r.feld)}" min="${f.min}" max="${f.max}" step="${f.schritt}" value="${f.vorgabe}" aria-label="${nn} ${s.titel.toLowerCase()} ${r.name}"><output>${werkText(r.feld, f.vorgabe)}</output></label>`;
    }).join('');
    const schalter = s.schalter.length
      ? `<div class="werk-schalter">${s.schalter.map((x) => `<button data-werk-pfad="${pfad(x.feld)}" aria-pressed="false" title="${x.name} (${kk})">${x.name}</button>`).join('')}</div>` : '';
    const messer = s.css === 'gate' ? busMesser(kk, 'gate_db', 'GR', 'Gate gain reduction (/zustand/mix gate_db)') : '';   // A6: the source channel's meter
    return `<div class="fxwerk fxwerk-${s.css}">${an}${regler}${schalter}${messer}</div>`;
  }).join('');
}
/** A click on a switch: the other state of the live value (a value not yet known counts as the default, off). */
export function werkzeugKlickNach(stand, pfad) {
  const w = stand?.[pfad];
  return typeof w === 'number' && w >= 0.5 ? 0 : 1;
}
/** The body of POST /regler for one tool control; "jetzt" like the compressor strip (hand and automation take effect at once). */
export const werkzeugAnfrage = (pfad, nach) => ({ pfad, nach, ab: 'jetzt' });
/** Send one tool control. `senden` is fetch (a stub in tests). Returns {ok: true} or {ok: false, text} for the page's message line. */
export async function setzeWerkzeug(senden, pfad, nach) {
  try {
    const r = await senden('/regler', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(werkzeugAnfrage(pfad, nach)) });
    const j = await r.json().catch(() => null);   // review 1.15: a non-JSON refusal body is still a refusal with its status
    globalThis.window?.djkGesendet?.push({ [pfad]: nach, code: r.status, antwort: j });
    if (r.status !== 200) return { ok: false, text: `Tool control refused: ${j?.fehler ?? r.status}` };
    if (j?.quittung?.status === 6) return { ok: false, text: `Tool control refused: ${j.quittung.grund}` };
    return { ok: true };
  } catch (e) { return { ok: false, text: `Page server unreachable: ${e.message}` }; }
}

// ---- A8b: bus panel (rows bus/<n>/mb/*, bus/<n>/lim/*, bus/<n>/util/*) and its meters --------------------------------------------------
// Ranges and defaults are those of the header (tool_controls.h, rows for buses only); tests/effects.test.mjs holds both equal in both
// directions. The Utility block of a bus is the Utility strip of A8 (WERK_FELDER / werkzeugStreifenHtml), not a second mechanism.
export const BUS_KANAELE = ['bus/1', 'bus/2', 'bus/3', 'bus/4'];
const BUS_BAENDER = [['tief', 'LOW'], ['mitte', 'MID'], ['hoch', 'HIGH']];
const BAND_FELDER = {
  schwelle: { min: -60, max: 0, vorgabe: 0, schritt: 0.5, einheit: 'dB', kurve: 'linear', ganz: false },
  ratio: { min: 1, max: 20, vorgabe: 1, schritt: 0.1, einheit: ':1', kurve: 'linear', ganz: false },
  attack: { min: 0.1, max: 500, vorgabe: 10, schritt: 0.1, einheit: 'ms', kurve: 'linear', ganz: false },
  release: { min: 1, max: 5000, vorgabe: 100, schritt: 1, einheit: 'ms', kurve: 'linear', ganz: false },
  knie: { min: 0, max: 24, vorgabe: 0, schritt: 0.5, einheit: 'dB', kurve: 'linear', ganz: false },
  makeup: { min: -24, max: 24, vorgabe: 0, schritt: 0.5, einheit: 'dB', kurve: 'linear', ganz: false },
  umgehen: { min: 0, max: 1, vorgabe: 0, kurve: 'schalter', ganz: true },
};
export const BUS_FELDER = {
  'mb/an': { min: 0, max: 1, vorgabe: 0, kurve: 'schalter', ganz: true },
  'mb/grenze_tief': { min: 20, max: 20000, vorgabe: 200, schritt: 1, einheit: 'Hz', kurve: 'linear', ganz: false },
  'mb/grenze_hoch': { min: 20, max: 20000, vorgabe: 2000, schritt: 1, einheit: 'Hz', kurve: 'linear', ganz: false },
  ...Object.fromEntries(BUS_BAENDER.flatMap(([b]) => Object.entries(BAND_FELDER).map(([f, d]) => [`mb/${b}/${f}`, d]))),
  'lim/an': { min: 0, max: 1, vorgabe: 0, kurve: 'schalter', ganz: true },
  'lim/decke': { min: -60, max: 0, vorgabe: -0.3, schritt: 0.1, einheit: 'dB', kurve: 'linear', ganz: false },
  'lim/abklingen': { min: 1, max: 2000, vorgabe: 80, schritt: 1, einheit: 'ms', kurve: 'linear', ganz: false },
};
/** The field description of a controller suffix: the A8 fields (gate, util) or the bus fields (mb, lim). */
export const werkFeld = (feld) => WERK_FELDER[feld] ?? BUS_FELDER[feld];

export const LIMITER_GRUND = 'limiter not built (kanal_limiter_vorhalt_ms = 0)';
/** What /lage says about the channel limiter: only `kanal_limiter.gebaut === true` enables the limiter controls. Absent (the kern has
 *  not reported yet, A5c: /e/kanal_limiter on the first hallo) or false: disabled, with the reason. `latenz_samples` is shown when it is a sane number. */
export function limiterZustand(lage) {
  const kl = lage?.kanal_limiter;
  if (kl && typeof kl === 'object' && kl.gebaut === true) {
    const n = kl.latenz_samples;
    return { gebaut: true, latenzSamples: typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null, grund: '' };
  }
  return { gebaut: false, latenzSamples: null, grund: LIMITER_GRUND };
}

function busRegler(k, nn, feld, kurz, titel, aus = false) {
  const f = werkFeld(feld);
  return `<label>${kurz}<input type="range" data-werk-pfad="${htmlText(`${k}/${feld}`)}" min="${f.min}" max="${f.max}" step="${f.schritt}" value="${f.vorgabe}"${aus ? ' disabled' : ''} aria-label="${nn} ${titel}"><output>${werkText(feld, f.vorgabe)}</output></label>`;
}
function busSchalter(k, kk, feld, kurz, titel, klasse = '', aus = false) {
  return `<button${klasse ? ` class="${klasse}"` : ''} data-werk-pfad="${htmlText(`${k}/${feld}`)}" aria-pressed="false" title="${titel} (${kk})"${aus ? ' disabled' : ''}>${kurz}</button>`;
}
function busMesser(kk, feld, kurz, titel) {
  return `<div class="busgr" title="${titel}"><span>${kurz}</span><div class="gr"><i data-messer="${kk}|${feld}"></i></div><span class="grzahl" data-messer-zahl="${kk}|${feld}">–</span></div>`;
}
/** Markup of one bus strip: MULTIBAND (switch, crossovers, three gain-reduction meters, collapsed per-band block), LIMITER (switch, ceiling,
 *  release, gain-reduction meter; built disabled with the reason until /lage says the limiter is built) and the Utility block of A8.
 *  Nothing is sent while building; the values are filled from the live control state by app.js (zeigeWerkzeug). */
export function busStreifenHtml(k, name) {
  const kk = htmlText(k), nn = htmlText(name);
  const baender = BUS_BAENDER.map(([b, kurz]) => `<div class="mb-band"><span class="werk-titel">${kurz}</span>`
    + ['schwelle', 'ratio', 'attack', 'release', 'knie', 'makeup'].map((f) => busRegler(k, nn, `mb/${b}/${f}`, f === 'schwelle' ? 'THR' : f === 'ratio' ? 'RATIO' : f === 'attack' ? 'ATT'
      : f === 'release' ? 'REL' : f === 'knie' ? 'KNEE' : 'TRIM', f === 'makeup' ? `multiband ${kurz.toLowerCase()} make-up trim (on top of the automatic make-up)` : `multiband ${kurz.toLowerCase()} ${f}`)).join('')
    + busSchalter(k, kk, `mb/${b}/umgehen`, 'BYPASS', `${kurz} band bypass`) + '</div>').join('');
  return `<div class="busstreifen" data-kanal="${kk}"><div class="fxname"><span>${nn}</span></div>`
    + `<div class="fxwerk fxwerk-mb">${busSchalter(k, kk, 'mb/an', 'MULTIBAND', 'Multiband on/off', 'werk-an')}`
    + busRegler(k, nn, 'mb/grenze_tief', 'X LOW', 'multiband crossover low/mid') + busRegler(k, nn, 'mb/grenze_hoch', 'X HIGH', 'multiband crossover mid/high')
    + busMesser(kk, 'mb_tief_db', 'LOW', 'Gain reduction, low band') + busMesser(kk, 'mb_mitte_db', 'MID', 'Gain reduction, mid band') + busMesser(kk, 'mb_hoch_db', 'HIGH', 'Gain reduction, high band')
    + `<button class="bus-baender-knopf" data-baender-knopf="${kk}" aria-expanded="false" title="Show or hide the per-band controls">BANDS ▸</button>`
    + `<div class="mb-baender" data-baender="${kk}" hidden>${baender}</div></div>`
    + `<div class="fxwerk fxwerk-lim">${busSchalter(k, kk, 'lim/an', 'LIMITER', 'Channel limiter on/off', 'werk-an', true)}`
    + busRegler(k, nn, 'lim/decke', 'CEIL', 'limiter ceiling', true) + busRegler(k, nn, 'lim/abklingen', 'REL', 'limiter release', true)
    + busMesser(kk, 'lim_db', 'LIM', 'Gain reduction, limiter')
    + `<span class="lim-grund" data-lim-grund>${LIMITER_GRUND}</span></div>`
    + werkzeugStreifenHtml(k, name, ['util']) + '</div>';
}
/** The whole BUS panel: a header that folds it, and four strips. */
export function busPanelHtml() {
  return '<div class="buskopf"><button class="bus-panel-knopf" aria-expanded="true" title="Show or hide the bus tools">BUS ▾</button>'
    + '<span class="klein">multiband · limiter · utility per bus</span></div>'
    + `<div class="busreihe">${BUS_KANAELE.map((k, i) => busStreifenHtml(k, `BUS ${i + 1}`)).join('')}</div>`;
}

// Meters: /zustand/mix ,sfffff (kanal, gate_db, mb_tief_db, mb_mitte_db, mb_hoch_db, lim_db; reductions >= 0, 10 Hz, only for channels where a
// tool runs, D10). A reading counts for 500 ms; when the events stop the meter goes back to "no reading". The clock is injected (tests).
export const MIX_FRIST_MS = 500;
export const MIX_FELDER = ['mb_tief_db', 'mb_mitte_db', 'mb_hoch_db', 'lim_db'];
/** Take one event into `stand` ({bus: {feld: {db, t}}}). A non-finite value is ignored (the old reading stays), a negative one is clamped
 *  to 0, a channel that is not a bus is ignored (gate_db belongs to the source channels, not to this panel). Returns whether the bus was taken. */
export function mixAufnehmen(stand, f, jetzt) {
  const k = f?.kanal;
  if (typeof k !== 'string' || !BUS_KANAELE.includes(k)) return false;
  for (const feld of MIX_FELDER) {
    const w = f[feld];
    if (typeof w === 'number' && Number.isFinite(w)) (stand[k] ??= {})[feld] = { db: Math.max(0, w), t: jetzt };
  }
  return true;
}
/** The reading of one meter now, or null (never reported, or older than 500 ms). */
export function mixLesung(stand, kanal, feld, jetzt) {
  const g = stand?.[kanal]?.[feld];
  return g && jetzt - g.t < MIX_FRIST_MS ? g.db : null;
}
/** Milliseconds until the next reading expires, or null when none is fresh (the page schedules its reset with it). */
export function mixAblaufIn(stand, jetzt, kanaele = BUS_KANAELE, felder = MIX_FELDER) {
  let m = null;
  for (const k of kanaele) for (const feld of felder) {
    const g = stand?.[k]?.[feld];
    if (g && jetzt - g.t < MIX_FRIST_MS) m = m === null ? g.t + MIX_FRIST_MS - jetzt : Math.min(m, g.t + MIX_FRIST_MS - jetzt);
  }
  return m;
}

// A6: the gate meters of the source channels (gate_db of /zustand/mix; the 13 live channels, erz/8 has no gate, D2). Same 500 ms rule as the bus
// meters; a gate can close by 80 dB and more, so the bar is scaled to 60 dB (the number shows the real value).
export const GATE_KANAELE = ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'erz/1', 'erz/2', 'erz/3', 'erz/4', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2'];
export const GATE_FELDER = ['gate_db'];
export const GATE_SKALA_DB = 60;
/** Take the gate reading of one event into `stand` (same shape as mixAufnehmen). A non-finite value is ignored, a negative one clamped to 0, a
 *  channel without a gate (a bus, erz/8, anything else) is ignored. Returns whether the channel was taken. */
export function gateAufnehmen(stand, f, jetzt) {
  const k = f?.kanal;
  if (typeof k !== 'string' || !GATE_KANAELE.includes(k)) return false;
  const w = f.gate_db;
  if (typeof w === 'number' && Number.isFinite(w)) (stand[k] ??= {}).gate_db = { db: Math.max(0, w), t: jetzt };
  return true;
}
