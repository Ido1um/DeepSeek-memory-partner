// qq-write.js - guarded write operations for the QQ channel tab.
//
// Every op maps to one bridge endpoint and is validated here before the call:
//  - mode / role / role-mode / security / whitelist / socialV2 / test-send / restart
//  - test-send and restart need an explicit confirmText (the panel sends it only
//    after a second click)
//  - every accepted attempt is appended to <DSH_HOME>/dsmp/logs/qq-audit.jsonl
//
// The module never imports qq-proxy directly (dev hot-reload uses data: URLs);
// the caller passes `request` and `auditFile`.
import fs from 'node:fs';
import path from 'node:path';

const MAX = { list: 200, role: 64, mode: 32, message: 500, patchBytes: 8192 };

function bad(code, error) {
  return { ok: false, code, error };
}

function numList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const v of value) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out.push(Math.trunc(n));
    if (out.length >= MAX.list) break;
  }
  return [...new Set(out)];
}

function audit(auditFile, row) {
  if (!auditFile) return;
  try {
    fs.mkdirSync(path.dirname(auditFile), { recursive: true });
    fs.appendFileSync(auditFile, `${JSON.stringify(row)}\n`, 'utf8');
  } catch { /* audit must never break the action */ }
}

function summarize(body) {
  const out = { op: body.op };
  for (const k of ['mode', 'role', 'kind', 'id', 'confirmText']) {
    if (body[k] !== undefined) out[k] = String(body[k]).slice(0, 120);
  }
  if (body.message !== undefined) out.messageChars = String(body.message).length;
  if (body.allow) out.private = (body.allow.private || []).length;
  if (body.groups) out.groups = (body.groups || []).length;
  return out;
}

function validateWhitelist(body) {
  const allow = body.allow && typeof body.allow === 'object' ? body.allow : {};
  const deny = body.deny && typeof body.deny === 'object' ? body.deny : {};
  const ownerQQ = body.ownerQQ === undefined || body.ownerQQ === null || body.ownerQQ === ''
    ? undefined
    : Number(body.ownerQQ);
  if (ownerQQ !== undefined && (!Number.isFinite(ownerQQ) || ownerQQ <= 0)) {
    return bad('BAD_OWNER', 'ownerQQ 必须是正整数');
  }
  return {
    ok: true,
    payload: {
      allow: { private: numList(allow.private), groups: numList(allow.groups) },
      deny: { private: numList(deny.private), groups: numList(deny.groups) },
      ...(ownerQQ === undefined ? {} : { ownerQQ })
    }
  };
}

function validateSocialV2(body) {
  const patch = body.patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return bad('BAD_PATCH', 'patch 必须是对象');
  }
  const raw = JSON.stringify(patch);
  if (raw.length > MAX.patchBytes) return bad('PATCH_TOO_BIG', `patch 超过 ${MAX.patchBytes} 字节`);
  const out = {};
  if (typeof patch.enabled === 'boolean') out.enabled = patch.enabled;
  if (patch.tools && typeof patch.tools === 'object' && !Array.isArray(patch.tools)) {
    const tools = {};
    for (const [k, v] of Object.entries(patch.tools)) {
      if (typeof v === 'boolean') tools[k] = v;
    }
    if (Object.keys(tools).length) out.tools = tools;
  }
  for (const group of ['wake', 'send', 'wait']) {
    if (patch[group] && typeof patch[group] === 'object' && !Array.isArray(patch[group])) {
      out[group] = patch[group];
    }
  }
  if (!Object.keys(out).length) return bad('EMPTY_PATCH', 'patch 里没有可应用的字段');
  return { ok: true, payload: out };
}

/**
 * Apply one QQ channel write.
 *
 * @param {{settings:object, body:object, request:Function, auditFile:string}} args
 */
