// Bibliothèque de mails types : modèles par catégorie, variables dynamiques, historique des communications par apprenti.
const CATEGORIES = [
  'Sanctions et avertissements', 'Retards', 'Absences', 'Convocations', 'Commissions pédagogiques', 'Commissions disciplinaires',
  'Communication avec les employeurs', 'Suivi pédagogique', 'Informations administratives',
];
const VARIABLES = [
  ['NOM_APPRENTI', "Nom de l'apprenti"], ['PRENOM_APPRENTI', "Prénom de l'apprenti"], ['CLASSE', 'Classe'], ['NOM_EMPLOYEUR', "Entreprise"], ['NOM_MAITRE', "Maître d'apprentissage"],
  ['NOM_ETABLISSEMENT', "Établissement"], ['SIGNATURE', 'Service et coordonnées'], ['DATE_DU_JOUR', "Date du jour"],
  ['DATE_COMMISSION', 'Date de la commission'], ['HEURE_COMMISSION', 'Heure de la commission'], ['TYPE_COMMISSION', 'Type de commission'], ['MOTIF_COMMISSION', 'Motif de la commission'],
  ['MOTIF_SANCTION', 'Motif de la sanction'], ['SANCTION', 'Sanction retenue'], ['DATE_SANCTION', 'Date de la décision'],
  ['DATE_ABSENCE', "Date de l'absence ou du retard"],
];
const MODELES_DEFAUT = [
  ['Notification de sanction', 'Sanctions et avertissements', 'Information concernant {PRENOM_APPRENTI} {NOM_APPRENTI} – {SANCTION}',
    "Madame, Monsieur,\n\nNous vous informons que {PRENOM_APPRENTI} {NOM_APPRENTI} ({CLASSE}) a fait l'objet de la mesure suivante : {SANCTION}, prononcée le {DATE_SANCTION}.\n\nMotif : {MOTIF_SANCTION}.\n\nCette décision est prise conformément au règlement intérieur de l'établissement.\n\nCordialement,\n{SIGNATURE}"],
  ['Rappel à l\'ordre', 'Sanctions et avertissements', "Rappel à l'ordre – {PRENOM_APPRENTI} {NOM_APPRENTI}",
    "Madame, Monsieur,\n\nNous vous informons que {PRENOM_APPRENTI} {NOM_APPRENTI} ({CLASSE}) a fait l'objet d'un rappel à l'ordre pour le motif suivant : {MOTIF_SANCTION}.\n\nCordialement,\n{SIGNATURE}"],
  ['Retards répétés', 'Retards', 'Retards répétés – {PRENOM_APPRENTI} {NOM_APPRENTI}',
    "Madame, Monsieur,\n\nNous constatons des retards répétés de {PRENOM_APPRENTI} {NOM_APPRENTI} ({CLASSE}), dont le dernier le {DATE_ABSENCE}.\n\nNous vous remercions de bien vouloir nous faire part de votre analyse de la situation.\n\nCordialement,\n{SIGNATURE}"],
  ['Absence non justifiée', 'Absences', 'Absence de {PRENOM_APPRENTI} {NOM_APPRENTI} – {DATE_ABSENCE}',
    "Madame, Monsieur,\n\n{PRENOM_APPRENTI} {NOM_APPRENTI} ({CLASSE}) était absent(e) le {DATE_ABSENCE} sans justificatif recevable à ce jour.\n\nMerci de nous transmettre un justificatif dans les meilleurs délais.\n\nCordialement,\n{SIGNATURE}"],
  ['Convocation à une commission', 'Convocations', 'Convocation à une commission {TYPE_COMMISSION} – {DATE_COMMISSION}',
    "Bonjour,\n\nVous êtes convoqué(e) à une commission {TYPE_COMMISSION} le {DATE_COMMISSION} à {HEURE_COMMISSION}.\nMotif : {MOTIF_COMMISSION}.\n\nVous trouverez la convocation en pièce jointe. Merci de nous en accuser réception.\n\nCordialement,\n{SIGNATURE}"],
  ['Commission pédagogique – information', 'Commissions pédagogiques', 'Commission pédagogique – {NOM_APPRENTI} {PRENOM_APPRENTI} – {DATE_COMMISSION}',
    "Bonjour,\n\nUne commission pédagogique concernant {PRENOM_APPRENTI} {NOM_APPRENTI} ({CLASSE}) se tiendra le {DATE_COMMISSION} à {HEURE_COMMISSION}.\nMotif : {MOTIF_COMMISSION}.\n\nMerci de confirmer votre présence.\n\nCordialement,\n{SIGNATURE}"],
  ['Commission disciplinaire – information', 'Commissions disciplinaires', 'Commission disciplinaire – {NOM_APPRENTI} {PRENOM_APPRENTI} – {DATE_COMMISSION}',
    "Bonjour,\n\nUne commission disciplinaire concernant {PRENOM_APPRENTI} {NOM_APPRENTI} ({CLASSE}) se tiendra le {DATE_COMMISSION} à {HEURE_COMMISSION}.\nMotif : {MOTIF_COMMISSION}.\n\nMerci de confirmer votre présence.\n\nCordialement,\n{SIGNATURE}"],
  ['Information à l\'employeur', 'Communication avec les employeurs', 'Information concernant {PRENOM_APPRENTI} {NOM_APPRENTI}',
    "Bonjour,\n\nNous souhaitons vous informer d'un point concernant {PRENOM_APPRENTI} {NOM_APPRENTI} ({NOM_EMPLOYEUR}).\n\n[à compléter]\n\nNous restons à votre disposition.\n\nCordialement,\n{SIGNATURE}"],
  ['Point de suivi pédagogique', 'Suivi pédagogique', 'Suivi pédagogique – {PRENOM_APPRENTI} {NOM_APPRENTI}',
    "Bonjour,\n\nNous faisons un point sur la situation de {PRENOM_APPRENTI} {NOM_APPRENTI} ({CLASSE}).\n\n[à compléter]\n\nCordialement,\n{SIGNATURE}"],
  ['Information administrative', 'Informations administratives', 'Information – {PRENOM_APPRENTI} {NOM_APPRENTI}',
    "Bonjour,\n\n[à compléter]\n\nCordialement,\n{SIGNATURE}"],
];

