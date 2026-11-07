//! The 46 recipe patches (`beispiele/rezepte/*.json`, built by `rezepte/baue_rezepte.py` from `rezepte/RECIPES.md`).
//!
//!  * every patch in the manifest loads, plays its probe (a 4-note chord, or one note for mono patches and drums) for 2 s at
//!    48 kHz without NaN, infinity, rescue or a sample above 0 dBFS, and peaks within `PEGEL_FENSTER` (level-matched),
//!  * voice use: at most 16 voices, mono patches have one, a poly patch gives every chord note its own voice,
//!  * every knob at 0 and at 1 stays finite without rescue,
//!  * one measurable check per card (`PRUEFUNGEN`), each with the card's number and its window,
//!  * the key checks turn red under a mutation that removes the property (`MUTATIONEN`),
//!  * bright against dark pairs by spectral centroid.
//!
//! `cargo test --release -p baukasten_dsp --test rezepte -- --nocapture` prints every measured value (`MESS ...`) and a
//! `MESS_PEGEL name trim` line per patch that `baue_rezepte.py --pegel` reads to level-match the patches.
use baukasten_dsp::{uebersetze_mit_wurzel, Programm, MAX_STIMMEN, REGLER};
use realfft::RealFftPlanner;
use serde_json::Value;
use std::path::{Path, PathBuf};

const SR: f32 = 48_000.0;
/// peak of the probe render in dBFS: every patch must land inside (target -6 dBFS)
const PEGEL_FENSTER: (f32, f32) = (-7.5, -4.5);

fn verzeichnis() -> PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("beispiele/rezepte") }

fn manifest() -> Value {
    serde_json::from_str(&std::fs::read_to_string(verzeichnis().join("MANIFEST.json")).expect("MANIFEST.json")).unwrap()
}

/// (manifest entry, graph text) for every patch
fn patches() -> Vec<(Value, String)> {
    let m = manifest();
    let v: Vec<(Value, String)> = m["patches"].as_array().unwrap().iter()
        .map(|e| (e.clone(), std::fs::read_to_string(verzeichnis().join(e["datei"].as_str().unwrap())).unwrap()))
        .collect();
    assert_eq!(v.len(), 46, "46 cards, 46 patches");
    v
}

fn json_von(karte: &str) -> String {
    patches().into_iter().find(|(e, _)| e["karte"] == karte).unwrap_or_else(|| panic!("no patch for {karte}")).1
}

/// the sample root: the spring IR of fx-texture (generated, nothing is stored in the repo)
fn wurzel() -> PathBuf {
    static W: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    W.get_or_init(|| {
        let w = std::env::temp_dir().join(format!("bk-rezepte-{}", std::process::id()));
        std::fs::create_dir_all(&w).unwrap();
        std::fs::write(w.join("feder-ir.f32"), baukasten_dsp::proben::bytes(&baukasten_dsp::proben::feder_ir(48_000.0))).unwrap();
        w
    }).clone()
}

fn lade(json: &str) -> Programm { uebersetze_mit_wurzel(json, SR, Some(&wurzel())).unwrap_or_else(|e| panic!("{e}")) }

/// How a check plays a patch: notes held from 0 for `sekunden` (released at `aus` if set), knobs at 0.5 except `regler`.
#[derive(Clone)]
struct Spiel {
    noten: Vec<u8>,
    sekunden: f32,
    vel: f32,
    aus: Option<f32>,
    regler: Vec<(usize, f32)>,
}

fn probe_von(e: &Value) -> Spiel {
    let p = &e["probe"];
    Spiel {
        noten: p["noten"].as_array().unwrap().iter().map(|n| n.as_u64().unwrap() as u8).collect(),
        sekunden: 2.0,
        vel: 0.8,
        aus: None,
        regler: vec![],
    }
}

fn spiele_programm(p: &mut Programm, s: &Spiel) -> Vec<(f32, f32)> {
    p.setze_takt(0.0, 2.0 / SR as f64); // 120 BPM
    for nr in 1..=REGLER { p.setze_regler(nr, 0.5); }
    for (nr, w) in &s.regler { p.setze_regler(*nr, *w); }
    for n in &s.noten { p.note_an(*n, s.vel); }
    let n = (s.sekunden * SR) as usize;
    let aus = s.aus.map(|t| (t * SR) as usize);
    (0..n).map(|i| {
        if Some(i) == aus { p.alle_aus(); }
        p.sample_stereo()
    }).collect()
}

fn spiele(json: &str, s: &Spiel) -> Vec<f32> {
    let mut p = lade(json);
    let y = spiele_programm(&mut p, s);
    assert_eq!(p.rettungen, 0, "{}: rescued", p.name);
    y.iter().map(|(l, r)| 0.5 * (l + r)).collect()
}

/// knob number of the regler node `id` in the graph
fn knopf(json: &str, id: &str) -> usize {
    let g: Value = serde_json::from_str(json).unwrap();
    g["knoten"].as_array().unwrap().iter().find(|k| k["id"] == id).unwrap_or_else(|| panic!("no node {id}"))["nr"].as_u64().unwrap() as usize
}

// ---------------------------------------------------------------------------------------------------- measurements

fn sek(t: f32) -> usize { (t * SR) as usize }

fn stueck(x: &[f32], von: f32, bis: f32) -> &[f32] { &x[sek(von).min(x.len())..sek(bis).min(x.len())] }

fn rms(x: &[f32]) -> f64 { (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len().max(1) as f64).sqrt() }

fn db(v: f64) -> f64 { 20.0 * v.max(1e-12).log10() }

/// power spectrum with a Hann window, zero-padded to a power of two (bins of sr / n)
fn spektrum(x: &[f32]) -> (Vec<f64>, f64) {
    let n = x.len().next_power_of_two().max(1024);
    let mut planer = RealFftPlanner::<f64>::new();
    let fft = planer.plan_fft_forward(n);
    let mut ein = fft.make_input_vec();
    let m = x.len();
    for (i, v) in x.iter().enumerate() {
        ein[i] = *v as f64 * (0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / m as f64).cos());
    }
    let mut aus = fft.make_output_vec();
    fft.process(&mut ein, &mut aus).unwrap();
    (aus.iter().map(|c| c.norm_sqr()).collect(), SR as f64 / n as f64)
}

fn band(sp: &(Vec<f64>, f64), lo: f64, hi: f64) -> f64 {
    let (p, df) = sp;
    let (a, b) = (((lo / df).ceil() as usize).min(p.len()), ((hi / df).floor() as usize + 1).min(p.len()));
    p[a..b.max(a)].iter().sum()
}

/// spectral centroid in Hz between 20 Hz and 16 kHz
fn schwerpunkt(x: &[f32]) -> f64 {
    let sp = spektrum(x);
    let (p, df) = &sp;
    let (a, b) = ((20.0 / df) as usize, ((16_000.0 / df) as usize).min(p.len()));
    let (mut s, mut sf) = (0.0, 0.0);
    for (k, v) in p.iter().enumerate().take(b).skip(a) {
        s += v;
        sf += v * k as f64 * df;
    }
    sf / s.max(1e-30)
}

