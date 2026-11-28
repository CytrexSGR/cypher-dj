import fs from 'node:fs';
import path from 'node:path';
import type { AnalyseEintrag, AnalyseEnde, Anforderung, Wunsch } from './analysis.ts';
import { type Anfrage, ausCache, uebersetzeAusCache, vorlauf } from './pattern_run.ts';
import { type Projekt, type Warp, sucheClip } from '../../project/model.ts';
import { aendere } from '../../project/history.ts';
import type { Quelle } from './core_path.ts';
import { type MusterMeldung, fuehreListeAus } from '../../project/commands.ts';
import { surgeBereich } from './surge.ts';
import { ankunftBefehle, klingtGerade } from '../../project/warp_analysis.ts';
import { geraetFx } from '../../devices_parameter.ts';
import { kitDa, kitKlaenge } from './kits.ts';
import { pultContainerPfad } from '../../../contract/pult.ts';
import { schreibeEinsKorrektur } from './sources.ts';
import { steckfeldVon } from '../../graphs.ts';
import {
  type Antwort, type Hinweis, type Koerper, MAX_MUSTER_JE_AUFRUF, type Offen, ProjFehler, REV_JETZT, graphArt, schlaf, steckfeldLookup, surgePatchDa,
} from './session_helpers.ts';
import type { ProjSitzung } from './session.ts';

export function pruefeRev(this: ProjSitzung, o: Offen, rev: unknown): void {
  if (rev === REV_JETZT) return;   // an in-process caller (the loop deck writes): the rev of the moment the write runs, read inside the serial chain
  if (rev !== o.projekt.rev) throw new ProjFehler(409, 'rev_veraltet', { rev: o.projekt.rev });
}

