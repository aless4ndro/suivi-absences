// Import des apprentis, entreprises et contrats depuis un tableau (voir import-tableau.cjs) :
// analyse (rapprochement avec la base, doublons, anomalies), validation, historique et annulation.
// L'analyse ne modifie jamais la base ; la validation applique uniquement ce que l'utilisateur a confirmé.
const { sansAccent } = require('./calendrier-import.cjs');

const ORIGINE = '2000-01-01';
const FORMES = /\b(sarl|sas|sasu|eurl|sa|snc|sci|scop|ei|eirl|ets|etablissements?|ste|societe|entreprise|ent|groupe|la|le|les|l|et|de|du|des|d)\b/g;
const cleNom = (t) => sansAccent(t).replace(/[^a-z0-9 ]+/g, ' ').replace(FORMES, ' ').replace(/\s+/g, ' ').trim();
const cleTexte = (t) => sansAccent(t).replace(/[^a-z0-9]+/g, ' ').trim();
const maintenant = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const CH_APPRENTI = ['email', 'telephone', 'adresse', 'code_postal', 'ville', 'date_naissance'];
const CH_ENTREPRISE = [['ent_nom_commercial', 'nom_commercial'], ['ent_siret', 'siret'], ['ent_adresse', 'adresse'], ['ent_code_postal', 'code_postal'], ['ent_ville', 'ville'], ['ent_telephone', 'telephone'], ['ent_email', 'email']];
const CH_CONTRAT = [['maitre_nom', 'maitre_nom'], ['maitre_fonction', 'maitre_fonction'], ['maitre_telephone', 'maitre_telephone'], ['maitre_email', 'maitre_email'], ['contrat_type', 'contrat_type'], ['contrat_debut', 'contrat_debut'], ['contrat_fin', 'contrat_fin']];

// Classe de l'application correspondant au texte du fichier (formation, classe, année de formation) ; null si doute.
function proposerClasse(texte, classes) {
  const t = ` ${cleTexte(texte).replace(/([a-z])([123])\b/g, '$1 $2')} `;
  if (t.trim() === '') return null;
  const exact = classes.find((c) => cleTexte(c.code) === t.trim());
  if (exact) return exact.id;
  let annee = null;
  const m = t.match(/ ([123]) ?(?:ere|er|re|eme|e|ieme|a|annee)? /) ?? t.match(/(premiere|deuxieme|troisieme|1ere|2eme|3eme)/);
  if (m) annee = { premiere: 1, deuxieme: 2, troisieme: 3 }[m[1]] ?? Number(String(m[1]).slice(0, 1));
  const candidats = classes.filter((c) => {
    const base = cleTexte(c.code.replace(/\d+\s*(ère|ème|e|er)\s+année/i, ''));
    const anneeC = Number(c.code.match(/(\d)\s*(?:ère|ème|e|er)\s+année/i)?.[1]);
    const mots = base.split(' ').filter(Boolean);
    // « LCVM » s'écrit aussi « Licence CVM » : le L de licence est facultatif
    const present = (w) => t.includes(` ${w} `) || t.includes(w) || (/^l[a-z]{2,}$/.test(w) && t.includes(w.slice(1)));
    if (!mots.length || !mots.every(present)) return false;
    return annee === null || !anneeC || anneeC === annee;
  });
  return candidats.length === 1 ? candidats[0].id : null;
}

