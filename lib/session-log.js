import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * DSH session logs are append-only multi-frame zstd: every frame holds exactly
 * one JSON line. Node's zstdDecompressSync only decodes the first frame, so we
 * walk the frame headers ourselves, decompress frame by frame, and concatenate.
 *
 * Frame layout (RFC 8878):
 *   magic(4) | frame_header_descriptor(1) | [window_descriptor] |
 *   [dictionary_id] | [frame_content_size] | blocks… | [checksum(4)]
 * Each block: 3-byte little-endian header — last(1) | type(2) | size(21).
 */

const ZSTD_MAGIC = 0xfd2fb528;
const SKIPPABLE_MASK = 0xfffffff0;
const SKIPPABLE_MAGIC = 0x184d2a50;

export function frameRanges(buffer) {
  const ranges = [];
  let pos = 0;
  while (pos + 4 <= buffer.length) {
    const magic = buffer.readUInt32LE(pos);
    if ((magic & 0xfffffff0) === 0x184d2a50) {
      // Skippable frame: magic + 4-byte size + payload.
      if (pos + 8 > buffer.length) break;
      const size = buffer.readUInt32LE(pos + 4);
      if (pos + 8 + size > buffer.length) break;
      pos += 8 + size;
      continue;
    }
    if (magic !== 0xfd2fb528) {
      // Unknown byte, try to resynchronise by scanning for the next magic.
      const next = buffer.indexOf(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), pos + 1);
      if (next < 0) break;
      pos = next;
      continue;
    }
    const start = pos;
    let cursor = pos + 4;
    if (cursor >= buffer.length) break;
    const fhd = buffer[cursor++];
    const fcsFlag = (fhd >> 6) & 3;
    const singleSegment = (fhd >> 5) & 1;
    const checksum = (fhd >> 2) & 1;
    const dictIdFlag = fhd & 3;
    if (!singleSegment) cursor += 1;
    cursor += [0, 1, 2, 4][dictIdFlag];
    const fcsSize = fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag];
    cursor += fcsSize;
    let done = false;
    while (cursor + 3 <= buffer.length) {
      const header = buffer[cursor] | (buffer[cursor + 1] << 8) | (buffer[cursor + 2] << 16);
      const last = header & 1;
      const blockType = (header >> 1) & 3;
      const blockSize = header >>> 3;
      cursor += 3;
      if (blockType === 3) {
        // Reserved block type — the frame is malformed; stop here.
        cursor = buffer.length;
        break;
      }
      if (cursor + blockSize > buffer.length) {
        cursor = buffer.length;
        break;
      }
      cursor += blockSize;
      if (last) {
        done = true;
        break;
      }
    }
    if (!done) {
      ranges.push({ start, end: buffer.length, truncated: true });
      break;
    }
    if (checksum) cursor += 4;
    ranges.push({ start, end: Math.min(cursor, buffer.length), truncated: cursor > buffer.length });
    pos = cursor;
  }
  return ranges;
}

export function decodeFrames(buffer) {
  const ranges = frameRanges(buffer);
  const chunks = [];
  let truncated = false;
  for (const range of ranges) {
    if (range.truncated) {
      truncated = true;
      continue;
    }
    const slice = buffer.subarray(range.start, range.end);
    try {
      chunks.push(zlib.zstdDecompressSync(slice));
    } catch {
      // A half-written trailing frame is normal while a turn is running.
      truncated = true;
    }
  }
  return { text: Buffer.concat(chunks).toString('utf8'), frames: ranges.length, truncated };
}

// 会话日志是追加写的：同一份文件每次请求都整份解压太浪费（实测 2017 帧 ≈ 99ms，而面板 2.5s 轮询一次）。
// 按 (mtime, size) 缓存最近 3 个会话的解码结果；文件一变，缓存自然失效。
const LOG_CACHE = new Map();
const LOG_CACHE_LIMIT = 3;

