// 集中管理所有 AI model id + endpoint + version。
//
// 目的：所有外部 LLM/ASR 调用统一从 AI_MODELS 拿 id 和 endpoint，
// 不再到处散布 'MiniMax-M3' / 'deepseek-chat' / 'api.minimaxi.com' 字符串。
//
// 升级 model 时改这一处即可；同时 audit log / metrics 可以从响应里抓 model + response.id
// 比对发送的 id 和服务端实际跑的 id。
//
// API Key 仍然每个调用方自己读 process.env[apiKeyEnv]（这里只声明哪个 env var）。

export interface AiModelConfig {
  id: string;
  vendor: 'minimax' | 'deepseek' | 'siliconflow';
  version: string;           // 记录的版本号，仅文档作用
  endpoint: string;
  apiKeyEnv: string;         // 用哪个 env var
}

export const AI_MODELS = {
  // MiniMax LLM（最新 M3，2026-05-31）
  minimax_chat: {
    id: 'MiniMax-M3',
    vendor: 'minimax' as const,
    version: '2026-05-31',
    endpoint: 'https://api.minimaxi.com/v1/text/chatcompletion_v2',
    apiKeyEnv: 'MINIMAX_API_KEY',
  },
  // DeepSeek V4-Flash（chat alias → 自动映射）
  deepseek_chat: {
    id: 'deepseek-chat',
    vendor: 'deepseek' as const,
    version: '2026-Q2-v4-flash',
    endpoint: 'https://api.deepseek.com/chat/completions',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
  },
  // SiliconFlow SenseVoice ASR（免费）
  siliconflow_asr: {
    id: 'FunAudioLLM/SenseVoiceSmall',
    vendor: 'siliconflow' as const,
    version: 'open-source-2024',
    endpoint: 'https://api.siliconflow.cn/v1/audio/transcriptions',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
  },
} as const;

export type AiModelKey = keyof typeof AI_MODELS;

/** 从 fetch 响应里抓 model + response.id（统计 audit metadata 用） */
export function extractModelMetadata(responseJson: unknown): { model?: string; responseId?: string } {
  if (!responseJson || typeof responseJson !== 'object') return {};
  const r = responseJson as { model?: unknown; id?: unknown };
  return {
    model: typeof r.model === 'string' ? r.model : undefined,
    responseId: typeof r.id === 'string' ? r.id : undefined,
  };
}
