// QQ channel read proxy: turns the bridge's console API into compact shapes
// for the DSMP "QQ 通道" tab. Read-only; writes stay on the existing
// /api/dsmp/qq/channel + bridge endpoints until the write layer lands.
//
// Auth is `x-console-token` (not Bearer); the token file is re-read per request
// so a rotated token takes effect without restarting the plugin.
import fs from 'node:fs';

const DEFAULT_TIMEOUT = 6000;

function baseOf(settings) {
  return String(settings?.bridge?.baseUrl || '').replace(/\/+$/, '');
}

function tokenFileOf(settings) {
  return String(settings?.bridge?.tokenFile || '');
}

export function readBridgeToken(settings) {
  try {
    return fs.readFileSync(tokenFileOf(settings), 'utf8').trim();
  } catch {
    return '';
  }
}

export async function bridgeRequest(settings, pathname, { method = 'GET', body, timeout = DEFAULT_TIMEOUT } = {}) {
  const token = readBridgeToken(settings);
  if (!token) return { ok: false, code: 'NO_TOKEN', error: `找不到桥接令牌：${tokenFileOf(settings)}` };
  const base = baseOf(settings);
  if (!base) return { ok: false, code: 'NO_BASE', error: '未配置 bridge.baseUrl' };
  const headers = { 'x-console-token': token };
  if (body !== undefined) headers['content-type'] = 'application/json';
  try {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout)
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 800) }; }
    if (!res.ok) {
      return { ok: false, code: `HTTP_${res.status}`, status: res.status, error: (data && data.error) || `HTTP ${res.status}`, data };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    const code = err?.name === 'TimeoutError' ? 'TIMEOUT' : 'UNREACHABLE';
    return { ok: false, code, error: String(err?.message || err) };
  }
}

function failed(r, extra = {}) {
  return { ok: false, code: r.code || 'BRIDGE_ERROR', error: r.error || '桥接请求失败', ...extra };
}

function activityTail(status) {
  const a = status?.activity;
  if (Array.isArray(a)) return a.slice(-20);
  if (typeof a === 'string') return a.split('\n').filter(Boolean).slice(-20);
  return [];
}

export async function overview(settings) {
  const [status, wl] = await Promise.all([
    bridgeRequest(settings, '/api/status'),
    bridgeRequest(settings, '/api/whitelist')
  ]);
  if (!status.ok) return failed(status, { section: 'overview' });
  const d = status.data || {};
  const snow = d.snowluma || {};
  const allow = wl.ok ? wl.data?.allow || {} : {};
  return {
    ok: true,
    mode: d.mode || '',
    closedAgentPreset: d.closedAgentPreset || '',
    role: d.role || '',
    roleMode: d.roleMode || '',
    dshReady: d.dshReady === true,
    paused: d.socialV2Paused === true,
    ownerQQ: d.ownerQQ ?? null,
    snowluma: {
      connected: snow.connected === true,
      accountOnline: snow.accountOnline === true,
      online: snow.connected === true && snow.accountOnline === true
    },
    allowPrivate: Array.isArray(d.allowPrivate) ? d.allowPrivate : (allow.private || []),
    allowGroups: Array.isArray(d.allowGroups) ? d.allowGroups : (allow.groups || []),
    activity: activityTail(d),
    baseUrl: baseOf(settings)
  };
}

export async function persona(settings) {
  const roles = await bridgeRequest(settings, '/api/roles');
  if (!roles.ok) return failed(roles, { section: 'persona' });
  const d = roles.data || {};
  const current = String(d.current || '');
  let detail = null;
  if (current) {
    const q = new URLSearchParams({ name: current });
    const c = await bridgeRequest(settings, `/api/roles/content?${q}`);
    if (c.ok) {
      const cd = c.data || {};
      detail = {
        name: cd.name || current,
        chars: Number(cd.chars || 0) || String(cd.content || '').length,
        preview: String(cd.content || '').slice(0, 400),
        warnings: Array.isArray(cd.warnings) ? cd.warnings : []
      };
    }
  }
  return {
    ok: true,
    current,
    limits: d.limits || {},
    roles: (Array.isArray(d.roles) ? d.roles : []).map((name) => String(name)),
    detail
  };
}

