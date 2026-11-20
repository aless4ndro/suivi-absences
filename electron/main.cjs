const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { ouvrir, TAILLE_MAX_PIECE } = require('./db.cjs');
const { creerSession } = require('./auth.cjs');
const { verifierSauvegarde, remplacer } = require('./sauvegarde.cjs');
const { lirePdf } = require('./calendrier-pdf.cjs');
const { lireTableau, reconnaitreColonnes, normaliserFeuilles, CHAMPS } = require('./import-tableau.cjs');
const { lireXlsx } = require('./calendrier-import.cjs');
const { composer, repartir, preparerBrouillon, nomSur, convertirWordEnPdf } = require('./courriel.cjs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileP = promisify(execFile);

let db;
let cheminDb;
let session;

// Fichiers choisis dans la fenêtre de sélection : l'interface ne manipule que des jetons,
// jamais de chemins (elle ne peut donc pas faire lire un fichier arbitraire).
const selections = new Map();
const dossierTemp = () => path.join(app.getPath('temp'), 'suivi-absences-pieces');

function horodatage() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}`;
}

function creerFenetre() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Suivi Absences',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Aucun lien ne doit ouvrir une page web dans l'appli
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('mailto:') || url.startsWith('tel:')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

// Imprime du HTML en PDF (A4) dans une fenêtre cachée, sans JavaScript. Le logo est incorporé au document.
async function htmlVersPdf(html) {
  const logo = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, 'logo-etablissement.png')).toString('base64')}`;
  const complet = String(html).replaceAll('src="logo-etablissement.png"', `src="${logo}"`);
  const fenetre = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await fenetre.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(complet)}`);
    return await fenetre.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'none' } });
  } finally {
    fenetre.destroy();
  }
}

function exigerOuvert() {
  if (!session.estOuvert()) throw new Error('Application verrouillée.');
}

function brancherIpc() {
  ipcMain.handle('db', (_e, action, arg) => {
    exigerOuvert();
    return db.appeler(action, arg);
  });

  ipcMain.handle('auth', (_e, action, arg = {}) => {
    switch (action) {
      case 'etat': return session.etat();
      case 'definir': session.definir(arg.mdp); return session.etat();
      case 'connecter': session.connecter(arg.mdp); return session.etat();
      case 'changer': session.changer(arg.ancien, arg.nouveau); return true;
      case 'verrouiller': session.verrouiller(); return session.etat();
      default: throw new Error(`Action inconnue : ${action}`);
    }
  });

  ipcMain.handle('courriel', async (_e, action, arg = {}) => {
    exigerOuvert();
    const detail = db.appeler('evenements:detail', arg.id);
    const message = composer(detail, arg.envoi ?? arg.destinataires);

    if (action === 'apercu') return message;

    if (action === 'ouvrir') {
      // Seules les pièces de cet événement peuvent être jointes, et uniquement celles cochées.
      const autorisees = new Set(db.appeler('pieces:list', arg.id).map((p) => p.id));
      const ids = (arg.piece_ids ?? []).filter((id) => autorisees.has(id));
      fs.mkdirSync(dossierTemp(), { recursive: true });
      const dossier = fs.mkdtempSync(path.join(dossierTemp(), 'courriel-'));
      const fichiers = ids.map((id) => {
        const { nom_fichier, contenu } = db.appeler('pieces:contenu', id);
        const chemin = path.join(dossier, nomSur(nom_fichier));
        fs.writeFileSync(chemin, contenu);
        return chemin;
      });
      return preparerBrouillon(
        { ...message, fichiers },
        {
          executer: execFileP,
          ouvrirExterne: (url) => shell.openExternal(url),
          ouvrirDossier: (d) => shell.openPath(d),
          dossierTravail: dossier,
        }
      );
    }
    throw new Error(`Action inconnue : ${action}`);
  });

  // Documents : convocation, feuille d'émargement et bilan sont fabriqués en HTML puis imprimés en PDF.
  ipcMain.handle('documents', async (event, action, arg = {}) => {
    exigerOuvert();
    const win = BrowserWindow.fromWebContents(event.sender);
    const nomPdf = nomSur(String(arg.nom || 'document')).replace(/\.pdf$/i, '') + '.pdf';

    if (action === 'pdf') {
      const pdf = await htmlVersPdf(arg.html);
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Enregistrer le document en PDF',
        defaultPath: path.join(app.getPath('documents'), nomPdf),
        filters: [{ name: 'Document PDF', extensions: ['pdf'] }],
      });
      if (canceled || !filePath) return { annule: true };
      fs.writeFileSync(filePath, pdf);
      return { chemin: filePath };
    }

    if (action === 'courriel') {
      // Convocation ou bilan : un PDF éventuel + justificatifs choisis, dans un brouillon Outlook (jamais envoyé automatiquement).
      fs.mkdirSync(dossierTemp(), { recursive: true });
      const dossier = fs.mkdtempSync(path.join(dossierTemp(), 'courriel-'));
      const fichiers = [];
      if (arg.html) {
        const chemin = path.join(dossier, nomPdf);
        fs.writeFileSync(chemin, await htmlVersPdf(arg.html));
        fichiers.push(chemin);
      }
      for (const id of arg.piece_seance_ids ?? []) {
        const { nom_fichier, contenu } = db.appeler('rattrapages:piece:contenu', id);
        const chemin = path.join(dossier, `Emargement-${id}-${nomSur(nom_fichier)}`);
        fs.writeFileSync(chemin, contenu);
        fichiers.push(chemin);
      }
      for (const id of arg.piece_sanction_ids ?? []) {
        const { nom_fichier, contenu } = db.appeler('sanctions:piece:contenu', id);
        const chemin = path.join(dossier, `Piece-${id}-${nomSur(nom_fichier)}`);
        fs.writeFileSync(chemin, contenu);
        fichiers.push(chemin);
      }
      for (const id of arg.piece_commission_ids ?? []) {
        const { nom_fichier, contenu } = db.appeler('commissions:piece:contenu', id);
        const chemin = path.join(dossier, `${id}-${nomSur(nom_fichier)}`);
        fs.writeFileSync(chemin, contenu);
        fichiers.push(chemin);
      }
      for (const id of arg.piece_evenement_ids ?? []) {
        const { nom_fichier, contenu } = db.appeler('pieces:contenu', id);
        const chemin = path.join(dossier, `Justificatif-${id}-${nomSur(nom_fichier)}`);
        fs.writeFileSync(chemin, contenu);
        fichiers.push(chemin);
      }
      return preparerBrouillon(
        { ...repartir({ a: arg.a ?? '', cc: arg.cc ?? '', cci: arg.cci ?? '' }), objet: String(arg.objet || ''), corps: String(arg.corps || ''), fichiers },
        {
          executer: execFileP,
          ouvrirExterne: (url) => shell.openExternal(url),
          ouvrirDossier: (d) => shell.openPath(d),
          dossierTravail: dossier,
        }
      );
    }
    throw new Error(`Action inconnue : ${action}`);
  });

  ipcMain.handle('fichiers', async (event, action, arg = {}) => {
    exigerOuvert();
    const win = BrowserWindow.fromWebContents(event.sender);

    if (action === 'emplacement') return { dossier: app.getPath('userData') };

    if (action === 'choisirPieces') {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: arg.scans ? "Choisir la feuille d'émargement signée (PDF, JPG ou PNG)" : 'Choisir une ou plusieurs pièces jointes',
        properties: ['openFile', 'multiSelections'],
        filters: arg.scans ? [{ name: 'PDF et images', extensions: ['pdf', 'jpg', 'jpeg', 'png'] }] : undefined,
      });
      if (canceled) return { pieces: [], refusees: [] };
      const pieces = [];
      const refusees = [];
      for (const chemin of filePaths) {
        const nom = path.basename(chemin);
        try {
          const taille = fs.statSync(chemin).size;
          if (taille === 0) { refusees.push(`${nom} (fichier vide)`); continue; }
          if (taille > TAILLE_MAX_PIECE) { refusees.push(`${nom} (plus de 10 Mo)`); continue; }
          const token = crypto.randomUUID();
          selections.set(token, chemin);
          pieces.push({ token, nom, taille });
        } catch {
          refusees.push(`${nom} (illisible)`);
        }
      }
      return { pieces, refusees };
    }

    if (action === 'ajouterPieces') {
      let ajoutees = 0;
      const erreurs = [];
      for (const token of arg.tokens ?? []) {
        const chemin = selections.get(token);
        if (!chemin) { erreurs.push('fichier non sélectionné'); continue; }
        selections.delete(token);
        try {
          const contenu = fs.readFileSync(chemin);
          if (arg.commission_id) db.appeler('commissions:piece:ajouter', { commission_id: arg.commission_id, nom: path.basename(chemin), contenu });
          else if (arg.sanction_id) db.appeler('sanctions:piece:ajouter', { sanction_id: arg.sanction_id, nom: path.basename(chemin), contenu });
          else if (arg.seance_id) db.appeler('rattrapages:piece:ajouter', { seance_id: arg.seance_id, nom: path.basename(chemin), contenu });
          else db.appeler('pieces:ajouter', { evenement_id: arg.evenement_id, nom: path.basename(chemin), contenu });
          ajoutees++;
        } catch (e) {
          erreurs.push(`${path.basename(chemin)} : ${e.message}`);
        }
      }
      return { ajoutees, erreurs };
    }

    if (action === 'ouvrirPiece') {
      const { nom_fichier, contenu } = db.appeler(arg.commission ? 'commissions:piece:contenu' : arg.sanction ? 'sanctions:piece:contenu' : arg.rattrapage ? 'rattrapages:piece:contenu' : 'pieces:contenu', arg.id);
      const dossier = dossierTemp();
      fs.mkdirSync(dossier, { recursive: true });
      const sur = nomSur(nom_fichier);
      const fichier = path.join(dossier, `${arg.commission ? 'c' : arg.sanction ? 's' : arg.rattrapage ? 'r' : ''}${arg.id}-${sur}`);
      // Document Word déjà modifié : la version enregistrée dans Word est reprise avant de rouvrir (rien n'est écrasé).
      if (arg.commission && /\.docx$/i.test(nom_fichier) && fs.existsSync(fichier)) {
        const modifie = fs.readFileSync(fichier);
        if (!modifie.equals(contenu)) { try { db.appeler('commissions:piece:remplacer', { id: arg.id, contenu: modifie }); } catch { /* fichier non valide : version du dossier conservée */ } }
      }
      if (!(arg.commission && fs.existsSync(fichier))) fs.writeFileSync(fichier, contenu);
      const erreur = await shell.openPath(fichier);
      if (erreur) throw new Error(`Impossible d'ouvrir le fichier : ${erreur}`);
      return true;
    }

    // Convocation Word modifiée par l'utilisatrice → archivage de la version modifiée + PDF (Word, Windows).
    if (action === 'commissionPdf') {
      const { nom_fichier, contenu } = db.appeler('commissions:piece:contenu', arg.id);
      if (!/\.docx$/i.test(nom_fichier)) throw new Error('Seul un document Word peut être converti.');
      const dossier = dossierTemp();
      fs.mkdirSync(dossier, { recursive: true });
      const fichier = path.join(dossier, `c${arg.id}-${nomSur(nom_fichier)}`);
      const modifie = fs.existsSync(fichier) ? fs.readFileSync(fichier) : null;
      if (modifie && !modifie.equals(contenu)) db.appeler('commissions:piece:remplacer', { id: arg.id, contenu: modifie });
      else fs.writeFileSync(fichier, contenu);
      const pdf = fichier.replace(/\.docx$/i, '.pdf');
      if (fs.existsSync(pdf)) fs.rmSync(pdf);
      await convertirWordEnPdf(fichier, pdf, { executer: execFileP });
      db.appeler('commissions:piece:ajouter', { commission_id: arg.commission_id, nom: nom_fichier.replace(/\.docx$/i, '.pdf'), contenu: fs.readFileSync(pdf), genere: true });
      return { modifie: !!(modifie && !modifie.equals(contenu)) };
    }

    // Import d'un calendrier de formation : lecture du fichier choisi (aperçu, rien n'est enregistré).
    if (action === 'lireCalendrier') {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: 'Choisir le calendrier de formation',
        properties: ['openFile'],
        filters: [{ name: 'Calendrier (Excel ou PDF)', extensions: ['xlsx', 'xls', 'pdf'] }],
      });
      if (canceled || !filePaths.length) return { annule: true };
      const chemin = filePaths[0];
      const nom = path.basename(chemin);
      const ext = path.extname(nom).toLowerCase();
      if (fs.statSync(chemin).size > 25 * 1024 * 1024) throw new Error('Fichier trop volumineux (25 Mo maximum).');
      if (ext === '.xls') throw new Error("Ce fichier est au format Excel ancien (.xls). Ouvrez-le dans Excel puis « Enregistrer sous » au format .xlsx, et importez ce nouveau fichier.");
      if (ext === '.pdf') return { nom, ...(await lirePdf(fs.readFileSync(chemin), arg.annee_scolaire)) };
      if (ext !== '.xlsx') throw new Error('Format non pris en charge : choisissez un fichier .xlsx.');
      return { nom, ...lireXlsx(fs.readFileSync(chemin), arg.annee_scolaire) };
    }

    // Import des apprentis / entreprises / contrats : lecture du fichier (CSV ou Excel), colonnes reconnues.
    if (action === 'lireImport') {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: 'Choisir le fichier à importer',
        properties: ['openFile'],
        filters: [{ name: 'Tableur (Excel ou CSV)', extensions: ['xlsx', 'xls', 'csv'] }],
      });
      if (canceled || !filePaths.length) return { annule: true };
      const chemin = filePaths[0];
      const nom = path.basename(chemin);
      const ext = path.extname(nom).toLowerCase();
      if (fs.statSync(chemin).size > 25 * 1024 * 1024) throw new Error('Fichier trop volumineux (25 Mo maximum).');
      if (ext === '.xls') throw new Error("Ce fichier est au format Excel ancien (.xls). Ouvrez-le dans Excel puis « Enregistrer sous » au format .xlsx (ou CSV), et importez ce nouveau fichier.");
      if (!['.xlsx', '.csv'].includes(ext)) throw new Error('Format non pris en charge : choisissez un fichier .xlsx ou .csv.');
      const t = lireTableau(fs.readFileSync(chemin), ext);
      return { nom, ignorees: t.ignorees, feuilles: t.feuilles.map((f) => ({ ...f, champs: reconnaitreColonnes(f.entetes, f.lignes) })), liste_champs: CHAMPS };
    }
    // Lignes normalisées à partir de la correspondance colonne → champ choisie par l'utilisateur.
    if (action === 'normaliserImport') {
      return normaliserFeuilles(arg.feuilles);
    }
    if (action === 'validerImport') {
      const dossierSecu = path.join(app.getPath('userData'), 'avant-import');
      fs.mkdirSync(dossierSecu, { recursive: true });
      const sauvegarde = path.join(dossierSecu, `avant-import-${horodatage()}.db`);
      db.sauvegarder(sauvegarde);
      let utilisateur = null;
      try { utilisateur = require('node:os').userInfo().username; } catch { /* sans importance */ }
      return db.appeler('import:appliquer', { arg, utilisateur, sauvegarde });
    }
    if (action === 'rapportImport') {
      const r = db.appeler('import:rapport', arg.id);
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: "Enregistrer le rapport d'anomalies",
        defaultPath: path.join(app.getPath('documents'), `Rapport-import-${horodatage()}.csv`),
        filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }],
      });
      if (canceled || !filePath) return { annule: true };
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lignes = [['Ligne du fichier', 'Apprenti', 'Anomalies', 'Informations manquantes', 'Exclue'].map(q).join(';')];
      for (const l of r.lignes) lignes.push([l.ligne, l.nom, l.anomalies.join(' ; '), l.manquants.join(', '), l.exclue ? 'oui' : 'non'].map(q).join(';'));
      fs.writeFileSync(filePath, `\uFEFF${lignes.join('\r\n')}\r\n`, 'utf8');
      return { chemin: filePath };
    }

    // Validation d'un import : sauvegarde complète de la base avant tout remplacement.
    if (action === 'validerCalendrier') {
      let sauvegarde = null;
      if (arg.operation === 'remplacer') {
        const dossierSecu = path.join(app.getPath('userData'), 'avant-calendrier');
        fs.mkdirSync(dossierSecu, { recursive: true });
        sauvegarde = path.join(dossierSecu, `avant-calendrier-${horodatage()}.db`);
        db.sauvegarder(sauvegarde);
      }
      const r = db.appeler('calendrier:import:valider', arg);
      return { ...r, sauvegarde };
    }

    if (action === 'sauvegarder') {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Enregistrer une sauvegarde',
        defaultPath: path.join(app.getPath('documents'), `SuiviAbsences-sauvegarde-${horodatage()}.db`),
        filters: [{ name: 'Sauvegarde Suivi Absences', extensions: ['db'] }],
      });
      if (canceled || !filePath) return { annule: true };
      db.sauvegarder(filePath);
      return { chemin: filePath };
    }

    if (action === 'restaurer') {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: 'Choisir une sauvegarde à restaurer',
        properties: ['openFile'],
        filters: [{ name: 'Sauvegarde Suivi Absences', extensions: ['db'] }],
      });
      if (canceled || !filePaths[0]) return { annule: true };
      const source = filePaths[0];
      verifierSauvegarde(source);

      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Annuler', 'Remplacer les données'],
        defaultId: 0,
        cancelId: 0,
        message: 'Remplacer toutes les données actuelles ?',
        detail:
          'Les jeunes, absences et rattrapages actuels seront remplacés par ceux de la sauvegarde, ' +
          'et le mot de passe redeviendra celui de la sauvegarde. ' +
          'Une copie de sécurité des données actuelles est faite avant.',
      });
      if (response !== 1) return { annule: true };

      const dossierSecu = path.join(app.getPath('userData'), 'avant-restauration');
      fs.mkdirSync(dossierSecu, { recursive: true });
      const copieSecurite = path.join(dossierSecu, `avant-restauration-${horodatage()}.db`);
      db.sauvegarder(copieSecurite);

      db.fermer();
      remplacer(cheminDb, source);
      db = ouvrir(cheminDb);
      session.verrouiller();
      return { restaure: true, copieSecurite };
    }

    throw new Error(`Action inconnue : ${action}`);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    // Les données restent sur le poste, dans le profil Windows de l'utilisatrice.
    fs.rmSync(dossierTemp(), { recursive: true, force: true }); // copies temporaires d'une session précédente
    cheminDb = path.join(app.getPath('userData'), 'suivi-absences.db');
    db = ouvrir(cheminDb);
    session = creerSession(() => db);
    brancherIpc();
    creerFenetre();
  });

  app.on('window-all-closed', () => {
    if (db) db.fermer();
    fs.rmSync(dossierTemp(), { recursive: true, force: true });
    app.quit();
  });
}
