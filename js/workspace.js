import {
  data,
  uuid,
  getCurrentWeekKey,
  totalHoursAllEmployees,
  totalEmployeeCapacity,
  getAlerts,
  getEffectiveEmployeeCapacity,
  recordActivity,
  scheduleSave,
  PRIORITIES,
  TASK_STATUSES,
  PROJECT_HEALTH
} from './data.js';
import { showToast, renderJobs, renderEmployees } from './ui.js';
import { forceChartUpdate } from './charts.js';

let activeTab = 'overview';
let dialogSubmit = null;

export function initializeWorkspace() {
  document.getElementById('workspaceBtn').addEventListener('click', openWorkspace);
  document.getElementById('closeWorkspaceBtn').addEventListener('click', closeWorkspace);
  document.getElementById('workspaceTabs').addEventListener('click', event => {
    const button = event.target.closest('[data-workspace-tab]');
    if (!button) return;
    activeTab = button.dataset.workspaceTab;
    renderWorkspace();
  });

  const dialog = document.getElementById('managementDialog');
  document.getElementById('closeManagementDialogBtn').addEventListener('click', () => dialog.close());
  document.getElementById('cancelManagementDialogBtn').addEventListener('click', () => dialog.close());
  document.getElementById('managementForm').addEventListener('submit', event => {
    event.preventDefault();
    if (dialogSubmit?.()) dialog.close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.getElementById('workspaceOverlay').classList.contains('hidden')) {
      closeWorkspace();
    }
  });
  document.addEventListener('planner:datachange', refreshWorkspaceSummary);
  refreshWorkspaceSummary();
}

export function refreshWorkspaceSummary() {
  const badge = document.getElementById('workspaceAlertBadge');
  const count = getAlerts().length;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.classList.toggle('hidden', count === 0);
  badge.setAttribute('aria-label', `${count} management ${count === 1 ? 'alert' : 'alerts'}`);
}

export function renderWorkspace() {
  refreshWorkspaceSummary();
  document.querySelectorAll('[data-workspace-tab]').forEach(button => {
    const selected = button.dataset.workspaceTab === activeTab;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-current', selected ? 'page' : 'false');
  });

  const content = document.getElementById('workspaceContent');
  content.replaceChildren();
  const renderers = {
    overview: renderOverview,
    projects: renderProjects,
    tasks: renderTasks,
    people: renderPeople,
    activity: renderActivity
  };
  content.appendChild((renderers[activeTab] || renderOverview)());
}

function openWorkspace() {
  document.getElementById('workspaceOverlay').classList.remove('hidden');
  [document.querySelector('body > header'), document.querySelector('.container')].forEach(element => {
    element.inert = true;
    element.hidden = true;
  });
  document.body.classList.add('workspace-open');
  renderWorkspace();
}

function closeWorkspace() {
  document.getElementById('workspaceOverlay').classList.add('hidden');
  [document.querySelector('body > header'), document.querySelector('.container')].forEach(element => {
    element.inert = false;
    element.hidden = false;
  });
  document.body.classList.remove('workspace-open');
}

function renderOverview() {
  const wrapper = element('div', 'workspace-view');
  wrapper.append(viewHeading('Operational overview', 'What needs attention across the current week.'));

  const weekKey = getCurrentWeekKey();
  const capacity = totalEmployeeCapacity(weekKey);
  const allocated = totalHoursAllEmployees(weekKey);
  const openTasks = data.tasks.filter(task => task.status !== 'Done');
  const activeProjects = data.jobs.filter(job => job.category !== 'Complete');
  const checkInCount = new Set(
    data.checkIns.filter(checkIn => checkIn.weekKey === weekKey).map(checkIn => checkIn.employeeId)
  ).size;
  const activePeople = data.employees.filter(employee => employee.active !== false);

  const metrics = element('div', 'metric-grid');
  metrics.append(
    metricCard('Team utilization', capacity ? `${Math.round((allocated / capacity) * 100)}%` : '0%', `${formatHours(allocated)} of ${formatHours(capacity)} hours`),
    metricCard('Active projects', activeProjects.length, `${activeProjects.filter(project => project.health === 'At risk' || project.health === 'Off track').length} need attention`),
    metricCard('Open actions', openTasks.length, `${openTasks.filter(task => task.status === 'Blocked').length} blocked`),
    metricCard('Weekly check-ins', `${checkInCount}/${activePeople.length}`, 'Submitted this week')
  );
  wrapper.appendChild(metrics);

  const grid = element('div', 'workspace-dashboard-grid');
  grid.append(
    dashboardPanel('Alerts', renderAlerts(), 'View work', () => switchTab('tasks')),
    dashboardPanel('Upcoming deadlines', renderDeadlines(), 'View projects', () => switchTab('projects')),
    dashboardPanel('Availability and approvals', renderApprovals(), 'View people', () => switchTab('people')),
    dashboardPanel('Recent activity', renderActivityItems(6), 'View history', () => switchTab('activity'))
  );
  wrapper.appendChild(grid);
  return wrapper;
}

