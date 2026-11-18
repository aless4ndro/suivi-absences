export type Classe = { id: number; code: string; libelle: string };
export type Entreprise = {
  id?: number; nom: string; adresse: string | null; telephone: string | null;
  email: string | null; nb_jeunes?: number;
};
export type Jeune = {
  id?: number; nom: string; prenom: string; email: string | null; telephone: string | null;
  classe_id: number; entreprise_id: number | null;
  civilite?: string | null; adresse?: string | null; code_postal?: string | null; ville?: string | null;
  maitre_nom: string | null; maitre_telephone: string | null; maitre_email: string | null;
  classe_code?: string; entreprise_nom?: string | null;
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
export type Destinataire = { cle: string; libelle: string; email: string; telephone: string | null; role?: 'pp' };
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
