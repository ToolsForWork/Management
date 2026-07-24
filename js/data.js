export const DEFAULT_COLOR = '#3b82f6';
export const DEFAULT_DISTRICT = 'Electrical';
export const DISTRICTS = ['Electrical', 'Instrumentation', 'E&I'];
export const ORG_ROLES = ['DM', 'ADM', 'Estimator'];
export const JOB_STATUSES = ['Active', 'Upcoming', 'Complete', 'Other'];
export const JOB_CLASSES = ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'];
export const SUBTASK_CATEGORIES = ['Electrical', 'Instrumentation', 'Other'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
export const TASK_STATUSES = ['To do', 'In progress', 'Blocked', 'Done'];
export const PROJECT_HEALTH = ['On track', 'At risk', 'Off track', 'Complete'];
export const ASSIGNMENT_STATUSES = ['Proposed', 'Accepted', 'Needs change', 'Complete'];
export const DEFAULT_WBS = '110803';
export const DEFAULT_IO = {
  Electrical: '1507',
  Instrumentation: '1509',
  'E&I': '1507',
  Unutilized: '1511'
};

// Top-level "Estimating - E&I" activities from the supplied 2025 schedule workbook.
export const PROCEDURE_ACTIVITIES = [
  'Early Engagement',
  'Procurement Strategy',
  'Preliminary MTO Development - 1E Quantification',
  'Preliminary MTO Development - Validation of Engineering Quantities',
  'PARTNER Engineering - Preliminary MTO Development - 1E Quantification',
  'PARTNER Engineering - Preliminary MTO Development - Validation of Engineering Quantities',
  'Prelim NTO - Engineering Development Allowances',
  'Prelim Estimate - Construction Power',
  'Issue Initial Procurement Packages - Subs',
  'Issue Initial Procurement Packages - PM',
  'Final MTO Development - 1E Quantification',
  'Final MTO Development - Validation of Engineering Quantities',
  'Engineering PARTNER Final MTOs Development - 1E Quantification',
  'Engineering PARTNER Final MTOs Development - Validation of Engineering Quantities',
  'Final NTO - Engineering Development Allowances',
  'Final Estimate - Construction Power',
  'Estimate Development',
  'Final Procurement Packages - Subs',
  'Final Procurement Packages - PM',
  'QCS Subs',
  'QCS PM',
  'DDM Review / Actions',
  'Finalize Assumptions and Clarifications into Log',
  'Prepare for CER Review',
  'Prepare for EPC/DM Review',
  'Prepare for Executive Review',
  'Incorporate Comments from Executive Review',
  'Final Documents to SharePoint and Final Turnover Book'
];

export const DEFAULT_TAKEOFFS = {
  Electrical: [
    'Grounding',
    'Lighting',
    'Lightning Protection',
    'Raceway and Cable',
    'Heat Trace',
    'Equipment and Devices',
    'Temporary Power'
  ],
  Instrumentation: ['Network', 'Instrumentation', 'Telecommunications']
};

export const COLOR_PALETTE = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#d97706', '#7c3aed',
  '#059669', '#dc2626', '#2563eb', '#db2777', '#0891b2'
];

const STORAGE_KEY = 'planner-data-v2';
const LEGACY_STORAGE_KEY = 'planner-data-v1';
const SNAPSHOT_VERSION = 5;
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
  tasks: [],
  timeOff: [],
  checkIns: [],
  goals: [],
  oneOnOnes: [],
  activity: [],
  currentUserId: '',
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

export function totalEmployeeCapacity(weekKey = getCurrentWeekKey()) {
  return data.employees
    .filter(employee => employee.active !== false)
    .reduce(
    (sum, employee) => sum + getEffectiveEmployeeCapacity(employee, weekKey),
    0
  );
}

export function getEffectiveEmployeeCapacity(employee, weekKey = getCurrentWeekKey()) {
  const weekStart = startOfWeek(new Date(`${weekKey}T12:00:00`));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const startKey = formatDate(weekStart);
  const endKey = formatDate(weekEnd);
  const leaveHours = data.timeOff
    .filter(entry => entry.employeeId === employee.id
      && entry.status === 'Approved'
      && entry.startDate <= endKey
      && entry.endDate >= startKey)
    .reduce((sum, entry) => sum + toNonNegativeNumber(entry.hoursPerWeek), 0);
  return Math.max(0, toNonNegativeNumber(employee.weeklyBudget) - leaveHours);
}

