//! Echtzeit-Gegenprobe: sample, note_an, note_aus, alle_aus, setze_regler und zuruecksetzen fordern keinen Speicher an,
//! für jeden Beispielgraphen;
//! uebersetze schon (Positivkontrolle, sonst wäre der Zähler blind). Muster: hall_ffi/tests/rb_keine_allokation.rs.
use baukasten_dsp::uebersetze_mit_wurzel;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

struct Zaehler;
static ANFORDERUNGEN: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Zaehler {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ANFORDERUNGEN.fetch_add(1, Ordering::SeqCst);
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) { System.dealloc(p, l) }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        ANFORDERUNGEN.fetch_add(1, Ordering::SeqCst);
        System.realloc(p, l, n)
    }
}
#[global_allocator]
static A: Zaehler = Zaehler;

/// Vier Stimmen Sägezahn hinter einer Hüllkurve in einen Chorus, links und rechts getrennt (Slice 2b)
const CHORUS_1: &str = r#"{"format":"baukasten/2","name":"chorus-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"e","art":"adsr","a":0.01,"d":0.1,"s":1,"r":0.2},{"id":"vca","art":"mul"},{"id":"ch","art":"chorus","modus":1},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.gate","nach":"e.gate"},{"von":"n.trig","nach":"e.trig"},{"von":"s.aus","nach":"vca.a"},{"von":"e.aus","nach":"vca.b"},{"von":"vca.aus","nach":"ch.x"},{"von":"ch.l","nach":"o.l"},{"von":"ch.r","nach":"o.r"}]}"#;
const CHORUS_3: &str = r#"{"format":"baukasten/2","name":"chorus-3","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"e","art":"adsr","a":0.01,"d":0.1,"s":1,"r":0.2},{"id":"vca","art":"mul"},{"id":"ch","art":"chorus","modus":3,"mix":0.7},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.gate","nach":"e.gate"},{"von":"n.trig","nach":"e.trig"},{"von":"s.aus","nach":"vca.a"},{"von":"e.aus","nach":"vca.b"},{"von":"vca.aus","nach":"ch.x"},{"von":"ch.l","nach":"o.l"},{"von":"ch.r","nach":"o.r"}]}"#;

