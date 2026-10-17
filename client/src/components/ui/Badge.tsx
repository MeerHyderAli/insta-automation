import { cn } from '../../lib/utils';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'muted';

const tones: Record<Tone, string> = {
  neutral: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
  brand: 'bg-orange-50 text-orange-700 border-orange-200',
  muted: 'bg-zinc-50 text-zinc-500 border-zinc-200',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
