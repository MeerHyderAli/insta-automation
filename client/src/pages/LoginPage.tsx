import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, MessageCircle, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Input';
import { Alert } from '../components/ui/Alert';

type Mode = 'signin' | 'signup';

export function LoginPage() {
  const { user, loading, demoMode, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!loading && user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? '/'} replace />;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
        navigate('/', { replace: true });
      } else {
        const result = await signUp(email.trim(), password);
        if (result.needsConfirmation) {
          setNotice('Check your email to confirm your account, then sign in.');
        } else {
          navigate('/', { replace: true });
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden brand-gradient p-10 text-white lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.35),transparent_45%)]" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            <MessageCircle className="h-6 w-6" />
          </span>
          <div>
            <p className="text-lg font-semibold tracking-tight">CommentPilot</p>
            <p className="text-xs text-white/70">Instagram comment automation</p>
          </div>
        </div>
        <div className="relative max-w-lg">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Turn comments into conversations, not busywork.
          </h1>
          <p className="mt-4 text-base text-white/80">
            Reply publicly, deliver resources privately, and see exactly what Instagram confirmed —
            without scraping or password sharing.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/85">
            <li className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              Official Instagram API only. Tokens are encrypted server-side and never sent to the
              browser.
            </li>
            <li className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              Multi-keyword matching, public and private replies, tracked resource links.
            </li>
            <li className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              Honest capabilities: follow verification is marked unsupported, not simulated.
            </li>
          </ul>
        </div>
        <p className="relative text-xs text-white/60">
          Built on the Instagram API with Instagram Login. Not affiliated with Meta.
        </p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl brand-gradient text-white">
              <MessageCircle className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">CommentPilot</span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">
            {demoMode
              ? 'Explore the demo workspace'
              : mode === 'signin'
                ? 'Sign in'
                : 'Create your account'}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {demoMode
              ? 'See every screen with clearly labelled sample data. No credentials required.'
              : 'Use your email and password. Workspaces, accounts and automations live in Supabase.'}
          </p>

          {demoMode ? (
            <div className="mt-6 space-y-4">
              <Alert tone="warning" title="Demo mode">
                This build has no Supabase or Meta credentials. Every screen is populated with
                sample data, and connecting Instagram is disabled because it cannot be done for real
                here. Nothing is sent or scheduled.
              </Alert>
              <Button size="lg" className="w-full" onClick={() => navigate('/')}>
                Open demo workspace <ArrowRight className="h-4 w-4" />
              </Button>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-500">
                To run against real Instagram accounts, configure Supabase and the Meta app
                credentials, then set <code className="font-mono">VITE_DEMO_MODE=false</code>. See
                README → Setup.
              </div>
            </div>
          ) : (
            <>
              <div className="mt-6 inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-1 text-sm">
                <button
                  type="button"
                  className={`rounded-md px-3 py-1.5 ${mode === 'signin' ? 'bg-white font-medium text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
                  onClick={() => setMode('signin')}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={`rounded-md px-3 py-1.5 ${mode === 'signup' ? 'bg-white font-medium text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
                  onClick={() => setMode('signup')}
                >
                  Create account
                </button>
              </div>

              <form className="mt-5 space-y-4" onSubmit={submit}>
                <Field label="Email" htmlFor="email">
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                  />
                </Field>
                <Field
                  label="Password"
                  htmlFor="password"
                  hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
                >
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    required
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                  />
                </Field>
                {error ? <Alert tone="error">{error}</Alert> : null}
                {notice ? <Alert tone="success">{notice}</Alert> : null}
                <Button type="submit" className="w-full" loading={busy}>
                  {mode === 'signin' ? 'Sign in' : 'Create account'}
                </Button>
              </form>
            </>
          )}

          <p className="mt-8 text-center text-xs text-zinc-400">
            By continuing you agree to the platform terms of the deployment you are using.{' '}
            <Link to="/" className="underline underline-offset-2">
              Learn more
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
