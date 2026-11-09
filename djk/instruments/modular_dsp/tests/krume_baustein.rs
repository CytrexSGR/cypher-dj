//! Block `krume` (S7 task 1): type number, I/O, per voice, bits input, NaN rule, latency.
use baukasten_dsp::{uebersetze, Programm, ARTEN};

const SR: f32 = 48_000.0;

fn graph(knoten: &str, kanten: &str) -> String {
    format!(r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"e","art":"eingang"}},{{"id":"o","art":"ausgang"}}{knoten}],"kanten":[{kanten}]}}"#)
}

/// eingang -> krume(l), krume(r) -> ausgang, `werte` goes into both krume nodes
fn lr(werte: &str) -> String {
    graph(
        &format!(r#",{{"id":"kl","art":"krume"{werte}}},{{"id":"kr","art":"krume"{werte}}}"#),
        r#"{"von":"e.l","nach":"kl.x"},{"von":"e.r","nach":"kr.x"},{"von":"kl.aus","nach":"o.l"},{"von":"kr.aus","nach":"o.r"}"#,
    )
}

fn lauf(p: &mut Programm, n: usize, f: impl Fn(usize) -> (f32, f32)) -> Vec<(f32, f32)> {
    (0..n).map(|i| { let (l, r) = f(i); p.setze_eingang(l, r); p.sample_stereo() }).collect()
}

#[test]
fn krume_is_type_26_with_io() {
    let a = &ARTEN[26];
    assert_eq!(a.art, "krume");
    assert_eq!(a.ein, &["x", "bits", "rate"]);
    assert_eq!(a.aus, &["aus"]);
    assert!(a.frei.contains(&("bits", 12.0)));
    assert!(a.frei.contains(&("rate", 26040.0)));
}

#[test]
fn effect_graph_krume_lr() {
    let mut p = uebersetze(&lr(r#","bits":4,"rate":48000"#), SR).unwrap();
    let y = lauf(&mut p, 4800, |i| (0.3 * (i as f32 * 0.07).sin(), 0.0));
    assert!(y.iter().all(|(_, r)| *r == 0.0), "right side must stay exactly 0");
    assert!(y.iter().all(|(l, _)| (l * 8.0).fract() == 0.0), "left values must be k/8");
    let mut set: Vec<u32> = y.iter().map(|(l, _)| l.to_bits()).collect();
    set.sort();
    set.dedup();
    assert!(set.len() >= 5, "quantized sine must use several levels ({})", set.len());
}

#[test]
fn bits_input_modulates() {
    // konst 2 on `bits` overrides the free value 12 (q = 2): outputs in {-1, -0.5, 0, 0.5, 1}
    let g = graph(
        r#",{"id":"k","art":"krume","rate":48000},{"id":"b","art":"konst","wert":2}"#,
        r#"{"von":"e.l","nach":"k.x"},{"von":"b.aus","nach":"k.bits"},{"von":"k.aus","nach":"o.l"}"#,
    );
    let mut p = uebersetze(&g, SR).unwrap();
    let y = lauf(&mut p, 4800, |i| (0.9 * (i as f32 * 0.05).sin(), 0.0));
    assert!(y.iter().all(|(l, _)| [-1.0, -0.5, 0.0, 0.5, 1.0].contains(l)));
    assert!(y.iter().any(|(l, _)| *l == 1.0) && y.iter().any(|(l, _)| *l == 0.5), "levels not reached, test would be blind");
}

#[test]
fn latency_unchanged() {
    let mit = uebersetze(&lr(""), SR).unwrap();
    let ohne = uebersetze(&graph("", r#"{"von":"e.l","nach":"o.l"},{"von":"e.r","nach":"o.r"}"#), SR).unwrap();
    assert_eq!(mit.latenz(), ohne.latenz());
}

#[test]
fn nan_on_rate_input_uses_default() {
    // inf (3e38 * 3e38) times 0 = NaN on `rate` and on `bits`: both are treated like the node's own value
    let nan = r#",{"id":"g","art":"konst","wert":3e38},{"id":"h","art":"mul"},{"id":"z","art":"konst","wert":0},{"id":"n","art":"mul"}"#;
    let nan_kanten = r#"{"von":"g.aus","nach":"h.a"},{"von":"g.aus","nach":"h.b"},{"von":"h.aus","nach":"n.a"},{"von":"z.aus","nach":"n.b"}"#;
    for (port, werte) in [("rate", r#","bits":24"#), ("bits", r#","rate":48000"#)] {
        let g = graph(
            &format!(r#",{{"id":"k","art":"krume"{werte}}}{nan}"#),
            &format!(r#"{{"von":"e.l","nach":"k.x"}},{{"von":"n.aus","nach":"k.{port}"}},{{"von":"k.aus","nach":"o.l"}},{nan_kanten}"#),
        );
        let ref_g = graph(&format!(r#",{{"id":"k","art":"krume"{werte}}}"#), r#"{"von":"e.l","nach":"k.x"},{"von":"k.aus","nach":"o.l"}"#);
        let (mut a, mut b) = (uebersetze(&g, SR).unwrap(), uebersetze(&ref_g, SR).unwrap());
        let f = |i: usize| (0.8 * (i as f32 * 0.03).sin(), 0.0);
        let (ya, yb) = (lauf(&mut a, 2000, f), lauf(&mut b, 2000, f));
        assert_eq!(a.rettungen, 0, "{port}");
        assert!(ya.iter().all(|v| v.0.is_finite()));
        assert_eq!(ya, yb, "NaN on {port} must act like the node's own value");
        assert!(yb.iter().any(|v| v.0 != 0.0));
    }
}
