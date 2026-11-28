// One switch for every golden/pin test: CYPHERDJ_PINS_SCHREIBEN=1 rewrites the pinned file instead of comparing (djk/tools/pins_follow_up.sh sets it).
// The older per-test names stay as aliases. `pinText(datei)` is the start of every pin assertion message: the CI log parser
// (djk/tools/ci/zeige_error.sh) counts failing tests whose text carries "[pin]" as pin drift.
export const PINS_ALT = ['ROUTEN_GOLDEN_SCHREIBEN', 'GOLDEN_SCHREIBEN', 'CYPHERDJ_GOLDEN_SCHREIBEN', 'CYPHERDJ_FIXTURE_SCHREIBEN', 'TON_PROBE_SCHREIBEN'];
export const pinsSchreiben = () => process.env.CYPHERDJ_PINS_SCHREIBEN === '1' || PINS_ALT.some((n) => process.env[n] === '1' || (n === 'GOLDEN_SCHREIBEN' && process.env[n]));
export const pinText = (was) => `[pin] ${was}: run djk/tools/pins_follow_up.sh`;
