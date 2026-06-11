'use client';

import { useState, useEffect } from 'react';
import { X, Sparkles, ArrowRight, Pencil, Check, Loader2 } from 'lucide-react';

interface AnnouncementModalProps {
  isOpen: boolean;
  onClose: () => void;
  isFirstTimeUser?: boolean;
  streakDays?: number;
  dueWordsCount?: number;
  isAdmin?: boolean;
  adminEdit?: boolean;
}

const ONBOARDING_TEXT = `🎯 欢迎使用 VibeEnglish！以下是七步沉浸式学习法：

① 选视频 — 找到舒适区起点
在首页浏览视频时注意难度标签：初级(绿)、中级(蓝)、高级(紫)。建议从中级开始——太简单学不到东西，太难容易放弃。选择你感兴趣的话题，兴趣是最好的老师。

② 盲听第一遍 — 训练"英语耳朵"
进入视频后先不要开字幕！完整听一遍。目标不是听懂每个词，而是抓住大意和关键信息。能听懂60%就很棒了。这就像看无字幕的外国电影，强迫大脑主动处理语音信号，是提升听力最有效的方法。

③ 开启字幕 — 发现听力盲区
听完第一遍后点击 CC按钮 开启字幕。第二遍对比"以为听到的"和"实际说的"。你会发现很多连读、弱读、吞音之前完全没注意到。这些没听懂的句子就是你接下来的突破点。

④ 悬停查词 — 精准消灭生词
鼠标移到字幕中不认识的单词上，会弹出AI翻译和释义。觉得重要？点击一下自动加入生词本。不用手动输入、不用切换词典，学习完全不中断。建议每视频收藏5-10个词，贪多嚼不烂。

⑤ 循环播放难句 — 死磕到底
遇到怎么都听不懂的长句？点击句子旁的循环按钮反复播放。跟着读，模仿语调重音停顿。一遍不行来五遍，直到流畅复述为止。这种"精听"训练是突破听力瓶颈的关键。

⑥ 生词复习 — 趁热打铁
看完视频点导航栏 生词本 图标。今天加入的单词都在这里，系统用间隔重复算法(SRS)安排最佳复习时间。刚学的词标记为"待复习"，花3-5分钟过一遍，记忆效果比临时抱佛脚强300%。

⑦ 查看总结 — 记录每一天
学习结束点首页右上角 📋总结 按钮。看到完整数据：看了几个视频、学了几个新词、复习正确率是多少。连续学习天数会累积，每天坚持15分钟，一个月后你会惊讶于自己的进步。

💡 按照这七步顺序学习，每次 15-20 分钟。不需要多，关键是每天坚持。英语能力会在不知不觉中提升。`;

const DEFAULT_ANNOUNCEMENT = `## 🎯 VibeEnglish 七步沉浸式学习法

这是基于二语习得理论设计的完整学习流程，每一步都有明确的目标和操作方法。按照这个顺序学习，15-20分钟就能获得最大效果。

**① 选视频 — 找到舒适区起点**
在首页浏览视频时注意难度标签：初级(绿)、中级(蓝)、高级(紫)。建议从**中级(intermediate)**开始——太简单学不到东西，太难容易放弃。选择你感兴趣的话题，兴趣是最好的老师。

**② 盲听第一遍 — 训练"英语耳朵"**
进入视频后**先不要开字幕**！完整听一遍。目标不是听懂每个词，而是抓住大意和关键信息。能听懂60%就很棒了。这就像看无字幕的外国电影，强迫大脑主动处理语音信号，是提升听力最有效的方法。

**③ 开启字幕 — 发现听力盲区**
听完第一遍后点击 **CC按钮** 开启字幕。第二遍对比你"以为听到的"和"实际说的"。你会发现很多连读、弱读、吞音之前完全没注意到。这些没听懂的句子就是你接下来的突破点。

**④ 悬停查词 — 精准消灭生词**
鼠标移到字幕中不认识的单词上，会弹出AI翻译和释义。觉得重要？**点击一下**自动加入生词本。不用手动输入、不用切换词典，学习完全不中断。建议每视频收藏5-10个词，贪多嚼不烂。

**⑤ 循环播放难句 — 死磕到底**
遇到怎么都听不懂的长句？点击句子旁的 **循环按钮🔁** 反复播放。跟着读，模仿语调重音停顿。一遍不行来五遍，直到流畅复述为止。这种"精听"训练是突破听力瓶颈的关键。

**⑥ 生词复习 — 趁热打铁**
看完视频点导航栏 **生词本** 图标。今天加入的单词都在这里，系统用**间隔重复算法(SRS)**安排最佳复习时间。刚学的词标记为"待复习"，花3-5分钟过一遍，记忆效果比临时抱佛脚强300%。

**⑦ 查看总结 — 记录每一天**
学习结束点首页右上角 **📋总结** 按钮。看到完整数据：看了几个视频、学了几个新词、复习正确率是多少。连续学习天数会累积，每天坚持15分钟，一个月后你会惊讶于自己的进步。`;

