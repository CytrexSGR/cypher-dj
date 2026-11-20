//! Technical sound audit (no taste): `klang_pruefung MANIFEST.json OUT.json [--wav DIR]`.
//! MANIFEST is a list of cases `{name, graph, knoepfe: {"5": 0.3}, stifte: [[set,row,col,val]] | null, phrase, wurzel?, vergleich_stifte?}`.
//! `graph` is a file under demos/ (without .json). `phrase`: bass | lead | chord | held | perc | hit:N | kit.
//! `stifte` null keeps the graph's default pins (a patch field only); a list replaces them (as the Kraken preset harness does).
//! `vergleich_stifte`: also render with these pins ("default" = the graph's pins) and report the band difference in dB.
//! Per case: peak, true peak (4x), RMS of active frames, gated loudness (BS.1770 K-weighting), DC, clicks, energy above 16 kHz,
//! non-finite samples and guard rescues, denormal samples, tail decay after the last note-off, render cost (min of 2 runs, x realtime).
use baukasten_dsp::{uebersetze_mit_wurzel, Programm};
use realfft::RealFftPlanner;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Instant;

const SR: f32 = 48_000.0;
const BPM: f64 = 128.0;
const VORLAUF: usize = 4800;

/// (note, start s, length s, velocity)
fn phrase(name: &str) -> (Vec<(u8, f64, f64, f32)>, f64) {
    let mut e: Vec<(u8, f64, f64, f32)> = Vec::new();
    match name {
        "bass" => {
            let l: [(u8, f64, f64); 12] = [(24, 0.0, 1.2), (24, 1.4, 0.3), (27, 1.8, 0.3), (24, 2.2, 0.3), (31, 2.6, 0.3), (29, 3.0, 0.3), (36, 3.4, 0.6), (24, 4.2, 0.3), (27, 4.6, 0.3), (22, 5.0, 0.3), (24, 5.4, 0.6), (33, 6.2, 0.4)];
            for (i, (n, s, g)) in l.iter().enumerate() { e.push((*n, *s, *g, if i % 2 == 0 { 0.9 } else { 0.7 })); }
            (e, 6.7 + 4.0)
        }
        "lead" => {
            let n = [60u8, 63, 67, 70, 72, 70, 67, 63, 65, 68, 72, 75, 77, 75, 72, 68];
            for (i, x) in n.iter().enumerate() { e.push((*x, i as f64 * 0.35, 0.3, if i % 3 == 0 { 0.9 } else { 0.75 })); }
            (e, 5.6 + 4.0)
        }
        "chord" => {
            for n in [48u8, 51, 55, 58] { e.push((n, 0.0, 2.8, 0.8)); }
            for n in [53u8, 56, 60, 63] { e.push((n, 3.0, 2.8, 0.8)); }
            (e, 5.8 + 4.5)
        }
        "held" => { e.push((60, 0.0, 12.0, 0.8)); (e, 12.0 + 3.5) }
        "held_long" => { e.push((60, 0.0, 2.0, 0.8)); (e, 2.0 + 30.0) }
        "perc" => {
            for (i, n) in [36u8, 42, 48, 54, 60, 66].iter().enumerate() { e.push((*n, i as f64 * 1.2, 0.1, 0.9)); }
            (e, 6.0 + 2.5)
        }
        "kit" => {
            for b in 0..8 { e.push((42, b as f64 * 0.469 + 0.234, 0.05, 0.8)); }
            for b in [0.0, 2.0, 4.0, 6.0, 7.5] { e.push((36, b * 0.469, 0.05, 0.95)); }
            for b in [1.0, 3.0, 5.0, 7.0] { e.push((38, b * 0.469, 0.05, 0.9)); }
            (e, 3.75 + 2.5)
        }
        s if s.starts_with("hit:") => { e.push((s[4..].parse().unwrap(), 0.0, 0.1, 0.9)); (e, 2.8) }
        x => panic!("phrase {x}"),
    }
}

struct Lauf { x: Vec<(f32, f32)>, rohe_nonfinite: usize, rettungen: u32, sek: f64, ereignisse: Vec<(usize, bool)>, je_sekunde: Vec<f64> }

