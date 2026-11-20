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

function feuillesXlsx(buffer) {
  const sortie = [];
  for (const f of lireClasseur(buffer)) {
    const cellules = [...f.cellules.values()].filter((c) => c.v !== null && c.v !== undefined && String(c.v).trim() !== '');
    if (!cellules.length) continue;
    const maxR = Math.max(...cellules.map((c) => c.r));
    const maxC = Math.max(...cellules.map((c) => c.c));
    const lignes = [];
    for (let r = 1; r <= maxR; r++) {
      const ligne = [];
      for (let c = 1; c <= maxC; c++) {
        const x = f.cellules.get(`${r},${c}`);
        if (!x || x.v === null || x.v === undefined) ligne.push('');
        else if (typeof x.v === 'number') ligne.push(x.date ? serieVersIso(x.v) : String(x.v));
        else ligne.push(String(x.v));
      }
      lignes.push(ligne);
    }
    sortie.push({ nom: f.nom, brut: lignes });
  }
  if (!sortie.length) throw new Error('Le classeur ne contient aucune donnée.');
  return sortie;
}

// Une feuille brute → { nom, entetes, lignes, numeros } ; null si pas d'en-têtes reconnaissables.
function tableauDe(nom, brut) {
  const indexes = brut.map((_, i) => i).filter((i) => brut[i].some((c) => String(c).trim() !== ''));
  const hdr = indexes.find((i) => brut[i].filter((c) => String(c).trim() !== '' && Number.isNaN(Number(String(c).replace(',', '.')))).length >= 2);
  if (hdr === undefined) return null;
  const entetes = brut[hdr].map((c) => String(c).replace(/\s+/g, ' ').trim());
  const corps = indexes.filter((i) => i > hdr);
  if (!corps.length) return null;
  return { nom, entetes, lignes: corps.map((i) => entetes.map((_, k) => String(brut[i][k] ?? '').trim())), numeros: corps.map((i) => i + 1) };
}

// ext : '.csv' | '.xlsx' ⇒ { feuilles: [{ nom, entetes, lignes, numeros }], ignorees: [noms] }
function lireTableau(buffer, ext) {
  let sources;
  if (ext === '.csv') sources = [{ nom: null, brut: lireCsv(buffer) }];
  else if (ext === '.xlsx') sources = feuillesXlsx(buffer);
  else throw new Error('Format non pris en charge.');
  const feuilles = [];
  const ignorees = [];
  for (const f of sources) {
    const t = tableauDe(f.nom, f.brut);
    if (t) feuilles.push(t); else ignorees.push(f.nom ?? 'fichier');
  }
  if (!feuilles.length) throw new Error("Impossible de repérer les en-têtes (noms des colonnes) et des lignes de données dans ce fichier.");
  if (feuilles.reduce((n, f) => n + f.lignes.length, 0) > 5000) throw new Error('Fichier trop long (5 000 lignes maximum).');
  return { feuilles, ignorees };
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
  ent_bloc: 'Entreprise : bloc complet (nom, adresse, CP/ville, tél., e-mail dans une cellule)',
  maitre_bloc: 'Maître d\'apprentissage : bloc complet (nom, tél., e-mail, diplôme dans une cellule)',
  contrat_periode: 'Contrat : période « du … au … »', contrat_duree: 'Contrat : durée hebdomadaire',
  contrat_type: 'Contrat : type', contrat_debut: 'Contrat : date de début', contrat_fin: 'Contrat : date de fin', contrat_info: 'Contrat : informations complémentaires',
};

