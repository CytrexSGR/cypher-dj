//! Sample player stage 2b: sustain loops (`loop_a`, `loop_b`, `loop_blende`) and release samples (`art` 1, outputs `rl`, `rr`).
#[path = "sampler_helpers/mod.rs"]
mod sampler_hilfe;
use baukasten_dsp::sampler::{Eingabe, Sampler, ZonenTabelle, FADE};
use baukasten_dsp::{uebersetze_mit_wurzel, Fehler, Programm};
use sampler_hilfe::*;

const SR: f32 = 48_000.0;

/// One zone row: a, b, grund, lo, hi, vlo, vhi, gain, pan, loop_a, loop_b, art.
fn zeile(a: u64, b: u64, grund: f64, lo: u8, hi: u8, vlo: u8, vhi: u8) -> [f64; 12] {
    [a as f64, b as f64, grund, lo as f64, hi as f64, vlo as f64, vhi as f64, 1.0, 0.0, 0.0, 0.0, 0.0]
}
fn offen(a: u64, b: u64) -> [f64; 12] { zeile(a, b, 60.0, 0, 127, 1, 127) }
fn schleife(mut z: [f64; 12], la: u64, lb: u64) -> [f64; 12] { z[9] = la as f64; z[10] = lb as f64; z }
fn frei(mut z: [f64; 12]) -> [f64; 12] { z[11] = 1.0; z }
fn flach(z: &[[f64; 12]]) -> String { z.iter().flatten().map(|v| v.to_string()).collect::<Vec<_>>().join(",") }

/// Graph with one voice (or `stimmen`): note -> sampler -> ausgang. `links`/`rechts` name the sampler outputs wired to the
/// two output sides.
fn zgraph(datei: &str, z: &[[f64; 12]], extra: &str, stimmen: usize, links: &str, rechts: &str) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"z","stimmen":{stimmen},"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"sampler","datei":"{datei}","zonen":[{}]{extra}}},{{"id":"o","art":"ausgang"}}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"n.trig","nach":"s.trig"}},{{"von":"n.gate","nach":"s.gate"}},{{"von":"n.vel","nach":"s.vel"}},{{"von":"s.{links}","nach":"o.l"}},{{"von":"s.{rechts}","nach":"o.r"}}]}}"#,
        flach(z)
    )
}

fn bauen(w: &std::path::Path, d: &[f32], z: &[[f64; 12]], extra: &str, stimmen: usize, links: &str, rechts: &str) -> Programm {
    schreibe(w, "p.f32", d);
    uebersetze_mit_wurzel(&zgraph("p.f32", z, extra, stimmen, links, rechts), SR, Some(w)).unwrap_or_else(|e| panic!("{e:?}"))
}

fn nahe(a: f32, b: f32) -> bool { (a - b).abs() < 1e-5 }

fn lauf(p: &mut Programm, n: usize) -> Vec<(f32, f32)> { (0..n).map(|_| p.sample_stereo()).collect() }

fn groesster_sprung(x: &[f32]) -> f32 { x.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max) }

