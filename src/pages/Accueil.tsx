import { useEffect, useState } from 'react';
import { appeler, type AlertesPP, type FiltresEvenements, type Stats } from '../api';

type Alertes = { a_traiter: number; a_notifier: number };

export default function Accueil({ allerA }: { allerA: (page: string, filtre?: FiltresEvenements) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [alertes, setAlertes] = useState<Alertes | null>(null);
  const [pp, setPp] = useState<AlertesPP | null>(null);
  useEffect(() => {
    appeler<AlertesPP>('pp:alertes').then(setPp);
    appeler<Stats>('stats').then(setStats);
    appeler<Alertes>('evenements:alertes').then(setAlertes);
  }, []);

  return (
    <>
      <h1>Accueil</h1>

      {alertes && (
        <div className="cartes">
          <button className={`carte ${alertes.a_traiter ? 'alerte' : ''}`} onClick={() => allerA('absences', { statut: 'a_traiter' })}>
            <span className="chiffre">{alertes.a_traiter}</span>
            <strong>À traiter</strong>
            <span className="discret">absences et retards sans motif</span>
          </button>
          <button className={`carte ${alertes.a_notifier ? 'alerte' : ''}`} onClick={() => allerA('absences', { notifie: 'non' })}>
            <span className="chiffre">{alertes.a_notifier}</span>
            <strong>À notifier</strong>
            <span className="discret">entreprise pas encore prévenue</span>
          </button>
          {pp && pp.sans_pp.length > 0 && (
            <button className="carte alerte" onClick={() => allerA('professeurs')}>
              <span className="chiffre">{pp.sans_pp.length}</span>
              <strong>Sans professeur principal</strong>
              <span className="discret">classe(s), année {pp.annee}</span>
            </button>
          )}
        </div>
      )}

      <h2>Effectifs</h2>
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
    </>
  );
}
