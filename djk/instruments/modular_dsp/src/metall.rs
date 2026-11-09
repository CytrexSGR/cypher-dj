//! Metallic oscillator bank for hi-hats and cymbals (type 33, `metall`). One voice per hit.
//!
//! **Source.** Six square oscillators at the inharmonic frequencies of the TR-808 cymbal and hi-hat circuit, 205.3,
//! 304.4, 369.6, 522.7, 540.0 and 800.0 Hz (the values measured from the circuit in K. J. Werner, J. S. Abel and
//! J. O. Smith, "The TR-808 cymbal: a physically-informed, circuit-bendable, digital model", ICMC/SMC 2014). Their
//! ratios (1, 1.483, 1.800, 2.546, 2.630, 3.897) share no small common period: the sum of the six squares has its
//! partials scattered densely above 2 kHz, which is the "metallic" part, and 522.7/540 beat at 17.3 Hz. `tune` scales
//! all six together (0.5..2). The sum is mixed with white noise (`rauschen`, equal power; the noise is scaled per band
//! so that both have the same level after the band-passes, `RAUSCH_BAND`).
//!
//! **Band limit.** Each square is naive plus a table BLEP: every edge adds, to the 32 samples around it, the residual
//! of the integrated band-limiting kernel (a windowed sinc, cut-off 0.48 sr, 32 samples, Kaiser window beta 8) minus the
//! unit step. The kernel passes the squares nearly flat to 18 kHz and attenuates everything above 28 kHz (at 48 kHz) by
//! about 80 dB, so the partials that fold back below 20 kHz are that far down. The integrated kernel is tabulated once
//! (256 points per sample, linear interpolation, error below -100 dB) and shared by all nodes. The price is a fixed delay
//! of the tone part by 16 samples (0.33 ms at 48 kHz). A 2-point polyBLEP measured -15 dB and a 4-point B-spline BLEP
//! -44 dB of alias energy in the 10.5 kHz band (`REPORT-metal.md`).
//!
//! **Filters.** Three band-passes (3.5, 7 and 10.5 kHz, Q 1.6, unity peak gain) in parallel; `farbe` 0..1 moves a
//! triangular weight over them (0 = only the low band, 0.5 = only the middle band, 1 = only the high band), then a
//! 2-pole Butterworth high-pass at `hp` Hz. The filters are the TPT stages of `svf.rs` (f64).
//!
//! **Envelope.** A `trig` (> 0.5) sets the envelope to `vel` (0..1); it then falls exponentially, `decay` being the
//! time to -60 dB (0.01..10 s). The envelope multiplies the filtered signal last, so a cut is a pure gain change.
//!
//! **Choke.** A choked voice falls to -60 dB within `schnitt` ms (1..100, default 8) on an exponential curve, so the
//! gain never steps (no click). A voice is choked by a rising edge on its `choke` input (> 0.5), and, with `gruppe` 1
//! (default), by a `trig` on any other voice of the same node: a new hat hit cuts the ringing open hat, as on the
//! classic machines where open and closed hat share one circuit.
//!
//! **Real time.** No allocation, lock or panic in `prozess_stimmen`; every input is checked for being finite and
//! clamped. Below -100 dB the envelope snaps to 0, the voice goes idle (filters and BLEP buffer cleared, nothing is
//! computed), so no state decays into subnormals.
use crate::programm::{Spur, MAX_STIMMEN};
use crate::svf::Stufe;

