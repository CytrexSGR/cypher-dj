//! Knob analyser for Baukasten instrument graphs: tells, without a listening round, whether and how much each knob changes the sound.
//!
//! A short phrase (2 bars at 128 BPM; a C2 line, a C3 line, a chord or a drum pattern) is rendered once at the graph's defaults and then
//! per knob at several positions. Every render is measured and compared with the default render: level, brightness, five band levels,
//! flatness, stereo width, timbre movement, effective length, and one "difference" figure D.
//!
//! D is a port of `hoerDiff` in ui/project/sound_runde.ts (the audibility measure of the find-sound round, same constants `HOER`,
//! same `SKALA`, same factor k): the part of the loudness picture (30 third-octave levels) that changed, with the level matched away,
//! combined with the change of effective length, crest, timbre movement and stereo width. The level is not matched away here (the
//! round plays at matched level, this tool answers "does it sound different"): it adds `PEGEL_EINHEIT` D per dB. Scale of D
//! (`ZIELE` in sound_runde_contract.ts): 1.2 subtle, 2.9 clear, 4.6 strong. Classes: below 0.6 "wirkt nicht", below 2.0 "leise",
//! below 3.75 "deutlich", from there "stark" (the midpoints between the three targets).
//!
//! Two terms are this tool's own (not in hoerDiff): the level (above) and the pitch. `tonhoehe_ct` finds the sideways shift of a fine
//! log-frequency picture (1/96 octave cells of one long FFT) that matches best; 100 cent count as `TON_EINHEIT` x 100 = 2.9 D. The
//! loudness picture alone cannot see a semitone at 65 Hz (a master tune knob used to read "wirkt nicht").
//! A knob that only adds energy below ~40 Hz (a clean sub) stays under the A-weighting; it gets the class `KLASSE_SUB` ("nur Sub")
//! when the sub energy changes by `SUB_GRENZE_DB` or more.
//!
//! Limits: the measure is a model of hearing, not hearing; a knob that only acts on a note not in the phrase (a velocity knob at
//! a velocity the phrase does not play, a drum piece not hit) can show "wirkt nicht". The phrase is chosen by category; `--noten
//! C2legato` (overlapping notes) and `--noten glide` (sixteen distinct pitches, so every voice sounds a new pitch after one it
//! played) exist for legato and glide knobs. A slow modulation with zero mean (a chaos or LFO depth) changes the mean spectrum
//! little, so it reads "leise" or "wirkt nicht" at a depth that is plainly audible; `--setze` holds other knobs (a closed filter, an
//! open mix) in every render to measure a knob behind them. Knobs that do nothing alone are also searched behind each effective
//! knob alone (not only behind all of them at once).
use crate::{uebersetze, Programm, REGLER};
use realfft::RealFftPlanner;
use serde::Serialize;
use std::collections::BTreeMap;

pub const SR: f32 = 48_000.0;
pub const BPM: f64 = 128.0;
/// Rendered length: 2 bars of 4 beats plus a tail.
pub const DAUER_S: f64 = 2.0 * 4.0 * 60.0 / BPM + 1.25;
const FENSTER: usize = 8192;
const SCHRITT: usize = 4096;
const NTERZ: usize = 30;

/// Constants of the audibility measure, copied from sound_runde_contract.ts (HOER, SKALA). Test: `konstanten_wie_klang_runde`.
pub const HOER_ALPHA: f64 = 0.3;
pub const HOER_BODEN: f64 = 60.0;
pub const HOER_S_SPEK: f64 = 6.0;
pub const HOER_S_FUELLE: f64 = 1.5;
pub const HOER_K: f64 = 0.34;
const SKALA_PUNCH: f64 = 2.0;
const SKALA_BEWEGUNG: f64 = 2.0;
const SKALA_BREITE: f64 = 3.0;
/// D per dB of level change (1.5 dB is one "subtle" step of 1.2).
pub const PEGEL_EINHEIT: f64 = 1.2 / 1.5;
/// D per cent of pitch shift: 100 cent (one semitone) is 2.9, the "deutlich" target.
pub const TON_EINHEIT: f64 = 2.9 / 100.0;
/// Class borders of D.
pub const GRENZE_LEISE: f64 = 0.6;
pub const GRENZE_DEUTLICH: f64 = 2.0;
pub const GRENZE_STARK: f64 = 3.75;
/// Class of a knob that only changes the sub-bass energy (A-weighted D below `GRENZE_LEISE`, sub energy changes by this many dB or more).
pub const KLASSE_SUB: &str = "nur Sub";
pub const SUB_GRENZE_DB: f64 = 1.5;

pub const BAENDER: [&str; 5] = ["sub", "tief", "mitte", "hoehen", "luft"];
const BAND_GRENZEN: [f64; 4] = [100.0, 300.0, 2000.0, 8000.0];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Noten {
    C2,
    C3,
    /// the C2 / C3 line with every note held 0.1 beat into the next: the notes overlap like a legato line (glide, legato modes)
    C2Legato,
    C3Legato,
    /// sixteen distinct pitches in a row (eight, then eight others a thirteenth higher): every voice of an 8-voice graph sounds a new pitch after one
    /// it played before, which is what a glide acts on (the voice allocator reuses a voice that held the same note)
    Gleiten,
    Akkord,
    Kit,
}

