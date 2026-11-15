//! `bass-banddrive` ("Band Drive Bass", demos/bass-banddrive.json, generator build_banddrive.py): acceptance by measurement.
//! The test phrase is E1 eighth notes at 124 BPM for 4 bars, then E1 G1 A1 B1 legato (one beat each, overlapping), then one
//! held E1 of 4 beats and a one second tail. Measurements print `MESS ...` lines; with BANDDRIVE_AUS=<dir> the renders are
//! written there as 16 bit WAV files and the numbers as messung.json (never into the repo).
//! Cost: `kosten_banddrive` (ignored, run under the real-time lock, see kosten_messung.rs).
use baukasten_dsp::{uebersetze, Programm, REGLER};
use realfft::RealFftPlanner;
use std::collections::BTreeMap;
use std::sync::Mutex;

const SR: f32 = 48_000.0;
const GRAPH: &str = include_str!("../demos/bass-banddrive.json");
const BASSMUSIK: &str = include_str!("../demos/bassmusik.json");
const MSEG_NEURO: &str = include_str!("../demos/mseg-neuro-bass.json");
const E1: u8 = 28;
const BPM: f64 = 124.0;

fn lade(j: &str) -> Programm { uebersetze(j, SR).unwrap_or_else(|e| panic!("{e}")) }

// ---------------------------------------------------------------- phrase

pub struct Phrase {
    pub x: Vec<(f32, f32)>,
    /// the held E1: first sample and length
    pub halten: (usize, usize),
}

fn phrase(p: &mut Programm) -> Phrase {
    let beat = 60.0 / BPM * SR as f64;
    let achtel = beat / 2.0;
    // (sample, note, on)
    let mut ev: Vec<(usize, u8, bool)> = Vec::new();
    for i in 0..32 {
        let t = i as f64 * achtel;
        ev.push((t as usize, E1, true));
        ev.push(((t + 0.8 * achtel) as usize, E1, false));
    }
    let mut t = 32.0 * achtel;
    let reihe = [28u8, 31, 33, 35];
    for (i, n) in reihe.iter().enumerate() {
        ev.push((t as usize, *n, true));
        if i > 0 { ev.push(((t + 0.02 * SR as f64) as usize, reihe[i - 1], false)); }
        t += beat;
    }
    ev.push(((t - 0.05 * beat) as usize, 35, false));
    t += 0.5 * beat;
    let halten_start = t as usize;
    ev.push((halten_start, E1, true));
    let halten_len = (4.0 * beat) as usize;
    ev.push((halten_start + halten_len, E1, false));
    let ende = halten_start + halten_len + SR as usize;
    ev.sort_by_key(|e| (e.0, !e.2));
    let mut x = Vec::with_capacity(ende);
    let mut k = 0;
    for i in 0..ende {
        while k < ev.len() && ev[k].0 <= i {
            if ev[k].2 { p.note_an(ev[k].1, 0.8) } else { p.note_aus(ev[k].1) }
            k += 1;
        }
        x.push(p.sample_stereo());
    }
    Phrase { x, halten: (halten_start, halten_len) }
}

fn spiele(json: &str, knoepfe: &[(usize, f32)]) -> Phrase {
    let mut p = lade(json);
    for (n, w) in knoepfe { p.setze_regler(*n, *w); }
    let r = phrase(&mut p);
    assert_eq!(p.rettungen, 0, "the engine had to rescue a value");
    r
}

/// the held note alone (4 beats, then 0.3 s release), for graphs with other knobs defaults: no knob is set
fn halten_allein(json: &str, knoepfe: &[(usize, f32)]) -> Vec<(f32, f32)> {
    let mut p = lade(json);
    for (n, w) in knoepfe { p.setze_regler(*n, *w); }
    p.note_an(E1, 0.8);
    let n = (4.0 * 60.0 / BPM * SR as f64) as usize;
    let mut x: Vec<(f32, f32)> = (0..n).map(|_| p.sample_stereo()).collect();
    p.note_aus(E1);
    x.extend((0..(0.3 * SR) as usize).map(|_| p.sample_stereo()));
    assert_eq!(p.rettungen, 0);
    x
}

