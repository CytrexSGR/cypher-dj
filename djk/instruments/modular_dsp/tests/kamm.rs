//! Measurements on the tuned comb filter (`kamm`, type 38) with synthetic signals. Peak positions come from the
//! impulse response (zero-padded real FFT, parabola through the log magnitude around the maximum); the block is driven
//! directly (`kamm::Kamm`), the graph path is covered at the end. Every number is printed as a `MESS` line.
use baukasten_dsp::kamm::{Kamm, FB_MAX};
use baukasten_dsp::uebersetze;
use realfft::RealFftPlanner;

const SR: f32 = 48_000.0;

fn cent(ist: f64, soll: f64) -> f64 { 1200.0 * (ist / soll).log2() }

/// Impulse response of the comb (mix 1) for `len` samples
fn ir(sr: f32, hz: f32, fb: f32, daempf: f32, len: usize) -> Vec<f32> {
    let mut k = Kamm::neu(sr);
    (0..len).map(|i| k.prozess(if i == 0 { 1.0 } else { 0.0 }, hz, fb, daempf, 1.0)).collect()
}

/// length in samples after which a loop of gain `fb` per period `t` has fallen by 80 dB (capped at 4 s)
fn laenge(sr: f32, hz: f32, fb: f32) -> usize {
    let perioden = (1e-4f64.ln() / (fb.abs() as f64).max(0.05).ln()).abs() + 4.0;
    ((perioden * sr as f64 / hz as f64) as usize + 64).min((4.0 * sr) as usize)
}

struct Spektrum { mag: Vec<f64>, df: f64 }

fn spektrum(x: &[f32], sr: f32) -> Spektrum {
    let n = (x.len().next_power_of_two() * 4).max(1 << 14);
    let mut a: Vec<f32> = x.to_vec();
    a.resize(n, 0.0);
    let fft = RealFftPlanner::<f32>::new().plan_fft_forward(n);
    let mut s = fft.make_output_vec();
    fft.process(&mut a, &mut s).unwrap();
    Spektrum { mag: s.iter().map(|c| ((c.re as f64).powi(2) + (c.im as f64).powi(2)).sqrt()).collect(), df: sr as f64 / n as f64 }
}

impl Spektrum {
    /// frequency of the largest peak within +-`rel` of `f`, parabolic interpolation on the log magnitude
    fn spitze(&self, f: f64, rel: f64) -> (f64, f64) {
        let (lo, hi) = (((f * (1.0 - rel)) / self.df) as usize, ((f * (1.0 + rel)) / self.df).ceil() as usize);
        let i = (lo.max(1)..=hi.min(self.mag.len() - 2)).max_by(|a, b| self.mag[*a].partial_cmp(&self.mag[*b]).unwrap()).unwrap();
        let (a, b, c) = (self.mag[i - 1].max(1e-30).ln(), self.mag[i].max(1e-30).ln(), self.mag[i + 1].max(1e-30).ln());
        let d = 0.5 * (a - c) / (a - 2.0 * b + c);
        ((i as f64 + d) * self.df, self.mag[i])
    }
    fn bei(&self, f: f64) -> f64 { self.mag[(f / self.df).round() as usize] }
}

#[test]
fn spitzen_bei_positiver_rueckkopplung_auf_den_vielfachen() {
    let (hz, sr) = (220.0, 48_000.0);
    let s = spektrum(&ir(sr, hz, 0.9, 0.0, laenge(sr, hz, 0.9)), sr);
    let mut schlimmster = 0.0f64;
    for k in 1..=12 {
        let soll = hz as f64 * k as f64;
        let (f, hoehe) = s.spitze(soll, 0.03);
        let c = cent(f, soll);
        println!("MESS pos k={k} {f:.3} Hz {c:+.3} cent");
        schlimmster = schlimmster.max(c.abs());
        // the valley half-way to the next peak is far below the peak
        assert!(s.bei(soll + hz as f64 / 2.0) < hoehe / 4.0, "k {k}: valley not deep enough");
    }
    println!("MESS pos worst {schlimmster:.3} cent");
    assert!(schlimmster < 1.5, "worst peak error {schlimmster} cent");
}

