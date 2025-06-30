const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const { Terminal } = require('xterm');
const { FitAddon } = require('xterm-addon-fit');

// Mapa para mantener las instancias de terminal en el proceso de precarga
const xtermInstances = {};
const fitAddonInstances = {};

console.log('Preload: xterm version', Terminal.version);
console.log('Preload: FitAddon loaded', typeof FitAddon);

contextBridge.exposeInMainWorld('electronAPI', {
  abrirArchivo: () => ipcRenderer.invoke('dialog:openFile'),
  leerArchivo: (ruta) => fs.readFileSync(ruta, 'utf-8'),
  
  // Terminal embebida por escenario
  abrirTerminal: (shell, shellArgs, idx) => ipcRenderer.send('terminal:open', shell, shellArgs, idx),
  enviarInputTerminal: (input, idx) => ipcRenderer.send('terminal:input', input, idx),
  redimensionarTerminal: (cols, rows, idx) => ipcRenderer.send('terminal:resize', cols, rows, idx),
  onTerminalData: (callback) => ipcRenderer.on('terminal:data', (_event, payload) => callback(payload)),
  onTerminalExit: (callback) => ipcRenderer.on('terminal:exit', (_event, idx) => callback(idx)),
  removeAllListenersTerminal: () => {
    ipcRenderer.removeAllListeners('terminal:data');
    ipcRenderer.removeAllListeners('terminal:exit');
  },

  // Nuevos métodos para gestionar listeners de terminal
  addTerminalDataListener: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:data', listener);
    return listener; // Devolver el listener para poder eliminarlo
  },
  removeTerminalDataListener: (listener) => {
    ipcRenderer.removeListener('terminal:data', listener);
  },
  addTerminalExitListener: (callback) => {
    const listener = (_event, idx) => callback(idx);
    ipcRenderer.on('terminal:exit', listener);
    return listener; // Devolver el listener para poder eliminarlo
  },
  removeTerminalExitListener: (listener) => {
    ipcRenderer.removeListener('terminal:exit', listener);
  },

  // Nuevas funciones para interactuar con xterm desde el renderer
  createXtermTerminal: (idx) => {
    if (!xtermInstances[idx]) {
      const term = new Terminal({
        fontSize: 14,
        theme: { background: '#222' },
        cursorBlink: true,
        scrollback: 2000,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      xtermInstances[idx] = term;
      fitAddonInstances[idx] = fitAddon;

      // Exponer métodos necesarios de la instancia de Terminal
      return {
        open: (elementId) => {
          // El elemento se pasará por ID y se buscará en el renderer
          // Esto es un placeholder, la apertura real se hará en el renderer
          // pero la instancia de Terminal vive aquí.
        },
        onData: (callback) => {
          term.onData(callback);
        },
        write: (data) => {
          term.write(data);
        },
        focus: () => {
          term.focus();
        },
        clear: () => {
          term.clear();
        },
        fit: () => {
          fitAddonInstances[idx].fit();
        },
        dispose: () => {
          term.dispose();
          delete xtermInstances[idx];
          delete fitAddonInstances[idx];
        }
      };
    }
    return null; // Ya existe una instancia para este idx
  },
  
  // Métodos para interactuar con una terminal existente
  openXterm: (idx, elementId) => {
    if (xtermInstances[idx]) {
      const element = document.getElementById(elementId);
      if (element) {
        xtermInstances[idx].open(element);
      }
    }
  },
  writeXterm: (idx, data) => {
    if (xtermInstances[idx]) {
      xtermInstances[idx].write(data);
    }
  },
  focusXterm: (idx) => {
    if (xtermInstances[idx]) {
      xtermInstances[idx].focus();
    }
  },
  clearXterm: (idx) => {
    if (xtermInstances[idx]) {
      xtermInstances[idx].clear();
    }
  },
  fitXterm: (idx) => {
    if (fitAddonInstances[idx]) {
      fitAddonInstances[idx].fit();
    }
  },
  disposeXterm: (idx) => {
    if (xtermInstances[idx]) {
      xtermInstances[idx].dispose();
      delete xtermInstances[idx];
      delete fitAddonInstances[idx];
    }
  }
});