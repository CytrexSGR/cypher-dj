// D1 S3: Aufbau für die Ablauf-Tests von bereiche/proj/ausgabe.ts OHNE Netz und ohne Kern, aber mit der ECHTEN S2-Integration: projBereich
// (Sitzung, Verlauf, Übersetzer, Wiedergabe-Zähler, Freeze-Sperre, tempoAnMaster) in tmp. Statt des Servers ein Kontext-Doppel (sende,
// warteQuittung, quelle, kiGestoppt, verteile, log) mit einem Kern-Doppel: es quittiert jeden Befehl, meldet /zustand/arr nach /k/arr/laden und
// fährt /k/arr/freeze, wie K3 es festlegt (Datei in den Arbeitsordner, /e/freeze über die Haken, /zustand/arr status 3 im Takt während des
// Laufs). Kern-Ereignisse gehen wie im Router an beide Bereiche, erst proj, dann proj-ausgabe. Der ProjZugang ist der echte; ein dünner Mantel
// zeichnet nur die Reihenfolge auf (sperreLaden, tempoAnMaster, uebernimm) und die Export-Wiedergaben (schreibeWiedergabe), ohne etwas zu ändern.
// Export (Slice 2): der Render ist das Doppel tests/hilfen/render_attrappe.mjs (Instanz c), die Uhr steht auf 2026-10-15 18:15:00 Ortszeit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projBereich } from '../../bereiche/proj/bereich.ts';
import { Ausgabe } from '../../bereiche/proj/ausgabe.ts';
import { wiedergabeDatei } from '../../projekt/wiedergabe.ts';
import { aendere } from '../../projekt/verlauf.ts';
import { baueKatalog } from './katalog.mjs';
import { wav, warteBis } from './proj_kontext.mjs';

export const RENDER_ATTRAPPE = [process.execPath, path.join(import.meta.dirname, 'render_attrappe.mjs')];

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

