// Texte du mail de notification d'une sanction (modifiable avant ouverture du brouillon).
import type { Etablissement, SanctionDetail } from './api';
import { formaterDate } from './format';

export const sujetSanction = (nom: string, prenom: string, s: SanctionDetail) =>
  `Information concernant ${prenom} ${nom.toUpperCase()} – ${s.decision === 'sanction' ? (s.palier_retenu_libelle ?? 'mesure disciplinaire') : "rappel à l'ordre"}`;

export function corpsSanction(nom: string, prenom: string, classe: string, s: SanctionDetail, e: Etablissement): string {
  const mesure = s.decision === 'sanction' ? `la mesure disciplinaire suivante : ${s.palier_retenu_libelle}` : "un rappel à l'ordre";
  return [
    'Madame, Monsieur,',
    '',
    `Nous vous informons que ${prenom} ${nom.toUpperCase()}${classe ? ` (${classe})` : ''} a fait l'objet de ${mesure}${s.date_decision ? `, prononcée le ${formaterDate(s.date_decision)}` : ''}.`,
    '',
    `Motif : ${s.motif_intitule}${s.date_faits ? ` (faits du ${formaterDate(s.date_faits)})` : ''}.`,
    ...(s.duree ? [`Durée : ${s.duree}.`] : []),
    '',
    "Cette décision est prise conformément au règlement intérieur de l'établissement.",
    "Nous restons à votre disposition pour tout complément d'information.",
    '',
    'Cordialement,',
    e.nom,
    e.service,
    e.coordonnees,
  ].join('\n');
}
