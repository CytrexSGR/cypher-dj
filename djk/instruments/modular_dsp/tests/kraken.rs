//! `synth-kraken` ("Kraken", demos/synth-kraken.json, generator build_kraken.py): acceptance by measurement.
//! Knobs are named by their id in the knob table of build_kraken.py (the `regler` node ids), never by number.
//! Print lines start with `MESS`. The preset harness `kraken_presets_messung` (ignored) renders every factory preset for 8 s and
//! prints peak, RMS and spectral centroid; with KRAKEN_AUS=<dir> the renders are also written there as 16 bit WAV files.
//! Cost: `kosten_kraken` (ignored) against `synth-poly` in the same run.
//! Version 2: a 16 x 16 patch field (`matrix` node `feld`) with default pins of set A, two `funktion` blocks, a real `lpg`.
use baukasten_dsp::{uebersetze, Programm, REGLER};
use realfft::RealFftPlanner;

const SR: f32 = 48_000.0;
const GRAPH: &str = include_str!("../demos/synth-kraken.json");
const POLY: &str = include_str!("../demos/synth-poly.json");
const KNOEPFE: usize = 60;

fn lade(j: &str) -> Programm { uebersetze(j, SR).unwrap_or_else(|e| panic!("{e}")) }

/// The state of the patch field of a test program
#[derive(Clone)]
enum Feld {
    /// the default pins of set A as the graph carries them
    Vorgabe,
    /// no pin at all (the normalled audio path only)
    Leer,
    /// exactly these pins `(set, row, column, value)`
    Stifte(Vec<(usize, usize, usize, f32)>),
    /// the default pins plus these
    Plus(Vec<(usize, usize, usize, f32)>),
}

fn programm_mit(knoepfe: &[(usize, f32)], feld: &Feld) -> Programm {
    let mut p = lade(GRAPH);
    assert!(p.hat_matrix(), "the graph has a patch field");
    match feld {
        Feld::Vorgabe => {}
        Feld::Leer => { assert!(p.stifte_grund(false, true)); }
        Feld::Stifte(l) | Feld::Plus(l) => {
            if matches!(feld, Feld::Stifte(_)) { assert!(p.stifte_grund(false, true)); }
            for (s, z, sp, w) in l { assert!(p.stift_sofort(*s, *z, *sp, *w)); }
        }
    }
    for (n, w) in knoepfe { p.setze_regler(*n, *w); }
    p
}

