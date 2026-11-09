// Test-Attrappe der Projekt-API (D1-Spec 3.3/3.4) für Paket V1, solange S2 parallel entsteht. Sie steht als Vermittler
// VOR dem echten Seiten-Server eines Prüfstapels: /proj/* beantwortet sie selbst (im Speicher), alles andere reicht sie
// unverändert durch (den Origin-Kopf nimmt sie heraus, sonst lehnte fremdePost des Servers mit 403 ab). In den
// Ereignisstrom /strom mischt sie an Nachrichtengrenzen eigene Ereignisse: proj (Spec 3.4), /zustand/arr und
// /pegel spur/<n> (Spec 3.1). Der Transport ist simuliert: Projekt-Beat läuft mit dem Master-Tempo aus /uhr.
// Nicht in server.ts (Auftrag V1). Kein Kern, kein Ton.
// Befehle flach {befehl: 'spur_neu', …} wie S2 (commands.ts); Ablehnungsgründe und Wertebereiche wie S2 und Spec §4 (siehe wende()).
// Steuerung für Proben: POST /attrappe/weg {an} (Ausfall: /proj/* 503 ohne Grund, Strom gekappt) · POST /attrappe/lauf {art} (Freeze-Durchlauf: art 'freeze', null beendet) · POST /attrappe/ausgabe {…} (Freeze/Export, siehe unten) · POST /attrappe/kernantwort {kern} (einmalig: die nächste angenommene Änderung antwortet mit diesem kern) · POST /attrappe/saat {projekt} · POST /attrappe/sse {a, f} · POST /attrappe/stumm {ms} · POST /attrappe/transportantwort {quittung} (einmalig: null = der Kern antwortet nicht) · POST /attrappe/rohantwort {weg, code, koerper} (einmalig, roh) · POST /attrappe/katalog {eintraege: [{sha, typ, bpm, takte, dauer_s, instrument?, kategorie?, karte?, traktor?}]} (Tempo-Angaben der Library für warp 'auto', Paket 1.13) · GET /attrappe/log.
// Direkt: node check/proj_mock.mjs <oben-url> [port]
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// D1 V2: Clip- und Notenbefehle rechnet die Attrappe mit dem echten S2-Kern (project/commands.ts, reine Funktionen), statt sie
// nachzubauen: so prüft die Browserprobe die Seite gegen dieselben Regeln, Gründe, HTTP-Codes und IDs wie der Server.
import { fuehreAus, BefehlFehler, vergleiche } from '../project/commands.ts';
import { neueId, LOOP_MIN, MAX_SPUREN, warpPruefung } from '../project/model.ts';
import { abHierStart, autoWarp, fensterTempo, handWarp } from '../project/warp.ts';
import { grundCode } from '../areas/proj/mapping.ts';
import { routingMatrix } from '../project/routing_matrix.ts';
import { baueResampleProjekt, ResampleFehler, resamplePlan } from '../project/resample.ts';   // 1.10 slice 7 (T6)
import { grundText } from '../http/reasons.ts';
import { planeAnwendung, werteVonZiel } from '../presets/apply.ts';   // 1.16 rest U7: the preset plan routes (see presetPlan below)
import { PresetFehler } from '../presets/model.ts';

const FARBEN = ['#e0563b', '#e0a33e', '#d6c94a', '#58d66b', '#2fd6c3', '#3b8de0', '#8c9bff', '#9b59d0'];
const KOERPER_MAX = 1024 * 1024;   // Spec 3.4: Körperlimit /proj/aendern 1 MiB
const kopie = (x) => JSON.parse(JSON.stringify(x));
// text (V2 Fix F12): englischer Text der Antwort wie der Server (areas/proj/session.ts); ohne text steht dort wie bisher der Grund
// D1 S3 (Spec 6.34, Auftrag 14 c): ohne eigenen Text trägt die Antwort den englischen Text des Servers (http/reasons.ts), nie den Grund selbst
class Fehl extends Error { constructor(code, fehler, text) { super(text ?? grundText(fehler)); this.code = code; this.fehler = fehler; } }

export function neuesProjekt(name) {
  return { format: 'cypherdj-projekt/2', name, rev: 1, wiedergabe_rev: 1, tempo_bpm: 120, taktart: [4, 4],
    loop: { an: false, von_beat: 0, bis_beat: 32 }, metronom: { an: false, pegel_db: -12, ziel: 'master' }, spuren: [], gruppen: [], master: { fader_db: 0 } };
}