function renderAlerts() {
  const alerts = getAlerts().slice(0, 8);
  if (!alerts.length) return emptyState('No active alerts', 'Capacity, deadlines, and assignment responses look healthy.');
  const list = element('div', 'workspace-list');
  alerts.forEach(alert => {
    const row = element('div', 'alert-row');
    row.append(chip(alert.severity, severityClass(alert.severity)));
    const text = element('div');
    text.append(element('strong', '', alert.type), element('span', '', alert.message));
    row.appendChild(text);
    list.appendChild(row);
  });
  return list;
}

function renderDeadlines() {
  const items = [
    ...data.jobs.filter(job => job.dueDate && job.category !== 'Complete').map(job => ({
      date: job.dueDate,
      title: job.name,
      meta: `Project · ${job.health}`
    })),
    ...data.tasks.filter(task => task.dueDate && task.status !== 'Done').map(task => ({
      date: task.dueDate,
      title: task.title,
      meta: `Action · ${task.status}`
    }))
  ].sort((left, right) => left.date.localeCompare(right.date)).slice(0, 8);

  if (!items.length) return emptyState('No upcoming deadlines', 'Add due dates to projects and actions to build the schedule.');
  const list = element('div', 'workspace-list');
  items.forEach(item => {
    const row = element('div', 'deadline-row');
    row.append(dateTile(item.date));
    const text = element('div');
    text.append(element('strong', '', item.title), element('span', '', item.meta));
    row.appendChild(text);
    list.appendChild(row);
  });
  return list;
}

function renderApprovals() {
  const pendingLeave = data.timeOff.filter(entry => entry.status === 'Pending');
  const changeRequests = [];
  const week = data.assignments[getCurrentWeekKey()] || {};
  Object.entries(week).forEach(([employeeId, assignments]) => {
    Object.entries(assignments).forEach(([projectId, assignment]) => {
      if (assignment.status === 'Needs change') changeRequests.push({ employeeId, projectId, assignment });
    });
  });

  if (!pendingLeave.length && !changeRequests.length) {
    return emptyState('Nothing awaiting review', 'Leave requests and assignment responses are up to date.');
  }
  const list = element('div', 'workspace-list');
  pendingLeave.slice(0, 5).forEach(entry => {
    const employee = employeeById(entry.employeeId);
    const row = element('div', 'approval-row');
    const copy = element('div');
    copy.append(
      element('strong', '', `${employee?.name || 'Former employee'} · ${entry.type}`),
      element('span', '', `${entry.startDate} to ${entry.endDate} · ${formatHours(entry.hoursPerWeek)} hrs/week`)
    );
    const actions = element('div', 'compact-actions');
    actions.append(
      actionButton('Approve', () => updateLeaveStatus(entry, 'Approved')),
      actionButton('Decline', () => updateLeaveStatus(entry, 'Declined'), 'secondary-button')
    );
    row.append(copy, actions);
    list.appendChild(row);
  });
  changeRequests.slice(0, 5).forEach(request => {
    const employee = employeeById(request.employeeId);
    const project = projectById(request.projectId);
    const row = element('div', 'approval-row');
    const copy = element('div');
    copy.append(
      element('strong', '', `${employee?.name || 'Employee'} · ${project?.name || 'Project'}`),
      element('span', '', request.assignment.note || 'Assignment change requested')
    );
    row.append(copy, chip('Needs change', 'chip-warning'));
    list.appendChild(row);
  });
  return list;
}

function renderProjects() {
  const wrapper = element('div', 'workspace-view');
  wrapper.append(viewHeading('Project portfolio', 'Ownership, health, priority, dates, and delivery context.'));

  if (!data.jobs.length) {
    wrapper.appendChild(emptyState('No projects yet', 'Create projects in the planner, then manage delivery details here.'));
    return wrapper;
  }
  const grid = element('div', 'portfolio-grid');
  [...data.jobs]
    .sort((left, right) => projectSortKey(left).localeCompare(projectSortKey(right)))
    .forEach(project => grid.appendChild(projectCard(project)));
  wrapper.appendChild(grid);
  return wrapper;
}

