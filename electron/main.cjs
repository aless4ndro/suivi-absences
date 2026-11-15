const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { ouvrir } = require('./db.cjs');

let db;

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
    db = ouvrir(path.join(app.getPath('userData'), 'suivi-absences.db'));
    ipcMain.handle('db', (_event, action, arg) => db.appeler(action, arg));
    creerFenetre();
  });

  app.on('window-all-closed', () => {
    if (db) db.fermer();
    app.quit();
  });
}
