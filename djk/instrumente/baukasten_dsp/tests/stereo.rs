//! Stereo-Ausgang und Chorus als Summenpunkt (Slice 2b, D1, D3). Jeder Test hat eine Mutation, die ihn rot macht
//! (Plan Slice 2b, Task 1 Step 6).
use baukasten_dsp::chorus::Chorus;
use baukasten_dsp::uebersetze;

const SR: f32 = 48_000.0;

fn graph(stimmen: usize, knoten: &str, kanten: &str) -> String {
    format!(r#"{{"format":"baukasten/2","name":"t","stimmen":{stimmen},"knoten":[{knoten}],"kanten":[{kanten}]}}"#)
}

/// Sägezahn je Stimme hinter einer Hüllkurve; `rest` hängt Knoten an, `ziel` bestimmt, wohin `vca.aus` geht
fn saegen(knoten: &str, kanten: &str) -> baukasten_dsp::Programm {
    let k = format!(r#"{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"e","art":"adsr","a":0.01,"d":0.1,"s":1,"r":0.2}},{{"id":"vca","art":"mul"}},{{"id":"o","art":"ausgang"}}{knoten}"#);
    let e = format!(r#"{{"von":"n.hz","nach":"s.hz"}},{{"von":"n.gate","nach":"e.gate"}},{{"von":"n.trig","nach":"e.trig"}},{{"von":"s.aus","nach":"vca.a"}},{{"von":"e.aus","nach":"vca.b"}}{kanten}"#);
    uebersetze(&graph(4, &k, &e), SR).unwrap()
}

fn akkord(p: &mut baukasten_dsp::Programm) {
    for n in [45u8, 52, 57, 61] {
        p.note_an(n, 1.0);
    }
}

#[test]
fn ausgang_summiert_x_auf_beide_seiten_l_und_r_getrennt() {
    let j = graph(2, r#"{"id":"a","art":"konst","wert":0.25},{"id":"b","art":"konst","wert":0.125},{"id":"c","art":"konst","wert":0.5},{"id":"o","art":"ausgang"}"#,
                  r#"{"von":"a.aus","nach":"o.x"},{"von":"b.aus","nach":"o.l"},{"von":"c.aus","nach":"o.r"}"#);
    let mut p = uebersetze(&j, SR).unwrap();
    // zwei Stimmen: jede trägt den Konstantwert
    assert_eq!(p.sample_stereo(), (2.0 * (0.25 + 0.125), 2.0 * (0.25 + 0.5)));
    assert_eq!(p.sample(), 0.5 * 0.75 + 0.5 * 1.5);
}

#[test]
fn mono_graph_klingt_links_wie_rechts_und_sample_ist_die_seite() {
    let mut p = saegen("", r#",{"von":"vca.aus","nach":"o.x"}"#);
    let mut q = saegen("", r#",{"von":"vca.aus","nach":"o.x"}"#);
    akkord(&mut p);
    akkord(&mut q);
    for _ in 0..4800 {
        let (l, r) = p.sample_stereo();
        assert_eq!(l.to_bits(), r.to_bits());
        assert_eq!(q.sample().to_bits(), l.to_bits(), "sample bitgleich mit einer Seite");
    }
}

#[test]
fn chorus_rechnet_auf_der_summe_aller_stimmen() {
    // derselbe Graph ohne Chorus liefert die Stimmensumme; ein eigener Chorus auf dieser Summe muss Sample für Sample
    // dasselbe geben wie der Chorus im Graphen
    let mut ohne = saegen("", r#",{"von":"vca.aus","nach":"o.x"}"#);
    let mut mit = saegen(r#",{"id":"ch","art":"chorus","modus":2}"#,
                         r#",{"von":"vca.aus","nach":"ch.x"},{"von":"ch.l","nach":"o.l"},{"von":"ch.r","nach":"o.r"}"#);
    akkord(&mut ohne);
    akkord(&mut mit);
    let mut c = Chorus::neu(2, SR);
    for i in 0..9600 {
        let summe = ohne.sample();
        let soll = c.prozess(summe, 1.0);
        assert_eq!(mit.sample_stereo(), soll, "Sample {i}");
    }
}

#[test]
fn chorus_mit_mix_null_ist_die_trockene_summe() {
    let mut ohne = saegen("", r#",{"von":"vca.aus","nach":"o.x"}"#);
    let mut mit = saegen(r#",{"id":"ch","art":"chorus","modus":1,"mix":0}"#,
                         r#",{"von":"vca.aus","nach":"ch.x"},{"von":"ch.l","nach":"o.l"},{"von":"ch.r","nach":"o.r"}"#);
    akkord(&mut ohne);
    akkord(&mut mit);
    for _ in 0..4800 {
        let s = ohne.sample();
        assert_eq!(mit.sample_stereo(), (s, s));
    }
}

#[test]
fn chorus_macht_breit_aber_monotauglich() {
    // Korrelation links/rechts über eine Sekunde Akkord: unter 0,98 (es wird breit), über 0,3 (kein Auslöschen in Mono)
    let mut p = saegen(r#",{"id":"ch","art":"chorus","modus":1}"#,
                       r#",{"von":"vca.aus","nach":"ch.x"},{"von":"ch.l","nach":"o.l"},{"von":"ch.r","nach":"o.r"}"#);
    akkord(&mut p);
    let x: Vec<(f32, f32)> = (0..96_000).map(|_| p.sample_stereo()).collect();
    let (mut lr, mut ll, mut rr) = (0.0f64, 0.0f64, 0.0f64);
    for &(l, r) in &x[48_000..] {
        lr += l as f64 * r as f64;
        ll += l as f64 * l as f64;
        rr += r as f64 * r as f64;
    }
    let korr = lr / (ll * rr).sqrt();
    println!("MESS Korrelation L/R mit Chorus I {korr:.3}");
    assert!(korr < 0.98 && korr > 0.3, "Korrelation {korr}");
}

#[test]
fn chorus_modus_ausserhalb_wird_abgewiesen() {
    let j = graph(1, r#"{"id":"ch","art":"chorus","modus":4},{"id":"o","art":"ausgang"}"#, r#"{"von":"ch.l","nach":"o.l"}"#);
    assert!(uebersetze(&j, SR).is_err());
    let j = graph(1, r#"{"id":"ch","art":"chorus","modus":0},{"id":"o","art":"ausgang"}"#, r#"{"von":"ch.l","nach":"o.l"}"#);
    assert!(uebersetze(&j, SR).is_ok());
}

#[test]
fn zuruecksetzen_leert_den_chorus() {
    let mut p = saegen(r#",{"id":"ch","art":"chorus","modus":1}"#,
                       r#",{"von":"vca.aus","nach":"ch.x"},{"von":"ch.l","nach":"o.l"},{"von":"ch.r","nach":"o.r"}"#);
    akkord(&mut p);
    for _ in 0..4800 {
        p.sample_stereo();
    }
    p.zuruecksetzen();
    // ohne Note, Puffer leer: Stille auf beiden Seiten, auch der nasse Weg
    for _ in 0..480 {
        assert_eq!(p.sample_stereo(), (0.0, 0.0));
    }
}

#[test]
fn waechter_faengt_auch_eine_seite_allein() {
    // nur rechts läuft weg (s = 2·s(vorher) + 1 auf o.r), links bleibt still: der Wächter muss trotzdem greifen
    let j = graph(1, r#"{"id":"k","art":"konst","wert":1},{"id":"z","art":"konst","wert":2},{"id":"m","art":"mul"},{"id":"s","art":"add"},{"id":"o","art":"ausgang"}"#,
                  r#"{"von":"s.aus","nach":"m.a","verzoegerung":1},{"von":"z.aus","nach":"m.b"},{"von":"m.aus","nach":"s.a"},{"von":"k.aus","nach":"s.b"},{"von":"s.aus","nach":"o.r"}"#);
    let mut p = uebersetze(&j, SR).unwrap();
    let x: Vec<(f32, f32)> = (0..1000).map(|_| p.sample_stereo()).collect();
    assert!(x.iter().all(|(l, r)| l.is_finite() && r.is_finite()));
    assert!(p.rettungen >= 1);
}
