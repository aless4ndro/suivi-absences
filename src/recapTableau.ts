// Graphiques (SVG), documents (HTML → PDF) et feuilles Excel du récapitulatif absences / retards / sanctions.
import type { ApprentiRecap, ResultatRecap } from './api';
import { formaterDate } from './format';
import { envelopperFlux } from './documents';

const echapper = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const hm = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const moisCourt = (ym: string) => `${MOIS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
export const COULEURS = { absences: '#1f3f7f', retards: '#ef7d1a', sanctions: '#8a1c10', just: '#2e8b57', injust: '#c0392b', att: '#d4a017' };

type Serie = { nom: string; couleur: string; valeurs: number[] };

// Barres groupées (une série par domaine).
export function svgBarres(etiquettes: string[], series: Serie[], titre: string, l = 560, h = 220): string {
  const max = Math.max(1, ...series.flatMap((s) => s.valeurs));
  const x0 = 34, y0 = 24, bas = h - 40, hauteur = bas - y0, largeur = l - x0 - 8;
  const g = largeur / Math.max(1, etiquettes.length);
  const bw = Math.min(26, (g - 6) / series.length);
  const barres = etiquettes.map((e, i) => series.map((s, k) => {
    const v = s.valeurs[i]; const bh = (v / max) * hauteur;
    const x = x0 + i * g + (g - bw * series.length) / 2 + k * bw;
    return `<rect x="${x.toFixed(1)}" y="${(bas - bh).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${bh.toFixed(1)}" fill="${s.couleur}"><title>${echapper(s.nom)} — ${echapper(e)} : ${v}</title></rect>${v ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(bas - bh - 3).toFixed(1)}" font-size="9" text-anchor="middle">${v}</text>` : ''}`;
  }).join('') + `<text x="${(x0 + i * g + g / 2).toFixed(1)}" y="${bas + 14}" font-size="9" text-anchor="middle">${echapper(e.length > 12 ? `${e.slice(0, 11)}…` : e)}</text>`).join('');
  const legende = series.map((s, k) => `<rect x="${x0 + k * 110}" y="${h - 14}" width="10" height="10" fill="${s.couleur}"/><text x="${x0 + k * 110 + 14}" y="${h - 5}" font-size="10">${echapper(s.nom)}</text>`).join('');
  return `<svg viewBox="0 0 ${l} ${h}" width="100%" role="img" aria-label="${echapper(titre)}"><text x="${x0}" y="14" font-size="11" font-weight="700">${echapper(titre)}</text><line x1="${x0}" y1="${bas}" x2="${l - 8}" y2="${bas}" stroke="#888"/><text x="4" y="${y0 + 4}" font-size="9">${max}</text>${barres}${legende}</svg>`;
}

// Courbes (évolution dans le temps).
export function svgCourbes(etiquettes: string[], series: Serie[], titre: string, l = 560, h = 220): string {
  const max = Math.max(1, ...series.flatMap((s) => s.valeurs));
  const x0 = 34, y0 = 24, bas = h - 40, hauteur = bas - y0, largeur = l - x0 - 16;
  const px = (i: number) => x0 + (etiquettes.length <= 1 ? largeur / 2 : (i * largeur) / (etiquettes.length - 1));
  const py = (v: number) => bas - (v / max) * hauteur;
  const lignes = series.map((s) => `<polyline fill="none" stroke="${s.couleur}" stroke-width="2" points="${s.valeurs.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ')}"/>${s.valeurs.map((v, i) => `<circle cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="3" fill="${s.couleur}"><title>${echapper(s.nom)} — ${echapper(etiquettes[i])} : ${v}</title></circle>`).join('')}`).join('');
  const abscisses = etiquettes.map((e, i) => `<text x="${px(i).toFixed(1)}" y="${bas + 14}" font-size="9" text-anchor="middle">${echapper(e)}</text>`).join('');
  const legende = series.map((s, k) => `<rect x="${x0 + k * 110}" y="${h - 14}" width="10" height="10" fill="${s.couleur}"/><text x="${x0 + k * 110 + 14}" y="${h - 5}" font-size="10">${echapper(s.nom)}</text>`).join('');
  return `<svg viewBox="0 0 ${l} ${h}" width="100%" role="img" aria-label="${echapper(titre)}"><text x="${x0}" y="14" font-size="11" font-weight="700">${echapper(titre)}</text><line x1="${x0}" y1="${bas}" x2="${l - 8}" y2="${bas}" stroke="#888"/><text x="4" y="${y0 + 4}" font-size="9">${max}</text>${lignes}${abscisses}${legende}</svg>`;
}

