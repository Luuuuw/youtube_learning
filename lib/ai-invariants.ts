// AI 写盘前的不变式断言（Safe-Mutation Layer B）
//
// 每个 invariant 是 (proposal) => string | null：null 表示通过，string 是失败原因。
// 用法：在 safeAiWrite 的 options.invariants 里组装。
//
// 设计原则：
// - 防住"AI 输出空"、"AI 输出非中文"、"vtt 重写丢词级时间戳"、"新 cue 偷听下一句" 等常见撞坑场景
// - 通用断言（mustNotBeEmpty、mustHaveChinese 等）放这里
// - 业务专有断言（如 quiz 题数）调用方自己写

import type { AiProposal } from '@/lib/safe-ai-write';

export type Invariant = (p: AiProposal) => string | null;

/**
 * after 必须是字符串且去空白后长度 >= minLen。
 */
export function mustNotBeEmpty(minLen = 1): Invariant {
  return (p) => {
    const v = p.after;
    if (typeof v !== 'string') return `mustNotBeEmpty: after 不是字符串 (got ${typeof v})`;
    if (v.trim().length < minLen) return `mustNotBeEmpty: 文本长度 ${v.trim().length} < ${minLen}`;
    return null;
  };
}

/**
 * after 中必须包含至少一个中文字符。防 AI 返回纯英文/标点。
 */
export const mustHaveChinese: Invariant = (p) => {
  const v = p.after;
  if (typeof v !== 'string') return null;  // 不是字符串就交给别的 invariant
  if (!/[一-鿿]/.test(v)) return `mustHaveChinese: 文本不含任何中文字符："${v.slice(0, 40)}"`;
  return null;
};

/**
 * after / before 都是 vtt 字符串。after 必须保留 before 里的关键 rollup 标签数量
 * （`<00:00:xx.xxx><c>` 词级时间戳和 `<c>...</c>` 词包裹）。
 *
 * 防 ASR fix 那次把整个 vtt dedupe 重写丢词级时间戳的撞坑。
 */
export const mustPreserveVttRollupTags: Invariant = (p) => {
  if (typeof p.before !== 'string' || typeof p.after !== 'string') return null;
  const beforeTags = (p.before.match(/<\d+:\d+:\d+\.\d+>/g) || []).length;
  const afterTags = (p.after.match(/<\d+:\d+:\d+\.\d+>/g) || []).length;
  // 允许新版略少（合并、去重）但不能少超过 50%
  if (beforeTags === 0) return null;  // 原本就没标签，新版无要求
  if (afterTags < beforeTags * 0.5) {
    return `mustPreserveVttRollupTags: 词级时间戳标签从 ${beforeTags} 降到 ${afterTags} (< 50%)`;
  }
  return null;
};

/**
 * after / before 都是 vtt 字符串。after 的总 cue 数（`-->` 行数）不能比 before 少 80%。
 * 防"全部重写后只剩寥寥几条"的灾难。
 */
export const mustPreserveCueCount: Invariant = (p) => {
  if (typeof p.before !== 'string' || typeof p.after !== 'string') return null;
  const beforeCues = (p.before.match(/ --> /g) || []).length;
  const afterCues = (p.after.match(/ --> /g) || []).length;
  if (beforeCues === 0) return null;
  if (afterCues < beforeCues * 0.2) {
    return `mustPreserveCueCount: cue 数从 ${beforeCues} 降到 ${afterCues} (< 20%)`;
  }
  return null;
};

/**
 * 提案 metadata 必须含 model。防止 model alias 漂移时无法追溯。
 */
export const mustRecordModel: Invariant = (p) => {
  if (!p.metadata?.model) return `mustRecordModel: metadata.model 缺失`;
  return null;
};

/**
 * 工厂：cue 重叠检查 — after.text 跟 next cue.text 前 N 词重叠 > threshold% 时拒绝。
 * 防 ASR 截音频边界偷听下一句开头那次撞坑。
 *
 * 调用方需自己在 metadata 里塞 nextCueText：
 *   metadata: { nextCueText: '下一个 cue 的 text' }
 */
