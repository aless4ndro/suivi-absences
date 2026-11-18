import { useEffect, useState, type FormEvent } from 'react';
import { appeler, type Classe, type Contact, type Entreprise, type Jeune, type LigneClasse } from '../api';
import { aujourdhui, formaterDate } from '../format';

const ORIGINE = '2000-01-01';
// Prochaine rentrée : 1er septembre à venir.
const prochaineRentree = () => {
  const [a, m] = aujourdhui().split('-').map(Number);
  return `${m >= 9 ? a + 1 : a}-09-01`;
};
const formationDe = (libelle: string) => libelle.split(' — ')[0].trim();
// Classe suivante proposée : même formation, ordre immédiatement supérieur.
const suivante = (classes: Classe[], c?: Classe) =>
  c ? classes.find((x) => formationDe(x.libelle) === formationDe(c.libelle) && (x.ordre ?? 0) > (c.ordre ?? 0)) : undefined;

type Passage = { origine: number; ids: number[]; classe_id: string; date: string };

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
  const [passage, setPassage] = useState<Passage | null>(null);
  const [info, setInfo] = useState('');
  const entrepriseId = fiche?.entreprise_id ?? null;
  const entrepriseChoisie = entreprises.find((e) => e.id === entrepriseId);
  useEffect(() => {
    if (entrepriseId) appeler<Contact[]>('contacts:list', entrepriseId).then(setContacts);
    else setContacts([]);
  }, [entrepriseId]);

  const charger = () => appeler<Jeune[]>('jeunes:list').then(setListe);
  useEffect(() => {
    appeler<Classe[]>('classes:list').then(setClasses);
    appeler<Entreprise[]>('entreprises:list').then(setEntreprises);
    charger();
  }, []);

  const visibles = filtre === 'toutes' ? liste : liste.filter((j) => j.classe_id === filtre);

  function ouvrirFiche(j: Jeune) {
    setErreur(''); setInfo('');
    setFiche({ ...j, classe_depuis: aujourdhui(), classe_correction: false });
    setClasseInitiale(j.classe_id);
    appeler<LigneClasse[]>('jeunes:classes', j.id).then(setHistorique);
  }

  async function annulerLigne(l: LigneClasse) {
    if (!confirm(`Retirer « ${l.classe_code} à partir du ${formaterDate(l.date_debut)} » de l'historique ?\nÀ faire seulement pour une erreur ou un passage prévu qui n'aura pas lieu.`)) return;
    try {
      await appeler('jeunes:classe:supprimer', l.id);
      if (fiche?.id) appeler<LigneClasse[]>('jeunes:classes', fiche.id).then(setHistorique);
      const maj = (await appeler<Jeune[]>('jeunes:list'));
      setListe(maj);
      const j = maj.find((x) => x.id === fiche?.id);
      if (j && fiche) { setFiche({ ...fiche, classe_id: j.classe_id }); setClasseInitiale(j.classe_id); }
    } catch (err) { setErreur((err as Error).message); }
  }

  function ouvrirPassage() {
    const origine = filtre === 'toutes' ? classes[0]?.id ?? 0 : filtre;
    const c = classes.find((x) => x.id === origine);
    setInfo(''); setErreur('');
    setPassage({ origine, ids: liste.filter((j) => j.classe_id === origine).map((j) => j.id!), classe_id: String(suivante(classes, c)?.id ?? ''), date: prochaineRentree() });
  }

  async function validerPassage(e: FormEvent) {
    e.preventDefault();
    if (!passage) return;
    const dest = classes.find((c) => String(c.id) === passage.classe_id);
    if (!dest) { setErreur('Choisissez la nouvelle classe.'); return; }
    if (!confirm(`${passage.ids.length} apprenti(s) passeront en ${dest.code} à partir du ${formaterDate(passage.date)}.\nLeurs absences et rattrapages antérieurs restent rattachés à leur ancienne classe. Continuer ?`)) return;
    try {
      const n = await appeler<number>('jeunes:passage', { ids: passage.ids, classe_id: Number(passage.classe_id), date: passage.date });
      setPassage(null); setErreur('');
      setInfo(passage.date > aujourdhui()
        ? `Passage programmé pour ${n} apprenti(s) : il s'appliquera automatiquement le ${formaterDate(passage.date)}.`
        : `${n} apprenti(s) passé(s) en ${dest.code}.`);
      charger();
    } catch (err) { setErreur((err as Error).message); }
  }

  function nouveau() {
    setErreur(''); setInfo(''); setHistorique([]); setClasseInitiale(null);
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
          <button onClick={ouvrirPassage}>Passage de classe…</button>
          <button className="principal" onClick={nouveau}>Ajouter un apprenti</button>
        </div>
      </div>

      <div className="onglets">
        <button className={filtre === 'toutes' ? 'actif' : ''} onClick={() => setFiltre('toutes')}>
          Toutes ({liste.length})
        </button>
        {classes.map((c) => (
          <button key={c.id} className={filtre === c.id ? 'actif' : ''} onClick={() => setFiltre(c.id)} title={c.libelle}>
            {c.code} ({liste.filter((j) => j.classe_id === c.id).length})
          </button>
        ))}
      </div>

      {info && <p className="succes">{info}</p>}
      {erreur && !fiche && <p className="erreur">{erreur}</p>}

      {passage && (
        <div className="voile">
          <form className="fenetre" onSubmit={validerPassage}>
            <div className="entete"><h2>Passage de classe</h2><button type="button" onClick={() => { setPassage(null); setErreur(''); }}>Fermer</button></div>
            <p className="discret">Pour la rentrée (1ère → 2ème année) ou une réorientation. Les absences, retards et rattrapages déjà saisis restent rattachés à l'ancienne classe et à son professeur principal.</p>
            <div className="grille">
              <label>Classe actuelle
                <select value={passage.origine} onChange={(e) => {
                  const o = Number(e.target.value);
                  setPassage({ ...passage, origine: o, ids: liste.filter((j) => j.classe_id === o).map((j) => j.id!), classe_id: String(suivante(classes, classes.find((c) => c.id === o))?.id ?? '') });
                }}>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.code} ({liste.filter((j) => j.classe_id === c.id).length})</option>)}
                </select>
              </label>
              <label>Nouvelle classe *
                <select value={passage.classe_id} onChange={(e) => setPassage({ ...passage, classe_id: e.target.value })} required>
                  <option value="">— choisir —</option>
                  {classes.filter((c) => c.id !== passage.origine).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
                </select>
              </label>
              <label>À partir du *<input type="date" value={passage.date} onChange={(e) => setPassage({ ...passage, date: e.target.value })} required /></label>
            </div>
            {!passage.classe_id && <p className="alerte-texte">⚠ Pas de classe suivante dans cette formation (fin de cursus ?) : choisissez-la, ou laissez ces apprentis où ils sont.</p>}
            <h3>Apprentis concernés ({passage.ids.length})</h3>
            <ul className="pieces">
              {liste.filter((j) => j.classe_id === passage.origine).map((j) => (
                <li key={j.id}><label className="case">
                  <input type="checkbox" checked={passage.ids.includes(j.id!)} onChange={(e) => setPassage({ ...passage, ids: e.target.checked ? [...passage.ids, j.id!] : passage.ids.filter((x) => x !== j.id) })} />
                  {j.nom.toUpperCase()} {j.prenom}
                  {j.passage_prevu && <span className="alerte-texte"> — déjà prévu : {j.passage_prevu.classe_code} au {formaterDate(j.passage_prevu.date)}</span>}
                </label></li>
              ))}
            </ul>
            <p className="discret">Décochez les apprentis qui redoublent ou quittent la formation.</p>
            {erreur && <p className="erreur">{erreur}</p>}
            <div className="actions"><button className="principal" type="submit" disabled={!passage.ids.length}>Valider le passage</button></div>
          </form>
        </div>
      )}

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
                    <span><strong>{l.classe_code}</strong> {l.date_debut === ORIGINE ? "depuis l'inscription" : `à partir du ${formaterDate(l.date_debut)}`}{l.date_debut > aujourdhui() && <span className="etiquette st-bleu">prévu</span>}</span>
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
                  <strong>{j.nom} {j.prenom}</strong>
                  <div className="discret">{[j.email, j.telephone].filter(Boolean).join(' · ')}</div>
                </td>
                <td>{j.classe_code}{j.passage_prevu && <div className="discret">→ {j.passage_prevu.classe_code} le {formaterDate(j.passage_prevu.date)}</div>}</td>
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