fn baue(fall: &Value, stifte: &Value, wurzel: Option<&Path>) -> Programm {
    let g = fall["graph"].as_str().unwrap();
    let pfad = format!("{}/demos/{g}.json", env!("CARGO_MANIFEST_DIR"));
    let json = std::fs::read_to_string(&pfad).unwrap_or_else(|e| panic!("{pfad}: {e}"));
    let mut p = uebersetze_mit_wurzel(&json, SR, wurzel).unwrap_or_else(|e| panic!("{g}: {e}"));
    p.setze_takt(0.0, BPM / 60.0 / SR as f64);
    if let Some(l) = stifte.as_array() {
        assert!(p.stifte_grund(false, true), "{g}: no patch field but pins given");
        for e in l {
            let ok = p.stift_sofort(e[0].as_u64().unwrap() as usize, e[1].as_u64().unwrap() as usize, e[2].as_u64().unwrap() as usize, e[3].as_f64().unwrap() as f32);
            assert!(ok, "{g}: pin out of range {e}");
        }
    }
    if let Some(k) = fall["knoepfe"].as_object() {
        for (n, w) in k { p.setze_regler(n.parse().unwrap(), w.as_f64().unwrap() as f32); }
    }
    p
}

fn spiele(mut p: Programm, ph: &str) -> Lauf {
    let (ev, gesamt_s) = phrase(ph);
    let mut er: Vec<(usize, bool, u8, f32)> = Vec::new();
    for (n, s, l, v) in &ev {
        er.push(((s * SR as f64) as usize, true, *n, *v));
        er.push((((s + l) * SR as f64) as usize, false, *n, 0.0));
    }
    er.sort_by_key(|e| (e.0, e.1));
    for _ in 0..VORLAUF { p.sample_stereo(); }
    let gesamt = (gesamt_s * SR as f64) as usize;
    let mut x = Vec::with_capacity(gesamt);
    let (mut ei, mut nf) = (0, 0usize);
    let t = Instant::now();
    let mut je_sekunde: Vec<f64> = Vec::new();
    let mut tb = Instant::now();
    for i in 0..gesamt {
        if i > 0 && i % 48000 == 0 { je_sekunde.push(tb.elapsed().as_secs_f64()); tb = Instant::now(); }
        while ei < er.len() && er[ei].0 <= i {
            let (_, an, n, v) = er[ei];
            if an { p.note_an(n, v) } else { p.note_aus(n) }
            ei += 1;
        }
        let (l, r) = p.sample_stereo();
        if !l.is_finite() || !r.is_finite() { nf += 1; }
        x.push((l, r));
    }
    let sek = t.elapsed().as_secs_f64();
    Lauf { x, rohe_nonfinite: nf, rettungen: p.rettungen, sek, ereignisse: er.iter().map(|e| (e.0, e.1)).collect(), je_sekunde }
}

fn db(p: f64) -> f64 { 10.0 * p.max(1e-20).log10() }

fn biquad(x: &[f64], b: [f64; 3], a: [f64; 2]) -> Vec<f64> {
    let (mut z1, mut z2) = (0.0, 0.0);
    x.iter().map(|&v| { let y = b[0] * v + z1; z1 = b[1] * v - a[0] * y + z2; z2 = b[2] * v - a[1] * y; y }).collect()
}
/// BS.1770 integrated loudness (48 kHz coefficients), stereo, with the absolute and relative gates. None below the gate everywhere.
fn lufs(x: &[(f32, f32)]) -> Option<f64> {
    let k = |c: usize| -> Vec<f64> {
        let v: Vec<f64> = x.iter().map(|s| if c == 0 { s.0 as f64 } else { s.1 as f64 }).collect();
        let s1 = biquad(&v, [1.53512485958697, -2.69169618940638, 1.19839281085285], [-1.69065929318241, 0.73248077421585]);
        biquad(&s1, [1.0, -2.0, 1.0], [-1.99004745483398, 0.99007225036621])
    };
    let (l, r) = (k(0), k(1));
    let (blk, hop) = (19200, 4800);
    let mut bl: Vec<f64> = Vec::new();
    let mut s = 0;
    while s + blk <= x.len() {
        let e: f64 = (s..s + blk).map(|i| l[i] * l[i] + r[i] * r[i]).sum::<f64>() / blk as f64;
        bl.push(e);
        s += hop;
    }
    let l_of = |e: f64| -0.691 + db(e);
    let abs: Vec<f64> = bl.iter().cloned().filter(|e| l_of(*e) > -70.0).collect();
    if abs.is_empty() { return None; }
    let rel = l_of(abs.iter().sum::<f64>() / abs.len() as f64) - 10.0;
    let fin: Vec<f64> = abs.iter().cloned().filter(|e| l_of(*e) > rel).collect();
    if fin.is_empty() { None } else { Some(l_of(fin.iter().sum::<f64>() / fin.len() as f64)) }
}

