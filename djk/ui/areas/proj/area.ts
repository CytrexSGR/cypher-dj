// Bereich proj (Spec D1 3.4, Paket S2): Projekt-API des Seiten-Servers. Dockt nur über den BereichKontext und den Haken ereignis an
// (Spec 2.10), nie an Innereien der Oberflaeche. Schutz wie Bestand: POST nur JSON und eigene Herkunft (Router, fremdePost), Quelle aus
// x-djk-quelle (ctx.quelle(), zu Beginn der Anfrage gelesen), KI-Stopp sperrt Cyphers Schreiben (Sitzung). Körperlimit 1 MiB.
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import type { SicherGrund } from '../../plugins/state.ts';
import { json } from '../../http/transport.ts';
import { AblageFehler } from '../../project/storage.ts';
import { BefehlFehler } from '../../project/commands.ts';
import { KatalogFehler } from '../../catalog.ts';
import { istObjekt } from '../../project/model.ts';
import { PatchFehler } from '../../project/patch.ts';
import type { Haken, Meta, Verlauf, Wirkung } from '../../project/history.ts';
import type { Projekt } from '../../project/model.ts';
import { VerlaufFehler } from '../../project/history.ts';
import { grundCode } from './mapping.ts';
import { listeKits } from './kits.ts';
import { listeSurgePatches } from './surge_patches.ts';
import { routingMatrix } from '../../project/routing_matrix.ts';
import { grundText } from '../../http/reasons.ts';
import { wirtLage } from './instrument_host.ts';
import { MIDI_KOERPER_MAX, midiImport } from './midi_import.ts';
import { ProjFehler, ProjSitzung, TRANSIENTEN_MAX, hkKurz, type Antwort, type AusgabeLauf, type ProjOptionen } from './session.ts';

export type { AusgabeLauf, ProjOptionen };

// Schmale Fassade auf die Sitzung für S3 (Freeze, Export; Plan S3 „vorausgesetzte Schnittstellen“). Dünn: jede Funktion ruft die Sitzung.
export interface ProjZugang {
  offen(): { slug: string; ordner: string; projekt: Projekt; verlauf: Verlauf } | null;   // der lebende Stand, bei jedem Aufruf
  arbeitsordner(): string;                                                               // <arr_ordner> der Instanz (Spec 2.9)
  haken(): Haken;                                                                        // speichere (project.json) und dekodiert wie /proj/aendern
  uebernimm(w: Wirkung, meta: Meta): Promise<void>;                                      // Stand synchron setzen, dann laden, Regler, SSE
  schreibeWiedergabe(p: Projekt): { nr: number; datei: string };                         // nächste Nummer des einen Zählers, ohne /k/arr/laden
  naechsteNummer(): number;                                                              // Spec 6.25: Freeze-Kennung aus dem einen Wiedergabe-Zähler
  tempoAnMaster(): Promise<void>;                                                        // wirft deck_laeuft, wenn Master-Tempo abweicht und ein Deck läuft
  // Spec 6.23: gibt die Freigabe zurück; 6.32: wirft 409 beschaeftigt, solange ein Öffnen läuft
  sperreLaden(fuer?: 'aufnahme'): () => void;   // 1.8: 'aufnahme' darf den eigenen Transport starten (Nachbesserung 1, B1)
  ausgabeLauf(l: AusgabeLauf | null): void;                                              // Spec 6.34 (Paket S3): laufender Freeze/Export für GET /proj/aktuell
  transport(d: Record<string, unknown>, quelle: 'andreas' | 'cypher'): Promise<Antwort>;                  // 1.8: der gewöhnliche Transport (Start/Stopp)
  stemsStand(s: Record<string, unknown> | null): void;   // Slice 6 (P6): letzter Stems-Stand
  beiSchliessen(f: (slug: string) => void): void;        // Slice 6 (T7): ruft f, sobald das offene Projekt geschlossen wird (Wechsel, Neuöffnen)
  beendeVorhoeren(): Promise<void>;   // 1.14: ends the audition and loads the main playback; called by a lock holder (recording, freeze) before it starts
  // 1.9 U5: brings the Surge hosts to the project's parameter map and resolves when they answered (never rejects); the freeze waits for it
  wirtSpiegel?(): Promise<string[] | void>;
  aufnahmeAktiv?(): boolean;   // 1.8 T9: a recording is starting or running (lock held or run set)
  aufnahmeLauf(l: unknown): void;                                                                        // 1.8: laufende Aufnahme (sperrt Tempo-Änderungen)
  // 1.8 S3 (D13): ruft f(projekt) synchron nach jeder Zuweisung des offenen Projekts (Öffnen, Ändern, Undo/Redo, Hand-Rückweg, Mixer nach Wiederanlauf,
  // Übernahme von Freeze und Aufnahme) und am Ende von nachNeustart. f darf nicht werfen; ein Fehler wird protokolliert.
  beiStand(f: (p: Projekt) => void): void;
  hostZustandSichern?(grund: SicherGrund): Promise<void>;   // plan 1.11 D8: the plugin states are written (before an export), at most 3 s
  hostLage?(): { insert_id: string; status: string; grund?: string }[];   // plan 1.11 T13: the host manager's states
  hostGesundAlterMs?(nur?: ReadonlySet<string>): number;   // plan 1.11 T13: ms since the last health rise of those hosts (export waits for 1.1 s)
  ladeEchtzeitSicht?(p: Projekt): Promise<{ nr: number; datei: string }>;   // plan 1.11 T13: write and load the project as an export playback
  ladeLiveNeu?(): Promise<void>;                                            // plan 1.11 T13: load the live playback again
}
export const KOERPER_MAX = 1024 * 1024;   // Spec 3.4: 1 MiB