impl Noten {
    pub fn parse(s: &str) -> Option<Noten> {
        match s.to_lowercase().as_str() {
            "c2" => Some(Noten::C2),
            "c3" => Some(Noten::C3),
            "glide" | "gleiten" => Some(Noten::Gleiten),
            "c2legato" | "c2-legato" => Some(Noten::C2Legato),
            "c3legato" | "c3-legato" => Some(Noten::C3Legato),
            "chord" | "akkord" => Some(Noten::Akkord),
            "kit" | "drums" => Some(Noten::Kit),
            _ => None,
        }
    }
    /// The phrase for a category of kategorien.json.
    pub fn fuer_kategorie(k: &str) -> Noten {
        match k {
            "bass" => Noten::C2,
            "lead" => Noten::C3,
            "drums" => Noten::Kit,
            _ => Noten::Akkord, // pad, keys, textur
        }
    }
    /// (note, start beat, length in beats, velocity)
    pub fn ereignisse(self) -> Vec<(u8, f64, f64, f32)> {
        match self {
            Noten::C2 | Noten::C3 | Noten::C2Legato | Noten::C3Legato => {
                let o: i32 = if matches!(self, Noten::C3 | Noten::C3Legato) { 12 } else { 0 };
                let ueber = if matches!(self, Noten::C2Legato | Noten::C3Legato) { 0.1 } else { 0.0 };
                let l: [(i32, f64, f64, f32); 11] = [
                    (36, 0.0, 1.5, 0.85), (36, 1.5, 0.5, 0.7), (39, 2.0, 0.5, 0.8), (36, 2.5, 0.5, 0.7), (43, 3.0, 0.5, 0.8), (41, 3.5, 0.5, 0.7),
                    (36, 4.0, 1.5, 0.85), (36, 5.5, 0.5, 0.7), (39, 6.0, 0.5, 0.8), (34, 6.5, 0.5, 0.7), (36, 7.0, 0.75, 0.9),
                ];
                let letzte = l.len() - 1;
                l.iter().enumerate().map(|(i, &(n, s, g, v))| ((n + o) as u8, s, if i < letzte && l[i + 1].0 != n { g + ueber } else { g }, v)).collect()
            }
            Noten::Gleiten => {
                let n: [u8; 16] = [36, 38, 40, 41, 43, 45, 47, 48, 49, 51, 53, 54, 56, 58, 60, 61];
                n.iter().enumerate().map(|(i, &x)| (x, i as f64 * 0.5, 0.45, 0.8)).collect()
            }
            Noten::Akkord => {
                let mut v = Vec::new();
                for n in [48u8, 51, 55, 58] { v.push((n, 0.0, 3.5, 0.8)); }
                for n in [53u8, 56, 60] { v.push((n, 4.0, 3.5, 0.8)); }
                v
            }
            Noten::Kit => {
                let mut v = Vec::new();
                for b in 0..8 { v.push((42u8, b as f64 + 0.5, 0.1, 0.8)); }
                for b in [0.0, 2.0, 4.0, 6.0, 7.5] { v.push((36u8, b, 0.1, 0.95)); }
                for b in [1.0, 3.0, 5.0, 7.0] { v.push((38u8, b, 0.1, 0.9)); }
                v
            }
        }
    }
}

/// Render the phrase. `knoepfe` are (number 1..64, travel 0..1) set before the first sample.
pub fn rendere(json: &str, noten: Noten, knoepfe: &[(usize, f32)]) -> Result<Vec<(f32, f32)>, String> {
    let mut p: Programm = uebersetze(json, SR).map_err(|e| format!("graph invalid: {e}"))?;
    p.setze_takt(0.0, BPM / 60.0 / SR as f64);
    for &(n, w) in knoepfe { p.setze_regler(n, w); }
    let spb = 60.0 / BPM * SR as f64; // samples per beat
    let mut ev: Vec<(usize, bool, u8, f32)> = Vec::new();
    for (n, s, l, v) in noten.ereignisse() {
        ev.push(((s * spb) as usize, true, n, v));
        ev.push((((s + l) * spb) as usize, false, n, 0.0));
    }
    ev.sort_by_key(|e| (e.0, e.1));
    let gesamt = (DAUER_S * SR as f64) as usize;
    let mut x = Vec::with_capacity(gesamt);
    let mut ei = 0;
    for i in 0..gesamt {
        while ei < ev.len() && ev[ei].0 <= i {
            let (_, an, n, v) = ev[ei];
            if an { p.note_an(n, v) } else { p.note_aus(n) }
            ei += 1;
        }
        let (l, r) = p.sample_stereo();
        x.push((if l.is_finite() { l } else { 0.0 }, if r.is_finite() { r } else { 0.0 }));
    }
    Ok(x)
}

/// Measurement of one render.
#[derive(Clone, Debug, Serialize)]
pub struct Messung {
    pub stumm: bool,
    pub rms_db: f64,
    pub peak_db: f64,
    pub crest_db: f64,
    /// power-weighted geometric mean frequency of the mean spectrum
    pub schwerpunkt_hz: f64,
    /// energy per band (sub <100, tief 100-300, mitte 300-2k, hoehen 2k-8k, luft >8k), dB of mean square
    pub baender_db: [f64; 5],
    /// spectral flatness 50 Hz..16 kHz of the mean spectrum (geometric over arithmetic mean), dB (0 = noise, very negative = tonal)
    pub flachheit_db: f64,
    /// side over mid power, dB (clamped -40..12)
    pub breite_db: f64,
    /// timbre movement (mean change of the level-relative third-octave picture between frames, dB)
    pub bewegung: f64,
    /// standard deviation of the frame brightness in semitones (active frames)
    pub schwerpunkt_bewegung_st: f64,
    /// effective length, dB (0 = holds its level through the render)
    pub fuelle_db: f64,
    /// A-weighted level of the mean spectrum (what the level difference and the loudness picture use), dB
    pub a_pegel_db: f64,
    #[serde(skip)]
    pub terz: Vec<f64>,
    /// fine log-frequency picture of the whole render (FEIN_ZELLEN cells of 1/96 octave from FEIN_HZ), for the pitch shift
    #[serde(skip)]
    pub fein: Vec<f64>,
}

/// A-weighting in dB at f Hz (IEC 61672).
pub fn a_gewicht_db(f: f64) -> f64 {
    let f2 = f * f;
    let ra = 12194f64.powi(2) * f2 * f2 / ((f2 + 20.6f64.powi(2)) * ((f2 + 107.7f64.powi(2)) * (f2 + 737.9f64.powi(2))).sqrt() * (f2 + 12194f64.powi(2)));
    20.0 * ra.log10() + 2.0
}

fn db(p: f64) -> f64 { 10.0 * p.max(1e-20).log10() }

/// Fine log-frequency picture: one long FFT of the mono mix (0.2 Hz bins), amplitude summed into cells of 1/96 octave from 40 Hz and
/// smoothed over +-2 cells. A pitch change of the whole sound moves it sideways; the 8192 window of the loudness picture cannot see
/// anything below a semitone at 65 Hz.
const FEIN_HZ: f64 = 40.0;
const FEIN_ZELLEN: usize = 600;
const FEIN_PRO_OKTAVE: f64 = 96.0;