export function mustNotOverlapWithNext(thresholdPct = 60, compareWords = 5): Invariant {
  return (p) => {
    const after = p.after;
    const next = (p.metadata as { nextCueText?: string } | undefined)?.nextCueText;
    if (typeof after !== 'string' || !next) return null;

    const aw = after.toLowerCase().split(/\s+/).filter(Boolean).slice(0, compareWords);
    const nw = next.toLowerCase().split(/\s+/).filter(Boolean).slice(0, compareWords);
    if (aw.length === 0 || nw.length === 0) return null;

    let overlap = 0;
    for (let i = 0; i < Math.min(aw.length, nw.length); i++) {
      if (aw[i] === nw[i]) overlap++;
    }
    const pct = (overlap / Math.min(aw.length, nw.length)) * 100;
    if (pct >= thresholdPct) {
      return `mustNotOverlapWithNext: 与下一 cue 前 ${compareWords} 词重叠 ${pct.toFixed(0)}% (>= ${thresholdPct}%)`;
    }
    return null;
  };
}

/**
 * 闪卡批准导入：metadata.cards 必须是非空数组，每张卡 front/back 都非空。
 * 防"批准了 0 张卡"或"AI 草稿里有空白卡片"被走 audit 还入库。
 *
 * 调用方需在 proposal.metadata 里塞 cards:
 *   metadata: { cards: [{ id, front, back }, ...] }
 */
export const mustHaveCardContent: Invariant = (p) => {
  const cards = (p.metadata as { cards?: Array<{ id?: string; front?: string; back?: string }> } | undefined)?.cards;
  if (!Array.isArray(cards) || cards.length === 0) {
    return `mustHaveCardContent: metadata.cards 缺失或为空`;
  }
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const front = String(c?.front ?? '').trim();
    const back = String(c?.back ?? '').trim();
    if (!front || !back) {
      return `mustHaveCardContent: 卡片 #${i + 1}${c?.id ? ` (id=${c.id})` : ''} front="${front.slice(0, 20)}" back="${back.slice(0, 20)}" 含空字段`;
    }
  }
  return null;
};

/**
 * 视频翻译落盘：metadata.zhMap 是 cueKey → 中文译文 的字典。
 * 每条都必须非空且至少含一个中文字符（防 AI 把整段还原成英文/标点）。
 *
 * 容忍少量"可疑"条目：现实视频里有 [music]/♪/纯人名等场景，原文非语音的 cue
 * 会被上游标成非翻译，但偶尔仍会漏到这里。允许 ≤10% 的条目为空/非中文；
 * 超过则当成 AI 整体输出退化拒绝。
 *
 * 调用方需在 proposal.metadata 里塞 zhMap:
 *   metadata: { zhMap: { "0.000-2.500": "你好", ... } }
 */
export const mustAllZhBeChinese: Invariant = (p) => {
  const zhMap = (p.metadata as { zhMap?: Record<string, string> } | undefined)?.zhMap;
  if (!zhMap || typeof zhMap !== 'object') {
    return `mustAllZhBeChinese: metadata.zhMap 缺失`;
  }
  const entries = Object.entries(zhMap);
  if (entries.length === 0) {
    return `mustAllZhBeChinese: metadata.zhMap 为空`;
  }

  const SUSPECT_TOLERANCE = 0.10; // 10% 容忍：典型字幕里非语音/纯专有名词 cue 占比远低于此
  let firstOffender: { key: string; value: string } | null = null;
  let suspectCount = 0;

  for (const [key, raw] of entries) {
    const value = String(raw ?? '');
    const trimmed = value.trim();
    const isSuspect = !trimmed || !/[一-鿿]/.test(trimmed);
    if (isSuspect) {
      suspectCount++;
      if (!firstOffender) {
        firstOffender = { key, value: trimmed };
      }
    }
  }

  const pct = suspectCount / entries.length;
  if (pct > SUSPECT_TOLERANCE && firstOffender) {
    const truncated = firstOffender.value.slice(0, 30);
    return `mustAllZhBeChinese: ${suspectCount}/${entries.length} 条（${(pct * 100).toFixed(1)}%）为空或无中文，超出 ${(SUSPECT_TOLERANCE * 100).toFixed(0)}% 容忍线；首例 key="${firstOffender.key}" value="${truncated}"`;
  }
  return null;
};

/**
 * 跑所有 invariants 收集错误。
 */
export function runInvariants(p: AiProposal, invariants: Invariant[]): string[] {
  const errors: string[] = [];
  for (const inv of invariants) {
    try {
      const result = inv(p);
      if (result) errors.push(result);
    } catch (err) {
      errors.push(`invariant 内部抛错: ${(err as Error).message}`);
    }
  }
  return errors;
}
