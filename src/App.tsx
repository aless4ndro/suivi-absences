import { useEffect, useState } from 'react';
import { auth, type Cible, type Etat, type FiltresEvenements } from './api';
import Accueil from './pages/Accueil';
import Jeunes from './pages/Jeunes';
import Entreprises from './pages/Entreprises';
import Connexion from './pages/Connexion';
import Parametres from './pages/Parametres';
import Motifs from './pages/Motifs';
import Absences from './pages/Absences';
import Calendrier from './pages/Calendrier';
import Rattrapages from './pages/Rattrapages';
import Recapitulatifs from './pages/Recapitulatifs';
import Professeurs from './pages/Professeurs';

const PAGES = [
  { id: 'accueil', titre: 'Accueil' },
  { id: 'absences', titre: 'Absences et retards' },
  { id: 'jeunes', titre: 'Apprentis' },
  { id: 'entreprises', titre: 'Entreprises' },
  { id: 'professeurs', titre: 'Professeurs principaux' },
  { id: 'motifs', titre: 'Motifs' },
  { id: 'rattrapages', titre: 'Rattrapages' },
  { id: 'calendrier', titre: 'Calendrier' },
  { id: 'envois', titre: 'Récapitulatifs' },
  { id: 'parametres', titre: 'Paramètres' },
] as const;

type PageId = (typeof PAGES)[number]['id'];

export default function App() {
  const [page, setPage] = useState<PageId>('accueil');
  const [etat, setEtat] = useState<Etat | null>(null);
  const [cible, setCible] = useState<Cible | null>(null);
  const [filtreAbsences, setFiltreAbsences] = useState<FiltresEvenements | undefined>();
  const allerA = (id: string, filtre?: FiltresEvenements) => {
    setFiltreAbsences(filtre);
    setPage(id as PageId);
  };
  const ouvrirFiche = (type: Cible['type'], id: number) => {
    setCible({ type, id });
    setPage(type === 'apprenti' ? 'jeunes' : 'entreprises');
  };
  const rafraichir = () => auth<Etat>('etat').then(setEtat);
  useEffect(() => {
    rafraichir();
  }, []);

  if (!etat) return null;
  if (!etat.deverrouille) {
    return <Connexion mdpDefini={etat.mdpDefini} onOk={() => { setPage('accueil'); rafraichir(); }} />;
  }

  const courante = PAGES.find((p) => p.id === page)!;

  return (
    <div className="appli">
      <nav className="menu">
        <div className="marque"><img src="./logo.png" alt="" />Suivi Absences</div>
        {PAGES.map((p) => (
          <button key={p.id} className={p.id === page ? 'actif' : ''} onClick={() => allerA(p.id)}>
            {p.titre}
            {'aVenir' in p && <span className="badge">bientôt</span>}
          </button>
        ))}
        <button className="bas" onClick={() => auth('verrouiller').then(rafraichir)}>Verrouiller</button>
      </nav>
      <main>
        {page === 'accueil' && <Accueil allerA={allerA} ouvrirFiche={ouvrirFiche} />
        }
        {page === 'absences' && <Absences key={JSON.stringify(filtreAbsences ?? {})} filtreInitial={filtreAbsences} />}
        {page === 'jeunes' && <Jeunes cible={cible?.type === 'apprenti' ? cible.id : null} apresCible={() => setCible(null)} allerA={allerA} ouvrirFiche={ouvrirFiche} />}
        {page === 'entreprises' && <Entreprises cible={cible?.type === 'entreprise' ? cible.id : null} apresCible={() => setCible(null)} ouvrirFiche={ouvrirFiche} />}
        {page === 'professeurs' && <Professeurs />}
        {page === 'motifs' && <Motifs />}
        {page === 'calendrier' && <Calendrier />}
        {page === 'rattrapages' && <Rattrapages />}
        {page === 'envois' && <Recapitulatifs />}
        {page === 'parametres' && <Parametres apresRestauration={rafraichir} />}
        {'aVenir' in courante && (
          <>
            <h1>{courante.titre}</h1>
            <p className="discret">Cette partie arrive dans une prochaine version.</p>
          </>
        )}
      </main>
    </div>
  );
}
