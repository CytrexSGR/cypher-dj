//! Oszillatoren des Baukastens: Säge und Puls mit PolyBLEP, Dreieck mit PolyBLAMP (Spec E9), Sinus mit linearer FM
//! durch null, weißes Rauschen. Die Säge rechnet ohne Sync bitgleich wie `rb_dsp::Osz::saege` (Slice 1).
//!
//! Harter Sync: ein Eingang `sync` ≥ 1 setzt die Phase zurück. Was über 1 liegt, ist der Bruchteil des Samples seit dem
//! Rücksetzen, so wie ihn der Ausgang `zyklus` eines Leit-Oszillators liefert (1 + Bruchteil im Sample nach dem
//! Phasenüberlauf, sonst 0); ein einfacher Trigger (1,0) setzt auf den Sampleanfang. Geglättet wird nur die Hälfte nach
//! dem Sprung, die Hälfte davor liegt schon im vorigen Sample: das drückt das Aliasing, beseitigt es nicht.
//!
//! Band-limited hard sync (`hart`, see `REPORT-hard_sync.md`): every oscillator also reports, in the sample BEFORE its
//! phase wraps, when the wrap will happen: output `hart` = 1 + τ, τ in (0, 1] samples after the current sample, else 0.
//! A slave whose `hart` input has an edge reads that announcement in the same sample, so it knows the reset time and
//! the jump height one sample early and applies both halves of the PolyBLEP (and PolyBLAMP for the slope change of the
//! triangle) around the exact sub-sample reset position, without latency. The old `sync` path and every output of a
//! node without a `hart` edge are unchanged: `saege`, `puls` and `dreieck` below are not touched, `weiter` only also
//! records the announcement.

/// PolyBLEP-Rest für einen Sprung um −2 am Phasenüberlauf (wie rb_dsp).
#[inline]
fn blep(t: f32, dt: f32) -> f32 {
    if dt <= 0.0 {
        0.0
    } else if t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + x + x + 1.0
    } else {
        0.0
    }
}

/// Nur die Hälfte nach dem Sprung (für Sync).
#[inline]
fn blep_nach(t: f32, dt: f32) -> f32 {
    if dt > 0.0 && t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else {
        0.0
    }
}

/// PolyBLAMP-Rest einer Knickstelle mit Steigungsänderung 1 je Sample: Integral des PolyBLEP-Rests,
/// (1 + x)³/6 vor und (1 − x)³/6 nach der Ecke, x in Samples.
#[inline]
fn blamp(t: f32, dt: f32) -> f32 {
    if dt <= 0.0 {
        0.0
    } else if t < dt {
        let x = 1.0 - t / dt;
        x * x * x / 6.0
    } else if t > 1.0 - dt {
        let x = 1.0 + (t - 1.0) / dt;
        x * x * x / 6.0
    } else {
        0.0
    }
}

#[inline]
fn bruch(x: f32) -> f32 { x - x.floor() }

/// Phase 0..1 mit Merker für den Überlauf; gemeinsam für Säge, Puls und Dreieck.
#[derive(Default, Clone, Copy)]
pub struct Osz {
    phase: f32,
    /// zyklus-Wert für das laufende Sample (1 + Bruchteil nach dem Überlauf, sonst 0)
    zyklus: f32,
    /// `hart` output of the last sample: 1 + τ if the phase wrapped τ ∈ (0, 1] samples after it, else 0
    hart: f32,
    /// hard sync path: post-halves of the corrections of the events in the last interval, for the next sample
    nach: f32,
    /// hard sync path: the last interval held a reset, so the next sample adds `nach` instead of reading the post-halves
    /// of its natural edges off the phase
    nach_gilt: bool,
}

impl Osz {
    /// Rücksetzen bei Sync. Gibt die Phase im Moment des Rücksetzens zurück (für die Sprunghöhe), sonst None.
    #[inline]
    fn sync(&mut self, sync: f32, inc: f32) -> Option<f32> {
        if sync < 1.0 {
            return None;
        }
        let d = (sync - 1.0).clamp(0.0, 1.0);
        let vorher = bruch(self.phase + (1.0 - d) * inc);
        self.phase = d * inc;
        Some(vorher)
    }

