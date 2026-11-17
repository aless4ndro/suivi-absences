// Bilan mensuel destiné à l'employeur : sujet et corps du mail (reprise du modèle du cahier des charges).
import type { Etablissement } from './api';
import { formaterDate, NOMS_MOIS } from './format';
import { heuresTexte } from './documents';

export type DonneesRecap = {
  evenements: { id: number; type: 'absence' | 'retard'; date_debut: string; date_fin: string | null; duree_minutes: number | null; motif: string }[];
  pieces_evenements: { id: number; evenement_id: number; nom_fichier: string; taille: number }[];
  min_absences: number; min_retards: number;
  seances_effectuees: { id: number; date: string; heure_debut: string; heure_fin: string; valide_minutes: number }[];
  min_rattrapees: number; solde: number;
  pieces: { id: number; seance_id: number; nom_fichier: string; taille: number }[];
  etablissement: Etablissement;
};

export const moisTexte = (ym: string) => {
  const [a, m] = ym.split('-').map(Number);
  return `${NOMS_MOIS[m - 1]} ${a}`;
};

export function sujetRecap(nom: string, prenom: string, mois: string) {
  return `Suivi des absences, retards et rattrapages – ${nom.toUpperCase()} ${prenom} – ${moisTexte(mois)}`;
}

export function corpsRecap(d: DonneesRecap, mois: string, avecEmargements: boolean) {
  const e = d.etablissement;
  const detail = d.evenements.map((x) => {
    const quand = x.date_fin && x.date_fin !== x.date_debut ? `du ${formaterDate(x.date_debut)} au ${formaterDate(x.date_fin)}` : `le ${formaterDate(x.date_debut)}`;
    return `- ${x.type === 'absence' ? 'Absence' : 'Retard'} ${quand} : ${heuresTexte(x.duree_minutes ?? 0)} (${x.motif})`;
  });
  const dates = d.seances_effectuees.map((s) => `${formaterDate(s.date)} (${heuresTexte(s.valide_minutes)})`);
  return [
    'Madame, Monsieur,',
    '',
    `Dans le cadre du suivi de l'assiduité de votre apprenti(e) au sein de notre centre de formation, nous souhaitons vous communiquer un récapitulatif de sa situation pour le mois ${/^[aeiouéèh]/i.test(moisTexte(mois)) ? "d'" : 'de '}${moisTexte(mois)}.`,
    '',
    'Vous trouverez ci-dessous le bilan des absences et retards irrecevables constatés sur cette période :',
    `- Nombre d'heures d'absence irrecevable : ${heuresTexte(d.min_absences)}.`,
    `- Nombre d'heures de retard irrecevable : ${heuresTexte(d.min_retards)}.`,
    `- Total des heures à régulariser : ${heuresTexte(d.min_absences + d.min_retards)}.`,
    ...(detail.length ? ['', 'Détail :', ...detail] : []),
    '',
    'Concernant les rattrapages, voici le bilan des heures déjà effectuées :',
    `- Nombre d'heures rattrapées : ${heuresTexte(d.min_rattrapees)}.`,
    `- Dates des rattrapages effectués : ${dates.length ? dates.join(', ') : 'aucun à ce jour'}.`,
    `- Solde des heures restant à rattraper : ${heuresTexte(d.solde)}.`,
    '',
    ...(avecEmargements ? ["Vous trouverez en pièces jointes les feuilles d'émargement signées par votre apprenti(e), attestant des heures de rattrapage effectivement réalisées.", ''] : []),
    "Ce suivi permet d'assurer une traçabilité des absences et de leur régularisation tout au long de la formation.",
    '',
    "Nous restons à votre disposition pour tout complément d'information.",
    '',
    'Cordialement,',
    e.nom,
    e.service,
    e.coordonnees,
  ].join('\n');
}
