const { contextBridge, ipcRenderer } = require('electron');

// Seul point de contact entre l'interface et le reste de l'application.
contextBridge.exposeInMainWorld('api', {
  appeler: (action, arg) => ipcRenderer.invoke('db', action, arg),
  auth: (action, arg) => ipcRenderer.invoke('auth', action, arg),
  fichiers: (action) => ipcRenderer.invoke('fichiers', action),
});