function projectCard(project) {
  const card = element('article', 'portfolio-card');
  card.style.setProperty('--project-color', project.color);
  const owner = employeeById(project.ownerId);
  const charged = totalProjectHours(project.id);
  const progress = project.hoursBudget > 0 ? Math.min(100, Math.round((charged / project.hoursBudget) * 100)) : 0;
  const heading = element('div', 'portfolio-card-heading');
  const title = element('div');
  title.append(element('h3', '', project.name), element('span', '', owner ? `Owner: ${owner.name}` : 'Owner not assigned'));
  heading.append(title, actionButton('Edit details', () => openProjectForm(project), 'secondary-button'));
  const chips = element('div', 'chip-row');
  chips.append(chip(project.health || 'On track', healthClass(project.health)), chip(project.priority || 'Medium', priorityClass(project.priority)));
  if (project.dueDate) chips.appendChild(chip(`Due ${project.dueDate}`, 'chip-neutral'));
  card.append(heading, chips);
  if (project.description) card.appendChild(element('p', 'card-description', project.description));

  const progressBlock = element('div', 'project-progress');
  const progressLabel = element('div');
  progressLabel.append(element('span', '', project.hoursBudget ? `${formatHours(charged)} / ${formatHours(project.hoursBudget)} budget hrs` : `${formatHours(charged)} hrs allocated`), element('strong', '', project.hoursBudget ? `${progress}%` : 'No budget'));
  const bar = element('div', 'progress-track');
  const fill = element('div', 'progress-fill');
  fill.style.width = `${progress}%`;
  bar.appendChild(fill);
  progressBlock.append(progressLabel, bar);
  card.appendChild(progressBlock);

  const footer = element('div', 'portfolio-card-footer');
  footer.append(
    element('span', '', `${data.tasks.filter(task => task.projectId === project.id && task.status !== 'Done').length} open actions`),
    element('span', '', project.startDate && project.dueDate
      ? `${project.startDate} → ${project.dueDate}`
      : project.dueDate ? `Due ${project.dueDate}`
        : project.startDate ? `Starts ${project.startDate}`
          : 'Dates not set')
  );
  card.appendChild(footer);
  return card;
}

function renderTasks() {
  const wrapper = element('div', 'workspace-view');
  const heading = viewHeading('Action items', 'Track accountable work across every project and team member.');
  heading.appendChild(actionButton('Add action', () => openTaskForm()));
  wrapper.appendChild(heading);

  const controls = element('div', 'workspace-filters');
  const search = fieldControl('search', 'Search actions', '');
  const status = selectControl('Status', ['', ...TASK_STATUSES], '');
  const owner = selectControl('Assignee', [['', 'All assignees'], ...activeEmployees().map(employee => [employee.id, employee.name])], '');
  controls.append(search.wrapper, status.wrapper, owner.wrapper);
  wrapper.appendChild(controls);

  const list = element('div', 'task-board');
  const refresh = () => {
    list.replaceChildren();
    const query = search.input.value.trim().toLowerCase();
    const tasks = data.tasks
      .filter(task => !query || task.title.toLowerCase().includes(query) || task.description.toLowerCase().includes(query))
      .filter(task => !status.input.value || task.status === status.input.value)
      .filter(task => !owner.input.value || task.assigneeId === owner.input.value)
      .sort(taskComparator);
    if (!tasks.length) {
      list.appendChild(emptyState('No matching actions', data.tasks.length ? 'Adjust the filters to see more work.' : 'Add the first action item.'));
      return;
    }
    TASK_STATUSES.forEach(groupStatus => {
      const groupTasks = tasks.filter(task => task.status === groupStatus);
      if (!groupTasks.length) return;
      const group = element('section', 'task-group');
      const groupHeading = element('div', 'task-group-heading');
      groupHeading.append(element('h3', '', groupStatus), chip(groupTasks.length, 'chip-neutral'));
      group.appendChild(groupHeading);
      groupTasks.forEach(task => group.appendChild(taskRow(task)));
      list.appendChild(group);
    });
  };
  [search.input, status.input, owner.input].forEach(input => input.addEventListener('input', refresh));
  refresh();
  wrapper.appendChild(list);
  return wrapper;
}

