//! Hörprobe: helle 303-Linie aus rb_dsp (16tel, 128 BPM, 8 Takte), interleaved Stereo-f32 nach stdout.
//! Aufruf: acid <fs> [cutoff_hz] [resonanz]
use rb_dsp::{Stimme, StimmParams};
use std::io::Write;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let fs: f32 = a[1].parse().unwrap();
    let cutoff: f32 = a.get(2).map(|s| s.parse().unwrap()).unwrap_or(1400.0);
    let reso: f32 = a.get(3).map(|s| s.parse().unwrap()).unwrap_or(0.85);
    // Modus „halten <note>“: ein gehaltener Ton, Filter fest (env_mod 0), für die Alias-Messung
    if a.get(4).map(String::as_str) == Some("halten") {
        let note: u8 = a[5].parse().unwrap();
        let p = StimmParams { rechteck: false, cutoff, resonanz: reso, env_mod: 0.0, decay_s: 10.0, accent: 0.0 };
        let mut s = Stimme::default();
        s.an(note, 0.8, false);
        let mut aus = Vec::new();
        for _ in 0..(fs as usize * 4) {
            let y = s.prozess(&p, fs) * 0.5;
            aus.extend_from_slice(&y.to_le_bytes());
            aus.extend_from_slice(&y.to_le_bytes());
        }
        std::io::stdout().write_all(&aus).unwrap();
        return;
    }
    let p = StimmParams { rechteck: false, cutoff, resonanz: reso, env_mod: 0.8, decay_s: 0.35, accent: 0.8 };
    // A-Moll-Figur mit Oktavsprüngen, Akzenten (127) und Slides
    let noten: [(u8, u8, bool); 16] = [
        (33, 127, false), (45, 100, false), (33, 100, false), (48, 127, true), (45, 100, false), (33, 100, false), (52, 127, false), (45, 100, true),
        (36, 100, false), (48, 127, false), (33, 100, false), (55, 100, true), (45, 127, false), (40, 100, false), (57, 127, true), (45, 100, false),
    ];
    let schritt = (fs * 60.0 / 128.0 / 4.0) as usize;
    let mut s = Stimme::default();
    let mut aus = Vec::new();
    for takt in 0..8 {
        for (i, &(n, v, slide)) in noten.iter().enumerate() {
            s.an(n + if takt % 4 == 3 && i % 4 == 0 { 12 } else { 0 }, v as f32 / 127.0, slide);
            for k in 0..schritt {
                if k == schritt * 3 / 4 && !noten[(i + 1) % 16].2 {
                    s.aus();
                }
                let y = s.prozess(&p, fs) * 0.5;
                aus.extend_from_slice(&y.to_le_bytes());
                aus.extend_from_slice(&y.to_le_bytes());
            }
        }
    }
    std::io::stdout().write_all(&aus).unwrap();
}