// Camembert (répartition) ; les parts à zéro sont omises, la légende donne les valeurs.
export function svgCamembert(parts: { nom: string; valeur: number; couleur: string }[], titre: string, l = 360, h = 200): string {
  const total = parts.reduce((t, p) => t + p.valeur, 0);
  const r = 62, cx = 80, cy = 112;
  let angle = -Math.PI / 2;
  const arcs = total === 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#eee"/>` : parts.filter((p) => p.valeur > 0).map((p) => {
    if (p.valeur === total) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.couleur}"><title>${echapper(p.nom)} : ${p.valeur}</title></circle>`;
    const a = (p.valeur / total) * Math.PI * 2;
    const [x1, y1, x2, y2] = [cx + r * Math.cos(angle), cy + r * Math.sin(angle), cx + r * Math.cos(angle + a), cy + r * Math.sin(angle + a)];
    const d = `M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z`;
    angle += a;
    return `<path d="${d}" fill="${p.couleur}"><title>${echapper(p.nom)} : ${p.valeur}</title></path>`;
  }).join('');
  const leg = parts.map((p, k) => `<rect x="170" y="${60 + k * 20}" width="10" height="10" fill="${p.couleur}"/><text x="186" y="${69 + k * 20}" font-size="10">${echapper(p.nom)} : ${p.valeur}${total ? ` (${Math.round((p.valeur / total) * 100)} %)` : ''}</text>`).join('');
  return `<svg viewBox="0 0 ${l} ${h}" width="100%" role="img" aria-label="${echapper(titre)}"><text x="8" y="14" font-size="11" font-weight="700">${echapper(titre)}</text>${arcs}${leg}</svg>`;
}

export function graphiques(r: ResultatRecap): { id: string; titre: string; svg: string }[] {
  const dom = r.criteres.domaines;
  const mois = r.par_mois.map((m) => moisCourt(m.mois));
  const out: { id: string; titre: string; svg: string }[] = [];
  const sa: Serie[] = [];
  if (dom.includes('absences')) sa.push({ nom: 'Absences', couleur: COULEURS.absences, valeurs: r.par_mois.map((m) => m.absences) });
  if (dom.includes('retards')) sa.push({ nom: 'Retards', couleur: COULEURS.retards, valeurs: r.par_mois.map((m) => m.retards) });
  if (sa.length && mois.length) {
    out.push({ id: 'barres', titre: 'Absences et retards par mois', svg: svgBarres(mois, sa, 'Absences et retards par mois (nombre)') });
    out.push({ id: 'courbes', titre: 'Évolution', svg: svgCourbes(mois, sa, 'Évolution mensuelle (nombre)') });
    const t = r.totaux;
    out.push({
      id: 'camembert', titre: 'Répartition',
      svg: svgCamembert([
        { nom: 'Justifiées', valeur: (dom.includes('absences') ? t.absences.justifiees.nb : 0) + (dom.includes('retards') ? t.retards.justifiees.nb : 0), couleur: COULEURS.just },
        { nom: 'Injustifiées', valeur: (dom.includes('absences') ? t.absences.injustifiees.nb : 0) + (dom.includes('retards') ? t.retards.injustifiees.nb : 0), couleur: COULEURS.injust },
        { nom: 'En attente de motif', valeur: (dom.includes('absences') ? t.absences.en_attente.nb : 0) + (dom.includes('retards') ? t.retards.en_attente.nb : 0), couleur: COULEURS.att },
      ], 'Justifiées / injustifiées'),
    });
  }
  if (dom.includes('sanctions') && r.par_mois.some((m) => m.sanctions)) {
    out.push({ id: 'sanctions-mois', titre: 'Sanctions par mois', svg: svgBarres(mois, [{ nom: 'Sanctions', couleur: COULEURS.sanctions, valeurs: r.par_mois.map((m) => m.sanctions) }], 'Sanctions par mois (nombre)') });
    if (r.par_palier.length) out.push({ id: 'sanctions-palier', titre: 'Sanctions par palier', svg: svgBarres(r.par_palier.map((p) => p.palier), [{ nom: 'Sanctions', couleur: COULEURS.sanctions, valeurs: r.par_palier.map((p) => p.nb) }], 'Sanctions par palier') });
  }
  return out;
}

