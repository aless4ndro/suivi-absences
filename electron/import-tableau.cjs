// Lecture d'un fichier tableur (CSV ou Excel .xlsx) en tableau { entetes, lignes }, reconnaissance des colonnes
// et nettoyage des valeurs (dates, téléphones, SIRET…) pour l'import des apprentis, entreprises et contrats.
const { lireClasseur, serieVersIso, sansAccent } = require('./calendrier-import.cjs');

// ---------- lecture des fichiers ----------

function decoderCsv(buffer) {
  let t = buffer.toString('utf8');
  if (t.charCodeAt(0) === 0xfeff) return t.slice(1);
  if (t.includes('�')) t = buffer.toString('latin1'); // fichier Excel « CSV » en Windows-1252
  return t;
}

function lireCsv(buffer) {
  const t = decoderCsv(buffer);
  const premiere = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', '\t', ',', '|'].map((s) => [s, premiere.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const lignes = [];
  let ligne = [];
  let champ = '';
  let guillemets = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (guillemets) {
      if (c === '"' && t[i + 1] === '"') { champ += '"'; i++; } else if (c === '"') guillemets = false; else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === sep) { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      ligne.push(champ); champ = '';
      lignes.push(ligne); ligne = [];
    } else champ += c;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes;
}

function lireFeuilleXlsx(buffer) {
  const feuilles = lireClasseur(buffer);
  let meilleure = null;
  for (const f of feuilles) {
    const cellules = [...f.cellules.values()].filter((c) => c.v !== null && c.v !== undefined && String(c.v).trim() !== '');
    if (!cellules.length) continue;
    if (!meilleure || cellules.length > meilleure.n) meilleure = { f, n: cellules.length, cellules };
  }
  if (!meilleure) throw new Error('Le classeur ne contient aucune donnée.');
  const maxR = Math.max(...meilleure.cellules.map((c) => c.r));
  const maxC = Math.max(...meilleure.cellules.map((c) => c.c));
  const lignes = [];
  for (let r = 1; r <= maxR; r++) {
    const ligne = [];
    for (let c = 1; c <= maxC; c++) {
      const x = meilleure.f.cellules.get(`${r},${c}`);
      if (!x || x.v === null || x.v === undefined) ligne.push('');
      else if (typeof x.v === 'number') ligne.push(x.date ? serieVersIso(x.v) : String(x.v));
      else ligne.push(String(x.v));
    }
    lignes.push(ligne);
  }
  return { lignes, feuille: meilleure.f.nom };
}

// ext : '.csv' | '.xlsx'
function lireTableau(buffer, ext) {
  let brut;
  let feuille = null;
  if (ext === '.csv') brut = lireCsv(buffer);
  else if (ext === '.xlsx') ({ lignes: brut, feuille } = lireFeuilleXlsx(buffer));
  else throw new Error('Format non pris en charge.');
  const non_vide = brut.filter((l) => l.some((c) => String(c).trim() !== ''));
  // en-têtes : première ligne comportant au moins 2 cellules de texte non numériques
  const idx = non_vide.findIndex((l) => l.filter((c) => String(c).trim() !== '' && Number.isNaN(Number(String(c).replace(',', '.')))).length >= 2);
  if (idx < 0 || idx >= non_vide.length - 1) throw new Error("Impossible de repérer la ligne d'en-têtes (noms des colonnes) dans ce fichier.");
  const entetes = non_vide[idx].map((c) => String(c).trim());
  const lignes = non_vide.slice(idx + 1).map((l) => entetes.map((_, i) => String(l[i] ?? '').trim()));
  if (!lignes.length) throw new Error('Le fichier ne contient aucune ligne de données sous les en-têtes.');
  if (lignes.length > 5000) throw new Error('Fichier trop long (5 000 lignes maximum).');
  return { entetes, lignes, feuille };
}

// ---------- reconnaissance des colonnes ----------