    #[inline]
    fn weiter(&mut self, inc: f32) {
        let rest = 1.0 - self.phase;
        self.phase += inc;
        self.zyklus = 0.0;
        self.hart = 0.0;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
            self.zyklus = 1.0 + if inc > 0.0 { (self.phase / inc).min(0.999_999) } else { 0.0 };
            self.hart = 1.0 + if inc > 0.0 { (rest / inc).min(1.0) } else { 1.0 };
        }
    }

    /// Output `hart` of the sample just computed: 1 + τ if the phase wraps τ ∈ (0, 1] samples after it, else 0.
    #[inline]
    pub fn hart(&self) -> f32 { self.hart }

    /// Saw with band-limited hard sync: `hart` is the master's `hart` output of this sample (see the module doc).
    #[inline]
    pub fn saege_hart(&mut self, inc: f32, hart: f32) -> (f32, f32) {
        if hart < 1.0 && !self.nach_gilt {
            return self.saege(inc, 0.0);
        }
        self.hart_schritt(Form::Saege, inc, hart)
    }

    /// Pulse with band-limited hard sync, `breite` as in `puls`.
    #[inline]
    pub fn puls_hart(&mut self, inc: f32, breite: f32, hart: f32) -> (f32, f32) {
        if hart < 1.0 && !self.nach_gilt {
            return self.puls(inc, breite, 0.0);
        }
        self.hart_schritt(Form::Puls(breite.clamp(0.02, 0.98)), inc, hart)
    }

    /// Triangle with band-limited hard sync.
    #[inline]
    pub fn dreieck_hart(&mut self, inc: f32, hart: f32) -> (f32, f32) {
        if hart < 1.0 && !self.nach_gilt {
            return self.dreieck(inc, 0.0);
        }
        self.hart_schritt(Form::Dreieck, inc, hart)
    }

    /// One sample of the hard sync path. Runs when a reset is announced for the coming interval (`hart` >= 1) or the last
    /// interval held one; otherwise the callers use the unchanged functions above, whose corrections read the phase.
    ///
    /// Every discontinuity at time τ in (0, 1] after this sample, of height h and slope change d (per sample), adds the
    /// two-point PolyBLEP / PolyBLAMP residual: here h/2·(1−τ)² + d/6·(1−τ)³, in the next sample −h/2·τ² + d/6·τ³
    /// (the same polynomials as `blep` and `blamp`). The residuals add, so the order of the events does not matter.
    fn hart_schritt(&mut self, form: Form, inc: f32, hart: f32) -> (f32, f32) {
        let z = self.zyklus;
        // also NaN -> 0; a step below 1e-20 (5e-16 Hz) is a standing phase, and keeps the products below out of subnormals
        let inc = if inc > 1e-20 { inc } else { 0.0 };
        let p = self.phase;
        let mut y = form.wert(p);
        y += if self.nach_gilt { self.nach } else { form.nach_aus_phase(p, inc) };
        let mut e = Ereignisse::default();
        self.zyklus = 0.0;
        self.hart = 0.0;
        if hart >= 1.0 {
            // reset at τ = hart − 1; a value above 2 counts as the end of the interval
            let tau = (hart - 1.0).min(1.0);
            // before the reset: natural edges between p and the phase at the reset
            let ende = p + tau * inc;
            let wrap = form.kreuzungen(p, ende, 0.0, inc, &mut e);
            let pr = if ende >= 1.0 { ende - 1.0 } else { ende };
            // the jump to phase 0 and the change of slope there
            e.dazu(tau, form.wert(0.0) - form.wert(pr), (form.steigung_ab_null() - form.steigung(pr)) * inc);
            // after the reset: phase 0 .. (1 − τ)·inc, which can still cross the falling edge of a narrow pulse
            let neu = (1.0 - tau) * inc;
            form.kreuzungen(0.0, neu, tau, inc, &mut e);
            self.phase = neu;
            self.nach_gilt = true;
            if let Some(tw) = wrap {
                self.zyklus = 1.0 + (1.0 - tw).min(0.999_999);
                self.hart = 1.0 + tw;
            }
        } else {
            let ende = p + inc;
            let wrap = form.kreuzungen(p, ende, 0.0, inc, &mut e);
            self.phase = if ende >= 1.0 { ende - 1.0 } else { ende };
            self.nach_gilt = false;
            if let Some(tw) = wrap {
                self.zyklus = 1.0 + (1.0 - tw).min(0.999_999);
                self.hart = 1.0 + tw;
            }
        }
        // `nach` lives for one sample and cannot become subnormal: with inc >= 1e-20 every jump height is 0 or at least an
        // f32 ulp of the waveform (the naive values are rounded), and a corner of the triangle is crossed at least 3e-8 of
        // phase after the sample, so τ >= 6e-8 and the slope term 8·inc·τ³/6 stays normal (unit test below)
        self.nach = e.nach;
        (y + e.vor, z)
    }

    /// Ausgang `zyklus` des laufenden Samples (vor `weiter`).
    #[inline]
    pub fn zyklus(&self) -> f32 { self.zyklus }

    /// Phase only, for an oscillator whose branch is skipped (zweige.rs): the same phase, `zyklus` and `hart` bookkeeping as
    /// `saege`, `puls` and `dreieck` (all three advance the phase alike), without waveform, band-limiting corrections or output.
    #[inline]
    pub fn phase_nur(&mut self, inc: f32, sync: f32) {
        let _ = self.sync(sync, inc);
        self.weiter(inc);
    }

    /// `phase_nur` for an oscillator with the hard sync input. `art` 0 saw, 1 pulse with duty cycle `breite`, 2 triangle. Without
    /// an announced reset (and none pending from the last interval) the phase moves as in `phase_nur`; only the sample of an
    /// event runs the full hard sync step, so the phase and the pending correction stay exactly those of the audible path.
    #[inline]
    pub fn phase_nur_hart(&mut self, art: u8, inc: f32, breite: f32, hart: f32) {
        if hart < 1.0 && !self.nach_gilt {
            self.phase_nur(inc, 0.0);
            return;
        }
        let form = match art {
            0 => Form::Saege,
            1 => Form::Puls(breite.clamp(0.02, 0.98)),
            _ => Form::Dreieck,
        };
        let _ = self.hart_schritt(form, inc, hart);
    }

    /// Säge −1..1, `inc` = Frequenz / Abtastrate (0..0,5).
    #[inline]
    pub fn saege(&mut self, inc: f32, sync: f32) -> (f32, f32) {
        let z = self.zyklus;
        let y = match self.sync(sync, inc) {
            None => 2.0 * self.phase - 1.0 - blep(self.phase, inc),
            // Sprung von 2·vorher − 1 auf −1: Höhe −2·vorher
            Some(vorher) => 2.0 * self.phase - 1.0 - vorher * blep_nach(self.phase, inc),
        };
        self.weiter(inc);
        (y, z)
    }

    /// Puls −1..1 mit Tastgrad `breite` (0,02..0,98).
    #[inline]
    pub fn puls(&mut self, inc: f32, breite: f32, sync: f32) -> (f32, f32) {
        let z = self.zyklus;
        let b = breite.clamp(0.02, 0.98);
        let gesprungen = self.sync(sync, inc);
        let t = self.phase;
        let mut y = if t < b { 1.0 } else { -1.0 };
        match gesprungen {
            None => y += blep(t, inc),
            // Sprung von −1 auf +1 nur, wenn die Phase schon hinter der fallenden Flanke stand
            Some(vorher) if vorher >= b => y += blep_nach(t, inc),
            Some(_) => {}
        }
        y -= blep(bruch(t + 1.0 - b), inc);
        self.weiter(inc);
        (y, z)
    }

    /// Dreieck −1..1 (Spitze bei Phase 0, Tal bei 0,5).
    #[inline]
    pub fn dreieck(&mut self, inc: f32, sync: f32) -> (f32, f32) {
        let z = self.zyklus;
        let gesprungen = self.sync(sync, inc);
        let t = self.phase;
        let mut y = 4.0 * (t - 0.5).abs() - 1.0;
        // Steigung je Sample ±4·inc: an der Spitze −8·inc, im Tal +8·inc
        y += 8.0 * inc * blamp(bruch(t + 0.5), inc);
        match gesprungen {
            None => y -= 8.0 * inc * blamp(t, inc),
            // Sprung auf die Spitze: Höhe 1 − Dreieck(vorher)
            Some(vorher) => y += 0.5 * (1.0 - (4.0 * (vorher - 0.5).abs() - 1.0)) * blep_nach(t, inc),
        }
        self.weiter(inc);
        (y, z)
    }
}

