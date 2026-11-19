import { useEffect, useState } from 'react';
import { appeler, type VersionCalendrier } from './api';
import { formaterDateHeure } from './format';

// Anciennes versions d'un calendrier (archivées à chaque remplacement) : consultation et restauration.
export default function VersionsCalendrier({ classeId, code, annee, onClose, onDone }: { classeId: number; code: string; annee: string; onClose: () => void; onDone: () => void }) {
  const [liste, setListe] = useState<VersionCalendrier[]>([]);
  const [erreur, setErreur] = useState('');
  const [info, setInfo] = useState('');
  const charger = () => appeler<VersionCalendrier[]>('calendrier:versions', { classe_id: classeId, annee_scolaire: annee }).then(setListe);
  useEffect(() => { charger(); }, []);

  async function restaurer(v: VersionCalendrier) {
    if (!confirm(`Restaurer la version « ${v.source} » archivée le ${formaterDateHeure(v.archive_le)} ?\n\nLe calendrier actuel sera archivé à son tour.`)) return;
    try { await appeler('calendrier:version:restaurer', v.id); setInfo('Version restaurée ; le calendrier précédent a été archivé.'); setErreur(''); charger(); onDone(); } catch (e) { setErreur((e as Error).message); }
  }
  return (
    <div className="voile">
      <div className="fenetre">
        <div className="entete"><h2>Versions du calendrier — {code} {annee}</h2><button onClick={onClose}>Fermer</button></div>
        {erreur && <p className="erreur">{erreur}</p>}
        {info && <p className="info">{info}</p>}
        {liste.length === 0 ? <p className="discret">Aucune ancienne version : le calendrier n'a pas encore été remplacé.</p> : (
          <table className="table">
            <thead><tr><th>Archivée le</th><th>Origine</th><th>Jours</th><th>Raison</th><th /></tr></thead>
            <tbody>{liste.map((v) => <tr key={v.id}><td>{formaterDateHeure(v.archive_le)}</td><td>{v.source}</td><td>{v.nb_jours}</td><td>{v.motif}</td><td className="droite"><button onClick={() => restaurer(v)}>Restaurer</button></td></tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
