import { useEffect, useMemo, useState } from 'react';
import {
  appeler, documents, fichiers, type ApprentiBilan, type Bilan, type Classe, type DonneesDocument, type Etablissement,
  type Jeune, type JourCalendrier, type Journal, type Seance, type StatutRattrapage,
} from '../api';
import { aujourdhui, formaterDate, jourSemaine, NOMS_MOIS } from '../format';
import { CSS_DOCUMENT, envelopper, heuresTexte, htmlConvocation, htmlEmargement } from '../documents';

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

const STATUTS: Record<StatutRattrapage | 'aucun', { texte: string; classe: string }> = {
  a_programmer: { texte: 'À programmer', classe: 'st-rouge' },
  programme: { texte: 'Programmé', classe: 'st-bleu' },
  partiel: { texte: 'Partiellement effectué', classe: 'st-orange' },
  termine: { texte: 'Régularisé', classe: 'st-vert' },
  non_effectue: { texte: 'Non effectué / absent', classe: 'st-rouge' },
  aucun: { texte: '—', classe: '' },
};
const STATUTS_SEANCE = {
  programmee: { texte: 'Programmée', classe: 'st-bleu' },
  effectuee: { texte: 'Effectuée et validée', classe: 'st-vert' },
  non_effectuee: { texte: 'Non effectuée', classe: 'st-rouge' },
} as const;

const ACTIONS: Record<string, string> = {
  seance_programmee: 'Séance programmée', seance_modifiee: 'Séance modifiée', seance_supprimee: 'Séance supprimée',
  seance_validee: 'Séance validée', seance_non_effectuee: 'Séance non effectuée', validation_annulee: 'Validation annulée',
  convocation_generee: 'Convocation générée', emargement_genere: "Feuille d'émargement générée",
  emargement_importe: 'Feuille signée importée', emargement_supprime: 'Feuille signée supprimée', bilan_prepare: 'Bilan préparé pour l\'employeur',
};

type Mode = 'tout' | 'jour' | 'mois' | 'q1' | 'q2' | 'mois_multi' | 'perso';

