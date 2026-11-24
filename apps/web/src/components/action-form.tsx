'use client';
import { useActionState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export type ActionResult = { ok: boolean | null; message: string | null; fieldErrors?: Record<string, string> };
type Action = (prev: ActionResult, form: FormData) => Promise<ActionResult>;

/**
 * Form bound to a server action with an accessible result message.
 * `children` may be a render function receiving field errors.
 */
export function ActionForm({
  action,
  label,
  submitLabel,
  submitVariant = 'primary',
  className = 'space-y-4',
  children,
}: {
  action: Action;
  label: string;
  submitLabel: string;
  submitVariant?: 'primary' | 'secondary' | 'danger';
  className?: string;
  children?: ReactNode | ((errors: Record<string, string>) => ReactNode);
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, { ok: null, message: null });
  const errors = state.fieldErrors ?? {};
  return (
    <form action={formAction} aria-label={label} className={className}>
      {typeof children === 'function' ? children(errors) : children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={submitVariant} disabled={pending}>
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
