// Base de données locale (SQLite intégré à Node, aucun module natif à compiler).
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');

const CALENDRIERS = require('./calendriers-2026-2027.cjs');
const { creerRattrapages } = require('./rattrapages.cjs');
const { creerProfesseurs } = require('./professeurs.cjs');

// Une ligne par jour ouvré, déduite des plages du calendrier fourni par le centre de formation.
function sqlCalendriers() {
  const q = (t) => `'${String(t).replace(/'/g, "''")}'`;
  const TYPES = { c: 'centre', e: 'entreprise', a: 'autre' };
  const lignes = [];
  for (const [code, { plages, libelles }] of Object.entries(CALENDRIERS)) {
    for (const [debut, fin, t] of plages) {
      for (let d = new Date(`${debut}T00:00:00Z`); d.toISOString().slice(0, 10) <= fin; d.setUTCDate(d.getUTCDate() + 1)) {
        if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
        const iso = d.toISOString().slice(0, 10);
        lignes.push(
          `INSERT INTO calendrier_jours (classe_id, date, type, libelle) SELECT id, ${q(iso)}, ${q(TYPES[t])}, ${libelles[iso] ? q(libelles[iso]) : 'NULL'} FROM classes WHERE code = ${q(code)};`
        );
      }
    }
  }
  return lignes.join('\n');
}

