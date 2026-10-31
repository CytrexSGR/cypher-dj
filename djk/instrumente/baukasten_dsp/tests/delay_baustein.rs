//! Baustein `delay` (Slice 4b): Echo auf der Summe aller Stimmen, Ergebnis in Stimme 0 (D1, D2). Die Klangeigenschaften
//! prüft tests/echo.rs an der DSP; hier wird gezeigt, dass der Baustein genau dieses Echo rechnet.
use baukasten_dsp::echo::Echo;
use baukasten_dsp::uebersetze;

const SR: f32 = 48_000.0;

fn graph(stimmen: usize, knoten: &str, kanten: &str) -> String {
    format!(r#"{{"format":"baukasten/2","name":"t","stimmen":{stimmen},"knoten":[{knoten}],"kanten":[{kanten}]}}"#)
}

/// Vier Sägezahnstimmen hinter einer Hüllkurve; `knoten`/`kanten` hängen den Rest an
fn saegen(knoten: &str, kanten: &str) -> baukasten_dsp::Programm {
    let k = format!(r#"{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"e","art":"adsr","a":0.01,"d":0.1,"s":1,"r":0.05}},{{"id":"vca","art":"mul"}},{{"id":"o","art":"ausgang"}}{knoten}"#);
    let e = format!(r#"{{"von":"n.hz","nach":"s.hz"}},{{"von":"n.gate","nach":"e.gate"}},{{"von":"n.trig","nach":"e.trig"}},{{"von":"s.aus","nach":"vca.a"}},{{"von":"e.aus","nach":"vca.b"}}{kanten}"#);
    uebersetze(&graph(4, &k, &e), SR).unwrap_or_else(|e| panic!("{e}"))
}

fn akkord(p: &mut baukasten_dsp::Programm) {
    for n in [45u8, 52, 57, 61] {
        p.note_an(n, 1.0);
    }
}

const MIT_DELAY: &str = r#",{"von":"vca.aus","nach":"d.x"},{"von":"d.l","nach":"o.l"},{"von":"d.r","nach":"o.r"}"#;

/// Graph mit Delay gegen die Summe ohne Delay durch ein eigenes Echo, `zeit_je_sample` liefert die Zeit des Vergleichs
fn vergleiche(mut mit: baukasten_dsp::Programm, mut echo: Echo, zeit_je_sample: impl Fn(usize) -> f32, fb: f32, mix: f32, nach: Option<usize>) {
    let mut ohne = saegen("", r#",{"von":"vca.aus","nach":"o.x"}"#);
    akkord(&mut ohne);
    akkord(&mut mit);
    let mut nass = 0.0f64;
    for i in 0..48_000 {
        if Some(i) == nach {
            ohne.alle_aus();
            mit.alle_aus();
        }
        let s = ohne.sample();
        let soll = echo.prozess(s, s, zeit_je_sample(i), fb, mix);
        let ist = mit.sample_stereo();
        assert_eq!((ist.0.to_bits(), ist.1.to_bits()), (soll.0.to_bits(), soll.1.to_bits()), "Sample {i}");
        nass += ((ist.0 - s) as f64).abs();
    }
    assert!(nass > 1.0, "das Delay verändert nichts, der Vergleich wäre blind ({nass})");
}

#[test]
fn delay_fest_rechnet_auf_der_summe_wie_echo() {
    let mit = saegen(r#",{"id":"d","art":"delay","zeit":123.4,"fb":0.4,"mix":0.6,"daempf":3000,"pingpong":1}"#, MIT_DELAY);
    let echo = Echo::neu(SR, 1000.0, Some(123.4), 100.0, 3000.0, true);
    vergleiche(mit, echo, |_| 0.0, 0.4, 0.6, Some(20_000));
}

#[test]
fn delay_zeit_am_regler_gleitet_wie_echo() {
    // Zeit 50..400 ms am Regler 1 (Lagrange-Pfad, glatt 30 ms); Sprung von Weg 0,2 auf 0,8 bei Sample 20 000: nur bewegte
    // Zeit macht `glatt` sichtbar (der Regler selbst glättet nicht, programm.rs `Schritt::Regler`)
    let mut ohne = saegen("", r#",{"von":"vca.aus","nach":"o.x"}"#);
    let mut mit = saegen(r#",{"id":"d","art":"delay","fb":0.3,"mix":0.5,"glatt":30,"max":500},{"id":"k","art":"regler","nr":1,"min":50,"max":400}"#,
                         &format!(r#"{MIT_DELAY},{{"von":"k.aus","nach":"d.zeit"}}"#));
    let mut echo = Echo::neu(SR, 500.0, None, 30.0, 4000.0, false);
    akkord(&mut ohne);
    akkord(&mut mit);
    mit.setze_regler(1, 0.2);
    for i in 0..48_000 {
        if i == 20_000 {
            mit.setze_regler(1, 0.8);
        }
        let k: f32 = if i < 20_000 { 0.2 } else { 0.8 };
        let s = ohne.sample();
        let soll = echo.prozess(s, s, 50.0f32 + (400.0f32 - 50.0f32) * k, 0.3, 0.5);
        let ist = mit.sample_stereo();
        assert_eq!((ist.0.to_bits(), ist.1.to_bits()), (soll.0.to_bits(), soll.1.to_bits()), "Sample {i}");
    }
}

#[test]
fn delay_l_und_r_gehen_getrennt_in_die_summe() {
    // x unverbunden, l = Stimmen nach der Hüllkurve, r = Rohsäge: der Vergleichsgraph liefert am Ausgang Σl und Σr
    let mut ohne = saegen("", r#",{"von":"vca.aus","nach":"o.l"},{"von":"s.aus","nach":"o.r"}"#);
    let mut mit = saegen(r#",{"id":"d","art":"delay","zeit":123.4,"fb":0.4,"mix":0.6}"#,
                         r#",{"von":"vca.aus","nach":"d.l"},{"von":"s.aus","nach":"d.r"},{"von":"d.l","nach":"o.l"},{"von":"d.r","nach":"o.r"}"#);
    let mut echo = Echo::neu(SR, 1000.0, Some(123.4), 100.0, 4000.0, false);
    akkord(&mut ohne);
    akkord(&mut mit);
    for i in 0..48_000 {
        let (a, b) = ohne.sample_stereo();
        let soll = echo.prozess(a, b, 0.0, 0.4, 0.6);
        let ist = mit.sample_stereo();
        assert_eq!((ist.0.to_bits(), ist.1.to_bits()), (soll.0.to_bits(), soll.1.to_bits()), "Sample {i}");
    }
}

#[test]
fn mix_null_ist_die_trockene_summe() {
    let mut ohne = saegen("", r#",{"von":"vca.aus","nach":"o.x"}"#);
    let mut mit = saegen(r#",{"id":"d","art":"delay","mix":0,"fb":0.9}"#, MIT_DELAY);
    akkord(&mut ohne);
    akkord(&mut mit);
    for i in 0..48_000 {
        let s = ohne.sample();
        assert_eq!(mit.sample_stereo(), (s, s), "Sample {i}");
    }
}

#[test]
fn rueckkopplung_am_eingang_wird_im_lauf_geklemmt() {
    // fb 5 über eine Konstante: 10 s Akkord, endlich, keine Rettung
    let mut p = saegen(r#",{"id":"d","art":"delay","zeit":20},{"id":"f","art":"konst","wert":5}"#, &format!(r#"{MIT_DELAY},{{"von":"f.aus","nach":"d.fb"}}"#));
    akkord(&mut p);
    let spitze = (0..480_000).map(|_| p.sample_stereo()).map(|v| v.0.abs().max(v.1.abs())).fold(0.0f32, f32::max);
    println!("MESS fb 5 an der Kante: Spitze {spitze:.2}, Rettungen {}", p.rettungen);
    assert!(spitze.is_finite() && p.rettungen == 0, "Spitze {spitze}, Rettungen {}", p.rettungen);
}

#[test]
fn falsche_werte_werden_abgewiesen() {
    for (wert, ok) in [(r#""zeit":0.5"#, false), (r#""zeit":1"#, true), (r#""zeit":1000"#, true), (r#""zeit":1001"#, false),
                       (r#""max":4000,"zeit":3000"#, true), (r#""max":100"#, true), (r#""max":4001"#, false), (r#""max":9"#, false), (r#""max":10,"zeit":10"#, true),
                       (r#""fb":0.98"#, true), (r#""fb":0.99"#, false), (r#""fb":-0.1"#, false), (r#""mix":1"#, true), (r#""mix":1.1"#, false),
                       (r#""daempf":0"#, true), (r#""daempf":199"#, false), (r#""daempf":200"#, true), (r#""daempf":20000"#, true), (r#""daempf":20001"#, false),
                       (r#""glatt":2000"#, true), (r#""glatt":2001"#, false), (r#""pingpong":1"#, true), (r#""pingpong":0.5"#, false)] {
        let j = graph(1, &format!(r#"{{"id":"n","art":"note"}},{{"id":"d","art":"delay",{wert}}},{{"id":"o","art":"ausgang"}}"#), r#"{"von":"d.l","nach":"o.l"}"#);
        assert_eq!(uebersetze(&j, SR).is_ok(), ok, "{wert}");
    }
}

#[test]
fn nan_an_zeit_ueber_eine_kante_loest_keine_rettung_aus() {
    // 1e30 · 1e30 = inf, inf · 0 = NaN an `d.zeit`: das Echo gilt NaN als max, die Summe bleibt endlich
    let mut p = saegen(r#",{"id":"i","art":"konst","wert":1e30},{"id":"m1","art":"mul"},{"id":"m2","art":"mul","b":0},{"id":"d","art":"delay","fb":0.5}"#,
                       &format!(r#"{MIT_DELAY},{{"von":"i.aus","nach":"m1.a"}},{{"von":"i.aus","nach":"m1.b"}},{{"von":"m1.aus","nach":"m2.a"}},{{"von":"m2.aus","nach":"d.zeit"}}"#));
    akkord(&mut p);
    let spitze = (0..20_000).map(|_| p.sample_stereo()).map(|v| v.0.abs().max(v.1.abs())).fold(0.0f32, f32::max);
    println!("MESS NaN an zeit: Spitze {spitze:.2}, Rettungen {}", p.rettungen);
    assert!(spitze.is_finite() && p.rettungen == 0, "Spitze {spitze}, Rettungen {}", p.rettungen);
}
