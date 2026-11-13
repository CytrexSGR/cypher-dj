//! One-bit delay after the PT2399: a delta modulator writes a bit stream into a 44 000 bit memory, a second
//! integrator reads it back. There is no PCM sample rate. The clock sets the delay time, and because the memory is
//! read with the same clock, a longer delay means fewer bits per second: the step of the integrators grows, the
//! band narrows and the sound turns grainy. That coupling is the character of the chip and is not added as a
//! filter here, it falls out of the model.
//!
//! Laws (datasheet table, recomputed): `td[ms] = 11.46 * R[kOhm] + 29.70`, `fck[MHz] = 683.21 / td[ms]`,
//! `f_bit = fck / 15.5`. A time change switches the clock, it does not interpolate: what is already in the memory
//! is read at the new rate and changes pitch.
//!
//! DECISION: plain delta modulation with a leaky integrator of constant slope (the measured slew limit,
//! 0.008 V/us with 100 nF), no adaptive step and no compander.

/// Memory length in bits.
pub const BITS: usize = 44_000;
/// Bit rate in Hz for a delay of 1 ms (683.21 MHz*ms / 15.5).
pub const BITRATE_MAL_MS: f64 = 683.21e6 / 15.5;
/// Slope of the integrators in volts per second (chip level).
pub const FLANKE_V_PRO_S: f64 = 8000.0;
/// Corner of the integrator leak in Hz.
pub const LECK_HZ: f64 = 339.0;
/// DECISION: the surrounding circuit feeds the chip at 0.7 of the channel level (1.46 V becomes about 1 V peak).
pub const CHIP_PEGEL: f64 = 0.7;
/// DECISION: the input amplifier of the chip saturates at this level (chip volts, half the 5 V supply swing).
pub const EINGANG_GRENZE_V: f64 = 1.25;
/// Constants of the timing law.
pub const ZEIT_SOCKEL_MS: f64 = 29.70;
/// Limits of the effective delay time after the control voltage.
pub const ZEIT_UNTEN_MS: f64 = 31.0;
pub const ZEIT_OBEN_MS: f64 = 3000.0;
/// At most this many clock ticks per loop sample (guards the work per sample; reached only below 31 ms).
const TICKS_MAX: usize = 64;

/// The time CV scales the timing resistance by `oktaven`, the socket of 29.7 ms stays.
#[inline]
pub fn zeit_mit_cv(zeit_ms: f64, oktaven: f64) -> f64 {
    if oktaven == 0.0 {
        return zeit_ms;
    }
    (ZEIT_SOCKEL_MS + (zeit_ms - ZEIT_SOCKEL_MS) * (oktaven * std::f64::consts::LN_2).exp()).clamp(ZEIT_UNTEN_MS, ZEIT_OBEN_MS)
}

/// Bit rate in Hz for a delay time in ms.
#[inline]
pub fn bitrate(zeit_ms: f64) -> f64 {
    BITRATE_MAL_MS / zeit_ms
}

/// Second-order low-pass (RBJ), transposed direct form II.
#[derive(Clone, Copy, Debug, Default)]
struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Biquad {
    fn tiefpass(fc: f64, q: f64, fs: f64) -> Self {
        let w = 2.0 * std::f64::consts::PI * (fc / fs).min(0.45);
        let (s, c) = w.sin_cos();
        let alpha = s / (2.0 * q);
        let a0 = 1.0 + alpha;
        Biquad { b0: (1.0 - c) / 2.0 / a0, b1: (1.0 - c) / a0, b2: (1.0 - c) / 2.0 / a0, a1: -2.0 * c / a0, a2: (1.0 - alpha) / a0, z1: 0.0, z2: 0.0 }
    }
    #[inline]
    fn verarbeite(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
    fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

pub struct Chip {
    fs: f64,
    speicher: Box<[u8]>,
    pos: usize,
    /// Fraction of a clock tick carried to the next sample.
    phase: f64,
    /// Integrator of the modulator (its estimate of the input) and of the demodulator.
    enc: f64,
    dec: f64,
    x_alt: f64,
    /// Input filter: second order 8.8 kHz Q 0.9 plus one pole. Output: second order 8.9 kHz Q 1.1 plus RC 5.9 kHz.
    ein: Biquad,
    ein_pol: f64,
    a_ein: f64,
    aus: Biquad,
    aus_pol: f64,
    a_aus: f64,
}

impl Chip {
    pub fn neu(fs: f64) -> Self {
        let pol = |fc: f64| 1.0 - (-2.0 * std::f64::consts::PI * fc / fs).exp();
        let mut c = Chip {
            fs,
            speicher: vec![0u8; BITS].into_boxed_slice(),
            pos: 0,
            phase: 0.0,
            enc: 0.0,
            dec: 0.0,
            x_alt: 0.0,
            ein: Biquad::tiefpass(8800.0, 0.9, fs),
            ein_pol: 0.0,
            a_ein: pol(8800.0),
            aus: Biquad::tiefpass(8900.0, 1.1, fs),
            aus_pol: 0.0,
            a_aus: pol(5900.0),
        };
        c.leeren();
        c
    }

    /// Empties the memory. "Empty" is the idle pattern 0101: all zeros would be a full-scale negative ramp.
    pub fn leeren(&mut self) {
        for (i, b) in self.speicher.iter_mut().enumerate() {
            *b = (i & 1) as u8;
        }
        self.pos = 0;
        self.phase = 0.0;
        self.enc = 0.0;
        self.dec = 0.0;
        self.x_alt = 0.0;
        self.ein.reset();
        self.aus.reset();
        self.ein_pol = 0.0;
        self.aus_pol = 0.0;
    }

    /// One loop sample through the delay, `zeit_ms` is the delay time now.
    #[inline]
    pub fn verarbeite(&mut self, x: f64, zeit_ms: f64) -> f64 {
        // input: band limit, then the saturating input amplifier
        self.ein_pol += self.a_ein * (self.ein.verarbeite(x * CHIP_PEGEL) - self.ein_pol);
        let v = crate::begrenze(self.ein_pol, EINGANG_GRENZE_V);

        let f_bit = bitrate(zeit_ms);
        let schritt = FLANKE_V_PRO_S / f_bit;
        let leck = (1.0 - 2.0 * std::f64::consts::PI * LECK_HZ / f_bit).max(0.0);
        self.phase += f_bit / self.fs;
        let n = (self.phase as usize).min(TICKS_MAX);
        self.phase -= self.phase.floor();
        let roh = if n == 0 {
            self.dec // zero-order hold between two ticks
        } else {
            let mut summe = 0.0;
            let d = (v - self.x_alt) / n as f64;
            let mut xi = self.x_alt;
            for _ in 0..n {
                xi += d;
                let bit = xi > self.enc;
                self.enc = self.enc * leck + if bit { schritt } else { -schritt };
                let alt = self.speicher[self.pos];
                self.speicher[self.pos] = bit as u8;
                self.pos += 1;
                if self.pos == BITS {
                    self.pos = 0;
                }
                self.dec = self.dec * leck + if alt == 1 { schritt } else { -schritt };
                summe += self.dec;
            }
            summe / n as f64
        };
        self.x_alt = v;
        // reconstruction
        self.aus_pol += self.a_aus * (self.aus.verarbeite(roh) - self.aus_pol);
        self.aus_pol / CHIP_PEGEL
    }
}