const MIGRATIONS = [
  // v1 : schéma initial
  `
  CREATE TABLE classes (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    libelle TEXT NOT NULL
  );
  CREATE TABLE entreprises (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL,
    adresse TEXT,
    telephone TEXT,
    email TEXT
  );
  CREATE TABLE jeunes (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL,
    prenom TEXT NOT NULL,
    email TEXT,
    telephone TEXT,
    classe_id INTEGER NOT NULL REFERENCES classes(id),
    entreprise_id INTEGER REFERENCES entreprises(id) ON DELETE SET NULL,
    maitre_nom TEXT,
    maitre_telephone TEXT,
    maitre_email TEXT
  );
  CREATE TABLE motifs (
    id INTEGER PRIMARY KEY,
    libelle TEXT NOT NULL,
    statut TEXT NOT NULL CHECK (statut IN ('recevable', 'irrecevable'))
  );
  CREATE TABLE evenements (
    id INTEGER PRIMARY KEY,
    jeune_id INTEGER NOT NULL REFERENCES jeunes(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('absence', 'retard')),
    date_debut TEXT NOT NULL,
    date_fin TEXT,
    duree_minutes INTEGER,
    motif_id INTEGER REFERENCES motifs(id) ON DELETE SET NULL,
    observations TEXT,
    mail_copie TEXT
  );
  CREATE TABLE pieces_jointes (
    id INTEGER PRIMARY KEY,
    evenement_id INTEGER NOT NULL REFERENCES evenements(id) ON DELETE CASCADE,
    nom_fichier TEXT NOT NULL,
    chemin TEXT NOT NULL
  );
  CREATE TABLE rattrapages (
    id INTEGER PRIMARY KEY,
    jeune_id INTEGER NOT NULL REFERENCES jeunes(id) ON DELETE CASCADE,
    heures_a_effectuer REAL NOT NULL,
    heures_effectuees REAL NOT NULL DEFAULT 0,
    statut TEXT NOT NULL DEFAULT 'a_faire' CHECK (statut IN ('a_faire', 'partiel', 'total')),
    observations TEXT
  );
  CREATE TABLE rattrapage_creneaux (
    id INTEGER PRIMARY KEY,
    rattrapage_id INTEGER NOT NULL REFERENCES rattrapages(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    heure_debut TEXT,
    heure_fin TEXT,
    lieu TEXT,
    effectue INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE periodes (
    id INTEGER PRIMARY KEY,
    classe_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('ecole', 'entreprise', 'vacances', 'ferie')),
    libelle TEXT,
    date_debut TEXT NOT NULL,
    date_fin TEXT NOT NULL
  );
  INSERT INTO classes (code, libelle) VALUES
    ('GPME', 'BTS Gestion de la PME'),
    ('MCO', 'BTS Management Commercial Opérationnel'),
    ('NDRC', 'BTS Négociation et Digitalisation de la Relation Client'),
    ('LCVM', 'Licence LCVM');
  INSERT INTO motifs (libelle, statut) VALUES
    ('Arrêt maladie', 'recevable'),
    ('Convocation officielle', 'recevable'),
    ('Événement familial', 'recevable'),
    ('Retenu en entreprise', 'irrecevable'),
    ('Problème de transport', 'irrecevable'),
    ('Sans justificatif', 'irrecevable');
  `,
  // v2 : réglages (mot de passe)
  `CREATE TABLE reglages (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL);`,
  // v3 : un motif ne peut être créé qu'une seule fois (sans tenir compte des majuscules)
  `CREATE UNIQUE INDEX motifs_libelle_unique ON motifs (libelle COLLATE NOCASE);`,
  // v4 : pièces jointes stockées dans la base (une sauvegarde = un seul fichier), suivi des notifications
  `
  DROP TABLE pieces_jointes;
  CREATE TABLE pieces_jointes (
    id INTEGER PRIMARY KEY,
    evenement_id INTEGER NOT NULL REFERENCES evenements(id) ON DELETE CASCADE,
    nom_fichier TEXT NOT NULL,
    taille INTEGER NOT NULL,
    contenu BLOB NOT NULL
  );
  CREATE INDEX pieces_evenement ON pieces_jointes (evenement_id);
  ALTER TABLE evenements ADD COLUMN notifie_le TEXT;
  CREATE INDEX evenements_jeune_date ON evenements (jeune_id, date_debut);
  `,
  // v5 : une classe par année (BTS 1ère et 2ème année, licence 3ème année) ; créneaux horaires des absences
  `
  ALTER TABLE classes ADD COLUMN ordre INTEGER NOT NULL DEFAULT 0;
  UPDATE classes SET code = 'GPME 1ère année', libelle = 'BTS Gestion de la PME — 1ère année', ordre = 10 WHERE code = 'GPME';
  UPDATE classes SET code = 'MCO 1ère année', libelle = 'BTS Management Commercial Opérationnel — 1ère année', ordre = 20 WHERE code = 'MCO';
  UPDATE classes SET code = 'NDRC 1ère année', libelle = 'BTS Négociation et Digitalisation de la Relation Client — 1ère année', ordre = 30 WHERE code = 'NDRC';
  UPDATE classes SET code = 'LCVM 3ème année', libelle = 'Licence LCVM — 3ème année', ordre = 40 WHERE code = 'LCVM';
  INSERT INTO classes (code, libelle, ordre) VALUES
    ('GPME 2ème année', 'BTS Gestion de la PME — 2ème année', 11),
    ('MCO 2ème année', 'BTS Management Commercial Opérationnel — 2ème année', 21),
    ('NDRC 2ème année', 'BTS Négociation et Digitalisation de la Relation Client — 2ème année', 31);
  CREATE TABLE creneaux (
    id INTEGER PRIMARY KEY,
    evenement_id INTEGER NOT NULL REFERENCES evenements(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    heure_debut TEXT NOT NULL,
    heure_fin TEXT NOT NULL,
    duree_minutes INTEGER NOT NULL
  );
  CREATE INDEX creneaux_evenement ON creneaux (evenement_id);
  `,
  // v6 : interlocuteurs supplémentaires d'une entreprise (RH, tutrice, comptabilité…)
  `
  CREATE TABLE contacts (
    id INTEGER PRIMARY KEY,
    entreprise_id INTEGER NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    fonction TEXT,
    telephone TEXT,
    email TEXT
  );
  CREATE INDEX contacts_entreprise ON contacts (entreprise_id);
  `,
  // v7 : calendrier d'alternance (centre de formation / entreprise / autre) par classe
  `
  CREATE TABLE calendrier_jours (
    classe_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('centre', 'entreprise', 'autre')),
    libelle TEXT,
    PRIMARY KEY (classe_id, date)
  );
  ${sqlCalendriers()}
  `,
  // v8 : nouvelle formation DTS IMRT (trois années)
  `
  INSERT INTO classes (code, libelle, ordre) VALUES
    ('DTS IMRT 1ère année', 'DTS Imagerie Médicale et Radiologie Thérapeutique — 1ère année', 50),
    ('DTS IMRT 2ème année', 'DTS Imagerie Médicale et Radiologie Thérapeutique — 2ème année', 51),
    ('DTS IMRT 3ème année', 'DTS Imagerie Médicale et Radiologie Thérapeutique — 3ème année', 52);
  `,
  // v9 : rattrapages d'heures (séances, justificatifs signés, historique) + adresse de l'apprenti pour les convocations.
  // Les anciennes tables rattrapages / rattrapage_creneaux n'ont jamais été utilisées : elles sont remplacées.
  `
  ALTER TABLE jeunes ADD COLUMN civilite TEXT;
  ALTER TABLE jeunes ADD COLUMN adresse TEXT;
  ALTER TABLE jeunes ADD COLUMN code_postal TEXT;
  ALTER TABLE jeunes ADD COLUMN ville TEXT;
  DROP TABLE rattrapage_creneaux;
  DROP TABLE rattrapages;
  CREATE TABLE rattrapage_seances (
    id INTEGER PRIMARY KEY,
    jeune_id INTEGER NOT NULL REFERENCES jeunes(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    heure_debut TEXT NOT NULL,
    heure_fin TEXT NOT NULL,
    duree_minutes INTEGER NOT NULL,
    salle TEXT,
    periode_debut TEXT,
    periode_fin TEXT,
    statut TEXT NOT NULL DEFAULT 'programmee' CHECK (statut IN ('programmee', 'effectuee', 'non_effectuee')),
    duree_validee_minutes INTEGER,
    valide_le TEXT,
    convocation_le TEXT,
    observations TEXT
  );
  CREATE INDEX seances_jeune ON rattrapage_seances (jeune_id, date);
  CREATE TABLE rattrapage_pieces (
    id INTEGER PRIMARY KEY,
    seance_id INTEGER NOT NULL REFERENCES rattrapage_seances(id) ON DELETE CASCADE,
    nom_fichier TEXT NOT NULL,
    taille INTEGER NOT NULL,
    contenu BLOB NOT NULL,
    ajoute_le TEXT
  );
  CREATE INDEX rattrapage_pieces_seance ON rattrapage_pieces (seance_id);
  CREATE TABLE rattrapage_historique (
    id INTEGER PRIMARY KEY,
    jeune_id INTEGER NOT NULL REFERENCES jeunes(id) ON DELETE CASCADE,
    seance_id INTEGER,
    quand TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT
  );
  CREATE INDEX rattrapage_historique_jeune ON rattrapage_historique (jeune_id, id);
  `,
  // v10 : professeurs principaux (répertoire) et leurs affectations datées par classe et année scolaire
  `
  CREATE TABLE professeurs (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL,
    prenom TEXT NOT NULL,
    email TEXT,
    telephone TEXT,
    fonction TEXT,
    observations TEXT,
    actif INTEGER NOT NULL DEFAULT 1 CHECK (actif IN (0, 1))
  );
  CREATE TABLE pp_affectations (
    id INTEGER PRIMARY KEY,
    classe_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    professeur_id INTEGER NOT NULL REFERENCES professeurs(id) ON DELETE RESTRICT,
    annee_scolaire TEXT NOT NULL,
    date_debut TEXT NOT NULL,
    date_fin TEXT,
    note TEXT,
    cree_le TEXT NOT NULL
  );
  CREATE INDEX pp_affectations_classe ON pp_affectations (classe_id, date_debut);
  CREATE INDEX pp_affectations_prof ON pp_affectations (professeur_id);
  `,
];

