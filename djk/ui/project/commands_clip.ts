// Clip commands: clips, warp, audio quantise, notes and rows of the project API (handler table of commands.ts, moved unchanged).
// The handlers reach each other through PRO_BEFEHL (commands_helpers.ts) at call time; commands.ts merges the tables.
import {
  type Ziel, GAIN_MAX, GAIN_MIN, LOOP_MIN, MAX_BEAT, MUSTER_CODE_MAX, istObjekt, neueId, neueNotenId, warpPruefung, entstehungPruefung,
  type Entstehung, type AudioClip, type Clip, type MidiClip, type Note, type Spur, type Warp, type Zeile,
} from './model.ts';
import { seqSichtPruefung, type SeqSicht } from './seq.ts';
import { wendeMusterAn, musterAbdruck, type KitKlang } from './pattern_clip.ts';
import { huellkurvePruefung, teileHuellkurve } from './envelope.ts';
import { abHierGerade, einsHier, handWarp, markerAendern, tempoSkalieren, type MarkerSetze, type MarkerVerschiebe } from './warp.ts';
import {
  ab, erlaube, zahlOk, zahl, flagge, text, idArg, spurVon, laneStart, clipVon, midiVon, runde9, SHA, warpArg, WARP_FELDER, warpClip, mitWarp, gueltig,
  objekte, notenFelder, listeArg, fuegeNotenEin, type Args, type Handler,
} from './commands_helpers.ts';

// The view descriptor of a pattern clip (field `seq` of clip_neu and clip_aendern): checked, copied.
function seqSichtArg(x: unknown): SeqSicht {
  const f = seqSichtPruefung(x);
  if (f) ab(f.grund, f.text);
  return structuredClone(x) as SeqSicht;
}

