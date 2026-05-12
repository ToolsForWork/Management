// ui.js
import {
  data,
  DEFAULT_COLOR,
  DEFAULT_DISTRICT,
  uuid,
  pickUnusedColor,
  getCurrentWeekKey,
  getAssignmentsForWeek,
  getEmployeeAssignmentsForWeek,
  ensureAssignment,
  removeJobFromAssignments,
  removeEmployeeFromAssignments,
  totalHoursForEmployeeWeek,
  scheduleSave
} from './data.js';

import { forceChartUpdate } from './charts.js';

/* -------------------------------------------------------
   Toast
------------------------------------------------------- */
export function showToast(msg, duration = 2500) {
  const toast = document.getElementById('plannerToast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

/* -------------------------------------------------------
   Jobs
------------------------------------------------------- */
export function addJob(name, category, jobClass, color) {
  if (!name.trim()) return;
  const resolvedColor = color || pickUnusedColor();

  data.jobs.push({
    id: uuid(),
    name: name.trim(),
    category,
    classification: jobClass,
    color: resolvedColor,
    subtasks: [],
    collapsed: false,
    subtaskGroupCollapsed: {},
    hoursBudget: 0
  });

  renderJobs();
  forceChartUpdate();
  scheduleSave();
}

export function removeJob(jobId) {
  data.jobs = data.jobs.filter(j => j.id !== jobId);
  removeJobFromAssignments(jobId);
  renderJobs();
  renderEmployees();
  forceChartUpdate();
  scheduleSave();
}

/* -------------------------------------------------------
   Employees
------------------------------------------------------- */
export function addEmployee(name, weeklyBudget, district) {
  if (!name.trim()) return;
  const budget = parseFloat(weeklyBudget);
  if (isNaN(budget) || budget <= 0) return;

  data.employees.push({
    id: uuid(),
    name: name.trim(),
    weeklyBudget: budget,
    district: district || DEFAULT_DISTRICT,
    collapsed: false
  });

  renderEmployees();
  forceChartUpdate();
  scheduleSave();
}

export function removeEmployee(empId) {
  data.employees = data.employees.filter(e => e.id !== empId);
  removeEmployeeFromAssignments(empId);
  renderEmployees();
  forceChartUpdate();
  scheduleSave();
}

/* -------------------------------------------------------
   Job Rendering
------------------------------------------------------- */
export function renderJobs() {
  const jobsListEl = document.getElementById('jobsList');
  jobsListEl.innerHTML = '';

  const statuses = ['Active', 'Upcoming', 'Complete', 'Other'];
  const classes = ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'];
  const subCategories = ['Electrical', 'Instrumentation', 'Other'];

  // Helper to render a single job card
  function renderSingleJob(job) {
    const div = document.createElement('div');
    div.className = 'item';
    div.draggable = true;
    div.dataset.jobId = job.id;

    if (job.collapsed) div.classList.add('job-collapsed');

    /* ---------------- Header Row ---------------- */
    const headerRow = document.createElement('div');
    headerRow.className = 'item-header-row';

    const dragHandle = document.createElement('div');
    dragHandle.className = 'job-drag-handle';
    dragHandle.addEventListener('mousedown', e => e.stopPropagation());

    const colorBox = document.createElement('div');
    colorBox.className = 'legend-color';
    colorBox.style.background = job.color || DEFAULT_COLOR;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = job.name;

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = job.color || DEFAULT_COLOR;
    colorInput.onchange = () => {
      const oldColor = (job.color || DEFAULT_COLOR).toLowerCase();
      job.color = colorInput.value;
      colorBox.style.background = colorInput.value;

      if (job.subtasks) {
        job.subtasks.forEach(st => {
          if (!st.color || st.color.toLowerCase() === oldColor) {
            st.color = colorInput.value;
          }
        });
      }

      renderJobs();
      renderEmployees();
      forceChartUpdate();
      scheduleSave();
    };

    const categorySelect = document.createElement('select');
    ['Active', 'Upcoming', 'Complete', 'Other'].forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      if (job.category === c) opt.selected = true;
      categorySelect.appendChild(opt);
    });
    categorySelect.onchange = () => {
      job.category = categorySelect.value;
      renderJobs();
      forceChartUpdate();
      scheduleSave();
    };

    //Class dropdown
    const classSelect = document.createElement('select');
    classes.forEach(cls => {
      const opt = document.createElement('option');
      opt.value = cls;
      opt.textContent = cls;
      if (job.classification === cls) opt.selected = true;
      classSelect.appendChild(opt);
    });
    classSelect.onchange = () => {
      job.classification = classSelect.value;
      renderJobs();
      forceChartUpdate();
      scheduleSave();
    };

    const budgetLabel = document.createElement('span');
    budgetLabel.textContent = 'Hrs:';
    budgetLabel.style.cssText = 'font-size:11px;color:var(--text-muted);white-space:nowrap;';

    const budgetInput = document.createElement('input');
    budgetInput.type = 'number';
    budgetInput.min = '0';
    budgetInput.step = '1';
    budgetInput.value = job.hoursBudget || 0;
    budgetInput.style.width = '52px';
    budgetInput.onchange = () => {
      job.hoursBudget = parseFloat(budgetInput.value) || 0;
      forceChartUpdate();
      scheduleSave();
    };

    const collapseBtn = document.createElement('button');
    collapseBtn.textContent = 'Toggle';
    collapseBtn.onclick = () => {
      job.collapsed = !job.collapsed;
      div.classList.toggle('job-collapsed');
    };

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'X';
    removeBtn.onclick = () => removeJob(job.id);

    headerRow.append(
      dragHandle,
      colorBox,
      nameSpan,
      colorInput,
      categorySelect,
      classSelect,
      budgetLabel,
      budgetInput,
      collapseBtn,
      removeBtn
    );

    div.appendChild(headerRow);

    /* ---------------- Subtasks ---------------- */
    const subtasksContainer = document.createElement('div');
    subtasksContainer.className = 'job-subtasks';

    subCategories.forEach(subCat => {
      const catBlock = document.createElement('div');
      catBlock.className = 'job-subtask-category';

      if (job.subtaskGroupCollapsed?.[subCat]) {
        catBlock.classList.add('collapsed');
      }

      const catHeader = document.createElement('div');
      catHeader.className = 'job-subtask-category-header';
      catHeader.textContent = subCat;
      catHeader.onclick = () => {
        catBlock.classList.toggle('collapsed');
        job.subtaskGroupCollapsed = job.subtaskGroupCollapsed || {};
        job.subtaskGroupCollapsed[subCat] = catBlock.classList.contains('collapsed');
      };

      const items = document.createElement('div');
      items.className = 'job-subtask-items';

      (job.subtasks || [])
        .filter(st => st.category === subCat)
        .forEach(st => {
          const row = document.createElement('div');
          row.className = 'job-subtask-row';
          row.draggable = true;

          row.addEventListener('dragstart', e => {
            e.stopPropagation();
            const payload = {
              kind: 'subtask',
              jobId: job.id,
              subtaskId: st.id || null,
              name: st.name,
              category: st.category,
              color: st.color || job.color || DEFAULT_COLOR
            };
            e.dataTransfer.setData('application/json', JSON.stringify(payload));
          });

          const dot = document.createElement('span');
          dot.className = 'job-subtask-dot';
          dot.textContent = '•';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'job-subtask-name';
          nameSpan.textContent = st.name;

          const stColorPicker = document.createElement('input');
          stColorPicker.type = 'color';
          stColorPicker.value = st.color || job.color || DEFAULT_COLOR;
          stColorPicker.style.cssText = 'position:absolute;opacity:0;width:0;height:0;pointer-events:none;';
          stColorPicker.onchange = () => {
            st.color = stColorPicker.value;
            colorDot.style.background = stColorPicker.value;
            renderEmployees();
            forceChartUpdate();
            scheduleSave();
          };

          const colorDot = document.createElement('span');
          colorDot.style.cssText = `
            display:inline-block;width:12px;height:12px;
            border-radius:50%;background:${st.color || job.color || DEFAULT_COLOR};
            flex-shrink:0;cursor:pointer;border:1px solid rgba(0,0,0,0.2);
            position:relative;
          `;
          colorDot.appendChild(stColorPicker);
          colorDot.onclick = e => {
            e.stopPropagation();
            stColorPicker.click();
          };

          const delBtn = document.createElement('button');
          delBtn.textContent = 'X';
          delBtn.onclick = () => {
            job.subtasks = job.subtasks.filter(x => x !== st);
            renderJobs();
            scheduleSave();
          };

          row.append(dot, nameSpan, colorDot, delBtn);
          items.appendChild(row);
        });

      const addRow = document.createElement('div');
      addRow.className = 'job-subtask-add';

      const nameInput = document.createElement('input');
      nameInput.placeholder = 'Subtask name';

      const addColorInput = document.createElement('input');
      addColorInput.type = 'color';
      addColorInput.value = job.color || DEFAULT_COLOR;
      addColorInput.style.display = 'none';

      const addBtn = document.createElement('button');
      addBtn.textContent = 'Add';
      addBtn.onclick = () => {
        if (!nameInput.value.trim()) return;
        job.subtasks = job.subtasks || [];
        job.subtasks.push({
          id: uuid(),
          name: nameInput.value.trim(),
          category: subCat,
          color: addColorInput.value
        });
        nameInput.value = '';
        addColorInput.value = job.color || DEFAULT_COLOR;
        renderJobs();
        scheduleSave();
      };

      addRow.append(nameInput, addColorInput, addBtn);
      catBlock.append(catHeader, items, addRow);
      subtasksContainer.appendChild(catBlock);
    });

    div.appendChild(subtasksContainer);

    /* ---------------- Drag reorder ---------------- */
    div.addEventListener('dragstart', e => {
      if (e.target !== div && e.target.classList.contains('job-subtask-row')) return;
      e.dataTransfer.setData('text/plain', job.id);
      e.dataTransfer.setData('application/json', JSON.stringify({ kind: 'job', jobId: job.id }));
    });

    div.addEventListener('dragover', e => e.preventDefault());
    div.addEventListener('drop', e => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain');
      reorderJob(draggedId, job.id, job.category);
    });

    return div;
  }

  /* ---------------- Status → Class grouping ---------------- */
  statuses.forEach(status => {
    const statusSection = document.createElement('div');
    statusSection.className = 'job-category-section';

    const statusHeader = document.createElement('div');
    statusHeader.className = 'job-category-header';
    statusHeader.textContent = status;
    statusHeader.onclick = () => statusSection.classList.toggle('collapsed');

    const statusList = document.createElement('div');
    statusList.className = 'job-category-list';

    classes.forEach(cls => {
      const jobsInGroup = data.jobs.filter(
        j => j.category === status && j.classification === cls
      );

      if (jobsInGroup.length === 0) return;

      const classBlock = document.createElement('div');
      classBlock.className = 'job-class-section';

      const classHeader = document.createElement('div');
      classHeader.className = 'job-class-header';
      classHeader.textContent = cls;
      classHeader.onclick = () => classBlock.classList.toggle('collapsed');

      const classList = document.createElement('div');
      classList.className = 'job-class-list';

      jobsInGroup.forEach(job => {
        const jobEl = renderSingleJob(job);
        classList.appendChild(jobEl);
      });

      classBlock.append(classHeader, classList);
      statusList.appendChild(classBlock);
    });

    statusSection.append(statusHeader, statusList);
    jobsListEl.appendChild(statusSection);
  });
}

