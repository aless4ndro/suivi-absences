import { useEffect, useState } from 'react';
import { appeler, type RappelsCommissions, type AlertesPP, type Cible, type FiltresEvenements, type Stats } from '../api';
import RechercheGenerale from '../RechercheGenerale';

type Alertes = { a_traiter: number; a_notifier: number };

export default function Accueil({ allerA, ouvrirFiche }: { allerA: (page: string, filtre?: FiltresEvenements) => void; ouvrirFiche: (type: Cible['type'], id: number) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [alertes, setAlertes] = useState<Alertes | null>(null);
  const [pp, setPp] = useState<AlertesPP | null>(null);
  const [com, setCom] = useState<RappelsCommissions | null>(null);
  useEffect(() => {
    appeler<AlertesPP>('pp:alertes').then(setPp);
    appeler<Stats>('stats').then(setStats);
    appeler<RappelsCommissions>('commissions:rappels').then(setCom);
    appeler<Alertes>('evenements:alertes').then(setAlertes);
  }, []);

  return (
    <>
      <h1>Accueil</h1>
      <RechercheGenerale ouvrir={ouvrirFiche} />

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

      {com && (com.a_programmer.length > 0 || com.a_convoquer.length > 0 || com.a_venir.length > 0 || com.a_realiser.length > 0) && (
        <>
          <h2>Commissions</h2>
          <div className="cartes">
            {com.a_programmer.length > 0 && <button className="carte alerte" onClick={() => allerA('commissions')}><span className="chiffre">{com.a_programmer.length}</span><strong>À programmer</strong><span className="discret">commission(s) sans date</span></button>}
            {com.a_convoquer.length > 0 && <button className="carte alerte" onClick={() => allerA('commissions')}><span className="chiffre">{com.a_convoquer.length}</span><strong>Convocations à envoyer</strong><span className="discret">dans les {com.jours} jours</span></button>}
            {com.a_venir.length > 0 && <button className="carte" onClick={() => allerA('commissions')}><span className="chiffre">{com.a_venir.length}</span><strong>À venir</strong><span className="discret">dans les {com.jours} jours</span></button>}
            {com.a_realiser.length > 0 && <button className="carte alerte" onClick={() => allerA('commissions')}><span className="chiffre">{com.a_realiser.length}</span><strong>Date passée</strong><span className="discret">à marquer réalisée ou reporter</span></button>}
          </div>
        </>
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
