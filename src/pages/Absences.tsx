import { useEffect, useState, type FormEvent } from 'react';
import ChoixDestinataires, { adressesInvalides, envoiParDefaut, ppInclus, repartition, toutesAdresses, type Envoi } from '../ChoixDestinataires';
import {
  appeler, courriel, fichiers,
  type Apercu, type Classe, type Creneau, type Destinataire, type Horaires, type JourCalendrier, type Evenement, type FiltresEvenements, type Jeune, type Motif, type Piece, type PieceChoisie, type ResultatCourriel,
} from '../api';
import { ajouterJours, aujourdhui, enMinutes, estWeekEnd, formaterDate, formaterDuree, formaterTaille, jourSemaine } from '../format';

type Fiche = {
  id?: number;
  jeune_id: number;
  type: 'absence' | 'retard';
  creneaux: Creneau[];
  motif_id: number | null;
  observations: string;
  mail_copie: string;
};

type Notif = {
  evenement: Evenement;
  apercu: Apercu;
  pieces: Piece[];
  choisies: number[];
  destinataires: Destinataire[];
  envoi: Envoi;
  resultat?: ResultatCourriel;
};

function parJour(creneaux: Creneau[]): [string, Creneau[]][] {
  const m = new Map<string, Creneau[]>();
  for (const c of creneaux) m.set(c.date, [...(m.get(c.date) ?? []), c]);
  return [...m.entries()];
}

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
  const [notif, setNotif] = useState<Notif | null>(null);
  const [calendrier, setCalendrier] = useState<Map<string, JourCalendrier>>(new Map());
  const classeFiche = apprentis.find((a) => a.id === fiche?.jeune_id)?.classe_id;
  useEffect(() => {
    if (classeFiche) appeler<JourCalendrier[]>('calendrier:annee', classeFiche).then((l) => setCalendrier(new Map(l.map((j) => [j.date, j]))));
    else setCalendrier(new Map());
  }, [classeFiche]);
  const [horairesDefaut, setHorairesDefaut] = useState<Horaires | null>(null);
  const [periode, setPeriode] = useState<{ du: string; au: string; h: Horaires; pause: boolean; weekend: boolean } | null>(null);

  const charger = () => appeler<Evenement[]>('evenements:list', filtres).then(setListe);
  useEffect(() => {
    appeler<Classe[]>('classes:list').then(setClasses);
    appeler<Jeune[]>('jeunes:list', { tous: true }).then(setApprentis);
    appeler<Motif[]>('motifs:list').then(setMotifs);
    appeler<Horaires>('horaires:get').then(setHorairesDefaut);
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
      jeune_id: filtres.jeune_id ?? 0, type: 'absence', creneaux: [{ date: aujourdhui(), heure_debut: '', heure_fin: '' }], motif_id: null, observations: '', mail_copie: '',
    });
  }

  async function modifier(e: Evenement) {
    setErreur(''); setInfo(''); setNouvelles([]);
    setExistantes(await appeler<Piece[]>('pieces:list', e.id));
    setFiche({
      id: e.id, jeune_id: e.jeune_id, type: e.type,
      // anciennes saisies sans horaires : on propose la date, les heures sont à compléter
      creneaux: e.creneaux.length
        ? e.creneaux.map(({ date, heure_debut, heure_fin }) => ({ date, heure_debut, heure_fin }))
        : [{ date: e.date_debut, heure_debut: '', heure_fin: '' }],
      motif_id: e.motif_id,
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
        id: fiche.id, jeune_id: fiche.jeune_id, type: fiche.type, creneaux: fiche.creneaux,
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

  async function preparerNotification(e: Evenement) {
    setErreur(''); setInfo(''); setFiche(null);
    try {
      const [apercu, pieces, destinataires] = await Promise.all([
        courriel<Apercu>('apercu', { id: e.id }),
        appeler<Piece[]>('pieces:list', e.id),
        appeler<Destinataire[]>('destinataires:list', { jeune_id: e.jeune_id, date: e.date_debut }),
      ]);
      // par défaut : le maître d'apprentissage, sinon l'entreprise ; le professeur principal est seulement proposé
      setNotif({ evenement: e, apercu, pieces, choisies: [], destinataires, envoi: envoiParDefaut(destinataires) });
    } catch (err) {
      setInfo((err as Error).message);
    }
  }

  async function ouvrirDansOutlook() {
    if (!notif) return;
    const invalides = adressesInvalides(notif.envoi);
    if (invalides.length) { setInfo(`Adresse(s) invalide(s) : ${invalides.join(', ')}`); return; }
    try {
      const resultat = await courriel<ResultatCourriel>('ouvrir', { id: notif.evenement.id, piece_ids: notif.choisies, envoi: repartition(notif.envoi) });
      setNotif({ ...notif, resultat });
    } catch (err) {
      setInfo((err as Error).message);
    }
  }

  async function confirmerEnvoi() {
    if (!notif) return;
    await appeler('evenements:notifier', { ids: [notif.evenement.id], notifie: true });
    setNotif(null);
    charger();
  }

  const dureeCreneau = (c: Creneau) => (c.heure_debut && c.heure_fin ? enMinutes(c.heure_fin) - enMinutes(c.heure_debut) : null);
  const dureeTotale = fiche ? fiche.creneaux.reduce((t, c) => t + Math.max(dureeCreneau(c) ?? 0, 0), 0) : 0;
  const majCreneau = (i: number, champ: keyof Creneau, valeur: string) =>
    setFiche((f) => f && { ...f, creneaux: f.creneaux.map((c, k) => (k === i ? { ...c, [champ]: valeur } : c)) });
  function ajouterCreneau() {
    if (!fiche) return;
    const dernier = fiche.creneaux[fiche.creneaux.length - 1];
    // même horaire, jour suivant : il suffit en général d'ajuster la date
    setFiche({ ...fiche, creneaux: [...fiche.creneaux, { date: dernier?.date ? ajouterJours(dernier.date, 1) : aujourdhui(), heure_debut: dernier?.heure_debut ?? '', heure_fin: dernier?.heure_fin ?? '' }] });
  }

  function ouvrirPeriode() {
    if (!fiche || !horairesDefaut) return;
    const d = fiche.creneaux[0]?.date || aujourdhui();
    setPeriode({ du: d, au: d, h: { ...horairesDefaut }, pause: true, weekend: false });
  }

  function genererPeriode() {
    if (!fiche || !periode) return;
    const { du, au, h, pause, weekend } = periode;
    if (!du || !au || au < du) { setErreur('La date de fin doit être le même jour ou après la date de début.'); return; }
    if (!(h.debut < h.pause_debut && h.pause_debut < h.pause_fin && h.pause_fin < h.fin)) {
      setErreur('Les heures de la journée doivent se suivre : début, début de pause, fin de pause, fin.'); return;
    }
    const lignes: Creneau[] = [];
    for (let jour = du, n = 0; jour <= au && n < 120; jour = ajouterJours(jour, 1), n++) {
      if (!weekend && estWeekEnd(jour)) continue;
      if (pause) {
        lignes.push({ date: jour, heure_debut: h.debut, heure_fin: h.pause_debut });
        lignes.push({ date: jour, heure_debut: h.pause_fin, heure_fin: h.fin });
      } else {
        lignes.push({ date: jour, heure_debut: h.debut, heure_fin: h.fin });
      }
    }
    if (!lignes.length) { setErreur('Cette période ne contient que des week-ends : cochez « inclure les samedis et dimanches » si besoin.'); return; }
    // on remplace les lignes encore vides, on garde celles déjà remplies
    const gardees = fiche.creneaux.filter((c) => c.heure_debut && c.heure_fin);
    setFiche({ ...fiche, creneaux: [...gardees, ...lignes] });
    setPeriode(null); setErreur('');
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

      {notif && (
        <section className="fiche">
          <h2>Notifier l'entreprise : {notif.evenement.jeune_prenom} {notif.evenement.jeune_nom}</h2>
          {!notif.resultat && (
            <>
              <ChoixDestinataires destinataires={notif.destinataires} envoi={notif.envoi} onChange={(envoi) => setNotif({ ...notif, envoi })} />
              {ppInclus(notif.envoi, notif.destinataires) && (
                <p className="alerte-texte">⚠ Le professeur principal recevra le message complet, motif compris{notif.choisies.length ? ', et les pièces jointes cochées' : ''}. Un certificat médical est une donnée de santé : ne le transmettez que si c'est nécessaire.</p>
              )}
            </>
          )}
          {notif.resultat && <p><strong>Destinataires :</strong> {toutesAdresses(notif.envoi).join('; ') || '(saisis dans Outlook)'}</p>}
          <p><strong>Objet :</strong> {notif.apercu.objet}</p>
          <pre className="apercu">{notif.apercu.corps}</pre>
          <p className="discret">Le message s'ouvre dans Outlook : relisez-le, modifiez-le si besoin, puis envoyez-le vous-même.</p>

          {!notif.resultat && (
            <>
              <h3>Pièces jointes à envoyer</h3>
              {notif.pieces.length === 0 ? (
                <p className="discret">Aucune pièce jointe enregistrée pour cette absence.</p>
              ) : (
                <>
                  <p className="discret">Aucune n'est cochée par défaut : un certificat médical ne doit pas partir chez l'employeur par erreur.</p>
                  <ul className="pieces">
                    {notif.pieces.map((p) => (
                      <li key={p.id}>
                        <label className="case">
                          <input type="checkbox" checked={notif.choisies.includes(p.id)}
                            onChange={(ev) => setNotif({ ...notif, choisies: ev.target.checked ? [...notif.choisies, p.id] : notif.choisies.filter((x) => x !== p.id) })} />
                          {p.nom_fichier} <span className="discret">({formaterTaille(p.taille)})</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="actions">
                <button className="principal" onClick={ouvrirDansOutlook}>Préparer le mail dans Outlook</button>
                <button onClick={() => setNotif(null)}>Annuler</button>
              </div>
            </>
          )}

          {notif.resultat && (
            <>
              {notif.resultat.methode === 'outlook' ? (
                <p className="succes">Le mail est ouvert dans Outlook. Relisez-le et envoyez-le.</p>
              ) : (
                <p className="erreur">
                  Outlook n'a pas pu préparer le mail avec ses pièces jointes ({notif.resultat.raison}). Un nouveau message s'est ouvert avec le texte
                  {notif.resultat.nbPieces ? ' ; le dossier des pièces jointes s\'est ouvert : glissez-les dans le message.' : '.'}
                </p>
              )}
              <p><strong>L'avez-vous envoyé ?</strong></p>
              <div className="actions">
                <button className="principal" onClick={confirmerEnvoi}>Oui, marquer l'entreprise comme notifiée</button>
                <button onClick={() => setNotif(null)}>Pas encore</button>
              </div>
            </>
          )}
        </section>
      )}

      {fiche && (
        <form className="fiche" onSubmit={enregistrer}>
          <h2>{fiche.id ? 'Modifier' : 'Nouvelle absence ou nouveau retard'}</h2>
          {apprentis.filter((a) => !a.sorti).length === 0 && <p className="erreur">Ajoutez d'abord un apprenti dans la section Apprentis.</p>}
          <div className="grille">
            <label>Apprenti *
              <select required value={fiche.jeune_id || ''} onChange={(e) => setFiche({ ...fiche, jeune_id: Number(e.target.value) })}>
                <option value="" disabled>Choisir…</option>
                {classes.map((c) => (
                  <optgroup key={c.id} label={c.code}>
                    {apprentis.filter((a) => a.classe_id === c.id && !a.sorti).map((a) => <option key={a.id} value={a.id}>{a.nom} {a.prenom}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>Type *
              <select value={fiche.type} onChange={(e) => { const type = e.target.value as Fiche['type']; setFiche({ ...fiche, type, creneaux: type === 'retard' ? fiche.creneaux.slice(0, 1) : fiche.creneaux }); }}>
                <option value="absence">Absence</option>
                <option value="retard">Retard</option>
              </select>
            </label>
            <label>Motif
              <select value={fiche.motif_id ?? ''} onChange={(e) => setFiche({ ...fiche, motif_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Pas encore connu (à traiter)</option>
                {motifs.map((m) => <option key={m.id} value={m.id}>{m.libelle} — {m.statut === 'recevable' ? 'recevable' : 'irrecevable'}</option>)}
              </select>
              {statutMotif && <span className={`etiquette ${statutMotif}`} style={{ alignSelf: 'flex-start' }}>{statutMotif === 'recevable' ? 'Recevable' : 'Irrecevable'}</span>}
            </label>
          </div>

          <h3>{fiche.type === 'absence' ? "Créneaux d'absence" : 'Retard'}</h3>
          {fiche.type === 'absence' && (
            periode ? (
              <div className="periode">
                <strong>Journée complète ou plusieurs jours (même motif)</strong>
                <div className="creneau">
                  <label>Du<input type="date" value={periode.du} onChange={(e) => setPeriode({ ...periode, du: e.target.value, au: periode.au < e.target.value ? e.target.value : periode.au })} /></label>
                  <label>Au (inclus)<input type="date" value={periode.au} min={periode.du} onChange={(e) => setPeriode({ ...periode, au: e.target.value })} /></label>
                </div>
                <div className="creneau">
                  <label>Début de journée<input type="time" value={periode.h.debut} onChange={(e) => setPeriode({ ...periode, h: { ...periode.h, debut: e.target.value } })} /></label>
                  <label>Début de pause<input type="time" value={periode.h.pause_debut} disabled={!periode.pause} onChange={(e) => setPeriode({ ...periode, h: { ...periode.h, pause_debut: e.target.value } })} /></label>
                  <label>Fin de pause<input type="time" value={periode.h.pause_fin} disabled={!periode.pause} onChange={(e) => setPeriode({ ...periode, h: { ...periode.h, pause_fin: e.target.value } })} /></label>
                  <label>Fin de journée<input type="time" value={periode.h.fin} onChange={(e) => setPeriode({ ...periode, h: { ...periode.h, fin: e.target.value } })} /></label>
                </div>
                <label className="case"><input type="checkbox" checked={periode.pause} onChange={(e) => setPeriode({ ...periode, pause: e.target.checked })} /> Ne pas compter la pause déjeuner (matin et après-midi séparés)</label>
                <label className="case"><input type="checkbox" checked={periode.weekend} onChange={(e) => setPeriode({ ...periode, weekend: e.target.checked })} /> Inclure les samedis et dimanches</label>
                <p className="discret">Les jours fériés ne sont pas retirés automatiquement : supprimez les créneaux concernés si besoin.</p>
                <div className="actions">
                  <button type="button" className="principal" onClick={genererPeriode}>Remplir les créneaux</button>
                  <button type="button" onClick={() => setPeriode(null)}>Annuler</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={ouvrirPeriode}>Journée complète / plusieurs jours…</button>
            )
          )}
          {fiche.creneaux.map((c, i) => {
            const d = dureeCreneau(c);
            const retard = fiche.type === 'retard';
            return (
              <div className="creneau" key={i}>
                <label>Date *<input type="date" required value={c.date} onChange={(e) => majCreneau(i, 'date', e.target.value)} /></label>
                <label>{retard ? 'Début du cours *' : 'De *'}<input type="time" required value={c.heure_debut} onChange={(e) => majCreneau(i, 'heure_debut', e.target.value)} /></label>
                <label>{retard ? 'Arrivée *' : 'À *'}<input type="time" required value={c.heure_fin} onChange={(e) => majCreneau(i, 'heure_fin', e.target.value)} /></label>
                {calendrier.get(c.date) && (
                  <span className={`etiquette cal-${calendrier.get(c.date)!.type}`} title="Selon le calendrier d'alternance de la classe">
                    {calendrier.get(c.date)!.type === 'centre' ? 'Centre' : calendrier.get(c.date)!.type === 'entreprise' ? 'Entreprise' : (calendrier.get(c.date)!.libelle ?? 'Autre')}
                  </span>
                )}
                <span className="calcule">
                  {d === null ? '—' : d <= 0 ? <span className="erreur">fin avant le début</span> : <>= <strong>{formaterDuree(d)}</strong></>}
                </span>
                {!retard && fiche.creneaux.length > 1 && (
                  <button type="button" onClick={() => setFiche({ ...fiche, creneaux: fiche.creneaux.filter((_, k) => k !== i) })}>Retirer</button>
                )}
              </div>
            );
          })}
          {fiche.type === 'absence' && <button type="button" onClick={ajouterCreneau}>Ajouter un créneau (autre jour ou autre horaire)</button>}
          <p className="total">
            {fiche.type === 'absence' ? "Durée totale d'absence" : 'Durée du retard'} : <strong>{dureeTotale ? formaterDuree(dureeTotale) : '—'}</strong>{' '}
            <span className="discret">(calculée automatiquement)</span>
          </p>

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
            <tr><th>Créneau(x)</th><th>Apprenti</th><th>Durée totale</th><th>Motif</th><th>Entreprise notifiée</th><th></th></tr>
          </thead>
          <tbody>
            {liste.map((e) => (
              <tr key={e.id}>
                <td>
                  <div className="discret">{e.type === 'absence' ? 'Absence' : 'Retard'}</div>
                  {e.creneaux.length ? (
                    parJour(e.creneaux).map(([date, cs]) => (
                      <div key={date} style={{ whiteSpace: 'nowrap' }}>
                        {jourSemaine(date)} {formaterDate(date)} · {cs.map((c) => `${c.heure_debut} → ${c.heure_fin}`).join(' · ')}{e.type === 'retard' ? ' (arrivée)' : ''}
                      </div>
                    ))
                  ) : (
                    <>{formaterDate(e.date_debut)}{e.date_fin && e.date_fin !== e.date_debut && <> → {formaterDate(e.date_fin)}</>}</>
                  )}
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
                  {e.pieces.length > 0 && (
                    <div>
                      {e.pieces.map((p) => (
                        <button key={p.id} type="button" className="piece-lien" title={`Ouvrir ${p.nom_fichier} (${formaterTaille(p.taille)})`}
                          onClick={() => fichiers('ouvrirPiece', { id: p.id }).catch((err) => setInfo(err.message))}>
                          📎 {p.nom_fichier}
                        </button>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  {e.notifie_le ? <>✓ le {formaterDate(e.notifie_le.slice(0, 10))}</> : <span className="discret">non</span>}
                  <div>
                    <button className="petit" onClick={() => preparerNotification(e)}>Notifier par mail…</button>
                    <button className="petit" onClick={() => basculerNotifie(e)}>{e.notifie_le ? 'Retirer' : 'Marquer notifiée'}</button>
                  </div>
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