/// brightness: RMS of the first difference over the RMS (rises with the share of high frequencies)
fn hell(x: &[f32]) -> f64 { rms(&x.windows(2).map(|w| w[1] - w[0]).collect::<Vec<_>>()) / rms(x).max(1e-12) }

/// RMS level in dB per window of `ms`
fn huelle(x: &[f32], ms: f32) -> Vec<f64> { x.chunks(sek(ms / 1000.0).max(1)).map(|c| db(rms(c))).collect() }

/// seconds from the loudest 2 ms window until the level is `tiefe` dB below it (and stays below for 10 ms)
fn abklingzeit(x: &[f32], tiefe: f64) -> f64 {
    let h = huelle(x, 2.0);
    let (ip, p) = h.iter().enumerate().fold((0, -400.0), |m, (i, v)| if *v > m.1 { (i, *v) } else { m });
    for i in ip..h.len() {
        if h[i..(i + 5).min(h.len())].iter().all(|v| *v < p - tiefe) {
            return (i - ip) as f64 * 0.002;
        }
    }
    f64::INFINITY
}

/// pitch in Hz by YIN (cumulative mean normalised difference, threshold 0.2, parabolic refinement), 30..2000 Hz
fn tonhoehe(x: &[f32]) -> f64 { tonhoehe_in(x, 30.0, 2000.0) }

/// YIN pitch searched between `lo` and `hi` Hz
fn tonhoehe_in(x: &[f32], lo: f32, hi: f32) -> f64 {
    let (tmin, tmax) = ((SR / hi) as usize, (SR / lo) as usize);
    let w = x.len() - tmax.min(x.len() / 2);
    let tmax = tmax.min(x.len() / 2);
    let mut d = vec![0.0f64; tmax + 1];
    for t in 1..=tmax {
        d[t] = (0..w).map(|i| (x[i] as f64 - x[i + t] as f64).powi(2)).sum();
    }
    let mut summe = 0.0;
    let mut dn = vec![1.0f64; tmax + 1];
    for t in 1..=tmax {
        summe += d[t];
        dn[t] = d[t] * t as f64 / summe.max(1e-30);
    }
    let mut best = (tmin..tmax).min_by(|a, b| dn[*a].partial_cmp(&dn[*b]).unwrap()).unwrap();
    if let Some(t) = (tmin..tmax).find(|&t| dn[t] < 0.2) {
        let mut t = t;
        while t + 1 < tmax && dn[t + 1] < dn[t] { t += 1; }
        best = t;
    }
    let (a, b, c) = (dn[best - 1], dn[best], dn[best + 1]);
    let versatz = if a + c - 2.0 * b != 0.0 { 0.5 * (a - c) / (a + c - 2.0 * b) } else { 0.0 };
    SR as f64 / (best as f64 + versatz.clamp(-1.0, 1.0))
}

/// frequency of the cycle around time `t` from the rising zero crossings (for clean sine bodies: kick, impact)
fn zyklus_hz(x: &[f32], t: f32) -> f64 {
    let n: Vec<f64> = x.windows(2).enumerate().filter(|(_, w)| w[0] < 0.0 && w[1] >= 0.0)
        .map(|(i, w)| i as f64 + (-w[0] / (w[1] - w[0])) as f64).collect();
    let z = t as f64 * SR as f64;
    let i = n.windows(2).position(|p| p[1] >= z).unwrap_or(n.len().saturating_sub(2));
    SR as f64 / (n[i + 1] - n[i])
}

/// amplitude of frequency `f` (Hann-windowed single DFT bin)
fn goertzel(x: &[f32], f: f64) -> f64 {
    let m = x.len();
    let w = 2.0 * std::f64::consts::PI * f / SR as f64;
    let (mut re, mut im) = (0.0, 0.0);
    for (i, v) in x.iter().enumerate() {
        let h = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / m as f64).cos();
        re += *v as f64 * h * (w * i as f64).cos();
        im += *v as f64 * h * (w * i as f64).sin();
    }
    (re * re + im * im).sqrt() / m as f64
}

/// the strongest spectral peak between `lo` and `hi` Hz: (frequency, dB over the median of the octave around it), on a
/// spectrum smoothed over 7 bins (so a single noise bin does not count as a peak)
fn prominenz(x: &[f32], lo: f64, hi: f64) -> (f64, f64) {
    let (p, df) = spektrum(x);
    let g: Vec<f64> = (0..p.len()).map(|i| p[i.saturating_sub(3)..(i + 4).min(p.len())].iter().sum::<f64>() / 7.0).collect();
    let (a, b) = ((lo / df) as usize, ((hi / df) as usize).min(g.len()));
    let i = (a..b).max_by(|x, y| g[*x].partial_cmp(&g[*y]).unwrap()).unwrap();
    let mut umfeld: Vec<f64> = g[i / 2..(2 * i).min(g.len())].to_vec();
    umfeld.sort_by(|x, y| x.partial_cmp(y).unwrap());
    (i as f64 * df, 10.0 * (g[i] / umfeld[umfeld.len() / 2]).log10())
}

/// mean of a series
fn mittel(v: &[f64]) -> f64 { v.iter().sum::<f64>() / v.len().max(1) as f64 }

/// modulation depth (max - min) / (max + min) of a series
fn tiefe(v: &[f64]) -> f64 {
    let (lo, hi) = v.iter().fold((f64::MAX, f64::MIN), |m, x| (m.0.min(*x), m.1.max(*x)));
    (hi - lo) / (hi + lo).max(1e-30)
}

/// amplitude of `f` in Hann windows of `ms`, hop `ms / 2`
fn linie_ueber_zeit(x: &[f32], f: f64, ms: f32) -> Vec<f64> {
    let n = sek(ms / 1000.0);
    (0..).map(|i| i * n / 2).take_while(|a| a + n <= x.len()).map(|a| goertzel(&x[a..a + n], f)).collect()
}

/// strongest frequency of a series sampled every `dt` seconds, searched in `lo..hi` Hz
fn rate_der_reihe(v: &[f64], dt: f64, lo: f64, hi: f64) -> f64 {
    let mittel = v.iter().sum::<f64>() / v.len() as f64;
    let mut best = (0.0, 0.0);
    let mut f = lo;
    while f <= hi {
        let w = 2.0 * std::f64::consts::PI * f * dt;
        let (re, im) = v.iter().enumerate().fold((0.0, 0.0), |a, (i, x)| (a.0 + (x - mittel) * (w * i as f64).cos(), a.1 + (x - mittel) * (w * i as f64).sin()));
        let m = re * re + im * im;
        if m > best.1 { best = (f, m); }
        f += 0.05;
    }
    best.0
}

