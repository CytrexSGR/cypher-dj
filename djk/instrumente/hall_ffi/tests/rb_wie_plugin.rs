//! Die Parameterschicht der RB-FFI (rb_dsp::parameter) gegen das nih-plug-Plugin rb338: dieselben IDs in derselben
//! Reihenfolge, dieselbe Abbildung normiert → Wert (bitgleich), dieselben Vorgaben, dieselbe Glättung (bitgleich).
//! Die Schicht ist eine Abschrift aus rb338/src/lib.rs (das Plugin bleibt unverändert); dieser Test hält beide gleich.
//!
//! Dazu FFI-Ausgang gegen die process()-Logik des Plugins ohne Host, gleiche Noten: als Tor bitgleich für das vorhandene
//! Szenario (ffi_gleich_plugin_kette_im_szenario), als Messung mit Rohdaten `--ignored`. Gleich ist die Verbindung, der
//! VST3-Pfad unter Carla bleibt ungemessen.
use nih_plug::prelude::*;
use rb338::{Rb338, Rb338Params};
use rb_dsp::parameter::{self, Glaettung, Glaetter};

fn raster() -> Vec<f32> {
    let mut n: Vec<f32> = (0..=2000).map(|i| i as f32 / 2000.0).collect();
    n.extend([-0.5, -1e-7, 1e-7, 0.4999999, 0.5, 0.5000001, 1.0 - 1e-7, 1.0 + 1e-7, 1.5]);
    n
}

#[test]
fn ids_und_reihenfolge_wie_im_plugin() {
    let p = Rb338Params::default();
    let plugin: Vec<String> = p.param_map().into_iter().map(|(id, _, _)| id).collect();
    let ffi: Vec<String> = parameter::IDS.iter().map(|s| s.to_string()).collect();
    assert_eq!(ffi, plugin);
    let namen: Vec<String> = p.param_map().iter().map(|(_, ptr, _)| unsafe { ptr.name() }.to_string()).collect();
    let ffi_namen: Vec<String> = parameter::defs().iter().map(|d| d.name.to_string()).collect();
    assert_eq!(ffi_namen, namen);
}

#[test]
fn abbildung_und_vorgabe_bitgleich() {
    let p = Rb338Params::default();
    let defs = parameter::defs();
    for (nr, (id, ptr, _)) in p.param_map().into_iter().enumerate() {
        let d = &defs[nr];
        assert_eq!(d.id, id);
        let vorgabe = unsafe { ptr.default_plain_value() };
        assert_eq!(d.vorgabe.to_bits(), vorgabe.to_bits(), "{id}: Vorgabe {} statt {}", d.vorgabe, vorgabe);
        for n in raster() {
            let ffi = d.wert(n);
            let plug = if id == "wellenform" {
                if p.rechteck.preview_plain(n) { 1.0 } else { 0.0 }
            } else {
                unsafe { ptr.preview_plain(n) }
            };
            assert_eq!(ffi.to_bits(), plug.to_bits(), "{id} bei {n}: {ffi} statt {plug}");
        }
    }
    // Vorgabe-Lautstärke −12 dB (Spec 2.4)
    assert!((20.0 * defs[parameter::LAUTSTAERKE].vorgabe.log10() + 12.0).abs() < 1e-5);
}

fn plugin_glaetter<'a>(p: &'a Rb338Params, id: &str) -> Option<&'a Smoother<f32>> {
    match id {
        "lautstaerke" => Some(&p.lautstaerke.smoothed),
        "cutoff" => Some(&p.cutoff.smoothed),
        "resonanz" => Some(&p.resonanz.smoothed),
        "env_mod" => Some(&p.env_mod.smoothed),
        "decay" => Some(&p.decay.smoothed),
        "accent" => Some(&p.accent.smoothed),
        _ => None,
    }
}

