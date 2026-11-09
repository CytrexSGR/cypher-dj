//! Rendert Rohaudio (f32, stereo verschachtelt) durch den Hall: stdin → stdout.
//! Aufruf: rendern <fs> [schluessel=wert …], Schlüssel wie die Felder von HallEinstellung.
use hall_dsp::{Hall, HallEinstellung};
use std::io::{Read, Write};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let fs: f64 = a[1].parse().unwrap();
    let mut e = HallEinstellung::default();
    for kv in &a[2..] {
        let (k, v) = kv.split_once('=').unwrap();
        let f: f64 = v.parse().unwrap();
        match k {
            "mix" => e.mix = f, "frueh" => e.frueh = f, "fahne_db" => e.fahne_db = f, "pre_ms" => e.pre_ms = f,
            "groesse_ms" => e.groesse_ms = f, "decay_s" => e.decay_s = f, "tief_faktor" => e.tief_faktor = f,
            "hoch_faktor" => e.hoch_faktor = f, "lowcut_hz" => e.lowcut_hz = f, "highcut_hz" => e.highcut_hz = f,
            "diffusion" => e.diffusion = f, "breite" => e.breite = f, "duck" => e.duck = f,
            "freeze" => e.freeze = f > 0.5, "rahmen" => e.rahmen = f as usize,
            _ => panic!("unbekannt: {k}"),
        }
    }
    let mut roh = Vec::new();
    std::io::stdin().read_to_end(&mut roh).unwrap();
    let x: Vec<f32> = roh.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let n = x.len() / 2;
    let mut l: Vec<f32> = (0..n).map(|i| x[2 * i]).collect();
    let mut r: Vec<f32> = (0..n).map(|i| x[2 * i + 1]).collect();
    let mut h = Hall::neu(fs);
    h.setze(e);
    h.reset();
    for (cl, cr) in l.chunks_mut(512).zip(r.chunks_mut(512)) {
        h.verarbeite_stereo(cl, cr);
    }
    let mut aus = Vec::with_capacity(n * 8);
    for i in 0..n {
        aus.extend_from_slice(&l[i].to_le_bytes());
        aus.extend_from_slice(&r[i].to_le_bytes());
    }
    std::io::stdout().write_all(&aus).unwrap();
}
