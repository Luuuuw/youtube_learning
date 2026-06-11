import React from 'react';
import {
  BookOpen,
  Check,
  EyeOff,
  Languages,
  Loader2,
  Pencil,
  Save,
  Search,
  Subtitles,
  Tag,
  X,
} from 'lucide-react';

type TabType = 'subtitles' | 'keyvocab';

interface SubtitleHeaderProps {
  tab: TabType;
  onTabChange: (tab: TabType) => void;
  showZh: boolean;
  onToggleZh: () => void;
  hasZhSubtitles: boolean;
  onTranslate: () => void;
  translating: boolean;
  translateError: string;
  isAdmin: boolean;
  editMode: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  highlightEnabled: boolean;
  onToggleHighlight: () => void;
  onResumeAutoScroll: () => void;
  keyVocabCount: number;
}

export function SubtitleHeader({
  tab,
  onTabChange,
  showZh,
  onToggleZh,
  hasZhSubtitles,
  onTranslate,
  translating,
  translateError,
  isAdmin,
  editMode,
  onEdit,
  onSave,
  onCancel,
  saving,
  searchQuery,
  onSearchChange,
  highlightEnabled,
  onToggleHighlight,
  onResumeAutoScroll,
  keyVocabCount,
}: SubtitleHeaderProps) {
  return (
    <div className="p-3 sm:p-4 border-b border-border space-y-2 sm:space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onTabChange('subtitles')}
            className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 text-xs rounded-md transition-colors ${
              tab === 'subtitles'
                ? 'bg-primary text-primary-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <Subtitles className="h-3.5 w-3.5" />
            字幕
          </button>
          <button
            onClick={() => onTabChange('keyvocab')}
            className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 text-xs rounded-md transition-colors ${
              tab === 'keyvocab'
                ? 'bg-primary text-primary-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            词汇
            {keyVocabCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 bg-muted rounded-full text-[10px]">
                {keyVocabCount}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end">
          {tab === 'subtitles' && (
            <>
              {hasZhSubtitles && !editMode ? (
                <button
                  onClick={onToggleZh}
                  className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors ${
                    showZh
                      ? 'bg-white text-black font-medium'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {showZh ? <Languages className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                  {showZh ? '中文' : '隐藏中文'}
                </button>
              ) : !hasZhSubtitles ? (
                <button
                  onClick={onTranslate}
                  disabled={translating}
                  className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors ${
                    translating
                      ? 'bg-muted text-muted-foreground cursor-wait'
                      : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 font-medium'
                  }`}
                >
                  {translating ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Languages className="h-3 w-3" />
                  )}
                  {translating ? '翻译中...' : '翻译字幕'}
                </button>
              ) : null}

              {isAdmin && hasZhSubtitles && !editMode && (
                <button
                  onClick={onEdit}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20 font-medium transition-colors"
                >
                  <Pencil className="h-3 w-3" />
                  编辑
                </button>
              )}

              {editMode && (
                <>
                  <button
                    onClick={onSave}
                    disabled={saving}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 font-medium transition-colors"
                  >
                    {saving ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3" />
                    )}
                    {saving ? '保存中...' : '保存'}
                  </button>
                  <button
                    onClick={onCancel}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3 w-3" />
                    取消
                  </button>
                </>
              )}

              {!editMode && (
                <>
                  <button
                    onClick={onToggleHighlight}
                    className={`hidden sm:flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors ${
                      highlightEnabled
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Tag className="h-3 w-3" />
                    高亮
                  </button>
                  <button
                    onClick={onResumeAutoScroll}
                    className="hidden sm:block px-2 py-1 text-xs rounded-md bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    回到当前
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {editMode && (
        <div className="text-xs text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 px-2 py-1.5 rounded-md">
          编辑模式：点击中文翻译即可修改，修改完成后点击「保存」
        </div>
      )}

      {tab === 'subtitles' && translateError && (
        <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1.5 rounded-md">
          {translateError}
        </div>
      )}

      {tab === 'subtitles' && !editMode && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索字幕..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-muted border border-border rounded-md text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}
    </div>
  );
}
