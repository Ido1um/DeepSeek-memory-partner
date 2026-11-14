// 从情境段（episode）里抽 entry（记忆 3.0 P2/P3 的「模型主力抽取」）。
//
// 与 extract-model.mjs 的区别：
// - 输入是**情境段**（一段连续对话 + 它当时的摘要），不是一天里散落的消息；
// - 输出直接带 topicId + slot，天然成簇（「地平线6 → 版本：顶级版 / 最爱：911 GT3RS」）；
// - 只吃净对话（主人原话 + 她发出的话 + 她的想法），不把注入的记忆块当证据，避免「卡→窗口→抽取」自我繁殖；
// - 只产候选，写不写由调用方（--write）决定；quote 必须能在情境段的净对话里逐字找到。
import * as model from './model.mjs';
import {
  SLOTS,
  SLOT_LABEL,
  DEFAULT_TOPICS,
  SLOT_ORDER,
  readTopics,
  classifyFact
} from './topics.mjs';
import { episodeTranscript } from './episode-ai.mjs';
import { readTurns } from './window.mjs';
import { parseTime, parseBirthday, birthdayWho } from './timeparse.mjs';
import { parseDue } from './due.mjs';
import { extractEntities } from './entities.mjs';
import { readEvents, materialize, readInvalidated, appendEvent } from './longterm.mjs';
import { similarValue } from './value-dedupe.mjs';
import { shouldSkipExtract, recordExtractSkip } from './self-write.mjs';
import { recordConflict } from './disputes.mjs';

// 单值槽位：同一个主题下只保留最新一条（旧值会被 supersede 成「以前提过」）。
const SINGLE_SLOTS = new Set([
  'identity', 'nickname', 'birthday', 'residence', 'job', 'school',
  'game', 'edition', 'plan', 'progress', 'stance', 'routine', 'food', 'pet', 'contact'
]);

// 槽位 → (class, tier)，决定衰减与卡片位置
const SLOT_PROFILE = {
  identity: ['fact', 'hard'],
  nickname: ['fact', 'hard'],
  birthday: ['fact', 'hard'],
  residence: ['fact', 'long'],
  job: ['fact', 'long'],
  school: ['fact', 'long'],
  skill: ['fact', 'long'],
  gear: ['fact', 'long'],
  game: ['fact', 'long'],
  edition: ['fact', 'long'],
  pref: ['fact', 'general'],
  pet: ['fact', 'long'],
  food: ['fact', 'general'],
  routine: ['fact', 'general'],
  plan: ['plan', 'long'],
  progress: ['plan', 'general'],
  intel: ['intel', 'long'],
  material: ['material', 'long'],
  stance: ['stance', 'long'],
  event: ['event', 'general'],
  note: ['note', 'general'],
  contact: ['fact', 'long']
};

