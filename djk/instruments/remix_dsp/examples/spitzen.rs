//! Peak and level change of every scene effect at the end of its travel, on a four-on-the-floor kick with a hi-hat
//! at 128 BPM. `cargo run --release -p remix_dsp --example spitzen`
use remix_dsp::{szene, Einstellung, Remix};

fn main() {
    let sr = 48000.0;
    let bps = 128.0 / 60.0 / sr;
    let beat = (1.0 / bps) as usize;
    let quelle = |i: usize| {
        let t = (i % beat) as f64 / sr;
        let kick = (t * 55.0 * std::f64::consts::TAU).sin() * (-t / 0.12).exp() * 0.6;
        let th = (i % (beat / 2)) as f64 / sr;
        let hat = (((i as u64).wrapping_mul(2654435761) % 2000) as f64 / 1000.0 - 1.0) * (-th / 0.02).exp() * 0.15;
        (kick + hat) as f32
    };
    let n = 16 * beat;
    let ein: Vec<f32> = (0..n).map(quelle).collect();
    let mass = |x: &[f32]| (x.iter().fold(0f32, |a, v| a.max(v.abs())), (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt());
    let (sp0, rms0) = mass(&ein[8 * beat..]);
    println!("type  m    peak_dB  rms_dB   (change against the input)");
    for typ in 1..=szene::TYPEN {
        for m in [0.5f32, 1.0] {
            let mut s = Remix::neu(sr);
            s.setze(&Einstellung { szene_typ: typ, szene: m, sub1: 0.5, sub2: 0.5, ..Einstellung::default() });
            let (mut l, mut r) = (ein.clone(), ein.clone());
            for (b, (cl, cr)) in l.chunks_mut(128).zip(r.chunks_mut(128)).enumerate() {
                s.block(cl, cr, (b * 128) as f64 * bps, bps);
            }
            let (sp, rms) = mass(&l[8 * beat..]);
            println!("{typ:4} {m:4.1} {:8.1} {:7.1}", 20.0 * (sp / sp0).log10(), 20.0 * (rms / rms0).log10());
        }
    }
}
