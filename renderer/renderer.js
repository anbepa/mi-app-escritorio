// renderer/renderer.js

let escenarios = [];
const xterms = {}; // Almacenará los objetos proxy de la terminal
const terminalListeners = {}; // Almacenará los listeners para poder eliminarlos

// --- Lógica de la Terminal y el Prompt ---

// [CAMBIO] Función actualizada para generar un prompt más directo.
function actualizarYMostrarPrompt(idx) {
  const promptPanel = document.getElementById(`prompt-panel-${idx}`);
  const promptArea = document.getElementById(`prompt-area-${idx}`);
  if (!promptPanel || !promptArea) return;

  const esc = escenarios[idx] || {};
  const pasos = esc['Paso a Paso'] || '';
  const nombreEscenario = esc['ID Caso'] || 'CP1';
  const pasosArr = pasos.split('\n').filter(Boolean);

  let prompt = '';
  prompt += `Responde en español.\n`;
  prompt += `Usando Playwright MCP, ejecuta los siguientes pasos:\n`;
  prompt += `Nota importante: Crea un directorio para las imágenes llamado ${nombreEscenario}. Usa el comando mkdir -p reporte_wwf para asegurar que no falle si la carpeta ya existe. El navegador se debe iniciar en modo incógnito (incognito: true) y debe ignorar todos los certificados (ignoreHTTPSErrors: true).\n`;
  prompt += `Si una captura de pantalla se guarda en una ruta temporal, muévela automáticamente a la ruta absoluta especificada por el usuario en el prompt.\n`;
  prompt += '\n';

  pasosArr.forEach((paso, i) => {
    const nombrePaso = paso.replace(/^[0-9]+\.?\s*/, '').trim();
    if (i === pasosArr.length - 2 && pasosArr.length >= 2) {
      prompt += `${i + 1}. ${nombrePaso} (Toma una captura de pantalla y guárdala en la ruta absoluta de la carpeta ${nombreEscenario} con el nombre de este paso)\n`;
    } else {
      prompt += `${i + 1}. ${nombrePaso}\n`;
    }
  });
  prompt += `${pasosArr.length + 1}. Cerrar navegador`;

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
      // Pasa los datos directamente al proceso del backend (pty).
      window.electronAPI.enviarInputTerminal(data, idx);
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
  const promptPanel = document.getElementById(`prompt-panel-${idx}`);
  if (promptArea && xterms[idx]) {
    // Reemplazar saltos de línea por espacios
    const texto = promptArea.value.replace(/\n/g, ' ');
    if (texto.trim()) {
      // Enviar el prompt completo al proceso Gemini CLI with retorno de carro ('\r')
      window.electronAPI.enviarInputTerminal(texto + '\r', idx);
      // Limpiar el área de texto después de enviar el prompt
      promptArea.value = '';
      // Ocultar el panel del prompt
      if (promptPanel) promptPanel.style.display = 'none';
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
          <div id="xterm-inner-${idx}" class="xterm-inner-wrapper"></div>
        </div>
      </div>
    </div>
  `;
  return section;
}

function renderEscenarios() {
  const escenariosDiv = document.getElementById('escenarios-container');
  escenariosDiv.innerHTML = '';

  // Crear barra de pestañas
  const tabsBar = document.createElement('div');
  tabsBar.className = 'escenarios-tabs-bar';
  escenarios.forEach((esc, idx) => {
    const tabBtn = document.createElement('button');
    tabBtn.className = 'escenario-tab-btn';
    tabBtn.textContent = esc['ID Caso'] || `Escenario ${idx + 1}`;
    tabBtn.dataset.idx = idx;
    if (idx === window.escenarioActivo) tabBtn.classList.add('active');
    tabBtn.addEventListener('click', () => {
      window.escenarioActivo = idx;
      renderEscenarios();
    });
    tabsBar.appendChild(tabBtn);
  });
  escenariosDiv.appendChild(tabsBar);

  // --- MODIFICACIÓN PARA IMPRESIÓN ---
  // Si estamos imprimiendo, renderizar todos los escenarios
  if (window.matchMedia && window.matchMedia('print').matches) {
    escenarios.forEach((esc, idx) => {
      const escenarioEl = crearEscenarioHTML(esc, idx);
      escenariosDiv.appendChild(escenarioEl);
      renderEvidencias(idx);
    });
    return;
  }

  // Renderizar solo el escenario activo normalmente
  const idx = window.escenarioActivo || 0;
  if (escenarios[idx]) {
    const escenarioEl = crearEscenarioHTML(escenarios[idx], idx);
    escenariosDiv.appendChild(escenarioEl);
    renderEvidencias(idx);
  }
}

// Inicializar variable global para el escenario activo
window.escenarioActivo = 0;

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
  window.escenarioActivo = 0;
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
    const contenido = await window.electronAPI.leerArchivo(ruta);
    Papa.parse(contenido, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        escenarios = results.data.map((row, i) => ({ ...row, idx: i, evidencias: [] }));
        window.escenarioActivo = 0; // Siempre mostrar el primero tras cargar CSV
        renderEscenarios();
      }
    });
  });
  
  document.getElementById('btn-agregar-escenario').addEventListener('click', agregarEscenario);

  // Interceptar pegado en celdas contenteditable para solo texto plano
  document.addEventListener('paste', function(e) {
    const target = e.target;
    if (target && target.isContentEditable) {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      // Insertar solo texto plano en la posición del cursor
      document.execCommand('insertText', false, text);
    }
  });

  document.getElementById('btn-descargar-pdf').addEventListener('click', () => generarReportePDF());
});

function agregarEscenario() {
  escenarios.push({ 'ID Caso': '', 'Escenario de Prueba': '', 'Precondiciones': '', 'Paso a Paso': '', 'Resultado Esperado': '', evidencias: [] });
  window.escenarioActivo = escenarios.length - 1; // Selecciona el nuevo escenario
  renderEscenarios();
}

// --- Generación de PDF profesional ---
async function generarReportePDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 40;

  // === DATOS DE PORTADA (puedes personalizar estos valores) ===
  const logoPath = 'pngegg.png';
  const responsable = 'Juan Pérez';
  const area = 'QA / Testing';
  const version = '1.0';
  const resumen = 'Este reporte contiene el detalle de los escenarios de prueba ejecutados, sus resultados y evidencias asociadas.';

  // === PORTADA CENTRADA CON LOGO ===
  let portadaY = 80;
  // Logo centrado (pngegg.png)
  try {
    const logoBase64 = window.electronAPI.leerImagenComoBase64(logoPath);
    const logoWidth = 180;
    const logoHeight = 100;
    const logoX = (pageWidth - logoWidth) / 2;
    doc.addImage(logoBase64, 'PNG', logoX, portadaY, logoWidth, logoHeight);
    portadaY += logoHeight + 30;
  } catch (e) {
    portadaY += 30;
  }
  doc.setFontSize(28);
  doc.setTextColor('#000000');
  doc.text('Reporte de Matriz de Casos de Prueba', pageWidth / 2, portadaY, { align: 'center' });
  portadaY += 40;
  doc.setFontSize(16);
  doc.text('Fecha de generación: ' + new Date().toLocaleString(), pageWidth / 2, portadaY, { align: 'center' });
  portadaY += 30;
  doc.setFontSize(13);
  doc.text(`Área: ${area}`, pageWidth / 2, portadaY, { align: 'center' });
  portadaY += 20;
  doc.text(`Versión: ${version}`, pageWidth / 2, portadaY, { align: 'center' });
  portadaY += 30;
  doc.setFontSize(12);
  doc.text(resumen, pageWidth / 2, portadaY, { align: 'center', maxWidth: pageWidth - 120 });
  doc.addPage();

  // === ÍNDICE AUTOMÁTICO ===
  doc.setFontSize(20);
  doc.text('Índice', 60, 60);
  doc.setFontSize(13);
  let indiceY = 90;
  const indiceEscenarios = [];
  escenarios.forEach((esc, idx) => {
    const nombre = esc['ID Caso'] || `Escenario ${idx + 1}`;
    doc.text(`${idx + 1}. ${nombre}`, 80, indiceY);
    indiceEscenarios.push({ idx, nombre, page: doc.internal.getNumberOfPages() + 1 });
    indiceY += 22;
    if (indiceY > pageHeight - 60) {
      doc.addPage();
      indiceY = 60;
    }
  });
  doc.addPage();

  // === ESCENARIOS ===
  const escenariosPaginas = [];
  escenarios.forEach((esc, idx) => {
    let startY = 60;
    escenariosPaginas.push(doc.internal.getNumberOfPages());
    // Tabla con formato solicitado (colores y estilos)
    const tablaAncho = 80 + 150 + 120 + 220 + 120; // suma de cellWidth
    const margenTabla = (pageWidth - tablaAncho) / 2;
    doc.autoTable({
      startY: startY,
      head: [[
        'ID Caso', 'Escenario de Prueba', 'Precondiciones', 'Paso a Paso', 'Resultado Esperado'
      ]],
      body: [[
        esc['ID Caso'] || '',
        esc['Escenario de Prueba'] || '',
        esc['Precondiciones'] || '',
        esc['Paso a Paso'] || '',
        esc['Resultado Esperado'] || ''
      ]],
      styles: {
        fontSize: 13,
        cellPadding: 10,
        halign: 'left',
        font: 'helvetica',
        textColor: '#222',
        fillColor: '#f8fafc',
        lineColor: '#cbd5e1',
        lineWidth: 1
      },
      headStyles: {
        fillColor: '#e3eafc',
        textColor: '#1e293b',
        fontStyle: 'bold',
        font: 'helvetica',
        fontSize: 15,
        halign: 'left',
        lineColor: '#cbd5e1',
        lineWidth: 1.5
      },
      alternateRowStyles: { fillColor: '#f8fafc' },
      margin: { left: margenTabla, right: margenTabla },
      theme: 'grid',
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: 150 },
        2: { cellWidth: 120 },
        3: { cellWidth: 220 },
        4: { cellWidth: 120 },
      },
      tableWidth: 'auto',
    });

    // Evidencias (en bloques de dos por fila, estilo grid limpio)
    if (esc.evidencias && esc.evidencias.length > 0) {
      let yEvid = doc.lastAutoTable.finalY + 36;
      // Título 'Evidencias:' alineado a la izquierda, azul y negrita
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor('#2563eb');
      doc.text('Evidencias:', 60, yEvid, { align: 'left' });
      // Línea divisoria gris claro
      doc.setDrawColor('#cbd5e1');
      doc.setLineWidth(1);
      doc.line(60, yEvid + 6, pageWidth - 60, yEvid + 6);
      yEvid += 24;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(13);
      doc.setTextColor('#1e293b');
      const maxWidth = 300;
      const maxHeight = 180;
      const cellWidth = maxWidth + 24;
      const gapX = 24;
      const gapY = 56;
      const xImg1 = 60;
      const xImg2 = xImg1 + cellWidth + gapX;
      for (let i = 0; i < esc.evidencias.length; i += 2) {
        // Primera imagen de la fila
        const ev1 = esc.evidencias[i];
        let width1 = maxWidth, height1 = maxHeight;
        let label1 = ev1 && (ev1.nombre || `Evidencia ${i + 1}`) || '';
        let labelLines1 = [];
        let labelHeight1 = 0;
        if (ev1 && ev1.data && ev1.data.startsWith('data:image')) {
          const imgProps1 = doc.getImageProperties(ev1.data);
          width1 = imgProps1.width;
          height1 = imgProps1.height;
          if (width1 > maxWidth) {
            height1 = height1 * (maxWidth / width1);
            width1 = maxWidth;
          }
          if (height1 > maxHeight) {
            width1 = width1 * (maxHeight / height1);
            height1 = maxHeight;
          }
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          labelLines1 = doc.splitTextToSize(label1, width1);
          labelHeight1 = labelLines1.length * 15;
        }
        // Segunda imagen de la fila (si existe)
        const ev2 = esc.evidencias[i + 1];
        let width2 = maxWidth, height2 = maxHeight;
        let label2 = ev2 && (ev2.nombre || `Evidencia ${i + 2}`) || '';
        let labelLines2 = [];
        let labelHeight2 = 0;
        if (ev2 && ev2.data && ev2.data.startsWith('data:image')) {
          const imgProps2 = doc.getImageProperties(ev2.data);
          width2 = imgProps2.width;
          height2 = imgProps2.height;
          if (width2 > maxWidth) {
            height2 = height2 * (maxWidth / width2);
            width2 = maxWidth;
          }
          if (height2 > maxHeight) {
            width2 = width2 * (maxHeight / height2);
            height2 = maxHeight;
          }
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          labelLines2 = doc.splitTextToSize(label2, width2);
          labelHeight2 = labelLines2.length * 15;
        }
        // Altura máxima de los labels de la fila
        let labelMaxHeight = Math.max(labelHeight1, labelHeight2);
        // Validar espacio en la hoja
        let filaAlto = labelMaxHeight + Math.max(height1, height2) + 40; // más padding
        if (yEvid + filaAlto > pageHeight - 60) {
          doc.addPage();
          yEvid = 60;
        }
        // Dibuja contenedor 1
        if (ev1 && ev1.data && ev1.data.startsWith('data:image')) {
          const xLabel1 = xImg1 + (cellWidth - width1) / 2;
          // Fondo gris claro y borde gris claro
          doc.setFillColor('#f4f4f4');
          doc.setDrawColor('#f4f4f4');
          doc.setLineWidth(1.2);
          doc.roundedRect(xImg1, yEvid, cellWidth, labelMaxHeight + height1 + 24, 16, 16, 'FD');
          // Label dentro del contenedor
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.setTextColor('#1e293b');
          doc.text(labelLines1, xImg1 + 12, yEvid + 20, { align: 'left', maxWidth: cellWidth - 24 });
          doc.setFont('helvetica', 'normal');
          // Imagen centrada en el contenedor
          doc.addImage(ev1.data, 'PNG', xLabel1, yEvid + labelMaxHeight + 16, width1, height1);
        }
        // Dibuja contenedor 2
        if (ev2 && ev2.data && ev2.data.startsWith('data:image')) {
          const xLabel2 = xImg2 + (cellWidth - width2) / 2;
          doc.setFillColor('#f4f4f4');
          doc.setDrawColor('#f4f4f4');
          doc.setLineWidth(1.2);
          doc.roundedRect(xImg2, yEvid, cellWidth, labelMaxHeight + height2 + 24, 16, 16, 'FD');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.setTextColor('#1e293b');
          doc.text(labelLines2, xImg2 + 12, yEvid + 20, { align: 'left', maxWidth: cellWidth - 24 });
          doc.setFont('helvetica', 'normal');
          doc.addImage(ev2.data, 'PNG', xLabel2, yEvid + labelMaxHeight + 16, width2, height2);
        }
        // Línea divisora vertical entre celdas
        if (ev1 && ev2 && ev1.data && ev2.data && ev1.data.startsWith('data:image') && ev2.data.startsWith('data:image')) {
          doc.setDrawColor('#4a4a4a');
          doc.setLineWidth(0.7);
          doc.line(xImg2 - gapX / 2, yEvid + 8, xImg2 - gapX / 2, yEvid + labelMaxHeight + Math.max(height1, height2) + 16);
        }
        // Línea divisora horizontal entre filas (opcional, solo si hay más filas)
        if (i + 2 < esc.evidencias.length) {
          doc.setDrawColor('#4a4a4a');
          doc.setLineWidth(0.7);
          doc.line(xImg1, yEvid + labelMaxHeight + Math.max(height1, height2) + 32, xImg2 + cellWidth, yEvid + labelMaxHeight + Math.max(height1, height2) + 32);
        }
        yEvid += labelMaxHeight + Math.max(height1, height2) + gapY + 24;
      }
    }
    // Nueva página para el siguiente escenario, excepto el último
    if (idx < escenarios.length - 1) doc.addPage();
  });

  // === ESPACIO PARA FIRMAS ===
  doc.addPage();
  doc.setFontSize(16);
  doc.text('Firmas y Validaciones', 60, 80);
  doc.setFontSize(12);
  doc.text('Responsable QA:', 80, 140);
  doc.line(200, 142, 500, 142);
  doc.text('Revisor:', 80, 200);
  doc.line(150, 202, 500, 202);
  doc.text('Aprobador:', 80, 260);
  doc.line(170, 262, 500, 262);

  // === ENCABEZADOS Y PIES DE PÁGINA PERSONALIZADOS ===
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    // Encabezado
    doc.setFontSize(10);
    doc.setTextColor('#4a4a4a');
    // Pie de página
    doc.setTextColor('#9b9b9b'); // gris medio
    doc.text(`Página ${i} de ${pageCount}`, pageWidth - 80, pageHeight - 20);
  }

  // === ÍNDICE CON NÚMEROS DE PÁGINA ===
  // (Reescribir la página del índice con los números de página correctos)
  doc.setPage(2); // La página 2 es el índice
  doc.setFontSize(20);
  doc.text('Índice', 60, 60);
  doc.setFontSize(13);
  indiceY = 90;
  indiceEscenarios.forEach((item, i) => {
    doc.text(`${i + 1}. ${item.nombre} ............................................. ${escenariosPaginas[i] + 1}`, 80, indiceY);
    indiceY += 22;
    if (indiceY > pageHeight - 60) {
      doc.addPage();
      indiceY = 60;
    }
  });

  doc.save('reporte_casos_prueba.pdf');
}