//! Baustein `komp` (Slice 4c): komp_dsp auf der Summe aller Stimmen, Ergebnis in Stimme 0 (D7).
use baukasten_dsp::uebersetze;
use komp_dsp::{Einstellung, Komp};

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

/// Graph mit `komp` gegen die Summe ohne ihn durch `komp_dsp::Komp` als ein Block über die ganze Sekunde
fn vergleiche(knoten: &str, kanten_ohne: &str, kanten_mit: &str, e: Einstellung) {
    let mut ohne = saegen("", kanten_ohne);
    let mut mit = saegen(knoten, kanten_mit);
    akkord(&mut ohne);
    akkord(&mut mit);
    let (mut l, mut r): (Vec<f32>, Vec<f32>) = (0..48_000).map(|_| ohne.sample_stereo()).unzip();
    let trocken = l.clone();
    let mut k = Komp::neu(SR as f64);
    k.setze(&e);
    k.block(&mut l, &mut r, None);
    let mut anders = 0.0f64;
    for i in 0..48_000 {
        let ist = mit.sample_stereo();
        assert_eq!((ist.0.to_bits(), ist.1.to_bits()), (l[i].to_bits(), r[i].to_bits()), "Sample {i}");
        anders += (ist.0 - trocken[i]).abs() as f64;
    }
    if e.mix > 0.0 {
        assert!(anders > 1.0, "der Komp verändert nichts, der Vergleich wäre blind ({anders})");
    }
}

#[test]
fn komp_rechnet_wie_komp_dsp() {
    let e = Einstellung { schwelle_db: -30.0, ratio: 4.0, knie_db: 6.0, attack_ms: 5.0, release_ms: 80.0, makeup_db: 3.0, mix: 1.0, sc_hochpass_hz: 0.0 };
    vergleiche(r#",{"id":"k","art":"komp","schwelle":-30,"ratio":4,"knie":6,"attack":5,"release":80,"makeup":3}"#,
               r#",{"von":"vca.aus","nach":"o.x"}"#,
               r#",{"von":"vca.aus","nach":"k.x"},{"von":"k.l","nach":"o.l"},{"von":"k.r","nach":"o.r"}"#, e);
}

#[test]
fn komp_l_und_r_getrennt_mit_halbem_mix_und_hochpass() {
    let e = Einstellung { schwelle_db: -24.0, ratio: 3.0, knie_db: 0.0, attack_ms: 1.0, release_ms: 200.0, makeup_db: 0.0, mix: 0.5, sc_hochpass_hz: 120.0 };
    vergleiche(r#",{"id":"k","art":"komp","schwelle":-24,"ratio":3,"knie":0,"attack":1,"release":200,"mix":0.5,"schp":120}"#,
               r#",{"von":"vca.aus","nach":"o.l"},{"von":"s.aus","nach":"o.r"}"#,
               r#",{"von":"vca.aus","nach":"k.l"},{"von":"s.aus","nach":"k.r"},{"von":"k.l","nach":"o.l"},{"von":"k.r","nach":"o.r"}"#, e);
}

#[test]
fn mix_null_ist_die_trockene_summe() {
    let e = Einstellung { mix: 0.0, ..Einstellung::default() };
    vergleiche(r#",{"id":"k","art":"komp","mix":0,"schwelle":-40}"#, r#",{"von":"vca.aus","nach":"o.x"}"#,
               r#",{"von":"vca.aus","nach":"k.x"},{"von":"k.l","nach":"o.l"},{"von":"k.r","nach":"o.r"}"#, Einstellung { schwelle_db: -40.0, ..e });
}

#[test]
fn falsche_werte_werden_abgewiesen() {
    for (wert, ok) in [(r#""schwelle":-60"#, true), (r#""schwelle":-61"#, false), (r#""schwelle":0.5"#, false),
                       (r#""ratio":1"#, true), (r#""ratio":0.9"#, false), (r#""ratio":20"#, true), (r#""ratio":21"#, false),
                       (r#""knie":0"#, true), (r#""knie":25"#, false), (r#""attack":0.1"#, true), (r#""attack":201"#, false),
                       (r#""release":5"#, true), (r#""release":4"#, false), (r#""makeup":-12"#, true), (r#""makeup":25"#, false),
                       (r#""mix":1"#, true), (r#""mix":1.1"#, false), (r#""schp":0"#, true), (r#""schp":19"#, false),
                       (r#""schp":20"#, true), (r#""schp":500"#, true), (r#""schp":501"#, false)] {
        let j = graph(1, &format!(r#"{{"id":"n","art":"note"}},{{"id":"k","art":"komp",{wert}}},{{"id":"o","art":"ausgang"}}"#), r#"{"von":"k.l","nach":"o.l"}"#);
        assert_eq!(uebersetze(&j, SR).is_ok(), ok, "{wert}");
    }
}
