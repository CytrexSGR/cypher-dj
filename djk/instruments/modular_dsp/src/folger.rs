//! Envelope follower per voice: peak detector with separate smoothing for rise (`an`) and fall (`ab`), both as a time
//! constant in ms (63 %, as in `gate`). Output 0..~1 for a full-scale sine (with a long `ab` a sine comes close to its
//! peak). Non-finite inputs count as silence; the output stays finite.

/// below this the level becomes 0 (no subnormals)
const NULL: f32 = 1e-30;
/// input limit: keeps the level finite even for absurd values
const MAX: f32 = 1e6;

#[derive(Clone, Copy, Default)]
pub struct Folger {
    pegel: f32,
}

/// smoothing factor per sample for a time constant in ms
#[inline]
pub fn koeff(ms: f32, sr: f32) -> f32 {
    let ms = if ms.is_finite() { ms.max(0.01) } else { 0.01 };
    1.0 - (-1.0 / (ms * sr / 1000.0)).exp()
}

impl Folger {
    #[inline]
    pub fn prozess(&mut self, x: f32, an_ms: f32, ab_ms: f32, sr: f32) -> f32 {
        let p = x.abs();
        let p = if p.is_finite() { p.min(MAX) } else { 0.0 };
        let k = if p > self.pegel { koeff(an_ms, sr) } else { koeff(ab_ms, sr) };
        self.pegel += k * (p - self.pegel);
        if self.pegel < NULL {
            self.pegel = 0.0;
        }
        self.pegel
    }
}
