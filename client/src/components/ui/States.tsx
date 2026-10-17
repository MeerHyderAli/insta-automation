import { AlertTriangle, Inbox, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

export function LoadingState({
  label = 'Loading…',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-16 text-zinc-500',
        className,
      )}
      role="status"
    >
      <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} aria-hidden="true" />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading page">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="rounded-xl border border-zinc-200 bg-white p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-8 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: typeof Inbox;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}
    >
      <div className="mb-4 rounded-full bg-zinc-100 p-3 text-zinc-500">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm text-zinc-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Could not load this page',
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  const Icon = offline ? WifiOff : AlertTriangle;
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}
      role="alert"
    >
      <div className="mb-4 rounded-full bg-red-50 p-3 text-red-600">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-zinc-500">
        {message ?? 'Something went wrong. Check the server logs or try again.'}
      </p>
      {onRetry ? (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" /> Try again
        </Button>
      ) : null}
    </div>
  );
}
