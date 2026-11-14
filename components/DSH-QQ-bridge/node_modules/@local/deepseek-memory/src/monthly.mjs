// 月摘要：轮转注入的第四层，只保留「重要信息」。
//
// 不做模型调用——用确定性规则从长期库挑：
//   硬事实（身份/称呼/生日/住址/学校/宠物/器材…）永远算重要；
//   近 30 天的计划、进行中的事、带日期的事件、她标过 why 的决定；
//   寒暄、吃喝日常、单次情绪、已过期、技术元讨论一律不进。
//
// 输出：<dir>/state/monthly/rolling.md（近 30 天）与 YYYY-MM.md（自然月）。
// 注入侧只读 rolling.md，按 mtime 判断是否过期（>7 天先重建）。

import fs from 'node:fs';
import path from 'node:path';
import * as lt from './longterm.mjs';
import { readTopics } from './topics.mjs';

const DAY_MS = 86400000;
const DEFAULT_MAX_CHARS = 700;
const DEFAULT_DAYS = 30;

const HARD_SLOTS = new Set([
  'identity', 'nickname', 'birthday', 'residence', 'job', 'school', 'pet',
  'skill', 'gear', 'game', 'edition', 'major', 'exam'
]);
const KEEP_SLOTS = new Set([
  ...HARD_SLOTS,
  'plan', 'progress', 'task', 'event', 'stance', 'intel', 'material', 'course', 'contact', 'review'
]);
const SKIP_SLOTS = new Set(['chat', 'mood', 'transient']);

export function monthlyDir(dir) {
  return path.join(dir, 'state', 'monthly');
}

export function monthlyFile(dir, month = 'rolling') {
  return path.join(monthlyDir(dir), `${month}.md`);
}

function norm(value) {
  return String(value ?? '').replace(/\s+/g, '').trim();
}

function topicNames(dir) {
  const map = new Map();
  try {
    for (const t of readTopics(dir) || []) {
      if (t && t.id) map.set(t.id, String(t.name || t.id));
    }
  } catch {
    /* 主题表坏了不影响摘要 */
  }
  return map;
}

/** 挑重要事实；返回按重要度排序的数组。 */
export function selectImportant(facts = [], { now = Date.now(), days = DEFAULT_DAYS } = {}) {
  const since = now - Math.max(1, days) * DAY_MS;
  const picked = [];
  for (const f of facts) {
    if (!f || !f.id) continue;
    if (f.status && f.status !== 'active') continue;
    if (f.expired) continue;
    const slot = String(f.slot || '');
    if (SKIP_SLOTS.has(slot)) continue;
    const text = String(f.value || '').trim();
    if (!text) continue;
    // 技术元讨论不进月摘要（与事实卡同一口径）
    if (/记忆(方案|系统|注入|轮转|测试|脚本)/.test(text)) continue;
    // 她自己关于「怎么改记忆/插件」的开发笔记，不是要记住的事
    if (String(f.about || '') === 'bot' && /记忆|插件|面板|注入|轮转|脚本|测试|部署|仓库|代码/.test(text)) continue;

    const at = Number(f.at || f.saidAt || f.createdAt || 0);
    const hard = HARD_SLOTS.has(slot);
    if (!hard && at < since) continue;
    if (!hard && !KEEP_SLOTS.has(slot)) continue;

    let score = Number(f.I || 0) * 10;
    if (hard) score += 100;
    if (slot === 'plan' || slot === 'progress') score += 40;
    if (slot === 'task') score += 35;
    if (slot === 'event') score += 25;
    if (slot === 'stance' || slot === 'material') score += 15;
    if (text.length >= 12) score += 2;
    picked.push({ ...f, _score: score, _at: at });
  }
  picked.sort((a, b) => b._score - a._score || b._at - a._at);
  return dedupePicked(picked);
}

/** 型号/数字串（A7R3、2470GM、100-400）用于判断两条是不是在说同一件器材。 */
function modelTokens(value) {
  const s = String(value || '').toLowerCase().replace(/[\s\-_]/g, '');
  const out = new Set();
  for (const m of s.matchAll(/[a-z]{1,5}\d{2,5}[a-z]*|\d{2,5}[a-z]{1,5}/g)) out.add(m[0]);
  return out;
}

const SINGLE_VALUE_SLOTS = new Set([
  'identity', 'nickname', 'birthday', 'residence', 'job', 'school', 'pet', 'skill',
  'gear', 'game', 'edition', 'major', 'exam', 'contact'
]);

