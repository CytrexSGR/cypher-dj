//! Block `vocoder` (S11 task 2): type number, I/O, value checks, sum point over voices, modulation inputs, NaN rule,
//! bit-equality with the DSP driven directly.
use baukasten_dsp::vocoder::Vocoder;
use baukasten_dsp::{uebersetze, Fehler, Programm, ARTEN};

const SR: f32 = 48_000.0;

fn graph(stimmen: usize, knoten: &str, kanten: &str) -> String {
    format!(r#"{{"format":"baukasten/2","name":"t","stimmen":{stimmen},"knoten":[{knoten}],"kanten":[{kanten}]}}"#)
}

/// eingang -> vocoder (modulator) with a carrier `saege` per voice, `werte` on the vocoder node, 2 voices
fn fx(werte: &str) -> String {
    graph(
        2,
        &format!(r#"{{"id":"e","art":"eingang"}},{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"p","art":"vocoder"{werte}}},{{"id":"o","art":"ausgang"}}"#),
        r#"{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"p.x"},{"von":"e.l","nach":"p.l"},{"von":"e.r","nach":"p.r"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#,
    )
}

/// the carrier alone (same saws, same notes) to the output: what the vocoder's `x` receives, summed over the voices
fn traeger() -> Programm {
    let g = graph(2, r#"{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"o","art":"ausgang"}"#, r#"{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"o.x"}"#);
    uebersetze(&g, SR).unwrap()
}

fn rausch(n: usize, mut s: u64, amp: f32) -> Vec<f32> {
    (0..n)
        .map(|_| {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            amp * ((s >> 11) as f64 / (1u64 << 52) as f64 - 1.0) as f32
        })
        .collect()
}

#[test]
fn vocoder_is_type_29_with_io() {
    let a = ARTEN.get(29).expect("ARTEN has no entry 29 (vocoder)");
    assert_eq!(a.art, "vocoder");
    assert_eq!(a.ein, &["x", "l", "r", "zisch", "mix"]);
    assert_eq!(a.aus, &["l", "r"]);
    for f in [("attack", 5.0), ("release", 30.0), ("pole", 4.0), ("zisch", 0.3), ("mix", 1.0)] {
        assert!(a.frei.contains(&f), "{f:?}");
    }
    assert_eq!(a.frei.len(), 5);
    assert!(ARTEN.len() >= 31, "ARTEN only grows at the end");
}

#[test]
fn value_checks() {
    let ok = |w: &str| uebersetze(&fx(w), SR);
    for w in [r#","pole":3"#, r#","pole":0"#, r#","pole":6"#, r#","pole":2.5"#, r#","attack":0.4"#, r#","attack":101"#, r#","release":4"#, r#","release":1001"#] {
        assert!(matches!(ok(w), Err(Fehler::Wert { .. })), "{w}: {:?}", ok(w).err());
    }
    for w in [r#","pole":2"#, r#","pole":4"#, r#","attack":0.5"#, r#","attack":100"#, r#","release":5"#, r#","release":1000"#, ""] {
        assert!(ok(w).is_ok(), "{w}: {:?}", ok(w).err());
    }
    // C10: the 6 kHz sibilance high-pass needs fc < 0.45 sr
    assert!(matches!(uebersetze(&fx(""), 12_000.0), Err(Fehler::Wert { .. })));
    assert!(uebersetze(&fx(""), 13_000.0).is_ok());
}

/// the block against the DSP driven directly: default values and values that all differ from the defaults (C9)
#[test]
fn block_runs_the_dsp_with_the_node_values() {
    for (werte, a, r, pole, z, m) in [("", 5.0f32, 30.0f32, 4usize, 0.3f32, 1.0f32), (r#","attack":2,"release":80,"pole":2,"zisch":0.7,"mix":0.8"#, 2.0, 80.0, 2, 0.7, 0.8)] {
        let mut p = uebersetze(&fx(werte), SR).unwrap();
        let mut roh = traeger();
        for q in [&mut p, &mut roh] {
            q.note_an(45, 0.8);
            q.note_an(52, 0.8);
        }
        let mut d = Vocoder::neu(SR, a, r, pole);
        let (l, rr) = (rausch(48_000, 1, 0.5), rausch(48_000, 2, 0.4));
        let mut wirkung = 0.0f32;
        for i in 0..48_000 {
            let c = roh.sample_stereo().0;
            p.setze_eingang(l[i], rr[i]);
            let ist = p.sample_stereo();
            let soll = d.prozess(c, l[i], rr[i], z, m);
            assert_eq!((ist.0.to_bits(), ist.1.to_bits()), (soll.to_bits(), soll.to_bits()), "{werte}: sample {i}");
            wirkung = wirkung.max(soll.abs());
        }
        assert!(wirkung > 0.05, "{werte}: the vocoder is silent, comparison would be blind");
    }
}

/// C7: carrier `x` and modulator `l` / `r` are summed over the voices separately (a 4-voice 0.25 equals a 1-voice 1)
#[test]
fn sum_point_sums_x_l_r_over_voices() {
    let lfo = |stimmen: usize, b: f32| {
        // identical saw LFOs in every voice (no note needed), scaled by b
        (r#"{"id":"w","art":"lfo","rate":137,"form":2}"#.to_string(), format!(r#"{{"id":"g","art":"mul","b":{b}}}"#), stimmen)
    };
    let bauen = |stimmen: usize, b: f32, traeger_viel: bool| {
        let (w, g, _) = lfo(stimmen, b);
        let (viel, eins) = (r#"{"von":"g.aus","nach":"p.x"},{"von":"e.l","nach":"p.l"},{"von":"e.r","nach":"p.r"}"#, r#"{"von":"g.aus","nach":"p.l"},{"von":"g.aus","nach":"p.r"},{"von":"e.l","nach":"p.x"}"#);
        graph(
            stimmen,
            &format!(r#"{{"id":"e","art":"eingang"}},{w},{g},{{"id":"p","art":"vocoder"}},{{"id":"o","art":"ausgang"}}"#),
            &format!(r#"{{"von":"w.aus","nach":"g.a"}},{},{{"von":"p.l","nach":"o.l"}},{{"von":"p.r","nach":"o.r"}}"#, if traeger_viel { viel } else { eins }),
        )
    };
    for traeger_viel in [true, false] {
        let mut vier = uebersetze(&bauen(4, 0.25, traeger_viel), SR).unwrap();
        let mut eins = uebersetze(&bauen(1, 1.0, traeger_viel), SR).unwrap();
        let x = rausch(24_000, 5, 0.5);
        let mut wirkung = 0.0f32;
        for i in 0..24_000 {
            vier.setze_eingang(x[i], x[i]);
            eins.setze_eingang(x[i], x[i]);
            let (a, b) = (vier.sample_stereo().0, eins.sample_stereo().0);
            assert!((a - b).abs() < 1e-6, "carrier on voices: {traeger_viel}, sample {i}: {a} vs {b}");
            wirkung = wirkung.max(b.abs());
        }
        assert!(wirkung > 0.05, "silent, comparison would be blind (carrier on voices: {traeger_viel})");
    }
}

/// `zisch` and `mix` inputs are read from voice 0 (S7 convention), although the sources differ per voice
#[test]
fn modulation_inputs_read_voice_0() {
    let g = graph(
        2,
        r#"{"id":"e","art":"eingang"},{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"zm","art":"mul","b":0.002},{"id":"mm","art":"mul","b":0.004},{"id":"p","art":"vocoder"},{"id":"o","art":"ausgang"}"#,
        r#"{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"p.x"},{"von":"e.l","nach":"p.l"},{"von":"e.r","nach":"p.r"},{"von":"n.hz","nach":"zm.a"},{"von":"n.hz","nach":"mm.a"},{"von":"zm.aus","nach":"p.zisch"},{"von":"mm.aus","nach":"p.mix"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}"#,
    );
    let mut p = uebersetze(&g, SR).unwrap();
    let mut roh = traeger();
    for q in [&mut p, &mut roh] {
        q.note_an(45, 0.8);
        q.note_an(52, 0.8);
    }
    assert_eq!(p.stimme(0).0, 45);
    // voice 0 plays note 45 = 110 Hz: zisch 0.22, mix 0.44 (voice 1: 0.33 / 0.66)
    let mut d = Vocoder::neu(SR, 5.0, 30.0, 4);
    let (l, r) = (rausch(24_000, 7, 0.5), rausch(24_000, 8, 0.5));
    let mut wirkung = 0.0f32;
    for i in 0..24_000 {
        let c = roh.sample_stereo().0;
        p.setze_eingang(l[i], r[i]);
        let ist = p.sample_stereo();
        let soll = d.prozess(c, l[i], r[i], 110.0f32 * 0.002, 110.0f32 * 0.004);
        assert_eq!(ist.0.to_bits(), soll.to_bits(), "sample {i}");
        wirkung = wirkung.max(soll.abs());
    }
    assert!(wirkung > 0.05);
}

/// NaN (inf * 0) on `zisch` / `mix` reads the node's own value, not the DSP default
#[test]
fn nan_on_modulation_inputs_uses_node_values() {
    let nan = r#",{"id":"g","art":"konst","wert":3e38},{"id":"h","art":"mul"},{"id":"z","art":"konst","wert":0},{"id":"q","art":"mul"}"#;
    let nan_kanten = r#"{"von":"g.aus","nach":"h.a"},{"von":"g.aus","nach":"h.b"},{"von":"h.aus","nach":"q.a"},{"von":"z.aus","nach":"q.b"}"#;
    let werte = r#","zisch":0.7,"mix":0.8"#;
    let basis = |extra_knoten: &str, extra_kanten: &str| {
        graph(
            1,
            &format!(r#"{{"id":"e","art":"eingang"}},{{"id":"c","art":"saege"}},{{"id":"p","art":"vocoder"{werte}}},{{"id":"o","art":"ausgang"}}{extra_knoten}"#),
            &format!(r#"{{"von":"e.l","nach":"c.hz"}},{{"von":"c.aus","nach":"p.x"}},{{"von":"e.l","nach":"p.l"}},{{"von":"e.r","nach":"p.r"}},{{"von":"p.l","nach":"o.l"}},{{"von":"p.r","nach":"o.r"}}{extra_kanten}"#),
        )
    };
    let l = rausch(12_000, 3, 0.5);
    let lauf = |json: &str| {
        let mut p = uebersetze(json, SR).unwrap();
        (0..l.len()).map(|i| { p.setze_eingang(l[i].abs() * 200.0 + 50.0, -l[i]); p.sample_stereo().0 }).collect::<Vec<_>>()
    };
    let soll = lauf(&basis("", ""));
    assert!(soll.iter().any(|v| v.abs() > 0.05), "silent, comparison would be blind");
    for port in ["zisch", "mix"] {
        let ist = lauf(&basis(nan, &format!(r#",{nan_kanten},{{"von":"q.aus","nach":"p.{port}"}}"#)));
        assert!(ist.iter().zip(&soll).all(|(a, b)| a.to_bits() == b.to_bits()), "NaN on {port} must read the node's value");
    }
}

#[test]
fn mix_zero_is_the_dry_mean_in_both_channels() {
    let mut p = uebersetze(&fx(r#","mix":0"#), SR).unwrap();
    p.note_an(45, 0.8);
    let (l, r) = (rausch(4800, 11, 0.5), rausch(4800, 12, 0.4));
    for i in 0..4800 {
        p.setze_eingang(l[i], r[i]);
        let (a, b) = p.sample_stereo();
        let soll = ((l[i] as f64 + r[i] as f64) * 0.5) as f32;
        assert_eq!((a.to_bits(), b.to_bits()), (soll.to_bits(), soll.to_bits()), "sample {i}");
    }
}
