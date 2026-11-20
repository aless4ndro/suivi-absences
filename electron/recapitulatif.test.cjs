const test = require('node:test');
const assert = require('node:assert');
const { ouvrir } = require('./db.cjs');
const { lireZip } = require('./zip.cjs');
const { ecrireXlsx } = require('./xlsx-ecrire.cjs');

function base() {
  const db = ouvrir(':memory:');
  const cl = db.appeler('classes:list');
  const eid = db.appeler('entreprises:save', { nom: 'Martin SA', email: 'rh@martin.example' });
  const mk = (nom, classe, ent) => db.appeler('jeunes:save', { nom, prenom: 'Test', classe_id: classe, entreprise_id: ent, maitre_email: ent ? 'maitre@martin.example' : null });
  const a = mk('Durand', cl[0].id, eid);
  const b = mk('Dupont', cl[1].id, null);
  const mot = db.appeler('motifs:list');
  return { db, cl, a, b, eid, mot };
}
const abs = (db, jeune_id, date, type = 'absence', motif_id) =>
  db.appeler('evenements:save', { jeune_id, type, motif_id, creneaux: [{ date, heure_debut: '08:00', heure_fin: '12:00' }] });

test('récap : totaux, filtres combinés, lecture seule', () => {
  const { db, cl, a, b } = base();
  abs(db, a, '2026-10-05'); abs(db, a, '2026-10-06', 'retard'); abs(db, b, '2026-11-03');
  const avant = JSON.stringify(db.appeler('evenements:list'));
  const f = { debut: '2026-10-01', fin: '2026-11-30', domaines: { absences: true, retards: true } };
  const r = db.appeler('recap:calculer', f);
  assert.strictEqual(r.totaux.apprentis, 2);
  assert.strictEqual(r.totaux.absences.nb, 2);
  assert.strictEqual(r.totaux.retards.nb, 1);
  assert.strictEqual(r.par_mois.length, 2);
  const c1 = db.appeler('recap:calculer', { ...f, classe_ids: [cl[0].id] });
  assert.deepStrictEqual(c1.apprentis.map((x) => x.id), [a]);
  const c2 = db.appeler('recap:calculer', { ...f, domaines: { retards: true } });
  assert.strictEqual(c2.totaux.absences.nb, 0);
  assert.strictEqual(c2.totaux.retards.nb, 1);
  assert.strictEqual(JSON.stringify(db.appeler('evenements:list')), avant);
  assert.throws(() => db.appeler('recap:calculer', { ...f, fin: '2026-09-01' }), /Période invalide/);
  assert.throws(() => db.appeler('recap:calculer', { ...f, domaines: {} }), /au moins un domaine/);
  db.fermer();
});

test('récap : extraction obsolète après modification des sources', () => {
  const { db, a } = base();
  abs(db, a, '2026-10-05');
  const f = { debut: '2026-10-01', fin: '2026-10-31', domaines: { absences: true } };
  const id = db.appeler('recap:extraction:enregistrer', { resultat: db.appeler('recap:calculer', f), utilisateur: 'test' });
  assert.strictEqual(db.appeler('recap:verifier', { extraction_id: id }).a_jour, true);
  abs(db, a, '2026-10-12');
  assert.strictEqual(db.appeler('recap:verifier', { extraction_id: id }).a_jour, false);
  assert.strictEqual(db.appeler('recap:historique').extractions.length, 1);
  db.fermer();
});

