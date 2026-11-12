//! Multi-stage envelope per voice (MSEG): up to 8 stages, each with target level `p` (0..1), time `t` (s) and curve `k`
//! (-1..1). A stage moves from the level at its start to the target; curve 0 is linear, > 0 exponential (slow start, fast
//! end), < 0 logarithmic (fast start, long run-out). Every stage lasts at least 0.5 ms (no jump).
//!
//! Gate behaviour (as in `adsr`): a strike (`trig`) or a rising gate edge starts stage 1 at the current value, not at
//! zero, so a stolen voice does not click. When the gate falls, the envelope leaves any stage up to and including the
//! sustain stage (or the loop) for the release: it continues at the stage after `halt` or after `bis`, from the current
//! value. This also holds when strike and release fall into the same sample, otherwise the envelope would hang on the
//! hold. If no stage follows, it runs to 0 in 5 ms.
//! * `halt` = k (1..stufen): after stage k the level holds while the gate is high. 0 = no sustain stage: the stages run
//!   through and the level of the last stage stays; the gate then acts only through the loop and as a strike.
//! * `von`..`bis` (1-based, `von` 0 = no loop): when stage `bis` is done and the gate is high, stage `von` follows. A loop
//!   replaces the sustain stage (`halt` must be 0 then).

pub const STUFEN_MAX: usize = 8;
/// shortest stage time in s
pub const ZEIT_MIN: f32 = 0.0005;
/// run time of the release when no stage follows (s)
const ENDE_ZEIT: f32 = 0.005;
/// curvature at curve +-1: exp(6) ~ 403
const KRUEMMUNG: f32 = 6.0;

/// The setting of the node (fixed, not an input).
#[derive(Clone, Copy, Debug)]
pub struct MsegSatz {
    pub stufen: u8,
    pub halt: u8,
    pub von: u8,
    pub bis: u8,
    pub p: [f32; STUFEN_MAX],
    pub t: [f32; STUFEN_MAX],
    pub k: [f32; STUFEN_MAX],
}

impl MsegSatz {
    /// index (0-based) of the stage the release continues with; `None` without sustain and loop
    fn freigabe(&self) -> Option<usize> {
        if self.von > 0 {
            Some(self.bis as usize)
        } else if self.halt > 0 {
            Some(self.halt as usize)
        } else {
            None
        }
    }
}

/// curve shape: progress u 0..1 -> 0..1 with curvature `a` (0 = linear)
#[inline]
pub fn form(u: f32, a: f32) -> f32 {
    if a.abs() < 1e-3 {
        u
    } else {
        ((a * u).exp() - 1.0) / (a.exp() - 1.0)
    }
}

#[derive(Clone, Copy, Default, Debug, PartialEq)]
enum Phase {
    #[default]
    Ruhe,
    Stufe,
    Halt,
    Fertig,
}

#[derive(Clone, Copy, Default, Debug)]
pub struct Mseg {
    phase: Phase,
    stufe: usize,
    /// the 5 ms run to 0 is active
    ende: bool,
    freigegeben: bool,
    gate_vorher: bool,
    start: f32,
    ziel: f32,
    n: f32,
    len: f32,
    a: f32,
    /// exp(a) - 1, once per stage instead of once per sample
    nenner: f32,
    pub wert: f32,
}

impl Mseg {
    fn beginne(&mut self, st: usize, c: &MsegSatz, sr: f32) {
        self.start = self.wert;
        self.n = 0.0;
        self.phase = Phase::Stufe;
        self.stufe = st;
        if st >= c.stufen as usize {
            self.ende = true;
            self.ziel = 0.0;
            self.len = (ENDE_ZEIT * sr).max(1.0);
            self.a = 0.0;
            self.nenner = 1.0;
        } else {
            self.ende = false;
            self.ziel = c.p[st];
            // rounded to 1/1000 sample: 0.5 ms at 48 kHz is exactly 24 samples, not 24.000001 (one sample late)
            self.len = ((c.t[st].max(ZEIT_MIN) * sr * 1000.0).round() / 1000.0).max(1.0);
            self.a = c.k[st] * KRUEMMUNG;
            self.nenner = if self.a.abs() < 1e-3 { 1.0 } else { self.a.exp() - 1.0 };
        }
    }

    #[inline]
    pub fn prozess(&mut self, gate: bool, trig: bool, c: &MsegSatz, sr: f32) -> f32 {
        if trig || (gate && !self.gate_vorher) {
            self.freigegeben = false;
            self.beginne(0, c, sr);
        }
        self.gate_vorher = gate;
        if !gate && !self.freigegeben && matches!(self.phase, Phase::Stufe | Phase::Halt) && !self.ende {
            if let Some(r) = c.freigabe() {
                self.freigegeben = true;
                self.beginne(r, c, sr);
            }
        }
        match self.phase {
            Phase::Ruhe => self.wert = 0.0,
            Phase::Halt | Phase::Fertig => {}
            Phase::Stufe => {
                self.n += 1.0;
                if self.n >= self.len {
                    let rest = self.n - self.len;
                    self.wert = self.ziel;
                    let st = self.stufe;
                    if self.ende {
                        self.phase = Phase::Fertig;
                    } else if c.von > 0 && gate && st + 1 == c.bis as usize {
                        self.beginne(c.von as usize - 1, c, sr);
                        self.n = rest;
                    } else if c.halt > 0 && gate && !self.freigegeben && st + 1 == c.halt as usize {
                        self.phase = Phase::Halt;
                    } else if st + 1 < c.stufen as usize {
                        self.beginne(st + 1, c, sr);
                        self.n = rest;
                    } else {
                        self.phase = Phase::Fertig;
                    }
                } else {
                    self.wert = self.start + (self.ziel - self.start) * (if self.a.abs() < 1e-3 { self.n / self.len } else { ((self.a * self.n / self.len).exp() - 1.0) / self.nenner });
                }
            }
        }
        self.wert = self.wert.clamp(0.0, 1.0);
        self.wert
    }
}