const CHAMPS = {
  nom_prenom: 'Nom et prénom (même colonne)',
  nom: 'Nom', prenom: 'Prénom', date_naissance: 'Date de naissance', adresse: 'Adresse', code_postal: 'Code postal', ville: 'Ville',
  cp_ville: 'Code postal et ville (même colonne)', telephone: 'Téléphone', email: 'E-mail',
  formation: 'Formation', classe: 'Classe', annee_formation: 'Année de formation', annee_scolaire: 'Année scolaire',
  ent_nom: 'Entreprise : raison sociale', ent_nom_commercial: 'Entreprise : nom commercial', ent_siret: 'Entreprise : SIRET',
  ent_adresse: 'Entreprise : adresse', ent_code_postal: 'Entreprise : code postal', ent_ville: 'Entreprise : ville',
  ent_cp_ville: 'Entreprise : code postal et ville', ent_telephone: 'Entreprise : téléphone', ent_email: 'Entreprise : e-mail',
  maitre_nom: 'Tuteur / maître d\'apprentissage : nom', maitre_fonction: 'Tuteur : fonction',
  maitre_telephone: 'Tuteur : téléphone', maitre_email: 'Tuteur : e-mail',
  contrat_type: 'Contrat : type', contrat_debut: 'Contrat : date de début', contrat_fin: 'Contrat : date de fin', contrat_info: 'Contrat : informations complémentaires',
};

function champDe(entete) {
  const t = sansAccent(entete).replace(/[^a-z0-9]+/g, ' ').trim();
  const s = t.replace(/ /g, '');
  if (!s) return null;
  const ent = /(entreprise|societe|employeur|raison ?sociale|siret|siren|enseigne)/.test(t) && !/(apprenti|alternant|eleve)/.test(t);
  const mait = /(tuteur|maitre|maitre d apprentissage|responsable)/.test(t);
  const contrat = /contrat/.test(t);

  if (/siret/.test(s)) return 'ent_siret';
  if (/(nomcommercial|enseigne)/.test(s)) return 'ent_nom_commercial';
  if (/raisonsociale/.test(s)) return 'ent_nom';
  if (mait && !contrat) {
    if (/(fonction|poste|qualite)/.test(s)) return 'maitre_fonction';
    if (/(mail|courriel)/.test(s)) return 'maitre_email';
    if (/(tel|mobile|portable|phone)/.test(s)) return 'maitre_telephone';
    return 'maitre_nom';
  }
  if (contrat) {
    if (/(debut|commenc|entree|signature)/.test(s)) return 'contrat_debut';
    if (/(fin|echeance|terme|sortie)/.test(s)) return 'contrat_fin';
    if (/(type|nature)/.test(s)) return 'contrat_type';
    if (/(info|observation|commentaire|complement|note)/.test(s)) return 'contrat_info';
    return 'contrat_type';
  }
  if (/(typedecontrat|nature)/.test(s)) return 'contrat_type';
  if (/(datedebut|debutalternance|debutapprentissage|datedentree)/.test(s)) return 'contrat_debut';
  if (/(datefin|finalternance|finapprentissage)/.test(s)) return 'contrat_fin';
  if (/(informationscomplementaires|infoscomplementaires|observation|commentaire)/.test(s)) return 'contrat_info';
  if (ent) {
    if (/(mail|courriel)/.test(s)) return 'ent_email';
    if (/(tel|phone)/.test(s)) return 'ent_telephone';
    if (/(codepostal(et)?ville|cp(et)?ville)/.test(s)) return 'ent_cp_ville';
    if (/(codepostal|cp$)/.test(s)) return 'ent_code_postal';
    if (/ville|commune/.test(s)) return 'ent_ville';
    if (/adresse|rue/.test(s)) return 'ent_adresse';
    return 'ent_nom';
  }
  if (/(nomprenom|nometprenom|apprenti$|apprenant|alternant$|eleve$)/.test(s)) return 'nom_prenom';
  if (/prenom/.test(s)) return 'prenom';
  if (/(naissance|nele|nee le|ddn)/.test(s)) return 'date_naissance';
  if (/(mail|courriel)/.test(s)) return 'email';
  if (/(tel|mobile|portable|phone)/.test(s)) return 'telephone';
  if (/(codepostal(et)?ville|cp(et)?ville)/.test(s)) return 'cp_ville';
  if (/(codepostal|^cp$)/.test(s)) return 'code_postal';
  if (/(ville|commune)/.test(s)) return 'ville';
  if (/(adresse|rue)/.test(s)) return 'adresse';
  if (/(anneescolaire|anneeuniversitaire|promotion)/.test(s)) return 'annee_scolaire';
  if (/(anneedeformation|anneeformation|niveau)/.test(s) || /^annee$/.test(s)) return 'annee_formation';
  if (/(formation|diplome|filiere|section|bts|licence)/.test(s)) return 'formation';
  if (/classe/.test(s)) return 'classe';
  if (/^nom/.test(s) || /(nomdefamille|nomusage|patronyme)/.test(s)) return 'nom';
  return null;
}