test('récap : confidentialité des envois', () => {
  const { db, a, b } = base();
  const ok = db.appeler('recap:controler', { jeune_ids: [a], domaines: ['absences'], destinataires: ['maitre@martin.example'], date: '2026-10-31' });
  assert.deepStrictEqual(ok.erreurs, []);
  // sanctions : refusées à l'entreprise sauf autorisation expresse
  const s = db.appeler('recap:controler', { jeune_ids: [a], domaines: ['absences', 'sanctions'], destinataires: ['maitre@martin.example'], date: '2026-10-31' });
  assert.ok(s.erreurs.some((e) => /sanctions/.test(e)));
  const s2 = db.appeler('recap:controler', { jeune_ids: [a], domaines: ['sanctions'], destinataires: ['maitre@martin.example'], sanctions_autorisees_a: ['maitre@martin.example'], date: '2026-10-31' });
  assert.deepStrictEqual(s2.erreurs, []);
  // document collectif : jamais à une entreprise
  const col = db.appeler('recap:controler', { jeune_ids: [a, b], domaines: ['absences'], destinataires: ['maitre@martin.example'], date: '2026-10-31' });
  assert.ok(col.erreurs.length);
  // entreprise d'un autre apprenti
  const autre = db.appeler('recap:controler', { jeune_ids: [b], domaines: ['absences'], destinataires: ['rh@martin.example'], date: '2026-10-31' });
  assert.ok(autre.erreurs.length);
  // adresse libre : à confirmer
  const libre = db.appeler('recap:controler', { jeune_ids: [b], domaines: ['absences'], destinataires: ['x@exemple.fr'] });
  assert.strictEqual(libre.ok, false);
  assert.strictEqual(libre.avertissements.length, 1);
  assert.strictEqual(db.appeler('recap:controler', { jeune_ids: [b], domaines: ['absences'], destinataires: ['x@exemple.fr'], confirmes: ['x@exemple.fr'] }).ok, true);
  // un envoi refusé n'est pas journalisé
  assert.throws(() => db.appeler('recap:transmission:enregistrer', { jeune_ids: [a], domaines: ['sanctions'], destinataires: ['maitre@martin.example'], date: '2026-10-31' }));
  db.appeler('recap:transmission:enregistrer', { jeune_ids: [a], domaines: ['absences'], destinataires: ['maitre@martin.example'], date: '2026-10-31', type_document: 'pdf' });
  assert.strictEqual(db.appeler('recap:historique').transmissions.length, 1);
  db.fermer();
});

test('xlsx : classeur lisible, caractères spéciaux protégés', () => {
  const buf = ecrireXlsx([{ nom: 'Récap / test', lignes: [['Nom', 'Heures'], ['A & <B>', 3.5]] }]);
  const z = lireZip(buf);
  assert.ok(z.has('xl/worksheets/sheet1.xml'));
  assert.match(z.get('xl/worksheets/sheet1.xml').toString(), /A &amp; &lt;B&gt;/);
  assert.match(z.get('xl/workbook.xml').toString(), /Récap   test/);
});

test('whatsapp : numéros, destinataires, règles de confidentialité, historique', () => {
  const { normaliserNumero } = require('./whatsapp.cjs');
  assert.strictEqual(normaliserNumero('06 12 34 56 78'), '33612345678');
  assert.strictEqual(normaliserNumero('+33 6 12 34 56 78'), '33612345678');
  assert.strictEqual(normaliserNumero('0033612345678'), '33612345678');
  assert.strictEqual(normaliserNumero('+39 333 1234567'), '393331234567');
  assert.strictEqual(normaliserNumero('12 34'), null);
  const { db, cl, eid } = base();
  const a = db.appeler('jeunes:save', { nom: 'Leroy', prenom: 'Zoé', classe_id: cl[0].id, telephone: '06 11 22 33 44', entreprise_id: eid, maitre_nom: 'M. Martin', maitre_telephone: '07 55 66 77 88' });
  const d = db.appeler('whatsapp:destinataires', a);
  assert.deepStrictEqual(d.map((x) => x.cle), ['apprenti', 'maitre']);
  assert.ok(d.every((x) => x.utilisable));
  const r = db.appeler('whatsapp:preparer', { jeune_id: a, cle: 'apprenti', texte: 'Bonjour Zoé & co', categorie: 'Retards' });
  assert.strictEqual(r.url, 'https://wa.me/33611223344?text=Bonjour%20Zo%C3%A9%20%26%20co');
  assert.throws(() => db.appeler('whatsapp:preparer', { jeune_id: a, cle: 'maitre', texte: 'x', categorie: 'Sanctions et avertissements' }), /disciplinaires/);
  assert.throws(() => db.appeler('whatsapp:preparer', { jeune_id: a, cle: 'apprenti', texte: '  ' }), /vide/);
  assert.throws(() => db.appeler('whatsapp:preparer', { jeune_id: a, cle: 'inconnu', texte: 'x' }), /introuvable/);
  // un fixe n'a pas WhatsApp
  db.appeler('jeunes:save', { id: a, nom: 'Leroy', prenom: 'Zoé', classe_id: cl[0].id, telephone: '02 32 00 00 00', entreprise_id: eid });
  assert.throws(() => db.appeler('whatsapp:preparer', { jeune_id: a, cle: 'apprenti', texte: 'x' }), /fixe/);
  const h = db.appeler('mails:historique', a);
  assert.strictEqual(h.length, 1);
  assert.strictEqual(h[0].source, 'WhatsApp');
  db.fermer();
});
