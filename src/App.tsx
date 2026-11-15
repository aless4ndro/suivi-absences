import { useState } from 'react';
import Accueil from './pages/Accueil';
import Jeunes from './pages/Jeunes';
import Entreprises from './pages/Entreprises';

const PAGES = [
  { id: 'accueil', titre: 'Accueil' },
  { id: 'jeunes', titre: 'Jeunes' },
  { id: 'entreprises', titre: 'Entreprises' },
  { id: 'absences', titre: 'Absences et retards', aVenir: true },
  { id: 'rattrapages', titre: 'Rattrapages', aVenir: true },
  { id: 'calendrier', titre: 'Calendrier', aVenir: true },
  { id: 'envois', titre: 'Récapitulatifs', aVenir: true },
] as const;

type PageId = (typeof PAGES)[number]['id'];

export default function App() {
  const [page, setPage] = useState<PageId>('accueil');
  const courante = PAGES.find((p) => p.id === page)!;

  return (
    <div className="appli">
      <nav className="menu">
        <div className="marque">Suivi Absences</div>
        {PAGES.map((p) => (
          <button key={p.id} className={p.id === page ? 'actif' : ''} onClick={() => setPage(p.id)}>
            {p.titre}
            {'aVenir' in p && <span className="badge">bientôt</span>}
          </button>
        ))}
      </nav>
      <main>
        {page === 'accueil' && <Accueil allerA={(id) => setPage(id as PageId)} />}
        {page === 'jeunes' && <Jeunes />}
        {page === 'entreprises' && <Entreprises />}
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
