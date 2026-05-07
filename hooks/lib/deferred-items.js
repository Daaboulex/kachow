'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const HANDOFFS_ROOT = path.join(os.homedir(), '.ai-context', 'handoffs');
const DEFERRED_PATH = path.join(HANDOFFS_ROOT, 'deferred', 'items.json');
const USER_ACTIONS_PATH = path.join(HANDOFFS_ROOT, 'user-actions', 'items.json');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function storePath(store) {
  return store === 'user-actions' ? USER_ACTIONS_PATH : DEFERRED_PATH;
}

function readItems(store) {
  try {
    return JSON.parse(fs.readFileSync(storePath(store), 'utf8'));
  } catch {
    return { schema_version: 1, items: [] };
  }
}

function writeItems(store, data) {
  const p = storePath(store);
  ensureDir(path.dirname(p));
  const tmp = p + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}

function addItem({ title, type, project_key, context, trigger_after, created_session }) {
  const item = {
    id: 'd-' + crypto.randomBytes(4).toString('hex'),
    title,
    type,
    project_key: project_key || null,
    created_at: new Date().toISOString(),
    created_session: created_session || null,
    last_seen_session: null,
    last_seen_at: null,
    defer_count: 0,
    status: 'active',
    context: context || null,
    trigger_after: trigger_after || null,
    triage_count: 0,
  };

  const targetStore = type === 'user-action' ? 'user-actions' : 'deferred';
  const data = readItems(targetStore);
  data.items.push(item);
  writeItems(targetStore, data);
  return item;
}

function archiveItem(id) {
  for (const store of ['deferred', 'user-actions']) {
    const data = readItems(store);
    const item = data.items.find(i => i.id === id);
    if (item) {
      item.status = 'archived';
      writeItems(store, data);
      return true;
    }
  }
  return false;
}

function reclassifyItem(id, newType) {
  const newStore = newType === 'user-action' ? 'user-actions' : 'deferred';

  for (const store of ['deferred', 'user-actions']) {
    const data = readItems(store);
    const idx = data.items.findIndex(i => i.id === id);
    if (idx === -1) continue;

    const item = data.items.splice(idx, 1)[0];
    item.type = newType;
    writeItems(store, data);

    if (store !== newStore) {
      const targetData = readItems(newStore);
      targetData.items.push(item);
      writeItems(newStore, targetData);
    } else {
      data.items.push(item);
      writeItems(store, data);
    }
    return true;
  }
  return false;
}

function computeStaleness(items, projectKey, sessionId) {
  const now = Date.now();
  const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
  const stale = [];
  const nonStale = [];

  for (const item of items) {
    if (item.status !== 'active') continue;
    if (item.project_key && item.project_key !== projectKey) continue;

    if (item.type === 'blocked') {
      if (item.trigger_after && new Date(item.trigger_after).getTime() > now) continue;
      item.type = 'ai-actionable';
    }

    if (item.type === 'ai-actionable') {
      const age = now - new Date(item.created_at).getTime();
      if (item.defer_count >= 5 || age > FOURTEEN_DAYS) {
        stale.push(item);
      } else {
        nonStale.push(item);
      }
    } else if (item.type === 'decision') {
      if (item.triage_count < 2) {
        stale.push(item);
      }
    }
  }

  return { stale, nonStale };
}

function incrementDeferCounts(projectKey, sessionId) {
  const data = readItems('deferred');
  let changed = false;
  for (const item of data.items) {
    if (item.status !== 'active') continue;
    if (item.type !== 'ai-actionable') continue;
    if (item.project_key && item.project_key !== projectKey) continue;
    item.defer_count++;
    item.last_seen_session = sessionId;
    item.last_seen_at = new Date().toISOString();
    changed = true;
  }
  if (changed) writeItems('deferred', data);
  return changed;
}

function incrementTriageCounts(itemIds) {
  const data = readItems('deferred');
  let changed = false;
  for (const item of data.items) {
    if (!itemIds.includes(item.id)) continue;
    item.triage_count = (item.triage_count || 0) + 1;
    changed = true;
  }
  if (changed) writeItems('deferred', data);
  return changed;
}

module.exports = {
  DEFERRED_PATH, USER_ACTIONS_PATH,
  readItems, writeItems, addItem, archiveItem, reclassifyItem,
  computeStaleness, incrementDeferCounts, incrementTriageCounts,
};
