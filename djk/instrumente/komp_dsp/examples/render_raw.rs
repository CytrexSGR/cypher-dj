//! Stereo-f32 verschachtelt von stdin durch Cypher Komp nach stdout (Vergleich mit der Faust-Referenz, komp/messung).
//! cargo run --release -p komp_dsp --example render_raw -- <schwelle> <ratio> <knie> <attack_ms> <release_ms>
use komp_dsp::{Einstellung, Komp};
use std::io::{Read, Write};

fn main() {
    let a: Vec<f64> = std::env::args().skip(1).map(|s| s.parse().unwrap()).collect();
    let mut k = Komp::neu(48000.0);
    k.setze(&Einstellung { schwelle_db: a[0], ratio: a[1], knie_db: a[2], attack_ms: a[3], release_ms: a[4], makeup_db: 0.0, mix: 1.0, sc_hochpass_hz: 0.0 });
    let mut roh = Vec::new();
    std::io::stdin().read_to_end(&mut roh).unwrap();
    let x: Vec<f32> = roh.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let n = x.len() / 2;
    let (mut l, mut r): (Vec<f32>, Vec<f32>) = ((0..n).map(|i| x[2 * i]).collect(), (0..n).map(|i| x[2 * i + 1]).collect());
    for c in (0..n).step_by(256) {
        let m = (c + 256).min(n);
        k.block(&mut l[c..m], &mut r[c..m], None);
    }
    let mut aus = Vec::with_capacity(n * 8);
    for i in 0..n {
        aus.extend_from_slice(&l[i].to_le_bytes());
        aus.extend_from_slice(&r[i].to_le_bytes());
    }
    std::io::stdout().write_all(&aus).unwrap();
}