// Liest den Körper bis zum Ende (auch über der Grenze, damit der Client seine Antwort bekommt), zählt Bytes, nicht Zeichen.
export async function leseKoerper(q: http.IncomingMessage, grenze = KOERPER_MAX): Promise<Record<string, unknown>> {
  const teile: Buffer[] = [];
  let n = 0;
  for await (const t of q) {
    const b = Buffer.isBuffer(t) ? t : Buffer.from(t as string);
    n += b.length;
    if (n <= grenze) teile.push(b);
  }
  if (n > grenze) throw new ProjFehler(413, 'koerper_zu_gross', { grenze });
  let j: unknown;
  try { j = n === 0 ? {} : JSON.parse(Buffer.concat(teile).toString('utf8')); } catch { throw new ProjFehler(400, 'json'); }
  if (!istObjekt(j)) throw new ProjFehler(400, 'koerper_kein_objekt');
  return j;
}

// Spec 6.34 (Paket S3, Auftrag 14 b): jede Antwort mit Grund trägt einen englischen text. Eigene englische Texte (ProjFehler extra.text, etwa
// beschaeftigt mit seiner Ursache) gewinnen; sonst der Text aus http/gruende.ts. Die (deutschen) Prüfmeldungen der Bausteine gehen als detail mit.
export function alsAntwort(e: unknown, ctx: BereichKontext): Antwort {
  const mit = (fehler: string, detail?: string): { fehler: string; text: string; detail?: string } =>
    (detail ? { fehler, text: grundText(fehler), detail } : { fehler, text: grundText(fehler) });
  if (e instanceof ProjFehler) return { code: e.code, j: { fehler: e.fehler, text: grundText(e.fehler), ...e.extra } };
  if (e instanceof BefehlFehler) {
    return { code: grundCode(e.grund), j: { ...mit(e.grund, e.detail), ...(e.index !== undefined ? { index: e.index } : {}) } };
  }
  if (e instanceof VerlaufFehler) return { code: grundCode(e.grund), j: mit(e.grund, e.message) };
  if (e instanceof AblageFehler) return { code: e.code, j: mit(e.fehler, e.message !== e.fehler ? e.message : undefined) };
  if (e instanceof KatalogFehler) return { code: e.code, j: mit(e.fehler) };
  if (e instanceof PatchFehler) return { code: 409, j: mit('verlauf_inkonsistent', e.message) };
  ctx.log({ typ: 'proj_fehler', fehler: (e as Error)?.message ?? String(e) });
  return { code: 500, j: { fehler: 'intern', text: grundText('intern'), detail: (e as Error)?.message ?? String(e) } };
}

