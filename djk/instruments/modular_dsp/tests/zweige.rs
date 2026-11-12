//! Branch skipping of the selector `wahl` (src/zweige.rs): what it must not change, what it changes exactly, and that the
//! tests notice when the rule is broken.
//!
//!  * every example and recipe graph renders bit-identical with branches on and off, under six constant knob settings (the steady
//!    state: no `wahl` changes its position),
//!  * a switch of a `wahl` position at run time: stateless branches and branches with oscillators (phase, noise, LFO; also with
//!    hard and soft sync) stay bit-identical through the whole run, a branch with filters differs only by a decaying cold start of
//!    the branch that was off (pinned with numbers); the reset itself is pinned bit for bit against a freshly built program,
//!  * the shape of the branches (what may and may not sit in one),
//!  * mutations: with the skip rule broken on purpose (`Fehlerprobe`) the same comparisons turn red.
mod render_hilfe;
use baukasten_dsp::{uebersetze, Fehlerprobe, Programm};
use render_hilfe::*;

fn gleich(a: &[f32], b: &[f32]) -> bool { a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.to_bits() == y.to_bits()) }

fn graph(name: &str) -> String { graphen().into_iter().find(|(n, _)| n == name).unwrap_or_else(|| panic!("no graph {name}")).1 }

/// The fixed script of `render_hilfe` on `json`; `probe` breaks the rule on purpose. Returns the output and the program.
fn spiele_mit(json: &str, knopf: Option<f32>, zweige: bool, probe: Fehlerprobe) -> (Vec<f32>, Programm) {
    let mut p = lade(json).unwrap();
    p.setze_zweige(zweige);
    p.setze_fehlerprobe(probe);
    let x = spiele(&mut p, knopf);
    (x, p)
}

// ------------------------------------------------------------------------------------------------ steady state: all graphs

#[test]
fn jeder_beispielgraph_ist_bitgleich_mit_und_ohne_zweige() {
    let (mut mit, mut gesprungen) = (Vec::new(), Vec::new());
    for (name, json) in graphen() {
        for e in EINSTELLUNGEN {
            let (a, pa) = spiele_mit(&json, e, true, Fehlerprobe::Keine);
            let (b, pb) = spiele_mit(&json, e, false, Fehlerprobe::Keine);
            assert!(gleich(&a, &b), "{name} knobs {e:?}: output differs with branches on");
            assert_eq!(pb.uebersprungen(), 0, "{name}: nothing may be skipped with branches off");
            if e == Some(0.5) {
                if !pa.zweige_info().is_empty() { mit.push(name.clone()); }
                if pa.uebersprungen() > 0 { gesprungen.push(name.clone()); }
            }
        }
    }
    println!("MESS graphs with branches ({}): {mit:?}", mit.len());
    println!("MESS graphs that skipped steps at knobs 0.5 ({}): {gesprungen:?}", gesprungen.len());
    // the mechanism must be alive in the graphs it is for, or the comparison above proves nothing
    for g in ["synth-poly.json", "synth-mono.json", "synth-neuro.json", "fx-filterbox.json"] {
        assert!(mit.iter().any(|n| n == g), "{g} has no branches");
        assert!(gesprungen.iter().any(|n| n == g), "{g} skipped nothing");
    }
}

#[test]
fn mutation_ausgewaehlten_zweig_auslassen_wird_erkannt() {
    for g in ["synth-poly.json", "synth-mono.json", "synth-neuro.json", "fx-filterbox.json"] {
        let json = graph(g);
        let (ref_, _) = spiele_mit(&json, Some(0.5), false, Fehlerprobe::Keine);
        let (bad, _) = spiele_mit(&json, Some(0.5), true, Fehlerprobe::ZielAuslassen);
        assert!(!gleich(&ref_, &bad), "{g}: skipping the selected branch must change the output");
    }
}

// ------------------------------------------------------------------------------------------------ the shape of the branches

