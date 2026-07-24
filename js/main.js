import {
  data,
  startOfWeek,
  getWeekKey,
  pickUnusedColor,
  loadFromLocalStorage,
  scheduleSave,
  createSnapshot,
  replaceData,
  encodeSharePayload,
  tryLoadFromHash,
  getCurrentWeekKey,
  getAssignmentsForWeek,
  totalHoursForEmployeeWeek,
  copyWeekAssignments,
  hasAssignmentsForWeek
} from './data.js';
import { renderWeekLabel, forceChartUpdate } from './charts.js';
import {
  renderJobs,
  renderEmployees,
  addJob,
  addEmployee,
  downloadCsv,
  showToast,
  makeResizable
} from './ui.js';

const THEME_KEY = 'planner-theme';

export function renderAll() {
  renderWeekLabel();
  renderJobs();
  renderEmployees();
  forceChartUpdate();
}

initialize();

function initialize() {
  initializeTheme();
  if (!tryLoadFromHash(showToast)) loadFromLocalStorage();
  wireMenus();
  wireWeekControls();
  wireCreationForms();
  wireFileActions();
  wireSearch();
  renderAll();

  const colorInput = document.getElementById('jobColorInput');
  colorInput.value = pickUnusedColor();

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

  window.addEventListener('resize', forceChartUpdate);
}

function wireMenus() {
  const menus = [
    [document.getElementById('fileBtn'), document.getElementById('fileMenu')],
    [document.getElementById('settingsBtn'), document.getElementById('settingsMenu')]
  ];

  menus.forEach(([button, menu]) => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const willOpen = menu.classList.contains('hidden');
      closeMenus(menus);
      menu.classList.toggle('hidden', !willOpen);
      button.setAttribute('aria-expanded', String(willOpen));
    });
  });

  document.addEventListener('click', event => {
    if (!menus.some(([, menu]) => menu.contains(event.target))) closeMenus(menus);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenus(menus);
  });
}

function closeMenus(menus) {
  menus.forEach(([button, menu]) => {
    menu.classList.add('hidden');
    button.setAttribute('aria-expanded', 'false');
  });
}

function wireWeekControls() {
  document.getElementById('prevWeekBtn').addEventListener('click', () => changeWeek(-7));
  document.getElementById('nextWeekBtn').addEventListener('click', () => changeWeek(7));
  document.getElementById('jumpToPresentBtn').addEventListener('click', () => {
    data.currentWeekStart = startOfWeek(new Date());
    renderAll();
    scheduleSave();
  });
  document.getElementById('copyPreviousWeekBtn').addEventListener('click', copyPreviousWeek);
}

function changeWeek(days) {
  const nextWeek = new Date(data.currentWeekStart);
  nextWeek.setDate(nextWeek.getDate() + days);
  data.currentWeekStart = startOfWeek(nextWeek);
  renderAll();
  scheduleSave();
}

function copyPreviousWeek() {
  const targetWeekKey = getCurrentWeekKey();
  const previousWeek = new Date(data.currentWeekStart);
  previousWeek.setDate(previousWeek.getDate() - 7);
  const sourceWeekKey = getWeekKey(previousWeek);

  if (!hasAssignmentsForWeek(sourceWeekKey)) {
    showToast('The previous week has no assignments to copy.');
    return;
  }
  if (hasAssignmentsForWeek(targetWeekKey)
    && !window.confirm('Replace this week’s assignments with a copy of the previous week?')) {
    return;
  }

  copyWeekAssignments(sourceWeekKey, targetWeekKey);
  renderAll();
  scheduleSave();
  showToast('Previous week copied.');
}

function wireCreationForms() {
  const jobNameInput = document.getElementById('jobNameInput');
  const employeeNameInput = document.getElementById('employeeNameInput');

  const submitJob = () => {
    const added = addJob(
      jobNameInput.value,
      document.getElementById('jobCategoryInput').value,
      document.getElementById('jobClassInput').value,
      document.getElementById('jobColorInput').value
    );
    if (!added) return;
    jobNameInput.value = '';
    document.getElementById('jobColorInput').value = pickUnusedColor();
    jobNameInput.focus();
  };

  const submitEmployee = () => {
    const budgetInput = document.getElementById('employeeBudgetInput');
    const added = addEmployee(
      employeeNameInput.value,
      budgetInput.value,
      document.getElementById('employeeDistrictInput').value
    );
    if (!added) return;
    employeeNameInput.value = '';
    budgetInput.value = '';
    employeeNameInput.focus();
  };

  document.getElementById('addJobBtn').addEventListener('click', submitJob);
  document.getElementById('addEmployeeBtn').addEventListener('click', submitEmployee);
  jobNameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') submitJob();
  });
  [employeeNameInput, document.getElementById('employeeBudgetInput')].forEach(input => {
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') submitEmployee();
    });
  });
}