function taskRow(task) {
  const row = element('article', `task-row priority-${(task.priority || 'medium').toLowerCase()}`);
  const main = element('div', 'task-main');
  const top = element('div', 'task-title-row');
  top.append(element('strong', '', task.title), chip(task.priority, priorityClass(task.priority)));
  const meta = [
    projectById(task.projectId)?.name || 'No project',
    employeeById(task.assigneeId)?.name || 'Unassigned',
    task.dueDate ? `Due ${task.dueDate}` : 'No due date'
  ].join(' · ');
  main.append(top, element('span', '', meta));
  if (task.description) main.appendChild(element('p', '', task.description));

  const actions = element('div', 'task-actions');
  const status = selectElement(TASK_STATUSES, task.status);
  status.setAttribute('aria-label', `Status for ${task.title}`);
  status.addEventListener('change', () => {
    task.status = status.value;
    commit('Task', `${task.title} moved to ${task.status}.`, 'task', task.id);
    renderWorkspace();
  });
  actions.append(
    status,
    actionButton('Edit', () => openTaskForm(task), 'secondary-button'),
    iconButton('×', `Delete ${task.title}`, () => deleteTask(task))
  );
  row.append(main, actions);
  return row;
}

function renderPeople() {
  const wrapper = element('div', 'workspace-view');
  wrapper.append(viewHeading('People operations', 'Profiles, leave, check-ins, goals, and one-on-ones in one place.'));
  const grid = element('div', 'people-grid');
  [...data.employees]
    .sort((left, right) => Number(left.active === false) - Number(right.active === false) || left.name.localeCompare(right.name))
    .forEach(employee => grid.appendChild(peopleCard(employee)));
  if (!data.employees.length) grid.appendChild(emptyState('No employees yet', 'Add employees in the planner to build team profiles.'));
  wrapper.appendChild(grid);
  return wrapper;
}

function peopleCard(employee) {
  const card = element('article', `people-card${employee.active === false ? ' archived' : ''}`);
  const heading = element('div', 'people-card-heading');
  const identity = element('div', 'person-identity');
  identity.append(avatar(employee.name), element('div'));
  identity.lastChild.append(element('h3', '', employee.name), element('span', '', employee.title || employee.district));
  heading.append(identity, chip(employee.active === false ? 'Archived' : employee.district, employee.active === false ? 'chip-neutral' : 'chip-info'));
  card.appendChild(heading);

  const weekKey = getCurrentWeekKey();
  const effectiveCapacity = getEffectiveEmployeeCapacity(employee, weekKey);
  const latestCheckIn = [...data.checkIns]
    .filter(checkIn => checkIn.employeeId === employee.id)
    .sort((left, right) => right.weekKey.localeCompare(left.weekKey))[0];
  const openGoals = data.goals.filter(goal => goal.employeeId === employee.id && goal.status !== 'Complete');
  const nextOneOnOne = data.oneOnOnes
    .filter(meeting => meeting.employeeId === employee.id && !meeting.complete && meeting.date)
    .sort((left, right) => left.date.localeCompare(right.date))[0];

  const stats = element('div', 'person-stats');
  stats.append(
    personStat('Capacity', `${formatHours(effectiveCapacity)}h`),
    personStat('Open goals', openGoals.length),
    personStat('Last check-in', latestCheckIn?.weekKey || 'Missing'),
    personStat('Next 1:1', nextOneOnOne?.date || 'Not set')
  );
  card.appendChild(stats);

  if (employee.skills?.length) {
    const skills = element('div', 'chip-row');
    employee.skills.slice(0, 5).forEach(skill => skills.appendChild(chip(skill, 'chip-neutral')));
    card.appendChild(skills);
  }

  const actions = element('div', 'people-actions');
  actions.append(
    actionButton('Profile', () => openProfileForm(employee), 'secondary-button'),
    actionButton('Leave', () => openLeaveForm(employee), 'secondary-button'),
    actionButton('Check-in', () => openCheckInForm(employee), 'secondary-button'),
    actionButton('Goal', () => openGoalForm(employee), 'secondary-button'),
    actionButton('1:1', () => openOneOnOneForm(employee), 'secondary-button')
  );
  card.appendChild(actions);

  const details = element('div', 'people-detail-lists');
  const leave = data.timeOff.filter(entry => entry.employeeId === employee.id).sort((left, right) => right.startDate.localeCompare(left.startDate)).slice(0, 3);
  const goals = data.goals.filter(goal => goal.employeeId === employee.id).slice(0, 3);
  const meetings = data.oneOnOnes.filter(meeting => meeting.employeeId === employee.id).sort((left, right) => right.date.localeCompare(left.date)).slice(0, 3);
  const checkIns = data.checkIns.filter(checkIn => checkIn.employeeId === employee.id).sort((left, right) => right.weekKey.localeCompare(left.weekKey)).slice(0, 3);
  if (leave.length) details.appendChild(recordList('Leave', leave, entry => `${entry.startDate} · ${entry.type} · ${entry.status}`, entry => openLeaveForm(employee, entry)));
  if (goals.length) details.appendChild(recordList('Goals', goals, goal => `${goal.title} · ${goal.progress}%`, goal => openGoalForm(employee, goal)));
  if (meetings.length) details.appendChild(recordList('One-on-ones', meetings, meeting => `${meeting.date} · ${meeting.complete ? 'Complete' : 'Planned'}`, meeting => openOneOnOneForm(employee, meeting)));
  if (checkIns.length) details.appendChild(recordList('Check-ins', checkIns, checkIn => `${checkIn.weekKey} · Morale ${checkIn.morale}/5`, checkIn => openCheckInForm(employee, checkIn.weekKey)));
  if (details.children.length) card.appendChild(details);
  return card;
}

