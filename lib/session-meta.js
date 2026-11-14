import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Panel-side session metadata: display name + hidden flag.
 *
 * Deleting here means "remove from the panel and stop the agent", never
 * "delete the session log" — the DSH transcript stays on disk and the session
 * can come back by clearing the flag (setTitle/restore both keep the file).
 */

// Inlined instead of importing paths.js: this module is loaded through the
// dev-reload data-URL loader, where relative imports cannot be resolved.
function dsmpHome() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'dsmp');
}

function metaFile() {
  return path.join(dsmpHome(), 'session-meta.json');
}

function readAll() {
  try {
    const raw = JSON.parse(fs.readFileSync(metaFile(), 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  const file = metaFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

export function metaOf(sessionId) {
  const row = readAll()[String(sessionId)] || {};
  return { title: typeof row.title === 'string' ? row.title : '', hidden: Boolean(row.hidden) };
}

export function setTitle(sessionId, title) {
  const all = readAll();
  const key = String(sessionId);
  const clean = String(title || '').trim().slice(0, 60);
  all[key] = { ...(all[key] || {}), title: clean };
  writeAll(all);
  return { ok: true, sessionId: key, title: clean };
}

export function hideSession(sessionId) {
  const all = readAll();
  const key = String(sessionId);
  all[key] = { ...(all[key] || {}), hidden: true };
  writeAll(all);
  return { ok: true, sessionId: key, hidden: true };
}

export function restoreSession(sessionId) {
  const all = readAll();
  const key = String(sessionId);
  if (!all[key]) return { ok: true, sessionId: key, hidden: false };
  all[key] = { ...all[key], hidden: false };
  writeAll(all);
  return { ok: true, sessionId: key, hidden: false };
}

/** Apply the panel metadata to a listSessions() payload. */
export function decorateSessions(payload) {
  const all = readAll();
  const rows = Array.isArray(payload && payload.sessions) ? payload.sessions : [];
  const sessions = rows
    .map((row) => {
      const meta = all[row.id] || {};
      return {
        ...row,
        title: (typeof meta.title === 'string' && meta.title) || row.title || '',
        hidden: Boolean(meta.hidden)
      };
    })
    .filter((row) => !row.hidden);
  return { ...payload, sessions, count: sessions.length, hiddenCount: rows.length - sessions.length };
}