export function getAlerts(referenceDate = new Date()) {
  const today = formatDate(referenceDate);
  const soon = new Date(referenceDate);
  soon.setDate(soon.getDate() + 14);
  const soonKey = formatDate(soon);
  const weekKey = getCurrentWeekKey();
  const alerts = [];

  data.employees.filter(employee => employee.active !== false).forEach(employee => {
    const allocated = totalHoursForEmployeeWeek(weekKey, employee.id);
    const capacity = getEffectiveEmployeeCapacity(employee, weekKey);
    if (allocated > capacity) {
      alerts.push({
        severity: 'Critical',
        type: 'Capacity',
        message: `${employee.name} is allocated ${allocated - capacity} hours over capacity.`,
        entityType: 'employee',
        entityId: employee.id
      });
    }
    if (employee.rosterRole === 'Estimator') {
      const planned = getThreeWeekPlannedHours(employee.id, weekKey);
      if (planned < 120) {
        alerts.push({
          severity: planned < 80 ? 'High' : 'Medium',
          type: '3-week plan',
          message: `${employee.name} has ${planned} of 120 future hours planned.`,
          entityType: 'employee',
          entityId: employee.id
        });
      }
    }
  });

  data.jobs.forEach(job => {
    if (!job.dueDate || job.health === 'Complete' || job.category === 'Complete') return;
    if (job.dueDate < today) {
      alerts.push({
        severity: 'Critical',
        type: 'Deadline',
        message: `${job.name} passed its due date.`,
        entityType: 'project',
        entityId: job.id
      });
    } else if (job.dueDate <= soonKey) {
      alerts.push({
        severity: job.health === 'At risk' || job.health === 'Off track' ? 'High' : 'Medium',
        type: 'Deadline',
        message: `${job.name} is due ${job.dueDate}.`,
        entityType: 'project',
        entityId: job.id
      });
    }
    if (job.health === 'At risk' || job.health === 'Off track') {
      alerts.push({
        severity: job.health === 'Off track' ? 'Critical' : 'High',
        type: 'Project health',
        message: `${job.name} is ${job.health.toLowerCase()}.`,
        entityType: 'project',
        entityId: job.id
      });
    }
  });

  data.tasks.forEach(task => {
    if (task.status === 'Done' || !task.dueDate) return;
    if (task.dueDate < today) {
      alerts.push({
        severity: task.priority === 'Critical' ? 'Critical' : 'High',
        type: 'Overdue task',
        message: `${task.title} was due ${task.dueDate}.`,
        entityType: 'task',
        entityId: task.id
      });
    } else if (task.dueDate <= soonKey && (task.priority === 'High' || task.priority === 'Critical')) {
      alerts.push({
        severity: 'Medium',
        type: 'Upcoming task',
        message: `${task.title} is due ${task.dueDate}.`,
        entityType: 'task',
        entityId: task.id
      });
    }
  });

  Object.entries(getAssignmentsForWeek(weekKey)).forEach(([employeeId, assignments]) => {
    Object.entries(assignments).forEach(([jobId, assignment]) => {
      if (assignment.status !== 'Needs change') return;
      const employee = data.employees.find(candidate => candidate.id === employeeId);
      const job = data.jobs.find(candidate => candidate.id === jobId);
      if (employee && job) {
        alerts.push({
          severity: 'High',
          type: 'Assignment',
          message: `${employee.name} requested a change to ${job.name}.`,
          entityType: 'employee',
          entityId: employeeId
        });
      }
    });
  });

  const severityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  return alerts.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]);
}

export function recordActivity(type, message, entityType = '', entityId = '') {
  data.activity.unshift({
    id: uuid(),
    timestamp: new Date().toISOString(),
    type: String(type || 'Update'),
    message: String(message || '').trim(),
    entityType,
    entityId,
    actorId: data.currentUserId || ''
  });
  data.activity = data.activity.slice(0, 500);
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
    .filter(subtask => district === 'E&I' || subtask.category === district)
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
      status: 'Proposed',
      note: '',
      subtasks: job
        ? deepCopySubtasksTemplate(job, employee?.district || DEFAULT_DISTRICT)
        : []
    };
  }
  return employeeAssignments[jobId];
}

export function getTaskActualHours(task) {
  return (task?.workLogs || []).reduce((total, log) => total + toNonNegativeNumber(log.hours), 0);
}

