import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Read-only projections of the memory directory, ported from the old standalone
 * workbench (7351). Everything here is pure: given a dir, return plain objects.
 * Nothing writes — writes stay behind explicit /api/dsmp/workbench/* endpoints.
 */

// The dev-reload helper imports this file from a data: URL, where import.meta.url
// is not a file path — so the host passes the vendor directory in explicitly.
let VENDOR_SRC = '';
let LIB_DIR = '';
export function configureWorkbench({ vendorDir, libDir } = {}) {
  if (vendorDir) VENDOR_SRC = String(vendorDir);
  if (libDir) LIB_DIR = String(libDir);
}

// Same trick as vendor(): this module can be imported from a data: URL while the
// plugin hot-reloads, so relative imports are not available. The host hands us
// lib/ explicitly and we import by absolute file URL (mtime-busted).
const libCache = new Map();
async function lib(name) {
  if (!LIB_DIR) return null;
  if (!libCache.has(name)) {
    const file = path.join(LIB_DIR, name);
    const base = pathToFileURL(file).href;
    let url = base;
    try {
      url = `${base}?v=${fs.statSync(file).mtimeMs}`;
    } catch {
      /* keep the plain URL */
    }
    libCache.set(name, import(url).catch(() => null));
  }
  return libCache.get(name);
}
function vendorSrc() {
  return VENDOR_SRC || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'vendor', 'memory', 'src');
}

const cache = new Map();

async function vendor(name) {
  if (!cache.has(name)) {
    const file = path.join(vendorSrc(), name);
    const base = pathToFileURL(file).href;
    // Bundle off/on re-imports state.js but not the vendor modules it pulled in;
    // bust the ESM cache by mtime so engine fixes show up without a DSH restart.
    let url = base;
    try {
      url = `${base}?v=${fs.statSync(file).mtimeMs}`;
    } catch {
      /* keep the plain URL */
    }
    cache.set(name, import(url));
  }
  return cache.get(name);
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      /* skip a half-written line */
    }
  }
  return out;
}

function tsMs(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export async function factsView(dir) {
  const { openIndex } = await vendor('longterm.mjs');
  const { readTopics, SLOT_LABEL, topicById } = await vendor('topics.mjs');
  const { describeImportance, compareImportance } = await vendor('importance.mjs');
  const { normalizeConfig } = await vendor('score.mjs');
  const cfg = normalizeConfig({});
  const now = Date.now();
  const facts = openIndex(dir).facts();
  const topics = readTopics(dir);
  let tomb = {};
  try {
    tomb = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'facts-invalidated.json'), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    tomb = {};
  }
  const rows = facts
    .map((fact) => {
      const topic = fact.topicId ? topicById(topics, fact.topicId) : null;
      const imp = describeImportance(fact, now, cfg);
      const at = fact.at || fact.saidAt || fact.createdAt || '';
      return {
        id: fact.id,
        value: fact.value || fact.text || '',
        text: fact.text || '',
        kind: fact.kind || '',
        slot: fact.slot || '',
        slotLabel: fact.slot ? SLOT_LABEL[fact.slot] || fact.slot : '',
        topicId: fact.topicId || '',
        topicTitle: (topic && (topic.title || topic.name || topic.id)) || '',
        author: fact.author || 'extract',
        tier: fact.tier || '',
        hits: Number(fact.hits) || 0,
        I: Number(fact.I ?? fact.importance ?? 0),
        score: imp.score,
        grade: imp.grade,
        gradeLabel: imp.gradeLabel,
        gradeColor: imp.gradeColor,
        weight: imp.weight,
        retention: imp.retention,
        lastAt: fact.lastAt || 0,
        ageDays: Math.max(0, Math.round(((now - (Number(fact.lastAt) || Number(at) || now)) / 86400000) * 10) / 10),
        at,
        atMs: tsMs(at),
        expired: Boolean(fact.expired),
        invalidated: Boolean(tomb[fact.id])
      };
    })
    .sort(compareImportance);
  const activeRows = rows.filter((row) => !row.expired && !row.invalidated);
  const grades = { core: 0, important: 0, normal: 0, edge: 0 };
  for (const row of activeRows) grades[row.grade] = (grades[row.grade] || 0) + 1;
  return {
    ok: true,
    dir,
    count: rows.length,
    active: activeRows.length,
    expired: rows.filter((row) => row.expired).length,
    invalidated: rows.filter((row) => row.invalidated).length,
    grades,
    sort: 'score',
    rows
  };
}

