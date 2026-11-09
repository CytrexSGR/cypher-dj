// Target acceptance, 1.8 recording slice 3 (monitoring In/Auto/Off, AK17), against a TEST INSTANCE with the freshly built core (instances b, d or e only,
// never f, never the operation). The caller (one locked shell command, see acceptance_rec2.mjs) holds the instance lock and the real-time lock, writes the
// fixture geraete.json (input 1 with an UNCONNECTED probe port, so the core output cannot feed back into its own input), starts the instance, runs this
// script, stops it and restores file and units.
//   node check/acceptance_rec3.mjs --url http://127.0.0.1:5<port> --bau <core build folder> [--ausgabe <folder>] [--instanz d] [--inserts eq,saett,lim [--inserts-spur <n>]]
//   --inserts: an insert chain on a track that is not the armed one (see rec_inserts.mjs); without it the project has no insert. The script builds its own
//   project, so there is no --aufbau (a value handed over is reported and ignored).
// Criteria:
//   Z0  /zustand/rec reports ausgang_vorhalt (the core output delay), the number the loop is reported against.
//   Z1  baseline: cypherdj-latenz on the null sink alone (playback_FL -> monitor_FL), 20 runs. Expected 256 samples (one quantum).
//   Z2  loop through the core: an audio track on external input 1, monitor "ein", transport stopped; cypherdj-latenz sends into <client>:ein_1_L and listens
//       on monitor_FL. Reported: raw loop, baseline, core share (raw - baseline), ausgang_vorhalt. Gate D3: raw loop <= 480 samples means the monitor needs
//       no extra output port (S3b not built); more means S3b is the next unit. The verdict is a FINDING, not a failure: it does not change the exit code.
//       1.8 T1 (only with --inserts): two cells in this one session, a control project without the chain first, then the project with it. The loop is measured
//       in both (cypherdj-latenz, 60 runs each), ausgang_vorhalt is read after each load. pdc = ausgang_vorhalt(chain) - ausgang_vorhalt(control). Positive probe,
//       FEHL otherwise: pdc > 0 (the PDC is seen), raw_with equals raw_control within the repeatability (slice 3b-lite: the dry monitor does not wait for the PDC;
//       the old core gave raw_with - raw_control = pdc), raw_control equals baseline + ausgang_vorhalt of the control. The
//       verdict line prints raw_with, raw_control, baseline, core share, pdc and the tolerable PDC budget (480 - raw_control).
//   Z3  negative control: monitor "aus" on the same track gives keine_schleife (nothing reaches the output), so the value of Z2 came through the monitor path.
// Return: 0 when Z2 yields a value and Z3 holds, 1 at least one FEHL, 2 usage. Raw data go to rohdaten.json. Only the own project (slug rec3-...) is removed.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { starte, Fehl } from './w3a_target.mjs';
import { INSERT_OPTIONEN, INSERT_HILFE, inserts, baueInserts } from './rec_inserts.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write('abnahme_rec3: usage: --url <test instance> --bau <core build folder> [--ausgabe <folder>] [--instanz <b|d|e>] ' + INSERT_HILFE + '\n');
  process.exit(2);
}
const z = starte('abnahme_rec3', 'rec3', { bau: { type: 'string' }, ...INSERT_OPTIONEN }, { ohneAufbau: true });
const INS = inserts('abnahme_rec3', z.opt);
const { notiere, info, instanz, warte } = z;
if (!z.opt.bau) { process.stderr.write('abnahme_rec3: --bau <core build folder> is required (cypherdj-latenz)\n'); process.exit(2); }
if (!/^[bde]$/.test(instanz)) { process.stderr.write(`abnahme_rec3: instance ${instanz} is not allowed: b, d or e only (never f)\n`); process.exit(2); }
const BAU = path.resolve(z.opt.bau);
const STUMM = `cypher_stumm-${instanz}`;
const KERN = `cypherdj-kern-${instanz}`;   // JACK client name of the core (main.cpp: cdj_name "cypherdj-kern" + "-<instance>")
const D3_GRENZE = 480;
const PW = { PIPEWIRE_PROPS: `{ node.group = cypherdj-${instanz} node.lock-quantum = true }` };
const roh = {};
const jsonZeile = (t) => { try { return JSON.parse(t.trim().split('\n').filter(Boolean).pop()); } catch { return null; } };
const prog = (programm, args, env = {}) => new Promise((res) => {
  const p = spawn(programm, args, { env: { ...process.env, CYPHERDJ_INSTANZ: instanz, ...env } });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => res({ rc: -1, out, err: `${err}${e.message}` }));
  p.on('close', (rc) => res({ rc, out, err }));
});
const latenz = (quelle, senke, datei) => prog('pw-jack', [path.join(BAU, 'cypherdj-latenz'), quelle, senke, '20', datei], PW);