function renderActivity() {
  const wrapper = element('div', 'workspace-view');
  wrapper.append(viewHeading('Activity history', 'A local audit trail of planning and management changes.'));
  wrapper.appendChild(renderActivityItems(100));
  return wrapper;
}

function renderActivityItems(limit) {
  if (!data.activity.length) return emptyState('No activity yet', 'Changes made through the management workspace will appear here.');
  const list = element('div', 'activity-list');
  data.activity.slice(0, limit).forEach(item => {
    const row = element('div', 'activity-row');
    row.append(element('div', 'activity-icon', activityInitial(item.type)));
    const copy = element('div');
    copy.append(element('strong', '', item.message), element('span', '', `${item.type} · ${formatTimestamp(item.timestamp)}`));
    row.appendChild(copy);
    list.appendChild(row);
  });
  return list;
}

function openProjectForm(project) {
  openForm({
    eyebrow: 'Project portfolio',
    title: `Edit ${project.name}`,
    fields: [
      field('ownerId', 'Owner', 'select', project.ownerId, [['', 'Unassigned'], ...activeEmployees().map(employee => [employee.id, employee.name])]),
      field('priority', 'Priority', 'select', project.priority, PRIORITIES),
      field('health', 'Health', 'select', project.health, PROJECT_HEALTH),
      field('startDate', 'Start date', 'date', project.startDate),
      field('dueDate', 'Due date', 'date', project.dueDate),
      field('description', 'Description / success criteria', 'textarea', project.description)
    ],
    onSave: values => {
      if (values.startDate && values.dueDate && values.dueDate < values.startDate) {
        showToast('Project due date must be on or after its start date.');
        return false;
      }
      Object.assign(project, values);
      if (project.health === 'Complete') project.category = 'Complete';
      commit('Project', `${project.name} delivery details updated.`, 'project', project.id);
      return true;
    }
  });
}

function openTaskForm(task = null) {
  const editing = Boolean(task);
  openForm({
    eyebrow: 'Action items',
    title: editing ? `Edit ${task.title}` : 'Add action item',
    fields: [
      field('title', 'Action', 'text', task?.title || '', null, true),
      field('projectId', 'Project', 'select', task?.projectId || '', [['', 'No project'], ...data.jobs.map(project => [project.id, project.name])]),
      field('assigneeId', 'Assignee', 'select', task?.assigneeId || '', [['', 'Unassigned'], ...activeEmployees().map(employee => [employee.id, employee.name])]),
      field('status', 'Status', 'select', task?.status || 'To do', TASK_STATUSES),
      field('priority', 'Priority', 'select', task?.priority || 'Medium', PRIORITIES),
      field('dueDate', 'Due date', 'date', task?.dueDate || ''),
      field('description', 'Details', 'textarea', task?.description || '')
    ],
    onSave: values => {
      if (!values.title.trim()) {
        showToast('Enter an action-item title.');
        return false;
      }
      if (editing) {
        Object.assign(task, values);
        commit('Task', `${task.title} updated.`, 'task', task.id);
      } else {
        const created = { id: uuid(), ...values, createdAt: new Date().toISOString() };
        data.tasks.push(created);
        commit('Task', `${created.title} created.`, 'task', created.id);
      }
      return true;
    }
  });
}

