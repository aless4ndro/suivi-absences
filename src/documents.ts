// Modèles de la convocation et de la feuille d'émargement de rattrapage (reprise des documents Word de l'établissement).
import type { DonneesDocument, Etablissement, Seance } from './api';
import { formaterDate } from './format';

export const CSS_DOCUMENT = `
.doc { font-family: Carlito, Calibri, Arial, sans-serif; font-size: 11pt; color: #000; line-height: 1.32; }
.doc .page { position: relative; width: 210mm; height: 296mm; box-sizing: border-box; padding: 12mm 20mm 0 20mm; page-break-after: always; overflow: hidden; background: #fff; }
.doc .page:last-child { page-break-after: auto; }
.doc .logo { text-align: center; height: 38mm; }
.doc .logo img { height: 38mm; width: auto; }
.doc p { margin: 0 0 9pt 0; text-align: justify; }
.doc .adresse { margin-left: 95mm; margin-top: 4mm; margin-bottom: 9pt; text-align: left; }
.doc .adresse p { margin: 0; text-align: left; }
.doc .centre { text-align: center; font-weight: 700; text-decoration: underline; margin: 0; font-size: 12pt; }
.doc .bloc-date { margin: 10pt 0 12pt 0; }
.doc .signature { margin-left: 95mm; margin-top: 10pt; }
.doc .signature p { margin: 0; text-align: left; }
.doc table { border-collapse: collapse; width: 100%; }
.doc td, .doc th { border: 1px solid #000; padding: 4px 6px; vertical-align: middle; }
.doc .titre { text-align: center; font-weight: 700; font-size: 12pt; margin: 0; }
.doc .rappel { background: #f2f2f2; padding: 6px 8px; margin: 18px 0; font-family: Arial, sans-serif; font-size: 10pt; text-align: left; }
.doc .rappel p { text-align: left; margin: 0 0 6pt 0; }
.doc .cadre-admin { border: 2px solid #1f3f7f; width: 90mm; padding: 6px 10px; font-size: 10.5pt; margin-top: 8mm; }
.doc .cadre-admin p { margin: 0 0 3pt 0; text-align: left; }
.doc .pied { position: absolute; left: 0; right: 0; bottom: 8mm; text-align: center; font-size: 8.5pt; line-height: 1.25; color: #2b5aa6; }
.doc .pied b { color: #1f3f9f; font-size: 9pt; }
.doc .pied .site { color: #ef7d1a; font-weight: 700; }
.doc .pied div { margin: 0; }
`;

const MAJ_MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const echapper = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const heuresTexte = (min: number) => {
  const h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return `${m} minute${m > 1 ? 's' : ''}`;
  if (m === 0) return `${h} heure${h > 1 ? 's' : ''}`;
  return `${h} heure${h > 1 ? 's' : ''} ${String(m).padStart(2, '0')}`;
};
const heuresCourt = (min: number) => `${Math.floor(min / 60)}H${String(min % 60).padStart(2, '0')}`;
const hCourt = (hhmm: string) => hhmm.replace(':', 'H');
const dateLongue = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
const dateLettre = (iso: string) => {
  const [a, m, j] = iso.split('-').map(Number);
  return `${j === 1 ? '1' : j} ${MAJ_MOIS[m - 1]} ${a}`;
};

function moisConcerne(debut: string | null, fin: string | null) {
  if (!debut || !fin) return '';
  const [a1, m1] = debut.split('-').map(Number);
  const [a2, m2, j2] = fin.split('-').map(Number);
  const dernier = new Date(Date.UTC(a2, m2, 0)).getUTCDate();
  if (a1 === a2 && m1 === m2 && debut.endsWith('-01') && j2 === dernier) {
    const nom = MAJ_MOIS[m1 - 1].toLowerCase();
    return ` du mois ${/^[aeiouhéèêû]/i.test(nom) ? "d'" : 'de '}${nom} ${a1}`;
  }
  return ` de la période du ${formaterDate(debut)} au ${formaterDate(fin)}`;
}

