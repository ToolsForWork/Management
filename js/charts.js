// charts.js
import {
  data,
  formatDate,
  getCurrentWeekKey,
  getAssignmentsForWeek,
  totalHoursAllEmployees,
  totalEmployeeCapacity
} from './data.js';

const chartHeaderLineEl = document.getElementById('chartHeaderLine');
const chartLegendEl = document.getElementById('chartLegend');
const projectChartCanvas = document.getElementById('projectChart');
const burnDownChartCanvas = document.getElementById('burnDownChart');
let chartFrame = null;

export function forceChartUpdate() {
  if (chartFrame) cancelAnimationFrame(chartFrame);
  chartFrame = requestAnimationFrame(() => {
    chartFrame = null;
    renderProjectChart();
    renderBurnDownChart();
  });
}

export function renderWeekLabel() {
  const start = data.currentWeekStart;
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const weekLabelEl = document.getElementById('weekLabel');
  weekLabelEl.textContent = `${formatDate(start)} – ${formatDate(end)}`;
}

export function renderProjectChart() {
  const weekKey = getCurrentWeekKey();
  const canvas = projectChartCanvas;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#e2e8f0' : '#172033';
  const mutedColor = isDark ? '#94a3b8' : '#64748b';
  const trackColor = isDark ? '#27344a' : '#e8edf3';
  const bgColor = isDark ? '#172033' : '#ffffff';

  const week = getAssignmentsForWeek(weekKey);
  const projectTotals = new Map();
  const projectEmployees = new Map();
  const jobMap = new Map(data.jobs.map(job => [job.id, job]));

  Object.entries(week).forEach(([empId, empAssignments]) => {
    Object.entries(empAssignments).forEach(([jobId, a]) => {
      const parentHours = Number(a.hours) || 0;
      if (parentHours < 0.0001) return;
      projectTotals.set(jobId, (projectTotals.get(jobId) || 0) + parentHours);
      if (!projectEmployees.has(jobId)) projectEmployees.set(jobId, new Set());
      projectEmployees.get(jobId).add(empId);
    });
  });

  const usedHours = totalHoursAllEmployees(weekKey);
  const capacity = totalEmployeeCapacity();
  const unutilizedHours = Math.max(0, capacity - usedHours);
  const utilizationPct = capacity > 0 ? Math.round((usedHours / capacity) * 100) : 0;
  const balanceLabel = usedHours > capacity
    ? `${formatHours(usedHours - capacity)} hrs over capacity`
    : `${formatHours(unutilizedHours)} hrs available`;
  chartHeaderLineEl.textContent = `${formatHours(usedHours)} of ${formatHours(capacity)} hrs allocated · ${utilizationPct}% · ${balanceLabel}`;

  if (unutilizedHours > 0) projectTotals.set('__unutilized__', unutilizedHours);

  const rows = Array.from(projectTotals.entries())
    .filter(([jobId]) => jobId === '__unutilized__' || jobMap.has(jobId))
    .sort((left, right) => {
      if (left[0] === '__unutilized__') return 1;
      if (right[0] === '__unutilized__') return -1;
      return right[1] - left[1];
    });
  const desiredHeight = Math.max(240, rows.length * 31 + 36);
  const { ctx, width, height } = prepareCanvas(canvas, desiredHeight);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  chartLegendEl.innerHTML = '';
  rows.forEach(([jobId, hours]) => {
    const legendItem = document.createElement('div');
    legendItem.className = 'legend-item';

    const colorBox = document.createElement('div');
    colorBox.className = 'legend-color';

    let labelText = '';
    if (jobId === '__unutilized__') {
      colorBox.style.background = '#94a3b8';
      labelText = `Available: ${formatHours(hours)} hrs`;
    } else {
      const job = jobMap.get(jobId);
      colorBox.style.background = job.color || '#03bafc';
      const empCount = projectEmployees.get(jobId)?.size || 0;
      labelText = `${job.name}: ${formatHours(hours)} hrs · ${empCount} ${empCount === 1 ? 'person' : 'people'}`;
    }

    const label = document.createElement('span');
    label.textContent = labelText;
    legendItem.appendChild(colorBox);
    legendItem.appendChild(label);
    chartLegendEl.appendChild(legendItem);
  });

  if (rows.length === 0) {
    drawEmptyMessage(ctx, width, height, textColor, 'Assign project hours to see allocation.');
    canvas.setAttribute('aria-label', 'No project allocation recorded for this week.');
    return;
  }

  const leftMargin = Math.min(142, Math.max(92, width * 0.34));
  const rightMargin = 52;
  const chartWidth = Math.max(20, width - leftMargin - rightMargin - 12);
  const maxHours = Math.max(...rows.map(([, hours]) => hours), 1);
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  rows.forEach(([jobId, hours], index) => {
    const job = jobMap.get(jobId);
    const name = jobId === '__unutilized__' ? 'Available' : job.name;
    const color = jobId === '__unutilized__' ? '#94a3b8' : job.color || '#3b82f6';
    const y = 19 + index * 31;
    const barWidth = Math.max(2, (hours / maxHours) * chartWidth);

    ctx.fillStyle = mutedColor;
    ctx.textAlign = 'right';
    ctx.fillText(truncateText(ctx, name, leftMargin - 18), leftMargin - 8, y + 7);
    ctx.fillStyle = trackColor;
    roundRect(ctx, leftMargin, y, chartWidth, 14, 5);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, leftMargin, y, barWidth, 14, 5);
    ctx.fill();
    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    ctx.fillText(`${formatHours(hours)}h`, leftMargin + chartWidth + 7, y + 7);
  });

  canvas.setAttribute(
    'aria-label',
    `${formatHours(usedHours)} of ${formatHours(capacity)} team hours allocated across ${projectTotals.size - (unutilizedHours > 0 ? 1 : 0)} ${projectTotals.size - (unutilizedHours > 0 ? 1 : 0) === 1 ? 'project' : 'projects'}.`
  );
}

