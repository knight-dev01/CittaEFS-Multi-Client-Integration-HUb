import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong border border-transparent',
  secondary: 'bg-panel text-ink border border-line-strong hover:bg-panel-muted',
  ghost: 'bg-transparent text-ink-soft border border-transparent hover:bg-panel-muted hover:text-ink',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 border border-transparent',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  icon: 'h-8 w-8 p-0',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', className = '') {
  return `inline-flex shrink-0 items-center justify-center rounded-lg font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
}

export function Button({ variant = 'primary', size = 'md', className = '', type = 'button', ...props }: Props) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}