export function getTaskVariance(task) {
  return toNonNegativeNumber(task?.budgetHours) - getTaskActualHours(task);
}

export function createDefaultProjectChecklist() {
  return [
    ...PROCEDURE_ACTIVITIES.map(name => ({
      id: uuid(),
      name,
      type: 'Procedure',
      discipline: 'E&I',
      complete: false,
      completedAt: '',
      completedById: ''
    })),
    ...Object.entries(DEFAULT_TAKEOFFS).flatMap(([discipline, names]) => names.map(name => ({
      id: uuid(),
      name,
      type: 'Takeoff',
      discipline,
      complete: false,
      completedAt: '',
      completedById: ''
    })))
  ];
}

export function getViewerLevel(employeeId) {
  const employee = data.employees.find(candidate => candidate.id === employeeId && candidate.active !== false);
  if (!employee) return 'Estimator';
  if (employee.rosterRole === 'DM' || employee.rosterRole === 'ADM') return 'Manager';
  return data.jobs.some(job => job.ownerId === employee.id && job.category !== 'Complete')
    ? 'Lead'
    : 'Estimator';
}

export function getThreeWeekPlannedHours(employeeId, startWeekKey = getCurrentWeekKey()) {
  const start = startOfWeek(new Date(`${startWeekKey}T12:00:00`));
  const end = new Date(start);
  end.setDate(end.getDate() + 20);
  const endKey = formatDate(end);
  return data.tasks
    .filter(task => task.assigneeId === employeeId && task.progress < 100)
    .filter(task => {
      const plannedWeek = task.plannedWeekKey || startWeekKey;
      return plannedWeek >= startWeekKey && plannedWeek <= endKey;
    })
    .reduce((total, task) => total + Math.max(0, toNonNegativeNumber(task.budgetHours) - getTaskActualHours(task)), 0);
}

export function getEmployeeDescendantIds(employeeId) {
  const descendants = new Set();
  const visit = managerId => {
    data.employees
      .filter(employee => employee.active !== false && employee.managerId === managerId)
      .forEach(employee => {
        if (descendants.has(employee.id)) return;
        descendants.add(employee.id);
        visit(employee.id);
      });
  };
  visit(employeeId);
  return descendants;
}

export function isEmployeeBelow(managerId, employeeId) {
  return getEmployeeDescendantIds(managerId).has(employeeId);
}

export function canManageActionItem(actorId, task) {
  const actor = data.employees.find(employee => employee.id === actorId && employee.active !== false);
  if (!actor) return false;
  if (actor.rosterRole === 'DM') return true;
  const project = data.jobs.find(job => job.id === task?.projectId);
  if (actor.rosterRole === 'Estimator') return Boolean(project && project.ownerId === actor.id);
  const scopeOwnerId = project?.ownerId || task?.scopeOwnerId || '';
  if (!scopeOwnerId) return false;
  return scopeOwnerId === actor.id || isEmployeeBelow(actor.id, scopeOwnerId);
}

export function canAssignActionItem(actorId, targetEmployeeId, task) {
  const actor = data.employees.find(employee => employee.id === actorId && employee.active !== false);
  const target = data.employees.find(employee => employee.id === targetEmployeeId && employee.active !== false);
  if (!actor || !target) return false;
  if (actor.id === target.id) return !task.assigneeId || task.assigneeId === actor.id;
  if (!canManageActionItem(actorId, task)) return false;
  if (actor.rosterRole === 'Estimator') {
    const project = data.jobs.find(job => job.id === task.projectId);
    return Boolean(project?.ownerId === actor.id
      && target.rosterRole === 'Estimator'
      && target.managerId
      && target.managerId === actor.managerId);
  }
  return isEmployeeBelow(actor.id, target.id);
}

export function canWorkActionItem(actorId, task) {
  return Boolean(actorId && task?.assigneeId === actorId);
}

export function copyWeekAssignments(sourceWeekKey, targetWeekKey) {
  const source = getAssignmentsForWeek(sourceWeekKey);
  if (Object.keys(source).length === 0) return false;
  data.assignments[targetWeekKey] = structuredCloneSafe(source);
  Object.values(data.assignments[targetWeekKey]).forEach(employeeAssignments => {
    Object.values(employeeAssignments).forEach(assignment => {
      assignment.status = 'Proposed';
      assignment.note = '';
    });
  });
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
    tasks: structuredCloneSafe(data.tasks),
    timeOff: structuredCloneSafe(data.timeOff),
    checkIns: structuredCloneSafe(data.checkIns),
    goals: structuredCloneSafe(data.goals),
    oneOnOnes: structuredCloneSafe(data.oneOnOnes),
    activity: structuredCloneSafe(data.activity),
    currentUserId: data.currentUserId,
    currentWeekStart: data.currentWeekStart.toISOString()
  };
}

