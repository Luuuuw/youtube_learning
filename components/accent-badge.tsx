export default function AccentBadge({ accent }: { accent?: string }) {
  if (!accent || accent === 'other') return null;
  const config = {
    british: { label: '英音', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' },
    american: { label: '美音', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
  };
  const cfg = config[accent as keyof typeof config];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}
