'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen, NotebookPen, Download, BarChart3, LogOut,
  LayoutGrid, ChevronLeft, ChevronRight, Filter,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  VideoCategory, DifficultyLevel,
  CATEGORY_LABELS, ALL_CATEGORIES, ALL_DIFFICULTIES, DIFFICULTY_LABELS,
} from '@/types/video';

interface SidebarProps {
  categories?: VideoCategory[];
  difficulties?: DifficultyLevel[];
  activeCategory: VideoCategory | null;
  activeDifficulty: DifficultyLevel | null;
  onCategoryChange: (category: VideoCategory | null) => void;
  onDifficultyChange: (difficulty: DifficultyLevel | null) => void;
}

const NAV_ITEMS = [
  { path: '/', label: '学习资源', sub: 'Learning', char: 'L' },
  { path: '/vocab', label: '生词本', sub: 'Vocabulary', char: 'V' },
  { path: '/download', label: '批量下载', sub: 'Download', char: 'D', adminOnly: true },
  { path: '/dashboard', label: '数据看板', sub: 'Dashboard', char: 'M', adminOnly: true },
];

const CAT_CHARS: Record<VideoCategory, string> = {
  beauty: 'B', tech: 'T', lifestyle: 'L', education: 'E',
  entertainment: 'N', business: '$', travel: 'P', food: 'F',
  fitness: 'W', vlog: 'V', other: '?',
};

const DIFF_CHARS: Record<DifficultyLevel, string> = {
  beginner: '1', intermediate: '2', advanced: '3',
};