export function replaceData(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  data.employees = normalized.employees;
  data.jobs = normalized.jobs;
  data.assignments = normalized.assignments;
  data.tasks = normalized.tasks;
  data.timeOff = normalized.timeOff;
  data.checkIns = normalized.checkIns;
  data.goals = normalized.goals;
  data.oneOnOnes = normalized.oneOnOnes;
  data.activity = normalized.activity;
  data.currentUserId = normalized.currentUserId;
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

  const legacyLeadManagers = new Map(snapshot.employees
    .filter(employee => employee?.rosterRole === 'Lead')
    .map(employee => [employee.id, employee.managerId || '']));
  const employees = snapshot.employees.map(normalizeEmployee);
  assertUniqueIds(employees, 'employee');
  const employeeIds = new Set(employees.map(employee => employee.id));
  const employeesById = new Map(employees.map(employee => [employee.id, employee]));
  const roleRank = { DM: 3, ADM: 2, Estimator: 1 };
  employees.forEach(employee => {
    if (legacyLeadManagers.has(employee.managerId)) {
      employee.managerId = legacyLeadManagers.get(employee.managerId) || '';
    }
    const manager = employeesById.get(employee.managerId);
    if (!manager || manager.id === employee.id
      || roleRank[manager.rosterRole] <= roleRank[employee.rosterRole]) employee.managerId = '';
  });
  removeRosterCycles(employees);
  const jobs = snapshot.jobs.map((job, index) => normalizeJob(job, index, employeeIds));
  assertUniqueIds(jobs, 'job');

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
          status: ASSIGNMENT_STATUSES.includes(assignment.status) ? assignment.status : 'Proposed',
          note: String(assignment.note || '').trim(),
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

  const currentWeekValue = String(snapshot.currentWeekStart || '');
  const parsedDate = WEEK_KEY_PATTERN.test(currentWeekValue)
    ? new Date(`${currentWeekValue}T12:00:00`)
    : snapshot.currentWeekStart ? new Date(snapshot.currentWeekStart) : new Date();
  const tasks = normalizeArray(snapshot.tasks, item => normalizeTask(item, employeeIds, jobIds));
  const timeOff = normalizeArray(snapshot.timeOff, item => normalizeTimeOff(item, employeeIds));
  const checkIns = normalizeArray(snapshot.checkIns, item => normalizeCheckIn(item, employeeIds));
  const goals = normalizeArray(snapshot.goals, item => normalizeGoal(item, employeeIds));
  const oneOnOnes = normalizeArray(snapshot.oneOnOnes, item => normalizeOneOnOne(item, employeeIds));
  const activity = normalizeArray(snapshot.activity, normalizeActivity).slice(0, 500);
  return {
    employees,
    jobs,
    assignments,
    tasks,
    timeOff,
    checkIns,
    goals,
    oneOnOnes,
    activity,
    currentUserId: employeesById.get(snapshot.currentUserId)?.active !== false
      && employeeIds.has(snapshot.currentUserId) ? snapshot.currentUserId : '',
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
    district: employee.district === 'Flex'
      ? 'E&I'
      : DISTRICTS.includes(employee.district) ? employee.district : DEFAULT_DISTRICT,
    rosterRole: employee.rosterRole === 'Lead'
      ? 'Estimator'
      : ORG_ROLES.includes(employee.rosterRole)
        ? employee.rosterRole
      : ORG_ROLES.includes(employee.title) ? employee.title : 'Estimator',
    managerId: typeof employee.managerId === 'string' ? employee.managerId : '',
    collapsed: Boolean(employee.collapsed),
    active: employee.active !== false,
    archivedAt: normalizeDate(employee.archivedAt),
    title: String(employee.title || '').trim(),
    email: String(employee.email || '').trim(),
    phone: String(employee.phone || '').trim(),
    skills: Array.isArray(employee.skills)
      ? employee.skills.map(skill => String(skill).trim()).filter(Boolean).slice(0, 30)
      : String(employee.skills || '').split(',').map(skill => skill.trim()).filter(Boolean).slice(0, 30),
    hireDate: normalizeDate(employee.hireDate),
    managerNotes: String(employee.managerNotes || '').trim()
  };
}

