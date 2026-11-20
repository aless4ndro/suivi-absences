// Écriture d'un classeur .xlsx (sans dépendance) : textes, nombres, styles (polices, fonds, bordures), fusions, largeurs, hauteurs.
const { ecrireZip } = require('./zip.cjs');

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colonne = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const numCol = (lettres) => [...lettres].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

// Styles nommés (mise en page des tableaux de bord de l'établissement). « a » = ligne alternée (fond bleu très clair).
const FOND = { titre: 'D6DCE4', bloc: 'EDDFED', th: '8497B0', alt: 'F1F9FE' };
const STYLES = {
  defaut: {},
  gras: { b: true },
  titre: { b: true, sz: 16, fond: FOND.titre, h: 'center', v: 'center', bord: true },
  bloc: { b: true, sz: 11, fond: FOND.bloc, h: 'left', v: 'center', bord: true },
  lib: { sz: 10, h: 'left', bord: true },
  val: { sz: 10, h: 'right', bord: true },
  th: { b: true, sz: 10, blanc: true, fond: FOND.th, h: 'left', bord: true },
  thc: { b: true, sz: 10, blanc: true, fond: FOND.th, h: 'center', bord: true },
  td: { sz: 10, h: 'left', bord: true }, tda: { sz: 10, h: 'left', fond: FOND.alt, bord: true },
  tdc: { sz: 10, h: 'center', bord: true }, tdca: { sz: 10, h: 'center', fond: FOND.alt, bord: true },
  tdn: { sz: 10, h: 'right', bord: true }, tdna: { sz: 10, h: 'right', fond: FOND.alt, bord: true },
  entete: { b: true }, // 1re ligne des feuilles simples
};

// Cellule : valeur simple, ou { v, s: nom de style }. Feuille : { nom, lignes, fusions?: ['A1:F1'], largeurs?: {A: 22.8} | [..], hauteurs?: {1: 28.5}, entete?: bool }
function ecrireXlsx(feuilles) {
  if (!feuilles.length) throw new Error('Aucune feuille à écrire.');
  const noms = new Set();
  const fe = feuilles.map((f, i) => {
    let nom = String(f.nom || `Feuille${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || `Feuille${i + 1}`;
    while (noms.has(nom.toLowerCase())) nom = `${nom.slice(0, 28)}_${i + 1}`;
    noms.add(nom.toLowerCase());
    return { ...f, nom };
  });

  // registre des styles utilisés
  const polices = [{ b: false, sz: 11, blanc: false }];
  const fonds = [];
  const xfs = [{ font: 0, fond: 0, bord: 0, h: null, v: null }];
  const idStyle = new Map([['defaut', 0]]);
  const pol = (st) => { const k = { b: !!st.b, sz: st.sz ?? 11, blanc: !!st.blanc }; let i = polices.findIndex((p) => p.b === k.b && p.sz === k.sz && p.blanc === k.blanc); if (i < 0) { polices.push(k); i = polices.length - 1; } return i; };
  const fon = (c) => { if (!c) return 0; let i = fonds.indexOf(c); if (i < 0) { fonds.push(c); i = fonds.length - 1; } return i + 2; };
  const style = (nom) => {
    if (idStyle.has(nom)) return idStyle.get(nom);
    const st = STYLES[nom];
    if (!st) throw new Error(`Style inconnu : ${nom}`);
    xfs.push({ font: pol(st), fond: fon(st.fond), bord: st.bord ? 1 : 0, h: st.h ?? null, v: st.v ?? null });
    idStyle.set(nom, xfs.length - 1);
    return xfs.length - 1;
  };

  const feuillesXml = fe.map((f) => {
    const lignes = f.lignes.map((l, r) => {
      const cells = l.map((cell, c) => {
        let v = cell; let s = null;
        if (cell && typeof cell === 'object') { v = cell.v; s = cell.s ?? null; }
        if (s === null && f.entete !== false && f.entete !== undefined && r === 0) s = 'entete';
        const sid = s ? style(s) : 0;
        const ref = `${colonne(c)}${r + 1}`;
        const at = sid ? ` s="${sid}"` : '';
        if (v === null || v === undefined || v === '') return sid ? `<c r="${ref}"${at}/>` : '';
        return typeof v === 'number' && Number.isFinite(v)
          ? `<c r="${ref}"${at}><v>${v}</v></c>`
          : `<c r="${ref}"${at} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join('');
      const h = f.hauteurs?.[r + 1];
      return `<row r="${r + 1}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cells}</row>`;
    }).join('');
    const lg = Array.isArray(f.largeurs) ? Object.fromEntries(f.largeurs.map((w, i) => [colonne(i), w])) : (f.largeurs ?? null)
      ?? Object.fromEntries(f.lignes.reduce((m, l) => l.map((cell, c) => Math.max(m[c] ?? 8, Math.min(60, String(cell && typeof cell === 'object' ? cell.v ?? '' : cell ?? '').length + 2))), []).map((w, i) => [colonne(i), w]));
    const cols = Object.entries(lg).map(([k, w]) => [numCol(k), w]).sort((a, b) => a[0] - b[0]).map(([c, w]) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('');
    const fus = (f.fusions ?? []).length ? `<mergeCells count="${f.fusions.length}">${f.fusions.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${lignes}</sheetData>${fus}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait" fitToHeight="0"/></worksheet>`;
  });

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="${polices.length}">${polices.map((p) => `<font>${p.b ? '<b/>' : ''}<sz val="${p.sz}"/>${p.blanc ? '<color rgb="FFFFFFFF"/>' : ''}<name val="Calibri"/></font>`).join('')}</fonts>
<fills count="${fonds.length + 2}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fonds.map((c) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.map((x) => `<xf numFmtId="0" fontId="${x.font}" fillId="${x.fond}" borderId="${x.bord}" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${x.h || x.v ? ` applyAlignment="1"><alignment${x.h ? ` horizontal="${x.h}"` : ''}${x.v ? ` vertical="${x.v}"` : ''}/></xf>` : '/>'}`).join('')}</cellXfs></styleSheet>`;

  const e = new Map();
  e.set('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${fe.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`));
  e.set('_rels/.rels', Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'));
  e.set('xl/workbook.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${fe.map((f, i) => `<sheet name="${esc(f.nom)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`));
  e.set('xl/_rels/workbook.xml.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fe.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${fe.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`));
  e.set('xl/styles.xml', Buffer.from(stylesXml));
  feuillesXml.forEach((x, i) => e.set(`xl/worksheets/sheet${i + 1}.xml`, Buffer.from(x)));
  return ecrireZip(e);
}
module.exports = { ecrireXlsx, STYLES };
