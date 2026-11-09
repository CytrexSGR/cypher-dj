//! Granular engine (type 36, `granular`): short windowed grains of a generated source, per voice.
//!
//! **Sources** (`quelle`, no sample files):
//! - 0 `wavetable`: the band-limited tables of the wavetable oscillator (`wavetable::Tabelle`, value `tabelle`). A grain
//!   plays one frame position (`pos` morphs over the frames) at `hz * pitch` from a random start phase, at the mip level
//!   its own frequency needs, so it is as alias free as the oscillator.
//! - 1 `puffer`: a ring buffer of `puffer` seconds that records the input `x` (summed over the voices, like a sum point).
//!   `pos` 0 is the newest sample, 1 the oldest (until the buffer is full: the oldest recorded so far). A grain reads at
//!   the rate `hz / grund * pitch` (4-point Hermite).
//! - 2 `rauschen`: the same ring buffer, written by an internal white noise generator (seeded by `saat`) instead of `x`.
//!
//! **Grains.** Each voice owns a fixed pool of `MAX_KOERNER` grains (no allocation). A grain is started every
//! `1 / dichte` seconds while `gate` is high and `hz > 0`; `streuung` (0..1) spreads the interval by up to +-100 % with a
//! uniform factor of mean 1, so the count still matches the density. A start finds a free grain or is dropped
//! (`verworfen`): a sounding grain is never cut, so a full pool cannot click. A rising `trig` starts a grain at once.
//! At its start a grain fixes its length (`groesse` ms), position (`pos + pos_zufall * u`), pitch (`tonhoehe` semitones
//! plus `ton_zufall * u` cent), pan (`breite * u`, equal power, centre gain 1 on both sides) and gain
//! `1 / sqrt(max(1, dichte * groesse))`, so dense clouds of incoherent grains keep the level of one grain stream; `u` are
//! uniform in -1..1 from a xorshift32 per voice, seeded by `saat` and the voice number (the same graph always plays the
//! same).
//!
//! **Window.** A Tukey window: raised cosine edges of `rand = (0.5 - 0.45 * fenster) * length` samples each (at least
//! 1 ms or half the grain), flat in between. `fenster` 0 is a Hann window, 1 a nearly rectangular grain with 5 % edges.
//! The first sample of a grain is exactly 0 and the edges have no jump in value or slope.
//!
//! **Freeze** (`frieren` > 0.5): the ring buffer stops being written (sources 1 and 2, read from voice 0 like a sum
//! point), so the grains keep reading the frozen content; for the wavetable source each voice holds the position it had
//! when the freeze began.
//!
//! **Buffer seams.** A grain's start offset is clamped so that it neither overtakes the write head (pitch above 1) nor
//! falls behind the oldest sample (pitch below 1) during its whole length.
//!
//! **Real time.** `Stimme::prozess` and `Material::schreibe` do not allocate, lock or panic (ring indices are masked,
//! pool indices are bounded); every input is checked for being finite and clamped; recorded samples below 1e-30 are
//! written as 0, and no state decays toward zero, so no subnormals arise.
use crate::wavetable::Tabelle;

/// Grains per voice.
pub const MAX_KOERNER: usize = 16;
/// Names of the sources, index = value `quelle`.
pub const QUELLEN: [&str; 3] = ["wavetable", "puffer", "rauschen"];
/// Grain length range in ms.
pub const GROESSE_MIN_MS: f32 = 1.0;
pub const GROESSE_MAX_MS: f32 = 2000.0;
/// Highest density in grains per second.
pub const MAX_DICHTE: f32 = 1000.0;
/// Pitch range in semitones and largest pitch jitter in cent.
pub const MAX_TONHOEHE: f32 = 48.0;
pub const MAX_TON_ZUFALL: f32 = 1200.0;
/// Ring buffer length range in seconds.
pub const PUFFER_MIN_S: f32 = 0.05;
pub const PUFFER_MAX_S: f32 = 10.0;
/// Highest read rate of the buffer sources (4 octaves up).
pub const MAX_RATE: f64 = 16.0;
/// Shortest window edge: 1 ms (or half the grain).
const RAND_MIN_S: f32 = 0.001;
/// Distance kept from the write head and from the oldest sample (the Hermite read needs n - 1 ..= n + 2).
const ABSTAND: f64 = 4.0;
const RAMPE_N: usize = 1024;

