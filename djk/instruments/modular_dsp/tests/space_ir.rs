//! The shipped impulse responses of `fx-space`: length, energy, decorrelated sides, clean end, determinism.
use baukasten_dsp::proben::{schreibe_space_werk, space_ir, SpaceArt, SPACE_DATEIEN};

const SR: f32 = 48_000.0;
const ARTEN: [(SpaceArt, f64); 4] = [(SpaceArt::Raum, 0.8), (SpaceArt::Platte, 1.8), (SpaceArt::Halle, 2.0), (SpaceArt::Kammer, 1.2)];

fn seiten(d: &[f32]) -> (Vec<f64>, Vec<f64>) {
    (d.iter().step_by(2).map(|&v| v as f64).collect(), d.iter().skip(1).step_by(2).map(|&v| v as f64).collect())
}

#[test]
fn length_finite_energy() {
    for (art, sek) in ARTEN {
        let d = space_ir(art, SR);
        assert_eq!(d.len() / 2, (sek * 48000.0).round() as usize, "{art:?} frames");
        assert!(d.iter().all(|v| v.is_finite()), "{art:?}");
        let (l, r) = seiten(&d);
        for s in [&l, &r] {
            let e: f64 = s.iter().map(|v| v * v).sum();
            assert!((e - 0.5).abs() < 1e-3, "{art:?} energy {e}");
        }
    }
}

#[test]
fn sides_are_decorrelated() {
    for (art, _) in ARTEN {
        let (l, r) = seiten(&space_ir(art, SR));
        let dot: f64 = l.iter().zip(&r).map(|(a, b)| a * b).sum();
        let c = dot / (l.iter().map(|v| v * v).sum::<f64>() * r.iter().map(|v| v * v).sum::<f64>()).sqrt();
        println!("MESS space_ir {art:?} L/R correlation {c:.4}");
        assert!(c.abs() < 0.3, "{art:?} correlation {c}");
    }
}

#[test]
fn hall_ends_clean() {
    let d = space_ir(SpaceArt::Halle, SR);
    let spitze = d.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    let ende = d[d.len() - 2 * 480..].iter().fold(0.0f32, |m, v| m.max(v.abs()));
    let db = 20.0 * (ende / spitze).log10();
    println!("MESS space_ir Halle last 10 ms {db:.1} dB re peak");
    assert!(db < -60.0, "{db}");
}

#[test]
fn deterministic_and_written() {
    for (art, _) in ARTEN {
        assert_eq!(space_ir(art, SR), space_ir(art, SR));
    }
    let w = std::env::temp_dir().join(format!("space-ir-{}", std::process::id()));
    std::fs::create_dir_all(&w).unwrap();
    schreibe_space_werk(&w);
    for n in SPACE_DATEIEN {
        assert!(w.join(n).metadata().unwrap().len() > 0, "{n}");
    }
    assert_eq!(w.join("space-leer.f32").metadata().unwrap().len(), 32 * 8);
    std::fs::remove_dir_all(&w).ok();
}
