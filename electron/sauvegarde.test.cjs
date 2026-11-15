const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ouvrir } = require('./db.cjs');
const { verifierSauvegarde, remplacer } = require('./sauvegarde.cjs');

test('sauvegarde, vérification et restauration', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-'));
  const base = path.join(dossier, 'base.db');
  const copie = path.join(dossier, 'copie.db');

  let db = ouvrir(base);
  db.appeler('entreprises:save', { nom: 'Avant' });
  db.sauvegarder(copie);
  db.sauvegarder(copie); // écrase sans erreur
  db.appeler('entreprises:save', { nom: 'Après' });
  assert.strictEqual(db.appeler('entreprises:list').length, 2);

  verifierSauvegarde(copie);

  db.fermer();
  remplacer(base, copie);
  db = ouvrir(base);
  const noms = db.appeler('entreprises:list').map((e) => e.nom);
  assert.deepStrictEqual(noms, ['Avant']);
  db.fermer();

  const faux = path.join(dossier, 'faux.db');
  fs.writeFileSync(faux, 'ceci est un texte, pas une base');
  assert.throws(() => verifierSauvegarde(faux), /pas une sauvegarde valide/);

  fs.rmSync(dossier, { recursive: true, force: true });
});
