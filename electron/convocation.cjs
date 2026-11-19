// Convocations aux commissions : le modèle Word de l'établissement est rempli sans toucher à sa mise en page
// (logo, en-tête, pied de page, tableau d'émargement). Seuls les textes variables sont réécrits.
const { lireZip, ecrireZip } = require('./zip.cjs');

const JOURS = ['DIMANCHE', 'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI'];
const MOIS = ['JANVIER', 'FÉVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOÛT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DÉCEMBRE'];

const echapper = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decoder = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const texteDe = (p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => decoder(m[1])).join('');

function paragraphes(xml) {
  const debutCorps = xml.indexOf('<w:body>');
  const res = [];
  const re = /<w:p(?:\s[^>]*?)?(?:\/>|>[\s\S]*?<\/w:p>)/g;
  re.lastIndex = debutCorps;
  let m;
  while ((m = re.exec(xml))) res.push({ debut: m.index, fin: m.index + m[0].length, xml: m[0], texte: texteDe(m[0]) });
  return res;
}

// Remplace le contenu d'un paragraphe par un texte unique, en gardant sa mise en forme (paragraphe et première police).
function reecrire(p, texte) {
  const ouvrante = p.xml.match(/^<w:p(?:\s[^>]*)?>/)?.[0];
  if (!ouvrante) throw new Error('Modèle de convocation non conforme.');
  const pPr = p.xml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
  const apres = p.xml.slice(ouvrante.length + pPr.length);
  const premierRun = apres.match(/<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)?/);
  const rPr = premierRun?.[1] ?? '';
  const tab = /<w:r(?:\s[^>]*)?>\s*(?:<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:tab\/>/.test(apres);
  return `${ouvrante}${pPr}<w:r>${rPr}${tab ? '<w:tab/>' : ''}<w:t xml:space="preserve">${echapper(texte)}</w:t></w:r></w:p>`;
}

// « BTS MCO 2 ALTERNANCE » d'après le code et le libellé de la classe (ex. « MCO 2ème année », « BTS Management… — 2ème année »).
function classeTexte(code, libelle) {
  const diplome = String(libelle ?? '').split(/\s+/)[0] || '';
  const m = String(code).match(/^(.*?)\s+(\d+)\s*(?:ère|ème|e|er)?\s+année$/i);
  if (!m) return String(code);
  let sigle = m[1].trim();
  if (diplome && sigle.toLowerCase().startsWith(`${diplome.toLowerCase()} `)) sigle = sigle.slice(diplome.length + 1);
  return `${diplome} ${sigle} ${m[2]} ALTERNANCE`.trim();
}

function dateLongue(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
const heureCourte = (h) => `${h.slice(0, 2)}H${h.slice(3, 5)}`;

// d : { civilite, nom, prenom, adresse, code_postal, ville, classe_texte, type, date, heure_debut, motif, signataire, fonction }
function remplirConvocation(modele, d) {
  const entrees = lireZip(modele);
  const doc = entrees.get('word/document.xml');
  if (!doc) throw new Error('Modèle de convocation non conforme (document.xml manquant).');
  let xml = doc.toString('utf8');
  const ps = paragraphes(xml);
  const trouver = (re, depuis = 0) => {
    const i = ps.findIndex((p, k) => k >= depuis && re.test(p.texte));
    if (i < 0) throw new Error(`Modèle de convocation non conforme : « ${re.source} » introuvable.`);
    return i;
  };

  const iIntro = trouver(/convoqu/);
  const iAdresse = trouver(/^\s*(Monsieur|Madame)\b/);
  const iRappel = trouver(/accompagn/);
  const iSalut = trouver(/Vous souhaitant/);
  const iNomEmarg = trouver(/^Date et heure de remise$/) + 2;
  const feminin = d.civilite === 'Madame';
  const e = feminin ? 'e' : '';
  const nomComplet = `${String(d.nom).toUpperCase()} ${d.prenom}`.trim();
  const remplacements = new Map();

  remplacements.set(iAdresse, `${d.civilite ? `${d.civilite} ` : ''}${nomComplet}`);
  remplacements.set(iAdresse + 1, d.adresse ?? '');
  remplacements.set(iAdresse + 2, [d.code_postal, d.ville].filter(Boolean).join(' '));
  remplacements.set(iIntro,
    `Nous vous informons que vous, ${nomComplet} (en classe de ${d.classe_texte}) êtes convoqué${e} à ${d.type === 'disciplinaire' ? 'une Commission Disciplinaire' : 'une Commission pédagogique'} le :`);
  remplacements.set(iIntro + 1, dateLongue(d.date));
  remplacements.set(iIntro + 2, `À ${heureCourte(d.heure_debut)}`);
  remplacements.set(iIntro + 4, d.motif);
  remplacements.set(iRappel, ps[iRappel].texte.replace('accompagné ', feminin ? 'accompagnée ' : 'accompagné '));
  remplacements.set(iSalut, ps[iSalut].texte.replace(/(agréer,\s*)Monsieur/, `$1${d.civilite === 'Madame' ? 'Madame' : d.civilite === 'Monsieur' ? 'Monsieur' : 'Madame, Monsieur'}`));
  if (d.signataire) remplacements.set(iSalut + 1, d.signataire);
  if (d.fonction) remplacements.set(iSalut + 2, d.fonction);
  remplacements.set(iNomEmarg, nomComplet);

  // vérifications : on n'écrit que sur des paragraphes qui ont la forme attendue
  if (!/Pour le motif/.test(ps[iIntro + 3].texte)) throw new Error('Modèle de convocation non conforme : le motif est introuvable.');

  let sortie = '';
  let curseur = 0;
  ps.forEach((p, i) => {
    if (!remplacements.has(i)) return;
    sortie += xml.slice(curseur, p.debut) + reecrire(p, remplacements.get(i));
    curseur = p.fin;
  });
  sortie += xml.slice(curseur);
  xml = sortie;
  entrees.set('word/document.xml', Buffer.from(xml, 'utf8'));

  // Lien externe vers le fichier d'en-tête d'un autre poste : retiré pour que Word n'affiche aucun avertissement.
  const reglages = entrees.get('word/settings.xml');
  if (reglages) entrees.set('word/settings.xml', Buffer.from(reglages.toString('utf8').replace(/<w:attachedTemplate\b[^>]*\/>/g, ''), 'utf8'));
  const rels = entrees.get('word/_rels/settings.xml.rels');
  if (rels) entrees.set('word/_rels/settings.xml.rels', Buffer.from(rels.toString('utf8').replace(/<Relationship\b[^>]*attachedTemplate[^>]*\/>/g, ''), 'utf8'));
  return ecrireZip(entrees);
}

// Vérifie qu'un modèle (éventuellement remplacé par l'établissement) est utilisable.
function verifierModele(buffer) {
  remplirConvocation(buffer, {
    civilite: 'Monsieur', nom: 'Test', prenom: 'Test', adresse: '1 rue du Test', code_postal: '00000', ville: 'Ville', classe_texte: 'BTS TEST 1 ALTERNANCE',
    type: 'pedagogique', date: '2030-01-07', heure_debut: '09:00', motif: 'Test', signataire: 'Test', fonction: 'Test',
  });
  return true;
}

module.exports = { remplirConvocation, verifierModele, classeTexte, dateLongue, heureCourte };
