// Mot de passe oublié : supprime le mot de passe, l'appli en demandera un nouveau au prochain lancement.
// Les données (jeunes, absences...) ne sont pas touchées.
// Usage : node scripts/reset-mdp.cjs "C:\chemin\vers\suivi-absences.db"   (fermer l'appli avant)
const { DatabaseSync } = require('node:sqlite');

const chemin = process.argv[2];
if (!chemin) {
  console.error('Usage : node scripts/reset-mdp.cjs "<chemin vers suivi-absences.db>"');
  process.exit(1);
}
const db = new DatabaseSync(chemin);
const r = db.prepare("DELETE FROM reglages WHERE cle = 'mdp'").run();
db.close();
console.log(r.changes ? 'Mot de passe supprimé.' : "Aucun mot de passe n'était défini.");
