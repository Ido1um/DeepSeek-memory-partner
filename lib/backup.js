import fs from 'node:fs';
import path from 'node:path';

/**
 * B2: panel-side backups.
 *
 * A backup is the same `dsmp-memory-pack` shape archive.js already exports
 * (memory + optional agent workspace + roles + settings), written under a
 * backup root with a timestamped name. The zip stays self-describing: its
 * manifest carries per-file sha256, so a restore re-verifies before touching
 * anything on disk.
 *
 * Restore never deletes: the current memory tree is renamed to
 * `<memoryDir>.before-restore-<stamp>` and left there for manual rollback.
 * dsmp/settings.json and sessions/ are deliberately NOT restored here — they
 * belong to the machine-move flow (B1), not to a memory rollback.
 */

let archiveImpl = null;

export function configureBackup({ archive }) {
  archiveImpl = archive;
}

function archive() {
  if (!archiveImpl) throw new Error('backup: 未注入 archive 实现（configureBackup）');
  return archiveImpl;
}

function httpError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function stampOf(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function safeName(input) {
  return String(input || '')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function backupRootOf(configuredDir, fallbackHome) {
  const dir = String(configuredDir || '').trim();
  if (dir) return dir;
  return path.join(fallbackHome, 'backups');
}

/** Newest first. Only `*.zip` files directly under the root are backups. */
export function listBackups(root) {
  if (!root || !fs.existsSync(root)) return [];
  const items = [];
  for (const name of fs.readdirSync(root)) {
    if (!name.toLowerCase().endsWith('.zip')) continue;
    const file = path.join(root, name);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    items.push({ file, name, bytes: stat.size, at: stat.mtime.toISOString(), meta: readSidecar(file) });
  }
  return items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

function sidecarOf(file) {
  return `${file}.json`;
}

function readSidecar(file) {
  try {
    return JSON.parse(fs.readFileSync(sidecarOf(file), 'utf8'));
  } catch {
    return null;
  }
}

/** Keep the newest `keep` archives; returns the names that were removed. */
export function pruneBackups(root, keep = 10) {
  const limit = Math.max(1, Number(keep) || 1);
  const items = listBackups(root);
  const removed = [];
  for (const item of items.slice(limit)) {
    try {
      fs.unlinkSync(item.file);
      removed.push(item.name);
    } catch {
      // A locked archive is skipped rather than failing the whole backup.
    }
    try {
      fs.unlinkSync(sidecarOf(item.file));
    } catch {
      // sidecar is optional
    }
  }
  return removed;
}

/**
 * @param {object} options
 * @param {string} options.memoryDir
 * @param {string} options.root
 * @param {number} [options.keep]
 */
export function createBackup(options) {
  const {
    memoryDir,
    root,
    name = '',
    keep = 10,
    rolesDir = '',
    settingsFile = '',
    sessionsRoot = '',
    boundSessionId = '',
    includeWorkspace = true,
    now = new Date(),
    machine = ''
  } = options || {};
  if (!memoryDir || !fs.existsSync(memoryDir)) {
    throw httpError('DSMP_BACKUP_SOURCE', `记忆目录不存在：${memoryDir}`);
  }
  const pack = archive().buildExport({
    memoryDir,
    rolesDir,
    settingsFile,
    includeWorkspace,
    boundSessionId,
    sessionsRoot
  });
  const checked = archive().verifyArchive(pack.buffer);
  if (!checked.ok) {
    throw httpError('DSMP_BACKUP_VERIFY', `备份自检失败：${(checked.problems || []).join('；')}`);
  }

  fs.mkdirSync(root, { recursive: true });
  const label = safeName(name) || 'memory';
  const base = `${stampOf(now)}-${label}`;
  let fileName = `${base}.zip`;
  let index = 2;
  while (fs.existsSync(path.join(root, fileName))) {
    fileName = `${base}-${index}.zip`;
    index += 1;
  }
  const file = path.join(root, fileName);
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, pack.buffer);
  fs.renameSync(temp, file);

  const meta = {
    file,
    name: fileName,
    bytes: pack.buffer.length,
    files: pack.files,
    createdAt: now.toISOString(),
    memoryDir,
    machine,
    manifest: {
      fileCount: pack.manifest.fileCount,
      bytes: pack.manifest.bytes,
      hashes: undefined,
      hashCount: Object.keys(pack.manifest.hashes || {}).length,
      boundSessionId: pack.manifest.boundSessionId || '',
      includeWorkspace: Boolean(pack.manifest.includeWorkspace)
    }
  };
  try {
    fs.writeFileSync(sidecarOf(file), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  } catch {
    // Losing the sidecar only costs a manifest read on the next list.
  }
  const removed = pruneBackups(root, keep);
  return { ok: true, backup: meta, removed, items: listBackups(root) };
}

function extractEntries(entries, targetDir, { includeWorkspace = true } = {}) {
  const plan = { memoryFiles: 0, roleFiles: 0, workspaceFiles: 0 };
  for (const entry of entries) {
    if (entry.name === 'manifest.json') continue;
    let rel = '';
    if (entry.name.startsWith('memory/')) {
      rel = entry.name.slice('memory/'.length);
      plan.memoryFiles += 1;
    } else if (entry.name.startsWith('roles/')) {
      rel = `roles/${entry.name.slice('roles/'.length)}`;
      plan.roleFiles += 1;
    } else if (entry.name.startsWith('workspace/agent/')) {
      if (!includeWorkspace) continue;
      rel = `agent/${entry.name.slice('workspace/agent/'.length)}`;
      plan.workspaceFiles += 1;
    } else {
      // sessions/ and dsmp/settings.json are machine-move concerns (B1).
      continue;
    }
    const target = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
  }
  return plan;
}

/**
 * Restore a backup over `memoryDir`.
 * `dryRun` verifies and reports; `overwrite` must be true when the target is non-empty.
 */
export function restoreBackup(options) {
  const { file, memoryDir, dryRun = false, overwrite = false, now = new Date() } = options || {};
  if (!file || !fs.existsSync(file)) {
    throw httpError('DSMP_BACKUP_FILE', `找不到备份文件：${file}`);
  }
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch (err) {
    throw httpError('DSMP_BACKUP_READ', `读取备份失败：${err.message}`);
  }
  const checked = archive().verifyArchive(buffer);
  if (!checked.ok) {
    return { ok: false, phase: 'verify', problems: checked.problems || [], missing: checked.missing || [], mismatched: checked.mismatched || [] };
  }
  const manifest = checked.manifest || {};
  const counts = { memoryFiles: 0, roleFiles: 0, workspaceFiles: 0 };
  for (const entry of checked.entries || []) {
    if (entry.name.startsWith('memory/')) counts.memoryFiles += 1;
    else if (entry.name.startsWith('roles/')) counts.roleFiles += 1;
    else if (entry.name.startsWith('workspace/agent/')) counts.workspaceFiles += 1;
  }
  const plan = { ...counts, source: manifest.memoryDir || '', createdAt: manifest.createdAt || '' };
  if (dryRun) {
    return { ok: true, phase: 'preview', plan, manifest: { ...manifest, hashes: undefined } };
  }

  const exists = fs.existsSync(memoryDir);
  if (exists && fs.readdirSync(memoryDir).length && !overwrite) {
    return {
      ok: false,
      phase: 'preflight',
      problems: [`目标记忆目录不是空的：${memoryDir}（确认恢复会先整目录改名备份）`],
      plan
    };
  }

  const parent = path.dirname(memoryDir);
  fs.mkdirSync(parent, { recursive: true });
  const temp = path.join(parent, `.restore-${process.pid}-${Date.now()}`);
  let safetyDir = '';
  try {
    fs.mkdirSync(temp, { recursive: true });
    extractEntries(checked.entries || [], temp, { includeWorkspace: manifest.includeWorkspace !== false });
    if (exists) {
      safetyDir = `${memoryDir}.before-restore-${stampOf(now)}`;
      let n = 2;
      while (fs.existsSync(safetyDir)) {
        safetyDir = `${memoryDir}.before-restore-${stampOf(now)}-${n}`;
        n += 1;
      }
      fs.renameSync(memoryDir, safetyDir);
    }
    fs.renameSync(temp, memoryDir);
  } catch (err) {
    try {
      if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true, force: true });
      if (safetyDir && !fs.existsSync(memoryDir) && fs.existsSync(safetyDir)) fs.renameSync(safetyDir, memoryDir);
    } catch {
      // best effort
    }
    throw httpError('DSMP_BACKUP_RESTORE', `恢复失败：${err.message}`);
  }

  return { ok: true, phase: 'done', plan, restored: counts, safetyDir };
}