// burn-down chart (logic same as your original, just moved)

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

export function renderBurnDownChart() {
  const canvas = burnDownChartCanvas;
  if (!canvas) return;
  const { ctx, width, height } = prepareCanvas(canvas, 230);

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#dbe4f0' : '#172033';
  const bgColor = isDark ? '#172033' : '#ffffff';
  const gridColor = isDark ? '#334158' : '#e2e8f0';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  const budgetedJobs = data.jobs.filter(j => (j.hoursBudget || 0) > 0);
  if (budgetedJobs.length === 0) {
    ctx.fillStyle = textColor;
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Set a project hours budget to see remaining hours.', width / 2, height / 2);
    canvas.setAttribute('aria-label', 'No projects have an hours budget.');
    return;
  }

  const leftMargin = 50;
  const rightMargin = 16;
  const topMargin = 24;
  const bottomMargin = 48;
  const chartW = width - leftMargin - rightMargin;
  const chartH = height - topMargin - bottomMargin;

  const allWeeks = new Set([getCurrentWeekKey()]);
  budgetedJobs.forEach(job => {
    getWeekKeysForJob(job.id).forEach(w => allWeeks.add(w));
  });
  const sortedWeeks = Array.from(allWeeks).sort();

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

  const gridLines = 5;
  ctx.lineWidth = 1;
  ctx.font = '10px Arial';

  for (let i = 0; i <= gridLines; i++) {
    const val = Math.round((maxBudget / gridLines) * i);
    const y = topMargin + chartH - (val / maxBudget) * chartH;
    ctx.strokeStyle = gridColor;
    ctx.beginPath();
    ctx.moveTo(leftMargin, y);
    ctx.lineTo(leftMargin + chartW, y);
    ctx.stroke();
    ctx.fillStyle = textColor;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(val + 'h', leftMargin - 6, y);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const maxLabels = Math.max(1, Math.floor(chartW / 60));
  const step = Math.max(1, Math.ceil(sortedWeeks.length / maxLabels));

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

  const currentWkIdx = sortedWeeks.indexOf(getCurrentWeekKey());
  if (currentWkIdx >= 0) {
    const cx = leftMargin + (currentWkIdx / Math.max(sortedWeeks.length - 1, 1)) * chartW;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = isDark ? '#6b7280' : '#9ca3af';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, topMargin);
    ctx.lineTo(cx, topMargin + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (jobLines.length === 0) {
    ctx.fillStyle = textColor;
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No hours charged to budgeted projects yet.', width / 2, height / 2);
    canvas.setAttribute('aria-label', 'No hours have been charged to budgeted projects.');
    return;
  }

  jobLines.forEach(({ job, points }) => {
    if (points.length === 0) return;
    const color = job.color || '#03bafc';

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    points.forEach((pt, i) => {
      const x = leftMargin + (pt.weekIndex / Math.max(sortedWeeks.length - 1, 1)) * chartW;
      const y = topMargin + chartH - (pt.remaining / maxBudget) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const last = points[points.length - 1];
    const lx = leftMargin + (last.weekIndex / Math.max(sortedWeeks.length - 1, 1)) * chartW;
    const ly = topMargin + chartH - (last.remaining / maxBudget) * chartH;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = lx > leftMargin + chartW * 0.75 ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${job.name} (${last.remaining}h left)`, lx + (ctx.textAlign === 'left' ? 8 : -8), ly);
  });

  canvas.setAttribute('aria-label', `Remaining budget chart for ${jobLines.length} projects.`);
}

function prepareCanvas(canvas, cssHeight) {
  canvas.style.height = `${cssHeight}px`;
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = cssHeight;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return { ctx, width, height };
}

function drawEmptyMessage(ctx, width, height, color, message) {
  ctx.fillStyle = color;
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, width / 2, height / 2);
}

function truncateText(ctx, value, maxWidth) {
  if (ctx.measureText(value).width <= maxWidth) return value;
  let result = value;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

function roundRect(ctx, x, y, width, height, radius) {
  const resolvedRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + resolvedRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, resolvedRadius);
  ctx.arcTo(x + width, y + height, x, y + height, resolvedRadius);
  ctx.arcTo(x, y + height, x, y, resolvedRadius);
  ctx.arcTo(x, y, x + width, y, resolvedRadius);
  ctx.closePath();
}

function formatHours(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