// Propose un champ par colonne (jamais le même champ deux fois : la première colonne l'emporte).
function reconnaitreColonnes(entetes) {
  const pris = new Set();
  return entetes.map((e) => {
    const c = champDe(e);
    if (!c || pris.has(c)) return null;
    pris.add(c);
    return c;
  });
}

// ---------- nettoyage des valeurs ----------

const vide = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };

function dateIso(v) {
  const s = vide(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let a; let mo; let j;
  if (m) [a, mo, j] = [m[1], m[2], m[3]];
  else if ((m = s.match(/^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2,4})$/))) {
    [j, mo, a] = [m[1], m[2], m[3]];
    if (a.length === 2) a = Number(a) > 40 ? `19${a}` : `20${a}`;
  } else if (/^\d{5}$/.test(s)) return serieVersIso(Number(s)); // numéro de série Excel
  else return undefined; // illisible
  const iso = `${a}-${String(mo).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : undefined;
}

function telephone(v) {
  const s = vide(v);
  if (!s) return null;
  let d = s.replace(/[^\d+]/g, '');
  if (d.startsWith('+33')) d = `0${d.slice(3)}`;
  else if (d.startsWith('0033')) d = `0${d.slice(4)}`;
  if (/^[1-9]\d{8}$/.test(d)) d = `0${d}`; // le zéro initial perdu par Excel
  if (/^0\d{9}$/.test(d)) return d.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
  return s; // format étranger ou inhabituel : conservé tel quel
}

function siret(v) {
  let s = vide(v);
  if (!s) return { valeur: null };
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) s = String(Math.round(Number(s))); // 1,23E+13 : le tableur a mutilé le nombre
  const d = s.replace(/[\s.]/g, '');
  if (/^\d{14}$/.test(d)) return { valeur: d };
  return { valeur: null, erreur: `SIRET « ${s} » invalide (14 chiffres attendus)` };
}

function email(v) {
  const s = vide(v);
  if (!s) return { valeur: null };
  const e = s.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? { valeur: e } : { valeur: null, erreur: `E-mail « ${s} » invalide` };
}

function codeVille(v) {
  const s = vide(v);
  if (!s) return [null, null];
  const m = s.match(/^(\d{5})\s*[-,]?\s*(.*)$/) ?? s.match(/^(.*?)[\s,-]+(\d{5})$/)?.slice(0, 3).reverse().map((x, i) => (i === 0 ? x : x));
  if (!m) return [null, s];
  return /^\d{5}$/.test(m[1]) ? [m[1], vide(m[2])] : [vide(m[2]), vide(m[1])];
}

function cp(v) {
  const s = vide(v);
  if (!s) return null;
  const d = s.replace(/\D/g, '');
  return d.length === 4 ? `0${d}` : d.length === 5 ? d : s; // zéro initial perdu (01000 → 1000)
}

const casse = (s) => (s ? s.replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()) : s);

// « DUPONT Jean-Pierre » → nom = mots en majuscules, prénom = le reste
function separerNomPrenom(v) {
  const s = vide(v);
  if (!s) return [null, null];
  if (s.includes(',')) { const [a, b] = s.split(',', 2); return [vide(a), vide(b)]; }
  const mots = s.split(/\s+/);
  const n = mots.findIndex((m) => m !== m.toUpperCase());
  if (n <= 0) return [mots[0], mots.slice(1).join(' ') || null];
  return [mots.slice(0, n).join(' '), mots.slice(n).join(' ')];
}

// Une ligne brute + la correspondance colonne → champ  ⇒  ligne normalisée { champs, anomalies }
function normaliserLigne(ligne, champs) {
  const g = {};
  champs.forEach((c, i) => { if (c && g[c] === undefined) g[c] = ligne[i] ?? ''; });
  const anomalies = [];
  const r = {};
  if (g.nom_prenom) [r.nom, r.prenom] = separerNomPrenom(g.nom_prenom);
  if (vide(g.nom)) r.nom = vide(g.nom);
  if (vide(g.prenom)) r.prenom = vide(g.prenom);
  if (r.nom && (r.nom === r.nom.toLowerCase() || r.nom === r.nom.toUpperCase())) r.nom = casse(r.nom);
  if (r.prenom) r.prenom = casse(r.prenom);
  const dn = dateIso(g.date_naissance);
  if (dn === undefined) { anomalies.push(`Date de naissance « ${g.date_naissance} » illisible`); } else r.date_naissance = dn;
  r.adresse = vide(g.adresse);
  let [c, v] = [cp(g.code_postal), vide(g.ville)];
  if (g.cp_ville) { const [a, b] = codeVille(g.cp_ville); c = c ?? a; v = v ?? b; }
  [r.code_postal, r.ville] = [c, v];
  r.telephone = telephone(g.telephone);
  const em = email(g.email); r.email = em.valeur; if (em.erreur) anomalies.push(em.erreur);
  r.formation = vide(g.formation); r.classe = vide(g.classe); r.annee_formation = vide(g.annee_formation); r.annee_scolaire = vide(g.annee_scolaire);
  r.ent_nom = vide(g.ent_nom); r.ent_nom_commercial = vide(g.ent_nom_commercial);
  const sr = siret(g.ent_siret); r.ent_siret = sr.valeur; if (sr.erreur) anomalies.push(sr.erreur);
  r.ent_adresse = vide(g.ent_adresse);
  let [ec, ev] = [cp(g.ent_code_postal), vide(g.ent_ville)];
  if (g.ent_cp_ville) { const [a, b] = codeVille(g.ent_cp_ville); ec = ec ?? a; ev = ev ?? b; }
  [r.ent_code_postal, r.ent_ville] = [ec, ev];
  r.ent_telephone = telephone(g.ent_telephone);
  const ee = email(g.ent_email); r.ent_email = ee.valeur; if (ee.erreur) anomalies.push(ee.erreur);
  r.maitre_nom = vide(g.maitre_nom); r.maitre_fonction = vide(g.maitre_fonction); r.maitre_telephone = telephone(g.maitre_telephone);
  const me = email(g.maitre_email); r.maitre_email = me.valeur; if (me.erreur) anomalies.push(me.erreur);
  r.contrat_type = vide(g.contrat_type); r.contrat_info = vide(g.contrat_info);
  for (const k of ['contrat_debut', 'contrat_fin']) {
    const d = dateIso(g[k]);
    if (d === undefined) anomalies.push(`Date « ${g[k]} » illisible (${CHAMPS[k]})`); else r[k] = d;
  }
  return { champs: r, anomalies };
}

module.exports = { lireTableau, reconnaitreColonnes, normaliserLigne, CHAMPS, dateIso, telephone, siret, separerNomPrenom };
