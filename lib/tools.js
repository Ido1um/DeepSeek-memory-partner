/**
 * A3: memory tools as native `ctx.tools.register` definitions.
 *
 * These mirror the `qq_memory_*` MCP tools (search / recall / window / write /
 * edit / photo / todo) but run in-process: no stdio MCP child, no bridge
 * dependency, and the data directory is DSMP's own (`settings.memoryDir`).
 *
 * Read-only tools work for any agent. Write tools require DSMP to be the
 * single writer (lease held) — otherwise they return a clear error instead of
 * racing the bridge.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOL_PREFIX = 'dsmp_memory_';

let VENDOR_SRC = '';
const MODULES = new Map();

export function configureTools({ vendorDir } = {}) {
  if (vendorDir) VENDOR_SRC = String(vendorDir);
}

async function vendor(name) {
  if (!MODULES.has(name)) {
    const base = VENDOR_SRC
      ? pathToFileURL(path.join(VENDOR_SRC, name + '.mjs')).href
      : new URL(`../vendor/memory/src/${name}.mjs`, import.meta.url).href;
    // Bundle off/on re-imports this file but Node keeps the old vendor module
    // in its ESM cache. Bust it by mtime so a reload also picks up engine
    // fixes (dedupe / expiry ranking / monthly …) without restarting DSH.
    let url = base;
    try {
      const file = VENDOR_SRC ? path.join(VENDOR_SRC, name + '.mjs') : fileURLToPath(base);
      url = `${base}?v=${fs.statSync(file).mtimeMs}`;
    } catch { /* keep the plain URL */ }
    MODULES.set(name, import(url));
  }
  return MODULES.get(name);
}

const text = (value) => [{ type: 'text', text: String(value == null ? '' : value) }];

/**
 * `store` resolves its directory from cfg() (env QQ_MEMORY_DIR → config →
 * default), never from an argument. Point the env var at our own directory for
 * the duration of one synchronous call and restore it afterwards, so tools read
 * exactly what the panel shows.
 */
function withDir(dir, fn) {
  const prev = process.env.QQ_MEMORY_DIR;
  process.env.QQ_MEMORY_DIR = String(dir || '');
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.QQ_MEMORY_DIR;
    else process.env.QQ_MEMORY_DIR = prev;
  }
}