function reorderJob(dragId, targetId, category) {
  const jobsInCategory = data.jobs.filter(j => j.category === category);
  const dragIndex = jobsInCategory.findIndex(j => j.id === dragId);
  const targetIndex = jobsInCategory.findIndex(j => j.id === targetId);
  if (dragIndex === -1 || targetIndex === -1) return;

  const [moved] = jobsInCategory.splice(dragIndex, 1);
  jobsInCategory.splice(targetIndex, 0, moved);

  const others = data.jobs.filter(j => j.category !== category);
  data.jobs = [...others, ...jobsInCategory];

  renderJobs();
  scheduleSave();
}

/* -------------------------------------------------------
   Employee Rendering
------------------------------------------------------- */
export function renderEmployees() {
  const employeesListEl = document.getElementById('employeesList');
  employeesListEl.innerHTML = '';

  const weekKey = getCurrentWeekKey();
  const districts = ['Electrical', 'Instrumentation', 'Flex'];

  districts.forEach(district => {
    const employeesInDistrict = data.employees.filter(e => e.district === district);
    if (employeesInDistrict.length === 0) return;

    const header = document.createElement('div');
    header.className = 'district-header';
    header.textContent = district;
    employeesListEl.appendChild(header);

    employeesInDistrict.forEach(emp => {
      const card = document.createElement('div');
      card.className = 'employee-card';
      if (emp.collapsed) card.classList.add('collapsed');

      const headerRow = document.createElement('div');
      headerRow.className = 'employee-header';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'employee-name';
      nameSpan.textContent = emp.name;

      const districtSpan = document.createElement('span');
      const districtSelect = document.createElement('select');
      ['Electrical', 'Instrumentation', 'Flex'].forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        if (emp.district === d) opt.selected = true;
        districtSelect.appendChild(opt);
      });
      districtSelect.onchange = () => {
        emp.district = districtSelect.value;
        renderEmployees();
        forceChartUpdate();
        scheduleSave();
      };
      districtSpan.appendChild(districtSelect);

      const total = totalHoursForEmployeeWeek(weekKey, emp.id);

      const budgetSpan = document.createElement('span');
      budgetSpan.className = 'employee-budget';
      budgetSpan.textContent = `Allocated: ${total}/${emp.weeklyBudget} hrs`;

      const toggleBtn = document.createElement('button');
      toggleBtn.textContent = 'Toggle';
      toggleBtn.onclick = () => {
        emp.collapsed = !emp.collapsed;
        card.classList.toggle('collapsed');
      };

      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.onclick = () => removeEmployee(emp.id);

      headerRow.append(nameSpan, districtSpan, budgetSpan, toggleBtn, removeBtn);

      /* ---------------- Gauge ---------------- */
      const gaugeLabel = document.createElement('div');
      gaugeLabel.className = 'gauge-label';
      const pct = emp.weeklyBudget > 0 ? Math.round((total / emp.weeklyBudget) * 100) : 0;
      gaugeLabel.textContent = `Usage: ${pct}%`;

      const gauge = document.createElement('div');
      gauge.className = 'gauge';
      if (pct > 100) gauge.classList.add('over-budget');

      const empAssignments = getEmployeeAssignmentsForWeek(weekKey, emp.id);
      const gaugeMax = Math.max(total, emp.weeklyBudget || 0, 1);
      let offset = 0;

      Object.entries(empAssignments).forEach(([jobId, a]) => {
        const parentHours = a.hours || 0;
        if (parentHours <= 0) return;

        const job = data.jobs.find(j => j.id === jobId);
        const baseColor = job?.color || DEFAULT_COLOR;

        const parentPct = (parentHours / gaugeMax) * 100;
        const subtasks = a.subtasks || [];
        const totalSubHours = subtasks.reduce((s, sub) => s + (sub.hours || 0), 0);

        if (subtasks.length === 0 || totalSubHours <= 0) {
          const fill = document.createElement('div');
          fill.className = 'gauge-fill';
          fill.style.left = offset + '%';
          fill.style.width = parentPct + '%';
          fill.style.background = baseColor;
          gauge.appendChild(fill);
          offset += parentPct;
          return;
        }

        const scale = totalSubHours > parentHours ? (parentHours / totalSubHours) : 1;
        let usedParentHours = 0;

        subtasks.forEach(sub => {
          const raw = sub.hours || 0;
          if (raw <= 0) return;
          const eff = raw * scale;
          usedParentHours += eff;
          const subPct = (eff / gaugeMax) * 100;

          const fill = document.createElement('div');
          fill.className = 'gauge-fill';
          fill.style.left = offset + '%';
          fill.style.width = subPct + '%';
          fill.style.background = sub.color || baseColor;
          gauge.appendChild(fill);
          offset += subPct;
        });

        const remaining = Math.max(0, parentHours - usedParentHours);
        if (remaining > 0) {
          const remPct = (remaining / gaugeMax) * 100;
          const fill = document.createElement('div');
          fill.className = 'gauge-fill';
          fill.style.left = offset + '%';
          fill.style.width = remPct + '%';
          fill.style.background = baseColor;
          gauge.appendChild(fill);
          offset += remPct;
        }
      });

      const unutilized = Math.max(0, emp.weeklyBudget - total);
      if (unutilized > 0) {
        const unPct = (unutilized / gaugeMax) * 100;
        const fill = document.createElement('div');
        fill.className = 'gauge-fill unutilized';
        fill.style.left = offset + '%';
        fill.style.width = unPct + '%';
        gauge.appendChild(fill);
      }

      if (emp.weeklyBudget > 0 && total > emp.weeklyBudget) {
        const markerPct = (emp.weeklyBudget / gaugeMax) * 100;
        const marker = document.createElement('div');
        marker.style.cssText = `
          position:absolute;top:0;bottom:0;
          left:${markerPct}%;
          width:2px;background:rgba(255,255,255,0.85);
          z-index:2;pointer-events:none;
        `;
        gauge.appendChild(marker);
      }

      /* ---------------- Dropzone ---------------- */
      const dropzone = document.createElement('div');
      dropzone.className = 'employee-dropzone';
      dropzone.dataset.employeeId = emp.id;

      dropzone.addEventListener('dragover', e => {
        e.preventDefault();
        dropzone.classList.add('over');
      });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));

            dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('over');

        let payload = null;
        const json = e.dataTransfer.getData('application/json');
        if (json) {
          try { payload = JSON.parse(json); } catch {}
        }

        // Job dropped
        if (payload?.kind === 'job') {
          addAssignment(weekKey, emp.id, payload.jobId);
          return;
        }

        // Subtask dropped
        if (payload?.kind === 'subtask') {
          const { jobId, subtaskId, name, category, color } = payload;
          const empAssignments = getEmployeeAssignmentsForWeek(weekKey, emp.id);

          if (!empAssignments[jobId]) {
            empAssignments[jobId] = { hours: 0, subtasks: [] };
          }

          const assignment = empAssignments[jobId];

          const exists = subtaskId
            ? assignment.subtasks.some(s => s.sourceId === subtaskId)
            : assignment.subtasks.some(s => s.name === name && s.category === category);

          if (!exists) {
            assignment.subtasks.push({
              sourceId: subtaskId || null,
              name,
              category,
              color,
              hours: 0
            });
          }

          renderEmployees();
          forceChartUpdate();
          scheduleSave();
          return;
        }

        // Fallback: plain jobId
        const jobId = e.dataTransfer.getData('text/plain');
        if (jobId) addAssignment(weekKey, emp.id, jobId);
      });

      /* ---------------- Assignment Rows ---------------- */
      Object.keys(empAssignments).forEach(jobId => {
        const job = data.jobs.find(j => j.id === jobId);
        if (!job) return;

        const assignment = empAssignments[jobId];

        const row = document.createElement('div');
        row.className = 'assignment';
        row.style.borderLeftColor = job.color || DEFAULT_COLOR;

        const top = document.createElement('div');
        top.className = 'assignment-top';

        const label = document.createElement('span');
        label.textContent = job.name;

        const hoursInput = document.createElement('input');
        hoursInput.type = 'number';
        hoursInput.min = '0';
        hoursInput.step = '0.25';
        hoursInput.value = assignment.hours || 0;
        hoursInput.onchange = () => {
          updateAssignmentHours(weekKey, emp.id, jobId, parseFloat(hoursInput.value) || 0);
        };

        const removeAssignBtn = document.createElement('button');
        removeAssignBtn.textContent = 'X';
        removeAssignBtn.onclick = () => removeAssignment(weekKey, emp.id, jobId);

        top.append(label, hoursInput, removeAssignBtn);

        /* ---------------- Subtask List ---------------- */
        const subList = document.createElement('div');
        subList.className = 'subtask-list';

        assignment.subtasks = assignment.subtasks || [];

        assignment.subtasks.forEach((sub, index) => {
          const subRow = document.createElement('div');
          subRow.className = 'subtask-row';

          const dot = document.createElement('span');
          dot.className = 'employee-subtask-dot';
          dot.textContent = '•';

          const subName = document.createElement('span');
          subName.className = 'employee-subtask-name';
          subName.textContent = sub.name;

          const subHours = document.createElement('input');
          subHours.type = 'number';
          subHours.min = '0';
          subHours.step = '0.25';
          subHours.value = sub.hours || 0;
          subHours.onchange = () => {
            sub.hours = parseFloat(subHours.value) || 0;
            renderEmployees();
            forceChartUpdate();
          };

          let colorEl;
          if (!sub.sourceId) {
            colorEl = document.createElement('input');
            colorEl.type = 'color';
            colorEl.value = sub.color || job.color || DEFAULT_COLOR;
            colorEl.onchange = () => {
              sub.color = colorEl.value;
              renderEmployees();
              forceChartUpdate();
              scheduleSave();
            };
          } else {
            colorEl = document.createElement('span');
            colorEl.style.cssText = `
              display:inline-block;width:12px;height:12px;
              border-radius:50%;background:${sub.color || job.color || DEFAULT_COLOR};
              flex-shrink:0;border:1px solid rgba(0,0,0,0.15);
            `;
          }

          const del = document.createElement('button');
          del.textContent = 'X';
          del.onclick = () => {
            assignment.subtasks.splice(index, 1);
            renderEmployees();
            forceChartUpdate();
            scheduleSave();
          };

          subRow.append(dot, subName, subHours, colorEl, del);
          subList.appendChild(subRow);
        });

        /* ---------------- Add Subtask Row ---------------- */
        const subInputRow = document.createElement('div');
        subInputRow.style.cssText = 'display:flex;gap:4px;align-items:center;margin-top:2px;';

        const subInputLabel = document.createElement('span');
        subInputLabel.style.fontSize = '11px';
        subInputLabel.textContent = 'Add subtask:';

        const subInput = document.createElement('input');
        subInput.placeholder = 'name…';
        subInput.style.flex = '1';
        subInput.onkeydown = ev => {
          if (ev.key === 'Enter' && subInput.value.trim()) {
            assignment.subtasks.push({
              name: subInput.value.trim(),
              hours: 0,
              color: job.color || DEFAULT_COLOR
            });
            subInput.value = '';
            renderEmployees();
            forceChartUpdate();
            scheduleSave();
          }
        };

        subInputRow.append(subInputLabel, subInput);

        row.append(top, subInputRow, subList);
        dropzone.appendChild(row);
      });

      card.append(headerRow, gaugeLabel, gauge, dropzone);
      employeesListEl.appendChild(card);
    });
  });
}

