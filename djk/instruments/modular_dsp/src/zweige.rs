//! Branch skipping for the selector `wahl` (type 38, switch mode).
//!
//! A `wahl` computes nothing itself: its candidates `e1`..`en` are computed by steps of the graph, in every sample, whether
//! they are heard or not. Most of the cost of the big synth graphs sits in candidates nobody hears (seven filters behind one
//! type knob, five LFO shapes behind one shape knob).
//!
//! At translation (`zerlege`) every switch `wahl` gets, per candidate, its EXCLUSIVE BRANCH: the steps whose outputs reach
//! nothing but that candidate (directly or through other steps of the same branch; an edge with a delay counts like any other
//! edge). A step that also feeds another consumer stays where it is and runs always. The branch steps move to just before
//! their `wahl`, and the `wahl` splits in two:
//!
//! ```text
//!   WahlVor      moves position and weights on, notes which candidates the output reads in this sample
//!   Zweig k=0    jumps over the branch of candidate 0 when no voice reads it
//!     ...steps of branch 0...
//!   Zweig k=1
//!     ...steps of branch 1...
//!   WahlMisch    the output from the weights
//! ```
//!
//! A candidate is read while a voice has it selected, or while a fade still gives it weight. Every other candidate has weight
//! exactly 0, so its (stale) value does not reach the output. When a branch has been off and is read again, its steps and
//! their slots are reset first (`Schritt::zuruecksetzen`) and it runs from the start of the crossfade. The oscillators of a
//! skipped branch are the exception: they advance their phase only (`Wirkung::Phase`) and are never reset.
//!
//! What this changes, exactly:
//!  * Nothing at all, bit for bit, as long as no `wahl` changes its position: the selected branch runs in every sample
//!    from the first one and is never reset. The steps keep their relative order, and only steps whose output nobody else
//!    reads move, so no value any other step sees changes (`tests/zweige.rs` pins this for every example graph).
//!  * When a `wahl` switches to a candidate whose branch was off, that branch starts from reset state instead of from the
//!    state it would have reached by running unheard. How far this reaches depends on the kinds of step in the branch
//!    (`Wirkung`): none for stateless steps, a decaying start-up transient for filters and shapers, and none for oscillators,
//!    noise and LFOs: those run their phase (saw, pulse, triangle, sine incl. sync and hard sync; the noise stream; the LFO's
//!    phase and random value) in every skipped sample with the same inputs and arithmetic, so they stand exactly where the
//!    reference has them and the output is bit-identical (`tests/zweige.rs`). That holds only when the oscillator's inputs come
//!    from steps that always run: an oscillator with an input made inside a branch (a transposer of its own, a master that sat
//!    in the branch), or whose output a delayed edge reads, is kept out of every branch (`fest_stehende`) and runs always.
//!    Kinds whose state is not forgotten or not a mere phase (envelopes, delays, reverbs, sample
//!    players, ...) never enter a branch: they stay on the always-running path.
//!  * `Programm::setze_zweige(false)` runs everything every sample, as before; the tests use it as the reference.
use crate::programm::{Quelle, Schritt};
use std::collections::{BTreeMap, BTreeSet};

/// What a reset of a step changes once the branch it sits in is read again.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Wirkung {
    /// no state: the output is a pure function of the inputs, a reset changes nothing
    Exakt,
    /// the state is forgotten: filters, shapers, followers. A reset leaves a start-up transient that decays with the step's
    /// own time constant (it is the difference between the filter that ran unheard and one that starts cold)
    Vergessend,
    /// the state is a free-running phase or a noise stream: while the branch is skipped only that moves (`phase_weiter` in
    /// programm.rs), and a re-entry does not reset it, so the step is exactly where the reference has it
    Phase,
}

