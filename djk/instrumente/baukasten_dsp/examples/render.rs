//! Hörprobe ohne Studio: `cargo run --release -p baukasten_dsp --example render -- GRAPH.json AUS.wav [N=WEG …] [~N …]`
//! Spielt A2, C#3, E3, A3 nacheinander (je 0,5 s gehalten), dann den Akkord 1,5 s, dann 1,5 s Ausklang. 48 kHz, 16 bit, stereo.
//! `N=WEG` stellt Regler N (1..8) fest auf WEG (0..1), `~N` fährt Regler N über die ganze Dauer von 0 nach 1.
use baukasten_dsp::uebersetze;
use std::io::Write;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() < 3 {
        eprintln!("usage: render GRAPH.json OUT.wav [N=VALUE ...] [~N ...]");
        std::process::exit(2);
    }
    let mut fahren: Vec<usize> = Vec::new();
    let mut fest: Vec<(usize, f32)> = Vec::new();
    for r in &a[3..] {
        let falsch = || -> ! { eprintln!("knob argument {r:?}: N=VALUE (N 1..8, VALUE 0..1) or ~N"); std::process::exit(2) };
        if let Some(n) = r.strip_prefix('~') {
            fahren.push(n.parse().unwrap_or_else(|_| falsch()));
        } else {
            let (n, w) = r.split_once('=').unwrap_or_else(|| falsch());
            fest.push((n.parse().unwrap_or_else(|_| falsch()), w.parse().unwrap_or_else(|_| falsch())));
        }
    }
    let json = std::fs::read_to_string(&a[1]).expect("graph not readable");
    let mut p = uebersetze(&json, 48_000.0).unwrap_or_else(|e| { eprintln!("graph invalid: {e}"); std::process::exit(2) });
    let mut x: Vec<(f32, f32)> = Vec::new();
    for (n, w) in &fest {
        p.setze_regler(*n, *w);
    }
    const GESAMT: f32 = 5.0 * 48_000.0;
    let spiele = |p: &mut baukasten_dsp::Programm, s: f32, x: &mut Vec<(f32, f32)>| {
        for _ in 0..(s * 48_000.0) as usize {
            for n in &fahren {
                p.setze_regler(*n, x.len() as f32 / GESAMT);
            }
            x.push(p.sample_stereo())
        }
    };
    for n in [45u8, 49, 52, 57] {
        p.note_an(n, 0.8);
        spiele(&mut p, 0.5, &mut x);
        p.note_aus(n);
    }
    for n in [45u8, 49, 52, 57] { p.note_an(n, 0.8); }
    spiele(&mut p, 1.5, &mut x);
    p.alle_aus();
    spiele(&mut p, 1.5, &mut x);
    let spitze = x.iter().fold(0f32, |m, (l, r)| m.max(l.abs()).max(r.abs()));
    let mut f = std::fs::File::create(&a[2]).expect("out not writable");
    let daten = (x.len() * 4) as u32;
    f.write_all(b"RIFF").unwrap();
    f.write_all(&(36 + daten).to_le_bytes()).unwrap();
    f.write_all(b"WAVEfmt ").unwrap();
    f.write_all(&16u32.to_le_bytes()).unwrap();
    f.write_all(&1u16.to_le_bytes()).unwrap(); // PCM
    f.write_all(&2u16.to_le_bytes()).unwrap(); // stereo (Slice 2b)
    f.write_all(&48_000u32.to_le_bytes()).unwrap();
    f.write_all(&192_000u32.to_le_bytes()).unwrap();
    f.write_all(&4u16.to_le_bytes()).unwrap();
    f.write_all(&16u16.to_le_bytes()).unwrap();
    f.write_all(b"data").unwrap();
    f.write_all(&daten.to_le_bytes()).unwrap();
    for (l, r) in &x {
        f.write_all(&((l.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).unwrap();
        f.write_all(&((r.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).unwrap();
    }
    println!("{}: {:.2} s, peak {:.3}", a[2], x.len() as f32 / 48_000.0, spitze);
}