fn hz(note: u8) -> f64 { 440.0 * 2f64.powf((note as f64 - 69.0) / 12.0) }

// ---------------------------------------------------------------------------------------------------- mutations

#[derive(Clone, Copy, Debug)]
enum Mut {
    /// set a value of a node
    Wert(&'static str, &'static str, f64),
    /// pin a knob: min = max = value, linear
    Knopf(&'static str, f64),
    /// change the block type of a node
    Art(&'static str, &'static str),
    /// remove the edge into "knoten.port"
    KanteWeg(&'static str),
}

fn knoten_mut<'a>(g: &'a mut Value, id: &str) -> &'a mut serde_json::Map<String, Value> {
    g["knoten"].as_array_mut().unwrap().iter_mut().find(|k| k["id"] == id).unwrap_or_else(|| panic!("no node {id}")).as_object_mut().unwrap()
}

fn mutiere(json: &str, m: &[Mut]) -> String {
    let mut g: Value = serde_json::from_str(json).unwrap();
    for m in m {
        match *m {
            Mut::KanteWeg(nach) => {
                let k = g["kanten"].as_array_mut().unwrap();
                let vor = k.len();
                k.retain(|e| e["nach"] != nach);
                assert_eq!(k.len(), vor - 1, "no edge into {nach}");
            }
            Mut::Wert(id, w, v) => {
                knoten_mut(&mut g, id).insert(w.to_string(), serde_json::json!(v));
            }
            Mut::Knopf(id, v) => {
                let o = knoten_mut(&mut g, id);
                o.insert("min".into(), serde_json::json!(v));
                o.insert("max".into(), serde_json::json!(v));
                o.remove("log");
            }
            Mut::Art(id, art) => {
                knoten_mut(&mut g, id).insert("art".into(), Value::String(art.to_string()));
            }
        }
    }
    g.to_string()
}

// ---------------------------------------------------------------------------------------------------- checks per card

/// result of a check: the measured value, its window, and the text for the report
struct Messung {
    wert: f64,
    fenster: (f64, f64),
    text: String,
}

impl Messung {
    fn ok(&self) -> bool { self.wert >= self.fenster.0 && self.wert <= self.fenster.1 }
}

fn mess(wert: f64, fenster: (f64, f64), text: impl Into<String>) -> Messung { Messung { wert, fenster, text: text.into() } }

const AUS: f64 = f64::INFINITY;

/// knobs of a patch by regler id, set to `w` (for checks that need an effect dry or a layer off)
fn mit(json: &str, ids: &[(&str, f32)]) -> Vec<(usize, f32)> { ids.iter().map(|(id, w)| (knopf(json, id), *w)).collect() }

fn eine_note(n: u8, sekunden: f32) -> Spiel { Spiel { noten: vec![n], sekunden, vel: 0.8, aus: None, regler: vec![] } }

type Pruefung = fn(&str) -> Messung;

