//! Krume (S7): bit-depth reduction plus sample-rate reduction with zero-order hold, per voice.
//! The quantizer is mid-tread and symmetric: `y = round(clamp(x, -1, 1) * q) / q` with `q = 2^(bits - 1)` (D2).
//! The rate reduction holds a value until a phase accumulator crosses 1 (D3). There is no anti-imaging filter: the
//! aliasing is the character (SP-1200, Fairlight). Non-finite input becomes 0 (D11 for the input).

#[derive(Clone, Copy, Debug)]
pub struct Krume {
    /// phase accumulator in samples of the hold clock (f64: no drift over long runs)
    p: f64,
    held: f32,
    /// the first sample after creation or reset is always taken
    first: bool,
}

impl Default for Krume {
    fn default() -> Self { Krume { p: 0.0, held: 0.0, first: true } }
}

impl Krume {
    /// `bits` is clamped to 1..24 (real-valued, a sweep is smooth), `rate` in Hz to 1..sr. Allocation free.
    #[inline]
    pub fn prozess(&mut self, x: f32, bits: f32, rate: f32, sr: f32) -> f32 {
        let x = if x.is_finite() { x } else { 0.0 };
        if self.first {
            self.first = false;
            self.p = 0.0;
            self.held = quant(x, bits);
        } else {
            self.p += (rate.clamp(1.0, sr) / sr) as f64;
            if self.p >= 1.0 {
                self.p -= self.p.floor();
                self.held = quant(x, bits);
            }
        }
        self.held
    }

    pub fn zuruecksetzen(&mut self) { *self = Krume::default(); }
}

#[inline]
fn quant(x: f32, bits: f32) -> f32 {
    let q = 2f64.powf(bits.clamp(1.0, 24.0) as f64 - 1.0);
    ((x.clamp(-1.0, 1.0) as f64 * q).round() / q) as f32
}