// ---------------------------------------------------------------- measurement helpers

fn db(v: f64) -> f64 { 10.0 * v.max(1e-30).log10() }
fn spitze_db(x: &[(f32, f32)]) -> f64 { 20.0 * x.iter().fold(0.0f32, |m, (l, r)| m.max(l.abs()).max(r.abs())).max(1e-9).log10() as f64 }
fn hann(x: &[f64]) -> Vec<f64> {
    let n = x.len() as f64;
    x.iter().enumerate().map(|(i, v)| v * (0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / n).cos())).collect()
}
/// power spectrum (|X|^2) of the Hann windowed signal zero padded to `nfft`
fn leistung(x: &[f64], nfft: usize) -> Vec<f64> {
    let mut v = hann(x);
    v.resize(nfft, 0.0);
    let mut plan = RealFftPlanner::<f64>::new();
    let fft = plan.plan_fft_forward(nfft);
    let mut s = fft.make_output_vec();
    fft.process(&mut v, &mut s).unwrap();
    s.iter().map(|c| c.norm_sqr()).collect()
}
fn mono(x: &[(f32, f32)]) -> Vec<f64> { x.iter().map(|(l, r)| (*l as f64 + *r as f64) * 0.5).collect() }
fn links(x: &[(f32, f32)]) -> Vec<f64> { x.iter().map(|(l, _)| *l as f64).collect() }
fn bin(f: f64, nfft: usize) -> usize { (f * nfft as f64 / SR as f64).round() as usize }
fn band(p: &[f64], nfft: usize, von: f64, bis: f64) -> f64 { p[bin(von, nfft)..=bin(bis, nfft).min(p.len() - 1)].iter().sum() }

/// level (dB, relative) of the band above `ab` Hz of a whole signal
fn band_ueber_db(x: &[(f32, f32)], ab: f64) -> f64 {
    let m = mono(x);
    let nfft = m.len().next_power_of_two();
    let p = leistung(&m, nfft);
    db(band(&p, nfft, ab, 20_000.0) / nfft as f64)
}
fn schwerpunkt_ueber(x: &[(f32, f32)], ab: f64) -> f64 {
    let m = mono(x);
    let nfft = m.len().next_power_of_two();
    let p = leistung(&m, nfft);
    let (mut sf, mut s) = (0.0, 0.0);
    for k in bin(ab, nfft)..bin(20_000.0, nfft) { sf += p[k] * k as f64; s += p[k]; }
    sf / s.max(1e-30) * SR as f64 / nfft as f64
}

/// standard deviation of the spectral centroid above 120 Hz over 50 ms frames (2400 samples, Hann, 4096 point FFT)
fn schwerpunkt_streuung(x: &[(f32, f32)]) -> (f64, f64) {
    let m = mono(x);
    let c: Vec<f64> = m.chunks_exact(2400).map(|f| {
        let p = leistung(f, 4096);
        let (mut sf, mut s) = (0.0, 0.0);
        for k in bin(120.0, 4096)..bin(20_000.0, 4096) { sf += p[k] * k as f64; s += p[k]; }
        sf / s.max(1e-30) * SR as f64 / 4096.0
    }).collect();
    let mw = c.iter().sum::<f64>() / c.len() as f64;
    ((c.iter().map(|v| (v - mw).powi(2)).sum::<f64>() / c.len() as f64).sqrt(), mw)
}