/// Oscillator frequencies at `tune` 1 (TR-808, see the module comment).
pub const FREQUENZEN: [f64; 6] = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];
/// Centres of the three band-passes in Hz.
pub const BAENDER: [f64; 3] = [3_500.0, 7_000.0, 10_500.0];
/// Damping of the band-passes (1/Q, Q = 1.6).
pub const BAND_K: f64 = 0.625;
pub const TUNE_MIN: f32 = 0.5;
pub const TUNE_MAX: f32 = 2.0;
pub const DECAY_MIN: f32 = 0.01;
pub const DECAY_MAX: f32 = 10.0;
pub const HP_MIN: f32 = 500.0;
pub const HP_MAX: f32 = 16_000.0;
pub const SCHNITT_MIN: f32 = 1.0;
pub const SCHNITT_MAX: f32 = 100.0;
/// Output gain: the default sound (farbe 0.5, rauschen 0.2, hp 6 kHz) peaks near 0.6 at `vel` 1.
pub const PEGEL: f32 = 2.0;
/// Noise gain per band: the squares at `tune` 1 have this level relative to uniform noise -1..1 behind each band-pass
/// (measured, `tests/metall.rs` `ton_und_rauschen_gleich_laut`).
pub const RAUSCH_BAND: [f32; 3] = [0.394, 0.219, 0.153];
/// Below this envelope value (-100 dB) the voice goes idle.
const STILL: f32 = 1e-5;
/// ln(0.001): an exponential that falls by this over a time falls by 60 dB.
const LN_60DB: f64 = -6.907_755_278_982_137;

/// Inputs in the order of `ARTEN` (`trig`, `vel`, `decay`, `tune`, `farbe`, `rauschen`, `hp`, `choke`).
pub const EIN: [&str; 8] = ["trig", "vel", "decay", "tune", "farbe", "rauschen", "hp", "choke"];

/// Support of the BLEP kernel in samples; the tone part is delayed by half of it.
pub const BLEP_BREITE: usize = 32;
/// Table points per sample.
const BLEP_PUNKTE: usize = 256;
/// Cut-off of the kernel as a fraction of the sample rate, and its Kaiser beta.
const BLEP_FC: f64 = 0.48;
const BLEP_BETA: f64 = 8.0;

fn i0(x: f64) -> f64 {
    // modified Bessel function of the first kind, order 0 (power series)
    let (mut s, mut t, y) = (1.0f64, 1.0f64, x * x / 4.0);
    for k in 1..60 {
        t *= y / (k * k) as f64;
        s += t;
    }
    s
}

/// The integrated kernel C(x) at x = -16 + i / 256, i = 0..=32 * 256: rises from 0 to 1 (normalised to exactly 1).
fn baue_blep() -> Box<[f32]> {
    let halb = (BLEP_BREITE / 2) as f64;
    let h = |t: f64| -> f64 {
        let u = t / halb;
        if u.abs() >= 1.0 {
            return 0.0;
        }
        let x = 2.0 * BLEP_FC * t;
        let sinc = if x == 0.0 { 1.0 } else { (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x) };
        sinc * i0(BLEP_BETA * (1.0 - u * u).sqrt())
    };
    let n = BLEP_BREITE * BLEP_PUNKTE;
    // Simpson on 8 sub-intervals per table step
    let fein = 8;
    let dx = 1.0 / (BLEP_PUNKTE * fein) as f64;
    let mut c = vec![0.0f64; n + 1];
    let mut summe = 0.0f64;
    for i in 0..n {
        for j in 0..fein {
            let a = -halb + (i * fein + j) as f64 * dx;
            summe += dx / 6.0 * (h(a) + 4.0 * h(a + 0.5 * dx) + h(a + dx));
        }
        c[i + 1] = summe;
    }
    c.iter().map(|v| (v / summe) as f32).collect()
}

/// The shared table (built on first use, at translation).
pub fn blep_tabelle() -> &'static [f32] {
    static T: std::sync::OnceLock<Box<[f32]>> = std::sync::OnceLock::new();
    T.get_or_init(baue_blep)
}

/// Phase steps (u32, one period = 2^32) of the six oscillators at `tune` and sample rate `sr`, each below Nyquist.
pub fn schritte(tune: f32, sr: f32) -> [u32; 6] {
    std::array::from_fn(|i| ((FREQUENZEN[i] * tune as f64 / sr as f64).clamp(0.0, 0.49) * 4_294_967_296.0) as u32)
}