export default function AnnouncementModal({
  isOpen,
  onClose,
  isFirstTimeUser = false,
  isAdmin = false,
  adminEdit = false,
}: AnnouncementModalProps) {
  const [showOnboarding, setShowOnboarding] = useState(isFirstTimeUser);
  const [dontShowToday, setDontShowToday] = useState(false);
  const [announcementContent, setAnnouncementContent] = useState(DEFAULT_ANNOUNCEMENT);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (adminEdit && isAdmin) {
        fetch('/api/announcement')
          .then(r => r.json())
          .then(data => {
            if (data.announcement?.content) {
              setAnnouncementContent(data.announcement.content);
              setEditText(data.announcement.content);
            } else {
              setEditText(announcementContent);
            }
            setEditing(true);
            setShowOnboarding(false);
          })
          .catch(() => {
            setEditText(announcementContent);
            setEditing(true);
          });
        return;
      }
      const saved = localStorage.getItem('ve-dont-show-announcement');
      if (saved === new Date().toISOString().slice(0, 10)) { onClose(); return; }
      const hasSeenOnboarding = localStorage.getItem('ve-seen-onboarding');
      setShowOnboarding(!hasSeenOnboarding);

      fetch('/api/announcement')
        .then(r => r.json())
        .then(data => {
          if (data.announcement?.content) setAnnouncementContent(data.announcement.content);
        })
        .catch(() => {});
    }
  }, [isOpen, onClose, adminEdit, isAdmin]);

  if (!isOpen) return null;

  const handleStartLearning = () => {
    localStorage.setItem('ve-seen-onboarding', '1');
    handleDontShowAndClose();
  };

  const handleSkipOnboarding = () => {
    localStorage.setItem('ve-seen-onboarding', '1');
    setShowOnboarding(false);
  };

  const handleDontShowAndClose = () => {
    if (dontShowToday) localStorage.setItem('ve-dont-show-announcement', new Date().toISOString().slice(0, 10));
    onClose();
  };

  const startEdit = () => {
    setEditText(announcementContent);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditText('');
  };

  const saveAnnouncement = async () => {
    if (editText.trim().length < 50) return;
    setSaving(true);
    try {
      const token = localStorage.getItem('ve-session-token') || '';
      const res = await fetch('/api/announcement', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: editText.trim() }),
      });
      if (res.ok) {
        setAnnouncementContent(editText.trim());
        setEditing(false);
      }
    } catch {}
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleDontShowAndClose} />

      <div className="relative w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] flex flex-col">
        {showOnboarding ? (
          <OnboardingView
            text={ONBOARDING_TEXT}
            onStart={handleStartLearning}
            onSkip={handleSkipOnboarding}
          />
        ) : (
          <DailyAnnouncementView
            content={announcementContent}
            editing={editing}
            editText={editText}
            saving={saving}
            isAdmin={isAdmin}
            dontShowToday={dontShowToday}
            onToggleDontShow={() => setDontShowToday(!dontShowToday)}
            onEditStart={startEdit}
            onEditTextChange={setEditText}
            onSave={saveAnnouncement}
            onCancelEdit={cancelEdit}
            onClose={handleDontShowAndClose}
          />
        )}
      </div>
    </div>
  );
}

