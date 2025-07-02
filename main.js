const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs'); // Importamos el módulo fs para manejar archivos
const { spawn } = require('child_process');
const pty = require('node-pty');

// Diccionario de procesos pty por escenario
const ptyProcesses = {};

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png'), // Opcional: icono personalizado
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Comunicación para abrir el diálogo de archivos
ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile']
  });
  if (canceled) {
    return null;
  } else {
    return filePaths[0];
  }
});

// --- [BLOQUE MODIFICADO] ---
ipcMain.on('terminal:open', (event, shell, shellArgs, idx) => {
  console.log(`Main: Solicitud para abrir terminal ${idx} con shell: ${shell}, args: ${shellArgs}`);
  const win = BrowserWindow.getFocusedWindow();
  if (ptyProcesses[idx]) {
    ptyProcesses[idx].kill();
    delete ptyProcesses[idx];
  }
  const userHomeDir = app.getPath('home');
  const subfolderName = 'MiAppTerminal';
  const workDir = path.join(userHomeDir, subfolderName);
  if (!fs.existsSync(workDir)) {
    fs.mkdirSync(workDir, { recursive: true });
  }
  // --- MODIFICACIÓN: Asegurar que /opt/homebrew/bin esté en el PATH ---
  const env = { ...process.env };
  if (!env.PATH.includes('/opt/homebrew/bin')) {
    env.PATH = env.PATH + ':/opt/homebrew/bin';
  }
  const ptyProcess = pty.spawn(shell, shellArgs || [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: workDir,
    env: env
  });
  ptyProcesses[idx] = ptyProcess;
  ptyProcess.on('data', (data) => {
    win.webContents.send('terminal:data', { idx, data });
  });
  ptyProcess.on('exit', () => {
    win.webContents.send('terminal:exit', idx);
    delete ptyProcesses[idx];
  });
});

ipcMain.on('terminal:input', (_event, input, idx) => {
  console.log(`Main: Recibido input para terminal ${idx}: '${input}'`);
  if (ptyProcesses[idx]) {
    ptyProcesses[idx].write(input);
    console.log(`Main: Escrito input en ptyProcesses[${idx}]`);
  } else {
    console.log(`Main: No se encontró ptyProcess para idx ${idx}`);
  }
});

ipcMain.on('terminal:resize', (_event, cols, rows, idx) => {
  if (ptyProcesses[idx]) {
    ptyProcesses[idx].resize(cols, rows);
  }
});