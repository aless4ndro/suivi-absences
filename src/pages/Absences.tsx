import { useEffect, useState, type FormEvent } from 'react';
import {
  appeler, fichiers,
  type Classe, type Evenement, type FiltresEvenements, type Jeune, type Motif, type Piece, type PieceChoisie,
} from '../api';
import { aujourdhui, formaterDate, formaterDuree, formaterTaille } from '../format';

type Fiche = {
  id?: number;
  jeune_id: number;
  type: 'absence' | 'retard';
  date_debut: string;
  date_fin: string;
  heures: number;
  minutes: number;
  motif_id: number | null;
  observations: string;
  mail_copie: string;
};

export default function Absences({ filtreInitial }: { filtreInitial?: FiltresEvenements }) {
  const [classes, setClasses] = useState<Classe[]>([]);
  const [apprentis, setApprentis] = useState<Jeune[]>([]);
  const [motifs, setMotifs] = useState<Motif[]>([]);
  const [liste, setListe] = useState<Evenement[]>([]);
  const [filtres, setFiltres] = useState<FiltresEvenements>(filtreInitial ?? {});
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [existantes, setExistantes] = useState<Piece[]>([]);
  const [nouvelles, setNouvelles] = useState<PieceChoisie[]>([]);
  const [erreur, setErreur] = useState('');
  const [info, setInfo] = useState('');

  const charger = () => appeler<Evenement[]>('evenements:list', filtres).then(setListe);
  useEffect(() => {
    appeler<Classe[]>('classes:list').then(setClasses);
    appeler<Jeune[]>('jeunes:list').then(setApprentis);
    appeler<Motif[]>('motifs:list').then(setMotifs);
  }, []);
  useEffect(() => {
    charger();
  }, [filtres]);

  const motifDe = (id: number | null) => motifs.find((m) => m.id === id);
  const filtrer = (cle: keyof FiltresEvenements, valeur: string) =>
    setFiltres((f) => {
      const suite: Record<string, unknown> = { ...f, [cle]: valeur === '' ? undefined : cle.endsWith('_id') ? Number(valeur) : valeur };
      if (cle === 'classe_id') delete suite.jeune_id; // l'apprenti choisi n'est peut-être pas dans cette classe
      return suite as FiltresEvenements;
    });
  const nbFiltres = Object.values(filtres).filter(Boolean).length;
  const apprentisFiltre = filtres.classe_id ? apprentis.filter((a) => a.classe_id === filtres.classe_id) : apprentis;

  function nouveau() {
    setErreur(''); setInfo(''); setExistantes([]); setNouvelles([]);
    setFiche({
      jeune_id: filtres.jeune_id ?? 0, type: 'absence', date_debut: aujourdhui(), date_fin: aujourdhui(),
      heures: 0, minutes: 0, motif_id: null, observations: '', mail_copie: '',
    });
  }

  async function modifier(e: Evenement) {
    setErreur(''); setInfo(''); setNouvelles([]);
    setExistantes(await appeler<Piece[]>('pieces:list', e.id));
    setFiche({
      id: e.id, jeune_id: e.jeune_id, type: e.type, date_debut: e.date_debut, date_fin: e.date_fin ?? e.date_debut,
      heures: Math.floor(e.duree_minutes / 60), minutes: e.duree_minutes % 60, motif_id: e.motif_id,
      observations: e.observations ?? '', mail_copie: e.mail_copie ?? '',
    });
  }

  async function choisirPieces() {
    try {
      const r = await fichiers<{ pieces: PieceChoisie[]; refusees: string[] }>('choisirPieces');
      setNouvelles((n) => [...n, ...r.pieces]);
      setErreur(r.refusees.length ? `Fichier(s) refusé(s) : ${r.refusees.join(', ')}` : '');
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  async function supprimerPiece(p: Piece) {
    if (!confirm(`Supprimer la pièce jointe « ${p.nom_fichier} » ?`)) return;
    await appeler('pieces:supprimer', p.id);
    setExistantes((l) => l.filter((x) => x.id !== p.id));
    charger();
  }

  async function enregistrer(ev: FormEvent) {
    ev.preventDefault();
    if (!fiche) return;
    try {
      const id = await appeler<number>('evenements:save', {
        id: fiche.id, jeune_id: fiche.jeune_id, type: fiche.type, date_debut: fiche.date_debut,
        date_fin: fiche.type === 'absence' ? fiche.date_fin : null,
        duree_minutes: Math.round(fiche.heures) * 60 + Math.round(fiche.minutes),
        motif_id: fiche.motif_id, observations: fiche.observations, mail_copie: fiche.mail_copie,
      });
      let message = '';
      if (nouvelles.length) {
        const r = await fichiers<{ ajoutees: number; erreurs: string[] }>('ajouterPieces', {
          evenement_id: id, tokens: nouvelles.map((n) => n.token),
        });
        if (r.erreurs.length) message = `Enregistré, mais des pièces jointes n'ont pas pu être ajoutées : ${r.erreurs.join(' ; ')}`;
      }
      setFiche(null); setErreur(''); setInfo(message);
      charger();
    } catch (err) {
      setErreur((err as Error).message);
    }
  }

  async function supprimer(e: Evenement) {
    const pj = e.nb_pieces ? ` Ses ${e.nb_pieces} pièce(s) jointe(s) seront aussi supprimées.` : '';
    if (!confirm(`Supprimer ${e.type === 'absence' ? "l'absence" : 'le retard'} de ${e.jeune_prenom} ${e.jeune_nom} du ${formaterDate(e.date_debut)} ?${pj}`)) return;
    await appeler('evenements:delete', e.id);
    charger();
  }

  async function basculerNotifie(e: Evenement) {
    await appeler('evenements:notifier', { ids: [e.id], notifie: !e.notifie_le });
    charger();
  }

  const statutMotif = fiche ? motifDe(fiche.motif_id)?.statut : undefined;

  return (
    <>
      <div className="entete">
        <h1>Absences et retards</h1>
        <button className="principal" onClick={nouveau}>Ajouter</button>
      </div>

      <div className="filtres">
        <select value={filtres.classe_id ?? ''} onChange={(e) => filtrer('classe_id', e.target.value)}>
          <option value="">Toutes les classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
        </select>
        <select value={filtres.jeune_id ?? ''} onChange={(e) => filtrer('jeune_id', e.target.value)}>
          <option value="">Tous les apprentis</option>
          {apprentisFiltre.map((a) => <option key={a.id} value={a.id}>{a.nom} {a.prenom}</option>)}
        </select>
        <input type="month" value={filtres.mois ?? ''} onChange={(e) => filtrer('mois', e.target.value)} title="Mois" />
        <select value={filtres.type ?? ''} onChange={(e) => filtrer('type', e.target.value)}>
          <option value="">Absences et retards</option>
          <option value="absence">Absences</option>
          <option value="retard">Retards</option>
        </select>
        <select value={filtres.statut ?? ''} onChange={(e) => filtrer('statut', e.target.value)}>
          <option value="">Tous les statuts</option>
          <option value="a_traiter">À traiter (sans motif)</option>
          <option value="recevable">Recevables</option>
          <option value="irrecevable">Irrecevables</option>
        </select>
        <select value={filtres.notifie ?? ''} onChange={(e) => filtrer('notifie', e.target.value)}>
          <option value="">Notification : toutes</option>
          <option value="non">Entreprise non notifiée</option>
          <option value="oui">Entreprise notifiée</option>
        </select>
        {nbFiltres > 0 && <button onClick={() => setFiltres({})}>Effacer les filtres</button>}
      </div>

      {info && <p className="erreur">{info}</p>}

      {fiche && (
        <form className="fiche" onSubmit={enregistrer}>
          <h2>{fiche.id ? 'Modifier' : 'Nouvelle absence ou nouveau retard'}</h2>
          {apprentis.length === 0 && <p className="erreur">Ajoutez d'abord un apprenti dans la section Apprentis.</p>}
          <div className="grille">
            <label>Apprenti *
              <select required value={fiche.jeune_id || ''} onChange={(e) => setFiche({ ...fiche, jeune_id: Number(e.target.value) })}>
                <option value="" disabled>Choisir…</option>
                {classes.map((c) => (
                  <optgroup key={c.id} label={c.code}>
                    {apprentis.filter((a) => a.classe_id === c.id).map((a) => <option key={a.id} value={a.id}>{a.nom} {a.prenom}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>Type *
              <select value={fiche.type} onChange={(e) => setFiche({ ...fiche, type: e.target.value as Fiche['type'] })}>
                <option value="absence">Absence</option>
                <option value="retard">Retard</option>
              </select>
            </label>
            <label>{fiche.type === 'absence' ? 'Du *' : 'Date *'}
              <input type="date" required value={fiche.date_debut}
                onChange={(e) => setFiche({ ...fiche, date_debut: e.target.value, date_fin: fiche.date_fin < e.target.value ? e.target.value : fiche.date_fin })} />
            </label>
            {fiche.type === 'absence' ? (
              <label>Au (inclus) *
                <input type="date" required min={fiche.date_debut} value={fiche.date_fin} onChange={(e) => setFiche({ ...fiche, date_fin: e.target.value })} />
              </label>
            ) : <span />}
            <label>{fiche.type === 'absence' ? "Durée totale d'absence *" : 'Durée du retard *'}
              <span className="duree">
                <input type="number" min={0} max={999} value={fiche.heures} onChange={(e) => setFiche({ ...fiche, heures: Number(e.target.value) })} /> h
                <input type="number" min={0} max={59} value={fiche.minutes} onChange={(e) => setFiche({ ...fiche, minutes: Number(e.target.value) })} /> min
              </span>
            </label>
            <label>Motif
              <select value={fiche.motif_id ?? ''} onChange={(e) => setFiche({ ...fiche, motif_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Pas encore connu (à traiter)</option>
                {motifs.map((m) => <option key={m.id} value={m.id}>{m.libelle} — {m.statut === 'recevable' ? 'recevable' : 'irrecevable'}</option>)}
              </select>
              {statutMotif && <span className={`etiquette ${statutMotif}`} style={{ alignSelf: 'flex-start' }}>{statutMotif === 'recevable' ? 'Recevable' : 'Irrecevable'}</span>}
            </label>
          </div>
          <div className="grille" style={{ marginTop: 12 }}>
            <label>Observations
              <textarea rows={3} value={fiche.observations} onChange={(e) => setFiche({ ...fiche, observations: e.target.value })} />
            </label>
            <label>Mail reçu (à coller)
              <textarea rows={3} value={fiche.mail_copie} onChange={(e) => setFiche({ ...fiche, mail_copie: e.target.value })} />
            </label>
          </div>

          <h3>Pièces jointes</h3>
          <ul className="pieces">
            {existantes.map((p) => (
              <li key={p.id}>
                <span>{p.nom_fichier} <span className="discret">({formaterTaille(p.taille)})</span></span>
                <span>
                  <button type="button" onClick={() => fichiers('ouvrirPiece', { id: p.id }).catch((e) => setErreur(e.message))}>Ouvrir</button>
                  <button type="button" className="danger" onClick={() => supprimerPiece(p)}>Supprimer</button>
                </span>
              </li>
            ))}
            {nouvelles.map((p) => (
              <li key={p.token}>
                <span>{p.nom} <span className="discret">({formaterTaille(p.taille)}) — sera ajoutée à l'enregistrement</span></span>
                <button type="button" onClick={() => setNouvelles((l) => l.filter((x) => x.token !== p.token))}>Retirer</button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={choisirPieces}>Ajouter une pièce jointe</button>

          {erreur && <p className="erreur">{erreur}</p>}
          <div className="actions">
            <button type="submit" className="principal">Enregistrer</button>
            <button type="button" onClick={() => setFiche(null)}>Annuler</button>
          </div>
        </form>
      )}

      {liste.length === 0 ? (
        <p className="discret">{nbFiltres ? 'Aucun résultat avec ces filtres.' : 'Aucune absence ni aucun retard enregistré pour le moment.'}</p>
      ) : (
        <table>
          <thead>
            <tr><th>Date</th><th>Apprenti</th><th>Durée</th><th>Motif</th><th>Entreprise notifiée</th><th></th></tr>
          </thead>
          <tbody>
            {liste.map((e) => (
              <tr key={e.id}>
                <td>
                  {formaterDate(e.date_debut)}{e.date_fin && e.date_fin !== e.date_debut && <> → {formaterDate(e.date_fin)}</>}
                  <div className="discret">{e.type === 'absence' ? 'Absence' : 'Retard'}</div>
                </td>
                <td>
                  <strong>{e.jeune_nom} {e.jeune_prenom}</strong> <span className="discret">{e.classe_code}</span>
                  <div className="discret">{e.entreprise_nom ?? 'aucune entreprise rattachée'}</div>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{formaterDuree(e.duree_minutes)}</td>
                <td>
                  {e.motif_statut ? (
                    <>
                      {e.motif_libelle} <span className={`etiquette ${e.motif_statut}`}>{e.motif_statut === 'recevable' ? 'Recevable' : 'Irrecevable'}</span>
                    </>
                  ) : <span className="etiquette atraiter">À traiter</span>}
                  {e.nb_pieces > 0 && <div className="discret">{e.nb_pieces} pièce(s) jointe(s)</div>}
                </td>
                <td>
                  {e.notifie_le ? <>✓ le {formaterDate(e.notifie_le.slice(0, 10))}</> : <span className="discret">non</span>}
                  <div><button className="petit" onClick={() => basculerNotifie(e)}>{e.notifie_le ? 'Retirer' : 'Marquer comme notifiée'}</button></div>
                </td>
                <td className="droite">
                  <button onClick={() => modifier(e)}>Modifier</button>
                  <button className="danger" onClick={() => supprimer(e)}>Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
