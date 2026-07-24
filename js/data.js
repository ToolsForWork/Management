export const DEFAULT_COLOR = '#3b82f6';
export const DEFAULT_DISTRICT = 'Electrical';
export const DISTRICTS = ['Electrical', 'Instrumentation', 'Flex'];
export const JOB_STATUSES = ['Active', 'Upcoming', 'Complete', 'Other'];
export const JOB_CLASSES = ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'];
export const SUBTASK_CATEGORIES = ['Electrical', 'Instrumentation', 'Other'];

export const COLOR_PALETTE = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#d97706', '#7c3aed',
  '#059669', '#dc2626', '#2563eb', '#db2777', '#0891b2'
];

const STORAGE_KEY = 'planner-data-v2';
const LEGACY_STORAGE_KEY = 'planner-data-v1';
const SNAPSHOT_VERSION = 2;
const WEEK_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
let autoSaveTimer = null;

export function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.random() * 16 | 0;
    const value = character === 'x' ? random : (random & 0x3 | 0x8);
    return value.toString(16);
  });
}

export function startOfWeek(date) {
  const result = new Date(date);
  if (Number.isNaN(result.getTime())) return startOfWeek(new Date());
  const day = result.getDay();
  result.setDate(result.getDate() - ((day + 6) % 7));
  result.setHours(0, 0, 0, 0);
  return result;
}

export function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
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

// Selectors never create data. This keeps charts and exports truly read-only.
export function getAssignmentsForWeek(weekKey) {
  return data.assignments[weekKey] || {};
}

export function getEmployeeAssignmentsForWeek(weekKey, employeeId) {
  return getAssignmentsForWeek(weekKey)[employeeId] || {};
}

export function ensureEmployeeAssignmentsForWeek(weekKey, employeeId) {
  if (!data.assignments[weekKey]) data.assignments[weekKey] = {};
  if (!data.assignments[weekKey][employeeId]) {
    data.assignments[weekKey][employeeId] = {};
  }
  return data.assignments[weekKey][employeeId];
}

export function totalHoursForEmployeeWeek(weekKey, employeeId) {
  return Object.values(getEmployeeAssignmentsForWeek(weekKey, employeeId))
    .reduce((sum, assignment) => sum + toNonNegativeNumber(assignment.hours), 0);
}

export function totalHoursAllEmployees(weekKey) {
  return data.employees.reduce(
    (sum, employee) => sum + totalHoursForEmployeeWeek(weekKey, employee.id),
    0
  );
}

export function totalEmployeeCapacity() {
  return data.employees.reduce(
    (sum, employee) => sum + toNonNegativeNumber(employee.weeklyBudget),
    0
  );
}

export function pickUnusedColor() {
  const usedColors = new Set(data.jobs.map(job => (job.color || '').toLowerCase()));
  return COLOR_PALETTE.find(color => !usedColors.has(color.toLowerCase()))
    || COLOR_PALETTE[data.jobs.length % COLOR_PALETTE.length];
}

export function removeJobFromAssignments(jobId) {
  Object.values(data.assignments).forEach(week => {
    Object.values(week).forEach(employeeAssignments => {
      delete employeeAssignments[jobId];
    });
  });
  pruneEmptyAssignments();
}

export function removeEmployeeFromAssignments(employeeId) {
  Object.values(data.assignments).forEach(week => {
    delete week[employeeId];
  });
  pruneEmptyAssignments();
}

export function deepCopySubtasksTemplate(job, district) {
  return (job.subtasks || [])
    .filter(subtask => district === 'Flex' || subtask.category === district)
    .map(subtask => ({
      sourceId: subtask.id || null,
      name: subtask.name,
      hours: 0,
      color: subtask.color || job.color || DEFAULT_COLOR,
      category: subtask.category || 'Other'
    }));
}

export function ensureAssignment(weekKey, employeeId, jobId) {
  const employeeAssignments = ensureEmployeeAssignmentsForWeek(weekKey, employeeId);
  if (!employeeAssignments[jobId]) {
    const job = data.jobs.find(candidate => candidate.id === jobId);
    const employee = data.employees.find(candidate => candidate.id === employeeId);
    employeeAssignments[jobId] = {
      hours: 0,
      subtasks: job
        ? deepCopySubtasksTemplate(job, employee?.district || DEFAULT_DISTRICT)
        : []
    };
  }
  return employeeAssignments[jobId];
}

