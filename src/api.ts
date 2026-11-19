export type Classe = { id: number; code: string; libelle: string; ordre?: number };
export type Entreprise = {
  id?: number; nom: string; adresse: string | null; telephone: string | null;
  email: string | null; nb_jeunes?: number; nom_commercial?: string | null; siret?: string | null;
};
export type Jeune = {
  id?: number; nom: string; prenom: string; email: string | null; telephone: string | null;
  classe_id: number; entreprise_id: number | null;
  civilite?: string | null; adresse?: string | null; code_postal?: string | null; ville?: string | null;
  maitre_nom: string | null; maitre_telephone: string | null; maitre_email: string | null;
  classe_code?: string; entreprise_nom?: string | null;
  passage_prevu?: { date: string; classe_code: string; type?: string | null } | null;
  classe_depuis?: string; classe_correction?: boolean;
  contrat_depuis?: string; contrat_correction?: boolean;
  sorti?: boolean; sorti_le?: string | null; sortie_motif?: string | null;
  contrat_debut?: string | null; contrat_fin?: string | null; rupture_le?: string | null; contrat_statut?: StatutContrat;
  date_naissance?: string | null; representant_nom?: string | null; representant_email?: string | null;
  entreprise_telephone?: string | null; entreprise_email?: string | null;
};
export type Stats = {
  classes: (Classe & { nb_jeunes: number })[];
  nb_entreprises: number;
};

export type Etat = { mdpDefini: boolean; deverrouille: boolean };

declare global {
  interface Window {
    api: {
      appeler: (action: string, arg?: unknown) => Promise<any>;
      auth: (action: string, arg?: unknown) => Promise<any>;
      fichiers: (action: string, arg?: unknown) => Promise<any>;
      courriel: (action: string, arg?: unknown) => Promise<any>;
      documents: (action: string, arg?: unknown) => Promise<any>;
    };
  }
}

