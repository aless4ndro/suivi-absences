// Détection d'une mise à jour : on compare la version installée aux Releases GitHub publiques du dépôt.
const DEPOT = 'aless4ndro/suivi-absences';
const NOM_INSTALLATEUR = 'SuiviAbsences-Setup.exe';
const PREFIXE_TELECHARGEMENT = `https://github.com/${DEPOT}/releases/download/`;

function versionEnNombres(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// > 0 si a est plus récente que b ; null si l'une des versions est illisible.
function comparer(a, b) {
  const x = versionEnNombres(a); const y = versionEnNombres(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// Parmi les releases GitHub, retient la plus récente (hors brouillons) qui porte l'installateur et dépasse la version installée.
function choisirMiseAJour(releases, versionInstallee) {
  let meilleure = null;
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!r || r.draft) continue;
    const actif = (r.assets ?? []).find((a) => a.name === NOM_INSTALLATEUR && typeof a.browser_download_url === 'string' && a.browser_download_url.startsWith(PREFIXE_TELECHARGEMENT));
    if (!actif) continue;
    const version = String(r.tag_name ?? '').replace(/^v/, '');
    if ((comparer(version, versionInstallee) ?? 0) <= 0) continue;
    if (!meilleure || comparer(version, meilleure.version) > 0) meilleure = { version, url: actif.browser_download_url, taille: actif.size ?? 0 };
  }
  return meilleure;
}

module.exports = { DEPOT, NOM_INSTALLATEUR, PREFIXE_TELECHARGEMENT, comparer, choisirMiseAJour };