export async function apply({ settings, body, request, auditFile }) {
  if (!request) return bad('NO_REQUEST', '缺少桥接请求器');
  const op = String(body?.op || '');
  const at = new Date().toISOString();

  const done = (result, payload) => {
    audit(auditFile, { at, op, ok: result.ok !== false, code: result.code || '', ...summarize(body), payload });
    return { ...result, op, audit: !!auditFile };
  };

  if (op === 'mode') {
    const mode = String(body.mode || '').trim();
    if (!mode || mode.length > MAX.mode) return done(bad('BAD_MODE', 'mode 不能为空且不超过 32 字'), {});
    const payload = { mode };
    if (body.closedAgentPreset !== undefined) payload.closedAgentPreset = String(body.closedAgentPreset || '').slice(0, MAX.role);
    const r = await request(settings, '/api/mode', { method: 'POST', body: payload });
    return done(r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code, error: r.error }, payload);
  }

  if (op === 'role') {
    const role = body.role === null ? null : String(body.role || '').trim();
    if (role !== null && (!role || role.length > MAX.role)) return done(bad('BAD_ROLE', '角色名不能为空且不超过 64 字'), {});
    const r = await request(settings, '/api/role', { method: 'POST', body: { role } });
    return done(r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code, error: r.error }, { role });
  }

  if (op === 'role-mode') {
    const mode = String(body.mode || '');
    if (!['silent', 'active'].includes(mode)) return done(bad('BAD_ROLE_MODE', 'role-mode 只能是 silent 或 active'), {});
    const r = await request(settings, '/api/role-mode', { method: 'POST', body: { mode } });
    return done(r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code, error: r.error }, { mode });
  }

  if (op === 'security') {
    const payload = {};
    if (typeof body.interceptNotify === 'boolean') payload.interceptNotify = body.interceptNotify;
    if (body.rehardenStateDir === true) payload.rehardenStateDir = true;
    if (!Object.keys(payload).length) return done(bad('BAD_SECURITY', '没有可应用的安全字段'), {});
    const r = await request(settings, '/api/security', { method: 'POST', body: payload });
    return done(r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code, error: r.error }, payload);
  }

  if (op === 'whitelist') {
    const v = validateWhitelist(body);
    if (!v.ok) return done(v, {});
    const r = await request(settings, '/api/whitelist', { method: 'POST', body: v.payload });
    return done(r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code, error: r.error }, v.payload);
  }

  if (op === 'socialV2') {
    const v = validateSocialV2(body);
    if (!v.ok) return done(v, {});
    const r = await request(settings, '/api/socialV2/config', { method: 'POST', body: v.payload });
    return done(r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code, error: r.error }, v.payload);
  }

  if (op === 'test-send') {
    const kind = body.kind === 'private' ? 'private' : 'group';
    const id = Number(body.id);
    const message = String(body.message || '').trim();
    if (!Number.isFinite(id) || id <= 0) return done(bad('BAD_TARGET', '目标 id 无效'), {});
    if (!message) return done(bad('BAD_MESSAGE', '消息不能为空'), {});
    if (message.length > MAX.message) return done(bad('MESSAGE_TOO_LONG', '消息超过 500 字'), {});
    if (String(body.confirmText || '') !== '确认发送') {
      return done(bad('CONFIRM_REQUIRED', '测试发送需要二次确认（confirmText=确认发送）'), {});
    }
    const r = await request(settings, '/api/test-send', { method: 'POST', body: { kind, id, message } });
    return done(r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code, error: r.error }, { kind, id });
  }

  if (op === 'restart') {
    if (String(body.confirmText || '') !== '确认重启') {
      return done(bad('CONFIRM_REQUIRED', '重启桥接需要二次确认（confirmText=确认重启）'), {});
    }
    const r = await request(settings, '/api/restart', { method: 'POST', body: {} });
    return done(r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code, error: r.error }, {});
  }

  return done(bad('UNKNOWN_OP', `未知写操作：${op || '(空)'}`), {});
}

export const QQ_WRITE_OPS = ['mode', 'role', 'role-mode', 'security', 'whitelist', 'socialV2', 'test-send', 'restart'];
