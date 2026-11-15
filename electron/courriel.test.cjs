const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { composer, construireScript, encoder, urlMailto, preparerBrouillon, nomSur } = require('./courriel.cjs');

const base = {
  jeune_nom: 'Durand', jeune_prenom: 'Léa', classe_code: 'MCO', type: 'absence',
  date_debut: '2026-11-03', date_fin: '2026-11-04', duree_minutes: 14 * 60 + 5,
  maitre_nom: 'M. Martin', maitre_email: 'paul@martin.example', entreprise_email: 'contact@martin.example',
  motif_libelle: 'Arrêt maladie', motif_statut: 'recevable',
  creneaux: [
    { date: '2026-11-03', heure_debut: '08:30', heure_fin: '12:00', duree_minutes: 210 },
    { date: '2026-11-04', heure_debut: '13:30', heure_fin: '17:05', duree_minutes: 215 },
  ],
};

test('message : absence sur plusieurs jours avec motif', () => {
  const m = composer(base);
  assert.strictEqual(m.a, 'paul@martin.example');
  assert.strictEqual(m.objet, 'Absence de Léa Durand du 03/11/2026 au 04/11/2026');
  assert.match(m.corps, /^Bonjour M\. Martin,/);
  assert.match(m.corps, /absent\(e\) du 03\/11\/2026 au 04\/11\/2026/);
  assert.match(m.corps, /Créneaux concernés :\n- le 03\/11\/2026 de 08:30 à 12:00 \(3 h 30\)\n- le 04\/11\/2026 de 13:30 à 17:05 \(3 h 35\)/);
  assert.match(m.corps, /Durée totale d'absence : 14 h 05/);
  assert.match(m.corps, /Motif : Arrêt maladie \(recevable\)/);
  assert.strictEqual(m.avertissement, null);
});

test('message : retard sans motif, adresse de repli, observations jamais incluses', () => {
  const m = composer({
    ...base, type: 'retard', date_fin: null, duree_minutes: 12, maitre_nom: null, maitre_email: null,
    creneaux: [{ date: '2026-11-03', heure_debut: '08:30', heure_fin: '08:42', duree_minutes: 12 }],
    motif_libelle: null, motif_statut: null, observations: 'confidentiel',
  });
  assert.strictEqual(m.a, 'contact@martin.example');
  assert.strictEqual(m.objet, 'Retard de Léa Durand le 03/11/2026');
  assert.match(m.corps, /^Bonjour,/);
  assert.match(m.corps, /en retard le 03\/11\/2026/);
  assert.match(m.corps, /Créneau concerné :\n- le 03\/11\/2026 : cours prévu à 08:30, arrivée à 08:42 \(12 min\)/);
  assert.match(m.corps, /Durée du retard : 12 min/);
  assert.match(m.corps, /Motif : en attente de justificatif/);
  assert.ok(!m.corps.includes('confidentiel'));
});

test('message : aucune adresse => avertissement', () => {
  const m = composer({ ...base, maitre_email: null, entreprise_email: null });
  assert.strictEqual(m.a, '');
  assert.match(m.avertissement, /Aucune adresse e-mail/);
});

test('script PowerShell : encodage UTF-16 en base64 et apostrophes protégées', () => {
  const script = construireScript("C:\\Users\\L'école\\message.json");
  assert.ok(script.includes("'C:\\Users\\L''école\\message.json'"));
  assert.ok(script.includes('$m.Display()'));
  assert.strictEqual(Buffer.from(encoder(script), 'base64').toString('utf16le'), script);
});

test('mailto : adresse lisible, texte encodé, retours à la ligne Windows', () => {
  const u = urlMailto({ a: 'a@b.fr', objet: 'Absence é', corps: 'ligne 1\nligne 2' });
  assert.ok(u.startsWith('mailto:a@b.fr?subject=Absence%20%C3%A9&body='));
  assert.ok(u.endsWith('ligne%201%0D%0Aligne%202'));
});

test('noms de fichiers sûrs', () => {
  assert.strictEqual(nomSur('a:b*c?.pdf'), 'a_b_c_.pdf');
  assert.strictEqual(nomSur('../../secret.txt'), 'secret.txt');
  assert.strictEqual(nomSur('C:\\Users\\x\\certificat.pdf'), 'certificat.pdf');
  assert.strictEqual(nomSur('..'), 'fichier');
  assert.strictEqual(nomSur(''), 'fichier');
});

test('brouillon : Outlook réussi, échec puis repli mailto, hors Windows', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-courriel-'));
  const msg = { a: 'a@b.fr', objet: 'Objet', corps: 'Corps', fichiers: [path.join(dossier, 'x.pdf')] };
  const appels = [];
  const deps = (executer, plateforme) => ({
    plateforme, executer, dossierTravail: dossier,
    ouvrirExterne: async (u) => appels.push(['externe', u]),
    ouvrirDossier: async (d) => appels.push(['dossier', d]),
  });

  let cmd;
  const ok = await preparerBrouillon(msg, deps(async (c, args) => { cmd = [c, args]; }, 'win32'));
  assert.deepStrictEqual(ok, { methode: 'outlook' });
  assert.strictEqual(cmd[0], 'powershell.exe');
  assert.ok(cmd[1].includes('-EncodedCommand'));
  const json = JSON.parse(fs.readFileSync(path.join(dossier, 'message.json'), 'utf8'));
  assert.deepStrictEqual(json.fichiers, msg.fichiers);
  assert.strictEqual(appels.length, 0);

  const ko = await preparerBrouillon(msg, deps(async () => { throw Object.assign(new Error('x'), { stderr: 'Classe non enregistrée\nautre ligne' }); }, 'win32'));
  assert.strictEqual(ko.methode, 'mailto');
  assert.strictEqual(ko.raison, 'Classe non enregistrée');
  assert.deepStrictEqual(appels.map((a) => a[0]), ['externe', 'dossier']);

  appels.length = 0;
  const linux = await preparerBrouillon({ ...msg, fichiers: [] }, deps(async () => { throw new Error('ne doit pas être appelé'); }, 'linux'));
  assert.strictEqual(linux.methode, 'mailto');
  assert.deepStrictEqual(appels.map((a) => a[0]), ['externe']); // pas de dossier s'il n'y a pas de pièce
  fs.rmSync(dossier, { recursive: true, force: true });
});
