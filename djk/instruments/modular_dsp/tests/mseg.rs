//! Multi-stage envelope (`mseg`): stage levels and times, curve shapes, sustain hold, loop, release from any stage, gate on
//! and off inside one sample, retrigger, value checks. One voice, `note.gate` and `note.trig` drive the block, so `note_an`
//! and `note_aus` give the exact gate pattern (a note-on followed by a note-off before the next sample is the same-sample
//! case).
use baukasten_dsp::{mseg::form, uebersetze, Fehler, Programm};

const SR: f32 = 48_000.0;

fn graph(werte: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"m","stimmen":1,"knoten":[{{"id":"n","art":"note"}},{{"id":"m","art":"mseg"{werte}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.gate","nach":"m.gate"}},{{"von":"n.trig","nach":"m.trig"}},{{"von":"m.aus","nach":"o.x"}}]}}"#
    )
}

fn lade(werte: &str) -> Programm { uebersetze(&graph(werte), SR).unwrap_or_else(|e| panic!("{werte}: {e:?}")) }

fn serie(p: &mut Programm, n: usize) -> Vec<f32> { (0..n).map(|_| p.sample_stereo().0).collect() }

/// three stages 1 -> 0.4 -> 0.8 in 10, 20, 30 ms, linear, no sustain stage (one-shot)
const DREI: &str = r#","stufen":3,"halt":0,"p1":1,"t1":0.01,"p2":0.4,"t2":0.02,"p3":0.8,"t3":0.03"#;
/// attack to 1 (10 ms), decay to 0.6 (10 ms) and sustain there, release to 0 in 50 ms
const ASR: &str = r#","stufen":3,"halt":2,"p1":1,"t1":0.01,"p2":0.6,"t2":0.01,"p3":0,"t3":0.05"#;

#[test]
fn stage_levels_and_times() {
    let mut p = lade(DREI);
    p.note_an(60, 1.0);
    let y = serie(&mut p, 6000);
    let mut fehler = 0.0f32;
    for j in 0..480 {
        fehler = fehler.max((y[j] - (j + 1) as f32 / 480.0).abs());
    }
    for j in 0..960 {
        fehler = fehler.max((y[480 + j] - (1.0 - 0.6 * (j + 1) as f32 / 960.0)).abs());
    }
    for j in 0..1440 {
        fehler = fehler.max((y[1440 + j] - (0.4 + 0.4 * (j + 1) as f32 / 1440.0)).abs());
    }
    println!("MESS mseg three linear stages: worst deviation {fehler:.2e}");
    assert!(fehler < 1e-5, "{fehler}");
    assert_eq!(y[479], 1.0, "stage 1 ends exactly on its level after 10 ms");
    assert_eq!(y[1439], 0.4, "stage 2 after 20 more ms");
    assert_eq!(y[2879], 0.8, "stage 3 after 30 more ms");
    assert!(y[2879..].iter().all(|v| *v == 0.8), "the last level stays (no sustain stage, gate still held)");
}

#[test]
fn zero_time_is_a_half_millisecond_ramp_not_a_jump() {
    let mut p = lade(r#","stufen":1,"halt":0,"p1":1,"t1":0"#);
    p.note_an(60, 1.0);
    let y = serie(&mut p, 100);
    assert!((y[0] - 1.0 / 24.0).abs() < 1e-6, "first sample {}", y[0]);
    assert_eq!(y[23], 1.0);
    let spr = (1..y.len()).map(|i| (y[i] - y[i - 1]).abs()).fold(y[0], f32::max);
    assert!(spr < 0.05, "largest step {spr}");
}

#[test]
fn curve_shapes() {
    // one stage 0 -> 1 in 100 ms; midpoint (u = 0.5) of the exponential curve +1: (e^3 - 1) / (e^6 - 1)
    let mitte = |k: f32| -> (f32, Vec<f32>) {
        let mut p = lade(&format!(r#","stufen":1,"halt":0,"p1":1,"t1":0.1,"k1":{k}"#));
        p.note_an(60, 1.0);
        let y = serie(&mut p, 4800);
        (y[2399], y)
    };
    let exp_soll = (3f32.exp() - 1.0) / (6f32.exp() - 1.0);
    let (lin, yl) = mitte(0.0);
    let (ex, ye) = mitte(1.0);
    let (lg, yg) = mitte(-1.0);
    let (ex_halb, _) = mitte(0.5);
    println!("MESS mseg curve midpoints: k=0 {lin:.5}, k=+1 {ex:.5} (expected {exp_soll:.5}), k=-1 {lg:.5}, k=+0.5 {ex_halb:.5}");
    assert!((lin - 0.5).abs() < 1e-3);
    assert!((ex - exp_soll).abs() < 1e-3, "{ex} vs {exp_soll}");
    // logarithmic is the exponential mirrored: s_-(u) = 1 - s_+(1 - u)
    assert!((lg - (1.0 - exp_soll)).abs() < 1e-3, "{lg}");
    assert!(ex < ex_halb && ex_halb < lin && lin < lg, "ordering of the curves at the midpoint");
    for y in [&yl, &ye, &yg] {
        assert_eq!(y[4799], 1.0, "every curve ends exactly on the target");
        assert!(y.windows(2).all(|w| w[1] >= w[0]), "monotonic");
    }
    // exact against the formula along the whole stage
    let worst = (0..4800).map(|j| (ye[j] - form((j + 1) as f32 / 4800.0, 6.0)).abs()).fold(0.0f32, f32::max);
    assert!(worst < 1e-4);
}

#[test]
fn sustain_holds_while_the_gate_is_high_then_releases() {
    let mut p = lade(ASR);
    p.note_an(60, 1.0);
    let y = serie(&mut p, 48_000);
    assert_eq!(y[959], 0.6, "decay stage done after 20 ms");
    assert!(y[959..].iter().all(|v| *v == 0.6), "held for a second");
    p.note_aus(60);
    let r = serie(&mut p, 5000);
    for j in 0..2400 {
        let soll = 0.6 * (1.0 - (j + 1) as f32 / 2400.0);
        assert!((r[j] - soll).abs() < 1e-5, "release sample {j}: {} vs {soll}", r[j]);
    }
    assert_eq!(r[2399], 0.0);
    assert!(r[2399..].iter().all(|v| *v == 0.0), "stays at 0 after the release");
}

#[test]
fn release_from_any_stage_continues_from_the_current_value() {
    // stage 1 takes 480 samples; release after 100 and after 300 samples (inside stage 1), and during stage 2
    for halt_nach in [100usize, 300, 480 + 200] {
        let mut p = lade(ASR);
        p.note_an(60, 1.0);
        let vor = serie(&mut p, halt_nach);
        let v0 = *vor.last().unwrap();
        p.note_aus(60);
        let r = serie(&mut p, 4000);
        let spr = (r[0] - v0).abs();
        assert!(spr <= v0 / 2400.0 + 1e-6, "after {halt_nach} samples (value {v0}) the release starts with a jump of {spr}");
        assert!(r[0] < v0 || v0 == 0.0, "the release goes down");
        // 50 ms release stage from the current value, then 0
        assert!((r[2399]).abs() < 1e-5 && r[2399..].iter().all(|v| *v == 0.0), "after {halt_nach}: ends at {}", r[2399]);
        assert!(r.windows(2).all(|w| w[1] <= w[0]), "monotonic release");
    }
}

#[test]
fn gate_on_and_off_in_one_sample_does_not_hang() {
    // `note_an` then `note_aus` before the next sample: trig is set and the gate is already low in that sample
    for werte in [ASR, r#","stufen":4,"halt":0,"von":2,"bis":3,"p1":1,"t1":0.01,"p2":0.2,"t2":0.01,"p3":0.9,"t3":0.01,"p4":0,"t4":0.02"#,
                  r#","stufen":2,"halt":2,"p1":1,"t1":0.01,"p2":0.7,"t2":0.01"#] {
        let mut p = lade(werte);
        p.note_an(60, 1.0);
        p.note_aus(60);
        let y = serie(&mut p, 48_000);
        assert_eq!(*y.last().unwrap(), 0.0, "{werte}: hangs at {}", y.last().unwrap());
        assert!(y.iter().all(|v| (0.0..=1.0).contains(v)));
        // and the voice plays a normal note afterwards
        p.note_an(60, 1.0);
        let z = serie(&mut p, 2000);
        assert!(z.iter().cloned().fold(0.0, f32::max) > 0.5, "{werte}: the next note must run");
    }
}

#[test]
fn loop_repeats_while_the_gate_is_high_and_leaves_on_release() {
    // stages: 1 up to 1 (10 ms), loop 2..3 = down to 0 and up to 1 (10 ms each), stage 4 down to 0 in 20 ms
    let werte = r#","stufen":4,"halt":0,"von":2,"bis":3,"p1":1,"t1":0.01,"p2":0,"t2":0.01,"p3":1,"t3":0.01,"p4":0,"t4":0.02"#;
    let mut p = lade(werte);
    p.note_an(60, 1.0);
    let y = serie(&mut p, 480 + 960 * 10 + 240);
    assert_eq!(y[479], 1.0);
    let mut worst = 0.0f32;
    for k in 0..10 {
        let a = 480 + 960 * k;
        assert_eq!(y[a + 479], 0.0, "cycle {k}: stage 2 ends on 0");
        assert_eq!(y[a + 959], 1.0, "cycle {k}: stage 3 ends on 1");
        for j in 0..480 {
            worst = worst.max((y[a + j] - (1.0 - (j + 1) as f32 / 480.0)).abs());
            worst = worst.max((y[a + 480 + j] - (j + 1) as f32 / 480.0).abs());
        }
    }
    println!("MESS mseg loop: 10 cycles, worst deviation from the triangle {worst:.2e}");
    assert!(worst < 1e-5);
    // release in the middle of stage 3 (value about 0.5): stage 4 from there to 0 in 20 ms, no more loop
    let mut q = lade(werte);
    q.note_an(60, 1.0);
    let vor = serie(&mut q, 480 + 480 + 240);
    let v0 = *vor.last().unwrap();
    assert!((v0 - 0.5).abs() < 0.01, "{v0}");
    q.note_aus(60);
    let r = serie(&mut q, 4000);
    assert!((r[0] - v0).abs() <= v0 / 960.0 + 1e-6, "no jump leaving the loop");
    assert_eq!(r[959], 0.0, "stage 4 takes 20 ms from wherever it starts");
    assert!(r[959..].iter().all(|v| *v == 0.0), "the loop is left for good");
}

#[test]
fn no_stage_after_the_sustain_runs_to_zero_in_five_milliseconds() {
    let mut p = lade(r#","stufen":2,"halt":2,"p1":1,"t1":0.01,"p2":0.7,"t2":0.01"#);
    p.note_an(60, 1.0);
    let y = serie(&mut p, 2000);
    assert_eq!(*y.last().unwrap(), 0.7);
    p.note_aus(60);
    let r = serie(&mut p, 1000);
    assert!((r[0] - (0.7 - 0.7 / 240.0)).abs() < 1e-5);
    assert_eq!(r[239], 0.0);
    assert!(r[239..].iter().all(|v| *v == 0.0));
}

#[test]
fn retrigger_starts_from_the_current_value() {
    let mut p = lade(ASR);
    p.note_an(60, 1.0);
    let vor = serie(&mut p, 300);
    let v0 = *vor.last().unwrap();
    // second note on the only voice while the gate is high: a trig pulse without a gate edge
    p.note_an(64, 1.0);
    let y = serie(&mut p, 1000);
    assert!((y[0] - v0).abs() <= (1.0 - v0) / 480.0 + 1e-6, "retrigger jumps from {v0} to {}", y[0]);
    assert!(y[0] > v0);
    assert_eq!(y[479], 1.0, "stage 1 again takes 10 ms from the retrigger");
    // retrigger during the release starts at the release value
    p.note_aus(64);
    let r = serie(&mut p, 1000);
    p.note_an(60, 1.0);
    let z = serie(&mut p, 10);
    assert!((z[0] - r[999]).abs() <= (1.0 - r[999]).abs() / 480.0 + 1e-6, "{} after {}", z[0], r[999]);
}

#[test]
fn idle_voice_is_zero_and_output_stays_in_range_under_gate_mashing() {
    let mut p = lade(r#","stufen":5,"halt":0,"von":2,"bis":4,"p1":1,"t1":0.002,"p2":0.1,"t2":0.003,"k2":-0.7,"p3":0.9,"t3":0.001,"k3":1,"p4":0.3,"t4":0.002,"p5":0,"t5":0.01"#);
    assert!(serie(&mut p, 1000).iter().all(|v| *v == 0.0), "never triggered: 0");
    let mut z = 0x1234_5678u32;
    for i in 0..480_000 {
        z ^= z << 13;
        z ^= z >> 17;
        z ^= z << 5;
        match z % 400 {
            0 => p.note_an(40 + (z >> 8) as u8 % 30, 0.8),
            1 => p.note_aus(40 + (z >> 8) as u8 % 30),
            2 => p.alle_aus(),
            _ => {}
        }
        let v = p.sample_stereo().0;
        assert!(v.is_finite() && (0.0..=1.0).contains(&v), "sample {i}: {v}");
    }
}

#[test]
fn value_checks() {
    let fehler = |w: &str| match uebersetze(&graph(w), SR) {
        Err(Fehler::Wert { wert, .. }) => wert,
        r => panic!("{w}: {:?}", r.map(|_| ())),
    };
    assert_eq!(fehler(r#","stufen":0"#), "stufen");
    assert_eq!(fehler(r#","stufen":9"#), "stufen");
    assert_eq!(fehler(r#","stufen":2.5"#), "stufen");
    assert_eq!(fehler(r#","stufen":3,"halt":4"#), "halt");
    assert_eq!(fehler(r#","stufen":3,"halt":-1"#), "halt");
    assert_eq!(fehler(r#","stufen":3,"halt":0,"von":4,"bis":4"#), "von");
    assert_eq!(fehler(r#","stufen":3,"halt":0,"von":3,"bis":2"#), "bis");
    assert_eq!(fehler(r#","stufen":3,"halt":0,"von":0,"bis":2"#), "bis");
    assert_eq!(fehler(r#","stufen":3,"halt":2,"von":1,"bis":2"#), "halt");
    assert_eq!(fehler(r#","p4":1.5"#), "p1..p8");
    assert_eq!(fehler(r#","p8":-0.1"#), "p1..p8");
    assert_eq!(fehler(r#","t2":-1"#), "t1..t8");
    assert_eq!(fehler(r#","t8":61"#), "t1..t8");
    assert_eq!(fehler(r#","k5":1.1"#), "k1..k8");
    assert_eq!(fehler(r#","k1":-1.1"#), "k1..k8");
    for ok in [r#""#, r#","stufen":8,"halt":8"#, r#","stufen":8,"halt":0,"von":1,"bis":8"#, r#","stufen":3,"halt":0,"von":2,"bis":2"#,
               r#","p8":1,"t8":60,"k8":-1"#] {
        uebersetze(&graph(ok), SR).unwrap_or_else(|e| panic!("{ok}: {e:?}"));
    }
}
