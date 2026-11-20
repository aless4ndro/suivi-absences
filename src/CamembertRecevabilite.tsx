import { useEffect, useState } from 'react';
import { appeler, type ResultatRecap } from './api';
import { svgRecevabilite, type ModeRecevabilite } from './recapTableau';

// Camembert « recevable / irrecevable » réutilisable : un apprenti, une ou plusieurs classes, ou toutes les formations.
// parClasse : un camembert par classe, côte à côte, précédé du camembert d'ensemble. Lecture seule (mêmes règles que les récapitulatifs).
export default function CamembertRecevabilite({ debut, fin, jeuneId, classeIds, parClasse = false, types = ['absences', 'retards'], modeInitial = 'heures' }: {
  debut: string; fin: string; jeuneId?: number; classeIds?: number[]; parClasse?: boolean;
  types?: ('absences' | 'retards')[]; modeInitial?: ModeRecevabilite;
}) {
  const [mode, setMode] = useState<ModeRecevabilite>(modeInitial);
  const [r, setR] = useState<ResultatRecap | null>(null);
  const cle = JSON.stringify([debut, fin, jeuneId, classeIds, types]);
  useEffect(() => {
    if (!debut || !fin || fin < debut) { setR(null); return; }
    appeler<ResultatRecap>('recap:calculer', { debut, fin, jeune_ids: jeuneId ? [jeuneId] : [], classe_ids: classeIds ?? [], domaines: types })
      .then(setR).catch(() => setR(null));
  }, [cle]);
  if (!r) return null;
  const det = (a: ResultatRecap['apprentis']) => a.flatMap((x) => [...(types.includes('absences') ? [x.absences] : []), ...(types.includes('retards') ? [x.retards] : [])]);
  const classes = [...new Set(r.apprentis.map((a) => a.classe_code))].sort();
  const portee = jeuneId ? 'cet apprenti' : classeIds?.length ? 'la sélection' : 'toutes les formations';
  return (
    <div>
      <div className="actions">
        <label className="case"><input type="radio" checked={mode === 'heures'} onChange={() => setMode('heures')} /> En heures</label>
        <label className="case"><input type="radio" checked={mode === 'nombre'} onChange={() => setMode('nombre')} /> En nombre</label>
      </div>
      <div className="graphes">
        <div className="graphe" dangerouslySetInnerHTML={{ __html: svgRecevabilite(det(r.apprentis), `Recevables / irrecevables — ${portee}`, mode) }} />
        {parClasse && classes.map((c) => (
          <div key={c} className="graphe" dangerouslySetInnerHTML={{ __html: svgRecevabilite(det(r.apprentis.filter((a) => a.classe_code === c)), c, mode) }} />
        ))}
      </div>
    </div>
  );
}
