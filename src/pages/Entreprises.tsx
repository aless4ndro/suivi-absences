import { useEffect, useState, type FormEvent } from 'react';
import { appeler, type Contact, type Entreprise } from '../api';
import { correspond } from '../recherche';

const VIDE: Entreprise = { nom: '', adresse: '', telephone: '', email: '', nom_commercial: '', siret: '' };

export default function Entreprises({ cible, apresCible }: { cible?: number | null; apresCible?: () => void }) {
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
    if (ent?.id) chargerContacts(ent.id); else setContacts([]);
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
            <label>Téléphone<input type="tel" {...champ('telephone')} /></label>
            <label>E-mail<input type="email" {...champ('email')} /></label>
          </div>
          {erreur && <p className="erreur">{erreur}</p>}
          <div className="actions">
            <button type="submit" className="principal">Enregistrer</button>
            <button type="button" onClick={() => ouvrirFiche(null)}>Annuler</button>
          </div>

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
                <td><strong>{ent.nom}</strong>{ent.nom_commercial && <span className="discret"> · {ent.nom_commercial}</span>}{ent.adresse && <div className="discret">{ent.adresse}</div>}{ent.siret && <div className="discret">SIRET {ent.siret}</div>}</td>
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