/// One `wahl` `w` with three candidates (`kand` = extra nodes, `kanten` = extra edges, both starting with a comma), a saw `s`
/// from the note, knob 1 on the selector, output of `w` on `ausgang.x`.
fn schalt(kand: &str, kanten: &str, blende: u32, modus: u8) -> String {
    format!(
        r#"{{"format":"baukasten/2","name":"zw","stimmen":1,"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"k","art":"regler","nr":1,"min":0,"max":1}},{{"id":"w","art":"wahl","n":3,"norm":1,"blende":{blende},"modus":{modus}}},{{"id":"o","art":"ausgang"}}{kand}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"k.aus","nach":"w.wahl"}},{{"von":"w.aus","nach":"o.x"}}{kanten}]}}"#
    )
}

/// three stateless candidates, each fed by the saw
fn statlos(blende: u32) -> String {
    schalt(
        r#",{"id":"c1","art":"mul","b":0.5},{"id":"c2","art":"add","b":0.1},{"id":"c3","art":"mul","b":-0.3}"#,
        r#",{"von":"s.aus","nach":"c1.a"},{"von":"c1.aus","nach":"w.e1"},{"von":"s.aus","nach":"c2.a"},{"von":"c2.aus","nach":"w.e2"},{"von":"s.aus","nach":"c3.a"},{"von":"c3.aus","nach":"w.e3"}"#,
        blende, 0,
    )
}

/// ladder, state-variable and diode filter on the same saw
fn filter(blende: u32) -> String {
    schalt(
        r#",{"id":"l1","art":"ladder","cutoff":900,"reso":0.6},{"id":"l2","art":"sem","cutoff":1500,"reso":0.4},{"id":"l3","art":"diode","cutoff":700,"reso":0.5,"antrieb":6}"#,
        r#",{"von":"s.aus","nach":"l1.x"},{"von":"l1.aus","nach":"w.e1"},{"von":"s.aus","nach":"l2.x"},{"von":"l2.aus","nach":"w.e2"},{"von":"s.aus","nach":"l3.x"},{"von":"l3.aus","nach":"w.e3"}"#,
        blende, 0,
    )
}

/// sine, triangle and pulse oscillator at the note's pitch
fn phase(blende: u32) -> String {
    schalt(
        r#",{"id":"p1","art":"sinus"},{"id":"p2","art":"dreieck"},{"id":"p3","art":"puls"}"#,
        r#",{"von":"n.hz","nach":"p1.hz"},{"von":"p1.aus","nach":"w.e1"},{"von":"n.hz","nach":"p2.hz"},{"von":"p2.aus","nach":"w.e2"},{"von":"n.hz","nach":"p3.hz"},{"von":"p3.aus","nach":"w.e3"}"#,
        blende, 0,
    )
}

fn zweige(json: &str) -> Vec<usize> { uebersetze(json, SR).unwrap().zweige_info() }

#[test]
fn zweig_je_kandidat_ohne_das_gemeinsame() {
    // the saw feeds all three candidates, so it stays on the always-running path: one step per branch
    assert_eq!(zweige(&statlos(20)), vec![1, 1, 1]);
    assert_eq!(zweige(&filter(20)), vec![1, 1, 1]);
    assert_eq!(zweige(&phase(20)), vec![1, 1, 1]);
}

