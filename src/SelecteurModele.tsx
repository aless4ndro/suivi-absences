import { useEffect, useState } from 'react';
import { appeler, type MailRendu, type ModeleMail } from './api';

// Choix d'un mail type (catégorie → modèle) : les variables sont remplacées d'après les fiches, le texte reste modifiable ensuite.
export default function SelecteurModele({ jeuneId, sanctionId, commissionId, evenementId, categorie, onChoisir }: {
  jeuneId: number; sanctionId?: number | null; commissionId?: number | null; evenementId?: number | null; categorie?: string;
  onChoisir: (m: MailRendu) => void;
}) {
  const [categories, setCategories] = useState<string[]>([]);
  const [modeles, setModeles] = useState<ModeleMail[]>([]);
  const [cat, setCat] = useState(categorie ?? '');
  const [manquantes, setManquantes] = useState<string[]>([]);
  useEffect(() => {
    appeler<string[]>('mails:categories').then(setCategories);
    appeler<ModeleMail[]>('mails:modeles', { actifs: true }).then(setModeles);
  }, []);

  async function choisir(id: string) {
    if (!id) return;
    const r = await appeler<MailRendu>('mails:rendre', { modele_id: Number(id), jeune_id: jeuneId, sanction_id: sanctionId, commission_id: commissionId, evenement_id: evenementId });
    setManquantes(r.manquantes);
    onChoisir(r);
  }
  return (
    <div className="selecteur-modele">
      <div className="grille">
        <label>Mail type — catégorie
          <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Toutes</option>{categories.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label>Modèle
          <select defaultValue="" onChange={(e) => choisir(e.target.value)}>
            <option value="">— Choisir un modèle (facultatif) —</option>
            {modeles.filter((m) => !cat || m.categorie === cat).map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </select>
        </label>
      </div>
      {manquantes.length > 0 && <p className="alerte-texte">⚠ Informations absentes des fiches, à compléter dans le texte : {manquantes.map((k) => `{${k}}`).join(', ')}</p>}
    </div>
  );
}