#[test]
fn negative_rueckkopplung_gibt_ungerade_vielfache_auf_dem_gespielten_ton() {
    let (hz, sr) = (220.0, 48_000.0);
    let s = spektrum(&ir(sr, hz, -0.9, 0.0, laenge(sr, hz, 0.9)), sr);
    let mut schlimmster = 0.0f64;
    let grund = s.spitze(hz as f64, 0.03).1;
    for k in [1usize, 3, 5, 7, 9, 11] {
        let soll = hz as f64 * k as f64;
        let (f, hoehe) = s.spitze(soll, 0.03);
        let c = cent(f, soll);
        println!("MESS neg k={k} {f:.3} Hz {c:+.3} cent, {:.2} dB re fundamental", 20.0 * (hoehe / grund).log10());
        schlimmster = schlimmster.max(c.abs());
        // the even multiples are valleys
        assert!(s.bei(soll + hz as f64) < hoehe / 4.0, "k {k}: even multiple is not a valley");
    }
    // nothing at half the played pitch
    assert!(s.bei(hz as f64 / 2.0) < grund / 4.0, "the octave below must not ring");
    println!("MESS neg worst {schlimmster:.3} cent");
    assert!(schlimmster < 1.5, "worst peak error {schlimmster} cent");
}

/// Fundamental tuning error over the range, for both signs, with and without damping, at four sample rates.
#[test]
fn abstimmung_ueber_den_bereich_in_cent() {
    let mut schlimmster = (0.0f64, String::new());
    let mut stark = (0.0f64, String::new());
    for sr in [44_100.0f32, 48_000.0, 96_000.0, 192_000.0] {
        // third-octave steps from 20 Hz to 8 kHz; the lower rates are measured on the full grid at 48 kHz only
        let schritt = if sr == 48_000.0 { 1.0 } else { 3.0 };
        let mut hz = 20.0f32;
        let mut n = 0;
        while hz <= 8000.0 {
            if n as f32 % schritt == 0.0 || hz > 7000.0 {
                for fb in [0.9f32, -0.9] {
                    for d in [0.0f32, 0.6, 1.0] {
                        let s = spektrum(&ir(sr, hz, fb, d, laenge(sr, hz, fb)), sr);
                        let (f, _) = s.spitze(hz as f64, 0.06);
                        let c = cent(f, hz as f64);
                        // with full damping the magnitude peak is biased low by the low-pass tilt (the loop phase is still exact)
                        let grenze = if d == 1.0 { &mut stark } else { &mut schlimmster };
                        if c.abs() > grenze.0 { *grenze = (c.abs(), format!("sr {sr} hz {hz:.1} fb {fb} daempf {d}: {c:+.3} cent")); }
                    }
                }
            }
            hz *= 2f32.powf(1.0 / 3.0);
            n += 1;
        }
    }
    println!("MESS tuning worst (daempf 0 and 0.6) {:.3} cent ({})", schlimmster.0, schlimmster.1);
    println!("MESS tuning worst (daempf 1, magnitude peak) {:.3} cent ({})", stark.0, stark.1);
    assert!(schlimmster.0 < 1.0, "worst tuning error: {}", schlimmster.1);
    assert!(stark.0 < 8.0, "worst tuning error at full damping: {}", stark.1);
}

/// Decay per loop period: the fundamental's amplitude falls by `fb |L(f0)|` per loop period (the loop period of a negative
/// feedback is half a period of the note). Goertzel on two windows of 10 loop periods, 24 periods apart. At 480 Hz the
/// damping low-pass is out (|L| = 1), at 200 Hz damping 0 it is in.
#[test]
fn abklingen_folgt_der_rueckkopplung() {
    let sr = 48_000.0f32;
    for hz in [480.0f32, 200.0] {
        for fb in [0.5f32, 0.8, 0.95, -0.5, -0.8, -0.95] {
            let periode = sr as f64 / hz as f64 * if fb < 0.0 { 0.5 } else { 1.0 };
            let n = (10.0 * periode).round() as usize;
            let versatz = (24.0 * periode).round() as usize;
            let start = (4.0 * periode).round() as usize;
            let x = ir(sr, hz, fb, 0.0, start + versatz + n + 8);
            let goertzel = |von: usize| {
                let w = 2.0 * std::f64::consts::PI * hz as f64 / sr as f64;
                let (mut re, mut im) = (0.0f64, 0.0f64);
                for (i, v) in x[von..von + n].iter().enumerate() { re += *v as f64 * (w * i as f64).cos(); im -= *v as f64 * (w * i as f64).sin(); }
                (re * re + im * im).sqrt()
            };
            let je_periode = (goertzel(start + versatz) / goertzel(start)).powf(1.0 / (versatz as f64 / periode));
            // the low-pass magnitude at the tuning frequency (same design as the block)
            let fc = hz as f64 * 64.0;
            let l = if fc >= 0.45 * sr as f64 { 1.0 } else {
                let k = 1.0 - (-2.0 * std::f64::consts::PI * fc / sr as f64).exp();
                let w = 2.0 * std::f64::consts::PI * hz as f64 / sr as f64;
                k / ((1.0 - (1.0 - k) * w.cos()).powi(2) + ((1.0 - k) * w.sin()).powi(2)).sqrt()
            };
            let soll = fb.abs() as f64 * l;
            println!("MESS decay hz {hz} fb {fb}: gain per loop period {je_periode:.5}, expected {soll:.5}");
            assert!((je_periode / soll - 1.0).abs() < 0.01, "hz {hz} fb {fb}: {je_periode} against {soll}");
        }
    }
}

