// 相对时间解析：把「今晚 / 明天 / 上个星期四 / 11 月 2 日」在写入时解析成绝对日期与有效期。
//
// 为什么要单独一个纯函数文件：这是规则明确、可穷举测试的东西，放进抽取器会把
// 「理解一句话」和「算日期」搅在一起；出问题时也不好像现在这样一条条对。
//
// 两条硬规则（2026-11-04 实测教训）：
//   1. 基准时间是「那句话被说出的那一轮」，不是写入时间（回填写入会把 10-29 的话标成 11-03）。
//   2. 「上个X / 上上周X」一定是过去档；11-04 说「上个星期四」= 10-29，不是 11-05。
//
// 时区固定 +08:00（无夏令时），不依赖系统时区，跨时区复现结果一致。

const TZ_OFFSET_MS = 8 * 3600e3;
const DAY_MS = 24 * 3600e3;

/** 事件类：说出口即生效、默认次日清晨失效；计划类：当天结束失效。 */
const EVENT_SLOTS = new Set(['plan', 'progress', 'event', 'task']);
/** 事实类：不过期。 */
const FACT_SLOTS = new Set(['birthday', 'identity', 'nickname', 'residence', 'job', 'school', 'gear', 'intel', 'stance', 'skill', 'pet', 'pref', 'note', 'contact', 'game', 'edition', 'material', 'routine', 'food']);

const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };
const WEEK_RE = /(上上|下下|上|下|本|这)?\s*个?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/;
const WEEKEND_RE = /(本|这|下)?\s*个?\s*(?:周末|双休)/;
const FULL_DATE_RE = /(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*[日号]?/;
const SHORT_DATE_RE = /(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/;
const DAY_AFTER_RE = /(?:还有|再过|过)?\s*([0-9]{1,3}|[一二三四五六七八九十]{1,3})\s*天\s*(?:以后|之后|后)?/;

const REL_DAY = [
  [/大后天/, 3], [/后天/, 2], [/明天|明日|明晚|明早|次日/, 1],
  [/今天|今日|今晚|今早|今天下午|今天上午/, 0],
  [/昨天|昨日|昨晚/, -1], [/前天|前晚/, -2],
];

const RECURRING_RE = /每天|每日|每周|每星期|每个月|每月|每年/;
const OWNER_WORDS = /主人|我(?!们)|咱|俺|本人/;
const BOT_WORDS = /你|<PERSONA>|<PERSONA_ALT>|<SELF>/;

function pad(n) { return String(n).padStart(2, '0'); }
const ymd = (ms) => { const p = parts(ms); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };

function parts(ms) {
  const d = new Date(Number(ms) + TZ_OFFSET_MS);
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    dow: d.getUTCDay() || 7, hh: d.getUTCHours(), mm: d.getUTCMinutes()
  };
}

function toMs(y, m, d, hh = 0, mm = 0) { return Date.UTC(y, m - 1, d, hh, mm, 0, 0) - TZ_OFFSET_MS; }
function startOfDay(ms) { const p = parts(ms); return toMs(p.y, p.m, p.d); }

// 不带年的「M 月 D 日」怎么定年份：
//   - 今年还没到的、或刚过去不久（≤180 天）的，就按今年算；
//   - 只有过去太久的（多半是去年说过、今年又提起）才顺延到明年。
// 教训（2026-11-05）：11-05 说「这学期 8 月 31 号开始」，按旧的「不带年且已过就明年」
// 被算成 2027-08-31，还因此生成了一条假待办。
const ROLL_PAST_DAYS = 180;
export function resolveMonthDay(month, day, refMs) {
  const p = parts(refMs);
  const cand = toMs(p.y, month, day);
  const pastDays = (startOfDay(refMs) - cand) / DAY_MS;
  return pastDays > ROLL_PAST_DAYS ? p.y + 1 : p.y;
}
function addDays(ms, n) { return ms + n * DAY_MS; }
function endOfDay(ms) { return startOfDay(addDays(ms, 1)) - 60000; } // 当天 23:59
function nextMorning(ms) { return startOfDay(addDays(ms, 1)) + 6 * 3600e3; } // 次日 06:00

function cnNum(s) {
  if (/^[0-9]+$/.test(s)) return Number(s);
  const map = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s.length === 1) return s === '十' ? 10 : (map[s] ?? NaN);
  if (s[0] === '十') return 10 + (map[s[1]] ?? 0);
  if (s[1] === '十') return (map[s[0]] ?? 0) * 10 + (map[s[2]] ?? 0);
  return NaN;
}

