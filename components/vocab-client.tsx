'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Trash2, Search, ExternalLink, LayoutList, Network,
  Brain, BookOpen, Volume2, Pencil,
} from 'lucide-react';
import VocabMindMap from './vocab-mindmap';
import VocabReview from './vocab-review';
import VocabStats from './vocab-stats';

interface VocabWord {
  id: string;
  word: string;
  phonetic?: string;
  definition: string;
  example?: string;
  context: string;
  videoId: string;
  videoTitle: string;
  timestamp: number;
  proficiency: number;
  reviewCount: number;
  nextReviewAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type ViewMode = 'list' | 'mindmap' | 'review' | 'stats';

export default function VocabClient() {
  const [words, setWords] = useState<VocabWord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDef, setEditDef] = useState('');

  const fetchWords = useCallback(async () => {
    setLoading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
      const res = await fetch('/api/vocab', {
        headers: token ? { Authorization: `Bearer ${token}` } as Record<string, string> : {},
      });
      const data = await res.json();
      setWords(data.words || []);
    } catch {
      setWords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWords();
  }, [fetchWords]);

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个单词吗？')) return;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
      await fetch(`/api/vocab?id=${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } as Record<string, string> : {},
      });
      fetchWords();
    } catch {
      alert('删除失败，请重试');
    }
  };

  const handleSaveEdit = async (id: string) => {
    if (!editDef.trim()) return;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
      const res = await fetch('/api/vocab', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id, definition: editDef.trim() }),
      });
      if (res.ok) {
        setEditingId(null);
        fetchWords();
      } else {
        alert('保存失败，请重试');
      }
    } catch {
      alert('网络错误，请重试');
    }
  };

  const handlePlayAudio = (word: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    speechSynthesis.speak(utterance);
  };

  const filtered = searchQuery
    ? words.filter(
        (v) =>
          v.word.toLowerCase().includes(searchQuery.toLowerCase()) ||
          v.definition.toLowerCase().includes(searchQuery.toLowerCase()) ||
          v.context.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : words;

  const renderProficiency = (level: number) => {
    const colors = ['bg-muted', 'bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-blue-400', 'bg-green-500'];
    return (
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={`w-1.5 h-3 rounded-sm ${i < level ? colors[level] : 'bg-muted'}`}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { key: 'list' as ViewMode, label: '单词列表', icon: LayoutList },
          { key: 'review' as ViewMode, label: '今日复习', icon: Brain },
          { key: 'stats' as ViewMode, label: '学习统计', icon: BookOpen },
          { key: 'mindmap' as ViewMode, label: '思维导图', icon: Network },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setViewMode(key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      {viewMode === 'review' && (
        <VocabReview onComplete={() => { setViewMode('list'); fetchWords(); }} />
      )}

      {viewMode === 'stats' && <VocabStats />}

      {viewMode === 'mindmap' && (
        <VocabMindMap
          items={filtered.map(w => ({
            word: w.word,
            definition: w.definition,
            context: w.context,
            videoId: w.videoId,
            videoTitle: w.videoTitle,
            timestamp: w.timestamp,
            addedAt: w.createdAt,
            proficiency: w.proficiency,
          }))}
        />
      )}

      {viewMode === 'list' && (
        <>
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="搜索单词、释义或上下文..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-muted border border-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-24 border border-dashed border-border rounded-xl">
              <BookOpen className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground text-lg">
                {words.length === 0 ? '生词本还是空的' : '没有匹配的单词'}
              </p>
              {words.length === 0 && (
                <p className="text-muted-foreground/70 mt-2 text-sm">
                  在视频播放页点击字幕中的单词，加入生词本开始学习
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((item) => (
                <div
                  key={item.id}
                  className="bg-card border border-border rounded-lg p-4 hover:border-ring/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h3 className="text-lg font-semibold">{item.word}</h3>
                        {item.phonetic && (
                          <span className="text-sm text-muted-foreground">{item.phonetic}</span>
                        )}
                        <button
                          onClick={() => handlePlayAudio(item.word)}
                          className="p-1 rounded hover:bg-muted transition-colors"
                        >
                          <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        {renderProficiency(item.proficiency)}
                        <Link
                          href={`/${item.videoId}?t=${Math.floor(item.timestamp)}`}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" />
                          来源
                        </Link>
                      </div>

                      {editingId === item.id ? (
                        <div className="flex items-center gap-2 mt-2">
                          <input
                            type="text"
                            value={editDef}
                            onChange={(e) => setEditDef(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit(item.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="flex-1 px-3 py-1.5 bg-muted border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveEdit(item.id)}
                            className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
                          >
                            保存
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1.5 text-xs bg-muted rounded hover:bg-muted/80 transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2">
                          <p
                            className="text-sm text-muted-foreground flex-1 cursor-pointer hover:text-foreground transition-colors"
                            onClick={() => { setEditingId(item.id); setEditDef(item.definition); }}
                            title="点击编辑释义"
                          >
                            {item.definition || '（暂无释义，点击添加）'}
                          </p>
                          <button
                            onClick={() => { setEditingId(item.id); setEditDef(item.definition); }}
                            className="p-1 rounded hover:bg-muted transition-colors shrink-0"
                          >
                            <Pencil className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </div>
                      )}

                      {item.example && (
                        <p className="text-xs text-muted-foreground/70 mt-2 italic border-l-2 border-primary/30 pl-3">
                          {item.example}
                        </p>
                      )}

                      {item.context && (
                        <p className="text-xs text-muted-foreground/50 mt-2">
                          {item.context}
                        </p>
                      )}

                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/60">
                        <span>{item.videoTitle || item.videoId}</span>
                        <span>·</span>
                        <span>复习 {item.reviewCount} 次</span>
                        <span>·</span>
                        <span>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleDelete(item.id)}
                      className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
