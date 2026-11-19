import { useEffect, useState } from 'react';
import {
  appeler, documents, NOMS_STATUT_ALERTE, type Alerte, type AlerteDetail, type Etablissement, type Intervenant, type RegleAlerte, type ResultatCourriel, type StatutAlerte,
} from '../api';
import { formaterDate, formaterDateHeure } from '../format';
import SelecteurModele from '../SelecteurModele';

const PERIODES = { semaine: 'par semaine', mois: 'par mois', annee: "par année scolaire" };

export default function Alertes({ ouvrirFiche, allerA }: { ouvrirFiche?: (type: 'apprenti' | 'entreprise', id: number) => void; allerA?: (page: string) => void }) {
  const [onglet, setOnglet] = useState<'alertes' | 'regles'>('alertes');
  const [liste, setListe] = useState<Alerte[]>([]);
  const [statut, setStatut] = useState<'ouvertes' | StatutAlerte | ''>('ouvertes');
  const [regles, setRegles] = useState<RegleAlerte[]>([]);
  const [intervenants, setIntervenants] = useState<Intervenant[]>([]);
  const [detail, setDetail] = useState<AlerteDetail | null>(null);
  const [note, setNote] = useState('');
  const [mail, setMail] = useState<{ a: string[]; objet: string; corps: string } | null>(null);
  const [erreur, setErreur] = useState('');
  const [info, setInfo] = useState('');

  const charger = () => appeler<Alerte[]>('alertes:list', { statut: statut || undefined }).then(setListe);
  const chargerRegles = () => appeler<RegleAlerte[]>('alertes:regles').then(setRegles);
  useEffect(() => { charger(); }, [statut]);
  useEffect(() => { chargerRegles(); appeler<Intervenant[]>('intervenants:list').then(setIntervenants); }, []);

  async function ouvrir(id: number) {
    setErreur(''); setInfo(''); setMail(null);
    const d = await appeler<AlerteDetail>('alertes:get', id);
    setDetail(d); setNote(d.note ?? '');
  }
  async function changer(s: StatutAlerte) {
    if (!detail) return;
    try { await appeler('alertes:statut', { id: detail.id, statut: s, note }); await ouvrir(detail.id); charger(); } catch (e) { setErreur((e as Error).message); }
  }
  async function preparerMail() {
    if (!detail) return;
    const etab = await appeler<Etablissement>('etablissement:get');
    const a = detail.destinataires.map((d) => d.email).filter((x): x is string => !!x);
    if (!a.length) { setErreur("Aucun destinataire avec une adresse e-mail : réglez-les dans l'onglet « Règles »."); return; }
    setMail({
      a,
      objet: `Alerte – ${detail.jeune_prenom} ${detail.jeune_nom.toUpperCase()} – ${detail.regle_libelle}`,
      corps: ['Bonjour,', '', `${detail.jeune_prenom} ${detail.jeune_nom.toUpperCase()} a atteint le seuil d'alerte « ${detail.regle_libelle} » (${detail.valeur} pour un seuil de ${detail.seuil}, ${detail.periode_libelle}).`, '', ...detail.faits.map((f) => `- ${formaterDate(f.date)} : ${f.detail}${f.motif ? ` (${f.motif})` : ''}`), '', 'Merci de nous indiquer la suite à donner.', '', 'Cordialement,', etab.nom, etab.service].join('\n'),
    });
  }
  async function ouvrirBrouillon() {
    if (!mail || !detail) return;
    try {
      const r = await documents<ResultatCourriel>('courriel', { a: mail.a, cc: [], cci: [], objet: mail.objet, corps: mail.corps });
      await appeler('alertes:communication:archiver', { alerte_id: detail.id, a: mail.a });
      setInfo(r.methode === 'outlook' ? 'Brouillon ouvert dans Outlook. Relisez-le puis envoyez-le vous-même.' : "Un message a été ouvert dans la messagerie par défaut.");
      setMail(null); await ouvrir(detail.id);
    } catch (e) { setErreur((e as Error).message); }
  }
  async function enregistrerRegle(r: RegleAlerte) {
    try { await appeler('alertes:regle:save', r); setInfo('Règle enregistrée.'); setErreur(''); chargerRegles(); charger(); } catch (e) { setErreur((e as Error).message); }
  }
  const majRegle = (id: number, p: Partial<RegleAlerte>) => setRegles((l) => l.map((r) => (r.id === id ? { ...r, ...p } : r)));

  return (
    <div>
      <div className="entete"><h1>Alertes</h1></div>
      <div className="onglets">
        <button className={onglet === 'alertes' ? 'actif' : ''} onClick={() => setOnglet('alertes')}>Alertes</button>
        <button className={onglet === 'regles' ? 'actif' : ''} onClick={() => setOnglet('regles')}>Règles et seuils</button>
      </div>
      {erreur && <p className="erreur">{erreur}</p>}
      {info && <p className="info">{info}</p>}

      {onglet === 'alertes' && (
        <>
          <p className="discret">Les alertes signalent un seuil atteint ; elles ne déclenchent jamais de sanction. Un dossier disciplinaire ou une commission reste votre décision.</p>
          <div className="filtres">
            <label>Statut
              <select value={statut} onChange={(e) => setStatut(e.target.value as typeof statut)}>
                <option value="ouvertes">Ouvertes (nouvelle, à traiter, en cours)</option>
                <option value="">Toutes</option>
                {Object.entries(NOMS_STATUT_ALERTE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <table className="table">
            <thead><tr><th>Apprenti</th><th>Règle</th><th>Période</th><th>Valeur</th><th>Statut</th><th /></tr></thead>
            <tbody>
              {liste.map((a) => (
                <tr key={a.id}>
                  <td>{a.jeune_nom.toUpperCase()} {a.jeune_prenom}</td>
                  <td>{a.regle_libelle}</td>
                  <td>{a.periode_libelle}</td>
                  <td>{a.valeur} / {a.seuil}</td>
                  <td><span className={`etiquette ${a.statut === 'nouvelle' ? 'st-orange' : 'st-bleu'}`}>{NOMS_STATUT_ALERTE[a.statut]}</span></td>
                  <td className="droite"><button onClick={() => ouvrir(a.id)}>Ouvrir</button></td>
                </tr>
              ))}
              {liste.length === 0 && <tr><td colSpan={6} className="discret">Aucune alerte.</td></tr>}
            </tbody>
          </table>

          {detail && (
            <div className="voile">
              <div className="fenetre">
                <div className="entete"><h2>{detail.regle_libelle} — {detail.jeune_nom.toUpperCase()} {detail.jeune_prenom}</h2><button onClick={() => { setDetail(null); setMail(null); }}>Fermer</button></div>
                <p>{detail.periode_libelle} : <strong>{detail.valeur}</strong> (seuil {detail.seuil}) <span className="etiquette st-bleu">{NOMS_STATUT_ALERTE[detail.statut]}</span></p>
                <h3>Faits concernés</h3>
                <ul>{detail.faits.map((f, i) => <li key={i}>{formaterDate(f.date)} — {f.detail}{f.motif ? ` (${f.motif})` : ''}</li>)}</ul>
                <label>Note de suivi<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
                <div className="actions">
                  {(['a_traiter', 'en_cours', 'traitee', 'sans_suite', 'cloturee'] as StatutAlerte[]).filter((s) => s !== detail.statut).map((s) => <button key={s} onClick={() => changer(s)}>{NOMS_STATUT_ALERTE[s]}</button>)}
                </div>
                <div className="actions">
                  <button onClick={preparerMail}>Informer les destinataires…</button>
                  <button onClick={() => ouvrirFiche?.('apprenti', detail.jeune_id)}>Ouvrir la fiche apprenti</button>
                  <button onClick={() => allerA?.('sanctions')}>Aller aux sanctions</button>
                </div>
                {detail.destinataires.length > 0 && <p className="discret">Destinataires : {detail.destinataires.map((d) => d.nom).join(', ')}</p>}
                <h3>Historique</h3>
                <ul className="journal">{detail.journal.map((j) => <li key={j.id}><span className="discret">{formaterDateHeure(j.quand)}</span> <strong>{j.action}</strong>{j.detail ? ` — ${j.detail}` : ''}</li>)}</ul>
                {mail && (
                  <div className="voile">
                    <div className="fenetre">
                      <div className="entete"><h2>Informer les destinataires</h2><button onClick={() => setMail(null)}>Fermer</button></div>
                      <p className="discret">À : {mail.a.join(', ')}</p>
                      <SelecteurModele jeuneId={detail.jeune_id} categorie="Retards" onChoisir={(m) => setMail({ ...mail, objet: m.objet, corps: m.corps })} />
                      <label>Objet<input value={mail.objet} onChange={(e) => setMail({ ...mail, objet: e.target.value })} /></label>
                      <label>Message (modifiable)<textarea rows={12} value={mail.corps} onChange={(e) => setMail({ ...mail, corps: e.target.value })} /></label>
                      <div className="actions"><button className="principal" onClick={ouvrirBrouillon}>Ouvrir le brouillon</button><button onClick={() => setMail(null)}>Annuler</button></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {onglet === 'regles' && (
        <>
          <p className="discret">Une absence est comptée en demi-journées (matin ou après-midi, d'après les horaires de Paramètres). « Non recevable » = motif irrecevable. Le cumul additionne retards et demi-journées non recevables.</p>
          {regles.map((r) => (
            <section key={r.id} className="fiche">
              <h3>{r.libelle}</h3>
              <div className="grille">
                <label>Seuil (alerte dès…)<input type="number" min={1} max={99} value={r.seuil} onChange={(e) => majRegle(r.id, { seuil: Number(e.target.value) })} /></label>
                <label>Période
                  <select value={r.periode} onChange={(e) => majRegle(r.id, { periode: e.target.value as RegleAlerte['periode'] })}>
                    {Object.entries(PERIODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
              </div>
              <label className="case"><input type="checkbox" checked={!!r.actif} onChange={(e) => majRegle(r.id, { actif: e.target.checked ? 1 : 0 })} /> Règle active</label>
              <h4>Destinataires des alertes</h4>
              <div className="liste-cases">
                {intervenants.filter((i) => i.actif).map((i) => (
                  <label key={i.id} className="case"><input type="checkbox" checked={r.destinataires.includes(i.id!)} onChange={(e) => majRegle(r.id, { destinataires: e.target.checked ? [...r.destinataires, i.id!] : r.destinataires.filter((x) => x !== i.id) })} />{i.nom}{i.fonction ? ` — ${i.fonction}` : ''}</label>
                ))}
                {intervenants.filter((i) => i.actif).length === 0 && <span className="discret">Aucun intervenant : ajoutez-les dans Paramètres.</span>}
              </div>
              <div className="actions"><button className="principal" onClick={() => enregistrerRegle(r)}>Enregistrer</button></div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
