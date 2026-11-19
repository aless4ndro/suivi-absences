// Lecture d'un calendrier de formation au format PDF « mois en colonnes » (SEPTEMBRE, OCTOBRE… avec jours 1..31 et cases colorées).
// On lit les rectangles colorés et les textes du PDF (sans le dessiner) : la couleur de la case d'un jour = rectangle peint au-dessus du numéro.
// Résultat identique à celui de la lecture Excel (voir calendrier-import.cjs).
const { resultat, sansAccent } = require('./calendrier-import.cjs');

const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

async function chargerPdfjs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

function blanc(c) { return !c || c === 'FFFFFF'; }

// Rectangles remplis (ordre de peinture conservé) d'une page.
async function lireRectangles(page, OPS) {
  const ol = await page.getOperatorList();
  const rects = [];
  let couleur = '000000';
  for (let i = 0; i < ol.fnArray.length; i++) {
    const f = ol.fnArray[i];
    const a = ol.argsArray[i];
    if (f === OPS.setFillRGBColor) couleur = String(a[0]).replace('#', '').toUpperCase();
    else if (f === OPS.constructPath) {
      const paint = a[0];
      if (paint !== OPS.fill && paint !== OPS.eoFill && paint !== OPS.fillStroke && paint !== OPS.eoFillStroke) continue;
      const mm = a[2];
      if (!mm || mm.length < 4) continue;
      const [x0, y0, x1, y1] = [mm[0], mm[1], mm[2], mm[3]];
      if (x1 - x0 > 1000 || y1 - y0 > 700) continue; // fonds de page
      rects.push({ x0, y0, x1, y1, c: couleur });
    }
  }
  return rects;
}

async function lirePdf(buffer, anneeScolaire) {
  const pdfjs = await chargerPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, verbosity: 0, isEvalSupported: false }).promise;
  const avertissements = [];
  const [an0] = String(anneeScolaire).split('-').map(Number);
  const jours = [];
  const couleurs = new Map();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const textes = tc.items.filter((i) => i.str.trim()).map((i) => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], l: i.width, h: i.height || 8 }));
    const entetes = textes.filter((t) => MOIS.includes(sansAccent(t.s))).sort((a, b) => a.x - b.x);
    // une ligne d'en-têtes = les mois qui partagent la même hauteur (au moins 6)
    const parY = new Map();
    for (const e of entetes) { const k = Math.round(e.y); parY.set(k, [...(parY.get(k) ?? []), e]); }
    const ligne = [...parY.values()].sort((a, b) => b.length - a.length)[0];
    if (!ligne || ligne.length < 6) continue;
    const { OPS } = pdfjs;
    const rects = await lireRectangles(page, OPS);
    const yEntete = ligne[0].y;

    // colonnes : les « 1 » de la première ligne (la plus haute sous l'en-tête) donnent le début de chaque mois, dans l'ordre des en-têtes
    const sous = textes.filter((t) => /^\d{1,2}$/.test(t.s) && t.y < yEntete);
    const hautes = sous.filter((t) => t.s === '1');
    const yPremiere = Math.max(...hautes.map((t) => t.y));
    const debuts = hautes.filter((t) => Math.abs(t.y - yPremiere) < 3).map((t) => t.x).sort((x, y) => x - y);
    if (debuts.length !== ligne.length) { avertissements.push(`Page ${p} : ${ligne.length} mois en en-tête mais ${debuts.length} colonnes de jours repérées.`); }
    ligne.forEach((e, i) => {
      const x0 = debuts[i];
      if (x0 === undefined) return;
      const m = MOIS.indexOf(sansAccent(e.s)) + 1;
      const annee = m >= 9 ? an0 : an0 + 1;
      for (const t of sous.filter((n) => n.x >= x0 - 3 && n.x <= x0 + 6)) {
        const jour = Number(t.s);
        if (jour < 1 || jour > 31) continue;
        const dt = new Date(Date.UTC(annee, m - 1, jour));
        if (dt.getUTCMonth() !== m - 1) continue;
        if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) continue; // jours ouvrés uniquement
        const px = x0 + 35; // la couleur est portée par les cases à droite du numéro
        const py = t.y + t.h / 3;
        let cle = null;
        for (let k = rects.length - 1; k >= 0; k--) {
          const r = rects[k];
          if (px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1) { cle = blanc(r.c) ? null : r.c; break; }
        }
        if (cle) jours.push({ date: dt.toISOString().slice(0, 10), cle });
      }
    });

    // légende : textes placés dans (ou juste à droite d') une case colorée au-dessus de la grille
    const vues = new Set(jours.map((j) => j.cle));
    for (const r of rects) {
      if (blanc(r.c) || !vues.has(r.c) || r.y0 < yEntete + 5 || couleurs.has(r.c)) continue;
      const dedans = textes.filter((t) => t.x >= r.x0 - 1 && t.x <= r.x1 && t.y >= r.y0 - 2 && t.y <= r.y1);
      let lib = dedans.sort((a, b) => a.x - b.x).map((t) => t.s).join(' ');
      if (!lib) {
        const droite = textes.filter((t) => t.x > r.x1 && t.x < r.x1 + 140 && Math.abs(t.y - (r.y0 + r.y1) / 2) < 9).sort((a, b) => a.x - b.x);
        lib = droite.map((t) => t.s).join(' ');
      }
      if (lib) couleurs.set(r.c, lib);
    }
  }
  try { await doc.cleanup?.(); } catch { /* sans importance */ }
  if (!jours.length) throw new Error("Aucun calendrier reconnu dans ce PDF : il faut des mois en colonnes (SEPTEMBRE, OCTOBRE…) avec des cases colorées. Si le PDF est une image scannée, il ne peut pas être lu : utilisez la version Excel ou saisissez les jours dans l'aperçu.");
  avertissements.push('Calendrier lu depuis un PDF (jours ouvrés uniquement) : vérifiez attentivement l\'aperçu avant de valider.');
  return resultat(jours, couleurs, avertissements, 'PDF');
}

module.exports = { lirePdf };
