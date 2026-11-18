import { useEffect, useState } from 'react';
import { appeler, documents, type Assiduite, type TotauxAssiduite } from './api';
import { aujourdhui, formaterDate } from './format';
import { envelopperFlux, htmlAssiduite } from './documents';

// Année scolaire en cours : 1er septembre → 31 août.
export function anneeScolaireCourante(): { debut: string; fin: string } {
  const a = aujourdhui();
  const y = Number(a.slice(0, 4));
  const d = a.slice(5, 7) >= '09' ? y : y - 1;
  return { debut: `${d}-09-01`, fin: `${d + 1}-08-31` };
}
const hm = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
const Carte = ({ titre, t }: { titre: string; t: TotauxAssiduite }) => (
  <div className="carte-stat">
    <div className="carte-titre">{titre}</div>
    <div className="carte-grand">{t.nb}</div>
    <div className="discret">{hm(t.minutes)}</div>
    <div className="carte-detail">
      <span className="etiquette st-vert">Justifiées {t.justifiees.nb}</span>
      <span className="etiquette st-rouge">Injustifiées {t.injustifiees.nb}</span>
      {t.en_attente.nb > 0 && <span className="etiquette st-orange">En attente {t.en_attente.nb}</span>}
    </div>
  </div>
);

export default function FicheAssiduite({ jeuneId, allerA }: {
  jeuneId: number;
  allerA?: (page: string, filtre?: { jeune_id?: number; type?: '' | 'absence' | 'retard' }) => void;
}) {
  const an = anneeScolaireCourante();
  const [debut, setDebut] = useState(an.debut);
  const [fin, setFin] = useState(an.fin);
  const [d, setD] = useState<Assiduite | null>(null);
  const [erreur, setErreur] = useState('');
  const [tableau, setTableau] = useState(false);
  const [info, setInfo] = useState('');

  useEffect(() => {
    setErreur('');
    if (!debut || !fin || fin < debut) { setD(null); setErreur(debut && fin ? 'La fin est avant le début.' : ''); return; }
    appeler<Assiduite>('jeunes:assiduite', { id: jeuneId, debut, fin }).then(setD).catch((e) => setErreur((e as Error).message));
  }, [jeuneId, debut, fin]);

  async function pdf() {
    if (!d) return;
    try {
      const nom = `Assiduite_${d.jeune.nom}_${d.jeune.prenom}_${debut}_${fin}`.replace(/\s+/g, '_');
      const r = await documents<{ annule?: boolean; chemin?: string }>('pdf', { html: envelopperFlux(htmlAssiduite(d, aujourdhui())), nom });
      setInfo(r.annule ? '' : `PDF enregistré : ${r.chemin ?? ''}`);
    } catch (e) { setErreur((e as Error).message); }
  }

  return (
    <section className="bloc-assiduite">
      <h3>Absences et retards</h3>
      <div className="grille">
        <label>Du<input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} /></label>
        <label>Au<input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></label>
      </div>
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="button" onClick={() => { setDebut(an.debut); setFin(an.fin); }}>Année scolaire en cours</button>
      </div>
      {erreur && <p className="erreur">{erreur}</p>}
      {d && (
        <>
          <div className="cartes-stat">
            <Carte titre="Absences" t={d.absences} />
            <Carte titre="Retards" t={d.retards} />
            <div className="carte-stat">
              <div className="carte-titre">Heures à rattraper</div>
              <div className="carte-grand">{hm(d.rattrapage.solde)}</div>
              <div className="discret">{hm(d.rattrapage.validees)} déjà rattrapées sur {hm(d.rattrapage.dues)}</div>
            </div>
          </div>
          <div className="actions">
            <button type="button" onClick={() => allerA?.('absences', { jeune_id: jeuneId, type: 'absence' })}>Voir les absences</button>
            <button type="button" onClick={() => allerA?.('absences', { jeune_id: jeuneId, type: 'retard' })}>Voir les retards</button>
            <button type="button" onClick={() => allerA?.('rattrapages')}>Rattrapages</button>
            <button type="button" onClick={() => allerA?.('envois')}>Récapitulatifs</button>
            <button type="button" className="principal" onClick={() => { setInfo(''); setTableau(true); }}>Tableau de bord d'assiduité</button>
          </div>
          {d.evenements.length === 0 ? <p className="discret">Aucune absence ni retard sur cette période.</p> : (
            <table>
              <thead><tr><th>Date</th><th>Type</th><th>Durée</th><th>Motif</th><th>Statut</th></tr></thead>
              <tbody>
                {d.evenements.map((e) => (
                  <tr key={e.id}>
                    <td>{formaterDate(e.date_debut)}{e.date_fin && e.date_fin !== e.date_debut ? ` → ${formaterDate(e.date_fin)}` : ''}</td>
                    <td>{e.type === 'absence' ? 'Absence' : 'Retard'}</td>
                    <td>{hm(e.duree_minutes ?? 0)}</td>
                    <td>{e.motif_libelle ?? '—'}</td>
                    <td>{e.motif_statut === 'recevable' ? <span className="etiquette st-vert">Justifiée</span> : e.motif_statut === 'irrecevable' ? <span className="etiquette st-rouge">Injustifiée</span> : <span className="etiquette st-orange">En attente</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {info && <p className="succes">{info}</p>}
          {tableau && (
            <div className="voile">
              <div className="fenetre large">
                <div dangerouslySetInnerHTML={{ __html: htmlAssiduite(d, aujourdhui()).replace('src="logo-etablissement.png"', 'src="" hidden') }} className="apercu-assiduite" />
                <div className="actions">
                  <button type="button" className="principal" onClick={pdf}>Enregistrer en PDF</button>
                  <button type="button" onClick={() => setTableau(false)}>Fermer</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
