//! Hard sync slice: proof that the band-limited hard sync (`hart` input and output on `saege`, `puls`, `dreieck`, `hart`
//! output on `sinus`) changes no existing graph. The fingerprints below were taken from the code BEFORE the hard sync
//! was added (commit cbd1bc6) and must stay bit for bit the same: every shipped example graph that existed then (default
//! knobs and all knobs at 1), and oscillator graphs that cover every existing oscillator output (`aus`, `zyklus`) with
//! pitch from notes, pwm, fm through zero and the old `sync` input from every master to every slave.
//!
//! `HART_FINGERABDRUCK=1 cargo test --release --test hartsync_bitgleich -- --nocapture` prints the current table.
use baukasten_dsp::{uebersetze_mit_wurzel, Programm, REGLER};
use std::path::PathBuf;

const SR: f32 = 48_000.0;

/// The example graphs that existed before the hard sync slice (file stems in `beispiele/`).
const ALTE_BEISPIELE: [&str; 27] = [
    "bassmusik", "fx-bandecho", "fx-echo-achtel", "fx-federhall", "fx-filter-fahrt", "fx-filter-regler", "fx-filter-wobble",
    "fx-flanger", "fx-lofi-sp1200", "fx-phaser", "fx-roehre", "fx-takt-pump", "fx-vocoder-robot", "gated-hall-snare",
    "juno-pad-dyn", "juno-pad-echo", "juno-pad-hall", "juno-pad", "lead", "roehre-lead", "rueckkopplung", "saege-ladder",
    "saite", "sampler-fairlight", "wavetable-chor", "wavetable-reese", "wavetable-supersaw",
];

/// A sample root with the generated probes the sampler and spring examples read (nothing is stored in the repo).
fn wurzel() -> PathBuf {
    static W: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    W.get_or_init(|| {
        let w = std::env::temp_dir().join(format!("bk-hart-bitgleich-{}", std::process::id()));
        std::fs::create_dir_all(&w).unwrap();
        let p = |n: &str, d: Vec<f32>| std::fs::write(w.join(n), baukasten_dsp::proben::bytes(&d)).unwrap();
        p("orchester-schlag.f32", baukasten_dsp::proben::orchester_schlag(SR));
        p("orchester-schlag-schichten.f32", baukasten_dsp::proben::orchester_schlag_schichten(SR));
        p("feder-ir.f32", baukasten_dsp::proben::feder_ir(SR));
        w
    }).clone()
}

/// FNV-1a over the bit patterns of both sides.
fn fingerabdruck(x: &[(f32, f32)]) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    for (l, r) in x {
        for b in l.to_bits().to_le_bytes().into_iter().chain(r.to_bits().to_le_bytes()) {
            h ^= b as u64;
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    }
    h
}

/// Instruments: four notes of 0.25 s from low to high, a chord of 0.5 s, 0.25 s tail. Effects: a deterministic test
/// signal (xorshift noise plus a 110 Hz saw) of 1 s.
fn spiele(p: &mut Programm) -> Vec<(f32, f32)> {
    p.setze_takt(0.0, 2.0 / SR as f64);
    let mut y = Vec::new();
    if p.hat_eingang() {
        let (mut s, mut t) = (0x1234_5678u32, 0.0f32);
        for _ in 0..48_000 {
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            t = (t + 110.0 / SR).fract();
            let v = 0.2 * (s as i32 as f32 / 2_147_483_648.0) + 0.3 * (2.0 * t - 1.0);
            p.setze_eingang(v, -v);
            y.push(p.sample_stereo());
        }
    } else {
        for n in [33u8, 57, 81, 105] {
            p.note_an(n, 0.8);
            y.extend((0..12_000).map(|_| p.sample_stereo()));
            p.note_aus(n);
        }
        for n in [45u8, 52, 64, 96] {
            p.note_an(n, 0.7);
        }
        y.extend((0..24_000).map(|_| p.sample_stereo()));
        p.alle_aus();
        y.extend((0..12_000).map(|_| p.sample_stereo()));
    }
    y
}

fn lade(name: &str, json: &str) -> Programm { uebersetze_mit_wurzel(json, SR, Some(&wurzel())).unwrap_or_else(|e| panic!("{name}: {e}")) }

