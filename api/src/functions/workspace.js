const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

const MAX_WORKSPACE_BYTES = 8 * 1024 * 1024;
let containerPromise;

app.http('workspace', {
  route: 'workspace',
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const principal = readPrincipal(request);
      if (!principal) return response(401, { error: 'Microsoft sign-in is required.' });
      const blob = await getWorkspaceBlob();
      const current = await readWorkspace(blob);
      const actor = current?.snapshot.employees.find(employee =>
        employee.active !== false && normalizeEmail(employee.email) === normalizeEmail(principal.userDetails));

      if (current && !actor) {
        return response(403, { error: 'The signed-in email is not on the active roster.' });
      }

      if (request.method === 'GET') {
        if (!current) return { status: 204 };
        if (request.headers.get('if-none-match') === current.etag) return { status: 304 };
        return response(200, publicEnvelope(current), { ETag: current.etag, 'Cache-Control': 'no-store' });
      }

      const body = await request.json();
      validateSnapshot(body?.snapshot);
      if ((body.baseEtag || '') !== (current?.etag || '')) {
        return response(409, {
          error: 'The shared workspace changed after this browser loaded it.',
          ...(current ? publicEnvelope(current) : {})
        });
      }

      if (!current) {
        if (!bootstrapEmails().has(normalizeEmail(principal.userDetails))) {
          return response(403, { error: 'This user is not configured to create the initial team workspace.' });
        }
      } else {
        if (!authorizeUpdate(actor, current.snapshot, body.snapshot)) {
          return response(403, { error: 'The requested changes are outside this roster role and reporting scope.' });
        }
      }

      const envelope = {
        snapshot: body.snapshot,
        updatedAt: new Date().toISOString(),
        updatedBy: principal.userDetails
      };
      const serialized = JSON.stringify(envelope);
      if (Buffer.byteLength(serialized) > MAX_WORKSPACE_BYTES) {
        return response(413, { error: 'The shared workspace is larger than the supported limit.' });
      }

      let upload;
      try {
        upload = await blob.uploadData(Buffer.from(serialized), {
          blobHTTPHeaders: { blobContentType: 'application/json' },
          conditions: current ? { ifMatch: current.etag } : { ifNoneMatch: '*' }
        });
      } catch (error) {
        if (error.statusCode === 409 || error.statusCode === 412) {
          return response(409, { error: 'Another user saved the workspace first.' });
        }
        throw error;
      }
      return response(200, { ...envelope, etag: upload.etag }, { ETag: upload.etag, 'Cache-Control': 'no-store' });
    } catch (error) {
      context.error(error);
      const status = error.name === 'ValidationError' ? 400 : 500;
      return response(status, { error: status === 400 ? error.message : 'The team workspace could not be processed.' });
    }
  }
});

function readPrincipal(request) {
  const encoded = request.headers.get('x-ms-client-principal');
  if (!encoded) return null;
  try {
    const principal = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    return principal?.userDetails ? principal : null;
  } catch {
    return null;
  }
}

async function getWorkspaceBlob() {
  const connectionString = process.env.TEAM_DATA_STORAGE_CONNECTION_STRING;
  if (!connectionString) throw new Error('TEAM_DATA_STORAGE_CONNECTION_STRING is not configured.');
  if (!containerPromise) {
    const service = BlobServiceClient.fromConnectionString(connectionString);
    const container = service.getContainerClient(process.env.TEAM_DATA_CONTAINER || 'management-data');
    containerPromise = container.createIfNotExists().then(() => container);
  }
  const container = await containerPromise;
  return container.getBlockBlobClient(process.env.TEAM_DATA_BLOB || 'team-workspace.json');
}

async function readWorkspace(blob) {
  try {
    const download = await blob.download();
    const chunks = [];
    for await (const chunk of download.readableStreamBody) chunks.push(chunk);
    const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    validateSnapshot(envelope.snapshot);
    return { ...envelope, etag: download.etag };
  } catch (error) {
    if (error.statusCode === 404) return null;
    throw error;
  }
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) fail('A workspace snapshot is required.');
  const arrays = ['employees', 'jobs', 'tasks', 'timeOff', 'checkIns', 'goals', 'oneOnOnes', 'activity'];
  arrays.forEach(key => {
    if (!Array.isArray(snapshot[key])) fail(`Workspace field ${key} must be a list.`);
  });
  if (!snapshot.assignments || typeof snapshot.assignments !== 'object' || Array.isArray(snapshot.assignments)) {
    fail('Workspace assignments must be an object.');
  }
  ['employees', 'jobs', 'tasks'].forEach(key => assertUniqueIds(snapshot[key], key));
  if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_WORKSPACE_BYTES) fail('The workspace is too large.');
}

