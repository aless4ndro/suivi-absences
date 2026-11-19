export function aujourdhui(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function ajouterJours(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const enMinutes = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

export const formaterDate = (iso: string) => iso.split('-').reverse().join('/');

export function formaterDuree(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

export function formaterTaille(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`;
  return `${(octets / 1024 / 1024).toFixed(1)} Mo`;
}

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
export const jourSemaine = (iso: string) => JOURS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
export const estWeekEnd = (iso: string) => {
  const j = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return j === 0 || j === 6;
};

// Jours fériés légaux en France métropolitaine (dates fixes + dépendant de Pâques).
export function feries(annee: number): Map<string, string> {
  const a = annee % 19, b = Math.floor(annee / 100), c = annee % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
  const paques = `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
  const p = (mm: number, dd: number) => `${annee}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  return new Map([
    [p(1, 1), "Jour de l'An"], [ajouterJours(paques, 1), 'Lundi de Pâques'], [p(5, 1), 'Fête du Travail'],
    [p(5, 8), 'Victoire 1945'], [ajouterJours(paques, 39), 'Ascension'], [ajouterJours(paques, 50), 'Lundi de Pentecôte'],
    [p(7, 14), 'Fête nationale'], [p(8, 15), 'Assomption'], [p(11, 1), 'Toussaint'], [p(11, 11), 'Armistice 1918'], [p(12, 25), 'Noël'],
  ]);
}

export const NOMS_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// « 2026-11-19 20:11:05 » → « 19/11/2026 à 20:11 »
export function formaterDateHeure(t: string): string {
  const [d, h = ''] = t.split(' ');
  return `${d.split('-').reverse().join('/')}${h ? ` à ${h.slice(0, 5)}` : ''}`;
}