/// The branch rule for a kind of step: `None` = never inside a branch. No placeholder arm: a new kind must be decided here.
pub fn wirkung(s: &Schritt) -> Option<Wirkung> {
    use Wirkung::*;
    match s {
        Schritt::Konst { .. } | Schritt::Regler { .. } | Schritt::Transponiere { .. } | Schritt::Mul { .. } | Schritt::Add { .. } => Some(Exakt),
        Schritt::Ladder { .. } | Schritt::Svf { .. } | Schritt::Sem { .. } | Schritt::Diode { .. } | Schritt::Ms20 { .. }
        | Schritt::Saett { .. } | Schritt::Krume { .. } | Schritt::Roehre { .. } | Schritt::Falter { .. } | Schritt::Formant { .. }
        | Schritt::Kamm { .. } | Schritt::Folger { .. } | Schritt::Leitung { .. } | Schritt::Wahl { .. } => Some(Vergessend),
        Schritt::Saege { .. } | Schritt::Puls { .. } | Schritt::Dreieck { .. } | Schritt::Sinus { .. } | Schritt::Lfo { .. }
        | Schritt::Rauschen { .. } => Some(Phase),
        // envelopes and follow-ups of a note: a reset while the gate is held would silence them for the rest of the note
        Schritt::Adsr { .. } | Schritt::Mseg { .. } | Schritt::Fm { .. }
        // random or held values that outlive a fade, a glide that would start from 0 Hz
        | Schritt::Sh { .. } | Schritt::Drift { .. } | Schritt::Glatt { .. }
        // tails and recorded material
        | Schritt::Chorus { .. } | Schritt::Hall { .. } | Schritt::Delay { .. } | Schritt::Limiter { .. } | Schritt::Gate { .. }
        | Schritt::Labor { .. } | Schritt::Remix { .. } | Schritt::Komp { .. } | Schritt::Phaser { .. } | Schritt::Vocoder { .. } | Schritt::Faltung { .. } | Schritt::Granular { .. }
        // triggered voices
        | Schritt::Sampler { .. } | Schritt::Wavetable { .. } | Schritt::Resonator { .. } | Schritt::Metall { .. }
        | Schritt::Saite { .. } | Schritt::Trommeln { .. }
        // sources and sinks of the graph itself
        | Schritt::Note { .. } | Schritt::Eingang { .. } | Schritt::Ausgang { .. } => None,
        // made by this module, not present when it analyses
        Schritt::WahlVor { .. } | Schritt::Zweig { .. } | Schritt::WahlMisch { .. } => None,
    }
}

