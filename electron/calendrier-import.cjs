// Lecture d'un calendrier de formation au format Excel (.xlsx) : les cellules colorées (ou un tableau de dates) sont converties en jours.
// Résultat intermédiaire : { jours: [{ date, cle }], legende: [{ cle, libelle, type_propose, nb }], avertissements }
// « cle » = couleur de la cellule (ou texte du type) ; l'utilisateur associe chaque clé à un type dans l'aperçu.
const { lireZip } = require('./zip.cjs');

const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const sansAccent = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const decoder = (t) => t.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Type proposé d'après le libellé de la légende ; null = à choisir par l'utilisateur.
function typePropose(libelle) {
  const t = sansAccent(libelle);
  if (/ferie|vacance|conge|examen|autre|fermeture/.test(t)) return 'autre';
  if (/entreprise|immersion|stage|employeur|alternance/.test(t)) return 'entreprise';
  if (/ecole|centre|cours|presentiel|formation|cfa|ufa/.test(t)) return 'centre';
  return null;
}

function colRang(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function lireClasseur(buffer) {
  const z = lireZip(buffer);
  const texte = (n) => (z.has(n) ? z.get(n).toString('utf8') : null);
  const wb = texte('xl/workbook.xml');
  if (!wb) throw new Error("Ce fichier n'est pas un classeur Excel .xlsx valide.");

  const partages = [];
  const ss = texte('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) partages.push(decoder([...m[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((x) => x[1]).join('')));

  // styles : numéro de style → couleur de remplissage (RGB), format date
  const styles = texte('xl/styles.xml') ?? '';
  const remplissages = [...(styles.match(/<fills[\s\S]*?<\/fills>/)?.[0] ?? '').matchAll(/<fill>([\s\S]*?)<\/fill>/g)].map((m) => {
    const rgb = m[1].match(/<fgColor[^>]*rgb="([0-9A-Fa-f]{6,8})"/);
    const theme = m[1].match(/<fgColor[^>]*theme="(\d+)"(?:[^>]*tint="(-?[\d.]+)")?/);
    const indexed = m[1].match(/<fgColor[^>]*indexed="(\d+)"/);
    if (!/patternType="solid"/.test(m[1])) return null;
    if (rgb) { const c = rgb[1].slice(-6).toUpperCase(); return c === 'FFFFFF' ? null : c; }
    if (theme) return `THEME${theme[1]}${theme[2] ? `/${theme[2]}` : ''}`;
    if (indexed) return indexed[1] === '64' ? null : `INDEX${indexed[1]}`;
    return null;
  });
  const formatsDates = new Set();
  for (const m of styles.matchAll(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g)) if (/[dmy]/i.test(m[2].replace(/"[^"]*"/g, '')) && !/[hs]/i.test(m[2])) formatsDates.add(Number(m[1]));
  for (const i of [14, 15, 16, 17, 22, 45, 46, 47]) formatsDates.add(i);
  const xfs = [...(styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/)?.[0] ?? '').matchAll(/<xf\b([^>]*)>/g)].map((m) => ({
    fill: remplissages[Number(m[1].match(/fillId="(\d+)"/)?.[1] ?? 0)] ?? null,
    date: formatsDates.has(Number(m[1].match(/numFmtId="(\d+)"/)?.[1] ?? 0)),
  }));

  const feuilles = [...wb.matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"/g)].map((m) => ({ nom: decoder(m[1]), rid: m[2] }));
  const rels = texte('xl/_rels/workbook.xml.rels') ?? '';
  const sortie = [];
  for (const f of feuilles) {
    const cible = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${f.rid}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${f.rid}"`))?.[1];
    if (!cible) continue;
    const xml = texte(`xl/${cible.replace(/^\/?(xl\/)?/, '')}`);
    if (!xml) continue;
    const cellules = new Map(); // "r,c" → { v, fill, date }
    for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = m[1].match(/\br="([A-Z]+)(\d+)"/);
      if (!ref) continue;
      const s = Number(m[1].match(/\bs="(\d+)"/)?.[1] ?? 0);
      const t = m[1].match(/\bt="(\w+)"/)?.[1];
      const brut = m[2]?.match(/<v>([^<]*)<\/v>/)?.[1];
      let v = null;
      if (t === 's' && brut !== undefined) v = partages[Number(brut)];
      else if (t === 'inlineStr') v = decoder([...(m[2] ?? '').matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((x) => x[1]).join(''));
      else if (brut !== undefined) v = t === 'str' || t === 'b' ? decoder(brut) : Number(brut);
      cellules.set(`${Number(ref[2])},${colRang(ref[1])}`, { v, fill: xfs[s]?.fill ?? null, date: !!xfs[s]?.date, r: Number(ref[2]), c: colRang(ref[1]) });
    }
    sortie.push({ nom: f.nom, cellules });
  }
  return sortie;
}

const serieVersIso = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);

// anneeScolaire : « 2026-2027 »
function lireXlsx(buffer, anneeScolaire) {
  const an0 = Number(String(anneeScolaire).slice(0, 4));
  if (!(an0 >= 2000)) throw new Error('Année scolaire invalide.');
  const avertissements = [];
  const feuilles = lireClasseur(buffer);
  if (!feuilles.length) throw new Error('Le classeur ne contient aucune feuille lisible.');

  for (const f of feuilles) {
    const jours = [];
    const couleurs = new Map(); // clé couleur → libellé trouvé dans la légende
    // --- disposition 1 : mois en colonnes (en-têtes « SEPTEMBRE », « OCTOBRE »…) et jours 1 à 31 en dessous
    const entetes = [...f.cellules.values()].filter((c) => typeof c.v === 'string' && MOIS.includes(sansAccent(c.v)));
    if (entetes.length >= 6) {
      const zone = new Set();
      for (const e of entetes) {
        const m = MOIS.indexOf(sansAccent(e.v)) + 1;
        const annee = m >= 9 ? an0 : an0 + 1;
        for (let r = e.r + 1; r <= e.r + 34; r++) {
          // numéro du jour : première cellule numérique 1..31 dans les 3 colonnes du mois
          let jour = null;
          let col = null;
          for (let c = e.c; c <= e.c + 2; c++) {
            const x = f.cellules.get(`${r},${c}`);
            const n = typeof x?.v === 'number' ? x.v : /^\d{1,2}$/.test(String(x?.v ?? '').trim()) ? Number(x.v) : null;
            if (n !== null && n >= 1 && n <= 31) { jour = n; col = c; break; }
          }
          if (jour === null) continue;
          const dt = new Date(Date.UTC(annee, m - 1, jour));
          if (dt.getUTCMonth() !== m - 1) continue; // 30 février, 31 avril…
          let cle = null;
          for (let c = e.c; c <= e.c + 3; c++) {
            const x = f.cellules.get(`${r},${c}`);
            zone.add(`${r},${c}`);
            if (x?.fill && !cle) cle = x.fill;
          }
          if (cle) jours.push({ date: dt.toISOString().slice(0, 10), cle });
        }
      }
      // légende : une cellule colorée hors grille, avec un texte dans la cellule ou la voisine de droite
      for (const x of f.cellules.values()) {
        if (!x.fill || zone.has(`${x.r},${x.c}`)) continue;
        const lib = [x, f.cellules.get(`${x.r},${x.c + 1}`), f.cellules.get(`${x.r},${x.c + 2}`)].find((y) => typeof y?.v === 'string' && y.v.trim())?.v;
        if (lib && !couleurs.has(x.fill)) couleurs.set(x.fill, lib.trim());
      }
      if (jours.length) return resultat(jours, couleurs, avertissements, f.nom);
    }

    // --- disposition 2 : tableau (une colonne de dates, un type en texte ou une couleur)
    for (const x of f.cellules.values()) {
      let iso = null;
      if (typeof x.v === 'number' && x.date) iso = serieVersIso(x.v);
      else if (typeof x.v === 'string') {
        const m = x.v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      }
      if (!iso) continue;
      const voisines = [1, 2, 3].map((d) => f.cellules.get(`${x.r},${x.c + d}`)).filter(Boolean);
      const texte = voisines.find((y) => typeof y.v === 'string' && y.v.trim())?.v?.trim();
      const cle = texte ? `TEXTE:${sansAccent(texte)}` : x.fill ?? voisines.find((y) => y.fill)?.fill;
      if (!cle) continue;
      if (texte) couleurs.set(cle, texte);
      jours.push({ date: iso, cle });
    }
    if (jours.length) return resultat(jours, couleurs, avertissements, f.nom);
  }
  throw new Error("Aucun calendrier reconnu dans ce classeur : il faut soit des mois en colonnes (SEPTEMBRE, OCTOBRE…) avec des cellules colorées, soit un tableau « date + type ». Vous pouvez aussi saisir les jours à la main dans l'aperçu.");
}

function resultat(jours, couleurs, avertissements, feuille) {
  const nb = new Map();
  for (const j of jours) nb.set(j.cle, (nb.get(j.cle) ?? 0) + 1);
  const legende = [...nb.entries()].map(([cle, n]) => {
    const libelle = couleurs.get(cle) ?? null;
    return { cle, libelle, type_propose: libelle ? typePropose(libelle) : null, nb: n };
  }).sort((a, b) => b.nb - a.nb);
  if (legende.some((l) => !l.libelle)) avertissements.push("Certaines couleurs n'ont pas de légende reconnue : choisissez leur type dans l'aperçu.");
  return { feuille, jours: jours.sort((a, b) => a.date.localeCompare(b.date)), legende, avertissements };
}

module.exports = { lireXlsx, typePropose, resultat, sansAccent, lireClasseur, serieVersIso };
