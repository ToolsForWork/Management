import {
  data,
  uuid,
  getCurrentWeekKey,
  getWeekKey,
  totalHoursAllEmployees,
  totalHoursForEmployeeWeek,
  totalEmployeeCapacity,
  getAlerts,
  getEffectiveEmployeeCapacity,
  recordActivity,
  scheduleSave,
  PRIORITIES,
  TASK_STATUSES,
  PROJECT_HEALTH,
  DISTRICTS,
  ORG_ROLES,
  canManageActionItem,
  canAssignActionItem,
  canWorkActionItem,
  getEmployeeDescendantIds,
  getTaskActualHours,
  getTaskVariance,
  getViewerLevel,
  getThreeWeekPlannedHours,
  DEFAULT_WBS,
  DEFAULT_IO
} from './data.js';
import { showToast, renderJobs, renderEmployees } from './ui.js';
import { forceChartUpdate } from './charts.js';
import { getVerifiedIdentity } from './auth.js';

let activeTab = 'overview';
let dialogSubmit = null;
let draggedActionItemId = '';
const PTO_URL = 'https://rp.kiewit.com/#/';

export function initializeWorkspace() {
  document.getElementById('workspaceBtn').addEventListener('click', openWorkspace);
  document.getElementById('closeWorkspaceBtn').addEventListener('click', closeWorkspace);
  document.getElementById('workspaceTabs').addEventListener('click', event => {
    const button = event.target.closest('[data-workspace-tab]');
    if (!button) return;
    activeTab = button.dataset.workspaceTab;
    renderWorkspace();
  });
  document.getElementById('workspaceIdentitySelect').addEventListener('change', event => {
    if (getVerifiedIdentity()) return;
    data.currentUserId = event.target.value;
    scheduleSave();
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
  refreshIdentitySelector();
  const allowedTabs = permittedTabs();
  if (!allowedTabs.includes(activeTab)) activeTab = allowedTabs[0];
  document.querySelectorAll('[data-workspace-tab]').forEach(button => {
    button.hidden = !allowedTabs.includes(button.dataset.workspaceTab);
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
    roster: renderRoster,
    activity: renderActivity
  };
  content.appendChild((renderers[activeTab] || renderOverview)());
}

function refreshIdentitySelector() {
  const select = document.getElementById('workspaceIdentitySelect');
  const help = document.getElementById('workspaceIdentityHelp');
  const identityLink = document.getElementById('microsoftIdentityLink');
  const setup = isSetupMode();
  const verified = getVerifiedIdentity();
  const azureHosted = location.hostname.endsWith('.azurestaticapps.net');
  identityLink.classList.toggle('hidden', !azureHosted);
  identityLink.textContent = verified ? 'Sign out' : 'Sign in with Microsoft';
  identityLink.href = verified
    ? '/.auth/logout?post_logout_redirect_uri=/main.html'
    : '/.auth/login/aad?post_login_redirect_uri=/main.html';
  select.replaceChildren();
  if (setup) {
    const option = new Option('Roster setup · Full access', '');
    select.appendChild(option);
    help.textContent = 'Add a DM to establish the department hierarchy.';
    return;
  }
  select.appendChild(new Option('Select your roster identity…', ''));
  activeEmployees()
    .sort((left, right) => roleRank(right.rosterRole) - roleRank(left.rosterRole) || left.name.localeCompare(right.name))
    .forEach(employee => select.appendChild(new Option(`${employee.name} · ${getViewerLevel(employee.id)}`, employee.id)));
  select.value = data.currentUserId;
  select.disabled = Boolean(verified);
  const actor = currentActor();
  help.textContent = verified
    ? verified.employeeId
      ? `Verified as ${verified.name || verified.email} through ${verified.source}.`
      : `Verified ${verified.email || verified.name}, but no matching roster email was found.`
    : actor
    ? `${getViewerLevel(actor.id)} view · local identity selection.`
    : 'Select your identity to enable permitted actions.';
}

function permittedTabs() {
  if (isSetupMode()) return ['overview', 'projects', 'tasks', 'people', 'roster', 'activity'];
  const actor = currentActor();
  if (!actor || getViewerLevel(actor.id) !== 'Manager') return ['overview', 'tasks'];
  return ['overview', 'projects', 'tasks', 'people', 'roster', 'activity'];
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
  const actor = currentActor();
  const level = actor ? getViewerLevel(actor.id) : 'Manager';
  if (actor && level !== 'Manager') return renderWorkerOverview(actor, level);
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

function renderWorkerOverview(actor, level) {
  const wrapper = element('div', 'workspace-view');
  const heading = viewHeading(
    level === 'Lead' ? 'Lead work plan' : 'My work plan',
    'Keep the next three weeks loaded and move available actions into the plan.'
  );
  heading.appendChild(actionButton('Request PTO / Leave', () => window.open(PTO_URL, '_blank', 'noopener,noreferrer'), 'secondary-button'));
  wrapper.append(heading);
  const planned = getThreeWeekPlannedHours(actor.id);
  const currentHours = totalHoursForEmployeeWeek(getCurrentWeekKey(), actor.id);
  const assigned = data.tasks.filter(task => task.assigneeId === actor.id && task.progress < 100);
  const available = data.tasks.filter(task => !task.assigneeId && task.progress < 100);
  const metrics = element('div', 'metric-grid');
  metrics.append(
    metricCard('3-week plan', `${formatHours(planned)}h`, `${formatHours(Math.max(0, 120 - planned))}h still needed`),
    metricCard('This week', `${formatHours(currentHours)}h`, 'Project allocation'),
    metricCard('My active actions', assigned.length, `${assigned.filter(task => task.status === 'Blocked').length} blocked`),
    metricCard('Available actions', available.length, 'Ready to self-assign')
  );
  wrapper.append(metrics, planProgress(planned));
  if (level === 'Lead') {
    wrapper.appendChild(dashboardPanel('Group planning coverage', renderHoursSummary(), 'View actions', () => switchTab('tasks')));
  } else {
    wrapper.appendChild(dashboardPanel('My next actions', renderCompactTasks(actor.id), 'View action list', () => switchTab('tasks')));
  }
  return wrapper;
}

function planProgress(planned) {
  const panel = element('section', 'dashboard-panel plan-panel');
  const heading = element('div', 'dashboard-panel-heading');
  heading.append(
    element('h3', '', '120-hour rolling target'),
    chip(planned >= 120 ? 'Ready' : 'Needs planning', planned >= 120 ? 'chip-success' : 'chip-warning')
  );
  const track = element('div', 'progress-track');
  const fill = element('div', 'progress-fill');
  fill.style.width = `${Math.min(100, (planned / 120) * 100)}%`;
  track.appendChild(fill);
  panel.append(heading, track, element('span', 'plan-caption', `${formatHours(planned)} of 120 future hours allocated`));
  return panel;
}

function renderCompactTasks(employeeId) {
  const tasks = data.tasks.filter(task => task.assigneeId === employeeId && task.progress < 100).slice(0, 5);
  if (!tasks.length) return emptyState('No active actions', 'Choose work from the available action list.');
  const list = element('div', 'workspace-list');
  tasks.forEach(task => list.appendChild(element('div', 'deadline-row', `${task.title} · ${task.progress}% · ${formatHours(task.budgetHours - getTaskActualHours(task))}h remaining`)));
  return list;
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

  const projects = manageableProjects();
  if (!projects.length) {
    wrapper.appendChild(emptyState('No projects yet', 'Create projects in the planner, then manage delivery details here.'));
    return wrapper;
  }
  const grid = element('div', 'portfolio-grid');
  [...projects]
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
  const completedActions = data.tasks.filter(task => task.projectId === project.id && task.progress >= 100);
  const actionVariance = completedActions.reduce((total, task) => total + getTaskVariance(task), 0);
  const heading = element('div', 'portfolio-card-heading');
  const title = element('div');
  title.append(element('h3', '', project.name), element('span', '', owner ? `Project lead: ${owner.name}` : 'Project lead not assigned'));
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
  card.appendChild(projectChecklist(project));

  const footer = element('div', 'portfolio-card-footer');
  footer.append(
    element('span', '', `${data.tasks.filter(task => task.projectId === project.id && task.status !== 'Done').length} open actions`),
    element('span', '', completedActions.length
      ? `${formatHours(Math.abs(actionVariance))}h ${actionVariance >= 0 ? 'gain' : 'loss'}`
      : 'No completed action variance'),
    element('span', '', project.startDate && project.dueDate
      ? `${project.startDate} → ${project.dueDate}`
      : project.dueDate ? `Due ${project.dueDate}`
        : project.startDate ? `Starts ${project.startDate}`
          : 'Dates not set')
  );
  card.appendChild(footer);
  return card;
}

function projectChecklist(project) {
  const details = element('details', 'project-checklist');
  const complete = project.checklist.filter(item => item.complete).length;
  details.appendChild(element('summary', '', `Project checklist · ${complete}/${project.checklist.length}`));
  ['Procedure', 'Takeoff'].forEach(type => {
    const items = project.checklist.filter(item => item.type === type);
    const group = element('div', 'checklist-group');
    group.appendChild(element('strong', '', type === 'Procedure' ? 'Estimating – E&I activities' : 'Required takeoffs'));
    items.forEach(item => {
      const label = element('label', 'checklist-item');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.complete;
      checkbox.addEventListener('change', () => {
        item.complete = checkbox.checked;
        item.completedAt = checkbox.checked ? new Date().toISOString() : '';
        item.completedById = checkbox.checked ? currentActor()?.id || '' : '';
        commit('Project checklist', `${item.name} marked ${checkbox.checked ? 'complete' : 'incomplete'} for ${project.name}.`, 'project', project.id);
        renderWorkspace();
      });
      label.append(checkbox, element('span', '', `${item.name}${item.type === 'Takeoff' ? ` · ${item.discipline}` : ''}`));
      group.appendChild(label);
    });
    details.appendChild(group);
  });
  return details;
}

function renderTasks() {
  const wrapper = element('div', 'workspace-view');
  const heading = viewHeading('Action item list', 'Project and unutilized work, with charging codes, budgets, progress, and handoffs.');
  if (canCreateActionItems()) heading.appendChild(actionButton('Add action', () => openTaskForm()));
  wrapper.append(heading, renderHoursSummary(), renderAssignmentTargets());

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
      .filter(task => isTaskVisibleToViewer(task))
      .filter(task => !query || [task.title, task.description, task.wbs, task.io].some(value => String(value || '').toLowerCase().includes(query)))
      .filter(task => !status.input.value || task.status === status.input.value)
      .filter(task => !owner.input.value || task.assigneeId === owner.input.value)
      .sort(taskComparator);
    if (!tasks.length) {
      list.appendChild(emptyState('No matching actions', data.tasks.length ? 'Adjust the filters to see more work.' : 'Add the first action item.'));
      return;
    }
    list.append(
      taskSection('Projects', tasks.filter(task => task.projectId), true),
      taskSection('Unutilized', tasks.filter(task => !task.projectId), false)
    );
  };
  [search.input, status.input, owner.input].forEach(input => input.addEventListener('input', refresh));
  refresh();
  wrapper.appendChild(list);
  return wrapper;
}

function renderHoursSummary() {
  const wrapper = element('section', 'hours-summary');
  const employees = visibleHoursEmployees();
  employees.forEach(employee => {
    const planned = getThreeWeekPlannedHours(employee.id);
    const card = element('article', 'hours-summary-card');
    card.append(
      element('strong', '', employee.name),
      element('span', '', `${formatHours(totalHoursForEmployeeWeek(getCurrentWeekKey(), employee.id))}h this week`),
      element('span', '', `${formatHours(planned)} / 120h planned`)
    );
    card.classList.toggle('under-planned', planned < 120);
    wrapper.appendChild(card);
  });
  return wrapper;
}

function visibleHoursEmployees() {
  const actor = currentActor();
  if (!actor) return activeEmployees();
  const level = getViewerLevel(actor.id);
  if (level === 'Estimator') return [actor];
  if (level === 'Lead') {
    return activeEmployees().filter(employee =>
      employee.id === actor.id
      || (employee.rosterRole === 'Estimator' && employee.managerId === actor.managerId)
    );
  }
  if (actor.rosterRole === 'DM') return activeEmployees();
  const ids = getEmployeeDescendantIds(actor.id);
  return activeEmployees().filter(employee => employee.id === actor.id || ids.has(employee.id));
}

function isTaskVisibleToViewer(task) {
  const actor = currentActor();
  if (!actor || isSetupMode()) return true;
  const level = getViewerLevel(actor.id);
  if (level === 'Manager') return actor.rosterRole === 'DM' || canManageActionItem(actor.id, task) || task.assigneeId === actor.id;
  if (level === 'Lead') return !task.assigneeId || task.assigneeId === actor.id || canManageActionItem(actor.id, task);
  return !task.assigneeId || task.assigneeId === actor.id;
}

function taskSection(title, tasks, groupByProject) {
  const section = element('section', 'action-list-section');
  const heading = element('div', 'task-group-heading');
  heading.append(element('h3', '', title), chip(tasks.length, 'chip-neutral'));
  section.appendChild(heading);
  if (!tasks.length) {
    section.appendChild(emptyState(`No ${title.toLowerCase()} actions`, title === 'Unutilized'
      ? 'Overhead, training, and development work appears here.'
      : 'Project action items appear here.'));
    return section;
  }
  if (!groupByProject) {
    tasks.forEach(task => section.appendChild(taskRow(task)));
    return section;
  }
  [...new Set(tasks.map(task => task.projectId))]
    .sort((left, right) => (projectById(left)?.name || '').localeCompare(projectById(right)?.name || ''))
    .forEach(projectId => {
      const group = element('div', 'action-project-group');
      group.appendChild(element('h4', '', projectById(projectId)?.name || 'Former project'));
      tasks.filter(task => task.projectId === projectId).forEach(task => group.appendChild(taskRow(task)));
      section.appendChild(group);
    });
  return section;
}

function renderAssignmentTargets() {
  const actor = currentActor();
  const wrapper = element('section', 'task-assignment-panel');
  wrapper.appendChild(element('strong', '', 'Drag an action to assign'));
  if (!actor) {
    wrapper.appendChild(element('span', '', isSetupMode()
      ? 'Add a roster identity before assigning work.'
      : 'Select your roster identity to self-assign or delegate work.'));
    return wrapper;
  }
  const targets = element('div', 'task-assignment-targets');
  delegatableEmployees().forEach(employee => {
    const target = element('div', 'task-assignment-target');
    target.append(avatar(employee.name), element('span', '', employee.id === actor.id ? 'My queue' : employee.name));
    target.addEventListener('dragover', event => {
      const task = taskFromDrag(event);
      if (task && canAssignActionItem(actor.id, employee.id, task)) {
        event.preventDefault();
        target.classList.add('over');
      }
    });
    target.addEventListener('dragleave', () => target.classList.remove('over'));
    target.addEventListener('drop', event => {
      event.preventDefault();
      target.classList.remove('over');
      const task = taskFromDrag(event);
      if (task && canAssignActionItem(actor.id, employee.id, task)) assignTask(task, employee.id);
    });
    targets.appendChild(target);
  });
  wrapper.appendChild(targets);
  return wrapper;
}

function taskRow(task) {
  const row = element('article', `task-row priority-${(task.priority || 'medium').toLowerCase()}`);
  row.draggable = Boolean(currentActor() && (!task.assigneeId || canManageTask(task)));
  row.addEventListener('dragstart', event => {
    draggedActionItemId = task.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-action-item', task.id);
    event.dataTransfer.setData('text/plain', task.id);
  });
  row.addEventListener('dragend', () => {
    draggedActionItemId = '';
  });
  const main = element('div', 'task-main');
  const top = element('div', 'task-title-row');
  top.append(
    element('strong', '', task.title),
    chip(task.status, task.status === 'Done' ? 'chip-success' : task.status === 'Blocked' ? 'chip-danger' : 'chip-neutral'),
    chip(task.priority, priorityClass(task.priority))
  );
  const actual = getTaskActualHours(task);
  const variance = getTaskVariance(task);
  const result = variance >= 0 ? `${formatHours(variance)}h gain` : `${formatHours(Math.abs(variance))}h loss`;
  main.append(top, element('span', '', [
    projectById(task.projectId)?.name || 'Unutilized',
    task.workGroup,
    employeeById(task.assigneeId)?.name || 'Unassigned',
    `${formatHours(actual)} / ${formatHours(task.budgetHours)} budget hrs`,
    task.progress >= 100 ? result : `${task.progress}% complete`,
    task.plannedWeekKey ? `Week of ${task.plannedWeekKey}` : 'Week not planned'
  ].join(' · ')));
  const codes = element('div', 'task-code-row');
  codes.append(
    chip(`WBS: ${task.wbs || 'Not set'}`, task.wbs ? 'chip-info' : 'chip-warning'),
    chip(`IO: ${task.io || 'Not set'}`, task.io ? 'chip-info' : 'chip-warning')
  );
  main.appendChild(codes);
  const progressTrack = element('div', 'progress-track task-progress');
  const progressFill = element('div', 'progress-fill');
  progressFill.style.width = `${task.progress}%`;
  progressTrack.appendChild(progressFill);
  main.appendChild(progressTrack);
  if (task.description) main.appendChild(element('p', '', task.description));
  if (task.notes?.length) {
    const notes = element('details', 'task-note-preview');
    notes.appendChild(element('summary', '', `Notes (${task.notes.length})`));
    [...task.notes].reverse().forEach(note => {
      const noteRow = element('div', 'task-note-row');
      noteRow.appendChild(element('span', '', `${employeeById(note.employeeId)?.name || 'Team'} · ${note.progress}% — ${note.text}`));
      if (canDeleteTaskNote(task, note)) {
        noteRow.appendChild(iconButton('×', 'Remove task note', () => deleteTaskNote(task, note)));
      }
      notes.appendChild(noteRow);
    });
    main.appendChild(notes);
  }

  const actions = element('div', 'task-actions');
  const actor = currentActor();
  if (actor && !task.assigneeId && canAssignActionItem(actor.id, actor.id, task)) {
    actions.appendChild(actionButton('Assign to me', () => assignTask(task, actor.id)));
  }
  if (actor && canWorkActionItem(actor.id, task) && task.progress < 100) {
    actions.append(
      actionButton('Log work', () => openTaskWorkForm(task)),
      actionButton('Release for handoff', () => releaseTask(task), 'secondary-button')
    );
  }
  if (canManageTask(task)) {
    const options = [['', 'Unassigned'], ...eligibleAssignees(task).map(employee => [employee.id, employee.name])];
    if (task.assigneeId && !options.some(([id]) => id === task.assigneeId)) {
      options.push([task.assigneeId, employeeById(task.assigneeId)?.name || 'Current assignee']);
    }
    const assign = selectElement(options, task.assigneeId);
    assign.setAttribute('aria-label', `Assign ${task.title}`);
    assign.addEventListener('change', () => assign.value ? assignTask(task, assign.value) : releaseTask(task, true));
    actions.append(
      assign,
      actionButton('Add note', () => openTaskNoteForm(task), 'secondary-button'),
      actionButton('Edit', () => openTaskForm(task), 'secondary-button'),
      iconButton('×', `Delete ${task.title}`, () => deleteTask(task))
    );
  }
  row.append(main, actions);
  return row;
}

function renderRoster() {
  const wrapper = element('div', 'workspace-view');
  const heading = viewHeading('Department roster', 'DM → ADM → Estimator reporting structure. Project leads are derived from project ownership.');
  if (canAddRosterMember()) heading.appendChild(actionButton('Add roster member', () => openRosterForm()));
  heading.appendChild(actionButton('Roster CSV template', () => window.open('./data/roster.csv', '_blank', 'noopener'), 'secondary-button'));
  wrapper.appendChild(heading);
  if (!data.employees.length) {
    wrapper.appendChild(emptyState('Build the department roster', 'Add the DM first, then add each reporting level.'));
    return wrapper;
  }
  const tree = element('div', 'roster-tree');
  const activeIds = new Set(data.employees.map(employee => employee.id));
  const roots = data.employees
    .filter(employee => !employee.managerId || !activeIds.has(employee.managerId))
    .sort(rosterComparator);
  roots.forEach(employee => tree.appendChild(rosterBranch(employee, new Set())));
  wrapper.appendChild(tree);
  return wrapper;
}

function rosterBranch(employee, visited) {
  const branch = element('div', 'roster-branch');
  if (visited.has(employee.id)) return branch;
  const nextVisited = new Set(visited).add(employee.id);
  const card = element('article', `roster-card${employee.active === false ? ' archived' : ''}`);
  const identity = element('div', 'person-identity');
  identity.append(avatar(employee.name), element('div'));
  identity.lastChild.append(
    element('h3', '', employee.name),
    element('span', '', `${getViewerLevel(employee.id)} · ${employee.rosterRole} roster role · ${employee.district}`)
  );
  card.append(identity, chip(employee.active === false ? 'Archived' : `${formatHours(employee.weeklyBudget)}h`, 'chip-neutral'));
  if (canEditRosterMember(employee)) card.appendChild(actionButton('Edit', () => openRosterForm(employee), 'secondary-button'));
  branch.appendChild(card);
  const reports = data.employees.filter(candidate => candidate.managerId === employee.id).sort(rosterComparator);
  if (reports.length) {
    const children = element('div', 'roster-children');
    reports.forEach(report => children.appendChild(rosterBranch(report, nextVisited)));
    branch.appendChild(children);
  }
  return branch;
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
    actionButton('PTO / Leave', () => window.open(PTO_URL, '_blank', 'noopener,noreferrer')),
    actionButton('Availability record', () => openLeaveForm(employee), 'secondary-button'),
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
      field('ownerId', 'Project lead', 'select', project.ownerId, [['', 'Unassigned'], ...activeEmployees().filter(employee => employee.rosterRole === 'Estimator').map(employee => [employee.id, employee.name])]),
      field('discipline', 'Primary discipline', 'select', project.discipline, DISTRICTS),
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
  if (editing && !canManageTask(task)) {
    showToast('Your roster role cannot edit this action item.');
    return;
  }
  const actor = currentActor();
  const projects = manageableProjects();
  const allowUnutilized = isSetupMode() || actor?.rosterRole === 'DM' || actor?.rosterRole === 'ADM';
  const projectOptions = [
    ...(allowUnutilized ? [['', 'Unutilized']] : []),
    ...projects.map(project => [project.id, project.name])
  ];
  const defaultProjectId = task?.projectId || (allowUnutilized ? '' : projects[0]?.id || '');
  const projectDiscipline = projectById(defaultProjectId)?.discipline;
  const defaultWorkGroup = task?.workGroup
    || (projectDiscipline === 'Instrumentation' ? 'Instrumentation' : 'Electrical');
  const scopeCandidates = isSetupMode()
    ? activeEmployees()
    : actor ? activeEmployees().filter(employee => employee.id === actor.id || getEmployeeDescendantIds(actor.id).has(employee.id)) : [];
  const delegateCandidates = isSetupMode() ? activeEmployees() : delegatableEmployees();
  openForm({
    eyebrow: 'Action items',
    title: editing ? `Edit ${task.title}` : 'Add action item',
    fields: [
      field('title', 'Action', 'text', task?.title || '', null, true),
      field('projectId', 'Section / project', 'select', defaultProjectId, projectOptions),
      field('scopeOwnerId', 'Owning group / lead', 'select', task?.scopeOwnerId || actor?.id || '', [['', 'Select scope…'], ...scopeCandidates.map(employee => [employee.id, `${employee.name} · ${employee.rosterRole}`])]),
      field('assigneeId', 'Assignee', 'select', task?.assigneeId || '', [['', 'Unassigned'], ...delegateCandidates.map(employee => [employee.id, employee.name])]),
      field('budgetHours', 'Estimated hour budget', 'number', task?.budgetHours ?? '', null, true),
      field('workGroup', 'Work group', 'select', defaultWorkGroup, ['Electrical', 'Instrumentation']),
      field('wbs', 'WBS', 'text', task?.wbs || DEFAULT_WBS),
      field('io', 'IO', 'text', task?.io || defaultIoFor(defaultProjectId, defaultWorkGroup)),
      field('plannedWeekKey', 'Planned week starting', 'date', task?.plannedWeekKey || getCurrentWeekKey(), null, true),
      field('status', 'Status', 'select', task?.status || 'To do', TASK_STATUSES),
      field('priority', 'Priority', 'select', task?.priority || 'Medium', PRIORITIES),
      field('dueDate', 'Due date', 'date', task?.dueDate || ''),
      field('description', 'Details', 'textarea', task?.description || '')
    ],
    onReady: inputs => {
      const updateIo = () => {
        inputs.get('io').value = defaultIoFor(inputs.get('projectId').value, inputs.get('workGroup').value);
      };
      inputs.get('projectId').addEventListener('change', () => {
        const discipline = projectById(inputs.get('projectId').value)?.discipline;
        if (discipline === 'Electrical' || discipline === 'Instrumentation') {
          inputs.get('workGroup').value = discipline;
        }
        updateIo();
      });
      inputs.get('workGroup').addEventListener('change', updateIo);
    },
    onSave: values => {
      if (!values.title.trim()) {
        showToast('Enter an action-item title.');
        return false;
      }
      values.budgetHours = Number(values.budgetHours);
      values.plannedWeekKey = getWeekKey(new Date(`${values.plannedWeekKey}T12:00:00`));
      if (!Number.isFinite(values.budgetHours) || values.budgetHours <= 0) {
        showToast('Enter an estimated hour budget greater than zero.');
        return false;
      }
      if (!values.projectId && !values.scopeOwnerId) {
        showToast('Choose the group responsible for this unutilized action.');
        return false;
      }
      const candidate = { ...(task || {}), ...values };
      if (!isSetupMode() && !canManageActionItem(actor?.id, candidate)) {
        showToast('Your roster role cannot create or edit work in that scope.');
        return false;
      }
      if (values.assigneeId && !isSetupMode() && !canAssignActionItem(actor?.id, values.assigneeId, candidate)) {
        showToast('You can only assign this work to yourself or someone below you.');
        return false;
      }
      values.updatedAt = new Date().toISOString();
      if (editing) {
        Object.assign(task, values);
        if (task.status === 'Done') task.progress = 100;
        if (task.progress >= 100) task.status = 'Done';
        commit('Task', `${task.title} updated.`, 'task', task.id);
      } else {
        const created = {
          id: uuid(),
          ...values,
          progress: values.status === 'Done' ? 100 : 0,
          assignedById: values.assigneeId ? actor?.id || '' : '',
          workLogs: [],
          notes: [],
          createdAt: new Date().toISOString()
        };
        data.tasks.push(created);
        commit('Task', `${created.title} created.`, 'task', created.id);
      }
      return true;
    }
  });
}

function openTaskWorkForm(task) {
  const actor = currentActor();
  if (!actor || !canWorkActionItem(actor.id, task)) {
    showToast('Only the currently assigned employee can log work.');
    return;
  }
  openForm({
    eyebrow: 'Action progress',
    title: task.title,
    fields: [
      field('hours', 'Hours to add', 'number', 0),
      field('progress', 'Total % complete', 'number', task.progress),
      field('note', 'Work note', 'textarea', '')
    ],
    onSave: values => {
      const hours = Number(values.hours) || 0;
      const progress = Math.min(100, Math.max(0, Number(values.progress) || 0));
      if (progress < task.progress) {
        showToast('Task progress cannot move backward.');
        return false;
      }
      if (hours <= 0 && !values.note.trim() && progress === task.progress) {
        showToast('Add hours, a note, or updated progress.');
        return false;
      }
      if (hours > 0) {
        task.workLogs.push({ id: uuid(), employeeId: actor.id, hours, createdAt: new Date().toISOString() });
      }
      if (values.note.trim()) {
        task.notes.push({
          id: uuid(),
          employeeId: actor.id,
          text: values.note.trim(),
          progress,
          createdAt: new Date().toISOString()
        });
      }
      task.progress = progress;
      task.status = progress >= 100 ? 'Done' : 'In progress';
      task.updatedAt = new Date().toISOString();
      const variance = getTaskVariance(task);
      const outcome = progress >= 100
        ? ` with a ${formatHours(Math.abs(variance))} hour ${variance >= 0 ? 'gain' : 'loss'}`
        : ` to ${progress}%`;
      commit('Action work', `${actor.name} updated ${task.title}${outcome}.`, 'task', task.id);
      return true;
    }
  });
}

function openTaskNoteForm(task) {
  openForm({
    eyebrow: 'Action note',
    title: task.title,
    fields: [field('note', 'Note', 'textarea', '', null, true)],
    onSave: values => {
      if (!values.note.trim()) return false;
      task.notes.push({
        id: uuid(),
        employeeId: currentActor()?.id || '',
        text: values.note.trim(),
        progress: task.progress,
        createdAt: new Date().toISOString()
      });
      task.updatedAt = new Date().toISOString();
      commit('Task note', `A note was added to ${task.title}.`, 'task', task.id);
      return true;
    }
  });
}

function canDeleteTaskNote(task, note) {
  const actor = currentActor();
  return isSetupMode() || canManageTask(task) || Boolean(actor && note.employeeId === actor.id);
}

function deleteTaskNote(task, note) {
  if (!canDeleteTaskNote(task, note)) return;
  if (!window.confirm('Remove this task note?')) return;
  task.notes = task.notes.filter(candidate => candidate.id !== note.id);
  task.updatedAt = new Date().toISOString();
  commit('Task note', `A note was removed from ${task.title}.`, 'task', task.id);
  renderWorkspace();
}

function openRosterForm(employee = null) {
  const actor = currentActor();
  const editing = Boolean(employee);
  if (editing && !canEditRosterMember(employee)) return;
  const permittedRoles = isSetupMode()
    ? ORG_ROLES
    : ORG_ROLES.filter(role => roleRank(role) < roleRank(actor?.rosterRole));
  if (editing && !permittedRoles.includes(employee.rosterRole)) permittedRoles.unshift(employee.rosterRole);
  const managers = activeEmployees().filter(candidate => candidate.id !== employee?.id);
  openForm({
    eyebrow: 'Department roster',
    title: editing ? `Edit ${employee.name}` : 'Add roster member',
    fields: [
      field('name', 'Name', 'text', employee?.name || '', null, true),
      field('rosterRole', 'Hierarchy role', 'select', employee?.rosterRole || permittedRoles[0] || 'Estimator', permittedRoles),
      field('managerId', 'Reports to', 'select', employee?.managerId || actor?.id || '', [['', 'No manager'], ...managers.map(manager => [manager.id, `${manager.name} · ${manager.rosterRole}`])]),
      field('district', 'Primary group', 'select', employee?.district || actor?.district || 'Electrical', DISTRICTS),
      field('weeklyBudget', 'Weekly capacity', 'number', employee?.weeklyBudget ?? 40, null, true),
      field('title', 'Job title', 'text', employee?.title || ''),
      field('email', 'Email', 'email', employee?.email || ''),
      field('phone', 'Phone', 'text', employee?.phone || ''),
      field('active', 'Active roster member', 'checkbox', employee?.active !== false)
    ],
    onSave: values => {
      values.weeklyBudget = Number(values.weeklyBudget);
      if (!values.name.trim() || !Number.isFinite(values.weeklyBudget) || values.weeklyBudget <= 0) {
        showToast('Enter a name and weekly capacity greater than zero.');
        return false;
      }
      if (values.rosterRole === 'DM') values.managerId = '';
      const manager = employeeById(values.managerId);
      if (manager && roleRank(manager.rosterRole) <= roleRank(values.rosterRole)) {
        showToast('A roster member must report to a higher hierarchy role.');
        return false;
      }
      if (employee && values.managerId && getEmployeeDescendantIds(employee.id).has(values.managerId)) {
        showToast('That reporting line would create a hierarchy cycle.');
        return false;
      }
      if (editing) {
        Object.assign(employee, values);
        commit('Roster', `${employee.name}'s roster placement updated.`, 'employee', employee.id);
      } else {
        const created = {
          id: uuid(),
          ...values,
          collapsed: false,
          archivedAt: '',
          hireDate: '',
          skills: [],
          managerNotes: ''
        };
        data.employees.push(created);
        if (!data.currentUserId && created.rosterRole === 'DM') data.currentUserId = created.id;
        commit('Roster', `${created.name} added to the department roster.`, 'employee', created.id);
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
  config.onReady?.(inputs);

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

function defaultIoFor(projectId, workGroup) {
  return projectId ? DEFAULT_IO[workGroup] || DEFAULT_IO.Electrical : DEFAULT_IO.Unutilized;
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
  if (!canManageTask(task)) {
    showToast('Your roster role cannot delete this action item.');
    return;
  }
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

function currentActor() {
  return activeEmployees().find(employee => employee.id === data.currentUserId) || null;
}

function isSetupMode() {
  return !data.employees.some(employee => employee.active !== false && employee.rosterRole === 'DM');
}

function roleRank(role) {
  return { DM: 3, ADM: 2, Estimator: 1 }[role] || 0;
}

function canCreateActionItems() {
  const actor = currentActor();
  return isSetupMode() || Boolean(actor && getViewerLevel(actor.id) !== 'Estimator');
}

function canManageTask(task) {
  return isSetupMode() || canManageActionItem(currentActor()?.id, task);
}

function manageableProjects() {
  if (isSetupMode()) return [...data.jobs];
  const actor = currentActor();
  if (!actor) return [];
  return data.jobs.filter(project => canManageActionItem(actor.id, { projectId: project.id }));
}

function delegatableEmployees() {
  const actor = currentActor();
  if (!actor) return [];
  if (getViewerLevel(actor.id) === 'Lead') {
    return activeEmployees().filter(employee =>
      employee.id === actor.id
      || (employee.rosterRole === 'Estimator' && employee.managerId === actor.managerId)
    );
  }
  const ids = new Set([actor.id, ...getEmployeeDescendantIds(actor.id)]);
  return activeEmployees().filter(employee => ids.has(employee.id));
}

function eligibleAssignees(task) {
  if (isSetupMode()) return activeEmployees();
  const actor = currentActor();
  return actor
    ? delegatableEmployees().filter(employee => canAssignActionItem(actor.id, employee.id, task))
    : [];
}

function assignTask(task, employeeId) {
  const actor = currentActor();
  if (!isSetupMode() && !canAssignActionItem(actor?.id, employeeId, task)) {
    showToast('You can only assign this action to yourself or someone below you.');
    return;
  }
  const employee = employeeById(employeeId);
  if (!employee) return;
  task.assigneeId = employee.id;
  task.assignedById = actor?.id || '';
  if (task.status === 'To do') task.status = 'In progress';
  task.updatedAt = new Date().toISOString();
  commit('Action assignment', `${task.title} assigned to ${employee.name} at ${task.progress}% complete.`, 'task', task.id);
  renderWorkspace();
}

function releaseTask(task, managerAction = false) {
  const actor = currentActor();
  if (!isSetupMode() && !canManageTask(task) && !canWorkActionItem(actor?.id, task)) {
    showToast('You cannot release this action item.');
    return;
  }
  const previous = employeeById(task.assigneeId);
  task.assigneeId = '';
  task.assignedById = '';
  if (task.progress < 100 && task.status !== 'Blocked') task.status = 'To do';
  task.updatedAt = new Date().toISOString();
  commit('Action handoff', `${previous?.name || 'The assignee'} released ${task.title} at ${task.progress}% complete${managerAction ? ' by management' : ''}.`, 'task', task.id);
  renderWorkspace();
}

function taskFromDrag(event) {
  const id = draggedActionItemId
    || event.dataTransfer?.getData('application/x-action-item')
    || event.dataTransfer?.getData('text/plain');
  return data.tasks.find(task => task.id === id);
}

function canAddRosterMember() {
  const actor = currentActor();
  return isSetupMode() || Boolean(actor && actor.rosterRole !== 'Estimator');
}

function canEditRosterMember(employee) {
  if (isSetupMode()) return true;
  const actor = currentActor();
  if (!actor) return false;
  if (actor.id === employee.id) return actor.rosterRole === 'DM';
  return actor.rosterRole === 'DM' || getEmployeeDescendantIds(actor.id).has(employee.id);
}

function rosterComparator(left, right) {
  return roleRank(right.rosterRole) - roleRank(left.rosterRole) || left.name.localeCompare(right.name);
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