/// Vier Stimmen Sägezahn in einen Hall, mix von Regler 1 über eine Kante: der `setze`-Pfad läuft mit (Slice 4a)
const HALL_1: &str = r#"{"format":"baukasten/2","name":"hall-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"e","art":"adsr","a":0.01,"d":0.1,"s":1,"r":0.2},{"id":"vca","art":"mul"},{"id":"h","art":"hall","rahmen":4,"mix":0.5},{"id":"k","art":"regler","nr":1,"min":0,"max":1},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.gate","nach":"e.gate"},{"von":"n.trig","nach":"e.trig"},{"von":"s.aus","nach":"vca.a"},{"von":"e.aus","nach":"vca.b"},{"von":"vca.aus","nach":"h.x"},{"von":"k.aus","nach":"h.mix"},{"von":"h.l","nach":"o.l"},{"von":"h.r","nach":"o.r"}]}"#;
/// Vier Stimmen Sägezahn in ein Delay mit Zeit am Regler (Lagrange-Pfad), Ping-Pong und Dämpfung (Slice 4b)
const DELAY_1: &str = r#"{"format":"baukasten/2","name":"delay-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"e","art":"adsr","a":0.01,"d":0.1,"s":1,"r":0.2},{"id":"vca","art":"mul"},{"id":"k","art":"regler","nr":2,"min":5,"max":900},{"id":"d","art":"delay","fb":0.7,"pingpong":1,"daempf":2500,"max":1000},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.gate","nach":"e.gate"},{"von":"n.trig","nach":"e.trig"},{"von":"s.aus","nach":"vca.a"},{"von":"e.aus","nach":"vca.b"},{"von":"vca.aus","nach":"d.x"},{"von":"k.aus","nach":"d.zeit"},{"von":"d.l","nach":"o.l"},{"von":"d.r","nach":"o.r"}]}"#;
/// Vier Stimmen Sägezahn in einen Limiter mit tiefer Decke und kurzem Release (Slice 4c)
const LIMITER_1: &str = r#"{"format":"baukasten/2","name":"limiter-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"e","art":"adsr","a":0.01,"d":0.1,"s":1,"r":0.2},{"id":"vca","art":"mul"},{"id":"g","art":"limiter","decke":-18,"vorlauf":5,"release":5},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.gate","nach":"e.gate"},{"von":"n.trig","nach":"e.trig"},{"von":"s.aus","nach":"vca.a"},{"von":"e.aus","nach":"vca.b"},{"von":"vca.aus","nach":"g.x"},{"von":"g.l","nach":"o.l"},{"von":"g.r","nach":"o.r"}]}"#;
/// Vier Stimmen Sägezahn in ein Gate, das bei jedem Notenwechsel öffnet und schließt (Slice 4c)
const GATE_1: &str = r#"{"format":"baukasten/2","name":"gate-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"e","art":"adsr","a":0.01,"d":0.1,"s":1,"r":0.02},{"id":"vca","art":"mul"},{"id":"g","art":"gate","schwelle":-20,"attack":0.5,"release":5},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.gate","nach":"e.gate"},{"von":"n.trig","nach":"e.trig"},{"von":"s.aus","nach":"vca.a"},{"von":"e.aus","nach":"vca.b"},{"von":"vca.aus","nach":"g.x"},{"von":"g.l","nach":"o.l"},{"von":"g.r","nach":"o.r"}]}"#;
/// Vier Stimmen Sägezahn in einen Komp mit Detektor-Hochpass und halbem Mix (Slice 4c)
const KOMP_1: &str = r#"{"format":"baukasten/2","name":"komp-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"e","art":"adsr","a":0.01,"d":0.1,"s":1,"r":0.2},{"id":"vca","art":"mul"},{"id":"k","art":"komp","schwelle":-30,"ratio":8,"attack":0.5,"release":20,"mix":0.5,"schp":150},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.gate","nach":"e.gate"},{"von":"n.trig","nach":"e.trig"},{"von":"s.aus","nach":"vca.a"},{"von":"e.aus","nach":"vca.b"},{"von":"vca.aus","nach":"k.x"},{"von":"k.l","nach":"o.l"},{"von":"k.r","nach":"o.r"}]}"#;
/// Vier Stimmen Sägezahn in eine gestimmte Rückkopplungsschleife mit modulierter Zeit (Slice 4f)
const LEITUNG_1: &str = r#"{"format":"baukasten/2","name":"leitung-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"e","art":"adsr","a":0.01,"d":0.1,"s":1,"r":0.2},{"id":"vca","art":"mul"},{"id":"a","art":"add"},{"id":"d","art":"leitung","max":50},{"id":"l","art":"lfo","rate":2},{"id":"t","art":"transponiere","cent":-30},{"id":"m","art":"mul","b":0.9},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.gate","nach":"e.gate"},{"von":"n.trig","nach":"e.trig"},{"von":"s.aus","nach":"vca.a"},{"von":"e.aus","nach":"vca.b"},{"von":"vca.aus","nach":"a.a"},{"von":"a.aus","nach":"d.x"},{"von":"n.hz","nach":"t.hz"},{"von":"l.aus","nach":"t.st"},{"von":"t.aus","nach":"d.hz"},{"von":"d.aus","nach":"m.a"},{"von":"m.aus","nach":"a.b"},{"von":"a.aus","nach":"o.x"}]}"#;
/// Four voices of saw through a krume with bits and rate on knobs (S7)
const KRUME_1: &str = r#"{"format":"baukasten/2","name":"krume-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"e","art":"adsr","a":0.01,"d":0.1,"s":1,"r":0.2},{"id":"vca","art":"mul"},{"id":"k","art":"krume"},{"id":"kb","art":"regler","nr":1,"min":2,"max":16},{"id":"kr","art":"regler","nr":2,"min":2000,"max":48000,"log":1},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.gate","nach":"e.gate"},{"von":"n.trig","nach":"e.trig"},{"von":"s.aus","nach":"vca.a"},{"von":"e.aus","nach":"vca.b"},{"von":"vca.aus","nach":"k.x"},{"von":"kb.aus","nach":"k.bits"},{"von":"kr.aus","nach":"k.rate"},{"von":"k.aus","nach":"o.x"}]}"#;
/// Four voices of saw through a phaser with rate, feedback and mix on knobs (S7)
const PHASER_1: &str = r#"{"format":"baukasten/2","name":"phaser-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"e","art":"adsr","a":0.01,"d":0.1,"s":1,"r":0.2},{"id":"vca","art":"mul"},{"id":"p","art":"phaser","stufen":8},{"id":"kr","art":"regler","nr":1,"min":0.05,"max":4,"log":1},{"id":"kf","art":"regler","nr":2,"min":-0.9,"max":0.9},{"id":"km","art":"regler","nr":3,"min":0,"max":1},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.gate","nach":"e.gate"},{"von":"n.trig","nach":"e.trig"},{"von":"s.aus","nach":"vca.a"},{"von":"e.aus","nach":"vca.b"},{"von":"vca.aus","nach":"p.x"},{"von":"kr.aus","nach":"p.rate"},{"von":"kf.aus","nach":"p.fb"},{"von":"km.aus","nach":"p.mix"},{"von":"p.l","nach":"o.l"},{"von":"p.r","nach":"o.r"}]}"#;
/// An effect graph with a modulated bias (eleven tables) and two stages, fed by a constant so the nonlinear path runs (S8)
const ROEHRE_FX: &str = r#"{"format":"baukasten/2","name":"roehre-fx","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"c","art":"konst","wert":0.6},{"id":"t","art":"roehre","antrieb":24,"stufen":2},{"id":"kd","art":"regler","nr":1,"min":0,"max":30},{"id":"kb","art":"regler","nr":2,"min":-3,"max":-0.5},{"id":"s","art":"add"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"s.a"},{"von":"c.aus","nach":"s.b"},{"von":"s.aus","nach":"t.x"},{"von":"kd.aus","nach":"t.antrieb"},{"von":"kb.aus","nach":"t.bias"},{"von":"t.aus","nach":"o.x"}]}"#;