// Spec 6.31: schmale Antwort für die Werkzeuge (proj_aendern, proj_undo, proj_redo; Abfrage ?antwort=kurz): rev, Kern-Meldungen und die Zahl
// der Noten je MIDI-Clip, nicht das ganze Projekt (bei 10.000 Noten rund 0,6 MB). Die Seite fragt ohne Abfrage und bekommt weiter alles.
const notenZahl = (p: Projekt): Record<string, number> => {
  const z: Record<string, number> = {};
  for (const s of p.spuren) for (const c of s.clips) if (c.art === 'midi') z[c.id] = c.noten.length;
  return z;
};
export function kurzeAntwort(r: Antwort): Antwort {
  if (r.code !== 200) return r;
  const j = r.j as { rev: number; projekt: Projekt; kern?: Record<string, unknown>; hinweise?: unknown[]; muster?: unknown[] };
  return { code: 200, j: { rev: j.rev, kern: j.kern ?? {}, noten_zahl: notenZahl(j.projekt), ...(j.hinweise ? { hinweise: j.hinweise } : {}),
    ...(j.muster ? { muster: j.muster } : {}) } };   // strudel-clip: the report of each generated clip
}
// S17: like kurzeAntwort, plus what bkMerken captured
export function kurzeBkAntwort(r: Antwort): Antwort {
  const k = kurzeAntwort(r);
  return r.code === 200 ? { code: 200, j: { ...(k.j as object), bk: (r.j as { bk?: unknown }).bk } } : k;
}
// Spec 6.32: schmale Antwort für proj_oeffnen und proj_neu (Abfrage ?antwort=kurz): slug, rev, die Spuren (Clips ohne Noten, MIDI-Clips mit
// noten_zahl), noten_zahl je Clip und die Kern-Meldungen. Bei 10.000 Noten statt rund 0,6 MB wenige hundert Bytes; die Seite fragt ohne Abfrage.
export function kurzeOeffnenAntwort(r: Antwort): Antwort {
  if (r.code !== 200) return r;
  const j = r.j as { slug: string; projekt: Projekt; kern?: Record<string, unknown> };
  // 1.14: take lanes are reported as a count per track (takes_zahl), not as whole lanes
  const spuren = j.projekt.spuren.map(({ takes, ...s }) => ({ ...s, ...(takes ? { takes_zahl: takes.length } : {}), clips: s.clips.map((c) => {
    // 1.12 slice 5 (U11): envelopes are listed without points here too (huellkurven [{ziel, punkte_zahl}])
    if (c.art !== 'midi') return hkKurz(c);
    const { noten, ...rest } = hkKurz(c);
    return { ...rest, noten_zahl: noten.length };
  }) }));
  return { code: 200, j: { slug: j.slug, rev: j.projekt.rev, spuren, noten_zahl: notenZahl(j.projekt), kern: j.kern ?? {} } };
}

