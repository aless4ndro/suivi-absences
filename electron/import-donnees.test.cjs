const test = require('node:test');
const assert = require('node:assert');
const { ouvrir } = require('./db.cjs');
const { lireTableau, reconnaitreColonnes, normaliserLigne } = require('./import-tableau.cjs');
const { proposerClasse } = require('./import-donnees.cjs');

const csv = (t) => {
  const tb = lireTableau(Buffer.from(t, 'utf8'), '.csv');
  const champs = reconnaitreColonnes(tb.entetes);
  return tb.lignes.map((l) => normaliserLigne(l, champs));
};
const base = 'Nom;Prénom;Date de naissance;Téléphone;E-mail;Formation;Année de formation;Raison sociale;SIRET;Code postal entreprise;Ville entreprise;Nom du tuteur;Début du contrat;Fin du contrat;Type de contrat\n';

test('lecture CSV : colonnes reconnues dans le désordre, valeurs nettoyées', () => {
  const l = csv('Prénom;NOM;Naissance;Tél;Classe\nléa;durand;3/4/05;612345678;MCO 1\n');
  assert.deepStrictEqual(l[0].champs.nom, 'Durand');
  assert.strictEqual(l[0].champs.prenom, 'Léa');
  assert.strictEqual(l[0].champs.date_naissance, '2005-04-03');
  assert.strictEqual(l[0].champs.telephone, '06 12 34 56 78'); // zéro initial rétabli
  const e = csv('Nom Prénom;Siret\nDUPONT Jean-Pierre;1,2E+13\n');
  assert.strictEqual(e[0].champs.nom, 'Dupont');
  assert.strictEqual(e[0].champs.prenom, 'Jean-Pierre');
});

test('classe proposée d’après la formation et l’année', () => {
  const db = ouvrir(':memory:');
  const cl = db.appeler('classes:list');
  const id = (t) => proposerClasse(t, cl);
  assert.strictEqual(cl.find((c) => c.id === id('MCO 1ère année')).code, 'MCO 1ère année');
  assert.strictEqual(cl.find((c) => c.id === id('BTS MCO 2'))?.code, 'MCO 2ème année');
  assert.strictEqual(cl.find((c) => c.id === id('DTS IMRT 3ème année'))?.code, 'DTS IMRT 3ème année');
  assert.strictEqual(id('Boulangerie'), null);
  db.fermer();
});

test('import : création, doublons, entreprise unique, incertains bloquants, annulation', () => {
  const db = ouvrir(':memory:');
  const lignes = csv(`${base}`
    + 'Durand;Léa;03/04/2005;0612345678;lea@x.fr;MCO;1ère année;Boulangerie Martin;552 081 317 00019;27000;Évreux;Paul Martin;01/09/2026;31/08/2028;Apprentissage\n'
    + 'Petit;Hugo;;;;MCO;1ère année;Boulangerie Martin SARL;55208131700019;27000;Évreux;Paul Martin;01/09/2026;;Apprentissage\n'
    + 'Roux;Zoé;12/12/2004;;;GPME;2ème année;;;;;;;;\n');
  const arg = { annee_scolaire: '2026-2027', fichier: 'test.csv', lignes };
  const a = db.appeler('import:analyser', arg);
  assert.strictEqual(a.resume.apprentis_nouveaux, 3);
  assert.strictEqual(a.resume.entreprises_nouvelles, 1); // même SIRET : une seule entreprise
  assert.ok(a.lignes[2].manquants.length > 0 && !a.lignes[2].bloquants.length); // pas d'entreprise : n'empêche pas l'import
  const r = db.appeler('import:appliquer', { arg, utilisateur: 'test', sauvegarde: null });
  assert.strictEqual(r.apprentis_crees, 3);
  assert.strictEqual(r.entreprises_creees, 1);
  const jeunes = db.appeler('jeunes:list');
  const lea = jeunes.find((j) => j.nom === 'Durand');
  assert.strictEqual(lea.entreprise_nom, 'Boulangerie Martin');
  assert.strictEqual(lea.classe_code, 'MCO 1ère année');
  assert.strictEqual(lea.contrat_fin, '2028-08-31');
  assert.strictEqual(db.appeler('entreprises:list')[0].ville, 'Évreux');

  // 2e import du même fichier : tout est reconnu, rien n'est recréé
  const b = db.appeler('import:analyser', arg);
  assert.strictEqual(b.lignes[0].apprenti.statut, 'existant');
  assert.strictEqual(b.lignes[1].apprenti.statut, 'a_confirmer'); // pas de date de naissance ni coordonnées : on ne devine pas
  assert.throws(() => db.appeler('import:appliquer', { arg, utilisateur: 't' }), /incertaine/);
  const dec = { lignes: { 1: { apprenti_id: jeunes.find((j) => j.nom === 'Petit').id }, 2: { exclu: true } } };
  const r2 = db.appeler('import:appliquer', { arg: { ...arg, decisions: dec }, utilisateur: 't' });
  assert.strictEqual(r2.apprentis_crees, 0);
  assert.strictEqual(r2.entreprises_creees, 0);
  assert.strictEqual(db.appeler('jeunes:list').length, 3);
  assert.strictEqual(db.appeler('entreprises:list').length, 1);

  // annulation du 1er import : fiches créées retirées, rien d'autre
  const hist = db.appeler('import:historique');
  assert.strictEqual(hist.length, 2);
  const an = db.appeler('import:annuler', hist[1].id);
  assert.deepStrictEqual(an.conserves, []);
  assert.strictEqual(db.appeler('jeunes:list').length, 0);
  assert.strictEqual(db.appeler('entreprises:list').length, 0);
  assert.throws(() => db.appeler('import:annuler', hist[1].id), /déjà annulé/);
  db.fermer();
});

