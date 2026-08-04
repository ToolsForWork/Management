import { createSnapshot, data, replaceData, saveToLocalStorage } from './data.js';

const ENDPOINT = '/api/workspace';
const POLL_INTERVAL_MS = 30_000;
let enabled = false;
let etag = '';
let lastSharedJson = '';
let pending = false;
let conflicted = false;
let applyingRemote = false;
let pushing = false;
let pushTimer = null;
let renderApp = () => {};
let toast = () => {};

export async function initializeTeamSync(options = {}) {
  renderApp = options.renderAll || renderApp;
  toast = options.showToast || toast;
  setStatus('local', 'Local only', 'Checking for a shared team workspace…');

  try {
    const response = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });
    if (response.status === 404) {
      setStatus('local', 'Local only', 'The shared API is not available on this host. Data is saved in this browser.');
      return;
    }
    if (response.status === 401 || response.status === 403) {
      setStatus('offline', 'Sign in required', 'Microsoft sign-in is required for team data.');
      return;
    }
    if (!response.ok && response.status !== 204) throw new Error(`Shared data returned ${response.status}.`);

    enabled = true;
    if (response.status === 204) {
      etag = '';
      pending = true;
      await pushSharedData();
    } else {
      await applyResponse(response);
    }
    document.addEventListener('planner:localsave', handleLocalSave);
    window.setInterval(pollSharedData, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) pollSharedData();
    });
  } catch (error) {
    console.warn('Team sync is unavailable:', error);
    setStatus('offline', 'Team sync offline', 'Local saves continue; team sync will retry when the page is refreshed.');
  }
}

export async function refreshTeamData() {
  if (!enabled) {
    toast('Team sync is not connected. This browser is saving locally.', 4000);
    return;
  }
  if ((pending || conflicted)
    && !window.confirm('Refresh from the team workspace and discard changes that have not synced from this browser? Export a backup first if you need them.')) return;
  pending = false;
  conflicted = false;
  await pollSharedData(true);
}

function handleLocalSave() {
  if (!enabled || applyingRemote || conflicted) return;
  const currentJson = sharedJson();
  if (currentJson === lastSharedJson) return;
  pending = true;
  setStatus('syncing', 'Saving to team…', 'A local change is waiting to be saved to the shared workspace.');
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(pushSharedData, 900);
}

async function pushSharedData() {
  if (!enabled || pushing || conflicted || !pending) return;
  pushing = true;
  const outgoingJson = sharedJson();
  setStatus('syncing', 'Saving to team…', 'Saving changes to the shared workspace.');
  try {
    const response = await fetch(ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ snapshot: JSON.parse(outgoingJson), baseEtag: etag || null })
    });
    if (response.status === 409) {
      conflicted = true;
      setStatus('conflict', 'Sync conflict', 'Someone else saved first. Export a backup if needed, then use Data → Refresh team data.');
      toast('Team data changed before your save completed. Your local copy was preserved; refresh team data to resolve it.', 6000);
      return;
    }
    if (response.status === 401 || response.status === 403) {
      setStatus('offline', 'Save denied', 'Your signed-in roster role cannot save this change.');
      toast('The team workspace rejected this change for your signed-in roster role.', 5000);
      return;
    }
    if (!response.ok) throw new Error(`Shared save returned ${response.status}.`);
    const payload = await response.json();
    etag = payload.etag || response.headers.get('etag') || etag;
    lastSharedJson = outgoingJson;
    pending = sharedJson() !== outgoingJson;
    setStatus('current', 'Team current', syncTitle(payload));
    if (pending) queueMicrotask(pushSharedData);
  } catch (error) {
    console.warn('Team save failed:', error);
    setStatus('offline', 'Team sync offline', 'The change remains saved in this browser and will retry in 30 seconds.');
  } finally {
    pushing = false;
    if (pending && !conflicted) {
      clearTimeout(pushTimer);
      pushTimer = window.setTimeout(pushSharedData, 250);
    }
  }
}

async function pollSharedData(force = false) {
  if (!enabled || pushing || conflicted) return;
  if (pending) {
    await pushSharedData();
    if (pending || conflicted) return;
  }
  try {
    const headers = { Accept: 'application/json' };
    if (etag && !force) headers['If-None-Match'] = etag;
    const response = await fetch(ENDPOINT, { headers });
    if (response.status === 304) {
      setStatus('current', 'Team current', 'Checked the shared workspace; no newer changes were found.');
      return;
    }
    if (response.status === 204) return;
    if (!response.ok) throw new Error(`Shared refresh returned ${response.status}.`);
    await applyResponse(response);
    renderApp();
  } catch (error) {
    console.warn('Team refresh failed:', error);
    setStatus('offline', 'Team sync offline', 'Local data is still available. The next check will retry automatically.');
  }
}

async function applyResponse(response) {
  const payload = await response.json();
  if (!payload.snapshot) throw new Error('The shared workspace response did not include data.');
  const localUserId = data.currentUserId;
  const localWeek = data.currentWeekStart;
  applyingRemote = true;
  try {
    replaceData({
      ...payload.snapshot,
      currentUserId: localUserId,
      currentWeekStart: localWeek.toISOString()
    });
    etag = payload.etag || response.headers.get('etag') || '';
    lastSharedJson = sharedJson();
    pending = false;
    conflicted = false;
    saveToLocalStorage();
    setStatus('current', 'Team current', syncTitle(payload));
  } finally {
    applyingRemote = false;
  }
}

function sharedJson() {
  const snapshot = createSnapshot();
  delete snapshot.currentUserId;
  delete snapshot.currentWeekStart;
  return JSON.stringify(snapshot);
}

function syncTitle(payload) {
  const time = payload.updatedAt ? new Date(payload.updatedAt).toLocaleString() : 'just now';
  return `Shared data last saved ${time}${payload.updatedBy ? ` by ${payload.updatedBy}` : ''}.`;
}

function setStatus(state, label, title) {
  const indicator = document.getElementById('teamSyncStatus');
  if (!indicator) return;
  indicator.className = `team-sync-status ${state}`;
  indicator.textContent = label;
  indicator.title = title;
}
