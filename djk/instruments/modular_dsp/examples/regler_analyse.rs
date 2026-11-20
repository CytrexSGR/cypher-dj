//! Knob analyser: `cargo run --release -p baukasten_dsp --example regler_analyse -- GRAPH.json [--noten C2|C3|C2legato|C3legato|glide|chord|kit]
//! [--knoepfe k1,k5,...] [--setze k46=0.6,k3=1] [--aus DIR] [--threads 1|2]`
//! `--pos 0.6,1` replaces the positions tried for continuous knobs. `--setze` holds knobs at a travel (0..1) in every render, the default one included: it analyses a knob behind another one.
//! Renders 2 bars at 128 BPM once at the defaults and per knob at several positions, measures every render against the default
//! (level, brightness, bands, flatness, width, movement, difference D) and prints a German table (class "wirkt nicht" / "leise" /
//! "deutlich" / "stark" and the direction per knob). `--aus DIR` writes DIR/<graph>.md and DIR/<graph>.json as well.
//! The phrase follows the category in kategorien.json (bass C2, lead C3, drums kit, else chord) unless `--noten` says otherwise.
use baukasten_dsp::regler_analyse::{analysiere, text_tabelle, Noten, Optionen};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() < 2 || a[1].starts_with("--") {
        eprintln!("usage: regler_analyse GRAPH.json [--noten C2|C3|C2legato|C3legato|glide|chord|kit] [--knoepfe k1,k5,..] [--setze k5=0.6,..] [--pos 0.6,..] [--aus DIR] [--threads N]");
        std::process::exit(2);
    }
    let pfad = &a[1];
    let name = std::path::Path::new(pfad).file_stem().and_then(|s| s.to_str()).unwrap_or("graph").to_string();
    let (mut noten, mut knoepfe, mut aus, mut threads): (Option<Noten>, Option<Vec<usize>>, Option<String>, usize) = (None, None, None, 1);
    let mut basis: Vec<(usize, f32)> = Vec::new();
    let mut stellungen: Option<Vec<f32>> = None;
    let mut it = a[2..].iter();
    while let Some(r) = it.next() {
        let mut wert = || it.next().cloned().unwrap_or_else(|| { eprintln!("{r} needs a value"); std::process::exit(2) });
        match r.as_str() {
            "--noten" => { let v = wert(); noten = Some(Noten::parse(&v).unwrap_or_else(|| { eprintln!("--noten: C2, C3, C2legato, C3legato, glide, chord or kit"); std::process::exit(2) })); }
            "--knoepfe" => {
                let v = wert();
                knoepfe = Some(v.split(',').filter(|s| !s.is_empty()).map(|s| s.trim().trim_start_matches('k').parse().unwrap_or_else(|_| { eprintln!("--knoepfe: numbers like k5,k7"); std::process::exit(2) })).collect());
            }
            "--setze" => {
                let v = wert();
                basis = v.split(',').filter(|s| !s.is_empty()).map(|s| {
                    let (k, w) = s.split_once('=').unwrap_or_else(|| { eprintln!("--setze: pairs like k46=0.6"); std::process::exit(2) });
                    (k.trim().trim_start_matches('k').parse().unwrap_or_else(|_| { eprintln!("--setze: knob number like k46"); std::process::exit(2) }),
                     w.trim().parse().unwrap_or_else(|_| { eprintln!("--setze: travel 0..1"); std::process::exit(2) }))
                }).collect();
            }
            "--pos" => { let v = wert(); stellungen = Some(v.split(',').filter(|s| !s.is_empty()).map(|s| s.trim().parse().unwrap_or_else(|_| { eprintln!("--pos: travels like 0.6"); std::process::exit(2) })).collect()); }
            "--aus" => aus = Some(wert()),
            "--threads" => threads = wert().parse().unwrap_or(1),
            x => { eprintln!("unknown argument {x}"); std::process::exit(2); }
        }
    }
    let json = std::fs::read_to_string(pfad).unwrap_or_else(|e| { eprintln!("{pfad}: {e}"); std::process::exit(2) });
    let noten = noten.unwrap_or_else(|| {
        let kat = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/kategorien.json")).ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .and_then(|v| v.get(&name)?.get("kategorie")?.as_str().map(|s| s.to_string()));
        kat.map(|k| Noten::fuer_kategorie(&k)).unwrap_or(Noten::Akkord)
    });
    let b = analysiere(&json, &name, &Optionen { noten, knoepfe, threads, basis, stellungen }).unwrap_or_else(|e| { eprintln!("{e}"); std::process::exit(1) });
    let text = text_tabelle(&b);
    print!("{text}");
    if let Some(d) = aus {
        std::fs::create_dir_all(&d).expect("--aus not creatable");
        std::fs::write(format!("{d}/{name}.md"), &text).unwrap();
        std::fs::write(format!("{d}/{name}.json"), serde_json::to_string_pretty(&b).unwrap()).unwrap();
    }
}