// `erwartet`: the project the caller means (the take collector); checked inside the serialized write, where the open project cannot change any more
export function aendern(this: ProjSitzung, d: Koerper, quelle: Quelle, erwartet?: Offen): Promise<Antwort> {
  return this.seriell(async () => {
    const o = this.brauchOffen();
    if (erwartet !== undefined && o !== erwartet) throw new ProjFehler(409, 'projekt_gewechselt');
    this.riegel(quelle);
    this.pruefeRev(o, d.rev);
    if (!Array.isArray(d.befehle) || d.befehle.length === 0) {
      throw new ProjFehler(400, 'argument_ungueltig', { text: 'befehle: a non-empty list of commands is required' });
    }
    const meta = { quelle, label: d.label as string };
    o.verlauf.pruefeMeta(meta);
    const { befehle, quellen, hinweise, wuensche } = this.loeseQuellenAuf(d.befehle, o.projekt);
    const alt = o.projekt;
    const musterBerichte: MusterMeldung[] = [];
    if (befehle.length === 0) {                                   // Slice 3a: alles war ein warp_auto, das nur eine Analyse anstieß
      this.starteAnalysen(o, quelle, wuensche, alt);
      return { code: 200, j: { rev: alt.rev, projekt: alt, hinweise } };
    }
    if (befehle.some((b) => (b as Koerper)?.befehl === 'tempo_setzen') && this.lage.deckLaeuft()) throw new ProjFehler(409, 'deck_laeuft');
    if (this.aufnahmeLauf && befehle.some((b) => (b as Koerper)?.befehl === 'tempo_setzen'))
      throw new ProjFehler(409, 'beschaeftigt', { text: 'a recording is running; the tempo cannot change now' });
    this.pruefeAufnahmeSpuren(o.projekt, befehle);
    // 1.9 U5: a direction word on a Surge track starts from what the host plays now; read before the (synchronous) command run
    const surgeIst = await this.surgeIstFuer(o.projekt, befehle);
    await this.musterVorlauf(befehle, o.projekt);               // strudel-clip: the children run here, async; the command run below only reads the cache
    // the host read is an await: a writer outside the queue (uebernimm: freeze, export, recording, stems) can have replaced the project meanwhile;
    // the caller's rev is checked again (spec 6.31), and the open project must still be the one this call started with
    if (this.offen !== o) throw new ProjFehler(409, 'projekt_gewechselt');
    this.pruefeRev(o, d.rev);
    // quelle: Herkunft für spur_neu (Spec 6.22)
    const probe = fuehreListeAus(o.projekt, befehle, {
      geraetFx, quelle, ordner: path.resolve(this.projekte.wurzelPfad, o.slug), transienten: this.transienten, graphArt, steckfeldVon: steckfeldLookup, kitDa,
      presetLies: this.presetLies, surgeBereich,
      surgePatchDa, pluginDa: (pl) => pl.format !== 'vst3' || fs.existsSync(pl.pfad),
      musterUebersetze: uebersetzeAusCache, kitKlaenge, musterMeldung: (m) => musterBerichte.push(m),
      ...(this.pluginIndex ? { pluginIndex: this.pluginIndex } : {}),
      ...(surgeIst ? { surgeIst: surgeIst.ist, surgeFilter1An: surgeIst.filter1An } : {}) });
    if (probe.vor.length === 0) {
      this.starteAnalysen(o, quelle, wuensche, alt);
      return { code: 200, j: { rev: o.projekt.rev, projekt: o.projekt, ...(hinweise.length ? { hinweise } : {}) } };
    }
    this.pruefeMarkerInQuelle(o.projekt, probe.projekt);
    this.pruefeSperre(o.projekt, probe.projekt, probe.betrifft_wiedergabe);
    // DJ view places (decision 10), by place (container core D3): every change of type or group at place N is refused with kanal_offen while the strip of
    // that container (pultContainerPfad) is open (trim + fader above -26 dB, a planned ramp, or PFL on), whoever sends it and whatever the new type is
    // (strudel, loops, track, leer, stems, seq). One exception, parking: a place that holds a SEQ deck or a loop deck may be switched away (the deck stays
    // in the project, silent; the page mutes it first), except that Cypher never takes a SEQ deck away from an open strip. Step edits, undo, redo and the
    // open of a project are not gated (known limit, AUFRUF.md).
    if (probe.projekt.live) {
      for (const platz of [1, 2, 3, 4] as const) {
        const vor = o.projekt.plaetze?.[platz - 1], nach = probe.projekt.plaetze?.[platz - 1];
        if (!vor || !nach) continue;
        const gleich = vor.typ === nach.typ && ('gruppe' in vor ? 'gruppe' in nach && vor.gruppe === nach.gruppe : !('gruppe' in nach));
        if (gleich) continue;
        const kanal = pultContainerPfad[platz - 1];
        const parken = vor.typ === 'seq' || vor.typ === 'loops';
        if (parken && !(vor.typ === 'seq' && quelle === 'cypher')) continue;
        if (!this.kanalBelegtGesehen(kanal)) continue;
        if (parken) throw new ProjFehler(409, 'kanal_offen', { platz, kanal,
          text: `the channel ${kanal} of place ${platz} is open; Cypher does not remove a SEQ deck that is playing` });
        throw new ProjFehler(409, 'kanal_offen', { platz, kanal,
          text: `the channel ${kanal} of place ${platz} is open; close it (fader down, PFL off) before the place changes to ${nach.typ}` });
      }
    }
    // Spec 6.31 (Leistung): die Probe IST die Ausführung; aendere rechnet sie nicht noch einmal. Gültig, weil vollziehe nach dem Warten auf die
    // Quittungen prüft, dass o.projekt noch genau der Stand ist, gegen den sie gerechnet wurde (sonst 409 rev_veraltet).
    const projekt = o.projekt;
    // task 8: the value before a page write of a gesture (not for the take's own write)
    if (erwartet === undefined && quelle === 'andreas') this.aufAuto.merkeBasen(projekt, probe.projekt);
    const antwort = await this.vollziehe(o, quelle, probe.regler_aenderungen,
      (h) => aendere(o.verlauf, projekt, befehle as never, meta, h, { ergebnis: probe }), quellen, probe.betrifft_wiedergabe,
        probe.stift_aenderungen ?? [], probe.projekt);
    if (antwort.code === 200) this.starteAnalysen(o, quelle, wuensche, alt);
    const alle = antwort.code === 200 ? [...hinweise, ...(probe.hinweise ?? []), ...this.einsRueckweg(o, d.befehle, quelle)] : hinweise;
    const mitMuster = (j: object): object => (musterBerichte.length ? { ...j, muster: musterBerichte } : j);   // strudel-clip: one report per generated clip
    return antwort.code === 200 && (alle.length || musterBerichte.length)
      ? { code: 200, j: mitMuster(alle.length ? { ...(antwort.j as object), hinweise: alle } : (antwort.j as object)) } : antwort;
  });
}

