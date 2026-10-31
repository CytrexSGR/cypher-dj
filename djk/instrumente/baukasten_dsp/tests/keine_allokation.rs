//! Echtzeit-Gegenprobe: sample, note_an, note_aus, alle_aus, setze_regler und zuruecksetzen fordern keinen Speicher an,
//! für jeden Beispielgraphen;
//! uebersetze schon (Positivkontrolle, sonst wäre der Zähler blind). Muster: hall_ffi/tests/rb_keine_allokation.rs.
use baukasten_dsp::uebersetze;
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
const GRAPHEN: [&str; 17] = [
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
];

#[test]
fn echtzeitpfad_allokiert_nicht() {
    for g in GRAPHEN {
        let vor = ANFORDERUNGEN.load(Ordering::SeqCst);
        let mut p = uebersetze(g, 48_000.0).unwrap();
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
