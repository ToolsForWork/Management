// data.js
export const DEFAULT_COLOR = '#03bafc';
export const DEFAULT_DISTRICT = 'Electrical';

export const COLOR_PALETTE = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#d97706', '#7c3aed',
  '#059669', '#dc2626', '#2563eb', '#db2777', '#0891b2'
];

export function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getWeekKey(date) {
  return formatDate(startOfWeek(date));
}

export const data = {
  employees: [],
  jobs: [],
  assignments: {},
  currentWeekStart: startOfWeek(new Date())
};

export function getCurrentWeekKey() {
  return getWeekKey(data.currentWeekStart);
}

export function getAssignmentsForWeek(weekKey) {
  if (!data.assignments[weekKey]) data.assignments[weekKey] = {};
  return data.assignments[weekKey];
}

export function getEmployeeAssignmentsForWeek(weekKey, employeeId) {
  const week = getAssignmentsForWeek(weekKey);
  if (!week[employeeId]) week[employeeId] = {};
  return week[employeeId];
}

export function totalHoursForEmployeeWeek(weekKey, employeeId) {
  const empAssignments = getEmployeeAssignmentsForWeek(weekKey, employeeId);
  let sum = 0;
  Object.values(empAssignments).forEach(a => { sum += (a.hours || 0); });
  return sum;
}

export function totalHoursAllEmployees(weekKey) {
  return data.employees.reduce((sum, emp) => {
    return sum + totalHoursForEmployeeWeek(weekKey, emp.id);
  }, 0);
}

export function totalEmployeeCapacity() {
  return data.employees.reduce((sum, emp) => sum + (emp.weeklyBudget || 0), 0);
}

export function pickUnusedColor() {
  const usedColors = new Set(data.jobs.map(j => (j.color || '').toLowerCase()));
  for (const c of COLOR_PALETTE) {
    if (!usedColors.has(c.toLowerCase())) return c;
  }
  return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
}

export function removeJobFromAssignments(jobId) {
  Object.values(data.assignments).forEach(week => {
    Object.values(week).forEach(empAssignments => {
      if (empAssignments[jobId]) delete empAssignments[jobId];
    });
  });
}

export function removeEmployeeFromAssignments(empId) {
  Object.values(data.assignments).forEach(week => {
    if (week[empId]) delete week[empId];
  });
}

export function deepCopySubtasksTemplate(job, district) {
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

export function ensureAssignment(weekKey, empId, jobId) {
  const empAssignments = getEmployeeAssignmentsForWeek(weekKey, empId);
  if (!empAssignments[jobId]) {
    const job = data.jobs.find(j => j.id === jobId);
    const emp = data.employees.find(e => e.id === empId);
    const district = emp?.district || DEFAULT_DISTRICT;
    empAssignments[jobId] = {
      hours: 0,
      subtasks: job ? deepCopySubtasksTemplate(job, district) : []
    };
  }
  return empAssignments[jobId];
}

// storage + share

const STORAGE_KEY = 'planner-data-v1';
let autoSaveTimer = null;

export function saveToLocalStorage() {
  try {
    const snapshot = {
      employees: JSON.parse(JSON.stringify(data.employees)),
      jobs: JSON.parse(JSON.stringify(data.jobs)),
      assignments: JSON.parse(JSON.stringify(data.assignments)),
      currentWeekStart: data.currentWeekStart.toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
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

export function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved.employees) || !Array.isArray(saved.jobs)) return false;
    data.employees = saved.employees;
    data.jobs = saved.jobs;
    data.assignments = saved.assignments || {};
    data.currentWeekStart = saved.currentWeekStart
      ? new Date(saved.currentWeekStart)
      : startOfWeek(new Date());
    return true;
  } catch (e) {
    console.warn('Failed to load saved data:', e);
    return false;
  }
}

export function scheduleSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveToLocalStorage, 800);
}

export function buildSharePayload() {
  return {
    employees: JSON.parse(JSON.stringify(data.employees)),
    jobs: JSON.parse(JSON.stringify(data.jobs)),
    assignments: JSON.parse(JSON.stringify(data.assignments)),
    currentWeekStart: data.currentWeekStart.toISOString()
  };
}

export function encodeSharePayload(payload) {
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json)));
}

export function decodeSharePayload(encoded) {
  const json = decodeURIComponent(escape(atob(encoded)));
  return JSON.parse(json);
}

export function tryLoadFromHash(showToast) {
  const hash = location.hash;
  if (!hash.startsWith('#data=')) return false;
  try {
    const encoded = hash.slice(6);
    const payload = decodeSharePayload(encoded);
    if (!Array.isArray(payload.employees) || !Array.isArray(payload.jobs)) return false;
    data.employees = payload.employees;
    data.jobs = payload.jobs;
    data.assignments = payload.assignments || {};
    data.currentWeekStart = payload.currentWeekStart
      ? new Date(payload.currentWeekStart)
      : startOfWeek(new Date());
    history.replaceState(null, '', location.pathname + location.search);
    showToast && showToast('✓ Shared data loaded successfully!', 3500);
    return true;
  } catch (e) {
    console.warn('Failed to load from share link:', e);
    showToast && showToast('⚠ Could not load share link data.');
    return false;
  }
}
