// ---------- Constants ----------
const DEFAULT_COLOR = '#03bafc';
const DEFAULT_DISTRICT = 'Electrical';

// Palette for auto-color selection (#2)
const COLOR_PALETTE = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#d97706', '#7c3aed',
  '#059669', '#dc2626', '#2563eb', '#db2777', '#0891b2'
];

// ---------- Basic helpers ----------

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekKey(date) {
  return formatDate(startOfWeek(date));
}

// ---------- Auto-color helper (#2) ----------

function pickUnusedColor() {
  const usedColors = new Set(data.jobs.map(j => (j.color || '').toLowerCase()));
  for (const c of COLOR_PALETTE) {
    if (!usedColors.has(c.toLowerCase())) return c;
  }
  // All palette colors used — pick a random one
  return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
}

// ---------- Main data model ----------

const data = {
  employees: [],
  jobs: [],
  assignments: {},
  currentWeekStart: startOfWeek(new Date())
};

// ---------- DOM references ----------
const weekLabelEl         = document.getElementById('weekLabel');
const jobsListEl          = document.getElementById('jobsList');
const employeesListEl     = document.getElementById('employeesList');
const chartHeaderLineEl   = document.getElementById('chartHeaderLine');
const chartLegendEl       = document.getElementById('chartLegend');
const projectChartCanvas  = document.getElementById('projectChart');
const burnDownChartCanvas = document.getElementById('burnDownChart');

// ---------- Dark mode (#1) ----------

const darkModeToggle = document.getElementById('darkModeToggle');
const settingsBtn    = document.getElementById('settingsBtn');
const settingsMenu   = document.getElementById('settingsMenu');

// Restore saved preference
const savedTheme = localStorage.getItem('planner-theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
if (savedTheme === 'dark') darkModeToggle.checked = true;

darkModeToggle.addEventListener('change', () => {
  const theme = darkModeToggle.checked ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('planner-theme', theme);
  // Re-draw chart so canvas colors update
  forceChartUpdate();
});

settingsBtn.addEventListener('click', e => {
  e.stopPropagation();
  settingsMenu.classList.toggle('hidden');
});

document.addEventListener('click', e => {
  if (!settingsMenu.contains(e.target) && e.target !== settingsBtn) {
    settingsMenu.classList.add('hidden');
  }
});

// ---------- Week helpers ----------

function getCurrentWeekKey() {
  return getWeekKey(data.currentWeekStart);
}

function getAssignmentsForWeek(weekKey) {
  if (!data.assignments[weekKey]) data.assignments[weekKey] = {};
  return data.assignments[weekKey];
}

function getEmployeeAssignmentsForWeek(weekKey, employeeId) {
  const week = getAssignmentsForWeek(weekKey);
  if (!week[employeeId]) week[employeeId] = {};
  return week[employeeId];
}

// ---------- File Menu ----------

const fileBtn = document.getElementById("fileBtn");
const fileMenu = document.getElementById("fileMenu");

fileBtn.addEventListener("click", e => {
    e.stopPropagation();
    fileMenu.classList.toggle("hidden");
});

// Close when clicking outside
document.addEventListener("click", e => {
    if (!fileMenu.contains(e.target) && e.target !== fileBtn) {
        fileMenu.classList.add("hidden");
    }
});


// ---------- Hours calculations ----------

function totalHoursForEmployeeWeek(weekKey, employeeId) {
  const empAssignments = getEmployeeAssignmentsForWeek(weekKey, employeeId);
  let sum = 0;
  Object.values(empAssignments).forEach(a => { sum += (a.hours || 0); });
  return sum;
}

function totalHoursAllEmployees(weekKey) {
  return data.employees.reduce((sum, emp) => {
    return sum + totalHoursForEmployeeWeek(weekKey, emp.id);
  }, 0);
}

function totalEmployeeCapacity() {
  return data.employees.reduce((sum, emp) => sum + (emp.weeklyBudget || 0), 0);
}

// ---------- Rendering helpers ----------

function forceChartUpdate() {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      renderProjectChart();
      renderBurnDownChart();
    });
  } else {
    setTimeout(() => {
      renderProjectChart();
      renderBurnDownChart();
    }, 30);
  }
}

function renderWeekLabel() {
  const start = data.currentWeekStart;
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  weekLabelEl.textContent = `${formatDate(start)} to ${formatDate(end)}`;
}

// ---------- Jobs rendering ----------