const maintenant = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const jma = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const EMAIL = /^[^\s@;,<>"]+@[^\s@;,<>"]+\.[^\s@;,<>"]+$/;

function creerMails(db, h) {
  const { vide, aujourdhui, etablissement } = h;

  if (db.prepare('SELECT COUNT(*) AS n FROM modeles_mail').get().n === 0) {
    const st = db.prepare('INSERT INTO modeles_mail (nom, categorie, objet, contenu, cree_le) VALUES (?,?,?,?,?)');
    for (const m of MODELES_DEFAUT) st.run(...m, maintenant());
  }

  // Valeurs des variables d'après les fiches (apprenti, sanction, commission, absence). Une variable sans donnée reste visible { … }.
  function valeurs(ctx) {
    const j = db.prepare(
      `SELECT j.nom, j.prenom, cl.code AS classe, e.nom AS employeur, j.maitre_nom FROM jeunes j JOIN classes cl ON cl.id = j.classe_id LEFT JOIN entreprises e ON e.id = j.entreprise_id WHERE j.id = ?`
    ).get(Number(ctx.jeune_id));
    if (!j) throw new Error('Apprenti introuvable.');
    const etab = etablissement();
    const v = {
      NOM_APPRENTI: j.nom.toUpperCase(), PRENOM_APPRENTI: j.prenom, CLASSE: j.classe, NOM_EMPLOYEUR: j.employeur, NOM_MAITRE: j.maitre_nom,
      NOM_ETABLISSEMENT: etab.nom, SIGNATURE: [etab.nom, etab.service, etab.coordonnees].filter(Boolean).join('\n'), DATE_DU_JOUR: jma(aujourdhui()),
    };
    if (ctx.sanction_id) {
      const s = db.prepare(
        `SELECT s.date_decision, s.date_faits, s.decision, m.intitule, pr.libelle AS palier FROM sanctions s JOIN motifs_sanction m ON m.id = s.motif_id LEFT JOIN paliers pr ON pr.id = s.palier_retenu_id WHERE s.id = ?`
      ).get(Number(ctx.sanction_id));
      if (s) Object.assign(v, { MOTIF_SANCTION: s.intitule, SANCTION: s.decision === 'rappel' ? "rappel à l'ordre" : s.palier, DATE_SANCTION: jma(s.date_decision ?? s.date_faits) });
    }
    if (ctx.commission_id) {
      const c = db.prepare('SELECT type, date, heure_debut, motif FROM commissions WHERE id = ?').get(Number(ctx.commission_id));
      if (c) Object.assign(v, { TYPE_COMMISSION: c.type === 'disciplinaire' ? 'disciplinaire' : 'pédagogique', DATE_COMMISSION: jma(c.date), HEURE_COMMISSION: (c.heure_debut ?? '').replace(':', 'h'), MOTIF_COMMISSION: c.motif });
    }
    const evt = ctx.evenement_id
      ? db.prepare('SELECT MIN(c.date) AS d FROM creneaux c WHERE c.evenement_id = ?').get(Number(ctx.evenement_id))
      : db.prepare('SELECT MAX(c.date) AS d FROM creneaux c JOIN evenements e ON e.id = c.evenement_id WHERE e.jeune_id = ?').get(Number(ctx.jeune_id));
    if (evt?.d) v.DATE_ABSENCE = jma(evt.d);
    return v;
  }
  function remplacer(texte, v, manquantes) {
    return String(texte).replace(/\{([A-Z_]+)\}/g, (m, k) => {
      if (!VARIABLES.some(([n]) => n === k)) return m;
      if (v[k] === undefined || v[k] === null || v[k] === '') { manquantes.add(k); return m; }
      return v[k];
    });
  }

  const lireModele = (id) => {
    const m = db.prepare('SELECT * FROM modeles_mail WHERE id = ?').get(Number(id));
    if (!m) throw new Error('Modèle introuvable.');
    return m;
  };

  return {
    'mails:categories': () => CATEGORIES,
    'mails:variables': () => VARIABLES.map(([nom, libelle]) => ({ nom, libelle })),
    'mails:modeles': (f = {}) => {
      const w = [];
      const p = [];
      if (f.actifs) w.push('actif = 1');
      if (f.categorie) { w.push('categorie = ?'); p.push(f.categorie); }
      return db.prepare(`SELECT * FROM modeles_mail ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY actif DESC, categorie, nom COLLATE NOCASE`).all(...p);
    },
    'mails:modele:save': (m) => {
      const nom = vide(m.nom);
      const objet = vide(m.objet);
      const contenu = vide(m.contenu);
      if (!nom) throw new Error('Le nom interne est obligatoire.');
      if (!CATEGORIES.includes(m.categorie)) throw new Error('Catégorie invalide.');
      if (!objet) throw new Error("L'objet est obligatoire.");
      if (!contenu) throw new Error('Le contenu est obligatoire.');
      const dest = vide(m.destinataires);
      if (dest) {
        const mauvais = dest.split(/[;,]/).map((x) => x.trim()).filter(Boolean).filter((x) => !EMAIL.test(x));
        if (mauvais.length) throw new Error(`Adresse(s) invalide(s) : ${mauvais.join(', ')}`);
      }
      const inconnues = [...`${objet} ${contenu}`.matchAll(/\{([A-Z_]+)\}/g)].map((x) => x[1]).filter((k) => !VARIABLES.some(([n]) => n === k));
      if (inconnues.length) throw new Error(`Variable(s) inconnue(s) : ${[...new Set(inconnues)].map((k) => `{${k}}`).join(', ')}`);
      const actif = m.actif === 0 || m.actif === false ? 0 : 1;
      if (m.id) {
        lireModele(m.id);
        db.prepare('UPDATE modeles_mail SET nom=?, categorie=?, objet=?, contenu=?, destinataires=?, actif=?, modifie_le=? WHERE id=?').run(nom, m.categorie, objet, contenu, dest, actif, maintenant(), Number(m.id));
        return Number(m.id);
      }
      return Number(db.prepare('INSERT INTO modeles_mail (nom, categorie, objet, contenu, destinataires, actif, cree_le) VALUES (?,?,?,?,?,?,?)').run(nom, m.categorie, objet, contenu, dest, actif, maintenant()).lastInsertRowid);
    },
    // Remplace les variables d'un modèle (ou d'un texte libre) pour un apprenti ; renvoie aussi les variables sans donnée.
    'mails:rendre': (c) => {
      const m = c.modele_id ? lireModele(c.modele_id) : { objet: c.objet ?? '', contenu: c.contenu ?? '', destinataires: null, nom: null };
      const v = valeurs(c);
      const manquantes = new Set();
      return { objet: remplacer(m.objet, v, manquantes), corps: remplacer(m.contenu, v, manquantes), destinataires: m.destinataires, modele_nom: m.nom, categorie: m.categorie ?? null, manquantes: [...manquantes] };
    },
    // Historique unique des communications préparées pour un apprenti.
    'mails:archiver': (m) => {
      if (!db.prepare('SELECT 1 FROM jeunes WHERE id = ?').get(Number(m.jeune_id))) throw new Error('Apprenti introuvable.');
      const a = Array.isArray(m.a) ? m.a : [];
      const cc = Array.isArray(m.cc) ? m.cc : [];
      const cci = Array.isArray(m.cci) ? m.cci : [];
      if (![...a, ...cc, ...cci].length) throw new Error('Aucun destinataire.');
      const dest = [a.length ? `À : ${a.join(', ')}` : '', cc.length ? `Cc : ${cc.join(', ')}` : '', cci.length ? `Cci : ${cci.join(', ')}` : ''].filter(Boolean).join(' | ');
      db.prepare('INSERT INTO historique_mails (jeune_id, quand, source, destinataires, objet, contenu, pieces, modele_nom, methode, statut) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(Number(m.jeune_id), maintenant(), String(m.source ?? 'Bibliothèque de mails'), dest, String(m.objet ?? ''), String(m.corps ?? ''), vide(m.pieces), vide(m.modele_nom),
          m.methode === 'outlook' ? 'Outlook' : 'Messagerie par défaut', 'Brouillon ouvert (envoi à valider par vous)');
      return true;
    },
    'mails:historique': (jeuneId) => db.prepare('SELECT * FROM historique_mails WHERE jeune_id = ? ORDER BY id DESC').all(Number(jeuneId)),
  };
}

module.exports = { creerMails, CATEGORIES, VARIABLES };