/// True peak: 4x oversampling with a 32-tap windowed sinc around every sample within 6 dB of the sample peak.
fn wahre_spitze(x: &[(f32, f32)], sp: f32) -> f32 {
    let mut m = sp;
    for c in 0..2 {
        let v: Vec<f32> = x.iter().map(|s| if c == 0 { s.0 } else { s.1 }).collect();
        for i in 16..v.len().saturating_sub(16) {
            if v[i].abs() < sp * 0.5 { continue; }
            for ph in 1..4 {
                let f = ph as f64 / 4.0;
                let mut a = 0.0f64;
                for t in -15i32..=16 {
                    let d = t as f64 - f;
                    let sinc = if d == 0.0 { 1.0 } else { (std::f64::consts::PI * d).sin() / (std::f64::consts::PI * d) };
                    let w = 0.5 + 0.5 * (std::f64::consts::PI * d / 16.5).cos();
                    a += v[(i as i32 + t) as usize] as f64 * sinc * w;
                }
                m = m.max(a.abs() as f32);
            }
        }
    }
    m
}

fn rms_aktiv_db(x: &[(f32, f32)]) -> f64 {
    let mut s = 0.0f64; let mut n = 0usize;
    for c in x.chunks(2400) {
        let e: f64 = c.iter().map(|(l, r)| 0.5 * (*l as f64 * *l as f64 + *r as f64 * *r as f64)).sum::<f64>() / c.len() as f64;
        if db(e) > -60.0 { s += e * c.len() as f64; n += c.len(); }
    }
    if n == 0 { -120.0 } else { db(s / n as f64) }
}

fn spektrum(m: &[f64]) -> (Vec<f64>, usize) {
    let n = m.len().next_power_of_two();
    let mut v: Vec<f64> = m.iter().enumerate().map(|(i, s)| s * (0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / m.len() as f64).cos())).collect();
    v.resize(n, 0.0);
    let mut pl = RealFftPlanner::<f64>::new();
    let f = pl.plan_fft_forward(n);
    let mut o = f.make_output_vec();
    f.process(&mut v, &mut o).unwrap();
    (o.iter().map(|c| c.norm_sqr()).collect(), n)
}
const BAENDER: [(&str, f64, f64); 5] = [("sub", 20.0, 100.0), ("tief", 100.0, 300.0), ("mitte", 300.0, 2000.0), ("hoehen", 2000.0, 8000.0), ("luft", 8000.0, 20000.0)];
fn band(p: &[f64], n: usize, lo: f64, hi: f64) -> f64 {
    let b = |f: f64| (f * n as f64 / SR as f64).round() as usize;
    p[b(lo)..=b(hi).min(p.len() - 1)].iter().sum()
}

fn mono(x: &[(f32, f32)]) -> Vec<f64> { x.iter().map(|(l, r)| 0.5 * (*l as f64 + *r as f64)).collect() }

fn bander(x: &[(f32, f32)]) -> Vec<f64> {
    let (p, n) = spektrum(&mono(x));
    BAENDER.iter().map(|(_, lo, hi)| db(band(&p, n, *lo, *hi) / (x.len() as f64).powi(2) * 4.0)).collect()
}