fn fein_bild(x: &[(f32, f32)]) -> Vec<f64> {
    let n = x.len().next_power_of_two().max(FENSTER);
    let mut plan = RealFftPlanner::<f32>::new();
    let fft = plan.plan_fft_forward(n);
    let mut ein = fft.make_input_vec();
    let mut aus = fft.make_output_vec();
    let len = x.len().max(1);
    for (i, &(l, r)) in x.iter().enumerate() {
        let w = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / len as f32).cos();
        ein[i] = 0.5 * (l + r) * w;
    }
    fft.process(&mut ein, &mut aus).unwrap();
    let bin_hz = SR as f64 / n as f64;
    let mut z = vec![0f64; FEIN_ZELLEN];
    for k in 1..aus.len() {
        let f = k as f64 * bin_hz;
        if f < FEIN_HZ { continue; }
        let c = ((f / FEIN_HZ).log2() * FEIN_PRO_OKTAVE) as usize;
        if c >= FEIN_ZELLEN { break; }
        z[c] += aus[k].norm_sqr() as f64;
    }
    let z: Vec<f64> = z.iter().map(|v| v.sqrt()).collect();
    let mut g = vec![0f64; FEIN_ZELLEN];
    for c in 0..FEIN_ZELLEN {
        for d in -2i32..=2 {
            let j = c as i32 + d;
            if j >= 0 && (j as usize) < FEIN_ZELLEN { g[c] += z[j as usize] * (3 - d.abs()) as f64; }
        }
    }
    g
}

/// Pitch shift of the whole sound from variant against default in cent: the sideways shift (+-24 cells of 12.5 cent, parabolic peak)
/// that makes the fine pictures match best; 0 when they match badly at every shift (the sound is a different sound, not a shifted one).
pub fn tonhoehe_ct(a: &[f64], v: &[f64]) -> f64 {
    if a.len() != v.len() || a.is_empty() { return 0.0; }
    let korr = |sh: i32| -> f64 {
        let (mut ab, mut aa, mut bb) = (0f64, 0f64, 0f64);
        for c in 0..a.len() {
            let j = c as i32 + sh;
            if j < 0 || j as usize >= v.len() { continue; }
            let (p, q) = (a[c].sqrt(), v[j as usize].sqrt());
            ab += p * q; aa += p * p; bb += q * q;
        }
        if aa > 0.0 && bb > 0.0 { ab / (aa * bb).sqrt() } else { 0.0 }
    };
    let ks: Vec<f64> = (-24..=24).map(korr).collect();
    let (bi, &bk) = ks.iter().enumerate().max_by(|x, y| x.1.partial_cmp(y.1).unwrap()).unwrap();
    if bk < 0.5 || bi == 0 || bi == ks.len() - 1 { return 0.0; }
    let (l, m, r) = (ks[bi - 1], ks[bi], ks[bi + 1]);
    let den = l - 2.0 * m + r;
    let off = if den.abs() > 1e-12 { 0.5 * (l - r) / den } else { 0.0 };
    (bi as f64 - 24.0 + off.clamp(-0.5, 0.5)) * (1200.0 / FEIN_PRO_OKTAVE)
}

