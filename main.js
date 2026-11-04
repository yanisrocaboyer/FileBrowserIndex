const { app, BrowserWindow } = require('electron');
const { start } = require('./server');

const PORT = process.env.PORT || 3000; // port fixe : la session (localStorage) reste conservée

app.whenReady().then(async () => {
  await start(PORT);
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(`http://localhost:${PORT}`);
}).catch((e) => {
  console.error('Démarrage impossible :', e.message);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