fn klicks(x: &[(f32, f32)], ereignisse: &[(usize, bool)]) -> Value {
    let mut pre = vec![0.0f64; x.len() + 1];
    let mut d: Vec<f64> = Vec::with_capacity(x.len());
    for i in 0..x.len() {
        let (a, b) = if i == 0 { (0.0, 0.0) } else { x[i - 1] };
        d.push(((x[i].0 - a) as f64).abs().max(((x[i].1 - b) as f64).abs()));
        pre[i + 1] = pre[i] + d[i] * d[i];
    }
    let (mut an, mut aus, mut mitte) = (0usize, 0usize, 0usize);
    let (mut max_an, mut max_aus, mut max_mitte) = (0.0f64, 0.0f64, 0.0f64);
    let mut orte: Vec<Value> = Vec::new();
    let mut i = 0;
    while i < d.len() {
        let (lo, hi) = (i.saturating_sub(128), (i + 129).min(d.len()));
        let loc = ((pre[hi] - pre[lo] - d[i] * d[i]) / (hi - lo - 1).max(1) as f64).sqrt();
        if d[i] > 0.04 && d[i] > 10.0 * loc.max(1e-4) {
            let nah = |an_: bool| ereignisse.iter().any(|(p, a)| *a == an_ && i + 8 >= *p && i <= *p + 64);
            if nah(true) { an += 1; max_an = max_an.max(d[i]); }
            else if nah(false) { aus += 1; max_aus = max_aus.max(d[i]); }
            else { mitte += 1; max_mitte = max_mitte.max(d[i]); if orte.len() < 12 { orte.push(json!([i as f64 / SR as f64, d[i]])); } }
            i += 32; // one click, not 32 of its samples
        } else { i += 1; }
    }
    json!({"an": an, "an_max": max_an, "aus": aus, "aus_max": max_aus, "mitte": mitte, "mitte_max": max_mitte, "mitte_orte": orte})
}

/// RMS dBFS of a stretch (mono power of both channels)
fn rms_von(x: &[(f32, f32)]) -> f64 {
    if x.is_empty() { return -200.0; }
    db(x.iter().map(|(l, r)| 0.5 * (*l as f64 * *l as f64 + *r as f64 * *r as f64)).sum::<f64>() / x.len() as f64)
}