function openProfileForm(employee) {
  openForm({
    eyebrow: 'Employee profile',
    title: employee.name,
    fields: [
      field('title', 'Role / title', 'text', employee.title),
      field('email', 'Email', 'email', employee.email),
      field('phone', 'Phone', 'text', employee.phone),
      field('hireDate', 'Hire date', 'date', employee.hireDate),
      field('skills', 'Skills (comma separated)', 'text', (employee.skills || []).join(', ')),
      field('managerNotes', 'Manager notes', 'textarea', employee.managerNotes),
      field('active', 'Active employee', 'checkbox', employee.active !== false)
    ],
    onSave: values => {
      values.skills = values.skills.split(',').map(skill => skill.trim()).filter(Boolean);
      Object.assign(employee, values);
      commit('People', `${employee.name}'s profile updated.`, 'employee', employee.id);
      return true;
    }
  });
}

function openLeaveForm(employee, existing = null) {
  openForm({
    eyebrow: 'Availability',
    title: existing ? `Edit leave for ${employee.name}` : `Add leave for ${employee.name}`,
    fields: [
      field('type', 'Leave type', 'select', existing?.type || 'Vacation', ['Vacation', 'Sick', 'Training', 'Other']),
      field('startDate', 'Start date', 'date', existing?.startDate || '', null, true),
      field('endDate', 'End date', 'date', existing?.endDate || '', null, true),
      field('hoursPerWeek', 'Capacity reduction per week', 'number', existing?.hoursPerWeek ?? employee.weeklyBudget, null, true),
      field('status', 'Approval status', 'select', existing?.status || 'Pending', ['Pending', 'Approved', 'Declined']),
      field('note', 'Note', 'textarea', existing?.note || '')
    ],
    onSave: values => {
      if (!values.startDate || !values.endDate || values.endDate < values.startDate) {
        showToast('Enter a valid leave date range.');
        return false;
      }
      const update = { ...values, hoursPerWeek: Number(values.hoursPerWeek) || 0 };
      if (existing) Object.assign(existing, update);
      else data.timeOff.push({ id: uuid(), employeeId: employee.id, ...update });
      commit('Availability', `${update.type} ${existing ? 'updated' : 'added'} for ${employee.name}.`, 'employee', employee.id);
      return true;
    }
  });
}

function openCheckInForm(employee, weekKey = getCurrentWeekKey()) {
  const existing = data.checkIns.find(checkIn => checkIn.employeeId === employee.id && checkIn.weekKey === weekKey);
  openForm({
    eyebrow: 'Weekly check-in',
    title: `${employee.name} · ${weekKey}`,
    fields: [
      field('accomplishments', 'Wins and accomplishments', 'textarea', existing?.accomplishments || ''),
      field('blockers', 'Blockers / help needed', 'textarea', existing?.blockers || ''),
      field('nextWeek', 'Next priorities', 'textarea', existing?.nextWeek || ''),
      field('morale', 'Morale', 'select', String(existing?.morale || 3), [['1', '1 · Struggling'], ['2', '2 · Low'], ['3', '3 · Steady'], ['4', '4 · Good'], ['5', '5 · Great']])
    ],
    onSave: values => {
      const update = { ...values, morale: Number(values.morale), submittedAt: new Date().toISOString() };
      if (existing) Object.assign(existing, update);
      else data.checkIns.push({ id: uuid(), employeeId: employee.id, weekKey, ...update });
      commit('Check-in', `${employee.name} submitted a weekly check-in.`, 'employee', employee.id);
      return true;
    }
  });
}

function openGoalForm(employee, existing = null) {
  openForm({
    eyebrow: 'Goals and development',
    title: existing ? `Edit goal for ${employee.name}` : `Add goal for ${employee.name}`,
    fields: [
      field('title', 'Goal', 'text', existing?.title || '', null, true),
      field('dueDate', 'Target date', 'date', existing?.dueDate || ''),
      field('status', 'Status', 'select', existing?.status || 'Not started', ['Not started', 'In progress', 'At risk', 'Complete']),
      field('progress', 'Progress %', 'number', existing?.progress || 0),
      field('note', 'Success measure / notes', 'textarea', existing?.note || '')
    ],
    onSave: values => {
      if (!values.title.trim()) {
        showToast('Enter a goal.');
        return false;
      }
      const update = { ...values, progress: Math.min(100, Math.max(0, Number(values.progress) || 0)) };
      if (update.status === 'Complete') update.progress = 100;
      if (existing) Object.assign(existing, update);
      else data.goals.push({ id: uuid(), employeeId: employee.id, ...update });
      commit('Goal', `${update.title} ${existing ? 'updated' : 'added'} for ${employee.name}.`, 'employee', employee.id);
      return true;
    }
  });
}