function authorizeUpdate(actor, before, after) {
  if (actor.rosterRole === 'DM') return true;
  const beforeEmployees = byId(before.employees);
  const afterEmployees = byId(after.employees);
  const scopedIds = descendantIds(actor.id, before.employees);
  scopedIds.add(actor.id);

  if (changedRecords(before.employees, after.employees).some(({ oldValue, newValue }) => {
    if (actor.rosterRole !== 'ADM') return true;
    const target = oldValue || newValue;
    return !scopedIds.has(target.id) || target.id === actor.id || newValue?.rosterRole !== 'Estimator';
  })) return false;

  if (changedRecords(before.jobs, after.jobs).some(({ oldValue, newValue }) => {
    const project = newValue || oldValue;
    return actor.rosterRole === 'ADM'
      ? ![oldValue?.ownerId, newValue?.ownerId]
        .some(id => isScopedEmployee(id, actor, scopedIds, beforeEmployees, afterEmployees))
      : project.ownerId !== actor.id;
  })) return false;

  const beforeJobs = byId(before.jobs);
  const afterJobs = byId(after.jobs);
  if (changedRecords(before.tasks, after.tasks).some(({ oldValue, newValue }) => {
    const task = newValue || oldValue;
    if (actor.rosterRole === 'ADM') {
      const oldProject = beforeJobs.get(oldValue?.projectId);
      const newProject = afterJobs.get(newValue?.projectId);
      return ![
        oldValue?.assigneeId, newValue?.assigneeId,
        oldValue?.scopeOwnerId, newValue?.scopeOwnerId,
        oldProject?.ownerId, newProject?.ownerId
      ]
        .some(id => isScopedEmployee(id, actor, scopedIds, beforeEmployees, afterEmployees));
    }
    const ownedProject = beforeJobs.get(task.projectId)?.ownerId === actor.id
      || afterJobs.get(task.projectId)?.ownerId === actor.id;
    if (ownedProject) return false;
    if (!oldValue || !newValue) return true;
    if (oldValue?.assigneeId !== actor.id && newValue?.assigneeId !== actor.id) return true;
    if (newValue?.assigneeId && newValue.assigneeId !== actor.id) return true;
    return protectedTaskFieldsChanged(oldValue, newValue);
  })) return false;

  if (changedAssignments(before.assignments, after.assignments).some(employeeId =>
    actor.rosterRole === 'ADM' ? !scopedIds.has(employeeId) : employeeId !== actor.id)) return false;

  for (const key of ['timeOff', 'checkIns', 'goals', 'oneOnOnes']) {
    if (changedRecords(before[key], after[key]).some(({ oldValue, newValue }) => {
      const employeeId = (newValue || oldValue).employeeId;
      return actor.rosterRole === 'ADM' ? !scopedIds.has(employeeId) : employeeId !== actor.id;
    })) return false;
  }
  return true;
}

function protectedTaskFieldsChanged(oldValue, newValue) {
  if (!oldValue || !newValue) return false;
  const allowed = new Set(['assigneeId', 'progress', 'status', 'actualHours', 'workLogs', 'notes', 'updatedAt', 'plannedWeekKey']);
  return [...new Set([...Object.keys(oldValue), ...Object.keys(newValue)])]
    .some(key => !allowed.has(key) && JSON.stringify(oldValue[key]) !== JSON.stringify(newValue[key]));
}

function changedAssignments(before, after) {
  const employees = new Set();
  new Set([...Object.keys(before), ...Object.keys(after)]).forEach(weekKey => {
    const oldWeek = before[weekKey] || {};
    const newWeek = after[weekKey] || {};
    new Set([...Object.keys(oldWeek), ...Object.keys(newWeek)]).forEach(employeeId => {
      if (JSON.stringify(oldWeek[employeeId]) !== JSON.stringify(newWeek[employeeId])) employees.add(employeeId);
    });
  });
  return [...employees];
}

function isScopedEmployee(id, actor, scopedIds, beforeEmployees, afterEmployees) {
  if (!id || !scopedIds.has(id)) return false;
  const employee = afterEmployees.get(id) || beforeEmployees.get(id);
  return actor.district === 'E&I' || employee?.district === actor.district;
}

function descendantIds(managerId, employees) {
  const result = new Set();
  const visit = id => employees.filter(employee => employee.managerId === id).forEach(employee => {
    if (result.has(employee.id)) return;
    result.add(employee.id);
    visit(employee.id);
  });
  visit(managerId);
  return result;
}

function changedRecords(before, after) {
  const oldMap = byId(before);
  const newMap = byId(after);
  return [...new Set([...oldMap.keys(), ...newMap.keys()])]
    .filter(id => JSON.stringify(oldMap.get(id)) !== JSON.stringify(newMap.get(id)))
    .map(id => ({ oldValue: oldMap.get(id), newValue: newMap.get(id) }));
}

function byId(items) {
  return new Map(items.map(item => [item.id, item]));
}

function assertUniqueIds(items, label) {
  const ids = new Set();
  items.forEach(item => {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) fail(`${label} contains an invalid or duplicate ID.`);
    ids.add(item.id);
  });
}

function bootstrapEmails() {
  return new Set(String(process.env.TEAM_DATA_BOOTSTRAP_EMAILS || '').split(',').map(normalizeEmail).filter(Boolean));
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function publicEnvelope(envelope) {
  return {
    snapshot: envelope.snapshot,
    etag: envelope.etag,
    updatedAt: envelope.updatedAt,
    updatedBy: envelope.updatedBy
  };
}

function response(status, jsonBody, headers = {}) {
  return { status, jsonBody, headers };
}

function fail(message) {
  const error = new Error(message);
  error.name = 'ValidationError';
  throw error;
}
