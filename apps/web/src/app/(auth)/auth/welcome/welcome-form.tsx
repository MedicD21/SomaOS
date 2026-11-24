'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { passwordSetupSchema } from '@soma/validators';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { createSupabaseBrowser } from '@/lib/supabase/client';

type State = 'loading' | 'ready' | 'invalid';

/**
 * Landing page for the emailed invitation link. The link delivers a short-lived session in the URL
 * fragment, which only the browser can read; the Supabase client turns it into a session, and the
 * person then chooses a password before accepting their invitation.
 */
export function WelcomeForm() {
  const router = useRouter();
  const [state, setState] = useState<State>('loading');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowser();
    async function start() {
      // The invitation link delivers one-time tokens in the URL fragment (implicit grant). The app's
      // client uses PKCE, which refuses fragment callbacks, so establish the session explicitly and
      // then strip the tokens from the address bar and history.
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const accessToken = fragment.get('access_token');
      const refreshToken = fragment.get('refresh_token');
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        window.history.replaceState(null, '', window.location.pathname);
        setState(error ? 'invalid' : 'ready');
        return;
      }
      const { data } = await supabase.auth.getSession();
      setState(data.session ? 'ready' : 'invalid');
    }
    start().catch(() => setState('invalid'));
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const parsed = passwordSetupSchema.safeParse({ password: data.get('password'), confirm: data.get('confirm') });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
      setErrors(next);
      setMessage('Please fix the highlighted fields.');
      return;
    }
    setErrors({});
    setMessage(null);
    setSaving(true);
    const { error } = await createSupabaseBrowser().auth.updateUser({ password: parsed.data.password });
    setSaving(false);
    if (error) {
      setMessage(error.message.toLowerCase().includes('password') ? error.message : 'We could not save your password. Please try again.');
      return;
    }
    router.replace('/invites');
    router.refresh();
  }

  if (state === 'loading') return <p role="status">Setting things up…</p>;
  if (state === 'invalid') {
    return (
      <Card>
        <h1 className="mb-2 text-xl font-bold">This link is no longer valid</h1>
        <p className="mb-4">Ask your administrator to send a new invitation.</p>
        <Link href="/login" className="underline">Go to sign in</Link>
      </Card>
    );
  }
  return (
    <Card>
      <h1 className="mb-2 text-xl font-bold">Choose a password</h1>
      <p className="mb-4 text-sm text-muted">Welcome to SomaOS. Choose a password to finish setting up your account.</p>
      <form aria-label="Choose a password" onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field id="pw" label="Password" hint="At least 12 characters." error={errors.password}>
          <Input id="pw" name="password" type="password" autoComplete="new-password" required />
        </Field>
        <Field id="pw2" label="Confirm password" error={errors.confirm}>
          <Input id="pw2" name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        {message && <p role="alert" className="text-sm font-medium text-danger">{message}</p>}
        <Button type="submit" className="w-full" disabled={saving}>Save password</Button>
      </form>
    </Card>
  );
}
