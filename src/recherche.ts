// Normalisation commune aux recherches : sans majuscules ni accents, espaces uniformisés.
export const cle = (texte: string) =>
  texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Tous les mots saisis doivent se retrouver (dans n'importe quel ordre, en début ou milieu de mot).
export function correspond(saisie: string, ...champs: (string | null | undefined)[]): boolean {
  const mots = cle(saisie).split(' ').filter(Boolean);
  if (!mots.length) return true;
  const texte = cle(champs.filter(Boolean).join(' '));
  return mots.every((m) => texte.includes(m));
}
