// --------------------
// CONFIGURATION
// --------------------
const SHEET_DATA_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQMQfiXLy46WD1l7r2LA0OA5Kf6wnfwYdTX5TpUaj2nP4NxG__dSkiiTWj4ZzjEsCGodJW02BLXUCqW/pub?gid=157996468&single=true&output=csv';
const SHEETBEST_CONNECTION_URL = 'https://sheetdb.io/api/v1/3rydewkqa9q5a'; // Keep your actual Sheet DB API URL

let currentRow = null;
let allTasks = []; // Correctly initialized
let taskMap = {};

// --------------------
// UTILITY FUNCTIONS
// --------------------
function normalizeDate(d) {
  if (!d) return '';
  try {
    return d.trim()
      .replace(/["']/g, '')
      .replace(/\r/g, '')
      .replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (_, m, d, y) =>
        `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      );
  } catch (error) {
    console.error("Error normalizing date: / Error al normalizar fecha:", d, error);
    return ''; // Return an empty string or a specific error indicator
  }
}

// --------------------
// RENDER: SUMMARY VIEW
// --------------------
function renderTasks(tasksToRender) {
  const container = document.getElementById('task-list');
  container.innerHTML = '';

  if (!tasksToRender || tasksToRender.length === 0) {
    container.innerHTML = '<p>No tasks to display for this date. / No hay tareas para esta fecha.</p>';
    return;
  }

  tasksToRender.forEach(task => {
    const div = document.createElement('div');
    div.className = 'task-card';
    // Changed openForm to use task['UID'] for unique identification
    div.innerHTML = `
      <strong>${task['Crop'] || 'N/A'}</strong><br>
      <strong>Location / Ubicación:</strong> ${task['Location'] || '-'}<br>
      <strong>Quantity / Cantidad:</strong> ${task['Units to Harvest'] || 'N/A'} ${task['Harvest Units'] || ''}<br>
      <strong>Assigned To / Asignado a:</strong> ${task['Assignee(s)'] || 'Unassigned / Sin asignar'}<br>
      <button onclick="openForm('${task['UID'] || ''}')">Open / Abrir</button>
    `;
    container.appendChild(div);
  });
}

// --------------------
// RENDER: DETAIL VIEW
// --------------------
// Modified openForm to accept UID instead of rowId
function openForm(taskUID) {
  const task = allTasks.find(t => t['UID'] === taskUID); // Find task by UID
  if (!task) {
      console.error("Task not found for UID: / Tarea no encontrada para UID:", taskUID);
      return;
  }

  currentRow = task; // Set currentRow to the found task object
  document.getElementById('detail-title').innerText = task['Crop'] || 'N/A';
  document.getElementById('detail-location').innerText = task['Location'] || '-';
  document.getElementById('detail-quantity').innerText = `${task['Units to Harvest'] || 'N/A'} ${task['Harvest Units'] || ''}`;

  const breakdown = document.getElementById('sales-breakdown');
  breakdown.innerHTML = `
    <strong>Sales Breakdown / Desglose de Ventas:</strong>
    <span>CSA / CSA: ${task['CSA'] || 0}</span>
    <span>Parkdale Bins / Contenedores Parkdale: ${task['Parkdale Bins'] || 0}</span>
    <span>Cobourg Farmers Market / Mercado de Agricultores de Cobourg: ${task['Cobourg Farmers Market'] || 0}</span>
    <span>Kitchen / Cocina: ${task['Kitchen'] || 0}</span>
    <span>Online / En línea: ${task['Online'] || 0}</span>
  `;

  document.getElementById('assignee').value = task['Assignee(s)'] || '';
  document.getElementById('harvestTime').value = task['Time to Harvest (min)'] || ''; // Pre-fill if data exists
  document.getElementById('weight').value = task['Harvest Weight (kg)'] || ''; // Pre-fill if data exists
  document.getElementById('washPackTime').value = task['Time to Wash & Pack (mins)'] || ''; // Pre-fill if data exists
  document.getElementById('notes').value = task['Field Crew Notes'] || ''; // Pre-fill if data exists


  document.getElementById('detail-form').style.display = 'block';
}

function closeForm() {
  document.getElementById('detail-form').style.display = 'none';
}

// --------------------
// DATA FETCH & PARSE
// --------------------
fetch(SHEET_DATA_URL)
  .then(res => {
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status} while fetching SHEET_DATA_URL`);
    }
    return res.text();
  })
  .then(csv => {
    console.log("CSV data fetched successfully. / Datos CSV obtenidos con éxito.");
    if (!csv || csv.trim() === "") {
        throw new Error("Fetched CSV data is empty. / Los datos CSV obtenidos están vacíos.");
    }
    const rows = csv.trim().split('\n').map(row => {
      const cells = [];
      let inQuotes = false, value = '';
      for (let i = 0; i < row.length; i++) {
        const char = row[i];
        const nextChar = row[i + 1];
        if (char === '"' && inQuotes && nextChar === '"') {
          value += '"'; i++;
        } else if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          cells.push(value);
          value = '';
        } else {
          value += char;
        }
      }
      cells.push(value);
      return cells.map(c => c.trim());
    });

    const headers = rows.shift();
    if (!headers || headers.length === 0) {
      throw new Error("CSV headers are missing or empty. / Faltan encabezados CSV o están vacíos.");
    }
    console.log("CSV Headers: / Encabezados CSV:", headers);

    const parsedTasks = rows.map((row, i) => {
      const obj = {};
      headers.forEach((h, j) => {
        const key = h.trim();
        let value = row[j] ? row[j].trim().replace(/^"|"$/g, '') : '';
        if (key === 'Harvest Date') {
            value = normalizeDate(value);
        }
        if (key === 'Location') {
          obj[key] = value;
          const matches = [...value.matchAll(/(\d+)(?:\s*\(([^)]+)\))?/g)];
          obj['_parsedLocations'] = matches.flatMap(m => {
            const primary = m[1];
            const extras = m[2]?.split(',').map(x => x.trim()) || [];
            return [primary, ...extras];
          });
        } else {
          obj[key] = value;
        }
      });
      obj._row = i + 2; // This _row is for reference, not directly used for SheetDB update
      return obj;
    });

    console.log('All Parsed Tasks (before filter): / Todas las tareas analizadas (antes del filtro):', JSON.parse(JSON.stringify(parsedTasks)));

    allTasks = parsedTasks.filter(row =>
      row['Crop'] &&
      row['Harvest Date'] &&
      row['Harvest Date'] !== '' &&
      (row['Status'] !== 'Completed') &&
      !isNaN(parseFloat(row['Units to Harvest'])) &&
      parseFloat(row['Units to Harvest']) > 0
    );

    console.log('Filtered allTasks (excluding completed): / Tareas filtradas (excluyendo completadas):', JSON.parse(JSON.stringify(allTasks)));

    // taskMap is now populated by 'UID'
    taskMap = {};
    allTasks.forEach(t => {
      taskMap[t['UID']] = t; // Use 'UID' as the key for taskMap
    });

    const event = new Event('tasksLoaded');
    document.dispatchEvent(event);
  })
  .catch(error => {
    console.error('Error fetching or parsing initial sheet data: / Error al obtener o analizar datos iniciales de la hoja:', error);
    alert('Could not load harvest tasks. Error: ' + error.message + ' / No se pudieron cargar las tareas de cosecha. Error: ' + error.message);
    const container = document.getElementById('task-list');
    if (container) {
        container.innerHTML = `<p style="color: red;">Error loading tasks: ${error.message}. Please try again later. / Error al cargar tareas: ${error.message}. Por favor, inténtalo de nuevo más tarde.</p>`;
    }
    allTasks = [];
    taskMap = {};
    const event = new Event('tasksLoaded');
    document.dispatchEvent(event);
  });