export async function topicsView(dir) {
  const { readTopics, SLOT_LABEL } = await vendor('topics.mjs');
  const { openIndex, readInvalidated } = await vendor('longterm.mjs');
  const topics = readTopics(dir);
  const facts = openIndex(dir).facts();
  let tomb = {};
  try {
    tomb = readInvalidated(dir) || {};
  } catch {
    tomb = {};
  }
  const byTopic = new Map();
  let orphans = 0;
  for (const fact of facts) {
    if (!fact.topicId) {
      orphans += 1;
      continue;
    }
    if (!byTopic.has(fact.topicId)) byTopic.set(fact.topicId, []);
    byTopic.get(fact.topicId).push(fact);
  }
  const rows = topics.map((topic) => {
    const list = (byTopic.get(topic.id) || [])
      .slice()
      .sort((a, b) => (Number(b.lastAt) || tsMs(b.at) || 0) - (Number(a.lastAt) || tsMs(a.at) || 0));
    const slotMap = new Map();
    for (const fact of list) {
      const slot = String(fact.slot || '');
      if (!slotMap.has(slot)) slotMap.set(slot, []);
      slotMap.get(slot).push(fact);
    }
    // §5.2 主题簇：同槽留最新、多值并列、超出部分标数；空槽不单列。
    const slots = [...slotMap.entries()]
      .map(([slot, arr]) => {
        const items = arr.slice(0, 3).map((fact) => ({
          id: fact.id,
          value: fact.value || fact.text || '',
          author: fact.author || 'extract',
          tier: fact.tier || '',
          expired: Boolean(fact.expired),
          invalidated: Boolean(tomb[fact.id])
        }));
        return {
          slot,
          label: SLOT_LABEL[slot] || slot || '未分槽',
          count: arr.length,
          multi: arr.length > 1,
          items,
          capped: Math.max(0, arr.length - items.length)
        };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh'));
    return {
      id: topic.id,
      title: topic.name || topic.title || topic.id,
      parent: topic.parentId || topic.parent || '',
      facts: list.length,
      slots,
      multiSlots: slots.filter((row) => row.multi).length
    };
  });
  return {
    ok: true,
    count: topics.length,
    orphans,
    slotLabels: SLOT_LABEL,
    rows
  };
}

export async function windowView(dir, sessionId, limit = 60, { from = 0, to = 0 } = {}) {
  const { readTurns } = await vendor('window.mjs');
  const turns = readTurns(dir, sessionId) || [];
  const ranged = from || to
    ? turns.filter((turn) => {
      const n = Number(turn && turn.turn) || 0;
      if (from && n < from) return false;
      if (to && n > to) return false;
      return true;
    })
    : turns;
  const slice = ranged.slice(-limit);
  return {
    ok: true,
    sessionId,
    total: turns.length,
    matched: ranged.length,
    from: from || 0,
    to: to || 0,
    turns: slice.map((turn) => ({
      turn: turn.turn,
      at: turn.at || turn.ts || '',
      key: turn.key || '',
      model: turn.model || '',
      owner: (turn.userRaw && turn.userRaw.text) || turn.ownerText || '',
      spoken: (Array.isArray(turn.spoken) ? turn.spoken : [])
        .map((row) => (typeof row === 'string' ? row : row && row.text))
        .filter(Boolean)
        .join('\n'),
      thought: (turn.reply && turn.reply.text) || '',
      replyChars: (turn.reply && turn.reply.text) ? String(turn.reply.text).length : 0,
      // Feels are <PERSONA>'s hidden asides: they never enter the card or QQ, so the
      // panel is one of the few places a human can read them (§5.2 window depth).
      feels: (Array.isArray(turn.feels) ? turn.feels : [])
        .map((row) => ({ text: String((row && row.text) || ''), src: String((row && row.src) || 'reply') }))
        .filter((row) => row.text),
      blocks: Array.isArray(turn.window && turn.window.blocks) ? turn.window.blocks.length : 0,
      media: Array.isArray(turn.mediaRefs) ? turn.mediaRefs.length : 0,
      mediaRefs: (Array.isArray(turn.mediaRefs) ? turn.mediaRefs : []).map((row) => ({
        sha1: row && row.sha1,
        kind: row && row.kind,
        mime: row && row.mime,
        alt: (row && row.alt) || ''
      })).filter((row) => row.sha1)
    }))
  };
}

export async function episodesView(dir, { day = '', limit = 5 } = {}) {
  const root = path.join(dir, 'episodes');
  if (!fs.existsSync(root)) return { ok: true, count: 0, episodes: [] };
  const files = fs
    .readdirSync(root)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .slice(day ? undefined : -limit);
  const episodes = [];
  for (const name of files) {
    for (const row of readJsonl(path.join(root, name))) {
      if (day && !String(row.id || '').includes(day)) continue;
      // Real episode rows store the narrative as title/scene plus a summarized
      // flag; older/portable rows may carry a single `summary` string. Accept
      // both instead of always landing on "（未摘要）".
      const title = String(row.title || '').trim();
      const scene = String(row.scene || '').trim();
      const summary = String(row.summary || '').trim() || [title, scene].filter(Boolean).join('：');
      const at = row.atTo || row.atFrom || row.at || row.createdAt || '';
      episodes.push({
        id: row.id,
        day: row.day || String(row.id || '').slice(3, 13),
        at,
        sessionId: row.sessionId || '',
        turns: [row.turnFrom, row.turnTo],
        title,
        scene,
        topics: Array.isArray(row.topics) ? row.topics.slice(0, 8) : [],
        summarized: row.summarized !== false && !!summary,
        summary,
        facts: Array.isArray(row.facts) ? row.facts.length : 0
      });
    }
  }
  episodes.sort((a, b) => tsMs(b.at) - tsMs(a.at));
  return { ok: true, count: episodes.length, episodes: episodes.slice(0, 200) };
}

/**
 * 消费账单（对齐旧 7351 /api/usage）：
 * - 只统计 k=turn 的逐轮采样；k=base 是会话基线快照，不是消费。
 * - 金额用 lib/price-table.js 按模型 + 时刻（峰谷/节假日）现算，不读 row.cost。
 * - 轮次类型（owner/wake/unknown/setup）由窗口账本的 turn 是否有主人原话判定。
 * - 过滤顺序：days → scope；session/turn 只影响按天/按模型/总计，不影响 scopes/bySession/byKind，
 *   这样筛选某会话时其它会话仍能出现在下拉和占比里。
 */
export async function usageView(dir, { days = 14, scope = 'all', session = 'all', turn = 'all' } = {}) {
  const priceMod = await lib('price-table.js');
  const totalDays = Math.max(1, Math.min(90, Number(days) || 14));
  const scopePick = String(scope || 'all');
  const sessionPick = String(session || 'all');
  const turnPick = String(turn || 'all');
  const since = Date.now() - totalDays * 86400000;
  const raw = readJsonl(path.join(dir, 'logs', 'token-usage.jsonl'));
  const dayKey = (ms) => {
    try {
      return new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    } catch {
      return new Date(ms).toISOString().slice(0, 10);
    }
  };
  const costOf = (model, at, buckets) => {
    if (!priceMod || typeof priceMod.priceUsage !== 'function') return 0;
    try {
      const p = priceMod.priceUsage(buckets, { model, at: Number(at) || 0 });
      return (p.cost && p.cost.total) || 0;
    } catch {
      return 0;
    }
  };

  // 轮次类型：窗口账本里 synthetic / 无主人原话的轮 → 唤醒/派生。
  const ledger = new Map();
  let windowNames = [];
  try {
    windowNames = fs.readdirSync(path.join(dir, 'window'));
  } catch {
    windowNames = [];
  }
  for (const name of windowNames) {
    if (!/^session-/.test(name)) continue;
    const m = new Map();
    for (const row of readJsonl(path.join(dir, 'window', name, 'turns.jsonl'))) {
      m.set(Number(row.turn), !!(row.userRaw && String(row.userRaw.text || '').trim()));
    }
    if (m.size) ledger.set(name, m);
  }
  const kindOf = (row) => {
    if (row.turn == null) return 'setup';
    const m = ledger.get(String(row.sid || ''));
    if (!m || !m.has(Number(row.turn))) return 'unknown';
    return m.get(Number(row.turn)) ? 'owner' : 'wake';
  };

  const scopes = new Map();
  const sessionAgg = new Map();
  const byKind = new Map();
  const totals = { calls: 0, cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0, cost: 0, tokens: 0, hitRate: 0 };
  const byDay = new Map();
  const byModel = new Map();
  let baselineRows = 0;

  for (const row of raw) {
    const b = row && (row.b || row.buckets);
    if (!b) continue;
    if (String(row.k || '') !== 'turn') {
      baselineRows += 1;
      continue;
    }
    const hit = Number(b.cacheHit) || 0;
    const miss = Number(b.cacheMiss) || 0;
    const write = Number(b.cacheWrite) || 0;
    const out = Number(b.output) || 0;
    const at = Number(row.t) || tsMs(row.at || row.ts || row.time);
    if (!at || at < since) continue;
    const cost = costOf(row.model, at, { cacheHit: hit, cacheMiss: miss, cacheWrite: write, output: out });
    const tokens = hit + miss + write + out;
    const key = String(row.key || '(none)');
    const sid = String(row.sid || '(none)');
    const kind = kindOf(row);

    const sc = scopes.get(key) || { key, calls: 0, tokens: 0, cost: 0 };
    sc.calls += 1;
    sc.tokens += tokens;
    sc.cost += cost;
    scopes.set(key, sc);
    if (scopePick !== 'all' && key !== scopePick) continue;

    const kk = byKind.get(kind) || { kind, calls: 0, tokens: 0, cost: 0 };
    kk.calls += 1;
    kk.tokens += tokens;
    kk.cost += cost;
    byKind.set(kind, kk);

    const ss = sessionAgg.get(sid) || {
      sessionId: sid,
      calls: 0,
      tokens: 0,
      cost: 0,
      ownerCost: 0,
      wakeCost: 0,
      unknownCost: 0
    };
    ss.calls += 1;
    ss.tokens += tokens;
    ss.cost += cost;
    if (kind === 'owner') ss.ownerCost += cost;
    else if (kind === 'wake') ss.wakeCost += cost;
    else if (kind === 'unknown') ss.unknownCost += cost;
    sessionAgg.set(sid, ss);

    if (sessionPick !== 'all' && sid !== sessionPick) continue;
    if (turnPick !== 'all' && kind !== turnPick) continue;

    const day = dayKey(at);
    const d = byDay.get(day) || { day, calls: 0, cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0, cost: 0 };
    d.calls += 1;
    d.cacheHit += hit;
    d.cacheMiss += miss;
    d.cacheWrite += write;
    d.output += out;
    d.cost += cost;
    byDay.set(day, d);

    const model = String(row.model || 'unknown');
    const m = byModel.get(model) || { model, calls: 0, tokens: 0, cost: 0 };
    m.calls += 1;
    m.tokens += tokens;
    m.cost += cost;
    byModel.set(model, m);

    totals.calls += 1;
    totals.cacheHit += hit;
    totals.cacheMiss += miss;
    totals.cacheWrite += write;
    totals.output += out;
    totals.cost += cost;
  }

  const totalIn = totals.cacheHit + totals.cacheMiss + totals.cacheWrite;
  totals.tokens = totalIn + totals.output;
  totals.hitRate = totalIn ? totals.cacheHit / totalIn : 0;

  // 记忆侧模型用量：logs/memory-usage.jsonl（caller = handover/profile/extract/episode/entry）
  const memRaw = readJsonl(path.join(dir, 'logs', 'memory-usage.jsonl'));
  const memByCaller = new Map();
  const memTotals = { calls: 0, fail: 0, input: 0, cacheHit: 0, output: 0, cost: 0 };
  for (const row of memRaw) {
    const at = Number(row.t) || tsMs(row.at);
    if (!at || at < since) continue;
    const u = row.usage || {};
    const hit = Number(u.cache_read_input_tokens) || 0;
    const miss = Number(u.input_tokens) || 0;
    const write = Number(u.cache_creation_input_tokens) || 0;
    const out = Number(u.output_tokens) || 0;
    const cost = costOf(row.model, at, { cacheHit: hit, cacheMiss: miss, cacheWrite: write, output: out });
    const caller = String(row.caller || 'model');
    const item = memByCaller.get(caller) || { caller, calls: 0, fail: 0, input: 0, cacheHit: 0, output: 0, cost: 0 };
    item.calls += 1;
    if (row.ok === false) item.fail += 1;
    item.input += miss;
    item.cacheHit += hit;
    item.output += out;
    item.cost += cost;
    memByCaller.set(caller, item);
    memTotals.calls += 1;
    if (row.ok === false) memTotals.fail += 1;
    memTotals.input += miss;
    memTotals.cacheHit += hit;
    memTotals.output += out;
    memTotals.cost += cost;
  }

  return {
    ok: true,
    days: totalDays,
    scope: scopePick,
    session: sessionPick,
    turn: turnPick,
    totals,
    baselineRows,
    scopes: [...scopes.values()].sort((a, b) => b.cost - a.cost),
    bySession: [...sessionAgg.values()].sort((a, b) => b.cost - a.cost),
    byKind: [...byKind.values()].sort((a, b) => b.cost - a.cost),
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byModel: [...byModel.values()].sort((a, b) => b.tokens - a.tokens),
    memory: {
      totals: memTotals,
      byCaller: [...memByCaller.values()].sort((a, b) => b.cost - a.cost)
    },
    priceVersion: (priceMod && priceMod.PRICE_TABLE_VERSION) || ''
  };
}

export async function recallView(dir, query, { limit = 10 } = {}) {
  const [{ search }, { explainRoute }, { routeQuery }] = await Promise.all([
    vendor('scoring-runner.mjs'),
    vendor('recall-format.mjs'),
    vendor('route.mjs')
  ]);
  const q = String(query || '');
  const n = Math.max(1, Math.min(20, Number(limit) || 10));
  let rows = [];
  try {
    rows = search({ dir, query: q, limit: n, match: 'smart' });
  } catch (err) {
    return { ok: false, query: q, limit: n, count: 0, rows: [], error: String((err && err.message) || err) };
  }
  let route = null;
  let explain = null;
  try {
    route = routeQuery(q);
  } catch {
    route = null;
  }
  try {
    explain = explainRoute(q);
  } catch {
    explain = null;
  }
  return { ok: true, query: q, limit: n, count: rows.length, route, explain, rows };
}

export async function claimsView(dir) {
  const rows = readJsonl(path.join(dir, 'state', 'claims.jsonl')).filter(
    (row) => !row.status || row.status === 'pending'
  );
  return { ok: true, count: rows.length, rows: rows.slice(-20).reverse() };
}

/* ---------------- 7351 移植：新增只读投影 ---------------- */

export async function windowSessionListView(dir) {
  const root = path.join(dir, 'window');
  if (!fs.existsSync(root)) return { ok: true, count: 0, sessions: [] };
  const sessions = [];
  for (const name of fs.readdirSync(root)) {
    if (!name.startsWith('session-')) continue;
    const folder = path.join(root, name);
    try {
      if (!fs.statSync(folder).isDirectory()) continue;
    } catch {
      continue;
    }
    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(path.join(folder, 'meta.json'), 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      meta = {};
    }
    const rows = readJsonl(path.join(folder, 'turns.jsonl'));
    const last = rows[rows.length - 1] || {};
    sessions.push({
      sessionId: name,
      key: meta.key || last.key || '',
      turns: rows.length,
      lastAt: rows.reduce((max, row) => Math.max(max, tsMs(row.at || row.ts)), 0),
      startedAt: meta.startedAt || tsMs((rows[0] || {}).at || (rows[0] || {}).ts)
    });
  }
  sessions.sort((a, b) => b.lastAt - a.lastAt);
  return { ok: true, count: sessions.length, sessions };
}

/**
 * 事实卡预览 —— 与线上注入同源：注入走 memory-context.buildFactCard →
 * vendor/card-tree.buildTreeCard。这里复刻同一调用（openIndex().facts() +
 * readTopics + buildTreeCard），所以预览长度/收录数和真实首屏一致。
 */
export async function cardView(dir, { maxChars = 1500 } = {}) {
  const want = Math.max(200, Math.min(8000, Math.round(Number(maxChars) || 1500)));
  const [{ openIndex }, { readTopics }, { buildTreeCard }] = await Promise.all([
    vendor('longterm.mjs'),
    vendor('topics.mjs'),
    vendor('card-tree.mjs')
  ]);
  const facts = openIndex(dir).facts();
  const topics = readTopics(dir);
  const built = buildTreeCard(facts, { maxChars: want }, topics);
  return {
    ok: true,
    maxChars: want,
    chars: built.chars,
    included: (built.included || []).length,
    dropped: (built.dropped || []).length,
    droppedIds: (built.dropped || []).slice(0, 30).map((fact) => fact.id),
    groups: (built.groups || []).length,
    facts: facts.length,
    text: built.text || ''
  };
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function tailOf(file, bytes) {
  try {
    const st = fs.statSync(file);
    const len = Math.min(bytes, st.size);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

/**
 * 上下文与轮转：按会话汇总最近几轮的真实 prompt tokens（logs/token-usage.jsonl
 * 的 k:'turn' 行），给出阈值与占用率。轮转本身仍由 bridge 执行，这里只读。
 */
export async function contextView(dir, {
  windowTokens = 0,
  contextWindowTokens = 0,
  thresholdRatio = 0.7,
  handoverMaxChars = 0,
  windowDays = 7,
  dailyAt = ''
} = {}) {
  const memory = readJsonFile(path.join(dir, 'state', 'memory.json'), {});
  const own = new Map();
  const byKey = new Map();
  for (const line of tailOf(path.join(dir, 'logs', 'token-usage.jsonl'), 600_000).split('\n')) {
    if (!line.includes('"k":"turn"')) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.k !== 'turn' || !row.b) continue;
    const value = Number(row.b.cacheMiss || 0) + Number(row.b.cacheHit || 0);
    if (!value) continue;
    if (row.sid) {
      if (!own.has(row.sid)) own.set(row.sid, []);
      own.get(row.sid).push(value);
    }
    if (row.key) {
      if (!byKey.has(row.key)) byKey.set(row.key, []);
      byKey.get(row.key).push({ sid: row.sid || '', value });
    }
  }
  const tokenOf = (sid, key) => {
    const list = (own.get(sid) || []).slice(-5);
    if (list.length) return { latest: list[list.length - 1], max5: Math.max(...list), rounds: (own.get(sid) || []).length, stale: false };
    // 映射会话还没有真实回合（轮转后新会话/映射失效）：退回同 key 最近的会话。
    const rows = (byKey.get(key) || []).slice(-5);
    if (rows.length) {
      return { latest: rows[rows.length - 1].value, max5: Math.max(...rows.map((r) => r.value)), rounds: 0, stale: rows[rows.length - 1].sid !== sid };
    }
    return { latest: 0, max5: 0, rounds: 0, stale: false };
  };
  const sessions = [];
  for (const [key, rec] of Object.entries(memory.sessions || {})) {
    if (!rec || typeof rec !== 'object') continue;
    const sid = String(rec.sessionId || '');
    const rows = sid ? readJsonl(path.join(dir, 'window', sid, 'turns.jsonl')) : [];
    const tok = tokenOf(sid, key);
    sessions.push({
      key,
      sessionId: sid,
      startedAt: rec.startedAt || 0,
      tokens: tok.latest,
      max5: tok.max5,
      rounds: tok.rounds,
      stale: tok.stale,
      turns: rows.length,
      lastAt: rows.reduce((max, row) => Math.max(max, tsMs(row.at || row.ts)), 0),
      policy: rec.policy || '',
      folded: Boolean(rec.folded),
      foldedReason: String(rec.foldedReason || '')
    });
  }
  const base = Number(contextWindowTokens) || Number(windowTokens) || 0;
  const ratio = Math.max(0.1, Math.min(0.95, Number(thresholdRatio) || 0.7));
  const threshold = base ? Math.round(base * ratio) : 0;
  for (const row of sessions) {
    row.pct = threshold ? Math.round((row.max5 / threshold) * 1000) / 10 : 0;
    row.over = Boolean(threshold && row.max5 >= threshold);
  }
  sessions.sort((a, b) => (b.lastAt || b.startedAt || 0) - (a.lastAt || a.startedAt || 0));
  return {
    ok: true,
    windowTokens: base,
    threshold,
    ratio,
    handoverMaxChars,
    windowDays,
    dailyAt,
    owner: memory.owner || '',
    lastDailyAt: memory.lastDailyAt || 0,
    sessions
  };
}

/** 概览：一句话回答“记忆现在健康吗、有多少东西、最后一次日终什么时候”。 */
export async function overviewView(dir) {
  const { openIndex, readInvalidated } = await vendor('longterm.mjs');
  const facts = openIndex(dir).facts();
  const invalidated = Object.keys(readInvalidated(dir) || {}).length;
  const topics = readJsonl(path.join(dir, 'state', 'topics.jsonl'));
  const episodes = [];
  try {
    for (const name of fs.readdirSync(path.join(dir, 'episodes'))) {
      if (name.endsWith('.jsonl')) episodes.push(...readJsonl(path.join(dir, 'episodes', name)));
    }
  } catch {
    /* no episodes yet */
  }
  const sessions = await windowSessionListView(dir);
  const media = readJsonl(path.join(dir, 'state', 'media.jsonl'));
  const voice = readJsonl(path.join(dir, 'state', 'voice.jsonl'));
  const claims = readJsonl(path.join(dir, 'state', 'claims.jsonl')).filter((row) => !row.status || row.status === 'pending');
  const memory = readJsonFile(path.join(dir, 'state', 'memory.json'), {});
  const sizes = {};
  for (const name of ['longterm.jsonl', 'topics.jsonl', 'media.jsonl', 'voice.jsonl']) {
    try {
      sizes[name] = fs.statSync(path.join(dir, 'state', name)).size;
    } catch {
      sizes[name] = 0;
    }
  }
  try {
    sizes.episodes = fs.readdirSync(path.join(dir, 'episodes')).reduce((sum, name) => {
      try {
        return sum + (name.endsWith('.jsonl') ? fs.statSync(path.join(dir, 'episodes', name)).size : 0);
      } catch {
        return sum;
      }
    }, 0);
  } catch {
    sizes.episodes = 0;
  }
  return {
    ok: true,
    facts: {
      total: facts.length,
      active: facts.filter((fact) => !fact.expired).length,
      expired: facts.filter((fact) => fact.expired).length,
      invalidated,
      byTier: facts.reduce((map, fact) => ((map[fact.tier || 'general'] = (map[fact.tier || 'general'] || 0) + 1), map), {})
    },
    topics: topics.length,
    episodes: episodes.length,
    window: { sessions: sessions.count, turns: sessions.sessions.reduce((sum, row) => sum + row.turns, 0) },
    media: { images: media.length, voice: voice.length },
    claims: claims.length,
    memory: { owner: memory.owner || '', lastDailyAt: memory.lastDailyAt || 0, nextTurn: memory.nextTurn || 0, rotatedAt: memory.rotatedAt || 0 },
    sizes
  };
}

/** 关系图：事实—主体—主题—日期的只读派生（不参与检索）。 */
export async function graphView(dir, { maxFacts = 240 } = {}) {
  const [{ openIndex }, { readTopics, topicById }, { describeImportance }, { normalizeConfig }] = await Promise.all([
    vendor('longterm.mjs'),
    vendor('topics.mjs'),
    vendor('importance.mjs'),
    vendor('score.mjs')
  ]);
  const cfg = normalizeConfig({});
  const now = Date.now();
  const topics = readTopics(dir);
  const all = openIndex(dir).facts();
  const list = all
    .map((fact) => ({ fact, imp: describeImportance(fact, now, cfg) }))
    .sort((a, b) => b.imp.score - a.imp.score)
    .slice(0, Math.max(20, Math.min(600, maxFacts)));
  const nodes = [];
  const links = [];
  const seen = new Set();
  const add = (node) => {
    if (!seen.has(node.id)) {
      seen.add(node.id);
      nodes.push(node);
    }
    return node.id;
  };
  const abouts = new Set(list.map(({ fact }) => (fact.about === 'bot' ? 'bot' : 'user')));
  if (abouts.has('user')) add({ id: 'p:user', type: 'person', label: '主人', size: 30 });
  if (abouts.has('bot')) add({ id: 'p:bot', type: 'person', label: '<PERSONA>', size: 30 });

  // 与旧 7351 buildGraph 同一套「认不出主题就看正文关键词」的归类；只影响图，不写库。
  const TOPIC_RULES = [
    ['生日', /生日|寿|蛋糕/],
    ['名字/称呼', /名字|称呼|小名|叫我|自称|<SELF>|昵称/],
    ['住处', /住|<PROVINCE>|<CITY>|宿舍|老家|搬/],
    ['学业/工作', /高考|大学|专业|学院|课|实验|论文|考试|报告|工作|上班|实习/],
    ['喜好', /喜欢|爱|讨厌|不吃|爱吃|受不了|怕|习惯|酸奶|鱼|橘子/],
    ['约定/规则', /答应|约定|不许|必须|只能|以后|别再|不能|规矩/],
    ['约定/规则', /照片|婚纱|外传|隐私/]
  ];
  const topicOf = (fact) => {
    if (fact.topicId) {
      const topic = topicById(topics, fact.topicId);
      const name = topic && (topic.name || topic.title);
      if (name) return name;
    }
    const text = String(fact.value || '');
    for (const [name, re] of TOPIC_RULES) if (re.test(text)) return name;
    return '其他';
  };

  for (const { fact, imp } of list) {
    // 回填事实没有 label，退回正文前 8 个字更可读；有 label 且不是无信息量的 pattern 才用。
    const rawLabel = String(fact.label || '');
    const label = rawLabel && !/^(profile|note|user|bot|misc)$/i.test(rawLabel) ? rawLabel : String(fact.value || '事实').slice(0, 8);
    const fid = add({
      id: `f:${fact.id}`,
      type: 'fact',
      factId: fact.id,
      label,
      value: String(fact.value || fact.text || '').slice(0, 120),
      tier: fact.tier || 'general',
      score: imp.score,
      grade: imp.grade,
      invalid: Boolean(fact.invalidated),
      expired: Boolean(fact.expired),
      size: fact.tier === 'hard' ? 20 : Math.max(9, Math.min(18, imp.score / 6))
    });
    links.push({ a: fact.about === 'bot' ? 'p:bot' : 'p:user', b: fid, kind: 'about' });
    const topicLabel = topicOf(fact);
    const tid = add({ id: `t:${topicLabel}`, type: 'topic', label: topicLabel, size: 14 });
    links.push({ a: tid, b: fid, kind: 'topic' });
    if (fact.due) {
      const dueText = String(fact.due).slice(0, 10);
      const did = add({ id: `d:${dueText}`, type: 'date', label: dueText, size: 13 });
      links.push({ a: fid, b: did, kind: 'due' });
    }
  }
  return {
    ok: true,
    nodes,
    links,
    tiers: { hard: '#0f7a63', long: '#2f6f9f', general: '#8a6d2f', temp: '#8a8f98' },
    byType: nodes.reduce((map, node) => ((map[node.type] = (map[node.type] || 0) + 1), map), {}),
    truncated: all.length > list.length
  };
}

/** 媒体墙：图片/语音索引的只读投影（二进制走 /api/dsmp/media/file）。 */
export async function mediaWallView(dir, { kind = 'image', limit = 60 } = {}) {
  const voice = kind === 'voice';
  const rows = readJsonl(path.join(dir, 'state', voice ? 'voice.jsonl' : 'media.jsonl'));
  rows.sort((a, b) => tsMs(b.at) - tsMs(a.at));
  return {
    ok: true,
    kind: voice ? 'voice' : 'image',
    count: rows.length,
    rows: rows.slice(0, Math.max(1, Math.min(200, limit))).map((row) => ({
      sha1: row.sha1,
      kind: row.kind || (voice ? 'voice' : 'image'),
      mime: row.mime || '',
      bytes: Number(row.bytes) || 0,
      at: row.at || '',
      alt: row.alt || '',
      day: row.day || '',
      direction: row.direction || '',
      speaker: row.speaker || '',
      text: String(row.text || '').slice(0, 300),
      textSource: row.textSource || ''
    }))
  };
}

/** 折叠检测：哪些会话已被折叠、为什么；只读，不写 fold 状态。 */
export async function foldsView(dir) {
  const memory = readJsonFile(path.join(dir, 'state', 'memory.json'), {});
  const sessions = [];
  for (const [key, rec] of Object.entries(memory.sessions || {})) {
    if (!rec || typeof rec !== 'object') continue;
    const sid = String(rec.sessionId || '');
    const rows = sid ? readJsonl(path.join(dir, 'window', sid, 'turns.jsonl')) : [];
    sessions.push({
      key,
      sessionId: sid,
      folded: Boolean(rec.folded),
      foldedAt: rec.foldedAt || 0,
      foldedReason: String(rec.foldedReason || ''),
      turns: rows.length,
      imported: rows.filter((row) => row && row.fidelity === 'session-log').length,
      lastAt: rows.reduce((max, row) => Math.max(max, tsMs(row.at || row.ts)), 0)
    });
  }
  sessions.sort((a, b) => (b.foldedAt || b.lastAt) - (a.foldedAt || a.lastAt));
  const foldedSessions = sessions.filter((row) => row.folded);
  return {
    ok: true,
    folded: foldedSessions.length,
    foldedSessions,
    sessions,
    guard: {
      logFile: path.join(dir, 'logs', 'fold-guard.log'),
      exists: fs.existsSync(path.join(dir, 'logs', 'fold-guard.log'))
    }
  };
}

/** 记忆数据导出（与 7351 的 deepseek-memory-export/1 兼容）。 */
export async function exportView(dir, { withWindow = false } = {}) {
  const [{ openIndex, readInvalidated }] = await Promise.all([vendor('longterm.mjs')]);
  const facts = openIndex(dir).facts();
  let profile = '';
  try {
    profile = fs.readFileSync(path.join(dir, 'profile.md'), 'utf8');
  } catch {
    profile = '';
  }
  const topics = readJsonl(path.join(dir, 'state', 'topics.jsonl'));
  const episodes = [];
  try {
    for (const name of fs.readdirSync(path.join(dir, 'episodes'))) {
      if (!name.endsWith('.jsonl')) continue;
      episodes.push(...readJsonl(path.join(dir, 'episodes', name)));
    }
  } catch {
    /* none */
  }
  episodes.sort((a, b) => String(a.atFrom || '').localeCompare(String(b.atFrom || '')));
  const sessions = [];
  if (withWindow) {
    for (const name of fs.readdirSync(path.join(dir, 'window'))) {
      if (!name.startsWith('session-')) continue;
      sessions.push({
        sessionId: name,
        meta: readJsonFile(path.join(dir, 'window', name, 'meta.json'), {}),
        turns: readJsonl(path.join(dir, 'window', name, 'turns.jsonl'))
      });
    }
  }
  return {
    format: 'deepseek-memory-export/1',
    exportedAt: new Date().toISOString(),
    dataDir: dir,
    profile,
    facts,
    topics,
    episodes,
    counts: { facts: facts.length, topics: topics.length, episodes: episodes.length, windowSessions: sessions.length },
    ...(withWindow ? { window: sessions } : {})
  };
}

/** 单条事实详情：原始字段 + 重要度拆解 + v10 解释（只读）。 */
export async function factDetailView(dir, id) {
  const [{ openIndex }, { describeImportance }, { normalizeConfig }, v10] = await Promise.all([
    vendor('longterm.mjs'),
    vendor('importance.mjs'),
    vendor('score.mjs'),
    vendor('v10.mjs')
  ]);
  const sid = String(id || '').trim();
  if (!sid) throw new Error('缺少 id');
  const facts = openIndex(dir).facts();
  const fact = facts.find((row) => row.id === sid);
  if (!fact) return { ok: false, error: `没有这条事实：${sid}`, id: sid };
  const imp = describeImportance(fact, Date.now(), normalizeConfig({}));
  let debug = null;
  try {
    debug = typeof v10.explain === 'function' ? v10.explain(fact, { facts }) : null;
  } catch {
    debug = null;
  }
  let tomb = {};
  try {
    tomb = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'facts-invalidated.json'), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    tomb = {};
  }
  return { ok: true, id: sid, fact, importance: imp, invalidated: Boolean(tomb[sid]), tombstone: tomb[sid] || null, debug };
}
