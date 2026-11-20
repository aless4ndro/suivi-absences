import { useEffect, useMemo, useState } from 'react';
import { appeler, fichiers, type ImportAnalyse, type ImportCandidat, type ImportDecisions, type ImportFichier, type ImportHistorique, type ImportLigne } from '../api';
import { formaterDate, formaterDateHeure } from '../format';

type LigneN = { champs: Record<string, any>; anomalies: string[]; source?: { feuille: string | null; ligne: number } };
type Classe = { id: number; code: string; libelle: string };

const CHAMPS_EDITABLES: [string, string][] = [
  ['nom', 'Nom'], ['prenom', 'Prénom'], ['date_naissance', 'Naissance (AAAA-MM-JJ)'], ['telephone', 'Téléphone'], ['email', 'E-mail'],
  ['adresse', 'Adresse'], ['code_postal', 'Code postal'], ['ville', 'Ville'],
  ['ent_nom', 'Entreprise'], ['ent_siret', 'SIRET'], ['ent_adresse', 'Adresse entreprise'], ['ent_code_postal', 'CP entreprise'], ['ent_ville', 'Ville entreprise'],
  ['ent_telephone', 'Tél. entreprise'], ['ent_email', 'E-mail entreprise'],
  ['maitre_nom', 'Tuteur'], ['maitre_fonction', 'Fonction du tuteur'], ['maitre_telephone', 'Tél. tuteur'], ['maitre_email', 'E-mail tuteur'],
  ['contrat_type', 'Type de contrat'], ['contrat_debut', 'Début (AAAA-MM-JJ)'], ['contrat_fin', 'Fin (AAAA-MM-JJ)'],
];
const NOMS_CHAMP: Record<string, string> = Object.fromEntries([...CHAMPS_EDITABLES, ['nom_commercial', 'Nom commercial'], ['siret', 'SIRET']]);
const STATUTS: Record<string, string> = { ok: 'Prête', attention: 'À vérifier', a_confirmer: 'À trancher', bloque: 'Bloquée', exclu: 'Exclue' };
const COULEURS: Record<string, string> = { ok: '#1f7a3d', attention: '#b86e00', a_confirmer: '#c0392b', bloque: '#c0392b', exclu: '#7b8798' };

function anneesScolaires(): string[] {
  const t = new Date();
  const a = t.getMonth() >= 8 ? t.getFullYear() : t.getFullYear() - 1;
  return [a - 1, a, a + 1, a + 2].map((x) => `${x}-${x + 1}`);
}
const anneeCourante = () => { const t = new Date(); const a = t.getMonth() >= 8 ? t.getFullYear() : t.getFullYear() - 1; return `${a}-${a + 1}`; };
const libCandidat = (c: ImportCandidat) => `${c.nom}${c.prenom ? ` ${c.prenom}` : ''}${c.date_naissance ? ` — né(e) le ${formaterDate(c.date_naissance)}` : ''}${c.classe_code ? ` — ${c.classe_code}` : ''}${c.entreprise_nom ? ` — ${c.entreprise_nom}` : ''}${c.siret ? ` — SIRET ${c.siret}` : ''}${c.ville ? ` — ${c.code_postal ?? ''} ${c.ville}` : ''}`;

