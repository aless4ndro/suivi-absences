// Tableaux de bord Excel, calqués sur les modèles de l'établissement : « TABLEAU DE BORD CLASSE » et « TABLEAU DE BORD INDIVIDUEL APPRENTI ».
// Colonnes : Just. = un motif a été donné ; Non just. = aucun motif ; Non rec. = motif irrecevable ou absent.
import type { ApprentiRecap, EvenementRecap, ResultatRecap } from './api';
import { formaterDate } from './format';

type Cell = string | number | null | { v?: string | number | null; s?: string };
export type FeuilleExcel = { nom: string; lignes: Cell[][]; fusions?: string[]; largeurs?: Record<string, number>; hauteurs?: Record<number, number>; entete?: boolean };

const LETTRES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
class Grille {
  cells: Cell[][] = [];
  fusions: string[] = [];
  set(r: number, c: number, v: string | number | null, s: string) {
    while (this.cells.length < r) this.cells.push([]);
    const l = this.cells[r - 1];
    while (l.length <= c) l.push(null);
    l[c] = { v, s };
  }
  // cellule fusionnée : la valeur va dans la 1re colonne, le style dans toutes (pour que les bordures et les fonds soient complets)
  fusion(r: number, c1: number, c2: number, v: string | number | null, s: string) {
    for (let c = c1; c <= c2; c++) this.set(r, c, c === c1 ? v : null, s);
    if (c2 > c1) this.fusions.push(`${LETTRES[c1]}${r}:${LETTRES[c2]}${r}`);
  }
  feuille(nom: string, largeurs: Record<string, number>): FeuilleExcel {
    const n = Math.max(...this.cells.map((l) => l.length));
    return { nom, lignes: this.cells.map((l) => { const x = [...l]; while (x.length < n) x.push(null); return x; }), fusions: this.fusions, largeurs, hauteurs: { 1: 28.5, 3: 19.5 }, entete: false };
  }
}

const aMotif = (e: EvenementRecap) => !!e.motif_libelle;
const recevable = (e: EvenementRecap) => e.motif_statut === 'recevable';
const nomComplet = (a: ApprentiRecap) => `${a.nom.toUpperCase()} ${a.prenom}`;
const x = (b: boolean) => (b ? 'x' : null);
const plur = (n: number, un: string, plus: string) => `${n} ${n > 1 ? plus : un}`;
const decroissant = (a: EvenementRecap, b: EvenementRecap) => b.date_debut.localeCompare(a.date_debut) || b.id - a.id;
const SANCTION_CLOTUREE = 'cloturee';

