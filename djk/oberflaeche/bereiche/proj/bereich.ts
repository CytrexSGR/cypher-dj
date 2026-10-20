// Bereich proj (Spec D1 3.4, Paket S2): Projekt-API des Seiten-Servers. Dockt nur über den BereichKontext und den Haken ereignis an
// (Spec 2.10), nie an Innereien der Oberflaeche. Schutz wie Bestand: POST nur JSON und eigene Herkunft (Router, fremdePost), Quelle aus
// x-djk-quelle (ctx.quelle(), zu Beginn der Anfrage gelesen), KI-Stopp sperrt Cyphers Schreiben (Sitzung). Körperlimit 1 MiB.
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { AblageFehler } from '../../projekt/ablage.ts';
import { BefehlFehler } from '../../projekt/befehle.ts';
import { KatalogFehler } from '../../katalog.ts';
import { istObjekt } from '../../projekt/modell.ts';
import { PatchFehler } from '../../projekt/patch.ts';
import type { Haken, Meta, Verlauf, Wirkung } from '../../projekt/verlauf.ts';
import type { Projekt } from '../../projekt/modell.ts';
import { VerlaufFehler } from '../../projekt/verlauf.ts';
import { grundCode } from './abbildung.ts';
import { grundText } from '../../http/gruende.ts';
import { ProjFehler, ProjSitzung, type Antwort, type AusgabeLauf, type ProjOptionen } from './sitzung.ts';

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
  sperreLaden(): () => void;
  ausgabeLauf(l: AusgabeLauf | null): void;                                              // Spec 6.34 (Paket S3): laufender Freeze/Export für GET /proj/aktuell
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
  const j = r.j as { rev: number; projekt: Projekt; kern?: Record<string, unknown> };
  return { code: 200, j: { rev: j.rev, kern: j.kern ?? {}, noten_zahl: notenZahl(j.projekt) } };
}
// Spec 6.32: schmale Antwort für proj_oeffnen und proj_neu (Abfrage ?antwort=kurz): slug, rev, die Spuren (Clips ohne Noten, MIDI-Clips mit
// noten_zahl), noten_zahl je Clip und die Kern-Meldungen. Bei 10.000 Noten statt rund 0,6 MB wenige hundert Bytes; die Seite fragt ohne Abfrage.
export function kurzeOeffnenAntwort(r: Antwort): Antwort {
  if (r.code !== 200) return r;
  const j = r.j as { slug: string; projekt: Projekt; kern?: Record<string, unknown> };
  const spuren = j.projekt.spuren.map((s) => ({ ...s, clips: s.clips.map((c) => {
    if (c.art !== 'midi') return c;
    const { noten, ...rest } = c;
    return { ...rest, noten_zahl: noten.length };
  }) }));
  return { code: 200, j: { slug: j.slug, rev: j.projekt.rev, spuren, noten_zahl: notenZahl(j.projekt), kern: j.kern ?? {} } };
}

export function projBereich(ctx: BereichKontext, opt: ProjOptionen = {}): Bereich & { sitzung: ProjSitzung; zugang: ProjZugang } {
  const s = new ProjSitzung(ctx, opt);
  const zugang: ProjZugang = {
    offen: () => s.zugangOffen(), arbeitsordner: () => s.arbeitsordner, haken: () => s.zugangHaken(), uebernimm: (w, meta) => s.uebernimm(w, meta),
    schreibeWiedergabe: (p) => s.schreibeWiedergabeFuer(p), naechsteNummer: () => s.naechsteNummer(), tempoAnMaster: () => s.tempoAnMaster(),
    sperreLaden: () => s.sperreLaden(), ausgabeLauf: (l) => s.setzeAusgabeLauf(l),
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
      lies('/proj/aktuell', (url) => s.aktuell(url.searchParams.get('nur') === 'rev' ? 'rev'
        : url.searchParams.get('noten') === 'zahl' ? 'noten_zahl' : 'voll')),
      lies('/proj/verlauf', () => s.verlaufListe()),
      // Spec 6.32: ?antwort=kurz (Werkzeuge proj_neu, proj_oeffnen) liefert slug, rev, Spuren ohne Noten, noten_zahl und kern statt des Projekts
      schreib('/proj/neu', (d, quelle) => s.neu(d.name, quelle), kurzeOeffnenAntwort),
      schreib('/proj/oeffnen', (d, quelle) => s.oeffnen(d.slug, quelle), kurzeOeffnenAntwort),
      // Spec 6.31: ?antwort=kurz (Werkzeuge) liefert rev, kern und noten_zahl je Clip statt des Projekts
      schreib('/proj/aendern', (d, quelle) => s.aendern(d, quelle), kurzeAntwort),
      schreib('/proj/undo', (d, quelle) => s.umkehr('undo', d, quelle), kurzeAntwort),
      schreib('/proj/redo', (d, quelle) => s.umkehr('redo', d, quelle), kurzeAntwort),
      schreib('/proj/transport', (d, quelle) => s.transport(d, quelle)),
    ],
    ereignis: (adresse: string, felder: Record<string, unknown>) => s.ereignis(adresse, felder),
  };
}
