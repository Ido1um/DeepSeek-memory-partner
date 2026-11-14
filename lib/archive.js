import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// zip helpers are injected: under the dev data: URL reloader a relative import
// has no hierarchical base to resolve against.
let zipImpl = null;
export function configureZip(impl) {
  zipImpl = impl;
}
function zipper() {
  if (!zipImpl) throw new Error('archive: 未注入 zip 实现（configureZip）');
  return zipImpl;
}

/**
 * Memory-pack export / import.
 *
 * Layout inside the zip:
 *   manifest.json              ← version, counts, per-file sha256, bound session
 *   memory/…                   ← the memory data (backup/ and agent/ excluded by default)
 *   workspace/agent/…          ← optional: the QQ agent workspace
 *   sessions/<dir>/<sid>/…     ← optional: the bound DSH session log
 *   roles/<name>.md            ← optional: role cards
 *   dsmp/settings.json         ← optional: plugin settings (secrets stripped)
 */

const EXCLUDED_DIRS = new Set(['backup', 'node_modules', 'scratch', 'shadow', '.git']);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalize(rel) {
  return rel.replace(/\\/g, '/');
}

export function collectFiles(root, { prefix = '', excludeTop = [] } = {}) {
  const out = [];
  const skip = new Set(excludeTop);
  const walk = (dir, rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        if (!rel && skip.has(entry.name)) continue;
        walk(full, next);
      } else if (entry.isFile()) {
        out.push({ file: full, name: `${prefix}${next}` });
      }
    }
  };
  walk(root, '');
  return out;
}

/**
 * @param {object} options
 * @param {string} options.memoryDir
 * @param {string} [options.rolesDir]
 * @param {string} [options.settingsFile]
 * @param {boolean} [options.includeWorkspace]
 * @param {string} [options.boundSessionId]
 * @param {string} [options.sessionsRoot]
 */
export function buildExport(options) {
  const { memoryDir, rolesDir, settingsFile, includeWorkspace = false, boundSessionId = '', sessionsRoot = '' } = options;
  if (!memoryDir || !fs.existsSync(memoryDir)) {
    const err = new Error(`记忆目录不存在：${memoryDir}`);
    err.code = 'DSMP_EXPORT_SOURCE';
    throw err;
  }

  const entries = [];
  const hashes = {};
  let bytes = 0;
  const memoryFiles = collectFiles(memoryDir, {
    prefix: 'memory/',
    excludeTop: includeWorkspace ? [] : ['agent']
  });
  for (const item of memoryFiles) {
    const data = fs.readFileSync(item.file);
    entries.push({ name: item.name, data, mtime: fs.statSync(item.file).mtime });
    hashes[item.name] = sha256(data);
    bytes += data.length;
  }

  if (includeWorkspace) {
    const agentDir = path.join(memoryDir, 'agent');
    if (fs.existsSync(agentDir)) {
      for (const item of collectFiles(agentDir, { prefix: 'workspace/agent/' })) {
        const data = fs.readFileSync(item.file);
        entries.push({ name: item.name, data, mtime: fs.statSync(item.file).mtime });
        hashes[item.name] = sha256(data);
        bytes += data.length;
      }
    }
  }

  if (boundSessionId && sessionsRoot && fs.existsSync(sessionsRoot)) {
    for (const dir of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const sessionDir = path.join(sessionsRoot, dir.name, boundSessionId);
      if (!fs.existsSync(sessionDir)) continue;
      for (const item of collectFiles(sessionDir, { prefix: `sessions/${dir.name}/${boundSessionId}/` })) {
        const data = fs.readFileSync(item.file);
        entries.push({ name: item.name, data, mtime: fs.statSync(item.file).mtime });
        hashes[item.name] = sha256(data);
        bytes += data.length;
      }
    }
  }

  if (rolesDir && fs.existsSync(rolesDir)) {
    for (const name of fs.readdirSync(rolesDir)) {
      if (!name.toLowerCase().endsWith('.md')) continue;
      const data = fs.readFileSync(path.join(rolesDir, name));
      entries.push({ name: `roles/${name}`, data, mtime: fs.statSync(path.join(rolesDir, name)).mtime });
      hashes[`roles/${name}`] = sha256(data);
      bytes += data.length;
    }
  }

  if (settingsFile && fs.existsSync(settingsFile)) {
    const data = fs.readFileSync(settingsFile);
    entries.push({ name: 'dsmp/settings.json', data, mtime: new Date() });
    hashes['dsmp/settings.json'] = sha256(data);
    bytes += data.length;
  }

  const manifest = {
    kind: 'dsmp-memory-pack',
    version: 1,
    createdAt: new Date().toISOString(),
    sourceMachine: process.env.COMPUTERNAME || process.env.HOSTNAME || 'unknown',
    memoryDir,
    includeWorkspace,
    boundSessionId,
    fileCount: entries.length,
    bytes,
    hashes
  };
  entries.unshift({
    name: 'manifest.json',
    data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    mtime: new Date()
  });

  const buffer = zipper().createZip(entries);
  return { buffer, manifest, files: entries.length };
}