async function ereignis(adresse, ms = 8000) {
  const ac = new AbortController(), uhr = setTimeout(() => ac.abort(), ms);
  let fund = null;
  try {
    const r = await fetch(z.URL + '/strom', { signal: ac.signal });
    const dec = new globalThis.TextDecoder();
    let puf = '';
    suche: for await (const stueck of r.body) {
      puf += dec.decode(stueck, { stream: true });
      let i;
      while ((i = puf.indexOf('\n\n')) >= 0) {
        const block = puf.slice(0, i); puf = puf.slice(i + 2);
        if (!block.startsWith('data: ')) continue;
        try { const m = JSON.parse(block.slice(6)); if (m.a === adresse) { fund = m.f; break suche; } } catch { /* half line */ }
      }
    }
  } catch { /* aborted by the timer */ } finally { clearTimeout(uhr); ac.abort(); }
  return fund;
}

// One measuring cell: an own project with the armed track "In" on input 1 (monitor ein), the chain `cfg` on another track (or none), the playback loaded,
// /zustand/rec read after the load, then the loop through the core. Returns { id, vorhalt, messung }.
async function zelle(name, cfg, bj, datei) {
  await z.neuesProjekt(name);
  await z.aendern(`rec3 ${name} tempo`, [{ befehl: 'tempo_setzen', bpm: 120 }]);
  await z.aendern(`rec3 ${name} track`, [{ befehl: 'spur_neu', art: 'audio', name: 'In' }]);
  const id = (await z.aktuell()).projekt.spuren[0].id;
  await z.aendern(`rec3 ${name} arm`, [{ befehl: 'spur_aendern', spur_id: id, eingang: { art: 'extern', paar: 1, modus: 'stereo' }, arm: true, monitor: 'ein' }]);
  if (cfg) roh.inserts = await baueInserts(z, cfg, id, 'rec3');
  await z.geladen();
  await warte(1500);   // the server sends /k/rec/spur after the change (D13); the core has it a few cycles later; the /zustand/rec report is younger than the load
  const fz = await ereignis('/zustand/rec');
  if (!fz || !Number.isInteger(fz.ausgang_vorhalt)) throw new Fehl(`rec3 ${name}: no /zustand/rec after the load`);
  const st = (await z.aktuell()).kern?.status;
  notiere(`Z2 ${name}: the transport is stopped during the measurement`, st === 0, `kern.status ${st}`);
  const r = await latenz(`${KERN}:ein_1_L`, `${STUMM}:monitor_FL`, path.join(z.ORDNER, `latenz-${datei}.json`));
  const rj = jsonZeile(r.out);
  roh[datei] = { rc: r.rc, messung: rj, vorhalt: fz.ausgang_vorhalt };
  notiere(`Z2 ${name}: the loop through the core (monitor ein) yields a value`, r.rc === 0 && rj?.ok === true && rj.laeufe >= 20, `rc ${r.rc}: ${r.out.trim().split("\n").pop()} ${r.err.trim().split("\n").pop()}`);
  info(`Z2 ${name}: ausgang_vorhalt after the load ${fz.ausgang_vorhalt}`);
  return { id, vorhalt: fz.ausgang_vorhalt, messung: rj };
}

