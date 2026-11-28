// Scenes and build-ups of the page server: collect, save, load (methods of Oberflaeche).
// Moved unchanged out of server.ts (pure move): plain functions bound to the Oberflaeche instance with `this`; the class keeps one-line delegations.
import http from 'node:http';
import path from 'node:path';
import { alsAntwort } from '../proj/area.ts';
import { GRUND_TEXT } from '../../http/reasons.ts';
import { PFAD, containerFrei } from '../../hand_operation.ts';
import { istStromZeile } from '../../stream_alias.ts';
import { plane, oeffnetKanal, beatZuMono, wirtRuf, stromVonZiel, MAX_TEILE, type Fahrt } from '../../track.ts';
import { SZENE_NAME, SZENE_MAX_TAKTE, AUTO_ROTIERT, istAutomatisch, reglerFuerSzene, schreibeSzene, schreibeAutomatisch, allesStill, leseSzene, szeneDa, loescheSzene, listeSzenen, planeLaden, planeGraphen, type Szene, type SzeneKlang, type SzeneSpur } from '../../szene.ts';
import { AUFBAU_NAME, aufbauBlock, aufbauWarnung, aufbauDa, schreibeAufbau, leseAufbau, listeAufbauten, loescheAufbau, aufbauZumLaden, type Aufbau } from '../../setup.ts';
import { aufbauOrdnerVorgabe } from '../../paths.ts';
import { reglerInfo } from '../../../conductor/src/controls_info.ts';
import { leseMusterStand, leseVersatz } from '../../../generator/src/pattern_state.mjs';
import { ALLE_STROEME, istBkStrom, stromVonKanal } from '../../../contract/streams.ts';
import { ueberProjekt, KLANG_GRUPPEN } from '../../server_kopf.ts';
import type { SpurLauf } from '../../server_kopf.ts';
import type { Oberflaeche } from '../../server.ts';

