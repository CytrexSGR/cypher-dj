//! Roehre (S8): one 12AX7 common-cathode triode stage. Koren's triode equation (D1) and the load line (D2) are solved
//! at translation time into a transfer table over the grid voltage; per sample the table is evaluated with first-order
//! antiderivative antialiasing (D7) and followed by the coupling-capacitor high-pass (D8). No allocation in the run.
//!
//! Signal path of one stage: `u = x * 10^(antrieb/20) * 0.25 V`, grid voltage `v = bias + u`, soft grid conduction on the
//! positive side (D3), table `f(v) = (Vq - Vp(v)) / (G_ref * 0.25)`, ADAA1, high-pass 10 Hz. `G_ref` is the small-signal
//! gain at the reference bias -1.5 V and is fixed for every bias, so a different bias changes the level physically.

const MU: f64 = 100.0;
const EX: f64 = 1.4;
const KG1: f64 = 1060.0;
const KP: f64 = 600.0;
const KVB: f64 = 300.0;
/// supply voltage and anode resistor (D2)
const B_PLUS: f64 = 250.0;
const R_A: f64 = 100e3;
/// reference bias for the gain normalisation (C2)
pub const BIAS_REF: f64 = -1.5;
/// valid range of the bias, and the step of the pre-built tables (C5)
pub const BIAS_MIN: f64 = -3.0;
pub const BIAS_MAX: f64 = -0.5;
pub const BIAS_SCHRITT: f64 = 0.25;
/// number of pre-built tables when `bias` is modulated
pub const TABELLEN: usize = 11;
/// soft limit of the grid voltage on the positive side (D3), volts
const VGC: f64 = 0.5;
/// table domain: grid voltage after D3 (C5)
const V_MIN: f64 = -12.0;
const V_MAX: f64 = 0.5;
const N: usize = 4097;
const DU: f64 = (V_MAX - V_MIN) / (N - 1) as f64;
/// volts at the grid per unit of input at antrieb 0 dB (D4)
const GITTER_SPITZE: f64 = 0.25;
/// ADAA1 falls back to f(mean) below this |v - v_prev| (D7)
const EPS: f64 = 1e-6;
/// coupling-capacitor corner (D8)
const HP_HZ: f64 = 10.0;
/// limits of `antrieb` in dB (C7)
pub const ANTRIEB_MIN: f32 = -40.0;
pub const ANTRIEB_MAX: f32 = 40.0;

/// Koren plate current in amperes (D1).
pub fn koren_ip(vg: f64, vp: f64) -> f64 {
    let z = KP * (1.0 / MU + vg / (KVB + vp * vp).sqrt());
    // softplus without overflow
    let sp = if z > 30.0 { z } else { z.exp().ln_1p() };
    let e1 = vp / KP * sp;
    if e1 > 0.0 { 2.0 * e1.powf(EX) / KG1 } else { 0.0 }
}

/// Plate voltage for a grid voltage: `Vp = B+ - Ra * Ip(Vg, Vp)` by bisection on [0, B+] (D2).
pub fn vp_aus_vg(vg: f64) -> f64 {
    let (mut lo, mut hi) = (0.0f64, B_PLUS);
    for _ in 0..100 {
        let mid = 0.5 * (lo + hi);
        if mid == lo || mid == hi { break; } // converged to the last bit, the remaining steps change nothing
        if mid + R_A * koren_ip(vg, mid) - B_PLUS > 0.0 { hi = mid } else { lo = mid }
    }
    0.5 * (lo + hi)
}

/// |dVp/dVg| at `bias`, central difference 1e-4 (D5).
fn g_bei(bias: f64) -> f64 {
    let h = 1e-4;
    ((vp_aus_vg(bias + h) - vp_aus_vg(bias - h)) / (2.0 * h)).abs()
}

/// Gain used for the normalisation of every table: |dVp/dVg| at the reference bias.
pub fn g_ref() -> f64 { g_bei(BIAS_REF) }

/// Grid conduction (D3): above 0 V the grid voltage is limited softly to `VGC`.
#[inline]
pub fn gitter(v: f64) -> f64 {
    if v > 0.0 { VGC * (v / VGC).tanh() } else { v }
}

/// Transfer table of one stage at one bias: `f` over the grid voltage `v` (after D3), `ff` its antiderivative.
pub struct RoehrenTabelle {
    bias: f64,
    vq: f64,
    g: f64,
    f: Box<[f64]>,
    ff: Box<[f64]>,
}

