import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { appeler, MOTIFS_SORTIE, type Bilan, type Classe, type Jeune } from '../api';
import { aujourdhui, formaterDate } from '../format';

const formationDe = (libelle: string) => libelle.split(' — ')[0].trim();
const suivante = (classes: Classe[], c?: Classe) =>
  c ? classes.find((x) => formationDe(x.libelle) === formationDe(c.libelle) && (x.ordre ?? 0) > (c.ordre ?? 0)) : undefined;
const prochaineRentree = () => {
  const [a, m] = aujourdhui().split('-').map(Number);
  return `${m >= 9 ? a + 1 : a}-09-01`;
};
const hm = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;

// Choix possibles : passe:<id classe> | redouble | sort:<motif> | reste
export default function Bascule({ classes, liste, onClose, onDone }: {
  classes: Classe[]; liste: Jeune[]; onClose: () => void; onDone: (message: string) => void;
}) {
  const actifs = useMemo(() => liste.filter((j) => !j.sorti), [liste]);
  const [date, setDate] = useState(prochaineRentree());
  const [soldes, setSoldes] = useState<Record<number, number>>({});
  const [erreur, setErreur] = useState('');
  const parDefaut = (j: Jeune) => {
    const n = suivante(classes, classes.find((c) => c.id === j.classe_id));
    return n ? `passe:${n.id}` : 'sort:diplome';
  };
  const [choix, setChoix] = useState<Record<number, string>>(() => Object.fromEntries(actifs.map((j) => [j.id!, parDefaut(j)])));

  useEffect(() => {
    appeler<Bilan>('rattrapages:bilan', {}).then((b) => setSoldes(Object.fromEntries(b.apprentis.map((a) => [a.id, a.solde])))).catch(() => {});
  }, []);

  const libelle = (v: string) => {
    if (v === 'redouble') return 'Redouble';
    if (v === 'reste') return 'Ne rien changer';
    if (v.startsWith('sort:')) return MOTIFS_SORTIE[v.slice(5)];
    return `Passe en ${classes.find((c) => c.id === Number(v.slice(6)))?.code}`;
  };
  const resume = useMemo(() => {
    const n = { passe: 0, redouble: 0, sort: 0, reste: 0 };
    for (const v of Object.values(choix)) n[v.split(':')[0] as keyof typeof n]++;
    return n;
  }, [choix]);
  const sortantsAvecSolde = actifs.filter((j) => choix[j.id!]?.startsWith('sort:') && (soldes[j.id!] ?? 0) > 0);

  function Selecteur({ j, valeur, onChange }: { j?: Jeune; valeur: string; onChange: (v: string) => void }) {
    const origine = j ? j.classe_id : 0;
    const prochaine = j ? suivante(classes, classes.find((c) => c.id === origine)) : undefined;
    return (
      <select value={valeur} onChange={(e) => onChange(e.target.value)}>
        {prochaine && <option value={`passe:${prochaine.id}`}>Passe en {prochaine.code}</option>}
        <option value="redouble">Redouble (reste dans la classe)</option>
        {Object.entries(MOTIFS_SORTIE).map(([k, v]) => <option key={k} value={`sort:${k}`}>{v}</option>)}
        <optgroup label="Autre classe">
          {classes.filter((c) => c.id !== origine && c.id !== prochaine?.id).map((c) => <option key={c.id} value={`passe:${c.id}`}>Passe en {c.code}</option>)}
        </optgroup>
        <option value="reste">Ne rien changer pour l'instant</option>
      </select>
    );
  }

  async function valider(e: FormEvent) {
    e.preventDefault();
    const lignes = Object.entries(choix).filter(([, v]) => v !== 'reste');
    if (!lignes.length) { setErreur('Aucun changement à enregistrer.'); return; }
    const detail = [
      resume.passe && `${resume.passe} passent dans la classe suivante`, resume.redouble && `${resume.redouble} redoublent`,
      resume.sort && `${resume.sort} sortent de la formation`, resume.reste && `${resume.reste} inchangés`,
    ].filter(Boolean).join(', ');
    if (!confirm(`Bascule au ${formaterDate(date)} : ${detail}.\n\nLes absences, retards et rattrapages déjà saisis restent rattachés à l'ancienne classe. Les sortants disparaissent des listes (historique conservé, réintégration possible). Confirmer ?`)) return;
    try {
      const decisions = lignes.map(([id, v]) => {
        const [action, arg] = v.split(':');
        return { id: Number(id), action, classe_id: action === 'passe' ? Number(arg) : undefined, motif: action === 'sort' ? arg : undefined };
      });
      await appeler('jeunes:bascule', { date, decisions });
      onDone(`Bascule enregistrée pour le ${formaterDate(date)} : ${detail}. Pensez à désigner les professeurs principaux de la nouvelle année (menu « Professeurs principaux »).`);
    } catch (err) { setErreur((err as Error).message); }
  }

  return (
    <div className="voile">
      <form className="fenetre large" onSubmit={valider}>
        <div className="entete"><h2>Bascule de rentrée</h2><button type="button" onClick={onClose}>Fermer</button></div>
        <p className="discret">Pour chaque apprenti : passe dans la classe suivante, redouble, ou sort de la formation (démission, rupture, diplômé). Rien n'est modifié avant la validation. La date peut être dans le futur : tout s'appliquera ce jour-là.</p>
        <label>Date de la bascule<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={{ maxWidth: 220 }} /></label>

        {classes.map((c) => {
          const eleves = actifs.filter((j) => j.classe_id === c.id);
          if (!eleves.length) return null;
          const prochaine = suivante(classes, c);
          return (
            <div key={c.id} className="bloc-bascule">
              <div className="entete">
                <h3>{c.code} <span className="discret">({eleves.length}) {prochaine ? `→ ${prochaine.code}` : '→ fin de cursus'}</span></h3>
                <label className="case discret">Toute la classe :
                  <select value="" onChange={(e) => e.target.value && setChoix({ ...choix, ...Object.fromEntries(eleves.map((j) => [j.id!, e.target.value])) })}>
                    <option value="">— appliquer à tous —</option>
                    {prochaine && <option value={`passe:${prochaine.id}`}>Passe en {prochaine.code}</option>}
                    <option value="redouble">Redouble</option>
                    <option value="sort:diplome">Fin de formation (diplômé)</option>
                    <option value="reste">Ne rien changer</option>
                  </select>
                </label>
              </div>
              <table className="table-dest">
                <tbody>
                  {eleves.map((j) => (
                    <tr key={j.id}>
                      <td>
                        {j.nom.toUpperCase()} {j.prenom}
                        {(soldes[j.id!] ?? 0) > 0 && <span className="etiquette st-orange">{hm(soldes[j.id!])} à rattraper</span>}
                        {j.passage_prevu && <span className="alerte-texte"> — déjà prévu : {j.passage_prevu.type === 'redoublement' ? 'redoublement' : j.passage_prevu.classe_code} le {formaterDate(j.passage_prevu.date)}</span>}
                      </td>
                      <td><Selecteur j={j} valeur={choix[j.id!]} onChange={(v) => setChoix({ ...choix, [j.id!]: v })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        {actifs.length === 0 && <p className="discret">Aucun apprenti en formation.</p>}

        {sortantsAvecSolde.length > 0 && (
          <p className="alerte-texte">⚠ {sortantsAvecSolde.map((j) => `${j.prenom} ${j.nom} (${hm(soldes[j.id!])})`).join(', ')} sort(ent) avec des heures de rattrapage non effectuées : ces heures ne seront plus suivies dans les bilans. Vous pouvez les retrouver en les réintégrant.</p>
        )}
        <p><strong>Résumé :</strong> {resume.passe} passent · {resume.redouble} redoublent · {resume.sort} sortent · {resume.reste} inchangés</p>
        {erreur && <p className="erreur">{erreur}</p>}
        <div className="actions"><button className="principal" type="submit">Valider la bascule</button><button type="button" onClick={onClose}>Annuler</button></div>
      </form>
    </div>
  );
}
