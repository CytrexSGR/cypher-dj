//! Zero-amount shortcuts: steps whose contribution is exactly 0 while an amount is exactly 0 do not compute.
//!
//! A knob that scales a modulation or an effect ("chaos to position", chorus amount) leaves the block behind it running at
//! full price while the knob stands at 0 and the block adds nothing. This module and the blocks themselves skip that work
//! where it can be done without changing a single output bit, and say below, per block, where it cannot.
//!
//! Decision per block (which blocks skip, which keep running, and why):
//!
//!  * `chorus` (chorus.rs): skips at `mix` exactly 0. Output at mix 0 is `x + 0 * wet` = `x` bit for bit, so the two reads and the
//!    two low-passes need not run. State: the line is still written and the triangle still advances (two cheap operations), so
//!    both stand exactly where the always-running chorus has them. Only the low-pass states lag; they are replayed over the last
//!    64 samples of the dry stretch when mix leaves 0, which is enough for an exact catch-up (the poles forget in a few
//!    samples). So going from 0 to above 0 starts from the same wet signal the full chorus would give: no click, no stale echo.
//!  * `chaos` (chaos.rs): skips while every `mul` that reads it has its other factor exactly 0 (`Chaos::betrag`, found here at
//!    translation). The product is 0 whatever the attractor does. State: the attractor stands still while skipped and continues
//!    from where it stopped (its output is continuous, so mix-in from 0 cannot click, and there is no phase to keep in step: a
//!    chaos LFO has no fixed position in time, the seed only fixes where it starts). Note edges are still handled while it
//!    stands still (`Chaos::nur_trigger`). Consequence, stated plainly: after a stretch at amount 0 the curve is a later part of
//!    the same trajectory than the always-running engine would have, so a render that moves the amount from 0 to above 0 in the
//!    middle is not bit-identical to the old engine from that moment on; a render whose amount never is 0, or never is above
//!    0, is.
//!  * `hall`, `delay`: NOT skipped. At mix 0 the output is the dry signal, but the tank keeps filling from the input, so a
//!    skipped tank would come back empty (or with an old tail) when the mix opens, which one hears; skipping only after the tail
//!    has died away would need a silence test that is never true while a note plays. The cost of these two in a patch is not
//!    in their mix knob anyway.
//!  * `adsr`: NOT skipped. The stage (attack, decay, sustain, release) depends on the gate history; a frozen envelope would be in
//!    the wrong stage when it resumes, and its cost per sample is a few operations.
//!  * `wavetable`: already takes the plain read when `pm` and `warp` are 0 (wavetable.rs); `stapel` 0 is the plain copy table.
//!  * `drift`, `glatt`, `sh`, `schieber`: NOT skipped. They have no amount input, only a consumer's `mul` could gate them, and
//!    their state is either a held random value on a clock, a glide target or an all-pass memory that must keep running; the
//!    saving is a handful of operations per voice. (`chaos` is the one block here whose per-sample cost is an integrator.)
//!  * sub oscillator and phase-modulation oscillator: already inside the branch of a `wahl` that selects the constant 0 at
//!    amount 0 (zweige.rs): skipped, with the oscillator advancing its phase only.
//!
//! The guard of `chaos` is found on the step list before `zerlege` runs, so the branch analysis sees the final order.

use crate::programm::{Quelle, Schritt};
use crate::zweige::{ausgaenge, eingaenge};
use std::collections::BTreeMap;

