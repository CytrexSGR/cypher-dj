//! Reference harness for strand 12 (core performance): the DSP as it was before the strand (frozen copy in `alt/`)
//! against the live `eq_dsp` on the same input. Today new == old, so every case passes bit-equal; A1 (FIR), A2 (bands) and
//! A3 (bypass) must keep their own bound below. The saturator cases live in `sat_dsp/tests/referenz.rs` (saett_dsp
//! depends on eq_dsp, so a dev-dependency here would be a cycle with two copies of the crate).
//!
//! Bounds (plan 0.3):
//! - bands (A2): bit-equal at 96 kHz (no oversampler in the path), 8 bands, ramp, on/off blends;
//! - FIR (A1): max error <= -120 dB against the peak of the old output, 48 kHz, sweep and noise, Eq (bands off, 8 bands),
//!   for every FIR path;
//! - bypass (A3): sweep <= -90 dB sample-wise; noise within 0.01 dB per FFT bin below 20 kHz; a band switched on after
//!   1 s of bypass: <= -120 dB from the switch on;
//! - latency and impulse-response argmax equal to the old ones in every case.
#![allow(clippy::needless_range_loop, dead_code)]

#[path = "alt/band.rs"]
mod alt_band;
#[path = "alt/eq.rs"]
mod alt_eq;
#[path = "alt/ueberabtastung.rs"]
mod alt_ueberabtastung;

use eq_dsp::{BandArt, BandEinstellung, Eq, Kanal, Steilheit};
use std::f64::consts::PI;

const FIR_GRENZE_DB: f64 = -120.0;
const BYPASS_SWEEP_GRENZE_DB: f64 = -90.0;
const BYPASS_BIN_GRENZE_DB: f64 = 0.01;
const BLOCK: usize = 64;

// ---------------------------------------------------------------------------------------------------------------
// FIR path selection. A1 adds `Skalar` (forced scalar path) next to the detected one and routes it into the EQ;
// every FIR case below already loops over `PFADE`.
// ---------------------------------------------------------------------------------------------------------------
#[derive(Clone, Copy, Debug)]
enum Pfad {
    Erkannt,
    Skalar,
}
const PFADE: [Pfad; 2] = [Pfad::Erkannt, Pfad::Skalar];

// ---------------------------------------------------------------------------------------------------------------
// Signals and metrics
// ---------------------------------------------------------------------------------------------------------------
/// Log sine sweep f0..f1 over `sek` seconds at -6 dBFS.
fn sweep(fs: f64, sek: f64, f0: f64, f1: f64) -> Vec<f32> {
    let n = (fs * sek) as usize;
    let k = (f1 / f0).ln();
    (0..n)
        .map(|i| {
            let t = i as f64 / fs;
            let phase = 2.0 * PI * f0 * sek / k * ((t / sek * k).exp() - 1.0);
            (10f64.powf(-6.0 / 20.0) * phase.sin()) as f32
        })
        .collect()
}

/// White noise (xorshift64*, fixed seed), uniform in +-`amp`.
fn rauschen(fs: f64, sek: f64, seed: u64, amp: f64) -> Vec<f32> {
    let mut s = seed;
    (0..(fs * sek) as usize)
        .map(|_| {
            s ^= s >> 12;
            s ^= s << 25;
            s ^= s >> 27;
            let u = (s.wrapping_mul(0x2545F4914F6CDD1D) >> 11) as f64 / (1u64 << 53) as f64;
            (amp * (2.0 * u - 1.0)) as f32
        })
        .collect()
}

/// Max sample error of `neu` against `alt` in dB relative to the peak of `alt` (-inf when bit-equal).
fn max_fehler_db(alt: &[f32], neu: &[f32]) -> f64 {
    assert_eq!(alt.len(), neu.len());
    let spitze = alt.iter().fold(0.0f64, |m, &x| m.max((x as f64).abs()));
    let fehler = alt.iter().zip(neu).fold(0.0f64, |m, (&a, &n)| m.max((a as f64 - n as f64).abs()));
    assert!(spitze > 0.0, "reference output is silent");
    20.0 * (fehler / spitze).log10()
}

fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut b = n >> 1;
        while j & b != 0 {
            j ^= b;
            b >>= 1;
        }
        j |= b;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let w = -2.0 * PI / len as f64;
        for s in (0..n).step_by(len) {
            for k in 0..len / 2 {
                let (c, si) = ((w * k as f64).cos(), (w * k as f64).sin());
                let (a, b) = (s + k, s + k + len / 2);
                let (tr, ti) = (re[b] * c - im[b] * si, re[b] * si + im[b] * c);
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
        len <<= 1;
    }
}

fn betraege(x: &[f32]) -> Vec<f64> {
    let n = 1 << 17;
    assert!(x.len() >= n);
    let mut re: Vec<f64> = (0..n).map(|i| x[i] as f64 * (0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos())).collect();
    let mut im = vec![0.0; n];
    fft(&mut re, &mut im);
    (0..n / 2).map(|k| (re[k] * re[k] + im[k] * im[k]).sqrt()).collect()
}

/// Largest magnitude deviation in dB per FFT bin of `neu` against `alt` (Hann window, first 2^17 samples) below `bis_hz`.
fn bin_abweichung_db(alt: &[f32], neu: &[f32], fs: f64, bis_hz: f64) -> f64 {
    let (a, n) = (betraege(alt), betraege(neu));
    let bis = (bis_hz / fs * (1 << 17) as f64) as usize;
    (1..bis).fold(0.0f64, |m, k| m.max((20.0 * (n[k] / a[k]).log10()).abs()))
}

fn bit_gleich(alt: &[f32], neu: &[f32], was: &str) {
    assert_eq!(alt.len(), neu.len());
    for (i, (a, n)) in alt.iter().zip(neu).enumerate() {
        assert_eq!(a.to_bits(), n.to_bits(), "{was}: sample {i}: old {a} new {n}");
    }
}

// ---------------------------------------------------------------------------------------------------------------
// One interface over the old and the new EQ
// ---------------------------------------------------------------------------------------------------------------
enum Akt {
    Band(usize, BandEinstellung),
    PropQ(bool),
    AusgangDb(f64),
}

trait Gerät {
    fn akt(&mut self, a: &Akt);
    fn stereo(&mut self, l: &mut [f32], r: &mut [f32]);
    fn mono(&mut self, x: &mut [f32]);
    fn latenz(&self) -> usize;
}

impl Gerät for Eq {
    fn akt(&mut self, a: &Akt) {
        match a {
            Akt::Band(i, e) => self.setze_band(*i, *e),
            Akt::PropQ(an) => self.setze_prop_q(*an),
            Akt::AusgangDb(db) => self.setze_ausgang_db(*db),
        }
    }
    fn stereo(&mut self, l: &mut [f32], r: &mut [f32]) {
        self.verarbeite_stereo(l, r)
    }
    fn mono(&mut self, x: &mut [f32]) {
        self.verarbeite_mono(x)
    }
    fn latenz(&self) -> usize {
        Eq::latenz(self)
    }
}

fn alt_art(a: BandArt) -> alt_band::BandArt {
    match a {
        BandArt::Glocke => alt_band::BandArt::Glocke,
        BandArt::LowShelf => alt_band::BandArt::LowShelf,
        BandArt::HighShelf => alt_band::BandArt::HighShelf,
        BandArt::LowCut => alt_band::BandArt::LowCut,
        BandArt::HighCut => alt_band::BandArt::HighCut,
        BandArt::Kerbe => alt_band::BandArt::Kerbe,
        BandArt::Bandpass => alt_band::BandArt::Bandpass,
    }
}

fn alt_einstellung(e: &BandEinstellung) -> alt_band::BandEinstellung {
    alt_band::BandEinstellung {
        an: e.an,
        art: alt_art(e.art),
        freq: e.freq,
        gain_db: e.gain_db,
        q: e.q,
        steilheit: match e.steilheit {
            Steilheit::Db12 => alt_band::Steilheit::Db12,
            Steilheit::Db24 => alt_band::Steilheit::Db24,
            Steilheit::Db36 => alt_band::Steilheit::Db36,
            Steilheit::Db48 => alt_band::Steilheit::Db48,
        },
        kanal: match e.kanal {
            Kanal::Stereo => alt_band::Kanal::Stereo,
            Kanal::Mid => alt_band::Kanal::Mid,
            Kanal::Side => alt_band::Kanal::Side,
        },
    }
}

