// Paket 1.13 Warp, Slice 3a: Gerüst der Zielskripte gegen eine PRÜFINSTANZ (nie den Betrieb 47300/47100/47200, nie g, h, i). Aus abnahme_w5.mjs herausgelöst.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { leseWav } from './w1_wav.mjs';

export class Fehl extends Error {}
const HIER = path.dirname(fileURLToPath(import.meta.url));
export function starte(skript, praefix, extraOptionen = {}) {
  const { values: opt } = parseArgs({ options: { url: { type: 'string' }, aufbau: { type: 'string' }, ausgabe: { type: 'string' }, instanz: { type: 'string' }, ...extraOptionen } });
  const aufrufFehler = (t) => { process.stderr.write(`${skript}: ${t}\n`); process.exit(2); };
  if (!opt.url || !opt.aufbau) aufrufFehler('Aufruf: --url <http://127.0.0.1:port> --aufbau <aufbau.json> [--ausgabe <Ordner>] [--instanz <a..f>]');
  if (/:(47300|47100|47200)\b/.test(opt.url)) aufrufFehler('nie gegen den Betrieb (47300): eine Prüfinstanz wählen');
  const port = Number(new globalThis.URL(opt.url).port), k = (port - 47300) / 1000;
  const instanz = opt.instanz ?? (Number.isInteger(k) && k >= 1 && k <= 9 ? String.fromCharCode(96 + k) : undefined);
  if (!instanz || /^[ghi]$/.test(instanz)) aufrufFehler(`Instanz ${instanz ?? '?'} (Port ${port}) ist nicht erlaubt: g, h, i sind tabu`);
  const AUFBAU = JSON.parse(fs.readFileSync(opt.aufbau, 'utf8'));
  const zwei = (n) => String(n).padStart(2, '0'), d0 = new Date();
  const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}t${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
  const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : path.join(HIER, 'ergebnisse', `${zeit}-${skript}`);
  fs.mkdirSync(ORDNER, { recursive: true });
  const z = { opt, AUFBAU, ORDNER, instanz, zeit, URL: opt.url, CYPHER: { 'x-djk-quelle': 'cypher' }, zeilen: [], fehl: 0, punkt: 'Aufbau', eigeneSlugs: [] };
  z.warte = (ms) => new Promise((r) => setTimeout(r, ms));
  z.notiere = (kz, ok, text) => { if (!ok) z.fehl++; z.zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}\n`); };
  z.info = (text) => { z.zeilen.push(`INFO ${text}`); process.stdout.write(`INFO ${text}\n`); };
  z.ruf = async (methode, weg, koerper, kopf = {}) => {
    const r = await fetch(z.URL + weg, methode === 'GET' ? { headers: kopf } : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(koerper ?? {}) });
    const t = await r.text();
    let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { text: t }; }
    return { code: r.status, j };
  };
  z.grundVon = (r) => `${r.code} ${r.j?.fehler ?? r.j?.grund ?? ''}${r.j?.text ? `: ${r.j.text}` : ''}`.trim();
  z.erwarte200 = (weg, r) => { if (r.code !== 200) throw new Fehl(`${weg} → ${z.grundVon(r)}`); return r; };
  z.aktuell = async () => z.erwarte200('/proj/aktuell', await z.ruf('GET', '/proj/aktuell')).j;
  z.holeRev = async () => z.erwarte200('/proj/aktuell?nur=rev', await z.ruf('GET', '/proj/aktuell?nur=rev')).j.rev;
  z.aendern = async (label, befehle, kopf = {}) => z.erwarte200(`/proj/aendern (${label})`, await z.ruf('POST', '/proj/aendern', { rev: await z.holeRev(), label, befehle }, kopf)).j;
  z.aendernRoh = async (label, befehle, kopf = {}) => z.ruf('POST', '/proj/aendern', { rev: await z.holeRev(), label, befehle }, kopf);   // mit Ablehnung
  z.bisWahr = async (f, ms = 40000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await z.warte(100); } return false; };
  z.zustandKurz = async () => { const a = await z.aktuell(); return { kern: a.kern, wiedergabe_rev: a.projekt.wiedergabe_rev, dekodiert: a.projekt.spuren.flatMap((s) => s.clips).map((c) => c.dekodiert) }; };
  z.geladen = async () => {
    const ok = await z.bisWahr(async () => { const s = await z.zustandKurz(); return s.dekodiert.every((d) => d === 'fertig') && s.kern?.rev_geladen === s.wiedergabe_rev && s.kern?.status === 0; });
    if (!ok) throw new Fehl(`Wiedergabe nicht geladen nach 40 s: ${JSON.stringify(await z.zustandKurz())}`);
  };
  z.setzeTempo = async (bpm) => { await z.aendern(`${praefix} Tempo ${bpm}`, [{ befehl: 'tempo_setzen', bpm }], z.CYPHER); await z.warte(6000); };   // Rampe ab dem nächsten Takt (Spec 6.33)
  z.neuesProjekt = async (name) => {
    const r = z.erwarte200('/proj/neu', await z.ruf('POST', '/proj/neu', { name: `${praefix}-${name}-${zeit}` }));
    const slug = r.j.slug ?? r.j.projekt?.slug;
    if (!slug) throw new Fehl(`/proj/neu ohne slug: ${JSON.stringify(r.j).slice(0, 200)}`);
    z.eigeneSlugs.push(slug);
    await z.warte(1500);
  };
  z.exportiere = async (von, bis, name) => {
    await z.geladen();
    const r = z.erwarte200('/proj/export', await z.ruf('POST', '/proj/export', { von_beat: von, bis_beat: bis }, z.CYPHER));
    fs.copyFileSync(r.j.datei, path.join(ORDNER, `${name}.wav`));
    return { ...leseWav(r.j.datei), datei: path.join(ORDNER, `${name}.wav`) };
  };
  z.fmt = (x) => (typeof x === 'number' ? x.toFixed(2) : String(x));
  // Ende: eigene Projekte aufräumen (nur Slugs dieses Skripts), Bericht, Exit-Code
  z.ende = async (titel, slugMuster) => {
    const wurzel = path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte');
    for (const slug of z.eigeneSlugs) {
      const d = path.join(wurzel, slug);
      if (!slugMuster.test(slug)) { z.info(`Slug ${slug} ist nicht von diesem Skript, nicht gelöscht`); continue; }
      try { if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); z.info(`Projekt ${d} gelöscht`); } else z.info(`Projekt ${d} nicht gefunden`); } catch (e) { z.notiere('Aufräumen', false, e.message); }
    }
    fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# ${titel} ${zeit} (${z.URL}, Instanz ${instanz})\n\n${z.zeilen.join('\n')}\n`);
    process.stdout.write(`\n${z.fehl === 0 ? 'ALLES OK' : `${z.fehl} FEHL`} · Bericht ${path.join(ORDNER, 'bericht.md')}\n`);
    process.exit(z.fehl === 0 ? 0 : 1);
  };
  return z;
}
