//! `synth-greif2` ("Greif 2", demos/synth-greif2.json, generator `build_greif.py --greif2`): acceptance by measurement.
//! The same graph and knobs as Greif (tests/greif.rs), other tables: the position scan must move the centroid by a factor of 3 or more.
//! Print lines start with `MESS`. The preset harness `greif_presets_messung` (ignored) renders every factory preset for 8 s and
//! prints peak, RMS and spectral centroid; with GREIF_AUS=<dir> the renders are also written there as 16 bit WAV files.
//! Cost: `kosten_greif` (ignored) against `synth-poly` in the same run.
use baukasten_dsp::{uebersetze, Programm, REGLER};
use realfft::RealFftPlanner;

const SR: f32 = 48_000.0;
const GRAPH: &str = include_str!("../demos/synth-greif2.json");
const POLY: &str = include_str!("../demos/synth-poly.json");
const KNOEPFE: usize = 63;

fn lade(j: &str) -> Programm { uebersetze(j, SR).unwrap_or_else(|e| panic!("{e}")) }

fn programm(knoepfe: &[(usize, f32)]) -> Programm {
    let mut p = lade(GRAPH);
    for (n, w) in knoepfe { p.setze_regler(*n, *w); }
    p
}

/// run `f` over `items` on all cores, results in order
fn parallel<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let n = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(items.len().max(1));
    let teile: Vec<&[T]> = items.chunks(items.len().div_ceil(n).max(1)).collect();
    std::thread::scope(|s| {
        let h: Vec<_> = teile.iter().map(|t| s.spawn(|| t.iter().map(&f).collect::<Vec<R>>())).collect();
        h.into_iter().flat_map(|h| h.join().unwrap()).collect()
    })
}

// ---------------------------------------------------------------- measurement helpers

