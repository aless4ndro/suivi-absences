import { useEffect, useState, type FormEvent } from 'react';
import { auth, fichiers } from '../api';

export default function Parametres({ apresRestauration }: { apresRestauration: () => void }) {
  const [dossier, setDossier] = useState('');
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState('');
  const [ancien, setAncien] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [infoMdp, setInfoMdp] = useState('');
  const [erreurMdp, setErreurMdp] = useState('');

  useEffect(() => {
    fichiers<{ dossier: string }>('emplacement').then((r) => setDossier(r.dossier));
  }, []);

  async function sauvegarder() {
    setMessage(''); setErreur('');
    try {
      const r = await fichiers<{ annule?: boolean; chemin?: string }>('sauvegarder');
      if (!r.annule) setMessage(`Sauvegarde enregistrée : ${r.chemin}`);
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  async function restaurer() {
    setMessage(''); setErreur('');
    try {
      const r = await fichiers<{ annule?: boolean; restaure?: boolean }>('restaurer');
      if (r.restaure) apresRestauration();
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  async function changerMdp(e: FormEvent) {
    e.preventDefault();
    setInfoMdp(''); setErreurMdp('');
    if (nouveau !== confirmation) {
      setErreurMdp('Les deux nouveaux mots de passe sont différents.');
      return;
    }
    try {
      await auth('changer', { ancien, nouveau });
      setInfoMdp('Mot de passe modifié.');
      setAncien(''); setNouveau(''); setConfirmation('');
    } catch (err) {
      setErreurMdp((err as Error).message);
    }
  }

  return (
    <>
      <h1>Paramètres</h1>

      <section className="fiche">
        <h2>Sauvegarde des données</h2>
        <p className="discret">
          Enregistre un fichier contenant toutes les données. Faites-le régulièrement et conservez-le
          dans un endroit sûr (clé USB, dossier sauvegardé) : il contient les informations des élèves.
        </p>
        <div className="actions">
          <button className="principal" onClick={sauvegarder}>Sauvegarder</button>
          <button onClick={restaurer}>Restaurer une sauvegarde</button>
        </div>
        {message && <p className="succes">{message}</p>}
        {erreur && <p className="erreur">{erreur}</p>}
        {dossier && <p className="discret">Emplacement des données sur ce poste : {dossier}</p>}
      </section>

      <section className="fiche">
        <h2>Mot de passe</h2>
        <form onSubmit={changerMdp}>
          <div className="grille">
            <label>Ancien mot de passe<input type="password" required value={ancien} onChange={(e) => setAncien(e.target.value)} /></label>
            <span />
            <label>Nouveau mot de passe<input type="password" required value={nouveau} onChange={(e) => setNouveau(e.target.value)} /></label>
            <label>Confirmer<input type="password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>
          </div>
          {infoMdp && <p className="succes">{infoMdp}</p>}
          {erreurMdp && <p className="erreur">{erreurMdp}</p>}
          <div className="actions">
            <button type="submit">Changer le mot de passe</button>
          </div>
        </form>
      </section>
    </>
  );
}