/// The checks. Each one plays the patch its own way, measures one property the card states, and returns the window.
const PRUEFUNGEN: &[(&str, &str, Pruefung)] = &[
    ("bass.sub", "energy above 200 Hz vs the fundamental (dB), card: >= 30 dB below", |j| {
        let x = spiele(j, &eine_note(40, 2.0));
        let sp = spektrum(stueck(&x, 0.5, 1.5));
        let f0 = hz(40);
        mess(10.0 * (band(&sp, 200.0, 20_000.0) / band(&sp, 0.92 * f0, 1.08 * f0)).log10(), (-AUS, -30.0), "dB above 200 Hz re fundamental")
    }),
    ("bass.reese", "beating depth of the fundamental from the +-38 cent detune", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_hall_mix", 0.0)]), ..eine_note(40, 2.0) });
        mess(tiefe(&linie_ueber_zeit(stueck(&x, 0.4, 2.0), hz(40), 50.0)), (0.5, 1.0), "depth (max-min)/(max+min) of the 82 Hz line")
    }),
    ("bass.acid", "resonance peak: band at the 450 Hz cutoff re the band an octave below (dB)", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_delay_mix", 0.0), ("k_hall_mix", 0.0)]), ..eine_note(40, 2.0) });
        let sp = spektrum(stueck(&x, 0.3, 1.3));
        mess(10.0 * (band(&sp, 360.0, 560.0) / band(&sp, 180.0, 280.0)).log10(), (-6.0, AUS), "dB at cutoff re one octave below")
    }),
    ("bass.fm", "brightness falls with the 2 s decay (the index is the envelope): brightness 0-150 ms / 1.2-1.6 s", |j| {
        let x = spiele(j, &eine_note(40, 2.0));
        mess(hell(stueck(&x, 0.0, 0.15)) / hell(stueck(&x, 1.2, 1.6)), (1.3, AUS), "brightness ratio early/late")
    }),
    ("bass.wobble", "cutoff wobble at 1/8 note (4 Hz at 120 BPM): brightness rate in Hz", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_room_mix", 0.0)]), ..eine_note(40, 2.5) });
        let h: Vec<f64> = stueck(&x, 0.5, 2.5).chunks(sek(0.01)).map(hell).collect();
        let r = rate_der_reihe(&h, 0.01, 1.0, 16.0);
        let d = tiefe(&h);
        mess(if d > 0.25 { r } else { 0.0 }, (3.8, 4.2), format!("brightness rate in Hz (depth {d:.2}, must exceed 0.25)"))
    }),
    ("bass.analog", "AR envelope: holds while the key is down (drive off), stops on release: level 30 ms after note-off re peak (dB)", |j| {
        let x = spiele(j, &Spiel { aus: Some(1.0), regler: mit(j, &[("k_chorus_mix", 0.0), ("k_drive", 0.0)]), ..eine_note(40, 1.2) });
        let halten = db(rms(stueck(&x, 0.8, 1.0))) - db(rms(stueck(&x, 0.1, 0.3)));
        let p = db(x.iter().fold(0.0f32, |m, v| m.max(v.abs())) as f64);
        let rest = db(rms(stueck(&x, 1.03, 1.04))) - p;
        mess(if halten.abs() <= 1.5 { rest } else { 0.0 }, (-AUS, -40.0), format!("dB at off + 30 ms re peak (hold drift {halten:.2} dB, must be within 1.5)"))
    }),
    ("bass.rolling", "release ends before the next 1/16 (125 ms at 120 BPM): level 125 ms after note-off re peak (dB)", |j| {
        let x = spiele(j, &Spiel { aus: Some(0.1), ..eine_note(40, 0.5) });
        let p = db(x.iter().fold(0.0f32, |m, v| m.max(v.abs())) as f64);
        mess(db(rms(stueck(&x, 0.225, 0.235))) - p, (-AUS, -40.0), "dB at off + 125 ms re peak")
    }),
    ("bass.pluck", "pluck decay (A 0, D 0.29 s, S 0): time to -40 dB in s", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_delay_mix", 0.0)]), ..eine_note(40, 2.0) });
        mess(abklingzeit(&x, 40.0), (0.1, 0.6), "s to -40 dB")
    }),
    ("lead.mono", "20 ms glide: mean pitch of the first 12 ms after a legato jump A3 -> A4 (Hz)", |j| {
        let mut p = lade(j);
        let s = Spiel { noten: vec![57], sekunden: 0.3, vel: 0.8, aus: None, regler: mit(j, &[("k_delay_mix", 0.0), ("k_hall_mix", 0.0)]) };
        spiele_programm(&mut p, &s);
        p.note_an(69, 0.8);
        p.note_aus(57);
        let y: Vec<f32> = (0..sek(0.3)).map(|_| { let (l, r) = p.sample_stereo(); 0.5 * (l + r) }).collect();
        let anfang = tonhoehe(&y[..sek(0.012)]);
        let ende = tonhoehe(stueck(&y, 0.2, 0.25));
        mess(if (ende / 440.0 - 1.0).abs() < 0.03 { anfang } else { -1.0 }, (200.0, 380.0), format!("Hz in the first 12 ms (target 440 reached: {ende:.1} Hz)"))
    }),
    ("lead.poly", "PWM 5.5 Hz: depth of the 3rd-harmonic line of osc 1 over time", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_delay_mix", 0.0), ("k_hall_mix", 0.0)]), ..eine_note(57, 2.0) });
        mess(tiefe(&linie_ueber_zeit(stueck(&x, 0.3, 2.0), 3.0 * hz(57) * 2f64.powf(-10.0 / 1200.0), 40.0)), (0.75, 1.0), "depth of the 655 Hz line (the chorus alone moves it to about 0.45)")
    }),
    ("lead.supersaw", "beating depth of the fundamental from the 7-copy detune", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_delay_mix", 0.0), ("k_hall_mix", 0.0)]), ..eine_note(57, 2.0) });
        mess(tiefe(&linie_ueber_zeit(stueck(&x, 0.3, 2.0), hz(57), 50.0)), (0.3, 1.0), "depth of the 220 Hz line")
    }),
    ("lead.acid", "the acid bass lifted an octave: pitch ratio lead/bass on the same note", |j| {
        let bass = json_von("bass.acid");
        let s = |j: &str| Spiel { regler: mit(j, &[("k_delay_mix", 0.0), ("k_hall_mix", 0.0), ("k_resonance", 0.0)]), ..eine_note(45, 1.0) };
        let (a, b) = (spiele(j, &s(j)), spiele(&bass, &s(&bass)));
        mess(tonhoehe(stueck(&a, 0.2, 0.3)) / tonhoehe(stueck(&b, 0.2, 0.3)), (1.97, 2.03), "pitch ratio")
    }),
    ("lead.sync", "hard sync: pitch stays at the master (220 Hz) while osc 2 is tuned +7 st", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_delay_mix", 0.0), ("k_hall_mix", 0.0)]), ..eine_note(57, 1.0) });
        mess(tonhoehe(stueck(&x, 0.3, 0.4)), (213.0, 227.0), "Hz")
    }),
    ("lead.fm", "the mod-index envelope bites: centroid 0-60 ms / 0.8-1.2 s", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_delay_mix", 0.0), ("k_hall_mix", 0.0)]), ..eine_note(57, 1.5) });
        mess(schwerpunkt(stueck(&x, 0.0, 0.06)) / schwerpunkt(stueck(&x, 0.8, 1.2)), (1.3, AUS), "centroid ratio early/late")
    }),
    ("lead.arp", "high-pass 300 Hz keeps the arp off the bass: energy below 150 Hz re total on A2 (dB)", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_delay_mix", 0.0), ("k_hall_mix", 0.0)]), ..eine_note(45, 1.0) });
        let sp = spektrum(stueck(&x, 0.0, 0.5));
        mess(10.0 * (band(&sp, 20.0, 150.0) / band(&sp, 20.0, 20_000.0)).log10(), (-AUS, -20.0), "dB below 150 Hz re total")
    }),
    ("pad.strings", "the filter opens after the bow (filter A 0.8 s): seconds until the brightness reaches 90 % of its 1.2-1.6 s value", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_hall_mix", 0.0)]), ..eine_note(57, 2.0) });
        let h: Vec<f64> = x.chunks(sek(0.02)).map(hell).collect();
        let ziel = 0.9 * mittel(&h[60..80]);
        mess(h.iter().position(|v| *v >= ziel).unwrap_or(h.len()) as f64 * 0.02, (0.3, 1.2), "s to 90 % brightness")
    }),
    ("pad.choir", "slow swell (A 0.32 s): level 0-50 ms re 0.6-0.8 s (dB)", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_hall_mix", 0.0)]), ..eine_note(57, 1.0) });
        mess(db(rms(stueck(&x, 0.0, 0.05))) - db(rms(stueck(&x, 0.6, 0.8))), (-AUS, -10.0), "dB")
    }),
    ("pad.atmosphere", "the self-resonant filter pitches the noise: spectral peak re median 200-4000 Hz (dB)", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_hall_mix", 0.0), ("k_delay_mix", 0.0)]), ..eine_note(57, 2.0) });
        let (f, d) = prominenz(stueck(&x, 1.0, 2.0), 200.0, 4000.0);
        mess(d, (15.0, AUS), format!("dB peak re its octave (peak at {f:.0} Hz; tracked cutoff 841 Hz)"))
    }),
    ("pad.analog", "long release (R 2.25 s): seconds from note-off to -40 dB", |j| {
        let x = spiele(j, &Spiel { aus: Some(0.5), regler: mit(j, &[("k_hall_mix", 0.0)]), ..eine_note(57, 3.0) });
        mess(abklingzeit(stueck(&x, 0.49, 3.0), 40.0), (1.0, 2.2), "s from note-off to -40 dB")
    }),
    ("pad.granular", "the cloud evolves (position LFO): brightness 3.0-3.5 s re 0.5-1.0 s", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_hall_mix", 0.0)]), ..eine_note(57, 3.5) });
        mess(hell(stueck(&x, 3.0, 3.5)) / hell(stueck(&x, 0.5, 1.0)), (1.15, AUS), "brightness ratio late/early")
    }),
    ("pad.drone", "slow swell (A 1.5 s): level 0-100 ms re 1.8-2.0 s (dB)", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_hall_mix", 0.0)]), ..eine_note(45, 2.0) });
        mess(db(rms(stueck(&x, 0.0, 0.1))) - db(rms(stueck(&x, 1.8, 2.0))), (-AUS, -15.0), "dB")
    }),
    ("keys.piano", "brightness decays with the note (filter D 5.22 s): centroid 0-60 ms / 1.0-1.4 s", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_room_mix", 0.0)]), ..eine_note(57, 1.5) });
        mess(schwerpunkt(stueck(&x, 0.0, 0.06)) / schwerpunkt(stueck(&x, 1.0, 1.4)), (1.2, AUS), "centroid ratio early/late")
    }),
    ("keys.electric_piano", "long decay to silence (D 5.14 s, S 0): level 1.8-2.0 s re peak (dB)", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_room_mix", 0.0)]), ..eine_note(57, 2.0) });
        let p = db(rms(stueck(&x, 0.0, 0.05)));
        mess(db(rms(stueck(&x, 1.8, 2.0))) - p, (-30.0, -8.0), "dB late re first 50 ms")
    }),
    ("keys.organ", "click-free attack (A 0.6 s): level 0-50 ms re 1.0-1.5 s (dB)", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_room_mix", 0.0)]), ..eine_note(57, 1.5) });
        mess(db(rms(stueck(&x, 0.0, 0.05))) - db(rms(stueck(&x, 1.0, 1.5))), (-AUS, -15.0), "dB")
    }),
    ("keys.mallet", "glockenspiel decay (D 1.2 s, S 0): time to -40 dB in s", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_hall_mix", 0.0), ("k_delay_mix", 0.0)]), ..eine_note(69, 2.5) });
        mess(abklingzeit(&x, 40.0), (0.5, 1.2), "s to -40 dB")
    }),
    ("keys.chord", "stacked fifth: the +7 st line re the root line (dB)", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_delay_mix", 0.0), ("k_hall_mix", 0.0)]), ..eine_note(57, 1.0) });
        let sp = spektrum(stueck(&x, 0.2, 0.9));
        let (f0, f5) = (hz(57), hz(64));
        mess(10.0 * (band(&sp, 0.98 * f5, 1.02 * f5) / band(&sp, 0.98 * f0, 1.02 * f0)).log10(), (-6.0, AUS), "dB fifth re root")
    }),
    ("keys.bell", "the 1:7 modulator dies in 1 s while the carriers ring: centroid 0-50 ms / 1.5-1.9 s", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_hall_mix", 0.0), ("k_delay_mix", 0.0)]), ..eine_note(69, 2.0) });
        mess(schwerpunkt(stueck(&x, 0.0, 0.05)) / schwerpunkt(stueck(&x, 1.5, 1.9)), (1.3, AUS), "centroid ratio early/late")
    }),
    ("pluck.synth", "pluck decay (amp D 0.2-0.5 s, S 0): time to -40 dB in s", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_hall_mix", 0.0), ("k_delay_mix", 0.0)]), ..eine_note(57, 1.5) });
        mess(abklingzeit(&x, 40.0), (0.1, 0.5), "s to -40 dB")
    }),
    ("pluck.mallet", "xylophone decay (D 1.88 s, S 0): time to -40 dB in s", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_room_mix", 0.0), ("k_delay_mix", 0.0)]), ..eine_note(57, 3.0) });
        mess(abklingzeit(&x, 40.0), (0.8, 1.9), "s to -40 dB")
    }),
    ("pluck.string", "brightness falls after the pick (filter D 0.35 s): centroid 0-50 ms / 0.6-1.0 s", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_room_mix", 0.0)]), ..eine_note(57, 1.5) });
        mess(schwerpunkt(stueck(&x, 0.0, 0.05)) / schwerpunkt(stueck(&x, 0.6, 1.0)), (1.3, AUS), "centroid ratio early/late")
    }),
    ("pluck.stab", "velocity -> cutoff: centroid at velocity 1.0 / at 0.3 (first 150 ms)", |j| {
        let s = |v: f32| Spiel { vel: v, regler: mit(j, &[("k_room_mix", 0.0), ("k_delay_mix", 0.0)]), ..eine_note(57, 0.3) };
        let (a, b) = (spiele(j, &s(1.0)), spiele(j, &s(0.3)));
        mess(schwerpunkt(stueck(&a, 0.0, 0.15)) / schwerpunkt(stueck(&b, 0.0, 0.15)), (1.15, AUS), "centroid ratio loud/soft")
    }),
    ("drums.kick", "exponential pitch drop: cycle frequency at 2 ms / at 100 ms", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_room_mix", 0.0), ("k_click", 0.0)]), ..eine_note(60, 0.5) });
        mess(zyklus_hz(&x, 0.002) / zyklus_hz(&x, 0.1), (1.5, AUS), "frequency ratio")
    }),
    ("drums.snare", "noise dominates: spectral flatness 1-8 kHz (0 tonal .. 1 noise)", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_room_mix", 0.0)]), ..eine_note(60, 0.5) });
        let sp = spektrum(&x[..8192]);
        let (p, df) = &sp;
        let b = &p[(1000.0 / df) as usize..(8000.0 / df) as usize];
        let geo = (b.iter().map(|v| v.max(1e-30).ln()).sum::<f64>() / b.len() as f64).exp();
        mess(geo / (b.iter().sum::<f64>() / b.len() as f64), (0.3, 1.0), "flatness")
    }),
    ("drums.clap", "retriggered 32 Hz square on the amplitude, depth 45 %: chopping of the envelope averaged over 16 hits (first 120 ms)", |j| {
        // 16 hits, 1 ms envelopes averaged: the retriggered LFO is phase-locked to the hit, the noise averages out
        let mut p = lade(j);
        let mut h = vec![0.0f64; 120];
        for _ in 0..16 {
            let x = spiele_programm(&mut p, &Spiel { aus: Some(0.1), regler: mit(j, &[("k_hall_mix", 0.0)]), ..eine_note(60, 0.25) });
            let m: Vec<f32> = x.iter().map(|(l, r)| 0.5 * (l + r)).collect();
            for (a, c) in h.iter_mut().zip(m.chunks(sek(0.001))) { *a += rms(c) / 16.0; }
        }
        // log envelope minus its 31 ms moving mean (one 32 Hz period): the exponential decay divides out, the chopping
        // stays; its 32 Hz component is the measure
        let l: Vec<f64> = h.iter().map(|v| v.max(1e-12).ln()).collect();
        let r: Vec<f64> = (15..l.len() - 16).map(|i| l[i] - mittel(&l[i - 15..i + 16])).collect();
        let w = 2.0 * std::f64::consts::PI * 32.0 * 0.001;
        let (re, im) = r.iter().enumerate().fold((0.0, 0.0), |a, (i, v)| (a.0 + v * (w * i as f64).cos(), a.1 + v * (w * i as f64).sin()));
        mess(2.0 * (re * re + im * im).sqrt() / r.len() as f64, (0.1, AUS), "32 Hz amplitude of the log envelope (nepers)")
    }),
    ("drums.hihat", "closed hat (D 0.03-0.06 s): time to -40 dB in s", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_room_mix", 0.0)]), ..eine_note(60, 0.5) });
        mess(abklingzeit(&x, 40.0), (0.01, 0.1), "s to -40 dB")
    }),
    ("drums.cymbal", "cymbal decay (D 1.1 s, S 0): time to -40 dB in s", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_hall_mix", 0.0)]), ..eine_note(60, 2.0) });
        mess(abklingzeit(&x, 40.0), (0.4, 1.4), "s to -40 dB")
    }),
    ("percussion.tom", "pitch drop 3-7 st over 20-40 ms: cycle at 2 ms re 150 ms (semitones)", |j| {
        // measured on the upper square alone (the -10 st square taken out of the mix): its zero crossings give the cycle
        let x = spiele(&mutiere(j, &[Mut::KanteWeg("mix.b")]), &Spiel { regler: mit(j, &[("k_room_mix", 0.0)]), ..eine_note(60, 0.5) });
        mess(12.0 * (zyklus_hz(&x, 0.002) / zyklus_hz(&x, 0.15)).log2(), (2.0, 8.0), "semitones")
    }),
    ("percussion.shaker", "a 40 ms grain: time to -40 dB in s", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_room_mix", 0.0)]), ..eine_note(60, 0.3) });
        mess(abklingzeit(&x, 40.0), (0.01, 0.08), "s to -40 dB")
    }),
    ("percussion.conga", "conga decay (D 0.15 s): time to -40 dB in s", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_room_mix", 0.0)]), ..eine_note(60, 0.5) });
        mess(abklingzeit(&x, 40.0), (0.05, 0.25), "s to -40 dB")
    }),
    ("percussion.rim", "the click of stick on rim (amp D 0.09 s, R 0): time to -40 dB in s", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_room_mix", 0.0)]), ..eine_note(60, 0.3) });
        let (f, d) = prominenz(stueck(&x, 0.0, 0.1), 500.0, 16_000.0);
        mess(abklingzeit(&x, 40.0), (0.02, 0.12), format!("s to -40 dB (strongest peak {f:.0} Hz, {d:.1} dB over its octave)"))
    }),
    ("percussion.metallic", "cowbell lines at 587 and 845 Hz: the weaker line re the stronger (dB)", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_room_mix", 0.0)]), ..eine_note(60, 0.3) });
        let sp = spektrum(stueck(&x, 0.0, 0.15));
        let (a, b) = (band(&sp, 575.0, 599.0), band(&sp, 828.0, 862.0));
        mess(10.0 * (a.min(b) / a.max(b)).log10(), (-15.0, 0.0), "dB weaker line re stronger")
    }),
    ("fx.riser", "the filter envelope rises: centroid 1.6-2.0 s / 0.1-0.5 s", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_hall_mix", 0.0)]), ..eine_note(60, 2.0) });
        mess(schwerpunkt(stueck(&x, 1.6, 2.0)) / schwerpunkt(stueck(&x, 0.1, 0.5)), (1.5, AUS), "centroid ratio late/early")
    }),
    ("fx.downlifter", "the inverted envelope falls: centroid 0.1-0.5 s / 1.6-2.0 s", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_hall_mix", 0.0), ("k_delay_mix", 0.0)]), ..eine_note(60, 2.0) });
        mess(schwerpunkt(stueck(&x, 0.1, 0.5)) / schwerpunkt(stueck(&x, 1.6, 2.0)), (1.5, AUS), "centroid ratio early/late")
    }),
    ("fx.impact", "pitch falls 12-24 st over 100-300 ms: cycle frequency at 3 ms re 500 ms (semitones)", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_hall_mix", 0.0), ("k_debris", 0.0)]), ..eine_note(60, 0.6) });
        mess(12.0 * (zyklus_hz(&x, 0.003) / zyklus_hz(&x, 0.5)).log2(), (12.0, 24.0), "semitones")
    }),
    ("fx.noise", "0.2 Hz swell, depth 75 %: level range over 1-6 s in 250 ms windows (dB)", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_hall_mix", 0.0)]), ..eine_note(57, 6.0) });
        let h = huelle(stueck(&x, 1.0, 6.0), 250.0);
        let (lo, hi) = h.iter().fold((f64::MAX, f64::MIN), |m, v| (m.0.min(*v), m.1.max(*v)));
        mess(hi - lo, (6.0, AUS), "dB max - min")
    }),
    ("fx.texture", "random filter movement: brightness spread (std / mean over 20 ms windows, 0.5-3.5 s)", |j| {
        let x = spiele(j, &Spiel { regler: mit(j, &[("k_phaser_mix", 0.0), ("k_delay_mix", 0.0), ("k_spring_mix", 0.0)]), ..eine_note(45, 3.5) });
        let h: Vec<f64> = stueck(&x, 0.5, 3.5).chunks(sek(0.02)).map(hell).collect();
        let m = h.iter().sum::<f64>() / h.len() as f64;
        mess((h.iter().map(|v| (v - m).powi(2)).sum::<f64>() / h.len() as f64).sqrt() / m, (0.1, AUS), "std/mean of brightness")
    }),
];