// Retire un domaine d'un résultat (ex. sanctions exclues d'un document destiné à une entreprise).
export function sansDomaine(r: ResultatRecap, domaine: 'sanctions' | 'absences' | 'retards'): ResultatRecap {
  const dom = r.criteres.domaines.filter((d) => d !== domaine);
  const garder = (e: { type: string }) => domaine === 'sanctions' || e.type !== (domaine === 'absences' ? 'absence' : 'retard');
  return {
    ...r, criteres: { ...r.criteres, domaines: dom },
    apprentis: r.apprentis.map((a) => ({ ...a, sanctions: domaine === 'sanctions' ? [] : a.sanctions, evenements: a.evenements.filter(garder) })),
    totaux: { ...r.totaux, sanctions: domaine === 'sanctions' ? 0 : r.totaux.sanctions },
    par_mois: r.par_mois.map((m) => ({ ...m, sanctions: domaine === 'sanctions' ? 0 : m.sanctions })),
    par_classe: r.par_classe.map((c) => ({ ...c, sanctions: domaine === 'sanctions' ? 0 : c.sanctions })),
    par_palier: domaine === 'sanctions' ? [] : r.par_palier,
  };
}

const quand = (e: { date_debut: string; date_fin: string | null }) =>
  e.date_fin && e.date_fin !== e.date_debut ? `${formaterDate(e.date_debut)} → ${formaterDate(e.date_fin)}` : formaterDate(e.date_debut);
const statut = (s: string | null) => s === 'recevable' ? 'Justifiée' : s === 'irrecevable' ? 'Injustifiée' : 'En attente de motif';
const classeStatut = (s: string | null) => s === 'recevable' ? 'just' : s === 'irrecevable' ? 'injust' : 'att';
const tD = (t: { nb: number; minutes: number }) => `${t.nb} — ${hm(t.minutes)}`;

const CSS_PLUS = `.doc .graphes{display:flex;flex-wrap:wrap;gap:4mm}.doc .graphes>div{flex:1 1 45%;min-width:80mm;page-break-inside:avoid}.doc .cartes{display:flex;gap:4mm;margin:3mm 0}.doc .cartes div{flex:1;border:1px solid #999;padding:3mm;text-align:center}.doc .cartes b{display:block;font-size:16pt}`;
const enveloppe = (inner: string) => envelopperFlux(inner).replace('</style>', `${CSS_PLUS}</style>`);

function entete(r: ResultatRecap, titre: string, sous: string) {
  return `<div class="logo"><img src="logo-etablissement.png" alt="" /></div><h1>${echapper(titre)}</h1>
    <p class="sous-titre">${sous}<br/>Période du ${formaterDate(r.criteres.debut)} au ${formaterDate(r.criteres.fin)} — édité le ${formaterDate(r.genere_le.slice(0, 10))}</p>`;
}
const pied = (r: ResultatRecap, confidentiel: string) =>
  `<p class="note">${echapper(r.etablissement?.nom ?? '')} — ${confidentiel} Données issues des modules Absences, Retards et Sanctions, à la date d'édition.</p>`;