function statOf(file) {
  try {
    const st = fs.statSync(file);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

export function readSessionLog(file, { cache = true } = {}) {
  const stat = cache ? statOf(file) : null;
  if (stat) {
    const hit = LOG_CACHE.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
      LOG_CACHE.delete(file);
      LOG_CACHE.set(file, hit);
      return hit.value;
    }
  }
  const value = decodeFrames(fs.readFileSync(file));
  if (stat) {
    LOG_CACHE.set(file, { ...stat, value });
    while (LOG_CACHE.size > LOG_CACHE_LIMIT) LOG_CACHE.delete(LOG_CACHE.keys().next().value);
  }
  return value;
}

/** 解析后的气泡列表也缓存一份：`itemsFromLines` 要 JSON.parse 几千行。 */
const ITEM_CACHE = new Map();

export function itemsOfSession(file, { cache = true } = {}) {
  const stat = cache ? statOf(file) : null;
  if (stat) {
    const hit = ITEM_CACHE.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
      ITEM_CACHE.delete(file);
      ITEM_CACHE.set(file, hit);
      return hit.value;
    }
  }
  const { text, frames, truncated } = readSessionLog(file, { cache });
  const lines = text.split('\n').filter(Boolean);
  const value = { items: itemsFromLines(lines), lines: lines.length, frames, truncated };
  if (stat) {
    ITEM_CACHE.set(file, { ...stat, value });
    while (ITEM_CACHE.size > LOG_CACHE_LIMIT) ITEM_CACHE.delete(ITEM_CACHE.keys().next().value);
  }
  return value;
}

/**
 * Locate a session log by id without knowing the escaped workspace directory:
 * the directory name is derived from cwd by a DSH-internal escaping we do not
 * want to reimplement, so just look one level under sessions/.
 */
export function findSessionLog(dshHome, sessionId) {
  const root = path.join(dshHome, 'sessions');
  if (!fs.existsSync(root)) return '';
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name, sessionId, 'session.v4.jsonl.zstd');
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

/** Read only the first frame — cheap enough to list a whole machine's sessions. */
export function readHeader(file) {
  const buffer = fs.readFileSync(file);
  const ranges = frameRanges(buffer);
  if (!ranges.length || ranges[0].truncated) return null;
  try {
    const text = zlib.zstdDecompressSync(buffer.subarray(ranges[0].start, ranges[0].end)).toString('utf8');
    const row = JSON.parse(text.split('\n')[0]);
    return row && row.type === 'session' ? row : null;
  } catch {
    return null;
  }
}

/**
 * Every session log on this machine, newest first. Each entry carries the
 * header (cwd, preset, createdAt) so the UI can label the workspace.
 */
