import { useEffect, useState, type FormEvent } from 'react';
import { appeler, auth, fichiers, type Horaires } from '../api';

export default function Parametres({ apresRestauration }: { apresRestauration: () => void }) {
  const [dossier, setDossier] = useState('');
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState('');
  const [ancien, setAncien] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [infoMdp, setInfoMdp] = useState('');
  const [erreurMdp, setErreurMdp] = useState('');

  const [horaires, setHoraires] = useState<Horaires | null>(null);
  const [infoHoraires, setInfoHoraires] = useState('');
  const [erreurHoraires, setErreurHoraires] = useState('');

  useEffect(() => {
    fichiers<{ dossier: string }>('emplacement').then((r) => setDossier(r.dossier));
    appeler<Horaires>('horaires:get').then(setHoraires);
  }, []);

  async function enregistrerHoraires(e: FormEvent) {
    e.preventDefault();
    setInfoHoraires(''); setErreurHoraires('');
    try {
      await appeler('horaires:save', horaires);
      setInfoHoraires('Horaires enregistrés.');
    } catch (err) {
      setErreurHoraires((err as Error).message);
    }
  }

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

      {horaires && (
        <section className="fiche">
          <h2>Horaires d'une journée de cours</h2>
          <p className="discret">
            Servent à remplir automatiquement une « journée complète » dans Absences et retards. La pause déjeuner
            n'est pas comptée comme du temps d'absence. Vous pouvez toujours ajuster les heures au moment de la saisie.
          </p>
          <form onSubmit={enregistrerHoraires}>
            <div className="grille">
              <label>Début de journée<input type="time" required value={horaires.debut} onChange={(e) => setHoraires({ ...horaires, debut: e.target.value })} /></label>
              <label>Début de la pause déjeuner<input type="time" required value={horaires.pause_debut} onChange={(e) => setHoraires({ ...horaires, pause_debut: e.target.value })} /></label>
              <label>Fin de la pause déjeuner<input type="time" required value={horaires.pause_fin} onChange={(e) => setHoraires({ ...horaires, pause_fin: e.target.value })} /></label>
              <label>Fin de journée<input type="time" required value={horaires.fin} onChange={(e) => setHoraires({ ...horaires, fin: e.target.value })} /></label>
            </div>
            {infoHoraires && <p className="succes">{infoHoraires}</p>}
            {erreurHoraires && <p className="erreur">{erreurHoraires}</p>}
            <div className="actions"><button type="submit" className="principal">Enregistrer les horaires</button></div>
          </form>
        </section>
      )}

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
