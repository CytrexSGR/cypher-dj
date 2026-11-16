//! Chaos LFO (type 54): a strange attractor as a modulation source. Form 0 is the Lorenz system, form 1 the Roessler system.
//! Two state coordinates come out as `aus` and `aus2`, each scaled by a fixed constant and clamped to -1..1, so a patch gets two
//! related but never repeating curves from one block. The state lives in f64 per voice and is integrated with classic RK4;
//! the step is split so it never exceeds `MAX_SCHRITT` simulation time units (the Lorenz system is stable under RK4 up to
//! about 0.1, the Roessler system far beyond that). The start state is a hash of `saat` and the voice number, so the same graph
//! always plays the same, and a rising edge on `trig` jumps back to it. `rate` is a speed in Hz-like units: at 1 the attractor
//! makes roughly one swing per second (Lorenz 1.5, Roessler 6 simulation units per second at rate 1).
//! No allocation, no locks, no panics; a non-finite state is replaced by the seeded start.

/// lower and upper limit of `rate`
pub const MIN_RATE: f32 = 0.01;
pub const MAX_RATE: f32 = 50.0;
/// default `rate`
pub const RATE: f32 = 1.0;
/// largest RK4 step in simulation time units
const MAX_SCHRITT: f64 = 0.01;

/// simulation units per second at rate 1
const TEMPO: [f64; 2] = [1.5, 6.0];
/// output scale (divisor) of the two coordinates; the attractors stay inside these ranges, the clamp is only a safety net
const SKALA: [[f64; 2]; 2] = [[21.0, 29.0], [14.0, 14.0]];

#[inline]
fn mische(mut x: u32) -> u32 {
    x = x.wrapping_add(0x9E37_79B9);
    x = (x ^ (x >> 16)).wrapping_mul(0x85EB_CA6B);
    x = (x ^ (x >> 13)).wrapping_mul(0xC2B2_AE35);
    x ^ (x >> 16)
}

/// uniform in 0..1
#[inline]
fn gleichmaessig(x: u32) -> f64 { (x >> 8) as f64 / 16_777_216.0 }

#[inline]
fn ableitung(form: u8, s: [f64; 3]) -> [f64; 3] {
    let [x, y, z] = s;
    if form == 0 {
        // Lorenz: sigma 10, rho 28, beta 8/3
        [10.0 * (y - x), x * (28.0 - z) - y, x * y - (8.0 / 3.0) * z]
    } else {
        // Roessler: a 0.2, b 0.2, c 5.7
        [-y - z, x + 0.2 * y, 0.2 + z * (x - 5.7)]
    }
}

#[inline]
fn rk4(form: u8, s: [f64; 3], h: f64) -> [f64; 3] {
    let add = |a: [f64; 3], b: [f64; 3], f: f64| [a[0] + b[0] * f, a[1] + b[1] * f, a[2] + b[2] * f];
    let k1 = ableitung(form, s);
    let k2 = ableitung(form, add(s, k1, h * 0.5));
    let k3 = ableitung(form, add(s, k2, h * 0.5));
    let k4 = ableitung(form, add(s, k3, h));
    [
        s[0] + h / 6.0 * (k1[0] + 2.0 * k2[0] + 2.0 * k3[0] + k4[0]),
        s[1] + h / 6.0 * (k1[1] + 2.0 * k2[1] + 2.0 * k3[1] + k4[1]),
        s[2] + h / 6.0 * (k1[2] + 2.0 * k2[2] + 2.0 * k3[2] + k4[2]),
    ]
}

#[derive(Clone, Copy, Debug)]
pub struct Chaos {
    start: [f64; 3],
    s: [f64; 3],
    trig_vorher: bool,
}

impl Chaos {
    /// `form` 0 Lorenz, 1 Roessler. The start lies near the attractor, spread by the hash of (`saat`, `stimme`).
    pub fn neu(stimme: usize, saat: u32, form: u8) -> Self {
        let basis = mische(saat ^ mische((stimme as u32).wrapping_mul(0x27D4_EB2F).wrapping_add(0x1656_67B1)));
        let u = |n: u32| gleichmaessig(mische(basis ^ n.wrapping_mul(0x9E37_79B9))) * 2.0 - 1.0;
        let start = if form == 0 {
            [u(1) * 8.0, u(2) * 8.0, 25.0 + u(3) * 10.0]
        } else {
            [u(1) * 6.0, u(2) * 6.0, 1.0 + u(3).abs() * 2.0]
        };
        Self { start, s: start, trig_vorher: false }
    }

    /// One sample: (`aus`, `aus2`). `rate` in Hz-like units (clamped to 0.01..50, non-finite counts as the default).
    #[inline]
    pub fn prozess(&mut self, rate: f32, trig: f32, form: u8, sr: f32) -> (f32, f32) {
        let hoch = trig > 0.5;
        if hoch && !self.trig_vorher {
            self.s = self.start;
        }
        self.trig_vorher = hoch;
        let rate = if rate.is_finite() { rate.clamp(MIN_RATE, MAX_RATE) } else { RATE } as f64;
        let form = form.min(1);
        let h = rate * TEMPO[form as usize] / sr as f64;
        let teile = (h / MAX_SCHRITT).ceil().max(1.0);
        let hs = h / teile;
        for _ in 0..teile as u32 {
            self.s = rk4(form, self.s, hs);
        }
        if !(self.s[0].is_finite() && self.s[1].is_finite() && self.s[2].is_finite()) {
            self.s = self.start;
        }
        let k = SKALA[form as usize];
        ((self.s[0] / k[0]).clamp(-1.0, 1.0) as f32, (self.s[1] / k[1]).clamp(-1.0, 1.0) as f32)
    }
}
