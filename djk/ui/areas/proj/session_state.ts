import { modAutoAntwort, modulatorenLage } from './state.ts';
import type { Quelle } from './core_path.ts';
import { type Antwort, type Koerper, ProjFehler, ohneNoten } from './session_helpers.ts';
import type { ProjSitzung } from './session.ts';

// ansicht (Spec 6.30, Leistung): 'voll' (die Seite), 'noten_zahl' (Werkzeug proj_lage: je MIDI-Clip noten_zahl statt noten), 'rev' ({slug, rev}
// für das Werkzeug, bevor es schreibt)
export function aktuell(this: ProjSitzung, ansicht: 'voll' | 'noten_zahl' | 'rev' = 'voll'): Antwort {
  const o = this.offen;
  if (ansicht === 'rev') return { code: 200, j: { slug: o?.slug ?? null, rev: o?.projekt.rev ?? null } };
  // Spec 6.34: die Seite (ansicht voll) bekommt immer ausgabe_lauf, damit ein Reload mitten in einem Freeze oder Export ihn sieht
  const lauf = ansicht === 'voll' ? { ausgabe_lauf: this.ausgabeLauf } : {};
  if (!o) return { code: 200, j: { slug: null, projekt: null, kern: null, ...lauf } };
  const a = this.lage.arr;
  this.raeumeNummern(o.projekt);
  const projekt = ansicht === 'noten_zahl'
    ? ohneNoten(o.projekt, (sid, ziel) => this.istUebersteuert(sid, ziel), (nr) => this.lage.midiZaehler(nr)) : o.projekt;
  // Slice 3a (T8): laufende Analysen dieses Projekts, flüchtig (nie im Projekt); nur wenn welche laufen, damit sich sonst nichts an der Antwort ändert
  const an = this.analysen?.stand(o.slug) ?? [];
  const limiter = a && Number.isFinite(a.limiter_db) ? { limiter_db: a.limiter_db } : {};   // D12: absent without core state or from an older core
  const kern = { rev_geladen: a ? a.nr : null, status: a ? a.status : null, ...limiter, ...(this.lage.insHost ? { ins_host: this.lage.insHost } : {}) };
  // the page (full view) learns the overridden fields from here after a reload (D8); only present when something is overridden
  const ueber = ansicht === 'voll' ? this.uebersteuertListe(o.projekt) : [];
  const mods = ansicht === 'noten_zahl' ? modulatorenLage(o.projekt, this.lage) : undefined;   // proj_lage lists the modulators in readable form (strand 6)
  return { code: 200, j: { slug: o.slug, projekt, kern, ...lauf, ...(mods ? { modulatoren: mods } : {}), ...(an.length ? { analyse: an } : {}),
    ...(o.vorhoeren.size ? { vorhoeren: Object.fromEntries(o.vorhoeren) } : {}),
    // plugins: the T7 name; hosts: the name the plan, the page and proj_lage use
    ...(this.hosts.lage().length ? { plugins: this.hosts.lage(), hosts: this.hosts.lage() } : {}),
    ...(this.instrumente.lage().length ? { instrumente: this.instrumente.lage() } : {}),
    ...(ueber.length ? { auto_uebersteuert: ueber } : {}), ...(this.aufAuto.istArm() ? { auto_arm: this.aufAuto.ansicht() } : {}),
    ...(this.stemsStand && this.stemsStand.slug === o.slug ? { stems: this.stemsStand } : {}),
    ...(this.notenStand && this.notenStand.slug === o.slug ? { noten: this.notenStand } : {}) } };
}

// zeit in Millisekunden seit 1970 (Festlegung V1, Seite rechnet damit), volle Liste
export function verlaufListe(this: ProjSitzung): Antwort {
  const o = this.brauchOffen();
  return { code: 200, j: o.verlauf.liste().map((e) => ({ ...e, zeit: Date.parse(e.zeit) })) };
}

// strand 6 task 2.1: proj_auto {mod_id}: the live offsets of one modulator
export function modAutoLage(this: ProjSitzung, modId: string): Antwort {
  const o = this.brauchOffen();
  const a = modAutoAntwort(o.projekt, modId, this.lage);
  if (!a) throw new ProjFehler(404, 'mod_unbekannt', { text: `no modulator ${modId}` });
  return { code: 200, j: a };
}

// --- S17: sound snapshot ------------------------------------------------------------------------------------------------
// GET /proj/bk: saved against live for every channel of the table
export function bkLage(this: ProjSitzung): Antwort {
  const o = this.brauchOffen();
  return { code: 200, j: this.bk.ansicht(o.projekt, o.slug) };
}

// POST /proj/bk/merken {kanaele?, rev?}: ONE aendern call (one undo step). Runs outside `seriell` because aendern is serialised itself.
export async function bkMerken(this: ProjSitzung, d: Koerper, quelle: Quelle): Promise<Antwort> {
  const o = this.brauchOffen();
  this.riegel(quelle);
  const { befehle, unbekannt, gemerkt } = this.bk.befehleZumMerken(o.projekt, d.kanaele);
  const r = await this.aendern({ rev: d.rev ?? o.projekt.rev, befehle, label: 'Cypher Modular: save sound' }, quelle);
  return r.code === 200 ? { code: 200, j: { ...(r.j as object), bk: { gemerkt, unbekannt } } } : r;
}

// POST /proj/bk/laden {kanaele?}: apply the saved sound now; an explicit load always sends the graph again
export function bkLaden(this: ProjSitzung, d: Koerper, quelle: Quelle): Promise<Antwort> {
  return this.seriell(async () => {
    const o = this.brauchOffen();
    this.riegel(quelle);
    const nur = this.bk.kanaeleArg(d.kanaele);
    const baukasten = await this.bk.wiederherstellen(o.projekt, quelle, { schonGeladenUeberspringen: false, nur });
    return { code: 200, j: { slug: o.slug, baukasten } };
  });
}