// ───────── Tableau de bord individuel ─────────
export function feuilleIndividuel(r: ResultatRecap, a: ApprentiRecap, nom?: string): FeuilleExcel {
  const dom = r.criteres.domaines;
  const g = new Grille();
  g.fusion(1, 0, 5, 'Tableau de bord', 'titre');
  g.fusion(3, 0, 5, `Élève : ${nomComplet(a)}`, 'bloc');
  g.fusion(4, 0, 5, `${a.classe_code} — du ${formaterDate(r.criteres.debut)} au ${formaterDate(r.criteres.fin)}`, 'lib');
  let ligne = 5;
  const abs = a.evenements.filter((e) => e.type === 'absence').sort(decroissant);
  const ret = a.evenements.filter((e) => e.type === 'retard').sort(decroissant);
  if (dom.includes('absences')) {
    const demi = (l: EvenementRecap[]) => l.reduce((t, e) => t + (e.nb_creneaux || 1), 0);
    const lignes: [string, string | number][] = [
      ['Absences non justifiées :', plur(demi(abs.filter((e) => !aMotif(e))), 'demi-journée', 'demi-journées')],
      ['Absences justifiées :', plur(demi(abs.filter(aMotif)), 'demi-journée', 'demi-journées')],
      ['Absences non recevables :', abs.filter((e) => !recevable(e)).length],
    ];
    for (const [l, v] of lignes) { g.set(ligne, 0, l, 'lib'); g.fusion(ligne, 1, 5, v, 'lib'); ligne++; }
    ligne += 2;
  } else ligne += 1;

  const table = (titre: string, l: EvenementRecap[], avecNonRec: boolean) => {
    g.set(ligne, 0, `${titre} : ${l.length}`, 'th');
    g.set(ligne, 1, 'Motif', 'thc'); g.set(ligne, 2, 'Just.', 'thc'); g.set(ligne, 3, 'Non just.', 'thc');
    if (avecNonRec) g.set(ligne, 4, 'Non Rec.', 'thc');
    ligne++;
    l.forEach((e, i) => {
      const alt = i % 2 === 1 ? 'a' : '';
      g.set(ligne, 0, formaterDate(e.date_debut), `td${alt}`);
      g.set(ligne, 1, e.motif_libelle ?? null, `td${alt}`);
      g.set(ligne, 2, x(aMotif(e)), `tdc${alt}`);
      g.set(ligne, 3, x(!aMotif(e)), `tdc${alt}`);
      if (avecNonRec) g.set(ligne, 4, x(!recevable(e)), `tdc${alt}`);
      ligne++;
    });
    ligne++;
  };
  if (dom.includes('absences')) table('Absences', abs, true);
  if (dom.includes('retards')) table('Retards', ret, true);
  if (dom.includes('sanctions')) {
    g.set(ligne, 0, `Sanctions : ${a.sanctions.length}`, 'th');
    g.set(ligne, 1, 'Motif', 'thc'); g.set(ligne, 2, 'Eff.', 'thc'); g.set(ligne, 3, 'Non eff.', 'thc');
    ligne++;
    a.sanctions.forEach((s, i) => {
      const alt = i % 2 === 1 ? 'a' : '';
      g.set(ligne, 0, formaterDate(s.date_decision ?? s.date_faits), `td${alt}`);
      g.set(ligne, 1, [s.palier, s.motif].filter(Boolean).join(' — '), `td${alt}`);
      g.set(ligne, 2, x(s.statut === SANCTION_CLOTUREE), `tdc${alt}`);
      g.set(ligne, 3, x(s.statut !== SANCTION_CLOTUREE), `tdc${alt}`);
      ligne++;
    });
  }
  return g.feuille(nom ?? nomComplet(a), { A: 22.86, B: 40, C: 9.14, D: 11.71, E: 9.14, F: 11.71 });
}