/// Mutations of the key checks: each removes the property its check measures, so the check must turn red.
const MUTATIONEN: &[(&str, &str, &[Mut])] = &[
    ("bass.sub", "saw instead of triangle, filter wide open", &[Mut::Art("tri", "saege"), Mut::Knopf("k_tone", 200.0)]),
    ("bass.reese", "detune 0 (and no detune drift)", &[Mut::Knopf("k_detune", 0.0), Mut::Wert("drift_c", "b", 0.0)]),
    ("bass.acid", "resonance 0", &[Mut::Knopf("k_resonance", 0.0)]),
    ("bass.fm", "FM depth 0", &[Mut::Knopf("k_fm_depth", 0.0)]),
    ("bass.wobble", "wobble depth 0", &[Mut::Knopf("k_wobble_depth", 0.0)]),
    ("bass.analog", "a decaying ADSR (D 1 s, S 0) instead of the AR shape", &[Mut::Wert("env", "d", 1.0), Mut::Wert("env", "s", 0.0)]),
    ("bass.rolling", "release 1 s", &[Mut::Wert("env", "r", 1.0)]),
    ("bass.pluck", "sustain 100 %", &[Mut::Wert("env", "s", 1.0)]),
    ("lead.mono", "no glide", &[Mut::Wert("glide", "zeit", 0.0)]),
    ("lead.poly", "PWM depth 0", &[Mut::Knopf("k_pwm_depth", 0.0)]),
    ("lead.supersaw", "detune 0", &[Mut::Knopf("k_detune", 0.0)]),
    ("lead.acid", "no octave lift", &[Mut::Wert("lift", "b", 1.0)]),
    ("lead.sync", "sync edges removed", &[Mut::KanteWeg("slave1.sync"), Mut::KanteWeg("slave2.sync")]),
    ("lead.fm", "bite 0 (static index)", &[Mut::Knopf("k_bite", 0.0)]),
    ("lead.arp", "high-pass at 20 Hz", &[Mut::Knopf("k_high_pass", 20.0)]),
    ("pad.strings", "filter attack 1 ms", &[Mut::Knopf("k_filter_attack", 0.001)]),
    ("pad.choir", "attack 1 ms", &[Mut::Knopf("k_attack", 0.001)]),
    ("pad.atmosphere", "resonance 0", &[Mut::Knopf("k_ring", 0.0), Mut::Knopf("k_ring_inv", 0.0)]),
    ("pad.analog", "release 0.2 s", &[Mut::Knopf("k_release", 0.2)]),
    ("pad.granular", "no position motion", &[Mut::Knopf("k_motion", 0.0)]),
    ("pad.drone", "attack 1 ms", &[Mut::Knopf("k_attack", 0.001)]),
    ("keys.piano", "filter env amount 0", &[Mut::Knopf("k_env_amount", 0.0)]),
    ("keys.electric_piano", "sustain 100 %", &[Mut::Wert("env", "s", 1.0)]),
    ("keys.organ", "attack 1 ms", &[Mut::Knopf("k_attack", 0.001)]),
    ("keys.mallet", "sustain 100 %", &[Mut::Wert("env", "s", 1.0)]),
    ("keys.chord", "fifth tuned to the root", &[Mut::Wert("quinte_hz", "st", 0.0)]),
    ("keys.bell", "modulation index 0", &[Mut::Knopf("k_index", 0.0)]),
    ("pluck.synth", "sustain 100 %", &[Mut::Wert("env", "s", 1.0)]),
    ("pluck.mallet", "sustain 100 %", &[Mut::Wert("env", "s", 1.0)]),
    ("pluck.string", "filter env amount 0", &[Mut::Knopf("k_env_amount", 0.0)]),
    ("pluck.stab", "velocity amount 0", &[Mut::Knopf("k_velocity_amount", 0.0)]),
    ("drums.kick", "pitch drop 0", &[Mut::Knopf("k_pitch_drop", 0.0)]),
    ("drums.snare", "no noise", &[Mut::Knopf("k_snares", 0.0)]),
    ("drums.clap", "clap LFO depth 0", &[Mut::Knopf("clap_am_halb", 0.0), Mut::Knopf("clap_am_rest", 1.0)]),
    ("drums.hihat", "decay 0.5 s", &[Mut::Knopf("k_decay", 0.5)]),
    ("drums.cymbal", "sustain 100 %", &[Mut::Wert("env", "s", 1.0)]),
    ("percussion.tom", "pitch drop 0", &[Mut::Knopf("k_pitch_drop", 0.0)]),
    ("percussion.shaker", "decay 0.3 s", &[Mut::Knopf("k_decay", 0.3)]),
    ("percussion.conga", "sustain 100 %", &[Mut::Wert("env", "s", 1.0)]),
    ("percussion.rim", "decay 0.5 s", &[Mut::Knopf("k_decay", 0.5)]),
    ("percussion.metallic", "second pulse at 587 Hz", &[Mut::Wert("ton2", "hz", 587.0)]),
    ("fx.riser", "env amount 0", &[Mut::Knopf("k_env_amount", 0.0)]),
    ("fx.downlifter", "env amount 0", &[Mut::Knopf("k_env_amount", 0.0)]),
    ("fx.impact", "pitch drop 0", &[Mut::Knopf("k_pitch_drop", 0.0)]),
    ("fx.noise", "swell depth 0", &[Mut::Knopf("swell_am_halb", 0.0), Mut::Knopf("swell_am_rest", 1.0)]),
    ("fx.texture", "random depth 0", &[Mut::Knopf("k_random_depth", 0.0)]),
];

