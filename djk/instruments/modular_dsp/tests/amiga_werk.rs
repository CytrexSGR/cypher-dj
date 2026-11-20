//! The factory bank of `amiga`: the Rust generator and `build_amiga_samples.py` write the same bytes, and the data are 8-bit.
use baukasten_dsp::proben::{amiga_werk, bytes, schreibe_amiga_werk, AMIGA_DATEIEN};

#[test]
fn skript_und_rust_schreiben_gleiche_bytes() {
    let tmp = std::env::temp_dir().join(format!("bk-amiga-werk-{}", std::process::id()));
    let (r, p) = (tmp.join("rust"), tmp.join("py"));
    std::fs::create_dir_all(&r).unwrap();
    schreibe_amiga_werk(&r);
    let skript = concat!(env!("CARGO_MANIFEST_DIR"), "/bau_amiga_proben.py");
    let aus = std::process::Command::new("python3").arg(skript).arg(&p).output().expect("python3 is needed for this test");
    assert!(aus.status.success(), "script failed: {}", String::from_utf8_lossy(&aus.stderr));
    for n in AMIGA_DATEIEN {
        assert_eq!(std::fs::read(r.join(n)).unwrap(), std::fs::read(p.join(n)).unwrap(), "{n}");
    }
    std::fs::remove_dir_all(&tmp).ok();
}

#[test]
fn werte_sind_acht_bit_und_ohne_nennenswerten_gleichanteil() {
    for (n, d) in AMIGA_DATEIEN.iter().zip(amiga_werk()) {
        assert_eq!(d.len() % 2, 0);
        assert!(d.chunks(2).all(|f| f[0] == f[1]), "{n}: l == r");
        assert!(d.iter().all(|v| { let s = v * 128.0; s == s.round() && s.abs() <= 127.0 }), "{n}: not 8-bit values");
        let mittel = d.chunks(2).map(|f| f[0] as f64).sum::<f64>() / (d.len() / 2) as f64;
        assert!(mittel.abs() < 0.05, "{n}: mean {mittel}");
        assert!(bytes(&d).len() == d.len() * 4);
    }
    assert_eq!(amiga_werk()[0].len(), 64);
    assert_eq!(amiga_werk()[3].len(), 2 * 4096);
}
