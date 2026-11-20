import { useEffect, useMemo, useRef, useState } from 'react';
import { appeler, documents, type ApprentiRecap, type Classe, type ControleEnvoi, type Destinataire, type ExtractionRecap, type ResultatRecap, type ResultatCourriel, type TransmissionRecap } from '../api';
import { aujourdhui, formaterDate } from '../format';
import { anneeScolaireCourante } from '../FicheAssiduite';
import ChoixDestinataires, { adressesInvalides, envoiParDefaut, repartition, type Envoi } from '../ChoixDestinataires';
import CamembertRecevabilite from '../CamembertRecevabilite';
import RecapMensuel from './RecapMensuel';
import { graphiques, hm, sansDomaine } from '../recapTableau';
import { classeurClasses, feuilleIndividuel, pdfFeuilles } from '../recapExcel';

type Onglet = 'tableau' | 'mensuel' | 'historique';
type Dom = { absences: boolean; retards: boolean; sanctions: boolean };
const DOM_LIBELLE: Record<keyof Dom, string> = { absences: 'Absences', retards: 'Retards', sanctions: 'Sanctions' };

export default function Recapitulatifs() {
  const [onglet, setOnglet] = useState<Onglet>('tableau');
  return (
    <>
      <div className="entete"><h1>Récapitulatif – suivi des apprentis</h1></div>
      <div className="actions">
        <button className={onglet === 'tableau' ? 'principal' : ''} onClick={() => setOnglet('tableau')}>Tableau de bord</button>
        <button className={onglet === 'mensuel' ? 'principal' : ''} onClick={() => setOnglet('mensuel')}>Mails mensuels aux employeurs</button>
        <button className={onglet === 'historique' ? 'principal' : ''} onClick={() => setOnglet('historique')}>Historique</button>
      </div>
      {onglet === 'tableau' && <TableauRecap />}
      {onglet === 'mensuel' && <RecapMensuel />}
      {onglet === 'historique' && <HistoriqueRecap />}
    </>
  );
}

