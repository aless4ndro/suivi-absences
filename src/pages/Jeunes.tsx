import { useEffect, useState, type FormEvent } from 'react';
import { appeler, MOTIFS_SORTIE, type Classe, type Contact, type Entreprise, type Jeune, type LigneClasse, type LigneContrat } from '../api';
import Bascule from './Bascule';
import { aujourdhui, formaterDate } from '../format';

const ORIGINE = '2000-01-01';
const normaliser = (v?: string | null) => (v ?? '').trim();

export default function Jeunes() {
  const [classes, setClasses] = useState<Classe[]>([]);
  const [entreprises, setEntreprises] = useState<Entreprise[]>([]);
  const [liste, setListe] = useState<Jeune[]>([]);
  const [filtre, setFiltre] = useState<number | 'toutes'>('toutes');
  const [fiche, setFiche] = useState<Jeune | null>(null);
  const [erreur, setErreur] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [historique, setHistorique] = useState<LigneClasse[]>([]);
  const [classeInitiale, setClasseInitiale] = useState<number | null>(null);
  const [bascule, setBascule] = useState(false);
  const [voirSortis, setVoirSortis] = useState(false);
  const [contrats, setContrats] = useState<LigneContrat[]>([]);
  const [contratInitial, setContratInitial] = useState<{ e: number | null; n: string; t: string; m: string } | null>(null);
  const [sortie, setSortie] = useState<{ date: string; motif: string } | null>(null);
  const [info, setInfo] = useState('');
  const entrepriseId = fiche?.entreprise_id ?? null;
  const entrepriseChoisie = entreprises.find((e) => e.id === entrepriseId);
  useEffect(() => {
    if (entrepriseId) appeler<Contact[]>('contacts:list', entrepriseId).then(setContacts);
    else setContacts([]);
  }, [entrepriseId]);

  const charger = () => appeler<Jeune[]>('jeunes:list', { tous: true }).then(setListe);
  useEffect(() => {
    appeler<Classe[]>('classes:list').then(setClasses);
    appeler<Entreprise[]>('entreprises:list').then(setEntreprises);
    charger();
  }, []);

  const enFormation = liste.filter((j) => !j.sorti);
  const nbSortis = liste.length - enFormation.length;
  const base = voirSortis ? liste : enFormation;
  const visibles = filtre === 'toutes' ? base : base.filter((j) => j.classe_id === filtre);

  function ouvrirFiche(j: Jeune) {
    setErreur(''); setInfo('');
    setFiche({ ...j, classe_depuis: aujourdhui(), classe_correction: false });
    setClasseInitiale(j.classe_id);
    setSortie(null);
    setContratInitial({ e: j.entreprise_id, n: normaliser(j.maitre_nom), t: normaliser(j.maitre_telephone), m: normaliser(j.maitre_email) });
    appeler<LigneClasse[]>('jeunes:classes', j.id).then(setHistorique);
    appeler<LigneContrat[]>('jeunes:contrats', j.id).then(setContrats);
  }

  async function recharger(id: number) {
    const maj = await appeler<Jeune[]>('jeunes:list', { tous: true });
    setListe(maj);
    const j = maj.find((x) => x.id === id);
    if (j) ouvrirFiche(j);
  }
  async function enregistrerSortie() {
    if (!fiche?.id || !sortie) return;
    try { await appeler('jeunes:sortir', { id: fiche.id, ...sortie }); setErreur(''); await recharger(fiche.id); }
    catch (err) { setErreur((err as Error).message); }
  }
  async function reintegrer() {
    if (!fiche?.id) return;
    await appeler('jeunes:reintegrer', fiche.id);
    await recharger(fiche.id);
  }
  async function annulerContrat(l: LigneContrat) {
    if (!confirm(`Retirer « ${l.entreprise_nom ?? 'sans entreprise'} à partir du ${formaterDate(l.date_debut)} » de l'historique ?\nÀ faire seulement pour une erreur ou un changement prévu qui n'aura pas lieu.`)) return;
    try { await appeler('jeunes:contrat:supprimer', l.id); if (fiche?.id) await recharger(fiche.id); } catch (err) { setErreur((err as Error).message); }
  }
  const contratChange = !!fiche?.id && !!contratInitial && (
    (fiche.entreprise_id ?? null) !== contratInitial.e || normaliser(fiche.maitre_nom) !== contratInitial.n
    || normaliser(fiche.maitre_telephone) !== contratInitial.t || normaliser(fiche.maitre_email) !== contratInitial.m);

  async function annulerLigne(l: LigneClasse) {
    if (!confirm(`Retirer « ${l.classe_code} à partir du ${formaterDate(l.date_debut)} » de l'historique ?\nÀ faire seulement pour une erreur ou un passage prévu qui n'aura pas lieu.`)) return;
    try {
      await appeler('jeunes:classe:supprimer', l.id);
      if (fiche?.id) appeler<LigneClasse[]>('jeunes:classes', fiche.id).then(setHistorique);
      const maj = (await appeler<Jeune[]>('jeunes:list', { tous: true }));
      setListe(maj);
      const j = maj.find((x) => x.id === fiche?.id);
      if (j && fiche) { setFiche({ ...fiche, classe_id: j.classe_id }); setClasseInitiale(j.classe_id); }
    } catch (err) { setErreur((err as Error).message); }
  }

  function nouveau() {
    setErreur(''); setInfo(''); setHistorique([]); setClasseInitiale(null); setContrats([]); setContratInitial(null); setSortie(null);
    setFiche({
      nom: '', prenom: '', email: '', telephone: '',
      classe_id: filtre === 'toutes' ? classes[0]?.id ?? 0 : filtre,
      entreprise_id: null, maitre_nom: '', maitre_telephone: '', maitre_email: '',
      civilite: '', adresse: '', code_postal: '', ville: '',
    });
  }

  const champ = (cle: keyof Jeune) => ({
    value: (fiche?.[cle] as string | null) ?? '',
    onChange: (e: { target: { value: string } }) => setFiche({ ...fiche!, [cle]: e.target.value }),
  });

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    try {
      if (fiche?.id && classeInitiale !== fiche.classe_id && !fiche.classe_correction && !fiche.classe_depuis) {
        setErreur('Indiquez la date du changement de classe.'); return;
      }
      if (contratChange && !fiche?.contrat_correction && !fiche?.contrat_depuis) {
        setErreur("Indiquez la date du changement d'entreprise ou de maître d'apprentissage."); return;
      }
      await appeler('jeunes:save', fiche);
      setFiche(null);
      setErreur('');
      charger();
    } catch (err) {
      setErreur((err as Error).message);
    }
  }

  async function supprimer(j: Jeune) {
    if (!confirm(`Supprimer la fiche de ${j.prenom} ${j.nom} ?\nSes absences et rattrapages seront aussi supprimés.`)) return;
    await appeler('jeunes:delete', j.id);
    charger();
  }

  return (
    <>
      <div className="entete">
        <h1>Apprentis</h1>
        <div className="actions" style={{ marginTop: 0 }}>
          <button onClick={() => { setInfo(''); setBascule(true); }}>Bascule de rentrée…</button>
          <button className="principal" onClick={nouveau}>Ajouter un apprenti</button>
        </div>
      </div>

      <div className="onglets">
        <button className={filtre === 'toutes' ? 'actif' : ''} onClick={() => setFiltre('toutes')}>
          Toutes ({enFormation.length})
        </button>
        {classes.map((c) => (
          <button key={c.id} className={filtre === c.id ? 'actif' : ''} onClick={() => setFiltre(c.id)} title={c.libelle}>
            {c.code} ({enFormation.filter((j) => j.classe_id === c.id).length})
          </button>
        ))}
      </div>

      {nbSortis > 0 && (
        <label className="case discret"><input type="checkbox" checked={voirSortis} onChange={(e) => setVoirSortis(e.target.checked)} /> Afficher les apprentis sortis ({nbSortis})</label>
      )}
      {info && <p className="succes">{info}</p>}
      {erreur && !fiche && <p className="erreur">{erreur}</p>}

      {bascule && <Bascule classes={classes} liste={liste} onClose={() => setBascule(false)} onDone={(m) => { setBascule(false); setInfo(m); charger(); }} />}

      {fiche && (
        <form className="fiche" onSubmit={enregistrer}>
          <h2>{fiche.id ? 'Modifier la fiche' : 'Nouvel apprenti'}</h2>
          <div className="grille">
            <label>Nom *<input autoFocus required {...champ('nom')} /></label>
            <label>Prénom *<input required {...champ('prenom')} /></label>
            <label>E-mail<input type="email" {...champ('email')} /></label>
            <label>Téléphone<input type="tel" {...champ('telephone')} /></label>
            <label>Civilité (pour les convocations)
              <select value={fiche.civilite ?? ''} onChange={(e) => setFiche({ ...fiche, civilite: e.target.value })}>
                <option value="">Non précisée</option>
                <option value="Monsieur">Monsieur</option>
                <option value="Madame">Madame</option>
              </select>
            </label>
            <label>Adresse<input {...champ('adresse')} placeholder="N° et rue" /></label>
            <label>Code postal<input {...champ('code_postal')} /></label>
            <label>Ville<input {...champ('ville')} /></label>
            <label>Classe *
              <select value={fiche.classe_id} onChange={(e) => setFiche({ ...fiche, classe_id: Number(e.target.value) })}>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </label>
            <label>Entreprise
              <select
                value={fiche.entreprise_id ?? ''}
                onChange={(e) => setFiche({ ...fiche, entreprise_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Aucune pour le moment</option>
                {entreprises.map((ent) => <option key={ent.id} value={ent.id}>{ent.nom}</option>)}
              </select>
            </label>
          </div>
          {entrepriseChoisie && (
            <div className="bloc-entreprise">
              <h3>Coordonnées de l'entreprise : {entrepriseChoisie.nom}</h3>
              <p>
                {entrepriseChoisie.telephone ? <>Tél. {entrepriseChoisie.telephone}</> : <span className="discret">Pas de téléphone</span>}
                {' · '}
                {entrepriseChoisie.email ? <>{entrepriseChoisie.email}</> : <span className="discret">Pas d'e-mail</span>}
              </p>
              {contacts.length > 0 && (
                <ul className="pieces">
                  {contacts.map((c) => (
                    <li key={c.id}>
                      <span><strong>{c.nom}</strong>{c.fonction && <> — {c.fonction}</>}</span>
                      <span className="discret">{[c.email, c.telephone].filter(Boolean).join(' · ') || 'aucune coordonnée'}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="discret">Pour ajouter un autre interlocuteur : section Entreprises, fiche de cette entreprise. Au moment de notifier, vous choisirez à quelle(s) adresse(s) écrire.</p>
            </div>
          )}
          {fiche.id && classeInitiale !== null && classeInitiale !== fiche.classe_id && (
            <div className="bloc-alertes">
              <strong>Changement de classe</strong>
              <label className="case"><input type="radio" checked={!fiche.classe_correction} onChange={() => setFiche({ ...fiche, classe_correction: false })} />
                L'apprenti change de classe à partir du
                <input type="date" value={fiche.classe_depuis ?? ''} disabled={!!fiche.classe_correction} onChange={(e) => setFiche({ ...fiche, classe_depuis: e.target.value })} style={{ marginLeft: 8 }} />
              </label>
              <label className="case"><input type="radio" checked={!!fiche.classe_correction} onChange={() => setFiche({ ...fiche, classe_correction: true })} />
                Correction d'une erreur de saisie (la classe était fausse depuis le début)
              </label>
              <p className="discret">Avec une date, les absences antérieures restent dans l'ancienne classe et le bon professeur principal est proposé dans les mails.</p>
            </div>
          )}
          {fiche.id && historique.length > 1 && (
            <>
              <h3>Historique des classes</h3>
              <ul className="pieces">
                {historique.map((l, i) => (
                  <li key={l.id}>
                    <span><strong>{l.classe_code}</strong>{l.type === 'redoublement' && <span className="etiquette st-orange">redoublement</span>} {l.date_debut === ORIGINE ? "depuis l'inscription" : `à partir du ${formaterDate(l.date_debut)}`}{l.date_debut > aujourdhui() && <span className="etiquette st-bleu">prévu</span>}</span>
                    {i < historique.length - 1 && <button type="button" className="danger" onClick={() => annulerLigne(l)}>Retirer</button>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>Maître d'apprentissage</h3>
          <div className="grille">
            <label>Nom<input {...champ('maitre_nom')} /></label>
            <label>Téléphone<input type="tel" {...champ('maitre_telephone')} /></label>
            <label>E-mail<input type="email" {...champ('maitre_email')} /></label>
          </div>
          {contratChange && (
            <div className="bloc-alertes">
              <strong>Changement d'entreprise ou de maître d'apprentissage</strong>
              <label className="case"><input type="radio" checked={!fiche.contrat_correction} onChange={() => setFiche({ ...fiche, contrat_correction: false })} />
                Nouvel employeur / nouveau maître à partir du
                <input type="date" value={fiche.contrat_depuis ?? ''} disabled={!!fiche.contrat_correction} onChange={(e) => setFiche({ ...fiche, contrat_depuis: e.target.value })} style={{ marginLeft: 8 }} />
              </label>
              <label className="case"><input type="radio" checked={!!fiche.contrat_correction} onChange={() => setFiche({ ...fiche, contrat_correction: true })} />
                Correction d'une erreur de saisie (les coordonnées étaient fausses)
              </label>
              <p className="discret">Avec une date, les mails sur les absences antérieures continuent d'aller à l'ancien maître et à l'ancienne entreprise.</p>
            </div>
          )}
          {fiche.id && contrats.length > 1 && (
            <>
              <h3>Historique entreprise / maître d'apprentissage</h3>
              <ul className="pieces">
                {contrats.map((l, i) => (
                  <li key={l.id}>
                    <span><strong>{l.entreprise_nom ?? 'Sans entreprise'}</strong>{l.maitre_nom ? ` — ${l.maitre_nom}` : ''} {l.date_debut === '2000-01-01' ? "depuis l'inscription" : `à partir du ${formaterDate(l.date_debut)}`}{l.date_debut > aujourdhui() && <span className="etiquette st-bleu">prévu</span>}</span>
                    {i < contrats.length - 1 && <button type="button" className="danger" onClick={() => annulerContrat(l)}>Retirer</button>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {fiche.id && (
            <>
              <h3>Sortie de la formation</h3>
              {fiche.sorti_le ? (
                <p>
                  <span className="etiquette st-rouge">{fiche.sorti ? 'Sorti(e)' : 'Sortie prévue'} le {formaterDate(fiche.sorti_le)}</span> {MOTIFS_SORTIE[fiche.sortie_motif ?? ''] ?? ''}{' '}
                  <button type="button" onClick={reintegrer}>Réintégrer</button>
                </p>
              ) : sortie ? (
                <div className="grille">
                  <label>Date de sortie<input type="date" value={sortie.date} onChange={(e) => setSortie({ ...sortie, date: e.target.value })} /></label>
                  <label>Motif
                    <select value={sortie.motif} onChange={(e) => setSortie({ ...sortie, motif: e.target.value })}>
                      {Object.entries(MOTIFS_SORTIE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                  <div className="actions" style={{ marginTop: 0 }}>
                    <button type="button" className="principal" onClick={enregistrerSortie}>Enregistrer la sortie</button>
                    <button type="button" onClick={() => setSortie(null)}>Annuler</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setSortie({ date: aujourdhui(), motif: 'demission' })}>Enregistrer une sortie (démission, rupture, diplômé)…</button>
              )}
              <p className="discret">L'apprenti disparaît des listes à partir de cette date ; absences, retards et rattrapages sont conservés.</p>
            </>
          )}
          {erreur && <p className="erreur">{erreur}</p>}
          <div className="actions">
            <button type="submit" className="principal">Enregistrer</button>
            <button type="button" onClick={() => setFiche(null)}>Annuler</button>
          </div>
        </form>
      )}

      {visibles.length === 0 ? (
        <p className="discret">Aucun apprenti enregistré ici pour le moment.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Apprenti</th><th>Classe</th><th>Entreprise</th><th>Maître d'apprentissage</th><th></th></tr>
          </thead>
          <tbody>
            {visibles.map((j) => (
              <tr key={j.id}>
                <td>
                  <strong>{j.nom} {j.prenom}</strong>{j.sorti && <span className="etiquette st-rouge">sorti(e) le {formaterDate(j.sorti_le!)}</span>}
                  <div className="discret">{[j.email, j.telephone].filter(Boolean).join(' · ')}</div>
                </td>
                <td>{j.classe_code}{j.passage_prevu && <div className="discret">{j.passage_prevu.type === 'redoublement' ? 'redouble' : `→ ${j.passage_prevu.classe_code}`} le {formaterDate(j.passage_prevu.date)}</div>}
                  {!j.sorti && j.sorti_le && <div className="discret">sortie prévue le {formaterDate(j.sorti_le)} ({MOTIFS_SORTIE[j.sortie_motif ?? '']})</div>}</td>
                <td>{j.entreprise_nom ?? <span className="discret">non renseignée</span>}</td>
                <td>
                  {j.maitre_nom}
                  <div className="discret">{[j.maitre_email, j.maitre_telephone].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="droite">
                  <button onClick={() => ouvrirFiche(j)}>Modifier</button>
                  <button className="danger" onClick={() => supprimer(j)}>Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
