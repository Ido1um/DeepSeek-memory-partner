import fs from 'node:fs';
import path from 'node:path';

/**
 * 单写者租约：DSMP 与 qq-bridge 之间约定「同一时刻只有一个人写记忆」。
 *
 * 文件：<memoryDir>/state/engine-lease.json
 * 形状：{ owner, pid, startedAt, heartbeatAt, ttlMs, version }
 *
 * 规则：
 * - 租约未过期且 owner 不是自己 → 不抢，降级只读。
 * - 租约过期 → 可以接管（记下 from 便于排查）。
 * - 心跳 15s 刷新 heartbeatAt；ttlMs 默认 60s。
 */

export const LEASE_VERSION = 1;
export const DEFAULT_TTL_MS = 60_000;
export const HEARTBEAT_MS = 15_000;

export function leaseFilePath(memoryDir) {
  return path.join(String(memoryDir || ''), 'state', 'engine-lease.json');
}

export function readLease(memoryDir) {
  const file = leaseFilePath(memoryDir);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return {
      owner: String(data.owner || ''),
      pid: Number(data.pid) || 0,
      startedAt: Number(data.startedAt) || 0,
      heartbeatAt: Number(data.heartbeatAt) || 0,
      ttlMs: Number(data.ttlMs) || DEFAULT_TTL_MS,
      version: Number(data.version) || LEASE_VERSION,
      file
    };
  } catch {
    return null;
  }
}

export function leaseAge(lease, now = Date.now()) {
  if (!lease) return Infinity;
  return now - lease.heartbeatAt;
}

export function leaseLive(lease, now = Date.now()) {
  if (!lease || !lease.owner) return false;
  return leaseAge(lease, now) <= lease.ttlMs;
}

export function leaseOwnedBy(memoryDir, owner, now = Date.now()) {
  const lease = readLease(memoryDir);
  return Boolean(lease && lease.owner === owner && leaseLive(lease, now));
}

function writeLease(memoryDir, lease) {
  const file = leaseFilePath(memoryDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ ...lease, version: LEASE_VERSION }, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return { ...lease, file };
}

/**
 * 抢租约。成功返回 { ok:true, lease, tookOverFrom }；被活租约占着返回 { ok:false, lease, reason }。
 */
export function acquireLease({ memoryDir, owner = 'dsmp', pid = process.pid, ttlMs = DEFAULT_TTL_MS, now = Date.now() } = {}) {
  const current = readLease(memoryDir);
  if (current && current.owner !== owner && leaseLive(current, now)) {
    return { ok: false, reason: 'held-by-other', lease: current };
  }
  const tookOverFrom = current && current.owner !== owner ? current.owner : '';
  const lease = writeLease(memoryDir, {
    owner,
    pid,
    startedAt: now,
    heartbeatAt: now,
    ttlMs
  });
  return { ok: true, lease, tookOverFrom };
}

export function heartbeatLease({ memoryDir, owner = 'dsmp', ttlMs, now = Date.now() } = {}) {
  const current = readLease(memoryDir);
  if (!current || current.owner !== owner) return { ok: false, reason: 'not-owner', lease: current };
  const lease = writeLease(memoryDir, {
    ...current,
    pid: process.pid,
    heartbeatAt: now,
    ttlMs: ttlMs || current.ttlMs
  });
  return { ok: true, lease };
}

export function releaseLease({ memoryDir, owner = 'dsmp' } = {}) {
  const current = readLease(memoryDir);
  if (!current || current.owner !== owner) return { ok: false, reason: 'not-owner', lease: current };
  const file = leaseFilePath(memoryDir);
  try {
    fs.unlinkSync(file);
  } catch {
    /* 已不存在也算释放 */
  }
  return { ok: true, released: true };
}

/** 给 /status 与设置页看的摘要。 */
export function leaseSummary(memoryDir, { owner = 'dsmp', now = Date.now() } = {}) {
  const lease = readLease(memoryDir);
  const live = leaseLive(lease, now);
  return {
    file: leaseFilePath(memoryDir),
    present: Boolean(lease),
    owner: lease?.owner || '',
    live,
    mine: Boolean(lease && lease.owner === owner && live),
    ageMs: lease ? leaseAge(lease, now) : null,
    ttlMs: lease?.ttlMs || DEFAULT_TTL_MS,
    heartbeatAt: lease?.heartbeatAt || 0,
    startedAt: lease?.startedAt || 0,
    pid: lease?.pid || 0
  };
}
