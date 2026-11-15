// Préparation d'un mail dans Outlook (ancien Outlook installé sur le poste).
// Le mail est ouvert en brouillon : l'utilisatrice le relit et clique elle-même sur Envoyer.
const fs = require('node:fs');
const path = require('node:path');

const jourMois = (iso) => iso.split('-').reverse().join('/');

function formaterDuree(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

// Nom de fichier sûr pour le système de fichiers Windows.
function nomSur(nom) {
  return path.basename(String(nom)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'fichier';
}

// d : résultat de l'action 'evenements:detail'
function composer(d) {
  const nom = `${d.jeune_prenom} ${d.jeune_nom}`;
  const absence = d.type === 'absence';
  const multi = absence && d.date_fin && d.date_fin !== d.date_debut;

  const quand = multi
    ? `du ${jourMois(d.date_debut)} au ${jourMois(d.date_fin)}`
    : `le ${jourMois(d.date_debut)}`;
  const objet = `${absence ? 'Absence' : 'Retard'} de ${nom} ${quand}`;

  const fait = absence ? `absent(e) ${quand}` : `en retard ${quand}`;
  const motif = d.motif_libelle
    ? `${d.motif_libelle} (${d.motif_statut === 'recevable' ? 'recevable' : 'irrecevable'})`
    : 'en attente de justificatif';

  const corps = [
    `Bonjour${d.maitre_nom ? ` ${d.maitre_nom}` : ''},`,
    '',
    `Nous vous informons que ${nom} (${d.classe_code}), apprenti(e) au sein de votre entreprise, a été ${fait}.`,
    '',
    `${absence ? "Durée totale d'absence" : 'Durée du retard'} : ${formaterDuree(d.duree_minutes)}`,
    `Motif : ${motif}`,
    '',
    'Nous restons à votre disposition pour toute précision.',
    '',
    'Cordialement,',
  ].join('\n');

  const a = d.maitre_email || d.entreprise_email || '';
  return {
    a,
    objet,
    corps,
    avertissement: a ? null : "Aucune adresse e-mail n'est renseignée pour le maître d'apprentissage ni pour l'entreprise. Complétez la fiche, ou saisissez l'adresse directement dans Outlook.",
  };
}

// Script PowerShell exécuté via -EncodedCommand : pas de fichier .ps1, donc pas bloqué par la stratégie d'exécution.
function construireScript(cheminJson) {
  const lit = cheminJson.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop'",
    `$d = Get-Content -LiteralPath '${lit}' -Raw -Encoding UTF8 | ConvertFrom-Json`,
    '$ol = New-Object -ComObject Outlook.Application',
    '$m = $ol.CreateItem(0)',
    '$m.Subject = $d.objet',
    'if ($d.a) { $m.To = $d.a }',
    'foreach ($f in @($d.fichiers)) { if ($f) { [void]$m.Attachments.Add([string]$f) } }',
    '$m.Display()',
    // Le texte est placé avant la signature automatique d'Outlook.
    '$corps = [System.Net.WebUtility]::HtmlEncode($d.corps) -replace "`r?`n", "<br>"',
    "$m.HTMLBody = '<div style=\"font-family:Calibri,sans-serif;font-size:11pt\">' + $corps + '</div>' + $m.HTMLBody",
  ].join('\n');
}

function encoder(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function urlMailto({ a, objet, corps }) {
  const court = corps.length > 1500 ? `${corps.slice(0, 1500)}…` : corps;
  const q = `subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(court).replace(/%0A/g, '%0D%0A')}`;
  return `mailto:${encodeURIComponent(a).replace(/%40/g, '@')}?${q}`;
}

// deps : { plateforme, executer(cmd, args), ouvrirExterne(url), ouvrirDossier(chemin), dossierTravail }
async function preparerBrouillon({ a, objet, corps, fichiers }, deps) {
  const plateforme = deps.plateforme ?? process.platform;
  let raison = 'Outlook ne peut être piloté que sous Windows.';

  if (plateforme === 'win32') {
    try {
      const json = path.join(deps.dossierTravail, 'message.json');
      fs.writeFileSync(json, JSON.stringify({ a, objet, corps, fichiers }), 'utf8');
      await deps.executer('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoder(construireScript(json))]);
      return { methode: 'outlook' };
    } catch (e) {
      raison = String(e.stderr || e.message || e).trim().split('\n')[0];
    }
  }

  // Repli : ouvre un nouveau message avec le texte (sans pièce jointe) et montre le dossier des pièces à glisser dedans.
  await deps.ouvrirExterne(urlMailto({ a, objet, corps }));
  if (fichiers.length) await deps.ouvrirDossier(deps.dossierTravail);
  return { methode: 'mailto', raison, nbPieces: fichiers.length };
}

module.exports = { composer, construireScript, encoder, urlMailto, preparerBrouillon, nomSur, formaterDuree };
