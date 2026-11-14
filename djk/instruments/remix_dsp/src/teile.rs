//! Small parts the sections share: state-variable filter, crossover, delay memory, smoother, noise, soft limit.

use std::f64::consts::PI;

/// State-variable filter (trapezoidal integrators). `tick` returns low-pass, band-pass and high-pass at once.
#[derive(Clone, Copy, Debug)]
pub struct Svf {
    k: f32,
    a1: f32,
    a2: f32,
    a3: f32,
    ic1: f32,
    ic2: f32,
}

impl Default for Svf {
    fn default() -> Self {
        let mut s = Svf { k: 1.0, a1: 0.0, a2: 0.0, a3: 0.0, ic1: 0.0, ic2: 0.0 };
        s.setze(1000.0, 0.7071, 48000.0);
        s
    }
}

impl Svf {
    pub fn setze(&mut self, hz: f64, q: f64, sr: f64) {
        let g = (PI * hz.clamp(10.0, 0.45 * sr) / sr).tan();
        let k = 1.0 / q.max(0.05);
        let a1 = 1.0 / (1.0 + g * (g + k));
        self.k = k as f32;
        self.a1 = a1 as f32;
        self.a2 = (g * a1) as f32;
        self.a3 = (g * g * a1) as f32;
    }

    /// (low-pass, band-pass, high-pass). The band-pass peaks at `q`; multiply by `k()` for unity gain at the centre.
    #[inline]
    pub fn tick(&mut self, x: f32) -> (f32, f32, f32) {
        let v3 = x - self.ic2;
        let v1 = self.a1 * self.ic1 + self.a2 * v3;
        let v2 = self.ic2 + self.a2 * self.ic1 + self.a3 * v3;
        self.ic1 = 2.0 * v1 - self.ic1;
        self.ic2 = 2.0 * v2 - self.ic2;
        (v2, v1, x - self.k * v1 - v2)
    }

    #[inline]
    pub fn k(&self) -> f32 {
        self.k
    }

    pub fn leeren(&mut self) {
        self.ic1 = 0.0;
        self.ic2 = 0.0;
    }
}

/// Fourth-order Linkwitz-Riley split of one channel: low and high sum to an all-pass of the input.
#[derive(Clone, Copy, Debug, Default)]
pub struct Weiche {
    a: Svf,
    tief: Svf,
    hoch: Svf,
}

impl Weiche {
    pub fn setze(&mut self, hz: f64, sr: f64) {
        self.a.setze(hz, std::f64::consts::FRAC_1_SQRT_2, sr);
        self.tief = Svf { ic1: self.tief.ic1, ic2: self.tief.ic2, ..self.a };
        self.hoch = Svf { ic1: self.hoch.ic1, ic2: self.hoch.ic2, ..self.a };
    }

    /// (low, high)
    #[inline]
    pub fn tick(&mut self, x: f32) -> (f32, f32) {
        let (lp, _, hp) = self.a.tick(x);
        (self.tief.tick(lp).0, self.hoch.tick(hp).2)
    }

    pub fn leeren(&mut self) {
        self.a.leeren();
        self.tief.leeren();
        self.hoch.leeren();
    }
}

/// Delay memory of one channel. Allocated once; `lies*` take the distance back from the newest sample (1 = the
/// sample written by the last `schreibe`).
#[derive(Clone, Debug)]
pub struct Ring {
    puffer: Vec<f32>,
    pos: usize,
    /// Samples written since the last `vergiss` (capped at the length): older content reads as silence.
    gueltig: usize,
}

impl Ring {
    pub fn neu(laenge: usize) -> Self {
        Ring { puffer: vec![0.0; laenge.max(4)], pos: 0, gueltig: 0 }
    }

    #[inline]
    pub fn laenge(&self) -> usize {
        self.puffer.len()
    }

    #[inline]
    pub fn schreibe(&mut self, x: f32) {
        self.puffer[self.pos] = x;
        self.pos += 1;
        if self.pos == self.puffer.len() {
            self.pos = 0;
        }
        if self.gueltig < self.puffer.len() {
            self.gueltig += 1;
        }
    }