function TableauRecap() {
  const an = anneeScolaireCourante();
  const [classes, setClasses] = useState<Classe[]>([]);
  const [debut, setDebut] = useState(an.debut);
  const [fin, setFin] = useState(an.fin);
  const [classeIds, setClasseIds] = useState<number[]>([]);
  const [recherche, setRecherche] = useState('');
  const [dom, setDom] = useState<Dom>({ absences: true, retards: true, sanctions: false });
  const [r, setR] = useState<ResultatRecap | null>(null);
  const [extraction, setExtraction] = useState<number | null>(null);
  const [critereModifie, setCritereModifie] = useState(false);
  const [donneesModifiees, setDonneesModifiees] = useState(false);
  const [vue, setVue] = useState<number | null>(null); // apprenti affiché individuellement
  const [erreur, setErreur] = useState('');
  const [info, setInfo] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const critRef = useRef('');

  const criteres = () => ({ debut, fin, domaines: dom, classe_ids: classeIds, recherche });
  useEffect(() => { appeler<Classe[]>('classes:list').then(setClasses); }, []);
  useEffect(() => { if (r) setCritereModifie(JSON.stringify(criteres()) !== critRef.current); }, [debut, fin, dom, classeIds, recherche]);

  // Les données sources peuvent changer (absence saisie ailleurs) : on re-vérifie régulièrement l'empreinte.
  useEffect(() => {
    if (!r) return;
    const t = setInterval(() => {
      appeler<ResultatRecap>('recap:calculer', r.criteres).then((n) => setDonneesModifiees(n.empreinte !== r.empreinte)).catch(() => { /* ignoré */ });
    }, 15000);
    return () => clearInterval(t);
  }, [r]);

  async function generer() {
    setErreur(''); setInfo('');
    try {
      const res = await appeler<ResultatRecap>('recap:calculer', criteres());
      setR(res); setVue(null); setCritereModifie(false); setDonneesModifiees(false); critRef.current = JSON.stringify(criteres());
      setExtraction(await appeler<number>('recap:extraction:enregistrer', { resultat: res, usage: 'tableau' }));
    } catch (e) { setErreur((e as Error).message); }
  }

  const nomsClasses = classes.filter((c) => classeIds.includes(c.id)).map((c) => c.code);
  const periode = r ? `${r.criteres.debut}_${r.criteres.fin}` : '';
  const obsolete = critereModifie || donneesModifiees;
  const apVue = r?.apprentis.find((a) => a.id === vue) ?? null;

  async function excel() {
    if (!r) return;
    try {
      const feuilles = apVue ? [feuilleIndividuel(r, apVue)] : classeurClasses(r);
      const nom = apVue ? `Tableau_de_bord_${apVue.nom}_${apVue.prenom}_${periode}` : `Tableau_de_bord_classes_${periode}`;
      const x = await documents<{ annule?: boolean; chemin?: string }>('xlsx', { feuilles, nom });
      if (!x.annule) { setInfo(`Excel enregistré : ${x.chemin}`); await appeler('recap:extraction:enregistrer', { resultat: r, usage: 'excel' }); }
    } catch (e) { setErreur((e as Error).message); }
  }
  async function pdf() {
    if (!r) return;
    try {
      const html = pdfFeuilles(apVue ? [feuilleIndividuel(r, apVue)] : classeurClasses(r).slice(0, -1));
      const nom = apVue ? `Tableau_de_bord_${apVue.nom}_${apVue.prenom}_${periode}` : `Recapitulatif_${periode}`;
      const x = await documents<{ annule?: boolean; chemin?: string }>('pdf', { html, nom });
      if (!x.annule) { setInfo(`PDF enregistré : ${x.chemin}`); await appeler('recap:extraction:enregistrer', { resultat: r, usage: 'pdf' }); }
    } catch (e) { setErreur((e as Error).message); }
  }
  async function lot() {
    if (!r) return;
    try {
      const docs = r.apprentis.map((a) => ({ nom: `Tableau_de_bord_${a.classe_code}_${a.nom}_${a.prenom}_${periode}`, html: pdfFeuilles([feuilleIndividuel(r, a)]) }));
      const x = await documents<{ annule?: boolean; dossier?: string; nb?: number }>('pdfLot', { documents: docs });
      if (!x.annule) { setInfo(`${x.nb} tableau(x) de bord individuel(s) enregistré(s) dans ${x.dossier}`); await appeler('recap:extraction:enregistrer', { resultat: r, usage: 'lot_individuels' }); }
    } catch (e) { setErreur((e as Error).message); }
  }

  const g = useMemo(() => (r ? graphiques(vue && apVue ? soloRes(r, apVue) : r) : []), [r, vue]);

  return (
    <>
      <p className="discret">Lecture seule : les chiffres viennent des modules Absences, Retards et Sanctions. Rien n'est ressaisi ni modifié ici.</p>
      <section className="fiche">
        <h3>Critères</h3>
        <div className="grille">
          <label>Du<input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} /></label>
          <label>Au<input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></label>
          <label>Apprenti<input value={recherche} placeholder="Nom ou prénom…" onChange={(e) => setRecherche(e.target.value)} /></label>
          <label>Année scolaire<select value={`${debut.slice(0, 4)}`} onChange={(e) => { const y = Number(e.target.value); setDebut(`${y}-09-01`); setFin(`${y + 1}-08-31`); }}>
            {[an.debut, `${Number(an.debut.slice(0, 4)) - 1}-09-01`].map((d) => <option key={d} value={d.slice(0, 4)}>{d.slice(0, 4)}-{Number(d.slice(0, 4)) + 1}</option>)}
          </select></label>
        </div>
        <p><strong>Formation / classe</strong> (plusieurs possibles pour les comparer)</p>
        <div className="actions">
          {classes.map((c) => (
            <label key={c.id} className="case"><input type="checkbox" checked={classeIds.includes(c.id)} onChange={(e) => setClasseIds(e.target.checked ? [...classeIds, c.id] : classeIds.filter((x) => x !== c.id))} />{c.code}</label>
          ))}
        </div>
        <p><strong>Domaines</strong></p>
        <div className="actions">
          {(Object.keys(DOM_LIBELLE) as (keyof Dom)[]).map((k) => (
            <label key={k} className="case"><input type="checkbox" checked={dom[k]} onChange={(e) => setDom({ ...dom, [k]: e.target.checked })} />{DOM_LIBELLE[k]}</label>
          ))}
        </div>
        {dom.sanctions && <p className="alerte-texte">⚠ Les sanctions sont des données disciplinaires : elles ne figurent jamais dans un document pour une entreprise, sauf autorisation expresse au moment de l'envoi.</p>}
        <div className="actions">
          <button className="principal" onClick={generer}>Générer le tableau de bord</button>
          <button disabled={!r} onClick={excel}>Exporter Excel</button>
          <button disabled={!r} onClick={pdf}>Exporter PDF{apVue ? ' (apprenti affiché)' : ''}</button>
          <button disabled={!r || obsolete} onClick={() => setEnvoi(true)}>Envoyer par e-mail</button>
          <button disabled={!r || !r.apprentis.length} onClick={lot}>Un PDF par apprenti (lot)</button>
        </div>
        {erreur && <p className="erreur">{erreur}</p>}
        {info && <p className="succes">{info}</p>}
      </section>

      {r && obsolete && (
        <p className="alerte-texte">
          ⚠ {critereModifie ? 'Les critères ont changé depuis la génération.' : 'Des données ont changé depuis la génération (absence, retard ou sanction modifié).'} Ces résultats ne sont plus à jour : cliquez sur « Générer le tableau de bord ». L'export par e-mail est bloqué tant que ce n'est pas fait.
        </p>
      )}

      {r && (
        <>
          <p className="discret">Généré le {formaterDate(r.genere_le.slice(0, 10))} à {r.genere_le.slice(11, 16)} (UTC) — extraction n° {extraction ?? '—'}{vue ? '' : ''}</p>
          {apVue && <p><button onClick={() => setVue(null)}>← Retour au tableau collectif</button> <strong>{apVue.nom.toUpperCase()} {apVue.prenom}</strong> — {apVue.classe_code}</p>}
          <div className="cartes-stats">
            {(() => {
              const t = apVue ? { apprentis: 1, absences: apVue.absences, retards: apVue.retards, sanctions: apVue.sanctions.length } : r.totaux;
              return (
                <>
                  {!apVue && <div className="carte-stat"><div className="carte-titre">Apprentis</div><div className="carte-grand">{t.apprentis}</div></div>}
                  {r.criteres.domaines.includes('absences') && <div className="carte-stat"><div className="carte-titre">Absences</div><div className="carte-grand">{t.absences.nb}</div><div className="discret">{hm(t.absences.minutes)} — injustifiées {t.absences.injustifiees.nb}</div></div>}
                  {r.criteres.domaines.includes('retards') && <div className="carte-stat"><div className="carte-titre">Retards</div><div className="carte-grand">{t.retards.nb}</div><div className="discret">{hm(t.retards.minutes)} — injustifiés {t.retards.injustifiees.nb}</div></div>}
                  {r.criteres.domaines.includes('sanctions') && <div className="carte-stat"><div className="carte-titre">Sanctions</div><div className="carte-grand">{t.sanctions}</div></div>}
                </>
              );
            })()}
          </div>
          <div className="graphes">{g.map((x) => <div key={x.id} className="graphe" dangerouslySetInnerHTML={{ __html: x.svg }} />)}</div>
          {g.length === 0 && <p className="discret">Aucune donnée à représenter sur cette période.</p>}

          {!apVue && r.par_classe.length > 1 && (r.criteres.domaines.includes('absences') || r.criteres.domaines.includes('retards')) && (
            <>
              <h3>Recevables / irrecevables par classe</h3>
              <CamembertRecevabilite debut={r.criteres.debut} fin={r.criteres.fin} classeIds={r.criteres.classe_ids} parClasse types={r.criteres.domaines.filter((d): d is 'absences' | 'retards' => d !== 'sanctions')} />
              <h3>Comparaison des classes</h3>
              <table className="tableau"><thead><tr><th>Classe</th><th>Apprentis</th><th>Absences</th><th>Heures</th><th>Retards</th><th>Heures</th><th>Sanctions</th></tr></thead>
                <tbody>{r.par_classe.map((c) => <tr key={c.classe}><td>{c.classe}</td><td>{c.apprentis}</td><td>{c.absences}</td><td>{hm(c.min_absences)}</td><td>{c.retards}</td><td>{hm(c.min_retards)}</td><td>{c.sanctions}</td></tr>)}</tbody></table>
            </>
          )}

          {!apVue && (
            <>
              <h3>Apprentis ({r.apprentis.length})</h3>
              <table className="tableau"><thead><tr><th>Apprenti</th><th>Classe</th><th>Absences</th><th>Retards</th><th>Sanctions</th><th /></tr></thead>
                <tbody>
                  {r.apprentis.length === 0 && <tr><td colSpan={6} className="discret">Aucun apprenti ne correspond à ces critères.</td></tr>}
                  {r.apprentis.map((a) => (
                    <tr key={a.id}><td><strong>{a.nom.toUpperCase()}</strong> {a.prenom}</td><td>{a.classe_code}</td>
                      <td>{a.absences.nb} — {hm(a.absences.minutes)}</td><td>{a.retards.nb} — {hm(a.retards.minutes)}</td><td>{r.criteres.domaines.includes('sanctions') ? a.sanctions.length : '—'}</td>
                      <td><button onClick={() => setVue(a.id)}>Tableau individuel</button></td></tr>
                  ))}
                </tbody></table>
            </>
          )}
          {apVue && (
            <>
              <h3>Détail</h3>
              <table className="tableau"><thead><tr><th>Date</th><th>Type</th><th>Durée</th><th>Motif</th><th>Statut</th></tr></thead>
                <tbody>
                  {apVue.evenements.length === 0 && <tr><td colSpan={5} className="discret">Aucune absence ni retard.</td></tr>}
                  {apVue.evenements.map((e) => <tr key={e.id}><td>{formaterDate(e.date_debut)}</td><td>{e.type === 'absence' ? 'Absence' : 'Retard'}</td><td>{hm(e.duree_minutes ?? 0)}</td><td>{e.motif_libelle ?? '—'}</td><td>{e.motif_statut === 'recevable' ? 'Justifiée' : e.motif_statut === 'irrecevable' ? 'Injustifiée' : 'En attente'}</td></tr>)}
                </tbody></table>
              {r.criteres.domaines.includes('sanctions') && (
                <>
                  <h3>Sanctions</h3>
                  <table className="tableau"><thead><tr><th>Date</th><th>Palier</th><th>Motif</th></tr></thead>
                    <tbody>{apVue.sanctions.length === 0 && <tr><td colSpan={3} className="discret">Aucune sanction.</td></tr>}
                      {apVue.sanctions.map((s) => <tr key={s.id}><td>{formaterDate(s.date_decision ?? s.date_faits)}</td><td>{s.palier ?? '—'}</td><td>{s.motif}</td></tr>)}</tbody></table>
                </>
              )}
            </>
          )}
        </>
      )}

      {envoi && r && (
        <EnvoiRecap r={r} apprenti={apVue} extraction={extraction} periode={periode} nomsClasses={nomsClasses}
          fermer={(msg) => { setEnvoi(false); if (msg) setInfo(msg); }} />
      )}
    </>
  );
}

