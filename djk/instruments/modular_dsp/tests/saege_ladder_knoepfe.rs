//! saege-ladder got knobs (Cutoff, Resonance, Env amount, Attack, Decay, Sustain, Release, Level, Filter decay, Filter sustain).
//! Null test: with every knob at its default 0.5 (the value the panel pushes and the value a missing knob gets) the new graph renders
//! bit for bit the old knob-less skeleton (`saege_ladder_alt.json`, the graph as it was before). Then every knob must change the sound.
use baukasten_dsp::uebersetze;

const SR: f32 = 48_000.0;
const ALT: &str = include_str!("saege_ladder_alt.json");
const NEU: &str = include_str!("../demos/saege-ladder.json");

fn spiele(json: &str, knoepfe: &[(usize, f32)]) -> Vec<(f32, f32)> {
    let mut p = uebersetze(json, SR).unwrap();
    for &(n, w) in knoepfe { p.setze_regler(n, w); }
    let mut y = Vec::new();
    let mut s = |p: &mut baukasten_dsp::Programm, sek: f32| for _ in 0..(sek * SR) as usize { y.push(p.sample_stereo()); };
    for n in [45u8, 49, 52, 57] { p.note_an(n, 0.8); s(&mut p, 0.5); p.note_aus(n); }
    for n in [45u8, 49, 52, 57] { p.note_an(n, 0.8); }
    s(&mut p, 1.5);
    p.alle_aus();
    s(&mut p, 1.5);
    y
}

#[test]
fn standard_ist_bitgleich_der_alten_saege() {
    let alt = spiele(ALT, &[]);
    assert!(alt.iter().any(|(l, _)| l.abs() > 0.05), "positive control: the old graph is audible");
    assert_eq!(spiele(NEU, &[]), alt, "missing knobs (0.5)");
    let alle: Vec<(usize, f32)> = (1..=10).map(|n| (n, 0.5)).collect();
    assert_eq!(spiele(NEU, &alle), alt, "all ten knobs pushed explicitly at 0.5");
}

#[test]
fn jeder_regler_aendert_den_klang_und_bleibt_endlich() {
    let basis = spiele(NEU, &[]);
    for n in 1..=10usize {
        for w in [0.0f32, 1.0] {
            let y = spiele(NEU, &[(n, w)]);
            assert!(y.iter().all(|(l, r)| l.is_finite() && r.is_finite()), "knob {n} at {w}: not finite");
            let spitze = y.iter().fold(0.0f32, |m, (l, r)| m.max(l.abs()).max(r.abs()));
            assert!(spitze < 1.0, "knob {n} at {w}: peak {spitze}");
            // Filter decay and sustain only act when Env amount is not 0: tested together below
            if n != 9 && n != 10 { assert_ne!(y, basis, "knob {n} at {w} changes nothing"); }
        }
    }
    // Env amount at 1 (up 48 st) with the two filter envelope knobs moved
    let a = spiele(NEU, &[(3, 1.0)]);
    for (n, w) in [(9usize, 0.0f32), (9, 1.0), (10, 0.0), (10, 1.0)] {
        assert_ne!(spiele(NEU, &[(3, 1.0), (n, w)]), a, "filter knob {n} at {w} changes nothing with Env amount up");
    }
}
