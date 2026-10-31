//! Die Bausteine aus Slice 2, je mit Messung und Gegenprobe. Aliasing misst `alias_db`: die Grundfrequenz liegt genau
//! auf Bin 263 einer 4096er-DFT (prim, 4096 mod 263 ≠ 0), Spiegelungen fallen deshalb neben die Harmonischen; gemessen
//! wird der Energieanteil außerhalb der Harmonischen (Parseval minus Goertzel je Harmonischer).
use baukasten_dsp::{uebersetze, Fehler, Programm};

const SR: f32 = 48_000.0;
const N: usize = 4096;
const BIN: usize = 263;
const F_BIN: f32 = BIN as f32 * SR / N as f32; // 3081,8 Hz

fn graph(stimmen: usize, knoten: &str, kanten: &str) -> String {
    format!(r#"{{"format":"baukasten/2","name":"t","stimmen":{stimmen},"knoten":[{knoten}],"kanten":[{kanten}]}}"#)
}
fn lade(j: &str) -> Programm { uebersetze(j, SR).unwrap_or_else(|e| panic!("{e}: {j}")) }
fn spiele(p: &mut Programm, n: usize) -> Vec<f32> { (0..n).map(|_| p.sample()).collect() }
fn rms(x: &[f32]) -> f32 { (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt() }
fn db(v: f32) -> f32 { 20.0 * v.max(1e-12).log10() }

/// Leistung bei Bin k (Goertzel), normiert wie Parseval: Summe über alle Bins = Summe x².
fn bin_leistung(x: &[f32], k: usize) -> f64 {
    let w = 2.0 * std::f64::consts::PI * k as f64 / x.len() as f64;
    let (mut s1, mut s2) = (0.0f64, 0.0f64);
    for v in x {
        let s = *v as f64 + 2.0 * w.cos() * s1 - s2;
        s2 = s1;
        s1 = s;
    }
    let p = s1 * s1 + s2 * s2 - 2.0 * w.cos() * s1 * s2;
    p * if k == 0 || 2 * k == x.len() { 1.0 } else { 2.0 } / x.len() as f64
}

/// Anteil der Energie außerhalb von Gleichanteil und Harmonischen von BIN, in dB.
fn alias_db(x: &[f32]) -> f32 {
    assert_eq!(x.len(), N);
    let gesamt: f64 = x.iter().map(|v| (*v as f64).powi(2)).sum();
    let mut harm = bin_leistung(x, 0);
    let mut k = BIN;
    while k <= N / 2 {
        harm += bin_leistung(x, k);
        k += BIN;
    }
    (10.0 * ((gesamt - harm).max(1e-30) / gesamt).log10()) as f32
}

/// Grundfrequenz über steigende Nulldurchgänge
fn grundfrequenz(x: &[f32]) -> f32 {
    let m = x.iter().sum::<f32>() / x.len() as f32;
    let (mut erste, mut letzte, mut n) = (None, 0usize, 0usize);
    for i in 1..x.len() {
        if x[i - 1] - m < 0.0 && x[i] - m >= 0.0 {
            if erste.is_none() { erste = Some(i); } else { n += 1; letzte = i; }
        }
    }
    match erste { Some(e) if n > 0 => n as f32 * SR / (letzte - e) as f32, _ => 0.0 }
}

/// Ein Oszillator `art` mit festem hz an einem Ausgang, eingeschwungen: N Samples nach 1000 Vorlauf.
fn osz(art: &str, hz: f32, extra: &str) -> Vec<f32> {
    let j = graph(1, &format!(r#"{{"id":"o","art":"{art}","hz":{hz}{extra}}},{{"id":"a","art":"ausgang"}}"#), r#"{"von":"o.aus","nach":"a.x"}"#);
    let mut p = lade(&j);
    spiele(&mut p, 1000);
    spiele(&mut p, N)
}

#[test]
fn regler_linear_und_logarithmisch_und_nur_der_eigene() {
    let j = graph(1, r#"{"id":"r","art":"regler","nr":1,"min":100,"max":500},{"id":"l","art":"regler","nr":2,"min":100,"max":10000,"log":1},{"id":"m","art":"mul"},{"id":"a","art":"ausgang"}"#,
        r#"{"von":"r.aus","nach":"m.a"},{"von":"l.aus","nach":"m.b"},{"von":"m.aus","nach":"a.x"}"#);
    let mut p = lade(&j);
    assert_eq!(p.sample(), 300.0 * 1000.0, "Vorgabe 0,5: linear 300, log 1000");
    p.setze_regler(1, 0.25);
    assert_eq!(p.sample(), 200.0 * 1000.0);
    p.setze_regler(2, 1.0);
    assert!((p.sample() - 200.0 * 10000.0).abs() < 1.0);
    p.setze_regler(9, 0.0); // fremde Nummer: wirkungslos
    p.setze_regler(0, 0.0);
    assert!((p.sample() - 200.0 * 10000.0).abs() < 1.0);
}

#[test]
fn saege_ohne_sync_bitgleich_mit_slice_1() {
    let x = osz("saege", 1234.5, "");
    let mut alt = rb_dsp::Osz::default();
    let inc = 1234.5 / SR;
    let alt: Vec<f32> = (0..1000 + N).map(|_| alt.saege(inc)).skip(1000).collect();
    assert_eq!(x, alt);
}

#[test]
fn puls_tastgrad_folgt_pwm_und_blep_drueckt_aliasing() {
    let mittel = |pwm: f32| {
        let x = osz("puls", 110.0, &format!(r#","pwm":{pwm}"#));
        x.iter().sum::<f32>() / x.len() as f32
    };
    assert!(mittel(0.0).abs() < 0.02, "pwm 0 = 50 %: {}", mittel(0.0));
    // Tastgrad 0,5 + 0,45·0,8 = 0,86 → Mittel 2·0,86 − 1 = 0,72
    assert!((mittel(0.8) - 0.72).abs() < 0.02, "{}", mittel(0.8));
    let x = osz("puls", F_BIN, r#","pwm":-0.4"#);
    let mut naiv = Vec::new();
    let mut t = 0.0f32;
    for i in 0..1000 + N {
        if i >= 1000 { naiv.push(if t < 0.32 { 1.0 } else { -1.0 }); }
        t = (t + F_BIN / SR).fract();
    }
    let (a, an) = (alias_db(&x), alias_db(&naiv));
    eprintln!("MESS alias {a:.1} dB, naiv {an:.1} dB");
    assert!(a < an - 6.0, "PolyBLEP {a:.1} dB, naiv {an:.1} dB");
}

#[test]
fn dreieck_mit_blamp_naeher_am_bandbegrenzten_als_naiv() {
    let x = osz("dreieck", F_BIN, "");
    assert!((grundfrequenz(&osz("dreieck", 110.0, "")) - 110.0).abs() < 0.5);
    let mut naiv = Vec::new();
    let mut t = 0.0f32;
    for i in 0..1000 + N {
        if i >= 1000 { naiv.push(4.0 * (t - 0.5).abs() - 1.0); }
        t = (t + F_BIN / SR).fract();
    }
    let (a, an) = (alias_db(&x), alias_db(&naiv));
    eprintln!("MESS alias {a:.1} dB, naiv {an:.1} dB");
    assert!(a < an - 6.0, "PolyBLAMP {a:.1} dB, naiv {an:.1} dB");
}

#[test]
fn sync_folgt_dem_leiter_und_blep_drueckt_aliasing() {
    let leiter_slave = |extra: &str| {
        let j = graph(1, &format!(r#"{{"id":"m","art":"saege","hz":{F_BIN}}},{{"id":"s","art":"saege","hz":{}{extra}}},{{"id":"a","art":"ausgang"}}"#, F_BIN * 1.73),
            r#"{"von":"m.zyklus","nach":"s.sync"},{"von":"s.aus","nach":"a.x"}"#);
        let mut p = lade(&j);
        spiele(&mut p, 1000);
        spiele(&mut p, N)
    };
    let x = leiter_slave("");
    // naiv: dieselbe Phase ohne Glättung
    let (mut tm, mut ts, mut naiv) = (0.0f32, 0.0f32, Vec::new());
    for i in 0..1000 + N {
        if i >= 1000 { naiv.push(2.0 * ts - 1.0); }
        tm += F_BIN / SR;
        ts += F_BIN * 1.73 / SR;
        if tm >= 1.0 { tm -= 1.0; ts = tm * 1.73; }
        ts = ts.fract();
    }
    let (a, an) = (alias_db(&x), alias_db(&naiv));
    eprintln!("MESS alias {a:.1} dB, naiv {an:.1} dB");
    // gemessen: mit BLEP −17,1 dB, ohne die Glättung am Sync-Sprung −12,3, naiv −8,8
    assert!(a < an - 6.0, "Sync mit BLEP {a:.1} dB, naiv {an:.1} dB");
    // Gegenprobe: ohne Sync-Kante läuft die Säge auf ihrer eigenen Frequenz
    let frei = osz("saege", 110.0 * 1.73, "");
    assert!((grundfrequenz(&frei) - 110.0 * 1.73).abs() < 1.0);
}

#[test]
fn sinus_fm_verschiebt_und_laeuft_durch_null() {
    assert!((grundfrequenz(&osz("sinus", 220.0, r#","fm":220"#)) - 440.0).abs() < 1.0);
    // 100 Hz − 300 Hz = −200 Hz: rückwärts, hörbar 200 Hz, endlich
    let x = osz("sinus", 100.0, r#","fm":-300"#);
    assert!(x.iter().all(|v| v.is_finite()));
    assert!((grundfrequenz(&x) - 200.0).abs() < 1.0, "{}", grundfrequenz(&x));
    assert!((rms(&x) - std::f32::consts::FRAC_1_SQRT_2).abs() < 0.01);
}

#[test]
fn rauschen_weiss_je_stimme_anders_und_wiederholbar() {
    let j = graph(2, r#"{"id":"r","art":"rauschen"},{"id":"a","art":"ausgang"}"#, r#"{"von":"r.aus","nach":"a.x"}"#);
    let (mut p, mut q) = (lade(&j), lade(&j));
    let (x, y) = (spiele(&mut p, 48_000), spiele(&mut q, 48_000));
    assert_eq!(x, y, "bitgleich bei gleichem Graphen");
    // Summe zweier unabhängiger Gleichverteilungen: rms √(2/3)
    assert!((rms(&x) - (2.0f32 / 3.0).sqrt()).abs() < 0.02, "rms {}", rms(&x));
    let einzeln = graph(1, r#"{"id":"r","art":"rauschen"},{"id":"a","art":"ausgang"}"#, r#"{"von":"r.aus","nach":"a.x"}"#);
    let z = spiele(&mut lade(&einzeln), 48_000);
    assert!((rms(&z) - (1.0f32 / 3.0).sqrt()).abs() < 0.02, "rms {}", rms(&z));
    assert!((x.iter().sum::<f32>() / x.len() as f32).abs() < 0.02);
}

#[test]
fn lfo_rate_formen_und_neustart() {
    let lfo = |extra: &str, kanten: &str| graph(1, &format!(r#"{{"id":"n","art":"note"}},{{"id":"l","art":"lfo","rate":2{extra}}},{{"id":"a","art":"ausgang"}}"#),
        &format!(r#"{{"von":"l.aus","nach":"a.x"}}{kanten}"#));
    let x = spiele(&mut lade(&lfo("", "")), 96_000);
    assert!((grundfrequenz(&x) - 2.0).abs() < 0.05, "{}", grundfrequenz(&x));
    for form in 0..5 {
        let y = spiele(&mut lade(&lfo(&format!(r#","form":{form}"#), "")), 48_000);
        assert!(y.iter().all(|v| (-1.0..=1.0).contains(v)), "form {form}");
    }
    // Säge mit Neustart: im Sample des Anschlags −1; ohne Neustart läuft sie weiter
    let mit = lfo(r#","form":2,"neustart":1"#, r#",{"von":"n.trig","nach":"l.trig"}"#);
    let ohne = lfo(r#","form":2"#, r#",{"von":"n.trig","nach":"l.trig"}"#);
    for (j, erwartet) in [(mit, true), (ohne, false)] {
        let mut p = lade(&j);
        spiele(&mut p, 5000);
        p.note_an(60, 1.0);
        assert_eq!(p.sample() == -1.0, erwartet);
    }
}

#[test]
fn transponiere_halbtoene_und_cent() {
    let t = |extra: &str| {
        let j = graph(1, &format!(r#"{{"id":"t","art":"transponiere","hz":440{extra}}},{{"id":"a","art":"ausgang"}}"#), r#"{"von":"t.aus","nach":"a.x"}"#);
        lade(&j).sample()
    };
    assert!((t(r#","st":12"#) - 880.0).abs() < 0.01);
    assert!((t(r#","st":-12"#) - 220.0).abs() < 0.01);
    assert!((t(r#","cent":100"#) - 466.1638).abs() < 0.01);
    assert_eq!(t(""), 440.0);
}

/// Verstärkung in dB eines Filterausgangs bei Sinus f (eingeschwungen)
fn filter_db(pole: u8, ausgang: &str, cutoff: f32, reso: f32, f: f32) -> f32 {
    let j = graph(1, &format!(r#"{{"id":"s","art":"sinus","hz":{f}}},{{"id":"f","art":"svf","cutoff":{cutoff},"reso":{reso},"pole":{pole}}},{{"id":"a","art":"ausgang"}}"#),
        &format!(r#"{{"von":"s.aus","nach":"f.x"}},{{"von":"f.{ausgang}","nach":"a.x"}}"#));
    let mut p = lade(&j);
    spiele(&mut p, 24_000);
    db(rms(&spiele(&mut p, 24_000)) / std::f32::consts::FRAC_1_SQRT_2)
}

#[test]
fn svf_zwei_und_vier_pole() {
    for pole in [2, 4] {
        let tp = filter_db(pole, "tp", 1000.0, 0.0, 1000.0);
        assert!((tp + 3.0).abs() < 0.3, "{pole} Pole tp an fc {tp}");
        let hp = filter_db(pole, "hp", 1000.0, 0.0, 1000.0);
        assert!((hp + 3.0).abs() < 0.3, "{pole} Pole hp an fc {hp}");
    }
    // zwei Oktaven über fc: 12 bzw. 24 dB je Oktave
    let (t2, t4) = (filter_db(2, "tp", 1000.0, 0.0, 4000.0), filter_db(4, "tp", 1000.0, 0.0, 4000.0));
    assert!((-26.0..-22.0).contains(&t2), "2 Pole {t2}");
    assert!((-50.0..-45.0).contains(&t4), "4 Pole {t4}");
    // Resonanz 1: Güte 25, gut 20 dB Überhöhung; Bandpass 2 Pole mit Resonanz 0 hat −3 dB an fc
    assert!(filter_db(2, "tp", 1000.0, 1.0, 1000.0) > 20.0);
    assert!((filter_db(2, "bp", 1000.0, 0.0, 1000.0) + 3.0).abs() < 0.3);
}

#[test]
fn svf_resonanz_jedes_sample_umgeschaltet_bleibt_beschraenkt() {
    let j = graph(1, r#"{"id":"r","art":"rauschen"},{"id":"q","art":"lfo","rate":24000,"form":3},{"id":"m","art":"mul","b":0.5},{"id":"o","art":"add","b":0.5},{"id":"f","art":"svf","cutoff":2000,"pole":4},{"id":"a","art":"ausgang"}"#,
        r#"{"von":"r.aus","nach":"f.x"},{"von":"q.aus","nach":"m.a"},{"von":"m.aus","nach":"o.a"},{"von":"o.aus","nach":"f.reso"},{"von":"f.tp","nach":"a.x"}"#);
    let x = spiele(&mut lade(&j), 96_000);
    let spitze = x.iter().fold(0f32, |m, v| m.max(v.abs()));
    assert!(spitze.is_finite() && spitze < 20.0, "Spitze {spitze}");
}

#[test]
fn saett_wie_tanh_bei_langsamem_signal_und_adaa_drueckt_aliasing() {
    let saett = |hz: f32, pegel: f32, antrieb: f32| {
        let j = graph(1, &format!(r#"{{"id":"s","art":"sinus","hz":{hz}}},{{"id":"p","art":"mul","b":{pegel}}},{{"id":"k","art":"saett","antrieb":{antrieb}}},{{"id":"a","art":"ausgang"}}"#),
            r#"{"von":"s.aus","nach":"p.a"},{"von":"p.aus","nach":"k.x"},{"von":"k.aus","nach":"a.x"}"#);
        let mut p = lade(&j);
        spiele(&mut p, 1000);
        spiele(&mut p, N)
    };
    // 20 Hz, Pegel 0,5, 0 dB: ADAA1 ist ein halbes Sample spät, sonst tanh
    let x = saett(20.0, 0.5, 0.0);
    let spitze = x.iter().fold(0f32, |m, v| m.max(v.abs()));
    assert!((spitze - 0.5f32.tanh()).abs() < 1e-3, "Spitze {spitze}");
    let laut = saett(20.0, 1.0, 40.0);
    assert!(laut.iter().all(|v| v.abs() <= 1.0));
    let x = saett(F_BIN, 1.0, 20.0);
    let mut naiv = Vec::new();
    let mut t = 0.0f32;
    for i in 0..1000 + N {
        if i >= 1000 { naiv.push((10.0 * (std::f32::consts::TAU * t).sin()).tanh()); }
        t = (t + F_BIN / SR).fract();
    }
    let (a, an) = (alias_db(&x), alias_db(&naiv));
    eprintln!("MESS alias {a:.1} dB, naiv {an:.1} dB");
    assert!(a < an - 3.0, "ADAA1 {a:.1} dB, naiv {an:.1} dB");
}

#[test]
fn glatt_zeitkonstante() {
    let j = graph(1, r#"{"id":"n","art":"note"},{"id":"g","art":"glatt","zeit":0.01},{"id":"a","art":"ausgang"}"#,
        r#"{"von":"n.gate","nach":"g.x"},{"von":"g.aus","nach":"a.x"}"#);
    let mut p = lade(&j);
    p.note_an(60, 1.0);
    let x = spiele(&mut p, 480);
    assert!((x[479] - (1.0 - (-1.0f32).exp())).abs() < 0.01, "{}", x[479]);
    let sofort = graph(1, r#"{"id":"n","art":"note"},{"id":"g","art":"glatt","zeit":0},{"id":"a","art":"ausgang"}"#,
        r#"{"von":"n.gate","nach":"g.x"},{"von":"g.aus","nach":"a.x"}"#);
    let mut q = lade(&sofort);
    q.note_an(60, 1.0);
    assert_eq!(q.sample(), 1.0);
}

#[test]
fn adsr_zeit_vom_regler() {
    // Attack 0,01..1 s logarithmisch über Regler 1
    let j = graph(1, r#"{"id":"n","art":"note"},{"id":"r","art":"regler","nr":1,"min":0.01,"max":1,"log":1},{"id":"e","art":"adsr","a":0.5,"d":0.1,"s":1,"r":0.1},{"id":"a","art":"ausgang"}"#,
        r#"{"von":"n.gate","nach":"e.gate"},{"von":"n.trig","nach":"e.trig"},{"von":"r.aus","nach":"e.a"},{"von":"e.aus","nach":"a.x"}"#);
    let bis_oben = |weg: f32| {
        let mut p = lade(&j);
        p.setze_regler(1, weg);
        p.note_an(60, 1.0);
        (0..200_000).position(|_| p.sample() >= 0.999).unwrap() as f32 / SR
    };
    assert!((bis_oben(0.0) - 0.01).abs() < 0.001);
    assert!((bis_oben(1.0) - 1.0).abs() < 0.01);
    // Gegenprobe: ohne Kante gilt der feste Wert 0,5 s
    let fest = j.replace(r#",{"von":"r.aus","nach":"e.a"}"#, "");
    let mut p = lade(&fest);
    p.note_an(60, 1.0);
    let t = (0..200_000).position(|_| p.sample() >= 0.999).unwrap() as f32 / SR;
    assert!((t - 0.5).abs() < 0.005, "{t}");
}

#[test]
fn eingangswert_ohne_kante_gleich_konst_knoten() {
    let mit_konst = graph(1, r#"{"id":"n","art":"note"},{"id":"o","art":"saege"},{"id":"c","art":"konst","wert":400},{"id":"f","art":"ladder"},{"id":"a","art":"ausgang"}"#,
        r#"{"von":"n.hz","nach":"o.hz"},{"von":"o.aus","nach":"f.x"},{"von":"c.aus","nach":"f.cutoff"},{"von":"f.aus","nach":"a.x"}"#);
    let ohne = graph(1, r#"{"id":"n","art":"note"},{"id":"o","art":"saege"},{"id":"f","art":"ladder","cutoff":400},{"id":"a","art":"ausgang"}"#,
        r#"{"von":"n.hz","nach":"o.hz"},{"von":"o.aus","nach":"f.x"},{"von":"f.aus","nach":"a.x"}"#);
    let (mut p, mut q) = (lade(&mit_konst), lade(&ohne));
    p.note_an(45, 1.0);
    q.note_an(45, 1.0);
    assert_eq!(spiele(&mut p, 9600), spiele(&mut q, 9600));
    // Kante schlägt festen Wert
    let beides = ohne.replace(r#""cutoff":400"#, r#""cutoff":5000"#)
        .replace(r#"{"id":"a","art":"ausgang"}"#, r#"{"id":"a","art":"ausgang"},{"id":"c","art":"konst","wert":400}"#)
        .replace(r#"{"von":"f.aus","nach":"a.x"}"#, r#"{"von":"f.aus","nach":"a.x"},{"von":"c.aus","nach":"f.cutoff"}"#);
    let mut r = lade(&beides);
    r.note_an(45, 1.0);
    let mut p = lade(&mit_konst);
    p.note_an(45, 1.0);
    assert_eq!(spiele(&mut r, 9600), spiele(&mut p, 9600));
}

#[test]
fn add_mit_vier_eingaengen() {
    let j = graph(1, r#"{"id":"s","art":"add","a":1,"b":2,"c":3,"d":4},{"id":"a","art":"ausgang"}"#, r#"{"von":"s.aus","nach":"a.x"}"#);
    assert_eq!(lade(&j).sample(), 10.0);
}

#[test]
fn neue_pruefungen() {
    let f = |k: &str| uebersetze(&graph(1, &format!(r#"{k},{{"id":"a","art":"ausgang"}}"#), ""), SR).err().expect(k);
    assert!(matches!(f(r#"{"id":"r","art":"regler","nr":9,"min":0,"max":1}"#), Fehler::Wert { ref wert, .. } if wert == "nr"));
    assert!(matches!(f(r#"{"id":"r","art":"regler","nr":1.5,"min":0,"max":1}"#), Fehler::Wert { ref wert, .. } if wert == "nr"));
    assert!(matches!(f(r#"{"id":"r","art":"regler","nr":1,"min":0,"max":1,"log":1}"#), Fehler::Wert { ref wert, .. } if wert == "min"));
    assert!(matches!(f(r#"{"id":"r","art":"regler","nr":1,"min":0}"#), Fehler::FehlenderWert { ref wert, .. } if wert == "max"));
    assert!(matches!(f(r#"{"id":"l","art":"lfo","form":5}"#), Fehler::Wert { ref wert, .. } if wert == "form"));
    assert!(matches!(f(r#"{"id":"s","art":"svf","pole":3}"#), Fehler::Wert { ref wert, .. } if wert == "pole"));
    assert!(matches!(f(r#"{"id":"p","art":"puls","breite":0.3}"#), Fehler::UnbekannterWert { ref wert, .. } if wert == "breite"));
    assert!(matches!(f(r#"{"id":"x.y","art":"rauschen"}"#), Fehler::Id(_)));
    let namen = r#"{"format":"baukasten/2","name":"t","regler_namen":{"9":"zu viel"},"knoten":[{"id":"a","art":"ausgang"}]}"#;
    assert!(matches!(uebersetze(namen, SR), Err(Fehler::ReglerName(n)) if n == "9"));
    let gut = r#"{"format":"baukasten/2","name":"t","regler_namen":{"1":"Cutoff","8":"Noise"},"knoten":[{"id":"a","art":"ausgang"}]}"#;
    assert_eq!(uebersetze(gut, SR).unwrap().regler_namen, vec![(1, "Cutoff".to_string()), (8, "Noise".to_string())]);
    // Gegenprobe: dieselben Knoten mit gültigen Werten gehen durch
    for k in [r#"{"id":"r","art":"regler","nr":8,"min":0.1,"max":1,"log":1}"#, r#"{"id":"l","art":"lfo","form":4,"neustart":1}"#, r#"{"id":"s","art":"svf","pole":4}"#, r#"{"id":"p","art":"puls","pwm":0.3}"#] {
        assert!(uebersetze(&graph(1, &format!(r#"{k},{{"id":"a","art":"ausgang"}}"#), ""), SR).is_ok(), "{k}");
    }
}

/// Leiter `leiter` auf `hz_m`, Folger `art` auf 1,73·hz_m mit harter Sync über `zyklus`, eingeschwungen
fn sync_folger(leiter: &str, hz_m: f32, art: &str, extra: &str) -> Vec<f32> {
    let j = graph(1, &format!(r#"{{"id":"m","art":"{leiter}","hz":{hz_m}}},{{"id":"s","art":"{art}","hz":{}{extra}}},{{"id":"a","art":"ausgang"}}"#, hz_m * 1.73),
        r#"{"von":"m.zyklus","nach":"s.sync"},{"von":"s.aus","nach":"a.x"}"#);
    let mut p = lade(&j);
    spiele(&mut p, 1000);
    spiele(&mut p, N)
}

#[test]
fn sync_wirkt_auf_puls_dreieck_und_sinus() {
    // Leiter 480 Hz = 100 Samples je Periode: mit Sync wiederholt sich der Folger mit 100 Samples, ohne nicht
    for (art, extra) in [("saege", ""), ("puls", r#","pwm":0.3"#), ("dreieck", ""), ("sinus", "")] {
        let x = sync_folger("saege", 480.0, art, extra);
        let mit = (0..N - 100).map(|i| (x[i] - x[i + 100]).abs()).fold(0f32, f32::max);
        assert!(mit < 0.05, "{art} mit Sync: Abstand je Periode {mit}");
        let frei = osz(art, 480.0 * 1.73, extra);
        let ohne = (0..N - 100).map(|i| (frei[i] - frei[i + 100]).abs()).fold(0f32, f32::max);
        assert!(ohne > 0.5, "{art} ohne Sync {ohne}");
    }
}

#[test]
fn sinus_liefert_zyklus_wie_die_saege() {
    // gleiche Phase, gleiche Rechnung: ein Sinus als Leiter synct bitgleich wie eine Säge (auch der Bruchteil)
    assert_eq!(sync_folger("sinus", F_BIN, "saege", ""), sync_folger("saege", F_BIN, "saege", ""));
}

#[test]
fn sync_blep_auch_an_puls_und_dreieck() {
    for (art, extra, grenze) in [("puls", r#","pwm":0.3"#, PULS_SYNC_DB), ("dreieck", "", DREIECK_SYNC_DB)] {
        let a = alias_db(&sync_folger("saege", F_BIN, art, extra));
        eprintln!("MESS {art} sync alias {a:.1} dB");
        assert!(a < grenze, "{art} Sync {a:.1} dB, Grenze {grenze}");
    }
}

#[test]
fn lfo_formen_werte_und_zufall_je_periode() {
    // Rate 1000 Hz = 48 Samples je Periode
    let lfo = |form: u8| {
        let j = graph(1, &format!(r#"{{"id":"l","art":"lfo","rate":1000,"form":{form}}},{{"id":"a","art":"ausgang"}}"#), r#"{"von":"l.aus","nach":"a.x"}"#);
        spiele(&mut lade(&j), 480)
    };
    let d = lfo(1);
    assert!((d[0] + 1.0).abs() < 1e-3 && (d[24] - 1.0).abs() < 1e-3 && d[12].abs() < 1e-3, "Dreieck {} {} {}", d[0], d[12], d[24]);
    let r = lfo(3);
    assert!(r[12] == 1.0 && r[36] == -1.0, "Rechteck {} {}", r[12], r[36]);
    let z = lfo(4);
    let mut werte: Vec<f32> = z.clone();
    werte.dedup();
    assert!(werte.len() >= 9 && werte.len() <= 11, "Zufall: {} Werte in 10 Perioden", werte.len());
    assert!(z[1..47].iter().all(|v| *v == z[1]), "Zufall hält innerhalb der Periode");
    assert!(z.iter().all(|v| (-1.0..=1.0).contains(v)));
}

#[test]
fn svf_vierpol_bandpass_zweite_stufe() {
    let mitte = filter_db(4, "bp", 1000.0, 0.0, 1000.0);
    let weit = filter_db(4, "bp", 1000.0, 0.0, 4000.0);
    eprintln!("MESS bp4 an fc {mitte:.1} dB, zwei Oktaven darüber {weit:.1} dB");
    assert!(weit < BP4_WEIT_DB, "4-Pol-Bandpass zwei Oktaven über fc {weit:.1} dB");
}

#[test]
fn svf_nan_setzt_sich_selbst_zurueck() {
    let mut f = baukasten_dsp::svf::Svf::default();
    for _ in 0..100 { f.prozess(0.5, 1000.0, 0.5, true, SR); }
    assert_eq!(f.prozess(f32::NAN, 1000.0, 0.5, true, SR), (0.0, 0.0, 0.0));
    // danach rechnet es wieder: ein Gleichanteil 0,5 kommt am Tiefpass an (ohne Rückstellung bliebe der Zustand NaN
    // und der Ausgang für immer 0)
    let mut tp = 0.0;
    for _ in 0..4800 { tp = f.prozess(0.5, 1000.0, 0.5, true, SR).0; }
    assert!((tp - 0.5).abs() < 0.01, "Tiefpass nach NaN {tp}");
}

#[test]
fn klemmungen_wirken() {
    let regler = graph(1, r#"{"id":"r","art":"regler","nr":1,"min":0,"max":10},{"id":"a","art":"ausgang"}"#, r#"{"von":"r.aus","nach":"a.x"}"#);
    let mut p = lade(&regler);
    p.setze_regler(1, 2.0);
    assert_eq!(p.sample(), 10.0, "Reglerweg über 1 wird 1");
    p.setze_regler(1, -1.0);
    assert_eq!(p.sample(), 0.0, "Reglerweg unter 0 wird 0");
    assert_eq!(osz("puls", 110.0, r#","pwm":3"#), osz("puls", 110.0, r#","pwm":1"#), "pwm über 1 wie 1");
    let saett = |antrieb: f32| {
        let j = graph(1, &format!(r#"{{"id":"s","art":"sinus","hz":110}},{{"id":"t","art":"saett","antrieb":{antrieb}}},{{"id":"a","art":"ausgang"}}"#),
            r#"{"von":"s.aus","nach":"t.x"},{"von":"t.aus","nach":"a.x"}"#);
        spiele(&mut lade(&j), 4800)
    };
    assert_eq!(saett(100.0), saett(40.0), "Antrieb über 40 dB wie 40");
    let svf = |cutoff: f32| {
        let j = graph(1, &format!(r#"{{"id":"r","art":"rauschen"}},{{"id":"f","art":"svf","cutoff":{cutoff}}},{{"id":"a","art":"ausgang"}}"#),
            r#"{"von":"r.aus","nach":"f.x"},{"von":"f.tp","nach":"a.x"}"#);
        spiele(&mut lade(&j), 4800)
    };
    assert_eq!(svf(-5.0), svf(20.0), "Cutoff unter 20 Hz wie 20 Hz");
}

#[test]
fn glatt_vorgabe_und_setzen() {
    let g = |werte: &str, kanten: &str| graph(1, &format!(r#"{{"id":"n","art":"note"}},{{"id":"g","art":"glatt"{werte}}},{{"id":"a","art":"ausgang"}}"#),
        &format!(r#"{{"von":"n.hz","nach":"g.x"}},{{"von":"g.aus","nach":"a.x"}}{kanten}"#));
    let lauf = |j: &str| { let mut p = lade(j); p.note_an(69, 1.0); spiele(&mut p, 960) };
    assert_eq!(lauf(&g("", "")), lauf(&g(r#","zeit":0.01"#, "")), "Vorgabe zeit 0,01");
    // setzen an erste: die erste Note springt, die zweite gleitet; nach zuruecksetzen springt wieder die erste
    let mut p = lade(&g(r#","zeit":0.1"#, r#",{"von":"n.erste","nach":"g.setzen"}"#));
    p.note_an(69, 1.0);
    assert_eq!(p.sample(), 440.0);
    spiele(&mut p, 100);
    p.note_an(57, 1.0);
    assert!(p.sample() > 430.0, "zweite Note gleitet");
    p.zuruecksetzen();
    p.note_an(57, 1.0);
    assert_eq!(p.sample(), 220.0);
    // Gegenprobe ohne setzen: die erste Note gleitet aus 0 Hz
    let mut q = lade(&g(r#","zeit":0.1"#, ""));
    q.note_an(69, 1.0);
    assert!(q.sample() < 10.0);
    // ohne setzen bringt erst zuruecksetzen den Glätter auf 0 zurück
    spiele(&mut q, 48_000);
    q.zuruecksetzen();
    // wie frisch geladen: ohne Note liefert note.hz 0, der Glätter bleibt bei 0 (nicht beim alten Ton)
    assert_eq!(spiele(&mut q, 4800)[4799], 0.0, "Tonhöhe nach zuruecksetzen");
    q.note_an(69, 1.0);
    assert!(q.sample() < 10.0, "Glätter nach zuruecksetzen wieder bei 0");
}

// Grenzen zwischen gebaut und Mutant, gemessen 2026-10-28: Puls-Sync −18,4 dB (ohne Glättung am Sync-Sprung −14,4),
// Dreieck-Sync −18,4 (−15,9), 4-Pol-Bandpass zwei Oktaven über fc −24,5 (nur erste Stufe −12,6)
const PULS_SYNC_DB: f32 = -16.5;
const DREIECK_SYNC_DB: f32 = -17.2;
const BP4_WEIT_DB: f32 = -18.0;