export default function Sidebar({
  categories = [],
  difficulties = [],
  activeCategory,
  activeDifficulty,
  onCategoryChange,
  onDifficultyChange,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const pathname = usePathname();
  const { role, logout } = useAuth();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const visibleNav = NAV_ITEMS.filter(item => !item.adminOnly || role === 'admin');

  return (
    <aside className={`fixed inset-y-0 left-0 z-40 bg-card border-r border-border transition-all duration-500 hidden lg:block ${collapsed ? 'w-[60px]' : 'w-[200px]'}`}>
      <div className="relative h-full flex flex-col">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-card border border-border shadow-sm flex items-center justify-center hover:bg-muted transition-colors z-50 cursor-pointer"
          title={collapsed ? '展开' : '收起'}
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
        </button>

        <div className={`px-4 py-4 border-b border-border flex items-center ${collapsed ? 'justify-center' : ''}`}>
          {collapsed ? (
            <span className="font-black text-lg text-primary">V</span>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tracking-tight text-primary">VE</span>
              <span className="text-xs text-muted-foreground/60 font-medium">English</span>
            </div>
          )}
        </div>

        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          <div className={`${collapsed ? 'space-y-2' : 'space-y-0.5 mb-5'}`}>
            {visibleNav.map((item) => {
              const active = isActive(item.path);
              const hovered = hoveredId === `nav-${item.path}`;
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onMouseEnter={() => setHoveredId(`nav-${item.path}`)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={`
                    group relative flex items-center overflow-hidden rounded-lg transition-all duration-300 cursor-pointer
                    ${collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-2.5 py-2'}
                    ${active ? 'bg-primary/8' : 'hover:bg-muted/50'}
                  `}
                >
                  <span className={`
                    shrink-0 font-black leading-none transition-all duration-300 origin-left
                    ${active ? 'text-primary' : 'text-muted-foreground/30 group-hover:text-primary'}
                    ${hovered && !collapsed ? 'scale-110' : ''}
                    ${collapsed ? 'text-lg' : hovered ? 'text-2xl -ml-0.5' : 'text-xl'}
                  `}
                  style={active && hovered ? { textShadow: '0 0 20px rgba(99,102,241,0.4)' } : undefined}
                  >{item.char}</span>
                  {!collapsed && (
                    <div className="flex-1 min-w-0">
                      <div className={`font-medium text-[13px] tracking-wide transition-colors duration-200 ${active ? 'text-primary' : 'text-foreground/80 group-hover:text-foreground'}`}>{item.label}</div>
                      <div className={`text-[9px] tracking-widest uppercase transition-colors duration-200 mt-0.5 ${active ? 'text-primary/50' : 'text-muted-foreground/40 group-hover:text-muted-foreground/70'}`}>{item.sub}</div>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>

          {pathname === '/' && !collapsed && (
            <div className="mt-5 space-y-5">
              <div>
                <div className="flex items-center gap-1.5 mb-2 px-0.5">
                  <Filter className="h-2.5 w-2.5 text-muted-foreground/40" />
                  <span className="text-[9px] font-semibold tracking-widest uppercase text-muted-foreground/40">Categories</span>
                </div>
                <div className="space-y-0.5">
                  <button
                    onClick={() => onCategoryChange(null)}
                    onMouseEnter={() => setHoveredId('cat-all')}
                    onMouseLeave={() => setHoveredId(null)}
                    className={`
                      group relative w-full flex items-center gap-2.5 px-2 py-2 rounded-lg transition-all duration-300
                      ${activeCategory === null ? 'bg-primary/8' : 'hover:bg-muted/40'}
                    `}
                  >
                    <span className={`
                      shrink-0 font-black leading-none transition-all duration-300 w-5 text-center
                      ${activeCategory === null ? 'text-primary' : 'text-muted-foreground/25 group-hover:text-foreground/60'}
                      ${hoveredId === 'cat-all' ? 'text-lg scale-110' : 'text-sm'}
                    `}>*</span>
                    <span className={`text-[13px] font-medium transition-colors ${activeCategory === null ? 'text-primary' : 'text-foreground/60 group-hover:text-foreground'}`}>全部</span>
                  </button>
                  {ALL_CATEGORIES.filter(cat => categories.includes(cat)).map((category) => {
                    const hid = `cat-${category}`;
                    const active = activeCategory === category;
                    const hovered = hoveredId === hid;
                    return (
                      <button
                        key={category}
                        onClick={() => onCategoryChange(category)}
                        onMouseEnter={() => setHoveredId(hid)}
                        onMouseLeave={() => setHoveredId(null)}
                        className={`
                          group relative w-full flex items-center gap-2.5 px-2 py-2 rounded-lg transition-all duration-300
                          ${active ? 'bg-primary/8' : 'hover:bg-muted/40'}
                        `}
                      >
                        <span
                          className={`
                            shrink-0 font-black leading-none transition-all duration-300 w-5 text-center
                            ${active ? '' : 'text-muted-foreground/25 group-hover:text-foreground/60'}
                            ${hovered ? 'text-lg scale-110' : 'text-sm'}
                          `}
                          style={active ? { color: CATEGORY_LABELS[category].color } : undefined}
                        >{CAT_CHARS[category]}</span>
                        <span className={`text-[13px] font-medium transition-colors ${active ? '' : 'text-foreground/60 group-hover:text-foreground'}`}
                          style={active ? { color: CATEGORY_LABELS[category].color } : undefined}
                        >{CATEGORY_LABELS[category].label}</span>
                        {hovered && (
                          <span className="ml-auto text-[10px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-muted-foreground">{CATEGORY_LABELS[category].icon}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-2 px-0.5">
                  <Filter className="h-2.5 w-2.5 text-muted-foreground/40" />
                  <span className="text-[9px] font-semibold tracking-widest uppercase text-muted-foreground/40">Level</span>
                </div>
                <div className="space-y-0.5">
                  <button
                    onClick={() => onDifficultyChange(null)}
                    onMouseEnter={() => setHoveredId('diff-all')}
                    onMouseLeave={() => setHoveredId(null)}
                    className={`
                      group relative w-full flex items-center gap-2.5 px-2 py-2 rounded-lg transition-all duration-300
                      ${activeDifficulty === null ? 'bg-primary/8' : 'hover:bg-muted/40'}
                    `}
                  >
                    <span className={`
                      shrink-0 font-black leading-none transition-all duration-300 w-5 text-center
                      ${activeDifficulty === null ? 'text-primary' : 'text-muted-foreground/25 group-hover:text-foreground/60'}
                      ${hoveredId === 'diff-all' ? 'text-lg scale-110' : 'text-sm'}
                    `}>∞</span>
                    <span className={`text-[13px] font-medium transition-colors ${activeDifficulty === null ? 'text-primary' : 'text-foreground/60 group-hover:text-foreground'}`}>全部</span>
                  </button>
                  {ALL_DIFFICULTIES.filter(diff => difficulties.includes(diff)).map((difficulty) => {
                    const hid = `diff-${difficulty}`;
                    const active = activeDifficulty === difficulty;
                    const hovered = hoveredId === hid;
                    return (
                      <button
                        key={difficulty}
                        onClick={() => onDifficultyChange(difficulty)}
                        onMouseEnter={() => setHoveredId(hid)}
                        onMouseLeave={() => setHoveredId(null)}
                        className={`
                          group relative w-full flex items-center gap-2.5 px-2 py-2 rounded-lg transition-all duration-300
                          ${active ? 'bg-primary/8' : 'hover:bg-muted/40'}
                        `}
                      >
                        <span
                          className={`
                            shrink-0 font-black leading-none transition-all duration-300 w-5 text-center
                            ${active ? '' : 'text-muted-foreground/25 group-hover:text-foreground/60'}
                            ${hovered ? 'text-lg scale-110' : 'text-sm'}
                          `}
                          style={active ? { color: DIFFICULTY_LABELS[difficulty].color } : undefined}
                        >{DIFF_CHARS[difficulty]}</span>
                        <span className={`text-[13px] font-medium transition-colors ${active ? '' : 'text-foreground/60 group-hover:text-foreground'}`}
                          style={active ? { color: DIFFICULTY_LABELS[difficulty].color } : undefined}
                        >{DIFFICULTY_LABELS[difficulty].label}</span>
                        {hovered && (
                          <span className="ml-auto text-[10px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-muted-foreground">{DIFFICULTY_LABELS[difficulty].label}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </nav>

        <div className="px-3 py-3 border-t border-border">
          <button
            onClick={logout}
            onMouseEnter={() => setHoveredId('logout')}
            onMouseLeave={() => setHoveredId(null)}
            className={`
              group relative w-full flex items-center overflow-hidden rounded-lg transition-all duration-300 cursor-pointer
              ${collapsed ? 'justify-center px-0 py-2' : 'gap-3 px-2 py-2 hover:bg-red-500/5'}
            `}
          >
            <span className={`
              shrink-0 font-black leading-none transition-all duration-300 origin-left
              text-muted-foreground/30 group-hover:text-red-400
              ${hoveredId === 'logout' && !collapsed ? 'scale-110' : ''}
              ${collapsed ? 'text-lg' : hoveredId === 'logout' ? 'text-xl -ml-0.5' : 'text-lg'}
            `}>X</span>
            {!collapsed && (
              <span className="text-[13px] font-medium text-foreground/60 group-hover:text-red-400 transition-colors">退出登录</span>
            )}
          </button>
        </div>
      </div>
    </aside>
  );

  function isActive(path: string) {
    return pathname === path;
  }
}
