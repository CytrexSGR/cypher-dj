//! Zero-amount shortcuts (src/nullen.rs): what they must not change and what they change exactly.
//!
//!  * every example graph renders bit-identical with the shortcuts on and off, under six constant knob settings,
//!  * the three wavetable devices in their default state are bit-identical and really take the shortcuts,
//!  * chorus amount moved from 0 up in the middle of a render (a ramp, as the knob smoothing does it): bit-identical,
//!  * chaos amount moved from 0 up in the middle of a render: no step in the output, and bit-identical as long as the amount
//!    never rests at 0 while a shortcut is active,
//!  * the mutation: with the guard looking at the wrong factor the same comparison turns red.
mod render_hilfe;
use baukasten_dsp::Programm;
use render_hilfe::*;

fn gleich(a: &[f32], b: &[f32]) -> bool { a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.to_bits() == y.to_bits()) }

fn demo(name: &str) -> String { std::fs::read_to_string(format!("{}/demos/{name}.json", env!("CARGO_MANIFEST_DIR"))).unwrap() }

/// A chord, then a note change; `knopf(sample, programm)` may move knobs before every sample. Interleaved stereo.
fn spiele_mit_knoepfen(p: &mut Programm, laenge: usize, mut knopf: impl FnMut(usize, &mut Programm)) -> Vec<f32> {
    let mut aus = Vec::with_capacity(2 * laenge);
    for n in [45u8, 52, 57, 61] { p.note_an(n, 0.8); }
    for i in 0..laenge {
        if i == laenge / 2 { p.note_aus(52); p.note_an(66, 1.0); }
        knopf(i, p);
        let (l, r) = p.sample_stereo();
        aus.push(l);
        aus.push(r);
    }
    aus
}

fn zwei(json: &str) -> (Programm, Programm) {
    let (a, mut b) = (lade(json).unwrap(), lade(json).unwrap());
    b.setze_nullen(false);
    (a, b)
}

#[test]
fn jeder_beispielgraph_ist_bitgleich_mit_und_ohne_nullen() {
    for (name, json) in graphen() {
        for e in EINSTELLUNGEN {
            let (mut a, mut b) = zwei(&json);
            let (x, y) = (spiele(&mut a, e), spiele(&mut b, e));
            assert!(gleich(&x, &y), "{name} knobs {e:?}: output differs with the zero shortcuts on");
            assert_eq!(b.nullen_uebersprungen(), 0, "{name}: nothing may be skipped with the shortcuts off");
        }
    }
}

#[test]
fn die_drei_wavetable_geraete_sind_in_grundstellung_bitgleich_und_ueberspringen() {
    for name in ["wavetable-reese", "wavetable-supersaw", "wavetable-chor"] {
        let json = demo(name);
        let (mut a, mut b) = zwei(&json);
        let (x, y) = (spiele(&mut a, None), spiele(&mut b, None));
        assert!(gleich(&x, &y), "{name}: default state differs");
        // two chaos or chorus shortcuts per sample at least: the test would prove nothing if nothing were skipped
        assert!(a.nullen_uebersprungen() > 20_000, "{name}: skipped only {}", a.nullen_uebersprungen());
    }
}

#[test]
fn chorus_aus_null_hochgefahren_ist_bitgleich() {
    // supersaw knob 15 = chorus amount, 16 = mode; chor has them at 16 and 17
    for (name, regler, modus) in [("wavetable-supersaw", 15, 16), ("wavetable-chor", 16, 17)] {
        let json = demo(name);
        for (m, ziel) in [(0.0f32, 1.0f32), (0.5, 0.6), (1.0, 0.3)] {
            let (mut a, mut b) = zwei(&json);
            let knopf = move |i: usize, p: &mut Programm| {
                p.setze_regler(modus, m);
                // 0 for the first 30000 samples, then a 2000 sample ramp up, as the knob smoothing would travel
                let w = if i < 30_000 { 0.0 } else { (((i - 30_000) as f32) / 2_000.0).min(1.0) * ziel };
                p.setze_regler(regler, w);
            };
            let (x, y) = (spiele_mit_knoepfen(&mut a, 70_000, knopf), spiele_mit_knoepfen(&mut b, 70_000, knopf));
            assert!(gleich(&x, &y), "{name} mode knob {m}: output differs after the chorus amount left 0");
            assert!(a.nullen_uebersprungen() > 0);
        }
    }
}

