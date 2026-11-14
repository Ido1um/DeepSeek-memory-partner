// 记忆冲突队列（<PERSONA> vs 抽取器）
//
// 背景：她自己在聊天里写的事实（author:'self'）优先级最高；抽取器只做补充。
// 当两边对同一个「主题 + 槽位」给出不同值时，谁都不改库，而是写一条 pending
// 冲突，等主人裁决——「保留她的 / 采用补充 / 合并成一条 / 暂不处理」。
//
// 存储：<dir>/state/disputes.jsonl，事件式追加（conflict / resolve），按 id 折叠。
// 只有 pending 会进面板；裁决记录永久保留，可审计。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as lt from './longterm.mjs';

export const DISPUTES_FILE = 'disputes.jsonl';
export const MAX_PENDING = 50;

export function disputesFile(dir) {
  return path.join(dir, 'state', DISPUTES_FILE);
}

function readRaw(dir) {
  try {
    return fs
      .readFileSync(disputesFile(dir), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function append(dir, row) {
  const file = disputesFile(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
  return row;
}

function norm(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s，。！？、,.!?；;：:"'“”‘’()（）\-—_/]/g, '');
}

export function newDisputeId(now = Date.now()) {
  return `d-${new Date(now).toISOString().slice(0, 10).replace(/-/g, '')}-${crypto
    .randomBytes(4)
    .toString('hex')}`;
}

/** 折叠事件：同 id 的 resolve 覆盖 conflict 的 status。 */
export function foldDisputes(rows = []) {
  const map = new Map();
  for (const row of rows) {
    if (!row || !row.id) continue;
    if (row.ev === 'conflict') {
      if (!map.has(row.id)) map.set(row.id, { ...row, status: row.status || 'pending' });
      continue;
    }
    if (row.ev === 'resolve') {
      const cur = map.get(row.id);
      if (!cur) continue;
      cur.status = row.status || 'resolved';
      cur.action = row.action || '';
      cur.resolvedAt = row.at || 0;
      cur.resolvedBy = row.by || '';
      cur.resolution = row.value ?? cur.resolution ?? '';
      if (row.note) cur.note = row.note;
    }
  }
  return [...map.values()];
}

export function listDisputes(dir, { status = 'pending', limit = 50 } = {}) {
  const all = foldDisputes(readRaw(dir));
  const filtered = status === 'all' ? all : all.filter((d) => d.status === status);
  return filtered
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, Math.max(1, limit));
}

export function pendingCount(dir) {
  return foldDisputes(readRaw(dir)).filter((d) => d.status === 'pending').length;
}

/**
 * 记录一条「她写的」与「抽取器想写的」冲突。同一个 selfFactId + 同一个值只记一次。
 * @returns {object|null} 新写入的行；重复/无效返回 null
 */
export function recordConflict(dir, { entry = {}, selfFact = {}, source = null, day = '' } = {}) {
  const selfFactId = String(selfFact.id || '');
  const topicId = String(entry.topicId || selfFact.topicId || '');
  const slot = String(entry.slot || selfFact.slot || '');
  const value = String(entry.value || '').trim();
  const selfValue = String(selfFact.value || '').trim();
  if (!selfFactId || !topicId || !slot || !value) return null;
  if (!selfValue || norm(selfValue) === norm(value)) return null;

  const existed = foldDisputes(readRaw(dir)).some(
    (d) => d.status === 'pending' && d.selfFactId === selfFactId && norm(d.value) === norm(value)
  );
  if (existed) return null;

  const now = Date.now();
  const row = {
    ev: 'conflict',
    id: newDisputeId(now),
    topicId,
    slot,
    about: selfFact.about === 'bot' ? 'bot' : 'user',
    selfFactId,
    selfValue,
    selfAt: Number(selfFact.at) || 0,
    value,
    quote: String(entry.quote || '').slice(0, 200),
    source: source || entry.source || null,
    day: String(day || ''),
    status: 'pending',
    createdAt: now
  };
  return append(dir, row);
}

/**
 * 裁决一条冲突。
 * action: keep_self | use_extract | merge | dismiss
 * @returns {{ok:boolean, error?:string, dispute?:object, fact?:object}}
 */
export function resolveDispute(dir, { id = '', action = '', value = '', by = 'owner', note = '' } = {}) {
  const rows = readRaw(dir);
  const found = foldDisputes(rows).find((d) => d.id === id);
  if (!found) return { ok: false, error: '没有这条冲突' };
  if (found.status !== 'pending') return { ok: false, error: '这条冲突已经处理过了' };

  const map = { keep_self: 'resolved_self', use_extract: 'resolved_extract', merge: 'resolved_merge', dismiss: 'dismissed' };
  const status = map[action];
  if (!status) return { ok: false, error: 'action 必须是 keep_self / use_extract / merge / dismiss' };

  let fact = null;
  if (action === 'use_extract' || action === 'merge') {
    const target = action === 'merge' ? String(value || '').trim() : String(found.value || '').trim();
    if (!target) return { ok: false, error: '合并需要一个非空的值' };
    const now = Date.now();
    fact = lt.appendEvent(
      {
        ev: 'supersede',
        id: found.selfFactId,
        value: target,
        quote: `主人裁决（${found.id}）`,
        author: 'correction',
        reason: action === 'merge' ? 'dispute-merge' : 'dispute-use-extract',
        by: String(by || 'owner'),
        at: now
      },
      dir
    );
  }

  const at = Date.now();
  append(dir, {
    ev: 'resolve',
    id: found.id,
    action,
    status,
    value: action === 'merge' ? String(value || '').trim() : action === 'use_extract' ? found.value : '',
    by: String(by || 'owner'),
    note: String(note || '').slice(0, 200),
    at
  });

  return { ok: true, dispute: { ...found, status, action, resolvedAt: at }, fact };
}
