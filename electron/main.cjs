const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { ouvrir } = require('./db.cjs');
const { creerSession } = require('./auth.cjs');
const { verifierSauvegarde, remplacer } = require('./sauvegarde.cjs');

let db;
let cheminDb;
let session;

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

  ipcMain.handle('fichiers', async (event, action) => {
    exigerOuvert();
    const win = BrowserWindow.fromWebContents(event.sender);

    if (action === 'emplacement') return { dossier: app.getPath('userData') };

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
    cheminDb = path.join(app.getPath('userData'), 'suivi-absences.db');
    db = ouvrir(cheminDb);
    session = creerSession(() => db);
    brancherIpc();
    creerFenetre();
  });

  app.on('window-all-closed', () => {
    if (db) db.fermer();
    app.quit();
  });
}