/// Finds, for every `chaos` step whose outputs are read only by `mul` steps, the factors that must all be 0 for the
/// product to be 0, and writes them into the step (`betrag`). A factor made by a step that comes later in the list is
/// only usable when that step has no inputs (`regler`, `konst`): it is moved in front of the `chaos` (it reads the knob and
/// nothing else, so its place does not matter); any other later factor leaves the `chaos` unguarded.
pub fn vorbereiten(mut schritte: Vec<Schritt>) -> Vec<Schritt> {
    let ein: Vec<Vec<Quelle>> = schritte.iter().map(eingaenge).collect();
    let aus: Vec<Vec<usize>> = schritte.iter().map(ausgaenge).collect();
    let mut erzeuger: BTreeMap<usize, usize> = BTreeMap::new();
    for (i, a) in aus.iter().enumerate() {
        for s in a {
            erzeuger.insert(*s, i);
        }
    }
    // chaos step -> (factors, steps to move in front of it)
    let mut plan: BTreeMap<usize, (Vec<Quelle>, Vec<usize>)> = BTreeMap::new();
    let mut verschoben: Vec<usize> = Vec::new();
    for (i, st) in schritte.iter().enumerate() {
        let Schritt::Chaos { aus: a1, aus2: a2, .. } = st else { continue };
        let (mut faktoren, mut holen) = (Vec::<Quelle>::new(), Vec::<usize>::new());
        let mut ok = true;
        'verbraucher: for (c, qs) in ein.iter().enumerate() {
            let liest = |q: &Quelle| matches!(q, Quelle::Slot(s) | Quelle::Vorher(s) if s == a1 || s == a2);
            if !qs.iter().any(liest) {
                continue;
            }
            // anything but a `mul` reading it through a same-sample edge: not an amount
            let Schritt::Mul { a, b, .. } = &schritte[c] else { ok = false; break };
            let (la, lb) = (liest(a), liest(b));
            let faktor = match (la, lb) {
                (true, false) => *b,
                (false, true) => *a,
                _ => { ok = false; break }
            };
            let chaos_seite = if la { a } else { b };
            if matches!(chaos_seite, Quelle::Vorher(_)) {
                ok = false;
                break;
            }
            match faktor {
                Quelle::Fest(_) | Quelle::Vorher(_) => {}
                Quelle::Slot(s) => match erzeuger.get(&s) {
                    Some(&p) if p < i => {}
                    Some(&p) if matches!(schritte[p], Schritt::Regler { .. } | Schritt::Konst { .. }) && !verschoben.contains(&p) => holen.push(p),
                    _ => { ok = false; break 'verbraucher }
                },
            }
            if !faktoren.contains(&faktor) {
                faktoren.push(faktor);
            }
        }
        if ok && !faktoren.is_empty() {
            verschoben.extend(holen.iter().copied());
            plan.insert(i, (faktoren, holen));
        }
    }
    if plan.is_empty() {
        return schritte;
    }
    for (&i, (faktoren, _)) in &plan {
        if let Schritt::Chaos { betrag, .. } = &mut schritte[i] {
            *betrag = faktoren.clone().into_boxed_slice();
        }
    }
    // the moves: a producer goes in front of the first chaos that needs it, the others keep their order
    let mut vor: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (&i, (_, holen)) in &plan {
        vor.insert(i, holen.clone());
    }
    let mut teile: Vec<Option<Schritt>> = schritte.into_iter().map(Some).collect();
    let mut neu: Vec<Schritt> = Vec::with_capacity(teile.len());
    for i in 0..teile.len() {
        if let Some(holen) = vor.get(&i) {
            for &p in holen {
                if let Some(st) = teile[p].take() {
                    neu.push(st);
                }
            }
        }
        if let Some(st) = teile[i].take() {
            neu.push(st);
        }
    }
    neu
}

#[cfg(test)]
mod tests {
    use crate::programm::Schritt;
    use crate::uebersetzen::uebersetze;

