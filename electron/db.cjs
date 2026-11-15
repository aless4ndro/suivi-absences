// Base de données locale (SQLite intégré à Node, aucun module natif à compiler).
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');

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
];

const TAILLE_MAX_PIECE = 10 * 1024 * 1024;

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
      return db.prepare(
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
    },

    'evenements:save': (e) => {
      if (!e.jeune_id || !db.prepare('SELECT 1 FROM jeunes WHERE id = ?').get(Number(e.jeune_id))) {
        throw new Error("Choisissez l'apprenti concerné.");
      }
      if (e.type !== 'absence' && e.type !== 'retard') throw new Error('Choisissez absence ou retard.');
      if (!dateValide(e.date_debut)) throw new Error('La date est invalide.');
      let dateFin = null;
      if (e.type === 'absence') {
        dateFin = e.date_fin || e.date_debut;
        if (!dateValide(dateFin)) throw new Error('La date de fin est invalide.');
        if (dateFin < e.date_debut) throw new Error('La date de fin est avant la date de début.');
      }
      const duree = Number(e.duree_minutes);
      if (!Number.isInteger(duree) || duree < 1 || duree > 100000) {
        throw new Error('Indiquez une durée (heures et minutes) supérieure à zéro.');
      }
      const motifId = e.motif_id ? Number(e.motif_id) : null;
      if (motifId && !db.prepare('SELECT 1 FROM motifs WHERE id = ?').get(motifId)) throw new Error("Ce motif n'existe plus.");
      const p = [Number(e.jeune_id), e.type, e.date_debut, dateFin, duree, motifId, vide(e.observations), vide(e.mail_copie)];
      if (e.id) {
        const r = db.prepare(
          `UPDATE evenements SET jeune_id=?, type=?, date_debut=?, date_fin=?, duree_minutes=?, motif_id=?,
           observations=?, mail_copie=? WHERE id=?`
        ).run(...p, Number(e.id));
        if (!r.changes) throw new Error('Cette absence ou ce retard est introuvable.');
        return Number(e.id);
      }
      return Number(
        db.prepare(
          `INSERT INTO evenements (jeune_id, type, date_debut, date_fin, duree_minutes, motif_id, observations, mail_copie)
           VALUES (?,?,?,?,?,?,?,?)`
        ).run(...p).lastInsertRowid
      );
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

module.exports = { ouvrir, VERSION: MIGRATIONS.length, TAILLE_MAX_PIECE };
