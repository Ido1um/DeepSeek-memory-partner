/**
 * Workbench write path (M9).
 *
 * The old 7351 workbench could edit facts, confirm correction candidates and
 * flip the activation switches. It lived outside the plugin and is retired, so
 * those operations now live here — same semantics, but behind one guard:
 *
 *   - only the memory directory this plugin is configured for
 *   - only when this plugin currently owns the writer lease
 *   - every mutation backs the target file up first
 *
 * Reads stay in lib/workbench/state.js; this file never exposes a read API.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let VENDOR_SRC = '';
const CACHE = new Map();

export function configureWorkbenchWrite({ vendorDir } = {}) {
  VENDOR_SRC = String(vendorDir || '');
}

function vendorUrl(name) {
  const rel = `../vendor/memory/src/${name}`;
  return VENDOR_SRC ? pathToFileURL(path.join(VENDOR_SRC, name)) : new URL(rel, import.meta.url);
}

async function vendor(name) {
  if (CACHE.has(name)) return CACHE.get(name);
  const mod = await import(vendorUrl(name).href);
  CACHE.set(name, mod);
  return mod;
}

export const ACTIVATION_KEYS = [
  'enabled',
  'emit',
  'rankInInject',
  'recordRetrieved',
  'toneResidue',
  'toneSummary',
  'matchTokens',
];

const TIER_HALF_LIFE = { long: 30, general: 3, temp: 1.5 };
const FACT_OPS = ['invalidate', 'reinstate', 'manual', 'reset', 'unmerge', 'feel'];

export function auditFile(dir) {
  return path.join(dir, 'logs', 'dsmp-workbench-audit.jsonl');
}

export function writeError(message, code = 'DSMP_WRITE_BAD_INPUT') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

function backup(file) {
  if (!fs.existsSync(file)) return '';
  // state files sit one level below the memory root; activation.json sits at it.
  const parent = path.dirname(file);
  const root = path.basename(parent) === 'state' ? path.dirname(parent) : parent;
  const dir = path.join(root, 'backup');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${path.basename(file)}.bak-dsmp-${stamp()}`);
  fs.copyFileSync(file, target);
  return target;
}

export function appendAudit(dir, row) {
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.appendFileSync(auditFile(dir), JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n', 'utf8');
}

/**
 * The single write gate. Throws a DSMP_* coded error the route layer maps to a
 * status code; never partially applies anything.
 */
export function guardWrite({ dir, leaseOk, migrating = false }) {
  if (!dir) throw writeError('记忆目录未配置', 'DSMP_WRITE_NO_DIR');
  if (migrating) throw writeError('迁移进行中，暂不允许改写记忆', 'DSMP_WRITE_MIGRATING');
  if (leaseOk === false) throw writeError('当前不是记忆写者（租约不在本插件），只允许只读', 'DSMP_NOT_WRITER');
  if (!fs.existsSync(path.join(dir, 'state'))) throw writeError(`记忆目录不可用：${dir}`, 'DSMP_WRITE_NO_DIR');
}

/* ---------------- claims: confirm / reject ---------------- */

export async function claimsOp(dir, body = {}) {
  const claims = await vendor('claims.mjs');
  const id = String(body.id || '').trim();
  if (!id) throw writeError('缺少候选 id', 'DSMP_WRITE_BAD_INPUT');
  const isReject = body.decision === 'reject' || body.action === 'reject';
  const result = isReject
    ? claims.rejectClaim(dir, id, { reason: String(body.reason || '面板驳回') })
    : claims.confirmClaim(dir, id, {
      topicId: body.topicId,
      slot: body.slot,
      program: body.program,
      subjects: Array.isArray(body.subjects) ? body.subjects : undefined,
      value: body.value,
      by: 'owner',
    });
  appendAudit(dir, { op: 'claims', action: isReject ? 'reject' : 'confirm', id, ok: !!result?.ok, by: 'panel' });
  return result;
}

/* ---------------- facts: revise ---------------- */

