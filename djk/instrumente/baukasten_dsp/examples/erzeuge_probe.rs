//! Writes the generated sample material to a directory: `cargo run --release -p baukasten_dsp --example erzeuge_probe -- DIR`
//! creates `DIR/orchester-schlag.f32`, `DIR/orchester-schlag-schichten.f32` and `DIR/feder-ir.f32` (raw 48 kHz stereo
//! float32, see `baukasten_dsp::proben`; the second is the hit of `sampler-fairlight` with its three detune layers as
//! separate slices, S22; the third is the synthetic spring-tank impulse response of `fx-federhall`, S21). Use the directory as the
//! sample root of `render --wurzel DIR` or copy the file to `~/.config/cypherdj/baukasten/samples/` (S10, C1).
use baukasten_dsp::proben::{bytes, feder_ir, orchester_schlag, orchester_schlag_schichten};

fn main() {
    let Some(dir) = std::env::args().nth(1) else {
        eprintln!("usage: erzeuge_probe DIR");
        std::process::exit(2);
    };
    std::fs::create_dir_all(&dir).expect("directory not creatable");
    let pfad = std::path::Path::new(&dir).join("orchester-schlag.f32");
    let d = orchester_schlag(48_000.0);
    std::fs::write(&pfad, bytes(&d)).expect("file not writable");
    println!("{}: {} frames, {} bytes", pfad.display(), d.len() / 2, d.len() * 4);
    let pfad = std::path::Path::new(&dir).join("orchester-schlag-schichten.f32");
    let d = orchester_schlag_schichten(48_000.0);
    std::fs::write(&pfad, bytes(&d)).expect("file not writable");
    println!("{}: {} frames, {} bytes", pfad.display(), d.len() / 2, d.len() * 4);
    let pfad = std::path::Path::new(&dir).join("feder-ir.f32");
    let d = feder_ir(48_000.0);
    std::fs::write(&pfad, bytes(&d)).expect("file not writable");
    println!("{}: {} frames, {} bytes", pfad.display(), d.len() / 2, d.len() * 4);
}