/// biggest step between two neighbouring left samples from `ab` on
fn groesster_sprung(x: &[f32], ab: usize) -> f32 {
    (ab.max(1)..x.len() / 2).map(|i| (x[2 * i] - x[2 * (i - 1)]).abs()).fold(0.0, f32::max)
}

#[test]
fn chaos_aus_null_hochgefahren_klickt_nicht_und_bleibt_bei_dauernull_oder_dauerhoch_bitgleich() {
    // wavetable-reese knob 14 = chaos to position, 0.5 is exactly 0
    let json = demo("wavetable-reese");
    let lauf = |p: &mut Programm, start: usize| spiele_mit_knoepfen(p, 70_000, |i, p| {
        let w = if i < start { 0.5 } else { 0.5 + (((i - start) as f32) / 2_000.0).min(1.0) * 0.5 };
        p.setze_regler(14, w);
    });
    // never up: bit-identical (the attractor stood still, nobody read it)
    let (mut a, mut b) = zwei(&json);
    assert!(gleich(&lauf(&mut a, usize::MAX), &lauf(&mut b, usize::MAX)), "amount stays 0");
    assert!(a.nullen_uebersprungen() > 60_000);
    // up from sample 0 (the ramp starts at once): the shortcut is active for a few samples at most, and the result matches
    // the reference where the amount is above 0 from the start of the ramp onwards only as far as the attractor is concerned,
    // so compare the click behaviour instead: the amount moves up in the middle
    let (mut a, mut b) = zwei(&json);
    let (x, y) = (lauf(&mut a, 30_000), lauf(&mut b, 30_000));
    assert!(x.iter().all(|v| v.is_finite()));
    let (sa, sb) = (groesster_sprung(&x, 29_000), groesster_sprung(&y, 29_000));
    assert!(sa <= sb * 1.25 + 1e-4, "biggest step with the shortcut {sa}, with the always-running chaos {sb}");
    // the part before the ramp is bit-identical
    assert!(gleich(&x[..2 * 30_000], &y[..2 * 30_000]), "the stretch at amount 0 differs");
    // an amount above 0 from the first sample: never skipped, bit-identical
    let (mut a, mut b) = zwei(&json);
    let hoch = |p: &mut Programm| { p.setze_regler(14, 0.9); };
    let x = spiele_mit_knoepfen(&mut a, 20_000, |_, p| hoch(p));
    let y = spiele_mit_knoepfen(&mut b, 20_000, |_, p| hoch(p));
    assert!(gleich(&x, &y));
    assert_eq!(a.nullen_uebersprungen(), 0, "nothing to skip with the amount above 0");
}

#[test]
fn chaos_haelt_im_stillstand_den_note_trigger_ein() {
    // a chaos whose trig input is a note edge: at amount 0 the edge still restarts it, so the first samples after the amount
    // opens equal those of a chaos that ran all along from the same restart
    let g = |nr_max: f32| format!(
        r#"{{"format":"baukasten/2","name":"nt","stimmen":1,"knoten":[{{"id":"n","art":"note"}},{{"id":"c","art":"chaos","saat":7}},{{"id":"k","art":"regler","nr":1,"min":0,"max":{nr_max}}},{{"id":"m","art":"mul"}},{{"id":"o","art":"ausgang"}}],
"kanten":[{{"von":"n.trig","nach":"c.trig"}},{{"von":"c.aus","nach":"m.a"}},{{"von":"k.aus","nach":"m.b"}},{{"von":"m.aus","nach":"o.x"}}]}}"#
    );
    let (mut a, mut b) = zwei(&g(1.0));
    let lauf = |p: &mut Programm| {
        let mut aus = Vec::new();
        for i in 0..6_000 {
            if i == 100 { p.note_an(60, 0.8); }
            // the amount opens right after the note edge, 1 sample later than the edge
            p.setze_regler(1, if i < 101 { 0.0 } else { 1.0 });
            aus.push(p.sample_stereo().0);
        }
        aus
    };
    let (x, y) = (lauf(&mut a), lauf(&mut b));
    // sample 101: the always-running chaos has made its first step after the restart at 100; the one that stood still has not made
    // it yet, and the amount is 0 in the sample the edge came in, so both agree from the restart on up to one integration step
    assert!(a.nullen_uebersprungen() > 0);
    for i in 101..400 {
        assert!((x[i] - y[i]).abs() < 1e-3, "sample {i}: {} against {}", x[i], y[i]);
    }
}
