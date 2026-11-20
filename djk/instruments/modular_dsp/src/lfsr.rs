//! Chip noise: the 15-bit linear feedback shift register of the NES noise channel (D19). One step per clock edge; the clock is
//! a phase accumulator per voice driven by the input `hz`. Long mode feeds back bit 0 xor bit 1 (period 32767), short mode bit 0
//! xor bit 6 (period 93). The register starts at 1 and the block holds no other state, so it is deterministic from reset. The
//! output is +1 while bit 0 is clear and -1 while it is set. No allocation, no latency.

/// One voice of the register.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lfsr {
    reg: u16,
    phase: f64,
}

impl Default for Lfsr {
    fn default() -> Self { Lfsr { reg: 1, phase: 0.0 } }
}

impl Lfsr {
    /// One output sample. `hz` is the clock rate; it is limited to one step per sample (0..=sr). The step happens when the
    /// accumulator reaches 1, and the output follows the register after that step.
    #[inline]
    pub fn prozess(&mut self, hz: f32, kurz: bool, sr: f32) -> f32 {
        let inc = hz as f64 / sr as f64;
        let inc = if inc > 0.0 { inc.min(1.0) } else { 0.0 };
        self.phase += inc;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
            let tap = if kurz { 6 } else { 1 };
            let rueck = (self.reg ^ (self.reg >> tap)) & 1;
            self.reg = (self.reg >> 1) | (rueck << 14);
        }
        if self.reg & 1 == 0 { 1.0 } else { -1.0 }
    }
}
