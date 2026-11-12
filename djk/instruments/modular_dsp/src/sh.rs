//! Sample and hold per voice. Input `x` is sampled on a clock tick and held until the next one; when `x` is not connected
//! the block draws from its own noise source (xorshift per voice, bit-identical for the same graph), value -1..1.
//! Clock, in this order of precedence: rising edge on `trig` (when connected) · `takt` beats per step from the host beat
//! (`takt` > 0, as in `lfo`) · `rate` in Hz. The two clocks without `trig` take a value already in the first sample.
//! `glatt` (ms): 0 = stepped; otherwise the output ramps linearly to the new value in exactly that time (click-free, ends
//! exactly on the target). A new tick before the end starts the ramp from the current value.
use crate::osz::Rauschen;

/// longest ramp time in ms
pub const GLATT_MAX_MS: f32 = 10_000.0;

#[derive(Clone, Copy)]
pub struct Sh {
    /// clock phase 0..1 (rate clock)
    phase: f32,
    /// last beat phase (beat clock)
    beat_phase: f32,
    erste: bool,
    trig_vorher: bool,
    ziel: f32,
    y: f32,
    rest: u32,
    schritt: f32,
    zufall: Rauschen,
}

impl Sh {
    pub fn neu(stimme: usize) -> Self {
        Self { phase: 0.0, beat_phase: 0.0, erste: true, trig_vorher: false, ziel: 0.0, y: 0.0, rest: 0, schritt: 0.0, zufall: Rauschen::neu(stimme + 301) }
    }

    /// rising edge above 0.5
    #[inline]
    pub fn takt_flanke(&mut self, trig: f32) -> bool {
        let an = trig > 0.5;
        let t = an && !self.trig_vorher;
        self.trig_vorher = an;
        t
    }

    /// internal clock in Hz; a non-finite rate counts as 0
    #[inline]
    pub fn takt_rate(&mut self, rate_hz: f32, sr: f32) -> bool {
        if self.erste {
            self.erste = false;
            return true;
        }
        let inc = if rate_hz.is_finite() { (rate_hz / sr).clamp(0.0, 0.5) } else { 0.0 };
        self.phase += inc;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
            true
        } else {
            false
        }
    }

    /// host beat: phase 0..1 per step; a tick when the phase wraps (falls)
    #[inline]
    pub fn takt_beat(&mut self, ph: f32) -> bool {
        let t = self.erste || ph < self.beat_phase;
        self.erste = false;
        self.beat_phase = ph;
        t
    }

    /// One sample. On `takt` it samples `x` (connected: `x_ext`) or the own noise.
    #[inline]
    pub fn prozess(&mut self, takt: bool, x: f32, x_ext: bool, glatt_ms: f32, sr: f32) -> f32 {
        if takt {
            let v = if x_ext { if x.is_finite() { x } else { 0.0 } } else { self.zufall.sample() };
            self.ziel = v;
            if glatt_ms > 0.0 {
                let n = ((glatt_ms.min(GLATT_MAX_MS) * 0.001 * sr).round() as u32).max(1);
                self.rest = n;
                self.schritt = (v - self.y) / n as f32;
            } else {
                self.rest = 0;
                self.y = v;
            }
        }
        if self.rest > 0 {
            self.rest -= 1;
            self.y = if self.rest == 0 { self.ziel } else { self.y + self.schritt };
        }
        self.y
    }
}
