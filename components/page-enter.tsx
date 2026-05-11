'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';

const BRAND_TEXT = 'VibeEnglish';

export default function PageEnter({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [phase, setPhase] = useState<string>('mist');
  const [showContent, setShowContent] = useState(false);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const rippleId = useRef(0);
  const prevPath = useRef(pathname);

  const isInitial = prevPath.current === pathname;

  useEffect(() => {
    if (!isInitial) {
      setPhase('done');
      setShowContent(true);
      return;
    }

    const t1 = setTimeout(() => setPhase('surface'), 800);
    const t2 = setTimeout(() => setPhase('dissolve'), 2200);
    const t3 = setTimeout(() => {
      setPhase('done');
      setShowContent(true);
    }, 3500);

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  useEffect(() => { prevPath.current = pathname; }, [pathname]);

  const handleMove = useCallback((e: React.MouseEvent) => {
    if (phase === 'mist' || phase === 'surface') {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setMouse({ x, y });

      rippleId.current += 1;
      const id = rippleId.current;
      setRipples(prev => [...prev.slice(-8), { id, x, y }]);
      setTimeout(() => {
        setRipples(prev => prev.filter(r => r.id !== id));
      }, 2000);
    }
  }, [phase]);

  if (phase === 'done' && !isInitial) return <>{children}</>;

  return (
    <>
      {(phase !== 'done') && (
        <div
          ref={containerRef}
          className={`fixed inset-0 z-[9999] select-none transition-opacity duration-1000 ${
            phase === 'done' ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
          onMouseMove={handleMove}
          aria-hidden="true"
        >
          <div className="absolute inset-0 overflow-hidden" style={{
            background: phase === 'mist' || phase === 'surface'
              ? 'linear-gradient(180deg, #0a1628 0%, #0d2137 30%, #0f2a45 60%, #0a1a2e 100%)'
              : undefined,
          }}>

            {phase !== 'done' && (
              <div className={`absolute inset-0 transition-all duration-[2500ms] ease-in-out ${
                phase === 'dissolve' || phase === 'done'
                  ? 'opacity-0 scale-110 blur-[40px]'
                  : 'opacity-100 scale-100 blur-0'
              }`}>
                <div className="absolute inset-0 bg-gradient-to-br from-slate-900/90 via-blue-950/80 to-slate-900/90" />

                <svg className="absolute inset-0 w-full h-full opacity-[0.07]" xmlns="http://www.w3.org/2000/svg">
                  <filter id="fog">
                    <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="4" seed={2} />
                    <feColorMatrix values="0 0 0 0 0.6   0 0 0 0 0.7   0 0 0 0 0.85  0 0 0 1.2 0" />
                  </filter>
                  <rect width="100%" height="100%" filter="url(#fog)" />
                </svg>

                <svg className="absolute inset-0 w-full h-full opacity-[0.04] animate-fog-drift" xmlns="http://www.w3.org/2000/svg" style={{ animationDuration: '25s' }}>
                  <filter id="fog2">
                    <feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves="3" seed={5} />
                    <feColorMatrix values="0 0 0 0 0.8   0 0 0 0 0.85  0 0 0 0 0.95  0 0 0 1.5 0" />
                  </filter>
                  <rect width="100%" height="100%" filter="url(#fog2)" />
                </svg>

                <div
                  className="absolute rounded-full pointer-events-none transition-all duration-700 ease-out"
                  style={{
                    width: 400,
                    height: 400,
                    left: mouse.x - 200,
                    top: mouse.y - 200,
                    background: 'radial-gradient(circle, rgba(120,160,200,0.12) 0%, transparent 70%)',
                    transform: phase === 'surface' ? 'scale(1)' : 'scale(0.6)',
                    opacity: phase === 'mist' || phase === 'surface' ? 1 : 0,
                  }}
                />

                {ripples.map(r => (
                  <div
                    key={r.id}
                    className="absolute rounded-full pointer-events-none"
                    style={{
                      left: r.x,
                      top: r.y,
                      width: 8,
                      height: 8,
                      background: 'radial-gradient(circle, rgba(180,210,240,0.35) 0%, transparent 70%)',
                      boxShadow: '0 0 20px 8px rgba(150,190,230,0.15)',
                      animation: 'rippleExpand 2s ease-out forwards',
                      transform: 'translate(-50%, -50%)',
                    }}
                  />
                ))}
              </div>
            )}

            {phase !== 'done' && (
              <div className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-[2000ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
                phase === 'dissolve' || phase === 'done'
                  ? 'opacity-0 scale-105 translate-y-[-20px]'
                  : phase === 'surface'
                    ? 'opacity-100 scale-100 translate-y-0'
                    : 'opacity-70 scale-95 translate-y-3'
              }`}>
                <div className="flex items-center gap-1 mb-8">
                  {BRAND_TEXT.split('').map((char, i) => (
                    <span
                      key={i}
                      className="inline-block text-4xl md:text-6xl font-bold tracking-tight transition-all duration-1000"
                      style={{
                        color: '#c4d8f0',
                        textShadow: '0 0 40px rgba(150,190,240,0.3), 0 0 80px rgba(120,170,220,0.15)',
                        opacity: phase === 'mist' ? 0.3 : 1,
                        transform: phase === 'mist'
                          ? `translateY(${20 + Math.random() * 15}px) scale(0.85)`
                          : phase === 'surface'
                            ? 'translateY(0) scale(1)'
                            : 'translateY(-8px) scale(1)',
                        filter: phase === 'mist'
                          ? 'blur(6px)'
                          : phase === 'surface'
                            ? 'blur(0px)'
                            : 'blur(1px)',
                        animationDelay: `${i * 100}ms`,
                        transitionDelay: `${i * 50}ms`,
                      }}
                    >
                      {char}
                    </span>
                  ))}
                </div>

                <div className={`w-40 h-[1px] transition-all duration-1500 ${
                  phase === 'mist' ? 'w-0 opacity-0' : 'w-40 opacity-100'
                }`} style={{
                  background: 'linear-gradient(90deg, transparent, rgba(160,195,235,0.4), transparent)',
                  boxShadow: '0 0 12px rgba(140,180,225,0.2)',
                }} />

                <p className={`mt-8 text-xs tracking-[0.35em] uppercase transition-all duration-1000 delay-500 ${
                  phase === 'mist' ? 'opacity-0 translate-y-4' : 'opacity-60 translate-y-0'
                }`} style={{
                  color: 'rgba(160,190,225,0.5)',
                  letterSpacing: '0.35em',
                }}>
                  Immerse &middot; Learn &middot; Evolve
                </p>
              </div>
            )}

            {phase === 'dissolve' && (
              <div className="absolute inset-0 animate-dissolve-fade">
                <div className="absolute inset-0 bg-background/80 backdrop-blur-md" />
              </div>
            )}
          </div>
        </div>
      )}

      <div className={`transition-opacity duration-1000 ${showContent ? 'opacity-100' : 'opacity-0'}`}>
        {children}
      </div>
    </>
  );
}