import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

type Tone = 'info' | 'warning' | 'error' | 'success';

const config = {
  info: { icon: Info, className: 'border-sky-200 bg-sky-50 text-sky-900' },
  warning: { icon: AlertTriangle, className: 'border-amber-200 bg-amber-50 text-amber-900' },
  error: { icon: XCircle, className: 'border-red-200 bg-red-50 text-red-900' },
  success: { icon: CheckCircle2, className: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
} satisfies Record<Tone, { icon: typeof Info; className: string }>;

export function Alert({
  tone = 'info',
  title,
  children,
  actions,
  className,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const { icon: Icon, className: toneClass } = config[tone];
  return (
    <div
      className={cn('flex gap-3 rounded-lg border p-3.5 text-sm', toneClass, className)}
      role="status"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-1', 'leading-relaxed')}>{children}</div> : null}
        {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