export async function szeneSammeln(this: Oberflaeche): Promise<Szene> {
  const u = this.kern.uhr as unknown as { beat: number; bpm: number } | null;
  const proTakt = this.proTakt();
  const muster: Record<string, string> = {}, versatz: Record<string, number> = {};
  for (const st of ALLE_STROEME) {
    const t = leseMusterStand(this.musterOrdner(st)).text;
    if (typeof t === 'string' && t.trim() !== '') muster[String(st)] = t;
    const v = leseVersatz(this.musterOrdner(st));
    if (v !== 0) versatz[String(st)] = v;
  }
  const anker: Record<string, number> = {}, bezeichnung: Record<string, string> = {};
  for (const st of Object.keys(muster)) {
    const t = this.musterAnkerTakt.get(Number(st)); if (t !== undefined) anker[st] = t;
    const b = leseMusterStand(this.musterOrdner(Number(st))).bezeichnung; if (typeof b === 'string' && b !== '') bezeichnung[st] = b;
  }
  const klang: Record<string, SzeneKlang> = {};
  // B2: both Surge hosts at once (a dead host costs its timeout once, not twice)
  const zustaende = await Promise.all(KLANG_GRUPPEN.map((g) => wirtRuf(this.wirtSock(g), { befehl: 'zustand' }, 1500)));
  KLANG_GRUPPEN.forEach((g, i) => { const r = zustaende[i]; if (r.ok && typeof r.patch_b64 === 'string') klang[g] = { art: 'surge', patch_b64: r.patch_b64 }; });
  this.spurenAufraeumen();
  const spuren: SzeneSpur[] = [...this.spuren].filter(([, l]) => l.quelle === 'cypher' && l.schleife)
    .map(([name, l]) => ({ name, fahrten: l.fahrten, schleife_takte: (l.schleife as { n: number }).n }));
  const lage = this.lage();
  return { v: 1, geschrieben: new Date().toISOString(), takt: Math.floor((u?.beat ?? 0) / proTakt) + 1, bpm: u?.bpm ?? null, muster,
    ...(Object.keys(versatz).length ? { versatz } : {}), ...(Object.keys(anker).length ? { anker } : {}), ...(Object.keys(bezeichnung).length ? { bezeichnung } : {}),
    regler: reglerFuerSzene(this.stand.regler, ueberProjekt), graphen: Object.fromEntries(Object.entries(this.stand.graphen_geladen).filter(([, n]) => !!n)),
    fx: structuredClone(this.stand.fx), fx_zuweisung: structuredClone(this.stand.fxZuweisung), fx_routing: this.stand.fxRouting, klang, spuren,
    info: { plaetze: lage.plaetze ?? null, decks: lage.decks ?? null } };
}
export async function szene(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
  const aktion = d.aktion;
  if (typeof aktion !== 'string' || !['sichern', 'ersetzen', 'laden', 'liste', 'zeige', 'loeschen'].includes(aktion)) {
    return this.json(a, 400, { fehler: 'aktion', text: 'aktion: sichern, ersetzen, laden, liste, zeige or loeschen' });
  }
  const offen = this.proj.zugang.offen();
  if (!offen || offen.projekt.live !== true) return this.json(a, 409, { fehler: 'kein_liveprojekt', text: 'live scenes belong to the open live project' });
  const ordner = offen.ordner;
  if (aktion === 'liste') return this.json(a, 200, { ok: true, szenen: listeSzenen(ordner) });
  const name = d.name;
  if (typeof name !== 'string' || !SZENE_NAME.test(name)) return this.json(a, 400, { fehler: 'name', text: 'name must match [a-z0-9_-]{1,32}' });
  if (aktion === 'sichern' || aktion === 'ersetzen') {
    if (aktion === 'sichern' && !istAutomatisch(name) && szeneDa(ordner, name)) return this.json(a, 409, { fehler: 'szene_vorhanden', name, text: GRUND_TEXT.szene_vorhanden });
    const s = await this.szeneSammeln();
    // A3: a silence over silence would replace the sound to come back to; automatic names keep three generations
    if (name === '_vor_stille' && allesStill(s)) return this.json(a, 200, { ok: true, name, geschrieben: false, grund: 'schon_still' });
    if (AUTO_ROTIERT.includes(name)) schreibeAutomatisch(ordner, name, s); else schreibeSzene(ordner, name, s);
    this.opt.log?.({ typ: 'szene_sichern', name, quelle: this.quelle(), takt: s.takt });
    return this.json(a, 200, { ok: true, name, takt: s.takt, muster: Object.keys(s.muster).map(Number), regler: Object.keys(s.regler).length,
      graphen: Object.keys(s.graphen), klang: Object.keys(s.klang), spuren: s.spuren.map((x) => x.name) });
  }
  const s = leseSzene(ordner, name);
  if (!s) return this.json(a, 404, { fehler: 'szene_unbekannt', name, text: GRUND_TEXT.szene_unbekannt });
  if (aktion === 'zeige') {   // B8: the patch itself is not shown, only its length in bytes
    const klang = Object.fromEntries(Object.entries(s.klang ?? {}).map(([g, k]) => {
      const { patch_b64, ...rest } = k ?? { art: '' };
      return [g, { ...rest, ...(typeof patch_b64 === 'string' ? { patch_bytes: Buffer.from(patch_b64, 'base64').length } : {}) }];
    }));
    return this.json(a, 200, { ok: true, name, szene: { ...s, klang } });
  }
  if (aktion === 'loeschen') {
    loescheSzene(ordner, name);
    this.opt.log?.({ typ: 'szene_loeschen', name, quelle: this.quelle() });
    return this.json(a, 200, { ok: true, name });
  }
  const takte = d.takte ?? 0;
  if (typeof takte !== 'number' || !Number.isInteger(takte) || takte < 0 || takte > SZENE_MAX_TAKTE) return this.json(a, 400, { fehler: 'takte', text: `takte: integer 0..${SZENE_MAX_TAKTE}` });
  await this.qs.run('cypher', () => this.szeneLaden(name, s, takte, ordner, a));
}
// The FX part of szene laden: what differs from the live state is sent back, as Cypher. Answers the list of what was restored.
// nurPlan: nothing is sent, the answer lists what differs (the answer of laden; the parts go out at the anchor, B7)
export function szeneFxLaden(this: Oberflaeche, s: Szene, ausgelassen: { ziel: string; grund: string }[], nurPlan = false): string[] {
  const fertig: string[] = [];
  const fang = (): { fang: ReturnType<Oberflaeche['innenAntwort']>; ok: () => boolean } => { const f = this.innenAntwort(); return { fang: f, ok: () => f.code === 200 }; };
  const riegel = this.innenAntwort();
  if (this.fxRiegel(riegel as unknown as http.ServerResponse)) {
    const grund = String(riegel.j().fehler ?? 'fx_gesperrt');
    if (s.fx_routing !== undefined && s.fx_routing !== this.stand.fxRouting) ausgelassen.push({ ziel: 'fx_routing', grund });
    const hat = (Array.isArray(s.fx) && s.fx.some((f) => f !== null)) || (Array.isArray(s.fx_zuweisung) && s.fx_zuweisung.some((z) => Object.keys(z ?? {}).length > 0));
    if (hat) ausgelassen.push({ ziel: 'fx', grund });
    return fertig;
  }
  const routing = s.fx_routing;
  if ((routing === 'insert' || routing === 'post_fader') && routing !== this.stand.fxRouting) {
    if (!nurPlan) { this.fxRoutingSenden(routing, this.quelle()); this.fxRoutingWunsch = routing; }
    fertig.push('routing');
  }
  const zu = Array.isArray(s.fx_zuweisung) ? (s.fx_zuweisung as Record<string, boolean>[]) : [];
  for (let i = 0; i < 3; i++) {
    const soll = zu[i] ?? {}, ist = this.stand.fxZuweisung[i] ?? {};
    for (const kanal of new Set([...Object.keys(soll), ...Object.keys(ist)])) {
      const an = soll[kanal] === true;
      if (an === (ist[kanal] === true)) continue;
      if (nurPlan) { fertig.push(`zuweisung:${i + 1}:${kanal}`); continue; }
      const f = fang();
      this.fxZuweisung({ einheit: i + 1, kanal, an }, f.fang as unknown as http.ServerResponse);
      if (f.ok()) fertig.push(`zuweisung:${i + 1}:${kanal}`); else ausgelassen.push({ ziel: `fx_zuweisung:${i + 1}:${kanal}`, grund: String(f.fang.j().fehler ?? `http_${f.fang.code}`) });
    }
  }
  const einheiten = Array.isArray(s.fx) ? (s.fx as (Record<string, unknown> | null)[]) : [];
  for (let i = 0; i < 2; i++) {
    const soll = einheiten[i] ?? null, ist = this.stand.fx[i] as Record<string, unknown> | null;
    // a unit that was off or empty at save time is switched off with its current settings, if it runs now
    const ziel = soll ?? (ist && ist.an === 1 ? { ...ist, an: 0 } : null);
    if (!ziel) continue;
    if (ist && (['art', 'beats', 'wet', 'param1', 'param2', 'param3', 'an'] as const).every((k) => ist[k] === ziel[k])) continue;
    if (nurPlan) { fertig.push(`fx:${i + 1}`); continue; }
    const f = fang();
    this.fx({ einheit: i + 1, art: ziel.art, beats: ziel.beats, wet: ziel.wet, param1: ziel.param1, param2: ziel.param2, param3: ziel.param3, an: ziel.an === 1 }, f.fang as unknown as http.ServerResponse);
    if (f.ok()) fertig.push(`fx:${i + 1}`); else ausgelassen.push({ ziel: `fx:${i + 1}`, grund: String(f.fang.j().fehler ?? `http_${f.fang.code}`) });
  }
  return fertig;
}
// A4: the anchor of a restore = the next bar with at least 1 beat of lead (else the bar after), never before the earliest bar a track may start at
export function szeneAnkerTakt(this: Oberflaeche): number {
  const proTakt = this.proTakt(), beat = (this.kern.uhr as unknown as { beat: number } | null)?.beat ?? 0;
  let takt = Math.ceil(beat / proTakt) + 1;   // absolute bar (1-based) that starts at the next bar line
  if (proTakt * (takt - 1) - beat < 1) takt++;
  return Math.max(takt, Math.floor(this.abVon('takt') / proTakt) + 1);
}
// A4 order: save _vor_laden; load differing graphs (vorgaben false: the knob values come from the scene); stop a running szene-<name>; THEN read the
// state fresh, choose the anchor and plan patterns and controls from that state; start the track (one retry on anker_vorbei); Surge setze and FX at the
// same anchor, each after a fresh Stop Cypher check.
export async function szeneLaden(this: Oberflaeche, name: string, s: Szene, takte: number, ordner: string, a: http.ServerResponse): Promise<void> {
  if (this.kiGestoppt) return this.json(a, 409, { fehler: 'ki_gestoppt' });
  if (!this.kern.uhr) return this.json(a, 409, { fehler: 'keine_uhr' });
  if (name !== '_vor_laden') schreibeAutomatisch(ordner, '_vor_laden', await this.szeneSammeln());
  const ausgelassen: { ziel: string; grund: string }[] = [];
  // graphs first, as Cypher (their own pre-checks: AUTO, kit mode, erzeuger), without graph defaults
  const graphen: string[] = [];
  for (const g of planeGraphen(s, { graphen: this.stand.graphen_geladen })) {
    const r = await this.graphSetzen({ kanal: g.kanal, name: g.name, vorgaben: false }, 'cypher');
    if (r.code === 200 && r.j.ok !== false) graphen.push(g.kanal); else ausgelassen.push({ ziel: `graph:${g.kanal}`, grund: String(r.j.fehler ?? r.j.grund ?? `http_${r.code}`) });
  }
  const spurName = `szene-${name}`.slice(0, 32);
  const alt = this.spuren.get(spurName);
  if (alt && alt.quelle === 'cypher') await this.spurAbbrechen(spurName, alt, 'cypher');   // a restore of the same scene still running
  if (this.kiGestoppt) return this.json(a, 409, { fehler: 'ki_gestoppt', graphen, ausgelassen });
  const proTakt = this.proTakt();
  // the plan from the state as it is now (the graph loads may have taken seconds)
  const planen = (ankerTakt: number) => {
    const jetztMuster: Record<string, string> = {}, jetztVersatz: Record<string, number> = {}, jetztBez: Record<string, string | null> = {};
    for (const st of ALLE_STROEME) {
      const stand = leseMusterStand(this.musterOrdner(st)), t = stand.text;
      if (typeof t === 'string') jetztMuster[String(st)] = t;
      jetztBez[String(st)] = stand.bezeichnung;
      const v = leseVersatz(this.musterOrdner(st));
      if (v !== 0) jetztVersatz[String(st)] = v;
    }
    const plan = planeLaden(s, { muster: jetztMuster, regler: this.stand.regler, graphen: this.stand.graphen_geladen, versatz: jetztVersatz, bezeichnung: jetztBez }, takte,
      (p) => { const e = reglerInfo(p)?.einheit; return e === 'schalter' || e === 'stufe'; }, ankerTakt);
    const anker = proTakt * (ankerTakt - 1), weg: { ziel: string; grund: string }[] = [];
    // every move checked on its own with Cypher's rules; a refused one is listed and left out
    const fahrten: Fahrt[] = [], muster: number[] = [], regler: string[] = [], versatz: Record<number, number> = {};
    for (const m of plan.muster) {
      if (istBkStrom(m.strom) && !this.erzeugerLebt(m.strom)) { if (m.text !== 'silence') weg.push({ ziel: `strom:${m.strom}`, grund: 'strom_ohne_erzeuger' }); continue; }
      if (!leseMusterStand(this.musterOrdner(m.strom)).autonom) { weg.push({ ziel: `strom:${m.strom}`, grund: 'auto_aus' }); continue; }
      fahrten.push({ ziel: `strom:${m.strom}`, ab_takt: 1, muster: m.text, ...(m.bezeichnung !== undefined ? { bezeichnung: m.bezeichnung } : {}) });
      if (m.versatz !== 0) versatz[m.strom] = m.versatz;
      muster.push(m.strom);
    }
    let teile = 0;
    for (const f of plan.regler) {
      const nach = f.nach as number;
      const grund = !PFAD.test(f.ziel) ? 'pfad'
        : reglerInfo(f.ziel)?.nurHand ? 'nur_hand'
        : ueberProjekt(f.ziel) && !istStromZeile(this.proj.zugang.offen()?.projekt ?? null, f.ziel) ? 'ueber_projekt'
        : (this.spurAliasFehler([f])?.fehler as string | undefined)
          ?? (((st) => (st !== null && !leseMusterStand(this.musterOrdner(st)).autonom ? 'auto_aus' : null))(this.stromVonZielOffen(f.ziel)))
          ?? (this.rampePflicht(f.ziel, nach, f.takte ?? 0) ? 'nur_rampe' : null)
          ?? (oeffnetKanal(this.stand.regler, plane({ name: 'x', fahrten: [f] }, anker, proTakt).teile) ? 'kein_hoerschein' : null)
          ?? (teile >= MAX_TEILE ? 'zu_viele' : null);
      if (grund) { weg.push({ ziel: f.ziel, grund }); continue; }
      teile++;
      fahrten.push(f);
      regler.push(f.ziel);
    }
    return { ankerTakt, anker, fahrten, muster, regler, versatz, weg };
  };
  let p = planen(this.szeneAnkerTakt());
  let lauf: SpurLauf | undefined;
  if (p.fahrten.length) {
    let fang = this.innenAntwort();
    await this.spurStart({ spur: { name: spurName, fahrten: p.fahrten }, anker_takt: p.ankerTakt }, fang as unknown as http.ServerResponse, { versatz: p.versatz });
    if (fang.code === 409 && fang.j().fehler === 'anker_vorbei') {   // the clock moved past the anchor while the track started: once more, fresh
      p = planen(this.szeneAnkerTakt());
      fang = this.innenAntwort();
      await this.spurStart({ spur: { name: spurName, fahrten: p.fahrten }, anker_takt: p.ankerTakt }, fang as unknown as http.ServerResponse, { versatz: p.versatz });
    }
    const j = fang.j();
    if (fang.code !== 200) {
      ausgelassen.push({ ziel: `spur:${spurName}`, grund: String(j.fehler ?? `http_${fang.code}`) });
      p.muster.length = 0; p.regler.length = 0;
    } else {
      lauf = this.spuren.get(spurName);
      for (const x of (j.abgelehnt as { pfad: string; grund: string }[] | undefined) ?? []) ausgelassen.push({ ziel: x.pfad, grund: x.grund });
    }
  }
  ausgelassen.push(...p.weg);
  const { ankerTakt, anker } = p;
  // B3: a restore without moves still gets its entry, so that Stop Cypher and spur_stopp halte its Surge group and clear its FX timer
  if (!lauf && !this.spuren.has(spurName)) {
    lauf = { quelle: 'cypher', anker, ende: anker + proTakt, fahrten: [], timer: [], offen: [], gruppen: new Set(), ids: [], teile: [] };
    this.spuren.set(spurName, lauf);
    this.spurenSichern();
  }
  // Surge: the stored patch as host setze at the anchor, only where it differs from the patch the host holds now
  const klang: string[] = [];
  for (const [g, k] of Object.entries(s.klang ?? {})) {
    if (!KLANG_GRUPPEN.includes(g) || typeof k?.patch_b64 !== 'string') continue;
    const st = stromVonZiel(`wirt:${g}/x`);
    if (st !== null && !leseMusterStand(this.musterOrdner(st)).autonom) { ausgelassen.push({ ziel: `wirt:${g}`, grund: 'auto_aus' }); continue; }
    const ist = await wirtRuf(this.wirtSock(g), { befehl: 'zustand' }, 1500);
    if (ist.ok && ist.patch_b64 === k.patch_b64) continue;
    if (this.kiGestoppt) { ausgelassen.push({ ziel: `wirt:${g}`, grund: 'ki_gestoppt' }); continue; }
    const u = this.kern.uhr as unknown as { beat: number; bpm: number; mono_ns: number };
    const r = await this.wirtFlug(spurName, () => wirtRuf(this.wirtSock(g), { befehl: 'setze', patch_b64: k.patch_b64, ab: beatZuMono(u, anker), spur: spurName }));
    if (!r.ok) { ausgelassen.push({ ziel: `wirt:${g}`, grund: 'wirt' }); continue; }
    if (lauf && this.spuren.get(spurName) === lauf) { lauf.gruppen.add(g); this.spurenSichern(); }
    klang.push(g);
  }
  // B7: the FX at the anchor: a timer on the core beat like the pattern timer; Stop Cypher is checked again when it fires
  const fx = this.szeneFxLaden(s, ausgelassen, true);
  if (fx.length && lauf) {
    const meiner = lauf;
    const zeit = setInterval(() => {
      if (this.spuren.has(spurName) && this.spuren.get(spurName) !== meiner) { clearInterval(zeit); return; }
      const beat = (this.kern.uhr as unknown as { beat: number } | null)?.beat;
      if (beat === undefined || beat < anker) return;
      clearInterval(zeit);
      if (this.kiGestoppt) { this.opt.log?.({ typ: 'szene_fx', name, fx: [], ausgelassen: [{ ziel: 'fx', grund: 'ki_gestoppt' }] }); return; }
      const weg: { ziel: string; grund: string }[] = [];
      const fertig = this.qs.run('cypher', () => this.szeneFxLaden(s, weg));
      this.opt.log?.({ typ: 'szene_fx', name, fx: fertig, ausgelassen: weg });
    }, 50);
    zeit.unref();
    meiner.timer.push(zeit);
  }
  // B5: Cypher loops that run now but are not in the scene stop (never Andreas'); then the stored Cypher loops, by name, from the same bar
  const namen = new Set((s.spuren ?? []).map((x) => x.name));
  for (const [n, l] of [...this.spuren]) if (l.quelle === 'cypher' && l.schleife && !namen.has(n)) await this.spurAbbrechen(n, l, 'cypher');
  for (const sp of s.spuren ?? []) {
    if (this.spuren.has(sp.name)) continue;
    const fang = this.innenAntwort();
    await this.spurStart({ spur: { name: sp.name, fahrten: sp.fahrten, schleife_takte: sp.schleife_takte }, anker_takt: ankerTakt }, fang as unknown as http.ServerResponse);
    if (fang.code !== 200) ausgelassen.push({ ziel: `spur:${sp.name}`, grund: String(fang.j().fehler ?? `http_${fang.code}`) });
  }
  this.opt.log?.({ typ: 'szene_laden', name, anker_takt: ankerTakt, muster: p.muster, regler: p.regler.length, graphen, fx, klang, ausgelassen: ausgelassen.length });
  this.json(a, 200, { ok: true, name, anker_takt: ankerTakt, muster: p.muster, regler: p.regler, graphen, fx, fx_ab_takt: fx.length ? ankerTakt : null, klang, ausgelassen });
}
// Strand 11 slice 7 (7a): POST /aufbau, stored session setups outside any project (setup.ts; folder aufbauOrdnerVorgabe, file mode 0600).
// aktion sichern | ersetzen | laden | liste | zeige | loeschen. sichern takes the running studio: szeneSammeln + the four container faders + tempo +
// the graphs of the Baukasten streams. laden, as Cypher: the live container is opened if it is not (its refusal live_laeuft is the answer), the tempo
// through the tempo path (a ramp from the next bar), then the scene restore of slice 5 (szeneLaden, takte 2: every continuous row ramps 2 bars, so
// nur_rampe never refuses; the setup's graphs written over the scene's). The four container faders go through the control path as 2-bar ramps, not
// through the scene's track: a track of Cypher may never open a closed strip (Plan Hand D8), the control path opens a free container (containerFrei)
// and asks a track place for its hearing check. That opens the strips that sit at -200 dB after a core restart. loeschen moves the file to papierkorb/.
export async function aufbau(this: Oberflaeche, d: Record<string, unknown>, a: http.ServerResponse): Promise<void> {
  const aktion = d.aktion;
  if (typeof aktion !== 'string' || !['sichern', 'ersetzen', 'laden', 'liste', 'zeige', 'loeschen'].includes(aktion)) {
    return this.json(a, 400, { fehler: 'aktion', text: 'aktion: sichern, ersetzen, laden, liste, zeige or loeschen' });
  }
  const ordner = aufbauOrdnerVorgabe();
  if (aktion === 'liste') return this.json(a, 200, { ok: true, aufbauten: listeAufbauten(ordner) });
  const name = d.name;
  if (typeof name !== 'string' || !AUFBAU_NAME.test(name)) return this.json(a, 400, { fehler: 'name', text: 'name must match [a-z0-9_-]{1,32}' });
  if (aktion === 'sichern' || aktion === 'ersetzen') {
    if (aktion === 'sichern' && aufbauDa(ordner, name)) return this.json(a, 409, { fehler: 'aufbau_vorhanden', name, text: GRUND_TEXT.aufbau_vorhanden });
    const szene = await this.szeneSammeln();
    const block = aufbauBlock(this.stand.regler, (this.kern.uhr as unknown as { bpm: number } | null)?.bpm, this.stand.graphen_geladen,
      (k) => { const st = stromVonKanal(k); return st !== null && istBkStrom(st); });
    schreibeAufbau(ordner, name, { v: 1, geschrieben: new Date().toISOString(), aufbau: block, szene });
    this.opt.log?.({ typ: 'aufbau_sichern', name, quelle: this.quelle() });
    const warnung = aufbauWarnung(this.stand.regler);
    return this.json(a, 200, { ok: true, name, bpm: block.bpm, kanaele: block.kanaele, graphen: block.graphen, muster: Object.keys(szene.muster).map(Number), ...(warnung.length ? { warnung } : {}) });
  }
  const auf = leseAufbau(ordner, name);
  if (!auf) return this.json(a, 404, { fehler: 'aufbau_unbekannt', name, text: GRUND_TEXT.aufbau_unbekannt });
  if (aktion === 'zeige') {   // like szene zeige: the Surge patch is not shown, only its length in bytes
    const klang = Object.fromEntries(Object.entries(auf.szene.klang ?? {}).map(([g, k]) => {
      const { patch_b64, ...rest } = k ?? { art: '' };
      return [g, { ...rest, ...(typeof patch_b64 === 'string' ? { patch_bytes: Buffer.from(patch_b64, 'base64').length } : {}) }];
    }));
    return this.json(a, 200, { ok: true, name, aufbau: { ...auf, szene: { ...auf.szene, klang } } });
  }
  if (aktion === 'loeschen') {
    const ziel = loescheAufbau(ordner, name);
    this.opt.log?.({ typ: 'aufbau_loeschen', name, quelle: this.quelle() });
    return this.json(a, 200, { ok: true, name, papierkorb: ziel });
  }
  await this.qs.run('cypher', () => this.aufbauLaden(name, auf, a));
}
export async function aufbauLaden(this: Oberflaeche, name: string, auf: Aufbau, a: http.ServerResponse): Promise<void> {
  if (this.kiGestoppt) return this.json(a, 409, { fehler: 'ki_gestoppt', text: GRUND_TEXT.ki_gestoppt });
  if (!this.kern.uhr) return this.json(a, 409, { fehler: 'keine_uhr' });
  // 1. the live container (the live_oeffnen path, as Cypher: never over a running set of another project)
  let live_geoeffnet = false;
  if (this.proj.zugang.offen()?.projekt.live !== true) {
    let r: { code: number; j: unknown };
    try { r = await this.proj.sitzung.liveOeffnen('cypher'); } catch (e) { r = alsAntwort(e, this.bereichKontext()); }
    if (r.code !== 200) return this.json(a, r.code, { ...(r.j as object), schritt: 'live_oeffnen' });
    live_geoeffnet = true;
  }
  const offen = this.proj.zugang.offen();
  if (!offen || offen.projekt.live !== true) return this.json(a, 409, { fehler: 'kein_liveprojekt', text: 'the live container did not open' });
  const ausgelassen: { ziel: string; grund: string }[] = [];
  // 2. the tempo through the tempo path (a ramp from the next bar), only when it differs
  let bpm: number | null = null;
  const jetztBpm = (this.kern.uhr as unknown as { bpm: number } | null)?.bpm;
  if (typeof auf.aufbau.bpm === 'number' && Math.abs((jetztBpm ?? 0) - auf.aufbau.bpm) >= 0.005) {
    const t = this.innenAntwort();
    await this.tempo({ bpm: auf.aufbau.bpm }, t as unknown as http.ServerResponse);
    if (t.code === 200) bpm = auf.aufbau.bpm; else ausgelassen.push({ ziel: 'tempo', grund: String(t.j().fehler ?? `http_${t.code}`) });
  }
  // 2b. Cypher's running arcs and scene restores (`szene-*`) stop before the restore: they would write their patterns over it (Cypher's tracks only)
  for (const [n, l] of [...this.spuren]) if (l.quelle === 'cypher' && (l.bogen || n.startsWith('szene-'))) await this.spurAbbrechen(n, l, 'cypher');
  // 3. the scene restore of slice 5 (graphs first, then one track szene-<name> from the anchor), every continuous row a 2-bar ramp
  const { szene, kanaele } = aufbauZumLaden(auf);
  const sz = this.innenAntwort();
  await this.szeneLaden(name, szene, 2, offen.ordner, sz as unknown as http.ServerResponse);
  const sj = sz.j();
  if (sz.code !== 200) return this.json(a, sz.code, { ...sj, schritt: 'szene', live_geoeffnet, bpm, ausgelassen: [...ausgelassen, ...((sj.ausgelassen as typeof ausgelassen | undefined) ?? [])] });
  // 4. the container faders as 2-bar ramps from the next bar through the control path (its Cypher rules: AUTO, hearing check of a track place)
  const geschickt = await Promise.all(kanaele.map(async (k) => {
    if (this.stand.regler[k.pfad] === k.nach) return { kanal: k.kanal, nach: k.nach, takte: 0, unveraendert: true };
    const r = this.innenAntwort();
    await this.regler({ pfad: k.pfad, nach: k.nach, takte: 2, ab: 'takt' }, r as unknown as http.ServerResponse);
    const j = r.j();
    if (r.code !== 200) { ausgelassen.push({ ziel: k.pfad, grund: String(j.fehler ?? `http_${r.code}`) }); return null; }
    return { kanal: k.kanal, nach: k.nach, takte: 2, ab_beat: (j.felder as { ab_beat?: number } | undefined)?.ab_beat ?? null };
  }));
  this.opt.log?.({ typ: 'aufbau_laden', name, live_geoeffnet, bpm, kanaele: geschickt.filter((x) => x).length, ausgelassen: ausgelassen.length });
  this.json(a, 200, { ...sj, ok: true, name, live_geoeffnet, bpm, kanaele: geschickt.filter((x) => x !== null),
    ausgelassen: [...((sj.ausgelassen as typeof ausgelassen | undefined) ?? []), ...ausgelassen] });
}