/// Oscillator graphs over every existing oscillator output. `l` = `aus`, `r` = `zyklus` (scaled), so both are fingerprinted.
fn oszillator_graphen() -> Vec<(String, String)> {
    let g = |name: &str, knoten: &str, kanten: &str| {
        (name.to_string(), format!(
            r#"{{"format":"baukasten/2","name":"{name}","stimmen":4,"knoten":[{{"id":"n","art":"note"}},{{"id":"o","art":"ausgang"}},{{"id":"lfo","art":"lfo","rate":3.7}},{{"id":"z","art":"mul","b":0.25}}{knoten}],"kanten":[{{"von":"s.aus","nach":"o.l"}},{{"von":"s.zyklus","nach":"z.a"}},{{"von":"z.aus","nach":"o.r"}}{kanten}]}}"#
        ))
    };
    let mut v = Vec::new();
    for (art, extra, mod_kante) in [
        ("saege", "", ""),
        ("puls", "", r#",{"von":"lfo.aus","nach":"s.pwm"}"#),
        ("dreieck", "", ""),
        ("sinus", r#","fm":0"#, ""),
    ] {
        v.push(g(&format!("{art}-frei"), &format!(r#",{{"id":"s","art":"{art}"{extra}}}"#), &format!(r#",{{"von":"n.hz","nach":"s.hz"}}{mod_kante}"#)));
    }
    // fm through zero: an lfo of depth 900 Hz on the sine
    v.push(g("sinus-fm", r#",{"id":"s","art":"sinus"},{"id":"t","art":"mul","b":900}"#,
             r#",{"von":"n.hz","nach":"s.hz"},{"von":"lfo.aus","nach":"t.a"},{"von":"t.aus","nach":"s.fm"}"#));
    // the old sync input, from every master to every slave, slave a fifth and a bit above; the master is heard too
    for m in ["saege", "puls", "dreieck", "sinus"] {
        for s in ["saege", "puls", "dreieck", "sinus"] {
            let pwm = if s == "puls" { r#",{"von":"lfo.aus","nach":"s.pwm"}"# } else { "" };
            v.push(g(&format!("sync-{m}-{s}"),
                     &format!(r#",{{"id":"m","art":"{m}"}},{{"id":"s","art":"{s}"}},{{"id":"t","art":"transponiere","st":7.31}}"#),
                     &format!(r#",{{"von":"n.hz","nach":"m.hz"}},{{"von":"n.hz","nach":"t.hz"}},{{"von":"t.aus","nach":"s.hz"}},{{"von":"m.zyklus","nach":"s.sync"}},{{"von":"m.aus","nach":"o.x"}}{pwm}"#)));
        }
    }
    v
}

fn alle() -> Vec<(String, u64)> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("beispiele");
    let mut v = Vec::new();
    for name in ALTE_BEISPIELE {
        let json = std::fs::read_to_string(dir.join(format!("{name}.json"))).unwrap();
        let mut p = lade(name, &json);
        v.push((format!("{name}@0.5"), fingerabdruck(&spiele(&mut p))));
        let mut p = lade(name, &json);
        for k in 1..=REGLER {
            p.setze_regler(k, 1.0);
        }
        v.push((format!("{name}@1"), fingerabdruck(&spiele(&mut p))));
    }
    for (name, json) in oszillator_graphen() {
        let mut p = lade(&name, &json);
        v.push((name, fingerabdruck(&spiele(&mut p))));
    }
    v
}

/// Taken before the hard sync was added (commit cbd1bc6, release build, x86_64).
const VORHER: &[(&str, u64)] = &[
    ("bassmusik@0.5", 0xeb99a85b779bec79),
    ("bassmusik@1", 0xc2bc51dd6e256315),
    ("fx-bandecho@0.5", 0x9bea588905ee555d),
    ("fx-bandecho@1", 0x9bea588905ee555d),
    ("fx-echo-achtel@0.5", 0x1ea9062659287ed1),
    ("fx-echo-achtel@1", 0x1ea9062659287ed1),
    ("fx-federhall@0.5", 0xa2c7e1d58811f092),
    ("fx-federhall@1", 0xc13376bdf98d6528),
    ("fx-filter-fahrt@0.5", 0x6a302d6e1bde3e25),
    ("fx-filter-fahrt@1", 0x87eba06116328215),
    ("fx-filter-regler@0.5", 0x6636e86f48600531),
    ("fx-filter-regler@1", 0x6b21733781b8957d),
    ("fx-filter-wobble@0.5", 0x9cfeda8ffecb5a69),
    ("fx-filter-wobble@1", 0xda2f04239ba1829d),
    ("fx-flanger@0.5", 0xf7728bcf612f7098),
    ("fx-flanger@1", 0xa6e8211aadd9c92c),
    ("fx-lofi-sp1200@0.5", 0x7e23d27fc808f331),
    ("fx-lofi-sp1200@1", 0x4ca625b7f87e6031),
    ("fx-phaser@0.5", 0xa6cd81d2783104a1),
    ("fx-phaser@1", 0xdddf179c59d64408),
    ("fx-roehre@0.5", 0x691d82ac5509c5c4),
    ("fx-roehre@1", 0x0f93a0c2d5433d0f),
    ("fx-takt-pump@0.5", 0xf8ac877c7722b6f5),
    ("fx-takt-pump@1", 0x4e7f8ecc30a4872d),
    ("fx-vocoder-robot@0.5", 0xd5998a159b615325),
    ("fx-vocoder-robot@1", 0xd5998a159b615325),
    ("gated-hall-snare@0.5", 0xdf29cf51af1e8901),
    ("gated-hall-snare@1", 0x7ef7d59d87c3054c),
    ("juno-pad-dyn@0.5", 0x848834a356df35b6),
    ("juno-pad-dyn@1", 0xdc7bca545a6dce90),
    ("juno-pad-echo@0.5", 0x3af429cb3efa1a81),
    ("juno-pad-echo@1", 0xa9db05333edf4215),
    ("juno-pad-hall@0.5", 0x0a6cd992341e3ef8),
    ("juno-pad-hall@1", 0x6c3237f418007243),
    ("juno-pad@0.5", 0x5024ab0453cbb94b),
    ("juno-pad@1", 0x4d8d9ec685a8b23b),
    ("lead@0.5", 0xddc546c1a61fbfc1),
    ("lead@1", 0x3d20ea0fa948ce51),
    ("roehre-lead@0.5", 0x73d90da21e8bfb3d),
    ("roehre-lead@1", 0xf8bcc2736d6060cd),
    ("rueckkopplung@0.5", 0x6aebcef9a9b37151),
    ("rueckkopplung@1", 0xf3c74612a096aa01),
    ("saege-ladder@0.5", 0xbf099e32bf5443d5),
    ("saege-ladder@1", 0xbf099e32bf5443d5),
    ("saite@0.5", 0x33dce3d9e7b02f59),
    ("saite@1", 0xf5a29cd4af341431),
    ("sampler-fairlight@0.5", 0x774b126e044daad8),
    ("sampler-fairlight@1", 0x450b21511151c67f),
    ("wavetable-chor@0.5", 0x4be4c74be465dcdb),
    ("wavetable-chor@1", 0x2b36e85339a68333),
    ("wavetable-reese@0.5", 0x10a5a344a4a314ae),
    ("wavetable-reese@1", 0x87f4a210a5838bf2),
    ("wavetable-supersaw@0.5", 0xc0e26b840a32ceaa),
    ("wavetable-supersaw@1", 0xb16c8e8c6bba3401),
    ("saege-frei", 0x0d24772b9bb3ebf0),
    ("puls-frei", 0xd10864df327d9d24),
    ("dreieck-frei", 0xf7631bf055ddb725),
    ("sinus-frei", 0xfbd5b5b246830e17),
    ("sinus-fm", 0x1a86cd1397b87956),
    ("sync-saege-saege", 0xcfc9709a34797da1),
    ("sync-saege-puls", 0xef848cd8369b4bc9),
    ("sync-saege-dreieck", 0x1002a49042d4ff55),
    ("sync-saege-sinus", 0xe6a16228110b2516),
    ("sync-puls-saege", 0x73188c55721d0c41),
    ("sync-puls-puls", 0x7c7ed07a61da2d08),
    ("sync-puls-dreieck", 0xd480f5136ce5501c),
    ("sync-puls-sinus", 0x15fc50acc50af281),
    ("sync-dreieck-saege", 0xde170f4629ffb6c4),
    ("sync-dreieck-puls", 0x18bf6eab4a76d94a),
    ("sync-dreieck-dreieck", 0xccd2f9b41eb83685),
    ("sync-dreieck-sinus", 0x7b350b5dc0a2043c),
    ("sync-sinus-saege", 0x0ada5f7a8c9a49d6),
    ("sync-sinus-puls", 0xa99ce2c781051bd4),
    ("sync-sinus-dreieck", 0xf4ef0dcc7face1c2),
    ("sync-sinus-sinus", 0x98a1e4149f521732),
];

#[test]
fn bestehende_graphen_bitgleich_wie_vor_dem_hard_sync() {
    let ist = alle();
    if std::env::var_os("HART_FINGERABDRUCK").is_some() {
        for (n, h) in &ist {
            println!("    (\"{n}\", 0x{h:016x}),");
        }
    }
    assert_eq!(ist.len(), VORHER.len(), "the list of fingerprinted graphs changed");
    let falsch: Vec<String> = ist.iter().zip(VORHER).filter(|((n, h), (vn, vh))| n != vn || h != vh).map(|((n, _), _)| n.clone()).collect();
    assert!(falsch.is_empty(), "{} of {} graphs are no longer bit-identical: {falsch:?}", falsch.len(), ist.len());
}