export function scanSessions(dshHome) {
  const root = path.join(dshHome, 'sessions');
  const found = [];
  if (!fs.existsSync(root)) return found;
  for (const workspace of fs.readdirSync(root, { withFileTypes: true })) {
    if (!workspace.isDirectory()) continue;
    const workspaceDir = path.join(root, workspace.name);
    for (const entry of fs.readdirSync(workspaceDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(workspaceDir, entry.name, 'session.v4.jsonl.zstd');
      if (!fs.existsSync(file)) continue;
      const stat = fs.statSync(file);
      const header = readHeader(file);
      found.push({
        sessionId: entry.name,
        workspace: workspace.name,
        file,
        bytes: stat.size,
        mtime: stat.mtimeMs,
        cwd: (header && header.cwd) || '',
        agentPreset: (header && header.agentPreset) || '',
        origin: (header && header.origin) || '',
        parentSession: (header && header.parentSession) || '',
        delegationDepth: Number((header && header.delegationDepth) || 0),
        createdAt: (header && header.createdAt) || 0,
        valid: Boolean(header && header.id === entry.name)
      });
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found;
}

function textOf(message) {
  const content = message && message.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function reasoningOf(message) {
  const content = message && message.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'reasoning' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function toolCallNames(message) {
  const content = message && message.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((block) => block && (block.type === 'tool-call' || block.type === 'tool_call'))
    .map((block) => block.name)
    .filter(Boolean);
}

function imagesOf(message) {
  const content = message && message.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((block) => block && block.type === 'image' && block.attachment)
    .map((block) => ({
      attachmentId: block.attachment.attachmentId,
      mediaType: block.attachment.mediaType,
      bytes: block.attachment.bytes,
      width: block.attachment.width,
      height: block.attachment.height,
      name: block.attachment.name
    }));
}

const SNAPSHOT_MARK = '【本次消息快照】';
const PANEL_MARK = '【面板消息】';
const HOST_PREFIXES = ['Current runtime context', '<system-reminder>', 'Time sampled while preparing'];

/** Pull the first balanced {...} out of a string, ignoring braces inside strings. */
function firstJsonObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

function textFromSnapshot(tail) {
  if (!tail) return '';
  if (tail.startsWith('{') || tail.startsWith('[')) {
    const candidate = tail.startsWith('{') ? firstJsonObject(tail) : tail;
    try {
      const parsed = JSON.parse(candidate);
      // 快照有两种形状：唤醒时 messages 是本次消息（可能为空数组），没有新消息时
      // 内容在 recent 里（混着她自己的发言）。messages:[] 是 truthy，旧代码会
      // 因此把整段 JSON 当气泡显示；这里按「有新消息用 messages，否则取 recent
      // 里主人最后一句」挑。
      let picked;
      if (Array.isArray(parsed)) picked = parsed;
      else if (Array.isArray(parsed.messages) && parsed.messages.length) picked = parsed.messages;
      else if (Array.isArray(parsed.recent) && parsed.recent.length) {
        picked = parsed.recent.filter((row) => row && row.isOwner && !row.isSelf).slice(-1);
      } else picked = parsed.snapshot;
      const rows = Array.isArray(picked) ? picked : [];
      const texts = (Array.isArray(rows) ? rows : [])
        .map((row) => {
          if (!row) return '';
          if (typeof row.text === 'string') return row.text;
          if (typeof row.content === 'string') return row.content;
          if (Array.isArray(row.content)) {
            return row.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('');
          }
          return '';
        })
        .filter(Boolean);
      if (texts.length) return texts.join('\n');
      // JSON 解析成功但没有主人发言（空快照，或 recent 里只有她自己的话）：
      // 这是一次没有新消息的唤醒，不能把 JSON 原文当气泡。
      return '';
    } catch {
      /* fall through to the raw tail */
    }
  }
  return tail;
}

/**
 * Work out who wrote this prompt and what the user actually said. QQ prompts
 * carry the snapshot as JSON; panel prompts carry it as plain text; anything
 * else is host scaffolding that must not become a bubble.
 */
function panelOrigin(text) {
  const raw = String(text || '');
  const headText = raw.trimStart();
  // Bridge wake prompts always start with the handwritten rules and the fact
  // card; when there is no snapshot / panel marker there is no human text in
  // them at all, so the whole prompt is host scaffolding and must never be
  // rendered as a bubble.
  if (!raw.includes(SNAPSHOT_MARK) && !raw.includes(PANEL_MARK)
    && (headText.startsWith('【规则') || headText.startsWith('【长期记忆') || headText.includes('【长期记忆（事实卡）】'))) {
    return { origin: 'host', displayText: '', kind: 'host' };
  }
  // Panel direct-send: the bridge wraps the text as 【来自桌面面板 · 不发 QQ】 … 【面板消息】<text>.
  const panelAt = raw.lastIndexOf(PANEL_MARK);
  if (panelAt >= 0) {
    const said = raw.slice(panelAt + PANEL_MARK.length).trim();
    return { origin: 'panel', displayText: said, kind: 'panel' };
  }
  const at = raw.lastIndexOf(SNAPSHOT_MARK);
  if (at >= 0) {
    const tail = text.slice(at + SNAPSHOT_MARK.length).trim();
    const spoken = textFromSnapshot(tail);
    const head = String(text || '').trimStart();
    const origin = head.startsWith('【当前时间】') || head.includes('qq_send_message') ? 'qq' : 'panel';
    return { origin, displayText: spoken, kind: 'snapshot' };
  }
  const head = String(text || '').trimStart();
  if (HOST_PREFIXES.some((prefix) => head.startsWith(prefix))) {
    return { origin: 'host', displayText: '', kind: 'host' };
  }
  // Bridge/宿主塞进 user 回合的流程提醒（收尾催促、沉睡前等待、首回复节奏）
  // 不是聊天内容，不能变成面板气泡。
  if (/你还没有完成回合收尾|【沉睡前强制等待】|【首回复节奏】|【行动前】/.test(head)) {
    return { origin: 'host', displayText: '', kind: 'host' };
  }
  // QQ inbound prompt: the bridge packs time + rules + card into the user message and
  // ends with a sender line such as 【管理员】<text>. Show only what the person typed.
  if (head.startsWith('【当前时间】') || head.includes('qq_send_message')) {
    const said = tailAfterSender(head);
    if (said) return { origin: 'qq', displayText: said, kind: 'qq' };
  }
  return { origin: 'panel', displayText: String(text || '').trim(), kind: 'plain' };
}

/**
 * Pull the human text out of a bridge-composed prompt. Sender lines look like
 * 【管理员】你好 / 【群友·昵称】你好; template headings like 【当前对话】 carry no text
 * on their own line, so requiring text after the bracket skips them.
 */
function tailAfterSender(raw) {
  const lines = String(raw || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    const hit = /^【[^】]{1,24}】(\S.*)$/.exec(line);
    if (hit && hit[1].trim()) return hit[1].trim();
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line && !/^【[^】]*】$/.test(line)) return line;
  }
  return '';
}

/**
 * Turn a parsed log into chat items. The log is the only source of truth: every
 * bubble here exists because a line says so, not because the panel kept state.
 */
function imageRefsByMessageId(lines) {
  // 主人发图后，模型常调用 qq_get_message_images 看图；图片以 DSH 附件块的形式
  // 存在那条 tool/result 里。wait 结果里的消息只有 media 占位、没有图片引用，
  // 这里按「工具调用参数里的 messageId → 紧随其后结果里的 image 块」建立映射。
  const map = new Map();
  let pendingId = '';
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const data = (row && row.data) || {};
    const message = data.message || data;
    if (row && row.type === 'tool/call' && /get_message_images$/.test(String(data.name || ''))) {
      let args = data.arguments || {};
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      pendingId = args.messageId != null ? String(args.messageId) : '';
      continue;
    }
    if (row && row.type === 'tool/result' && pendingId) {
      const blocks = Array.isArray(message.content) ? message.content : [];
      const refs = blocks.filter((b) => b && b.type === 'image' && b.attachment).map((b) => ({ ...b.attachment }));
      if (refs.length) map.set(pendingId, refs);
      pendingId = '';
    }
  }
  return map;
}

export function itemsFromLines(lines) {
  const items = [];
  const imageRefs = imageRefsByMessageId(lines);
  let currentTurn = 0;
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const type = row && row.type;
    const data = (row && row.data) || {};
    const stamp = typeof row.time === 'number' ? row.time : (typeof data.time === 'number' ? data.time : 0);
    const at = stamp ? new Date(stamp).toISOString() : '';
    if (type === 'turn/start') {
      currentTurn = Number(data.turn) || currentTurn + 1;
      continue;
    }
    if (type === 'user/message') {
      const text = textOf(data);
      const images = imagesOf(data);
      if (!text && !images.length) continue;
      // An image-only message never carries the snapshot marker because the
      // panel skips prompt composition for it; only the panel sends those.
      const derived = text ? panelOrigin(text) : { origin: 'panel', displayText: '' };
      if (derived.origin === 'host' && !images.length) continue;
      if (!String(derived.displayText || '').trim() && !images.length) continue;
      items.push({
        id: `u-${row.seq ?? items.length}`,
        role: 'user',
        origin: derived.origin,
        text,
        displayText: derived.displayText,
        images,
        turn: currentTurn,
        at
      });
      continue;
    }
    if (type === 'assistant/message') {
      const message = data.message || data;
      const text = textOf(message);
      const thinking = reasoningOf(message);
      const model = message.model || data.model || '';
      const toolCalls = toolCallNames(message);
      if (!text) continue;
      items.push({
        id: `a-${row.seq ?? items.length}`,
        role: 'assistant',
        origin: 'bot',
        text,
        displayText: text,
        thinking,
        images: [],
        model,
        toolCalls,
        turn: currentTurn,
        at
      });
      continue;
    }
    if (type === 'tool/result') {
      // qq_wait_for_messages / qq_get_unread_messages 的结果里带着主人刚发的话。
      // 这些消息不会单独产生 user/message 行（回复在同一回合完成），必须在这里
      // 补成气泡，否则面板会少掉「她等待期间收到的消息」。
      const message = data.message || data;
      const raw = textOf(message);
      const start = raw.indexOf('{');
      if (raw && start >= 0) {
        try {
          const parsed = JSON.parse(raw.slice(start));
          const rows = Array.isArray(parsed.newMessages)
            ? parsed.newMessages
            : (Array.isArray(parsed.messages) ? parsed.messages : []);
          for (const row of rows) {
            if (!row || !row.isOwner || row.isSelf) continue;
            const said = String(row.text || '').trim();
            if (!said) continue;
            const hasImage = Array.isArray(row.media) && row.media.some((m) => m && m.kind === 'image');
            const refs = hasImage && row.messageId != null ? (imageRefs.get(String(row.messageId)) || []) : [];
            items.push({
              id: `w-${row.seq ?? items.length}-${row.messageId || ''}`,
              role: 'user',
              origin: 'qq',
              text: said,
              displayText: said,
              images: refs.map((ref) => ({ ...ref })),
              turn: currentTurn,
              at
            });
          }
        } catch { /* 不是 JSON 的工具结果，忽略 */ }
      }
      continue;
    }
    if (type === 'tool/call' && /send[-_]message$/i.test(String(data.name || ''))) {
      // QQ replies are tool calls — surface what she actually sent to the user.
      const args = data.arguments || {};
      let parsed = args;
      if (typeof args === 'string') {
        try {
          parsed = JSON.parse(args);
        } catch {
          parsed = { text: args };
        }
      }
      const raw = parsed.messages ?? parsed.message ?? parsed.text ?? '';
      const spoken = Array.isArray(raw) ? raw.join('\n') : String(raw || '');
      if (!spoken) continue;
      items.push({
        id: `t-${row.seq ?? items.length}`,
        role: 'assistant',
        origin: 'qq',
        text: spoken,
        displayText: spoken,
        images: [],
        toolCalls: [data.name],
        turn: currentTurn,
        at
      });
    }
  }
  // A QQ turn writes its real answer through qq_send_message; the assistant text
  // block of that same turn is working notes, so keep only what reached QQ.
  const qqTurns = new Set(items.filter((item) => item.origin === 'qq').map((item) => item.turn));
  const kept = items.filter((item) => !(item.role === 'assistant' && item.origin === 'bot' && qqTurns.has(item.turn)));
  // 同一条主人消息可能既出现在 wait 结果里、又在下一次 prompt 的 user/message 里；
  // 15 分钟内同文只留一条（先到的 wait 版本时间更接近真实发送时刻）。
  const seen = [];
  return kept.filter((item) => {
    if (item.role !== 'user') return true;
    const text = String(item.displayText || '').trim();
    // DSH 把子代理完成通知也投成 user 消息；它不是主人说的话，不进聊天记录。
    if (/^(Background subagent\b|Its closing message:)/.test(text)) return false;
    if (!text) return true;
    const ts = Date.parse(item.at) || 0;
    if (seen.some((prev) => prev.text === text && Math.abs(prev.ts - ts) <= 15 * 60 * 1000)) return false;
    seen.push({ text, ts });
    return true;
  });
}

export function historyFromFile(file, { limit = 40, before = '', q = '' } = {}) {
  const { items: allItems, lines, frames, truncated } = itemsOfSession(file);
  let items = allItems;
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter((item) => String(item.displayText || item.text || '').toLowerCase().includes(needle));
  }
  if (before) {
    const index = items.findIndex((item) => item.id === before);
    if (index >= 0) {
      items = items.slice(0, index);
    } else {
      // 游标找不到（会话换了、或搜索词把它过滤掉了）时，不能把最后一页再返回一遍：
      // 客户端会「加载更多」无限重复同一批消息。
      return { ok: true, file, frames, truncated, lines, total: 0, hasMore: false, items: [], staleBefore: true };
    }
  }
  const total = items.length;
  const page = items.slice(Math.max(0, total - limit));
  return {
    ok: true,
    file,
    frames,
    truncated,
    lines,
    total,
    hasMore: total > page.length,
    items: page
  };
}
