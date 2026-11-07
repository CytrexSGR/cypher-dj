// Verdict logic of the real-core acceptance pruef/abnahme_b14.mjs, kept apart from the network code so that it can be tested without a core.
// Per case id one result, the worst line wins: FEHL > FINDING > NICHT_PRUEFBAR > OK (review U5b finding 1: an OK line written before the gate
// must not hide a FINDING, and a later OK line must not downgrade one). Exit code: 0 unless a FEHL exists; FINDING and NICHT_PRUEFBAR do not count
// as FEHL, but the headline names them, so "ALLES OK" is only printed when no case carries a FINDING or is NICHT_PRUEFBAR.
const RANG = { OK: 1, NICHT_PRUEFBAR: 2, FINDING: 3, FEHL: 4 };

export function urteil({ notiere, info }) {
  const ergebnis = {}, nichtPruefbar = [], findings = {};
  const setze = (kz, stufe) => { if ((RANG[ergebnis[kz]] ?? 0) < RANG[stufe]) ergebnis[kz] = stufe; };
  const pr = (kz, ok, text) => { notiere(kz, ok, text); setze(kz, ok ? 'OK' : 'FEHL'); return ok; };
  const gut = (kz) => setze(kz, 'OK');
  const npb = (kz, grund) => { nichtPruefbar.push(`${kz}: ${grund}`); setze(kz, 'NICHT_PRUEFBAR'); info(`NICHT_PRUEFBAR ${kz}: ${grund}`); };
  // kurz: the plain one-sentence statement that goes into the headline of the report
  const finding = (kz, text, kurz = text) => { setze(kz, 'FINDING'); findings[kz] = kurz; info(`FINDING ${kz}: ${text}`); };
  return { ergebnis, nichtPruefbar, findings, pr, gut, npb, finding };
}

// the headline and the exit code; fehl = number of FEHL lines the script counted (z.fehl), which also covers lines that have no case id
export function schluss(ergebnis, fehl, findings = {}) {
  const von = (stufe) => Object.keys(ergebnis).filter((k) => ergebnis[k] === stufe);
  const kaputt = von('FEHL'), funde = von('FINDING'), offen = von('NICHT_PRUEFBAR');
  if (fehl > 0 || kaputt.length) return { text: `FEHL ${Math.max(fehl, kaputt.length)}${kaputt.length ? ` (${kaputt.join(', ')})` : ''}`, exit: 1 };
  if (!funde.length && !offen.length) return { text: 'ALLES OK', exit: 0 };
  const teile = [...funde.map((k) => `FINDING ${k}: ${findings[k] ?? 'see the case line'}`), ...offen.map((k) => `NICHT_PRUEFBAR ${k}`)];
  return { text: `OK, ABER NICHT ALLES ERFUELLT: ${teile.join('; ')}`, exit: 0 };
}

// the result table of bericht.md; rows = [id, serves, what]
export function tabelle(zeilen, ergebnis) {
  return `| Case | Serves | What | Result |\n|---|---|---|---|\n${zeilen.map(([k, ak, w]) => `| ${k} | ${ak} | ${w} | ${ergebnis[k] ?? 'not run'} |`).join('\n')}\n`;
}

// SENS attribution (review U5b finding 2). peaks = peak of the difference (dBFS) of an S export after a gain change of eps dB, for the four set-ups
// { ohneSendBasis0, mitSendBasis0, ohneSendBasisM1, mitSendBasisM1 }. The Hall is only the cause if S WITHOUT the send follows the change smoothly (stays far
// below the gate, here below `weit` = gate - 30 dB) while S WITH the send steps above the gate, for the base 0 dB and for a non-zero base alike. If S
// without the send steps too, the gain path of the clip is the suspect and the finding goes back to the owning unit. Anything else is not isolated.
export function sensZuordnung(peaks, tor, weit = tor - 30) {
  const hoch = (x) => x > tor, tief = (x) => x < weit;
  const { ohneSendBasis0: o0, mitSendBasis0: m0, ohneSendBasisM1: o1, mitSendBasisM1: m1 } = peaks;
  if ([o0, m0, o1, m1].some((x) => !Number.isFinite(x) && x !== -Infinity)) return { urteil: 'NICHT_ISOLIERT', grund: 'a set-up is missing' };
  if (hoch(o0) || hoch(o1)) return { urteil: 'GAIN_PFAD', grund: `S without a send already steps above ${tor} dBFS (base 0 dB ${o0}, base -1 dB ${o1})` };
  if (tief(o0) && tief(o1) && hoch(m0) && hoch(m1)) return { urteil: 'HALL', grund: `S without a send ${o0}/${o1} dBFS, with the send ${m0}/${m1} dBFS (base 0 / -1 dB)` };
  return { urteil: 'NICHT_ISOLIERT', grund: `no clean split: without send ${o0}/${o1}, with send ${m0}/${m1} dBFS` };
}

// Repeatability control (review U6 finding 1). A step measured by SENS/SENSS (two exports that differ by eps dB clip gain) can only be called "sensitivity" of the Hall if
// the very same mix exported again WITHOUT any change nulls. peaks = peak of the difference (dBFS) of { zweiter: export 2 vs 1, dritter: export 3 vs 1,
// hinUndZurueck: gain +eps then back to the exact base value, export vs 1 }. Verdicts: WIEDERHOLBAR (all below the gate), NICHT_WIEDERHOLBAR (untouched exports differ:
// render-to-render non-determinism, the SENS steps are not evidence of sensitivity), ZUSTANDSABHAENGIG (untouched exports equal, but change-and-revert differs),
// NICHT_GEMESSEN (a value is missing or not a number).
export function wiederholbarkeit(peaks, tor) {
  const w = [peaks?.zweiter, peaks?.dritter, peaks?.hinUndZurueck];
  if (w.some((x) => typeof x !== 'number' || Number.isNaN(x))) return { urteil: 'NICHT_GEMESSEN', grund: 'a repeat export was not measured' };
  const text = `export 2 ${w[0]}, export 3 ${w[1]}, change-and-revert ${w[2]} dBFS (gate ${tor})`;
  if (w[0] > tor || w[1] > tor) return { urteil: 'NICHT_WIEDERHOLBAR', grund: `untouched exports differ: ${text}` };
  if (w[2] > tor) return { urteil: 'ZUSTANDSABHAENGIG', grund: `untouched exports equal, change-and-revert differs: ${text}` };
  return { urteil: 'WIEDERHOLBAR', grund: text };
}
