//! Extreme settings of the wavetable example graphs with the wave envelope: every knob at 1, including Env amount (knob 7 = +1,
//! saw morphed fully toward the square, which is louder than the saw) and the slowest attack and decay.
//! The graphs have no limiter, so the peak can pass 1.0; it must stay finite and under 1.25 (same bound as the Drift case of
//! `synth_poly`). Env amount off (0.5) must stay below 1.0, as before the envelope existed.
use baukasten_dsp::{uebersetze, REGLER};

const SR: f32 = 48_000.0;

fn spitze(name: &str, knob7: f32) -> f32 {
    let json = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("demos").join(format!("{name}.json"))).unwrap();
    let mut p = uebersetze(&json, SR).unwrap_or_else(|e| panic!("{name}: {e}"));
    for k in 1..=REGLER {
        p.setze_regler(k, 1.0);
    }
    p.setze_regler(7, knob7);
    for n in [45u8, 52, 57, 64] {
        p.note_an(n, 0.8);
    }
    let mut s = 0.0f32;
    for i in 0..(4.0 * SR) as usize {
        if i == (2.5 * SR) as usize {
            p.alle_aus();
        }
        let (l, r) = p.sample_stereo();
        assert!(l.is_finite() && r.is_finite(), "{name}: not finite");
        s = s.max(l.abs()).max(r.abs());
    }
    assert_eq!(p.rettungen, 0, "{name}: rescued");
    s
}

#[test]
fn wavetable_alle_regler_auf_eins_clippt_nicht_ueber_grenze() {
    for name in ["wavetable-chor", "wavetable-reese", "wavetable-supersaw"] {
        let (aus, an) = (spitze(name, 0.5), spitze(name, 1.0));
        println!("MESS {name}: all 1, Env amount off peak {aus:.3}, Env amount +1 peak {an:.3}");
        assert!(aus < 1.0, "{name}: peak {aus} with the envelope off");
        assert!(an < 1.25, "{name}: peak {an} with Env amount +1");
    }
}
