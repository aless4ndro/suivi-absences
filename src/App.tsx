import { useEffect, useState } from 'react';
import { auth, miseAJour, type MiseAJour, type Cible, type Etat, type FiltresEvenements } from './api';
import Accueil from './pages/Accueil';
import Jeunes from './pages/Jeunes';
import Entreprises from './pages/Entreprises';
import Connexion from './pages/Connexion';
import Parametres from './pages/Parametres';
import Motifs from './pages/Motifs';
import Absences from './pages/Absences';
import Calendrier from './pages/Calendrier';
import Rattrapages from './pages/Rattrapages';
import Sanctions from './pages/Sanctions';
import Commissions from './pages/Commissions';
import Alertes from './pages/Alertes';
import TableauBord from './pages/TableauBord';
import MailsTypes from './pages/MailsTypes';
import ImportDonnees from './pages/ImportDonnees';
import Recapitulatifs from './pages/Recapitulatifs';
import Professeurs from './pages/Professeurs';
import ErreurPage from './ErreurPage';
import Sidebar, { titreDe, type PageId } from './Sidebar';

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

  const [maj, setMaj] = useState<MiseAJour | null>(null);
  const deverrouille = !!etat?.deverrouille;
  useEffect(() => {
    if (!deverrouille) return;
    let annule = false;
    const verifier = () => miseAJour<MiseAJour | null>('verifier').then((m) => { if (!annule) setMaj(m); }).catch(() => undefined);
    verifier();
    const t = setInterval(verifier, 6 * 60 * 60 * 1000); // puis toutes les 6 h si l'appli reste ouverte
    return () => { annule = true; clearInterval(t); };
  }, [deverrouille]);

  if (!etat) return null;
  if (!etat.deverrouille) {
    return <><div className="zone-fenetre" /><Connexion mdpDefini={etat.mdpDefini} onOk={() => { setPage('accueil'); rafraichir(); }} /></>;
  }

  return (
    <div className="appli">
      <Sidebar page={page} onNaviguer={(id) => allerA(id)} onVerrouiller={() => auth('verrouiller').then(rafraichir)} maj={maj} />
      <div className="colonne">
        <header className="barre-haut">
          <span className="barre-titre">{titreDe(page)}</span>
        </header>
        <main>
        <ErreurPage key={page}>
        {page === 'accueil' && <Accueil allerA={allerA} ouvrirFiche={ouvrirFiche} />
        }
        {page === 'absences' && <Absences key={JSON.stringify(filtreAbsences ?? {})} filtreInitial={filtreAbsences} />}
        {page === 'jeunes' && <Jeunes cible={cible?.type === 'apprenti' ? cible.id : null} apresCible={() => setCible(null)} allerA={allerA} ouvrirFiche={ouvrirFiche} />}
        {page === 'entreprises' && <Entreprises cible={cible?.type === 'entreprise' ? cible.id : null} apresCible={() => setCible(null)} ouvrirFiche={ouvrirFiche} />}
        {page === 'import' && <ImportDonnees />}
        {page === 'professeurs' && <Professeurs />}
        {page === 'motifs' && <Motifs />}
        {page === 'calendrier' && <Calendrier />}
        {page === 'rattrapages' && <Rattrapages />}
        {page === 'sanctions' && <Sanctions ouvrirFiche={ouvrirFiche} />}
        {page === 'mails' && <MailsTypes />}
        {page === 'discipline' && <TableauBord ouvrirFiche={ouvrirFiche} allerA={allerA} />}
        {page === 'alertes' && <Alertes ouvrirFiche={ouvrirFiche} allerA={allerA} />}
        {page === 'commissions' && <Commissions />}
        {page === 'envois' && <Recapitulatifs />}
        {page === 'parametres' && <Parametres apresRestauration={rafraichir} />}
        </ErreurPage>
        </main>
        <footer className="pied"><span>Développé par</span><img src="./ikelli-systeme.png" alt="Ikelli Systeme" /></footer>
      </div>
    </div>
  );
}
