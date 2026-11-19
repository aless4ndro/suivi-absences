import { useEffect, useMemo, useState } from 'react';
import { appeler, fichiers, type Classe, type LectureCalendrier, type TypeJour } from './api';
import { formaterDate, NOMS_MOIS } from './format';

const TYPES: Record<TypeJour, string> = { centre: 'Centre de formation', entreprise: 'Entreprise', autre: 'Autre (examen, férié…)' };
const ORDRE: (TypeJour | null)[] = ['centre', 'entreprise', 'autre', null];
const p2 = (n: number) => String(n).padStart(2, '0');
const couleurCle = (cle: string) => (/^[0-9A-F]{6}$/.test(cle) ? `#${cle}` : '#e5e8ee');

type Jour = { type: TypeJour; libelle: string };

// Import d'un calendrier : choix de la classe et de l'année, lecture du fichier, aperçu corrigeable, validation.
export default function ImportCalendrier({ classes, classeId, annee, annees, onClose, onDone }: {
  classes: Classe[]; classeId: number; annee: string; annees: string[]; onClose: () => void; onDone: (classeId: number, annee: string) => void;
}) {
  const [cid, setCid] = useState(classeId);
  const [an, setAn] = useState(annee);
  const [operation, setOperation] = useState<'ajouter' | 'remplacer'>('ajouter');
  const [existant, setExistant] = useState<{ nb_jours: number; source: string | null } | null>(null);
  const [lecture, setLecture] = useState<LectureCalendrier | null>(null);
  const [mapping, setMapping] = useState<Record<string, TypeJour | ''>>({});
  const [manuels, setManuels] = useState<Record<string, Jour | null>>({});
  const [libelles, setLibelles] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    appeler<{ nb_jours: number; source: string | null }>('calendrier:actif', { classe_id: cid, annee_scolaire: an }).then((a) => {
      setExistant(a); setOperation(a.nb_jours ? 'remplacer' : 'ajouter');
    });
  }, [cid, an]);

  async function lire() {
    setErreur('');
    try {
      const r = await fichiers<LectureCalendrier>('lireCalendrier', { annee_scolaire: an });
      if (r.annule) return;
      setLecture(r); setManuels({}); setLibelles({});
      setMapping(Object.fromEntries(r.legende.map((l) => [l.cle, l.type_propose ?? ''])));
    } catch (e) { setErreur((e as Error).message); }
  }

  // jours finaux = lecture automatique + corrections manuelles
  const jours = useMemo(() => {
    const m = new Map<string, Jour>();
    for (const j of lecture?.jours ?? []) {
      const t = mapping[j.cle];
      if (t) m.set(j.date, { type: t, libelle: libelles[j.cle] ?? '' });
    }
    for (const [d, v] of Object.entries(manuels)) { if (v) m.set(d, v); else m.delete(d); }
    return m;
  }, [lecture, mapping, manuels, libelles]);

  const [a0] = an.split('-').map(Number);
  const mois: [number, number][] = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8].map((m) => [m >= 9 ? a0 : a0 + 1, m]);
  const nonAssocies = lecture?.legende.filter((l) => !mapping[l.cle]) ?? [];

  function basculer(iso: string) {
    const actuel = jours.get(iso)?.type ?? null;
    const suivant = ORDRE[(ORDRE.indexOf(actuel) + 1) % ORDRE.length];
    setManuels({ ...manuels, [iso]: suivant ? { type: suivant, libelle: jours.get(iso)?.libelle ?? '' } : null });
  }
  const nb = { centre: 0, entreprise: 0, autre: 0 };
  for (const j of jours.values()) nb[j.type]++;

  async function valider() {
    setErreur('');
    if (!jours.size) { setErreur('Le calendrier est vide.'); return; }
    if (operation === 'remplacer' && !confirm(`Remplacer le calendrier ${an} de ${classes.find((c) => c.id === cid)?.code} ?\n\nL'ancien calendrier sera archivé (restaurable) et une sauvegarde de la base sera faite avant.`)) return;
    try {
      const r = await fichiers<{ nb_jours: number; archive_id: number | null }>('validerCalendrier', {
        classe_id: cid, annee_scolaire: an, operation, source: lecture?.nom ?? 'Saisie manuelle',
        jours: [...jours.entries()].map(([date, j]) => ({ date, type: j.type, libelle: j.libelle || null })),
      });
      setInfo(`${r.nb_jours} jours importés${r.archive_id ? ' ; ancien calendrier archivé' : ''}.`);
      onDone(cid, an);
    } catch (e) { setErreur((e as Error).message); }
  }

  return (
    <div className="voile">
      <div className="fenetre large">
        <div className="entete"><h2>Importer un calendrier</h2><button type="button" onClick={onClose}>Fermer</button></div>
        <section className="fiche">
          <div className="grille">
            <label>Classe (formation et année de formation)
              <select value={cid} disabled={!!lecture} onChange={(e) => setCid(Number(e.target.value))}>{classes.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.libelle}</option>)}</select>
            </label>
            <label>Année scolaire
              <select value={an} disabled={!!lecture} onChange={(e) => setAn(e.target.value)}>{annees.map((a) => <option key={a}>{a}</option>)}</select>
            </label>
          </div>
          {existant && <p className="discret">{existant.nb_jours ? `Calendrier actuel : ${existant.nb_jours} jours (${existant.source}).` : 'Cette classe n\'a pas encore de calendrier pour cette année.'}</p>}
          <div className="grille">
            <label className="case"><input type="radio" checked={operation === 'ajouter'} disabled={!!lecture || !!existant?.nb_jours} onChange={() => setOperation('ajouter')} /> Ajouter un calendrier (classe sans calendrier pour cette année)</label>
            <label className="case"><input type="radio" checked={operation === 'remplacer'} disabled={!!lecture || !existant?.nb_jours} onChange={() => setOperation('remplacer')} /> Remplacer le calendrier existant (l'ancien est archivé)</label>
          </div>
          {!lecture && <div className="actions"><button className="principal" onClick={lire}>Choisir le fichier (Excel)…</button></div>}
        </section>
        {erreur && <p className="erreur">{erreur}</p>}
        {info && <p className="info">{info}</p>}

        {lecture && (
          <>
            <p>Fichier lu : <strong>{lecture.nom}</strong> — {lecture.jours.length} jours colorés détectés.</p>
            {lecture.avertissements.map((a) => <p key={a} className="alerte-texte">⚠ {a}</p>)}
            <h3>Légende détectée</h3>
            <table className="table">
              <thead><tr><th>Couleur</th><th>Légende lue</th><th>Jours</th><th>Type dans l'application</th><th>Libellé des jours (facultatif)</th></tr></thead>
              <tbody>
                {lecture.legende.map((l) => (
                  <tr key={l.cle}>
                    <td><span style={{ display: 'inline-block', width: 28, height: 16, background: couleurCle(l.cle), border: '1px solid #999' }} /></td>
                    <td>{l.libelle ?? <span className="discret">non trouvée</span>}</td>
                    <td>{l.nb}</td>
                    <td>
                      <select value={mapping[l.cle] ?? ''} onChange={(e) => setMapping({ ...mapping, [l.cle]: e.target.value as TypeJour | '' })}>
                        <option value="">— Ignorer ces jours —</option>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                    <td><input value={libelles[l.cle] ?? ''} onChange={(e) => setLibelles({ ...libelles, [l.cle]: e.target.value })} placeholder={l.libelle ?? ''} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {nonAssocies.length > 0 && <p className="alerte-texte">⚠ {nonAssocies.length} couleur(s) sans type : leurs jours ne seront pas importés tant que vous n'en choisissez pas un.</p>}

            <h3>Aperçu — {nb.centre} j centre · {nb.entreprise} j entreprise · {nb.autre} j autre</h3>
            <p className="discret">Cliquez sur un jour pour le corriger (centre → entreprise → autre → aucun).</p>
            <div className="mois-grille">
              {mois.map(([y, m]) => {
                const nbj = new Date(Date.UTC(y, m, 0)).getUTCDate();
                const dec = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
                return (
                  <div className="mois" key={`${y}-${m}`}>
                    <h3>{NOMS_MOIS[m - 1]} {y}</h3>
                    <div className="semaine">{['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((l, i) => <span key={i} className="entete-jour">{l}</span>)}</div>
                    <div className="jours">
                      {Array.from({ length: dec }, (_, i) => <span key={`v${i}`} />)}
                      {Array.from({ length: nbj }, (_, i) => {
                        const iso = `${y}-${p2(m)}-${p2(i + 1)}`;
                        const j = jours.get(iso);
                        return <button key={iso} type="button" title={j ? `${formaterDate(iso)} — ${TYPES[j.type]}` : formaterDate(iso)} className={`jour ${j?.type ?? ''}`} onClick={() => basculer(iso)}>{i + 1}</button>;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="actions">
              <button className="principal" onClick={valider}>{operation === 'remplacer' ? 'Valider et remplacer' : 'Valider et ajouter'}</button>
              <button onClick={() => { setLecture(null); setErreur(''); }}>Choisir un autre fichier</button>
              <button onClick={onClose}>Annuler (rien n'est enregistré)</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