function pick(obj, keys) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export async function sim(settings) {
  const cfg = await bridgeRequest(settings, '/api/socialV2/config');
  if (!cfg.ok) return failed(cfg, { section: 'sim' });
  const c = cfg.data?.config || {};
  const tools = c.tools && typeof c.tools === 'object' ? c.tools : {};
  const toolNames = Object.keys(tools);
  return {
    ok: true,
    enabled: c.enabled === true,
    agentPreset: c.agentPreset || '',
    provideRecommendations: c.provideRecommendations === true,
    initialPromptMaxChars: Number(c.initialPromptMaxChars || 0) || 0,
    tools: {
      total: toolNames.length,
      enabledCount: toolNames.filter((k) => tools[k] === true).length,
      disabled: toolNames.filter((k) => tools[k] !== true)
    },
    wake: pick(c.wake, ['mode', 'anyMessage', 'question', 'atMention', 'nameMention', 'poke', 'probability', 'batchWindowMs', 'maxWakePerMinute', 'maxWakePerHour']),
    send: pick(c.send, ['mode', 'gapMode', 'gapMs', 'maxChars', 'splitLong']),
    wait: pick(c.wait, ['timeoutMs', 'quietMs', 'pollMs']),
    context: pick(c.context, ['maxMessages', 'maxChars', 'maxTokens']),
    media: pick(c.media, ['enabled', 'maxBytes', 'maxPixels', 'maxModelBytes']),
    voice: pick(c.voice, ['enabled', 'maxSeconds', 'maxBytes']),
    tts: pick(c.tts, ['enabled', 'apiUrl', 'speed']),
    raw: { sticker: c.sticker || null, proactive: c.proactive || null, feedback: c.feedback || null }
  };
}

export async function sessions(settings) {
  const [sess, states] = await Promise.all([
    bridgeRequest(settings, '/api/sessions'),
    bridgeRequest(settings, '/api/socialV2/states')
  ]);
  if (!sess.ok) return failed(sess, { section: 'sessions' });
  const rows = Array.isArray(sess.data?.sessions) ? sess.data.sessions : [];
  const byKey = new Map();
  if (states.ok && Array.isArray(states.data?.conversations)) {
    for (const c of states.data.conversations) byKey.set(String(c.key || ''), c);
  }
  const merged = rows.map((r) => {
    const key = String(r.key || '');
    const st = byKey.get(key) || {};
    const wc = st.wakeConfig || {};
    return {
      key,
      sessionId: String(r.sessionId || ''),
      owner: r.owner === true,
      wakeMode: wc.mode || '',
      infinite: wc.infinite === true,
      unread: Number(st.unreadCount || 0) || 0,
      recent: Number(st.recentCount || 0) || 0,
      lastWakeReason: st.lastWakeReason || '',
      lastWakeAt: Number(st.lastWakeAt || 0) || null,
      lastAiReplyAt: Number(st.lastAiReplyAt || 0) || null,
      wakeCount: Number(wc.wakeCount || 0) || 0,
      triggers: wc.triggers || null
    };
  });
  const extra = [...byKey.keys()].filter((k) => !rows.some((r) => String(r.key) === k));
  return { ok: true, count: merged.length, rows: merged, orphanKeys: extra };
}

export async function slang(settings) {
  const r = await bridgeRequest(settings, '/api/slang');
  if (!r.ok) return failed(r, { section: 'slang' });
  const d = r.data || {};
  const entries = (Array.isArray(d.entries) ? d.entries : []).slice(0, 200).map((e) => ({
    id: e.id || '',
    content: String(e.content || ''),
    meaning: String(e.meaning || ''),
    usage: String(e.usage || ''),
    status: String(e.status || ''),
    count: Number(e.count || 0) || 0
  }));
  return { ok: true, writable: d.writable === true, config: d.config || {}, count: entries.length, entries };
}