/// partials within 40 dB of the strongest: local maxima (+-4 bins) of the power spectrum between 120 Hz and 15 kHz
/// of a 1.36 s Hann window that starts 0.25 s into the signal
fn teiltoene(x: &[(f32, f32)]) -> usize {
    let m = mono(x);
    let von = (0.25 * SR) as usize;
    let nfft = 1 << 18;
    let p = leistung(&m[von..von + (1 << 16)], nfft);
    let max = p.iter().cloned().fold(0.0, f64::max);
    let schwelle = max * 1e-4;
    let (a, b) = (bin(120.0, nfft), bin(15_000.0, nfft));
    (a..b).filter(|&k| p[k] >= schwelle && (1..=4).all(|d| p[k] > p[k - d] && p[k] >= p[k + d])).count()
}

fn grundton(x: &[(f32, f32)]) -> f64 {
    let m = mono(x);
    let von = (0.3 * SR) as usize;
    let nfft = 1 << 19;
    let p = leistung(&m[von..von + (1 << 16)], nfft);
    let (a, b) = (bin(20.0, nfft), bin(100.0, nfft));
    let k = (a..b).max_by(|&i, &j| p[i].partial_cmp(&p[j]).unwrap()).unwrap();
    let (l, c, r) = (p[k - 1].ln(), p[k].ln(), p[k + 1].ln());
    let d = 0.5 * (l - r) / (l - 2.0 * c + r);
    (k as f64 + d) * SR as f64 / nfft as f64
}

/// (L - R) against (L + R) below `bis` Hz (20 Hz up), dB; and the level of the mono band in dB
fn tiefband(x: &[(f32, f32)], bis: f64) -> (f64, f64) {
    let von = (0.3 * SR) as usize;
    let n = 1 << 16;
    let s: Vec<f64> = x[von..von + n].iter().map(|(l, r)| *l as f64 + *r as f64).collect();
    let d: Vec<f64> = x[von..von + n].iter().map(|(l, r)| *l as f64 - *r as f64).collect();
    let (ps, pd) = (leistung(&s, 1 << 17), leistung(&d, 1 << 17));
    (db(band(&pd, 1 << 17, 20.0, bis) / band(&ps, 1 << 17, 20.0, bis)), db(band(&ps, 1 << 17, 20.0, bis)))
}

