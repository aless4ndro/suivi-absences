const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { ouvrir } = require('./db.cjs');

test('schéma, classes par défaut, jeunes et entreprises', () => {
  const db = ouvrir(':memory:');
  const classes = db.appeler('classes:list');
  assert.deepStrictEqual(classes.map((c) => c.code), ['GPME', 'MCO', 'NDRC', 'LCVM']);
  assert.ok(db.appeler('motifs:list').length >= 2);

  const eid = db.appeler('entreprises:save', { nom: ' Boulangerie Martin ', email: 'contact@martin.example' });
  const jid = db.appeler('jeunes:save', {
    nom: 'Durand', prenom: 'Léa', classe_id: classes[1].id, entreprise_id: eid,
    maitre_nom: 'M. Martin', maitre_email: '',
  });
  let jeunes = db.appeler('jeunes:list');
  assert.strictEqual(jeunes.length, 1);
  assert.strictEqual(jeunes[0].entreprise_nom, 'Boulangerie Martin');
  assert.strictEqual(jeunes[0].classe_code, 'MCO');
  assert.strictEqual(jeunes[0].maitre_email, null);

  db.appeler('jeunes:save', { id: jid, nom: 'Durand', prenom: 'Léa', classe_id: classes[0].id, entreprise_id: eid });
  assert.strictEqual(db.appeler('jeunes:list')[0].classe_code, 'GPME');
  assert.strictEqual(db.appeler('entreprises:list')[0].nb_jeunes, 1);

  // Supprimer l'entreprise ne supprime pas le jeune
  db.appeler('entreprises:delete', eid);
  jeunes = db.appeler('jeunes:list');
  assert.strictEqual(jeunes.length, 1);
  assert.strictEqual(jeunes[0].entreprise_id, null);

  assert.throws(() => db.appeler('jeunes:save', { nom: '', prenom: 'x', classe_id: 1 }));
  assert.throws(() => db.appeler('inconnue'));
  assert.strictEqual(db.appeler('stats').classes[0].nb_jeunes, 1);
  assert.strictEqual(db.lireReglage('x'), null);
  db.ecrireReglage('x', 'a');
  db.ecrireReglage('x', 'b');
  assert.strictEqual(db.lireReglage('x'), 'b');
  db.fermer();
});

test('motifs : création unique, statut obligatoire, suppression protégée', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-motifs-'));
  const chemin = path.join(dossier, 'base.db');
  const db = ouvrir(chemin);
  const avant = db.appeler('motifs:list').length;
  const id = db.appeler('motifs:save', { libelle: ' Grève des transports ', statut: 'recevable' });
  assert.strictEqual(db.appeler('motifs:list').length, avant + 1);
  assert.strictEqual(db.appeler('motifs:list').find((m) => m.id === id).libelle, 'Grève des transports');

  // doublon refusé, même avec des majuscules différentes
  assert.throws(() => db.appeler('motifs:save', { libelle: 'grève des TRANSPORTS', statut: 'irrecevable' }), /existe déjà/);
  assert.throws(() => db.appeler('motifs:save', { libelle: 'GREVE  des transports', statut: 'irrecevable' }), /existe déjà/);
  // modifier un motif sans changer son libellé reste possible
  db.appeler('motifs:save', { id, libelle: 'Grève des transports', statut: 'recevable' });
  assert.throws(() => db.appeler('motifs:save', { libelle: '', statut: 'recevable' }), /obligatoire/);
  assert.throws(() => db.appeler('motifs:save', { libelle: 'X', statut: 'peut-être' }), /recevable ou irrecevable/);

  // modification du statut
  db.appeler('motifs:save', { id, libelle: 'Grève des transports', statut: 'irrecevable' });
  assert.strictEqual(db.appeler('motifs:list').find((m) => m.id === id).statut, 'irrecevable');

  // un motif utilisé par une absence ne se supprime pas (l'absence est insérée par une 2e connexion)
  const jid = db.appeler('jeunes:save', { nom: 'A', prenom: 'B', classe_id: db.appeler('classes:list')[0].id });
  const autre = new DatabaseSync(chemin);
  autre.prepare("INSERT INTO evenements (jeune_id, type, date_debut, motif_id) VALUES (?, 'absence', '2026-11-10', ?)").run(jid, id);
  autre.close();
  assert.strictEqual(db.appeler('motifs:list').find((m) => m.id === id).nb_utilisations, 1);
  assert.throws(() => db.appeler('motifs:delete', id), /utilisé par 1/);

  // un motif jamais utilisé se supprime
  const libre = db.appeler('motifs:save', { libelle: 'Motif libre', statut: 'recevable' });
  db.appeler('motifs:delete', libre);
  assert.ok(!db.appeler('motifs:list').some((m) => m.id === libre));
  db.fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});