/** slot 决定这条事实要不要有效期：计划/事件要，身份/器材/偏好不要。 */
export function kindOfSlot(slot = '') {
  const s = String(slot || '');
  if (EVENT_SLOTS.has(s)) return 'event';
  if (FACT_SLOTS.has(s)) return 'fact';
  return 'fact';
}

function whoNear(text, phrase) {
  const idx = text.indexOf(phrase);
  if (idx < 0) return null;
  const win = text.slice(Math.max(0, idx - 10), idx + phrase.length + 10);
  if (OWNER_WORDS.test(win)) return 'owner';
  if (BOT_WORDS.test(win)) return 'bot';
  return null;
}

/**
 * 解析一段文本里的时间表达。
 * @param {string} text
 * @param {{refMs?: number, kindHint?: 'event'|'fact'|'plan', slot?: string}} opts
 *   refMs 必须是「那句话被说出的那一轮」的时间（毫秒）；kindHint 缺省按 slot 推。
 */
export function parseTime(text = '', opts = {}) {
  const src = String(text || '');
  const refMs = Number(opts.refMs) || Date.now();
  const kind = opts.kindHint || kindOfSlot(opts.slot);
  const base = { dates: [], validUntil: null, phrase: '', confidence: 0.3, recurring: false };
  if (!src) return base;
  if (RECURRING_RE.test(src)) return { ...base, recurring: true, confidence: 0.95, phrase: src.match(RECURRING_RE)[0] };

  const today = startOfDay(refMs);
  const withWho = (date, phrase, confidence, kindOut = kind === 'event' ? 'event' : 'fact') => {
    const who = whoNear(src, phrase);
    return { date, kind: kindOut, who, phrase, confidence };
  };
  const finish = (dates, confidence, phrase) => {
    const first = dates[0];
    let validUntil = null;
    if (first && kind === 'event') {
      const dms = toMs(...first.date.split('-').map(Number));
      validUntil = opts.slot === 'plan' || opts.slot === 'progress' ? endOfDay(dms) : nextMorning(dms);
    } else if (first && (opts.slot === 'event' || opts.slot === 'task')) {
      const dms = toMs(...first.date.split('-').map(Number));
      validUntil = endOfDay(dms);
    }
    return { dates, validUntil, phrase, confidence, recurring: false };
  };

  // 1) 完整日期 YYYY-MM-DD / YYYY 年 M 月 D 日
  let m = src.match(FULL_DATE_RE);
  if (m) {
    const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const ok = mo >= 1 && mo <= 12 && da >= 1 && da <= 31;
    if (ok) return finish([withWho(`${y}-${pad(mo)}-${pad(da)}`, m[0].trim(), 1)], 1, m[0].trim());
  }

  // 2) N 月 N 日（不写年：同一年里过去不久的月日就按今年算；只有过去太久的才当作明年）
  m = src.match(SHORT_DATE_RE);
  if (m) {
    const mo = Number(m[1]); const da = Number(m[2]);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      const explicitNext = /明年/.test(src);
      let y = explicitNext ? parts(refMs).y + 1 : resolveMonthDay(mo, da, refMs);
      const conf = explicitNext ? 1 : 0.8;
      return finish([withWho(`${y}-${pad(mo)}-${pad(da)}`, m[0].trim(), conf)], conf, m[0].trim());
    }
  }

  // 3) 星期族（上上/上/下下/下/本|这/无）
  m = src.match(WEEK_RE);
  if (m) {
    const pre = m[1] || '';
    const target = WEEKDAY[m[2]];
    const p = parts(refMs);
    const monday = addDays(today, -(p.dow - 1));
    let offsetWeeks = 0;
    if (pre === '下') offsetWeeks = 1;
    else if (pre === '下下') offsetWeeks = 2;
    else if (pre === '上') offsetWeeks = -1;
    else if (pre === '上上') offsetWeeks = -2;
    let cand = addDays(monday, (target - 1) + offsetWeeks * 7);
    if (!pre && cand < today) cand = addDays(cand, 7); // 无前缀 = 下一次
    return finish([withWho(ymd(cand), m[0].trim(), 0.95, 'event')], 0.95, m[0].trim());
  }

  // 4) 周末
  m = src.match(WEEKEND_RE);
  if (m) {
    const p = parts(refMs);
    let sat = addDays(today, 6 - p.dow);
    if (m[1] === '下') sat = addDays(sat, 7);
    else if (!m[1] && sat < today - DAY_MS) sat = addDays(sat, 7);
    return finish([withWho(ymd(sat), m[0].trim(), 0.9, 'event')], 0.9, m[0].trim());
  }

  // 5) 今/明/后/昨/前
  for (const [re, delta] of REL_DAY) {
    if (re.test(src)) {
      const phrase = (src.match(re) || [''])[0];
      const cand = addDays(today, delta);
      return finish([withWho(ymd(cand), phrase, 0.95, 'event')], 0.95, phrase);
    }
  }

  // 6) N 天后 / 还有 N 天
  m = src.match(DAY_AFTER_RE);
  if (m && /天/.test(src) && !/今天|明天|后天|昨天|前天/.test(src)) {
    const n = cnNum(m[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 365) {
      const cand = addDays(today, n);
      return finish([withWho(ymd(cand), m[0].trim(), 0.95, 'event')], 0.95, m[0].trim());
    }
  }

  // 7) 没有时间词：不编日期。
  // 曾经这里给事件/计划默认「说到就按当天算、次日失效」，结果「考研目标<TARGET_SCHOOL> 081200」
  // 「还在想清楚要不要考<TARGET_SCHOOL>」这类长期计划全被标成第二天就过期，卡里只剩旧事。
  // 现在：没有显式时间词就返回空 dates / validUntil=null，只保留 saidAt 作为时间锚。
  return base;
}