function renderJobs() {
  jobsListEl.innerHTML = '';
  const categories    = ['Active', 'Upcoming', 'Complete', 'Other'];
  const subCategories = ['Electrical', 'Instrumentation', 'Other'];

  categories.forEach(cat => {
    const section = document.createElement('div');
    section.className = 'job-category-section';

    const header = document.createElement('div');
    header.className = 'job-category-header';
    header.textContent = cat;
    header.onclick = () => section.classList.toggle('collapsed');

    const list = document.createElement('div');
    list.className = 'job-category-list';

    const jobsInCat = data.jobs.filter(j => j.category === cat);
    jobsInCat.forEach(job => {
      const div = document.createElement('div');
      div.className = 'item';
      div.draggable = true;
      div.dataset.jobId = job.id;

      // Apply collapsed state if stored (#5)
      if (job.collapsed) {
        div.classList.add('job-collapsed');
      }

      // Top row
      const headerRow = document.createElement('div');
      headerRow.className = 'item-header-row';

      const colorBox = document.createElement('div');
      colorBox.className = 'legend-color';
      colorBox.style.background = job.color || DEFAULT_COLOR;

      const span = document.createElement('span');
      span.textContent = job.name;

      // Job-level color picker — syncs subtasks that haven't been individually customized
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = job.color || DEFAULT_COLOR;
      colorInput.onchange = () => {
        const oldColor = (job.color || DEFAULT_COLOR).toLowerCase();
        job.color = colorInput.value;
        colorBox.style.background = colorInput.value;
        // Only sync subtasks whose color still matches the OLD job color
        // (i.e. they were never individually customized)
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
      };

      // Toggle button
      const collapseBtn = document.createElement('button');
      collapseBtn.textContent = 'Toggle';
      collapseBtn.onclick = () => {
        job.collapsed = !job.collapsed;
        div.classList.toggle('job-collapsed');
      };

      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'X';
      removeBtn.onclick = () => { removeJob(job.id); };

      // Hours budget input
      const budgetLabel = document.createElement('span');
      budgetLabel.style.cssText = 'font-size:11px;color:var(--text-muted);white-space:nowrap;';
      budgetLabel.textContent = 'Hrs:';

      const budgetInput = document.createElement('input');
      budgetInput.type  = 'number';
      budgetInput.min   = '0';
      budgetInput.step  = '1';
      budgetInput.value = job.hoursBudget || 0;
      budgetInput.style.cssText = 'width:52px;';
      budgetInput.title = 'Total hours budget for this job';
      budgetInput.onchange = () => {
        job.hoursBudget = parseFloat(budgetInput.value) || 0;
        forceChartUpdate();
      };

      //Add drag handle
      const dragHandle = document.createElement("div");
      dragHandle.className = "job-drag-handle";
      
      // Prevent handle from blocking dragstart on the parent
      dragHandle.addEventListener("mousedown", e => {
          // Allow drag to start from the parent div
          e.stopPropagation();
      });
      
      headerRow.appendChild(dragHandle);
      headerRow.appendChild(colorBox);
      headerRow.appendChild(span);

      headerRow.appendChild(colorInput);
      headerRow.appendChild(categorySelect);
      headerRow.appendChild(budgetLabel);
      headerRow.appendChild(budgetInput);
      headerRow.appendChild(collapseBtn);
      headerRow.appendChild(removeBtn);
      div.appendChild(headerRow);

      // Subtasks container
      const subtasksContainer = document.createElement('div');
      subtasksContainer.className = 'job-subtasks';

      subCategories.forEach(subCat => {
        const catBlock = document.createElement('div');
        catBlock.className = 'job-subtask-category';
        if (job.subtaskGroupCollapsed && job.subtaskGroupCollapsed[subCat]) {
          catBlock.classList.add('collapsed');
        }

        const catHeader = document.createElement('div');
        catHeader.className = 'job-subtask-category-header';
        catHeader.textContent = subCat;
        catHeader.onclick = () => {
          catBlock.classList.toggle('collapsed');
          // Persist collapsed state
          job.subtaskGroupCollapsed = job.subtaskGroupCollapsed || {};
          job.subtaskGroupCollapsed[subCat] = catBlock.classList.contains('collapsed');
        };

        const items = document.createElement('div');
        items.className = 'job-subtask-items';

        const jobSubtasks = job.subtasks || [];

        jobSubtasks
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
                color: st.color || job.color || DEFAULT_COLOR  // carry subtask's own color
              };
              e.dataTransfer.setData('application/json', JSON.stringify(payload));
            });

            const dot = document.createElement('span');
            dot.className = 'job-subtask-dot';
            dot.textContent = '•';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'job-subtask-name';
            nameSpan.textContent = st.name;

            // Clickable color swatch — clicking it opens the hidden color picker
            const stColorPicker = document.createElement('input');
            stColorPicker.type = 'color';
            stColorPicker.value = st.color || job.color || DEFAULT_COLOR;
            stColorPicker.style.cssText = 'position:absolute;opacity:0;width:0;height:0;pointer-events:none;';
            stColorPicker.onchange = () => {
              st.color = stColorPicker.value;
              colorDot.style.background = stColorPicker.value;
              renderEmployees();
              forceChartUpdate();
            };

            const colorDot = document.createElement('span');
            colorDot.style.cssText = `
              display:inline-block;width:12px;height:12px;
              border-radius:50%;background:${st.color || job.color || DEFAULT_COLOR};
              flex-shrink:0;cursor:pointer;border:1px solid rgba(0,0,0,0.2);
              position:relative;
            `;
            colorDot.title = 'Click to change subtask color';
            colorDot.appendChild(stColorPicker);
            colorDot.addEventListener('click', e => {
              e.stopPropagation();
              stColorPicker.click();
            });

            const delBtn = document.createElement('button');
            delBtn.textContent = 'X';
            delBtn.onclick = () => {
              const index = jobSubtasks.indexOf(st);
              if (index >= 0) jobSubtasks.splice(index, 1);
              renderJobs();
            };

            row.appendChild(dot);
            row.appendChild(nameSpan);
            row.appendChild(colorDot);
            row.appendChild(delBtn);
            items.appendChild(row);
          });

        // Add-subtask row — hidden when group is collapsed
        const addRow = document.createElement('div');
        addRow.className = 'job-subtask-add';

        const nameInput = document.createElement('input');
        nameInput.placeholder = 'Subtask name';

        // Color picker for new subtasks 
        const addColorInput = document.createElement('input');
        addColorInput.type = 'color';
        addColorInput.value = job.color || DEFAULT_COLOR;
        addColorInput.style.display = "none"; // hides it


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
          addColorInput.value = job.color || DEFAULT_COLOR; // reset to job color
          renderJobs();
        };

        addRow.appendChild(nameInput);
        addRow.appendChild(addColorInput);
        addRow.appendChild(addBtn);

        catBlock.appendChild(catHeader);
        catBlock.appendChild(items);
        catBlock.appendChild(addRow);
        subtasksContainer.appendChild(catBlock);
      });

      div.appendChild(subtasksContainer);

      // Drag events for reordering jobs
      div.addEventListener('dragstart', e => {
        // Only fire for the job div itself, not subtask rows
        if (e.target !== div && e.target.classList.contains('job-subtask-row')) return;
        e.dataTransfer.setData('text/plain', job.id);
        e.dataTransfer.setData(
          'application/json',
          JSON.stringify({ kind: 'job', jobId: job.id })
        );
      });
      div.addEventListener('dragover', e => e.preventDefault());
      div.addEventListener('drop', e => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('text/plain');
        reorderJob(draggedId, job.id, cat);
      });

      list.appendChild(div);
    });

    section.appendChild(header);
    section.appendChild(list);
    jobsListEl.appendChild(section);
  });
}

