//! Rendert einen Loop der Studio-Bibliothek (~/.config/cypherdj/loops/<name>/loop.f32, Stereo verschachtelt) durch Cypher
//! Komp und legt ihn als neuen Loop ab, im RMS an das Original angeglichen (A/B ohne Lautheitsvorteil).
//! cargo run --release -p komp_dsp --example render_loop -- <quelle> <ziel> <schwelle> <ratio> <knie> <attack> <release>
use komp_dsp::{Einstellung, Komp};
use std::fs;

fn rms(l: &[f32], r: &[f32]) -> f64 {
    let s: f64 = l.iter().chain(r.iter()).map(|v| (*v as f64) * (*v as f64)).sum();
    (s / (l.len() + r.len()) as f64).sqrt()
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let basis = format!("{}/.config/cypherdj/loops", std::env::var("HOME").unwrap());
    let (quelle, ziel) = (&a[1], &a[2]);
    let f = |i: usize| a[i].parse::<f64>().unwrap();
    let roh = fs::read(format!("{basis}/{quelle}/loop.f32")).unwrap();
    let x: Vec<f32> = roh.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let n = x.len() / 2;
    let (mut l, mut r): (Vec<f32>, Vec<f32>) = ((0..n).map(|i| x[2 * i]).collect(), (0..n).map(|i| x[2 * i + 1]).collect());
    let vorher = rms(&l, &r);
    if vorher == 0.0 {
        eprintln!("{quelle} ist stumm (RMS 0), nichts zu rendern");
        std::process::exit(2);
    }
    let e = Einstellung { schwelle_db: f(3), ratio: f(4), knie_db: f(5), attack_ms: f(6), release_ms: f(7), makeup_db: 0.0, mix: 1.0, sc_hochpass_hz: 0.0 };
    let mut k = Komp::neu(48000.0);
    k.setze(&e);
    // zweimal durch: der zweite Durchlauf beginnt mit eingeschwungenem Detektor (der Loop wiederholt sich im Spiel)
    let (l0, r0) = (l.clone(), r.clone());
    k.block(&mut l, &mut r, None);
    let (mut l, mut r) = (l0, r0);
    let mut gr_max: f64 = 0.0;
    for c in (0..n).step_by(256) {
        let m = (c + 256).min(n);
        k.block(&mut l[c..m], &mut r[c..m], None);
        gr_max = gr_max.max(k.gr_db());
    }
    let g = (vorher / rms(&l, &r)) as f32;
    let mut aus = Vec::with_capacity(n * 8);
    let mut spitze: f32 = 0.0;
    for i in 0..n {
        for v in [l[i] * g, r[i] * g] {
            spitze = spitze.max(v.abs());
            aus.extend_from_slice(&v.to_le_bytes());
        }
    }
    fs::create_dir_all(format!("{basis}/{ziel}")).unwrap();
    fs::write(format!("{basis}/{ziel}/loop.f32"), aus).unwrap();
    let json = fs::read_to_string(format!("{basis}/{quelle}/loop.json")).unwrap()
        .replace(&format!("\"name\": \"{quelle}\""), &format!("\"name\": \"{ziel}\""))
        .replace("\"quelle\": \"mitschnitt\"", "\"quelle\": \"cypher\"");
    fs::write(format!("{basis}/{ziel}/loop.json"), json).unwrap();
    println!("{ziel}: Angleich {:+.2} dB, Absenkung bis {gr_max:.1} dB, Spitze {:.2} dBFS",
             20.0 * (g as f64).log10(), 20.0 * (spitze as f64).log10());
}