export async function access(settings) {
  const [wl, sec] = await Promise.all([
    bridgeRequest(settings, '/api/whitelist'),
    bridgeRequest(settings, '/api/security')
  ]);
  if (!wl.ok && !sec.ok) return failed(wl, { section: 'access' });
  const allow = wl.ok ? wl.data?.allow || {} : {};
  const deny = wl.ok ? wl.data?.deny || {} : {};
  const s = sec.ok ? sec.data || {} : {};
  return {
    ok: true,
    allow: {
      private: Array.isArray(allow.private) ? allow.private : [],
      groups: Array.isArray(allow.groups) ? allow.groups : []
    },
    deny: {
      private: Array.isArray(deny.private) ? deny.private : [],
      groups: Array.isArray(deny.groups) ? deny.groups : []
    },
    ownerQQ: wl.ok ? (wl.data?.ownerQQ ?? null) : null,
    security: s.security || {},
    stateDir: s.stateDir ? { hardened: s.stateDir.hardened === true, path: s.stateDir.path || '' } : null
  };
}

export async function usage(settings, query = '') {
  const qs = String(query || '').replace(/^\?/, '');
  const r = await bridgeRequest(settings, `/api/tokens/summary${qs ? `?${qs}` : ''}`);
  if (!r.ok) return failed(r, { section: 'usage' });
  const d = r.data || {};
  const conversations = Array.isArray(d.conversations) ? d.conversations : [];
  return {
    ok: true,
    generatedAt: d.generatedAt || '',
    priceVersion: d.priceVersion || '',
    currency: d.currency || 'CNY',
    symbol: d.symbol || '¥',
    nowTier: d.nowTier || '',
    totals: d.totals || {},
    conversations: conversations.map((c) => ({
      key: String(c.key || ''),
      sessions: Number(c.sessions || 0) || 0,
      turns: Number(c.turns || 0) || 0,
      cost: Number(c.cost || 0) || 0,
      totalTokens: Number(c.buckets ? (c.buckets.cacheMiss || 0) + (c.buckets.cacheHit || 0) + (c.buckets.output || 0) : 0) || 0,
      lastAt: Number(c.lastAt || 0) || null,
      models: Array.isArray(c.models) ? c.models : []
    }))
  };
}

export async function ops(settings) {
  const [status, states] = await Promise.all([
    bridgeRequest(settings, '/api/status'),
    bridgeRequest(settings, '/api/socialV2/states')
  ]);
  if (!status.ok) return failed(status, { section: 'ops' });
  const d = status.data || {};
  return {
    ok: true,
    baseUrl: baseOf(settings),
    mode: d.mode || '',
    paused: d.socialV2Paused === true,
    dshReady: d.dshReady === true,
    snowluma: d.snowluma || {},
    activity: activityTail(d),
    conversationCount: states.ok && Array.isArray(states.data?.conversations) ? states.data.conversations.length : 0,
    tokenPresent: readBridgeToken(settings).length > 0
  };
}

/** Section dispatcher used by the GET route. */
export async function section(settings, name, query = '') {
  switch (String(name || '')) {
    case 'overview': return overview(settings);
    case 'persona': return persona(settings);
    case 'sim': return sim(settings);
    case 'sessions': return sessions(settings);
    case 'slang': return slang(settings);
    case 'access': return access(settings);
    case 'usage': return usage(settings, query);
    case 'ops': return ops(settings);
    default: return { ok: false, code: 'UNKNOWN_SECTION', error: `未知分区：${name || '(空)'}` };
  }
}

export const QQ_SECTIONS = ['overview', 'persona', 'sim', 'sessions', 'slang', 'access', 'usage', 'ops'];