function normalizeJob(job, index, employeeIds) {
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
    hoursBudget: toNonNegativeNumber(job.hoursBudget),
    ownerId: typeof job.ownerId === 'string' && employeeIds.has(job.ownerId) ? job.ownerId : '',
    discipline: DISTRICTS.includes(job.discipline) ? job.discipline : DEFAULT_DISTRICT,
    checklist: Array.isArray(job.checklist) && job.checklist.length
      ? job.checklist.map(item => normalizeChecklistItem(item, employeeIds)).filter(Boolean)
      : createDefaultProjectChecklist(),
    priority: PRIORITIES.includes(job.priority) ? job.priority : 'Medium',
    health: PROJECT_HEALTH.includes(job.health) ? job.health : (job.category === 'Complete' ? 'Complete' : 'On track'),
    startDate: normalizeDate(job.startDate),
    dueDate: normalizeDate(job.dueDate),
    description: String(job.description || '').trim()
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

function normalizeChecklistItem(item, employeeIds) {
  if (!item || typeof item !== 'object') return null;
  const name = String(item.name || '').trim();
  if (!name) return null;
  return {
    id: normalizeId(item.id, `checklist-${uuid()}`),
    name,
    type: item.type === 'Takeoff' ? 'Takeoff' : 'Procedure',
    discipline: DISTRICTS.includes(item.discipline) ? item.discipline : 'E&I',
    complete: Boolean(item.complete),
    completedAt: normalizeTimestampOrEmpty(item.completedAt),
    completedById: employeeIds.has(item.completedById) ? item.completedById : ''
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

function normalizeTask(task, employeeIds, jobIds) {
  if (!task || typeof task !== 'object') return null;
  const title = String(task.title || '').trim();
  if (!title) return null;
  return {
    id: normalizeId(task.id, `task-${uuid()}`),
    title,
    projectId: typeof task.projectId === 'string' && jobIds.has(task.projectId) ? task.projectId : '',
    assigneeId: typeof task.assigneeId === 'string' && employeeIds.has(task.assigneeId) ? task.assigneeId : '',
    status: TASK_STATUSES.includes(task.status) ? task.status : 'To do',
    priority: PRIORITIES.includes(task.priority) ? task.priority : 'Medium',
    dueDate: normalizeDate(task.dueDate),
    description: String(task.description || '').trim(),
    budgetHours: toNonNegativeNumber(task.budgetHours),
    wbs: String(task.wbs || '').trim(),
    io: String(task.io || '').trim(),
    workGroup: ['Electrical', 'Instrumentation'].includes(task.workGroup)
      ? task.workGroup
      : 'Electrical',
    plannedWeekKey: WEEK_KEY_PATTERN.test(task.plannedWeekKey || '')
      ? task.plannedWeekKey
      : '',
    progress: Math.min(100, Math.max(0, Number(task.progress) || (task.status === 'Done' ? 100 : 0))),
    scopeOwnerId: typeof task.scopeOwnerId === 'string' && employeeIds.has(task.scopeOwnerId)
      ? task.scopeOwnerId
      : '',
    assignedById: typeof task.assignedById === 'string' && employeeIds.has(task.assignedById)
      ? task.assignedById
      : '',
    workLogs: normalizeArray(task.workLogs, log => normalizeTaskWorkLog(log, employeeIds)),
    notes: normalizeArray(task.notes, note => normalizeTaskNote(note, employeeIds)),
    createdAt: normalizeTimestamp(task.createdAt),
    updatedAt: normalizeTimestamp(task.updatedAt || task.createdAt)
  };
}

function normalizeTaskWorkLog(log, employeeIds) {
  if (!log || typeof log !== 'object' || !employeeIds.has(log.employeeId)) return null;
  return {
    id: normalizeId(log.id, `work-log-${uuid()}`),
    employeeId: log.employeeId,
    hours: toNonNegativeNumber(log.hours),
    createdAt: normalizeTimestamp(log.createdAt)
  };
}

function normalizeTaskNote(note, employeeIds) {
  if (!note || typeof note !== 'object') return null;
  const text = String(note.text || '').trim();
  if (!text) return null;
  return {
    id: normalizeId(note.id, `task-note-${uuid()}`),
    employeeId: employeeIds.has(note.employeeId) ? note.employeeId : '',
    text,
    progress: Math.min(100, Math.max(0, Number(note.progress) || 0)),
    createdAt: normalizeTimestamp(note.createdAt)
  };
}

function normalizeTimeOff(entry, employeeIds) {
  if (!entry || typeof entry !== 'object' || !employeeIds.has(entry.employeeId)) return null;
  const startDate = normalizeDate(entry.startDate);
  const endDate = normalizeDate(entry.endDate);
  if (!startDate || !endDate || endDate < startDate) return null;
  return {
    id: normalizeId(entry.id, `leave-${uuid()}`),
    employeeId: entry.employeeId,
    type: ['Vacation', 'Sick', 'Training', 'Other'].includes(entry.type) ? entry.type : 'Other',
    startDate,
    endDate,
    hoursPerWeek: toNonNegativeNumber(entry.hoursPerWeek),
    status: ['Pending', 'Approved', 'Declined'].includes(entry.status) ? entry.status : 'Pending',
    note: String(entry.note || '').trim()
  };
}

function normalizeCheckIn(entry, employeeIds) {
  if (!entry || typeof entry !== 'object' || !employeeIds.has(entry.employeeId)
    || !WEEK_KEY_PATTERN.test(entry.weekKey || '')) return null;
  return {
    id: normalizeId(entry.id, `checkin-${uuid()}`),
    employeeId: entry.employeeId,
    weekKey: entry.weekKey,
    accomplishments: String(entry.accomplishments || '').trim(),
    blockers: String(entry.blockers || '').trim(),
    nextWeek: String(entry.nextWeek || '').trim(),
    morale: Math.min(5, Math.max(1, Number(entry.morale) || 3)),
    submittedAt: normalizeTimestamp(entry.submittedAt)
  };
}

function normalizeGoal(goal, employeeIds) {
  if (!goal || typeof goal !== 'object' || !employeeIds.has(goal.employeeId)) return null;
  const title = String(goal.title || '').trim();
  if (!title) return null;
  return {
    id: normalizeId(goal.id, `goal-${uuid()}`),
    employeeId: goal.employeeId,
    title,
    dueDate: normalizeDate(goal.dueDate),
    status: ['Not started', 'In progress', 'At risk', 'Complete'].includes(goal.status)
      ? goal.status
      : 'Not started',
    progress: Math.min(100, Math.max(0, Number(goal.progress) || 0)),
    note: String(goal.note || '').trim()
  };
}

function normalizeOneOnOne(meeting, employeeIds) {
  if (!meeting || typeof meeting !== 'object' || !employeeIds.has(meeting.employeeId)) return null;
  return {
    id: normalizeId(meeting.id, `one-on-one-${uuid()}`),
    employeeId: meeting.employeeId,
    date: normalizeDate(meeting.date),
    agenda: String(meeting.agenda || '').trim(),
    notes: String(meeting.notes || '').trim(),
    actions: String(meeting.actions || '').trim(),
    complete: Boolean(meeting.complete)
  };
}

function normalizeActivity(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const message = String(entry.message || '').trim();
  if (!message) return null;
  return {
    id: normalizeId(entry.id, `activity-${uuid()}`),
    timestamp: normalizeTimestamp(entry.timestamp),
    type: String(entry.type || 'Update'),
    message,
    entityType: String(entry.entityType || ''),
    entityId: String(entry.entityId || ''),
    actorId: String(entry.actorId || '')
  };
}

function removeRosterCycles(employees) {
  const byId = new Map(employees.map(employee => [employee.id, employee]));
  employees.forEach(employee => {
    const visited = new Set([employee.id]);
    let current = employee;
    while (current.managerId) {
      if (visited.has(current.managerId)) {
        employee.managerId = '';
        break;
      }
      visited.add(current.managerId);
      current = byId.get(current.managerId);
      if (!current) break;
    }
  });
}

function normalizeArray(value, normalizer) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizer).filter(Boolean);
}

function normalizeDate(value) {
  const date = String(value || '');
  return WEEK_KEY_PATTERN.test(date) && !Number.isNaN(new Date(`${date}T12:00:00`).getTime())
    ? date
    : '';
}

function normalizeTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeTimestampOrEmpty(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
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
