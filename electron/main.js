import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Signal index.js that Electron manages the server lifecycle
process.env.XIAN_ELECTRON = 'true';

const PORT = process.env.PORT || 3000;

let mainWindow = null;
let expressServer = null;

function createWindow() {
  const iconPath = path.join(__dirname, '../public/favicon.ico');
  const windowOptions = {
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  };

  // Only set the icon when the file actually exists
  if (fs.existsSync(iconPath)) {
    windowOptions.icon = iconPath;
  }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.loadURL(`http://localhost:${PORT}`).catch((err) => {
    console.error('❌ Failed to load the application:', err.message);
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click() { app.quit(); }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Start the Express server first, wait until it is listening,
// then open the window — the app never loads before the server is ready.
async function bootstrap() {
  try {
    const expressApp = await import('../index.js');
    expressServer = await expressApp.startServer(PORT);
    console.log(`🚀 XianFire Express server running inside Electron at http://localhost:${PORT}`);
  } catch (err) {
    console.error('❌ Failed to start Express server:', err);
    app.quit();
    return;
  }

  createWindow();
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (expressServer) expressServer.close();
});
