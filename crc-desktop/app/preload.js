'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crcUpdate', {
    onStatus:   (cb) => ipcRenderer.on('update-status', (_event, status) => cb(status)),
    restartNow: () => ipcRenderer.send('update-restart-now'),
});
