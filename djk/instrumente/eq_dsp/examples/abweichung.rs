// Misst die maximale Abweichung |digital − analog| in dB über 20 Hz .. min(20 kHz, 0,49 fs).
use eq_dsp::entwurf::*;
const Q_RASTER: [f64; 5] = [0.3, 0.707, 2.0, 6.0, 12.0];
fn main() {
    let arten = [Art::Glocke, Art::LowShelf, Art::HighShelf, Art::Tiefpass, Art::Hochpass, Art::Kerbe, Art::Bandpass];
    for (name, matched_an) in [("bilinear", false), ("matched", true)] {
        for art in arten {
            let mut schlimmst = (0.0f64, 0.0, 0.0, 0.0, 0.0, 0.0);
            for fs in [44100.0, 48000.0, 96000.0] {
                for f0 in [30.0, 100.0, 500.0, 1000.0, 3000.0, 6000.0, 10000.0, 14000.0, 16000.0, 18000.0, 20000.0] {
                    for g in [-18.0, -6.0, 6.0, 18.0] {
                        for q in Q_RASTER {
                            let an = prototyp(art, g, q);
                            let f0e = f64::min(f0, F0_MAX_REL * fs);
                            let bq = if matched_an { vicanek(&an, f0e, fs) } else { bilinear(&an, f0e, fs) };
                            let fmax = f64::min(20000.0, 0.49 * fs);
                            for i in 0..400 {
                                let f = 20.0 * (fmax / 20.0f64).powf(i as f64 / 399.0);
                                let soll = an.betrag_db(f / f0e);
                                let ist = bq.betrag_db(f, fs);
                                // Kerben/Flanken unter -40 dB zählen nicht: dort ist der absolute Fehler bedeutungslos
                                if soll < -24.0 { continue; }
                                let d = (ist - soll).abs();
                                if d > schlimmst.0 { schlimmst = (d, fs, f0e, g, q, f); }
                            }
                        }
                    }
                }
            }
            let (d, fs, f0, g, q, f) = schlimmst;
            println!("{name:9} {art:?}: max {d:6.2} dB  (fs {fs}, f0 {f0:.0}, G {g}, Q {q}, bei {f:.0} Hz)");
        }
    }
}
