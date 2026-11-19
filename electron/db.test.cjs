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
  assert.deepStrictEqual(classes.map((c) => c.code), ['GPME 1ère année', 'GPME 2ème année', 'MCO 1ère année', 'MCO 2ème année', 'NDRC 1ère année', 'NDRC 2ème année', 'LCVM 3ème année', 'DTS IMRT 1ère année', 'DTS IMRT 2ème année', 'DTS IMRT 3ème année']);
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

test('migration : une base existante garde ses classes et apprentis, et passe à 10 classes', () => {
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
    'DTS IMRT 1ère année', 'DTS IMRT 2ème année', 'DTS IMRT 3ème année',
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
  assert.deepStrictEqual(db.appeler('horaires:get'), { debut: '08:30', pause_debut: '12:30', pause_fin: '14:00', fin: '18:00' });
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

test('calendrier : chargé pour les 7 classes, modifiable, conservé à la migration', () => {
  const db = ouvrir(':memory:');
  const classes = db.appeler('classes:list');
  for (const c of classes.filter((x) => !x.code.startsWith('DTS'))) assert.ok(db.appeler('calendrier:annee', c.id).length > 200, c.code);
  assert.strictEqual(db.appeler('calendrier:annee', classes.find((x) => x.code === 'DTS IMRT 1ère année').id).length, 0); // calendrier DTS pas encore fourni
  const gpme1 = classes.find((c) => c.code === 'GPME 1ère année').id;
  const cal = Object.fromEntries(db.appeler('calendrier:annee', gpme1).map((j) => [j.date, j]));
  // lecture du PDF : 1er au 4 septembre en centre, 9 en entreprise, jour d'intégration le 15 octobre (centre)
  assert.strictEqual(cal['2026-09-01'].type, 'centre');
  assert.strictEqual(cal['2026-09-09'].type, 'entreprise');
  assert.strictEqual(cal['2026-10-15'].libelle, "Jour d'intégration");
  assert.strictEqual(cal['2026-12-10'].libelle, 'BTS blanc');
  assert.strictEqual(cal['2026-09-05'], undefined); // pas de week-end
  db.appeler('calendrier:jour', { classe_id: gpme1, date: '2026-09-09', type: 'centre', libelle: 'Rattrapage' });
  assert.strictEqual(db.appeler('calendrier:annee', gpme1).find((j) => j.date === '2026-09-09').libelle, 'Rattrapage');
  db.appeler('calendrier:jour', { classe_id: gpme1, date: '2026-09-09', type: null });
  assert.ok(!db.appeler('calendrier:annee', gpme1).some((j) => j.date === '2026-09-09'));
  assert.throws(() => db.appeler('calendrier:jour', { classe_id: gpme1, date: 'x', type: 'centre' }));
  db.fermer();
});

test('rattrapages : seule une séance validée diminue le solde', () => {
  const db = ouvrir(':memory:');
  const cl = db.appeler('classes:list')[0].id;
  const motifs = db.appeler('motifs:list');
  const irrec = motifs.find((m) => m.statut === 'irrecevable').id;
  const recev = motifs.find((m) => m.statut === 'recevable').id;
  const j = db.appeler('jeunes:save', { nom: 'Durand', prenom: 'Léa', classe_id: cl, adresse: '2 rue X', code_postal: '27000', ville: 'Évreux', civilite: 'Madame' });
  // 14 h irrecevables (absence 12 h + retard 2 h) en octobre, + 3 h recevables qui ne comptent pas
  db.appeler('evenements:save', { jeune_id: j, type: 'absence', motif_id: irrec, creneaux: [{ date: '2026-10-05', heure_debut: '08:00', heure_fin: '20:00' }] });
  db.appeler('evenements:save', { jeune_id: j, type: 'retard', motif_id: irrec, creneaux: [{ date: '2026-10-06', heure_debut: '08:00', heure_fin: '10:00' }] });
  db.appeler('evenements:save', { jeune_id: j, type: 'absence', motif_id: recev, creneaux: [{ date: '2026-10-07', heure_debut: '08:00', heure_fin: '11:00' }] });
  // hors période : ne doit pas compter dans octobre
  db.appeler('evenements:save', { jeune_id: j, type: 'absence', motif_id: irrec, creneaux: [{ date: '2026-11-03', heure_debut: '08:00', heure_fin: '10:00' }] });

  const oct = { debut: '2026-10-01', fin: '2026-10-31' };
  let b = db.appeler('rattrapages:bilan', oct);
  assert.strictEqual(b.apprentis.length, 1);
  assert.strictEqual(b.apprentis[0].dues, 14 * 60);
  assert.strictEqual(b.apprentis[0].statut, 'a_programmer');
  assert.strictEqual(b.totaux.nb_absences, 1);
  assert.strictEqual(b.totaux.nb_retards, 1);

  // deux séances programmées (4 h + 6 h) : le solde ne bouge pas
  const s1 = db.appeler('rattrapages:seance:save', { jeune_id: j, date: '2026-11-18', heure_debut: '14:00', heure_fin: '18:00', periode_debut: oct.debut, periode_fin: oct.fin });
  const s2 = db.appeler('rattrapages:seance:save', { jeune_id: j, date: '2026-11-25', heure_debut: '08:00', heure_fin: '14:00', periode_debut: oct.debut, periode_fin: oct.fin });
  assert.throws(() => db.appeler('rattrapages:seance:save', { jeune_id: j, date: '2026-11-18', heure_debut: '17:00', heure_fin: '19:00' }), /Chevauchement/);
  assert.throws(() => db.appeler('rattrapages:seance:save', { jeune_id: j, date: '2026-11-19', heure_debut: '10:00', heure_fin: '09:00' }));
  b = db.appeler('rattrapages:bilan', oct).apprentis[0];
  assert.deepStrictEqual([b.programmees, b.validees, b.solde, b.statut, b.reste_a_programmer], [600, 0, 840, 'programme', 240]);

  // validation sans justificatif refusée, puis acceptée avec confirmation
  assert.throws(() => db.appeler('rattrapages:valider', { id: s1, statut: 'effectuee' }), /émargement/);
  db.appeler('rattrapages:valider', { id: s1, statut: 'effectuee', sans_justificatif: true });
  // seconde séance : justificatif signé, mais l'apprenti est parti plus tôt → 5 h validées seulement
  db.appeler('rattrapages:piece:ajouter', { seance_id: s2, nom: 'emargement.pdf', contenu: Buffer.from('pdf') });
  assert.throws(() => db.appeler('rattrapages:piece:ajouter', { seance_id: s2, nom: 'virus.exe', contenu: Buffer.from('x') }), /PDF, JPG et PNG/);
  assert.throws(() => db.appeler('rattrapages:valider', { id: s2, statut: 'effectuee', duree_validee_minutes: 7 * 60 }), /comprises/);
  db.appeler('rattrapages:valider', { id: s2, statut: 'effectuee', duree_validee_minutes: 5 * 60 });
  b = db.appeler('rattrapages:bilan', oct).apprentis[0];
  assert.deepStrictEqual([b.programmees, b.validees, b.solde, b.statut], [0, 9 * 60, 5 * 60, 'partiel']);

  // séance validée : ni modifiable ni supprimable ; l'annulation remet le solde
  assert.throws(() => db.appeler('rattrapages:seance:delete', s1));
  db.appeler('rattrapages:annuler-validation', s1);
  assert.strictEqual(db.appeler('rattrapages:bilan', oct).apprentis[0].solde, 9 * 60);
  db.appeler('rattrapages:valider', { id: s1, statut: 'non_effectuee' });
  b = db.appeler('rattrapages:bilan', oct).apprentis[0];
  assert.deepStrictEqual([b.validees, b.solde, b.nb_non_effectuees], [5 * 60, 9 * 60, 1]);

  // la période de novembre ne voit pas les séances d'octobre et ne mélange pas les compteurs
  assert.strictEqual(db.appeler('rattrapages:bilan', { debut: '2026-11-01', fin: '2026-11-30' }).apprentis[0].dues, 120);

  // document : solde avant séance et données de l'apprenti
  const doc = db.appeler('rattrapages:document', { ids: [s2] });
  assert.strictEqual(doc.dues, 14 * 60);
  assert.strictEqual(doc.jeune.ville, 'Évreux');
  assert.strictEqual(doc.etablissement.ville, 'Évreux');
  // récapitulatif employeur du mois
  const r = db.appeler('recap:donnees', { jeune_id: j, debut: '2026-10-01', fin: '2026-10-31' });
  assert.strictEqual(r.evenements.length, 2); // absence et retard irrecevables d'octobre
  assert.strictEqual(r.min_rattrapees, 5 * 60);
  assert.strictEqual(r.pieces.length, 1);
  // l'historique a tout gardé
  const h = db.appeler('rattrapages:historique', j).map((x) => x.action);
  for (const a of ['seance_programmee', 'seance_validee', 'validation_annulee', 'seance_non_effectuee', 'emargement_importe']) assert.ok(h.includes(a), a);
  db.fermer();
});

test('professeurs principaux : fiches, affectations datées, remplacement, historique, destinataires', () => {
  const db = ouvrir(':memory:');
  const classes = db.appeler('classes:list');
  const mco1 = classes.find((c) => c.code === 'MCO 1ère année');
  const ndrc1 = classes.find((c) => c.code === 'NDRC 1ère année');

  const p1 = db.appeler('profs:save', { nom: 'Martin', prenom: 'Claire', email: 'c.martin@ecole.fr', telephone: '0600000000' });
  assert.throws(() => db.appeler('profs:save', { nom: 'Autre', prenom: 'X', email: 'C.MARTIN@ecole.fr' }), /déjà celle de Claire Martin/);
  assert.throws(() => db.appeler('profs:save', { nom: 'Y', prenom: 'Z', email: 'mauvaise' }), /invalide/);
  assert.ok(db.appeler('profs:save', { nom: 'MARTIN', prenom: 'Claire' }).a_confirmer); // homonyme : confirmation demandée
  const p2 = db.appeler('profs:save', { nom: 'Petit', prenom: 'Hugo', email: 'h.petit@ecole.fr' });

  // un professeur, plusieurs classes
  db.appeler('pp:affecter', { classe_id: mco1.id, professeur_id: p1, annee_scolaire: '2026-2027' });
  db.appeler('pp:affecter', { classe_id: ndrc1.id, professeur_id: p1, annee_scolaire: '2026-2027' });
  assert.strictEqual(db.appeler('pp:de', { classe_id: mco1.id, date: '2026-11-17' }).nom, 'Martin');
  assert.strictEqual(db.appeler('pp:de', { classe_id: mco1.id, date: '2027-09-02' }), null); // nouvelle année : rien d'office

  // remplacement en cours d'année : confirmation, puis ancienne affectation close la veille
  const rep = { classe_id: mco1.id, professeur_id: p2, annee_scolaire: '2026-2027', date_debut: '2027-01-04' };
  assert.ok(db.appeler('pp:affecter', rep).a_confirmer);
  db.appeler('pp:affecter', { ...rep, remplacer: true });
  assert.strictEqual(db.appeler('pp:de', { classe_id: mco1.id, date: '2027-01-03' }).nom, 'Martin');
  assert.strictEqual(db.appeler('pp:de', { classe_id: mco1.id, date: '2027-01-04' }).nom, 'Petit');
  const histo = db.appeler('pp:list', { classe_id: mco1.id, historique: true });
  assert.strictEqual(histo.length, 2);
  assert.strictEqual(histo.find((h) => h.nom === 'Martin').date_fin, '2027-01-03');
  assert.throws(() => db.appeler('pp:affecter', { classe_id: mco1.id, professeur_id: p2, annee_scolaire: '2026-2027', date_debut: '2027-09-01' }), /comprise dans l'année scolaire/);

  // fiche utilisée : pas de suppression, et pas de désactivation tant qu'une affectation court
  assert.throws(() => db.appeler('profs:delete', p1), /Désactivez/);

  // destinataires d'un apprenti de MCO 1 : le professeur principal est proposé selon la date
  const jid = db.appeler('jeunes:save', { nom: 'Durand', prenom: 'Léa', classe_id: mco1.id, maitre_email: 'maitre@x.fr' });
  const avant = db.appeler('destinataires:list', { jeune_id: jid, date: '2026-12-01' });
  assert.ok(avant.some((d) => d.role === 'pp' && d.email === 'c.martin@ecole.fr'));
  const apres = db.appeler('destinataires:list', { jeune_id: jid, date: '2027-02-01' });
  assert.ok(apres.some((d) => d.role === 'pp' && d.email === 'h.petit@ecole.fr'));

  // une modification de la fiche est reprise partout
  db.appeler('profs:save', { id: p2, nom: 'Petit', prenom: 'Hugo', email: 'hugo.petit@ecole.fr' });
  assert.ok(db.appeler('destinataires:list', { jeune_id: jid, date: '2027-02-01' }).some((d) => d.email === 'hugo.petit@ecole.fr'));

  const al = db.appeler('pp:alertes', '2026-2027');
  assert.ok(al.sans_pp.includes('GPME 1ère année'));
  db.fermer();
});

test('passage de classe : les absences passées restent dans l\'ancienne classe, avec son professeur principal', () => {
  const db = ouvrir(':memory:');
  const classes = db.appeler('classes:list');
  const g1 = classes.find((c) => c.code === 'GPME 1ère année');
  const g2 = classes.find((c) => c.code === 'GPME 2ème année');
  const pa = db.appeler('profs:save', { nom: 'Avant', prenom: 'Anne', email: 'anne@ecole.fr' });
  const pb = db.appeler('profs:save', { nom: 'Apres', prenom: 'Bruno', email: 'bruno@ecole.fr' });
  db.appeler('pp:affecter', { classe_id: g1.id, professeur_id: pa, annee_scolaire: '2025-2026' });
  db.appeler('pp:affecter', { classe_id: g2.id, professeur_id: pb, annee_scolaire: '2026-2027' });

  const jid = db.appeler('jeunes:save', { nom: 'Durand', prenom: 'Léa', classe_id: g1.id });
  const irrec = db.appeler('motifs:list').find((m) => m.statut === 'irrecevable').id;
  db.appeler('evenements:save', { jeune_id: jid, type: 'absence', motif_id: irrec, creneaux: [{ date: '2026-06-10', heure_debut: '08:30', heure_fin: '12:30' }] });

  // passage en 2ème année au 1er septembre 2026
  assert.strictEqual(db.appeler('jeunes:passage', { ids: [jid], classe_id: g2.id, date: '2026-09-01' }), 1);
  db.appeler('evenements:save', { jeune_id: jid, type: 'retard', creneaux: [{ date: '2026-10-05', heure_debut: '08:30', heure_fin: '09:00' }] });

  assert.strictEqual(db.appeler('jeunes:list')[0].classe_code, 'GPME 2ème année');
  const evts = db.appeler('evenements:list');
  assert.strictEqual(evts.find((e) => e.type === 'absence').classe_code, 'GPME 1ère année');
  assert.strictEqual(evts.find((e) => e.type === 'retard').classe_code, 'GPME 2ème année');
  assert.strictEqual(db.appeler('evenements:list', { classe_id: g1.id }).length, 1);

  // le mail sur l'absence de juin propose l'ancien professeur principal
  const absence = evts.find((e) => e.type === 'absence');
  assert.ok(db.appeler('evenements:detail', absence.id).destinataires.some((d) => d.email === 'anne@ecole.fr'));
  assert.ok(db.appeler('destinataires:list', { jeune_id: jid, date: '2026-10-05' }).some((d) => d.email === 'bruno@ecole.fr'));

  // récapitulatif de juin : classé en 1ère année
  assert.strictEqual(db.appeler('rattrapages:bilan', { debut: '2026-06-01', fin: '2026-06-30', classe_id: g1.id }).apprentis.length, 1);

  // historique, puis passage programmé pour une date future et annulé
  assert.strictEqual(db.appeler('jeunes:classes', jid).length, 2);
  db.appeler('jeunes:passage', { ids: [jid], classe_id: g1.id, date: '2099-09-01' });
  assert.strictEqual(db.appeler('jeunes:list')[0].passage_prevu.date, '2099-09-01');
  assert.strictEqual(db.appeler('jeunes:list')[0].classe_code, 'GPME 2ème année'); // pas encore appliqué
  const prevu = db.appeler('jeunes:classes', jid).find((l) => l.date_debut === '2099-09-01');
  db.appeler('jeunes:classe:supprimer', prevu.id);
  assert.strictEqual(db.appeler('jeunes:list')[0].passage_prevu, null);

  // correction d'une erreur de saisie : pas de nouvelle ligne d'historique
  const j = db.appeler('jeunes:list')[0];
  db.appeler('jeunes:save', { ...j, classe_id: classes.find((c) => c.code === 'MCO 2ème année').id, classe_correction: true });
  assert.strictEqual(db.appeler('jeunes:classes', jid).length, 2);
  assert.strictEqual(db.appeler('jeunes:list')[0].classe_code, 'MCO 2ème année');
  db.fermer();
});

test('bascule de rentrée : passage, redoublement, sorties ; historique entreprise et maître conservé', () => {
  const db = ouvrir(':memory:');
  const classes = db.appeler('classes:list');
  const g1 = classes.find((c) => c.code === 'GPME 1ère année');
  const g2 = classes.find((c) => c.code === 'GPME 2ème année');
  const irrec = db.appeler('motifs:list').find((m) => m.statut === 'irrecevable').id;
  const e1 = db.appeler('entreprises:save', { nom: 'Ancienne SA', email: 'rh@ancienne.fr' });
  const e2 = db.appeler('entreprises:save', { nom: 'Nouvelle SARL', email: 'rh@nouvelle.fr' });

  const mk = (nom) => db.appeler('jeunes:save', { nom, prenom: 'X', classe_id: g1.id, entreprise_id: e1, maitre_nom: 'M. Ancien', maitre_email: 'ancien@ancienne.fr' });
  const passe = mk('Passe'); const redouble = mk('Redouble'); const demissionne = mk('Demissionne'); const reste = mk('Reste');
  db.appeler('evenements:save', { jeune_id: demissionne, type: 'absence', motif_id: irrec, creneaux: [{ date: '2026-06-10', heure_debut: '08:30', heure_fin: '12:30' }] });

  const bilan = db.appeler('jeunes:bascule', {
    date: '2026-09-01',
    decisions: [
      { id: passe, action: 'passe', classe_id: g2.id },
      { id: redouble, action: 'redouble' },
      { id: demissionne, action: 'sort', motif: 'demission' },
      { id: reste, action: 'reste' },
    ],
  });
  assert.deepStrictEqual(bilan, { passe: 1, redouble: 1, sort: 1, reste: 1 });
  const par = (n) => db.appeler('jeunes:list', { tous: true }).find((j) => j.nom === n);
  assert.strictEqual(par('Passe').classe_code, 'GPME 2ème année');
  assert.strictEqual(par('Redouble').classe_code, 'GPME 1ère année');
  assert.strictEqual(db.appeler('jeunes:classes', redouble).find((l) => l.type === 'redoublement').date_debut, '2026-09-01');
  assert.ok(par('Demissionne').sorti);

  // le sorti disparaît des listes, des effectifs et du bilan, mais pas de l'historique
  assert.ok(!db.appeler('jeunes:list').some((j) => j.nom === 'Demissionne'));
  assert.strictEqual(db.appeler('stats').classes.find((c) => c.id === g1.id).nb_jeunes, 2);
  assert.ok(!db.appeler('rattrapages:bilan', { debut: '2026-09-01', fin: '2026-09-30' }).apprentis.some((a) => a.nom === 'Demissionne'));
  assert.ok(db.appeler('rattrapages:bilan', { debut: '2026-06-01', fin: '2026-06-30' }).apprentis.some((a) => a.nom === 'Demissionne'));
  assert.strictEqual(db.appeler('evenements:list', { jeune_id: demissionne }).length, 1);
  assert.throws(() => db.appeler('evenements:save', { jeune_id: demissionne, type: 'absence', creneaux: [{ date: '2026-10-01', heure_debut: '08:30', heure_fin: '12:30' }] }), /sorti de la formation/);
  db.appeler('jeunes:reintegrer', demissionne);
  assert.ok(db.appeler('jeunes:list').some((j) => j.nom === 'Demissionne'));
  assert.throws(() => db.appeler('jeunes:bascule', { date: '2026-09-01', decisions: [{ id: passe, action: 'sort', motif: 'inconnu' }] }), /motif/);

  // changement d'employeur au 1er janvier 2027 : les absences passées gardent l'ancien maître
  db.appeler('evenements:save', { jeune_id: passe, type: 'absence', motif_id: irrec, creneaux: [{ date: '2026-11-10', heure_debut: '08:30', heure_fin: '12:30' }] });
  const j = par('Passe');
  db.appeler('jeunes:save', { ...j, entreprise_id: e2, maitre_nom: 'Mme Nouvelle', maitre_email: 'nouvelle@nouvelle.fr', contrat_depuis: '2027-01-01' });
  assert.strictEqual(par('Passe').maitre_nom, 'M. Ancien'); // pas encore en vigueur
  db.appeler('evenements:save', { jeune_id: passe, type: 'retard', motif_id: irrec, creneaux: [{ date: '2027-02-02', heure_debut: '08:30', heure_fin: '09:00' }] });
  const evts = db.appeler('evenements:list', { jeune_id: passe });
  assert.strictEqual(evts.find((e) => e.type === 'absence').entreprise_nom, 'Ancienne SA');
  assert.strictEqual(evts.find((e) => e.type === 'retard').entreprise_nom, 'Nouvelle SARL');
  const vieux = db.appeler('evenements:detail', evts.find((e) => e.type === 'absence').id);
  assert.strictEqual(vieux.maitre_email, 'ancien@ancienne.fr');
  assert.ok(vieux.destinataires.some((d) => d.email === 'rh@ancienne.fr') && !vieux.destinataires.some((d) => d.email === 'rh@nouvelle.fr'));
  assert.ok(db.appeler('destinataires:list', { jeune_id: passe, date: '2027-02-02' }).some((d) => d.email === 'nouvelle@nouvelle.fr'));
  assert.strictEqual(db.appeler('jeunes:contrats', passe).length, 2);

  // correction d'une faute de frappe : pas de nouvelle ligne
  db.appeler('jeunes:save', { ...par('Reste'), maitre_nom: 'M. Anciens', contrat_correction: true });
  assert.strictEqual(db.appeler('jeunes:contrats', reste).length, 1);
  assert.strictEqual(par('Reste').maitre_nom, 'M. Anciens');
  db.fermer();
});

test('recherche : accents, ordre nom/prénom, fragments, SIRET, apprentis sortis avec leur année', () => {
  const db = ouvrir(':memory:');
  const classes = db.appeler('classes:list');
  const mco = classes.find((c) => c.code === 'MCO 1ère année');
  const ent = db.appeler('entreprises:save', { nom: 'Boulangerie Éléonore SARL', nom_commercial: 'Chez Léo', siret: '552 081 317 00019' });
  db.appeler('entreprises:save', { nom: 'Garage Martin' }); // aucune apprentie rattachée : retrouvable quand même
  const a = db.appeler('jeunes:save', { nom: 'Gérard', prenom: 'Hélène', classe_id: mco.id, entreprise_id: ent });
  const b = db.appeler('jeunes:save', { nom: 'Martin', prenom: 'Hugo', classe_id: mco.id });
  const quoi = (q) => db.appeler('recherche', { q }).resultats.map((r) => `${r.type}:${r.libelle}`);

  assert.deepStrictEqual(quoi('helene'), ['apprenti:Hélène GÉRARD']); // sans accent ni majuscule
  assert.deepStrictEqual(quoi('GERARD hel'), ['apprenti:Hélène GÉRARD']); // ordre libre, fragments
  assert.deepStrictEqual(quoi('mco gerard'), ['apprenti:Hélène GÉRARD']); // classe
  assert.deepStrictEqual(quoi('martin'), ['apprenti:Hugo MARTIN', 'entreprise:Garage Martin']); // nom commençant par la saisie d'abord
  assert.deepStrictEqual(quoi('chez leo'), ['entreprise:Boulangerie Éléonore SARL']); // nom commercial
  assert.deepStrictEqual(quoi('552081'), ['entreprise:Boulangerie Éléonore SARL']); // SIRET partiel
  assert.deepStrictEqual(quoi('zzz'), []);
  assert.deepStrictEqual(quoi('   '), []);
  assert.strictEqual(db.appeler('recherche', { q: 'martin', limite: 1 }).resultats.length, 1);

  // un apprenti sorti reste retrouvable, avec l'année de sa dernière classe
  db.appeler('jeunes:sortir', { id: b, date: '2026-09-01', motif: 'demission' });
  const sorti = db.appeler('recherche', { q: 'hugo' }).resultats[0];
  assert.strictEqual(sorti.sorti, true);
  assert.strictEqual(sorti.annee, '2025-2026');
  assert.strictEqual(sorti.classe, 'MCO 1ère année');
  assert.strictEqual(db.appeler('recherche', { q: 'gerard' }).resultats[0].annee, '2026-2027');
  assert.strictEqual(db.appeler('recherche', { q: 'eleonore' }).resultats[0].nb_apprentis, 1);

  // SIRET : format et unicité
  assert.throws(() => db.appeler('entreprises:save', { nom: 'X', siret: '123' }), /14 chiffres/);
  assert.throws(() => db.appeler('entreprises:save', { nom: 'Doublon', siret: '55208131700019' }), /déjà celui de/);
  db.appeler('entreprises:save', { id: ent, nom: 'Boulangerie Éléonore SARL', siret: '55208131700019' }); // sa propre fiche : accepté
  db.fermer();
});

test('fiche apprenti et fiche entreprise : assiduité, contrats (en cours, à venir, terminé, rompu), photo', () => {
  const db = ouvrir(':memory:');
  const classes = db.appeler('classes:list');
  const mco = classes.find((c) => c.code === 'MCO 1ère année');
  const motifs = db.appeler('motifs:list');
  const recevable = motifs.find((m) => m.statut === 'recevable').id;
  const irrec = motifs.find((m) => m.statut === 'irrecevable').id;
  const e1 = db.appeler('entreprises:save', { nom: 'Entreprise A' });
  const e2 = db.appeler('entreprises:save', { nom: 'Entreprise B' });
  const a = db.appeler('jeunes:save', { nom: 'Durand', prenom: 'Léa', classe_id: mco.id, entreprise_id: e1 });
  const un = (jid, type, date, motif, h1, h2) => db.appeler('evenements:save', { jeune_id: jid, type, motif_id: motif, creneaux: [{ date, heure_debut: h1, heure_fin: h2 }] });
  un(a, 'absence', '2026-10-05', recevable, '08:30', '12:30'); // justifiée 4 h
  un(a, 'absence', '2026-10-12', irrec, '08:30', '10:30'); // injustifiée 2 h
  un(a, 'absence', '2026-10-19', null, '14:00', '15:00'); // en attente 1 h
  un(a, 'retard', '2026-11-02', irrec, '08:30', '08:50'); // retard 20 min
  const b = db.appeler('jeunes:save', { nom: 'Autre', prenom: 'Zoé', classe_id: mco.id });
  un(b, 'absence', '2026-10-06', irrec, '08:30', '12:30'); // ne doit pas apparaître chez Léa

  const t = db.appeler('jeunes:assiduite', { id: a, debut: '2026-09-01', fin: '2027-08-31' });
  assert.deepStrictEqual([t.absences.nb, t.absences.minutes], [3, 420]);
  assert.deepStrictEqual([t.absences.justifiees.minutes, t.absences.injustifiees.minutes, t.absences.en_attente.minutes], [240, 120, 60]);
  assert.deepStrictEqual([t.retards.nb, t.retards.minutes, t.retards.injustifiees.nb], [1, 20, 1]);
  assert.strictEqual(t.evenements.length, 4);
  assert.strictEqual(t.rattrapage.dues, 140); // 2 h + 20 min irrecevables
  assert.strictEqual(db.appeler('jeunes:assiduite', { id: a, debut: '2026-11-01', fin: '2026-11-30' }).absences.nb, 0);
  assert.throws(() => db.appeler('jeunes:assiduite', { id: a, debut: '2026-12-01', fin: '2026-11-01' }), /Période invalide/);

  // contrat : dates saisies sur la fiche, statut calculé
  const fiche = () => db.appeler('jeunes:list').find((j) => j.id === a);
  assert.strictEqual(fiche().contrat_statut, 'en_cours'); // sans date : en cours
  db.appeler('jeunes:save', { ...fiche(), contrat_debut: '2026-09-01', contrat_fin: '2028-08-31' });
  assert.deepStrictEqual([fiche().contrat_debut, fiche().contrat_fin, fiche().contrat_statut], ['2026-09-01', '2028-08-31', 'en_cours']);
  assert.throws(() => db.appeler('jeunes:save', { ...fiche(), contrat_fin: '2026-01-01' }), /avant son début/);
  db.appeler('jeunes:save', { ...fiche(), contrat_debut: '2099-01-01', contrat_fin: null });
  assert.strictEqual(fiche().contrat_statut, 'a_venir');
  db.appeler('jeunes:save', { ...fiche(), contrat_debut: '2026-09-01', rupture_le: '2026-11-10' });
  assert.strictEqual(fiche().contrat_statut, 'rompu');
  db.appeler('jeunes:save', { ...fiche(), rupture_le: null });

  // changement d'employeur : l'ancien contrat est terminé chez A, le nouveau en cours chez B
  db.appeler('jeunes:save', { ...fiche(), entreprise_id: e2, contrat_depuis: '2099-01-01' });
  assert.deepStrictEqual(db.appeler('entreprises:apprentis', e1).map((x) => x.statut), ['en_cours']); // changement futur : rien ne bouge
  assert.deepStrictEqual(db.appeler('entreprises:apprentis', e2).map((x) => x.statut), ['a_venir']);
  db.appeler('jeunes:contrat:supprimer', db.appeler('jeunes:contrats', a)[0].id); // changement annulé
  db.appeler('jeunes:save', { ...fiche(), entreprise_id: e2, contrat_depuis: '2026-11-01' });
  const chezA = db.appeler('entreprises:apprentis', e1);
  const chezB = db.appeler('entreprises:apprentis', e2);
  assert.deepStrictEqual(chezA.map((x) => [x.nom, x.statut, x.contrat_fin]), [['Durand', 'termine', '2026-10-31']]);
  assert.deepStrictEqual(chezB.map((x) => [x.nom, x.statut, x.contrat_debut, x.classe_code]), [['Durand', 'en_cours', '2026-11-01', 'MCO 1ère année']]);
  assert.strictEqual(chezB[0].formation, 'BTS Management Commercial Opérationnel');

  // apprenti sorti pour démission : contrat rompu ; plusieurs apprentis triés (en cours avant terminés)
  db.appeler('jeunes:sortir', { id: b, date: '2026-10-20', motif: 'demission' });
  db.appeler('jeunes:save', { ...db.appeler('jeunes:list', { tous: true }).find((j) => j.id === b), entreprise_id: e2, contrat_depuis: '2026-09-15' });
  const liste = db.appeler('entreprises:apprentis', e2);
  assert.deepStrictEqual(liste.map((x) => [x.nom, x.statut]), [['Durand', 'en_cours'], ['Autre', 'rompu']]);
  assert.strictEqual(db.appeler('entreprises:apprentis', e1).length, 1);

  // photo : format contrôlé, séparée de la liste
  assert.throws(() => db.appeler('jeunes:photo:save', { id: a, donnees: 'pas une image' }), /invalide/);
  db.appeler('jeunes:photo:save', { id: a, donnees: 'data:image/jpeg;base64,/9j/4AAQ' });
  assert.strictEqual(db.appeler('jeunes:photo', a), 'data:image/jpeg;base64,/9j/4AAQ');
  assert.strictEqual(db.appeler('entreprises:apprentis', e2).find((x) => x.nom === 'Durand').photo, 'data:image/jpeg;base64,/9j/4AAQ');
  assert.ok(!('photo' in fiche()));
  db.appeler('jeunes:photo:supprimer', a);
  assert.strictEqual(db.appeler('jeunes:photo', a), null);
  db.fermer();
});

test('vacances scolaires zone B : chargées à la migration', () => {
  const db = ouvrir(':memory:');
  const v = db.appeler('vacances:list');
  assert.strictEqual(v.length, 6);
  assert.deepStrictEqual([v[0].debut, v[0].fin, v[0].libelle], ['2026-10-17', '2026-11-01', 'Vacances de la Toussaint']);
  assert.ok(v.every((x) => x.debut <= x.fin));
  assert.ok(v.some((x) => x.debut === '2027-02-20' && x.fin === '2027-03-07')); // hiver zone B
  assert.ok(v.some((x) => x.debut === '2027-04-17' && x.fin === '2027-05-02')); // printemps zone B
});

test('discipline : motifs, proposition de palier, décision humaine, journal, clôture', () => {
  const db = ouvrir(':memory:');
  const classes = db.appeler('classes:list');
  const a = db.appeler('jeunes:save', { nom: 'Martin', prenom: 'Zoé', classe_id: classes[0].id });
  const paliers = db.appeler('paliers:list');
  assert.deepStrictEqual(paliers.map((p) => p.ordre), [1, 2, 3, 4, 5]);
  const motifs = db.appeler('sanctions:motifs');
  assert.ok(motifs.length >= 8);
  const retards = motifs.find((m) => m.intitule === 'Retards répétés');
  assert.strictEqual(retards.palier_ordre, 1);

  // Aucun antécédent : palier du motif
  let prop = db.appeler('sanctions:proposer', { jeune_id: a, motif_id: retards.id, date_faits: '2026-10-05' });
  assert.strictEqual(prop.ordre, 1);

  // La sanction n'est jamais prononcée automatiquement
  const s1 = db.appeler('sanctions:save', { jeune_id: a, date_faits: '2026-10-05', motif_id: retards.id });
  let g = db.appeler('sanctions:get', s1);
  assert.strictEqual(g.decision, 'en_attente');
  assert.strictEqual(g.palier_propose_ordre, 1);
  assert.strictEqual(g.palier_retenu_id, null);
  assert.throws(() => db.appeler('sanctions:cloturer', s1), /décision/);

  // Décision humaine : avertissement
  db.appeler('sanctions:save', { ...g, id: s1, jeune_id: a, decision: 'sanction', palier_retenu_id: paliers[0].id, date_decision: '2026-10-06' });
  g = db.appeler('sanctions:get', s1);
  assert.strictEqual(g.decision, 'sanction');
  assert.strictEqual(g.palier_retenu_ordre, 1);
  assert.ok(g.journal.some((j) => j.action === 'Décision'));

  // Même motif dans la période → palier supérieur proposé, avec raisons
  prop = db.appeler('sanctions:proposer', { jeune_id: a, motif_id: retards.id, date_faits: '2026-11-10' });
  assert.strictEqual(prop.ordre, 2);
  assert.ok(prop.raisons.some((r) => /même motif/i.test(r)));
  assert.strictEqual(prop.precedentes.length, 1);

  // Autre motif : jamais en dessous du palier atteint
  const absences = motifs.find((m) => m.intitule === 'Absences injustifiées');
  prop = db.appeler('sanctions:proposer', { jeune_id: a, motif_id: absences.id, date_faits: '2026-11-10' });
  assert.strictEqual(prop.ordre, 1);

  // Ancienneté : au-delà de la durée réglée, la sanction ne compte plus
  prop = db.appeler('sanctions:proposer', { jeune_id: a, motif_id: retards.id, date_faits: '2027-11-10' });
  assert.strictEqual(prop.ordre, 1);
  assert.strictEqual(prop.precedentes[0].dans_periode, false);
  db.appeler('discipline:reglages:save', { historique_mois: 24 });
  prop = db.appeler('sanctions:proposer', { jeune_id: a, motif_id: retards.id, date_faits: '2027-11-10' });
  assert.strictEqual(prop.ordre, 2);
  assert.throws(() => db.appeler('discipline:reglages:save', { historique_mois: 0 }));

  // Choix différent de la proposition : justification conservée et modification tracée
  const s2 = db.appeler('sanctions:save', { jeune_id: a, date_faits: '2026-11-10', motif_id: retards.id });
  assert.strictEqual(db.appeler('sanctions:get', s2).palier_propose_ordre, 2);
  db.appeler('sanctions:save', { id: s2, jeune_id: a, date_faits: '2026-11-10', motif_id: retards.id, decision: 'sanction', palier_retenu_id: paliers[0].id, justification: 'Circonstances atténuantes' });
  g = db.appeler('sanctions:get', s2);
  assert.strictEqual(g.palier_retenu_ordre, 1);
  assert.strictEqual(g.palier_propose_ordre, 2);
  assert.strictEqual(g.justification, 'Circonstances atténuantes');
  db.appeler('sanctions:save', { id: s2, jeune_id: a, date_faits: '2026-11-10', motif_id: retards.id, decision: 'sanction', palier_retenu_id: paliers[1].id, justification: 'Circonstances atténuantes' });
  assert.ok(db.appeler('sanctions:get', s2).journal.some((j) => j.action === 'Modification' && /Avertissement → Blâme/.test(j.detail)));

  // Validations
  assert.throws(() => db.appeler('sanctions:save', { jeune_id: a, date_faits: '2099-01-01', motif_id: retards.id }), /futur/);
  assert.throws(() => db.appeler('sanctions:save', { jeune_id: a, date_faits: '2026-11-10', motif_id: retards.id, decision: 'sanction' }), /palier/);

  // Communication : palier 2 = facultative ; palier 3 = obligatoire, clôture bloquée tant qu'elle n'est pas faite
  g = db.appeler('sanctions:get', s2);
  assert.strictEqual(g.communication, 'facultative');
  const s3 = db.appeler('sanctions:save', { jeune_id: a, date_faits: '2026-11-12', motif_id: retards.id, decision: 'sanction', palier_retenu_id: paliers[2].id });
  assert.strictEqual(db.appeler('sanctions:get', s3).communication_manquante, true);
  assert.throws(() => db.appeler('sanctions:cloturer', s3), /obligatoire/);
  db.appeler('sanctions:communication:archiver', { sanction_id: s3, a: ['maitre@exemple.fr'], cc: [], cci: [], objet: 'Information', corps: 'Bonjour', methode: 'mailto' });
  assert.strictEqual(db.appeler('sanctions:get', s3).communication_manquante, false);
  db.appeler('sanctions:cloturer', s3);
  assert.throws(() => db.appeler('sanctions:save', { id: s3, jeune_id: a, date_faits: '2026-11-12', motif_id: retards.id, decision: 'rappel' }), /clôturé/);
  assert.strictEqual(db.appeler('sanctions:list', { jeune_id: a }).length, 3); // toujours consultable
  db.appeler('sanctions:rouvrir', s3);
  assert.throws(() => db.appeler('sanctions:supprimer', s3)); // décision prise : pas de suppression

  // Motif utilisé : désactivation possible, suppression refusée
  assert.throws(() => db.appeler('sanctions:motif:delete', retards.id), /désactivez/);
  db.appeler('sanctions:motif:save', { ...retards, actif: 0 });
  assert.strictEqual(db.appeler('sanctions:motifs').find((m) => m.id === retards.id).actif, 0);
});

test('discipline : intervenants, pièces, représentant légal des mineurs', () => {
  const db = ouvrir(':memory:');
  const classes = db.appeler('classes:list');
  const j = db.appeler('jeunes:save', { nom: 'Petit', prenom: 'Léo', classe_id: classes[0].id, date_naissance: '2010-03-01', representant_nom: 'Mme Petit', representant_email: 'parent@exemple.fr' });
  assert.throws(() => db.appeler('jeunes:save', { nom: 'X', prenom: 'Y', classe_id: classes[0].id, date_naissance: '2099-01-01' }), /naissance/);
  const i = db.appeler('intervenants:save', { nom: 'Mme Directrice', fonction: 'Direction', email: 'dir@exemple.fr' });
  assert.throws(() => db.appeler('intervenants:save', { nom: 'Z', email: 'pas-un-mail' }));
  const motif = db.appeler('sanctions:motifs')[0];
  const s = db.appeler('sanctions:save', { jeune_id: j, date_faits: '2026-11-02', motif_id: motif.id, intervenant_id: i });
  assert.strictEqual(db.appeler('sanctions:get', s).responsable_nom, 'Mme Directrice');
  const d = db.appeler('sanctions:destinataires', s);
  assert.strictEqual(d.mineur, true);
  assert.ok(d.destinataires.some((x) => x.role === 'representant' && x.email === 'parent@exemple.fr'));
  db.appeler('sanctions:piece:ajouter', { sanction_id: s, nom: 'preuve.pdf', contenu: Buffer.from('abc') });
  const g = db.appeler('sanctions:get', s);
  assert.strictEqual(g.pieces.length, 1);
  assert.strictEqual(db.appeler('sanctions:piece:contenu', g.pieces[0].id).nom_fichier, 'preuve.pdf');
  assert.throws(() => db.appeler('intervenants:delete', i), /désactivez/);
  assert.throws(() => db.appeler('sanctions:supprimer', s), /pièce/);
  // majeur : pas de représentant proposé
  const m = db.appeler('jeunes:save', { nom: 'Adulte', prenom: 'A', classe_id: classes[0].id, date_naissance: '2000-01-01', representant_email: 'x@exemple.fr' });
  const s2 = db.appeler('sanctions:save', { jeune_id: m, date_faits: '2026-11-02', motif_id: motif.id });
  assert.strictEqual(db.appeler('sanctions:destinataires', s2).mineur, false);
});

test('commissions : programmation, statuts, report, convocation Word archivée, rappels', () => {
  const db = ouvrir(':memory:');
  const classe = db.appeler('classes:list')[0];
  const jid = db.appeler('jeunes:save', { nom: 'Durand', prenom: 'Léa', classe_id: classe.id, civilite: 'Madame', adresse: '2 rue des Lilas', code_postal: '27000', ville: 'ÉVREUX' });
  const iv = db.appeler('intervenants:save', { nom: 'Mme Martin', fonction: 'CPE', email: 'cpe@ecole.fr' });

  assert.throws(() => db.appeler('commissions:save', { jeune_id: jid, type: 'disciplinaire', motif: '' }), /motif/);
  const sans = db.appeler('commissions:save', { jeune_id: jid, type: 'pedagogique', motif: 'Résultats insuffisants' });
  assert.strictEqual(db.appeler('commissions:get', sans).statut, 'a_programmer');
  assert.throws(() => db.appeler('commissions:statut', { id: sans, statut: 'programmee' }), /date/);
  assert.strictEqual(db.appeler('commissions:rappels').a_programmer.length, 1);

  const id = db.appeler('commissions:save', { jeune_id: jid, type: 'disciplinaire', motif: 'Falsification de document', date: '2999-01-07', heure_debut: '16:00', participants: [iv] });
  let c = db.appeler('commissions:get', id);
  assert.strictEqual(c.statut, 'programmee');
  assert.strictEqual(c.participants[0].email, 'cpe@ecole.fr');
  assert.throws(() => db.appeler('commissions:save', { id, jeune_id: jid, type: 'disciplinaire', motif: 'x', date: '2999-01-07', heure_debut: '16:00', heure_fin: '15:00' }), /fin/);

  const g = db.appeler('commissions:convocation:generer', id);
  assert.match(g.nom_fichier, /^Convocation_commission_disciplinaire_Durand_Lea_2999-01-07\.docx$/);
  const { contenu } = db.appeler('commissions:piece:contenu', g.piece_id);
  assert.strictEqual(contenu.subarray(0, 2).toString(), 'PK');
  assert.match(require('./zip.cjs').lireZip(contenu).get('word/document.xml').toString('utf8'), /en classe de BTS [A-Z]+ \d ALTERNANCE/);
  assert.strictEqual(db.appeler('commissions:get', id).classe_code, classe.code);

  db.appeler('commissions:communication:archiver', { commission_id: id, nature: 'convocation', a: ['x@y.fr'], objet: 'Convocation', corps: '...', methode: 'outlook' });
  c = db.appeler('commissions:get', id);
  assert.strictEqual(c.statut, 'convocations_envoyees');
  assert.throws(() => db.appeler('commissions:supprimer', id), /historique/);

  db.appeler('commissions:reporter', { id, date: '2999-01-14', heure_debut: '10:00', raison: 'Absence du jeune' });
  c = db.appeler('commissions:get', id);
  assert.strictEqual(c.statut, 'programmee');
  assert.ok(c.journal.some((j) => j.action === 'Report' && /07\/01\/2999/.test(j.detail)));

  db.appeler('commissions:save', { id, jeune_id: jid, type: 'disciplinaire', motif: 'Falsification de document', date: '2999-01-14', heure_debut: '10:00', compte_rendu: 'Échange tenu', decision: 'Avertissement' });
  db.appeler('commissions:statut', { id, statut: 'realisee' });
  assert.strictEqual(db.appeler('commissions:get', id).statut, 'realisee');
  assert.strictEqual(db.appeler('commissions:supprimer', sans), true);
  assert.throws(() => db.appeler('commissions:reglages:save', { rappel_jours: 99 }));
  db.fermer();
});

test('alertes de seuils : retards, demi-journées non recevables, cumul, suivi', () => {
  const db = ouvrir(':memory:');
  const classe = db.appeler('classes:list')[0];
  const jid = db.appeler('jeunes:save', { nom: 'Durand', prenom: 'Léa', classe_id: classe.id });
  const irrec = db.appeler('motifs:list').find((m) => m.statut === 'irrecevable').id;
  const rec = db.appeler('motifs:list').find((m) => m.statut === 'recevable').id;
  const ref = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10); // un mois entier déjà écoulé, dans la fenêtre d'analyse
  const ym = ref.slice(0, 7);
  const jour = (n) => `${ym}-${String(n).padStart(2, '0')}`;
  const d1 = 3;

  assert.deepStrictEqual(db.appeler('alertes:regles').map((r) => [r.code, r.seuil, r.periode]), [['retards', 3, 'mois'], ['demi_journees', 1, 'mois'], ['cumul', 4, 'mois']]);
  db.appeler('evenements:save', { jeune_id: jid, type: 'retard', creneaux: [{ date: jour(d1), heure_debut: '08:30', heure_fin: '08:45' }] });
  db.appeler('evenements:save', { jeune_id: jid, type: 'retard', creneaux: [{ date: jour(d1), heure_debut: '14:00', heure_fin: '14:10' }] });
  assert.strictEqual(db.appeler('alertes:list', {}).length, 0);
  db.appeler('evenements:save', { jeune_id: jid, type: 'retard', creneaux: [{ date: jour(d1), heure_debut: '16:00', heure_fin: '16:05' }] });
  let l = db.appeler('alertes:list', {});
  assert.deepStrictEqual(l.map((a) => [a.regle_code, a.valeur, a.statut]), [['retards', 3, 'nouvelle']]);

  // absence justifiée : pas comptée ; non recevable sur une journée entière = 2 demi-journées (matin + après-midi), un seul événement
  db.appeler('evenements:save', { jeune_id: jid, type: 'absence', motif_id: rec, creneaux: [{ date: jour(4), heure_debut: '08:30', heure_fin: '18:00' }] });
  assert.strictEqual(db.appeler('alertes:list', {}).length, 1);
  db.appeler('evenements:save', { jeune_id: jid, type: 'absence', motif_id: irrec, creneaux: [{ date: jour(5), heure_debut: '08:30', heure_fin: '18:00' }] });
  l = db.appeler('alertes:list', {});
  assert.deepStrictEqual(l.map((a) => [a.regle_code, a.valeur]).sort(), [['cumul', 5], ['demi_journees', 2], ['retards', 3]]);

  const a = l.find((x) => x.regle_code === 'retards');
  const det = db.appeler('alertes:get', a.id);
  assert.strictEqual(det.faits.length, 3);
  db.appeler('alertes:statut', { id: a.id, statut: 'traitee', note: 'Entretien avec l\'apprentie' });
  assert.strictEqual(db.appeler('alertes:get', a.id).statut, 'traitee');
  assert.ok(db.appeler('alertes:get', a.id).journal.some((j) => j.action === 'Statut'));
  assert.deepStrictEqual(db.appeler('alertes:compteurs'), { nouvelles: 2, en_cours: 0 });

  // règle modifiable : seuil relevé → plus de nouvelle alerte ; seuil invalide refusé
  const r = db.appeler('alertes:regles').find((x) => x.code === 'cumul');
  assert.throws(() => db.appeler('alertes:regle:save', { ...r, seuil: 0 }));
  db.appeler('alertes:regle:save', { ...r, seuil: 10 });
  assert.strictEqual(db.appeler('alertes:list', { regle_id: r.id }).length, 0);
  db.fermer();
});

test('tableau de bord disciplinaire : indicateurs et filtres', () => {
  const db = ouvrir(':memory:');
  const classes = db.appeler('classes:list');
  const a = db.appeler('jeunes:save', { nom: 'Durand', prenom: 'Léa', classe_id: classes[0].id });
  const b = db.appeler('jeunes:save', { nom: 'Martin', prenom: 'Paul', classe_id: classes.find((c) => c.libelle.startsWith('DTS')).id });
  assert.deepStrictEqual(db.appeler('dashboard:get', {}).indicateurs, { alertes_a_traiter: 0, sanctions_prononcees: 0, commissions_programmees: 0, commissions_a_organiser: 0 });
  const motif = db.appeler('sanctions:motifs')[0];
  const sid = db.appeler('sanctions:save', { jeune_id: a, motif_id: motif.id, date_faits: '2026-11-02', decision: 'sanction', palier_retenu_id: motif.palier_id, date_decision: '2026-11-03' });
  assert.ok(sid);
  db.appeler('commissions:save', { jeune_id: a, type: 'disciplinaire', motif: 'x', date: '2999-02-01', heure_debut: '10:00' });
  db.appeler('commissions:save', { jeune_id: b, type: 'pedagogique', motif: 'y' });
  const t = db.appeler('dashboard:get', {});
  assert.deepStrictEqual(t.indicateurs, { alertes_a_traiter: 0, sanctions_prononcees: 1, commissions_programmees: 1, commissions_a_organiser: 1 });
  assert.strictEqual(t.commissions_a_venir[0].jeune_nom, 'Durand');
  assert.strictEqual(db.appeler('dashboard:get', { jeune_id: b }).indicateurs.sanctions_prononcees, 0);
  assert.strictEqual(db.appeler('dashboard:get', { formation: 'DTS' }).indicateurs.commissions_a_organiser, 1);
  assert.strictEqual(db.appeler('dashboard:get', { formation: 'DTS' }).indicateurs.commissions_programmees, 0);
  assert.strictEqual(db.appeler('dashboard:get', { debut: '2026-12-01' }).indicateurs.sanctions_prononcees, 0);
  db.fermer();
});

test('mails types : modèles préchargés, variables, validation, historique', () => {
  const db = ouvrir(':memory:');
  const classe = db.appeler('classes:list')[0];
  const jid = db.appeler('jeunes:save', { nom: 'Durand', prenom: 'Léa', classe_id: classe.id });
  const modeles = db.appeler('mails:modeles', {});
  assert.strictEqual(modeles.length, 10);
  assert.deepStrictEqual([...new Set(modeles.map((m) => m.categorie))].sort(), [...db.appeler('mails:categories')].sort());

  const conv = modeles.find((m) => m.nom === 'Convocation à une commission');
  const cid = db.appeler('commissions:save', { jeune_id: jid, type: 'disciplinaire', motif: 'Falsification', date: '2999-01-07', heure_debut: '16:00' });
  const r = db.appeler('mails:rendre', { modele_id: conv.id, jeune_id: jid, commission_id: cid });
  assert.match(r.objet, /commission disciplinaire – 07\/01\/2999/);
  assert.match(r.corps, /à 16h00/);
  assert.deepStrictEqual(r.manquantes, []);
  const sans = db.appeler('mails:rendre', { modele_id: modeles.find((m) => m.nom === 'Notification de sanction').id, jeune_id: jid });
  assert.ok(sans.manquantes.includes('SANCTION'));
  assert.match(sans.corps, /\{SANCTION\}/);
  assert.match(sans.corps, /DURAND/);

  assert.throws(() => db.appeler('mails:modele:save', { nom: 'x', categorie: 'Absences', objet: 'o', contenu: 'Bonjour {INCONNU}' }), /inconnue/);
  assert.throws(() => db.appeler('mails:modele:save', { nom: 'x', categorie: 'Autre', objet: 'o', contenu: 'c' }), /Catégorie/);
  const nid = db.appeler('mails:modele:save', { nom: 'Mien', categorie: 'Absences', objet: 'Absence {NOM_APPRENTI}', contenu: 'Bonjour {PRENOM_APPRENTI}', actif: 0 });
  assert.strictEqual(db.appeler('mails:modeles', { actifs: true }).some((m) => m.id === nid), false);

  db.appeler('mails:archiver', { jeune_id: jid, a: ['x@y.fr'], objet: 'o', corps: 'c', modele_nom: 'Mien', methode: 'outlook' });
  db.appeler('commissions:communication:archiver', { commission_id: cid, nature: 'convocation', a: ['z@y.fr'], objet: 'Conv', corps: '...', methode: 'outlook' });
  const h = db.appeler('mails:historique', jid);
  assert.strictEqual(h.length, 2);
  assert.ok(h.some((x) => x.modele_nom === 'Mien') && h.some((x) => x.source.startsWith('Commission')));
  db.fermer();
});
