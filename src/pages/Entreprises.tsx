import { useEffect, useState, type FormEvent } from 'react';
import { appeler, type Entreprise } from '../api';

const VIDE: Entreprise = { nom: '', adresse: '', telephone: '', email: '' };

export default function Entreprises() {
  const [liste, setListe] = useState<Entreprise[]>([]);
  const [fiche, setFiche] = useState<Entreprise | null>(null);
  const [erreur, setErreur] = useState('');

  const charger = () => appeler<Entreprise[]>('entreprises:list').then(setListe);
  useEffect(() => {
    charger();
  }, []);

  const champ = (cle: keyof Entreprise) => ({
    value: (fiche?.[cle] as string | null) ?? '',
    onChange: (e: { target: { value: string } }) => setFiche({ ...fiche!, [cle]: e.target.value }),
  });

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    try {
      await appeler('entreprises:save', fiche);
      setFiche(null);
      setErreur('');
      charger();
    } catch (err) {
      setErreur((err as Error).message);
    }
  }

  async function supprimer(ent: Entreprise) {
    const suite = ent.nb_jeunes ? `\n${ent.nb_jeunes} jeune(s) n'auront plus d'entreprise rattachée.` : '';
    if (!confirm(`Supprimer l'entreprise « ${ent.nom} » ?${suite}`)) return;
    await appeler('entreprises:delete', ent.id);
    charger();
  }

  return (
    <>
      <div className="entete">
        <h1>Entreprises</h1>
        <button className="principal" onClick={() => { setFiche({ ...VIDE }); setErreur(''); }}>
          Ajouter une entreprise
        </button>
      </div>

      {fiche && (
        <form className="fiche" onSubmit={enregistrer}>
          <h2>{fiche.id ? "Modifier l'entreprise" : 'Nouvelle entreprise'}</h2>
          <div className="grille">
            <label>Nom *<input autoFocus required {...champ('nom')} /></label>
            <label>Adresse<input {...champ('adresse')} /></label>
            <label>Téléphone<input type="tel" {...champ('telephone')} /></label>
            <label>E-mail<input type="email" {...champ('email')} /></label>
          </div>
          {erreur && <p className="erreur">{erreur}</p>}
          <div className="actions">
            <button type="submit" className="principal">Enregistrer</button>
            <button type="button" onClick={() => setFiche(null)}>Annuler</button>
          </div>
        </form>
      )}

      {liste.length === 0 ? (
        <p className="discret">Aucune entreprise enregistrée pour le moment.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Nom</th><th>Téléphone</th><th>E-mail</th><th>Jeunes</th><th></th></tr>
          </thead>
          <tbody>
            {liste.map((ent) => (
              <tr key={ent.id}>
                <td><strong>{ent.nom}</strong>{ent.adresse && <div className="discret">{ent.adresse}</div>}</td>
                <td>{ent.telephone}</td>
                <td>{ent.email}</td>
                <td>{ent.nb_jeunes}</td>
                <td className="droite">
                  <button onClick={() => { setFiche(ent); setErreur(''); }}>Modifier</button>
                  <button className="danger" onClick={() => supprimer(ent)}>Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
