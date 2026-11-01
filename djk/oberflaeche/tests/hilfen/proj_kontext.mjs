// Prüf-Kontext für den Bereich proj (D1 S2-Integration): zeichnet auf, was an den Kern ginge, und quittiert nach einer Regel.
// Ersetzt den BereichKontext des Servers (Spec 2.10) in den Einheitstests; die Stapel-Tests (proj_bereich.test.mjs) nehmen den echten.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ProjSitzung } from '../../bereiche/proj/sitzung.ts';
import { tmpOrdner } from './projekt.mjs';
import { Projekte } from '../../projekt/ablage.ts';

// teileMax (1.10 slice 3): models the stellwerk limit MAX_TEILE. A /k/teil occupies a slot until it is waited for with bisEnde; the (teileMax+1)th open part
// is answered with status 6 "teile_voll" (counted in k.teileVoll). Waiting without bisEnde returns status 2 (gestartet) and keeps the slot open.
// baukasten (S17): true adds the optional graph bridge stub k.baukasten. k.bk holds what the stub knows and records: geladen (channel -> graph),
// auto (channel -> true when AUTO is off), hash (graph -> sha256, absent = file missing), antwort (the answer of setzeGraph, may return a
// pending promise) and aufrufe (every setzeGraph call, with nach_id = the highest command id sent before the call). Without the option nothing changes.
export function pruefKontext({ quittung = () => ({ status: 3, grund: '' }), teileMax = 0, baukasten = false } = {}) {
  const k = {
    id: 0, gesendet: [], verteilt: [], protokoll: [], ki: false, regel: quittung, offen: new Set(), teileVoll: 0, voll: new Set(), mitModell: teileMax > 0,
    sende(adresse, felder) {
      const id = ++k.id; k.gesendet.push({ id, adresse, felder });
      if (k.mitModell && adresse === '/k/teil') { if (k.offen.size >= teileMax) { k.voll.add(id); k.teileVoll++; } else k.offen.add(id); }
      return id;
    },
    async warteQuittung(id, _ab, bisEnde = false) {
      const g = k.gesendet.find((x) => x.id === id);
      if (k.mitModell && g.adresse === '/k/teil') {
        if (k.voll.has(id)) return { status: 6, grund: 'teile_voll' };
        const q = k.regel(g.adresse, g.felder);
        if (q === null) return null;
        if (q.status !== 3) { k.offen.delete(id); return q; }
        if (!bisEnde) return { status: 2, grund: '' };
        k.offen.delete(id); return q;
      }
      return k.regel(g.adresse, g.felder);
    },
    quelle: () => 'andreas',
    kiGestoppt: () => k.ki,
    verteile(e) { k.verteilt.push(e); },
    log(z) { k.protokoll.push(z); },
    an: (adresse) => k.gesendet.filter((x) => x.adresse === adresse),
    teile: (re = /./) => k.gesendet.filter((x) => x.adresse === '/k/teil' && re.test(x.felder.pfad)),
    leere() { k.gesendet.length = 0; k.verteilt.length = 0; },
  };
  if (baukasten) {
    k.bk = { geladen: {}, auto: {}, hash: {}, antwort: () => ({ code: 200, j: { ok: true, quittung: { status: 3, grund: '' } } }), aufrufe: [] };
    k.baukasten = {
      geladen: () => ({ ...k.bk.geladen }),
      setzeGraph: async (kanal, name, quelle) => {
        k.bk.aufrufe.push({ kanal, name, quelle, nach_id: k.id });
        const r = await k.bk.antwort(kanal, name, quelle);
        if (r.code === 200 && r.j.quittung?.status === 3) k.bk.geladen[kanal] = name;
        return r;
      },
      autoAus: (kanal) => !!k.bk.auto[kanal],
      graphHash: (n) => k.bk.hash[n] ?? null,
      kernDa: () => k.bk.kernDa !== false,
    };
  }
  return k;
}

export function sitzung(t, opt = {}, kontext = pruefKontext()) {
  const d = tmpOrdner(t, 'djk-projsitz-');
  const s = new ProjSitzung(kontext, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), ...opt });
  t.after(() => s.schliesse());
  return { s, k: kontext, d, arr: path.join(d, 'arr'), wurzel: path.join(d, 'projekte') };
}

// kleine WAV per ffmpeg (Sinus), Muster projekt_dekodier.test.mjs
export function wav(dir, name, dauer = 0.25) {
  const p = path.join(dir, name);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=220:duration=${dauer}:sample_rate=48000`, '-ac', '2', '-y', p]);
  return p;
}

export const warteBis = async (f, ms = 5000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 10)); } return true; };

// --- P2 (Spec 6.21): ein Projekt auf der Platte und ein "Server-Neustart" -----------------------------------------------------------
export const arrNr = (nr) => ({ nr, status: 0, loop_an: 0, projekt_beat: 0, ursprung_sample: 0n, start_beat: 0, metronom_an: 0 });
export const ist = (s, pfad, wert) => s.ereignis('/e/regler', { pfad, wert, halter: 'frei', sample: 0n, beat: 0 });
// Projekt "wa" (zwei Spuren, s1 von andreas, s2 von cypher) mit Wiedergabe 7 auf der Platte, dann "Server-Neustart": eine neue Sitzung
// auf denselben Ordnern. Der Aufbau läuft über die Ablage, weil Ändern erst in Slice 4 kommt.
const WA_NR = 7;
export function neustart(t, opt = {}) {
  const e = sitzung(t);
  const pr = new Projekte(e.wurzel);
  const { slug, projekt } = pr.lege('Wa');
  const spur = (nr, von) => ({ id: `s${nr}`, ...(von ? { von } : {}), nr, name: `Audio ${nr}`, farbe: '#e0563b', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
  projekt.spuren = [spur(1, 'andreas'), spur(2, 'cypher')]; projekt.naechste_id = { spur: 3, clip: 1 }; projekt.wiedergabe_rev = WA_NR;
  pr.speichere(slug, projekt);
  fs.mkdirSync(e.arr, { recursive: true }); fs.writeFileSync(path.join(e.arr, `wiedergabe-${WA_NR}.json`), '{}');
  const z = sitzung(t, { wurzel: e.wurzel, arbeitsordner: e.arr, arrFristMs: 30, ...opt });
  return { e, z, nr: WA_NR };
}