impl RoehrenTabelle {
    /// Builds the table for `bias` (solves the load line at all 4097 grid points; use `RoehrenSatz` for many biases).
    pub fn neu(bias: f64) -> Self {
        let vp = Self::vp_gitter();
        Self::aus_vp(bias, &vp, g_ref())
    }

    /// Plate voltage on the table grid; it does not depend on the bias.
    fn vp_gitter() -> Vec<f64> { (0..N).map(|i| vp_aus_vg(V_MIN + i as f64 * DU)).collect() }

    fn aus_vp(bias: f64, vp: &[f64], gref: f64) -> Self {
        let vq = vp_aus_vg(bias);
        let skala = 1.0 / (gref * GITTER_SPITZE);
        let f: Box<[f64]> = vp.iter().map(|p| (vq - p) * skala).collect();
        let mut ff = vec![0.0f64; N];
        for i in 1..N {
            ff[i] = ff[i - 1] + 0.5 * (f[i - 1] + f[i]) * DU;
        }
        RoehrenTabelle { bias, vq, g: g_bei(bias), f, ff: ff.into_boxed_slice() }
    }

    pub fn bias(&self) -> f64 { self.bias }
    /// quiescent plate voltage at this bias
    pub fn vq(&self) -> f64 { self.vq }
    /// |dVp/dVg| at this bias
    pub fn g(&self) -> f64 { self.g }
    /// D2 output: plate voltage for the grid voltage `vg` (before D3)
    pub fn vp_von_vg(&self, vg: f64) -> f64 { vp_aus_vg(vg) }

    /// Transfer for the grid voltage `v` (after D3), linear interpolation; held constant outside the domain.
    #[inline]
    pub fn f(&self, v: f64) -> f64 {
        let i = (v - V_MIN) / DU;
        if !(i > 0.0) { return self.f[0]; }
        if i >= (N - 1) as f64 { return self.f[N - 1]; }
        let i0 = i as usize;
        let fr = i - i0 as f64;
        self.f[i0] + (self.f[i0 + 1] - self.f[i0]) * fr
    }

    /// Antiderivative of `f`: the exact integral of the linearly interpolated `f` (C4); outside the domain `f` is
    /// constant, so `ff` continues linearly.
    #[inline]
    pub fn ff(&self, v: f64) -> f64 {
        let i = (v - V_MIN) / DU;
        if !(i > 0.0) { return self.ff[0] + self.f[0] * (v - V_MIN); }
        if i >= (N - 1) as f64 { return self.ff[N - 1] + self.f[N - 1] * (v - V_MAX); }
        let i0 = i as usize;
        let t = (i - i0 as f64) * DU;
        let (f0, f1) = (self.f[i0], self.f[i0 + 1]);
        self.ff[i0] + f0 * t + 0.5 * (f1 - f0) / DU * t * t
    }

    /// Transfer in input volts: `f(gitter(bias + u))`. This is the static curve of the stage without ADAA and high-pass.
    pub fn fu(&self, u: f64) -> f64 { self.f(gitter(self.bias + u)) }
}

/// The tables of one node: one at the free bias, or (modulated bias) eleven at -3, -2.75, ..., -0.5 (C5).
pub struct RoehrenSatz {
    tabellen: Box<[RoehrenTabelle]>,
}

impl RoehrenSatz {
    /// One table at exactly `bias` (the `bias` input has no edge).
    pub fn eins(bias: f64) -> Self { RoehrenSatz { tabellen: vec![RoehrenTabelle::neu(bias)].into_boxed_slice() } }

    /// Eleven tables for the clamped range; the plate voltage is solved once and shared.
    pub fn elf() -> Self {
        let vp = RoehrenTabelle::vp_gitter();
        let gref = g_ref();
        let t: Vec<RoehrenTabelle> = (0..TABELLEN).map(|k| RoehrenTabelle::aus_vp(BIAS_MIN + k as f64 * BIAS_SCHRITT, &vp, gref)).collect();
        RoehrenSatz { tabellen: t.into_boxed_slice() }
    }

    pub fn anzahl(&self) -> usize { self.tabellen.len() }
    pub fn tabelle(&self, i: usize) -> &RoehrenTabelle { &self.tabellen[i] }

    /// The two neighbouring tables and the weight of the second for `bias` (clamped to -3..-0.5).
    #[inline]
    pub fn waehle(&self, bias: f64) -> (&RoehrenTabelle, &RoehrenTabelle, f64) {
        let n = self.tabellen.len();
        if n == 1 { return (&self.tabellen[0], &self.tabellen[0], 0.0); }
        let pos = (bias.clamp(BIAS_MIN, BIAS_MAX) - BIAS_MIN) / BIAS_SCHRITT;
        let i0 = (pos as usize).min(n - 2);
        (&self.tabellen[i0], &self.tabellen[i0 + 1], pos - i0 as f64)
    }
}

