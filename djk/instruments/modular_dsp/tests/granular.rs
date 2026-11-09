//! The `granular` block (type 36): grain count against density, pitch of every grain in cent, clicks at the grain edges,
//! position and freeze, determinism and robustness. Everything goes through the public JSON API, so the numbers are what a
//! graph plays. Every key check has a mutation that turns it red (`mutation_granular.py`, results in
//! `REPORT-granular.md`).
use baukasten_dsp::{uebersetze, Fehler, Programm, ARTEN};
use realfft::RealFftPlanner;

const SR: f32 = 48_000.0;

/// A graph with one granular node `g` (its values appended from `werte`) and extra nodes/edges; `l`/`r` go to the output.
fn graph(werte: &str, stimmen: usize, knoten: &str, kanten: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"gr","stimmen":{stimmen},"knoten":[{{"id":"g","art":"granular"{werte}}},{{"id":"o","art":"ausgang"}}{knoten}],"kanten":[{{"von":"g.l","nach":"o.l"}},{{"von":"g.r","nach":"o.r"}}{kanten}]}}"#
    )
}

/// The node recording the host input (`eingang.l` into `x`, source 1).
fn mit_eingang(werte: &str) -> String {
    graph(&format!(r#","quelle":1{werte}"#), 1, r#",{"id":"e","art":"eingang"}"#, r#",{"von":"e.l","nach":"g.x"}"#)
}

fn lade(g: &str) -> Programm { uebersetze(g, SR).unwrap_or_else(|e| panic!("{e}: {g}")) }

fn lauf(p: &mut Programm, n: usize) -> Vec<(f32, f32)> { (0..n).map(|_| p.sample_stereo()).collect() }

/// Runs an effect graph on `f(t)` (t in samples) as host input for `n` samples.
fn lauf_mit(p: &mut Programm, n: usize, f: impl Fn(usize) -> f64) -> Vec<(f32, f32)> {
    (0..n).map(|t| {
        let v = f(t) as f32;
        p.setze_eingang(v, v);
        p.sample_stereo()
    }).collect()
}

#[test]
fn granular_ist_art_36_mit_ein_und_ausgaengen() {
    // type 36: types are numbered in merge order; granular was merged after fm (35).
    let i = ARTEN.iter().position(|a| a.art == "granular").expect("ARTEN has no granular entry");
    assert_eq!(i, 36, "granular is type 36 (merge order), index {i} of {}", ARTEN.len());
    assert_eq!(ARTEN[32].art, "wavetable", "existing type numbers must not move");
    let a = &ARTEN[i];
    assert_eq!(a.ein, &["hz", "trig", "gate", "x", "groesse", "dichte", "pos", "pos_zufall", "tonhoehe", "ton_zufall", "breite", "fenster", "frieren"]);
    assert_eq!(a.aus, &["l", "r"]);
    assert!(a.werte.is_empty());
    for f in [("quelle", 0.0), ("tabelle", 0.0), ("puffer", 2.0), ("streuung", 0.0), ("saat", 0.0), ("gate", 1.0), ("groesse", 80.0), ("dichte", 20.0)] {
        assert!(a.frei.contains(&f), "{f:?}");
    }
}

#[test]
fn werte_werden_geprueft() {
    let ok = |v: &str| uebersetze(&graph(v, 1, "", ""), SR);
    for v in [r#","quelle":3"#, r#","quelle":0.5"#, r#","tabelle":7"#, r#","puffer":0.01"#, r#","puffer":11"#, r#","grund":10"#,
              r#","streuung":1.5"#, r#","saat":-1"#, r#","saat":70000"#, r#","hz":-1"#, r#","groesse":0.5"#, r#","groesse":2001"#,
              r#","dichte":-1"#, r#","dichte":1001"#, r#","pos":1.1"#, r#","pos_zufall":-0.1"#, r#","tonhoehe":49"#, r#","tonhoehe":-49"#,
              r#","ton_zufall":1201"#, r#","breite":2"#, r#","fenster":-0.5"#] {
        assert!(matches!(ok(v), Err(Fehler::Wert { .. })), "{v}: {:?}", ok(v).err());
    }
    for v in ["", r#","quelle":2"#, r#","quelle":1,"puffer":10"#, r#","tabelle":6"#, r#","groesse":1"#, r#","groesse":2000"#, r#","dichte":0"#,
              r#","dichte":1000"#, r#","tonhoehe":-48"#, r#","ton_zufall":1200"#, r#","fenster":1"#, r#","saat":65535"#, r#","streuung":1"#] {
        assert!(ok(v).is_ok(), "{v}: {:?}", ok(v).err());
    }
    assert!(matches!(ok(r#","fremd":1"#), Err(Fehler::UnbekannterWert { .. })));
}

// ---------------------------------------------------------------------------------------------------------------------
// Grain count

/// Grains of a sparse cloud: runs of non-zero samples separated by at least 8 exact zeros (between grains nothing sounds,
/// and a grain's first sample is exactly 0). Returns (start, end) of each run.
fn koerner(x: &[f32]) -> Vec<(usize, usize)> {
    let mut v = Vec::new();
    let (mut start, mut nullen) = (None, 0usize);
    for (i, s) in x.iter().enumerate() {
        if *s != 0.0 {
            if start.is_none() {
                start = Some(i);
            }
            nullen = 0;
        } else if let Some(a) = start {
            nullen += 1;
            if nullen >= 8 {
                v.push((a, i - nullen + 1));
                start = None;
            }
        }
    }
    if let Some(a) = start {
        v.push((a, x.len()));
    }
    v
}

#[test]
fn kornzahl_folgt_der_dichte() {
    // grains of 8 ms of a 440 Hz sine, densities up to an overlap of 0.6: every start is a separate run. In n samples the
    // node starts floor((n - 1) * dichte / sr) + 1 grains (the first at sample 0); a run cut off at the end still counts.
    for (dichte, stimmen) in [(3.0f64, 1usize), (17.0, 1), (41.5, 2), (75.0, 1)] {
        let g = graph(&format!(r#","tabelle":3,"hz":440,"groesse":8,"dichte":{dichte}"#), stimmen, "", "");
        let mut p = lade(&g);
        let n = 3 * SR as usize;
        let x: Vec<f32> = lauf(&mut p, n).iter().map(|v| v.0).collect();
        let ist = koerner(&x).len();
        // every voice plays its own cloud from the same clock, so the runs coincide: one run per start
        let soll = ((n - 1) as f64 * dichte / SR as f64).floor() as usize + 1;
        println!("MESS grain count {dichte}/s over 3 s ({stimmen} voices): {ist} grains, expected {soll}");
        assert_eq!(ist, soll, "density {dichte}");
        // every grain is 8 ms long (384 samples, minus the zero first sample)
        for (a, b) in koerner(&x).iter().take(ist - 1) {
            assert!((380..=384).contains(&(b - a)), "grain of {} samples", b - a);
        }
    }
}

#[test]
fn kornzahl_mit_streuung_und_trig() {
    // spread starts keep the mean count: 30/s over 10 s with streuung 1 gives 300 +- 10 %; a note's trig starts a grain at
    // once, even right after the previous one
    let g = graph(r#","tabelle":3,"hz":440,"groesse":5,"dichte":30,"streuung":1"#, 1, "", "");
    let mut p = lade(&g);
    let x: Vec<f32> = lauf(&mut p, 10 * SR as usize).iter().map(|v| v.0).collect();
    let n = koerner(&x).len();
    println!("MESS grain count with streuung 1, 30/s over 10 s: {n}");
    assert!((270..=330).contains(&n), "{n} grains, expected 300 +- 30");
    let g = graph(r#","tabelle":3,"groesse":5,"dichte":1"#, 1, r#",{"id":"n","art":"note"}"#, r#",{"von":"n.hz","nach":"g.hz"},{"von":"n.trig","nach":"g.trig"}"#);
    let mut p = lade(&g);
    p.note_an(69, 1.0);
    let mut x: Vec<f32> = lauf(&mut p, 4_800).iter().map(|v| v.0).collect();
    p.note_an(69, 1.0);
    x.extend(lauf(&mut p, 4_800).iter().map(|v| v.0));
    let k = koerner(&x);
    assert_eq!(k.len(), 2, "a new note must start a grain at once: {k:?}");
    assert!(k[1].0 <= 4_801, "the second grain started at {}", k[1].0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Pitch

/// Frequency from the rising zero crossings (linear interpolation) in the middle 80 % of a run.
fn frequenz(x: &[f32], sr: f32) -> f64 {
    let (a, b) = (x.len() / 10, x.len() - x.len() / 10);
    let mut nullen = Vec::new();
    for i in a + 1..b {
        if x[i - 1] < 0.0 && x[i] >= 0.0 {
            nullen.push(i as f64 - 1.0 + x[i - 1] as f64 / (x[i - 1] - x[i]) as f64);
        }
    }
    assert!(nullen.len() > 10, "too few zero crossings ({})", nullen.len());
    (nullen.len() - 1) as f64 / (nullen[nullen.len() - 1] - nullen[0]) * sr as f64
}

fn cent(ist: f64, soll: f64) -> f64 { 1200.0 * (ist / soll).log2() }

/// Pitch of every complete grain of `x` in cent against `soll` Hz.
fn korn_cent(x: &[f32], sr: f32, soll: f64) -> Vec<f64> {
    let k = koerner(x);
    k.iter().take(k.len().saturating_sub(1)).map(|(a, b)| cent(frequenz(&x[*a..*b], sr), soll)).collect()
}

/// Largest allowed pitch error of a grain: the wavetable step is a u32, the buffer read position an f64.
const CENT_GRENZE: f64 = 0.01;

#[test]
fn tonhoehe_je_korn_auf_hundertstel_cent_wavetable() {
    let mut schlimmst = 0.0f64;
    for sr in [44_100.0f32, 48_000.0, 96_000.0] {
        for hz in [55.0f64, 261.6256, 440.0, 1760.0, 4186.0] {
            for st in [-12.0f64, 0.0, 7.0, 19.0] {
                let soll = hz * (st / 12.0).exp2();
                if soll > 0.45 * sr as f64 {
                    continue;
                }
                // 1 s grains: at least 20 periods in the middle 80 % down to 27.5 Hz
                let g = graph(&format!(r#","tabelle":3,"hz":{hz},"tonhoehe":{st},"groesse":1000,"dichte":0.7"#), 1, "", "");
                let mut p = uebersetze(&g, sr).unwrap();
                let x: Vec<f32> = (0..4 * sr as usize).map(|_| p.sample_stereo().0).collect();
                let c = korn_cent(&x, sr, soll);
                assert!(c.len() >= 2, "too few grains");
                let m = c.iter().fold(0.0f64, |m, v| m.max(v.abs()));
                println!("MESS pitch wavetable sr {sr} {hz:8.2} Hz {st:+} st: worst grain {m:.6} cent over {} grains", c.len());
                schlimmst = schlimmst.max(m);
            }
        }
    }
    assert!(schlimmst < CENT_GRENZE, "pitch error {schlimmst:.5} cent, limit {CENT_GRENZE}");
}

#[test]
fn tonhoehe_je_korn_auf_hundertstel_cent_puffer() {
    // a 440 Hz sine (f64) recorded from the host input, read at hz / grund * 2^(st/12)
    let mut schlimmst = 0.0f64;
    for (hz, st) in [(440.0f64, 0.0f64), (440.0, 7.0), (440.0, -12.0), (440.0, 12.0), (330.0, 0.0), (523.2511, 5.0), (440.0, -24.0)] {
        let g = mit_eingang(&format!(r#","grund":440,"hz":{hz},"tonhoehe":{st},"groesse":300,"dichte":2,"pos":0.2,"puffer":1"#));
        let mut p = lade(&g);
        let w = 2.0 * std::f64::consts::PI * 440.0 / SR as f64;
        let x: Vec<f32> = lauf_mit(&mut p, 3 * SR as usize, |t| 0.5 * (w * t as f64).sin()).iter().skip(SR as usize).map(|v| v.0).collect();
        let soll = 440.0 * hz / 440.0 * (st / 12.0).exp2();
        let c = korn_cent(&x, SR, soll);
        assert!(c.len() >= 2);
        let m = c.iter().fold(0.0f64, |m, v| m.max(v.abs()));
        println!("MESS pitch buffer {hz} Hz {st:+} st (expected {soll:.3} Hz): worst grain {m:.6} cent over {} grains", c.len());
        schlimmst = schlimmst.max(m);
    }
    assert!(schlimmst < CENT_GRENZE, "pitch error {schlimmst:.5} cent, limit {CENT_GRENZE}");
}

#[test]
fn tonhoehen_zufall_bleibt_im_bereich_und_streut() {
    // ton_zufall 50 cent: every grain within +-50 cent of the target, the spread is used (uniform: sd 50 / sqrt(3) = 28.9)
    let g = graph(r#","tabelle":3,"hz":440,"tonhoehe":3,"ton_zufall":50,"groesse":100,"dichte":8"#, 1, "", "");
    let mut p = lade(&g);
    let x: Vec<f32> = lauf(&mut p, 20 * SR as usize).iter().map(|v| v.0).collect();
    let c = korn_cent(&x, SR, 440.0 * (3.0f64 / 12.0).exp2());
    let n = c.len() as f64;
    let mittel = c.iter().sum::<f64>() / n;
    let sd = (c.iter().map(|v| (v - mittel).powi(2)).sum::<f64>() / n).sqrt();
    let m = c.iter().fold(0.0f64, |m, v| m.max(v.abs()));
    println!("MESS pitch jitter 50 cent: {} grains, largest {m:.3} cent, mean {mittel:+.3}, sd {sd:.3}", c.len());
    assert!(m <= 50.0 + CENT_GRENZE, "a grain lies {m} cent off, jitter is 50");
    assert!((20.0..38.0).contains(&sd), "spread sd {sd}, expected about 28.9");
    assert!(mittel.abs() < 6.0, "mean {mittel}");
}

// ---------------------------------------------------------------------------------------------------------------------
// Clicks

/// Energy above `ab` Hz over the total energy, in dB (Hann-windowed FFT of 2^17 samples after 0.5 s). A grain edge with a
/// jump in value spreads energy over the whole spectrum (6 dB per octave). The sources here are sines of 110 Hz, so the
/// windowed grains themselves have little up there: a raised cosine edge of `e` seconds has its main lobe within 1 / e and
/// falls 18 dB per octave beyond; `ab` is at least 12 / e, where that tail is near -90 dB (measured: at 8 / e it is
/// -80 dB, too close to the limit).
fn hf_db(x: &[f32], ab: f64) -> f64 {
    const N: usize = 1 << 17;
    let mut y: Vec<f64> = x[24_000..24_000 + N].iter().enumerate()
        .map(|(i, v)| *v as f64 * (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / N as f64).cos())).collect();
    let mut fft = RealFftPlanner::<f64>::new();
    let r2c = fft.plan_fft_forward(N);
    let mut s = r2c.make_output_vec();
    r2c.process(&mut y, &mut s).unwrap();
    let grenze = (ab * N as f64 / SR as f64) as usize;
    let (mut hoch, mut summe) = (0.0f64, 0.0f64);
    for (b, c) in s.iter().enumerate() {
        summe += c.norm_sqr();
        if b >= grenze {
            hoch += c.norm_sqr();
        }
    }
    10.0 * (hoch / summe).max(1e-30).log10()
}

/// No click: high-band energy at or below this.
const KLICK_GRENZE_DB: f64 = -80.0;

#[test]
fn keine_klicks_an_den_kornraendern() {
    let n = 24_000 + (1 << 17);
    let mut schlimmst = (f64::NEG_INFINITY, String::new());
    let mut pruefe = |name: &str, ab: f64, x: Vec<(f32, f32)>| {
        let l: Vec<f32> = x.iter().map(|v| v.0).collect();
        let r: Vec<f32> = x.iter().map(|v| v.1).collect();
        assert!(l.iter().any(|v| v.abs() > 0.05), "{name}: silent");
        let db = hf_db(&l, ab).max(hf_db(&r, ab));
        println!("MESS clicks {name}: energy above {ab} Hz {db:.1} dB");
        if db > schlimmst.0 {
            schlimmst = (db, name.to_string());
        }
    };
    // wavetable sine: Hann, nearly rectangular (5 % edges = 2.5 ms), short grains (1 ms edges), a full pool (overlap
    // 40 > 16), spread starts (edges 6 ms and more)
    for (name, ab, werte) in [
        ("hann", 3_000.0, r#","groesse":50,"dichte":30"#),
        ("fenster 1", 4_800.0, r#","groesse":50,"dichte":30,"fenster":1"#),
        ("short grains", 12_000.0, r#","groesse":4,"dichte":150,"fenster":1"#),
        ("full pool", 3_000.0, r#","groesse":100,"dichte":400,"breite":1,"pos_zufall":1"#),
        ("spread starts", 3_000.0, r#","groesse":30,"dichte":60,"streuung":1,"fenster":0.5"#),
    ] {
        let mut p = lade(&graph(&format!(r#","tabelle":3,"hz":110{werte}"#), 1, "", ""));
        pruefe(name, ab, lauf(&mut p, n));
    }
    // buffer source on a 110 Hz sine: reading at 2x from the newest sample (would overtake the write head), at 1/2x from
    // the oldest (would fall behind the buffer), and on a frozen buffer at 2x
    let w = 2.0 * std::f64::consts::PI * 110.0 / SR as f64;
    for (name, werte) in [
        ("buffer +12 st at pos 0", r#","tonhoehe":12,"pos":0,"groesse":200,"dichte":12,"puffer":0.5"#),
        // pos 0.2 is 4800 samples back: unclamped, a 2x grain of 9600 samples would cross the write head at its centre
        ("buffer +12 st at pos 0.2", r#","tonhoehe":12,"pos":0.2,"groesse":200,"dichte":12,"puffer":0.5"#),
        ("buffer -12 st at pos 1", r#","tonhoehe":-12,"pos":1,"groesse":200,"dichte":12,"puffer":0.5"#),
        ("frozen buffer +12 st", r#","tonhoehe":12,"pos":0.1,"pos_zufall":0.1,"groesse":200,"dichte":12,"puffer":0.5,"frieren":1"#),
    ] {
        let mut p = lade(&mit_eingang(werte));
        // the frozen buffer is filled by a first unfrozen load of the same sine, then frozen by a knob
        if werte.contains("frieren") {
            let g = mit_eingang(&werte.replace(r#","frieren":1"#, ""))
                .replace(r#"{"id":"o","art":"ausgang"}"#, r#"{"id":"o","art":"ausgang"},{"id":"k","art":"regler","nr":1,"min":0,"max":1}"#)
                .replace(r#"{"von":"e.l","nach":"g.x"}"#, r#"{"von":"e.l","nach":"g.x"},{"von":"k.aus","nach":"g.frieren"}"#);
            p = lade(&g);
            p.setze_regler(1, 0.0);
            lauf_mit(&mut p, 48_000, |t| 0.5 * (w * t as f64).sin());
            p.setze_regler(1, 1.0);
        }
        // the input runs on, frozen or not; before 1 s the buffer still holds its initial zeros, so skip that
        lauf_mit(&mut p, 24_000, |t| 0.5 * (w * t as f64).sin());
        pruefe(name, 3_000.0, lauf_mit(&mut p, n, |t| 0.5 * (w * (t + 24_000) as f64).sin()));
    }
    assert!(schlimmst.0 <= KLICK_GRENZE_DB, "{}: {:.1} dB in the high band, limit {KLICK_GRENZE_DB} dB", schlimmst.1, schlimmst.0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Position and freeze

#[test]
fn position_waehlt_die_stelle_im_puffer() {
    // input +0.5 for the first second, -0.5 for the second, then grains at 2.0 s: pos 0.75 of a 2 s buffer reads 1.5 s
    // back (+), pos 0.25 reads 0.5 s back (-); a jitter of 0.1 (0.2 s) stays inside each half
    for (pos, vorzeichen) in [(0.75f32, 1.0f32), (0.25, -1.0)] {
        let mut p = lade(&mit_eingang(&format!(r#","pos":{pos},"pos_zufall":0.1,"groesse":20,"dichte":100,"puffer":2"#)));
        lauf_mit(&mut p, 96_000, |t| if t < 48_000 { 0.5 } else { -0.5 });
        let y = lauf_mit(&mut p, 4_800, |_| 0.0);
        let summe: f32 = y.iter().map(|v| v.0).sum();
        let falsch = y.iter().filter(|v| v.0 * vorzeichen < 0.0).count();
        println!("MESS position {pos}: sum {summe:.2}, samples of the wrong sign {falsch}");
        assert!(summe * vorzeichen > 10.0 && falsch == 0, "pos {pos}: sum {summe}, wrong sign {falsch}");
    }
}

#[test]
fn position_vor_dem_fuellen() {
    // a 4 s buffer after 0.3 s of input: pos 1 means the oldest recorded sample, not 4 s back into silence
    let mut p = lade(&mit_eingang(r#","pos":1,"groesse":50,"dichte":60,"puffer":4"#));
    let y = lauf_mit(&mut p, 14_400, |t| 0.5 * (t as f64 * 0.05).sin());
    let leistung = y[4_800..].iter().map(|v| v.0 * v.0).sum::<f32>() / 9_600.0;
    println!("MESS position 1 in a 4 s buffer after 0.1..0.3 s of input: power {leistung:.3e}");
    assert!(leistung > 1e-3, "grains read the unrecorded part of the buffer ({leistung})");
}

#[test]
fn frieren_haelt_den_puffer() {
    // record 1 s of sine, then silence: unfrozen the grains reach silence once the buffer has passed, frozen they keep
    // sounding the sine
    let pegel = |frieren: bool| {
        let g = mit_eingang(r#","pos":0.5,"pos_zufall":0.4,"groesse":50,"dichte":40,"puffer":0.5"#)
            .replace(r#"{"id":"o","art":"ausgang"}"#, r#"{"id":"o","art":"ausgang"},{"id":"k","art":"regler","nr":1,"min":0,"max":1}"#)
            .replace(r#"{"von":"e.l","nach":"g.x"}"#, r#"{"von":"e.l","nach":"g.x"},{"von":"k.aus","nach":"g.frieren"}"#);
        let mut p = lade(&g);
        p.setze_regler(1, 0.0);
        lauf_mit(&mut p, 48_000, |t| 0.5 * (t as f64 * 0.05).sin());
        p.setze_regler(1, if frieren { 1.0 } else { 0.0 });
        let y = lauf_mit(&mut p, 96_000, |_| 0.0);
        y[48_000..].iter().map(|v| v.0 * v.0).sum::<f32>() / 48_000.0
    };
    let (an, aus) = (pegel(true), pegel(false));
    println!("MESS freeze: power 1..2 s after the input stopped: frozen {an:.3e}, unfrozen {aus:.3e}");
    assert!(an > 1e-3, "frozen buffer is silent ({an})");
    assert_eq!(aus, 0.0, "unfrozen buffer must have run empty");
}

#[test]
fn frieren_haelt_die_wavetable_position() {
    // `analog` table, position on a knob: frozen at 0 (sine), the knob going to 1 (square) must not change the sound
    let g = graph(r#","tabelle":4,"hz":220,"groesse":40,"dichte":50"#, 1,
                  r#",{"id":"k","art":"regler","nr":1,"min":0,"max":1},{"id":"f","art":"regler","nr":2,"min":0,"max":1}"#,
                  r#",{"von":"k.aus","nach":"g.pos"},{"von":"f.aus","nach":"g.frieren"}"#);
    let hell = |frieren: f32| {
        let mut p = lade(&g);
        p.setze_regler(1, 0.0);
        p.setze_regler(2, frieren);
        lauf(&mut p, 4_800);
        p.setze_regler(1, 1.0);
        let x: Vec<f32> = lauf(&mut p, 48_000).iter().skip(4_800).map(|v| v.0).collect();
        let d: f32 = x.windows(2).map(|w| (w[1] - w[0]).powi(2)).sum();
        d / x.iter().map(|v| v * v).sum::<f32>()
    };
    let (an, aus) = (hell(1.0), hell(0.0));
    // the brightness (difference energy over energy) of a 220 Hz sine is (2 pi 220 / 48000)^2 = 8.3e-4
    println!("MESS wavetable freeze: brightness frozen {an:.3e}, unfrozen {aus:.3e}");
    assert!(an < 1.2e-3, "frozen at the sine, but brightness {an}");
    assert!(aus > 5.0 * an, "control: the unfrozen knob move must brighten ({aus})");
}

// ---------------------------------------------------------------------------------------------------------------------
// Determinism and robustness

fn spiel(g: &str) -> Vec<(f32, f32)> {
    let mut p = lade(g);
    let mut x = Vec::new();
    for (i, n) in [57u8, 60, 64, 57].iter().enumerate() {
        p.note_an(*n, 0.9);
        x.extend(lauf(&mut p, 6_000));
        if i % 2 == 1 {
            p.note_aus(*n);
        }
    }
    x
}

#[test]
fn gleiche_saat_gleicher_klang_andere_saat_anderer_klang() {
    for quelle in [0, 2] {
        let mit = |saat: u32| graph(&format!(r#","quelle":{quelle},"groesse":60,"dichte":90,"streuung":0.5,"pos_zufall":0.5,"ton_zufall":30,"breite":0.8,"saat":{saat}"#), 4,
                                    r#",{"id":"n","art":"note"}"#, r#",{"von":"n.hz","nach":"g.hz"},{"von":"n.trig","nach":"g.trig"},{"von":"n.gate","nach":"g.gate"}"#);
        let (a, b) = (spiel(&mit(7)), spiel(&mit(7)));
        let ungleich = a.iter().zip(&b).filter(|(x, y)| x.0.to_bits() != y.0.to_bits() || x.1.to_bits() != y.1.to_bits()).count();
        assert_eq!(ungleich, 0, "source {quelle}: {ungleich} samples differ between two loads of the same graph");
        assert!(a.iter().any(|v| v.0.abs() > 0.01), "source {quelle}: silent");
        let c = spiel(&mit(8));
        let anders = a.iter().zip(&c).filter(|(x, y)| x.0 != y.0).count();
        println!("MESS determinism source {quelle}: seed 7 twice bit-identical, seed 8 differs in {anders} of {} samples", a.len());
        assert!(anders > a.len() / 2, "another seed must give another cloud");
    }
}

#[test]
fn unsinnige_eingaenge_bleiben_endlich() {
    // two knobs over +-1e30 multiply to +-inf or to large finite values; times 0 the infinities become NaN. Every input of
    // the node gets one of them: the output stays finite and the guard never has to rescue the graph. A second variant
    // feeds them to `x` alone, with everything else fixed, so grains really read what the buffer recorded.
    let alle = r#",{{"von":"k1.aus","nach":"m.a"}},{{"von":"k2.aus","nach":"m.b"}},{{"von":"m.aus","nach":"nan.a"}},{{"von":"m.aus","nach":"g.hz"}},{{"von":"nan.aus","nach":"g.x"}},{{"von":"m.aus","nach":"g.groesse"}},{{"von":"nan.aus","nach":"g.dichte"}},{{"von":"m.aus","nach":"g.pos"}},{{"von":"nan.aus","nach":"g.pos_zufall"}},{{"von":"m.aus","nach":"g.tonhoehe"}},{{"von":"nan.aus","nach":"g.ton_zufall"}},{{"von":"m.aus","nach":"g.breite"}},{{"von":"nan.aus","nach":"g.fenster"}},{{"von":"m.aus","nach":"g.frieren"}},{{"von":"m.aus","nach":"g.trig"}}"#;
    let alle = alle.replace("{{", "{").replace("}}", "}");
    // x = k1 + m * 0: NaN where m is infinite, else k1 (+-1e30, recorded clamped to +-8, or 0 at the knob centre)
    let nur_x = r#",{"von":"k1.aus","nach":"m.a"},{"von":"k2.aus","nach":"m.b"},{"von":"m.aus","nach":"nan.a"},{"von":"k1.aus","nach":"a.a"},{"von":"nan.aus","nach":"a.b"},{"von":"a.aus","nach":"g.x"}"#;
    for (quelle, kanten) in [(0, alle.as_str()), (1, alle.as_str()), (2, alle.as_str()), (1, nur_x)] {
        let g = graph(&format!(r#","quelle":{quelle},"puffer":0.1,"dichte":200"#), 1,
                      r#",{"id":"k1","art":"regler","nr":1,"min":-1e30,"max":1e30},{"id":"k2","art":"regler","nr":2,"min":-1e30,"max":1e30},{"id":"m","art":"mul"},{"id":"nan","art":"mul","b":0},{"id":"a","art":"add"}"#,
                      kanten);
        let mut p = lade(&g);
        let mut gehoert = false;
        for (a, b) in [(1.0, 1.0), (0.0, 1.0), (1.0, 0.5), (0.5, 0.5), (0.500_001, 0.500_001), (0.499_999, 0.500_001), (1.0, 1.0)] {
            p.setze_regler(1, a);
            p.setze_regler(2, b);
            for (l, r) in lauf(&mut p, 2_000) {
                assert!(l.is_finite() && r.is_finite(), "source {quelle}");
                gehoert |= l != 0.0;
            }
        }
        assert_eq!(p.rettungen, 0, "source {quelle}: the guard had to rescue the graph");
        if kanten == nur_x {
            assert!(gehoert, "positive control: the x-only variant must play grains of what was recorded");
        }
    }
}

#[test]
fn ohne_note_still() {
    // voices that never played have hz 0: no grain, no DC bumps from a table read at a standing phase
    let g = graph(r#","groesse":30,"dichte":100"#, 4, r#",{"id":"n","art":"note"}"#, r#",{"von":"n.hz","nach":"g.hz"}"#);
    let mut p = lade(&g);
    assert!(lauf(&mut p, 9_600).iter().all(|v| v.0 == 0.0 && v.1 == 0.0));
    p.note_an(60, 1.0);
    assert!(lauf(&mut p, 9_600).iter().any(|v| v.0.abs() > 0.01));
}

#[test]
fn zuruecksetzen_gleich_frisch_alle_quellen() {
    // the same as `arten.rs` (which uses the recording source), for every source: run, reset, play again = a fresh load.
    // Covers the ring buffer (cleared, or refilled with the same noise), the noise generator and the write head.
    for quelle in [0, 1, 2] {
        let g = graph(&format!(r#","quelle":{quelle},"puffer":0.3,"groesse":40,"dichte":80,"pos":0.5,"pos_zufall":1,"ton_zufall":50,"streuung":1"#), 2,
                      r#",{"id":"n","art":"note"},{"id":"s","art":"saege"}"#,
                      r#",{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"g.x"},{"von":"n.hz","nach":"g.hz"},{"von":"n.trig","nach":"g.trig"}"#);
        let (mut frisch, mut benutzt) = (lade(&g), lade(&g));
        let _ = spiel_auf(&mut benutzt);
        benutzt.zuruecksetzen();
        let (soll, ist) = (spiel_auf(&mut frisch), spiel_auf(&mut benutzt));
        let ungleich = soll.iter().zip(&ist).filter(|(a, b)| a.0.to_bits() != b.0.to_bits() || a.1.to_bits() != b.1.to_bits()).count();
        assert!(soll.iter().any(|v| v.0.abs() > 0.01), "source {quelle}: silent");
        assert_eq!(ungleich, 0, "source {quelle}: {ungleich} samples differ after zuruecksetzen");
    }
}

fn spiel_auf(p: &mut Programm) -> Vec<(f32, f32)> {
    let mut x = Vec::new();
    for n in [45u8, 52, 57] {
        p.note_an(n, 0.9);
        x.extend(lauf(p, 8_000));
    }
    x
}