/// S10: four voices of the generated probe, slice and direction from knobs, loop mode; the sample root is a temp dir
const SAMPLER_1: &str = r#"{"format":"baukasten/2","name":"sampler-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"sampler","datei":"probe.f32","scheiben":4,"schleife":1},{"id":"ks","art":"regler","nr":1,"min":0,"max":3},{"id":"kr","art":"regler","nr":2,"min":0,"max":1},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.trig","nach":"s.trig"},{"von":"n.gate","nach":"s.gate"},{"von":"ks.aus","nach":"s.scheibe"},{"von":"kr.aus","nach":"s.rueck"},{"von":"s.l","nach":"o.l"},{"von":"s.r","nach":"o.r"}]}"#;

/// S21: four voices of saw through a faltung (4097 frame IR: head, 15 tail partitions), mix on a knob, predelay 7 ms
const FALTUNG_1: &str = r#"{"format":"baukasten/2","name":"faltung-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"e","art":"adsr","a":0.01,"d":0.1,"s":1,"r":0.2},{"id":"vca","art":"mul"},{"id":"f","art":"faltung","datei":"ir.f32","pre":7},{"id":"k","art":"regler","nr":1,"min":0,"max":1},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.gate","nach":"e.gate"},{"von":"n.trig","nach":"e.trig"},{"von":"s.aus","nach":"vca.a"},{"von":"e.aus","nach":"vca.b"},{"von":"vca.aus","nach":"f.x"},{"von":"k.aus","nach":"f.mix"},{"von":"f.l","nach":"o.l"},{"von":"f.r","nach":"o.r"}]}"#;

/// Wavetable: four voices, seven copies on the vowel table; position, detune and width on knobs, so every cached value
/// (detune ratios, pan gains, smoother, mip level) changes while playing
const WAVETABLE_1: &str = r#"{"format":"baukasten/2","name":"wavetable-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"w","art":"wavetable","tabelle":5,"kopien":7},{"id":"kp","art":"regler","nr":1,"min":0,"max":1},{"id":"kd","art":"regler","nr":2,"min":0,"max":50},{"id":"kb","art":"regler","nr":3,"min":0,"max":1},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"w.hz"},{"von":"n.trig","nach":"w.trig"},{"von":"kp.aus","nach":"w.pos"},{"von":"kd.aus","nach":"w.verstimmung"},{"von":"kb.aus","nach":"w.breite"},{"von":"w.l","nach":"o.l"},{"von":"w.r","nach":"o.r"}]}"#;

