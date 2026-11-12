//! Selector block `wahl` (type 38): zones, crossfade, change during a fade, hard switch, unconnected inputs, non-finite
//! input, morph, voices, determinism, value checks.
use baukasten_dsp::{uebersetze, Fehler, Programm};

const SR: f32 = 48_000.0;

/// Graph with one `wahl` node `w`. `werte` are extra fields of the node (e.g. `"n":3,"blende":0`), `knoten` and `kanten`
/// extra nodes and edges (each starting with a comma). The output of `w` feeds `ausgang.x`.
fn bau(stimmen: usize, werte: &str, knoten: &str, kanten: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"t","stimmen":{stimmen},"knoten":[{{"id":"n","art":"note"}},{{"id":"w","art":"wahl",{werte}}},{{"id":"o","art":"ausgang"}}{knoten}],"kanten":[{{"von":"w.aus","nach":"o.x"}}{kanten}]}}"#
    )
}

/// `konst` candidates c1..cN with the given values wired to e1..eN
fn konsten(werte: &[f64]) -> (String, String) {
    let mut k = String::new();
    let mut e = String::new();
    for (i, v) in werte.iter().enumerate() {
        k += &format!(r#",{{"id":"c{i}","art":"konst","wert":{v}}}"#);
        e += &format!(r#",{{"von":"c{i}.aus","nach":"w.e{}"}}"#, i + 1);
    }
    (k, e)
}

fn lade(g: &str) -> Programm { uebersetze(g, SR).unwrap_or_else(|e| panic!("{e}: {g}")) }

fn lauf(p: &mut Programm, n: usize) -> Vec<f32> { (0..n).map(|_| p.sample_stereo().0).collect() }

/// the knob `wahl` as fixed value, hard switch
fn fest(n: usize, norm: u8, wahl: f32) -> f32 {
    let werte: Vec<f64> = (0..n).map(|i| 10.0 * (i + 1) as f64).collect();
    let (k, e) = konsten(&werte);
    let mut p = lade(&bau(1, &format!(r#""n":{n},"norm":{norm},"blende":0,"wahl":{wahl}"#), &k, &e));
    lauf(&mut p, 3)[2]
}

#[test]
fn zonengrenzen_normiert_fuer_jedes_n() {
    for n in 2..=8usize {
        let soll = |pos: usize| 10.0 * (pos + 1) as f32;
        for k in 0..n {
            assert_eq!(fest(n, 1, (k as f32 + 0.5) / n as f32), soll(k), "n {n} centre of zone {k}");
            if k > 0 {
                let grenze = k as f32 / n as f32;
                assert_eq!(fest(n, 1, grenze - 1e-4), soll(k - 1), "n {n} just below boundary {k}");
                assert_eq!(fest(n, 1, grenze + 1e-4), soll(k), "n {n} just above boundary {k}");
            }
        }
        assert_eq!(fest(n, 1, 0.0), soll(0), "n {n} knob at 0");
        assert_eq!(fest(n, 1, 1.0), soll(n - 1), "n {n} knob at 1 stays in the last zone");
        assert_eq!(fest(n, 1, 1.7), soll(n - 1), "n {n} knob above 1");
        assert_eq!(fest(n, 1, -0.3), soll(0), "n {n} knob below 0");
    }
}

#[test]
fn zonen_gleich_breit() {
    // a sweep of 0..1 in 1000 steps: every zone gets n-th of the steps (+-1)
    for n in 2..=8usize {
        let mut zaehler = vec![0usize; n];
        for i in 0..1000 {
            let pos = (fest(n, 1, (i as f32 + 0.5) / 1000.0) / 10.0) as usize - 1;
            zaehler[pos] += 1;
        }
        for z in &zaehler {
            assert!((*z as i64 - 1000 / n as i64).abs() <= 1, "n {n}: zone sizes {zaehler:?}");
        }
    }
}

#[test]
fn index_modus_rundet_fuer_jedes_n() {
    for n in 2..=8usize {
        let soll = |pos: usize| 10.0 * (pos + 1) as f32;
        for k in 0..n {
            assert_eq!(fest(n, 0, k as f32), soll(k), "n {n} index {k}");
            assert_eq!(fest(n, 0, k as f32 + 0.49), soll(k), "n {n} index {k}.49");
            assert_eq!(fest(n, 0, k as f32 + 0.51), soll((k + 1).min(n - 1)), "n {n} index {k}.51");
        }
        assert_eq!(fest(n, 0, -4.0), soll(0), "n {n} index below 0");
        assert_eq!(fest(n, 0, 99.0), soll(n - 1), "n {n} index above n-1");
    }
}

/// two candidates 0 and 1, the knob (regler 1, 0..1) moves between the zones; `blende` in ms
fn zwei_konstanten(blende: f32) -> Programm {
    let (k, e) = konsten(&[0.0, 1.0]);
    let k = k + r#",{"id":"k","art":"regler","nr":1,"min":0,"max":1}"#;
    let e = e + r#",{"von":"k.aus","nach":"w.wahl"}"#;
    lade(&bau(1, &format!(r#""n":2,"blende":{blende}"#), &k, &e))
}

#[test]
fn blende_dauer_und_verlauf() {
    let mut p = zwei_konstanten(10.0); // 480 samples
    p.setze_regler(1, 0.1);
    assert!(lauf(&mut p, 200).iter().all(|v| *v == 0.0), "settled on input 1");
    p.setze_regler(1, 0.9);
    let y = lauf(&mut p, 600);
    for i in 0..479 {
        assert!(y[i] > 0.0 && y[i] < 1.0, "sample {i} inside the fade: {}", y[i]);
        assert!(y[i + 1] > y[i], "monotonic at {i}");
    }
    assert!((y[0] - 1.0 / 480.0).abs() < 1e-6, "first step {}", y[0]);
    assert_eq!(y[479], 1.0, "fade is over after exactly 480 samples");
    assert!(y[480..].iter().all(|v| *v == 1.0));
    // linear: the middle is half
    assert!((y[239] - 0.5).abs() < 2e-3, "midpoint {}", y[239]);
}

#[test]
fn blende_summe_der_gewichte_ist_eins() {
    // the same signal on both inputs passes unchanged during the whole fade
    let (k, e) = konsten(&[0.7, 0.7, 0.7]);
    let k = k + r#",{"id":"k","art":"regler","nr":1,"min":0,"max":1}"#;
    let e = e + r#",{"von":"k.aus","nach":"w.wahl"}"#;
    let mut p = lade(&bau(1, r#""n":3,"blende":20"#, &k, &e));
    let mut y = Vec::new();
    for (i, knob) in [0.1, 0.5, 0.9, 0.1, 0.5].iter().enumerate() {
        p.setze_regler(1, *knob);
        y.extend(lauf(&mut p, 300 + i * 100)); // later switches interrupt the fades
    }
    let (lo, hi) = y.iter().fold((f32::MAX, f32::MIN), |(a, b), v| (a.min(*v), b.max(*v)));
    assert!((lo - 0.7).abs() < 1e-5 && (hi - 0.7).abs() < 1e-5, "range {lo}..{hi}");
}

fn zwei_sinus(blende: f32) -> Programm {
    let k = r#",{"id":"a","art":"sinus","hz":440},{"id":"b","art":"sinus","hz":660},{"id":"k","art":"regler","nr":1,"min":0,"max":1}"#;
    let e = r#",{"von":"a.aus","nach":"w.e1"},{"von":"b.aus","nach":"w.e2"},{"von":"k.aus","nach":"w.wahl"}"#;
    lade(&bau(1, &format!(r#""n":2,"blende":{blende}"#), k, e))
}

fn groesster_sprung(y: &[f32]) -> f32 { y.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max) }

#[test]
fn blende_ohne_unstetigkeit_zwischen_zwei_sinus() {
    let mut weich = zwei_sinus(5.0);
    let mut hart = zwei_sinus(0.0);
    let (mut y_weich, mut y_hart) = (Vec::new(), Vec::new());
    for r in 0..40 {
        let knob = if r % 2 == 0 { 0.1 } else { 0.9 };
        weich.setze_regler(1, knob);
        hart.setze_regler(1, knob);
        // 337 samples: the switches fall on varying phases of the two sines
        y_weich.extend(lauf(&mut weich, 337));
        y_hart.extend(lauf(&mut hart, 337));
    }
    // own step of the signals: 2 pi 660 / 48000 = 0.0864; the fade adds |a - b| / 240 <= 0.0083
    let eigen = 2.0 * std::f32::consts::PI * 660.0 / SR;
    let sprung = groesster_sprung(&y_weich);
    println!("MESS wahl sprung weich {sprung:.4} (eigener Schritt {eigen:.4}), hart {:.4}", groesster_sprung(&y_hart));
    assert!(sprung <= eigen + 0.01, "crossfade has a step of {sprung}, signal step {eigen}");
    assert!(groesster_sprung(&y_hart) > 0.3, "the test would be blind: a hard switch must click here");
}

#[test]
fn wechsel_waehrend_der_blende_springt_nicht() {
    let (k, e) = konsten(&[0.0, 1.0, 2.0]);
    let k = k + r#",{"id":"k","art":"regler","nr":1,"min":0,"max":1}"#;
    let e = e + r#",{"von":"k.aus","nach":"w.wahl"}"#;
    let mut p = lade(&bau(1, r#""n":3,"blende":10"#, &k, &e));
    p.setze_regler(1, 0.1);
    let mut y = lauf(&mut p, 50);
    p.setze_regler(1, 0.5); // towards input 2
    y.extend(lauf(&mut p, 100));
    let mitte = *y.last().unwrap();
    assert!(mitte > 0.1 && mitte < 0.9, "fade is running: {mitte}");
    p.setze_regler(1, 0.9); // redirect to input 3 mid-fade
    y.extend(lauf(&mut p, 100));
    p.setze_regler(1, 0.1); // and back to input 1 mid-fade
    y.extend(lauf(&mut p, 100));
    // one fade step moves at most (value range 2) / 480 per sample
    let sprung = groesster_sprung(&y);
    assert!(sprung <= 2.0 / 480.0 + 1e-6, "step of {sprung} while redirecting");
    // and the fade ends exactly on the last target after at most 480 samples
    y.extend(lauf(&mut p, 480));
    assert_eq!(*y.last().unwrap(), 0.0);
    p.setze_regler(1, 0.9);
    let z = lauf(&mut p, 480);
    assert_eq!(*z.last().unwrap(), 2.0, "reached input 3 after 480 samples");
}

#[test]
fn harter_wechsel_bei_blende_null() {
    let mut p = zwei_konstanten(0.0);
    p.setze_regler(1, 0.1);
    assert_eq!(lauf(&mut p, 5), vec![0.0; 5]);
    p.setze_regler(1, 0.9);
    assert_eq!(lauf(&mut p, 3), vec![1.0; 3], "the new input is there in the first sample of the change");
    p.setze_regler(1, 0.1);
    assert_eq!(lauf(&mut p, 3), vec![0.0; 3]);
}

#[test]
fn erste_position_gilt_sofort() {
    let mut p = zwei_konstanten(50.0);
    p.setze_regler(1, 0.9);
    assert_eq!(lauf(&mut p, 2), vec![1.0; 2], "no fade from input 1 at the start");
}

#[test]
fn unverbundene_eingaenge_sind_still() {
    let mut p = lade(&bau(1, r#""n":3,"blende":0,"wahl":0.5"#, r#",{"id":"c","art":"konst","wert":5}"#, r#",{"von":"c.aus","nach":"w.e2"}"#));
    assert_eq!(lauf(&mut p, 3)[2], 5.0);
    for (wahl, soll) in [(0.1, 0.0), (0.5, 5.0), (0.9, 0.0)] {
        let mut p = lade(&bau(1, &format!(r#""n":3,"blende":0,"wahl":{wahl}"#), r#",{"id":"c","art":"konst","wert":5}"#, r#",{"von":"c.aus","nach":"w.e2"}"#));
        assert_eq!(lauf(&mut p, 3)[2], soll, "wahl {wahl}");
    }
    // a fixed value on an unconnected input is a constant candidate, like on every other block
    let mut p = lade(&bau(1, r#""n":2,"blende":0,"wahl":0.9,"e2":0.25"#, "", ""));
    assert_eq!(lauf(&mut p, 3)[2], 0.25);
}

/// a candidate that is infinite: konst 3e38 times 10
const UNENDLICH: &str = r#",{"id":"big","art":"konst","wert":3e38},{"id":"inf","art":"mul","b":10}"#;
const UNENDLICH_KANTE: &str = r#",{"von":"big.aus","nach":"inf.a"}"#;

#[test]
fn nicht_endliche_eingaben_bleiben_endlich() {
    // the infinite candidate counts as silence, also inside a fade
    let k = format!(r#"{UNENDLICH},{{"id":"c","art":"konst","wert":1}},{{"id":"k","art":"regler","nr":1,"min":0,"max":1}}"#);
    let e = format!(r#"{UNENDLICH_KANTE},{{"von":"inf.aus","nach":"w.e1"}},{{"von":"c.aus","nach":"w.e2"}},{{"von":"k.aus","nach":"w.wahl"}}"#);
    let mut p = lade(&bau(1, r#""n":2,"blende":5"#, &k, &e));
    let mut y = Vec::new();
    for knob in [0.1, 0.9, 0.1, 0.9] {
        p.setze_regler(1, knob);
        y.extend(lauf(&mut p, 400));
    }
    assert!(y.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v)), "output left 0..1 or is not finite");
    assert_eq!(p.rettungen, 0, "the guard had to step in");
    // an infinite selection keeps the position
    let k = format!(r#"{UNENDLICH},{{"id":"c","art":"konst","wert":1}},{{"id":"d","art":"konst","wert":2}}"#);
    let e = format!(r#"{UNENDLICH_KANTE},{{"von":"c.aus","nach":"w.e1"}},{{"von":"d.aus","nach":"w.e2"}},{{"von":"inf.aus","nach":"w.wahl"}}"#);
    let mut p = lade(&bau(1, r#""n":2,"blende":5"#, &k, &e));
    let y = lauf(&mut p, 100);
    assert!(y.iter().all(|v| *v == 1.0), "an infinite wahl must hold the first position");
    assert_eq!(p.rettungen, 0);
}

#[test]
fn morph_interpoliert_zwischen_nachbarn() {
    let m = |werte: &str, wahl: f32| {
        let (k, e) = konsten(&[0.0, 10.0, 20.0]);
        let mut p = lade(&bau(1, &format!(r#""n":3,"modus":1,"wahl":{wahl}{werte}"#), &k, &e));
        lauf(&mut p, 2)[1]
    };
    assert_eq!(m("", 0.0), 0.0);
    assert!((m("", 0.25) - 5.0).abs() < 1e-5);
    assert!((m("", 0.5) - 10.0).abs() < 1e-5);
    assert!((m("", 0.75) - 15.0).abs() < 1e-5);
    assert_eq!(m("", 1.0), 20.0);
    assert_eq!(m("", 3.0), 20.0, "clamped");
    assert!((m(r#","norm":0"#, 1.5) - 15.0).abs() < 1e-5, "index mode");
    assert_eq!(m(r#","norm":0"#, 7.0), 20.0);
}

#[test]
fn stimmen_waehlen_unabhaengig() {
    // the knob is the note velocity: voice 1 plays soft (zone 0), voice 2 hard (zone 1); the output sums the voices
    let (k, e) = konsten(&[1.0, 10.0]);
    let e = e + r#",{"von":"n.vel","nach":"w.wahl"}"#;
    let mut p = lade(&bau(2, r#""n":2,"blende":0"#, &k, &e));
    p.note_an(48, 0.2);
    p.note_an(55, 0.9);
    assert_eq!(lauf(&mut p, 3)[2], 11.0);
}

#[test]
fn deterministisch_und_zuruecksetzen_gleich_frisch() {
    let ablauf = |p: &mut Programm| {
        let mut y = Vec::new();
        for knob in [0.1, 0.6, 0.3, 0.95, 0.2] {
            p.setze_regler(1, knob);
            y.extend(lauf(p, 500));
        }
        y
    };
    let (mut a, mut b) = (zwei_sinus(5.0), zwei_sinus(5.0));
    let (ya, yb) = (ablauf(&mut a), ablauf(&mut b));
    assert!(ya.iter().zip(&yb).all(|(x, y)| x.to_bits() == y.to_bits()), "two programs differ");
    a.zuruecksetzen();
    let mut c = zwei_sinus(5.0);
    let (ya2, yc) = (ablauf(&mut a), ablauf(&mut c));
    assert!(ya2.iter().zip(&yc).all(|(x, y)| x.to_bits() == y.to_bits()), "reset differs from fresh");
}

#[test]
fn wertepruefung() {
    let ok = |werte: &str| uebersetze(&bau(1, werte, "", ""), SR);
    assert!(ok(r#""n":2"#).is_ok());
    assert!(ok(r#""n":8,"norm":0,"blende":0,"modus":1"#).is_ok());
    assert!(matches!(ok(r#""norm":1"#), Err(Fehler::FehlenderWert { .. })), "n is required");
    for schlecht in [r#""n":1"#, r#""n":9"#, r#""n":2.5"#, r#""n":3,"norm":2"#, r#""n":3,"modus":2"#, r#""n":3,"blende":-1"#, r#""n":3,"blende":6000"#] {
        assert!(matches!(ok(schlecht), Err(Fehler::Wert { .. })), "{schlecht} must be refused");
    }
}
