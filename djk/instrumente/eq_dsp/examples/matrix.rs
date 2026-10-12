// Max. Abweichung (dB) je Art × f0, Q ∈ {0.5..4} realistisch, G ∈ {±6, ±12, ±18}, fs = 44,1 kHz, Soll > −24 dB.
use eq_dsp::entwurf::*;
fn main() {
    let fs: f64 = std::env::args().nth(1).map(|s| s.parse().unwrap()).unwrap_or(44100.0);
    let f0s = [1000.0, 5000.0, 10000.0, 14000.0, 16000.0, 18000.0, 20000.0];
    for (name, m) in [("bilinear", 0), ("vicanek", 1), ("passend", 2)] {
        println!("{name}: f0 = {:?}", f0s);
        for art in [Art::Glocke, Art::LowShelf, Art::HighShelf, Art::Tiefpass, Art::Hochpass, Art::Kerbe, Art::Bandpass] {
            let mut zeile = format!("  {:10}", format!("{art:?}"));
            for f0 in f0s {
                let mut mx = 0.0f64;
                for g in [-18.0, -12.0, -6.0, 6.0, 12.0, 18.0] { for q in [0.5, 0.707, 1.0, 2.0, 4.0] {
                    let an = prototyp(art, g, q);
                    let bq = match m { 0 => bilinear(&an, f0, fs), 1 => vicanek(&an, f0, fs), _ => passend(&an, f0, fs) };
                    for i in 0..600 { let f = 20.0 * (20000.0f64 / 20.0).powf(i as f64 / 599.0);
                        let soll = an.betrag_db(f / f0); if soll < -24.0 { continue; }
                        mx = mx.max((bq.betrag_db(f, fs) - soll).abs()); }
                }}
                zeile += &format!(" {mx:6.2}");
            }
            println!("{zeile}");
        }
    }
}