pub fn messe(x: &[(f32, f32)]) -> Messung {
    let n = x.len().max(1);
    let (mut ql, mut qr, mut qm, mut qs, mut sp) = (0f64, 0f64, 0f64, 0f64, 0f64);
    for &(l, r) in x {
        let (l, r) = (l as f64, r as f64);
        ql += l * l; qr += r * r;
        qm += ((l + r) / 2.0).powi(2); qs += ((l - r) / 2.0).powi(2);
        sp = sp.max(l.abs()).max(r.abs());
    }
    let ms = (ql + qr) / (2 * n) as f64;
    let rms_db = db(ms);
    let peak_db = db(sp * sp);
    let breite_db = if qm + qs <= 1e-18 { -40.0 } else { (db(qs / n as f64) - db(qm / n as f64)).clamp(-40.0, 12.0) };
    let stumm = rms_db < -120.0;
    let mut m = Messung {
        stumm, rms_db, peak_db, crest_db: peak_db - rms_db, schwerpunkt_hz: 0.0, baender_db: [-200.0; 5], flachheit_db: 0.0, breite_db,
        bewegung: 0.0, schwerpunkt_bewegung_st: 0.0, fuelle_db: -40.0, a_pegel_db: -200.0, terz: vec![-200.0; NTERZ], fein: Vec::new(),
    };
    if stumm { m.crest_db = 0.0; return m; }

    let mut plan = RealFftPlanner::<f32>::new();
    let fft = plan.plan_fft_forward(FENSTER);
    let w: Vec<f32> = (0..FENSTER).map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / FENSTER as f32).cos()).collect();
    let sw2: f64 = w.iter().map(|&v| (v as f64).powi(2)).sum();
    let nb = FENSTER / 2 + 1;
    let bin_hz = SR as f64 / FENSTER as f64;
    let terz_von = |k: usize| -> Option<usize> {
        let f = k as f64 * bin_hz;
        if f < 22.0 { return None; }
        Some(((3.0 * (f / 25.0).log2()).round().max(0.0) as usize).min(NTERZ - 1))
    };
    let mut mittel = vec![0f64; nb];
    let mut spalten: Vec<[f64; NTERZ]> = Vec::new();
    let mut spalten_hell: Vec<(f64, f64)> = Vec::new(); // (frame power, log-centroid in octaves)
    let mut ein = fft.make_input_vec();
    let mut aus = fft.make_output_vec();
    let mut start = 0;
    while start + FENSTER <= x.len() {
        let mut p = vec![0f64; nb];
        for seite in 0..2 {
            for i in 0..FENSTER {
                let v = if seite == 0 { x[start + i].0 } else { x[start + i].1 };
                ein[i] = v * w[i];
            }
            fft.process(&mut ein, &mut aus).unwrap();
            for k in 1..nb - 1 {
                p[k] += 0.5 * 2.0 * (aus[k].norm_sqr() as f64) / (FENSTER as f64 * sw2);
            }
        }
        let mut z = [0f64; NTERZ];
        let (mut sum, mut mitlog) = (0f64, 0f64);
        for k in 1..nb - 1 {
            mittel[k] += p[k];
            if let Some(t) = terz_von(k) { z[t] += p[k]; }
            if k as f64 * bin_hz >= 20.0 { sum += p[k]; mitlog += p[k] * (k as f64 * bin_hz).log2(); }
        }
        spalten.push(z.map(|v| db(v)));
        spalten_hell.push((sum, if sum > 0.0 { mitlog / sum } else { 0.0 }));
        start += SCHRITT;
    }
    let nf = spalten.len().max(1) as f64;
    for v in mittel.iter_mut() { *v /= nf; }

    // bands, centroid, flatness of the mean spectrum
    let mut band = [0f64; 5];
    let (mut sum, mut mitlog) = (0f64, 0f64);
    let (mut lg, mut ar, mut cnt) = (0f64, 0f64, 0usize);
    let mut terz_p = [0f64; NTERZ];
    let mut a_summe = 0f64;
    for k in 1..nb - 1 {
        let f = k as f64 * bin_hz;
        let b = BAND_GRENZEN.iter().take_while(|&&g| f >= g).count();
        band[b] += mittel[k];
        if f >= 20.0 { sum += mittel[k]; mitlog += mittel[k] * f.log2(); }
        if (50.0..16000.0).contains(&f) { lg += mittel[k].max(1e-30).ln(); ar += mittel[k]; cnt += 1; }
        if let Some(t) = terz_von(k) { terz_p[t] += mittel[k] * 10f64.powf(a_gewicht_db(f) / 10.0); }
        if f >= 20.0 { a_summe += mittel[k] * 10f64.powf(a_gewicht_db(f) / 10.0); }
    }
    m.a_pegel_db = db(a_summe);
    m.baender_db = band.map(db);
    m.schwerpunkt_hz = if sum > 0.0 { 2f64.powf(mitlog / sum) } else { 0.0 };
    m.flachheit_db = if cnt > 0 && ar > 0.0 { 10.0 * (lg / cnt as f64).exp().log10() - 10.0 * (ar / cnt as f64).log10() } else { 0.0 };
    m.terz = terz_p.iter().map(|&v| db(v)).collect();
    m.fein = fein_bild(x);

    // movement and effective length (port of zeitMerkmale): every column relative to its own level
    let nsp = spalten.len();
    if nsp > 0 {
        let pegel: Vec<f64> = spalten.iter().map(|z| db(z.iter().map(|&v| 10f64.powf(v / 10.0)).sum())).collect();
        let kraft: Vec<f64> = pegel.iter().map(|&v| 10f64.powf(v / 10.0)).collect();
        let lauteste = pegel.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let (mut summe, mut anzahl) = (0f64, 0usize);
        for c in 1..nsp {
            if pegel[c] < lauteste - 40.0 || pegel[c - 1] < lauteste - 40.0 { continue; }
            for j in 0..NTERZ {
                let a = (spalten[c - 1][j] - pegel[c - 1]).max(-40.0);
                let b = (spalten[c][j] - pegel[c]).max(-40.0);
                if a.max(b) > -30.0 { summe += (b - a).abs(); anzahl += 1; }
            }
        }
        m.bewegung = if anzahl > 0 { summe / anzahl as f64 } else { 0.0 };
        let (sa, sa2) = (kraft.iter().map(|v| v.sqrt()).sum::<f64>(), kraft.iter().sum::<f64>());
        m.fuelle_db = if sa2 > 0.0 { db(sa * sa / (nsp as f64 * sa2)).max(-40.0) } else { -40.0 };
        // brightness movement in semitones over active frames
        let lp: Vec<f64> = spalten_hell.iter().map(|&(p, _)| db(p)).collect();
        let lmax = lp.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let akt: Vec<f64> = spalten_hell.iter().zip(&lp).filter(|(_, &l)| l > lmax - 40.0).map(|(&(_, h), _)| 12.0 * h).collect();
        if akt.len() > 1 {
            let mu = akt.iter().sum::<f64>() / akt.len() as f64;
            m.schwerpunkt_bewegung_st = (akt.iter().map(|v| (v - mu).powi(2)).sum::<f64>() / akt.len() as f64).sqrt();
        }
    }
    m
}

/// The parts of D (see hoerDiff): `spek` (what changed of the loudness picture), `fuelle`, `punch`, `bewegung`, `breite`, `pegel`.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Teile {
    pub spek: f64,
    pub fuelle: f64,
    pub punch: f64,
    pub bewegung: f64,
    pub breite: f64,
    pub pegel: f64,
}

/// Difference of a variant against the default.
#[derive(Clone, Debug, Serialize)]
pub struct Unterschied {
    pub d: f64,
    pub d_klang: f64,
    pub teile: Teile,
    pub pegel_db: f64,
    /// unweighted RMS change, dB (the A-weighted `pegel_db` hardly sees a sub-bass layer)
    pub rms_roh_db: f64,
    /// pitch shift of the whole sound in cent (positive = higher), see `tonhoehe_ct`
    pub ton_ct: f64,
    pub peak_db: f64,
    pub hell_st: f64,
    /// band share change with the level matched away, dB (sub, tief, mitte, hoehen, luft)
    pub baender_delta_db: [f64; 5],
    pub flachheit_delta_db: f64,
    pub breite_delta_db: f64,
    pub bewegung_delta: f64,
    pub schwerpunkt_bewegung_delta_st: f64,
    pub fuelle_delta_db: f64,
    pub punch_delta_db: f64,
    pub stumm: bool,
    /// the default is silent and the variant is not (or the other way round)
    pub stille_wechsel: bool,
}