export async function factEdit(dir, body = {}) {
  const revise = await vendor('revise.mjs');
  const id = String(body.id || '').trim();
  if (!id) throw writeError('id 不能为空', 'DSMP_WRITE_BAD_INPUT');
  backup(path.join(dir, 'state', 'longterm.jsonl'));
  const r = revise.reviseFact(dir, id, {
    value: body.value,
    text: body.text,
    validUntil: body.validUntil,
    reason: body.reason,
  }, { by: 'owner', role: 'owner' });
  if (!r?.ok) throw writeError(String(r?.reason || '这条改不了'), r?.code === 'not-found' ? 'DSMP_WRITE_NOT_FOUND' : 'DSMP_WRITE_BAD_INPUT');
  appendAudit(dir, { op: 'fact-edit', id, action: r.action, by: 'panel' });
  return r;
}

/* ---------------- facts: invalidate / reinstate / manual / reset / unmerge / feel ---------------- */

export async function factOp(dir, body = {}) {
  const longterm = await vendor('longterm.mjs');
  const id = String(body.id || '').trim();
  const op = String(body.op || '').trim();
  if (!id) throw writeError('缺少 id', 'DSMP_WRITE_BAD_INPUT');
  if (!FACT_OPS.includes(op)) throw writeError(`op 只能是 ${FACT_OPS.join('/')}`, 'DSMP_WRITE_BAD_INPUT');

  const eventsFile = path.join(dir, 'state', 'longterm.jsonl');
  const invalidatedFile = path.join(dir, 'state', 'facts-invalidated.json');
  const now = Date.now();
  const at = now;

  const known = longterm.materialize(longterm.readEvents(dir).rows, longterm.readInvalidated(dir));
  if (!known.some((f) => f.id === id)) throw writeError(`没有这条事实：${id}`, 'DSMP_WRITE_NOT_FOUND');

  const finish = (extra = {}) => {
    appendAudit(dir, { op, id, by: 'panel', ...extra });
    return { ok: true, id, op, at, ...extra };
  };

  if (op === 'feel') {
    const feel = String(body.feel || '').trim().slice(0, 40);
    if (!feel) throw writeError('feel 不能为空', 'DSMP_WRITE_BAD_INPUT');
    backup(eventsFile);
    fs.appendFileSync(eventsFile, JSON.stringify({ ev: 'feel', id, fact: id, feel, by: 'panel', derived: false, at }) + '\n', 'utf8');
    return finish({ feel });
  }

  if (op === 'unmerge') {
    const src = known.find((f) => f.id === id);
    if (!src?.mergedInto) throw writeError(`这条没有被合并（status=${src?.status || 'unknown'}）`, 'DSMP_WRITE_BAD_INPUT');
    backup(eventsFile);
    fs.appendFileSync(eventsFile, JSON.stringify({ ev: 'unmerge', id, at, by: 'panel', reason: String(body.reason || '') }) + '\n', 'utf8');
    return finish({ from: src.mergedInto });
  }

  if (op === 'manual') {
    const tier = String(body.tier || '');
    if (!['hard', 'long', 'general', 'temp'].includes(tier)) throw writeError('档位只能是 hard/long/general/temp', 'DSMP_WRITE_BAD_INPUT');
    const score = Number(body.score);
    if (!Number.isFinite(score) || score < 1 || score > 100) throw writeError('分数要在 1-100 之间', 'DSMP_WRITE_BAD_INPUT');
    const ev = { ev: 'manual', id, tier, score: Math.round(score), at, by: 'panel' };
    if (tier !== 'hard') ev.s = TIER_HALF_LIFE[tier];
    backup(eventsFile);
    fs.appendFileSync(eventsFile, JSON.stringify(ev) + '\n', 'utf8');
    return finish({ tier, score: ev.score });
  }

  if (op === 'reset') {
    backup(eventsFile);
    fs.appendFileSync(eventsFile, JSON.stringify({ ev: 'manualReset', id, at, by: 'panel' }) + '\n', 'utf8');
    return finish();
  }

  // invalidate / reinstate live in the tombstone map, not in the event log.
  backup(invalidatedFile);
  const map = readJson(invalidatedFile, {});
  if (op === 'invalidate') map[id] = { at, by: 'panel', reason: String(body.reason || '') };
  else delete map[id];
  writeJson(invalidatedFile, map);
  return finish({ reason: String(body.reason || '') });
}

