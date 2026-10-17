import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

export function Pagination({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  if (total === 0) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-5 py-3 text-sm text-zinc-500">
      <span>
        {offset + 1}–{Math.min(offset + limit, total)} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs text-zinc-500">
          Page {page} of {pages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
