// Vérification et remplacement de la base lors d'une restauration.
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { VERSION } = require('./db.cjs');

const TABLES_REQUISES = ['classes', 'jeunes', 'entreprises', 'evenements', 'rattrapages', 'reglages'];

// Lève une erreur claire si le fichier n'est pas une sauvegarde utilisable.
function verifierSauvegarde(chemin) {
  const invalide = new Error("Ce fichier n'est pas une sauvegarde valide de Suivi Absences.");
  let d;
  try {
    d = new DatabaseSync(chemin, { readOnly: true });
    const version = d.prepare('PRAGMA user_version').get().user_version;
    const tables = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    if (version < 1 || !TABLES_REQUISES.filter((t) => version >= 2 || t !== 'reglages').every((t) => tables.includes(t))) {
      throw invalide;
    }
    if (version > VERSION) {
      throw new Error("Cette sauvegarde vient d'une version plus récente de l'application.");
    }
    if (d.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
      throw new Error('Ce fichier de sauvegarde est endommagé.');
    }
  } catch (e) {
    if (e === invalide || /plus récente|endommagé/.test(e.message)) throw e;
    throw invalide;
  } finally {
    if (d) d.close();
  }
}

// La base doit être fermée avant d'appeler cette fonction.
function remplacer(cheminBase, source) {
  const tmp = `${cheminBase}.nouveau`;
  fs.copyFileSync(source, tmp);
  fs.rmSync(`${cheminBase}-wal`, { force: true });
  fs.rmSync(`${cheminBase}-shm`, { force: true });
  fs.renameSync(tmp, cheminBase);
}

module.exports = { verifierSauvegarde, remplacer };
