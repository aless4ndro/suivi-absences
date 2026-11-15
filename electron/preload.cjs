const { contextBridge, ipcRenderer } = require('electron');

// Seul point de contact entre l'interface et la base de données.
contextBridge.exposeInMainWorld('api', {
  appeler: (action, arg) => ipcRenderer.invoke('db', action, arg),
});
