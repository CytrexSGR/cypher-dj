//! Abnahme des Cypher EQ am ganzen Signalweg (Überabtastung + Bänder), nicht nur am Entwurf.
use eq_dsp::entwurf::{self, als_svf, prototyp, Art, Biquad};
use eq_dsp::*;
use std::f64::consts::PI;

/// Länge der Impulsantwort: schmale tiefe Bänder klingen lange nach. Abschneiden täuscht Fehler vor
/// (gemessen: 40 Hz, Q 4, 96 kHz → 1,23 dB „Fehler“ bei 16384, 0,0035 dB bei 65536).
fn n_ir(baender: &[BandEinstellung]) -> usize {
    if baender.iter().any(|b| b.freq < 300.0) { 65536 } else { 16384 }
}

fn band(art: BandArt, f: f64, g: f64, q: f64) -> BandEinstellung {
    BandEinstellung { an: true, art, freq: f, gain_db: g, q, ..Default::default() }
}

/// Impulsantwort des ganzen EQ (Kanal L, stereo betrieben).
fn impulsantwort(fs: f64, baender: &[BandEinstellung]) -> Vec<f64> {
    let mut eq = Eq::neu(fs);
    for (i, b) in baender.iter().enumerate() {
        eq.setze_band(i, *b);
    }
    let mut l = vec![0.0f32; n_ir(baender)];
    let mut r = vec![0.0f32; l.len()];
    l[0] = 1.0;
    r[0] = 1.0;
    eq.verarbeite_stereo(&mut l, &mut r);
    l.iter().map(|&x| x as f64).collect()
}

/// Betrag in dB bei Frequenz f (direkte DFT an einer Stelle).
fn betrag_db(h: &[f64], f: f64, fs: f64) -> f64 {
    let w = 2.0 * PI * f / fs;
    let (mut re, mut im) = (0.0, 0.0);
    for (n, &x) in h.iter().enumerate() {
        re += x * (w * n as f64).cos();
        im -= x * (w * n as f64).sin();
    }
    10.0 * (re * re + im * im).log10()
}

fn log_raster(n: usize, lo: f64, hi: f64) -> Vec<f64> {
    (0..n).map(|i| lo * (hi / lo).powf(i as f64 / (n - 1) as f64)).collect()
}

/// Analoges Soll eines Bandes in dB (Cuts: Butterworth-Kaskade wie spezifiziert).
fn soll_db(b: &BandEinstellung, f: f64) -> f64 {
    let x = f / b.freq;
    let sek = |a: Art, g: f64, q: f64| prototyp(a, g, q).betrag_db(x);
    match b.art {
        BandArt::Glocke => sek(Art::Glocke, b.gain_db, b.q),
        BandArt::LowShelf => sek(Art::LowShelf, b.gain_db, b.q),
        BandArt::HighShelf => sek(Art::HighShelf, b.gain_db, b.q),
        BandArt::Kerbe => sek(Art::Kerbe, 0.0, b.q),
        BandArt::Bandpass => sek(Art::Bandpass, 0.0, b.q),
        BandArt::LowCut | BandArt::HighCut => {
            let a = if b.art == BandArt::LowCut { Art::Hochpass } else { Art::Tiefpass };
            let n = match b.steilheit { Steilheit::Db12 => 1, Steilheit::Db24 => 2, Steilheit::Db36 => 3, Steilheit::Db48 => 4 };
            if n == 1 {
                return sek(a, 0.0, b.q);
            }
            (0..n)
                .map(|i| {
                    let th = PI * (2 * i + 1) as f64 / (4 * n) as f64;
                    let mut q = 1.0 / (2.0 * th.cos());
                    if i == n - 1 {
                        q *= b.q / std::f64::consts::FRAC_1_SQRT_2;
                    }
                    sek(a, 0.0, q)
                })
                .sum()
        }
    }
}