// Résultat limité à un apprenti (graphiques de la vue individuelle).
function soloRes(r: ResultatRecap, a: ApprentiRecap): ResultatRecap {
  const m: Record<string, ResultatRecap['par_mois'][number]> = {};
  const k = (x: string) => (m[x] ??= { mois: x, absences: 0, min_absences: 0, retards: 0, min_retards: 0, sanctions: 0 });
  for (const e of a.evenements) { const x = k(e.date_debut.slice(0, 7)); if (e.type === 'absence') { x.absences++; x.min_absences += e.duree_minutes ?? 0; } else { x.retards++; x.min_retards += e.duree_minutes ?? 0; } }
  for (const s of a.sanctions) k((s.date_decision ?? s.date_faits).slice(0, 7)).sanctions++;
  const p: Record<string, number> = {};
  for (const s of a.sanctions) p[s.palier ?? 'Non précisé'] = (p[s.palier ?? 'Non précisé'] ?? 0) + 1;
  return { ...r, apprentis: [a], totaux: { apprentis: 1, absences: a.absences, retards: a.retards, sanctions: a.sanctions.length }, par_mois: Object.values(m).sort((x, y) => x.mois.localeCompare(y.mois)), par_palier: Object.entries(p).map(([palier, nb]) => ({ palier, nb })) };
}

