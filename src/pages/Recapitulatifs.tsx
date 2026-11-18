import { useEffect, useState } from 'react';
import { appeler, documents, type ApprentiBilan, type Bilan, type Classe, type Destinataire, type ResultatCourriel } from '../api';
import { aujourdhui, formaterTaille } from '../format';
import { corpsRecap, sujetRecap, type DonneesRecap } from '../recap';
import ChoixDestinataires, { adressesInvalides, envoiParDefaut, ppInclus, repartition, toutesAdresses, type Envoi } from '../ChoixDestinataires';

const p2 = (n: number) => String(n).padStart(2, '0');
const dernierJour = (ym: string) => {
  const [a, m] = ym.split('-').map(Number);
  return `${ym}-${p2(new Date(Date.UTC(a, m, 0)).getUTCDate())}`;
};
const moisPrecedent = () => {
  const [a, m] = aujourdhui().split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${p2(m - 1)}`;
};
const hm = (min: number) => `${Math.floor(min / 60)} h ${p2(min % 60)}`;

type Prepa = {
  a: ApprentiBilan; donnees: DonneesRecap; destinataires: Destinataire[]; envoi: Envoi;
  objet: string; corps: string; piecesSeance: number[]; piecesEvenement: number[];
};

export default function Recapitulatifs() {
  const [classes, setClasses] = useState<Classe[]>([]);
  const [mois, setMois] = useState(moisPrecedent());
  const [classeId, setClasseId] = useState('');
  const [recherche, setRecherche] = useState('');
  const [bilan, setBilan] = useState<Bilan | null>(null);
  const [coches, setCoches] = useState<number[]>([]);
  const [prepa, setPrepa] = useState<Prepa | null>(null);
  const [faits, setFaits] = useState<Record<number, string>>({});
  const [erreur, setErreur] = useState('');
  const [info, setInfo] = useState('');
  const debut = `${mois}-01`;
  const fin = dernierJour(mois);

  useEffect(() => { appeler<Classe[]>('classes:list').then(setClasses); }, []);
  useEffect(() => {
    appeler<Bilan>('rattrapages:bilan', { debut, fin, classe_id: classeId ? Number(classeId) : undefined, recherche })
      .then((b) => { setBilan(b); setCoches([]); setFaits({}); })
      .catch((e) => setErreur(e.message));
  }, [mois, classeId, recherche]);

  const concernes = (bilan?.apprentis ?? []).filter((a) => a.dues > 0 || a.validees > 0);

  async function charger(a: ApprentiBilan): Promise<Prepa> {
    const [donnees, destinataires] = await Promise.all([
      appeler<DonneesRecap>('recap:donnees', { jeune_id: a.id, debut, fin }),
      appeler<Destinataire[]>('destinataires:list', { jeune_id: a.id, date: fin }),
    ]);
    const piecesSeance = donnees.pieces.map((p) => p.id);
    return {
      a, donnees, destinataires, envoi: envoiParDefaut(destinataires),
      objet: sujetRecap(a.nom, a.prenom, mois), corps: corpsRecap(donnees, mois, piecesSeance.length > 0),
      piecesSeance, piecesEvenement: [],
    };
  }

  async function ouvrirPrepa(a: ApprentiBilan) {
    try { setPrepa(await charger(a)); setErreur(''); setInfo(''); } catch (e) { setErreur((e as Error).message); }
  }

  async function brouillon(p: Prepa): Promise<ResultatCourriel> {
    const invalides = adressesInvalides(p.envoi);
    if (invalides.length) throw new Error(`Adresse(s) invalide(s) : ${invalides.join(', ')}`);
    const r = await documents<ResultatCourriel>('courriel', {
      ...repartition(p.envoi), objet: p.objet, corps: p.corps,
      piece_seance_ids: p.piecesSeance, piece_evenement_ids: p.piecesEvenement,
    });
    await appeler('recap:envoye', {
      jeune_id: p.a.id, debut, fin, destinataires: toutesAdresses(p.envoi),
      pieces: [...p.donnees.pieces.filter((x) => p.piecesSeance.includes(x.id)).map((x) => x.nom_fichier),
        ...p.donnees.pieces_evenements.filter((x) => p.piecesEvenement.includes(x.id)).map((x) => x.nom_fichier)],
    });
    return r;
  }

  async function envoyerUn() {
    if (!prepa) return;
    try {
      const r = await brouillon(prepa);
      setFaits((f) => ({ ...f, [prepa.a.id]: r.methode === 'outlook' ? 'Brouillon Outlook ouvert' : 'Message ouvert (pièces à glisser)' }));
      setInfo(r.methode === 'outlook'
        ? 'Brouillon ouvert dans Outlook. Relisez-le puis envoyez-le vous-même.'
        : `Outlook n'a pas pu être piloté (${r.raison}). Un message a été ouvert ; glissez-y les pièces du dossier qui vient de s'ouvrir.`);
      setErreur(''); setPrepa(null);
    } catch (e) { setErreur((e as Error).message); }
  }

  async function envoyerPlusieurs() {
    const liste = concernes.filter((a) => coches.includes(a.id));
    const manquants: string[] = [];
    let ok = 0;
    for (const a of liste) {
      try {
        const p = await charger(a);
        if (repartition(p.envoi).a.length === 0) { manquants.push(`${a.nom} ${a.prenom} (aucune adresse e-mail)`); continue; }
        const r = await brouillon(p);
        setFaits((f) => ({ ...f, [a.id]: r.methode === 'outlook' ? 'Brouillon Outlook ouvert' : 'Message ouvert (pièces à glisser)' }));
        ok++;
      } catch (e) { manquants.push(`${a.nom} ${a.prenom} : ${(e as Error).message}`); }
    }
    setInfo(`${ok} brouillon(s) ouvert(s) dans Outlook (aux adresses par défaut, avec les feuilles d'émargement signées). Relisez et envoyez chacun vous-même.`);
    setErreur(manquants.length ? `Non préparés : ${manquants.join(' ; ')}` : '');
  }

  const maj = (patch: Partial<Prepa>) => prepa && setPrepa({ ...prepa, ...patch });

  return (
    <>
      <div className="entete"><h1>Récapitulatifs mensuels aux employeurs</h1></div>
      <p className="discret">Un bilan par apprenti : absences et retards irrecevables du mois, rattrapages validés et solde. Les mails restent des <strong>brouillons Outlook</strong> : vous les relisez puis les envoyez vous-même.</p>

      <section className="fiche">
        <div className="grille">
          <label>Mois<input type="month" value={mois} onChange={(e) => e.target.value && setMois(e.target.value)} /></label>
          <label>Groupe classe
            <select value={classeId} onChange={(e) => setClasseId(e.target.value)}>
              <option value="">Toutes les classes</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
            </select>
          </label>
          <label>Apprenti<input value={recherche} placeholder="Rechercher…" onChange={(e) => setRecherche(e.target.value)} /></label>
        </div>
        {erreur && <p className="erreur">{erreur}</p>}
        {info && <p className="succes">{info}</p>}
      </section>

      <div className="actions">
        <button onClick={() => setCoches(coches.length === concernes.length ? [] : concernes.map((a) => a.id))}>{coches.length === concernes.length && concernes.length ? 'Tout décocher' : 'Tout cocher'}</button>
        <button className="principal" disabled={!coches.length} onClick={envoyerPlusieurs}>Préparer les brouillons des {coches.length} apprenti(s) coché(s)</button>
      </div>

      <table className="tableau">
        <thead><tr><th /><th>Apprenti</th><th>Classe</th><th>Absences</th><th>Retards</th><th>Rattrapées</th><th>Solde</th><th>État</th><th /></tr></thead>
        <tbody>
          {concernes.length === 0 && <tr><td colSpan={9} className="discret">Aucun apprenti avec des absences ou retards irrecevables sur ce mois.</td></tr>}
          {concernes.map((a) => (
            <tr key={a.id}>
              <td><input type="checkbox" checked={coches.includes(a.id)} onChange={(e) => setCoches(e.target.checked ? [...coches, a.id] : coches.filter((x) => x !== a.id))} /></td>
              <td><strong>{a.nom.toUpperCase()}</strong> {a.prenom}</td>
              <td>{a.classe_code}</td>
              <td>{hm(a.min_absences)}</td><td>{hm(a.min_retards)}</td><td>{hm(a.validees)}</td><td><strong>{hm(a.solde)}</strong></td>
              <td>{faits[a.id] ? <span className="etiquette st-vert">{faits[a.id]}</span> : <span className="discret">à envoyer</span>}</td>
              <td><button onClick={() => ouvrirPrepa(a)}>Préparer…</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      {prepa && (
        <div className="voile">
          <div className="fenetre">
            <div className="entete"><h2>Mail à l'employeur — {prepa.a.nom.toUpperCase()} {prepa.a.prenom}</h2><button onClick={() => setPrepa(null)}>Fermer</button></div>
            <ChoixDestinataires destinataires={prepa.destinataires} envoi={prepa.envoi} onChange={(envoi) => maj({ envoi })} />
            {ppInclus(prepa.envoi, prepa.destinataires) && (
              <p className="alerte-texte">⚠ Le professeur principal recevra ce récapitulatif et les pièces jointes cochées : ne joignez un justificatif médical que si c'est nécessaire.</p>
            )}
            <label>Objet<input value={prepa.objet} onChange={(e) => maj({ objet: e.target.value })} /></label>
            <label>Message (modifiable)<textarea rows={16} value={prepa.corps} onChange={(e) => maj({ corps: e.target.value })} /></label>
            <h3>Pièces jointes</h3>
            {prepa.donnees.pieces.length === 0 && prepa.donnees.pieces_evenements.length === 0 && <p className="discret">Aucune pièce disponible pour ce mois.</p>}
            <ul className="pieces">
              {prepa.donnees.pieces.map((p) => (
                <li key={`s${p.id}`}><label className="case">
                  <input type="checkbox" checked={prepa.piecesSeance.includes(p.id)} onChange={(e) => maj({ piecesSeance: e.target.checked ? [...prepa.piecesSeance, p.id] : prepa.piecesSeance.filter((x) => x !== p.id) })} />
                  Feuille d'émargement signée : {p.nom_fichier} <span className="discret">({formaterTaille(p.taille)})</span>
                </label></li>
              ))}
              {prepa.donnees.pieces_evenements.map((p) => (
                <li key={`e${p.id}`}><label className="case">
                  <input type="checkbox" checked={prepa.piecesEvenement.includes(p.id)} onChange={(e) => maj({ piecesEvenement: e.target.checked ? [...prepa.piecesEvenement, p.id] : prepa.piecesEvenement.filter((x) => x !== p.id) })} />
                  Pièce d'absence : {p.nom_fichier} <span className="discret">({formaterTaille(p.taille)})</span>
                </label></li>
              ))}
            </ul>
            <div className="actions">
              <button className="principal" onClick={envoyerUn}>Ouvrir le brouillon dans Outlook</button>
              <button onClick={() => setPrepa(null)}>Annuler</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