/// Größte Abweichung System − Soll bis 20 kHz, wo das Soll über −24 dB liegt.
fn max_abweichung(fs: f64, b: &BandEinstellung) -> (f64, f64) {
    let h = impulsantwort(fs, &[*b]);
    let mut schlimmst = (0.0f64, 0.0);
    for f in log_raster(160, 20.0, 20000.0) {
        let soll = soll_db(b, f);
        if soll < -24.0 {
            continue;
        }
        let d = (betrag_db(&h, f, fs) - soll).abs();
        if d > schlimmst.0 {
            schlimmst = (d, f);
        }
    }
    schlimmst
}

#[test]
fn fehlerfall_glocke_16k_wie_a_eq() {
    // Der am a-eq gemessene Fall: +12 dB bei 16 kHz, Q 1,425 (a-eq bw=1), 44,1 kHz.
    let fs = 44100.0;
    let b = band(BandArt::Glocke, 16000.0, 12.0, 1.425);
    let soll = soll_db(&b, 20000.0);
    let h = impulsantwort(fs, &[b]);
    let ist = betrag_db(&h, 20000.0, fs);
    // Negativkontrolle: der Lehrbuchentwurf (Bauweise a-eq) muss hier scheitern.
    let bil = entwurf::bilinear(&prototyp(Art::Glocke, 12.0, 1.425), 16000.0, fs).betrag_db(20000.0, fs);
    println!("20 kHz: Soll {soll:.2} dB, Cypher EQ {ist:.2} dB, bilinear {bil:.2} dB");
    assert!((soll - 8.22).abs() < 0.01, "Soll falsch berechnet: {soll}");
    assert!((bil - soll).abs() > 3.0, "Negativkontrolle trifft nicht: bilinear {bil}");
    assert!((ist - soll).abs() < 0.5, "Cypher EQ {ist} statt {soll}");
}

#[test]
fn alle_arten_folgen_der_sollkurve() {
    let mut schlimmst = (0.0f64, String::new());
    for fs in [44100.0, 48000.0, 96000.0] {
        for (art, gains) in [
            (BandArt::Glocke, &[-18.0, -6.0, 6.0, 18.0][..]),
            (BandArt::LowShelf, &[-12.0, 12.0][..]),
            (BandArt::HighShelf, &[-12.0, 12.0][..]),
            (BandArt::LowCut, &[0.0][..]),
            (BandArt::HighCut, &[0.0][..]),
            (BandArt::Kerbe, &[0.0][..]),
            (BandArt::Bandpass, &[0.0][..]),
        ] {
            for &f0 in &[40.0, 1000.0, 8000.0, 16000.0, 20000.0] {
                for &g in gains {
                    for &q in &[0.5, 1.0, 4.0] {
                        let b = band(art, f0, g, q);
                        let (d, f) = max_abweichung(fs, &b);
                        if d > schlimmst.0 {
                            schlimmst = (d, format!("{art:?} fs {fs} f0 {f0} G {g} Q {q} bei {f:.0} Hz"));
                        }
                    }
                }
            }
        }
    }
    println!("größte Abweichung {:.3} dB: {}", schlimmst.0, schlimmst.1);
    assert!(schlimmst.0 < 0.5, "{:.3} dB: {}", schlimmst.0, schlimmst.1);
}

#[test]
fn steilheiten_folgen_der_sollkurve() {
    for art in [BandArt::LowCut, BandArt::HighCut] {
        for st in [Steilheit::Db12, Steilheit::Db24, Steilheit::Db36, Steilheit::Db48] {
            for f0 in [80.0, 5000.0, 15000.0] {
                for q in [0.707, 2.0] {
                    let b = BandEinstellung { steilheit: st, ..band(art, f0, 0.0, q) };
                    let (d, f) = max_abweichung(44100.0, &b);
                    assert!(d < 0.5, "{art:?} {st:?} f0 {f0} Q {q}: {d:.3} dB bei {f:.0} Hz");
                }
            }
        }
    }
}