/* ---------------- activation switches ---------------- */

export async function activationGet(dir) {
  const v10 = await vendor('v10.mjs');
  const cfg = v10.loadV10(dir) || {};
  const out = {};
  for (const key of ACTIVATION_KEYS) out[key] = key === 'salienceFloor' ? Number(cfg[key]) || 0 : Boolean(cfg[key]);
  out.salienceFloor = Number(cfg.salienceFloor) || 0;
  return { ok: true, file: v10.activationPath(dir), config: out };
}

export async function activationOp(dir, body = {}) {
  const v10 = await vendor('v10.mjs');
  const file = v10.activationPath(dir);
  const cur = v10.loadV10(dir) || {};
  const next = { ...cur };
  for (const key of [...ACTIVATION_KEYS, 'salienceFloor']) {
    if (!(key in body)) continue;
    next[key] = key === 'salienceFloor'
      ? Math.max(0, Math.min(100, Number(body[key]) || 0))
      : Boolean(body[key]);
  }
  const normalized = v10.normalizeV10(next);
  backup(file);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  // v10 keeps a parsed-config cache keyed by mtime; two writes inside the same
  // millisecond would otherwise keep returning the previous config.
  if (typeof v10.invalidateV10 === 'function') v10.invalidateV10(dir);
  appendAudit(dir, { op: 'activation', keys: Object.keys(body).filter((k) => [...ACTIVATION_KEYS, 'salienceFloor'].includes(k)), by: 'panel' });
  return { ok: true, savedAt: Date.now(), config: normalized };
}

/* ---------------- history ---------------- */

export async function factHistory(dir, id) {
  const revise = await vendor('revise.mjs');
  const sid = String(id || '').trim();
  if (!sid) throw writeError('缺少 id', 'DSMP_WRITE_BAD_INPUT');
  const items = (revise.readFactHistory(dir, sid) || []).slice();
  // longterm 事件流是事实的第一手修订记录。revise.readFactHistory 只覆盖
  // revise 自己写的日志，旧工作台 7351 读的是 longterm 事件，所以被抽取器
  // supersede / update 过的事实曾经在这里显示「0 条历史」。
  try {
    const longterm = await vendor('longterm.mjs');
    const KEEP = new Set([
      'fact', 'update', 'revise', 'supersede', 'merge', 'manual', 'manualReset',
      'unmerge', 'feel', 'invalidate', 'reinstate'
    ]);
    const events = (longterm.readEvents(dir) || {}).rows || [];
    const seen = new Set(items.map((row) => `${row.ev}|${row.at}|${row.id || row.fact || ''}`));
    for (const row of events) {
      if (!row || String(row.id || '') !== sid) continue;
      if (!KEEP.has(String(row.ev || ''))) continue;
      const key = `${row.ev}|${row.at}|${row.id || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        ev: row.ev,
        at: row.at,
        by: row.by || row.author || 'engine',
        reason: row.reason || '',
        value: row.value || '',
        tier: row.tier || '',
        source: 'longterm'
      });
    }
  } catch {
    /* longterm 读失败只丢这段历史，不让接口整体 500 */
  }
  // 面板侧写操作（invalidated 墓碑、调档、作废/恢复）只落审计日志，
  // longterm 事件里没有对应行，这里补回来。
  const auditPath = auditFile(dir);
  if (fs.existsSync(auditPath)) {
    for (const line of fs.readFileSync(auditPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (String(row.id || '') !== sid) continue;
      items.push({
        ev: row.op || 'audit',
        at: row.at,
        by: row.by || 'panel',
        reason: row.reason || '',
        value: row.tier || '',
        source: 'audit'
      });
    }
  }
  const msOf = (value) => {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return value;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  items.sort((a, b) => msOf(a.at) - msOf(b.at));
  return { ok: true, id: sid, count: items.length, items };
}

/* ---------------- tiny json helpers ---------------- */

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}
