export type Classe = { id: number; code: string; libelle: string };
export type Entreprise = {
  id?: number; nom: string; adresse: string | null; telephone: string | null;
  email: string | null; nb_jeunes?: number;
};
export type Jeune = {
  id?: number; nom: string; prenom: string; email: string | null; telephone: string | null;
  classe_id: number; entreprise_id: number | null;
  maitre_nom: string | null; maitre_telephone: string | null; maitre_email: string | null;
  classe_code?: string; entreprise_nom?: string | null;
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
      fichiers: (action: string) => Promise<any>;
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

export async function fichiers<T = any>(action: string): Promise<T> {
  try {
    return await window.api.fichiers(action);
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