const RING: usize = BLEP_BREITE;
const HALB: usize = BLEP_BREITE / 2;

/// The six band-limited squares, summed and scaled by 1/6 (so about -1..1), delayed by 16 samples.
#[derive(Clone, Copy)]
pub struct Bank {
    phase: [u32; 6],
    /// naive sum plus corrections for the samples n - 16 .. n + 15 (ring, `kopf` = slot of n - 16)
    ring: [f32; RING],
    kopf: usize,
}

impl Bank {
    pub fn neu(phase: [u32; 6]) -> Bank { Bank { phase, ring: [0.0; RING], kopf: 0 } }

    /// Clears the BLEP buffer (the phases stay).
    pub fn leeren(&mut self) { self.ring = [0.0; RING]; }

    /// Advances every oscillator by its step and returns the band-limited sum of sample n - 16. `t` is `blep_tabelle()`.
    #[inline]
    pub fn naechstes(&mut self, schritt: &[u32; 6], t: &[f32]) -> f32 {
        let k = self.kopf;
        let mut naiv = 0.0f32;
        for i in 0..6 {
            let s = schritt[i];
            let alt = self.phase[i];
            let neu = alt.wrapping_add(s);
            self.phase[i] = neu;
            naiv += if neu < 0x8000_0000 { 1.0 } else { -1.0 };
            if s == 0 {
                continue;
            }
            let inv = 1.0 / s as f64;
            // rising edge at the wrap (-1 -> +1), falling edge at half a period (+1 -> -1); d = samples since the edge
            if neu < alt {
                kante(&mut self.ring, k, t, neu as f64 * inv, 2.0);
            }
            if alt < 0x8000_0000 && neu >= 0x8000_0000 {
                kante(&mut self.ring, k, t, (neu - 0x8000_0000) as f64 * inv, -2.0);
            }
        }
        self.ring[(k + HALB) % RING] += naiv;
        let aus = self.ring[k];
        self.ring[k] = 0.0;
        self.kopf = (k + 1) % RING;
        aus * (1.0 / 6.0)
    }
}

/// Adds an edge of height `h` lying `d` (0..1) samples before sample n to the slots of n - 16 .. n + 15: slot j gets
/// h * (C(d - 16 + j) - step), the step being 1 for the samples at and after the edge (j >= 16).
#[inline]
fn kante(ring: &mut [f32; RING], k: usize, t: &[f32], d: f64, h: f32) {
    if t.len() != BLEP_BREITE * BLEP_PUNKTE + 1 {
        return;
    }
    let x = (d.clamp(0.0, 1.0) * BLEP_PUNKTE as f64).min((BLEP_PUNKTE - 1) as f64 + 0.999_999);
    let i0 = x as usize;
    let f = (x - i0 as f64) as f32;
    for j in 0..BLEP_BREITE {
        let i = i0 + j * BLEP_PUNKTE;
        let c = t[i] + (t[i + 1] - t[i]) * f;
        ring[(k + j) % RING] += h * if j >= HALB { c - 1.0 } else { c };
    }
}

/// Pre-warped gain of a TPT stage at `hz`, clamped below Nyquist.
#[inline]
fn g_von(hz: f64, sr: f32) -> f64 { (std::f64::consts::PI * hz.clamp(20.0, 0.45 * sr as f64) / sr as f64).tan() }

/// Three band-passes in parallel, weighted, then the high-pass.
#[derive(Clone, Copy, Default)]
pub struct Kette {
    band: [Stufe; 3],
    hoch: Stufe,
}

