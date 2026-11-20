// Tableaux de bord Excel, calqués sur les modèles de l'établissement : « TABLEAU DE BORD CLASSE » et « TABLEAU DE BORD INDIVIDUEL APPRENTI ».
// Colonnes : Just. = un motif a été donné ; Non just. = aucun motif ; Non rec. = motif irrecevable ou absent.
import type { ApprentiRecap, EvenementRecap, ResultatRecap } from './api';
import { formaterDate } from './format';
import { envelopperFlux } from './documents';

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
// Mise en page identique au modèle. Repas, Internat, Incidents, Dispenses et Infirmeries : sections du modèle conservées,
// à 0 tant que l'application ne suit pas ces données.
export function feuilleIndividuel(r: ResultatRecap, a: ApprentiRecap, nom?: string): FeuilleExcel {
  const dom = r.criteres.domaines;
  const g = new Grille();
  g.fusion(1, 0, 5, 'Tableau de bord', 'titre');
  g.fusion(3, 0, 5, `Élève : ${nomComplet(a)}`, 'bloc');
  const abs = a.evenements.filter((e) => e.type === 'absence').sort(decroissant);
  const ret = a.evenements.filter((e) => e.type === 'retard').sort(decroissant);
  const demi = (l: EvenementRecap[]) => l.reduce((t, e) => t + (e.nb_creneaux || 1), 0);
  let ligne = 5;
  if (dom.includes('absences')) {
    const lignes: [string, string | number][] = [
      ['Absences non justifiées :', `${demi(abs.filter((e) => !aMotif(e)))} demi journées, 0 cours`],
      ['Absences justifiées :', `${demi(abs.filter(aMotif))} demi journées, 0 cours`],
      ['Absences non recevables :', abs.filter((e) => !recevable(e)).length],
    ];
    for (const [l, v] of lignes) { g.set(ligne, 0, l, 'lib'); g.fusion(ligne, 1, 5, v, 'lib'); ligne++; }
  }
  ligne = 10;

  // en-tête de section ; cols : libellés des colonnes B.. ; fus : l'en-tête « Motif » est fusionné B:D (sections sans colonnes)
  const entete = (titre: string, cols: string[]) => {
    g.set(ligne, 0, titre, 'th');
    cols.forEach((c, i) => g.set(ligne, 1 + i, c, i === 0 ? 'thc' : 'thc'));
    ligne++;
  };
  const evts = (titre: string, l: EvenementRecap[]) => {
    entete(`${titre} : ${l.length}`, ['Motif', 'Just.', 'Non just.', 'Non Rec.']);
    l.forEach((e, i) => {
      const alt = i % 2 === 1 ? 'a' : '';
      g.set(ligne, 0, formaterDate(e.date_debut), `td${alt}`);
      g.set(ligne, 1, e.motif_libelle ?? null, `td${alt}`);
      g.set(ligne, 2, x(aMotif(e)), `tdc${alt}`);
      g.set(ligne, 3, x(!aMotif(e)), `tdc${alt}`);
      g.set(ligne, 4, x(!recevable(e)), `tdc${alt}`);
      ligne++;
    });
    ligne++;
  };
  if (dom.includes('absences')) evts('Absences', abs);
  if (dom.includes('retards')) evts('Retards', ret);
  entete('Repas : 0', ['Motif', 'Just.', 'Non just.']); ligne++;
  entete('Internat : 0', ['Motif', 'Just.', 'Non just.']); ligne++;
  if (dom.includes('sanctions')) {
    entete(`Sanctions : ${a.sanctions.length}`, ['Motif', 'Eff.', 'Non eff.']);
    a.sanctions.forEach((s, i) => {
      const alt = i % 2 === 1 ? 'a' : '';
      g.set(ligne, 0, formaterDate(s.date_decision ?? s.date_faits), `td${alt}`);
      g.set(ligne, 1, [s.palier, s.motif].filter(Boolean).join(' — '), `td${alt}`);
      g.set(ligne, 2, x(s.statut === SANCTION_CLOTUREE), `tdc${alt}`);
      g.set(ligne, 3, x(s.statut !== SANCTION_CLOTUREE), `tdc${alt}`);
      ligne++;
    });
    ligne++;
  }
  g.set(ligne, 0, 'Incidents : 0', 'th'); g.fusion(ligne, 1, 3, 'Motif', 'thc'); ligne += 2;
  entete('Dispenses : 0', ['Motif', 'Prés.', 'Pas prés.']); ligne++;
  g.fusion(ligne, 0, 3, 'Infirmeries : 0', 'th');
  return g.feuille(nom ?? nomComplet(a), { A: 22.86, B: 40, C: 9.14, D: 11.71, E: 9.14, F: 11.71 });
}