function reorderJob(dragId, targetId, category) {
  const jobsInCategory = data.jobs.filter(j => j.category === category);
  const dragIndex   = jobsInCategory.findIndex(j => j.id === dragId);
  const targetIndex = jobsInCategory.findIndex(j => j.id === targetId);
  if (dragIndex === -1 || targetIndex === -1) return;
  const [moved] = jobsInCategory.splice(dragIndex, 1);
  jobsInCategory.splice(targetIndex, 0, moved);
  const others = data.jobs.filter(j => j.category !== category);
  data.jobs = [...others, ...jobsInCategory];
  renderJobs();
}

// ---------- Employees rendering ----------

function renderEmployees() {
  employeesListEl.innerHTML = '';
  const weekKey  = getCurrentWeekKey();
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
      districtSpan.className = 'employee-district';
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
      };
      districtSpan.appendChild(districtSelect);

      const total = totalHoursForEmployeeWeek(weekKey, emp.id);

      const budgetSpan = document.createElement('span');
      budgetSpan.className = 'employee-budget';
      budgetSpan.textContent = `Allocated: ${total}/${emp.weeklyBudget} hrs`;

      // Toggle hides gauge, gauge-label, dropzone via CSS (#5 / employee side)
      const toggleBtn = document.createElement('button');
      toggleBtn.textContent = 'Toggle';
      toggleBtn.onclick = () => {
        emp.collapsed = !emp.collapsed;
        card.classList.toggle('collapsed');
      };

      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.onclick = () => removeEmployee(emp.id);

      headerRow.appendChild(nameSpan);
      headerRow.appendChild(districtSpan);
      headerRow.appendChild(budgetSpan);
      headerRow.appendChild(toggleBtn);
      headerRow.appendChild(removeBtn);

      const gaugeLabel = document.createElement('div');
      gaugeLabel.className = 'gauge-label';
      const pct = emp.weeklyBudget > 0 ? Math.round((total / emp.weeklyBudget) * 100) : 0;
      gaugeLabel.textContent = `Usage: ${pct}%`;

      const gauge = document.createElement('div');
      gauge.className = 'gauge';
      if (pct > 100) gauge.classList.add('over-budget');

      const empAssignments = getEmployeeAssignmentsForWeek(weekKey, emp.id);

      // Scale the bar against whichever is larger: actual hours worked OR the budget.
      // This ensures over-budget hours are never clipped by the bar's width.
      const gaugeMax = Math.max(total, emp.weeklyBudget > 0 ? emp.weeklyBudget : 0, 1);
      let offset = 0;

      Object.entries(empAssignments).forEach(([jobId, a]) => {
        const parentHours = a.hours || 0;
        if (parentHours <= 0) return;

        const job       = data.jobs.find(j => j.id === jobId);
        const baseColor = job && job.color ? job.color : DEFAULT_COLOR;

        const parentPctOfTotal = (parentHours / gaugeMax) * 100;
        const subtasks         = a.subtasks || [];
        const totalSubHours    = subtasks.reduce((s, sub) => s + (sub.hours || 0), 0);

        if (subtasks.length === 0 || totalSubHours <= 0) {
          const fill = document.createElement('div');
          fill.className = 'gauge-fill';
          fill.style.left       = offset + '%';
          fill.style.width      = parentPctOfTotal + '%';
          fill.style.background = baseColor;
          gauge.appendChild(fill);
          offset += parentPctOfTotal;
          return;
        }

        const scale = totalSubHours > parentHours ? (parentHours / totalSubHours) : 1;
        let usedParentHours = 0;

        subtasks.forEach(sub => {
          const rawSubHours       = sub.hours || 0;
          if (rawSubHours <= 0) return;
          const effectiveSubHours = rawSubHours * scale;
          usedParentHours += effectiveSubHours;
          const subPctOfTotal     = (effectiveSubHours / gaugeMax) * 100;

          const fill = document.createElement('div');
          fill.className = 'gauge-fill';
          fill.style.left       = offset + '%';
          fill.style.width      = subPctOfTotal + '%';
          fill.style.background = sub.color || baseColor;
          gauge.appendChild(fill);
          offset += subPctOfTotal;
        });

        const remainingParentHours = Math.max(0, parentHours - usedParentHours);
        if (remainingParentHours > 0) {
          const remainingPctOfTotal = (remainingParentHours / gaugeMax) * 100;
          const fill = document.createElement('div');
          fill.className = 'gauge-fill';
          fill.style.left       = offset + '%';
          fill.style.width      = remainingPctOfTotal + '%';
          fill.style.background = baseColor;
          gauge.appendChild(fill);
          offset += remainingPctOfTotal;
        }
      });

      // Gray unutilized block — only shown when total hours < budget
      const unutilizedHours = Math.max(0, emp.weeklyBudget - total);
      if (unutilizedHours > 0) {
        const unutilizedPct = (unutilizedHours / gaugeMax) * 100;
        const fill = document.createElement('div');
        fill.className = 'gauge-fill';
        fill.style.left       = offset + '%';
        fill.style.width      = unutilizedPct + '%';
        fill.style.background = '#9ca3af';
        gauge.appendChild(fill);
      }

      // Budget marker — thin white tick showing the budget ceiling when hours exceed it
      if (emp.weeklyBudget > 0 && total > emp.weeklyBudget) {
        const markerPct = (emp.weeklyBudget / gaugeMax) * 100;
        const marker = document.createElement('div');
        marker.style.cssText = `
          position:absolute;top:0;bottom:0;
          left:${markerPct}%;
          width:2px;
          background:rgba(255,255,255,0.85);
          z-index:2;
          pointer-events:none;
        `;
        marker.title = `Budget: ${emp.weeklyBudget}h`;
        gauge.appendChild(marker);
      }

      // ---------- Dropzone ----------

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
          try { payload = JSON.parse(json); } catch { payload = null; }
        }

        if (!payload) {
          const jobId = e.dataTransfer.getData('text/plain');
          if (jobId) addAssignment(weekKey, emp.id, jobId);
          return;
        }

        if (payload.kind === 'job') {
          addAssignment(weekKey, emp.id, payload.jobId);
          return;
        }

        // Subtask drop (#3): create job assignment with ONLY this one subtask
        if (payload.kind === 'subtask') {
          const { jobId, subtaskId, name, category, color } = payload;
          const empAssignments = getEmployeeAssignmentsForWeek(weekKey, emp.id);

          if (!empAssignments[jobId]) {
            // Create a fresh assignment with NO subtasks (empty array)
            empAssignments[jobId] = { hours: 0, subtasks: [] };
          }

          const assignment = empAssignments[jobId];

          // Add only the dropped subtask if not already present
          const alreadyExists = subtaskId
            ? assignment.subtasks.some(s => s.sourceId === subtaskId)
            : assignment.subtasks.some(s => s.name === name && s.category === category);

          if (!alreadyExists) {
            assignment.subtasks.push({
              sourceId: subtaskId || null,
              name,
              category,
              color, // job color, not a custom color
              hours: 0
            });
          }

          renderEmployees();
          forceChartUpdate();
        }
      });

      // ---------- Assignment rows ----------

      Object.keys(empAssignments).forEach(jobId => {
        const job = data.jobs.find(j => j.id === jobId);
        if (!job) return;

        const assignment = empAssignments[jobId];

        const row = document.createElement('div');
        row.className = 'assignment';

        // Color-coded left border matching the job color
        row.style.borderLeftColor = job.color || DEFAULT_COLOR;

        const top = document.createElement('div');
        top.className = 'assignment-top';

        const label = document.createElement('span');
        label.textContent = job.name;

        const hoursInput = document.createElement('input');
        hoursInput.type  = 'number';
        hoursInput.min   = '0';
        hoursInput.step  = '0.25';
        hoursInput.value = assignment.hours || 0;
        hoursInput.onchange = () => {
          updateAssignmentHours(weekKey, emp.id, jobId, parseFloat(hoursInput.value) || 0);
        };

        const removeAssignBtn = document.createElement('button');
        removeAssignBtn.textContent = 'X';
        removeAssignBtn.onclick = () => removeAssignment(weekKey, emp.id, jobId);

        top.appendChild(label);
        top.appendChild(hoursInput);
        top.appendChild(removeAssignBtn);

        // Subtask list
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
          subHours.type  = 'number';
          subHours.min   = '0';
          subHours.step  = '0.25';
          subHours.value = sub.hours || 0;
          subHours.onchange = () => {
            sub.hours = parseFloat(subHours.value) || 0;
            renderEmployees();
            forceChartUpdate();
          };

          // Only manually-added employee subtasks get a color picker (#7).
          // Dragged-from-job subtasks have a sourceId — show a swatch only.
          let colorEl;
          if (!sub.sourceId) {
            // Manually added in employee — allow color change
            colorEl = document.createElement('input');
            colorEl.type  = 'color';
            colorEl.value = sub.color || (job.color || DEFAULT_COLOR);
            colorEl.onchange = () => {
              sub.color = colorEl.value;
              renderEmployees();
              forceChartUpdate();
            };
          } else {
            // Dragged from job — show read-only color swatch
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
          };

          subRow.appendChild(dot);
          subRow.appendChild(subName);
          subRow.appendChild(subHours);
          subRow.appendChild(colorEl);
          subRow.appendChild(del);
          subList.appendChild(subRow);
        });

        // Subtask input row for manually adding subtasks to an employee assignment
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
            // Manually added — no sourceId, gets a color picker (#7)
            assignment.subtasks.push({
              name: subInput.value.trim(),
              hours: 0,
              color: job.color || DEFAULT_COLOR
              // sourceId intentionally absent
            });
            subInput.value = '';
            renderEmployees();
            forceChartUpdate();
          }
        };

        subInputRow.appendChild(subInputLabel);
        subInputRow.appendChild(subInput);

        row.appendChild(top);
        row.appendChild(subInputRow);
        row.appendChild(subList);
        dropzone.appendChild(row);
      });

      card.appendChild(headerRow);
      card.appendChild(gaugeLabel);
      card.appendChild(gauge);
      card.appendChild(dropzone);
      employeesListEl.appendChild(card);
    });
  });
}