function schema(properties, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

function outputSchema() {
  return { type: 'object', properties: { ok: { type: 'boolean' }, text: { type: 'string' } }, additionalProperties: true };
}

function jsonRender(_args, value) {
  const body = value && typeof value === 'object' && typeof value.text === 'string'
    ? value.text
    : JSON.stringify(value, null, 2);
  return text(body);
}

function ok(payload) {
  return { ok: true, ...payload, text: payload.text || '' };
}

function fail(message, code = 'DSMP_TOOL_ERROR') {
  return { ok: false, code, error: String(message), text: String(message) };
}

/**
 * @param {object} opts
 * @param {any} opts.ctx host context (must expose ctx.tools)
 * @param {() => string} opts.dir memory directory
 * @param {() => boolean} opts.canWrite single-writer gate
 * @param {() => string} opts.ownerKey conversation key (private:<QQ>)
 * @param {any} opts.attachments ctx.attachments (optional, for photos)
 * @param {(line:string)=>void} opts.logger
 */
export function registerMemoryTools({ ctx, dir, canWrite, ownerKey, attachments, getSettings = () => ({}), logger = () => {} }) {
  const tools = (ctx && ctx.tools)
    || (ctx && typeof ctx.get === 'function' ? ctx.get('tools') : null);
  if (!tools || typeof tools.register !== 'function') {
    logger('[dsmp] 宿主没有 tools 服务，A3 原生工具跳过注册');
    return [];
  }
  const disposers = [];
  const reg = (definition) => {
    try {
      disposers.push(tools.register(definition));
    } catch (err) {
      logger(`[dsmp] 工具注册失败 ${definition.name}：${(err && err.message) || err}`);
    }
  };
  const dirNow = () => String(dir() || '');

  // ── search：历史原文 ───────────────────────────────────────────────
  reg({
    name: TOOL_PREFIX + 'search',
    description: [
      '检索历史聊天原文（主人私聊，含归档）。什么时候用：聊到很久以前、想不起细节、要确认「以前说过/答应过什么」。',
      'query 用 2~3 个关键词（空格分隔，任一命中即返回，命中越多排越前）；from/to 为 YYYY-MM-DD，可省略；limit 默认 5、上限 20。',
      '查到后引用时说明「查到以前的记录」；找不到就直说找不到，不要编。'
    ].join('\n'),
    parameters: schema({
      query: { type: 'string', description: '关键词，空格分隔多个' },
      from: { type: 'string', description: '起始日期 YYYY-MM-DD' },
      to: { type: 'string', description: '结束日期 YYYY-MM-DD' },
      limit: { type: 'number', description: '最多返回几条，默认 5，上限 20' }
    }),
    output: { schema: outputSchema(), render: jsonRender },
    async execute(args) {
      try {
        const store = await vendor('store');
        const q = String(args.query || '').trim();
        const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
        const key = String(ownerKey() || '');
        if (!key) return fail('还没有配置主人会话 key（settings.channel.key）', 'DSMP_NO_CHANNEL_KEY');
        const items = withDir(dirNow(), () => store.searchMessages({
          key,
          query: q,
          from: String(args.from || '').trim(),
          to: String(args.to || '').trim(),
          limit
        }));
        if (!items.length) {
          const stats = withDir(dirNow(), () => store.memoryStats());
          return ok({ count: 0, text: `没有检索到「${q || '(空)'}」对应记录（热文件 ${stats.hotFiles} / 归档 ${stats.archiveFiles}）。找不到就直说找不到，不要编。` });
        }
        const lines = items.map((it) => {
          const who = it.role === 'assistant' ? '她' : (it.sender || '主人');
          const body = String(it.text || '').replace(/\s+/g, ' ').slice(0, 600);
          return `[${it.date || it.ts}] ${who}：${body}`;
        });
        return ok({ count: items.length, text: `检索「${q}」命中 ${items.length} 条：\n${lines.join('\n')}\n（日志原文，引用时说明「查到以前的记录」，不要改写成新事实。）` });
      } catch (err) {
        return fail(`历史检索失败：${(err && err.message) || err}`, 'DSMP_TOOL_FAILED');
      }
    }
  });

  // ── recall：长期事实 ───────────────────────────────────────────────
  reg({
    name: TOOL_PREFIX + 'recall',
    description: [
      '在长期事实库里找主人说过的事实/约定（生日、喜好、答应过的事、设定等），按档位与槽位/主题/主体排序。',
      '回答关于主人偏好/约定/生日的问题之前先查这个；query 留空 = 按档位列最前面几条。',
      '每条带 ⟵ 窗口…轮… 的可用 dsmp_memory_window 展开原话；标〔自己写的〕是自己写进库的事实。查不到会给出路由诊断与下一步建议。'
    ].join('\n'),
    parameters: schema({
      query: { type: 'string', description: '关键词或整句问法，例如「我生日是什么时候」' },
      limit: { type: 'number', description: '最多返回几条，默认 8，上限 20' },
      includeInvalidated: { type: 'boolean', description: '是否包含已作废事实（默认 false）' }
    }),
    output: { schema: outputSchema(), render: jsonRender },
    async execute(args) {
      try {
        const longterm = await vendor('longterm');
        const scoringMod = await vendor('scoring-runner');
        const recall = await vendor('recall-format');
        const schedule = await vendor('schedule');
        const route = await vendor('route');
        const d = dirNow();
        const now = Date.now();
        const qtext = String(args.query || '');
        const facts = longterm.materializeWithShadow(d);
        const limit = Math.max(1, Math.min(20, Number(args.limit) || 8));
        let schedBlock = '';
        if (qtext && schedule.isScheduleQuery(qtext)) {
          const day = schedule.dayHintOf(qtext, now) || schedule.dayKey(now);
          schedBlock = schedule.scheduleAnswer(d, day, { facts }).text;
        }
        const rows = scoringMod.search({
          query: qtext,
          limit,
          now,
          scoring: scoringMod.normalizeScoring({}),
          includeInvalidated: Boolean(args.includeInvalidated),
          facts,
          match: 'smart'
        });
        if (!rows.length) {
          const diag = recall.diagnoseRecall({ query: qtext, facts, now });
          return ok({ count: 0, text: `${schedBlock ? schedBlock + '\n\n' : ''}${recall.emptyRecallText({ query: qtext, diag })}` });
        }
        const eps = recall.episodeIndex(d);
        const { body, anchors } = recall.formatRecallBody(rows, { eps, dir: d });
        const hint = recall.explainRoute(qtext);
        const taskRoute = route.routeQuery(qtext).task;
        const header = taskRoute && taskRoute.on
          ? `按待办找的（${taskRoute.label || '未来两周'}）：`
          : qtext.trim()
            ? `长期库「${qtext}」找到 ${rows.length} 条（综合排序${hint ? `；${hint}` : ''}）：`
            : `长期库命中 ${rows.length} 条：`;
        const tail = '（引用时保持一致；与主人最新的话冲突时以最新为准。带 📎 的可用 dsmp_memory_photo 看原图。）';
        void anchors;
        return ok({ count: rows.length, text: `${schedBlock ? schedBlock + '\n\n' : ''}${header}\n${body}\n${tail}` });
      } catch (err) {
        return fail(`长期库检索失败：${(err && err.message) || err}`, 'DSMP_TOOL_FAILED');
      }
    }
  });

  // ── window：按轮展开当时的窗口 ─────────────────────────────────────
  reg({
    name: TOOL_PREFIX + 'window',
    description: [
      '展开某一轮对话当时她那一侧的窗口原文：主人原话、她真正发出去的话、她当时的想法。',
      '用于 recall 行里的 ⟵ 窗口 … 轮 a–b（session 前 8 位），或情境段行尾的 #ep-xxxxxxxx-nn。',
      'sessionId 只给 8 位前缀也能找到；episodeId 给情境段短号即可，轮次范围会自动带上。'
    ].join('\n'),
    parameters: schema({
      sessionId: { type: 'string', description: '会话 id，或它的前 8 位（带 session- 也行）' },
      episodeId: { type: 'string', description: '情境段短号，如 ep-587ad2e1-42（可带 #）' },
      turnFrom: { type: 'number', description: '起始轮次（不填则由 episodeId 或最近记录决定）' },
      turnTo: { type: 'number', description: '结束轮次' },
      maxChars: { type: 'number', description: '输出上限，默认 1000，最大 4000' },
      blocks: { type: 'boolean', description: '是否附当时的窗口块原文' }
    }),
    output: { schema: outputSchema(), render: jsonRender },
    async execute(args) {
      try {
        const windowMod = await vendor('window');
        const d = dirNow();
        let sessionId = String(args.sessionId || '').trim();
        let from = Number(args.turnFrom) || 0;
        let to = Number(args.turnTo) || 0;
        let label = '';
        const episodeRef = String(args.episodeId || '').trim().replace(/^#/, '');
        if (episodeRef) {
          const episodeMod = await vendor('episode');
          const episodes = episodeMod.readEpisodes(d) || [];
          const ref = episodeRef.replace(/^ep-/, '');
          const hit = episodes.find((row) => String(row.id) === episodeRef)
            || episodes.find((row) => String(row.id).endsWith(`-${ref}`))
            || episodes.find((row) => String(row.id).includes(ref));
          if (!hit) return fail('没有找到这段情境（可能已重建或超出保留期）', 'DSMP_NO_EPISODE');
          sessionId = sessionId || String(hit.sessionId || '');
          from = from || Number(hit.turnFrom) || 0;
          to = to || Number(hit.turnTo) || 0;
          label = String(hit.title || hit.day || '');
        }
        if (!sessionId) return fail('sessionId 或 episodeId 至少给一个', 'DSMP_BAD_ARGS');
        const root = windowMod.windowRoot(d);
        const has = (sid) => {
          try { return fs.existsSync(path.join(root, sid, 'turns.jsonl')); } catch { return false; }
        };
        let resolved = sessionId;
        if (!has(resolved)) {
          let names = [];
          try { names = fs.readdirSync(root); } catch { names = []; }
          const want = sessionId.replace(/^session-/, '');
          const hits = names.filter((name) => name !== sessionId && has(name)
            && name.replace(/^session-/, '').startsWith(want));
          if (!hits.length) return fail(`没有找到会话 ${sessionId} 的窗口记录（给 8 位前缀或完整 session-… 都行）`, 'DSMP_NO_WINDOW');
          const mtime = (sid) => {
            try { return fs.statSync(path.join(root, sid, 'turns.jsonl')).mtimeMs; } catch { return 0; }
          };
          hits.sort((a, b) => mtime(b) - mtime(a));
          resolved = hits[0];
          if (hits.length > 1) label = `${label ? `${label} · ` : ''}前缀命中 ${hits.length} 个会话，取最近`;
        }
        sessionId = resolved;
        const maxChars = Math.min(4000, Math.max(200, Number(args.maxChars) || 1000));
        const rows = windowMod.readTurns(d, sessionId, { limit: 500 });
        const picked = rows.filter((row) => {
          const n = Number(row && row.turn) || 0;
          if (from && n < from) return false;
          if (to && n > to) return false;
          return true;
        }).slice(0, 6);
        if (!picked.length) return fail('这个会话没有对应轮次的窗口记录（可能早于账本上线）', 'DSMP_NO_WINDOW');
        let used = 0;
        const lines = [];
        for (const row of picked) {
          const at = new Date(Number(row.at) || Date.now());
          const hh = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
          let line = `第 ${row.turn} 轮 ${hh}\n主人：${String((row.userRaw && row.userRaw.text) || '')}`;
          for (const sp of row.spoken || []) line += `\n（她说）${String(sp && sp.text || '')}`;
          if (row.reply && row.reply.text) line += `\n（当时的想法）${String(row.reply.text)}`;
          if (args.blocks) {
            try {
              const full = windowMod.readWindowText(d, row);
              if (full) line += '\n──── 当时窗口 ────\n' + full;
            } catch { /* 块缺失忽略 */ }
          }
          if (used + line.length > maxChars) line = line.slice(0, Math.max(0, maxChars - used - 1)) + '…';
          used += line.length;
          lines.push(line);
          if (used >= maxChars) break;
        }
        return ok({ count: lines.length, text: `会话 ${sessionId.replace(/^session-/, '').slice(0, 8)}${label ? `（${label}）` : ''}${from || to ? ` · 第 ${from || '…'}–${to || '…'} 轮` : ''} 的窗口原文：\n\n${lines.join('\n\n')}\n\n（按当时语境引用，不要当成现在的话。）` });
      } catch (err) {
        return fail(`窗口展开失败：${(err && err.message) || err}`, 'DSMP_TOOL_FAILED');
      }
    }
  });

  // ── write：她自己写一条事实 ────────────────────────────────────────
  reg({
    name: TOOL_PREFIX + 'write',
    description: [
      '把自己想长期记住的一条事实写进长期库（第一人称，2–60 字；细节放 text）。不是写日记，一次只写一条。',
      '只有 DSMP 持有记忆写者租约时才能写；写前会校验配额、重复与分类。dryRun=true 只校验不落盘。'
    ].join('\n'),
    parameters: schema({
      value: { type: 'string', description: '一句话（2–60 字），会进事实卡' },
      text: { type: 'string', description: '更完整的说明（≤400 字），只在检索命中时逐字给出' },
      topicId: { type: 'string', description: '主题 id，如 t-identity / t-photo' },
      slot: { type: 'string', description: '槽位，如 identity/pref/plan/event/note' },
      kind: { type: 'string', description: 'fact/pref/stance/plan/progress/event/note' },
      quote: { type: 'string', description: '原话引文（可选，必须在当前这一轮里能查到）' },
      dryRun: { type: 'boolean', description: '只校验，不落盘' }
    }, ['value']),
    output: { schema: outputSchema(), render: jsonRender },
    async execute(args) {
      if (!canWrite()) return fail('现在不是 DSMP 在写记忆（租约不在本机），写入口已锁', 'DSMP_NOT_WRITER');
      try {
        const selfWrite = await vendor('self-write');
        const d = dirNow();
        const key = String(ownerKey() || '');
        // 配额/字数上限以面板设置为准（默认 20 条/天、总量 600），不再落引擎默认的 5/300。
        const cfg = (getSettings() || {}).memory?.selfWrite || {};
        if (args.dryRun === true) {
          const v = selfWrite.validateSelfWrite({ ...args, sessionId: '', turn: 0 }, { dir: d, now: Date.now(), cfg });
          if (!v.ok) return fail(v.message, v.code || 'DSMP_WRITE_REJECTED');
          return ok({ dryRun: true, text: `校验通过：${v.value}（主题 ${v.topicName || v.topicId} · 槽位 ${v.slot}）` });
        }
        const res = selfWrite.writeSelfFact({ ...args, sessionId: '', turn: 0 }, { dir: d, key, now: Date.now(), cfg });
        if (!res.ok) return fail(res.message, res.code || 'DSMP_WRITE_REJECTED');
        const stats = selfWrite.selfStats(d);
        return ok({ action: res.action, fact: res.fact || null, text: `${res.message}（今天第 ${stats.today} 条，共 ${stats.total} 条）` });
      } catch (err) {
        return fail(`写入失败：${(err && err.message) || err}`, 'DSMP_TOOL_FAILED');
      }
    }
  });

  // ── edit：修订一条事实 ─────────────────────────────────────────────
  reg({
    name: TOOL_PREFIX + 'edit',
    description: '修订长期库里的一条事实（只改值/说明/有效期，旧值留在历史里）。id 形如 h-20261107-xxxxxx，可从 dsmp_memory_recall 的结果里取。',
    parameters: schema({
      id: { type: 'string', description: '事实 id' },
      value: { type: 'string', description: '新的值' },
      text: { type: 'string', description: '新的说明' },
      validUntil: { type: 'string', description: '新的有效期（ISO 或毫秒时间戳）' },
      reason: { type: 'string', description: '为什么改' }
    }, ['id']),
    output: { schema: outputSchema(), render: jsonRender },
    async execute(args) {
      if (!canWrite()) return fail('现在不是 DSMP 在写记忆（租约不在本机），写入口已锁', 'DSMP_NOT_WRITER');
      try {
        const revise = await vendor('revise');
        const d = dirNow();
        const res = revise.reviseFact(d, String(args.id || ''), {
          value: args.value,
          text: args.text,
          validUntil: args.validUntil,
          reason: args.reason
        }, { by: 'self', role: 'self' });
        if (!res.ok) return fail(res.reason || '修订失败', res.code || 'DSMP_EDIT_FAILED');
        return ok({ action: res.action, before: res.before, after: res.after, text: '改好了，旧值留在历史里。' });
      } catch (err) {
        return fail(`修订失败：${(err && err.message) || err}`, 'DSMP_TOOL_FAILED');
      }
    }
  });

  // ── photo：按 sha1 取回记忆里的图 ─────────────────────────────────
  reg({
    name: TOOL_PREFIX + 'photo',
    description: '按 sha1 取回记忆里的一张原图（recall/window 行尾 📎 里的 sha1）。取回的是当时收到的原图，按当时语境引用。',
    parameters: schema({ sha1: { type: 'string', description: '40 位 sha1' } }, ['sha1']),
    output: {
      schema: outputSchema(),
      render(_args, value) {
        if (!value || !value.ok) return text((value && value.error) || '取图失败');
        const blocks = text(value.text || '');
        if (value.attachment) blocks.push({ type: 'image', attachment: value.attachment });
        return blocks;
      }
    },
    async execute(args) {
      try {
        const media = await vendor('media');
        const d = dirNow();
        const sha1 = String(args.sha1 || '').trim().toLowerCase();
        if (!/^[0-9a-f]{40}$/.test(sha1)) return fail('sha1 格式不对', 'DSMP_BAD_ARGS');
        const found = media.readMedia(d, sha1);
        if (!found) return fail('这张图片没有留在记忆里', 'DSMP_MEDIA_MISSING');
        if (!attachments || typeof attachments.saveImages !== 'function') {
          return ok({ sha1, bytes: found.buffer.length, text: `找到了这张图（${found.buffer.length} 字节），但当前宿主不支持图片附件，无法显示。` });
        }
        const [ref] = await attachments.saveImages([{ data: found.buffer, mediaType: found.mimeType, name: `${sha1.slice(0, 12)}.${String(found.mimeType || '').split('/')[1] || 'png'}` }]);
        return ok({ sha1, bytes: found.buffer.length, attachment: ref, text: '这是当时收到的原图。' });
      } catch (err) {
        return fail(`取图失败：${(err && err.message) || err}`, 'DSMP_TOOL_FAILED');
      }
    }
  });

  // ── todo：待办 ─────────────────────────────────────────────────────
  reg({
    name: TOOL_PREFIX + 'todo',
    description: '看待办（默认 list，按到期日排）或把一条待办标成做完/取消（done / cancel，需 id）。',
    parameters: schema({
      action: { type: 'string', enum: ['list', 'done', 'cancel'], description: 'list（默认）/ done / cancel' },
      id: { type: 'string', description: '待办 id（done/cancel 必填）' },
      limit: { type: 'number', description: 'list 最多返回几条，默认 20' },
      includeDone: { type: 'boolean', description: 'list 是否包含已完成' }
    }),
    output: { schema: outputSchema(), render: jsonRender },
    async execute(args) {
      try {
        const tasks = await vendor('tasks');
        const d = dirNow();
        const action = String(args.action || 'list').toLowerCase();
        if (action === 'list') {
          const list = tasks.listTasks(d, { now: Date.now(), limit: Number(args.limit) || 20, includeDone: Boolean(args.includeDone) });
          return ok({ tasks: list.items, total: list.total, text: tasks.tasksText(list, { label: '现在记着的待办' }) });
        }
        if (!canWrite()) return fail('现在不是 DSMP 在写记忆（租约不在本机），改待办被锁', 'DSMP_NOT_WRITER');
        if (action !== 'done' && action !== 'cancel') return fail('action 只能是 list / done / cancel', 'DSMP_BAD_ARGS');
        const res = tasks.finishTask(d, String(args.id || '').trim(), { status: action === 'done' ? 'done' : 'cancelled', by: 'self' });
        if (!res.ok) return fail(res.message || '改待办失败', res.code || 'DSMP_TODO_FAILED');
        return ok({ action: res.action, text: res.message || '改好了' });
      } catch (err) {
        return fail(`待办操作失败：${(err && err.message) || err}`, 'DSMP_TOOL_FAILED');
      }
    }
  });

  logger(`[dsmp] 已注册 ${disposers.length} 个原生记忆工具（${TOOL_PREFIX}*）`);
  return disposers;
}

export const TOOL_NAMES = ['search', 'recall', 'window', 'write', 'edit', 'photo', 'todo'].map((n) => TOOL_PREFIX + n);
