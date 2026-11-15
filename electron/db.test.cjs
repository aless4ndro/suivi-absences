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

test('absences et retards : saisie, validations, filtres, alertes, pièces jointes', () => {
  const db = ouvrir(':memory:');
  const [gpme, mco] = db.appeler('classes:list');
  const eid = db.appeler('entreprises:save', { nom: 'Boulangerie Martin' });
  const a = db.appeler('jeunes:save', { nom: 'Durand', prenom: 'Léa', classe_id: gpme.id, entreprise_id: eid });
  const b = db.appeler('jeunes:save', { nom: 'Petit', prenom: 'Sam', classe_id: mco.id });
  const recevable = db.appeler('motifs:list').find((m) => m.statut === 'recevable');
  const irrecevable = db.appeler('motifs:list').find((m) => m.statut === 'irrecevable');

  const base = { jeune_id: a, type: 'absence', date_debut: '2026-11-10', date_fin: '2026-11-12', duree_minutes: 7 * 60 + 35 };
  const abs1 = db.appeler('evenements:save', { ...base, observations: ' mal de dos ', mail_copie: 'Bonjour...' });
  const ret1 = db.appeler('evenements:save', { jeune_id: a, type: 'retard', date_debut: '2026-11-13', date_fin: '2026-11-14', duree_minutes: 12, motif_id: irrecevable.id });
  const abs2 = db.appeler('evenements:save', { jeune_id: b, type: 'absence', date_debut: '2026-12-02', duree_minutes: 120, motif_id: recevable.id });

  let tous = db.appeler('evenements:list');
  assert.strictEqual(tous.length, 3);
  assert.strictEqual(tous[0].id, abs2); // plus récent d'abord
  const e1 = tous.find((e) => e.id === abs1);
  assert.strictEqual(e1.duree_minutes, 455); // 7 h 35, à la minute
  assert.strictEqual(e1.observations, 'mal de dos');
  assert.strictEqual(e1.entreprise_nom, 'Boulangerie Martin');
  assert.strictEqual(e1.motif_id, null);
  const r1 = tous.find((e) => e.id === ret1);
  assert.strictEqual(r1.date_fin, null); // un retard n'a pas de date de fin
  assert.strictEqual(tous.find((e) => e.id === abs2).date_fin, '2026-12-02'); // fin par défaut = début

  // validations
  assert.throws(() => db.appeler('evenements:save', { ...base, jeune_id: 999 }), /apprenti/);
  assert.throws(() => db.appeler('evenements:save', { ...base, type: 'autre' }), /absence ou retard/);
  assert.throws(() => db.appeler('evenements:save', { ...base, date_debut: '2026-02-30' }), /date est invalide/);
  assert.throws(() => db.appeler('evenements:save', { ...base, date_fin: '2026-11-09' }), /avant la date de début/);
  assert.throws(() => db.appeler('evenements:save', { ...base, duree_minutes: 0 }), /durée/);
  assert.throws(() => db.appeler('evenements:save', { ...base, duree_minutes: 1.5 }), /durée/);
  assert.throws(() => db.appeler('evenements:save', { ...base, motif_id: 999 }), /motif/);
  assert.throws(() => db.appeler('evenements:save', { ...base, id: 999 }), /introuvable/);

  // filtres
  const n = (f) => db.appeler('evenements:list', f).length;
  assert.strictEqual(n({ jeune_id: a }), 2);
  assert.strictEqual(n({ classe_id: mco.id }), 1);
  assert.strictEqual(n({ type: 'retard' }), 1);
  assert.strictEqual(n({ mois: '2026-11' }), 2);
  assert.strictEqual(n({ mois: '2026-12' }), 1);
  assert.strictEqual(n({ mois: '2026-10' }), 0);
  assert.strictEqual(n({ statut: 'a_traiter' }), 1);
  assert.strictEqual(n({ statut: 'recevable' }), 1);
  assert.strictEqual(n({ statut: 'irrecevable' }), 1);

  // changer le motif met à jour le statut ; le statut vient du motif
  db.appeler('evenements:save', { ...base, id: abs1, motif_id: recevable.id });
  assert.strictEqual(n({ statut: 'a_traiter' }), 0);
  assert.strictEqual(n({ statut: 'recevable' }), 2);

  // notifications
  assert.deepStrictEqual(db.appeler('evenements:alertes'), { a_traiter: 0, a_notifier: 3 });
  db.appeler('evenements:notifier', { ids: [abs1, ret1], notifie: true });
  assert.strictEqual(n({ notifie: 'oui' }), 2);
  assert.strictEqual(db.appeler('evenements:alertes').a_notifier, 1);
  db.appeler('evenements:notifier', { ids: [abs1], notifie: false });
  assert.strictEqual(n({ notifie: 'non' }), 2);

  // détail pour l'envoi de mail
  const det = db.appeler('evenements:detail', abs1);
  assert.strictEqual(det.jeune_prenom, 'Léa');
  assert.strictEqual(det.classe_code, 'GPME');
  assert.strictEqual(det.maitre_email, null);
  assert.strictEqual(det.entreprise_email, null);
  assert.throws(() => db.appeler('evenements:detail', 999), /introuvable/);

  // pièces jointes
  const contenu = Buffer.from([0, 1, 2, 250, 255]);
  const pj = db.appeler('pieces:ajouter', { evenement_id: abs1, nom: 'certificat.pdf', contenu });
  assert.deepStrictEqual(db.appeler('pieces:list', abs1).map((p) => [p.nom_fichier, p.taille]), [['certificat.pdf', 5]]);
  assert.deepStrictEqual([...db.appeler('pieces:contenu', pj).contenu], [0, 1, 2, 250, 255]);
  assert.strictEqual(db.appeler('evenements:list', { jeune_id: a }).find((e) => e.id === abs1).nb_pieces, 1);
  assert.throws(() => db.appeler('pieces:ajouter', { evenement_id: abs1, nom: 'gros.bin', contenu: Buffer.alloc(10 * 1024 * 1024 + 1) }), /trop volumineux/);
  assert.throws(() => db.appeler('pieces:ajouter', { evenement_id: abs1, nom: 'vide.txt', contenu: Buffer.alloc(0) }), /vide/);
  assert.throws(() => db.appeler('pieces:ajouter', { evenement_id: 999, nom: 'x', contenu }), /introuvable/);

  // supprimer l'absence supprime ses pièces ; supprimer l'apprenti supprime ses absences
  db.appeler('evenements:delete', abs1);
  assert.strictEqual(db.appeler('pieces:list', abs1).length, 0);
  db.appeler('jeunes:delete', a);
  assert.strictEqual(db.appeler('evenements:list').length, 1);
  db.fermer();
});

