import { useEffect, useState, type FormEvent } from 'react';
import { appeler, type Motif } from '../api';

const VIDE: Motif = { libelle: '', statut: 'recevable' };

export default function Motifs() {
  const [liste, setListe] = useState<Motif[]>([]);
  const [fiche, setFiche] = useState<Motif | null>(null);
  const [erreur, setErreur] = useState('');

  const charger = () => appeler<Motif[]>('motifs:list').then(setListe);
  useEffect(() => {
    charger();
  }, []);

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    try {
      await appeler('motifs:save', fiche);
      setFiche(null);
      setErreur('');
      charger();
    } catch (err) {
      setErreur((err as Error).message);
    }
  }

  async function supprimer(m: Motif) {
    if (!confirm(`Supprimer le motif « ${m.libelle} » ?`)) return;
    try {
      await appeler('motifs:delete', m.id);
      setErreur('');
      charger();
    } catch (err) {
      setErreur((err as Error).message);
    }
  }

  return (
    <>
      <div className="entete">
        <h1>Motifs d'absence et de retard</h1>
        <button className="principal" onClick={() => { setFiche({ ...VIDE }); setErreur(''); }}>
          Ajouter un motif
        </button>
      </div>
      <p className="discret">
        Chaque motif est créé une seule fois, puis choisi dans la liste déroulante lors de la saisie d'une absence ou
        d'un retard. Modifier le statut d'un motif change aussi les absences et retards déjà saisis avec ce motif.
      </p>

      {fiche && (
        <form className="fiche" onSubmit={enregistrer}>
          <h2>{fiche.id ? 'Modifier le motif' : 'Nouveau motif'}</h2>
          <div className="grille">
            <label>
              Libellé *
              <input autoFocus required value={fiche.libelle} onChange={(e) => setFiche({ ...fiche, libelle: e.target.value })} />
            </label>
            <label>
              Statut *
              <select value={fiche.statut} onChange={(e) => setFiche({ ...fiche, statut: e.target.value as Motif['statut'] })}>
                <option value="recevable">Recevable</option>
                <option value="irrecevable">Irrecevable</option>
              </select>
            </label>
          </div>
          {erreur && <p className="erreur">{erreur}</p>}
          <div className="actions">
            <button type="submit" className="principal">Enregistrer</button>
            <button type="button" onClick={() => setFiche(null)}>Annuler</button>
          </div>
        </form>
      )}
      {!fiche && erreur && <p className="erreur">{erreur}</p>}

      {liste.length === 0 ? (
        <p className="discret">Aucun motif enregistré pour le moment.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Libellé</th><th>Statut</th><th>Utilisations</th><th></th></tr>
          </thead>
          <tbody>
            {liste.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.libelle}</strong></td>
                <td>
                  <span className={`etiquette ${m.statut}`}>{m.statut === 'recevable' ? 'Recevable' : 'Irrecevable'}</span>
                </td>
                <td>{m.nb_utilisations}</td>
                <td className="droite">
                  <button onClick={() => { setFiche(m); setErreur(''); }}>Modifier</button>
                  <button className="danger" onClick={() => supprimer(m)}>Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