const graphes = (r: ResultatRecap) => { const g = graphiques(r); return g.length ? `<h2>Graphiques</h2><div class="graphes">${g.map((x) => `<div>${x.svg}</div>`).join('')}</div>` : ''; };

function blocApprenti(a: ApprentiRecap, r: ResultatRecap) {
  const dom = r.criteres.domaines;
  const evts = a.evenements.map((e) => `<tr><td>${quand(e)}</td><td>${e.type === 'absence' ? 'Absence' : 'Retard'}</td><td class="n">${hm(e.duree_minutes ?? 0)}</td><td>${echapper(e.motif_libelle ?? '—')}</td><td class="${classeStatut(e.motif_statut)}">${statut(e.motif_statut)}</td></tr>`).join('');
  const sans = a.sanctions.map((s) => `<tr><td>${formaterDate(s.date_decision ?? s.date_faits)}</td><td>${echapper(s.palier ?? '—')}</td><td>${echapper(s.motif)}</td><td>${echapper(s.duree ?? '—')}</td></tr>`).join('');
  return `${dom.includes('absences') || dom.includes('retards') ? `<h2>Absences et retards</h2>
    <table><tr><th></th>${dom.includes('absences') ? '<th class="n">Absences</th>' : ''}${dom.includes('retards') ? '<th class="n">Retards</th>' : ''}</tr>
    ${(['Total', 'dont justifiés', 'dont injustifiés', 'en attente de motif'] as const).map((t, i) => {
      const k = (['', 'justifiees', 'injustifiees', 'en_attente'] as const)[i];
      const v = (d: ApprentiRecap['absences']) => (k ? d[k] : d);
      return `<tr><td>${t}</td>${dom.includes('absences') ? `<td class="n">${tD(v(a.absences))}</td>` : ''}${dom.includes('retards') ? `<td class="n">${tD(v(a.retards))}</td>` : ''}</tr>`;
    }).join('')}</table>
    <h2>Détail (${a.evenements.length})</h2>${a.evenements.length ? `<table><tr><th>Date</th><th>Type</th><th class="n">Durée</th><th>Motif</th><th>Statut</th></tr>${evts}</table>` : '<p>Aucune absence ni retard sur cette période.</p>'}` : ''}
    ${dom.includes('sanctions') ? `<h2>Sanctions (${a.sanctions.length})</h2>${a.sanctions.length ? `<table><tr><th>Date</th><th>Palier</th><th>Motif</th><th>Durée</th></tr>${sans}</table>` : '<p>Aucune sanction sur cette période.</p>'}` : ''}`;
}

// Tableau de bord individuel (un apprenti). entreprise = true : document destiné à une entreprise (jamais de sanctions).
export function htmlIndividuel(r: ResultatRecap, a: ApprentiRecap, entreprise = false): string {
  const rr = entreprise ? sansDomaine(r, 'sanctions') : r;
  const solo: ResultatRecap = {
    ...rr, apprentis: [a], totaux: { apprentis: 1, absences: a.absences, retards: a.retards, sanctions: a.sanctions.length },
    par_mois: moisDe(a), par_classe: [], par_palier: palierDe(a),
  };
  const ap = entreprise ? { ...a, sanctions: [] } : a;
  return enveloppe(`<div class="doc">${entete(solo, "Tableau de bord de l'apprenti", `<b>${echapper(a.nom.toUpperCase())} ${echapper(a.prenom)}</b> — ${echapper(a.classe_code)}`)}${graphes(solo)}${blocApprenti(ap, solo)}${pied(solo, entreprise ? "Document destiné à l'entreprise de l'apprenti : données disciplinaires exclues." : 'Données personnelles confidentielles, à ne communiquer qu’aux personnes habilitées.')}</div>`);
}