/// Resonator: four voices, 32 bar modes struck by a noise burst while a saw drives the audio input; material,
/// brightness, size, position and inharmonicity on knobs, so the coefficients are rebuilt while playing
const RESONATOR_1: &str = r#"{"format":"baukasten/2","name":"resonator-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"r","art":"resonator","anregung":1},{"id":"k1","art":"regler","nr":1,"min":0,"max":1},{"id":"k2","art":"regler","nr":2,"min":0,"max":1},{"id":"k3","art":"regler","nr":3,"min":0.25,"max":4},{"id":"k4","art":"regler","nr":4,"min":0,"max":1},{"id":"k5","art":"regler","nr":5,"min":0,"max":2},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"r.hz"},{"von":"n.trig","nach":"r.trig"},{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"r.x"},{"von":"k1.aus","nach":"r.material"},{"von":"k2.aus","nach":"r.helligkeit"},{"von":"k3.aus","nach":"r.groesse"},{"von":"k4.aus","nach":"r.position"},{"von":"k5.aus","nach":"r.inharmonie"},{"von":"r.aus","nach":"o.x"}]}"#;

/// Metall: four voices, every input on a knob or the note (decay, tune, colour, noise, high-pass change while playing, so
/// every cached coefficient is recomputed), group choke on, choke input 1 - gate (chokes on release)
const METALL_1: &str = r#"{"format":"baukasten/2","name":"metall-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"m","art":"metall"},{"id":"k1","art":"regler","nr":1,"min":0.01,"max":3},{"id":"k2","art":"regler","nr":2,"min":0.5,"max":2},{"id":"k3","art":"regler","nr":3,"min":0,"max":1},{"id":"k4","art":"regler","nr":4,"min":0,"max":1},{"id":"k5","art":"regler","nr":5,"min":500,"max":16000},{"id":"inv","art":"mul","b":-1},{"id":"los","art":"add","b":1},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.trig","nach":"m.trig"},{"von":"n.vel","nach":"m.vel"},{"von":"k1.aus","nach":"m.decay"},{"von":"k2.aus","nach":"m.tune"},{"von":"k3.aus","nach":"m.farbe"},{"von":"k4.aus","nach":"m.rauschen"},{"von":"k5.aus","nach":"m.hp"},{"von":"n.gate","nach":"inv.a"},{"von":"inv.aus","nach":"los.a"},{"von":"los.aus","nach":"m.choke"},{"von":"m.aus","nach":"o.x"}]}"#;

/// FM: four voices, the six-operator stack with full feedback; index, feedback and decay on knobs (the guard and the
/// envelope coefficients are recomputed while playing), pitch moved by an LFO (the guard's pitch band moves)
const FM_1: &str = r#"{"format":"baukasten/2","name":"fm-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"f","art":"fm","algo":8,"o2_pegel":0.3,"o3_pegel":0.3,"o4_pegel":0.3,"o5_pegel":0.3,"o6_pegel":0.3,"o3_verh":2,"o2_d":0.3,"o2_s":0},{"id":"l","art":"lfo","rate":6},{"id":"t","art":"transponiere"},{"id":"ki","art":"regler","nr":1,"min":0,"max":2},{"id":"kr","art":"regler","nr":2,"min":0,"max":1},{"id":"kz","art":"regler","nr":3,"min":0.05,"max":20,"log":1},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"t.hz"},{"von":"l.aus","nach":"t.st"},{"von":"t.aus","nach":"f.hz"},{"von":"n.gate","nach":"f.gate"},{"von":"n.trig","nach":"f.trig"},{"von":"n.vel","nach":"f.vel"},{"von":"ki.aus","nach":"f.index"},{"von":"kr.aus","nach":"f.rueck"},{"von":"kz.aus","nach":"f.zeit"},{"von":"f.aus","nach":"o.x"}]}"#;

/// Granular: four voices recording a saw into the ring buffer, full pool (dichte 400 x 100 ms), every grain parameter
/// and the freeze on knobs, so starts, drops, seam clamps and the frozen path all run
const GRANULAR_1: &str = r#"{"format":"baukasten/2","name":"granular-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"g","art":"granular","quelle":1,"puffer":0.5,"groesse":100,"dichte":400,"streuung":0.5},{"id":"k1","art":"regler","nr":1,"min":0,"max":1},{"id":"k2","art":"regler","nr":2,"min":-24,"max":24},{"id":"k3","art":"regler","nr":3,"min":0,"max":1200},{"id":"k4","art":"regler","nr":4,"min":0,"max":1},{"id":"k5","art":"regler","nr":5,"min":1,"max":300},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"n.hz","nach":"g.hz"},{"von":"n.trig","nach":"g.trig"},{"von":"s.aus","nach":"g.x"},{"von":"k1.aus","nach":"g.pos"},{"von":"k1.aus","nach":"g.pos_zufall"},{"von":"k2.aus","nach":"g.tonhoehe"},{"von":"k3.aus","nach":"g.ton_zufall"},{"von":"k4.aus","nach":"g.frieren"},{"von":"k4.aus","nach":"g.fenster"},{"von":"k4.aus","nach":"g.breite"},{"von":"k5.aus","nach":"g.groesse"},{"von":"g.l","nach":"o.l"},{"von":"g.r","nach":"o.r"}]}"#;