impl Gerät for alt_eq::Eq {
    fn akt(&mut self, a: &Akt) {
        match a {
            Akt::Band(i, e) => self.setze_band(*i, alt_einstellung(e)),
            Akt::PropQ(an) => self.setze_prop_q(*an),
            Akt::AusgangDb(db) => self.setze_ausgang_db(*db),
        }
    }
    fn stereo(&mut self, l: &mut [f32], r: &mut [f32]) {
        self.verarbeite_stereo(l, r)
    }
    fn mono(&mut self, x: &mut [f32]) {
        self.verarbeite_mono(x)
    }
    fn latenz(&self) -> usize {
        alt_eq::Eq::latenz(self)
    }
}

/// The FIR path is chosen here; A1 routes `Skalar` into the new EQ's oversampler. Until then every path is the one path.
fn neu_eq(fs: f64, pfad: Pfad) -> Eq {
    match pfad {
        Pfad::Erkannt => Eq::neu(fs),
        Pfad::Skalar => Eq::mit_pfad(fs, eq_dsp::ueberabtastung::Pfad::Skalar),
    }
}

/// Runs a device over (l, r) in blocks of 64; every action fires at the first block start at or after its sample.
fn lauf<G: Gerät>(g: &mut G, l: &[f32], r: &[f32], plan: &[(usize, Akt)]) -> (Vec<f32>, Vec<f32>) {
    let (mut l, mut r) = (l.to_vec(), r.to_vec());
    let mut start = 0;
    while start < l.len() {
        for (at, a) in plan {
            if *at >= start && *at < start + BLOCK {
                g.akt(a);
            }
        }
        let ende = (start + BLOCK).min(l.len());
        g.stereo(&mut l[start..ende], &mut r[start..ende]);
        start = ende;
    }
    (l, r)
}

fn lauf_mono<G: Gerät>(g: &mut G, x: &[f32]) -> Vec<f32> {
    let mut x = x.to_vec();
    for c in x.chunks_mut(BLOCK) {
        g.mono(c);
    }
    x
}

// ---------------------------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------------------------
fn band(art: BandArt, f: f64, g: f64, q: f64) -> BandEinstellung {
    BandEinstellung { an: true, art, freq: f, gain_db: g, q, ..Default::default() }
}

/// Eight bands mixed: all channel modes, a cut with 24 dB and one with 12 dB, shelves, a notch.
fn acht_baender() -> [BandEinstellung; 8] {
    [
        BandEinstellung { steilheit: Steilheit::Db24, ..band(BandArt::LowCut, 35.0, 0.0, 0.707) },
        band(BandArt::LowShelf, 120.0, 5.0, 0.8),
        BandEinstellung { kanal: Kanal::Mid, ..band(BandArt::Glocke, 400.0, -4.0, 1.5) },
        band(BandArt::Glocke, 1000.0, 6.0, 2.0),
        BandEinstellung { kanal: Kanal::Side, ..band(BandArt::Kerbe, 3000.0, 0.0, 3.0) },
        BandEinstellung { kanal: Kanal::Side, ..band(BandArt::Glocke, 5000.0, 4.0, 0.7) },
        band(BandArt::HighShelf, 9000.0, -3.0, 0.8),
        band(BandArt::HighCut, 18000.0, 0.0, 0.707),
    ]
}

fn setze_acht() -> Vec<(usize, Akt)> {
    acht_baender().iter().enumerate().map(|(i, e)| (0, Akt::Band(i, *e))).collect()
}

/// Stereo test input: sweep on the left, noise (plus a little sweep) on the right, so M and S both carry signal.
fn stereo_signal(fs: f64, sek: f64) -> (Vec<f32>, Vec<f32>) {
    let l = sweep(fs, sek, 20.0, 20000.0);
    let rs = rauschen(fs, sek, 0x9E3779B97F4A7C15, 0.25);
    let r = rs.iter().zip(&l).map(|(n, s)| 0.7 * n + 0.3 * s).collect();
    (l, r)
}

fn impulsantwort<G: Gerät>(g: &mut G, n: usize) -> Vec<f32> {
    let mut l = vec![0.0f32; n];
    let mut r = vec![0.0f32; n];
    l[0] = 1.0;
    r[0] = 1.0;
    g.stereo(&mut l, &mut r);
    l
}