impl Kette {
    /// `w` the band weights, `g_band` the band gains, `g_hp` the high-pass gain.
    #[inline]
    pub fn prozess(&mut self, x: f32, w: &[f32; 3], g_band: &[f64; 3], g_hp: f64) -> f32 {
        let x = x as f64;
        let mut y = 0.0f64;
        for j in 0..3 {
            // the band output of the TPT stage peaks at 1/k; times k it has unity gain at the centre
            let b = self.band[j].prozess(x, g_band[j], BAND_K).1 * BAND_K;
            y += w[j] as f64 * b;
        }
        self.hoch.prozess(y, g_hp, std::f64::consts::SQRT_2).2 as f32
    }

    pub fn leeren(&mut self) { *self = Kette::default(); }
}

/// Band weights for `farbe` 0..1: a triangle of width one band moving over the three bands.
#[inline]
pub fn gewichte(farbe: f32) -> [f32; 3] {
    let p = 2.0 * farbe.clamp(0.0, 1.0);
    std::array::from_fn(|j| (1.0 - (p - j as f32).abs()).max(0.0))
}

/// Fixed values of a `metall` node and the coefficients that depend only on them and the sample rate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Einstellung {
    /// a trig on one voice chokes the other voices of the node
    pub gruppe: bool,
    /// choke time to -60 dB in ms
    pub schnitt_ms: f32,
    pub saat: u32,
    /// per-sample factor of the choke
    pub a_schnitt: f32,
    pub g_band: [f64; 3],
    blep: &'static [f32],
}

impl Einstellung {
    pub fn neu(gruppe: bool, schnitt_ms: f32, saat: u32, sr: f32) -> Einstellung {
        let schnitt_ms = schnitt_ms.clamp(SCHNITT_MIN, SCHNITT_MAX);
        Einstellung {
            gruppe,
            schnitt_ms,
            saat,
            a_schnitt: (LN_60DB / (schnitt_ms as f64 * 1e-3 * sr as f64)).exp() as f32,
            g_band: std::array::from_fn(|j| g_von(BAENDER[j], sr)),
            blep: blep_tabelle(),
        }
    }
}

/// Inputs of one voice for one sample.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Eingabe {
    pub trig: f32,
    pub vel: f32,
    pub decay: f32,
    pub tune: f32,
    pub farbe: f32,
    pub rauschen: f32,
    pub hp: f32,
    pub choke: f32,
}

/// State of one voice.
#[derive(Clone, Copy)]
pub struct Stimme {
    bank: Bank,
    kette: Kette,
    /// envelope (vel included); 0 = idle
    huelle: f32,
    gewuergt: bool,
    choke_alt: bool,
    zufall: u32,
    /// cached values and what they were computed from
    tune_alt: f32,
    schritt: [u32; 6],
    decay_alt: f32,
    a_decay: f32,
    hp_alt: f32,
    g_hp: f64,
}

#[inline]
fn endlich(x: f32, sonst: f32) -> f32 { if x.is_finite() { x } else { sonst } }

impl Stimme {
    /// Fresh voice `stimme` of a node with seed `e.saat`: random oscillator phases, idle.
    pub fn neu(stimme: usize, e: &Einstellung) -> Stimme {
        let s = 0x6A09_E667u32 ^ (stimme as u32 + 1).wrapping_mul(0x85EB_CA6B) ^ e.saat.wrapping_mul(0xC2B2_AE35);
        let mut v = Stimme {
            bank: Bank::neu([0; 6]),
            kette: Kette::default(),
            huelle: 0.0,
            gewuergt: false,
            choke_alt: false,
            zufall: if s == 0 { 0x2545_F491 } else { s },
            tune_alt: f32::NAN,
            schritt: [0; 6],
            decay_alt: f32::NAN,
            a_decay: 0.0,
            hp_alt: f32::NAN,
            g_hp: 0.0,
        };
        let phase = std::array::from_fn(|_| v.zahl());
        v.bank = Bank::neu(phase);
        v
    }

    #[inline]
    fn zahl(&mut self) -> u32 {
        let mut x = self.zufall;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.zufall = x;
        x
    }

    /// Envelope value (diagnosis and the `huelle` output).
    pub fn huelle(&self) -> f32 { self.huelle }