// Horaires proposés par défaut pour une journée (modifiables dans Paramètres).
const HORAIRES_DEFAUT = { debut: '08:30', pause_debut: '12:30', pause_fin: '14:00', fin: '18:00' };

const TAILLE_MAX_PIECE = 10 * 1024 * 1024;

const heureValide = (h) => typeof h === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
const enMinutes = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const jourMois = (iso) => iso.split('-').reverse().join('/');

function dateValide(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function vide(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// Clé de comparaison : sans majuscules, sans accents, espaces uniformisés.
function cle(texte) {
  return String(texte).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function ouvrir(chemin) {
  const db = new DatabaseSync(chemin);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  let version = db.prepare('PRAGMA user_version').get().user_version;
  // Données réelles déjà saisies : avant toute mise à niveau, copie de secours à côté de la base.
  if (version > 0 && version < MIGRATIONS.length && chemin !== ':memory:') {
    const copie = `${chemin}.avant-mise-a-jour-v${version}.bak`;
    try {
      if (fs.existsSync(copie)) fs.rmSync(copie);
      db.exec(`VACUUM INTO '${copie.replace(/'/g, "''")}'`);
    } catch {
      // la copie est une sécurité supplémentaire : son échec ne doit pas empêcher d'ouvrir l'application
    }
  }
  for (; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  function avecCreneaux(rows) {
    if (!rows.length) return rows;
    const ids = rows.map((r) => r.id);
    const lignes = db.prepare(
      `SELECT * FROM creneaux WHERE evenement_id IN (${ids.map(() => '?').join(',')}) ORDER BY date, heure_debut`
    ).all(...ids);
    const parEvenement = new Map();
    for (const l of lignes) {
      if (!parEvenement.has(l.evenement_id)) parEvenement.set(l.evenement_id, []);
      parEvenement.get(l.evenement_id).push(l);
    }
    return rows.map((r) => ({ ...r, creneaux: parEvenement.get(r.id) ?? [] }));
  }

  function destinatairesDe(jeuneId, date) {
    const j = db.prepare(
      `SELECT j.classe_id, j.maitre_nom, j.maitre_telephone, j.maitre_email, j.entreprise_id, e.nom AS entreprise_nom,
              e.telephone AS entreprise_telephone, e.email AS entreprise_email
       FROM jeunes j LEFT JOIN entreprises e ON e.id = j.entreprise_id WHERE j.id = ?`
    ).get(jeuneId);
    if (!j) return [];
    const liste = [];
    if (j.maitre_email) liste.push({ cle: 'maitre', libelle: `Maître d'apprentissage${j.maitre_nom ? ` : ${j.maitre_nom}` : ''}`, email: j.maitre_email, telephone: j.maitre_telephone });
    if (j.entreprise_email) liste.push({ cle: 'entreprise', libelle: `Entreprise : ${j.entreprise_nom}`, email: j.entreprise_email, telephone: j.entreprise_telephone });
    if (j.entreprise_id) {
      for (const c of db.prepare('SELECT * FROM contacts WHERE entreprise_id = ? ORDER BY nom COLLATE NOCASE').all(j.entreprise_id)) {
        if (c.email) liste.push({ cle: `contact-${c.id}`, libelle: `${c.nom}${c.fonction ? ` (${c.fonction})` : ''}`, email: c.email, telephone: c.telephone });
      }
    }
    // Professeur principal de la classe à la date concernée : proposé, jamais ajouté d'office.
    const pp = professeurs.ppDe(j.classe_id, date);
    if (pp) {
      liste.push({
        cle: `pp-${pp.professeur_id}`, role: 'pp',
        libelle: `Professeur principal : ${pp.prenom} ${pp.nom}${pp.actif ? '' : ' (fiche inactive)'}`,
        email: pp.email ?? '', telephone: pp.telephone,
      });
    }
    return liste;
  }

  const actions = {
    'classes:list': () => db.prepare('SELECT * FROM classes ORDER BY ordre, id').all(),

    'motifs:list': () =>
      db.prepare(
        `SELECT m.*, (SELECT COUNT(*) FROM evenements e WHERE e.motif_id = m.id) AS nb_utilisations
         FROM motifs m ORDER BY m.statut DESC, m.libelle COLLATE NOCASE`
      ).all(),

    'motifs:save': (m) => {
      const libelle = vide(m.libelle);
      if (!libelle) throw new Error('Le libellé du motif est obligatoire.');
      if (m.statut !== 'recevable' && m.statut !== 'irrecevable') {
        throw new Error('Choisissez si le motif est recevable ou irrecevable.');
      }
      const doublon = db.prepare('SELECT id, libelle FROM motifs').all()
        .some((x) => x.id !== m.id && cle(x.libelle) === cle(libelle));
      if (doublon) throw new Error('Ce motif existe déjà.');
      try {
        if (m.id) {
          db.prepare('UPDATE motifs SET libelle=?, statut=? WHERE id=?').run(libelle, m.statut, m.id);
          return m.id;
        }
        return Number(db.prepare('INSERT INTO motifs (libelle, statut) VALUES (?,?)').run(libelle, m.statut).lastInsertRowid);
      } catch (e) {
        if (/UNIQUE/i.test(e.message)) throw new Error('Ce motif existe déjà.');
        throw e;
      }
    },

    'motifs:delete': (id) => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM evenements WHERE motif_id = ?').get(id).n;
      if (n > 0) {
        throw new Error(
          `Ce motif est utilisé par ${n} absence(s) ou retard(s) : il ne peut pas être supprimé. Vous pouvez le modifier à la place.`
        );
      }
      db.prepare('DELETE FROM motifs WHERE id=?').run(id);
      return true;
    },

    'entreprises:list': () =>
      db.prepare(
        `SELECT e.*, (SELECT COUNT(*) FROM jeunes j WHERE j.entreprise_id = e.id) AS nb_jeunes
         FROM entreprises e ORDER BY e.nom COLLATE NOCASE`
      ).all(),

    'entreprises:save': (e) => {
      const nom = vide(e.nom);
      if (!nom) throw new Error("Le nom de l'entreprise est obligatoire.");
      const p = [nom, vide(e.adresse), vide(e.telephone), vide(e.email)];
      if (e.id) {
        db.prepare('UPDATE entreprises SET nom=?, adresse=?, telephone=?, email=? WHERE id=?').run(...p, e.id);
        return e.id;
      }
      return Number(db.prepare('INSERT INTO entreprises (nom, adresse, telephone, email) VALUES (?,?,?,?)').run(...p).lastInsertRowid);
    },

    'contacts:list': (entrepriseId) =>
      db.prepare('SELECT * FROM contacts WHERE entreprise_id = ? ORDER BY nom COLLATE NOCASE').all(Number(entrepriseId)),

    'contacts:save': (c) => {
      const nom = vide(c.nom);
      if (!nom) throw new Error("Le nom de l'interlocuteur est obligatoire.");
      if (!c.entreprise_id || !db.prepare('SELECT 1 FROM entreprises WHERE id = ?').get(Number(c.entreprise_id))) {
        throw new Error("Enregistrez d'abord l'entreprise.");
      }
      const p = [nom, vide(c.fonction), vide(c.telephone), vide(c.email)];
      if (c.id) {
        db.prepare('UPDATE contacts SET nom=?, fonction=?, telephone=?, email=? WHERE id=? AND entreprise_id=?')
          .run(...p, Number(c.id), Number(c.entreprise_id));
        return Number(c.id);
      }
      return Number(
        db.prepare('INSERT INTO contacts (entreprise_id, nom, fonction, telephone, email) VALUES (?,?,?,?,?)')
          .run(Number(c.entreprise_id), ...p).lastInsertRowid
      );
    },

    'contacts:delete': (id) => {
      db.prepare('DELETE FROM contacts WHERE id = ?').run(Number(id));
      return true;
    },

    // Adresses possibles pour écrire à propos d'un apprenti : maître d'apprentissage, entreprise, autres interlocuteurs.
    // arg : id de l'apprenti, ou { jeune_id, date } pour retrouver le professeur principal à cette date
    'destinataires:list': (arg) => (typeof arg === 'object' && arg
      ? destinatairesDe(Number(arg.jeune_id), arg.date)
      : destinatairesDe(Number(arg))),

    'calendrier:annee': (classeId) =>
      db.prepare('SELECT date, type, libelle FROM calendrier_jours WHERE classe_id = ? ORDER BY date').all(Number(classeId)),

    // type null = effacer le jour (ni centre, ni entreprise)
    'calendrier:jour': ({ classe_id, date, type, libelle }) => {
      if (!dateValide(date)) throw new Error('Date invalide.');
      if (!db.prepare('SELECT 1 FROM classes WHERE id = ?').get(Number(classe_id))) throw new Error('Classe introuvable.');
      if (!type) {
        db.prepare('DELETE FROM calendrier_jours WHERE classe_id = ? AND date = ?').run(Number(classe_id), date);
        return true;
      }
      if (!['centre', 'entreprise', 'autre'].includes(type)) throw new Error('Type de journée invalide.');
      db.prepare(
        `INSERT INTO calendrier_jours (classe_id, date, type, libelle) VALUES (?,?,?,?)
         ON CONFLICT(classe_id, date) DO UPDATE SET type = excluded.type, libelle = excluded.libelle`
      ).run(Number(classe_id), date, type, vide(libelle));
      return true;
    },

    'horaires:get': () => {
      const lire = (k, d) => {
        const r = db.prepare('SELECT valeur FROM reglages WHERE cle = ?').get(`horaires_${k}`);
        return r && heureValide(r.valeur) ? r.valeur : d;
      };
      return {
        debut: lire('debut', HORAIRES_DEFAUT.debut), pause_debut: lire('pause_debut', HORAIRES_DEFAUT.pause_debut),
        pause_fin: lire('pause_fin', HORAIRES_DEFAUT.pause_fin), fin: lire('fin', HORAIRES_DEFAUT.fin),
      };
    },

    'horaires:save': (h) => {
      const champs = ['debut', 'pause_debut', 'pause_fin', 'fin'];
      for (const k of champs) if (!heureValide(h?.[k])) throw new Error('Toutes les heures sont obligatoires.');
      if (!(h.debut < h.pause_debut && h.pause_debut < h.pause_fin && h.pause_fin < h.fin)) {
        throw new Error('Les heures doivent se suivre : début de journée, début de pause, fin de pause, fin de journée.');
      }
      const st = db.prepare('INSERT INTO reglages (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur');
      for (const k of champs) st.run(`horaires_${k}`, h[k]);
      return true;
    },

    'entreprises:delete': (id) => {
      db.prepare('DELETE FROM entreprises WHERE id=?').run(id);
      return true;
    },

    'jeunes:list': () =>
      db.prepare(
        `SELECT j.*, c.code AS classe_code, e.nom AS entreprise_nom,
                e.telephone AS entreprise_telephone, e.email AS entreprise_email
         FROM jeunes j
         JOIN classes c ON c.id = j.classe_id
         LEFT JOIN entreprises e ON e.id = j.entreprise_id
         ORDER BY c.ordre, j.nom COLLATE NOCASE, j.prenom COLLATE NOCASE`
      ).all(),

    'jeunes:save': (j) => {
      const nom = vide(j.nom);
      const prenom = vide(j.prenom);
      if (!nom || !prenom) throw new Error('Le nom et le prénom sont obligatoires.');
      if (!j.classe_id) throw new Error('La classe est obligatoire.');
      const p = [
        nom, prenom, vide(j.email), vide(j.telephone), Number(j.classe_id),
        j.entreprise_id ? Number(j.entreprise_id) : null,
        vide(j.maitre_nom), vide(j.maitre_telephone), vide(j.maitre_email),
        ['Monsieur', 'Madame'].includes(j.civilite) ? j.civilite : null,
        vide(j.adresse), vide(j.code_postal), vide(j.ville),
      ];
      if (j.id) {
        db.prepare(
          `UPDATE jeunes SET nom=?, prenom=?, email=?, telephone=?, classe_id=?, entreprise_id=?,
           maitre_nom=?, maitre_telephone=?, maitre_email=?, civilite=?, adresse=?, code_postal=?, ville=? WHERE id=?`
        ).run(...p, j.id);
        return j.id;
      }
      return Number(
        db.prepare(
          `INSERT INTO jeunes (nom, prenom, email, telephone, classe_id, entreprise_id,
           maitre_nom, maitre_telephone, maitre_email, civilite, adresse, code_postal, ville) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(...p).lastInsertRowid
      );
    },

    'jeunes:delete': (id) => {
      db.prepare('DELETE FROM jeunes WHERE id=?').run(id);
      return true;
    },

    'evenements:list': (f = {}) => {
      const where = [];
      const p = [];
      if (f.jeune_id) { where.push('e.jeune_id = ?'); p.push(Number(f.jeune_id)); }
      if (f.classe_id) { where.push('j.classe_id = ?'); p.push(Number(f.classe_id)); }
      if (f.type === 'absence' || f.type === 'retard') { where.push('e.type = ?'); p.push(f.type); }
      if (typeof f.mois === 'string' && /^\d{4}-\d{2}$/.test(f.mois)) {
        // l'événement touche ce mois s'il commence avant la fin du mois et finit après le début
        where.push('e.date_debut <= ? AND COALESCE(e.date_fin, e.date_debut) >= ?');
        p.push(`${f.mois}-31`, `${f.mois}-01`);
      }
      if (f.statut === 'a_traiter') where.push('e.motif_id IS NULL');
      if (f.statut === 'recevable' || f.statut === 'irrecevable') { where.push('m.statut = ?'); p.push(f.statut); }
      if (f.notifie === 'oui') where.push('e.notifie_le IS NOT NULL');
      if (f.notifie === 'non') where.push('e.notifie_le IS NULL');
      const rows = db.prepare(
        `SELECT e.*, j.nom AS jeune_nom, j.prenom AS jeune_prenom, c.code AS classe_code,
                en.nom AS entreprise_nom, m.libelle AS motif_libelle, m.statut AS motif_statut,
                (SELECT COUNT(*) FROM pieces_jointes pj WHERE pj.evenement_id = e.id) AS nb_pieces
         FROM evenements e
         JOIN jeunes j ON j.id = e.jeune_id
         JOIN classes c ON c.id = j.classe_id
         LEFT JOIN entreprises en ON en.id = j.entreprise_id
         LEFT JOIN motifs m ON m.id = e.motif_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY e.date_debut DESC, e.id DESC`
      ).all(...p);
      const pieces = rows.length
        ? db.prepare(
            `SELECT id, evenement_id, nom_fichier, taille FROM pieces_jointes
             WHERE evenement_id IN (${rows.map(() => '?').join(',')}) ORDER BY id`
          ).all(...rows.map((r) => r.id))
        : [];
      return avecCreneaux(rows).map((r) => ({ ...r, pieces: pieces.filter((x) => x.evenement_id === r.id) }));
    },

    'evenements:save': (e) => {
      if (!e.jeune_id || !db.prepare('SELECT 1 FROM jeunes WHERE id = ?').get(Number(e.jeune_id))) {
        throw new Error("Choisissez l'apprenti concerné.");
      }
      if (e.type !== 'absence' && e.type !== 'retard') throw new Error('Choisissez absence ou retard.');
      if (e.id && !db.prepare('SELECT 1 FROM evenements WHERE id = ?').get(Number(e.id))) {
        throw new Error('Cette absence ou ce retard est introuvable.');
      }
      // La durée n'est jamais saisie : elle est calculée à partir des créneaux (début et fin à la minute).
      const lignes = Array.isArray(e.creneaux) ? e.creneaux : [];
      if (lignes.length === 0) throw new Error('Ajoutez au moins un créneau (date, heure de début, heure de fin).');
      if (e.type === 'retard' && lignes.length > 1) throw new Error('Un retard ne comporte qu\'une seule ligne.');
      const cr = lignes.map((c, i) => {
        const n = lignes.length > 1 ? `Créneau ${i + 1} : ` : '';
        if (!dateValide(c.date)) throw new Error(`${n}la date est invalide.`);
        if (!heureValide(c.heure_debut) || !heureValide(c.heure_fin)) throw new Error(`${n}les heures sont invalides.`);
        const d = enMinutes(c.heure_fin) - enMinutes(c.heure_debut);
        if (d <= 0) throw new Error(`${n}l'heure de fin doit être après l'heure de début.`);
        return { date: c.date, heure_debut: c.heure_debut, heure_fin: c.heure_fin, duree_minutes: d };
      }).sort((x, y) => (x.date + x.heure_debut).localeCompare(y.date + y.heure_debut));

      const chevauche = (x, y) => x.date === y.date && x.heure_debut < y.heure_fin && y.heure_debut < x.heure_fin;
      for (let k = 1; k < cr.length; k++) {
        if (chevauche(cr[k - 1], cr[k])) throw new Error(`Deux créneaux se chevauchent le ${jourMois(cr[k].date)}.`);
      }
      // Pas de doublon : ce créneau ne doit pas recouvrir une absence ou un retard déjà saisi pour cet apprenti.
      const autres = db.prepare(
        `SELECT c.date, c.heure_debut, c.heure_fin, e.type FROM creneaux c
         JOIN evenements e ON e.id = c.evenement_id WHERE e.jeune_id = ? AND e.id <> ?`
      ).all(Number(e.jeune_id), Number(e.id) || 0);
      for (const c of cr) {
        const a = autres.find((x) => chevauche(c, x));
        if (a) {
          throw new Error(
            `Le ${jourMois(c.date)} de ${c.heure_debut} à ${c.heure_fin} chevauche ${a.type === 'absence' ? 'une absence' : 'un retard'} déjà enregistré${a.type === 'absence' ? 'e' : ''} (${a.heure_debut} à ${a.heure_fin}).`
          );
        }
      }
      const dateDebut = cr[0].date;
      const dateFin = e.type === 'absence' ? cr[cr.length - 1].date : null;
      const duree = cr.reduce((t, c) => t + c.duree_minutes, 0);
      const motifId = e.motif_id ? Number(e.motif_id) : null;
      if (motifId && !db.prepare('SELECT 1 FROM motifs WHERE id = ?').get(motifId)) throw new Error("Ce motif n'existe plus.");
      const p = [Number(e.jeune_id), e.type, dateDebut, dateFin, duree, motifId, vide(e.observations), vide(e.mail_copie)];
      db.exec('BEGIN');
      try {
        let id;
        if (e.id) {
          const r = db.prepare(
            `UPDATE evenements SET jeune_id=?, type=?, date_debut=?, date_fin=?, duree_minutes=?, motif_id=?,
             observations=?, mail_copie=? WHERE id=?`
          ).run(...p, Number(e.id));
          if (!r.changes) throw new Error('Cette absence ou ce retard est introuvable.');
          id = Number(e.id);
          db.prepare('DELETE FROM creneaux WHERE evenement_id = ?').run(id);
        } else {
          id = Number(
            db.prepare(
              `INSERT INTO evenements (jeune_id, type, date_debut, date_fin, duree_minutes, motif_id, observations, mail_copie)
               VALUES (?,?,?,?,?,?,?,?)`
            ).run(...p).lastInsertRowid
          );
        }
        const ins = db.prepare('INSERT INTO creneaux (evenement_id, date, heure_debut, heure_fin, duree_minutes) VALUES (?,?,?,?,?)');
        for (const c of cr) ins.run(id, c.date, c.heure_debut, c.heure_fin, c.duree_minutes);
        db.exec('COMMIT');
        return id;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    'evenements:delete': (id) => {
      db.prepare('DELETE FROM evenements WHERE id = ?').run(Number(id)); // les pièces jointes suivent
      return true;
    },

    // Suivi : l'entreprise a-t-elle été prévenue ? (date d'envoi enregistrée, ou effacée)
    'evenements:notifier': ({ ids, notifie }) => {
      const n = new Date();
      const p2 = (x) => String(x).padStart(2, '0');
      // heure locale (et non UTC) : la date affichée doit être celle du jour pour l'utilisatrice
      const valeur = notifie
        ? `${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())}T${p2(n.getHours())}:${p2(n.getMinutes())}`
        : null;
      const st = db.prepare('UPDATE evenements SET notifie_le = ? WHERE id = ?');
      for (const id of ids) st.run(valeur, Number(id));
      return true;
    },

    // Tout ce qu'il faut pour écrire au maître d'apprentissage ou à l'entreprise.
    'evenements:detail': (id) => {
      const r = db.prepare(
        `SELECT e.*, j.nom AS jeune_nom, j.prenom AS jeune_prenom, c.code AS classe_code,
                j.maitre_nom, j.maitre_email, en.email AS entreprise_email,
                m.libelle AS motif_libelle, m.statut AS motif_statut
         FROM evenements e
         JOIN jeunes j ON j.id = e.jeune_id
         JOIN classes c ON c.id = j.classe_id
         LEFT JOIN entreprises en ON en.id = j.entreprise_id
         LEFT JOIN motifs m ON m.id = e.motif_id
         WHERE e.id = ?`
      ).get(Number(id));
      if (!r) throw new Error('Absence ou retard introuvable.');
      return { ...avecCreneaux([r])[0], destinataires: destinatairesDe(r.jeune_id, r.date_debut) };
    },

    'evenements:alertes': () => ({
      a_traiter: db.prepare('SELECT COUNT(*) AS n FROM evenements WHERE motif_id IS NULL').get().n,
      a_notifier: db.prepare('SELECT COUNT(*) AS n FROM evenements WHERE notifie_le IS NULL').get().n,
    }),

    'pieces:list': (evenementId) =>
      db.prepare('SELECT id, nom_fichier, taille FROM pieces_jointes WHERE evenement_id = ? ORDER BY id').all(Number(evenementId)),

    'pieces:ajouter': ({ evenement_id, nom, contenu }) => {
      if (!db.prepare('SELECT 1 FROM evenements WHERE id = ?').get(Number(evenement_id))) throw new Error('Absence introuvable.');
      const n = vide(nom);
      if (!n) throw new Error('Nom de fichier manquant.');
      if (!contenu || contenu.length === 0) throw new Error(`${n} : le fichier est vide.`);
      if (contenu.length > TAILLE_MAX_PIECE) throw new Error(`${n} : fichier trop volumineux (10 Mo maximum).`);
      return Number(
        db.prepare('INSERT INTO pieces_jointes (evenement_id, nom_fichier, taille, contenu) VALUES (?,?,?,?)')
          .run(Number(evenement_id), n, contenu.length, contenu).lastInsertRowid
      );
    },

    'pieces:contenu': (id) => {
      const r = db.prepare('SELECT nom_fichier, contenu FROM pieces_jointes WHERE id = ?').get(Number(id));
      if (!r) throw new Error('Pièce jointe introuvable.');
      return r;
    },

    'pieces:supprimer': (id) => {
      db.prepare('DELETE FROM pieces_jointes WHERE id = ?').run(Number(id));
      return true;
    },

    'stats': () => ({
      classes: db.prepare(
        `SELECT c.id, c.code, c.libelle, COUNT(j.id) AS nb_jeunes
         FROM classes c LEFT JOIN jeunes j ON j.classe_id = c.id GROUP BY c.id ORDER BY c.ordre, c.id`
      ).all(),
      nb_entreprises: db.prepare('SELECT COUNT(*) AS n FROM entreprises').get().n,
    }),
  };

  Object.assign(actions, creerRattrapages(db, { vide, dateValide, heureValide, enMinutes, cle, tailleMax: TAILLE_MAX_PIECE }));
  const professeurs = creerProfesseurs(db, { vide, dateValide, cle });
  Object.assign(actions, professeurs.actions);

  return {
    appeler(action, arg) {
      const f = actions[action];
      if (!f) throw new Error(`Action inconnue : ${action}`);
      return f(arg);
    },
    // Réglages internes : jamais exposés à l'interface.
    lireReglage(cle) {
      const r = db.prepare('SELECT valeur FROM reglages WHERE cle = ?').get(cle);
      return r ? r.valeur : null;
    },
    ecrireReglage(cle, valeur) {
      db.prepare('INSERT INTO reglages (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur').run(cle, valeur);
    },
    // Copie cohérente de toute la base dans un seul fichier.
    sauvegarder(chemin) {
      if (fs.existsSync(chemin)) fs.rmSync(chemin);
      db.exec(`VACUUM INTO '${chemin.replace(/'/g, "''")}'`);
    },
    fermer() {
      db.close();
    },
  };
}

module.exports = { ouvrir, MIGRATIONS, VERSION: MIGRATIONS.length, TAILLE_MAX_PIECE, HORAIRES_DEFAUT };
