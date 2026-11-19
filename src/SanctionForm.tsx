import { useEffect, useState } from 'react';
import {
  appeler, documents, fichiers, NOMS_COMMUNICATION, NOMS_DECISION,
  type Decision, type Destinataire, type Etablissement, type Intervenant, type Jeune, type MotifSanction, type Palier,
  type Proposition, type ResultatCourriel, type Sanction, type SanctionDetail,
} from './api';
import ChoixDestinataires, { adressesInvalides, repartition, ppInclus, type Envoi } from './ChoixDestinataires';
import { aujourdhui, formaterDate, formaterDateHeure, formaterTaille } from './format';
import { corpsSanction, sujetSanction } from './discipline';
import CommissionForm from './CommissionForm';

const VIDE = (jeuneId: number): Sanction => ({
  jeune_id: jeuneId, date_faits: aujourdhui(), motif_id: 0, decision: 'en_attente', palier_retenu_id: null,
  justification: '', description: '', observations: '', date_decision: null, duree: '', intervenant_id: null, observations_apprenti: '', contestation: '',
});

type Notif = { destinataires: Destinataire[]; envoi: Envoi; objet: string; corps: string; pieces: number[]; mineur: boolean; manquant: boolean };

// Fenêtre de saisie / consultation d'une sanction. À placer en dehors de tout autre <form>.
export default function SanctionForm({ jeuneId, sanctionId, apprentis, onClose, onChange, ouvrirApprenti }: {
  jeuneId?: number; sanctionId?: number | null; apprentis: Jeune[]; onClose: () => void; onChange: () => void;
  ouvrirApprenti?: (id: number) => void;
}) {
  const [s, setS] = useState<Sanction>(VIDE(jeuneId ?? 0));
  const [detail, setDetail] = useState<SanctionDetail | null>(null);
  const [motifs, setMotifs] = useState<MotifSanction[]>([]);
  const [paliers, setPaliers] = useState<Palier[]>([]);
  const [intervenants, setIntervenants] = useState<Intervenant[]>([]);
  const [prop, setProp] = useState<Proposition | null>(null);
  const [erreur, setErreur] = useState('');
  const [info, setInfo] = useState('');
  const [notif, setNotif] = useState<Notif | null>(null);
  const [id, setId] = useState<number | null>(sanctionId ?? null);
  const [commission, setCommission] = useState(false);
  const [liees, setLiees] = useState<{ id: number; date: string | null; statut: string }[]>([]);

  const cloture = detail?.statut === 'cloturee';
  const apprenti = apprentis.find((a) => a.id === s.jeune_id);

  async function recharger(sid: number) {
    const d = await appeler<SanctionDetail>('sanctions:get', sid);
    setDetail(d);
    setS({ ...d });
  }
  useEffect(() => {
    appeler<MotifSanction[]>('sanctions:motifs').then(setMotifs);
    appeler<Palier[]>('paliers:list').then(setPaliers);
    appeler<Intervenant[]>('intervenants:list').then(setIntervenants);
  }, []);
  useEffect(() => {
    if (id) appeler<any[]>('commissions:list', {}).then((l) => setLiees(l.filter((c) => c.sanction_id === id))).catch(() => {});
  }, [id, commission]);
  useEffect(() => { if (id) recharger(id).catch((e) => setErreur((e as Error).message)); }, [id]);

  // Proposition recalculée dès que l'apprenti, le motif ou la date des faits changent.
  useEffect(() => {
    if (!s.jeune_id || !s.motif_id || !s.date_faits) { setProp(null); return; }
    appeler<Proposition>('sanctions:proposer', { jeune_id: s.jeune_id, motif_id: s.motif_id, date_faits: s.date_faits, sanction_id: id ?? 0 })
      .then(setProp).catch(() => setProp(null));
  }, [s.jeune_id, s.motif_id, s.date_faits, id]);

  const maj = (patch: Partial<Sanction>) => setS((x) => ({ ...x, ...patch }));
  const differe = s.decision === 'sanction' && prop && s.palier_retenu_id !== null && s.palier_retenu_id !== (detail?.palier_propose_id ?? prop.palier_id);

  function choisirDecision(d: Decision) {
    maj({ decision: d, palier_retenu_id: d === 'sanction' ? (s.palier_retenu_id ?? prop?.palier_id ?? null) : null, date_decision: d === 'en_attente' ? null : (s.date_decision ?? aujourdhui()) });
  }

  async function enregistrer() {
    setErreur(''); setInfo('');
    try {
      const nouveau = !id;
      const sid = await appeler<number>('sanctions:save', { ...s, id: id ?? undefined });
      onChange();
      setId(sid);
      await recharger(sid);
      setInfo(nouveau ? "Enregistré. Vous pouvez maintenant ajouter des pièces et préparer la communication." : 'Modifications enregistrées.');
    } catch (e) { setErreur((e as Error).message); }
  }
  async function action(nom: 'sanctions:cloturer' | 'sanctions:rouvrir') {
    if (!id) return;
    setErreur(''); setInfo('');
    try { await appeler(nom, id); await recharger(id); onChange(); } catch (e) { setErreur((e as Error).message); }
  }
  async function supprimer() {
    if (!id || !confirm('Supprimer cette saisie ? (possible seulement tant qu\'aucune décision, pièce ou communication n\'existe)')) return;
    try { await appeler('sanctions:supprimer', id); onChange(); onClose(); } catch (e) { setErreur((e as Error).message); }
  }

  async function ajouterPieces() {
    if (!id) return;
    try {
      const r = await fichiers<{ pieces: { token: string }[]; refusees: string[] }>('choisirPieces');
      if (r.refusees.length) setErreur(`Refusé : ${r.refusees.join(' ; ')}`);
      if (r.pieces.length) {
        const res = await fichiers<{ erreurs: string[] }>('ajouterPieces', { tokens: r.pieces.map((p) => p.token), sanction_id: id });
        if (res.erreurs.length) setErreur(res.erreurs.join(' ; '));
        await recharger(id);
      }
    } catch (e) { setErreur((e as Error).message); }
  }
  async function retirerPiece(pid: number) {
    try { await appeler('sanctions:piece:supprimer', pid); if (id) await recharger(id); } catch (e) { setErreur((e as Error).message); }
  }

  async function preparerNotification() {
    if (!id || !detail) return;
    setErreur(''); setInfo('');
    try {
      const [{ destinataires, mineur, representant_manquant }, etab] = await Promise.all([
        appeler<{ destinataires: Destinataire[]; mineur: boolean; representant_manquant: boolean }>('sanctions:destinataires', id),
        appeler<Etablissement>('etablissement:get'),
      ]);
      // Employeur (maître sinon entreprise) en « À » si la communication est prévue ; professeur principal et représentant légal en copie.
      const choix: Envoi['choix'] = {};
      const employeur = destinataires.find((d) => d.cle === 'maitre') ?? destinataires.find((d) => d.cle === 'entreprise');
      const pp = destinataires.find((d) => d.role === 'pp');
      const rep = destinataires.find((d) => d.role === 'representant');
      if (detail.communication !== 'non' && employeur?.email) choix[employeur.email] = 'a';
      if (pp?.email) choix[pp.email] = choix[employeur?.email ?? ''] ? 'cc' : 'a';
      if (rep?.email) choix[rep.email] = 'cc';
      setNotif({
        destinataires, mineur, manquant: representant_manquant, pieces: [],
        envoi: { choix, autres: { a: '', cc: '', cci: '' } },
        objet: sujetSanction(detail.jeune_nom ?? '', detail.jeune_prenom ?? '', detail),
        corps: corpsSanction(detail.jeune_nom ?? '', detail.jeune_prenom ?? '', detail.classe_code ?? '', detail, etab),
      });
    } catch (e) { setErreur((e as Error).message); }
  }
  async function ouvrirBrouillon() {
    if (!notif || !id || !detail) return;
    const invalides = adressesInvalides(notif.envoi);
    if (invalides.length) { setErreur(`Adresse(s) invalide(s) : ${invalides.join(', ')}`); return; }
    const rep = repartition(notif.envoi);
    if (!rep.a.length && !rep.cc.length && !rep.cci.length) { setErreur('Choisissez au moins un destinataire.'); return; }
    try {
      const r = await documents<ResultatCourriel>('courriel', { ...rep, objet: notif.objet, corps: notif.corps, piece_sanction_ids: notif.pieces });
      await appeler('sanctions:communication:archiver', {
        sanction_id: id, ...rep, objet: notif.objet, corps: notif.corps, methode: r.methode,
        pieces: detail.pieces.filter((p) => notif.pieces.includes(p.id)).map((p) => p.nom_fichier).join(', '),
      });
      setInfo(r.methode === 'outlook' ? 'Brouillon ouvert dans Outlook et archivé dans le dossier. Relisez-le puis envoyez-le vous-même.' : `Outlook n'a pas pu être piloté (${r.raison}). Un message a été ouvert et archivé ; glissez-y les pièces.`);
      setNotif(null); onChange(); await recharger(id);
    } catch (e) { setErreur((e as Error).message); }
  }

  const motifsChoisissables = motifs.filter((m) => m.actif || m.id === s.motif_id);
  const nomApprenti = apprenti ? `${apprenti.nom.toUpperCase()} ${apprenti.prenom}` : detail ? `${detail.jeune_nom?.toUpperCase()} ${detail.jeune_prenom}` : '';

  return (
    <div className="voile">
      <div className="fenetre large">
        <div className="entete">
          <h2>{id ? `Sanction — ${nomApprenti}` : 'Nouvelle sanction'} {cloture && <span className="etiquette st-orange">Dossier clôturé</span>}</h2>
          <button type="button" onClick={onClose}>Fermer</button>
        </div>
        {cloture && <p className="discret">Dossier clôturé le {formaterDate(detail!.cloture_le!)} : consultable, non modifiable. Rouvrez-le pour le modifier.</p>}

        <fieldset disabled={cloture} className="sans-cadre">
          <div className="grille">
            <label>Apprenti *
              <select value={s.jeune_id || ''} disabled={!!id || !!jeuneId} onChange={(e) => maj({ jeune_id: Number(e.target.value) })}>
                <option value="">Choisir…</option>
                {apprentis.filter((a) => !a.sorti || a.id === s.jeune_id).map((a) => <option key={a.id} value={a.id}>{a.nom.toUpperCase()} {a.prenom} — {a.classe_code}</option>)}
              </select>
            </label>
            <label>Date des faits *<input type="date" max={aujourdhui()} value={s.date_faits} onChange={(e) => maj({ date_faits: e.target.value })} /></label>
            <label>Motif *
              <select value={s.motif_id || ''} onChange={(e) => maj({ motif_id: Number(e.target.value) })}>
                <option value="">Choisir…</option>
                {motifsChoisissables.map((m) => <option key={m.id} value={m.id}>{m.intitule}{m.actif ? '' : ' (désactivé)'}</option>)}
              </select>
            </label>
            <label>Responsable de l'enregistrement
              <select value={s.intervenant_id ?? ''} onChange={(e) => maj({ intervenant_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Non précisé</option>
                {intervenants.filter((i) => i.actif || i.id === s.intervenant_id).map((i) => <option key={i.id} value={i.id}>{i.nom}{i.fonction ? ` — ${i.fonction}` : ''}</option>)}
              </select>
            </label>
          </div>
          <label>Description des faits constatés<textarea rows={3} value={s.description ?? ''} onChange={(e) => maj({ description: e.target.value })} /></label>
          <label>Observations<textarea rows={2} value={s.observations ?? ''} onChange={(e) => maj({ observations: e.target.value })} /></label>

          {prop && (
            <div className="bloc-proposition">
              <strong>Palier proposé : {prop.ordre} — {prop.libelle}</strong>
              <span className="discret"> (simple proposition : la décision vous appartient)</span>
              <ul>{prop.raisons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              {prop.precedentes.length > 0 && (
                <details>
                  <summary>Sanctions antérieures ({prop.precedentes.length})</summary>
                  <ul>
                    {prop.precedentes.map((p) => (
                      <li key={p.id} className={p.dans_periode ? '' : 'discret'}>
                        {formaterDate(p.date_faits)} — {p.motif} — palier {p.ordre} ({p.palier}) {p.dans_periode ? '' : `· plus de ${prop.mois} mois : non prise en compte`}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          <h3>Décision</h3>
          <div className="choix-decision">
            {(Object.keys(NOMS_DECISION) as Decision[]).map((d) => (
              <label key={d} className="case"><input type="radio" name="decision" checked={s.decision === d} onChange={() => choisirDecision(d)} /> {NOMS_DECISION[d]}</label>
            ))}
          </div>
          {s.decision === 'sanction' && (
            <div className="grille">
              <label>Palier retenu *
                <select value={s.palier_retenu_id ?? ''} onChange={(e) => maj({ palier_retenu_id: Number(e.target.value) })}>
                  {paliers.filter((p) => p.actif || p.id === s.palier_retenu_id).map((p) => <option key={p.id} value={p.id}>{p.ordre} — {p.libelle}</option>)}
                </select>
              </label>
              <label>Durée (si applicable)<input value={s.duree ?? ''} placeholder="ex. 2 jours" onChange={(e) => maj({ duree: e.target.value })} /></label>
            </div>
          )}
          {s.decision !== 'en_attente' && (
            <label>Date de la décision<input type="date" value={s.date_decision ?? ''} onChange={(e) => maj({ date_decision: e.target.value })} /></label>
          )}
          {s.decision !== 'en_attente' && (
            <label>{differe ? '⚠ Votre choix diffère de la proposition : justification' : 'Justification (facultative)'}
              <textarea rows={2} value={s.justification ?? ''} onChange={(e) => maj({ justification: e.target.value })} />
            </label>
          )}
          <label>Observations de l'apprenti<textarea rows={2} value={s.observations_apprenti ?? ''} onChange={(e) => maj({ observations_apprenti: e.target.value })} /></label>
          <label>Contestation éventuelle<textarea rows={2} value={s.contestation ?? ''} onChange={(e) => maj({ contestation: e.target.value })} /></label>
        </fieldset>

        {erreur && <p className="erreur">{erreur}</p>}
        {info && <p className="succes">{info}</p>}
        <div className="actions">
          {!cloture && <button type="button" className="principal" onClick={enregistrer}>Enregistrer</button>}
          {id && !cloture && <button type="button" onClick={() => action('sanctions:cloturer')}>Clôturer le dossier</button>}
          {id && cloture && <button type="button" onClick={() => action('sanctions:rouvrir')}>Rouvrir le dossier</button>}
          {id && !cloture && <button type="button" className="danger" onClick={supprimer}>Supprimer la saisie</button>}
          {ouvrirApprenti && s.jeune_id > 0 && <button type="button" onClick={() => ouvrirApprenti(s.jeune_id)}>Fiche de l'apprenti</button>}
        </div>

        {id && detail && (
          <>
            <h3>Communication</h3>
            <p>
              Communication à l'employeur : <strong>{NOMS_COMMUNICATION[detail.communication ?? 'non']}</strong>
              {detail.communication_manquante && <span className="etiquette st-rouge">à faire</span>}
              {detail.decision !== 'sanction' && <span className="discret"> (le palier n'est connu qu'une fois la sanction prononcée)</span>}
            </p>
            <div className="actions" style={{ marginTop: 0 }}>
              <button type="button" disabled={cloture || detail.decision === 'en_attente' || detail.decision === 'aucune'} onClick={preparerNotification}>Préparer la notification…</button>
            </div>
            {detail.communications.length > 0 && (
              <table>
                <thead><tr><th>Date</th><th>Destinataires</th><th>Objet</th><th>Statut</th></tr></thead>
                <tbody>{detail.communications.map((c) => (
                  <tr key={c.id}><td>{formaterDateHeure(c.quand)}</td><td>{c.destinataires}</td><td>{c.objet}</td><td>{c.statut}</td></tr>
                ))}</tbody>
              </table>
            )}

            <h3>Pièces associées</h3>
            {detail.pieces.length === 0 && <p className="discret">Aucune pièce.</p>}
            <ul className="pieces">
              {detail.pieces.map((p) => (
                <li key={p.id}>
                  <span>{p.nom_fichier} <span className="discret">({formaterTaille(p.taille)})</span></span>
                  <span>
                    <button type="button" onClick={() => fichiers('ouvrirPiece', { id: p.id, sanction: true }).catch((e) => setErreur(e.message))}>Ouvrir</button>
                    {!cloture && <button type="button" className="danger" onClick={() => retirerPiece(p.id)}>Retirer</button>}
                  </span>
                </li>
              ))}
            </ul>
            {!cloture && <button type="button" onClick={ajouterPieces}>Ajouter des pièces…</button>}

            <h3>Historique des modifications</h3>
            <ul className="journal">
              {detail.journal.map((j, i) => (
                <li key={i}><span className="discret">{formaterDateHeure(j.quand)}</span> <strong>{j.action}</strong>{j.detail && <div className="detail-journal">{j.detail}</div>}</li>
              ))}
            </ul>
          </>
        )}

        {detail && detail.decision === 'commission' && (
          <div className="actions">
            <button type="button" onClick={() => setCommission(true)}>{liees.length ? 'Voir / programmer une autre commission' : 'Programmer la commission…'}</button>
            {liees.length > 0 && <span className="discret">{liees.length} commission(s) liée(s)</span>}
          </div>
        )}
        {commission && detail && (
          <CommissionForm jeuneId={detail.jeune_id} type="disciplinaire" motif={detail.motif_intitule} sanctionId={detail.id} apprentis={apprentis} onClose={() => setCommission(false)} onChange={onChange} />
        )}
        {notif && (
          <div className="voile">
            <div className="fenetre">
              <div className="entete"><h2>Notification — {nomApprenti}</h2><button type="button" onClick={() => setNotif(null)}>Fermer</button></div>
              <ChoixDestinataires destinataires={notif.destinataires} envoi={notif.envoi} onChange={(envoi) => setNotif({ ...notif, envoi })} />
              {notif.mineur && notif.manquant && <p className="alerte-texte">⚠ L'apprenti est mineur mais aucun représentant légal n'a d'adresse e-mail : complétez sa fiche.</p>}
              {notif.mineur && !notif.manquant && <p className="discret">L'apprenti est mineur : son représentant légal est proposé en copie.</p>}
              {ppInclus(notif.envoi, notif.destinataires) && <p className="discret">Le professeur principal est inclus pour être informé de la sanction.</p>}
              <label>Objet<input value={notif.objet} onChange={(e) => setNotif({ ...notif, objet: e.target.value })} /></label>
              <label>Message (modifiable)<textarea rows={14} value={notif.corps} onChange={(e) => setNotif({ ...notif, corps: e.target.value })} /></label>
              {detail && detail.pieces.length > 0 && (
                <>
                  <h3>Pièces jointes</h3>
                  <ul className="pieces">
                    {detail.pieces.map((p) => (
                      <li key={p.id}><label className="case">
                        <input type="checkbox" checked={notif.pieces.includes(p.id)} onChange={(e) => setNotif({ ...notif, pieces: e.target.checked ? [...notif.pieces, p.id] : notif.pieces.filter((x) => x !== p.id) })} />
                        {p.nom_fichier} <span className="discret">({formaterTaille(p.taille)})</span>
                      </label></li>
                    ))}
                  </ul>
                </>
              )}
              <p className="discret">Le brouillon s'ouvre dans Outlook : vous le relisez et l'envoyez vous-même. Il est archivé dans le dossier dès son ouverture.</p>
              <div className="actions">
                <button type="button" className="principal" onClick={ouvrirBrouillon}>Ouvrir le brouillon dans Outlook</button>
                <button type="button" onClick={() => setNotif(null)}>Annuler</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
