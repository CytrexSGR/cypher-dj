//! Cost of the device per block of 128 samples at 48 kHz, for every scene effect combined with every isolate effect,
//! with a voice repeating on the pad and the pump on. Prints the mean and the slowest block in microseconds.
//! `cargo run --release -p remix_dsp --example kosten`
use remix_dsp::{isolate, szene, Einstellung, Remix};
use std::time::Instant;

fn main() {
    let sr = 48000.0;
    let bps = 128.0 / 60.0 / sr;
    let mut schlimmstes = (0.0f64, 0u8, 0u8);
    println!("scene iso   mean_us   max_us");
    for st in 0..=szene::TYPEN {
        for it in 0..=isolate::TYPEN {
            let mut s = Remix::neu(sr);
            s.setze(&Einstellung {
                szene_typ: st,
                szene: 0.9,
                sub2: 0.6,
                iso_typ: it,
                low: 0.8,
                mid: -0.8,
                hi: 0.8,
                hat: true,
                kick: true,
                beruehrt: true,
                pad: 0.1,
                pumpen: 0.5,
                ..Einstellung::default()
            });
            let (mut l, mut r) = ([0f32; 128], [0f32; 128]);
            let (mut summe, mut max) = (0.0f64, 0.0f64);
            let bloecke = 3750; // 10 s
            for b in 0..bloecke {
                for i in 0..128 {
                    let t = (b * 128 + i) as f32;
                    l[i] = (t * 0.02).sin() * 0.4 + (t * 0.31).sin() * 0.1;
                    r[i] = l[i];
                }
                let t0 = Instant::now();
                s.block(&mut l, &mut r, (b * 128) as f64 * bps, bps);
                let us = t0.elapsed().as_secs_f64() * 1e6;
                summe += us;
                if b > 10 && us > max {
                    max = us;
                }
            }
            println!("{st:5} {it:3} {:9.1} {max:8.1}", summe / bloecke as f64);
            if summe / bloecke as f64 > schlimmstes.0 {
                schlimmstes = (summe / bloecke as f64, st, it);
            }
        }
    }
    println!("slowest mean: {:.1} us (scene {}, iso {}); a block of 128 samples lasts 2667 us", schlimmstes.0, schlimmstes.1, schlimmstes.2);
}
