//! The `metall` block (type 33): band limit, tone/noise balance, decay times, spectral centroid of the hat and cymbal
//! examples, choke time and click, velocity, tuning, determinism and robustness. Everything except the alias measurement
//! goes through the public JSON API, so the numbers are what a graph plays. Every key check has a mutation that turns it
//! red; the mutations and their red output are listed in `BERICHT-metall.md` (`mutation_metall.py`).
use baukasten_dsp::metall::{blep_tabelle, gewichte, schritte, Bank, Einstellung, Kette, FREQUENZEN};
use baukasten_dsp::{uebersetze, Fehler, Programm, ARTEN};
use realfft::RealFftPlanner;

const SR: f32 = 48_000.0;
const HIHAT: &str = include_str!("../beispiele/metall-hihat.json");
const RIDE: &str = include_str!("../beispiele/metall-ride.json");
const CRASH: &str = include_str!("../beispiele/metall-crash.json");

/// A graph with one metall node `m` (values from `werte`), driven by a note (trig, vel); `aus` goes to the left side and
/// `huelle` to the right side of the output, so a test reads audio and envelope separately.
fn graph(werte: &str, stimmen: usize) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"m","stimmen":{stimmen},"knoten":[{{"id":"n","art":"note"}},{{"id":"m","art":"metall"{werte}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.trig","nach":"m.trig"}},{{"von":"n.vel","nach":"m.vel"}},{{"von":"m.aus","nach":"o.l"}},{{"von":"m.huelle","nach":"o.r"}}]}}"#
    )
}

/// The node struck on every sample (a `konst` 1 on `trig`): the envelope stays at `vel`, a steady signal for levels.
fn dauer(werte: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"m","stimmen":1,"knoten":[{{"id":"t","art":"konst","wert":1}},{{"id":"m","art":"metall"{werte}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"t.aus","nach":"m.trig"}},{{"von":"m.aus","nach":"o.x"}}]}}"#
    )
}

fn lade(g: &str) -> Programm { uebersetze(g, SR).unwrap_or_else(|e| panic!("{e}: {g}")) }

fn lauf(p: &mut Programm, n: usize) -> Vec<(f32, f32)> { (0..n).map(|_| p.sample_stereo()).collect() }

fn links(x: &[(f32, f32)]) -> Vec<f32> { x.iter().map(|v| v.0).collect() }

fn rms_db(x: &[f32]) -> f64 { 10.0 * (x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len() as f64).max(1e-30).log10() }

fn spektrum(x: &[f64]) -> Vec<f64> {
    let mut x = x.to_vec();
    let mut fft = RealFftPlanner::<f64>::new();
    let r2c = fft.plan_fft_forward(x.len());
    let mut s = r2c.make_output_vec();
    r2c.process(&mut x, &mut s).unwrap();
    s.iter().map(|c| c.norm_sqr()).collect()
}

#[test]
fn metall_ist_art_36_mit_ein_und_ausgaengen() {
    let nr = ARTEN.iter().position(|a| a.art == "metall").expect("ARTEN has no entry metall");
    // type 33: types are numbered in merge order; metall was merged right after wavetable
    assert_eq!(nr, 33, "metall is type 33 (merge order), entry {nr} of {}", ARTEN.len());
    assert_eq!(ARTEN[32].art, "wavetable", "existing type numbers must not move");
    let a = &ARTEN[nr];
    assert_eq!(a.ein, &["trig", "vel", "decay", "tune", "farbe", "rauschen", "hp", "choke"]);
    assert_eq!(a.ein, &baukasten_dsp::metall::EIN, "the run arm reads the inputs in the order of metall::EIN");
    assert_eq!(a.aus, &["aus", "huelle"]);
    assert!(a.werte.is_empty());
    for f in [("vel", 1.0), ("decay", 0.3), ("tune", 1.0), ("farbe", 0.5), ("rauschen", 0.2), ("hp", 6000.0), ("schnitt", 8.0), ("gruppe", 1.0), ("saat", 0.0)] {
        assert!(a.frei.contains(&f), "{f:?}");
    }
}