function OnboardingView({
  text,
  onStart,
  onSkip,
}: {
  text: string;
  onStart: () => void;
  onSkip: () => void;
}) {
  const lines = text.split('\n');

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-6 pt-5 pb-3 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-400" />
          <span className="text-sm font-semibold">新手引导 · 七步学习法</span>
        </div>
        <button onClick={onSkip} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          跳过
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <div className="space-y-3 text-sm leading-relaxed">
          {lines.map((line, i) => {
            const trimmed = line.trim();
            if (!trimmed) return <div key={i} className="h-2" />;
            if (trimmed.startsWith('🎯')) return <p key={i} className="text-base font-bold mt-1">{trimmed}</p>;
            if (/^[①②③④⑤⑥⑦]/.test(trimmed)) return <p key={i} className="font-semibold text-foreground mt-3 first:mt-0">{trimmed}</p>;
            return <p key={i} className="text-muted-foreground pl-4">{trimmed}</p>;
          })}
        </div>
      </div>

      <div className="px-6 py-4 bg-muted/30 border-t border-border shrink-0 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">共 7 步 · 全部展示</span>
        <button
          onClick={onStart}
          className="px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-1.5"
        >
          我知道了，开始学习
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function DailyAnnouncementView({
  content,
  editing,
  editText,
  saving,
  isAdmin,
  dontShowToday,
  onToggleDontShow,
  onEditStart,
  onEditTextChange,
  onSave,
  onCancelEdit,
  onClose,
}: {
  content: string;
  editing: boolean;
  editText: string;
  saving: boolean;
  isAdmin: boolean;
  dontShowToday: boolean;
  onToggleDontShow: () => void;
  onEditStart: () => void;
  onEditTextChange: (v: string) => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onClose: () => void;
}) {
  function renderMarkdown(text: string) {
    const lines = text.split('\n');
    return lines.map((line, i) => {
      const trimmed = line.trim();
      if (!trimmed) return <br key={i} />;
      if (trimmed.startsWith('## ')) return <h3 key={i} className="text-base font-bold mt-4 mb-2 first:mt-0">{trimmed.slice(3)}</h3>;
      if (trimmed.startsWith('**') && trimmed.endsWith('**')) return <p key={i} className="text-sm font-medium my-1.5">{trimmed.slice(2, -2)}</p>;
      if (trimmed.startsWith('**')) {
        const parts = trimmed.split(/\*\*/g);
        return (
          <p key={i} className="text-sm leading-relaxed my-1.5">
            {parts.map((part, j) => j % 2 === 1 ? <strong key={j}>{part}</strong> : part)}
          </p>
        );
      }
      return <p key={i} className="text-sm leading-relaxed my-1.5">{trimmed}</p>;
    });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-6 pt-5 pb-3 shrink-0 flex items-center justify-between">
        <h2 className="text-base font-bold">每日公告</h2>
        <div className="flex items-center gap-2">
          {isAdmin && !editing && (
            <button onClick={onEditStart} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="编辑公告">
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        {editing ? (
          <div className="space-y-3">
            <textarea
              value={editText}
              onChange={(e) => onEditTextChange(e.target.value)}
              className="w-full h-[320px] bg-muted border border-border rounded-xl p-4 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 leading-relaxed"
              placeholder="输入公告内容（支持 Markdown 格式）..."
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{editText.length} 字符（至少需要 50 字符）</span>
              <div className="flex items-center gap-2">
                <button onClick={onCancelEdit} className="px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors">
                  取消
                </button>
                <button
                  onClick={onSave}
                  disabled={saving || editText.trim().length < 50}
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  保存
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {renderMarkdown(content)}
          </div>
        )}
      </div>

      {!editing && (
        <div className="px-6 py-3.5 bg-muted/30 border-t border-border shrink-0 flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={dontShowToday} onChange={onToggleDontShow} className="rounded border-border" />
            <span className="text-xs text-muted-foreground">今天不再提示</span>
          </label>
          <button onClick={onClose} className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
            开始学习
          </button>
        </div>
      )}
    </div>
  );
}
