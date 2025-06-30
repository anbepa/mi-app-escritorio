// renderer/renderer.js

let escenarios = [];
const xterms = {}; // Almacenará los objetos proxy de la terminal
const terminalListeners = {}; // Almacenará los listeners para poder eliminarlos

// --- Lógica de la Terminal y el Prompt ---

function actualizarYMostrarPrompt(idx) {
  const promptPanel = document.getElementById(`prompt-panel-${idx}`);
  const promptArea = document.getElementById(`prompt-area-${idx}`);
  if (!promptPanel || !promptArea) return;

  const esc = escenarios[idx] || {};
  const nombreEscenario = esc['Escenario de Prueba'] || '';
  const pasos = esc['Paso a Paso'] || '';
  
  const prompt = `Ejecutar escenario: "${nombreEscenario}" con Playwright MCP. Pasos a ejecutar: "${pasos}"`;

  promptArea.value = prompt;
  promptPanel.style.display = 'block';
}

async function abrirTerminalGemini(idx) {
  const container = document.getElementById(`xterm-container-${idx}`);
  const inner = document.getElementById(`xterm-inner-${idx}`);
  if (!container || !inner) return;

  container.style.display = 'flex';
  actualizarYMostrarPrompt(idx);

  if (!xterms[idx]) {
    // Crear la terminal en el proceso de precarga y obtener sus métodos proxy
    const xtermProxyMethods = await window.electronAPI.createXtermTerminal(idx);
    if (!xtermProxyMethods) return; // Si ya existe, no hacer nada

    xterms[idx] = xtermProxyMethods; // Almacenar los métodos proxy

    // Abrir la terminal en el elemento del DOM (llamando al método proxy)
    // Pasamos el ID del elemento para que preload.js lo busque en su contexto
    window.electronAPI.openXterm(idx, inner.id);

    // Configurar el listener para la entrada de datos desde la terminal
    xterms[idx].onData(data => {
      console.log('Input capturado en xterm:', data);
      // Convertir Enter a nueva línea para ejecución de comando
      const processedData = (data === '\r') ? '\n' : data;
      window.electronAPI.enviarInputTerminal(processedData, idx);
    });

    // Configurar el listener para los datos que vienen del proceso principal
    const dataListener = window.electronAPI.addTerminalDataListener((payload) => {
      if (payload.idx === idx) xterms[idx].write(payload.data);
    });
    const exitListener = window.electronAPI.addTerminalExitListener((exitIdx) => {
      if (exitIdx === idx) {
        // Opcional: mostrar mensaje de proceso terminado
      }
    });
    terminalListeners[idx] = { data: dataListener, exit: exitListener };
  }

  // Limpiar y preparar la terminal para una nueva sesión
  xterms[idx].clear();
  window.electronAPI.abrirTerminal('/bin/zsh', [], idx);
  // Esperar un poco y luego escribir 'gemini\n' para lanzar gemini automáticamente
  setTimeout(() => {
    if (xterms[idx]) {
      window.electronAPI.enviarInputTerminal('gemini\n', idx);
      xterms[idx].fit();
      xterms[idx].focus();
    }
  }, 300);
}

function cerrarTerminalGemini(idx) {
  document.getElementById(`xterm-container-${idx}`).style.display = 'none';
  document.getElementById(`prompt-panel-${idx}`).style.display = 'none';
  if (xterms[idx]) {
    // Eliminar listeners para evitar duplicados
    if (terminalListeners[idx] && terminalListeners[idx].data) {
      window.electronAPI.removeTerminalDataListener(terminalListeners[idx].data);
    }
    if (terminalListeners[idx] && terminalListeners[idx].exit) {
      window.electronAPI.removeTerminalExitListener(terminalListeners[idx].exit);
    }
    window.electronAPI.disposeXterm(idx); // Disponer la terminal en el backend
    delete xterms[idx];
    delete terminalListeners[idx];
  }
}

function enviarPromptATerminal(idx) {
  const promptArea = document.getElementById(`prompt-area-${idx}`);
  if (promptArea && xterms[idx]) {
    // Reemplazar saltos de línea por espacios
    const texto = promptArea.value.replace(/\n/g, ' ');
    if (texto.trim()) {
      // Enviar el prompt completo al proceso Gemini CLI
      window.electronAPI.enviarInputTerminal(texto + '\n', idx);
      // Limpiar el área de texto después de enviar el prompt
      promptArea.value = '';
    }
  }
}

