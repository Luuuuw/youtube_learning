'use client';

import { useState, useEffect, useCallback } from 'react';
import { RotateCcw, Check, X, Brain, TrendingUp, Volume2 } from 'lucide-react';

interface ReviewWord {
  id: string;
  word: string;
  phonetic?: string;
  definition: string;
  example?: string;
  context: string;
  videoId: string;
  videoTitle: string;
  proficiency: number;
  reviewCount: number;
}

interface VocabReviewProps {
  onComplete?: () => void;
}

export default function VocabReview({ onComplete }: VocabReviewProps) {
  const [words, setWords] = useState<ReviewWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [finished, setFinished] = useState(false);
  const [stats, setStats] = useState({ remembered: 0, forgotten: 0 });

  const fetchDueWords = useCallback(async () => {
    setLoading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
      const res = await fetch('/api/vocab?type=due', {
        headers: token ? { Authorization: `Bearer ${token}` } as Record<string, string> : {},
      });
      const data = await res.json();
      setWords(data.words || []);
      setCurrentIndex(0);
      setFlipped(false);
      setFinished(false);
      setStats({ remembered: 0, forgotten: 0 });
    } catch {
      setWords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDueWords();
  }, [fetchDueWords]);

  const currentWord = words[currentIndex];

  const handleFlip = () => setFlipped(true);

  const handleReview = async (result: 'remember' | 'forget') => {
    if (!currentWord) return;

    const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
    await fetch('/api/vocab', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action: 'review', id: currentWord.id, result }),
    });

    setStats(prev => ({
      remembered: prev.remembered + (result === 'remember' ? 1 : 0),
      forgotten: prev.forgotten + (result === 'forget' ? 1 : 0),
    }));

    if (currentIndex < words.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setFlipped(false);
    } else {
      setFinished(true);
    }
  };

  const handlePlayAudio = () => {
    if (!currentWord || typeof window === 'undefined' || !window.speechSynthesis) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(currentWord.word);
    utterance.lang = 'en-US';
    speechSynthesis.speak(utterance);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (words.length === 0) {
    return (
      <div className="text-center py-16 border border-dashed border-border rounded-xl">
        <Brain className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium mb-1">太棒了！</h3>
        <p className="text-muted-foreground text-sm">目前没有需要复习的单词</p>
        <button
          onClick={fetchDueWords}
          className="mt-4 text-sm text-primary hover:underline"
        >
          刷新检查
        </button>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="text-center py-16 border border-border rounded-xl bg-card">
        <TrendingUp className="h-12 w-12 mx-auto text-primary mb-4" />
        <h3 className="text-xl font-bold mb-2">复习完成！</h3>
        <div className="flex items-center justify-center gap-6 mb-6">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-500">{stats.remembered}</div>
            <div className="text-xs text-muted-foreground">记住</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-500">{stats.forgotten}</div>
            <div className="text-xs text-muted-foreground">遗忘</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">{words.length}</div>
            <div className="text-xs text-muted-foreground">总计</div>
          </div>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={onComplete || (() => {})}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            返回列表
          </button>
          <button
            onClick={fetchDueWords}
            className="px-4 py-2 bg-muted rounded-lg text-sm font-medium hover:bg-muted/80 transition-colors flex items-center gap-1"
          >
            <RotateCcw className="h-4 w-4" />
            检查新复习
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      {/* 进度条 */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
          <span>进度 {currentIndex + 1} / {words.length}</span>
          <span>掌握度 {currentWord.proficiency}/5</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / words.length) * 100}%` }}
          />
        </div>
      </div>

      {/* 卡片 */}
      <div
        className="relative min-h-[320px] cursor-pointer"
        style={{ perspective: '1000px' }}
        onClick={!flipped ? handleFlip : undefined}
      >
        <div
          className={`absolute inset-0 bg-card border border-border rounded-2xl p-8 flex flex-col items-center justify-center transition-all duration-500 ${
            flipped ? 'opacity-0 pointer-events-none scale-95' : 'opacity-100'
          }`}
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div className="text-xs text-muted-foreground mb-4 uppercase tracking-wider">点击翻转查看释义</div>
          <h2 className="text-4xl font-bold mb-3">{currentWord.word}</h2>
          {currentWord.phonetic && (
            <div className="flex items-center gap-2 text-muted-foreground mb-4">
              <span className="text-lg">{currentWord.phonetic}</span>
              <button
                onClick={(e) => { e.stopPropagation(); handlePlayAudio(); }}
                className="p-1.5 rounded-full hover:bg-muted transition-colors"
              >
                <Volume2 className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 mt-4">
            <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
              复习 {currentWord.reviewCount} 次
            </span>
          </div>
        </div>

        <div
          className={`absolute inset-0 bg-card border border-border rounded-2xl p-8 flex flex-col items-center justify-center transition-all duration-500 ${
            flipped ? 'opacity-100' : 'opacity-0 pointer-events-none scale-95'
          }`}
          style={{ backfaceVisibility: 'hidden' }}
        >
          <h2 className="text-2xl font-bold mb-4">{currentWord.word}</h2>
          <p className="text-lg text-center text-foreground mb-4 leading-relaxed">
            {currentWord.definition}
          </p>
          {currentWord.example && (
            <p className="text-sm text-muted-foreground text-center italic border-l-2 border-primary/30 pl-4 mb-4">
              {currentWord.example}
            </p>
          )}
          {currentWord.context && (
            <p className="text-xs text-muted-foreground/60 text-center max-w-sm">
              来源: {currentWord.context}
            </p>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      {flipped && (
        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={() => handleReview('forget')}
            className="flex-1 py-3 rounded-xl bg-red-500/10 text-red-500 font-medium hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
          >
            <X className="h-5 w-5" />
            忘记了
          </button>
          <button
            onClick={() => handleReview('remember')}
            className="flex-1 py-3 rounded-xl bg-green-500/10 text-green-500 font-medium hover:bg-green-500/20 transition-colors flex items-center justify-center gap-2"
          >
            <Check className="h-5 w-5" />
            记住了
          </button>
        </div>
      )}

      {!flipped && (
        <p className="text-center text-sm text-muted-foreground mt-4">
          点击卡片查看释义
        </p>
      )}
    </div>
  );
}