function hash32(s) {
  let h = 2166136261;
  const t = String(s || '');
  for (let i = 0; i < t.length; i += 1) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** 宽一点的「逐字」比较：去空白/标点后比对。 */
export function normalizeQuote(s) {
  return String(s || '')
    .replace(/[\s，。！？、；：""''（）()【】[\]…—\-·,\.!\?;:'"]+/g, '')
    .trim();
}

export function sigOf(topicId, slot, value) {
  const base = `topic:${topicId}:${slot}`;
  return SINGLE_SLOTS.has(slot) ? base : `${base}:${hash32(normalizeQuote(value))}`;
}

/** 提示词：把主题表 + 槽位表 + 净对话交给模型。 */
export function buildPrompt({ episode, transcript, topics }) {
  const topicLine = (topics.length ? topics : DEFAULT_TOPICS)
    .map((t) => `${t.id}（${t.name}${t.parentId ? `，父 ${t.parentId}` : ''}）`)
    .join('；');
  const slotLine = SLOT_ORDER.filter((s) => SLOTS.includes(s))
    .map((s) => `${s}（${SLOT_LABEL[s]}）`)
    .join('、');
  const system = [
    '你在替「<PERSONA>」整理一段聊天里的长期记忆。只记录主人本人（和<PERSONA>自己）稳定的事实、偏好、计划、态度、情报，不记录寒暄和一次性状态。',
    `可用主题：${topicLine}。优先复用这些 id；确实没有合适的才新建（2–6 字名词，id 用 t- 开头，最多 2 个）。`,
    `槽位只能从这些里选：${slotLine}。槽位是「一句话能问出来的面」，比如「地平线6」主题下：版本=顶级版、偏好=911 GT3RS。`,
    '每条给：topicId、slot、value（2–40 字、一句话、不要语气词）、quote（必须从对话里逐字摘一句作证据）、kind（fact/intel/plan/stance/material/event/note）、confidence（0~1）。',
    '同一件事只写一条；拿不准就别写（宁缺毋滥）。输出 JSON 数组，不要解释。'
  ].join('\n');
  const user = `【情境段】${episode?.day || ''} ${episode?.title || ''}（${episode?.turnFrom}–${episode?.turnTo} 轮）\n\n${transcript}\n\n请输出 JSON 数组。`;
  return { system, userContent: user };
}

const META_RE = /记忆引擎|记忆方案|注入|检索|事实卡|轮转|脚本|方案|测试|bug|白名单|压缩|上下文/;
const OWNER_EVIDENCE = /主人|我(?!们)|咱|俺|本人/;

// 主人的原话证据：事实只能从主人说过的话里来。她的推测/转述（spoken、reply）不能当证据，
// 否则「所以你最近在玩原神吧」这种她的归纳会被抽成主人事实。
export function ownerEvidence(dir, episode, { maxChars = 20000 } = {}) {
  try {
    const rows = readTurns(dir, String(episode?.sessionId || ''), { limit: 400 });
    const from = Number(episode?.turnFrom) || 0;
    const to = Number(episode?.turnTo) || 0;
    const texts = rows
      .filter((r) => {
        const n = Number(r?.turn) || 0;
        if (from && n < from) return false;
        if (to && n > to) return false;
        return true;
      })
      .map((r) => String(r?.userRaw?.text || '').trim())
      .filter(Boolean);
    return texts.join('\n').slice(0, maxChars);
  } catch {
    return '';
  }
}

/** 校验模型返回的一条 entry；不合法返回 {ok:false, reason}。 */
export 
// 引文证据判定：优先看主人原话；她的转述只有在「主人原话里确实出现过该条目的关键信息」时才算数。
function keyTokens(text) {
  const t = String(text || '').toLowerCase();
  const latin = (t.match(/[a-z0-9][a-z0-9.+\-]{1,}/g) || []).filter((x) => x.length >= 2);
  const cjk = [];
  const han = t.replace(/[^\u4e00-\u9fa5]/g, ' ');
  for (const seg of han.split(/\s+/)) {
    for (let i = 0; i + 2 <= seg.length; i += 1) cjk.push(seg.slice(i, i + 2));
  }
  return [...new Set([...latin, ...cjk])];
}

export function evidenceOk(quote, value, ownerText) {
  if (!ownerText) return true;
  const q = normalizeQuote(quote);
  const o = normalizeQuote(ownerText);
  if (q && o.includes(q)) return true;
  const toks = keyTokens(value);
  if (!toks.length) return false;
  const hit = toks.filter((t) => o.includes(t)).length;
  return hit >= 2 && hit / toks.length >= 0.3;
}

function validateEntry(raw, { transcript, ownerText, topics }) {
  const topicId = String(raw?.topicId || '').trim();
  const slot = String(raw?.slot || '').trim();
  const value = String(raw?.value || '').replace(/\s+/g, ' ').trim();
  const quote = String(raw?.quote || '').trim();
  if (!topicId || !/^t-[a-z0-9-]+$/i.test(topicId)) return { ok: false, reason: '主题 id 不合法' };
  if (!SLOTS.includes(slot)) return { ok: false, reason: `槽位不在词表：${slot}` };
  if (value.length < 2 || value.length > 60) return { ok: false, reason: `value 长度 ${value.length}` };
  if (!quote) return { ok: false, reason: '缺少 quote' };
  const hay = normalizeQuote(transcript);
  if (!hay.includes(normalizeQuote(quote))) return { ok: false, reason: 'quote 不在净对话里' };
  const known = new Set((topics.length ? topics : DEFAULT_TOPICS).map((t) => t.id));
  if (!known.has(topicId)) return { ok: false, reason: `主题不存在：${topicId}` };
  const kind = ['fact', 'intel', 'plan', 'stance', 'material', 'event', 'note'].includes(raw?.kind)
    ? raw.kind
    : SLOT_PROFILE[slot]?.[0] || 'fact';
  const confidence = Math.max(0, Math.min(1, Number(raw?.confidence) || 0.7));
  if (confidence < 0.45) return { ok: false, reason: `confidence ${confidence}` };
  // 记忆系统自身的元讨论不进长期库（会挤占事实卡、也不是稳定的事实）
  if (META_RE.test(value)) return { ok: false, reason: '元讨论' };
  // t-identity 的硬属性必须有主人本人证据，否则可能是把<PERSONA>的事记到主人头上
  if (topicId === 't-identity' && ['identity', 'birthday', 'nickname', 'residence', 'job', 'school'].includes(slot)) {
    if (!OWNER_EVIDENCE.test(quote)) return { ok: false, reason: '缺主人证据' };
  }
  return { ok: true, entry: { topicId, slot, value, quote, kind, confidence } };
}

/** 毫秒或 ISO 字符串都收（episode.atFrom/atTo 是 ISO，用 Number 会变 NaN）。 */
function numAt(v) {
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  const d = Date.parse(String(v || ''));
  return Number.isFinite(d) ? d : 0;
}

/** entry 的引文在窗口账本里对应哪一轮 —— 时间锚必须是这一轮，不是写入时间。 */
export function turnAtFor(quote, rows = [], episode = null) {
  const q = normalizeQuote(quote);
  if (q) {
    for (const r of rows) {
      const at = numAt(r?.at);
      if (!at) continue;
      const t = normalizeQuote(r?.userRaw?.text || '');
      if (t && (t.includes(q) || (q.length > 12 && q.includes(t.slice(0, 12))))) return at;
    }
  }
  return numAt(episode?.atTo) || numAt(episode?.atFrom) || 0;
}

/** 一条 entry → longterm 的 fact 事件（可直接 appendEvent）。 */
export function factOf(entry, { episode, now = Date.now(), key = '' } = {}) {
  const [cls, tier] = SLOT_PROFILE[entry.slot] || ['fact', 'general'];
  const about = entry.topicId === 't-bot' ? 'bot' : 'user';
  // 3.0 补丁：saidAt 取「那句话所在的那一轮」，validUntil 由相对时间解析给出
  const saidAt = numAt(entry.turnAt) || numAt(episode?.atTo) || numAt(episode?.atFrom) || now;
  const tp = parseTime(`${entry.quote || ''} ${entry.value || ''}`, { refMs: saidAt, slot: entry.slot });
  // 3.0 补丁：生日必须落到日期字段，而不是只在 value 里写「11 月 2 日」。
  const birthday = entry.slot === 'birthday' ? parseBirthday(entry.value || entry.quote || '') : null;
  const bWho = birthday ? birthdayWho(entry.value || '', about) : '';
  const entities = extractEntities(`${entry.value || ''} ${entry.quote || ''}`, { about });
  // 3.1.1 M4：带「要交/要做/截止」这类话且能解析出日期的，写成待办（task + due + dueAt），
  // 这样「下周要交什么」「最近有什么事要做」能按到期日取到，而不是只当 event/plan 存着。
  const TASK_HINT = /要交|要写|要做|要做完|得交|得做|截止|deadline|别忘了|别忘记|提醒我|要考|考试|答辩|报名|缴费|提交|ddl/i;
  let taskFields = {};
  if (TASK_HINT.test(`${entry.quote || ''} ${entry.value || ''}`)) {
    const d = parseDue(`${entry.quote || ''} ${entry.value || ''}`, saidAt);
    // 只收半年内的日期：学期开始日、生日、往年旧事都不是待办。
    if (d && d.dueAt && d.dueAt >= saidAt - 86400e3 && d.dueAt <= saidAt + 180 * 86400e3) {
      taskFields = { task: true, due: d.due, dueAt: d.dueAt, duePhrase: d.phrase || '' };
    }
  }
  return {
    ev: 'fact',
    id: `h-ep-${hash32(`${episode?.id}:${entry.topicId}:${entry.slot}:${entry.value}`)}`,
    sig: sigOf(entry.topicId, entry.slot, entry.value),
    key,
    about,
    pattern: entry.slot,
    label: SLOT_LABEL[entry.slot] || entry.slot,
    value: entry.value,
    text: entry.quote.slice(0, 200),
    quote: entry.quote.slice(0, 200),
    topicId: entry.topicId,
    slot: entry.slot,
    class: entry.kind === 'fact' ? cls : entry.kind,
    source: entry.source || { model: 'episode', episodeId: episode?.id || '', confidence: entry.confidence },
    tier,
    I: entry.confidence >= 0.85 ? 0.9 : 0.75,
    s: null,
    hits: 1,
    lastAt: now,
    at: now,
    saidAt,
    dates: tp.dates,
    validUntil: tp.validUntil || 0,
    timePhrase: tp.phrase || '',
    timeConfidence: tp.confidence || 0,
    ...(tp.recurring ? { recurring: true } : {}),
    ...(birthday ? { birthday: { ...birthday, who: bWho } } : {}),
    ...(birthday ? { dates: [{ date: birthday.y ? `${birthday.y}-${birthday.key}` : '', kind: 'birthday', who: bWho, yearly: true, phrase: birthday.phrase }] } : {}),
    ...taskFields,
    ...(entry.kind === 'event' ? { ttlDays: 14 } : {}),
    ...(entities ? { entities } : {}),
    ...(entry.kind === 'plan' ? {} : {})
  };
}

/** 对一段情境段跑一次模型抽取，返回 {ok, entries, dropped, error}。 */
export async function extractEpisode(dir, episode, { request = model.requestModel, topics, maxChars = 6000, timeoutMs = 60000 } = {}) {
  const built = episodeTranscript(dir, episode, { maxChars });
  const transcript = String(built?.text || '');
  if (transcript.length < 40) return { ok: false, entries: [], dropped: [], error: '净对话太短' };
  const known = topics || readTopics(dir);
  const ownerText = ownerEvidence(dir, episode);
  const { system, userContent } = buildPrompt({ episode, transcript, topics: known });
  const res = await request({ caller: 'entry', system, userContent, json: true, maxChars: 4000, timeoutMs });
  if (!res?.ok) return { ok: false, entries: [], dropped: [], error: res?.error || '模型调用失败' };
  const raw = String(res.text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return { ok: false, entries: [], dropped: [], error: 'JSON 解析失败' };
  let arr = [];
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { ok: false, entries: [], dropped: [], error: 'JSON 解析失败' };
  }
  const entries = [];
  const dropped = [];
  for (const item of Array.isArray(arr) ? arr : []) {
    const v = validateEntry(item, { transcript, ownerText, topics: known });
    if (v.ok) entries.push(v.entry);
    else dropped.push({ item, reason: v.reason });
  }
  // 同一段里同 topic+slot 的单值槽位只留置信度最高的一条
  const bySlot = new Map();
  for (const e of entries) {
    const k = SINGLE_SLOTS.has(e.slot) ? `${e.topicId}|${e.slot}` : `${e.topicId}|${e.slot}|${e.value}`;
    const prev = bySlot.get(k);
    if (!prev || e.confidence > prev.confidence) bySlot.set(k, e);
  }
  // 给每条 entry 打上「那句话所在的那一轮」的时间锚（后面 factOf 用它做相对时间基准）
  const from = Number(episode?.turnFrom) || 0;
  const to = Number(episode?.turnTo) || 0;
  let rows = [];
  try {
    rows = readTurns(dir, String(episode?.sessionId || ''), { limit: 400 })
      .filter((r) => { const n = Number(r?.turn) || 0; return (!from || n >= from) && (!to || n <= to); });
  } catch { rows = []; }
  for (const e of bySlot.values()) e.turnAt = turnAtFor(e.quote, rows, episode);
  return { ok: true, entries: [...bySlot.values()], dropped, transcriptChars: transcript.length };
}

/**
 * 把一组 entry 写进长期库（单值槽位复用原 id 追加 supersede，保留版本历史）。
 * episode 抽取与 R2 的「模型候选合流」共用这一条写库路径。
 * @returns {{written:number, updated:number, skippedDup:number, skippedSelf:number, kept:Array}}
 */
export function writeEntries(dir, entries = [], { write = false, log = () => {}, episode = null, bySig = null } = {}) {
  const map = bySig instanceof Map
    ? bySig
    : new Map(
      materialize(readEvents(dir).rows, readInvalidated(dir))
        .filter((f) => f.status !== 'invalidated' && f.status !== 'merged')
        .map((f) => [f.sig, f])
    );
  const out = { written: 0, updated: 0, skippedDup: 0, skippedSelf: 0, conflicts: 0, kept: [] };
  for (const entry of entries) {
    const sig = sigOf(entry.topicId, entry.slot, entry.value);
    const prev = map.get(sig);
    const fact = factOf(entry, { episode, key: 'private:<OWNER_QQ>' });
    // 3.1：她自己写过同一个「主题+槽位」时，抽取器只补充、不覆盖。
    const guard = shouldSkipExtract(dir, { topicId: entry.topicId, slot: entry.slot, value: entry.value });
    if (guard.skip) {
      recordExtractSkip(dir, {
        topicId: entry.topicId,
        slot: entry.slot,
        value: entry.value,
        quote: entry.quote,
        source: fact.source
      });
      // 她写过、抽取器却给出不同值：不进库，也不悄悄丢掉，交给人裁决。
      if (prev && prev.author === 'self' && prev.id && prev.value !== entry.value) {
        if (recordConflict(dir, { entry, selfFact: prev, source: fact.source, day: episode?.day || '' })) {
          out.conflicts += 1;
        }
      }
      out.skippedSelf += 1;
      continue;
    }
    // 同义改写：多值槽位按值哈希分条，换一种说法会绕过 prev 检查；
    // 同一主题+槽位里已有意思相同的一条时，只补第一条，不再叠一版。
    if (!prev) {
      const twins = [...map.values()].filter(
        (f) => f && (f.status || 'active') === 'active' && f.topicId === entry.topicId && f.slot === entry.slot
      );
      const twin = twins.find((f) => f.value !== entry.value && similarValue(f.value, entry.value, { slot: entry.slot }));
      if (twin) {
        out.skippedDup += 1;
        continue;
      }
    }
    if (prev) {
      if (prev.value === entry.value) {
        out.skippedDup += 1;
        continue;
      }
      if (SINGLE_SLOTS.has(entry.slot)) {
        if (write) {
          appendEvent(
            {
              ev: 'supersede',
              id: prev.id,
              value: entry.value,
              quote: String(entry.quote || '').slice(0, 200),
              label: SLOT_LABEL[entry.slot] || entry.slot,
              source: fact.source,
              // 时间锚跟着新那一句走：否则新值会顶着旧值的过期日期，卡上「旧事」串行。
              saidAt: fact.saidAt,
              dates: fact.dates,
              validUntil: fact.validUntil,
              timePhrase: fact.timePhrase,
              timeConfidence: fact.timeConfidence,
              ...(fact.birthday ? { birthday: fact.birthday } : {}),
              at: Date.now()
            },
            dir
          );
        }
        out.updated += 1;
        out.kept.push({ ...entry, action: 'supersede', id: prev.id });
        map.set(sig, { ...prev, value: entry.value });
        continue;
      }
      out.skippedDup += 1;
      continue;
    }
    if (write) appendEvent(fact, dir);
    out.written += 1;
    map.set(sig, fact);
    out.kept.push({ ...entry, action: 'new', id: fact.id, sig });
  }
  return out;
}

/**
 * 把多段 episode 的抽取结果写进长期库（单值槽位复用原 id 追加 supersede，保留版本历史）。
 * @returns {{written:number, updated:number, skippedDup:number, skippedSelf:number, results:Array}}
 */
export async function extractIntoStore(dir, episodes, { write = false, request = model.requestModel, log = () => {} } = {}) {
  const bySig = new Map(
    materialize(readEvents(dir).rows, readInvalidated(dir))
      .filter((f) => f.status !== 'invalidated' && f.status !== 'merged')
      .map((f) => [f.sig, f])
  );
  const out = { written: 0, updated: 0, skippedDup: 0, skippedSelf: 0, conflicts: 0, results: [] };
  for (const ep of episodes) {
    const r = await extractEpisode(dir, ep, { request });
    if (!r.ok) {
      out.results.push({ episode: ep.id, day: ep.day, ok: false, error: r.error });
      log(`情境抽取：${ep.id} 跳过（${r.error}）`);
      continue;
    }
    const w = writeEntries(dir, r.entries, { write, log, episode: ep, bySig });
    out.written += w.written;
    out.updated += w.updated;
    out.skippedDup += w.skippedDup;
    out.skippedSelf += w.skippedSelf;
    out.conflicts += w.conflicts || 0;
    out.results.push({ episode: ep.id, day: ep.day, title: ep.title, ok: true, entries: w.kept, dropped: r.dropped.length });
  }
  return out;
}

// 候选自身的 topic 语义 → 单值槽位名（模型抽取沿用的是 2.1 的 user:xxx 写法）
const CAND_ATTR_SLOTS = new Set(['identity', 'nickname', 'birthday', 'residence', 'job', 'school', 'skill', 'pet']);
const SLOT_DEFAULT_TOPIC = {
  identity: 't-identity',
  nickname: 't-identity',
  birthday: 't-identity',
  residence: 't-identity',
  job: 't-identity',
  school: 't-identity',
  skill: 't-identity',
  gear: 't-photo',
  game: 't-life',
  edition: 't-life',
  pref: 't-life',
  pet: 't-life',
  plan: 't-plan',
  progress: 't-plan',
  event: 't-life',
  note: 't-life'
};

/** R2：把模型抽取通过项映射成 entry，走和 episode 抽取同一条写库路径。 */
export function mergeCandidates(dir, candidates = [], { write = false, log = () => {}, day = '' } = {}) {
  const entries = [];
  for (const cand of candidates) {
    const about = cand.about === 'bot' ? 'bot' : 'user';
    let topicId = '';
    let slot = '';
    const classified = classifyFact({ value: cand.value || '', text: cand.quote || '', sig: cand.topic || '', pattern: cand.topic || '' });
    if (classified.topicId && SLOTS.includes(classified.slot)) {
      topicId = classified.topicId;
      slot = classified.slot;
    }
    const attr = String(cand.topic || '').match(/^user:([a-z-]+)$/);
    if (attr && CAND_ATTR_SLOTS.has(attr[1])) {
      slot = attr[1];
      topicId = topicId || SLOT_DEFAULT_TOPIC[slot] || 't-identity';
    }
    if (!topicId || !SLOTS.includes(slot)) {
      slot = cand.kind === 'pref' ? 'pref' : cand.kind === 'task' || cand.kind === 'event' ? 'event' : 'note';
      topicId = SLOT_DEFAULT_TOPIC[slot] || 't-life';
    }
    entries.push({
      topicId,
      slot,
      value: cand.value,
      quote: cand.quote,
      kind: cand.kind || 'fact',
      confidence: Number(cand.confidence) || 0.6,
      turnAt: numAt(cand.saidAt) || Date.now(),
      source: { model: 'extract', promptVersion: cand.promptVersion || '', confidence: cand.confidence }
    });
  }
  const w = writeEntries(dir, entries, { write, log, episode: { id: `model-${day || 'today'}` } });
  return { ...w, candidates: entries.length, entries };
}