export default function Rattrapages() {
  const [classes, setClasses] = useState<Classe[]>([]);
  const [jeunes, setJeunes] = useState<Jeune[]>([]);
  const [mode, setMode] = useState<Mode>('mois');
  const [jour, setJour] = useState(aujourdhui());
  const [mois, setMois] = useState(moisPrecedent());
  const [mois2, setMois2] = useState(moisPrecedent());
  const [du, setDu] = useState(`${aujourdhui().slice(0, 8)}01`);
  const [au, setAu] = useState(aujourdhui());
  const [classeId, setClasseId] = useState('');
  const [recherche, setRecherche] = useState('');
  const [bilan, setBilan] = useState<Bilan | null>(null);
  const [erreur, setErreur] = useState('');
  const [selId, setSelId] = useState<number | null>(null);

  const periode = useMemo<{ debut: string | null; fin: string | null }>(() => {
    switch (mode) {
      case 'jour': return { debut: jour, fin: jour };
      case 'mois': return { debut: `${mois}-01`, fin: dernierJour(mois) };
      case 'q1': return { debut: `${mois}-01`, fin: `${mois}-15` };
      case 'q2': return { debut: `${mois}-16`, fin: dernierJour(mois) };
      case 'mois_multi': return { debut: `${mois}-01`, fin: dernierJour(mois2 < mois ? mois : mois2) };
      case 'perso': return { debut: du || null, fin: au || null };
      default: return { debut: null, fin: null };
    }
  }, [mode, jour, mois, mois2, du, au]);

  const charger = () =>
    appeler<Bilan>('rattrapages:bilan', { ...periode, classe_id: classeId ? Number(classeId) : undefined, recherche })
      .then((b) => { setBilan(b); setErreur(''); })
      .catch((e) => setErreur(e.message));

  useEffect(() => {
    appeler<Classe[]>('classes:list').then(setClasses);
    appeler<Jeune[]>('jeunes:list').then(setJeunes);
  }, []);
  useEffect(() => { charger(); }, [periode, classeId, recherche]);

  const sel = bilan?.apprentis.find((a) => a.id === selId) ?? null;
  const t = bilan?.totaux;

  return (
    <>
      <div className="entete"><h1>Rattrapages d'heures</h1></div>
      <p className="discret">
        Seules les absences et retards <strong>irrecevables</strong> comptent. Une séance programmée ne diminue jamais le solde : il baisse uniquement quand la séance est <strong>validée</strong>.
      </p>

      <section className="fiche">
        <h2>Période et périmètre</h2>
        <div className="grille">
          <label>Période
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="tout">Toute l'année</option>
              <option value="jour">Une journée</option>
              <option value="q1">1ère quinzaine d'un mois (1er au 15)</option>
              <option value="q2">2ème quinzaine d'un mois (16 à la fin)</option>
              <option value="mois">Un mois complet</option>
              <option value="mois_multi">Plusieurs mois consécutifs</option>
              <option value="perso">Période personnalisée</option>
            </select>
          </label>
          <div>
            {mode === 'jour' && <label>Jour<input type="date" value={jour} onChange={(e) => setJour(e.target.value)} /></label>}
            {['mois', 'q1', 'q2'].includes(mode) && <label>Mois<input type="month" value={mois} onChange={(e) => e.target.value && setMois(e.target.value)} /></label>}
            {mode === 'mois_multi' && (
              <div className="creneau">
                <label>Du mois de<input type="month" value={mois} onChange={(e) => e.target.value && setMois(e.target.value)} /></label>
                <label>au mois de<input type="month" value={mois2} min={mois} onChange={(e) => e.target.value && setMois2(e.target.value)} /></label>
              </div>
            )}
            {mode === 'perso' && (
              <div className="creneau">
                <label>Du<input type="date" value={du} onChange={(e) => setDu(e.target.value)} /></label>
                <label>Au<input type="date" value={au} min={du} onChange={(e) => setAu(e.target.value)} /></label>
              </div>
            )}
          </div>
          <label>Groupe classe
            <select value={classeId} onChange={(e) => setClasseId(e.target.value)}>
              <option value="">Toutes les classes</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
            </select>
          </label>
          <label>Apprenti (nom ou prénom)
            <input value={recherche} placeholder="Rechercher…" onChange={(e) => setRecherche(e.target.value)} />
          </label>
        </div>
        {periode.debut && <p className="discret">Période affichée : du {formaterDate(periode.debut)} au {formaterDate(periode.fin ?? periode.debut)}</p>}
        {erreur && <p className="erreur">{erreur}</p>}
      </section>

      {t && (
        <div className="cartes">
          <div className="carte"><span>{t.nb_apprentis}</span>apprenti(s) concerné(s)</div>
          <div className="carte"><span>{t.nb_absences}</span>absence(s) irrecevable(s)</div>
          <div className="carte"><span>{t.nb_retards}</span>retard(s) irrecevable(s)</div>
          <div className="carte"><span>{hm(t.dues)}</span>à rattraper</div>
          <div className="carte"><span>{hm(t.programmees)}</span>programmées</div>
          <div className="carte"><span>{hm(t.validees)}</span>rattrapées et validées</div>
          <div className="carte"><span>{hm(t.solde)}</span>solde à régulariser</div>
          <div className="carte"><span>{t.sans_rattrapage}</span>sans aucun rattrapage</div>
          <div className="carte"><span>{t.regularises}</span>totalement régularisé(s)</div>
        </div>
      )}

      {bilan && (
        <table className="tableau">
          <thead>
            <tr><th>Apprenti</th><th>Classe</th><th>Abs.</th><th>Ret.</th><th>Dues</th><th>Programmées</th><th>Validées</th><th>Solde</th><th>Situation</th><th /></tr>
          </thead>
          <tbody>
            {bilan.apprentis.length === 0 && <tr><td colSpan={10} className="discret">Aucune absence ou retard irrecevable sur cette période.</td></tr>}
            {bilan.apprentis.map((a) => (
              <tr key={a.id} className={a.id === selId ? 'ligne-choisie' : ''}>
                <td><strong>{a.nom.toUpperCase()}</strong> {a.prenom}</td>
                <td>{a.classe_code}</td>
                <td>{a.nb_absences}</td><td>{a.nb_retards}</td>
                <td>{hm(a.dues)}</td><td>{hm(a.programmees)}</td><td>{hm(a.validees)}</td>
                <td><strong>{hm(a.solde)}</strong>{a.reste_a_programmer > 0 && a.solde > 0 && <div className="discret">{hm(a.reste_a_programmer)} à programmer</div>}</td>
                <td><span className={`etiquette ${STATUTS[a.statut].classe}`}>{STATUTS[a.statut].texte}</span></td>
                <td><button onClick={() => setSelId(a.id === selId ? null : a.id)}>{a.id === selId ? 'Fermer' : 'Ouvrir'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sel && <FicheRattrapage key={sel.id} apprenti={sel} jeune={jeunes.find((j) => j.id === sel.id)} periode={periode} classes={classes} apresChangement={charger} />}
    </>
  );
}

function FicheRattrapage({ apprenti, jeune, periode, classes, apresChangement }: {
  apprenti: ApprentiBilan; jeune?: Jeune; periode: { debut: string | null; fin: string | null }; classes: Classe[]; apresChangement: () => void;
}) {
  const [seances, setSeances] = useState<Seance[]>([]);
  const [journal, setJournal] = useState<Journal[]>([]);
  const [etab, setEtab] = useState<Etablissement | null>(null);
  const [cal, setCal] = useState<Map<string, JourCalendrier>>(new Map());
  const [coches, setCoches] = useState<number[]>([]);
  const [form, setForm] = useState({ date: aujourdhui(), heure_debut: '14:00', heure_fin: '16:00', salle: '' });
  const [valid, setValid] = useState<{ id: number; h: string; m: string; sans: boolean } | null>(null);
  const [erreur, setErreur] = useState('');
  const [info, setInfo] = useState('');
  const [editeur, setEditeur] = useState<null | { type: 'convocation' | 'emargement'; ids: number[]; html: string; doc: DonneesDocument }>(null);

  const recharger = async () => {
    setSeances(await appeler<Seance[]>('rattrapages:seances', apprenti.id));
    setJournal(await appeler<Journal[]>('rattrapages:historique', apprenti.id));
    apresChangement();
  };
  useEffect(() => {
    recharger();
    appeler<Etablissement>('etablissement:get').then((e) => { setEtab(e); setForm((f) => ({ ...f, salle: e.salle })); });
    appeler<JourCalendrier[]>('calendrier:annee', apprenti.classe_id).then((l) => setCal(new Map(l.map((j) => [j.date, j]))));
  }, [apprenti.id]);

  const faire = async (f: () => Promise<unknown>, ok?: string) => {
    try { await f(); setErreur(''); setInfo(ok ?? ''); await recharger(); } catch (e) { setErreur((e as Error).message); setInfo(''); }
  };

  const jourCal = cal.get(form.date);
  const periodeTexte = periode.debut ? `du ${formaterDate(periode.debut)} au ${formaterDate(periode.fin ?? periode.debut)}` : 'toute l\'année';

  async function ouvrirDocument(type: 'convocation' | 'emargement') {
    const ids = coches.length ? coches : seances.filter((s) => s.statut === 'programmee').map((s) => s.id);
    if (!ids.length) { setErreur('Programmez d\'abord une séance.'); return; }
    try {
      const doc = await appeler<DonneesDocument>('rattrapages:document', { ids });
      const html = type === 'convocation' ? htmlConvocation(doc, aujourdhui()) : htmlEmargement(doc);
      setEditeur({ type, ids, html, doc });
      setErreur('');
    } catch (e) { setErreur((e as Error).message); }
  }

  async function importer(s: Seance) {
    try {
      const r = await fichiers<{ pieces: { token: string }[]; refusees: string[] }>('choisirPieces', { scans: true });
      if (r.refusees.length) setErreur(r.refusees.join(' ; '));
      if (!r.pieces.length) return;
      const res = await fichiers<{ ajoutees: number; erreurs: string[] }>('ajouterPieces', { tokens: r.pieces.map((p) => p.token), seance_id: s.id });
      if (res.erreurs.length) setErreur(res.erreurs.join(' ; ')); else setErreur('');
      setInfo(res.ajoutees ? 'Feuille signée importée. Vous pouvez maintenant valider la séance.' : '');
      await recharger();
    } catch (e) { setErreur((e as Error).message); }
  }

  return (
    <section className="fiche">
      <h2>{apprenti.nom.toUpperCase()} {apprenti.prenom} <span className="discret">— {apprenti.classe_code}</span></h2>
      <p>
        <strong>{hm(apprenti.dues)}</strong> dues · <strong>{hm(apprenti.programmees)}</strong> programmées · <strong>{hm(apprenti.validees)}</strong> validées ·
        solde <strong>{hm(apprenti.solde)}</strong>
      </p>
      {!jeune?.adresse && <p className="discret">⚠ L'adresse de l'apprenti n'est pas renseignée (fiche Apprentis) : elle figurera vide sur la convocation.</p>}

      <h3>Programmer une séance</h3>
      <div className="creneau">
        <label>Date<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
        <label>Début<input type="time" value={form.heure_debut} onChange={(e) => setForm({ ...form, heure_debut: e.target.value })} /></label>
        <label>Fin<input type="time" value={form.heure_fin} onChange={(e) => setForm({ ...form, heure_fin: e.target.value })} /></label>
        <label>Salle<input value={form.salle} onChange={(e) => setForm({ ...form, salle: e.target.value })} /></label>
        <button className="principal" onClick={() => faire(async () => {
          await appeler('rattrapages:seance:save', { jeune_id: apprenti.id, ...form, periode_debut: periode.debut, periode_fin: periode.fin });
        }, 'Séance programmée. Elle ne diminuera le solde qu\'une fois validée.')}>Programmer</button>
      </div>
      <p className="discret">
        {jourCal && <span className={`etiquette cal-${jourCal.type}`}>{jourCal.type === 'centre' ? 'Jour de cours au centre' : jourCal.type === 'entreprise' ? 'Jour en entreprise' : (jourCal.libelle ?? 'Autre')}</span>}
        {' '}{jourSemaine(form.date)} {formaterDate(form.date)} · séance rattachée à la période : {periodeTexte}
        {jourCal?.type === 'centre' && ' · attention : la classe est en cours ce jour-là'}
        {apprenti.reste_a_programmer > 0 && ` · reste à programmer : ${hm(apprenti.reste_a_programmer)}`}
      </p>
      {erreur && <p className="erreur">{erreur}</p>}
      {info && <p className="succes">{info}</p>}

      <h3>Séances</h3>
      {seances.length === 0 ? <p className="discret">Aucune séance pour cet apprenti.</p> : (
        <>
          <div className="actions">
            <button onClick={() => ouvrirDocument('convocation')}>Convocation{coches.length ? ` (${coches.length} séance(s))` : ' (séances programmées)'}</button>
            <button onClick={() => ouvrirDocument('emargement')}>Feuille d'émargement{coches.length ? ` (${coches.length})` : ' (séances programmées)'}</button>
          </div>
          <table className="tableau">
            <thead><tr><th /><th>Date</th><th>Horaires</th><th>Durée</th><th>Salle</th><th>Statut</th><th>Validées</th><th>Feuille signée</th><th /></tr></thead>
            <tbody>
              {seances.map((s) => (
                <tr key={s.id}>
                  <td><input type="checkbox" checked={coches.includes(s.id)} onChange={(e) => setCoches(e.target.checked ? [...coches, s.id] : coches.filter((x) => x !== s.id))} /></td>
                  <td>{jourSemaine(s.date)} {formaterDate(s.date)}{s.convocation_le && <div className="discret">convoqué le {s.convocation_le.slice(0, 10).split('-').reverse().join('/')}</div>}</td>
                  <td>{s.heure_debut} → {s.heure_fin}</td>
                  <td>{hm(s.duree_minutes)}</td>
                  <td>{s.salle}</td>
                  <td><span className={`etiquette ${STATUTS_SEANCE[s.statut].classe}`}>{STATUTS_SEANCE[s.statut].texte}</span></td>
                  <td>{s.statut === 'effectuee' ? hm(s.duree_validee_minutes ?? s.duree_minutes) : '—'}</td>
                  <td>
                    {s.pieces.map((p) => (
                      <button key={p.id} type="button" className="piece-lien" onClick={() => fichiers('ouvrirPiece', { id: p.id, rattrapage: true }).catch((e) => setErreur(e.message))}>📎 {p.nom_fichier}</button>
                    ))}
                    {s.pieces.length === 0 && <span className="discret">aucune</span>}
                  </td>
                  <td>
                    {s.statut === 'programmee' && (
                      <>
                        <button onClick={() => importer(s)}>Importer la feuille signée</button>
                        <button className="principal" onClick={() => setValid({ id: s.id, h: String(Math.floor(s.duree_minutes / 60)), m: String(s.duree_minutes % 60), sans: false })}>Valider…</button>
                        <button onClick={() => faire(() => appeler('rattrapages:valider', { id: s.id, statut: 'non_effectuee' }))} title="L'apprenti était absent ou la séance n'a pas eu lieu">Non effectuée</button>
                        <button className="danger" onClick={() => { if (confirm('Supprimer cette séance programmée ?')) faire(() => appeler('rattrapages:seance:delete', s.id)); }}>Supprimer</button>
                      </>
                    )}
                    {s.statut !== 'programmee' && (
                      <button onClick={() => { if (confirm('Annuler la validation ? Le solde sera recalculé.')) faire(() => appeler('rattrapages:annuler-validation', s.id)); }}>Annuler la validation</button>
                    )}
                    {valid?.id === s.id && (
                      <div className="periode">
                        <strong>Valider cette séance comme effectuée</strong>
                        <p className="discret">Programmée : {hm(s.duree_minutes)}. Si l'apprenti est parti plus tôt, modifiez les heures réellement effectuées.</p>
                        <div className="creneau">
                          <label>Heures<input type="number" min="0" value={valid.h} onChange={(e) => setValid({ ...valid, h: e.target.value })} /></label>
                          <label>Minutes<input type="number" min="0" max="59" value={valid.m} onChange={(e) => setValid({ ...valid, m: e.target.value })} /></label>
                        </div>
                        {s.pieces.length === 0 && (
                          <label className="case"><input type="checkbox" checked={valid.sans} onChange={(e) => setValid({ ...valid, sans: e.target.checked })} /> Valider sans feuille signée (non recommandé)</label>
                        )}
                        <div className="actions">
                          <button className="principal" onClick={() => faire(async () => {
                            await appeler('rattrapages:valider', { id: s.id, statut: 'effectuee', duree_validee_minutes: Number(valid.h) * 60 + Number(valid.m), sans_justificatif: valid.sans });
                            setValid(null);
                          }, 'Séance validée : le solde a été mis à jour.')}>Valider</button>
                          <button onClick={() => setValid(null)}>Annuler</button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>Historique</h3>
      {journal.length === 0 ? <p className="discret">Rien pour l'instant.</p> : (
        <ul className="pieces">
          {journal.map((j) => (
            <li key={j.id}><span>{ACTIONS[j.action] ?? j.action}{j.detail && <span className="discret"> — {j.detail}</span>}</span><span className="discret">{j.quand}</span></li>
          ))}
        </ul>
      )}

      {editeur && etab && (
        <EditeurDocument
          titre={editeur.type === 'convocation' ? 'Convocation de rattrapage' : "Feuille d'émargement"}
          html={editeur.html}
          nom={`${editeur.type === 'convocation' ? 'Convocation' : 'Emargement'}_Rattrapage_${apprenti.nom}_${apprenti.prenom}`}
          mail={editeur.type === 'convocation' ? {
            a: jeune?.email ?? '',
            objet: `Convocation – rattrapage d'heures du ${formaterDate(editeur.doc.seances[0].date)}`,
            corps: `Bonjour,\n\nVeuillez trouver ci-joint votre convocation à une séance de rattrapage d'heures (${heuresTexte(editeur.doc.seances.reduce((t, s) => t + s.duree_minutes, 0))}).\n\nCordialement,\n${etab.signataire}\n${etab.fonction}`,
          } : undefined}
          apres={(action) => faire(() => appeler(action === 'convocation' ? 'rattrapages:convoque' : 'rattrapages:emarge', { ids: editeur.ids }))}
          type={editeur.type}
          onClose={() => setEditeur(null)}
        />
      )}
      {classes.length === 0 && null}
    </section>
  );
}

function EditeurDocument({ titre, html, nom, mail, apres, type, onClose }: {
  titre: string; html: string; nom: string; type: 'convocation' | 'emargement';
  mail?: { a: string; objet: string; corps: string }; apres: (a: 'convocation' | 'emargement') => void; onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState('');
  const lire = () => (document.getElementById('doc-edition')?.innerHTML ?? html);

  async function pdf() {
    try {
      const r = await documents<{ annule?: boolean; chemin?: string }>('pdf', { html: envelopper(lire()), nom });
      if (r.annule) return;
      setMessage(`PDF enregistré : ${r.chemin}`); setErreur('');
      apres(type);
    } catch (e) { setErreur((e as Error).message); }
  }
  async function envoyer() {
    if (!mail) return;
    try {
      const r = await documents<{ methode: string; raison?: string; nbPieces?: number }>('courriel', { html: envelopper(lire()), nom, ...mail });
      setMessage(r.methode === 'outlook'
        ? 'Brouillon ouvert dans Outlook avec la convocation en pièce jointe. Relisez-le puis envoyez-le vous-même.'
        : `Outlook n'a pas pu être piloté (${r.raison}). Un message a été ouvert ; glissez-y le PDF du dossier qui vient de s'ouvrir.`);
      setErreur('');
      apres(type);
    } catch (e) { setErreur((e as Error).message); }
  }

  return (
    <div className="voile">
      <div className="fenetre">
        <div className="entete">
          <h2>{titre}</h2>
          <button onClick={onClose}>Fermer</button>
        </div>
        <p className="discret">Le document est modifiable directement : cliquez dans le texte pour corriger avant l'enregistrement.</p>
        <div className="actions">
          <button className="principal" onClick={pdf}>Enregistrer en PDF</button>
          {mail && <button onClick={envoyer}>Envoyer à l'apprenti par Outlook{mail.a ? '' : ' (adresse à saisir)'}</button>}
        </div>
        {message && <p className="succes">{message}</p>}
        {erreur && <p className="erreur">{erreur}</p>}
        <div className="zone-doc">
          <style>{CSS_DOCUMENT}</style>
          <div id="doc-edition" contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}