function moisDe(a: ApprentiRecap) {
  const m: Record<string, { mois: string; absences: number; min_absences: number; retards: number; min_retards: number; sanctions: number }> = {};
  const g = (k: string) => (m[k] ??= { mois: k, absences: 0, min_absences: 0, retards: 0, min_retards: 0, sanctions: 0 });
  for (const e of a.evenements) { const x = g(e.date_debut.slice(0, 7)); if (e.type === 'absence') { x.absences++; x.min_absences += e.duree_minutes ?? 0; } else { x.retards++; x.min_retards += e.duree_minutes ?? 0; } }
  for (const s of a.sanctions) g((s.date_decision ?? s.date_faits).slice(0, 7)).sanctions++;
  return Object.values(m).sort((x, y) => x.mois.localeCompare(y.mois));
}
function palierDe(a: ApprentiRecap) {
  const p: Record<string, number> = {};
  for (const s of a.sanctions) p[s.palier ?? 'Non précisé'] = (p[s.palier ?? 'Non précisé'] ?? 0) + 1;
  return Object.entries(p).map(([palier, nb]) => ({ palier, nb }));
}

// Tableau de bord collectif (classe(s) comparées).
export function htmlCollectif(r: ResultatRecap): string {
  const dom = r.criteres.domaines;
  const t = r.totaux;
  const cartes = `<div class="cartes"><div><b>${t.apprentis}</b>apprenti(s)</div>${dom.includes('absences') ? `<div><b>${t.absences.nb}</b>absences (${hm(t.absences.minutes)})</div>` : ''}${dom.includes('retards') ? `<div><b>${t.retards.nb}</b>retards (${hm(t.retards.minutes)})</div>` : ''}${dom.includes('sanctions') ? `<div><b>${t.sanctions}</b>sanction(s)</div>` : ''}</div>`;
  const cl = `<h2>Comparaison des classes</h2><table><tr><th>Classe</th><th class="n">Apprentis</th>${dom.includes('absences') ? '<th class="n">Absences</th><th class="n">Heures</th>' : ''}${dom.includes('retards') ? '<th class="n">Retards</th><th class="n">Heures</th>' : ''}${dom.includes('sanctions') ? '<th class="n">Sanctions</th>' : ''}</tr>${r.par_classe.map((c) => `<tr><td>${echapper(c.classe)}</td><td class="n">${c.apprentis}</td>${dom.includes('absences') ? `<td class="n">${c.absences}</td><td class="n">${hm(c.min_absences)}</td>` : ''}${dom.includes('retards') ? `<td class="n">${c.retards}</td><td class="n">${hm(c.min_retards)}</td>` : ''}${dom.includes('sanctions') ? `<td class="n">${c.sanctions}</td>` : ''}</tr>`).join('')}</table>`;
  const ap = `<h2>Apprentis (${r.apprentis.length})</h2><table><tr><th>Apprenti</th><th>Classe</th>${dom.includes('absences') ? '<th class="n">Absences</th><th class="n">dont injust.</th>' : ''}${dom.includes('retards') ? '<th class="n">Retards</th><th class="n">dont injust.</th>' : ''}${dom.includes('sanctions') ? '<th class="n">Sanctions</th>' : ''}</tr>${r.apprentis.map((a) => `<tr><td>${echapper(a.nom.toUpperCase())} ${echapper(a.prenom)}</td><td>${echapper(a.classe_code)}</td>${dom.includes('absences') ? `<td class="n">${tD(a.absences)}</td><td class="n">${a.absences.injustifiees.nb}</td>` : ''}${dom.includes('retards') ? `<td class="n">${tD(a.retards)}</td><td class="n">${a.retards.injustifiees.nb}</td>` : ''}${dom.includes('sanctions') ? `<td class="n">${a.sanctions.length}</td>` : ''}</tr>`).join('')}</table>`;
  return enveloppe(`<div class="doc">${entete(r, 'RÉCAPITULATIF – SUIVI DES APPRENTIS', dom.map((d) => ({ absences: 'Absences', retards: 'Retards', sanctions: 'Sanctions' }[d])).join(' · '))}${cartes}${graphes(r)}${cl}${ap}${pied(r, 'Document interne : ne pas transmettre à une entreprise.')}</div>`);
}

