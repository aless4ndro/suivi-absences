import { useEffect, useMemo, useState } from 'react';
import { appeler, NOMS_TYPE_COMMISSION, type Commission, type Classe, type Evenement, type JourCalendrier, type Vacances } from '../api';
import { aujourdhui, feries, formaterDate, NOMS_MOIS } from '../format';

const MOIS_ANNEE: [number, number][] = [
  [2026, 9], [2026, 10], [2026, 11], [2026, 12], [2027, 1], [2027, 2], [2027, 3], [2027, 4], [2027, 5], [2027, 6], [2027, 7],
];
const TYPES = { centre: 'Centre de formation', entreprise: 'Entreprise', autre: 'Autre (examen, férié…)' } as const;
const p2 = (n: number) => String(n).padStart(2, '0');

export default function Calendrier() {
  const [classes, setClasses] = useState<Classe[]>([]);
  const [classeId, setClasseId] = useState<number>(0);
  const [jours, setJours] = useState<Map<string, JourCalendrier>>(new Map());
  const [absences, setAbsences] = useState<Set<string>>(new Set());
  const [choisi, setChoisi] = useState<string | null>(null);
  const [libelle, setLibelle] = useState('');
  const [erreur, setErreur] = useState('');
  const [vacances, setVacances] = useState<Vacances[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const vacancesDe = (iso: string) => vacances.find((v) => v.debut <= iso && iso <= v.fin);

  const jf = useMemo(() => new Map([...feries(2026), ...feries(2027)]), []);

  useEffect(() => { appeler<Vacances[]>('vacances:list').then(setVacances); }, []);
  useEffect(() => {
    appeler<Classe[]>('classes:list').then((c) => {
      setClasses(c);
      if (c.length) setClasseId(c[0].id);
    });
  }, []);

  const charger = (id: number) => {
    appeler<JourCalendrier[]>('calendrier:annee', id).then((l) => setJours(new Map(l.map((j) => [j.date, j]))));
    appeler<(Commission & { classe_code: string | null })[]>('commissions:list', {}).then((l) => {
      const code = classes.find((c) => c.id === id)?.code;
      setCommissions(l.filter((c) => c.date && c.statut !== 'annulee' && c.classe_code === code));
    });
    appeler<Evenement[]>('evenements:list', { classe_id: id }).then((l) =>
      setAbsences(new Set(l.flatMap((e) => (e.creneaux.length ? e.creneaux.map((c) => c.date) : [e.date_debut]))))
    );
  };
  useEffect(() => {
    if (classeId) { charger(classeId); setChoisi(null); }
  }, [classeId]);

  const comptes = useMemo(() => {
    const n = { centre: 0, entreprise: 0, autre: 0 };
    for (const j of jours.values()) n[j.type]++;
    return n;
  }, [jours]);

  async function definir(type: JourCalendrier['type'] | null) {
    if (!choisi) return;
    try {
      await appeler('calendrier:jour', { classe_id: classeId, date: choisi, type, libelle });
      setErreur('');
      charger(classeId);
    } catch (e) {
      setErreur((e as Error).message);
    }
  }
  function selectionner(iso: string) {
    setChoisi(iso);
    setLibelle(jours.get(iso)?.libelle ?? '');
  }

  const aujourd = aujourdhui();
  const jourChoisi = choisi ? jours.get(choisi) : undefined;

  return (
    <>
      <div className="entete"><h1>Calendrier d'alternance 2026-2027</h1></div>
      <div className="onglets">
        {classes.map((c) => (
          <button key={c.id} className={classeId === c.id ? 'actif' : ''} onClick={() => setClasseId(c.id)}>{c.code}</button>
        ))}
      </div>

      <div className="legende">
        <span><i className="pastille centre" /> Centre de formation ({comptes.centre} j)</span>
        <span><i className="pastille entreprise" /> Entreprise ({comptes.entreprise} j)</span>
        <span><i className="pastille autre" /> Autre ({comptes.autre} j)</span>
        <span><i className="pastille vacances" /> Vacances scolaires (zone B)</span>
        <span><i className="pastille ferie" /> Jour férié</span>
        <span><i className="pastille absence" /> Absence ou retard saisi</span>
        <span><i className="pastille commission" /> Commission</span>
      </div>

      {jours.size === 0 && (
        <p className="discret">Le calendrier d'alternance de cette classe n'est pas encore chargé. Vous pouvez le remplir jour par jour en cliquant sur les dates, ou me le transmettre pour l'importer.</p>
      )}

      <div className="mois-grille">
        {MOIS_ANNEE.map(([an, m]) => {
          const premier = new Date(Date.UTC(an, m - 1, 1));
          const nb = new Date(Date.UTC(an, m, 0)).getUTCDate();
          const decalage = (premier.getUTCDay() + 6) % 7;
          return (
            <div className="mois" key={`${an}-${m}`}>
              <h3>{NOMS_MOIS[m - 1]} {an}</h3>
              <div className="semaine">{['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((l, i) => <span key={i} className="entete-jour">{l}</span>)}</div>
              <div className="jours">
                {Array.from({ length: decalage }, (_, i) => <span key={`v${i}`} />)}
                {Array.from({ length: nb }, (_, i) => {
                  const iso = `${an}-${p2(m)}-${p2(i + 1)}`;
                  const j = jours.get(iso);
                  const ferie = jf.get(iso);
                  const vac = vacancesDe(iso);
                  const titre = [j ? TYPES[j.type] : '', j?.libelle, ferie, vac?.libelle].filter(Boolean).join(' · ');
                  return (
                    <button key={iso} type="button" title={titre || undefined}
                      className={['jour', j?.type ?? '', vac ? 'vacances' : '', ferie ? 'ferie' : '', absences.has(iso) ? 'absence' : '', commissions.some((c) => c.date === iso) ? 'commission' : '', iso === choisi ? 'choisi' : '', iso === aujourd ? 'aujourdhui' : ''].join(' ')}
                      onClick={() => selectionner(iso)}>
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {choisi && (
        <section className="fiche">
          <h2>{formaterDate(choisi)}</h2>
          <p>
            {jourChoisi ? <strong>{TYPES[jourChoisi.type]}</strong> : <span className="discret">Aucun type défini pour ce jour.</span>}
            {jf.get(choisi) && <> · férié : {jf.get(choisi)}</>}
            {vacancesDe(choisi) && <> · {vacancesDe(choisi)!.libelle} (zone B)</>}
            {absences.has(choisi) && <> · absence ou retard saisi ce jour-là</>}
          </p>
          {commissions.filter((c) => c.date === choisi).map((c) => (
            <p key={c.id}>Commission {NOMS_TYPE_COMMISSION[c.type].toLowerCase()} à {(c.heure_debut ?? '').replace(':', 'h')} — {c.jeune_prenom} {c.jeune_nom?.toUpperCase()}</p>
          ))}
          <label>Libellé (facultatif)
            <input value={libelle} placeholder="ex. Examen, journée d'intégration" onChange={(e) => setLibelle(e.target.value)} />
          </label>
          <div className="actions">
            <button onClick={() => definir('centre')}>Centre de formation</button>
            <button onClick={() => definir('entreprise')}>Entreprise</button>
            <button onClick={() => definir('autre')}>Autre</button>
            <button className="danger" onClick={() => definir(null)}>Effacer</button>
          </div>
          {erreur && <p className="erreur">{erreur}</p>}
          <p className="discret">Cette modification ne concerne que la classe {classes.find((c) => c.id === classeId)?.code}.</p>
        </section>
      )}
    </>
  );
}