function openOneOnOneForm(employee, existing = null) {
  openForm({
    eyebrow: 'One-on-one',
    title: existing ? `Update 1:1 with ${employee.name}` : `Schedule 1:1 with ${employee.name}`,
    fields: [
      field('date', 'Meeting date', 'date', existing?.date || '', null, true),
      field('agenda', 'Agenda', 'textarea', existing?.agenda || ''),
      field('notes', 'Private notes', 'textarea', existing?.notes || ''),
      field('actions', 'Follow-up actions', 'textarea', existing?.actions || ''),
      field('complete', 'Meeting complete', 'checkbox', existing?.complete || false)
    ],
    onSave: values => {
      if (!values.date) {
        showToast('Choose a meeting date.');
        return false;
      }
      if (existing) Object.assign(existing, values);
      else data.oneOnOnes.push({ id: uuid(), employeeId: employee.id, ...values });
      commit('One-on-one', `1:1 ${existing ? 'updated' : 'scheduled'} with ${employee.name} for ${values.date}.`, 'employee', employee.id);
      return true;
    }
  });
}

function openForm(config) {
  document.getElementById('dialogEyebrow').textContent = config.eyebrow;
  document.getElementById('dialogTitle').textContent = config.title;
  const fields = document.getElementById('dialogFields');
  fields.replaceChildren();
  const inputs = new Map();

  config.fields.forEach(definition => {
    const wrapper = element('label', `dialog-field${definition.type === 'textarea' ? ' full-width' : ''}`);
    wrapper.appendChild(element('span', '', definition.label));
    let input;
    if (definition.type === 'select') {
      input = selectElement(definition.options, definition.value);
    } else if (definition.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 4;
      input.value = definition.value || '';
    } else {
      input = document.createElement('input');
      input.type = definition.type;
      if (definition.type === 'checkbox') input.checked = Boolean(definition.value);
      else input.value = definition.value ?? '';
      if (definition.type === 'number') {
        input.min = '0';
        input.step = '0.25';
      }
    }
    input.name = definition.name;
    input.id = `management-${definition.name}`;
    wrapper.htmlFor = input.id;
    input.required = Boolean(definition.required);
    wrapper.appendChild(input);
    inputs.set(definition.name, input);
    fields.appendChild(wrapper);
  });

  dialogSubmit = () => {
    const values = {};
    inputs.forEach((input, name) => {
      values[name] = input.type === 'checkbox' ? input.checked : input.value;
    });
    const saved = config.onSave(values);
    if (saved) renderWorkspace();
    return saved;
  };
  document.getElementById('managementDialog').showModal();
}

function field(name, label, type, value = '', options = null, required = false) {
  return { name, label, type, value, options, required };
}

function commit(type, message, entityType, entityId) {
  recordActivity(type, message, entityType, entityId);
  scheduleSave();
  renderJobs();
  renderEmployees();
  forceChartUpdate();
  refreshWorkspaceSummary();
  showToast(message);
}

function updateLeaveStatus(entry, status) {
  entry.status = status;
  const employee = employeeById(entry.employeeId);
  commit('Availability', `${entry.type} for ${employee?.name || 'employee'} ${status.toLowerCase()}.`, 'employee', entry.employeeId);
  renderWorkspace();
}

function deleteTask(task) {
  if (!window.confirm(`Delete action item "${task.title}"?`)) return;
  data.tasks = data.tasks.filter(candidate => candidate.id !== task.id);
  commit('Task', `${task.title} deleted.`, 'task', task.id);
  renderWorkspace();
}

function switchTab(tab) {
  activeTab = tab;
  renderWorkspace();
}

function viewHeading(title, subtitle) {
  const heading = element('div', 'workspace-view-heading');
  const copy = element('div');
  copy.append(element('h2', '', title), element('p', '', subtitle));
  heading.appendChild(copy);
  return heading;
}