export function projBereich(ctx: BereichKontext, opt: ProjOptionen = {}): Bereich & { sitzung: ProjSitzung; zugang: ProjZugang } {
  const s = new ProjSitzung(ctx, opt);
  const zugang: ProjZugang = {
    offen: () => s.zugangOffen(), arbeitsordner: () => s.arbeitsordner, haken: () => s.zugangHaken(), uebernimm: (w, meta) => s.uebernimm(w, meta),
    schreibeWiedergabe: (p) => s.schreibeWiedergabeFuer(p), naechsteNummer: () => s.naechsteNummer(), tempoAnMaster: () => s.tempoAnMaster(),
    sperreLaden: (fuer) => s.sperreLaden(fuer), ausgabeLauf: (l) => s.setzeAusgabeLauf(l),
    transport: (d, quelle) => s.transport(d, quelle), aufnahmeLauf: (l) => s.setzeAufnahmeLauf(l), aufnahmeAktiv: () => s.aufnahmeAktiv(),
    stemsStand: (x) => s.setzeStemsStand(x), beiSchliessen: (f) => s.beiSchliessen(f), beendeVorhoeren: () => s.beendeVorhoeren(),
    beiStand: (f) => s.beiStand(f),
    wirtSpiegel: () => s.wirtSpiegel(),
    hostZustandSichern: (grund) => s.hostZustandSichern(grund),
    hostLage: () => s.hostLage(), hostGesundAlterMs: (nur) => s.hostGesundAlterMs(nur),
    ladeEchtzeitSicht: (p) => s.ladeEchtzeitSicht(p), ladeLiveNeu: () => s.ladeLiveNeu(),
  };
  const antworte = async (a: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
    let r: Antwort;
    try { r = await f(); } catch (e) { r = alsAntwort(e, ctx); }
    json(a, r.code, r.j);
  };
  const lies = (pfad: string, f: (url: URL) => Antwort): Route => ({
    methode: 'GET', pfad, schutz: 'offen', handler: (_q, a, url) => antworte(a, () => f(url)) });
  // kurzFassung: was ?antwort=kurz liefert (Werkzeuge); ohne sie gilt die Abfrage auf dieser Route nicht
  const schreib = (pfad: string, f: (d: Record<string, unknown>, quelle: 'andreas' | 'cypher') => Promise<Antwort>,
    kurzFassung: ((r: Antwort) => Antwort) | null = null): Route => ({
    methode: 'POST', pfad, schutz: 'fremdePost',
    handler: async (q, a, url) => {
      const quelle = ctx.quelle(), kurz = kurzFassung !== null && url.searchParams.get('antwort') === 'kurz' ? kurzFassung : null;
      await antworte(a, async () => { const r = await f(await leseKoerper(q), quelle); return kurz ? kurz(r) : r; });
    },
  });
  return {
    name: 'proj',
    sitzung: s,
    zugang,
    routen: () => [
      lies('/proj/liste', () => s.liste()),
      // Spec 6.30: ?noten=zahl (proj_lage: Noten nur als Zahl je Clip), ?nur=rev (schmale rev-Abfrage des Werkzeugs); ohne Abfrage alles (die Seite)
      lies('/proj/aktuell', (url) => {
        const zahl = url.searchParams.get('noten') === 'zahl';
        const r = s.aktuell(url.searchParams.get('nur') === 'rev' ? 'rev' : zahl ? 'noten_zahl' : 'voll');
        // 1.9 (L10): proj_lage also shows whether the Surge hosts of slot 1 and 2 run (and what their status file holds); never for the page's view
        if (zahl && opt.wirtOrdner && r.j !== null && typeof r.j === 'object' && 'projekt' in r.j) {
          return { ...r, j: { ...r.j, wirte: wirtLage(opt.wirtOrdner()) } };
        }
        return r;
      }),
      lies('/proj/verlauf', () => s.verlaufListe()),
      // 1.9 (L25): the kits the kit folder offers for a kit track (proj_kits and the picker of the page)
      lies('/proj/kits', () => ({ code: 200, j: { kits: listeKits() } })),
      // the Surge patch library (own sounds and factory patches, the names `klang liste` prints) for the patch picker of a Surge track; ?text=<part of a name>
      lies('/proj/surge_patches', (url) => {
        const text = (url.searchParams.get('text') ?? '').toLowerCase();
        return { code: 200, j: { patches: listeSurgePatches().filter((x) => x.name.toLowerCase().includes(text)).slice(0, 500) } };
      }),
      // 1.10 slice 6 (D1): the routing matrix (proj_routing and the page's matrix view); ?optionen=<insert_id> adds the key options of that compressor stage
      lies('/proj/routing', (url) => {
        const o = s.zugangOffen();
        if (!o) return { code: 200, j: { slug: null } };
        const opt = url.searchParams.get('optionen');
        if (opt !== null && opt === '') throw new ProjFehler(400, 'argument_ungueltig', { text: 'optionen: a stage ID is required' });
        try { return { code: 200, j: { slug: o.slug, ...routingMatrix(o.projekt, opt ?? undefined) } }; } catch (e) {
          if (e instanceof BefehlFehler) throw new ProjFehler(400, e.grund, { detail: e.detail });
          throw e;
        }
      }),
      // Paket 1.13: proj_warp (clip_id, von_beat, bis_beat, bei_beat als Projekt-Beats, Slice 3a: marker_max)
      lies('/proj/warp', (url) => {
        const zahlArg = (k: string): number | null => {
          const t = url.searchParams.get(k);
          if (t === null || t === '') return null;
          const n = Number(t);
          if (!Number.isFinite(n)) throw new ProjFehler(400, 'argument_ungueltig', { text: `${k}: a number is required` });
          return n;
        };
        const mx = zahlArg('marker_max');
        if (mx !== null && (!Number.isInteger(mx) || mx < 1 || mx > 4096)) {
          throw new ProjFehler(400, 'argument_ungueltig', { text: 'marker_max: an integer from 1 to 4096 is required' });
        }
        const tm = zahlArg('transienten_max');
        if (tm !== null && (!Number.isInteger(tm) || tm < 1 || tm > TRANSIENTEN_MAX)) {
          throw new ProjFehler(400, 'argument_ungueltig', { text: `transienten_max: an integer from 1 to ${TRANSIENTEN_MAX} is required` });
        }
        return s.warpLage(url.searchParams.get('clip_id'), zahlArg('von_beat'), zahlArg('bis_beat'), zahlArg('bei_beat'), mx, tm,
          url.searchParams.get('transienten_quelle') === '1');   // Editor: alle Transienten der Quelle, ohne Marker und Fenster
      }),
      // Automation Slice 1: proj_auto (lane_id or spur_id, von_beat, bis_beat, bei_beat as project beats, punkte_max); 1.12 slice 5: clip_id (+ ziel) reads
      // a clip's envelopes, the beats are then CLIP beats
      lies('/proj/auto', (url) => {
        const zahlArg = (k: string): number | null => {
          const t = url.searchParams.get(k);
          if (t === null || t === '') return null;
          const n = Number(t);
          if (!Number.isFinite(n)) throw new ProjFehler(400, 'argument_ungueltig', { text: `${k}: a number is required` });
          return n;
        };
        const mx = zahlArg('punkte_max');
        if (mx !== null && (!Number.isInteger(mx) || mx < 1 || mx > 8192)) {
          throw new ProjFehler(400, 'argument_ungueltig', { text: 'punkte_max: an integer from 1 to 8192 is required' });
        }
        return s.autoLage(url.searchParams.get('lane_id') || null, url.searchParams.get('spur_id') || null, zahlArg('von_beat'), zahlArg('bis_beat'),
          zahlArg('bei_beat'), mx, url.searchParams.get('clip_id') || null, url.searchParams.get('ziel') || null);
      }),
      // Spec 6.32: ?antwort=kurz (Werkzeuge proj_neu, proj_oeffnen) liefert slug, rev, Spuren ohne Noten, noten_zahl und kern statt des Projekts
      schreib('/proj/neu', (d, quelle) => s.neu(d.name, quelle), kurzeOeffnenAntwort),
      schreib('/proj/oeffnen', (d, quelle) => s.oeffnen(d.slug, quelle), kurzeOeffnenAntwort),
      // Spec 6.31: ?antwort=kurz (Werkzeuge) liefert rev, kern und noten_zahl je Clip statt des Projekts
      // plan 1.11 D3: a plugin knob (not a command: no history, no project write); the insert ID is in the path
      {
        methode: 'POST', pfad: (pfad: string) => /^\/proj\/insert\/[A-Za-z][A-Za-z0-9_-]{0,31}\/param$/.test(pfad), schutz: 'fremdePost',
        handler: async (q, a, url) => {
          const quelle = ctx.quelle(), id = url.pathname.split('/')[3];
          await antworte(a, async () => s.insertParam(id, await leseKoerper(q), quelle));
        },
      },
      // MIDI import (spec 2026-11-10-midi-import): the file as base64 or a path, preview or import in ONE history step; its own body limit for the file
      {
        methode: 'POST', pfad: '/proj/midi_import', schutz: 'fremdePost',
        handler: async (q, a) => {
          const quelle = ctx.quelle();
          await antworte(a, async () => {
            let d: Record<string, unknown>;
            try { d = await leseKoerper(q, MIDI_KOERPER_MAX); } catch (e) {
              if (e instanceof ProjFehler && e.fehler === 'koerper_zu_gross') throw new ProjFehler(413, 'koerper_zu_gross',
                { text: `the request body is larger than ${(MIDI_KOERPER_MAX / 1048576).toFixed(1)} MiB` });
              throw e;
            }
            return midiImport(s, d, quelle);
          });
        },
      },
      schreib('/proj/aendern', (d, quelle) => s.aendern(d, quelle), kurzeAntwort),
      schreib('/proj/undo', (d, quelle) => s.umkehr('undo', d, quelle), kurzeAntwort),
      schreib('/proj/redo', (d, quelle) => s.umkehr('redo', d, quelle), kurzeAntwort),
      // 1.8 S4b.1a: vorzaehl_beats is the internal key of the recording area; from outside it is refused, so a count-in cannot widen a plain transport call
      schreib('/proj/transport', (d, quelle) => {
        if ('vorzaehl_beats' in d) throw new ProjFehler(400, 'argument_ungueltig', { text: 'vorzaehl_beats is not a transport field (use aufnahme_setzen)' });
        return s.transport(d, quelle);
      }),
      // 1.14 comping (R8): audition of one take per track, session state; the answer is the full map
      lies('/proj/take_vorhoeren', () => s.vorhoerenLage()),
      schreib('/proj/take_vorhoeren', (d, quelle) => s.vorhoerenSetzen(d, quelle)),
      // 1.12 slice 3 (task 4): lane override. uebersteuern {spur_id, ziel} (D4, page; Cypher gets nur_andreas, D9); re_enable {alle: true} | {spur_id, ziel}
      schreib('/proj/auto/uebersteuern', (d, quelle) => s.autoUebersteuern(d, quelle)),
      schreib('/proj/auto/re_enable', (d, quelle) => s.autoReEnable(d, quelle)),
      // 1.12 slice 3 (task 8): arm for recording (D11) and the mouse or keyboard value of a gesture (D12/D13); only Andreas
      schreib('/proj/auto/arm', (d, quelle) => s.autoArm(d, quelle)),
      schreib('/proj/auto/geste', async (d, quelle) => s.autoGeste(d, quelle)),
      // S17: sound snapshot (graph + eight knobs per channel): compare, capture, apply
      lies('/proj/bk', () => s.bkLage()),
      schreib('/proj/bk/merken', (d, q) => s.bkMerken(d, q), kurzeBkAntwort),
      schreib('/proj/bk/laden', (d, q) => s.bkLaden(d, q)),
    ],
    ereignis: (adresse: string, felder: Record<string, unknown>) => s.ereignis(adresse, felder),
  };
}
