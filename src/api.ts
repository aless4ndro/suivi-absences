export type Classe = { id: number; code: string; libelle: string; ordre?: number };
export type Entreprise = {
  id?: number; nom: string; adresse: string | null; telephone: string | null;
  email: string | null; nb_jeunes?: number; nom_commercial?: string | null; siret?: string | null; code_postal?: string | null; ville?: string | null;
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

// ---- Alertes de seuils ----
export type StatutAlerte = 'nouvelle' | 'a_traiter' | 'en_cours' | 'traitee' | 'sans_suite' | 'cloturee';
export const NOMS_STATUT_ALERTE: Record<StatutAlerte, string> = { nouvelle: 'Nouvelle', a_traiter: 'À traiter', en_cours: 'En cours', traitee: 'Traitée', sans_suite: 'Sans suite', cloturee: 'Clôturée' };
export type RegleAlerte = { id: number; code: 'retards' | 'demi_journees' | 'cumul'; libelle: string; seuil: number; periode: 'semaine' | 'mois' | 'annee'; actif: number; destinataires: number[] };
export type Alerte = {
  id: number; regle_id: number; jeune_id: number; periode_cle: string; valeur: number; seuil: number; statut: StatutAlerte; note: string | null; cree_le: string;
  regle_code: string; regle_libelle: string; jeune_nom: string; jeune_prenom: string; periode_libelle: string;
};
export type AlerteDetail = Alerte & {
  faits: { date: string; nature: string; detail: string; motif: string | null }[];
  destinataires: { id: number; nom: string; fonction: string | null; email: string | null }[];
  journal: { id: number; quand: string; action: string; detail: string | null }[];
};

// ---- Tableau de bord disciplinaire ----
export type TableauBord = {
  indicateurs: { alertes_a_traiter: number; sanctions_prononcees: number; commissions_programmees: number; commissions_a_organiser: number };
  alertes: { id: number; jeune_id: number; jeune_nom: string; jeune_prenom: string; classe_code: string; regle: string; valeur: number; seuil: number; statut: StatutAlerte; periode_cle: string }[];
  commissions_a_venir: LigneDashCommission[];
  commissions_a_organiser: LigneDashCommission[];
  sanctions: { id: number; jeune_id: number; jeune_nom: string; jeune_prenom: string; classe_code: string; palier: string | null; motif: string; date_decision: string | null; date_faits: string }[];
};
export type LigneDashCommission = {
  id: number; jeune_id: number; jeune_nom: string; jeune_prenom: string; classe_code: string; type: TypeCommission; date: string | null; heure_debut: string | null;
  statut: StatutCommission; motif: string; nb_convocations: number; participants: string | null;
};

// ---- Bibliothèque de mails types ----
export type ModeleMail = { id?: number; nom: string; categorie: string; objet: string; contenu: string; destinataires: string | null; actif: number };
export type MailRendu = { objet: string; corps: string; destinataires: string | null; modele_nom: string | null; manquantes: string[] };
export type MailHistorique = { id: number; quand: string; source: string; destinataires: string; objet: string; contenu: string; pieces: string | null; modele_nom: string | null; methode: string; statut: string };

// ---- Import de calendriers ----
export type TypeJour = 'centre' | 'entreprise' | 'autre';
export type LectureCalendrier = {
  annule?: boolean; nom: string; feuille: string; avertissements: string[];
  jours: { date: string; cle: string }[];
  legende: { cle: string; libelle: string | null; type_propose: TypeJour | null; nb: number }[];
};
export type VersionCalendrier = { id: number; source: string; motif: string; nb_jours: number; archive_le: string };

// ---- Import des apprentis, entreprises et contrats ----
export type ImportFeuille = { nom: string | null; entetes: string[]; lignes: string[][]; numeros: number[]; champs: (string | null)[] };
export type ImportFichier = { annule?: boolean; nom: string; ignorees: string[]; feuilles: ImportFeuille[]; liste_champs: Record<string, string> };
export type ImportCandidat = { id: number; nom: string; prenom?: string; date_naissance: string | null; classe_code: string | null; entreprise_nom: string | null; siret: string | null; ville: string | null; code_postal: string | null };
export type ImportDiff = { champ: string; actuel?: string; fichier: string; valeur?: string; remplacer?: boolean };
export type ImportLigne = {
  index: number; etiquette: string; exclu_auto?: string | null; champs: Record<string, any>; anomalies: string[]; bloquants: string[]; manquants: string[];
  statut: 'ok' | 'attention' | 'a_confirmer' | 'bloque' | 'exclu'; classe_id: number | null; classe_code: string | null; exclu: boolean; texte_classe: string | null;
  apprenti: { statut: 'nouveau' | 'existant' | 'a_confirmer'; id: number | null; raison: string; candidats: ImportCandidat[]; completions: ImportDiff[]; differences: ImportDiff[] };
  changement_classe: { de: string; vers: string; appliquer: boolean } | null;
  entreprise: { cle?: string | null; statut: string };
  contrat: { action: string; appliquer?: boolean; entreprise_actuelle?: string | null };
};
export type ImportEntreprise = { cle: string; statut: string; id: number | null; raison: string; nom: string; siret: string | null; candidats: ImportCandidat[]; completions: ImportDiff[]; differences: ImportDiff[]; lignes: number[] };
export type ImportAnalyse = {
  lignes: ImportLigne[]; entreprises: ImportEntreprise[]; valeursClasse: { texte: string; cle: string; classe_id: number | null }[];
  resume: { total: number; exclues: number; bloquees: number; a_confirmer: number; apprentis_nouveaux: number; apprentis_existants: number; manquants: number; entreprises_nouvelles: number; entreprises_existantes: number; contrats: number; anomalies: number };
};
export type ImportDecisions = { lignes: Record<number, { exclu?: boolean; apprenti_id?: number | 'nouveau'; remplacer?: string[]; classe_changer?: boolean; nouveau_contrat?: boolean; classe_id?: number }>; entreprises: Record<string, { id?: number | 'nouveau'; remplacer?: string[] }> };
export type ImportHistorique = {
  id: number; fichier: string; date_import: string; utilisateur: string | null; annee_scolaire: string; statut: 'valide' | 'annule';
  nb_lignes: number; nb_apprentis_crees: number; nb_apprentis_maj: number; nb_entreprises_creees: number; nb_entreprises_maj: number;
  nb_rapprochements: number; nb_anomalies: number; annule_le: string | null; annule_rapport: string | null;
};

// ── Récapitulatif absences / retards / sanctions ──
export type TotalRecap = { nb: number; minutes: number };
export type DetailRecap = TotalRecap & { justifiees: TotalRecap; injustifiees: TotalRecap; en_attente: TotalRecap };
export type EvenementRecap = { id: number; jeune_id: number; type: 'absence' | 'retard'; date_debut: string; date_fin: string | null; duree_minutes: number | null; motif_libelle: string | null; motif_statut: 'recevable' | 'irrecevable' | null };
export type SanctionRecap = { id: number; jeune_id: number; date_faits: string; date_decision: string | null; statut: string; duree: string | null; palier: string | null; motif: string };
export type ApprentiRecap = { id: number; nom: string; prenom: string; classe_id: number; classe_code: string; absences: DetailRecap; retards: DetailRecap; evenements: EvenementRecap[]; sanctions: SanctionRecap[] };
export type DomainesRecap = { absences?: boolean; retards?: boolean; sanctions?: boolean };
export type CriteresRecap = { debut: string; fin: string; domaines: ('absences' | 'retards' | 'sanctions')[]; classe_ids: number[]; jeune_ids: number[]; recherche: string; annee_scolaire: string | null };
export type MoisRecap = { mois: string; absences: number; min_absences: number; retards: number; min_retards: number; sanctions: number };
export type ClasseRecap = { classe: string; apprentis: number; absences: number; min_absences: number; retards: number; min_retards: number; sanctions: number };
export type ResultatRecap = {
  criteres: CriteresRecap; genere_le: string; empreinte: string;
  totaux: { apprentis: number; absences: DetailRecap; retards: DetailRecap; sanctions: number };
  apprentis: ApprentiRecap[]; par_mois: MoisRecap[]; par_classe: ClasseRecap[]; par_palier: { palier: string; nb: number }[];
  etablissement: Etablissement | null;
};
export type ControleEnvoi = { ok: boolean; erreurs: string[]; avertissements: string[]; verifies: { adresse: string; nature: 'entreprise' | 'pp' | 'libre' }[] };
export type ExtractionRecap = { id: number; date_extraction: string; utilisateur: string | null; debut: string; fin: string; domaines: string; criteres: string; empreinte: string; nb_apprentis: number; usage: string | null };
export type TransmissionRecap = { id: number; extraction_id: number | null; date_envoi: string; utilisateur: string | null; jeune_id: number | null; jeune_nom: string | null; jeune_prenom: string | null; destinataires: string; type_document: string; domaines: string; avec_sanctions: number; pieces: string | null; objet: string | null };
