// Rattrapages d'heures : séances, compteur d'heures, validation, justificatifs, historique.
// Règle centrale : seule une séance VALIDÉE (statut « effectuee ») diminue le solde d'heures dues.

const EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png'];

const ETABLISSEMENT_DEFAUT = {
  nom: 'Institution Notre-Dame Saint-François',
  ville: 'Évreux',
  signataire: 'Monsieur FLEURY Mathieu',
  fonction: 'Adjoint de direction CAMPUS NDSF',
  referent: 'Madame THOMMERET-DOMENICHELLI',
  absents: 'Monsieur FLEURY ou de Madame THOMMERET-DOMENICHELLI',
  salle: 'SD 303',
  service: 'Service vie scolaire - Apprentissage',
  coordonnees: '8 rue Portevin - 27000 Évreux - 02 32 33 06 42 - contact@ndsf.fr',
  pied_titre: 'INSTITUTION NOTRE-DAME SAINT-FRANÇOIS',
  pied_lignes:
    "Etablissement privé catholique sous contrat d'association avec l'État\n" +
    'Ecole maternelle - primaire | Collège | Lycée général - technologique - professionnel | Maîtrise | Supérieur | UFA | Internat\n' +
    '8 rue Portevin | 27000 Évreux | 02 32 33 06 42 | contact@ndsf.fr',
  pied_site: 'ndsf.fr',
};

