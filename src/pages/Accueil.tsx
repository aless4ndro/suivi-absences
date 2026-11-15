import { useEffect, useState } from 'react';
import { appeler, type Stats } from '../api';

export default function Accueil({ allerA }: { allerA: (page: string) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    appeler<Stats>('stats').then(setStats);
  }, []);

  return (
    <>
      <h1>Accueil</h1>
      <div className="cartes">
        {stats?.classes.map((c) => (
          <button key={c.id} className="carte" onClick={() => allerA('jeunes')}>
            <span className="chiffre">{c.nb_jeunes}</span>
            <strong>{c.code}</strong>
            <span className="discret">{c.libelle}</span>
          </button>
        ))}
        {stats && (
          <button className="carte" onClick={() => allerA('entreprises')}>
            <span className="chiffre">{stats.nb_entreprises}</span>
            <strong>Entreprises</strong>
            <span className="discret">enregistrées</span>
          </button>
        )}
      </div>
      <p className="discret">
        Commencez par enregistrer les entreprises, puis les apprentis de chaque classe.
      </p>
    </>
  );
}
