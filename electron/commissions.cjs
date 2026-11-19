// Commissions pédagogiques et disciplinaires : programmation, participants, convocations Word, comptes rendus.
// Règle : aucune décision n'est prise par l'application ; elle trace ce que la personne saisit.
const fs = require('node:fs');
const path = require('node:path');
const { remplirConvocation, classeTexte } = require('./convocation.cjs');

const TYPES = ['pedagogique', 'disciplinaire'];
const STATUTS = ['a_programmer', 'programmee', 'convocations_envoyees', 'realisee', 'reportee', 'annulee'];
const NOMS_STATUTS = { a_programmer: 'À programmer', programmee: 'Programmée', convocations_envoyees: 'Convocations envoyées', realisee: 'Réalisée', reportee: 'Reportée', annulee: 'Annulée' };
const NOMS_TYPES = { pedagogique: 'pédagogique', disciplinaire: 'disciplinaire' };
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@;,<>"]+@[^\s@;,<>"]+\.[^\s@;,<>"]+$/;
const RAPPEL_JOURS_DEFAUT = 2;
const jma = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const maintenant = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const ajouterJours = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const nettoyer = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function creerCommissions(db, h) {
  const { vide, dateValide, classeDe, destinatairesDe, aujourdhui, etablissement } = h;
  const dossierModeles = h.dossierModeles ?? path.join(__dirname, 'modeles');

  const journaliser = (id, action, detail) =>
    db.prepare('INSERT INTO commission_journal (commission_id, quand, action, detail) VALUES (?,?,?,?)').run(id, maintenant(), action, detail ?? null);

  const lireReglage = (cle, defaut) => db.prepare('SELECT valeur FROM reglages WHERE cle = ?').get(cle)?.valeur ?? defaut;
  const joursRappel = () => {
    const n = Number(lireReglage('commission_rappel_jours', RAPPEL_JOURS_DEFAUT));
    return Number.isInteger(n) && n >= 0 && n <= 30 ? n : RAPPEL_JOURS_DEFAUT;
  };

  const SELECT = `
    SELECT c.*, j.nom AS jeune_nom, j.prenom AS jeune_prenom, j.civilite AS jeune_civilite,
           (SELECT COUNT(*) FROM commission_participants x WHERE x.commission_id = c.id) AS nb_participants,
           (SELECT COUNT(*) FROM commission_communications x WHERE x.commission_id = c.id AND x.nature = 'convocation') AS nb_convocations,
           (SELECT COUNT(*) FROM commission_pieces x WHERE x.commission_id = c.id) AS nb_pieces
    FROM commissions c JOIN jeunes j ON j.id = c.jeune_id`;

  const codeClasse = (jeuneId, date) => db.prepare('SELECT code FROM classes WHERE id = ?').get(classeDe(jeuneId, date ?? aujourdhui()) ?? 0)?.code ?? null;

  const lire = (id) => {
    const c = db.prepare(`${SELECT} WHERE c.id = ?`).get(Number(id));
    if (!c) throw new Error('Commission introuvable.');
    return c;
  };

  function verifier(c) {
    if (!TYPES.includes(c.type)) throw new Error('Type de commission invalide.');
    const motif = vide(c.motif);
    if (!motif) throw new Error('Le motif est obligatoire.');
    const date = vide(c.date);
    if (date && !dateValide(date)) throw new Error('Date invalide.');
    const hd = vide(c.heure_debut);
    const hf = vide(c.heure_fin);
    if (hd && !HEURE.test(hd)) throw new Error('Heure de début invalide.');
    if (hf && !HEURE.test(hf)) throw new Error('Heure de fin invalide.');
    if (hd && hf && hf <= hd) throw new Error("L'heure de fin doit suivre l'heure de début.");
    return { motif, date, hd, hf };
  }

  // Participants : copie (nom, fonction, e-mail) de l'intervenant au moment de la saisie, pour garder la trace.
  function poserParticipants(id, ids) {
    db.prepare('DELETE FROM commission_participants WHERE commission_id = ?').run(id);
    for (const iid of [...new Set((ids ?? []).map(Number))]) {
      const i = db.prepare('SELECT * FROM intervenants WHERE id = ?').get(iid);
      if (i) db.prepare('INSERT INTO commission_participants (commission_id, intervenant_id, nom, fonction, email) VALUES (?,?,?,?,?)').run(id, i.id, i.nom, i.fonction, i.email);
    }
  }

  const actions = {
    'commissions:list': (f = {}) => {
      const w = [];
      const p = [];
      if (f.statut) { w.push('c.statut = ?'); p.push(f.statut); }
      if (f.type) { w.push('c.type = ?'); p.push(f.type); }
      if (f.jeune_id) { w.push('c.jeune_id = ?'); p.push(Number(f.jeune_id)); }
      if (f.debut) { w.push('c.date >= ?'); p.push(f.debut); }
      if (f.fin) { w.push('c.date <= ?'); p.push(f.fin); }
      return db.prepare(`${SELECT} ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY (c.date IS NULL) DESC, c.date DESC, c.heure_debut DESC, c.id DESC`).all(...p)
        .map((c) => ({ ...c, classe_code: codeClasse(c.jeune_id, c.date) }));
    },

    'commissions:get': (id) => {
      const c = lire(id);
      return {
        ...c,
        classe_code: codeClasse(c.jeune_id, c.date),
        participants: db.prepare('SELECT * FROM commission_participants WHERE commission_id = ? ORDER BY id').all(c.id),
        pieces: db.prepare('SELECT id, nom_fichier, taille, genere, ajoute_le FROM commission_pieces WHERE commission_id = ? ORDER BY id DESC').all(c.id),
        communications: db.prepare('SELECT * FROM commission_communications WHERE commission_id = ? ORDER BY id DESC').all(c.id),
        journal: db.prepare('SELECT * FROM commission_journal WHERE commission_id = ? ORDER BY id DESC').all(c.id),
      };
    },

    'commissions:save': (c) => {
      const { motif, date, hd, hf } = verifier(c);
      const jeune = db.prepare('SELECT id FROM jeunes WHERE id = ?').get(Number(c.jeune_id));
      if (!jeune) throw new Error('Apprenti introuvable.');
      const sanctionId = c.sanction_id ? Number(c.sanction_id) : null;
      if (sanctionId && !db.prepare('SELECT 1 FROM sanctions WHERE id = ?').get(sanctionId)) throw new Error('Sanction liée introuvable.');
      const champs = [c.type, date, hd, hf, vide(c.lieu), motif, vide(c.commentaire), vide(c.compte_rendu), vide(c.decision), vide(c.suites)];
      if (c.id) {
        const avant = lire(c.id);
        if (avant.type !== c.type && avant.nb_convocations > 0) throw new Error('Le type ne peut plus changer : une convocation a déjà été préparée.');
        db.prepare('UPDATE commissions SET type=?, date=?, heure_debut=?, heure_fin=?, lieu=?, motif=?, commentaire=?, compte_rendu=?, decision=?, suites=?, modifie_le=? WHERE id=?')
          .run(...champs, maintenant(), avant.id);
        const diffs = [];
        if (avant.date !== date || avant.heure_debut !== hd) diffs.push(`date/heure : ${jma(avant.date)} ${avant.heure_debut ?? ''} → ${jma(date)} ${hd ?? ''}`);
        if (avant.motif !== motif) diffs.push('motif modifié');
        if ((avant.compte_rendu ?? null) !== vide(c.compte_rendu)) diffs.push('compte rendu modifié');
        if ((avant.decision ?? null) !== vide(c.decision)) diffs.push('décision consignée modifiée');
        if (diffs.length) journaliser(avant.id, 'Modification', diffs.join(' ; '));
        if (Array.isArray(c.participants)) poserParticipants(avant.id, c.participants);
        return avant.id;
      }
      const statut = date && hd ? 'programmee' : 'a_programmer';
      const id = Number(db.prepare(
        'INSERT INTO commissions (jeune_id, type, date, heure_debut, heure_fin, lieu, motif, commentaire, compte_rendu, decision, suites, statut, sanction_id, cree_le) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).run(Number(c.jeune_id), ...champs, statut, sanctionId, maintenant()).lastInsertRowid);
      journaliser(id, 'Création', `Commission ${NOMS_TYPES[c.type]} — ${NOMS_STATUTS[statut]}`);
      if (Array.isArray(c.participants)) poserParticipants(id, c.participants);
      return id;
    },

    'commissions:statut': ({ id, statut, raison }) => {
      if (!STATUTS.includes(statut)) throw new Error('Statut invalide.');
      const c = lire(id);
      if (c.statut === statut) return true;
      if (['programmee', 'convocations_envoyees', 'realisee'].includes(statut) && !(c.date && c.heure_debut)) throw new Error("Renseignez d'abord la date et l'heure.");
      db.prepare('UPDATE commissions SET statut = ?, modifie_le = ? WHERE id = ?').run(statut, maintenant(), c.id);
      journaliser(c.id, 'Statut', `${NOMS_STATUTS[c.statut]} → ${NOMS_STATUTS[statut]}${vide(raison) ? ` (${vide(raison)})` : ''}`);
      return true;
    },

    // Report : la nouvelle date remplace l'ancienne (conservée dans le journal) ; les convocations sont à renvoyer.
    'commissions:reporter': ({ id, date, heure_debut, heure_fin, raison }) => {
      const c = lire(id);
      if (!dateValide(date)) throw new Error('Nouvelle date invalide.');
      if (!HEURE.test(heure_debut ?? '')) throw new Error('Nouvelle heure invalide.');
      if (heure_fin && (!HEURE.test(heure_fin) || heure_fin <= heure_debut)) throw new Error('Heure de fin invalide.');
      db.prepare("UPDATE commissions SET date = ?, heure_debut = ?, heure_fin = ?, statut = 'programmee', modifie_le = ? WHERE id = ?")
        .run(date, heure_debut, vide(heure_fin), maintenant(), c.id);
      journaliser(c.id, 'Report', `${jma(c.date)} ${c.heure_debut ?? ''} → ${jma(date)} ${heure_debut}${vide(raison) ? ` (${vide(raison)})` : ''} — convocations à renvoyer`);
      return true;
    },

    'commissions:supprimer': (id) => {
      const c = lire(id);
      if (c.nb_convocations || c.nb_pieces || c.compte_rendu || c.decision) throw new Error('Cette commission a déjà un historique : annulez-la plutôt que la supprimer.');
      db.prepare('DELETE FROM commissions WHERE id = ?').run(c.id);
      return true;
    },

    // Destinataires de la convocation : l'apprenti est géré par l'appelant (il n'a pas d'adresse enregistrée dans l'application) ;
    // maître d'apprentissage et représentant légal (mineur) en copie ; professeur principal proposé.
    'commissions:destinataires': (id) => {
      const c = lire(id);
      const date = c.date ?? aujourdhui();
      const liste = destinatairesDe(c.jeune_id, date);
      const j = db.prepare('SELECT date_naissance, representant_nom, representant_email FROM jeunes WHERE id = ?').get(c.jeune_id);
      let mineur = false;
      if (j.date_naissance) {
        const dix8 = new Date(`${j.date_naissance}T00:00:00Z`);
        dix8.setUTCFullYear(dix8.getUTCFullYear() + 18);
        mineur = dix8.toISOString().slice(0, 10) > date;
      }
      if (mineur && j.representant_email) liste.push({ cle: 'representant', role: 'representant', libelle: `Représentant légal${j.representant_nom ? ` : ${j.representant_nom}` : ''}`, email: j.representant_email });
      const participants = db.prepare('SELECT nom, fonction, email FROM commission_participants WHERE commission_id = ? ORDER BY id').all(c.id);
      return { destinataires: liste, participants, mineur, representant_manquant: mineur && !j.representant_email };
    },

    // Génère la convocation Word depuis le modèle de l'établissement et l'archive dans le dossier de la commission.
    'commissions:convocation:generer': (id) => {
      const c = lire(id);
      if (!c.date || !c.heure_debut) throw new Error("Renseignez d'abord la date et l'heure de la commission.");
      const j = db.prepare('SELECT j.civilite, j.nom, j.prenom, j.adresse, j.code_postal, j.ville FROM jeunes j WHERE j.id = ?').get(c.jeune_id);
      const cl = db.prepare('SELECT cl.code, cl.libelle FROM classes cl WHERE cl.id = ?').get(classeDe(c.jeune_id, c.date) ?? 0);
      const modele = fs.readFileSync(path.join(dossierModeles, `convocation-${c.type}.docx`));
      const buf = remplirConvocation(modele, {
        civilite: j.civilite ?? '', nom: j.nom, prenom: j.prenom, adresse: j.adresse ?? '', code_postal: j.code_postal ?? '', ville: j.ville ?? '',
        classe_texte: cl ? classeTexte(cl.code, cl.libelle) : '', type: c.type, date: c.date, heure_debut: c.heure_debut, motif: c.motif,
      });
      const nom = `Convocation_commission_${c.type}_${nettoyer(j.nom)}_${nettoyer(j.prenom)}_${c.date}.docx`;
      const piece = Number(db.prepare('INSERT INTO commission_pieces (commission_id, nom_fichier, taille, contenu, genere, ajoute_le) VALUES (?,?,?,?,1,?)').run(c.id, nom, buf.length, buf, maintenant()).lastInsertRowid);
      journaliser(c.id, 'Convocation', `Document Word généré : ${nom}`);
      return { piece_id: piece, nom_fichier: nom, manque_adresse: !j.adresse, manque_civilite: !j.civilite, etablissement: etablissement?.() };
    },

    'commissions:piece:contenu': (pid) => {
      const r = db.prepare('SELECT nom_fichier, contenu FROM commission_pieces WHERE id = ?').get(Number(pid));
      if (!r) throw new Error('Pièce introuvable.');
      return { nom_fichier: r.nom_fichier, contenu: Buffer.from(r.contenu) };
    },

    'commissions:piece:ajouter': ({ commission_id, nom, contenu, genere }) => {
      const c = lire(commission_id);
      const nom_fichier = String(nom);
      const buf = Buffer.from(contenu);
      if (!buf.length) throw new Error('Fichier vide.');
      if (h.tailleMax && buf.length > h.tailleMax) throw new Error('Fichier trop volumineux (10 Mo maximum).');
      const id = Number(db.prepare('INSERT INTO commission_pieces (commission_id, nom_fichier, taille, contenu, genere, ajoute_le) VALUES (?,?,?,?,?,?)').run(c.id, nom_fichier, buf.length, buf, genere ? 1 : 0, maintenant()).lastInsertRowid);
      journaliser(c.id, 'Pièce', `Ajout : ${nom_fichier}`);
      return id;
    },

    // Reprend dans le dossier la version modifiée dans Word.
    'commissions:piece:remplacer': ({ id, contenu }) => {
      const r = db.prepare('SELECT commission_id, nom_fichier FROM commission_pieces WHERE id = ?').get(Number(id));
      if (!r) throw new Error('Pièce introuvable.');
      const buf = Buffer.from(contenu);
      if (!buf.length || buf.subarray(0, 2).toString() !== 'PK') throw new Error("Le fichier Word enregistré n'est pas valide.");
      db.prepare('UPDATE commission_pieces SET contenu = ?, taille = ?, ajoute_le = ? WHERE id = ?').run(buf, buf.length, maintenant(), Number(id));
      journaliser(r.commission_id, 'Convocation', `Version modifiée enregistrée : ${r.nom_fichier}`);
      return true;
    },

    'commissions:piece:supprimer': (pid) => {
      const r = db.prepare('SELECT commission_id, nom_fichier FROM commission_pieces WHERE id = ?').get(Number(pid));
      if (!r) return true;
      db.prepare('DELETE FROM commission_pieces WHERE id = ?').run(Number(pid));
      journaliser(r.commission_id, 'Pièce', `Suppression : ${r.nom_fichier}`);
      return true;
    },

    // Archive une préparation de mail (convocation, information des participants ou rappel). L'envoi reste manuel.
    'commissions:communication:archiver': (m) => {
      const c = lire(m.commission_id);
      const nature = ['convocation', 'participants', 'rappel'].includes(m.nature) ? m.nature : 'convocation';
      const a = Array.isArray(m.a) ? m.a : [];
      const cc = Array.isArray(m.cc) ? m.cc : [];
      const cci = Array.isArray(m.cci) ? m.cci : [];
      if (![...a, ...cc, ...cci].length) throw new Error('Aucun destinataire.');
      const dest = [a.length ? `À : ${a.join(', ')}` : '', cc.length ? `Cc : ${cc.join(', ')}` : '', cci.length ? `Cci : ${cci.join(', ')}` : ''].filter(Boolean).join(' | ');
      const methode = m.methode === 'outlook' ? 'Outlook' : 'Messagerie par défaut';
      const statut = 'Brouillon ouvert (envoi à valider par vous)';
      db.prepare('INSERT INTO commission_communications (commission_id, quand, nature, destinataires, objet, contenu, methode, statut, pieces) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(c.id, maintenant(), nature, dest, String(m.objet ?? ''), String(m.corps ?? ''), methode, statut, vide(m.pieces));
      journaliser(c.id, 'Communication', `Mail préparé (${nature}) — ${dest}`);
      db.prepare('INSERT INTO historique_mails (jeune_id, quand, source, destinataires, objet, contenu, pieces, modele_nom, methode, statut) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(c.jeune_id, maintenant(), `Commission (${nature})`, dest, String(m.objet ?? ''), String(m.corps ?? ''), vide(m.pieces), vide(m.modele_nom), methode, statut);
      // Première convocation préparée : la commission passe à « Convocations envoyées » (l'envoi réel reste la décision de l'utilisatrice).
      if (nature === 'convocation' && c.statut === 'programmee') {
        db.prepare("UPDATE commissions SET statut = 'convocations_envoyees', modifie_le = ? WHERE id = ?").run(maintenant(), c.id);
        journaliser(c.id, 'Statut', `${NOMS_STATUTS.programmee} → ${NOMS_STATUTS.convocations_envoyees}`);
      }
      return true;
    },

    // Points d'attention : commissions à programmer, à venir (rappel), convocations non préparées, comptes rendus manquants.
    'commissions:rappels': () => {
      const auj = aujourdhui();
      const limite = ajouterJours(auj, joursRappel());
      const lignes = db.prepare(`${SELECT} WHERE c.statut IN ('a_programmer', 'programmee', 'convocations_envoyees', 'reportee') ORDER BY c.date, c.heure_debut`).all();
      const nom = (c) => `${c.jeune_prenom} ${c.jeune_nom}`;
      const sortie = { a_programmer: [], a_convoquer: [], a_venir: [], a_realiser: [], jours: joursRappel() };
      for (const c of lignes) {
        const r = { id: c.id, jeune: nom(c), type: c.type, date: c.date, heure_debut: c.heure_debut, motif: c.motif };
        if (c.statut === 'a_programmer' || c.statut === 'reportee' || !c.date) sortie.a_programmer.push(r);
        else if (c.date < auj) sortie.a_realiser.push(r);
        else {
          if (c.statut === 'programmee' && c.date <= limite) sortie.a_convoquer.push(r);
          if (c.date <= limite) sortie.a_venir.push(r);
        }
      }
      return sortie;
    },

    'commissions:reglages': () => ({ rappel_jours: joursRappel() }),
    'commissions:reglages:save': (r) => {
      const n = Number(r?.rappel_jours);
      if (!Number.isInteger(n) || n < 0 || n > 30) throw new Error('Délai de rappel : entre 0 et 30 jours.');
      db.prepare("INSERT INTO reglages (cle, valeur) VALUES ('commission_rappel_jours', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(String(n));
      return true;
    },
  };
  return actions;
}

module.exports = { creerCommissions, STATUTS, NOMS_STATUTS };