/// Waveform of the hard sync path.
#[derive(Clone, Copy)]
enum Form {
    Saege,
    /// duty cycle, already clamped to 0.02..0.98
    Puls(f32),
    Dreieck,
}

/// Sum of the residuals of the events in one interval: `vor` for this sample, `nach` for the next.
#[derive(Default)]
struct Ereignisse {
    vor: f32,
    nach: f32,
}

impl Ereignisse {
    /// A step of height `h` and a slope change `d` per sample at τ ∈ [0, 1] samples after this sample.
    #[inline]
    fn dazu(&mut self, tau: f32, h: f32, d: f32) {
        let tau = tau.clamp(0.0, 1.0);
        let v = 1.0 - tau;
        self.vor += 0.5 * h * v * v + d * v * v * v * (1.0 / 6.0);
        self.nach += -0.5 * h * tau * tau + d * tau * tau * tau * (1.0 / 6.0);
    }
}

impl Form {
    /// Naive value at phase `t` in 0..1.
    #[inline]
    fn wert(self, t: f32) -> f32 {
        match self {
            Form::Saege => 2.0 * t - 1.0,
            Form::Puls(b) => if t < b { 1.0 } else { -1.0 },
            Form::Dreieck => 4.0 * (t - 0.5).abs() - 1.0,
        }
    }