/// Every input of a step, in a fixed order. For `Wahl` the candidates `e1`..`e8` come first, the selector is entry 8.
pub fn eingaenge(s: &Schritt) -> Vec<Quelle> {
    fn mit(mut v: Vec<Quelle>, h: &Option<Quelle>) -> Vec<Quelle> {
        v.extend(h.iter().copied());
        v
    }
    match s {
        Schritt::Note { .. } | Schritt::Konst { .. } | Schritt::Regler { .. } | Schritt::Rauschen { .. } | Schritt::Eingang { .. } => vec![],
        Schritt::Saege { hz, sync, hart, .. } | Schritt::Dreieck { hz, sync, hart, .. } => mit(vec![*hz, *sync], hart),
        Schritt::Puls { hz, pwm, sync, hart, .. } => mit(vec![*hz, *pwm, *sync], hart),
        Schritt::Sinus { hz, fm, sync, .. } => vec![*hz, *fm, *sync],
        Schritt::Lfo { rate, trig, .. } => vec![*rate, *trig],
        Schritt::Sh { x, trig, rate, glatt, .. } => vec![*x, *trig, *rate, *glatt],
        Schritt::Mseg { gate, trig, .. } => vec![*gate, *trig],
        Schritt::Folger { x, an, ab, .. } => vec![*x, *an, *ab],
        Schritt::Transponiere { hz, st, cent, .. } => vec![*hz, *st, *cent],
        Schritt::Ladder { x, cutoff, reso, .. } | Schritt::Svf { x, cutoff, reso, .. } => vec![*x, *cutoff, *reso],
        Schritt::Sem { x, cutoff, reso, form, .. } => vec![*x, *cutoff, *reso, *form],
        Schritt::Saett { x, antrieb, .. } => vec![*x, *antrieb],
        Schritt::Glatt { x, setzen, .. } => vec![*x, *setzen],
        Schritt::Leitung { x, zeit, hz, .. } => vec![*x, *zeit, *hz],
        Schritt::Adsr { gate, trig, zeiten, .. } => { let mut v = vec![*gate, *trig]; v.extend(zeiten.iter().copied()); v }
        Schritt::Mul { a, b, .. } => vec![*a, *b],
        Schritt::Add { a, b, c, d, .. } => vec![*a, *b, *c, *d],
        Schritt::Wahl { ein, wahl, .. } => { let mut v = ein.to_vec(); v.push(*wahl); v }
        Schritt::WahlVor { wahl, .. } => vec![*wahl],
        Schritt::Zweig { .. } => vec![],
        Schritt::WahlMisch { ein, .. } => ein.to_vec(),
        Schritt::Chorus { x, mix, .. } => vec![*x, *mix],
        Schritt::Hall { x, l, r, mix, .. } => vec![*x, *l, *r, *mix],
        Schritt::Labor { x, l, r, st, .. } => [*x, *l, *r].into_iter().chain(st.iter().copied()).collect(),
        Schritt::Remix { x, l, r, st, .. } => [*x, *l, *r].into_iter().chain(st.iter().copied()).collect(),
        Schritt::Delay { x, l, r, zeit, fb, mix, .. } => vec![*x, *l, *r, *zeit, *fb, *mix],
        Schritt::Limiter { x, l, r, .. } | Schritt::Ausgang { x, l, r } => vec![*x, *l, *r],
        Schritt::Gate { x, l, r, kl, kr, .. } | Schritt::Komp { x, l, r, kl, kr, .. } => vec![*x, *l, *r, *kl, *kr],
        Schritt::Krume { x, bits, rate, .. } => vec![*x, *bits, *rate],
        Schritt::Phaser { x, l, r, rate, tiefe, fb, mix, .. } => vec![*x, *l, *r, *rate, *tiefe, *fb, *mix],
        Schritt::Roehre { x, antrieb, bias, .. } => vec![*x, *antrieb, *bias],
        Schritt::Sampler { hz, trig, gate, scheibe, rueck, .. } => vec![*hz, *trig, *gate, *scheibe, *rueck],
        Schritt::Vocoder { x, l, r, zisch, mix, .. } => vec![*x, *l, *r, *zisch, *mix],
        Schritt::Faltung { x, l, r, mix, .. } => vec![*x, *l, *r, *mix],
        Schritt::Wavetable { hz, trig, pos, verstimmung, breite, .. } => vec![*hz, *trig, *pos, *verstimmung, *breite],
        Schritt::Resonator { ein, .. } => ein.to_vec(),
        Schritt::Metall { ein, .. } => ein.to_vec(),
        Schritt::Fm { hz, gate, trig, vel, index, rueck, zeit, .. } => vec![*hz, *gate, *trig, *vel, *index, *rueck, *zeit],
        Schritt::Granular { hz, trig, gate, x, groesse, dichte, pos, pos_zufall, tonhoehe, ton_zufall, breite, fenster, frieren, .. } => {
            vec![*hz, *trig, *gate, *x, *groesse, *dichte, *pos, *pos_zufall, *tonhoehe, *ton_zufall, *breite, *fenster, *frieren]
        }
        Schritt::Saite { x, hz, trig, vel, ausklang, daempfung, hell, lage, koerper_mix, .. } => vec![*x, *hz, *trig, *vel, *ausklang, *daempfung, *hell, *lage, *koerper_mix],
        Schritt::Kamm { x, hz, fb, daempf, mix, .. } => vec![*x, *hz, *fb, *daempf, *mix],
        Schritt::Formant { x, vokal, versatz, q, mix, .. } => vec![*x, *vokal, *versatz, *q, *mix],
        Schritt::Ms20 { x, cutoff, reso, antrieb, .. } => vec![*x, *cutoff, *reso, *antrieb],
        Schritt::Diode { x, cutoff, reso, antrieb, bass, .. } => vec![*x, *cutoff, *reso, *antrieb, *bass],
        Schritt::Trommeln { ein, .. } => ein.to_vec(),
        Schritt::Falter { x, antrieb, symmetrie, form, .. } => vec![*x, *antrieb, *symmetrie, *form],
        Schritt::Drift { rate, fest, .. } => vec![*rate, *fest],
    }
}