#[test]
fn glaettung_bitgleich() {
    let p = Rb338Params::default();
    let defs = parameter::defs();
    let sr = 48000.0;
    for d in defs.iter() {
        let Some(s) = plugin_glaetter(&p, d.id) else {
            assert!(matches!(d.glaettung, Glaettung::Keine), "{}: Schalter ohne Glätter", d.id);
            continue;
        };
        match (&s.style, &d.glaettung) {
            (SmoothingStyle::None, Glaettung::Keine) => continue,
            (SmoothingStyle::Linear(a), Glaettung::Linear(b)) | (SmoothingStyle::Logarithmic(a), Glaettung::Log(b)) => {
                assert_eq!(a, b, "{}", d.id)
            }
            (a, b) => panic!("{}: Plugin {:?}, FFI {:?}", d.id, a, b),
        }
        // Folge: Start, Sprung, Sprung mitten im Lauf, Sprung auf denselben Wert
        let mut g = Glaetter::neu(d.glaettung);
        let (a, b, c) = (d.wert(0.2), d.wert(0.9), d.wert(0.05));
        s.reset(a);
        g.reset(a);
        for (ziel, schritte) in [(b, 2000), (c, 300), (b, 1500), (b, 10)] {
            s.set_target(sr, ziel);
            g.setze_ziel(sr, ziel);
            for i in 0..schritte {
                let (x, y) = (s.next(), g.naechster());
                assert_eq!(x.to_bits(), y.to_bits(), "{} Schritt {i} nach Ziel {ziel}: {y} statt {x}", d.id);
            }
        }
        // Raster von Start/Ziel-Paaren über die ganze Rampe: die Schrittweite (Log in f64 gerechnet) weicht nur bei
        // wenigen Paaren ab, wenn man sie anders rechnet (Mutationsprobe M5: 29 von 39 601), deshalb breit
        for i in 0..=60 {
            for j in 0..=60 {
                let (a, b) = (d.wert(i as f32 / 60.0), d.wert(j as f32 / 60.0));
                s.reset(a);
                g.reset(a);
                s.set_target(sr, b);
                g.setze_ziel(sr, b);
                for k in 0..962 {
                    let (x, y) = (s.next(), g.naechster());
                    assert_eq!(x.to_bits(), y.to_bits(), "{} {a} → {b} Schritt {k}: {y} statt {x}", d.id);
                }
            }
        }
    }
}

// ---------------------------------------------------------------- Messung (kein Tor)

struct Kontext {
    ev: std::collections::VecDeque<NoteEvent<()>>,
}

impl ProcessContext<Rb338> for Kontext {
    fn plugin_api(&self) -> PluginApi { PluginApi::Vst3 }
    fn execute_background(&self, _: ()) {}
    fn execute_gui(&self, _: ()) {}
    fn transport(&self) -> &Transport { unreachable!("rb338 fragt den Transport nicht") }
    fn next_event(&mut self) -> Option<NoteEvent<()>> { self.ev.pop_front() }
    fn send_event(&mut self, _: NoteEvent<()>) {}
    fn set_latency_samples(&self, _: u32) {}
    fn set_current_voice_capacity(&self, _: u32) {}
}