// ---------- Project chart rendering ----------

function renderProjectChart() {
  const weekKey = getCurrentWeekKey();
  const canvas  = projectChartCanvas;
  const ctx     = canvas.getContext('2d');

  canvas.width  = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  // Detect dark mode for chart text color
  const isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#d1d5db' : '#000000';
  const bgColor   = isDark ? '#1f2937' : '#ffffff';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const week           = getAssignmentsForWeek(weekKey);
  const projectTotals  = {};
  const projectEmployees = {};

  Object.entries(week).forEach(([empId, empAssignments]) => {
    Object.entries(empAssignments).forEach(([jobId, a]) => {
      const parentHours = a.hours || 0;
      if (parentHours < 0.0001) return;
      projectTotals[jobId] = (projectTotals[jobId] || 0) + parentHours;
      if (!projectEmployees[jobId]) projectEmployees[jobId] = new Set();
      projectEmployees[jobId].add(empId);
    });
  });

  const usedHours        = totalHoursAllEmployees(weekKey);
  const capacity         = totalEmployeeCapacity();
  const unutilizedHours  = Math.max(0, capacity - usedHours);
  const utilizationPct   = capacity > 0 ? Math.round((usedHours / capacity) * 100) : 0;
  chartHeaderLineEl.textContent = `Utilization: ${usedHours}/${capacity} - ${utilizationPct}%`;

  if (unutilizedHours > 0) {
    projectTotals['__unutilized__'] = unutilizedHours;
  }

  chartLegendEl.innerHTML = '';
  Object.entries(projectTotals).forEach(([jobId, hours]) => {
    const legendItem = document.createElement('div');
    legendItem.className = 'legend-item';

    const colorBox = document.createElement('div');
    colorBox.className = 'legend-color';

    let labelText = '';
    if (jobId === '__unutilized__') {
      colorBox.style.background = '#9ca3af';
      labelText = `Unutilized: ${hours} hrs`;
    } else {
      const job = data.jobs.find(j => j.id === jobId);
      if (!job) return;
      colorBox.style.background = job.color || DEFAULT_COLOR;
      const empCount = projectEmployees[jobId] ? projectEmployees[jobId].size : 0;
      labelText = `${job.name}: ${hours} hrs (${empCount} employee${empCount === 1 ? '' : 's'})`;
    }

    const label = document.createElement('span');
    label.textContent = labelText;
    legendItem.appendChild(colorBox);
    legendItem.appendChild(label);
    chartLegendEl.appendChild(legendItem);
  });

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const jobIds = Object.keys(projectTotals);
  if (jobIds.length === 0) return;

  const width        = canvas.width;
  const height       = canvas.height;
  const max          = Math.max(...Object.values(projectTotals), 1);
  const barWidth     = Math.max(30, Math.min(60, (width - 80) / jobIds.length - 20));
  const gap          = 20;
  const bottomMargin = 30;
  const topMargin    = 30;
  const chartHeight  = height - bottomMargin - topMargin;

  ctx.font          = '11px Arial';
  ctx.textBaseline  = 'middle';

  jobIds.forEach((jobId, index) => {
    const hours     = projectTotals[jobId];
    const x         = 40 + index * (barWidth + gap);
    const barHeight = (hours / max) * chartHeight;
    const y         = height - bottomMargin - barHeight;

    let color = DEFAULT_COLOR;
    let name  = '';

    if (jobId === '__unutilized__') {
      color = '#9ca3af';
      name  = 'Unutilized';
    } else {
      const job = data.jobs.find(j => j.id === jobId);
      if (!job) return;
      color = job.color || DEFAULT_COLOR;
      name  = job.name;
    }

    ctx.fillStyle = color;
    ctx.fillRect(x, y, barWidth, barHeight);

    const capForPct         = totalEmployeeCapacity();
    const percentOfWorkload = capForPct > 0 ? Math.round((hours / capForPct) * 100) : 0;
    ctx.fillStyle   = textColor;
    ctx.textAlign   = 'center';
    ctx.fillText(`${hours}h (${percentOfWorkload}%)`, x + barWidth / 2, y - 10);

    ctx.save();
    ctx.translate(x + barWidth / 2, height - bottomMargin + 12);
    ctx.rotate(-Math.PI / 4);
    ctx.fillText(name, 0, 0);
    ctx.restore();
  });
}