pub fn vergleiche(a: &Messung, v: &Messung) -> Unterschied {
    let mut u = Unterschied {
        d: 0.0, d_klang: 0.0, teile: Teile::default(), pegel_db: 0.0, rms_roh_db: 0.0, ton_ct: 0.0, peak_db: v.peak_db - a.peak_db, hell_st: 0.0, baender_delta_db: [0.0; 5],
        flachheit_delta_db: 0.0, breite_delta_db: 0.0, bewegung_delta: 0.0, schwerpunkt_bewegung_delta_st: 0.0, fuelle_delta_db: 0.0,
        punch_delta_db: 0.0, stumm: v.stumm && !a.stumm, stille_wechsel: a.stumm != v.stumm,
    };
    if a.stumm || v.stumm {
        // a variant that falls silent (or wakes up) is the strongest difference there is
        if a.stumm != v.stumm { u.d = 10.0; u.d_klang = 10.0; u.pegel_db = v.rms_db.max(-200.0) - a.rms_db.max(-200.0); }
        return u;
    }
    let shift = v.a_pegel_db - a.a_pegel_db; // A-weighted: a change in the sub that no speaker plays is not a level change
    u.pegel_db = shift;
    u.rms_roh_db = v.rms_db - a.rms_db;
    u.ton_ct = tonhoehe_ct(&a.fein, &v.fein);
    u.hell_st = 12.0 * (v.schwerpunkt_hz / a.schwerpunkt_hz).log2();
    for i in 0..5 { u.baender_delta_db[i] = (v.baender_db[i] - (v.rms_db - a.rms_db)) - a.baender_db[i]; }
    u.flachheit_delta_db = v.flachheit_db - a.flachheit_db;
    u.breite_delta_db = v.breite_db - a.breite_db;
    u.bewegung_delta = v.bewegung - a.bewegung;
    u.schwerpunkt_bewegung_delta_st = v.schwerpunkt_bewegung_st - a.schwerpunkt_bewegung_st;
    u.fuelle_delta_db = v.fuelle_db - a.fuelle_db;
    u.punch_delta_db = v.crest_db - a.crest_db;

    let refp = a.terz.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let nf = |l: f64| -> f64 { if l < refp - HOER_BODEN { 0.0 } else { 10f64.powf(HOER_ALPHA * (l - refp) / 10.0) } };
    let (mut diff, mut summe) = (0f64, 0f64);
    for i in 0..NTERZ {
        let na = nf(a.terz[i]);
        diff += (nf(v.terz[i] - shift) - na).abs();
        summe += na;
    }
    let t = Teile {
        spek: if summe > 0.0 { 100.0 * diff / summe / HOER_S_SPEK } else { 0.0 },
        fuelle: (v.fuelle_db - a.fuelle_db) / HOER_S_FUELLE,
        punch: (v.crest_db - a.crest_db) / (2.0 * SKALA_PUNCH),
        bewegung: (v.bewegung - a.bewegung) / (2.0 * SKALA_BEWEGUNG),
        breite: (v.breite_db - a.breite_db) / (2.0 * SKALA_BREITE),
        pegel: 0.0, // the level is added below with the unit of this tool
    };
    let q: f64 = [t.spek, t.fuelle, t.punch, t.bewegung, t.breite].iter().map(|x| x * x).sum();
    u.d_klang = HOER_K * q.sqrt();
    // this tool's own terms, not in hoerDiff: the level (see above) and the pitch (a semitone counts as a clear difference)
    u.d = (u.d_klang.powi(2) + (PEGEL_EINHEIT * shift).powi(2) + (TON_EINHEIT * u.ton_ct).powi(2)).sqrt();
    u.teile = t;
    u.teile.pegel = shift / 6.0;
    u
}

pub fn klasse(d: f64) -> &'static str {
    if d < GRENZE_LEISE { "wirkt nicht" } else if d < GRENZE_DEUTLICH { "leise" } else if d < GRENZE_STARK { "deutlich" } else { "stark" }
}

/// Direction in a few German words from the leading features of a difference.
pub fn beschreibe(u: &Unterschied) -> String {
    if u.stumm { return "wird stumm".into(); }
    if u.stille_wechsel { return "springt aus der Stille an".into(); }
    // (strength in scale units, word) ; scale units as SKALA of sound_runde_contract.ts
    let mut f: Vec<(f64, String)> = Vec::new();
    let hoch = (u.baender_delta_db[3] + u.baender_delta_db[4]) / 2.0;
    let hell = u.hell_st / 1.8;
    if hell.abs() >= 0.5 {
        if hell > 0.0 { f.push((hell.abs(), if hoch > 1.5 { "heller, mehr Obertöne".into() } else { "heller".into() })); }
        else { f.push((hell.abs(), if hoch < -1.5 { "dunkler, weniger Obertöne".into() } else { "dunkler".into() })); }
    }
    let wb = [("Sub", 2.0), ("Bass", 3.0), ("Mitten", 3.0), ("Höhen", 3.0), ("Luft", 3.0)];
    for i in 0..5 {
        if hell.abs() >= 0.5 && (i == 3 || i == 4) && hell * u.baender_delta_db[i] > 0.0 { continue; } // already named by the brightness word
        let e = u.baender_delta_db[i] / wb[i].1;
        if e.abs() >= 0.7 { f.push((e.abs(), format!("{} {}", if e > 0.0 { "mehr" } else { "weniger" }, wb[i].0))); }
    }
    if u.ton_ct.abs() >= 15.0 { f.push((u.ton_ct.abs() / 50.0, format!("{} um {:.0} ct", if u.ton_ct > 0.0 { "höher" } else { "tiefer" }, u.ton_ct.abs()))); }
    let w = u.breite_delta_db / 3.0;
    if w.abs() >= 0.5 { f.push((w.abs(), if w > 0.0 { "breiter" } else { "schmaler" }.into())); }
    let fl = u.flachheit_delta_db / 5.0;
    if fl.abs() >= 0.5 { f.push((fl.abs(), if fl > 0.0 { "rauschiger" } else { "tonaler" }.into())); }
    let b = u.bewegung_delta / 2.0;
    let bs = u.schwerpunkt_bewegung_delta_st / 1.5;
    let bm = if b.abs() >= bs.abs() { b } else { bs };
    if bm.abs() >= 0.5 { f.push((bm.abs(), if bm > 0.0 { "bewegt sich mehr" } else { "ruhiger" }.into())); }
    let fu = u.fuelle_delta_db / 1.0;
    if fu.abs() >= 0.5 { f.push((fu.abs(), if fu > 0.0 { "länger" } else { "kürzer" }.into())); }
    let pu = u.punch_delta_db / 2.0;
    if pu.abs() >= 0.7 { f.push((pu.abs(), if pu > 0.0 { "mehr Punch" } else { "weicher" }.into())); }
    f.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
    let mut teile: Vec<String> = Vec::new();
    if u.pegel_db.abs() >= 1.5 {
        teile.push(format!("{} um {:.0} dB", if u.pegel_db > 0.0 { "lauter" } else { "leiser" }, u.pegel_db.abs().round().max(1.0)));
    }
    for (_, s) in f.into_iter().take(if teile.is_empty() { 2 } else { 1 }) { teile.push(s); }
    if teile.is_empty() { "kaum ein Unterschied".into() } else { teile.join(", ") }
}

