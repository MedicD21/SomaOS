'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { createSupabaseBrowser } from '@/lib/supabase/client';

type Mode = { kind: 'loading' } | { kind: 'enroll'; factorId: string; qr: string; secret: string } | { kind: 'verify'; factorId: string };

export function MfaForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowser();
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setError('Could not load your authenticator settings.');
      const verified = data.totp.find((f) => f.status === 'verified');
      if (verified) return setMode({ kind: 'verify', factorId: verified.id });
      for (const f of data.all.filter((f) => f.status === 'unverified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `SomaOS ${Date.now()}` });
      if (enrolled.error) return setError('Could not start authenticator setup.');
      setMode({ kind: 'enroll', factorId: enrolled.data.id, qr: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret });
    })();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode.kind === 'loading') return;
    setError(null);
    const supabase = createSupabaseBrowser();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: mode.factorId, code: code.trim() });
    if (error) return setError('That code did not work. Try the newest code.');
    router.replace('/');
    router.refresh();
  }

  if (mode.kind === 'loading') return <p role="status">{error ?? 'Loading…'}</p>;
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode.kind === 'enroll' ? (
        <div className="space-y-3">
          <p>Your role requires two-step sign-in. Scan this code with an authenticator app, or enter the key manually.</p>
          <img src={mode.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded bg-white p-2" />
          <p className="text-sm">
            Setup key: <code data-testid="totp-secret" className="break-all font-mono">{mode.secret}</code>
          </p>
        </div>
      ) : (
        <p>Enter the 6-digit code from your authenticator app.</p>
      )}
      <Field id="code" label="6-digit code">
        <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
      </Field>
      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      <Button type="submit" className="w-full">Verify</Button>
    </form>
  );
}
