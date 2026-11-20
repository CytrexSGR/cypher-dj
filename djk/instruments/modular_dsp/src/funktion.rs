//! Dual-slope function generator in the Serge / Buchla 281 tradition: one block that is an attack-decay envelope, a slew limiter
//! with separate up and down times, an LFO and (at short times) an audio-rate oscillator. State per voice in f64, no allocation,
//! no latency.
//!
//! Behaviour. A rising edge of `trig` through 0.5 (or, with `zyklus` high, the end of the fall) starts a rise toward 1 from the
//! current level, so a retrigger never jumps. At 1 the output holds while `halt` is above 0.5, otherwise it falls. Outside a
//! triggered rise the output follows `x` (default 0): upward at the rise rate, downward at the fall rate, so with `x` connected
//! and no trigger the block is a slew limiter, and with `x` unconnected the output falls to 0. `ende` is high for 1 ms when a
//! triggered or cycling fall has reached its target (at audio-rate cycling it is simply high), `steigt` is 1 while the output is
//! rising after a trigger or a cycle restart.
//!
//! Rates. `steigen` and `fallen` are the times in seconds of a full 0..1 swing, both multiplied by `2^-tempo` (`tempo` in
//! octaves, read per sample). The distance `e` to the target (clamped to 0..1) shapes the rate with `form` s in -1..1:
//!     rate = c(s) * exp(-s * K * (2e - 1)) / time,   c(s) = sinh(sK) / (sK),   K = 2.
//! At s = 0 the rate is constant (linear). For s < 0 the rate is high far from the target and low near it (an RC-like charge
//! that still arrives in finite time, the rate never drops below 0.24 of the linear one); for s > 0 the other way round. The
//! factor c(s) is the integral of the inverse shape over the swing, so a full 0..1 swing takes exactly `time` at every `form`.
//! A move that arrives inside a sample hands the rest of the sample to the next phase (fall after rise, restart after fall), so
//! a cycle keeps its frequency to a fraction of a sample, which matters at audio rate.

/// Full-swing time range in seconds and the end pulse length in seconds
pub const ZEIT_MIN: f64 = 0.0001;
pub const ZEIT_MAX: f64 = 60.0;
const KRUEMMUNG: f64 = 2.0;

const FOLGEN: u8 = 0;
const STEIGT: u8 = 1;
/// the top was reached, the output holds while `halt` is high and then falls (mode FOLGEN)
const OBEN: u8 = 2;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Funktion {
    y: f64,
    modus: u8,
    /// the run started by a trigger or a cycle restart is not over yet (its fall will produce `ende`)
    lauf: bool,
    trig_war: bool,
    ende_rest: u32,
    tempo_zuletzt: f64,
    tempo_faktor: f64,
}

impl Default for Funktion {
    fn default() -> Self {
        Funktion { y: 0.0, modus: FOLGEN, lauf: false, trig_war: false, ende_rest: 0, tempo_zuletzt: 0.0, tempo_faktor: 1.0 }
    }
}

#[inline]
fn endlich(v: f32, vorgabe: f64) -> f64 { if v.is_finite() { v as f64 } else { vorgabe } }

/// Shape factor of the rate at distance `e` (0..1) for `form` `s`; 1 at s = 0.
#[inline]
fn gestalt(s: f64, e: f64) -> f64 {
    if s.abs() < 1e-9 {
        return 1.0;
    }
    let sk = s * KRUEMMUNG;
    (sk.sinh() / sk) * (-sk * (2.0 * e - 1.0)).exp()
}

impl Funktion {
    /// One sample. Returns `(aus, ende, steigt)`.
    #[inline]
    #[allow(clippy::too_many_arguments)]
    pub fn prozess(&mut self, x: f32, trig: f32, halt: f32, steigen: f32, fallen: f32, form: f32, zyklus: f32, tempo: f32, sr: f32) -> (f32, f32, f32) {
        let x = endlich(x, 0.0).clamp(-10.0, 10.0);
        let t_steigen = endlich(steigen, 0.01).clamp(ZEIT_MIN, ZEIT_MAX);
        let t_fallen = endlich(fallen, 0.3).clamp(ZEIT_MIN, ZEIT_MAX);
        let s = endlich(form, 0.0).clamp(-1.0, 1.0);
        let halt_an = endlich(halt, 0.0) > 0.5;
        let zyklus_an = endlich(zyklus, 0.0) > 0.5;
        let tempo = endlich(tempo, 0.0).clamp(-8.0, 8.0);
        if tempo != self.tempo_zuletzt {
            self.tempo_zuletzt = tempo;
            self.tempo_faktor = tempo.exp2();
        }
        let sr = sr as f64;
        let trig_an = endlich(trig, 0.0) > 0.5;
        if trig_an && !self.trig_war {
            self.modus = STEIGT;
            self.lauf = true;
        }
        self.trig_war = trig_an;

        let mut rest = 1.0f64; // the part of this sample that is still unspent
        // the value shown on a sample where a move arrived: the top or the floor itself, even if the next phase already used the rest
        let mut anzeige: Option<f64> = None;
        for _ in 0..4 {
            if self.modus == OBEN {
                if halt_an {
                    self.y = 1.0;
                    break;
                }
                self.modus = FOLGEN;
            }
            let (ziel, zeit) = if self.modus == STEIGT { (1.0, t_steigen) } else { (x, if x >= self.y { t_steigen } else { t_fallen }) };
            let d = ziel - self.y;
            let e = d.abs();
            if self.modus == FOLGEN && e <= 1e-12 {
                // at the target: a cycling block starts the next rise, otherwise it rests
                self.y = ziel;
                if zyklus_an && rest > 1e-9 {
                    self.modus = STEIGT;
                    self.lauf = true;
                    continue;
                }
                break;
            }
            // distance to the target in units of a full swing, rate per sample at this distance
            let schritt = self.tempo_faktor / (zeit * sr) * gestalt(s, e.min(1.0));
            let noetig = e / schritt; // samples (fractions) to arrive
            if noetig <= rest * (1.0 + 1e-9) {
                rest = (rest - noetig).max(0.0);
                self.y = ziel;
                anzeige.get_or_insert(ziel);
                if self.modus == STEIGT {
                    self.modus = OBEN;
                    if rest <= 1e-9 { break; }
                } else {
                    if self.lauf && d < 0.0 {
                        self.ende_rest = ((0.001 * sr).round() as u32).max(1);
                    }
                    self.lauf = false;
                    if zyklus_an && rest > 1e-9 {
                        self.modus = STEIGT;
                        self.lauf = true;
                        continue;
                    }
                    break;
                }
            } else {
                self.y += d.signum() * schritt * rest;
                break;
            }
        }
        let ende = if self.ende_rest > 0 { self.ende_rest -= 1; 1.0 } else { 0.0 };
        let steigt = if self.modus == STEIGT { 1.0 } else { 0.0 };
        (anzeige.unwrap_or(self.y) as f32, ende, steigt)
    }
}
