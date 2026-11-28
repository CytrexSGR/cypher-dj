// Browse, media library, collection view, prepare and load routes of the page server (methods of Oberflaeche).
// Moved unchanged out of server.ts (pure move): plain functions bound to the Oberflaeche instance with `this`; the class keeps one-line delegations.
import fs from 'node:fs';
import http from 'node:http';
import { Router } from '../../http/router.ts';
import { KollektionSpeicher } from '../../collections/store.ts';
import { rangVon } from '../../collections/feste.ts';
import type { Felder } from '../../../conductor/src/addresses.ts';
import { inArbeitsbestand, KopieFehler } from '../../working_inventory.ts';
import { leseLoops } from '../../loops.ts';
import { beatsVon, LoopImportFehler } from '../../loop_import.ts';
import { type Fassung } from '../../deck_operation.ts';
import { SammlungFehler, uebersicht } from '../../collection.ts';
import { MusterFehler, type MusterEintrag } from '../../pattern_library.ts';
import { suchTerme } from '../../search_text.ts';
import { Katalog, KatalogFehler, KATALOG_TYPEN, SORT_VORGABE, SEITE_VORGABE, SEITE_MAX, type Typ, type Zeile, type Filter } from '../../catalog.ts';
import { ERREICHBAR_TTL_MS, quellenLage } from '../../erreichbar.ts';
import { leseWurzeln } from '../../sampler/file.ts';
import { vorbereitQuelle } from '../../vorbereit_source.ts';
import { VorhoerFehler } from '../../prelisten.ts';
import { Mediathek, Vorbereiter, MediathekFehler, KLANG_TYPEN, type KlangTreffer, bestandIds, parseBpm, parseLimit } from '../../media_library.ts';
import { leseMusterStand } from '../../../generator/src/pattern_state.mjs';
import { leseBestand, istOffenesDeck } from '../../server_kopf.ts';
import type { Eintrag } from '../../server_kopf.ts';
import { Oberflaeche } from '../../server.ts';

