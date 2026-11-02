import type { ReactNode } from 'react';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned action cluster (buttons). */
  actions?: ReactNode;
  /** Extra content rendered full-width under the header row (e.g. stat strip). */
  footer?: ReactNode;
}

// One page header for every tab: title, one-line context, actions. No banner,
// no icon tile — the content below carries the identity.
export function PageHeader({ title, subtitle, actions, footer }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {footer}
    </div>
  );
}