/// Fixed values of a granular node.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Einstellung {
    /// 0 wavetable, 1 puffer, 2 rauschen
    pub quelle: usize,
    /// reference pitch of the buffer sources: `hz == grund` reads at rate 1
    pub grund: f32,
    /// spread of the start interval, 0..1
    pub streuung: f32,
    pub saat: u32,
}

/// Inputs of one voice for one sample.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Eingabe {
    pub hz: f32,
    pub trig: f32,
    pub gate: f32,
    /// grain length in ms
    pub groesse: f32,
    /// grains per second
    pub dichte: f32,
    /// 0..1
    pub pos: f32,
    /// 0..1
    pub pos_zufall: f32,
    /// semitones
    pub tonhoehe: f32,
    /// cent
    pub ton_zufall: f32,
    /// 0..1
    pub breite: f32,
    /// 0 Hann .. 1 nearly rectangular
    pub fenster: f32,
    pub frieren: f32,
}

impl Default for Eingabe {
    fn default() -> Self {
        Eingabe { hz: 261.6256, trig: 0.0, gate: 1.0, groesse: 80.0, dichte: 20.0, pos: 0.0, pos_zufall: 0.0, tonhoehe: 0.0, ton_zufall: 0.0, breite: 0.0, fenster: 0.0, frieren: 0.0 }
    }
}

/// What the grains of a node read: the wavetable, or the ring buffer (recorded input or noise). Shared by all voices.
pub struct Material {
    quelle: usize,
    tabelle: Option<Box<Tabelle>>,
    puffer: Box<[f32]>,
    maske: usize,
    /// usable length in samples (the requested `puffer` seconds, at most the ring length)
    nutzbar: f64,
    /// samples written; the newest sample sits at `kopf - 1`
    kopf: u64,
    gefroren: bool,
    rauschen: u32,
    rauschen_start: u32,
    /// raised cosine 0..1 over RAMPE_N steps, plus one guard entry
    rampe: [f32; RAMPE_N + 2],
}

#[inline]
fn endlich(x: f32, sonst: f32) -> f32 { if x.is_finite() { x } else { sonst } }

#[inline]
fn xorshift(z: &mut u32) -> u32 {
    let mut x = *z;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *z = x;
    x
}

/// Uniform in -1..1.
#[inline]
fn bipolar(z: u32) -> f32 { (z >> 8) as f32 * (2.0 / 16_777_216.0) - 1.0 }

impl Material {
    /// Builds the source of a node. Allocates (table or ring buffer); call it at translation, never in the audio path.
    pub fn neu(e: &Einstellung, tabelle: usize, puffer_s: f32, sr: f32) -> Material {
        let quelle = e.quelle.min(QUELLEN.len() - 1);
        let (tabelle, puffer, nutzbar) = if quelle == 0 {
            (Some(Box::new(Tabelle::neu(tabelle))), vec![0.0f32; 1].into_boxed_slice(), 1.0)
        } else {
            let n = (puffer_s.clamp(PUFFER_MIN_S, PUFFER_MAX_S) * sr).ceil().max(16.0) as usize;
            (None, vec![0.0f32; (n + 8).next_power_of_two()].into_boxed_slice(), n as f64)
        };
        let s = 0x6A09_E667u32 ^ e.saat.wrapping_mul(0x9E37_79B9);
        let start = if s == 0 { 0x2545_F491 } else { s };
        let mut m = Material {
            quelle,
            tabelle,
            maske: puffer.len() - 1,
            puffer,
            nutzbar,
            kopf: 0,
            gefroren: false,
            rauschen: start,
            rauschen_start: start,
            rampe: std::array::from_fn(|j| {
                let u = (j.min(RAMPE_N) as f64) / RAMPE_N as f64;
                (0.5 - 0.5 * (std::f64::consts::PI * u).cos()) as f32
            }),
        };
        m.zuruecksetzen();
        m
    }

    /// Back to the state after `neu`: buffer empty (or filled with the same noise), head at 0. Does not allocate.
    pub fn zuruecksetzen(&mut self) {
        self.kopf = 0;
        self.gefroren = false;
        self.rauschen = self.rauschen_start;
        if self.quelle == 2 {
            // filled from the start, so grains find noise at every position from the first note on
            for v in self.puffer.iter_mut() {
                *v = bipolar(xorshift(&mut self.rauschen));
            }
        } else {
            self.puffer.iter_mut().for_each(|v| *v = 0.0);
        }
    }

