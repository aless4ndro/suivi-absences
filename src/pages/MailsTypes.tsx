import { useEffect, useRef, useState } from 'react';
import { appeler, documents, type Destinataire, type Jeune, type MailRendu, type ModeleMail, type ResultatCourriel } from '../api';
import ChoixDestinataires, { adressesInvalides, envoiParDefaut, repartition, type Envoi } from '../ChoixDestinataires';

const VIDE: ModeleMail = { nom: '', categorie: '', objet: '', contenu: '', destinataires: '', actif: 1 };

export default function MailsTypes() {
  const [onglet, setOnglet] = useState<'modeles' | 'ecrire'>('modeles');
  const [categories, setCategories] = useState<string[]>([]);
  const [variables, setVariables] = useState<{ nom: string; libelle: string }[]>([]);
  const [modeles, setModeles] = useState<ModeleMail[]>([]);
  const [filtre, setFiltre] = useState('');
  const [edition, setEdition] = useState<ModeleMail | null>(null);
  const [apercu, setApercu] = useState<MailRendu | null>(null);
  const [apprentis, setApprentis] = useState<Jeune[]>([]);
  const [jeuneId, setJeuneId] = useState('');
  const [modeleId, setModeleId] = useState('');
  const [mail, setMail] = useState<(MailRendu & { destinataires: string | null }) | null>(null);
  const [dest, setDest] = useState<Destinataire[]>([]);
  const [envoi, setEnvoi] = useState<Envoi | null>(null);
  const [erreur, setErreur] = useState('');
  const [info, setInfo] = useState('');
  const zone = useRef<HTMLTextAreaElement>(null);

  const charger = () => appeler<ModeleMail[]>('mails:modeles', { categorie: filtre || undefined }).then(setModeles);
  useEffect(() => { charger(); }, [filtre]);
  useEffect(() => {
    appeler<string[]>('mails:categories').then(setCategories);
    appeler<{ nom: string; libelle: string }[]>('mails:variables').then(setVariables);
    appeler<Jeune[]>('jeunes:list', {}).then(setApprentis);
  }, []);

  async function enregistrer() {
    if (!edition) return;
    try { await appeler('mails:modele:save', edition); setEdition(null); setErreur(''); setInfo('Modèle enregistré.'); charger(); } catch (e) { setErreur((e as Error).message); }
  }
  async function basculer(m: ModeleMail) {
    await appeler('mails:modele:save', { ...m, actif: m.actif ? 0 : 1 }); charger();
  }
  function inserer(nom: string) {
    if (!edition) return;
    const z = zone.current;
    const t = `{${nom}}`;
    if (!z) { setEdition({ ...edition, contenu: edition.contenu + t }); return; }
    const d = z.selectionStart ?? edition.contenu.length;
    const f = z.selectionEnd ?? d;
    setEdition({ ...edition, contenu: edition.contenu.slice(0, d) + t + edition.contenu.slice(f) });
  }
  async function previsualiser(m: ModeleMail) {
    if (!apprentis.length) { setErreur("Aucun apprenti pour l'aperçu."); return; }
    try { setApercu(await appeler<MailRendu>('mails:rendre', { modele_id: m.id, jeune_id: Number(jeuneId) || apprentis[0].id })); setErreur(''); } catch (e) { setErreur((e as Error).message); }
  }
  async function preparer() {
    if (!jeuneId) { setErreur("Choisissez d'abord un apprenti."); return; }
    try {
      const r = await appeler<MailRendu>('mails:rendre', { modele_id: modeleId ? Number(modeleId) : undefined, objet: '', contenu: '', jeune_id: Number(jeuneId) });
      const liste = await appeler<Destinataire[]>('destinataires:list', { jeune_id: Number(jeuneId) });
      const a = apprentis.find((x) => x.id === Number(jeuneId));
      const tous = a?.email ? [{ cle: 'apprenti', libelle: `Apprenti : ${a.nom.toUpperCase()} ${a.prenom}`, email: a.email, telephone: null }, ...liste] : liste;
      setDest(tous); setEnvoi(envoiParDefaut(tous)); setMail({ ...r, destinataires: r.destinataires }); setErreur('');
    } catch (e) { setErreur((e as Error).message); }
  }
  async function ouvrirBrouillon() {
    if (!mail || !envoi) return;
    const inv = adressesInvalides(envoi);
    if (inv.length) { setErreur(`Adresse(s) invalide(s) : ${inv.join(', ')}`); return; }
    const rep = repartition(envoi);
    if (!rep.a.length && !rep.cc.length && !rep.cci.length) { setErreur('Choisissez au moins un destinataire.'); return; }
    try {
      const r = await documents<ResultatCourriel>('courriel', { ...rep, objet: mail.objet, corps: mail.corps });
      await appeler('mails:archiver', { jeune_id: Number(jeuneId), ...rep, objet: mail.objet, corps: mail.corps, modele_nom: mail.modele_nom ?? undefined, methode: r.methode, source: 'Bibliothèque de mails' });
      setInfo(r.methode === 'outlook' ? 'Brouillon ouvert dans Outlook et archivé dans la fiche de l\'apprenti. Relisez-le puis envoyez-le vous-même.' : 'Un message a été ouvert dans la messagerie par défaut et archivé.');
      setMail(null);
    } catch (e) { setErreur((e as Error).message); }
  }

  return (
    <div>
      <div className="entete"><h1>Mails types</h1></div>
      <div className="onglets">
        <button className={onglet === 'modeles' ? 'actif' : ''} onClick={() => setOnglet('modeles')}>Modèles</button>
        <button className={onglet === 'ecrire' ? 'actif' : ''} onClick={() => setOnglet('ecrire')}>Écrire un mail</button>
      </div>
      {erreur && <p className="erreur">{erreur}</p>}
      {info && <p className="info">{info}</p>}

      {onglet === 'modeles' && (
        <>
          <div className="filtres">
            <label>Catégorie<select value={filtre} onChange={(e) => setFiltre(e.target.value)}><option value="">Toutes</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
            <button className="principal" onClick={() => { setEdition({ ...VIDE, categorie: categories[0] ?? '' }); setErreur(''); }}>Nouveau modèle</button>
          </div>
          <table className="table">
            <thead><tr><th>Nom</th><th>Catégorie</th><th>Objet</th><th /></tr></thead>
            <tbody>
              {modeles.map((m) => (
                <tr key={m.id} className={m.actif ? '' : 'discret'}>
                  <td>{m.nom}{!m.actif && <span className="etiquette">inactif</span>}</td><td>{m.categorie}</td><td>{m.objet}</td>
                  <td className="droite">
                    <button onClick={() => previsualiser(m)}>Aperçu</button>{' '}
                    <button onClick={() => { setEdition({ ...m, destinataires: m.destinataires ?? '' }); setErreur(''); }}>Modifier</button>{' '}
                    <button onClick={() => basculer(m)}>{m.actif ? 'Désactiver' : 'Activer'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {apercu && (
            <section className="fiche">
              <h3>Aperçu (avec les données d'un apprenti)</h3>
              <p><strong>{apercu.objet}</strong></p>
              <pre className="apercu-mail">{apercu.corps}</pre>
              {apercu.manquantes.length > 0 && <p className="discret">Variables sans donnée pour cet apprenti : {apercu.manquantes.map((k) => `{${k}}`).join(', ')}</p>}
              <div className="actions"><button onClick={() => setApercu(null)}>Fermer l'aperçu</button></div>
            </section>
          )}
          {edition && (
            <div className="voile"><div className="fenetre large">
              <div className="entete"><h2>{edition.id ? 'Modifier le modèle' : 'Nouveau modèle'}</h2><button onClick={() => setEdition(null)}>Fermer</button></div>
              <div className="grille">
                <label>Nom interne *<input value={edition.nom} onChange={(e) => setEdition({ ...edition, nom: e.target.value })} /></label>
                <label>Catégorie *<select value={edition.categorie} onChange={(e) => setEdition({ ...edition, categorie: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
              </div>
              <label>Objet du mail *<input value={edition.objet} onChange={(e) => setEdition({ ...edition, objet: e.target.value })} /></label>
              <label>Contenu *<textarea ref={zone} rows={12} value={edition.contenu} onChange={(e) => setEdition({ ...edition, contenu: e.target.value })} /></label>
              <p className="discret">Insérer une variable :</p>
              <div className="liste-cases">{variables.map((v) => <button key={v.nom} type="button" title={v.libelle} onClick={() => inserer(v.nom)}>{`{${v.nom}}`}</button>)}</div>
              <label>Destinataires éventuels (adresses séparées par « ; »)<input value={edition.destinataires ?? ''} onChange={(e) => setEdition({ ...edition, destinataires: e.target.value })} /></label>
              <label className="case"><input type="checkbox" checked={!!edition.actif} onChange={(e) => setEdition({ ...edition, actif: e.target.checked ? 1 : 0 })} /> Modèle actif</label>
              {erreur && <p className="erreur">{erreur}</p>}
              <div className="actions"><button className="principal" onClick={enregistrer}>Enregistrer</button><button onClick={() => setEdition(null)}>Annuler</button></div>
            </div></div>
          )}
        </>
      )}

      {onglet === 'ecrire' && (
        <>
          <section className="fiche">
            <div className="grille">
              <label>Apprenti<select value={jeuneId} onChange={(e) => setJeuneId(e.target.value)}><option value="">—</option>{apprentis.map((a) => <option key={a.id} value={a.id}>{a.nom.toUpperCase()} {a.prenom} — {a.classe_code}</option>)}</select></label>
              <label>Modèle<select value={modeleId} onChange={(e) => setModeleId(e.target.value)}><option value="">Mail libre</option>{modeles.filter((m) => m.actif).map((m) => <option key={m.id} value={m.id}>{m.categorie} — {m.nom}</option>)}</select></label>
            </div>
            <div className="actions"><button className="principal" onClick={preparer}>Préparer le mail…</button></div>
          </section>
          {mail && envoi && (
            <div className="voile"><div className="fenetre">
              <div className="entete"><h2>Mail</h2><button onClick={() => setMail(null)}>Fermer</button></div>
              {mail.manquantes.length > 0 && <p className="alerte-texte">⚠ Informations absentes des fiches : {mail.manquantes.map((k) => `{${k}}`).join(', ')}</p>}
              <ChoixDestinataires destinataires={dest} envoi={envoi} onChange={setEnvoi} />
              <label>Objet<input value={mail.objet} onChange={(e) => setMail({ ...mail, objet: e.target.value })} /></label>
              <label>Message (modifiable)<textarea rows={12} value={mail.corps} onChange={(e) => setMail({ ...mail, corps: e.target.value })} /></label>
              <p className="discret">Pour une pièce jointe, ajoutez-la dans le brouillon Outlook. Un brouillon s'ouvre : vous l'envoyez vous-même.</p>
              <div className="actions"><button className="principal" onClick={ouvrirBrouillon}>Ouvrir le brouillon</button><button onClick={() => setMail(null)}>Annuler</button></div>
            </div></div>
          )}
        </>
      )}
    </div>
  );
}
