// 统一重要度分（2026-11-11）
//
// 目的：检索、面板、工具共用同一个 0–100 分，避免「档位 × 1000」压过 I、
// 也避免面板只按时间倒序看不出谁更重要。
//
//   W = 0.55×I + 0.45×档位基值 + 作者/类别/提及次数的小加成
//   score = round(100 × W × R)        // R 来自 score.mjs 的保持度
//
// 纯函数，不读盘；分数在读取时计算，不写回 longterm.jsonl。

import { retentionOf, round2 } from './score.mjs';

const TIER_BASE = { hard: 1, long: 0.85, general: 0.6, temp: 0.35 };
const KIND_BONUS = { identity: 0.03, pref: 0.03, plan: 0.03, progress: 0.03, chat: -0.2 };
const AUTHOR_BONUS = { self: 0.06, correction: 0.04, owner: 0.04 };

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** 档位分带（只用于展示/筛选，不参与计算）。 */
export const GRADES = Object.freeze({
  core: { key: 'core', label: '核心', min: 80, color: '#e0b64a' },
  important: { key: 'important', label: '重要', min: 60, color: '#4a9de0' },
  normal: { key: 'normal', label: '一般', min: 40, color: '#8a8f98' },
  edge: { key: 'edge', label: '边缘', min: 0, color: '#6b6f76' }
});

export function gradeOf(score) {
  const n = Number(score) || 0;
  if (n >= GRADES.core.min) return GRADES.core;
  if (n >= GRADES.important.min) return GRADES.important;
  if (n >= GRADES.normal.min) return GRADES.normal;
  return GRADES.edge;
}

/** 稳定权重 W（0–1）。I 是显式重要度，档位给下限，作者/类别/提及只做微调。 */
export function weightOf(fact = {}) {
  const I = clamp(Number.isFinite(Number(fact.I)) ? Number(fact.I) : 0.5, 0, 1);
  const tierBase = TIER_BASE[String(fact.tier || 'general')] ?? 0.6;
  const author = AUTHOR_BONUS[String(fact.author || '')] || 0;
  const kind = KIND_BONUS[String(fact.kind || '')] || 0;
  const hits = Math.min(0.05, 0.01 * Math.min(5, Number(fact.hits) || 0));
  return round2(clamp(0.55 * I + 0.45 * tierBase + author + kind + hits, 0.05, 1));
}

/** 重要度分 0–100：W × 保持度。hard 的 R=1，所以分数就是 100×W。 */
export function importanceScore(fact = {}, now = Date.now(), cfg) {
  const R = retentionOf(fact, now, cfg);
  return Math.round(100 * weightOf(fact) * R);
}

/** 一次算清，面板/工具用。 */
export function describeImportance(fact = {}, now = Date.now(), cfg) {
  const weight = weightOf(fact);
  const R = retentionOf(fact, now, cfg);
  const score = Math.round(100 * weight * R);
  const grade = gradeOf(score);
  return {
    score,
    weight,
    retention: round2(R),
    grade: grade.key,
    gradeLabel: grade.label,
    gradeColor: grade.color
  };
}

/** 面板排序：正常 → 旧事 → 已作废；组内分数降序、时间降序。 */
export function compareImportance(a = {}, b = {}) {
  const group = (x) => (x.invalidated ? 2 : x.expired ? 1 : 0);
  return group(a) - group(b)
    || (Number(b.score) || 0) - (Number(a.score) || 0)
    || (Number(b.atMs) || 0) - (Number(a.atMs) || 0);
}