function diplome(classe: string) {
  if (classe.startsWith('LCVM')) return 'Licence';
  if (classe.startsWith('DTS')) return 'Diplôme de Technicien Supérieur';
  return 'Brevet de Technicien Supérieur';
}

const entete = '<div class="logo"><img src="logo-etablissement.png" alt="" /></div>';
const pied = (e: Etablissement) =>
  `<div class="pied"><div><b>${echapper(e.pied_titre)}</b></div>${e.pied_lignes.split('\n').map((l) => `<div>${echapper(l)}</div>`).join('')}<div class="site">${echapper(e.pied_site)}</div></div>`;

const nomComplet = (d: DonneesDocument) => `${d.jeune.nom.toUpperCase()} ${d.jeune.prenom}`;

export function htmlConvocation(d: DonneesDocument, aujourdhui: string): string {
  const e = d.etablissement;
  const j = d.jeune;
  const f = j.civilite === 'Madame';
  const civ = j.civilite ?? 'Madame, Monsieur';
  const totalSeances = d.seances.reduce((t, s) => t + s.duree_minutes, 0);
  const salleDe = (s: Seance) => s.salle || e.salle;
  const blocs = d.seances.map((s) => `
    <div class="bloc-date">
      <p class="centre">${dateLongue(s.date)}</p>
      <p class="centre">${hCourt(s.heure_debut)} – ${hCourt(s.heure_fin)}${salleDe(s) ? ` – ${echapper(salleDe(s))}` : ''}</p>
      <p class="centre">(soit un total de ${heuresCourt(s.duree_minutes)})</p>
    </div>`).join('');
  const total = d.seances.length > 1 ? `<p class="centre" style="margin-bottom:10pt">(soit au total ${heuresCourt(totalSeances)} de rattrapage)</p>` : '';
  const regularise =
    d.solde_avant > 0
      ? totalSeances >= d.solde_avant
        ? `Ce rattrapage vous permet de régulariser la totalité des heures dues (${heuresTexte(d.solde_avant)}).`
        : `Ce rattrapage vous permet de régulariser ${heuresTexte(totalSeances)} sur les ${heuresTexte(d.solde_avant)} dues ; d'autres séances pourront vous être proposées pour le solde.`
      : '';
  const adresse = [j.adresse, [j.code_postal, j.ville?.toUpperCase()].filter(Boolean).join(' ')].filter(Boolean);

  const page1 = `
  <div class="page">
    ${entete}
    <div class="adresse"><p>${echapper(nomComplet(d))}</p>${adresse.map((l) => `<p>${echapper(l!)}</p>`).join('')}<p>&nbsp;</p><p>${echapper(e.ville)}, le ${dateLettre(aujourdhui)},</p></div>
    <p>Suite au récapitulatif mensuel de vos absences, il a été décidé que vous deviez rattraper en centre de formation, une partie ou l'intégralité de vos retards et absences non recevables${moisConcerne(d.periode_debut, d.periode_fin)}. Vous nous devez un total de ${heuresTexte(d.solde_avant)}.</p>
    <p><u>Rappel</u> : Les absences injustifiées entraînent une <b>retenue sur salaire correspondant au temps non travaillé</b>. Le rattrapage d'heures au centre de formation peut être proposé pour régulariser une absence, mais il s'agit d'une <b>possibilité ponctuelle et non d'un droit automatique</b>. Elle dépend des disponibilités et de l'organisation du centre. Vous êtes donc ${f ? 'convoquée' : 'convoqué'} ${d.seances.length > 1 ? 'aux dates suivantes' : 'à la date suivante'} :</p>
    ${blocs}${total}
    ${regularise ? `<p>${echapper(regularise)}</p>` : ''}
    <p>Cette journée devra être consacrée à la révision de votre ${diplome(j.classe_code)}. Veuillez-vous munir préalablement des documents nécessaires. Vous devez vous présenter aux horaires indiqués au bureau de ${echapper(e.referent)}.</p>
    <p>À votre arrivée <b>et à votre départ</b>, vous devez obligatoirement émarger afin d'enregistrer votre passage. <b>Attention : seules les signatures permettent d'attester que vous avez bien effectué votre rattrapage.</b> En cas d'absence de ${echapper(e.absents)} merci de vous présenter à l'accueil pour signature.</p>
    <p>Vous souhaitant bonne réception de ce courrier, nous vous prions d'agréer, ${echapper(civ)}, nos salutations distinguées.</p>
    <div class="signature"><p>${echapper(e.signataire)}</p><p>${echapper(e.fonction)}</p></div>
    <p style="margin-top:22mm">NB : En cas d'absence non justifiée ou non recevable sur les heures de formation, une demande sera faite auprès de votre entreprise pour régularisation.</p>
    ${pied(e)}
  </div>`;

  const page2 = `
  <div class="page">
    ${entete}
    <table style="margin-top:6mm">
      <tr><td colspan="3" style="height:26mm"><p class="titre" style="text-align:left">Emargement<br/>Réception de la convocation<br/>du rattrapage des heures</p></td></tr>
      <tr><td colspan="3" style="height:9mm">Nom de l'émetteur : ______________________________</td></tr>
      <tr><th style="width:34%">Nom</th><th style="width:33%">Date et heure de remise</th><th>Emargement</th></tr>
      <tr><td style="height:16mm">${echapper(nomComplet(d))}</td><td>______________________</td><td><i>« Lu et pris connaissance »</i></td></tr>
    </table>
    ${pied(e)}
  </div>`;
  return `<div class="doc">${page1}${page2}</div>`;
}

