// --------------------
// CONFIGURATION
// --------------------
// It seems you're using SheetDB. Ensure this URL is correct for your SheetDB API.
const SHEET_DATA_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQMQfiXLy46WD1l7r2LA0OA5Kf6wnfwYdTX5TpUaj2nP4NxG__dSkiiTWj4ZzjEsCGodJW02BLXUCqW/pub?gid=157996468&single=true&output=csv';
// Your SheetDB API endpoint for updates/reads.
const SHEETBEST_CONNECTION_URL = 'https://sheetdb.io/api/v1/3rydewkqa9q5a';

let currentRow = null;
let allTasks = [];
let taskMap = {}; // Will map UID to task object

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
    return '';
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
    div.innerHTML = `
      <strong>${task['Crop'] || 'N/A'}</strong><br>
      <strong>Location / Ubicación:</strong> ${task['Location'] || '-'}<br>
      <strong>Quantity / Cantidad:</strong> ${task['Units to Harvest'] || 'N/A'} ${task['Harvest Units'] || ''}<br>
      <strong>Assigned To / Asignado a:</strong> ${task['Assignee'] || 'Unassigned / Sin asignar'}<br>
      <button onclick="openForm('${task['UID'] || ''}')">Open / Abrir</button>
    `;
    container.appendChild(div);
  });
}