/// run `f` over `items` on all cores, results in order
fn parallel<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let n = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(items.len().max(1));
    let teile: Vec<&[T]> = items.chunks(items.len().div_ceil(n).max(1)).collect();
    std::thread::scope(|s| {
        let h: Vec<_> = teile.iter().map(|t| s.spawn(|| t.iter().map(&f).collect::<Vec<R>>())).collect();
        h.into_iter().flat_map(|h| h.join().unwrap()).collect()
    })
}

// ---------------------------------------------------------------------------------------------------- tests

fn trim(json: &str) -> f64 {
    let g: Value = serde_json::from_str(json).unwrap();
    g["knoten"].as_array().unwrap().iter().find(|k| k["id"] == "pegel" || k["id"] == "pegel_l").unwrap()["b"].as_f64().unwrap()
}

#[test]
fn jeder_patch_laedt_spielt_endlich_und_pegelgleich() {
    let alle = patches();
    let fehler: Vec<String> = parallel(&alle, |(e, json)| {
        let name = e["datei"].as_str().unwrap().trim_end_matches(".json").to_string();
        let mut f = Vec::new();
        let mut p = lade(json);
        let s = probe_von(e);
        let y = spiele_programm(&mut p, &s);
        let spitze = y.iter().fold(0.0f32, |m, (l, r)| m.max(l.abs()).max(r.abs()));
        let pk = 20.0 * spitze.max(1e-9).log10();
        println!("MESS {name:24} peak {pk:6.2} dBFS  rms {:6.1} dB  voices {}", db(rms(&y.iter().map(|(l, r)| 0.5 * (l + r)).collect::<Vec<_>>())), p.stimmen);
        println!("MESS_PEGEL {name} {:.4}", trim(json) * 10f64.powf((-6.0 - pk as f64) / 20.0));
        if !y.iter().all(|(l, r)| l.is_finite() && r.is_finite()) { f.push(format!("{name}: not finite")); }
        if p.rettungen != 0 { f.push(format!("{name}: rescued {} times", p.rettungen)); }
        if spitze > 1.0 { f.push(format!("{name}: peak {pk:.2} dBFS above 0 dBFS")); }
        if !(PEGEL_FENSTER.0..=PEGEL_FENSTER.1).contains(&pk) { f.push(format!("{name}: peak {pk:.2} dBFS outside {PEGEL_FENSTER:?}")); }
        // voices: within 16, mono = 1, a poly patch gives each chord note its own voice
        if p.stimmen > MAX_STIMMEN { f.push(format!("{name}: {} voices", p.stimmen)); }
        if p.stimmen as u64 != e["stimmen"].as_u64().unwrap() { f.push(format!("{name}: manifest voices differ")); }
        let haltend: Vec<u8> = (0..p.stimmen).map(|v| p.stimme(v)).filter(|(_, g)| *g).map(|(n, _)| n).collect();
        if s.noten.len() > 1 {
            let mut h = haltend.clone();
            h.sort();
            if h != s.noten { f.push(format!("{name}: chord {:?} held on voices {haltend:?}", s.noten)); }
        } else if p.stimmen != 1 {
            f.push(format!("{name}: single-note probe on a {}-voice patch", p.stimmen));
        }
        f
    }).into_iter().flatten().collect();
    assert!(fehler.is_empty(), "\n  {}", fehler.join("\n  "));
}