function creerImportDonnees(db, h) {
  const { vide, dateValide, aujourdhui, synchroniser, contratDe, classeDe } = h;

  const classes = () => db.prepare('SELECT id, code, libelle FROM classes ORDER BY ordre, code').all();

  function plage(annee) {
    if (!/^\d{4}-\d{4}$/.test(annee ?? '') || Number(annee.slice(5)) !== Number(annee.slice(0, 4)) + 1) throw new Error('Année scolaire invalide (ex. 2026-2027).');
    return { debut: `${annee.slice(0, 4)}-09-01`, fin: `${annee.slice(5)}-08-31` };
  }

  const etiquette = (l, i) => (l?.source ? `${l.source.feuille ? `${l.source.feuille}, ` : ''}ligne ${l.source.ligne}` : `ligne ${i + 2}`);

  // ---------- rapprochement ----------
  const apprentisBase = () => db.prepare(
    `SELECT j.id, j.nom, j.prenom, j.date_naissance, j.email, j.telephone, j.adresse, j.code_postal, j.ville, j.classe_id, j.sorti_le, c.code AS classe_code, e.nom AS entreprise_nom
     FROM jeunes j JOIN classes c ON c.id = j.classe_id LEFT JOIN entreprises e ON e.id = j.entreprise_id`
  ).all();
  const entreprisesBase = () => db.prepare('SELECT * FROM entreprises').all();

  // Clé d'identité insensible à l'ordre nom/prénom, aux accents, aux tirets
  const cleIdentite = (nom, prenom) => cleTexte(`${nom ?? ''} ${prenom ?? ''}`).split(' ').filter(Boolean).sort().join(' ');
  function distance(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 99;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }

  function chercherApprenti(c, base, classeId) {
    const k = cleIdentite(c.nom, c.prenom);
    const memes = base.filter((a) => cleIdentite(a.nom, a.prenom) === k);
    const sure = memes.filter((a) => c.date_naissance && a.date_naissance === c.date_naissance);
    if (sure.length === 1) return { statut: 'existant', candidats: sure, id: sure[0].id, raison: 'même nom, prénom et date de naissance' };
    if (sure.length > 1) return { statut: 'a_confirmer', candidats: sure, id: null, raison: 'plusieurs fiches identiques' };
    // naissance absente d'un côté : rapprochement automatique seulement si la classe ou les coordonnées concordent
    const compatibles = memes.filter((a) => !a.date_naissance || !c.date_naissance);
    if (compatibles.length === 1) {
      const a = compatibles[0];
      const memeMail = c.email && a.email && c.email.toLowerCase() === a.email.toLowerCase();
      const memeTel = c.telephone && a.telephone && c.telephone.replace(/\D/g, '') === a.telephone.replace(/\D/g, '');
      const memeClasse = classeId && a.classe_id === Number(classeId);
      if (memeMail || memeTel || memeClasse) return { statut: 'existant', candidats: [a], id: a.id, raison: memeMail ? 'même nom, prénom et e-mail' : memeTel ? 'même nom, prénom et téléphone' : 'même nom, prénom et même classe' };
    }
    if (memes.length) return { statut: 'a_confirmer', candidats: memes, id: null, raison: memes.some((a) => a.date_naissance && c.date_naissance && a.date_naissance !== c.date_naissance) && !compatibles.length ? 'même nom mais date de naissance différente' : 'même nom et prénom, identité non confirmée' };
    // nom approchant (faute de frappe, nom composé tronqué) : jamais rapproché automatiquement
    const ta = k.split(' ');
    const proches = base.filter((a) => {
      const ka = cleIdentite(a.nom, a.prenom);
      if (k.length >= 8 && distance(ka, k) <= 2) return true;
      const tb = ka.split(' ');
      const [court, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]; // nom composé tronqué, faute dans un mot
      return court.length >= 3 && court.every((w) => long.some((x) => x === w || (w.length >= 6 && distance(w, x) <= 1)));
    });
    if (proches.length) return { statut: 'a_confirmer', candidats: proches.slice(0, 5), id: null, raison: 'nom très proche d\'une fiche existante (faute de frappe ?)' };
    return { statut: 'nouveau', candidats: [], id: null, raison: '' };
  }

  function chercherEntreprise(c, base) {
    if (c.ent_siret) {
      const s = base.find((e) => e.siret === c.ent_siret);
      if (s) return { statut: 'existant', candidats: [s], id: s.id, raison: 'même SIRET' };
    }
    const nom = cleNom(c.ent_nom || c.ent_nom_commercial || '');
    if (!nom) return { statut: 'aucune', candidats: [], id: null, raison: '' };
    const memes = base.filter((e) => cleNom(e.nom) === nom || (e.nom_commercial && cleNom(e.nom_commercial) === nom));
    if (!memes.length) return { statut: 'nouveau', candidats: [], id: null, raison: '' };
    const compat = memes.filter((e) => (!e.siret || !c.ent_siret) && (!e.code_postal || !c.ent_code_postal || e.code_postal === c.ent_code_postal));
    if (compat.length === 1 && memes.length === 1) return { statut: 'existant', candidats: compat, id: compat[0].id, raison: 'même raison sociale' };
    return { statut: 'a_confirmer', candidats: memes, id: null, raison: memes.length > 1 ? 'plusieurs entreprises de même nom' : (memes[0].siret && c.ent_siret ? 'même nom mais SIRET différent' : 'même nom mais adresse différente') };
  }

  const cleEnt = (c) => (c.ent_siret ? `S${c.ent_siret}` : cleNom(c.ent_nom || c.ent_nom_commercial || '') ? `N${cleNom(c.ent_nom || c.ent_nom_commercial)}|${c.ent_code_postal ?? ''}` : null);
  const resume = (a) => ({ id: a.id, nom: a.nom, prenom: a.prenom, date_naissance: a.date_naissance ?? null, classe_code: a.classe_code ?? null, entreprise_nom: a.entreprise_nom ?? null, siret: a.siret ?? null, ville: a.ville ?? null, code_postal: a.code_postal ?? null });

  // Analyse complète. arg : { lignes: [{champs, anomalies}], annee_scolaire, classes_map: {texte: classe_id}, decisions: {lignes: {i: {...}}, entreprises: {cle: {...}}} }
  function analyser(arg) {
    const an = arg.annee_scolaire;
    plage(an);
    const toutes = classes();
    const decL = arg.decisions?.lignes ?? {};
    const decE = arg.decisions?.entreprises ?? {};
    const classesMap = arg.classes_map ?? {};
    const appBase = apprentisBase();
    const entBase = entreprisesBase();
    const vuApprentis = new Map(); // doublons dans le fichier
    const groupes = new Map(); // entreprises distinctes du fichier
    const lignes = (arg.lignes ?? []).map((l, i) => {
      const c = l.champs;
      const d = decL[i] ?? {};
      const anomalies = [...(l.anomalies ?? [])];
      let exclusAuto = l.exclu_defaut ? `Exclue d'office : ${l.exclu_defaut}` : null;
      const bloquants = [];
      const manquants = [];
      if (!c.nom) bloquants.push('Nom manquant');
      if (!c.prenom) bloquants.push('Prénom manquant');
      // classe
      const texteClasse = [c.formation, c.classe, c.annee_formation].filter(Boolean).join(' ');
      let classeId = d.classe_id ?? (texteClasse ? classesMap[cleTexte(texteClasse)] ?? proposerClasse(texteClasse, toutes) : null) ?? arg.classe_defaut ?? null;
      if (classeId && !toutes.some((x) => x.id === Number(classeId))) classeId = null;
      if (!classeId) bloquants.push('Classe non reconnue : choisissez-la');
      if (c.annee_scolaire && cleTexte(c.annee_scolaire).replace(/ /g, '') !== an.replace('-', '') && !(/^\d{4}\s*[-/]\s*\d{4}$/.test(c.annee_scolaire) && c.annee_scolaire.replace(/\D/g, '') === an.replace('-', ''))) {
        anomalies.push(`Année scolaire du fichier (« ${c.annee_scolaire} ») différente de celle choisie (${an})`);
      }
      if (c.contrat_debut && c.contrat_fin && c.contrat_fin < c.contrat_debut) anomalies.push('La fin du contrat est avant son début');
      // apprenti
      let apprenti = { statut: 'nouveau', candidats: [], id: null, raison: '' };
      if (c.nom && c.prenom) {
        apprenti = chercherApprenti(c, appBase, classeId);
        const k = `${cleIdentite(c.nom, c.prenom)}|${c.date_naissance ?? ''}`;
        if (vuApprentis.has(k)) anomalies.push(`Doublon dans le fichier : même apprenti que la ligne ${etiquette(arg.lignes[vuApprentis.get(k)], vuApprentis.get(k))}`);
        else vuApprentis.set(k, i);
      }
      if (d.apprenti_id === 'nouveau') apprenti = { ...apprenti, statut: 'nouveau', id: null, choix: true };
      else if (d.apprenti_id) {
        const a = appBase.find((x) => x.id === Number(d.apprenti_id));
        if (a) apprenti = { statut: 'existant', candidats: apprenti.candidats.some((x) => x.id === a.id) ? apprenti.candidats : [...apprenti.candidats, a], id: a.id, raison: 'rattachement choisi', choix: true };
      }
      const exist = apprenti.id ? appBase.find((x) => x.id === apprenti.id) : null;
      const completions = [];
      const differences = [];
      if (exist) {
        for (const f of CH_APPRENTI) {
          if (!c[f]) continue;
          if (!exist[f]) completions.push({ champ: f, valeur: c[f] });
          else if (String(exist[f]).toLowerCase() !== String(c[f]).toLowerCase()) differences.push({ champ: f, actuel: exist[f], fichier: c[f], remplacer: (d.remplacer ?? []).includes(f) });
        }
      } else {
        for (const f of ['date_naissance', 'telephone', 'email']) if (!c[f]) manquants.push(f);
      }
      // classe : changement pour un apprenti existant
      let changementClasse = null;
      if (exist && classeId && exist.classe_id !== Number(classeId)) {
        changementClasse = { de: exist.classe_code, vers: toutes.find((x) => x.id === Number(classeId))?.code, appliquer: !!d.classe_changer };
      }
      // entreprise
      const cle = cleEnt(c);
      let entreprise = { statut: 'aucune', candidats: [], id: null, raison: '', cle: null };
      if (cle) {
        if (!groupes.has(cle)) {
          const dec = decE[cle] ?? {};
          let g = chercherEntreprise(c, entBase);
          if (dec.id === 'nouveau') g = { ...g, statut: 'nouveau', id: null, choix: true };
          else if (dec.id) { const e = entBase.find((x) => x.id === Number(dec.id)); if (e) g = { statut: 'existant', candidats: g.candidats.some((x) => x.id === e.id) ? g.candidats : [...g.candidats, e], id: e.id, raison: 'rattachement choisi', choix: true }; }
          const ex = g.id ? entBase.find((x) => x.id === g.id) : null;
          const comp = []; const diff = [];
          if (ex) for (const [src, dst] of CH_ENTREPRISE) {
            if (!c[src]) continue;
            if (!ex[dst]) comp.push({ champ: dst, valeur: c[src] });
            else if (String(ex[dst]).toLowerCase() !== String(c[src]).toLowerCase()) diff.push({ champ: dst, actuel: ex[dst], fichier: c[src], remplacer: (dec.remplacer ?? []).includes(dst) });
          }
          groupes.set(cle, { ...g, cle, nom: c.ent_nom || c.ent_nom_commercial, siret: c.ent_siret, completions: comp, differences: diff, lignes: [] });
        }
        groupes.get(cle).lignes.push(i);
        entreprise = { cle, statut: groupes.get(cle).statut };
        if (!c.ent_siret && groupes.get(cle).statut === 'nouveau') manquants.push('ent_siret');
      } else if (c.maitre_nom || c.contrat_debut || c.contrat_type) {
        anomalies.push('Informations de contrat sans entreprise : elles ne seront pas importées');
      }
      // contrat
      let contrat = { action: 'aucun' };
      if (cle) {
        if (!exist) contrat = { action: 'creer' };
        else {
          const cur = contratDe(exist.id, aujourdhui());
          const g = groupes.get(cle);
          if (!cur || !cur.entreprise_id) contrat = { action: 'creer_sur_fiche' };
          else if (g.id && cur.entreprise_id === g.id) contrat = { action: 'completer' };
          else contrat = { action: 'nouveau_contrat', appliquer: !!d.nouveau_contrat, entreprise_actuelle: db.prepare('SELECT nom FROM entreprises WHERE id = ?').get(cur.entreprise_id)?.nom ?? null };
        }
      }
      let statut = 'ok';
      const exclu = d.exclu ?? !!exclusAuto;
      if (exclu) statut = 'exclu';
      else if (bloquants.length) statut = 'bloque';
      else if (apprenti.statut === 'a_confirmer' || groupes.get(cle)?.statut === 'a_confirmer') statut = 'a_confirmer';
      else if (anomalies.length) statut = 'attention';
      return { index: i, source: l.source ?? null, etiquette: etiquette(l, i), champs: c, anomalies, bloquants, manquants, statut, classe_id: classeId ? Number(classeId) : null, classe_code: toutes.find((x) => x.id === Number(classeId))?.code ?? null,
        apprenti: { ...apprenti, candidats: apprenti.candidats.map(resume), completions, differences }, changement_classe: changementClasse, entreprise, contrat, exclu, exclu_auto: exclusAuto, texte_classe: texteClasse || null };
    });
    const entreprises = [...groupes.values()].map((g) => ({ ...g, candidats: g.candidats.map(resume) }));
    // valeurs de classe du fichier à associer
    const valeursClasse = [...new Set(lignes.map((l) => l.texte_classe).filter(Boolean))].map((t) => ({ texte: t, cle: cleTexte(t), classe_id: classesMap[cleTexte(t)] ?? proposerClasse(t, toutes) }));
    const compte = (f) => lignes.filter(f).length;
    const actives = lignes.filter((l) => !l.exclu && !l.bloquants.length);
    return {
      lignes, entreprises, valeursClasse,
      resume: {
        total: lignes.length, exclues: compte((l) => l.exclu), bloquees: compte((l) => !l.exclu && l.bloquants.length), a_confirmer: compte((l) => l.statut === 'a_confirmer'),
        apprentis_nouveaux: actives.filter((l) => !l.apprenti.id).length, apprentis_existants: actives.filter((l) => l.apprenti.id).length,
        entreprises_nouvelles: new Set(actives.filter((l) => l.entreprise.cle && groupes.get(l.entreprise.cle).statut === 'nouveau').map((l) => l.entreprise.cle)).size,
        entreprises_existantes: new Set(actives.filter((l) => l.entreprise.cle && groupes.get(l.entreprise.cle).id).map((l) => l.entreprise.cle)).size,
        contrats: actives.filter((l) => ['creer', 'creer_sur_fiche', 'completer'].includes(l.contrat.action) || (l.contrat.action === 'nouveau_contrat' && l.contrat.appliquer)).length,
        manquants: actives.filter((l) => l.manquants.length).length,
        anomalies: lignes.filter((l) => !l.exclu).reduce((n, l) => n + l.anomalies.length + l.bloquants.length, 0),
      },
    };
  }

  // ---------- application ----------
  function appliquer(arg, utilisateur, sauvegarde) {
    const an = arg.annee_scolaire;
    const { debut } = plage(an);
    const ana = analyser(arg);
    const retenues = ana.lignes.filter((l) => !l.exclu);
    const bloquees = retenues.filter((l) => l.bloquants.length);
    if (bloquees.length) throw new Error(`${bloquees.length} ligne(s) ont une anomalie bloquante (ex. ${bloquees[0].etiquette} : ${bloquees[0].bloquants[0]}). Corrigez-les ou excluez-les.`);
    const incertaines = retenues.filter((l) => l.statut === 'a_confirmer');
    if (incertaines.length) throw new Error(`${incertaines.length} correspondance(s) incertaine(s) à trancher avant de valider (ex. ${incertaines[0].etiquette}).`);
    if (!retenues.length) throw new Error("Aucune ligne à importer.");

    const op = [];
    const compteurs = { apprentis_crees: 0, apprentis_maj: 0, entreprises_creees: 0, entreprises_maj: 0, rapprochements: 0, contrats: 0 };
    const entIds = new Map();
    db.exec('BEGIN');
    try {
      const info = db.prepare('INSERT INTO imports (fichier, date_import, utilisateur, annee_scolaire, nb_lignes, sauvegarde) VALUES (?,?,?,?,?,?)')
        .run(arg.fichier ?? 'fichier', maintenant(), utilisateur ?? null, an, retenues.length, sauvegarde ?? null);
      const importId = Number(info.lastInsertRowid);
      const journal = (type, cible, avant) => db.prepare('INSERT INTO import_operations (import_id, type, cible_id, avant) VALUES (?,?,?,?)').run(importId, type, cible ?? null, avant ? JSON.stringify(avant) : null);

      // entreprises (une seule fois chacune)
      for (const g of ana.entreprises) {
        if (!g.lignes.some((i) => !ana.lignes[i].exclu)) continue;
        const premiere = arg.lignes[g.lignes.find((i) => !ana.lignes[i].exclu)].champs;
        if (g.id) {
          const avant = db.prepare('SELECT * FROM entreprises WHERE id = ?').get(g.id);
          const maj = {};
          for (const x of g.completions) maj[x.champ] = x.valeur;
          for (const x of g.differences) if (x.remplacer) maj[x.champ] = x.fichier;
          const cols = Object.keys(maj);
          if (cols.length) {
            db.prepare(`UPDATE entreprises SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => maj[c]), g.id);
            journal('entreprise_maj', g.id, avant); compteurs.entreprises_maj++;
          }
          entIds.set(g.cle, g.id);
        } else {
          const nom = premiere.ent_nom || premiere.ent_nom_commercial;
          const id = Number(db.prepare('INSERT INTO entreprises (nom, adresse, telephone, email, nom_commercial, siret, code_postal, ville) VALUES (?,?,?,?,?,?,?,?)')
            .run(nom, premiere.ent_adresse, premiere.ent_telephone, premiere.ent_email, premiere.ent_nom_commercial && premiere.ent_nom_commercial !== nom ? premiere.ent_nom_commercial : null, premiere.ent_siret, premiere.ent_code_postal, premiere.ent_ville).lastInsertRowid);
          journal('entreprise_creee', id); compteurs.entreprises_creees++;
          entIds.set(g.cle, id);
        }
      }

      for (const l of retenues) {
        const c = l.champs;
        const entId = l.entreprise.cle ? entIds.get(l.entreprise.cle) : null;
        for (const ct of entId ? c.contacts_extra ?? [] : []) {
          if (db.prepare('SELECT 1 FROM contacts WHERE entreprise_id = ? AND nom = ? COLLATE NOCASE').get(entId, ct.nom)) continue;
          const idc = Number(db.prepare('INSERT INTO contacts (entreprise_id, nom, fonction, telephone, email) VALUES (?,?,?,?,?)').run(entId, ct.nom, ct.fonction, ct.telephone, ct.email).lastInsertRowid);
          journal('contact_cree', idc);
        }
        const contratChamps = { maitre_nom: c.maitre_nom, maitre_fonction: c.maitre_fonction, maitre_telephone: c.maitre_telephone, maitre_email: c.maitre_email, contrat_type: c.contrat_type, contrat_debut: c.contrat_debut, contrat_fin: c.contrat_fin };
        let jeuneId = l.apprenti.id;
        if (!jeuneId) {
          jeuneId = Number(db.prepare(
            `INSERT INTO jeunes (nom, prenom, email, telephone, classe_id, entreprise_id, maitre_nom, maitre_telephone, maitre_email, adresse, code_postal, ville, date_naissance)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
          ).run(c.nom, c.prenom, c.email, c.telephone, l.classe_id, entId, c.maitre_nom, c.maitre_telephone, c.maitre_email, c.adresse, c.code_postal, c.ville, c.date_naissance).lastInsertRowid);
          db.prepare('INSERT INTO jeune_classes (jeune_id, classe_id, date_debut) VALUES (?,?,?)').run(jeuneId, l.classe_id, ORIGINE);
          const idp = Number(db.prepare(
            `INSERT INTO jeune_entreprises (jeune_id, entreprise_id, maitre_nom, maitre_telephone, maitre_email, maitre_fonction, date_debut, contrat_debut, contrat_fin, contrat_type, note)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`
          ).run(jeuneId, entId, c.maitre_nom, c.maitre_telephone, c.maitre_email, c.maitre_fonction, ORIGINE, c.contrat_debut, c.contrat_fin, c.contrat_type, c.contrat_info).lastInsertRowid);
          journal('apprenti_cree', jeuneId); journal('periode_contrat_creee', idp);
          compteurs.apprentis_crees++; if (entId) compteurs.contrats++;
        } else {
          const avant = db.prepare('SELECT * FROM jeunes WHERE id = ?').get(jeuneId);
          const maj = {};
          for (const x of l.apprenti.completions) maj[x.champ] = x.valeur;
          for (const x of l.apprenti.differences) if (x.remplacer) maj[x.champ] = x.fichier;
          const cols = Object.keys(maj);
          if (cols.length) { db.prepare(`UPDATE jeunes SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((k) => maj[k]), jeuneId); journal('apprenti_maj', jeuneId, avant); }
          compteurs.apprentis_maj++; compteurs.rapprochements++;
          if (l.changement_classe?.appliquer) {
            const date = dateValide(c.contrat_debut) && c.contrat_debut >= debut ? c.contrat_debut : debut;
            const deja = db.prepare('SELECT id FROM jeune_classes WHERE jeune_id = ? AND date_debut = ?').get(jeuneId, date);
            if (!deja) { const idc = Number(db.prepare("INSERT INTO jeune_classes (jeune_id, classe_id, date_debut, type, note) VALUES (?,?,?,'changement',?)").run(jeuneId, l.classe_id, date, `Import ${an}`).lastInsertRowid); journal('periode_classe_creee', idc); }
          }
          if (entId && ['creer_sur_fiche', 'completer', 'nouveau_contrat'].includes(l.contrat.action)) {
            const cur = contratDe(jeuneId, aujourdhui());
            if (l.contrat.action === 'nouveau_contrat') {
              if (l.contrat.appliquer) {
                const date = dateValide(c.contrat_debut) ? c.contrat_debut : debut;
                const deja = db.prepare('SELECT id FROM jeune_entreprises WHERE jeune_id = ? AND date_debut = ?').get(jeuneId, date);
                if (!deja) {
                  const idp = Number(db.prepare(
                    `INSERT INTO jeune_entreprises (jeune_id, entreprise_id, maitre_nom, maitre_telephone, maitre_email, maitre_fonction, date_debut, contrat_debut, contrat_fin, contrat_type, note)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
                  ).run(jeuneId, entId, c.maitre_nom, c.maitre_telephone, c.maitre_email, c.maitre_fonction, date, c.contrat_debut ?? date, c.contrat_fin, c.contrat_type, c.contrat_info).lastInsertRowid);
                  journal('periode_contrat_creee', idp); compteurs.contrats++;
                }
              }
            } else if (cur) {
              const avantP = { ...cur };
              const maj2 = {};
              if (l.contrat.action === 'creer_sur_fiche') maj2.entreprise_id = entId;
              for (const [k, v] of Object.entries(contratChamps)) if (v && !cur[k]) maj2[k] = v;
              const cols2 = Object.keys(maj2);
              if (cols2.length) { db.prepare(`UPDATE jeune_entreprises SET ${cols2.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...cols2.map((k) => maj2[k]), cur.id); journal('periode_contrat_maj', cur.id, avantP); compteurs.contrats++; }
            }
          }
        }
      }
      synchroniser();
      const nbAnomalies = ana.resume.anomalies;
      const rapport = ana.lignes.filter((l) => l.anomalies.length || l.manquants.length || l.bloquants.length).map((l) => ({ ligne: l.etiquette, nom: `${l.champs.nom ?? ''} ${l.champs.prenom ?? ''}`.trim(), anomalies: [...l.bloquants, ...l.anomalies], manquants: l.manquants, exclue: l.exclu }));
      db.prepare('UPDATE imports SET nb_apprentis_crees=?, nb_apprentis_maj=?, nb_entreprises_creees=?, nb_entreprises_maj=?, nb_rapprochements=?, nb_anomalies=?, rapport=? WHERE id=?')
        .run(compteurs.apprentis_crees, compteurs.apprentis_maj, compteurs.entreprises_creees, compteurs.entreprises_maj, compteurs.rapprochements, nbAnomalies, JSON.stringify(rapport), importId);
      db.exec('COMMIT');
      return { import_id: importId, ...compteurs, anomalies: nbAnomalies };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  // ---------- annulation : ne supprime que ce que l'import a créé et qui n'a pas été utilisé depuis ----------
  function annuler(id) {
    const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(Number(id));
    if (!imp) throw new Error('Import introuvable.');
    if (imp.statut === 'annule') throw new Error('Cet import est déjà annulé.');
    const ops = db.prepare('SELECT * FROM import_operations WHERE import_id = ? ORDER BY id DESC').all(imp.id);
    const gardes = [];
    let defaits = 0;
    db.exec('BEGIN');
    try {
      for (const o of ops) {
        const avant = o.avant ? JSON.parse(o.avant) : null;
        if (o.type === 'apprenti_cree') {
          const utilise = db.prepare('SELECT (SELECT COUNT(*) FROM evenements WHERE jeune_id = ?) + (SELECT COUNT(*) FROM sanctions WHERE jeune_id = ?) AS n').get(o.cible_id, o.cible_id).n;
          const j = db.prepare('SELECT nom, prenom FROM jeunes WHERE id = ?').get(o.cible_id);
          if (!j) continue;
          if (utilise) gardes.push(`${j.prenom} ${j.nom} : des absences ou sanctions existent déjà, fiche conservée`);
          else { db.prepare('DELETE FROM jeunes WHERE id = ?').run(o.cible_id); defaits++; }
        } else if (o.type === 'entreprise_creee') {
          const e = db.prepare('SELECT nom FROM entreprises WHERE id = ?').get(o.cible_id);
          if (!e) continue;
          const utilise = db.prepare('SELECT COUNT(*) AS n FROM jeune_entreprises WHERE entreprise_id = ?').get(o.cible_id).n;
          if (utilise) gardes.push(`${e.nom} : encore rattachée à un apprenti, fiche conservée`);
          else { db.prepare('DELETE FROM entreprises WHERE id = ?').run(o.cible_id); defaits++; }
        } else if (o.type === 'contact_cree') { db.prepare('DELETE FROM contacts WHERE id = ?').run(o.cible_id); defaits++; }
        else if (o.type === 'periode_contrat_creee') { db.prepare('DELETE FROM jeune_entreprises WHERE id = ?').run(o.cible_id); defaits++; }
        else if (o.type === 'periode_classe_creee') { db.prepare('DELETE FROM jeune_classes WHERE id = ?').run(o.cible_id); defaits++; }
        else if (['apprenti_maj', 'entreprise_maj', 'periode_contrat_maj'].includes(o.type) && avant) {
          const table = { apprenti_maj: 'jeunes', entreprise_maj: 'entreprises', periode_contrat_maj: 'jeune_entreprises' }[o.type];
          const cols = Object.keys(avant).filter((k) => k !== 'id');
          db.prepare(`UPDATE ${table} SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((k) => avant[k] ?? null), o.cible_id);
          defaits++;
        }
      }
      synchroniser();
      db.prepare("UPDATE imports SET statut = 'annule', annule_le = ?, annule_rapport = ? WHERE id = ?").run(maintenant(), JSON.stringify(gardes), imp.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { defaits, conserves: gardes };
  }

  return {
    'import:classes': () => classes(),
    'import:analyser': (arg) => analyser(arg),
    'import:appliquer': ({ arg, utilisateur, sauvegarde }) => appliquer(arg, utilisateur, sauvegarde),
    'import:historique': () => db.prepare('SELECT id, fichier, date_import, utilisateur, annee_scolaire, statut, nb_lignes, nb_apprentis_crees, nb_apprentis_maj, nb_entreprises_creees, nb_entreprises_maj, nb_rapprochements, nb_anomalies, annule_le, annule_rapport FROM imports ORDER BY id DESC').all(),
    'import:rapport': (id) => {
      const r = db.prepare('SELECT fichier, date_import, rapport FROM imports WHERE id = ?').get(Number(id));
      if (!r) throw new Error('Import introuvable.');
      return { fichier: r.fichier, date_import: r.date_import, lignes: JSON.parse(r.rapport ?? '[]') };
    },
    'import:annuler': (id) => annuler(id),
  };
}

module.exports = { creerImportDonnees, proposerClasse, cleNom };
