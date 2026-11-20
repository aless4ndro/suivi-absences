import { useEffect, useState, type FormEvent } from 'react';
import { appeler, STATUTS_CONTRAT, type ApprentiEntreprise, type Contact, type Entreprise, type StatutContrat } from '../api';
import { formaterDate } from '../format';
import { correspond } from '../recherche';

const VIDE: Entreprise = { nom: '', adresse: '', telephone: '', email: '', nom_commercial: '', siret: '', code_postal: '', ville: '' };

const FILTRES: { id: StatutContrat | 'tous'; texte: string }[] = [
  { id: 'tous', texte: 'Tous' }, { id: 'en_cours', texte: 'En cours' }, { id: 'a_venir', texte: 'À venir' },
  { id: 'termine', texte: 'Terminés' }, { id: 'rompu', texte: 'Rompus' },
];

export default function Entreprises({ cible, apresCible, ouvrirFiche: ouvrirApprenti }: {
  cible?: number | null; apresCible?: () => void; ouvrirFiche?: (type: 'apprenti' | 'entreprise', id: number) => void;
}) {
  const [apprentis, setApprentis] = useState<ApprentiEntreprise[]>([]);
  const [filtreStatut, setFiltreStatut] = useState<StatutContrat | 'tous'>('tous');
  const [recherche, setRecherche] = useState('');
  const [liste, setListe] = useState<Entreprise[]>([]);
  const [fiche, setFiche] = useState<Entreprise | null>(null);
  const [erreur, setErreur] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [erreurContact, setErreurContact] = useState('');

  const chargerContacts = (id: number) => appeler<Contact[]>('contacts:list', id).then(setContacts);
  function ouvrirFiche(ent: Entreprise | null) {
    setErreur(''); setContact(null); setErreurContact('');
    setFiche(ent);
    setFiltreStatut('tous');
    if (ent?.id) { chargerContacts(ent.id); appeler<ApprentiEntreprise[]>('entreprises:apprentis', ent.id).then(setApprentis); }
    else { setContacts([]); setApprentis([]); }
  }
  async function enregistrerContact() {
    if (!fiche?.id || !contact) return;
    try {
      await appeler('contacts:save', { ...contact, entreprise_id: fiche.id });
      setContact(null); setErreurContact('');
      chargerContacts(fiche.id);
    } catch (err) {
      setErreurContact((err as Error).message);
    }
  }
  async function supprimerContact(c: Contact) {
    if (!confirm(`Supprimer l'interlocuteur « ${c.nom} » ?`)) return;
    await appeler('contacts:delete', c.id);
    if (fiche?.id) chargerContacts(fiche.id);
  }

  const charger = () => appeler<Entreprise[]>('entreprises:list').then(setListe);
  const visibles = liste.filter((e) => correspond(recherche, e.nom, e.nom_commercial, e.siret));
  useEffect(() => {
    charger();
  }, []);
  // Arrivée depuis la recherche de l'accueil : ouvre directement la fiche
  useEffect(() => {
    if (!cible || liste.length === 0) return;
    const ent = liste.find((e) => e.id === cible);
    if (ent) { ouvrirFiche(ent); window.scrollTo(0, 0); document.querySelector('main')?.scrollTo(0, 0); }
    apresCible?.();
  }, [cible, liste]);

  const champ = (cle: keyof Entreprise) => ({
    value: (fiche?.[cle] as string | null) ?? '',
    onChange: (e: { target: { value: string } }) => setFiche({ ...fiche!, [cle]: e.target.value }),
  });

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    try {
      await appeler('entreprises:save', fiche);
      setFiche(null);
      setErreur('');
      charger();
    } catch (err) {
      setErreur((err as Error).message);
    }
  }

  async function supprimer(ent: Entreprise) {
    const suite = ent.nb_jeunes ? `\n${ent.nb_jeunes} apprenti(s) n'auront plus d'entreprise rattachée.` : '';
    if (!confirm(`Supprimer l'entreprise « ${ent.nom} » ?${suite}`)) return;
    await appeler('entreprises:delete', ent.id);
    charger();
  }

  return (
    <>
      <div className="entete">
        <h1>Entreprises</h1>
        <button className="principal" onClick={() => ouvrirFiche({ ...VIDE })}>
          Ajouter une entreprise
        </button>
      </div>

      {fiche && (
        <form className="fiche" onSubmit={enregistrer}>
          <h2>{fiche.id ? "Modifier l'entreprise" : 'Nouvelle entreprise'}</h2>
          <div className="grille">
            <label>Raison sociale *<input autoFocus required {...champ('nom')} /></label>
            <label>Nom commercial<input {...champ('nom_commercial')} /></label>
            <label>SIRET (14 chiffres)<input {...champ('siret')} inputMode="numeric" placeholder="552 081 317 00019" /></label>
            <label>Adresse<input {...champ('adresse')} /></label>
            <label>Code postal<input {...champ('code_postal')} /></label>
            <label>Ville<input {...champ('ville')} /></label>
            <label>Téléphone<input type="tel" {...champ('telephone')} /></label>
            <label>E-mail<input type="email" {...champ('email')} /></label>
          </div>
          {erreur && <p className="erreur">{erreur}</p>}
          <div className="actions">
            <button type="submit" className="principal">Enregistrer</button>
            <button type="button" onClick={() => ouvrirFiche(null)}>Annuler</button>
          </div>

          {fiche.id && (
            <>
              <h3>Apprentis rattachés à l'entreprise ({apprentis.filter((a) => a.statut === 'en_cours').length} en cours)</h3>
              {apprentis.length === 0 ? <p className="discret">Aucun apprenti n'est rattaché à cette entreprise.</p> : (
                <>
                  <div className="onglets">
                    {FILTRES.map((f) => (
                      <button key={f.id} type="button" className={filtreStatut === f.id ? 'actif' : ''} onClick={() => setFiltreStatut(f.id)}>
                        {f.texte} ({f.id === 'tous' ? apprentis.length : apprentis.filter((a) => a.statut === f.id).length})
                      </button>
                    ))}
                  </div>
                  <div className="galerie-apprentis">
                    {apprentis.filter((a) => filtreStatut === 'tous' || a.statut === filtreStatut).map((a) => (
                      <button type="button" key={`${a.jeune_id}-${a.contrat_debut}-${a.statut}`} className="carte-apprenti" onClick={() => ouvrirApprenti?.('apprenti', a.jeune_id)} title="Ouvrir la fiche de l'apprenti">
                        {a.photo ? <img src={a.photo} alt="" /> : <span className="photo-vide">{(a.prenom[0] ?? '') + (a.nom[0] ?? '')}</span>}
                        <span className="infos">
                          <strong>{a.nom.toUpperCase()} {a.prenom}</strong>
                          <span className="discret">{a.formation} — {a.classe_code}</span>
                          <span className="discret">{a.contrat_debut || a.contrat_fin ? `Contrat du ${a.contrat_debut ? formaterDate(a.contrat_debut) : '…'} au ${a.contrat_fin ? formaterDate(a.contrat_fin) : '…'}` : 'Dates du contrat non renseignées'}</span>
                          <span className={`etiquette ${STATUTS_CONTRAT[a.statut].classe}`}>{STATUTS_CONTRAT[a.statut].texte}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          <h3>Autres interlocuteurs de l'entreprise</h3>
          {!fiche.id ? (
            <p className="discret">Enregistrez d'abord l'entreprise pour pouvoir ajouter des interlocuteurs.</p>
          ) : (
            <>
              {contacts.length === 0 && <p className="discret">Aucun autre interlocuteur (le maître d'apprentissage se renseigne dans la fiche de l'apprenti).</p>}
              <ul className="pieces">
                {contacts.map((c) => (
                  <li key={c.id}>
                    <span>
                      <strong>{c.nom}</strong>{c.fonction && <> — {c.fonction}</>}
                      <span className="discret"> {[c.email, c.telephone].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span>
                      <button type="button" onClick={() => { setContact(c); setErreurContact(''); }}>Modifier</button>
                      <button type="button" className="danger" onClick={() => supprimerContact(c)}>Supprimer</button>
                    </span>
                  </li>
                ))}
              </ul>
              {contact ? (
                <div className="grille">
                  <label>Nom *<input value={contact.nom} onChange={(e) => setContact({ ...contact, nom: e.target.value })} /></label>
                  <label>Fonction<input value={contact.fonction ?? ''} onChange={(e) => setContact({ ...contact, fonction: e.target.value })} /></label>
                  <label>Téléphone<input type="tel" value={contact.telephone ?? ''} onChange={(e) => setContact({ ...contact, telephone: e.target.value })} /></label>
                  <label>E-mail<input type="email" value={contact.email ?? ''} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></label>
                  <div className="actions">
                    <button type="button" className="principal" onClick={enregistrerContact}>Enregistrer l'interlocuteur</button>
                    <button type="button" onClick={() => setContact(null)}>Annuler</button>
                  </div>
                  {erreurContact && <p className="erreur">{erreurContact}</p>}
                </div>
              ) : (
                <button type="button" onClick={() => setContact({ entreprise_id: fiche.id!, nom: '', fonction: '', telephone: '', email: '' })}>
                  Ajouter un interlocuteur
                </button>
              )}
            </>
          )}
        </form>
      )}

      {liste.length > 0 && (
        <div className="champ-recherche">
          <input type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Raison sociale, nom commercial ou SIRET" />
          {recherche && <button type="button" className="effacer" onClick={() => setRecherche('')} title="Effacer la recherche" aria-label="Effacer la recherche">✕</button>}
        </div>
      )}
      {liste.length === 0 ? (
        <p className="discret">Aucune entreprise enregistrée pour le moment.</p>
      ) : visibles.length === 0 ? (
        <p className="discret">Aucun résultat trouvé.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Nom</th><th>Téléphone</th><th>E-mail</th><th>Apprentis</th><th></th></tr>
          </thead>
          <tbody>
            {visibles.map((ent) => (
              <tr key={ent.id} className="clic" onClick={() => ouvrirFiche(ent)}>
                <td><strong>{ent.nom}</strong>{ent.nom_commercial && <span className="discret"> · {ent.nom_commercial}</span>}{(ent.adresse || ent.ville) && <div className="discret">{[ent.adresse, [ent.code_postal, ent.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</div>}{ent.siret && <div className="discret">SIRET {ent.siret}</div>}</td>
                <td>{ent.telephone}</td>
                <td>{ent.email}</td>
                <td>{ent.nb_jeunes}</td>
                <td className="droite" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => ouvrirFiche(ent)}>Modifier</button>
                  <button className="danger" onClick={() => supprimer(ent)}>Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
