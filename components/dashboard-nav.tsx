'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/dashboard', label: '内容' },
  { href: '/dashboard/users', label: '用户' },
];

export default function DashboardNav() {
  const pathname = usePathname();
  return (
    <nav className="ml-auto flex gap-1 bg-muted/40 p-1 rounded-lg">
      {TABS.map(t => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3 py-1 rounded-md text-sm transition-colors ${
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