export function copyWeekAssignments(sourceWeekKey, targetWeekKey) {
  const source = getAssignmentsForWeek(sourceWeekKey);
  if (Object.keys(source).length === 0) return false;
  data.assignments[targetWeekKey] = structuredCloneSafe(source);
  return true;
}

export function hasAssignmentsForWeek(weekKey) {
  return Object.values(getAssignmentsForWeek(weekKey))
    .some(employeeAssignments => Object.keys(employeeAssignments).length > 0);
}

export function createSnapshot() {
  return {
    version: SNAPSHOT_VERSION,
    employees: structuredCloneSafe(data.employees),
    jobs: structuredCloneSafe(data.jobs),
    assignments: structuredCloneSafe(data.assignments),
    currentWeekStart: data.currentWeekStart.toISOString()
  };
}

export function replaceData(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  data.employees = normalized.employees;
  data.jobs = normalized.jobs;
  data.assignments = normalized.assignments;
  data.currentWeekStart = normalized.currentWeekStart;
}

export function saveToLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(createSnapshot()));
    showSavedIndicator();
    return true;
  } catch (error) {
    console.warn('Auto-save failed:', error);
    return false;
  }
}

export function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return false;
    replaceData(JSON.parse(raw));
    return true;
  } catch (error) {
    console.warn('Failed to load saved data:', error);
    return false;
  }
}

export function scheduleSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(saveToLocalStorage, 400);
}

export function encodeSharePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function decodeSharePayload(encoded) {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function tryLoadFromHash(showToast) {
  if (!location.hash.startsWith('#data=')) return false;
  try {
    replaceData(decodeSharePayload(location.hash.slice(6)));
    history.replaceState(null, '', location.pathname + location.search);
    showToast?.('Shared snapshot loaded. Review it before making changes.', 4000);
    return true;
  } catch (error) {
    console.warn('Failed to load from share link:', error);
    showToast?.('The shared link is invalid or damaged.', 4000);
    return false;
  }
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('The imported file must contain a planner object.');
  }
  if (!Array.isArray(snapshot.employees) || !Array.isArray(snapshot.jobs)) {
    throw new Error('The imported file must include employee and job lists.');
  }
  if (!snapshot.assignments || typeof snapshot.assignments !== 'object' || Array.isArray(snapshot.assignments)) {
    throw new Error('The imported file must include week assignments.');
  }

  const employees = snapshot.employees.map(normalizeEmployee);
  const jobs = snapshot.jobs.map(normalizeJob);
  assertUniqueIds(employees, 'employee');
  assertUniqueIds(jobs, 'job');

  const employeeIds = new Set(employees.map(employee => employee.id));
  const jobIds = new Set(jobs.map(job => job.id));
  const assignments = {};

  Object.entries(snapshot.assignments).forEach(([weekKey, week]) => {
    if (!WEEK_KEY_PATTERN.test(weekKey) || !week || typeof week !== 'object' || Array.isArray(week)) return;
    const normalizedWeek = {};
    Object.entries(week).forEach(([employeeId, employeeAssignments]) => {
      if (!employeeIds.has(employeeId) || !isSafeKey(employeeId)
        || !employeeAssignments || typeof employeeAssignments !== 'object'
        || Array.isArray(employeeAssignments)) return;

      const normalizedEmployeeAssignments = {};
      Object.entries(employeeAssignments).forEach(([jobId, assignment]) => {
        if (!jobIds.has(jobId) || !isSafeKey(jobId)
          || !assignment || typeof assignment !== 'object' || Array.isArray(assignment)) return;
        normalizedEmployeeAssignments[jobId] = {
          hours: toNonNegativeNumber(assignment.hours),
          subtasks: Array.isArray(assignment.subtasks)
            ? assignment.subtasks.map(normalizeAssignmentSubtask).filter(Boolean)
            : []
        };
      });
      if (Object.keys(normalizedEmployeeAssignments).length > 0) {
        normalizedWeek[employeeId] = normalizedEmployeeAssignments;
      }
    });
    if (Object.keys(normalizedWeek).length > 0) assignments[weekKey] = normalizedWeek;
  });

  const parsedDate = snapshot.currentWeekStart ? new Date(snapshot.currentWeekStart) : new Date();
  return {
    employees,
    jobs,
    assignments,
    currentWeekStart: startOfWeek(parsedDate)
  };
}

