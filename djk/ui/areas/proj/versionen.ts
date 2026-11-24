// Project versions (spec B10), routes: GET /proj/versionen, POST /proj/version_sichern {name}, POST /proj/version_zurueck {id}.
// Pattern of aufnahmeBereich. Error answers carry {ok:false, grund, text} next to the usual {fehler, text} (route contract, plan 3).
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import type { VersionEintrag } from '../../project/versionen.ts';
import { alsAntwort, leseKoerper } from './area.ts';
import type { Antwort } from './session.ts';

// the narrow interface of this Bereich; ProjSitzung implements it
export interface VersionenZugang {
  versionen(): VersionEintrag[];
  versionSichern(name: string, quelle: string): Promise<{ id: string }>;
  versionZurueck(id: string, quelle: string): Promise<{ gesichert_als: string }>;
}

export function versionenBereich(ctx: BereichKontext, zugang: VersionenZugang): Bereich {
  const antworte = async (r: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
    let x: Antwort;
    try { x = await f(); } catch (e) {
      const a = alsAntwort(e, ctx);
      const j = a.j as { fehler?: string };
      x = { code: a.code, j: { ok: false, ...(j.fehler !== undefined ? { grund: j.fehler } : {}), ...(a.j as object) } };
    }
    json(r, x.code, x.j);
  };
  const routen = (): Route[] => [
    { methode: 'GET', pfad: '/proj/versionen', schutz: 'offen', handler: (_q, r) => antworte(r, () => ({ code: 200, j: { versionen: zugang.versionen() } })) },
    { methode: 'POST', pfad: '/proj/version_sichern', schutz: 'fremdePost', handler: (q, r) => antworte(r, async () => {
      const quelle = ctx.quelle();
      const d = await leseKoerper(q);
      const v = await zugang.versionSichern(typeof d.name === 'string' ? d.name : '', quelle);
      return { code: 200, j: { ok: true, id: v.id } };
    }) },
    { methode: 'POST', pfad: '/proj/version_zurueck', schutz: 'fremdePost', handler: (q, r) => {
      const quelle = ctx.quelle();
      return antworte(r, async () => {
        const d = await leseKoerper(q);
        const v = await zugang.versionZurueck(typeof d.id === 'string' ? d.id : '', quelle);
        return { code: 200, j: { ok: true, gesichert_als: v.gesichert_als } };
      });
    } },
  ];
  return { name: 'proj-versionen', routen };
}
