//! The effect blocks `chorus`, `delay` and `hall` pass the dry signal bit for bit when their `mix` input is a constant 0
//! (plan synth-ausbau, Task 2; Task 10 relies on it: a synth with the effects wired in must sound like the one without them
//! while the knobs are at 0). A micro graph (note, saw, effect, `ausgang`) renders 4800 samples and is compared with the same
//! graph without the effect, bit for bit. If a block misses, the test names how far (dB) and the tolerance fallback below
//! applies to that block only.
use baukasten_dsp::uebersetze;

const SR: f32 = 48_000.0;
const N: usize = 4800;

/// Tolerance fallback: at most this level of the difference against the dry signal (dBFS). Empty at the time of writing:
/// every block passes bit-exact (see kosten-gate.md). A block that does not gets an entry here with the measured dB and the reason.
const TOLERANZ_DB: &[(&str, f32)] = &[];

fn render(knoten: &str, kanten: &str) -> Vec<(f32, f32)> {
    let g = format!(
        r#"{{"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{{"id":"n","art":"note"}},{{"id":"s","art":"saege"}},{{"id":"o","art":"ausgang"}},{{"id":"m","art":"mul","b":0.5}},{{"id":"null","art":"konst","wert":0}}{knoten}],"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"s.aus","nach":"m.a"}}{kanten}]}}"#
    );
    let mut p = uebersetze(&g, SR).unwrap_or_else(|e| panic!("{e}"));
    p.note_an(57, 1.0);
    (0..N).map(|_| p.sample_stereo()).collect()
}

fn db(x: f64) -> f32 { (20.0 * x.max(1e-30).log10()) as f32 }

/// `mit` carries the effect, `ohne` is the reference; same rule for all: bit-exact unless the block has a tolerance entry.
fn gleich(block: &str, mit: Vec<(f32, f32)>, ohne: Vec<(f32, f32)>) {
    let mut falsch = 0usize;
    let mut groesste = 0.0f64;
    let mut erster = None;
    for (i, (a, b)) in mit.iter().zip(&ohne).enumerate() {
        if (a.0.to_bits(), a.1.to_bits()) != (b.0.to_bits(), b.1.to_bits()) {
            falsch += 1;
            erster.get_or_insert(i);
            groesste = groesste.max(((a.0 - b.0) as f64).abs()).max(((a.1 - b.1) as f64).abs());
        }
    }
    let laut: f64 = ohne.iter().map(|s| (s.0 as f64).abs().max((s.1 as f64).abs())).fold(0.0, f64::max);
    assert!(laut > 0.1, "{block}: the dry signal is silent, the comparison would be blind ({laut})");
    if falsch == 0 { return; }
    let abstand = db(groesste);
    match TOLERANZ_DB.iter().find(|(b, _)| *b == block) {
        Some((_, grenze)) => assert!(abstand <= *grenze, "{block}: {abstand} dB over the fallback {grenze} dB"),
        None => panic!("{block}: {falsch} of {N} samples differ, first at {erster:?}, largest difference {abstand:.1} dBFS"),
    }
}

const MONO_REF: &str = r#",{"von":"s.aus","nach":"o.x"}"#;
const STEREO_REF: &str = r#",{"von":"s.aus","nach":"o.l"},{"von":"m.aus","nach":"o.r"}"#;

/// The hall's smoother starts at the node's own `mix` (default 0.3, programm.rs `Schritt::Hall`) and ramps to the input value:
/// with the node default the first 4800 samples carry wet signal (all but the first differ, largest -10.6 dBFS). So the node
/// is written with `"mix":0` as well, which is what Task 10 does (node value = knob default = 0).
/// Chorus and delay take the input at once and need no such value.
const MIX0: &str = r#","mix":0"#;

fn knoten(art: &str, extra: &str) -> String { format!(r#",{{"id":"fx","art":"{art}"{extra}}}"#) }

const AUS: &str = r#",{"von":"fx.l","nach":"o.l"},{"von":"fx.r","nach":"o.r"},{"von":"null.aus","nach":"fx.mix"}"#;

#[test]
fn chorus_mix_null_ist_durchlass() {
    for modus in [1, 2, 3] {
        let mit = render(&knoten("chorus", &format!(r#","modus":{modus}"#)), &format!(r#",{{"von":"s.aus","nach":"fx.x"}}{AUS}"#));
        gleich(&format!("chorus"), mit, render("", MONO_REF));
    }
}

#[test]
fn delay_mix_null_ist_durchlass() {
    let mit = render(&knoten("delay", ""), &format!(r#",{{"von":"s.aus","nach":"fx.x"}}{AUS}"#));
    gleich("delay", mit, render("", MONO_REF));
    let mit = render(&knoten("delay", r#","pingpong":1"#), &format!(r#",{{"von":"s.aus","nach":"fx.l"}},{{"von":"m.aus","nach":"fx.r"}}{AUS}"#));
    gleich("delay", mit, render("", STEREO_REF));
}

#[test]
fn hall_mix_null_ist_durchlass() {
    let mit = render(&knoten("hall", MIX0), &format!(r#",{{"von":"s.aus","nach":"fx.x"}}{AUS}"#));
    gleich("hall", mit, render("", MONO_REF));
    let mit = render(&knoten("hall", MIX0), &format!(r#",{{"von":"s.aus","nach":"fx.l"}},{{"von":"m.aus","nach":"fx.r"}}{AUS}"#));
    gleich("hall", mit, render("", STEREO_REF));
}

#[test]
fn kette_aus_drei_ist_durchlass() {
    let k = format!("{}{}{}", knoten("chorus", "").replace("\"fx\"", "\"c\""), knoten("delay", "").replace("\"fx\"", "\"d\""), knoten("hall", MIX0).replace("\"fx\"", "\"h\""));
    let kanten = r#",{"von":"s.aus","nach":"c.x"},{"von":"c.l","nach":"d.l"},{"von":"c.r","nach":"d.r"},{"von":"d.l","nach":"h.l"},{"von":"d.r","nach":"h.r"},{"von":"h.l","nach":"o.l"},{"von":"h.r","nach":"o.r"},{"von":"null.aus","nach":"c.mix"},{"von":"null.aus","nach":"d.mix"},{"von":"null.aus","nach":"h.mix"}"#;
    gleich("kette", render(&k, kanten), render("", MONO_REF));
}
