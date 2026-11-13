//! Cypher Labor as VST3. The sound lives in `labor_dsp`.
//!
//! Two layouts: stereo in and out (effect: left is channel 1, right is channel 2) and no input (instrument: the
//! feedback paths and the resonance make the sound). Notes move both cutoffs by Key Track, open the gate and
//! trigger the modulator.

use labor_dsp::{Einstellung, KanalEinstellung, Labor};
use nih_plug::prelude::*;
use std::sync::Arc;

#[derive(Params)]
pub struct KanalParams {
    #[id = "gain"]
    pub gain: FloatParam,
    #[id = "mix"]
    pub mix: FloatParam,
    #[id = "delay"]
    pub delay: BoolParam,
    #[id = "time"]
    pub zeit: FloatParam,
    #[id = "cutoff"]
    pub cutoff: FloatParam,
    #[id = "reso"]
    pub resonanz: FloatParam,
    #[id = "hp"]
    pub hp: BoolParam,
    #[id = "fb"]
    pub feedback: FloatParam,
    #[id = "xfb"]
    pub kreuz: FloatParam,
    #[id = "modgain"]
    pub mod_gain: FloatParam,
    #[id = "modtime"]
    pub mod_zeit: FloatParam,
    #[id = "modcut"]
    pub mod_cutoff: FloatParam,
}

fn anteil(name: &str, v: f64) -> FloatParam {
    FloatParam::new(name, v as f32, FloatRange::Linear { min: 0.0, max: 1.0 })
        .with_unit(" %")
        .with_value_to_string(formatters::v2s_f32_percentage(0))
        .with_string_to_value(formatters::s2v_f32_percentage())
}

fn tiefe(name: &str) -> FloatParam {
    FloatParam::new(name, 0.0, FloatRange::Linear { min: -1.0, max: 1.0 })
        .with_unit(" %")
        .with_value_to_string(formatters::v2s_f32_percentage(0))
        .with_string_to_value(formatters::s2v_f32_percentage())
}

impl KanalParams {
    fn neu(nr: usize) -> Self {
        let d = KanalEinstellung::default();
        let n = |s: &str| format!("{s} {nr}");
        let andere = 3 - nr;
        KanalParams {
            gain: FloatParam::new(n("Input Gain"), d.gain_db as f32, FloatRange::Linear { min: labor_dsp::GAIN_MIN_DB as f32, max: labor_dsp::GAIN_MAX_DB as f32 })
                .with_step_size(0.1)
                .with_unit(" dB"),
            mix: anteil(&n("Output Mix"), d.mix),
            delay: BoolParam::new(n("Delay On"), d.delay_an),
            zeit: FloatParam::new(n("Delay Time"), d.zeit_ms as f32, FloatRange::Skewed { min: labor_dsp::ZEIT_MIN_MS as f32, max: labor_dsp::ZEIT_MAX_MS as f32, factor: FloatRange::skew_factor(-1.5) })
                .with_step_size(0.1)
                .with_unit(" ms"),
            cutoff: FloatParam::new(n("Cutoff"), d.cutoff_hz as f32, FloatRange::Skewed { min: labor_dsp::CUTOFF_MIN_HZ as f32, max: labor_dsp::CUTOFF_MAX_HZ as f32, factor: FloatRange::skew_factor(-2.0) })
                .with_step_size(0.1)
                .with_unit(" Hz"),
            resonanz: anteil(&n("Resonance"), d.resonanz),
            hp: BoolParam::new(n("High-Pass"), d.hp),
            feedback: anteil(&n("Feedback"), d.feedback),
            kreuz: anteil(&format!("Cross Feedback {nr} to {andere}"), d.kreuz),
            mod_gain: tiefe(&n("Mod to Gain")),
            mod_zeit: tiefe(&n("Mod to Time")),
            mod_cutoff: tiefe(&n("Mod to Cutoff")),
        }
    }

    fn einstellung(&self) -> KanalEinstellung {
        KanalEinstellung {
            gain_db: self.gain.value() as f64,
            mix: self.mix.value() as f64,
            delay_an: self.delay.value(),
            zeit_ms: self.zeit.value() as f64,
            cutoff_hz: self.cutoff.value() as f64,
            resonanz: self.resonanz.value() as f64,
            hp: self.hp.value(),
            feedback: self.feedback.value() as f64,
            kreuz: self.kreuz.value() as f64,
            mod_gain: self.mod_gain.value() as f64,
            mod_zeit: self.mod_zeit.value() as f64,
            mod_cutoff: self.mod_cutoff.value() as f64,
        }
    }
}

#[derive(Params)]
pub struct LaborParams {
    #[nested(array, group = "Channel")]
    pub kanal: [KanalParams; 2],
    #[id = "volume"]
    pub lautstaerke: FloatParam,
    #[id = "cycle"]
    pub zyklus: BoolParam,
    #[id = "trigger"]
    pub trigger: BoolParam,
    #[id = "attack"]
    pub attack: FloatParam,
    #[id = "decay"]
    pub decay: FloatParam,
    #[id = "amount"]
    pub amount: FloatParam,
    #[id = "keytrack"]
    pub key_track: FloatParam,
    #[id = "gate"]
    pub gate: BoolParam,
    #[id = "ping"]
    pub ping: FloatParam,
    #[id = "monoin"]
    pub mono_ein: BoolParam,
}

