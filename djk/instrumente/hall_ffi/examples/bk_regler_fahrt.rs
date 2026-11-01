//! Baukasten S5r: offline render of an effect graph through the C ABI, knob 1 ramped per 256-sample block exactly
//! like the engine feeds it (cypher_bk_regler once per block, the FFI smooths). Writes a 16-bit stereo WAV.
//! Usage: cargo run --release --example bk_regler_fahrt -- GRAPH.json OUT.wav [SECONDS] [--ohne-rampe] [--je-sample]
//! --je-sample feeds the knob every sample (reference without block steps), --roh writes f32 without normalising.
use hall_ffi::baukasten::*;
use std::ffi::CString;
use std::io::Write;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let json = std::fs::read_to_string(&a[1]).expect("graph");
    let sek: f32 = a.get(3).and_then(|s| s.parse().ok()).unwrap_or(12.0);
    let rampe = !a.iter().any(|s| s == "--ohne-rampe");
    let je_sample = a.iter().any(|s| s == "--je-sample");
    let fs = 48_000.0;
    let c = CString::new(json).unwrap();
    let mut fehler = [0 as std::os::raw::c_char; 256];
    let h = cypher_bk_neu(c.as_ptr(), fs, fehler.as_mut_ptr(), fehler.len());
    assert!(!h.is_null(), "graph rejected");
    let n_ges = (sek * fs as f32) as usize;
    const B: usize = 256;
    let mut s: u32 = 0x9e37_79b9;
    let (mut l, mut r, mut ol, mut or_) = ([0f32; B], [0f32; B], [0f32; B], [0f32; B]);
    let mut aus: Vec<(f32, f32)> = Vec::with_capacity(n_ges);
    let mut phase = 0f32;
    let mut i = 0;
    while i < n_ges {
        let t = i as f32 / n_ges as f32;
        // knob 1: 0 -> 1 over the middle 80 % (hold at both ends), knob 2 resonance 0.5
        let k1 = if rampe { ((t - 0.1) / 0.8).clamp(0.0, 1.0) } else { 0.5 };
        cypher_bk_regler(h, 1, k1);
        cypher_bk_regler(h, 2, 0.5);
        for j in 0..B {
            s ^= s << 13; s ^= s >> 17; s ^= s << 5;
            let rausch = (s as f32 / u32::MAX as f32 - 0.5) * 0.15;
            phase = (phase + 55.0 / fs as f32).fract();
            let saege = (2.0 * phase - 1.0) * 0.25;
            l[j] = saege + rausch; r[j] = saege - rausch;
        }
        if je_sample {
            for j in 0..B {
                let tj = (i + j) as f32 / n_ges as f32;
                let kj = if rampe { ((tj - 0.1) / 0.8).clamp(0.0, 1.0) } else { 0.5 };
                cypher_bk_regler(h, 1, kj);
                cypher_bk_effekt(h, &l[j], &r[j], &mut ol[j], &mut or_[j], 1);
            }
        } else {
            cypher_bk_effekt(h, l.as_ptr(), r.as_ptr(), ol.as_mut_ptr(), or_.as_mut_ptr(), B);
        }
        for j in 0..B { aus.push((ol[j], or_[j])); }
        i += B;
    }
    cypher_bk_frei(h);
    let spitze = aus.iter().fold(0f32, |m, (a, b)| m.max(a.abs()).max(b.abs())).max(1e-9);
    let g = if a.iter().any(|s| s == "--roh") { 1.0 } else { 0.5 / spitze };   // normalise to -6 dBFS peak
    let mut f = std::fs::File::create(&a[2]).unwrap();
    let daten = (aus.len() * 4) as u32;
    f.write_all(b"RIFF").unwrap(); f.write_all(&(36 + daten).to_le_bytes()).unwrap(); f.write_all(b"WAVEfmt ").unwrap();
    f.write_all(&16u32.to_le_bytes()).unwrap(); f.write_all(&1u16.to_le_bytes()).unwrap(); f.write_all(&2u16.to_le_bytes()).unwrap();
    f.write_all(&48_000u32.to_le_bytes()).unwrap(); f.write_all(&(48_000u32 * 4).to_le_bytes()).unwrap();
    f.write_all(&4u16.to_le_bytes()).unwrap(); f.write_all(&16u16.to_le_bytes()).unwrap(); f.write_all(b"data").unwrap();
    f.write_all(&daten.to_le_bytes()).unwrap();
    for (a, b) in aus {
        for v in [a, b] { f.write_all(&(((v * g).clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).unwrap(); }
    }
    eprintln!("written, peak before normalising {spitze:.3}");
}