fn messe(l: &Lauf, nur_luft: bool) -> Value {
    let x = &l.x;
    let sp = x.iter().fold(0.0f32, |m, (a, b)| m.max(a.abs()).max(b.abs()));
    let wsp = wahre_spitze(x, sp);
    let m = mono(x);
    let dc = m.iter().sum::<f64>() / m.len() as f64;
    let (p, n) = spektrum(&m);
    let gesamt = band(&p, n, 20.0, 24000.0).max(1e-30);
    let hoch16 = band(&p, n, 16000.0, 24000.0);
    let hoch10 = band(&p, n, 10000.0, 24000.0);
    let letztes_aus = l.ereignisse.iter().filter(|e| !e.1).map(|e| e.0).max().unwrap_or(0);
    let nach: &[(f32, f32)] = &x[letztes_aus.min(x.len())..];
    let sek = |s: f64| (s * SR as f64) as usize;
    let fenster = |a: f64, b: f64| rms_von(&nach[sek(a).min(nach.len())..sek(b).min(nach.len())]);
    let denorm = x.iter().filter(|(a, b)| (*a != 0.0 && a.abs() < 1e-30) || (*b != 0.0 && b.abs() < 1e-30)).count();
    let dc_nach = if nach.len() > sek(1.0) { mono(&nach[sek(0.5)..]).iter().sum::<f64>() / (nach.len() - sek(0.5)) as f64 } else { 0.0 };
    let _ = nur_luft;
    let ber = bander(x);
    json!({
        "peak_db": 20.0 * (sp as f64).max(1e-9).log10(),
        "wahre_spitze_db": 20.0 * (wsp as f64).max(1e-9).log10(),
        "rms_db": rms_aktiv_db(x),
        "lufs": lufs(x),
        "dc": dc, "dc_nach_ende": dc_nach,
        "klicks": klicks(x, &l.ereignisse),
        "ueber16k_db": db(hoch16 / gesamt),
        "ueber10k_db": db(hoch10 / gesamt),
        "baender_db": ber,
        "nicht_endlich": l.rohe_nonfinite, "rettungen": l.rettungen, "denormal": denorm, "subnormal": x.iter().filter(|(a, b)| (*a != 0.0 && !a.is_normal()) || (*b != 0.0 && !b.is_normal())).count(), "kosten_je_sekunde": l.je_sekunde,
        "ende_rms_db": [fenster(0.0, 0.1), fenster(0.1, 0.5), fenster(0.5, 1.0), fenster(1.0, 2.0), fenster(2.0, 3.0), fenster(nach.len() as f64 / SR as f64 - 0.5, nach.len() as f64 / SR as f64)],
        "nach_ende_s": nach.len() as f64 / SR as f64,
        "stumm": sp < 1e-4,
        "dauer_s": x.len() as f64 / SR as f64,
    })
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() < 3 { eprintln!("usage: klang_pruefung MANIFEST.json OUT.json [--wav DIR]"); std::process::exit(2); }
    let faelle: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(&a[1]).unwrap()).unwrap();
    let wav = a.iter().position(|s| s == "--wav").map(|i| a[i + 1].clone());
    let mut aus: Vec<Value> = Vec::new();
    for f in &faelle {
        let name = f["name"].as_str().unwrap();
        let wurzel = f["wurzel"].as_str().map(std::path::PathBuf::from);
        let ph = f["phrase"].as_str().unwrap();
        let l1 = spiele(baue(f, &f["stifte"], wurzel.as_deref()), ph);
        let l2 = spiele(baue(f, &f["stifte"], wurzel.as_deref()), ph);
        let gleich = l1.x == l2.x;
        let mut r = messe(&l1, false);
        let kosten = l1.sek.min(l2.sek) / (l1.x.len() as f64 / SR as f64);
        r["name"] = json!(name);
        r["phrase"] = json!(ph);
        r["kosten_je_s"] = json!(kosten);
        r["deterministisch"] = json!(gleich);
        if let Some(v) = f.get("vergleich_stifte") {
            let vs = if v.as_str() == Some("default") { Value::Null } else { v.clone() };
            let ref_lauf = spiele(baue(f, &vs, wurzel.as_deref()), ph);
            let (b1, b0) = (bander(&l1.x), bander(&ref_lauf.x));
            let diff: Vec<f64> = b1.iter().zip(&b0).map(|(a, b)| a - b).collect();
            // broadband difference: RMS of (own - reference) against the RMS of own
            let n = l1.x.len().min(ref_lauf.x.len());
            let dl: Vec<(f32, f32)> = (0..n).map(|i| (l1.x[i].0 - ref_lauf.x[i].0, l1.x[i].1 - ref_lauf.x[i].1)).collect();
            r["pin_diff_baender_db"] = json!(diff);
            r["pin_diff_rest_db"] = json!(rms_von(&dl) - rms_von(&l1.x));
        }
        if let Some(d) = &wav {
            std::fs::create_dir_all(d).unwrap();
            schreibe_wav(&Path::new(d).join(format!("{name}.wav")), &l1.x);
        }
        eprintln!("{name}: peak {:.1} rms {:.1} cost {:.3}", r["peak_db"].as_f64().unwrap(), r["rms_db"].as_f64().unwrap(), kosten);
        aus.push(r);
    }
    std::fs::write(&a[2], serde_json::to_string_pretty(&aus).unwrap()).unwrap();
}

fn schreibe_wav(p: &Path, x: &[(f32, f32)]) {
    let mut b: Vec<u8> = Vec::new();
    let n = (x.len() * 4) as u32;
    b.extend(b"RIFF"); b.extend((36 + n).to_le_bytes()); b.extend(b"WAVEfmt "); b.extend(16u32.to_le_bytes());
    b.extend(1u16.to_le_bytes()); b.extend(2u16.to_le_bytes()); b.extend(48000u32.to_le_bytes()); b.extend(192000u32.to_le_bytes());
    b.extend(4u16.to_le_bytes()); b.extend(16u16.to_le_bytes()); b.extend(b"data"); b.extend(n.to_le_bytes());
    for (l, r) in x { for v in [l, r] { b.extend(((v.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()); } }
    std::fs::write(p, b).unwrap();
}
