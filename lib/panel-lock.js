import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 面板连发的跨实例锁。
 *
 * 为什么需要文件锁：插件在开发期会被 bundle 开关反复重载，宿主里可能同时存在
 * 新旧两个 apply() 闭包（各自一个内存 Set），纯内存守卫挡不住第二个实例。
 * 锁文件用 O_EXCL 原子创建，谁先建谁说话；回合结束或出错时删掉，超时自动失效。
 */

const DEFAULT_TTL_MS = 180000;

export function dsmpHomePath() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'dsmp');
}

export function lockFileOf(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(dsmpHomePath(), `panel-lock-${safe}.json`);
}

export function tryAcquire(sessionId, { ttlMs = DEFAULT_TTL_MS, now = Date.now(), dir } = {}) {
  const file = dir ? path.join(dir, path.basename(lockFileOf(sessionId))) : lockFileOf(sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = JSON.stringify({ sessionId, pid: process.pid, at: now });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, payload);
      fs.closeSync(fd);
      return { ok: true, file };
    } catch (err) {
      if (err && err.code !== 'EEXIST') return { ok: false, code: 'DSMP_LOCK_FAILED', error: String(err.message || err), file };
      let info = null;
      try {
        info = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        info = null;
      }
      const at = Number(info && info.at) || 0;
      const holderPid = Number(info && info.pid) || 0;
      // 持锁进程已经不在了：立刻抢占，不必干等 TTL（DSH 被强杀时最常见）。
      const holderDead = holderPid > 0 && holderPid !== process.pid && !pidAlive(holderPid);
      if (!holderDead && at && now - at < ttlMs) return { ok: false, code: 'DSMP_SESSION_BUSY', file, holder: info };
      try {
        fs.unlinkSync(file);
      } catch {
        /* someone else removed it first */
      }
    }
  }
  return { ok: false, code: 'DSMP_SESSION_BUSY', file };
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

export function release(sessionId, { dir } = {}) {
  const file = dir ? path.join(dir, path.basename(lockFileOf(sessionId))) : lockFileOf(sessionId);
  try {
    fs.unlinkSync(file);
    return { ok: true, file };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, file, absent: true };
    return { ok: false, file, error: String(err.message || err) };
  }
}

export function readLock(sessionId, { now = Date.now(), ttlMs = DEFAULT_TTL_MS, dir } = {}) {
  const file = dir ? path.join(dir, path.basename(lockFileOf(sessionId))) : lockFileOf(sessionId);
  try {
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { present: true, live: now - Number(info.at || 0) < ttlMs, info, file };
  } catch {
    return { present: false, live: false, file };
  }
}
