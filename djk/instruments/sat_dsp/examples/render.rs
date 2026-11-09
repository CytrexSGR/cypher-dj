//! Hörproben: interleaved Stereo-f32 von stdin durch Cypher Saett nach stdout.
//! Aufruf: render <fs> <drive_db> <ausgang_db> <mix> [naiv|naiv2x|adaa1x]   (Vergleichsketten ohne Mix; Vorgabe = Cypher Saett, ADAA1 2x)
use eq_dsp::ueberabtastung::{Hoch, Runter};
use saett_dsp::{Adaa1, Einstellung, Saett};
use std::io::{Read, Write};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let fs: f64 = a[1].parse().unwrap();
    let e = Einstellung { drive_db: a[2].parse().unwrap(), ausgang_db: a[3].parse().unwrap(), mix: a[4].parse().unwrap() };
    let art = a.get(5).map(String::as_str).unwrap_or("saett");
    let mut roh = Vec::new();
    std::io::stdin().read_to_end(&mut roh).unwrap();
    let x: Vec<f32> = roh.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let (mut l, mut r): (Vec<f32>, Vec<f32>) = (x.iter().step_by(2).copied().collect(), x.iter().skip(1).step_by(2).copied().collect());
    let g = 10f64.powf(e.drive_db / 20.0);
    let o = 10f64.powf(e.ausgang_db / 20.0);
    if art != "saett" {
        for kanal in [&mut l, &mut r] {
            let (mut ad, mut h, mut ru) = (Adaa1::default(), Hoch::neu(), Runter::neu());
            for v in kanal.iter_mut() {
                let x = *v as f64 * g;
                let y = match art {
                    "naiv" => x.tanh(),
                    "adaa1x" => ad.verarbeite(x),
                    "naiv2x" => { let [p, q] = h.verarbeite(x); ru.verarbeite([p.tanh(), q.tanh()]) }
                    _ => panic!("unbekannte Art {art}"),
                };
                *v = (y * o) as f32;
            }
        }
    } else {
        let mut s = Saett::neu(fs);
        s.setze(&e);
        s.leeren();
        s.block(&mut l, &mut r);
        let lat = s.latenz();          // Latenz abziehen, damit alle Proben zeitgleich liegen
        l.drain(..lat);
        r.drain(..lat);
        l.extend(std::iter::repeat(0.0).take(lat));
        r.extend(std::iter::repeat(0.0).take(lat));
    }
    let mut aus = Vec::with_capacity(x.len() * 4);
    for i in 0..l.len() {
        aus.extend_from_slice(&l[i].to_le_bytes());
        aus.extend_from_slice(&r[i].to_le_bytes());
    }
    std::io::stdout().write_all(&aus).unwrap();
}