#[test]
fn werte_werden_geprueft() {
    let ok = |v: &str| uebersetze(&graph(v, 1), SR);
    for v in [r#","vel":1.1"#, r#","vel":-0.1"#, r#","decay":0.009"#, r#","decay":10.1"#, r#","tune":0.49"#, r#","tune":2.01"#,
              r#","farbe":1.1"#, r#","farbe":-0.1"#, r#","rauschen":1.5"#, r#","hp":499"#, r#","hp":16001"#, r#","schnitt":0.5"#,
              r#","schnitt":101"#, r#","gruppe":0.5"#, r#","gruppe":2"#, r#","saat":-1"#, r#","saat":0.5"#, r#","saat":70000"#] {
        assert!(matches!(ok(v), Err(Fehler::Wert { .. })), "{v}: {:?}", ok(v).err());
    }
    for v in ["", r#","vel":0"#, r#","decay":0.01"#, r#","decay":10"#, r#","tune":0.5"#, r#","tune":2"#, r#","farbe":0"#, r#","farbe":1"#,
              r#","rauschen":0"#, r#","rauschen":1"#, r#","hp":500"#, r#","hp":16000"#, r#","schnitt":1"#, r#","schnitt":100"#,
              r#","gruppe":0"#, r#","saat":65535"#] {
        assert!(ok(v).is_ok(), "{v}: {:?}", ok(v).err());
    }
    assert!(matches!(ok(r#","fremd":1"#), Err(Fehler::UnbekannterWert { .. })));
}

// ---------------------------------------------------------------------------------------------------------------------
// Aliasing

/// FFT length of the alias measurement. With f_i = sr * m_i / N (m_i odd) every phase step is exactly m_i * 2^16 in the
/// u32 accumulator, so the oscillator sum repeats after exactly N samples: a rectangular window sees pure lines, and
/// every bin below 20 kHz that is no multiple of any m_i is alias energy.
const N_FFT: usize = 65_536;

/// Alias energy below 20 kHz relative to the total, in dB: the six squares at `tune` (rounded to the grid above), through
/// the band-passes at `farbe` and the high-pass at `hp` (or the raw bank when `hp` is None). This is the voice's own
/// signal path without the envelope, which would smear the lines.
fn alias_db(sr: f32, tune: f64, farbe: f32, hp: Option<f64>) -> f64 {
    let m: [usize; 6] = std::array::from_fn(|i| (FREQUENZEN[i] * tune * N_FFT as f64 / sr as f64).round() as usize | 1);
    let s: [u32; 6] = std::array::from_fn(|i| (m[i] as u32) << 16);
    let mut b = Bank::neu([0, 1 << 30, 3 << 29, 7 << 28, 123_456_789, 987_654_321]);
    let e = Einstellung::neu(true, 8.0, 0, sr);
    let mut k = Kette::default();
    let g_hp = hp.map(|h| (std::f64::consts::PI * h / sr as f64).tan());
    let w = gewichte(farbe);
    let t = blep_tabelle();
    let mut lauf = |n: usize| -> Vec<f64> {
        (0..n).map(|_| {
            let x = b.naechstes(&s, t);
            match g_hp { Some(g) => k.prozess(x, &w, &e.g_band, g) as f64, None => x as f64 }
        }).collect()
    };
    lauf(9_600); // the filters settle
    let p = spektrum(&lauf(N_FFT));
    let grenze = (20_000.0 * N_FFT as f64 / sr as f64) as usize;
    let (mut alias, mut summe) = (0.0f64, 0.0f64);
    for (bin, e) in p.iter().enumerate().skip(1) {
        summe += e;
        if bin <= grenze && !m.iter().any(|mi| bin % mi == 0) {
            alias += e;
        }
    }
    10.0 * (alias / summe).max(1e-30).log10()
}

const ALIAS_GRENZE_DB: f64 = -90.0;

#[test]
fn aliasing_unter_minus_90_db_bei_48_und_96_khz() {
    let mut schlimmst = (f64::NEG_INFINITY, String::new());
    for sr in [48_000.0f32, 96_000.0] {
        for tune in [0.5, 0.71, 1.0, 1.41, 2.0] {
            let roh = alias_db(sr, tune, 0.5, None);
            let kette: Vec<f64> = [(0.0, 2_000.0), (0.5, 6_000.0), (1.0, 8_000.0)].iter().map(|(f, h)| alias_db(sr, tune, *f, Some(*h))).collect();
            println!("MESS alias sr {sr} tune {tune}: raw bank {roh:.1} dB, chain farbe 0 / 0.5 / 1: {:.1} / {:.1} / {:.1} dB", kette[0], kette[1], kette[2]);
            for (db, was) in [(roh, "raw"), (kette[0], "farbe 0"), (kette[1], "farbe 0.5"), (kette[2], "farbe 1")] {
                if db > schlimmst.0 {
                    schlimmst = (db, format!("sr {sr} tune {tune} {was}"));
                }
            }
        }
    }
    println!("MESS alias worst: {:.1} dB at {}", schlimmst.0, schlimmst.1);
    assert!(schlimmst.0 < ALIAS_GRENZE_DB, "alias energy {:.1} dB at {}, limit {ALIAS_GRENZE_DB} dB", schlimmst.0, schlimmst.1);
}

/// At 44.1 kHz the kernel's stop band starts at 24.6 kHz, so partials between 22.05 and 24.6 kHz fold to 19.5..22 kHz:
/// a little of that lands below 20 kHz. Stated bound -80 dB.
#[test]
fn aliasing_unter_minus_80_db_bei_44_1_khz() {
    let mut schlimmst = f64::NEG_INFINITY;
    for tune in [0.5, 1.0, 2.0] {
        for (f, h) in [(0.0f32, 2_000.0), (0.5, 6_000.0), (1.0, 8_000.0)] {
            let db = alias_db(44_100.0, tune, f, Some(h));
            println!("MESS alias sr 44100 tune {tune} farbe {f}: {db:.1} dB");
            schlimmst = schlimmst.max(db);
        }
    }
    assert!(schlimmst < -80.0, "alias energy {schlimmst:.1} dB at 44.1 kHz, limit -80 dB");
}

// ---------------------------------------------------------------------------------------------------------------------
// Tone, noise, tuning, velocity

fn dauer_pegel(werte: &str) -> f64 {
    let mut p = lade(&dauer(werte));
    lauf(&mut p, 9_600);
    rms_db(&links(&lauf(&mut p, 48_000)))
}

const BALANCE_GRENZE_DB: f64 = 1.5;

#[test]
fn ton_und_rauschen_gleich_laut() {
    // the blend knob keeps the level: tone only, half, noise only, at every colour (equal power, per-band noise balance)
    let mut schlimmst = 0.0f64;
    for farbe in [0.0, 0.25, 0.5, 0.75, 1.0] {
        let ton = dauer_pegel(&format!(r#","farbe":{farbe},"rauschen":0,"hp":2000"#));
        let mut z = Vec::new();
        for r in [0.25, 0.5, 0.75, 1.0] {
            let d = dauer_pegel(&format!(r#","farbe":{farbe},"rauschen":{r},"hp":2000"#)) - ton;
            z.push(format!("{r}: {d:+.2}"));
            schlimmst = schlimmst.max(d.abs());
        }
        println!("MESS balance farbe {farbe}: tone only {ton:.1} dB, rauschen {}", z.join(", "));
    }
    assert!(schlimmst < BALANCE_GRENZE_DB, "the blend moves the level by {schlimmst:.2} dB, limit {BALANCE_GRENZE_DB}");
}

#[test]
fn tune_verschiebt_alle_sechs_linien() {
    // tone only, steady, wide open filters: each oscillator fundamental tune * f_i is a line at least 12 dB above the
    // median of the bins within +-60 Hz
    for tune in [0.5f64, 1.0, 1.5] {
        let mut p = lade(&dauer(&format!(r#","tune":{tune},"rauschen":0,"farbe":0,"hp":500"#)));
        lauf(&mut p, 9_600);
        let x: Vec<f64> = lauf(&mut p, N_FFT).iter().map(|v| v.0 as f64).collect();
        let s = spektrum(&x);
        let hz_je_bin = SR as f64 / N_FFT as f64;
        for f in FREQUENZEN {
            let b = (f * tune / hz_je_bin).round() as usize;
            let spitze = s[b - 2..=b + 2].iter().cloned().fold(0.0, f64::max);
            let mut nachbarn: Vec<f64> = (b - 82..b - 10).chain(b + 10..b + 82).map(|i| s[i]).collect();
            nachbarn.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let db = 10.0 * (spitze / nachbarn[nachbarn.len() / 2]).log10();
            assert!(db > 12.0, "tune {tune}: no line at {:.1} Hz ({db:.1} dB over its neighbours)", f * tune);
        }
    }
}

#[test]
fn anschlagstaerke_skaliert_den_pegel() {
    let pegel = |vel: f32| {
        let mut p = lade(&graph(r#","decay":1"#, 1));
        p.note_an(60, vel);
        rms_db(&links(&lauf(&mut p, 9_600)))
    };
    let d = pegel(0.5) - pegel(1.0);
    println!("MESS velocity 0.5 against 1: {d:+.3} dB");
    assert!((d + 6.02).abs() < 0.1, "velocity 0.5 gives {d:+.3} dB, expected -6.02");
}

// ---------------------------------------------------------------------------------------------------------------------
// Decay

/// Level in dB of 1 ms windows of `x`.
fn fenster_db(x: &[f32]) -> Vec<f64> { x.chunks(48).map(rms_db).collect() }

/// -60 dB time in seconds estimated from the audio: a least-squares line through the levels of 1 ms windows from 5 ms
/// after the hit down to 50 dB below the 5 ms window, extrapolated to -60 dB. The fit averages out the beating of the
/// 522.7 and 540 Hz oscillators and the noise.
fn t60(x: &[f32]) -> f64 {
    let l = fenster_db(x);
    let start = 5;
    let ende = (start..l.len()).find(|&i| l[i] < l[start] - 50.0).unwrap_or(l.len());
    let n = (ende - start) as f64;
    let (mut st, mut sl, mut stt, mut stl) = (0.0, 0.0, 0.0, 0.0);
    for i in start..ende {
        let (t, v) = (i as f64 * 1e-3, l[i]);
        st += t;
        sl += v;
        stt += t * t;
        stl += t * v;
    }
    let steigung = (n * stl - st * sl) / (n * stt - st * st);
    -60.0 / steigung
}

const DECAY_TOLERANZ: f64 = 0.15;

#[test]
fn decay_ist_die_zeit_bis_minus_60_db() {
    let mut schlimmst = 0.0f64;
    for decay in [0.03f64, 0.1, 0.3, 1.0, 3.0] {
        let mut p = lade(&graph(&format!(r#","decay":{decay},"rauschen":0.5"#), 1));
        p.note_an(60, 1.0);
        let x = links(&lauf(&mut p, (decay * 1.2 * SR as f64) as usize + 4_800));
        let t = t60(&x);
        let fehler = t / decay - 1.0;
        println!("MESS decay {decay} s: measured -60 dB time {t:.4} s ({:+.1} %)", 100.0 * fehler);
        schlimmst = schlimmst.max(fehler.abs());
    }
    assert!(schlimmst < DECAY_TOLERANZ, "decay off by {:.1} %, limit {:.0} %", 100.0 * schlimmst, 100.0 * DECAY_TOLERANZ);
}

/// One hit of `note` on example `g` at the default knobs: the audio until it is 80 dB down (at most 8 s).
fn schlag(g: &str, note: u8) -> Vec<f32> {
    let mut p = lade(g);
    p.note_an(note, 1.0);
    let mut x = lauf(&mut p, 2_400);
    p.note_aus(note);
    x.extend(lauf(&mut p, 8 * 48_000 - 2_400));
    let x = links(&x);
    let spitze = x.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    let ende = x.iter().rposition(|v| v.abs() > spitze * 1e-4).unwrap_or(x.len() - 1);
    x[..=ende].to_vec()
}

/// Energy-weighted spectral centroid of the whole hit in Hz (Hann window over the hit, zero padded to a power of two).
fn schwerpunkt(x: &[f32]) -> f64 {
    let n = x.len().next_power_of_two().max(4_096);
    let mut y = vec![0.0f64; n];
    for (i, v) in x.iter().enumerate() {
        y[i] = *v as f64;
    }
    let s = spektrum(&y);
    let hz = SR as f64 / n as f64;
    let (a, b) = s.iter().enumerate().fold((0.0, 0.0), |(a, b), (i, e)| (a + i as f64 * hz * e, b + e));
    a / b
}

/// (name, graph, note, -60 dB time range in s, centroid range in Hz)
const ZIELE: [(&str, &str, u8, (f64, f64), (f64, f64)); 4] = [
    ("closed hat (hihat note 42)", HIHAT, 42, (0.04, 0.1), (8_000.0, 10_500.0)),
    ("open hat (hihat note 46)", HIHAT, 46, (0.4, 1.0), (6_500.0, 8_700.0)),
    ("ride (note 51)", RIDE, 51, (1.5, 3.5), (4_000.0, 6_000.0)),
    ("crash (note 49)", CRASH, 49, (2.0, 5.0), (6_000.0, 8_700.0)),
];

#[test]
fn beispiele_treffen_decay_und_schwerpunkt() {
    let mut fehler = Vec::new();
    let mut sp = Vec::new();
    for (name, g, note, (t0, t1), (c0, c1)) in ZIELE {
        let x = schlag(g, note);
        let (t, c) = (t60(&x), schwerpunkt(&x));
        let spitze = x.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        println!("MESS {name}: -60 dB time {t:.3} s (range {t0}..{t1}), centroid {c:.0} Hz (range {c0}..{c1}), peak {spitze:.3}");
        if !(t0..=t1).contains(&t) { fehler.push(format!("{name}: -60 dB time {t:.3} s outside {t0}..{t1}")); }
        if !(c0..=c1).contains(&c) { fehler.push(format!("{name}: centroid {c:.0} Hz outside {c0}..{c1}")); }
        sp.push(c);
    }
    // the closed hat is brighter than the open hat by at least 500 Hz
    if sp[0] < sp[1] + 500.0 { fehler.push(format!("closed hat centroid {:.0} Hz not 500 Hz above the open hat {:.0} Hz", sp[0], sp[1])); }
    assert!(fehler.is_empty(), "{}", fehler.join("\n"));
}

// ---------------------------------------------------------------------------------------------------------------------
// Choke

/// Open hat (decay 2 s) on note 46; after `vor` samples a silent hit (vel 0) on note 42 chokes it through the group.
/// Returns (audio, envelope) of the whole run, the choke at index `vor`, plus the reference without the second hit.
fn gewuergt(werte: &str, vor: usize, nach: usize) -> (Vec<(f32, f32)>, Vec<(f32, f32)>) {
    let g = graph(&format!(r#","decay":2{werte}"#), 4);
    let mut a = lade(&g);
    let mut b = lade(&g);
    a.note_an(46, 1.0);
    b.note_an(46, 1.0);
    let (mut x, mut r) = (lauf(&mut a, vor), lauf(&mut b, vor));
    a.note_an(42, 0.0);
    x.extend(lauf(&mut a, nach));
    r.extend(lauf(&mut b, nach));
    (x, r)
}

/// Choke time stated for the default `schnitt` 8 ms: -60 dB after 8 ms (plus one sample).
const SCHNITT_MS: f64 = 8.0;
/// Largest allowed per-sample fall of the envelope during the choke, relative to its value: 1 - e^(ln(0.001) / 384) =
/// 0.0178 at 48 kHz. A hard cut is a fall of 1.
const SCHRITT_GRENZE: f32 = 0.02;

#[test]
fn choke_schneidet_in_8_ms_ohne_sprung() {
    let (alles, _) = gewuergt("", 4_800, 4_800);
    let (vorher, x) = (&alles[4_752..4_800], &alles[4_800..]);
    let h0 = x[0].1;
    assert!(h0 > 0.5, "positive control: the open hat still rings ({h0})");
    let n60 = (SCHNITT_MS * 1e-3 * SR as f64).ceil() as usize + 1;
    let rest = x[n60].1 / h0;
    // per-sample relative fall of the envelope down to -80 dB under the level at the choke; the snap to 0 at -100 dB is no
    // audible step and is skipped
    let schritt = x.windows(2).filter(|w| w[0].1 > 1e-4 * h0).fold(0.0f32, |m, w| m.max((w[0].1 - w[1].1) / w[0].1));
    // the audio: the 1 ms window after the -60 dB point against the 1 ms window before the choke
    let db = rms_db(&links(&x[n60..n60 + 48])) - rms_db(&links(vorher));
    println!("MESS choke: envelope after {SCHNITT_MS} ms at {:.1} dB, audio window after it {db:.1} dB, largest relative step per sample {schritt:.4}", 20.0 * (rest as f64).log10());
    assert!(rest <= 1e-3, "the envelope is only {:.1} dB down after {SCHNITT_MS} ms", 20.0 * (rest as f64).log10());
    assert!(db < -60.0, "the audio is only {db:.1} dB down after {SCHNITT_MS} ms");
    assert!(schritt < SCHRITT_GRENZE, "the envelope falls by {schritt:.3} in one sample (limit {SCHRITT_GRENZE}): a click");
}

/// Gain the choke applies to the audio, per sample: choked output over the unchoked reference (same seed, so both are
/// the same signal before the envelope). Samples where the reference is near a zero crossing are skipped.
fn audio_verstaerkung(werte: &str) -> Vec<f32> {
    let (x, r) = gewuergt(werte, 4_800, 2_400);
    let spitze = r[4_800..].iter().fold(0.0f32, |m, v| m.max(v.0.abs()));
    x[4_800..].iter().zip(&r[4_800..]).filter(|(_, r)| r.0.abs() > 0.05 * spitze).map(|(x, r)| x.0 / r.0).collect()
}

#[test]
fn choke_ohne_klick_im_audio() {
    // A click is a step in the gain. Measured on the audio (not on the envelope output), so a step anywhere in the voice,
    // a filter reset at the choke for instance, shows as well. Consecutive valid samples may be a few samples apart, so
    // the bound is four times the per-sample fall of the envelope.
    let g = audio_verstaerkung("");
    assert!(g.len() > 100 && (g[0] - 1.0).abs() < 0.05, "positive control: the gain starts at 1 ({:?})", g.first());
    let schritt = g.windows(2).fold(0.0f32, |m, w| m.max((w[0] - w[1]).abs()));
    let ende = g.iter().rposition(|v| *v > 1e-3).unwrap_or(0);
    println!("MESS choke audio gain: largest change between valid samples {schritt:.4}, gain above -60 dB for {ende} valid samples");
    assert!(schritt < 4.0 * SCHRITT_GRENZE, "the audio gain steps by {schritt:.3} (limit {}): a click", 4.0 * SCHRITT_GRENZE);
    assert!(g.iter().all(|v| (-1e-6..=1.0 + 1e-4).contains(v)), "the choke must only attenuate, never flip or boost");
}

#[test]
fn gruppe_0_wuergt_nicht_und_choke_eingang_wuergt() {
    // gruppe 0: the second hit leaves the first ringing
    let (x, r) = gewuergt(r#","gruppe":0"#, 4_800, 960);
    assert!(x[4_801].1 > 0.5, "positive control: the first hit rings");
    // gruppe 1: two hits in the same sample (a chord, or closed hat and cymbal together) do not choke each other
    let mut p = lade(&graph(r#","decay":2"#, 4));
    p.note_an(42, 1.0);
    p.note_an(46, 1.0);
    let h = lauf(&mut p, 960)[959].1;
    println!("MESS group: two hits in one sample, envelope sum after 20 ms {h:.3}");
    assert!(h > 1.8, "two hits in one sample choked each other (envelope sum {h:.3})");
    // a voice struck again while its choke is still falling (2 ms in) rings again
    p.note_an(42, 1.0);
    lauf(&mut p, 96);
    p.note_an(46, 1.0);
    let h = lauf(&mut p, 960)[959].1;
    assert!(h > 0.9, "the open hat struck again after its choke does not ring (envelope {h:.3})");
    assert_eq!(x.iter().map(|v| v.1).collect::<Vec<_>>(), r.iter().map(|v| v.1).collect::<Vec<_>>(), "gruppe 0 must not choke");
    // the crash example: Grab at 1 chokes on note release within its 30 ms; at 0.5 (default) it rings on
    let ende = |griff: f32| {
        let mut p = lade(CRASH);
        p.setze_regler(6, griff);
        p.note_an(49, 1.0);
        let vor = links(&lauf(&mut p, 24_000));
        p.note_aus(49);
        let nach = links(&lauf(&mut p, 2_400));
        rms_db(&nach[1_488..1_536]) - rms_db(&vor[vor.len() - 48..])
    };
    let (an, aus) = (ende(1.0), ende(0.5));
    println!("MESS crash grab: 31 ms after release {an:.1} dB with Grab 1, {aus:.1} dB with Grab 0.5");
    assert!(an < -60.0, "Grab 1: only {an:.1} dB down 31 ms after release");
    assert!(aus > -3.0, "Grab 0.5 must not choke ({aus:.1} dB)");
}

// ---------------------------------------------------------------------------------------------------------------------
// Determinism, reset, robustness

fn spiel(g: &str) -> Vec<(f32, f32)> {
    let mut p = lade(g);
    let mut x = Vec::new();
    for n in [42u8, 46, 42, 51, 49, 42] {
        p.note_an(n, 0.9);
        x.extend(lauf(&mut p, 4_000));
        p.note_aus(n);
    }
    x
}

#[test]
fn gleicher_graph_gleicher_klang_andere_saat_anderer_klang() {
    let g = graph(r#","decay":0.5,"rauschen":0.3"#, 4);
    let (a, b) = (spiel(&g), spiel(&g));
    let ungleich = a.iter().zip(&b).filter(|(x, y)| x.0.to_bits() != y.0.to_bits()).count();
    assert_eq!(ungleich, 0, "{ungleich} samples differ between two loads of the same graph");
    let c = spiel(&graph(r#","decay":0.5,"rauschen":0.3,"saat":1"#, 4));
    assert!(a.iter().zip(&c).any(|(x, y)| x.0 != y.0), "another seed must give other phases and noise");
}

#[test]
fn still_ohne_anschlag() {
    let mut p = lade(&graph("", 4));
    assert!(lauf(&mut p, 48_000).iter().all(|v| v.0 == 0.0 && v.1 == 0.0), "a node without a hit must be silent");
}

#[test]
fn unsinnige_eingaenge_bleiben_endlich() {
    // two knobs over +-1e30 multiply to +-inf or to large finite values; times 0 the infinities become NaN. Every input
    // gets one of them: the output stays finite and the guard never has to rescue the graph.
    let g = r#"{"format":"baukasten/2","name":"m","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"m","art":"metall"},{"id":"o","art":"ausgang"},{"id":"k1","art":"regler","nr":1,"min":-1e30,"max":1e30},{"id":"k2","art":"regler","nr":2,"min":-1e30,"max":1e30},{"id":"g","art":"mul"},{"id":"nan","art":"mul","b":0}],"kanten":[{"von":"n.trig","nach":"m.trig"},{"von":"k1.aus","nach":"g.a"},{"von":"k2.aus","nach":"g.b"},{"von":"g.aus","nach":"nan.a"},{"von":"g.aus","nach":"m.vel"},{"von":"nan.aus","nach":"m.decay"},{"von":"g.aus","nach":"m.tune"},{"von":"nan.aus","nach":"m.farbe"},{"von":"g.aus","nach":"m.rauschen"},{"von":"nan.aus","nach":"m.hp"},{"von":"g.aus","nach":"m.choke"},{"von":"m.aus","nach":"o.x"}]}"#;
    let mut p = lade(g);
    for (a, b) in [(1.0, 1.0), (0.0, 1.0), (1.0, 0.5), (0.5, 0.5), (0.500_001, 0.500_001), (0.499_999, 0.500_001), (1.0, 1.0)] {
        p.setze_regler(1, a);
        p.setze_regler(2, b);
        p.note_an(60, 1.0);
        for (l, r) in lauf(&mut p, 2_000) {
            assert!(l.is_finite() && r.is_finite());
        }
    }
    assert_eq!(p.rettungen, 0, "the guard had to rescue the graph");
}

#[test]
fn schritte_folgen_tune_und_abtastrate() {
    // the run path uses `schritte`; a graph at 96 kHz plays the same frequencies (checked against 48 kHz steps)
    let (a, b) = (schritte(1.0, 48_000.0), schritte(1.0, 96_000.0));
    for i in 0..6 {
        assert!(((a[i] as f64) / (b[i] as f64) - 2.0).abs() < 1e-6);
    }
}