function EnvoiRecap({ r, apprenti, extraction, periode, nomsClasses, fermer }: {
  r: ResultatRecap; apprenti: ApprentiRecap | null; extraction: number | null; periode: string; nomsClasses: string[]; fermer: (msg?: string) => void;
}) {
  const [dest, setDest] = useState<Destinataire[]>([]);
  const [envoi, setEnvoi] = useState<Envoi>({ choix: {}, autres: { a: '', cc: '', cci: '' } });
  const [avecSanctions, setAvecSanctions] = useState(false);
  const [autorises, setAutorises] = useState<string[]>([]);
  const [confirmes, setConfirmes] = useState<string[]>([]);
  const [pj, setPj] = useState<{ pdf: boolean; xlsx: boolean }>({ pdf: true, xlsx: false });
  const [objet, setObjet] = useState(`Récapitulatif de suivi — ${formaterDate(r.criteres.debut)} au ${formaterDate(r.criteres.fin)}`);
  const [corps, setCorps] = useState('Bonjour,\n\nVeuillez trouver ci-joint le récapitulatif de suivi pour la période indiquée.\n\nCordialement,');
  const [controle, setControle] = useState<ControleEnvoi | null>(null);
  const [erreur, setErreur] = useState('');
  const individuel = !!apprenti;
  const sanctionsDispo = r.criteres.domaines.includes('sanctions');

  useEffect(() => {
    if (!apprenti) return;
    appeler<Destinataire[]>('destinataires:list', { jeune_id: apprenti.id, date: r.criteres.fin }).then((d) => { setDest(d); setEnvoi(envoiParDefaut(d)); });
  }, [apprenti?.id]);

  const adresses = Object.values(repartition(envoi)).flat();
  const domaines = sanctionsDispo && avecSanctions ? r.criteres.domaines : r.criteres.domaines.filter((d) => d !== 'sanctions');
  const arg = () => ({ jeune_ids: individuel ? [apprenti!.id] : r.apprentis.map((a) => a.id), domaines, destinataires: adresses, sanctions_autorisees_a: autorises, confirmes, date: r.criteres.fin });
  useEffect(() => { setControle(null); }, [avecSanctions, autorises, confirmes, envoi, apprenti?.id]);

  const doc = () => {
    const base = sanctionsDispo && avecSanctions ? r : sansDomaine(r, 'sanctions');
    const a = apprenti ? base.apprentis.find((x) => x.id === apprenti.id) ?? apprenti : null;
    return pdfFeuilles(a ? [feuilleIndividuel(base, a)] : classeurClasses(base).slice(0, -1));
  };
  const feuilles = () => {
    const base = sanctionsDispo && avecSanctions ? r : sansDomaine(r, 'sanctions');
    const a = apprenti ? base.apprentis.find((x) => x.id === apprenti.id) : null;
    return a ? [feuilleIndividuel(base, a)] : classeurClasses(base);
  };
  const nom = apprenti ? `Tableau_de_bord_${apprenti.nom}_${apprenti.prenom}_${periode}` : `Recapitulatif_${periode}`;

  async function controler() {
    setErreur('');
    if (adressesInvalides(envoi).length) { setErreur(`Adresse(s) invalide(s) : ${adressesInvalides(envoi).join(', ')}`); return; }
    setControle(await appeler<ControleEnvoi>('recap:controler', arg()));
  }
  async function telecharger() {
    try {
      if (pj.pdf) await documents('pdf', { html: doc(), nom });
      if (pj.xlsx) await documents('xlsx', { feuilles: feuilles(), nom });
    } catch (e) { setErreur((e as Error).message); }
  }
  async function envoyer() {
    try {
      const c = await appeler<ControleEnvoi>('recap:controler', arg());
      setControle(c);
      if (!c.ok) return;
      const rep = repartition(envoi);
      const res = await documents<ResultatCourriel>('courriel', {
        ...rep, objet, corps, nom,
        html: pj.pdf ? doc() : undefined, xlsx: pj.xlsx ? { nom, feuilles: feuilles() } : undefined,
      });
      await appeler('recap:transmission:enregistrer', {
        ...arg(), extraction_id: extraction, type_document: [pj.pdf ? 'pdf' : '', pj.xlsx ? 'excel' : ''].filter(Boolean).join('+'),
        pieces: [pj.pdf ? `${nom}.pdf` : '', pj.xlsx ? `${nom}.xlsx` : ''].filter(Boolean), objet,
      });
      fermer(res.methode === 'outlook' ? 'Brouillon Outlook ouvert avec le document en pièce jointe. Relisez-le puis envoyez-le vous-même.' : "Message ouvert ; glissez-y les documents (téléchargez-les d'abord).");
    } catch (e) { setErreur((e as Error).message); }
  }

  return (
    <div className="voile">
      <div className="fenetre">
        <div className="entete"><h2>Envoyer par e-mail — {apprenti ? `${apprenti.nom.toUpperCase()} ${apprenti.prenom}` : 'tableau collectif'}</h2><button onClick={() => fermer()}>Fermer</button></div>
        {!individuel && <p className="discret">Document collectif : il ne peut pas être envoyé à une entreprise (une entreprise ne reçoit que les données de son propre apprenti). Ouvrez le tableau individuel d'un apprenti pour écrire à son entreprise.</p>}
        <ChoixDestinataires destinataires={dest} envoi={envoi} onChange={setEnvoi} />
        {sanctionsDispo && (
          <fieldset>
            <label className="case"><input type="checkbox" checked={avecSanctions} onChange={(e) => setAvecSanctions(e.target.checked)} /> Inclure les sanctions dans le document</label>
            {avecSanctions && (
              <>
                <p className="alerte-texte">⚠ Données disciplinaires : cochez uniquement les destinataires expressément autorisés à les recevoir. Une entreprise ne doit normalement pas les recevoir.</p>
                {adresses.map((a) => (
                  <label key={a} className="case"><input type="checkbox" checked={autorises.includes(a.toLowerCase())} onChange={(e) => setAutorises(e.target.checked ? [...autorises, a.toLowerCase()] : autorises.filter((x) => x !== a.toLowerCase()))} /> Autoriser les sanctions pour {a}</label>
                ))}
              </>
            )}
          </fieldset>
        )}
        <label className="case"><input type="checkbox" checked={pj.pdf} onChange={(e) => setPj({ ...pj, pdf: e.target.checked })} /> Joindre le PDF</label>
        <label className="case"><input type="checkbox" checked={pj.xlsx} onChange={(e) => setPj({ ...pj, xlsx: e.target.checked })} /> Joindre le fichier Excel</label>
        <label>Objet<input value={objet} onChange={(e) => setObjet(e.target.value)} /></label>
        <label>Message<textarea rows={6} value={corps} onChange={(e) => setCorps(e.target.value)} /></label>
        {controle && (
          <div>
            {controle.erreurs.map((e) => <p key={e} className="erreur">✖ {e}</p>)}
            {controle.avertissements.map((w) => (
              <p key={w} className="alerte-texte">⚠ {w} <button onClick={() => setConfirmes([...confirmes, w.split(' : ')[0].toLowerCase()])}>Confirmer cette adresse</button></p>
            ))}
            {controle.ok && <p className="succes">✔ Destinataires vérifiés : {controle.verifies.map((v) => `${v.adresse} (${v.nature === 'entreprise' ? "entreprise de l'apprenti" : v.nature === 'pp' ? 'professeur principal' : 'adresse libre confirmée'})`).join(' ; ')}</p>}
          </div>
        )}
        {erreur && <p className="erreur">{erreur}</p>}
        <div className="actions">
          <button onClick={telecharger}>Télécharger avant l'envoi</button>
          <button onClick={controler}>Vérifier les destinataires</button>
          <button className="principal" disabled={!adresses.length || (!pj.pdf && !pj.xlsx)} onClick={envoyer}>Valider et ouvrir le brouillon</button>
          <button onClick={() => fermer()}>Annuler</button>
        </div>
        <p className="discret">Rien n'est envoyé sans votre validation : le message s'ouvre en brouillon Outlook avec le document joint.</p>
      </div>
    </div>
  );
}

function HistoriqueRecap() {
  type H = { extractions: ExtractionRecap[]; transmissions: TransmissionRecap[] };
  const [h, setH] = useState<H | null>(null);
  const [verif, setVerif] = useState<Record<number, boolean>>({});
  const [selE, setSelE] = useState<number[]>([]);
  const [selT, setSelT] = useState<number[]>([]);
  const [msg, setMsg] = useState('');
  const charger = () => appeler<H>('recap:historique').then(setH);
  useEffect(() => { charger(); }, []);
  const crit = (x: ExtractionRecap) => {
    try { const c = JSON.parse(x.criteres); return `classes : ${c.classe_ids.length ? c.classe_ids.length : 'toutes'}${c.recherche ? ` ; « ${c.recherche} »` : ''}`; } catch { return ''; }
  };
  const bascule = (l: number[], set: (v: number[]) => void, id: number) => set(l.includes(id) ? l.filter((i) => i !== id) : [...l, id]);
  const tout = (l: number[], set: (v: number[]) => void, ids: number[]) => set(l.length === ids.length ? [] : ids);
  async function supprimer(action: string, ids: number[], libelle: string, avert: string, reset: () => void) {
    if (!ids.length) return;
    if (!confirm(`Supprimer ${ids.length} ${libelle} de l'historique ?\n\n${avert}`)) return;
    try {
      const n = await appeler<number>(action, { ids });
      setMsg(`${n} ${libelle} supprimé(s).`);
      reset();
      await charger();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  }
  if (!h) return null;
  const idsE = h.extractions.map((x) => x.id);
  const idsT = h.transmissions.map((t) => t.id);
  return (
    <>
      {msg && <p className="discret">{msg}</p>}
      <h3>Extractions</h3>
      <div className="barre-actions">
        <button disabled={!selE.length} onClick={() => supprimer('recap:extraction:supprimer', selE, 'extraction(s)', 'Les fichiers déjà enregistrés sur votre disque ne sont pas touchés.', () => setSelE([]))}>Supprimer la sélection ({selE.length})</button>
      </div>
      <table className="tableau"><thead><tr><th><input type="checkbox" aria-label="Tout sélectionner" checked={!!idsE.length && selE.length === idsE.length} onChange={() => tout(selE, setSelE, idsE)} /></th><th>Date</th><th>Utilisateur</th><th>Période</th><th>Domaines</th><th>Critères</th><th>Apprentis</th><th>Usage</th><th>État</th><th></th></tr></thead>
        <tbody>
          {h.extractions.length === 0 && <tr><td colSpan={10} className="discret">Aucune extraction.</td></tr>}
          {h.extractions.map((x) => (
            <tr key={x.id}><td><input type="checkbox" checked={selE.includes(x.id)} onChange={() => bascule(selE, setSelE, x.id)} /></td><td>{formaterDate(x.date_extraction.slice(0, 10))} {x.date_extraction.slice(11, 16)}</td><td>{x.utilisateur ?? '—'}</td><td>{formaterDate(x.debut)} → {formaterDate(x.fin)}</td><td>{x.domaines}</td><td>{crit(x)}</td><td>{x.nb_apprentis}</td><td>{x.usage}</td>
              <td>{verif[x.id] === undefined ? <button onClick={async () => { const v = await appeler<{ a_jour: boolean }>('recap:verifier', { extraction_id: x.id }); setVerif({ ...verif, [x.id]: v.a_jour }); }}>Vérifier</button> : verif[x.id] ? <span className="etiquette st-vert">À jour</span> : <span className="etiquette st-orange">Données modifiées : régénérer</span>}</td>
              <td><button title="Supprimer cette ligne" onClick={() => supprimer('recap:extraction:supprimer', [x.id], 'extraction(s)', 'Les fichiers déjà enregistrés sur votre disque ne sont pas touchés.', () => setSelE(selE.filter((i) => i !== x.id)))}>Supprimer</button></td></tr>
          ))}
        </tbody></table>
      <h3>Transmissions</h3>
      <div className="barre-actions">
        <button disabled={!selT.length} onClick={() => supprimer('recap:transmission:supprimer', selT, 'transmission(s)', 'Attention : la trace de ces envois (qui, à qui, quand) sera définitivement perdue.', () => setSelT([]))}>Supprimer la sélection ({selT.length})</button>
      </div>
      <table className="tableau"><thead><tr><th><input type="checkbox" aria-label="Tout sélectionner" checked={!!idsT.length && selT.length === idsT.length} onChange={() => tout(selT, setSelT, idsT)} /></th><th>Date</th><th>Utilisateur</th><th>Destinataire(s)</th><th>Apprenti</th><th>Document</th><th>Domaines</th><th>Sanctions</th><th></th></tr></thead>
        <tbody>
          {h.transmissions.length === 0 && <tr><td colSpan={9} className="discret">Aucune transmission.</td></tr>}
          {h.transmissions.map((t) => (
            <tr key={t.id}><td><input type="checkbox" checked={selT.includes(t.id)} onChange={() => bascule(selT, setSelT, t.id)} /></td><td>{formaterDate(t.date_envoi.slice(0, 10))} {t.date_envoi.slice(11, 16)}</td><td>{t.utilisateur ?? '—'}</td><td>{(JSON.parse(t.destinataires) as string[]).join(', ')}</td><td>{t.jeune_nom ? `${t.jeune_nom.toUpperCase()} ${t.jeune_prenom}` : 'collectif'}</td><td>{t.type_document}</td><td>{t.domaines}</td><td>{t.avec_sanctions ? 'oui' : 'non'}</td>
              <td><button title="Supprimer cette ligne" onClick={() => supprimer('recap:transmission:supprimer', [t.id], 'transmission(s)', 'Attention : la trace de cet envoi sera définitivement perdue.', () => setSelT(selT.filter((i) => i !== t.id)))}>Supprimer</button></td></tr>
          ))}
        </tbody></table>
      <p className="discret">Dernier chargement : {aujourdhui().split('-').reverse().join('/')}. Les brouillons ouverts dans Outlook sont journalisés au moment où vous les validez.</p>
    </>
  );
}