function wireFileActions() {
  document.getElementById('exportCsvBtn').addEventListener('click', exportCurrentWeekCsv);
  document.getElementById('exportAllCsvBtn').addEventListener('click', exportAllWeeksCsv);
  document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
  document.getElementById('copyShareLinkBtn').addEventListener('click', copyShareLink);
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importJsonInput').click();
  });
  document.getElementById('importJsonInput').addEventListener('change', importJson);
}

function exportCurrentWeekCsv() {
  const weekKey = getCurrentWeekKey();
  const weekAssignments = getAssignmentsForWeek(weekKey);
  const rows = [csvHeaders()];

  data.employees.forEach(employee => {
    const employeeAssignments = weekAssignments[employee.id] || {};
    const total = totalHoursForEmployeeWeek(weekKey, employee.id);
    const jobIds = Object.keys(employeeAssignments);

    if (jobIds.length === 0) {
      rows.push([weekKey, employee.name, employee.district, '', '', employee.weeklyBudget, total]);
      return;
    }
    jobIds.forEach(jobId => {
      const job = data.jobs.find(candidate => candidate.id === jobId);
      rows.push([
        weekKey,
        employee.name,
        employee.district,
        job?.name || '(deleted project)',
        employeeAssignments[jobId].hours || 0,
        employee.weeklyBudget,
        total
      ]);
    });
  });

  downloadCsv(rows, `week_${weekKey}.csv`);
  showToast(`Exported ${rows.length - 1} rows.`);
}

function exportAllWeeksCsv() {
  const rows = [csvHeaders()];
  const weekKeys = Object.keys(data.assignments).sort();

  weekKeys.forEach(weekKey => {
    const weekAssignments = getAssignmentsForWeek(weekKey);
    data.employees.forEach(employee => {
      const employeeAssignments = weekAssignments[employee.id] || {};
      const total = totalHoursForEmployeeWeek(weekKey, employee.id);
      Object.entries(employeeAssignments).forEach(([jobId, assignment]) => {
        if (!(assignment.hours > 0)) return;
        const job = data.jobs.find(candidate => candidate.id === jobId);
        rows.push([
          weekKey,
          employee.name,
          employee.district,
          job?.name || '(deleted project)',
          assignment.hours,
          employee.weeklyBudget,
          total
        ]);
      });
    });
  });

  if (rows.length === 1) {
    showToast('There are no assigned hours to export.');
    return;
  }
  downloadCsv(rows, 'planner_all_weeks.csv');
  showToast(`Exported ${rows.length - 1} rows across ${weekKeys.length} weeks.`);
}

function csvHeaders() {
  return ['Week', 'Employee', 'District', 'Project', 'Hours', 'EmployeeCapacity', 'TotalAllocated'];
}

function exportJson() {
  downloadBlob(
    JSON.stringify(createSnapshot(), null, 2),
    'application/json',
    'management_planner_data.json'
  );
  showToast('Backup exported.');
}

function importJson(event) {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      replaceData(imported);
      renderAll();
      scheduleSave();
      showToast('Backup imported successfully.');
    } catch (error) {
      showToast(error.message || 'The selected file is not a valid planner backup.', 5000);
    }
  };
  reader.onerror = () => showToast('The selected file could not be read.');
  reader.readAsText(file);
}

async function copyShareLink() {
  try {
    const encoded = encodeSharePayload(createSnapshot());
    const url = `${location.href.split('#')[0]}#data=${encoded}`;
    if (url.length > 100_000) {
      showToast('This snapshot is too large for a reliable link. Export a backup instead.', 5000);
      return;
    }
    await copyText(url);
    showToast('Snapshot link copied. It will not stay in sync automatically.', 4000);
  } catch (error) {
    console.error(error);
    showToast('Could not create a share link. Export a backup instead.', 4000);
  }
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.className = 'clipboard-fallback';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard access failed.');
}

function downloadBlob(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function initializeTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  const preferredTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const theme = savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : preferredTheme;
  document.documentElement.dataset.theme = theme;

  const toggle = document.getElementById('darkModeToggle');
  toggle.checked = theme === 'dark';
  toggle.addEventListener('change', () => {
    const nextTheme = toggle.checked ? 'dark' : 'light';
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem(THEME_KEY, nextTheme);
    forceChartUpdate();
  });
}

function wireSearch() {
  document.getElementById('jobSearchInput').addEventListener('input', renderJobs);
  document.getElementById('employeeSearchInput').addEventListener('input', renderEmployees);
}
