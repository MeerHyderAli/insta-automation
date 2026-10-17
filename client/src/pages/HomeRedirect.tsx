import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { LoadingState } from '../components/ui/States';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';

export function HomeRedirect() {
  const { api, user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    api
      .getMe()
      .then((me) => {
        if (cancelled) return;
        const first = me.workspaces[0];
        navigate(first ? `/w/${first.id}` : '/onboarding', { replace: true });
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : 'Could not load workspaces.');
      });
    return () => {
      cancelled = true;
    };
  }, [api, user, navigate]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <Alert tone="error" title="Could not open your workspace">
          {error}
        </Alert>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" asChild>
            <Link to="/login">Back to sign in</Link>
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <LoadingState label="Opening your workspace…" />
    </div>
  );
}
