// Electron main process — wraps the Vite build as a native desktop app.
// Chromium-based (per the user's launcher preference), so the packaged game
// uses the exact same engine we develop against — no webview GPU surprises.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');

const DEV_URL = process.env.WYRDWOOD_DEV_URL; // set to the Vite dev server when developing

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0e12',
    title: 'Wyrdwood',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // WebGL/hardware acceleration on by default.
    },
  });

  // Hide the default menu bar (fullscreen game feel); keep quit shortcuts.
  Menu.setApplicationMenu(null);

  win.once('ready-to-show', () => win.show());

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