/// String: four voices, hammer, piano soundboard; every input on a knob, so the loop design (pitch, decay, damping) runs
/// again while playing; noise on x
const SAITE_1: &str = r#"{"format":"baukasten/2","name":"saite-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saite","anreger":2,"koerper":3},{"id":"k1","art":"regler","nr":1,"min":0.05,"max":20,"log":1},{"id":"k2","art":"regler","nr":2,"min":0,"max":1},{"id":"k3","art":"regler","nr":3,"min":0,"max":1},{"id":"k4","art":"regler","nr":4,"min":0.02,"max":0.5},{"id":"k5","art":"regler","nr":5,"min":0,"max":1},{"id":"k6","art":"regler","nr":6,"min":0.5,"max":2},{"id":"t","art":"mul"},{"id":"r","art":"rauschen"},{"id":"rx","art":"mul","b":0.01},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"t.a"},{"von":"k6.aus","nach":"t.b"},{"von":"t.aus","nach":"s.hz"},{"von":"n.trig","nach":"s.trig"},{"von":"n.vel","nach":"s.vel"},{"von":"k1.aus","nach":"s.ausklang"},{"von":"k2.aus","nach":"s.daempfung"},{"von":"k3.aus","nach":"s.hell"},{"von":"k4.aus","nach":"s.lage"},{"von":"k5.aus","nach":"s.koerper_mix"},{"von":"r.aus","nach":"rx.a"},{"von":"rx.aus","nach":"s.x"},{"von":"s.aus","nach":"o.x"}]}"#;

/// Hard sync: four voices, saw, pulse and triangle slaves on one saw master, slave pitch and pwm on knobs, so resets fall
/// on every sub-sample position and the narrow pulse crosses its edge right after a reset
const HARTSYNC_1: &str = r#"{"format":"baukasten/2","name":"hartsync-1","stimmen":4,"knoten":[{"id":"n","art":"note"},{"id":"m","art":"saege"},{"id":"k","art":"regler","nr":1,"min":0,"max":36},{"id":"w","art":"regler","nr":2,"min":-1,"max":1},{"id":"t","art":"transponiere"},{"id":"f1","art":"saege"},{"id":"f2","art":"puls"},{"id":"f3","art":"dreieck"},{"id":"a","art":"add"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"m.hz"},{"von":"n.hz","nach":"t.hz"},{"von":"k.aus","nach":"t.st"},{"von":"t.aus","nach":"f1.hz"},{"von":"t.aus","nach":"f2.hz"},{"von":"t.aus","nach":"f3.hz"},{"von":"w.aus","nach":"f2.pwm"},{"von":"m.hart","nach":"f1.hart"},{"von":"m.hart","nach":"f2.hart"},{"von":"m.hart","nach":"f3.hart"},{"von":"f1.aus","nach":"a.a"},{"von":"f2.aus","nach":"a.b"},{"von":"f3.aus","nach":"a.c"},{"von":"a.aus","nach":"o.x"}]}"#;