fn programm(knoepfe: &[(usize, f32)]) -> Programm { programm_mit(knoepfe, &Feld::Vorgabe) }

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
fn probe(knoepfe: &[(usize, f32)]) -> Vec<(f32, f32)> { probe_mit(knoepfe, &Feld::Vorgabe) }
fn probe_mit(knoepfe: &[(usize, f32)], feld: &Feld) -> Vec<(f32, f32)> {
    let mut p = programm_mit(knoepfe, feld);
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
fn halten(knoepfe: &[(usize, f32)], note: u8, sekunden: f32) -> Vec<(f32, f32)> { halten_mit(knoepfe, &Feld::Vorgabe, note, sekunden) }
fn halten_mit(knoepfe: &[(usize, f32)], feld: &Feld, note: u8, sekunden: f32) -> Vec<(f32, f32)> {
    let mut p = programm_mit(knoepfe, feld);
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


fn graph_json() -> serde_json::Value { serde_json::from_str(GRAPH).unwrap() }

/// the `regler` node of a knob id: (number, min, max, log)
fn regler(id: &str) -> (usize, f64, f64, bool) {
    let j = graph_json();
    let k = j["knoten"].as_array().unwrap().iter().find(|k| k["id"] == id && k["art"] == "regler").unwrap_or_else(|| panic!("no knob {id}"));
    (k["nr"].as_u64().unwrap() as usize, k["min"].as_f64().unwrap(), k["max"].as_f64().unwrap(), k["log"].as_u64().unwrap_or(0) == 1)
}
/// knob number of an id
fn k(id: &str) -> usize { regler(id).0 }
/// a value in knob units as the 0..1 position the engine takes
fn u(id: &str, wert: f64) -> (usize, f32) {
    let (nr, lo, hi, log) = regler(id);
    (nr, (if log { (wert / lo).ln() / (hi / lo).ln() } else { (wert - lo) / (hi - lo) }) as f32)
}
/// a selector option (0-based) of an n-option selector
fn wahl(id: &str, index: usize, von: usize) -> (usize, f32) { (k(id), index as f32 / (von - 1) as f32) }
fn n0(id: &str, wert: f32) -> (usize, f32) { (k(id), wert) }

/// East oscillators, ring, noise, VCO 3, the West share into the filter, feedback and both effects off: the West voice alone
fn nur_west() -> Vec<(usize, f32)> {
    ["v1_lv", "v2_lv", "ring_lv", "noise_lv", "v3_lv", "r_west", "fb_amt", "fx_dmix", "fx_hmix"].iter().map(|i| n0(i, 0.0)).collect()
}
/// the East voice alone
fn nur_east() -> Vec<(usize, f32)> { vec![n0("w_lv", 0.0)] }

fn pegel_db(x: &[(f32, f32)], von: f32, bis: f32) -> f64 { rms_db(&x[(von * SR) as usize..(bis * SR) as usize]) }

/// frequency (Hz) of the strongest bin of the mono signal between 20 Hz and 2 kHz
fn haupt_frequenz(x: &[(f32, f32)]) -> f64 {
    let m = mono(x);
    let nfft = 1 << 17;
    let p = leistung(&m, nfft);
    let (lo, hi) = (bin(20.0, nfft), bin(2000.0, nfft));
    let b = (lo..hi).max_by(|a, b| p[*a].partial_cmp(&p[*b]).unwrap()).unwrap();
    b as f64 * SR as f64 / nfft as f64
}
/// level (dB) of the mono signal in octave bands from 100 Hz to 12.8 kHz
fn oktaven(x: &[(f32, f32)]) -> Vec<f64> {
    let m = mono(x);
    let nfft = m.len().next_power_of_two();
    let p = leistung(&m, nfft);
    (0..7).map(|i| db(band(&p, nfft, 100.0 * 2f64.powi(i), 100.0 * 2f64.powi(i + 1)))).collect()
}

// ---------------------------------------------------------------- tests

#[test]
fn laedt_mit_4_stimmen_60_knoepfen_ohne_latenz() {
    let p = lade(GRAPH);
    assert_eq!(p.latenz(), 0, "engine latency");
    assert_eq!(p.stimmen, 4);
    let mut nr: Vec<usize> = p.regler_namen.iter().map(|(n, _)| *n).collect();
    nr.sort();
    assert_eq!(nr, (1..=KNOEPFE).collect::<Vec<_>>());
    assert!(KNOEPFE <= REGLER);
    let j = graph_json();
    let art = |a: &str| knoten(&j).iter().filter(|k| k["art"] == a).count();
    for verboten in ["limiter", "labor", "faltung", "remix"] { assert_eq!(art(verboten), 0, "no {verboten} block (latency)"); }
    assert!(knoten(&j).iter().all(|k| k["art"] != "falter" || k["ueber"].as_f64().unwrap_or(0.0) == 0.0));
    // East: three oscillators with three waves each, the four filters; West: sine, folder, gate low-pass; effects
    assert!(art("ladder") == 1 && art("sem") == 1 && art("ms20") == 1 && art("diode") == 1, "the four filters");
    assert!(art("falter") == 1 && art("sinus") == 2 && art("saege") == 2 && art("puls") == 2 && art("dreieck") == 2);
    assert!(art("drift") == 4 && art("chaos") == 1 && art("sh") == 1 && art("lfo") == 0 && art("delay") == 1 && art("hall") == 1);
    // version 2: two function generators, a real low-pass gate, one patch field
    assert!(art("funktion") == 2 && art("lpg") == 1 && art("matrix") == 1, "funktion x2, lpg, matrix");
    let kanten = j["kanten"].as_array().unwrap();
    // delayed edges: the feedback, the key tracker of the Key row, and every edge into the patch field
    let verz: Vec<&serde_json::Value> = kanten.iter().filter(|e| e.get("verzoegerung").is_some_and(|v| v == 1)).collect();
    let in_feld: Vec<&&serde_json::Value> = verz.iter().filter(|e| e["nach"].as_str().unwrap().starts_with("feld.e")).collect();
    assert_eq!(in_feld.len(), 16, "all sixteen rows are fed over a delayed edge");
    assert!(kanten.iter().filter(|e| e["nach"].as_str().unwrap().starts_with("feld.e")).all(|e| e.get("verzoegerung").is_some_and(|v| v == 1)), "every edge into feld.e* is delayed");
    assert_eq!(verz.len(), 16 + 1 + 2, "delayed edges: sixteen rows, the feedback, the key tracker");
    // the effect mixes and the echo time and feedback come straight from a regler node
    for port in ["delay.mix", "delay.zeit", "delay.fb", "hall.mix"] {
        let von: Vec<&str> = kanten.iter().filter(|e| e["nach"] == port).map(|e| e["von"].as_str().unwrap()).collect();
        assert_eq!(von.len(), 1, "{port}");
        let id = von[0].split('.').next().unwrap();
        assert!(knoten(&j).iter().any(|k| k["id"] == id && k["art"] == "regler"), "{port} is fed by {von:?}, not by a regler");
    }
    println!("MESS kraken: {} nodes, {} edges, latency {}", knoten(&j).len(), kanten.len(), p.latenz());
}

#[test]
fn grundstellung_vier_gehaltene_noten_zehn_sekunden() {
    let mut p = programm(&[]);
    p.setze_takt(0.0, 2.0 / SR as f64);
    for n in [36u8, 43, 48, 55] { p.note_an(n, 0.8); }
    let x = spiele(&mut p, 10.0);
    assert_eq!(p.rettungen, 0);
    assert!(endlich(&x), "NaN or inf");
    let sp = spitze(&x);
    let (sl, sr) = x.iter().fold((0.0f64, 0.0f64), |a, (l, r)| (a.0 + *l as f64, a.1 + *r as f64));
    let dc = (sl / x.len() as f64).abs().max((sr / x.len() as f64).abs());
    println!("MESS default, 4 held notes, 10 s: peak {sp:.3}, DC {:.1} dBFS, rms {:.1} dB", 20.0 * dc.max(1e-12).log10(), rms_db(&x));
    assert!(sp <= 0.9, "peak {sp}");
    assert!(dc <= 10f64.powf(-50.0 / 20.0), "DC {dc:e}");
    assert!(sp > 0.05, "the patch is silent");
}

/// Knobs that only act in one setting: the knob and the settings under which it is heard (Gate Reso: the low-pass mode of the gate)
fn umgebung(nr: usize) -> Vec<(usize, f32)> {
    if nr == k("g_reso") { vec![wahl("g_mode", 0, 3), n0("g_open", 0.0), n0("g_strike", 1.0)] }
    else if nr == k("f1_cycle") { vec![u("f1_rise", 0.05), u("f1_fall", 0.05)] }
    else { vec![] }
}
/// Cycle only shows where a function generator is audible: Func 1 -> Amp
fn feld_fuer(nr: usize) -> Feld {
    if nr == k("f1_cycle") { Feld::Stifte(vec![(0, zeile_nr("Func 1"), spalte_nr("Amp"), -0.8)]) } else { Feld::Vorgabe }
}
fn mit(basis: &[(usize, f32)], neu: (usize, f32)) -> Vec<(usize, f32)> {
    let mut v: Vec<(usize, f32)> = basis.iter().cloned().filter(|e| e.0 != neu.0).collect();
    v.push(neu);
    v
}

#[test]
fn jeder_knopf_bewegt_den_klang() {
    let basis_default = probe(&[]);
    assert!(endlich(&basis_default));
    let faelle: Vec<usize> = (1..=KNOEPFE).collect();
    let tot: Vec<String> = parallel(&faelle, |&nr| {
        let (umg, feld) = (umgebung(nr), feld_fuer(nr));
        let basis = if umg.is_empty() && matches!(feld, Feld::Vorgabe) { basis_default.clone() } else { probe_mit(&umg, &feld) };
        let (a, b) = (probe_mit(&mit(&umg, (nr, 0.0)), &feld), probe_mit(&mit(&umg, (nr, 1.0)), &feld));
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

/// the four filters sound different: same oscillators, cutoff and resonance, only the type changes; the octave-band levels of
/// every pair differ somewhere by at least 1.5 dB, and none is silent
#[test]
fn die_vier_filter_klingen_verschieden() {
    let mut basis = nur_east();
    basis.extend([u("f_cut", 700.0), u("f_reso", 0.6), n0("f_drive", 0.3), n0("v1_wave", 0.0), n0("v2_lv", 0.0), n0("ring_lv", 0.0), n0("noise_lv", 0.0), n0("fb_amt", 0.0), n0("fx_dmix", 0.0), n0("fx_hmix", 0.0)]);
    let spektren: Vec<Vec<f64>> = (0..4).map(|t| {
        let mut k = basis.clone();
        k.push(wahl("f_type", t, 4));
        let x = halten(&k, 36, 2.0);
        assert!(spitze(&x) > 0.01, "filter type {t} is silent");
        oktaven(&x[(0.5 * SR) as usize..(2.0 * SR) as usize])
    }).collect();
    for (a, b) in [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)] {
        let d = spektren[a].iter().zip(&spektren[b]).fold(0.0f64, |m, (x, y)| m.max((x - y).abs()));
        println!("MESS filter {a} against {b}: largest octave band difference {d:.1} dB");
        assert!(d >= 1.5, "filter {a} and {b} sound alike ({d:.1} dB)");
    }
}

/// Gate with Open 0 and Strike 1: the West voice rings out while the key is held. Alone on the West voice, held C3, the level is at
/// least 40 dB down between 1.8 and 2 s after the note, in every gate mode.
#[test]
fn gate_ohne_open_laesst_die_west_stimme_ausklingen() {
    for (modus, name) in [(0usize, "LP"), (1, "Both"), (2, "VCA")] {
        let mut k = nur_west();
        k.extend([n0("g_open", 0.0), n0("g_strike", 1.0), u("g_decay", 0.3), wahl("g_mode", modus, 3)]);
        let x = halten(&k, 48, 2.0);
        let (anfang, ende) = (pegel_db(&x, 0.0, 0.2), pegel_db(&x, 1.8, 2.0));
        println!("MESS gate {name}: {anfang:.1} dB in the first 0.2 s, {ende:.1} dB at 1.8..2.0 s");
        assert!(anfang > -40.0, "{name}: the strike is silent ({anfang:.1} dB)");
        assert!(ende <= anfang - 40.0, "{name}: {ende:.1} dB against {anfang:.1} dB at the start");
    }
}

/// with Open up the West voice drones while the key is held and ends with the key
#[test]
fn gate_open_laesst_die_west_stimme_stehen_und_die_taste_beendet_sie() {
    let mut k = nur_west();
    k.extend([n0("g_open", 1.0), n0("g_strike", 0.0), u("g_decay", 0.05), u("e2_r", 0.1)]);
    let mut p = programm(&k);
    p.setze_takt(0.0, 2.0 / SR as f64);
    p.note_an(48, 0.8);
    let x = spiele(&mut p, 3.0);
    p.note_aus(48);
    let y = spiele(&mut p, 1.0);
    let (frueh, spaet, nach) = (pegel_db(&x, 0.5, 0.7), pegel_db(&x, 2.8, 3.0), pegel_db(&y, 0.7, 1.0));
    println!("MESS gate open: {frueh:.1} dB at 0.5 s, {spaet:.1} dB at 2.8 s, {nach:.1} dB 0.7 s after the key");
    assert!(frueh > -40.0 && spaet > frueh - 3.0, "the drone does not hold");
    assert!(nach < spaet - 50.0, "the drone does not end with the key");
}

/// Feedback at 1 with Resonance at 1 stays finite and at most +6.8 dBFS (peak 2.2; v1 measured 1.94, v2 2.09 on the SEM) before Volume (Volume at 0 dB), on every filter
#[test]
fn rueckkopplung_voll_mit_voller_resonanz_bleibt_beschraenkt() {
    let faelle: Vec<usize> = (0..4).collect();
    let r = parallel(&faelle, |&t| {
        let k = [n0("fb_amt", 1.0), n0("f_reso", 1.0), u("vol", 0.0), wahl("f_type", t, 4)];
        let x = probe_mit(&k, &Feld::Leer);
        (t, endlich(&x), spitze(&x))
    });
    for (t, ok, sp) in r {
        println!("MESS feedback 1, resonance 1, filter {t}: peak {sp:.3} ({:.1} dBFS)", 20.0 * (sp.max(1e-9) as f64).log10());
        assert!(ok, "filter {t}: NaN or inf");
        assert!(sp <= 2.2, "filter {t}: peak {sp}");
    }
}

/// VCO 3 in Low range does not follow the key: its Pitch knob at 1 gives about 30 Hz for C3 and C4 alike; in Key range it follows
#[test]
fn vco3_low_folgt_der_taste_nicht() {
    let mut basis = vec![n0("v1_lv", 0.0), n0("v2_lv", 0.0), n0("ring_lv", 0.0), n0("noise_lv", 0.0), n0("w_lv", 0.0), n0("v3_lv", 1.0),
                         n0("f_cut", 1.0), n0("f_key", 0.0), n0("f_env", 0.5), n0("f_drive", 0.0), n0("f_reso", 0.0), n0("fb_amt", 0.0), n0("fx_dmix", 0.0), n0("fx_hmix", 0.0),
                         n0("drift", 0.0)];
    basis.push(n0("e1_s", 1.0));
    let frequenz = |note: u8, low: bool, pitch: f32| {
        let mut k = basis.clone();
        k.extend([wahl("v3_range", low as usize, 2), n0("v3_pitch", pitch)]);
        haupt_frequenz(&halten_mit(&k, &Feld::Leer, note, 2.0)[(0.3 * SR) as usize..(2.0 * SR) as usize])
    };
    let (lo3, lo4) = (frequenz(48, true, 1.0), frequenz(60, true, 1.0));
    let (k3, k4) = (frequenz(48, false, 0.5), frequenz(60, false, 0.5));
    println!("MESS vco3: low {lo3:.1} Hz (C3), {lo4:.1} Hz (C4); key {k3:.1} Hz (C3), {k4:.1} Hz (C4)");
    assert!((lo3 - lo4).abs() < 2.0 && (25.0..35.0).contains(&lo3), "low range: {lo3} / {lo4} Hz");
    assert!((k4 / k3 - 2.0).abs() < 0.05 && (k3 - 130.8).abs() < 3.0, "key range: {k3} / {k4} Hz");
}

/// glide: a later chord lands on the voices of the first; the glide knob changes how it arrives
#[test]
fn glide_gleitet_auf_der_stimme() {
    let (a, b) = (probe(&[n0("glide", 0.0)]), probe(&[n0("glide", 1.0)]));
    let d = unterschied(&a, &b);
    println!("MESS glide: max difference {d:.4}");
    assert!(d > 1e-3, "the glide knob does nothing");
}

// ---------------------------------------------------------------- patch field (version 2)

const ZEILEN: [&str; 16] = ["VCO 1", "VCO 2", "VCO 3", "Noise", "Ring", "West", "Filter", "Gate", "Env 1", "Env 2", "Func 1", "Func 2", "S&H", "Chaos", "Key", "Velocity"];
const SPALTEN: [&str; 16] = ["VCO 1 Pitch", "VCO 2 Pitch", "VCO 3 Pitch", "West Pitch", "PW", "Fold", "Symmetry", "Filter In", "Cutoff", "Resonance", "Gate In", "Gate CV", "Func 1 Tempo", "Func 2 Tempo", "Amp", "Out"];

fn feld_knoten() -> serde_json::Value {
    graph_json()["knoten"].as_array().unwrap().iter().find(|k| k["art"] == "matrix").unwrap().clone()
}
fn zeile_nr(name: &str) -> usize { ZEILEN.iter().position(|z| *z == name).unwrap() }
fn spalte_nr(name: &str) -> usize { SPALTEN.iter().position(|z| *z == name).unwrap() }
/// the default pins of the graph as `(set, row, column, value)`
fn vorgabe_stifte() -> Vec<(usize, usize, usize, f32)> {
    feld_knoten()["stifte"].as_array().unwrap().iter()
        .map(|s| (s[0].as_u64().unwrap() as usize, s[1].as_u64().unwrap() as usize, s[2].as_u64().unwrap() as usize, s[3].as_f64().unwrap() as f32)).collect()
}

#[test]
fn das_steckfeld_hat_die_festgelegten_namen_und_vorgabestifte() {
    let f = feld_knoten();
    assert_eq!(f["id"], "feld");
    let namen = |k: &str| -> Vec<String> { f[k].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect() };
    assert_eq!(namen("zeilen"), ZEILEN.to_vec());
    assert_eq!(namen("spalten"), SPALTEN.to_vec());
    let st = vorgabe_stifte();
    assert!(!st.is_empty() && st.len() <= 24, "{} default pins", st.len());
    assert!(st.iter().all(|s| s.0 == 0 && s.3 != 0.0 && s.3.abs() <= 1.0), "default pins are in set A, non-zero, within -1..1");
    // every default pin a position once, sorted
    let mut sortiert = st.clone();
    sortiert.sort_by_key(|s| (s.0, s.1, s.2));
    sortiert.dedup_by_key(|s| (s.0, s.1, s.2));
    assert_eq!(sortiert, st, "sorted by (set, row, column), no duplicate position");
    // the knob number of every freed v1 knob is taken by a new knob of version 2, none is above 64
    let p = lade(GRAPH);
    assert!(p.regler_namen.len() == 60 && p.regler_namen.iter().all(|(n, _)| (1..=64).contains(n)));
    // the knobs the v1 presets rely on keep their numbers
    for (id, nr) in [("v1_wave", 1), ("f_cut", 29), ("f_env", 32), ("g_decay", 27), ("e2_r", 42), ("ch_rate", 50), ("fb_amt", 53), ("vol", 60)] { assert_eq!(k(id), nr, "{id}"); }
}

/// the normalled audio path alone: no pin at all and the instrument still sounds (RMS above -40 dBFS on the probe)
#[test]
fn das_leere_steckfeld_klingt() {
    let x = probe_mit(&[], &Feld::Leer);
    assert!(endlich(&x));
    let r = rms_db(&x);
    println!("MESS empty patch field: RMS {r:.1} dBFS, peak {:.3}", spitze(&x));
    assert!(r > -40.0, "RMS {r:.1} dBFS: the empty field is (nearly) silent");
}

/// every default pin is audible: with that one pin removed the output differs from the default patch
#[test]
fn jeder_vorgabestift_aendert_den_klang() {
    let basis = probe(&[]);
    let st = vorgabe_stifte();
    let faelle: Vec<usize> = (0..st.len()).collect();
    let stumm: Vec<String> = parallel(&faelle, |&i| {
        let ohne: Vec<(usize, usize, usize, f32)> = st.iter().enumerate().filter(|(j, _)| *j != i).map(|(_, s)| *s).collect();
        let d = unterschied(&probe_mit(&[], &Feld::Stifte(ohne)), &basis);
        let (_, z, sp, w) = st[i];
        println!("MESS pin {} -> {} = {w}: removed, largest difference {d:.5}", ZEILEN[z], SPALTEN[sp]);
        if d <= 1e-4 { Some(format!("pin {} -> {} changes nothing", ZEILEN[z], SPALTEN[sp])) } else { None }
    }).into_iter().flatten().collect();
    assert!(stumm.is_empty(), "{stumm:?}");
}

/// self-patch: Filter -> Filter In and Gate -> Gate In at +1, four held notes, 2 s: finite, no rescue, peak <= 1.0
#[test]
fn selbstpatch_bleibt_beschraenkt() {
    let faelle = [("Filter -> Filter In", zeile_nr("Filter"), spalte_nr("Filter In")), ("Gate -> Gate In", zeile_nr("Gate"), spalte_nr("Gate In"))];
    for (name, z, sp) in faelle {
        let mut p = programm_mit(&[], &Feld::Plus(vec![(0, z, sp, 1.0)]));
        p.setze_takt(0.0, 2.0 / SR as f64);
        for n in [36u8, 43, 48, 55] { p.note_an(n, 0.8); }
        let x = spiele(&mut p, 2.0);
        let sp_ = spitze(&x);
        println!("MESS self-patch {name} at +1: peak {sp_:.3}, rms {:.1} dB, rescues {}", rms_db(&x), p.rettungen);
        assert!(endlich(&x), "{name}: NaN or inf");
        assert_eq!(p.rettungen, 0, "{name}: the engine had to rescue a value");
        assert!(sp_ <= 1.0, "{name}: peak {sp_}");
    }
    // both at once, resonance and drive up
    let mut p = programm_mit(&[n0("f_reso", 1.0), n0("f_drive", 1.0)], &Feld::Plus(vec![(0, zeile_nr("Filter"), spalte_nr("Filter In"), 1.0), (0, zeile_nr("Gate"), spalte_nr("Gate In"), 1.0)]));
    p.setze_takt(0.0, 2.0 / SR as f64);
    for n in [36u8, 43, 48, 55] { p.note_an(n, 0.8); }
    let x = spiele(&mut p, 2.0);
    println!("MESS self-patch both, resonance and drive 1: peak {:.3}", spitze(&x));
    assert!(endlich(&x) && p.rettungen == 0 && spitze(&x) <= 2.0);
}

/// Cycle: with it on a function generator runs by itself while the key is held (no retrigger); off, it settles after one run.
/// Func 1 -> Amp at -0.8 makes the cycle audible as a swell of the held note.
#[test]
fn func_zyklus_laeuft_von_selbst() {
    let feld = Feld::Stifte(vec![(0, zeile_nr("Func 1"), spalte_nr("Amp"), -0.8)]);
    let basis = [u("f1_rise", 0.25), u("f1_fall", 0.25), n0("f1_shape", 0.5), n0("fx_dmix", 0.0), n0("fx_hmix", 0.0), n0("fb_amt", 0.0)];
    let schwanken = |zyklus: usize| -> f64 {
        let mut kn = basis.to_vec();
        kn.push(wahl("f1_cycle", zyklus, 2));
        let x = halten_mit(&kn, &feld, 48, 4.0);
        let pegel: Vec<f64> = x[(2.0 * SR) as usize..(4.0 * SR) as usize].chunks(2400).map(rms_db).collect();
        pegel.iter().cloned().fold(f64::MIN, f64::max) - pegel.iter().cloned().fold(f64::MAX, f64::min)
    };
    let (an, aus) = (schwanken(1), schwanken(0));
    println!("MESS func cycle: level swing {an:.1} dB with Cycle on, {aus:.1} dB off (2..4 s of a held note)");
    assert!(an > aus + 6.0, "Cycle on: the held note does not swell by itself ({an:.1} dB)");
    assert!(aus < 6.0, "Cycle off: the function generator keeps moving ({aus:.1} dB; the rest is oscillator beating)");
    // the same for Func 2 (Tempo of Func 2 is not touched)
    let feld2 = Feld::Stifte(vec![(0, zeile_nr("Func 2"), spalte_nr("Amp"), -0.8)]);
    let kn = [u("f2_rise", 0.25), u("f2_fall", 0.25), n0("f2_shape", 0.5), wahl("f2_cycle", 1, 2), n0("fx_dmix", 0.0), n0("fx_hmix", 0.0), n0("fb_amt", 0.0)];
    let x = halten_mit(&kn, &feld2, 48, 4.0);
    let pegel: Vec<f64> = x[(2.0 * SR) as usize..(4.0 * SR) as usize].chunks(2400).map(rms_db).collect();
    let swing = pegel.iter().cloned().fold(f64::MIN, f64::max) - pegel.iter().cloned().fold(f64::MAX, f64::min);
    println!("MESS func 2 cycle: level swing {swing:.1} dB");
    assert!(swing > 6.0, "Func 2 does not free-run ({swing:.1} dB)");
}

/// the real low-pass gate plucks: the West voice alone, Open 0, Strike 1, a short Decay, the key held for 1.5 s: the level falls
/// by at least 30 dB from the first 80 ms to 0.5 .. 0.6 s, and the strike is not silent
#[test]
fn echtes_lpg_zupft_die_west_stimme() {
    for (modus, name) in [(0usize, "LP"), (1, "Both"), (2, "VCA")] {
        let mut kn = nur_west();
        kn.extend([n0("g_open", 0.0), n0("g_strike", 1.0), u("g_decay", 0.12), wahl("g_mode", modus, 3), u("e2_r", 0.2)]);
        let x = halten_mit(&kn, &Feld::Leer, 48, 1.5);
        let (anfang, spaet) = (pegel_db(&x, 0.0, 0.08), pegel_db(&x, 0.5, 0.6));
        println!("MESS bongo {name}: {anfang:.1} dB in the first 80 ms, {spaet:.1} dB at 0.5..0.6 s");
        assert!(anfang > -40.0, "{name}: the strike is silent ({anfang:.1} dB)");
        assert!(spaet <= anfang - 30.0, "{name}: {spaet:.1} dB against {anfang:.1} dB: not a pluck");
    }
}

/// Key row: note pitch in octaves from C3 (1 per octave). Key -> VCO 1 Pitch at 1/12 adds one semitone per octave above C3.
#[test]
fn key_zeile_folgt_der_tonhoehe() {
    let kn = [n0("v2_lv", 0.0), n0("ring_lv", 0.0), n0("noise_lv", 0.0), n0("v3_lv", 0.0), n0("w_lv", 0.0), n0("v1_lv", 1.0), n0("v1_wave", 0.0), n0("f_cut", 1.0), n0("f_key", 0.0),
              n0("f_env", 0.5), n0("f_drive", 0.0), n0("f_reso", 0.0), n0("fb_amt", 0.0), n0("fx_dmix", 0.0), n0("fx_hmix", 0.0), n0("drift", 0.0), n0("e1_s", 1.0)];
    let f = Feld::Stifte(vec![(0, zeile_nr("Key"), spalte_nr("VCO 1 Pitch"), 1.0 / 12.0)]);
    for (note, erwartet) in [(36u8, 65.406 * 2f64.powf(-1.0 / 12.0)), (48, 130.813), (60, 261.626 * 2f64.powf(1.0 / 12.0)), (72, 523.251 * 2f64.powf(2.0 / 12.0))] {
        let hz = haupt_frequenz(&halten_mit(&kn, &f, note, 2.0)[(0.3 * SR) as usize..(2.0 * SR) as usize]);
        println!("MESS key row: note {note}: {hz:.2} Hz, expected {erwartet:.2} Hz");
        assert!((hz / erwartet - 1.0).abs() < 0.01, "note {note}: {hz} Hz against {erwartet} Hz");
    }
}

/// Morph at 1 plays set B: with set B empty it is the empty field
#[test]
fn morph_spielt_satz_b() {
    let (a, b) = (probe(&[n0("morph", 1.0)]), probe_mit(&[], &Feld::Leer));
    let d = unterschied(&a, &b);
    println!("MESS morph 1 against the empty field: largest difference {d:.5}");
    assert!(d < 1e-3, "Morph 1 does not play the empty set B ({d})");
    assert!(unterschied(&a, &probe(&[])) > 1e-3, "Morph does nothing");
}

// ---------------------------------------------------------------- presets

fn preset_dateien() -> Vec<(String, serde_json::Value)> {
    // KRAKEN_PRESETS=<dir> plays the presets of another folder (variants while tuning); the factory folder otherwise
    let dir = std::env::var("KRAKEN_PRESETS").map(std::path::PathBuf::from).unwrap_or_else(|_| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../ui/presets/factory/modular"));
    let mut aus = Vec::new();
    for e in std::fs::read_dir(&dir).unwrap() {
        let pfad = e.unwrap().path();
        let name = pfad.file_name().unwrap().to_string_lossy().to_string();
        if !(name.starts_with("synth-kraken-") && name.ends_with(".preset.json")) { continue; }
        aus.push((name.trim_end_matches(".preset.json").to_string(), serde_json::from_slice(&std::fs::read(&pfad).unwrap()).unwrap()));
    }
    aus.sort_by(|a, b| a.0.cmp(&b.0));
    aus
}

#[test]
fn presets_sind_vollstaendig() {
    let p = preset_dateien();
    for (name, j) in &p {
        assert_eq!(j["graph"], "synth-kraken", "{name}");
        assert!(j["tags"].as_array().unwrap().iter().any(|t| t == "synth-kraken"), "{name}: tag");
        let text = j["beschreibung"]["text"].as_str().unwrap();
        assert!((10..=160).contains(&text.chars().count()), "{name}: description of {} characters", text.chars().count());
        assert_eq!(j["werte"].as_object().unwrap().len(), KNOEPFE, "{name}: all knobs");
        if let Some(l) = j.get("stifte") {
            let l = l.as_array().unwrap_or_else(|| panic!("{name}: stifte is a list"));
            assert!(l.len() <= 512, "{name}: at most 512 pins");
            let mut vor = -1i64;
            for e in l {
                let e = e.as_array().unwrap();
                let (s, z, sp, w) = (e[0].as_i64().unwrap(), e[1].as_i64().unwrap(), e[2].as_i64().unwrap(), e[3].as_f64().unwrap());
                assert!((0..2).contains(&s) && (0..16).contains(&z) && (0..16).contains(&sp) && w != 0.0 && w.abs() <= 1.0, "{name}: pin {e:?}");
                let pos = s * 256 + z * 16 + sp;
                assert!(pos > vor, "{name}: pins sorted, none twice");
                vor = pos;
            }
        }
    }
    assert!(p.len() >= 14, "the eight v1 presets plus at least six patch field presets ({})", p.len());
    assert!(p.iter().filter(|(_, j)| j.get("stifte").is_some()).count() >= 14, "every preset carries its pins");
}

/// A factory preset as the harness plays it: name (file stem), kind (`art`), knobs `(number, 0..1)` and the pins of the file (None = the graph's default pins)
struct Fall { name: String, art: String, knoepfe: Vec<(usize, f32)>, stifte: Option<Vec<(usize, usize, usize, f32)>> }

fn presets() -> Vec<Fall> {
    preset_dateien().into_iter().map(|(name, j)| {
        let mut k: Vec<(usize, f32)> = j["werte"].as_object().unwrap().iter()
            .map(|(s, v)| (s.strip_prefix("knob").unwrap().parse().unwrap(), v.as_f64().unwrap() as f32)).collect();
        k.sort_by_key(|e| e.0);
        let stifte = j.get("stifte").map(|l| l.as_array().unwrap().iter()
            .map(|e| (e[0].as_u64().unwrap() as usize, e[1].as_u64().unwrap() as usize, e[2].as_u64().unwrap() as usize, e[3].as_f64().unwrap() as f32)).collect());
        Fall { name, art: j["beschreibung"]["art"].as_str().unwrap().to_string(), knoepfe: k, stifte }
    }).collect()
}
fn feld_von(f: &Fall) -> Feld { f.stifte.clone().map_or(Feld::Vorgabe, Feld::Stifte) }

/// Patches that play by themselves: one held note, 16 s
const SELBSTSPIELEND: &[&str] = &["krell", "feedback-drone", "glass-rain", "gate-walker"];
/// Patches whose sets A and B are two sounds: rendered a second time with Morph swept 0 -> 1 over 8 s
const MORPH_PRESETS: &[&str] = &["two-faces"];

fn spiele_morph(p: &mut Programm, sekunden: f32) -> Vec<(f32, f32)> {
    let n = (sekunden * SR) as usize;
    (0..n).map(|i| { if i % 256 == 0 { p.setze_regler(15, i as f32 / n as f32); } p.sample_stereo() }).collect()
}

/// DC of the mono signal in dBFS (mean squared)
fn gleichanteil_db(x: &[(f32, f32)]) -> f64 {
    let m = mono(x);
    db((m.iter().sum::<f64>() / m.len() as f64).powi(2))
}
/// Share of the power above 6 kHz (mono, whole signal) in percent
fn hoch_prozent(x: &[(f32, f32)]) -> f64 {
    let m = mono(x);
    let nfft = m.len().next_power_of_two();
    let p = leistung(&m, nfft);
    band(&p, nfft, 6_000.0, 20_000.0) / band(&p, nfft, 20.0, 20_000.0).max(1e-30) * 100.0
}

// the pins of every v1 preset that lost character with the removed knobs come back with the preset
#[test]
fn v1_presets_tragen_stifte_die_den_klang_aendern() {
    for f in presets() {
        let Some(st) = &f.stifte else { continue };
        if !["bongo-pluck", "fm-bell", "fold-drone", "self-mover"].iter().any(|n| f.name.ends_with(n)) { continue; }
        let mit = probe_mit(&f.knoepfe, &Feld::Stifte(st.clone()));
        let ohne = probe_mit(&f.knoepfe, &Feld::Vorgabe);
        let d = unterschied(&mit, &ohne);
        println!("MESS {}: pins against the default pins, largest difference {d:.4}", f.name);
        assert!(d > 0.02, "{}: its own pins change nothing against the default pins ({d})", f.name);
    }
}

// ---------------------------------------------------------------- harness and cost (ignored)

/// Every factory preset, 8 s: C2 for a bass, a C4 chord for the rest; a self-playing patch holds one note for 16 s; a Morph patch is rendered a second time with
/// Morph swept 0 -> 1 over 8 s. Prints peak, RMS, spectral centroid, DC and the share above 6 kHz. The pins of the preset file are applied (none = default pins).
///   KRAKEN_AUS=<dir> [KRAKEN_NUR=<part of a name>,...] cargo test --release -p baukasten_dsp --test kraken kraken_presets_messung -- --ignored --nocapture
#[test]
#[ignore]
fn kraken_presets_messung() {
    let aus = std::env::var("KRAKEN_AUS").ok().map(std::path::PathBuf::from);
    if let Some(d) = &aus { std::fs::create_dir_all(d).unwrap(); }
    let nur: Vec<String> = std::env::var("KRAKEN_NUR").ok().map(|s| s.split(',').map(|x| x.to_string()).collect()).unwrap_or_default();
    let mut fall: Vec<Fall> = Vec::new();
    if nur.is_empty() {
        fall.push(Fall { name: "(default)".into(), art: "lead".into(), knoepfe: vec![], stifte: None });
        fall.push(Fall { name: "(empty field)".into(), art: "lead".into(), knoepfe: vec![], stifte: Some(vec![]) });
    }
    fall.extend(presets().into_iter().filter(|f| nur.is_empty() || nur.iter().any(|n| f.name.contains(n.as_str()))));
    let zeilen = parallel(&fall, |f| {
        let kurz = f.name.trim_start_matches("synth-kraken-").to_string();
        let selbst = SELBSTSPIELEND.contains(&kurz.as_str());
        let sek = if selbst { 16.0 } else { 8.0 };
        let noten: &[u8] = if f.art == "bass" { &[36] } else if selbst { &[60] } else { &[60, 64, 67] };
        let mut zeilen = Vec::new();
        for morph in [false, true] {
            if morph && !MORPH_PRESETS.contains(&kurz.as_str()) { continue; }
            let mut p = programm_mit(&f.knoepfe, &feld_von(f));
            p.setze_takt(0.0, 2.0 / SR as f64);
            for n in noten { p.note_an(*n, 0.8); }
            let x = if morph { spiele_morph(&mut p, sek) } else { spiele(&mut p, sek) };
            assert!(endlich(&x), "{}", f.name);
            let datei = format!("{}{}.wav", f.name.replace(['(', ')'], "").replace(' ', "-"), if morph { "-morph" } else { "" });
            if let Some(d) = &aus { schreibe_wav(&d.join(&datei), &x); }
            // RMS over the active 50 ms frames (above -60 dBFS RMS), centroid over the first 4 s (a pluck is silent after that)
            let aktiv: Vec<(f32, f32)> = x.chunks(2400).filter(|c| rms_db(c) > -60.0).flatten().cloned().collect();
            zeilen.push(format!("| {}{} | {} {} s | {:.3} | {:.1} | {:.0} | {:.1} | {:.2} |", f.name, if morph { " (Morph 0..1)" } else { "" },
                if f.art == "bass" { "C2" } else if selbst { "C4 held" } else { "C4 chord" }, sek as u32, spitze(&x), rms_db(&aktiv), schwerpunkt(&x[..4 * SR as usize]), gleichanteil_db(&x), hoch_prozent(&x)));
        }
        zeilen
    });
    println!("| preset | played | peak | RMS dB | centroid Hz | DC dBFS | >6 kHz % |\n|---|---|---|---|---|---|---|");
    for z in zeilen.into_iter().flatten() { println!("MESS {z}"); }
}

/// Cost of every factory preset: 256-sample blocks, 4 held notes, p50 / p99 against the gate (p50 <= 2400 us, p99 <= 3700 us), one preset after the other
///   cargo test --release -p baukasten_dsp --test kraken kraken_presets_kosten -- --ignored --nocapture
#[test]
#[ignore]
fn kraken_presets_kosten() {
    use std::time::Instant;
    let mut fall = vec![Fall { name: "(default)".into(), art: "lead".into(), knoepfe: vec![], stifte: None }];
    fall.extend(presets());
    let (mut schlimmst50, mut schlimmst99) = (0.0f64, 0.0f64);
    for f in &fall {
        let mut p = programm_mit(&f.knoepfe, &feld_von(f));
        p.setze_takt(0.0, 2.0 / SR as f64);
        for n in 0..4u8 { p.note_an(36 + 7 * n, 0.8); }
        let mut senke = 0.0f32;
        for _ in 0..100 { for _ in 0..256 { senke += p.sample(); } }
        let mut zeiten: Vec<f64> = Vec::with_capacity(1500);
        for _ in 0..1500 {
            let t = Instant::now();
            for _ in 0..256 { senke += p.sample(); }
            zeiten.push(t.elapsed().as_secs_f64() * 1e6);
        }
        zeiten.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let q = |q: f64| zeiten[(((q * zeiten.len() as f64).ceil() as usize).max(1) - 1).min(zeiten.len() - 1)];
        println!("KOSTEN {}: p50 {:.0} us, p99 {:.0} us (sink {senke:.1})", f.name, q(0.5), q(0.99));
        schlimmst50 = schlimmst50.max(q(0.5)); schlimmst99 = schlimmst99.max(q(0.99));
    }
    println!("KOSTEN worst preset: p50 {schlimmst50:.0} us, p99 {schlimmst99:.0} us");
    assert!(schlimmst50 <= 2400.0, "p50 {schlimmst50:.0} us over the gate of 2400 us");
    assert!(schlimmst99 <= 3700.0, "p99 {schlimmst99:.0} us over the gate of 3700 us");
}

/// 24 pins spread over both sets and all sixteen columns (sources rotate), for the cost measurement
fn vierundzwanzig_stifte() -> Vec<(usize, usize, usize, f32)> {
    let mut l: Vec<(usize, usize, usize, f32)> = vorgabe_stifte();
    let mut i = 0;
    while l.len() < 24 {
        let (z, sp) = ((i * 5 + 3) % 16, (i * 7 + 1) % 16);
        if !l.iter().any(|s| s.0 == 0 && s.1 == z && s.2 == sp) { l.push((0, z, sp, if i % 2 == 0 { 0.2 } else { -0.15 })); }
        i += 1;
    }
    l
}

/// Cost: 256-sample blocks, 4 held notes, p50 / p99 of Kraken v2 (default pins and 24 pins) and synth-poly in the same run, one after
/// the other and three rounds, so a load wobble shows. The gate (24 pins): p50 <= 2400 us and p99 <= 3700 us. Run on a quiet machine:
///   cargo test --release -p baukasten_dsp --test kraken kosten_kraken -- --ignored --nocapture
#[test]
#[ignore]
fn kosten_kraken() {
    use std::time::Instant;
    let mut beste = [(f64::MAX, f64::MAX); 3];
    for runde in 0..3 {
        for (i, label) in ["synth-kraken (default pins)", "synth-kraken (24 pins)", "synth-poly"].into_iter().enumerate() {
            let mut p = match i {
                0 => programm(&[]),
                1 => programm_mit(&[], &Feld::Stifte(vierundzwanzig_stifte())),
                _ => uebersetze(POLY, SR).unwrap(),
            };
            p.setze_takt(0.0, 2.0 / SR as f64);
            for n in 0..4u8 { p.note_an(36 + 7 * n, 0.8); }
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
            println!("KOSTEN round {runde} {label} (4 held notes): p50 {:.0} us, p99 {:.0} us, p99.9 {:.0} us, max {:.0} us (sink {senke:.1})", q(0.5), q(0.99), q(0.999), zeiten[zeiten.len() - 1]);
            beste[i] = (beste[i].0.min(q(0.5)), beste[i].1.min(q(0.99)));
        }
    }
    println!("KOSTEN best of three: kraken default pins p50 {:.0} us p99 {:.0} us; kraken 24 pins p50 {:.0} us p99 {:.0} us; synth-poly p50 {:.0} us p99 {:.0} us",
             beste[0].0, beste[0].1, beste[1].0, beste[1].1, beste[2].0, beste[2].1);
    assert!(beste[1].0 <= 2400.0, "p50 {:.0} us over the gate of 2400 us", beste[1].0);
    assert!(beste[1].1 <= 3700.0, "p99 {:.0} us over the gate of 3700 us", beste[1].1);
}
