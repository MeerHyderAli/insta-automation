import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LoadingState } from '../components/ui/States';

/**
 * The Meta OAuth callback redirects to /accounts?...; this route resolves the
 * user's workspace and preserves the status query string.
 */
export function OAuthLanding() {
  const { api, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }
    let cancelled = false;
    api
      .getMe()
      .then((me) => {
        if (cancelled) return;
        const first = me.workspaces[0];
        const query = params.toString();
        navigate(first ? `/w/${first.id}/accounts${query ? `?${query}` : ''}` : '/onboarding', {
          replace: true,
        });
      })
      .catch(() => navigate('/login', { replace: true }));
    return () => {
      cancelled = true;
    };
  }, [api, user, navigate, params]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <LoadingState label="Finishing the Instagram connection…" />
    </div>
  );
}
