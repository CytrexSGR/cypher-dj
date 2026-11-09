//! Hörprobe in Stufen: `cargo run --release -p baukasten_dsp --example render_stufen -- GRAPH.json AUS.wav N W1,W2,… [ton]`
//! Regler N steht je Stufe 2 s auf Wi, in jeder Stufe vier Anschläge (0,35 s gehalten, alle 0,5 s). Danach alle_aus und 2 s
//! Nachlauf: zeigt, ob eine singende Schleife verstummt. Druckt je Stufe rms und Pegel am Ende des Haltens und vor dem
//! nächsten Anschlag (je letzte 50 ms).
use baukasten_dsp::uebersetze;
use std::io::Write;

fn db(x: f32) -> f32 { 20.0 * x.max(1e-9).log10() }

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() < 5 {
        eprintln!("usage: render_stufen GRAPH.json OUT.wav N V1,V2,... [note]");
        std::process::exit(2);
    }
    let json = std::fs::read_to_string(&a[1]).expect("graph not readable");
    let mut p = uebersetze(&json, 48_000.0).unwrap_or_else(|e| { eprintln!("graph invalid: {e}"); std::process::exit(2) });
    let nr: usize = a[3].parse().expect("N");
    let stufen: Vec<f32> = a[4].split(',').map(|s| s.parse().expect("value")).collect();
    let ton: u8 = a.get(5).map_or(45, |s| s.parse().expect("note"));
    let mut x: Vec<(f32, f32)> = Vec::new();
    let spiele = |p: &mut baukasten_dsp::Programm, s: f32, x: &mut Vec<(f32, f32)>| {
        for _ in 0..(s * 48_000.0) as usize { x.push(p.sample_stereo()) }
    };
    for &w in &stufen {
        p.setze_regler(nr, w);
        let start = x.len();
        let mut rest = Vec::new();
        let mut ende = Vec::new();
        for _ in 0..4 {
            p.note_an(ton, 0.8);
            spiele(&mut p, 0.35, &mut x);
            let s = &x[x.len() - 2400..];
            ende.push((s.iter().map(|(l, _)| l * l).sum::<f32>() / s.len() as f32).sqrt());
            p.note_aus(ton);
            spiele(&mut p, 0.15, &mut x);
            let s = &x[x.len() - 2400..];
            rest.push((s.iter().map(|(l, _)| l * l).sum::<f32>() / s.len() as f32).sqrt());
        }
        let st = &x[start..];
        let rms = (st.iter().map(|(l, _)| l * l).sum::<f32>() / st.len() as f32).sqrt();
        let spitze = st.iter().fold(0f32, |m, (l, _)| m.max(l.abs()));
        println!("Regler {nr} = {w:.2}: rms {:.1} dB, Spitze {:.1} dB, Ende Halten {:.1} dB, vor nächstem Anschlag {:.1} dB",
                 db(rms), db(spitze), db(ende.iter().sum::<f32>() / 4.0), db(rest.iter().sum::<f32>() / 4.0));
    }
    p.alle_aus();
    let start = x.len();
    spiele(&mut p, 2.0, &mut x);
    let s = &x[x.len() - 9600..];
    println!("nach alle_aus: Pegel 1,8-2,0 s danach {:.1} dB (Stufenstart {start})",
             db((s.iter().map(|(l, _)| l * l).sum::<f32>() / s.len() as f32).sqrt()));
    let daten = (x.len() * 4) as u32;
    let mut f = std::fs::File::create(&a[2]).expect("out not writable");
    f.write_all(b"RIFF").unwrap();
    f.write_all(&(36 + daten).to_le_bytes()).unwrap();
    f.write_all(b"WAVEfmt ").unwrap();
    f.write_all(&16u32.to_le_bytes()).unwrap();
    f.write_all(&1u16.to_le_bytes()).unwrap();
    f.write_all(&2u16.to_le_bytes()).unwrap();
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
}
