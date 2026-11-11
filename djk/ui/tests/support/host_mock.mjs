// Plan 1.11 T7: stand-in for the effect hosts as the page server sees them: `djk-insert` (start, stop, status) and the host socket (one JSON line in,
// one answer out), plus the core side of the two commands the manager sends (/k/arr/ins_host, /k/arr/ins_mess). Everything is in memory; the
// tests choose the time scale (HostZeiten) and flip the switches below.
import fs from 'node:fs';
import path from 'node:path';

const schlaf = (ms) => new Promise((ok) => setTimeout(ok, ms));
export const QUANTUM = 256;

export function hostAttrappe({ ordner } = {}) {
  const A = {
    hosts: new Map(),                // h -> host state (see neu())
    folge: [],                       // every call in order: {art, ...}
    steht: true,                     // the transport is stopped
    flag: [0, 0, 0, 0, 0],           // the server flag per host as the core holds it (index = h)
    fehlend: new Set(),              // plugin specs that `start` refuses with exit 2
    startMs: 0,                      // delay of `djk-insert start` (a sleeping host start)
    ladeMs: 0,                       // delay of `lade` (status `laedt` meanwhile)
    sockMs: {},                      // command -> delay in ms
    messung: [],                     // queue of forced answers of /k/arr/ins_mess: numbers or reasons ('kein_rueckweg', 'laeuft')
    absturzBeiLade: false,           // `lade` kills the host (a crashing plugin): the unit restarts empty
    zustandSetzenFehler: false,      // `zustand_setzen` fails with zustand_lesen
    nichtLadbar: false,              // `lade` refuses with nicht_ladbar and the host exits 2
    pid: 1000,
    verw: null,                      // the HostVerwaltung under test (set by the test: the core answers through verw.ereignis)
    neuLaden: [],                    // every reload request, with the stage as the translator would write it then
    ordner,
  };
  const neu = (h, spec) => ({
    h, spec, laeuft: true, bereit: 'leer', grund: null, pid: ++A.pid, starts: 0, puls: 1, haengt: false, neustartPhase: false,
    info: { name: 'Fake EQ', hersteller: 'Fake', audio_ein: 2, audio_aus: 2, latenz: 69, parameter: [
      { index: 0, name: 'Gain', min: -24, max: 24, vorgabe: 0, einheit: 'dB' }, { index: 1, name: 'Freq', min: 20, max: 20000, vorgabe: 1000, einheit: 'Hz' }] },
    werte: { 0: 0.5, 1: 0.5 }, aktiv: true, stumm: false, zustandAnzahl: 0, zustandSetzen: 0, name: 'Fake EQ',
  });
  A.abstuerzen = (h, { leer = true } = {}) => {              // systemd restarts the unit: a new pid, an EMPTY rack
    const x = A.hosts.get(h);
    x.pid = ++A.pid; x.starts += 1; x.bereit = leer ? 'leer' : x.bereit; x.puls = 1;
  };
  const aufruf = (z) => { A.folge.push({ ...z, t: Date.now() }); };
  A.aufrufe = (art, befehl) => A.folge.filter((z) => z.art === art && (befehl === undefined || z.befehl === befehl));

  A.insert = async (args) => {
    aufruf({ art: 'insert', befehl: args[0], h: Number(args[1]), spec: args[2] });
    const h = Number(args[1]);
    if (args[0] === 'start') {
      if (A.startMs) await schlaf(A.startMs);
      if (A.fehlend.has(args[2])) return { code: 2, aus: '', fehler: 'plugin not loadable' };
      const x = A.hosts.get(h);
      if (x && x.laeuft && x.spec !== args[2]) return { code: 4, aus: '', fehler: 'belegt' };
      if (!x || !x.laeuft) A.hosts.set(h, neu(h, args[2]));
      return { code: 0, aus: `djk-insert: host ${h} up`, fehler: '' };
    }
    if (args[0] === 'stop') { A.hosts.delete(h); return { code: 0, aus: '', fehler: '' }; }
    if (args[0] === 'status') {
      const x = A.hosts.get(h);
      if (!x) return { code: 0, aus: JSON.stringify({ h, laeuft: false, bereit: null, grund: null, sock: null, puls: null, pid: null, starts: null }), fehler: '' };
      if (!x.haengt) x.puls += 1;
      const bereit = x.neustartPhase ? null : x.bereit;
      return { code: 0, aus: JSON.stringify({ h, laeuft: x.laeuft, bereit, grund: x.neustartPhase ? 'neustart' : x.grund,
        sock: `/fake/ins-${h}.sock`, puls: x.neustartPhase ? null : x.puls, pid: x.pid, starts: x.starts }), fehler: '' };
    }
    return { code: 2, aus: '', fehler: 'usage' };
  };

  A.sock = async (pfad, befehl, timeoutMs) => {
    const h = Number(/ins-(\d)\.sock$/.exec(pfad)?.[1]);
    const x = A.hosts.get(h);
    aufruf({ art: 'sock', befehl: befehl.befehl, h, werte: befehl.werte, pfad: befehl.pfad, an: befehl.an });
    if (!x || !x.laeuft) throw new Error('sock_verbindung');
    if (x.haengt) { await schlaf(timeoutMs); throw new Error('sock_timeout'); }
    const ms = A.sockMs[befehl.befehl] ?? 0;
    const stand = x.pid;
    if (befehl.befehl === 'lade') {
      if (x.bereit !== 'leer') return { ok: false, fehler: 'schon_geladen' };
      x.bereit = 'laedt';
      if (A.ladeMs) await schlaf(A.ladeMs);
      if (A.hosts.get(h) !== x || x.pid !== stand) throw new Error('sock_verbindung');
      if (A.absturzBeiLade) { A.abstuerzen(h); throw new Error('sock_verbindung'); }   // the plugin kills the host during the load; the unit restarts empty
      if (A.nichtLadbar) { x.laeuft = false; x.bereit = 'fehler'; x.grund = 'nicht_ladbar'; return { ok: false, fehler: 'nicht_ladbar' }; }
      x.bereit = 'geladen';
      return { ok: true };
    }
    if (ms) await schlaf(ms);
    if (A.hosts.get(h) !== x || x.pid !== stand) throw new Error('sock_verbindung');
    if (x.bereit !== 'geladen') return { ok: false, fehler: 'leer' };
    switch (befehl.befehl) {
      case 'info': return { ok: true, ...x.info };
      case 'latenz': return { ok: true, latenz: x.info.latenz };
      case 'params': return { ok: true, werte: { ...x.werte } };
      case 'params_setzen': {
        for (const k of Object.keys(befehl.werte)) if (!(k in x.werte)) return { ok: false, fehler: 'param_unbekannt', index: k };
        for (const [k, v] of Object.entries(befehl.werte)) x.werte[k] = Math.min(1, Math.max(0, v));
        if (x.nachParam) x.nachParam(x);
        return { ok: true };
      }
      case 'aktiv': x.aktiv = !!befehl.an; return { ok: true };
      case 'fenster':   // the plugin window (task 15): x.keinFenster = 'kein_fenster' | 'keine_anzeige' makes the host refuse
        if (befehl.an && x.keinFenster) return { ok: true, fenster: false, grund: x.keinFenster };
        x.fensterAuf = !!befehl.an; return { ok: true, fenster: !!befehl.an };
      case 'zustand_holen':
        x.zustandAnzahl += 1;
        fs.mkdirSync(path.dirname(befehl.pfad), { recursive: true });
        fs.writeFileSync(befehl.pfad, `<Info><Name>${x.name}</Name></Info><V>${JSON.stringify(x.werte)}</V>`);
        return { ok: true };
      case 'zustand_setzen': {
        x.zustandSetzen += 1;
        if (A.zustandSetzenFehler) return { ok: false, fehler: 'zustand_lesen' };
        const t = fs.readFileSync(befehl.pfad, 'utf8');
        if (!t.includes(`<Name>${x.name}</Name>`)) return { ok: false, fehler: 'zustand_passt_nicht' };
        return { ok: true };
      }
      default: return { ok: false, fehler: 'unbekannter Befehl' };
    }
  };

  // the core side: /k/arr/ins_host sets the flag, /k/arr/ins_mess answers with /e/ins_mess (refused while moving or unhealthy, mute plugin = no return)
  A.kern = {
    insHost: async (h, g) => { aufruf({ art: 'kern', befehl: 'ins_host', h, gesund: g }); A.flag[h] = g; return true; },
    insMess: (h) => {
      aufruf({ art: 'kern', befehl: 'ins_mess', h });
      const x = A.hosts.get(h);
      queueMicrotask(() => {
        let rundweg = 2 * QUANTUM, grund = '';
        const erzwungen = A.messung.shift();
        if (!A.steht) { rundweg = -1; grund = 'laeuft'; }
        else if (!A.flag[h] || !x || !x.laeuft) { rundweg = -1; grund = 'host_fehlt'; }
        else if (x.bereit === 'geladen' && x.aktiv && x.stumm) { rundweg = -1; grund = 'kein_rueckweg'; }   // the impulse met an active muting plugin
        else if (typeof erzwungen === 'number') rundweg = erzwungen;
        else if (typeof erzwungen === 'string') { rundweg = -1; grund = erzwungen; }
        A.verw.ereignis('/e/ins_mess', { h, rundweg, grund });
      });
    },
  };
  A.abhaengig = (extra = {}) => ({
    insert: (...a) => A.insert(...a), sock: (...a) => A.sock(...a), kern: { insHost: (...a) => A.kern.insHost(...a), insMess: (...a) => A.kern.insMess(...a) },
    ordner: () => A.ordner ?? null,
    transportSteht: () => A.steht,
    neuLaden: () => { A.neuLaden.push({ t: Date.now(), stufen: [1, 2, 3, 4].map((s) => A.verw?.stufe(s)) }); },
    log: () => {},
    ...extra,
  });
  return A;
}

// small time scale for the tests: a poll every 15 ms, a pulse is stale after 60 ms, a call that is open or a host that loads tolerates 400 ms
export const ZEITEN = { pollMs: 15, pulsMs: 60, toleranzMs: 400, zustandRuheMs: 80, fensterMs: 120, endeMs: 300, messMs: 400, ladeMs: 3000, sockMs: 600, quantum: QUANTUM };
export const warteBis = async (f, ms = 3000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await schlaf(5); } return true; };
export { schlaf };
