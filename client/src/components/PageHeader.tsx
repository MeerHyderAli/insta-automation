export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{eyebrow}</p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-zinc-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
