//! MS-20 filter: Korg-35 topology (Sallen-Key, two one-poles with feedback) in TPT form (Zavalishin, "The Art of VA
//! Filter Design", Sallen-Key chapter; Pirkle, application notes AN-5 and AN-7 on the Korg35 LPF and HPF), computed in f64
//! like `svf.rs`. Two outputs, both 12 dB/oct: low-pass `tp` = 1/(s^2+(2-K)s+1) and high-pass `hp` = s^2/(s^2+(2-K)s+1)
//! (cutoff normalised to 1), K = feedback gain. The low-pass is `y = L(L*x + K*H(y))` (L = one-pole low-pass, H = one-pole
//! high-pass), the high-pass is `y = H(H*x + K*L(y))`. The nonlinearity of the original (diodes in the feedback path) is a
//! `tanh` exactly there: `K*H(y)` resp. `K*L(y)` goes through `tanh`. So the resonance screams, distorts and stays bounded:
//! the feedback term has magnitude at most 1 and every state depends on bounded quantities only.
//!
//! Zero delay: the feedback depends on the own output. The loop is scalar and monotone (`F' = 1 - G*beta*sech^2 >= 1/2`
//! because `G(1-G) <= 1/4` and `K <= 2.23`); Newton from the linear solution converges in 2 to 3 steps.
//! Resonance 0..1 maps to `K = 2*reso/0.9`: at 0.9, K = 2 (pole pair on the unit circle, oscillation sets in), above it
//! the oscillation grows up to the level the `tanh` allows (K = 2.22 at 1). The self-oscillation sits at the cutoff because
//! `tanh` turns no phase. Above K = 2 a tiny deterministic noise (1e-7) is added to the input so the oscillation starts
//! without any input signal (the original has its own noise).
//! Drive 0..1: `tanh(d*x)/tanh(d)` before the filter, d = 10*drive; linear at 0, strongly saturated at 1, full scale stays 1.

use std::f64::consts::PI;

pub const RESO_SCHWELLE: f64 = 0.9;
pub const ANTRIEB_D_MAX: f64 = 10.0;
const SAAT: u32 = 0x1234_5679;
const SAAT_PEGEL: f64 = 1e-7;

#[derive(Clone, Copy)]
pub struct Ms20 {
    /// low-pass: one-pole 1 (input), one-pole 2 (main stage), one-pole 3 (high-pass in the feedback)
    tp: [f64; 3],
    /// high-pass: one-pole A (input), one-pole B (main stage), one-pole C (low-pass in the feedback)
    hp: [f64; 3],
    zufall: u32,
}

impl Default for Ms20 {
    fn default() -> Self { Ms20 { tp: [0.0; 3], hp: [0.0; 3], zufall: SAAT } }
}

/// Pre-distort the input: linear for small d, otherwise normalised so full scale stays 1.
#[inline]
fn antreiben(x: f64, antrieb: f64) -> f64 {
    let d = ANTRIEB_D_MAX * antrieb.clamp(0.0, 1.0);
    if d < 1e-3 { x } else { (d * x).tanh() / d.tanh() }
}

impl Ms20 {
    /// (tp, hp) for input `x`. `modus`: 0 both outputs, 1 only `tp`, 2 only `hp` (the other branch does not run then).
    #[inline]
    pub fn prozess(&mut self, x: f32, cutoff: f32, reso: f32, antrieb: f32, modus: u8, sr: f32) -> (f32, f32) {
        let fc = (cutoff as f64).clamp(20.0, sr as f64 * 0.45);
        let g = (PI * fc / sr as f64).tan();
        let gg = g / (1.0 + g);
        let r = if reso.is_finite() { (reso as f64).clamp(0.0, 1.0) } else { 0.0 };
        let k = 2.0 * r / RESO_SCHWELLE;
        let mut xe = antreiben(x as f64, if antrieb.is_finite() { antrieb as f64 } else { 0.0 });
        if k > 2.0 {
            self.zufall = self.zufall.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            xe += (self.zufall as i32 as f64) * (SAAT_PEGEL / 2_147_483_648.0);
        }
        let t = if modus != 2 { self.tiefpass(xe, gg, k) } else { 0.0 };
        let h = if modus != 1 { self.hochpass(xe, gg, k) } else { 0.0 };
        if !(t.is_finite() && h.is_finite()) {
            *self = Ms20::default();
            return (0.0, 0.0);
        }
        (t as f32, h as f32)
    }

    /// `y = L(L*x + tanh(K*H(y)))`, `gg` = g/(1+g)
    #[inline]
    fn tiefpass(&mut self, x: f64, gg: f64, k: f64) -> f64 {
        let s = &mut self.tp;
        let v1 = gg * (x - s[0]);
        let a = v1 + s[0];
        s[0] += 2.0 * v1;
        let beta = k * (1.0 - gg);
        let c = gg * a + (1.0 - gg) * s[1];
        let mut y = (c - gg * beta * s[2]) / (1.0 - gg * beta);
        for _ in 0..4 {
            let t = (beta * (y - s[2])).tanh();
            let dy = (y - c - gg * t) / (1.0 - gg * beta * (1.0 - t * t));
            y -= dy;
            if dy.abs() < 1e-12 { break; }
        }
        let u = a + (beta * (y - s[2])).tanh();
        let v2 = gg * (u - s[1]);
        let aus = v2 + s[1];
        s[1] += 2.0 * v2;
        s[2] += 2.0 * gg * (aus - s[2]);
        aus
    }

    /// `y = H(H*x + tanh(K*L(y)))`
    #[inline]
    fn hochpass(&mut self, x: f64, gg: f64, k: f64) -> f64 {
        let s = &mut self.hp;
        let h = 1.0 - gg;
        let va = gg * (x - s[0]);
        let ha = x - (va + s[0]);
        s[0] += 2.0 * va;
        let c = h * (ha - s[1]);
        let beta = k * gg;
        let mut y = (c + h * h * k * s[2]) / (1.0 - h * beta);
        for _ in 0..4 {
            let t = (k * (gg * y + h * s[2])).tanh();
            let dy = (y - c - h * t) / (1.0 - h * beta * (1.0 - t * t));
            y -= dy;
            if dy.abs() < 1e-12 { break; }
        }
        let w = ha + (k * (gg * y + h * s[2])).tanh();
        let vb = gg * (w - s[1]);
        let aus = w - (vb + s[1]);
        s[1] += 2.0 * vb;
        s[2] += 2.0 * gg * (aus - s[2]);
        aus
    }
}
