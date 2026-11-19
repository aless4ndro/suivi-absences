// Calendriers de formation : import validé (ajout / remplacement), archivage des anciennes versions, restauration.
// Les jours du calendrier actif restent dans calendrier_jours ; chaque remplacement archive un instantané complet (jamais supprimé).
const TYPES = ['centre', 'entreprise', 'autre'];
const maintenant = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function plage(annee) {
  if (!/^\d{4}-\d{4}$/.test(annee ?? '')) throw new Error('Année scolaire invalide (ex. 2026-2027).');
  const a = Number(annee.slice(0, 4));
  if (Number(annee.slice(5)) !== a + 1 || a < 2000 || a > 2100) throw new Error('Année scolaire invalide (ex. 2026-2027).');
  return { debut: `${a}-09-01`, fin: `${a + 1}-08-31` };
}

function creerVersionsCalendrier(db, h) {
  const { dateValide, vide, aujourdhui } = h;
  const classe = (id) => {
    const c = db.prepare('SELECT id, code FROM classes WHERE id = ?').get(Number(id));
    if (!c) throw new Error('Classe introuvable.');
    return c;
  };
  const instantane = (classeId, p) => db.prepare('SELECT date, type, libelle FROM calendrier_jours WHERE classe_id = ? AND date BETWEEN ? AND ? ORDER BY date').all(classeId, p.debut, p.fin);
  const proprio = (rows) => rows.map((r) => ({ date: r.date, type: r.type, libelle: r.libelle ?? null }));

  function remplacerJours(classeId, annee, p, jours, source) {
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM calendrier_jours WHERE classe_id = ? AND date BETWEEN ? AND ?').run(classeId, p.debut, p.fin);
      const st = db.prepare('INSERT INTO calendrier_jours (classe_id, date, type, libelle) VALUES (?,?,?,?)');
      for (const j of jours) st.run(classeId, j.date, j.type, j.libelle ?? null);
      db.prepare("INSERT INTO calendrier_actifs (classe_id, annee_scolaire, source, maj_le) VALUES (?,?,?,?) ON CONFLICT(classe_id, annee_scolaire) DO UPDATE SET source = excluded.source, maj_le = excluded.maj_le")
        .run(classeId, annee, source, maintenant());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  function archiver(classeId, annee, p, motif, source) {
    const actuel = instantane(classeId, p);
    if (!actuel.length) return null;
    const src = db.prepare('SELECT source FROM calendrier_actifs WHERE classe_id = ? AND annee_scolaire = ?').get(classeId, annee)?.source ?? source ?? "Calendrier d'origine";
    return Number(db.prepare('INSERT INTO calendrier_versions (classe_id, annee_scolaire, jours, nb_jours, source, motif, archive_le) VALUES (?,?,?,?,?,?,?)')
      .run(classeId, annee, JSON.stringify(proprio(actuel)), actuel.length, src, motif, maintenant()).lastInsertRowid);
  }

  return {
    // Années scolaires proposées : celles qui ont un calendrier, l'année en cours et la suivante.
    'calendrier:annees': () => {
      const t = aujourdhui();
      const courant = Number(t.slice(5, 7)) >= 9 ? Number(t.slice(0, 4)) : Number(t.slice(0, 4)) - 1;
      const vues = db.prepare("SELECT DISTINCT CASE WHEN CAST(substr(date, 6, 2) AS INTEGER) >= 9 THEN CAST(substr(date, 1, 4) AS INTEGER) ELSE CAST(substr(date, 1, 4) AS INTEGER) - 1 END AS a FROM calendrier_jours").all().map((r) => r.a);
      return [...new Set([...vues, courant, courant + 1])].sort().map((a) => `${a}-${a + 1}`);
    },
    'calendrier:annee:classe': ({ classe_id, annee_scolaire }) => {
      const p = plage(annee_scolaire);
      return instantane(Number(classe_id), p).map((r) => ({ date: r.date, type: r.type, libelle: r.libelle }));
    },
    'calendrier:actif': ({ classe_id, annee_scolaire }) => {
      const p = plage(annee_scolaire);
      const nb = instantane(Number(classe_id), p).length;
      const a = db.prepare('SELECT source, maj_le FROM calendrier_actifs WHERE classe_id = ? AND annee_scolaire = ?').get(Number(classe_id), annee_scolaire);
      return { nb_jours: nb, source: a?.source ?? (nb ? "Calendrier d'origine" : null), maj_le: a?.maj_le ?? null };
    },

    // jours : [{ date, type, libelle }] — corrigés et validés par l'utilisateur dans l'aperçu.
    'calendrier:import:valider': ({ classe_id, annee_scolaire, operation, jours, source }) => {
      const c = classe(classe_id);
      const p = plage(annee_scolaire);
      if (!['ajouter', 'remplacer'].includes(operation)) throw new Error('Opération invalide.');
      if (!Array.isArray(jours) || !jours.length) throw new Error('Le calendrier à importer est vide.');
      const vus = new Set();
      const propres = [];
      for (const j of jours) {
        if (!dateValide(j.date)) throw new Error(`Date invalide : ${j.date}`);
        if (j.date < p.debut || j.date > p.fin) throw new Error(`${j.date.split('-').reverse().join('/')} n'appartient pas à l'année scolaire ${annee_scolaire}.`);
        if (!TYPES.includes(j.type)) throw new Error(`Type de journée invalide le ${j.date.split('-').reverse().join('/')}.`);
        if (vus.has(j.date)) continue;
        vus.add(j.date);
        propres.push({ date: j.date, type: j.type, libelle: vide(j.libelle) });
      }
      const existants = instantane(c.id, p).length;
      if (operation === 'ajouter' && existants) throw new Error(`${c.code} a déjà un calendrier ${annee_scolaire} : choisissez « Remplacer » (l'ancien sera archivé).`);
      if (operation === 'remplacer' && !existants) throw new Error(`${c.code} n'a pas encore de calendrier ${annee_scolaire} : choisissez « Ajouter ».`);
      const src = vide(source) ?? 'Import';
      const archive = operation === 'remplacer' ? archiver(c.id, annee_scolaire, p, 'remplacement') : null;
      remplacerJours(c.id, annee_scolaire, p, propres, src);
      return { nb_jours: propres.length, archive_id: archive };
    },

    'calendrier:versions': ({ classe_id, annee_scolaire }) => {
      plage(annee_scolaire);
      return db.prepare('SELECT id, source, motif, nb_jours, archive_le FROM calendrier_versions WHERE classe_id = ? AND annee_scolaire = ? ORDER BY id DESC').all(Number(classe_id), annee_scolaire);
    },
    'calendrier:version:detail': (id) => {
      const v = db.prepare('SELECT * FROM calendrier_versions WHERE id = ?').get(Number(id));
      if (!v) throw new Error('Version introuvable.');
      return { ...v, jours: JSON.parse(v.jours) };
    },
    // La version actuelle est archivée avant d'être remplacée : aucune perte possible.
    'calendrier:version:restaurer': (id) => {
      const v = db.prepare('SELECT * FROM calendrier_versions WHERE id = ?').get(Number(id));
      if (!v) throw new Error('Version introuvable.');
      const p = plage(v.annee_scolaire);
      const archive = archiver(v.classe_id, v.annee_scolaire, p, 'avant restauration');
      remplacerJours(v.classe_id, v.annee_scolaire, p, JSON.parse(v.jours), `Restauration de la version du ${v.archive_le}`);
      return { archive_id: archive };
    },
  };
}

module.exports = { creerVersionsCalendrier, plage };
