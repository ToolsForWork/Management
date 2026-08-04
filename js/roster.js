import {
  data,
  uuid,
  DISTRICTS,
  recordActivity,
  scheduleSave
} from './data.js';

export function parseRosterCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value);
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
      value = '';
    } else value += character;
  }
  row.push(value);
  if (row.some(cell => cell.trim())) rows.push(row);
  return rows;
}

export function applyRosterCsv(text, sourceName = 'CSV file') {
  const rows = parseRosterCsv(text);
  if (rows.length < 2) throw new Error('The roster CSV has no employee rows.');
  const headers = rows[0].map(value => value.trim().toLowerCase());
  if (!headers.includes('name')) throw new Error('The roster CSV needs a Name column.');
  const records = rows.slice(1)
    .map(row => Object.fromEntries(headers.map((header, index) => [header, String(row[index] || '').trim()])))
    .filter(record => record.name);
  if (!records.length) throw new Error('The roster CSV has no named employees.');

  let added = 0;
  let updated = 0;
  const pendingManagers = new Map();
  records.forEach(record => {
    const email = record.email.toLowerCase();
    const existing = data.employees.find(employee =>
      (email && employee.email?.toLowerCase() === email)
      || employee.name.toLowerCase() === record.name.toLowerCase()
    );
    const roleText = record.role === 'Lead' ? 'Estimator' : record.role;
    const rosterRole = ['DM', 'ADM'].includes(roleText) ? roleText : 'Estimator';
    const districtText = record.group || record.district;
    const district = DISTRICTS.includes(districtText) ? districtText : 'Electrical';
    if (existing) {
      Object.assign(existing, {
        name: record.name,
        rosterRole,
        district,
        email: record.email || existing.email || '',
        weeklyBudget: Number(record.hours) > 0 ? Number(record.hours) : existing.weeklyBudget || 40,
        active: true,
        archivedAt: ''
      });
      pendingManagers.set(existing.id, record['reports to'] || '');
      updated += 1;
      return;
    }
    const employee = {
      id: uuid(),
      name: record.name,
      weeklyBudget: Number(record.hours) > 0 ? Number(record.hours) : 40,
      district,
      rosterRole,
      managerId: '',
      email: record.email || '',
      collapsed: false,
      active: true,
      archivedAt: '',
      title: '',
      phone: '',
      skills: [],
      hireDate: '',
      managerNotes: ''
    };
    data.employees.push(employee);
    pendingManagers.set(employee.id, record['reports to'] || '');
    added += 1;
  });

  const active = data.employees.filter(employee => employee.active !== false);
  const byName = new Map(active.map(employee => [employee.name.toLowerCase(), employee]));
  const dm = active.find(employee => employee.rosterRole === 'DM');
  const adms = active.filter(employee => employee.rosterRole === 'ADM');
  pendingManagers.forEach((reportsToName, employeeId) => {
    const employee = data.employees.find(candidate => candidate.id === employeeId);
    if (!employee) return;
    if (employee.rosterRole === 'DM') {
      employee.managerId = '';
      return;
    }
    const explicit = byName.get(reportsToName.toLowerCase());
    const validExplicitManager = explicit && explicit.id !== employee.id
      && ((employee.rosterRole === 'ADM' && explicit.rosterRole === 'DM')
        || (employee.rosterRole === 'Estimator' && explicit.rosterRole === 'ADM'));
    if (validExplicitManager) {
      employee.managerId = explicit.id;
      return;
    }
    if (reportsToName) employee.managerId = '';
    if (employee.managerId) return;
    employee.managerId = employee.rosterRole === 'ADM'
      ? dm?.id || ''
      : adms.find(adm => adm.district === employee.district || adm.district === 'E&I')?.id
        || adms[0]?.id
        || dm?.id
        || '';
  });

  data.tasks.forEach(task => {
    const importedAssignee = byName.get(String(task.sourceAssigneeName || '').toLowerCase());
    const importedReviewer = byName.get(String(task.reviewerName || '').toLowerCase());
    if (!task.assigneeId && importedAssignee) task.assigneeId = importedAssignee.id;
    if (importedReviewer) {
      task.reviewerId = importedReviewer.id;
      if (!task.scopeOwnerId) task.scopeOwnerId = importedReviewer.id;
    }
  });

  if (!data.currentUserId) data.currentUserId = dm?.id || active[0]?.id || '';
  recordActivity('Roster', `${added} added and ${updated} updated from ${sourceName}.`);
  scheduleSave();
  return { added, updated, total: records.length };
}

export async function autoLoadRoster() {
  if (data.employees.length) return false;
  try {
    const response = await fetch('./data/roster.csv', { cache: 'no-store' });
    if (!response.ok) return false;
    const text = await response.text();
    if (parseRosterCsv(text).length < 2) return false;
    applyRosterCsv(text, 'data/roster.csv');
    return true;
  } catch (error) {
    console.warn('Roster CSV could not be loaded:', error);
    return false;
  }
}