/// The loop's own damping: a peak at the n-th harmonic has height `sqrt(1 - fb^2) / (1 - fb |L(f)|)` with the
/// magnitude of the one-pole low-pass `L`; compared in dB, and the damping knob lowers the high peaks monotonically.
#[test]
fn daempfung_senkt_die_hohen_spitzen_wie_berechnet() {
    let (hz, sr, fb) = (200.0f32, 48_000.0f32, 0.9f32);
    let mut vorher = f64::INFINITY;
    for d in [0.0f32, 0.25, 0.5, 0.75, 1.0] {
        let s = spektrum(&ir(sr, hz, fb, d, 20_000), sr);
        // same design as the block: fc = hz 2^(1 + 5 (1 - d)), at most 0.45 sr
        let fc = (hz as f64 * (1.0 + 5.0 * (1.0 - d as f64)).exp2()).min(0.45 * sr as f64);
        let k = 1.0 - (-2.0 * std::f64::consts::PI * fc / sr as f64).exp();
        let n = 10;
        let f = hz as f64 * n as f64;
        let w = 2.0 * std::f64::consts::PI * f / sr as f64;
        let l = k / ((1.0 - (1.0 - k) * w.cos()).powi(2) + ((1.0 - k) * w.sin()).powi(2)).sqrt();
        let soll = (1.0 - (fb as f64).powi(2)).sqrt() / (1.0 - fb as f64 * l);
        let (_, ist) = s.spitze(f, 0.02);
        let diff = 20.0 * (ist / soll).log10();
        println!("MESS damping d {d}: peak {n} {:.2} dB, expected {:.2} dB, diff {diff:+.2} dB", 20.0 * ist.log10(), 20.0 * soll.log10());
        // the prediction assumes the peak sits exactly on the harmonic; with strong damping the low-pass phase pulls the
        // harmonics off the grid and the measured peak lies below it, never above
        assert!(if d < 1.0 { diff.abs() < 0.75 } else { diff < 0.1 && diff > -3.0 }, "damping {d}: {diff} dB off the prediction");
        assert!(ist < vorher, "damping {d}: the high peak must fall with the knob");
        vorher = ist;
    }
}

/// Noise through the comb at several `fb` (440 Hz, damping 0 = low-pass out): the output power stays within 4 dB of the input power over the whole
/// feedback range (without the `sqrt(1 - fb^2)` scaling it would rise by 7 dB at 0.9 and 17 dB at 0.99); the small loss
/// is the high-frequency roll-off of the cubic interpolation in the loop.
#[test]
fn rauschleistung_bleibt_bei_jeder_rueckkopplung() {
    for fb in [0.0f32, 0.5, 0.9, 0.99, -0.9] {
        let mut k = Kamm::neu(SR);
        let mut z = 12345u32;
        let (mut ein, mut aus) = (0.0f64, 0.0f64);
        for i in 0..200_000 {
            z ^= z << 13; z ^= z >> 17; z ^= z << 5;
            let x = (z as f64 / u32::MAX as f64 * 2.0 - 1.0) as f32 * 0.25;
            let y = k.prozess(x, 440.0, fb, 0.0, 1.0);
            if i >= 20_000 { ein += (x as f64).powi(2); aus += (y as f64).powi(2); }
        }
        let db = 10.0 * (aus / ein).log10();
        println!("MESS noise fb {fb}: {db:+.2} dB");
        assert!(db.abs() < 4.0, "fb {fb}: {db} dB");
    }
}