    #[inline]
    pub fn lies(&self, zurueck: usize) -> f32 {
        let n = self.puffer.len();
        let z = zurueck.clamp(1, n);
        if z > self.gueltig {
            return 0.0;
        }
        let i = if self.pos >= z { self.pos - z } else { self.pos + n - z };
        self.puffer[i]
    }

    /// Linear interpolation between the two neighbours of a fractional distance.
    #[inline]
    pub fn lies_bruch(&self, zurueck: f64) -> f32 {
        let n = self.puffer.len();
        let z = zurueck.clamp(1.0, (n - 1) as f64);
        let g = z.floor();
        let t = (z - g) as f32;
        let a = self.lies(g as usize);
        let b = self.lies(g as usize + 1);
        a + (b - a) * t
    }

    /// Empties the memory without touching it: everything written so far reads as silence from now on.
    pub fn vergiss(&mut self) {
        self.gueltig = 0;
    }
}

/// A recording that starts at a moment and is then read from its start (rolls). Allocated once.
#[derive(Clone, Debug)]
pub struct Aufnahme {
    puffer: Vec<f32>,
    /// Samples recorded since `starte`.
    pub n: usize,
}

impl Aufnahme {
    pub fn neu(laenge: usize) -> Self {
        Aufnahme { puffer: vec![0.0; laenge.max(4)], n: 0 }
    }

    pub fn starte(&mut self) {
        self.n = 0;
    }

    #[inline]
    pub fn nimm(&mut self, x: f32) {
        if self.n < self.puffer.len() {
            self.puffer[self.n] = x;
            self.n += 1;
        }
    }

    /// The sample at `pos` (fractional) counted from the start; positions that are not recorded yet read the newest.
    #[inline]
    pub fn lies(&self, pos: f64) -> f32 {
        if self.n == 0 {
            return 0.0;
        }
        let p = pos.clamp(0.0, (self.n - 1) as f64);
        let g = p.floor() as usize;
        let t = (p - g as f64) as f32;
        let a = self.puffer[g];
        let b = self.puffer[(g + 1).min(self.n - 1)];
        a + (b - a) * t
    }

    pub fn leeren(&mut self) {
        self.n = 0;
    }
}

/// One-pole glide towards a target.
#[derive(Clone, Copy, Debug)]
pub struct Glatt {
    pub wert: f32,
    a: f32,
}

impl Glatt {
    pub fn neu(sr: f64, ms: f64) -> Self {
        Glatt { wert: 0.0, a: (1.0 - (-1.0 / (ms * 0.001 * sr)).exp()) as f32 }
    }

    #[inline]
    pub fn zu(&mut self, ziel: f32) -> f32 {
        self.wert += (ziel - self.wert) * self.a;
        // land exactly, so a section that is off costs nothing and passes the input bit for bit
        if (ziel - self.wert).abs() < 1e-5 {
            self.wert = ziel;
        }
        self.wert
    }

    pub fn setze(&mut self, w: f32) {
        self.wert = w;
    }
}

/// White noise, uniform in -1..1 (xorshift).
#[derive(Clone, Copy, Debug)]
pub struct Rauschen(u32);

impl Rauschen {
    pub fn neu(saat: u32) -> Self {
        Rauschen(saat | 1)
    }

    #[inline]
    pub fn tick(&mut self) -> f32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        (x as i32) as f32 * (1.0 / 2147483648.0)
    }
}

/// Limit inside feedback loops: exact below full scale, bounded by 2 above it.
#[inline]
pub fn grenze(x: f32) -> f32 {
    let a = x.abs();
    if a <= 1.0 {
        x
    } else {
        x.signum() * (1.0 + (a - 1.0).tanh())
    }
}

/// Triangle in -1..1 from a phase in 0..1 (0 at phase 0, rising first).
#[inline]
pub fn dreieck(phase: f64) -> f32 {
    let p = phase.rem_euclid(1.0);
    (if p < 0.25 {
        4.0 * p
    } else if p < 0.75 {
        2.0 - 4.0 * p
    } else {
        4.0 * p - 4.0
    }) as f32
}

/// Logarithmic sweep from `a` to `b` for `t` in 0..1.
#[inline]
pub fn log_weg(a: f64, b: f64, t: f64) -> f64 {
    a * (b / a).powf(t.clamp(0.0, 1.0))
}

#[inline]
pub fn db(x: f64) -> f32 {
    10f64.powf(x / 20.0) as f32
}
