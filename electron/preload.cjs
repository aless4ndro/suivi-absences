const { contextBridge, ipcRenderer } = require('electron');

// Seul point de contact entre l'interface et le reste de l'application.
contextBridge.exposeInMainWorld('api', {
  appeler: (action, arg) => ipcRenderer.invoke('db', action, arg),
  auth: (action, arg) => ipcRenderer.invoke('auth', action, arg),
  fichiers: (action, arg) => ipcRenderer.invoke('fichiers', action, arg),
  courriel: (action, arg) => ipcRenderer.invoke('courriel', action, arg),
  documents: (action, arg) => ipcRenderer.invoke('documents', action, arg),
  maj: (action) => ipcRenderer.invoke('maj', action),
});
