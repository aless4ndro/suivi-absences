const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { ouvrir, MIGRATIONS } = require('./db.cjs');

test('schéma, classes par défaut, jeunes et entreprises', () => {
  const db = ouvrir(':memory:');
  const classes = db.appeler('classes:list');
  assert.deepStrictEqual(classes.map((c) => c.code), ['GPME 1ère année', 'GPME 2ème année', 'MCO 1ère année', 'MCO 2ème année', 'NDRC 1ère année', 'NDRC 2ème année', 'LCVM 3ème année']);
  assert.ok(db.appeler('motifs:list').length >= 2);

  const eid = db.appeler('entreprises:save', { nom: ' Boulangerie Martin ', email: 'contact@martin.example' });
  const jid = db.appeler('jeunes:save', {
    nom: 'Durand', prenom: 'Léa', classe_id: classes[2].id, entreprise_id: eid,
    maitre_nom: 'M. Martin', maitre_email: '',
  });
  let jeunes = db.appeler('jeunes:list');
  assert.strictEqual(jeunes.length, 1);
  assert.strictEqual(jeunes[0].entreprise_nom, 'Boulangerie Martin');
  assert.strictEqual(jeunes[0].classe_code, 'MCO 1ère année');
  assert.strictEqual(jeunes[0].maitre_email, null);

  db.appeler('jeunes:save', { id: jid, nom: 'Durand', prenom: 'Léa', classe_id: classes[0].id, entreprise_id: eid });
  assert.strictEqual(db.appeler('jeunes:list')[0].classe_code, 'GPME 1ère année');
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

test('absences et retards : créneaux, durée calculée, chevauchements, filtres, alertes, pièces jointes', () => {
  const db = ouvrir(':memory:');
  const [gpme1, gpme2] = db.appeler('classes:list');
  const eid = db.appeler('entreprises:save', { nom: 'Boulangerie Martin' });
  const a = db.appeler('jeunes:save', { nom: 'Durand', prenom: 'Léa', classe_id: gpme1.id, entreprise_id: eid });
  const b = db.appeler('jeunes:save', { nom: 'Petit', prenom: 'Sam', classe_id: gpme2.id });
  const recevable = db.appeler('motifs:list').find((m) => m.statut === 'recevable');
  const irrecevable = db.appeler('motifs:list').find((m) => m.statut === 'irrecevable');
  const cren = (date, heure_debut, heure_fin) => ({ date, heure_debut, heure_fin });

  const base = {
    jeune_id: a, type: 'absence',
    creneaux: [cren('2026-11-12', '13:30', '17:05'), cren('2026-11-10', '08:30', '12:00')], // désordre volontaire
  };
  const abs1 = db.appeler('evenements:save', { ...base, observations: ' mal de dos ', mail_copie: 'Bonjour...' });
  const ret1 = db.appeler('evenements:save', { jeune_id: a, type: 'retard', creneaux: [cren('2026-11-13', '08:30', '08:42')], motif_id: irrecevable.id });
  const abs2 = db.appeler('evenements:save', { jeune_id: b, type: 'absence', creneaux: [cren('2026-12-02', '14:00', '16:00')], motif_id: recevable.id });

  const tous = db.appeler('evenements:list');
  assert.strictEqual(tous.length, 3);
  assert.strictEqual(tous[0].id, abs2); // plus récent d'abord
  const e1 = tous.find((e) => e.id === abs1);
  assert.strictEqual(e1.duree_minutes, 210 + 215); // 3 h 30 + 3 h 35, calculé tout seul à la minute
  assert.strictEqual(e1.date_debut, '2026-11-10');
  assert.strictEqual(e1.date_fin, '2026-11-12');
  assert.deepStrictEqual(e1.creneaux.map((c) => [c.date, c.heure_debut, c.heure_fin, c.duree_minutes]),
    [['2026-11-10', '08:30', '12:00', 210], ['2026-11-12', '13:30', '17:05', 215]]); // triés par date
  assert.strictEqual(e1.observations, 'mal de dos');
  assert.strictEqual(e1.entreprise_nom, 'Boulangerie Martin');
  assert.strictEqual(e1.motif_id, null);
  const r1 = tous.find((e) => e.id === ret1);
  assert.strictEqual(r1.date_fin, null); // un retard n'a pas de date de fin
  assert.strictEqual(r1.duree_minutes, 12);
  assert.strictEqual(tous.find((e) => e.id === abs2).date_fin, '2026-12-02');

  // validations
  const ok = [cren('2026-11-20', '08:30', '10:00')];
  assert.throws(() => db.appeler('evenements:save', { ...base, jeune_id: 999 }), /apprenti/);
  assert.throws(() => db.appeler('evenements:save', { ...base, type: 'autre' }), /absence ou retard/);
  assert.throws(() => db.appeler('evenements:save', { jeune_id: a, type: 'absence', creneaux: [] }), /au moins un créneau/);
  assert.throws(() => db.appeler('evenements:save', { jeune_id: a, type: 'absence' }), /au moins un créneau/);
  assert.throws(() => db.appeler('evenements:save', { jeune_id: a, type: 'retard', creneaux: [ok[0], cren('2026-11-21', '08:30', '09:00')] }), /une seule ligne/);
  assert.throws(() => db.appeler('evenements:save', { jeune_id: a, type: 'absence', creneaux: [cren('2026-02-30', '08:00', '09:00')] }), /date est invalide/);
  assert.throws(() => db.appeler('evenements:save', { jeune_id: a, type: 'absence', creneaux: [cren('2026-11-20', '25:00', '26:00')] }), /heures sont invalides/);
  assert.throws(() => db.appeler('evenements:save', { jeune_id: a, type: 'absence', creneaux: [cren('2026-11-20', '10:00', '10:00')] }), /après l'heure de début/);
  assert.throws(() => db.appeler('evenements:save', { jeune_id: a, type: 'absence', creneaux: [cren('2026-11-20', '10:00', '09:00')] }), /après l'heure de début/);
  assert.throws(() => db.appeler('evenements:save', { jeune_id: a, type: 'absence', creneaux: [cren('2026-11-20', '09:00', '11:00'), cren('2026-11-20', '10:00', '12:00')] }), /se chevauchent le 20\/11\/2026/);
  assert.throws(() => db.appeler('evenements:save', { jeune_id: a, type: 'absence', creneaux: ok, motif_id: 999 }), /motif/);
  assert.throws(() => db.appeler('evenements:save', { ...base, id: 999 }), /introuvable/);
  assert.strictEqual(db.appeler('evenements:list').length, 3); // aucun enregistrement partiel après une erreur

  // pas de doublon : même apprenti, créneau qui recouvre un existant
  assert.throws(() => db.appeler('evenements:save', { jeune_id: a, type: 'absence', creneaux: [cren('2026-11-10', '11:00', '13:00')] }), /chevauche une absence déjà enregistrée \(08:30 à 12:00\)/);
  assert.throws(() => db.appeler('evenements:save', { jeune_id: a, type: 'absence', creneaux: [cren('2026-11-13', '08:00', '09:00')] }), /chevauche un retard déjà enregistré/);
  db.appeler('evenements:save', { jeune_id: a, type: 'absence', creneaux: [cren('2026-11-10', '12:00', '13:00')] }); // bout à bout : autorisé
  db.appeler('evenements:save', { jeune_id: b, type: 'absence', creneaux: [cren('2026-11-10', '08:30', '12:00')] }); // autre apprenti : autorisé
  // modifier une absence sans changer ses créneaux ne se heurte pas à elle-même
  db.appeler('evenements:save', { ...base, id: abs1 });
  assert.strictEqual(db.appeler('evenements:list').length, 5);
  db.appeler('evenements:delete', db.appeler('evenements:list', { jeune_id: a }).find((e) => e.date_debut === '2026-11-10' && e.duree_minutes === 60).id);
  db.appeler('evenements:delete', db.appeler('evenements:list', { jeune_id: b }).find((e) => e.date_debut === '2026-11-10').id);
  assert.strictEqual(db.appeler('evenements:list').length, 3);

  // modification : les créneaux sont remplacés
  db.appeler('evenements:save', { ...base, id: abs1, creneaux: [cren('2026-11-10', '08:30', '09:15')] });
  const modif = db.appeler('evenements:list').find((e) => e.id === abs1);
  assert.strictEqual(modif.duree_minutes, 45);
  assert.strictEqual(modif.creneaux.length, 1);
  db.appeler('evenements:save', { ...base, id: abs1 }); // retour aux deux créneaux

  // filtres
  const n = (f) => db.appeler('evenements:list', f).length;
  assert.strictEqual(n({ jeune_id: a }), 2);
  assert.strictEqual(n({ classe_id: gpme2.id }), 1);
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
  assert.strictEqual(det.classe_code, 'GPME 1ère année');
  assert.strictEqual(det.creneaux.length, 2);
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

  // supprimer l'absence supprime ses pièces et ses créneaux ; supprimer l'apprenti supprime ses absences
  db.appeler('evenements:delete', abs1);
  assert.strictEqual(db.appeler('pieces:list', abs1).length, 0);
  db.appeler('jeunes:delete', a);
  assert.strictEqual(db.appeler('evenements:list').length, 1);
  db.fermer();
});

test('migration : une base existante garde ses classes et apprentis, et passe à 7 classes', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-migration-'));
  const chemin = path.join(dossier, 'ancienne.db');

  // base telle que créée par la version précédente (4 premières migrations) : 4 classes, un apprenti en MCO
  const ancienne = new DatabaseSync(chemin);
  for (const m of MIGRATIONS.slice(0, 4)) ancienne.exec(m);
  ancienne.exec('PRAGMA user_version = 4');
  const mco = ancienne.prepare("SELECT id FROM classes WHERE code = 'MCO'").get().id;
  ancienne.prepare("INSERT INTO jeunes (nom, prenom, classe_id) VALUES ('Durand', 'Léa', ?)").run(mco);
  ancienne.close();

  const db = ouvrir(chemin);
  const classes = db.appeler('classes:list');
  assert.deepStrictEqual(classes.map((c) => c.code), [
    'GPME 1ère année', 'GPME 2ème année', 'MCO 1ère année', 'MCO 2ème année',
    'NDRC 1ère année', 'NDRC 2ème année', 'LCVM 3ème année',
  ]);
  const apprenti = db.appeler('jeunes:list')[0];
  assert.strictEqual(apprenti.nom, 'Durand');
  assert.strictEqual(apprenti.classe_code, 'MCO 1ère année'); // l'apprenti reste dans sa classe
  db.fermer();
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('interlocuteurs, destinataires, horaires de journée et pièces sur la liste', () => {
  const db = ouvrir(':memory:');
  const cl = db.appeler('classes:list')[0].id;
  const eid = db.appeler('entreprises:save', { nom: 'Martin SA', email: 'rh@martin.example', telephone: '0102030405' });
  const jid = db.appeler('jeunes:save', { nom: 'Durand', prenom: 'Léa', classe_id: cl, entreprise_id: eid, maitre_nom: 'M. Martin', maitre_email: 'maitre@martin.example' });
  const cid = db.appeler('contacts:save', { entreprise_id: eid, nom: 'Mme Petit', fonction: 'Comptabilité', email: 'compta@martin.example' });
  db.appeler('contacts:save', { entreprise_id: eid, nom: 'Sans mail' });
  assert.throws(() => db.appeler('contacts:save', { entreprise_id: eid, nom: '' }));
  assert.throws(() => db.appeler('contacts:save', { entreprise_id: 9999, nom: 'X' }));
  assert.strictEqual(db.appeler('contacts:list', eid).length, 2);
  assert.deepStrictEqual(db.appeler('destinataires:list', jid).map((d) => d.email), ['maitre@martin.example', 'rh@martin.example', 'compta@martin.example']);
  assert.strictEqual(db.appeler('jeunes:list')[0].entreprise_telephone, '0102030405');

  // horaires : défauts puis modification, avec contrôle de cohérence
  assert.deepStrictEqual(db.appeler('horaires:get'), { debut: '08:30', pause_debut: '12:30', pause_fin: '14:00', fin: '17:30' });
  assert.throws(() => db.appeler('horaires:save', { debut: '08:00', pause_debut: '14:00', pause_fin: '12:00', fin: '17:00' }));
  db.appeler('horaires:save', { debut: '08:00', pause_debut: '12:00', pause_fin: '13:30', fin: '17:00' });
  assert.strictEqual(db.appeler('horaires:get').pause_fin, '13:30');

  // un arrêt de plusieurs jours = un événement, deux créneaux par jour (matin, après-midi)
  const creneaux = ['2026-11-16', '2026-11-17'].flatMap((date) => [
    { date, heure_debut: '08:00', heure_fin: '12:00' }, { date, heure_debut: '13:30', heure_fin: '17:00' },
  ]);
  const ev = db.appeler('evenements:save', { jeune_id: jid, type: 'absence', creneaux });
  const pid = db.appeler('pieces:ajouter', { evenement_id: ev, nom: 'arret.pdf', contenu: Buffer.from('x') });
  const l = db.appeler('evenements:list')[0];
  assert.strictEqual(l.duree_minutes, 2 * (240 + 210));
  assert.strictEqual(l.date_fin, '2026-11-17');
  assert.deepStrictEqual(l.pieces.map((p) => p.id), [pid]);
  assert.strictEqual(db.appeler('evenements:detail', ev).destinataires.length, 3);

  // supprimer l'entreprise supprime ses interlocuteurs
  db.appeler('contacts:delete', cid);
  db.appeler('entreprises:delete', eid);
  assert.strictEqual(db.appeler('contacts:list', eid).length, 0);
  db.fermer();
});

test('migration : copie de sécurité créée avant la mise à niveau, données conservées', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-copie-'));
  const chemin = path.join(dossier, 'base.db');
  const ancienne = new DatabaseSync(chemin);
  for (const m of MIGRATIONS.slice(0, 5)) ancienne.exec(m);
  ancienne.exec('PRAGMA user_version = 5');
  ancienne.prepare("INSERT INTO jeunes (nom, prenom, classe_id) VALUES ('Durand', 'Léa', 1)").run();
  ancienne.close();

  const db = ouvrir(chemin);
  assert.strictEqual(db.appeler('jeunes:list').length, 1);
  db.fermer();
  const copie = `${chemin}.avant-mise-a-jour-v5.bak`;
  assert.ok(fs.existsSync(copie));
  const c = new DatabaseSync(copie);
  assert.strictEqual(c.prepare('SELECT COUNT(*) AS n FROM jeunes').get().n, 1);
  assert.strictEqual(c.prepare('PRAGMA user_version').get().user_version, 5); // la copie reste dans l'ancien état
  c.close();
  fs.rmSync(dossier, { recursive: true, force: true });
});
