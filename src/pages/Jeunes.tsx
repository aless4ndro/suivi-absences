import { useEffect, useState, type FormEvent } from 'react';
import { appeler, type Classe, type Entreprise, type Jeune } from '../api';

export default function Jeunes() {
  const [classes, setClasses] = useState<Classe[]>([]);
  const [entreprises, setEntreprises] = useState<Entreprise[]>([]);
  const [liste, setListe] = useState<Jeune[]>([]);
  const [filtre, setFiltre] = useState<number | 'toutes'>('toutes');
  const [fiche, setFiche] = useState<Jeune | null>(null);
  const [erreur, setErreur] = useState('');

  const charger = () => appeler<Jeune[]>('jeunes:list').then(setListe);
  useEffect(() => {
    appeler<Classe[]>('classes:list').then(setClasses);
    appeler<Entreprise[]>('entreprises:list').then(setEntreprises);
    charger();
  }, []);

  const visibles = filtre === 'toutes' ? liste : liste.filter((j) => j.classe_id === filtre);

  function nouveau() {
    setErreur('');
    setFiche({
      nom: '', prenom: '', email: '', telephone: '',
      classe_id: filtre === 'toutes' ? classes[0]?.id ?? 0 : filtre,
      entreprise_id: null, maitre_nom: '', maitre_telephone: '', maitre_email: '',
    });
  }

  const champ = (cle: keyof Jeune) => ({
    value: (fiche?.[cle] as string | null) ?? '',
    onChange: (e: { target: { value: string } }) => setFiche({ ...fiche!, [cle]: e.target.value }),
  });

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    try {
      await appeler('jeunes:save', fiche);
      setFiche(null);
      setErreur('');
      charger();
    } catch (err) {
      setErreur((err as Error).message);
    }
  }

  async function supprimer(j: Jeune) {
    if (!confirm(`Supprimer la fiche de ${j.prenom} ${j.nom} ?\nSes absences et rattrapages seront aussi supprimés.`)) return;
    await appeler('jeunes:delete', j.id);
    charger();
  }

  return (
    <>
      <div className="entete">
        <h1>Jeunes</h1>
        <button className="principal" onClick={nouveau}>Ajouter un jeune</button>
      </div>

      <div className="onglets">
        <button className={filtre === 'toutes' ? 'actif' : ''} onClick={() => setFiltre('toutes')}>
          Toutes ({liste.length})
        </button>
        {classes.map((c) => (
          <button key={c.id} className={filtre === c.id ? 'actif' : ''} onClick={() => setFiltre(c.id)} title={c.libelle}>
            {c.code} ({liste.filter((j) => j.classe_id === c.id).length})
          </button>
        ))}
      </div>

      {fiche && (
        <form className="fiche" onSubmit={enregistrer}>
          <h2>{fiche.id ? 'Modifier la fiche' : 'Nouveau jeune'}</h2>
          <div className="grille">
            <label>Nom *<input autoFocus required {...champ('nom')} /></label>
            <label>Prénom *<input required {...champ('prenom')} /></label>
            <label>E-mail<input type="email" {...champ('email')} /></label>
            <label>Téléphone<input type="tel" {...champ('telephone')} /></label>
            <label>Classe *
              <select value={fiche.classe_id} onChange={(e) => setFiche({ ...fiche, classe_id: Number(e.target.value) })}>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.libelle}</option>)}
              </select>
            </label>
            <label>Entreprise
              <select
                value={fiche.entreprise_id ?? ''}
                onChange={(e) => setFiche({ ...fiche, entreprise_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Aucune pour le moment</option>
                {entreprises.map((ent) => <option key={ent.id} value={ent.id}>{ent.nom}</option>)}
              </select>
            </label>
          </div>
          <h3>Maître d'apprentissage</h3>
          <div className="grille">
            <label>Nom<input {...champ('maitre_nom')} /></label>
            <label>Téléphone<input type="tel" {...champ('maitre_telephone')} /></label>
            <label>E-mail<input type="email" {...champ('maitre_email')} /></label>
          </div>
          {erreur && <p className="erreur">{erreur}</p>}
          <div className="actions">
            <button type="submit" className="principal">Enregistrer</button>
            <button type="button" onClick={() => setFiche(null)}>Annuler</button>
          </div>
        </form>
      )}

      {visibles.length === 0 ? (
        <p className="discret">Aucun jeune enregistré ici pour le moment.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Jeune</th><th>Classe</th><th>Entreprise</th><th>Maître d'apprentissage</th><th></th></tr>
          </thead>
          <tbody>
            {visibles.map((j) => (
              <tr key={j.id}>
                <td>
                  <strong>{j.nom} {j.prenom}</strong>
                  <div className="discret">{[j.email, j.telephone].filter(Boolean).join(' · ')}</div>
                </td>
                <td>{j.classe_code}</td>
                <td>{j.entreprise_nom ?? <span className="discret">non renseignée</span>}</td>
                <td>
                  {j.maitre_nom}
                  <div className="discret">{[j.maitre_email, j.maitre_telephone].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="droite">
                  <button onClick={() => { setFiche(j); setErreur(''); }}>Modifier</button>
                  <button className="danger" onClick={() => supprimer(j)}>Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
