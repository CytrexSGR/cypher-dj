// Folder picker of the browser (browser plan 2, task 6): a modal over GET /dateisystem/ordner. The page cannot read a folder path from the desktop,
// so a folder is chosen here (spec B7). Top level = the roots the server offers; a refused path (403) shows the server's own text in the dialog.
export function waehleOrdner(a) {
  return new Promise((fertig) => {
    const huelle = document.createElement('div');
    huelle.className = 'b-dialog-huelle';
    const dlg = document.createElement('div');
    dlg.className = 'b-dialog'; dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-label', a.titel);
    const titel = document.createElement('div'); titel.className = 'b-dialog-titel'; titel.textContent = a.titel;
    const krumen = document.createElement('div'); krumen.className = 'b-dialog-krumen';
    const meldung = document.createElement('div'); meldung.className = 'b-dialog-meldung'; meldung.setAttribute('role', 'status');
    const liste = document.createElement('div'); liste.className = 'b-dialog-liste';
    const fuss = document.createElement('div'); fuss.className = 'b-dialog-fuss';
    const waehle = document.createElement('button'); waehle.type = 'button'; waehle.textContent = 'CHOOSE'; waehle.disabled = true;
    const abbruch = document.createElement('button'); abbruch.type = 'button'; abbruch.textContent = 'CANCEL';
    fuss.append(abbruch, waehle);
    dlg.append(titel, krumen, meldung, liste, fuss);
    huelle.append(dlg);
    let aktuell = '';
    const zu = (wert) => { document.removeEventListener('keydown', taste, true); huelle.remove(); fertig(wert); };
    const taste = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); zu(null); } };
    const knopf = (text, pfad, klasse) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = klasse; b.textContent = text;
      b.addEventListener('click', () => lade(pfad));
      return b;
    };
    async function lade(pfad) {
      meldung.textContent = 'Loading…';
      const r = await a.host.holeGet(`/dateisystem/ordner?pfad=${encodeURIComponent(pfad)}`);
      if (r.status !== 200) { meldung.textContent = r.j?.text || `The folder list failed (${r.status || 'no connection'})`; meldung.classList.add('fehler'); return; }
      meldung.textContent = ''; meldung.classList.remove('fehler');
      const j = r.j ?? {};
      aktuell = j.pfad ?? pfad;
      waehle.disabled = aktuell === '';
      krumen.textContent = '';
      krumen.append(knopf('Roots', '', 'b-krume'));
      let teil = '';
      for (const s of aktuell.split('/').filter(Boolean)) { teil += `/${s}`; krumen.append(knopf(s, teil, 'b-krume')); }
      liste.textContent = '';
      if (aktuell !== '' && j.eltern !== undefined && j.eltern !== null) liste.append(knopf('..', j.eltern, 'b-dialog-zeile'));
      const eintraege = aktuell === '' ? (j.wurzeln ?? []) : (j.ordner ?? []);
      for (const o of eintraege) liste.append(knopf(o.name, o.pfad, 'b-dialog-zeile'));
      if (eintraege.length === 0) { const l = document.createElement('div'); l.className = 'b-dialog-leer'; l.textContent = 'No folders here'; liste.append(l); }
    }
    abbruch.addEventListener('click', () => zu(null));
    waehle.addEventListener('click', () => zu(aktuell));
    huelle.addEventListener('click', (e) => { if (e.target === huelle) zu(null); });
    document.addEventListener('keydown', taste, true);
    document.body.append(huelle);
    lade(a.start ?? '');
  });
}
