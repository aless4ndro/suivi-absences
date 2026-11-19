import { useEffect, useState } from 'react';
import {
  appeler, NOMS_STATUT_ALERTE, NOMS_STATUT_COMMISSION, NOMS_TYPE_COMMISSION, type Classe, type Jeune, type Palier, type RegleAlerte, type TableauBord as TB,
} from '../api';
import { formaterDate } from '../format';

type Filtres = { debut: string; fin: string; formation: string; classe_id: string; jeune_id: string; palier_id: string; regle_id: string; statut_alerte: string };
const VIDE: Filtres = { debut: '', fin: '', formation: '', classe_id: '', jeune_id: '', palier_id: '', regle_id: '', statut_alerte: 'ouvertes' };

export default function TableauBord({ ouvrirFiche, allerA }: { ouvrirFiche: (type: 'apprenti' | 'entreprise', id: number) => void; allerA: (page: string) => void }) {
  const [f, setF] = useState<Filtres>(VIDE);
  const [t, setT] = useState<TB | null>(null);
  const [classes, setClasses] = useState<Classe[]>([]);
  const [apprentis, setApprentis] = useState<Jeune[]>([]);
  const [paliers, setPaliers] = useState<Palier[]>([]);
  const [regles, setRegles] = useState<RegleAlerte[]>([]);

  useEffect(() => {
    appeler<Classe[]>('classes:list').then(setClasses);
    appeler<Jeune[]>('jeunes:list', { tous: true }).then(setApprentis);
    appeler<Palier[]>('paliers:list').then(setPaliers);
    appeler<RegleAlerte[]>('alertes:regles').then(setRegles);
  }, []);
  useEffect(() => {
    const arg = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
    appeler<TB>('dashboard:get', arg).then(setT);
  }, [f]);

  const formations = [...new Set(classes.map((c) => c.libelle.split(' ')[0]))];
  const maj = (p: Partial<Filtres>) => setF((x) => ({ ...x, ...p }));
  const nom = (n: string, p: string) => `${n.toUpperCase()} ${p}`;
  const lien = (id: number, n: string, p: string) => <button className="lien" onClick={() => ouvrirFiche('apprenti', id)}>{nom(n, p)}</button>;

  return (
    <div>
      <div className="entete"><h1>Tableau de bord disciplinaire</h1></div>

      <section className="fiche">
        <div className="grille">
          <label>Du<input type="date" value={f.debut} onChange={(e) => maj({ debut: e.target.value })} /></label>
          <label>Au<input type="date" value={f.fin} onChange={(e) => maj({ fin: e.target.value })} /></label>
          <label>Formation
            <select value={f.formation} onChange={(e) => maj({ formation: e.target.value })}><option value="">Toutes</option>{formations.map((x) => <option key={x}>{x}</option>)}</select>
          </label>
          <label>Promotion (classe)
            <select value={f.classe_id} onChange={(e) => maj({ classe_id: e.target.value })}><option value="">Toutes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select>
          </label>
          <label>Apprenti
            <select value={f.jeune_id} onChange={(e) => maj({ jeune_id: e.target.value })}><option value="">Tous</option>{apprentis.map((a) => <option key={a.id} value={a.id}>{nom(a.nom, a.prenom)}</option>)}</select>
          </label>
          <label>Type de sanction
            <select value={f.palier_id} onChange={(e) => maj({ palier_id: e.target.value })}><option value="">Tous</option>{paliers.map((p) => <option key={p.id} value={p.id}>{p.ordre}. {p.libelle}</option>)}</select>
          </label>
          <label>Type d'alerte
            <select value={f.regle_id} onChange={(e) => maj({ regle_id: e.target.value })}><option value="">Tous</option>{regles.map((r) => <option key={r.id} value={r.id}>{r.libelle}</option>)}</select>
          </label>
          <label>Statut de traitement
            <select value={f.statut_alerte} onChange={(e) => maj({ statut_alerte: e.target.value })}>
              <option value="ouvertes">Alertes ouvertes</option><option value="toutes">Toutes</option>
              {Object.entries(NOMS_STATUT_ALERTE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <div className="actions"><button onClick={() => setF(VIDE)}>Réinitialiser les filtres</button></div>
      </section>

      {t && (
        <>
          <div className="cartes">
            <button className={`carte ${t.indicateurs.alertes_a_traiter ? 'alerte' : ''}`} onClick={() => allerA('alertes')}><span className="chiffre">{t.indicateurs.alertes_a_traiter}</span><strong>Alertes à traiter</strong></button>
            <button className="carte" onClick={() => allerA('sanctions')}><span className="chiffre">{t.indicateurs.sanctions_prononcees}</span><strong>Sanctions prononcées</strong></button>
            <button className="carte" onClick={() => allerA('commissions')}><span className="chiffre">{t.indicateurs.commissions_programmees}</span><strong>Commissions programmées</strong></button>
            <button className={`carte ${t.indicateurs.commissions_a_organiser ? 'alerte' : ''}`} onClick={() => allerA('commissions')}><span className="chiffre">{t.indicateurs.commissions_a_organiser}</span><strong>Commissions à organiser</strong></button>
          </div>

          <h2>Alertes récentes</h2>
          <table className="table"><tbody>
            {t.alertes.map((a) => <tr key={a.id}><td>{lien(a.jeune_id, a.jeune_nom, a.jeune_prenom)} <span className="discret">{a.classe_code}</span></td><td>{a.regle}</td><td>{a.valeur} / {a.seuil}</td><td>{NOMS_STATUT_ALERTE[a.statut]}</td></tr>)}
            {t.alertes.length === 0 && <tr><td className="discret">Aucune alerte.</td></tr>}
          </tbody></table>

          <h2>Commissions à venir</h2>
          <table className="table"><tbody>
            {t.commissions_a_venir.map((c) => (
              <tr key={c.id}>
                <td>{lien(c.jeune_id, c.jeune_nom, c.jeune_prenom)}</td>
                <td>{NOMS_TYPE_COMMISSION[c.type]}</td>
                <td>{c.date ? formaterDate(c.date) : ''} {c.heure_debut?.replace(':', 'h')}</td>
                <td>{c.participants ?? <span className="discret">sans participant</span>}</td>
                <td>{c.nb_convocations ? 'Convocation préparée' : 'Convocation à préparer'} · {NOMS_STATUT_COMMISSION[c.statut]}</td>
              </tr>
            ))}
            {t.commissions_a_venir.length === 0 && <tr><td className="discret">Aucune commission à venir.</td></tr>}
          </tbody></table>
          {t.commissions_a_organiser.length > 0 && (
            <>
              <h3>À organiser</h3>
              <table className="table"><tbody>
                {t.commissions_a_organiser.map((c) => <tr key={c.id}><td>{lien(c.jeune_id, c.jeune_nom, c.jeune_prenom)}</td><td>{NOMS_TYPE_COMMISSION[c.type]}</td><td>{c.motif}</td><td>{NOMS_STATUT_COMMISSION[c.statut]}</td></tr>)}
              </tbody></table>
            </>
          )}

          <h2>Dernières sanctions</h2>
          <table className="table"><tbody>
            {t.sanctions.map((s) => <tr key={s.id}><td>{lien(s.jeune_id, s.jeune_nom, s.jeune_prenom)} <span className="discret">{s.classe_code}</span></td><td>{s.palier}</td><td>{s.motif}</td><td>{formaterDate(s.date_decision ?? s.date_faits)}</td></tr>)}
            {t.sanctions.length === 0 && <tr><td className="discret">Aucune sanction.</td></tr>}
          </tbody></table>
        </>
      )}
    </div>
  );
}
