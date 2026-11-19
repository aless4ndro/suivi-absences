import { useEffect, useState } from 'react';
import { appeler, NOMS_STATUT_COMMISSION, NOMS_TYPE_COMMISSION, type Commission, type Jeune, type StatutCommission, type TypeCommission } from '../api';
import CommissionForm from '../CommissionForm';
import { formaterDate } from '../format';

export default function Commissions({ nouvelle }: { nouvelle?: { jeune_id: number } | null }) {
  const [liste, setListe] = useState<Commission[]>([]);
  const [apprentis, setApprentis] = useState<Jeune[]>([]);
  const [statut, setStatut] = useState<StatutCommission | ''>('');
  const [type, setType] = useState<TypeCommission | ''>('');
  const [ouverte, setOuverte] = useState<{ id?: number; jeuneId?: number } | null>(nouvelle ? { jeuneId: nouvelle.jeune_id } : null);

  const [jours, setJours] = useState(2);
  const [msg, setMsg] = useState('');
  useEffect(() => { appeler<{ rappel_jours: number }>('commissions:reglages').then((r) => setJours(r.rappel_jours)); }, []);
  const enregistrerJours = () => appeler('commissions:reglages:save', { rappel_jours: jours }).then(() => setMsg('Délai enregistré.')).catch((e) => setMsg((e as Error).message));
  const charger = () => appeler<Commission[]>('commissions:list', { statut: statut || undefined, type: type || undefined }).then(setListe);
  useEffect(() => { charger(); }, [statut, type]);
  useEffect(() => { appeler<Jeune[]>('jeunes:list').then(setApprentis); }, []);

  return (
    <div>
      <div className="entete">
        <h1>Commissions</h1>
        <button className="principal" onClick={() => setOuverte({})}>Programmer une commission</button>
      </div>
      <div className="filtres">
        <label>Statut
          <select value={statut} onChange={(e) => setStatut(e.target.value as StatutCommission | '')}>
            <option value="">Tous</option>
            {Object.entries(NOMS_STATUT_COMMISSION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Type
          <select value={type} onChange={(e) => setType(e.target.value as TypeCommission | '')}>
            <option value="">Tous</option>
            {Object.entries(NOMS_TYPE_COMMISSION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <section className="fiche">
        <div className="grille">
          <label>Rappel affiché sur l'Accueil (jours avant la commission)<input type="number" min={0} max={30} value={jours} onChange={(e) => setJours(Number(e.target.value))} /></label>
        </div>
        <div className="actions"><button onClick={enregistrerJours}>Enregistrer le délai</button>{msg && <span className="discret">{msg}</span>}</div>
      </section>
      <table className="table">
        <thead><tr><th>Date</th><th>Apprenti</th><th>Type</th><th>Motif</th><th>Statut</th><th /></tr></thead>
        <tbody>
          {liste.map((c) => (
            <tr key={c.id}>
              <td>{c.date ? `${formaterDate(c.date)}${c.heure_debut ? ` ${c.heure_debut.replace(':', 'h')}` : ''}` : <span className="discret">à fixer</span>}</td>
              <td>{c.jeune_nom?.toUpperCase()} {c.jeune_prenom}</td>
              <td>{NOMS_TYPE_COMMISSION[c.type]}</td>
              <td>{c.motif}</td>
              <td><span className="etiquette st-bleu">{NOMS_STATUT_COMMISSION[c.statut!]}</span></td>
              <td className="droite"><button onClick={() => setOuverte({ id: c.id })}>Ouvrir</button></td>
            </tr>
          ))}
          {liste.length === 0 && <tr><td colSpan={6} className="discret">Aucune commission.</td></tr>}
        </tbody>
      </table>
      {ouverte && (
        <CommissionForm commissionId={ouverte.id} jeuneId={ouverte.jeuneId} apprentis={apprentis} onClose={() => setOuverte(null)} onChange={charger} />
      )}
    </div>
  );
}
