import type { Destinataire } from './api';

export type Champ = 'a' | 'cc' | 'cci';
// choix : adresse connue → champ ; autres : adresses saisies à la main, séparées par « ; »
export type Envoi = { choix: Record<string, Champ>; autres: Record<Champ, string> };

const EMAIL = /^[^\s@;,<>"]+@[^\s@;,<>"]+\.[^\s@;,<>"]+$/;
const LIBELLES: Record<Champ, string> = { a: 'À', cc: 'Cc', cci: 'Cci' };
const decouper = (t: string) => t.split(/[;,]/).map((x) => x.trim()).filter(Boolean);

// Par défaut : le maître d'apprentissage (sinon l'entreprise) en « À ». Le professeur principal n'est jamais coché d'office.
export function envoiParDefaut(liste: Destinataire[]): Envoi {
  const defaut = liste.find((d) => d.cle === 'maitre') ?? liste.find((d) => d.cle === 'entreprise');
  return { choix: defaut?.email ? { [defaut.email]: 'a' } : {}, autres: { a: '', cc: '', cci: '' } };
}

export function adressesInvalides(e: Envoi): string[] {
  return (['a', 'cc', 'cci'] as Champ[]).flatMap((c) => decouper(e.autres[c])).filter((x) => !EMAIL.test(x));
}

export function repartition(e: Envoi): Record<Champ, string[]> {
  const r: Record<Champ, string[]> = { a: [], cc: [], cci: [] };
  for (const [adr, champ] of Object.entries(e.choix)) r[champ].push(adr);
  for (const c of ['a', 'cc', 'cci'] as Champ[]) r[c].push(...decouper(e.autres[c]).filter((x) => EMAIL.test(x)));
  return r;
}

export const toutesAdresses = (e: Envoi) => Object.values(repartition(e)).flat();

export function ppInclus(e: Envoi, liste: Destinataire[]) {
  return liste.some((d) => d.role === 'pp' && d.email && e.choix[d.email]);
}

export default function ChoixDestinataires({ destinataires, envoi, onChange }: {
  destinataires: Destinataire[]; envoi: Envoi; onChange: (e: Envoi) => void;
}) {
  const pp = destinataires.find((d) => d.role === 'pp');
  const invalides = adressesInvalides(envoi);
  const r = repartition(envoi);

  function choisir(email: string, valeur: string) {
    const choix = { ...envoi.choix };
    if (valeur) choix[email] = valeur as Champ; else delete choix[email];
    onChange({ ...envoi, choix });
  }

  return (
    <div className="choix-dest">
      <h3>Destinataire(s)</h3>
      {destinataires.length === 0 && <p className="erreur">Aucune adresse connue pour cet apprenti : complétez les fiches, ou saisissez l'adresse ci-dessous.</p>}
      {destinataires.length > 0 && (
        <table className="table-dest">
          <tbody>
            {destinataires.map((d) => (
              <tr key={d.cle} className={d.role === 'pp' ? 'ligne-pp' : ''}>
                <td>
                  {d.libelle}
                  {d.role === 'pp' && <span className="etiquette st-bleu">proposé</span>}
                  <span className="discret"> {d.email || "pas d'adresse e-mail"}{d.telephone ? ` · ${d.telephone}` : ''}</span>
                </td>
                <td>
                  <select value={d.email ? envoi.choix[d.email] ?? '' : ''} disabled={!d.email} onChange={(e) => choisir(d.email, e.target.value)}>
                    <option value="">Ne pas inclure</option>
                    <option value="a">À</option>
                    <option value="cc">Cc (copie)</option>
                    <option value="cci">Cci (copie cachée)</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pp && !pp.email && <p className="alerte-texte">⚠ Le professeur principal n'a pas d'adresse e-mail sur sa fiche : complétez-la dans « Professeurs principaux ».</p>}
      {!pp && <p className="discret">Aucun professeur principal désigné pour cette classe à cette date (menu « Professeurs principaux »).</p>}

      <details className="autres-adresses" open={Object.values(envoi.autres).some(Boolean)}>
        <summary>Ajouter d'autres adresses</summary>
        <div className="grille">
          {(['a', 'cc', 'cci'] as Champ[]).map((c) => (
            <label key={c}>{LIBELLES[c]} (séparez par « ; »)
              <input value={envoi.autres[c]} placeholder="prenom.nom@exemple.fr" onChange={(e) => onChange({ ...envoi, autres: { ...envoi.autres, [c]: e.target.value } })} />
            </label>
          ))}
        </div>
      </details>
      {invalides.length > 0 && <p className="erreur">Adresse(s) invalide(s) : {invalides.join(', ')}</p>}

      <p><strong>À :</strong> {r.a.join('; ') || <span className="discret">(à saisir dans Outlook)</span>}</p>
      {r.cc.length > 0 && <p><strong>Cc :</strong> {r.cc.join('; ')}</p>}
      {r.cci.length > 0 && <p><strong>Cci :</strong> {r.cci.join('; ')}</p>}
    </div>
  );
}
