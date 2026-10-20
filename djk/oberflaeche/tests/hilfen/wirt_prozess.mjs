// Paket 1.18, S3-Fix W2: ein lebender Stellvertreter für den Produktions-Wirt arr1. Der Server hält den Wirt nur für da, wenn die Status-Datei
// wirt-arr1.json bereit:true trägt UND ihre pid lebt UND der Prozess wirt.py heißt (djk/wirte/carla/wirt.py schreibt name, pid, bereit, … und
// bleibt als Prozess `python3 …/wirt.py --name … --status …` stehen). Der Stellvertreter ist ein python3, das eine Datei namens wirt.py ausführt.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Startet den Stellvertreter und wartet, bis /proc/<pid>/cmdline das Skript nennt (exec ist dann durch). Beendet ihn bei t.after.
export async function starteWirtProzess(t, { programm = 'wirt.py' } = {}) {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-wirtproz-'));
  const skript = path.join(ordner, programm);
  fs.writeFileSync(skript, 'import time\ntime.sleep(600)\n');
  const kind = spawn('python3', [skript, '--name', 'cypherdj-wirt-arr1', '--status', path.join(ordner, 'x.json')], { stdio: 'ignore' });
  t.after(() => { kind.kill('SIGKILL'); fs.rmSync(ordner, { recursive: true, force: true }); });
  for (let i = 0; i < 200; i++) {
    try { if (fs.readFileSync(`/proc/${kind.pid}/cmdline`, 'utf8').includes(programm)) break; } catch { /* noch nicht da */ }
    await new Promise((r) => setTimeout(r, 10));
  }
  return { pid: kind.pid, beende: () => new Promise((ok) => {
    fs.rmSync(ordner, { recursive: true, force: true });
    if (kind.exitCode !== null || kind.signalCode !== null) return ok();
    kind.once('exit', ok); kind.kill('SIGKILL');
  }) };
}

// Die Status-Datei, wie wirt.py sie schreibt (Felder: name, pid, bereit, fehler, sock, klang, art, fahrbar)
export function schreibeWirtStatus(ordner, { pid, bereit = true } = {}) {
  fs.writeFileSync(path.join(ordner, 'wirt-arr1.json'), JSON.stringify({ name: 'cypherdj-wirt-arr1', pid, bereit, fehler: [], sock: '', klang: null, art: 'lv2', fahrbar: 1 }));
}

// Eine pid, die es nicht gibt: ein eben beendeter Kindprozess (die Nummer ist frei, solange kein anderer Prozess sie bekommt)
export async function totePid(t) {
  const w = await starteWirtProzess(t);
  await w.beende();
  return w.pid;
}