// --- Lógica de Evidencias ---

function renderEvidencias(idx) {
  const grid = document.getElementById(`evid-grid-${idx}`);
  if (!grid) return;
  grid.innerHTML = '';
  (escenarios[idx].evidencias || []).forEach((ev, i) => {
    const div = document.createElement('div');
    div.className = 'evidencia-block';
    const nombreArchivo = ev.nombre || `evidencia_${i + 1}`;
    div.innerHTML = `
      <div class="evidencia-label">
        <input type='text' value='${nombreArchivo}' class="evidencia-nombre" data-evidencia-idx="${i}" title='Nombre archivo' />
        <button class='btn btn-evidencia-eliminar' data-accion="eliminar-evidencia" data-evidencia-idx="${i}" title='Eliminar'>&times;</button>
      </div>
      <img src="${ev.data}" alt="Evidencia" />
    `;
    grid.appendChild(div);
  });
}

function subirEvidencias(idx, input) {
  for (const file of input.files) {
    const reader = new FileReader();
    reader.onload = (e) => {
      escenarios[idx].evidencias.push({ tipo: 'img', nombre: file.name, data: e.target.result });
      renderEvidencias(idx);
    };
    reader.readAsDataURL(file);
  }
  input.value = ''; // Reset input
}

function pegarEvidencia(idx) {
  navigator.clipboard.read().then(items => {
    for (const item of items) {
      if (item.types.includes('image/png')) {
        item.getType('image/png').then(blob => {
          const reader = new FileReader();
          reader.onload = (e) => {
            escenarios[idx].evidencias.push({ tipo: 'img', nombre: 'Pegado.png', data: e.target.result });
            renderEvidencias(idx);
          };
          reader.readAsDataURL(blob);
        });
      }
    }
  });
}

function limpiarEvidencias(idx) {
  escenarios[idx].evidencias = [];
  renderEvidencias(idx);
}

// --- Lógica de la Interfaz de Usuario ---

function crearEscenarioHTML(esc, idx) {
  const section = document.createElement('section');
  section.className = 'escenario';
  section.id = `escenario-${idx}`;
  section.innerHTML = `
    <table class="escenario-table">
      <thead><tr><th>ID Caso</th><th>Escenario de Prueba</th><th>Precondiciones</th><th>Paso a Paso</th><th>Resultado Esperado</th><th>Acción</th></tr></thead>
      <tbody>
        <tr>
          <td contenteditable="true" data-campo="ID Caso">${esc['ID Caso'] || ''}</td>
          <td contenteditable="true" data-campo="Escenario de Prueba">${esc['Escenario de Prueba'] || ''}</td>
          <td contenteditable="true" data-campo="Precondiciones">${esc['Precondiciones'] || ''}</td>
          <td contenteditable="true" data-campo="Paso a Paso">${esc['Paso a Paso'] || ''}</td>
          <td contenteditable="true" data-campo="Resultado Esperado">${esc['Resultado Esperado'] || ''}</td>
          <td><button class="btn btn-danger" data-accion="eliminar">Eliminar</button></td>
        </tr>
      </tbody>
    </table>
    <div class="evidencias-bd-flex">
      <div class="evidencias">
        <div class="evidencias-titulo">Evidencias</div>
        <div class="evidencias-grid" id="evid-grid-${idx}"></div>
        <div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:0.7em;">
          <label class="btn btn-secondary">
            Subir Evidencias
            <input type="file" accept="image/*" multiple data-accion="subir-evidencia" style="display:none;">
          </label>
          <button class="btn btn-secondary" data-accion="pegar-evidencia">Pegar Evidencia</button>
          <button class="btn btn-secondary" data-accion="limpiar-evidencias">Limpiar Evidencias</button>
          <button class="btn btn-secondary" data-accion="ejecutar-gemini">Ejecutar con Gemini</button>
        </div>
        <div id="prompt-panel-${idx}" style="display:none; margin-top:12px;">
          <textarea id="prompt-area-${idx}" style="width:100%; height:100px; resize:vertical;"></textarea>
          <button class="btn btn-primary" data-accion="enviar-prompt" style="margin-top:8px;">Enviar Prompt</button>
        </div>
        <div class="xterm-escenario-container" id="xterm-container-${idx}" style="display:none;">
          <button class="btn btn-secondary" data-accion="cerrar-terminal">Cerrar terminal</button>
          <div id="xterm-inner-${idx}" style="width:100%;height:260px;overflow:auto;"></div>
        </div>
      </div>
    </div>
  `;
  return section;
}

