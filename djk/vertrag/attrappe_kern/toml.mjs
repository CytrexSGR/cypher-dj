// Flaches TOML für kern.toml (SCHNITTSTELLEN §2.1): key = wert, Kommentare mit #, Zeichenketten, Zahlen, Wahrheitswerte.
// Unbekannte Schlüssel sind ein Startfehler.

export function leseToml(text, erlaubt, datei = 'kern.toml') {
  const cfg = {};
  text.split('\n').forEach((zeile, i) => {
    const z = zeile.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim();
    if (!z) return;
    const m = /^([a-z_][a-z0-9_]*)\s*=\s*(.+)$/.exec(z);
    if (!m) throw new Error(`${datei} Zeile ${i + 1}: nicht lesbar: ${zeile}`);
    const [, k, roh] = m;
    if (!(k in erlaubt)) throw new Error(`${datei}: unbekannter Schlüssel ${k}`);
    let v;
    if (/^".*"$/.test(roh)) v = roh.slice(1, -1);
    else if (roh === 'true' || roh === 'false') v = roh === 'true';
    else if (/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(roh)) v = Number(roh);
    else throw new Error(`${datei} Zeile ${i + 1}: Wert ${roh} nicht lesbar`);
    if (typeof v !== typeof erlaubt[k]) throw new Error(`${datei}: ${k} hat Typ ${typeof v}, erwartet ${typeof erlaubt[k]}`);
    cfg[k] = v;
  });
  if (cfg.version !== undefined && cfg.version !== 1) throw new Error(`${datei}: version ${cfg.version}, erwartet 1`);
  return cfg;
}