    /// One sample: (audio, envelope). `wuergen` = choked by another voice of the node in this sample.
    #[inline]
    pub fn prozess(&mut self, e: &Einstellung, sr: f32, x: Eingabe, wuergen: bool) -> (f32, f32) {
        let choke = x.choke > 0.5;
        let flanke = choke && !self.choke_alt;
        self.choke_alt = choke;
        if x.trig > 0.5 {
            self.huelle = endlich(x.vel, 1.0).clamp(0.0, 1.0);
            self.gewuergt = false;
        } else if (flanke || wuergen) && self.huelle > 0.0 {
            self.gewuergt = true;
        }
        if self.huelle <= 0.0 {
            return (0.0, 0.0);
        }
        let tune = endlich(x.tune, 1.0).clamp(TUNE_MIN, TUNE_MAX);
        if tune != self.tune_alt {
            self.tune_alt = tune;
            self.schritt = schritte(tune, sr);
        }
        let decay = endlich(x.decay, 0.3).clamp(DECAY_MIN, DECAY_MAX);
        if decay != self.decay_alt {
            self.decay_alt = decay;
            self.a_decay = (LN_60DB / (decay as f64 * sr as f64)).exp() as f32;
        }
        let hp = endlich(x.hp, 6_000.0).clamp(HP_MIN, HP_MAX);
        if hp != self.hp_alt {
            self.hp_alt = hp;
            self.g_hp = g_von(hp as f64, sr);
        }
        let ton = self.bank.naechstes(&self.schritt, e.blep);
        // white noise -1..1, scaled per band to the level of the squares behind the same band-pass
        let w = gewichte(endlich(x.farbe, 0.5));
        let r = self.zahl();
        let abgleich = w[0] * RAUSCH_BAND[0] + w[1] * RAUSCH_BAND[1] + w[2] * RAUSCH_BAND[2];
        let rausch = ((r >> 8) as f32 * (2.0 / 16_777_216.0) - 1.0) * abgleich;
        let m = endlich(x.rauschen, 0.2).clamp(0.0, 1.0) * std::f32::consts::FRAC_PI_2;
        let quelle = ton * m.cos() + rausch * m.sin();
        let y = self.kette.prozess(quelle, &w, &e.g_band, self.g_hp);
        let aus = y * self.huelle * PEGEL;
        let h = self.huelle;
        self.huelle *= if self.gewuergt { e.a_schnitt } else { self.a_decay };
        if self.huelle < STILL {
            self.huelle = 0.0;
            self.gewuergt = false;
            self.kette.leeren();
            self.bank.leeren();
        }
        if !aus.is_finite() {
            // cannot happen with finite filter states; keep the voice usable instead of handing NaN to the guard
            self.huelle = 0.0;
            self.kette.leeren();
            self.bank.leeren();
            return (0.0, 0.0);
        }
        (aus, h)
    }
}