fn schreibe_wav(pfad: &std::path::Path, x: &[(f32, f32)]) {
    let n = x.len() as u32 * 4;
    let mut b = Vec::new();
    b.extend(b"RIFF"); b.extend((36 + n).to_le_bytes()); b.extend(b"WAVEfmt ");
    b.extend(16u32.to_le_bytes()); b.extend(1u16.to_le_bytes()); b.extend(2u16.to_le_bytes());
    b.extend(48_000u32.to_le_bytes()); b.extend((48_000u32 * 4).to_le_bytes()); b.extend(4u16.to_le_bytes()); b.extend(16u16.to_le_bytes());
    b.extend(b"data"); b.extend(n.to_le_bytes());
    for (l, r) in x { for v in [l, r] { b.extend(((v.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()); } }
    std::fs::write(pfad, b).unwrap();
}

static MESSUNG: Mutex<()> = Mutex::new(());
/// merges `{wert}` under `schluessel` into messung.json of BANDDRIVE_AUS and writes the WAV, when the variable is set
fn ablegen(schluessel: &str, wert: serde_json::Value, wav: Option<(&str, &[(f32, f32)])>) {
    let Ok(dir) = std::env::var("BANDDRIVE_AUS") else { return };
    let _g = MESSUNG.lock().unwrap_or_else(|e| e.into_inner());
    let dir = std::path::PathBuf::from(dir);
    std::fs::create_dir_all(&dir).unwrap();
    let pfad = dir.join("messung.json");
    let mut m: BTreeMap<String, serde_json::Value> = std::fs::read(&pfad).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    m.insert(schluessel.to_string(), wert);
    std::fs::write(&pfad, serde_json::to_vec_pretty(&m).unwrap()).unwrap();
    if let Some((name, x)) = wav { schreibe_wav(&dir.join(name), x); }
}

/// the factory presets of this graph: (file name without suffix, knob values)
fn presets() -> Vec<(String, Vec<(usize, f32)>)> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../ui/presets/factory/modular");
    let mut aus = Vec::new();
    for e in std::fs::read_dir(&dir).unwrap() {
        let pfad = e.unwrap().path();
        let name = pfad.file_name().unwrap().to_string_lossy().to_string();
        if !(name.starts_with("bass-banddrive-") && name.ends_with(".preset.json")) { continue; }
        let j: serde_json::Value = serde_json::from_slice(&std::fs::read(&pfad).unwrap()).unwrap();
        assert_eq!(j["graph"], "bass-banddrive", "{name}");
        let mut k: Vec<(usize, f32)> = j["werte"].as_object().unwrap().iter()
            .map(|(s, v)| (s.strip_prefix("knob").unwrap().parse().unwrap(), v.as_f64().unwrap() as f32)).collect();
        k.sort_by_key(|e| e.0);
        aus.push((name.trim_end_matches(".preset.json").to_string(), k));
    }
    aus.sort_by(|a, b| a.0.cmp(&b.0));
    aus
}

// ---------------------------------------------------------------- tests

#[test]
fn laedt_mit_24_knoepfen_ohne_latenz() {
    let p = lade(GRAPH);
    assert_eq!(p.latenz(), 0, "engine latency");
    assert_eq!(p.stimmen, 1, "mono");
    let mut nr: Vec<usize> = p.regler_namen.iter().map(|(n, _)| *n).collect();
    nr.sort();
    assert_eq!(nr, (1..=24).collect::<Vec<_>>());
    assert!(p.regler_namen.len() >= 16 && p.regler_namen.len() <= 24);
    let j: serde_json::Value = serde_json::from_str(GRAPH).unwrap();
    assert!(j["knoten"].as_array().unwrap().iter().all(|k| k["art"] != "limiter"), "no limiter block (latency)");
    assert!(j["knoten"].as_array().unwrap().iter().any(|k| k["art"] == "kreuz"));
    assert!(j["knoten"].as_array().unwrap().iter().all(|k| k["art"] != "falter" || k["ueber"] == 0), "falter without oversampling");
    println!("MESS latency: engine {} samples", p.latenz());
    ablegen("1_latenz", serde_json::json!({"engine_samples": p.latenz()}), None);
}

#[test]
fn pegel_gleichanteil_und_endlichkeit_bei_grundstellung_und_presets() {
    let mut faelle: Vec<(String, Vec<(usize, f32)>)> = vec![("defaults".into(), vec![])];
    faelle.extend(presets());
    assert_eq!(faelle.len(), 7, "defaults and six presets");
    let mut m = serde_json::Map::new();
    for (name, k) in &faelle {
        let r = spiele(GRAPH, k);
        let sp = spitze_db(&r.x);
        let mittel = r.x.iter().map(|(l, r)| (*l as f64 + *r as f64) * 0.5).sum::<f64>() / r.x.len() as f64;
        let schlecht = r.x.iter().filter(|(l, r)| !l.is_finite() || !r.is_finite()).count();
        let denormal = r.x.iter().filter(|(l, r)| l.is_subnormal() || r.is_subnormal()).count();
        println!("MESS level {name}: peak {sp:.2} dBFS, mean {mittel:.2e}, non-finite {schlecht}, subnormal {denormal}");
        ablegen(&format!("2_pegel_{name}"), serde_json::json!({"peak_dbfs": sp, "mean": mittel, "nonfinite": schlecht, "subnormal": denormal}),
            Some((&format!("{name}.wav"), &r.x)));
        m.insert(name.clone(), sp.into());
        assert!(sp <= -1.0 && sp > -12.0, "{name}: peak {sp:.2} dBFS");
        assert!(mittel.abs() < 1e-4, "{name}: DC {mittel:e}");
        assert_eq!(schlecht, 0, "{name}");
        assert_eq!(denormal, 0, "{name}");
    }
}

#[test]
fn tiefes_ende_ist_mono_und_bleibt_bei_jeder_verzerrung() {
    let mut pegel = Vec::new();
    for d in [0.0f32, 0.5, 1.0] {
        let x = halten_allein(GRAPH, &[(16, d), (19, d)]);
        let (mono_db, level) = tiefband(&x[(0.3 * SR) as usize..], 120.0);
        println!("MESS low band (20..120 Hz) both drives {d}: L-R against L+R {mono_db:.1} dB, level {level:.2} dB");
        assert!(mono_db <= -60.0, "drives {d}: L-R is only {mono_db:.1} dB below L+R");
        pegel.push(level);
    }
    for (nr, name) in [(16usize, "mid"), (19, "high")] {
        let mut l = Vec::new();
        for d in [0.0f32, 0.25, 0.5, 0.75, 1.0] {
            let x = halten_allein(GRAPH, &[(nr, d)]);
            l.push(tiefband(&x[(0.3 * SR) as usize..], 120.0).1);
        }
        let streu = l.iter().cloned().fold(f64::MIN, f64::max) - l.iter().cloned().fold(f64::MAX, f64::min);
        println!("MESS low band level over {name} drive 0..1: {l:.2?} dB, spread {streu:.2} dB");
        ablegen(&format!("3_tief_{name}"), serde_json::json!({"pegel_db": l, "spreizung_db": streu}), None);
        assert!(streu <= 1.0, "{name} drive moves the low band by {streu:.2} dB");
    }
}

#[test]
fn grundton_des_gehaltenen_e1_ist_41_2_hz() {
    let mut faelle: Vec<(String, Vec<(usize, f32)>)> = vec![("defaults".into(), vec![])];
    faelle.extend(presets());
    for (name, k) in faelle {
        let x = halten_allein(GRAPH, &k);
        let f = grundton(&x);
        println!("MESS fundamental {name}: {f:.3} Hz (E1 = 41.203 Hz)");
        ablegen(&format!("4_grundton_{name}"), serde_json::json!({"hz": f}), None);
        assert!((f - 41.20).abs() <= 0.3, "{name}: {f:.3} Hz");
    }
}

#[test]
fn bewegung_ueberragt_bassmusik_und_mseg_neuro_bass() {
    let (a, b, c) = (halten_allein(GRAPH, &[]), halten_allein(BASSMUSIK, &[]), halten_allein(MSEG_NEURO, &[]));
    let n = (4.0 * 60.0 / BPM * SR as f64) as usize;
    let (sa, ma) = schwerpunkt_streuung(&a[..n]);
    let (sb, mb) = schwerpunkt_streuung(&b[..n]);
    let (sc, mc) = schwerpunkt_streuung(&c[..n]);
    let (ta, tb, tc) = (teiltoene(&a), teiltoene(&b), teiltoene(&c));
    println!("MESS movement, centroid std over 50 ms frames (above 120 Hz) and mean: bass-banddrive {sa:.1} Hz (mean {ma:.0}), bassmusik {sb:.1} Hz (mean {mb:.0}), mseg-neuro-bass {sc:.1} Hz (mean {mc:.0})");
    println!("MESS movement, std / mean: {:.3}, {:.3}, {:.3}", sa / ma, sb / mb, sc / mc);
    println!("MESS partials within 40 dB: bass-banddrive {ta}, bassmusik {tb}, mseg-neuro-bass {tc}");
    println!("MESS movement ratio: vs bassmusik {:.2}x, vs mseg-neuro-bass {:.2}x; partials {:.2}x, {:.2}x", sa / sb, sa / sc, ta as f64 / tb as f64, ta as f64 / tc as f64);
    ablegen("5_bewegung", serde_json::json!({
        "schwerpunkt_std_hz": {"bass-banddrive": sa, "bassmusik": sb, "mseg-neuro-bass": sc},
        "schwerpunkt_mittel_hz": {"bass-banddrive": ma, "bassmusik": mb, "mseg-neuro-bass": mc},
        "teiltoene_40db": {"bass-banddrive": ta, "bassmusik": tb, "mseg-neuro-bass": tc}}), None);
    assert!(sa >= 3.0 * sb && sa >= 3.0 * sc, "centroid movement {sa:.1} against {sb:.1} and {sc:.1} Hz");
    assert!(ta >= 2 * tb && ta >= 2 * tc, "partials {ta} against {tb} and {tc}");
}

#[test]
fn verzerrung_aendert_die_farbe_nicht_die_lautheit() {
    for (nr, name) in [(16usize, "mid"), (19, "high")] {
        let mut pegel = Vec::new();
        let mut hell = Vec::new();
        for d in [0.0f32, 0.25, 0.5, 0.75, 1.0] {
            let r = spiele(GRAPH, &[(nr, d)]);
            pegel.push(band_ueber_db(&r.x, 120.0));
            hell.push(schwerpunkt_ueber(&r.x, 120.0));
        }
        let streu = pegel.iter().cloned().fold(f64::MIN, f64::max) - pegel.iter().cloned().fold(f64::MAX, f64::min);
        println!("MESS drive compensation {name}: RMS above 120 Hz {pegel:.2?} dB (spread {streu:.2} dB), centroid {hell:.0?} Hz");
        ablegen(&format!("6_kompensation_{name}"), serde_json::json!({"rms_ueber_120_db": pegel, "spreizung_db": streu, "schwerpunkt_hz": hell}), None);
        assert!(streu <= 2.0, "{name}: loudness moves by {streu:.2} dB");
        assert!(hell[4] > hell[0], "{name}: centroid {:.0} -> {:.0} Hz", hell[0], hell[4]);
    }
}

/// Prints the data for DRIVE_COMP in build_banddrive.py: RMS above 120 Hz over the drive knob with the compensation switched
/// off in the file at hand. Run on request: cargo test --release -p baukasten_dsp --test bass_banddrive kalibriere -- --ignored --nocapture
#[test]
#[ignore]
fn kalibriere() {
    for (nr, name) in [(16usize, "mid"), (19, "hi")] {
        let ds = [0.0f32, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
        let v: Vec<f64> = ds.iter().map(|d| band_ueber_db(&spiele(GRAPH, &[(nr, *d)]).x, 120.0)).collect();
        println!("KALIB {name} {}", serde_json::to_string(&v.iter().map(|x| x - v[0]).collect::<Vec<_>>()).unwrap());
    }
}

/// Prints the band levels (dB of the spectrum sum: below 120 Hz, 120 to 1500 Hz, above 1500 Hz) and peak per setting.
#[test]
#[ignore]
fn sonde() {
    for (name, k) in [("default", vec![]), ("mid1", vec![(16, 1.0)]), ("hi1", vec![(19, 1.0)]), ("both1", vec![(16, 1.0), (19, 1.0)]), ("both0", vec![(16, 0.0), (19, 0.0)])] {
        let r = spiele(GRAPH, &k);
        let m = mono(&r.x);
        let nfft = m.len().next_power_of_two();
        let p = leistung(&m, nfft);
        let f = |a, b| db(band(&p, nfft, a, b) / nfft as f64);
        println!("SONDE {name}: peak {:.1} dBFS, <120 {:.1}, 120-1500 {:.1}, >1500 {:.1}, centroid {:.0} Hz", spitze_db(&r.x), f(20.0, 120.0), f(120.0, 1500.0), f(1500.0, 20000.0), schwerpunkt_ueber(&r.x, 120.0));
    }
}

/// Prints the centroid per 50 ms frame of the held note.
#[test]
#[ignore]
fn verlauf() {
    for (name, j) in [("banddrive", GRAPH), ("bassmusik", BASSMUSIK)] {
        let x = halten_allein(j, &[]);
        let c: Vec<i64> = mono(&x[..92880]).chunks_exact(2400).map(|f| {
            let p = leistung(f, 4096);
            let (mut sf, mut s) = (0.0, 0.0);
            for k in bin(120.0, 4096)..bin(20_000.0, 4096) { sf += p[k] * k as f64; s += p[k]; }
            (sf / s.max(1e-30) * SR as f64 / 4096.0) as i64
        }).collect();
        println!("VERLAUF {name}: {c:?}");
    }
}

#[test]
fn jeder_knopf_an_beiden_enden_bleibt_endlich_und_im_rahmen() {
    for nr in 1..=REGLER.min(24) {
        for w in [0.0f32, 1.0] {
            let r = spiele(GRAPH, &[(nr, w)]);
            let sp = spitze_db(&r.x);
            assert!(r.x.iter().all(|(l, r)| l.is_finite() && r.is_finite()), "knob {nr} = {w}");
            assert!(sp < if nr == 24 { 9.0 } else { 3.0 }, "knob {nr} = {w}: peak {sp:.1} dBFS");
            if sp > -1.0 { println!("MESS knob {nr} = {w}: peak {sp:.1} dBFS (above the ceiling, only the output knob and Air may do this)"); }
        }
    }
}

#[test]
fn jeder_knopf_wirkt() {
    let basis = spiele(GRAPH, &[]).x;
    for nr in 1..=24usize {
        let moeglich = [0.0f32, 1.0];
        let wirkt = moeglich.iter().any(|w| {
            let x = spiele(GRAPH, &[(nr, *w)]).x;
            x.iter().zip(&basis).any(|(a, b)| (a.0 - b.0).abs() > 1e-4 || (a.1 - b.1).abs() > 1e-4)
        });
        assert!(wirkt, "knob {nr} does nothing");
    }
}

/// Cost: 256-sample blocks, one voice, p50 / p99 / p99.9 in microseconds next to synth-neuro and wavetable-reese. No cost gate
/// is applied to an instrument graph (the cost tests are ignored and run under the real-time lock). Run on request:
///   . djk/config/realtime_lock.sh && flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" cargo test --release -p baukasten_dsp --test bass_banddrive kosten_banddrive -- --ignored --nocapture
#[test]
#[ignore]
fn kosten_banddrive() {
    use baukasten_dsp::Kosten;
    use std::time::Instant;
    let faelle: [(&str, &str); 3] = [
        ("bass-banddrive default", GRAPH),
        ("synth-neuro default", include_str!("../demos/synth-neuro.json")),
        ("wavetable-reese", include_str!("../demos/wavetable-reese.json")),
    ];
    for (label, g) in faelle {
        let mut p = uebersetze(g, SR).unwrap();
        p.setze_takt(0.0, 2.0 / SR as f64);
        for n in 0..p.stimmen { p.note_an(33 + 3 * n as u8, 0.8); }
        for _ in 0..200 { for _ in 0..256 { std::hint::black_box(p.sample_stereo()); } }
        let mut kosten = Kosten::default();
        for _ in 0..4000 {
            let t = Instant::now();
            for _ in 0..256 { std::hint::black_box(p.sample_stereo()); }
            kosten.buche(t.elapsed().as_secs_f64() * 1e6);
        }
        let periode = 256.0 / SR as f64 * 1e6;
        println!("KOSTEN {label} ({} voices): p50 {:.0} us ({:.1} % of {periode:.0} us), p99 {:.0} us, p99.9 {:.0} us, max {:.0} us",
                 p.stimmen, kosten.quantil_us(0.5), kosten.quantil_us(0.5) / periode * 100.0, kosten.quantil_us(0.99), kosten.quantil_us(0.999), kosten.max_us);
    }
}
