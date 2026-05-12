// main.js
import {
  data,
  startOfWeek,
  pickUnusedColor,
  loadFromLocalStorage,
  scheduleSave,
  buildSharePayload,
  encodeSharePayload,
  tryLoadFromHash,
  getCurrentWeekKey,
  getAssignmentsForWeek,
  totalHoursForEmployeeWeek
} from './data.js';
import {
  renderWeekLabel,
  forceChartUpdate
} from './charts.js';
import {
  renderJobs,
  renderEmployees,
  addJob,
  addEmployee,
  downloadCsv,
  showToast,
  makeResizable
} from './ui.js';

// renderAll
export function renderAll() {
  renderWeekLabel();
  renderJobs();
  renderEmployees();
  forceChartUpdate();
  scheduleSave();
}

// dark mode + settings + file menu wiring stays here or in ui.js if you prefer

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('jobColorInput').value = pickUnusedColor();
});

// week nav
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

document.addEventListener("DOMContentLoaded", () => {

  // FILE MENU
  const fileBtn = document.getElementById("fileBtn");
  const fileMenu = document.getElementById("fileMenu");

  fileBtn.addEventListener("click", e => {
    e.stopPropagation();
    fileMenu.classList.toggle("hidden");
  });

  document.addEventListener("click", e => {
    if (!fileMenu.contains(e.target) && e.target !== fileBtn) {
      fileMenu.classList.add("hidden");
    }
  });

  // SETTINGS MENU
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsMenu = document.getElementById("settingsMenu");

  settingsBtn.addEventListener("click", e => {
    e.stopPropagation();
    settingsMenu.classList.toggle("hidden");
  });

  document.addEventListener("click", e => {
    if (!settingsMenu.contains(e.target) && e.target !== settingsBtn) {
      settingsMenu.classList.add("hidden");
    }
  });

});

document.addEventListener("DOMContentLoaded", () => {

  /* ---------------- FILE MENU ACTIONS ---------------- */

  // Export Week CSV
  document.getElementById("exportCsvBtn").addEventListener("click", () => {
    const weekKey = getCurrentWeekKey();
    const weekAssignments = getAssignmentsForWeek(weekKey);

    const rows = [['Week', 'Employee', 'District', 'Job', 'Hours', 'EmployeeBudget', 'TotalAllocatedForEmployee']];

    data.employees.forEach(emp => {
      const empAssignments = weekAssignments[emp.id] || {};
      const total = totalHoursForEmployeeWeek(weekKey, emp.id);
      const jobIds = Object.keys(empAssignments);

      if (jobIds.length === 0) {
        rows.push([weekKey, emp.name, emp.district || '', '', '', emp.weeklyBudget, total]);
      } else {
        jobIds.forEach(jobId => {
          const job = data.jobs.find(j => j.id === jobId);
          const jobName = job ? job.name : '(deleted job)';
          const hours = empAssignments[jobId].hours || 0;
          rows.push([weekKey, emp.name, emp.district || '', jobName, hours, emp.weeklyBudget, total]);
        });
      }
    });

    downloadCsv(rows, `week_${weekKey}.csv`);
  });

  // Export ALL Weeks CSV
  document.getElementById("exportAllCsvBtn").addEventListener("click", () => {
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
        const total = totalHoursForEmployeeWeek(weekKey, emp.id);
        const jobIds = Object.keys(empAssignments);

        if (jobIds.length === 0) {
          if (total > 0) {
            rows.push([weekKey, emp.name, emp.district || '', '', '', emp.weeklyBudget, total]);
          }
        } else {
          jobIds.forEach(jobId => {
            const job = data.jobs.find(j => j.id === jobId);
            const jobName = job ? job.name : '(deleted job)';
            const hours = empAssignments[jobId]?.hours || 0;
            if (hours > 0) {
              rows.push([weekKey, emp.name, emp.district || '', jobName, hours, emp.weeklyBudget, total]);
            }
          });
        }
      });
    });

    if (rows.length === 1) {
      showToast('No hours data found across any week.');
      return;
    }

    downloadCsv(rows, `planner_all_weeks.csv`);
    showToast(`✓ Exported ${rows.length - 1} rows across ${allWeekKeys.length} weeks.`);
  });

  // Export JSON
  document.getElementById("exportJsonBtn").addEventListener("click", () => {
    const exportData = {
      employees: JSON.parse(JSON.stringify(data.employees)),
      jobs: JSON.parse(JSON.stringify(data.jobs)),
      assignments: JSON.parse(JSON.stringify(data.assignments)),
      currentWeekStart: data.currentWeekStart.toISOString()
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'planner_data.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('✓ JSON exported.');
  });

  // Import JSON
  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importJsonInput").click();
  });

  document.getElementById("importJsonInput").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const imported = JSON.parse(evt.target.result);

        if (!Array.isArray(imported.employees)) return alert('Invalid JSON: employees must be an array.');
        if (!Array.isArray(imported.jobs)) return alert('Invalid JSON: jobs must be an array.');
        if (typeof imported.assignments !== 'object') return alert('Invalid JSON: assignments must be an object.');

        data.employees = imported.employees;
        data.jobs = imported.jobs;
        data.assignments = imported.assignments;
        data.currentWeekStart = imported.currentWeekStart
          ? new Date(imported.currentWeekStart)
          : startOfWeek(new Date());

        renderAll();
        showToast('✓ Data imported successfully.');
      } catch {
        alert('Failed to parse JSON.');
      }
    };

    reader.readAsText(file);
    e.target.value = '';
  });

  /* ---------------- DARK MODE ---------------- */
  const darkToggle = document.getElementById("darkModeToggle");
  darkToggle.addEventListener("change", () => {
    const theme = darkToggle.checked ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    forceChartUpdate();
  });

});

