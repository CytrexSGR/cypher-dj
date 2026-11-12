//! Filterbox (demos/fx-filterbox.json): the six filter types against each other on the same input, so a type that is
//! silent, far louder than its neighbours or not selected at all shows here. Prints the table with `--nocapture`.
use baukasten_dsp::uebersetze;

const SR: f32 = 48_000.0;
const TYPEN: [&str; 6] = ["ladder", "ms20", "diode", "sem", "kamm", "formant"];

/// Saw at 110 Hz plus quiet noise, about -12 dBFS, the same on both sides.
fn eingang(i: usize, zufall: &mut u32) -> f32 {
    let saege = 2.0 * ((i as f32 * 110.0 / SR) % 1.0) - 1.0;
    *zufall = zufall.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
    0.35 * saege + 0.05 * ((*zufall >> 8) as f32 / 8_388_608.0 - 1.0)
}

/// (rms dB, peak, share of the power above 2 kHz measured by a one-pole high-pass) for knob values `k` (1..8).
fn lauf(k: [f32; 8]) -> (f32, f32, f32) {
    let mut p = uebersetze(include_str!("../demos/fx-filterbox.json"), SR).unwrap();
    for (i, v) in k.iter().enumerate() {
        p.setze_regler(i + 1, *v);
    }
    let (mut z, mut q, mut qh, mut spitze, mut tp) = (1u32, 0.0f64, 0.0f64, 0.0f32, 0.0f32);
    let a = (-2.0 * std::f32::consts::PI * 2000.0 / SR).exp();
    let n = 2 * SR as usize;
    for i in 0..n {
        let x = eingang(i, &mut z);
        p.setze_eingang(x, x);
        let (l, r) = p.sample_stereo();
        assert!(l.is_finite() && r.is_finite());
        if i >= n / 2 {
            tp = a * tp + (1.0 - a) * l;
            q += (l as f64).powi(2);
            qh += ((l - tp) as f64).powi(2);
            spitze = spitze.max(l.abs()).max(r.abs());
        }
    }
    (10.0 * (q / (n / 2) as f64).max(1e-20).log10() as f32, spitze, (qh / q.max(1e-20)) as f32)
}

fn typ(i: usize) -> f32 { (i as f32 + 0.5) / 6.0 }

#[test]
fn typen_im_vergleich() {
    let trocken = lauf([0.0, 0.5, 0.3, 0.5, 0.0, 0.5, 0.0, 0.0]);
    println!("dry                 {:6.1} dB  peak {:.2}  high {:.3}", trocken.0, trocken.1, trocken.2);
    let mut pegel = Vec::new();
    for (i, name) in TYPEN.iter().enumerate() {
        for (reso, farbe) in [(0.2, 0.5), (0.9, 0.5), (0.5, 0.0), (0.5, 1.0)] {
            let (db, sp, hoch) = lauf([typ(i), 0.5, reso, farbe, 0.0, 0.5, 0.0, 1.0]);
            println!("{name:8} reso {reso:.1} colour {farbe:.1}  {db:6.1} dB  peak {sp:.2}  high {hoch:.3}");
            assert!(sp < 4.0, "{name}: peak {sp}");
            assert!(db > -60.0, "{name}: silent ({db} dB)");
            if reso == 0.2 { pegel.push(db); }
        }
    }
    // every type must give its own result: no two neighbours bit-close in level and brightness
    let bild: Vec<_> = (0..6).map(|i| lauf([typ(i), 0.5, 0.5, 0.5, 0.0, 0.5, 0.0, 1.0])).collect();
    for i in 0..6 {
        for j in i + 1..6 {
            assert!((bild[i].0 - bild[j].0).abs() > 0.05 || (bild[i].2 - bild[j].2).abs() > 1e-3, "{} and {} sound the same", TYPEN[i], TYPEN[j]);
        }
    }
    let (min, max) = pegel.iter().fold((f32::MAX, f32::MIN), |(a, b), v| (a.min(*v), b.max(*v)));
    println!("level spread at reso 0.2: {:.1} dB", max - min);
}

#[test]
fn mix_und_modulation() {
    // mix 0 is the dry signal
    let trocken = lauf([0.0, 0.5, 0.3, 0.5, 0.0, 0.5, 0.0, 0.0]);
    let auch = lauf([typ(4), 0.1, 0.9, 0.9, 0.5, 0.9, 1.0, 0.0]);
    assert!((trocken.0 - auch.0).abs() < 0.01, "mix 0 must be dry: {} vs {}", trocken.0, auch.0);
    // every modulation source moves the result against depth 0
    for (q, name) in [(0.1, "lfo"), (0.5, "sh"), (0.9, "folger")] {
        let ohne = lauf([typ(0), 0.4, 0.5, 0.5, q, 0.6, 0.0, 1.0]);
        let mit = lauf([typ(0), 0.4, 0.5, 0.5, q, 0.6, 0.7, 1.0]);
        println!("mod {name:6}: {:.1} dB / high {:.3} -> {:.1} dB / high {:.3}", ohne.0, ohne.2, mit.0, mit.2);
        assert!((ohne.0 - mit.0).abs() > 0.1 || (ohne.2 - mit.2).abs() > 1e-3, "{name} does not move the filter");
    }
}
