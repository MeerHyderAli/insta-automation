import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-zinc-400">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-zinc-900">This page does not exist</h1>
      <p className="mt-2 max-w-md text-sm text-zinc-500">
        The link may be outdated, or you may not have access to this workspace.
      </p>
      <Button asChild className="mt-6">
        <Link to="/">Back to your workspace</Link>
      </Button>
    </div>
  );
}
