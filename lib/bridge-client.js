// Bridge client: the optional QQ channel.
//
// Everything here is deliberately narrow:
//   - reads are always allowed (status / recent / unread),
//   - writes are gated: during the test phase every outgoing message is a
//     dry run that lands in an outbox file instead of QQ,
//   - the console token never leaves this process (no echo in status/UI).
//
// Bridge auth is `x-console-token` (or `?token=`), NOT `Authorization: Bearer`.
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_TIMEOUT = 4000;

function normalizeBase(url) {
  return String(url || '').replace(/\/+$/, '');
}

function readToken(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    return raw || '';
  } catch {
    return '';
  }
}

function jsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

export class BridgeClient {
  constructor({ settings, outboxFile, logger } = {}) {
    this.settings = settings || {};
    this.outboxFile = outboxFile || '';
    this.logger = logger || (() => {});
  }

  get base() {
    return normalizeBase(this.settings?.bridge?.baseUrl);
  }

  get tokenFile() {
    return String(this.settings?.bridge?.tokenFile || '');
  }

  get testMode() {
    return this.settings?.test?.enabled !== false;
  }

  get allowLiveSend() {
    return this.settings?.test?.allowLiveSend === true;
  }

  hasToken() {
    return readToken(this.tokenFile).length > 0;
  }