    fn graph(chaos_nach: &str, faktor_knoten: &str) -> String {
        format!(
            r#"{{"format":"baukasten/2","name":"nu","stimmen":2,"knoten":[{{"id":"n","art":"note"}},{{"id":"c","art":"chaos","saat":3}},{faktor_knoten},{{"id":"m","art":"mul"}},{{"id":"s","art":"saege"}},{{"id":"a","art":"add"}},{{"id":"o","art":"ausgang"}}],
"kanten":[{{"von":"n.hz","nach":"s.hz"}},{{"von":"c.aus","nach":"{chaos_nach}"}},{{"von":"k.aus","nach":"m.b"}},{{"von":"s.aus","nach":"a.a"}},{{"von":"m.aus","nach":"a.b"}},{{"von":"a.aus","nach":"o.x"}}]}}"#
        )
    }

    fn betraege(p: &crate::Programm) -> Vec<usize> {
        p.schritte_fuer_test().iter().filter_map(|s| if let Schritt::Chaos { betrag, .. } = s { Some(betrag.len()) } else { None }).collect()
    }

    const KNOPF: &str = r#"{"id":"k","art":"regler","nr":1,"min":-1,"max":1,"mitte":0}"#;

    #[test]
    fn chaos_hinter_einem_mul_bekommt_den_betrag_als_wache() {
        let p = uebersetze(&graph("m.a", KNOPF), 48_000.0).unwrap();
        assert_eq!(betraege(&p), vec![1]);
    }

    #[test]
    fn regler_hinter_dem_chaos_wird_davor_gestellt() {
        // the knob node is listed after the chaos and made by a step that sits after it: it moves in front
        let p = uebersetze(&graph("m.a", KNOPF), 48_000.0).unwrap();
        let reihenfolge: Vec<&str> = p.schritte_fuer_test().iter().filter_map(|s| match s {
            Schritt::Chaos { .. } => Some("chaos"),
            Schritt::Regler { .. } => Some("regler"),
            _ => None,
        }).collect();
        assert_eq!(reihenfolge, vec!["regler", "chaos"]);
    }

    #[test]
    fn chaos_das_ein_add_liest_bleibt_ohne_wache() {
        let p = uebersetze(&graph("a.c", KNOPF), 48_000.0).unwrap();
        assert_eq!(betraege(&p), vec![0], "an add is not an amount");
    }

    #[test]
    fn chaos_das_ein_mul_und_ein_add_lesen_bleibt_ohne_wache() {
        let g = graph("m.a", KNOPF).replace(r#"{"von":"a.aus","nach":"o.x"}"#, r#"{"von":"c.aus2","nach":"a.c"},{"von":"a.aus","nach":"o.x"}"#);
        let p = uebersetze(&g, 48_000.0).unwrap();
        assert_eq!(betraege(&p), vec![0]);
    }

    #[test]
    fn faktor_aus_einem_spaeteren_rechenschritt_bleibt_ohne_wache() {
        // the factor is made by a `mul` that depends on a later step: it cannot be moved and is not current at the chaos
        let g = r#"{"format":"baukasten/2","name":"nu","stimmen":1,"knoten":[{"id":"n","art":"note"},{"id":"c","art":"chaos","saat":3},{"id":"k","art":"regler","nr":1,"min":0,"max":1},{"id":"k2","art":"mul","b":0.5},{"id":"m","art":"mul"},{"id":"o","art":"ausgang"}],
"kanten":[{"von":"c.aus","nach":"m.a"},{"von":"k.aus","nach":"k2.a"},{"von":"k2.aus","nach":"m.b"},{"von":"m.aus","nach":"o.x"}]}"#;
        let p = uebersetze(g, 48_000.0).unwrap();
        // k2 is listed after c in the node order, so it is either earlier in the step order (guarded) or not; both are right as
        // long as a guard is never put on a factor that is not current
        let n = betraege(&p)[0];
        let reihenfolge: Vec<&str> = p.schritte_fuer_test().iter().filter_map(|s| match s {
            Schritt::Chaos { .. } => Some("chaos"),
            Schritt::Mul { .. } => Some("mul"),
            _ => None,
        }).collect();
        if n == 1 {
            assert_eq!(reihenfolge.first(), Some(&"mul"), "a guarded chaos has its factor made before it");
        }
    }
}