// kern: wie das Kern-Doppel auf /k/arr/freeze antwortet
//   { art: 'ok', frames?, ms? }          Quittung 1, Status 3 im Takt, nach ms Datei schreiben, /e/freeze 0, Status 0 (frames Vorgabe 4800)
//   { art: 'ablehnen', grund }           Quittung 6 mit grund (tempo_rampe: Spec 6.33)
//   { art: 'abbruch', grund }            Quittung 1, dann /q 7 grund und /e/freeze 1
//   { art: 'ohne_datei' }                Quittung 1, /e/freeze 2 (Datei nicht geschrieben)
//   { art: 'falsche_groesse' }           Quittung 1, Datei mit frames − 1, /e/freeze 0 mit frames
//   { art: 'stumm' }                     Quittung 1, Status 3 im Takt, aber kein /e/freeze (Frist)
//   { art: 'weg' }                       Quittung 1, danach keine Meldung mehr (Kern verloren: Stille)
//   { art: 'haengt' }                    Quittung 1, Status 3 im Takt bis zum Testende (für Neustart, ausgabe_lauf)
//   { art: 'ohne_quittung' }             warteQuittung null
export async function aufbau(t, { tempo = 120, kern = { art: 'ok' }, opt = {}, mitKick = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-s3-ablauf-'));
  const uhren = new Set();
  t.after(() => { for (const u of uhren) clearInterval(u); fs.rmSync(tmp, { recursive: true, force: true }); });
  const wurzel = path.join(tmp, 'projekte'), arbeitsordner = path.join(tmp, 'arr');
  const kick = wav(path.join(tmp, 'daten'), 'kick.wav', 0.5);
  const katalog = baueKatalog(path.join(tmp, 'kat'), [{ n: 1, typ: 'oneshot', pfad: kick, dauer_s: 0.5, sha: 'a'.repeat(64) }]);
  const protokoll = { gesendet: [], reihenfolge: [], uebernommen: [], verteilt: [], log: [], wiedergaben: [] };
  const zustand = { quelle: 'andreas', ki: false, kern, quittungen: new Map(), id: 0, zu: false, kernNr: -1, kernStatus: 0, verzoegerLaden: 0 };
  let b = null, ausgabe = null;
  // Kern-Ereignis an beide Bereiche (Router: Melde-Reihenfolge proj, dann proj-ausgabe)
  const vomKern = (adresse, f) => { b.ereignis(adresse, f); ausgabe.ereignis(adresse, f); };
  const arrMeldung = () => vomKern('/zustand/arr', { nr: zustand.kernNr, status: zustand.kernStatus, loop_an: 0, projekt_beat: 0, ursprung_sample: 0n, start_beat: 0, metronom_an: 0 });
  const quittiere = (id, status, grund = '') => zustand.quittungen.set(id, { status, grund });
  const ctx = {
    sende(adresse, felder) {
      const id = ++zustand.id;
      protokoll.gesendet.push({ id, adresse, felder: { ...felder } });
      if (adresse === '/k/arr/freeze') kernFreeze(id, felder);
      else if (adresse === '/k/arr/laden') {
        const fertig = () => { zustand.kernNr = felder.nr; quittiere(id, 3); arrMeldung(); };
        if (zustand.verzoegerLaden > 0) setTimeout(fertig, zustand.verzoegerLaden); else setImmediate(fertig);
      } else quittiere(id, 3);
      return id;
    },
    async warteQuittung(id) {
      for (let i = 0; i < 400 && !zustand.quittungen.has(id); i++) await warte(2);
      return zustand.quittungen.get(id) ?? null;
    },
    quelle: () => zustand.quelle,
    kiGestoppt: () => zustand.ki,
    verteile: (e) => protokoll.verteilt.push(e),
    log: (z2) => protokoll.log.push(z2),
  };
  function puls() {                                                  // /zustand/arr im Takt (Kern: 50 Hz beim Warten, Spielen, Freeze)
    const u = setInterval(arrMeldung, 50); uhren.add(u);
    return () => { clearInterval(u); uhren.delete(u); };
  }
  function kernFreeze(id, f) {
    const k = zustand.kern;
    if (k.art === 'ohne_quittung') return;
    if (k.art === 'ablehnen') { quittiere(id, 6, k.grund); return; }
    quittiere(id, 1);
    zustand.kernStatus = 3;
    setImmediate(arrMeldung);
    if (k.art === 'weg') return;
    const stopp = puls();
    if (k.art === 'haengt') return;
    const frames = k.frames ?? 4800;
    setTimeout(() => {
      if (k.art === 'stumm') return;
      stopp(); zustand.kernStatus = 0;
      if (k.art === 'abbruch') {
        vomKern('/q', { id, status: 7, grund: k.grund });
        vomKern('/e/freeze', { spur: f.spur, kennung: f.kennung, status: 1, frames: 0n });
      } else if (k.art === 'ohne_datei') {
        vomKern('/e/freeze', { spur: f.spur, kennung: f.kennung, status: 2, frames: 0n });
      } else {
        const inhalt = Buffer.alloc((k.art === 'falsche_groesse' ? frames - 1 : frames) * 8);
        inhalt.writeFloatLE(0.25, 0);
        fs.mkdirSync(arbeitsordner, { recursive: true });
        fs.writeFileSync(path.join(arbeitsordner, `freeze-${f.spur}-${f.kennung}.f32`), inhalt, { flag: 'wx' });
        vomKern('/e/freeze', { spur: f.spur, kennung: f.kennung, status: 0, frames: BigInt(frames) });
      }
      arrMeldung();
    }, k.ms ?? 20);
  }

  b = projBereich(ctx, { wurzel, arbeitsordner, katalog, arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  const echt = b.zugang;
  // Mantel um den echten Zugang: zeichnet auf, ändert nichts (zu: kein Projekt, wie ein geschlossenes)
  const zugang = {
    ...echt,
    offen: () => (zustand.zu ? null : echt.offen()),
    sperreLaden: () => { protokoll.reihenfolge.push('sperre'); const frei = echt.sperreLaden(); return () => { protokoll.reihenfolge.push('frei'); frei(); }; },
    tempoAnMaster: async () => { protokoll.reihenfolge.push('tempo'); return echt.tempoAnMaster(); },
    uebernimm: (w, meta) => {
      protokoll.reihenfolge.push('uebernimm');
      protokoll.uebernommen.push({ rev: w.projekt.rev, label: meta.label, quelle: meta.quelle, wiedergabe: w.betrifft_wiedergabe });
      return echt.uebernimm(w, meta);
    },
    schreibeWiedergabe: (p) => { const w = echt.schreibeWiedergabe(p); protokoll.wiedergaben.push(w); return w; },
  };
  const optionen = { zugabeMs: 300, stilleMs: 400, render: () => RENDER_ATTRAPPE, instanz: () => 'c', jetzt: () => new Date(2026, 9, 15, 18, 15, 0), ...opt };
  ausgabe = new Ausgabe(ctx, zugang, optionen);
  vomKern('/k/willkommen', { generation: 1 });
  vomKern('/uhr', { beat: 0, bpm: tempo, sample: 0n });             // Master steht schon auf dem Projekttempo: keine Rampe
  const s = b.sitzung;
  await s.neu('Erster Track', 'andreas');
  // Projekt bauen über /proj/aendern der Sitzung: Kick (Audio, über den Katalog), Bass (RB-338), Lead (Surge, Noten ab Beat 8)
  const aendern = async (befehle, label = 'Aufbau', quelle = 'andreas') => {
    const r = await s.aendern({ rev: s.aktuell().j.projekt.rev, label, befehle }, quelle);
    if (r.code !== 200) throw new Error(`aendern ${label}: ${r.code} ${JSON.stringify(r.j)}`);
    return r;
  };
  await aendern([
    { befehl: 'tempo_setzen', bpm: tempo },
    { befehl: 'spur_neu', art: 'audio', name: 'Kick' },
    { befehl: 'spur_neu', art: 'instrument', name: 'Bass', geraet: { art: 'intern' } },
    { befehl: 'spur_neu', art: 'instrument', name: 'Lead', geraet: { art: 'wirt' } },
    ...(mitKick ? [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: 'a'.repeat(64) }] : []),
    { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 16, noten: [{ beat: 0, laenge: 0.5, ton: 36, vel: 100 }] },
    { befehl: 'clip_neu', spur_id: 's3', art: 'midi', start_beat: 8, laenge_beats: 8, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 90 }] },
    { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 16 },
  ]);
  const projekt = () => s.aktuell().j.projekt;
  if (mitKick && !(await warteBis(() => projekt().spuren[0].clips[0].dekodiert === 'fertig', 10000))) throw new Error('Kick nicht dekodiert');
  // der Kern hat die Wiedergabe zum letzten Stand geladen (auch die nach dem Dekodieren)
  if (!(await warteBis(() => ausgabe.zustand && zustand.kernNr === projekt().wiedergabe_rev, 5000))) throw new Error('Wiedergabe nicht geladen');
  protokoll.gesendet.length = 0; protokoll.reihenfolge.length = 0; protokoll.uebernommen.length = 0; protokoll.wiedergaben.length = 0;
  const lead = () => projekt().spuren.find((x) => x.id === 's3');
  const freezes = () => protokoll.gesendet.filter((g) => g.adresse === '/k/arr/freeze');
  const wiedergabe = (nr) => JSON.parse(fs.readFileSync(wiedergabeDatei(arbeitsordner, nr), 'utf8'));
  // Fremde Änderung, die an der Sperre vorbei durchkam (Spec 6.30: geprüft vor der Sperre, gespeichert danach): direkt über den Zugang
  const vorbei = async (befehle, label = 'Hand') => {
    const o = echt.offen();
    const w = aendere(o.verlauf, o.projekt, befehle, { quelle: 'andreas', label }, echt.haken());
    await echt.uebernimm(w, { quelle: 'andreas', label });
  };
  const offen = () => echt.offen();                                  // {slug, ordner, projekt (lebend), verlauf}
  return { ausgabe, b, s, zugang, echt, ctx, zustand, protokoll, arbeitsordner, aendern, vorbei, vomKern, arrMeldung, projekt, lead, freezes, wiedergabe, tmp,
    offen, optionen };
}
