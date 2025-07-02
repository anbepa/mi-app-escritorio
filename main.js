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

ipcMain.handle('crear-gemini-md', async (_event, nombreEscenario, pasos) => {
  const userHomeDir = app.getPath('home');
  const subfolderName = 'MiAppTerminal';
  const workDir = path.join(userHomeDir, subfolderName);
  if (!fs.existsSync(workDir)) {
    fs.mkdirSync(workDir, { recursive: true });
  }
  const prompt = [
    '¡Hola! 👋 Para ejecutar tu escenario de prueba, sigue los pasos a continuación usando Playwright MCP.',
    '',
    '## ▶️ Paso 1: Login Automático',
    'Utiliza las herramientas de Playwright MCP para realizar el login en la aplicación:',
    '- Usa `browser_navigate` para ir a la URL de login: https://saf-qa.apps.ambientesbc.com/disbursements',
    '2. Ingresar el correo electrónico: aabernal@ambientesbc.com y hacer clic en "Siguiente".',
    '3. Ingresar la contraseña: 2025.Tester.2026 y hacer clic en "Iniciar sesión".',
    '4. Verificar que el sistema muestra la pantalla "Aprobar solicitud de inicio de sesión".',
    '5. Espere hasta que el usuario apruebe la sesión.',
    '6. Recarga la página.',
    '7. Verificar que el inicio de sesión se completa y se muestra en la página un texto que diga "SAF te da la bienvenida".',
    '',
    'IMPORTANTE: No continúes con los siguientes pasos hasta que el texto "SAF te da la bienvenida" sea visible en la página. Si no aparece, sigue recargando la página hasta que lo encuentres.',
    '',
    'Asegúrate de que el login se complete correctamente antes de continuar con los siguientes pasos.',
    '',
    '## ▶️ Paso 2: Ejecución del Escenario de Prueba Automático',
    'El sistema ahora ejecutará el escenario completo.',
    '',
    '1. Configuración de Lanzamiento del Navegador:',
    '',
    '- incognito: true',
    '- ignoreHTTPSErrors: true',
    '',
    '2. Creación del Directorio de Resultados:',
    '',
    `Se ejecutará el comando mkdir -p ${nombreEscenario} para crear la carpeta del escenario.`,
    '',
    '3. Ejecución de los Pasos de la Prueba:',
    '',
    'Usando las herramientas del MCP, realiza las siguientes acciones:',
    '',
    pasos,
    '',
    '4. Gestión de Capturas de Pantalla:',
    '',
    `IMPORTANTE: Si la herramienta MCP guarda la captura de pantalla en una carpeta temporal, muévela automáticamente a la carpeta del escenario (${nombreEscenario}) para que todas las evidencias queden centralizadas en la ruta correcta.`,
    ''
  ].join('\n');
  const filePath = path.join(workDir, 'GEMINI.md');
  fs.writeFileSync(filePath, prompt, 'utf-8');
  return filePath;
});

ipcMain.handle('verificar-gemini-md-existe', async () => {
  const userHomeDir = app.getPath('home');
  const subfolderName = 'MiAppTerminal';
  const workDir = path.join(userHomeDir, subfolderName);
  const filePath = path.join(workDir, 'GEMINI.md');
  return fs.existsSync(filePath);
});