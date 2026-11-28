// Strand 6 slice 2 task 2.2: the live value of the modulators on the page. The core reports every modulator's output (-1..1, before depth) as the event
// `/zustand/mod ,if` (nr, value) at 25 Hz; the page computes base + offset itself with the shared formula. Pure helpers first (tested without a DOM).
export const MOD_FRIST_MS = 500;   // no event for this long: the modulator counts as silent and its marker is hidden

/** = project/mod_formula.ts: the offset of one target from the modulator output (-1..1): bipolar tiefe*out, unipolar tiefe*(out+1)/2 */
export const modVersatz = (out, tiefe, uni) => (uni ? tiefe * ((out + 1) / 2) : tiefe * out);
/** = project/mod_formula.ts: the modulated value, base + offset clamped to the target range [lo, hi] */
export const modWert = (basis, versatz, bereich) => Math.min(bereich[1], Math.max(bereich[0], basis + versatz));

/** latest output per modulator number: nr -> { out, t } (t = receive time in ms) */
export const MOD_STAND = new Map();
/** feed one SSE event; only `/zustand/mod` with (nr, out) counts */
export function modAufnehmen(adresse, f, jetzt) {
  if (adresse !== '/zustand/mod' && adresse !== 'zustand/mod') return false;
  // the payload shape of the forwarded event is fixed by task 1.5: an argument list [nr, value] or an object {nr, wert}
  const [nr, out] = Array.isArray(f) ? f : Array.isArray(f?.args) ? f.args : [f?.nr, f?.wert ?? f?.out];
  if (!Number.isInteger(nr) || !Number.isFinite(out)) return false;
  MOD_STAND.set(nr, { out: Math.max(-1, Math.min(1, out)), t: jetzt });
  return true;
}
/** the output of modulator `nr`, or null when it never reported or is silent for MOD_FRIST_MS */
export function modAusgang(nr, jetzt, stand = MOD_STAND) {
  const e = stand.get(nr);
  return e && jetzt - e.t <= MOD_FRIST_MS ? e.out : null;
}
/** a new project or core generation: forget every output */
export const modVergessen = (stand = MOD_STAND) => stand.clear();

/** the modulators of the project that have the target (strang_id, ziel) and are on: [{ mod, ziel }] */
export function modsFuer(projekt, strangId, ziel) {
  const r = [];
  for (const mod of projekt?.modulatoren ?? []) {
    if (mod.an === false) continue;
    const z = mod.ziele?.find((x) => x.strang_id === strangId && x.ziel === ziel);
    if (z) r.push({ mod, ziel: z });
  }
  return r;
}
/** a modulator targets (strang_id, ziel): the marker loop runs only then */
export const hatMod = (projekt, strangId, ziel) => modsFuer(projekt, strangId, ziel).length > 0;
/** the summed offset of all fresh modulators on a target (several add up), or null when none has a fresh output */
export function summeVersatz(projekt, strangId, ziel, jetzt, stand = MOD_STAND) {
  let summe = null;
  for (const { mod, ziel: z } of modsFuer(projekt, strangId, ziel)) {
    const out = modAusgang(mod.nr, jetzt, stand);
    if (out === null) continue;
    summe = (summe ?? 0) + modVersatz(out, z.tiefe, mod.art === 'folger' || z.polaritaet === 'uni')   // a follower is always unipolar (reported as 2*out-1);
  }
  return summe;
}
/** the modulated value of a target (base + summed offset, clamped once), or null when nothing is live */
export function lebendWert(projekt, strangId, ziel, basis, bereich, jetzt, stand = MOD_STAND) {
  const v = summeVersatz(projekt, strangId, ziel, jetzt, stand);
  return v === null ? null : modWert(basis, v, bereich);
}

const k01 = (k) => Math.min(1, Math.max(0, k));
export const MARKE_START = 135, MARKE_BOGEN = 270;   // = KNOB_START, KNOB_BOGEN of panel.js
/** the two angles (degrees) of the fp-mod arc of a knob: from the base position to the modulated one (both 0..1, clamped), sorted so that a1 >= a0 */
export function markenWinkel(basisK, modK) {
  const a = MARKE_START + MARKE_BOGEN * k01(basisK), b = MARKE_START + MARKE_BOGEN * k01(modK);
  return a <= b ? [a, b] : [b, a];
}
/** the position 0..1 of the thin marker on a fader or pan range: dB through `pos` (fader curve), pan from -1..1; null stays null */
export const markenPos = (ziel, wert, pos = (x) => x) => (wert === null ? null : k01(ziel === 'pan' ? (wert + 1) / 2 : pos(wert)));
/** the live readout of the modulator row: "base → value" with the target's unit */
export function liveText(basis, wert, einheit = '', stellen = 1) {
  if (wert === null || !Number.isFinite(basis)) return '';
  const f = (x) => `${x.toFixed(stellen)}${einheit ? ` ${einheit}` : ''}`.replace('-', '−');
  return `${f(basis)} → ${f(wert)}`;
}

/**
 * The animation frame loop: `schritt(jetzt)` runs once per frame and returns true while there is still something to draw. The loop starts with an(),
 * stops itself when schritt returns false and runs no frame while the tab is hidden (the first visible frame after that is requested by an()/sichtbar).
 * opt: { rahmen(f) -> id, abbrechen(id), sichtbar() -> bool, jetzt() -> ms }.
 */
export function neueSchleife(schritt, opt = {}) {
  const rahmen = opt.rahmen ?? ((f) => globalThis.requestAnimationFrame(f));
  const abbrechen = opt.abbrechen ?? ((i) => globalThis.cancelAnimationFrame(i));
  const sichtbar = opt.sichtbar ?? (() => globalThis.document?.visibilityState !== 'hidden');
  const jetzt = opt.jetzt ?? (() => globalThis.performance?.now?.() ?? Date.now());
  let id = null;
  const tick = () => {
    id = null;
    if (!sichtbar()) return;   // hidden: no frames; an() starts again when the tab shows
    if (schritt(jetzt())) id = rahmen(tick);
  };
  return {
    an() { if (id === null && sichtbar()) id = rahmen(tick); },
    aus() { if (id !== null) { abbrechen(id); id = null; } },
    laeuft: () => id !== null,
  };
}

/** wire the event feed: call once per window with its ctx (ctx.beimEreignis is the SSE hook list) */
export function modAnzeigeAnschluss(ctx, beiNeu = () => {}) {
  ctx.beimEreignis.push((a, f) => { if (modAufnehmen(a, f, globalThis.performance?.now?.() ?? Date.now())) beiNeu(); });
}
