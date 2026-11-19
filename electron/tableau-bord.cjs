// Tableau de bord disciplinaire : indicateurs calculés à la volée à partir des données (aucune saisie).
function creerTableauBord(db, h) {
  const { aujourdhui, recalculerAlertes } = h;

  return {
    // f : { debut, fin, formation, classe_id, jeune_id, palier_id, regle_id, statut_alerte }
    'dashboard:get': (f = {}) => {
      recalculerAlertes?.();
      const auj = aujourdhui();
      const debut = f.debut || null;
      const fin = f.fin || null;

      // filtre apprenti : formation (diplôme), promotion (classe), apprenti
      const jeuneW = [];
      const jeuneP = [];
      if (f.jeune_id) { jeuneW.push('j.id = ?'); jeuneP.push(Number(f.jeune_id)); }
      if (f.classe_id) { jeuneW.push('j.classe_id = ?'); jeuneP.push(Number(f.classe_id)); }
      if (f.formation) { jeuneW.push("cl.libelle LIKE ? || ' %'"); jeuneP.push(String(f.formation)); }
      const jeuneClause = jeuneW.length ? ` AND ${jeuneW.join(' AND ')}` : '';
      const JOIN = 'JOIN jeunes j ON j.id = {t}.jeune_id JOIN classes cl ON cl.id = j.classe_id';
      const jn = (t) => JOIN.replace('{t}', t);
      const periode = (col) => `${debut ? ` AND ${col} >= ?` : ''}${fin ? ` AND ${col} <= ?` : ''}`;
      const pp = () => [...(debut ? [debut] : []), ...(fin ? [fin] : [])];

      // alertes
      const aW = [];
      const aP = [];
      if (f.regle_id) { aW.push('AND a.regle_id = ?'); aP.push(Number(f.regle_id)); }
      if (f.statut_alerte === 'ouvertes' || !f.statut_alerte) aW.push("AND a.statut IN ('nouvelle', 'a_traiter', 'en_cours')");
      else if (f.statut_alerte !== 'toutes') { aW.push('AND a.statut = ?'); aP.push(f.statut_alerte); }
      const alertes = db.prepare(
        `SELECT a.id, a.jeune_id, a.valeur, a.seuil, a.statut, a.periode_cle, substr(a.cree_le, 1, 10) AS cree, r.libelle AS regle, j.nom AS jeune_nom, j.prenom AS jeune_prenom, cl.code AS classe_code
         FROM alertes a JOIN regles_alerte r ON r.id = a.regle_id ${jn('a')} WHERE 1=1 ${aW.join(' ')} ${periode('substr(a.cree_le, 1, 10)')} ${jeuneClause}
         ORDER BY a.id DESC`
      ).all(...aP, ...pp(), ...jeuneP);

      // sanctions prononcées
      const sW = [];
      const sP = [];
      if (f.palier_id) { sW.push('AND s.palier_retenu_id = ?'); sP.push(Number(f.palier_id)); }
      const sanctions = db.prepare(
        `SELECT s.id, s.jeune_id, s.date_decision, s.date_faits, s.statut, pr.libelle AS palier, m.intitule AS motif, j.nom AS jeune_nom, j.prenom AS jeune_prenom, cl.code AS classe_code
         FROM sanctions s JOIN motifs_sanction m ON m.id = s.motif_id LEFT JOIN paliers pr ON pr.id = s.palier_retenu_id ${jn('s')}
         WHERE s.decision = 'sanction' ${sW.join(' ')} ${periode('COALESCE(s.date_decision, s.date_faits)')} ${jeuneClause}
         ORDER BY COALESCE(s.date_decision, s.date_faits) DESC, s.id DESC`
      ).all(...sP, ...pp(), ...jeuneP);

      // commissions
      const commissions = db.prepare(
        `SELECT c.id, c.jeune_id, c.type, c.date, c.heure_debut, c.statut, c.motif, j.nom AS jeune_nom, j.prenom AS jeune_prenom, cl.code AS classe_code,
                (SELECT COUNT(*) FROM commission_communications x WHERE x.commission_id = c.id AND x.nature = 'convocation') AS nb_convocations,
                (SELECT group_concat(p.nom, ', ') FROM commission_participants p WHERE p.commission_id = c.id) AS participants
         FROM commissions c ${jn('c')} WHERE 1=1 ${periode('c.date')} ${jeuneClause} ORDER BY c.date, c.heure_debut`
      ).all(...pp(), ...jeuneP);
      const actives = commissions.filter((c) => ['programmee', 'convocations_envoyees'].includes(c.statut));
      const aVenir = actives.filter((c) => c.date >= auj);

      return {
        indicateurs: {
          alertes_a_traiter: alertes.filter((a) => ['nouvelle', 'a_traiter', 'en_cours'].includes(a.statut)).length,
          sanctions_prononcees: sanctions.length,
          commissions_programmees: actives.length,
          commissions_a_organiser: commissions.filter((c) => ['a_programmer', 'reportee'].includes(c.statut)).length,
        },
        alertes: alertes.slice(0, 10),
        commissions_a_venir: aVenir.slice(0, 10),
        commissions_a_organiser: commissions.filter((c) => ['a_programmer', 'reportee'].includes(c.statut)).slice(0, 10),
        sanctions: sanctions.slice(0, 10),
      };
    },
  };
}
module.exports = { creerTableauBord };