#[test]
fn alle_regler_an_den_enden_endlich() {
    let alle = patches();
    let fehler: Vec<String> = parallel(&alle, |(e, json)| {
        let name = e["datei"].as_str().unwrap();
        let mut f = Vec::new();
        for w in [0.0f32, 1.0] {
            let mut p = lade(json);
            let s = Spiel { regler: (1..=REGLER).map(|n| (n, w)).collect(), ..probe_von(e) };
            let y = spiele_programm(&mut p, &s);
            let spitze = y.iter().fold(0.0f32, |m, (l, r)| m.max(l.abs()).max(r.abs()));
            println!("MESS {name:28} all knobs {w}: peak {:6.2} dBFS", 20.0 * spitze.max(1e-9).log10());
            if !y.iter().all(|(l, r)| l.is_finite() && r.is_finite()) || p.rettungen != 0 { f.push(format!("{name}: knobs at {w}: not finite or rescued")); }
            if spitze > 4.0 { f.push(format!("{name}: knobs at {w}: peak {spitze:.2}")); }
        }
        f
    }).into_iter().flatten().collect();
    assert!(fehler.is_empty(), "\n  {}", fehler.join("\n  "));
}

#[test]
fn jede_karte_hat_eine_pruefung_und_eine_mutation() {
    let karten: Vec<String> = patches().iter().map(|(e, _)| e["karte"].as_str().unwrap().to_string()).collect();
    for k in &karten {
        assert_eq!(PRUEFUNGEN.iter().filter(|(c, _, _)| c == k).count(), 1, "{k}: one check");
        assert_eq!(MUTATIONEN.iter().filter(|(c, _, _)| c == k).count(), 1, "{k}: one mutation");
    }
    assert_eq!(PRUEFUNGEN.len(), karten.len());
}

