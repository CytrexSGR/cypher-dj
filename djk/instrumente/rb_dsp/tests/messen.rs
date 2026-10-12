//! Offline-Messungen der RB-338-DSP. Jede Messung hat eine Gegenprobe.
use rb_dsp::Osz;

pub const SR: f32 = 48_000.0;

/// Grundfrequenz über steigende Nulldurchgänge des gleichanteilfreien Signals (reicht für Sägezahn/Rechteck).
pub fn grundfrequenz(x: &[f32], sr: f32) -> f32 {
    let mittel = x.iter().sum::<f32>() / x.len() as f32;
    let mut erste = None;
    let mut letzte = 0usize;
    let mut n = 0usize;
    for i in 1..x.len() {
        if x[i - 1] - mittel < 0.0 && x[i] - mittel >= 0.0 {
            if erste.is_none() { erste = Some(i); } else { n += 1; letzte = i; }
        }
    }
    match erste { Some(e) if n > 0 => n as f32 * sr / (letzte - e) as f32, _ => 0.0 }
}

pub fn rms_db(x: &[f32]) -> f32 {
    let r = (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt();
    20.0 * r.max(1e-9).log10()
}

#[test]
fn saege_110_hz() {
    let mut o = Osz::default();
    let x: Vec<f32> = (0..SR as usize).map(|_| o.saege(110.0 / SR)).collect();
    let f = grundfrequenz(&x, SR);
    assert!((f - 110.0).abs() < 0.5, "f0 {f}");
    let spitze = x.iter().fold(0f32, |m, v| m.max(v.abs()));
    assert!(spitze <= 1.1 && spitze > 0.9, "spitze {spitze}");
}

#[test]
fn rechteck_55_hz() {
    let mut o = Osz::default();
    let x: Vec<f32> = (0..SR as usize).map(|_| o.rechteck(55.0 / SR)).collect();
    assert!((grundfrequenz(&x, SR) - 55.0).abs() < 0.5);
}

#[test]
fn gegenprobe_ohne_inkrement_still() {
    let mut o = Osz::default();
    let x: Vec<f32> = (0..4800).map(|_| o.saege(0.0)).collect();
    assert_eq!(grundfrequenz(&x, SR), 0.0);
}

use rb_dsp::Ladder;

fn sinus_durch(f: &mut Ladder, hz: f32, cutoff: f32, reso: f32) -> f32 {
    let n = SR as usize / 2;
    let mut aus = Vec::with_capacity(n);
    for i in 0..n {
        let x = 0.1 * (std::f32::consts::TAU * hz * i as f32 / SR).sin();
        aus.push(f.prozess(x, cutoff, reso, SR));
    }
    rms_db(&aus[n / 2..]) - rms_db(&[0.1 / std::f32::consts::SQRT_2])
}

#[test]
fn ladder_durchlass_und_sperre() {
    let mut f = Ladder::default();
    let unten = sinus_durch(&mut f, 50.0, 1000.0, 0.0);
    assert!(unten.abs() < 1.0, "50 Hz unter 1 kHz: {unten} dB");
    let mut f = Ladder::default();
    let grenze = sinus_durch(&mut f, 1000.0, 1000.0, 0.0);
    assert!((grenze + 12.0).abs() < 3.0, "an der Grenze ~ −12 dB (4 Pole): {grenze} dB");
    let mut f = Ladder::default();
    let oben = sinus_durch(&mut f, 4000.0, 1000.0, 0.0);
    assert!(oben < -36.0, "zwei Oktaven drüber: {oben} dB");
}

#[test]
fn ladder_resonanz_hebt_grenze_und_bleibt_endlich() {
    let mut f = Ladder::default();
    let ohne = sinus_durch(&mut f, 1000.0, 1000.0, 0.0);
    let mut f = Ladder::default();
    let mit = sinus_durch(&mut f, 1000.0, 1000.0, 0.9);
    assert!(mit > ohne + 6.0, "Resonanz 0.9 hebt die Grenze: {ohne} → {mit}");
    let mut f = Ladder::default();
    let mut max = 0f32;
    for i in 0..48_000 {
        let x = if i == 0 { 1.0 } else { 0.0 };
        let y = f.prozess(x, 500.0, 1.0, SR);
        assert!(y.is_finite());
        max = max.max(y.abs());
    }
    assert!(max < 4.0, "Impulsantwort bei Resonanz 1 bleibt begrenzt: {max}");
}

use rb_dsp::{Stimme, StimmParams};

fn rendere(st: &mut Stimme, p: &StimmParams, n: usize) -> Vec<f32> {
    (0..n).map(|_| st.prozess(p, SR)).collect()
}

#[test]
fn stimme_spielt_note_und_wird_still() {
    let p = StimmParams::default();
    let mut st = Stimme::default();
    st.an(45, 0.8, false);
    let x = rendere(&mut st, &p, 24_000);
    assert!(rms_db(&x[2_400..]) > -30.0);
    assert!((grundfrequenz(&x[2_400..], SR) - 110.0).abs() < 1.5);
    st.aus();
    let _ = rendere(&mut st, &p, 4_800);
    let still = rendere(&mut st, &p, 4_800);
    assert!(rms_db(&still) < -80.0, "nach Release: {}", rms_db(&still));
}

#[test]
fn accent_lauter_und_heller() {
    let p = StimmParams { cutoff: 400.0, env_mod: 0.5, ..StimmParams::default() };
    let mut a = Stimme::default();
    a.an(45, 0.5, false);
    let normal = rendere(&mut a, &p, 4_800);
    let mut b = Stimme::default();
    b.an(45, 1.0, false);
    let akzent = rendere(&mut b, &p, 4_800);
    assert!(rms_db(&akzent) > rms_db(&normal) + 2.0, "{} vs {}", rms_db(&akzent), rms_db(&normal));
    // heller: der Filter öffnet weiter (getrennt vom Pegel gemessen; ohne Filterakzent wäre nur der Pegeltest grün)
    let mut a = Stimme::default();
    a.an(45, 0.5, false);
    let mut b = Stimme::default();
    b.an(45, 1.0, false);
    for _ in 0..240 { a.prozess(&p, SR); b.prozess(&p, SR); }
    assert!(b.cutoff_ist() > a.cutoff_ist() * 1.3, "{} vs {}", b.cutoff_ist(), a.cutoff_ist());
}

#[test]
fn strudel_vorgabe_velocity_ist_kein_akzent() {
    // Strudel setzt ohne .velocity() 0.9 → 114/127 (djk/erzeuger/src/fenster.mjs:48, erzeuger.cpp:176)
    assert!(114.0 / 127.0 < rb_dsp::ACCENT_AB);
    assert!(1.0 >= rb_dsp::ACCENT_AB);
}

#[test]
fn gegenprobe_ohne_note_still() {
    let mut st = Stimme::default();
    let x = rendere(&mut st, &StimmParams::default(), 4_800);
    assert!(rms_db(&x) < -120.0);
}

#[test]
fn slide_gleitet_in_60_ms_ohne_neuanschlag() {
    let p = StimmParams { cutoff: 3000.0, env_mod: 0.0, ..StimmParams::default() };
    let mut st = Stimme::default();
    st.an(45, 0.6, false);
    let _ = rendere(&mut st, &p, 9_600);
    st.an(57, 0.6, true);
    let x = rendere(&mut st, &p, 24_000);
    let unterwegs = grundfrequenz(&x[960..2_880], SR); // 20..60 ms: bei 60 ms Glide etwa 145..175 Hz
    let spaet = grundfrequenz(&x[14_400..], SR);      // ab 300 ms: angekommen
    assert!(unterwegs > 130.0 && unterwegs < 185.0, "20..60 ms noch unterwegs: {unterwegs}");
    assert!((spaet - 220.0).abs() < 2.0, "angekommen: {spaet}");
    let mut g = Stimme::default();
    g.an(45, 0.6, false);
    let _ = rendere(&mut g, &p, 9_600);
    g.an(57, 0.6, false);
    let y = rendere(&mut g, &p, 960);
    assert!((grundfrequenz(&y, SR) - 220.0).abs() < 5.0, "Gegenprobe ohne Slide springt sofort");
}

#[test]
fn slide_schlaegt_die_filterhuellkurve_nicht_neu_an() {
    let p = StimmParams { cutoff: 400.0, env_mod: 0.5, ..StimmParams::default() };
    let vorher_nachher = |slide: bool| {
        let mut st = Stimme::default();
        st.an(45, 0.6, false);
        let _ = rendere(&mut st, &p, 9_600); // 200 ms: Hüllkurve ist schon abgefallen
        st.prozess(&p, SR);
        let vor = st.cutoff_ist();
        st.an(57, 0.6, slide);
        st.prozess(&p, SR);
        (vor, st.cutoff_ist())
    };
    let (v, n) = vorher_nachher(true);
    assert!(n <= v, "Slide: Cutoff fällt weiter, {v} -> {n}");
    let (v, n) = vorher_nachher(false);
    assert!(n > v * 1.5, "Gegenprobe Neuanschlag: Cutoff springt hoch, {v} -> {n}");
}

/// Energie (Summe |X|², Hann-Fenster) im Band lo..hi Hz per DFT über die Bins im 10-Hz-Raster.
fn bandenergie(x: &[f32], sr: f32, lo: f32, hi: f32) -> f32 {
    let n = x.len();
    let mut e = 0.0f32;
    let mut f = lo;
    while f <= hi {
        let (mut re, mut im) = (0.0f64, 0.0f64);
        for (i, v) in x.iter().enumerate() {
            let w = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / n as f64).cos();
            let a = std::f64::consts::TAU * f as f64 * i as f64 / sr as f64;
            re += *v as f64 * w * a.cos();
            im -= *v as f64 * w * a.sin();
        }
        e += (re * re + im * im) as f32;
        f += 10.0;
    }
    e
}