// ───────── Tableau de bord d'une classe ─────────
export function feuilleClasse(r: ResultatRecap, classe: string, apprentis: ApprentiRecap[]): FeuilleExcel {
  const dom = r.criteres.domaines;
  const g = new Grille();
  g.fusion(1, 0, 10, 'Tableau de bord', 'titre');
  g.fusion(3, 0, 10, `Classe : ${classe}`, 'bloc');
  const ev = (type: 'absence' | 'retard') => apprentis.flatMap((a) => a.evenements.filter((e) => e.type === type));
  const bloc = (c: number, titre: string, l: EvenementRecap[]) => {
    const l4: [string, number][] = [[`${titre} :`, l.length], [`${titre} non justifiées :`, l.filter((e) => !aMotif(e)).length], [`${titre} justifiées :`, l.filter(aMotif).length], [`${titre} non recevables :`, l.filter((e) => !recevable(e)).length]];
    l4.forEach(([lib, v], i) => { g.set(5 + i, c, lib, 'lib'); g.set(5 + i, c + 1, v, 'val'); });
  };
  if (dom.includes('absences')) bloc(0, 'Absences', ev('absence'));
  if (dom.includes('retards')) bloc(3, 'Retards', ev('retard'));
  if (dom.includes('sanctions')) { g.set(5, 9, 'Sanctions :', 'lib'); g.set(5, 10, apprentis.reduce((t, a) => t + a.sanctions.length, 0), 'val'); }

  let ligne = 11;
  const table = (titre: string, type: 'absence' | 'retard') => {
    const par = apprentis.map((a) => ({ a, l: a.evenements.filter((e) => e.type === type) })).filter((p) => p.l.length);
    g.set(ligne, 0, `${titre} : ${par.reduce((t, p) => t + p.l.length, 0)}`, 'th');
    g.fusion(ligne, 1, 2, 'Total', 'thc'); g.set(ligne, 3, 'Justifiées', 'thc');
    g.fusion(ligne, 4, 6, 'Non justif.', 'thc'); g.fusion(ligne, 7, 10, 'Non recevable', 'thc');
    ligne++;
    par.forEach(({ a, l }, i) => {
      const alt = i % 2 === 1 ? 'a' : '';
      const n = (k: number) => (k ? k : null);
      g.set(ligne, 0, nomComplet(a), `td${alt}`);
      g.fusion(ligne, 1, 2, l.length, `tdn${alt}`);
      g.set(ligne, 3, n(l.filter(aMotif).length), `tdn${alt}`);
      g.fusion(ligne, 4, 6, n(l.filter((e) => !aMotif(e)).length), `tdn${alt}`);
      g.fusion(ligne, 7, 10, n(l.filter((e) => !recevable(e)).length), `tdn${alt}`);
      ligne++;
    });
    ligne++;
  };
  if (dom.includes('absences')) table('Absences', 'absence');
  if (dom.includes('retards')) table('Retards', 'retard');
  if (dom.includes('sanctions')) {
    const par = apprentis.filter((a) => a.sanctions.length);
    g.set(ligne, 0, `Sanctions : ${par.reduce((t, a) => t + a.sanctions.length, 0)}`, 'th');
    g.fusion(ligne, 1, 2, 'Total', 'thc'); g.set(ligne, 3, 'Effectuées', 'thc'); g.fusion(ligne, 4, 6, 'Non effectuées', 'thc');
    ligne++;
    par.forEach((a, i) => {
      const alt = i % 2 === 1 ? 'a' : '';
      const eff = a.sanctions.filter((s) => s.statut === SANCTION_CLOTUREE).length;
      g.set(ligne, 0, nomComplet(a), `td${alt}`);
      g.fusion(ligne, 1, 2, a.sanctions.length, `tdn${alt}`);
      g.set(ligne, 3, eff || null, `tdn${alt}`);
      g.fusion(ligne, 4, 6, a.sanctions.length - eff || null, `tdn${alt}`);
      ligne++;
    });
  }
  return g.feuille(classe, { A: 22.29, B: 4.57, D: 19.29, E: 4.57, G: 19.29, H: 4.57, J: 10, K: 4.57 });
}

const nomFeuille = (s: string) => s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);

// Classeur collectif : un onglet par classe, dans l'ordre alphabétique, puis les critères.
export function classeurClasses(r: ResultatRecap): FeuilleExcel[] {
  const codes = [...new Set(r.apprentis.map((a) => a.classe_code || '—'))].sort();
  const f = codes.map((c) => feuilleClasse(r, c, r.apprentis.filter((a) => (a.classe_code || '—') === c)));
  const crit: Cell[][] = [
    [{ v: 'Critère', s: 'th' }, { v: 'Valeur', s: 'th' }],
    [{ v: 'Période', s: 'lib' }, { v: `du ${formaterDate(r.criteres.debut)} au ${formaterDate(r.criteres.fin)}`, s: 'lib' }],
    [{ v: 'Domaines', s: 'lib' }, { v: r.criteres.domaines.join(', '), s: 'lib' }],
    [{ v: 'Classes', s: 'lib' }, { v: codes.join(', '), s: 'lib' }],
    [{ v: 'Édité le', s: 'lib' }, { v: formaterDate(r.genere_le.slice(0, 10)), s: 'lib' }],
    [{ v: 'Règle', s: 'lib' }, { v: 'Just. = un motif a été donné ; Non just. = aucun motif ; Non rec. = motif irrecevable ou absent.', s: 'lib' }],
  ];
  f.push({ nom: 'Critères', lignes: crit, largeurs: { A: 14, B: 80 }, entete: false });
  return f.map((x) => ({ ...x, nom: nomFeuille(x.nom) }));
}

// Classeur individuel : un onglet par apprenti.
export function classeurIndividuels(r: ResultatRecap, apprentis: ApprentiRecap[]): FeuilleExcel[] {
  return apprentis.map((a) => feuilleIndividuel(r, a, nomFeuille(`${a.classe_code} ${a.nom} ${a.prenom}`)));
}