/// Every output slot of a step.
pub fn ausgaenge(s: &Schritt) -> Vec<usize> {
    match s {
        Schritt::Note { hz, gate, vel, trig, erste } => vec![*hz, *gate, *vel, *trig, *erste],
        Schritt::Konst { aus, .. } | Schritt::Regler { aus, .. } | Schritt::Rauschen { aus, .. } | Schritt::Lfo { aus, .. }
        | Schritt::Sh { aus, .. } | Schritt::Mseg { aus, .. } | Schritt::Folger { aus, .. } | Schritt::Transponiere { aus, .. }
        | Schritt::Ladder { aus, .. } | Schritt::Saett { aus, .. } | Schritt::Glatt { aus, .. } | Schritt::Leitung { aus, .. }
        | Schritt::Adsr { aus, .. } | Schritt::Mul { aus, .. } | Schritt::Add { aus, .. } | Schritt::Wahl { aus, .. }
        | Schritt::WahlMisch { aus, .. } | Schritt::Krume { aus, .. } | Schritt::Roehre { aus, .. } | Schritt::Resonator { aus, .. }
        | Schritt::Fm { aus, .. } | Schritt::Saite { aus, .. } | Schritt::Kamm { aus, .. } | Schritt::Formant { aus, .. }
        | Schritt::Diode { aus, .. } | Schritt::Trommeln { aus, .. } | Schritt::Falter { aus, .. } | Schritt::Drift { aus, .. } => vec![*aus],
        Schritt::Saege { aus, zyklus, hart_aus, .. } | Schritt::Puls { aus, zyklus, hart_aus, .. }
        | Schritt::Dreieck { aus, zyklus, hart_aus, .. } | Schritt::Sinus { aus, zyklus, hart_aus, .. } => vec![*aus, *zyklus, *hart_aus],
        Schritt::Svf { tp, bp, hp, .. } => vec![*tp, *bp, *hp],
        Schritt::Sem { aus, bp, .. } => vec![*aus, *bp],
        Schritt::Chorus { l, r, .. } => vec![*l, *r],
        Schritt::Hall { wl, wr, .. } | Schritt::Delay { wl, wr, .. } | Schritt::Limiter { wl, wr, .. } | Schritt::Gate { wl, wr, .. }
        | Schritt::Labor { wl, wr, .. } | Schritt::Remix { wl, wr, .. } | Schritt::Komp { wl, wr, .. } | Schritt::Phaser { wl, wr, .. } | Schritt::Sampler { wl, wr, .. } | Schritt::Vocoder { wl, wr, .. }
        | Schritt::Faltung { wl, wr, .. } | Schritt::Granular { wl, wr, .. } | Schritt::Eingang { wl, wr } => vec![*wl, *wr],
        Schritt::Wavetable { wl, wr, aus, .. } => vec![*wl, *wr, *aus],
        Schritt::Metall { aus, huelle, .. } => vec![*aus, *huelle],
        Schritt::Ms20 { tp, hp, .. } => vec![*tp, *hp],
        Schritt::WahlVor { .. } | Schritt::Zweig { .. } | Schritt::Ausgang { .. } => vec![],
    }
}

fn wirkung_von(neu: &[Schritt], i: Option<usize>) -> Option<Wirkung> { i.and_then(|i| wirkung(&neu[i])) }

/// One entry of the new step order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Posten {
    Orig(usize),
    Vor(usize),
    Zweig(usize, usize),
    Misch(usize),
}

/// What `zerlege` found, for tests and for `Programm::zweige_info`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Befund {
    /// (index of the `wahl` in the original step order, candidate, number of steps in the branch including nested ones)
    pub zweige: Vec<(usize, usize, usize)>,
}

/// The exclusive branch of every candidate of every switch `wahl`: `(wahl, k) -> original step indices, ascending`.
fn kegel(schritte: &[Schritt], ein: &[Vec<Quelle>], aus: &[Vec<usize>], fest: &BTreeSet<usize>) -> BTreeMap<(usize, usize), Vec<usize>> {
    let mut erzeuger: BTreeMap<usize, usize> = BTreeMap::new();
    for (i, a) in aus.iter().enumerate() {
        for s in a {
            erzeuger.insert(*s, i);
        }
    }
    // consumers[x] = (consumer step, position of the input in its input list)
    let mut verbraucher: Vec<Vec<(usize, usize)>> = vec![vec![]; schritte.len()];
    for (c, qs) in ein.iter().enumerate() {
        for (p, q) in qs.iter().enumerate() {
            if let Quelle::Slot(s) | Quelle::Vorher(s) = q {
                if let Some(x) = erzeuger.get(s) {
                    verbraucher[*x].push((c, p));
                }
            }
        }
    }
    let mut ergebnis = BTreeMap::new();
    for (w, st) in schritte.iter().enumerate() {
        let Schritt::Wahl { e, .. } = st else { continue };
        if e.morph {
            continue;
        }
        for k in 0..e.n {
            // the root: the step that makes candidate k; only a same-sample edge is handled
            let Quelle::Slot(s) = ein[w][k] else { continue };
            let Some(&wurzel) = erzeuger.get(&s) else { continue };
            // candidates: everything upstream of the root that may sit in a branch
            let mut kand: BTreeSet<usize> = BTreeSet::new();
            let mut offen = vec![wurzel];
            while let Some(x) = offen.pop() {
                if x == w || fest.contains(&x) || wirkung(&schritte[x]).is_none() || !kand.insert(x) {
                    continue;
                }
                for q in &ein[x] {
                    if let Quelle::Slot(s) | Quelle::Vorher(s) = q {
                        if let Some(&y) = erzeuger.get(s) {
                            offen.push(y);
                        }
                    }
                }
            }
            // exclusivity: a step leaves when anything outside the set, or another input of the `wahl`, reads it
            loop {
                let raus: Vec<usize> = kand.iter().copied()
                    .filter(|&x| verbraucher[x].iter().any(|&(c, p)| !(kand.contains(&c) || (c == w && p == k))))
                    .collect();
                if raus.is_empty() {
                    break;
                }
                for x in raus {
                    kand.remove(&x);
                }
            }
            if !kand.is_empty() {
                ergebnis.insert((w, k), kand.into_iter().collect());
            }
        }
    }
    ergebnis
}