// --------------------
// DOM READY BINDINGS
// --------------------
document.addEventListener('DOMContentLoaded', () => {
  const dateInput = document.getElementById('date-selector');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;

    document.addEventListener('tasksLoaded', () => {
      console.log("Tasks loaded event received, attempting initial render for date: / Evento de tareas cargadas recibido, intentando renderizado inicial para la fecha:", dateInput.value);
      const tasksToFilter = Array.isArray(allTasks) ? allTasks : [];
      const filteredTasks = tasksToFilter.filter(row => {
          const normalizedRowDate = normalizeDate(row['Harvest Date']);
          return normalizedRowDate === dateInput.value;
      });
      renderTasks(filteredTasks);
    });

    dateInput.addEventListener('change', () => {
      const selectedDate = dateInput.value;
      console.log("Date changed to: / Fecha cambiada a:", selectedDate, "attempting to re-render. / intentando re-renderizar.");
      const tasksToFilter = Array.isArray(allTasks) ? allTasks : [];
      const filteredTasks = tasksToFilter.filter(row => {
          const normalizedRowDate = normalizeDate(row['Harvest Date']);
          return normalizedRowDate === selectedDate;
      });
      renderTasks(filteredTasks);
    });
  }

  const submit = document.getElementById('submit-btn');
  if (submit) {
    submit.addEventListener('click', () => {
      // Check for the 'UID' column from your Google Sheet
      if (!currentRow || !currentRow['UID']) {
          console.error("Current task data is not available or 'UID' is missing. / Datos de la tarea actual no disponibles o falta 'UID'.");
          alert("Error: No task selected or task data is incomplete (missing UID). / Error: Ninguna tarea seleccionada o datos de la tarea incompletos (falta UID).");
          return;
      }

      // --- CRITICAL CHANGE FOR SHEETDB UPDATE ---
      // Use the 'UID' as the identifier in the URL
      const taskUID = currentRow['UID'];
      // The column name is 'UID', so no need for encoding the column name itself.
      // encodeURIComponent is still used for the value to handle any potential special characters.
      const searchUrl = `${SHEETBEST_CONNECTION_URL}/search`;

      fetch(searchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ UID: taskUID })
      })
      .then(res => res.json())
      .then(results => {
        if (!results || !results[0] || !results[0].id) {
          throw new Error("No matching record found for UID: " + taskUID);
        }

        const internalId = results[0].id;
      
      const updateUrl = `${SHEETBEST_CONNECTION_URL}/id/${internalId}?return_values=true`;
      console.log("Update URL for SheetBest (using UID): / URL de actualización para SheetBest (usando UID):", updateUrl);

      const harvestTimeValue = document.getElementById('harvestTime').value;
      const weightValue = document.getElementById('weight').value;
      const washPackTimeValue = document.getElementById('washPackTime').value;
      const assigneeValue = document.getElementById('assignee').value;
      const notesValue = document.getElementById('notes').value;

      const dataToUpdate = {
        'Assignee(s)': assigneeValue,
        'Field Crew Notes': notesValue
      };

      const isBeingCompleted = (harvestTimeValue && harvestTimeValue.trim() !== "") ||
                              (weightValue && weightValue.trim() !== "") ||
                              (washPackTimeValue && washPackTimeValue.trim() !== "");

      if (isBeingCompleted) {
        dataToUpdate['Time to Harvest (min)'] = harvestTimeValue;
        dataToUpdate['Harvest Weight (kg)'] = weightValue;
        dataToUpdate['Time to Wash & Pack (mins)'] = washPackTimeValue;
        dataToUpdate['Status'] = 'Completed';
        // Decide if you want to update 'Harvest Date' to the completion date or keep the planned date.
        // If you want to log completion time, consider a new column like 'Completion Date'.
        // For now, we're not overwriting 'Harvest Date' if it's meant to be the *planned* date.
        // dataToUpdate['Harvest Date'] = new Date().toISOString();
      } else if (assigneeValue.trim() !== "") {
        dataToUpdate['Status'] = 'Assigned';
      } else if (assigneeValue.trim() === "" && notesValue.trim() === "" && !isBeingCompleted) {
        dataToUpdate['Status'] = '';
      }

      console.log('Body being sent to SheetBest for PATCH: / Cuerpo enviado a SheetBest para PATCH:', JSON.stringify(dataToUpdate));

      fetch(updateUrl, {
        method: 'PATCH',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          // 'X-Api-Key': 'YOUR_SHEETBEST_API_KEY' // If required
        },
        body: JSON.stringify(dataToUpdate)
      })
      .then(response => {
        // --- FIX FOR "body stream already read" ERROR ---
        if (!response.ok) {
          return response.text().then(text => { // Read body as text once
            let errorData;
            try {
                errorData = JSON.parse(text); // Attempt to parse as JSON
            } catch (e) {
                errorData = text; // If not JSON, use raw text
            }

            let errorMessage = `HTTP error! Status: ${response.status}. / ¡Error HTTP! Estado: ${response.status}. `;
            if (typeof errorData === 'string') {
                errorMessage += `Response: ${errorData} / Respuesta: ${errorData}`;
            } else if (errorData && (errorData.message || errorData.detail)) {
                errorMessage += `Error: ${errorData.message || errorData.detail} / Error: ${errorData.message || errorData.detail}`;
                if(errorData.errors) errorMessage += ` Details: ${JSON.stringify(errorData.errors)} / Detalles: ${JSON.stringify(errorData.errors)}`;
            } else {
                errorMessage += `Could not parse error response from SheetBest. Raw: ${JSON.stringify(errorData)} / No se pudo analizar la respuesta de error de SheetBest. Crudo: ${JSON.stringify(errorData)}`;
            }
            throw new Error(errorMessage);
          });
        }
        return response.json(); // Only parse as JSON if response is OK
      })
      .then(data => {
        console.log('Successfully PATCHed row via SheetBest: / Fila PATCHADA con éxito vía SheetBest:', data);
        alert('Task updated successfully via SheetBest! / ¡Tarea actualizada con éxito vía SheetBest!');
        location.reload();
      })
      .catch(error => {
        console.error('Error PATCHing row via SheetBest: / Error al PATCHAR fila vía SheetBest:', error);
        alert('Failed to update task via SheetBest: ' + error.message + '\nCheck console for details. / Falló la actualización de la tarea vía SheetBest: ' + error.message + '\nConsultar consola para detalles.');
      });
    });
  }

  const cancelBtn = document.getElementById('cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeForm);
  }
});
