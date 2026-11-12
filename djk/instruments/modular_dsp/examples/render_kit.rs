//! Drum kit probe without the studio: `cargo run --release -p baukasten_dsp --example render_kit -- GRAPH.json OUT.wav
//! --hits "36@0,38@0.5:0.8,42@0.75" [--dauer 3] [--off 0.125] [N=VALUE ...]`
//! Each hit is `NOTE@SECONDS[:VELOCITY]` (velocity default 0.9, like the Strudel erzeuger); the note is released `--off` seconds
//! later (default 0.125 s, one 16th at 120 BPM). Renders `--dauer` seconds (default: last hit + 3 s) at 48 kHz, stereo,
//! 32-bit float WAV (no clipping, so peaks above 1 can be measured). Knobs `N=VALUE` (N 1..32, VALUE 0..1) are set before playing.
use baukasten_dsp::uebersetze;
use std::io::Write;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() < 3 {
        eprintln!("usage: render_kit GRAPH.json OUT.wav --hits \"NOTE@SEC[:VEL],...\" [--dauer S] [--off S] [N=VALUE ...]");
        std::process::exit(2);
    }
    let (mut hits, mut dauer, mut off, mut fest): (Vec<(f64, u8, f32)>, Option<f64>, f64, Vec<(usize, f32)>) = (vec![], None, 0.125, vec![]);
    let mut it = a[3..].iter();
    while let Some(r) = it.next() {
        match r.as_str() {
            "--hits" => {
                for h in it.next().expect("--hits needs a list").split(',').filter(|s| !s.is_empty()) {
                    let (n, rest) = h.split_once('@').expect("hit NOTE@SEC");
                    let (t, v) = rest.split_once(':').map(|(t, v)| (t, v.parse().unwrap())).unwrap_or((rest, 0.9));
                    hits.push((t.parse().unwrap(), n.parse().unwrap(), v));
                }
            }
            "--dauer" => dauer = Some(it.next().unwrap().parse().unwrap()),
            "--off" => off = it.next().unwrap().parse().unwrap(),
            k => {
                let (n, w) = k.split_once('=').expect("knob N=VALUE");
                fest.push((n.parse().unwrap(), w.parse().unwrap()));
            }
        }
    }
    hits.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap());
    let json = std::fs::read_to_string(&a[1]).expect("graph not readable");
    let mut p = uebersetze(&json, 48_000.0).unwrap_or_else(|e| { eprintln!("graph invalid: {e}"); std::process::exit(2) });
    for (n, w) in &fest {
        p.setze_regler(*n, *w);
    }
    let ende = dauer.unwrap_or(hits.last().map_or(0.0, |h| h.0) + 3.0);
    let gesamt = (ende * 48_000.0) as usize;
    let mut ereignisse: Vec<(usize, bool, u8, f32)> = vec![];
    for (t, n, v) in &hits {
        ereignisse.push(((t * 48_000.0) as usize, true, *n, *v));
        ereignisse.push((((t + off) * 48_000.0) as usize, false, *n, 0.0));
    }
    ereignisse.sort_by_key(|e| (e.0, e.1));
    let mut x: Vec<(f32, f32)> = Vec::with_capacity(gesamt);
    let mut ei = 0;
    for i in 0..gesamt {
        while ei < ereignisse.len() && ereignisse[ei].0 <= i {
            let (_, an, n, v) = ereignisse[ei];
            if an { p.note_an(n, v) } else { p.note_aus(n) }
            ei += 1;
        }
        x.push(p.sample_stereo());
    }
    let spitze = x.iter().fold(0f32, |m, (l, r)| m.max(l.abs()).max(r.abs()));
    let mut f = std::fs::File::create(&a[2]).expect("out not writable");
    let daten = (x.len() * 8) as u32;
    f.write_all(b"RIFF").unwrap();
    f.write_all(&(36 + daten).to_le_bytes()).unwrap();
    f.write_all(b"WAVEfmt ").unwrap();
    f.write_all(&16u32.to_le_bytes()).unwrap();
    f.write_all(&3u16.to_le_bytes()).unwrap(); // IEEE float
    f.write_all(&2u16.to_le_bytes()).unwrap();
    f.write_all(&48_000u32.to_le_bytes()).unwrap();
    f.write_all(&(48_000u32 * 8).to_le_bytes()).unwrap();
    f.write_all(&8u16.to_le_bytes()).unwrap();
    f.write_all(&32u16.to_le_bytes()).unwrap();
    f.write_all(b"data").unwrap();
    f.write_all(&daten.to_le_bytes()).unwrap();
    for (l, r) in &x {
        f.write_all(&l.to_le_bytes()).unwrap();
        f.write_all(&r.to_le_bytes()).unwrap();
    }
    println!("{}: {:.2} s, peak {:.3}, rescues {}", a[2], x.len() as f32 / 48_000.0, spitze, p.rettungen);
}
