import { useEffect, useRef, useState } from 'react';
import { appeler } from './api';

// Photo de l'apprenti : redimensionnée en carré 240×240 (JPEG) puis stockée dans la base locale.
export default function PhotoApprenti({ jeuneId, nom }: { jeuneId: number; nom: string }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [erreur, setErreur] = useState('');
  const entree = useRef<HTMLInputElement>(null);
  useEffect(() => { appeler<string | null>('jeunes:photo', jeuneId).then(setPhoto).catch(() => setPhoto(null)); }, [jeuneId]);

  async function choisir(fichier?: File) {
    if (!fichier) return;
    setErreur('');
    try {
      const url = URL.createObjectURL(fichier);
      const img = await new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Image illisible.')); i.src = url; });
      const c = document.createElement('canvas'); c.width = 240; c.height = 240;
      const cote = Math.min(img.width, img.height);
      c.getContext('2d')!.drawImage(img, (img.width - cote) / 2, (img.height - cote) / 2, cote, cote, 0, 0, 240, 240);
      URL.revokeObjectURL(url);
      const donnees = c.toDataURL('image/jpeg', 0.85);
      await appeler('jeunes:photo:save', { id: jeuneId, donnees });
      setPhoto(donnees);
    } catch (e) { setErreur((e as Error).message); }
  }
  async function retirer() {
    await appeler('jeunes:photo:supprimer', jeuneId);
    setPhoto(null);
  }
  return (
    <div className="photo-apprenti">
      {photo ? <img src={photo} alt={`Photo de ${nom}`} /> : <div className="photo-vide" aria-hidden>{nom.split(' ').map((m) => m[0]).join('').slice(0, 2).toUpperCase()}</div>}
      <div>
        <input ref={entree} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { choisir(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" onClick={() => entree.current?.click()}>{photo ? 'Changer la photo' : 'Ajouter une photo'}</button>
        {photo && <button type="button" className="danger" onClick={retirer}>Retirer</button>}
        <p className="discret">Photo facultative, conservée uniquement sur cet ordinateur (droit à l'image : à utiliser avec l'accord de l'apprenti).</p>
        {erreur && <p className="erreur">{erreur}</p>}
      </div>
    </div>
  );
}