function dashboardPanel(title, content, actionLabel, action) {
  const panel = element('section', 'dashboard-panel');
  const heading = element('div', 'dashboard-panel-heading');
  heading.append(element('h3', '', title), actionButton(actionLabel, action, 'link-button'));
  panel.append(heading, content);
  return panel;
}

function metricCard(label, value, detail) {
  const card = element('article', 'metric-card');
  card.append(element('span', '', label), element('strong', '', value), element('small', '', detail));
  return card;
}

function personStat(label, value) {
  const stat = element('div');
  stat.append(element('span', '', label), element('strong', '', value));
  return stat;
}

function recordList(title, records, label, action) {
  const wrapper = element('div', 'mini-list');
  wrapper.appendChild(element('strong', '', title));
  records.forEach(record => {
    const button = element('button', 'mini-list-button', label(record));
    button.type = 'button';
    button.addEventListener('click', () => action(record));
    wrapper.appendChild(button);
  });
  return wrapper;
}

function emptyState(title, description) {
  const wrapper = element('div', 'workspace-empty');
  wrapper.append(element('strong', '', title), element('span', '', description));
  return wrapper;
}

function actionButton(label, action, className = '') {
  const button = element('button', className, label);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}

function iconButton(label, accessibleName, action) {
  const button = actionButton(label, action, 'icon-button danger-button');
  button.setAttribute('aria-label', accessibleName);
  button.title = accessibleName;
  return button;
}

function chip(label, className) {
  return element('span', `workspace-chip ${className || ''}`, label);
}

function avatar(name) {
  return element('span', 'person-avatar', String(name || '?').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase());
}

function dateTile(date) {
  const parsed = new Date(`${date}T12:00:00`);
  const tile = element('div', 'date-tile');
  tile.append(
    element('span', '', parsed.toLocaleDateString(undefined, { month: 'short' })),
    element('strong', '', parsed.getDate())
  );
  return tile;
}

function fieldControl(type, label, value) {
  const wrapper = element('label', 'filter-control');
  wrapper.appendChild(element('span', '', label));
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.placeholder = label;
  wrapper.appendChild(input);
  return { wrapper, input };
}

function selectControl(label, options, value) {
  const wrapper = element('label', 'filter-control');
  wrapper.appendChild(element('span', '', label));
  const input = selectElement(options, value);
  wrapper.appendChild(input);
  return { wrapper, input };
}

function selectElement(options, selectedValue) {
  const select = document.createElement('select');
  options.forEach(item => {
    const [value, label] = Array.isArray(item) ? item : [item, item || 'All statuses'];
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = String(value) === String(selectedValue ?? '');
    select.appendChild(option);
  });
  return select;
}

function element(tag, className = '', text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

function employeeById(id) {
  return data.employees.find(employee => employee.id === id);
}

function projectById(id) {
  return data.jobs.find(project => project.id === id);
}

function activeEmployees() {
  return data.employees.filter(employee => employee.active !== false);
}

function totalProjectHours(projectId) {
  return Object.values(data.assignments).reduce((total, week) => total + Object.values(week)
    .reduce((weekTotal, assignments) => weekTotal + (Number(assignments[projectId]?.hours) || 0), 0), 0);
}

function taskComparator(left, right) {
  const statusOrder = Object.fromEntries(TASK_STATUSES.map((status, index) => [status, index]));
  const priorityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  return statusOrder[left.status] - statusOrder[right.status]
    || priorityOrder[left.priority] - priorityOrder[right.priority]
    || (left.dueDate || '9999').localeCompare(right.dueDate || '9999');
}

function projectSortKey(project) {
  const healthOrder = { 'Off track': '0', 'At risk': '1', 'On track': '2', Complete: '3' };
  return `${healthOrder[project.health] || '2'}-${project.dueDate || '9999'}-${project.name}`;
}

function severityClass(value) {
  return value === 'Critical' ? 'chip-danger' : value === 'High' ? 'chip-warning' : 'chip-info';
}

function healthClass(value) {
  return value === 'Off track' ? 'chip-danger' : value === 'At risk' ? 'chip-warning' : value === 'Complete' ? 'chip-neutral' : 'chip-success';
}

function priorityClass(value) {
  return value === 'Critical' ? 'chip-danger' : value === 'High' ? 'chip-warning' : value === 'Low' ? 'chip-neutral' : 'chip-info';
}

function activityInitial(type) {
  return String(type || 'U').slice(0, 1).toUpperCase();
}

function formatHours(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