async function lauf() {
  // Z0
  const f = await ereignis('/zustand/rec');
  if (!f) throw new Fehl('no /zustand/rec within 8 s');
  roh.vorhalt = f.ausgang_vorhalt; roh.quantum = f.quantum;
  notiere('Z0 /zustand/rec reports ausgang_vorhalt and quantum', Number.isInteger(f.ausgang_vorhalt) && f.ausgang_vorhalt >= 0 && f.quantum > 0,
    `ausgang_vorhalt ${f.ausgang_vorhalt} samples, quantum ${f.quantum}`);
  // Z1 baseline
  const b = await latenz(`${STUMM}:playback_FL`, `${STUMM}:monitor_FL`, path.join(z.ORDNER, 'latenz-basis.json'));
  const bj = jsonZeile(b.out);
  roh.basis = { rc: b.rc, messung: bj };
  notiere('Z1 baseline: the null sink alone is measured (>= 20 runs)', b.rc === 0 && bj?.ok === true && bj.laeufe >= 20, `rc ${b.rc}: ${b.out.trim().split('\n').pop()}`);
  if (!bj?.ok) return;
  // Z2 loop through the core. With --inserts two cells run in this one session (1.8 T1): the control cell without a chain first, then the cell with it.
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }).catch(() => null);
  await warte(500);
  const kontrolle = INS ? await zelle('control', null, bj, 'kontrolle') : null;
  const mit = await zelle(INS ? 'chain' : 'mon', INS, bj, 'schleife');
  const id = mit.id, rj = mit.messung;
  if (rj?.ok) {
    const anteil = rj.samples - bj.samples;
    roh.urteil = { roh: rj.samples, basis: bj.samples, kernanteil: anteil, vorhalt: mit.vorhalt, grenze: D3_GRENZE, s3b: rj.samples > D3_GRENZE };
    info(`Z2 raw loop ${rj.samples} samples (spread ${rj.streuung}, min ${rj.min}, max ${rj.max}, quantum ${rj.quantum}); baseline ${bj.samples}; core share ${anteil}; `
      + `ausgang_vorhalt ${mit.vorhalt} = ${(rj.samples / 48).toFixed(2)} ms raw at 48 kHz`);
    if (kontrolle?.messung?.ok) {
      // 1.8 T1 positive probe: the PDC must be seen, otherwise the cell proves nothing. pdc = ausgang_vorhalt(chain) - ausgang_vorhalt(control) must be > 0, and the control
      // loop is baseline + its own ausgang_vorhalt (no fixed 340). Since slice 3b-lite the monitor is added after the chain and the PDC delay of its track, so the raw loop with the
      // chain equals the control loop within the repeatability. Before slice 3b-lite it was longer by exactly pdc (measured 2026-11-08: 552 against 340, pdc 212). A missing PDC
      // (chain ignored) gives pdc 0 and ends as FEHL, never as "<= 480".
      const kj = kontrolle.messung;
      const pdc = mit.vorhalt - kontrolle.vorhalt, diff = rj.samples - kj.samples, ruhe = Math.max(rj.streuung ?? 0, kj.streuung ?? 0, 1);
      const budget = D3_GRENZE - kj.samples;
      roh.urteil = { ...roh.urteil, kontrolle: kj.samples, pdc, diff, budget };
      info(`T1 raw_with ${rj.samples}, raw_control ${kj.samples}, baseline ${bj.samples}, core share ${anteil} (control ${kj.samples - bj.samples}), pdc ${pdc} (arr_pdc.h: 212), tolerable PDC budget ${D3_GRENZE} - ${kj.samples} = ${budget}`);
      notiere('T1 positive probe: the PDC is seen (pdc > 0 in /zustand/rec)', pdc > 0, `ausgang_vorhalt chain ${mit.vorhalt}, control ${kontrolle.vorhalt}, pdc ${pdc}`);
      notiere('T1 the monitor does not wait for the PDC: raw_with equals raw_control', Math.abs(diff) <= ruhe, `raw difference ${diff} (repeatability ${ruhe}); before slice 3b-lite it was pdc ${pdc}`);
      notiere('T1 control cell: raw_control equals baseline + ausgang_vorhalt of the same run', Math.abs(kj.samples - (bj.samples + kontrolle.vorhalt)) <= ruhe,
        `raw_control ${kj.samples}, baseline ${bj.samples} + ausgang_vorhalt ${kontrolle.vorhalt} = ${bj.samples + kontrolle.vorhalt}`);
      if (pdc !== 212) info(`T1 pdc ${pdc} differs from the 212 of arr_pdc.h (reported, not corrected)`);
    }
    info(`D3 VERDICT: raw loop ${rj.samples} ${rj.samples <= D3_GRENZE ? '<=' : '>'} ${D3_GRENZE} samples: ${rj.samples <= D3_GRENZE ? 'S3b (mon_L/R) is NOT built' : 'S3b (mon_L/R) is the next unit'}`);
  }
  // Z3 negative control: monitor aus, same track, same loop
  await z.aendern('rec3 monitor aus', [{ befehl: 'spur_aendern', spur_id: id, monitor: 'aus' }]);
  await warte(1500);
  const n = await latenz(`${KERN}:ein_1_L`, `${STUMM}:monitor_FL`, path.join(z.ORDNER, 'latenz-aus.json'));
  const nj = jsonZeile(n.out);
  roh.aus = { rc: n.rc, ausgabe: nj };
  notiere('Z3 negative: monitor aus gives keine_schleife (nothing reaches the output)', n.rc !== 0 && nj?.grund === 'keine_schleife', `rc ${n.rc}, ${n.out.trim().split('\n').pop()}`);
  // Z3b: and back to ein gives the value again (the first value was not a leftover)
  await z.aendern('rec3 monitor ein', [{ befehl: 'spur_aendern', spur_id: id, monitor: 'ein' }]);
  await warte(1500);
  const w = await latenz(`${KERN}:ein_1_L`, `${STUMM}:monitor_FL`, path.join(z.ORDNER, 'latenz-wieder.json'));
  const wj = jsonZeile(w.out);
  roh.wieder = { rc: w.rc, messung: wj };
  notiere('Z3 positive: monitor back to ein gives the loop again, same value', w.rc === 0 && wj?.ok === true && rj?.ok === true && wj.samples === rj.samples,
    `rc ${w.rc}: ${w.out.trim().split('\n').pop()}`);
}
try { await lauf(); } catch (e) { z.notiere('Lauf', false, e instanceof Fehl ? e.message : (e?.stack ?? String(e))); }
fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), JSON.stringify(roh, null, 1));
await z.ende('abnahme_rec3', /^rec3-/);