#[test]
fn polyblep_drueckt_aliasing_unter_der_grundfrequenz() {
    // Säge bei 3011 Hz (kein ganzzahliges Teilverhältnis zu 48 kHz): die gespiegelten Obertöne fallen zwischen die echten,
    // auch unter die Grundfrequenz. Dort gehört bei einer bandbegrenzten Säge nichts hin.
    let f0 = 3011.0f32;
    let inc = f0 / SR;
    let n = 8_192;
    let mut o = Osz::default();
    let mit: Vec<f32> = (0..n).map(|_| o.saege(inc)).collect();
    let mut ph = 0.0f32;
    let naiv: Vec<f32> = (0..n).map(|_| { let y = 2.0 * ph - 1.0; ph += inc; if ph >= 1.0 { ph -= 1.0; } y }).collect();
    let grund = bandenergie(&mit, SR, f0 - 50.0, f0 + 50.0);
    let alias_mit = bandenergie(&mit, SR, 100.0, f0 - 300.0);
    let alias_naiv = bandenergie(&naiv, SR, 100.0, f0 - 300.0);
    let db = |e: f32, r: f32| 10.0 * (e / r).log10();
    eprintln!("Aliasing unter der Grundfrequenz relativ zur Grundwelle: PolyBLEP {:.1} dB, naiv {:.1} dB", db(alias_mit, grund), db(alias_naiv, grund));
    assert!(db(alias_mit, grund) < db(alias_naiv, grund) - 10.0,
            "PolyBLEP {:.1} dB vs naiv {:.1} dB", db(alias_mit, grund), db(alias_naiv, grund));
    assert!(db(alias_naiv, grund) > -45.0, "Gegenprobe: die naive Säge aliast messbar ({:.1} dB)", db(alias_naiv, grund));
}
