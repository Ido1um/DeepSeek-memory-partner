import fs from 'node:fs';
import path from 'node:path';
import { readSettings } from './settings.js';

const ROLE_EXT = '.md';

/** Keep only a safe `*.md` basename; return '' when the input is unusable. */
export function normalizeRoleName(name) {
  const base = path.basename(String(name ?? '').trim());
  if (!base || base === '.' || base === '..') return '';
  if (!base.toLowerCase().endsWith(ROLE_EXT)) return '';
  if (/[\\/:*?"<>|]/.test(base)) return '';
  return base;
}

/**
 * Active role card name, following the bridge's `state/current-role.json`.
 * Falls back to the configured name when the file is missing or malformed.
 */
export function activeRole(settings = readSettings()) {
  const fallback = String(settings.roles.fallbackName || '').trim() || '助手';
  let name = '';
  let source = 'fallback';
  try {
    const raw = JSON.parse(fs.readFileSync(settings.roles.activeFile, 'utf8'));
    // current-role.json stores a bare name ("<PERSONA>"); accept both forms.
    const written = String((raw && (raw.role || raw.name)) || '').trim();
    const withExt = written.toLowerCase().endsWith(ROLE_EXT) ? written : `${written}${ROLE_EXT}`;
    const candidate = normalizeRoleName(withExt);
    if (candidate) {
      name = candidate.slice(0, -ROLE_EXT.length);
      source = 'current-role.json';
    }
  } catch {
    // Missing or unreadable state file: keep the fallback.
  }
  return { name: name || fallback, source };
}

/** Active role name; the prefix is optional and empty by default. */
export function panelLabel(settings = readSettings()) {
  const prefix = String(settings.ui.panelLabelPrefix ?? '');
  return `${prefix}${activeRole(settings).name}`;
}

export function listRoles(settings = readSettings()) {
  const dir = settings.roles.dir;
  const active = activeRole(settings).name;
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((entry) => {
      if (!entry.toLowerCase().endsWith(ROLE_EXT)) return false;
      // README / 说明文档不是人设卡，别混进下拉框。
      return !/^readme\b/i.test(entry);
    });
  } catch {
    names = [];
  }
  const roles = names
    .map((file) => {
      const full = path.join(dir, file);
      let size = 0;
      let mtime = '';
      try {
        const st = fs.statSync(full);
        size = st.size;
        mtime = st.mtime.toISOString();
      } catch {
        // unreadable role: still list the name
      }
      return { name: file.slice(0, -ROLE_EXT.length), size, mtime, active: file.slice(0, -ROLE_EXT.length) === active };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return { dir, active, roles };
}

/** Accept both `<PERSONA>` and `<PERSONA>.md`; reject other extensions outright. */
function roleFileOf(name) {
  const raw = path.basename(String(name ?? '').trim());
  if (!raw) return '';
  return normalizeRoleName(raw.includes('.') ? raw : `${raw}${ROLE_EXT}`);
}

export function readRoleText(name, settings = readSettings()) {
  const safe = roleFileOf(name) || `${activeRole(settings).name}${ROLE_EXT}`;
  return fs.readFileSync(path.join(settings.roles.dir, safe), 'utf8');
}

export const ROLE_MAX_CHARS = 30000;

/**
 * Overwrite a role card in place. Writes a timestamped backup next to the file
 * first, so a bad edit never destroys the only copy.
 */
export function saveRoleText(name, text, settings = readSettings()) {
  const safe = roleFileOf(name);
  if (!safe) {
    const err = new Error('人设卡文件名必须是安全的 .md 文件名');
    err.code = 'DSMP_ROLE_NAME';
    throw err;
  }
  const body = String(text ?? '');
  if (!body.trim()) {
    const err = new Error('人设卡内容不能为空');
    err.code = 'DSMP_ROLE_EMPTY';
    throw err;
  }
  if (body.length > ROLE_MAX_CHARS) {
    const err = new Error(`人设卡内容过长（上限 ${ROLE_MAX_CHARS} 字符）`);
    err.code = 'DSMP_ROLE_TOO_LARGE';
    throw err;
  }
  const file = path.join(settings.roles.dir, safe);
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, `${file}.bak-dsmp-${stamp}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-dsmp`;
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, file);
  return { name: safe.slice(0, -ROLE_EXT.length), file, chars: body.length };
}

/** Delete a card, keeping a `.bak-dsmp-*` copy so the text is not lost. */
export function deleteRoleText(name, settings = readSettings()) {
  const safe = roleFileOf(name);
  if (!safe) {
    const err = new Error('人设卡文件名必须是安全的 .md 文件名');
    err.code = 'DSMP_ROLE_NAME';
    throw err;
  }
  const file = path.join(settings.roles.dir, safe);
  if (!fs.existsSync(file)) {
    const err = new Error(`人设卡不存在：${safe}`);
    err.code = 'DSMP_ROLE_MISSING';
    throw err;
  }
  const active = activeRole(settings);
  if (String(active.name) === safe.slice(0, -ROLE_EXT.length)) {
    const err = new Error('不能删除当前正在使用的人设卡，请先切换');
    err.code = 'DSMP_ROLE_ACTIVE';
    throw err;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${file}.bak-dsmp-${stamp}`;
  fs.copyFileSync(file, backup);
  fs.unlinkSync(file);
  return { name: safe.slice(0, -ROLE_EXT.length), file, backup };
}

/** Mirror location: `<memoryDir>/roles`, so the persona travels with the memory pack. */
export function mirrorDirOf(memoryDir) {
  const dir = String(memoryDir || '').trim();
  return dir ? path.join(dir, 'roles') : '';
}

/**
 * Copy every role card into `<memoryDir>/roles` (plus an `active.json` marker).
 *
 * The bridge's roles directory stays the source of truth — the mirror exists so
 * that migrating/exporting the memory directory also carries the persona with it.
 * Best effort: problems are collected in `errors`, never thrown at the caller.
 */
export function syncRolesToMemory({ settings = readSettings(), memoryDir, now = Date.now(), prune = true } = {}) {
  const source = settings.roles.dir;
  const target = mirrorDirOf(memoryDir);
  const out = { ok: false, source, dir: target, count: 0, written: [], unchanged: [], removed: [], errors: [] };
  if (!target) {
    out.error = '缺少记忆目录，无法同步人设卡';
    return out;
  }
  try {
    fs.mkdirSync(target, { recursive: true });
    let names = [];
    try {
      names = fs.readdirSync(source).filter((entry) => {
        if (!entry.toLowerCase().endsWith(ROLE_EXT)) return false;
        if (/^readme\b/i.test(entry)) return false;
        if (/\.(bak|tmp)-/i.test(entry)) return false;
        return true;
      });
    } catch (err) {
      out.error = `读取人设卡目录失败：${err.message}`;
      return out;
    }
    for (const file of names) {
      try {
        const body = fs.readFileSync(path.join(source, file), 'utf8');
        const dest = path.join(target, file);
        let same = false;
        try {
          same = fs.readFileSync(dest, 'utf8') === body;
        } catch {
          // missing mirror copy: write it below
        }
        if (same) {
          out.unchanged.push(file);
          continue;
        }
        const tmp = `${dest}.tmp-dsmp`;
        fs.writeFileSync(tmp, body, 'utf8');
        fs.renameSync(tmp, dest);
        out.written.push(file);
      } catch (err) {
        out.errors.push(`${file}: ${err.message}`);
      }
    }
    const active = activeRole(settings);
    fs.writeFileSync(
      path.join(target, 'active.json'),
      JSON.stringify({ role: active.name, source: active.source, syncedAt: new Date(now).toISOString() }, null, 2),
      'utf8'
    );
    // Prune mirror copies whose source card is gone, so deleting a card in the
    // panel does not leave a ghost in `<memoryDir>/roles`.
    if (prune) {
      const keep = new Set(names);
      try {
        for (const entry of fs.readdirSync(target)) {
          if (!entry.toLowerCase().endsWith(ROLE_EXT)) continue;
          if (keep.has(entry)) continue;
          try {
            fs.unlinkSync(path.join(target, entry));
            out.removed.push(entry);
          } catch (err) {
            out.errors.push(`${entry}: ${err.message}`);
          }
        }
      } catch (err) {
        out.errors.push(`清理镜像失败：${err.message}`);
      }
    }
    out.count = names.length;
    out.active = active.name;
    out.ok = out.errors.length === 0;
  } catch (err) {
    out.error = err.message;
  }
  return out;
}

/** Read-only summary of the mirror, for status cards. */
export function mirrorSummary(memoryDir) {
  const dir = mirrorDirOf(memoryDir);
  const out = { dir, exists: false, count: 0, active: '', syncedAt: '' };
  if (!dir) return out;
  try {
    const names = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(ROLE_EXT) && !/^readme\b/i.test(f));
    out.exists = true;
    out.count = names.length;
    const marker = JSON.parse(fs.readFileSync(path.join(dir, 'active.json'), 'utf8'));
    out.active = String(marker.role || '');
    out.syncedAt = String(marker.syncedAt || '');
  } catch {
    // missing or unreadable mirror: leave the defaults
  }
  return out;
}
