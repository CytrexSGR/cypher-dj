//! Baustein `gate` (Slice 4c): Gate auf der Summe aller Stimmen, Ergebnis in Stimme 0.
use baukasten_dsp::gate::Gate;
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
fn gate_l_und_r_rechnen_wie_das_gate_direkt() {
    // Akkord 0,3 s an, dann aus (release 0,05 s): das Gate öffnet, schließt im Ausklang
    let mut ohne = saegen(r#",{"id":"h","art":"mul","b":0.5}"#, r#",{"von":"vca.aus","nach":"o.l"},{"von":"vca.aus","nach":"h.a"},{"von":"h.aus","nach":"o.r"}"#);
    let mut mit = saegen(r#",{"id":"h","art":"mul","b":0.5},{"id":"g","art":"gate","schwelle":-30,"hyst":4,"tiefe":60,"attack":2,"release":30}"#,
                         r#",{"von":"vca.aus","nach":"g.l"},{"von":"vca.aus","nach":"h.a"},{"von":"h.aus","nach":"g.r"},{"von":"g.l","nach":"o.l"},{"von":"g.r","nach":"o.r"}"#);
    let mut gate = Gate::neu(-30.0, 4.0, 60.0, 2.0, 30.0, SR);
    akkord(&mut ohne);
    akkord(&mut mit);
    let (mut auf, mut zu) = (false, false);
    for i in 0..48_000 {
        if i == 14_400 {
            ohne.alle_aus();
            mit.alle_aus();
        }
        let (a, b) = ohne.sample_stereo();
        let soll = gate.prozess(a, b);
        let ist = mit.sample_stereo();
        assert_eq!((ist.0.to_bits(), ist.1.to_bits()), (soll.0.to_bits(), soll.1.to_bits()), "Sample {i}");
        auf |= gate.offen();
        zu |= auf && !gate.offen();
    }
    assert!(auf && zu, "das Gate muss öffnen und wieder schließen, sonst ist der Vergleich blind (auf {auf}, zu {zu})");
}

#[test]
fn falsche_werte_werden_abgewiesen() {
    for (wert, ok) in [(r#""schwelle":0"#, true), (r#""schwelle":0.5"#, false), (r#""schwelle":-90"#, true), (r#""schwelle":-91"#, false),
                       (r#""hyst":0"#, true), (r#""hyst":-1"#, false), (r#""hyst":24"#, true), (r#""hyst":25"#, false),
                       (r#""tiefe":0"#, true), (r#""tiefe":120"#, true), (r#""tiefe":121"#, false),
                       (r#""attack":0.1"#, true), (r#""attack":0.05"#, false), (r#""attack":100"#, true), (r#""attack":101"#, false),
                       (r#""release":1"#, true), (r#""release":0.5"#, false), (r#""release":5000"#, true), (r#""release":5001"#, false)] {
        let j = graph(1, &format!(r#"{{"id":"n","art":"note"}},{{"id":"g","art":"gate",{wert}}},{{"id":"o","art":"ausgang"}}"#), r#"{"von":"g.l","nach":"o.l"}"#);
        assert_eq!(uebersetze(&j, SR).is_ok(), ok, "{wert}");
    }
}
