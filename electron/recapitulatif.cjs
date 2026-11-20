// Récapitulatif absences / retards / sanctions : agrégation en LECTURE SEULE des modules existants.
// Aucune donnée n'est copiée ni ressaisie ; seuls l'historique des extractions et celui des transmissions sont écrits ici.
const crypto = require('node:crypto');

const DOMAINES = ['absences', 'retards', 'sanctions'];

function creerRecapitulatif(db, h) {
  const { dateValide, aujourdhui, classeDe, destinatairesDe } = h;
  const maintenant = () => new Date().toISOString();

  const somme = (l) => ({ nb: l.length, minutes: l.reduce((t, e) => t + (e.duree_minutes ?? 0), 0) });
  const detail = (l) => ({
    ...somme(l),
    justifiees: somme(l.filter((e) => e.motif_statut === 'recevable')),
    injustifiees: somme(l.filter((e) => e.motif_statut === 'irrecevable')),
    en_attente: somme(l.filter((e) => !e.motif_statut)),
  });
  const normaliser = (f = {}) => {
    if (!dateValide(f.debut) || !dateValide(f.fin) || f.fin < f.debut) throw new Error('Période invalide.');
    const dom = f.domaines ?? { absences: true, retards: true };
    const domaines = DOMAINES.filter((d) => (Array.isArray(dom) ? dom.includes(d) : dom[d]));
    if (!domaines.length) throw new Error('Choisissez au moins un domaine (absences, retards, sanctions).');
    return {
      debut: f.debut, fin: f.fin, domaines,
      classe_ids: [...new Set((f.classe_ids ?? []).map(Number).filter(Boolean))],
      jeune_ids: [...new Set((f.jeune_ids ?? []).map(Number).filter(Boolean))],
      recherche: String(f.recherche ?? '').trim(),
      annee_scolaire: f.annee_scolaire ? String(f.annee_scolaire) : null,
    };
  };
  const mois = (iso) => iso.slice(0, 7);

  // Calcule tout le récapitulatif ; l'empreinte change dès qu'une donnée source concernée change.
  function calculer(f) {
    const c = normaliser(f);
    const auj = aujourdhui();
    const ref = c.fin < auj ? c.fin : auj;
    const classes = new Map(db.prepare('SELECT id, code, libelle FROM classes').all().map((x) => [x.id, x]));
    const evts = c.domaines.includes('absences') || c.domaines.includes('retards')
      ? db.prepare(
        `SELECT e.id, e.jeune_id, e.type, e.date_debut, e.date_fin, e.duree_minutes, e.observations, m.libelle AS motif_libelle, m.statut AS motif_statut
         FROM evenements e LEFT JOIN motifs m ON m.id = e.motif_id WHERE e.date_debut >= ? AND e.date_debut <= ? ORDER BY e.date_debut, e.id`
      ).all(c.debut, c.fin).filter((e) => c.domaines.includes(e.type === 'absence' ? 'absences' : 'retards'))
      : [];
    const sanctions = c.domaines.includes('sanctions')
      ? db.prepare(
        `SELECT s.id, s.jeune_id, s.date_faits, s.date_decision, s.statut, s.duree, pr.libelle AS palier, m.intitule AS motif
         FROM sanctions s JOIN motifs_sanction m ON m.id = s.motif_id LEFT JOIN paliers pr ON pr.id = s.palier_retenu_id
         WHERE s.decision = 'sanction' AND COALESCE(s.date_decision, s.date_faits) >= ? AND COALESCE(s.date_decision, s.date_faits) <= ?
         ORDER BY COALESCE(s.date_decision, s.date_faits), s.id`
      ).all(c.debut, c.fin)
      : [];
    const ids = [...new Set(db.prepare('SELECT id FROM jeunes').all().map((x) => x.id))];
    const q = c.recherche.toLowerCase();
    const apprentis = [];
    for (const id of ids) {
      const j = db.prepare('SELECT id, nom, prenom, sorti_le FROM jeunes WHERE id = ?').get(id);
      const cid = classeDe(id, ref);
      if (c.classe_ids.length && !c.classe_ids.includes(cid)) continue;
      if (c.jeune_ids.length && !c.jeune_ids.includes(id)) continue;
      if (q && !`${j.nom} ${j.prenom}`.toLowerCase().includes(q)) continue;
      const mine = evts.filter((e) => e.jeune_id === id);
      const sa = sanctions.filter((s) => s.jeune_id === id);
      const ab = mine.filter((e) => e.type === 'absence');
      const re = mine.filter((e) => e.type === 'retard');
      // sans filtre explicite sur l'apprenti : on ne garde que ceux qui ont quelque chose à afficher
      if (!c.jeune_ids.length && !mine.length && !sa.length && !c.classe_ids.length && !q) continue;
      apprentis.push({
        id, nom: j.nom, prenom: j.prenom, classe_id: cid, classe_code: classes.get(cid)?.code ?? '',
        absences: detail(ab), retards: detail(re), evenements: mine, sanctions: sa,
      });
    }
    apprentis.sort((a, b) => a.classe_code.localeCompare(b.classe_code) || a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr'));
    const dans = new Set(apprentis.map((a) => a.id));
    // séries mensuelles (graphiques en barres / courbes) et par classe
    const parMois = {};
    const parClasse = {};
    const parPalier = {};
    for (const a of apprentis) {
      const k = a.classe_code || '—';
      const pc = (parClasse[k] ??= { classe: k, apprentis: 0, absences: 0, min_absences: 0, retards: 0, min_retards: 0, sanctions: 0 });
      pc.apprentis++;
      for (const e of a.evenements) {
        const m = (parMois[mois(e.date_debut)] ??= { mois: mois(e.date_debut), absences: 0, min_absences: 0, retards: 0, min_retards: 0, sanctions: 0 });
        if (e.type === 'absence') { m.absences++; m.min_absences += e.duree_minutes ?? 0; pc.absences++; pc.min_absences += e.duree_minutes ?? 0; }
        else { m.retards++; m.min_retards += e.duree_minutes ?? 0; pc.retards++; pc.min_retards += e.duree_minutes ?? 0; }
      }
      for (const s of a.sanctions) {
        const d = s.date_decision ?? s.date_faits;
        (parMois[mois(d)] ??= { mois: mois(d), absences: 0, min_absences: 0, retards: 0, min_retards: 0, sanctions: 0 }).sanctions++;
        pc.sanctions++;
        parPalier[s.palier ?? 'Non précisé'] = (parPalier[s.palier ?? 'Non précisé'] ?? 0) + 1;
      }
    }
    const tous = apprentis.flatMap((a) => a.evenements);
    const totaux = {
      apprentis: apprentis.length,
      absences: detail(tous.filter((e) => e.type === 'absence')),
      retards: detail(tous.filter((e) => e.type === 'retard')),
      sanctions: apprentis.reduce((t, a) => t + a.sanctions.length, 0),
    };
    const empreinte = crypto.createHash('sha256').update(JSON.stringify({ c, apprentis: apprentis.map((a) => [a.id, a.classe_id, a.evenements, a.sanctions]) })).digest('hex').slice(0, 16);
    void dans;
    return {
      criteres: c, genere_le: maintenant(), empreinte, totaux, apprentis,
      par_mois: Object.values(parMois).sort((a, b) => a.mois.localeCompare(b.mois)),
      par_classe: Object.values(parClasse).sort((a, b) => a.classe.localeCompare(b.classe)),
      par_palier: Object.entries(parPalier).map(([palier, nb]) => ({ palier, nb })),
      etablissement: h.etablissement?.() ?? null,
    };
  }

  // Contrôle de confidentialité avant tout envoi. Retourne les erreurs bloquantes et les avertissements à confirmer.
  // arg : { jeune_ids (apprentis du document), domaines, destinataires: [adresse], sanctions_autorisees_a: [adresse], confirmes: [adresse], date }
  function controler(arg) {
    const domaines = (arg.domaines ?? []).filter((d) => DOMAINES.includes(d));
    const jeunes = [...new Set((arg.jeune_ids ?? []).map(Number))];
    const dest = [...new Set((arg.destinataires ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
    const autorises = new Set((arg.sanctions_autorisees_a ?? []).map((x) => String(x).trim().toLowerCase()));
    const confirmes = new Set((arg.confirmes ?? []).map((x) => String(x).trim().toLowerCase()));
    const date = dateValide(arg.date) ? arg.date : aujourdhui();
    const erreurs = [];
    const avertissements = [];
    const verifies = [];
    if (!dest.length) erreurs.push('Aucun destinataire.');
    if (!jeunes.length) erreurs.push('Aucun apprenti dans le document.');
    const EMAIL = /^[^\s@;,<>"]+@[^\s@;,<>"]+\.[^\s@;,<>"]+$/;
    const sanc = domaines.includes('sanctions');
    for (const adr of dest) {
      if (!EMAIL.test(adr)) { erreurs.push(`Adresse invalide : ${adr}`); continue; }
      // à qui appartient l'adresse ?
      let nature = 'libre';
      let proprietaires = new Set();
      for (const id of jeunes) {
        for (const d of destinatairesDe(id, date)) {
          if ((d.email ?? '').toLowerCase() !== adr) continue;
          proprietaires.add(id);
          nature = d.role === 'pp' ? 'pp' : 'entreprise';
        }
      }
      // adresse d'entreprise d'un AUTRE apprenti : jamais autorisée sur ce document
      const autre = db.prepare(
        `SELECT 1 FROM entreprises WHERE lower(email) = ? UNION SELECT 1 FROM contacts WHERE lower(email) = ? UNION SELECT 1 FROM jeune_entreprises WHERE lower(maitre_email) = ?`
      ).get(adr, adr, adr);
      if (nature === 'entreprise') {
        if (jeunes.length > 1) erreurs.push(`${adr} : une entreprise ne reçoit que les données de son propre apprenti (document collectif refusé).`);
        else if (proprietaires.size !== 1) erreurs.push(`${adr} : cette entreprise n'est pas rattachée à l'apprenti du document.`);
      } else if (nature === 'libre') {
        if (autre) erreurs.push(`${adr} : adresse d'une entreprise ou d'un maître d'apprentissage qui n'est pas celui de l'apprenti du document.`);
        else if (!confirmes.has(adr)) avertissements.push(`${adr} : adresse libre, non rattachée à l'apprenti. À confirmer.`);
      }
      if (sanc && !autorises.has(adr)) erreurs.push(`${adr} : les sanctions ne sont envoyées qu'aux destinataires expressément autorisés. Retirez les sanctions ou autorisez ce destinataire.`);
      verifies.push({ adresse: adr, nature });
    }
    return { ok: erreurs.length === 0 && avertissements.length === 0, erreurs, avertissements, verifies };
  }

  const actions = {
    'recap:calculer': (f) => calculer(f),

    // Compare une extraction enregistrée avec les données actuelles : le résultat affiché n'est jamais présenté comme à jour s'il a changé.
    'recap:verifier': ({ extraction_id }) => {
      const x = db.prepare('SELECT * FROM recap_extractions WHERE id = ?').get(Number(extraction_id));
      if (!x) throw new Error('Extraction introuvable.');
      const r = calculer(JSON.parse(x.criteres));
      return { a_jour: r.empreinte === x.empreinte, empreinte_actuelle: r.empreinte };
    },

    'recap:controler': (arg) => controler(arg),

    'recap:extraction:enregistrer': ({ resultat, utilisateur, usage }) => {
      const r = resultat;
      const info = db.prepare(
        'INSERT INTO recap_extractions (date_extraction, utilisateur, debut, fin, domaines, criteres, empreinte, nb_apprentis, usage) VALUES (?,?,?,?,?,?,?,?,?)'
      ).run(maintenant(), utilisateur ?? null, r.criteres.debut, r.criteres.fin, r.criteres.domaines.join(','), JSON.stringify(r.criteres), r.empreinte, r.totaux.apprentis, usage ?? 'tableau');
      return Number(info.lastInsertRowid);
    },

    // Enregistre une transmission après un nouveau contrôle côté serveur : un envoi refusé n'est jamais journalisé comme envoyé.
    'recap:transmission:enregistrer': (arg) => {
      const c = controler(arg);
      if (c.erreurs.length) throw new Error(c.erreurs.join(' '));
      const info = db.prepare(
        `INSERT INTO recap_transmissions (extraction_id, date_envoi, utilisateur, jeune_id, destinataires, type_document, domaines, avec_sanctions, pieces, objet)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).run(arg.extraction_id ? Number(arg.extraction_id) : null, maintenant(), arg.utilisateur ?? null, (arg.jeune_ids ?? []).length === 1 ? Number(arg.jeune_ids[0]) : null,
        JSON.stringify(arg.destinataires ?? []), arg.type_document ?? 'pdf', (arg.domaines ?? []).join(','), (arg.domaines ?? []).includes('sanctions') ? 1 : 0,
        JSON.stringify(arg.pieces ?? []), arg.objet ?? null);
      return Number(info.lastInsertRowid);
    },

    'recap:historique': () => ({
      extractions: db.prepare('SELECT * FROM recap_extractions ORDER BY id DESC LIMIT 200').all(),
      transmissions: db.prepare(
        `SELECT t.*, j.nom AS jeune_nom, j.prenom AS jeune_prenom FROM recap_transmissions t LEFT JOIN jeunes j ON j.id = t.jeune_id ORDER BY t.id DESC LIMIT 200`
      ).all(),
    }),
  };
  return { actions, calculer, controler };
}
module.exports = { creerRecapitulatif };
