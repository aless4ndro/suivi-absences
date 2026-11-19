const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { remplirConvocation, verifierModele, classeTexte, dateLongue } = require('./convocation.cjs');
const { lireZip } = require('./zip.cjs');

const texte = (buf) => [...lireZip(buf).get('word/document.xml').toString('utf8').matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('|');
const modele = (n) => fs.readFileSync(path.join(__dirname, 'modeles', `convocation-${n}.docx`));
const base = { civilite: 'Madame', nom: 'Durand', prenom: 'Léa', adresse: '2 rue des Lilas', code_postal: '27000', ville: 'ÉVREUX', classe_texte: 'BTS GPME 1 ALTERNANCE', date: '2026-12-03', heure_debut: '14:30', motif: 'Motif de test & <essai>', signataire: 'Madame MENISSEZ', fonction: 'Cheffe d’établissement' };

test('convocation disciplinaire : textes remplacés, aucune donnée du modèle conservée', () => {
  const t = texte(remplirConvocation(modele('disciplinaire'), { ...base, type: 'disciplinaire' }));
  assert.match(t, /DURAND Léa/);
  assert.match(t, /Madame/);
  assert.match(t, /une Commission Disciplinaire/);
  assert.match(t, /JEUDI\|? ?3 ?\|? ?DÉCEMBRE|JEUDI.*3.*DÉCEMBRE.*2026/);
  assert.match(t, /À 14H30/);
  assert.match(t, /Motif de test &amp; &lt;essai&gt;/);
  assert.match(t, /convoquée/);
  assert.match(t, /accompagnée/);
  assert.match(t, /maître d’apprentissage est convié/); // phrase propre au modèle disciplinaire conservée
  assert.doesNotMatch(t, /TROQUER|BARBANCONS|GRAVIGNY|Falsification/);
});

test('convocation pédagogique : modèle propre, masculin par défaut', () => {
  const t = texte(remplirConvocation(modele('pedagogique'), { ...base, civilite: 'Monsieur', nom: 'Martin', prenom: 'Paul', type: 'pedagogique' }));
  assert.match(t, /Commission pédagogique/);
  assert.match(t, /MARTIN Paul/);
  assert.match(t, /convoqué/);
  assert.doesNotMatch(t, /convoquée/);
  assert.doesNotMatch(t, /BIHITI|LOMMOYE|ROSNY|mensongère/);
  assert.doesNotMatch(t, /maître d’apprentissage est convié/);
});

test('convocation : l\'archive reste un document Word complet (logo, en-tête, pied de page)', () => {
  const out = lireZip(remplirConvocation(modele('pedagogique'), { ...base, type: 'pedagogique' }));
  for (const n of ['word/header1.xml', 'word/footer1.xml', 'word/media/image1.png', '[Content_Types].xml', 'word/styles.xml']) assert.ok(out.has(n), n);
  assert.doesNotMatch(out.get('word/settings.xml').toString('utf8'), /attachedTemplate/);
});

test('convocation : modèle invalide refusé, classe et date en français', () => {
  assert.throws(() => verifierModele(Buffer.from('pas un docx')));
  assert.doesNotThrow(() => verifierModele(modele('disciplinaire')));
  assert.strictEqual(classeTexte('MCO 2ème année', 'BTS Management Commercial Opérationnel — 2ème année'), 'BTS MCO 2 ALTERNANCE');
  assert.strictEqual(classeTexte('DTS IMRT 2ème année', 'DTS Imagerie Médicale et Radiologie Thérapeutique — 2ème année'), 'DTS IMRT 2 ALTERNANCE');
  assert.strictEqual(classeTexte('GPME 1ère année', 'BTS Gestion de la PME — 1ère année'), 'BTS GPME 1 ALTERNANCE');
  assert.strictEqual(dateLongue('2026-11-12'), 'JEUDI 12 NOVEMBRE 2026');
  assert.strictEqual(dateLongue('2026-11-23'), 'LUNDI 23 NOVEMBRE 2026');
});