fn argmax(x: &[f32]) -> usize {
    let mut best = (0, 0.0f32);
    for (i, v) in x.iter().enumerate() {
        if v.abs() > best.1 {
            best = (i, v.abs());
        }
    }
    best.0
}

// ---------------------------------------------------------------------------------------------------------------
// Bands (A2): bit-equal at 96 kHz
// ---------------------------------------------------------------------------------------------------------------
fn bit_gleich_96(plan: &[(usize, Akt)], sek: f64, was: &str) {
    let fs = 96000.0;
    let (l, r) = stereo_signal(fs, sek);
    let (la, ra) = lauf(&mut alt_eq::Eq::neu(fs), &l, &r, plan);
    let (ln, rn) = lauf(&mut neu_eq(fs, Pfad::Erkannt), &l, &r, plan);
    bit_gleich(&la, &ln, &format!("{was} L"));
    bit_gleich(&ra, &rn, &format!("{was} R"));
}

#[test]
fn baender_acht_gemischt_bitgleich() {
    bit_gleich_96(&setze_acht(), 3.0, "eight bands");
}

#[test]
fn baender_acht_mit_prop_q_und_ausgang_bitgleich() {
    let mut plan = setze_acht();
    plan.push((0, Akt::PropQ(true)));
    plan.push((0, Akt::AusgangDb(-3.0)));
    bit_gleich_96(&plan, 3.0, "prop-Q and output level");
}

#[test]
fn baender_rampe_bitgleich() {
    // gain and freq moved mid-signal, repeatedly, so ramps run and end inside the signal
    let mut plan = setze_acht();
    plan.push((96000, Akt::Band(3, band(BandArt::Glocke, 2500.0, -6.0, 2.0))));
    plan.push((96000, Akt::Band(1, band(BandArt::LowShelf, 300.0, 5.0, 0.8))));
    plan.push((160000, Akt::Band(5, BandEinstellung { kanal: Kanal::Side, ..band(BandArt::Glocke, 6500.0, 9.0, 1.2) })));
    plan.push((200000, Akt::Band(3, band(BandArt::Glocke, 1000.0, 6.0, 4.0))));
    bit_gleich_96(&plan, 3.0, "ramp");
}

#[test]
fn baender_ein_aus_blenden_bitgleich() {
    // on/off, type, slope and channel switches: the blend runs
    let mut plan = setze_acht();
    let mut aus = acht_baender()[7];
    aus.an = false;
    plan.push((48000, Akt::Band(7, aus)));
    plan.push((72000, Akt::Band(0, BandEinstellung { steilheit: Steilheit::Db48, ..band(BandArt::LowCut, 35.0, 0.0, 0.707) })));
    plan.push((120000, Akt::Band(2, band(BandArt::Glocke, 400.0, -4.0, 1.5))));
    plan.push((150000, Akt::Band(4, BandEinstellung { kanal: Kanal::Side, ..band(BandArt::Bandpass, 3000.0, 0.0, 1.0) })));
    plan.push((190000, Akt::Band(7, acht_baender()[7])));
    plan.push((230000, Akt::PropQ(true)));
    bit_gleich_96(&plan, 3.0, "on/off blends");
}

#[test]
fn baender_mono_bitgleich() {
    let fs = 96000.0;
    let x = rauschen(fs, 2.0, 7, 0.25);
    let (mut a, mut n) = (alt_eq::Eq::neu(fs), neu_eq(fs, Pfad::Erkannt));
    for (_, ak) in setze_acht() {
        a.akt(&ak);
        n.akt(&ak);
    }
    bit_gleich(&lauf_mono(&mut a, &x), &lauf_mono(&mut n, &x), "mono");
}