impl Default for LaborParams {
    fn default() -> Self {
        let d = Einstellung::default();
        let stufe = |name: &str, v: f64| {
            FloatParam::new(name, v as f32, FloatRange::Skewed { min: 0.005, max: 5.0, factor: FloatRange::skew_factor(-2.0) }).with_step_size(0.001).with_unit(" s")
        };
        LaborParams {
            kanal: [KanalParams::neu(1), KanalParams::neu(2)],
            lautstaerke: FloatParam::new("Volume", d.lautstaerke_db as f32, FloatRange::Linear { min: -60.0, max: 6.0 }).with_step_size(0.1).with_unit(" dB"),
            zyklus: BoolParam::new("Mod Cycle", d.zyklus),
            trigger: BoolParam::new("Mod Trigger", false),
            attack: stufe("Attack", d.attack_s),
            decay: stufe("Decay", d.decay_s),
            amount: anteil("Mod Amount", d.amount),
            key_track: anteil("Key Track", d.key_track),
            gate: BoolParam::new("Note Gate", d.gate),
            ping: anteil("Ping", d.ping),
            mono_ein: BoolParam::new("Mono Input", d.mono_ein),
        }
    }
}

impl LaborParams {
    fn einstellung(&self) -> Einstellung {
        Einstellung {
            kanal: [self.kanal[0].einstellung(), self.kanal[1].einstellung()],
            lautstaerke_db: self.lautstaerke.value() as f64,
            zyklus: self.zyklus.value(),
            attack_s: self.attack.value() as f64,
            decay_s: self.decay.value() as f64,
            amount: self.amount.value() as f64,
            key_track: self.key_track.value() as f64,
            gate: self.gate.value(),
            ping: self.ping.value() as f64,
            mono_ein: self.mono_ein.value(),
        }
    }
}

pub struct CypherLabor {
    params: Arc<LaborParams>,
    labor: Option<Labor>,
    letzte: Option<Einstellung>,
    trigger_war: bool,
    ohne_eingang: bool,
}

impl Default for CypherLabor {
    fn default() -> Self {
        CypherLabor { params: Arc::new(LaborParams::default()), labor: None, letzte: None, trigger_war: false, ohne_eingang: false }
    }
}

impl Plugin for CypherLabor {
    const NAME: &'static str = "Cypher Labor";
    const VENDOR: &'static str = "Cypher";
    const URL: &'static str = "";
    const EMAIL: &'static str = "";
    const VERSION: &'static str = env!("CARGO_PKG_VERSION");

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[
        AudioIOLayout { main_input_channels: NonZeroU32::new(2), main_output_channels: NonZeroU32::new(2), ..AudioIOLayout::const_default() },
        AudioIOLayout { main_input_channels: None, main_output_channels: NonZeroU32::new(2), ..AudioIOLayout::const_default() },
    ];
    const MIDI_INPUT: MidiConfig = MidiConfig::Basic;
    const SAMPLE_ACCURATE_AUTOMATION: bool = false;
    type SysExMessage = ();
    type BackgroundTask = ();

    fn params(&self) -> Arc<dyn Params> {
        self.params.clone()
    }

    fn initialize(&mut self, l: &AudioIOLayout, cfg: &BufferConfig, c: &mut impl InitContext<Self>) -> bool {
        let mut s = Labor::neu(cfg.sample_rate as f64);
        let e = self.params.einstellung();
        s.setze(&e);
        s.leeren();
        c.set_latency_samples(s.latenz() as u32);
        self.ohne_eingang = l.main_input_channels.is_none();
        self.letzte = Some(e);
        self.labor = Some(s);
        true
    }

    fn reset(&mut self) {
        if let Some(s) = self.labor.as_mut() {
            s.leeren();
        }
    }

    fn process(&mut self, buffer: &mut Buffer, _aux: &mut AuxiliaryBuffers, ctx: &mut impl ProcessContext<Self>) -> ProcessStatus {
        let e = self.params.einstellung();
        let Some(s) = self.labor.as_mut() else { return ProcessStatus::Normal };
        if self.letzte != Some(e) {
            s.setze(&e);
            self.letzte = Some(e);
        }
        let trigger = self.params.trigger.value();
        if trigger && !self.trigger_war {
            s.trigger(1.0);
        }
        self.trigger_war = trigger;
        let n = buffer.samples();
        if let [l, r] = buffer.as_slice() {
            if self.ohne_eingang {
                l.fill(0.0);
                r.fill(0.0);
            }
            // split the block at the note events, so a note starts at its sample
            let mut von = 0usize;
            let mut ereignis = ctx.next_event();
            while von < n {
                let mut bis = n;
                while let Some(ev) = ereignis {
                    let t = (ev.timing() as usize).min(n);
                    if t > von {
                        bis = t;
                        break;
                    }
                    match ev {
                        NoteEvent::NoteOn { note, velocity, .. } => s.note_an(note, velocity),
                        NoteEvent::NoteOff { .. } => s.note_aus(),
                        _ => {}
                    }
                    ereignis = ctx.next_event();
                }
                s.block(&mut l[von..bis], &mut r[von..bis]);
                von = bis;
            }
        }
        ProcessStatus::KeepAlive
    }
}

impl Vst3Plugin for CypherLabor {
    const VST3_CLASS_ID: [u8; 16] = *b"CypherLaborFbSyn";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] = &[Vst3SubCategory::Fx, Vst3SubCategory::Delay, Vst3SubCategory::Filter, Vst3SubCategory::Stereo];
}

nih_export_vst3!(CypherLabor);