/// One sample of all `n` voices of a node. `ein` holds the inputs in the order of `EIN`. Returns (audio, envelope).
#[inline]
pub fn prozess_stimmen(v: &mut [Stimme; MAX_STIMMEN], e: &Einstellung, sr: f32, n: usize, ein: &[Spur; 8]) -> (Spur, Spur) {
    let n = n.min(MAX_STIMMEN);
    let schlag = e.gruppe && ein[0][..n].iter().any(|t| *t > 0.5);
    let (mut aus, mut huelle) = ([0.0; MAX_STIMMEN], [0.0; MAX_STIMMEN]);
    for i in 0..n {
        let x = Eingabe { trig: ein[0][i], vel: ein[1][i], decay: ein[2][i], tune: ein[3][i], farbe: ein[4][i], rauschen: ein[5][i], hp: ein[6][i], choke: ein[7][i] };
        // a voice struck in this sample is not choked: its trig wins inside `prozess`
        (aus[i], huelle[i]) = v[i].prozess(e, sr, x, schlag);
    }
    (aus, huelle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blep_tabelle_steigt_von_0_auf_1_und_ist_symmetrisch() {
        let t = blep_tabelle();
        assert_eq!(t.len(), BLEP_BREITE * BLEP_PUNKTE + 1);
        assert_eq!(t[0], 0.0);
        assert!((t[t.len() - 1] - 1.0).abs() < 1e-7);
        let mitte = t.len() / 2;
        assert!((t[mitte] - 0.5).abs() < 1e-6, "C(0) = {}", t[mitte]);
        for i in 0..t.len() {
            // C(x) + C(-x) = 1 for a symmetric kernel
            assert!((t[i] + t[t.len() - 1 - i] - 1.0).abs() < 1e-6, "{i}");
        }
    }

    #[test]
    fn einzelne_kante_ergibt_den_bandbegrenzten_sprung() {
        // an edge at d = 0.25 (on a table point): the ring then holds 2 C(m - t_c) - 2 step, plus nothing else
        let t = blep_tabelle();
        let mut ring = [0.0f32; RING];
        kante(&mut ring, 0, t, 0.25, 2.0);
        for j in 0..BLEP_BREITE {
            let x = 0.25 - 16.0 + j as f64;
            let i = ((x + 16.0) * BLEP_PUNKTE as f64).round() as usize;
            let soll = 2.0 * t[i] - if j >= HALB { 2.0 } else { 0.0 };
            assert!((ring[j] - soll).abs() < 1e-5, "{j}: {} vs {soll}", ring[j]);
        }
        // far from the edge the residual vanishes; next to it, it is large
        assert!(ring[0].abs() < 1e-3 && ring[BLEP_BREITE - 1].abs() < 1e-3, "{} {}", ring[0], ring[BLEP_BREITE - 1]);
        assert!(ring[HALB] < -0.3, "{}", ring[HALB]);
    }

    #[test]
    fn schritte_treffen_die_frequenzen() {
        let sr = 48_000.0;
        for tune in [0.5f32, 1.0, 1.37, 2.0] {
            let s = schritte(tune, sr);
            for i in 0..6 {
                let f = s[i] as f64 / 4_294_967_296.0 * sr as f64;
                let soll = FREQUENZEN[i] * tune as f64;
                assert!((f / soll - 1.0).abs() < 1e-6, "tune {tune} osc {i}: {f} vs {soll}");
            }
        }
    }

    #[test]
    fn gewichte_sind_ein_dreieck() {
        assert_eq!(gewichte(0.0), [1.0, 0.0, 0.0]);
        assert_eq!(gewichte(0.5), [0.0, 1.0, 0.0]);
        assert_eq!(gewichte(1.0), [0.0, 0.0, 1.0]);
        assert_eq!(gewichte(0.25), [0.5, 0.5, 0.0]);
        for i in 0..=100 {
            let w = gewichte(i as f32 / 100.0);
            assert!((w.iter().sum::<f32>() - 1.0).abs() < 1e-6);
        }
    }

    #[test]
    fn stimme_geht_still_ohne_subnormale() {
        let e = Einstellung::neu(true, 8.0, 0, 48_000.0);
        let mut v = Stimme::neu(0, &e);
        let mut x = Eingabe { trig: 1.0, vel: 1.0, decay: 0.05, tune: 1.0, farbe: 0.5, rauschen: 0.2, hp: 6000.0, choke: 0.0 };
        v.prozess(&e, 48_000.0, x, false);
        x.trig = 0.0;
        for _ in 0..48_000 {
            v.prozess(&e, 48_000.0, x, false);
        }
        assert_eq!(v.huelle, 0.0, "the envelope must snap to 0");
        assert_eq!(v.kette.band[0].prozess(0.0, 0.1, 1.0).0, 0.0, "the filters must be cleared when idle");
        assert!(v.bank.ring.iter().all(|r| *r == 0.0));
    }
}