// ---------------------------------------------------------------------------------------------------------------
// FIR (A1): <= -120 dB at 48 kHz, every path
// ---------------------------------------------------------------------------------------------------------------
fn fir_fall(pfad: Pfad, plan: &[(usize, Akt)], l: &[f32], r: &[f32], was: &str) {
    let fs = 48000.0;
    let (la, ra) = lauf(&mut alt_eq::Eq::neu(fs), l, r, plan);
    let (ln, rn) = lauf(&mut neu_eq(fs, pfad), l, r, plan);
    for (a, n, k) in [(&la, &ln, "L"), (&ra, &rn, "R")] {
        let e = max_fehler_db(a, n);
        assert!(e <= FIR_GRENZE_DB, "{was} {k} {pfad:?}: max error {e:.1} dB, bound {FIR_GRENZE_DB} dB");
    }
}

// "Bands off" is the bypass since A3: its bounds are the bypass cases below, not the FIR bound.

#[test]
fn fir_eq_acht_baender_sweep() {
    let s = sweep(48000.0, 4.0, 20.0, 20000.0);
    for p in PFADE {
        fir_fall(p, &setze_acht(), &s, &s, "8 bands, sweep");
    }
}

#[test]
fn fir_eq_acht_baender_rauschen() {
    let n = rauschen(48000.0, 4.0, 0xC0FFEE, 0.25);
    let m = rauschen(48000.0, 4.0, 0xBEEF, 0.25);
    for p in PFADE {
        fir_fall(p, &setze_acht(), &n, &m, "8 bands, noise");
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Bypass (A3)
// ---------------------------------------------------------------------------------------------------------------
#[test]
fn bypass_sweep_stichprobe() {
    let s = sweep(48000.0, 4.0, 20.0, 20000.0);
    for p in PFADE {
        let (la, _) = lauf(&mut alt_eq::Eq::neu(48000.0), &s, &s, &[]);
        let (ln, _) = lauf(&mut neu_eq(48000.0, p), &s, &s, &[]);
        let e = max_fehler_db(&la, &ln);
        assert!(e <= BYPASS_SWEEP_GRENZE_DB, "bypass sweep {p:?}: {e:.1} dB, bound {BYPASS_SWEEP_GRENZE_DB} dB");
    }
}

#[test]
fn bypass_rauschen_betrag_pro_bin() {
    let n = rauschen(48000.0, 4.0, 0xC0FFEE, 0.25);
    for p in PFADE {
        let (la, _) = lauf(&mut alt_eq::Eq::neu(48000.0), &n, &n, &[]);
        let (ln, _) = lauf(&mut neu_eq(48000.0, p), &n, &n, &[]);
        // the old path filtered above 0.4535 fs, bypass does not: that is intended, so the check stops at 20 kHz
        let d = bin_abweichung_db(&la, &ln, 48000.0, 20000.0);
        assert!(d <= BYPASS_BIN_GRENZE_DB, "bypass noise {p:?}: {d:.4} dB per bin, bound {BYPASS_BIN_GRENZE_DB} dB");
    }
}

#[test]
fn bypass_band_nach_einer_sekunde_zugeschaltet() {
    let fs = 48000.0;
    let (l, r) = stereo_signal(fs, 4.0);
    let schalt = 48000;
    let plan = vec![(schalt, Akt::Band(3, band(BandArt::Glocke, 1000.0, 6.0, 2.0)))];
    for p in PFADE {
        let (la, ra) = lauf(&mut alt_eq::Eq::neu(fs), &l, &r, &plan);
        let (ln, rn) = lauf(&mut neu_eq(fs, p), &l, &r, &plan);
        for (a, n, k) in [(&la, &ln, "L"), (&ra, &rn, "R")] {
            // the peak reference is the old output from the switch on, the error window starts there too
            let e = max_fehler_db(&a[schalt..], &n[schalt..]);
            assert!(e <= FIR_GRENZE_DB, "switch-on {k} {p:?}: {e:.1} dB, bound {FIR_GRENZE_DB} dB");
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Latency and impulse response argmax equal to the old ones
// ---------------------------------------------------------------------------------------------------------------
#[test]
fn latenz_und_impulsantwort_wie_alt() {
    for fs in [44100.0, 48000.0, 88200.0, 96000.0] {
        for p in PFADE {
            for baender_an in [false, true] {
                let (mut a, mut n) = (alt_eq::Eq::neu(fs), neu_eq(fs, p));
                assert_eq!(a.latenz(), n.latenz(), "latency at {fs}");
                assert_eq!(a.latenz(), if fs < 88000.0 { 69 } else { 0 }, "old latency constant at {fs}");
                if baender_an {
                    for (_, ak) in setze_acht() {
                        a.akt(&ak);
                        n.akt(&ak);
                    }
                }
                let (ia, inn) = (impulsantwort(&mut a, 4096), impulsantwort(&mut n, 4096));
                assert_eq!(argmax(&ia), argmax(&inn), "impulse argmax at {fs}, bands on {baender_an}, {p:?}");
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The harness must see a difference
// ---------------------------------------------------------------------------------------------------------------
#[test]
fn harness_sieht_eine_abweichung() {
    // Stand-in for "one FIR tap scaled by 1.001" (the frozen taps are private): the new side gets an output level
    // 0.05 dB off, a relative error of about 6e-3, far above the -120 dB bound.
    let fs = 48000.0;
    let s = sweep(fs, 1.0, 20.0, 20000.0);
    let (la, _) = lauf(&mut alt_eq::Eq::neu(fs), &s, &s, &[]);
    let mut n = neu_eq(fs, Pfad::Erkannt);
    n.akt(&Akt::AusgangDb(0.05));
    let (ln, _) = lauf(&mut n, &s, &s, &[]);
    let e = max_fehler_db(&la, &ln);
    assert!(e > FIR_GRENZE_DB, "harness blind: {e:.1} dB");
    let d = bin_abweichung_db(&la.repeat(3)[..1 << 17], &ln.repeat(3)[..1 << 17], fs, 20000.0);
    assert!(d > BYPASS_BIN_GRENZE_DB, "bin metric blind: {d:.4} dB");
}

/// One quick timing, run by hand: `cargo test --release -p eq_dsp --test referenz zeit -- --ignored --nocapture`.
#[test]
#[ignore]
fn zeit_hoch_runter_paar_alt_gegen_neu() {
    let x = rauschen(48000.0, 20.0, 7, 0.5);
    let t = std::time::Instant::now();
    let (mut h, mut r) = (alt_ueberabtastung::Hoch::neu(), alt_ueberabtastung::Runter::neu());
    let mut s = 0.0;
    for &v in &x {
        s += r.verarbeite(h.verarbeite(v as f64));
    }
    let alt = t.elapsed().as_nanos() as f64 / x.len() as f64;
    println!("alt: {alt:.1} ns per pair (sum {s:.3})");
    for p in [eq_dsp::ueberabtastung::Pfad::Skalar, eq_dsp::ueberabtastung::Pfad::erkannt()] {
        let t = std::time::Instant::now();
        let (mut h, mut r) = (eq_dsp::ueberabtastung::Hoch::mit_pfad(p), eq_dsp::ueberabtastung::Runter::mit_pfad(p));
        let mut s = 0.0;
        for &v in &x {
            s += r.verarbeite(h.verarbeite(v as f64));
        }
        let neu = t.elapsed().as_nanos() as f64 / x.len() as f64;
        println!("{p:?}: {neu:.1} ns per pair, {:.1}x (sum {s:.3})", alt / neu);
    }
}

/// One quick timing, run by hand: `cargo test --release -p eq_dsp --test referenz zeit_eq -- --ignored --nocapture`.
/// An EQ with all bands off at 48 kHz, stereo, blocks of 512.
#[test]
#[ignore]
fn zeit_eq_baender_aus_alt_gegen_neu() {
    let fs = 48000.0;
    let x = rauschen(fs, 20.0, 7, 0.5);
    let ns = |mut f: Box<dyn FnMut(&mut [f32], &mut [f32])>| {
        let (mut l, mut r) = (x.clone(), x.clone());
        let t = std::time::Instant::now();
        for (a, b) in l.chunks_mut(512).zip(r.chunks_mut(512)) {
            f(a, b);
        }
        t.elapsed().as_nanos() as f64 / x.len() as f64
    };
    let mut a = alt_eq::Eq::neu(fs);
    let alt = ns(Box::new(move |l, r| a.verarbeite_stereo(l, r)));
    let mut n = eq_dsp::Eq::neu(fs);
    let neu = ns(Box::new(move |l, r| n.verarbeite_stereo(l, r)));
    println!("EQ bands off, 48 kHz: old {alt:.1} ns per sample, new {neu:.1} ns, {:.1}x", alt / neu);
}
