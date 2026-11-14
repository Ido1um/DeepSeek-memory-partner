/**
 * Session bridge — the only place DSMP drives a DSH session.
 *
 * Rules encoded here (see plan §3.2 / §12.1):
 *  - `ctx.agents.get(id)` first: a live agent is ALWAYS reused, never resumed,
 *    otherwise the same session would run two agents.
 *  - `ctx.agents.resume({ resumeSessionId })` is the official way to continue a
 *    persisted session; it keeps the cwd recorded in the log header.
 *  - Test isolation: while settings.test.enabled is on, only sessions whose id
 *    starts with settings.test.sessionPrefix may be created or driven.
 *  - Messages are NOT persisted here: the DSH session log is the single source
 *    of truth. We only keep a small in-memory ring buffer for the panel.
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const MESSAGE_BUFFER = 400;
const EVENT_BUFFER = 400;

function textOf(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * Panel messages arrive wrapped in the memory prompt (rules + fact card +
 *【本次消息快照】). The mirror keeps the whole text as `raw` for diagnostics but
 * shows only what the owner actually typed, and marks host-injected context so
 * the panel can hide it instead of pretending it was a person.
 */
const SNAPSHOT_MARK = '【本次消息快照】';
function panelTextOf(text) {
  const raw = String(text || '');
  const index = raw.indexOf(SNAPSHOT_MARK);
  if (index >= 0) {
    return { origin: 'panel', displayText: raw.slice(index + SNAPSHOT_MARK.length).trim() };
  }
  return { origin: 'host', displayText: '' };
}

/** Durable image references carried by a message, in order. */
function imagesOf(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((block) => block && block.type === 'image' && block.attachment)
    .map((block) => {
      const ref = block.attachment;
      return {
        attachmentId: String(ref.attachmentId || ''),
        mediaType: String(ref.mediaType || ''),
        bytes: Number(ref.bytes) || 0,
        width: Number(ref.width) || 0,
        height: Number(ref.height) || 0,
        name: ref.name ? String(ref.name) : ''
      };
    });
}

/** Bumped by hand while spiking so /api/dsmp/status shows which module is live. */
export const BUILD = 'sb-m3-1';

export class SessionBridge {
  constructor({ ctx, settings, logger = console }) {
    this.ctx = ctx;
    this.settings = settings;
    this.logger = logger;
    this.handles = new Map();
    this.messages = new Map();
    this.busy = new Map();
    this.lastSeq = new Map();
    this.msgIdx = new Map();
    this.titles = new Map();
  }

  get testMode() {
    return Boolean(this.settings.test && this.settings.test.enabled);
  }

  isTestSession(sessionId) {
    const prefix = String((this.settings.test && this.settings.test.sessionPrefix) || 'session-dsmp-test-');
    return String(sessionId || '').startsWith(prefix);
  }

  /** Throws unless the session may be touched under the current isolation rule. */
  guard(sessionId, { allowLive = false } = {}) {
    if (!this.testMode) return;
    if (this.settings.test.allowLiveSessions) return;
    if (allowLive) return;
    if (this.isTestSession(sessionId)) return;
    const err = new Error(`测试期只允许测试会话（${this.settings.test.sessionPrefix}*），拒绝操作 ${sessionId}`);
    err.code = 'DSMP_TEST_ONLY';
    throw err;
  }

  liveAgent(sessionId) {
    return this.ctx.agents.get(sessionId);
  }

  /** True when the agent for this session is in the middle of a turn. */
  isBusy(sessionId) {
    const agent = this.liveAgent(sessionId);
    if (!agent) return false;
    return Boolean(agent.running || (agent.session && (agent.session.running || agent.session.busy)) || agent.busy);
  }

  /** Reuse a live agent, else resume the persisted session. */
  async attach(sessionId, { agentOptions, allowLive = false } = {}) {
    this.guard(sessionId, { allowLive });
    const live = this.liveAgent(sessionId);
    if (live) return { agent: live, sessionId, mode: 'live' };
    const handle = await this.ctx.agents.resume({ resumeSessionId: sessionId, agentOptions });
    this.handles.set(sessionId, handle);
    return { agent: handle.agent, sessionId, mode: 'resumed' };
  }