// ───────── Tableau de bord d'une classe ─────────
export function feuilleClasse(r: ResultatRecap, classe: string, apprentis: ApprentiRecap[]): FeuilleExcel {
  const dom = r.criteres.domaines;
  const g = new Grille();
  g.fusion(1, 0, 10, 'Tableau de bord', 'titre');
  g.fusion(3, 0, 10, ` Classe : ${classe}`, 'bloc');
  const ev = (type: 'absence' | 'retard') => apprentis.flatMap((a) => a.evenements.filter((e) => e.type === type));
  const stat = (c: number, lignes: [string, number][]) => lignes.forEach(([lib, v], i) => { g.set(5 + i, c, lib, 'lib'); g.set(5 + i, c + 1, v, 'val'); });
  const trio = (titre: string, l: EvenementRecap[]): [string, number][] => [[`${titre} :`, l.length], [`${titre} non justifiées :`, l.filter((e) => !aMotif(e)).length], [`${titre} justifiées :`, l.filter(aMotif).length], [`${titre} non recevables :`, l.filter((e) => !recevable(e)).length]];
  if (dom.includes('absences')) stat(0, trio('Absences', ev('absence')));
  if (dom.includes('retards')) stat(3, trio('Retards', ev('retard')));
  stat(6, [['Absences repas :', 0], ['Absences internat :', 0], ['Passages infirmerie :', 0]]);
  const droite: [string, number][] = [];
  if (dom.includes('sanctions')) droite.push(['Sanctions :', apprentis.reduce((t, a) => t + a.sanctions.length, 0)]);
  droite.push(['Incidents :', 0], ['Dispenses :', 0]);
  stat(9, droite);

  let ligne = 11;
  const n = (k: number) => (k ? k : null);
  const entete = (titre: string, c3: string, c4: string, c5?: string) => {
    g.set(ligne, 0, titre, 'th');
    g.fusion(ligne, 1, 2, 'Total', 'thc'); g.set(ligne, 3, c3, 'thc'); g.fusion(ligne, 4, 6, c4, 'thc');
    if (c5) g.fusion(ligne, 7, 10, c5, 'thc');
    ligne++;
  };
  const table = (titre: string, type: 'absence' | 'retard') => {
    const par = apprentis.map((a) => ({ a, l: a.evenements.filter((e) => e.type === type) })).filter((p) => p.l.length);
    entete(`${titre} : ${par.reduce((t, p) => t + p.l.length, 0)}`, 'Justifiées', 'Non justif.', 'Non recevable');
    par.forEach(({ a, l }, i) => {
      const alt = i % 2 === 1 ? 'a' : '';
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
  entete('Repas : 0', 'Justifiées', 'Non justifiées'); ligne++;
  entete('Internat : 0', 'Justifiées', 'Non justifiées'); ligne++;
  if (dom.includes('sanctions')) {
    const par = apprentis.filter((a) => a.sanctions.length);
    entete(`Sanctions : ${par.reduce((t, a) => t + a.sanctions.length, 0)}`, 'Effectuées', 'Non effectuées');
    par.forEach((a, i) => {
      const alt = i % 2 === 1 ? 'a' : '';
      const eff = a.sanctions.filter((s) => s.statut === SANCTION_CLOTUREE).length;
      g.set(ligne, 0, nomComplet(a), `td${alt}`);
      g.fusion(ligne, 1, 2, a.sanctions.length, `tdn${alt}`);
      g.set(ligne, 3, n(eff), `tdn${alt}`);
      g.fusion(ligne, 4, 6, n(a.sanctions.length - eff), `tdn${alt}`);
      ligne++;
    });
    ligne++;
  }
  g.fusion(ligne, 0, 5, 'Incidents : 0', 'th'); g.set(ligne, 6, 'Total', 'thc'); ligne += 2;
  entete('Dispenses : 0', 'Présence', 'Pas présence'); ligne++;
  g.fusion(ligne, 0, 5, 'Infirmeries : 0', 'th'); g.set(ligne, 6, 'Total', 'thc');
  return g.feuille(classe, { A: 22.29, B: 4.57, D: 19.29, E: 4.57, G: 19.29, H: 4.57, J: 10, K: 4.57 });
}

// ───────── PDF : même mise en page que l'Excel ─────────
const FONDS: Record<string, string> = { titre: '#D6DCE4', bloc: '#EDDFED', th: '#8497B0', thc: '#8497B0', tda: '#F1F9FE', tdca: '#F1F9FE', tdna: '#F1F9FE' };
const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colIdx = (ref: string) => ref.replace(/\d/g, '').split('').reduce((t, c) => t * 26 + c.charCodeAt(0) - 64, 0) - 1;
const ligIdx = (ref: string) => Number(ref.replace(/\D/g, ''));

export function htmlFeuille(f: FeuilleExcel): string {
  const debuts = new Map<string, number>(); const cachees = new Set<string>();
  for (const m of f.fusions ?? []) {
    const [d, e] = m.split(':'); const r = ligIdx(d); const c1 = colIdx(d); const c2 = colIdx(e);
    debuts.set(`${r}:${c1}`, c2 - c1 + 1);
    for (let c = c1 + 1; c <= c2; c++) cachees.add(`${r}:${c}`);
  }
  const ncol = Math.max(...f.lignes.map((l) => l.length));
  const lettres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const cols = Array.from({ length: ncol }, (_, i) => `<col style="width:${((f.largeurs as Record<string, number> | undefined)?.[lettres[i]] ?? 9) * 1.45}mm"/>`).join('');
  const rows = f.lignes.map((l, r) => {
    const cells = l.map((cell, c) => {
      if (cachees.has(`${r + 1}:${c}`)) return '';
      const v = cell && typeof cell === 'object' ? cell.v : cell;
      const st = (cell && typeof cell === 'object' ? cell.s : '') ?? '';
      const span = debuts.get(`${r + 1}:${c}`) ?? 1;
      const fond = FONDS[st] ? `background:${FONDS[st]};` : '';
      const blanc = st === 'th' || st === 'thc' ? 'color:#fff;font-weight:bold;' : st === 'titre' || st === 'bloc' ? 'font-weight:bold;' : '';
      const al = st === 'titre' || st.startsWith('thc') || st.startsWith('tdc') ? 'center' : st === 'val' || st.startsWith('tdn') ? 'right' : 'left';
      const sz = st === 'titre' ? 'font-size:15pt;' : '';
      const bord = st ? 'border:1px solid #999;' : '';
      return `<td${span > 1 ? ` colspan="${span}"` : ''} style="${bord}${fond}${blanc}${sz}text-align:${al};padding:1mm 1.5mm">${esc(v)}</td>`;
    }).join('');
    return `<tr style="height:${f.hauteurs?.[r + 1] ? f.hauteurs[r + 1] * 0.35 : 5.5}mm">${cells}</tr>`;
  }).join('');
  return `<table style="border-collapse:collapse;table-layout:fixed;font-size:9pt;width:auto"><colgroup>${cols}</colgroup>${rows}</table>`;
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

// Document PDF : une feuille par page (les graphiques restent à l'écran, pas dans le PDF).
export function htmlPdfFeuilles(feuilles: FeuilleExcel[]): string {
  return `<div class="doc">${feuilles.map((f) => `<div style="page-break-after:always">${htmlFeuille(f)}</div>`).join('')}</div>`;
}

export const pdfFeuilles = (feuilles: FeuilleExcel[]) => envelopperFlux(htmlPdfFeuilles(feuilles));