const GRAPHEN: [&str; 63] = [
    include_str!("../beispiele/saege-ladder.json"),
    include_str!("../beispiele/juno-pad.json"),
    include_str!("../beispiele/lead.json"),
    CHORUS_1,
    CHORUS_3,
    HALL_1,
    include_str!("../beispiele/juno-pad-hall.json"),
    DELAY_1,
    include_str!("../beispiele/juno-pad-echo.json"),
    LIMITER_1,
    GATE_1,
    KOMP_1,
    include_str!("../beispiele/juno-pad-dyn.json"),
    LEITUNG_1,
    include_str!("../beispiele/saite.json"),
    include_str!("../beispiele/rueckkopplung.json"),
    include_str!("../beispiele/bassmusik.json"),
    KRUME_1,
    PHASER_1,
    include_str!("../beispiele/fx-phaser.json"),
    include_str!("../beispiele/fx-flanger.json"),
    include_str!("../beispiele/fx-lofi-sp1200.json"),
    include_str!("../beispiele/roehre-lead.json"),
    ROEHRE_FX,
    include_str!("../beispiele/gated-hall-snare.json"),
    include_str!("../beispiele/fx-takt-pump.json"),
    include_str!("../beispiele/fx-vocoder-robot.json"),
    SAMPLER_1,
    FALTUNG_1,
    include_str!("../beispiele/fx-federhall.json"),
    include_str!("../beispiele/fx-filter-fahrt.json"),
    WAVETABLE_1,
    include_str!("../beispiele/wavetable-supersaw.json"),
    include_str!("../beispiele/wavetable-reese.json"),
    include_str!("../beispiele/wavetable-chor.json"),
    RESONATOR_1,
    include_str!("../beispiele/resonator-glocke.json"),
    include_str!("../beispiele/resonator-marimba.json"),
    include_str!("../beispiele/resonator-conga.json"),
    include_str!("../beispiele/resonator-metall.json"),
    include_str!("../beispiele/fx-resonator.json"),
    METALL_1,
    include_str!("../beispiele/metall-hihat.json"),
    include_str!("../beispiele/metall-ride.json"),
    include_str!("../beispiele/metall-crash.json"),
    FM_1,
    include_str!("../beispiele/fm-bass.json"),
    include_str!("../beispiele/fm-epiano.json"),
    include_str!("../beispiele/fm-glocke.json"),
    include_str!("../beispiele/fm-lead.json"),
    GRANULAR_1,
    include_str!("../beispiele/granular-pad.json"),
    include_str!("../beispiele/granular-textur.json"),
    include_str!("../beispiele/granular-drone.json"),
    SAITE_1,
    include_str!("../beispiele/saite-gitarre.json"),
    include_str!("../beispiele/saite-harfe.json"),
    include_str!("../beispiele/saite-klavier.json"),
    include_str!("../beispiele/saite-karplus.json"),
    HARTSYNC_1,
    include_str!("../beispiele/hartsync-lead.json"),
    include_str!("../beispiele/hartsync-pad.json"),
    include_str!("../beispiele/hartsync-bass.json"),
];

#[test]
fn echtzeitpfad_allokiert_nicht() {
    let wurzel = std::env::temp_dir().join(format!("bk-s10-alloc-{}", std::process::id()));
    std::fs::create_dir_all(&wurzel).unwrap();
    std::fs::write(wurzel.join("probe.f32"), baukasten_dsp::proben::bytes(&baukasten_dsp::proben::orchester_schlag(48_000.0))).unwrap();
    // S21: a 4097 frame decaying-noise IR for FALTUNG_1 (deterministic xorshift, no random numbers)
    let mut z = 0x2545_f491u32;
    let ir: Vec<f32> = (0..2 * 4097).map(|i| {
        z ^= z << 13;
        z ^= z >> 17;
        z ^= z << 5;
        0.4 * ((z as f64 / u32::MAX as f64) * 2.0 - 1.0) as f32 * (-((i / 2) as f32) / 1000.0).exp()
    }).collect();
    std::fs::write(wurzel.join("ir.f32"), baukasten_dsp::proben::bytes(&ir)).unwrap();
    std::fs::write(wurzel.join("feder-ir.f32"), baukasten_dsp::proben::bytes(&baukasten_dsp::proben::feder_ir(48_000.0))).unwrap();
    for g in GRAPHEN {
        let vor = ANFORDERUNGEN.load(Ordering::SeqCst);
        let mut p = uebersetze_mit_wurzel(g, 48_000.0, Some(&wurzel)).unwrap();
        assert!(ANFORDERUNGEN.load(Ordering::SeqCst) > vor, "Positivkontrolle: uebersetze muss allokieren");
        let start = ANFORDERUNGEN.load(Ordering::SeqCst);
        let mut summe = 0.0f32;
        for i in 0..96_000u32 {
            if i % 4000 == 0 { p.note_an(36 + (i / 4000 % 24) as u8, 0.7); }
            if i % 6000 == 0 { p.note_aus(36 + (i / 6000 % 24) as u8); }
            if i % 256 == 0 { p.setze_regler(1 + (i / 256) as usize % 8, (i % 1000) as f32 / 1000.0); }
            if i % 50_000 == 0 { p.alle_aus(); }
            if i == 90_000 { p.zuruecksetzen(); }
            let (l, r) = p.sample_stereo();
            summe += l + r;
        }
        assert_eq!(ANFORDERUNGEN.load(Ordering::SeqCst), start, "Echtzeitpfad hat Speicher angefordert: {}", p.name);
        assert!(summe.is_finite());
    }
}