/* -------------------------------------------------------
   Assignment helpers (UI wrappers)
------------------------------------------------------- */
export function addAssignment(weekKey, empId, jobId) {
  ensureAssignment(weekKey, empId, jobId);
  renderEmployees();
  forceChartUpdate();
  scheduleSave();
}

export function updateAssignmentHours(weekKey, empId, jobId, hours) {
  const assignment = ensureAssignment(weekKey, empId, jobId);
  assignment.hours = hours;
  renderEmployees();
  forceChartUpdate();
  scheduleSave();
}

export function removeAssignment(weekKey, empId, jobId) {
  const empAssignments = getEmployeeAssignmentsForWeek(weekKey, empId);
  delete empAssignments[jobId];
  renderEmployees();
  forceChartUpdate();
  scheduleSave();
}

/*
   download CSV
*/
export function downloadCsv(rows, filename) {
  const csvContent = rows
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


/* -------------------------------------------------------
   Resizable Columns
------------------------------------------------------- */
export function makeResizable(divider, leftCol, rightCol) {
  let dragging = false;

  divider.addEventListener('mousedown', () => dragging = true);
  window.addEventListener('mouseup', () => dragging = false);

  window.addEventListener('mousemove', e => {
    if (!dragging) return;

    const containerRect = document.querySelector('.container').getBoundingClientRect();
    const totalWidth = containerRect.width;
    const x = e.clientX - containerRect.left;

    if (divider.id === 'divider1') {
      const min = 150;
      const max = totalWidth - 300;
      const leftWidth = Math.max(min, Math.min(x, max));

      const employeesWidth = document.querySelector('.employees-column').offsetWidth;
      const divider2Width = document.getElementById('divider2').offsetWidth;
      const rightWidth = totalWidth - leftWidth - divider.offsetWidth - employeesWidth - divider2Width;

      if (rightWidth < 150) return;

      leftCol.style.width = leftWidth + 'px';
      rightCol.style.width = rightWidth + 'px';
    }

    else if (divider.id === 'divider2') {
      const chartWidth = document.querySelector('.chart-column').offsetWidth;
      const divider1Width = document.getElementById('divider1').offsetWidth;

      const min = 150;
      const max = totalWidth - chartWidth - 300;

      const leftWidth = Math.max(min, Math.min(x - chartWidth - divider1Width, max));
      const rightWidth = totalWidth - chartWidth - divider1Width - divider.offsetWidth - leftWidth;

      if (rightWidth < 150) return;

      leftCol.style.width = leftWidth + 'px';
      rightCol.style.width = rightWidth + 'px';
    }

    forceChartUpdate();
  });
}
