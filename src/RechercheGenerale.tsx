import { useEffect, useRef, useState } from 'react';
import { appeler, type ResultatRecherche } from './api';
import { formaterDate } from './format';

export default function RechercheGenerale({ ouvrir }: { ouvrir: (type: 'apprenti' | 'entreprise', id: number) => void }) {
  const [saisie, setSaisie] = useState('');
  const [resultats, setResultats] = useState<ResultatRecherche[]>([]);
  const [total, setTotal] = useState(0);
  const [cherche, setCherche] = useState(false);
  const [actif, setActif] = useState(0);
  const [ouvert, setOuvert] = useState(false);
  const boite = useRef<HTMLDivElement>(null);

  // Recherche dynamique (petit délai pour ne pas interroger à chaque frappe)
  useEffect(() => {
    if (!saisie.trim()) { setResultats([]); setTotal(0); setCherche(false); return; }
    const t = setTimeout(() => {
      appeler<{ resultats: ResultatRecherche[]; total: number }>('recherche', { q: saisie, limite: 10 })
        .then((r) => { setResultats(r.resultats); setTotal(r.total); setActif(0); setCherche(true); })
        .catch(() => setCherche(false));
    }, 120);
    return () => clearTimeout(t);
  }, [saisie]);

  useEffect(() => {
    const ferme = (e: MouseEvent) => { if (boite.current && !boite.current.contains(e.target as Node)) setOuvert(false); };
    document.addEventListener('mousedown', ferme);
    return () => document.removeEventListener('mousedown', ferme);
  }, []);

  const choisir = (r: ResultatRecherche) => { setOuvert(false); ouvrir(r.type, r.id); };
  const effacer = () => { setSaisie(''); setResultats([]); setCherche(false); };

  function touche(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActif((a) => Math.min(a + 1, resultats.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActif((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && resultats[actif]) { e.preventDefault(); choisir(resultats[actif]); }
    else if (e.key === 'Escape') { if (ouvert) setOuvert(false); else effacer(); }
  }

  return (
    <div className="recherche-generale" ref={boite}>
      <div className="champ-recherche">
        <input
          type="search" autoComplete="off" value={saisie} placeholder="Rechercher un apprenti ou une entreprise (nom, prénom, raison sociale…)"
          onChange={(e) => { setSaisie(e.target.value); setOuvert(true); }} onFocus={() => setOuvert(true)} onKeyDown={touche}
        />
        {saisie && <button type="button" className="effacer" onClick={effacer} title="Effacer la recherche" aria-label="Effacer la recherche">✕</button>}
      </div>
      {ouvert && cherche && (
        <ul className="suggestions" role="listbox">
          {resultats.length === 0 && <li className="aucun">Aucun résultat trouvé</li>}
          {resultats.map((r, i) => (
            <li key={`${r.type}-${r.id}`} className={i === actif ? 'actif' : ''} role="option" aria-selected={i === actif}
              onMouseEnter={() => setActif(i)} onMouseDown={(e) => { e.preventDefault(); choisir(r); }}>
              <strong>{r.libelle}</strong>
              {r.type === 'apprenti' ? (
                <span className="discret">
                  Apprenti · {r.classe} · {r.annee}
                  {r.sorti && <span className="etiquette st-rouge">sorti(e) le {formaterDate(r.sorti_le!)}</span>}
                </span>
              ) : (
                <span className="discret">
                  Entreprise{r.nom_commercial ? ` · ${r.nom_commercial}` : ''}{r.siret ? ` · SIRET ${r.siret}` : ''}
                  {' · '}{r.nb_apprentis ? `${r.nb_apprentis} apprenti(s)` : 'aucun apprenti actuellement'}
                </span>
              )}
            </li>
          ))}
          {total > resultats.length && <li className="aucun">{total - resultats.length} autre(s) résultat(s) : précisez votre recherche</li>}
        </ul>
      )}
    </div>
  );
}