fn db(v: f64) -> f64 { 10.0 * v.max(1e-30).log10() }
fn mono(x: &[(f32, f32)]) -> Vec<f64> { x.iter().map(|(l, r)| (*l as f64 + *r as f64) * 0.5).collect() }
fn spitze(x: &[(f32, f32)]) -> f32 { x.iter().fold(0.0f32, |m, (l, r)| m.max(l.abs()).max(r.abs())) }
fn endlich(x: &[(f32, f32)]) -> bool { x.iter().all(|(l, r)| l.is_finite() && r.is_finite()) }
fn leistung(x: &[f64], nfft: usize) -> Vec<f64> {
    let n = x.len() as f64;
    let mut v: Vec<f64> = x.iter().enumerate().map(|(i, v)| v * (0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / n).cos())).collect();
    v.resize(nfft, 0.0);
    let mut plan = RealFftPlanner::<f64>::new();
    let fft = plan.plan_fft_forward(nfft);
    let mut s = fft.make_output_vec();
    fft.process(&mut v, &mut s).unwrap();
    s.iter().map(|c| c.norm_sqr()).collect()
}
fn bin(f: f64, nfft: usize) -> usize { (f * nfft as f64 / SR as f64).round() as usize }
fn band(p: &[f64], nfft: usize, von: f64, bis: f64) -> f64 { p[bin(von, nfft)..=bin(bis, nfft).min(p.len() - 1)].iter().sum() }
/// spectral centroid (Hz) of the mono signal from 50 Hz to 20 kHz
fn schwerpunkt(x: &[(f32, f32)]) -> f64 {
    let m = mono(x);
    let nfft = m.len().next_power_of_two();
    let p = leistung(&m, nfft);
    let (mut sf, mut s) = (0.0, 0.0);
    for k in bin(50.0, nfft)..bin(20_000.0, nfft) { sf += p[k] * k as f64; s += p[k]; }
    sf / s.max(1e-30) * SR as f64 / nfft as f64
}
fn rms_db(x: &[(f32, f32)]) -> f64 {
    db(x.iter().map(|(l, r)| (*l as f64).powi(2) + (*r as f64).powi(2)).sum::<f64>() / (2 * x.len()) as f64)
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

fn spiele(p: &mut Programm, sekunden: f32) -> Vec<(f32, f32)> {
    (0..(sekunden * SR) as usize).map(|_| p.sample_stereo()).collect()
}

/// Three chords of four notes (0.35 s each, released between), then a tail: the third chord lands on the voices of the first (the oldest free ones) with other pitches,
/// so the glide has something to glide from. Knobs as set by the caller.
fn probe(knoepfe: &[(usize, f32)]) -> Vec<(f32, f32)> {
    let mut p = programm(knoepfe);
    p.setze_takt(0.0, 2.0 / SR as f64);
    let mut x = Vec::new();
    for akkord in [[48u8, 52, 55, 59], [53, 57, 60, 64], [50, 54, 57, 61]] {
        for n in akkord { p.note_an(n, 0.8); }
        x.extend(spiele(&mut p, 0.35));
        for n in akkord { p.note_aus(n); }
        x.extend(spiele(&mut p, 0.1));
    }
    x.extend(spiele(&mut p, 0.3));
    assert_eq!(p.rettungen, 0, "the engine had to rescue a value");
    x
}

/// one held note, `sekunden` long, then 0.3 s of release
fn halten(knoepfe: &[(usize, f32)], note: u8, sekunden: f32) -> Vec<(f32, f32)> {
    let mut p = programm(knoepfe);
    p.setze_takt(0.0, 2.0 / SR as f64);
    p.note_an(note, 0.8);
    let mut x = spiele(&mut p, sekunden);
    p.note_aus(note);
    x.extend(spiele(&mut p, 0.3));
    assert_eq!(p.rettungen, 0);
    x
}

fn unterschied(a: &[(f32, f32)], b: &[(f32, f32)]) -> f32 {
    a.iter().zip(b).fold(0.0f32, |m, (x, y)| m.max((x.0 - y.0).abs()).max((x.1 - y.1).abs()))
}

fn knoten(j: &serde_json::Value) -> &Vec<serde_json::Value> { j["knoten"].as_array().unwrap() }

// ---------------------------------------------------------------- knob numbers (build_greif.py is the source)

const A_POS: usize = 1;
const B_POS: usize = 7;
const C_POS: usize = 13;
const A_LEVEL: usize = 6;
const B_LEVEL: usize = 12;
const C_LEVEL: usize = 17;
const SUB_OKT: usize = 25;
const SUB_LEVEL: usize = 26;
const NOISE_LEVEL: usize = 27;
const F1_CUT: usize = 29;
const F1_RESO: usize = 30;
const DRIVE: usize = 33;
const F2_CUT: usize = 34;
const F2_RESO: usize = 35;
const SHIFT_HZ: usize = 57;
const SHIFT_MIX: usize = 58;
const CHORUS_MIX: usize = 59;
const DELAY_ZEIT: usize = 60;
const DELAY_MIX: usize = 61;
const GLIDE: usize = 62;

// ---------------------------------------------------------------- tests

#[test]
fn laedt_mit_8_stimmen_63_knoepfen_ohne_latenz() {
    let p = lade(GRAPH);
    assert_eq!(p.latenz(), 0, "engine latency");
    assert_eq!(p.stimmen, 8);
    let mut nr: Vec<usize> = p.regler_namen.iter().map(|(n, _)| *n).collect();
    nr.sort();
    assert_eq!(nr, (1..=KNOEPFE).collect::<Vec<_>>());
    assert!(KNOEPFE <= REGLER);
    let j: serde_json::Value = serde_json::from_str(GRAPH).unwrap();
    let art = |a: &str| knoten(&j).iter().filter(|k| k["art"] == a).count();
    for verboten in ["limiter", "labor", "faltung", "remix"] { assert_eq!(art(verboten), 0, "no {verboten} block (latency)"); }
    assert!(knoten(&j).iter().all(|k| k["art"] != "falter" || k["ueber"].as_f64().unwrap_or(0.0) == 0.0));
    // three wavetable oscillators with their own tables of 16..32 frames, copies 5 / 3 / 1, phase modulation wired
    let wt: Vec<&serde_json::Value> = knoten(&j).iter().filter(|k| k["art"] == "wavetable").collect();
    assert_eq!(wt.len(), 3);
    let kopien: Vec<u64> = ["wt_a", "wt_b", "wt_c"].iter()
        .map(|id| wt.iter().find(|k| k["id"] == *id).unwrap_or_else(|| panic!("{id}"))["kopien"].as_u64().unwrap()).collect();
    assert_eq!(kopien, vec![5, 3, 1]);
    for k in &wt {
        let frames = k["spektren"].as_array().expect("spektren").len();
        assert!((16..=32).contains(&frames), "{}: {frames} frames", k["id"]);
    }
    assert!(art("chaos") >= 1 && art("schieber") >= 1 && art("delay") == 1 && art("chorus") >= 1);
    let kanten = j["kanten"].as_array().unwrap();
    for pm in ["wt_a.pm", "wt_b.pm"] { assert!(kanten.iter().any(|e| e["nach"] == pm), "{pm} is not wired"); }
    // the delay mix and time come straight from a regler node
    for port in ["delay.mix", "delay.zeit"] {
        let von: Vec<&str> = kanten.iter().filter(|e| e["nach"] == port).map(|e| e["von"].as_str().unwrap()).collect();
        assert_eq!(von.len(), 1, "{port}");
        let id = von[0].split('.').next().unwrap();
        assert!(knoten(&j).iter().any(|k| k["id"] == id && k["art"] == "regler"), "{port} is fed by {von:?}, not by a regler");
    }
    println!("MESS greif: {} nodes, {} edges, latency {}", knoten(&j).len(), kanten.len(), p.latenz());
}

#[test]
fn grundstellung_acht_gehaltene_noten_zehn_sekunden() {
    let mut p = programm(&[]);
    p.setze_takt(0.0, 2.0 / SR as f64);
    for n in 0..8u8 { p.note_an(36 + 5 * n, 0.8); }
    let x = spiele(&mut p, 10.0);
    assert_eq!(p.rettungen, 0);
    assert!(endlich(&x), "NaN or inf");
    let sp = spitze(&x);
    let (sl, sr) = x.iter().fold((0.0f64, 0.0f64), |a, (l, r)| (a.0 + *l as f64, a.1 + *r as f64));
    let dc = (sl / x.len() as f64).abs().max((sr / x.len() as f64).abs());
    println!("MESS default, 8 held notes, 10 s: peak {sp:.3}, DC {:.1} dBFS, rms {:.1} dB", 20.0 * dc.max(1e-12).log10(), rms_db(&x));
    assert!(sp <= 0.9, "peak {sp}");
    assert!(dc <= 10f64.powf(-50.0 / 20.0), "DC {dc:e}");
    assert!(sp > 0.05, "the patch is silent");
}

#[test]
fn jeder_knopf_bewegt_den_klang() {
    let basis = probe(&[]);
    assert!(endlich(&basis));
    let faelle: Vec<usize> = (1..=KNOEPFE).collect();
    let tot: Vec<String> = parallel(&faelle, |&nr| {
        let (a, b) = (probe(&[(nr, 0.0)]), probe(&[(nr, 1.0)]));
        assert!(endlich(&a) && endlich(&b), "knob {nr} gives NaN");
        let (da, db_) = (unterschied(&a, &basis), unterschied(&b, &basis));
        println!("MESS knob {nr:2}: max difference to the default {da:.5} (at 0), {db_:.5} (at 1)");
        if da.max(db_) <= 1e-5 { Some(format!("knob {nr} does nothing")) } else { None }
    }).into_iter().flatten().collect();
    assert!(tot.is_empty(), "{tot:?}");
}

#[test]
fn jeder_knopf_an_beiden_enden_endlich_und_beschraenkt() {
    let faelle: Vec<usize> = (1..=KNOEPFE).collect();
    let fehler: Vec<String> = parallel(&faelle, |&nr| {
        let mut f = Vec::new();
        for w in [0.0f32, 1.0] {
            let x = probe(&[(nr, w)]);
            if !endlich(&x) { f.push(format!("knob {nr} = {w}: not finite")); }
            let sp = spitze(&x);
            if sp > 4.0 { f.push(format!("knob {nr} = {w}: peak {sp:.2}")); }
        }
        f
    }).into_iter().flatten().collect();
    assert!(fehler.is_empty(), "{fehler:?}");
}

/// the three oscillators alone (the others, sub and noise off), position 0 against 1: the spectrum moves
#[test]
fn positionsfahrt_jedes_oszillators_veraendert_das_spektrum() {
    for (pos, level, name) in [(A_POS, A_LEVEL, "A"), (B_POS, B_LEVEL, "B"), (C_POS, C_LEVEL, "C")] {
        let mut basis = vec![(A_LEVEL, 0.0f32), (B_LEVEL, 0.0), (C_LEVEL, 0.0), (SUB_LEVEL, 0.0), (NOISE_LEVEL, 0.0), (F1_CUT, 1.0), (F2_CUT, 1.0)];
        basis.retain(|(n, _)| *n != level);
        basis.push((level, 0.8));
        let mut k0 = basis.clone(); k0.push((pos, 0.0));
        let mut k1 = basis.clone(); k1.push((pos, 1.0));
        let (a, b) = (halten(&k0, 48, 1.0), halten(&k1, 48, 1.0));
        let (ca, cb) = (schwerpunkt(&a), schwerpunkt(&b));
        println!("MESS position scan of {name}: centroid {ca:.0} Hz at 0, {cb:.0} Hz at 1");
        assert!(spitze(&a) > 0.01 && spitze(&b) > 0.01, "{name}: silent");
        let m = halten(&{ let mut k = basis.clone(); k.push((pos, 0.5)); k }, 48, 1.0);
        println!("MESS position scan of {name}: centroid {:.0} Hz at 0.5", schwerpunkt(&m));
        assert!(ca.max(cb) / ca.min(cb) >= 3.0, "{name}: centroid {ca:.0} against {cb:.0} Hz, Greif 2 wants a factor of 3");
    }
}

/// C3 with the sub one octave down: the sub at 65.4 Hz is the only thing there. Level 0 removes it.
#[test]
fn sub_level_null_nimmt_die_unteroktave_weg() {
    let nur_sub = |lv: f32| {
        let k = [(A_LEVEL, 0.7f32), (B_LEVEL, 0.3), (C_LEVEL, 0.0), (NOISE_LEVEL, 0.0), (SHIFT_MIX, 0.0), (SUB_OKT, 0.0), (SUB_LEVEL, lv)];
        let x = halten(&k, 48, 1.5);
        let m = mono(&x[(0.3 * SR) as usize..(1.3 * SR) as usize]);
        let nfft = 1 << 17;
        let p = leistung(&m, nfft);
        db(band(&p, nfft, 62.0, 69.0))
    };
    let (mit, ohne) = (nur_sub(1.0), nur_sub(0.0));
    println!("MESS sub: band 62..69 Hz {mit:.1} dB with the sub, {ohne:.1} dB without");
    assert!(mit - ohne >= 30.0, "the sub is only {:.1} dB above the rest", mit - ohne);
}

/// the sub passes no filter, no drive and no effect: with everything else off, those knobs change nothing (bit for bit)
#[test]
fn sub_geht_an_filtern_drive_und_effekten_vorbei() {
    let still = [(A_LEVEL, 0.0f32), (B_LEVEL, 0.0), (C_LEVEL, 0.0), (NOISE_LEVEL, 0.0), (SUB_LEVEL, 0.8)];
    let basis = halten(&still, 40, 1.0);
    assert!(spitze(&basis) > 0.01, "the sub is silent");
    let wirkt = |extra: &[(usize, f32)]| {
        let mut k = still.to_vec();
        k.extend_from_slice(extra);
        unterschied(&halten(&k, 40, 1.0), &basis)
    };
    for (name, extra) in [
        ("filter 1 cutoff low", vec![(F1_CUT, 0.0f32)]),
        ("filter 1 resonance", vec![(F1_RESO, 1.0)]),
        ("drive", vec![(DRIVE, 1.0)]),
        ("filter 2 cutoff low", vec![(F2_CUT, 0.0)]),
        ("filter 2 resonance", vec![(F2_RESO, 1.0)]),
        ("shift", vec![(SHIFT_MIX, 1.0), (SHIFT_HZ, 1.0)]),
        ("chorus", vec![(CHORUS_MIX, 1.0)]),
        ("delay", vec![(DELAY_MIX, 1.0), (DELAY_ZEIT, 0.1)]),
    ] {
        let d = wirkt(&extra);
        println!("MESS sub bypass: {name}: max difference {d:e}");
        assert!(d <= 1e-6, "{name} changes the sub by {d:e}");
    }
}

/// glide: the third chord lands on the voices of the first; the glide knob changes how the chord arrives
#[test]
fn glide_gleitet_auf_der_stimme() {
    let (a, b) = (probe(&[(GLIDE, 0.0)]), probe(&[(GLIDE, 1.0)]));
    let d = unterschied(&a, &b);
    println!("MESS glide: max difference {d:.4}");
    assert!(d > 1e-3, "the glide knob does nothing");
}

#[test]
fn presets_sind_vollstaendig() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../ui/presets/factory/modular");
    let mut n = 0;
    for e in std::fs::read_dir(&dir).unwrap() {
        let pfad = e.unwrap().path();
        let name = pfad.file_name().unwrap().to_string_lossy().to_string();
        if !(name.starts_with("synth-greif2-") && name.ends_with(".preset.json")) { continue; }
        let j: serde_json::Value = serde_json::from_slice(&std::fs::read(&pfad).unwrap()).unwrap();
        assert_eq!(j["graph"], "synth-greif2", "{name}");
        assert!(j["tags"].as_array().unwrap().iter().any(|t| t == "synth-greif2"), "{name}: tag");
        let text = j["beschreibung"]["text"].as_str().unwrap();
        assert!((10..=160).contains(&text.chars().count()), "{name}: description of {} characters", text.chars().count());
        assert_eq!(j["werte"].as_object().unwrap().len(), KNOEPFE, "{name}: all knobs");
        n += 1;
    }
    assert_eq!(n, 12, "twelve factory presets");
}

