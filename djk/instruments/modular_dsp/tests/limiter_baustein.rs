//! Baustein `limiter` (Slice 4c): Limiter auf der Summe aller Stimmen, Ergebnis in Stimme 0; `Programm::latenz()` (D4).
use baukasten_dsp::limiter::{vorlauf, Limiter};
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

#[test]
fn limiter_l_und_r_rechnen_wie_der_limiter_direkt() {
    // x unverbunden, l = Stimmen nach der Hüllkurve, r = Rohsäge; Decke −12 dB, damit er arbeitet
    let mut ohne = saegen("", r#",{"von":"vca.aus","nach":"o.l"},{"von":"s.aus","nach":"o.r"}"#);
    let mut mit = saegen(r#",{"id":"g","art":"limiter","decke":-12,"vorlauf":1.5,"release":40}"#,
                         r#",{"von":"vca.aus","nach":"g.l"},{"von":"s.aus","nach":"g.r"},{"von":"g.l","nach":"o.l"},{"von":"g.r","nach":"o.r"}"#);
    let mut lim = Limiter::neu(-12.0, vorlauf(1.5, SR), 40.0, SR);
    akkord(&mut ohne);
    akkord(&mut mit);
    let mut gearbeitet = 0usize;
    for i in 0..48_000 {
        let (a, b) = ohne.sample_stereo();
        let soll = lim.prozess(a, b);
        let ist = mit.sample_stereo();
        assert_eq!((ist.0.to_bits(), ist.1.to_bits()), (soll.0.to_bits(), soll.1.to_bits()), "Sample {i}");
        if a.abs().max(b.abs()) > 10f32.powf(-12.0 / 20.0) {
            gearbeitet += 1;
        }
    }
    assert!(gearbeitet > 1_000, "der Limiter hatte nichts zu tun ({gearbeitet}), der Vergleich wäre blind");
}

#[test]
fn latenz_laeuft_den_graphen_entlang() {
    let lim = |id: &str, ms: f32| format!(r#",{{"id":"{id}","art":"limiter","vorlauf":{ms}}}"#);
    let ohne = saegen("", r#",{"von":"vca.aus","nach":"o.x"}"#);
    let einer = saegen(&lim("a", 2.0), r#",{"von":"vca.aus","nach":"a.x"},{"von":"a.l","nach":"o.l"},{"von":"a.r","nach":"o.r"}"#);
    let reihe = saegen(&format!("{}{}", lim("a", 2.0), lim("b", 1.0)),
                       r#",{"von":"vca.aus","nach":"a.x"},{"von":"a.l","nach":"b.l"},{"von":"a.r","nach":"b.r"},{"von":"b.l","nach":"o.l"},{"von":"b.r","nach":"o.r"}"#);
    let parallel = saegen(&format!("{}{}", lim("a", 2.0), lim("b", 1.0)),
                          r#",{"von":"vca.aus","nach":"a.x"},{"von":"vca.aus","nach":"b.x"},{"von":"a.l","nach":"o.l"},{"von":"b.r","nach":"o.r"},{"von":"vca.aus","nach":"o.x"}"#);
    assert_eq!((ohne.latenz(), einer.latenz(), reihe.latenz(), parallel.latenz()), (0, 95, 95 + 47, 95));
}

#[test]
fn falsche_werte_werden_abgewiesen() {
    for (wert, ok) in [(r#""decke":0"#, true), (r#""decke":0.1"#, false), (r#""decke":-24"#, true), (r#""decke":-25"#, false),
                       (r#""vorlauf":0.5"#, true), (r#""vorlauf":0.4"#, false), (r#""vorlauf":5"#, true), (r#""vorlauf":5.1"#, false),
                       (r#""release":1"#, true), (r#""release":0.9"#, false), (r#""release":1000"#, true), (r#""release":1001"#, false)] {
        let j = graph(1, &format!(r#"{{"id":"n","art":"note"}},{{"id":"g","art":"limiter",{wert}}},{{"id":"o","art":"ausgang"}}"#), r#"{"von":"g.l","nach":"o.l"}"#);
        assert_eq!(uebersetze(&j, SR).is_ok(), ok, "{wert}");
    }
}