  async request(pathname, { method = 'GET', body, timeout = DEFAULT_TIMEOUT } = {}) {
    const token = readToken(this.tokenFile);
    if (!token) {
      return { ok: false, code: 'NO_TOKEN', error: `找不到桥接令牌：${this.tokenFile}` };
    }
    const url = `${this.base}${pathname}`;
    const headers = { 'x-console-token': token };
    if (body !== undefined) headers['content-type'] = 'application/json';
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout)
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text.slice(0, 500) };
      }
      if (!res.ok) {
        return { ok: false, code: `HTTP_${res.status}`, status: res.status, error: (data && data.error) || `HTTP ${res.status}`, data };
      }
      return { ok: true, status: res.status, data };
    } catch (err) {
      const name = err?.name === 'TimeoutError' ? 'TIMEOUT' : 'UNREACHABLE';
      return { ok: false, code: name, error: String(err?.message || err) };
    }
  }

  // ---- reads -------------------------------------------------------------

  async status() {
    const r = await this.request('/api/status');
    if (!r.ok) return r;
    const d = r.data || {};
    const snow = d.snowluma || {};
    const accountOnline = snow.accountOnline === true;
    const snowConnected = snow.connected === true;
    return {
      ok: true,
      data: {
        mode: d.mode || '',
        role: d.role || '',
        roleMode: d.roleMode || '',
        dshReady: d.dshReady === true,
        ownerQQ: d.ownerQQ ?? null,
        allowPrivate: Array.isArray(d.allowPrivate) ? d.allowPrivate : [],
        allowGroups: Array.isArray(d.allowGroups) ? d.allowGroups : [],
        paused: d.socialV2Paused === true,
        snowluma: { connected: snowConnected, accountOnline },
        channel: snowConnected && accountOnline ? 'qq' : 'degraded'
      }
    };
  }

  async states() {
    const r = await this.request('/api/socialV2/states');
    if (!r.ok) return r;
    const list = Array.isArray(r.data?.conversations) ? r.data.conversations : [];
    return {
      ok: true,
      conversations: list.map((c) => ({
        key: String(c.key || ''),
        unread: Array.isArray(c.unread) ? c.unread.length : 0,
        recent: Array.isArray(c.recentMessages) ? c.recentMessages.length : 0,
        mode: c.wakeConfig?.mode || '',
        lastAt: Number(c.lastAt || 0) || null
      }))
    };
  }

  async recent(key, limit = 20) {
    const q = new URLSearchParams({ key: String(key || ''), limit: String(limit) });
    const r = await this.request(`/api/socialV2/recent?${q}`);
    if (!r.ok) return r;
    return { ok: true, key: r.data?.key || key, messages: Array.isArray(r.data?.messages) ? r.data.messages : [] };
  }

  async unread(key, limit = 30) {
    const q = new URLSearchParams({ key: String(key || ''), limit: String(limit) });
    const r = await this.request(`/api/socialV2/unread?${q}`);
    if (!r.ok) return r;
    return { ok: true, key: r.data?.key || key, unreadCount: Number(r.data?.unreadCount || 0), messages: Array.isArray(r.data?.messages) ? r.data.messages : [] };
  }

  /** Map of conversation key → DSH session, as the bridge currently sees it. */
  async sessions() {
    const r = await this.request('/api/sessions');
    if (!r.ok) return [];
    const rows = (r.data && r.data.sessions) || [];
    return Array.isArray(rows) ? rows : [];
  }

  // ---- writes (gated) ----------------------------------------------------

  /**
   * Send text to a conversation.
   *
   * In test mode (and unless `test.allowLiveSend` is explicitly true) this does
   * NOT touch QQ: the payload is appended to the outbox and returned with
   * `dryRun: true`. That is the whole point of the M2 rule — the plugin can be
   * exercised end to end without anything leaving the machine.
   */
  async sendMessage({ key, messages, replyToMessageId, gapMode } = {}) {
    const list = (Array.isArray(messages) ? messages : [messages]).map((m) => String(m ?? '').trim()).filter(Boolean);
    if (!key || !list.length) return { ok: false, code: 'BAD_INPUT', error: 'key 和 messages 不能为空' };
    const payload = { key, messages: list };
    if (replyToMessageId) payload.replyToMessageId = replyToMessageId;
    if (gapMode) payload.gapMode = gapMode;

    if (this.testMode && !this.allowLiveSend) {
      const record = { at: new Date().toISOString(), dryRun: true, ...payload };
      this.appendOutbox(record);
      return { ok: true, dryRun: true, queued: record, note: '测试期不发送到 QQ，已写入 outbox' };
    }

    const r = await this.request('/api/socialV2/send-message', { method: 'POST', body: payload });
    const record = { at: new Date().toISOString(), dryRun: false, ...payload, ok: r.ok, error: r.ok ? '' : r.error };
    this.appendOutbox(record);
    return r.ok ? { ok: true, dryRun: false, data: jsonSafe(r.data) } : r;
  }

  /**
   * Desktop-panel message: hand the text to the bridge so it drives the SAME
   * session the QQ channel uses. The bridge tags the prompt as panel-origin and
   * tells her not to call any QQ send tool, so nothing leaves for QQ.
   *
   * This is not the QQ send path — `settings.panel.liveSend` is its own switch,
   * independent of `test.allowLiveSend` (that one guards outbound QQ messages).
   */
  async panelMessage({ key, text } = {}) {
    const body = String(text ?? '').trim();
    if (!key || !body) return { ok: false, code: 'BAD_INPUT', error: 'key 和 text 不能为空' };
    const panel = this.settings && this.settings.panel;
    if (!panel || panel.liveSend !== true) {
      return { ok: false, code: 'DSMP_PANEL_OFF', error: '面板直发未开启（settings.panel.liveSend）' };
    }
    const r = await this.request('/api/socialV2/panel-message', {
      method: 'POST',
      body: { key, text: body },
      timeout: 60000
    });
    return r.ok ? { ok: true, via: 'bridge', key, data: jsonSafe(r.data) } : r;
  }

  /**
   * Send a voice message.
   *
   * Voice has no dry-run flag on the bridge side worth trusting as "never
   * sends", so we keep the same rule as text: while testing, nothing leaves the
   * machine. The caller records the queue entry; this method only runs when the
   * test gate has been opened on purpose.
   */
  async sendVoice({ key, voice, text, label } = {}) {
    if (!key) return { ok: false, code: 'BAD_INPUT', error: 'key 不能为空' };
    if (!voice && !text) return { ok: false, code: 'BAD_INPUT', error: 'voice 或 text 至少给一个' };
    if (this.testMode && !this.allowLiveSend) {
      return { ok: true, dryRun: true, note: '测试期不发送语音到 QQ', key, voice: voice || '', text: text || '' };
    }
    const body = voice ? { key, voice, label: label || '语音' } : { key, text, label: label || '语音' };
    const r = await this.request('/api/socialV2/send-voice', { method: 'POST', body, timeout: 120000 });
    return r.ok ? { ok: true, dryRun: false, data: jsonSafe(r.data) } : r;
  }

  appendOutbox(record) {
    if (!this.outboxFile) return;
    try {
      fs.mkdirSync(path.dirname(this.outboxFile), { recursive: true });
      fs.appendFileSync(this.outboxFile, `${JSON.stringify(record)}\n`, 'utf8');
    } catch (err) {
      this.logger(`outbox 写入失败：${err?.message || err}`);
    }
  }

  readOutbox(limit = 50) {
    if (!this.outboxFile) return [];
    try {
      const lines = fs.readFileSync(this.outboxFile, 'utf8').split('\n').filter(Boolean);
      return lines.slice(-limit).map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }
}

/** Resolve the coarse channel mode from a bridge status payload. */
export function channelModeOf(status) {
  if (!status || !status.ok) return 'local';
  if (status.data?.channel === 'qq') return 'qq';
  return 'degraded';
}

/** Validate an inbound payload coming from the bridge / tests. */
export function validateInbound(body) {
  const key = String(body?.key || '').trim();
  if (!/^(private|group):\d+$/.test(key)) return { ok: false, error: 'key 格式应为 private:QQ 或 group:群号' };
  const raw = Array.isArray(body?.messages) ? body.messages : [body?.message];
  const messages = raw
    .filter((m) => m !== undefined && m !== null)
    .map((m) => (typeof m === 'string' ? { text: m } : { text: String(m?.text ?? ''), sender: m?.sender, msgId: m?.msgId, at: m?.at }))
    .filter((m) => m.text.length > 0);
  if (!messages.length) return { ok: false, error: 'messages 不能为空' };
  return { ok: true, key, messages };
}
