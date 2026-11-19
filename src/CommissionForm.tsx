import { useEffect, useState } from 'react';
import {
  appeler, documents, fichiers, NOMS_STATUT_COMMISSION, NOMS_TYPE_COMMISSION,
  type CommissionDetail, type Commission, type Destinataire, type Etablissement, type Intervenant, type Jeune, type ResultatCourriel, type StatutCommission, type TypeCommission,
} from './api';
import ChoixDestinataires, { adressesInvalides, repartition, type Envoi } from './ChoixDestinataires';
import { aujourdhui, formaterDate, formaterDateHeure } from './format';
import SelecteurModele from './SelecteurModele';

const VIDE = (jeuneId: number, type: TypeCommission, motif: string): Commission => ({
  jeune_id: jeuneId, type, date: null, heure_debut: null, heure_fin: null, lieu: '', motif, commentaire: '', compte_rendu: '', decision: '', suites: '',
});
type Mail = { nature: 'convocation' | 'participants' | 'rappel'; destinataires: Destinataire[]; envoi: Envoi; objet: string; corps: string; pieces: number[]; avertissements: string[] };

// Fenêtre de programmation / suivi d'une commission. À placer en dehors de tout autre <form>.
export default function CommissionForm({ commissionId, jeuneId, type, motif, sanctionId, apprentis, onClose, onChange }: {
  commissionId?: number | null; jeuneId?: number; type?: TypeCommission; motif?: string; sanctionId?: number | null; apprentis: Jeune[];
  onClose: () => void; onChange: () => void;
}) {
  const [id, setId] = useState<number | null>(commissionId ?? null);
  const [c, setC] = useState<Commission>(VIDE(jeuneId ?? 0, type ?? 'pedagogique', motif ?? ''));
  const [detail, setDetail] = useState<CommissionDetail | null>(null);
  const [intervenants, setIntervenants] = useState<Intervenant[]>([]);
  const [parts, setParts] = useState<number[]>([]);
  const [erreur, setErreur] = useState('');
  const [info, setInfo] = useState('');
  const [mail, setMail] = useState<Mail | null>(null);
  const [modele, setModele] = useState('');
  const [report, setReport] = useState<{ date: string; heure_debut: string; heure_fin: string; raison: string } | null>(null);

  async function recharger(cid: number) {
    const d = await appeler<CommissionDetail>('commissions:get', cid);
    setDetail(d);
    setC({ ...d });
    setParts(d.participants.map((p) => p.intervenant_id).filter((x): x is number => !!x));
  }
  useEffect(() => { appeler<Intervenant[]>('intervenants:list').then(setIntervenants); }, []);
  useEffect(() => { if (id) recharger(id).catch((e) => setErreur((e as Error).message)); }, [id]);

  const maj = (p: Partial<Commission>) => setC((x) => ({ ...x, ...p }));
  const figee = detail?.statut === 'realisee' || detail?.statut === 'annulee';
  const apprenti = apprentis.find((a) => a.id === c.jeune_id);
  const nomApprenti = apprenti ? `${apprenti.nom.toUpperCase()} ${apprenti.prenom}` : detail ? `${detail.jeune_nom?.toUpperCase()} ${detail.jeune_prenom}` : '';

  async function enregistrer(): Promise<number | null> {
    setErreur(''); setInfo('');
    try {
      const nid = await appeler<number>('commissions:save', { ...c, id: id ?? undefined, participants: parts, sanction_id: sanctionId ?? c.sanction_id ?? null });
      setId(nid); onChange(); await recharger(nid);
      return nid;
    } catch (e) { setErreur((e as Error).message); return null; }
  }
  async function changerStatut(statut: StatutCommission) {
    if (!id) return;
    try { await appeler('commissions:statut', { id, statut }); onChange(); await recharger(id); setErreur(''); } catch (e) { setErreur((e as Error).message); }
  }
  async function reporter() {
    if (!id || !report) return;
    try { await appeler('commissions:reporter', { id, ...report, heure_fin: report.heure_fin || null }); setReport(null); onChange(); await recharger(id); setErreur(''); }
    catch (e) { setErreur((e as Error).message); }
  }
  async function ouvrirWord() {
    const nid = await enregistrer();
    if (!nid) return;
    try {
      const existante = detail?.pieces.find((p) => p.genere && /\.docx$/i.test(p.nom_fichier));
      if (existante && confirm('Une convocation Word existe déjà.\n\nOK : ouvrir la version existante (avec vos modifications).\nAnnuler : générer une nouvelle convocation à partir des données actuelles.')) {
        await fichiers('ouvrirPiece', { id: existante.id, commission: true });
        return;
      }
      const g = await appeler<{ piece_id: number; nom_fichier: string; manque_adresse: boolean; manque_civilite: boolean }>('commissions:convocation:generer', nid);
      await recharger(nid);
      setInfo(`Convocation Word générée et ouverte pour relecture (${g.nom_fichier}) : modifiez-la dans Word, enregistrez, puis « Convertir en PDF ». Rien n'est joint automatiquement à l'apprenti.${g.manque_adresse ? ' ⚠ Adresse de l\'apprenti manquante : complétez sa fiche puis régénérez.' : ''}${g.manque_civilite ? ' ⚠ Civilité manquante.' : ''}`);
      await fichiers('ouvrirPiece', { id: g.piece_id, commission: true });
    } catch (e) { setErreur((e as Error).message); }
  }

  async function convertirPdf(pieceId: number) {
    if (!id) return;
    setErreur(''); setInfo('Conversion en cours…');
    try {
      const r = await fichiers<{ modifie: boolean }>('commissionPdf', { id: pieceId, commission_id: id });
      await recharger(id);
      setInfo(`PDF créé et archivé${r.modifie ? ' à partir de votre version modifiée du Word' : ''}. Il sera proposé en pièce jointe du mail.`);
    } catch (e) { setInfo(''); setErreur((e as Error).message); }
  }
  async function preparerMail(nature: Mail['nature']) {
    const nid = await enregistrer();
    if (!nid) return;
    try {
      const d = await appeler<{ destinataires: Destinataire[]; participants: { nom: string; fonction: string | null; email: string | null }[]; mineur: boolean; representant_manquant: boolean }>('commissions:destinataires', nid);
      const cd = await appeler<CommissionDetail>('commissions:get', nid);
      const etab = await appeler<Etablissement>('etablissement:get');
      const liste: Destinataire[] = [];
      const choix: Record<string, 'a' | 'cc'> = {};
      const avert: string[] = [];
      if (!cd.date || !cd.heure_debut) { setErreur("Renseignez d'abord la date et l'heure de la commission, puis enregistrez."); return; }
      const disc = cd.type === 'disciplinaire';
      const quand = `${formaterDate(cd.date ?? '')} à ${(cd.heure_debut ?? '').replace(':', 'h')}`;
      let pieces: number[] = [];
      let objet = '';
      let corps = '';
      if (nature === 'participants') {
        for (const p of d.participants) if (p.email) { liste.push({ cle: `p-${p.email}`, libelle: `${p.nom}${p.fonction ? ` (${p.fonction})` : ''}`, email: p.email, telephone: null }); choix[p.email] = 'a'; }
        if (!liste.length) avert.push("Aucun participant n'a d'adresse e-mail : renseignez-les dans Paramètres › Intervenants.");
        objet = `Commission ${NOMS_TYPE_COMMISSION[cd.type].toLowerCase()} – ${nomApprenti} – ${quand}`;
        corps = ['Bonjour,', '', `Une commission ${NOMS_TYPE_COMMISSION[cd.type].toLowerCase()} concernant ${nomApprenti}${cd.classe_code ? ` (${cd.classe_code})` : ''} se tiendra le ${quand}${cd.lieu ? `, ${cd.lieu}` : ''}.`, '', `Motif : ${cd.motif}`, '', 'Merci de bien vouloir confirmer votre présence.', '', 'Cordialement,', etab.nom, etab.service, etab.coordonnees].join('\n');
      } else {
        if (apprenti?.email) { liste.push({ cle: 'apprenti', libelle: `Apprenti : ${nomApprenti}`, email: apprenti.email, telephone: null }); choix[apprenti.email] = 'a'; }
        else avert.push("L'apprenti n'a pas d'adresse e-mail enregistrée : saisissez-la ci-dessous ou complétez sa fiche.");
        for (const x of d.destinataires) {
          if (x.role === 'pp') { liste.push(x); continue; }
          liste.push(x);
          if (x.email && ((disc && x.cle === 'maitre') || x.role === 'representant')) choix[x.email] = 'cc';
        }
        if (disc && !d.destinataires.some((x) => x.cle === 'maitre')) avert.push("Pas d'adresse pour le maître d'apprentissage : il est convié à une commission disciplinaire.");
        if (d.mineur && d.representant_manquant) avert.push("L'apprenti est mineur mais aucun représentant légal n'a d'adresse e-mail.");
        const pdf = cd.pieces.find((p) => /\.pdf$/i.test(p.nom_fichier));
        if (!pdf) avert.push("Aucune convocation en PDF : générez le Word, modifiez-le, puis « Convertir en PDF ». Vous pouvez aussi joindre un fichier vous-même dans Outlook.");
        pieces = pdf ? [pdf.id] : [];
        const rappel = nature === 'rappel';
        objet = `${rappel ? 'Rappel – ' : ''}Convocation à une commission ${NOMS_TYPE_COMMISSION[cd.type].toLowerCase()} – ${quand}`;
        corps = ['Bonjour,', '', `${rappel ? 'Pour rappel, vous' : 'Vous'} êtes convoqué(e) à une commission ${NOMS_TYPE_COMMISSION[cd.type].toLowerCase()} le ${quand}${cd.lieu ? `, ${cd.lieu}` : ''}.`, ...(disc ? ['Votre maître d’apprentissage est convié à cette instance.'] : []), '', 'Vous trouverez la convocation en pièce jointe. Merci de nous en accuser réception.', '', 'Cordialement,', etab.nom, etab.service, etab.coordonnees].join('\n');
      }
      setMail({ nature, destinataires: liste, envoi: { choix, autres: { a: '', cc: '', cci: '' } }, objet, corps, pieces, avertissements: avert });
      setErreur('');
    } catch (e) { setErreur((e as Error).message); }
  }
  async function ouvrirBrouillon() {
    if (!mail || !id || !detail) return;
    const invalides = adressesInvalides(mail.envoi);
    if (invalides.length) { setErreur(`Adresse(s) invalide(s) : ${invalides.join(', ')}`); return; }
    const rep = repartition(mail.envoi);
    if (!rep.a.length && !rep.cc.length && !rep.cci.length) { setErreur('Choisissez au moins un destinataire.'); return; }
    try {
      const r = await documents<ResultatCourriel>('courriel', { ...rep, objet: mail.objet, corps: mail.corps, piece_commission_ids: mail.pieces });
      await appeler('commissions:communication:archiver', {
        commission_id: id, nature: mail.nature, ...rep, objet: mail.objet, corps: mail.corps, methode: r.methode, modele_nom: modele || undefined,
        pieces: detail.pieces.filter((p) => mail.pieces.includes(p.id)).map((p) => p.nom_fichier).join(', '),
      });
      setInfo(r.methode === 'outlook' ? 'Brouillon ouvert dans Outlook et archivé dans le dossier. Relisez-le puis envoyez-le vous-même.' : `Outlook n'a pas pu être piloté (${r.raison}). Un message a été ouvert et archivé ; joignez la convocation depuis le dossier.`);
      setMail(null); onChange(); await recharger(id);
    } catch (e) { setErreur((e as Error).message); }
  }
  async function ajouterPiece() {
    if (!id) { setErreur("Enregistrez d'abord la commission."); return; }
    try {
      const r = await fichiers<{ pieces: { token: string }[]; refusees: string[] }>('choisirPieces');
      if (!r.pieces.length) return;
      const a = await fichiers<{ ajoutees: number; erreurs: string[] }>('ajouterPieces', { tokens: r.pieces.map((p) => p.token), commission_id: id });
      if (a.erreurs.length) setErreur(a.erreurs.join(' ; '));
      await recharger(id);
    } catch (e) { setErreur((e as Error).message); }
  }

  return (
    <div className="voile">
      <div className="fenetre large">
        <div className="entete">
          <h2>{id ? `Commission ${NOMS_TYPE_COMMISSION[c.type].toLowerCase()} — ${nomApprenti}` : 'Programmer une commission'} {detail?.statut && <span className="etiquette st-bleu">{NOMS_STATUT_COMMISSION[detail.statut]}</span>}</h2>
          <button type="button" onClick={onClose}>Fermer</button>
        </div>

        <section className="fiche">
          <div className="grille">
            <label>Apprenti *
              <select disabled={!!id} value={c.jeune_id || ''} onChange={(e) => maj({ jeune_id: Number(e.target.value) })}>
                <option value="">—</option>
                {apprentis.map((a) => <option key={a.id} value={a.id}>{a.nom.toUpperCase()} {a.prenom}{a.classe_code ? ` — ${a.classe_code}` : ''}</option>)}
              </select>
            </label>
            <label>Type *
              <select disabled={figee || (detail?.nb_convocations ?? 0) > 0} value={c.type} onChange={(e) => maj({ type: e.target.value as TypeCommission })}>
                {Object.entries(NOMS_TYPE_COMMISSION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Date<input type="date" disabled={figee} value={c.date ?? ''} onChange={(e) => maj({ date: e.target.value || null })} /></label>
            <label>Heure de début<input type="time" disabled={figee} value={c.heure_debut ?? ''} onChange={(e) => maj({ heure_debut: e.target.value || null })} /></label>
            <label>Heure de fin (facultatif)<input type="time" disabled={figee} value={c.heure_fin ?? ''} onChange={(e) => maj({ heure_fin: e.target.value || null })} /></label>
            <label>Lieu<input disabled={figee} value={c.lieu ?? ''} onChange={(e) => maj({ lieu: e.target.value })} placeholder="ex. SD 303" /></label>
          </div>
          <label>Motif de la commission * (repris dans la convocation)<textarea rows={2} disabled={figee} value={c.motif} onChange={(e) => maj({ motif: e.target.value })} /></label>
          <label>Commentaire interne<textarea rows={2} disabled={figee} value={c.commentaire ?? ''} onChange={(e) => maj({ commentaire: e.target.value })} /></label>
          <h3>Participants (intervenants)</h3>
          {intervenants.filter((i) => i.actif || parts.includes(i.id!)).length === 0 && <p className="discret">Aucun intervenant : ajoutez-les dans Paramètres › Intervenants.</p>}
          <div className="liste-cases">
            {intervenants.filter((i) => i.actif || parts.includes(i.id!)).map((i) => (
              <label key={i.id} className="case"><input type="checkbox" disabled={figee} checked={parts.includes(i.id!)} onChange={(e) => setParts(e.target.checked ? [...parts, i.id!] : parts.filter((x) => x !== i.id))} />
                {i.nom}{i.fonction ? ` — ${i.fonction}` : ''} {!i.email && <span className="discret">(sans e-mail)</span>}</label>
            ))}
          </div>
        </section>

        {detail && (
          <section className="fiche">
            <h3>Déroulement et compte rendu</h3>
            <label>Compte rendu<textarea rows={4} value={c.compte_rendu ?? ''} onChange={(e) => maj({ compte_rendu: e.target.value })} /></label>
            <div className="grille">
              <label>Décision / avis rendu<textarea rows={2} value={c.decision ?? ''} onChange={(e) => maj({ decision: e.target.value })} /></label>
              <label>Suites à donner<textarea rows={2} value={c.suites ?? ''} onChange={(e) => maj({ suites: e.target.value })} /></label>
            </div>
            <p className="discret">La décision est saisie par vous : l'application ne prononce aucune sanction.</p>
          </section>
        )}

        {erreur && <p className="erreur">{erreur}</p>}
        {info && <p className="info">{info}</p>}
        <div className="actions">
          <button type="button" className="principal" onClick={() => enregistrer().then((n) => n && setInfo('Commission enregistrée.'))}>Enregistrer</button>
          <button type="button" onClick={ouvrirWord} disabled={figee}>Générer / ouvrir la convocation Word</button>
          <button type="button" onClick={() => preparerMail('convocation')} disabled={figee}>Préparer le mail de convocation…</button>
          <button type="button" onClick={() => preparerMail('participants')} disabled={figee || parts.length === 0}>Informer les participants…</button>
          {detail && (detail.statut === 'programmee' || detail.statut === 'convocations_envoyees') && <button type="button" onClick={() => preparerMail('rappel')}>Envoyer un rappel…</button>}
        </div>

        {detail && (
          <div className="actions">
            {detail.statut !== 'realisee' && <button type="button" onClick={() => changerStatut('realisee')}>Marquer comme réalisée</button>}
            {(detail.statut === 'programmee' || detail.statut === 'convocations_envoyees') && (
              <button type="button" onClick={() => setReport({ date: aujourdhui(), heure_debut: detail.heure_debut ?? '', heure_fin: '', raison: '' })}>Reporter…</button>
            )}
            {detail.statut !== 'annulee' && detail.statut !== 'realisee' && <button type="button" onClick={() => { if (confirm('Annuler cette commission ?')) changerStatut('annulee'); }}>Annuler la commission</button>}
            {(detail.statut === 'annulee' || detail.statut === 'realisee') && <button type="button" onClick={() => changerStatut(detail.date && detail.heure_debut ? 'programmee' : 'a_programmer')}>Rouvrir</button>}
          </div>
        )}
        {report && (
          <section className="fiche">
            <h3>Reporter la commission</h3>
            <div className="grille">
              <label>Nouvelle date<input type="date" value={report.date} onChange={(e) => setReport({ ...report, date: e.target.value })} /></label>
              <label>Heure de début<input type="time" value={report.heure_debut} onChange={(e) => setReport({ ...report, heure_debut: e.target.value })} /></label>
              <label>Heure de fin<input type="time" value={report.heure_fin} onChange={(e) => setReport({ ...report, heure_fin: e.target.value })} /></label>
              <label>Raison<input value={report.raison} onChange={(e) => setReport({ ...report, raison: e.target.value })} /></label>
            </div>
            <p className="discret">Les convocations devront être régénérées et renvoyées.</p>
            <div className="actions"><button type="button" className="principal" onClick={reporter}>Confirmer le report</button><button type="button" onClick={() => setReport(null)}>Annuler</button></div>
          </section>
        )}

        {detail && (
          <>
            <h3>Documents</h3>
            {detail.pieces.length === 0 ? <p className="discret">Aucun document.</p> : (
              <ul className="pieces">
                {detail.pieces.map((p) => (
                  <li key={p.id}>{p.nom_fichier} {p.genere ? <span className="etiquette st-bleu">généré</span> : null}
                    <span className="discret"> {formaterDateHeure(p.ajoute_le)}</span>{' '}
                    <button type="button" onClick={() => fichiers('ouvrirPiece', { id: p.id, commission: true }).catch((e) => setErreur(e.message))}>Ouvrir</button>
                    {/\.docx$/i.test(p.nom_fichier) && <button type="button" onClick={() => convertirPdf(p.id)}>Convertir en PDF</button>}
                    {!p.genere && <button type="button" onClick={async () => { await appeler('commissions:piece:supprimer', p.id); await recharger(id!); }}>Retirer</button>}
                  </li>
                ))}
              </ul>
            )}
            <div className="actions"><button type="button" onClick={ajouterPiece}>Ajouter un document</button></div>
            <h3>Communications</h3>
            {detail.communications.length === 0 ? <p className="discret">Aucune communication préparée.</p> : (
              <ul className="journal">{detail.communications.map((m) => <li key={m.id}><span className="discret">{formaterDateHeure(m.quand)}</span> {m.nature} — {m.destinataires}</li>)}</ul>
            )}
            <h3>Historique</h3>
            <ul className="journal">{detail.journal.map((j) => <li key={j.id}><span className="discret">{formaterDateHeure(j.quand)}</span> <strong>{j.action}</strong>{j.detail ? ` — ${j.detail}` : ''}</li>)}</ul>
          </>
        )}

        {mail && (
          <div className="voile">
            <div className="fenetre">
              <div className="entete"><h2>{mail.nature === 'participants' ? 'Information des participants' : mail.nature === 'rappel' ? 'Rappel' : 'Convocation'} — {nomApprenti}</h2><button type="button" onClick={() => setMail(null)}>Fermer</button></div>
              {mail.avertissements.map((a) => <p key={a} className="alerte-texte">⚠ {a}</p>)}
              <ChoixDestinataires destinataires={mail.destinataires} envoi={mail.envoi} onChange={(envoi) => setMail({ ...mail, envoi })} />
              <SelecteurModele jeuneId={c.jeune_id} commissionId={id} categorie={mail.nature === 'participants' ? (c.type === 'disciplinaire' ? 'Commissions disciplinaires' : 'Commissions pédagogiques') : 'Convocations'} onChoisir={(m) => { setMail({ ...mail, objet: m.objet, corps: m.corps }); setModele(m.modele_nom ?? ''); }} />
              <label>Objet<input value={mail.objet} onChange={(e) => setMail({ ...mail, objet: e.target.value })} /></label>
              <label>Message (modifiable)<textarea rows={12} value={mail.corps} onChange={(e) => setMail({ ...mail, corps: e.target.value })} /></label>
              {mail.nature !== 'participants' && detail && detail.pieces.some((p) => !/\.docx$/i.test(p.nom_fichier)) && (
                <>
                  <h3>Pièces jointes</h3>
                  <ul className="pieces">
                    {detail.pieces.filter((p) => !/\.docx$/i.test(p.nom_fichier)).map((p) => (
                      <li key={p.id}><label className="case">
                        <input type="checkbox" checked={mail.pieces.includes(p.id)} onChange={(e) => setMail({ ...mail, pieces: e.target.checked ? [...mail.pieces, p.id] : mail.pieces.filter((x) => x !== p.id) })} />
                        {p.nom_fichier}
                      </label></li>
                    ))}
                  </ul>
                </>
              )}
              <p className="discret">Un brouillon s'ouvre dans Outlook : vous le relisez et l'envoyez vous-même.</p>
              <div className="actions"><button type="button" className="principal" onClick={ouvrirBrouillon}>Ouvrir le brouillon</button><button type="button" onClick={() => setMail(null)}>Annuler</button></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