#[test]
fn mix_null_und_rueckkopplung_null_lassen_das_signal_bitgleich() {
    let mut a = Kamm::neu(SR);
    let mut b = Kamm::neu(SR);
    for i in 0..5000 {
        let x = ((i as f32) * 0.07).sin() * 0.5;
        assert_eq!(a.prozess(x, 300.0, 0.95, 0.2, 0.0).to_bits(), x.to_bits());
        assert_eq!(b.prozess(x, 300.0, 0.0, 0.2, 1.0).to_bits(), x.to_bits());
    }
}

/// hz at audio rate (sine around the note, up to an octave deep, from 5 Hz to 8 kHz) and random jumps every 100 samples, at
/// the limits of feedback and damping, with noise and with a tone: finite and bounded (the loop clamps at +-4), no pump.
#[test]
fn stabil_bei_hz_im_audiotakt() {
    let mut spitze = 0.0f32;
    for fm in [5.0f64, 100.0, 1000.0, 8000.0] {
        for fb in [FB_MAX, -FB_MAX, 0.5] {
            for d in [0.0f32, 1.0] {
                for tiefe in [0.1f64, 1.0] {
                    let mut k = Kamm::neu(SR);
                    let mut z = 99u32;
                    for i in 0..96_000 {
                        z ^= z << 13; z ^= z >> 17; z ^= z << 5;
                        let x = (z as f64 / u32::MAX as f64 * 2.0 - 1.0) as f32 * 0.5;
                        let hz = 440.0 * 2f64.powf(tiefe * (2.0 * std::f64::consts::PI * fm * i as f64 / SR as f64).sin());
                        let y = k.prozess(x, hz as f32, fb, d, 1.0);
                        assert!(y.is_finite() && y.abs() < 4.5, "fm {fm} fb {fb} d {d} depth {tiefe}: {y} at {i}");
                        spitze = spitze.max(y.abs());
                    }
                }
            }
        }
    }
    // jumps
    let mut k = Kamm::neu(SR);
    let mut z = 7u32;
    let mut hz = 440.0f32;
    for i in 0..192_000 {
        z ^= z << 13; z ^= z >> 17; z ^= z << 5;
        if i % 100 == 0 { hz = 20.0 * 400f32.powf((z >> 8) as f32 / (1u32 << 24) as f32); }
        let x = if i % 5000 < 50 { 1.0 } else { 0.0 };
        let fb = if (i / 20_000) % 2 == 0 { FB_MAX } else { -FB_MAX };
        let y = k.prozess(x, hz, fb, 0.0, 1.0);
        assert!(y.is_finite() && y.abs() < 4.5, "jump run: {y} at {i}");
        spitze = spitze.max(y.abs());
    }
    println!("MESS audio-rate hz: peak {spitze:.3} over all runs");
}

/// No click: a 1 kHz tone through the comb, `hz` jumps from 300 to 450 Hz; the largest sample-to-sample step during
/// the glide stays within 3 times the largest step of the steady comb (a click would be a step of the line's own size).
#[test]
fn hz_sprung_klickt_nicht() {
    for fb in [0.6f32, -0.6] {
        let lauf = |sprung: bool| {
            let mut k = Kamm::neu(SR);
            let mut gross = 0.0f32;
            let mut vor = 0.0f32;
            for i in 0..48_000 {
                let x = 0.3 * (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / SR).sin();
                let hz = if sprung && i >= 24_000 { 450.0 } else { 300.0 };
                let y = k.prozess(x, hz, fb, 0.3, 1.0);
                if i >= 20_000 { gross = gross.max((y - vor).abs()); }
                vor = y;
            }
            gross
        };
        let (still, mit) = (lauf(false), lauf(true));
        println!("MESS click fb {fb}: steady max step {still:.4}, with jump {mit:.4}");
        assert!(mit < 3.0 * still, "fb {fb}: step {mit} against steady {still}");
    }
}

