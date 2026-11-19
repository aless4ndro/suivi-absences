import { useEffect, useState, type FormEvent } from 'react';
import { appeler, NOMS_COMMUNICATION, NOMS_DECISION, type Communication, type Jeune, type MotifSanction, type Palier, type Sanction } from '../api';
import SanctionForm from '../SanctionForm';
import { correspond } from '../recherche';
import { formaterDate } from '../format';

const VIDE_MOTIF: MotifSanction = { intitule: '', description: '', categorie: '', palier_id: 0, actif: 1, commentaire: '', communication: null };

export default function Sanctions({ ouvrirFiche }: { ouvrirFiche?: (type: 'apprenti' | 'entreprise', id: number) => void }) {
  const [onglet, setOnglet] = useState<'sanctions' | 'motifs'>('sanctions');
  const [liste, setListe] = useState<Sanction[]>([]);
  const [apprentis, setApprentis] = useState<Jeune[]>([]);
  const [paliers, setPaliers] = useState<Palier[]>([]);
  const [motifs, setMotifs] = useState<MotifSanction[]>([]);
  const [recherche, setRecherche] = useState('');
  const [statut, setStatut] = useState<'' | 'ouverte' | 'cloturee'>('');
  const [decision, setDecision] = useState('');
  const [palierFiltre, setPalierFiltre] = useState('');
  const [ouverte, setOuverte] = useState<{ id: number | null } | null>(null);
  const [motif, setMotif] = useState<MotifSanction | null>(null);
  const [palier, setPalier] = useState<Palier | null>(null);
  const [mois, setMois] = useState(12);
  const [erreur, setErreur] = useState('');
  const [info, setInfo] = useState('');

  const charger = () => {
    appeler<Sanction[]>('sanctions:list', { statut: statut || undefined, decision: decision || undefined, palier_id: palierFiltre ? Number(palierFiltre) : undefined }).then(setListe);
  };
  const chargerParametrage = () => {
    appeler<Palier[]>('paliers:list').then(setPaliers);
    appeler<MotifSanction[]>('sanctions:motifs').then(setMotifs);
  };
  useEffect(() => {
    appeler<Jeune[]>('jeunes:list', { tous: true }).then(setApprentis);
    appeler<{ historique_mois: number }>('discipline:reglages').then((r) => setMois(r.historique_mois));
    chargerParametrage();
  }, []);
  useEffect(charger, [statut, decision, palierFiltre]);

  const visibles = liste.filter((s) => correspond(recherche, s.jeune_nom, s.jeune_prenom, `${s.jeune_prenom} ${s.jeune_nom}`, s.motif_intitule, s.classe_code));

  async function enregistrerMotif(e: FormEvent) {
    e.preventDefault();
    try { await appeler('sanctions:motif:save', motif); setMotif(null); setErreur(''); chargerParametrage(); } catch (err) { setErreur((err as Error).message); }
  }
  async function supprimerMotif(m: MotifSanction) {
    if (!confirm(`Supprimer le motif « ${m.intitule} » ?`)) return;
    try { await appeler('sanctions:motif:delete', m.id); setErreur(''); chargerParametrage(); } catch (err) { setErreur((err as Error).message); }
  }
  async function enregistrerPalier(e: FormEvent) {
    e.preventDefault();
    try { await appeler('paliers:save', palier); setPalier(null); setErreur(''); chargerParametrage(); } catch (err) { setErreur((err as Error).message); }
  }
  async function enregistrerMois() {
    setInfo(''); setErreur('');
    try { await appeler('discipline:reglages:save', { historique_mois: mois }); setInfo("Durée de prise en compte de l'historique enregistrée."); } catch (err) { setErreur((err as Error).message); }
  }

  return (
    <>
      <div className="entete">
        <h1>Sanctions</h1>
        {onglet === 'sanctions' && <button className="principal" onClick={() => setOuverte({ id: null })}>Ajouter une sanction</button>}
      </div>
      <div className="onglets">
        <button className={onglet === 'sanctions' ? 'actif' : ''} onClick={() => setOnglet('sanctions')}>Dossiers disciplinaires</button>
        <button className={onglet === 'motifs' ? 'actif' : ''} onClick={() => setOnglet('motifs')}>Motifs et paliers</button>
      </div>

      {onglet === 'sanctions' && (
        <>
          <p className="discret">L'application propose un palier d'après l'historique de l'apprenti, mais ne prononce jamais de sanction : la décision est toujours la vôtre.</p>
          <div className="filtres">
            <div className="champ-recherche">
              <input type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Apprenti, classe ou motif" />
              {recherche && <button type="button" className="effacer" onClick={() => setRecherche('')} aria-label="Effacer la recherche">✕</button>}
            </div>
            <select value={statut} onChange={(e) => setStatut(e.target.value as '' | 'ouverte' | 'cloturee')}>
              <option value="">Tous les dossiers</option><option value="ouverte">Ouverts</option><option value="cloturee">Clôturés</option>
            </select>
            <select value={decision} onChange={(e) => setDecision(e.target.value)}>
              <option value="">Toutes les décisions</option>
              {Object.entries(NOMS_DECISION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={palierFiltre} onChange={(e) => setPalierFiltre(e.target.value)}>
              <option value="">Tous les paliers</option>
              {paliers.map((p) => <option key={p.id} value={p.id}>{p.ordre} — {p.libelle}</option>)}
            </select>
          </div>
          {visibles.length === 0 ? <p className="discret">Aucun dossier disciplinaire.</p> : (
            <table>
              <thead><tr><th>Faits du</th><th>Apprenti</th><th>Motif</th><th>Proposé</th><th>Décision</th><th></th></tr></thead>
              <tbody>
                {visibles.map((s) => (
                  <tr key={s.id} className="clic" onClick={() => setOuverte({ id: s.id! })}>
                    <td>{formaterDate(s.date_faits)}</td>
                    <td><strong>{s.jeune_nom?.toUpperCase()}</strong> {s.jeune_prenom}<div className="discret">{s.classe_code}</div></td>
                    <td>{s.motif_intitule}</td>
                    <td>{s.palier_propose_ordre ? `${s.palier_propose_ordre} — ${s.palier_propose_libelle}` : '—'}</td>
                    <td>
                      {s.decision === 'sanction' ? <strong>{s.palier_retenu_libelle}</strong> : NOMS_DECISION[s.decision]}
                      {s.decision === 'en_attente' && <span className="etiquette st-orange">à décider</span>}
                      {s.communication_manquante && <span className="etiquette st-rouge">employeur à informer</span>}
                      {s.statut === 'cloturee' && <span className="etiquette">clôturé</span>}
                    </td>
                    <td className="droite" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => ouvrirFiche?.('apprenti', s.jeune_id)}>Fiche apprenti</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {onglet === 'motifs' && (
        <>
          {info && <p className="succes">{info}</p>}
          {erreur && !motif && !palier && <p className="erreur">{erreur}</p>}
          <section className="fiche">
            <h2>Paliers de la grille</h2>
            <p className="discret">
              La grille est une proposition d'organisation : vérifiez les sanctions applicables avec le règlement intérieur et le statut de l'apprenti
              (mesures pédagogiques, rappel à l'ordre et sanctions formelles sont à distinguer). Pour chaque palier, choisissez si l'employeur doit être informé.
            </p>
            <table>
              <thead><tr><th>Palier</th><th>Sanction</th><th>Communication à l'employeur</th><th></th></tr></thead>
              <tbody>
                {paliers.map((p) => (
                  <tr key={p.id}>
                    <td>{p.ordre}</td>
                    <td>{p.libelle}{!p.actif && <span className="etiquette">inactif</span>}</td>
                    <td>{NOMS_COMMUNICATION[p.communication]}</td>
                    <td className="droite"><button onClick={() => { setPalier({ ...p }); setErreur(''); }}>Modifier</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="actions"><button onClick={() => { setPalier({ libelle: '', communication: 'facultative', actif: 1 }); setErreur(''); }}>Ajouter un palier</button></div>
            {palier && (
              <form className="fiche" onSubmit={enregistrerPalier}>
                <h3>{palier.id ? `Palier ${palier.ordre}` : 'Nouveau palier (ajouté en dernier)'}</h3>
                <div className="grille">
                  <label>Sanction *<input required autoFocus value={palier.libelle} onChange={(e) => setPalier({ ...palier, libelle: e.target.value })} /></label>
                  <label>Communication à l'employeur
                    <select value={palier.communication} onChange={(e) => setPalier({ ...palier, communication: e.target.value as Communication })}>
                      {Object.entries(NOMS_COMMUNICATION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                </div>
                <label className="case"><input type="checkbox" checked={!!palier.actif} onChange={(e) => setPalier({ ...palier, actif: e.target.checked ? 1 : 0 })} /> Palier actif</label>
                {erreur && <p className="erreur">{erreur}</p>}
                <div className="actions"><button type="submit" className="principal">Enregistrer</button><button type="button" onClick={() => setPalier(null)}>Annuler</button></div>
              </form>
            )}
          </section>

          <section className="fiche">
            <h2>Prise en compte de l'historique</h2>
            <p className="discret">Seules les sanctions prononcées sur cette durée comptent pour proposer un palier ; les plus anciennes restent consultables.</p>
            <div className="grille">
              <label>Durée (en mois)<input type="number" min={1} max={120} value={mois} onChange={(e) => setMois(Number(e.target.value))} /></label>
            </div>
            <div className="actions"><button onClick={enregistrerMois}>Enregistrer la durée</button></div>
          </section>

          <div className="entete">
            <h2>Motifs de sanction</h2>
            <button className="principal" onClick={() => { setMotif({ ...VIDE_MOTIF, palier_id: paliers[0]?.id ?? 0 }); setErreur(''); }}>Ajouter un motif</button>
          </div>
          {motif && (
            <form className="fiche" onSubmit={enregistrerMotif}>
              <h3>{motif.id ? 'Modifier le motif' : 'Nouveau motif'}</h3>
              <div className="grille">
                <label>Intitulé *<input required autoFocus value={motif.intitule} onChange={(e) => setMotif({ ...motif, intitule: e.target.value })} /></label>
                <label>Catégorie<input value={motif.categorie ?? ''} placeholder="ex. Assiduité, Comportement" onChange={(e) => setMotif({ ...motif, categorie: e.target.value })} /></label>
                <label>Palier associé *
                  <select value={motif.palier_id} onChange={(e) => setMotif({ ...motif, palier_id: Number(e.target.value) })}>
                    {paliers.map((p) => <option key={p.id} value={p.id}>{p.ordre} — {p.libelle}</option>)}
                  </select>
                </label>
                <label>Communication à l'employeur
                  <select value={motif.communication ?? ''} onChange={(e) => setMotif({ ...motif, communication: (e.target.value || null) as Communication | null })}>
                    <option value="">Selon le palier</option>
                    {Object.entries(NOMS_COMMUNICATION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              </div>
              <label>Description du manquement<textarea rows={2} value={motif.description ?? ''} onChange={(e) => setMotif({ ...motif, description: e.target.value })} /></label>
              <label>Commentaire<input value={motif.commentaire ?? ''} onChange={(e) => setMotif({ ...motif, commentaire: e.target.value })} /></label>
              <label className="case"><input type="checkbox" checked={!!motif.actif} onChange={(e) => setMotif({ ...motif, actif: e.target.checked ? 1 : 0 })} /> Motif actif</label>
              {erreur && <p className="erreur">{erreur}</p>}
              <div className="actions"><button type="submit" className="principal">Enregistrer</button><button type="button" onClick={() => setMotif(null)}>Annuler</button></div>
            </form>
          )}
          <table>
            <thead><tr><th>Motif</th><th>Catégorie</th><th>Palier</th><th>Utilisé</th><th></th></tr></thead>
            <tbody>
              {motifs.map((m) => (
                <tr key={m.id}>
                  <td>{m.intitule}{!m.actif && <span className="etiquette">inactif</span>}{m.description && <div className="discret">{m.description}</div>}</td>
                  <td>{m.categorie}</td>
                  <td>{m.palier_ordre} — {m.palier_libelle}</td>
                  <td>{m.nb_utilisations}</td>
                  <td className="droite">
                    <button onClick={() => { setMotif({ ...m }); setErreur(''); }}>Modifier</button>
                    <button className="danger" onClick={() => supprimerMotif(m)}>Supprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {ouverte && (
        <SanctionForm sanctionId={ouverte.id} apprentis={apprentis} onClose={() => setOuverte(null)} onChange={charger}
          ouvrirApprenti={ouvrirFiche ? (id) => ouvrirFiche('apprenti', id) : undefined} />
      )}
    </>
  );
}