export function htmlEmargement(d: DonneesDocument): string {
  const e = d.etablissement;
  const total = d.seances.reduce((t, s) => t + s.duree_minutes, 0);
  const lignes = d.seances.map((s) => `
    <tr>
      <td style="width:26%;text-align:center">${dateLongue(s.date)}</td>
      <td style="width:17%;text-align:center">${hCourt(s.heure_debut)} – ${hCourt(s.heure_fin)}</td>
      <td style="width:11%;text-align:center">${echapper(s.salle || e.salle)}</td>
      <td style="width:28%;padding:0"><div style="height:9mm;border-bottom:1px solid #000;font-size:7pt;color:#555;padding:1px 3px">Arrivée</div><div style="height:9mm;font-size:7pt;color:#555;padding:1px 3px">Départ</div></td>
      <td style="width:12%;text-align:center">__H__</td>
      <td style="width:6%;text-align:center;font-size:14pt">☐</td>
    </tr>`).join('');
  const cases = d.seances.map((s) => `<p>☐ ${echapper(dateLongue(s.date).toLowerCase())}</p>`).join('');
  return `<div class="doc"><div class="page">
    ${entete}
    <p class="titre" style="margin-top:14mm">Feuille d'émargement</p>
    <p class="titre">Convocation pour les journées de rattrapage</p>
    <p class="titre" style="margin-top:9mm">${echapper(nomComplet(d))}</p>
    <p class="titre" style="margin-top:6mm;margin-bottom:8mm">Soit ${heuresTexte(total)}</p>
    <table>
      <tr><td style="text-align:center">Dates de rattrapage</td><td style="text-align:center">Heures d'émargement</td><td style="text-align:center">SALLE</td><td style="text-align:center">Signature</td><td style="text-align:center">=</td><td></td></tr>
      ${lignes}
    </table>
    <div class="rappel">
      <p><b>⚠ RAPPEL IMPORTANT – RATTRAPAGE</b></p>
      <p>Nous vous rappelons que ce créneau de rattrapage est exclusivement destiné à effectuer un travail.<br/><b>Il est donc strictement interdit de prendre votre pause déjeuner pendant ce créneau.</b></p>
      <p>Merci de respecter cette consigne et de veiller au bon déroulement de cette séance.</p>
    </div>
    <div class="cadre-admin">
      <p><b><i><u>Cadre réservé à l'administration</u></i></b></p>
      <p>Rattrapage validé pour les dates :</p>
      ${cases}
      <p>• <i>Enregistré le</i></p>
    </div>
    ${pied(e)}
  </div></div>`;
}

export function envelopper(inner: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:0}html,body{margin:0;padding:0}${CSS_DOCUMENT}</style></head><body>${inner}</body></html>`;
}
