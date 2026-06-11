'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  SkipBack,
  SkipForward,
  Maximize,
  EarOff,
} from 'lucide-react';
import { Subtitle, formatTime } from '@/lib/vtt-parser';
import { getSubtitleAtTime } from '@/lib/subtitle-sync';

interface VideoPlayerProps {
  videoUrl: string;
  subtitles: Subtitle[];
  onTimeUpdate?: (currentTime: number) => void;
  onSeek?: (time: number) => void;
  videoRef?: React.RefObject<HTMLVideoElement>;
  blindMode?: boolean;
}

export default function VideoPlayer({
  videoUrl,
  subtitles,
  onTimeUpdate,
  onSeek,
  videoRef: externalVideoRef,
  blindMode = false,
}: VideoPlayerProps) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalVideoRef || internalRef;
  const progressRef = useRef<HTMLDivElement>(null);
  const blindVideoRef = useRef<HTMLVideoElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [overlayCaptionsOn, setOverlayCaptionsOn] = useState(false);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const durationRef = useRef(0);

  useEffect(() => {
    const saved = typeof window !== 'undefined'
      ? window.localStorage.getItem('ve-overlay-captions')
      : null;
    if (saved === 'off') setOverlayCaptionsOn(false);
  }, []);

  const toggleOverlayCaptions = () => {
    setOverlayCaptionsOn(prev => {
      const next = !prev;
      try { window.localStorage.setItem('ve-overlay-captions', next ? 'on' : 'off'); } catch {}
      return next;
    });
  };

  const readDuration = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const d = video.duration;
    if (d && isFinite(d) && d > 0) {
      setDuration(d);
      durationRef.current = d;
    }
  }, [videoRef]);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      const t = videoRef.current.currentTime;
      setCurrentTime(t);
      onTimeUpdate?.(t);
    }
  }, [videoRef, onTimeUpdate]);

  useEffect(() => {
    if (!isPlaying || !onTimeUpdate) return;
    let rafId: number;
    const tick = () => {
      if (videoRef.current) {
        onTimeUpdate(videoRef.current.currentTime);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, onTimeUpdate, videoRef]);

  const handleLoadedMetadata = () => {
    readDuration();
  };

  const handleDurationChange = () => {
    readDuration();
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(0);
    setDuration(0);
    durationRef.current = 0;
    if (video.readyState >= 1) {
      readDuration();
    }
  }, [videoUrl, videoRef, readDuration]);

  const handlePlayPause = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
  };

  const handleSkip = (seconds: number) => {
    if (videoRef.current) {
      const dur = durationRef.current || videoRef.current.duration || duration;
      videoRef.current.currentTime = Math.max(
        0,
        Math.min(dur || Infinity, videoRef.current.currentTime + seconds)
      );
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    setIsMuted(v === 0);
    if (videoRef.current) videoRef.current.volume = v;
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handlePlaybackRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) videoRef.current.playbackRate = rate;
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !videoRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const dur = durationRef.current || videoRef.current.duration || duration;
    if (dur && isFinite(dur)) {
      const newTime = pct * dur;
      videoRef.current.currentTime = newTime;
      onSeek?.(newTime);
    }
  };

  const handleProgressHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !videoRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const dur = durationRef.current || videoRef.current.duration || duration;
    if (dur && isFinite(dur)) {
      setHoverTime(pct * dur);
      setHoverX(x);
    }
  };

  const handleFullscreen = () => {
    const container = videoRef.current?.parentElement?.parentElement;
    if (container) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        container.requestFullscreen();
      }
    }
  };

  const resetHideTimer = () => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (isPlaying) {
      hideTimerRef.current = setTimeout(() => setShowControls(false), 3000);
    }
  };

  useEffect(() => {
    if (!isPlaying) {
      setShowControls(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
  }, [isPlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const syncPlaybackRate = () => {
      setPlaybackRate(video.playbackRate);
    };

    syncPlaybackRate();
    video.addEventListener('ratechange', syncPlaybackRate);

    return () => {
      video.removeEventListener('ratechange', syncPlaybackRate);
    };
  }, [videoRef]);

  useEffect(() => {
    const main = videoRef.current;
    const blind = blindVideoRef.current;
    if (!main || !blind) return;

    const sync = () => {
      if (Math.abs(blind.currentTime - main.currentTime) > 0.5) {
        blind.currentTime = main.currentTime;
      }
      if (main.paused && !blind.paused) blind.pause();
      if (!main.paused && blind.paused) blind.play().catch(() => {});
      blind.playbackRate = main.playbackRate;
    };

    sync();
    const interval = setInterval(sync, 1000);
    return () => clearInterval(interval);
  }, [videoRef, blindMode]);

  const currentSubtitle = getSubtitleAtTime(subtitles, currentTime);

  const durForCalc = durationRef.current || duration;
  const progressPct = durForCalc > 0 ? (currentTime / durForCalc) * 100 : 0;

  return (
    <div
      className="bg-card rounded-lg overflow-hidden border border-border relative group"
      onMouseMove={resetHideTimer}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      <div className="relative">
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full aspect-video bg-black"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onDurationChange={handleDurationChange}
          onClick={handlePlayPause}
          preload="metadata"
          playsInline
          webkit-playsinline="true"
          x5-video-player-type="h5"
          x5-video-player-fullscreen="false"
        />

        {currentSubtitle && !blindMode && overlayCaptionsOn && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 max-w-[80%] text-center pointer-events-none max-h-[33%] overflow-hidden">
            <span className="inline-block bg-black/80 text-white px-4 py-2 rounded-lg text-base leading-relaxed line-clamp-3">
              {currentSubtitle.text}
            </span>
          </div>
        )}

        {blindMode && (
          <div className="absolute bottom-0 left-0 right-0 h-[30%] pointer-events-none overflow-hidden">
            <video
              ref={blindVideoRef}
              src={videoUrl}
              className="absolute bottom-0 left-0 w-full aspect-video"
              style={{
                filter: 'blur(20px) brightness(0.6)',
                clipPath: 'inset(70% 0 0 0)',
                transform: 'scaleY(3.33)',
                transformOrigin: 'top',
              }}
              muted
              playsInline
            />
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 40%, rgba(0,0,0,0.1) 75%, transparent 100%)',
              }}
            />
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/10">
              <EarOff className="h-3 w-3 text-white/70" />
              <span className="text-[10px] text-white/60 font-medium tracking-widest">BLIND</span>
            </div>
          </div>
        )}

        <div
          className={`absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30 flex items-center justify-center transition-opacity duration-300 ${
            showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-6">
            <button
              onClick={() => handleSkip(-10)}
              className="p-3 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
            >
              <SkipBack className="h-5 w-5 text-white" />
            </button>
            <button
              onClick={handlePlayPause}
              className="p-5 bg-white/20 rounded-full hover:bg-white/30 transition-colors"
            >
              {isPlaying ? (
                <Pause className="h-8 w-8 text-white" />
              ) : (
                <Play className="h-8 w-8 text-white ml-1" />
              )}
            </button>
            <button
              onClick={() => handleSkip(10)}
              className="p-3 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
            >
              <SkipForward className="h-5 w-5 text-white" />
            </button>
          </div>
        </div>
      </div>

      <div
        className={`px-2 sm:px-4 py-1.5 sm:py-3 bg-card border-t border-border transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div
          ref={progressRef}
          className="relative h-1 sm:h-1.5 bg-muted rounded-full cursor-pointer group/progress mb-1.5 sm:mb-3"
          onClick={handleProgressClick}
          onMouseMove={handleProgressHover}
          onMouseLeave={() => setHoverTime(null)}
        >
          <div
            className="absolute top-0 left-0 h-full bg-white rounded-full transition-[width] duration-100"
            style={{ width: `${progressPct}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-md opacity-0 group-hover/progress:opacity-100 transition-opacity"
            style={{ left: `${progressPct}%`, marginLeft: '-7px' }}
          />
          {hoverTime !== null && (
            <div
              className="absolute -top-8 bg-black/80 text-white text-xs px-2 py-1 rounded -translate-x-1/2 pointer-events-none"
              style={{ left: hoverX }}
            >
              {formatTime(hoverTime)}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-sm gap-2">
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={handlePlayPause}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </button>
            <span className="text-muted-foreground tabular-nums text-xs sm:text-sm sm:min-w-[100px]">
              {formatTime(currentTime)} / {formatTime(durForCalc)}
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto">
            <div className="hidden sm:flex items-center gap-1.5">
              <button
                onClick={toggleMute}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-20 h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-white"
              />
            </div>

            <button
              onClick={toggleMute}
              className="sm:hidden text-muted-foreground hover:text-foreground transition-colors"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>

            <button
              onClick={toggleOverlayCaptions}
              className={`transition-colors shrink-0 text-xs font-bold font-mono ${overlayCaptionsOn ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              title={overlayCaptionsOn ? '隐藏视频上的字幕' : '显示视频上的字幕'}
              aria-label={overlayCaptionsOn ? '关闭画面字幕' : '开启画面字幕'}
            >
              CC
            </button>

            <div className="flex items-center gap-0.5 sm:gap-1">
              {[0.8, 1.0, 1.25, 1.5, 2.0].map((rate) => (
                <button
                  key={rate}
                  onClick={() => handlePlaybackRateChange(rate)}
                  className={`px-1 sm:px-1.5 py-0.5 text-[10px] sm:text-xs rounded transition-colors ${
                    playbackRate === rate
                      ? 'bg-white text-black font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>

            <button
              onClick={handleFullscreen}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <Maximize className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
