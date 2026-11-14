// 值级去重（2026-11-10）：
// 同一件事被写几次、每次换一种说法时，识别成同一条，避免事实库、检索结果与
// 事实卡里叠出好几版。规则全部是确定性的，可单测、可解释、可回滚。
//
// 只做「保守合并」，宁可漏掉一条改写，也不把两件不同的事并掉：
//   1. 归一化后完全相同；
//   2. 较短的一条被较长的一条完整包含（较短 ≥ 8 字，避免「英语」吞掉「英语课」）；
//   3. 字符二元组 Dice 系数 ≥ 0.85（换语序、加语气词的近同义改写）；
//   4. 两条共享 ≥ 2 个型号/编号（A7R3、2470GM、100-400），且占比 ≥ 0.6。
//
// 不按「共享几个中文二元组」合并：那会把「周一 14:30 电子学基础」和
// 「周五 08:30 电子学基础」判成同一条，也会把「不喜欢被叫<PERSONA_NICK>」和
// 「README 里不许出现<PERSONA_NICK>」并掉。

const MODEL_RE = /[A-Za-z0-9]+(?:[\s\-_]+[A-Za-z0-9]+)*/g;

export function compactValue(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
}

function bigrams(text) {
  const s = compactValue(text);
  const out = new Set();
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
  return out;
}

function modelIds(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(MODEL_RE)) {
    const t = m[0].replace(/[\s\-_]+/g, '').toLowerCase();
    if (t.length >= 3 && /\d/.test(t)) out.add(t);
  }
  return out;
}

function idsNear(a, b) {
  const ia = modelIds(a);
  const ib = modelIds(b);
  if (!ia.size || !ib.size) return false;
  let hit = 0;
  for (const t of ia) if (ib.has(t)) hit += 1;
  return hit >= 2 && hit / Math.min(ia.size, ib.size) >= 0.6;
}

export function diceSimilarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit += 1;
  return (2 * hit) / (A.size + B.size);
}

/** 两条值是不是同一条事实的两种说法。 */
export function similarValue(a, b, { slot = '' } = {}) {
  const A = compactValue(a);
  const B = compactValue(b);
  if (!A || !B) return false;
  if (A === B) return true;
  const short = A.length <= B.length ? A : B;
  const long = A.length <= B.length ? B : A;
  if (short.length >= 8 && long.includes(short)) return true;
  if (idsNear(a, b)) return true;
  if (diceSimilarity(a, b) >= 0.85) return true;
  return false;
}

/**
 * 在候选事实里找与 value 同义的那一条。
 * @param {Array<object>} facts 已经 materialize 的事实
 * @param {{topicId?:string,slot?:string,about?:string,value:string,excludeId?:string}} q
 */
export function findSimilarFact(facts, { topicId = '', slot = '', about = '', value = '', excludeId = '' } = {}) {
  const list = Array.isArray(facts) ? facts : [];
  for (const f of list) {
    if (!f || f.status !== 'active') continue;
    if (excludeId && f.id === excludeId) continue;
    if (topicId && f.topicId !== topicId) continue;
    if (slot && f.slot !== slot) continue;
    if (about && f.about && f.about !== about) continue;
    if (similarValue(f.value, value, { slot })) return f;
  }
  return null;
}