/// Oscillators that must stay out of every branch (they keep running whatever the `wahl` reads). While a branch is skipped its
/// oscillators advance their phase only, from the input slots as they stand; that is right only when those slots are made by
/// steps that always run. So an oscillator stays out when
///  * an input comes from a step that sits in a branch (its slot would be stale while the branch is skipped), or
///  * its output is read through a delayed edge (the re-entry zeroes the branch's slots, which would show in that read).
/// Taking one out can put another into that state (an oscillator whose master was taken out), so this runs to a fixed point;
/// every round only adds, so it ends.
fn fest_stehende(schritte: &[Schritt], ein: &[Vec<Quelle>], aus: &[Vec<usize>]) -> BTreeSet<usize> {
    let mut fest: BTreeSet<usize> = BTreeSet::new();
    let mut erzeuger: BTreeMap<usize, usize> = BTreeMap::new();
    let mut verzoegert: BTreeSet<usize> = BTreeSet::new();
    for (i, a) in aus.iter().enumerate() {
        for s in a {
            erzeuger.insert(*s, i);
        }
    }
    for qs in ein {
        for q in qs {
            if let Quelle::Vorher(s) = q {
                if let Some(&x) = erzeuger.get(s) {
                    verzoegert.insert(x);
                }
            }
        }
    }
    loop {
        let im_zweig: BTreeSet<usize> = kegel(schritte, ein, aus, &fest).into_values().flatten().collect();
        let mut neu = false;
        for &x in &im_zweig {
            if wirkung(&schritte[x]) != Some(Wirkung::Phase) || fest.contains(&x) {
                continue;
            }
            let eingang_im_zweig = ein[x].iter().any(|q| match q {
                Quelle::Slot(s) | Quelle::Vorher(s) => erzeuger.get(s).map_or(false, |y| im_zweig.contains(y)),
                _ => false,
            });
            if eingang_im_zweig || verzoegert.contains(&x) {
                fest.insert(x);
                neu = true;
            }
        }
        if !neu {
            return fest;
        }
    }
}

/// Moves the exclusive branches of the switch `wahl` steps to just before their `wahl` and splits it (see the module text).
/// Returns the steps unchanged when there is nothing to split or when the plan fails its own check.
pub fn zerlege(schritte: Vec<Schritt>) -> Vec<Schritt> { zerlege_mit_befund(schritte).0 }