function normalizeEmployee(employee, index) {
  if (!employee || typeof employee !== 'object') {
    throw new Error(`Employee ${index + 1} is invalid.`);
  }
  const name = normalizeRequiredText(employee.name, `Employee ${index + 1} needs a name.`);
  const budget = Number(employee.weeklyBudget);
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error(`${name} needs a weekly budget greater than zero.`);
  }
  return {
    id: normalizeId(employee.id, `employee-${index + 1}`),
    name,
    weeklyBudget: budget,
    district: DISTRICTS.includes(employee.district) ? employee.district : DEFAULT_DISTRICT,
    collapsed: Boolean(employee.collapsed)
  };
}

function normalizeJob(job, index) {
  if (!job || typeof job !== 'object') {
    throw new Error(`Job ${index + 1} is invalid.`);
  }
  const name = normalizeRequiredText(job.name, `Job ${index + 1} needs a name.`);
  return {
    id: normalizeId(job.id, `job-${index + 1}`),
    name,
    category: JOB_STATUSES.includes(job.category) ? job.category : 'Other',
    classification: JOB_CLASSES.includes(job.classification) ? job.classification : 'Class 1',
    color: normalizeColor(job.color, DEFAULT_COLOR),
    subtasks: Array.isArray(job.subtasks)
      ? job.subtasks.map((subtask, subtaskIndex) => normalizeJobSubtask(subtask, subtaskIndex))
      : [],
    collapsed: Boolean(job.collapsed),
    subtaskGroupCollapsed: normalizeCollapsedGroups(job.subtaskGroupCollapsed),
    hoursBudget: toNonNegativeNumber(job.hoursBudget)
  };
}

function normalizeJobSubtask(subtask, index) {
  if (!subtask || typeof subtask !== 'object') {
    throw new Error(`Job subtask ${index + 1} is invalid.`);
  }
  return {
    id: normalizeId(subtask.id, `subtask-${index + 1}-${uuid()}`),
    name: normalizeRequiredText(subtask.name, `Job subtask ${index + 1} needs a name.`),
    category: SUBTASK_CATEGORIES.includes(subtask.category) ? subtask.category : 'Other',
    color: normalizeColor(subtask.color, DEFAULT_COLOR)
  };
}

function normalizeAssignmentSubtask(subtask) {
  if (!subtask || typeof subtask !== 'object') return null;
  const name = String(subtask.name || '').trim();
  if (!name) return null;
  return {
    sourceId: typeof subtask.sourceId === 'string' && isSafeKey(subtask.sourceId)
      ? subtask.sourceId
      : null,
    name,
    hours: toNonNegativeNumber(subtask.hours),
    color: normalizeColor(subtask.color, DEFAULT_COLOR),
    category: SUBTASK_CATEGORIES.includes(subtask.category) ? subtask.category : 'Other'
  };
}

function normalizeCollapsedGroups(groups) {
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) return {};
  return Object.fromEntries(
    SUBTASK_CATEGORIES.map(category => [category, Boolean(groups[category])])
  );
}

function normalizeId(value, fallback) {
  const id = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  if (!isSafeKey(id)) throw new Error(`Invalid record identifier: ${id}`);
  return id;
}

function normalizeRequiredText(value, message) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

function normalizeColor(value, fallback) {
  return typeof value === 'string' && COLOR_PATTERN.test(value) ? value.toLowerCase() : fallback;
}

function assertUniqueIds(items, label) {
  const ids = new Set();
  items.forEach(item => {
    if (ids.has(item.id)) throw new Error(`Duplicate ${label} identifier: ${item.id}`);
    ids.add(item.id);
  });
}

function isSafeKey(key) {
  return typeof key === 'string' && key.length > 0 && !BLOCKED_KEYS.has(key);
}

function toNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function structuredCloneSafe(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function pruneEmptyAssignments() {
  Object.entries(data.assignments).forEach(([weekKey, week]) => {
    Object.entries(week).forEach(([employeeId, employeeAssignments]) => {
      if (Object.keys(employeeAssignments).length === 0) delete week[employeeId];
    });
    if (Object.keys(week).length === 0) delete data.assignments[weekKey];
  });
}

function showSavedIndicator() {
  const indicator = document.getElementById('autoSaveIndicator');
  if (!indicator) return;
  indicator.classList.add('show');
  clearTimeout(indicator._timer);
  indicator._timer = setTimeout(() => indicator.classList.remove('show'), 1600);
}
