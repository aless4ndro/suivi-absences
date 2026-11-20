// WhatsApp : l'appli prépare le message et ouvre la conversation (lien wa.me) ; la personne relit puis envoie elle-même depuis son WhatsApp.
// Aucun envoi automatique, aucun compte ni jeton stocké.
const CATEGORIES_DISCIPLINAIRES = ['Sanctions et avertissements', 'Commissions disciplinaires'];
const LIMITE_TEXTE = 1500;

// Numéro au format international sans « + » (ex. 33612345678), ou null s'il est inutilisable.
function normaliserNumero(brut) {
  let t = String(brut ?? '').trim();
  if (!t) return null;
  const plus = t.startsWith('+');
  t = t.replace(/[^\d]/g, '');
  if (!plus && t.startsWith('00')) t = t.slice(2);
  else if (!plus && /^0\d{9}$/.test(t)) t = `33${t.slice(1)}`;
  else if (plus && t.startsWith('330')) t = `33${t.slice(3)}`; // +33 06… saisi par erreur
  if (!/^\d{8,15}$/.test(t)) return null;
  if (t.startsWith('33') && !/^33\d{9}$/.test(t)) return null;
  return t;
}
// En France, seuls les 06 / 07 ont WhatsApp ; un fixe ou un 08/09 n'en a pas.
const estMobileFr = (n) => !n.startsWith('33') || /^33[67]/.test(n);
const lien = (numero, texte) => `https://wa.me/${numero}?text=${encodeURIComponent(texte)}`;

function creerWhatsApp(db, h) {
  const { aujourdhui, contratDe } = h;
  const maintenant = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };

  function destinataires(jeuneId) {
    const j = db.prepare('SELECT id, nom, prenom, telephone FROM jeunes WHERE id = ?').get(Number(jeuneId));
    if (!j) throw new Error('Apprenti introuvable.');
    const liste = [{ cle: 'apprenti', role: 'apprenti', libelle: `Apprenti : ${j.prenom} ${j.nom}`, telephone: j.telephone }];
    const ct = contratDe(j.id, aujourdhui()) ?? {};
    if (ct.maitre_telephone) liste.push({ cle: 'maitre', role: 'entreprise', libelle: `Maître d'apprentissage${ct.maitre_nom ? ` : ${ct.maitre_nom}` : ''}`, telephone: ct.maitre_telephone });
    if (ct.entreprise_id) {
      const e = db.prepare('SELECT nom, telephone FROM entreprises WHERE id = ?').get(ct.entreprise_id);
      if (e?.telephone) liste.push({ cle: 'entreprise', role: 'entreprise', libelle: `Entreprise : ${e.nom}`, telephone: e.telephone });
      for (const c of db.prepare('SELECT id, nom, fonction, telephone FROM contacts WHERE entreprise_id = ? ORDER BY nom COLLATE NOCASE').all(ct.entreprise_id)) {
        if (c.telephone) liste.push({ cle: `contact-${c.id}`, role: 'entreprise', libelle: `${c.nom}${c.fonction ? ` (${c.fonction})` : ''}`, telephone: c.telephone });
      }
    }
    return liste.map((d) => {
      const numero = normaliserNumero(d.telephone);
      return { ...d, numero, utilisable: !!numero && estMobileFr(numero), probleme: !d.telephone ? 'pas de téléphone' : !numero ? 'numéro invalide' : !estMobileFr(numero) ? 'numéro fixe : pas de WhatsApp' : null };
    });
  }

  return {
    'whatsapp:destinataires': (jeuneId) => destinataires(jeuneId),

    // Contrôle, journalise et renvoie le lien à ouvrir. Le lien est construit ici : l'écran ne fournit jamais d'adresse à ouvrir.
    'whatsapp:preparer': ({ jeune_id, cle, texte, categorie, modele_nom }) => {
      const t = String(texte ?? '').trim();
      if (!t) throw new Error('Le message est vide.');
      if (t.length > LIMITE_TEXTE) throw new Error(`Message trop long pour WhatsApp (${t.length} caractères, maximum ${LIMITE_TEXTE}).`);
      const d = destinataires(jeune_id).find((x) => x.cle === cle);
      if (!d) throw new Error('Destinataire introuvable pour cet apprenti.');
      if (!d.utilisable) throw new Error(`${d.libelle} : ${d.probleme}.`);
      if (d.role === 'entreprise' && CATEGORIES_DISCIPLINAIRES.includes(categorie)) {
        throw new Error('Les messages disciplinaires (sanctions, commissions disciplinaires) ne sont pas envoyés à une entreprise par WhatsApp.');
      }
      db.prepare('INSERT INTO historique_mails (jeune_id, quand, source, destinataires, objet, contenu, pieces, modele_nom, methode, statut) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(Number(jeune_id), maintenant(), 'WhatsApp', `${d.libelle} : +${d.numero}`, 'Message WhatsApp', t, null, modele_nom ?? null, 'WhatsApp', "Conversation ouverte (envoi à valider par vous)");
      return { url: lien(d.numero, t), numero: d.numero };
    },
  };
}
module.exports = { creerWhatsApp, normaliserNumero, estMobileFr, CATEGORIES_DISCIPLINAIRES };
