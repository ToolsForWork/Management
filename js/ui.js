// ui.js
import {
  data,
  DEFAULT_COLOR,
  DEFAULT_DISTRICT,
  DISTRICTS,
  JOB_STATUSES,
  JOB_CLASSES,
  SUBTASK_CATEGORIES,
  ASSIGNMENT_STATUSES,
  uuid,
  pickUnusedColor,
  getCurrentWeekKey,
  getEmployeeAssignmentsForWeek,
  ensureEmployeeAssignmentsForWeek,
  ensureAssignment,
  removeJobFromAssignments,
  totalHoursForEmployeeWeek,
  getEffectiveEmployeeCapacity,
  recordActivity,
  scheduleSave
} from './data.js';

import { forceChartUpdate } from './charts.js';

/* -------------------------------------------------------
   Toast
------------------------------------------------------- */
export function showToast(msg, duration = 2500) {
  const toast = document.getElementById('plannerToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

/* -------------------------------------------------------
   Jobs
------------------------------------------------------- */
export function addJob(name, category, jobClass, color) {
  const normalizedName = name.trim();
  if (!normalizedName) {
    showToast('Enter a project name.');
    return false;
  }
  if (data.jobs.some(job => job.name.toLowerCase() === normalizedName.toLowerCase())) {
    showToast('A project with that name already exists.');
    return false;
  }
  const resolvedColor = color || pickUnusedColor();

  data.jobs.push({
    id: uuid(),
    name: normalizedName,
    category: JOB_STATUSES.includes(category) ? category : 'Other',
    classification: JOB_CLASSES.includes(jobClass) ? jobClass : 'Class 1',
    color: resolvedColor,
    subtasks: [],
    collapsed: false,
    subtaskGroupCollapsed: {},
    hoursBudget: 0,
    ownerId: '',
    priority: 'Medium',
    health: category === 'Complete' ? 'Complete' : 'On track',
    startDate: '',
    dueDate: '',
    description: ''
  });

  recordActivity('Project', `${normalizedName} created.`, 'project', data.jobs[data.jobs.length - 1].id);
  renderJobs();
  forceChartUpdate();
  scheduleSave();
  showToast(`${normalizedName} added.`);
  return true;
}

export function removeJob(jobId) {
  const job = data.jobs.find(candidate => candidate.id === jobId);
  if (!job || !window.confirm(`Remove "${job.name}" and all of its assignments?`)) return;
  data.jobs = data.jobs.filter(j => j.id !== jobId);
  data.tasks.forEach(task => {
    if (task.projectId === jobId) task.projectId = '';
  });
  removeJobFromAssignments(jobId);
  recordActivity('Project', `${job.name} removed.`, 'project', jobId);
  renderJobs();
  renderEmployees();
  forceChartUpdate();
  scheduleSave();
}

/* -------------------------------------------------------
   Employees
------------------------------------------------------- */
export function addEmployee(name, weeklyBudget, district) {
  const normalizedName = name.trim();
  const budget = Number(weeklyBudget);
  if (!normalizedName) {
    showToast('Enter an employee name.');
    return false;
  }
  if (!Number.isFinite(budget) || budget <= 0) {
    showToast('Weekly capacity must be greater than zero.');
    return false;
  }
  if (data.employees.some(employee => employee.name.toLowerCase() === normalizedName.toLowerCase())) {
    showToast('An employee with that name already exists.');
    return false;
  }

  data.employees.push({
    id: uuid(),
    name: normalizedName,
    weeklyBudget: budget,
    district: DISTRICTS.includes(district) ? district : DEFAULT_DISTRICT,
    rosterRole: 'Estimator',
    managerId: '',
    collapsed: false,
    active: true,
    title: '',
    email: '',
    phone: '',
    skills: [],
    hireDate: '',
    managerNotes: ''
  });

  recordActivity('People', `${normalizedName} added to the team.`, 'employee', data.employees[data.employees.length - 1].id);
  renderEmployees();
  forceChartUpdate();
  scheduleSave();
  showToast(`${normalizedName} added.`);
  return true;
}

export function removeEmployee(empId) {
  const employee = data.employees.find(candidate => candidate.id === empId);
  if (!employee || !window.confirm(`Archive "${employee.name}"? Their historical assignments and records will be preserved.`)) return;
  employee.active = false;
  employee.archivedAt = getCurrentWeekKey();
  Object.entries(data.assignments).forEach(([weekKey, week]) => {
    if (weekKey >= employee.archivedAt) delete week[employee.id];
  });
  recordActivity('People', `${employee.name} archived.`, 'employee', employee.id);
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

  const query = document.getElementById('jobSearchInput')?.value.trim().toLowerCase() || '';
  const visibleJobs = query
    ? data.jobs.filter(job => job.name.toLowerCase().includes(query)
      || (job.subtasks || []).some(subtask => subtask.name.toLowerCase().includes(query)))
    : data.jobs;

  if (visibleJobs.length === 0) {
    jobsListEl.appendChild(createEmptyState(
      data.jobs.length === 0 ? 'No projects yet' : 'No projects match your search',
      data.jobs.length === 0
        ? 'Add the first project above, then assign it to employees.'
        : 'Try a different project or subtask name.'
    ));
    return;
  }

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
    dragHandle.title = 'Drag to reorder project';
    dragHandle.setAttribute('aria-hidden', 'true');
    dragHandle.addEventListener('mousedown', e => e.stopPropagation());

    const colorBox = document.createElement('div');
    colorBox.className = 'legend-color';
    colorBox.style.background = job.color || DEFAULT_COLOR;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'item-name';
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
    categorySelect.setAttribute('aria-label', `Status for ${job.name}`);
    JOB_STATUSES.forEach(c => {
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
    classSelect.setAttribute('aria-label', `Class for ${job.name}`);
    JOB_CLASSES.forEach(cls => {
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
    budgetInput.setAttribute('aria-label', `Hours budget for ${job.name}`);
    budgetInput.oninput = () => {
      job.hoursBudget = Math.max(0, Number(budgetInput.value) || 0);
      forceChartUpdate();
      scheduleSave();
    };

    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'icon-button';
    collapseBtn.textContent = job.collapsed ? '▸' : '▾';
    collapseBtn.title = `${job.collapsed ? 'Expand' : 'Collapse'} ${job.name}`;
    collapseBtn.setAttribute('aria-label', collapseBtn.title);
    collapseBtn.onclick = () => {
      job.collapsed = !job.collapsed;
      div.classList.toggle('job-collapsed');
      collapseBtn.textContent = job.collapsed ? '▸' : '▾';
      scheduleSave();
    };

    const removeBtn = document.createElement('button');
    removeBtn.className = 'icon-button danger-button';
    removeBtn.textContent = '×';
    removeBtn.title = `Remove ${job.name}`;
    removeBtn.setAttribute('aria-label', removeBtn.title);
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

    const metadata = document.createElement('div');
    metadata.className = 'planner-meta-row';
    metadata.append(
      createMetaChip(job.health || 'On track', `health-${(job.health || 'on-track').toLowerCase().replaceAll(' ', '-')}`),
      createMetaChip(job.priority || 'Medium', `priority-${(job.priority || 'medium').toLowerCase()}`)
    );
    if (job.dueDate) metadata.appendChild(createMetaChip(`Due ${job.dueDate}`, 'meta-neutral'));
    const owner = data.employees.find(employee => employee.id === job.ownerId);
    if (owner) metadata.appendChild(createMetaChip(owner.name, 'meta-neutral'));
    div.appendChild(metadata);

    /* ---------------- Subtasks ---------------- */
    const subtasksContainer = document.createElement('div');
    subtasksContainer.className = 'job-subtasks';

    SUBTASK_CATEGORIES.forEach(subCat => {
      const catBlock = document.createElement('div');
      catBlock.className = 'job-subtask-category';

      if (job.subtaskGroupCollapsed?.[subCat]) {
        catBlock.classList.add('collapsed');
      }

      const catHeader = document.createElement('div');
      catHeader.className = 'job-subtask-category-header';
      catHeader.textContent = subCat;
      makeKeyboardClickable(catHeader, () => {
        catBlock.classList.toggle('collapsed');
        job.subtaskGroupCollapsed = job.subtaskGroupCollapsed || {};
        job.subtaskGroupCollapsed[subCat] = catBlock.classList.contains('collapsed');
        scheduleSave();
      });

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
          delBtn.className = 'icon-button danger-button';
          delBtn.textContent = '×';
          delBtn.title = `Remove ${st.name}`;
          delBtn.setAttribute('aria-label', delBtn.title);
          delBtn.onclick = () => {
            if (!window.confirm(`Remove subtask "${st.name}"? Existing employee entries will remain as a historical snapshot.`)) return;
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
      nameInput.setAttribute('aria-label', `New ${subCat} subtask for ${job.name}`);

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
      nameInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') addBtn.click();
      });

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
  JOB_STATUSES.forEach(status => {
    const statusJobs = visibleJobs.filter(job => job.category === status);
    if (statusJobs.length === 0) return;

    const statusSection = document.createElement('div');
    statusSection.className = 'job-category-section';

    const statusHeader = document.createElement('div');
    statusHeader.className = 'job-category-header';
    statusHeader.textContent = status;
    makeKeyboardClickable(statusHeader, () => statusSection.classList.toggle('collapsed'));

    const statusList = document.createElement('div');
    statusList.className = 'job-category-list';

    JOB_CLASSES.forEach(cls => {
      const jobsInGroup = statusJobs.filter(
        j => j.classification === cls
      );

      if (jobsInGroup.length === 0) return;

      const classBlock = document.createElement('div');
      classBlock.className = 'job-class-section';

      const classHeader = document.createElement('div');
      classHeader.className = 'job-class-header';
      classHeader.textContent = cls;
      makeKeyboardClickable(classHeader, () => classBlock.classList.toggle('collapsed'));

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
  const query = document.getElementById('employeeSearchInput')?.value.trim().toLowerCase() || '';
  const visibleEmployees = query
    ? data.employees.filter(employee => employee.active !== false && (employee.name.toLowerCase().includes(query)
      || employee.district.toLowerCase().includes(query)))
    : data.employees.filter(employee => employee.active !== false);

  if (visibleEmployees.length === 0) {
    const hasActiveEmployees = data.employees.some(employee => employee.active !== false);
    employeesListEl.appendChild(createEmptyState(
      !hasActiveEmployees ? 'No active employees' : 'No employees match your search',
      !hasActiveEmployees
        ? 'Add the first team member above to begin planning.'
        : 'Try a different employee or district name.'
    ));
    return;
  }

  DISTRICTS.forEach(district => {
    const employeesInDistrict = visibleEmployees.filter(e => e.district === district);
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

      const nameInput = document.createElement('input');
      nameInput.className = 'employee-name';
      nameInput.value = emp.name;
      nameInput.setAttribute('aria-label', 'Employee name');
      nameInput.addEventListener('change', () => {
        const nextName = nameInput.value.trim();
        if (!nextName) {
          nameInput.value = emp.name;
          showToast('Employee name cannot be empty.');
          return;
        }
        emp.name = nextName;
        scheduleSave();
      });

      const districtSpan = document.createElement('span');
      const districtSelect = document.createElement('select');
      districtSelect.setAttribute('aria-label', `District for ${emp.name}`);
      DISTRICTS.forEach(d => {
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
      const effectiveCapacity = getEffectiveEmployeeCapacity(emp, weekKey);

      const budgetSpan = document.createElement('span');
      budgetSpan.className = 'employee-budget';
      budgetSpan.textContent = `${formatHours(total)} / `;

      const capacityInput = document.createElement('input');
      capacityInput.type = 'number';
      capacityInput.min = '0.25';
      capacityInput.step = '0.25';
      capacityInput.value = emp.weeklyBudget;
      capacityInput.setAttribute('aria-label', `Weekly capacity for ${emp.name}`);
      capacityInput.addEventListener('change', () => {
        const value = Number(capacityInput.value);
        if (!Number.isFinite(value) || value <= 0) {
          capacityInput.value = emp.weeklyBudget;
          showToast('Weekly capacity must be greater than zero.');
          return;
        }
        emp.weeklyBudget = value;
        renderEmployees();
        forceChartUpdate();
        scheduleSave();
      });
      const capacityUnit = document.createElement('span');
      capacityUnit.textContent = ' hrs';
      budgetSpan.append(capacityInput, capacityUnit);

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'icon-button';
      toggleBtn.textContent = emp.collapsed ? '▸' : '▾';
      toggleBtn.title = `${emp.collapsed ? 'Expand' : 'Collapse'} ${emp.name}`;
      toggleBtn.setAttribute('aria-label', toggleBtn.title);
      toggleBtn.onclick = () => {
        emp.collapsed = !emp.collapsed;
        card.classList.toggle('collapsed');
        toggleBtn.textContent = emp.collapsed ? '▸' : '▾';
        scheduleSave();
      };

      const removeBtn = document.createElement('button');
      removeBtn.className = 'icon-button danger-button';
      removeBtn.textContent = '⊘';
      removeBtn.title = `Archive ${emp.name}`;
      removeBtn.setAttribute('aria-label', removeBtn.title);
      removeBtn.onclick = () => removeEmployee(emp.id);

      headerRow.append(nameInput, districtSpan, budgetSpan, toggleBtn, removeBtn);

      /* ---------------- Gauge ---------------- */
      const gaugeLabel = document.createElement('div');
      gaugeLabel.className = 'gauge-label';
      const pct = effectiveCapacity > 0 ? Math.round((total / effectiveCapacity) * 100) : total > 0 ? 100 : 0;
      const leaveReduction = Math.max(0, emp.weeklyBudget - effectiveCapacity);
      gaugeLabel.textContent = `${pct}% utilized · ${formatHours(Math.max(0, effectiveCapacity - total))} hrs available${leaveReduction ? ` · ${formatHours(leaveReduction)} hrs leave` : ''}`;

      const gauge = document.createElement('div');
      gauge.className = 'gauge';
      if (pct > 100) gauge.classList.add('over-budget');

      const empAssignments = getEmployeeAssignmentsForWeek(weekKey, emp.id);
      const gaugeMax = Math.max(total, effectiveCapacity, 1);
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

      const unutilized = Math.max(0, effectiveCapacity - total);
      if (unutilized > 0) {
        const unPct = (unutilized / gaugeMax) * 100;
        const fill = document.createElement('div');
        fill.className = 'gauge-fill unutilized';
        fill.style.left = offset + '%';
        fill.style.width = unPct + '%';
        gauge.appendChild(fill);
      }

      if (effectiveCapacity > 0 && total > effectiveCapacity) {
        const markerPct = (effectiveCapacity / gaugeMax) * 100;
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
      dropzone.setAttribute('aria-label', `Assignments for ${emp.name}`);

      const assignmentControls = document.createElement('div');
      assignmentControls.className = 'assignment-controls';
      const projectSelect = document.createElement('select');
      projectSelect.setAttribute('aria-label', `Project to assign to ${emp.name}`);
      const placeholderOption = document.createElement('option');
      placeholderOption.value = '';
      placeholderOption.textContent = 'Choose a project…';
      projectSelect.appendChild(placeholderOption);
      data.jobs
        .filter(job => !getEmployeeAssignmentsForWeek(weekKey, emp.id)[job.id])
        .sort((left, right) => left.name.localeCompare(right.name))
        .forEach(job => {
          const option = document.createElement('option');
          option.value = job.id;
          option.textContent = job.name;
          projectSelect.appendChild(option);
        });
      const assignButton = document.createElement('button');
      assignButton.textContent = 'Assign';
      assignButton.disabled = projectSelect.options.length === 1;
      assignButton.addEventListener('click', () => {
        if (projectSelect.value) addAssignment(weekKey, emp.id, projectSelect.value);
      });
      projectSelect.addEventListener('change', () => {
        assignButton.disabled = !projectSelect.value;
      });
      assignmentControls.append(projectSelect, assignButton);

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
          const empAssignments = ensureEmployeeAssignmentsForWeek(weekKey, emp.id);

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
        hoursInput.setAttribute('aria-label', `${job.name} hours for ${emp.name}`);
        const originalHours = Number(assignment.hours) || 0;
        hoursInput.oninput = () => {
          assignment.hours = Math.max(0, Number(hoursInput.value) || 0);
          forceChartUpdate();
          scheduleSave();
        };
        hoursInput.onchange = () => {
          if (assignment.hours !== originalHours) {
            recordActivity('Allocation', `${emp.name}'s ${job.name} allocation changed to ${formatHours(assignment.hours)} hours.`, 'employee', emp.id);
          }
          renderEmployees();
        };

        const removeAssignBtn = document.createElement('button');
        removeAssignBtn.className = 'icon-button danger-button';
        removeAssignBtn.textContent = '×';
        removeAssignBtn.title = `Remove ${job.name} from ${emp.name}`;
        removeAssignBtn.setAttribute('aria-label', removeAssignBtn.title);
        removeAssignBtn.onclick = () => removeAssignment(weekKey, emp.id, jobId);

        top.append(label, hoursInput, removeAssignBtn);

        const responseRow = document.createElement('div');
        responseRow.className = 'assignment-response';
        const responseSelect = document.createElement('select');
        responseSelect.setAttribute('aria-label', `Assignment response for ${job.name} and ${emp.name}`);
        ASSIGNMENT_STATUSES.forEach(status => {
          const option = document.createElement('option');
          option.value = status;
          option.textContent = status;
          option.selected = (assignment.status || 'Proposed') === status;
          responseSelect.appendChild(option);
        });
        const responseNote = document.createElement('input');
        responseNote.type = 'text';
        responseNote.placeholder = 'Assignment note or change request';
        responseNote.setAttribute('aria-label', `Assignment note for ${job.name} and ${emp.name}`);
        responseNote.value = assignment.note || '';
        responseSelect.addEventListener('change', () => {
          assignment.status = responseSelect.value;
          recordActivity('Assignment', `${emp.name} marked ${job.name} ${assignment.status.toLowerCase()}.`, 'employee', emp.id);
          scheduleSave();
          document.dispatchEvent(new CustomEvent('planner:datachange'));
          showToast(`Assignment marked ${assignment.status.toLowerCase()}.`);
        });
        responseNote.addEventListener('input', () => {
          assignment.note = responseNote.value.trim();
          scheduleSave();
        });
        responseNote.addEventListener('change', () => {
          recordActivity('Assignment', `${emp.name}'s note for ${job.name} updated.`, 'employee', emp.id);
          scheduleSave();
          document.dispatchEvent(new CustomEvent('planner:datachange'));
        });
        responseRow.append(responseSelect, responseNote);

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
          subHours.setAttribute('aria-label', `${sub.name} hours for ${emp.name}`);
          subHours.oninput = () => {
            sub.hours = Math.max(0, Number(subHours.value) || 0);
            forceChartUpdate();
            scheduleSave();
          };
          subHours.onchange = renderEmployees;

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
          del.className = 'icon-button danger-button';
          del.textContent = '×';
          del.title = `Remove ${sub.name}`;
          del.setAttribute('aria-label', del.title);
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
              color: job.color || DEFAULT_COLOR,
              category: 'Other'
            });
            subInput.value = '';
            renderEmployees();
            forceChartUpdate();
            scheduleSave();
          }
        };

        subInputRow.append(subInputLabel, subInput);

        const subtaskTotal = assignment.subtasks.reduce((sum, subtask) => sum + (Number(subtask.hours) || 0), 0);
        if (subtaskTotal > assignment.hours) {
          const warning = document.createElement('div');
          warning.className = 'inline-warning';
          warning.textContent = `Subtasks total ${formatHours(subtaskTotal)} hrs, above the ${formatHours(assignment.hours)} project total.`;
          row.append(top, responseRow, warning, subInputRow, subList);
        } else {
          row.append(top, responseRow, subInputRow, subList);
        }
        dropzone.appendChild(row);
      });

      card.append(headerRow, gaugeLabel, gauge, assignmentControls, dropzone);
      employeesListEl.appendChild(card);
    });
  });
}

/* -------------------------------------------------------
   Assignment helpers (UI wrappers)
------------------------------------------------------- */
export function addAssignment(weekKey, empId, jobId) {
  if (!data.employees.some(employee => employee.id === empId)
    || !data.jobs.some(job => job.id === jobId)) return;
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
  if (!divider || !leftCol || !rightCol || window.matchMedia('(max-width: 900px)').matches) return;
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

function createEmptyState(title, description) {
  const wrapper = document.createElement('div');
  wrapper.className = 'empty-state';
  const heading = document.createElement('strong');
  heading.textContent = title;
  const body = document.createElement('span');
  body.textContent = description;
  wrapper.append(heading, body);
  return wrapper;
}

function formatHours(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function createMetaChip(label, className) {
  const chip = document.createElement('span');
  chip.className = `planner-meta-chip ${className}`;
  chip.textContent = label;
  return chip;
}

function makeKeyboardClickable(element, action) {
  element.setAttribute('role', 'button');
  element.tabIndex = 0;
  element.addEventListener('click', action);
  element.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    action();
  });
}