    /// Slope per unit of phase at `t` (the right-hand slope at a corner).
    #[inline]
    fn steigung(self, t: f32) -> f32 {
        match self {
            Form::Saege => 2.0,
            Form::Puls(_) => 0.0,
            Form::Dreieck => if t < 0.5 { -4.0 } else { 4.0 },
        }
    }

    /// Slope right after a reset to phase 0.
    #[inline]
    fn steigung_ab_null(self) -> f32 { self.steigung(0.0) }

    /// The natural edges in (0, 1]: (phase, step height, slope change per unit of phase). Unused entries are `None`.
    #[inline]
    fn kanten(self) -> [Option<(f32, f32, f32)>; 2] {
        match self {
            Form::Saege => [Some((1.0, -2.0, 0.0)), None],
            Form::Puls(b) => [Some((b, -2.0, 0.0)), Some((1.0, 2.0, 0.0))],
            Form::Dreieck => [Some((0.5, 0.0, 8.0)), Some((1.0, 0.0, -8.0))],
        }
    }

    /// Adds the edges the phase crosses on its way from `von` (0..1) to `bis` (>= von, < 2), starting `t0` samples after
    /// this sample at `inc` per sample. An edge at phase e counts when von < e <= bis (the old code wraps at >= 1 too).
    /// Returns τ of the wrap through phase 1, if there is one.
    #[inline]
    fn kreuzungen(self, von: f32, bis: f32, t0: f32, inc: f32, e: &mut Ereignisse) -> Option<f32> {
        let mut wrap = None;
        if !(inc > 0.0) || !(bis > von) {
            return None;
        }
        for (k, plus) in [(0, 0.0f32), (1, 1.0f32)] {
            for (kante, h, d) in self.kanten().into_iter().flatten() {
                let ort = kante + plus;
                if von < ort && ort <= bis {
                    let tau = (t0 + (ort - von) / inc).min(1.0);
                    e.dazu(tau, h, d * inc);
                    if k == 0 && kante == 1.0 {
                        wrap = Some(tau);
                    }
                }
            }
        }
        wrap
    }

    /// Post-halves of the edges the phase crossed in the last interval, read off the phase as the old code does (valid
    /// only when that interval held no reset): an edge e lies d = frac(p − e) behind, if d < inc.
    #[inline]
    fn nach_aus_phase(self, p: f32, inc: f32) -> f32 {
        if !(inc > 0.0) {
            return 0.0;
        }
        let mut summe = 0.0;
        for (kante, h, d) in self.kanten().into_iter().flatten() {
            let hinter = bruch(p - kante);
            if hinter < inc {
                let tau = 1.0 - hinter / inc; // the edge sat τ after the last sample
                summe += -0.5 * h * tau * tau + d * inc * tau * tau * tau * (1.0 / 6.0);
            }
        }
        summe
    }
}

/// Sinus mit linearer FM: `inc` darf negativ werden (FM durch null), die Phase läuft dann rückwärts.
#[derive(Default, Clone, Copy)]
pub struct Sinus {
    phase: f32,
    zyklus: f32,
    /// `hart` output, as in `Osz`
    hart: f32,
}

impl Sinus {
    #[inline]
    pub fn sample(&mut self, inc: f32, sync: f32) -> (f32, f32) {
        let z = self.zyklus;
        if sync >= 1.0 {
            self.phase = (sync - 1.0).clamp(0.0, 1.0) * inc.max(0.0);
        }
        let y = (std::f32::consts::TAU * self.phase).sin();
        let rest = 1.0 - self.phase;
        self.phase += inc;
        self.zyklus = 0.0;
        self.hart = 0.0;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
            self.zyklus = 1.0 + if inc > 0.0 { (self.phase / inc).min(0.999_999) } else { 0.0 };
            self.hart = 1.0 + if inc > 0.0 { (rest / inc).min(1.0) } else { 1.0 };
        } else if self.phase < 0.0 {
            self.phase += 1.0;
        }
        self.phase = self.phase.clamp(0.0, 0.999_999_9);
        (y, z)
    }

    /// Output `hart` of the sample just computed (forward wraps only; a phase running backwards under FM announces none).
    #[inline]
    pub fn hart(&self) -> f32 { self.hart }

    /// Phase only (a skipped branch, zweige.rs): the phase arithmetic of `sample` without the sine.
    #[inline]
    pub fn phase_nur(&mut self, inc: f32, sync: f32) {
        if sync >= 1.0 {
            self.phase = (sync - 1.0).clamp(0.0, 1.0) * inc.max(0.0);
        }
        let rest = 1.0 - self.phase;
        self.phase += inc;
        self.zyklus = 0.0;
        self.hart = 0.0;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
            self.zyklus = 1.0 + if inc > 0.0 { (self.phase / inc).min(0.999_999) } else { 0.0 };
            self.hart = 1.0 + if inc > 0.0 { (rest / inc).min(1.0) } else { 1.0 };
        } else if self.phase < 0.0 {
            self.phase += 1.0;
        }
        self.phase = self.phase.clamp(0.0, 0.999_999_9);
    }
}

