// Alertes automatiques de seuils : retards, absences non recevables (en demi-journées), cumul.
// L'application SIGNALE ; elle ne sanctionne jamais. Chaque alerte est suivie (statut, note, journal).
const STATUTS = ['nouvelle', 'a_traiter', 'en_cours', 'traitee', 'sans_suite', 'cloturee'];
const NOMS_STATUTS = { nouvelle: 'Nouvelle', a_traiter: 'À traiter', en_cours: 'En cours', traitee: 'Traitée', sans_suite: 'Sans suite', cloturee: 'Clôturée' };
const PERIODES = ['semaine', 'mois', 'annee'];
const FENETRE_JOURS = 100; // seules les périodes récentes sont analysées
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const maintenant = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const iso = (d) => d.toISOString().slice(0, 10);
const jma = (i) => i.split('-').reverse().join('/');
const ajouter = (i, n) => { const d = new Date(`${i}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

// Clé et bornes de la période contenant une date.
function periodeDe(periode, date) {
  const d = new Date(`${date}T00:00:00Z`);
  if (periode === 'mois') {
    const debut = `${date.slice(0, 7)}-01`;
    const fin = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
    return { cle: date.slice(0, 7), debut, fin, libelle: `${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
  }
  if (periode === 'semaine') {
    const jour = (d.getUTCDay() + 6) % 7;
    const debut = ajouter(date, -jour);
    return { cle: debut, debut, fin: ajouter(debut, 6), libelle: `semaine du ${jma(debut)}` };
  }
  const an = d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return { cle: `${an}-${an + 1}`, debut: `${an}-09-01`, fin: `${an + 1}-08-31`, libelle: `année ${an}-${an + 1}` };
}
function plageDe(periode, cle) {
  if (periode === 'mois') return periodeDe('mois', `${cle}-01`);
  if (periode === 'semaine') return periodeDe('semaine', cle);
  return periodeDe('annee', `${cle.slice(0, 4)}-09-01`);
}

function creerAlertes(db, h) {
  const { aujourdhui, horaires } = h;
  const journaliser = (id, action, detail) =>
    db.prepare('INSERT INTO alerte_journal (alerte_id, quand, action, detail) VALUES (?,?,?,?)').run(id, maintenant(), action, detail ?? null);

  // Faits d'un apprenti sur une plage : retards, et demi-journées d'absence non recevable (matin / après-midi d'après les horaires).
  function faits(debut, fin, jeuneId) {
    const hor = horaires();
    const lignes = db.prepare(
      `SELECT e.id AS evenement_id, e.jeune_id, e.type, c.date, c.heure_debut, c.heure_fin, m.statut AS motif_statut, m.libelle AS motif
       FROM creneaux c JOIN evenements e ON e.id = c.evenement_id LEFT JOIN motifs m ON m.id = e.motif_id
       JOIN jeunes j ON j.id = e.jeune_id
       WHERE c.date BETWEEN ? AND ? ${jeuneId ? 'AND e.jeune_id = ?' : ''} AND (j.sorti_le IS NULL OR c.date < j.sorti_le)
       ORDER BY c.date, c.heure_debut`
    ).all(...(jeuneId ? [debut, fin, jeuneId] : [debut, fin]));
    const sortie = [];
    for (const l of lignes) {
      if (l.type === 'retard') sortie.push({ ...l, nature: 'retard', cle: `r|${l.evenement_id}|${l.date}|${l.heure_debut}` });
      else if (l.motif_statut === 'irrecevable') {
        if (l.heure_debut < hor.pause_debut) sortie.push({ ...l, nature: 'demi', demi: 'matin', cle: `d|${l.date}|matin` });
        if (l.heure_fin > hor.pause_fin) sortie.push({ ...l, nature: 'demi', demi: 'après-midi', cle: `d|${l.date}|apm` });
      }
    }
    // une demi-journée compte une seule fois, même découpée en plusieurs créneaux
    const vus = new Set();
    return sortie.filter((f) => (vus.has(`${f.jeune_id}|${f.cle}`) ? false : vus.add(`${f.jeune_id}|${f.cle}`)));
  }
  const valeurDe = (code, fs) => {
    const r = fs.filter((f) => f.nature === 'retard').length;
    const d = fs.filter((f) => f.nature === 'demi').length;
    return code === 'retards' ? r : code === 'demi_journees' ? d : r + d;
  };

  // Crée / met à jour les alertes des périodes récentes. Une alerte déjà traitée n'est jamais rouverte ni supprimée.
  function recalculer() {
    const auj = aujourdhui();
    const depuis = ajouter(auj, -FENETRE_JOURS);
    const regles = db.prepare('SELECT * FROM regles_alerte WHERE actif = 1').all();
    const tous = faits(depuis, auj);
    const vusCles = new Set();
    for (const r of regles) {
      const groupes = new Map();
      for (const f of tous) {
        const p = periodeDe(r.periode, f.date);
        const k = `${f.jeune_id}|${p.cle}`;
        if (!groupes.has(k)) groupes.set(k, { jeune_id: f.jeune_id, cle: p.cle, fs: [] });
        groupes.get(k).fs.push(f);
      }
      for (const g of groupes.values()) {
        const valeur = valeurDe(r.code, g.fs);
        if (valeur < r.seuil) continue;
        vusCles.add(`${r.id}|${g.jeune_id}|${g.cle}`);
        const ex = db.prepare('SELECT * FROM alertes WHERE regle_id = ? AND jeune_id = ? AND periode_cle = ?').get(r.id, g.jeune_id, g.cle);
        if (!ex) {
          const id = Number(db.prepare('INSERT INTO alertes (regle_id, jeune_id, periode_cle, valeur, seuil, cree_le) VALUES (?,?,?,?,?,?)').run(r.id, g.jeune_id, g.cle, valeur, r.seuil, maintenant()).lastInsertRowid);
          journaliser(id, 'Création', `${r.libelle} : ${valeur} (seuil ${r.seuil})`);
        } else if (ex.valeur !== valeur && ex.statut !== 'cloturee') {
          db.prepare('UPDATE alertes SET valeur = ?, seuil = ?, modifie_le = ? WHERE id = ?').run(valeur, r.seuil, maintenant(), ex.id);
          journaliser(ex.id, 'Mise à jour', `${ex.valeur} → ${valeur}`);
        }
      }
    }
    // alerte « nouvelle » devenue sans objet (faits supprimés ou corrigés) : retirée ; les autres restent consultables
    for (const a of db.prepare("SELECT a.id, a.regle_id, a.jeune_id, a.periode_cle FROM alertes a WHERE a.statut = 'nouvelle'").all()) {
      if (!vusCles.has(`${a.regle_id}|${a.jeune_id}|${a.periode_cle}`)) {
        const r = db.prepare('SELECT * FROM regles_alerte WHERE id = ?').get(a.regle_id);
        const p = plageDe(r.periode, a.periode_cle);
        if (p.debut >= depuis || p.fin >= depuis) db.prepare('DELETE FROM alertes WHERE id = ?').run(a.id);
      }
    }
  }

  const SELECT = `
    SELECT a.*, r.code AS regle_code, r.libelle AS regle_libelle, r.periode AS regle_periode, j.nom AS jeune_nom, j.prenom AS jeune_prenom
    FROM alertes a JOIN regles_alerte r ON r.id = a.regle_id JOIN jeunes j ON j.id = a.jeune_id`;
  const enrichir = (a) => ({ ...a, periode_libelle: plageDe(a.regle_periode, a.periode_cle).libelle });

  return {
    recalculer, // utilisé par le tableau de bord
    'alertes:regles': () => {
      const regles = db.prepare('SELECT * FROM regles_alerte ORDER BY id').all();
      return regles.map((r) => ({ ...r, destinataires: db.prepare('SELECT intervenant_id FROM regle_destinataires WHERE regle_id = ?').all(r.id).map((x) => x.intervenant_id) }));
    },
    'alertes:regle:save': (r) => {
      const ex = db.prepare('SELECT * FROM regles_alerte WHERE id = ?').get(Number(r.id));
      if (!ex) throw new Error('Règle introuvable.');
      const seuil = Number(r.seuil);
      if (!Number.isInteger(seuil) || seuil < 1 || seuil > 99) throw new Error('Le seuil doit être un entier entre 1 et 99.');
      if (!PERIODES.includes(r.periode)) throw new Error('Période invalide.');
      db.prepare('UPDATE regles_alerte SET seuil = ?, periode = ?, actif = ? WHERE id = ?').run(seuil, r.periode, r.actif === 0 || r.actif === false ? 0 : 1, ex.id);
      db.prepare('DELETE FROM regle_destinataires WHERE regle_id = ?').run(ex.id);
      for (const iid of [...new Set((r.destinataires ?? []).map(Number))]) {
        if (db.prepare('SELECT 1 FROM intervenants WHERE id = ?').get(iid)) db.prepare('INSERT INTO regle_destinataires (regle_id, intervenant_id) VALUES (?,?)').run(ex.id, iid);
      }
      return true;
    },
    'alertes:recalculer': () => { recalculer(); return true; },
    'alertes:list': (f = {}) => {
      recalculer();
      const w = [];
      const p = [];
      if (f.statut === 'ouvertes') w.push("a.statut IN ('nouvelle', 'a_traiter', 'en_cours')");
      else if (f.statut) { w.push('a.statut = ?'); p.push(f.statut); }
      if (f.regle_id) { w.push('a.regle_id = ?'); p.push(Number(f.regle_id)); }
      if (f.jeune_id) { w.push('a.jeune_id = ?'); p.push(Number(f.jeune_id)); }
      return db.prepare(`${SELECT} ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY a.id DESC`).all(...p).map(enrichir);
    },
    'alertes:compteurs': () => {
      recalculer();
      const n = (s) => db.prepare(`SELECT COUNT(*) AS n FROM alertes WHERE statut IN (${s})`).get().n;
      return { nouvelles: n("'nouvelle'"), en_cours: n("'a_traiter', 'en_cours'") };
    },
    'alertes:get': (id) => {
      const a = db.prepare(`${SELECT} WHERE a.id = ?`).get(Number(id));
      if (!a) throw new Error('Alerte introuvable.');
      const p = plageDe(a.regle_periode, a.periode_cle);
      const fs = faits(p.debut, p.fin, a.jeune_id).filter((f) => a.regle_code === 'cumul' || (a.regle_code === 'retards' ? f.nature === 'retard' : f.nature === 'demi'));
      return {
        ...enrichir(a),
        faits: fs.map((f) => ({ date: f.date, nature: f.nature, detail: f.nature === 'retard' ? `Retard ${f.heure_debut}–${f.heure_fin}` : `Absence ${f.demi}`, motif: f.motif })),
        destinataires: db.prepare('SELECT i.id, i.nom, i.fonction, i.email FROM regle_destinataires d JOIN intervenants i ON i.id = d.intervenant_id WHERE d.regle_id = ? AND i.actif = 1').all(a.regle_id),
        journal: db.prepare('SELECT * FROM alerte_journal WHERE alerte_id = ? ORDER BY id DESC').all(a.id),
      };
    },
    'alertes:statut': ({ id, statut, note }) => {
      if (!STATUTS.includes(statut)) throw new Error('Statut invalide.');
      const a = db.prepare('SELECT * FROM alertes WHERE id = ?').get(Number(id));
      if (!a) throw new Error('Alerte introuvable.');
      const n = String(note ?? '').trim() || null;
      db.prepare('UPDATE alertes SET statut = ?, note = COALESCE(?, note), modifie_le = ? WHERE id = ?').run(statut, n, maintenant(), a.id);
      journaliser(a.id, 'Statut', `${NOMS_STATUTS[a.statut]} → ${NOMS_STATUTS[statut]}${n ? ` (${n})` : ''}`);
      return true;
    },
    'alertes:communication:archiver': (m) => {
      const a = db.prepare('SELECT id FROM alertes WHERE id = ?').get(Number(m.alerte_id));
      if (!a) throw new Error('Alerte introuvable.');
      const dest = [...(m.a ?? []), ...(m.cc ?? []), ...(m.cci ?? [])];
      if (!dest.length) throw new Error('Aucun destinataire.');
      journaliser(a.id, 'Communication', `Mail préparé — ${dest.join(', ')}`);
      return true;
    },
  };
}

module.exports = { creerAlertes, STATUTS, NOMS_STATUTS, periodeDe, plageDe };