pub fn zerlege_mit_befund(schritte: Vec<Schritt>) -> (Vec<Schritt>, Befund) {
    let ein: Vec<Vec<Quelle>> = schritte.iter().map(eingaenge).collect();
    let aus: Vec<Vec<usize>> = schritte.iter().map(ausgaenge).collect();
    let fest = fest_stehende(&schritte, &ein, &aus);
    let kegel = kegel(&schritte, &ein, &aus, &fest);
    if kegel.is_empty() {
        return (schritte, Befund::default());
    }
    let n = schritte.len();
    // the innermost branch of every step (the smallest set that holds it); the family must be nested or disjoint
    let mut innerster: Vec<Option<(usize, usize)>> = vec![None; n];
    for (&schluessel, menge) in &kegel {
        for &x in menge {
            match innerster[x] {
                Some(alt) if kegel[&alt].len() <= menge.len() => {}
                _ => innerster[x] = Some(schluessel),
            }
        }
    }
    for (&a, ma) in &kegel {
        let ma: BTreeSet<usize> = ma.iter().copied().collect();
        for (&b, mb) in &kegel {
            if a == b {
                continue;
            }
            let mb: BTreeSet<usize> = mb.iter().copied().collect();
            let (a_in_b, b_in_a) = (mb.contains(&a.0), ma.contains(&b.0));
            let ok = if a_in_b { ma.is_subset(&mb) } else if b_in_a { mb.is_subset(&ma) } else { ma.is_disjoint(&mb) };
            if !ok {
                return (schritte, Befund::default());
            }
        }
    }

    // the new order
    let mut plan: Vec<Posten> = Vec::with_capacity(n + 2 * kegel.len());
    let mut ende_von: BTreeMap<usize, usize> = BTreeMap::new(); // plan index of a Zweig -> plan index after its branch
    fn ausgeben(
        liste: &[usize], zone: Option<(usize, usize)>, kegel: &BTreeMap<(usize, usize), Vec<usize>>, innerster: &[Option<(usize, usize)>],
        plan: &mut Vec<Posten>, ende_von: &mut BTreeMap<usize, usize>,
    ) {
        for &x in liste {
            if innerster[x] != zone {
                continue; // sits in a deeper branch: written where its own `wahl` is
            }
            let hat_zweige = kegel.range((x, 0)..(x + 1, 0)).next().is_some();
            if !hat_zweige {
                plan.push(Posten::Orig(x));
                continue;
            }
            plan.push(Posten::Vor(x));
            for (&(_, k), menge) in kegel.range((x, 0)..(x + 1, 0)) {
                let z = plan.len();
                plan.push(Posten::Zweig(x, k));
                ausgeben(menge, Some((x, k)), kegel, innerster, plan, ende_von);
                ende_von.insert(z, plan.len());
            }
            plan.push(Posten::Misch(x));
        }
    }
    let alle: Vec<usize> = (0..n).collect();
    ausgeben(&alle, None, &kegel, &innerster, &mut plan, &mut ende_von);

    // check: every step appears once (a split `wahl` as Vor and Misch), every same-sample input is made earlier
    let mut erzeuger: BTreeMap<usize, usize> = BTreeMap::new();
    let mut gesehen = vec![0usize; n];
    for (pos, p) in plan.iter().enumerate() {
        match *p {
            Posten::Orig(x) => {
                gesehen[x] += 1;
                aus[x].iter().for_each(|s| { erzeuger.insert(*s, pos); });
            }
            Posten::Vor(x) => gesehen[x] += 1,
            Posten::Misch(x) => {
                gesehen[x] += 1;
                aus[x].iter().for_each(|s| { erzeuger.insert(*s, pos); });
            }
            Posten::Zweig(..) => {}
        }
    }
    let verteilte_wahl: BTreeSet<usize> = kegel.keys().map(|k| k.0).collect();
    let mut ok = gesehen.iter().enumerate().all(|(x, &g)| g == if verteilte_wahl.contains(&x) { 2 } else { 1 })
        && plan.len() == n + verteilte_wahl.len() + kegel.len()
        // every guard jumps forward and stays inside the list: the run loop in `Programm::sample_stereo` relies on it
        && ende_von.iter().all(|(&z, &e)| e > z && e <= plan.len());
    let eing = |p: &Posten| -> Vec<Quelle> {
        match *p {
            Posten::Orig(x) => ein[x].clone(),
            Posten::Vor(x) => vec![ein[x][8]],
            Posten::Misch(x) => ein[x][..8].to_vec(),
            Posten::Zweig(..) => vec![],
        }
    };
    for (pos, p) in plan.iter().enumerate() {
        for q in eing(p) {
            if let Quelle::Slot(s) = q {
                if let Some(&e) = erzeuger.get(&s) {
                    ok &= e < pos;
                }
            }
        }
    }
    if !ok {
        return (schritte, Befund::default());
    }

    // build the steps
    let mut befund = Befund::default();
    let mut teile: Vec<Option<Schritt>> = schritte.into_iter().map(Some).collect();
    let mut misch: BTreeMap<usize, Schritt> = BTreeMap::new();
    let mut neu: Vec<Schritt> = Vec::with_capacity(plan.len());
    let mut vor_index: BTreeMap<usize, usize> = BTreeMap::new();
    let mut neu_index: BTreeMap<usize, usize> = BTreeMap::new(); // original index of a plain step -> index in the new order
    for p in plan.iter() {
        match *p {
            Posten::Orig(x) => {
                neu_index.insert(x, neu.len());
                neu.push(teile[x].take().unwrap());
            }
            Posten::Vor(x) => {
                let Some(Schritt::Wahl { ein: e8, wahl, aus: a, e, v }) = teile[x].take() else { unreachable!("planned from a Wahl") };
                vor_index.insert(x, neu.len());
                misch.insert(x, Schritt::WahlMisch { vor: neu.len(), ein: e8, aus: a });
                neu.push(Schritt::WahlVor { wahl, e, v, braucht: u8::MAX });
            }
            Posten::Zweig(x, k) => {
                // slots of every step inside, nested ones included
                let slots: Vec<usize> = kegel[&(x, k)].iter().flat_map(|&y| aus[y].iter().copied()).collect();
                befund.zweige.push((x, k, kegel[&(x, k)].len()));
                neu.push(Schritt::Zweig { vor: vor_index[&x], k, ende: 0, lief: true, slots: slots.into_boxed_slice(), phasen: Box::new([]) });
            }
            Posten::Misch(x) => neu.push(misch.remove(&x).unwrap()),
        }
    }
    // the oscillators of every branch (nested ones included): they advance their phase while the branch is skipped
    for (&(x, k), menge) in &kegel {
        let phasen: Vec<usize> = menge.iter().filter(|&&y| wirkung_von(&neu, neu_index.get(&y).copied()) == Some(Wirkung::Phase)).map(|y| neu_index[y]).collect();
        let z = plan.iter().position(|p| *p == Posten::Zweig(x, k)).unwrap();
        if let Schritt::Zweig { phasen: ziel, .. } = &mut neu[z] {
            *ziel = phasen.into_boxed_slice();
        }
    }
    // patch the jump targets: plan index -> new index is the identity (one new step per plan entry)
    for (&z, &e) in &ende_von {
        if let Schritt::Zweig { ende, .. } = &mut neu[z] {
            *ende = e;
        }
    }
    debug_assert_eq!(neu.len(), plan.len());
    (neu, befund)
}

