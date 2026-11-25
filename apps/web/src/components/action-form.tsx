'use client';
import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export type ActionResult = { ok: boolean | null; message: string | null; fieldErrors?: Record<string, string> };
type Action = (prev: ActionResult, form: FormData) => Promise<ActionResult>;

/**
 * Form bound to a server action with an accessible result message.
 * Keeps what the user typed when the action fails (React would otherwise reset the
 * form after every submission); clears add-forms only on success when `resetOnSuccess`.
 * `children` may be a render function receiving field errors.
 */
export function ActionForm({
  action,
  label,
  submitLabel,
  submitVariant = 'primary',
  className = 'space-y-4',
  resetOnSuccess = false,
  submitDisabled = false,
  children,
}: {
  action: Action;
  label: string;
  submitLabel: string;
  submitVariant?: 'primary' | 'secondary' | 'danger';
  className?: string;
  resetOnSuccess?: boolean;
  /** Disable the submit button (for example until a prerequisite is met); the server still enforces it. */
  submitDisabled?: boolean;
  children?: ReactNode | ((errors: Record<string, string>) => ReactNode);
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, { ok: null, message: null });
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} aria-label={label} className={className} noValidate>
      {typeof children === 'function' ? children(errors) : children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={submitVariant} disabled={pending || submitDisabled}>
          {submitLabel}
        </Button>
        {state.message && (
          <p role={state.ok ? 'status' : 'alert'} className={`text-sm font-medium ${state.ok ? '' : 'text-danger'}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
