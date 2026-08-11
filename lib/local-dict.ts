// 本地常用词字典：660 词，覆盖代词/数词/基础动词/系词等高频词。
// 数据在 data/local-dict.json，由 scripts/migrate-local-dict.mjs 一次性从代码搬过去。
// 后续扩字典直接改 JSON，不动这文件。

import dictData from '@/data/local-dict.json';

export interface DictEntry {
  word: string;
  phonetic: string;
  definition: string;
  example: string;
}

const DICT = dictData as Record<string, DictEntry>;

export function getLocalDictEntry(word: string): DictEntry | undefined {
  return DICT[word.toLowerCase().trim()];
}

export function hasLocalDictEntry(word: string): boolean {
  return word.toLowerCase().trim() in DICT;
}