function renderEscenarios() {
  const escenariosDiv = document.getElementById('escenarios-container');
  escenariosDiv.innerHTML = '';
  escenarios.forEach((esc, idx) => {
    const escenarioEl = crearEscenarioHTML(esc, idx);
    escenariosDiv.appendChild(escenarioEl);
    renderEvidencias(idx);
  });
}

function agregarEscenario() {
  escenarios.push({ 'ID Caso': '', 'Escenario de Prueba': '', 'Precondiciones': '', 'Paso a Paso': '', 'Resultado Esperado': '', evidencias: [] });
  renderEscenarios();
}

// --- Inicialización y Delegación de Eventos ---

document.addEventListener('DOMContentLoaded', () => {
  const container = document.querySelector('.container');
  const escenariosContainer = document.createElement('div');
  escenariosContainer.id = 'escenarios-container';
  container.insertBefore(escenariosContainer, container.querySelector('.add-scenario-bar'));

  escenarios = [{
    'ID Caso': 'CP1', 'Escenario de Prueba': 'Ejemplo de escenario',
    'Precondiciones': 'Debe existir conexión a la BD',
    'Paso a Paso': '1. Ejecutar consulta SQL\n2. Verificar resultado',
    'Resultado Esperado': 'El resultado debe ser correcto', evidencias: []
  }];
  renderEscenarios();

  // Delegación de eventos para acciones principales
  container.addEventListener('click', (e) => {
    const escenarioEl = e.target.closest('.escenario');
    if (!escenarioEl) return;
    const idx = parseInt(escenarioEl.id.split('-')[1], 10);
    const accion = e.target.dataset.accion;

    switch (accion) {
      case 'ejecutar-gemini': abrirTerminalGemini(idx); break;
      case 'cerrar-terminal': cerrarTerminalGemini(idx); break;
      case 'enviar-prompt': enviarPromptATerminal(idx); break;
      case 'eliminar':
        escenarios.splice(idx, 1);
        renderEscenarios();
        break;
      case 'pegar-evidencia': pegarEvidencia(idx); break;
      case 'limpiar-evidencias': limpiarEvidencias(idx); break;
      case 'eliminar-evidencia':
        const evidenciaIdx = parseInt(e.target.dataset.evidenciaIdx, 10);
        escenarios[idx].evidencias.splice(evidenciaIdx, 1);
        renderEvidencias(idx);
        break;
    }
  });

  container.addEventListener('change', (e) => {
    if (e.target.dataset.accion === 'subir-evidencia') {
      const escenarioEl = e.target.closest('.escenario');
      const idx = parseInt(escenarioEl.id.split('-')[1], 10);
      subirEvidencias(idx, e.target);
    }
  });

  container.addEventListener('input', (e) => {
    const target = e.target;
    const escenarioEl = target.closest('.escenario');
    if (!escenarioEl) return;
    const idx = parseInt(escenarioEl.id.split('-')[1], 10);

    if (target.isContentEditable) {
      const campo = target.dataset.campo;
      if (campo) escenarios[idx][campo] = target.innerText;
    } else if (target.classList.contains('evidencia-nombre')) {
      const evidenciaIdx = parseInt(target.dataset.evidenciaIdx, 10);
      escenarios[idx].evidencias[evidenciaIdx].nombre = target.value;
    }
  });

  // Botones globales
  document.getElementById('btn-cargar-csv').addEventListener('click', async () => {
    const ruta = await window.electronAPI.abrirArchivo();
    if (!ruta) return;
    const contenido = window.electronAPI.leerArchivo(ruta);
    Papa.parse(contenido, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        escenarios = results.data.map((row, i) => ({ ...row, idx: i, evidencias: [] }));
        renderEscenarios();
        if (escenarios.length > 0) abrirTerminalGemini(0);
      }
    });
  });
  
  document.getElementById('btn-agregar-escenario').addEventListener('click', agregarEscenario);
});