#[derive(Clone, Copy, Debug)]
enum Ev { An(u32, u8, u8), Aus(u32, u8), Param(&'static str, f32) }

/// Bassline über 64 Blöcke à 256: Slides, Akzente, Noten über Blockgrenzen, Parameterwechsel am Blockanfang.
fn szenario() -> Vec<(usize, Ev)> {
    let mut v = Vec::new();
    let mut t = 0u32;
    let tonfolge = [36u8, 36, 48, 39, 36, 43, 41, 36, 48, 46, 36, 34];
    for (i, &ton) in tonfolge.iter().cycle().take(40).enumerate() {
        let start = t;
        let dauer = if i % 4 == 2 { 2600 } else { 1500 }; // jede vierte überlappt die nächste: Slide
        let vel = if i % 3 == 0 { 127 } else { 100 };
        v.push(((start / 256) as usize, Ev::An(start % 256, ton, vel)));
        let ende = start + dauer;
        v.push(((ende / 256) as usize, Ev::Aus(ende % 256, ton)));
        t += 1800 + (i as u32 % 5) * 37;
    }
    for (b, id, w) in [(10, "cutoff", 0.7f32), (20, "resonanz", 0.85), (25, "env_mod", 0.2), (30, "lautstaerke", 0.95),
                       (40, "cutoff", 0.15), (50, "lautstaerke", 0.6)] {
        v.push((b, Ev::Param(id, w)));
    }
    v
}

fn ffi_lauf(sz: &[(usize, Ev)], bloecke: usize) -> Vec<f32> {
    use hall_ffi::*;
    let h = cypher_rb_neu(48000.0);
    let mut aus = Vec::new();
    let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
    for b in 0..bloecke {
        for (_, e) in sz.iter().filter(|(bb, _)| *bb == b) {
            unsafe {
                match *e {
                    Ev::An(t, ton, vel) => { cypher_rb_note_an(h, t, ton, vel); }
                    Ev::Aus(t, ton) => { cypher_rb_note_aus(h, t, ton); }
                    Ev::Param(id, w) => {
                        let c = std::ffi::CString::new(id).unwrap();
                        assert_eq!(cypher_rb_setze(h, c.as_ptr(), w), 0);
                    }
                }
            }
        }
        unsafe { cypher_rb_block(h, l.as_mut_ptr(), r.as_mut_ptr(), 256) };
        aus.extend_from_slice(&l);
    }
    unsafe { cypher_rb_frei(h) };
    aus
}

/// Das Plugin wie unter einem Wirt: Glätter beim Aktivieren auf den Wert (update_smoother(reset)), Parameterwechsel als
/// set_target am Blockanfang (das tut der VST3-Wrapper bei einer Änderung), Noten mit Versatz und Velocity/127 (Carla).
/// Grenze: decay, accent und wellenform setzt der Wrapper über ParamMut (crate-intern); hier bleiben sie auf der Vorgabe.
fn plugin_lauf(sz: &[(usize, Ev)], bloecke: usize) -> Vec<f32> {
    let mut plug = Rb338::default();
    let params = plug.params();
    // SAFETY: params() gibt die Arc<Rb338Params> des Plugins als Arc<dyn Params> heraus; der Datenzeiger ist Rb338Params.
    let p: &Rb338Params = unsafe { &*(std::sync::Arc::as_ptr(&params) as *const Rb338Params) };
    p.lautstaerke.smoothed.reset(p.lautstaerke.value());
    p.cutoff.smoothed.reset(p.cutoff.value());
    p.resonanz.smoothed.reset(p.resonanz.value());
    p.env_mod.smoothed.reset(p.env_mod.value());
    plug.reset();
    let defs = parameter::defs();
    let mut aus = Vec::new();
    let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
    for b in 0..bloecke {
        let mut ctx = Kontext { ev: Default::default() };
        let mut noten: Vec<(u32, NoteEvent<()>)> = Vec::new();
        for (_, e) in sz.iter().filter(|(bb, _)| *bb == b) {
            match *e {
                Ev::An(t, note, vel) => noten.push((t, NoteEvent::NoteOn { timing: t, voice_id: None, channel: 0, note, velocity: vel as f32 / 127.0 })),
                Ev::Aus(t, note) => noten.push((t, NoteEvent::NoteOff { timing: t, voice_id: None, channel: 0, note, velocity: 0.0 })),
                Ev::Param(id, w) => {
                    let nr = parameter::IDS.iter().position(|i| *i == id).unwrap();
                    let wert = defs[nr].wert(w);
                    let s = plugin_glaetter(p, id).unwrap();
                    s.set_target(48000.0, wert);
                }
            }
        }
        noten.sort_by_key(|(t, _)| *t); // der Wirt liefert nach Zeit sortiert
        ctx.ev.extend(noten.into_iter().map(|(_, e)| e));
        let mut buf = Buffer::default();
        unsafe {
            buf.set_slices(256, |s| {
                s.clear();
                s.push(std::slice::from_raw_parts_mut(l.as_mut_ptr(), 256));
                s.push(std::slice::from_raw_parts_mut(r.as_mut_ptr(), 256));
            });
        }
        let mut aux = AuxiliaryBuffers { inputs: &mut [], outputs: &mut [] };
        plug.process(&mut buf, &mut aux, &mut ctx);
        drop(buf);
        aus.extend_from_slice(&l);
    }
    aus
}

/// Tor für das vorhandene Szenario (Review K2a): FFI und die process()-Logik des Plugins ohne Host bitgleich. Belegt die
/// Verbindung von Ereignis-Timing, Notenlogik und Glätter-Ablauf, NICHT den VST3-Pfad unter Carla (SAMPLE_ACCURATE_AUTOMATION,
/// Velocity des Wirts). Dokumentierte Grenze: decay, accent und wellenform variiert das Szenario nicht (siehe plugin_lauf).
#[test]
fn ffi_gleich_plugin_kette_im_szenario() {
    let bloecke = 64 * 4;
    let sz = szenario();
    let (a, b) = (ffi_lauf(&sz, bloecke), plugin_lauf(&sz, bloecke));
    assert!(a.iter().any(|v| v.abs() > 0.01), "Positivkontrolle: das Szenario klingt");
    let ungleich = a.iter().zip(&b).filter(|(x, y)| x.to_bits() != y.to_bits()).count();
    assert_eq!(ungleich, 0, "FFI und Plugin-Kette weichen in {ungleich} Samples ab");
    // Gegenprobe: eine Note einen Sample später, das Tor sieht es
    let mut verschoben = sz.clone();
    if let Some((_, e)) = verschoben.iter_mut().filter(|(_, e)| matches!(e, Ev::An(..))).nth(4) {
        if let Ev::An(t, n, v) = *e { *e = Ev::An(t + 1, n, v); }
    }
    let c = ffi_lauf(&verschoben, bloecke);
    assert!(c.iter().zip(&b).any(|(x, y)| x.to_bits() != y.to_bits()), "Gegenprobe: das Tor ist blind");
}

#[test]
#[ignore = "Messung, kein Tor: cargo test -p hall_ffi --release --test rb_wie_plugin -- --ignored --nocapture"]
fn messung_ffi_gegen_plugin() {
    let bloecke = 64 * 4;
    let sz = szenario();
    let (a, b) = (ffi_lauf(&sz, bloecke), plugin_lauf(&sz, bloecke));
    let spitze = a.iter().fold(0f32, |m, v| m.max(v.abs()));
    let diff: Vec<f32> = a.iter().zip(&b).map(|(x, y)| x - y).collect();
    let max_diff = diff.iter().fold(0f32, |m, v| m.max(v.abs()));
    let ungleich = a.iter().zip(&b).filter(|(x, y)| x.to_bits() != y.to_bits()).count();
    let db = |x: f32| if x > 0.0 { format!("{:.1} dBFS", 20.0 * x.log10()) } else { "-inf dBFS".into() };
    println!("Samples {}, Spitze FFI {}, Spitze Plugin {}", a.len(), db(spitze), db(b.iter().fold(0f32, |m, v| m.max(v.abs()))));
    println!("Differenz max {} ({}), ungleiche Samples (Bits) {}", max_diff, db(max_diff), ungleich);
    if let Ok(ordner) = std::env::var("RB_MESS_ORDNER") {
        let schreibe = |name: &str, x: &[f32]| {
            let bytes: Vec<u8> = x.iter().flat_map(|v| v.to_le_bytes()).collect();
            std::fs::write(format!("{ordner}/{name}"), bytes).unwrap();
        };
        schreibe("ffi.f32", &a);
        schreibe("plugin.f32", &b);
        schreibe("differenz.f32", &diff);
        let mut z = String::from("block;art;versatz;ton_oder_id;vel_oder_wert\n");
        for (bl, e) in &sz {
            z += &match e {
                Ev::An(t, n, v) => format!("{bl};an;{t};{n};{v}\n"),
                Ev::Aus(t, n) => format!("{bl};aus;{t};{n};\n"),
                Ev::Param(id, w) => format!("{bl};param;0;{id};{w}\n"),
            };
        }
        std::fs::write(format!("{ordner}/szenario.csv"), z).unwrap();
        println!("Rohdaten (f32 LE mono, 48 kHz) in {ordner}");
    }
    assert!(spitze > 0.01, "Positivkontrolle: das Szenario klingt");
    // Gegenprobe: die fünfte Note im FFI-Lauf ein Sample später; die Messung muss das sehen
    let mut verschoben = sz.clone();
    let mut gesehen = 0;
    for (_, e) in verschoben.iter_mut() {
        if let Ev::An(t, n, v) = *e {
            gesehen += 1;
            if gesehen == 5 { *e = Ev::An(t + 1, n, v); }
        }
    }
    let c = ffi_lauf(&verschoben, bloecke);
    let max_c = c.iter().zip(&b).fold(0f32, |m, (x, y)| m.max((x - y).abs()));
    println!("Gegenprobe (5. Note +1 Sample): Differenz max {} ({})", max_c, db(max_c));
    assert!(max_c > 0.0, "Gegenprobe: die Messung ist blind");
}
