export interface WordComparison {
  original: string;
  spoken: string;
  status: 'correct' | 'wrong' | 'missing' | 'extra';
  phonemeHint?: string;
}

export interface ShadowResult {
  score: number;
  accuracy: number;
  fluency: number;
  completeness: number;
  words: WordComparison[];
  correctCount: number;
  totalCount: number;
}

const COMMON_CONFUSIONS: Record<string, string> = {
  'th': '你可能把 /θ/ 发成了 /s/，试试把舌尖露出牙齿1.5mm',
  'th_v': '你可能把 /ð/ 发成了 /z/，舌尖要轻触上齿并振动声带',
  'r_l': '你可能混淆了 /r/ 和 /l/，/r/ 舌尖不碰上颚，/l/ 舌尖抵住上齿龈',
  'ae_e': '你可能把 /æ/ 发成了 /e/，/æ/ 嘴巴要张更大，舌位更低',
  'i_ee': '你可能把 /ɪ/ 发成了 /iː/，/ɪ/ 更短促放松，如 bit vs beat',
  'v_w': '你可能把 /v/ 发成了 /w/，/v/ 上齿要咬下唇',
  's_sh': '你可能把 /s/ 发成了 /ʃ/，/s/ 舌尖靠上齿龈，不翘起',
  'z_zh': '你可能把 /z/ 发成了 /ʒ/，保持舌尖位置，/z/ 更尖锐',
  'n_ng': '你可能把词尾 /n/ 发成了 /ŋ/，/n/ 舌尖抵上齿龈',
  'l_end': '词尾 /l/ 可能没发出来，如 "feel" 结尾舌尖要抵上齿龈',
};

function cleanWord(w: string): string {
  return w.replace(/[.,!?;:'"()\[\]{}]/g, '').toLowerCase().trim();
}

function getPhonemeHint(original: string, spoken: string): string | undefined {
  const o = original.toLowerCase();
  const s = spoken.toLowerCase();

  if (o.startsWith('th') && (s.startsWith('s') || s.startsWith('z') || s.startsWith('d') || s.startsWith('t'))) {
    return o.includes('the') || o.includes('this') || o.includes('that') || o.includes('they') || o.includes('them') || o.includes('there') || o.includes('then')
      ? COMMON_CONFUSIONS['th_v']
      : COMMON_CONFUSIONS['th'];
  }
  if ((o.startsWith('r') && s.startsWith('l')) || (o.startsWith('l') && s.startsWith('r'))) {
    return COMMON_CONFUSIONS['r_l'];
  }
  if (o.includes('a') && (s.includes('e') || s.includes('i')) && o.length <= 4) {
    return COMMON_CONFUSIONS['ae_e'];
  }
  if (o.startsWith('v') && s.startsWith('w')) {
    return COMMON_CONFUSIONS['v_w'];
  }
  if (o.includes('sh') && s.includes('s')) {
    return COMMON_CONFUSIONS['s_sh'];
  }
  if (o.endsWith('l') && (s.endsWith('o') || s.endsWith('u') || s !== o)) {
    return COMMON_CONFUSIONS['l_end'];
  }
  if (o.endsWith('ing') && s.endsWith('in')) {
    return COMMON_CONFUSIONS['n_ng'];
  }
  if (o.includes('i') && s.includes('ee') && o.length <= 4) {
    return COMMON_CONFUSIONS['i_ee'];
  }
  return undefined;
}

function levenshteinAlign(original: string[], spoken: string[]): WordComparison[] {
  const m = original.length;
  const n = spoken.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  const trace: string[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(''));

  for (let i = 0; i <= m; i++) { dp[i][0] = i; trace[i][0] = 'del'; }
  for (let j = 0; j <= n; j++) { dp[0][j] = j; trace[0][j] = 'ins'; }
  trace[0][0] = '';

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = original[i - 1] === spoken[j - 1] ? 0 : 1;
      const sub = dp[i - 1][j - 1] + cost;
      const del = dp[i - 1][j] + 1;
      const ins = dp[i][j - 1] + 1;

      if (sub <= del && sub <= ins) {
        dp[i][j] = sub;
        trace[i][j] = cost === 0 ? 'match' : 'sub';
      } else if (del <= ins) {
        dp[i][j] = del;
        trace[i][j] = 'del';
      } else {
        dp[i][j] = ins;
        trace[i][j] = 'ins';
      }
    }
  }

  const result: WordComparison[] = [];
  let i = m, j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const t = trace[i][j];
      if (t === 'match') {
        result.unshift({ original: original[i - 1], spoken: spoken[j - 1], status: 'correct' });
        i--; j--;
      } else if (t === 'sub') {
        const hint = getPhonemeHint(original[i - 1], spoken[j - 1]);
        result.unshift({ original: original[i - 1], spoken: spoken[j - 1], status: 'wrong', phonemeHint: hint });
        i--; j--;
      } else if (t === 'del') {
        result.unshift({ original: original[i - 1], spoken: '', status: 'missing' });
        i--;
      } else {
        result.unshift({ original: '', spoken: spoken[j - 1], status: 'extra' });
        j--;
      }
    } else if (i > 0) {
      result.unshift({ original: original[i - 1], spoken: '', status: 'missing' });
      i--;
    } else {
      result.unshift({ original: '', spoken: spoken[j - 1], status: 'extra' });
      j--;
    }
  }

  return result;
}

export function compareTranscript(
  originalText: string,
  spokenText: string,
  speakDuration?: number,
  expectedDuration?: number,
): ShadowResult {
  const originalWords = originalText.split(/\s+/).filter(Boolean).map(cleanWord);
  const spokenWords = spokenText.split(/\s+/).filter(Boolean).map(cleanWord);

  if (originalWords.length === 0) {
    return { score: 0, accuracy: 0, fluency: 0, completeness: 0, words: [], correctCount: 0, totalCount: 0 };
  }

  const words = levenshteinAlign(originalWords, spokenWords);
  const correctCount = words.filter(w => w.status === 'correct').length;
  const totalCount = originalWords.length;
  const accuracy = Math.round((correctCount / totalCount) * 100);

  const attemptedCount = words.filter(w => w.status === 'correct' || w.status === 'wrong').length;
  const completeness = Math.round((attemptedCount / totalCount) * 100);

  let fluency = accuracy;
  if (speakDuration && expectedDuration && expectedDuration > 0) {
    const ratio = speakDuration / expectedDuration;
    const rawFluency = 100 * Math.exp(-Math.pow(ratio - 1, 2) / 0.5);
    fluency = Math.round(rawFluency * 0.6 + accuracy * 0.4);
  }

  const overall = Math.round(accuracy * (0.5 + 0.3 * (fluency / 100) + 0.2 * (completeness / 100)));

  return { score: overall, accuracy, fluency, completeness, words, correctCount, totalCount };
}

export function getScoreLabel(score: number): { label: string; color: string; emoji: string } {
  if (score >= 90) return { label: '完美', color: 'text-green-500', emoji: '🎉' };
  if (score >= 75) return { label: '优秀', color: 'text-green-400', emoji: '👏' };
  if (score >= 60) return { label: '不错', color: 'text-yellow-400', emoji: '💪' };
  if (score >= 40) return { label: '继续加油', color: 'text-orange-400', emoji: '🔄' };
  return { label: '再试一次', color: 'text-red-400', emoji: '🎯' };
}