export default function ImportDonnees() {
  const [onglet, setOnglet] = useState<'import' | 'historique'>('import');
  const [etape, setEtape] = useState<'depart' | 'colonnes' | 'apercu' | 'fini'>('depart');
  const [classes, setClasses] = useState<Classe[]>([]);
  const [annee, setAnnee] = useState(anneeCourante());
  const [classeDefaut, setClasseDefaut] = useState('');
  const [fichier, setFichier] = useState<ImportFichier | null>(null);
  const [champs, setChamps] = useState<(string | null)[][]>([]);
  const [feuillesActives, setFeuillesActives] = useState<boolean[]>([]);
  const [lignes, setLignes] = useState<LigneN[]>([]);
  const [classesMap, setClassesMap] = useState<Record<string, number>>({});
  const [decisions, setDecisions] = useState<ImportDecisions>({ lignes: {}, entreprises: {} });
  const [analyse, setAnalyse] = useState<ImportAnalyse | null>(null);
  const [ouverte, setOuverte] = useState<number | null>(null);
  const [filtre, setFiltre] = useState<'toutes' | 'problemes'>('toutes');
  const [resultat, setResultat] = useState<Record<string, number> | null>(null);
  const [erreur, setErreur] = useState('');
  const [historique, setHistorique] = useState<ImportHistorique[]>([]);
  const [info, setInfo] = useState('');

  useEffect(() => { appeler<Classe[]>('import:classes').then(setClasses); }, []);
  const chargerHistorique = () => appeler<ImportHistorique[]>('import:historique').then(setHistorique);
  useEffect(() => { if (onglet === 'historique') chargerHistorique(); }, [onglet]);

  const arg = useMemo(() => ({ lignes, annee_scolaire: annee, classe_defaut: classeDefaut ? Number(classeDefaut) : null, classes_map: classesMap, decisions, fichier: fichier?.nom }), [lignes, annee, classeDefaut, classesMap, decisions, fichier]);
  useEffect(() => {
    if (etape !== 'apercu') return;
    appeler<ImportAnalyse>('import:analyser', arg).then((a) => { setAnalyse(a); setErreur(''); }).catch((e) => setErreur((e as Error).message));
  }, [etape, arg]);

  async function choisir() {
    setErreur(''); setInfo('');
    try {
      const f = await fichiers<ImportFichier>('lireImport');
      if (f.annule) return;
      setFichier(f); setChamps(f.feuilles.map((x) => x.champs)); setFeuillesActives(f.feuilles.map((x) => x.champs.includes('nom') || x.champs.includes('nom_prenom'))); setEtape('colonnes');
    } catch (e) { setErreur((e as Error).message); }
  }
  async function continuerColonnes() {
    if (!fichier) return;
    const choisies = fichier.feuilles.map((f, i) => ({ ...f, champs: champs[i] })).filter((_, i) => feuillesActives[i]);
    if (!choisies.length) { setErreur('Cochez au moins une feuille à importer.'); return; }
    for (const f of choisies) {
      if (!(f.champs.includes('nom') || f.champs.includes('nom_prenom')) || !(f.champs.includes('prenom') || f.champs.includes('nom_prenom'))) { setErreur(`Feuille « ${f.nom ?? 'fichier'} » : indiquez les colonnes du nom et du prénom des apprentis.`); return; }
    }
    try {
      const l = await fichiers<LigneN[]>('normaliserImport', { feuilles: choisies.map((f) => ({ nom: f.nom, lignes: f.lignes, numeros: f.numeros, champs: f.champs })) });
      if (!l.length) { setErreur('Aucun apprenti trouvé dans les feuilles choisies.'); return; }
      setLignes(l); setDecisions({ lignes: {}, entreprises: {} }); setClassesMap({}); setOuverte(null); setErreur(''); setEtape('apercu');
    } catch (e) { setErreur((e as Error).message); }
  }

  const majLigne = (i: number, p: Partial<ImportDecisions['lignes'][number]>) => setDecisions((d) => ({ ...d, lignes: { ...d.lignes, [i]: { ...d.lignes[i], ...p } } }));
  const majEnt = (cle: string, p: Partial<ImportDecisions['entreprises'][string]>) => setDecisions((d) => ({ ...d, entreprises: { ...d.entreprises, [cle]: { ...d.entreprises[cle], ...p } } }));
  const basculer = (liste: string[] | undefined, v: string, on: boolean) => (on ? [...(liste ?? []), v] : (liste ?? []).filter((x) => x !== v));
  const editer = (i: number, champ: string, v: string) => setLignes((ls) => ls.map((l, k) => (k === i ? { ...l, champs: { ...l.champs, [champ]: v.trim() === '' ? null : v } } : l)));

  async function valider() {
    if (!analyse) return;
    const r = analyse.resume;
    const nb = r.total - r.exclues;
    if (!confirm(`Importer ${nb} ligne(s) : ${r.apprentis_nouveaux} apprenti(s) créé(s), ${r.apprentis_existants} fiche(s) existante(s) complétée(s), ${r.entreprises_nouvelles} entreprise(s) créée(s) ?\n\nUne sauvegarde de la base est faite avant l'écriture. L'import pourra être annulé depuis l'historique.`)) return;
    try {
      const res = await fichiers<Record<string, number>>('validerImport', arg);
      setResultat(res); setEtape('fini'); setErreur('');
    } catch (e) { setErreur((e as Error).message); }
  }
  function recommencer() { setEtape('depart'); setFichier(null); setLignes([]); setAnalyse(null); setResultat(null); setErreur(''); }

  async function annulerImport(h: ImportHistorique) {
    if (!confirm(`Annuler l'import « ${h.fichier} » du ${formaterDateHeure(h.date_import)} ?\n\nLes fiches créées par cet import sont retirées (sauf celles déjà utilisées : absences, sanctions, rattachements) et les compléments reviennent à leur valeur précédente. Les données antérieures ne sont jamais supprimées.`)) return;
    try {
      const r = await appeler<{ defaits: number; conserves: string[] }>('import:annuler', h.id);
      setInfo(`Import annulé (${r.defaits} opération(s) défaite(s)).${r.conserves.length ? ` Conservés : ${r.conserves.join(' ; ')}.` : ''}`);
      setErreur(''); chargerHistorique();
    } catch (e) { setErreur((e as Error).message); }
  }
  async function rapport(id: number) {
    try { const r = await fichiers<{ annule?: boolean; chemin?: string }>('rapportImport', { id }); if (!r.annule) setInfo(`Rapport enregistré : ${r.chemin}`); } catch (e) { setErreur((e as Error).message); }
  }

  const visibles = (analyse?.lignes ?? []).filter((l) => filtre === 'toutes' || ['a_confirmer', 'bloque', 'attention'].includes(l.statut));

  return (
    <>
      <div className="entete"><h1>Import de données</h1></div>
      <div className="onglets">
        <button className={onglet === 'import' ? 'actif' : ''} onClick={() => setOnglet('import')}>Importer un fichier</button>
        <button className={onglet === 'historique' ? 'actif' : ''} onClick={() => setOnglet('historique')}>Historique des imports</button>
      </div>
      {erreur && <p className="erreur">{erreur}</p>}
      {info && <p className="info">{info}</p>}

      {onglet === 'historique' && (
        historique.length === 0 ? <p className="discret">Aucun import réalisé pour l'instant.</p> : (
          <table className="table">
            <thead><tr><th>Date</th><th>Fichier</th><th>Utilisateur</th><th>Année</th><th>Apprentis créés / mis à jour</th><th>Entreprises créées</th><th>Rapprochements</th><th>Anomalies</th><th /></tr></thead>
            <tbody>{historique.map((h) => (
              <tr key={h.id}>
                <td>{formaterDateHeure(h.date_import)}</td><td>{h.fichier}{h.statut === 'annule' && <div className="discret">Annulé le {formaterDateHeure(h.annule_le ?? '')}</div>}</td>
                <td>{h.utilisateur ?? '—'}</td><td>{h.annee_scolaire}</td><td>{h.nb_apprentis_crees} / {h.nb_apprentis_maj}</td><td>{h.nb_entreprises_creees}</td><td>{h.nb_rapprochements}</td><td>{h.nb_anomalies}</td>
                <td className="droite">
                  {h.nb_anomalies > 0 && <button onClick={() => rapport(h.id)}>Rapport d'anomalies</button>}{' '}
                  {h.statut === 'valide' && <button onClick={() => annulerImport(h)}>Annuler l'import</button>}
                </td>
              </tr>))}</tbody>
          </table>
        )
      )}

      {onglet === 'import' && etape === 'depart' && (
        <section className="fiche">
          <p>Importez un fichier Excel (.xlsx) ou CSV contenant des apprentis, leurs entreprises et leurs contrats. Les colonnes sont reconnues automatiquement, quel que soit leur ordre. Rien n'est enregistré avant votre validation sur l'écran récapitulatif.</p>
          <div className="grille">
            <label>Année scolaire concernée
              <select value={annee} onChange={(e) => setAnnee(e.target.value)}>{anneesScolaires().map((a) => <option key={a}>{a}</option>)}</select>
            </label>
            <label>Classe pour toutes les lignes (si le fichier n'en indique pas)
              <select value={classeDefaut} onChange={(e) => setClasseDefaut(e.target.value)}>
                <option value="">— d'après le fichier —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </label>
          </div>
          <div className="actions"><button className="principal" onClick={choisir}>Choisir le fichier…</button></div>
          <p className="discret">Un fichier .xls (ancien Excel) doit d'abord être enregistré en .xlsx ou en CSV.</p>
        </section>
      )}

      {onglet === 'import' && etape === 'colonnes' && fichier && (
        <section className="fiche">
          <h3>Fichier « {fichier.nom} » — {fichier.feuilles.length} feuille(s), {fichier.feuilles.reduce((n, f) => n + f.lignes.length, 0)} ligne(s)</h3>
          <p className="discret">Pour chaque feuille, vérifiez la correspondance proposée entre les colonnes et les informations de l'application ; corrigez-la si besoin. Sans colonne « classe », le nom de la feuille sert à retrouver la classe.</p>
          {fichier.feuilles.map((f, fi) => (
            <div key={fi} style={{ marginBottom: 18 }}>
              <label className="case"><input type="checkbox" checked={!!feuillesActives[fi]} onChange={(e) => setFeuillesActives(feuillesActives.map((a, k) => (k === fi ? e.target.checked : a)))} /> <strong>{f.nom ?? 'Fichier'}</strong> — {f.lignes.length} ligne(s)</label>
              {feuillesActives[fi] && (
                <table className="table">
                  <thead><tr><th>Colonne</th><th>Exemples</th><th>Information correspondante</th></tr></thead>
                  <tbody>{f.entetes.map((e, i) => (f.champs[i] || f.lignes.some((l) => l[i])) ? (
                    <tr key={i}>
                      <td><strong>{e || `(colonne ${i + 1})`}</strong></td>
                      <td className="discret">{f.lignes.slice(0, 2).map((l) => (l[i] ?? '').split(/\r?\n/)[0]).filter(Boolean).join(' · ')}</td>
                      <td><select value={champs[fi]?.[i] ?? ''} onChange={(ev) => setChamps(champs.map((cs, k) => (k !== fi ? cs : cs.map((c, j) => (j === i ? ev.target.value || null : c === ev.target.value && ev.target.value ? null : c)))))}>
                        <option value="">— ignorer —</option>{Object.entries(fichier.liste_champs).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select></td>
                    </tr>) : null)}</tbody>
                </table>
              )}
            </div>
          ))}
          <div className="actions"><button className="principal" onClick={continuerColonnes}>Analyser le fichier</button><button onClick={recommencer}>Annuler</button></div>
        </section>
      )}

      {onglet === 'import' && etape === 'apercu' && analyse && (
        <>
          <div className="cartes">
            <div className="carte"><span className="chiffre">{analyse.resume.apprentis_nouveaux}</span><strong>Apprentis à créer</strong></div>
            <div className="carte"><span className="chiffre">{analyse.resume.apprentis_existants}</span><strong>Fiches déjà existantes</strong><span className="discret">complétées sans rien écraser</span></div>
            <div className="carte"><span className="chiffre">{analyse.resume.entreprises_nouvelles}</span><strong>Entreprises à créer</strong></div>
            <div className="carte"><span className="chiffre">{analyse.resume.entreprises_existantes}</span><strong>Entreprises déjà enregistrées</strong></div>
            <div className="carte"><span className="chiffre">{analyse.resume.contrats}</span><strong>Contrats associés</strong></div>
            <div className={`carte${analyse.resume.anomalies || analyse.resume.a_confirmer ? ' alerte' : ''}`}><span className="chiffre">{analyse.resume.anomalies}</span><strong>Anomalies</strong><span className="discret">{analyse.resume.a_confirmer} à trancher · {analyse.resume.exclues} exclue(s) · {analyse.resume.manquants} avec infos manquantes</span></div>
          </div>

          {analyse.valeursClasse.length > 0 && (
            <section className="fiche">
              <h3>Classes</h3>
              <table className="table"><tbody>{analyse.valeursClasse.map((v) => (
                <tr key={v.cle}><td>« {v.texte} » dans le fichier</td>
                  <td><select value={classesMap[v.cle] ?? v.classe_id ?? ''} onChange={(e) => setClassesMap({ ...classesMap, [v.cle]: Number(e.target.value) })}>
                    <option value="">— choisir la classe —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
                  </select></td></tr>))}</tbody></table>
            </section>
          )}

          {analyse.entreprises.length > 0 && (
            <section className="fiche">
              <h3>Entreprises ({analyse.entreprises.length})</h3>
              <table className="table">
                <thead><tr><th>Entreprise du fichier</th><th>Lignes</th><th>Rapprochement</th></tr></thead>
                <tbody>{analyse.entreprises.map((e) => (
                  <tr key={e.cle}>
                    <td><strong>{e.nom}</strong>{e.siret && <div className="discret">SIRET {e.siret}</div>}</td>
                    <td>{e.lignes.length}</td>
                    <td>
                      {e.statut === 'existant' && <div>✔ Entreprise déjà enregistrée ({e.raison})</div>}
                      {e.statut === 'nouveau' && <div>＋ Nouvelle entreprise</div>}
                      {e.statut === 'a_confirmer' && <div style={{ color: '#c0392b' }}>⚠ Doute : {e.raison}</div>}
                      {(e.statut === 'a_confirmer' || e.candidats.length > 0) && (
                        <select value={decisions.entreprises[e.cle]?.id ?? ''} onChange={(ev) => majEnt(e.cle, { id: ev.target.value === 'nouveau' ? 'nouveau' : ev.target.value ? Number(ev.target.value) : undefined })}>
                          <option value="">{e.statut === 'a_confirmer' ? '— choisir —' : 'Proposition automatique'}</option>
                          {e.candidats.map((c) => <option key={c.id} value={c.id}>Rattacher à : {libCandidat(c)}</option>)}
                          <option value="nouveau">Créer une nouvelle entreprise</option>
                        </select>
                      )}
                      {e.completions.length > 0 && <div className="discret">Complète : {e.completions.map((c) => NOMS_CHAMP[c.champ] ?? c.champ).join(', ')}</div>}
                      {e.differences.map((d) => (
                        <label key={d.champ} className="case"><input type="checkbox" checked={!!d.remplacer} onChange={(ev) => majEnt(e.cle, { remplacer: basculer(decisions.entreprises[e.cle]?.remplacer, d.champ, ev.target.checked) })} /> Remplacer {NOMS_CHAMP[d.champ] ?? d.champ} « {d.actuel} » par « {d.fichier} »</label>
                      ))}
                    </td>
                  </tr>))}</tbody>
              </table>
            </section>
          )}

          <section className="fiche">
            <div className="entete"><h3>Lignes du fichier</h3>
              <select value={filtre} onChange={(e) => setFiltre(e.target.value as 'toutes' | 'problemes')}><option value="toutes">Toutes les lignes</option><option value="problemes">Seulement celles à vérifier</option></select>
            </div>
            <table className="table">
              <thead><tr><th>Importer</th><th>Ligne du fichier</th><th>État</th><th>Apprenti</th><th>Classe</th><th>Entreprise</th><th>Fiche</th><th /></tr></thead>
              <tbody>{visibles.map((l) => <LigneImport key={l.index} l={l} ouverte={ouverte === l.index} basculerOuverte={() => setOuverte(ouverte === l.index ? null : l.index)}
                classes={classes} entNom={analyse.entreprises.find((e) => e.cle === l.entreprise.cle)?.nom ?? ''} dec={decisions.lignes[l.index] ?? {}} majLigne={majLigne} editer={editer} basculer={basculer} />)}</tbody>
            </table>
          </section>
          <div className="actions">
            <button className="principal" onClick={valider}>Valider l'importation</button>
            <button onClick={() => setEtape('colonnes')}>Retour aux colonnes</button>
            <button onClick={recommencer}>Annuler l'importation (rien n'est enregistré)</button>
          </div>
        </>
      )}

      {onglet === 'import' && etape === 'fini' && resultat && (
        <section className="fiche">
          <h3>Import terminé</h3>
          <ul>
            <li>{resultat.apprentis_crees} fiche(s) apprenti créée(s), {resultat.apprentis_maj} fiche(s) existante(s) rapprochée(s)</li>
            <li>{resultat.entreprises_creees} entreprise(s) créée(s), {resultat.entreprises_maj} complétée(s)</li>
            <li>{resultat.contrats} contrat(s) associé(s) · {resultat.anomalies} anomalie(s) signalée(s)</li>
          </ul>
          <div className="actions">
            {resultat.anomalies > 0 && <button onClick={() => rapport(resultat.import_id)}>Télécharger le rapport d'anomalies</button>}
            <button className="principal" onClick={recommencer}>Importer un autre fichier</button>
            <button onClick={() => setOnglet('historique')}>Voir l'historique</button>
          </div>
        </section>
      )}
    </>
  );
}

function LigneImport({ l, ouverte, basculerOuverte, classes, entNom, dec, majLigne, editer, basculer }: {
  l: ImportLigne; ouverte: boolean; basculerOuverte: () => void; classes: Classe[]; entNom: string;
  dec: NonNullable<ImportDecisions['lignes'][number]>;
  majLigne: (i: number, p: Partial<ImportDecisions['lignes'][number]>) => void;
  editer: (i: number, champ: string, v: string) => void;
  basculer: (liste: string[] | undefined, v: string, on: boolean) => string[];
}) {
  const a = l.apprenti;
  const fiche = a.id ? 'Fiche existante' : a.statut === 'a_confirmer' ? 'Identité à confirmer' : 'Nouvelle fiche';
  return (
    <>
      <tr style={{ opacity: l.exclu ? 0.5 : 1 }}>
        <td><input type="checkbox" checked={!l.exclu} onChange={(e) => majLigne(l.index, { exclu: !e.target.checked })} /></td>
        <td>{l.etiquette}</td>
        <td><span style={{ color: COULEURS[l.statut], fontWeight: 600 }}>{STATUTS[l.statut]}</span></td>
        <td>{l.champs.nom} {l.champs.prenom}{l.champs.date_naissance && <div className="discret">né(e) le {formaterDate(l.champs.date_naissance)}</div>}</td>
        <td>{l.classe_code ?? <span style={{ color: '#c0392b' }}>?</span>}</td>
        <td>{entNom || <span className="discret">—</span>}</td>
        <td>{fiche}{l.contrat.action === 'nouveau_contrat' && <div className="discret">autre employeur que l'actuel</div>}</td>
        <td className="droite"><button onClick={basculerOuverte}>{ouverte ? 'Fermer' : 'Détails'}</button></td>
      </tr>
      {ouverte && (
        <tr><td colSpan={8}>
          {l.exclu_auto && <p className="discret">{l.exclu_auto}. Cochez « Importer » pour l'inclure malgré tout.</p>}
          {[...l.bloquants, ...l.anomalies].map((m) => <p key={m} className="alerte-texte">⚠ {m}</p>)}
          {(l.champs.contacts_extra ?? []).length > 0 && <p className="discret">Autres interlocuteurs ajoutés à l'entreprise : {(l.champs.contacts_extra as { nom: string; fonction: string | null }[]).map((c) => `${c.nom}${c.fonction ? ` (${c.fonction})` : ''}`).join(', ')}</p>}
          {l.manquants.length > 0 && <p className="discret">Informations manquantes (à compléter plus tard) : {l.manquants.map((m) => NOMS_CHAMP[m] ?? m).join(', ')}</p>}
          <div className="grille">
            {CHAMPS_EDITABLES.map(([k, lib]) => <label key={k}>{lib}<input value={l.champs[k] ?? ''} onChange={(e) => editer(l.index, k, e.target.value)} /></label>)}
            <label>Classe
              <select value={dec.classe_id ?? l.classe_id ?? ''} onChange={(e) => majLigne(l.index, { classe_id: e.target.value ? Number(e.target.value) : undefined })}>
                <option value="">— choisir —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </label>
          </div>
          {(a.candidats.length > 0 || a.statut === 'a_confirmer') && (
            <p>
              <strong>{a.statut === 'a_confirmer' ? `Doute : ${a.raison}. ` : ''}Rapprochement :</strong>{' '}
              <select value={dec.apprenti_id ?? (a.id ?? '')} onChange={(e) => majLigne(l.index, { apprenti_id: e.target.value === 'nouveau' ? 'nouveau' : e.target.value ? Number(e.target.value) : undefined })}>
                <option value="">{a.statut === 'a_confirmer' ? '— choisir —' : 'Proposition automatique'}</option>
                {a.candidats.map((c) => <option key={c.id} value={c.id}>Rattacher à : {libCandidat(c)}</option>)}
                <option value="nouveau">Créer une nouvelle fiche</option>
              </select>
            </p>
          )}
          {a.completions.length > 0 && <p className="discret">Champs vides de la fiche complétés : {a.completions.map((c) => NOMS_CHAMP[c.champ] ?? c.champ).join(', ')}</p>}
          {a.differences.map((d) => (
            <label key={d.champ} className="case"><input type="checkbox" checked={!!d.remplacer} onChange={(e) => majLigne(l.index, { remplacer: basculer(dec.remplacer, d.champ, e.target.checked) })} /> Remplacer {NOMS_CHAMP[d.champ] ?? d.champ} « {d.actuel} » par « {d.fichier} »</label>
          ))}
          {l.changement_classe && (
            <label className="case"><input type="checkbox" checked={!!dec.classe_changer} onChange={(e) => majLigne(l.index, { classe_changer: e.target.checked })} /> Placer l'apprenti en {l.changement_classe.vers} (actuellement en {l.changement_classe.de}) à partir de la rentrée</label>
          )}
          {l.contrat.action === 'nouveau_contrat' && (
            <label className="case"><input type="checkbox" checked={!!dec.nouveau_contrat} onChange={(e) => majLigne(l.index, { nouveau_contrat: e.target.checked })} /> Enregistrer un nouveau contrat avec cette entreprise (l'employeur actuel{l.contrat.entreprise_actuelle ? ` « ${l.contrat.entreprise_actuelle} »` : ''} reste dans l'historique)</label>
          )}
        </td></tr>
      )}
    </>
  );
}
