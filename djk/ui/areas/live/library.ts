// Plan live-module task 10 (spec 6.7): the module library. GET /module lists and searches the saved modules by origin (title, artist, set, date, key),
// POST /modul/einsetzen {modul_id, slot?} places one as a top group into the open project (audio copied into the project, one undo step),
// POST /modul/speichern {gruppe_id} saves a top group of the open project as a module. The store is projekt/modul_ablage.ts.
import path from 'node:path';
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { aendereStand, StandFehler } from '../../project/state.ts';
import { EinsetzFehler, liesModul, listeModule, setzeModulEin, speichereModul } from '../../project/module_storage.ts';
import { alsAntwort, leseKoerper, type ProjZugang } from '../proj/area.ts';
import { ProjFehler, type Antwort } from '../proj/session.ts';

export interface BibliothekOptionen { basis: () => string; jetzt?: () => Date }
type Quelle = 'andreas' | 'cypher';

const nurSchluessel = (d: Record<string, unknown>, ...erlaubt: string[]): void => {
  for (const k of Object.keys(d)) if (!erlaubt.includes(k)) throw new ProjFehler(400, 'argument_unbekannt', { detail: k });
};

export interface Bibliothek {
  liste(url: URL): Antwort;
  einsetzen(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort>;
  speichern(d: Record<string, unknown>, quelle: Quelle): Antwort;
}
export function bibliothekBereich(ctx: BereichKontext, zugang: ProjZugang, o: BibliothekOptionen): Bereich & Bibliothek {
  const gesperrt = (quelle: Quelle): void => { if (quelle === 'cypher' && ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt'); };

  const liste = (url: URL): Antwort => {
    const q = url.searchParams.get('q') ?? '', sha = url.searchParams.get('sha') ?? undefined;
    return { code: 200, j: { module: listeModule({ basis: o.basis(), q, sha }) } };
  };

  const einsetzen = async (d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> => {
    nurSchluessel(d, 'modul_id', 'slot');
    if (typeof d.modul_id !== 'string') throw new ProjFehler(400, 'argument_ungueltig', { detail: 'modul_id: the id of a saved module' });
    if (d.slot !== undefined && d.slot !== 'A' && d.slot !== 'B') throw new ProjFehler(400, 'argument_ungueltig', { detail: "slot: 'A' or 'B'" });
    gesperrt(quelle);
    const basis = o.basis();
    const j = liesModul(d.modul_id, basis);
    if (!j) throw new ProjFehler(404, 'modul_unbekannt');
    const offen = zugang.offen();
    if (!offen) throw new ProjFehler(409, 'kein_projekt');
    try {
      const r = setzeModulEin(offen.projekt, j, { modulOrdner: path.join(basis, j.id), audioZiel: path.join(offen.ordner, 'loops'), quelle,
        slot: d.slot as 'A' | 'B' | undefined, ...(o.jetzt ? { jetzt: o.jetzt } : {}) });
      const meta = { quelle, label: `Place module ${j.herkunft?.titel ?? j.gruppen[0].name}`.slice(0, 80) };
      const w = aendereStand(offen.verlauf, offen.projekt, r.projekt, meta, zugang.haken());
      await zugang.uebernimm(w, meta);
      const jetzt = zugang.offen()!.projekt;
      const g = jetzt.gruppen.find((x) => x.id === r.gruppeId)!;
      return { code: 200, j: { gruppe_id: r.gruppeId, name: g.name, ...(g.modul?.slot ? { slot: g.modul.slot } : {}), rev: jetzt.rev,
        spuren: j.spuren.length, gruppen: j.gruppen.length, ...(r.audio_fehlt.length ? { audio_fehlt: r.audio_fehlt } : {}) } };
    } catch (e) {
      if (e instanceof EinsetzFehler) throw new ProjFehler(e.code, e.fehler, e.extra);
      if (e instanceof StandFehler) throw new ProjFehler(409, e.grund, { text: e.text, detail: e.detail });
      throw e;
    }
  };

  const speichern = (d: Record<string, unknown>, quelle: Quelle): Antwort => {
    nurSchluessel(d, 'gruppe_id');
    if (typeof d.gruppe_id !== 'string') throw new ProjFehler(400, 'argument_ungueltig', { detail: 'gruppe_id: the id of a top group' });
    gesperrt(quelle);
    const offen = zugang.offen();
    if (!offen) throw new ProjFehler(409, 'kein_projekt');
    const g = offen.projekt.gruppen.find((x) => x.id === d.gruppe_id);
    if (!g) throw new ProjFehler(404, 'gruppe_unbekannt');
    if (g.ausgang !== undefined) {
      throw new ProjFehler(400, 'argument_ungueltig', { detail: 'gruppe_id: only a top group (one that plays into the master) can be saved' });
    }
    const r = speichereModul(offen.projekt, g.id, { basis: o.basis(), ...(o.jetzt ? { jetzt: o.jetzt } : {}) });
    const fehlt = liesModul(r.id, o.basis())?.audio_fehlt;
    return { code: 200, j: { modul_id: r.id, pfad: r.pfad, ...(fehlt?.length ? { audio_fehlt: fehlt } : {}) } };
  };

  const antworte = async (r: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
    let x: Antwort;
    try { x = await f(); } catch (e) { x = alsAntwort(e, ctx); }
    json(r, x.code, x.j);
  };
  const routen = (): Route[] => [
    { methode: 'GET', pfad: '/module', schutz: 'offen', handler: async (_q, r, url) => antworte(r, () => liste(url)) },
    { methode: 'POST', pfad: '/modul/einsetzen', schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();
      await antworte(r, async () => einsetzen(await leseKoerper(q), quelle));
    } },
    { methode: 'POST', pfad: '/modul/speichern', schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();
      await antworte(r, async () => speichern(await leseKoerper(q), quelle));
    } },
  ];
  return { name: 'modul-bibliothek', routen, liste, einsetzen, speichern };
}