function champDe(entete) {
  const t = sansAccent(entete).replace(/[^a-z0-9]+/g, ' ').trim();
  const s = t.replace(/ /g, '');
  if (!s) return null;
  const ent = /(entreprise|societe|employeur|raison ?sociale|siret|siren|enseigne)/.test(t) && !/\b(apprentis?|alternants?|eleves?)\b/.test(t);
  const mait = /(tuteur|maitre|maitre d apprentissage|responsable)/.test(t);
  const contrat = /contrat/.test(t);

  if (/siret/.test(s)) return 'ent_siret';
  if (/(nomcommercial|enseigne)/.test(s)) return 'ent_nom_commercial';
  if (/raisonsociale/.test(s)) return 'ent_nom';
  if (mait && !contrat) {
    if (/coordonnees/.test(s)) return 'maitre_bloc';
    if (/(fonction|poste|qualite)/.test(s)) return 'maitre_fonction';
    if (/(mail|courriel)/.test(s)) return 'maitre_email';
    if (/(tel|mobile|portable|phone)/.test(s)) return 'maitre_telephone';
    return 'maitre_nom';
  }
  if (/(datedecontrat|periodedecontrat|periodecontrat|dureedecontrat)/.test(s)) return 'contrat_periode';
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
    if (/(lieu|coordonnees|bloc)/.test(s)) return 'ent_bloc';
    if (/(mail|courriel)/.test(s)) return 'ent_email';
    if (/(tel|phone)/.test(s)) return 'ent_telephone';
    if (/(codepostal(et)?ville|cp(et)?ville)/.test(s)) return 'ent_cp_ville';
    if (/(codepostal|cp$)/.test(s)) return 'ent_code_postal';
    if (/ville|commune/.test(s)) return 'ent_ville';
    if (/adresse|rue/.test(s)) return 'ent_adresse';
    return 'ent_nom';
  }
  if (/(nomprenom|nometprenom|identite|apprenti$|apprenant|alternant$|eleve$)/.test(s)) return 'nom_prenom';
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
// Les colonnes sans en-tête exploitable sont reconnues d'après leur contenu (noms de personnes, « 35H »).
function reconnaitreColonnes(entetes, lignes = []) {
  const pris = new Set();
  const res = entetes.map((e) => {
    const c = champDe(e);
    if (!c || pris.has(c)) return null;
    pris.add(c);
    return c;
  });
  const valeurs = (i) => lignes.map((l) => String(l[i] ?? '').trim()).filter(Boolean);
  if (!pris.has('nom') && !pris.has('nom_prenom')) {
    const i = entetes.findIndex((_, k) => {
      if (res[k] && res[k] !== 'formation') return false;
      const v = valeurs(k);
      return v.length >= 2 && v.filter((x) => /\p{Lu}{2,}/u.test(x) && /\s/.test(x.trim())).length / v.length >= 0.6;
    });
    if (i >= 0) { res[i] = 'nom_prenom'; pris.add('nom_prenom'); }
  }
  if (!pris.has('contrat_duree')) {
    const i = entetes.findIndex((_, k) => {
      if (res[k]) return false;
      const v = valeurs(k);
      return v.length >= 2 && v.filter((x) => /^\d{1,2}\s?h(\d{2})?$/i.test(x)).length / v.length >= 0.8;
    });
    if (i >= 0) res[i] = 'contrat_duree';
  }
  return res;
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

// « DUPONT Jean-Pierre » ou « Davina MARTHON » : nom = mots en majuscules, prénom = le reste
function separerNomPrenom(v) {
  const s = vide(v);
  if (!s) return [null, null];
  if (s.includes(',')) { const [a, b] = s.split(',', 2); return [vide(a), vide(b)]; }
  const mots = s.split(/\s+/);
  const maj = (m) => m.length > 1 && m === m.toUpperCase() && m !== m.toLowerCase();
  const nom = mots.filter(maj);
  const prenom = mots.filter((m) => !maj(m));
  if (nom.length && prenom.length) return [nom.join(' '), prenom.join(' ')];
  return [mots[0], mots.slice(1).join(' ') || null];
}

const lignesDe = (t) => String(t ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const estTel = (l) => /^\(\s*[\d.\s\-+]*$/.test(l) || /^(tel|tél|t[ée]l[ée]phone)\b/i.test(l);
const estMail = (l) => /^\*/.test(l) || /@/.test(l);
const premierMail = (l) => (l.match(/[^\s@:*,;]+@[^\s@,;]+\.[^\s@,;]+/) ?? [])[0]?.toLowerCase() ?? null;

// Bloc d'une entreprise (nom, adresse, code postal et ville, ( téléphone, * e-mail)
function blocEntreprise(t) {
  const l = lignesDe(t);
  if (!l.length) return {};
  const r = { ent_nom: l[0] };
  const adresse = [];
  for (const x of l.slice(1)) {
    if (estTel(x)) { const tel = telephone(x.replace(/^\(\s*/, '').replace(/^(tel|tél|téléphone)\s*:?\s*/i, '')); if (tel && !r.ent_telephone) r.ent_telephone = tel; continue; }
    if (estMail(x)) { const m = premierMail(x); if (m && !r.ent_email) r.ent_email = m; continue; }
    const m = x.match(/\b(\d{5})\s+([A-Za-zÀ-ÿ'’\- ]+?)\s*$/);
    if (m && !r.ent_code_postal) { r.ent_code_postal = m[1]; r.ent_ville = casse(m[2].trim()); const av = x.slice(0, m.index).trim(); if (av) adresse.push(av); continue; }
    adresse.push(x);
  }
  if (adresse.length) r.ent_adresse = adresse.join(', ');
  return r;
}

// Bloc d'un contact (nom, fonction éventuelle, ( téléphone, * e-mail, Diplôme : …)
function blocContact(t) {
  const l = lignesDe(t);
  if (!l.length) return {};
  const r = {};
  const autres = [];
  for (const [i, x] of l.entries()) {
    if (estTel(x)) { const tel = telephone(x.replace(/^\(\s*/, '')); if (tel && !r.telephone) r.telephone = tel; }
    else if (estMail(x)) { const m = premierMail(x); if (m && !r.email) r.email = m; }
    else if (/^dipl[oô]me/i.test(x)) r.diplome = x.replace(/^dipl[oô]me\s*:?\s*/i, '').trim();
    else if (i === 0) r.nom = x;
    else autres.push(x);
  }
  if (autres.length) r.fonction = autres.join(' ');
  return r;
}

// « 01/09/2026 au 31/08/2028 » → [début, fin]
function periode(t) {
  const m = String(t ?? '').match(/(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})\s*(?:au|à|-|–)\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/i);
  if (m) return [dateIso(m[1]), dateIso(m[2])];
  const d = dateIso(String(t ?? '').trim());
  return [d, null];
}

// Une ligne brute + la correspondance colonne → champ  ⇒  ligne normalisée { champs, anomalies }
// feuille : nom de la feuille Excel, utilisé comme classe quand le tableau n'en indique pas.
function normaliserLigne(ligne, champs, feuille = null) {
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
  if (!r.formation && !r.classe && !r.annee_formation && feuille) r.classe = feuille;
  // entreprise : un bloc de texte (plusieurs lignes) est décomposé
  const blocE = g.ent_bloc ?? ((/\n/.test(String(g.ent_nom ?? '').trim())) ? g.ent_nom : null);
  const be = blocE ? blocEntreprise(blocE) : {};
  r.ent_nom = vide(be.ent_nom ?? g.ent_nom); r.ent_nom_commercial = vide(g.ent_nom_commercial);
  const sr = siret(g.ent_siret); r.ent_siret = sr.valeur; if (sr.erreur) anomalies.push(sr.erreur);
  r.ent_adresse = vide(g.ent_adresse) ?? be.ent_adresse ?? null;
  let [ec, ev] = [cp(g.ent_code_postal), vide(g.ent_ville)];
  if (g.ent_cp_ville) { const [a, b] = codeVille(g.ent_cp_ville); ec = ec ?? a; ev = ev ?? b; }
  [r.ent_code_postal, r.ent_ville] = [ec ?? be.ent_code_postal ?? null, ev ?? be.ent_ville ?? null];
  r.ent_telephone = telephone(g.ent_telephone) ?? be.ent_telephone ?? null;
  const ee = email(g.ent_email); r.ent_email = ee.valeur ?? be.ent_email ?? null; if (ee.erreur) anomalies.push(ee.erreur);
  // maître d'apprentissage : idem
  const blocM = g.maitre_bloc ?? ((/\n/.test(String(g.maitre_nom ?? '').trim())) ? g.maitre_nom : null);
  const bm = blocM ? blocContact(blocM) : {};
  r.maitre_nom = vide(bm.nom ?? g.maitre_nom); r.maitre_fonction = vide(g.maitre_fonction) ?? bm.fonction ?? null;
  r.maitre_telephone = telephone(g.maitre_telephone) ?? bm.telephone ?? null;
  const me = email(g.maitre_email); r.maitre_email = me.valeur ?? bm.email ?? null; if (me.erreur) anomalies.push(me.erreur);
  // contrat : période « du … au … », durée hebdomadaire, diplôme du maître
  r.contrat_type = vide(g.contrat_type);
  r.contrat_info = [vide(g.contrat_info), vide(g.contrat_duree) && `Durée hebdomadaire : ${vide(g.contrat_duree)}`, bm.diplome && `Diplôme du maître d'apprentissage : ${bm.diplome}`].filter(Boolean).join(' ; ') || null;
  const [pd, pf] = g.contrat_periode ? periode(g.contrat_periode) : [null, null];
  if (g.contrat_periode && vide(g.contrat_periode) && pd === null && pf === null) anomalies.push(`Période de contrat « ${g.contrat_periode} » illisible`);
  for (const k of ['contrat_debut', 'contrat_fin']) {
    const d = dateIso(g[k]);
    if (d === undefined) anomalies.push(`Date « ${g[k]} » illisible (${CHAMPS[k]})`); else r[k] = d;
  }
  r.contrat_debut = r.contrat_debut ?? pd ?? null;
  r.contrat_fin = r.contrat_fin ?? pf ?? null;
  return { champs: r, anomalies };
}

// Toutes les feuilles d'un fichier → lignes normalisées. Une ligne sans apprenti mais avec un contact (maître, RH…)
// complète la ligne précédente : le contact est ajouté à l'entreprise de l'apprenti précédent.
function normaliserFeuilles(feuilles) {
  const sortie = [];
  for (const f of feuilles) {
    let precedente = null;
    let apresMarqueur = null;
    f.lignes.forEach((ligne, i) => {
      // ligne de texte seule annonçant une autre liste (« Etape 2 - en cours d'inscription… ») : les lignes suivantes ne sont pas des apprentis confirmés
      const cellules = ligne.map((x) => String(x).trim()).filter(Boolean);
      if (!apresMarqueur && cellules.length === 1 && /(etape|inscri|parcoursup|liste d.attente|en attente)/i.test(cellules[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '')) && !/@/.test(cellules[0])) {
        apresMarqueur = cellules[0].replace(/\s+/g, ' ');
        return;
      }
      if (apresMarqueur && cellules.length === 1 && /(inscri|parcoursup)/i.test(cellules[0])) { apresMarqueur += ` ${cellules[0]}`; return; }
      const n = normaliserLigne(ligne, f.champs, f.nom);
      n.source = { feuille: f.nom, ligne: f.numeros?.[i] ?? i + 2 };
      const c = n.champs;
      const aApprenti = (c.nom || c.prenom) && !/[\d:/@]/.test(`${c.nom ?? ''}${c.prenom ?? ''}`) && !/^effectifs?\b/i.test(c.nom ?? '');
      if (!aApprenti) {
        const g = {};
        f.champs.forEach((k, idx) => { if (k && g[k] === undefined) g[k] = ligne[idx] ?? ''; });
        const bloc = g.maitre_bloc ?? g.maitre_nom;
        if (precedente && bloc) {
          const ct = blocContact(bloc);
          if (ct.nom) (precedente.champs.contacts_extra ??= []).push({ nom: ct.nom, fonction: ct.fonction ?? null, telephone: ct.telephone ?? null, email: ct.email ?? null });
        }
        return; // ligne vide ou simple contact : pas d'apprenti
      }
      if (apresMarqueur) n.exclu_defaut = `placée sous la mention « ${apresMarqueur} »`;
      else if (ligne.some((x) => /annul/i.test(x))) n.exclu_defaut = 'mention « Annulation » dans la ligne';
      sortie.push(n);
      precedente = n;
    });
  }
  return sortie;
}

module.exports = { lireTableau, reconnaitreColonnes, normaliserLigne, normaliserFeuilles, blocEntreprise, blocContact, periode, CHAMPS, dateIso, telephone, siret, separerNomPrenom };