// ---------------------------------------------------------------- harness and cost (ignored)

fn presets() -> Vec<(String, String, Vec<(usize, f32)>)> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../ui/presets/factory/modular");
    let mut aus = Vec::new();
    for e in std::fs::read_dir(&dir).unwrap() {
        let pfad = e.unwrap().path();
        let name = pfad.file_name().unwrap().to_string_lossy().to_string();
        if !(name.starts_with("synth-greif2-") && name.ends_with(".preset.json")) { continue; }
        let j: serde_json::Value = serde_json::from_slice(&std::fs::read(&pfad).unwrap()).unwrap();
        let mut k: Vec<(usize, f32)> = j["werte"].as_object().unwrap().iter()
            .map(|(s, v)| (s.strip_prefix("knob").unwrap().parse().unwrap(), v.as_f64().unwrap() as f32)).collect();
        k.sort_by_key(|e| e.0);
        let art = j["beschreibung"]["art"].as_str().unwrap().to_string();
        aus.push((name.trim_end_matches(".preset.json").to_string(), art, k));
    }
    aus.sort_by(|a, b| a.0.cmp(&b.0));
    aus
}

/// Every factory preset, 8 s: C2 for a bass, a C4 chord for the rest. Prints peak, RMS and spectral centroid.
///   cargo test --release -p baukasten_dsp --test greif greif_presets_messung -- --ignored --nocapture
#[test]
#[ignore]
fn greif2_presets_messung() {
    let aus = std::env::var("GREIF_AUS").ok().map(std::path::PathBuf::from);
    if let Some(d) = &aus { std::fs::create_dir_all(d).unwrap(); }
    let fall: Vec<(String, String, Vec<(usize, f32)>)> = std::iter::once(("(default)".into(), "lead".into(), vec![])).chain(presets()).collect();
    let zeilen = parallel(&fall, |(name, art, k)| {
        let mut p = programm(k);
        p.setze_takt(0.0, 2.0 / SR as f64);
        let noten: &[u8] = if art == "bass" { &[36] } else { &[60, 64, 67] };
        for n in noten { p.note_an(*n, 0.8); }
        let x = spiele(&mut p, 8.0);
        assert!(endlich(&x), "{name}");
        if let Some(d) = &aus { schreibe_wav(&d.join(format!("{name}.wav")), &x); }
        // RMS over the active 50 ms frames (above -60 dBFS RMS), centroid over the first 4 s (a pluck is silent after that)
        let aktiv: Vec<(f32, f32)> = x.chunks(2400).filter(|c| rms_db(c) > -60.0).flatten().cloned().collect();
        format!("| {name} | {} | {:.3} | {:.1} | {:.0} |", if art == "bass" { "C2" } else { "C4 chord" }, spitze(&x), rms_db(&aktiv), schwerpunkt(&x[..4 * SR as usize]))
    });
    println!("| preset | played | peak | RMS dB | centroid Hz |\n|---|---|---|---|---|");
    for z in zeilen { println!("MESS {z}"); }
}

