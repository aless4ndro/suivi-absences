import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { appeler, type Affectation, type AlertesPP, type Classe, type Professeur } from '../api';
import { aujourdhui, formaterDate } from '../format';

const VIDE: Professeur = { nom: '', prenom: '', email: '', telephone: '', fonction: '', observations: '', actif: 1 };
const formationDe = (libelle: string) => libelle.split(' — ')[0].trim();
const anneeDe = (iso: string) => {
  const a = Number(iso.slice(0, 4));
  return Number(iso.slice(5, 7)) >= 9 ? `${a}-${a + 1}` : `${a - 1}-${a}`;
};

type FormAffectation = {
  classe_id: string; professeur_id: string; annee_scolaire: string; date_debut: string; date_fin: string; note: string; titre: string;
};

export default function Professeurs() {
  const [classes, setClasses] = useState<Classe[]>([]);
  const [profs, setProfs] = useState<Professeur[]>([]);
  const [affectations, setAffectations] = useState<Affectation[]>([]);
  const [annees, setAnnees] = useState<string[]>([]);
  const [alertes, setAlertes] = useState<AlertesPP | null>(null);
  const [annee, setAnnee] = useState(anneeDe(aujourdhui()));
  const [formation, setFormation] = useState('');
  const [classeId, setClasseId] = useState('');
  const [recherche, setRecherche] = useState('');
  const [historique, setHistorique] = useState(false);
  const [profFiltre, setProfFiltre] = useState<Professeur | null>(null);
  const [rechercheProf, setRechercheProf] = useState('');
  const [fiche, setFiche] = useState<Professeur | null>(null);
  const [form, setForm] = useState<FormAffectation | null>(null);
  const [erreur, setErreur] = useState('');
  const [erreurFiche, setErreurFiche] = useState('');
  const [info, setInfo] = useState('');
  const [fin, setFin] = useState<{ a: Affectation; date: string } | null>(null);

  const formations = useMemo(() => [...new Set(classes.map((c) => formationDe(c.libelle)))], [classes]);

  const chargerProfs = () => appeler<Professeur[]>('profs:list', { recherche: rechercheProf }).then(setProfs);
  const chargerAffectations = () => Promise.all([
    appeler<Affectation[]>('pp:list', {
      annee: annee || undefined, formation: formation || undefined, classe_id: classeId || undefined,
      professeur_id: profFiltre?.id, recherche: recherche || undefined, historique,
    }).then(setAffectations),
    appeler<AlertesPP>('pp:alertes', annee).then(setAlertes),
  ]);
  const toutRecharger = () => { chargerProfs(); chargerAffectations(); };

  useEffect(() => {
    appeler<Classe[]>('classes:list').then(setClasses);
    appeler<string[]>('pp:annees').then(setAnnees);
  }, []);
  useEffect(() => { chargerProfs().catch((e) => setErreur(e.message)); }, [rechercheProf]);
  useEffect(() => { chargerAffectations().catch((e) => setErreur(e.message)); }, [annee, formation, classeId, recherche, historique, profFiltre]);

  // Classes de l'année affichée sans professeur principal (lignes « à désigner » dans le tableau).
  const sansPP = classes
    .filter((c) => !classeId || String(c.id) === classeId)
    .filter((c) => !formation || formationDe(c.libelle) === formation)
    .filter((c) => alertes?.sans_pp.includes(c.code));
  const actifs = profs.filter((p) => p.actif);

  // ---- fiches professeurs
  const champ = (cle: keyof Professeur) => ({
    value: (fiche?.[cle] as string | null) ?? '',
    onChange: (e: { target: { value: string } }) => setFiche({ ...fiche!, [cle]: e.target.value }),
  });

  async function enregistrerFiche(e: FormEvent, confirmer_homonyme = false) {
    e.preventDefault();
    if (!fiche) return;
    try {
      const r = await appeler<number | { a_confirmer: string }>('profs:save', { ...fiche, confirmer_homonyme });
      if (typeof r === 'object' && r.a_confirmer) {
        if (confirm(r.a_confirmer)) return enregistrerFiche(e, true);
        return;
      }
      setFiche(null); setErreurFiche(''); setInfo('Fiche enregistrée. Les coordonnées seront reprises dans les prochains mails.');
      toutRecharger();
    } catch (err) { setErreurFiche((err as Error).message); }
  }

  async function basculerActif(p: Professeur) {
    try {
      await appeler('profs:save', { ...p, actif: p.actif ? 0 : 1, confirmer_homonyme: true });
      setErreur(''); toutRecharger();
    } catch (err) { setErreur((err as Error).message); }
  }

  async function supprimerFiche(p: Professeur) {
    if (!confirm(`Supprimer définitivement la fiche de ${p.prenom} ${p.nom} ?`)) return;
    try { await appeler('profs:delete', p.id); setErreur(''); toutRecharger(); } catch (err) { setErreur((err as Error).message); }
  }

  // ---- affectations
  function nouvelleAffectation(classe?: number, remplacement?: Affectation) {
    const auj = aujourdhui();
    const courante = anneeDe(auj);
    setErreur('');
    setForm({
      classe_id: classe ? String(classe) : remplacement ? String(remplacement.classe_id) : classeId,
      professeur_id: '',
      annee_scolaire: remplacement?.annee_scolaire ?? annee ?? courante,
      // remplacement : à partir d'aujourd'hui ; nouvelle désignation : début de l'année scolaire choisie
      date_debut: remplacement ? (remplacement.date_debut < auj ? auj : remplacement.date_debut) : (annee === courante ? auj : `${(annee || courante).slice(0, 4)}-09-01`),
      date_fin: '', note: '',
      titre: remplacement ? `Remplacer ${remplacement.prenom} ${remplacement.nom} (${remplacement.classe_code})` : 'Affecter un professeur principal',
    });
  }

  async function enregistrerAffectation(e: FormEvent, remplacer = false) {
    e.preventDefault();
    if (!form) return;
    if (anneeDe(form.date_debut) !== form.annee_scolaire) {
      setErreur(`La date de début doit être dans l'année scolaire ${form.annee_scolaire}.`);
      return;
    }
    try {
      const r = await appeler<number | { a_confirmer: string }>('pp:affecter', { ...form, remplacer });
      if (typeof r === 'object' && r.a_confirmer) {
        if (confirm(r.a_confirmer)) return enregistrerAffectation(e, true);
        return;
      }
      setForm(null); setErreur(''); setInfo('Affectation enregistrée.');
      appeler<string[]>('pp:annees').then(setAnnees);
      toutRecharger();
    } catch (err) { setErreur((err as Error).message); }
  }

  async function terminer(e: FormEvent) {
    e.preventDefault();
    if (!fin) return;
    try {
      await appeler('pp:terminer', { id: fin.a.id, date_fin: fin.date });
      setFin(null); setErreur(''); toutRecharger();
    } catch (err) { setErreur((err as Error).message); }
  }

  async function supprimerAffectation(a: Affectation) {
    if (!confirm(`Effacer cette affectation (${a.prenom} ${a.nom} — ${a.classe_code}, ${a.annee_scolaire}) ?\n\nÀ n'utiliser que pour une erreur de saisie : pour un changement de professeur, utilisez « Remplacer » ou « Terminer », qui gardent l'historique.`)) return;
    try { await appeler('pp:supprimer', a.id); setErreur(''); toutRecharger(); } catch (err) { setErreur((err as Error).message); }
  }

  const statut = (a: Affectation) => a.en_cours ? <span className="etiquette st-vert">en cours</span>
    : a.a_venir ? <span className="etiquette st-bleu">à venir</span> : <span className="etiquette">terminée</span>;

  const nbAlertes = alertes ? alertes.sans_pp.length + alertes.sans_email.length + alertes.inactifs.length : 0;

  return (
    <section>
      <div className="entete">
        <h1>Professeurs principaux</h1>
        <div className="actions" style={{ marginTop: 0 }}>
          <button onClick={() => { setErreurFiche(''); setFiche({ ...VIDE }); }}>Nouveau professeur</button>
          <button className="principal" onClick={() => nouvelleAffectation()}>Affecter un professeur principal</button>
        </div>
      </div>

      {alertes && nbAlertes > 0 && (
        <div className="bloc-alertes">
          <strong>Points d'attention — {alertes.annee}</strong>
          <ul>
            {alertes.sans_pp.length > 0 && <li>{alertes.sans_pp.length} classe(s) sans professeur principal{alertes.annee === anneeDe(aujourdhui()) ? " aujourd'hui" : ' à la rentrée'} : {alertes.sans_pp.join(', ')}.</li>}
            {alertes.sans_email.length > 0 && <li>Sans adresse e-mail (impossible de les mettre en copie) : {alertes.sans_email.join(', ')}.</li>}
            {alertes.inactifs.length > 0 && <li>Fiche inactive mais affectation en cours : {alertes.inactifs.join(', ')}.</li>}
          </ul>
        </div>
      )}
      {info && <p className="succes">{info}</p>}
      {erreur && !form && !fin && <p className="erreur">{erreur}</p>}

      <h2>Affectations</h2>
      <div className="filtres">
        <select value={annee} onChange={(e) => setAnnee(e.target.value)}>
          <option value="">Toutes les années</option>
          {annees.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={formation} onChange={(e) => setFormation(e.target.value)}>
          <option value="">Toutes les formations</option>
          {formations.map((f) => <option key={f}>{f}</option>)}
        </select>
        <select value={classeId} onChange={(e) => setClasseId(e.target.value)}>
          <option value="">Toutes les classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
        </select>
        <input placeholder="Rechercher (nom, prénom, classe)" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        <label className="case"><input type="checkbox" checked={historique} onChange={(e) => setHistorique(e.target.checked)} /> Inclure les affectations terminées</label>
        {profFiltre && <button onClick={() => setProfFiltre(null)}>Historique de {profFiltre.prenom} {profFiltre.nom} ✕</button>}
      </div>

      <table>
        <thead>
          <tr><th>Formation / Classe</th><th>Professeur principal</th><th>E-mail</th><th>Téléphone</th><th>Année scolaire</th><th>Période</th><th></th></tr>
        </thead>
        <tbody>
          {affectations.map((a) => (
            <tr key={a.id}>
              <td><strong>{a.classe_code}</strong><br /><span className="discret">{a.formation}</span></td>
              <td>{a.prenom} {a.nom.toUpperCase()} {!a.actif && <span className="etiquette st-rouge">inactif</span>}{a.note && <><br /><span className="discret">{a.note}</span></>}</td>
              <td>{a.email || <span className="alerte-texte">manquant</span>}</td>
              <td className="nowrap">{a.telephone || '—'}</td>
              <td>{a.annee_scolaire}</td>
              <td>{formaterDate(a.date_debut)} → {formaterDate(a.fin_effective)} {statut(a)}</td>
              <td className="actions-ligne">
                {(a.en_cours || a.a_venir) && <button onClick={() => nouvelleAffectation(undefined, a)}>Remplacer</button>}
                {(a.en_cours || a.a_venir) && <button onClick={() => { setErreur(''); setFin({ a, date: aujourdhui() < a.date_debut ? a.date_debut : aujourdhui() }); }}>Terminer</button>}
                <button className="lien-danger" onClick={() => supprimerAffectation(a)} title="Erreur de saisie uniquement">Effacer</button>
              </td>
            </tr>
          ))}
          {!profFiltre && !recherche && annee && sansPP.map((c) => (
            <tr key={`sans-${c.id}`} className="ligne-manquante">
              <td><strong>{c.code}</strong><br /><span className="discret">{formationDe(c.libelle)}</span></td>
              <td colSpan={5}><span className="alerte-texte">Aucun professeur principal désigné</span></td>
              <td><button onClick={() => nouvelleAffectation(c.id)}>Désigner</button></td>
            </tr>
          ))}
          {affectations.length === 0 && sansPP.length === 0 && <tr><td colSpan={7} className="discret">Aucune affectation pour ces critères.</td></tr>}
        </tbody>
      </table>

      <h2>Répertoire des professeurs</h2>
      <div className="filtres">
        <input placeholder="Rechercher un professeur (nom, prénom, classe)" value={rechercheProf} onChange={(e) => setRechercheProf(e.target.value)} />
      </div>
      <table>
        <thead><tr><th>Nom</th><th>E-mail</th><th>Téléphone</th><th>Fonction</th><th>Classes actuelles</th><th>Statut</th><th></th></tr></thead>
        <tbody>
          {profs.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.nom.toUpperCase()}</strong> {p.prenom}{p.observations && <><br /><span className="discret">{p.observations}</span></>}</td>
              <td>{p.email || <span className="alerte-texte">manquant</span>}</td>
              <td className="nowrap">{p.telephone || '—'}</td>
              <td>{p.fonction || '—'}</td>
              <td>{p.classes_actuelles?.join(', ') || <span className="discret">aucune</span>}</td>
              <td>{p.actif ? <span className="etiquette st-vert">actif</span> : <span className="etiquette st-rouge">inactif</span>}</td>
              <td className="actions-ligne">
                <button onClick={() => { setErreurFiche(''); setFiche({ ...p }); }}>Modifier</button>
                <button onClick={() => { setProfFiltre(p); setHistorique(true); setAnnee(''); setClasseId(''); setFormation(''); }}>Affectations</button>
                <button onClick={() => basculerActif(p)}>{p.actif ? 'Désactiver' : 'Réactiver'}</button>
                {!p.nb_affectations && <button className="lien-danger" onClick={() => supprimerFiche(p)}>Supprimer</button>}
              </td>
            </tr>
          ))}
          {profs.length === 0 && <tr><td colSpan={7} className="discret">Aucun professeur enregistré : commencez par « Nouveau professeur ».</td></tr>}
        </tbody>
      </table>

      {fiche && (
        <div className="voile">
          <form className="fenetre" onSubmit={(e) => enregistrerFiche(e)}>
            <div className="entete"><h2>{fiche.id ? 'Modifier la fiche' : 'Nouveau professeur principal'}</h2><button type="button" onClick={() => setFiche(null)}>Fermer</button></div>
            <div className="grille">
              <label>Nom *<input {...champ('nom')} required autoFocus /></label>
              <label>Prénom *<input {...champ('prenom')} required /></label>
              <label>E-mail professionnel<input type="email" {...champ('email')} /></label>
              <label>Téléphone<input {...champ('telephone')} /></label>
              <label>Fonction / intitulé du poste<input {...champ('fonction')} /></label>
              <label>Statut
                <select value={fiche.actif ? '1' : '0'} onChange={(e) => setFiche({ ...fiche, actif: Number(e.target.value) })}>
                  <option value="1">Actif</option><option value="0">Inactif</option>
                </select>
              </label>
            </div>
            <label>Observations<textarea rows={3} {...champ('observations')} /></label>
            {!fiche.email && <p className="alerte-texte">⚠ Sans adresse e-mail, ce professeur ne pourra pas être mis en destinataire ou en copie.</p>}
            {fiche.id && (fiche.classes_actuelles?.length ?? 0) > 0 && <p className="discret">Professeur principal actuellement de : {fiche.classes_actuelles!.join(', ')}.</p>}
            {erreurFiche && <p className="erreur">{erreurFiche}</p>}
            <div className="actions"><button className="principal" type="submit">Enregistrer</button></div>
          </form>
        </div>
      )}

      {form && (
        <div className="voile">
          <form className="fenetre" onSubmit={(e) => enregistrerAffectation(e)}>
            <div className="entete"><h2>{form.titre}</h2><button type="button" onClick={() => { setForm(null); setErreur(''); }}>Fermer</button></div>
            <div className="grille">
              <label>Classe *
                <select value={form.classe_id} onChange={(e) => setForm({ ...form, classe_id: e.target.value })} required>
                  <option value="">— choisir —</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
                </select>
              </label>
              <label>Année scolaire *
                <select value={form.annee_scolaire} onChange={(e) => setForm({ ...form, annee_scolaire: e.target.value, date_debut: `${e.target.value.slice(0, 4)}-09-01` })}>
                  {annees.map((a) => <option key={a}>{a}</option>)}
                </select>
              </label>
              <label>Professeur principal *
                <select value={form.professeur_id} onChange={(e) => setForm({ ...form, professeur_id: e.target.value })} required>
                  <option value="">— choisir —</option>
                  {actifs.map((p) => <option key={p.id} value={p.id}>{p.nom.toUpperCase()} {p.prenom}{p.email ? '' : ' (sans e-mail)'}</option>)}
                </select>
              </label>
              <label>À partir du *<input type="date" value={form.date_debut} onChange={(e) => setForm({ ...form, date_debut: e.target.value })} required /></label>
              <label>Jusqu'au (facultatif)<input type="date" value={form.date_fin} onChange={(e) => setForm({ ...form, date_fin: e.target.value })} /></label>
              <label>Note<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="ex. remplacement congé maternité" /></label>
            </div>
            {actifs.length === 0 && <p className="erreur">Aucun professeur actif : créez d'abord une fiche avec « Nouveau professeur ».</p>}
            <p className="discret">Sans date de fin, l'affectation court jusqu'au 31/08 de l'année scolaire. Si la classe a déjà un professeur principal, l'appli proposera de le remplacer : l'ancienne affectation sera close la veille et gardée dans l'historique.</p>
            {erreur && <p className="erreur">{erreur}</p>}
            <div className="actions"><button className="principal" type="submit">Enregistrer</button></div>
          </form>
        </div>
      )}
      {fin && (
        <div className="voile">
          <form className="fenetre petite" onSubmit={terminer}>
            <div className="entete"><h2>Terminer l'affectation</h2><button type="button" onClick={() => { setFin(null); setErreur(''); }}>Fermer</button></div>
            <p>{fin.a.prenom} {fin.a.nom} — professeur principal de {fin.a.classe_code} ({fin.a.annee_scolaire}).</p>
            <label>Dernier jour<input type="date" value={fin.date} onChange={(e) => setFin({ ...fin, date: e.target.value })} required /></label>
            <p className="discret">L'affectation reste visible dans l'historique. Pensez à désigner un successeur : sinon la classe n'aura plus de professeur principal après cette date.</p>
            {erreur && <p className="erreur">{erreur}</p>}
            <div className="actions"><button className="principal" type="submit">Terminer</button></div>
          </form>
        </div>
      )}
    </section>
  );
}
