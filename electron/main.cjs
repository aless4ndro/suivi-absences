const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { ouvrir, TAILLE_MAX_PIECE } = require('./db.cjs');
const { creerSession } = require('./auth.cjs');
const { verifierSauvegarde, remplacer } = require('./sauvegarde.cjs');
const { composer, repartir, preparerBrouillon, nomSur } = require('./courriel.cjs');
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
          if (arg.sanction_id) db.appeler('sanctions:piece:ajouter', { sanction_id: arg.sanction_id, nom: path.basename(chemin), contenu });
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
      const { nom_fichier, contenu } = db.appeler(arg.sanction ? 'sanctions:piece:contenu' : arg.rattrapage ? 'rattrapages:piece:contenu' : 'pieces:contenu', arg.id);
      const dossier = dossierTemp();
      fs.mkdirSync(dossier, { recursive: true });
      const sur = nomSur(nom_fichier);
      const fichier = path.join(dossier, `${arg.sanction ? 's' : arg.rattrapage ? 'r' : ''}${arg.id}-${sur}`);
      fs.writeFileSync(fichier, contenu);
      const erreur = await shell.openPath(fichier);
      if (erreur) throw new Error(`Impossible d'ouvrir le fichier : ${erreur}`);
      return true;
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
