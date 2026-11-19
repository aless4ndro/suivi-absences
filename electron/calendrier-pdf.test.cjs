const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lirePdf } = require('./calendrier-pdf.cjs');

test('PDF « mois en colonnes » : jours colorés, légende et jours ouvrés', async () => {
  const r = await lirePdf(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fixtures', 'calendrier-mco1.pdf')), '2026-2027');
  assert.equal(r.legende.length, 3); // + gris des jours fériés, sans légende
  const lib = r.legende.filter((l) => l.libelle).map((l) => `${l.libelle}:${l.type_propose}`).sort();
  assert.deepEqual(lib, ['740H de formation:centre', 'Entreprise:entreprise']);
  const par = new Map(r.jours.map((j) => [j.date, j.cle]));
  const centre = r.legende.find((l) => l.type_propose === 'centre').cle;
  const entreprise = r.legende.find((l) => l.type_propose === 'entreprise').cle;
  assert.equal(par.get('2026-09-01'), centre); // rentrée : centre
  assert.equal(par.get('2026-09-09'), entreprise);
  assert.ok(!par.has('2026-09-05')); // samedi ignoré
  assert.ok(r.jours.length > 200);
});

test('PDF sans calendrier : message clair', async () => {
  await assert.rejects(lirePdf(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fixtures', 'calendrier-mco1.pdf')).subarray(0, 100), '2026-2027'));
});