// strudel-clip: the Strudel side of every clip_aus_muster is evaluated in child processes BEFORE the synchronous command run, asynchronously, so the
// server thread never waits for a pattern. First the patterns that are known from the list itself (in parallel, at most MUSTER_KINDER_MAX at a time),
// then a dry run of the list finds those that depend on earlier commands of the same list (a clip_id whose length an earlier command changes); each
// round evaluates what the dry run found missing, until it finds nothing. Every outcome (answer, time limit, crash) is cached, so the real run only reads.
export async function musterVorlauf(this: ProjSitzung, befehle: unknown[], projekt: Projekt): Promise<void> {
  const muster = befehle.filter((b) => (b as Koerper)?.befehl === 'clip_aus_muster');
  if (muster.length === 0) return;
  if (muster.length > MAX_MUSTER_JE_AUFRUF) {
    throw new ProjFehler(400, 'argument_ungueltig', { text: `at most ${MAX_MUSTER_JE_AUFRUF} clip_aus_muster commands in one call` });
  }
  const bekannt: Anfrage[] = [];
  for (const b of muster) {
    const x = b as Koerper;
    const g = typeof x.clip_id === 'string' ? sucheClip(projekt, x.clip_id) : undefined;
    const code = typeof x.code === 'string' ? x.code : g?.clip.art === 'midi' ? g.clip.muster?.code : undefined;
    const takte = typeof x.takte === 'number' ? x.takte : g ? g.clip.laenge_beats / 4 : null;
    if (typeof code === 'string' && code.trim() !== '' && code.length <= 8192 && (takte === null || (Number.isFinite(takte) && takte > 0))) {
      bekannt.push({ code, takte });
    }
  }
  await vorlauf(bekannt);
  for (let runde = 0; runde <= MAX_MUSTER_JE_AUFRUF; runde++) {
    const fehlend: Anfrage[] = [];
    try {
      fuehreListeAus(projekt, befehle, { transienten: this.transienten, graphArt, steckfeldVon: steckfeldLookup, kitDa, presetLies: this.presetLies,
        surgeBereich, kitKlaenge,
        musterUebersetze: (a) => { const r = ausCache(a); if (!r) fehlend.push(a); return r ?? uebersetzeAusCache(a); } });
    } catch { /* the real run reports its own refusals; here only the missing patterns count */ }
    if (fehlend.length === 0) return;
    await vorlauf(fehlend);
  }
}

// Slice 3b (D3, F6): Set 1.1.1 Here geht als Zeile art = eins in die Korrekturen des Decks, wenn der Bestand den Track kennt. Das Projekt ist da
// schon geändert; ein Schreibfehler kippt es nicht, er kommt als Hinweis eins_rueckweg_fehler. Ohne Rückweg sagt eins_nur_hier, dass nur der Clip
// sich änderte.
export function einsRueckweg(this: ProjSitzung, o: Offen, roh: unknown[], quelle: Quelle): Hinweis[] {
  const aus: Hinweis[] = [];
  roh.forEach((b, index) => {
    const x = b as Koerper;
    if (x?.befehl !== 'eins_hier' || typeof x.clip_id !== 'string' || typeof x.quell_s !== 'number') return;
    const g = sucheClip(o.projekt, x.clip_id);
    if (g?.clip.art !== 'audio') return;
    const sha = g.clip.quelle.sha256;
    try {
      const r = schreibeEinsKorrektur(this.bestand, sha, x.quell_s);
      aus.push({ index, hinweis: r.status === 'geschrieben' ? 'eins_gemeldet' : 'eins_nur_hier' });
      if (r.status === 'geschrieben') this.ctx.log({ typ: 'eins_korrektur', sha, ab_quell_beat: r.ab_quell_beat, quelle });
    } catch (e) {
      aus.push({ index, hinweis: 'eins_rueckweg_fehler' });
      this.ctx.log({ typ: 'eins_korrektur_fehler', sha, fehler: (e as Error).message });
    }
  });
  return aus;
}

// Slice 3a: nach dem Schreiben die Aufträge anfordern. clip_neu-Wünsche (ohne clip_id) gelten allen neuen Clips dieser sha; der Stand beim Auftrag
// (Warp, Länge) ist, was der Clip jetzt hat (T11).
export function starteAnalysen(this: ProjSitzung, o: Offen, quelle: Quelle, wuensche: Anforderung[], alt: Projekt): void {
  if (this.analysen === null || wuensche.length === 0) return;
  const vorhanden = new Set(alt.spuren.flatMap((s) => s.clips.map((c) => c.id)));
  for (const w of wuensche) {
    for (const s of o.projekt.spuren) for (const c of s.clips) {
      if (c.art !== 'audio' || c.quelle.sha256 !== w.sha) continue;
      if (w.clip_id !== undefined ? c.id !== w.clip_id : vorhanden.has(c.id)) continue;
      this.analysen.anfordern(w.sha, w.pfad, { slug: o.slug, clip_id: c.id, quelle, vorher: c.warp ?? null, laenge_beats: c.laenge_beats });
    }
  }
}