#[test]
fn ein_zweiter_leser_nimmt_den_schritt_aus_dem_zweig() {
    // c1 is also tapped to the output: it must run always
    let j = statlos(20).replace(r#"{"von":"w.aus","nach":"o.x"}"#, r#"{"von":"w.aus","nach":"o.x"},{"von":"c1.aus","nach":"o.l"}"#);
    assert_eq!(zweige(&j), vec![1, 1]);
    // c2 is read through a delayed edge by a step outside the branches
    let j = statlos(20).replace(r#"{"von":"w.aus","nach":"o.x"}"#, r#"{"von":"w.aus","nach":"o.x"},{"von":"c2.aus","nach":"o.r","verzoegerung":1}"#);
    assert_eq!(zweige(&j), vec![1, 1]);
    // c3 is read by the selector's own producer chain (the knob): not exclusive either
    let j = statlos(20).replace(r#"{"id":"k","art":"regler","nr":1,"min":0,"max":1}"#, r#"{"id":"k","art":"regler","nr":1,"min":0,"max":1},{"id":"kk","art":"add"}"#)
        .replace(r#"{"von":"k.aus","nach":"w.wahl"}"#, r#"{"von":"k.aus","nach":"kk.a"},{"von":"c3.aus","nach":"kk.b"},{"von":"kk.aus","nach":"w.wahl"}"#);
    assert_eq!(zweige(&j), vec![1, 1]);
}

#[test]
fn eine_huellkurve_im_zweig_bleibt_draussen() {
    // the ladder's cutoff comes from an envelope: the envelope keeps its state across a gate and never enters a branch
    let j = schalt(
        r#",{"id":"l1","art":"ladder","reso":0.3},{"id":"e","art":"adsr","a":0.01,"d":0.2,"s":0.5,"r":0.2},{"id":"em","art":"mul","b":4000},{"id":"c2","art":"mul","b":0.5},{"id":"c3","art":"mul","b":0.2}"#,
        r#",{"von":"n.gate","nach":"e.gate"},{"von":"n.trig","nach":"e.trig"},{"von":"e.aus","nach":"em.a"},{"von":"em.aus","nach":"l1.cutoff"},{"von":"s.aus","nach":"l1.x"},{"von":"l1.aus","nach":"w.e1"},{"von":"s.aus","nach":"c2.a"},{"von":"c2.aus","nach":"w.e2"},{"von":"s.aus","nach":"c3.a"},{"von":"c3.aus","nach":"w.e3"}"#,
        20, 0,
    );
    // `em` (a stateless mul) is in the ladder's branch, the envelope behind it is not
    assert_eq!(zweige(&j), vec![2, 1, 1]);
}

#[test]
fn morph_hat_keine_zweige() {
    assert!(zweige(&schalt(
        r#",{"id":"c1","art":"mul","b":0.5},{"id":"c2","art":"mul","b":0.7},{"id":"c3","art":"mul","b":0.9}"#,
        r#",{"von":"s.aus","nach":"c1.a"},{"von":"c1.aus","nach":"w.e1"},{"von":"s.aus","nach":"c2.a"},{"von":"c2.aus","nach":"w.e2"},{"von":"s.aus","nach":"c3.a"},{"von":"c3.aus","nach":"w.e3"}"#,
        20, 1,
    )).is_empty());
}

/// a `wahl` `w2` (selected by knob 2) sits in candidate 1 of `w` and has two stateless candidates of its own
fn verschachtelt(blende: u32) -> String {
    schalt(
        r#",{"id":"k2","art":"regler","nr":2,"min":0,"max":1},{"id":"w2","art":"wahl","n":2,"norm":1,"blende":10},{"id":"a1","art":"mul","b":0.5},{"id":"a2","art":"add","b":0.25},{"id":"c2","art":"mul","b":0.4},{"id":"c3","art":"mul","b":-0.3}"#,
        r#",{"von":"k2.aus","nach":"w2.wahl"},{"von":"s.aus","nach":"a1.a"},{"von":"a1.aus","nach":"w2.e1"},{"von":"s.aus","nach":"a2.a"},{"von":"a2.aus","nach":"w2.e2"},{"von":"w2.aus","nach":"w.e1"},{"von":"s.aus","nach":"c2.a"},{"von":"c2.aus","nach":"w.e2"},{"von":"s.aus","nach":"c3.a"},{"von":"c3.aus","nach":"w.e3"}"#,
        blende, 0,
    )
}

#[test]
fn verschachtelte_wahl_bildet_zweige_in_zweigen() {
    // outer branch 0: the inner selector's knob `k2` (nobody else reads it) + WahlVor + (Zweig + a1) + (Zweig + a2) + WahlMisch
    // = 7 steps; then the inner branches a1 and a2 (1 step each, listed in program order after the outer one), c2, c3
    assert_eq!(zweige(&verschachtelt(20)), vec![7, 1, 1, 1, 1]);
}

// ------------------------------------------------------------------------------------------------ switching at run time

const T0: usize = 6_000;
const T1: usize = 20_000;
const T2: usize = 34_000;
const LAENGE: usize = 48_000;

/// Knob 1 at 0 (position 0), to 0.5 (position 1) at T0, to 1 (position 2) at T1, back to 0 at T2; `k2` is the second knob
/// (nested graph) which goes 0 -> 1 -> 0 at T0 + 4000 / T1 + 4000. One note held all the time. Returns the left output.
fn schalte(json: &str, zweige: bool, probe: Fehlerprobe) -> (Vec<f32>, Programm) {
    let mut p = lade(json).unwrap();
    p.setze_zweige(zweige);
    p.setze_fehlerprobe(probe);
    p.setze_regler(1, 0.0);
    p.setze_regler(2, 0.0);
    p.note_an(45, 0.8);
    let y = (0..LAENGE).map(|i| {
        match i {
            T0 => p.setze_regler(1, 0.5),
            T1 => p.setze_regler(1, 1.0),
            T2 => p.setze_regler(1, 0.0),
            x if x == T0 + 4_000 => p.setze_regler(2, 1.0),
            x if x == T1 + 4_000 => p.setze_regler(2, 0.0),
            _ => {}
        }
        p.sample_stereo().0
    }).collect();
    (y, p)
}

fn diff(a: &[f32], b: &[f32], von: usize, bis: usize) -> f32 { (von..bis).map(|i| (a[i] - b[i]).abs()).fold(0.0, f32::max) }

#[test]
fn zustandslose_zweige_bleiben_auch_beim_umschalten_bitgleich() {
    for (name, j) in [("statlos", statlos(20)), ("statlos hart", statlos(0)), ("verschachtelt", verschachtelt(20))] {
        let (a, pa) = schalte(&j, true, Fehlerprobe::Keine);
        let (b, _) = schalte(&j, false, Fehlerprobe::Keine);
        assert!(gleich(&a, &b), "{name}: a stateless branch must not change anything, also through the switches");
        assert!(pa.uebersprungen() > 0, "{name}: nothing was skipped");
    }
}

#[test]
fn zaehler_uebersprungener_schritte_stimmt() {
    // statlos: 3 one-step branches, position 0 until T0: two of them skipped in each of the T0 samples (voice count 1)
    let mut p = lade(&statlos(20)).unwrap();
    p.setze_regler(1, 0.0);
    p.note_an(45, 0.8);
    for _ in 0..T0 { p.sample_stereo(); }
    assert_eq!(p.uebersprungen(), 2 * T0 as u64);
    // the knob goes to the middle: position 1 is read from this sample on (target of the fade), position 0 fades out for
    // `blende` = 20 ms = 960 samples and is read all that time: during the fade only the third branch is skipped (one
    // step per sample), after it branch 0 is off as well (two). The fade ends within a sample of 960 (float steps).
    p.setze_regler(1, 0.5);
    for _ in 0..1_100 { p.sample_stereo(); }
    let soll = 2 * T0 as u64 + 960 + 2 * 140;
    assert!(p.uebersprungen().abs_diff(soll) <= 3, "skipped {} steps, expected {soll} +- 3", p.uebersprungen());
}

#[test]
fn mutation_zweig_im_fade_abschneiden_wird_erkannt() {
    // the branch that fades out is cut off when the fade starts: its stale value is mixed in, the output differs
    let j = statlos(20);
    let (ref_, _) = schalte(&j, false, Fehlerprobe::Keine);
    let (bad, _) = schalte(&j, true, Fehlerprobe::FadeAbschneiden);
    assert!(diff(&ref_, &bad, T0, T0 + 960) > 0.01, "cutting the fade must be audible in the fade window");
    let (bad, _) = schalte(&j, true, Fehlerprobe::ZielAuslassen);
    assert!(diff(&ref_, &bad, 0, T0) > 0.01, "skipping the selected branch must be audible in the steady state");
}

#[test]
fn filterzweig_beginnt_nach_dem_umschalten_kalt_und_gleicht_sich_an() {
    let j = filter(20);
    let (a, pa) = schalte(&j, true, Fehlerprobe::Keine);
    let (b, _) = schalte(&j, false, Fehlerprobe::Keine);
    assert!(pa.uebersprungen() > 0);
    // steady state until the first switch: bit for bit
    assert!(gleich(&a[..T0], &b[..T0]), "before the first switch nothing differs");
    let fade = 960;
    let mess = |von: usize| (diff(&a, &b, von, von + fade + 1), diff(&a, &b, von + fade + 1, von + fade + 1 + 4_800), diff(&a, &b, von + fade + 4_800, von + 12_000));
    for (name, von) in [("0 -> 1", T0), ("1 -> 2", T1), ("2 -> 0", T2)] {
        let (im_fade, danach_100ms, spaeter) = mess(von);
        println!("MESS filter switch {name}: max diff in fade {im_fade:.5}, 0..100 ms after the fade {danach_100ms:.5}, later {spaeter:.6}");
        // measured on 2026-11-12: 0.0031, 0.0025, 0.0464 in the fade; 0, 0, 0.0092 in the 100 ms after it; 0 later (< 1e-6)
        // (this is not the proof of the reset: it holds without one too; `wiedereintritt_setzt_jeden_zustandszweig_auf_frisch_zurueck` is)
        assert!(im_fade > 1e-4, "{name}: the filter that ran unheard is not the cold one, so the fade differs, diff {im_fade}");
        assert!(im_fade < 0.1, "{name}: diff in the fade {im_fade}");
        assert!(danach_100ms < 0.02, "{name}: diff in the 100 ms after the fade {danach_100ms}");
        assert!(spaeter < 1e-4, "{name}: the cold start decays, diff later {spaeter}");
    }
    // the mutation (selected branch skipped) must be far above this
    let (bad, _) = schalte(&j, true, Fehlerprobe::ZielAuslassen);
    assert!(diff(&b, &bad, 0, T0) > 0.05);
}

/// the oscillators that carry a phase, one per candidate: a saw hard-synced to a master (`hart`), a pulse soft-synced to the same
/// master (`sync`), and the master itself as the third candidate (so it stays on the always-running path)
fn sync_osz(blende: u32) -> String {
    schalt(
        r#",{"id":"mh","art":"konst","wert":173.0},{"id":"m","art":"saege"},{"id":"sa","art":"saege"},{"id":"pu","art":"puls"}"#,
        r#",{"von":"mh.aus","nach":"m.hz"},{"von":"n.hz","nach":"sa.hz"},{"von":"m.hart","nach":"sa.hart"},{"von":"sa.aus","nach":"w.e1"},{"von":"n.hz","nach":"pu.hz"},{"von":"m.zyklus","nach":"pu.sync"},{"von":"pu.aus","nach":"w.e2"},{"von":"m.aus","nach":"w.e3"}"#,
        blende, 0,
    )
}

/// a random LFO, a noise source and a beat-synchronous LFO in the three candidates
fn lfo_rausch(blende: u32) -> String {
    schalt(
        r#",{"id":"l1","art":"lfo","form":4,"rate":300},{"id":"r","art":"rauschen"},{"id":"l3","art":"lfo","form":0,"takt":0.01}"#,
        r#",{"von":"l1.aus","nach":"w.e1"},{"von":"r.aus","nach":"w.e2"},{"von":"l3.aus","nach":"w.e3"}"#,
        blende, 0,
    )
}

#[test]
fn oszillatorzweige_laufen_im_uebersprung_in_phase_weiter() {
    // An oscillator in a skipped branch advances only its phase (and noise stream), so it is where the reference
    // (`setze_zweige(false)`) has it when the branch is read again: the whole run is bit-identical, switches included.
    for (name, j) in [
        ("phase hard", phase(0)), ("phase fade", phase(20)),
        ("sync hard", sync_osz(0)), ("sync fade", sync_osz(20)),
        ("lfo/noise hard", lfo_rausch(0)), ("lfo/noise fade", lfo_rausch(20)),
    ] {
        assert!(zweige(&j).iter().all(|&g| g == 1), "{name}: expected one-oscillator branches, got {:?}", zweige(&j));
        let (a, pa) = schalte(&j, true, Fehlerprobe::Keine);
        let (b, _) = schalte(&j, false, Fehlerprobe::Keine);
        assert!(pa.uebersprungen() > 0, "{name}: nothing was skipped, the test would prove nothing");
        let d = diff(&a, &b, 0, LAENGE);
        println!("MESS {name}: max diff against the reference {d:e}");
        assert!(gleich(&a, &b), "{name}: differs from the reference, max diff {d:e}");
    }
}

#[test]
fn oszillator_mit_eingang_aus_dem_zweig_bleibt_draussen() {
    // the oscillator's frequency is made by a step that only this branch uses: that step would be skipped and its slot stale,
    // so the phase could not be kept right. Both stay out of the branch (the branch holds nothing).
    let j = schalt(
        r#",{"id":"t","art":"transponiere","st":7},{"id":"p1","art":"sinus"},{"id":"c2","art":"mul","b":0.5},{"id":"c3","art":"mul","b":0.2}"#,
        r#",{"von":"n.hz","nach":"t.hz"},{"von":"t.aus","nach":"p1.hz"},{"von":"p1.aus","nach":"w.e1"},{"von":"s.aus","nach":"c2.a"},{"von":"c2.aus","nach":"w.e2"},{"von":"s.aus","nach":"c3.a"},{"von":"c3.aus","nach":"w.e3"}"#,
        0, 0,
    );
    assert_eq!(zweige(&j), vec![1, 1], "only the two mul branches; the sine and its transposer run always");
    let (a, _) = schalte(&j, true, Fehlerprobe::Keine);
    let (b, _) = schalte(&j, false, Fehlerprobe::Keine);
    assert!(gleich(&a, &b));
    // an oscillator whose output a delayed edge reads outside stays out as well (the delayed value must stay right)
    let j = phase(20).replace(r#"{"von":"w.aus","nach":"o.x"}"#, r#"{"von":"w.aus","nach":"o.x"},{"von":"p1.aus","nach":"o.r","verzoegerung":1}"#);
    assert_eq!(zweige(&j), vec![1, 1]);
}

#[test]
fn synth_poly_osc2_wellenform_wechsel_gleicht_der_referenz() {
    // the measured case: knob 47 (`o2_wave`, saw / pulse of the second oscillator), 0 -> 1 and 1 -> 0, voices sounding
    let json = graph("synth-poly.json");
    let rms = |x: &[f32]| (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt();
    for (name, von, nach) in [("0 -> 1", 0.0f32, 1.0f32), ("1 -> 0", 1.0, 0.0)] {
        let lauf = |zweige: bool| {
            let mut p = lade(&json).unwrap();
            p.setze_zweige(zweige);
            for nr in 1..=baukasten_dsp::REGLER { p.setze_regler(nr, 0.5); }
            p.setze_regler(47, von);
            for n in [45u8, 52, 57] { p.note_an(n, 0.8); }
            let y: Vec<f32> = (0..30_000).map(|i| {
                if i == 10_000 { p.setze_regler(47, nach); }
                p.sample_stereo().0
            }).collect();
            (y, p.uebersprungen())
        };
        let (a, ua) = lauf(true);
        let (b, _) = lauf(false);
        assert!(ua > 0, "{name}: nothing skipped");
        let (ra, rb) = (rms(&a[12_000..]), rms(&b[12_000..]));
        let d = diff(&a, &b, 0, 30_000);
        println!("MESS synth-poly o2_wave {name}: rms {ra:.5} against reference {rb:.5}, max diff {d:e}");
        assert!((ra / rb - 1.0).abs() < 0.01, "{name}: rms {ra} against {rb}");
        // nothing else moves in this run, so the whole render equals the reference
        assert!(d < 1e-6, "{name}: max diff {d}");
    }
}

// ------------------------------------------------------------------------------------------------ the reset of a stateful branch

/// `art` (with the extra node values `werte`, output port `aus`) as candidate 1 of a hard-switching `wahl`, fed by the saw `s`; two
/// stateless candidates beside it.
fn zustand_zweig(art: &str, werte: &str, aus: &str) -> String {
    schalt(
        &format!(r#",{{"id":"f","art":"{art}"{werte}}},{{"id":"c2","art":"mul","b":0.5}},{{"id":"c3","art":"mul","b":-0.3}}"#),
        &format!(r#",{{"von":"s.aus","nach":"f.x"}},{{"von":"f.{aus}","nach":"w.e1"}},{{"von":"s.aus","nach":"c2.a"}},{{"von":"c2.aus","nach":"w.e2"}},{{"von":"s.aus","nach":"c3.a"}},{{"von":"c3.aus","nach":"w.e3"}}"#),
        0, 0,
    )
}

/// One note held, knob 1 set to `(sample, value)` entries; the left output for `laenge` samples.
fn lauf_mit_regler(json: &str, regler: &[(usize, f32)], laenge: usize) -> Vec<f32> {
    let mut p = lade(json).unwrap();
    p.setze_regler(2, 0.0);
    p.note_an(45, 0.8);
    (0..laenge).map(|i| {
        for &(t, k) in regler {
            if t == i { p.setze_regler(1, k); }
        }
        p.sample_stereo().0
    }).collect()
}

#[test]
fn wiedereintritt_setzt_jeden_zustandszweig_auf_frisch_zurueck() {
    // The filter runs in position 0, the knob goes to position 1 (hard), the branch is off for 20000 samples, the knob returns. From the
    // sample of the return on, the output must equal that of a program that was in position 1 from the start and goes into
    // position 0 for the first time at the same sample: no rest of the old filter state, no jump. (A branch that merely
    // decays towards the reference would pass a threshold test; this one compares bit for bit.)
    let arten = [
        ("ladder", r#","cutoff":900,"reso":0.6"#, "aus"),
        ("svf", r#","cutoff":1200,"reso":0.5"#, "tp"),
        ("sem", r#","cutoff":1500,"reso":0.4"#, "aus"),
        ("diode", r#","cutoff":700,"reso":0.5,"antrieb":6"#, "aus"),
        ("ms20", r#","cutoff":1100,"reso":0.5,"antrieb":2"#, "tp"),
        ("roehre", r#","antrieb":4"#, "aus"),
        ("falter", r#","antrieb":3"#, "aus"),
        ("saett", r#","antrieb":4"#, "aus"),
        ("krume", r#","bits":6,"rate":9000"#, "aus"),
    ];
    for (art, werte, aus) in arten {
        let j = zustand_zweig(art, werte, aus);
        assert!(zweige(&j).contains(&1), "{art}: no branch was built: {:?}", zweige(&j));
        let a = lauf_mit_regler(&j, &[(0, 0.0), (T0, 0.5), (T2, 0.0)], T2 + 12_000);
        let b = lauf_mit_regler(&j, &[(0, 0.5), (T2, 0.0)], T2 + 12_000);
        // the branch really sounded before (so there was a state to forget) and the two renders differ before the return
        assert!(a[T0 - 100..T0].iter().any(|v| v.abs() > 0.01), "{art}: the branch was silent before the switch");
        let d = diff(&a, &b, T2, T2 + 12_000);
        println!("MESS reset {art}: max diff after the return against a fresh program {d:e}");
        assert!(gleich(&a[T2..], &b[T2..]), "{art}: output after the return differs from a fresh program, max diff {d:e}");
    }
}
