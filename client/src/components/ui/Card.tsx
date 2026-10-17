import { cn } from '../../lib/utils';

export function Card({
  className,
  children,
  as: Comp = 'div',
}: {
  className?: string;
  children: React.ReactNode;
  as?: 'div' | 'section' | 'article';
}) {
  return (
    <Comp className={cn('rounded-xl border border-zinc-200 bg-white shadow-sm', className)}>
      {children}
    </Comp>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-zinc-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn('p-5', className)}>{children}</div>;
}
