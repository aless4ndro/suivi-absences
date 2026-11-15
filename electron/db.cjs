// Base de données locale (SQLite intégré à Node, aucun module natif à compiler).
const { DatabaseSync } = require('node:sqlite');

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
];

function vide(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function ouvrir(chemin) {
  const db = new DatabaseSync(chemin);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  let version = db.prepare('PRAGMA user_version').get().user_version;
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

  const actions = {
    'classes:list': () => db.prepare('SELECT * FROM classes ORDER BY id').all(),

    'motifs:list': () => db.prepare('SELECT * FROM motifs ORDER BY statut DESC, libelle').all(),

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

    'entreprises:delete': (id) => {
      db.prepare('DELETE FROM entreprises WHERE id=?').run(id);
      return true;
    },

    'jeunes:list': () =>
      db.prepare(
        `SELECT j.*, c.code AS classe_code, e.nom AS entreprise_nom
         FROM jeunes j
         JOIN classes c ON c.id = j.classe_id
         LEFT JOIN entreprises e ON e.id = j.entreprise_id
         ORDER BY c.id, j.nom COLLATE NOCASE, j.prenom COLLATE NOCASE`
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
      ];
      if (j.id) {
        db.prepare(
          `UPDATE jeunes SET nom=?, prenom=?, email=?, telephone=?, classe_id=?, entreprise_id=?,
           maitre_nom=?, maitre_telephone=?, maitre_email=? WHERE id=?`
        ).run(...p, j.id);
        return j.id;
      }
      return Number(
        db.prepare(
          `INSERT INTO jeunes (nom, prenom, email, telephone, classe_id, entreprise_id,
           maitre_nom, maitre_telephone, maitre_email) VALUES (?,?,?,?,?,?,?,?,?)`
        ).run(...p).lastInsertRowid
      );
    },

    'jeunes:delete': (id) => {
      db.prepare('DELETE FROM jeunes WHERE id=?').run(id);
      return true;
    },

    'stats': () => ({
      classes: db.prepare(
        `SELECT c.id, c.code, c.libelle, COUNT(j.id) AS nb_jeunes
         FROM classes c LEFT JOIN jeunes j ON j.classe_id = c.id GROUP BY c.id ORDER BY c.id`
      ).all(),
      nb_entreprises: db.prepare('SELECT COUNT(*) AS n FROM entreprises').get().n,
    }),
  };

  return {
    appeler(action, arg) {
      const f = actions[action];
      if (!f) throw new Error(`Action inconnue : ${action}`);
      return f(arg);
    },
    fermer() {
      db.close();
    },
  };
}

module.exports = { ouvrir };
