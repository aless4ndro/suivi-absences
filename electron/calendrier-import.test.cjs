const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { lireXlsx } = require('./calendrier-import.cjs');
const fixture = (n) => fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fixtures', n));

test('import Excel : mois en colonnes et cellules colorées, légende reconnue', () => {
  const r = lireXlsx(fixture('calendrier-grille.xlsx'), '2026-2027');
  const cle = new Map(r.jours.map((j) => [j.date, j.cle]));
  const type = new Map(r.legende.map((l) => [l.cle, l.type_propose]));
  const lib = new Map(r.legende.map((l) => [l.cle, l.libelle]));
  assert.strictEqual(r.legende.length, 3);
  assert.strictEqual(type.get(cle.get('2026-09-11')), 'centre');
  assert.strictEqual(type.get(cle.get('2026-10-12')), 'entreprise');
  assert.strictEqual(lib.get(cle.get('2026-10-12')), 'Immersion évaluée');
  assert.strictEqual(type.get(cle.get('2026-11-02')), 'entreprise');
  assert.strictEqual(cle.has('2026-09-06'), false); // dimanche non coloré
  assert.strictEqual(cle.has('2027-01-01'), false); // jour férié blanc
  assert.ok(cle.has('2027-04-03')); // samedi coloré
  assert.strictEqual(cle.has('2026-02-30'), false);
  assert.deepStrictEqual(r.avertissements, []);
});

test('import Excel : tableau date + type et refus des fichiers invalides', () => {
  const r = lireXlsx(fixture('calendrier-tableau.xlsx'), '2027-2028');
  assert.deepStrictEqual(r.jours.map((j) => j.date), ['2027-09-01', '2027-09-02', '2027-09-03']);
  assert.deepStrictEqual(r.legende.map((l) => l.type_propose).sort(), ['autre', 'centre', 'entreprise']);
  assert.throws(() => lireXlsx(Buffer.from('pas un classeur'), '2026-2027'));
  assert.throws(() => lireXlsx(fixture('calendrier-grille.xlsx'), 'abc'), /Année/);
});