#[test]
fn transparent_wenn_neutral() {
    // Alle Bänder aus, und alle Glocken an mit 0 dB: Ausgang = Eingang, nur verzögert.
    for neutral in [vec![], (0..8).map(|i| band(BandArt::Glocke, 100.0 * (i + 1) as f64, 0.0, 1.0)).collect()] {
        let fs = 44100.0;
        let mut eq = Eq::neu(fs);
        for (i, b) in neutral.iter().enumerate() {
            eq.setze_band(i, *b);
        }
        let lat = eq.latenz();
        assert_eq!(lat, 69);
        let n = 8192;
        let x: Vec<f32> = (0..n).map(|i| (0.5 * (2.0 * PI * 997.0 * i as f64 / fs).sin() + 0.3 * (2.0 * PI * 15013.0 * i as f64 / fs).sin()) as f32).collect();
        let (mut l, mut r) = (x.clone(), x.clone());
        eq.verarbeite_stereo(&mut l, &mut r);
        let fehler = (2000..n).map(|i| (l[i] - x[i - lat]).abs()).fold(0.0f32, f32::max);
        let db = 20.0 * (fehler as f64).log10();
        println!("Bänder {}: max. Fehler {db:.1} dBFS", neutral.len());
        assert!(db < -90.0, "nicht transparent: {db:.1} dBFS");
    }
}

#[test]
fn ohne_ueberabtastung_ab_88k_keine_latenz() {
    assert_eq!(Eq::neu(96000.0).latenz(), 0);
    assert_eq!(Eq::neu(48000.0).latenz(), 69);
}

/// Energie oberhalb 16 kHz relativ zum Gesamtsignal (dB), ab Sample `ab`. Ein 1-kHz-Sinus durch
/// Filter unter 10 kHz hat dort nichts zu suchen: was dort liegt, sind Knackser. Der Messfilter
/// läuft über das GANZE Signal; mitten im Signal von null zu starten knackt selbst (gemessen:
/// −53 dB Messartefakt statt −118 dB echt).
fn hf_anteil_db(y: &[f64], fs: f64, ab: usize) -> f64 {
    let hp = entwurf::bilinear(&prototyp(Art::Hochpass, 0.0, 0.707), 16000.0, fs);
    let mut z = y.to_vec();
    for _ in 0..4 {
        let (mut x1, mut x2, mut y1, mut y2) = (0.0, 0.0, 0.0, 0.0);
        for v in z.iter_mut() {
            let x = *v;
            let o = hp.b[0] * x + hp.b[1] * x1 + hp.b[2] * x2 - hp.a[0] * y1 - hp.a[1] * y2;
            (x2, x1, y2, y1) = (x1, x, y1, o);
            *v = o;
        }
    }
    let e = |s: &[f64]| s.iter().map(|v| v * v).sum::<f64>();
    10.0 * (e(&z[ab..]) / e(&y[ab..])).log10()
}

#[test]
fn drehen_knackt_nicht() {
    let fs = 48000.0;
    let n = 48000;
    let sinus = |i: usize| 0.5 * (2.0 * PI * 1000.0 * i as f64 / fs).sin();
    let frequenz = |i: usize| 100.0 * 100f64.powf((i as f64 / 2400.0 * PI).sin().abs()); // 100 Hz ↔ 10 kHz, 20 Durchläufe/s
    // Cypher EQ: Parameter alle 32 Samples neu, wie ein Host mit kleinen Blöcken
    let mut eq = Eq::neu(fs);
    let mut y = Vec::with_capacity(n);
    for blk in 0..n / 32 {
        eq.setze_band(0, band(BandArt::Glocke, frequenz(blk * 32), 12.0, 8.0));
        let mut l: Vec<f32> = (0..32).map(|i| sinus(blk * 32 + i) as f32).collect();
        let mut r = l.clone();
        eq.verarbeite_stereo(&mut l, &mut r);
        y.extend(l.iter().map(|&v| v as f64));
    }
    let wir = hf_anteil_db(&y, fs, 4800);
    // Negativkontrolle: Direktform-Biquad, Koeffizienten springen alle 32 Samples (ohne Glättung)
    let mut y2 = Vec::with_capacity(n);
    let (mut x1, mut x2, mut y1, mut yy2) = (0.0, 0.0, 0.0, 0.0);
    for i in 0..n {
        let bq = entwurf::bilinear(&prototyp(Art::Glocke, 12.0, 8.0), frequenz(i / 32 * 32), fs);
        let x = sinus(i);
        let o = bq.b[0] * x + bq.b[1] * x1 + bq.b[2] * x2 - bq.a[0] * y1 - bq.a[1] * yy2;
        (x2, x1, yy2, y1) = (x1, x, y1, o);
        y2.push(o);
    }
    let naiv = hf_anteil_db(&y2, fs, 4800);
    println!("HF-Anteil beim Durchfahren: Cypher EQ {wir:.1} dB, naiver Biquad {naiv:.1} dB");
    assert!(naiv > wir + 20.0, "Negativkontrolle zeigt keinen Unterschied: naiv {naiv:.1}, wir {wir:.1}");
    assert!(wir < -80.0, "Cypher EQ knackt: {wir:.1} dB");
}

