// Professeurs principaux : répertoire (fiches) et affectations datées par classe et année scolaire.
// Règles : une classe a au plus un professeur principal à une date donnée ; un professeur peut suivre plusieurs classes ;
// un changement (rentrée ou remplacement en cours d'année) clôt l'affectation précédente sans l'effacer.

const EMAIL = /^[^\s@;,<>"]+@[^\s@;,<>"]+\.[^\s@;,<>"]+$/;

// Année scolaire d'une date : du 1er septembre au 31 août.
function anneeScolaire(iso) {
  const a = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m >= 9 ? `${a}-${a + 1}` : `${a - 1}-${a}`;
}
const anneeValide = (s) => typeof s === 'string' && /^\d{4}-\d{4}$/.test(s) && Number(s.slice(5)) === Number(s.slice(0, 4)) + 1;
const debutAnnee = (annee) => `${annee.slice(0, 4)}-09-01`;
const finAnnee = (annee) => `${annee.slice(5)}-08-31`;
const veille = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const aujourdhui = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const jourMois = (iso) => iso.split('-').reverse().join('/');
// « BTS Gestion de la PME — 1ère année » → « BTS Gestion de la PME »
const formationDe = (libelle) => String(libelle).split(' — ')[0].trim();

function creerProfesseurs(db, h) {
  const { vide, dateValide, cle } = h;

  // Fin effective d'une affectation : sa date de fin, sinon la fin de son année scolaire.
  const FIN = "COALESCE(a.date_fin, substr(a.annee_scolaire, 6, 4) || '-08-31')";

  function ppDe(classeId, date) {
    const d = dateValide(date) ? date : aujourdhui();
    return db.prepare(
      `SELECT a.id AS affectation_id, a.professeur_id, p.nom, p.prenom, p.email, p.telephone, p.actif
       FROM pp_affectations a JOIN professeurs p ON p.id = a.professeur_id
       WHERE a.classe_id = ? AND a.date_debut <= ? AND ${FIN} >= ?
       ORDER BY a.date_debut DESC LIMIT 1`
    ).get(Number(classeId), d, d) ?? null;
  }

  function verifierProf(p) {
    const nom = vide(p.nom);
    const prenom = vide(p.prenom);
    if (!nom || !prenom) throw new Error('Le nom et le prénom sont obligatoires.');
    const email = vide(p.email);
    if (email && !EMAIL.test(email)) throw new Error(`Adresse e-mail invalide : ${email}`);
    const id = p.id ? Number(p.id) : 0;
    if (email) {
      const meme = db.prepare('SELECT nom, prenom FROM professeurs WHERE lower(email) = lower(?) AND id <> ?').get(email, id);
      if (meme) throw new Error(`Cette adresse e-mail est déjà celle de ${meme.prenom} ${meme.nom} : une seule fiche par professeur.`);
    }
    if (!p.confirmer_homonyme) {
      const homonyme = db.prepare('SELECT nom, prenom FROM professeurs WHERE id <> ?').all(id)
        .find((x) => cle(x.nom) === cle(nom) && cle(x.prenom) === cle(prenom));
      if (homonyme) return { a_confirmer: `Une fiche existe déjà pour ${homonyme.prenom} ${homonyme.nom}. S'agit-il bien d'une autre personne (homonyme) ?` };
    }
    return { id, nom, prenom, email, telephone: vide(p.telephone), fonction: vide(p.fonction), observations: vide(p.observations), actif: p.actif === false || p.actif === 0 ? 0 : 1 };
  }

  const enCours = (profId) => db.prepare(
    `SELECT a.id, c.code FROM pp_affectations a JOIN classes c ON c.id = a.classe_id
     WHERE a.professeur_id = ? AND ${FIN} >= ?`
  ).all(Number(profId), aujourdhui());

  const actions = {
    'profs:list': (f = {}) => {
      const profs = db.prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM pp_affectations a WHERE a.professeur_id = p.id) AS nb_affectations
         FROM professeurs p ORDER BY p.nom COLLATE NOCASE, p.prenom COLLATE NOCASE`
      ).all();
      const auj = aujourdhui();
      const classesDe = db.prepare(
        `SELECT c.code, a.annee_scolaire FROM pp_affectations a JOIN classes c ON c.id = a.classe_id
         WHERE a.professeur_id = ? AND a.date_debut <= ? AND ${FIN} >= ? ORDER BY c.ordre`
      );
      const q = f.recherche ? cle(f.recherche) : '';
      return profs
        .map((p) => ({ ...p, classes_actuelles: classesDe.all(p.id, auj, auj).map((x) => x.code) }))
        .filter((p) => !q || cle(`${p.nom} ${p.prenom} ${p.prenom} ${p.nom} ${p.classes_actuelles.join(' ')} ${p.fonction ?? ''}`).includes(q));
    },

    'profs:save': (p) => {
      const v = verifierProf(p);
      if (v.a_confirmer) return v;
      if (v.id) {
        if (!v.actif && enCours(v.id).length) throw new Error('Ce professeur est encore professeur principal (affectation en cours) : terminez ou remplacez d\'abord ses affectations.');
        db.prepare('UPDATE professeurs SET nom=?, prenom=?, email=?, telephone=?, fonction=?, observations=?, actif=? WHERE id=?')
          .run(v.nom, v.prenom, v.email, v.telephone, v.fonction, v.observations, v.actif, v.id);
        return v.id;
      }
      return Number(db.prepare('INSERT INTO professeurs (nom, prenom, email, telephone, fonction, observations, actif) VALUES (?,?,?,?,?,?,?)')
        .run(v.nom, v.prenom, v.email, v.telephone, v.fonction, v.observations, v.actif).lastInsertRowid);
    },

    // Suppression réservée aux fiches jamais utilisées : sinon on désactive, pour garder l'historique.
    'profs:delete': (id) => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM pp_affectations WHERE professeur_id = ?').get(Number(id)).n;
      if (n) throw new Error(`Ce professeur a ${n} affectation(s) dans l'historique : la fiche ne peut pas être supprimée. Désactivez-la plutôt.`);
      db.prepare('DELETE FROM professeurs WHERE id = ?').run(Number(id));
      return true;
    },

    'pp:list': (f = {}) => {
      const auj = aujourdhui();
      const where = [];
      const args = [];
      if (f.annee) { where.push('a.annee_scolaire = ?'); args.push(f.annee); }
      if (f.classe_id) { where.push('a.classe_id = ?'); args.push(Number(f.classe_id)); }
      if (f.professeur_id) { where.push('a.professeur_id = ?'); args.push(Number(f.professeur_id)); }
      if (!f.historique) { where.push(`${FIN} >= ?`); args.push(auj); }
      const lignes = db.prepare(
        `SELECT a.*, ${FIN} AS fin_effective, c.code AS classe_code, c.libelle AS classe_libelle, c.ordre,
                p.nom, p.prenom, p.email, p.telephone, p.actif
         FROM pp_affectations a JOIN classes c ON c.id = a.classe_id JOIN professeurs p ON p.id = a.professeur_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY a.annee_scolaire DESC, c.ordre, a.date_debut DESC`
      ).all(...args);
      const q = f.recherche ? cle(f.recherche) : '';
      return lignes
        .map((l) => ({ ...l, formation: formationDe(l.classe_libelle), en_cours: l.date_debut <= auj && l.fin_effective >= auj, a_venir: l.date_debut > auj }))
        .filter((l) => !f.formation || l.formation === f.formation)
        .filter((l) => !q || cle(`${l.nom} ${l.prenom} ${l.prenom} ${l.nom} ${l.classe_code} ${l.formation}`).includes(q));
    },

    // Désigne un professeur principal. Si la classe en a déjà un sur la période, il faut demander le remplacement :
    // l'ancienne affectation est alors close la veille (rien n'est effacé).
    'pp:affecter': (a) => {
      const classeId = Number(a.classe_id);
      const profId = Number(a.professeur_id);
      const classe = db.prepare('SELECT code FROM classes WHERE id = ?').get(classeId);
      if (!classe) throw new Error('Choisissez une classe.');
      const prof = db.prepare('SELECT * FROM professeurs WHERE id = ?').get(profId);
      if (!prof) throw new Error('Choisissez un professeur principal.');
      if (!prof.actif) throw new Error(`La fiche de ${prof.prenom} ${prof.nom} est inactive : réactivez-la avant de l'affecter.`);
      const annee = a.annee_scolaire;
      if (!anneeValide(annee)) throw new Error('Année scolaire invalide (format 2026-2027).');
      const debut = a.date_debut || debutAnnee(annee);
      if (!dateValide(debut)) throw new Error('Date de début invalide.');
      if (anneeScolaire(debut) !== annee) throw new Error(`La date de début doit être comprise dans l'année scolaire ${annee} (du 01/09 au 31/08).`);
      const fin = vide(a.date_fin);
      if (fin && (!dateValide(fin) || fin < debut || fin > finAnnee(annee))) throw new Error(`Date de fin invalide : entre le ${jourMois(debut)} et le ${jourMois(finAnnee(annee))}.`);
      const finEff = fin ?? finAnnee(annee);

      const chevauchent = db.prepare(
        `SELECT a.*, ${FIN} AS fin_effective, p.nom, p.prenom FROM pp_affectations a JOIN professeurs p ON p.id = a.professeur_id
         WHERE a.classe_id = ? AND a.date_debut <= ? AND ${FIN} >= ? ORDER BY a.date_debut`
      ).all(classeId, finEff, debut);

      if (chevauchent.some((x) => x.professeur_id === profId && x.date_debut <= debut)) {
        throw new Error(`${prof.prenom} ${prof.nom} est déjà professeur principal de ${classe.code} à cette date.`);
      }
      if (chevauchent.length) {
        const x = chevauchent[0];
        if (!a.remplacer) {
          return { a_confirmer: `${classe.code} a déjà un professeur principal sur cette période : ${x.prenom} ${x.nom} (depuis le ${jourMois(x.date_debut)}). Le remplacer par ${prof.prenom} ${prof.nom} à partir du ${jourMois(debut)} ? L'ancienne affectation est conservée dans l'historique.` };
        }
        // Remplacement possible seulement pour une affectation commencée avant la nouvelle, et une seule.
        if (chevauchent.length > 1 || x.date_debut >= debut) {
          throw new Error(`Impossible de remplacer automatiquement : une autre affectation de ${classe.code} commence le ${jourMois(x.date_debut)}. Corrigez d'abord l'historique.`);
        }
        if (x.fin_effective > finEff) throw new Error('Le remplaçant doit couvrir au moins jusqu\'à la fin de l\'affectation remplacée : laissez la date de fin vide.');
      }

      const remplace = chevauchent[0];
      db.exec('BEGIN');
      try {
        if (remplace) {
          db.prepare("UPDATE pp_affectations SET date_fin = ?, note = trim(COALESCE(note || ' ', '') || ?) WHERE id = ?")
            .run(veille(debut), `Remplacé(e) par ${prof.prenom} ${prof.nom} le ${jourMois(debut)}.`, remplace.id);
        }
        const note = remplace ? `Remplace ${remplace.prenom} ${remplace.nom}.${vide(a.note) ? ` ${vide(a.note)}` : ''}` : vide(a.note);
        const id = db.prepare('INSERT INTO pp_affectations (classe_id, professeur_id, annee_scolaire, date_debut, date_fin, note, cree_le) VALUES (?,?,?,?,?,?,?)')
          .run(classeId, profId, annee, debut, fin, note, new Date().toISOString()).lastInsertRowid;
        db.exec('COMMIT');
        return Number(id);
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    // Termine une affectation à une date (départ sans remplaçant connu) : l'historique est conservé.
    'pp:terminer': ({ id, date_fin }) => {
      const x = db.prepare('SELECT * FROM pp_affectations WHERE id = ?').get(Number(id));
      if (!x) throw new Error('Affectation introuvable.');
      if (!dateValide(date_fin) || date_fin < x.date_debut || date_fin > finAnnee(x.annee_scolaire)) {
        throw new Error(`Date de fin invalide : entre le ${jourMois(x.date_debut)} et le ${jourMois(finAnnee(x.annee_scolaire))}.`);
      }
      db.prepare('UPDATE pp_affectations SET date_fin = ? WHERE id = ?').run(date_fin, x.id);
      return true;
    },

    // Effacement réservé aux erreurs de saisie (mauvais professeur, mauvaise classe).
    'pp:supprimer': (id) => {
      db.prepare('DELETE FROM pp_affectations WHERE id = ?').run(Number(id));
      return true;
    },

    'pp:de': ({ classe_id, date }) => ppDe(classe_id, date),

    // Points d'attention pour une année scolaire.
    'pp:alertes': (annee) => {
      const an = anneeValide(annee) ? annee : anneeScolaire(aujourdhui());
      const auj = aujourdhui();
      const ref = anneeScolaire(auj) === an ? auj : debutAnnee(an);
      const classes = db.prepare('SELECT id, code FROM classes ORDER BY ordre, id').all();
      const sans_pp = classes.filter((c) => !ppDe(c.id, ref)).map((c) => c.code);
      const sans_email = db.prepare(
        `SELECT DISTINCT p.prenom || ' ' || p.nom AS nom FROM pp_affectations a JOIN professeurs p ON p.id = a.professeur_id
         WHERE a.annee_scolaire = ? AND (p.email IS NULL OR p.email = '')`
      ).all(an).map((x) => x.nom);
      const inactifs = db.prepare(
        `SELECT DISTINCT p.prenom || ' ' || p.nom AS nom FROM pp_affectations a JOIN professeurs p ON p.id = a.professeur_id
         WHERE p.actif = 0 AND ${FIN} >= ?`
      ).all(auj).map((x) => x.nom);
      return { annee: an, date_reference: ref, sans_pp, sans_email, inactifs };
    },

    'pp:annees': () => {
      const courante = anneeScolaire(aujourdhui());
      const a = Number(courante.slice(0, 4));
      const vues = db.prepare('SELECT DISTINCT annee_scolaire AS x FROM pp_affectations').all().map((r) => r.x);
      return [...new Set([...vues, `${a - 1}-${a}`, courante, `${a + 1}-${a + 2}`])].sort().reverse();
    },
  };

  return { actions, ppDe };
}

module.exports = { creerProfesseurs, anneeScolaire, formationDe, EMAIL };