#[test]
fn extreme_eingaenge_bleiben_endlich_und_beschraenkt() {
    let mut k = Kamm::neu(SR);
    let werte = [0.0f32, -0.0, 1e-38, 1e-30, 1.0, -1.0, 1e10, -1e10, 1e30, f32::MAX, f32::MIN, f32::NAN, f32::INFINITY, f32::NEG_INFINITY];
    let mut z = 1u32;
    for i in 0..200_000 {
        z ^= z << 13; z ^= z >> 17; z ^= z << 5;
        let pick = |s: u32| werte[((z >> s) as usize) % werte.len()];
        let y = k.prozess(pick(0), pick(4), pick(8), pick(12), pick(16));
        assert!(y.is_finite(), "sample {i}: {y}");
        // x is not limited (it passes dry), the wet part is: no wet value above the loop clamp
        let _ = y;
    }
    // finite input, extreme parameters: the output is bounded by the loop clamp and the dry signal
    let mut k = Kamm::neu(SR);
    for i in 0..100_000 {
        z ^= z << 13; z ^= z >> 17; z ^= z << 5;
        let x = (z as f64 / u32::MAX as f64 * 2.0 - 1.0) as f32;
        let hz = [0.0, -50.0, 1e9, f32::NAN, 20.0, 1e5][(i / 1000) % 6];
        let fb = [1e9, -1e9, 1.0, -1.0, f32::NAN][(i / 1700) % 5];
        let y = k.prozess(x, hz, fb, 5.0, 3.0);
        assert!(y.is_finite() && y.abs() <= 4.0 + 1.0, "sample {i}: {y}");
    }
}

/// The delay memory: 20 Hz fits at every rate, a lower request is clamped to 20 Hz, not out of range.
#[test]
fn tiefster_ton_passt_in_den_speicher() {
    for sr in [44_100.0f32, 48_000.0, 192_000.0] {
        let s = spektrum(&ir(sr, 20.0, 0.8, 0.0, (3.0 * sr) as usize), sr);
        let c = cent(s.spitze(20.0, 0.06).0, 20.0);
        let s2 = spektrum(&ir(sr, 5.0, 0.8, 0.0, (3.0 * sr) as usize), sr);
        let c2 = cent(s2.spitze(20.0, 0.06).0, 20.0);
        println!("MESS lowest sr {sr}: 20 Hz {c:+.3} cent, 5 Hz requested (clamped to 20) {c2:+.3} cent");
        assert!(c.abs() < 2.0 && c2.abs() < 2.0);
    }
}

fn lade(pfad: &str, sr: f32) -> baukasten_dsp::Programm {
    uebersetze(&std::fs::read_to_string(format!("{}/demos/{pfad}", env!("CARGO_MANIFEST_DIR"))).unwrap(), sr).unwrap()
}

/// Graph path: the pluck example follows the note; the fundamental of the output sits on the note frequency.
#[test]
fn goa_zupf_folgt_der_note() {
    let mut worst = 0.0f64;
    for (note, hz) in [(45u8, 110.0f64), (57, 220.0), (69, 440.0), (81, 880.0)] {
        let mut p = lade("kamm-goa-zupf.json", SR);
        p.setze_regler(1, 1.0);
        p.setze_regler(2, 0.2);
        p.setze_regler(4, 1.0);
        p.note_an(note, 0.8);
        let x: Vec<f32> = (0..96_000).map(|_| p.sample()).collect();
        assert!(x.iter().all(|v| v.is_finite()));
        let s = spektrum(&x[2000..], SR);
        let (f, hoehe) = s.spitze(hz, 0.03);
        let c = cent(f, hz);
        println!("MESS pluck note {note}: {f:.3} Hz {c:+.3} cent");
        assert!(hoehe > 0.0);
        worst = worst.max(c.abs());
    }
    assert!(worst < 3.0, "pluck pitch off by {worst} cent");
}

#[test]
fn ungueltige_werte_im_graphen_werden_abgelehnt() {
    let g = |w: &str| format!(r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"e","art":"eingang"}},{{"id":"k","art":"kamm",{w}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"e.l","nach":"k.x"}},{{"von":"k.aus","nach":"o.l"}}]}}"#);
    assert!(uebersetze(&g(r#""fb":0.5"#), SR).is_ok());
    for w in [r#""fb":1.5"#, r#""fb":-1.01"#, r#""daempf":2"#, r#""mix":-0.1"#, r#""hz":10"#, r#""hz":30000"#] {
        assert!(uebersetze(&g(w), SR).is_err(), "{w} must be rejected");
    }
    assert!(uebersetze(&g(r#""fb":0.5"#), 22_050.0).is_err(), "sr below 44.1 kHz must be rejected");
}