/// What the graph says about its knobs.
#[derive(Clone, Debug)]
pub struct ReglerInfo {
    pub nr: usize,
    pub name: String,
    /// number of steps when every `regler` node of this number is an integer stepper with a range of 2..15
    pub stufen: Option<usize>,
    pub knoten: usize,
}

pub fn regler_info(json: &str) -> Result<Vec<ReglerInfo>, String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let namen: BTreeMap<usize, String> = v.get("regler_namen").and_then(|n| n.as_object()).map(|o| {
        o.iter().filter_map(|(k, s)| Some((k.parse().ok()?, s.as_str()?.to_string()))).collect()
    }).unwrap_or_default();
    let mut nodes: BTreeMap<usize, (usize, bool, f64)> = BTreeMap::new(); // nr -> (count, all stepped, range)
    for k in v.get("knoten").and_then(|k| k.as_array()).into_iter().flatten() {
        if k.get("art").and_then(|a| a.as_str()) != Some("regler") { continue; }
        let nr = k.get("nr").and_then(|n| n.as_u64()).unwrap_or(0) as usize;
        let (mn, mx) = (k.get("min").and_then(|n| n.as_f64()).unwrap_or(0.0), k.get("max").and_then(|n| n.as_f64()).unwrap_or(1.0));
        let log = k.get("log").and_then(|n| n.as_f64()).unwrap_or(0.0) == 1.0;
        let gestuft = !log && mn.fract() == 0.0 && mx.fract() == 0.0 && (mx - mn).abs() >= 2.0 && (mx - mn).abs() <= 15.0;
        let e = nodes.entry(nr).or_insert((0, true, (mx - mn).abs()));
        e.0 += 1;
        e.1 &= gestuft;
        e.2 = e.2.max((mx - mn).abs());
    }
    let mut nrs: Vec<usize> = nodes.keys().cloned().chain(namen.keys().cloned()).collect();
    nrs.sort();
    nrs.dedup();
    Ok(nrs.into_iter().filter(|n| (1..=REGLER).contains(n)).map(|nr| {
        let (knoten, gest, bereich) = nodes.get(&nr).cloned().unwrap_or((0, false, 0.0));
        ReglerInfo { nr, name: namen.get(&nr).cloned().unwrap_or_else(|| format!("k{nr}")), stufen: if gest { Some(bereich as usize + 1) } else { None }, knoten }
    }).collect())
}