/// Weißes Rauschen −1..1, xorshift32 je Stimme mit eigenem Startwert (bitgleich bei gleichem Graphen).
#[derive(Clone, Copy)]
pub struct Rauschen {
    s: u32,
}

impl Rauschen {
    pub fn neu(stimme: usize) -> Self { Self { s: 0x9E37_79B9 ^ (stimme as u32 + 1).wrapping_mul(0x85EB_CA6B) } }

    #[inline]
    pub fn sample(&mut self) -> f32 {
        let mut x = self.s;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.s = x;
        x as i32 as f32 * (1.0 / 2_147_483_648.0)
    }

    /// One step of the stream without the value (a skipped branch, zweige.rs): the stream stays where it would be.
    #[inline]
    pub fn weiter(&mut self) {
        let mut x = self.s;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.s = x;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ruecksetzen_setzt_die_phase_auf_den_rest_des_intervalls() {
        // a reset τ after this sample leaves (1 − τ)·inc of phase at the next sample
        for (tau, inc) in [(0.25f32, 0.01f32), (0.999, 0.3), (1.0, 0.05), (0.0, 0.07)] {
            let mut o = Osz::default();
            for _ in 0..37 {
                o.saege_hart(inc * 0.61, 0.0);
            }
            o.saege_hart(inc, 1.0 + tau);
            assert!((o.phase - (1.0 - tau) * inc).abs() < 1e-7, "tau {tau}: phase {} vs {}", o.phase, (1.0 - tau) * inc);
            assert!(o.nach_gilt);
        }
    }

    #[test]
    fn kein_subnormaler_zustand_bei_langsamer_phase() {
        // phase steps far below audio, down to a subnormal one (1e-40, which would leave a subnormal phase unless it counts
        // as standing), and resets very close to the sample, on all three waveforms
        for inc in [1e-12f32, 3e-16, 1e-19, 1e-30, 1e-40] {
            for tau in [1.192_092_9e-7f32, 1e-5, 0.5] {
                for form in 0..3 {
                    let mut o = Osz::default();
                    for i in 0..64 {
                        let hart = if i % 2 == 0 { 1.0 + tau } else { 0.0 };
                        let (y, _) = match form {
                            0 => o.saege_hart(inc, hart),
                            1 => o.puls_hart(inc, 0.3, hart),
                            _ => o.dreieck_hart(inc, hart),
                        };
                        for v in [y, o.phase, o.nach, o.hart] {
                            assert!(v == 0.0 || v.is_normal(), "form {form} inc {inc} tau {tau} sample {i}: subnormal or non-finite state {v}");
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn unsinnige_werte_bleiben_endlich() {
        // a NaN step without a reset goes the old way and stays NaN as before (bit identity; the program's guard catches
        // it). The hard sync path itself turns a NaN step into a standing phase:
        let mut o = Osz::default();
        assert!(o.hart_schritt(Form::Puls(0.3), f32::NAN, 1.5).0.is_finite() && o.hart_schritt(Form::Saege, f32::NAN, 0.0).0.is_finite());
        for inc in [f32::INFINITY, -1.0, 0.0, 0.5, 1e30] {
            for hart in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, -1.0, 1.0, 1.5, 2.0, 7.0, 1e30] {
                let mut o = Osz::default();
                for _ in 0..8 {
                    let a = o.saege_hart(inc.clamp(0.0, 0.5), hart).0;
                    let b = o.puls_hart(inc.clamp(0.0, 0.5), 0.3, hart).0;
                    let c = o.dreieck_hart(inc.clamp(0.0, 0.5), hart).0;
                    assert!(a.is_finite() && b.is_finite() && c.is_finite(), "inc {inc} hart {hart}: {a} {b} {c}");
                }
            }
        }
    }
}