    pub fn quelle(&self) -> usize { self.quelle }

    /// Bytes held by the table or the ring buffer.
    pub fn bytes(&self) -> usize { self.puffer.len() * 4 + self.tabelle.as_ref().map_or(0, |t| t.bytes()) }

    /// One sample of the node's input (sum over the voices) and the freeze state; runs once per sample before the voices.
    #[inline]
    pub fn schreibe(&mut self, x: f32, frieren: bool) {
        self.gefroren = frieren;
        if self.quelle == 0 || frieren {
            return;
        }
        let v = if self.quelle == 2 {
            bipolar(xorshift(&mut self.rauschen))
        } else {
            let x = endlich(x, 0.0).clamp(-8.0, 8.0);
            if x.abs() < 1e-30 { 0.0 } else { x }
        };
        self.puffer[(self.kopf as usize) & self.maske] = v;
        self.kopf = self.kopf.wrapping_add(1);
    }

    /// Ring buffer at the absolute position `p` (samples since the start; may be negative early on), 4-point Hermite.
    #[inline]
    fn lese_puffer(&self, p: f64) -> f32 {
        let i = p.floor();
        let f = (p - i) as f32;
        let i = i as i64;
        let m = self.maske;
        let d = &self.puffer;
        let y0 = d[(i.wrapping_sub(1) as usize) & m];
        let y1 = d[(i as usize) & m];
        let y2 = d[(i.wrapping_add(1) as usize) & m];
        let y3 = d[(i.wrapping_add(2) as usize) & m];
        let c1 = 0.5 * (y2 - y0);
        let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
        let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        ((c3 * f + c2) * f + c1) * f + y1
    }

    /// Raised cosine at `u` in 0..1 (linear between table entries).
    #[inline]
    fn rampe(&self, u: f32) -> f32 {
        let x = u.clamp(0.0, 1.0) * RAMPE_N as f32;
        let i = (x as usize).min(RAMPE_N);
        let a = self.rampe[i];
        a + (self.rampe[i + 1] - a) * (x - i as f32)
    }
}

/// One grain. `rest == 0` marks a free slot.
#[derive(Clone, Copy, Debug, Default)]
struct Korn {
    rest: u32,
    alter: u32,
    laenge: u32,
    rand: f32,
    inv_rand: f32,
    gl: f32,
    gr: f32,
    // wavetable source
    phase: u32,
    inc: u32,
    stufe: usize,
    frame: f32,
    // buffer sources
    lese: f64,
    rate: f64,
}

impl Korn {
    /// Window value of the current sample.
    #[inline]
    fn fenster(&self, m: &Material) -> f32 {
        let a = self.alter as f32;
        if a < self.rand {
            return m.rampe(a * self.inv_rand);
        }
        let b = (self.laenge - self.alter) as f32;
        if b < self.rand { m.rampe(b * self.inv_rand) } else { 1.0 }
    }
}

/// State of one voice: its grain pool and start clock.
#[derive(Clone, Copy, Debug)]
pub struct Stimme {
    k: [Korn; MAX_KOERNER],
    /// start clock: grows by `dichte / sr` per sample, a grain starts when it reaches `ziel`
    takt: f64,
    ziel: f64,
    zufall: u32,
    pos_halt: f32,
    gefroren: bool,
    /// grains started and grains dropped for want of a free slot (diagnosis, tests)
    pub gestartet: u64,
    pub verworfen: u64,
}

impl Stimme {
    /// Fresh voice `stimme` of a node with seed `e.saat`.
    pub fn neu(stimme: usize, e: &Einstellung) -> Stimme {
        let s = 0x9E37_79B9u32 ^ (stimme as u32 + 1).wrapping_mul(0x85EB_CA6B) ^ e.saat.wrapping_mul(0xC2B2_AE35);
        Stimme {
            k: [Korn::default(); MAX_KOERNER],
            takt: 1.0,
            ziel: 1.0,
            zufall: if s == 0 { 0x2545_F491 } else { s },
            pos_halt: 0.0,
            gefroren: false,
            gestartet: 0,
            verworfen: 0,
        }
    }