#[test]
fn umschalten_knackt_nicht() {
    // Glocke → LowCut 48 dB → Kerbe → aus, mitten im 1-kHz-Sinus: HF-Anteil bleibt klein.
    let fs = 48000.0;
    let mut eq = Eq::neu(fs);
    let folge = [
        band(BandArt::Glocke, 2000.0, 12.0, 1.0),
        BandEinstellung { steilheit: Steilheit::Db48, ..band(BandArt::LowCut, 300.0, 0.0, 0.707) },
        band(BandArt::Kerbe, 3000.0, 0.0, 2.0),
        BandEinstellung { an: false, ..band(BandArt::Kerbe, 3000.0, 0.0, 2.0) },
    ];
    let mut y = Vec::new();
    for (k, b) in folge.iter().enumerate() {
        eq.setze_band(0, *b);
        let mut l: Vec<f32> = (0..9600).map(|i| (0.5 * (2.0 * PI * 1000.0 * (k * 9600 + i) as f64 / fs).sin()) as f32).collect();
        let mut r = l.clone();
        eq.verarbeite_stereo(&mut l, &mut r);
        y.extend(l.iter().map(|&v| v as f64));
    }
    let hf = hf_anteil_db(&y, fs, 4800);
    println!("HF-Anteil beim Umschalten: {hf:.1} dB");
    assert!(hf < -100.0, "Umschalten knackt: {hf:.1} dB");
}

#[test]
fn mid_side() {
    let fs = 48000.0;
    // Mono-Material (L = R) hat keinen Side-Anteil: ein Side-Band darf nichts ändern.
    let mut eq = Eq::neu(fs);
    eq.setze_band(0, BandEinstellung { kanal: Kanal::Side, ..band(BandArt::Glocke, 1000.0, 18.0, 1.0) });
    let x: Vec<f32> = (0..4800).map(|i| (0.5 * (2.0 * PI * 1000.0 * i as f64 / fs).sin()) as f32).collect();
    let (mut l, mut r) = (x.clone(), x.clone());
    eq.verarbeite_stereo(&mut l, &mut r);
    let lat = eq.latenz();
    let fehler = (1000..4800).map(|i| (l[i] - x[i - lat]).abs()).fold(0.0f32, f32::max);
    assert!(fehler < 1e-4, "Side-Band ändert Mono-Material: {fehler}");
    // Ein Mid-Band mit +6 dB bei 1 kHz hebt Mono-Material um 6 dB.
    let mut eq = Eq::neu(fs);
    eq.setze_band(0, BandEinstellung { kanal: Kanal::Mid, ..band(BandArt::Glocke, 1000.0, 6.0, 1.0) });
    let (mut l, mut r) = (x.clone(), x.clone());
    eq.verarbeite_stereo(&mut l, &mut r);
    let spitze = l[2000..].iter().fold(0.0f32, |m, v| m.max(v.abs()));
    let db = 20.0 * (spitze as f64 / 0.5).log10();
    assert!((db - 6.0).abs() < 0.05, "Mid +6 dB ergibt {db:.3} dB");
    // Gegenprobe: reines Side-Material (L = −R) wird vom Side-Band sehr wohl bearbeitet.
    let mut eq = Eq::neu(fs);
    eq.setze_band(0, BandEinstellung { kanal: Kanal::Side, ..band(BandArt::Glocke, 1000.0, 6.0, 1.0) });
    let mut l = x.clone();
    let mut r: Vec<f32> = x.iter().map(|v| -v).collect();
    eq.verarbeite_stereo(&mut l, &mut r);
    let spitze = l[2000..].iter().fold(0.0f32, |m, v| m.max(v.abs()));
    let db = 20.0 * (spitze as f64 / 0.5).log10();
    assert!((db - 6.0).abs() < 0.05, "Side +6 dB auf Side-Material ergibt {db:.3} dB");
}