// Das Ende einer Analyse: bei Fehler die sha als gescheitert merken und melden, bei Erfolg jeden wartenden Clip umschalten (ankunft) und melden
export function analyseEnde(this: ProjSitzung, sha: string, ei: AnalyseEintrag, ende: AnalyseEnde): void {
  this.ctx.log({ typ: 'analyse_ende', sha, ok: ende.ok, grund: ende.grund ?? null, clips: ei.wuensche.length });
  if (!ende.ok) this.analyseGescheitert.add(sha);   // D1: warp_auto und neues Ablegen warpen diese sha ab jetzt sofort aus Traktor, Takten oder BPM
  for (const w of ei.wuensche) {
    if (!ende.ok) { this.ctx.verteile({ a: 'proj', f: { clip_id: w.clip_id, analyse: 'fehler', grund: ende.grund ?? 'unbekannt' } }); continue; }
    void this.ankunft(sha, w).then((e) => {
      if (e === 'keine_karte') this.analyseGescheitert.add(sha);   // ok, aber keine brauchbare Karte in der Ablage: derselbe Fall
      const f = e === 'ok' ? { analyse: 'fertig' } : { analyse: 'verworfen', grund: e };
      this.ctx.verteile({ a: 'proj', f: { clip_id: w.clip_id, ...f } });
    }).catch((x) => this.ctx.log({ typ: 'analyse_ankunft_fehler', sha, clip_id: w.clip_id, fehler: (x as Error).message }));
  }
}

// Ankunft der Karte für einen Clip (T10, T11). Läuft ausserhalb der seriellen Kette und schreibt über aendern() (rev-Prüfung, Riegel,
// Freeze-Sperre, Verlauf, SSE); gelesen wird synchron vor dem Aufruf, rev_veraltet wiederholt. 'ok' oder der Grund, aus dem nichts geschrieben wurde.
// D1: klingt der Clip (klingtGerade), wartet sie, ohne Versuchsgrenze; jeder Durchgang liest Projekt, Clip und Warp neu, ein Wechsel oder ein
// Eingriff beendet das Warten (schliesse() setzt offen auf null: auch der Serverstop beendet es).
export async function ankunft(this: ProjSitzung, sha: string, w: Wunsch): Promise<string> {
  let veraltet = 0, beschaeftigt = 0, gemeldet = false;
  for (;;) {
    const o = this.offen;
    if (!o || o.slug !== w.slug) return 'projekt_weg';
    const g = sucheClip(o.projekt, w.clip_id);
    if (!g || g.clip.art !== 'audio' || g.clip.quelle.sha256 !== sha) return 'clip_weg';
    const z = this.katalog?.eintrag(sha) ?? null;
    if (!z) return 'katalog_weg';
    const a = ankunftBefehle(g.clip, { warp: w.vorher, laenge_beats: w.laenge_beats }, this.tempoQuelleFuer(z, sha));
    if ('lassen' in a) return a.lassen;   // Auto-Warp bleibt aus (interner Grund, nie an die Seite)
    if (klingtGerade(this.lage.arr, g.clip)) {                  // D1: ein klingender Clip wird nicht umgeschaltet
      if (!gemeldet) { gemeldet = true; this.ctx.verteile({ a: 'proj', f: { clip_id: w.clip_id, analyse: 'karte_bereit' } }); }
      await schlaf(this.analyseWarteMs);
      continue;
    }
    try {
      await this.aendern({ rev: o.projekt.rev, label: 'Auto-Warp', befehle: a.befehle }, w.quelle);
      return 'ok';
    } catch (e) {
      const grund = (e as { grund?: string })?.grund ?? null;
      if (grund === 'rev_veraltet' && ++veraltet < 5) continue;
      if (grund === 'beschaeftigt' && ++beschaeftigt < 150) { await schlaf(this.analyseWarteMs); continue; }
      if (grund !== 'ki_gestoppt') this.ctx.log({ typ: 'analyse_ankunft_abgelehnt', sha, clip_id: w.clip_id, grund, fehler: (e as Error)?.message });
      return grund ?? 'fehler';
    }
  }
}