    /// Grains sounding now.
    pub fn aktive(&self) -> usize { self.k.iter().filter(|g| g.rest > 0).count() }

    #[inline]
    fn zahl(&mut self) -> u32 { xorshift(&mut self.zufall) }

    /// Starts a grain (or drops it when the pool is full). The random numbers are drawn first, so the sequence does not
    /// depend on the pool state.
    #[inline]
    fn starte(&mut self, m: &Material, e: &Einstellung, sr: f32, x: &Eingabe, pos: f32) {
        let (u_pos, u_ton, u_pan, phase) = (bipolar(self.zahl()), bipolar(self.zahl()), bipolar(self.zahl()), self.zahl());
        let Some(g) = self.k.iter_mut().find(|g| g.rest == 0) else {
            self.verworfen += 1;
            return;
        };
        self.gestartet += 1;
        let groesse = endlich(x.groesse, GROESSE_MIN_MS).clamp(GROESSE_MIN_MS, GROESSE_MAX_MS);
        let laenge = ((groesse * 0.001 * sr).round() as u32).max(2);
        let fenster = endlich(x.fenster, 0.0).clamp(0.0, 1.0);
        let halb = 0.5 * laenge as f32;
        let rand = ((0.5 - 0.45 * fenster) * laenge as f32).max((RAND_MIN_S * sr).min(halb)).min(halb);
        let cent = endlich(x.tonhoehe, 0.0).clamp(-MAX_TONHOEHE, MAX_TONHOEHE) as f64 * 100.0
            + (endlich(x.ton_zufall, 0.0).clamp(0.0, MAX_TON_ZUFALL) * u_ton) as f64;
        let verhaeltnis = (cent / 1200.0).exp2();
        let pan = endlich(x.breite, 0.0).clamp(0.0, 1.0) * u_pan;
        let w = std::f32::consts::FRAC_PI_4 * (1.0 + pan);
        let dichte = endlich(x.dichte, 0.0).clamp(0.0, MAX_DICHTE);
        let pegel = 1.0 / (dichte * groesse * 0.001).max(1.0).sqrt();
        let p = (pos + endlich(x.pos_zufall, 0.0).clamp(0.0, 1.0) * u_pos).clamp(0.0, 1.0);
        let hz = x.hz as f64;
        *g = Korn {
            rest: laenge,
            alter: 0,
            laenge,
            rand,
            inv_rand: 1.0 / rand,
            gl: std::f32::consts::SQRT_2 * w.cos() * pegel,
            gr: std::f32::consts::SQRT_2 * w.sin() * pegel,
            ..Korn::default()
        };
        if let Some(t) = &m.tabelle {
            let inc = (hz * verhaeltnis / sr as f64).clamp(0.0, 0.5);
            g.inc = (inc * 4_294_967_296.0) as u32;
            g.stufe = t.stufe(inc as f32, sr);
            g.phase = phase;
            g.frame = p * (t.frames - 1) as f32;
        } else {
            let r = (hz / e.grund as f64 * verhaeltnis).clamp(0.0, MAX_RATE);
            let l = laenge as f64;
            // a recording buffer that is not full yet spans what was recorded so far: pos 1 is the oldest recorded sample
            let n = if m.quelle == 1 { m.nutzbar.min(m.kopf as f64) } else { m.nutzbar };
            // offset behind the newest sample over the grain: d(t) = d0 + (1 - r) t live, d0 - r t frozen; keep it in
            // ABSTAND ..= n - ABSTAND for the whole grain
            let (unten, oben) = if m.gefroren {
                (ABSTAND + r * l, n - ABSTAND)
            } else {
                (ABSTAND + ((r - 1.0) * l).max(0.0), n - ABSTAND - ((1.0 - r) * l).max(0.0))
            };
            let d0 = if unten > oben { unten.min(n - ABSTAND) } else { (p as f64 * n).clamp(unten, oben) };
            g.lese = m.kopf as f64 - 1.0 - d0;
            g.rate = r;
        }
    }

