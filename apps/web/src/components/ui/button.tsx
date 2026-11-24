import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';
const styles: Record<Variant, string> = {
  primary: 'bg-brand text-on-brand hover:opacity-90',
  secondary: 'bg-surface text-fg border border-line hover:bg-bg',
  danger: 'bg-surface text-danger border border-danger hover:bg-bg',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