#[cfg(test)]
mod tests {
    use crate::uebersetzen::uebersetze;

    const GRAPH: &str = r#"{"format":"baukasten/2","name":"zw","stimmen":1,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"k","art":"regler","nr":1,"min":0,"max":1},{"id":"w","art":"wahl","n":2,"norm":1,"blende":0},{"id":"c1","art":"mul","b":0.5},{"id":"c2","art":"mul","b":0.7},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"k.aus","nach":"w.wahl"},{"von":"s.aus","nach":"c1.a"},{"von":"c1.aus","nach":"w.e1"},{"von":"s.aus","nach":"c2.a"},{"von":"c2.aus","nach":"w.e2"},{"von":"w.aus","nach":"o.x"}]}"#;

    #[test]
    fn jeder_zweig_springt_nach_vorn_und_bleibt_in_der_liste() {
        let p = uebersetze(GRAPH, 48_000.0).unwrap();
        let (zweige, laenge) = p.zweig_grenzen();
        assert_eq!(zweige.len(), 2, "the graph must have two branches");
        for (pos, ende) in zweige {
            assert!(ende > pos && ende <= laenge, "guard at {pos} jumps to {ende} in {laenge} steps");
        }
    }

    #[test]
    fn ein_zweig_mit_falschem_ziel_haengt_oder_paniert_nicht() {
        // a guard whose target lies at or before itself, or beyond the list, cannot come out of `zerlege`; the run loop must still
        // end without a panic if one is ever built by other means
        for ende in [0usize, 1, 2, 3, 1_000] {
            let mut p = uebersetze(GRAPH, 48_000.0).unwrap();
            p.zweig_ende_setzen(ende);
            p.note_an(45, 0.8);
            for i in 0..2_000 {
                if i == 500 { p.setze_regler(1, 1.0); }
                let (l, r) = p.sample_stereo();
                assert!(l.is_finite() && r.is_finite());
            }
        }
    }
}
