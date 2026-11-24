// Browser plan 6, task 10: plugin_pfade.txt read/add/remove (plugins/paths_file.ts), temp HOME only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pfadeDatei, pruefeOrdner, PfadeFehler, STANDARD_PFADE } from '../plugins/paths_file.ts';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pfade-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const datei = (h) => path.join(h, '.config/cypherdj/plugin_pfade.txt');

test('add to a missing file creates it with the one line', (t) => {
  const h = tmp(t);
  assert.deepEqual(pfadeDatei(h).dazu('/opt/a'), { schon_da: false });
  assert.equal(fs.readFileSync(datei(h), 'utf8'), '/opt/a\n');
});
test('add keeps a header comment, blank line and order; remove drops only that line', (t) => {
  const h = tmp(t);
  fs.mkdirSync(path.dirname(datei(h)), { recursive: true });
  fs.writeFileSync(datei(h), '# my plugins\n\n/opt/a\nrelativ/x\n/opt/b\n');
  const p = pfadeDatei(h);
  p.dazu('/opt/c');
  assert.equal(fs.readFileSync(datei(h), 'utf8'), '# my plugins\n\n/opt/a\nrelativ/x\n/opt/b\n/opt/c\n');
  assert.deepEqual(p.weg('/opt/b'), { entfernt: true });
  assert.equal(fs.readFileSync(datei(h), 'utf8'), '# my plugins\n\n/opt/a\nrelativ/x\n/opt/c\n');
  assert.deepEqual(p.weg('/opt/b'), { entfernt: false });
  assert.deepEqual(fs.readdirSync(path.dirname(datei(h))), ['plugin_pfade.txt']);   // no temp file left
});
test('lies ignores comments, blanks and relative lines', (t) => {
  const h = tmp(t);
  fs.mkdirSync(path.dirname(datei(h)), { recursive: true });
  fs.writeFileSync(datei(h), '# c\n\n  /opt/a  \nrel/x\n#/opt/no\n/opt/b');
  assert.deepEqual(pfadeDatei(h).lies(), ['/opt/a', '/opt/b']);
  assert.deepEqual(pfadeDatei(tmp(t)).lies(), []);
});
test('a newline, control character or relative path is refused before any write', (t) => {
  const h = tmp(t);
  for (const bad of ['/opt/a\n/etc', '/opt/a\0', 'rel/x', '', ' /opt/a', 42, null]) assert.throws(() => pfadeDatei(h).dazu(bad), (e) => e instanceof PfadeFehler && e.grund === 'pfad_ungueltig', String(bad));
  assert.equal(fs.existsSync(datei(h)), false);
});
test('adding twice reports schon_da and writes nothing', (t) => {
  const h = tmp(t);
  pfadeDatei(h).dazu('/opt/a');
  assert.deepEqual(pfadeDatei(h).dazu('/opt/a'), { schon_da: true });
  assert.equal(fs.readFileSync(datei(h), 'utf8'), '/opt/a\n');
});
test('pruefeOrdner: folder inside roots only, not a file, not /proc; outside the roots is 403 before existence is looked at', (t) => {
  const h = fs.realpathSync(tmp(t)), W = [{ name: 'Home', pfad: h }];
  fs.mkdirSync(path.join(h, 'ok')); fs.writeFileSync(path.join(h, 'f.txt'), 'x');
  assert.equal(pruefeOrdner(path.join(h, 'ok'), W), path.join(h, 'ok'));
  const grund = (f) => { try { f(); } catch (e) { return [e.code, e.grund]; } return null; };
  assert.deepEqual(grund(() => pruefeOrdner(path.join(h, 'f.txt'), W)), [400, 'pfad_fehlt_ordner']);
  assert.deepEqual(grund(() => pruefeOrdner(path.join(h, 'nein'), W)), [400, 'pfad_fehlt_ordner']);
  assert.deepEqual(grund(() => pruefeOrdner('/usr', W)), [403, 'pfad_ausserhalb']);
  assert.deepEqual(grund(() => pruefeOrdner('/etc/gibtsnicht', W)), [403, 'pfad_ausserhalb']);   // no existence oracle
  assert.deepEqual(grund(() => pruefeOrdner('/etc', W)), grund(() => pruefeOrdner('/etc/gibtsnicht-2', W)));
  assert.deepEqual(grund(() => pruefeOrdner('/proc/self', [{ name: 'p', pfad: '/proc' }, ...W])), [403, 'pfad_ausserhalb']);
  assert.deepEqual(grund(() => pruefeOrdner(`${h}/ok/../../etc`, W)), [403, 'pfad_ausserhalb']);
  const ausserhalb = path.join(tmp(t), 'draussen'); fs.mkdirSync(ausserhalb);
  fs.symlinkSync(ausserhalb, path.join(h, 'link'));
  assert.deepEqual(grund(() => pruefeOrdner(path.join(h, 'link'), W)), [403, 'pfad_ausserhalb']);
});
test('STANDARD_PFADE equals the Python list', () => {
  const r = spawnSync('python3', ['-c', 'import json,plugin_scan;print(json.dumps(plugin_scan.STANDARD_PFADE))'], { cwd: path.resolve(import.meta.dirname, '../../hosts/carla'), encoding: 'utf8' });
  assert.deepEqual(JSON.parse(r.stdout), [...STANDARD_PFADE]);
});
