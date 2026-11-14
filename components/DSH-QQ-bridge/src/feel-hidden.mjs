// 隐藏感受块：模型在回复末尾写 [[feel]]…[[/feel]]，发送前整块切走。
// 主人只看到干净回复；内容落到 <dir>/state/feel-private.jsonl 与 longterm 的 feel 事件。
import fs from 'node:fs';
import path from 'node:path';

const BLOCK = /\[\[feel(?::([0-9a-z-]+))?\]\]([\s\S]*?)\[\[\/feel\]\]/g;
const ID_RE = /^[hs]-\d{8}-[0-9a-f]{6}$/i;

/** 从一条消息里取出隐藏块，返回 { text, broken, notes }。 */
export function stripFeelBlocks(text, out = []) {
  const src = String(text ?? '');
  if (!src.includes('[[feel')) return { text: src, broken: false, notes: out };
  if (!src.includes('[[/feel]]')) {
    // 未闭合：整条不发给用户，调用方换成兜底话术
    return { text: src.replace(/\[\[feel(?::[^\]]*)?\]\][\s\S]*$/, '').trim(), broken: true, notes: out };
  }
  const cleaned = src
    .replace(BLOCK, (_m, id, feel) => {
      const v = String(feel).replace(/\s+/g, ' ').trim().slice(0, 60);
      if (v) out.push({ id: ID_RE.test(id || '') ? id : '', feel: v });
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // 兜底：任何残留标记都不许发给用户
  const leftover = /\[\[\/?feel/.test(cleaned);
  return { text: leftover ? cleaned.replace(/\[\[\/?feel[^\]]*\]\]/g, '').trim() : cleaned, broken: leftover, notes: out };
}

/** 当天最近一条 event/task 事实（作为没写 id 时的挂载目标）。 */
export function latestTarget(dir) {
  try {
    const file = path.join(dir, 'state', 'longterm.jsonl');
    if (!fs.existsSync(file)) return '';
    const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    for (let i = rows.length - 1; i >= 0; i--) {
      try {
        const r = JSON.parse(rows[i]);
        if (r.ev === 'fact' && r.id && (r.class === 'event' || r.class === 'task')) return r.id;
      } catch { /* 坏行跳过 */ }
    }
  } catch { /* 读不到就返回空 */ }
  return '';
}

/** 落盘：私密文件 + longterm feel 事件（挂不上就只写私密文件）。 */
export function recordFeelNotes({ dir, notes = [], key = '', at = Date.now(), log = () => {} }) {
  if (!notes.length) return { saved: 0, target: '' };
  try {
    const stateDir = path.join(dir, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const day = new Date(at).toISOString().slice(0, 10);
    const target = notes.find((n) => n.id)?.id || latestTarget(dir);
    const priv = notes.map((n) => JSON.stringify({ at, day, key, id: n.id || '', target: target || '', feel: n.feel, source: 'reply' }));
    fs.appendFileSync(path.join(stateDir, 'feel-private.jsonl'), priv.join('\n') + '\n', 'utf8');
    if (target) {
      const evs = notes.map((n) => JSON.stringify({ ev: 'feel', id: target, fact: target, feel: n.feel, by: 'self', private: true, at }));
      fs.appendFileSync(path.join(stateDir, 'longterm.jsonl'), evs.join('\n') + '\n', 'utf8');
    }
    log(`feel 已隐藏：${notes.length} 条（${notes.map((n) => n.feel).join(' / ')}）${target ? ' → ' + target : ' → 未挂载'}`);
    return { saved: notes.length, target };
  } catch (e) {
    log('feel 落盘失败：' + (e?.message ?? e));
    return { saved: 0, target: '' };
  }
}