/** 生日：把「2007 年 9 月 5 日」「11月2日」「11-02」解析成结构化字段。
 *  年份可选：只写月日时 y=0，按每年重复处理（key 为 MM-DD）。
 *  @returns {{y:number,m:number,d:number,key:string,yearly:true,phrase:string}|null}
 */
export function parseBirthday(text = '') {
  const raw = String(text || '');
  const norm = raw.replace(/\s+/g, '');
  const mk = (y, m, d, phrase) => {
    const mm = Number(m);
    const dd = Number(d);
    if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return null;
    return {
      y: y ? Number(y) : 0,
      m: mm,
      d: dd,
      key: `${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
      yearly: true,
      phrase
    };
  };
  let m = norm.match(/(\d{4})[年\-\/.](\d{1,2})[月\-\/.](\d{1,2})[日号]?/);
  if (m) return mk(m[1], m[2], m[3], m[0]);
  m = norm.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (m) return mk(0, m[1], m[2], m[0]);
  m = norm.match(/(?<!\d)(\d{1,2})-(\d{1,2})(?!\d)/);
  if (m) return mk(0, m[1], m[2], m[0]);
  return null;
}

/** 生日属于谁：先看值里谁在前面（<PERSONA>/<PERSONA_ALT> vs 主人/我），再看 about。 */
export function birthdayWho(text = '', about = '') {
  const t = String(text || '');
  const bot = t.search(/<PERSONA>|<PERSONA_ALT>|<SELF>|鲸鱼娘/);
  const owner = t.search(/主人|我(?!们)|咱|俺/);
  if (bot >= 0 && (owner < 0 || bot < owner)) return 'bot';
  if (owner >= 0) return 'owner';
  return about === 'bot' ? 'bot' : 'owner';
}

/** 过期判断：validUntil 过了就是旧事（历史事件本身也这样处理）。 */
export function isExpired(validUntil, now = Date.now()) {
  return Number(validUntil) > 0 && Number(now) > Number(validUntil);
}

/**
 * 本地日序号（+08）。按「日历日」而不是 24 小时算间隔：
 * 11-07 22:30 看 11-09 09:00 是「后天」，不是「明天」（差 34.5 小时若按 round 会变 1 天）。
 */
export function dayNumber(ms) {
  const p = parts(ms);
  return Math.floor(Date.UTC(p.y, p.m - 1, p.d) / DAY_MS);
}

/** 到期日相对今天的日历天数：今天 0、明天 1、后天 2、昨天 -1。 */
export function calendarDaysUntil(dueMs, nowMs = Date.now()) {
  return dayNumber(dueMs) - dayNumber(nowMs);
}

/** 日历天数 → 统一说法。召回与待办工具共用，避免同一天出现两种口径。 */
export function dueWording(days) {
  const n = Number(days) || 0;
  if (n < 0) return `已过期 ${-n} 天`;
  if (n === 0) return '今天';
  if (n === 1) return '明天';
  if (n === 2) return '后天';
  return `还有 ${n} 天`;
}

const REL_ANNOTATE_RE = /(大后天|后天|明天早上|明早|明晚|明天|明日|今天晚上|今晚|今夜|今天|今日|昨晚|昨天|昨日|前天|前晚|(本|这|下|上)周([一二三四五六日天]))/g;

/**
 * 把「今晚 / 明天 / 上周三」补成带绝对日期的写法：今晚（11-01 晚）、明天（11-02）。
 *
 * 为什么需要：事实卡和召回都是「原文照抄」，一句 11-01 说的「今晚打算启动看看」
 * 放到 11-07 还只写「今晚」，读起来就像今晚——时间感全靠上下文，很容易错。
 * 只在展示层补日期，不改真源 value（原文要保留，便于回看/引用）。
 *
 * 已经带「（MM-DD…）」的不重复补。
 */
export function annotateRelativeTime(text = '', refMs = Date.now()) {
  let out = String(text || '');
  if (!out || !Number(refMs)) return out;
  const base = dayNumber(refMs);
  const stamp = (offset, suffix = '') => {
    const d = new Date((base + offset) * DAY_MS);
    return `（${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}${suffix}）`;
  };
  const dow = parts(refMs).dow;
  return out.replace(REL_ANNOTATE_RE, (m, _all, pre, weekCh, offset, full) => {
    if (full.startsWith('（', offset + m.length)) return m;
    if (weekCh) {
      const target = WEEKDAY[weekCh];
      if (!target) return m;
      let delta;
      if (pre === '本' || pre === '这') delta = target - dow;
      else if (pre === '下') delta = 7 - dow + target;
      else delta = target - dow - 7;
      return `${m}${stamp(delta)}`;
    }
    if (m === '大后天') return `${m}${stamp(3)}`;
    if (m === '后天') return `${m}${stamp(2)}`;
    if (m === '明天早上' || m === '明早') return `${m}${stamp(1, ' 早')}`;
    if (m === '明晚') return `${m}${stamp(1, ' 晚')}`;
    if (m === '明天' || m === '明日') return `${m}${stamp(1)}`;
    if (m === '今天晚上' || m === '今晚' || m === '今夜') return `${m}${stamp(0, ' 晚')}`;
    if (m === '今天' || m === '今日') return `${m}${stamp(0)}`;
    if (m === '昨晚') return `${m}${stamp(-1, ' 晚')}`;
    if (m === '昨天' || m === '昨日') return `${m}${stamp(-1)}`;
    if (m === '前天' || m === '前晚') return `${m}${stamp(-2)}`;
    return m;
  });
}

export { ymd, startOfDay, endOfDay, nextMorning, toMs, TZ_OFFSET_MS };
