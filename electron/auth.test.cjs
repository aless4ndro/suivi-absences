const test = require('node:test');
const assert = require('node:assert');
const { ouvrir } = require('./db.cjs');
const { hasher, verifier, creerSession } = require('./auth.cjs');

test('hachage : jamais en clair, sel différent à chaque fois', () => {
  const h1 = hasher('motdepasse1');
  const h2 = hasher('motdepasse1');
  assert.notStrictEqual(h1, h2);
  assert.ok(!h1.includes('motdepasse1'));
  assert.ok(verifier('motdepasse1', h1));
  assert.ok(!verifier('motdepasse2', h1));
  assert.ok(!verifier('x', 'format-invalide'));
});

test('session : création, connexion, verrouillage, changement', () => {
  const db = ouvrir(':memory:');
  const s = creerSession(() => db);
  assert.deepStrictEqual(s.etat(), { mdpDefini: false, deverrouille: false });
  assert.strictEqual(s.estOuvert(), false);
  assert.throws(() => s.definir('court'), /au moins 8/);
  s.definir('Ecole2026!');
  assert.deepStrictEqual(s.etat(), { mdpDefini: true, deverrouille: true });
  assert.throws(() => s.definir('Autre2026!!'), /existe déjà/);

  s.verrouiller();
  assert.strictEqual(s.estOuvert(), false);
  assert.throws(() => s.connecter('faux'), /incorrect/);
  assert.strictEqual(s.estOuvert(), false);
  s.connecter('Ecole2026!');
  assert.strictEqual(s.estOuvert(), true);

  assert.throws(() => s.changer('faux', 'Nouveau2026!'), /Ancien/);
  s.changer('Ecole2026!', 'Nouveau2026!');
  s.verrouiller();
  assert.throws(() => s.connecter('Ecole2026!'), /incorrect/);
  s.connecter('Nouveau2026!');
  assert.ok(s.estOuvert());
  s.verrouiller();
  assert.throws(() => s.changer('Nouveau2026!', 'Encore2026!'), /verrouillée/);
  db.fermer();
});

test('session : blocage après 5 échecs, puis déblocage', () => {
  const db = ouvrir(':memory:');
  let t = 1_000_000;
  const s = creerSession(() => db, () => t);
  s.definir('Ecole2026!');
  s.verrouiller();
  for (let i = 0; i < 5; i++) assert.throws(() => s.connecter('faux'), /incorrect/);
  assert.throws(() => s.connecter('Ecole2026!'), /Trop d'essais/);
  t += 31_000;
  s.connecter('Ecole2026!');
  assert.ok(s.estOuvert());
  db.fermer();
});
