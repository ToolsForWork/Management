import {
  data,
  uuid,
  PRIORITIES,
  DEFAULT_WBS,
  DEFAULT_IO,
  recordActivity,
  scheduleSave
} from './data.js';
import { parseRosterCsv } from './roster.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function applyActionItemsCsv(text, sourceName = 'CSV file', options = {}) {
  const rows = parseRosterCsv(text);
  if (rows.length < 2) throw new Error('The action-item CSV has no task rows.');
  const headers = rows[0].map(value => value.trim().toLowerCase());
  if (!headers.includes('source id') || !headers.includes('action')) {
    throw new Error('The action-item CSV needs Source ID and Action columns.');
  }
  const records = rows.slice(1)
    .map(row => Object.fromEntries(headers.map((header, index) => [header, String(row[index] || '').trim()])))
    .filter(record => record['source id'] && record.action);
  if (!records.length) throw new Error('The action-item CSV has no valid actions.');

  let added = 0;
  let updated = 0;
  records.forEach(record => {
    const existing = data.tasks.find(task => task.externalId === record['source id']);
    const assignee = employeeByName(record['assigned to']);
    const reviewer = employeeByName(record.reviewer);
    const progress = clamp(Number(record['progress %']) || 0, 0, 100);
    const sourceStatus = record.status || '';
    const mapped = {
      title: record.action,
      projectId: existing?.projectId || '',
      status: mapStatus(sourceStatus, record['status bucket'], progress),
      priority: PRIORITIES.includes(record.priority) ? record.priority : 'Medium',
      dueDate: DATE_PATTERN.test(record['due date']) ? record['due date'] : '',
      description: record.deliverable || '',
      budgetHours: nonNegative(record['budget hours']),
      wbs: record.wbs || DEFAULT_WBS,
      io: record.io || DEFAULT_IO.Unutilized,
      workGroup: record['work group'] === 'Instrumentation' ? 'Instrumentation' : 'Electrical',
      plannedWeekKey: DATE_PATTERN.test(record['planned week']) ? record['planned week'] : '',
      progress,
      scopeOwnerId: reviewer?.id || assignee?.managerId || existing?.scopeOwnerId || '',
      sourceType: 'Initiative',
      externalId: record['source id'],
      sourceItemNumber: record['item #'] || '',
      initiative: record.initiative || 'Department initiatives',
      discipline: record.discipline || 'E&I Department',
      category: record.category || '',
      deliverable: record.deliverable || '',
      reviewerName: record.reviewer || '',
      reviewerId: reviewer?.id || '',
      sourceStatus,
      sourceNotes: record.notes || '',
      sourceAssigneeName: record['assigned to'] || '',
      sourceDue: record['source due'] || '',
      dueQuarter: record['due quarter'] || '',
      priorityWeight: nonNegative(record['priority weight']),
      updatedAt: new Date().toISOString()
    };
    if (existing) {
      if (!existing.assigneeId && assignee) existing.assigneeId = assignee.id;
      Object.assign(existing, mapped);
      updated += 1;
      return;
    }
    data.tasks.push({
      id: uuid(),
      ...mapped,
      assigneeId: assignee?.id || '',
      assignedById: '',
      workLogs: [],
      notes: [],
      createdAt: new Date().toISOString()
    });
    added += 1;
  });

  if (!options.silent) recordActivity('Action import', `${added} added and ${updated} updated from ${sourceName}.`);
  scheduleSave();
  return { added, updated, total: records.length };
}

export async function autoLoadActionItems() {
  if (data.tasks.some(task => task.sourceType === 'Initiative')) return false;
  try {
    const response = await fetch('./data/action-items.csv', { cache: 'no-store' });
    if (!response.ok) return false;
    applyActionItemsCsv(await response.text(), 'data/action-items.csv', { silent: true });
    return true;
  } catch (error) {
    console.warn('Bundled action items could not be loaded:', error);
    return false;
  }
}

function employeeByName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  return normalized
    ? data.employees.find(employee => employee.active !== false && employee.name.toLowerCase() === normalized)
    : null;
}

function mapStatus(sourceStatus, statusBucket, progress) {
  if (progress >= 100 || /closed|complete/i.test(statusBucket)) return 'Done';
  if (/hold|pause/i.test(sourceStatus) || /blocked/i.test(statusBucket)) return 'Blocked';
  if (/not started/i.test(sourceStatus) && progress === 0) return 'To do';
  return progress > 0 || sourceStatus ? 'In progress' : 'To do';
}

function nonNegative(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