/// Cost: 256-sample blocks, 8 held notes, p50 / p99 of Greif and synth-poly in the same run, one after the other and three
/// rounds, so a load wobble shows. The gate: p50 <= 2400 us and p99 <= 3700 us. Run on a quiet machine:
///   cargo test --release -p baukasten_dsp --test greif kosten_greif -- --ignored --nocapture
#[test]
#[ignore]
fn kosten_greif2() {
    use std::time::Instant;
    let mut beste = [(f64::MAX, f64::MAX); 2];
    for runde in 0..3 {
        for (i, (label, g)) in [("synth-greif", GRAPH), ("synth-poly", POLY)].into_iter().enumerate() {
            let mut p = uebersetze(g, SR).unwrap();
            p.setze_takt(0.0, 2.0 / SR as f64);
            for n in 0..8u8 { p.note_an(36 + 5 * n, 0.8); }
            let mut senke = 0.0f32;
            for _ in 0..200 { for _ in 0..256 { senke += p.sample(); } }
            let mut zeiten: Vec<f64> = Vec::with_capacity(4000);
            for _ in 0..4000 {
                let t = Instant::now();
                for _ in 0..256 { senke += p.sample(); }
                zeiten.push(t.elapsed().as_secs_f64() * 1e6);
            }
            zeiten.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let q = |q: f64| zeiten[(((q * zeiten.len() as f64).ceil() as usize).max(1) - 1).min(zeiten.len() - 1)];
            println!("KOSTEN round {runde} {label} (8 voices): p50 {:.0} us, p99 {:.0} us, p99.9 {:.0} us, max {:.0} us (sink {senke:.1})", q(0.5), q(0.99), q(0.999), zeiten[zeiten.len() - 1]);
            beste[i] = (beste[i].0.min(q(0.5)), beste[i].1.min(q(0.99)));
        }
    }
    println!("KOSTEN best of three: synth-greif p50 {:.0} us p99 {:.0} us; synth-poly p50 {:.0} us p99 {:.0} us", beste[0].0, beste[0].1, beste[1].0, beste[1].1);
    assert!(beste[0].0 <= 2400.0, "p50 {:.0} us over the gate of 2400 us", beste[0].0);
    assert!(beste[0].1 <= 3700.0, "p99 {:.0} us over the gate of 3700 us", beste[0].1);
}