    /// One sample of this voice: (left, right).
    #[inline]
    pub fn prozess(&mut self, m: &Material, e: &Einstellung, sr: f32, x: Eingabe) -> (f32, f32) {
        let pos_ein = endlich(x.pos, 0.0).clamp(0.0, 1.0);
        let frieren = x.frieren > 0.5;
        if frieren && !self.gefroren {
            self.pos_halt = pos_ein;
        }
        self.gefroren = frieren;
        // the wavetable source holds its position while frozen; the buffer sources freeze their content instead
        let pos = if frieren && m.quelle == 0 { self.pos_halt } else { pos_ein };
        if x.trig > 0.5 {
            self.takt = self.ziel;
        }
        let dichte = endlich(x.dichte, 0.0).clamp(0.0, MAX_DICHTE);
        if x.gate > 0.5 && x.hz > 0.0 && x.hz.is_finite() && dichte > 0.0 {
            if self.takt >= self.ziel {
                self.takt -= self.ziel;
                self.ziel = 1.0 + (e.streuung.clamp(0.0, 1.0) * bipolar(self.zahl())) as f64;
                self.starte(m, e, sr, &x, pos);
            }
            self.takt += dichte as f64 / sr as f64;
        } else {
            // the next grain starts as soon as the voice is active again
            self.takt = self.ziel;
        }
        let (mut l, mut r) = (0.0f32, 0.0f32);
        if let Some(t) = &m.tabelle {
            for g in self.k.iter_mut().filter(|g| g.rest > 0) {
                let y = t.lese(g.stufe, g.phase, g.frame) * g.fenster(m);
                g.phase = g.phase.wrapping_add(g.inc);
                g.alter += 1;
                g.rest -= 1;
                l += y * g.gl;
                r += y * g.gr;
            }
        } else {
            for g in self.k.iter_mut().filter(|g| g.rest > 0) {
                let y = m.lese_puffer(g.lese) * g.fenster(m);
                g.lese += g.rate;
                g.alter += 1;
                g.rest -= 1;
                l += y * g.gl;
                r += y * g.gr;
            }
        }
        (l, r)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn einstellung(quelle: usize) -> Einstellung { Einstellung { quelle, grund: 261.6256, streuung: 0.0, saat: 0 } }

    /// Runs one voice for `n` samples and returns (started, dropped, largest number of sounding grains).
    fn zaehle(quelle: usize, sr: f32, x: Eingabe, streuung: f32, n: usize) -> (u64, u64, usize) {
        let e = Einstellung { streuung, ..einstellung(quelle) };
        let mut m = Material::neu(&e, 3, 1.0, sr);
        let mut v = Stimme::neu(0, &e);
        let mut spitze = 0;
        for _ in 0..n {
            m.schreibe(0.0, false);
            v.prozess(&m, &e, sr, x);
            spitze = spitze.max(v.aktive());
        }
        (v.gestartet, v.verworfen, spitze)
    }

    #[test]
    fn kornzahl_folgt_der_dichte() {
        // regular starts: in n samples exactly floor((n - 1) * dichte / sr) + 1 starts (the first at sample 0); with an
        // overlap below the pool none is dropped
        for (sr, dichte, groesse) in [(48_000.0, 20.0, 80.0), (44_100.0, 1000.0, 5.0), (48_000.0, 7.3, 1000.0), (96_000.0, 333.0, 30.0), (44_100.0, 0.5, 100.0)] {
            let n = 3 * sr as usize;
            let x = Eingabe { dichte, groesse, ..Eingabe::default() };
            let (start, weg, spitze) = zaehle(1, sr, x, 0.0, n);
            let soll = ((n - 1) as f64 * dichte as f64 / sr as f64).floor() as u64 + 1;
            println!("MESS grain count sr {sr} density {dichte}/s size {groesse} ms over 3 s: {start} started (expected {soll}), {weg} dropped, peak {spitze} sounding");
            assert_eq!(start + weg, soll, "sr {sr} density {dichte}");
            assert_eq!(weg, 0, "overlap {} below the pool, nothing may be dropped", dichte * groesse / 1000.0);
            assert!(spitze <= (dichte * groesse / 1000.0).ceil() as usize + 1);
        }
    }

    #[test]
    fn kornzahl_mit_streuung_im_mittel() {
        // spread intervals keep the mean: 50/s over 20 s with streuung 0.8 gives 1000 starts within 5 %
        let x = Eingabe { dichte: 50.0, groesse: 20.0, ..Eingabe::default() };
        let (start, weg, _) = zaehle(2, SR, x, 0.8, 20 * SR as usize);
        println!("MESS grain count with streuung 0.8, 50/s over 20 s: {}", start + weg);
        assert!(((start + weg) as f64 - 1000.0).abs() <= 50.0, "{} starts, expected 1000 +- 50", start + weg);
    }

    #[test]
    fn voller_pool_verwirft_und_bleibt_begrenzt() {
        // overlap 400/s * 0.1 s = 40 > 16: the pool is full all the time, every start is either a grain or a drop
        let x = Eingabe { dichte: 400.0, groesse: 100.0, ..Eingabe::default() };
        let n = 2 * SR as usize;
        let (start, weg, spitze) = zaehle(0, SR, x, 0.0, n);
        let soll = ((n - 1) as f64 * 400.0 / SR as f64).floor() as u64 + 1;
        println!("MESS full pool: {start} started, {weg} dropped of {soll}, peak {spitze}");
        assert_eq!(start + weg, soll);
        assert_eq!(spitze, MAX_KOERNER);
        assert!(weg > 0);
    }

    #[test]
    fn fenster_beginnt_bei_null_und_ist_symmetrisch() {
        let e = einstellung(0);
        let m = Material::neu(&e, 3, 1.0, SR);
        for (laenge, rand) in [(4800u32, 2400.0f32), (4800, 240.0), (96, 48.0)] {
            let mut g = Korn { laenge, rest: laenge, rand, inv_rand: 1.0 / rand, ..Korn::default() };
            let w: Vec<f32> = (0..laenge).map(|a| { g.alter = a; g.fenster(&m) }).collect();
            assert_eq!(w[0], 0.0, "first sample must be 0");
            for a in 1..laenge as usize {
                // w(a) = w(laenge - a): the window is symmetric around laenge / 2
                assert!((w[a] - w[laenge as usize - a]).abs() < 1e-6, "asymmetric at {a}");
            }
            let mitte = w[laenge as usize / 2];
            assert!((mitte - 1.0).abs() < 1e-6, "centre {mitte}");
            // the raised cosine of the table against the formula
            for a in 0..rand as usize {
                let soll = 0.5 - 0.5 * (std::f64::consts::PI * a as f64 / rand as f64).cos();
                assert!((w[a] as f64 - soll).abs() < 3e-6, "edge sample {a}: {} vs {soll}", w[a]);
            }
        }
    }

    #[test]
    fn rauschen_und_puffer_ohne_subnormale() {
        let e = einstellung(1);
        let mut m = Material::neu(&e, 0, 0.1, SR);
        // 1e-39 is a subnormal f32, 1e-33 a normal value below the flush threshold
        for i in 0..10_000 {
            m.schreibe([1e-39, -1e-39, 1e-33, 0.0][i % 4], false);
        }
        assert!(m.puffer.iter().all(|v| *v == 0.0 || v.is_normal()), "a subnormal was recorded");
        m.schreibe(f32::NAN, false);
        m.schreibe(f32::INFINITY, false);
        assert!(m.puffer.iter().all(|v| v.is_finite() && v.abs() <= 8.0));
    }

    #[test]
    fn hermite_zwischen_den_stuetzstellen() {
        // a 2 kHz sine read at fractional positions: Catmull-Rom is off by at most 2.9e-4 there (linear: 8.5e-3)
        let e = einstellung(1);
        let mut m = Material::neu(&e, 0, 0.1, SR);
        let w = 2.0 * std::f64::consts::PI * 2000.0 / SR as f64;
        for i in 0..1000 {
            m.schreibe((w * i as f64).sin() as f32, false);
        }
        let mut schlimmst = 0.0f64;
        for k in 10..990 {
            let p = k as f64 + (k as f64 * 0.618_034).fract();
            schlimmst = schlimmst.max((m.lese_puffer(p) as f64 - (w * p).sin()).abs());
        }
        println!("MESS Hermite read of a 2 kHz sine between samples: largest error {schlimmst:.2e}");
        assert!(schlimmst < 5e-4, "interpolation error {schlimmst}");
    }

    #[test]
    fn hermite_trifft_stuetzstellen() {
        let e = einstellung(1);
        let mut m = Material::neu(&e, 0, 0.1, SR);
        for i in 0..1000 {
            m.schreibe((i as f32 * 0.01).sin(), false);
        }
        for i in 10..990 {
            assert_eq!(m.lese_puffer(i as f64), (i as f32 * 0.01).sin());
        }
    }
}
