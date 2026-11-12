//! Hörprobe ohne Studio: `cargo run --release -p baukasten_dsp --example render -- GRAPH.json AUS.wav [N=WEG …] [~N …]`
//! Spielt A2, C#3, E3, A3 nacheinander (je 0,5 s gehalten), dann den Akkord 1,5 s, dann 1,5 s Ausklang. 48 kHz, 16 bit, stereo.
//! `N=WEG` stellt Regler N (1..32) fest auf WEG (0..1), `~N` fährt Regler N über die ganze Dauer von 0 nach 1.
//! `--bpm N` (S9) sets the host tempo through `setze_takt` (default 120), so beat-synced `lfo`/`delay` blocks run at N BPM.
//! `--eingang IN.wav` (S7) speist den Graphen mit einer Datei (48 kHz, 16 bit oder float, mono oder stereo; mono geht auf
//! beide Seiten) über `setze_eingang`, spielt keine Noten und rendert Länge der Datei + 1,5 s Ausklang. Nur so rendern
//! Effekt-Graphen (`eingang`) etwas anderes als Stille.
//! `--wurzel DIR` (S10) is the sample root for `sampler` nodes (default: none, a sampler graph is then refused).
use baukasten_dsp::uebersetze_mit_wurzel;
use std::io::Write;

/// WAV lesen: 48 kHz, PCM 16 bit oder IEEE float 32, mono oder stereo. Mono geht auf beide Seiten.
fn lies_wav(pfad: &str) -> Vec<(f32, f32)> {
    let fehler = |m: &str| -> ! { eprintln!("--eingang {pfad}: {m}"); std::process::exit(2) };
    let d = std::fs::read(pfad).unwrap_or_else(|e| fehler(&e.to_string()));
    if d.len() < 12 || &d[0..4] != b"RIFF" || &d[8..12] != b"WAVE" {
        fehler("not a RIFF/WAVE file");
    }
    let (mut pos, mut fmt, mut daten) = (12usize, None, None);
    while pos + 8 <= d.len() {
        let groesse = u32::from_le_bytes(d[pos + 4..pos + 8].try_into().unwrap()) as usize;
        let ende = (pos + 8 + groesse).min(d.len());
        match &d[pos..pos + 4] {
            b"fmt " if ende - (pos + 8) >= 16 => {
                let f = &d[pos + 8..];
                fmt = Some((u16::from_le_bytes([f[0], f[1]]), u16::from_le_bytes([f[2], f[3]]), u32::from_le_bytes(f[4..8].try_into().unwrap()), u16::from_le_bytes([f[14], f[15]])));
            }
            b"data" => daten = Some(&d[pos + 8..ende]),
            _ => {}
        }
        pos = pos + 8 + groesse + (groesse & 1);
    }
    let ((tag, kanaele, rate, bits), daten) = match (fmt, daten) {
        (Some(f), Some(x)) => (f, x),
        _ => fehler("fmt or data chunk missing"),
    };
    if rate != 48_000 {
        fehler(&format!("sample rate {rate}, 48000 required"));
    }
    if !(1..=2).contains(&kanaele) {
        fehler(&format!("{kanaele} channels, 1 or 2 required"));
    }
    let wert: Vec<f32> = match (tag, bits) {
        (1, 16) => daten.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect(),
        (3, 32) => daten.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect(),
        _ => fehler(&format!("format tag {tag} with {bits} bit, PCM 16 or float 32 required")),
    };
    if kanaele == 1 { wert.iter().map(|&v| (v, v)).collect() } else { wert.chunks_exact(2).map(|c| (c[0], c[1])).collect() }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() < 3 {
        eprintln!("usage: render GRAPH.json OUT.wav [N=VALUE ...] [~N ...] [--eingang IN.wav] [--bpm N] [--wurzel DIR]");
        std::process::exit(2);
    }
    let mut fahren: Vec<usize> = Vec::new();
    let mut fest: Vec<(usize, f32)> = Vec::new();
    let mut eingang: Option<Vec<(f32, f32)>> = None;
    let mut bpm = 120.0f64;
    let mut wurzel: Option<std::path::PathBuf> = None;
    let mut args = a[3..].iter();
    while let Some(r) = args.next() {
        if r == "--eingang" {
            let pfad = args.next().unwrap_or_else(|| { eprintln!("--eingang needs a file"); std::process::exit(2) });
            eingang = Some(lies_wav(pfad));
            continue;
        }
        if r == "--wurzel" {
            wurzel = Some(args.next().unwrap_or_else(|| { eprintln!("--wurzel needs a directory"); std::process::exit(2) }).into());
            continue;
        }
        if r == "--bpm" {
            bpm = args.next().and_then(|v| v.parse().ok()).filter(|b: &f64| *b > 0.0 && b.is_finite())
                .unwrap_or_else(|| { eprintln!("--bpm needs a positive number"); std::process::exit(2) });
            continue;
        }
        let falsch = || -> ! { eprintln!("knob argument {r:?}: N=VALUE (N 1..32, VALUE 0..1) or ~N"); std::process::exit(2) };
        if let Some(n) = r.strip_prefix('~') {
            fahren.push(n.parse().unwrap_or_else(|_| falsch()));
        } else {
            let (n, w) = r.split_once('=').unwrap_or_else(|| falsch());
            fest.push((n.parse().unwrap_or_else(|_| falsch()), w.parse().unwrap_or_else(|_| falsch())));
        }
    }
    let json = std::fs::read_to_string(&a[1]).expect("graph not readable");
    let mut p = uebersetze_mit_wurzel(&json, 48_000.0, wurzel.as_deref()).unwrap_or_else(|e| { eprintln!("graph invalid: {e}"); std::process::exit(2) });
    let mut x: Vec<(f32, f32)> = Vec::new();
    p.setze_takt(0.0, bpm / 60.0 / 48_000.0);
    for (n, w) in &fest {
        p.setze_regler(*n, *w);
    }
    let gesamt: f32 = match &eingang {
        Some(e) => e.len() as f32 + 1.5 * 48_000.0,
        None => 5.0 * 48_000.0,
    };
    let spiele = |p: &mut baukasten_dsp::Programm, s: f32, x: &mut Vec<(f32, f32)>| {
        for _ in 0..(s * 48_000.0) as usize {
            for n in &fahren {
                p.setze_regler(*n, x.len() as f32 / gesamt);
            }
            x.push(p.sample_stereo())
        }
    };
    if let Some(e) = &eingang {
        for (i, (l, r)) in e.iter().chain(std::iter::repeat(&(0.0, 0.0)).take(72_000)).enumerate() {
            for n in &fahren {
                p.setze_regler(*n, i as f32 / gesamt);
            }
            p.setze_eingang(*l, *r);
            x.push(p.sample_stereo());
        }
    } else {
        for n in [45u8, 49, 52, 57] {
            p.note_an(n, 0.8);
            spiele(&mut p, 0.5, &mut x);
            p.note_aus(n);
        }
        for n in [45u8, 49, 52, 57] { p.note_an(n, 0.8); }
        spiele(&mut p, 1.5, &mut x);
        p.alle_aus();
        spiele(&mut p, 1.5, &mut x);
    }
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