export async function starteProjAttrappe({ oben, port = 0, dekodierMs = 300, freezeMs = 1200, renderMs = 600 }) {
  const z = { aenderungen: [], projekte: new Map(), stapel: new Map(), slug: null, id: 0, log: [], stroeme: new Set(), fertig: new Set(),
    transport: null, stoppBeat: 0, masterBpm: null,
    lauf: null, kennungen: new Map(), exporte: new Set(),   // D1 V2 Slice 3: Freeze/Export nach dem S3-Plan
    ausgabe: { freezeMs, renderMs, spitze_db: -6.02, lufs_i: -14.2, lra: 5.1, true_peak_dbtp: -1.0, regler_quelle: 'kern', ueber_decke: false, limiter_db_max: 0, loudness_fehler: null, fehler: null },
    gespeichertePresets: [],   // 1.16 rest U7: what POST /presets/von_ziel would have saved (see presetPlan)
    katalog: new Map(),   // Paket 1.13: sha → {typ, bpm, takte, dauer_s, instrument, kategorie} (Slice 2 D10: Drum-Loops RE-PITCH, sonst COMPLEX), die Tempo-Angaben, aus denen der Server warp 'auto' auflöst (POST /attrappe/katalog)
    dekodierUhren: new Set() };   // V2 Fix-Runde 2 H9: laufende Dekodier-Timer; stoppe() beendet sie (dekodierMs 60000 hielt den Testprozess ~62 s am Leben)
  // D1 V2 Nachzug (7f, Spec 6.23, 6.31, 6.32): läuft ein Freeze-Durchlauf (z.lauf.durchlauf, ab V2 Slice 3 vom simulierten Freeze gesetzt;
  // für Proben auch über POST /attrappe/lauf {art}), antworten Transport-Start, Öffnen, Anlegen, jede Änderung an Wiedergabe, Tempo oder Loop
  // und Undo/Redo einer solchen Änderung mit 409 beschaeftigt. Mixer (spur_aendern ohne Gerät) und Metronom bleiben erlaubt, Stopp auch.
  // Die Render-Phase eines Exports ist kein Freeze (Spec 6.23 sperrt nur den Durchlauf): dort lädt die Attrappe weiter; nur ein zweiter
  // Freeze oder Export ist während des ganzen Laufs (z.lauf) gesperrt.
  const freezeLaeuft = () => !!z.lauf?.durchlauf;
  const SPERRE_WIEDERGABE = 'a freeze is running; changes to the playback wait until it is done';   // Text wie areas/proj/session.ts
  const nurMixer = (b) => b?.befehl === 'metronom_setzen' || b?.befehl === 'gruppenspur_aendern' || b?.befehl === 'master_aendern' || b?.befehl === 'return_aendern' || b?.befehl === 'send_setzen' || b?.befehl === 'insert_an' || (b?.befehl === 'insert_param_setzen' && b.param !== 'sc') || (b?.befehl === 'spur_aendern' && b.geraet === undefined);   // slice 4a: knob and bypass of an insert stage are live only (commands.ts istLeicht)
  const json = (a, code, j) => { a.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); a.end(JSON.stringify(j)); };
  const sende = (n) => { const t = `data: ${JSON.stringify(n)}\n\n`; for (const s of z.stroeme) s.a.write(t); };
  const aktuell = () => { if (!z.slug) throw new Fehl(409, 'kein_projekt'); return z.projekte.get(z.slug); };
  const stapelVon = (slug) => { if (!z.stapel.has(slug)) z.stapel.set(slug, { verlauf: [], getan: [], rueck: [] }); return z.stapel.get(slug); };
  const spurVon = (p, id) => { const s = p.spuren.find((x) => x.id === id); if (!s) throw new Fehl(400, 'spur_unbekannt'); return s; };
  const fertigMarken = (p) => { for (const s of p.spuren) for (const c of s.clips) if (c.art === 'audio' && z.fertig.has(c.quelle.sha256)) c.dekodiert = 'fertig'; return p; };

  function slugVon(name) {
    const basis = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'projekt';
    let s = basis;
    for (let n = 2; z.projekte.has(s); n++) s = `${basis}-${n}`;
    return s;
  }

  // Gründe und Wertebereiche wie S2 (djk/ui/project/commands.ts, Zweig d1-projekt) und Spec §4 (fader_db −200..+6,
  // pan −1..+1, pegel_db −60..0). Clip- und Notenbefehle rechnet S2 selbst (mitS2, D1 V2).
  // D1 V2: diese Befehle (und clip_neu für MIDI) laufen über S2 fuehreAus; dessen Ablehnung kommt mit S2-Grund und Server-Code zurück
  // V2 Fix F13: tempo_setzen auch über S2, damit ein anderes Tempo Freezes verwirft wie dort (commands.ts verwerfeFreezes)
  const S2_BEFEHLE = new Set(['auto_neu', 'auto_punkte', 'auto_loeschen', 'auto_aendern', 'clip_aendern', 'clip_teilen', 'clip_duplizieren', 'clip_loeschen', 'noten_neu', 'noten_aendern', 'noten_loeschen', 'tempo_setzen', 'variante_waehlen',
  'gruppenspur_neu', 'gruppenspur_aendern', 'gruppenspur_loeschen', 'ziel_setzen', 'master_aendern', 'return_neu', 'return_aendern', 'return_loeschen', 'send_setzen', 'insert_setzen', 'duck_durch_kick', 'insert_param_setzen', 'insert_an', 'insert_entfernen', 'insert_ordnung', 'rack_setzen', 'rack_makro', 'makro_variation_speichern', 'makro_variation_laden', 'makro_variation_loeschen', 'warp_setzen', 'warp_auto', 'warp_tempo', 'warp_marker', 'warp_ab_hier', 'eins_hier', 'tempo_vom_clip', 'audio_quantisieren', 'auto_neu', 'auto_punkte', 'auto_loeschen', 'take_neu', 'take_umbenennen', 'take_loeschen', 'comp_waehlen', 'aufnahme_setzen',   // 1.14: take lanes (S2 computes them); Paket 1.18 E-c: variante_waehlen rechnet S2; 1.10: Gruppen, Ziel und Master rechnet S2; 1.13: Warp rechnet S2
  'auto_vereinfachen', 'auto_dehnen', 'auto_neigen', 'auto_form', 'huellkurve_setzen', 'huellkurve_loeschen', 'insert_werte_setzen']);   // 1.12 slices 4 and 5 (S2 computes them)
  const ueberS2 = (b) => S2_BEFEHLE.has(b?.befehl) || (b?.befehl === 'clip_neu' && b.art === 'midi') || (b?.befehl === 'spur_aendern' && b.geraet !== undefined);   // 1.16 rest U7: a device change (preset apply) is S2's
  function mitS2(p, b) {
    try { return fuehreAus(p, b).projekt; } catch (e) { if (e instanceof BefehlFehler) throw new Fehl(grundCode(e.grund), e.grund); throw e; }
  }
  // Paket 1.13 (N4-1): was session.ts loeseQuellenAuf für den Warp tut, mit den Tempo-Angaben aus z.katalog statt aus dem Katalog des Servers.
  // clip_neu mit warp 'auto': Warp und Länge in Beats aus der Library (autoWarp), sonst warp 'aus' (One-Shot, kein Tempo, Hinweis kein_tempo; eine sha
  // ohne Eintrag zählt als Eintrag ohne Tempo, die Attrappe nahm schon immer jede sha). warp_auto auf einem vorhandenen Clip wird zu warp_setzen mit
  // dem Warp aus der Library (die Länge bleibt); ohne Tempo antwortet sie mit dem Grund kein_tempo, für einen Clip derselben Liste mit warp_auto_neuer_clip.
  const tempoVon = (sha) => z.katalog.get(sha) ?? { typ: null, bpm: null, takte: null, dauer_s: null };
  function loeseWarp(p, befehle) {
    const hinweise = [];
    const clips = p.spuren.flatMap((s) => s.clips);
    const aus = befehle.map((b, index) => {
      if (b?.befehl === 'warp_auto' && typeof b.clip_id === 'string') {
        const g = clips.find((c) => c.id === b.clip_id);
        if (!g && befehle.slice(0, index).some((v) => v?.befehl === 'clip_neu')) throw new Fehl(409, 'warp_auto_neuer_clip');
        if (g?.art !== 'audio') return b;   // S2 meldet clip_unbekannt bzw. feld_nur_audio
        const r = autoWarp(tempoVon(g.quelle.sha256));
        if (r === null || 'hinweis' in r) throw new Fehl(409, 'kein_tempo');
        const { clip_id, ...rest } = b;
        return { ...rest, befehl: 'warp_setzen', clip_id, warp: r.warp };
      }
      // Slice 3b: wie session.ts loeseQuellenAuf, gegen den Stand VOR der Liste (die Attrappe kennt keinen Zwischenstand)
      if (b?.befehl === 'eins_hier') hinweise.push({ index, hinweis: 'eins_nur_hier' });   // die Attrappe hat keinen Bestand: kein Rückweg
      if (b?.befehl === 'tempo_vom_clip' && typeof b.clip_id === 'string') {
        const g = clips.find((c) => c.id === b.clip_id);
        return g?.art === 'audio' && g.warp ? { befehl: 'tempo_setzen', bpm: fensterTempo(g.warp, g.loop_beats ?? g.laenge_beats) } : b;
      }
      if (b?.befehl === 'warp_ab_hier' && b.art === 'start' && typeof b.clip_id === 'string' && typeof b.beat === 'number') {
        const g = clips.find((c) => c.id === b.clip_id);
        if (g?.art !== 'audio' || !g.warp) return b;
        const r = autoWarp(tempoVon(g.quelle.sha256));
        const marker = r !== null && 'warp' in r ? abHierStart(g.warp.marker, b.beat, r.warp.marker) : null;
        if (marker === null) throw new Fehl(409, 'kein_tempo');
        return { befehl: 'warp_setzen', clip_id: b.clip_id, warp: handWarp(g.warp, marker) };
      }
      // Slice 4 (D8), wie session.ts loeseQuellenAuf: Quantize Audio braucht die Transienten der dekodierten Quelle. Die Attrappe dekodiert nichts, also lehnt sie ab,
      // sobald Felder, Clip und Werte stimmen (409 transienten_fehlen); alles davor meldet S2 (argument_unbekannt, clip_unbekannt, kein_warp).
      if (b?.befehl === 'audio_quantisieren' && typeof b.clip_id === 'string') {
        const g = Object.keys(b).every((k) => ['befehl', 'clip_id', 'raster', 'staerke', 'von_beat', 'bis_beat'].includes(k)) ? clips.find((c) => c.id === b.clip_id) : undefined;
        if (g?.art !== 'audio' || !g.warp) return b;
        if (!['1/4', '1/8', '1/16', '1/32'].includes(b.raster)) throw new Fehl(400, 'argument_ungueltig');
        if (b.staerke !== undefined && !(typeof b.staerke === 'number' && b.staerke >= 0 && b.staerke <= 1)) throw new Fehl(400, 'argument_ungueltig');
        for (const k of ['von_beat', 'bis_beat']) if (b[k] !== undefined && !(typeof b[k] === 'number' && Number.isFinite(b[k]))) throw new Fehl(400, 'argument_ungueltig');
        throw new Fehl(409, 'transienten_fehlen');
      }
      if (b?.befehl !== 'clip_neu' || b.art !== 'audio' || b.warp !== 'auto') return b;
      const r = autoWarp(tempoVon(b.sha256));
      if (r !== null && 'warp' in r) return { ...b, warp: r.warp, laenge_beats: r.laenge_beats };
      if (r !== null) hinweise.push({ index, hinweis: r.hinweis });
      return { ...b, warp: 'aus' };
    });
    return { befehle: aus, hinweise };
  }
  const zahlOk = (x) => typeof x === 'number' && Number.isFinite(x);
  const ab = (grund, code = 400) => { throw new Fehl(code, grund); };
  const erlaube = (b, ...namen) => { for (const k of Object.keys(b)) if (k !== 'befehl' && !namen.includes(k)) ab('argument_unbekannt'); };
  const zahl = (b, k, min, max, { offenUnten = false } = {}) => { const x = b[k]; if (!zahlOk(x) || x > max || (offenUnten ? x <= min : x < min)) ab('argument_ungueltig'); return x; };
  const flagge = (b, k) => (typeof b[k] === 'boolean' ? b[k] : ab('argument_ungueltig'));
  const text = (b, k, max) => (b[k] === undefined ? undefined : (typeof b[k] === 'string' && b[k].trim().length >= 1 && b[k].length <= max ? b[k] : ab('argument_ungueltig')));

  function baueGeraet(p, g) {
    if (g === null || typeof g !== 'object' || Array.isArray(g)) ab('argument_ungueltig');
    if (g.art === 'intern') {
      erlaube(g, 'art', 'name', 'parameter');
      if (g.name !== undefined && g.name !== 'rb338') ab('argument_ungueltig');
      return { art: 'intern', name: 'rb338', parameter: kopie(g.parameter ?? {}) };
    }
    if (g.art === 'wirt') {
      erlaube(g, 'art', 'name', 'slot');
      if (g.name !== undefined && g.name !== 'surge') ab('argument_ungueltig');
      const belegt = new Set(p.spuren.filter((s) => s.geraet?.art === 'wirt').map((s) => s.geraet.slot));
      let slot = g.slot;
      // 1.9 U3 (L10): two hosts, slots 1 and 2; the first free slot, a taken slot or a third Surge track is slot_belegt like the real server
      if (slot === undefined) { slot = [1, 2].find((n) => !belegt.has(n)); if (slot === undefined) ab('slot_belegt', 409); }
      else if (!Number.isInteger(slot) || slot < 1 || slot > 2) ab('argument_ungueltig');
      else if (belegt.has(slot)) ab('slot_belegt', 409);
      return { art: 'wirt', name: 'surge', slot };
    }
    return ab('argument_ungueltig');
  }

  function wende(p, b) {
    if (b === null || typeof b !== 'object' || typeof b.befehl !== 'string') ab('befehl_unbekannt');
    switch (b.befehl) {
      case 'spur_neu': {
        erlaube(b, 'art', 'name', 'geraet');
        const art = b.art;
        if (art !== 'audio' && art !== 'instrument') ab('argument_ungueltig');
        if (art === 'audio' && b.geraet !== undefined) ab('argument_ungueltig');
        if (p.spuren.length >= MAX_SPUREN) ab('spur_bereich', 409);
        const nr = Array.from({ length: MAX_SPUREN }, (_, i) => i + 1).find((n) => !p.spuren.some((s) => s.nr === n));
        const g = art === 'instrument' ? baueGeraet(p, b.geraet ?? { art: 'intern' }) : undefined;
        const name = text(b, 'name', 80) ?? (art === 'audio' ? `Audio ${nr}` : g.art === 'intern' ? 'RB-338' : 'Surge');
        const spur = { id: `s${++z.id}`, nr, name, farbe: FARBEN[(nr - 1) % FARBEN.length], art,
          ...(g ? { geraet: g } : {}), ...(g?.art === 'wirt' ? { freeze: null } : {}), fader_db: 0, pan: 0, mute: false, solo: false, clips: [] };
        p.spuren.push(spur);
        return;
      }
      case 'spur_aendern': {
        erlaube(b, 'spur_id', 'name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'geraet');
        const s = spurVon(p, b.spur_id);
        if (b.geraet !== undefined) ab('nicht_in_attrappe');
        if (['name', 'farbe', 'fader_db', 'pan', 'mute', 'solo'].every((k) => b[k] === undefined)) ab('argument_ungueltig');
        const neu = {};
        if (b.name !== undefined) neu.name = text(b, 'name', 80);
        if (b.farbe !== undefined) neu.farbe = typeof b.farbe === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.farbe) ? b.farbe : ab('argument_ungueltig');
        if (b.fader_db !== undefined) neu.fader_db = zahl(b, 'fader_db', -200, 6);
        if (b.pan !== undefined) neu.pan = zahl(b, 'pan', -1, 1);
        if (b.mute !== undefined) neu.mute = flagge(b, 'mute');
        if (b.solo !== undefined) neu.solo = flagge(b, 'solo');
        Object.assign(s, neu);
        return;
      }
      case 'spur_loeschen': {
        erlaube(b, 'spur_id');
        p.spuren.splice(p.spuren.indexOf(spurVon(p, b.spur_id)), 1);
        return;
      }
      case 'spur_verschieben': {
        erlaube(b, 'spur_id', 'index');
        const s = spurVon(p, b.spur_id);
        if (!Number.isInteger(b.index)) ab('argument_ungueltig');
        if (b.index < 0 || b.index >= p.spuren.length) ab('index_bereich');
        p.spuren.splice(p.spuren.indexOf(s), 1);
        p.spuren.splice(b.index, 0, s);
        return;
      }
      case 'clip_neu': {
        erlaube(b, 'spur_id', 'art', 'start_beat', 'laenge_beats', 'loop_beats', 'sha256', 'name', 'pfad_hinweis', 'noten', 'warp');
        const s = spurVon(p, b.spur_id);
        if (b.art !== 'audio' && b.art !== 'midi') ab('argument_ungueltig');
        if (b.art !== (s.art === 'audio' ? 'audio' : 'midi')) ab('art_passt_nicht');
        const start = zahl(b, 'start_beat', 0, 100000), laenge = zahl(b, 'laenge_beats', 0, 100000, { offenUnten: true });
        if (typeof b.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(b.sha256)) ab('sha_ungueltig');
        // D1 V2 (Spec 6.17): loop_beats wie S2 clip_neu, 1/16 ≤ x ≤ laenge_beats, null oder fehlend = kein Loop
        const loop = b.loop_beats === undefined || b.loop_beats === null ? null : zahl(b, 'loop_beats', LOOP_MIN, 100000);
        if (loop !== null && loop > laenge + 1e-9) ab('argument_ungueltig');
        // Paket 1.13: warp fehlt, null oder 'aus' = ohne Warp; ein Objekt prüft warpPruefung wie S2 (Grund und Code wie der Server); 'auto' kam schon aufgelöst
        if (b.warp === 'auto') ab('argument_ungueltig');
        const f = b.warp === undefined || b.warp === null || b.warp === 'aus' ? null : warpPruefung(b.warp);
        if (f) throw new Fehl(grundCode(f.grund), f.grund, f.text);
        const warp = b.warp !== null && typeof b.warp === 'object' ? kopie(b.warp) : null;
        const id = neueId(p, 'clip');   // D1 V2: dasselbe ID-Schema wie S2 (Zähler naechste_id), sonst kollidiert es mit S2-Duplikaten
        // Name wie S2 (commands.ts clip_neu): name, sonst Dateiname aus pfad_hinweis ohne Endung, sonst „Audio“
        const hinweis = b.pfad_hinweis === undefined ? '' : (typeof b.pfad_hinweis === 'string' && b.pfad_hinweis.length <= 4096 ? b.pfad_hinweis : ab('argument_ungueltig'));
        const vonPfad = hinweis.split('/').pop()?.replace(/\.[^.]*$/, '').slice(0, 80);
        s.clips.push({ id, art: 'audio', name: text(b, 'name', 80) ?? (vonPfad || 'Audio'), start_beat: start, laenge_beats: laenge,
          quelle: { sha256: b.sha256, pfad_hinweis: hinweis }, dekodiert: z.fertig.has(b.sha256) ? 'fertig' : 'laeuft',
          offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0, ...(loop === null ? {} : { loop_beats: loop }), ...(warp === null ? {} : { warp }) });
        if (!z.fertig.has(b.sha256)) {
          const slug = z.slug;
          const dek = setTimeout(() => {
            z.dekodierUhren.delete(dek);
            z.fertig.add(b.sha256);
            const c = z.projekte.get(slug)?.spuren.flatMap((x) => x.clips).find((x) => x.id === id);
            if (c) { c.dekodiert = 'fertig'; sende({ a: 'proj', f: { clip_id: id, dekodiert: 'fertig' } }); }
          }, dekodierMs);
          z.dekodierUhren.add(dek);
        }
        return;
      }
      case 'loop_setzen': {
        erlaube(b, 'an', 'von_beat', 'bis_beat');
        const an = flagge(b, 'an'), von = zahl(b, 'von_beat', 0, 100000), bis = zahl(b, 'bis_beat', 0, 100000);
        if (bis - von < 1) ab('loop_bereich');
        p.loop = { an, von_beat: von, bis_beat: bis };
        return;
      }
      case 'metronom_setzen': {
        erlaube(b, 'an', 'pegel_db', 'ziel');
        if (['an', 'pegel_db', 'ziel'].every((k) => b[k] === undefined)) ab('argument_ungueltig');
        const an = b.an === undefined ? undefined : flagge(b, 'an'), pegel = b.pegel_db === undefined ? undefined : zahl(b, 'pegel_db', -60, 0);
        if (b.ziel !== undefined && b.ziel !== 'master' && b.ziel !== 'cue') ab('argument_ungueltig');
        if (an !== undefined) p.metronom.an = an;
        if (pegel !== undefined) p.metronom.pegel_db = pegel;
        if (b.ziel !== undefined) p.metronom.ziel = b.ziel;
        return;
      }
      default: return ab('befehl_unbekannt');
    }
  }

  // Eine Änderung (aendern, undo, redo) als Verlaufszeile; neu ist der Stand danach (rev wird hier gesetzt)
  function bucheEin(slug, art, label, quelle, vorher, neu) {
    const st = stapelVon(slug);
    neu.rev = vorher.rev + 1;
    z.projekte.set(slug, neu);
    const e = { rev: neu.rev, zeit: Date.now(), quelle, label, art, vorher: kopie(vorher), nachher: kopie(neu) };
    st.verlauf.push(e);
    sende({ a: 'proj', f: { slug, rev: neu.rev, label, quelle } });
    return e;
  }

  async function koerper(q) {
    let n = 0; const teile = [];
    for await (const d of q) { n += d.length; if (n > KOERPER_MAX) throw new Fehl(413, 'zu_gross'); teile.push(d); }
    try { return n ? JSON.parse(Buffer.concat(teile).toString('utf8')) : {}; } catch { throw new Fehl(400, 'json'); }
  }

  async function proj(q, a, u) {
    const quelle = q.headers['x-djk-quelle'] === 'cypher' ? 'cypher' : 'andreas';
    const weg = u.pathname;
    let d = {};
    if (q.method === 'POST') {
      if (!String(q.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new Fehl(415, 'json_erwartet');
      d = await koerper(q);
    }
    z.log.push({ t: Date.now(), methode: q.method, weg, koerper: d, quelle });
    if (q.method === 'GET' && weg === '/attrappe/log') return json(a, 200, z.log);
    if (q.method === 'GET' && weg === '/attrappe/aenderungen') return json(a, 200, z.aenderungen);
    // V2 Fix F3: POST /attrappe/rohantwort {weg, code, koerper} (einmalig): die nächste Anfrage auf weg antwortet roh mit code, Körper koerper als JSON
    // oder leer (null), etwa 503 ohne Körper oder 502 nur mit text, wie ein Vermittler oder ein abgestürzter Server; {weg: null} nimmt es zurück
    if (q.method === 'POST' && weg === '/attrappe/rohantwort') { z.roh = d.weg ? { weg: d.weg, code: d.code, koerper: d.koerper ?? null } : null; return json(a, 200, { ok: true }); }
    if (z.roh && z.roh.weg === weg) {
      const r = z.roh; z.roh = null;
      a.writeHead(r.code, r.koerper === null ? {} : { 'content-type': 'application/json' }); a.end(r.koerper === null ? '' : JSON.stringify(r.koerper));
      return undefined;
    }
    if (q.method === 'POST' && weg === '/attrappe/sse') { sende({ a: d.a, f: d.f }); return json(a, 200, { ok: true }); }
    if (q.method === 'POST' && weg === '/attrappe/stumm') { z.stummBis = Date.now() + Number(d.ms ?? 0); return json(a, 200, { ok: true }); }   // /zustand/arr aussetzen (Hochrechnung der Seite prüfen)
    if (q.method === 'POST' && weg === '/attrappe/weg') {   // Ausfall: /proj/* antwortet 503, der Strom wird gekappt und lässt sich nicht neu öffnen, bis {an: false}
      z.weg = d.an === true;
      if (z.weg) for (const s of [...z.stroeme]) s.a.destroy();
      return json(a, 200, { ok: true });
    }
    if (z.weg && weg.startsWith('/proj/')) return json(a, 503, { text: 'server weg (Attrappe)' });   // D1 V2 Nachzug (7b): ein toter Server nennt keinen Grund
    if (q.method === 'POST' && weg === '/attrappe/lauf') { z.lauf = d.art ? { art: d.art, durchlauf: { t0: Date.now(), ms: 1e9, von: 0, bis: 0 } } : null; return json(a, 200, { ok: true }); }   // D1 V2 Nachzug (7f): Freeze-Lauf für Proben
    if (q.method === 'POST' && weg === '/attrappe/kernantwort') { z.kernAntwort = d.kern ?? null; return json(a, 200, { ok: true }); }   // D1 V2 Nachzug (7c): nächste angenommene Änderung trägt dieses kern
    if (q.method === 'POST' && weg === '/attrappe/transportantwort') { z.transportAntwort = { quittung: d.quittung ?? null }; return json(a, 200, { ok: true }); }   // nächste /proj/transport-Anfrage: diese Quittung, nichts gestartet
    if (q.method === 'POST' && weg === '/attrappe/katalog') {   // Paket 1.13: Tempo-Angaben der Library (ersetzt die bisherigen), Grundlage von warp 'auto' und warp_auto
      z.katalog = new Map((Array.isArray(d.eintraege) ? d.eintraege : []).map((e) => [e.sha, { typ: e.typ ?? null, bpm: e.bpm ?? null, takte: e.takte ?? null, dauer_s: e.dauer_s ?? null, instrument: e.instrument ?? null, kategorie: e.kategorie ?? null, karte: e.karte ?? null, traktor: e.traktor ?? null }]));
      return json(a, 200, { ok: true, n: z.katalog.size });
    }
    if (q.method === 'POST' && weg === '/attrappe/saat') {
      const slug = slugVon(d.projekt?.name ?? 'saat');
      z.projekte.set(slug, fertigMarken(kopie(d.projekt))); z.slug = slug;
      return json(a, 200, { slug, projekt: z.projekte.get(slug) });
    }
    if (q.method === 'GET' && weg === '/proj/liste') return json(a, 200, [...z.projekte.entries()].map(([slug, p]) => ({ slug, name: p.name, geaendert: stapelVon(slug).verlauf.at(-1)?.zeit ?? 0 })));
    if (q.method === 'GET' && weg === '/proj/aktuell') {   // ohne offenes Projekt: 200 mit null (Festlegung V1, Spec 3.4 offen)
      // V2 Fix F14 (Spec 6.34): ausgabe_lauf {art: 'freeze', spur_id} | {art: 'export'} | null, damit ein Reload mitten im Lauf ihn sieht
      const ausgabe_lauf = z.lauf ? (z.lauf.art === 'freeze' && typeof z.lauf.spur_id === 'string' ? { art: 'freeze', spur_id: z.lauf.spur_id }
        : z.lauf.art === 'resample' ? { art: 'resample', strang_id: z.lauf.strang_id } : { art: z.lauf.art }) : null;   // 1.10 slice 7: resample names its strip
      if (!z.slug) return json(a, 200, { slug: null, projekt: null, kern: null, ausgabe_lauf });
      const p = aktuell();
      return json(a, 200, { slug: z.slug, projekt: p, kern: { rev_geladen: p.wiedergabe_rev, status: freezeLaeuft() || z.lauf?.art === 'resample' ? 3 : z.transport ? 2 : 0 }, ausgabe_lauf });
    }
    if (q.method === 'GET' && weg === '/proj/routing') {   // 1.10 slice 6: the real function over the stand-in's project, like the page server
      if (!z.slug) return json(a, 200, { slug: null });
      try { return json(a, 200, { slug: z.slug, ...routingMatrix(aktuell(), u.searchParams.get('optionen') ?? undefined) }); } catch (e) {
        if (e instanceof BefehlFehler) throw new Fehl(400, e.grund, e.detail);
        throw e;
      }
    }
    if (q.method === 'GET' && weg === '/proj/verlauf') { aktuell(); return json(a, 200, stapelVon(z.slug).verlauf.map(({ rev, zeit, quelle: qu, label, art }) => ({ rev, zeit, quelle: qu, label, art }))); }
    if (q.method === 'POST' && (weg === '/proj/neu' || weg === '/proj/oeffnen') && freezeLaeuft()) throw new Fehl(409, 'beschaeftigt', 'a freeze is running; opening or creating a project waits until it is done');   // Spec 6.31, Text wie session.ts
    if (q.method === 'POST' && weg === '/proj/neu') {
      if (typeof d.name !== 'string' || d.name.trim().length < 1 || d.name.trim().length > 80) throw new Fehl(400, 'name_ungueltig');   // wie S2 (storage.ts lege)
      const slug = slugVon(d.name);
      z.projekte.set(slug, neuesProjekt(d.name.trim())); z.slug = slug; z.transport = null;
      return json(a, 200, { slug, projekt: z.projekte.get(slug) });
    }
    if (q.method === 'POST' && weg === '/proj/oeffnen') {
      if (!z.projekte.has(d.slug)) throw new Fehl(404, 'unbekannt');
      z.slug = d.slug; z.transport = null;
      return json(a, 200, { slug: z.slug, projekt: z.projekte.get(z.slug) });
    }
    if (q.method === 'POST' && weg === '/proj/aendern') {
      const p = aktuell();
      if (d.rev !== p.rev) throw new Fehl(409, 'rev_veraltet');
      if (typeof d.label !== 'string' || d.label.trim() === '' || d.label.length > 200) throw new Fehl(400, 'label_ungueltig');   // wie S2 (history.ts pruefeMeta)
      if (!Array.isArray(d.befehle) || d.befehle.length === 0) throw new Fehl(400, 'befehle_fehlen');
      const mixer = d.befehle.every(nurMixer);
      if (freezeLaeuft() && !mixer) throw new Fehl(409, 'beschaeftigt', SPERRE_WIEDERGABE);   // D1 V2 Nachzug (7f, Spec 6.23)
      let neu = kopie(p);
      const { befehle, hinweise } = loeseWarp(p, d.befehle);   // Paket 1.13: warp 'auto' und warp_auto aus den Tempo-Angaben der Library
      for (const b of befehle) { if (ueberS2(b)) neu = mitS2(neu, b); else wende(neu, b); }   // wirft vor dem Buchen: die ganze Änderung oder nichts
      const st = stapelVon(z.slug);
      const e = bucheEin(z.slug, 'aendern', d.label, quelle, p, neu);
      e.nurMixer = mixer;   // Undo/Redo davon bleibt während eines Freeze erlaubt (Spec 6.23)
      z.aenderungen.push({ rev: neu.rev, befehle: befehle.map((b) => b.befehl), wiedergabe: vergleiche(p, neu).betrifft_wiedergabe });   // slice 4a: would the server start a new playback? (GET /attrappe/aenderungen)
      st.getan.push(e); st.rueck.length = 0;
      const kern = z.kernAntwort; z.kernAntwort = null;
      return json(a, 200, { rev: neu.rev, projekt: neu, ...(kern ? { kern } : {}), ...(hinweise.length ? { hinweise } : {}) });
    }
    if (q.method === 'POST' && (weg === '/proj/undo' || weg === '/proj/redo')) {
      const p = aktuell();
      if (d.rev !== p.rev) throw new Fehl(409, 'rev_veraltet');
      const st = stapelVon(z.slug), undo = weg === '/proj/undo';
      if (freezeLaeuft() && (undo ? st.getan : st.rueck).at(-1)?.nurMixer === false) throw new Fehl(409, 'beschaeftigt', SPERRE_WIEDERGABE);   // D1 V2 Slice 3 (Spec 6.23: auch Undo/Redo)
      const x = (undo ? st.getan : st.rueck).pop();
      if (!x) throw new Fehl(409, 'nichts_zu_tun');
      const neu = fertigMarken(kopie(undo ? x.vorher : x.nachher));
      bucheEin(z.slug, undo ? 'undo' : 'redo', `${undo ? 'Undo' : 'Redo'}: ${x.label}`, quelle, p, neu);   // Präfix im Label wie S2 (history.ts protokolliere)
      (undo ? st.rueck : st.getan).push(x);
      return json(a, 200, { rev: neu.rev, projekt: neu });
    }
    if (q.method === 'POST' && weg === '/proj/transport') {
      aktuell();
      if (d.aktion === 'start' && freezeLaeuft()) throw new Fehl(409, 'beschaeftigt', 'a freeze is running; transport start waits until it is done');   // D1 V2 Nachzug (7f, Spec 6.32): ein Freeze ist ein Transport-Lauf
      if (z.transportAntwort) { const t = z.transportAntwort; z.transportAntwort = null; return json(a, 200, { ok: true, quittung: t.quittung }); }
      if (d.aktion === 'start') { z.transport = { t0: Date.now(), beat0: Number(d.beat ?? 0) }; return json(a, 200, { ok: true, quittung: { status: 3, grund: '' } }); }
      if (d.aktion === 'stopp') { z.stoppBeat = beatJetzt() ?? z.stoppBeat; z.transport = null; meldeArr(); pegel(); return json(a, 200, { ok: true, quittung: { status: 3, grund: '' } }); }
      throw new Fehl(400, 'aktion_unbekannt');
    }
    if (q.method === 'POST' && weg === '/attrappe/ausgabe') { Object.assign(z.ausgabe, d); return json(a, 200, { ok: true, ausgabe: z.ausgabe }); }
    if (q.method === 'POST' && weg === '/proj/freeze') return json(a, 200, await freeze(d, quelle));
    if (q.method === 'POST' && weg === '/proj/export') return json(a, 200, await exportiere(d, quelle));
    if (q.method === 'POST' && weg === '/proj/resample') return json(a, 200, await resample(d, quelle));   // 1.10 slice 7 (T6)
    // 1.14 slice 4 (probe_bounce.mjs): POST /proj/bounce is recorded (z.log above) and answered without a change, in the answer shape of spec R10
    if (q.method === 'POST' && weg === '/proj/bounce') {
      const p = aktuell();
      return json(a, 200, { art: d.art, rev: p.rev, projekt: p, spur_id: d.spur_id ?? d.ziel_spur_id ?? null, clip_id: null, datei: '', frames: 0,
        quellen: d.spur_ids ?? (d.spur_id ? [d.spur_id] : []) });
    }
    throw new Fehl(404, 'nicht_gefunden');
  }

  // ---- D1 V2 Slice 3: Freeze und Export (Spec 2.5, 3.4, Paket S3), simuliert nach dem S3-Plan (d1-export-api, 2026-10-15-d1-s3-export-api.md):
  // Reihenfolge der Prüfungen, Gründe und HTTP-Codes wie areas/proj/output.ts (STATUS: 400 Argument/Inhalt, 409 Zustand, 502 Kern/Render),
  // Bereich wie project/freeze.ts freezeBereich, /e/freeze mit 2 Beats Nachlauf, Export-Antwort mit regler_quelle und Lautheit (6.20, R9),
  // Dateiname <slug>-<JJJJMMTT-hhmmss>.wav (bei Gleichstand -2, -3). Der Durchlauf erscheint als /zustand/arr status 3 mit laufendem
  // projekt_beat. Steuerung: POST /attrappe/ausgabe {freezeMs, renderMs, spitze_db, lufs_i, lra, true_peak_dbtp, regler_quelle, ueber_decke, limiter_db_max, fehler}; fehler
  // (bleibt, bis null) ist einer der Gründe deck_laeuft, kein_kernstand (vor dem Durchlauf), freeze_fehler, veraltet (danach), render_fehler,
  // oder oeffnet bzw. tempo_rampe (beide: 409 beschaeftigt mit dem Text des Servers, V2 Fix F12).
  const AUSGABE_CODE = { argument_ungueltig: 400, export_bereich: 400, spur_unbekannt: 400, keine_wirtspur: 400, spur_leer: 400, zu_gross: 400,
    kein_projekt: 409, ki_gestoppt: 409, beschaeftigt: 409, transport_laeuft: 409, nicht_geladen: 409, kein_kernstand: 409, deck_laeuft: 409,
    audio_fehlt: 409, veraltet: 409, freeze_fehler: 502, render_fehler: 502, resample_leer: 409, resample_fehler: 502, merge_keine_spur_frei: 409 };
  const FREEZE_MAX_BEATS = 256, NACHLAUF_BEATS = 2, EXPORT_MAX_BEATS = 1024;
  // D1 S3 (Auftrag 14 c, gegen den Server verglichen: tests/production_mock_s3.test.mjs): ohne eigenen Text der englische Text des Servers
  // (http/reasons.ts), nie der Grund selbst
  const af = (grund, text) => { throw new Fehl(AUSGABE_CODE[grund] ?? 409, grund, text ?? grundText(grund)); };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const istWirt = (s) => s.art === 'instrument' && s.geraet?.art === 'wirt';
  // Spec 6.17 wie project/freeze.ts: bei einem Loop-Clip klingen nur Noten vor loop_beats
  const grenze = (c) => c.loop_beats ?? c.laenge_beats;
  const klingend = (s) => s.clips.reduce((n, c) => n + (c.art === 'midi' ? c.noten.filter((x) => x.beat < grenze(c)).length : 0), 0);
  const brauchtFreeze = (s) => istWirt(s) && !s.freeze && klingend(s) > 0;
  const sichtVon = (p, s) => JSON.stringify([s.clips, s.geraet, p.tempo_bpm]);
  function freezeBereich(s) {
    let von = Infinity, bis = -Infinity;
    for (const c of s.clips) {
      if (c.art !== 'midi' || !c.noten.some((n) => n.beat < grenze(c))) continue;
      von = Math.min(von, c.start_beat); bis = Math.max(bis, c.start_beat + c.laenge_beats);
    }
    return { von, bis: Math.max(bis, von + 1) };
  }
  // ein Echtzeit-Durchlauf (z.lauf ist schon belegt); bucht „Freeze <Spur>“ und gibt den neuen Stand zurück
  async function friereEin(spurId, quelle) {
    const p0 = aktuell(), s0 = spurVon(p0, spurId), slug = z.slug;
    if (klingend(s0) === 0) af('spur_leer');
    const b = freezeBereich(s0);
    if (b.bis - b.von > FREEZE_MAX_BEATS) af('zu_gross', `a freeze covers at most ${FREEZE_MAX_BEATS} beats (${s0.name}: beat ${b.von} to ${b.bis})`);   // Text wie output.ts
    // Reihenfolge wie areas/proj/output.ts friereEinUndSetze: Kern-Stand, Transport, dann die Sperre (Öffnen), Tempo (deck_laeuft), Kern (tempo_rampe)
    if (z.ausgabe.fehler === 'kein_kernstand') af('kein_kernstand', 'the core has not reported its arrangement state yet');
    if (z.transport) af('transport_laeuft', 'stop the transport first');
    // V2 Fix F12: Sperre beim Öffnen (Spec 6.32, Text wie session.ts sperreLaden) und offene Tempo-Rampe (Spec 6.33: der Kern lehnt mit tempo_rampe
    // ab, /proj/freeze antwortet 409 beschaeftigt, das Projekt bleibt unverändert); Steuerung POST /attrappe/ausgabe {fehler: 'oeffnet' | 'tempo_rampe'}
    if (z.ausgabe.fehler === 'oeffnet') af('beschaeftigt', 'a project is being opened; a freeze waits until it is open');
    if (z.ausgabe.fehler === 'deck_laeuft') af('deck_laeuft');
    if (z.ausgabe.fehler === 'tempo_rampe') af('beschaeftigt', 'the core is still ramping the tempo; a freeze waits until the ramp is done');
    const sicht = sichtVon(p0, s0);
    z.lauf.durchlauf = { t0: Date.now(), ms: z.ausgabe.freezeMs, von: b.von, bis: b.bis + NACHLAUF_BEATS };
    try { await pause(z.ausgabe.freezeMs); } finally { if (z.lauf) z.lauf.durchlauf = null; }
    const nr = s0.nr, kennung = (z.kennungen.get(nr) ?? 0) + 1;
    z.kennungen.set(nr, kennung);
    const frames = Math.round(((b.bis - b.von + NACHLAUF_BEATS) * 60 / p0.tempo_bpm) * 48000);
    if (z.ausgabe.fehler === 'freeze_fehler') { sende({ a: '/e/freeze', f: { spur: nr, kennung, status: 1, frames: 0 } }); af('freeze_fehler'); }
    sende({ a: '/e/freeze', f: { spur: nr, kennung, status: 0, frames } });
    const p = z.projekte.get(slug), s = p?.spuren.find((x) => x.id === spurId);
    if (z.slug !== slug || !s || sichtVon(p, s) !== sicht || z.ausgabe.fehler === 'veraltet') af('veraltet');
    const neu = kopie(p);
    neu.spuren.find((x) => x.id === spurId).freeze = { datei: `freeze-${nr}-${kennung}.f32`, frames, kennung, sha256: kennung.toString(16).padStart(64, '0'), von_beat: b.von };
    const e = bucheEin(slug, 'aendern', `Freeze ${s.name}`, quelle, p, neu);
    e.nurMixer = false;
    const st = stapelVon(slug); st.getan.push(e); st.rueck.length = 0;
    return neu;
  }
  async function freeze(d, quelle) {
    for (const k of Object.keys(d)) if (k !== 'spur_id' && k !== 'an') af('argument_ungueltig');
    if (typeof d.spur_id !== 'string' || d.spur_id === '' || typeof d.an !== 'boolean') af('argument_ungueltig');
    const p = aktuell(), s = spurVon(p, d.spur_id);
    if (!istWirt(s)) af('keine_wirtspur');
    if (Boolean(s.freeze) === d.an) return { rev: p.rev, projekt: p };   // schon so: kein Fehler, nichts geändert (S3)
    if (z.lauf) af('beschaeftigt', `${z.lauf.art === 'freeze' ? 'a freeze' : 'an export'} is running`);
    z.lauf = { art: 'freeze', spur_id: s.id, durchlauf: null };
    try {
      if (d.an) { const neu = await friereEin(s.id, quelle); return { rev: neu.rev, projekt: neu }; }
      const neu = kopie(p); neu.spuren.find((x) => x.id === s.id).freeze = null;
      const e = bucheEin(z.slug, 'aendern', `Unfreeze ${s.name}`, quelle, p, neu);
      e.nurMixer = false;
      const st = stapelVon(z.slug); st.getan.push(e); st.rueck.length = 0;
      return { rev: neu.rev, projekt: neu };
    } finally { z.lauf = null; }
  }
  // 1.10 slice 7 (T6): POST /proj/resample with the real plan and the real new-state function of project/resample.ts; the run is a pause of
  // z.ausgabe.freezeMs under z.lauf {art: 'resample', strang_id}. POST /attrappe/ausgabe {fehler: 'resample_leer' | 'resample_fehler' | 'veraltet'} makes it fail.
  async function resample(d, quelle) {
    const p0 = aktuell();
    const vorgabe = (() => {
      if (p0.loop.an) return { von: p0.loop.von_beat, bis: p0.loop.bis_beat };
      let bis = 0;
      for (const s of p0.spuren) for (const c of s.clips) bis = Math.max(bis, c.start_beat + c.laenge_beats);
      return { von: 0, bis };
    })();
    let plan;
    try { plan = resamplePlan(p0, d, vorgabe); } catch (e) { if (e instanceof ResampleFehler) af(e.grund, e.text); throw e; }
    if (z.lauf) af('beschaeftigt', `${z.lauf.art === 'freeze' ? 'a freeze' : z.lauf.art === 'resample' ? 'a resample' : 'an export'} is running`);
    if (z.transport) af('transport_laeuft', 'stop the transport first');
    z.lauf = { art: 'resample', strang_id: plan.strangId, durchlauf: null };
    try {
      await pause(z.ausgabe.freezeMs);
      if (z.ausgabe.fehler === 'resample_leer') af('resample_leer', `${plan.name} is silent in beat ${plan.von} to ${plan.bis}`);
      if (z.ausgabe.fehler === 'resample_fehler') af('resample_fehler', 'the core aborted the resample; nothing was saved');
      const slug = z.slug, p = z.projekte.get(slug);
      if (!p || p.tempo_bpm !== plan.tempo || z.ausgabe.fehler === 'veraltet') af('veraltet', 'the tempo or the strip changed during the resample; nothing was saved');
      const kennung = (z.kennungen.get('resample') ?? 0) + 1;
      z.kennungen.set('resample', kennung);
      const datei = `/attrappe/projekte/${slug}/resample/resample-${kennung}.wav`;
      const neu = baueResampleProjekt(p, plan, { sha256: kennung.toString(16).padStart(64, '0'), pfad: datei }, quelle);
      const e = bucheEin(slug, 'aendern', `Resample ${plan.name}`.slice(0, 80), quelle, p, neu.projekt);
      e.nurMixer = false;
      const st = stapelVon(slug); st.getan.push(e); st.rueck.length = 0;
      const spur = neu.projekt.spuren.find((x) => x.id === neu.spurId);
      return { rev: neu.projekt.rev, spur_id: neu.spurId, clip_id: spur.clips[0].id, datei, frames: Math.round((plan.bis - plan.von) * 60 / p.tempo_bpm * 48000),
        quelle: plan.strangId, punkt: plan.punkt, von_beat: plan.von, bis_beat: plan.bis };
    } finally { z.lauf = null; }
  }
  function exportName(slug) {
    const d = new Date(), zw = (n) => String(n).padStart(2, '0');
    const basis = `/attrappe/projekte/${slug}/export/${slug}-${d.getFullYear()}${zw(d.getMonth() + 1)}${zw(d.getDate())}-${zw(d.getHours())}${zw(d.getMinutes())}${zw(d.getSeconds())}`;
    let datei = `${basis}.wav`;
    for (let n = 2; z.exporte.has(datei); n++) datei = `${basis}-${n}.wav`;
    z.exporte.add(datei);
    return datei;
  }
  async function exportiere(d, quelle) {
    for (const k of Object.keys(d)) if (k !== 'von_beat' && k !== 'bis_beat' && k !== 'abgriff') af('argument_ungueltig');   // 1.10 Slice 2: abgriff wie output.ts
    for (const k of ['von_beat', 'bis_beat']) if (d[k] !== undefined && !zahlOk(d[k])) af('argument_ungueltig');
    const p = aktuell(), slug = z.slug;
    const von = d.von_beat ?? p.loop.von_beat, bis = d.bis_beat ?? p.loop.bis_beat;
    if (!(von >= 0) || !(bis - von >= 1) || bis - von > EXPORT_MAX_BEATS) af('export_bereich');
    // Reihenfolge wie output.ts exportiere: ein laufender Lauf vor dem Transport (der Kern meldet beim Freeze Status 3)
    if (z.lauf) af('beschaeftigt', `${z.lauf.art === 'freeze' ? 'a freeze' : 'an export'} is running`);
    if (z.transport) af('transport_laeuft', 'stop the transport first');
    if (p.spuren.some((s) => s.clips.some((c) => c.art === 'audio' && c.dekodiert !== 'fertig' && c.start_beat < bis && c.start_beat + c.laenge_beats > von))) af('audio_fehlt');
    if (d.abgriff !== undefined && d.abgriff !== 'produktion' && d.abgriff !== 'set') af('argument_ungueltig');   // nach den Bereichsprüfungen, wie output.ts exportiere
    const abgriff = d.abgriff === 'set' ? 'set' : 'produktion';
    z.lauf = { art: 'export', durchlauf: null };
    try {
      for (const id of p.spuren.map((s) => s.id)) {        // Spec 2.5: Wirt-Spuren vorher einfrieren, eine nach der anderen
        const s = aktuell().spuren.find((x) => x.id === id);
        if (s && brauchtFreeze(s)) await friereEin(id, quelle);
      }
      const jetzt = aktuell();
      if (z.slug !== slug || jetzt.spuren.some(brauchtFreeze)) af('veraltet');
      await pause(z.ausgabe.renderMs);
      if (z.ausgabe.fehler === 'render_fehler') af('render_fehler');
      const { spitze_db, regler_quelle, lufs_i, lra, true_peak_dbtp, loudness_fehler, ueber_decke, limiter_db_max } = z.ausgabe;
      // R9 wie output.ts: scheitert die Messung, sind die drei Felder null und loudness_fehler nennt den Grund (Steuerung über /attrappe/ausgabe)
      return { datei: exportName(slug), frames: Math.round(((bis - von) * 60 / jetzt.tempo_bpm) * 48000), spitze_db, regler_quelle, abgriff, ueber_decke: abgriff === 'produktion' && ueber_decke === true, limiter_db_max: limiter_db_max ?? 0, lufs_i, lra, true_peak_dbtp,
        ...(loudness_fehler ? { loudness_fehler } : {}) };
    } finally { z.lauf = null; }
  }

  function beatJetzt() {
    if (!z.transport || !z.slug) return null;
    const p = z.projekte.get(z.slug), bpm = z.masterBpm ?? p.tempo_bpm;
    const roh = z.transport.beat0 + ((Date.now() - z.transport.t0) / 60000) * bpm;
    const l = p.loop.bis_beat - p.loop.von_beat;
    // Spec 2.2: der Kern springt erst „beim Erreichen von bis“; wer hinter bis startet, läuft ungefaltet weiter
    return p.loop.an && l > 0 && z.transport.beat0 < p.loop.bis_beat && roh >= p.loop.bis_beat ? p.loop.von_beat + ((roh - p.loop.von_beat) % l) : roh;
  }
  function pegel() {
    for (const s of z.projekte.get(z.slug)?.spuren ?? []) {
      sende({ a: '/pegel', f: { kanal: `spur/${s.nr}`, spitze_db: z.transport && !s.mute && s.clips.length ? -12 : -200 } });
    }
  }
  function meldeArr() {
    if (!z.slug || Date.now() < (z.stummBis ?? 0)) return;
    const p = z.projekte.get(z.slug), b = beatJetzt(), l = z.lauf?.durchlauf;
    const fr = l ? l.von + Math.min(1, (Date.now() - l.t0) / l.ms) * (l.bis - l.von) : null;   // D1 V2: Freeze-Durchlauf
    sende({ a: '/zustand/arr', f: { nr: p.wiedergabe_rev, status: fr !== null ? 3 : z.transport ? 2 : 0, loop_an: p.loop.an ? 1 : 0, projekt_beat: fr ?? b ?? z.stoppBeat,
      ursprung_sample: 0, start_beat: z.transport?.beat0 ?? 0, metronom_an: p.metronom.an ? 1 : 0 } });
  }
  let tick = 0;
  const uhr = setInterval(() => {
    tick++;
    if (z.stroeme.size === 0 || !z.slug) return;
    if (z.transport || freezeLaeuft() || tick % 10 === 0) meldeArr();   // 50 ms beim Spielen und beim Freeze, 2 Hz sonst (Spec 3.1)
    if (z.transport && tick % 2 === 0) pegel();                     // Pegel nur beim Spielen; beim Stopp einmal −200

  }, 50);

  // 1.16 rest U7: POST /presets/anwenden and /presets/von_ziel read the OPEN PROJECT, and the page server behind this stand-in has none (the project lives here).
  // So the stand-in answers these two itself with the REAL plan code (presets/apply.ts) on its own project; the preset files and the save come from the
  // page server above (GET /presets/<origin>/<device>/<slug>, POST /presets), so name, rights and values are the real ones.
  async function presetPlan(q, a, u) {
    const d = await koerper(q);
    z.log.push({ t: Date.now(), methode: q.method, weg: u.pathname, koerper: d, quelle: q.headers['x-djk-quelle'] === 'cypher' ? 'cypher' : 'andreas' });   // the probe counts the plan requests
    const aktuellOderNull = z.slug ? z.projekte.get(z.slug) : null;
    const oben_ = (pfad, opt) => fetch(new URL(pfad, oben), opt);
    try {
      if (u.pathname === '/presets/anwenden') {
        const m = typeof d.id === 'string' ? /^(werk|nutzer):([a-z0-9-]+)\/([a-z0-9][a-z0-9-]{0,47})$/.exec(d.id) : null;
        if (!m) throw new PresetFehler(400, 'preset_id_ungueltig');
        const r = await oben_(`/presets/${m[1]}/${m[2]}/${m[3]}`);
        const preset = await r.json();
        if (r.status !== 200) return json(a, r.status, preset);
        return json(a, 200, planeAnwendung({ ...preset, id: d.id }, d.ziel, aktuellOderNull));
      }
      // von_ziel: the REAL values-from-target code on this project; the save itself is NOT forwarded (the page server's user preset folder is the
      // test instance's real folder: a probe must not leave files there). The answer has the shape of the real 201; z.gespeichertePresets holds what would be saved.
      const v = werteVonZiel(d.ziel, aktuellOderNull);
      z.gespeichertePresets.push({ name: d.name, geraet: v.geraet, graph: v.graph, werte: v.werte, beschreibung: d.beschreibung, tags: d.tags, ziel: d.ziel });
      return json(a, 201, { herkunft: 'nutzer', geraet: v.geraet, slug: String(d.name ?? 'x').toLowerCase().replace(/[^a-z0-9]+/g, '-'), geaendert: new Date().toISOString() });
    } catch (e) {
      if (e instanceof PresetFehler) return json(a, e.code, { fehler: e.fehler, text: e.text });
      throw e;
    }
  }

  function durchreichen(q, a, u) {
    if (z.weg && u.pathname === '/strom') { q.socket.destroy(); return; }
    const kopf = { ...q.headers };
    delete kopf.origin; delete kopf.host;
    const r = http.request(new URL(u.pathname + u.search, oben), { method: q.method, headers: kopf }, (o) => {
      a.writeHead(o.statusCode, o.headers);
      if (u.pathname !== '/strom') { o.pipe(a); return; }
      const s = { a, rest: '' };
      z.stroeme.add(s);
      o.setEncoding('utf8');
      o.on('data', (t) => {
        s.rest += t;
        const i = s.rest.lastIndexOf('\n\n');
        if (i < 0) return;
        const roh = s.rest.slice(0, i + 2);
        s.rest = s.rest.slice(i + 2);
        // D1 S3 Auftrag 18 (gemessen ~/messungen/2026-10-15-d1-s3/p18_messung_vorher.txt): /zustand/arr gehört der Attrappe (sie spielt die Seite des
        // Arrangements). Seit S2int-Fix-4 J1 meldet die Kern-Attrappe dahinter /zustand/arr im Takt (2 Hz im Stand, nr −1, nie geladen); durchgereicht
        // unterlief das /attrappe/stumm (5 Meldungen in 2,5 s Stille) und mischte „nr −1, steht“ zwischen die eigenen Meldungen. Darum hält die Attrappe
        // die Meldungen von oben zurück: ihre Stille ist dann ganz still, und die Seite sieht nur einen Arrangement-Zustand.
        const ganz = roh.split('\n\n').filter((m) => {
          const d = /^data: (.*)$/m.exec(m);
          if (!d) return true;
          try {
            const n = JSON.parse(d[1]);
            if (n.a === '/uhr' && n.f?.bpm > 0) z.masterBpm = n.f.bpm;
            return n.a !== '/zustand/arr';
          } catch { return true; }   // fremdes Format: nur durchreichen
        }).join('\n\n');
        if (ganz.trim()) a.write(ganz.endsWith('\n\n') ? ganz : `${ganz}\n\n`);
      });
      o.on('end', () => { z.stroeme.delete(s); a.end(); });
      q.on('close', () => { z.stroeme.delete(s); o.destroy(); });
    });
    r.on('error', (e) => { if (!a.headersSent) json(a, 502, { fehler: 'oben_weg', text: e.message }); else a.destroy(); });
    q.pipe(r);
  }

  const srv = http.createServer((q, a) => {
    const u = new URL(q.url, 'http://attrappe');
    if (q.method === 'POST' && (u.pathname === '/presets/anwenden' || u.pathname === '/presets/von_ziel')) {
      return presetPlan(q, a, u).catch((e) => json(a, e instanceof Fehl ? e.code : 500, { fehler: e instanceof Fehl ? e.fehler : 'intern', text: e.message }));
    }
    if (!u.pathname.startsWith('/proj/') && !u.pathname.startsWith('/attrappe/')) return durchreichen(q, a, u);
    proj(q, a, u).catch((e) => json(a, e instanceof Fehl ? e.code : 500, { fehler: e instanceof Fehl ? e.fehler : 'intern', text: e.message }));
  });
  await new Promise((ok) => srv.listen(port, '127.0.0.1', ok));
  const p = srv.address().port;
  return {
    url: `http://127.0.0.1:${p}/`, port: p, zustand: z,
    stoppe: () => new Promise((ok) => { clearInterval(uhr); for (const d of z.dekodierUhren) clearTimeout(d); z.dekodierUhren.clear(); for (const s of z.stroeme) s.a.end(); srv.closeAllConnections(); srv.close(() => ok()); }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = await starteProjAttrappe({ oben: process.argv[2], port: Number(process.argv[3] ?? 0) });
  process.stdout.write(`proj_attrappe: ${at.url} → ${process.argv[2]}\n`);
  const ende = async () => { await at.stoppe(); process.exit(0); };
  process.on('SIGTERM', ende); process.on('SIGINT', ende);
}