export const CLIP = {
  clip_neu(p, a) {
    erlaube(a, 'spur_id', 'art', 'start_beat', 'laenge_beats', 'loop_beats', 'sha256', 'name', 'pfad_hinweis', 'noten', 'warp', 'seq');
    const s = spurVon(p, idArg(a, 'spur_id'));
    if (a.art !== 'audio' && a.art !== 'midi') ab('argument_ungueltig', 'art: audio oder midi erwartet');
    if (a.art !== (s.art === 'audio' ? 'audio' : 'midi')) ab('art_passt_nicht', `${a.art}-Clip auf ${s.art}-Spur`);
    const start = zahl(a, 'start_beat', 0, MAX_BEAT)!, laenge = zahl(a, 'laenge_beats', 0, MAX_BEAT, { offenUnten: true })!;
    // Spec 6.17: loop_beats 1/16 ≤ x ≤ laenge_beats; null oder fehlend = kein Loop (das Feld bleibt dann weg)
    const loop = a.loop_beats === undefined || a.loop_beats === null ? null : zahl(a, 'loop_beats', LOOP_MIN, MAX_BEAT)!;
    if (loop !== null && loop > laenge + 1e-9) ab('argument_ungueltig', `loop_beats: höchstens laenge_beats (${laenge})`);
    const id = neueId(p, 'clip');
    if (a.art === 'audio') {
      if (a.noten !== undefined) ab('argument_ungueltig', 'noten: nur für MIDI-Clips');
      if (a.seq !== undefined) ab('argument_ungueltig', 'seq: only for MIDI clips');
      const warp = warpArg(a.warp);
      if (typeof a.sha256 !== 'string' || !SHA.test(a.sha256)) ab('sha_ungueltig', 'sha256: 64 Hex-Zeichen (klein) aus dem Katalog erwartet');
      const hinweis = a.pfad_hinweis === undefined ? ''
        : (typeof a.pfad_hinweis === 'string' && a.pfad_hinweis.length <= 4096 ? a.pfad_hinweis : ab('argument_ungueltig', 'pfad_hinweis: Text erwartet'));
      const vonPfad = hinweis.split('/').pop()?.replace(/\.[^.]*$/, '').slice(0, 80);
      s.clips.push({ id, art: 'audio', name: text(a, 'name', 80) ?? (vonPfad || 'Audio'), start_beat: start, laenge_beats: laenge,
        quelle: { sha256: a.sha256, pfad_hinweis: hinweis }, dekodiert: 'nein', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0,
        ...(loop === null ? {} : { loop_beats: loop }), ...(warp === null ? {} : { warp }) });
    } else {
      if (a.warp !== undefined) ab('feld_nur_audio', 'warp');
      if (a.sha256 !== undefined || a.pfad_hinweis !== undefined) ab('argument_ungueltig', 'sha256/pfad_hinweis: nur für Audio-Clips');
      const sicht = a.seq === undefined ? null : seqSichtArg(a.seq);
      const clip: MidiClip = { id, art: 'midi', name: text(a, 'name', 80) ?? 'MIDI', start_beat: start, laenge_beats: laenge,
        ...(loop === null ? {} : { loop_beats: loop }), noten: [], ...(sicht === null ? {} : { seq: sicht }) };
      if (a.noten !== undefined) fuegeNotenEin(p, clip, listeArg(a, 'noten'));
      s.clips.push(clip);
    }
  },

  // strudel-clip: a Strudel pattern becomes the notes (and envelopes) of a MIDI clip. New clip: spur_id + start_beat + code (+ takte, name); in place: clip_id
  // (+ code, takte): the notes and envelopes of that clip are replaced, the clip keeps id, start and length; without code it is generated again from
  // its stored muster.code. 1 cycle = 1 bar. takte absent: a new clip is as long as the pattern takes to repeat (capped), an existing clip keeps its length.
  clip_aus_muster(p, a, ctx) {
    erlaube(a, 'spur_id', 'start_beat', 'clip_id', 'code', 'takte', 'name', 'ueberschreiben');
    if (a.ueberschreiben !== undefined && typeof a.ueberschreiben !== 'boolean') ab('argument_ungueltig', 'ueberschreiben: true or false expected');
    if ((a.spur_id === undefined) === (a.clip_id === undefined)) ab('argument_ungueltig',
      'give spur_id (a new clip) or clip_id (generate an existing clip again), not both');
    let spur: Spur, bestehend: MidiClip | null = null;
    if (a.clip_id !== undefined) {
      const g = clipVon(p, idArg(a, 'clip_id'));
      bestehend = midiVon(g.clip, a.clip_id); spur = g.spur;
      if (a.start_beat !== undefined) ab('argument_ungueltig', 'start_beat: only for a new clip');
    } else {
      spur = spurVon(p, idArg(a, 'spur_id'));
      if (spur.art !== 'instrument') ab('art_passt_nicht', `${spur.id} is an audio track: a pattern makes MIDI clips`);
    }
    const code = a.code ?? bestehend?.muster?.code;
    if (typeof code !== 'string' || code.trim() === '' || code.length > MUSTER_CODE_MAX) {
      ab(a.code === undefined && bestehend ? 'muster_fehlt' : 'argument_ungueltig', a.code === undefined && bestehend
        ? `${bestehend.id} has no stored pattern: give code` : `code: text of 1..${MUSTER_CODE_MAX} characters expected`);
    }
    const takte = zahl(a, 'takte', 0, 1024, { opt: true, offenUnten: true }) ?? (bestehend ? bestehend.laenge_beats / 4 : null);
    const start = bestehend ? bestehend.start_beat : zahl(a, 'start_beat', 0, MAX_BEAT)!;
    const name = text(a, 'name', 80);
    // generating again replaces notes and envelopes: what was changed by hand since the pattern made them is only replaced when asked for
    if (bestehend && a.ueberschreiben !== true && bestehend.muster?.abdruck !== undefined && bestehend.muster.abdruck !== musterAbdruck(bestehend)) {
      ab('handarbeit_vorhanden',
        `${bestehend.id}: notes or envelopes were changed by hand since the pattern made them; pass ueberschreiben: true to replace them`);
    }
    if (!ctx.musterUebersetze) ab('muster_nicht_verfuegbar', 'this server cannot translate Strudel patterns');
    const g = spur.geraet;
    const kitName = g?.art === 'intern' && g.name === 'kit' ? g.kit : null;
    let klaenge: KitKlang[] | null = null;
    if (kitName !== null) {
      klaenge = ctx.kitKlaenge?.(kitName) ?? null;
      if (klaenge === null) ab('kit_unbekannt', kitName);
    }
    const erg = ctx.musterUebersetze!({ code: code as string, takte });
    if (!erg.ok) return ab(erg.grund, erg.fehler);
    const r = wendeMusterAn(erg, spur, klaenge, kitName, (ziel) => laneStart(spur, ziel as Ziel));
    if ('grund' in r) return ab(r.grund, r.text);
    const clip: MidiClip = bestehend ?? {
      id: neueId(p, 'clip'), art: 'midi', name: name ?? 'Pattern', start_beat: start, laenge_beats: erg.laenge_beats, noten: [],
    };
    if (bestehend && name !== undefined) clip.name = name;
    clip.laenge_beats = erg.laenge_beats;
    if (erg.loop_beats === null) delete clip.loop_beats; else clip.loop_beats = erg.loop_beats;
    clip.noten = [];
    if (r.noten.length) fuegeNotenEin(p, clip, r.noten as unknown[]);
    for (const h of r.huellkurven) {
      const f = huellkurvePruefung(h, clip, spur);
      if (f) ab(f.grund, f.text);
    }
    if (r.huellkurven.length) clip.huellkurven = r.huellkurven; else delete clip.huellkurven;
    clip.muster = { code: code as string, ...(r.ohne_ziel.length ? { ohne_ziel: r.ohne_ziel } : {}), abdruck: musterAbdruck(clip) };
    if (!bestehend) spur.clips.push(clip);
    ctx.musterMeldung?.({ clip_id: clip.id, spur_id: spur.id, noten_zahl: clip.noten.length, takte: erg.takte, loop_beats: erg.loop_beats,
      huellkurven: r.huellkurven.map((h) => h.ziel), ohne_ziel: r.ohne_ziel, hinweise: r.hinweise });
  },

  clip_aendern(p, a) {
    erlaube(a, 'clip_id', 'start_beat', 'laenge_beats', 'loop_beats', 'offset_s', 'gain_db', 'fade_ein_beats', 'fade_aus_beats', 'spur_id', 'name',
      'versatz_beats', 'stumm', 'entstehung', 'seq');
    const { spur, clip } = clipVon(p, idArg(a, 'clip_id'));
    const felder = ['start_beat', 'laenge_beats', 'loop_beats', 'offset_s', 'gain_db', 'fade_ein_beats', 'fade_aus_beats', 'spur_id', 'name',
      'versatz_beats', 'stumm', 'entstehung', 'seq'];
    if (a.seq !== undefined && clip.art !== 'midi') ab('argument_ungueltig', 'seq: only for MIDI clips');
    const sicht = a.seq === undefined || a.seq === null ? null : seqSichtArg(a.seq);   // checked before anything changes
    if (felder.every((k) => a[k] === undefined)) ab('argument_ungueltig', 'keine Änderung angegeben');
    for (const k of ['offset_s', 'gain_db', 'fade_ein_beats', 'fade_aus_beats', 'versatz_beats', 'stumm', 'entstehung']) {
      if (a[k] !== undefined && clip.art !== 'audio') ab('feld_nur_audio', k);
    }
    const versatz = zahl(a, 'versatz_beats', -MAX_BEAT, MAX_BEAT, { opt: true });
    const start = zahl(a, 'start_beat', 0, MAX_BEAT, { opt: true }), laenge = zahl(a, 'laenge_beats', 0, MAX_BEAT, { opt: true, offenUnten: true });
    const offset = zahl(a, 'offset_s', 0, 1e7, { opt: true }), gain = zahl(a, 'gain_db', GAIN_MIN, GAIN_MAX, { opt: true });
    const ein = zahl(a, 'fade_ein_beats', 0, MAX_BEAT, { opt: true }), aus = zahl(a, 'fade_aus_beats', 0, MAX_BEAT, { opt: true });
    const name = text(a, 'name', 80);
    const loop = a.loop_beats === undefined || a.loop_beats === null ? a.loop_beats as null | undefined : zahl(a, 'loop_beats', LOOP_MIN, MAX_BEAT)!;
    let ziel: Spur | undefined;
    if (a.spur_id !== undefined) {
      ziel = spurVon(p, idArg(a, 'spur_id'));
      if (clip.art !== (ziel.art === 'audio' ? 'audio' : 'midi')) ab('art_passt_nicht', `${clip.art}-Clip auf ${ziel.art}-Spur`);
      for (const h of clip.huellkurven ?? []) {     // 1.12 slice 5: the envelopes must fit the new track (geraet.* on RB-338 tracks only)
        const f = huellkurvePruefung(h, clip, ziel);
        if (f) ab(f.grund, f.text);
      }
    }
    if (start !== undefined) clip.start_beat = start;
    if (laenge !== undefined) clip.laenge_beats = laenge;
    // Spec 6.17: loop_beats ≤ laenge_beats. Ausdrücklich zu lang ist ein Fehler; eine kürzere Länge zieht den Loop mit.
    if (loop !== undefined) {
      if (loop !== null && loop > clip.laenge_beats + 1e-9) ab('argument_ungueltig', `loop_beats: höchstens laenge_beats (${clip.laenge_beats})`);
      clip.loop_beats = loop;
    } else if (clip.loop_beats != null && clip.loop_beats > clip.laenge_beats) clip.loop_beats = clip.laenge_beats;
    // 1.12 slice 5: an envelope loop longer than the clip is clamped like the clip loop; its points stay (silent beyond the clip)
    for (const h of clip.huellkurven ?? []) if (h.loop_beats !== undefined && h.loop_beats > clip.laenge_beats) h.loop_beats = clip.laenge_beats;
    if (name !== undefined) clip.name = name;
    if (clip.art === 'midi' && a.seq !== undefined) { if (sicht === null) delete clip.seq; else clip.seq = sicht; }   // null removes the descriptor
    if (clip.art === 'audio') {
      // Paket 1.13: bei Warp an liest der Clip nicht über offset_s, sondern über versatz_beats (Beats, tempounabhängig)
      if (offset !== undefined && clip.warp?.an) ab('offset_bei_warp', 'der Clip ist gewarpt: den Inhalt verschiebt versatz_beats');
      if (versatz !== undefined && !clip.warp) ab('kein_warp', clip.id);
      const fv = versatz !== undefined && clip.warp ? warpPruefung({ ...clip.warp, versatz_beats: versatz }) : null;
      if (fv) ab(fv.grund, fv.text);
      if (offset !== undefined) clip.offset_s = offset;
      if (versatz !== undefined && clip.warp) clip.warp = { ...clip.warp, versatz_beats: versatz };
      if (gain !== undefined) clip.gain_db = gain;
      if (a.stumm !== undefined) {
        if (typeof a.stumm !== 'boolean') ab('argument_ungueltig', 'stumm: true oder false erwartet');
        if (a.stumm) clip.stumm = true; else delete clip.stumm;
      }
      if (a.entstehung !== undefined) {   // S15: provenance of a stream take; null deletes the field (absent, never null in the file)
        if (a.entstehung === null) delete clip.entstehung;
        else {
          const fe = entstehungPruefung(a.entstehung);
          if (fe) ab(fe.grund, fe.text);
          clip.entstehung = structuredClone(a.entstehung) as Entstehung;
        }
      }
      if (ein !== undefined) clip.fade_ein_beats = ein;
      if (aus !== undefined) clip.fade_aus_beats = aus;
      if (clip.fade_ein_beats + clip.fade_aus_beats > clip.laenge_beats + 1e-9) {
        ab('fade_zu_lang', `${clip.fade_ein_beats} + ${clip.fade_aus_beats} > ${clip.laenge_beats}`);
      }
    }
    if (ziel && ziel !== spur) { spur.clips.splice(spur.clips.indexOf(clip), 1); ziel.clips.push(clip); }
  },

  clip_teilen(p, a) {
    erlaube(a, 'clip_id', 'beat');
    const { spur, clip } = clipVon(p, idArg(a, 'clip_id'));
    if (clip.loop_beats != null) ab('argument_ungueltig', 'Loop-Clip: erst den Loop ausschalten (loop_beats null), dann teilen (Spec 6.17)');
    const beat = zahl(a, 'beat', -MAX_BEAT, MAX_BEAT)!;
    const rel = beat - clip.start_beat, rest = clip.start_beat + clip.laenge_beats - beat;
    if (!(rel > 0 && rest > 0)) ab('beat_ausserhalb', `${beat} liegt nicht im Inneren von ${clip.start_beat}..${clip.start_beat + clip.laenge_beats}`);
    const id = neueId(p, 'clip');
    let zweiter: Clip;
    if (clip.art === 'audio') {
      const zw: AudioClip = { ...structuredClone(clip), id, start_beat: beat, laenge_beats: rest,
        offset_s: runde9(clip.offset_s + rel * 60 / p.tempo_bpm), fade_ein_beats: 0, fade_aus_beats: Math.min(clip.fade_aus_beats, rest) };
      // Paket 1.13: der zweite Teil beginnt rel Beats weiter im Inhalt, exakt in Beats und unabhängig vom Tempo
      if (zw.warp) zw.warp = { ...zw.warp, versatz_beats: runde9(zw.warp.versatz_beats + rel) };
      zweiter = zw;
      clip.fade_ein_beats = Math.min(clip.fade_ein_beats, rel); clip.fade_aus_beats = 0;
    } else {
      const erste: Note[] = [], zweite: Note[] = [], quer: Note[] = [];
      for (const n of clip.noten) {
        if (n.beat + n.laenge <= rel) erste.push(n);
        else if (n.beat >= rel) zweite.push({ ...n, beat: runde9(n.beat - rel) });
        else { erste.push({ ...n, laenge: runde9(rel - n.beat) }); quer.push({ ...n, beat: 0, laenge: runde9(n.beat + n.laenge - rel) }); }
      }
      zweiter = { ...structuredClone(clip), id, start_beat: beat, laenge_beats: rest, noten: zweite };
      for (const q of quer) { q.id = neueNotenId(p); zweiter.noten.push(q); }
      clip.noten = erste;
      delete clip.muster; delete (zweiter as MidiClip).muster;   // strudel-clip: a cut clip is no longer what the pattern makes
    }
    if (clip.huellkurven) {                        // 1.12 slice 5 (T6.4): linked envelopes are cut, unlinked ones rotate on the right part
      const teile = clip.huellkurven.map((h) => teileHuellkurve(h, rel));
      clip.huellkurven = teile.map((t) => t.links); zweiter.huellkurven = teile.map((t) => t.rechts);
      // an unlinked loop longer than a part is clamped to that part (as clip_aendern does): the part never reaches a repetition, so it sounds the same
      for (const [c, laenge] of [[clip, rel], [zweiter, rest]] as const) {
        for (const h of c.huellkurven ?? []) if (h.loop_beats !== undefined && h.loop_beats > laenge) h.loop_beats = laenge;
      }
    }
    clip.laenge_beats = rel;
    spur.clips.splice(spur.clips.indexOf(clip) + 1, 0, zweiter);
  },

  // Paket 1.13: Warp eines Audio-Clips. Entweder das ganze Objekt (`warp`, null oder 'aus' entfernt es) oder einzelne Felder des vorhandenen Warps.
  warp_setzen(p, a) {
    erlaube(a, 'clip_id', 'warp', ...WARP_FELDER);
    const gefunden = clipVon(p, idArg(a, 'clip_id')).clip;
    const clip = gefunden.art === 'audio' ? gefunden : ab('feld_nur_audio', 'warp');
    const einzeln = WARP_FELDER.filter((k) => a[k] !== undefined);
    if (a.warp !== undefined) {
      if (einzeln.length) ab('argument_ungueltig', `warp: entweder das ganze Objekt oder einzelne Felder (${einzeln.join(', ')})`);
      const w = warpArg(a.warp);
      if (w === null) delete clip.warp; else clip.warp = w;
      return;
    }
    if (!einzeln.length) ab('argument_ungueltig', 'keine Änderung angegeben');
    const alt = clip.warp ?? ab('kein_warp', clip.id);
    const neu: Warp = structuredClone(alt);
    if (a.an !== undefined) neu.an = flagge(a, 'an')!;
    if (a.modus !== undefined) neu.modus = a.modus;
    if (a.transpose_st !== undefined) neu.transpose_st = a.transpose_st;
    if (a.detune_ct !== undefined) neu.detune_ct = a.detune_ct;
    if (a.beats !== undefined) neu.beats = structuredClone(a.beats) as Warp['beats'];
    const f = warpPruefung(neu);
    if (f) ab(f.grund, f.text);
    clip.warp = neu;
  },

  // Paket 1.13: Auto-Warp aus den Tempo-Angaben der Library löst der Server auf (session.ts loeseQuellenAuf schreibt den Befehl in warp_setzen
  // um); ohne Katalog bleibt nur diese Ablehnung
  warp_auto(p, a) {
    erlaube(a, 'clip_id');
    if (clipVon(p, idArg(a, 'clip_id')).clip.art !== 'audio') ab('feld_nur_audio', 'warp');
    ab('argument_ungueltig', 'warp_auto braucht den Katalog des Servers (Tempo-Angaben der Library)');
  },

  // Slice 3b (Spec 5.5): ×2 / :2. Die Beats aller Marker, der Versatz, die Länge und der Loop des Clips werden mit dem Faktor multipliziert: derselbe
  // Ausschnitt der Quelle klingt, nur mit doppelt (halb) so vielen Beats. Die Fades bleiben in Beats; reichen sie danach über den Clip: fade_zu_lang.
  warp_tempo(p, a) {
    erlaube(a, 'clip_id', 'faktor');
    const clip = warpClip(p, a);
    const warp = gueltig(mitWarp(() => tempoSkalieren(clip.warp, a.faktor)));
    const laenge = clip.laenge_beats * a.faktor;
    if (laenge > MAX_BEAT) ab('argument_ungueltig', `laenge_beats: höchstens ${MAX_BEAT}`);
    const loop = clip.loop_beats == null ? null : clip.loop_beats * a.faktor;
    if (loop !== null && loop < LOOP_MIN) ab('argument_ungueltig', `loop_beats: mindestens ${LOOP_MIN}`);
    if (clip.fade_ein_beats + clip.fade_aus_beats > laenge + 1e-9) ab('fade_zu_lang', `${clip.fade_ein_beats} + ${clip.fade_aus_beats} > ${laenge}`);
    clip.warp = warp; clip.laenge_beats = laenge;
    if (loop !== null) clip.loop_beats = loop;
    for (const h of clip.huellkurven ?? []) if (h.loop_beats !== undefined && h.loop_beats > laenge) h.loop_beats = laenge;   // as clip_aendern (Audit U10)
  },

  // Slice 3b: Marker setzen, löschen, verschieben (Reihenfolge löschen → verschieben → setzen; Beats wie vor dem Befehl). Die Länge des Clips bleibt.
  warp_marker(p, a) {
    erlaube(a, 'clip_id', 'setze', 'loesche', 'verschiebe');
    const clip = warpClip(p, a);
    if (a.setze === undefined && a.loesche === undefined && a.verschiebe === undefined) ab('argument_ungueltig', 'keine Änderung angegeben');
    const setze = a.setze === undefined ? undefined : objekte(a, 'setze', ['quell_s', 'beat']).map((s): MarkerSetze => ({
      quell_s: zahl(s, 'quell_s', 0, 1e7)!, ...(s.beat === undefined ? {} : { beat: zahl(s, 'beat', -MAX_BEAT, MAX_BEAT)! }) }));
    const loesche = a.loesche === undefined ? undefined
      : listeArg(a, 'loesche').map((b) => (zahlOk(b) ? b : ab('argument_ungueltig', 'loesche: Beats (Zahlen) erwartet')));
    const verschiebe = a.verschiebe === undefined ? undefined : objekte(a, 'verschiebe', ['beat', 'neu_beat', 'neu_quell_s']).map((v): MarkerVerschiebe => ({
      beat: zahl(v, 'beat', -MAX_BEAT, MAX_BEAT)!, ...(v.neu_beat === undefined ? {} : { neu_beat: zahl(v, 'neu_beat', -MAX_BEAT, MAX_BEAT)! }),
      ...(v.neu_quell_s === undefined ? {} : { neu_quell_s: zahl(v, 'neu_quell_s', 0, 1e7)! }) }));
    const marker = mitWarp(() => markerAendern(clip.warp.marker, { setze, loesche: loesche as number[] | undefined, verschiebe }));
    clip.warp = gueltig(handWarp(clip.warp, marker));
  },

  // Slice 3b: Warp From Here. gerade: ab `beat` (Clip-Beat) ein Segment mit dem Tempo dort. start: ab `beat` der Auto-Warp neu; den löst der Server
  // aus dem Katalog (session.ts loeseQuellenAuf schreibt den Befehl in warp_setzen um), ohne Katalog bleibt nur diese Ablehnung. Die Länge bleibt.
  warp_ab_hier(p, a) {
    erlaube(a, 'clip_id', 'beat', 'art');
    const clip = warpClip(p, a);
    const beat = zahl(a, 'beat', -MAX_BEAT, MAX_BEAT)!;
    if (a.art !== 'gerade' && a.art !== 'start') ab('argument_ungueltig', 'art: gerade oder start erwartet');
    if (a.art === 'start') ab('argument_ungueltig', 'warp_ab_hier start braucht den Katalog des Servers (Tempo-Angaben der Library)');
    const marker = abHierGerade(clip.warp.marker, beat);
    if (marker !== null) clip.warp = gueltig(handWarp(clip.warp, marker));
  },

  // Slice 4: Quantize Audio. Die Transienten kennt nur der Server (session.ts loeseQuellenAuf schreibt den Befehl in warp_setzen mit Hand-Markern um);
  // hier bleibt die Ablehnung der Fälle, die er nicht umschreibt.
  audio_quantisieren(p, a) {
    erlaube(a, 'clip_id', 'raster', 'staerke', 'von_beat', 'bis_beat');
    warpClip(p, a);
    ab('argument_ungueltig', 'audio_quantisieren braucht den Server (er kennt die Transienten)');
  },

  // Slice 3b: Set 1.1.1 Here. Die Stelle quell_s der Quelle wird Beat 0; der Klang bleibt, der Clip beginnt (versatz_beats gleich) an der neuen Eins.
  // Seine Länge folgt, damit er dasselbe Ende der Quelle spielt: laenge − (alter Beat der Stelle).
  eins_hier(p, a) {
    erlaube(a, 'clip_id', 'quell_s');
    const clip = warpClip(p, a);
    const { warp, verschoben } = einsHier(clip.warp, zahl(a, 'quell_s', 0, 1e7)!);
    const laenge = runde9(clip.laenge_beats - verschoben);
    if (!(laenge > 0)) ab('beat_ausserhalb', `die neue Eins liegt ${verschoben} Beats hinter dem Anfang, der Clip hat ${clip.laenge_beats}`);
    if (laenge > MAX_BEAT) ab('argument_ungueltig', `laenge_beats: höchstens ${MAX_BEAT}`);
    if (clip.fade_ein_beats + clip.fade_aus_beats > laenge + 1e-9) ab('fade_zu_lang', `${clip.fade_ein_beats} + ${clip.fade_aus_beats} > ${laenge}`);
    clip.warp = gueltig(warp); clip.laenge_beats = laenge;
    if (clip.loop_beats != null && clip.loop_beats > laenge) clip.loop_beats = laenge;
    for (const h of clip.huellkurven ?? []) if (h.loop_beats !== undefined && h.loop_beats > laenge) h.loop_beats = laenge;   // as clip_aendern (Audit U10)
  },

  // Slice 3b: tempo_vom_clip setzt das Projekttempo auf das Tempo des Clips (warp.ts fensterTempo). Den Befehl schreibt der Server in tempo_setzen um
  // (session.ts loeseQuellenAuf), damit die Sperren des Tempos (deck_laeuft, Aufnahme) greifen; hier bleibt die Ablehnung der Fälle, die er nicht umschreibt.
  tempo_vom_clip(p, a) {
    erlaube(a, 'clip_id');
    warpClip(p, a);
    ab('argument_ungueltig', 'tempo_vom_clip braucht den Server (er setzt das Projekttempo über tempo_setzen)');
  },

  // spur_id (optional): the track the copy goes to (at ziel_beat); without it, or with the clip's own track, the copy sits right behind the original.
  // A track that cannot carry the clip (audio clip on an instrument track or the reverse) is spur_art; an unknown track spur_unbekannt.
  clip_duplizieren(p, a) {
    erlaube(a, 'clip_id', 'ziel_beat', 'spur_id');
    const { spur, clip } = clipVon(p, idArg(a, 'clip_id'));
    const ziel = zahl(a, 'ziel_beat', 0, MAX_BEAT, { opt: true }) ?? clip.start_beat + clip.laenge_beats;
    const zielSpur = a.spur_id === undefined ? spur : spurVon(p, idArg(a, 'spur_id'));
    if (clip.art !== (zielSpur.art === 'audio' ? 'audio' : 'midi')) ab('spur_art', `${clip.art} clip cannot go to ${zielSpur.art} track ${zielSpur.id}`);
    for (const h of clip.huellkurven ?? []) {     // the envelopes must fit the other track, as for clip_aendern
      const f = zielSpur === spur ? null : huellkurvePruefung(h, clip, zielSpur);
      if (f) ab(f.grund, f.text);
    }
    const kopie = { ...structuredClone(clip), id: neueId(p, 'clip'), start_beat: ziel };
    if (zielSpur === spur) spur.clips.splice(spur.clips.indexOf(clip) + 1, 0, kopie); else zielSpur.clips.push(kopie);
  },

  // Glue: clip_ids (two or more clips of ONE track, any order, no repeats) become one clip from the first start to the last end, on the place and with
  // the id of the first (earliest) clip; the others are removed. One command = one undo step. Reasons: verbinden_spur (clips of different tracks),
  // verbinden_loop (a clip with an active loop, loop_beats shorter than its length: unroll it first), verbinden_audio (see below).
  // MIDI: the notes keep their absolute beats (gaps stay silent, overlapping clips keep all notes; a note behind the end of its own clip is dropped
  // and one running past that end is cut to it, as playback does; a note that would end after the new end is cut to it; a note id that is already
  // taken gets a new one). The result is the FIRST clip in everything else: its envelopes (huellkurven) and its seq descriptor stay,
  // nothing is merged from the others (their envelopes and seq are lost). The strudel origin (muster) is dropped, as clip_teilen does: glued notes are no
  // longer what the pattern makes. An inactive loop (loop_beats = length) is dropped so the longer clip does not start to loop.
  // Audio: only the inverse of clip_teilen, i.e. consecutive pieces of one source: same source, name, gain, mute, envelopes and warp settings, each piece
  // touches the previous one on the timeline and continues where the previous one ends in the source (offset_s when not warped, warp.versatz_beats when
  // warped: a warped clip does not read offset_s, so a tempo change after the split does not matter),
  // and no fade sits at a join. The result is the first clip, longer, with the fade-out of the last piece. Different audio cannot be glued: it needs a
  // bounce of the track. Take lanes are not touched (their clip ids answer clip_unbekannt).
  clips_verbinden(p, a) {
    erlaube(a, 'clip_ids');
    const ids = listeArg(a, 'clip_ids');
    if (ids.length < 2 || !ids.every((x) => typeof x === 'string' && x) || new Set(ids).size !== ids.length) {
      ab('argument_ungueltig', 'clip_ids: two or more different clip IDs expected');
    }
    const gefunden = (ids as string[]).map((id) => clipVon(p, id));
    const spur = gefunden[0].spur;
    if (gefunden.some((g) => g.spur !== spur)) ab('verbinden_spur', 'the clips lie on different tracks');
    const clips = gefunden.map((g) => g.clip).sort((x, y) => x.start_beat - y.start_beat);
    for (const c of clips) {
      if (c.loop_beats != null && c.loop_beats < c.laenge_beats - 1e-9) ab('verbinden_loop', `${c.id}: turn the loop off (unroll it) before gluing`);
    }
    const erste = clips[0], ende = runde9(Math.max(...clips.map((c) => c.start_beat + c.laenge_beats)));
    const laenge = runde9(ende - erste.start_beat);
    if (erste.art === 'audio') {
      const nenner = (c: AudioClip) => JSON.stringify({ ...c, id: 0, start_beat: 0, laenge_beats: 0, offset_s: 0, fade_ein_beats: 0, fade_aus_beats: 0,
        dekodiert: 0, loop_beats: 0,
        warp: c.warp ? { ...c.warp, versatz_beats: 0 } : c.warp });
      const nein = (grund: string): never => ab('verbinden_audio', `${clips.map((c) => c.id).join(', ')}: ${grund}`);
      clips.forEach((c, i) => {
        if (c.art !== 'audio') return nein('not an audio clip');
        if (i === 0) return;
        const v = clips[i - 1] as AudioClip, n = c as AudioClip;
        if (nenner(v) !== nenner(n)) nein('different source or settings: glue of different audio needs a bounce of the track');
        if (Math.abs(n.start_beat - (v.start_beat + v.laenge_beats)) > 1e-9) {
          nein('the clips do not touch: glue of different audio needs a bounce of the track');
        }
        const weiter = (v.warp?.an || Math.abs(n.offset_s - (v.offset_s + v.laenge_beats * 60 / p.tempo_bpm)) < 1e-6)
          && (!v.warp || Math.abs(n.warp!.versatz_beats - (v.warp.versatz_beats + v.laenge_beats)) < 1e-9);
        if (!weiter) nein('the source does not continue where the previous clip ends: glue of different audio needs a bounce of the track');
        if (v.fade_aus_beats > 0 || n.fade_ein_beats > 0) nein('a fade at the join would be lost');
      });
      const letzte = clips[clips.length - 1] as AudioClip;
      (erste as AudioClip).fade_aus_beats = letzte.fade_aus_beats;
    } else {
      const belegt = new Set<string>(), noten: Note[] = [];
      for (const c of clips) {
        if (c.art !== 'midi') ab('verbinden_audio', `${c.id}: not a MIDI clip`);
        const versatz = runde9(c.start_beat - erste.start_beat);
        for (const n of (c as MidiClip).noten) {
          if (n.beat >= c.laenge_beats - 1e-9) continue;               // silent behind its own clip's end: stays silent
          const beat = runde9(n.beat + versatz);
          if (beat >= laenge - 1e-9) continue;
          const id = belegt.has(n.id) ? neueNotenId(p) : n.id;
          belegt.add(id);
          noten.push({ ...n, id, beat, laenge: Math.min(n.laenge, runde9(c.laenge_beats - n.beat), runde9(laenge - beat)) });
        }
      }
      (erste as MidiClip).noten = noten;
      delete (erste as MidiClip).muster;
    }
    delete erste.loop_beats;
    erste.laenge_beats = laenge;
    for (const c of clips.slice(1)) spur.clips.splice(spur.clips.indexOf(c), 1);
  },

  clip_loeschen(p, a) {
    erlaube(a, 'clip_id');
    const { spur, clip } = clipVon(p, idArg(a, 'clip_id'));
    spur.clips.splice(spur.clips.indexOf(clip), 1);
  },

  noten_neu(p, a) {
    erlaube(a, 'clip_id', 'noten');
    const id = idArg(a, 'clip_id');
    const clip = midiVon(clipVon(p, id).clip, id);
    const roh = listeArg(a, 'noten');
    const neu = new Set<string>();
    for (const r of roh) if (istObjekt(r) && typeof r.id === 'string') { if (neu.has(r.id)) ab('id_belegt', r.id); neu.add(r.id); }
    fuegeNotenEin(p, clip, roh);
  },

  noten_aendern(p, a) {
    erlaube(a, 'clip_id', 'noten');
    const id = idArg(a, 'clip_id');
    const clip = midiVon(clipVon(p, id).clip, id);
    const roh = listeArg(a, 'noten');
    const nachId = new Map(clip.noten.map((n, k) => [n.id, k] as const));  // linear statt find je Note (S2-Integration Slice 1)
    const aenderungen = roh.map((r, i) => {
      if (!istObjekt(r)) return ab('argument_ungueltig', `noten[${i}]: Objekt erwartet`);
      erlaube(r as Args, 'id', 'beat', 'laenge', 'ton', 'vel', 'chance', 'wdh', 'versatz');
      if (typeof r.id !== 'string') ab('argument_ungueltig', `noten[${i}].id: ID erwartet`);
      const { f, weg } = notenFelder(r as Args, `noten[${i}]`, true);
      if (Object.keys(f).length === 0 && weg.length === 0) ab('argument_ungueltig', `noten[${i}]: keine Änderung angegeben`);
      const k = nachId.get(r.id as string) ?? ab('noten_unbekannt', String(r.id));
      return { k, f, weg };
    });
    // Spec 6.31 (Leistung): eine geänderte Note ist ein neues Objekt, die alte bleibt unberührt (der Notenweg teilt ungeänderte Noten mit dem Stand davor)
    for (const { k, f, weg } of aenderungen) {
      const neu: Note = { ...clip.noten[k], ...f };
      for (const w of weg) delete neu[w];
      clip.noten[k] = neu;
    }
  },

  noten_loeschen(p, a) {
    erlaube(a, 'clip_id', 'ids');
    const id = idArg(a, 'clip_id');
    const clip = midiVon(clipVon(p, id).clip, id);
    const ids = listeArg(a, 'ids');
    const da = new Set(clip.noten.map((x) => x.id)), weg = new Set<string>();   // linear statt some/includes je Note (S2-Integration Slice 1)
    for (const n of ids) { if (typeof n !== 'string' || !da.has(n)) ab('noten_unbekannt', String(n)); weg.add(n as string); }
    clip.noten = clip.noten.filter((n) => !weg.has(n.id));
  },

  // Workbench row settings of one pitch in a MIDI clip: schritte (1..128), swing (1..100), richtung ("pendel"); null removes a field. A row without any
  // field and an empty zeilen object are removed (never written when empty).
  zeile_setzen(p, a) {
    erlaube(a, 'clip_id', 'ton', 'schritte', 'swing', 'richtung');
    const id = idArg(a, 'clip_id');
    const clip = midiVon(clipVon(p, id).clip, id);
    const ton = zahl(a, 'ton', 0, 127, { ganz: true })!;
    if (['schritte', 'swing', 'richtung'].every((k) => a[k] === undefined)) ab('argument_ungueltig', 'zeile: no field given (schritte, swing, richtung)');
    const zeile: Zeile = { ...(clip.zeilen?.[String(ton)] ?? {}) };
    for (const [k, min, max] of [['schritte', 1, 128], ['swing', 1, 100]] as const) {
      if (a[k] === undefined) continue;
      if (a[k] === null) delete zeile[k]; else zeile[k] = zahl(a, k, min, max, { ganz: true })!;
    }
    if (a.richtung !== undefined) {
      if (a.richtung === null) delete zeile.richtung;
      else if (a.richtung === 'pendel') zeile.richtung = 'pendel';
      else ab('argument_ungueltig', 'richtung: "pendel" or null expected');
    }
    const zeilen: Record<string, Zeile> = { ...(clip.zeilen ?? {}) };
    if (Object.keys(zeile).length === 0) delete zeilen[String(ton)]; else zeilen[String(ton)] = zeile;
    if (Object.keys(zeilen).length === 0) delete clip.zeilen; else clip.zeilen = zeilen;
  },
} satisfies Record<string, Handler>;
