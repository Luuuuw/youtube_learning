'use client';

import { useEffect, useState, useRef } from 'react';

export default function VocabEnter({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    const t = setTimeout(() => {
      setVisible(true);
      done.current = true;
    }, 120);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={`transition-all duration-700 ease-out ${
      visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
    }`}>
      {children}
    </div>
  );
}

export function VocabCardEnter({ children, index = 0 }: { children: React.ReactNode; index?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const delay = Math.min(index * 60, 600);
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [index]);

  return (
    <div
      className={`transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        visible
          ? 'opacity-100 translate-y-0 scale-100'
          : 'opacity-0 translate-y-4 scale-[0.97]'
      }`}
      style={{ transitionDelay: visible ? '0ms' : '0ms' }}
    >
      {children}
    </div>
  );
}