/** Parse a pack and verify every entry against the manifest hashes. */
export function verifyArchive(buffer) {
  const entries = zipper().readZip(buffer);
  const manifestEntry = entries.find((entry) => entry.name === 'manifest.json');
  if (!manifestEntry) return { ok: false, problems: ['包里没有 manifest.json'] };
  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  } catch {
    return { ok: false, problems: ['manifest.json 不是合法 JSON'] };
  }
  if (manifest.kind !== 'dsmp-memory-pack') return { ok: false, problems: ['manifest.kind 不是 dsmp-memory-pack'] };

  const problems = [];
  const missing = [];
  const mismatched = [];
  for (const [name, hash] of Object.entries(manifest.hashes || {})) {
    const entry = entries.find((item) => item.name === name);
    if (!entry) {
      missing.push(name);
      continue;
    }
    if (sha256(entry.data) !== hash) mismatched.push(name);
  }
  if (missing.length) problems.push(`缺少 ${missing.length} 个文件`);
  if (mismatched.length) problems.push(`${mismatched.length} 个文件哈希不符`);

  const extras = entries
    .map((entry) => entry.name)
    .filter((name) => name !== 'manifest.json' && !(manifest.hashes || {})[name]);
  if (extras.length) problems.push(`manifest 之外多出 ${extras.length} 个文件`);

  return {
    ok: problems.length === 0,
    problems,
    manifest,
    entries,
    missing: missing.slice(0, 20),
    mismatched: mismatched.slice(0, 20),
    extras: extras.slice(0, 20)
  };
}

/**
 * Import a verified pack into `targetDir`.
 * `dryRun` verifies only; `overwrite` must be true when the target already exists.
 */
export function importArchive({ buffer, targetDir, dryRun = false, overwrite = false, includeWorkspace = true }) {
  const checked = verifyArchive(buffer);
  if (!checked.ok) return { ok: false, phase: 'verify', problems: checked.problems };

  const plan = { targetDir, files: checked.entries.length, memoryFiles: 0, workspaceFiles: 0, sessionFiles: 0, roleFiles: 0 };
  for (const entry of checked.entries) {
    if (entry.name.startsWith('memory/')) plan.memoryFiles += 1;
    else if (entry.name.startsWith('workspace/')) plan.workspaceFiles += 1;
    else if (entry.name.startsWith('sessions/')) plan.sessionFiles += 1;
    else if (entry.name.startsWith('roles/')) plan.roleFiles += 1;
  }
  if (dryRun) return { ok: true, dryRun: true, phase: 'verify', plan, manifest: checked.manifest };

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length && !overwrite) {
    return { ok: false, phase: 'preflight', problems: [`目标目录不是空的：${targetDir}（需要 overwrite=true）`] };
  }

  let written = 0;
  for (const entry of checked.entries) {
    if (entry.name === 'manifest.json') continue;
    let rel = entry.name;
    if (rel.startsWith('workspace/agent/')) {
      if (!includeWorkspace) continue;
      rel = `agent/${rel.slice('workspace/agent/'.length)}`;
    } else if (rel.startsWith('memory/')) {
      rel = rel.slice('memory/'.length);
    } else if (rel.startsWith('sessions/') || rel.startsWith('roles/') || rel.startsWith('dsmp/')) {
      // Not part of the memory tree; callers handle these explicitly.
      continue;
    }
    const target = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
    written += 1;
  }
  return { ok: true, phase: 'done', written, plan, manifest: checked.manifest };
}