/// One triode stage per voice: ADAA1 state and the coupling-capacitor high-pass.
#[derive(Clone, Copy, Debug)]
pub struct Roehre {
    /// previous grid voltage after D3
    vp: f64,
    erste: bool,
    hx: f64,
    hy: f64,
    sr: f32,
    a: f64,
    /// cached drive factor for `db_alt`
    db_alt: f32,
    faktor: f64,
}

impl Default for Roehre {
    fn default() -> Self { Roehre { vp: 0.0, erste: true, hx: 0.0, hy: 0.0, sr: 0.0, a: 0.0, db_alt: 0.0, faktor: GITTER_SPITZE } }
}

impl Roehre {
    /// One stage on a single table. `antrieb_db` is clamped to -40..40 dB, a non-finite `x` is 0, a non-finite
    /// `antrieb_db` is 0 dB (the block substitutes its free value before the call).
    #[inline]
    pub fn prozess(&mut self, t: &RoehrenTabelle, x: f32, antrieb_db: f32, sr: f32) -> f32 {
        let y = self.kern(t, t, 0.0, t.bias, x, antrieb_db);
        self.hochpass(y, sr)
    }

    /// Like `prozess` without the high-pass: the static curve plus ADAA, for tests.
    #[inline]
    pub fn prozess_ohne_hp(&mut self, t: &RoehrenTabelle, x: f32, antrieb_db: f32) -> f32 {
        self.kern(t, t, 0.0, t.bias, x, antrieb_db) as f32
    }

    /// One stage on a table set with a (modulated) bias; both tables use the same weight for the current and the
    /// previous grid voltage, so ADAA stays consistent.
    #[inline]
    pub fn prozess_satz(&mut self, satz: &RoehrenSatz, bias: f64, x: f32, antrieb_db: f32, sr: f32) -> f32 {
        let bias = bias.clamp(BIAS_MIN, BIAS_MAX);
        let (a, b, w) = satz.waehle(bias);
        let bias = if satz.anzahl() == 1 { a.bias } else { bias };
        let y = self.kern(a, b, w, bias, x, antrieb_db);
        self.hochpass(y, sr)
    }

    #[inline]
    fn kern(&mut self, ta: &RoehrenTabelle, tb: &RoehrenTabelle, w: f64, bias: f64, x: f32, antrieb_db: f32) -> f64 {
        let x = if x.is_finite() { x as f64 } else { 0.0 };
        let db = if antrieb_db.is_finite() { antrieb_db.clamp(ANTRIEB_MIN, ANTRIEB_MAX) } else { 0.0 };
        if db != self.db_alt {
            self.db_alt = db;
            self.faktor = 10f64.powf(db as f64 / 20.0) * GITTER_SPITZE;
        }
        let u = x * self.faktor;
        let v = gitter(bias + u);
        if self.erste {
            self.erste = false;
            self.vp = v;
        }
        let d = v - self.vp;
        let fw = |ta: &RoehrenTabelle, tb: &RoehrenTabelle, v: f64| (1.0 - w) * ta.f(v) + w * tb.f(v);
        let y = if d.abs() > EPS {
            let (fa, fb) = ((1.0 - w) * ta.ff(v) + w * tb.ff(v), (1.0 - w) * ta.ff(self.vp) + w * tb.ff(self.vp));
            (fa - fb) / d
        } else {
            fw(ta, tb, 0.5 * (v + self.vp))
        };
        self.vp = v;
        y
    }

    /// One-pole high-pass (D8), `a = exp(-2 pi 10 / sr)`, `y[n] = a (y[n-1] + x[n] - x[n-1])`.
    #[inline]
    fn hochpass(&mut self, x: f64, sr: f32) -> f32 {
        if sr != self.sr {
            self.sr = sr;
            self.a = (-2.0 * std::f64::consts::PI * HP_HZ / sr as f64).exp();
        }
        let o = self.a * (self.hy + x - self.hx);
        let o = if o.abs() < 1e-30 { 0.0 } else { o }; // no denormals in the decaying tail
        self.hx = x;
        self.hy = o;
        o as f32
    }

    pub fn zuruecksetzen(&mut self) { *self = Roehre::default(); }
}