/**
 * 同一件事常被不同来源写成好几条（「A7R3配2470GM…」/「索尼A7R3机身…」）。
 * 单值槽同主题只留分数最高那条；跨槽位若共享两个以上型号串，也当同一条。
 */
function dedupePicked(list) {
  const kept = [];
  const seenSlots = new Set();
  for (const f of list) {
    const topic = String(f.topicId || '');
    const slot = String(f.slot || '');
    const slotKey = `${topic}|${slot}`;
    if (SINGLE_VALUE_SLOTS.has(slot) && seenSlots.has(slotKey)) continue;
    const toks = modelTokens(f.value);
    let dup = false;
    for (const g of kept) {
      if (String(g.topicId || '') !== topic) continue;
      if (g.slot === slot && SINGLE_VALUE_SLOTS.has(slot)) { dup = true; break; }
      if (toks.size >= 2) {
        const other = modelTokens(g.value);
        let shared = 0;
        for (const t of toks) if (other.has(t)) shared += 1;
        if (shared >= 2) { dup = true; break; }
      }
    }
    if (dup) continue;
    if (SINGLE_VALUE_SLOTS.has(slot)) seenSlots.add(slotKey);
    kept.push(f);
  }
  return kept;
}

function dayLabel(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 渲染成紧凑文本；超预算整行丢弃，不截半句。 */
export function renderMonthly(facts = [], { maxChars = DEFAULT_MAX_CHARS, names = new Map(), label = '近 30 天摘要' } = {}) {
  const head = `【${label}】`;
  const lines = [];
  let chars = head.length;
  const seen = new Set();
  for (const f of facts) {
    const value = String(f.value || '').trim().replace(/\s+/g, ' ');
    if (!value) continue;
    const key = norm(value);
    if (seen.has(key)) continue;
    seen.add(key);
    const when = f.slot === 'event' ? dayLabel(f._at) : '';
    const topic = names.get(String(f.topicId || '')) || '';
    const prefix = topic && topic !== '杂事' ? `[${topic}] ` : '';
    const line = `· ${prefix}${value}${when ? `（${when}）` : ''}`;
    if (chars + line.length + 1 > maxChars) break;
    lines.push(line);
    chars += line.length + 1;
  }
  if (!lines.length) return '';
  return `${head}\n${lines.join('\n')}`;
}

/** 读长期库 → 选 → 渲染 → 写 rolling.md / YYYY-MM.md。 */
export function buildMonthlyDigest(dir, { now = Date.now(), cfg = {} } = {}) {
  const maxChars = Math.max(120, Math.min(1200, Number(cfg.maxChars) || DEFAULT_MAX_CHARS));
  const days = Math.max(7, Math.min(90, Number(cfg.days) || DEFAULT_DAYS));
  const facts = lt.materialize(lt.readEvents(dir).rows, lt.readInvalidated(dir), now);
  const important = selectImportant(facts, { now, days });
  const names = topicNames(dir);
  const text = renderMonthly(important, { maxChars, names, label: `近 ${days} 天摘要` });

  const outDir = monthlyDir(dir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(monthlyFile(dir, 'rolling'), text ? `${text}\n` : '', 'utf8');
  const month = new Date(now).toISOString().slice(0, 7);
  fs.writeFileSync(monthlyFile(dir, month), text ? `${text}\n` : '', 'utf8');
  fs.writeFileSync(
    path.join(outDir, 'index.json'),
    JSON.stringify({ updatedAt: now, month, chars: text.length, facts: important.length, days, maxChars }, null, 2),
    'utf8'
  );
  return { text, chars: text.length, facts: important.length, month, file: monthlyFile(dir, 'rolling') };
}

/**
 * 注入侧读取：rolling.md 不存在或超过 maxAgeMs 就重建；失败返回空串。
 * 只读/写 monthly 目录，不碰事实库。
 */
export function monthlyForInjection(dir, { now = Date.now(), cfg = {}, maxAgeMs = 7 * DAY_MS } = {}) {
  if (cfg.enabled === false) return '';
  try {
    const file = monthlyFile(dir, 'rolling');
    let st = null;
    try {
      st = fs.statSync(file);
    } catch {
      st = null;
    }
    let text = '';
    if (st && now - st.mtimeMs <= maxAgeMs) {
      text = fs.readFileSync(file, 'utf8').trim();
    } else {
      text = buildMonthlyDigest(dir, { now, cfg }).text.trim();
    }
    const maxChars = Math.max(120, Math.min(1200, Number(cfg.maxChars) || DEFAULT_MAX_CHARS));
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars - 8).trimEnd() + '…';
  } catch {
    return '';
  }
}