// ---------- Hours Budget burn-down chart ----------

function totalHoursChargedToJobInWeek(jobId, weekKey) {
  const week = data.assignments[weekKey] || {};
  let total = 0;
  Object.values(week).forEach(empAssignments => {
    const a = empAssignments[jobId];
    if (a) total += (a.hours || 0);
  });
  return total;
}

function getWeekKeysForJob(jobId) {
  const keys = new Set();
  Object.entries(data.assignments).forEach(([weekKey, week]) => {
    Object.values(week).forEach(empAssignments => {
      if (empAssignments[jobId] && (empAssignments[jobId].hours || 0) > 0) {
        keys.add(weekKey);
      }
    });
  });
  return Array.from(keys).sort();
}

function renderBurnDownChart() {
  const canvas = burnDownChartCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  canvas.width  = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  const isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#d1d5db' : '#111827';
  const bgColor   = isDark ? '#1f2937' : '#ffffff';
  const gridColor = isDark ? '#374151' : '#e5e7eb';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Only show jobs that have a budget set (> 0)
  const budgetedJobs = data.jobs.filter(j => (j.hoursBudget || 0) > 0);
  if (budgetedJobs.length === 0) {
    ctx.fillStyle = textColor;
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Set an Hours Budget on a job to see the burn-down chart.', canvas.width / 2, canvas.height / 2);
    return;
  }

  const width        = canvas.width;
  const height       = canvas.height;
  const leftMargin   = 50;
  const rightMargin  = 16;
  const topMargin    = 24;
  const bottomMargin = 48;
  const chartW       = width - leftMargin - rightMargin;
  const chartH       = height - topMargin - bottomMargin;

  // Collect all weeks that any budgeted job has charges on, plus current week
  const allWeeks = new Set([getCurrentWeekKey()]);
  budgetedJobs.forEach(job => {
    getWeekKeysForJob(job.id).forEach(w => allWeeks.add(w));
  });
  const sortedWeeks = Array.from(allWeeks).sort();

  // Build burn-down lines per job
  const jobLines = budgetedJobs.map(job => {
    const weekKeys = getWeekKeysForJob(job.id);
    const firstChargeWeek = weekKeys.length > 0 ? weekKeys[0] : null;

    let remaining = job.hoursBudget;
    const points = [];

    sortedWeeks.forEach((wk, i) => {
      if (!firstChargeWeek || wk < firstChargeWeek) return;
      const charged = totalHoursChargedToJobInWeek(job.id, wk);
      remaining = Math.max(0, remaining - charged);
      points.push({ weekIndex: i, remaining });
    });

    return { job, points };
  }).filter(l => l.points.length > 0);

  const maxBudget = Math.max(...budgetedJobs.map(j => j.hoursBudget), 1);

  // Grid lines
  const gridLines = 5;
  ctx.lineWidth   = 1;
  ctx.font        = '10px Arial';

  for (let i = 0; i <= gridLines; i++) {
    const val = Math.round((maxBudget / gridLines) * i);
    const y   = topMargin + chartH - (val / maxBudget) * chartH;
    ctx.strokeStyle = gridColor;
    ctx.beginPath();
    ctx.moveTo(leftMargin, y);
    ctx.lineTo(leftMargin + chartW, y);
    ctx.stroke();
    ctx.fillStyle    = textColor;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(val + 'h', leftMargin - 6, y);
  }

  // X axis labels
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  const maxLabels = Math.floor(chartW / 60);
  const step      = Math.max(1, Math.ceil(sortedWeeks.length / maxLabels));

  sortedWeeks.forEach((wk, i) => {
    if (i % step !== 0 && i !== sortedWeeks.length - 1) return;
    const x = leftMargin + (i / Math.max(sortedWeeks.length - 1, 1)) * chartW;
    const parts = wk.split('-');
    ctx.fillStyle = textColor;
    ctx.fillText(`${parts[1]}/${parts[2]}`, x, topMargin + chartH + 6);
    ctx.strokeStyle = gridColor;
    ctx.beginPath();
    ctx.moveTo(x, topMargin + chartH);
    ctx.lineTo(x, topMargin + chartH + 4);
    ctx.stroke();
  });

  // Current week dashed marker
  const currentWkIdx = sortedWeeks.indexOf(getCurrentWeekKey());
  if (currentWkIdx >= 0) {
    const cx = leftMargin + (currentWkIdx / Math.max(sortedWeeks.length - 1, 1)) * chartW;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = isDark ? '#6b7280' : '#9ca3af';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(cx, topMargin);
    ctx.lineTo(cx, topMargin + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw burn-down lines
  if (jobLines.length === 0) {
    ctx.fillStyle    = textColor;
    ctx.font         = '12px Arial';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No hours charged to budgeted jobs yet.', canvas.width / 2, canvas.height / 2);
    return;
  }

  jobLines.forEach(({ job, points }) => {
    if (points.length === 0) return;
    const color = job.color || DEFAULT_COLOR;

    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = 'round';
    ctx.beginPath();

    points.forEach((pt, i) => {
      const x = leftMargin + (pt.weekIndex / Math.max(sortedWeeks.length - 1, 1)) * chartW;
      const y = topMargin + chartH - (pt.remaining / maxBudget) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else         ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Dot at last point
    const last = points[points.length - 1];
    const lx = leftMargin + (last.weekIndex / Math.max(sortedWeeks.length - 1, 1)) * chartW;
    const ly = topMargin + chartH - (last.remaining / maxBudget) * chartH;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.fill();

    // End label
    ctx.fillStyle    = color;
    ctx.font         = 'bold 10px Arial';
    ctx.textAlign    = lx > leftMargin + chartW * 0.75 ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${job.name} (${last.remaining}h left)`, lx + (ctx.textAlign === 'left' ? 8 : -8), ly);
  });
}

// ---------- Data helpers ----------

function removeJobFromAssignments(jobId) {
  Object.values(data.assignments).forEach(week => {
    Object.values(week).forEach(empAssignments => {
      if (empAssignments[jobId]) delete empAssignments[jobId];
    });
  });
}

function removeEmployeeFromAssignments(empId) {
  Object.values(data.assignments).forEach(week => {
    if (week[empId]) delete week[empId];
  });
}

function ensureAssignment(weekKey, empId, jobId) {
  const empAssignments = getEmployeeAssignmentsForWeek(weekKey, empId);
  if (!empAssignments[jobId]) {
    const job      = data.jobs.find(j => j.id === jobId);
    const emp      = data.employees.find(e => e.id === empId);
    const district = emp?.district || DEFAULT_DISTRICT;
    empAssignments[jobId] = {
      hours: 0,
      subtasks: job ? deepCopySubtasksTemplate(job, district) : []
    };
  }
  return empAssignments[jobId];
}

function clearInputs(...ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

// ---------- Data operations ----------

function addJob(name, category, color) {
  if (!name.trim()) return;
  // Use provided color, or auto-pick an unused one (#2)
  const resolvedColor = color || pickUnusedColor();
  data.jobs.push({
    id: uuid(),
    name: name.trim(),
    category,
    color: resolvedColor,
    subtasks: [],
    collapsed: false,
    subtaskGroupCollapsed: {},
    hoursBudget: 0    // Total hours budget for this job; 0 = no budget set
  });
  renderJobs();
  forceChartUpdate();
}

function removeJob(jobId) {
  data.jobs = data.jobs.filter(j => j.id !== jobId);
  removeJobFromAssignments(jobId);
  renderAll();
  forceChartUpdate();
}

function addEmployee(name, weeklyBudget, district) {
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
}

function removeEmployee(empId) {
  data.employees = data.employees.filter(e => e.id !== empId);
  removeEmployeeFromAssignments(empId);
  renderEmployees();
  forceChartUpdate();
}

function deepCopySubtasksTemplate(job, district) {
  const subtasks = job.subtasks || [];
  return subtasks
    .filter(st => {
      if (district === 'Flex') return true;
      return st.category === district;
    })
    .map(st => ({
      sourceId: st.id || null,
      name: st.name,
      hours: 0,
      color: st.color || job.color || DEFAULT_COLOR,
      category: st.category || 'Other'
    }));
}

function addAssignment(weekKey, empId, jobId) {
  ensureAssignment(weekKey, empId, jobId);
  renderEmployees();
  forceChartUpdate();
}

function updateAssignmentHours(weekKey, empId, jobId, hours) {
  const assignment = ensureAssignment(weekKey, empId, jobId);
  assignment.hours = hours;
  renderEmployees();
  forceChartUpdate();
}

function removeAssignment(weekKey, empId, jobId) {
  const empAssignments = getEmployeeAssignmentsForWeek(weekKey, empId);
  if (empAssignments[jobId]) delete empAssignments[jobId];
  renderEmployees();
  forceChartUpdate();
}

// ---------- Week navigation ----------

document.getElementById('prevWeekBtn').addEventListener('click', () => {
  data.currentWeekStart.setDate(data.currentWeekStart.getDate() - 7);
  renderAll();
});

document.getElementById('nextWeekBtn').addEventListener('click', () => {
  data.currentWeekStart.setDate(data.currentWeekStart.getDate() + 7);
  renderAll();
});

document.getElementById('jumpToPresentBtn').addEventListener('click', () => {
  data.currentWeekStart = startOfWeek(new Date());
  renderAll();
});

// ---------- Auto-color: update color picker when typing a job name (#2) ----------

document.getElementById('jobNameInput').addEventListener('input', () => {
  // Only auto-update the color input if it still matches the previous suggestion
  // (i.e., the user hasn't manually picked a color yet)
  const colorInput = document.getElementById('jobColorInput');
  if (!colorInput.dataset.userPicked) {
    colorInput.value = pickUnusedColor();
  }
});

document.getElementById('jobColorInput').addEventListener('input', () => {
  // Mark as user-picked so we stop auto-suggesting
  document.getElementById('jobColorInput').dataset.userPicked = '1';
});

// Reset user-picked flag after a job is added
function resetColorPicker() {
  const colorInput = document.getElementById('jobColorInput');
  colorInput.dataset.userPicked = '';
  colorInput.value = pickUnusedColor();
}

// ---------- Add job / employee events ----------

document.getElementById('addJobBtn').addEventListener('click', () => {
  const nameInput     = document.getElementById('jobNameInput');
  const categoryInput = document.getElementById('jobCategoryInput');
  const colorInput    = document.getElementById('jobColorInput');
  addJob(nameInput.value, categoryInput.value, colorInput.value);
  clearInputs('jobNameInput');
  resetColorPicker();
});

document.getElementById('jobNameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const nameInput     = document.getElementById('jobNameInput');
    const categoryInput = document.getElementById('jobCategoryInput');
    const colorInput    = document.getElementById('jobColorInput');
    addJob(nameInput.value, categoryInput.value, colorInput.value);
    clearInputs('jobNameInput');
    resetColorPicker();
  }
});

document.getElementById('addEmployeeBtn').addEventListener('click', () => {
  const nameInput     = document.getElementById('employeeNameInput');
  const budgetInput   = document.getElementById('employeeBudgetInput');
  const districtInput = document.getElementById('employeeDistrictInput');
  addEmployee(nameInput.value, budgetInput.value, districtInput.value);
  clearInputs('employeeNameInput', 'employeeBudgetInput');
});

document.getElementById('employeeNameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const nameInput     = document.getElementById('employeeNameInput');
    const budgetInput   = document.getElementById('employeeBudgetInput');
    const districtInput = document.getElementById('employeeDistrictInput');
    addEmployee(nameInput.value, budgetInput.value, districtInput.value);
    clearInputs('employeeNameInput', 'employeeBudgetInput');
  }
});

// ---------- Toast helper ----------

function showToast(msg, duration = 2500) {
  const toast = document.getElementById('plannerToast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ---------- Auto-save to localStorage ----------

const STORAGE_KEY = 'planner-data-v1';
let autoSaveTimer = null;

function saveToLocalStorage() {
  try {
    const snapshot = {
      employees:        JSON.parse(JSON.stringify(data.employees)),
      jobs:             JSON.parse(JSON.stringify(data.jobs)),
      assignments:      JSON.parse(JSON.stringify(data.assignments)),
      currentWeekStart: data.currentWeekStart.toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));

    // Flash the auto-save indicator
    const indicator = document.getElementById('autoSaveIndicator');
    if (indicator) {
      indicator.classList.add('show');
      clearTimeout(indicator._timer);
      indicator._timer = setTimeout(() => indicator.classList.remove('show'), 1800);
    }
  } catch (e) {
    console.warn('Auto-save failed:', e);
  }
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved.employees) || !Array.isArray(saved.jobs)) return false;
    data.employees        = saved.employees;
    data.jobs             = saved.jobs;
    data.assignments      = saved.assignments || {};
    data.currentWeekStart = saved.currentWeekStart
      ? new Date(saved.currentWeekStart)
      : startOfWeek(new Date());
    return true;
  } catch (e) {
    console.warn('Failed to load saved data:', e);
    return false;
  }
}

// Debounced auto-save — fires 800ms after the last data change
function scheduleSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveToLocalStorage, 800);
}

// Patch renderAll so every render also schedules a save
const _originalRenderAll = renderAll;  // captured below after definition

// ---------- Share link (URL hash encoding) ----------

function buildSharePayload() {
  return {
    employees:        JSON.parse(JSON.stringify(data.employees)),
    jobs:             JSON.parse(JSON.stringify(data.jobs)),
    assignments:      JSON.parse(JSON.stringify(data.assignments)),
    currentWeekStart: data.currentWeekStart.toISOString()
  };
}

function encodeSharePayload(payload) {
  // JSON → UTF-8 bytes → base64
  const json    = JSON.stringify(payload);
  const encoded = btoa(unescape(encodeURIComponent(json)));
  return encoded;
}

function decodeSharePayload(encoded) {
  const json = decodeURIComponent(escape(atob(encoded)));
  return JSON.parse(json);
}

function copyShareLink() {
  try {
    const payload = buildSharePayload();
    const encoded = encodeSharePayload(payload);
    const url     = `${location.href.split('#')[0]}#data=${encoded}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        showToast('✓ Share link copied to clipboard!');
      }).catch(() => fallbackCopyShareLink(url));
    } else {
      fallbackCopyShareLink(url);
    }
  } catch (e) {
    showToast('⚠ Could not generate share link (data may be too large).');
    console.error(e);
  }
}

function fallbackCopyShareLink(url) {
  const ta = document.createElement('textarea');
  ta.value = url;
  ta.style.cssText = 'position:fixed;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  showToast('✓ Share link copied to clipboard!');
}

function tryLoadFromHash() {
  const hash = location.hash;
  if (!hash.startsWith('#data=')) return false;
  try {
    const encoded = hash.slice(6);
    const payload = decodeSharePayload(encoded);
    if (!Array.isArray(payload.employees) || !Array.isArray(payload.jobs)) return false;
    data.employees        = payload.employees;
    data.jobs             = payload.jobs;
    data.assignments      = payload.assignments || {};
    data.currentWeekStart = payload.currentWeekStart
      ? new Date(payload.currentWeekStart)
      : startOfWeek(new Date());
    // Clean the hash from the URL without reloading
    history.replaceState(null, '', location.pathname + location.search);
    showToast('✓ Shared data loaded successfully!', 3500);
    return true;
  } catch (e) {
    console.warn('Failed to load from share link:', e);
    showToast('⚠ Could not load share link data.');
    return false;
  }
}

document.getElementById('copyShareLinkBtn').addEventListener('click', copyShareLink);

// ---------- Export current week CSV ----------

document.getElementById('exportCsvBtn').addEventListener('click', () => {
  const weekKey        = getCurrentWeekKey();
  const weekAssignments = getAssignmentsForWeek(weekKey);

  const rows = [['Week', 'Employee', 'District', 'Job', 'Hours', 'EmployeeBudget', 'TotalAllocatedForEmployee']];

  data.employees.forEach(emp => {
    const empAssignments = weekAssignments[emp.id] || {};
    const total  = totalHoursForEmployeeWeek(weekKey, emp.id);
    const jobIds = Object.keys(empAssignments);

    if (jobIds.length === 0) {
      rows.push([weekKey, emp.name, emp.district || '', '', '', emp.weeklyBudget, total]);
    } else {
      jobIds.forEach(jobId => {
        const job     = data.jobs.find(j => j.id === jobId);
        const jobName = job ? job.name : '(deleted job)';
        const hours   = empAssignments[jobId].hours || 0;
        rows.push([weekKey, emp.name, emp.district || '', jobName, hours, emp.weeklyBudget, total]);
      });
    }
  });

  downloadCsv(rows, `week_${weekKey}.csv`);
});

// ---------- Export ALL weeks CSV ----------

document.getElementById('exportAllCsvBtn').addEventListener('click', () => {
  const rows = [['Week', 'Employee', 'District', 'Job', 'Hours', 'EmployeeBudget', 'TotalAllocatedForEmployee']];

  const allWeekKeys = Object.keys(data.assignments).sort();

  if (allWeekKeys.length === 0) {
    showToast('No week data to export yet.');
    return;
  }

  allWeekKeys.forEach(weekKey => {
    const weekAssignments = data.assignments[weekKey] || {};

    data.employees.forEach(emp => {
      const empAssignments = weekAssignments[emp.id] || {};
      const total  = totalHoursForEmployeeWeek(weekKey, emp.id);
      const jobIds = Object.keys(empAssignments);

      if (jobIds.length === 0) {
        // Only include weeks where this employee actually has data
        if (total > 0) {
          rows.push([weekKey, emp.name, emp.district || '', '', '', emp.weeklyBudget, total]);
        }
      } else {
        jobIds.forEach(jobId => {
          const job     = data.jobs.find(j => j.id === jobId);
          const jobName = job ? job.name : '(deleted job)';
          const hours   = empAssignments[jobId]?.hours || 0;
          if (hours > 0) {
            rows.push([weekKey, emp.name, emp.district || '', jobName, hours, emp.weeklyBudget, total]);
          }
        });
      }
    });
  });

  const dataRows = rows.length - 1; // minus header
  if (dataRows === 0) {
    showToast('No hours data found across any week.');
    return;
  }

  downloadCsv(rows, `planner_all_weeks.csv`);
  showToast(`✓ Exported ${dataRows} rows across ${allWeekKeys.length} weeks.`);
});

// ---------- Shared CSV download helper ----------

function downloadCsv(rows, filename) {
  const csvContent = rows
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Export / Import JSON ----------

document.getElementById('exportJsonBtn').addEventListener('click', () => {
  const exportData = {
    employees:        JSON.parse(JSON.stringify(data.employees)),
    jobs:             JSON.parse(JSON.stringify(data.jobs)),
    assignments:      JSON.parse(JSON.stringify(data.assignments)),
    currentWeekStart: data.currentWeekStart.toISOString()
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob    = new Blob([jsonStr], { type: 'application/json' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href        = url;
  a.download    = 'planner_data.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('✓ JSON exported.');
});

document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importJsonInput").click();
});

document.getElementById('importJsonInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const imported = JSON.parse(evt.target.result);
      if (!Array.isArray(imported.employees)) { alert('Invalid JSON format: employees must be an array.'); return; }
      if (!Array.isArray(imported.jobs))      { alert('Invalid JSON format: jobs must be an array.'); return; }
      if (typeof imported.assignments !== 'object' || imported.assignments === null) {
        alert('Invalid JSON format: assignments must be an object.'); return;
      }
      data.employees        = imported.employees;
      data.jobs             = imported.jobs;
      data.assignments      = imported.assignments;
      data.currentWeekStart = imported.currentWeekStart
        ? new Date(imported.currentWeekStart)
        : startOfWeek(new Date());
      renderAll();
      showToast('✓ Data imported successfully.');
    } catch (err) {
      console.error(err);
      alert('Failed to parse JSON.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ---------- Resizable columns ----------

function makeResizable(divider, leftCol, rightCol) {
  let dragging = false;
  divider.addEventListener('mousedown', () => (dragging = true));
  window.addEventListener('mouseup', () => (dragging = false));

  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const containerRect = document.querySelector('.container').getBoundingClientRect();
    const totalWidth    = containerRect.width;
    const x             = e.clientX - containerRect.left;

    if (divider.id === 'divider1') {
      const min           = 150;
      const max           = totalWidth - 300;
      const leftWidth     = Math.max(min, Math.min(x, max));
      const employeesWidth = document.querySelector('.employees-column').offsetWidth;
      const divider2Width  = document.getElementById('divider2').offsetWidth;
      const rightWidth    = totalWidth - leftWidth - divider.offsetWidth - employeesWidth - divider2Width;
      if (rightWidth < 150) return;
      leftCol.style.width  = leftWidth + 'px';
      rightCol.style.width = rightWidth + 'px';
    } else if (divider.id === 'divider2') {
      const chartWidth    = document.querySelector('.chart-column').offsetWidth;
      const divider1Width = document.getElementById('divider1').offsetWidth;
      const min           = 150;
      const max           = totalWidth - chartWidth - 300;
      const leftWidth     = Math.max(min, Math.min(x - chartWidth - divider1Width, max));
      const rightWidth    = totalWidth - chartWidth - divider1Width - divider.offsetWidth - leftWidth;
      if (rightWidth < 150) return;
      leftCol.style.width  = leftWidth + 'px';
      rightCol.style.width = rightWidth + 'px';
    }

    forceChartUpdate();
  });
}

makeResizable(
  document.getElementById('divider1'),
  document.querySelector('.chart-column'),
  document.querySelector('.jobs-column')
);
makeResizable(
  document.getElementById('divider2'),
  document.querySelector('.jobs-column'),
  document.querySelector('.employees-column')
);

// ---------- Initial render + startup sequence ----------

function renderAll() {
  renderWeekLabel();
  renderJobs();
  renderEmployees();
  forceChartUpdate();
  scheduleSave();   // auto-save on every render
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('jobColorInput').value = pickUnusedColor();
});

// Startup priority:
//  1. Share link in URL hash (highest priority — someone sent you a link)
//  2. Auto-saved localStorage data
//  3. Fresh empty state
if (!tryLoadFromHash()) {
  loadFromLocalStorage();
}

renderAll();