// --------------------
// RENDER: DETAIL VIEW
// --------------------
function openForm(taskUID) {
  const task = allTasks.find(t => t['UID'] === taskUID);
  if (!task) {
      console.error("Task not found for UID: / Tarea no encontrada para UID:", taskUID);
      return;
  }

  currentRow = task;
  document.getElementById('detail-title').innerText = task['Crop'] || 'N/A';
  document.getElementById('detail-location').innerText = task['Location'] || '-';
  document.getElementById('detail-quantity').innerText = `${task['Units to Harvest'] || 'N/A'} ${task['Harvest Units'] || ''}`;

  breakdown.innerHTML = `
    <strong>Sales Breakdown / Desglose de Ventas:</strong>
    <div class="sales-grid">
      <span>CSA: ${task['CSA'] || 0}</span>
      <span>Cider Keg: ${task['Cider Keg'] || 0}</span>
      <span>Matz: ${task['Matz'] || 0}</span>
      <span>Generations: ${task['Generations'] || 0}</span>
      <span>Online: ${task['Online'] || 0}</span>
    </div>
  `;

  // Pre-fill fields with existing data - KEYS UPDATED TO MATCH YOUR GOOGLE SHEET HEADERS
  document.getElementById('assignee').value = task['Assignee'] || '';
  document.getElementById('harvestTime').value = task['Time to Harvest'] || ''; // Changed from 'Time to Harvest (min)'
  document.getElementById('weight').value = task['Harvest Weight kg'] || '';    // Changed from 'Harvest Weight (kg)' to 'Harvest Weight kg'
  document.getElementById('washPackTime').value = task['Time to Wash & Pack'] || ''; // Changed from 'Time to Wash & Pack (mins)'
  document.getElementById('notes').value = task['Field Crew Note'] || '';

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

  const updateBtn = document.getElementById('update-btn');
  if (updateBtn) {
    updateBtn.addEventListener('click', () => {
      handleSubmit(false);
    });
  }

  const completeBtn = document.getElementById('complete-btn');
  if (completeBtn) {
    completeBtn.addEventListener('click', () => {
      handleSubmit(true);
    });
  }

  function handleSubmit(requireAllFields) {
    if (!currentRow || !currentRow['UID']) {
      console.error("Current task data is not available or 'UID' is missing. / Datos de la tarea actual no disponibles o falta 'UID'.");
      alert("Error: No task selected or task data is incomplete (missing UID). / Error: Ninguna tarea seleccionada o datos de la tarea incompletos (falta UID).");
      return;
    }

    const harvestTime = document.getElementById('harvestTime').value.trim();
    const weight = document.getElementById('weight').value.trim();
    const washPackTime = document.getElementById('washPackTime').value.trim();
    const assignee = document.getElementById('assignee').value.trim();
    const notes = document.getElementById('notes').value.trim();

    if (requireAllFields && (!assignee || !harvestTime || !weight || !washPackTime)) {
      alert("Please complete all fields before marking as completed.");
      return;
    }

    const dataToUpdate = {};
    if (assignee) dataToUpdate['Assignee'] = assignee; // Corrected to 'Assignee' based on sheet
    if (harvestTime) dataToUpdate['Time to Harvest'] = harvestTime;        // Matches new header
    if (weight) dataToUpdate['Harvest Weight kg'] = weight;              // Matches new header
    if (washPackTime) dataToUpdate['Time to Wash & Pack'] = washPackTime; // Matches new header
    if (notes) dataToUpdate['Field Crew Note'] = notes;               // Matches new header

    if (requireAllFields) {
      dataToUpdate['Status'] = 'Completed';
      dataToUpdate['Harvest Date'] = new Date().toISOString().split('T')[0]; // Set Harvest Date to completion date
    } else if (assignee) {
      dataToUpdate['Status'] = 'Assigned';
    } else {
      dataToUpdate['Status'] = ''; // Clear status if nothing else is updated and assignee is empty
    }

    const taskUID = currentRow['UID'];
    const updateUrl = `${SHEETBEST_CONNECTION_URL}/UID/${encodeURIComponent(taskUID)}`; // SheetDB update by UID
    console.log("Update URL for SheetDB (using UID): / URL de actualización para SheetDB (usando UID):", updateUrl);
    console.log('Body being sent to SheetDB for PATCH: / Cuerpo enviado a SheetDB para PATCH:', JSON.stringify(dataToUpdate));

    fetch(updateUrl, {
      method: 'PATCH',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataToUpdate)
    })
      .then(response => {
        if (!response.ok) {
          // Attempt to read the error body for more details
          return response.text().then(text => {
            let errorData;
            try {
                errorData = JSON.parse(text); // Try parsing as JSON
            } catch (e) {
                errorData = text; // If it's not JSON, use raw text
            }
            let errorMessage = `HTTP error! Status: ${response.status}. `;
            if (typeof errorData === 'string') {
                errorMessage += `Response: ${errorData}`;
            } else if (errorData && (errorData.message || errorData.detail)) {
                errorMessage += `Error: ${errorData.message || errorData.detail}`;
                if(errorData.errors) errorMessage += ` Details: ${JSON.stringify(errorData.errors)}`;
            } else {
                errorMessage += `Could not parse error response. Raw: ${JSON.stringify(errorData)}`;
            }
            throw new Error(errorMessage);
          });
        }
        return response.json();
      })
      .then(data => {
        console.log('Successfully PATCHed row via SheetDB: / Fila PATCHADA con éxito vía SheetDB:', data);
        alert('Task updated successfully via SheetDB! / ¡Tarea actualizada con éxito vía SheetDB!');

        // CRITICAL FIX: Use SheetDB's correct GET search endpoint for re-fetching
        const fetchUpdatedTaskUrl = `${SHEETBEST_CONNECTION_URL}/search?UID=${encodeURIComponent(taskUID)}`;
        console.log("Re-fetching URL for SheetDB: / URL de re-obtención para SheetDB:", fetchUpdatedTaskUrl);

        return fetch(fetchUpdatedTaskUrl)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status} when re-fetching updated task.`);
                return res.json();
            })
            .then(updatedTasks => {
                const updatedRow = updatedTasks[0]; // SheetDB returns an array, take the first item
                if (updatedRow) {
                    // Update the allTasks array and taskMap with the fresh data
                    const index = allTasks.findIndex(t => t['UID'] === updatedRow['UID']);
                    if (index !== -1) {
                        allTasks[index] = updatedRow;
                    }
                    taskMap[updatedRow['UID']] = updatedRow;

                    currentRow = updatedRow; // Update currentRow with fresh data

                    // Re-render tasks for the current date, filtering out completed tasks
                    const selectedDate = document.getElementById('date-selector').value;
                    const tasksToFilter = Array.isArray(allTasks) ? allTasks : [];
                    const filteredTasks = tasksToFilter.filter(row => {
                        const normalizedRowDate = normalizeDate(row['Harvest Date']);
                        return normalizedRowDate === selectedDate && row['Status'] !== 'Completed';
                    });
                    renderTasks(filteredTasks);

                    openForm(updatedRow['UID']); // Reopen the form with fresh data
                } else {
                    console.warn("Updated task not found on re-fetch. Reloading page. / Tarea actualizada no encontrada al volver a buscar. Recargando página.");
                    location.reload(); // Fallback to full reload if re-fetch fails
                }
            });
      })
      .catch(error => {
        console.error('Error in handleSubmit (PATCH or Re-fetch): / Error en handleSubmit (PATCH o volver a buscar):', error);
        alert('Failed to update task: ' + error.message + '\nCheck console for details. / Falló la actualización de la tarea: ' + error.message + '\nConsultar consola para detalles.');
      });
  }

  const cancelBtn = document.getElementById('cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeForm);
  }
});
