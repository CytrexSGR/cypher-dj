//! Block `phaser` (S7 task 2): type number, I/O, value checks, sum point, modulation inputs, NaN rule.
use baukasten_dsp::phaser::Phaser;
use baukasten_dsp::{uebersetze, Fehler, Programm, ARTEN};

const SR: f32 = 48_000.0;

fn graph(stimmen: usize, knoten: &str, kanten: &str) -> String {
    format!(r#"{{"format":"baukasten/2","name":"t","stimmen":{stimmen},"knoten":[{knoten}],"kanten":[{kanten}]}}"#)
}

/// eingang -> phaser -> ausgang with `werte` on the phaser node
fn fx(werte: &str) -> String {
    graph(
        1,
        &format!(r#"{{"id":"e","art":"eingang"}},{{"id":"p","art":"phaser"{werte}}},{{"id":"o","art":"ausgang"}}"#),
        r#"{"von":"e.l","nach":"p.l"},{"von":"e.r","nach":"p.r"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#,
    )
}

fn rausch(n: usize, mut s: u64) -> Vec<f32> {
    (0..n)
        .map(|_| {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            0.8 * ((s >> 11) as f64 / (1u64 << 52) as f64 - 1.0) as f32
        })
        .collect()
}

fn lauf(p: &mut Programm, l: &[f32], r: &[f32]) -> Vec<(f32, f32)> {
    (0..l.len()).map(|i| { p.setze_eingang(l[i], r[i]); p.sample_stereo() }).collect()
}

const WERTE: &str = r#","rate":0.7,"tiefe":0.8,"fb":0.4,"mix":0.6,"stufen":4,"tief":200,"hoch":3000,"breite":45"#;

#[test]
fn phaser_is_type_27_with_io() {
    let a = &ARTEN[27];
    assert_eq!(a.art, "phaser");
    assert_eq!(a.ein, &["x", "l", "r", "rate", "tiefe", "fb", "mix"]);
    assert_eq!(a.aus, &["l", "r"]);
    for f in [("rate", 0.3), ("tiefe", 1.0), ("fb", 0.5), ("mix", 0.5), ("stufen", 6.0), ("tief", 300.0), ("hoch", 4800.0), ("breite", 90.0)] {
        assert!(a.frei.contains(&f), "{f:?}");
    }
}

#[test]
fn block_runs_the_dsp_with_the_node_values() {
    // every value differs from its default, so a hardwired value in the build arm shows
    let mut p = uebersetze(&fx(WERTE), SR).unwrap();
    let mut d = Phaser::neu(SR, 4, 200.0, 3000.0, 45.0);
    let (l, r) = (rausch(20_000, 1), rausch(20_000, 2));
    let y = lauf(&mut p, &l, &r);
    let mut wirkung = 0.0f32;
    for i in 0..l.len() {
        let soll = d.prozess(l[i], r[i], 0.7, 0.8, 0.4, 0.6);
        assert_eq!((y[i].0.to_bits(), y[i].1.to_bits()), (soll.0.to_bits(), soll.1.to_bits()), "sample {i}");
        wirkung = wirkung.max((soll.0 - l[i]).abs());
    }
    assert!(wirkung > 0.1, "the phaser changes nothing, comparison would be blind");
}

#[test]
fn odd_stufen_rejected() {
    let ok = |s: &str| uebersetze(&fx(&format!(r#","stufen":{s}"#)), SR);
    for s in ["5", "14", "0", "1", "13", "4.5", "-2"] {
        assert!(matches!(ok(s), Err(Fehler::Wert { .. })), "stufen {s}: {:?}", ok(s).err());
    }
    for s in ["2", "8", "12"] {
        assert!(ok(s).is_ok(), "stufen {s}");
    }
}

#[test]
fn phaser_tief_hoch_rejected() {
    let ok = |w: &str| uebersetze(&fx(w), SR);
    for w in [r#","tief":0"#, r#","hoch":30000"#, r#","hoch":24000"#, r#","tief":5000"#, r#","tief":300,"hoch":300"#, r#","tief":-5"#] {
        assert!(matches!(ok(w), Err(Fehler::Wert { .. })), "{w}: {:?}", ok(w).err());
    }
    assert!(ok(r#","tief":20,"hoch":23999"#).is_ok());
}

#[test]
fn sum_point_rule() {
    // two voices into `x`: same output as their sum (the output node adds the voices) fed into voice 0 of a direct phaser
    let knoten = r#"{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"o","art":"ausgang"}"#;
    let kanten = r#"{"von":"n.hz","nach":"s.hz"}"#;
    let mut roh = uebersetze(&graph(2, knoten, &format!(r#"{kanten},{{"von":"s.aus","nach":"o.x"}}"#)), SR).unwrap();
    let mit = graph(
        2,
        &format!(r#"{knoten},{{"id":"p","art":"phaser"{WERTE}}}"#),
        &format!(r#"{kanten},{{"von":"s.aus","nach":"p.x"}},{{"von":"p.l","nach":"o.l"}},{{"von":"p.r","nach":"o.r"}}"#),
    );
    let mut p = uebersetze(&mit, SR).unwrap();
    for q in [&mut roh, &mut p] {
        q.note_an(45, 0.8);
        q.note_an(52, 0.8);
    }
    let mut d = Phaser::neu(SR, 4, 200.0, 3000.0, 45.0);
    let mut wirkung = 0.0f32;
    for i in 0..24_000 {
        let s = roh.sample_stereo().0;
        let soll = d.prozess(s, s, 0.7, 0.8, 0.4, 0.6);
        let ist = p.sample_stereo();
        assert_eq!((ist.0.to_bits(), ist.1.to_bits()), (soll.0.to_bits(), soll.1.to_bits()), "sample {i}");
        wirkung = wirkung.max((soll.0 - s).abs());
    }
    assert!(wirkung > 0.1, "blind comparison");
}

#[test]
fn mix_input_modulates() {
    // konst 0 on `mix` overrides the free value: output equals the input bit for bit
    let g = graph(
        1,
        r#"{"id":"e","art":"eingang"},{"id":"p","art":"phaser"},{"id":"m","art":"konst","wert":0},{"id":"o","art":"ausgang"}"#,
        r#"{"von":"e.l","nach":"p.l"},{"von":"e.r","nach":"p.r"},{"von":"m.aus","nach":"p.mix"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#,
    );
    let mut p = uebersetze(&g, SR).unwrap();
    let (l, r) = (rausch(5000, 3), rausch(5000, 4));
    let y = lauf(&mut p, &l, &r);
    for i in 0..l.len() {
        assert!(y[i].0 == l[i] && y[i].1 == r[i], "sample {i}");
    }
    // negative control: without the edge the default mix 0.5 changes the signal
    let mut q = uebersetze(&fx(""), SR).unwrap();
    let z = lauf(&mut q, &l, &r);
    assert!(z.iter().zip(&l).any(|(a, b)| (a.0 - b).abs() > 0.05));
}

#[test]
fn nan_on_rate_input_uses_default() {
    // inf (3e38 * 3e38) times 0 = NaN on each modulation input: treated like the node's own value
    let nan = r#",{"id":"g","art":"konst","wert":3e38},{"id":"h","art":"mul"},{"id":"z","art":"konst","wert":0},{"id":"n","art":"mul"}"#;
    let nan_kanten = r#"{"von":"g.aus","nach":"h.a"},{"von":"g.aus","nach":"h.b"},{"von":"h.aus","nach":"n.a"},{"von":"z.aus","nach":"n.b"}"#;
    for port in ["rate", "tiefe", "fb", "mix"] {
        let g = graph(
            1,
            &format!(r#"{{"id":"e","art":"eingang"}},{{"id":"p","art":"phaser"{WERTE}}},{{"id":"o","art":"ausgang"}}{nan}"#),
            &format!(r#"{{"von":"e.l","nach":"p.l"}},{{"von":"e.r","nach":"p.r"}},{{"von":"n.aus","nach":"p.{port}"}},{{"von":"p.l","nach":"o.l"}},{{"von":"p.r","nach":"o.r"}},{nan_kanten}"#),
        );
        let (mut a, mut b) = (uebersetze(&g, SR).unwrap(), uebersetze(&fx(WERTE), SR).unwrap());
        let (l, r) = (rausch(6000, 5), rausch(6000, 6));
        let (ya, yb) = (lauf(&mut a, &l, &r), lauf(&mut b, &l, &r));
        assert_eq!(a.rettungen, 0, "{port}");
        assert_eq!(ya, yb, "NaN on {port} must act like the node's own value");
        assert!(yb.iter().zip(&l).any(|(a, b)| (a.0 - b).abs() > 0.05));
    }
}
