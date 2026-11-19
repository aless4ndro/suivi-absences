// Discipline : motifs et paliers de sanction, sanctions (décision toujours humaine), historique tracé,
// communication à l'employeur archivée, pièces jointes, intervenants.
// Règle impérative : l'application PROPOSE un palier avec ses raisons ; elle ne prononce jamais de sanction.

const EMAIL = /^[^\s@;,<>"]+@[^\s@;,<>"]+\.[^\s@;,<>"]+$/;
const DECISIONS = ['en_attente', 'sanction', 'rappel', 'aucune', 'commission'];
const COMMUNICATIONS = ['obligatoire', 'facultative', 'non'];
const HISTORIQUE_MOIS_DEFAUT = 12;

const maintenant = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const moisAvant = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
};
const jma = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const NOMS_DECISIONS = { en_attente: 'En attente de décision', sanction: 'Sanction prononcée', rappel: "Rappel à l'ordre", aucune: 'Aucune suite', commission: 'Orienté vers une commission' };

function creerDiscipline(db, h) {
  const { vide, dateValide, destinatairesDe, aujourdhui } = h;

  const journaliser = (sanctionId, action, detail) =>
    db.prepare('INSERT INTO sanction_journal (sanction_id, quand, action, detail) VALUES (?,?,?,?)').run(sanctionId, maintenant(), action, detail ?? null);

  const lireReglage = (cle, defaut) => {
    const r = db.prepare('SELECT valeur FROM reglages WHERE cle = ?').get(cle);
    return r ? r.valeur : defaut;
  };
  const moisHistorique = () => {
    const n = Number(lireReglage('discipline_historique_mois', HISTORIQUE_MOIS_DEFAUT));
    return Number.isInteger(n) && n >= 1 && n <= 120 ? n : HISTORIQUE_MOIS_DEFAUT;
  };

  const SELECT_SANCTION = `
    SELECT s.*, j.nom AS jeune_nom, j.prenom AS jeune_prenom,
           m.intitule AS motif_intitule, m.communication AS motif_communication,
           pp.libelle AS palier_propose_libelle, pp.ordre AS palier_propose_ordre,
           pr.libelle AS palier_retenu_libelle, pr.ordre AS palier_retenu_ordre, pr.communication AS palier_communication,
           i.nom AS responsable_nom,
           c.code AS classe_code,
           (SELECT COUNT(*) FROM sanction_pieces x WHERE x.sanction_id = s.id) AS nb_pieces,
           (SELECT COUNT(*) FROM sanction_communications x WHERE x.sanction_id = s.id) AS nb_communications
    FROM sanctions s
    JOIN jeunes j ON j.id = s.jeune_id
    JOIN motifs_sanction m ON m.id = s.motif_id
    LEFT JOIN paliers pp ON pp.id = s.palier_propose_id
    LEFT JOIN paliers pr ON pr.id = s.palier_retenu_id
    LEFT JOIN intervenants i ON i.id = s.intervenant_id
    LEFT JOIN classes c ON c.id = COALESCE((SELECT jc.classe_id FROM jeune_classes jc WHERE jc.jeune_id = j.id AND jc.date_debut <= s.date_faits ORDER BY jc.date_debut DESC LIMIT 1), j.classe_id)
  `;

  // Communication applicable à une sanction : motif si précisé, sinon palier retenu (sinon palier proposé).
  function communicationDe(s) {
    if (s.decision !== 'sanction') return 'non';
    return s.motif_communication ?? s.palier_communication ?? 'facultative';
  }
  function enrichir(s) {
    const communication = communicationDe(s);
    const faite = db.prepare('SELECT COUNT(*) AS n FROM sanction_communications WHERE sanction_id = ?').get(s.id).n > 0;
    return { ...s, communication, communication_manquante: communication === 'obligatoire' && !faite };
  }

  // ---- Proposition de palier ------------------------------------------------------------------------------------
  // Base : palier du motif. Les sanctions prononcées dans la période d'historique (réglable) comptent :
  // même motif déjà sanctionné → au moins le palier supérieur à la précédente ; autre motif → jamais en dessous
  // du palier déjà atteint. Les sanctions plus anciennes sont listées mais ne comptent pas.
  function proposer({ jeune_id, motif_id, date_faits, sanction_id }) {
    if (!dateValide(date_faits)) throw new Error('Indiquez la date des faits.');
    const motif = db.prepare('SELECT m.*, p.ordre AS ordre, p.libelle AS palier_libelle FROM motifs_sanction m JOIN paliers p ON p.id = m.palier_id WHERE m.id = ?').get(Number(motif_id));
    if (!motif) throw new Error('Choisissez un motif.');
    const mois = moisHistorique();
    const limite = moisAvant(date_faits, mois);
    const precedentes = db.prepare(
      `SELECT s.id, s.date_faits, s.motif_id, m.intitule AS motif, p.ordre, p.libelle AS palier
       FROM sanctions s JOIN motifs_sanction m ON m.id = s.motif_id JOIN paliers p ON p.id = s.palier_retenu_id
       WHERE s.jeune_id = ? AND s.decision = 'sanction' AND s.date_faits <= ? AND s.id <> ?
       ORDER BY s.date_faits DESC`
    ).all(Number(jeune_id), date_faits, Number(sanction_id) || 0).map((x) => ({ ...x, dans_periode: x.date_faits >= limite }));
    const recentes = precedentes.filter((x) => x.dans_periode);
    const memeMotif = recentes.filter((x) => x.motif_id === motif.id);
    const maxRecent = recentes.reduce((m, x) => Math.max(m, x.ordre), 0);
    const maxMeme = memeMotif.reduce((m, x) => Math.max(m, x.ordre), 0);

    const raisons = [`Le motif « ${motif.intitule} » correspond au palier ${motif.ordre} (${motif.palier_libelle}).`];
    let ordre = motif.ordre;
    if (memeMotif.length) {
      ordre = Math.max(ordre, maxMeme + 1);
      raisons.push(`Ce même motif a déjà été sanctionné ${memeMotif.length} fois sur les ${mois} derniers mois (dernier palier : ${maxMeme}) : palier supérieur proposé.`);
    } else if (recentes.length) {
      ordre = Math.max(ordre, maxRecent);
      raisons.push(`D'autres sanctions ont été prononcées sur les ${mois} derniers mois (palier le plus élevé : ${maxRecent}) : on ne descend pas en dessous.`);
    } else if (precedentes.length) {
      raisons.push(`Les sanctions antérieures datent de plus de ${mois} mois : elles ne sont pas prises en compte.`);
    } else {
      raisons.push("Aucune sanction antérieure dans le dossier de l'apprenti.");
    }
    const paliers = db.prepare('SELECT * FROM paliers WHERE actif = 1 ORDER BY ordre').all();
    if (!paliers.length) throw new Error("Aucun palier n'est actif.");
    // le palier proposé est le premier palier actif de rang >= au rang calculé (sinon le plus élevé)
    const retenu = paliers.find((p) => p.ordre >= ordre) ?? paliers[paliers.length - 1];
    if (retenu.ordre !== ordre) raisons.push(`Le palier ${ordre} n'existe pas ou n'est pas actif : palier ${retenu.ordre} proposé.`);
    return { palier_id: retenu.id, ordre: retenu.ordre, libelle: retenu.libelle, raisons, precedentes, mois };
  }

  function lireSanction(id) {
    const s = db.prepare(`${SELECT_SANCTION} WHERE s.id = ?`).get(Number(id));
    if (!s) throw new Error('Sanction introuvable.');
    return enrichir(s);
  }

  const CHAMPS_JOURNAL = {
    date_faits: 'Date des faits', motif_id: 'Motif', decision: 'Décision', palier_retenu_id: 'Palier retenu', justification: 'Justification',
    description: 'Description', observations: 'Observations', date_decision: 'Date de décision', duree: 'Durée', intervenant_id: 'Responsable',
    observations_apprenti: "Observations de l'apprenti", contestation: 'Contestation',
  };
  const libelleValeur = (champ, v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (champ === 'motif_id') return db.prepare('SELECT intitule FROM motifs_sanction WHERE id = ?').get(v)?.intitule ?? String(v);
    if (champ === 'palier_retenu_id') return db.prepare('SELECT libelle FROM paliers WHERE id = ?').get(v)?.libelle ?? String(v);
    if (champ === 'intervenant_id') return db.prepare('SELECT nom FROM intervenants WHERE id = ?').get(v)?.nom ?? String(v);
    if (champ === 'decision') return NOMS_DECISIONS[v] ?? v;
    if (champ === 'date_faits' || champ === 'date_decision') return jma(v);
    const t = String(v);
    return t.length > 80 ? `${t.slice(0, 77)}…` : t;
  };

  const actions = {
    // ---- Intervenants (participants, responsables) ---------------------------------------------------------------
    'intervenants:list': () => db.prepare('SELECT * FROM intervenants ORDER BY actif DESC, nom COLLATE NOCASE').all(),
    'intervenants:save': (i) => {
      const nom = vide(i.nom);
      if (!nom) throw new Error('Le nom est obligatoire.');
      const email = vide(i.email);
      if (email && !EMAIL.test(email)) throw new Error('Adresse e-mail invalide.');
      const p = [nom, vide(i.fonction), email, i.actif === 0 || i.actif === false ? 0 : 1];
      if (i.id) { db.prepare('UPDATE intervenants SET nom=?, fonction=?, email=?, actif=? WHERE id=?').run(...p, Number(i.id)); return Number(i.id); }
      return Number(db.prepare('INSERT INTO intervenants (nom, fonction, email, actif) VALUES (?,?,?,?)').run(...p).lastInsertRowid);
    },
    'intervenants:delete': (id) => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM sanctions WHERE intervenant_id = ?').get(Number(id)).n;
      if (n) throw new Error('Cet intervenant figure sur des sanctions : désactivez-le plutôt que de le supprimer.');
      db.prepare('DELETE FROM intervenants WHERE id = ?').run(Number(id));
      return true;
    },

    // ---- Paliers et réglages ---------------------------------------------------------------------------------------
    'paliers:list': () => db.prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM motifs_sanction m WHERE m.palier_id = p.id) AS nb_motifs,
              (SELECT COUNT(*) FROM sanctions s WHERE s.palier_retenu_id = p.id) AS nb_sanctions
       FROM paliers p ORDER BY p.ordre`
    ).all(),
    'paliers:save': (p) => {
      const libelle = vide(p.libelle);
      if (!libelle) throw new Error('Le libellé du palier est obligatoire.');
      if (!COMMUNICATIONS.includes(p.communication)) throw new Error("Choisissez le mode de communication à l'employeur.");
      const actif = p.actif === 0 || p.actif === false ? 0 : 1;
      if (p.id) {
        db.prepare('UPDATE paliers SET libelle=?, communication=?, actif=? WHERE id=?').run(libelle, p.communication, actif, Number(p.id));
        return Number(p.id);
      }
      const ordre = (db.prepare('SELECT MAX(ordre) AS m FROM paliers').get().m ?? 0) + 1;
      return Number(db.prepare('INSERT INTO paliers (ordre, libelle, communication, actif) VALUES (?,?,?,?)').run(ordre, libelle, p.communication, actif).lastInsertRowid);
    },
    'discipline:reglages': () => ({ historique_mois: moisHistorique() }),
    'discipline:reglages:save': ({ historique_mois }) => {
      const n = Number(historique_mois);
      if (!Number.isInteger(n) || n < 1 || n > 120) throw new Error("La durée de prise en compte doit être de 1 à 120 mois.");
      db.prepare('INSERT INTO reglages (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur').run('discipline_historique_mois', String(n));
      return true;
    },

    // ---- Motifs de sanction ----------------------------------------------------------------------------------------
    'sanctions:motifs': () => db.prepare(
      `SELECT m.*, p.ordre AS palier_ordre, p.libelle AS palier_libelle,
              (SELECT COUNT(*) FROM sanctions s WHERE s.motif_id = m.id) AS nb_utilisations
       FROM motifs_sanction m JOIN paliers p ON p.id = m.palier_id
       ORDER BY m.actif DESC, p.ordre, m.intitule COLLATE NOCASE`
    ).all(),
    'sanctions:motif:save': (m) => {
      const intitule = vide(m.intitule);
      if (!intitule) throw new Error("L'intitulé du motif est obligatoire.");
      if (!db.prepare('SELECT 1 FROM paliers WHERE id = ?').get(Number(m.palier_id))) throw new Error('Choisissez un palier.');
      const communication = m.communication ? m.communication : null;
      if (communication && !COMMUNICATIONS.includes(communication)) throw new Error('Mode de communication invalide.');
      const doublon = db.prepare('SELECT id, intitule FROM motifs_sanction').all()
        .find((x) => h.cle(x.intitule) === h.cle(intitule) && x.id !== Number(m.id));
      if (doublon) throw new Error(`Un motif « ${doublon.intitule} » existe déjà.`);
      const p = [intitule, vide(m.description), vide(m.categorie), Number(m.palier_id), m.actif === 0 || m.actif === false ? 0 : 1, vide(m.commentaire), communication];
      if (m.id) {
        db.prepare('UPDATE motifs_sanction SET intitule=?, description=?, categorie=?, palier_id=?, actif=?, commentaire=?, communication=? WHERE id=?').run(...p, Number(m.id));
        return Number(m.id);
      }
      return Number(db.prepare('INSERT INTO motifs_sanction (intitule, description, categorie, palier_id, actif, commentaire, communication) VALUES (?,?,?,?,?,?,?)').run(...p).lastInsertRowid);
    },
    'sanctions:motif:delete': (id) => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM sanctions WHERE motif_id = ?').get(Number(id)).n;
      if (n) throw new Error('Ce motif a été utilisé : désactivez-le plutôt que de le supprimer.');
      db.prepare('DELETE FROM motifs_sanction WHERE id = ?').run(Number(id));
      return true;
    },

    'sanctions:proposer': (a) => proposer(a),

    // ---- Sanctions -------------------------------------------------------------------------------------------------
    'sanctions:list': (f = {}) => {
      const where = [];
      const p = [];
      if (f.jeune_id) { where.push('s.jeune_id = ?'); p.push(Number(f.jeune_id)); }
      if (f.statut) { where.push('s.statut = ?'); p.push(f.statut); }
      if (f.decision) { where.push('s.decision = ?'); p.push(f.decision); }
      if (f.palier_id) { where.push('s.palier_retenu_id = ?'); p.push(Number(f.palier_id)); }
      if (f.debut) { where.push('s.date_faits >= ?'); p.push(f.debut); }
      if (f.fin) { where.push('s.date_faits <= ?'); p.push(f.fin); }
      const rows = db.prepare(`${SELECT_SANCTION} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.date_faits DESC, s.id DESC`).all(...p);
      return rows.map(enrichir);
    },
    'sanctions:get': (id) => {
      const s = lireSanction(id);
      return {
        ...s,
        pieces: db.prepare('SELECT id, nom_fichier, taille, ajoute_le FROM sanction_pieces WHERE sanction_id = ? ORDER BY id').all(s.id),
        communications: db.prepare('SELECT * FROM sanction_communications WHERE sanction_id = ? ORDER BY id DESC').all(s.id),
        journal: db.prepare('SELECT quand, action, detail FROM sanction_journal WHERE sanction_id = ? ORDER BY id DESC').all(s.id),
      };
    },
    'sanctions:save': (s) => {
      const jeuneId = Number(s.jeune_id);
      if (!db.prepare('SELECT 1 FROM jeunes WHERE id = ?').get(jeuneId)) throw new Error('Apprenti introuvable.');
      if (!dateValide(s.date_faits)) throw new Error('Indiquez la date des faits.');
      if (s.date_faits > aujourdhui()) throw new Error('La date des faits ne peut pas être dans le futur.');
      const motif = db.prepare('SELECT * FROM motifs_sanction WHERE id = ?').get(Number(s.motif_id));
      if (!motif) throw new Error('Choisissez un motif.');
      const decision = DECISIONS.includes(s.decision) ? s.decision : 'en_attente';
      let retenu = null;
      let dateDecision = vide(s.date_decision);
      if (dateDecision && !dateValide(dateDecision)) throw new Error('Date de décision invalide.');
      if (decision === 'sanction') {
        retenu = Number(s.palier_retenu_id);
        if (!db.prepare('SELECT 1 FROM paliers WHERE id = ?').get(retenu)) throw new Error('Choisissez le palier de la sanction.');
        if (!dateDecision) dateDecision = aujourdhui();
        if (dateDecision < s.date_faits) throw new Error('La décision ne peut pas précéder les faits.');
      } else if (decision !== 'en_attente' && !dateDecision) {
        dateDecision = aujourdhui();
      }
      if (decision === 'en_attente') dateDecision = null;
      const intervenant = s.intervenant_id ? Number(s.intervenant_id) : null;
      if (intervenant && !db.prepare('SELECT 1 FROM intervenants WHERE id = ?').get(intervenant)) throw new Error('Responsable introuvable.');
      const champs = {
        date_faits: s.date_faits, motif_id: motif.id, decision, palier_retenu_id: retenu, justification: vide(s.justification), description: vide(s.description),
        observations: vide(s.observations), date_decision: dateDecision, duree: vide(s.duree), intervenant_id: intervenant,
        observations_apprenti: vide(s.observations_apprenti), contestation: vide(s.contestation),
      };

      db.exec('BEGIN');
      try {
        let id = Number(s.id) || 0;
        // Le palier proposé est toujours calculé ici (jamais fourni par l'interface), à la création ou si motif / date changent.
        if (!id) {
          const prop = proposer({ jeune_id: jeuneId, motif_id: motif.id, date_faits: s.date_faits });
          id = Number(db.prepare(
            `INSERT INTO sanctions (jeune_id, date_faits, motif_id, palier_propose_id, decision, palier_retenu_id, justification, description, observations,
              date_decision, duree, intervenant_id, observations_apprenti, contestation, cree_le) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          ).run(jeuneId, champs.date_faits, motif.id, prop.palier_id, decision, retenu, champs.justification, champs.description, champs.observations,
            champs.date_decision, champs.duree, intervenant, champs.observations_apprenti, champs.contestation, maintenant()).lastInsertRowid);
          journaliser(id, 'Création', `Manquement du ${jma(s.date_faits)} — ${motif.intitule}. Palier proposé : ${prop.libelle}.`);
          if (decision !== 'en_attente') {
            journaliser(id, 'Décision', `${NOMS_DECISIONS[decision]}${retenu ? ` — ${libelleValeur('palier_retenu_id', retenu)}` : ''}${prop.palier_id !== retenu && decision === 'sanction' ? ' (différent du palier proposé)' : ''}`);
          }
        } else {
          const avant = db.prepare('SELECT * FROM sanctions WHERE id = ?').get(id);
          if (!avant) throw new Error('Sanction introuvable.');
          if (avant.jeune_id !== jeuneId) throw new Error("L'apprenti d'une sanction ne peut pas être changé.");
          if (avant.statut === 'cloturee') throw new Error('Ce dossier est clôturé : rouvrez-le pour le modifier.');
          let propose = avant.palier_propose_id;
          if (avant.motif_id !== motif.id || avant.date_faits !== s.date_faits) {
            propose = proposer({ jeune_id: jeuneId, motif_id: motif.id, date_faits: s.date_faits, sanction_id: id }).palier_id;
          }
          const diffs = [];
          for (const [champ, nom] of Object.entries(CHAMPS_JOURNAL)) {
            if ((avant[champ] ?? null) !== (champs[champ] ?? null)) diffs.push(`${nom} : ${libelleValeur(champ, avant[champ])} → ${libelleValeur(champ, champs[champ])}`);
          }
          if (propose !== avant.palier_propose_id) diffs.push(`Palier proposé recalculé : ${libelleValeur('palier_retenu_id', avant.palier_propose_id)} → ${libelleValeur('palier_retenu_id', propose)}`);
          db.prepare(
            `UPDATE sanctions SET date_faits=?, motif_id=?, palier_propose_id=?, decision=?, palier_retenu_id=?, justification=?, description=?, observations=?,
              date_decision=?, duree=?, intervenant_id=?, observations_apprenti=?, contestation=?, modifie_le=? WHERE id=?`
          ).run(champs.date_faits, motif.id, propose, decision, retenu, champs.justification, champs.description, champs.observations,
            champs.date_decision, champs.duree, intervenant, champs.observations_apprenti, champs.contestation, maintenant(), id);
          if (avant.decision !== decision || avant.palier_retenu_id !== retenu) {
            journaliser(id, 'Décision', `${NOMS_DECISIONS[decision]}${retenu ? ` — ${libelleValeur('palier_retenu_id', retenu)}` : ''}${decision === 'sanction' && propose !== retenu ? ' (différent du palier proposé)' : ''}`);
          }
          if (diffs.length) journaliser(id, 'Modification', diffs.join('\n'));
        }
        db.exec('COMMIT');
        return id;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    'sanctions:cloturer': (id) => {
      const s = lireSanction(id);
      if (s.statut === 'cloturee') return true;
      if (s.decision === 'en_attente') throw new Error("Une décision (ou « aucune suite ») doit être enregistrée avant de clôturer le dossier.");
      if (s.communication_manquante) throw new Error("La communication à l'employeur est obligatoire pour ce palier : préparez-la avant de clôturer.");
      db.prepare("UPDATE sanctions SET statut = 'cloturee', cloture_le = ?, modifie_le = ? WHERE id = ?").run(aujourdhui(), maintenant(), s.id);
      journaliser(s.id, 'Clôture', 'Dossier clôturé (historique conservé).');
      return true;
    },
    'sanctions:rouvrir': (id) => {
      const s = lireSanction(id);
      db.prepare("UPDATE sanctions SET statut = 'ouverte', cloture_le = NULL, modifie_le = ? WHERE id = ?").run(maintenant(), s.id);
      journaliser(s.id, 'Réouverture', 'Dossier rouvert.');
      return true;
    },
    // Suppression réservée aux saisies erronées : jamais si une décision, une communication ou une pièce existe.
    'sanctions:supprimer': (id) => {
      const s = lireSanction(id);
      if (s.decision !== 'en_attente' || s.nb_communications || s.nb_pieces) {
        throw new Error("Seule une saisie sans décision, sans pièce et sans communication peut être supprimée : clôturez le dossier à la place.");
      }
      db.prepare('DELETE FROM sanctions WHERE id = ?').run(s.id);
      return true;
    },

    // ---- Communication ---------------------------------------------------------------------------------------------
    // Destinataires : employeur et maître de l'époque des faits, professeur principal, représentant légal si l'apprenti est mineur.
    'sanctions:destinataires': (id) => {
      const s = lireSanction(id);
      const liste = destinatairesDe(s.jeune_id, s.date_faits);
      const j = db.prepare('SELECT date_naissance, representant_nom, representant_email FROM jeunes WHERE id = ?').get(s.jeune_id);
      const ref = s.date_decision ?? aujourdhui();
      let mineur = false;
      if (j.date_naissance) {
        const dix8 = new Date(`${j.date_naissance}T00:00:00Z`);
        dix8.setUTCFullYear(dix8.getUTCFullYear() + 18);
        mineur = dix8.toISOString().slice(0, 10) > ref;
      }
      if (mineur && j.representant_email) liste.push({ cle: 'representant', role: 'representant', libelle: `Représentant légal${j.representant_nom ? ` : ${j.representant_nom}` : ''}`, email: j.representant_email });
      return { destinataires: liste, mineur, representant_manquant: mineur && !j.representant_email };
    },
    // Archive une préparation de mail (le brouillon Outlook / mailto est ouvert par l'application, l'envoi reste manuel).
    'sanctions:communication:archiver': (c) => {
      const s = lireSanction(c.sanction_id);
      const a = Array.isArray(c.a) ? c.a : [];
      const cc = Array.isArray(c.cc) ? c.cc : [];
      const cci = Array.isArray(c.cci) ? c.cci : [];
      if (!a.length && !cc.length && !cci.length) throw new Error('Aucun destinataire.');
      const dest = [a.length ? `À : ${a.join(', ')}` : '', cc.length ? `Cc : ${cc.join(', ')}` : '', cci.length ? `Cci : ${cci.join(', ')}` : ''].filter(Boolean).join(' | ');
      const methode = c.methode === 'outlook' ? 'Outlook' : 'Messagerie par défaut';
      const statut = c.methode === 'outlook' ? 'Brouillon ouvert dans Outlook (envoi à valider par vous)' : 'Brouillon ouvert (envoi à valider par vous)';
      db.prepare('INSERT INTO sanction_communications (sanction_id, quand, destinataires, objet, contenu, methode, statut, pieces) VALUES (?,?,?,?,?,?,?,?)')
        .run(s.id, maintenant(), dest, String(c.objet ?? ''), String(c.corps ?? ''), methode, statut, vide(c.pieces));
      journaliser(s.id, 'Communication', `Mail préparé — ${dest}`);
      return true;
    },

    // ---- Pièces jointes --------------------------------------------------------------------------------------------
    'sanctions:piece:ajouter': ({ sanction_id, nom, contenu }) => {
      const s = lireSanction(sanction_id);
      if (s.statut === 'cloturee') throw new Error('Ce dossier est clôturé : rouvrez-le pour ajouter une pièce.');
      if (!contenu?.length) throw new Error('Fichier vide.');
      if (contenu.length > h.tailleMax) throw new Error('Fichier trop volumineux (10 Mo maximum).');
      db.prepare('INSERT INTO sanction_pieces (sanction_id, nom_fichier, taille, contenu, ajoute_le) VALUES (?,?,?,?,?)').run(s.id, String(nom), contenu.length, contenu, maintenant());
      journaliser(s.id, 'Pièce ajoutée', String(nom));
      return true;
    },
    'sanctions:piece:contenu': (id) => {
      const r = db.prepare('SELECT nom_fichier, contenu FROM sanction_pieces WHERE id = ?').get(Number(id));
      if (!r) throw new Error('Pièce introuvable.');
      return r;
    },
    'sanctions:piece:supprimer': (id) => {
      const r = db.prepare('SELECT sanction_id, nom_fichier FROM sanction_pieces WHERE id = ?').get(Number(id));
      if (!r) return true;
      if (lireSanction(r.sanction_id).statut === 'cloturee') throw new Error('Ce dossier est clôturé : rouvrez-le pour retirer une pièce.');
      db.prepare('DELETE FROM sanction_pieces WHERE id = ?').run(Number(id));
      journaliser(r.sanction_id, 'Pièce retirée', r.nom_fichier);
      return true;
    },
  };
  return actions;
}

module.exports = { creerDiscipline };