export function mediathekSuche(this: Oberflaeche, url: URL, a: http.ServerResponse): void {
  try {
    const p = url.searchParams;
    const bpm = p.get('bpm');
    const antwort = this.mediathek.suche({ text: p.get('text') || undefined, camelot: p.get('camelot') || undefined,
      bpm: bpm ? parseBpm(bpm) : undefined, genre: p.get('genre') || undefined, limit: parseLimit(p.get('limit')) },
      bestandIds(this.opt.bestand), (mid) => this.vorbereiter.anzeige(mid));
    this.json(a, 200, antwort);
  } catch (e) { this.mediathekFehler(e, a); }
}
// Klänge (Plan 2026-10-06-klaenge, T1): eigene Loop-Bibliothek (sofort, ladbar) vor den Mediathek-Klängen. Fehlt die Mediathek,
// bleibt die Antwort 200 mit mediathek:'fehlt' (die Loops spielen trotzdem), sonst wie /mediathek.
export function klaengeSuche(this: Oberflaeche, url: URL, a: http.ServerResponse): void {
  try {
    const p = url.searchParams;
    const typ = p.get('typ') || undefined, einsatz = p.get('einsatz') || undefined, bpmRoh = p.get('bpm');
    if (typ !== undefined && !(KLANG_TYPEN as readonly string[]).includes(typ)) throw new MediathekFehler(400, 'typ_ungueltig');
    if (einsatz !== undefined && !['sofort', 'werkstatt', 'nur_live'].includes(einsatz)) throw new MediathekFehler(400, 'einsatz_ungueltig');
    const bpm = bpmRoh ? parseBpm(bpmRoh) : undefined;
    const text = p.get('text') || undefined, pack = p.get('pack') || undefined, camelot = p.get('camelot') || undefined;
    const limit = Number.isFinite(Math.floor(Number(p.get('limit') || NaN))) ? parseLimit(p.get('limit')) : 30;
    // Loop-Bibliothek: Loops sind 128 bpm, ohne pack/camelot; nur ladbare spielen jetzt
    const loopsOk = (typ === undefined || typ === 'loop') && (einsatz === undefined || einsatz === 'sofort') && pack === undefined && camelot === undefined
      && (bpm === undefined || (bpm[0] <= 128 && 128 <= bpm[1]));
    const eigene: KlangTreffer[] = !loopsOk ? [] : leseLoops(this.loopOrdner())
      .filter((l) => l.ladbar && (text === undefined || l.name.includes(text.toLowerCase())))
      .map((l): KlangTreffer => ({ sha: null, pfad: null, pfad_da: true, typ: 'loop', pack: null, kategorie: null, instrument: null, titel: l.name,
        dauer_s: l.beats * 60 / 128, bpm: 128, camelot: null, einsatz: 'sofort', quelle: 'loopbib', name: l.name }));
    if (!this.mediathek.vorhanden()) return this.json(a, 200, { treffer: eigene.slice(0, limit), gesamt: eigene.length, gesamt_genau: true, mediathek: 'fehlt' });
    const m = (einsatz === 'sofort') ? { treffer: [] as KlangTreffer[], gesamt: 0 }
      : this.mediathek.klaenge({ text, typ, pack, einsatz, bpm, camelot, limit: Math.max(1, limit - Math.min(eigene.length, limit)) });
    this.json(a, 200, { treffer: [...eigene, ...m.treffer].slice(0, limit), gesamt: eigene.length + m.gesamt, gesamt_genau: true });
  } catch (e) { this.mediathekFehler(e, a); }
}
export function klaengeKarte(this: Oberflaeche, a: http.ServerResponse): void {
  try {
    const loopbib = leseLoops(this.loopOrdner()).filter((l) => l.ladbar).length;
    const je: Record<string, { gesamt: number; sofort: number; werkstatt: number; nur_live: number }> = {};
    for (const t of KLANG_TYPEN) je[t] = { gesamt: 0, sofort: 0, werkstatt: 0, nur_live: 0 };
    let packs: { pack: string; gesamt: number; nur_live: number }[] = [], stand: string | null = null;
    const fehlt = !this.mediathek.vorhanden();
    if (!fehlt) {
      const st = this.mediathek.stand();
      if (this.karteCache === null || this.karteCache.stand !== st) this.karteCache = { stand: st, karte: this.mediathek.karte() };
      const k = this.karteCache.karte;
      for (const t of KLANG_TYPEN) je[t] = { gesamt: k.je_typ[t].gesamt, sofort: 0, werkstatt: k.je_typ[t].werkstatt, nur_live: k.je_typ[t].nur_live };
      packs = k.packs; stand = k.mediathek_stand;
    }
    je.loop.gesamt += loopbib; je.loop.sofort += loopbib;
    this.json(a, 200, { je_typ: je, packs, loopbib, mediathek_stand: stand, erzeugt_am: new Date().toISOString(), ...(fehlt ? { mediathek: 'fehlt' } : {}) });
  } catch (e) { this.mediathekFehler(e, a); }
}
export function mediathekFehler(this: Oberflaeche, e: unknown, a: http.ServerResponse): void {
  if (e instanceof MediathekFehler) return this.json(a, e.code, { fehler: e.fehler });
  this.opt.log?.({ typ: 'mediathek_fehler', text: (e as Error).message });
  this.json(a, 500, { fehler: 'mediathek_abfrage', text: (e as Error).message });
}
// Browser (Plan 2026-10-10-mediathek-browser): eine Seite des Katalogs je Typ. Status nur für die angezeigten Zeilen.
export function stoebern(this: Oberflaeche, url: URL, a: http.ServerResponse): void {
  try {
    const p = url.searchParams;
    const typ = p.get('typ') ?? 'track';
    if (!(KATALOG_TYPEN as readonly string[]).includes(typ)) throw new KatalogFehler(400, 'typ_ungueltig');
    const t = typ as Typ;
    const sort = p.get('sort') || SORT_VORGABE[t];
    const ab = p.get('richtung') === 'ab';
    const lroh = Math.floor(Number(p.get('limit') ?? SEITE_VORGABE));
    const limit = Number.isFinite(lroh) ? Math.min(SEITE_MAX, Math.max(1, lroh)) : SEITE_VORGABE;
    const sroh = Math.floor(Number(p.get('seite') ?? 0));
    const seite = Number.isFinite(sroh) && sroh > 0 ? sroh : 0;
    if (!Number.isSafeInteger(seite * limit)) throw new KatalogFehler(400, 'seite_ungueltig');   // 1e300 → sonst SQLite „datatype mismatch“ (Review MINOR 5)
    const filter = this.stoebernFilter(p);
    if (Oberflaeche.schutzAus(p)) filter.ohneSchutz = true;
    const vorrang = Oberflaeche.vorrangAn(p);
    const rang = rangVon(this.kollektionSpeicher());   // read once per request: rank for the order, favorit for the rows
    const r = this.katalog.seite(t, filter, sort, ab, seite, limit, vorrang
      ? { fehlend: this.katalog.ordnerSummen(t).ordner.filter((o) => !this.erreichbar.ordnerDa(o.pfad)).map((o) => o.pfad), rang: rang.tabelle } : undefined);
    const bestand = t === 'track' ? bestandIds(this.opt.bestand) : new Set<string>();
    this.json(a, 200, { typ: t, sort, richtung: ab ? 'ab' : 'auf', seite, limit, gesamt: r.gesamt, gebaut_am: r.gebaut_am, ...(vorrang ? { vorrang: true } : {}),
      treffer: r.zeilen.map((z) => ({ ...this.stoebernTreffer(z, bestand), favorit: rang.favorit(z.sha) })) });
  } catch (e) { this.katalogFehler(e, a); }
}
export function kollektionSpeicher(this: Oberflaeche): KollektionSpeicher {
  return this.kollektionLeser ??= this.opt.kollektionen?.speicher ?? new KollektionSpeicher(this.opt.kollektionen ?? {});
}
// STRUDEL im Browser (S2b): ~250 Einträge, deshalb im Speicher filtern/sortieren statt FTS
export async function stoebernMuster(this: Oberflaeche, url: URL, a: http.ServerResponse): Promise<void> {
  try {
    const p = url.searchParams;
    let l = await this.muster.liste();
    // Muster liegen im Speicher (~250): Textvergleich statt FTS. Wörter UND-verknüpft, je Wort Teilstring in Name, Code oder Rolle;
    // name:/rolle: schränken auf ein Feld ein. Die Katalog-Felder (artist:, label:, folder: …) gibt es hier nicht: 400, kein stilles Ignorieren.
    const { terme, ordner, zuviele } = suchTerme(p.get('text') ?? '', ['rolle']);
    if (zuviele) throw new KatalogFehler(400, 'zu_viele_suchwoerter');
    if ((p.get('ordner') ?? '') !== '') throw new KatalogFehler(400, 'filter_nicht_anwendbar');   // Muster liegen in keinem Ordner (S4-Review 6)
    if (ordner.length || terme.some((x) => x.spalte !== null && x.spalte !== 'name' && x.spalte !== 'rolle')) throw new KatalogFehler(400, 'suchfeld_nicht_anwendbar');
    for (const x of terme) {
      const w = x.wert.toLowerCase();
      l = l.filter((e) => x.spalte === 'name' ? e.name.toLowerCase().includes(w) : x.spalte === 'rolle' ? (e.rolle ?? '').includes(w)
        : e.name.toLowerCase().includes(w) || e.text.toLowerCase().includes(w) || (e.rolle ?? '').includes(w));
    }
    Oberflaeche.filterPruefen(p, 'strudel');
    const bpmRoh = p.get('bpm');
    if (bpmRoh) { const [lo, hi] = parseBpm(bpmRoh); l = l.filter((e) => e.bpm !== null && e.bpm >= lo && e.bpm <= hi); }
    const feld = p.get('feld'), wert = p.get('wert') ?? '';
    if (feld === 'quelle') l = l.filter((e) => e.quelle === wert); else if (feld === 'rolle') l = l.filter((e) => (e.rolle ?? '') === wert);
    else if (feld) throw new KatalogFehler(400, 'facette_ungueltig');
    const sort = p.get('sort') || 'name', ab = p.get('richtung') === 'ab';
    if (!['name', 'rolle', 'quelle', 'bpm', 'takte'].includes(sort)) throw new KatalogFehler(400, 'sort_ungueltig');
    const wertVon = (e: MusterEintrag): string | number => (e[sort as keyof MusterEintrag] ?? '') as string | number;
    l.sort((x, y) => { const u = wertVon(x), v = wertVon(y); const c = typeof u === 'number' && typeof v === 'number' ? u - v : String(u).localeCompare(String(v), 'en', { sensitivity: 'base' }); return (ab ? -c : c) || x.id.localeCompare(y.id); });
    const limit = Math.min(SEITE_MAX, Math.max(1, Math.floor(Number(p.get('limit') ?? SEITE_VORGABE)) || SEITE_VORGABE));
    const seite = Math.max(0, Math.floor(Number(p.get('seite') ?? 0)) || 0);
    this.json(a, 200, { typ: 'strudel', sort, richtung: ab ? 'ab' : 'auf', seite, limit, gesamt: l.length, gebaut_am: '',
      treffer: l.slice(seite * limit, (seite + 1) * limit).map((e) => ({ typ: 'strudel', ...e })) });
  } catch (e) { this.katalogFehler(e, a); }
}
export async function stoebernMusterBaum(this: Oberflaeche, a: http.ServerResponse): Promise<void> {
  try {
    const l = await this.muster.liste();
    const zaehle = (werte: string[]): { wert: string; n: number }[] => {
      const z = new Map<string, number>();
      for (const w of werte) z.set(w, (z.get(w) ?? 0) + 1);
      return [...z].map(([wert, n]) => ({ wert, n })).sort((x, y) => y.n - x.n || x.wert.localeCompare(y.wert));
    };
    this.json(a, 200, { ordner: [], facetten: { quelle: zaehle(l.map((e) => e.quelle)), rolle: zaehle(l.map((e) => e.rolle ?? '')) }, gebaut_am: '' });
  } catch (e) { this.katalogFehler(e, a); }
}
// SAVE am Strudel-Deck: gespeichert wird, was die Instanz SPIELT, nie Text aus der Anfrage (Andreas: „das laufende Muster“)
export async function musterSpeichern(this: Oberflaeche, q: http.IncomingMessage, a: http.ServerResponse): Promise<void> {   // fremdePost: Router (Task 9)
  try {
    const d = await this.koerper(q);
    const strom = Oberflaeche.strom(d.strom);
    if (strom === null || strom > 3) return this.json(a, 400, { fehler: 'strom' });   // S18: the pattern library has roles for streams 1..3 only
    const laufend = leseMusterStand(this.musterOrdner(strom)).text;
    const r = this.muster.speichere({ name: String(d.name ?? ''), text: laufend, rolle: (['drums', 'bass', 'melodie'] as const)[strom - 1], strom,
      von: this.quelle(), ueberschreiben: d.ueberschreiben === true });
    this.opt.log?.({ typ: 'muster_gespeichert', name: r.name, strom });
    return this.json(a, 201, r);
  } catch (e) { if (e instanceof MusterFehler) return this.json(a, e.code, { fehler: e.fehler }); throw e; }
}
// Detail-Spalte (S5): der Eintrag, alle gültigen Angaben mit Quelle (Mediathek) und der volle Pfad. Der Pfad geht nur hier an die
// Seite (sie ist lokal), nicht in die Trefferzeilen. Listen-Zeilen kennen nur die material_id: dann ?mid=.
export function stoebernDetail(this: Oberflaeche, url: URL, a: http.ServerResponse): void {
  try {
    const sha = url.searchParams.get('sha'), mid = url.searchParams.get('mid');
    if (sha === null && mid === null) throw new KatalogFehler(400, 'sha_ungueltig');
    const z = sha !== null ? this.katalog.eintrag(sha) : this.katalog.eintragVonMid(mid ?? '');
    if (!z) throw new KatalogFehler(404, 'unbekannt');
    const bestand = z.typ === 'track' ? bestandIds(this.opt.bestand) : new Set<string>();
    const angaben = this.mediathek.vorhanden() ? this.mediathek.angaben(z.shas.split(' ')) : [];
    // Das Objekt, auf das gezeigt wurde (sha, oder mid als Präfix): bei einem unterlegenen Objekt DESSEN Datei, nicht die des Gewinners (B6)
    const objekt = sha !== null ? sha : (z.shas.split(' ').find((x) => x.startsWith(mid ?? '')) ?? z.sha);
    const treffer = this.stoebernTreffer(z, bestand);
    let pfad = z.pfad;
    if (objekt !== z.sha) {
      pfad = this.mediathek.vorhanden() ? this.mediathek.pfadVon(objekt) : null;
      treffer.pfad_da = pfad !== null && fs.existsSync(pfad);
    }
    this.json(a, 200, { eintrag: treffer, angaben, pfad, objekt_sha: objekt });
  } catch (e) { this.katalogFehler(e, a); }
}
export function stoebernBaum(this: Oberflaeche, url: URL, a: http.ServerResponse): void {
  try {
    const typ = url.searchParams.get('typ') ?? 'track';
    if (!(KATALOG_TYPEN as readonly string[]).includes(typ)) throw new KatalogFehler(400, 'typ_ungueltig');
    this.json(a, 200, this.katalog.baum(typ as Typ, { ohneSchutz: Oberflaeche.schutzAus(url.searchParams) }));
  } catch (e) { this.katalogFehler(e, a); }
}
// The sources of one type (sampler roots or disks) with their file counts and whether they are mounted now
export function stoebernQuellen(this: Oberflaeche, url: URL, a: http.ServerResponse): void {
  try {
    const typ = url.searchParams.get('typ') ?? 'track';
    if (!(KATALOG_TYPEN as readonly string[]).includes(typ)) throw new KatalogFehler(400, 'typ_ungueltig');
    const aus = Oberflaeche.schutzAus(url.searchParams);
    const b = this.katalog.ordnerSummen(typ as Typ, { ohneSchutz: aus });   // one sum per folder, not the whole tree; kept until the catalog file changes
    const schluessel = `${typ}|${aus}`, alt = this.quellenMerk.get(schluessel);
    if (alt && alt.b === b && this.jetzt() - alt.t <= ERREICHBAR_TTL_MS) return this.json(a, 200, alt.j);
    const j = { typ, quellen: quellenLage(b.ordner, leseWurzeln({ ordner: this.opt.samplerOrdner }), this.erreichbar), gebaut_am: b.gebaut_am };
    this.quellenMerk.set(schluessel, { b, t: this.jetzt(), j });   // the same 10 s window as the reachability
    this.json(a, 200, j);
  } catch (e) { this.katalogFehler(e, a); }
}
export function stoebernFilter(this: Oberflaeche, p: URLSearchParams): Filter {
  Oberflaeche.filterPruefen(p, p.get('typ') ?? 'track');
  const f: Filter = {};
  const text = p.get('text'); if (text) f.text = text;
  const ordner = p.get('ordner'); if (ordner) f.ordner = ordner;
  const feld = p.get('feld'); if (feld) f.facette = { feld, wert: p.get('wert') ?? '' };
  const cam = p.get('camelot'); if (cam) { f.camelot = cam; f.nachbarn = p.get('nachbarn') === '1'; }
  const bpm = p.get('bpm'); if (bpm) f.bpm = parseBpm(bpm);
  const en = p.get('energie');
  if (en !== null && en !== '') { if (!['0', '1', '2'].includes(en)) throw new KatalogFehler(400, 'energie_ungueltig'); f.energie = Number(en) as 0 | 1 | 2; }
  return f;
}
export function stoebernTreffer(this: Oberflaeche, z: Zeile, bestand: Set<string>): Record<string, unknown> {
  const { shas, pfad, alle: _alle, id: _id, ...rest } = z;
  const pfadDa = pfad !== null && fs.existsSync(pfad);
  const basis: Record<string, unknown> = { ...rest, material_id: z.sha.slice(0, 16), pfad_da: pfadDa, nur_live: z.schutz === 'ableton' };
  if (z.typ === 'loop') {   // S6: ob und warum der Loop in die Box geht — dieselbe Regel wie der Import (beatsVon), die Seite rechnet nichts nach
    try { basis.import_beats = beatsVon(z); } catch (e) { if (e instanceof LoopImportFehler) basis.import_grund = e.fehler; else throw e; }
  }
  if (z.typ !== 'track') return basis;
  const laden = shas.split(' ').map((s) => s.slice(0, 16)).find((m) => bestand.has(m)) ?? null;
  const lauf = this.vorbereiter.stand(basis.material_id);
  const status = laden ? 'ready' : lauf?.status === 'laeuft' ? 'laeuft' : lauf?.status === 'fehler' ? 'fehler' : pfadDa ? 'prepare' : 'missing';
  return { ...basis, status, laden_mid: laden, ...(status === 'fehler' ? { grund: lauf?.grund ?? 'unbekannt', ...(lauf?.name ? { grund_stufe: lauf.name } : {}) } : {}) };
}
// Für die Sets: fehlender, fremder oder kaputter Katalog heißt „kein Eintrag“. Die Sets brauchen ihn nur für die Art-Prüfung,
// er ist abgeleitet und löschbar (Review S1 MAJOR 1). /stoebern meldet den Zustand selbst als 503.
export function katalogEintrag(this: Oberflaeche, mid: string): Zeile | null {
  try { return this.katalog.vorhanden() ? this.katalog.eintragMid(mid) : null; }
  catch (e) { if (e instanceof KatalogFehler) return null; throw e; }
}
// Typ eines Postens für die Art-Prüfung: aus dem Katalog, ohne Katalog (fehlt, fremd, im Neubau) aus der Mediathek selbst
// (Review S2b Befund 1). null = unbekannt; dann gibt es nichts abzuweisen.
export function postenTyp(this: Oberflaeche, mid: string): string | null {
  const k = this.katalogEintrag(mid);
  if (k) return k.typ;
  try { return this.mediathek.vorhanden() ? (this.mediathek.felder([mid], new Set()).get(mid)?.typ ?? null) : null; }
  catch (e) { if (e instanceof MediathekFehler) return null; throw e; }
}
export async function vorhoerenAus(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
  try {
    if (d.aktion === 'stopp') { this.vorhoeren.stoppe(); return this.json(a, 200, { ok: true }); }
    if (d.aktion === 'springe') { this.vorhoeren.springe(Number(d.richtung) < 0 ? -1 : 1); return this.json(a, 200, { ok: true }); }
    // sha (Browser-Zeile) oder mid (Listen-Zeilen tragen bei Tracks nur material_id; Review S7 m3), wie /stoebern/detail
    const z = typeof d.sha === 'string' && d.sha ? this.katalog.eintrag(d.sha) : this.katalog.eintragVonMid(String(d.mid ?? ''));
    if (!z) throw new KatalogFehler(404, 'unbekannt');
    if (z.schutz === 'ableton') throw new KatalogFehler(409, 'nur_live');
    if (!z.pfad || !fs.existsSync(z.pfad)) throw new KatalogFehler(409, 'datei_fehlt');
    await this.vorhoeren.spiele({ pfad: z.pfad, typ: z.typ, sha: z.sha, bpm: z.bpm });
    this.json(a, 200, { ok: true, ...(await this.vorhoeren.stand()) });
  } catch (e) {
    if (e instanceof VorhoerFehler) return this.json(a, e.code, { fehler: e.fehler });
    this.katalogFehler(e, a);
  }
}
export function katalogFehler(this: Oberflaeche, e: unknown, a: http.ServerResponse): void {
  if (e instanceof KatalogFehler || e instanceof MediathekFehler) return this.json(a, e.code, { fehler: e.fehler });
  this.opt.log?.({ typ: 'katalog_fehler', text: (e as Error).message });
  this.json(a, 500, { fehler: 'katalog_abfrage', text: (e as Error).message });
}
// Sets (Plan 2026-10-03-sets-mit-tracks). Kein Kern-Befehl; Dateien unter opt.sammlungen.
export async function sammlungRoute(this: Oberflaeche, q: http.IncomingMessage, url: URL, a: http.ServerResponse): Promise<void> {
  try {   // fremdePost für POST: Router (Task 9)
    if (url.pathname === '/sammlungen') {
      if (q.method === 'GET') return this.json(a, 200, this.sammlungen.liste(url.searchParams.get('art') ?? undefined));
      if (q.method === 'POST') { const d = await this.koerper(q); return this.json(a, 201, { slug: this.sammlungen.lege(String(d.name ?? ''), [], String(d.art ?? 'set')) }); }
    }
    if (url.pathname === '/sammlungen/import' && q.method === 'POST') {
      const d = await this.koerper(q);
      const art = String(d.art ?? 'set');
      if (art !== 'set' && art !== 'playlist') return this.json(a, 400, { fehler: 'art_unbekannt' });   // Traktor-Listen sind Tracks
      const l = this.mediathek.listeMids(Number(d.liste_id));
      const slug = this.sammlungen.lege(l.name, l.mids.map((m, i) => ({ id: `p${i + 1}`, art: 'track' as const, material_id: m })), art);
      return this.json(a, 201, { slug, posten: l.mids.length });
    }
    const m = url.pathname.match(/^\/sammlungen\/([^/]+)(\/posten|\/posten\/entfernen|\/posten\/verschieben|\/umbenennen|\/vorbereiten|\/loeschen)?$/);
    if (!m) return this.json(a, 404, { fehler: 'nicht_gefunden' });
    const slug = decodeURIComponent(m[1]), was = m[2] ?? '';
    if (q.method === 'GET' && was === '') return this.json(a, 200, await this.sammlungAnsicht(slug));
    if (q.method === 'POST' && was === '/posten') {
      const d = await this.koerper(q);
      // Ein Loop/Sample darf nie als Track ins Set (sonst schickt PREPARE ALL ihn in die Werkstatt; Review M6)
      const art = String(d.art ?? ''), ref = String(art === 'muster' ? d.ref ?? '' : d.material_id ?? '');
      if (art !== 'muster') {
        const typ = this.postenTyp(ref);
        if (typ !== null && typ !== art && (art === 'track' || typ === 'track')) return this.json(a, 400, { fehler: 'art_passt_nicht' });
      }
      const r = await this.wiederhole(() => this.sammlungen.legeHinzu(slug, art, ref, typeof d.notiz === 'string' ? d.notiz : undefined));
      return this.json(a, r.schon_drin ? 200 : 201, r.schon_drin ? r : { id: r.id });
    }
    if (q.method === 'POST' && was === '/posten/entfernen') { const d = await this.koerper(q); await this.wiederhole(() => this.sammlungen.entferne(slug, String(d.id ?? ''))); return this.json(a, 200, { ok: true }); }
    if (q.method === 'POST' && was === '/posten/verschieben') { const d = await this.koerper(q); await this.wiederhole(() => this.sammlungen.verschiebe(slug, String(d.id ?? ''), Number(d.nach))); return this.json(a, 200, { ok: true }); }
    if (q.method === 'POST' && was === '/umbenennen') { const d = await this.koerper(q); await this.wiederhole(() => this.sammlungen.benenne(slug, String(d.name ?? ''))); return this.json(a, 200, { ok: true }); }
    if (q.method === 'POST' && was === '/vorbereiten') {
      const ansicht = await this.sammlungAnsicht(slug) as { posten: { art: string; material_id: string; status: string }[] };
      return this.json(a, 202, { eingereiht: this.reihe(ansicht.posten.filter((p) => p.art === 'track' && p.status === 'prepare').map((p) => p.material_id)) });
    }
    if (q.method === 'POST' && was === '/loeschen') { this.sammlungen.loesche(slug); return this.json(a, 200, { ok: true }); }
    return this.json(a, 404, { fehler: 'nicht_gefunden' });
  } catch (e) {
    if (e instanceof SammlungFehler) return this.json(a, e.code, { fehler: e.fehler });
    this.mediathekFehler(e, a);
  }
}
export async function sammlungAnsicht(this: Oberflaeche, slug: string): Promise<Record<string, unknown>> {
  const s = this.sammlungen.lies(slug);
  const bestand = bestandIds(this.opt.bestand);
  const mids = s.posten.filter((p) => p.art === 'track').map((p) => p.material_id as string);
  const felder = this.mediathek.vorhanden() ? this.mediathek.felder(mids, bestand) : new Map();
  const muster = s.posten.some((p) => p.art === 'muster') ? await this.muster.liste() : [];
  const posten = s.posten.map((p) => {
    if (p.art === 'muster') {
      const e = muster.find((m) => m.id === p.ref);
      return { ...p, titel: e?.name ?? p.ref ?? null, rolle: e?.rolle ?? null, bpm: e?.bpm ?? null, status: e ? 'ready' : 'missing',
        eintrag: e ? { typ: 'strudel', ...e } : { typ: 'strudel', id: p.ref, name: p.ref, quelle: null, rolle: null, bpm: null, takte: null, text: '', ladbar: false } };
    }
    if (p.art !== 'track') {
      const z = this.katalogEintrag(p.material_id ?? '');
      return { ...p, titel: z?.name ?? null, kuenstler: null, mix: null, bpm: z?.bpm ?? null, camelot: z?.camelot ?? null, energie: null,
        genre: null, dauer_s: z?.dauer_s ?? null, status: z?.pfad && fs.existsSync(z.pfad) ? 'ready' : 'missing', laden_mid: null,
        eintrag: z ? this.stoebernTreffer(z, new Set()) : { typ: p.art, material_id: p.material_id, name: null, pfad_da: false, nur_live: false } };
    }
    const k = this.katalogEintrag(p.material_id as string);
    if (k && k.typ !== 'track') return { ...p, titel: k.name, kuenstler: null, mix: null, bpm: k.bpm, camelot: k.camelot, energie: null,
      genre: null, dauer_s: k.dauer_s, status: 'kein_track', laden_mid: null, eintrag: this.stoebernTreffer(k, new Set()) };
    // Without the media library (another machine) the own catalog tells what the track is: same fields, a track whose file is there is 'prepare'
    const f = felder.get(p.material_id as string) ?? (k ? { titel: k.titel ?? k.name, kuenstler: k.kuenstler, mix: k.mix, bpm: k.bpm, camelot: k.camelot,
      energie: k.energie, genre: k.genre, dauer_s: k.dauer_s, bestand_mid: null, pfad_da: !!k.pfad && fs.existsSync(k.pfad) } : undefined);
    const lauf = this.vorbereiter.stand(p.material_id);
    let status = 'unbekannt', laden: string | null = null, grund: string | undefined, grundStufe: string | undefined;
    if (f?.bestand_mid) { status = 'ready'; laden = f.bestand_mid; }
    else if (bestand.has(p.material_id)) { status = 'ready'; laden = p.material_id; }
    else if (lauf?.status === 'laeuft') status = 'laeuft';
    else if (this.warteschlange.includes(p.material_id)) status = 'wartet';
    else if (lauf?.status === 'fehler') { status = 'fehler'; grund = lauf.grund; grundStufe = lauf.name; }
    else if (f) status = f.pfad_da ? 'prepare' : 'missing';
    return { ...p, titel: f?.titel ?? null, kuenstler: f?.kuenstler ?? null, mix: f?.mix ?? null, bpm: f?.bpm ?? null, camelot: f?.camelot ?? null, energie: f?.energie ?? null,
      genre: f?.genre ?? null, dauer_s: f?.dauer_s ?? null, status, laden_mid: laden, ...(grund ? { grund, ...(grundStufe ? { grund_stufe: grundStufe } : {}) } : {}),
      eintrag: { typ: 'track', material_id: p.material_id, titel: f?.titel ?? null, kuenstler: f?.kuenstler ?? null, mix: f?.mix ?? null, bpm: f?.bpm ?? null, camelot: f?.camelot ?? null,
        energie: f?.energie ?? null, genre: f?.genre ?? null, dauer_s: f?.dauer_s ?? null, status, laden_mid: laden, pfad_da: f?.pfad_da ?? false } };
  });
  return { slug, name: s.name, art: s.art ?? 'set', notiz: s.notiz, posten, uebersicht: uebersicht(posten.filter((p) => p.art === 'track')) };
}
// „Alles vorbereiten": Warteschlange vor dem Vorbereiter (der nimmt höchstens zwei zugleich, sonst 'ausgelastet').
export function reihe(this: Oberflaeche, mids: string[]): number {
  let n = 0;
  for (const m of mids) if (!this.warteschlange.includes(m) && this.vorbereiter.stand(m)?.status !== 'laeuft') { this.warteschlange.push(m); n++; }
  this.pumpe();
  return n;
}
export function pumpe(this: Oberflaeche): void {
  if (this.pumpeTimer) { clearTimeout(this.pumpeTimer); this.pumpeTimer = null; }
  if (this.gestoppt) return;
  while (this.warteschlange.length) {
    const mid = this.warteschlange[0];
    let q;
    try { q = vorbereitQuelle(this.mediathek, this.katalog, mid, bestandIds(this.opt.bestand)); }
    catch (e) { this.opt.log?.({ typ: 'set_vorbereiten_uebersprungen', material_id: mid, fehler: (e as Error).message }); this.warteschlange.shift(); continue; }
    if (q.vorhanden !== undefined) { this.warteschlange.shift(); continue; }
    if (this.vorbereiter.starte(mid, q.pfad, q.titel) === 'ausgelastet') break;
    this.warteschlange.shift();
  }
  if (this.warteschlange.length) this.pumpeTimer = setTimeout(() => this.pumpe(), 2000);
}
export function vorbereitenStand(this: Oberflaeche, url: URL, a: http.ServerResponse): void {
  const mid = url.searchParams.get('material_id') ?? '';
  const st = this.vorbereiter.stand(mid);
  if (st) return this.json(a, 200, st);
  if (bestandIds(this.opt.bestand).has(mid)) return this.json(a, 200, { status: 'vorhanden' });
  this.json(a, 404, { fehler: 'unbekannt' });
}
export async function vorbereiten(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
  try {
    const mid = typeof d.material_id === 'string' ? d.material_id : '';
    const imBestand = bestandIds(this.opt.bestand);
    if (imBestand.has(mid)) return this.json(a, 200, { material_id: mid, status: 'vorhanden' });
    const q = vorbereitQuelle(this.mediathek, this.katalog, mid, imBestand);   // 400 / 404 / 409 datei_fehlt / 503 mediathek_fehlt; ohne Mediathek aus dem eigenen Katalog
    if (q.vorhanden !== undefined) return this.json(a, 200, { material_id: q.vorhanden, status: 'vorhanden' });   // anderes Objekt desselben Werks liegt schon im Bestand
    const r = this.vorbereiter.starte(mid, q.pfad, q.titel);
    if (r === 'ausgelastet') return this.json(a, 429, { fehler: 'ausgelastet' });
    if (r === 'gestartet') this.opt.log?.({ typ: 'vorbereiten', material_id: mid, quelle: q.pfad });
    this.json(a, 202, { material_id: mid, status: 'laeuft' });
  } catch (e) { this.mediathekFehler(e, a); }
}
// Laden: Eintrag aus dem Index, dann Kopie in den Arbeitsbestand (geprüft), erst dann /k/deck/laden.
export async function laden(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
  const deck = d.deck;
  // Ohne genannte Fassung die neueste derselben Basis: der Index ist nach Fassung aufsteigend sortiert, ein find()
  // nahm r1 und ließ jede Korrektur (r2, r3 … aus `korrigieren`) liegen (gemessen 2026-10-09, Phase-Korrektur).
  const passend = leseBestand(this.opt.bestand).filter((e) => e.material_id === d.material_id
    && e.fassung === (d.fassung ?? e.fassung) && e.basis_bpm === (d.basis_bpm ?? e.basis_bpm));
  const eintrag = passend.filter((e) => e.basis_bpm === passend[0].basis_bpm)
    .reduce<typeof passend[number] | undefined>((m, e) => (m === undefined || e.fassung > m.fassung ? e : m), undefined);
  if (!istOffenesDeck(deck)) return this.json(a, 400, { fehler: 'unbekanntes_deck', deck });
  // Plan seq-fader-frei D4: a part of Cypher that still acts on deck/N/fader|trim (opened under the empty-deck exemption)
  // must not meet a track Cypher loads now
  if (this.quelle() === 'cypher' && this.seqRampeLaeuft(deck)) {
    return this.json(a, 409, { fehler: 'kanal_offen', kanal: `deck/${deck}`,
      text: `a ramp of Cypher is still acting on deck/${deck} of a SEQ deck place; wait until it has ended before a track is loaded there` });
  }
  // Befund 4: nicht im Index ist ein anderer Fall als eine fehlende Datei der Fassung (material_fehlt aus der Kopie)
  if (!eintrag) return this.json(a, 400, { fehler: 'nicht_im_index', material_id: d.material_id });
  let kopie;
  try {
    kopie = await inArbeitsbestand(this.opt.bestand, this.opt.arbeitsbestand, eintrag.material_id, eintrag.basis_bpm, eintrag.fassung);
  } catch (e) {
    const code = e instanceof KopieFehler ? e.code : 'pruefung';
    this.opt.log?.({ typ: 'kopie_abgewiesen', material_id: eintrag.material_id, fehler: code, text: (e as Error).message });
    return this.json(a, 400, { fehler: code, material_id: eintrag.material_id, text: (e as Error).message });
  }
  this.opt.log?.({ typ: 'kopie', material_id: eintrag.material_id, kopiert: kopie.kopiert, bytes: kopie.bytes, dauer_ms: kopie.dauer_ms });
  const id = Number(++this.id);
  const felder = { id, quelle: this.quelle(), deck, material_id: eintrag.material_id, basis_bpm: eintrag.basis_bpm,
    fassung: eintrag.fassung, mit_stems: kopie.mit_stems };
  this.kern.sende('/k/deck/laden', felder);
  this.gesendet++;
  this.json(a, 200, { ok: true, gesendet: '/k/deck/laden', felder,
    kopie: { kopiert: kopie.kopiert, bytes: kopie.bytes, dauer_ms: kopie.dauer_ms } });
}