#[test]
fn stabil_bei_extremen_einstellungen() {
    let fs = 44100.0;
    let mut eq = Eq::neu(fs);
    let mut zufall = 12345u64;
    let mut rnd = || {
        zufall ^= zufall << 13;
        zufall ^= zufall >> 7;
        zufall ^= zufall << 17;
        (zufall % 1_000_000) as f64 / 1_000_000.0
    };
    let arten = [BandArt::Glocke, BandArt::LowShelf, BandArt::HighShelf, BandArt::LowCut, BandArt::HighCut, BandArt::Kerbe, BandArt::Bandpass];
    let steil = [Steilheit::Db12, Steilheit::Db24, Steilheit::Db36, Steilheit::Db48];
    let mut spitze = 0.0f32;
    for blk in 0..2000 {
        for i in 0..8 {
            eq.setze_band(i, BandEinstellung {
                an: rnd() > 0.2,
                art: arten[(rnd() * 7.0) as usize % 7],
                freq: 10.0 * 2200f64.powf(rnd()),
                gain_db: -24.0 + 48.0 * rnd(),
                q: 0.1 * 180f64.powf(rnd()),
                steilheit: steil[(rnd() * 4.0) as usize % 4],
                kanal: [Kanal::Stereo, Kanal::Mid, Kanal::Side][(rnd() * 3.0) as usize % 3],
            });
        }
        eq.setze_prop_q(blk % 3 == 0);
        let mut l: Vec<f32> = (0..64).map(|_| (rnd() - 0.5) as f32).collect();
        let mut r: Vec<f32> = (0..64).map(|_| (rnd() - 0.5) as f32).collect();
        eq.verarbeite_stereo(&mut l, &mut r);
        for v in l.iter().chain(r.iter()) {
            assert!(v.is_finite(), "NaN/Inf in Block {blk}");
            spitze = spitze.max(v.abs());
        }
    }
    println!("Spitze unter Zufallsbeschuss: {spitze:.1}");
    // 8 × 24 dB in Reihe wären theoretisch 192 dB; hier geht es nur um Stabilität, nicht um Pegel
    assert!(spitze < 1e7, "instabil: Spitze {spitze}");
}

#[test]
fn svf_realisiert_das_biquad_exakt() {
    let fs = 48000.0;
    let bq = entwurf::passend(&prototyp(Art::Glocke, 9.0, 3.0), 12000.0, fs);
    let svf = als_svf(&bq);
    // Impulsantwort der SVF-Struktur von Hand
    let (mut ic1, mut ic2) = (0.0f64, 0.0f64);
    let mut h = vec![0.0; 4096];
    for (n, hn) in h.iter_mut().enumerate() {
        let x = if n == 0 { 1.0 } else { 0.0 };
        let a1 = 1.0 / (1.0 + svf.g * (svf.g + svf.k));
        let (a2, a3) = (svf.g * a1, svf.g * svf.g * a1);
        let v3 = x - ic2;
        let v1 = a1 * ic1 + a2 * v3;
        let v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2.0 * v1 - ic1;
        ic2 = 2.0 * v2 - ic2;
        *hn = svf.m0 * x + svf.m1 * v1 + svf.m2 * v2;
    }
    for f in [50.0, 1000.0, 12000.0, 20000.0, 23000.0] {
        let d = (betrag_db(&h, f, fs) - bq.betrag_db(f, fs)).abs();
        assert!(d < 1e-6, "SVF ≠ Biquad bei {f} Hz: {d}");
    }
    let _ = Biquad { b: [0.0; 3], a: [0.0; 2] };
}