function creerRattrapages(db, h) {
  const { vide, dateValide, heureValide, enMinutes, cle, classeA, tailleMax } = h;

  const maintenant = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const journal = (jeuneId, seanceId, action, detail) =>
    db.prepare('INSERT INTO rattrapage_historique (jeune_id, seance_id, quand, action, detail) VALUES (?,?,?,?,?)')
      .run(jeuneId, seanceId ?? null, maintenant(), action, detail ?? null);
  const fmt = (min) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;

  const seance = (id) => {
    const s = db.prepare('SELECT * FROM rattrapage_seances WHERE id = ?').get(Number(id));
    if (!s) throw new Error('Séance de rattrapage introuvable.');
    return s;
  };
  const minutesValidees = (s) => (s.statut === 'effectuee' ? s.duree_validee_minutes ?? s.duree_minutes : 0);

  // Séances prises en compte pour une période (celle pour laquelle elles ont été programmées).
  function filtreSeances(debut, fin) {
    const w = [];
    const p = [];
    if (debut) { w.push('COALESCE(periode_debut, date) >= ?'); p.push(debut); }
    if (fin) { w.push('COALESCE(periode_fin, date) <= ?'); p.push(fin); }
    return { w, p };
  }

  function duesParJeune(debut, fin) {
    const w = ["m.statut = 'irrecevable'"];
    const p = [];
    if (debut) { w.push('e.date_debut >= ?'); p.push(debut); }
    if (fin) { w.push('e.date_debut <= ?'); p.push(fin); }
    return db.prepare(
      `SELECT e.jeune_id,
              SUM(e.type = 'absence') AS nb_absences, SUM(e.type = 'retard') AS nb_retards,
              SUM(CASE WHEN e.type = 'absence' THEN COALESCE(e.duree_minutes, 0) ELSE 0 END) AS min_absences,
              SUM(CASE WHEN e.type = 'retard' THEN COALESCE(e.duree_minutes, 0) ELSE 0 END) AS min_retards
       FROM evenements e JOIN motifs m ON m.id = e.motif_id WHERE ${w.join(' AND ')} GROUP BY e.jeune_id`
    ).all(...p);
  }

  function compteur(jeuneId, debut, fin) {
    const dues = duesParJeune(debut, fin).find((d) => d.jeune_id === jeuneId);
    const { w, p } = filtreSeances(debut, fin);
    const seances = db.prepare(
      `SELECT * FROM rattrapage_seances WHERE jeune_id = ? ${w.map((x) => `AND ${x}`).join(' ')} ORDER BY date, heure_debut`
    ).all(jeuneId, ...p);
    const dus = (dues?.min_absences ?? 0) + (dues?.min_retards ?? 0);
    const programmees = seances.filter((s) => s.statut === 'programmee').reduce((t, s) => t + s.duree_minutes, 0);
    const validees = seances.reduce((t, s) => t + minutesValidees(s), 0);
    const solde = Math.max(0, dus - validees);
    const nonEffectuees = seances.filter((s) => s.statut === 'non_effectuee').length;
    let statut = 'aucun';
    if (dus > 0 || seances.length) {
      if (dus > 0 && solde === 0) statut = 'termine';
      else if (validees > 0) statut = 'partiel';
      else if (programmees > 0) statut = 'programme';
      else if (nonEffectuees > 0) statut = 'non_effectue';
      else statut = 'a_programmer';
    }
    return {
      nb_absences: dues?.nb_absences ?? 0, nb_retards: dues?.nb_retards ?? 0,
      min_absences: dues?.min_absences ?? 0, min_retards: dues?.min_retards ?? 0,
      dues: dus, programmees, validees, solde, reste_a_programmer: Math.max(0, solde - programmees),
      nb_seances: seances.length, nb_non_effectuees: nonEffectuees, statut,
    };
  }

  const actions = {
    'etablissement:get': () => {
      const r = db.prepare("SELECT valeur FROM reglages WHERE cle = 'etablissement'").get();
      let enr = {};
      try { enr = r ? JSON.parse(r.valeur) : {}; } catch { enr = {}; }
      return { ...ETABLISSEMENT_DEFAUT, ...enr };
    },

    'etablissement:save': (e) => {
      const propre = {};
      for (const k of Object.keys(ETABLISSEMENT_DEFAUT)) propre[k] = String(e?.[k] ?? '').trim() || ETABLISSEMENT_DEFAUT[k];
      db.prepare("INSERT INTO reglages (cle, valeur) VALUES ('etablissement', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur")
        .run(JSON.stringify(propre));
      return true;
    },

    'rattrapages:bilan': (f = {}) => {
      const debut = f.debut || null;
      const fin = f.fin || null;
      if ((debut && !dateValide(debut)) || (fin && !dateValide(fin))) throw new Error('Période invalide.');
      if (debut && fin && fin < debut) throw new Error('La date de fin doit être après la date de début.');
      const w = [];
      const p = [];
      // Classe de l'apprenti à la fin de la période (ou aujourd'hui) : un récapitulatif de juin reste dans la classe de juin.
      const d = new Date();
      const auj = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const ref = fin && fin < auj ? fin : auj;
      if (f.classe_id) { w.push(`${classeA('?')} = ?`); p.push(ref, Number(f.classe_id)); }
      if (f.jeune_id) w.push('j.id = ?'), p.push(Number(f.jeune_id));
      else if (!f.avec_sortis) { w.push('(j.sorti_le IS NULL OR j.sorti_le > ?)'); p.push(ref); } // sortis exclus à partir de leur départ
      let jeunes = db.prepare(
        `SELECT j.id, j.nom, j.prenom, c.id AS classe_id, c.code AS classe_code
         FROM jeunes j JOIN classes c ON c.id = ${classeA('?')} ${w.length ? `WHERE ${w.join(' AND ')}` : ''}
         ORDER BY c.ordre, j.nom COLLATE NOCASE, j.prenom COLLATE NOCASE`
      ).all(ref, ...p);
      if (vide(f.recherche)) {
        const q = cle(f.recherche);
        jeunes = jeunes.filter((j) => cle(`${j.nom} ${j.prenom}`).includes(q) || cle(`${j.prenom} ${j.nom}`).includes(q));
      }
      const apprentis = [];
      for (const j of jeunes) {
        const c = compteur(j.id, debut, fin);
        if (c.statut === 'aucun') continue;
        apprentis.push({ ...j, ...c });
      }
      const t = {
        nb_apprentis: apprentis.length,
        nb_absences: apprentis.reduce((n, a) => n + a.nb_absences, 0),
        nb_retards: apprentis.reduce((n, a) => n + a.nb_retards, 0),
        dues: apprentis.reduce((n, a) => n + a.dues, 0),
        programmees: apprentis.reduce((n, a) => n + a.programmees, 0),
        validees: apprentis.reduce((n, a) => n + a.validees, 0),
        solde: apprentis.reduce((n, a) => n + a.solde, 0),
        sans_rattrapage: apprentis.filter((a) => a.dues > 0 && a.validees === 0).length,
        regularises: apprentis.filter((a) => a.statut === 'termine').length,
      };
      return { totaux: t, apprentis };
    },

    'rattrapages:seances': (jeuneId) => {
      const rows = db.prepare('SELECT * FROM rattrapage_seances WHERE jeune_id = ? ORDER BY date, heure_debut').all(Number(jeuneId));
      const pieces = db.prepare(
        `SELECT id, seance_id, nom_fichier, taille FROM rattrapage_pieces WHERE seance_id IN (SELECT id FROM rattrapage_seances WHERE jeune_id = ?) ORDER BY id`
      ).all(Number(jeuneId));
      return rows.map((s) => ({ ...s, pieces: pieces.filter((x) => x.seance_id === s.id) }));
    },

    'rattrapages:seance:save': (s) => {
      const jeuneId = Number(s.jeune_id);
      if (!db.prepare('SELECT 1 FROM jeunes WHERE id = ?').get(jeuneId)) throw new Error('Apprenti introuvable.');
      if (!dateValide(s.date)) throw new Error('La date du rattrapage est invalide.');
      if (!heureValide(s.heure_debut) || !heureValide(s.heure_fin)) throw new Error('Les heures de début et de fin sont obligatoires.');
      const duree = enMinutes(s.heure_fin) - enMinutes(s.heure_debut);
      if (duree <= 0) throw new Error("L'heure de fin doit être après l'heure de début.");
      const pd = s.periode_debut && dateValide(s.periode_debut) ? s.periode_debut : null;
      const pf = s.periode_fin && dateValide(s.periode_fin) ? s.periode_fin : null;
      const id = s.id ? Number(s.id) : null;
      if (id) {
        const ex = seance(id);
        if (ex.jeune_id !== jeuneId) throw new Error('Séance introuvable.');
        if (ex.statut !== 'programmee') throw new Error("Cette séance est déjà validée : annulez d'abord la validation pour la modifier.");
      }
      const memeJour = db.prepare("SELECT * FROM rattrapage_seances WHERE jeune_id = ? AND date = ? AND statut != 'non_effectuee' AND id IS NOT ?")
        .all(jeuneId, s.date, id);
      for (const o of memeJour) {
        if (enMinutes(s.heure_debut) < enMinutes(o.heure_fin) && enMinutes(o.heure_debut) < enMinutes(s.heure_fin)) {
          throw new Error(`Chevauchement avec une autre séance de cet apprenti (${o.heure_debut} → ${o.heure_fin}).`);
        }
      }
      const val = [s.date, s.heure_debut, s.heure_fin, duree, vide(s.salle), pd, pf, vide(s.observations)];
      if (id) {
        db.prepare(
          `UPDATE rattrapage_seances SET date=?, heure_debut=?, heure_fin=?, duree_minutes=?, salle=?, periode_debut=?, periode_fin=?, observations=? WHERE id=?`
        ).run(...val, id);
        journal(jeuneId, id, 'seance_modifiee', `${s.date} ${s.heure_debut}-${s.heure_fin} (${fmt(duree)})`);
        return id;
      }
      const nid = Number(
        db.prepare(
          `INSERT INTO rattrapage_seances (jeune_id, date, heure_debut, heure_fin, duree_minutes, salle, periode_debut, periode_fin, observations)
           VALUES (?,?,?,?,?,?,?,?,?)`
        ).run(jeuneId, ...val).lastInsertRowid
      );
      journal(jeuneId, nid, 'seance_programmee', `${s.date} ${s.heure_debut}-${s.heure_fin} (${fmt(duree)})`);
      return nid;
    },

    'rattrapages:seance:delete': (id) => {
      const s = seance(id);
      if (s.statut !== 'programmee') throw new Error("Cette séance est déjà validée : annulez d'abord la validation.");
      db.prepare('DELETE FROM rattrapage_seances WHERE id = ?').run(s.id);
      journal(s.jeune_id, null, 'seance_supprimee', `${s.date} ${s.heure_debut}-${s.heure_fin}`);
      return true;
    },

    // Valider = constater que la séance a eu lieu (ou non). C'est la seule opération qui fait baisser le solde.
    'rattrapages:valider': ({ id, statut, duree_validee_minutes, sans_justificatif }) => {
      const s = seance(id);
      if (!['effectuee', 'non_effectuee'].includes(statut)) throw new Error('Statut de validation invalide.');
      if (s.statut !== 'programmee') throw new Error("Cette séance est déjà validée : annulez d'abord la validation.");
      let validee = 0;
      if (statut === 'effectuee') {
        const nb = db.prepare('SELECT COUNT(*) AS n FROM rattrapage_pieces WHERE seance_id = ?').get(s.id).n;
        if (nb === 0 && !sans_justificatif) {
          throw new Error("Importez d'abord la feuille d'émargement signée, ou confirmez la validation sans justificatif.");
        }
        validee = duree_validee_minutes == null ? s.duree_minutes : Math.round(Number(duree_validee_minutes));
        if (!(validee > 0) || validee > s.duree_minutes) {
          throw new Error(`Les heures effectuées doivent être comprises entre 1 minute et ${fmt(s.duree_minutes)}.`);
        }
      }
      db.prepare('UPDATE rattrapage_seances SET statut = ?, duree_validee_minutes = ?, valide_le = ? WHERE id = ?')
        .run(statut, validee, maintenant(), s.id);
      journal(s.jeune_id, s.id, statut === 'effectuee' ? 'seance_validee' : 'seance_non_effectuee',
        statut === 'effectuee'
          ? `${s.date} : ${fmt(validee)} validées sur ${fmt(s.duree_minutes)}${sans_justificatif ? ' (sans justificatif)' : ''}`
          : `${s.date} : apprenti absent ou séance non réalisée`);
      return true;
    },

    'rattrapages:annuler-validation': (id) => {
      const s = seance(id);
      if (s.statut === 'programmee') return true;
      db.prepare("UPDATE rattrapage_seances SET statut = 'programmee', duree_validee_minutes = NULL, valide_le = NULL WHERE id = ?").run(s.id);
      journal(s.jeune_id, s.id, 'validation_annulee', `${s.date} ${s.heure_debut}-${s.heure_fin}`);
      return true;
    },

    'rattrapages:convoque': ({ ids }) => {
      for (const id of ids ?? []) {
        const s = seance(id);
        db.prepare('UPDATE rattrapage_seances SET convocation_le = ? WHERE id = ?').run(maintenant(), s.id);
        journal(s.jeune_id, s.id, 'convocation_generee', `${s.date} ${s.heure_debut}-${s.heure_fin}`);
      }
      return true;
    },

    'rattrapages:emarge': ({ ids }) => {
      for (const id of ids ?? []) {
        const s = seance(id);
        journal(s.jeune_id, s.id, 'emargement_genere', `${s.date} ${s.heure_debut}-${s.heure_fin}`);
      }
      return true;
    },

    'rattrapages:piece:ajouter': ({ seance_id, nom, contenu }) => {
      const s = seance(seance_id);
      const n = vide(nom);
      if (!n) throw new Error('Nom de fichier manquant.');
      const ext = n.split('.').pop().toLowerCase();
      if (!EXTENSIONS.includes(ext)) throw new Error(`${n} : seuls les fichiers PDF, JPG et PNG sont acceptés.`);
      if (!contenu || contenu.length === 0) throw new Error(`${n} : le fichier est vide.`);
      if (contenu.length > tailleMax) throw new Error(`${n} : fichier trop volumineux (10 Mo maximum).`);
      const id = Number(
        db.prepare('INSERT INTO rattrapage_pieces (seance_id, nom_fichier, taille, contenu, ajoute_le) VALUES (?,?,?,?,?)')
          .run(s.id, n, contenu.length, contenu, maintenant()).lastInsertRowid
      );
      journal(s.jeune_id, s.id, 'emargement_importe', `${n} (séance du ${s.date})`);
      return id;
    },

    'rattrapages:piece:contenu': (id) => {
      const r = db.prepare('SELECT nom_fichier, contenu FROM rattrapage_pieces WHERE id = ?').get(Number(id));
      if (!r) throw new Error('Justificatif introuvable.');
      return r;
    },

    'rattrapages:piece:supprimer': (id) => {
      const r = db.prepare(
        'SELECT p.nom_fichier, s.id AS sid, s.jeune_id, s.statut FROM rattrapage_pieces p JOIN rattrapage_seances s ON s.id = p.seance_id WHERE p.id = ?'
      ).get(Number(id));
      if (!r) return true;
      db.prepare('DELETE FROM rattrapage_pieces WHERE id = ?').run(Number(id));
      journal(r.jeune_id, r.sid, 'emargement_supprime', r.nom_fichier);
      return true;
    },

    'rattrapages:historique': (jeuneId) =>
      db.prepare('SELECT * FROM rattrapage_historique WHERE jeune_id = ? ORDER BY id DESC LIMIT 300').all(Number(jeuneId)),

    // Données nécessaires à la convocation / feuille d'émargement d'un ou plusieurs séances d'un même apprenti.
    'rattrapages:document': ({ ids }) => {
      const liste = (ids ?? []).map((i) => seance(i));
      if (!liste.length) throw new Error('Aucune séance sélectionnée.');
      if (new Set(liste.map((s) => s.jeune_id)).size > 1) throw new Error("Les séances doivent concerner le même apprenti.");
      liste.sort((a, b) => (a.date + a.heure_debut).localeCompare(b.date + b.heure_debut));
      const j = db.prepare(
        `SELECT j.id, j.nom, j.prenom, j.civilite, j.adresse, j.code_postal, j.ville, c.code AS classe_code
         FROM jeunes j JOIN classes c ON c.id = ${classeA('?')} WHERE j.id = ?`
      ).get(liste[0].date, liste[0].jeune_id);
      const pd = liste.every((s) => s.periode_debut === liste[0].periode_debut) ? liste[0].periode_debut : null;
      const pf = liste.every((s) => s.periode_fin === liste[0].periode_fin) ? liste[0].periode_fin : null;
      const c = compteur(j.id, pd, pf);
      const seancesPeriode = db.prepare(
        `SELECT * FROM rattrapage_seances WHERE jeune_id = ? ${filtreSeances(pd, pf).w.map((x) => `AND ${x}`).join(' ')}`
      ).all(j.id, ...filtreSeances(pd, pf).p);
      const dejaValidees = seancesPeriode.reduce((t, s) => t + minutesValidees(s), 0);
      return {
        jeune: j, seances: liste, periode_debut: pd, periode_fin: pf,
        dues: c.dues, solde_avant: Math.max(0, c.dues - dejaValidees),
        etablissement: actions['etablissement:get'](),
      };
    },

    // Données du bilan mensuel destiné à l'employeur.
    'recap:donnees': ({ jeune_id, debut, fin }) => {
      if (!dateValide(debut) || !dateValide(fin) || fin < debut) throw new Error('Période invalide.');
      const jeuneId = Number(jeune_id);
      const evts = db.prepare(
        `SELECT e.id, e.type, e.date_debut, e.date_fin, e.duree_minutes, m.libelle AS motif
         FROM evenements e JOIN motifs m ON m.id = e.motif_id
         WHERE e.jeune_id = ? AND m.statut = 'irrecevable' AND e.date_debut >= ? AND e.date_debut <= ? ORDER BY e.date_debut`
      ).all(jeuneId, debut, fin);
      // Séances effectuées qui régularisent cette période (même règle que le compteur), même si elles ont lieu le mois suivant.
      const sf = filtreSeances(debut, fin);
      const seances = db.prepare(
        `SELECT * FROM rattrapage_seances WHERE jeune_id = ? AND statut = 'effectuee' ${sf.w.map((x) => `AND ${x}`).join(' ')} ORDER BY date`
      ).all(jeuneId, ...sf.p);
      const pieces = seances.length
        ? db.prepare(
            `SELECT id, seance_id, nom_fichier, taille FROM rattrapage_pieces WHERE seance_id IN (${seances.map(() => '?').join(',')}) ORDER BY id`
          ).all(...seances.map((s) => s.id))
        : [];
      const c = compteur(jeuneId, debut, fin);
      return {
        evenements: evts,
        pieces_evenements: evts.length
          ? db.prepare(`SELECT id, evenement_id, nom_fichier, taille FROM pieces_jointes WHERE evenement_id IN (${evts.map(() => '?').join(',')}) ORDER BY id`).all(...evts.map((e) => e.id))
          : [],
        min_absences: evts.filter((e) => e.type === 'absence').reduce((t, e) => t + (e.duree_minutes ?? 0), 0),
        min_retards: evts.filter((e) => e.type === 'retard').reduce((t, e) => t + (e.duree_minutes ?? 0), 0),
        seances_effectuees: seances.map((s) => ({ ...s, valide_minutes: minutesValidees(s) })),
        min_rattrapees: seances.reduce((t, s) => t + minutesValidees(s), 0),
        solde: c.solde, pieces,
        etablissement: actions['etablissement:get'](),
      };
    },

    'recap:envoye': ({ jeune_id, debut, fin, destinataires, pieces }) => {
      journal(Number(jeune_id), null, 'bilan_prepare',
        `Période ${debut} → ${fin} ; destinataire(s) : ${(destinataires ?? []).join(', ') || 'aucun'} ; pièces : ${(pieces ?? []).join(', ') || 'aucune'}`);
      return true;
    },
  };
  return actions;
}

module.exports = { creerRattrapages, ETABLISSEMENT_DEFAUT };