#[test]
fn pruefungen_der_karten() {
    let ergebnisse = parallel(PRUEFUNGEN, |(karte, was, f)| {
        let m = f(&json_von(karte));
        println!("MESS check {karte:22} {:10.3} in [{}, {}]  {}  ({was})", m.wert, m.fenster.0, m.fenster.1, m.text);
        (*karte, m)
    });
    let rot: Vec<String> = ergebnisse.iter().filter(|(_, m)| !m.ok()).map(|(k, m)| format!("{k}: {} = {:.3} outside [{}, {}]", m.text, m.wert, m.fenster.0, m.fenster.1)).collect();
    assert!(rot.is_empty(), "\n  {}", rot.join("\n  "));
}

#[test]
fn mutationen_machen_die_pruefungen_rot() {
    let ergebnisse = parallel(MUTATIONEN, |(karte, was, m)| {
        let f = PRUEFUNGEN.iter().find(|(c, _, _)| c == karte).unwrap().2;
        let json = mutiere(&json_von(karte), m);
        let r = f(&json);
        println!("MESS mutation {karte:22} {was:40} -> {:10.3} ({}) {}", r.wert, if r.ok() { "STILL GREEN" } else { "red" }, r.text);
        (*karte, *was, r.ok())
    });
    let gruen: Vec<String> = ergebnisse.iter().filter(|(_, _, ok)| *ok).map(|(k, w, _)| format!("{k}: mutation '{w}' leaves the check green")).collect();
    assert!(gruen.is_empty(), "\n  {}", gruen.join("\n  "));
}

/// bright against dark: card target words name one patch brighter than the other
const PAARE: &[(&str, &str)] = &[
    ("bass.analog", "bass.sub"),
    ("lead.supersaw", "pad.drone"),
    ("drums.hihat", "drums.kick"),
    ("keys.mallet", "pluck.mallet"),
    ("lead.acid", "bass.reese"),
    ("drums.cymbal", "percussion.tom"),
];

fn schwerpunkt_der_probe(karte: &str, json: &str) -> f64 {
    let e = patches().into_iter().find(|(e, _)| e["karte"] == karte).unwrap().0;
    let x = spiele(json, &probe_von(&e));
    schwerpunkt(stueck(&x, 0.0, 1.0))
}

#[test]
fn hell_gegen_dunkel() {
    let r = parallel(PAARE, |(hell, dunkel)| {
        let (a, b) = (schwerpunkt_der_probe(hell, &json_von(hell)), schwerpunkt_der_probe(dunkel, &json_von(dunkel)));
        println!("MESS pair {hell:16} {a:8.0} Hz  >  {dunkel:16} {b:8.0} Hz");
        (*hell, *dunkel, a > 1.5 * b)
    });
    assert!(r.iter().all(|x| x.2), "{:?}", r.iter().filter(|x| !x.2).map(|x| (x.0, x.1)).collect::<Vec<_>>());
    // mutation: the supersaw with its filter closed to 60 Hz is no longer brighter than the drone
    let zu = mutiere(&json_von("lead.supersaw"), &[Mut::Knopf("k_cutoff", 60.0)]);
    let (a, b) = (schwerpunkt_der_probe("lead.supersaw", &zu), schwerpunkt_der_probe("pad.drone", &json_von("pad.drone")));
    println!("MESS pair mutation supersaw cutoff 60 Hz {a:8.0} Hz vs drone {b:8.0} Hz");
    assert!(a <= 1.5 * b, "closed supersaw still brighter: {a} vs {b}");
}

#[test]
fn manifest_ist_vollstaendig() {
    let m = manifest();
    let karten = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("rezepte/RECIPES.md")).unwrap();
    for (e, json) in patches() {
        let id = e["karte"].as_str().unwrap();
        assert!(karten.contains(&format!("### {id}: ")), "{id}: not a card");
        let b = &e["beschreibung"];
        let (gruppe, unter) = id.split_once('.').unwrap();
        assert_eq!(b["art"], gruppe);
        assert_eq!(b["unterart"], unter);
        let c = b["charakter"].as_array().unwrap();
        assert!((1..=6).contains(&c.len()), "{id}: {} target words", c.len());
        let t = b["text"].as_str().unwrap();
        assert!(!t.is_empty() && t.chars().count() <= 160, "{id}: sentence of {} characters", t.chars().count());
        assert!((1..=5).contains(&b["energie"].as_u64().unwrap()), "{id}: energie");
        assert!(!b["einsatz"].as_array().unwrap().is_empty(), "{id}: einsatz");
        assert!(!e["zitat"].as_str().unwrap().is_empty(), "{id}: citation");
        let status = e["status"].as_str().unwrap();
        assert!(["exact", "approximated", "blocked"].contains(&status), "{id}: status {status}");
        if status != "exact" { assert!(!e["naeherung"].as_array().unwrap().is_empty(), "{id}: approximation without notes"); }
        if status == "blocked" { assert!(e["exakt_mit"].is_string(), "{id}: blocked without a module"); }
        // only node types that exist (up to type 32): the translator already rejects anything else
        let g: Value = serde_json::from_str(&json).unwrap();
        assert!(g["knoten"].as_array().unwrap().iter().all(|k| baukasten_dsp::ARTEN.iter().any(|a| a.art == k["art"])));
    }
    assert_eq!(m["patches"].as_array().unwrap().len(), 46);
}