test('import : existant complété sans écrasement, changement de contrat et de classe sur validation', () => {
  const db = ouvrir(':memory:');
  const cl = db.appeler('classes:list');
  const mco1 = cl.find((c) => c.code === 'MCO 1ère année').id;
  const mco2 = cl.find((c) => c.code === 'MCO 2ème année').id;
  const e1 = db.appeler('entreprises:save', { nom: 'Garage Leroy', telephone: '02 32 00 00 00' });
  const j = db.appeler('jeunes:save', { nom: 'Durand', prenom: 'Léa', classe_id: mco1, entreprise_id: e1, date_naissance: '2005-04-03', telephone: '06 00 00 00 00' });
  const lignes = csv(`${base}Durand;Léa;03/04/2005;0699999999;lea@x.fr;MCO;2ème année;Boulangerie Martin;55208131700019;27000;Évreux;;01/09/2027;;Apprentissage\n`);
  const arg = { annee_scolaire: '2027-2028', fichier: 't.csv', lignes };
  const a = db.appeler('import:analyser', arg);
  assert.strictEqual(a.lignes[0].apprenti.id, j);
  assert.deepStrictEqual(a.lignes[0].apprenti.differences.map((d) => d.champ), ['telephone']);
  assert.strictEqual(a.lignes[0].changement_classe.vers, 'MCO 2ème année');
  assert.strictEqual(a.lignes[0].contrat.action, 'nouveau_contrat');
  // sans décision : seul l'e-mail manquant est complété, téléphone / classe / employeur inchangés
  db.appeler('import:appliquer', { arg, utilisateur: 't' });
  let f = db.appeler('jeunes:list')[0];
  assert.strictEqual(f.email, 'lea@x.fr');
  assert.strictEqual(f.telephone, '06 00 00 00 00');
  assert.strictEqual(f.classe_code, 'MCO 1ère année');
  assert.strictEqual(f.entreprise_nom, 'Garage Leroy');
  // avec validation explicite
  const dec = { lignes: { 0: { remplacer: ['telephone'], classe_changer: true, nouveau_contrat: true } } };
  db.appeler('import:appliquer', { arg: { ...arg, decisions: dec }, utilisateur: 't' });
  const contrats = db.appeler('jeunes:contrats', j);
  assert.strictEqual(contrats.length, 2); // l'ancien contrat est conservé dans l'historique
  assert.strictEqual(db.appeler('jeunes:classes', j).length, 2);
  assert.strictEqual(db.appeler('jeunes:list')[0].telephone, '06 99 99 99 99');
  // annulation du dernier import : retour à l'état précédent
  const hist = db.appeler('import:historique');
  db.appeler('import:annuler', hist[0].id);
  f = db.appeler('jeunes:list')[0];
  assert.strictEqual(f.telephone, '06 00 00 00 00');
  assert.strictEqual(db.appeler('jeunes:contrats', j).length, 1);
  assert.strictEqual(db.appeler('jeunes:classes', j).length, 1);
  db.fermer();
});
