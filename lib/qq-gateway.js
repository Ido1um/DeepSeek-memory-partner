// 网关抽象（沙箱验证版）：gateway.json 读写、契约自检、bridge 四值写入/回读/回滚。
// 设计目标：切换网关只改 bridge config.json 的 snowluma.*（路线 A，零改 bridge 代码）。
import fs from 'node:fs';
import path from 'node:path';

export const FORCED_KEYS = ['httpUrl', 'wsUrl', 'accessToken', 'homeDir', 'followDiscoveredEndpoint'];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
}
function writeJsonAtomic(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
function stripSlash(u) { return String(u || '').replace(/\/+$/, ''); }

export function gatewayPath(rootDir) {
  return path.join(rootDir, 'components', 'gateway.json');
}

export function readGateway(rootDir) {
  const file = gatewayPath(rootDir);
  if (!fs.existsSync(file)) return { ok: false, code: 'GATEWAY_NO_FILE', file };
  let gw;
  try { gw = readJson(file); } catch (error) { return { ok: false, code: 'GATEWAY_BAD_JSON', file, error: String(error.message) }; }
  if (!gw || gw.version !== 1) return { ok: false, code: 'GATEWAY_BAD_VERSION', file };
  if (!gw.profiles || typeof gw.profiles !== 'object') return { ok: false, code: 'GATEWAY_NO_PROFILES', file };
  if (!gw.active || !gw.profiles[gw.active]) return { ok: false, code: 'GATEWAY_BAD_ACTIVE', file, active: gw.active };
  return { ok: true, file, gateway: gw };
}

export function profileOf(gw, name) {
  const key = name || (gw && gw.active);
  const profile = gw && gw.profiles && gw.profiles[key];
  if (!profile) { const e = new Error(`网关 profile 不存在：${key}`); e.code = 'GATEWAY_NO_PROFILE'; throw e; }
  return { key, profile };
}

export function writeGateway(rootDir, gw, { backup = true } = {}) {
  const file = gatewayPath(rootDir);
  let backupPath = '';
  if (backup && fs.existsSync(file)) {
    backupPath = `${file}.bak-${stamp()}`;
    fs.copyFileSync(file, backupPath);
  }
  gw.lastSwitch = gw.lastSwitch || {};
  writeJsonAtomic(file, gw);
  return { ok: true, file, backupPath };
}

async function callOneBot(profile, action, params = {}, { token = '', timeoutMs = 5000 } = {}) {
  const url = `${stripSlash(profile.httpUrl)}/${action}`;
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params || {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* 非 JSON */ }
  return { action, http: res.status, ms: Date.now() - started, retcode: body?.retcode ?? null, status: body?.status ?? null, data: body?.data ?? null, raw: text.slice(0, 300) };
}

const REQUIRED = [
  { action: 'get_login_info', params: {}, why: '账号与在线' },
  { action: 'get_status', params: {}, why: '健康状态' },
  { action: 'get_group_list', params: {}, why: '群列表' },
  { action: 'get_msg', params: { message_id: 1 }, why: '单条消息', lenientNotFound: true },
  { action: 'get_group_msg_history', params: { group_id: 1, count: 1 }, why: '群历史' },
];
const OPTIONAL = [
  { action: 'get_version_info', params: {}, why: '版本' },
  { action: 'get_friend_list', params: {}, why: '好友列表' },
  { action: 'get_forward_msg', params: { id: '1' }, why: '合并转发' },
  { action: 'fetch_ptt_text', params: { message_id: 1 }, why: 'QQ 语音转写（可选）' },
  { action: 'get_record', params: { file: '', out_format: 'wav' }, why: '入站语音 wav（SnowLuma 扩展）' },
];

function verdictOf(r) {
  if (r.error) return 'error';
  if (r.http === 401 || r.http === 403) return 'auth';
  if (r.retcode !== 0) {
    // 契约探测用空 message_id（1）问 get_msg，真实网关必然回「消息不存在」。
    // 只要 HTTP 200 且是明确的 not found，说明动作存在、协议可用，算通过。
    if (r.lenientNotFound && r.http === 200
      && (r.retcode === 100 || /not\s*found|不存在|撤回/i.test(String(r.raw || '')))) return 'ok';
    return 'fail';
  }
  return 'ok';
}

export async function contract(profile, { token = '', timeoutMs = 5000 } = {}) {
  if (!profile || !profile.httpUrl) return { ok: false, code: 'GATEWAY_NO_HTTP', required: [], optional: [] };
  const required = [];
  for (const item of REQUIRED) {
    try { required.push({ ...item, ...(await callOneBot(profile, item.action, item.params, { token, timeoutMs })) }); }
    catch (error) { required.push({ ...item, error: String(error.message) }); }
  }
  const optional = [];
  for (const item of OPTIONAL) {
    try { optional.push({ ...item, ...(await callOneBot(profile, item.action, item.params, { token, timeoutMs })) }); }
    catch (error) { optional.push({ ...item, error: String(error.message) }); }
  }
  const normalize = (list) => list.map((r) => {
    const verdict = verdictOf(r);
    const note = verdict === 'ok' && r.retcode !== 0 ? '空 id 探测：消息不存在，端点本身可用' : '';
    return { ...r, verdict, ...(note ? { note } : {}) };
  });
  const req = normalize(required);
  const opt = normalize(optional);
  return {
    ok: req.every((r) => r.verdict === 'ok'),
    required: req,
    optional: opt,
    failedRequired: req.filter((r) => r.verdict !== 'ok').map((r) => r.action),
  };
}

export async function probe(profile, { token = '', timeoutMs = 5000 } = {}) {
  try {
    const info = await callOneBot(profile, 'get_login_info', {}, { token, timeoutMs });
    const st = await callOneBot(profile, 'get_status', {}, { token, timeoutMs });
    return {
      ok: info.retcode === 0,
      account: info.data?.user_id ?? null,
      nickname: info.data?.nickname ?? '',
      status: st.data ?? null,
      ms: info.ms,
    };
  } catch (error) {
    return { ok: false, error: String(error.message) };
  }
}

export function applyToBridgeConfig(bridgeConfigPath, profile, { token, dryRun = false, backupDir } = {}) {
  const cfg = readJson(bridgeConfigPath);
  const before = { ...(cfg.snowluma || {}) };
  const next = {
    ...before,
    httpUrl: stripSlash(profile.httpUrl),
    wsUrl: String(profile.wsUrl || '').replace(/\/+$/, ''),
    followDiscoveredEndpoint: false,
    homeDir: '',
  };
  if (token) next.accessToken = token;
  const changed = FORCED_KEYS.filter((k) => String(before[k] ?? '') !== String(next[k] ?? ''));
  if (dryRun) return { ok: true, dryRun: true, changed, before, after: next };
  let backupPath = '';
  if (backupDir) {
    fs.mkdirSync(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `config.json.bak-switch-${stamp()}`);
    fs.copyFileSync(bridgeConfigPath, backupPath);
  } else {
    backupPath = `${bridgeConfigPath}.bak-switch-${stamp()}`;
    fs.copyFileSync(bridgeConfigPath, backupPath);
  }
  cfg.snowluma = next;
  writeJsonAtomic(bridgeConfigPath, cfg);
  return { ok: true, dryRun: false, changed, before, after: next, backupPath };
}

export function verifyBridgeConfig(bridgeConfigPath, profile, { token } = {}) {
  const cfg = readJson(bridgeConfigPath);
  const cur = cfg.snowluma || {};
  const expect = {
    httpUrl: stripSlash(profile.httpUrl),
    wsUrl: String(profile.wsUrl || '').replace(/\/+$/, ''),
    followDiscoveredEndpoint: false,
    homeDir: '',
    ...(token ? { accessToken: token } : {}),
  };
  const mismatches = [];
  for (const [k, v] of Object.entries(expect)) {
    if (String(cur[k] ?? '') !== String(v)) mismatches.push({ key: k, expected: v, actual: cur[k] ?? null });
  }
  return { ok: mismatches.length === 0, mismatches, actual: cur };
}

export function restoreBridgeConfig(bridgeConfigPath, backupPath) {
  if (!backupPath || !fs.existsSync(backupPath)) return { ok: false, code: 'NO_BACKUP' };
  fs.copyFileSync(backupPath, bridgeConfigPath);
  return { ok: true, restoredFrom: backupPath };
}

export function recordSwitch(rootDir, { from, to, result, note = '' }) {
  const r = readGateway(rootDir);
  if (!r.ok) return r;
  r.gateway.active = to;
  r.gateway.lastSwitch = { at: new Date().toISOString(), from, to, result, note };
  writeGateway(rootDir, r.gateway, { backup: true });
  return { ok: true, active: to, lastSwitch: r.gateway.lastSwitch };
}
