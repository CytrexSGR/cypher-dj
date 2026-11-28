// Start and stop of the page server: servers, tablet listener, hand and coupling route tables (methods of Oberflaeche).
// Moved unchanged out of server.ts (pure move): plain functions bound to the Oberflaeche instance with `this`; the class keeps one-line delegations.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { TABLET_PORT, baueTabletHandler, heimAdresse } from '../../http/coupling.ts';
import { type Route } from '../../http/router.ts';
import { sichereWerksProbenImStandardOrdner } from '../../sampler/werksproben.ts';
import { raeumeWaisenImStandardOrdner } from '../../sampler/waisen.ts';
import { projektWurzelVorgabe } from '../../project/storage.ts';
import { raeumeAuf } from '../../working_inventory.ts';
import { raeumeImportReste } from '../../loop_import.ts';
import { instanz } from '../../paths.ts';
import { pruefeKatalogBeiStart } from '../../catalog_job.ts';
import { modulBasisVon } from '../../server_kopf.ts';
import type { Eintrag } from '../../server_kopf.ts';
import { Oberflaeche } from '../../server.ts';

export async function starte(this: Oberflaeche): Promise<void> {
  const gemerkt = this.leseOffenesProjektDatei();   // read before anything can overwrite it
  // note editor B4: the render service knows the engine version and the cache before the first project opens; every stand then goes through it
  await this.notenRender.start();
  this.harmonie.lade();   // the live lane comes back from the folder of stream 2
  this.proj.zugang.beiStand((p) => this.notenRender.beiStand(p));
  this.proj.sitzung.setzeNotenRender(this.notenRender);
  this.proj.sitzung.beiOffen((slug) => this.merkeOffenesProjekt(slug));
  this.proj.zugang.beiStand(() => this.meldeTaktart());   // studio-taktart: also after undo; the meter follows the open project
  this.proj.sitzung.beiOffen(() => this.meldeTaktart());   // and after a close on purpose (no project: 4)
  // first call: removes a stale meter file left by a crash. With a remembered project it waits for the reopen (which publishes the meter itself),
  // otherwise running n/4 generators would see "missing = 4" and flip to 4 in between; if the reopen fails, projektWiederOeffnen makes the call.
  if (gemerkt === null) this.meldeTaktart();
  this.spurenLaden();   // Studio S6 F2
  this.ladeAktiveLoops();   // gemerkter Deck-Loop von vor dem Neustart
  this.ladeNeustartStand();   // t_7f487235: FX, Boxen, Graphen und ihre Besitzer von vor dem Neustart
  const reste = raeumeAuf(this.opt.arbeitsbestand);
  if (reste > 0) this.opt.log?.({ typ: 'aufgeraeumt', anzahl: reste, arbeitsbestand: this.opt.arbeitsbestand });
  const importReste = raeumeImportReste(this.loopOrdner());   // S6: Arbeitsordner eines abgestürzten Loop-Imports
  if (importReste > 0) this.opt.log?.({ typ: 'loop_import_aufgeraeumt', anzahl: importReste });
  const werks = sichereWerksProbenImStandardOrdner();   // the factory samples of the amiga device: no amiga graph translates without them
  if (werks.length > 0) this.opt.log?.({ typ: 'werksproben_angelegt', dateien: werks });
  // slot banks (amiga-<hex>, smp-p*.f32) that no project or module names any more: old ones go, see sampler/waisen.ts
  const waisen = raeumeWaisenImStandardOrdner([this.opt.proj?.wurzel ?? projektWurzelVorgabe(instanz()), modulBasisVon(this.opt.modulOrdner, instanz())]);
  if (waisen.graphen.length + waisen.samples.length > 0 || waisen.uebersprungen !== null) this.opt.log?.({ typ: 'waisenbaenke_aufgeraeumt', ...waisen });
  await this.kern.starte();
  this.ohrTakt = setInterval(() => { this.ohr.lies(); this.hoerscheinTakt(); }, 100);  // Ohr T5/T10: Ring 100 ms nachlesen, je neuem Takt Hörscheine
  this.graphTakt = setInterval(() => { if (this.generation !== null) this.fragGraphen('takt'); }, Oberflaeche.GRAPH_FRAGE_MS);   // Baukasten S16
  this.graphTakt.unref();
  this.schluessel.sichereLokal();   // the local hand's key file exists before anything can ask for it
  this.http = http.createServer((q, a) => { this.anfrage(q, a).catch((e: Error) => this.json(a, 500, { fehler: e.message })); });
  await new Promise<void>((ok, fehler) => {
    this.http!.once('error', fehler);
    this.http!.listen(this.opt.port, '127.0.0.1', () => ok());
  });
  await this.starteTablet();
  void pruefeKatalogBeiStart(this.katalogJob, instanz(), this.opt.log);   // the studio only: a changed music tree starts one build
  this.projektWieder = this.projektWiederOeffnen(gemerkt);
}
// The second listener (task 10): only when tablet.json says so, only on the home-network address found from the interfaces, only with a pairing cookie
// (http/coupling.ts). Any problem leaves it off and the loopback page running; it never falls back to another address.
export async function starteTablet(this: Oberflaeche): Promise<void> {
  const t = this.opt.tablet;
  if (!t && instanz() !== '') return;   // a test instance never reads the live config
  const konfigPfad = t?.konfigPfad ?? path.join(os.homedir(), '.config', 'cypherdj', 'tablet.json');
  let an = false;
  try { an = (JSON.parse(fs.readFileSync(konfigPfad, 'utf8')) as { an?: unknown }).an === true; } catch { /* no file: off */ }
  if (!an) return;
  const adresse = heimAdresse((t?.schnittstellen ?? os.networkInterfaces)());
  if (adresse === null) { this.opt.log?.({ typ: 'tablet_verweigert', grund: 'keine_heimnetz_adresse' }); return; }
  const port = t?.port ?? TABLET_PORT;
  const host = `${adresse}:${port}`;
  this.tabletHandler = baueTabletHandler({ kopplung: this.kopplung, host, json: (a, c, d) => this.json(a, c, d), log: (z) => this.opt.log?.(z),
    logMs: t?.logMs, weiter: (q, a) => this.qs.run('andreas', () => this.anfrageInnen(q, a, `http://${host}`)) });   // a paired tablet is Andreas, whatever x-djk-quelle says
  const handler = this.tabletHandler;
  const server = http.createServer((q, a) => { handler.anfrage(q, a).catch((e: Error) => this.json(a, 500, { fehler: e.message })); });
  try {
    await new Promise<void>((ok, fehler) => { server.once('error', fehler); server.listen(port, t?.bindeAn ?? adresse, () => ok()); });
  } catch (e) { this.opt.log?.({ typ: 'tablet_verweigert', grund: 'bind', text: (e as Error).message }); this.tabletHandler = null; return; }
  this.tabletServer = server;
  this.tablet = { adresse, port };
  this.opt.log?.({ typ: 'tablet_an', adresse, port });
}
// Andreas only, from the loopback page: not the tablet, not a rebinding host name, not source cypher.
export function nurAndreasLoopback(this: Oberflaeche, q: http.IncomingMessage, a: http.ServerResponse, text: string): boolean {
  const vomTablet = this.tablet !== null && q.socket.localPort === this.tablet.port;
  if (vomTablet) { this.json(a, 403, { fehler: 'nicht_am_tablet' }); return false; }
  const host = String(q.headers.host ?? '');   // only a loopback name: a rebinding page must not reach this
  if (host !== `127.0.0.1:${this.opt.port}` && host !== `localhost:${this.opt.port}`) {
    this.json(a, 421, { fehler: 'falscher_host', text: 'open the page as http://127.0.0.1:<port>/ to manage pairing' });
    return false;
  }
  if (this.quelle() === 'cypher') { this.json(a, 403, { fehler: 'nur_andreas', text }); return false; }
  return true;
}
// The agent brake (Stop Cypher in the page): GET reads the state, POST {an} sets it.
export function routenHand(this: Oberflaeche): Route[] {
  const F = 'fremdePost' as const, O = 'offen' as const;
  return [
    { methode: 'GET', pfad: '/hand/bremse', schutz: O, handler: (_q, a) => this.json(a, 200, this.handStand()) },
    { methode: 'POST', pfad: '/hand/bremse', schutz: F, handler: async (q, a) => {
      if (!this.nurAndreasLoopback(q, a, 'the agent brake is Andreas\'s')) return;
      const an = (await this.koerper(q)).an;
      if (typeof an !== 'boolean') return this.json(a, 400, { fehler: 'an_fehlt' });
      this.setzeHandBremse(an);
      this.json(a, 200, this.handStand());
    } },
    { methode: 'GET', pfad: '/hand/log', schutz: O, handler: (q, a, url) => {
      if (!this.nurAndreasLoopback(q, a, 'the agent log is Andreas\'s')) return;
      const n = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get('n') ?? 50)) || 50));
      this.json(a, 200, { zeilen: this.handLog.letzte(n), datei: this.handLog.datei });
    } },
    { methode: 'GET', pfad: '/hand/ich', schutz: O, handler: (_q, a) => {
      const w = this.wer.getStore() ?? null;
      const gestoppt = this.kiGestoppt;
      this.json(a, 200, this.quelle() === 'cypher' && w ? { id: w.id, name: w.name, stufe: w.stufe, gestoppt } : { id: null, stufe: null, gestoppt });
    } },
    { methode: 'GET', pfad: '/hand/schluessel', schutz: O, handler: (q, a) => {
      if (!this.nurAndreasLoopback(q, a, 'managing agent keys is Andreas\'s')) return;
      this.json(a, 200, { schluessel: this.schluessel.liste().map(({ id, name, stufe, zuletzt }) => ({ id, name, stufe, zuletzt })) });
    } },
    { methode: 'POST', pfad: '/hand/schluessel', schutz: F, handler: async (q, a) => {
      if (!this.nurAndreasLoopback(q, a, 'managing agent keys is Andreas\'s')) return;
      const k = await this.koerper(q);
      const name = typeof k.name === 'string' ? k.name.trim() : '';
      if (!/^[\x20-\x7e]{1,40}$/.test(name)) {
        return this.json(a, 400, { fehler: 'name_ungueltig', text: 'the key name must be 1 to 40 printable ASCII characters' });
      }
      if (k.stufe !== 'lesen' && k.stufe !== 'schreiben' && k.stufe !== 'zerstoerend') {
        return this.json(a, 400, { fehler: 'stufe_unbekannt', text: 'the level must be lesen, schreiben or zerstoerend' });
      }
      const neu = this.schluessel.neu(name, k.stufe);
      this.json(a, 200, { id: neu.id, token: neu.token });
    } },
    { methode: 'POST', pfad: '/hand/schluessel/loeschen', schutz: F, handler: async (q, a) => {
      if (!this.nurAndreasLoopback(q, a, 'managing agent keys is Andreas\'s')) return;
      const id = (await this.koerper(q)).id;
      if (typeof id !== 'string' || !this.schluessel.widerrufe(id)) return this.json(a, 404, { fehler: 'unbekannt' });
      this.json(a, 200, { ok: true });
    } },
  ];
}
// Pairing, from the loopback page only (the tablet handler also refuses /kopplung): a one-time link, the list of paired devices, revoking one.
export function routenKopplung(this: Oberflaeche): Route[] {
  const F = 'fremdePost' as const, O = 'offen' as const;
  const nurAndreas = (q: http.IncomingMessage, a: http.ServerResponse): boolean => this.nurAndreasLoopback(q, a, 'pairing a device is Andreas\'s');
  return [
    { methode: 'GET', pfad: '/kopplung', schutz: O, handler: (q, a) => { if (nurAndreas(q, a)) this.json(a, 200, { an: this.tablet !== null, geraete: this.kopplung.liste() }); } },
    { methode: 'POST', pfad: '/kopplung', schutz: F, handler: (q, a) => {
      if (!nurAndreas(q, a)) return;
      if (this.tablet === null) return this.json(a, 409, { fehler: 'tablet_aus', text: 'Tablet access is off. Turn it on with {"an": true} in ~/.config/cypherdj/tablet.json, then restart the page server.' });
      const l = this.kopplung.neuerLink();
      this.json(a, 200, { link: `http://${this.tablet.adresse}:${this.tablet.port}/koppeln?t=${l.token}`, bis: l.bis, sekunden: Math.round((l.bis - Date.now()) / 1000) });
    } },
    { methode: 'POST', pfad: '/kopplung/loeschen', schutz: F, handler: async (q, a) => {
      if (!nurAndreas(q, a)) return;
      const id = (await this.koerper(q)).id;
      if (typeof id !== 'string' || !this.kopplung.widerrufe(id)) return this.json(a, 404, { fehler: 'unbekannt' });
      this.tabletHandler?.kappe(id);
      this.json(a, 200, { ok: true });
    } },
  ];
}
export async function stoppe(this: Oberflaeche): Promise<void> {
  if (this.gestoppt) return;   // zweimal (Test-Neustart und Aufräumen) darf nichts werfen
  this.gestoppt = true;
  const planWartete = this.offenerPlanTimer !== null, wiederLief = this.wiederTimer !== null;   // what the last write below must still know
  if (this.planTimer) { clearTimeout(this.planTimer); this.planTimer = null; this.sichereNeustartStand(); }   // what was changed in the last 300 ms
  this.aufnahme.aufnahme.schliesse();
  this.stems.stems.schliesse();
  this.noten.analyse.schliesse();
  this.notenRender.schliesse();
  this.tagsStopp();   // a running tag scan takes no further slice
  await this.einsammler.schliesse();   // kills a running copy, at most 2 s
  this.ausgabe.ausgabe.schliesse();   // Fix-Runde S3 R7: ein wartender Freeze endet jetzt mit freeze_fehler, nicht erst nach Stille oder Frist
  await this.proj.sitzung.beende();   // plan 1.11 D8: the plugin states first (at most 3 s)
  this.proj.sitzung.schliesse();   // D1 S2: ausstehenden Mixer-Eintrag schreiben, Projekt-Sperre frei
  for (const l of this.spuren.values()) for (const t of l.timer) clearTimeout(t);
  for (const s of this.stroeme) s.end();
  for (const t of this.wartend.values()) clearTimeout(t);
  if (this.ohrTakt) { clearInterval(this.ohrTakt); this.ohrTakt = null; }
  if (this.graphTakt) { clearInterval(this.graphTakt); this.graphTakt = null; }
  if (this.pumpeTimer) clearTimeout(this.pumpeTimer);
  if (this.offenerPlanTimer) { clearTimeout(this.offenerPlanTimer); this.offenerPlanTimer = null; }   // the restore that waits for the guard time
  if (this.wiederTimer) { clearTimeout(this.wiederTimer); this.wiederTimer = null; }
  this.vorbereiter.stoppe();
  await this.katalogJob.schliesse();   // browser plan 1: kills a running catalogue build, at most 2 s
  await this.vorhoeren.ende();
  // The awaits above take seconds while HTTP and the kern client run on: write what changed meanwhile (merkeNeustartStand holds since gestoppt).
  // Not while the restore of an accepted restart was pending: the file keeps the old kern's stand until that restore ran, and it never will
  if (!wiederLief) this.sichereNeustartStand(planWartete);
  await this.kern.stoppe();
  if (this.tabletServer) { const t = this.tabletServer; t.closeAllConnections(); await new Promise<void>((ok) => t.close(() => ok())); }
  await new Promise<void>((ok) => (this.http ? this.http.close(() => ok()) : ok()));
}
