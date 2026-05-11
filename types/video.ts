export interface VideoMeta {
  id: string;
  title: string;
  description?: string;
  duration?: number;
  thumbnail?: string;
  downloadedAt?: string;
  accent?: 'british' | 'american' | 'other';
  category?: VideoCategory;
  difficulty?: DifficultyLevel;
}

export type VideoCategory =
  | 'beauty'       // 美妆
  | 'tech'         // 科技
  | 'lifestyle'    // 生活
  | 'education'    // 教育
  | 'entertainment' // 娱乐
  | 'business'     // 商业
  | 'travel'       // 旅行
  | 'food'         // 美食
  | 'fitness'      // 健身
  | 'vlog'         // Vlog
  | 'other';       // 其他

export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';

export const CATEGORY_LABELS: Record<VideoCategory, { label: string; icon: string; color: string }> = {
  beauty:        { label: '美妆', icon: '✨', color: '#ec4899' },
  tech:          { label: '科技', icon: '💻', color: '#3b82f6' },
  lifestyle:     { label: '生活', icon: '🏠', color: '#f97316' },
  education:     { label: '教育', icon: '📚', color: '#8b5cf6' },
  entertainment: { label: '娱乐', icon: '🎬', color: '#ef4444' },
  business:      { label: '商业', icon: '💼', color: '#6366f1' },
  travel:        { label: '旅行', icon: '✈️', color: '#14b8a6' },
  food:          { label: '美食', icon: '🍜', color: '#eab308' },
  fitness:       { label: '健身', icon: '💪', color: '#22c55e' },
  vlog:          { label: 'Vlog', icon: '📹', color: '#f43f5e' },
  other:         { label: '其他', icon: '📌', color: '#64748b' },
};

export const DIFFICULTY_LABELS: Record<DifficultyLevel, { label: string; color: string; bg: string }> = {
  beginner:     { label: '入门', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
  intermediate: { label: '中级', color: '#eab308', bg: 'rgba(234,179,8,0.1)' },
  advanced:     { label: '高级', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
};

export const ALL_CATEGORIES: VideoCategory[] = [
  'beauty', 'tech', 'lifestyle', 'education', 'entertainment',
  'business', 'travel', 'food', 'fitness', 'vlog', 'other',
];

export const ALL_DIFFICULTIES: DifficultyLevel[] = ['beginner', 'intermediate', 'advanced'];