// Effekt-Sektion (Plan 2026-10-11-effekt-sektion.md): reine Rechenteile, ohne DOM (getestet in tests/effekte.test.mjs).

// Startpunkte wie die Presets des VST3 (djk/instrumente/komp/presets/presets.json). Der Sidechain heißt im Kern komp/sc
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

// Baukasten S2: die acht Knobs eines Cypher-Modular-Wirts aus POST /klang params ({params: {"Knob 1": 0.5, …}, namen:
// {"Knob 1": "Cutoff"}}). Nur die Knobs, die der Wirt meldet (ein Surge-Wirt meldet keine → leere Liste); ohne Namen steht „Knob n“.
export const KNOB_GRUPPE = { 'erz/2': 'bass', 'erz/3': 'melodie' };
/** Text für innerHTML und Attribute: Knob-Namen stammen aus einer Graphdatei, nicht aus der Seite (Review F2). */
export function htmlText(s) {
  return String(s).replace(/[&<>"']/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[z]);
}

export function knobListe(params, namen = {}) {
  const aus = [];
  for (let nr = 1; nr <= 8; nr++) {
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
