'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  X, ChevronRight, ChevronLeft, CheckCircle2, XCircle, Mic, MicOff,
  Loader2, RotateCcw, Trophy, Target, Brain, Sparkles,
  Play, Pause, Tag, Star,
} from 'lucide-react';

interface QuizQuestion {
  id: number;
  type: 'choice' | 'speaking';
  question: string;
  options?: string[];
  answer: string;
  explanation: string;
  referenceAnswer: string;
  hint: string;
  startTime: number;
  endTime: number;
  difficulty: 'easy' | 'medium' | 'hard';
  relatedWords: string[];
}

interface VideoQuizProps {
  open: boolean;
  onClose: () => void;
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  subtitles: { id: number; text: string; startTime: number; endTime: number }[];
  videoRef?: React.RefObject<HTMLVideoElement>;
}

const DIFFICULTY_CONFIG = {
  easy:   { label: '简单', color: 'bg-green-500/15 text-green-400 border-green-500/30', dot: 'bg-green-400' },
  medium: { label: '中等', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', dot: 'bg-yellow-400' },
  hard:   { label: '困难', color: 'bg-red-500/15 text-red-400 border-red-500/30', dot: 'bg-red-400' },
};

const STAR_COLORS = ['#4ade80', '#60a5fa', '#facc15', '#f87171'];

const STAR_DETAIL = [
  { label: '入门', desc: '简单词汇 · 基础句型' },
  { label: '基础', desc: '常用短语 · 语境推断' },
  { label: '进阶', desc: '中级词汇 · 深层理解' },
  { label: '挑战', desc: '高级词汇 · 口语表达' },
];

function QuizClipPlayer({ src, start, end }: { src: string; start: number; end: number }) {
  const vidRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);
  const duration = Math.max(end - start, 1);

  const togglePlay = useCallback(() => {
    const v = vidRef.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); }
    else {
      if (v.currentTime < start || v.currentTime > end) v.currentTime = start;
      v.play().then(() => setPlaying(true)).catch(() => {});
    }
  }, [playing, start, end]);

  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    const onTimeUpdate = () => {
      const t = v.currentTime;
      setCurTime(t - start);
      if (t >= end && playing) { v.pause(); setPlaying(false); v.currentTime = start; }
    };
    const onEnded = () => { setPlaying(false); };
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('ended', onEnded);
    return () => {
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.removeEventListener('ended', onEnded);
    };
  }, [start, end, playing]);

  const seekTo = (ratio: number) => {
    const v = vidRef.current;
    if (!v) return;
    v.currentTime = start + ratio * (end - start);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(0).padStart(2, '0')}`;

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-black">
      <div className="relative w-full aspect-video">
        <video
          ref={vidRef}
          src={src}
          className="absolute inset-0 w-full h-full object-cover"
          preload="metadata"
          playsInline
        />
      </div>
      <div className="px-2 py-1.5 flex items-center gap-1.5 bg-muted/80">
        <button onClick={togglePlay} className="shrink-0 p-1 rounded hover:bg-background transition-colors">
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 min-w-[28px]">{fmt(curTime)}</span>
        <div
          className="flex-1 h-1 bg-border rounded-full cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seekTo((e.clientX - rect.left) / rect.width);
          }}
        >
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${Math.min(Math.max(curTime / duration, 0), 1) * 100}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 min-w-[28px]">{fmt(duration)}</span>
      </div>
    </div>
  );
}

export default function VideoQuiz({ open, onClose, videoId, videoTitle, videoUrl, subtitles, videoRef }: VideoQuizProps) {
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [showResult, setShowResult] = useState(false);
  const [submitted, setSubmitted] = useState<Record<number, boolean>>({});
  const [bankInfo, setBankInfo] = useState<{ total: number; stats: Record<string, number> } | null>(null);
  const [selectedStars, setSelectedStars] = useState(0);

  const recognitionRef = useRef<null | {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: (event: unknown) => void;
    onerror: () => void;
    onend: () => void;
    start: () => void;
    stop: () => void;
  }>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [speechSupported, setSpeechSupported] = useState(true);

  const fetchQuestions = useCallback(async (stars: number) => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('ve-session-token') || '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      await fetch('/api/quiz/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          videoId,
          title: videoTitle,
          subtitles: subtitles.slice(0, 80).map(s => ({
            id: s.id,
            text: s.text,
            startTime: s.startTime,
            endTime: s.endTime,
          })),
        }),
      }).then(async r => {
        if (!r.ok) throw new Error((await r.json()).error || '生成题库失败');
      });

      const drawRes = await fetch('/api/quiz/draw', {
        method: 'POST',
        headers,
        body: JSON.stringify({ videoId, count: 6, stars }),
      });
      const data = await drawRes.json();
      if (!drawRes.ok) throw new Error(data.error || '抽题失败');
      setQuestions(data.questions);
      setBankInfo({ total: data.bankTotal, stats: data.bankStats });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [videoId, videoTitle, subtitles]);

  useEffect(() => {
    if (!open) return;
    setCurrentIdx(0);
    setAnswers({});
    setShowResult(false);
    setSubmitted({});
    setTranscript('');
    setIsRecording(false);
    setBankInfo(null);
    setQuestions([]);
    setSelectedStars(0);
    setError('');
    setLoading(false);
  }, [open]);

  useEffect(() => {
    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      setSpeechSupported(true);
    } else {
      setSpeechSupported(false);
    }
  }, []);

  const [hoverStar, setHoverStar] = useState(0);
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    if (open && videoRef?.current) {
      wasPlayingRef.current = !videoRef.current.paused;
      videoRef.current.pause();
    }
    if (!open && videoRef?.current && wasPlayingRef.current) {
      videoRef.current.play().catch(() => {});
      wasPlayingRef.current = false;
    }
  }, [open, videoRef]);

  const handleStarSelect = (stars: number) => {
    setSelectedStars(stars);
    setCurrentIdx(0);
    setAnswers({});
    setShowResult(false);
    setSubmitted({});
    setTranscript('');
    setIsRecording(false);
    setBankInfo(null);
    setQuestions([]);
    fetchQuestions(stars);
  };

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(() => {
    if (!speechSupported) return;
    const w = window as unknown as Record<string, unknown>;
    const SR = (w.SpeechRecognition || w.webkitSpeechRecognition) as new () => {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: (event: unknown) => void;
      onerror: () => void;
      onend: () => void;
      start(): void;
      stop(): void;
    };
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event: unknown) => {
      const srEvent = event as { results: { isFinal: boolean; [0]: { transcript: string } }[] };
      let final = '';
      for (let i = 0; i < srEvent.results.length; i++) {
        if (srEvent.results[i].isFinal) final += srEvent.results[i][0].transcript + ' ';
      }
      if (final) setTranscript(prev => prev + final.trim() + ' ');
    };
    rec.onerror = () => { stopRecognition(); };
    rec.onend = () => { setIsRecording(false); };
    recognitionRef.current = rec;
    rec.start();
    setIsRecording(true);
    setTranscript('');
  }, [speechSupported, stopRecognition]);

  const toggleRecording = () => {
    if (isRecording) stopRecognition();
    else startRecording();
  };

  const selectAnswer = (qId: number, ans: string) => {
    setAnswers(prev => ({ ...prev, [qId]: ans }));
    setSubmitted(prev => ({ ...prev, [qId]: true }));
  };

  const nextQuestion = () => {
    if (currentIdx < questions.length - 1) setCurrentIdx(prev => prev + 1);
    else setShowResult(true);
  };

  const prevQuestion = () => {
    if (currentIdx > 0) setCurrentIdx(prev => prev - 1);
  };

  const retry = () => {
    setCurrentIdx(0);
    setAnswers({});
    setShowResult(false);
    setSubmitted({});
    setTranscript('');
    setQuestions([]);
    setBankInfo(null);
    setSelectedStars(0);
    setError('');
    setLoading(false);
  };

  if (!open) return null;

  const currentQ = questions[currentIdx];
  const correctCount = Object.entries(answers).filter(([id, ans]) => {
    const q = questions.find(q => q.id === Number(id));
    return q && q.type === 'choice' && q.answer === ans;
  }).length;
  const choiceQuestions = questions.filter(q => q.type === 'choice');
  const answeredChoice = choiceQuestions.filter(q => answers[q.id]).length;
  const score = answeredChoice > 0 ? Math.round((correctCount / answeredChoice) * 100) : 0;
  const hasClip = currentQ && currentQ.startTime > 0 && currentQ.endTime > currentQ.startTime;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="w-full max-w-5xl max-h-[92vh] flex flex-col bg-card rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-7 py-4 border-b shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-lg">视频测试</span>
            {!loading && !error && selectedStars > 0 && questions.length > 0 && (
              <span className="text-base text-muted-foreground">
                {currentIdx + 1} / {questions.length}
              </span>
            )}
            {selectedStars > 0 && (
              <span className="text-base" style={{ color: STAR_COLORS[selectedStars - 1] }}>
                {'★'.repeat(selectedStars)}{'☆'.repeat(4 - selectedStars)}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!loading && !error && questions.length > 0 && selectedStars > 0 && (
          <div className="px-7 shrink-0">
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-7 py-5">
          {selectedStars === 0 && !loading && !error ? (
            <div className="flex flex-col items-center gap-6 py-10">
              <div className="text-center">
                <h2 className="text-2xl font-bold">选择难度</h2>
                <p className="text-muted-foreground mt-2 text-base">根据你的水平选择合适的星级</p>
              </div>

              <div className="flex flex-col items-center gap-4">
                <div className="flex items-center gap-4">
                  {[1, 2, 3, 4].map((star) => {
                    const active = star <= hoverStar;
                    const color = STAR_COLORS[star - 1];
                    return (
                      <button
                        key={star}
                        onMouseEnter={() => setHoverStar(star)}
                        onMouseLeave={() => setHoverStar(0)}
                        onClick={() => handleStarSelect(star)}
                        className="transition-transform duration-150 hover:scale-110 active:scale-95"
                      >
                        <Star
                          className="h-14 w-14 transition-all duration-200"
                          style={{
                            fill: active ? color : 'transparent',
                            stroke: color,
                            strokeWidth: 1.5,
                            filter: active ? `drop-shadow(0 0 8px ${color}60)` : 'none',
                          }}
                        />
                      </button>
                    );
                  })}
                </div>

                <div className="h-16 flex items-center justify-center">
                  {hoverStar > 0 && (
                    <div className="text-center animate-in fade-in duration-150">
                      <div className="font-bold text-xl" style={{ color: STAR_COLORS[hoverStar - 1] }}>
                        {STAR_DETAIL[hoverStar - 1].label}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {STAR_DETAIL[hoverStar - 1].desc}
                        {hoverStar === 4 && ' · 含口语表达题'}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <p className="text-sm text-muted-foreground">每次测试共 6 道题</p>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">正在生成题库...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <XCircle className="h-8 w-8 text-red-400" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <button onClick={() => fetchQuestions(selectedStars || 1)} className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 transition-colors">
                <RotateCcw className="h-4 w-4" /> 重试
              </button>
            </div>
          ) : showResult ? (
            <div className="py-4">
              <div className="text-center mb-8">
                <div className="text-6xl font-black">{score}<span className="text-2xl text-muted-foreground ml-1">分</span></div>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="text-center">
                  <div className="text-3xl font-bold">{answeredChoice}</div>
                  <div className="text-sm text-muted-foreground">已答</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-500">{correctCount}</div>
                  <div className="text-sm text-muted-foreground">正确</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-red-400">{answeredChoice - correctCount}</div>
                  <div className="text-sm text-muted-foreground">错误</div>
                </div>
              </div>

              <div className="space-y-2">
                {questions.map((q) => (
                  <div key={q.id} className={`p-4 rounded-lg text-[15px] ${
                    q.type === 'choice'
                      ? answers[q.id] === q.answer ? 'bg-green-500/8' : answers[q.id] ? 'bg-red-500/8' : 'bg-muted/50'
                      : 'bg-muted/50'
                  }`}>
                    <div className="flex items-start gap-3">
                      <span className={`shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        q.type === 'choice'
                          ? answers[q.id] === q.answer ? 'bg-green-500 text-white' : answers[q.id] ? 'bg-red-500 text-white' : 'bg-muted text-muted-foreground'
                          : 'bg-blue-500 text-white'
                      }`}>
                        {q.id}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{q.question}</p>
                        {q.type === 'choice' && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {answers[q.id] === q.answer ? '✓ 正确' : `你的答案：${answers[q.id] || '未作答'} · 正确：${q.answer}`}
                          </p>
                        )}
                        {q.explanation && (
                          <p className="text-sm text-muted-foreground mt-1">{q.explanation}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 mt-8">
                <button onClick={retry} className="flex-1 flex items-center justify-center gap-2 px-5 py-3 border rounded-xl text-base hover:bg-muted transition-colors">
                  <RotateCcw className="h-5 w-5" /> 重新选择难度
                </button>
                <button onClick={onClose} className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-primary text-primary-foreground rounded-xl text-base hover:bg-primary/90 transition-colors">
                  完成
                </button>
              </div>
            </div>
          ) : currentQ ? (
            <div className="flex flex-col h-full">
              <h3 className="text-lg font-semibold leading-relaxed mb-5">{currentQ.question}</h3>
              <div className="flex gap-5 flex-1 min-h-0">
                {hasClip && (
                  <div className="w-[48%] shrink-0 flex flex-col">
                    <div className="flex-1 overflow-hidden rounded-xl">
                      <QuizClipPlayer src={videoUrl} start={currentQ.startTime} end={currentQ.endTime} />
                    </div>
                  </div>
                )}

                <div className={`flex flex-col min-w-0 ${hasClip ? 'flex-1' : 'w-full'}`}>

                {currentQ.type === 'choice' && currentQ.options && (
                  <div className="space-y-3">
                    {currentQ.options.map((opt, i) => {
                      const letter = String.fromCharCode(65 + i);
                      const isSelected = answers[currentQ.id] === letter;
                      const isSubmitted = submitted[currentQ.id];
                      const isCorrect = letter === currentQ.answer;
                      const showExplanation = isSubmitted && isCorrect && currentQ.explanation;

                      let cls = 'bg-muted/40 hover:bg-muted/70';
                      if (!isSubmitted && isSelected) cls = 'bg-primary/10 ring-1 ring-primary/40';
                      if (isSubmitted && isSelected && isCorrect) cls = 'bg-green-500/10 ring-1 ring-green-500/40';
                      if (isSubmitted && isSelected && !isCorrect) cls = 'bg-red-500/10 ring-1 ring-red-500/40';
                      if (isSubmitted && isCorrect && !isSelected) cls = 'bg-green-500/5 ring-1 ring-green-500/30';

                      return (
                        <div key={i}>
                          <button
                            onClick={() => selectAnswer(currentQ.id, letter)}
                            disabled={!!submitted[currentQ.id]}
                            className={`w-full text-left px-5 py-3 rounded-xl transition-all duration-200 ${cls} ${submitted[currentQ.id] ? 'cursor-default' : 'cursor-pointer'}`}
                          >
                            <div className="flex items-start gap-3">
                              <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                                isSubmitted && isSelected
                                  ? isCorrect ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
                                  : isSubmitted && isCorrect ? 'bg-green-400 text-white'
                                  : isSelected ? 'bg-primary text-white'
                                  : 'bg-muted text-muted-foreground'
                              }`}>
                                {letter}
                              </span>
                              <span className="text-[15px] leading-relaxed pt-0.5">{opt.replace(/^[A-D]\)\s*/, '')}</span>
                            </div>
                          </button>
                          {showExplanation && (
                            <div className="ml-10 mt-1.5 text-sm text-muted-foreground leading-relaxed">
                              {currentQ.explanation}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {currentQ.type === 'speaking' && (
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/15">
                      <p className="text-sm text-muted-foreground mb-1">参考提示</p>
                      <p className="text-[15px]">{currentQ.hint || currentQ.referenceAnswer}</p>
                    </div>

                    <button
                      onClick={toggleRecording}
                      className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        isRecording
                          ? 'bg-red-500 text-white hover:bg-red-600'
                          : 'bg-blue-500 text-white hover:bg-blue-600'
                      }`}
                    >
                      {isRecording ? (
                        <><MicOff className="h-5 w-5" /> 停止</>
                      ) : (
                        <><Mic className="h-5 w-5" /> 录音</>
                      )}
                    </button>

                    {transcript && (
                      <div className="p-4 rounded-xl bg-primary/5 border border-primary/15">
                        <p className="text-sm text-muted-foreground mb-1">你的回答</p>
                        <p className="text-[15px]">{transcript}</p>
                      </div>
                    )}

                    {currentQ.referenceAnswer && (
                      <div className="p-4 rounded-xl bg-muted/40">
                        <p className="text-sm text-muted-foreground mb-1">参考答案</p>
                        <p className="text-[15px]">{currentQ.referenceAnswer}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          ) : null}
        </div>

        {!loading && !error && !showResult && questions.length > 0 && selectedStars > 0 && currentQ && (
          <div className="flex items-center justify-between px-7 py-4 border-t shrink-0">
            <button
              onClick={prevQuestion}
              disabled={currentIdx === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-base hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-5 w-5" /> 上一题
            </button>
            <button
              onClick={nextQuestion}
              className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-base hover:bg-primary/90 transition-colors"
            >
              {currentIdx < questions.length - 1 ? '下一题' : '查看结果'} <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
