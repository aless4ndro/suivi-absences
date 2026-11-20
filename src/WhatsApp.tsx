import { useEffect, useState } from 'react';
import { appeler, documents, type Classe, type DestinataireWhatsApp, type Jeune, type MailRendu, type ModeleMail } from './api';
import SelecteurModele from './SelecteurModele';

const LIMITE = 1500;
const CATEGORIES_DISCIPLINAIRES = ['Sanctions et avertissements', 'Commissions disciplinaires'];

// Message WhatsApp à un apprenti (ou à son maître d'apprentissage / son entreprise) : le message est préparé ici,
// la conversation s'ouvre dans WhatsApp et c'est la personne qui relit puis envoie.
export function WhatsAppFiche({ jeuneId, nom, fermer }: { jeuneId: number; nom: string; fermer: () => void }) {
  const [dest, setDest] = useState<DestinataireWhatsApp[]>([]);
  const [cle, setCle] = useState('apprenti');
  const [texte, setTexte] = useState('');
  const [categorie, setCategorie] = useState<string | null>(null);
  const [modele, setModele] = useState<string | null>(null);
  const [erreur, setErreur] = useState('');
  const [info, setInfo] = useState('');
  useEffect(() => { appeler<DestinataireWhatsApp[]>('whatsapp:destinataires', jeuneId).then(setDest); }, [jeuneId]);
  const d = dest.find((x) => x.cle === cle);
  const disciplinaire = d?.role === 'entreprise' && !!categorie && CATEGORIES_DISCIPLINAIRES.includes(categorie);

  async function ouvrir() {
    setErreur(''); setInfo('');
    try {
      await documents('whatsapp', { jeune_id: jeuneId, cle, texte, categorie, modele_nom: modele });
      setInfo("Conversation ouverte dans WhatsApp : relisez puis envoyez le message vous-même. Il est noté dans l'historique des communications.");
    } catch (e) { setErreur((e as Error).message); }
  }

  return (
    <div className="voile">
      <div className="fenetre">
        <div className="entete"><h2>Écrire sur WhatsApp — {nom}</h2><button type="button" onClick={fermer}>Fermer</button></div>
        <label>Destinataire
          <select value={cle} onChange={(e) => setCle(e.target.value)}>
            {dest.map((x) => <option key={x.cle} value={x.cle}>{x.libelle} — {x.telephone || 'pas de téléphone'}{x.probleme ? ` (${x.probleme})` : ''}</option>)}
          </select>
        </label>
        <SelecteurModele jeuneId={jeuneId} onChoisir={(m: MailRendu) => { setTexte(m.corps); setCategorie(m.categorie ?? null); setModele(m.modele_nom); }} />
        <label>Message (modifiable)<textarea rows={9} value={texte} onChange={(e) => setTexte(e.target.value)} /></label>
        <p className={texte.length > LIMITE ? 'erreur' : 'discret'}>{texte.length} / {LIMITE} caractères</p>
        {disciplinaire && <p className="erreur">Les messages disciplinaires ne sont pas envoyés à une entreprise par WhatsApp.</p>}
        {d && !d.utilisable && <p className="erreur">{d.libelle} : {d.probleme}.</p>}
        {erreur && <p className="erreur">{erreur}</p>}
        {info && <p className="succes">{info}</p>}
        <div className="actions">
          <button type="button" className="principal" disabled={!texte.trim() || !d?.utilisable || disciplinaire || texte.length > LIMITE} onClick={ouvrir}>Ouvrir dans WhatsApp</button>
          <button type="button" onClick={fermer}>Fermer</button>
        </div>
        <p className="discret">WhatsApp (application ou WhatsApp Web) doit être connecté avec le numéro de l'établissement ou celui de l'utilisatrice. Rien n'est envoyé sans votre clic dans WhatsApp.</p>
      </div>
    </div>
  );
}

// Même message personnalisé pour tous les apprentis d'une classe : une conversation à ouvrir par apprenti.
export function WhatsAppClasse({ fermer }: { fermer: () => void }) {
  const [classes, setClasses] = useState<Classe[]>([]);
  const [jeunes, setJeunes] = useState<Jeune[]>([]);
  const [classeId, setClasseId] = useState('');
  const [modeles, setModeles] = useState<ModeleMail[]>([]);
  const [modeleId, setModeleId] = useState('');
  const [libre, setLibre] = useState('');
  const [faits, setFaits] = useState<Record<number, string>>({});
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    appeler<Classe[]>('classes:list').then(setClasses);
    appeler<Jeune[]>('jeunes:list').then(setJeunes);
    appeler<ModeleMail[]>('mails:modeles', { actifs: true }).then((m) => setModeles(m.filter((x) => !CATEGORIES_DISCIPLINAIRES.includes(x.categorie))));
  }, []);
  const liste = jeunes.filter((j) => !j.sorti && String(j.classe_id) === classeId);

  async function ouvrir(j: Jeune) {
    setErreur('');
    try {
      const m = await appeler<MailRendu>('mails:rendre', modeleId ? { modele_id: Number(modeleId), jeune_id: j.id } : { objet: '', contenu: libre, jeune_id: j.id });
      await documents('whatsapp', { jeune_id: j.id, cle: 'apprenti', texte: m.corps, categorie: m.categorie ?? null, modele_nom: m.modele_nom });
      setFaits((f) => ({ ...f, [j.id!]: 'Conversation ouverte' }));
    } catch (e) { setErreur(`${j.nom} ${j.prenom} : ${(e as Error).message}`); }
  }

  return (
    <div className="voile">
      <div className="fenetre large">
        <div className="entete"><h2>WhatsApp à une classe</h2><button type="button" onClick={fermer}>Fermer</button></div>
        <p className="discret">Le message est personnalisé pour chaque apprenti (prénom, classe…). Vous ouvrez les conversations une par une et envoyez vous-même ; les messages disciplinaires sont exclus.</p>
        <div className="grille">
          <label>Classe<select value={classeId} onChange={(e) => { setClasseId(e.target.value); setFaits({}); }}><option value="">— Choisir —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></label>
          <label>Mail type<select value={modeleId} onChange={(e) => setModeleId(e.target.value)}><option value="">Message libre ci-dessous</option>{modeles.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}</select></label>
        </div>
        {!modeleId && <label>Message libre (variables possibles : {'{PRENOM_APPRENTI}'}, {'{CLASSE}'}, {'{SIGNATURE}'})<textarea rows={5} value={libre} onChange={(e) => setLibre(e.target.value)} /></label>}
        {erreur && <p className="erreur">{erreur}</p>}
        {classeId && (
          <table className="tableau">
            <thead><tr><th>Apprenti</th><th>Téléphone</th><th>État</th><th /></tr></thead>
            <tbody>
              {liste.length === 0 && <tr><td colSpan={4} className="discret">Aucun apprenti dans cette classe.</td></tr>}
              {liste.map((j) => (
                <tr key={j.id}>
                  <td><strong>{j.nom.toUpperCase()}</strong> {j.prenom}</td>
                  <td>{j.telephone || <span className="discret">aucun</span>}</td>
                  <td>{faits[j.id!] ? <span className="etiquette st-vert">{faits[j.id!]}</span> : ''}</td>
                  <td><button type="button" disabled={!j.telephone || (!modeleId && !libre.trim())} onClick={() => ouvrir(j)}>Ouvrir dans WhatsApp</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