/// Travel positions to try: every step of a stepper, else 0, .25, .5, .75, 1 (.5 is there for a selector of three zones).
pub fn positionen(stufen: Option<usize>) -> Vec<f32> {
    match stufen {
        Some(n) => (0..n).map(|i| i as f32 / (n - 1) as f32).collect(),
        None => vec![0.0, 0.25, 0.5, 0.75, 1.0],
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Position {
    pub wert: f32,
    pub messung: Messung,
    pub unterschied: Unterschied,
    pub beschreibung: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReglerBericht {
    pub nr: usize,
    pub name: String,
    pub art: &'static str,
    pub vorgabe: f32,
    pub klasse: &'static str,
    pub beschreibung: String,
    pub d_max: f64,
    pub staerkster_wert: Option<f32>,
    pub positionen: Vec<Position>,
    /// only for a knob that does nothing alone: what it does when the knobs that open the sound are on (see `analysiere`)
    pub bedingt: Option<Bedingt>,
}

/// A knob that does nothing at the defaults but acts once other knobs are turned on (a depth knob behind a mode switch, a rate behind an amount).
#[derive(Clone, Debug, Serialize)]
pub struct Bedingt {
    pub klasse: &'static str,
    pub d_max: f64,
    pub staerkster_wert: f32,
    pub beschreibung: String,
    /// the opening knob that made it act most: (number, its setting, D of the knob on top of it)
    pub oeffner: Option<(usize, f32, f64)>,
    /// the knobs that were on in the first test (every knob with an effect at its strongest setting)
    pub kontext: Vec<(usize, f32)>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Bericht {
    pub graph: String,
    pub noten: Noten,
    pub bpm: f64,
    pub dauer_s: f64,
    pub grundzustand: Messung,
    /// D of two renders at the defaults (0 when the render is reproducible)
    pub grundrauschen_d: f64,
    pub grenzen: [f64; 3],
    pub regler: Vec<ReglerBericht>,
}

pub struct Optionen {
    pub noten: Noten,
    /// only these knobs (None = all)
    pub knoepfe: Option<Vec<usize>>,
    pub threads: usize,
    /// knobs set (number, travel) in every render, the default render included: analyse a knob behind another one (`--setze k46=0.6`)
    pub basis: Vec<(usize, f32)>,
    /// travel positions for the continuous knobs instead of 0, .25, .5, .75, 1 (steppers keep every step): `--pos 0.6` measures a knob at 60 %
    pub stellungen: Option<Vec<f32>>,
}

/// Analyse a graph (JSON text): the default render and every knob at its positions.
/// The positions to try for a knob under these options.
fn stellungen(o: &Optionen, stufen: Option<usize>) -> Vec<f32> {
    match (&o.stellungen, stufen) { (Some(p), None) => p.clone(), _ => positionen(stufen) }
}

/// Fewer positions for the search behind each single knob (the many renders of the third test): the two ends of a continuous knob.
fn stellungen_kurz(o: &Optionen, stufen: Option<usize>) -> Vec<f32> {
    match (&o.stellungen, stufen) { (None, None) => vec![0.0, 1.0], _ => stellungen(o, stufen) }
}

/// `rendere` with the base settings of the options under the given knob settings.
fn rendere_mit(json: &str, o: &Optionen, knoepfe: &[(usize, f32)]) -> Result<Vec<(f32, f32)>, String> {
    let mut k = o.basis.clone();
    k.extend_from_slice(knoepfe);
    rendere(json, o.noten, &k)
}

pub fn analysiere(json: &str, name: &str, o: &Optionen) -> Result<Bericht, String> {
    let info: Vec<ReglerInfo> = regler_info(json)?.into_iter().filter(|r| o.knoepfe.as_ref().map_or(true, |k| k.contains(&r.nr))).collect();
    if let Some(k) = &o.knoepfe {
        for n in k { if !info.iter().any(|r| r.nr == *n) { return Err(format!("knob k{n} not in the graph")); } }
    }
    let vorgaben = uebersetze(json, SR).map_err(|e| format!("graph invalid: {e}"))?.regler_vorgaben();
    let grund = rendere_mit(json, o, &[])?;
    let a = messe(&grund);
    let zweite = messe(&rendere_mit(json, o, &[])?);
    let grundrauschen_d = vergleiche(&a, &zweite).d;

    // every render of the analysis is a list of knob settings; run them on up to two threads
    let laufe = |auftraege: &[Vec<(usize, f32)>]| -> Result<Vec<Messung>, String> {
        let ergebnis: std::sync::Mutex<Vec<Option<Result<Messung, String>>>> = std::sync::Mutex::new((0..auftraege.len()).map(|_| None).collect());
        let naechster = std::sync::atomic::AtomicUsize::new(0);
        std::thread::scope(|s| {
            for _ in 0..o.threads.clamp(1, 2) {
                s.spawn(|| loop {
                    let j = naechster.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    if j >= auftraege.len() { break; }
                    let m = rendere_mit(json, o, &auftraege[j]).map(|x| messe(&x));
                    ergebnis.lock().unwrap()[j] = Some(m);
                });
            }
        });
        ergebnis.into_inner().unwrap().into_iter().map(|e| e.unwrap()).collect()
    };

    // jobs: (index into info, travel)
    let mut jobs: Vec<(usize, f32)> = Vec::new();
    for (i, r) in info.iter().enumerate() {
        if r.knoten == 0 { continue; }
        for w in stellungen(o, r.stufen) { jobs.push((i, w)); }
    }
    let auftraege: Vec<Vec<(usize, f32)>> = jobs.iter().map(|&(i, w)| vec![(info[i].nr, w)]).collect();
    let ergebnis = laufe(&auftraege)?;

    let mut regler = Vec::new();
    for (i, r) in info.iter().enumerate() {
        let vorgabe = vorgaben[r.nr - 1];
        let art = if r.stufen.is_some() { "gestuft" } else { "stetig" };
        if r.knoten == 0 {
            regler.push(ReglerBericht { nr: r.nr, name: r.name.clone(), art, vorgabe, klasse: "wirkt nicht", beschreibung: "kein Regler-Knoten im Graphen".into(), d_max: 0.0, staerkster_wert: None, positionen: vec![], bedingt: None });
            continue;
        }
        let mut pos = Vec::new();
        for (j, &(ji, w)) in jobs.iter().enumerate() {
            if ji != i { continue; }
            let m = ergebnis[j].clone();
            let u = vergleiche(&a, &m);
            let b = beschreibe(&u);
            pos.push(Position { wert: w, messung: m, unterschied: u, beschreibung: b });
        }
        let best = pos.iter().max_by(|x, y| x.unterschied.d.partial_cmp(&y.unterschied.d).unwrap());
        let (d_max, wert, text) = best.map(|p| (p.unterschied.d, Some(p.wert), p.beschreibung.clone())).unwrap_or((0.0, None, String::new()));
        let mut klasse = klasse(d_max);
        let mut beschreibung = if klasse == "wirkt nicht" { "kein hörbarer Unterschied".to_string() } else { text };
        let mut wert = wert;
        // D is A-weighted: a layer below ~40 Hz (a clean sub) is "wirkt nicht" although it adds energy. Name that case.
        if klasse == "wirkt nicht" {
            let sub = |p: &Position| p.unterschied.baender_delta_db[0] + p.unterschied.rms_roh_db;
            if let Some(p) = pos.iter().max_by(|x, y| sub(x).abs().partial_cmp(&sub(y).abs()).unwrap()) {
                if sub(p).abs() >= SUB_GRENZE_DB {
                    klasse = KLASSE_SUB;
                    beschreibung = format!("nur im Sub: {:+.1} dB unter 100 Hz, A-bewertet kaum hörbar", sub(p));
                    wert = Some(p.wert);
                }
            }
        }
        regler.push(ReglerBericht {
            nr: r.nr, name: r.name.clone(), art, vorgabe, klasse,
            beschreibung,
            d_max, staerkster_wert: wert, positionen: pos, bedingt: None,
        });
    }

    // Knobs that do nothing alone often sit behind another one (warp depth behind the warp mode, a chaos rate behind a chaos amount).
    // Second test: every knob with an effect goes to its strongest setting (the context), the silent knobs are moved on that base, and
    // for those that now act the opening knob is looked for: each effective knob alone at its strongest setting, silent knob on top.
    let oeffner: Vec<(usize, f32, usize)> = regler.iter().enumerate().filter(|(_, r)| r.klasse != "wirkt nicht").filter_map(|(i, r)| Some((r.nr, r.staerkster_wert?, i))).collect();
    let stumme: Vec<usize> = regler.iter().enumerate().filter(|(_, r)| r.klasse == "wirkt nicht" && !r.positionen.is_empty()).map(|(i, _)| i).collect();
    if !oeffner.is_empty() && !stumme.is_empty() {
        let kontext: Vec<(usize, f32)> = oeffner.iter().map(|&(nr, w, _)| (nr, w)).collect();
        let basis = messe(&rendere_mit(json, o, &kontext)?);
        let mut auftr: Vec<Vec<(usize, f32)>> = Vec::new();
        let mut index: Vec<(usize, f32)> = Vec::new(); // (regler index, travel)
        for &i in &stumme {
            let r = info.iter().find(|x| x.nr == regler[i].nr).unwrap();
            for w in stellungen(o, r.stufen) {
                let mut k = kontext.clone();
                k.push((r.nr, w));
                auftr.push(k);
                index.push((i, w));
            }
        }
        let erg = laufe(&auftr)?;
        let mut beste: BTreeMap<usize, (f64, f32, String)> = BTreeMap::new();
        for ((i, w), m) in index.iter().zip(&erg) {
            let u = vergleiche(&basis, m);
            if beste.get(i).map_or(true, |b| u.d > b.0) { beste.insert(*i, (u.d, *w, beschreibe(&u))); }
        }
        let treffer: Vec<(usize, (f64, f32, String))> = beste.into_iter().filter(|(_, b)| b.0 >= GRENZE_LEISE).collect();
        // who opens it: each effective knob alone, the silent knob on top, against that knob alone (measured in the first test)
        let mut auftr2: Vec<Vec<(usize, f32)>> = Vec::new();
        let mut index2: Vec<(usize, usize)> = Vec::new(); // (index in treffer, index in oeffner)
        for (t, (i, b)) in treffer.iter().enumerate() {
            for (oi, &(onr, ow, _)) in oeffner.iter().enumerate() {
                auftr2.push(vec![(onr, ow), (regler[*i].nr, b.1)]);
                index2.push((t, oi));
            }
        }
        let erg2 = laufe(&auftr2)?;
        for (t, (i, b)) in treffer.iter().enumerate() {
            let mut best: Option<(usize, f32, f64)> = None;
            for (&(tt, oi), m) in index2.iter().zip(&erg2) {
                if tt != t { continue; }
                let (onr, ow, ri) = oeffner[oi];
                let allein = regler[ri].positionen.iter().find(|p| p.wert == ow).map(|p| &p.messung).unwrap();
                let d = vergleiche(allein, m).d;
                if best.map_or(true, |x| d > x.2) { best = Some((onr, ow, d)); }
            }
            let oeff = best.filter(|x| x.2 >= GRENZE_LEISE);
            regler[*i].bedingt = Some(Bedingt { klasse: klasse(b.0), d_max: b.0, staerkster_wert: b.1, beschreibung: b.2.clone(), oeffner: oeff, kontext: kontext.clone() });
        }
    }
    // Third test: the knobs still silent. With every effective knob at its strongest the opener can be masked (a chaos rate under a loud
    // warp, a sync under a detuned osc 2 that another knob moved away), so each effective knob is tried alone as the context.
    let uebrig: Vec<usize> = regler.iter().enumerate().filter(|(_, r)| r.klasse == "wirkt nicht" && r.bedingt.is_none() && !r.positionen.is_empty()).map(|(i, _)| i).collect();
    if !oeffner.is_empty() && !uebrig.is_empty() {
        let mut auftr3: Vec<Vec<(usize, f32)>> = Vec::new();
        let mut index3: Vec<(usize, usize, f32)> = Vec::new(); // (regler index, index in oeffner, travel)
        for &i in &uebrig {
            let r = info.iter().find(|x| x.nr == regler[i].nr).unwrap();
            for (oi, &(onr, ow, _)) in oeffner.iter().enumerate() {
                if onr == r.nr { continue; }
                for w in stellungen_kurz(o, r.stufen) {
                    auftr3.push(vec![(onr, ow), (r.nr, w)]);
                    index3.push((i, oi, w));
                }
            }
        }
        let erg3 = laufe(&auftr3)?;
        let mut beste3: BTreeMap<usize, (f64, usize, f32, String)> = BTreeMap::new();
        for (&(i, oi, w), m) in index3.iter().zip(&erg3) {
            let (_, ow, ri) = oeffner[oi];
            let allein = regler[ri].positionen.iter().find(|p| p.wert == ow).map(|p| &p.messung).unwrap();
            let u = vergleiche(allein, m);
            if beste3.get(&i).map_or(true, |b| u.d > b.0) { beste3.insert(i, (u.d, oi, w, beschreibe(&u))); }
        }
        for (i, (d, oi, w, text)) in beste3 {
            if d < GRENZE_LEISE { continue; }
            let (onr, ow, _) = oeffner[oi];
            regler[i].bedingt = Some(Bedingt { klasse: klasse(d), d_max: d, staerkster_wert: w, beschreibung: text, oeffner: Some((onr, ow, d)), kontext: vec![(onr, ow)] });
        }
    }
    Ok(Bericht { graph: name.into(), noten: o.noten, bpm: BPM, dauer_s: DAUER_S, grundzustand: a, grundrauschen_d, grenzen: [GRENZE_LEISE, GRENZE_DEUTLICH, GRENZE_STARK], regler })
}

/// The German table (markdown).
pub fn text_tabelle(b: &Bericht) -> String {
    let mut s = String::new();
    let n = |k: &str| b.regler.iter().filter(|r| r.klasse == k).count();
    s += &format!("# Regler-Analyse {}\n\n", b.graph);
    s += &format!("Phrase: {:?}, 2 Takte bei {:.0} BPM, {:.2} s. Grundpegel {:.1} dB RMS, Spitze {:.1} dB, Schwerpunkt {:.0} Hz.\n", b.noten, b.bpm, b.dauer_s, b.grundzustand.rms_db, b.grundzustand.peak_db, b.grundzustand.schwerpunkt_hz);
    s += &format!("Unterschied D (Skala der Klangrunde: 1,2 leise hörbar, 2,9 deutlich, 4,6 stark): wirkt nicht < {}, leise < {}, deutlich < {}, stark ab {}. Grundrauschen D {:.3}.\n\n", b.grenzen[0], b.grenzen[1], b.grenzen[2], b.grenzen[2], b.grundrauschen_d);
    let bed = b.regler.iter().filter(|r| r.bedingt.is_some()).count();
    let sub = if n(KLASSE_SUB) > 0 { format!(", nur Sub {}", n(KLASSE_SUB)) } else { String::new() };
    s += &format!("Zusammenfassung: wirkt nicht {} (davon nur bedingt, hinter einem anderen Regler: {}), leise {}, deutlich {}, stark {}{}.\n\n", n("wirkt nicht"), bed, n("leise"), n("deutlich"), n("stark"), sub);
    s += "| Regler | Name | Klasse | Richtung | D | stärkste Stellung |\n|---|---|---|---|---|---|\n";
    for r in &b.regler {
        let w = r.staerkster_wert.map(|w| format!("{:.2}", w)).unwrap_or_else(|| "-".into());
        let (klasse, text) = match &r.bedingt {
            Some(c) => {
                let wer = c.oeffner.map(|(n, w, _)| format!("k{n} auf {:.2}", w)).unwrap_or_else(|| "mehreren Reglern offen".into());
                (format!("nur bedingt: {}", c.klasse), format!("{} (nur mit {})", c.beschreibung, wer))
            }
            None => (r.klasse.to_string(), r.beschreibung.clone()),
        };
        let d = r.bedingt.as_ref().map_or(r.d_max, |c| c.d_max);
        s += &format!("| k{} | {} | {} | {} | {:.2} | {} |\n", r.nr, r.name, klasse, text, d, w);
    }
    s
}