fn effektiv(x: &[f32]) -> f32 { (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt() }

/// Pack of one sine zone, played at note 60 with root 60: read rate 1.
fn sinus_pack(hz: f64, frames: usize) -> Vec<f32> { sinus(hz, frames, 0.5) }

// ---------------------------------------------------------------- loops

#[test]
fn looped_zone_holds_a_steady_sine_far_beyond_the_zone() {
    let w = wurzel();
    // 480 Hz = 100 frames per period; the loop of 2000 frames holds 20 periods, so the cross-fade joins identical material
    let z = [schleife(offen(0, 4800), 1000, 3000)];
    let mut p = bauen(&w, &sinus_pack(480.0, 4800), &z, "", 4, "l", "r");
    p.note_an(60, 1.0);
    let aus: Vec<f32> = lauf(&mut p, 3 * 48_000).iter().map(|s| s.0).collect();
    // the zone is 0.1 s long; at 2.5 s the sound is still there, steady, at the right level and pitch
    let spaet = &aus[120_000..128_192];
    let rms = effektiv(spaet);
    assert!((rms - 0.5 / 2f32.sqrt()).abs() < 0.01, "level {rms}");
    let f = spitze_hz(spaet, 48_000.0);
    assert!((f - 480.0).abs() < 1.0, "pitch {f}");
    // no click at any wrap: the largest step is that of the sine's own slope (2 pi f / sr * amp = 0.0314)
    let sprung = groesster_sprung(&aus[20..140_000]);
    assert!(sprung < 0.0314 * 1.05, "largest jump {sprung}");
    // the whole body is steady: the level near 1 s equals the level near 2.5 s
    let mitte = effektiv(&aus[48_000..56_192]);
    assert!((mitte - rms).abs() < 0.005, "{mitte} vs {rms}");
}

#[test]
fn loop_cross_fade_bounds_the_jump_and_blende_zero_shows_the_raw_one() {
    let w = wurzel();
    // period 102.564 frames: the loop of 2000 frames is 19.5 periods, anti-phase at the join; loop_b sits on a crest
    let hz = 48_000.0 / (2000.0 / 19.5);
    let z = [schleife(offen(0, 4800), 1000, 3000)];
    let d = sinus_pack(hz, 4800);
    let messen = |extra: &str| {
        let mut p = bauen(&w, &d, &z, extra, 1, "l", "r");
        p.note_an(60, 1.0);
        let aus: Vec<f32> = lauf(&mut p, 60_000).iter().map(|s| s.0).collect();
        groesster_sprung(&aus[20..])
    };
    let eigene_steigung = (2.0 * std::f64::consts::PI * hz / 48_000.0) as f32 * 0.5;
    let weich = messen("");
    assert!(weich < eigene_steigung + 0.01, "cross-faded jump {weich}, slope {eigene_steigung}");
    let hart = messen(r#","loop_blende":0"#);
    assert!(hart > 0.5, "a hard wrap shows the raw jump: {hart}");
    // a middle value lies between
    let mittel = messen(r#","loop_blende":2"#);
    assert!(mittel < hart && mittel >= weich, "{weich} < {mittel} < {hart}");
}

#[test]
fn loop_keeps_going_after_the_gate_falls_and_ends_ten_seconds_later() {
    let w = wurzel();
    let z = [schleife(offen(0, 4800), 1000, 3000)];
    let mut p = bauen(&w, &sinus_pack(480.0, 4800), &z, "", 4, "l", "r");
    p.note_an(60, 1.0);
    lauf(&mut p, 24_000);
    p.note_aus(60);
    // 9.5 s after the fall it still plays at full level
    let a = lauf(&mut p, 9 * 48_000 + 24_000);
    let l: Vec<f32> = a.iter().map(|s| s.0).collect();
    assert!(effektiv(&l[l.len() - 8192..]) > 0.3, "still looping 9.5 s after the fall: {}", effektiv(&l[l.len() - 8192..]));
    // 10 s plus the rest of the zone (0.1 s) and one loop cycle (about 0.04 s) later it is over
    let b: Vec<f32> = lauf(&mut p, 24_000 + 48_000 / 4).iter().map(|s| s.0).collect();
    assert!(b[b.len() - 4096..].iter().all(|v| *v == 0.0), "silent after 10 s plus the tail");
    // and the sound did not stop earlier than 10 s: at 9.9 s it is still there
    assert!(b.iter().any(|v| v.abs() > 0.1));
    // the end is a fade, not a cut: the last step before silence is small
    let ende = b.iter().rposition(|v| *v != 0.0).unwrap();
    assert!(b[ende].abs() < 0.05, "ends in a fade: {}", b[ende]);
}

#[test]
fn zone_without_a_loop_is_unchanged() {
    let w = wurzel();
    let mut p = bauen(&w, &sinus_pack(480.0, 4800), &[offen(0, 4800)], "", 4, "l", "r");
    p.note_an(60, 1.0);
    let aus: Vec<f32> = lauf(&mut p, 12_000).iter().map(|s| s.0).collect();
    assert!(effektiv(&aus[1000..4000]) > 0.3);
    assert!(aus[4900..].iter().all(|v| *v == 0.0), "a one-shot ends with its zone");
    // 2 ms end fade: the last samples before b are scaled down
    assert!(aus[4790..4800].iter().all(|v| v.abs() < 0.1), "{:?}", &aus[4790..4800]);
}

#[test]
fn loop_follows_the_read_rate_in_source_frames() {
    let w = wurzel();
    // played an octave up the loop covers the same frames: the pitch doubles and the cross-fade still joins identical material
    let z = [schleife(offen(0, 4800), 1000, 3000)];
    let mut p = bauen(&w, &sinus_pack(480.0, 4800), &z, "", 4, "l", "r");
    p.note_an(72, 1.0);
    let aus: Vec<f32> = lauf(&mut p, 2 * 48_000).iter().map(|s| s.0).collect();
    let spaet = &aus[60_000..68_192];
    assert!((spitze_hz(spaet, 48_000.0) - 960.0).abs() < 2.0);
    assert!(groesster_sprung(&aus[20..]) < 0.0314 * 2.0 * 1.05, "{}", groesster_sprung(&aus[20..]));
}

#[test]
fn loop_may_end_at_the_zone_end_without_a_fade_while_looping() {
    let w = wurzel();
    // loop_b == b: the 2 ms end fade of the one-shot must not fire at the loop end
    let z = [schleife(offen(0, 4800), 1800, 4800)];
    let mut p = bauen(&w, &sinus_pack(480.0, 4800), &z, "", 1, "l", "r");
    p.note_an(60, 1.0);
    let aus: Vec<f32> = lauf(&mut p, 48_000).iter().map(|s| s.0).collect();
    // loop of 3000 frames = 30 periods: level at the wrap points stays full
    let rms = effektiv(&aus[20_000..28_192]);
    assert!((rms - 0.5 / 2f32.sqrt()).abs() < 0.01, "{rms}");
    let sprung = groesster_sprung(&aus[20..]);
    assert!(sprung < 0.0314 * 1.05, "{sprung}");
    // no dip anywhere: the sine envelope never falls below ~0.45 over any 100 frames
    for f in aus[2000..40_000].chunks(100) {
        assert!(f.iter().fold(0.0f32, |m, v| m.max(v.abs())) > 0.45, "dip at a wrap");
    }
}

// ---------------------------------------------------------------- release samples

/// Pack of `n` constant zones of `len` frames (zone k is (k+1)/10).
fn konstanten(n: usize, len: usize) -> Vec<f32> { segmente(n, len) }

/// Release graph: left = release left, right = release right.
fn frei_prog(w: &std::path::Path, d: &[f32], z: &[[f64; 12]], stimmen: usize) -> Programm { bauen(w, d, z, "", stimmen, "rl", "rr") }

#[test]
fn release_plays_at_the_gate_fall_with_gain_and_pan() {
    let w = wurzel();
    let mut r = frei(zeile(400, 800, 60.0, 0, 127, 1, 127));
    r[7] = 0.5;
    r[8] = -1.0; // hard left: left = 0.5 * sqrt(2), right = 0
    let mut p = frei_prog(&w, &konstanten(2, 400), &[offen(0, 400), r], 4);
    p.note_an(60, 1.0);
    let vorher = lauf(&mut p, 2000);
    assert!(vorher.iter().all(|s| *s == (0.0, 0.0)), "no release while the key is held");
    p.note_aus(60);
    let nach = lauf(&mut p, 500);
    let (l, rr) = nach[10];
    assert!(nahe(l, 0.2 * 0.5 * std::f32::consts::SQRT_2) && rr.abs() < 1e-6, "{l} {rr}");
    // played once and over after its length (400 frames at read rate 1) plus the end fade
    assert!(nach[499] == (0.0, 0.0), "{:?}", nach[499]);
}

#[test]
fn release_runs_independent_of_the_main_pass() {
    let w = wurzel();
    // main zone is long (4000 frames of 0.1); release zone is 0.2; left = main, right = release left
    let d = [konstanten(1, 4000), stereo(400, |_| 0.2)].concat();
    let z = [offen(0, 4000), frei(zeile(4000, 4400, 60.0, 0, 127, 1, 127))];
    let mut p = bauen(&w, &d, &z, "", 4, "l", "rl");
    p.note_an(60, 1.0);
    lauf(&mut p, 1000);
    p.note_aus(60);
    let a = lauf(&mut p, 100);
    assert!(nahe(a[50].0, 0.1) && nahe(a[50].1, 0.2), "main goes on while the release plays: {:?}", a[50]);
}

#[test]
fn release_pitch_follows_its_zone_root() {
    let w = wurzel();
    let d = [konstanten(1, 400), sinus(480.0, 48_000, 0.5)].concat();
    let z = [offen(0, 400), frei(zeile(400, 48_400, 60.0, 0, 127, 1, 127))];
    let mut p = frei_prog(&w, &d, &z, 4);
    p.note_an(72, 1.0); // one octave above the root
    lauf(&mut p, 100);
    p.note_aus(72);
    let aus: Vec<f32> = lauf(&mut p, 10_000).iter().map(|s| s.0).collect();
    let f = spitze_hz(&aus[200..8392], 48_000.0);
    assert!((f - 960.0).abs() < 2.0, "{f}");
}

#[test]
fn release_is_chosen_by_key_and_velocity() {
    let w = wurzel();
    // main zone, then four release zones: low/high key x soft/loud velocity
    let d = konstanten(5, 400);
    let z = [
        offen(0, 400),
        frei(zeile(400, 800, 60.0, 0, 59, 1, 64)),
        frei(zeile(800, 1200, 60.0, 0, 59, 65, 127)),
        frei(zeile(1200, 1600, 60.0, 60, 127, 1, 64)),
        frei(zeile(1600, 2000, 60.0, 60, 127, 65, 127)),
    ];
    let mut p = frei_prog(&w, &d, &z, 4);
    for (note, vel, soll) in [(50u8, 0.3f32, 0.2f32), (50, 0.9, 0.3), (70, 0.3, 0.4), (70, 0.9, 0.5)] {
        p.note_an(note, vel);
        lauf(&mut p, 50);
        p.note_aus(note);
        let a = lauf(&mut p, 20);
        assert!(nahe(a[10].0, soll), "note {note} vel {vel}: {} != {soll}", a[10].0);
        lauf(&mut p, 1200); // note 50 reads at 2/3 speed: 600 samples
    }
}

#[test]
fn release_round_robin_is_a_second_counter_that_resets_with_the_first() {
    let w = wurzel();
    // two main takes and three release takes, all over the full range
    let d = konstanten(5, 400);
    let z = [
        offen(0, 400),
        offen(400, 800),
        frei(offen(800, 1200)),
        frei(offen(1200, 1600)),
        frei(offen(1600, 2000)),
    ];
    // left = main, right = release
    let mut p = bauen(&w, &d, &z, "", 4, "l", "rl");
    let hit = |p: &mut Programm| {
        p.note_an(60, 1.0);
        let m = lauf(p, 30)[20].0;
        p.note_aus(60);
        let r = lauf(p, 30)[20].1;
        lauf(p, 600);
        (m, r)
    };
    let folge: Vec<(f32, f32)> = (0..4).map(|_| hit(&mut p)).collect();
    // main takes 0.1 0.2 0.1 0.2 (first counter), release takes 0.3 0.4 0.5 0.3 (second counter), independent
    for (i, ((m, r), (sm, sr))) in folge.iter().zip([(0.1, 0.3), (0.2, 0.4), (0.1, 0.5), (0.2, 0.3)]).enumerate() {
        assert!(nahe(*m, sm) && nahe(*r, sr), "hit {i}: {m} {r} != {sm} {sr}");
    }
    p.zuruecksetzen();
    let (m, r) = hit(&mut p);
    assert!(nahe(m, 0.1) && nahe(r, 0.3), "both counters restart: {m} {r}");
}

#[test]
fn no_release_without_candidates_and_release_zones_are_never_trigger_candidates() {
    let w = wurzel();
    let d = konstanten(2, 400);
    // the only zone is a release zone: a trigger finds no candidate for the main pass
    let mut p = bauen(&w, &d, &[frei(offen(0, 400))], "", 4, "l", "rl");
    p.note_an(60, 1.0);
    let a = lauf(&mut p, 100);
    assert!(a.iter().all(|s| s.0 == 0.0), "a release zone never plays as a main pass");
    p.note_aus(60);
    // the voice was triggered in zone mode, but the zone is a release zone: it does play on rl
    let b = lauf(&mut p, 100);
    assert!(nahe(b[10].1, 0.1), "{:?}", b[10]);
    // a release zone that does not hold the note: nothing plays
    let mut p = bauen(&w, &d, &[offen(0, 400), frei(zeile(400, 800, 60.0, 80, 127, 1, 127))], "", 4, "l", "rl");
    p.note_an(60, 1.0);
    lauf(&mut p, 100);
    p.note_aus(60);
    assert!(lauf(&mut p, 200).iter().all(|s| s.1 == 0.0), "no candidate: silent");
    // no release zones at all: nothing on rl
    let mut p = bauen(&w, &d, &[offen(0, 400)], "", 4, "l", "rl");
    p.note_an(60, 1.0);
    lauf(&mut p, 100);
    p.note_aus(60);
    assert!(lauf(&mut p, 200).iter().all(|s| s.1 == 0.0));
    // a trigger with a main candidate: the first counter is not advanced by release zones
    let mut p = bauen(&w, &d, &[offen(0, 400), frei(offen(400, 800)), offen(0, 400)], "", 4, "l", "rl");
    let mut folge = vec![];
    for _ in 0..3 {
        p.note_an(60, 1.0);
        folge.push(lauf(&mut p, 30)[20].0);
        p.note_aus(60);
        lauf(&mut p, 700);
    }
    assert!(folge.iter().all(|v| nahe(*v, 0.1)), "{folge:?}");
}

#[test]
fn a_new_trigger_fades_a_running_release_out_over_two_ms() {
    let w = wurzel();
    let d = [stereo(400, |_| 0.1), stereo(8000, |_| 0.2)].concat();
    let z = [offen(0, 400), frei(zeile(400, 8400, 60.0, 0, 127, 1, 127))];
    let mut p = frei_prog(&w, &d, &z, 1); // one voice: the next note retriggers the same voice
    p.note_an(60, 1.0);
    lauf(&mut p, 50);
    p.note_aus(60);
    let a = lauf(&mut p, 500);
    assert!(nahe(a[400].0, 0.2), "release is running: {}", a[400].0);
    p.note_an(60, 1.0);
    let b: Vec<f32> = lauf(&mut p, FADE + 20).iter().map(|s| s.0).collect();
    assert!(b[0] > 0.18 && b[0] <= 0.2, "starts from the running level: {}", b[0]);
    assert!(b.windows(2).take(FADE - 1).all(|q| q[1] <= q[0] + 1e-7), "falls monotonically");
    assert!(b[FADE..].iter().all(|v| *v == 0.0), "silent after {FADE} samples: {:?}", &b[FADE..]);
}

#[test]
fn a_trigger_without_a_held_gate_starts_no_release_until_a_gate_edge_follows() {
    let d = [stereo(400, |_| 0.1), stereo(400, |_| 0.2)].concat();
    let z = ZonenTabelle::neu(&[offen(0, 400), frei(offen(400, 800))].concat(), Some(800)).unwrap();
    let (mut s, mut rr, mut rr2) = (Sampler::default(), 0u64, 0u64);
    let hz = 261.6256f32;
    let x = |trig: f32, gate: f32| Eingabe { hz, trig, gate, scheibe: 0.0, rueck: 0.0 };
    let mut rel = vec![];
    // trigger with the gate low from the first sample, and the gate stays low
    rel.push(s.prozess_zonen_frei(&d, &z, &mut rr, &mut rr2, SR, x(1.0, 0.0), 1.0).2);
    for _ in 0..300 { rel.push(s.prozess_zonen_frei(&d, &z, &mut rr, &mut rr2, SR, x(0.0, 0.0), 1.0).2); }
    assert!(rel.iter().all(|v| *v == 0.0), "no release for a gate that never was high after the trigger");
    // now the gate goes high and falls: that is an edge after the trigger
    for _ in 0..10 { s.prozess_zonen_frei(&d, &z, &mut rr, &mut rr2, SR, x(0.0, 1.0), 1.0); }
    let nach: Vec<f32> = (0..20).map(|_| s.prozess_zonen_frei(&d, &z, &mut rr, &mut rr2, SR, x(0.0, 0.0), 1.0).2).collect();
    assert!(nahe(nach[10], 0.2), "{nach:?}");
    // once per trigger: the next fall without a new trigger starts nothing
    for _ in 0..600 { s.prozess_zonen_frei(&d, &z, &mut rr, &mut rr2, SR, x(0.0, 0.0), 1.0); }
    for _ in 0..10 { s.prozess_zonen_frei(&d, &z, &mut rr, &mut rr2, SR, x(0.0, 1.0), 1.0); }
    let nochmal: Vec<f32> = (0..20).map(|_| s.prozess_zonen_frei(&d, &z, &mut rr, &mut rr2, SR, x(0.0, 0.0), 1.0).2).collect();
    assert!(nochmal.iter().all(|v| *v == 0.0), "{nochmal:?}");
}

#[test]
fn trigger_with_a_held_gate_releases_at_the_fall() {
    let d = [stereo(400, |_| 0.1), stereo(400, |_| 0.2)].concat();
    let z = ZonenTabelle::neu(&[offen(0, 400), frei(offen(400, 800))].concat(), Some(800)).unwrap();
    let (mut s, mut rr, mut rr2) = (Sampler::default(), 0u64, 0u64);
    let hz = 261.6256f32;
    let x = |trig: f32, gate: f32| Eingabe { hz, trig, gate, scheibe: 0.0, rueck: 0.0 };
    s.prozess_zonen_frei(&d, &z, &mut rr, &mut rr2, SR, x(1.0, 1.0), 1.0);
    for _ in 0..100 { assert_eq!(s.prozess_zonen_frei(&d, &z, &mut rr, &mut rr2, SR, x(0.0, 1.0), 1.0).2, 0.0); }
    let v: Vec<f32> = (0..20).map(|_| s.prozess_zonen_frei(&d, &z, &mut rr, &mut rr2, SR, x(0.0, 0.0), 1.0).2).collect();
    assert!(v[0] > 0.0 && nahe(v[10], 0.2), "{v:?}");
    assert_eq!((rr, rr2), (1, 1));
}

// ---------------------------------------------------------------- refusals

fn zonenfehler(r: Result<Programm, Fehler>) -> Option<(String, String)> {
    match r {
        Err(Fehler::Zonen { wert, grund, .. }) => Some((wert, grund)),
        Err(Fehler::Wert { wert, grund, .. }) => Some((wert, grund.to_string())),
        _ => None,
    }
}

#[test]
fn every_loop_and_release_rule_is_refused_with_zone_and_field() {
    let w = wurzel();
    schreibe(&w, "p.f32", &konstanten(2, 1000)); // 2000 frames
    let ok = || offen(100, 1000);
    let mit = |f: &dyn Fn(&mut [f64; 12])| {
        let mut z = ok();
        f(&mut z);
        uebersetze_mit_wurzel(&zgraph("p.f32", &[ok(), z], "", 4, "l", "r"), SR, Some(&w))
    };
    assert!(mit(&|_| {}).is_ok());
    // valid loops: boundaries
    assert!(mit(&|z| { z[9] = 100.0; z[10] = 164.0 }).is_ok(), "a <= loop_a and loop_a + 64 <= loop_b");
    assert!(mit(&|z| { z[9] = 200.0; z[10] = 1000.0 }).is_ok(), "loop_b == b");
    let fall: Vec<(&str, Box<dyn Fn(&mut [f64; 12])>)> = vec![
        ("loop_a", Box::new(|z| { z[9] = 99.0; z[10] = 500.0 })),     // loop_a < a
        ("loop_b", Box::new(|z| { z[9] = 200.0; z[10] = 263.0 })),    // loop_a + 64 > loop_b
        ("loop_b", Box::new(|z| { z[9] = 200.0; z[10] = 1001.0 })),   // loop_b > b
        ("loop_a", Box::new(|z| z[9] = 200.0)),                       // only one of them
        ("loop_b", Box::new(|z| z[10] = 500.0)),                      // only one of them
        ("loop_a", Box::new(|z| { z[9] = 200.5; z[10] = 500.0 })),    // not whole
        ("loop_b", Box::new(|z| { z[9] = 200.0; z[10] = 500.5 })),
        ("art", Box::new(|z| z[11] = 2.0)),
        ("art", Box::new(|z| z[11] = -1.0)),
        ("art", Box::new(|z| z[11] = 0.5)),
        ("loop_a", Box::new(|z| { z[11] = 1.0; z[9] = 200.0; z[10] = 500.0 })), // a loop on a release zone
    ];
    for (feld, f) in &fall {
        let r = mit(f.as_ref());
        let (wert, grund) = zonenfehler(r).unwrap_or_else(|| panic!("field {feld} must be refused"));
        assert!(wert.starts_with("zonen[1].") && wert.contains(feld) && !grund.is_empty(), "{feld}: {wert}: {grund}");
    }
    // art 1 itself is fine
    assert!(mit(&|z| z[11] = 1.0).is_ok());
}

#[test]
fn loop_blende_has_a_range_and_belongs_to_zone_mode() {
    let w = wurzel();
    schreibe(&w, "p.f32", &konstanten(2, 1000));
    let z = [schleife(offen(0, 1000), 100, 500)];
    for (v, gut) in [("0", true), ("20", true), ("500", true), ("500.1", false), ("-1", false)] {
        let r = uebersetze_mit_wurzel(&zgraph("p.f32", &z, &format!(r#","loop_blende":{v}"#), 4, "l", "r"), SR, Some(&w));
        if gut {
            assert!(r.is_ok(), "{v}: {:?}", r.err());
        } else {
            let (wert, _) = zonenfehler(r).unwrap_or_else(|| panic!("{v} must be refused"));
            assert!(wert.contains("loop_blende"), "{wert}");
        }
    }
    // beside a plain sampler (no zones) loop_blende is refused
    let g = graph("p.f32", r#","loop_blende":20"#, 4);
    let (wert, _) = zonenfehler(uebersetze_mit_wurzel(&g, SR, Some(&w))).expect("refused");
    assert!(wert.contains("loop_blende"), "{wert}");
}

// ---------------------------------------------------------------- the new outputs

#[test]
fn rl_and_rr_are_silent_on_a_sampler_without_zones() {
    let w = wurzel();
    schreibe(&w, "p.f32", &konstanten(1, 4000));
    let g = graph("p.f32", "", 2).replace(r#"{"von":"s.l","nach":"o.l"}"#, r#"{"von":"s.rl","nach":"o.l"}"#).replace(r#"{"von":"s.r","nach":"o.r"}"#, r#"{"von":"s.rr","nach":"o.r"}"#);
    let mut p = uebersetze_mit_wurzel(&g, SR, Some(&w)).unwrap_or_else(|e| panic!("{e:?}"));
    p.note_an(60, 1.0);
    p.note_aus(60);
    assert!(lauf(&mut p, 500).iter().all(|s| *s == (0.0, 0.0)));
}