  /**
   * Mount the agent preset the same way the host does for GUI-created sessions.
   * Without this the agent still runs, but no preset tools are mounted.
   */
  async #presetSetup(presetId) {
    const presets = this.ctx.get ? this.ctx.get('agentPresets') : undefined;
    if (!presets || typeof presets.resolve !== 'function' || typeof presets.mount !== 'function') {
      return { presetId, setup: undefined };
    }
    try {
      const resolved = await presets.resolve(presetId || undefined);
      const id = String((resolved && resolved.id) || '').trim() || presetId;
      return {
        presetId: id,
        setup: async (agentCtx) => { await presets.mount(agentCtx, id); }
      };
    } catch {
      return { presetId, setup: undefined };
    }
  }

  /**
   * The model the host would use if the caller names none.
   *
   * A session created without agentOptions has no model on its agent, and the
   * persona prompt section then fails to resolve {{model}} ("prompt variable
   * has no value"). Passing the default selection explicitly keeps panel turns
   * identical to GUI-created ones.
   */
  #defaultAgentOptions() {
    try {
      const svc = typeof this.ctx.get === 'function' ? this.ctx.get('agentDefaultModel') : this.ctx.agentDefaultModel;
      const sel = svc && typeof svc.currentSelection === 'function' ? svc.currentSelection() : null;
      if (sel && sel.provider && sel.model) return { provider: sel.provider, model: sel.model };
    } catch {
      /* fall through — let the host decide */
    }
    return {};
  }

  async createTestSession({ agentOptions, cwd, title, preset } = {}) {
    const prefix = String((this.settings.test && this.settings.test.sessionPrefix) || 'session-dsmp-test-');
    const sessionId = `${prefix}${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const workdir = cwd || this.settings.test.cwd;
    const presetId = preset || 'standard';
    const { setup } = await this.#presetSetup(presetId);
    const options = agentOptions && Object.keys(agentOptions).length ? agentOptions : this.#defaultAgentOptions();
    // The agent loop refuses to start a turn when cwd is missing, so make the
    // sandbox directory first (it lives under <DSH_HOME>/dsmp/test/cwd).
    try { fs.mkdirSync(workdir, { recursive: true }); } catch { /* turn will report it */ }

    const handle = await this.ctx.agents.create({
      sessionId,
      // No origin/delegationDepth: a plain root session, not a parentless subagent.
      meta: { cwd: workdir, agentPreset: presetId },
      agentOptions: options,
      ...(setup ? { setup } : {})
    });
    // Drop any seed message the factory queued so the first followup is ours.
    if (handle.agent && handle.agent.inbox && typeof handle.agent.inbox.clear === 'function') {
      try { handle.agent.inbox.clear(); } catch { /* non-fatal */ }
    }
    this.handles.set(sessionId, handle);
    this.messages.set(sessionId, []);
    this.titles.set(sessionId, String(title || ''));
    return {
      sessionId,
      cwd: workdir,
      title: title || '',
      preset: presetId,
      agentOptions: options
    };
  }

  async send(sessionId, text, { agentOptions, images, allowLive = false } = {}) {
    const body = String(text || '').trim();
    const refs = Array.isArray(images) ? images.filter(Boolean) : [];
    if (!body && refs.length === 0) {
      const err = new Error('消息不能为空');
      err.code = 'DSMP_EMPTY_MESSAGE';
      throw err;
    }
    // Offline fallback attaches to a session the bridge normally drives. Never
    // queue a second turn into an agent that is already answering.
    if (allowLive && this.isBusy(sessionId)) {
      const err = new Error('她正在回复上一条消息，等这一轮结束再发');
      err.code = 'DSMP_SESSION_BUSY';
      throw err;
    }
    const options = agentOptions && Object.keys(agentOptions).length ? agentOptions : this.#defaultAgentOptions();
    const { agent, mode } = await this.attach(sessionId, { agentOptions: options, allowLive });
    const messageId = `dsmp-${randomUUID()}`;
    const content = [];
    if (body) content.push({ type: 'text', text: body });
    for (const ref of refs) content.push({ type: 'image', attachment: ref });
    const result = await agent.followup({
      role: 'user',
      id: messageId,
      content,
      source: { kind: 'user' }
    });
    return {
      ok: true,
      sessionId,
      messageId,
      mode,
      images: refs.length,
      // Dev diagnostics: what the agent actually returned and how it looks.
      debug: {
        followup: summarize(result),
        agentKeys: safeKeys(agent),
        running: agent && (agent.running ?? (agent.session && agent.session.running) ?? null),
        agentId: agent && agent.id
      }
    };
  }

  dispose(sessionId) {
    const handle = this.handles.get(sessionId);
    this.handles.delete(sessionId);
    try {
      if (handle && typeof handle.dispose === 'function') handle.dispose();
    } catch (err) {
      this.logger.warn?.(`[dsmp] dispose ${sessionId} failed: ${err && err.message}`);
    }
  }

  /** session/event feed projection. Never throws: the host logs observer errors. */
  observe(session, event) {
    try {
      if (!session || !event || !event.type) return;
      const sessionId = String(session.id || (session.header && session.header.id) || '');
      if (!sessionId) return;
      if (this.testMode && !this.isTestSession(sessionId)) return;
      if (event.type === 'turn/start') {
        this.busy.set(sessionId, true);
        return;
      }
      if (event.type === 'turn/end') {
        this.busy.set(sessionId, false);
        this.push(sessionId, { kind: 'turn-end', turn: event.data && event.data.turn, reason: event.data && event.data.reason });
        return;
      }
      if (event.type === 'user/message') {
        const content = event.data && event.data.content;
        const text = textOf(content);
        const images = imagesOf(content);
        if (!text && images.length === 0) return;
        this.push(sessionId, this.message(sessionId, event, {
          role: 'user',
          text,
          images,
          ...panelTextOf(text)
        }));
        return;
      }
      if (event.type === 'assistant/message') {
        const message = (event.data && event.data.message) || {};
        const text = textOf(message.content);
        const images = imagesOf(message.content);
        const toolCalls = Array.isArray(message.content)
          ? message.content.filter((b) => b && b.type === 'tool-call').map((b) => b.name)
          : [];
        if (!text && toolCalls.length === 0 && images.length === 0) return;
        this.push(sessionId, this.message(sessionId, event, { role: 'assistant', text, toolCalls, images }));
        return;
      }
      if (event.type === 'tool/call') {
        const data = event.data || {};
        this.push(sessionId, {
          kind: 'tool-call',
          seq: event.seq,
          at: event.time,
          turn: data.turn,
          name: String(data.name || ''),
          arguments: String(data.arguments || '').slice(0, 4000)
        });
        return;
      }
      if (event.type === 'model/selection') {
        this.push(sessionId, { kind: 'model', seq: event.seq, at: event.time, data: event.data || {} });
      }
    } catch (err) {
      this.logger.warn?.(`[dsmp] observe failed: ${err && err.message}`);
    }
  }

  message(sessionId, event, { role, text, toolCalls, images, origin, displayText }) {
    const data = event.data || {};
    const message = data.message || {};
    return {
      kind: 'message',
      id: String(message.id || `${sessionId}-${event.seq}`),
      seq: event.seq,
      at: event.time,
      turn: data.turn,
      role,
      origin: origin || (role === 'assistant' ? 'bot' : 'host'),
      text,
      displayText: displayText || '',
      images: images || [],
      toolCalls: toolCalls || [],
      model: message.source && message.source.model ? String(message.source.model) : ''
    };
  }

  push(sessionId, row) {
    const list = this.messages.get(sessionId) || [];
    if (row.seq && list.some((item) => item.seq === row.seq && item.kind === row.kind)) return;
    if (row.kind === 'message' && !row.idx) {
      const next = (this.msgIdx.get(sessionId) || 0) + 1;
      this.msgIdx.set(sessionId, next);
      row.idx = next;
    }
    list.push(row);
    while (list.length > MESSAGE_BUFFER) list.shift();
    this.messages.set(sessionId, list);
  }

  /** Panel snapshot: projected messages plus the busy flag. `after` = 只取比它新的消息（增量轮询）。 */
  snapshot(sessionId, { after = 0 } = {}) {
    const list = this.messages.get(sessionId) || [];
    const live = this.liveAgent(sessionId);
    const cursor = Number(after) || 0;
    const messages = list.filter((row) => row.kind === 'message');
    const fresh = cursor > 0 ? messages.filter((row) => Number(row.idx) > cursor) : messages;
    const lastIdx = messages.reduce((max, row) => Math.max(max, Number(row.idx) || 0), 0);
    return {
      ok: true,
      sessionId,
      testMode: this.testMode,
      busy: Boolean(this.busy.get(sessionId)) || Boolean(live && (live.running || live.isRunning || (live.session && live.session.running))),
      attached: Boolean(live),
      after: cursor,
      lastIdx,
      messages: fresh.slice(-200),
      events: list.slice(-40)
    };
  }

  listSessions() {
    const prefix = String((this.settings.test && this.settings.test.sessionPrefix) || 'session-dsmp-test-');
    const live = new Map();
    try {
      for (const agent of this.ctx.agents.list() || []) {
        const id = String((agent && agent.session && agent.session.id) || (agent && agent.id) || '');
        if (id) live.set(id, agent);
      }
    } catch {
      /* registry unavailable — fall back to what we have observed */
    }
    const ids = new Set([...this.messages.keys(), ...live.keys()].filter((id) => id.startsWith(prefix)));
    const rows = [...ids]
      .map((id) => {
        const list = this.messages.get(id) || [];
        const messages = list.filter((row) => row.kind === 'message');
        const agent = live.get(id);
        return {
          id,
          title: this.titles.get(id) || '',
          busy: Boolean(agent && (agent.running || agent.isRunning || agent.busy)) || Boolean(this.busy.get(id)),
          attached: Boolean(agent),
          messages: messages.length,
          lastAt: messages.length ? messages[messages.length - 1].at : ''
        };
      })
      .sort((a, b) => String(a.lastAt).localeCompare(String(b.lastAt)));
    return { ok: true, prefix, sessions: rows, known: [...this.messages.keys()].filter((id) => id.startsWith(prefix)) };
  }

  /** Read-only view of the real QQ session: presence and log metadata only. */
  liveSessionInfo() {
    const liveId = String((this.settings.session && this.settings.session.liveId) || '');
    if (!liveId) return { ok: true, sessionId: '', present: false };
    let present = false;
    try {
      present = Boolean(this.ctx.agents.get(liveId));
    } catch {
      present = false;
    }
    return {
      ok: true,
      sessionId: liveId,
      cwd: String((this.settings.session && this.settings.session.liveCwd) || ''),
      present,
      testMode: this.testMode,
      note: this.testMode ? '测试期只读：DSMP 不会向这个会话发送任何消息' : ''
    };
  }
}

/** JSON-safe one-line description of whatever followup returned. */
function summarize(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value !== 'object') return String(value);
  try {
    const keys = Object.keys(value);
    const out = {};
    for (const key of keys.slice(0, 12)) {
      const item = value[key];
      out[key] = item === null || ['string', 'number', 'boolean'].includes(typeof item) ? item : typeof item;
    }
    return out;
  } catch {
    return 'object';
  }
}

function safeKeys(agent) {
  if (!agent) return [];
  try {
    return Object.keys(agent).slice(0, 40);
  } catch {
    return [];
  }
}