/// diagnosis: B at position 1 with parts of the patch taken out one by one
#[test]
#[ignore]
fn diagnose_b_position() {
    let basis = vec![(A_LEVEL, 0.0f32), (C_LEVEL, 0.0), (SUB_LEVEL, 0.0), (NOISE_LEVEL, 0.0), (F1_CUT, 1.0), (F2_CUT, 1.0), (B_LEVEL, 0.8), (B_POS, 1.0)];
    let faelle: Vec<(&str, Vec<(usize, f32)>)> = vec![
        ("basis", vec![]),
        ("warp off", vec![(8, 0.0)]),
        ("pm off", vec![(19, 0.0)]),
        ("mods off", vec![(47, 0.5), (49, 0.0), (56, 0.0)]),
        ("f env 0", vec![(31, 0.5)]),
        ("drive 0", vec![(33, 0.0)]),
        ("unison off", vec![(21, 0.0), (23, 0.0)]),
        ("fx off", vec![(58, 0.0), (59, 0.0), (61, 0.0)]),
        ("all off", vec![(8, 0.0), (19, 0.0), (47, 0.5), (49, 0.0), (56, 0.0), (31, 0.5), (33, 0.0), (21, 0.0), (58, 0.0), (59, 0.0), (61, 0.0)]),
    ];
    for (name, extra) in faelle {
        let mut k = basis.clone(); k.extend(extra);
        let x = halten(&k, 48, 1.0);
        println!("MESS B pos 1, {name}: centroid {:.0} Hz, rms {:.1} dB", schwerpunkt(&x), rms_db(&x));
    }
}
