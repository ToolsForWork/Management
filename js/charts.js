// charts.js
import {
  data,
  getCurrentWeekKey,
  getAssignmentsForWeek,
  totalHoursAllEmployees,
  totalEmployeeCapacity
} from './data.js';

const chartHeaderLineEl = document.getElementById('chartHeaderLine');
const chartLegendEl = document.getElementById('chartLegend');
const projectChartCanvas = document.getElementById('projectChart');
const burnDownChartCanvas = document.getElementById('burnDownChart');

export function forceChartUpdate() {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      renderProjectChart();
      renderBurnDownChart();
    });
  } else {
    setTimeout(() => {
      renderProjectChart();
      renderBurnDownChart();
    }, 30);
  }
}

export function renderWeekLabel() {
  const start = data.currentWeekStart;
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const weekLabelEl = document.getElementById('weekLabel');
  weekLabelEl.textContent = `${start.toISOString().slice(0,10)} to ${end.toISOString().slice(0,10)}`;
}

// project chart (unchanged logic, just wrapped)

export function renderProjectChart() {
  const weekKey = getCurrentWeekKey();
  const canvas = projectChartCanvas;
  const ctx = canvas.getContext('2d');

  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#d1d5db' : '#000000';
  const bgColor = isDark ? '#1f2937' : '#ffffff';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const week = getAssignmentsForWeek(weekKey);
  const projectTotals = {};
  const projectEmployees = {};

  Object.entries(week).forEach(([empId, empAssignments]) => {
    Object.entries(empAssignments).forEach(([jobId, a]) => {
      const parentHours = a.hours || 0;
      if (parentHours < 0.0001) return;
      projectTotals[jobId] = (projectTotals[jobId] || 0) + parentHours;
      if (!projectEmployees[jobId]) projectEmployees[jobId] = new Set();
      projectEmployees[jobId].add(empId);
    });
  });

  const usedHours = totalHoursAllEmployees(weekKey);
  const capacity = totalEmployeeCapacity();
  const unutilizedHours = Math.max(0, capacity - usedHours);
  const utilizationPct = capacity > 0 ? Math.round((usedHours / capacity) * 100) : 0;
  chartHeaderLineEl.textContent = `Utilization: ${usedHours}/${capacity} - ${utilizationPct}%`;

  if (unutilizedHours > 0) {
    projectTotals['__unutilized__'] = unutilizedHours;
  }

  chartLegendEl.innerHTML = '';
  Object.entries(projectTotals).forEach(([jobId, hours]) => {
    const legendItem = document.createElement('div');
    legendItem.className = 'legend-item';

    const colorBox = document.createElement('div');
    colorBox.className = 'legend-color';

    let labelText = '';
    if (jobId === '__unutilized__') {
      colorBox.style.background = '#9ca3af';
      labelText = `Unutilized: ${hours} hrs`;
    } else {
      const job = data.jobs.find(j => j.id === jobId);
      if (!job) return;
      colorBox.style.background = job.color || '#03bafc';
      const empCount = projectEmployees[jobId] ? projectEmployees[jobId].size : 0;
      labelText = `${job.name}: ${hours} hrs (${empCount} employee${empCount === 1 ? '' : 's'})`;
    }

    const label = document.createElement('span');
    label.textContent = labelText;
    legendItem.appendChild(colorBox);
    legendItem.appendChild(label);
    chartLegendEl.appendChild(legendItem);
  });

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const jobIds = Object.keys(projectTotals);
  if (jobIds.length === 0) return;

  const width = canvas.width;
  const height = canvas.height;
  const max = Math.max(...Object.values(projectTotals), 1);
  const barWidth = Math.max(30, Math.min(60, (width - 80) / jobIds.length - 20));
  const gap = 20;
  const bottomMargin = 30;
  const topMargin = 30;
  const chartHeight = height - bottomMargin - topMargin;

  ctx.font = '11px Arial';
  ctx.textBaseline = 'middle';

  jobIds.forEach((jobId, index) => {
    const hours = projectTotals[jobId];
    const x = 40 + index * (barWidth + gap);
    const barHeight = (hours / max) * chartHeight;
    const y = height - bottomMargin - barHeight;

    let color = '#03bafc';
    let name = '';

    if (jobId === '__unutilized__') {
      color = '#9ca3af';
      name = 'Unutilized';
    } else {
      const job = data.jobs.find(j => j.id === jobId);
      if (!job) return;
      color = job.color || '#03bafc';
      name = job.name;
    }

    ctx.fillStyle = color;
    ctx.fillRect(x, y, barWidth, barHeight);

    const capForPct = totalEmployeeCapacity();
    const percentOfWorkload = capForPct > 0 ? Math.round((hours / capForPct) * 100) : 0;
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.fillText(`${hours}h (${percentOfWorkload}%)`, x + barWidth / 2, y - 10);

    ctx.save();
    ctx.translate(x + barWidth / 2, height - bottomMargin + 12);
    ctx.rotate(-Math.PI / 4);
    ctx.fillText(name, 0, 0);
    ctx.restore();
  });
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
  const ctx = canvas.getContext('2d');

  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#d1d5db' : '#111827';
  const bgColor = isDark ? '#1f2937' : '#ffffff';
  const gridColor = isDark ? '#374151' : '#e5e7eb';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const budgetedJobs = data.jobs.filter(j => (j.hoursBudget || 0) > 0);
  if (budgetedJobs.length === 0) {
    ctx.fillStyle = textColor;
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Set an Hours Budget on a job to see the burn-down chart.', canvas.width / 2, canvas.height / 2);
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
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
  const maxLabels = Math.floor(chartW / 60);
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
    ctx.fillText('No hours charged to budgeted jobs yet.', canvas.width / 2, canvas.height / 2);
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
}