type Feuille = { nom: string; lignes: (string | number | null)[][] };
const h2 = (min: number) => Math.round((min / 60) * 100) / 100;

// Excel : synthèse, une ligne par apprenti, détail des absences/retards, sanctions, critères.
export function feuillesExcel(r: ResultatRecap, nomsClasses: string[]): Feuille[] {
  const dom = r.criteres.domaines;
  const f: Feuille[] = [];
  const hdr = ['Apprenti', 'Classe', ...(dom.includes('absences') ? ['Absences', 'Heures abs.', 'Abs. justifiées', 'Abs. injustifiées', 'Abs. en attente'] : []), ...(dom.includes('retards') ? ['Retards', 'Heures ret.', 'Ret. justifiés', 'Ret. injustifiés', 'Ret. en attente'] : []), ...(dom.includes('sanctions') ? ['Sanctions'] : [])];
  f.push({ nom: 'Synthèse', lignes: [hdr, ...r.apprentis.map((a) => [`${a.nom.toUpperCase()} ${a.prenom}`, a.classe_code,
    ...(dom.includes('absences') ? [a.absences.nb, h2(a.absences.minutes), a.absences.justifiees.nb, a.absences.injustifiees.nb, a.absences.en_attente.nb] : []),
    ...(dom.includes('retards') ? [a.retards.nb, h2(a.retards.minutes), a.retards.justifiees.nb, a.retards.injustifiees.nb, a.retards.en_attente.nb] : []),
    ...(dom.includes('sanctions') ? [a.sanctions.length] : [])])] });
  f.push({ nom: 'Par classe', lignes: [['Classe', 'Apprentis', 'Absences', 'Heures abs.', 'Retards', 'Heures ret.', 'Sanctions'], ...r.par_classe.map((c) => [c.classe, c.apprentis, c.absences, h2(c.min_absences), c.retards, h2(c.min_retards), c.sanctions])] });
  f.push({ nom: 'Par mois', lignes: [['Mois', 'Absences', 'Heures abs.', 'Retards', 'Heures ret.', 'Sanctions'], ...r.par_mois.map((m) => [m.mois, m.absences, h2(m.min_absences), m.retards, h2(m.min_retards), m.sanctions])] });
  if (dom.includes('absences') || dom.includes('retards')) {
    f.push({ nom: 'Détail absences-retards', lignes: [['Apprenti', 'Classe', 'Type', 'Début', 'Fin', 'Heures', 'Motif', 'Statut'], ...r.apprentis.flatMap((a) => a.evenements.map((e) => [`${a.nom.toUpperCase()} ${a.prenom}`, a.classe_code, e.type === 'absence' ? 'Absence' : 'Retard', formaterDate(e.date_debut), e.date_fin ? formaterDate(e.date_fin) : null, h2(e.duree_minutes ?? 0), e.motif_libelle ?? '', statut(e.motif_statut)]))] });
  }
  if (dom.includes('sanctions')) {
    f.push({ nom: 'Sanctions', lignes: [['Apprenti', 'Classe', 'Date', 'Palier', 'Motif', 'Durée'], ...r.apprentis.flatMap((a) => a.sanctions.map((s) => [`${a.nom.toUpperCase()} ${a.prenom}`, a.classe_code, formaterDate(s.date_decision ?? s.date_faits), s.palier ?? '', s.motif, s.duree ?? '']))] });
  }
  f.push({ nom: 'Critères', lignes: [['Critère', 'Valeur'], ['Période', `${formaterDate(r.criteres.debut)} → ${formaterDate(r.criteres.fin)}`], ['Domaines', dom.join(', ')], ['Classes', nomsClasses.join(', ') || 'Toutes'], ['Édité le', formaterDate(r.genere_le.slice(0, 10))]] });
  return f;
}