// add job / employee
document.getElementById('addJobBtn').addEventListener('click', () => {
  const nameInput = document.getElementById('jobNameInput');
  const categoryInput = document.getElementById('jobCategoryInput');
  const colorInput = document.getElementById('jobColorInput');
  const classInput = document.getElementById('jobClassInput');
  addJob(nameInput.value, categoryInput.value, classInput.value, colorInput.value);
  nameInput.value = '';
});

document.getElementById('jobNameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const nameInput = document.getElementById('jobNameInput');
    const categoryInput = document.getElementById('jobCategoryInput');
    const colorInput = document.getElementById('jobColorInput');
    const classInput = document.getElementById('jobClassInput');
    addJob(nameInput.value, categoryInput.value, classInput.value, colorInput.value);
    nameInput.value = '';
  }
});

document.getElementById('addEmployeeBtn').addEventListener('click', () => {
  const nameInput = document.getElementById('employeeNameInput');
  const budgetInput = document.getElementById('employeeBudgetInput');
  const districtInput = document.getElementById('employeeDistrictInput');
  addEmployee(nameInput.value, budgetInput.value, districtInput.value);
  nameInput.value = '';
  budgetInput.value = '';
});

document.getElementById('employeeNameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const nameInput = document.getElementById('employeeNameInput');
    const budgetInput = document.getElementById('employeeBudgetInput');
    const districtInput = document.getElementById('employeeDistrictInput');
    addEmployee(nameInput.value, budgetInput.value, districtInput.value);
    nameInput.value = '';
    budgetInput.value = '';
  }
});

// share link button
document.getElementById('copyShareLinkBtn').addEventListener('click', () => {
  try {
    const payload = buildSharePayload();
    const encoded = encodeSharePayload(payload);
    const url = `${location.href.split('#')[0]}#data=${encoded}`;
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
});

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

// CSV + JSON export/import wiring can also live here, calling helpers in ui/data

// startup
if (!tryLoadFromHash(showToast)) {
  loadFromLocalStorage();
}
renderAll();

// resizable columns
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