function nettoyer(e: unknown): Error {
  // Electron préfixe le message d'erreur : on ne garde que la partie utile
  const msg = e instanceof Error ? e.message : String(e);
  return new Error(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
}

export async function appeler<T>(action: string, arg?: unknown): Promise<T> {
  try {
    return await window.api.appeler(action, arg);
  } catch (e) {
    throw nettoyer(e);
  }
}

export async function auth<T = any>(action: string, arg?: unknown): Promise<T> {
  try {
    return await window.api.auth(action, arg);
  } catch (e) {
    throw nettoyer(e);
  }
}

export async function fichiers<T = any>(action: string, arg?: unknown): Promise<T> {
  try {
    return await window.api.fichiers(action, arg);
  } catch (e) {
    throw nettoyer(e);
  }
}

export type Motif = {
  id?: number;
  libelle: string;
  statut: 'recevable' | 'irrecevable';
  nb_utilisations?: number;
};

export type Creneau = { id?: number; date: string; heure_debut: string; heure_fin: string; duree_minutes?: number };

export type Evenement = {
  id: number;
  jeune_id: number;
  type: 'absence' | 'retard';
  date_debut: string;
  date_fin: string | null;
  duree_minutes: number;
  motif_id: number | null;
  observations: string | null;
  mail_copie: string | null;
  notifie_le: string | null;
  jeune_nom: string;
  jeune_prenom: string;
  classe_code: string;
  entreprise_nom: string | null;
  motif_libelle: string | null;
  motif_statut: 'recevable' | 'irrecevable' | null;
  nb_pieces: number;
  creneaux: Creneau[];
  pieces: Piece[];
};

export type Contact = { id?: number; entreprise_id: number; nom: string; fonction: string | null; telephone: string | null; email: string | null };
export type Destinataire = { cle: string; libelle: string; email: string; telephone: string | null; role?: 'pp' | 'representant' };
export type Professeur = {
  id?: number; nom: string; prenom: string; email: string | null; telephone: string | null; fonction: string | null;
  observations: string | null; actif: number; nb_affectations?: number; classes_actuelles?: string[];
};
export type Affectation = {
  id: number; classe_id: number; professeur_id: number; annee_scolaire: string; date_debut: string; date_fin: string | null;
  fin_effective: string; note: string | null; classe_code: string; classe_libelle: string; formation: string;
  nom: string; prenom: string; email: string | null; telephone: string | null; actif: number; en_cours: boolean; a_venir: boolean;
};
export type AlertesPP = { annee: string; date_reference: string; sans_pp: string[]; sans_email: string[]; inactifs: string[] };
export type Horaires = { debut: string; pause_debut: string; pause_fin: string; fin: string };

export type Vacances = { id: number; debut: string; fin: string; libelle: string };
export type JourCalendrier = { date: string; type: 'centre' | 'entreprise' | 'autre'; libelle: string | null };

export type Piece = { id: number; nom_fichier: string; taille: number };
export type PieceChoisie = { token: string; nom: string; taille: number };
export type FiltresEvenements = {
  classe_id?: number;
  jeune_id?: number;
  mois?: string;
  type?: '' | 'absence' | 'retard';
  statut?: '' | 'a_traiter' | 'recevable' | 'irrecevable';
  notifie?: '' | 'oui' | 'non';
};

export type Apercu = { destinataires?: Destinataire[]; a: string; objet: string; corps: string; avertissement: string | null };
export type ResultatCourriel = { methode: 'outlook' | 'mailto'; raison?: string; nbPieces?: number };

export async function courriel<T = any>(action: string, arg?: unknown): Promise<T> {
  try {
    return await window.api.courriel(action, arg);
  } catch (e) {
    throw nettoyer(e);
  }
}

export async function documents<T = any>(action: string, arg?: unknown): Promise<T> {
  try {
    return await window.api.documents(action, arg);
  } catch (e) {
    throw nettoyer(e);
  }
}

export type Seance = {
  id: number; jeune_id: number; date: string; heure_debut: string; heure_fin: string; duree_minutes: number;
  salle: string | null; periode_debut: string | null; periode_fin: string | null;
  statut: 'programmee' | 'effectuee' | 'non_effectuee'; duree_validee_minutes: number | null;
  valide_le: string | null; convocation_le: string | null; observations: string | null;
  pieces: { id: number; nom_fichier: string; taille: number }[];
};

export type StatutRattrapage = 'a_programmer' | 'programme' | 'partiel' | 'termine' | 'non_effectue';

export type ApprentiBilan = {
  id: number; nom: string; prenom: string; classe_id: number; classe_code: string;
  nb_absences: number; nb_retards: number; min_absences: number; min_retards: number;
  dues: number; programmees: number; validees: number; solde: number; reste_a_programmer: number;
  nb_seances: number; nb_non_effectuees: number; statut: StatutRattrapage | 'aucun';
};

export type Bilan = {
  totaux: {
    nb_apprentis: number; nb_absences: number; nb_retards: number; dues: number; programmees: number;
    validees: number; solde: number; sans_rattrapage: number; regularises: number;
  };
  apprentis: ApprentiBilan[];
};

export type Etablissement = {
  nom: string; ville: string; signataire: string; fonction: string; referent: string; absents: string; salle: string;
  service: string; coordonnees: string; pied_titre: string; pied_lignes: string; pied_site: string;
};

export type Journal = { id: number; jeune_id: number; seance_id: number | null; quand: string; action: string; detail: string | null };

export type DonneesDocument = {
  jeune: { id: number; nom: string; prenom: string; civilite: string | null; adresse: string | null; code_postal: string | null; ville: string | null; classe_code: string };
  seances: Seance[]; periode_debut: string | null; periode_fin: string | null; dues: number; solde_avant: number; etablissement: Etablissement;
};

export type LigneClasse = { id: number; jeune_id: number; classe_id: number; date_debut: string; note: string | null; type: string | null; classe_code: string };
export type LigneContrat = {
  id: number; jeune_id: number; entreprise_id: number | null; entreprise_nom: string | null; maitre_nom: string | null;
  maitre_telephone: string | null; maitre_email: string | null; date_debut: string; note: string | null;
};
export const MOTIFS_SORTIE: Record<string, string> = {
  demission: 'Démission / abandon', rupture: 'Rupture du contrat', diplome: 'Fin de formation (diplômé)', autre: 'Autre sortie',
};
export type ResultatRecherche =
  | { type: 'apprenti'; id: number; libelle: string; classe: string; annee: string; sorti: boolean; sorti_le: string | null }
  | { type: 'entreprise'; id: number; libelle: string; nom_commercial: string | null; siret: string | null; nb_apprentis: number };
export type Cible = { type: 'apprenti' | 'entreprise'; id: number };
export type StatutContrat = 'en_cours' | 'a_venir' | 'termine' | 'rompu';
export const STATUTS_CONTRAT: Record<StatutContrat, { texte: string; classe: string }> = {
  en_cours: { texte: 'En cours', classe: 'st-vert' }, a_venir: { texte: 'À venir', classe: 'st-bleu' },
  termine: { texte: 'Terminé', classe: '' }, rompu: { texte: 'Rompu', classe: 'st-rouge' },
};
export type ApprentiEntreprise = {
  jeune_id: number; nom: string; prenom: string; photo: string | null; classe_code: string; formation: string;
  contrat_debut: string | null; contrat_fin: string | null; statut: StatutContrat; maitre_nom: string | null;
};
type Part = { nb: number; minutes: number };
export type TotauxAssiduite = Part & { justifiees: Part; injustifiees: Part; en_attente: Part };
export type EvenementAssiduite = {
  id: number; type: 'absence' | 'retard'; date_debut: string; date_fin: string | null; duree_minutes: number | null;
  observations: string | null; notifie_le: string | null; motif_libelle: string | null; motif_statut: 'recevable' | 'irrecevable' | null; nb_pieces: number;
};
export type Assiduite = {
  jeune: { id: number; nom: string; prenom: string; classe: string; classe_libelle: string };
  debut: string; fin: string; absences: TotauxAssiduite; retards: TotauxAssiduite; evenements: EvenementAssiduite[];
  rattrapage: { dues: number; validees: number; programmees: number; solde: number }; etablissement: Etablissement;
};

// ---- Discipline ----
export type Communication = 'obligatoire' | 'facultative' | 'non';
export const NOMS_COMMUNICATION: Record<Communication, string> = { obligatoire: 'Obligatoire', facultative: 'Facultative (à votre initiative)', non: 'Non prévue' };
export type Decision = 'en_attente' | 'sanction' | 'rappel' | 'aucune' | 'commission';
export const NOMS_DECISION: Record<Decision, string> = {
  en_attente: 'En attente de décision', sanction: 'Sanction prononcée', rappel: "Rappel à l'ordre", aucune: 'Aucune suite', commission: 'Orienter vers une commission',
};
export type Intervenant = { id?: number; nom: string; fonction: string | null; email: string | null; actif: number };
export type Palier = { id?: number; ordre?: number; libelle: string; communication: Communication; actif: number; nb_motifs?: number; nb_sanctions?: number };
export type MotifSanction = {
  id?: number; intitule: string; description: string | null; categorie: string | null; palier_id: number; actif: number;
  commentaire: string | null; communication: Communication | null; palier_ordre?: number; palier_libelle?: string; nb_utilisations?: number;
};
export type Proposition = {
  palier_id: number; ordre: number; libelle: string; raisons: string[]; mois: number;
  precedentes: { id: number; date_faits: string; motif: string; ordre: number; palier: string; dans_periode: boolean }[];
};
export type Sanction = {
  id?: number; jeune_id: number; jeune_nom?: string; jeune_prenom?: string; classe_code?: string;
  date_faits: string; motif_id: number; motif_intitule?: string;
  palier_propose_id?: number | null; palier_propose_libelle?: string | null; palier_propose_ordre?: number | null;
  decision: Decision; palier_retenu_id: number | null; palier_retenu_libelle?: string | null; palier_retenu_ordre?: number | null;
  justification: string | null; description: string | null; observations: string | null; date_decision: string | null; duree: string | null;
  intervenant_id: number | null; responsable_nom?: string | null; observations_apprenti: string | null; contestation: string | null;
  statut?: 'ouverte' | 'cloturee'; cloture_le?: string | null; communication?: Communication; communication_manquante?: boolean;
  nb_pieces?: number; nb_communications?: number;
};
export type SanctionDetail = Sanction & {
  pieces: { id: number; nom_fichier: string; taille: number; ajoute_le: string }[];
  communications: { id: number; quand: string; destinataires: string; objet: string; contenu: string; methode: string; statut: string }[];
  journal: { quand: string; action: string; detail: string | null }[];
};

// ---- Commissions ----
export type TypeCommission = 'pedagogique' | 'disciplinaire';
export type StatutCommission = 'a_programmer' | 'programmee' | 'convocations_envoyees' | 'realisee' | 'reportee' | 'annulee';
export const NOMS_STATUT_COMMISSION: Record<StatutCommission, string> = {
  a_programmer: 'À programmer', programmee: 'Programmée', convocations_envoyees: 'Convocations envoyées', realisee: 'Réalisée', reportee: 'Reportée', annulee: 'Annulée',
};
export const NOMS_TYPE_COMMISSION: Record<TypeCommission, string> = { pedagogique: 'Pédagogique', disciplinaire: 'Disciplinaire' };
export type Commission = {
  id?: number; jeune_id: number; type: TypeCommission; date: string | null; heure_debut: string | null; heure_fin: string | null; lieu: string | null;
  motif: string; commentaire: string | null; statut?: StatutCommission; compte_rendu: string | null; decision: string | null; suites: string | null;
  sanction_id?: number | null; jeune_nom?: string; jeune_prenom?: string; nb_participants?: number; nb_convocations?: number; nb_pieces?: number;
};
export type CommissionDetail = Commission & {
  classe_code: string | null;
  participants: { id: number; intervenant_id: number | null; nom: string; fonction: string | null; email: string | null }[];
  pieces: { id: number; nom_fichier: string; taille: number; genere: number; ajoute_le: string }[];
  communications: { id: number; quand: string; nature: string; destinataires: string; objet: string; statut: string }[];
  journal: { id: number; quand: string; action: string; detail: string | null }[];
};
export type RappelsCommissions = {
  a_programmer: LigneRappel[]; a_convoquer: LigneRappel[]; a_venir: LigneRappel[]; a_realiser: LigneRappel[]; jours: number;
};
export type LigneRappel = { id: number; jeune: string; type: TypeCommission; date: string | null; heure_debut: string | null; motif: string };
