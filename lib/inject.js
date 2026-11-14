/**
 * A1: move chat prompt composition from send-time to `agent/pre-step`.
 *
 * Why: the panel used to bake "rules + fact card + snapshot" into the user
 * message before handing it to the agent. That works, but it means every entry
 * point (panel, bridge, future channels) has to compose the same text, and a
 * turn that runs several steps keeps the *stale* card it was composed with.
 *
 * Here the user message stays exactly what the owner typed, and a single
 * context message (stable id, source.kind === 'dsmp-inject') carries the memory
 * projection. On each step we replace that one message in place — never append —
 * so the window does not grow a new card every step.
 *
 * Guards:
 *   - only messages that look like raw owner input are touched; QQ prompts
 *     (bridge already composes them) are recognised by their markers and skipped
 *   - only bound conversations (the QQ/panel session) are touched
 *   - `settings.inject.mode === 'send'` disables this module entirely (rollback)
 */

const KEEP_KIND = 'dsmp-inject';
const CTX_PREFIX = 'dsmp-memory-';
const QQ_MARKERS = ['【本次消息快照】', '【面板消息】', '【来自桌面面板'];
const PENDING_TTL_MS = 60000;

const pending = new Map();

let cfg = {
  getSettings: () => null,
  isBoundSession: () => false,
  compose: null,
  logger: () => {}
};

export function configureInject(next = {}) {
  cfg = { ...cfg, ...next };
}

/** Remember the send-time composition so pre-step does not rebuild the card. */
export function notePanelTurn(sessionId, { raw = '', composed = '' } = {}) {
  const id = String(sessionId || '');
  if (!id || !composed) return;
  pending.set(id, { raw: String(raw || ''), composed: String(composed), at: Date.now() });
  while (pending.size > 32) pending.delete(pending.keys().next().value);
}

export function injectStatus() {
  const settings = cfg.getSettings() || {};
  return {
    mode: String((settings.inject && settings.inject.mode) || 'pre-step'),
    pending: pending.size
  };
}

/** B2: a restore changes the card — drop cached prefixes so the next turn recomposes. */
export function clearPending() {
  pending.clear();
}

function textOf(message) {
  const blocks = Array.isArray(message && message.content) ? message.content : [];
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function isOwnContext(message) {
  return Boolean(message && message.source && message.source.kind === KEEP_KIND);
}

async function composeSafe(raw) {
  if (typeof cfg.compose !== 'function') return '';
  try {
    const out = await cfg.compose(raw);
    return typeof out === 'string' ? out : String((out && out.text) || '');
  } catch (err) {
    cfg.logger('[dsmp] 注入组装失败：' + ((err && err.message) || err));
    return '';
  }
}

export async function preStep(payload, next) {
  const decision = await next();
  try {
    if (!decision || decision.kind !== 'enter') return decision;
    const settings = cfg.getSettings();
    const mode = String((settings && settings.inject && settings.inject.mode) || 'pre-step');
    if (mode === 'send') return decision;

    const agent = payload && payload.agent;
    const sessionId = String((agent && (agent.id || (agent.session && agent.session.id))) || '');
    if (!sessionId || !cfg.isBoundSession(sessionId)) return decision;

    const messages = Array.isArray(decision.messages) ? decision.messages.slice() : [];
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message && message.role === 'user' && !isOwnContext(message)) {
        lastUser = i;
        break;
      }
    }
    if (lastUser < 0) return decision;

    const raw = textOf(messages[lastUser]);
    if (!raw) return decision;
    if (QQ_MARKERS.some((marker) => raw.includes(marker))) return decision;

    const ctxId = CTX_PREFIX + sessionId;
    const cached = pending.get(sessionId);
    let composed = '';
    if (cached && cached.raw === raw && Date.now() - cached.at < PENDING_TTL_MS) {
      composed = cached.composed;
    } else {
      composed = await composeSafe(raw);
    }
    if (!composed) return decision;

    const withoutOld = messages.filter((message) => !(message && message.id === ctxId));
    let insertAt = -1;
    for (let i = withoutOld.length - 1; i >= 0; i -= 1) {
      const message = withoutOld[i];
      if (message && message.role === 'user' && !isOwnContext(message)) {
        insertAt = i;
        break;
      }
    }
    if (insertAt < 0) return decision;

    const ctxMessage = {
      id: ctxId,
      role: 'user',
      content: [{ type: 'text', text: composed }],
      source: { kind: KEEP_KIND }
    };
    const nextMessages = [
      ...withoutOld.slice(0, insertAt),
      ctxMessage,
      ...withoutOld.slice(insertAt)
    ];
    return { ...decision, messages: nextMessages };
  } catch (err) {
    cfg.logger('[dsmp] pre-step 注入跳过：' + ((err && err.message) || err));
    return decision;
  }
}
