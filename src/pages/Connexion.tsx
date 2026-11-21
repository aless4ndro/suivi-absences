import { useState, type FormEvent } from 'react';
import { CalendarCheck, Lock } from 'lucide-react';
import { auth } from '../api';
import LogoIkelli from '../LogoIkelli';

export default function Connexion({ mdpDefini, onOk }: { mdpDefini: boolean; onOk: () => void }) {
  const [mdp, setMdp] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState('');

  async function valider(e: FormEvent) {
    e.preventDefault();
    setErreur('');
    if (!mdpDefini && mdp !== confirmation) {
      setErreur('Les deux mots de passe sont différents.');
      return;
    }
    try {
      await auth(mdpDefini ? 'connecter' : 'definir', { mdp });
      onOk();
    } catch (err) {
      setErreur((err as Error).message);
      setMdp('');
    }
  }

  return (
    <div className="connexion">
      <div className="connexion-fond" aria-hidden="true"><span /><span /><span /></div>
      <form className="verre" onSubmit={valider}>
        <div className="marque-connexion">
          <span className="marque-app"><CalendarCheck size={30} strokeWidth={1.8} /></span>
          <h1 className="nom-app">Présencia</h1>
          <p className="baseline">Assiduité, retards, sanctions : tout au même endroit.</p>
        </div>
        {mdpDefini ? (
          <p className="discret">Saisissez votre mot de passe pour accéder aux données.</p>
        ) : (
          <p className="discret">
            Première utilisation : choisissez un mot de passe (8 caractères minimum). Notez-le bien :
            l'application ne peut pas le retrouver.
          </p>
        )}
        <label>
          Mot de passe
          <input type="password" autoFocus required value={mdp} onChange={(e) => setMdp(e.target.value)} />
        </label>
        {!mdpDefini && (
          <label style={{ marginTop: 12 }}>
            Confirmer le mot de passe
            <input type="password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
          </label>
        )}
        {erreur && <p className="erreur">{erreur}</p>}
        <div className="actions">
          <button type="submit" className="bouton-verre"><Lock size={16} strokeWidth={1.8} />{mdpDefini ? 'Se connecter' : 'Créer le mot de passe'}</button>
        </div>
      </form>
      <p className="developpe-par">Développé par <LogoIkelli hauteur={20} /></p>
    </div>
  );
}
