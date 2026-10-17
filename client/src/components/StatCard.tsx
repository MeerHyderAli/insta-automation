import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = {
    default: 'bg-zinc-100 text-zinc-600',
    success: 'bg-emerald-50 text-emerald-600',
    warning: 'bg-amber-50 text-amber-600',
    danger: 'bg-red-50 text-red-600',
  }[tone];
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-zinc-500">{label}</p>
        {Icon ? (
          <span className={cn('rounded-lg p-1.5', toneClass)}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}
